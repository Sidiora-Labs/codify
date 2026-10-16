#!/usr/bin/env python3
"""Scoped immutable review inputs and real delegated watcher lease assertions.

Supporting evidence is an explicitly seeded PostgreSQL metadata fixture with
known local bytes. This component probe does not claim frontier semantic review
or external artifact-store qualification.
"""
from pathlib import Path
import importlib.util,json,sys,tempfile
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("review_fixture",ROOT/"tests/hyperfide/cases/tasks/17_1.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
IDS=["review.inputs.exact-obligation-generation","review.inputs.replay-stable","review.inputs.empty-graph-not-proof",
"review.inputs.history-immutable","review.receipt.operator-cannot-review","review.receipt.caller-reviewer-refused",
"review.lease.real-delegated-watcher","review.lease.wrong-job-refused","review.lease.same-watcher-concurrency-refused",
"review.receipt.expired-lease-refused","review.lease.reclaim-fences-old-generation","review.receipt.old-lease-refused",
"review.receipt.actual-admitted-support","review.receipt.immutable-history","review.receipt.exact-replay",
"review.coverage.limitations-prevent-completion","review.inputs.changed-policy-stales","review.inputs.reconcile-preserves-history",
"review.observation.origin-attempt-refused","review.observation.exact-source-attribution","review.observation.history-immutable"]
def seed_inputs(f):
 d=f.identity;profile=m.xid(0x701);build=m.xid(0x702);graph=m.xid(0x703);artifact=m.xid(0x704);attempt=m.xid(0x705);evidence=m.xid(0x706)
 body=b"Bounded support fixture: API units are cents; no semantic proof claimed.\n"
 (d.path/"support-evidence.txt").write_bytes(body)
 digest="sha256:"+__import__("hashlib").sha256(body).hexdigest()
 d.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,id,content_digest,provider,runtime_platform,manifest) VALUES($1,$2,$3,'fixture','linux', $4)",[m.ORG,profile,m.DIGEST,{"schema_version":1,"tools":{"node":"fixture"}}])
 d.sql("INSERT INTO hyperfide.graph_builds(organisation_id,run_id,id,input_digest,source_manifest_digest,parser_digest,schema_digest,config_digest,state) VALUES($1,$2,$3,$4,$4,$4,$4,$4,'PUBLISHED')",[m.ORG,m.RUN,build,m.DIGEST])
 d.sql("INSERT INTO hyperfide.graph_manifests(organisation_id,run_id,id,build_id,manifest_digest,source_manifest_digest,file_count,symbol_count,reference_count,edge_count) VALUES($1,$2,$3,$4,$5,$5,0,0,0,0)",[m.ORG,m.RUN,graph,build,m.DIGEST])
 d.sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,retention_class) VALUES($1,$2,$3,$4,$5,'fixture',$6,'COMPLETE','RUN')",[m.ORG,m.RUN,artifact,digest,str(len(body)),str(d.path/"support-evidence.txt")])
 d.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest) VALUES($1,$2,$3,$4,1,$5,$6)",[m.ORG,m.RUN,attempt,m.xid(0x301),d.ids["epoch"],m.DIGEST])
 d.sql("INSERT INTO hyperfide.evidence(organisation_id,run_id,id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest,manifest_digest,artifact_id,admission_state) VALUES($1,$2,$3,$4,1,$5,$6,$7,$7,$8,'ADMITTED')",[m.ORG,m.RUN,evidence,attempt,m.REPOSITORY,f.first,m.DIGEST,artifact])
 return {"snapshot":{"source_set":[{"repository_id":m.REPOSITORY,"source_object_id":f.first}],"graph_manifest_id":graph,"contract_ids":[],"environment_profile_id":profile},"evidence_id":evidence,"attempt_id":attempt}
def main():
 with tempfile.TemporaryDirectory(prefix="hf-review-receipts-") as folder:
  f=m.Fixture("17.3",Path(folder),["17.3"])
  try:
   f.configure();f.discover();seed=seed_inputs(f)
   binding=dict(m.SCOPE,repository_id=m.REPOSITORY,source_object_id=f.first,policy_digest=f.policy_digest,candidate_digest=m.DIGEST,snapshot=seed["snapshot"])
   bound=f.ok("review.inputs.bind",binding,component="17.3");obligation=f.identity.sql("SELECT id AS obligation_id,generation::text AS generation FROM hyperfide.review_obligations WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 AND source_object_id=$4 AND watcher_id=\'watcher-0\'",[m.ORG,m.RUN,m.REPOSITORY,f.first])[0]
   m.check(IDS[0],lambda:m.expect(len(bound["obligations"])==10 and all(row["generation"]=="1" for row in bound["obligations"]),"input generation denominator wrong"))
   again=f.ok("review.inputs.bind",binding,component="17.3")
   m.check(IDS[1],lambda:m.expect(again["input_manifest_digest"]==bound["input_manifest_digest"] and all(row["replayed"] for row in again["obligations"]),"same inputs changed generation"))
   m.check(IDS[2],lambda:m.expect(bound["snapshot"]["graph_complete"] is False,"empty graph invented source coverage"))
   def immutable_inputs():
    result=m.sql("17.3","UPDATE hyperfide.review_obligation_inputs SET snapshot='{}';",allow_error=True)
    m.expect(result.returncode!=0 and "23514" in result.stderr,"immutable admitted input history was writable")
   m.check(IDS[3],immutable_inputs)
   request=dict(m.SCOPE,request_id=m.xid(0x800),obligation_id=obligation["obligation_id"],generation=obligation["generation"],lease_generation="1",input_manifest_digest=bound["input_manifest_digest"],candidate_digest=m.DIGEST,rubric_digest=m.DIGEST,outcome="NO_FINDINGS",limitations=[],evidence_ids=[seed["evidence_id"]],observations=[])
   m.check(IDS[4],lambda:f.reject("review.receipt.submit",request,"REVIEW_ROLE_DENIED",component="17.3"))
   m.check(IDS[5],lambda:f.reject("review.receipt.submit",dict(request,reviewer_session_id=m.xid(0x200)),"REVIEW_INPUT_INVALID",component="17.3"))
   f.identity.bootstrap_runner()
   f.identity.delegate_principal("watcher0",m.xid(0x200))
   f.identity.delegate_principal("watcher1",m.xid(0x201))
   claim=dict(m.SCOPE,obligation_id=obligation["obligation_id"],generation=obligation["generation"],lease_seconds=120)
   claimed={}
   m.check(IDS[6],lambda:claimed.update(f.ok("review.obligation.claim",claim,component="17.3",key="watcher0")))
   m.check(IDS[7],lambda:f.reject("review.obligation.claim",claim,"REVIEW_JOB_DENIED",component="17.3",key="watcher1"))
   m.check(IDS[8],lambda:f.reject("review.obligation.claim",claim,"REVIEW_LEASE_CONFLICT",component="17.3",key="watcher0"))
   request["lease_generation"]=claimed["lease_generation"]
   f.identity.sql("UPDATE hyperfide.review_obligations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[m.ORG,m.RUN,obligation["obligation_id"]])
   m.check(IDS[9],lambda:f.reject("review.receipt.submit",request,"REVIEW_LEASE_STALE",component="17.3",key="watcher0"))
   reclaimed=f.ok("review.obligation.claim",claim,component="17.3",key="watcher0")
   m.check(IDS[10],lambda:m.expect(int(reclaimed["lease_generation"])>int(claimed["lease_generation"]),"expired owner generation reused"))
   m.check(IDS[11],lambda:f.reject("review.receipt.submit",request,"REVIEW_LEASE_STALE",component="17.3",key="watcher0"))
   request["lease_generation"]=reclaimed["lease_generation"];receipt={}
   m.check(IDS[12],lambda:receipt.update(f.ok("review.receipt.submit",request,component="17.3",key="watcher0")))
   def immutable_receipt():
    result=m.sql("17.3","UPDATE hyperfide.review_receipts SET outcome='FINDINGS';",allow_error=True)
    m.expect(result.returncode!=0 and "23514" in result.stderr,"immutable review receipt was rewritten")
   m.check(IDS[13],immutable_receipt)
   m.check(IDS[14],lambda:m.expect(f.ok("review.receipt.submit",request,component="17.3",key="watcher0")["receipt_id"]==receipt["receipt_id"],"receipt replay duplicated evidence"))
   coverage=f.coverage(f.first,candidate_digest=m.DIGEST,input_manifest_digest=bound["input_manifest_digest"])
   m.check(IDS[15],lambda:m.expect(coverage["status"]=="INCOMPLETE" and coverage["complete"]==0,"limited review became complete frontier proof"))
   other=f.identity.sql("SELECT id AS obligation_id,generation::text AS generation FROM hyperfide.review_obligations WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 AND source_object_id=$4 AND watcher_id='watcher-1'",[m.ORG,m.RUN,m.REPOSITORY,f.first])[0]
   other_lease=f.ok("review.obligation.claim",dict(m.SCOPE,obligation_id=other["obligation_id"],generation=other["generation"],lease_seconds=120),component="17.3",key="watcher1")
   observation={"evidence_id":seed["evidence_id"],"origin_task_id":m.xid(0x301),"origin_attempt_id":m.xid(0xdead),"contract_id":None,"failure_fingerprint":m.DIGEST,"summary":"Fixture-observed unit mismatch, with explicit unknown graph limitation.","severity":"ERROR"}
   finding_request=dict(request,request_id=m.xid(0x801),obligation_id=other["obligation_id"],generation=other["generation"],lease_generation=other_lease["lease_generation"],outcome="FINDINGS",observations=[observation])
   m.check(IDS[18],lambda:f.reject("review.receipt.submit",finding_request,"REVIEW_OBSERVATION_INVALID",component="17.3",key="watcher1"))
   observation["origin_attempt_id"]=seed["attempt_id"]
   finding=f.ok("review.receipt.submit",finding_request,component="17.3",key="watcher1")
   def exact_observation():
    row=f.identity.sql("SELECT observer_session_id,origin_task_id,origin_attempt_id,repository_id,source_object_id FROM hyperfide.review_observations WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[m.ORG,m.RUN,finding["observation_ids"][0]])[0]
    m.expect(row=={"observer_session_id":m.xid(0x201),"origin_task_id":m.xid(0x301),"origin_attempt_id":seed["attempt_id"],"repository_id":m.REPOSITORY,"source_object_id":f.first},"immutable observation lost actual reviewer/source/attempt attribution")
   m.check(IDS[19],exact_observation)
   def immutable_observation():
    result=m.sql("17.3","UPDATE hyperfide.review_observations SET summary='rewritten';",allow_error=True)
    m.expect(result.returncode!=0 and "23514" in result.stderr,"immutable observation was overwritten")
   m.check(IDS[20],immutable_observation)
   f.identity.sql("UPDATE hyperfide.runs SET policy_digest=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[m.ORG,m.RUN,"sha256:"+"b"*64])
   m.check(IDS[16],lambda:m.expect(f.coverage(f.first,candidate_digest=m.DIGEST,input_manifest_digest=bound["input_manifest_digest"])["status"]=="STALE","changed policy retained current review"))
   reconciled=f.ok("review.inputs.reconcile",m.SCOPE,component="17.3")
   m.check(IDS[17],lambda:m.expect(len(reconciled["invalidated_obligation_ids"])==10 and f.identity.sql("SELECT count(*)::text AS count FROM hyperfide.review_receipts")[0]["count"]=="2","invalidation erased immutable receipt history"))
  finally:f.identity.close();f.save(m.FAILED)
 return int(bool(m.FAILED))
if __name__=="__main__":raise SystemExit(m.cleanup("17.3") if "--cleanup" in sys.argv else main())
