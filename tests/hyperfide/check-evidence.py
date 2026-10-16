#!/usr/bin/env python3
"""Independently verify immutable qualification observations; never execute a probe.

Receipt seals detect inconsistency. They are not authentication without an external
trusted anchor. A successful check validates the selected candidate observations;
it does not promote a task component to its parent case or programme qualification.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid


class InvalidEvidence(Exception):
    pass


def require(condition, message):
    if not condition:
        raise InvalidEvidence(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON object key")
        result[key] = value
    return result


def decode(value):
    return json.loads(value, object_pairs_hook=unique_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(InvalidEvidence("non-finite JSON number")))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest_file(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def load(path):
    require(path.is_file(), "required JSON file is missing: " + path.name)
    value = decode(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), "JSON document must be an object")
    return value


def identifiers(value, label, empty=False):
    require(isinstance(value, list), label + " must be a list")
    require(all(isinstance(item, str) and item for item in value), label + " contains an invalid identity")
    require(len(set(value)) == len(value), label + " contains duplicate identities")
    require(empty or bool(value), label + " is empty")
    return value


def positive_integer(value, label, zero=False):
    require(type(value) is int and value >= (0 if zero else 1), label + " is not a valid integer")


def sha(value, label):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value), label + " is not a SHA-256 digest")


def relative_file(root, relative):
    require(isinstance(relative, str) and relative, "artifact path is missing")
    name = Path(relative)
    require(not name.is_absolute() and ".." not in name.parts, "artifact path escapes campaign")
    current = root
    for component in name.parts:
        current = current / component
        require(not current.is_symlink(), "symbolic links are forbidden in campaign inputs")
    require(current.is_file(), "required artifact is missing: " + relative)
    require(current.resolve().is_relative_to(root), "artifact path escapes campaign")
    return current


def checked_file(root, record):
    require(isinstance(record, dict), "artifact record is not an object")
    sha(record.get("sha256"), "artifact hash")
    positive_integer(record.get("size"), "artifact size", zero=True)
    path = relative_file(root, record.get("path"))
    actual_hash, actual_size = digest_file(path)
    require(actual_hash == record["sha256"] and actual_size == record["size"], "artifact content/hash/size mismatch: " + record["path"])
    return path


def timestamp(value):
    require(isinstance(value, str) and value.endswith(("Z", "+00:00")), "timestamp must identify UTC")
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


def command_shape(command):
    require(isinstance(command, dict), "command identity is missing")
    argv = command.get("argv")
    require(isinstance(argv, list) and argv and all(isinstance(arg, str) and arg for arg in argv), "command argv is invalid")
    require(isinstance(command.get("cwd"), str) and Path(command["cwd"]).is_absolute(), "command cwd must be absolute")
    require(command.get("exit_code") is None or type(command["exit_code"]) is int, "invalid command exit status")
    require(type(command.get("timed_out")) is bool, "command timeout observation missing")
    positive_integer(command.get("duration_ns"), "monotonic command duration", zero=True)
    require(timestamp(command.get("ended_at")) >= timestamp(command.get("started_at")), "command timestamp order is invalid")



def command_pass(command):
    require(command["exit_code"] == 0 and command["timed_out"] is False, "command failed or timed out")
    require(command.get("leaked_descendants") == [] and command.get("remaining_descendants") == [], "command left or leaked descendant processes")
    executable = command.get("executable")
    require(isinstance(executable, dict), "actual executable identity is missing")
    executable_path = executable.get("path")
    require(isinstance(executable_path, str) and Path(executable_path).is_absolute(), "executable path is not absolute")
    path = Path(executable_path)
    require(path.is_file() and not path.is_symlink(), "actual executable is absent or symbolic")
    sha(executable.get("sha256"), "actual executable hash")
    positive_integer(executable.get("size"), "actual executable size")
    require(digest_file(path) == (executable["sha256"], executable["size"]), "actual executable bytes changed")
    argv0 = command["argv"][0]
    if "/" in argv0:
        resolved = (Path(command["cwd"]) / argv0).resolve()
    else:
        found = shutil.which(argv0)
        require(found is not None, "registered executable cannot be resolved")
        resolved = Path(found).resolve()
    require(resolved == path.resolve(), "actual executable differs from command identity")


def observed_events(path):
    result = []
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                event = decode(stripped)
            except (ValueError, InvalidEvidence):
                require(not stripped.startswith("{"), "malformed JSON observation in stdout")
                continue
            if isinstance(event, dict) and event.get("type") in ("assertion", "cleanup"):
                result.append(event)
    return result


def verify_receipt_integrity(root, receipt, manifest_hash, registry_hash, registration_hash):
    require(type(receipt.get("schema_version")) is int and receipt["schema_version"] == 1, "unsupported receipt schema")
    require(receipt.get("qualification_status") == "CANDIDATE", "receipt cannot self-qualify")
    try:
        require(str(uuid.UUID(receipt.get("receipt_id", ""))) == receipt["receipt_id"], "receipt UUID is not canonical")
    except (ValueError, TypeError, AttributeError):
        raise InvalidEvidence("receipt UUID is invalid")
    positive_integer(receipt.get("sequence"), "receipt sequence")
    timestamp(receipt.get("sealed_at"))
    sha(receipt.get("seal"), "receipt seal")
    unsigned = {key: value for key, value in receipt.items() if key != "seal"}
    require(hashlib.sha256(canonical(unsigned)).hexdigest() == receipt["seal"], "receipt seal mismatch")
    for name, expected in (("manifest_sha256", manifest_hash), ("registry_sha256", registry_hash), ("registration_sha256", registration_hash)):
        require(receipt.get(name) == expected, name + " mismatch")
    require(receipt.get("outcome") in ("PASS", "FAIL", "BLOCKED"), "unknown observed outcome")
    command_shape(receipt.get("command"))
    artifacts = receipt.get("artifacts")
    require(isinstance(artifacts, list), "artifact inventory missing")
    artifact_map = {}
    kinds = {}
    for record in artifacts:
        path = checked_file(root, record)
        require(record.get("complete") is True, "incomplete artifact")
        require(record["path"] not in artifact_map, "duplicate artifact path")
        artifact_map[record["path"]] = path
        kind = record.get("kind")
        require(isinstance(kind, str) and kind, "artifact kind is missing")
        if kind in ("stdout", "stderr", "events"):
            require(kind not in kinds, "duplicate required artifact kind")
            kinds[kind] = path
    require(set(kinds) == {"stdout", "stderr", "events"}, "complete stdout/stderr/events artifacts required")
    events = observed_events(kinds["stdout"])
    disk_events = []
    for line in kinds["events"].read_text(encoding="utf-8").splitlines():
        require(bool(line.strip()), "empty event record")
        event = decode(line)
        require(isinstance(event, dict) and event.get("type") in ("assertion", "cleanup"), "unknown durable event type")
        disk_events.append(event)
    require(canonical(events) == canonical(disk_events), "stdout observations differ from durable events")
    assertions = receipt.get("assertions")
    require(isinstance(assertions, list), "assertion observations missing")
    reconstructed = []
    for event in events:
        if event["type"] == "assertion":
            require(all(key in event for key in ("id", "expected", "actual")), "assertion lacks expected/actual observations")
            reconstructed.append({"id": event["id"], "expected": event["expected"], "actual": event["actual"], "status": "PASS" if canonical(event["expected"]) == canonical(event["actual"]) else "FAIL"})
    require(canonical(assertions) == canonical(reconstructed), "receipt assertions differ from observed stdout")
    source = receipt.get("source")
    require(isinstance(source, dict) and isinstance(source.get("files"), list), "source identity inventory missing")
    for record in source["files"]:
        checked_file(root, record)
    require(isinstance(receipt.get("inputs"), list), "input identity inventory missing")
    for record in receipt["inputs"]:
        checked_file(root, record)
    cleanup = receipt.get("cleanup")
    require(isinstance(cleanup, dict) and isinstance(cleanup.get("resources"), list) and type(cleanup.get("complete")) is bool, "cleanup inventory malformed")
    if cleanup.get("command") is not None:
        command_shape(cleanup["command"])
    return events, artifact_map



def source_inventory(workspace, registration, campaign):
    roots = identifiers(registration.get("source_roots"), "reviewed source roots")
    candidates = set()
    for relative in roots:
        require(not Path(relative).is_absolute() and ".." not in Path(relative).parts, "source root escapes workspace")
        directory = workspace / relative
        require(directory.is_dir() and not directory.is_symlink(), "reviewed source root missing or symbolic")
        for path in directory.rglob("*"):
            if any(part in (".git", "__pycache__") for part in path.relative_to(workspace).parts):
                continue
            if path.suffix in (".pyc", ".pyo") or path.is_relative_to(campaign):
                continue
            require(not path.is_symlink(), "symbolic source inventory entry")
            if path.is_file():
                candidates.add(path.resolve())
    return [{"original_path": str(path), "sha256": digest_file(path)[0], "size": digest_file(path)[1]} for path in sorted(candidates, key=str)]


def worktree_inventory(workspace, campaign, commit, inventory):
    excluded = [str(campaign.relative_to(workspace))] if campaign.is_relative_to(workspace) else []
    entries = []
    diff_sha256 = None
    if commit is not None:
        def git(arguments):
            result = subprocess.run(["git", "-C", str(workspace)] + arguments, capture_output=True, timeout=30)
            require(result.returncode == 0, "cannot independently inspect Git worktree")
            return result.stdout
        changed = set(filter(None, git(["diff", "--name-only", "-z", "HEAD", "--"]).decode("utf-8").split("\0")))
        untracked = set(filter(None, git(["ls-files", "--others", "--exclude-standard", "-z"]).decode("utf-8").split("\0")))
        for relative in sorted(changed | untracked):
            if "__pycache__" in Path(relative).parts or Path(relative).suffix in (".pyc", ".pyo"):
                continue
            path = workspace / relative
            require(not Path(relative).is_absolute() and ".." not in Path(relative).parts, "Git inventory path escapes workspace")
            if path.is_relative_to(campaign):
                continue
            require(not path.is_symlink(), "symbolic Git worktree entry")
            if not path.exists():
                entries.append({"path": relative, "status": "deleted", "sha256": None, "size": None})
            else:
                require(path.is_file(), "Git worktree entry is not a regular file")
                digest, size = digest_file(path)
                entries.append({"path": relative, "status": "modified" if relative in changed else "untracked", "sha256": digest, "size": size})
        diff_sha256 = hashlib.sha256(git(["diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-color", "HEAD", "--"])).hexdigest()
        kind = "git"
    else:
        kind = "directory"
        entries = [{"path": str(Path(item["original_path"]).relative_to(workspace)), "status": "file", "sha256": item["sha256"], "size": item["size"]} for item in inventory]
        entries.sort(key=lambda item: item["path"])
    return {"kind": kind, "entries": entries, "excluded": excluded, "digest": hashlib.sha256(canonical(entries)).hexdigest(), "diff_sha256": diff_sha256}


def verify_selected(root, receipt, manifest, registry, registration, events, artifact_map):
    require(receipt["outcome"] == "PASS", "selected observations are " + receipt["outcome"])
    require(manifest.get("approval", {}).get("approved") is True, "campaign is not approved")
    scope = manifest.get("scope")
    require(scope in ("task-component", "full-case", "campaign"), "unknown evidence scope")
    require(receipt.get("scope") == scope == registration.get("scope"), "evidence scope differs from pinned registration")
    require(receipt.get("registered_variant") == manifest.get("registered_variant") == registration.get("variant"), "variant identity mismatch")
    require(receipt.get("task") == registration.get("task"), "task identity mismatch")
    expected = identifiers(registration.get("assertion_ids"), "registered assertions")
    require(manifest.get("expected_assertion_ids") == expected == receipt.get("expected_assertion_ids"), "assertion inventory differs from pinned manifest/registration")
    case_ids = identifiers(registration.get("cases"), "registered cases")
    require(manifest.get("case_ids") == case_ids == receipt.get("case_ids"), "case inventory mismatch")
    selected = identifiers(receipt.get("selected_case_ids"), "selected cases")
    require(set(selected).issubset(case_ids), "selected case is not registered")
    require(isinstance(registry.get("cases"), dict) and all(case in registry["cases"] for case in case_ids), "unknown canonical case")
    observed = identifiers([item.get("id") for item in receipt["assertions"]], "observed assertions")
    require(observed == expected, "assertion coverage/order is incomplete or unexpected")
    require(all(item.get("status") == "PASS" and canonical(item["expected"]) == canonical(item["actual"]) for item in receipt["assertions"]), "an observed assertion failed")
    if scope == "task-component":
        require(receipt.get("full_case_status") == "INCOMPLETE", "component receipt attempts to promote parent case")
    elif scope == "full-case":
        complete_inventory = []
        for case in case_ids:
            full = identifiers(registry["cases"][case].get("full_assertion_ids"), "full-case assertion inventory")
            complete_inventory.extend(full)
        require(set(complete_inventory) == set(expected), "full-case obligations are incomplete")
        require(receipt.get("full_case_status") == "PASS", "full-case status is inconsistent")
    else:
        raise InvalidEvidence("campaign closure checker/required inventory is not registered by bootstrap")
    command = receipt["command"]
    require(command["argv"] == registration.get("argv"), "executed command differs from registration")
    command_pass(command)
    for required in registration.get("required_artifacts", []):
        require(required in artifact_map, "required registered artifact is absent")
    source = receipt["source"]
    require(isinstance(source.get("workspace"), str) and Path(source["workspace"]).is_absolute(), "source workspace is invalid")
    workspace = Path(source["workspace"])
    require(command["cwd"] == str(workspace), "command source workspace mismatch")
    require(type(source.get("dirty")) is bool or source.get("dirty") is None, "source dirty identity invalid")
    commit = source.get("commit")
    if commit is None:
        require(scope == "task-component" and source.get("unversioned") is True, "unversioned source cannot qualify this scope")
    else:
        require(isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit), "source commit identity invalid")
        require(source.get("unversioned") is False, "source version identity inconsistent")
        result = subprocess.run(["git", "-C", str(workspace), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=15)
        require(result.returncode == 0 and result.stdout.strip() == commit, "current source revision differs from candidate")
    originals = set()
    for record in source["files"]:
        original = record.get("original_path")
        require(isinstance(original, str) and Path(original).is_absolute(), "source original path is invalid")
        require(original not in originals, "duplicate source identity")
        originals.add(original)
        path = Path(original)
        require(path.is_file() and not path.is_symlink(), "current source file missing or symbolic")
        require(digest_file(path) == (record["sha256"], record["size"]), "current source bytes differ from candidate")
    require(str(Path(__file__).resolve()) in originals, "executing independent checker is not source-pinned")
    require(str(Path(__file__).resolve().with_name("qualify.py")) in originals, "canonical runner revision is not source-pinned")
    for argument in command["argv"]:
        if argument.endswith(".py"):
            require(str((workspace / argument).resolve()) in originals, "probe executable is not source-pinned")
    excluded_value = source.get("inventory_excluded")
    require(isinstance(excluded_value, str) and Path(excluded_value).is_absolute(), "source inventory exclusion is missing")
    exclusion = Path(excluded_value).resolve()
    task_identity = receipt.get("task")
    require(isinstance(task_identity, str) and re.fullmatch(r"[0-9]+\.[0-9]+", task_identity), "task identity cannot define an exclusion")
    default_exclusion = (workspace / "artifacts" / "hyperfide" / "tasks" / task_identity).resolve()
    require(exclusion == root or exclusion == default_exclusion, "source inventory exclusion is not an approved campaign location")
    require(root == exclusion or root.is_relative_to(exclusion), "campaign is outside declared source exclusion")
    require(exclusion != workspace and not workspace.is_relative_to(exclusion), "evidence output cannot exclude the source workspace")
    for declared_source in identifiers(registration.get("source_files"), "reviewed explicit source files"):
        require(not (workspace / declared_source).resolve().is_relative_to(exclusion), "evidence output contains a reviewed source file")
    for declared_root in identifiers(registration.get("source_roots"), "reviewed source roots"):
        require(not (workspace / declared_root).resolve().is_relative_to(exclusion), "evidence output contains a reviewed source root")
    discovered = source_inventory(workspace, registration, exclusion)
    require(canonical(source.get("inventory")) == canonical(discovered), "current source-root inventory differs from candidate")
    require(source.get("inventory_sha256") == hashlib.sha256(canonical(discovered)).hexdigest(), "source inventory digest mismatch")
    source_pins = {item["original_path"]: (item["sha256"], item["size"]) for item in source["files"]}
    require(all(source_pins.get(item["original_path"]) == (item["sha256"], item["size"]) for item in discovered), "source-root inventory is not completely snapshotted")
    require(canonical(source.get("worktree")) == canonical(worktree_inventory(workspace, exclusion, commit, discovered)), "actual dirty/untracked worktree content differs from candidate")
    manifest_inputs = manifest.get("inputs")
    require(isinstance(manifest_inputs, list), "manifest input inventory missing")
    pinned_inputs = {}
    for item in manifest_inputs:
        require(isinstance(item, dict) and isinstance(item.get("path"), str), "manifest input pin invalid")
        sha(item.get("sha256"), "manifest input hash")
        positive_integer(item.get("size"), "manifest input size", zero=True)
        require(item["path"] not in pinned_inputs, "duplicate manifest input pin")
        pinned_inputs[item["path"]] = (item.get("sha256"), item.get("size"))
    observed_inputs = {}
    for item in receipt["inputs"]:
        original = item.get("original_path")
        require(isinstance(original, str) and original not in observed_inputs, "duplicate/invalid input identity")
        original_file = (workspace / original).resolve()
        require(original_file.is_file() and digest_file(original_file) == (item["sha256"], item["size"]), "current fixture bytes differ from immutable inputs")
        observed_inputs[original] = (item["sha256"], item["size"])
    require(observed_inputs == pinned_inputs, "input inventory differs from immutable manifest")
    explicit_sources = identifiers(registration.get("source_files"), "reviewed explicit source files")
    for explicit in explicit_sources:
        require(explicit in pinned_inputs, "reviewed explicit source lacks immutable manifest input pin")
        require(str((workspace / explicit).resolve()) in originals, "reviewed explicit source is not snapshotted")
    for fixture in registration.get("fixtures", []):
        require(fixture in pinned_inputs, "required fixture lacks immutable input pin")
    cleanup = receipt["cleanup"]
    cleanup_events = [event for event in events if event["type"] == "cleanup"]
    require(len(cleanup_events) == 1, "exactly one complete cleanup observation required")
    require(cleanup_events[0].get("complete") is True and cleanup.get("complete") is True, "cleanup is incomplete")
    require(cleanup_events[0].get("resources") == cleanup["resources"], "cleanup receipt differs from observed inventory")
    configured = registration.get("cleanup_argv")
    if configured:
        require(cleanup.get("command") is not None and cleanup["command"]["argv"] == configured, "cleanup command differs from registration")
        command_pass(cleanup["command"])
    else:
        require(cleanup.get("command") is None, "undeclared cleanup command")
    resources = manifest.get("resources")
    require(isinstance(resources, list) and resources == registration.get("resources", []), "resource inventory differs from registration")
    def resource_id(item):
        return item if isinstance(item, str) else item.get("id") if isinstance(item, dict) else None
    required_ids = identifiers([resource_id(item) for item in resources], "declared resource IDs", empty=True)
    observed_ids = identifiers([resource_id(item) for item in cleanup["resources"]], "observed resource IDs", empty=True)
    require(set(required_ids) == set(observed_ids), "cleanup resource inventory is incomplete")
    for resource in cleanup["resources"]:
        require(isinstance(resource, dict), "cleanup resource observation malformed")
        if resource.get("status") == "deleted":
            require(resource.get("observed_absent") is True, "resource deletion is not observed")
            require(resource.get("evidence_artifact") in artifact_map, "resource inventory observation artifact absent")
        elif resource.get("status") == "retained":
            require(manifest.get("approval", {}).get("allow_retained_resources") is True, "retention is not approved")
            require(isinstance(resource.get("owner"), str) and bool(resource["owner"].strip()), "retained resource lacks owner")
            require(timestamp(resource.get("expiry")) > timestamp(receipt["sealed_at"]), "retained resource expiry is absent or already elapsed")
        else:
            raise InvalidEvidence("unresolved resource cleanup")


def check(args):
    root = Path(args.campaign).resolve()
    require(root.is_dir(), "campaign directory does not exist")
    manifest_path = relative_file(root, "manifest.json")
    if args.manifest:
        require(digest_file(Path(args.manifest)) == digest_file(manifest_path), "external manifest differs from immutable campaign manifest")
    registry_path = relative_file(root, "registry.json")
    registration_path = relative_file(root, "registration.json")
    manifest, registry, registration = load(manifest_path), load(registry_path), load(registration_path)
    for name, value in (("manifest", manifest), ("registry", registry), ("registration", registration)):
        require(type(value.get("schema_version")) is int and value["schema_version"] == 1, "unsupported " + name + " schema")
    receipt_dir = root / "receipts"
    require(receipt_dir.is_dir() and not receipt_dir.is_symlink(), "receipt inventory missing")
    files = list(receipt_dir.iterdir())
    require(files and all(path.suffix == ".json" and path.is_file() and not path.is_symlink() for path in files), "receipt inventory contains unknown or missing files")
    receipts = []
    seen = set()
    for path in files:
        receipt = load(path)
        require(path.stem == receipt.get("receipt_id"), "receipt filename identity mismatch")
        events, artifacts = verify_receipt_integrity(root, receipt, digest_file(manifest_path)[0], digest_file(registry_path)[0], digest_file(registration_path)[0])
        require(receipt["receipt_id"] not in seen, "duplicate receipt identity")
        seen.add(receipt["receipt_id"])
        receipts.append((receipt, events, artifacts, path))
    receipts.sort(key=lambda entry: entry[0]["sequence"])
    previous = None
    for sequence, (receipt, _, _, _) in enumerate(receipts, 1):
        require(receipt["sequence"] == sequence and receipt.get("previous_seal") == previous, "receipt chain has a gap, duplicate or changed predecessor")
        previous = receipt["seal"]
    selected = receipts[-1]
    if args.receipt:
        matches = [entry for entry in receipts if entry[0]["receipt_id"] == args.receipt]
        require(len(matches) == 1, "selected receipt identity is unknown")
        selected = matches[0]
    receipt, events, artifacts, path = selected
    verify_selected(root, receipt, manifest, registry, registration, events, artifacts)
    return {"schema_version": 1, "checked": True, "receipt_id": receipt["receipt_id"], "receipt_sha256": digest_file(path)[0], "scope": receipt["scope"], "observed_outcome": receipt["outcome"], "full_case_status": receipt["full_case_status"], "receipt_count": len(receipts), "seal_authentication": "unanchored-consistency-only"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign", required=True)
    parser.add_argument("--manifest")
    parser.add_argument("--receipt")
    args = parser.parse_args()
    try:
        result = check(args)
    except (InvalidEvidence, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({"schema_version": 1, "checked": False, "error": str(error)}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
