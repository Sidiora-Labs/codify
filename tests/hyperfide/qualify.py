#!/usr/bin/env python3
"""Strict subprocess qualification; candidate observations require independent checking."""
import argparse
import ctypes
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import time
import uuid

class GateError(Exception):
    pass

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise GateError("duplicate JSON key: " + key)
        result[key] = value
    return result

def read_json(path):
    try:
        return json.loads(Path(path).read_text(), object_pairs_hook=pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(GateError("non-finite JSON")))
    except (ValueError, OSError) as exc:
        raise GateError("cannot read JSON " + str(path) + ": " + str(exc)) from exc

def strings(value, name, nonempty=True):
    if not isinstance(value, list) or (nonempty and not value):
        raise GateError(name + " must be a nonempty list" if nonempty else name + " must be a list")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise GateError(name + " contains an empty/non-string identity")
    if len(value) != len(set(value)):
        raise GateError(name + " contains duplicates")
    return value

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def immutable(path, data):
    if path.exists():
        if path.is_symlink() or path.read_bytes() != data:
            raise GateError("immutable campaign snapshot changed: " + path.name)
        return
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    path.chmod(0o444)

def snapshot(campaign, original, category, original_label=None):
    original = Path(original)
    if not original.is_file() or original.is_symlink():
        raise GateError("missing or symlink input: " + str(original))
    data = original.read_bytes()
    relative = Path(category) / digest(data) / original.name
    target = campaign / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    immutable(target, data)
    return {"path": relative.as_posix(), "original_path": original_label or str(original.resolve()),
            "sha256": digest(data), "size": len(data)}

def children():
    return {int(value) for value in Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().split()}

def source_inventory(root, registration, output_dir):
    found = {}
    for relative in registration['source_roots']:
        base = (root / relative).resolve()
        if not base.is_relative_to(root) or not base.is_dir():
            raise GateError('source root is absent or escapes workspace: ' + relative)
        for path in base.rglob('*'):
            if path.is_relative_to(output_dir) or any(part in ('.git', '__pycache__') for part in path.relative_to(root).parts) or path.suffix in ('.pyc', '.pyo'):
                continue
            if path.is_symlink():
                raise GateError('source inventory contains symlink: ' + str(path))
            if path.is_file():
                data = path.read_bytes()
                found[str(path.resolve())] = {'original_path': str(path.resolve()), 'sha256': digest(data), 'size': len(data)}
    return [found[key] for key in sorted(found)]

def worktree_inventory(root, inventory, output_dir, commit):
    excluded = [str(output_dir.relative_to(root))] if output_dir.is_relative_to(root) else []
    entries = []
    diff_sha256 = None
    if commit:
        changed = subprocess.run(['git', '-C', str(root), 'diff', '--name-only', 'HEAD', '-z'], capture_output=True, check=True).stdout.split(b'\0')
        untracked = subprocess.run(['git', '-C', str(root), 'ls-files', '--others', '--exclude-standard', '-z'], capture_output=True, check=True).stdout.split(b'\0')
        diff = subprocess.run(['git','-C',str(root),'diff','--binary','--no-ext-diff','--no-textconv','--no-color','HEAD','--'], capture_output=True, check=True).stdout
        diff_sha256 = digest(diff)
        status = {value.decode(): 'modified' for value in changed if value}
        status.update({value.decode(): 'untracked' for value in untracked if value})
        for relative, kind in sorted(status.items()):
            path = root / relative
            if path.is_relative_to(output_dir) or '__pycache__' in path.parts or path.suffix in ('.pyc', '.pyo'):
                continue
            if path.is_symlink():
                raise GateError('worktree contains changed symlink')
            if path.is_file():
                data = path.read_bytes()
                entries.append({'path': relative, 'status': kind, 'sha256': digest(data), 'size': len(data)})
            elif not path.exists():
                entries.append({'path': relative, 'status': 'deleted', 'sha256': None, 'size': None})
    else:
        entries = [{'path': str(Path(item['original_path']).relative_to(root)), 'status': 'file', 'sha256': item['sha256'], 'size': item['size']} for item in inventory]
        entries.sort(key=lambda item: item['path'])
    return {'kind': 'git' if commit else 'directory', 'entries': entries, 'excluded': excluded, 'digest': digest(canonical(entries)), 'diff_sha256': diff_sha256}

def run_child(argv, root, timeout, env):
    if not sys.platform.startswith('linux') or ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise GateError('Linux child-subreaper capability is required for owned-process cleanup')
    executable = str((root / argv[0]).resolve()) if '/' in argv[0] and not Path(argv[0]).is_absolute() else shutil.which(argv[0], path=env.get('PATH'))
    if executable is None and Path(argv[0]).is_file():
        executable = str(Path(argv[0]).resolve())
    executable_identity = None
    if executable:
        executable_path = Path(executable).resolve()
        executable_data = executable_path.read_bytes()
        executable_identity = {'path': str(executable_path), 'sha256': digest(executable_data), 'size': len(executable_data)}
    original_children = children()
    start, stamp = time.monotonic_ns(), utc()
    result = {"argv": argv, "cwd": str(root), "exit_code": None, "timed_out": False,
              "started_at": stamp, "ended_at": stamp, "duration_ns": 0}
    output, error = b"", b""
    try:
        child = subprocess.Popen(argv, cwd=root, env=env, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        try:
            output, error = child.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            result["timed_out"] = True
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            time.sleep(0.15)
            # Kill the group even if its leader already exited: descendants may ignore TERM.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            output, error = child.communicate(timeout=5)
        result["exit_code"] = child.returncode
    except subprocess.TimeoutExpired as exc:
        # A detached orphan may retain the pipe after group termination. Always reach subreaper cleanup.
        result['timed_out'] = True
        result['exit_code'] = child.poll()
        output, error = exc.output or b'', exc.stderr or b''
    except OSError as exc:
        result["exit_code"] = 127
        error = str(exc).encode()
    finally:
        result["ended_at"] = utc()
        result["duration_ns"] = time.monotonic_ns() - start
    leaked = set()
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        owned = children() - original_children
        if not owned:
            break
        leaked.update(owned)
        for pid in owned:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        for pid in owned:
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass
        time.sleep(0.02)
    if result['timed_out']:
        try:
            output, error = child.communicate(timeout=2)
            result['exit_code'] = child.returncode
        except subprocess.TimeoutExpired as exc:
            output, error = exc.output or output, exc.stderr or error
            result['output_incomplete'] = True
    result['executable'] = executable_identity
    result['leaked_descendants'] = sorted(leaked)
    result['remaining_descendants'] = sorted(children() - original_children)
    result['duration_ns'] = time.monotonic_ns() - start
    result['ended_at'] = utc()
    return result, output, error

def load_registry(path):
    registry = read_json(path)
    if type(registry.get("schema_version")) is not int or registry.get("schema_version") != 1 or not isinstance(registry.get("cases"), dict):
        raise GateError("unsupported registry")
    if not registry["cases"] or not isinstance(registry.get("suites"), dict):
        raise GateError("empty cases or missing suites")
    for case_id, case in registry["cases"].items():
        if not isinstance(case_id, str) or re.fullmatch(r"V-[0-9]{3}", case_id) is None or not isinstance(case, dict):
            raise GateError("malformed case registration")
        strings(case.get("full_assertion_ids", []), "full assertion inventory", False)
    for suite, ids in registry["suites"].items():
        strings(ids, "suite " + suite, False)
        if any(case_id not in registry["cases"] for case_id in ids):
            raise GateError("suite contains unknown case")
    pattern = registry.get("registration_glob", "registrations/*.json")
    if not isinstance(pattern, str) or Path(pattern).is_absolute() or ".." in Path(pattern).parts:
        raise GateError("unsafe registration glob")
    variants = {}
    for registration_path in sorted(path.parent.glob(pattern)):
        registration = read_json(registration_path)
        if type(registration.get("schema_version")) is not int or registration.get("schema_version") != 1:
            raise GateError("unsupported registration schema")
        variant = registration.get("variant")
        if not isinstance(variant, str) or not variant or variant in variants:
            raise GateError("missing or duplicate variant")
        task = registration.get('task')
        if not isinstance(task, str) or re.fullmatch(r'[0-9]+\.[0-9]+', task) is None:
            raise GateError('invalid registered task identity')
        cases = strings(registration.get("cases"), "registration cases")
        if any(case not in registry["cases"] for case in cases):
            raise GateError("unknown registered case")
        strings(registration.get("assertion_ids"), "registered assertions")
        if not isinstance(registration.get('argv'), list) or not registration['argv'] or any(not isinstance(arg, str) or not arg for arg in registration['argv']):
            raise GateError('invalid probe argv')
        strings(registration.get('source_files'), 'reviewed source files')
        strings(registration.get('source_roots'), 'reviewed source roots')
        for key in ("fixtures", "required_env", "actions", "required_artifacts"):
            strings(registration.get(key, []), key, False)
        if "cleanup_argv" in registration:
            if not isinstance(registration['cleanup_argv'], list) or not registration['cleanup_argv'] or any(not isinstance(arg, str) or not arg for arg in registration['cleanup_argv']):
                raise GateError('invalid cleanup argv')
        timeout = registration.get("timeout_seconds", 60)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= 604800:
            raise GateError("invalid child timeout")
        cleanup_timeout = registration.get('cleanup_timeout_seconds', 60)
        if isinstance(cleanup_timeout, bool) or not isinstance(cleanup_timeout, (int, float)) or not 0 < cleanup_timeout <= 604800:
            raise GateError('invalid cleanup timeout')
        resources = registration.get('resources', [])
        if not isinstance(resources, list) or any(not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'].strip() for item in resources):
            raise GateError('malformed resource inventory')
        if len({item['id'] for item in resources}) != len(resources):
            raise GateError('duplicate resource identity')
        variants[variant] = (registration, registration_path)
    return registry, variants

def validate_manifest(manifest, registration, registry):
    required = ("campaign_id", "registered_variant", "scope", "case_ids", "expected_assertion_ids",
                "approval", "inputs", "resources", "seed", "policy")
    if type(manifest.get("schema_version")) is not int or manifest.get("schema_version") != 1 or set(manifest) != set(required) | {"schema_version"}:
        raise GateError("incomplete or unsupported manifest")
    if not isinstance(manifest["campaign_id"], str) or not manifest["campaign_id"].strip():
        raise GateError("empty campaign identity")
    if manifest["scope"] not in ("task-component", "full-case", "campaign"):
        raise GateError("invalid qualification scope")
    if manifest["scope"] != registration.get("scope"):
        raise GateError("scope differs from registration")
    for field, registered in (("case_ids", "cases"), ("expected_assertion_ids", "assertion_ids")):
        strings(manifest[field], field)
        if manifest[field] != registration[registered]:
            raise GateError(field + " differs from exact registered inventory")
    approval = manifest["approval"]
    if not isinstance(approval, dict) or set(approval) - {"approved", "allowed_actions", "allow_retained_resources"} or approval.get("approved") is not True or ("allow_retained_resources" in approval and not isinstance(approval["allow_retained_resources"], bool)):
        raise GateError("campaign is not explicitly approved")
    actions = strings(approval.get("allowed_actions"), "approved actions", False)
    if not set(registration.get("actions", [])).issubset(actions):
        raise GateError("probe action not approved")
    if not isinstance(manifest["inputs"], list) or not isinstance(manifest["resources"], list):
        raise GateError("inputs and resources must be lists")
    if any(not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'].strip() for item in manifest['resources']):
        raise GateError('malformed manifest resource inventory')
    if len({item['id'] for item in manifest['resources']}) != len(manifest['resources']):
        raise GateError('duplicate manifest resource identity')
    if canonical(manifest["resources"]) != canonical(registration.get("resources", [])):
        raise GateError("resource inventory differs from registration")
    if manifest["resources"] and not registration.get("cleanup_argv"):
        raise GateError("resource-bearing variant requires independent cleanup command")
    if isinstance(manifest["seed"], bool) or not isinstance(manifest["seed"], int) or not isinstance(manifest["policy"], dict):
        raise GateError("invalid seed or policy")
    if manifest["scope"] != "task-component":
        full = []
        for case in manifest["case_ids"]:
            inventory = registry["cases"][case].get("full_assertion_ids", [])
            if not inventory:
                raise GateError("full-case assertion inventory is not registered: " + case)
            full.extend(inventory)
        if len(full) != len(set(full)) or set(full) != set(manifest["expected_assertion_ids"]):
            raise GateError("full-case inventory is incomplete")

def parse_events(output):
    diagnostics, events, assertions, cleanup = [], [], [], []
    try:
        lines = output.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        return [], [], [], ["stdout is not valid UTF-8"]
    for line in lines:
        if not line.strip().startswith("{"):
            continue
        try:
            event = json.loads(line, object_pairs_hook=pairs,
                               parse_constant=lambda value: (_ for _ in ()).throw(GateError("non-finite event")))
        except (ValueError, GateError):
            diagnostics.append("malformed JSON event")
            continue
        if not isinstance(event, dict):
            diagnostics.append("malformed event object")
            continue
        if event.get("type") == "assertion":
            events.append(event)
            if not isinstance(event.get("id"), str) or not event["id"] or "expected" not in event or "actual" not in event:
                diagnostics.append("malformed assertion event")
                continue
            status = "PASS" if canonical(event["expected"]) == canonical(event["actual"]) else "FAIL"
            assertions.append({"id": event["id"], "expected": event["expected"], "actual": event["actual"], "status": status})
        elif event.get("type") == "cleanup":
            events.append(event)
            cleanup.append(event)
    return assertions, cleanup, events, diagnostics

def execute(args, root, registry_path, registry, registration, registration_path, manifest_path, manifest):
    trusted_checker = Path(__file__).resolve().with_name('check-evidence.py')
    if args.checker and Path(args.checker).resolve() != trusted_checker:
        raise GateError('alternate checker is not trusted; canonical sibling checker required')
    preliminary_git = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], capture_output=True, timeout=10)
    preliminary_commit = preliminary_git.stdout.decode().strip() if preliminary_git.returncode == 0 else None
    base_dir = root / 'artifacts/hyperfide/tasks' / registration.get('task', manifest['campaign_id'])
    exclude_dir = Path(args.output_dir).resolve() if args.output_dir else base_dir
    if root == exclude_dir or root.is_relative_to(exclude_dir):
        raise GateError('evidence output cannot contain the workspace')
    for relative in registration['source_files'] + registration['source_roots']:
        if (root / relative).resolve().is_relative_to(exclude_dir):
            raise GateError('evidence exclusion overlaps declared implementation source')
    if args.output_dir and exclude_dir.exists() and any(exclude_dir.iterdir()):
        allowed = {'.lock', 'manifest.json', 'registry.json', 'registration.json', 'receipts', 'artifacts', 'sources', 'inputs', 'checks', 'evidence-index.json'}
        if any(path.name not in allowed for path in exclude_dir.iterdir()) or not all((exclude_dir / name).is_file() for name in ['manifest.json', 'registry.json', 'registration.json']):
            raise GateError('existing output directory is not dedicated campaign evidence')
    initial_inventory = source_inventory(root, registration, exclude_dir)
    initial_worktree = worktree_inventory(root, initial_inventory, exclude_dir, preliminary_commit)
    identity = {'head': preliminary_commit, 'manifest': digest(manifest_path.read_bytes()), 'registry': digest(registry_path.read_bytes()), 'registration': digest(registration_path.read_bytes()), 'inventory': initial_inventory, 'worktree': initial_worktree}
    campaign_key = digest(canonical(identity))
    output_dir = Path(args.output_dir).resolve() if args.output_dir else base_dir / 'campaigns' / campaign_key
    inventory_exclusion = exclude_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    if output_dir.is_symlink():
        raise GateError("symlink campaign directory")
    with (output_dir / ".lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for name, original in (("manifest.json", manifest_path), ("registry.json", registry_path), ("registration.json", registration_path)):
            immutable(output_dir / name, original.read_bytes())
        receipt_id = str(uuid.uuid4())
        receipts_dir, artifacts_dir = output_dir / "receipts", output_dir / "artifacts" / receipt_id
        receipts_dir.mkdir(exist_ok=True)
        artifacts_dir.mkdir(parents=True)
        previous = []
        for path in receipts_dir.glob("*.json"):
            previous.append(read_json(path))
        previous.sort(key=lambda item: item.get("sequence", 0))
        if [item.get("sequence") for item in previous] != list(range(1, len(previous) + 1)):
            raise GateError("invalid existing receipt sequence")
        source_files, inputs, diagnostics = [], [], []
        checker = trusted_checker
        source_paths = {Path(__file__).resolve(), checker, registration_path.resolve(), registry_path.resolve()}
        for argv in (registration["argv"], registration.get("cleanup_argv", [])):
            for arg in argv:
                path = Path(arg) if Path(arg).is_absolute() else root / arg
                if path.is_file() and path.suffix in (".py", ".js", ".mjs", ".json", ".sh"):
                    source_paths.add(path.resolve())
        before = {}
        try:
            if not checker.is_file():
                raise GateError("required independent checker is missing")
            for name in registration.get("required_env", []):
                if not os.environ.get(name):
                    raise GateError("required credential/environment variable absent: " + name)
            pins = {}
            for item in manifest["inputs"]:
                if not isinstance(item, dict) or set(item) != {"path", "sha256", "size"}:
                    raise GateError("malformed input pin")
                label = item["path"]
                if not isinstance(label, str) or not label.strip() or label in pins:
                    raise GateError("duplicate or empty input pin")
                if not isinstance(item['sha256'], str) or len(item['sha256']) != 64 or any(char not in '0123456789abcdef' for char in item['sha256']) or isinstance(item['size'], bool) or not isinstance(item['size'], int) or item['size'] < 0:
                    raise GateError('invalid input hash/size pin')
                pins[label] = item
            for required_source in registration['source_files']:
                if required_source not in pins:
                    raise GateError('reviewed implementation source lacks content pin: ' + required_source)
            for fixture in registration.get("fixtures", []):
                fixture_path = root / fixture
                if not fixture_path.is_file():
                    raise GateError("required fixture absent: " + fixture)
                if fixture not in pins:
                    raise GateError("required fixture lacks content pin: " + fixture)
            for label, pin in pins.items():
                path = Path(label) if Path(label).is_absolute() else root / label
                record = snapshot(output_dir, path, "inputs", label)
                if record["sha256"] != pin["sha256"] or record["size"] != pin["size"]:
                    raise GateError("input digest/size mismatch: " + label)
                inputs.append(record)
                source_paths.add(path.resolve())
            inventory = source_inventory(root, registration, inventory_exclusion)
            source_paths.update(Path(item['original_path']) for item in inventory)
            for path in sorted(source_paths):
                record = snapshot(output_dir, path, "sources")
                source_files.append(record)
                before[str(path)] = record["sha256"]
        except GateError as exc:
            diagnostics.append(str(exc))
        git = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, timeout=10)
        commit = git.stdout.decode().strip() if git.returncode == 0 else None
        dirty = None
        if commit:
            state = subprocess.run(["git", "-C", str(root), "status", "--porcelain"], capture_output=True, timeout=10)
            dirty = bool(state.stdout) if state.returncode == 0 else None
        inventory = source_inventory(root, registration, inventory_exclusion)
        worktree = worktree_inventory(root, inventory, inventory_exclusion, commit)
        source = {'commit': commit, 'dirty': dirty, 'workspace': str(root), 'unversioned': commit is None, 'files': source_files,
                  'inventory': inventory, 'inventory_sha256': digest(canonical(inventory)), 'inventory_excluded': str(inventory_exclusion), 'worktree': worktree, 'environment': {'platform': sys.platform, 'python_version': sys.version, 'provenance_scope': 'declared-source-and-executables; complete preparation qualification requires task11.1'}}
        if inventory != initial_inventory or worktree != initial_worktree or commit != preliminary_commit:
            diagnostics.append('workspace identity changed during campaign preparation')
        if commit is None and manifest["scope"] != "task-component":
            diagnostics.append("full qualification requires a versioned source commit")
        blocked = bool(diagnostics)
        env = os.environ.copy()
        env.update({"HYPERFIDE_CAMPAIGN_DIR": str(output_dir), "HYPERFIDE_RECEIPT_ID": receipt_id,
                    "HYPERFIDE_RANDOM_SEED": str(manifest["seed"]), "HYPERFIDE_CASE_IDS": json.dumps(manifest["case_ids"])})
        command = {"argv": registration["argv"], "cwd": str(root), "exit_code": None, "timed_out": False,
                   "started_at": utc(), "ended_at": utc(), "duration_ns": 0}
        stdout, stderr, cleanup_command = b"", b"", None
        if not blocked:
            command, stdout, stderr = run_child(registration["argv"], root, registration.get("timeout_seconds", 60), env)
            if registration.get("cleanup_argv"):
                cleanup_command, extra_out, extra_err = run_child(registration["cleanup_argv"], root, registration.get("cleanup_timeout_seconds", 60), env)
                stdout += b"\n" + extra_out
                stderr += b"\n" + extra_err
        assertions, cleanup_events, events, event_diagnostics = parse_events(stdout)
        diagnostics.extend(event_diagnostics)
        ids = [item["id"] for item in assertions]
        if len(ids) != len(set(ids)) or set(ids) != set(registration["assertion_ids"]):
            diagnostics.append("executed assertion inventory differs from exact registration")
        if any(item["status"] != "PASS" for item in assertions):
            diagnostics.append("one or more behavioural assertions failed")
        if command["exit_code"] != 0 or command["timed_out"] or command.get("leaked_descendants") or command.get("remaining_descendants"):
            diagnostics.append("probe failed, was unavailable, or timed out")
        cleanup = {"resources": [], "complete": False, "command": cleanup_command}
        if len(cleanup_events) != 1:
            diagnostics.append("exactly one observed cleanup event is required")
        else:
            event = cleanup_events[0]
            cleanup.update({"resources": event.get("resources", []), "complete": event.get("complete") is True})
            if not isinstance(cleanup["resources"], list) or not cleanup["complete"]:
                diagnostics.append("cleanup is incomplete")
            expected_ids = [item.get("id") for item in manifest["resources"]]
            actual_ids = [item.get("id") for item in cleanup["resources"] if isinstance(item, dict)] if isinstance(cleanup["resources"], list) else []
            if sorted(expected_ids) != sorted(actual_ids) or len(actual_ids) != len(set(actual_ids)):
                diagnostics.append("cleanup resource inventory mismatch")
            for resource in cleanup["resources"] if isinstance(cleanup["resources"], list) else []:
                if resource.get("status") == "deleted":
                    if resource.get("observed_absent") is not True or not resource.get("evidence_artifact"):
                        diagnostics.append("deleted resource lacks observed absence evidence")
                elif resource.get("status") == "retained":
                    if not resource.get("owner") or not resource.get("expiry") or manifest["approval"].get("allow_retained_resources") is not True:
                        diagnostics.append("retention lacks explicit policy/owner/expiry")
                else:
                    diagnostics.append("unresolved resource cleanup")
        if cleanup_command and (cleanup_command["exit_code"] != 0 or cleanup_command["timed_out"] or cleanup_command.get("leaked_descendants") or cleanup_command.get("remaining_descendants")):
            diagnostics.append("cleanup command failed")
        if source_inventory(root, registration, inventory_exclusion) != inventory or worktree_inventory(root, inventory, inventory_exclusion, commit) != worktree:
            diagnostics.append('source inventory/worktree changed during execution')
        for path, expected_hash in before.items():
            if not Path(path).is_file() or digest(Path(path).read_bytes()) != expected_hash:
                diagnostics.append("source/input changed during execution: " + path)
        artifacts = []
        for name, content, kind in (("stdout.log", stdout, "stdout"), ("stderr.log", stderr, "stderr"),
                                    ("events.jsonl", b"".join(canonical(event) + b"\n" for event in events), "events")):
            path = artifacts_dir / name
            immutable(path, content)
            artifacts.append({"path": str(path.relative_to(output_dir)), "sha256": digest(content), "size": len(content), "kind": kind, "complete": True})
        for relative in registration.get("required_artifacts", []):
            path = output_dir / relative
            if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(output_dir.resolve()):
                diagnostics.append("required artifact missing or unsafe: " + relative)
            else:
                data = path.read_bytes()
                artifacts.append({"path": relative, "sha256": digest(data), "size": len(data), "kind": "required", "complete": True})
        outcome = "BLOCKED" if blocked else "FAIL" if diagnostics else "PASS"
        receipt = {"schema_version": 1, "receipt_id": receipt_id, "sequence": len(previous) + 1,
                   "previous_seal": previous[-1]["seal"] if previous else None, "sealed_at": utc(),
                   "qualification_status": "CANDIDATE", "scope": manifest["scope"],
                   "registered_variant": manifest["registered_variant"], "task": registration.get("task"),
                   "case_ids": manifest["case_ids"], "selected_case_ids": args.case or manifest["case_ids"],
                   "expected_assertion_ids": manifest["expected_assertion_ids"], "assertions": assertions,
                   "outcome": outcome, "full_case_status": "INCOMPLETE" if manifest["scope"] == "task-component" else outcome,
                   "manifest_sha256": digest(manifest_path.read_bytes()), "registry_sha256": digest(registry_path.read_bytes()),
                   "registration_sha256": digest(registration_path.read_bytes()), "command": command, "source": source,
                   "inputs": inputs, "artifacts": artifacts, "cleanup": cleanup, "diagnostics": diagnostics}
        receipt["seal"] = digest(canonical(receipt))
        receipt_path = receipts_dir / (receipt_id + ".json")
        immutable(receipt_path, canonical(receipt) + b"\n")
        checks = output_dir / "checks"
        checks.mkdir(exist_ok=True)
        checked = None
        if checker.is_file():
            checked, check_out, check_err = run_child([sys.executable, str(checker), "--campaign", str(output_dir), "--receipt", receipt_id], root, 60, os.environ.copy())
            immutable(checks / (receipt_id + ".stdout.log"), check_out)
            immutable(checks / (receipt_id + ".stderr.log"), check_err)
            check_result = {"schema_version": 1, "receipt_id": receipt_id, "receipt_sha256": digest(receipt_path.read_bytes()),
                            "checker_sha256": digest(checker.read_bytes()), "command": checked,
                            "stdout_sha256": digest(check_out), "stderr_sha256": digest(check_err),
                            "status": "PASS" if checked["exit_code"] == 0 and not checked["timed_out"] and not checked.get("leaked_descendants") and not checked.get("remaining_descendants") else "FAIL"}
            check_result["seal"] = digest(canonical(check_result))
            immutable(checks / (receipt_id + ".json"), canonical(check_result) + b"\n")
        status = outcome if outcome != "PASS" else "PASS" if checked and checked["exit_code"] == 0 and not checked["timed_out"] and not checked.get("leaked_descendants") and not checked.get("remaining_descendants") else "FAIL"
        if status == "FAIL" and outcome == "PASS":
            diagnostics = ["independent checker rejected candidate; inspect checks artifacts"]
        index = {"schema_version": 1, "projection": True, "receipts": [{"receipt_id": item["receipt_id"], "sequence": item["sequence"], "seal": item["seal"]} for item in previous + [receipt]]}
        temporary = output_dir / (".index-" + receipt_id)
        temporary.write_bytes(canonical(index) + b"\n")
        os.replace(temporary, output_dir / "evidence-index.json")
        print(json.dumps({"status": status, "receipt_id": receipt_id, "campaign_dir": str(output_dir), "scope": manifest["scope"],
                          "full_case_status": receipt["full_case_status"], "diagnostics": diagnostics}))
        return 0 if status == "PASS" else 1

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    selector = parser.add_mutually_exclusive_group(required=True)
    selector.add_argument("--case", action="append")
    selector.add_argument("--task")
    selector.add_argument("--suite")
    selector.add_argument("--list-cases", action="store_true")
    parser.add_argument("--format", choices=("json", "text"), default="json")
    parser.add_argument("--manifest")
    parser.add_argument("--registry", default="tests/hyperfide/registry.json")
    parser.add_argument("--root", default=os.getcwd())
    parser.add_argument("--output-dir")
    parser.add_argument("--checker")
    args = parser.parse_args()
    try:
        root = Path(args.root).resolve()
        registry_path = Path(args.registry) if Path(args.registry).is_absolute() else root / args.registry
        registry, variants = load_registry(registry_path)
        if args.list_cases:
            cases = [{"id": key, **value, "registered_variants": [name for name, (reg, _) in variants.items() if key in reg["cases"]]} for key, value in registry["cases"].items()]
            print(json.dumps({"schema_version": 1, "cases": cases}) if args.format == "json" else "\n".join(item["id"] for item in cases))
            return 0
        if not args.manifest:
            raise GateError("execution requires an immutable manifest")
        manifest_path = Path(args.manifest).resolve()
        manifest = read_json(manifest_path)
        variant = manifest.get("registered_variant")
        if variant not in variants:
            raise GateError("unknown registered variant")
        registration, registration_path = variants[variant]
        validate_manifest(manifest, registration, registry)
        if args.case:
            strings(args.case, "selected cases")
            if any(case not in registry["cases"] or case not in registration["cases"] for case in args.case):
                raise GateError("unknown or unrelated selected case")
        elif args.task is not None:
            if not args.task.strip() or args.task != registration.get("task"):
                raise GateError("unknown or unrelated selected task")
        elif args.suite is not None:
            if not args.suite.strip() or args.suite not in registry["suites"] or not registry["suites"][args.suite]:
                raise GateError("unknown or empty selected suite")
            if registry["suites"][args.suite] != registration["cases"]:
                raise GateError("suite must match exact registered variant case inventory")
        return execute(args, root, registry_path, registry, registration, registration_path, manifest_path, manifest)
    except (GateError, OSError, ValueError, subprocess.SubprocessError) as exc:
        print(json.dumps({"status": "BLOCKED", "diagnostics": [str(exc)]}))
        return 2

if __name__ == "__main__":
    sys.exit(main())
