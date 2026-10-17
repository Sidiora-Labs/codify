#!/usr/bin/env python3
"""Task16.3 clause evidence, policy-limited review and custody-exact acceptance.

Reuses the shared domain16 bounded driver (authority, primary-capability and signed
refusals) and adds behavioural assertions against the actual registered service
entrypoint: the real HTTPS control service, signed principals, the linked 15.2
artifact store (independent SigV4 object fixture) and a disposable PostgreSQL
database. Seeded rows are test-only preconditions written through the real schema
and its triggers; every decision below is taken by the compiled components.
This is a task-component receipt only; it does not qualify full V-013/V-034.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import threading
import time
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
TASK = "16.3"

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded

module = load("assurance_bounded", HERE / "16_1.py")
emit = module.emit
original_primary_cases = module.primary_cases
original_cleanup = module.cleanup
RECORD = "behaviour-resource-16.3.json"
ABSENCE = "behaviour-absence-16.3.json"
TRACE = "coverage-traceability-16.3.json"
RESOURCE_IDS = ["hf-task-16.3-behaviour-database", "hf-task-16.3-behaviour-service", "hf-task-16.3-behaviour-role",
                "hf-task-16.3-behaviour-files", "hf-task-16.3-behaviour-object-store"]

def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()

def uid():
    return str(uuid.uuid4())

def oid(label):
    return hashlib.sha1(label.encode()).hexdigest()

def behaviour_cases():
    sys.path.insert(0, str(ROOT / "tests/hyperfide/support"))
    from identity_fixture import IdentityFixture
    objects_module = load("artifact_object_fixture", HERE / "15_2.py")
    record = module.directory() / RECORD
    state = {"database": "hf_assurance_16_3_behaviour_" + uuid.uuid4().hex[:16], "pid": None, "start": None,
             "port": None, "object_port": None, "runtime_role": None, "folder": None, "closed": False}
    def save():
        record.write_text(json.dumps(state))
    save()
    objects = objects_module.ObjectFixture()
    state["object_port"] = objects.port
    save()
    # Closure of the task-owned fragment through the established registry requires graph.
    fragments = {}
    for path in (ROOT / "services/hyperfide/components").glob("*.json"):
        value = json.loads(path.read_text())
        if "id" in value: fragments[value["id"]] = (path.stem, value)
    selected = set()
    def include(key):
        if key in selected: return
        selected.add(key)
        for dependency in fragments[key][1]["requires"]: include(dependency)
    include(TASK)
    names = [fragments[key][0] for key in sorted(selected)]
    ids = {key: uid() for key in ("spec", "package", "repository", "approved", "outsider")}
    base, result = oid("16.3-baseline"), oid("16.3-result")
    crit, rubric, review_rubric = sha(b"16.3-criteria"), sha(b"16.3-proof-rubric"), sha(b"16.3-review-rubric")
    executable = sha(b"16.3-registered-executable")
    inputs = {key: sha(("16.3-input-" + key).encode()) for key in ("source", "dependency", "toolchain", "configuration", "graph", "contract")}
    check = {"id": "gate-a", "argv": ["/usr/bin/true", "qualify"], "executable_digest": executable, "timeout_ms": 60000,
             "required_artifacts": ["out/a.json"], "input_keys": ["source"]}
    tasks = {name: {"task": uid(), "attempt": uid(), "custody": uid(), "job": uid(), "evidence": uid(), "request": uid()} for name in ("accept", "race")}
    policy = {"schema_version": 1, "criteria_digest": crit, "spec_revision_id": ids["spec"], "spec_generation": "2",
              "repository_id": ids["repository"], "source_object_id": base, "rubric_digest": rubric, "checks": [check],
              # One registered check linked to one clause of a two-clause requirement (req.16 ac_3/ac_4).
              "clauses": [{"id": "16.3", "mode": "EXECUTABLE", "acceptance_ids": ["V-013"], "checks": ["gate-a"]},
                          {"id": "16.4", "mode": "REVIEW", "acceptance_ids": ["V-034"], "reviewers": [ids["approved"]], "rubric_digest": review_rubric}],
              "inputs": inputs, "contract_digests": []}
    registry_digest = sha(canonical(policy))
    def field(value): return {"value": value}
    sections = [
        {"name": "req.16", "fields": {"ac_3": field("Criteria traceability SHALL reference the specific acceptance clause."),
                                      "ac_4": field("Policy-limited review judgement SHALL identify rubric, reviewer, support and limitations.")}},
        {"name": "acceptance.V-013", "fields": {"reqs": field(["16.3"]), "checks": field(["gate-a"])}},
        {"name": "acceptance.V-034", "fields": {"reqs": field(["16.4"])}},
        {"name": "proof", "fields": {"rubric_digest": field(rubric)}},
        {"name": "proof.check.gate-a", "fields": {key: field(check[key]) for key in ("argv", "executable_digest", "timeout_ms", "required_artifacts", "input_keys")}},
        {"name": "proof.review.16.4", "fields": {"reviewers": field([ids["approved"]]), "rubric_digest": field(review_rubric)}},
    ]
    definition = {"section": {"name": "task.16.3-fixture", "fields": {"reqs": field(["16.3", "16.4"]), "acceptance_ids": field(["V-013", "V-034"])}}}
    def setup(f):
        state.update(runtime_role=f.runtime_role, folder=str(f.path), port=f.port); save()
        org, run = f.ids["organisation"], f.ids["run"]
        f.env.update({"HF_ARTIFACT_S3_ENDPOINT": objects.endpoint, "HF_ARTIFACT_ALLOW_LOOPBACK_HTTP": "1",
                      "HF_ARTIFACT_S3_REGION": objects_module.REGION, "HF_ARTIFACT_S3_BUCKET": objects_module.BUCKET,
                      "HF_ARTIFACT_S3_ACCESS_KEY_ID": objects_module.KEY, "HF_ARTIFACT_S3_SECRET_ACCESS_KEY": objects_module.SECRET,
                      "HF_ARTIFACT_S3_SESSION_TOKEN": objects_module.TOKEN, "HF_ARTIFACT_ORGANISATION_ID": org,
                      "HF_ARTIFACT_ALLOWED_RUN_IDS": json.dumps([run])})
        content = "hyperfide task16.3 accepted fixture revision"
        f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version) VALUES($1,$2,$3,$4,$5,$6,1)",
              [org, ids["spec"], f.ids["project"], sha(content.encode()), content, json.dumps({"parsed": {"sections": sections}})])
        f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)", [org, run, ids["spec"]])
        f.sql("UPDATE hyperfide.runs SET spec_generation=2,spec_revision_id=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2", [org, run, ids["spec"]])
        f.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'fixture16_3','https://example.invalid/fixture16_3.git')", [org, ids["repository"], f.ids["project"]])
        for commit in (base, result):
            f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)", [org, ids["repository"], commit])
        f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')", [org, run, ids["repository"], base])
        f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'fixture16_3',1)", [org, run, ids["package"]])
        for name in ("approved", "outsider"):
            f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id) VALUES($1,$2,$3,'VERIFIER','fixture','fixture',$4)", [org, run, ids[name], uid()])
        for name, item in tasks.items():
            f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave,state) VALUES($1,$2,$3,$4,$5,$6,2,$7,$8,1,'PENDING')",
                  [org, run, item["task"], "fixture16_3_" + name, ids["package"], ids["spec"], crit, json.dumps(definition)])
            f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,2,$4,$5,$6,$7)",
                  [org, run, item["task"], ids["spec"], crit, registry_digest, json.dumps(policy)])
    class OwnedFixture(IdentityFixture):
        def __init__(self, **kwargs):
            try: super().__init__(**kwargs)
            finally:
                for attribute, key in (("runtime_role", "runtime_role"), ("path", "folder"), ("port", "port")):
                    value = getattr(self, attribute, None)
                    if value is not None: state[key] = str(value) if key == "folder" else value
                child = getattr(self, "child", None)
                if child is not None:
                    state["pid"] = child.pid
                    stat = Path("/proc/" + str(child.pid) + "/stat")
                    if stat.exists(): state["start"] = stat.read_text().split()[21]
                save()
        def start(self):
            super().start()
            state["pid"] = self.child.pid
            state["start"] = Path("/proc/" + str(self.child.pid) + "/stat").read_text().split()[21]
            save()
    fixture = None
    trace = {"scope": "task-component", "full_case_qualification": "UNRUN"}
    try:
        fixture = OwnedFixture(extra_components=names, extra_setup=setup, database=state["database"],
                               extra_env={"HYPERFIDE_REQUIRE_SYNC_REPLICA": "0"})
        org, run = fixture.ids["organisation"], fixture.ids["run"]
        scope = {"organisation_id": org, "run_id": run}
        fixture.add_principal("reviewer", "VERIFIER", actor_id=ids["approved"])
        fixture.add_principal("outsider", "VERIFIER", actor_id=ids["outsider"])
        def call(action, payload, component=TASK, key="operator"):
            status, response = fixture.invoke(action, payload, component=component, key=key, timeout_seconds=60)
            if status != 200: raise AssertionError("Signed service transport failure for " + action + ": " + str(status))
            return response
        def code(response):
            return None if response.get("ok") else response.get("error", {}).get("code")
        def put(data):
            response = call("artifact.object.put", dict(scope, digest=sha(data), size_bytes=str(len(data)),
                            data_base64=__import__("base64").b64encode(data).decode(), retention_class="RUN",
                            retention_until=None, retention_hold=False), component="15.2")
            if not response.get("ok"): raise AssertionError("Linked artifact store refused fixture upload: " + json.dumps(response.get("error")))
            artifact = response["result"]["artifact"]
            return {"artifact_id": artifact["artifact_id"], "digest": artifact["digest"], "size_bytes": str(artifact["size_bytes"]), "storage_kind": "OBJECT"}
        epoch = fixture.ids["epoch"]
        packet = sha(b"16.3-input-packet")
        environment = sha(b"16.3-verifier-environment")
        for name, item in tasks.items():
            label = name.encode()
            source_ref = put(b"source manifest " + label + item["custody"].encode())
            evidence_ref = put(b"evidence manifest " + label + item["custody"].encode())
            stdout = put(b"gate-a stdout " + label + item["job"].encode())
            stderr = put(b"gate-a stderr " + label + item["job"].encode())
            output = put(b'{"gate":"a","task":"' + label + b'","job":"' + item["job"].encode() + b'"}')
            item["support"] = put(b"independent review notes " + label + item["custody"].encode())["artifact_id"]
            manifest = {"source_object_id": result, "source_manifest_digest": source_ref["digest"], "input_packet_digest": packet,
                        "source_tree_id": oid("16.3-tree")}
            receipt = {"job_id": item["job"], "lease_generation": "1", "custody_id": item["custody"], "custody_generation": "1",
                       "task_id": item["task"], "source_attempt_id": item["attempt"], "source_attempt_generation": "1",
                       "verifier_id": ids["approved"], "rubric_digest": rubric, "registry_digest": registry_digest, "criteria_digest": crit,
                       "source_manifest_digest": source_ref["digest"], "source_object_id": result, "input_manifest": inputs,
                       "environment_digest": environment, "outcome": "PASS", "required_check_ids": ["gate-a"],
                       "checks": [{"check_id": "gate-a", "outcome": "PASS", "source_object_id": result, "environment_digest": environment,
                                   "executable_digest": executable,
                                   "command": {"argv": check["argv"], "cwd": ".", "workspace_path": "/workspace/16.3", "environment": {},
                                               "environment_digest": sha(b"{}"), "exit_code": 0, "signal": None, "timed_out": False,
                                               "interrupted": False, "output_truncated": False, "started_at": "2026-10-17T00:00:00.000Z",
                                               "ended_at": "2026-10-17T00:00:01.000Z", "duration_ms": 1000},
                                   "input_manifest": inputs, "artifacts": [dict(output, path="out/a.json")],
                                   "output": {"stdout": stdout, "stderr": stderr},
                                   "execution": {"cleanup_status": "CONFIRMED", "cleanup": {"complete": True, "observed_process_absent": True},
                                                 "process_ref": "fixture-process", "start_identity": "fixture-start", "spool_digest": sha(b"spool"),
                                                 "source_manifest_digest": source_ref["digest"], "source_provenance_digest": inputs["source"],
                                                 "source_state_digest": sha(b"source-state"),
                                                 "input_validation": {"status": "VERIFIED", "job_id": item["job"], "input_packet_digest": packet,
                                                                      "receipt_digest": sha(b"input-validation"),
                                                                      "input_manifest": {k: inputs[k] for k in ("dependency", "toolchain", "configuration", "graph", "contract")}}}}]}
            receipt_bytes = canonical(receipt)
            receipt_ref = put(receipt_bytes)
            item["receipt_digest"] = sha(receipt_bytes)
            fixture.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,kind,execution_state,compute_authority,lease_expires_at) VALUES($1,$2,$3,$4,1,$5,$6,'IMPLEMENTATION','SUBMITTED','EXPIRED',clock_timestamp()-interval '1 hour')",
                        [org, run, item["attempt"], item["task"], epoch, packet])
            fixture.sql("INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest) VALUES($1,$2,$3,$4,$5,1,1,$6,$7,$8,$9,$10,$11)",
                        [org, run, item["custody"], item["task"], item["attempt"], epoch, ids["repository"], result, source_ref["digest"], evidence_ref["digest"], crit])
            fixture.sql("UPDATE hyperfide.tasks SET current_custody_id=$4,state='QUALIFYING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3", [org, run, item["task"], item["custody"]])
            fixture.sql("INSERT INTO hyperfide.assurance_submissions(organisation_id,run_id,custody_id,request_id,request_digest,manifest,policy,source_artifact_id,evidence_artifact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                        [org, run, item["custody"], item["request"], sha(item["request"].encode()), json.dumps(manifest), json.dumps(policy), source_ref["artifact_id"], evidence_ref["artifact_id"]])
            fixture.sql("INSERT INTO hyperfide.assurance_applicability(organisation_id,run_id,custody_id,input_manifest) VALUES($1,$2,$3,$4)", [org, run, item["custody"], json.dumps(inputs)])
            fixture.sql("INSERT INTO hyperfide.qualification_jobs(organisation_id,run_id,id,custody_id,custody_generation,rubric_digest,state,lease_generation,outcome) VALUES($1,$2,$3,$4,1,$5,'SUCCEEDED',1,'PASS')",
                        [org, run, item["job"], item["custody"], rubric])
            fixture.sql("INSERT INTO hyperfide.evidence(organisation_id,run_id,id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest,manifest_digest,artifact_id,admission_state) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,'ADMITTED')",
                        [org, run, item["evidence"], item["attempt"], ids["repository"], result, crit, item["receipt_digest"], receipt_ref["artifact_id"]])
            fixture.sql("INSERT INTO hyperfide.assurance_job_receipts(organisation_id,run_id,job_id,lease_generation,verifier_id,environment_digest,receipt_digest,evidence_id,receipt_artifact_id,receipt) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)",
                        [org, run, item["job"], ids["approved"], environment, item["receipt_digest"], item["evidence"], receipt_ref["artifact_id"], json.dumps(receipt)])
        def custody(item):
            return dict(scope, submission_id=item["custody"], custody_generation="1", expected_state_version="1")
        def judgement(item, clause, **changes):
            value = dict(custody(item), clause_id=clause, rubric_digest=review_rubric, support_artifact_ids=[item["support"]],
                         limitations="Reviewer inspected the recorded design notes only; no executable behaviour is claimed.", disposition="PASS")
            value.update(changes)
            return value
        def inspect(item):
            response = call("qualification.coverage.inspect", dict(scope, submission_id=item["custody"]))
            if not response.get("ok"): raise AssertionError("Coverage inspection refused: " + json.dumps(response.get("error")))
            return response["result"]
        def clause(view, key):
            return next(row for row in view["clauses"] if row["id"] == key)
        def row(item):
            return fixture.sql("SELECT c.authority,c.qualification_outcome,c.state_version::text AS version,t.state AS task_state,a.compute_authority,"
                               "a.lease_expires_at::text AS lease,a.state_version::text AS attempt_version,"
                               "(SELECT count(*) FROM hyperfide.assurance_judgements j WHERE j.organisation_id=c.organisation_id AND j.run_id=c.run_id AND j.custody_id=c.id)::text AS judgements,"
                               "(SELECT count(*) FROM hyperfide.assurance_dispositions d WHERE d.organisation_id=c.organisation_id AND d.run_id=c.run_id AND d.custody_id=c.id)::text AS dispositions "
                               "FROM hyperfide.submission_custodies c JOIN hyperfide.tasks t ON t.organisation_id=c.organisation_id AND t.run_id=c.run_id AND t.id=c.task_id "
                               "JOIN hyperfide.attempts a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.id=c.source_attempt_id "
                               "WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3", [org, run, item["custody"]])[0]
        target = tasks["accept"]
        lease_before = row(target)
        before = inspect(target)
        trace["before_review"] = before
        emit("assurance.16.3.coverage.seeded-registry-current", before["proof_registry_current"] is True and before["receipt_digest"] == target["receipt_digest"])
        executable_clause, review_clause = clause(before, "16.3"), clause(before, "16.4")
        emit("assurance.16.3.do2.linked-clause-satisfied", executable_clause["satisfied"] is True and executable_clause["acceptance_ids"] == ["V-013"]
             and executable_clause["evidence"]["passed_check_ids"] == ["gate-a"] and executable_clause["evidence"]["receipt_digest"] == target["receipt_digest"])
        emit("assurance.16.3.do2.uncovered-clause-open", review_clause["satisfied"] is False and review_clause["review"] is None
             and review_clause["acceptance_ids"] == ["V-034"] and before["proof_complete"] is False and before["qualified"] is False)
        emit("assurance.16.3.do2.accept-proof-incomplete", code(call("qualification.accept", custody(target))) == "QUALIFICATION_PROOF_INCOMPLETE"
             and row(target)["qualification_outcome"] == "PENDING")
        emit("assurance.16.3.do2.executable-judgement-denied",
             code(call("qualification.review.record", judgement(target, "16.3"), key="reviewer")) == "QUALIFICATION_REVIEW_DENIED")
        refused = [code(call("qualification.review.record", judgement(target, "16.4", **{name: value}), key="reviewer"))
                   for name, value in (("model_score", 0.99), ("confidence", "HIGH"))]
        after_score = inspect(target)
        emit("assurance.16.3.do2.model-score-refused", refused == ["QUALIFICATION_INPUT_INVALID"] * 2 and row(target)["judgements"] == "0"
             and clause(after_score, "16.4")["satisfied"] is False and after_score["proof_complete"] is False)
        emit("assurance.16.3.do1.unapproved-reviewer-denied",
             code(call("qualification.review.record", judgement(target, "16.4"), key="outsider")) == "QUALIFICATION_REVIEW_DENIED")
        emit("assurance.16.3.do1.wrong-rubric-denied",
             code(call("qualification.review.record", judgement(target, "16.4", rubric_digest=rubric), key="reviewer")) == "QUALIFICATION_REVIEW_DENIED")
        recorded = call("qualification.review.record", judgement(target, "16.4"), key="reviewer")
        emit("assurance.16.3.do1.review-recorded", recorded.get("ok") is True and recorded["result"]["reviewer_id"] == ids["approved"]
             and recorded["result"]["qualification"] == "NOT_ACCEPTED" and row(target)["judgements"] == "1")
        reviewed = inspect(target)
        trace["after_review"] = reviewed
        traced = clause(reviewed, "16.4")
        emit("assurance.16.3.do1.clause-traceability", traced["satisfied"] is True and traced["acceptance_ids"] == ["V-034"]
             and traced["review"]["reviewer_id"] == ids["approved"] and traced["review"]["rubric_digest"] == review_rubric
             and traced["review"]["support_artifact_ids"] == [target["support"]] and traced["review"]["limitations"].startswith("Reviewer inspected")
             and traced["evidence"]["permitted_reviewers"] == [ids["approved"]] and traced["mandatory_proof"] == "POLICY_PERMITTED_REVIEW"
             and clause(reviewed, "16.3")["mandatory_proof"] == "EXECUTABLE" and reviewed["proof_complete"] is True and reviewed["qualified"] is False)
        emit("assurance.16.3.do3.stale-generation-refused",
             code(call("qualification.accept", dict(custody(target), custody_generation="2"))) == "QUALIFICATION_STALE_CUSTODY")
        emit("assurance.16.3.do3.stale-version-refused",
             code(call("qualification.accept", dict(custody(target), expected_state_version="7"))) == "QUALIFICATION_STALE_CUSTODY")
        accepted = call("qualification.accept", custody(target))
        after = row(target)
        emit("assurance.16.3.do3.accept-retains-active-custody", accepted.get("ok") is True and accepted["result"]["qualified"] is True
             and after["authority"] == "ACTIVE" and after["qualification_outcome"] == "PASS" and after["version"] == "2" and after["task_state"] == "QUALIFIED"
             and inspect(target)["qualified"] is True)
        emit("assurance.16.3.do3.former-lease-not-consulted", after["compute_authority"] == "EXPIRED" and after["lease"] == lease_before["lease"]
             and after["attempt_version"] == lease_before["attempt_version"])
        emit("assurance.16.3.do3.accept-replay-stale", code(call("qualification.accept", custody(target))) == "QUALIFICATION_STALE_CUSTODY")
        racer = tasks["race"]
        if not call("qualification.review.record", judgement(racer, "16.4"), key="reviewer").get("ok"):
            raise AssertionError("Race precondition judgement was refused")
        barrier, outcomes = threading.Barrier(2), {}
        def contend(name, action, payload, component):
            barrier.wait(10)
            outcomes[name] = call(action, payload, component=component)
        threads = [threading.Thread(target=contend, args=("accept", "qualification.accept", custody(racer), TASK)),
                   threading.Thread(target=contend, args=("revoke", "submission.revoke", dict(custody(racer), reason="Coordinator reassignment race"), "16.1"))]
        for thread in threads: thread.start()
        for thread in threads: thread.join(90)
        if set(outcomes) != {"accept", "revoke"}: raise AssertionError("Concurrent race did not complete")
        winners = [name for name, response in outcomes.items() if response.get("ok") is True]
        loser = next((name for name in outcomes if name not in winners), None)
        final = row(racer)
        consistent = (winners == ["accept"] and final["authority"] == "ACTIVE" and final["qualification_outcome"] == "PASS" and final["dispositions"] == "0") or \
                     (winners == ["revoke"] and final["authority"] == "REVOKED" and final["qualification_outcome"] == "PENDING" and final["dispositions"] == "1")
        trace["race"] = {"winner": winners, "loser": loser, "loser_code": code(outcomes[loser]) if loser else None, "final": final}
        emit("assurance.16.3.do3.race-single-winner", len(winners) == 1 and final["version"] == "2" and consistent
             and code(outcomes[loser]) in ("QUALIFICATION_STALE_CUSTODY", "QUALIFICATION_CONFLICT"))
        retry = call("qualification.accept", custody(racer)) if loser == "accept" else call("submission.revoke", dict(custody(racer), reason="Late losing transition"), component="16.1")
        emit("assurance.16.3.do3.race-loser-expected-version", code(retry) == "QUALIFICATION_STALE_CUSTODY" and row(racer) == final
             and final["compute_authority"] == "EXPIRED")
    finally:
        if fixture is not None:
            fixture.close(); state["closed"] = True; save()
        objects.stop()
        (module.directory() / TRACE).write_text(json.dumps(trace, indent=2, sort_keys=True) + "\n")

def cleanup_behaviour():
    record = module.directory() / RECORD
    if not record.exists(): return []
    import re, shutil, signal, socket, subprocess, tempfile
    state = json.loads(record.read_text())
    pid = state.get("pid")
    def current():
        if pid is None: return False
        try: return Path("/proc/" + str(pid) + "/stat").read_text().split()[21] == state.get("start")
        except FileNotFoundError: return False
    if current():
        os.kill(pid, signal.SIGTERM)
        for _ in range(50):
            if not current(): break
            time.sleep(0.1)
        if current(): os.kill(pid, signal.SIGKILL)
    def closed(port):
        if not port: return True
        with socket.socket() as probe:
            probe.settimeout(0.5)
            return probe.connect_ex(("127.0.0.1", port)) != 0
    stopped = not current() and closed(state.get("port"))
    store_absent = closed(state.get("object_port"))
    name = state["database"]
    if not re.fullmatch(r"hf_assurance_16_3_behaviour_[0-9a-f]{16}", name): raise ValueError("Unowned behaviour database")
    subprocess.run(["dropdb", "--force", "--if-exists", name], cwd=ROOT, check=True, capture_output=True, timeout=45)
    absent = module.sql("SELECT count(*) FROM pg_database WHERE datname='" + name + "';", "postgres").stdout.strip() == "0"
    role = state.get("runtime_role")
    role_absent = True
    if role:
        if not re.fullmatch(r"hf_ir_[0-9a-f]{32}", role): raise ValueError("Unowned runtime role")
        module.sql('DROP ROLE IF EXISTS "' + role + '"', "postgres")
        role_absent = module.sql("SELECT count(*) FROM pg_roles WHERE rolname='" + role + "';", "postgres").stdout.strip() == "0"
    files_absent = True
    folder = state.get("folder")
    if folder:
        location = Path(folder)
        if location.parent != Path(tempfile.gettempdir()) or not location.name.startswith("hyperfide-identity-") or location.is_symlink():
            raise ValueError("Unowned identity fixture folder")
        if stopped and location.exists(): shutil.rmtree(location)
        files_absent = not location.exists()
    observed = {"database": name, "database_observed_absent": absent, "service_observed_absent": stopped, "runtime_role_observed_absent": role_absent,
                "fixture_files_observed_absent": files_absent, "object_store_observed_absent": store_absent,
                "observer": "pg_database/pg_roles, exact service PID start identity, loopback listener probes and owned temporary folder"}
    (module.directory() / ABSENCE).write_text(json.dumps(observed) + "\n")
    artifact = "assurance/" + ABSENCE
    flags = [absent, stopped, role_absent, files_absent, store_absent]
    return [{"id": key, "status": "deleted" if flag else "unknown", "observed_absent": flag, "evidence_artifact": artifact}
            for key, flag in zip(RESOURCE_IDS, flags)]

def primary_cases():
    original_primary_cases()
    behaviour_cases()

def quiet_cleanup(report=False):
    # The registered --cleanup command is the single observed cleanup event.
    with contextlib.redirect_stdout(io.StringIO()):
        return original_cleanup()

module.primary_cases = primary_cases
module.cleanup_git = cleanup_behaviour
if "--cleanup" not in sys.argv:
    module.cleanup = quiet_cleanup

if __name__ == "__main__":
    raise SystemExit(module.main(TASK))
