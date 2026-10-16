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
        # Detect changed executables/scripts between campaign calls.
        for pin in self.spec["pins"]:
            pinned_file(pin, self.root)
        operation = str(uuid.uuid4())
        directory = self.evidence / operation
        directory.mkdir(mode=0o700)
        body = canonical(request) + b"\n"
        sealed_write(directory / "intent.json", {"operation_id": operation, "at": utc(), "argv": self.spec["argv"], "cwd": self.spec["cwd"], "request_sha256": digest(body), "request": request})
        started = time.monotonic_ns()
        if request.get("source_revision"):
            actual = subprocess.run(["git", "-C", self.spec["cwd"], "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10)
            require(actual.returncode == 0 and actual.stdout.strip() == request["source_revision"], "actual adapter source revision differs from campaign pin")
        child = subprocess.Popen(self.spec["argv"], cwd=self.spec["cwd"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        try:
            stdout, stderr = child.communicate(body, timeout=self.spec["timeout_seconds"])
        except subprocess.TimeoutExpired as exc:
            os.killpg(child.pid, signal.SIGKILL)
            try:
                child.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            sealed_write(directory / "unknown.json", {"operation_id": operation, "status": "UNKNOWN", "reason": "adapter timeout; remote mutation may have occurred", "at": utc()})
            raise Blocked("adapter outcome UNKNOWN; reconcile operation " + operation + " before retry") from exc
        for name, data in (("stdout", stdout), ("stderr", stderr)):
            with (directory / (name + ".bin")).open("xb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        receipt = {"operation_id": operation, "exit_code": child.returncode, "duration_ns": time.monotonic_ns() - started, "stdout_sha256": digest(stdout), "stderr_sha256": digest(stderr), "at": utc()}
        sealed_write(directory / "outcome.json", receipt)
        require(child.returncode == 0, "actual adapter command failed; inspect private operation receipt " + operation)
        result = decode(stdout)
        require(isinstance(result, dict) and result.get("schema_version") == 1, "invalid adapter result")
        require(result.get("request_sha256") == digest(body), "adapter observation does not bind exact request")
        return result, receipt

class Reference:
    """Reference semantics use attempted events, never the reported accepted flag."""
    def __init__(self, sandboxes=100, slots=200):
        self.limit, self.sandbox_limit = slots, sandboxes
        self.epoch, self.owners, self.slots, self.generations = 1, {}, {}, {}
        self.resources, self.intents, self.publications, self.effects = set(), set(), {}, set()
        self.pending_creates, self.observed_creates, self.attempts, self.faults = set(), {}, set(), set()
        self.submitted, self.qualified = {}, set()
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
            accepted = event.get("epoch") == self.epoch and task not in self.owners and slot not in self.slots and len(self.slots) < self.limit and generation > self.generations.get(task, 0)
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
                    self.submitted[task] = (event["revision"], owner[0], owner[1])
                self.owners.pop(task)
                self.slots.pop(owner[2])
        elif kind == "qualify":
            task = event.get("task_id")
            submitted = self.submitted.get(task)
            accepted = event.get("epoch") == self.epoch and submitted is not None and submitted[0] == event.get("revision") and event.get("evidence_valid") is True
            if accepted:
                self.qualified.add((task, event["revision"]))
        elif kind == "publish":
            task, revision, ref = event.get("task_id"), event.get("revision"), event.get("ref")
            require(isinstance(ref, str) and ref, "protected ref identity required")
            accepted = event.get("epoch") == self.epoch and (task, revision) in self.qualified and event.get("gateway_authorised") is True and self.publications.get(ref) == event.get("expected_head")
            if accepted:
                self.publications[ref] = revision
        elif kind == "epoch":
            epoch = integer(event.get("new_epoch"), "restore epoch")
            accepted = epoch > self.epoch
            if accepted:
                self.epoch = epoch
                self.owners.clear()
                self.slots.clear()
                # A restore requires fresh evidence/custody, not rewound qualification.
                self.qualified.clear()
                self.submitted.clear()
        elif kind == "create_intent":
            accepted = op not in self.intents and len(self.resources) + len(self.pending_creates) < self.sandbox_limit
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
            accepted = key not in self.effects
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
        return {"epoch": self.epoch, "owners": {key: list(value) for key, value in sorted(self.owners.items())}, "slots": dict(sorted(self.slots.items())), "resources": sorted(self.resources), "publications": dict(sorted(self.publications.items())), "effect_count": len(self.effects), "accepted_count": self.accepted, "peak_slots": self.peak, "session_lifetimes": len(self.attempts), "pending_creates": sorted(self.pending_creates), "faults": sorted(self.faults), "virtual_elapsed_ms": self.last_time}

def reconstruct(events, profile):
    require(isinstance(events, list) and events, "nonempty independently observed event stream required")
    reference = Reference(profile["sandboxes"], profile["slots"])
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
    require(isinstance(current, dict) and isinstance(baseline, dict), "comparable metric records required")
    for key in ("workload_digest", "environment_digest", "units", "measurement_kind"):
        require(key in current and current[key] == baseline.get(key), "baseline parity mismatch: " + key)
    result = {"performance_claim": "DESCRIPTIVE_ONLY", "units": current["units"]}
    for key in ("p50", "p95", "p99", "throughput", "error_count", "connection_peak", "lock_wait_count"):
        a, b = current.get(key), baseline.get(key)
        require(type(a) in (int, float) and type(b) in (int, float) and a >= 0 and b >= 0, "complete nonnegative measured metric required: " + key)
        require(a < float("inf") and b < float("inf"), "nonfinite metric")
        result[key] = {"current": a, "baseline": b, "ratio": a / b if b else None}
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
        require(not state["owners"] and not state["slots"] and not state["resources"] and not state["pending_creates"], "incomplete final cleanup/inventory or unresolved creates")
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
