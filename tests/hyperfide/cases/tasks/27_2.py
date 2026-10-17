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
EPOCH1="11111111-1111-4111-8111-111111111111"
EPOCH2="22222222-2222-4222-8222-222222222222"
DEPLOYMENT="33333333-3333-4333-8333-333333333333"
ACTIVATION="44444444-4444-4444-8444-444444444444"
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
        events.append({"sequence": len(events) + 1, "virtual_ms": len(events), "kind": kind, "operation_id": "op" + str(len(events)), "epoch": EPOCH1, "accepted": accepted, **fields})
    for number in range(100):
        op = "op" + str(len(events))
        event("create_intent")
        event("provider_observe", resource_id="sandbox" + str(number), create_operation_id=op)
    for start in range(0, 1500, 200):
        for number in range(start, min(start + 200, 1500)):
            event("claim", task_id="task" + str(number), attempt_id="attempt" + str(number), slot_id="slot" + str(number % 200), generation=1)
        for number in range(start, min(start + 200, 1500)):
            event("revoke", task_id="task" + str(number), attempt_id="attempt" + str(number), generation=1)
    for fault in d.REQUIRED_FAULTS:
        event("fault_observed", False, fault=fault)
    for number in range(100):
        event("cleanup", resource_id="sandbox" + str(number), confirmed_absent=True)
    events[-1]["virtual_ms"] = 72 * 3600000
    return events

def model(events, sandboxes=100, slots=200):
    value = d.Reference(sandboxes, slots, EPOCH1, DEPLOYMENT)
    for event in events:
        value.apply(event)
    return value

def small(kind, accepted=True, sequence=1, **fields):
    return {"sequence": sequence, "virtual_ms": sequence, "kind": kind, "operation_id": "small" + str(sequence), "epoch": EPOCH1, "accepted": accepted, **fields}

def activation(sequence=1):
    receipt={'deployment_id':DEPLOYMENT,'operation_id':ACTIVATION,'source_epoch':EPOCH1,'fence_id':'component-real-contract-fence','isolated_writer':'component-previous-writer','observed_at':'2026-10-16T12:00:00Z','expires_at':'2026-10-16T12:00:30Z','evidence_digest':'sha256:'+'c'*64}
    raw=json.dumps(receipt,ensure_ascii=False,separators=(',',':'))
    request={'deployment_id':DEPLOYMENT,'operation_id':ACTIVATION,'expected_previous_epoch':EPOCH1}
    request_digest='sha256:'+d.digest(json.dumps(request,ensure_ascii=False,separators=(',',':')).encode())
    proof={'activation':{'operation_id':ACTIVATION,'deployment_id':DEPLOYMENT,'epoch':EPOCH2,'request_digest':request_digest,'accepted_at':'2026-10-16T12:00:01Z'},'authority_epoch':{'deployment_id':DEPLOYMENT,'epoch':EPOCH2,'previous_epoch':EPOCH1,'state':'ACTIVE','fence_id':receipt['fence_id'],'proof_digest':'sha256:'+d.digest(raw.encode()),'activated_at':'2026-10-16T12:00:01Z'},'previous_authority_epoch':{'deployment_id':DEPLOYMENT,'epoch':EPOCH1,'state':'REVOKED'},'fencer_receipt_json':raw}
    return small('epoch',True,sequence,operation_id=ACTIVATION,new_epoch=EPOCH2,activation_proof=proof)

def mixed_load_checks():
    profile={"sandboxes":100,"slots":200,"session_lifetimes":1500,"virtual_hours":72,"readers":300,"initial_authority_epoch":EPOCH1,"deployment_id":DEPLOYMENT}
    sweep_profile={**d.SWEEP_PROFILE,"initial_authority_epoch":EPOCH1,"deployment_id":DEPLOYMENT}
    check("campaign.deterministic.required-fault-set",lambda:{"db_failover","sandbox_loss","main_loss","credential_expiry","replica_lag","unknown_create","stale_generation","reversed_commits","saturation"}==set(d.REQUIRED_FAULTS) and {row["fault"] for row in d.schedule(profile,17) if row["operation"]=="fault"}==set(d.REQUIRED_FAULTS))
    report=d.simulate(profile,[17,19])
    check("campaign.deterministic.multi-seed-reference-simulation",lambda:report["evidence_scope"]=="SIMULATION_ONLY" and report["live_frontier_qualified"] is False and [row["seed"] for row in report["seeds"]]==[17,19] and all(row["peak_slots"]==200 and row["simulated_agents"]==1500 and row["virtual_elapsed_ms"]==72*3600000 and row["wall_clock_ns"]>0 for row in report["seeds"]) and report["seeds"][0]["trace_sha256"]!=report["seeds"][1]["trace_sha256"])
    check("campaign.deterministic.hundreds-of-readers",lambda:all(row["reader_sessions"]==300 for row in report["seeds"]) and len([row for row in d.schedule(profile,17) if row["operation"]=="read"])==300)
    replica_grant=small("read",True,reader_id="reader",source="replica")
    check("campaign.deterministic.replica-read-not-authoritative",lambda:reject(lambda:model([replica_grant])) and model([small("read",True,reader_id="reader",source="primary")]).state()["authoritative_reads"]==1)
    claim=small("claim",task_id="task",attempt_id="attempt",slot_id="slot",generation=1)
    late=small("heartbeat",False,3,task_id="task",attempt_id="attempt",generation=1)
    check("campaign.deterministic.stale-heartbeat-fenced",lambda:model([claim,small("revoke",True,2,task_id="task",attempt_id="attempt",generation=1),late]).state()["owners"]=={} and reject(lambda:model([claim,small("revoke",True,2,task_id="task",attempt_id="attempt",generation=1),{**late,"accepted":True}])))
    events,_=d.mixed_trace(sweep_profile,17)
    unlabelled=copy.deepcopy(events);next(row for row in unlabelled if row["kind"]=="claim")["agent_kind"]="LIVE"
    check("campaign.deterministic.simulated-agents-labelled",lambda:all(row["agent_kind"]=="SIMULATED" for row in d.schedule(profile,17) if row["operation"]=="session") and d.require_simulated_agents(events)==400 and reject(lambda:d.require_simulated_agents(unlabelled)))
    larger={**profile,"session_lifetimes":3000}
    check("campaign.deterministic.no-fixed-start-history-limit",lambda:d.reconstruct(d.mixed_trace(larger,23)[0],larger)["session_lifetimes"]==3000 and len([row for row in d.schedule(larger,23) if row["operation"]=="session"])==3000)
    sweep=d.sweep(sweep_profile,17)
    check("campaign.deterministic.sweep-dimensions",lambda:len(sweep)==3*3*3*2 and {tuple(sorted(row["point"].items())) for row in sweep}=={tuple(sorted(point.items())) for point in d.sweep_points()} and {row["point"]["write_read_ratio"] for row in sweep}=={"1:9","1:1","9:1"})
    saturated=[row for row in sweep if row["point"]["concurrency"]==250]
    check("campaign.deterministic.sweep-invariants-under-saturation",lambda:saturated and all(row["peak_slots"]==200 and row["metrics"]["lock_wait_count"]!="0" for row in saturated))
    check("campaign.deterministic.graph-batching-avoids-amplification",lambda:all(row["graph_round_trips"]==-(-5000//row["point"]["batch_size"]) for row in sweep) and all(row["graph_round_trips"]<row["per_symbol_round_trips"] for row in sweep if row["point"]["batch_size"]>1) and all(row["graph_round_trips"]==row["per_symbol_round_trips"] for row in sweep if row["point"]["batch_size"]==1))
    from decimal import Decimal
    check("campaign.deterministic.sweep-latency-distribution",lambda:all(Decimal(row["metrics"]["p50"])<=Decimal(row["metrics"]["p95"])<=Decimal(row["metrics"]["p99"]) and 0<Decimal(row["metrics"]["reader_fairness_jain"])<=1 and int(row["metrics"]["connection_peak"])<=d.SIMULATED_POOL and row["metrics"]["query_plans"]=="NOT_OBSERVED_IN_SIMULATION" for row in sweep))
    simulated={**sweep[0]["metrics"],"workload_digest":"a"*64,"environment_digest":"b"*64,"provenance_digest":"c"*64}
    check("campaign.deterministic.simulated-metrics-not-baseline",lambda:reject(lambda:d.compare_metrics(simulated,simulated)))
    combinations=d.fault_combinations(17)
    replay=d.replay_faults(sweep_profile,17,combinations)
    check("campaign.deterministic.fault-combinations-match-single-fault",lambda:len(replay)==len(combinations)>=36 and all(set(row["injected"])==set(row["faults"]) for row in replay) and tuple(replay[-1]["faults"])==d.REQUIRED_FAULTS)
    check("campaign.deterministic.fault-seed-reproduces",lambda:d.replay_faults(sweep_profile,17,combinations[:3])==replay[:3] and d.fault_combinations(17)==combinations and d.replay_faults(sweep_profile,19,combinations[:1])[0]["trace_sha256"]!=replay[0]["trace_sha256"])
    hostile,_=d.mixed_trace(sweep_profile,17,("reversed_commits",));next(row for row in hostile if row.get("injected"))["accepted"]=True
    check("campaign.deterministic.malicious-acceptance-detected",lambda:reject(lambda:d.reconstruct(hostile,sweep_profile)))
    backlog,_=d.mixed_trace(sweep_profile,17,("sandbox_loss",));backlog=[row for row in backlog if not (row["kind"]=="cleanup" and row.get("recovery")=="sandbox_loss")]
    for number,row in enumerate(backlog):row["sequence"]=number+1
    check("campaign.deterministic.no-hidden-backlog",lambda:reject(lambda:d.check_invariants(backlog,d.reconstruct(backlog,sweep_profile),sweep_profile,("sandbox_loss",))))

def parity_checks():
    import parity
    check("campaign.parity.inventory-matches-registry",lambda:all(parity.assertion_ids(case)==parity.registered_ids(case) and len(set(parity.assertion_ids(case)))==count for case,count in (("V-020",34),("V-025",23))))
    with tempfile.TemporaryDirectory(prefix="hyperfide-parity-component-") as temporary:
        root=Path(temporary)
        candidate=root/"candidate";candidate.mkdir()
        (candidate/"README").write_text("component candidate checkout")
        git=["git","-C",str(candidate),"-c","user.name=component","-c","user.email=component@example.invalid"]
        subprocess.run(["git","init","-q",str(candidate)],check=True);subprocess.run(git+["add","README"],check=True);subprocess.run(git+["commit","-qm","component"],check=True)
        revision=subprocess.run(["git","-C",str(candidate),"rev-parse","HEAD"],capture_output=True,text=True,check=True).stdout.strip()
        files={name:root/(name+".bin") for name in ("corpus","snapshot","configuration","legacy_toolchain")}
        for name,path in files.items():path.write_text("component "+name)
        bridge=root/"bridge.py"
        bridge.write_text("import hashlib,json,sys\nfrom pathlib import Path\ndata=sys.stdin.buffer.read();q=json.loads(data);modes=set(sys.argv[2:]);side=sys.argv[1]\ndigests={k:[p['sha256'] for p in v] for k,v in sorted(q['inputs'].items()) if k!='golden'}\nobservation={'holds':True,'evidence':['component-fixture'],'check':q['check']}\nif side=='candidate' and 'diverge' in modes and q['check'] in('rank-order','typed-row-preservation'):observation['rank']='different'\nif 'tamper' in modes:Path(q['inputs']['configuration'][0]['path']).write_text('tampered')\nprimary=digests.get('corpus',digests.get('snapshot'))\nprint(json.dumps({'schema_version':1,'request_sha256':hashlib.sha256(data).hexdigest(),'source_revision':q.get('source_revision',q.get('legacy_revision')),'input_digests':digests,'toolchain_sha256':q['inputs']['legacy_toolchain'][0]['sha256'],'observation':observation,'provenance':primary,'cleanup':{'complete':True,'remaining':['leaked']if 'leak' in modes else[]}}))\n")
        def adapter(side,*modes):
            return {"argv":[str(Path(sys.executable).resolve()),str(bridge),side,*modes],"cwd":str(candidate if side=="candidate" else root),"pins":[pin(sys.executable),pin(bridge)],"timeout_seconds":20,"required_env":[]}
        def manifest(case,legacy=(),candidate_modes=(),differences=(),adapters=None):
            primary="corpus" if case=="V-020" else "snapshot"
            value={"schema_version":1,"case":case,"campaign_id":"component-"+case,"source_revision":revision,"legacy_revision":"legacy-component-1","approval":{"approved":True,"kind":"parity","case":case},
                   "inputs":{name:[pin(files[name])] for name in (primary,"configuration","legacy_toolchain")},"adapters":adapters if adapters is not None else {"legacy":adapter("legacy",*legacy),"candidate":adapter("candidate",*candidate_modes)},"approved_differences":list(differences)}
            path=root/("parity-"+case+"-"+str(len(list(root.glob("parity-*.json"))))+".json");path.write_text(json.dumps(value))
            return path,hashlib.sha256(path.read_bytes()).hexdigest()
        def execute(case,**options):
            path,sha=manifest(case,**options)
            return parity.run_case(case,path,root/"evidence"/path.stem,sha)
        def status(results,name):
            return [row for key,row in results.items() if key.endswith("."+name)][0]["status"]
        check("campaign.parity.component-bridges-pass",lambda:all(row["status"]=="PASS" for case in ("V-020","V-025") for row in execute(case).values()))
        path,_=manifest("V-025")
        check("campaign.parity.unapproved-manifest-digest-blocks",lambda:reject(lambda:parity.run_case("V-025",path,root/"evidence"/"unbound",None),d.Blocked) and reject(lambda:parity.run_case("V-025",path,root/"evidence"/"wrong","0"*64),d.Blocked))
        def absent():
            campaign=root/"campaign";campaign.mkdir(exist_ok=True);(campaign/"manifest.json").write_text(json.dumps({"policy":{"approved_parity_manifest_sha256":None}}))
            env={key:value for key,value in os.environ.items() if key!=parity.manifest_env("V-020")};env["HYPERFIDE_CAMPAIGN_DIR"]=str(campaign)
            result=subprocess.run([sys.executable,str(ROOT/"tests/hyperfide/cases/parity/v020.py")],capture_output=True,text=True,env=env,timeout=60)
            rows=[json.loads(line) for line in result.stdout.splitlines()]
            asserted=[row for row in rows if row["type"]=="assertion"]
            return result.returncode==2 and len(asserted)==34 and all(row["actual"]["status"]=="BLOCKED" for row in asserted) and rows[-1]=={"type":"cleanup","resources":[],"complete":True}
        check("campaign.parity.absent-manifest-blocks-without-pass",absent)
        partial,sha=manifest("V-025",adapters={"candidate":adapter("candidate")})
        check("campaign.parity.missing-bridge-blocks",lambda:reject(lambda:parity.run_case("V-025",partial,root/"evidence"/"partial",sha),d.Blocked))
        diverged=execute("V-025",candidate_modes=("diverge",))
        check("campaign.parity.semantic-difference-fails",lambda:status(diverged,"typed-row-preservation")=="FAIL" and status(diverged,"approved-differences-only")=="FAIL" and status(diverged,"actual-import-readback")=="PASS")
        row=[value for key,value in diverged.items() if key.endswith(".typed-row-preservation")][0]
        exact={"assertion_id":"parity.v025.typed-row-preservation","legacy_sha256":row["legacy_sha256"],"candidate_sha256":row["candidate_sha256"],"reason":"component approved difference","approved_by":"component-reviewer"}
        approved=execute("V-025",candidate_modes=("diverge",),differences=[exact])
        wrong=execute("V-025",candidate_modes=("diverge",),differences=[{**exact,"candidate_sha256":"0"*64}])
        check("campaign.parity.exact-approved-difference-only",lambda:all(value["status"]=="PASS" for value in approved.values()) and status(wrong,"typed-row-preservation")=="FAIL" and status(wrong,"approved-differences-only")=="FAIL")
        tampered=execute("V-025",candidate_modes=("tamper",))
        files["configuration"].write_text("component configuration")
        leaked=execute("V-025",legacy=("leak",))
        check("campaign.parity.input-tamper-and-cleanup-detected",lambda:status(tampered,"original-archive-retained")=="FAIL" and status(leaked,"complete-cleanup")=="FAIL" and status(leaked,"typed-row-preservation")=="PASS")

def run():
    check("campaign.deterministic.exact1500-reference", lambda: d.reconstruct(trace(), {"sandboxes": 100, "slots": 200, "initial_authority_epoch":EPOCH1,"deployment_id":DEPLOYMENT})["session_lifetimes"] == 1500)
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
    publication = [claim, small("submit", True, 2, task_id="task", attempt_id="attempt", generation=1, custody_generation=1, revision=revision), small("qualify", True, 3, task_id="task", attempt_id="attempt", generation=1, custody_generation=1, revision=revision, evidence_valid=True), small("publish", True, 4, task_id="task", revision=revision, ref="refs/heads/main", expected_head=None, gateway_authorised=True), small("publish", False, 5, task_id="task", revision=revision, ref="refs/heads/main", expected_head=None, gateway_authorised=True)]
    check("campaign.deterministic.git-cas-lost-ack", lambda: model(publication).publications == {"refs/heads/main": revision})
    unsigned = copy.deepcopy(publication[:4]);unsigned[-1]["gateway_authorised"] = False
    check("campaign.deterministic.worker-push-rejected", lambda: reject(lambda: model(unsigned)))
    restored = publication[:3] + [activation(4), small("publish", False, 5, task_id="task", revision=revision, ref="refs/heads/main", expected_head=None, gateway_authorised=True)]
    check("campaign.deterministic.restore-fences-old-proof", lambda: not model(restored).publications)
    custody_claim = small("claim", False, 3, task_id="task", attempt_id="new", slot_id="new", generation=2)
    check("campaign.deterministic.submission-retains-custody", lambda: bool(model(publication[:2]+[custody_claim]).state()["custody"]))
    bad_custody=copy.deepcopy(publication[:3]);bad_custody[-1]["custody_generation"]=2
    check("campaign.deterministic.qualification-custody-fenced", lambda: reject(lambda:model(bad_custody)))
    release=small("custody_expire",True,3,task_id="task",attempt_id="attempt",generation=1,custody_generation=1)
    reclaim=small("claim",True,4,task_id="task",attempt_id="new",slot_id="new",generation=2)
    check("campaign.deterministic.custody-expiry-releases-task",lambda:model(publication[:2]+[release,reclaim]).owners["task"][0]=="new")
    old_effect=small("effect",False,2,effect_key="stale")
    check("campaign.deterministic.restore-rejects-old-effects",lambda:not model([activation(),old_effect]).effects)
    fresh_claim=small("claim",True,3,task_id="task",attempt_id="fresh",slot_id="fresh",generation=1);fresh_claim["epoch"]=EPOCH2
    check("campaign.deterministic.restore-resets-epoch-generations",lambda:model([claim,activation(2),fresh_claim]).owners["task"][0]=="fresh")
    prior_effect=small("effect",True,effect_key="external");replay=small("effect",False,3,effect_key="external");replay["epoch"]=EPOCH2
    check("campaign.deterministic.restore-preserves-effect-idempotency",lambda:model([prior_effect,activation(2),replay]).effects=={"external"})
    fresh=small('epoch',True,new_epoch=EPOCH2)
    check('campaign.deterministic.fresh-uuid-is-not-authority',lambda:reject(lambda:model([fresh])))
    predecessor=activation();predecessor['activation_proof']['authority_epoch']['previous_epoch']='55555555-5555-4555-8555-555555555555'
    check('campaign.deterministic.activation-predecessor-cas',lambda:reject(lambda:model([predecessor])))
    wrong_digest=activation();wrong_digest['activation_proof']['activation']['request_digest']='sha256:'+'f'*64
    check('campaign.deterministic.actual-activation-request-digest',lambda:reject(lambda:model([wrong_digest])))
    boolean_writer=activation();proof=boolean_writer['activation_proof'];receipt=json.loads(proof['fencer_receipt_json']);receipt['isolated_writer']=True;proof['fencer_receipt_json']=json.dumps(receipt,separators=(',',':'));proof['authority_epoch']['proof_digest']='sha256:'+d.digest(proof['fencer_receipt_json'].encode())
    check('campaign.deterministic.fenced-writer-is-identity-not-boolean',lambda:reject(lambda:model([boolean_writer])))
    replay_epoch=small('epoch',False,2,epoch=EPOCH2,new_epoch=EPOCH1)
    check('campaign.deterministic.superseded-uuid-cannot-return',lambda:model([activation(),replay_epoch]).epoch==EPOCH2)
    reversed_events = copy.deepcopy(trace()[:2]);reversed_events[1]["sequence"] = 1
    check("campaign.deterministic.reordered-observations", lambda: reject(lambda: model(reversed_events)))
    check("campaign.deterministic.unknown-event", lambda: reject(lambda: model([small("invented", False)])))
    check("campaign.deterministic.duplicate-json-rejected", lambda: reject(lambda: d.decode('{"same":1,"same":2}')))
    check("campaign.deterministic.nonfinite-json-rejected", lambda: reject(lambda: d.decode('{"x":NaN}')))
    profile = {"sandboxes":100,"slots":200,"session_lifetimes":1500,"virtual_hours":72,"readers":300,"initial_authority_epoch":EPOCH1,"deployment_id":DEPLOYMENT,"authority_contract":"04-journal-v1"}
    commands = d.schedule(profile, 17)
    check("campaign.deterministic.seeded-schedule", lambda: commands == d.schedule(profile, 17) and commands != d.schedule(profile, 19))
    check("campaign.deterministic.schedule-workload-count", lambda: len([row for row in commands if row["operation"] == "session"]) == 1500)
    metric = {"workload_digest":"a"*64,"environment_digest":"b"*64,"provenance_digest":"c"*64,"sample_count":3,"quantile_basis":"HISTOGRAM_UPPER_BOUND","units":{"p50":"ms","p95":"ms","p99":"ms","throughput":"1/s","error_count":"count","connection_peak":"count","lock_wait_count":"count"},"measurement_kind":"REPLAY", **{key:"1" for key in ("p50","p95","p99","throughput","error_count","connection_peak","lock_wait_count")}}
    check("campaign.deterministic.baseline-descriptive", lambda: d.compare_metrics(metric, metric)["performance_claim"] == "DESCRIPTIVE_ONLY")
    other = {**metric,"environment_digest":"different"}
    check("campaign.deterministic.incomparable-baseline", lambda: reject(lambda: d.compare_metrics(metric, other)))
    check("campaign.deterministic.histogram-bound-semantics", lambda:d.compare_metrics(metric,metric)["quantile_basis"]=="HISTOGRAM_UPPER_BOUND" and d.compare_metrics(metric,metric)["p95"]["current"]=="1")
    exact={**metric,"quantile_basis":"EXACT_SAMPLES"}
    check("campaign.deterministic.quantile-semantics-not-interchangeable",lambda:reject(lambda:d.compare_metrics(metric,exact)))
    dimensions=copy.deepcopy(metric);dimensions["units"]["throughput"]="ms"
    check("campaign.deterministic.metric-dimensions-preserved",lambda:reject(lambda:d.compare_metrics(dimensions,dimensions)))
    nonfinite={**metric,"p99":"Infinity"}
    check("campaign.deterministic.nonfinite-measurement-rejected",lambda:reject(lambda:d.compare_metrics(nonfinite,nonfinite)))
    unordered={**metric,"p50":"3"}
    check("campaign.deterministic.quantile-order-preserved",lambda:reject(lambda:d.compare_metrics(unordered,unordered)))
    with tempfile.TemporaryDirectory(prefix="hyperfide-campaign-component-") as temp:
        root = Path(temp)
        corpus = root / "synthetic-component-input.kvx"
        corpus.write_text('[meta]\nname = "component fixture only"\n')
        record = pin(corpus)
        check("campaign.deterministic.corpus-pin", lambda: d.pinned_file(record, root)[1] == corpus.read_bytes())
        corpus.write_text("changed component fixture")
        check("campaign.deterministic.corpus-tamper", lambda: reject(lambda: d.pinned_file(record, root)))
        fixture = root / "component-command.py"
        fixture.write_text("import hashlib,json,sys,time,subprocess,os\nfrom pathlib import Path\ndata=sys.stdin.buffer.read();q=json.loads(data)\nif q.get('mode') in ('escape-success','escape-timeout'):\n child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)',q['marker']],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)\n identity=Path('/proc/'+str(child.pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]\n Path(q['pid_file']).write_text(json.dumps({'pid':child.pid,'start_ticks':identity,'marker':q['marker']}))\n if q['mode']=='escape-timeout':time.sleep(5)\nif q.get('mode')=='timeout':time.sleep(5)\nif q.get('mode')=='exit':raise SystemExit(7)\nprint(json.dumps({'schema_version':1,'request_sha256':hashlib.sha256(data).hexdigest()if q.get('mode')!='wrong'else'0'*64,'value':42}))\n")
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
        def escaped(mode):
            import signal, uuid
            pid_file=root/(mode+'.pid.json')
            marker='hyperfide-owned-escape-'+uuid.uuid4().hex
            selected={**spec,'timeout_seconds':0.5 if mode=='escape-timeout' else 2}
            rejected=reject(lambda:adapter(mode,selected).call({'mode':mode,'pid_file':str(pid_file),'marker':marker}),d.Blocked if mode=='escape-timeout'else d.CampaignError)
            if not pid_file.is_file():raise AssertionError('real detached-child fixture did not start')
            observed=json.loads(pid_file.read_text());pid=observed['pid'];identity=d.process_identity(pid)
            executing=identity is not None and identity[0]==observed['start_ticks'] and identity[1]!='Z'
            if executing:
                fd=os.pidfd_open(pid,0)
                try:
                    if d.process_identity(pid)==identity:signal.pidfd_send_signal(fd,signal.SIGKILL,None,0)
                finally:os.close(fd)
                try:os.waitpid(pid,0)
                except ChildProcessError:pass
            cleanup_files=list((root/mode).glob('*/process-cleanup.json'))
            if len(cleanup_files)!=1:raise AssertionError('missing durable process cleanup receipt')
            cleanup=json.loads(cleanup_files[0].read_text())
            return rejected and not executing and cleanup['complete'] and not cleanup['remaining_owned_pids'] and any(row['pid']==pid and row['start_ticks']==observed['start_ticks']for row in cleanup['owned_processes_observed'])
        check('campaign.deterministic.normal-exit-detached-child',lambda:escaped('escape-success'))
        check('campaign.deterministic.timeout-detached-child',lambda:escaped('escape-timeout'))
        def interrupted():
            from unittest.mock import patch
            import signal,uuid
            marker="hyperfide-interrupted-"+uuid.uuid4().hex
            pid_file=root/"interrupted.pid.json"
            original=d.subprocess.Popen.communicate
            first=[True]
            def interrupt(process,*args,**kwargs):
                if first[0]:
                    first[0]=False
                    import time
                    kwargs["timeout"]=0.2
                    try:original(process,*args,**kwargs)
                    except d.subprocess.TimeoutExpired:pass
                    deadline=time.monotonic()+4
                    while not pid_file.is_file() and time.monotonic()<deadline:
                        try:original(process,timeout=0.1)
                        except d.subprocess.TimeoutExpired:pass
                    if not pid_file.is_file():raise AssertionError("real detached child did not acknowledge startup before interruption")
                    raise KeyboardInterrupt("actual component interrupt after Popen")
                return original(process,*args,**kwargs)
            with patch.object(d.subprocess.Popen,"communicate",interrupt):
                rejected=reject(lambda:adapter("interrupted").call({"mode":"escape-timeout","pid_file":str(pid_file),"marker":marker}),d.Blocked)
            observed=json.loads(pid_file.read_text());identity=d.process_identity(observed["pid"])
            executing=identity is not None and identity[0]==observed["start_ticks"] and identity[1]!="Z"
            if executing:
                fd=os.pidfd_open(observed["pid"],0)
                try:
                    if d.process_identity(observed["pid"])==identity:signal.pidfd_send_signal(fd,signal.SIGKILL,None,0)
                finally:os.close(fd)
                try:os.waitpid(observed["pid"],0)
                except ChildProcessError:pass
            unknown=list((root/"interrupted").glob("*/unknown.json"))
            return rejected and not executing and len(unknown)==1 and json.loads(unknown[0].read_text())["cause"]=="KeyboardInterrupt" and json.loads(unknown[0].read_text())["owned_process_cleanup"]["complete"]
        check("campaign.deterministic.interrupted-detached-child",interrupted)
        def constructor_interrupt():
            import time
            from unittest.mock import patch
            real=d.subprocess.Popen
            held=[]
            def launch_then_interrupt(*args,**kwargs):
                process=real(*args,**kwargs);held.append((process,d.process_identity(process.pid)))
                time.sleep(0.05)
                raise KeyboardInterrupt('after actual child spawn, before constructor return')
            try:
                with patch.object(d.subprocess,'Popen',launch_then_interrupt):
                    rejected=reject(lambda:adapter('constructor-interrupt').call({'mode':'ok'}),d.Blocked)
                process,identity=held[0];after=d.process_identity(process.pid)
                unknown=list((root/'constructor-interrupt').glob('*/unknown.json'))
                outcome=list((root/'constructor-interrupt').glob('*/outcome.json'))
                record=json.loads(unknown[0].read_text())
                return rejected and len(unknown)==1 and json.loads(outcome[0].read_text())['status']=='UNKNOWN' and record['owned_process_cleanup']['complete'] and after is None and any(row['pid']==process.pid and row['start_ticks']==identity[0]for row in record['owned_process_cleanup']['owned_processes_observed'])
            finally:
                for process,identity in held:
                    for stream in (process.stdin,process.stdout,process.stderr):
                        if stream:stream.close()
        check('campaign.deterministic.constructor-interruption-is-unknown',constructor_interrupt)
        def definite_spawn_failure():
            missing_cwd=root/'removed-cwd';missing_cwd.mkdir()
            selected={**spec,'cwd':str(missing_cwd)}
            call=adapter('definite-spawn-failure',selected);missing_cwd.rmdir()
            rejected=reject(lambda:call.call({'mode':'ok'}))
            outcomes=list((root/'definite-spawn-failure').glob('*/outcome.json'))
            return rejected and len(outcomes)==1 and json.loads(outcomes[0].read_text())['status']=='FAILED_BEFORE_EXEC' and not list((root/'definite-spawn-failure').glob('*/unknown.json'))
        check('campaign.deterministic.definite-preexec-failure',definite_spawn_failure)
        unpinned = {**spec,"pins":[pin(fixture)]}
        check("campaign.deterministic.unpinned-executable", lambda: reject(lambda: adapter("unpinned", unpinned)))
    with tempfile.TemporaryDirectory(prefix="hyperfide-manifest-component-") as temporary:
        folder = Path(temporary)
        corpus = folder / "component-only.kvx"
        corpus.write_text('[meta]'+chr(10)+'name = "component only"'+chr(10))
        repositories = [{"repository_id":"00000000-0000-0000-0000-000000000001", "candidate_head":"a"*40, "input_manifest_digest":"sha256:"+"b"*64}]
        source = folder / "source-set.json"
        source.write_bytes(d.canonical(repositories))
        value = {"schema_version":1, "campaign_id":"component-input-validation", "kind":"deterministic", "source_revision":"a"*40, "source_manifest_digest":"sha256:"+d.digest(d.canonical(repositories)), "approval":{"approved":True,"kind":"deterministic"}, "profile":{"sandboxes":100,"slots":200,"session_lifetimes":1500,"virtual_hours":72,"readers":300,"initial_authority_epoch":EPOCH1,"deployment_id":DEPLOYMENT,"authority_contract":"04-journal-v1"}, "inputs":{"planning":[pin(corpus)],"graph":[pin(corpus)],"source_manifest":[pin(source)]},"adapters":{},"seeds":[17,19]}
        manifest_path = folder / "profile.json"
        def load(candidate):
            manifest_path.write_text(json.dumps(candidate))
            return d.load_manifest(manifest_path,"deterministic")
        check("campaign.deterministic.pinned-source-manifest",lambda:load(value)[0]["source_manifest_digest"]==value["source_manifest_digest"])
        legacy=copy.deepcopy(value);legacy["profile"].pop("authority_contract")
        check("campaign.authority.actual-campaign-refuses-legacy-contract",lambda:reject(lambda:load(legacy)))
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
        few_readers=copy.deepcopy(value);few_readers["profile"]["readers"]=50
        check("campaign.deterministic.readers-required-in-profile",lambda:reject(lambda:load(few_readers)))
        def simulation_cli():
            load(value)
            evidence=folder/"simulation-evidence"
            record=d.simulate_campaign(manifest_path,evidence)
            report=json.loads(Path(record["path"]).read_text())
            return report["evidence_scope"]=="SIMULATION_ONLY" and report["live_frontier_qualified"] is False and report["implementation_evidence"] is False and len(report["sweep"])==2*len(d.sweep_points()) and len(report["fault_replay"])==2*len(d.fault_combinations(17))
        check("campaign.deterministic.simulation-report-separated",simulation_cli)
    mixed_load_checks()
    parity_checks()
    # Exercise the same focused regression methods through the registered runner.
    import unittest
    sys.path.insert(0, str(ROOT / "tests/hyperfide"))
    import test_authority_campaign
    def authority_case(name):
        observed=unittest.TestResult()
        test_authority_campaign.AuthorityMetadataTests(name).run(observed)
        if not observed.wasSuccessful():
            raise AssertionError(str(observed.errors+observed.failures))
        return True
    for name in unittest.defaultTestLoader.getTestCaseNames(test_authority_campaign.AuthorityMetadataTests):
        check("campaign.authority."+name.removeprefix("test_").replace("_","-"),lambda name=name:authority_case(name))
    if "--list-assertions" in sys.argv:
        print(json.dumps(IDS))
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}))
    return int(bool(FAILED))

if __name__ == "__main__":
    raise SystemExit(run())
