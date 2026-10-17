#!/usr/bin/env python3
"""Real service scorecard/calibration probes; synthetic evidence never proves model quality."""
import copy, json, runpy, sys, tempfile
from pathlib import Path
H=runpy.run_path(str(Path(__file__).with_name("22_1.py")))
Fixture=H["Fixture"];check=H["check"];require=H["require"];digest=H["digest"];FAILED=H["FAILED"]

def profiles(f):
    return [f.profile("baseline","fixture/current-policy"),f.profile("span","respan/span-02"),
      f.profile("jev","typesafe/jev-1.14"),f.profile("ultra","liquid/d1-ultra")]

def build_scorecard(f):
    dataset=f.dataset();ps=profiles(f);calibrations={}
    for p in ps:
        value=f.ask("evaluation.calibrate",{"dataset_id":dataset["artifact_id"],"profile":p,
          "predictions":f.predictions(f.cases[9:12],[p],wrong_baseline=True)})
        calibrations[p["id"]]=value["artifact_id"]
    request={"dataset_id":dataset["artifact_id"],"split":"holdout","profiles":ps,"baseline_profile":"baseline",
      "predictions":f.predictions(f.cases[12:15],ps,wrong_baseline=True,abstain_last=True),"calibration_ids":calibrations}
    result=f.ask("evaluation.scorecard",request)
    return dataset,ps,calibrations,request,result

def main():
    with tempfile.TemporaryDirectory(prefix="hyperfide-eval-score-")as directory:
        f=Fixture(directory)
        try:
            dataset,ps,calibrations,request,result=build_scorecard(f)
            check("evaluation.scorecard.actual-multimodel",lambda:require(result["comparison_complete"]and len(result["profiles"])==4,"missing baseline/candidates"))
            check("evaluation.scorecard.synthetic-not-performance",lambda:require(result["evidence_class"]=="synthetic"and result["live_performance_claim"]is False,"fixture became live quality"))
            check("evaluation.scorecard.actual-metrics",lambda:require(result["metrics"]["span"]["accuracy"]==1 and abs(result["metrics"]["span"]["brier_multiclass"]-0.08)<1e-9,"wrong multiclass score"))
            check("evaluation.scorecard.calibration-heldout",lambda:require(result["metrics"]["span"]["calibrated_ece"]==0 and result["metrics"]["span"]["ece"]>0,"calibration not applied to heldout confidence"))
            check("evaluation.scorecard.abstention-visible",lambda:require(result["metrics"]["ultra"]["abstained"]==1 and result["metrics"]["ultra"]["coverage"]==2/3,"abstention hidden"))
            check("evaluation.scorecard.uncertainty-visible",lambda:require(result["metrics"]["span"]["accuracy_interval"]["lower"]<1,"small sample reported as certainty"))
            check("evaluation.scorecard.cost-retries-visible",lambda:require(result["metrics"]["span"]["attempts"]==6 and result["metrics"]["span"]["actual_cost_microusd"]==60,"cost/retries lost"))
            check("evaluation.scorecard.no-false-qualified-cost",lambda:require(result["metrics"]["span"]["cost_per_qualified_outcome"]is None,"replay treated as qualified delivery"))
            check("evaluation.scorecard.strata-visible",lambda:require("language:typescript"in result["strata"]["span"]and"options:2"in result["strata"]["span"],"strata absent"))
            check("evaluation.scorecard.paired-baseline-uncertainty",lambda:require(result["comparisons"]["span"]["labelled_correctness_delta"]==1 and result["comparisons"]["ultra"]["labelled_correctness_delta"]==2/3 and result["comparisons"]["span"]["delta_interval"]["lower"]<1,"paired baseline comparison missing or overconfident"))
            check("evaluation.scorecard.abstention-counts-missed-label",lambda:require(result["metrics"]["ultra"]["confusion"]["yes"]["fn"]==1,"abstention hid missed label"))
            def missing():
                bad=copy.deepcopy(request);bad["predictions"].pop();f.ask("evaluation.scorecard",bad,False)
            check("evaluation.scorecard.reject-missing-prediction",missing)
            def duplicate():
                bad=copy.deepcopy(request);bad["predictions"].append(bad["predictions"][0]);f.ask("evaluation.scorecard",bad,False)
            check("evaluation.scorecard.reject-duplicate-prediction",duplicate)
            def bad_mass():
                bad=copy.deepcopy(request);p=bad["predictions"][0]
                p["body"]["payload"]["probabilities"]={"no":0.9,"yes":0.9};p["body"]["subject_digest"]=digest(p["body"]["payload"])
                bad["predictions"][0]=f.resign(p);f.ask("evaluation.scorecard",bad,False)
            check("evaluation.scorecard.reject-probability-mass",bad_mass)
            def false_actual():
                bad=copy.deepcopy(request);p=bad["predictions"][0]
                p["body"]["payload"]["cost_microusd"]=None;p["body"]["subject_digest"]=digest(p["body"]["payload"])
                bad["predictions"][0]=f.resign(p);f.ask("evaluation.scorecard",bad,False)
            check("evaluation.scorecard.reject-incomplete-actual-usage",false_actual)
            def stale_calibration():
                bad=copy.deepcopy(request);bad["calibration_ids"]["span"]=calibrations["jev"]
                f.ask("evaluation.scorecard",bad,False)
            check("evaluation.scorecard.reject-cross-profile-calibration",stale_calibration)
            def holdout_fit():
                f.ask("evaluation.calibrate",{"dataset_id":dataset["artifact_id"],"profile":ps[1],
                  "predictions":f.predictions(f.cases[12:15],[ps[1]])},False)
            check("evaluation.scorecard.reject-holdout-fitting",holdout_fit)
            def forged_receipt():
                bad=copy.deepcopy(request);bad["predictions"][0]["signature"]="A"*86+"=="
                f.ask("evaluation.scorecard",bad,False)
            check("evaluation.scorecard.reject-forged-receipt",forged_receipt)
            def unknown_usage():
                bad=copy.deepcopy(request);p=bad["predictions"][1]
                p["body"]["payload"].update(usage_class="unknown",cost_microusd=None,input_tokens=None)
                p["body"]["subject_digest"]=digest(p["body"]["payload"]);bad["predictions"][1]=f.resign(p)
                value=f.ask("evaluation.scorecard",bad);require(value["metrics"]["span"]["actual_cost_microusd"]is None,"unknown usage became free")
            check("evaluation.scorecard.unknown-cost-not-zero",unknown_usage)
            def error_rate():
                require(result["metrics"]["span"]["error_rate"]==0 and result["metrics"]["span"]["error_rate_interval"]["upper"]>0,"error rate absent or overconfident")
                bad=copy.deepcopy(request);i=next(n for n,p in enumerate(bad["predictions"])if p["body"]["payload"]["profile"]["id"]=="span")
                p=bad["predictions"][i];p["body"]["payload"].update(status="error",decision=None,probabilities=None)
                p["body"]["subject_digest"]=digest(p["body"]["payload"]);bad["predictions"][i]=f.resign(p)
                m=f.ask("evaluation.scorecard",bad)["metrics"]["span"]
                require(m["errors"]==1 and abs(m["error_rate"]-1/3)<1e-9 and m["coverage"]==2/3,"error rate not reported")
            check("evaluation.scorecard.error-rate-visible",error_rate)
        finally:f.close()
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
