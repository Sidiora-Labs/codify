#!/usr/bin/env python3
"""Campaign-driver component checks, not live/provider/corpus qualification."""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tests/hyperfide/campaigns"))
import deterministic as d
IDS, FAILED = [], []

def check(identity, function):
    IDS.append(identity)
    try:
        value = function()
        if value is False:
            raise AssertionError("returned false")
        print(json.dumps({"type": "assertion", "id": identity, "expected": True, "actual": True}))
    except BaseException as exc:
        FAILED.append(identity)
        print(json.dumps({"type": "assertion", "id": identity, "expected": True, "actual": False}))
        print(identity + ": " + type(exc).__name__ + ": " + str(exc), file=sys.stderr)

def reject(function, kind=d.CampaignError):
    try:
        function()
    except kind:
        return True
    raise AssertionError("false-success trap accepted")

def pin(path):
    path = Path(path).resolve()
    data = path.read_bytes()
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}

def trace():
    events = []
    def event(kind, accepted=True, **fields):
        events.append({"sequence": len(events) + 1, "virtual_ms": len(events), "kind": kind, "operation_id": "op" + str(len(events)), "epoch": 1, "accepted": accepted, **fields})
    for number in range(100):
        op = "op" + str(len(events))
        event("create_intent")
        event("provider_observe", resource_id="sandbox" + str(number), create_operation_id=op)
    for start in range(0, 1500, 200):
        for number in range(start, min(start + 200, 1500)):
            event("claim", task_id="task" + str(number), attempt_id="attempt" + str(number), slot_id="slot" + str(number % 200), generation=1)
        for number in range(start, min(start + 200, 1500)):
            event("revoke", task_id="task" + str(number), attempt_id="attempt" + str(number), generation=1)
    for fault in ("stale_generation", "reversed_commits", "unknown_create", "replica_lag", "saturation", "main_loss", "credential_expiry"):
        event("fault_observed", False, fault=fault)
    for number in range(100):
        event("cleanup", resource_id="sandbox" + str(number), confirmed_absent=True)
    events[-1]["virtual_ms"] = 72 * 3600000
    return events

def model(events, sandboxes=100, slots=200):
    value = d.Reference(sandboxes, slots)
    for event in events:
        value.apply(event)
    return value

def small(kind, accepted=True, sequence=1, **fields):
    return {"sequence": sequence, "virtual_ms": sequence, "kind": kind, "operation_id": "small" + str(sequence), "epoch": 1, "accepted": accepted, **fields}

def run():
    check("campaign.deterministic.exact1500-reference", lambda: d.reconstruct(trace(), {"sandboxes": 100, "slots": 200})["session_lifetimes"] == 1500)
    state = model(trace()).state()
    check("campaign.deterministic.200-simultaneous", lambda: state["peak_slots"] == 200)
    check("campaign.deterministic.72-virtual-hours", lambda: state["virtual_elapsed_ms"] == 72 * 3600000)
    check("campaign.deterministic.complete-inventory", lambda: not state["resources"] and not state["owners"] and not state["pending_creates"])
    claim = small("claim", task_id="task", attempt_id="attempt", slot_id="slot", generation=1)
    conflict = small("claim", False, 2, task_id="task", attempt_id="other", slot_id="other", generation=2)
    check("campaign.deterministic.reject-conflicting-owner", lambda: len(model([claim, conflict]).owners) == 1)
    wrong = copy.deepcopy(conflict)
    wrong["accepted"] = True
    check("campaign.deterministic.detect-false-acceptance", lambda: reject(lambda: model([claim, wrong])))
    revoke = small("revoke", True, 2, task_id="task", attempt_id="attempt", generation=1)
    stale = small("claim", False, 3, task_id="task", attempt_id="late", slot_id="slot", generation=1)
    check("campaign.deterministic.stale-generation-fenced", lambda: model([claim, revoke, stale]).state()["owners"] == {})
    overload = small("claim", False, 2, task_id="other", attempt_id="other", slot_id="other", generation=1)
    check("campaign.deterministic.slot-limit", lambda: model([claim, overload], slots=1).peak == 1)
    replica = small("replica_read", True)
    check("campaign.deterministic.replica-cannot-grant", lambda: reject(lambda: model([replica])))
    pending = [small("create_intent"), small("unknown_create", False, 2), small("create_intent", False, 3)]
    check("campaign.deterministic.unknown-create-reservation", lambda: model(pending, sandboxes=1).state()["pending_creates"] == ["small1"])
    duplicate = [small("create_intent"), small("provider_observe", True, 2, resource_id="one", create_operation_id="small1"), small("provider_observe", True, 3, resource_id="two", create_operation_id="small1")]
    check("campaign.deterministic.duplicate-provider-object", lambda: reject(lambda: model(duplicate)))
    cleanup = [small("create_intent"), small("provider_observe", True, 2, resource_id="one", create_operation_id="small1"), small("cleanup", False, 3, resource_id="one", confirmed_absent=False)]
    check("campaign.deterministic.destroying-is-not-clean", lambda: model(cleanup).resources == {"one"})
    effects = [small("effect", effect_key="same"), small("effect", False, 2, effect_key="same")]
    check("campaign.deterministic.duplicate-effects", lambda: len(model(effects).effects) == 1)
    revision = "a" * 40
    publication = [claim, small("submit", True, 2, task_id="task", attempt_id="attempt", generation=1, revision=revision), small("qualify", True, 3, task_id="task", revision=revision, evidence_valid=True), small("publish", True, 4, task_id="task", revision=revision, ref="refs/heads/main", expected_head=None, gateway_authorised=True), small("publish", False, 5, task_id="task", revision=revision, ref="refs/heads/main", expected_head=None, gateway_authorised=True)]
    check("campaign.deterministic.git-cas-lost-ack", lambda: model(publication).publications == {"refs/heads/main": revision})
    unsigned = copy.deepcopy(publication[:4]);unsigned[-1]["gateway_authorised"] = False
    check("campaign.deterministic.worker-push-rejected", lambda: reject(lambda: model(unsigned)))
    restored = publication[:3] + [small("epoch", True, 4, new_epoch=2), small("publish", False, 5, task_id="task", revision=revision, ref="refs/heads/main", expected_head=None, gateway_authorised=True)]
    check("campaign.deterministic.restore-fences-old-proof", lambda: not model(restored).publications)
    reversed_events = copy.deepcopy(trace()[:2]);reversed_events[1]["sequence"] = 1
    check("campaign.deterministic.reordered-observations", lambda: reject(lambda: model(reversed_events)))
    check("campaign.deterministic.unknown-event", lambda: reject(lambda: model([small("invented", False)])))
    check("campaign.deterministic.duplicate-json-rejected", lambda: reject(lambda: d.decode('{"same":1,"same":2}')))
    check("campaign.deterministic.nonfinite-json-rejected", lambda: reject(lambda: d.decode('{"x":NaN}')))
    profile = {"sandboxes":100,"slots":200,"session_lifetimes":1500,"virtual_hours":72}
    commands = d.schedule(profile, 17)
    check("campaign.deterministic.seeded-schedule", lambda: commands == d.schedule(profile, 17) and commands != d.schedule(profile, 19))
    check("campaign.deterministic.schedule-workload-count", lambda: len([row for row in commands if row["operation"] == "session"]) == 1500)
    metric = {"workload_digest":"w","environment_digest":"e","units":"ms","measurement_kind":"REPLAY", **{key:1 for key in ("p50","p95","p99","throughput","error_count","connection_peak","lock_wait_count")}}
    check("campaign.deterministic.baseline-descriptive", lambda: d.compare_metrics(metric, metric)["performance_claim"] == "DESCRIPTIVE_ONLY")
    other = {**metric,"environment_digest":"different"}
    check("campaign.deterministic.incomparable-baseline", lambda: reject(lambda: d.compare_metrics(metric, other)))
    with tempfile.TemporaryDirectory(prefix="hyperfide-campaign-component-") as temp:
        root = Path(temp)
        corpus = root / "synthetic-component-input.kvx"
        corpus.write_text('[meta]\nname = "component fixture only"\n')
        record = pin(corpus)
        check("campaign.deterministic.corpus-pin", lambda: d.pinned_file(record, root)[1] == corpus.read_bytes())
        corpus.write_text("changed component fixture")
        check("campaign.deterministic.corpus-tamper", lambda: reject(lambda: d.pinned_file(record, root)))
        fixture = root / "component-command.py"
        fixture.write_text('import hashlib,json,sys,time\ndata=sys.stdin.buffer.read();q=json.loads(data)\nif q.get("mode")=="timeout":time.sleep(5)\nif q.get("mode")=="exit":raise SystemExit(7)\nprint(json.dumps({"schema_version":1,"request_sha256":hashlib.sha256(data).hexdigest() if q.get("mode")!="wrong" else "0"*64,"value":42}))\n')
        spec = {"argv":[str(Path(sys.executable).resolve()),str(fixture)],"cwd":str(root),"pins":[pin(sys.executable),pin(fixture)],"timeout_seconds":1,"required_env":[]}
        def adapter(name, specification=None):
            return d.CommandAdapter(specification or spec, root, root / name)
        check("campaign.deterministic.actual-command-boundary", lambda: adapter("command").call({"mode":"ok"})[0]["value"] == 42)
        check("campaign.deterministic.command-failure", lambda: reject(lambda: adapter("exit").call({"mode":"exit"})))
        check("campaign.deterministic.wrong-request-binding", lambda: reject(lambda: adapter("wrong").call({"mode":"wrong"})))
        missing = {**spec,"required_env":["HYPERFIDE_COMPONENT_UNSET_AUTH_REFERENCE"]}
        os.environ.pop("HYPERFIDE_COMPONENT_UNSET_AUTH_REFERENCE", None)
        check("campaign.deterministic.missing-auth-blocks", lambda: reject(lambda: adapter("auth", missing), d.Blocked))
        timeout = {**spec,"timeout_seconds":0.05}
        check("campaign.deterministic.timeout-is-unknown", lambda: reject(lambda: adapter("timeout", timeout).call({"mode":"timeout"}), d.Blocked))
        check("campaign.deterministic.unknown-intent-retained", lambda: len(list((root/"timeout").glob("*/unknown.json"))) == 1 and len(list((root/"timeout").glob("*/intent.json"))) == 1)
        unpinned = {**spec,"pins":[pin(fixture)]}
        check("campaign.deterministic.unpinned-executable", lambda: reject(lambda: adapter("unpinned", unpinned)))
    with tempfile.TemporaryDirectory(prefix="hyperfide-manifest-component-") as temporary:
        folder = Path(temporary)
        corpus = folder / "component-only.kvx"
        corpus.write_text('[meta]'+chr(10)+'name = "component only"'+chr(10))
        repositories = [{"repository_id":"00000000-0000-0000-0000-000000000001", "candidate_head":"a"*40, "input_manifest_digest":"sha256:"+"b"*64}]
        source = folder / "source-set.json"
        source.write_bytes(d.canonical(repositories))
        value = {"schema_version":1, "campaign_id":"component-input-validation", "kind":"deterministic", "source_revision":"a"*40, "source_manifest_digest":"sha256:"+d.digest(d.canonical(repositories)), "approval":{"approved":True,"kind":"deterministic"}, "profile":{"sandboxes":100,"slots":200,"session_lifetimes":1500,"virtual_hours":72}, "inputs":{"planning":[pin(corpus)],"graph":[pin(corpus)],"source_manifest":[pin(source)]},"adapters":{},"seeds":[17,19]}
        manifest_path = folder / "profile.json"
        def load(candidate):
            manifest_path.write_text(json.dumps(candidate))
            return d.load_manifest(manifest_path,"deterministic")
        check("campaign.deterministic.pinned-source-manifest",lambda:load(value)[0]["source_manifest_digest"]==value["source_manifest_digest"])
        changed=copy.deepcopy(value);changed["approval"]["approved"]=False
        check("campaign.deterministic.unapproved-manifest",lambda:reject(lambda:load(changed)))
        changed=copy.deepcopy(value);changed["source_manifest_digest"]=changed["source_manifest_digest"][7:]
        check("campaign.deterministic.actual19-digest-prefix",lambda:reject(lambda:load(changed)))
        changed=copy.deepcopy(value);changed["inputs"].pop("graph")
        check("campaign.deterministic.approved-corpus-required",lambda:reject(lambda:load(changed)))
        changed=copy.deepcopy(value);changed["source_manifest_digest"]="sha256:"+"f"*64
        check("campaign.deterministic.source-set-hash-mismatch",lambda:reject(lambda:load(changed)))
        load(value)
        check("campaign.deterministic.missing-real-bridges-block",lambda:reject(lambda:d.run(manifest_path,folder/"evidence"),d.Blocked))
    if "--list-assertions" in sys.argv:
        print(json.dumps(IDS))
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}))
    return int(bool(FAILED))

if __name__ == "__main__":
    raise SystemExit(run())
