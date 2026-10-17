#!/usr/bin/env python3
"""Bounded trial declaration/observation probes through the real service."""
import copy, json, runpy, sys, tempfile
from datetime import timedelta
from pathlib import Path
H=runpy.run_path(str(Path(__file__).with_name("22_2.py")))
Fixture=H["Fixture"];check=H["check"];require=H["require"];digest=H["digest"];FAILED=H["FAILED"];build_scorecard=H["build_scorecard"]
utc=H["H"]["utc"]

def build_trial(f,mode="controlled"):
    dataset,ps,calibrations,score_request,score=build_scorecard(f)
    plan={"trial_id":"fixture-trial","mode":mode,"purpose":"defect_detection","scorecard_id":score["artifact_id"],
      "baseline":ps[0],"candidate":ps[1],"seed":"frozen-trial-seed",
      "units":[{"unit_id":f"unit-{i}","groups":[f"independent-group-{i}"]}for i in range(4)],
      "primary":"qualified_per_hour","max_primary":10000,"minimum_benefit":1,"defect_margin":0.05,
      "minimum_units_per_arm":2,"max_cost_microusd":1000000,"max_attempts":1000,"max_duration_ms":60000,
      "power_plan_digest":digest("fixture-predeclared-sample-size-and-power-design"),
      "starts_at":utc(f.now-timedelta(minutes=1)),"ends_at":utc(f.now+timedelta(hours=1))}
    def approve(value):
        return f.sign("trial_approval",{"plan_digest":digest(value),"expires_at":utc(f.now+timedelta(hours=2)),
          "independence_evidence":digest("fixture-independent-group-design"),"approved_by":"fixture-operator"},"approval")
    approval=approve(plan)if mode=="controlled"else None
    trial=f.ask("evaluation.trial.create",{"plan":plan,"approval":approval})
    observations=[]
    for unit in trial["units"]:
        payload={"trial_digest":trial["artifact_id"],"unit_id":unit["unit_id"],"arm":unit["arm"],
          "qualified":2 if unit["arm"]=="candidate"else 1,"escaped_defects":0,"attempts":3,
          "cost_microusd":100,"duration_ms":5000,"invariant_violations":0,
          "started_at":utc(f.now-timedelta(seconds=10)),"ended_at":utc(f.now-timedelta(seconds=5)),
          "outcome_evidence":["fixture-qualified-integration-receipt"],"cost_breakdown":{"sandbox":25,"frontier":25,"decisions":25,"packet_build":25}}
        observations.append(f.sign("trial_observation",payload,"prediction"))
    report=f.ask("evaluation.trial.report",{"trial_id":trial["artifact_id"],"observations":observations})
    return plan,approval,trial,observations,report,score

def main():
    with tempfile.TemporaryDirectory(prefix="hyperfide-eval-trial-")as directory:
        f=Fixture(directory)
        try:
            plan,approval,trial,observations,report,score=build_trial(f)
            check("evaluation.trial.balanced-group-assignment",lambda:require(sum(u["arm"]=="candidate"for u in trial["units"])==2,"unbalanced assignment"))
            check("evaluation.trial.assignment-stable",lambda:require(f.ask("evaluation.trial.create",{"plan":plan,"approval":approval})["artifact_id"]==trial["artifact_id"],"assignment changed"))
            check("evaluation.trial.actual-observation-metrics",lambda:require(report["complete"]and report["per_arm"]["candidate"]["qualified"]==4 and report["per_arm"]["baseline"]["actual_cost_microusd"]==200,"observed outcomes lost"))
            check("evaluation.trial.synthetic-cannot-promote",lambda:require(not report["production_eligible"]and not report["benefit_demonstrated"]and report["evidence_class"]=="synthetic","synthetic trial became live evidence"))
            check("evaluation.trial.interval-and-counts",lambda:require(report["benefit_interval"]["lower"]<report["benefit_interval"]["upper"]and report["count"]==4,"interval/count absent"))
            def missing_approval():
                f.ask("evaluation.trial.create",{"plan":plan,"approval":None},False)
            check("evaluation.trial.reject-missing-approval",missing_approval)
            def changed_plan():
                bad=copy.deepcopy(plan);bad["minimum_benefit"]=0
                f.ask("evaluation.trial.create",{"plan":bad,"approval":approval},False)
            check("evaluation.trial.reject-postapproval-target-change",changed_plan)
            def overlap():
                bad=copy.deepcopy(plan);bad["units"][1]["groups"]=bad["units"][0]["groups"]
                f.ask("evaluation.trial.create",{"plan":bad,"approval":approval},False)
            check("evaluation.trial.reject-interfering-groups",overlap)
            def duplicate():
                f.ask("evaluation.trial.report",{"trial_id":trial["artifact_id"],"observations":observations+[observations[0]]},False)
            check("evaluation.trial.reject-duplicate-unit",duplicate)
            def wrong_arm():
                bad=copy.deepcopy(observations);p=bad[0]
                p["body"]["payload"]["arm"]="candidate"if p["body"]["payload"]["arm"]=="baseline"else"baseline"
                p["body"]["subject_digest"]=digest(p["body"]["payload"]);bad[0]=f.resign(p)
                f.ask("evaluation.trial.report",{"trial_id":trial["artifact_id"],"observations":bad},False)
            check("evaluation.trial.reject-arm-crossover",wrong_arm)
            def incomplete_cost():
                bad=copy.deepcopy(observations);proof=bad[0]
                del proof["body"]["payload"]["cost_breakdown"]["packet_build"]
                proof["body"]["subject_digest"]=digest(proof["body"]["payload"])
                bad[0]=f.resign(proof);f.ask("evaluation.trial.report",{"trial_id":trial["artifact_id"],"observations":bad},False)
            check("evaluation.trial.reject-incomplete-outcome-cost",incomplete_cost)
            def incomplete():
                value=f.ask("evaluation.trial.report",{"trial_id":trial["artifact_id"],"observations":observations[:1]})
                require(not value["complete"]and not value["production_eligible"],"partial trial became complete")
            check("evaluation.trial.partial-remains-incomplete",incomplete)
            def invariant_stop():
                bad=copy.deepcopy(observations[:1]);p=bad[0]
                p["body"]["payload"]["invariant_violations"]=1;p["body"]["subject_digest"]=digest(p["body"]["payload"]);bad[0]=f.resign(p)
                value=f.ask("evaluation.trial.report",{"trial_id":trial["artifact_id"],"observations":bad})
                require(value["stop_required"]and not value["production_eligible"],"invariant violation did not stop eligibility")
            check("evaluation.trial.invariant-stop",invariant_stop)
            def budget_stop():
                bad=copy.deepcopy(observations);p=bad[0]
                p["body"]["payload"]["cost_microusd"]=1000001;p["body"]["payload"]["cost_breakdown"]["sandbox"]=999926;p["body"]["subject_digest"]=digest(p["body"]["payload"]);bad[0]=f.resign(p)
                value=f.ask("evaluation.trial.report",{"trial_id":trial["artifact_id"],"observations":bad})
                require(value["stop_required"]and"cost_budget_exceeded"in value["stop_reasons"],"budget exceeded silently")
            check("evaluation.trial.cost-stop",budget_stop)
            def shadow():
                _,_,value,_,summary,_=build_trial(f,"shadow")
                require(all(u["arm"]=="baseline"for u in value["units"])and not summary["production_eligible"]and summary["shadow_cannot_prove_live_benefit"],"shadow changed actions or claimed benefit")
            check("evaluation.trial.shadow-preserves-baseline",shadow)
        finally:f.close()
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
