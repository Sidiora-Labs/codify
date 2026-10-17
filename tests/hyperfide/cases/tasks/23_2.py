#!/usr/bin/env python3
"""Task23.2: real authenticated profile/resource accounting, not provider capacity acceptance."""
import importlib.util,json,os,sys,time
from pathlib import Path
spec=importlib.util.spec_from_file_location("observability_fixture",Path(__file__).with_name("23_1.py"))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
DIMENSIONS=["SANDBOX","AGENT_SESSION","CPU_MILLIS","MEMORY_BYTES","DISK_BYTES","BUILD","LINK","TEST","EXCLUSIVE_SERVICE","INDEX","MODEL_REQUEST","MODEL_TOKEN","PROVIDER_API"]

def budget_cases(f):
 def read(value=None):return f.ok("23.2","fleet.resources.sandbox-budgets",value)
 h.check("observability.resources.boot-budget-missing-unqualified",lambda:h.expect(read()["rows"][0]["budget_status"]=="UNQUALIFIED" and read()["rows"][0]["free_cpu_millis"] is None))
 h.sql(f"""
 BEGIN;
 INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,capacity_class,dimension,configured_limit,provenance_digest,qualification_state)
 VALUES('{h.ORG}','{h.uid(250)}','{h.POOL}','EXECUTION','CPU_MILLIS',999999999,'{h.DIGEST}','QUALIFIED');
 INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,expires_at)
 VALUES('{h.ORG}','{h.RUN}','{h.uid(251)}','{h.uid(252)}','{h.uid(250)}',0,clock_timestamp()+interval '1 hour');
 INSERT INTO hyperfide.sandbox_execution_budgets(organisation_id,sandbox_id,sandbox_boot_generation,qualification_id,evidence_digest,qualification_source,hard_cpu_millis,hard_memory_bytes,hard_disk_bytes,headroom_cpu_millis,headroom_memory_bytes,headroom_disk_bytes,held_cpu_millis,held_memory_bytes,held_disk_bytes)
 VALUES('{h.ORG}','{h.SANDBOX}',1,'{h.uid(253)}','{h.DIGEST}','OPERATOR_FIXED',1000,10000,50000,100,1000,5000,600,6000,6000);
 INSERT INTO hyperfide.sandbox_execution_charges(organisation_id,run_id,id,request_id,sandbox_id,sandbox_boot_generation,slot_id,attempt_id,job_kind,cpu_millis,memory_bytes,disk_bytes,state)
 VALUES('{h.ORG}','{h.RUN}','{h.uid(254)}','{h.uid(255)}','{h.SANDBOX}',1,'{h.SLOT}','{h.ATTEMPT}','AGENT',600,6000,6000,'RELEASE_PENDING');
 INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,boot_generation,observed_state)
 VALUES('{h.ORG}','{h.uid(256)}','{h.POOL}',1,'UNKNOWN'),('{h.ORG}','{h.uid(257)}','{h.POOL}',1,'UNKNOWN');
 INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES('{h.ORG}','{h.uid(260)}','{h.uid(256)}','budget-unqualified',1,'AGENT'),('{h.ORG}','{h.uid(261)}','{h.uid(257)}','budget-other-run',1,'AGENT');
 INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,state,sandbox_id,sandbox_boot_generation,slot_id)
 VALUES('{h.ORG}','{h.RUN}','{h.uid(258)}','WORKER','fixture','fixture','fixture-unqualified-budget','RUNNING','{h.uid(256)}',1,'{h.uid(260)}'),
 ('{h.ORG}','{h.RUN2}','{h.uid(259)}','WORKER','fixture','fixture','fixture-other-run-budget','RUNNING','{h.uid(257)}',1,'{h.uid(261)}');
 COMMIT;
 """)
 def qualified():
  r=read();b=next(x for x in r["rows"] if x["sandbox_id"]==h.SANDBOX)
  h.expect(b["budget_status"]=="QUALIFIED_RECORDED" and b["free_cpu_millis"]=="300" and b["free_memory_bytes"]=="3000" and b["free_disk_bytes"]=="39000")
 h.check("observability.resources.boot-free-vector-exact",qualified)
 h.check("observability.resources.pending-release-remains-charged",lambda:h.expect(read()["rows"][0]["run_release_pending_count"]=="1" and read()["rows"][0]["run_retained_cpu_millis"]=="600"))
 h.check("observability.resources.pool-free-not-boot-headroom",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["capacity_accounts"][0]["free"]=="999999999" and read()["rows"][0]["free_cpu_millis"]=="300"))
 h.check("observability.resources.boot-no-kernel-proof",lambda:h.expect(read()["kernel_enforcement"]=="NOT_EVALUATED" and read()["admission_authority"] is False))
 h.check("observability.resources.boot-primary-source",lambda:h.expect(read()["freshness"]["route"]=="PRIMARY" and read()["freshness"]["snapshot"]=="REPEATABLE_READ_READ_ONLY" and read()["source"]["in_recovery"] is False and read()["source"]["visible_wal_lsn"]))
 h.check("observability.resources.boot-source-age-unknown",lambda:h.expect(read()["freshness"]["source_fact_freshness"]=="UNKNOWN_UNTIL_REOBSERVED" and read()["freshness"]["replica_lag_ms"] is None))
 h.check("observability.resources.boot-other-run-hidden",lambda:h.expect(h.uid(257) not in [x["sandbox_id"] for x in read()["rows"]]))
 h.check("observability.resources.boot-unqualified-not-zero-free",lambda:h.expect(next(x for x in read()["rows"] if x["sandbox_id"]==h.uid(256))["free_cpu_millis"] is None))
 def page():
  a=read({"limit":1});b=read({"limit":1,"after":a["pagination"]["next"]})
  h.expect(len(a["rows"])==len(b["rows"])==1 and a["rows"][0]["sandbox_id"]!=b["rows"][0]["sandbox_id"] and b["pagination"]["next"] is None)
 h.check("observability.resources.boot-pagination",page)
 h.check("observability.resources.boot-replica-preference-primary-fallback",lambda:h.expect(read({"prefer_replica":True})["freshness"]["route"]=="PRIMARY"))
 h.check("observability.resources.boot-input-closed",lambda:f.reject("23.2","fleet.resources.sandbox-budgets",{"authority":True},"OBSERVABILITY_INPUT_INVALID"))
 h.check("observability.resources.boot-cursor-typed",lambda:f.reject("23.2","fleet.resources.sandbox-budgets",{"after":{"sandbox_id":h.SANDBOX,"boot_generation":1}},"OBSERVABILITY_INPUT_INVALID"))
 h.check("observability.resources.boot-preference-typed",lambda:f.reject("23.2","fleet.resources.sandbox-budgets",{"prefer_replica":"true"},"OBSERVABILITY_INPUT_INVALID"))
 h.check("observability.resources.boot-cross-run-denied",lambda:f.reject("23.2","fleet.resources.sandbox-budgets",{},run=h.RUN2))
 h.sql(f"BEGIN;UPDATE hyperfide.sandboxes SET boot_generation=2,state_version=state_version+1 WHERE organisation_id='{h.ORG}' AND id='{h.SANDBOX}';COMMIT;")
 h.check("observability.resources.old-boot-debt-retained",lambda:h.expect(read()["rows"][0]["boot_generation"]=="1" and read()["rows"][0]["current_boot"] is False and read()["rows"][0]["run_release_pending_count"]=="1" and read()["rows"][0]["free_cpu_millis"]=="300"))
 # Typed OPERATOR_FIXED fixture records test accounting only, never physical qualification.

def accounting_cases(f,profiles,sample):
 now=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime())
 # Synthetic density sweep remains REPLAY-labelled; it is never reported as measured capacity.
 f.ok("23.2","fleet.resources.observe",{"samples":[dict(sample,profile_id=profiles[1]["id"],value="700",observed_at=now,producer_sequence="1"),dict(sample,profile_id=profiles[2]["id"],value="1000",observed_at=now,producer_sequence="1")]})
 h.sql(f"""
 BEGIN;
 INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) SELECT '{h.ORG}','{h.RUN}',spec_generation,spec_revision_id FROM hyperfide.tasks WHERE organisation_id='{h.ORG}' AND run_id='{h.RUN}' AND id='{h.TASK_ID}' ON CONFLICT DO NOTHING;
 INSERT INTO hyperfide.hierarchy_execution_packets(organisation_id,run_id,id,digest,mandatory_digest,task_id,attempt_id,attempt_generation,spec_revision_id,spec_generation,package_id,package_generation,authority_epoch,leader_generation,policy_digest,registry_digest,packet)
 SELECT '{h.ORG}','{h.RUN}','{h.uid(269)}','sha256:{"c"*64}','{h.DIGEST}',id,'{h.ATTEMPT}',1,spec_revision_id,spec_generation,'{h.PACKAGE}',1,'{h.EPOCH}',1,'{h.DIGEST}','{h.DIGEST}','{{}}' FROM hyperfide.tasks WHERE organisation_id='{h.ORG}' AND run_id='{h.RUN}' AND id='{h.TASK_ID}';
 INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,state,attempt_id) VALUES('{h.ORG}','{h.RUN}','{h.uid(271)}','WORKER','fixture','fixture','fixture-parent-worker','RUNNING','{h.ATTEMPT}');
 INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,state,attempt_id) VALUES
 ('{h.ORG}','{h.RUN}','{h.uid(270)}','WORKER','{h.uid(271)}','fixture','fixture','fixture-native-child','RUNNING','{h.ATTEMPT}'),
 ('{h.ORG}','{h.RUN}','{h.uid(274)}','WORKER','{h.uid(271)}','fixture','fixture','fixture-hidden-local-spawn','RUNNING','{h.ATTEMPT}');
 INSERT INTO hyperfide.sandbox_execution_charges(organisation_id,run_id,id,request_id,sandbox_id,sandbox_boot_generation,slot_id,attempt_id,job_kind,cpu_millis,memory_bytes,disk_bytes,state)
 VALUES('{h.ORG}','{h.RUN}','{h.uid(275)}','{h.uid(272)}','{h.SANDBOX}',1,'{h.SLOT}','{h.ATTEMPT}','CHILD',50,500,0,'HELD');
 INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,attempt_id,expires_at)
 VALUES('{h.ORG}','{h.RUN}','{h.uid(273)}','{h.uid(272)}','{h.uid(250)}',50,'{h.ATTEMPT}',clock_timestamp()+interval '1 hour');
 INSERT INTO hyperfide.hierarchy_child_registrations(organisation_id,run_id,child_session_id,parent_session_id,manager_session_id,package_id,package_generation,task_id,attempt_id,attempt_generation,authority_epoch,sandbox_id,slot_id,sandbox_boot_generation,packet_digest,reservation_request_id,sandbox_charge_id,registered_by_credential_id)
 VALUES('{h.ORG}','{h.RUN}','{h.uid(270)}','{h.uid(271)}','{h.LEADER}','{h.PACKAGE}',1,'{h.TASK_ID}','{h.ATTEMPT}',1,'{h.EPOCH}','{h.SANDBOX}','{h.SLOT}',1,'sha256:{"c"*64}','{h.uid(272)}','{h.uid(275)}','{h.CREDENTIAL}');
 INSERT INTO hyperfide.hierarchy_child_reservations(organisation_id,run_id,child_session_id,reservation_id) VALUES('{h.ORG}','{h.RUN}','{h.uid(270)}','{h.uid(273)}');
 INSERT INTO hyperfide.resource_waiters(organisation_id,run_id,id,request_id,pool_id,owner_session_id,task_id,spec_revision_id,spec_generation,criteria_digest,resource_policy_digest,job_kind,priority,wait_reason,deadline_at)
 SELECT '{h.ORG}','{h.RUN}',w.id::uuid,w.request::uuid,'{h.POOL}','{h.LEADER}',t.id,t.spec_revision_id,t.spec_generation,t.criteria_digest,'{h.DIGEST}',w.kind,0,w.reason,clock_timestamp()+interval '1 hour'
 FROM hyperfide.tasks t,(VALUES('{h.uid(276)}','{h.uid(277)}','BUILD','BUILD'),('{h.uid(278)}','{h.uid(279)}','AGENT','MODEL')) AS w(id,request,kind,reason) WHERE t.organisation_id='{h.ORG}' AND t.run_id='{h.RUN}' AND t.id='{h.TASK_ID}';
 UPDATE hyperfide.attempts SET lease_expires_at=clock_timestamp()-interval '1 minute',state_version=state_version+1 WHERE organisation_id='{h.ORG}' AND run_id='{h.RUN}' AND id='{h.ATTEMPT}';
 INSERT INTO hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest,document) VALUES('{h.ORG}','{h.POOL}','{h.DIGEST}','{{}}');
 INSERT INTO hyperfide.provider_quota_observations(organisation_id,id,pool_id,configuration_digest,provider,account_key,scope_kind,scope_key,dimension,quota_limit,observed_at,expires_at,evidence_digest,basis,evidence_reference,declaration_id)
 VALUES('{h.ORG}','{h.uid(280)}','{h.POOL}','{h.DIGEST}','railway','synthetic-account','POOL','synthetic-pool','AGENT',8,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','{h.DIGEST}','VERIFIED_OPERATOR_ATTESTATION','fixture-attestation',NULL);
 COMMIT;
 """)
 snap=lambda:f.ok("23.2","fleet.resources.snapshot")
 def dims(r,density):return {d["dimension"]:d for d in next(p for p in r["profiles"] if p["declared_agents_per_sandbox"]==density)["dimensions"]}
 def sweep():
  r=snap();status=[dims(r,d)["CPU_MILLIS"]["observed"] for d in (2,4,8)]
  h.expect([s["status"] for s in status]==["STALE","BELOW_DECLARED_LIMIT","SATURATED"] and all(s["basis"]=="SIMULATION" and s["measured_capacity_claim"] is False for s in status))
 h.check("observability.resources.density-sweep-saturation",sweep)
 def reservations():
  r=snap();cpu=[dims(r,d)["CPU_MILLIS"]["declared_reservation"] for d in (2,4,8)]
  h.expect(cpu==["200","400","800"] and all(x["status"]=="DECLARED" for d in (2,4,8) for x in dims(r,d).values()) and dims(r,8)["MODEL_TOKEN"]["observed"]["status"]=="UNOBSERVED" and dims(r,8)["MODEL_TOKEN"]["window_ms"]==60000)
 h.check("observability.resources.declared-reservations-per-profile",reservations)
 def scheduler():
  r=snap();row=[x for x in r["scheduler_reservations"] if x["capacity_account_id"]==h.uid(250)]
  h.expect(r["capacity_accounts_status"]=="AVAILABLE" and r["scheduler_reservations_status"]=="AVAILABLE" and r["queue_status"]=="AVAILABLE" and r["queue_reason"] is None and sum(int(x["quantity"]) for x in row)==50 and row[0]["capacity_class"]=="EXECUTION")
 h.check("observability.resources.scheduler-reservations-installed",scheduler)
 def provider():
  r=snap();q=r["provider_capacity"]
  h.expect(r["provider_capacity_status"]=="AVAILABLE" and len(q)==1 and q[0]["quota_limit"]=="8" and q[0]["dimension"]=="AGENT" and q[0]["basis"]=="VERIFIED_OPERATOR_ATTESTATION" and q[0]["measured_capacity_claim"] is False and q[0]["freshness"]=="CURRENT")
 h.check("observability.resources.provider-capacity-installed",provider)
 def children():
  r=snap();a=r["agent_accounting"];parent=next(x for x in a["parents"] if x["parent_session_id"]==h.uid(271));child=next(x for x in a["sessions"] if x["session_id"]==h.uid(270))
  h.expect(r["agent_accounting_status"]=="AVAILABLE" and parent["children"]==2 and parent["charged_children"]==1 and parent["charged_cpu_millis"]=="50" and child["accounting"]=="CHILD_CHARGED" and child["reservation_count"]=="1" and next(x for x in a["sessions"] if x["session_id"]==h.uid(271))["accounting"]=="ROOT_SESSION")
 h.check("observability.resources.parent-child-accounted",children)
 def hidden():
  a=snap()["agent_accounting"];spawn=next(x for x in a["sessions"] if x["session_id"]==h.uid(274))
  h.expect(spawn["accounting"]=="UNACCOUNTED_SPAWN" and spawn["sandbox_charge_id"] is None and a["unaccounted_spawns"]==1 and a["hidden_spawn_status"]=="UNACCOUNTED_SPAWN_VISIBLE" and next(x for x in a["parents"] if x["parent_session_id"]==h.uid(271))["unaccounted_children"]==1)
 h.check("observability.resources.hidden-spawn-visible",hidden)
 def distinct():
  r=snap();s=r["progress_states"]
  h.expect(s["BUILD_WAITING"]==1 and s["MODEL_WAITING"]==1 and s["STALLED_EXECUTION"]==1 and s["CAPACITY_WAITING"]==0 and [x["attempt_id"] for x in r["stalled_execution"]]==[h.ATTEMPT])
 h.check("observability.resources.build-model-stall-distinct",distinct)
 def reasons():
  d=dims(snap(),4)
  h.expect(d["BUILD"]["queue_reasons"]==["BUILD_WAITING"] and d["MODEL_REQUEST"]["queue_reasons"]==["MODEL_WAITING"] and d["CPU_MILLIS"]["queue_reasons"]==[] and d["PROVIDER_API"]["queue_reasons"]==[])
 h.check("observability.resources.saturation-reason-per-dimension",reasons)

def main():
 h.set_task("23.2")
 if "--cleanup" in sys.argv:return h.cleanup()
 try:
  with h.Fixture("23.2",["23.2"]) as f:
   def profile(n,density):
    return {"id":h.uid(n),"profile_key":"density-"+str(density),"revision":"1","declared_agents_per_sandbox":density,"dimensions":[{"dimension":d,"configured_limit":str(1000 if d=="CPU_MILLIS" else 100),"declared_reservation":str(100*density if d=="CPU_MILLIS" else 1),**({"window_ms":60000} if d in ["MODEL_REQUEST","MODEL_TOKEN","PROVIDER_API"] else {})} for d in DIMENSIONS]}
   profiles=[profile(200+i,d) for i,d in enumerate([2,4,8])]
   h.check("observability.resources.dimensions",lambda:h.expect(f.ok("23.2","fleet.resources.describe")["dimensions"]==DIMENSIONS))
   for i,p in enumerate(profiles):
    h.check("observability.resources.profile-density-"+str(p["declared_agents_per_sandbox"]),lambda p=p:h.expect(f.ok("23.2","fleet.resources.profile.put",p)["replayed"] is False))
   h.check("observability.resources.profile-replay",lambda:h.expect(f.ok("23.2","fleet.resources.profile.put",profiles[0])["replayed"]))
   h.check("observability.resources.profile-conflict",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profiles[0],declared_agents_per_sandbox=3),"OBSERVABILITY_CONFLICT"))
   h.check("observability.resources.unknown-dimension",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profile(210,1),dimensions=[{"dimension":"ANY_AGENT","configured_limit":"1","declared_reservation":"1"}]),"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.duplicate-dimension",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profile(211,1),dimensions=[profiles[0]["dimensions"][0]]*2),"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.reservation-over-limit",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profile(212,1),dimensions=[{"dimension":"CPU_MILLIS","configured_limit":"1","declared_reservation":"2"}]),"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.numeric-quantity-denied",lambda:f.reject("23.2","fleet.resources.profile.put",dict(profile(213,1),dimensions=[{"dimension":"CPU_MILLIS","configured_limit":1,"declared_reservation":"0"}]),"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.unobserved-unknown",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"]==[]))
   now=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime())
   sample={"profile_id":profiles[0]["id"],"subject_id":h.SANDBOX,"dimension":"CPU_MILLIS","value":"1001","observed_at":now,"producer_sequence":"1","origin":"REPLAY","source_digest":h.DIGEST,"source_artifact_id":h.ARTIFACT}
   h.check("observability.resources.record-saturation",lambda:h.expect(f.ok("23.2","fleet.resources.observe",{"samples":[sample]})["recorded"]==1))
   h.check("observability.resources.simulated-origin-visible",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"][0]["simulation"] is True))
   h.check("observability.resources.saturation-distinct",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"][0]["utilisation_status"]=="SATURATED"))
   h.check("observability.resources.report-not-verification",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"][0]["independently_verified"] is False))
   h.check("observability.resources.sample-replay",lambda:h.expect(f.ok("23.2","fleet.resources.observe",{"samples":[sample]})["replayed"]==1))
   h.check("observability.resources.sample-conflict",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[dict(sample,value="999")]},"OBSERVABILITY_CONFLICT"))
   h.check("observability.resources.duplicate-batch-key",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[sample,sample]},"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.batch-bound",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[sample]*101},"OBSERVABILITY_INPUT_INVALID"))
   h.check("observability.resources.absent-artifact-denied",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[dict(sample,producer_sequence="2",source_artifact_id=h.uid(999))]},"OBSERVABILITY_EVIDENCE_UNAVAILABLE"))
   h.check("observability.resources.untrusted-producer-denied",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[dict(sample,producer_sequence="2")]},"OBSERVABILITY_PRODUCER_FORBIDDEN",role="VERIFIER"))
   def stale():
    old=dict(sample,producer_sequence="2",observed_at=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()-60)))
    f.ok("23.2","fleet.resources.observe",{"samples":[old]})
    h.expect(f.ok("23.2","fleet.resources.snapshot")["measurements"][0]["utilisation_status"]=="STALE")
   h.check("observability.resources.stale-not-saturation",stale)
   h.check("observability.resources.old-sequence-denied",lambda:f.reject("23.2","fleet.resources.observe",{"samples":[sample]},"OBSERVABILITY_STALE_OBSERVATION"))
   def distinct():
    r=f.ok("23.2","fleet.resources.snapshot");h.expect(r["uniform_agent_capacity_assumed"] is False and r["prepared_spares_are_running_sessions"] is False and sum(int(x["count"]) for x in r["registered_sessions"])==2 and len(r["profiles"])==3)
   h.check("observability.resources.profile-density-not-session-count",distinct)
   h.check("observability.resources.observation-not-admission",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["admission_authority"] is False))
   budget_cases(f)
   h.check("observability.resources.cross-run-denied",lambda:f.reject("23.2","fleet.resources.snapshot",{},run=h.RUN2))
   h.check("observability.resources.untyped-capacity-not-inferred",lambda:h.expect(f.ok("23.2","fleet.resources.snapshot")["capacity_accounts_status"]=="AVAILABLE"))
   accounting_cases(f,profiles,sample)
  return h.finish()
 except Exception as e:print(json.dumps({"type":"fatal","error":type(e).__name__+": "+str(e)}),flush=True);return 1
if __name__=="__main__":raise SystemExit(main())
