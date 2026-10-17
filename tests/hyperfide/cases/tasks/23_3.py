#!/usr/bin/env python3
"""Task23.3 lifecycle histograms, exact replay and controlled comparison; no production performance claim."""
import copy,importlib.util,json,sys,time
from pathlib import Path
spec=importlib.util.spec_from_file_location("observability_fixture",Path(__file__).with_name("23_1.py"))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
def main():
 h.set_task("23.3")
 if "--cleanup" in sys.argv:return h.cleanup()
 try:
  with h.Fixture("23.3",["23.3"]) as f:
   def packet(n,variant="CURRENT",values=None,kind="REPLAY",name="api_latency",phase="API"):
    return {"receipt_id":h.uid(n+1000),"series":{"id":h.uid(n),"name":name,"phase":phase,"profile_key":"controlled-fixture","variant":variant,"provenance_digest":h.DIGEST,"bucket_bounds":["1","2","4","8"]},"source_artifact_id":h.ARTIFACT,"measurement_kind":kind,"samples":[{"observed_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime()),"value":v} for v in (values or ["1","2","3"])]}
   baseline=packet(500,"BASELINE");current=packet(501,"CURRENT",["2","4","6"])
   h.check("observability.metrics.registered",lambda:h.expect(len(f.ok("23.3","fleet.metrics.describe")["metrics"])==18))
   h.check("observability.metrics.actual-pool-pressure",lambda:h.expect(f.ok("23.3","fleet.metrics.describe")["resource_pressure"]["primary"]["maxActive"]>=1))
   h.check("observability.metrics.baseline-recorded",lambda:h.expect(f.ok("23.3","fleet.metrics.record",baseline)["recorded"]==3))
   h.check("observability.metrics.current-recorded",lambda:h.expect(f.ok("23.3","fleet.metrics.record",current)["recorded"]==3))
   h.check("observability.metrics.histogram-observed",lambda:h.expect(f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(500)})["p95_upper_bound"]=="4"))
   h.check("observability.metrics.replay-origin-retained",lambda:h.expect(f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(500)})["series"]["measurement_kind"]=="REPLAY"))
   h.check("observability.metrics.receipt-replay",lambda:h.expect(f.ok("23.3","fleet.metrics.record",baseline)["replayed"]))
   h.check("observability.metrics.replay-no-inflation",lambda:h.expect(f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(500)})["sample_count"]=="3"))
   def conflict():
    v=copy.deepcopy(baseline);v["samples"][0]["value"]="8";f.reject("23.3","fleet.metrics.record",v,"OBSERVABILITY_CONFLICT")
   h.check("observability.metrics.receipt-conflict",conflict)
   h.check("observability.metrics.matched-comparison",lambda:h.expect(f.ok("23.3","fleet.metrics.compare",{"baseline_series_id":h.uid(500),"current_series_id":h.uid(501)})["comparable"]))
   def mismatch():
    p=packet(502);p["series"]["provenance_digest"]="sha256:"+"b"*64;f.ok("23.3","fleet.metrics.record",p)
    h.expect(f.ok("23.3","fleet.metrics.compare",{"baseline_series_id":h.uid(500),"current_series_id":h.uid(502)})["comparable"] is False)
   h.check("observability.metrics.provenance-mismatch",mismatch)
   h.check("observability.metrics.unknown-not-zero",lambda:h.expect(f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(999)})["status"]=="UNKNOWN"))
   h.check("observability.metrics.cost-denominator-not-fabricated",lambda:h.expect(f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(500)})["actual_cost_per_current_qualified_integrated_outcome"] is None))
   def malformed(field,value):
    p=packet(503);p["series"][field]=value;f.reject("23.3","fleet.metrics.record",p,"OBSERVABILITY_INPUT_INVALID")
   h.check("observability.metrics.high-cardinality-name-denied",lambda:malformed("name","task-"+h.TASK_ID))
   h.check("observability.metrics.phase-denied",lambda:malformed("phase","arbitrary-worker-id"))
   h.check("observability.metrics.histogram-order-denied",lambda:malformed("bucket_bounds",["2","1"]))
   h.check("observability.metrics.histogram-bound",lambda:malformed("bucket_bounds",[str(x) for x in range(33)]))
   def oversized():
    p=packet(503);p["samples"]=p["samples"]*34;f.reject("23.3","fleet.metrics.record",p,"OBSERVABILITY_INPUT_INVALID")
   h.check("observability.metrics.batch-bound",oversized)
   def old():
    p=packet(504);p["samples"][0]["observed_at"]=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()-73*3600));f.reject("23.3","fleet.metrics.record",p,"OBSERVABILITY_INPUT_INVALID")
   h.check("observability.metrics.retention-window",old)
   def future():
    p=packet(505);p["samples"][0]["observed_at"]=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+600));f.reject("23.3","fleet.metrics.record",p,"OBSERVABILITY_INPUT_INVALID")
   h.check("observability.metrics.future-time",future)
   h.check("observability.metrics.untrusted-producer-denied",lambda:f.reject("23.3","fleet.metrics.record",packet(506),"OBSERVABILITY_PRODUCER_FORBIDDEN",role="VERIFIER"))
   h.check("observability.metrics.no-unrelated-artifact",lambda:f.reject("23.3","fleet.metrics.record",dict(packet(507),source_artifact_id=h.uid(999)),"OBSERVABILITY_EVIDENCE_UNAVAILABLE"))
   def separate():
    queue=packet(508,name="queue_wait",phase="BUILD");api=packet(509,name="api_latency",phase="BUILD")
    f.ok("23.3","fleet.metrics.record",queue);f.ok("23.3","fleet.metrics.record",api)
    h.expect(f.ok("23.3","fleet.metrics.compare",{"baseline_series_id":h.uid(508),"current_series_id":h.uid(509)})["comparable"] is False)
   h.check("observability.metrics.queue-is-not-api-latency",separate)
   def actual():
    f.ok("23.1","fleet.views.snapshot");measured=str(round(f.calls[-1]["elapsed_ms"],6));p=packet(510,values=[measured],kind="MEASUREMENT_REPORT");p["series"]["profile_key"]="actual-loopback-https"
    f.ok("23.3","fleet.metrics.record",p);r=f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(510)});h.expect(r["sample_count"]=="1" and float(r["sum"])>0 and r["series"]["measurement_kind"]=="MEASUREMENT_REPORT")
   h.check("observability.metrics.real-service-latency",actual)
   def equivalent():
    anchor=time.time();total=4320
    for start in range(0,total,100):
     p=packet(511);p["receipt_id"]=h.uid(10000+start);p["series"]["profile_key"]="simulated-72h-schedule";p["samples"]=[{"observed_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(anchor-minute*60)),"value":"1"} for minute in range(start,min(start+100,total))]
     f.ok("23.3","fleet.metrics.record",p)
    r=f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(511)});h.expect(r["sample_count"]==str(total))
    count=h.sql(f"SELECT count(*) FROM hyperfide.observability_metric_buckets WHERE series_id='{h.uid(511)}';").stdout.strip();h.expect(int(count)<=4322)
   h.check("observability.metrics.72h-equivalent-bounded",equivalent)
   h.check("observability.metrics.no-causal-win-claim",lambda:h.expect(f.ok("23.3","fleet.metrics.compare",{"baseline_series_id":h.uid(500),"current_series_id":h.uid(501)})["uncertainty"]=="NO_CAUSAL_OR_STATISTICAL_SIGNIFICANCE_CLAIM"))
   h.check("observability.metrics.cross-run-denied",lambda:f.reject("23.3","fleet.metrics.snapshot",{"series_id":h.uid(500)},run=h.RUN2))
  return h.finish()
 except Exception as e:print(json.dumps({"type":"fatal","error":type(e).__name__+": "+str(e)}),flush=True);return 1
if __name__=="__main__":raise SystemExit(main())
