#!/usr/bin/env python3
"""Task 8.1: real provisioner-process validation of declared provider contracts.

These checks validate data and lifecycle distinctions. They make no provider calls
and cannot establish provider readiness, resource absence, or live qualification.
"""
from __future__ import annotations
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
FAILED = []
IDS = []
CASES = []
NAMES = ["prepare", "create", "list", "observe", "attach", "execute", "inspect", "stop",
         "transfer", "lifetime", "destroy", "stdin", "disk_snapshot", "memory_snapshot",
         "network_isolated", "network_private", "public_ingress", "persistent_storage", "shared_storage"]
METHODS = ["capabilities", "prepare", "create", "list", "observe", "attach", "execute", "inspect",
           "stop", "transfer", "lifetime", "destroy"]
DIGEST = "sha256:" + "1" * 64
OTHER = "sha256:" + "2" * 64
NOW = "2026-10-16T12:00:00.000Z"
PAST = "2026-10-16T11:00:00.000Z"
FUTURE = "2026-10-16T13:00:00.000Z"
SCOPE = {"organisation_id": "org-1", "pool_id": "pool-1", "provider": "railway",
         "provider_account_id": "account-1", "environment_id": "environment-1", "region": "region-1",
         "configuration_digest": DIGEST}
RESOURCE = {"native_sandbox_id": "external-sandbox-1", "sandbox_boot_generation": "1"}
OS = {"distribution": "fixture-os", "version": "1.0", "architecture": "x86_64"}
PROFILE = {"schema_version": 1, "scope": SCOPE,
           "pin": {"sdk_name": "fixture-sdk", "sdk_version": "1.2.3",
                   "sdk_integrity": "sha256-" + base64.b64encode(bytes(32)).decode(),
                   "api_revision": "api-2026-10"},
           "observed_at": PAST, "expires_at": FUTURE, "preparation_digest": DIGEST, "os": OS,
           "capabilities": [{"name": name, "support": "SUPPORTED", "availability": "ENABLED",
                             "basis": "LIVE_QUALIFIED", "evidence_digest": DIGEST} for name in NAMES]}
PARAMETERS = {
    "capabilities": {},
    "prepare": {"image_reference": "fixture-image", "recipe_digest": DIGEST, "os": OS},
    "create": {"preparation_reference": "prepared-1",
               "resources": {"cpu_millis": 2000, "memory_bytes": "4294967296", "disk_bytes": "0",
                             "persistent_volume_bytes": "0"}, "network": "ISOLATED", "stdin_required": True},
    "list": {"cursor": None, "page_size": 100},
    "observe": {},
    "attach": {"process_ref": "process-1", "resume_cursor": None},
    "execute": {"argv": ["node", "worker.js"], "cwd": "/work/task", "env_refs": {"TOKEN": "secret-ref:token-1"},
                "stdin": True, "durable": True, "process_timeout_ms": None, "wait_timeout_ms": 1000},
    "inspect": {"process_ref": "process-1"},
    "stop": {"process_ref": "process-1", "signal": "TERM"},
    "transfer": {"direction": "UPLOAD", "path": "/work/task/evidence.json", "artifact_digest": DIGEST,
                 "byte_count": "42"},
    "lifetime": {"policy": "NO_IDLE_EXPIRY", "timeout_ms": None},
    "destroy": {"reason": "approved fixture cleanup"},
}
MUTATIONS = {"prepare", "create", "execute", "stop", "transfer", "lifetime", "destroy"}


def clone(value):
    return copy.deepcopy(value)


def canonical_digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def operation(kind):
    value = {"schema_version": 1, "kind": kind, "scope": clone(SCOPE),
             "identity": {"operation_id": "operation-" + kind, "idempotency_key": "idempotency-" + kind,
                          "payload_digest": "", "correlation_id": "correlation-1", "causation_id": "causation-1"},
             "resource": None if kind in {"capabilities", "prepare", "create", "list"} else clone(RESOURCE),
             "preparation_digest": DIGEST if kind in {"prepare", "create"} else None,
             "deadline_at": FUTURE,
             "parameters": clone(PARAMETERS[kind])}
    resign(value)
    return value


def resign(value):
    value["identity"]["payload_digest"] = canonical_digest(
        {key: value[key] for key in ["kind", "scope", "resource", "preparation_digest", "deadline_at", "parameters"]})
    return value


def capability_check():
    return {"profile": clone(PROFILE), "requirements": {"capabilities": clone(NAMES),
            "preparation_digest": DIGEST, "os": clone(OS)}, "evaluated_at": NOW}


def page(*, cursor=None, next_cursor=None, more=False, complete=True, identity="sandbox-1"):
    return {"scope": clone(SCOPE), "requested_cursor": cursor, "next_cursor": next_cursor,
            "has_more": more, "complete": complete, "consistency": "SNAPSHOT", "snapshot_id": "snapshot-1",
            "observed_at": PAST, "items": [{"native_sandbox_id": identity, "provider_state": "RUNNING"}]}


def process_result():
    return {"process_ref": "process-1", "phase": "EXITED", "exit_code": 0, "timed_out": False,
            "termination_confirmed": True,
            "output": {"complete": True, "truncated": False, "byte_count": "42", "sha256": DIGEST}}


def succeeded(kind):
    op = operation(kind)
    results = {
        "capabilities": {"profile": clone(PROFILE)},
        "prepare": {"preparation_reference": "prepared-1", "preparation_digest": DIGEST},
        "create": {"provider_state": "RUNNING"},
        "list": {"page": page()},
        "observe": {"provider_state": "RUNNING", "health": "HEALTHY"},
        "attach": process_result(), "execute": process_result(), "inspect": process_result(),
        "stop": {"process_ref": "process-1", "termination": "CONFIRMED", "exit_code": 0},
        "transfer": {"artifact_digest": DIGEST, "byte_count": "42", "complete": True},
        "lifetime": clone(PARAMETERS["lifetime"]), "destroy": {"deletion": "CONFIRMED"}}
    return {"operation": op, "outcome": {"schema_version": 1, "status": "SUCCEEDED",
            "acceptance": "CONFIRMED_ACCEPTED", "provider_request_id": "provider-request-1", "operation_id": op["identity"]["operation_id"],
            "payload_digest": op["identity"]["payload_digest"], "scope": clone(SCOPE),
            "observed_at": NOW, "resource": clone(RESOURCE) if kind not in {"capabilities", "prepare", "list"} else None,
            "result": results[kind], "error": None, "reconcile_required": False, "retry": "NEVER"}}


def uncertain(kind="create"):
    value = succeeded(kind)
    value["outcome"].update(status="UNKNOWN", acceptance="UNKNOWN", resource=None, result=None,
        error={"code": "TIMEOUT", "provider_code": None, "message": "fixture response lost", "retry_after_ms": None},
        reconcile_required=True, retry="AFTER_RECONCILIATION")
    if value["operation"]["resource"] is not None:
        value["outcome"]["resource"] = clone(RESOURCE)
    return value


def expect(condition, detail):
    if not condition:
        raise AssertionError(detail)


def add(identity, action, payload, oracle):
    IDS.append(identity)
    CASES.append((identity, action, payload, oracle))


def valid(result):
    expect(result.get("valid") is True, result)
    expect(result.get("authority") == "NONE" and result.get("live_qualification") == "NOT_EVALUATED", result)


def rejected(row):
    expect(row.get("ok") is False and row.get("error", {}).get("code") == "HANDLER_FAILED", row)


def accepted(oracle):
    def inspect(row):
        expect(row.get("ok") is True, row)
        oracle(row["result"])
    return inspect


def reason(code):
    def inspect(result):
        expect(result.get("candidate_compatible") is False, result)
        expect(code in [item["code"] for item in result.get("reasons", [])], result)
        expect(result.get("authority") == "NONE" and result.get("live_qualification") == "NOT_EVALUATED", result)
    return inspect


def change(base, path, value):
    output = clone(base)
    target = output
    for part in path[:-1]:
        target = target[part]
    target[path[-1]] = value
    return output


def invalid_op(identity, kind, path, value, *, rehash=True):
    op = change(operation(kind), path, value)
    if rehash:
        resign(op)
    add(identity, "provider.operation.validate", op, rejected)


def invalid_outcome(identity, kind, path, value):
    add(identity, "provider.outcome.validate", change(succeeded(kind), path, value), rejected)


def inventory(pages):
    return {"scope": clone(SCOPE), "pages": pages, "evaluated_at": NOW}


def inventory_oracle(complete, eligible, count):
    def inspect(result):
        valid(result)
        expect(result.get("enumeration_complete") is complete and
               result.get("absence_evidence_eligible") is eligible and
               result.get("absence_authorized") is False and result.get("resource_count") == count, result)
    return inspect


def define_cases():
    add("provider.contract.real-service", "provider.contract.describe", {}, accepted(lambda result: (
        expect(result.get("schema_version") == 1 and result.get("provider_contract_version") == 1, result),
        expect(result.get("methods") == METHODS and result.get("capability_names") == NAMES, result),
        expect(result.get("authority") == "NONE" and result.get("live_qualification") == "NOT_EVALUATED", result))))
    add("provider.contract.unknown-input", "provider.contract.describe", {"trusted": True}, rejected)
    add("provider.capabilities.match", "provider.capabilities.check", capability_check(), accepted(lambda result: (
        expect(result.get("candidate_compatible") is True and result.get("reasons") == [], result),
        expect(result.get("authority") == "NONE" and result.get("live_qualification") == "NOT_EVALUATED", result))))
    for identity, key, value, code in [
        ("unsupported", "support", "UNSUPPORTED", "UNSUPPORTED_CAPABILITY"),
        ("unknown-support", "support", "UNKNOWN", "UNKNOWN_SUPPORT"),
        ("disabled", "availability", "DISABLED", "CAPABILITY_DISABLED"),
        ("unknown-availability", "availability", "UNKNOWN", "UNKNOWN_AVAILABILITY"),
        ("documented-only", "basis", "DOCUMENTED", "UNQUALIFIED_CAPABILITY")]:
        payload = change(capability_check(), ["profile", "capabilities", 0, key], value)
        add("provider.capabilities." + identity, "provider.capabilities.check", payload, accepted(reason(code)))
    payload = capability_check()
    payload["profile"]["capabilities"].pop()
    add("provider.capabilities.missing", "provider.capabilities.check", payload, accepted(reason("MISSING_CAPABILITY")))
    payload = capability_check()
    payload["requirements"]["capabilities"] = ["future_feature"]
    add("provider.capabilities.unknown-required", "provider.capabilities.check", payload, accepted(reason("UNKNOWN_CAPABILITY")))
    for identity, path, value, code in [
        ("expired", ["evaluated_at"], "2026-10-16T14:00:00.000Z", "EXPIRED_CAPABILITIES"),
        ("future", ["evaluated_at"], "2026-10-16T10:00:00.000Z", "FUTURE_OBSERVATION"),
        ("preparation-mismatch", ["requirements", "preparation_digest"], OTHER, "PREPARATION_MISMATCH"),
        ("os-mismatch", ["requirements", "os", "architecture"], "aarch64", "OS_MISMATCH")]:
        add("provider.capabilities." + identity, "provider.capabilities.check",
            change(capability_check(), path, value), accepted(reason(code)))
    for identity, path, value in [
        ("duplicate-profile", ["profile", "capabilities"], clone(PROFILE["capabilities"]) + [clone(PROFILE["capabilities"][0])]),
        ("duplicate-required", ["requirements", "capabilities"], ["create", "create"]),
        ("empty-required", ["requirements", "capabilities"], []),
        ("unknown-advertised", ["profile", "capabilities", 0, "name"], "future_feature"),
        ("evidence-missing", ["profile", "capabilities", 0, "evidence_digest"], None),
        ("semver-range", ["profile", "pin", "sdk_version"], "^1.2.3"),
        ("integrity-length", ["profile", "pin", "sdk_integrity"], "sha256-AA=="),
        ("integrity-noncanonical", ["profile", "pin", "sdk_integrity"], "sha256-" + "A" * 43),
        ("unknown-profile-field", ["profile", "authority"], "GLOBAL"),
        ("noncanonical-time", ["evaluated_at"], "2026-10-16T12:00:00Z")]:
        add("provider.capabilities." + identity, "provider.capabilities.check",
            change(capability_check(), path, value), rejected)
    for kind in METHODS:
        def inspect(result, kind=kind):
            valid(result)
            expect(result.get("kind") == kind and result.get("operation_id") == "operation-" + kind, result)
            expect(result.get("payload_digest") == operation(kind)["identity"]["payload_digest"], result)
            expect(result.get("requires_reconciliation_before_retry") is (kind in MUTATIONS), result)
        add("provider.operation.valid-" + kind, "provider.operation.validate", operation(kind), accepted(inspect))
    invalid_op("provider.operation.payload-tamper", "create", ["parameters", "resources", "cpu_millis"], 3000, rehash=False)
    invalid_op("provider.operation.unknown-field", "create", ["parameters", "secret"], "fixture-value")
    invalid_op("provider.operation.cpu-fraction", "create", ["parameters", "resources", "cpu_millis"], 1.5)
    invalid_op("provider.operation.cpu-boolean", "create", ["parameters", "resources", "cpu_millis"], True)
    invalid_op("provider.operation.memory-zero", "create", ["parameters", "resources", "memory_bytes"], "0")
    invalid_op("provider.operation.bytes-noncanonical", "create", ["parameters", "resources", "memory_bytes"], "01")
    invalid_op("provider.operation.bytes-overflow", "create", ["parameters", "resources", "memory_bytes"], "9223372036854775808")
    invalid_op("provider.operation.bytes-number", "create", ["parameters", "resources", "memory_bytes"], 4294967296)
    invalid_op("provider.operation.boot-zero", "observe", ["resource", "sandbox_boot_generation"], "0")
    invalid_op("provider.operation.boot-overflow", "observe", ["resource", "sandbox_boot_generation"], "9223372036854775808")
    invalid_op("provider.operation.create-missing-preparation", "create", ["preparation_digest"], None)
    invalid_op("provider.operation.prepare-recipe-mismatch", "prepare", ["parameters", "recipe_digest"], OTHER)
    invalid_op("provider.operation.create-existing-resource", "create", ["resource"], clone(RESOURCE))
    invalid_op("provider.operation.inspect-missing-resource", "inspect", ["resource"], None)
    invalid_op("provider.operation.raw-environment", "execute", ["parameters", "env_refs", "TOKEN"], "fixture-raw-secret")
    invalid_op("provider.operation.path-traversal", "execute", ["parameters", "cwd"], "/work/../etc")
    invalid_op("provider.operation.relative-path", "transfer", ["parameters", "path"], "relative/file")
    invalid_op("provider.operation.infinite-lifetime-with-timeout", "lifetime", ["parameters", "timeout_ms"], 10)
    invalid_op("provider.operation.list-page-too-large", "list", ["parameters", "page_size"], 1001)
    op = operation("lifetime")
    op["parameters"] = {"policy": "BOUNDED", "timeout_ms": 10000}
    resign(op)
    add("provider.operation.bounded-lifetime", "provider.operation.validate", op, accepted(valid))
    op = operation("list")
    op["parameters"]["cursor"] = "eyJvZmZzZXQiOjEwfQ==+/"
    resign(op)
    add("provider.operation.opaque-cursor", "provider.operation.validate", op, accepted(valid))
    op = operation("execute")
    op["parameters"]["argv"] = ["sh", "-c", "printf '%s\\n' \"$1\"\n", "fixture-shell", ""]
    resign(op)
    add("provider.operation.empty-and-multiline-argv", "provider.operation.validate", op, accepted(valid))
    invalid_op("provider.operation.argv-nul", "execute", ["parameters", "argv"], ["sh", "a\u0000b"])
    invalid_op("provider.operation.deadline-invalid", "create", ["deadline_at"], "2026-10-16T13:00:00Z")
    for kind in METHODS:
        add("provider.outcome.succeeded-" + kind, "provider.outcome.validate", succeeded(kind),
            accepted(lambda result: (valid(result), expect(result.get("disposition") == "ACCEPT_OBSERVATION" and
                result.get("resource_observation_only") is True, result))))
    add("provider.outcome.unknown-mutation", "provider.outcome.validate", uncertain(),
        accepted(lambda result: (valid(result), expect(result.get("disposition") == "RECONCILE", result))))
    payload = uncertain()
    payload["outcome"]["resource"] = clone(RESOURCE)
    add("provider.outcome.unknown-early-resource", "provider.outcome.validate", payload, accepted(valid))
    for identity, path, value in [
        ("unknown-blind-retry", ["outcome", "retry"], "BOUNDED"),
        ("unknown-with-result", ["outcome", "result"], {"provider_state": "RUNNING"}),
        ("unknown-not-reconciled", ["outcome", "reconcile_required"], False),
        ("unknown-acceptance", ["outcome", "acceptance"], "CONFIRMED_REJECTED")]:
        add("provider.outcome." + identity, "provider.outcome.validate", change(uncertain(), path, value), rejected)
    failed = uncertain()
    failed["outcome"].update(status="FAILED", acceptance="CONFIRMED_REJECTED", reconcile_required=False, retry="BOUNDED")
    failed["outcome"]["error"].update(code="RATE_LIMIT", retry_after_ms=1000)
    add("provider.outcome.confirmed-rejection-retry", "provider.outcome.validate", failed,
        accepted(lambda result: (valid(result), expect(result.get("disposition") == "RECORD_FAILURE", result))))
    add("provider.outcome.rate-limit-unknown-acceptance", "provider.outcome.validate",
        change(failed, ["outcome", "acceptance"], "UNKNOWN"), rejected)
    add("provider.outcome.nontransient-retry", "provider.outcome.validate",
        change(failed, ["outcome", "error", "code"], "AUTHORIZATION"), rejected)
    unsupported = clone(failed)
    unsupported["outcome"].update(status="UNSUPPORTED", retry="NEVER")
    unsupported["outcome"]["error"].update(code="UNSUPPORTED", retry_after_ms=None)
    add("provider.outcome.explicit-unsupported", "provider.outcome.validate", unsupported,
        accepted(lambda result: (valid(result), expect(result.get("disposition") == "REFUSE_UNSUPPORTED", result))))
    invalid_outcome("provider.outcome.operation-mismatch", "create", ["outcome", "operation_id"], "another-operation")
    invalid_outcome("provider.outcome.payload-mismatch", "create", ["outcome", "payload_digest"], OTHER)
    invalid_outcome("provider.outcome.scope-mismatch", "create", ["outcome", "scope", "environment_id"], "another-env")
    invalid_outcome("provider.outcome.configuration-mismatch", "create", ["outcome", "scope", "configuration_digest"], OTHER)
    invalid_outcome("provider.outcome.boot-mismatch", "inspect", ["outcome", "resource", "sandbox_boot_generation"], "2")
    invalid_outcome("provider.outcome.success-not-accepted", "create", ["outcome", "acceptance"], "UNKNOWN")
    invalid_outcome("provider.outcome.prepare-digest-mismatch", "prepare", ["outcome", "result", "preparation_digest"], OTHER)
    invalid_outcome("provider.outcome.transfer-hash-mismatch", "transfer", ["outcome", "result", "artifact_digest"], OTHER)
    invalid_outcome("provider.outcome.transfer-incomplete", "transfer", ["outcome", "result", "complete"], False)
    invalid_outcome("provider.outcome.lifetime-mismatch", "lifetime", ["outcome", "result", "timeout_ms"], 10)
    invalid_outcome("provider.outcome.stop-not-confirmed", "stop", ["outcome", "result", "termination"], "DETACHED")
    invalid_outcome("provider.outcome.stop-unknown-exit", "stop", ["outcome", "result", "exit_code"], None)
    invalid_outcome("provider.outcome.destroy-not-confirmed", "destroy", ["outcome", "result", "deletion"], "REQUESTED")
    invalid_outcome("provider.outcome.process-unknown-exit", "inspect", ["outcome", "result", "exit_code"], None)
    invalid_outcome("provider.outcome.output-truncated-complete", "inspect", ["outcome", "result", "output", "truncated"], True)
    invalid_outcome("provider.outcome.output-complete-no-hash", "inspect", ["outcome", "result", "output", "sha256"], None)
    invalid_outcome("provider.outcome.profile-from-future", "capabilities", ["outcome", "result", "profile", "observed_at"], FUTURE)
    invalid_outcome("provider.outcome.page-from-future", "list", ["outcome", "result", "page", "observed_at"], FUTURE)
    invalid_outcome("provider.outcome.absent-running", "observe", ["outcome", "result", "health"], "ABSENT")
    started = succeeded("execute")
    started["outcome"]["result"] = {"process_ref": "process-1", "phase": "STARTED", "exit_code": None,
        "timed_out": False, "termination_confirmed": False,
        "output": {"complete": False, "truncated": False, "byte_count": "0", "sha256": None}}
    add("provider.outcome.started-is-observation", "provider.outcome.validate", started, accepted(valid))
    add("provider.outcome.started-is-not-exit", "provider.outcome.validate",
        change(started, ["outcome", "result", "exit_code"], 0), rejected)
    partial_output = succeeded("inspect")
    partial_output["outcome"]["result"]["output"] = {"complete": False, "truncated": True, "byte_count": "9999", "sha256": None}
    add("provider.outcome.retention-incomplete-explicit", "provider.outcome.validate", partial_output, accepted(valid))
    first = page(next_cursor="opaque==+/", more=True, complete=False)
    second = page(cursor="opaque==+/", identity="sandbox-2")
    add("provider.inventory.complete-snapshot", "provider.inventory.validate", inventory([first, second]),
        accepted(inventory_oracle(True, True, 2)))
    partial = page(next_cursor="next-1", more=True, complete=False)
    add("provider.inventory.partial", "provider.inventory.validate", inventory([partial]),
        accepted(inventory_oracle(False, False, 1)))
    best = page()
    best.update(consistency="BEST_EFFORT", snapshot_id=None)
    add("provider.inventory.best-effort-never-absence", "provider.inventory.validate", inventory([best]),
        accepted(inventory_oracle(True, False, 1)))
    empty = page()
    empty["items"] = []
    add("provider.inventory.empty-snapshot", "provider.inventory.validate", inventory([empty]),
        accepted(inventory_oracle(True, True, 0)))
    for identity, pages in [
        ("scope", [change(page(), ["scope", "pool_id"], "other-pool")]),
        ("configuration", [change(page(), ["scope", "configuration_digest"], OTHER)]),
        ("first-cursor", [page(cursor="not-first")]),
        ("broken-chain", [first, page(cursor="wrong-cursor", identity="sandbox-2")]),
        ("duplicate-resource", [first, page(cursor="opaque==+/")]),
        ("snapshot-mismatch", [first, change(second, ["snapshot_id"], "another-snapshot")]),
        ("repeated-cursor", [first, page(cursor="opaque==+/", next_cursor="opaque==+/", more=True, complete=False, identity="sandbox-2")]),
        ("future-observation", [change(page(), ["observed_at"], FUTURE)]),
        ("regressed-time", [change(first, ["observed_at"], NOW), second]),
        ("missing-snapshot-id", [change(page(), ["snapshot_id"], None)]),
        ("best-effort-snapshot-id", [change(page(), ["consistency"], "BEST_EFFORT")]),
        ("has-more-no-cursor", [change(page(), ["has_more"], True)]),
        ("final-extra-cursor", [change(page(), ["next_cursor"], "unexpected")]),
        ("nonfinal-complete", [change(first, ["complete"], True), second]),
        ("unproven-boot-field", [change(page(), ["items", 0, "sandbox_boot_generation"], "1")]),
        ("empty-pages", [])]:
        add("provider.inventory.reject-" + identity, "provider.inventory.validate", inventory(pages), rejected)


class Service:
    def __init__(self, directory):
        policy = {"schema_version": 1, "programme_id": "provider-contract-test", "repository": "fixture/repository",
                  "spec_revision": "fixture-revision", "policy_revision": 1, "status": "ACTIVE",
                  "approval": {"decision": "APPROVED", "record_id": "fixture-owner-approval",
                              "spec_revision": "fixture-revision", "policy_revision": 1},
                  "allowed_roles": ["provisioner"],
                  "allowed_actions": ["programme.provision", "provider.contract.describe", "provider.capabilities.check",
                                      "provider.operation.validate", "provider.outcome.validate", "provider.inventory.validate"]}
        policy_path = directory / "policy.json"
        policy_path.write_text(json.dumps(policy))
        components=directory/"components";components.mkdir()
        for name in ["1.4.json","8.1.json"]:
            (components/name).write_bytes((ROOT/"services/hyperfide/components"/name).read_bytes())
        self.stderr = (directory / "service.stderr").open("w+")
        self.process = subprocess.Popen(
            ["node", "services/hyperfide/dist/provisioner.js", "--policy", str(policy_path),
             "--spec-revision", "fixture-revision", "--components",str(components),
             "--module-root",str(ROOT/"services/hyperfide/dist")], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
             stderr=self.stderr, text=True, start_new_session=True,
             env=dict(os.environ, HYPERFIDE_REQUIRE_SYNC_REPLICA="0"))
        self.sequence = 0

    def request(self, action, payload):
        self.sequence += 1
        request_id = "request-" + str(self.sequence)
        self.process.stdin.write(json.dumps({"id": request_id, "component": "8.1", "action": action, "input": payload},
                                           separators=(",", ":")) + "\n")
        self.process.stdin.flush()
        ready, _, _ = select.select([self.process.stdout], [], [], 10)
        expect(bool(ready), "provisioner response deadline exceeded")
        line = self.process.stdout.readline()
        expect(bool(line), "provisioner ended before response")
        response = json.loads(line)
        expect(response.get("id") == request_id, response)
        return response

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)
        # Rejected protocol requests intentionally latch a nonzero service exit status.
        expect(self.process.returncode == 1, f"expected rejected-request exit1, got {self.process.returncode}")
        expect(self.process.stdout.read() == "", "unexpected extra protocol output")
        self.process.stdout.close()
        self.stderr.seek(0)
        errors = self.stderr.read()
        self.stderr.close()
        expect(errors == "", f"unexpected service stderr: {errors}")


def main():
    define_cases()
    if sys.argv[1:] == ["--inventory"]:
        print(json.dumps(IDS))
        return 0
    expect(not sys.argv[1:], "unknown argument")
    cleanup_complete = False
    service = None
    with tempfile.TemporaryDirectory(prefix="hyperfide-provider-contract-") as path:
        try:
            service = Service(Path(path))
            for identity, action, payload, oracle in CASES:
                actual = "observed"
                try:
                    oracle(service.request(action, payload))
                except Exception as error:
                    actual = f"{type(error).__name__}: {error}"
                    FAILED.append(identity)
                print(json.dumps({"type": "assertion", "id": identity, "expected": "observed", "actual": actual}), flush=True)
            service.close()
            cleanup_complete = True
        finally:
            if service is not None and service.process.poll() is None:
                service.process.kill()
                service.process.wait(timeout=10)
            print(json.dumps({"type": "cleanup", "resources": [], "complete": cleanup_complete}), flush=True)
    return 1 if FAILED or not cleanup_complete else 0


if __name__ == "__main__":
    sys.exit(main())
