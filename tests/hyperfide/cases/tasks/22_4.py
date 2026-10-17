#!/usr/bin/env python3
"""Promotion/drift refusal probes: no fabricated live labels or performance."""
import copy, json, runpy, sys, tempfile
from datetime import timedelta
from pathlib import Path
H=runpy.run_path(str(Path(__file__).with_name("22_3.py")))
Fixture=H["Fixture"];check=H["check"];require=H["require"];digest=H["digest"];FAILED=H["FAILED"];utc=H["utc"];build_trial=H["build_trial"]

def main():
    with tempfile.TemporaryDirectory(prefix="hyperfide-eval-promotion-")as directory:
        f=Fixture(directory)
        try:
            plan,approval,trial,observations,report,score=build_trial(f)
            dataset=f.ask("evaluation.dataset.inspect",{"dataset_id":score["dataset_id"]})
            candidate=plan["candidate"]
            payload={"version":"fixture-policy-v1","purpose":"defect_detection","profile":candidate,
              "dataset_id":score["dataset_id"],"holdout_digest":dataset["holdout_digest"],
              "thresholds":{"minimum_coverage":0,"minimum_accuracy_lower":0,"maximum_ece":1,"maximum_risk":1,"maximum_p95_ms":100000,"maximum_actual_cost_microusd":1000000},
              "expires_at":utc(f.now+timedelta(hours=1)),"required_cases":{"route":["V-045"],"invariants":["V-003","V-013"]}}
            def qualification(kind,p=candidate):
                return f.sign(kind,{"profile_digest":digest(p),"passed":True,"expires_at":utc(f.now+timedelta(hours=1)),
                  "evidence_refs":["fixture-only-contract-proof"],"qualification_scope":"full-case","case_ids":["V-045"]if kind=="route_qualification"else["V-003","V-013"]},"qualification")
            request={"policy":f.sign("promotion_policy",payload,"approval"),"scorecard_id":score["artifact_id"],
              "trial_report_id":report["artifact_id"],"route_qualification":qualification("route_qualification"),
              "invariant_qualification":qualification("invariant_qualification"),"mode":"hosted","selfhost_qualification":None}
            gate=f.ask("evaluation.promotion.assess",request)
            check("evaluation.promotion.synthetic-always-refused",lambda:require(not gate["eligible"]and"non_live_scorecard"in gate["reasons"]and"controlled_live_trial_unproven"in gate["reasons"],"fixture evidence promoted"))
            check("evaluation.promotion.no-fleet-authority",lambda:require(not gate["grants_fleet_authority"]and gate["retained_workers"]and gate["retained_evidence"],"gate mutated fleet authority"))
            check("evaluation.promotion.hosted-no-gpu-block",lambda:require("selfhost_capability_unqualified"not in gate["reasons"],"optional GPU blocked hosted baseline"))
            def drift():
                changed=copy.deepcopy(candidate);changed["route"]="changed/native"
                value=f.ask("evaluation.drift.check",{"gate_id":gate["artifact_id"],"scorecard_id":score["artifact_id"],"current_profile":changed})
                require(not value["model_action_policy_enabled"]and"model_route_or_rubric_changed"in value["reasons"]and value["retain_existing_workers"]and not value["alter_accepted_evidence"],"drift did not preserve fallback/history")
            check("evaluation.promotion.version-drift-disables",drift)
            def expired_qualification():
                bad=copy.deepcopy(request);proof=bad["route_qualification"]
                proof["body"]["payload"]["expires_at"]=utc(f.now-timedelta(minutes=1))
                proof["body"]["subject_digest"]=digest(proof["body"]["payload"])
                bad["route_qualification"]=f.resign(proof)
                expired=f.ask("evaluation.promotion.assess",bad)
                value=f.ask("evaluation.drift.check",{"gate_id":expired["artifact_id"],"scorecard_id":score["artifact_id"],"current_profile":candidate})
                require(not value["model_action_policy_enabled"]and"required_qualification_expired"in value["reasons"]and expired["valid_until"]<payload["expires_at"],"earlier qualification deadline lost")
            check("evaluation.promotion.drift-rechecks-qualification-expiry",expired_qualification)
            def substituted_scorecard():
                from_fixture=H["H"]["build_scorecard"]
                _,_,_,req,_=from_fixture(f)
                req["predictions"][-1]["body"]["payload"]["latency_ms"]+=1
                req["predictions"][-1]["body"]["subject_digest"]=digest(req["predictions"][-1]["body"]["payload"])
                req["predictions"][-1]=f.resign(req["predictions"][-1])
                replacement=f.ask("evaluation.scorecard",req)
                value=f.ask("evaluation.drift.check",{"gate_id":gate["artifact_id"],"scorecard_id":replacement["artifact_id"],"current_profile":candidate})
                require(not value["model_action_policy_enabled"]and"unapproved_scorecard_revision"in value["reasons"],"unapproved evidence substituted")
            check("evaluation.promotion.reject-scorecard-substitution",substituted_scorecard)
            def missing_route():
                bad=copy.deepcopy(request);bad["route_qualification"]=None
                f.ask("evaluation.promotion.assess",bad,False)
            check("evaluation.promotion.reject-missing-route-proof",missing_route)
            def stale_route():
                bad=copy.deepcopy(request);changed=copy.deepcopy(candidate);changed["model"]="different/model"
                bad["route_qualification"]=qualification("route_qualification",changed)
                value=f.ask("evaluation.promotion.assess",bad)
                require(not value["eligible"]and"route_qualification:stale_profile"in value["reasons"],"stale route proof accepted")
            check("evaluation.promotion.reject-stale-profile-proof",stale_route)
            def component_proof():
                bad=copy.deepcopy(request);proof=bad["route_qualification"]
                proof["body"]["payload"]["qualification_scope"]="task-component"
                proof["body"]["subject_digest"]=digest(proof["body"]["payload"])
                bad["route_qualification"]=f.resign(proof);f.ask("evaluation.promotion.assess",bad,False)
            check("evaluation.promotion.reject-component-qualification",component_proof)
            def missing_required_case():
                bad=copy.deepcopy(request);proof=bad["invariant_qualification"]
                proof["body"]["payload"]["case_ids"]=["V-003"]
                proof["body"]["subject_digest"]=digest(proof["body"]["payload"])
                bad["invariant_qualification"]=f.resign(proof);value=f.ask("evaluation.promotion.assess",bad)
                require(not value["eligible"]and"invariant_qualification:required_case_missing"in value["reasons"],"incomplete case inventory accepted")
            check("evaluation.promotion.reject-incomplete-case-proof",missing_required_case)
            def invalid_policy():
                bad=copy.deepcopy(request);p=copy.deepcopy(payload);p["thresholds"]["minimum_coverage"]=-1
                bad["policy"]=f.sign("promotion_policy",p,"approval")
                f.ask("evaluation.promotion.assess",bad,False)
            check("evaluation.promotion.reject-invalid-threshold",invalid_policy)
            def unknown_override():
                bad=copy.deepcopy(request);bad["force"]=True
                f.ask("evaluation.promotion.assess",bad,False)
            check("evaluation.promotion.reject-force-override",unknown_override)
            def missing_selfhost():
                bad=copy.deepcopy(request);bad["mode"]="self_hosted"
                f.ask("evaluation.promotion.assess",bad,False)
            check("evaluation.promotion.reject-unqualified-selfhost",missing_selfhost)
            for requested in [False,True]:
                def optional(requested=requested):
                    value=f.ask("evaluation.selfhost.optional",{"requested":requested})
                    require(not value["enabled"]and not value["hosted_baseline_blocked"],"optional selfhost silently activated")
                check("evaluation.promotion.optional-selfhost-"+str(requested).lower(),optional)
        finally:f.close()
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
