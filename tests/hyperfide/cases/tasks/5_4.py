#!/usr/bin/env python3
"""Real independent job admission, strict vectors, queue pressure and no TTL release."""
from __future__ import annotations
import importlib.util,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("hf_scheduler_fixture",ROOT/"tests/hyperfide/cases/tasks/5_1.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
expect=m.expect;check=m.check;uid=m.uid
def main():
 f=m.SchedulerFixture();i=f.ids
 try:
  scope={"organisation_id":i["organisation"],"run_id":i["run"],"pool_id":i["pool"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","package_id":i["package"]}
  f.prepare_claim("a");f.prepare_claim("b")
  discovery=f.ok("scheduler.resources.eligible",scope,key="manager",component="5.4")
  check("resources.eligible.real-pins",lambda:expect(any(t["task_id"]==i["task_a"] and t["execution_packet"]["execution_authority"] is False for t in discovery["eligible"]),"Actual packet candidate missing"))
  check("resources.eligible.manager-private",lambda:expect(all(t["task_id"]!=i["task_b"] for t in discovery["eligible"]) and all(t["task_id"]!=i["task_b"] for t in discovery["excluded"]),"Manager observed another owner's task shortlist"))
  check("resources.eligible.no-authority",lambda:expect(discovery["authority"]=="CANDIDATE_DISCOVERY" and f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==0,"Discovery granted compute"))
  demand={"organisation_id":i["organisation"],"run_id":i["run"],"pool_id":i["pool"],"profile_id":i["profile"],"job_class":"PREPARATION","warm_spare":True}
  check("resources.prewarm.manager-spares-denied",lambda:f.reject("scheduler.resources.demand",demand,"SPARE_DELEGATION_REQUIRED",key="manager",component="5.4"))
  queue=dict(scope,request_id=uid(),task_id=i["task_a"],job_kind="TEST",priority=0,wait_reason="BUILD",deadline_ms=300000,dimensions=f.capacity("TEST"))
  check("resources.task-required",lambda:f.reject("scheduler.resources.queue",{k:v for k,v in queue.items() if k!="task_id"},"TASK_REQUIRED",key="manager",component="5.4"))
  check("resources.manager.scope",lambda:f.reject("scheduler.resources.queue",queue,"PACKAGE_OWNER_MISMATCH",key="manager2",component="5.4"))
  bad=dict(queue,request_id=uid(),dimensions=[d for d in queue["dimensions"] if d["capacity_account_id"]==f.accounts["TEST"]])
  check("resources.full-vector-required",lambda:f.reject("scheduler.resources.queue",bad,"RESOURCE_VECTOR_MISMATCH",key="manager",component="5.4"))
  queued=f.ok("scheduler.resources.queue",queue,key="manager",component="5.4")
  check("resources.queue-not-compute",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==0,"Independent TEST reservation fabricated coding attempt"))
  check("resources.queue-replay",lambda:expect(f.ok("scheduler.resources.queue",queue,key="manager",component="5.4")["waiter_id"]==queued["waiter_id"],"Queue replay created another waiter"))
  check("resources.queue-conflict",lambda:f.reject("scheduler.resources.queue",dict(queue,priority=1),"IDEMPOTENCY_CONFLICT",key="manager",component="5.4"))
  admit=dict(scope,waiter_id=queued["waiter_id"])
  admitted=f.ok("scheduler.resources.admit",admit,key="manager",component="5.4")
  check("resources.test.admitted",lambda:expect(admitted["admitted"] is True and f.sql("SELECT count(*)::int n FROM hyperfide.reservations WHERE state='ALLOCATED'")[0]["n"]==4,"TEST job lacks complete allocated vector"))
  check("resources.agent-independent",lambda:expect(next(r for r in f.counts() if r["dimension"]=="AGENT")["allocated"]=="0","Independent verifier consumed coding AGENT quota"))
  check("resources.admission-replay",lambda:expect(f.ok("scheduler.resources.admit",admit,key="manager",component="5.4")["replayed"] is True and f.sql("SELECT count(*)::int n FROM hyperfide.reservations")[0]["n"]==4,"Admission replay duplicated counters"))
  ids=[r["id"] for r in f.sql("SELECT id FROM hyperfide.reservations")]
  check("resources.no-proof.no-release",lambda:f.reject("scheduler.resources.release",{k:v for k,v in dict(scope,reservation_ids=ids).items() if k!="pool_id"},"DEPENDENCY_UNAVAILABLE",key="manager",component="5.4"))
  inspected=f.ok("scheduler.resources.inspect",scope,key="manager",component="5.4")
  check("resources.primary-snapshot",lambda:expect(inspected["observation"]=="PRIMARY_SNAPSHOT" and inspected["measurement_status"]=="NOT_A_PERFORMANCE_QUALIFICATION","Inspect manufactured a performance qualification"))
  deadline=dict(queue,request_id=uid(),deadline_ms=1000)
  due=f.ok("scheduler.resources.queue",deadline,key="manager",component="5.4")
  while f.sql("SELECT deadline_at>clock_timestamp() AS live FROM hyperfide.resource_waiters WHERE id=$1",[due["waiter_id"]])[0]["live"]:time.sleep(.05)
  expired=f.ok("scheduler.resources.admit",dict(scope,waiter_id=due["waiter_id"]),key="manager",component="5.4")
  check("resources.queue.primary-deadline",lambda:expect(expired["state"]=="EXPIRED" and expired["admitted"] is False,"Expired queue admitted work"))
  check("resources.deadline.no-physical-release",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.reservations WHERE state='ALLOCATED'")[0]["n"]==4,"Queue expiry freed another job's occupied capacity"))
 finally:
  db=f.database;path=f.path;f.close();check("resources.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Fixture resource remains"))
 return 1 if m.FAILED else 0
if __name__=="__main__":raise SystemExit(main())
