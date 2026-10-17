#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime,timedelta,timezone
import importlib.util,json,sys,time
spec=importlib.util.spec_from_file_location("recovery_common",Path(__file__).with_name("24_1.py"));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def tests(f):
 m.check("recovery.worker.real-process",lambda:m.expect(f.ok("recovery.worker.describe",{})["accepted_custody_survives"] is True))
 request={"scope":m.SCOPE,"operation_id":m.uid(50),"attempt_id":m.ATTEMPT,"attempt_generation":"1","sandbox_boot_generation":"1"}
 result=f.ok("recovery.worker.loss",request)
 m.check("recovery.worker.durable-restoration-request",lambda:m.expect(result["restoration_request"]["state"]=="WAITING_INVENTORY" and result["restoration_request"]["authority"]=="NONE"))
 restoration=f.ok("recovery.worker.restoration.inspect",{"scope":m.SCOPE,"loss_operation_id":m.uid(50)})
 m.check("recovery.worker.restoration-source-pinned",lambda:m.expect(restoration["request"]["source_attempt_id"]==m.ATTEMPT and restoration["request"]["source_attempt_generation"]=="1" and restoration["request"]["source_boot_generation"]=="1"))
 m.check("recovery.worker.restoration-grants-no-authority",lambda:m.expect(restoration["replacement_authorized"] is False and restoration["context_restored"] is False and restoration["authority"]=="NONE"))
 m.check("recovery.worker.compute-revoked",lambda:m.expect(result["compute_authority"]=="REVOKED" and m.sql("SELECT compute_authority FROM hyperfide.attempts WHERE id='"+m.ATTEMPT+"';")=="REVOKED"))
 m.check("recovery.worker.lease-revoked",lambda:m.expect(m.sql("SELECT state FROM hyperfide.compute_leases;")=="REVOKED"))
 m.check("recovery.worker.custody-preserved",lambda:m.expect(m.sql("SELECT authority FROM hyperfide.submission_custodies;")=="ACTIVE"))
 m.check("recovery.worker.normal-scheduler-eligible",lambda:m.expect(result["normal_scheduler_recovery_pending"] is True and m.sql("SELECT state FROM hyperfide.tasks WHERE id='"+m.uid(7)+"';")=="STALE"))
 m.check("recovery.worker.replacement-hold-durable",lambda:m.expect(result["replacement_gate"]["mode"]=="STOP" and m.sql("SELECT mode FROM hyperfide.execution_controls WHERE scope_id='"+m.ATTEMPT+"';")=="STOP"))
 m.check("recovery.worker.qualification-not-compute",lambda:m.expect(len(result["qualification_jobs_requeued"])==0))
 m.check("recovery.worker.no-premature-replacement",lambda:m.expect(result["replacement_authorized"] is False and result["publication_authorized"] is False))
 m.check("recovery.worker.explicit-resource-debt",lambda:m.expect(m.sql("SELECT count(*) FROM hyperfide.recovery_resource_debts WHERE status='OPEN';")=="2"))
 custody=f.ok("recovery.worker.loss",{**request,"operation_id":m.uid(51),"attempt_id":m.uid(28)})
 m.check("recovery.worker.custody-loss-does-not-request-reimplementation",lambda:m.expect(custody["restoration_request"] is None and m.sql("SELECT count(*) FROM hyperfide.recovery_replacement_requests;")=="1"))
 m.check("recovery.worker.accepted-submission-loss",lambda:m.expect(len(custody["preserved_submission_custody"])==1 and custody["compute_authority"]=="RELEASED"))
 m.check("recovery.worker.qualification-own-lease",lambda:m.expect(len(custody["qualification_jobs_requeued"])==1 and m.sql("SELECT state||':'||lease_generation FROM hyperfide.qualification_jobs;")=="PENDING:2"))
 m.check("recovery.worker.idempotent-loss",lambda:m.expect(f.ok("recovery.worker.loss",request)==result))
 m.check("recovery.worker.idempotency-conflict",lambda:f.rejected("recovery.worker.loss",{**request,"sandbox_boot_generation":"2"},"RECOVERY_IDEMPOTENCY_CONFLICT"))
 m.check("recovery.worker.stale-epoch",lambda:f.rejected("recovery.worker.loss",{**request,"scope":{**m.SCOPE,"authority_epoch":m.uid(98)}},"RECOVERY_STALE_EPOCH"))
 m.check("recovery.worker.restart-snapshot",lambda:m.expect(f.ok("recovery.worker.inventory",m.SCOPE)["attempts"][0]["compute_token_current"] is False))
 def immutable_source():
  try:m.sql("UPDATE hyperfide.recovery_replacement_requests SET source_attempt_generation=2,state_version=state_version+1 WHERE id='"+m.uid(50)+"';")
  except AssertionError as error:
   m.expect("Recovery loss provenance is immutable" in str(error));return
  raise AssertionError("Historical recovery source changed")
 m.check("recovery.worker.restoration-source-immutable",immutable_source)
 m.check("recovery.worker.restoration-snapshot",lambda:m.expect(len(f.ok("recovery.worker.inventory",m.SCOPE)["worker_restoration_requests"])==1))
 restoration_flow(f)
ENV="sha256:"+"e"*64
OTHER_ENV="sha256:"+"f"*64
def stamp(delta=0):return (datetime.now(timezone.utc)+timedelta(seconds=delta)).isoformat(timespec="milliseconds").replace("+00:00","Z")
def target_sandbox(sandbox,slot):
 m.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,observed_state,preparation_digest) VALUES('%s','%s','%s','RUNNING','%s');INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES('%s','%s','%s','worker',1,'AGENT');"%(m.ORG,sandbox,m.uid(8),ENV,m.ORG,slot,sandbox))
def checkpoint(base,attempt,generation,sandbox,slot,session,support):
 """Durable registered checkpoint of a lost attempt: workspace, complete capsule and the three immutable context artifacts."""
 o,r,a=m.ORG,m.RUN,lambda i:"sha256:"+format(base+i,"064x")
 rows=["INSERT INTO hyperfide.workspaces(organisation_id,run_id,id,repository_id,attempt_id,attempt_generation,sandbox_id,slot_id,sandbox_boot_generation,base_commit,branch_ref,workspace_path) VALUES('%s','%s','%s','%s','%s',%s,'%s','%s',1,repeat('a',40),'refs/heads/worker','/workspace/%d');"%(o,r,m.uid(base),m.uid(3),attempt,generation,sandbox,slot,base)]
 rows+=["INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status) VALUES('%s','%s','%s','%s',100,'object','checkpoint-%d','COMPLETE');"%(o,r,m.uid(base+i),a(i),base+i) for i in range(1,5)]
 rows+=["INSERT INTO hyperfide.checkpoints(organisation_id,run_id,id,attempt_id,attempt_generation,agent_session_id,artifact_id,repository_id,source_object_id,input_packet_digest,support_level,artifact_content_digest,source_metadata_digest,preparation_digest,dependency_digest,source_manifest,registration_operation_id,registration_payload_digest,registration_actor_id,registration_kind,source_workspace_id,artifact_content_size_bytes) VALUES('%s','%s','%s','%s',%s,'%s','%s','%s',repeat('a',40),'%s','%s','%s','%s','%s','%s','{}','%s','%s','%s','LIVE','%s',100);"%(o,r,m.uid(base+5),attempt,generation,session,m.uid(base+1),m.uid(3),m.D,support,a(1),m.D,ENV,m.D,m.uid(base+6),m.D,m.uid(base+7),m.uid(base))]
 rows+=["INSERT INTO hyperfide.checkpoint_context_artifacts(organisation_id,run_id,checkpoint_id,role,artifact_id,artifact_digest,artifact_size_bytes,receipt_id,storage_kind,content_digest,content_size_bytes) VALUES('%s','%s','%s','%s','%s','%s',100,'%s','object','%s',100);"%(o,r,m.uid(base+5),role,m.uid(base+i),a(i),m.D,a(i)) for i,role in ((2,"dependency"),(3,"summary"),(4,"findings"))]
 m.sql("BEGIN;"+"".join(rows)+"COMMIT;")
 return m.uid(base+5)
def rejected_code(f,action,payload):
 row=f.request(action,payload);m.expect(row.get("ok") is False,str(row));return row["error"]["code"]
def restoration_flow(f):
 S=lambda:m.SCOPE
 target_sandbox(m.uid(60),m.uid(61));target_sandbox(m.uid(62),m.uid(63))
 first=checkpoint(70,m.ATTEMPT,1,m.uid(9),m.uid(10),m.uid(22),"NATIVE_RESUME")
 # Partitioned old worker: its process is unreachable (not inferred absent); its sandbox was observed gone.
 inventory=[{"resource_kind":"SUPERVISOR","resource_id":m.uid(22),"observed_state":"UNREACHABLE","evidence_digest":m.D},{"resource_kind":"SANDBOX","resource_id":m.uid(9),"observed_state":"ABSENT","evidence_digest":m.D}]
 target={"source_object_id":"a"*40,"input_packet_digest":m.D,"environment_digest":ENV,"native_session_id":"worker","sandbox_id":m.uid(60),"slot_id":m.uid(61),"sandbox_boot_generation":"1"}
 restore={"scope":S(),"loss_operation_id":m.uid(50),"checkpoint_id":first,"inventory":inventory,"target":target}
 m.check("recovery.worker.inventory-required",lambda:f.rejected("recovery.worker.restore",{**restore,"inventory":inventory[:1]},"RECOVERY_INVENTORY_INCOMPLETE"))
 held=f.ok("recovery.worker.restore",{**restore,"target":{**target,"environment_digest":OTHER_ENV}})
 m.check("recovery.worker.incompatible-checkpoint-held",lambda:m.expect(held["state"]=="HELD" and "ENVIRONMENT_MISMATCH" in held["reasons"] and m.sql("SELECT state||':'||hold_reason FROM hyperfide.recovery_replacement_requests WHERE id='"+m.uid(50)+"';")=="HELD:"+held["hold_reason"]))
 m.check("recovery.worker.held-grants-nothing",lambda:m.expect(held["replacement_attempt"] is None and held["authority"]=="NONE" and m.sql("SELECT count(*)||':'||max(t.current_attempt_id::text) FROM hyperfide.attempts a JOIN hyperfide.tasks t ON t.id=a.task_id WHERE a.task_id='"+m.uid(7)+"';")=="1:"+m.ATTEMPT))
 lost=f.ok("recovery.worker.restore",{**restore,"target":{**target,"sandbox_id":m.uid(9),"slot_id":m.uid(10)}})
 m.check("recovery.worker.lost-boot-target-refused",lambda:m.expect(lost["state"]=="HELD" and "TARGET_IS_LOST_BOOT" in lost["reasons"]))
 ready=f.ok("recovery.worker.restore",restore)
 new=ready["replacement_attempt"]
 m.check("recovery.worker.compatible-restore-ready",lambda:m.expect(ready["state"]=="READY" and ready["transitions"]==["HELD","RESTORING","READY"] and ready["checkpoint"]["mode"]=="NATIVE_RESUME" and m.sql("SELECT state||':'||replacement_attempt_id||':'||replacement_attempt_generation||':'||checkpoint_id FROM hyperfide.recovery_replacement_requests WHERE id='"+m.uid(50)+"';")=="READY:%s:2:%s"%(new["id"],first)))
 m.check("recovery.worker.restore-new-identity",lambda:m.expect(new["id"]!=m.ATTEMPT and new["generation"]=="2" and new["compute_authority"]=="RELEASED" and ready["authority"]=="NONE" and m.sql("SELECT current_attempt_id||':'||generation FROM hyperfide.tasks WHERE id='"+m.uid(7)+"';")==new["id"]+":2"))
 m.check("recovery.worker.old-generation-not-renewed",lambda:m.expect(m.sql("SELECT a.compute_authority||':'||a.generation||':'||(SELECT string_agg(state,',') FROM hyperfide.compute_leases WHERE attempt_id=a.id) FROM hyperfide.attempts a WHERE id='"+m.ATTEMPT+"';")=="REVOKED:1:REVOKED"))
 m.check("recovery.worker.survivors-remain-explicit",lambda:m.expect([x["resource_kind"] for x in ready["inventory"]["surviving"]]==["SUPERVISOR"] and m.sql("SELECT string_agg(resource_kind||':'||status||':'||observed_state,',' ORDER BY resource_kind) FROM hyperfide.recovery_resource_debts WHERE operation_id='"+m.uid(50)+"';")=="SANDBOX:RESOLVED:ABSENT,SUPERVISOR:RECONCILING:UNREACHABLE"))
 m.check("recovery.worker.artifacts-preserved",lambda:m.expect([x["id"] for x in ready["preserved_artifacts"]]==[first] and m.sql("SELECT status FROM hyperfide.artifacts WHERE id='"+m.uid(71)+"';")=="COMPLETE"))
 m.check("recovery.worker.restore-idempotent",lambda:m.expect(f.ok("recovery.worker.restore",restore)["replacement_attempt"]==new))
 m.check("recovery.worker.restore-conflict",lambda:f.rejected("recovery.worker.restore",{**restore,"target":{**target,"sandbox_id":m.uid(62),"slot_id":m.uid(63)}},"RECOVERY_IDEMPOTENCY_CONFLICT"))
 # V-041: the restored identity is inert until it enrolls once from its own target boot.
 early=f.ok("recovery.worker.output",{"scope":S(),"operation_id":m.uid(90),"attempt_id":new["id"],"attempt_generation":"2","sandbox_boot_generation":"1","session_id":m.uid(22),"kind":"COMPLETION","output_digest":m.D,"worker_reported_at":stamp()})
 m.check("recovery.worker.clone-before-enrollment-inert",lambda:m.expect(early["disposition"]=="ARCHIVE_PROVENANCE_ONLY" and early["reason"]=="NO_COMPUTE_AUTHORITY" and early["publication_authorized"] is False and rejected_code(f,"recovery.worker.renew",{"scope":S(),"attempt_id":new["id"],"attempt_generation":"2","sandbox_boot_generation":"1","session_id":m.uid(22),"lease_ms":30000,"worker_observed_at":stamp()})=="RECOVERY_NO_COMPUTE_AUTHORITY"))
 enroll={"scope":S(),"loss_operation_id":m.uid(50),"attempt_id":new["id"],"attempt_generation":"2","sandbox_id":m.uid(60),"slot_id":m.uid(61),"sandbox_boot_generation":"1","native_session_id":"worker","lease_ms":30000}
 m.check("recovery.worker.copied-authority-refused",lambda:f.rejected("recovery.worker.enroll",{**enroll,"attempt_id":m.ATTEMPT,"attempt_generation":"1"},"RECOVERY_COPIED_AUTHORITY"))
 m.check("recovery.worker.clone-boot-refused",lambda:f.rejected("recovery.worker.enroll",{**enroll,"sandbox_id":m.uid(9),"slot_id":m.uid(10)},"RECOVERY_ENROLLMENT_MISMATCH"))
 enrolled=f.ok("recovery.worker.enroll",enroll);session2=enrolled["session_id"]
 m.check("recovery.worker.fresh-identity-enrolled",lambda:m.expect(session2!=m.uid(22) and enrolled["source_session_reused"] is False and m.sql("SELECT role||':'||state||':'||attempt_id||':'||sandbox_id FROM hyperfide.agent_sessions WHERE id='"+session2+"';")=="WORKER:RUNNING:%s:%s"%(new["id"],m.uid(60))))
 m.check("recovery.worker.single-enrollment",lambda:m.expect(f.ok("recovery.worker.enroll",enroll)["session_id"]==session2 and rejected_code(f,"recovery.worker.enroll",{**enroll,"native_session_id":"clone"})=="RECOVERY_ALREADY_ENROLLED"))
 m.check("recovery.worker.single-compute-owner",lambda:m.expect(m.sql("SELECT string_agg(id::text,',') FROM hyperfide.attempts WHERE task_id='"+m.uid(7)+"' AND compute_authority='CURRENT';")==new["id"]))
 # V-004 order 1: the partitioned old worker returns before the replacement acts.
 m.check("recovery.worker.partitioned-old-renew-refused",lambda:f.rejected("recovery.worker.renew",{"scope":S(),"attempt_id":m.ATTEMPT,"attempt_generation":"1","sandbox_boot_generation":"1","session_id":m.uid(22),"lease_ms":30000,"worker_observed_at":stamp(-3600)},"RECOVERY_STALE_GENERATION"))
 old_output={"scope":S(),"operation_id":m.uid(91),"attempt_id":m.ATTEMPT,"attempt_generation":"1","sandbox_boot_generation":"1","session_id":m.uid(22),"kind":"COMPLETION","output_digest":"sha256:"+"1"*64,"worker_reported_at":stamp(-60)}
 stale=f.ok("recovery.worker.output",old_output)
 m.check("recovery.worker.stale-outputs-nonauthoritative",lambda:m.expect(stale["disposition"]=="ARCHIVE_PROVENANCE_ONLY" and stale["reason"]=="STALE_GENERATION" and stale["publication_authorized"] is False and stale["attempt_id"]==m.ATTEMPT and stale["attempt_generation"]=="1" and stale["output_digest"]=="sha256:"+"1"*64 and stale["current_attempt_id"]==new["id"] and m.sql("SELECT state FROM hyperfide.tasks WHERE id='"+m.uid(7)+"';")=="RUNNING"))
 # Delayed renewal across expiry with skewed worker clocks: only primary time decides.
 skew=f.ok("recovery.worker.renew",{"scope":S(),"attempt_id":new["id"],"attempt_generation":"2","sandbox_boot_generation":"1","session_id":session2,"lease_ms":1000,"worker_observed_at":stamp(3600)})
 def primary_window():
  window=m.sql("SELECT round(extract(epoch FROM ('"+skew["lease_expires_at"]+"'::timestamptz-'"+skew["primary_now"]+"'::timestamptz))*1000);")
  m.expect(skew["worker_clock_trusted"] is False and abs(float(window)-1000)<50,window)
 m.check("recovery.worker.skewed-clock-not-trusted",primary_window)
 time.sleep(1.6)
 m.check("recovery.worker.renewal-after-expiry-refused",lambda:f.rejected("recovery.worker.renew",{"scope":S(),"attempt_id":new["id"],"attempt_generation":"2","sandbox_boot_generation":"1","session_id":session2,"lease_ms":30000,"worker_observed_at":stamp(-30)},"RECOVERY_LEASE_EXPIRED"))
 expired=f.ok("recovery.worker.output",{"scope":S(),"operation_id":m.uid(92),"attempt_id":new["id"],"attempt_generation":"2","sandbox_boot_generation":"1","session_id":session2,"kind":"COMPLETION","output_digest":"sha256:"+"2"*64,"worker_reported_at":stamp(-30)})
 m.check("recovery.worker.expired-output-archived",lambda:m.expect(expired["disposition"]=="ARCHIVE_PROVENANCE_ONLY" and expired["reason"]=="LEASE_EXPIRED" and expired["publication_authorized"] is False))
 # The expired replacement is itself lost; recover again into generation 3.
 second=checkpoint(80,new["id"],2,m.uid(60),m.uid(61),session2,"SOURCE_ONLY")
 loss2=f.ok("recovery.worker.loss",{"scope":S(),"operation_id":m.uid(52),"attempt_id":new["id"],"attempt_generation":"2","sandbox_boot_generation":"1"})
 ready3=f.ok("recovery.worker.restore",{"scope":S(),"loss_operation_id":m.uid(52),"checkpoint_id":second,"inventory":[{"resource_kind":"SUPERVISOR","resource_id":session2,"observed_state":"STOPPED","evidence_digest":m.D},{"resource_kind":"SANDBOX","resource_id":m.uid(60),"observed_state":"PRESENT","evidence_digest":m.D}],"target":{**target,"native_session_id":None,"sandbox_id":m.uid(62),"slot_id":m.uid(63)}})
 newest=ready3["replacement_attempt"]
 m.check("recovery.worker.replacement-loss-restores",lambda:m.expect(loss2["compute_authority"]=="REVOKED" and ready3["state"]=="READY" and ready3["transitions"]==["WAITING_INVENTORY","RESTORING","READY"] and ready3["checkpoint"]["mode"]=="SOURCE_ONLY" and newest["generation"]=="3" and newest["id"] not in (m.ATTEMPT,new["id"])))
 session3=f.ok("recovery.worker.enroll",{**enroll,"loss_operation_id":m.uid(52),"attempt_id":newest["id"],"attempt_generation":"3","sandbox_id":m.uid(62),"slot_id":m.uid(63),"lease_ms":60000})["session_id"]
 # V-004 order 2: the newest generation returns first, then delayed old workers return.
 published=f.ok("recovery.worker.output",{"scope":S(),"operation_id":m.uid(93),"attempt_id":newest["id"],"attempt_generation":"3","sandbox_boot_generation":"1","session_id":session3,"kind":"COMPLETION","output_digest":"sha256:"+"3"*64,"worker_reported_at":stamp(-7200)})
 m.check("recovery.worker.new-first-publishes",lambda:m.expect(published["disposition"]=="AUTHORITATIVE_COMPLETION" and published["publication_authorized"] is True and published["worker_clock_trusted"] is False))
 late2=f.ok("recovery.worker.output",{"scope":S(),"operation_id":m.uid(94),"attempt_id":new["id"],"attempt_generation":"2","sandbox_boot_generation":"1","session_id":session2,"kind":"COMPLETION","output_digest":"sha256:"+"4"*64,"worker_reported_at":stamp(7200)})
 late1=f.ok("recovery.worker.output",{**old_output,"operation_id":m.uid(95),"output_digest":"sha256:"+"5"*64,"worker_reported_at":stamp(7200)})
 m.check("recovery.worker.delayed-old-after-new-archived",lambda:m.expect(all(x["disposition"]=="ARCHIVE_PROVENANCE_ONLY" and x["reason"]=="STALE_GENERATION" for x in (late1,late2)) and rejected_code(f,"recovery.worker.renew",{"scope":S(),"attempt_id":new["id"],"attempt_generation":"2","sandbox_boot_generation":"1","session_id":session2,"lease_ms":30000,"worker_observed_at":stamp()})=="RECOVERY_STALE_GENERATION"))
 m.check("recovery.worker.single-publication",lambda:m.expect(rejected_code(f,"recovery.worker.output",{"scope":S(),"operation_id":m.uid(96),"attempt_id":newest["id"],"attempt_generation":"3","sandbox_boot_generation":"1","session_id":session3,"kind":"COMPLETION","output_digest":"sha256:"+"6"*64,"worker_reported_at":stamp()})=="RECOVERY_ALREADY_PUBLISHED" and m.sql("SELECT string_agg(o->>'attempt_generation',',') FROM hyperfide.recovery_replacement_requests r,jsonb_array_elements(r.outputs) o WHERE o->>'disposition'='AUTHORITATIVE_COMPLETION';")=="3"))
 m.check("recovery.worker.reordered-replay-stable",lambda:m.expect(f.ok("recovery.worker.output",old_output)["disposition"]=="ARCHIVE_PROVENANCE_ONLY" and f.ok("recovery.worker.output",old_output)["replayed"] is True and m.sql("SELECT count(*) FROM hyperfide.recovery_replacement_requests r,jsonb_array_elements(r.outputs) o;")=="6"))
 m.check("recovery.worker.replay-tamper-refused",lambda:f.rejected("recovery.worker.output",{**old_output,"output_digest":"sha256:"+"3"*64},"RECOVERY_IDEMPOTENCY_CONFLICT"))
 # V-049 malicious/unknown inputs and post-recovery residue.
 m.check("recovery.worker.unknown-attempt-refused",lambda:f.rejected("recovery.worker.output",{**old_output,"operation_id":m.uid(97),"attempt_id":m.uid(199)},"RECOVERY_ATTEMPT_UNKNOWN"))
 m.check("recovery.worker.outside-lineage-refused",lambda:f.rejected("recovery.worker.renew",{"scope":S(),"attempt_id":m.uid(28),"attempt_generation":"1","sandbox_boot_generation":"1","session_id":m.uid(22),"lease_ms":30000,"worker_observed_at":stamp()},"RECOVERY_REQUEST_NOT_FOUND"))
 m.check("recovery.worker.restore-stale-epoch",lambda:f.rejected("recovery.worker.restore",{**restore,"scope":{**S(),"authority_epoch":m.uid(98)}},"RECOVERY_STALE_EPOCH"))
 def immutable(statement,message):
  try:m.sql(statement)
  except AssertionError as error:
   m.expect(message in str(error),str(error));return
  raise AssertionError("Recovery provenance changed")
 m.check("recovery.worker.replacement-binding-immutable",lambda:immutable("UPDATE hyperfide.recovery_replacement_requests SET replacement_attempt_id='"+m.ATTEMPT+"',replacement_attempt_generation=2,state_version=state_version+1 WHERE id='"+m.uid(50)+"';","Recovery replacement binding is immutable"))
 m.check("recovery.worker.output-provenance-append-only",lambda:immutable("UPDATE hyperfide.recovery_replacement_requests SET outputs='[]',state_version=state_version+1 WHERE id='"+m.uid(50)+"';","Recovery output provenance is append-only"))
 def residue():
  snapshot=f.ok("recovery.worker.inventory",S())
  m.expect(len(snapshot["worker_restoration_requests"])==0,"hidden restoration backlog")
  m.expect(m.sql("SELECT count(*) FROM hyperfide.recovery_replacement_requests WHERE state<>'READY';")=="0")
  m.expect(m.sql("SELECT count(*) FROM hyperfide.attempts WHERE task_id='"+m.uid(7)+"' AND compute_authority='CURRENT';")=="1")
  m.expect(m.sql("SELECT count(*) FROM hyperfide.recovery_resource_debts WHERE status<>'RESOLVED';")==str(len(snapshot["unreachable_resource_debt"])),"unresolved debts must remain visible")
 m.check("recovery.worker.no-hidden-backlog",residue)
 lineage=m.sql("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state,'source_attempt_id',source_attempt_id,'source_attempt_generation',source_attempt_generation,'replacement_attempt_id',replacement_attempt_id,'replacement_attempt_generation',replacement_attempt_generation,'checkpoint_id',checkpoint_id,'outputs',outputs) ORDER BY created_at),'[]') FROM hyperfide.recovery_replacement_requests;")
 m.observation_dir().joinpath("worker-observations.json").write_text(json.dumps({"task":"24.2","assertions":m.IDS,"failed":m.FAILED,"restoration_lineage":json.loads(lineage)},indent=1)+chr(10))
if __name__=="__main__":sys.exit(m.run("24.2",tests))
