#!/usr/bin/env python3
"""Task23.3 lifecycle histograms, exact replay and controlled comparison; no production performance claim."""
import copy,importlib.util,json,os,select,subprocess,sys,threading,time
from pathlib import Path
spec=importlib.util.spec_from_file_location("observability_fixture",Path(__file__).with_name("23_1.py"))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
DERIVED={"readiness_to_start","lease_latency","event_lag","db_lock_wait","db_pool_wait"}
def stamp(offset=0.0):return time.strftime("%Y-%m-%dT%H:%M:%S",time.gmtime(time.time()+offset))+".000Z"
class Holder:
 """A separate PostgreSQL session that holds real locks while the service runs; never a mocked statistic."""
 def __init__(self):
  self.p=subprocess.Popen(["psql","-X","-q","-A","-t","-d",h.database()],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,env=h.db_env(),cwd=h.ROOT);self.n=0
 def run(self,statement,timeout=20):
  self.n+=1;mark="HF-MARK-"+str(self.n);self.p.stdin.write(statement+"\n\\echo "+mark+"\n");self.p.stdin.flush();out="";end=time.monotonic()+timeout
  while time.monotonic()<end:
   ready,_,_=select.select([self.p.stdout],[],[],0.2)
   if ready:
    chunk=os.read(self.p.stdout.fileno(),65536).decode()
    if not chunk:break
    out+=chunk
    if mark+"\n" in out:return out.split(mark+"\n")[0]
  raise AssertionError("PostgreSQL holder session did not acknowledge "+mark)
 def close(self):
  try:self.p.stdin.write("ROLLBACK;\n\\q\n");self.p.stdin.flush();self.p.wait(10)
  except Exception:self.p.kill()
def concurrently(fns):
 results=[None]*len(fns)
 def run(i,fn):
  try:results[i]=fn()
  except Exception as e:results[i]=e
 threads=[threading.Thread(target=run,args=(i,fn)) for i,fn in enumerate(fns)]
 for t in threads:t.start()
 return threads,results
def join(threads):
 for t in threads:t.join(30)
def main():
 h.set_task("23.3")
 if "--cleanup" in sys.argv:return h.cleanup()
 try:
  with h.Fixture("23.3",["23.3"]) as f:
   def packet(n,variant="CURRENT",values=None,kind="REPLAY",name="api_latency",phase="API"):
    return {"receipt_id":h.uid(n+1000),"series":{"id":h.uid(n),"name":name,"phase":phase,"profile_key":"controlled-fixture","variant":variant,"provenance_digest":h.DIGEST,"bucket_bounds":["1","2","4","8"]},"source_artifact_id":h.ARTIFACT,"measurement_kind":kind,"samples":[{"observed_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime()),"value":v} for v in (values or ["1","2","3"])]}
   baseline=packet(500,"BASELINE");current=packet(501,"CURRENT",["2","4","6"])
   derive=lambda:f.ok("23.3","fleet.metrics.snapshot",{"server_derived":True})
   h.check("observability.metrics.registered",lambda:h.expect(len(f.ok("23.3","fleet.metrics.describe")["metrics"])==18 and set(f.ok("23.3","fleet.metrics.describe")["server_derived"])==DERIVED))
   def unknown_absent():
    r=derive()["metrics"]
    for name in ("lease_latency","event_lag"):
     m=r[name];h.expect(m["status"]=="UNKNOWN" and m["provenance"]=="SERVER_DERIVED" and m["sample_count"]=="0" and all(m[k] is None for k in ("sum","mean","min","max","p50","p95","histogram")),name+" fabricated a value")
   h.check("observability.metrics.server-derived-unknown-absent",unknown_absent)
   def lifecycle():
    h.sql(f"""BEGIN;
    INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave,created_at) VALUES('{h.ORG}','{h.RUN}','{h.uid(700)}','derived-700','{h.PACKAGE}','{h.SPEC}','{h.DIGEST}','{{}}',1,clock_timestamp()-interval '10 seconds'),('{h.ORG}','{h.RUN}','{h.uid(701)}','derived-701','{h.PACKAGE}','{h.SPEC}','{h.DIGEST}','{{}}',1,clock_timestamp());
    INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,sandbox_id,slot_id,sandbox_boot_generation,execution_state,created_at) VALUES('{h.ORG}','{h.RUN}','{h.uid(702)}','{h.uid(700)}',1,'{h.EPOCH}','{h.DIGEST}','{h.SANDBOX}','{h.SLOT}',1,'RUNNING',(SELECT created_at+interval '3 seconds' FROM hyperfide.tasks WHERE organisation_id='{h.ORG}' AND run_id='{h.RUN}' AND id='{h.uid(700)}'));
    INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation,expires_at,created_at) SELECT organisation_id,run_id,'{h.uid(703)}',id,1,authority_epoch,1,clock_timestamp()+interval '1 hour',created_at+interval '500 milliseconds' FROM hyperfide.attempts WHERE organisation_id='{h.ORG}' AND run_id='{h.RUN}' AND id='{h.uid(702)}';
    COMMIT;""")
    r=derive()["metrics"];ready=r["readiness_to_start"];lease=r["lease_latency"]
    h.expect(ready["status"]=="AVAILABLE" and ready["sample_count"]=="2" and ready["max"]=="3000" and ready["unstarted_tasks"]=="1" and ready["provenance"]=="SERVER_DERIVED","readiness differs: "+json.dumps(ready))
    h.expect(lease["status"]=="AVAILABLE" and lease["sample_count"]=="1" and lease["p50"]=="500" and lease["histogram"][3]=="1","lease latency differs: "+json.dumps(lease))
   h.check("observability.metrics.server-derived-lifecycle",lifecycle)
   def event_lag():
    h.sql(f"""BEGIN;
    INSERT INTO hyperfide.event_consumers(organisation_id,run_id,id,consumer_key) VALUES('{h.ORG}','{h.RUN}','{h.uid(710)}','derived-consumer');
    INSERT INTO hyperfide.outbox_events(organisation_id,run_id,id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,created_at) VALUES('{h.ORG}','{h.RUN}','{h.uid(711)}','TASK','{h.uid(700)}',1,'DERIVED_FIXTURE','{{}}',clock_timestamp()-interval '4 seconds'),('{h.ORG}','{h.RUN}','{h.uid(712)}','TASK','{h.uid(700)}',2,'DERIVED_FIXTURE','{{}}',clock_timestamp()-interval '2 seconds');
    INSERT INTO hyperfide.event_deliveries(organisation_id,run_id,event_id,consumer_id,state,attempt_count,acknowledged_at) SELECT '{h.ORG}','{h.RUN}','{h.uid(711)}','{h.uid(710)}','ACKNOWLEDGED',2,created_at+interval '1250 milliseconds' FROM hyperfide.outbox_events WHERE organisation_id='{h.ORG}' AND run_id='{h.RUN}' AND id='{h.uid(711)}';
    INSERT INTO hyperfide.event_deliveries(organisation_id,run_id,event_id,consumer_id) VALUES('{h.ORG}','{h.RUN}','{h.uid(712)}','{h.uid(710)}');
    COMMIT;""")
    m=derive()["metrics"]["event_lag"]
    h.expect(m["status"]=="AVAILABLE" and m["sample_count"]=="1" and m["max"]=="1250" and m["pending_deliveries"]=="1" and float(m["oldest_pending_age_ms"])>=1500 and m["redeliveries"]=="1","event lag differs: "+json.dumps(m))
   h.check("observability.metrics.server-derived-event-lag",event_lag)
   def cardinality():
    h.sql(f"INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) SELECT '{h.ORG}','{h.RUN}',('25000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'derived-scale-'||n,'{h.PACKAGE}','{h.SPEC}','{h.DIGEST}','{{}}',1 FROM generate_series(1,200) n")
    r=derive();text=json.dumps(r)
    h.expect(set(r["metrics"])==DERIVED and r["cardinality"]=="FIXED_NAMES_NO_ENTITY_LABELS" and r["metrics"]["readiness_to_start"]["unstarted_tasks"]=="201" and h.TASK_ID not in text and h.uid(700) not in text and len(text)<16384)
   h.check("observability.metrics.derived-cardinality-bounded",cardinality)
   def held_record(n,receipt):
    p=packet(n,values=["1"],kind="MEASUREMENT_REPORT",name="db_lock_wait",phase="INFRASTRUCTURE");p["receipt_id"]=h.uid(receipt);p["series"]["profile_key"]="held-writer-"+str(n);return lambda:f.request("23.3","fleet.metrics.record",p)
   lock_artifact=f"BEGIN; SELECT 1 FROM hyperfide.artifacts WHERE organisation_id='{h.ORG}' AND run_id='{h.RUN}' AND id='{h.ARTIFACT}' FOR UPDATE;"
   def accepted(results):
    return [r for r in results if isinstance(r,dict) and r.get("ok") is True]
   def explicit(results):
    return all(isinstance(r,dict) and (r.get("ok") is True or r.get("error",{}).get("code") in ("DB_OVERLOADED","TX_TIMEOUT","TX_RETRY_EXHAUSTED")) for r in results)
   def lock_pressure():
    holder=Holder()
    try:
     holder.run(lock_artifact);threads,results=concurrently([held_record(600,20000+i) for i in range(2)]);time.sleep(1.5)
     r=derive()["metrics"]["db_lock_wait"]
     holder.run("COMMIT;")
    finally:holder.close()
    join(threads)
    h.expect(r["status"]=="AVAILABLE" and int(r["blocked_backends"])>=1 and float(r["max"])>=500 and r["scope"]=="DATABASE","lock pressure not identified: "+json.dumps(r))
    ok=accepted(results);h.expect(len(ok)==2,"held writers did not complete: "+str(results))
    h.expect(f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(600)})["sample_count"]=="2")
    h.expect(derive()["metrics"]["db_lock_wait"]["status"]=="UNKNOWN","released lock still reported as waiting")
   h.check("observability.metrics.lock-pressure-identified",lock_pressure)
   def deadlock():
    before=int(derive()["metrics"]["db_lock_wait"]["deadlocks_total"]);holder=Holder()
    try:
     holder.run(lock_artifact);threads,results=concurrently([held_record(601,20100)]);time.sleep(0.7)
     out=holder.run(f"SELECT pg_advisory_xact_lock(hashtextextended('observability:metrics:{h.ORG}:{h.RUN}',0));",timeout=15);holder.run("COMMIT;")
    finally:holder.close()
    join(threads)
    h.expect(len(accepted(results))==1,"deadlocked writer did not converge: "+str(results)+" "+out)
    after=before;end=time.monotonic()+20
    while after<=before and time.monotonic()<end:
     time.sleep(0.5);after=int(derive()["metrics"]["db_lock_wait"]["deadlocks_total"])
    h.expect(after>before,"deadlock counter not observed")
    h.expect(f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(601)})["sample_count"]=="1","deadlock retry duplicated or lost evidence")
   h.check("observability.metrics.deadlock-identified",deadlock)
   during={}
   def pool_pressure():
    before=derive()["metrics"]["db_pool_wait"];total=before["pool_sampler"]["queued_samples_total"];limit=before["pool_at_request_entry"]["maxActive"]
    holder=Holder();batches=[];probe=[]
    blocked="FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE 'SELECT pg_advisory_xact_lock(%' OR query LIKE 'SELECT id FROM hyperfide.artifacts %')"
    try:
     holder.run(lock_artifact);batches.append(concurrently([held_record(602,20200+i) for i in range(limit+4)]))
     end=time.monotonic()+4
     while int(h.sql("SELECT count(*) "+blocked).stdout.strip())<limit and time.monotonic()<end:time.sleep(0.05)
     h.expect(int(h.sql("SELECT count(*) "+blocked).stdout.strip())>=limit,"writers did not exhaust the primary pool")
     # Authentication uses this pool before component entry. Advance it without
     # releasing the lock: commits would trigger SSI retries and lease-free backoff.
     probe,probe_results=concurrently([lambda:(f.request("23.3","fleet.metrics.snapshot",{"server_derived":True}),f.calls[-1]["elapsed_ms"])])
     end=time.monotonic()+8;replacement=limit+4;cancelled=0
     while probe[0].is_alive() and time.monotonic()<end:
      time.sleep(0.1)
      out=h.sql("SELECT pg_cancel_backend(pid) "+blocked+" ORDER BY query_start,pid LIMIT 1").stdout.strip()
      if out=="t":
       cancelled+=1;batches.append(concurrently([held_record(602,20200+replacement)]));replacement+=1
     h.expect(not probe[0].is_alive(),"probe did not progress while pressure was held")
     h.expect(cancelled>0,"pressure driver did not advance a blocked writer")
     holder.run("COMMIT;")
    finally:
     holder.close()
     for threads,_ in batches:join(threads)
     join(probe)
    results=[r for _,batch in batches for r in batch]
    during["probe"]=probe_results[0]
    after=derive()["metrics"]["db_pool_wait"];sampler=after["pool_sampler"]
    h.expect(sampler["queued_samples_total"]>total and sampler["window_max_active"]>=limit and sampler["window_max_queued"]>=1 and after["pressure_status"]=="EXHAUSTED","pool exhaustion not identified: "+json.dumps(after))
    h.expect(explicit(results),"overload was not explicit: "+str(results))
    h.expect(f.ok("23.3","fleet.metrics.snapshot",{"series_id":h.uid(602)})["sample_count"]==str(len(accepted(results))),"accepted evidence inconsistent with responses")
   h.check("observability.metrics.actual-pool-pressure",pool_pressure)
   def queue_separate():
    response,elapsed=during["probe"];h.expect(response.get("ok") is True,"probe refused: "+str(response))
    req=response["result"]["request"];m=response["result"]["metrics"]["db_pool_wait"]
    h.expect(float(req["queue_wait_ms"])>0 and req["queue_wait_basis"].endswith("EXCLUDES_GATEWAY_AUTHENTICATION") and req["api_latency_ms"] is None and req["queue_wait_is_api_latency"] is False and elapsed>float(req["queue_wait_ms"]),"queue wait not separated: "+json.dumps(req)+" elapsed="+str(elapsed)+" "+json.dumps(m["pool_at_request_entry"]))
    h.expect(m["pool_at_request_entry"]["active"]>=m["pool_at_request_entry"]["maxActive"] and m["pool_at_request_entry"]["queued"]>=1,"probe did not enter under exhaustion")
   h.check("observability.metrics.queue-wait-separate-under-pressure",queue_separate)
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
