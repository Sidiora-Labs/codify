#!/usr/bin/env python3
"""Pinned deterministic fleet campaigns and an independent ownership oracle.

Simulation is evidence about declared schedules, never live frontier occupancy.
Adapters are explicit reviewed argv/pin contracts; this module grants no authority.
"""
from __future__ import annotations
import argparse
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import random
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid
import authority as current_authority

class CampaignError(Exception):
    pass

class Blocked(CampaignError):
    pass

def require(condition, message):
    if not condition:
        raise CampaignError(message)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()

def digest(value):
    return hashlib.sha256(value).hexdigest()

def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result

def decode(data):
    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(CampaignError("nonfinite JSON")))
    except (ValueError, TypeError) as exc:
        raise CampaignError("invalid JSON") from exc

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def timestamp(value):
    require(isinstance(value, str) and value.endswith(("Z", "+00:00")), "UTC timestamp required")
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CampaignError("invalid timestamp") from exc

def integer(value, name, minimum=1):
    require(type(value) is int and value >= minimum, name + " must be an integer >= " + str(minimum))
    return value

def authority_uuid(value, name='authority epoch'):
    require(isinstance(value,str) and re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',value),name+' must be an exact canonical UUID')
    return value

def sealed_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = canonical(value) + b"\n"
    # Receipt content never replaces another run's record.
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    path.chmod(0o444)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return {"path": str(path), "sha256": digest(data), "size": len(data)}

def pinned_file(pin, root):
    require(isinstance(pin, dict) and set(pin) == {"path", "sha256", "size"}, "exact file pin required")
    require(isinstance(pin["path"], str) and pin["path"], "file pin path required")
    require(isinstance(pin["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", pin["sha256"]), "SHA256 required")
    integer(pin["size"], "pin size", 0)
    path = Path(pin["path"])
    path = path if path.is_absolute() else Path(root) / path
    current = path
    while current != current.parent:
        require(not current.is_symlink(), "symlink input rejected")
        current = current.parent
    require(path.is_file(), "pinned input absent: " + pin["path"])
    data = path.read_bytes()
    require(len(data) == pin["size"] and digest(data) == pin["sha256"], "pinned input changed: " + pin["path"])
    return path.resolve(), data

def load_manifest(path, kind):
    path = Path(path).resolve()
    manifest = decode(path.read_bytes())
    require(isinstance(manifest, dict), "campaign manifest must be object")
    required = {"schema_version", "campaign_id", "kind", "source_revision", "source_manifest_digest", "approval", "profile", "inputs", "adapters"}
    optional = {"seeds", "stages", "faults", "slo", "auth_references", "main_host_id", "retained_resources"}
    require(required <= set(manifest) and not set(manifest) - required - optional, "campaign fields missing/unknown")
    require(manifest["schema_version"] == 1 and type(manifest["schema_version"]) is int and manifest["kind"] == kind, "campaign kind/schema mismatch")
    require(isinstance(manifest["campaign_id"], str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", manifest["campaign_id"]), "safe campaign id required")
    require(isinstance(manifest["source_revision"], str) and re.fullmatch(r"[0-9a-f]{40}", manifest["source_revision"]), "exact source revision required")
    require(isinstance(manifest["source_manifest_digest"], str) and re.fullmatch(r"sha256:[0-9a-f]{64}", manifest["source_manifest_digest"]), "exact integrated repository manifest digest required")
    require(manifest["approval"] == {"approved": True, "kind": kind}, "kind-specific campaign approval absent")
    profile = manifest["profile"]
    require(isinstance(profile, dict), "profile required")
    for name, value in (("sandboxes", 100), ("slots", 200), ("session_lifetimes", 1500)):
        integer(profile.get(name), name)
        require(profile[name] >= value, "large-run profile below declared " + name)
    if kind in {"deterministic", "faults"}:
        authority_uuid(profile.get("initial_authority_epoch"))
        authority_uuid(profile.get("deployment_id"), "deployment identity")
        require(profile.get("authority_contract") == "04-journal-v1", "current two-lineage durable journal contract required for campaign execution")
    integer(profile.get("virtual_hours"), "virtual_hours")
    require(profile["virtual_hours"] >= 72, "72 virtual hours required")
    require(isinstance(manifest["inputs"], dict) and {"planning", "graph"} <= set(manifest["inputs"]), "approved planning and graph inputs required")
    for name, pins in manifest["inputs"].items():
        require(isinstance(pins, list) and pins, "empty corpus: " + name)
        seen = set()
        for pin in pins:
            resolved, _ = pinned_file(pin, path.parent)
            require(str(resolved) not in seen, "duplicate corpus pin")
            seen.add(str(resolved))
    source_pins = manifest["inputs"].get("source_manifest")
    require(isinstance(source_pins, list) and len(source_pins) == 1, "one pinned actual integrated repository manifest required")
    _, source_bytes = pinned_file(source_pins[0], path.parent)
    repositories = decode(source_bytes)
    require(isinstance(repositories, list) and repositories, "integrated repository manifest cannot be empty")
    identities = []
    for repository in repositories:
        require(isinstance(repository, dict) and set(repository) == {"repository_id", "candidate_head", "input_manifest_digest"}, "actual19 integratedRepositoryManifest row required")
        require(all(isinstance(value, str) and value for value in repository.values()), "repository manifest identities required")
        require(re.fullmatch(r"[0-9a-f]{40}", repository["candidate_head"]), "exact published repository candidate head required")
        identities.append(repository["repository_id"])
    require(identities == sorted(set(identities)), "integrated repository manifest must be sorted and unique")
    require("sha256:" + digest(canonical(repositories)) == manifest["source_manifest_digest"], "integrated repository manifest digest mismatch")
    require(isinstance(manifest["adapters"], dict), "adapter map required")
    return manifest, path.parent


def observer_trust(manifest, root):
    pins=manifest['inputs'].get('observer_trust')
    require(isinstance(pins,list) and len(pins)==1,'one approved pinned observer trust document required')
    _,data=pinned_file(pins[0],root)
    trust=decode(data)
    required={'schema_version','controller_id','observer_id','key_id','roles','scope','public_key','verifier_executable'}
    require(isinstance(trust,dict) and set(trust)==required and trust['schema_version']==1,'exact observer trust configuration required')
    for key in ('controller_id','observer_id','key_id'):
        require(isinstance(trust[key],str) and bool(trust[key]),'observer trust identity missing')
    require(trust['observer_id']!=trust['controller_id'],'controller cannot be its own independent observer')
    scope=trust['scope']
    require(isinstance(scope,dict) and set(scope)=={'organisation_id','run_id','authority_epoch'},'exact trusted observer scope required')
    for key in ('organisation_id','run_id'):
        authority_uuid(scope[key],'trusted '+key)
    authority_uuid(scope['authority_epoch'],'trusted observer authority epoch')
    allowed={'DURABLE_READER','PROVIDER_READER','NATIVE_READER','MAIN_HOST_AUDITOR'}
    require(isinstance(trust['roles'],list) and trust['roles']==sorted(set(trust['roles'])) and set(trust['roles'])<=allowed,'approved independent reader roles required')
    _,key=pinned_file(trust['public_key'],root)
    require(key.startswith(b'-----BEGIN PUBLIC KEY-----'),'pinned public verification key required')
    executable,_=pinned_file(trust['verifier_executable'],root)
    require(executable.is_absolute() and os.access(executable,os.X_OK),'pinned crypto verifier executable required')
    return trust

def verify_observation(observation, manifest, root, request, roles, authority_epoch=None):
    """Signature grants no authority: approved identities/roles/scope are the anchor."""
    import tempfile
    trust=observer_trust(manifest,root)
    require(set(roles)<=set(trust['roles']),'observer lacks approved independent reader roles')
    require(isinstance(observation,dict),'signed independent observation required')
    proof=observation.get('provenance')
    fields={'reader_id','key_id','scope','roles','source_revision','source_manifest_digest','request_sha256','observation_sha256','signature_hex'}
    require(isinstance(proof,dict) and set(proof)==fields,'immutable signed read provenance required')
    require(proof['reader_id']==trust['observer_id'] and proof['key_id']==trust['key_id'],'unapproved independent observer identity/key')
    expected_scope = dict(trust['scope'])
    if authority_epoch is not None:
        expected_scope['authority_epoch'] = authority_uuid(authority_epoch)
    require(proof['scope']==expected_scope and proof['roles']==trust['roles'],'independent observer scope/roles mismatch')
    require(proof['source_revision']==manifest['source_revision'] and proof['source_manifest_digest']==manifest['source_manifest_digest'],'signed observer source mismatch')
    require(proof['request_sha256']==digest(canonical(request)+b'\n'),'signed observation is not bound to this exact campaign request')
    unsigned={key:value for key,value in observation.items()if key!='provenance'}
    require(proof['observation_sha256']==digest(canonical(unsigned)),'signed observation content changed')
    signature=proof['signature_hex']
    require(isinstance(signature,str) and re.fullmatch('[0-9a-f]{128}',signature),'Ed25519 signature required')
    signed={key:value for key,value in proof.items()if key!='signature_hex'}
    key,_=pinned_file(trust['public_key'],root)
    executable,_=pinned_file(trust['verifier_executable'],root)
    with tempfile.TemporaryDirectory(prefix='hyperfide-read-proof-') as directory:
        directory=Path(directory);message=directory/'message.json';sig=directory/'signature.bin'
        message.write_bytes(canonical(signed));sig.write_bytes(bytes.fromhex(signature))
        result=subprocess.run([str(executable),'pkeyutl','-verify','-pubin','-inkey',str(key),'-rawin','-in',str(message),'-sigfile',str(sig)],capture_output=True,timeout=10)
        require(result.returncode==0,'independent observation Ed25519 signature invalid')
    return True

def verify_full_receipt(pin, manifest, root, evidence=None, policy=None):
    path,content=pinned_file(pin,root);receipt=decode(content)
    require(isinstance(receipt,dict) and receipt.get('scope') in ('full-case','campaign') and receipt.get('full_case_status')=='PASS' and receipt.get('outcome')=='PASS','task-component or incomplete receipt cannot qualify a full obligation')
    require(isinstance(receipt.get('source'),dict) and receipt['source'].get('commit')==manifest['source_revision'],'full receipt source revision mismatch')
    cases=receipt.get('case_ids')
    require(isinstance(cases,list) and cases and len(set(cases))==len(cases) and receipt.get('selected_case_ids')==cases,'full receipt must exercise every declared case')
    require(path.parent.name=='receipts','canonical full campaign receipt path required')
    campaign=path.parent.parent;full_path=campaign/'manifest.json'
    require(full_path.is_file() and not full_path.is_symlink(),'canonical full manifest absent/unsafe')
    data=full_path.read_bytes();require(digest(data)==receipt.get('manifest_sha256'),'full manifest differs from pinned receipt')
    full=decode(data);actual_policy=full.get('policy',{})
    require(actual_policy.get('source_manifest_digest')==manifest['source_manifest_digest'],'full receipt repository source set mismatch')
    require(all(actual_policy.get(key)==value for key,value in (policy or {}).items()),'full receipt does not bind required campaign policy')
    checker=Path(__file__).resolve().parents[1]/'check-evidence.py'
    argv=[sys.executable,str(checker),'--campaign',str(campaign),'--receipt',path.stem]
    started=time.monotonic_ns();result=subprocess.run(argv,capture_output=True,timeout=60)
    if evidence is not None:
        sealed_write(Path(evidence)/(pin['sha256']+'.json'),{'argv':argv,'checker_sha256':digest(checker.read_bytes()),'duration_ns':time.monotonic_ns()-started,'exit_code':result.returncode,'stdout_hex':result.stdout.hex(),'stderr_hex':result.stderr.hex()})
    require(result.returncode==0,'canonical independent checker rejected full receipt')
    return receipt

def require_case_coverage(receipt, required_cases):
    cases=receipt.get("selected_case_ids")
    require(isinstance(cases,list) and set(required_cases)<=set(cases),"full receipt does not cover required case obligations")
    return True

def anchored_full_receipt(record, manifest, root, input_name, evidence=None, policy=None, required_cases=None):
    anchors=manifest['inputs'].get(input_name)
    require(isinstance(anchors,list) and anchors,'externally approved full receipt anchors absent: '+input_name)
    require(isinstance(record,dict) and set(record)=={'pin','trusted_anchor_sha256'},'exact externally anchored full receipt required')
    require(record['pin'] in anchors and record['trusted_anchor_sha256']==record['pin']['sha256'],'receipt is not an approved full receipt anchor')
    receipt=verify_full_receipt(record['pin'],manifest,root,evidence,policy)
    require_case_coverage(receipt,required_cases or set())
    return receipt

def child_pids():
    return {int(value) for value in Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().split()}

def process_identity(pid):
    try:
        fields = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()
        return fields[19], fields[0]
    except (OSError, IndexError):
        return None

def reap_owned_children(original, deadline_seconds=5):
    found, reaped = {}, []
    deadline = time.monotonic() + deadline_seconds
    while time.monotonic() < deadline:
        current = child_pids() - original
        if not current:
            break
        for pid in current:
            identity = process_identity(pid)
            if identity is None:
                continue
            found[pid] = identity[0]
            try:
                descriptor = os.pidfd_open(pid, 0)
                try:
                    if process_identity(pid) == identity and identity[1] != 'Z':
                        signal.pidfd_send_signal(descriptor, signal.SIGKILL, None, 0)
                finally:
                    os.close(descriptor)
                try:
                    exited, status = os.waitpid(pid, os.WNOHANG)
                    if exited:
                        reaped.append({'pid': exited, 'exit_code': os.waitstatus_to_exitcode(status)})
                except ChildProcessError:
                    pass
            except ProcessLookupError:
                pass
        time.sleep(0.01)
    remaining = child_pids() - original
    return {'owned_processes_observed': [{'pid': pid, 'start_ticks': ticks} for pid, ticks in sorted(found.items())],
            'remaining_owned_pids': sorted(remaining), 'reaped_exit_codes': reaped, 'complete': not remaining}

class CommandAdapter:
    """Durable command boundary for actual component/API-owner bridges.

    A reviewed bridge translates request operations into actual product calls and
    emits one JSON result. Missing bridges block; there is no simulated fallback.
    """
    def __init__(self, specification, root, evidence):
        require(isinstance(specification, dict) and set(specification) == {"argv", "cwd", "pins", "timeout_seconds", "required_env"}, "explicit adapter contract required")
        argv = specification["argv"]
        require(isinstance(argv, list) and argv and all(isinstance(item, str) and item and "\0" not in item for item in argv), "structured argv required")
        require(Path(specification["cwd"]).is_absolute() and Path(specification["cwd"]).is_dir(), "existing absolute adapter cwd required")
        require(type(specification["timeout_seconds"]) in (int, float) and 0 < specification["timeout_seconds"] <= 604800, "bounded adapter timeout required")
        names = specification["required_env"]
        require(isinstance(names, list) and len(set(names)) == len(names) and all(isinstance(name, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) for name in names), "credential environment references required")
        require(isinstance(specification["pins"], list) and specification["pins"], "adapter file pins required")
        self.pins = [pinned_file(pin, root) for pin in specification["pins"]]
        executable = shutil.which(argv[0]) if "/" not in argv[0] else str(Path(argv[0]).resolve())
        if not executable:
            raise Blocked("adapter executable unavailable")
        require(Path(executable).resolve() in {path for path, _ in self.pins}, "actual adapter executable must be pinned")
        for argument in argv[1:]:
            candidate = Path(argument) if Path(argument).is_absolute() else Path(specification["cwd"]) / argument
            if candidate.is_file():
                require(candidate.resolve() in {path for path, _ in self.pins}, "adapter script/input argument must be pinned")
        missing = [name for name in names if not os.environ.get(name)]
        if missing:
            raise Blocked("required credential/environment references absent: " + ",".join(missing))
        self.spec, self.root, self.evidence = specification, Path(root), Path(evidence)
        self.evidence.mkdir(parents=True, exist_ok=True)

    def call(self, request):
        for pin in self.spec['pins']:
            pinned_file(pin, self.root)
        if not sys.platform.startswith('linux') or not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
            raise Blocked('Linux subreaper/pidfd process ownership is required')
        import ctypes
        if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
            raise Blocked('Cannot establish owned descendant cleanup before execution')
        original = child_pids()
        operation = str(uuid.uuid4())
        directory = self.evidence / operation
        directory.mkdir(mode=0o700)
        body = canonical(request) + b'\n'
        sealed_write(directory / 'intent.json', {'operation_id': operation, 'at': utc(), 'argv': self.spec['argv'], 'cwd': self.spec['cwd'], 'request_sha256': digest(body), 'request': request})
        if request.get('source_revision'):
            actual = subprocess.run(['git', '-C', self.spec['cwd'], 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=10)
            require(actual.returncode == 0 and actual.stdout.strip() == request['source_revision'], 'actual adapter source revision differs from campaign pin')
        started = time.monotonic_ns()
        timed_out, stdout, stderr, child, unknown_reason = False, b'', b'', None, None
        caught = None
        definite_preexec = False
        try:
            child = subprocess.Popen(self.spec['argv'], cwd=self.spec['cwd'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            stdout, stderr = child.communicate(body, timeout=self.spec['timeout_seconds'])
        except subprocess.TimeoutExpired as exc:
            timed_out, unknown_reason = True, 'TIMEOUT'
            stdout, stderr = exc.output or b'', exc.stderr or b''
            caught = exc
        except BaseException as exc:
            caught = exc
            import errno
            definite_preexec = child is None and isinstance(exc, OSError) and exc.errno in {errno.ENOENT, errno.ENOTDIR, errno.EACCES, errno.ENOEXEC}
            unknown_reason = None if definite_preexec else type(exc).__name__
        finally:
            if child is not None and unknown_reason:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            cleanup = reap_owned_children(original)
            sealed_write(directory / 'process-cleanup.json', cleanup)
        if child is None:
            # Popen can be interrupted after fork/exec before returning its object.
            # An observed child overrides even a nominal spawn error classification.
            uncertain = not definite_preexec or bool(cleanup['owned_processes_observed']) or not cleanup['complete']
            status = 'UNKNOWN' if uncertain else 'FAILED_BEFORE_EXEC'
            sealed_write(directory / 'outcome.json', {'operation_id': operation, 'status': status, 'error_type': type(caught).__name__, 'owned_process_cleanup': cleanup, 'at': utc()})
            if uncertain:
                sealed_write(directory / 'unknown.json', {'operation_id': operation, 'status': 'UNKNOWN', 'cause': type(caught).__name__, 'reason': 'Spawn may have executed; reconcile before retry', 'owned_process_cleanup': cleanup, 'at': utc()})
                raise Blocked('adapter spawn outcome UNKNOWN; reconcile operation ' + operation + ' before retry') from caught
            raise CampaignError('Adapter could not execute; operation ' + operation) from caught
        for observed in cleanup['reaped_exit_codes']:
            if observed['pid'] == child.pid:
                child.returncode = observed['exit_code']
        if unknown_reason:
            try:
                stdout, stderr = child.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                cleanup['complete'] = False
        for name, data in (('stdout', stdout), ('stderr', stderr)):
            with (directory / (name + '.bin')).open('xb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        receipt = {'operation_id': operation, 'exit_code': child.returncode, 'timed_out': timed_out, 'unknown_outcome': unknown_reason is not None,
                   'duration_ns': time.monotonic_ns() - started, 'stdout_sha256': digest(stdout),
                   'stderr_sha256': digest(stderr), 'owned_process_cleanup': cleanup, 'at': utc()}
        sealed_write(directory / 'outcome.json', receipt)
        if unknown_reason:
            sealed_write(directory / 'unknown.json', {'operation_id': operation, 'status': 'UNKNOWN', 'cause': unknown_reason,
                         'reason': 'Remote mutation may have occurred; reconcile before retry', 'owned_process_cleanup': cleanup, 'at': utc()})
            raise Blocked('adapter outcome UNKNOWN; reconcile operation ' + operation + ' before retry') from caught
        require(cleanup['complete'], 'adapter owned-process cleanup incomplete; operation ' + operation)
        require(not cleanup['owned_processes_observed'], 'adapter left descendant processes; cleaned and rejected; operation ' + operation)
        require(child.returncode == 0, 'actual adapter command failed; inspect private operation receipt ' + operation)
        result = decode(stdout)
        require(isinstance(result, dict) and result.get('schema_version') == 1, 'invalid adapter result')
        require(result.get('request_sha256') == digest(body), 'adapter observation does not bind exact request')
        return result, receipt

def validate_activation(proof, previous_epoch, new_epoch, deployment_id, operation_id):
    """Validate actual04 record/CAS bindings, not a claimed physical isolation.

    Full physical fence proof remains a required anchored recovery-case obligation.
    The exact receipt JSON bytes come from the independent external journal:04's
    current proof digest is insertion-ordered JSON.stringify, not sorted JSON.
    """
    require(isinstance(proof,dict) and set(proof)=={'activation','authority_epoch','previous_authority_epoch','fencer_receipt_json'},'actual authority activation proof records required')
    activation,authority,previous=(proof[key] for key in ('activation','authority_epoch','previous_authority_epoch'))
    require(all(isinstance(row,dict)for row in (activation,authority,previous)),'actual authority rows required')
    authority_uuid(operation_id,'activation operation identity')
    require(activation.get('operation_id')==operation_id and activation.get('deployment_id')==deployment_id and activation.get('epoch')==new_epoch,'activation operation/deployment/epoch mismatch')
    request={'deployment_id':deployment_id,'operation_id':operation_id,'expected_previous_epoch':previous_epoch}
    raw_request=json.dumps(request,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
    require(activation.get('request_digest')=='sha256:'+digest(raw_request),'activation request predecessor/CAS digest mismatch')
    require(authority.get('deployment_id')==deployment_id and authority.get('epoch')==new_epoch and authority.get('previous_epoch')==previous_epoch and authority.get('state')=='ACTIVE','accepted authority successor/predecessor state mismatch')
    require(previous.get('deployment_id')==deployment_id and previous.get('epoch')==previous_epoch and previous.get('state')=='REVOKED','previous writer authority was not durably superseded')
    raw=proof['fencer_receipt_json']
    require(isinstance(raw,str) and 0<len(raw.encode())<=32768,'bounded exact external-journal fencer receipt bytes required')
    require(authority.get('proof_digest')=='sha256:'+digest(raw.encode()),'authority proof digest differs from exact bound fencer receipt')
    receipt=decode(raw)
    require(isinstance(receipt,dict) and receipt.get('deployment_id')==deployment_id and receipt.get('operation_id')==operation_id and receipt.get('source_epoch')==previous_epoch,'external fence receipt scope/operation/source epoch mismatch')
    require(isinstance(receipt.get('fence_id'),str) and receipt['fence_id'] and receipt['fence_id']==authority.get('fence_id'),'authority fence identity mismatch')
    require(isinstance(receipt.get('isolated_writer'),str) and receipt['isolated_writer'],'isolated_writer must identify the actual fenced writer')
    require(isinstance(receipt.get('evidence_digest'),str) and re.fullmatch('sha256:[0-9a-f]{64}',receipt['evidence_digest']),'external physical fence evidence reference required')
    observed,expires=timestamp(receipt.get('observed_at')),timestamp(receipt.get('expires_at'))
    accepted,activated=timestamp(activation.get('accepted_at')),timestamp(authority.get('activated_at'))
    require(0<(expires-observed).total_seconds()<=30 and observed<=activated<=accepted<=expires,'accepted activation is outside the bounded actual fence receipt lifetime')
    return True

class Reference:
    """Reference semantics use attempted events, never the reported accepted flag."""
    def __init__(self, sandboxes=100, slots=200, initial_epoch=None, deployment_id=None, authority_contract="legacy-ordinary-v1"):
        require(authority_contract in {"legacy-ordinary-v1", "04-journal-v1"}, "unsupported activation contract")
        self.authority_contract = authority_contract
        self.limit, self.sandbox_limit = slots, sandboxes
        self.epoch = authority_uuid(initial_epoch)
        self.deployment_id = authority_uuid(deployment_id, "deployment identity")
        self.seen_epochs = {self.epoch}
        self.owners, self.slots, self.generations = {}, {}, {}
        self.resources, self.intents, self.publications, self.effects = set(), set(), {}, set()
        self.pending_creates, self.observed_creates, self.attempts, self.faults = set(), {}, set(), set()
        self.submitted, self.qualified, self.custody_generations = {}, set(), {}
        self.last_sequence, self.last_time = 0, -1
        self.peak, self.accepted = 0, 0

    def apply(self, event):
        require(isinstance(event, dict), "event object required")
        sequence = integer(event.get("sequence"), "event sequence")
        at = integer(event.get("virtual_ms"), "event time", 0)
        require(sequence == self.last_sequence + 1 and at >= self.last_time, "non-contiguous/reversed observation stream")
        self.last_sequence, self.last_time = sequence, at
        kind = event.get("kind")
        op = event.get("operation_id")
        require(isinstance(op, str) and op, "operation identity required")
        accepted = False
        if kind == "claim":
            task, attempt, slot = event.get("task_id"), event.get("attempt_id"), event.get("slot_id")
            require(all(isinstance(value, str) and value for value in (task, attempt, slot)), "claim identities required")
            generation = integer(event.get("generation"), "ownership generation")
            accepted = event.get("epoch") == self.epoch and task not in self.owners and task not in self.submitted and slot not in self.slots and len(self.slots) < self.limit and generation > self.generations.get(task, 0)
            if accepted:
                self.owners[task] = (attempt, generation, slot)
                self.slots[slot] = task
                self.generations[task] = generation
                self.attempts.add(attempt)
                self.peak = max(self.peak, len(self.slots))
        elif kind in ("revoke", "expire", "submit"):
            task = event.get("task_id")
            owner = self.owners.get(task)
            accepted = event.get("epoch") == self.epoch and owner is not None and owner[:2] == (event.get("attempt_id"), event.get("generation"))
            if accepted:
                if kind == "submit":
                    require(isinstance(event.get("revision"), str) and re.fullmatch(r"[0-9a-f]{40}", event["revision"]), "exact submitted revision required")
                    custody = integer(event.get("custody_generation"), "submitted custody generation")
                    require(custody > self.custody_generations.get(task, 0), "non-increasing custody generation")
                    self.custody_generations[task] = custody
                    self.submitted[task] = (event["revision"], owner[0], owner[1], custody)
                self.owners.pop(task)
                self.slots.pop(owner[2])
        elif kind in ("custody_revoke", "custody_expire"):
            task = event.get("task_id")
            submitted = self.submitted.get(task)
            accepted = event.get("epoch") == self.epoch and submitted is not None and submitted[1:] == (event.get("attempt_id"), event.get("generation"), event.get("custody_generation"))
            if accepted:
                self.submitted.pop(task)
                self.qualified.discard((task, submitted[0]))
        elif kind == "qualify":
            task = event.get("task_id")
            submitted = self.submitted.get(task)
            accepted = event.get("epoch") == self.epoch and submitted is not None and submitted == (event.get("revision"), event.get("attempt_id"), event.get("generation"), event.get("custody_generation")) and event.get("evidence_valid") is True
            if accepted:
                self.qualified.add((task, event["revision"]))
        elif kind == "publish":
            task, revision, ref = event.get("task_id"), event.get("revision"), event.get("ref")
            require(isinstance(ref, str) and ref, "protected ref identity required")
            accepted = event.get("epoch") == self.epoch and (task, revision) in self.qualified and event.get("gateway_authorised") is True and self.publications.get(ref) == event.get("expected_head")
            if accepted:
                self.publications[ref] = revision
                self.submitted.pop(task)
                self.qualified.discard((task, revision))
        elif kind == "epoch":
            epoch = authority_uuid(event.get("new_epoch"), "restore epoch")
            accepted = event.get("epoch") == self.epoch and epoch not in self.seen_epochs and event.get("activation_proof") is not None
            if accepted:
                if self.authority_contract == "04-journal-v1":
                    require(event.get("activation_contract") == self.authority_contract, "current epoch observation lacks durable journal contract")
                    expected = {"deployment_id": self.deployment_id, "operation_id": op,
                        "external_previous_epoch": self.epoch,
                        "database_previous_epoch": event.get("database_previous_epoch"),
                        "new_epoch": epoch, "mode": event.get("activation_mode")}
                    try:
                        current_authority.inspect_transition(event["activation_proof"], expected)
                    except current_authority.AuthorityError as error:
                        raise CampaignError("current activation proof rejected: " + str(error)) from error
                else:
                    require(event.get("activation_contract") in (None, "legacy-ordinary-v1"), "current journal proof cannot be downgraded to legacy oracle")
                    validate_activation(event["activation_proof"], self.epoch, epoch, self.deployment_id, op)
            if accepted:
                self.epoch = epoch
                self.seen_epochs.add(epoch)
                self.owners.clear()
                self.slots.clear()
                # A restore requires fresh evidence/custody, not rewound qualification.
                self.qualified.clear()
                self.submitted.clear()
                self.generations.clear()
                self.custody_generations.clear()
        elif kind == "create_intent":
            accepted = event.get("epoch") == self.epoch and op not in self.intents and len(self.resources) + len(self.pending_creates) < self.sandbox_limit
            if accepted:
                self.intents.add(op)
                self.pending_creates.add(op)
        elif kind == "provider_observe":
            resource = event.get("resource_id")
            require(isinstance(resource, str) and resource, "resource identity required")
            create_op = event.get("create_operation_id")
            accepted = create_op in self.intents
            if accepted:
                require(create_op not in self.observed_creates or self.observed_creates[create_op] == resource, "duplicate resources for one durable create intent")
                self.observed_creates[create_op] = resource
                self.pending_creates.discard(create_op)
                self.resources.add(resource)
                require(len(self.resources) <= self.sandbox_limit, "actual resource inventory exceeds declared limit")
        elif kind == "cleanup":
            resource = event.get("resource_id")
            accepted = resource in self.resources and event.get("confirmed_absent") is True
            if accepted:
                self.resources.remove(resource)
        elif kind == "effect":
            key = event.get("effect_key")
            require(isinstance(key, str) and key, "durable effect key required")
            accepted = event.get("epoch") == self.epoch and key not in self.effects
            if accepted:
                self.effects.add(key)
        elif kind == "fault_observed":
            require(isinstance(event.get("fault"), str), "observed fault identity required")
            self.faults.add(event["fault"])
            accepted = False
        elif kind in ("replica_read", "unknown_create", "saturation", "credential_expiry", "main_loss", "sandbox_loss"):
            # Observations cannot grant authority or prove a resource absent.
            accepted = False
        else:
            raise CampaignError("unknown event kind: " + str(kind))
        require(type(event.get("accepted")) is bool, "actual accepted decision missing")
        require(event["accepted"] is accepted, "independent reference disagreement at sequence " + str(sequence))
        self.accepted += int(accepted)
        return accepted

    def state(self):
        return {"epoch": self.epoch, "owners": {key: list(value) for key, value in sorted(self.owners.items())}, "slots": dict(sorted(self.slots.items())), "custody": {key: list(value) for key, value in sorted(self.submitted.items())}, "resources": sorted(self.resources), "publications": dict(sorted(self.publications.items())), "effect_count": len(self.effects), "accepted_count": self.accepted, "peak_slots": self.peak, "session_lifetimes": len(self.attempts), "pending_creates": sorted(self.pending_creates), "faults": sorted(self.faults), "virtual_elapsed_ms": self.last_time}

def reconstruct(events, profile):
    require(isinstance(events, list) and events, "nonempty independently observed event stream required")
    reference = Reference(profile["sandboxes"], profile["slots"], profile.get("initial_authority_epoch"), profile.get("deployment_id"), profile.get("authority_contract", "legacy-ordinary-v1"))
    for event in events:
        reference.apply(event)
    return reference.state()

def schedule(profile, seed):
    rng = random.Random(seed)
    commands = []
    horizon = profile["virtual_hours"] * 3600 * 1000
    for resource in range(profile["sandboxes"]):
        commands.append({"operation": "create", "operation_id": f"seed{seed}-create{resource}", "sandbox_index": resource, "virtual_ms": 0})
    for index in range(profile["session_lifetimes"]):
        commands.append({"operation": "session", "operation_id": f"seed{seed}-session{index}", "task_index": index, "slot_index": index % profile["slots"], "virtual_ms": (index // profile["slots"]) * horizon // max(1, (profile["session_lifetimes"] + profile["slots"] - 1) // profile["slots"]), "reverse_commit_order": index % 2 == 0})
    for fault in ("stale_generation", "reversed_commits", "unknown_create", "replica_lag", "saturation", "main_loss", "credential_expiry"):
        commands.append({"operation": "fault", "operation_id": f"seed{seed}-{fault}", "fault": fault, "virtual_ms": rng.randrange(horizon)})
    commands.append({"operation": "cleanup", "operation_id": f"seed{seed}-cleanup", "virtual_ms": horizon})
    return sorted(commands, key=lambda row: (row["virtual_ms"], row["operation_id"]))

def compare_metrics(current, baseline):
    """Preserve decimal measurements and histogram bounds; never infer causality."""
    from decimal import Decimal, localcontext
    require(isinstance(current, dict) and isinstance(baseline, dict), "comparable metric records required")
    units={"p50":"ms","p95":"ms","p99":"ms","throughput":"1/s","error_count":"count","connection_peak":"count","lock_wait_count":"count"}
    for key in ("workload_digest", "environment_digest", "provenance_digest", "units", "measurement_kind", "quantile_basis"):
        require(key in current and current[key] == baseline.get(key), "baseline parity mismatch: " + key)
    require(current['units']==units,'metric dimensions must remain explicit and comparable')
    require(current['measurement_kind'] in {'MEASUREMENT_REPORT','REPLAY'},'actual measurement origin required')
    require(current['quantile_basis'] in {'HISTOGRAM_UPPER_BOUND','EXACT_SAMPLES'},'quantile measurement semantics required')
    for record in (current,baseline):
        integer(record.get('sample_count'),'observed metric sample count')
        require(all(isinstance(record.get(key),str) and re.fullmatch('[0-9a-f]{64}',record[key])for key in ('workload_digest','environment_digest','provenance_digest')),'exact comparable metric provenance required')
    def number(value):
        if type(value) is int:
            require(value>=0,'nonnegative measured metric required');value=str(value)
        require(isinstance(value,str) and re.fullmatch(r'(0|[1-9][0-9]*)(\.[0-9]*[1-9])?',value),'canonical nonnegative decimal metric required')
        return Decimal(value)
    result={"performance_claim":"DESCRIPTIVE_ONLY","units":units,"quantile_basis":current['quantile_basis'],"measurement_kind":current['measurement_kind']}
    values={}
    for key in units:
        a,b=number(current.get(key)),number(baseline.get(key))
        if key in ('error_count','connection_peak','lock_wait_count'):
            require(a==a.to_integral_value() and b==b.to_integral_value(),'count metrics must be integral')
        with localcontext() as context:
            context.prec=34
            ratio=format(a/b,'f') if b else None
        result[key]={"current":format(a,'f'),"baseline":format(b,'f'),"ratio":ratio}
        values[key]=(a,b)
    require(all(values['p50'][index]<=values['p95'][index]<=values['p99'][index] for index in (0,1)),'quantile values/bounds must be monotonic')
    return result

def run(path, evidence):
    manifest, root = load_manifest(path, "deterministic")
    seeds = manifest.get("seeds")
    require(isinstance(seeds, list) and len(seeds) >= 2 and len(set(seeds)) == len(seeds) and all(type(seed) is int for seed in seeds), "multiple distinct integer fault seeds required")
    if set(manifest["adapters"]) != {"implementation", "baseline"}:
        raise Blocked("actual implementation and comparable baseline adapter references required")
    directory = Path(evidence) / (manifest["campaign_id"] + "-" + str(uuid.uuid4()))
    directory.mkdir(parents=True, mode=0o700)
    sealed_write(directory / "manifest.json", manifest)
    adapters = {name: CommandAdapter(spec, root, directory / name) for name, spec in manifest["adapters"].items()}
    results = []
    for seed in seeds:
        request = {"schema_version": 1, "kind": "deterministic", "source_revision": manifest["source_revision"], "source_manifest_digest": manifest["source_manifest_digest"], "profile": manifest["profile"], "inputs": manifest["inputs"], "seed": seed, "schedule": schedule(manifest["profile"], seed)}
        observations = {name: adapter.call(request)[0] for name, adapter in adapters.items()}
        current, baseline = observations["implementation"], observations["baseline"]
        require(current.get("mode") == baseline.get("mode") == "SIMULATED", "deterministic results must identify simulation")
        require(current.get("source_manifest_digest") == baseline.get("source_manifest_digest") == manifest["source_manifest_digest"], "actual multi-repository source set differs from campaign")
        state = reconstruct(current.get("events"), manifest["profile"])
        require(state == current.get("final_state"), "reported final state differs from independently reconstructed state")
        baseline_state = reconstruct(baseline.get("events"), manifest["profile"])
        require(state == baseline_state, "implementation/baseline final state parity failed")
        require(not state["owners"] and not state["slots"] and not state["custody"] and not state["resources"] and not state["pending_creates"], "incomplete final cleanup/inventory or unresolved creates")
        require(state["peak_slots"] >= 200, "200 simultaneously occupied simulated slots not observed")
        require(state["session_lifetimes"] == manifest["profile"]["session_lifetimes"] and state["virtual_elapsed_ms"] == manifest["profile"]["virtual_hours"] * 3600000, "declared schedule was not fully exercised")
        require(set(state["faults"]) >= {"stale_generation", "reversed_commits", "unknown_create", "replica_lag", "saturation", "main_loss", "credential_expiry"}, "actual fault observation coverage incomplete")
        for corpus in ("planning", "graph"):
            require(current.get("input_digests", {}).get(corpus) == [pin["sha256"] for pin in manifest["inputs"][corpus]], "actual corpus coverage differs from pins")
        for domain in ("planning_result", "graph_query_results"):
            require(isinstance(current.get(domain), (dict, list)) and bool(current[domain]), "actual parsed planning/graph query results absent")
            require(canonical(current[domain]) == canonical(baseline.get(domain)), "planning/graph semantic parity failed")
        metrics = compare_metrics(current.get("metrics"), baseline.get("metrics"))
        results.append({"seed": seed, "state": state, "metrics": metrics})
    return sealed_write(directory / "result.json", {"schema_version": 1, "kind": "deterministic", "status": "PASS", "evidence_scope": "SIMULATION_ONLY", "live_frontier_qualified": False, "seeds": results})

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--evidence", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.manifest, args.evidence)))
        return 0
    except (CampaignError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "BLOCKED" if isinstance(exc, Blocked) else "FAIL", "error": str(exc), "live_frontier_qualified": False}), file=sys.stderr)
        return 2 if isinstance(exc, Blocked) else 1

if __name__ == "__main__":
    raise SystemExit(main())
