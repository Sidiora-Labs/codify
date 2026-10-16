#!/usr/bin/env python3
"""Stable dispatch identity and fail-closed uncertainty through the real service."""
from __future__ import annotations
import concurrent.futures,importlib.util,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("hf_scheduler_fixture",ROOT/"tests/hyperfide/cases/tasks/5_1.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
expect=m.expect;check=m.check;uid=m.uid
def main():
 f=m.SchedulerFixture();i=f.ids
 try:
  claim=f.claim("a");token=claim["token"];request={"token":token,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  check("dispatch.role.denied",lambda:f.reject("scheduler.dispatch.ensure",request,"ROLE_DENIED",key="watcher",component="5.3"))
  result=f.ok("scheduler.dispatch.ensure",request,key="manager",component="5.3")
  check("dispatch.intent.not-execution",lambda:expect(result["state"]=="INTENT" and result["execution_confirmed"] is False and result["replacement_allowed"] is False,"Intent claimed execution"))
  check("dispatch.exact-physical-identity",lambda:expect(f.sql("SELECT id FROM hyperfide.scheduler_dispatches WHERE request_id=$1",[request["request_id"]])[0]["id"]==result["operation_id"],"Dispatch identity not durable"))
  check("dispatch.outbox-bound",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches d JOIN hyperfide.outbox_events e ON e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id WHERE d.id=$1 AND e.payload->>'command_id'=d.id::text AND e.payload->>'payload_digest'=d.payload_digest",[result["operation_id"]])[0]["n"]==1,"Outbox does not bind exact durable command"))
  f.stop();f.start()
  replay=f.ok("scheduler.dispatch.ensure",request,key="manager",component="5.3")
  check("dispatch.restart.same-command",lambda:expect(replay["operation_id"]==result["operation_id"] and replay["replayed"] is True,"Restart generated another physical dispatch"))
  check("dispatch.new-key.no-replacement",lambda:f.reject("scheduler.dispatch.ensure",dict(request,request_id=uid()),"REPLACEMENT_REQUIRES_NEW_ATTEMPT",key="manager",component="5.3"))
  check("dispatch.replay.token-conflict",lambda:f.reject("scheduler.dispatch.ensure",dict(request,token=dict(token,attempt_generation="2")),"IDEMPOTENCY_CONFLICT",key="manager",component="5.3"))
  reconcile={"organisation_id":i["organisation"],"run_id":i["run"],"request_id":request["request_id"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","package_id":i["package"]}
  check("dispatch.no-forged-receipt",lambda:f.reject("scheduler.dispatch.reconcile",dict(reconcile,receipt={"state":"EXECUTING"}),"INVALID_REQUEST",key="manager",component="5.3"))
  other=f.claim("b");other_request={"token":other["token"],"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  f.ok("scheduler.dispatch.ensure",other_request,key="manager2",component="5.3")
  check("dispatch.reconcile.package-spoof-denied",lambda:f.reject("scheduler.dispatch.reconcile",dict(reconcile,request_id=other_request["request_id"]),"PACKAGE_SCOPE_DENIED",key="manager",component="5.3"))
  check("dispatch.reconcile.target-owner-required",lambda:f.reject("scheduler.dispatch.reconcile",dict(reconcile,request_id=other_request["request_id"],package_id=i["wave_package"]),"PACKAGE_OWNER_MISMATCH",key="manager",component="5.3"))
  check("dispatch.unbound-reader.refusal",lambda:f.reject("scheduler.dispatch.reconcile",reconcile,"DEPENDENCY_UNAVAILABLE",key="manager",component="5.3"))
  check("dispatch.unknown.keeps-owner",lambda:expect(f.sql("SELECT compute_authority,execution_state FROM hyperfide.attempts WHERE id=$1",[token["attempt_id"]])[0]=={"compute_authority":"CURRENT","execution_state":"RESERVED"},"Missing external receipt changed execution authority"))
  check("dispatch.no-native-proof.no-release",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.reservations WHERE state='RELEASED'")[0]["n"]==0,"Unconfirmed dispatch freed resources"))
  def race():
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:f.invoke("scheduler.dispatch.ensure",request,key="manager",component="5.3")[1],range(2)))
   expect(all(r.get("ok") and r["result"]["operation_id"]==result["operation_id"] for r in responses),"Concurrent retries changed command identity")
   expect(f.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches WHERE attempt_id=$1",[token["attempt_id"]])[0]["n"]==1,"Retry created duplicate physical intent")
  check("dispatch.concurrent.one-command",race)
  f.add_principal("controller","COORDINATOR")
  check("dispatch.consumer.role-required",lambda:f.reject("scheduler.dispatch.consume",{},"ROLE_DENIED",key="manager",component="5.3"))
  consumed=f.ok("scheduler.dispatch.consume",{"limit":2},key="controller",component="5.3")
  check("dispatch.consumer.actual-inbox-effect",lambda:expect(consumed["processed"]==2 and all(r["status"]=="APPLIED" and r["inbox_id"] for r in consumed["results"]),"Committed claims were not processed by actual durable inbox"))
  check("dispatch.consumer.stable-existing-intent",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches")[0]["n"]==2,"Consumer duplicated an already stable physical command"))
  check("dispatch.consumer.receipt-before-ack",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.event_deliveries d JOIN hyperfide.outbox_events e ON e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id JOIN hyperfide.command_inbox i ON i.organisation_id=d.organisation_id AND i.run_id=d.run_id AND i.principal_scope=d.consumer_id::text AND i.idempotency_key=d.event_id::text AND i.operation='event.receive' AND i.state='COMPLETED' WHERE d.state='ACKNOWLEDGED' AND e.event_type='scheduler.dispatch.requested'")[0]["n"]==2,"ACK lacks actual committed effect receipt"))
  check("dispatch.consumer.native-route-distinct",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.event_deliveries d JOIN hyperfide.outbox_events e ON e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id WHERE d.consumer_id=$1 AND e.event_type='runner.spawn.requested' AND d.state='PENDING'",[i["native_consumer"]])[0]["n"]==2,"Native commands share claim-consumer route or were falsely acknowledged"))
  check("dispatch.consumer.restart-no-repeat",lambda:expect(f.ok("scheduler.dispatch.consume",{"limit":2},key="controller",component="5.3")["processed"]==0,"ACKed claims were reexecuted"))

 finally:
  db=f.database;path=f.path;f.close();check("dispatch.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Fixture resource remains"))
 q=m.SchedulerFixture()
 try:
  token=q.claim("a")["token"];q.add_principal("controller","COORDINATOR")
  hold=q.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'ATTEMPT',scope_id:data.token.attempt_id,mode:'PAUSE',operation_id:crypto.randomUUID(),reason:'Restore preparation must precede queued START'});",{"token":token})
  check("dispatch.consumer.pause-denied",lambda:q.reject("scheduler.dispatch.consume",{},"EXECUTION_HELD",key="controller",component="5.3"))
  check("dispatch.consumer.pause-rollback",lambda:expect(q.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches")[0]["n"]==0 and q.sql("SELECT state FROM hyperfide.event_deliveries WHERE consumer_id=$1",[q.ids["dispatch_consumer"]])[0]["state"]=="PENDING","Held event leaked effect or terminal ACK"))
  resumed=q.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'ATTEMPT',scope_id:data.token.attempt_id,mode:'ACTIVE',operation_id:crypto.randomUUID(),reason:'Lower API CAS test only',resume:true,expected_generation:data.generation});",{"token":token,"generation":hold["result"]["generation"]})
  expect("result" in resumed,"Exact resume CAS failed")
  effect=q.ok("scheduler.dispatch.consume",{},key="controller",component="5.3")
  check("dispatch.consumer.actual-fresh-intent",lambda:expect(effect["processed"]==1 and effect["results"][0]["result"]["effect"]=="DURABLE_DISPATCH_INTENT" and q.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches")[0]["n"]==1,"Released event did not create exactly one real dispatch intent"))
 finally:
  db=q.database;path=q.path;q.close();check("dispatch.consumer.cleanup.observed",lambda:expect(not path.exists() and q.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Consumer fixture remains"))
 return 1 if m.FAILED else 0
if __name__=="__main__":raise SystemExit(main())
