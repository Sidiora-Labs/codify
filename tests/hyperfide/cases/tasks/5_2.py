#!/usr/bin/env python3
"""Primary-clock expiry and cancellation through actual authenticated scheduler."""
from __future__ import annotations
import importlib.util,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("hf_scheduler_fixture",ROOT/"tests/hyperfide/cases/tasks/5_1.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
SchedulerFixture=m.SchedulerFixture;expect=m.expect;check=m.check;uid=m.uid
def main():
 m.configure_cleanup("5.2")
 f=SchedulerFixture();i=f.ids
 try:
  r=f.claim("a",lease_ms=1000);t=r["token"]
  scope={"organisation_id":i["organisation"],"run_id":i["run"],"authority_epoch":i["epoch"],"leader_generation":"1"}
  cancel={"token":t,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  check("lease.renew.manager-denied",lambda:f.reject("scheduler.lease.renew",{"token":t,"lease_ms":300000},"ACTOR_DENIED",key="manager",component="5.2"))
  check("lease.expiry.primary-clock",lambda:expect(f.sql("SELECT lease_expires_at>clock_timestamp() AS live FROM hyperfide.attempts WHERE id=$1",[t["attempt_id"]])[0]["live"] in (True,False),"Primary clock query unavailable"))
  # Wait for the real primary deadline; no forged clock or synthetic lease row.
  while f.sql("SELECT lease_expires_at>clock_timestamp() AS live FROM hyperfide.attempts WHERE id=$1",[t["attempt_id"]])[0]["live"]:time.sleep(.05)
  check("lease.expired.dispatch-denied",lambda:f.reject("scheduler.dispatch.ensure",dict(cancel,request_id=uid()),"COMPUTE_LEASE_EXPIRED",key="manager",component="5.3"))
  result=f.ok("scheduler.compute.expire",scope,component="5.2")
  check("lease.expiry.exact-attempt",lambda:expect(result["expired_attempt_ids"]==[t["attempt_id"]] and result["resources_still_counted"] is True,"Expiry did not identify exact current attempt"))
  check("lease.expiry.fences-authority",lambda:expect(f.sql("SELECT compute_authority,execution_state FROM hyperfide.attempts WHERE id=$1",[t["attempt_id"]])[0]=={"compute_authority":"EXPIRED","execution_state":"FAILED"},"Expired compute retains authority"))
  check("lease.expiry.keeps-quota",lambda:expect(all(int(x["reserved"])+int(x["allocated"])>0 for x in f.counts() if x["dimension"] in ("AGENT","CPU_MILLIS","MEMORY_BYTES","DISK_BYTES")),"TTL freed occupied capacity"))
  check("lease.expiry.requests-cleanup",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.outbox_events WHERE event_type='scheduler.compute.stop.requested'")[0]["n"]==1 and f.sql("SELECT state FROM hyperfide.worker_slots WHERE id=$1",[t["slot_id"]])[0]["state"]=="DRAINING","Expiry omitted durable cleanup or slot fence"))
  check("lease.expiry.idempotent",lambda:expect(f.ok("scheduler.compute.expire",scope,component="5.2")["expired_attempt_ids"]==[],"Expiry repeated authority transition"))
  b=f.claim("b");bt=b["token"];request={"token":bt,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  lower={"token":bt}
  check("lease.trusted-primary.renew",lambda:expect("result" in f.primary("return leases.renewCompute(tx,data.token,300000);",lower),"Actual branded primary renewal failed"))
  pause=f.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'PAUSE',operation_id:crypto.randomUUID(),reason:'Bounded lower API control regression'});",{"package_id":i["wave_package"]})
  check("lease.pause.primary-history",lambda:expect(pause.get("result",{}).get("mode")=="PAUSE","Control was not durable"))
  check("lease.pause.blocks-advance",lambda:expect(f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'ADVANCE'});",lower).get("error",{}).get("code")=="EXECUTION_HELD","Paused compute advanced"))
  check("lease.pause.allows-checkpoint",lambda:expect("result" in f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'CHECKPOINT'});",lower),"Paused current compute could not register checkpoint"))
  check("lease.pause.allows-renewal",lambda:expect("result" in f.primary("return leases.renewCompute(tx,data.token,300000);",lower),"Paused compute lost bounded renewal"))
  check("lease.control.unknown-fields",lambda:expect(f.primary("await claims.assertNoExecutionHold(tx,data.scope,{task_id:data.token.task_id,operation:'ADVANCE'});return true;",lower).get("error",{}).get("code")=="INVALID_REQUEST","Unknown scope field was silently ignored"))
  check("lease.resume.requires-cas",lambda:expect(f.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'ACTIVE',operation_id:crypto.randomUUID(),reason:'Unverified weakening'});",{"package_id":i["wave_package"]}).get("error",{}).get("code")=="RESUME_REVALIDATION_REQUIRED","Hold weakened without exact resume generation"))
  resume=f.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'ACTIVE',operation_id:crypto.randomUUID(),reason:'Exact verified test resume',resume:true,expected_generation:data.generation});",{"package_id":i["wave_package"],"generation":pause["result"]["generation"]})
  check("lease.resume.exact-generation",lambda:expect(resume.get("result",{}).get("mode")=="ACTIVE","Exact resume failed"))
  drain=f.primary("const deadline=(await tx.query(`SELECT (clock_timestamp()+interval '60 seconds')::text AS deadline`)).rows[0].deadline;return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'DRAIN',deadline_at:new Date(deadline).toISOString(),fallback_mode:'STOP',operation_id:crypto.randomUUID(),reason:'Real pre-drain admission test'});",{"package_id":i["wave_package"]})
  check("lease.drain.persisted-admission",lambda:expect("result" in f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'ADVANCE'});",lower),"Pre-drain claimed attempt was blocked"))
  check("lease.drain.requires-selector",lambda:expect(f.primary("return claims.assertNoExecutionHold(tx,data.scope,{package_id:data.package_id,operation:'ADVANCE'});",{"package_id":i["wave_package"]}).get("error",{}).get("code")=="EXECUTION_CONTINUATION_UNPROVEN","Drain accepted an unproven continuation"))
  check("lease.drain.blocks-admission",lambda:expect(f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'ADMISSION'});",lower).get("error",{}).get("code")=="EXECUTION_HELD","Drain admitted new work"))
  f.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'ACTIVE',operation_id:crypto.randomUUID(),reason:'Resume after bounded drain regression',resume:true,expected_generation:data.generation});",{"package_id":i["wave_package"],"generation":drain["result"]["generation"]})
  check("lease.cancel.foreign-manager",lambda:f.reject("scheduler.compute.cancel",request,"PACKAGE_OWNER_MISMATCH",key="manager",component="5.2"))
  cancelled=f.ok("scheduler.compute.cancel",request,key="manager2",component="5.2")
  check("lease.cancel.logical-only",lambda:expect(cancelled["termination_confirmed"] is False and cancelled["resource_disposition"]=="RELEASE_PENDING","Cancellation fabricated physical termination"))
  check("lease.cancel.replay",lambda:expect(f.ok("scheduler.compute.cancel",request,key="manager2",component="5.2")==cancelled,"Cancellation replay revived authority"))
  check("lease.cancel.stale-result-denied",lambda:f.reject("scheduler.dispatch.ensure",dict(request,request_id=uid()),"COMPUTE_ALLOCATION_INVALID",key="manager2",component="5.3"))
  check("lease.cancel.immutable-history",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==2 and f.sql("SELECT count(*)::int n FROM hyperfide.compute_leases")[0]["n"]==2,"Cleanup deleted historical authority records"))
  check("lease.cleanup.retains-sandbox-charges",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.sandbox_execution_charges WHERE state='RELEASE_PENDING'")[0]["n"]==2 and f.sql("SELECT held_cpu_millis::text cpu FROM hyperfide.sandbox_execution_budgets WHERE sandbox_id=$1",[i["sandbox"]])[0]["cpu"]=="2000","TTL/cancel freed unknown physical execution capacity"))
  check("lease.expiry.no-custody-created",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.submission_custodies")[0]["n"]==0,"Compute expiry manufactured submission custody"))
 finally:
  db=f.database;path=f.path;f.close();check("lease.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Fixture resource remains"))
 recovery=SchedulerFixture()
 try:
  current=recovery.claim('a');token=current['token'];before=recovery.counts()
  data={"organisation_id":recovery.ids["organisation"],"run_id":recovery.ids["run"],"expected_run_epoch":recovery.ids["epoch"],"target_epoch":uid(),"recovery_operation_id":uid()}
  wrong=dict(data,expected_run_epoch=uid())
  check("lease.recovery.exact-source-epoch",lambda:expect(recovery.primary("return leases.revokeRunForRecovery(tx,data.input);",{"input":wrong}).get("error",{}).get("code")=="STALE_AUTHORITY_EPOCH","Foreign source epoch revoked compute"))
  check("lease.recovery.transaction-rollback",lambda:expect(recovery.primary("await leases.revokeRunForRecovery(tx,data.input);throw Error('bounded rollback injection');",{"input":data}).get("error",{}).get("code")=="ERROR" and recovery.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE compute_authority='CURRENT'")[0]["n"]==1 and recovery.counts()==before,"Rollback lost authority or resource counters"))
  revoked=recovery.primary("return leases.revokeRunForRecovery(tx,data.input);",{"input":data})["result"]
  check("lease.recovery.revokes-current",lambda:expect(revoked["revoked_attempts"]=="1" and revoked["revoked_allocations"]=="1" and recovery.sql("SELECT count(*)::int n FROM hyperfide.compute_leases WHERE state='ACTIVE'")[0]["n"]==0,"Offline revocation left active compute"))
  check("lease.recovery.retains-physical-debt",lambda:expect(recovery.counts()==before and any(x.startswith("sandbox-charge:") for x in revoked["retained_debt_references"]) and recovery.sql("SELECT state FROM hyperfide.sandbox_execution_charges")[0]["state"]=="RELEASE_PENDING","Offline recovery freed unknown physical capacity"))
  check("lease.recovery.does-not-rebind-run",lambda:expect(recovery.sql("SELECT authority_epoch FROM hyperfide.runs")[0]["authority_epoch"]==data["expected_run_epoch"],"Lower revoker bypassed14 epoch CAS"))
  check("lease.recovery.idempotent-revocation",lambda:expect(recovery.primary("return leases.revokeRunForRecovery(tx,data.input);",{"input":data})["result"]["revoked_attempts"]=="0","Repeated source revocation fabricated work"))
 finally:
  db=recovery.database;path=recovery.path;recovery.close();check("lease.recovery.cleanup.observed",lambda:expect(not path.exists() and recovery.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Recovery disposable fixture remains"))
 return 1 if m.FAILED else 0
if __name__=="__main__":raise SystemExit(m.cleanup_owned("5.2") if "--cleanup" in sys.argv else main())
