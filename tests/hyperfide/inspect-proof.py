#!/usr/bin/env python3
"""Read-only canonical evidence inspection. A checked receipt never grants authority.

The evidence root, qualified assets and expected pins belong to the admission
service. The caller must not choose those from an untrusted request. Original
source/executable material must remain available to the canonical checker.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
MAX_BYTES = 1024 * 1024

class Rejected(Exception):
    pass

def require(ok, message):
    if not ok:
        raise Rejected(message)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()

def digest(raw):
    return "sha256:" + hashlib.sha256(raw).hexdigest()

def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result

def decode(raw):
    require(len(raw) <= MAX_BYTES, "JSON exceeds bounded input size")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(Rejected("nonfinite JSON")))

def closed(value, keys, label):
    require(type(value) is dict and set(value) == set(keys), label + " fields differ from closed schema")

def identifier(value):
    require(type(value) is str and str(uuid.UUID(value)) == value, "canonical UUID required")

def sha(value):
    require(type(value) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", value), "SHA-256 identity required")

def revision(value):
    require(type(value) is str and re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value), "Git revision required")

def cases(value):
    require(type(value) is list and 0 < len(value) <= 128 and len(set(value)) == len(value), "unique nonempty case inventory required")
    require(all(type(item) is str and re.fullmatch(r"V-[0-9]{3}", item) for item in value), "invalid case identity")

def parity_policy(value):
    uuids = "organisation_id run_id repository_id import_id source_id archive_manifest_artifact_id".split()
    digests = "snapshot_digest archive_manifest_digest archive_content_digest corpus_manifest_digest parser_digest configuration_digest query_rubric_digest graph_snapshot_digest prebuilt_manifest_digest".split()
    closed(value, ["schema_version", "archive_size_bytes", "implementation_revision"] + uuids + digests, "cutover_parity")
    require(type(value["schema_version"]) is int and value["schema_version"] == 1, "unsupported parity schema")
    for key in uuids:
        identifier(value[key])
    for key in digests:
        sha(value[key])
    revision(value["implementation_revision"])
    require(type(value["archive_size_bytes"]) is str and re.fullmatch(r"0|[1-9][0-9]{0,19}", value["archive_size_bytes"]), "bounded decimal archive size required")

def validate_request(value):
    closed(value, ["schema_version", "request_id", "campaign", "receipt_id", "receipt_digest", "requirements"], "request")
    require(type(value["schema_version"]) is int and value["schema_version"] == 1, "unsupported request schema")
    identifier(value["request_id"])
    identifier(value["receipt_id"])
    sha(value["receipt_digest"])
    needed = value["requirements"]
    closed(needed, ["source_revision", "case_ids", "policy"], "requirements")
    revision(needed["source_revision"])
    cases(needed["case_ids"])
    closed(needed["policy"], ["cutover_parity"], "trusted policy requirements")
    parity_policy(needed["policy"]["cutover_parity"])
    return value

def under(root, relative, directory=False):
    require(type(relative) is str and 0 < len(relative) <= 1024 and "\\" not in relative and "\x00" not in relative, "invalid relative evidence path")
    name = Path(relative)
    require(not name.is_absolute() and all(part not in ("..", ".") for part in relative.split("/")), "evidence path escapes trusted root")
    current = root
    for part in name.parts:
        current /= part
        require(not current.is_symlink(), "symbolic evidence paths forbidden")
    require(current.resolve().is_relative_to(root), "evidence escapes trusted root")
    require(current.is_dir() if directory else current.is_file(), "evidence path absent")
    return current

def bounded_read(path):
    with path.open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    require(len(raw) <= MAX_BYTES, "evidence JSON exceeds size bound")
    return raw

def recheck(pins):
    for path, raw in pins:
        require(not path.is_symlink() and bounded_read(path) == raw, "evidence changed during canonical check")

def canonical_check(campaign, receipt_id, relocation=None):
    checker = HERE / "check-evidence.py"
    require(checker.is_file() and not checker.is_symlink(), "fixed canonical checker missing")
    pin = bounded_read(checker)
    # No caller-selected executable, checker, shell or argv is accepted.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        argv = [str(Path(sys.executable).resolve()), "-I", "-B", str(checker), "--campaign", str(campaign), "--receipt", receipt_id]
        if relocation is not None:
            argv += ["--relocation", str(relocation)]
        # The signed runtime shim resolves to its sibling binary. Preserve only
        # that interpreter's own library directory, never inherited loader input.
        runtime_library = Path(sys.executable).resolve().parent.parent / "lib"
        child = subprocess.Popen(argv, stdout=output, stderr=errors, start_new_session=True, env={"PATH": os.defpath, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "LD_LIBRARY_PATH": str(runtime_library)})
        try:
            code = child.wait(timeout=120)
        finally:
            # A live, unreaped child retains its PID/group identity. Never signal
            # a group after wait has reaped the leader and released that PID.
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            child.wait()
        output.seek(0)
        raw = output.read(MAX_BYTES + 1)
    require(code == 0, "independent canonical checker rejected evidence")
    checked = decode(raw)
    require(checked.get("checked") is True and checked.get("receipt_id") == receipt_id, "canonical checker identity mismatch")
    require(bounded_read(checker) == pin, "canonical checker changed during inspection")
    return checked, {"sha256": digest(pin), "stdout_digest": digest(raw), "git_executable": checked.get("git_executable")}

def _inspect(request, evidence_root, require_full=False):
    validate_request(request)
    root = Path(evidence_root)
    require(root.is_absolute() and root.is_dir() and not root.is_symlink(), "trusted absolute evidence root required")
    require(all(not parent.is_symlink() for parent in root.parents), "symbolic root parents forbidden")
    root = root.resolve()
    campaign = under(root, request["campaign"], directory=True)
    paths = [under(campaign, "receipts/" + request["receipt_id"] + ".json")]
    paths += [under(campaign, name) for name in ("manifest.json", "registration.json", "registry.json")]
    pins = [(path, bounded_read(path)) for path in paths]
    require(digest(pins[0][1]) == request["receipt_digest"], "externally anchored receipt digest mismatch")
    receipt, manifest, registration, registry = [decode(raw) for _, raw in pins]
    require(digest(pins[1][1]) == "sha256:" + receipt.get("manifest_sha256", ""), "manifest does not match anchored receipt")
    needed = request["requirements"]
    require(receipt.get("receipt_id") == request["receipt_id"], "receipt UUID mismatch")
    require(receipt.get("source", {}).get("commit") == needed["source_revision"], "source revision mismatch")
    require(set(needed["case_ids"]).issubset(receipt.get("selected_case_ids", [])), "required cases not selected")
    require(manifest.get("policy", {}).get("cutover_parity") == needed["policy"]["cutover_parity"], "trusted provenance policy mismatch")
    full = receipt.get("scope") == "full-case" and receipt.get("full_case_status") == "PASS"
    if require_full:
        require(full, "component/campaign evidence cannot substitute for registered full-case proof")
        # A hydrated campaign cannot invent its own normative full obligations.
        normative_path = HERE / "registry.json"
        normative_raw = bounded_read(normative_path)
        pins.append((normative_path, normative_raw))
        normative = decode(normative_raw)
        for case in receipt.get("case_ids", []):
            expected = normative.get("cases", {}).get(case, {}).get("full_assertion_ids")
            require(type(expected) is list and bool(expected), "qualified full-case inventory is not registered")
            require(registry.get("cases", {}).get(case, {}).get("full_assertion_ids") == expected, "campaign full obligations differ from qualified registry")
    relocation = root / "trusted-relocation.json"
    if relocation.exists() or relocation.is_symlink():
        relocation = under(root, "trusted-relocation.json")
        pins.append((relocation, bounded_read(relocation)))
    else:
        relocation = None
    checked, checker = canonical_check(campaign, request["receipt_id"], relocation)
    if relocation is not None:
        checker["relocation_digest"] = digest(pins[-1][1])
    recheck(pins)
    require("sha256:" + checked.get("receipt_sha256", "") == request["receipt_digest"], "checker did not inspect anchored receipt")
    require(checked.get("scope") == receipt.get("scope") and checked.get("full_case_status") == receipt.get("full_case_status"), "checker scope mismatch")
    return {"schema_version": 1, "status": "VERIFIED_FULL" if full and require_full else "CHECKED_COMPONENT" if receipt.get("scope") == "task-component" else "CHECKED_ONLY", "request_id": request["request_id"], "request_digest": digest(canonical(request)), "receipt_digest": request["receipt_digest"], "manifest_digest": digest(pins[1][1]), "source_revision": needed["source_revision"], "scope": receipt["scope"], "full_case_status": receipt["full_case_status"], "case_ids": receipt["case_ids"], "selected_case_ids": receipt["selected_case_ids"], "assertion_ids": receipt["expected_assertion_ids"], "policy": needed["policy"], "checker": checker, "grants_authority": False}

def inspect(request, evidence_root, require_full=False):
    root = Path(evidence_root)
    relocation = root / "trusted-relocation.json"
    portable = relocation.exists() or relocation.is_symlink()
    require(not require_full or portable, "full admission requires private portable staging")
    if not portable:
        return _inspect(request, evidence_root, require_full)
    # Only the admission service may own this tree; workers run elsewhere.
    # The lock coordinates trusted service writers. UID/VM isolation excludes
    # untrusted writers; a live worker checkout is never an admission stage.
    sys.path.insert(0, str(HERE))
    from proof_relocation import guard_staging
    import fcntl
    guard_staging(root, require)
    descriptor = os.open(root / ".inspection.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return _inspect(request, evidence_root, require_full)
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-root", required=True)
    parser.add_argument("--require-full", action="store_true")
    args = parser.parse_args()
    try:
        request = decode(sys.stdin.buffer.read(MAX_BYTES + 1))
        result = inspect(request, args.evidence_root, args.require_full)
    except (Rejected, ValueError, TypeError, KeyError, AttributeError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"schema_version": 1, "status": "REJECTED", "error": str(error)[:512], "grants_authority": False}, sort_keys=True))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
