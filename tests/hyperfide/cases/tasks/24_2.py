#!/usr/bin/env python3
from pathlib import Path
import importlib.util,sys
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
 m.check("recovery.worker.stale-outputs-nonauthoritative",lambda:m.expect(result["stale_outputs"]=="ARCHIVE_PROVENANCE_ONLY"))
 m.check("recovery.worker.restart-snapshot",lambda:m.expect(f.ok("recovery.worker.inventory",m.SCOPE)["attempts"][0]["compute_token_current"] is False))
 def immutable_source():
  try:m.sql("UPDATE hyperfide.recovery_replacement_requests SET source_attempt_generation=2,state_version=state_version+1 WHERE id='"+m.uid(50)+"';")
  except AssertionError as error:
   m.expect("Recovery loss provenance is immutable" in str(error));return
  raise AssertionError("Historical recovery source changed")
 m.check("recovery.worker.restoration-source-immutable",immutable_source)
 m.check("recovery.worker.restoration-snapshot",lambda:m.expect(len(f.ok("recovery.worker.inventory",m.SCOPE)["worker_restoration_requests"])==1))
if __name__=="__main__":sys.exit(m.run("24.2",tests))
