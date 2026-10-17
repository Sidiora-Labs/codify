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
"review.observation.origin-attempt-refused","review.observation.exact-source-attribution","review.observation.history-immutable","review.inputs.partial-task-revision-stales","review.inputs.rebind-fences-old-generation"]
IDS+=["review.execution.package-stop-denies-claim","review.execution.sandbox-stop-denies-output","review.execution.old-sandbox-stop-preserves-current-review","review.lease.owner-renewal","review.lease.wrong-owner-renewal-refused","review.semantic-fence.current-authenticated-read","review.graph-custody.quarantine-and-scope-fenced"]
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

def lock_order_probe(f):
 """Real signed reader waits on the actual14/17 run-row fence and sees committed generation."""
 import subprocess,threading,time
 js=r"""const {createRequire}=require('module'),pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg');
 const readline=require('readline');
 (async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:1500,lock_timeout:1000});await c.connect();
 try{await c.query('BEGIN');const held=await c.query('UPDATE hyperfide.runs SET semantic_generation=semantic_generation+1 WHERE organisation_id=$1 AND id=$2 RETURNING semantic_generation::text AS generation',[process.argv[1],process.argv[2]]);process.stdout.write('LOCKED:'+held.rows[0].generation+'\n');
 const lines=readline.createInterface({input:process.stdin});await new Promise(resolve=>lines.once('line',resolve));
 await c.query('UPDATE hyperfide.runs SET state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',[process.argv[1],process.argv[2]]);
 await c.query('COMMIT');process.stdout.write('UPDATED\n');lines.close();}finally{await c.end();}})().catch(e=>{process.stderr.write(JSON.stringify({code:e.code??'ERROR'}));process.exitCode=1;});"""
 child=subprocess.Popen(["node","-e",js,m.ORG,m.RUN],cwd=ROOT,env=f.identity.env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 result={};errors=[];observed=[];expected_generation=None
 def invoke():
  try:result.update(f.coverage(f.first))
  except Exception as error:errors.append(error)
 thread=None
 try:
  marker=child.stdout.readline().strip();m.expect(marker.startswith("LOCKED:"),"primary control transaction did not acquire semantic generation row");expected_generation=marker.split(":",1)[1]
  thread=threading.Thread(target=invoke);thread.start()
  waiting=False
  for _ in range(50):
   rows=f.identity.sql("SELECT pid,wait_event,query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");observed=rows or observed
   rows=[row for row in rows if 'semantic_generation' in row['query'] or 'FROM hyperfide.identity_principals p JOIN hyperfide.runs r' in row['query']]
   if rows:waiting=True;break
   time.sleep(.05)
  m.expect(waiting,"actual signed request never reached its run-row lock: "+json.dumps({"waits":observed,"errors":[str(error) for error in errors],"result":result},sort_keys=True))
  child.stdin.write("CONTINUE\n");child.stdin.flush()
  output=child.communicate(timeout=5)
  m.expect(child.returncode==0 and "UPDATED" in output[0],"primary generation writer did not commit: "+output[1])
  thread.join(timeout=8)
  m.expect(not thread.is_alive() and not errors and result.get("status")=="INCOMPLETE" and result.get("authority_generation")==expected_generation,"actual authenticated review retained a stale semantic generation after primary commit")
 finally:
  if child.poll() is None:child.kill();child.communicate()
  if thread:thread.join(timeout=10)
  (m.evidence_dir(f.task)/"semantic-fence-signed-boundary.json").write_text(json.dumps({"scope":"SIGNED_BOUNDARY_FRESHNESS","claim":"Observed actual14/17 run-row lock, writer commit, then current response generation; not an isolated helper retry claim","waits":observed,"expected_generation":expected_generation,"response_generation":result.get("authority_generation"),"response_status":result.get("status"),"errors":[str(error) for error in errors]},sort_keys=True)+"\n")


def graph_custody_probe(f,seed):
 import hashlib,subprocess
 d=f.identity;artifact=m.xid(0xe01);raw="{}";digest="sha256:"+hashlib.sha256(raw.encode()).hexdigest()
 graph=m.xid(0xe02);build=m.xid(0xe03);graph_digest="sha256:"+hashlib.sha256(b"graph-custody-fixture").hexdigest()
 d.sql("INSERT INTO hyperfide.graph_builds(organisation_id,run_id,id,input_digest,source_manifest_digest,parser_digest,schema_digest,config_digest,state) VALUES($1,$2,$3,$4,$4,$4,$4,$4,'STAGING')",[m.ORG,m.RUN,build,graph_digest])
 d.sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,retention_class) VALUES($1,$2,$3,$4,2,'fixture','graph-custody','COMPLETE','RUN')",[m.ORG,m.RUN,artifact,digest])
 d.sql("INSERT INTO hyperfide.graph_bundle_inputs(organisation_id,run_id,graph_id,bundle_digest,identity,manifest,manifest_text,artifact_id) VALUES($1,$2,$3,$4,'{}','{}',$5,$6)",[m.ORG,m.RUN,build,digest,raw,artifact])
 d.sql("UPDATE hyperfide.graph_builds SET state='PUBLISHED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[m.ORG,m.RUN,build])
 d.sql("INSERT INTO hyperfide.graph_manifests(organisation_id,run_id,id,build_id,manifest_digest,source_manifest_digest,file_count,symbol_count,reference_count,edge_count) VALUES($1,$2,$3,$4,$5,$5,0,0,0,0)",[m.ORG,m.RUN,graph,build,graph_digest])
 # This is a storage freshness unit using actual PG metadata, not a graph
 # publication or authentication proof. Signed component assertions are separate.
 js="""import{createRequire}from'node:module';import{reviewGraphCustodyCurrent}from'./services/hyperfide/dist/review/coverage.js';
 const pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg'),c=new pg.Client({connectionString:process.env.DATABASE_URL});
 await c.connect();try{await c.query('BEGIN');const value=await reviewGraphCustodyCurrent(c,{organisation_id:process.argv[1],run_id:process.argv[2]},process.argv[3]);await c.query('COMMIT');process.stdout.write(JSON.stringify(value));}finally{await c.end();}"""
 def inspect(run):
  return json.loads(subprocess.check_output(["node","--input-type=module","-e",js,m.ORG,run,graph],cwd=ROOT,env=d.env))
 m.expect(inspect(m.RUN) is True,"actual complete graph artifact custody was not current")
 d.sql("UPDATE hyperfide.artifacts SET status='QUARANTINED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[m.ORG,m.RUN,artifact])
 m.expect(inspect(m.RUN) is False,"quarantined graph artifact remained current")
 m.expect(inspect(m.xid(0xdead)) is False,"another run borrowed graph artifact custody")

def main():
 with tempfile.TemporaryDirectory(prefix="hf-review-receipts-") as folder:
  f=m.Fixture("17.3",Path(folder),["17.3"])
  try:
   f.configure();f.discover()
   accepted=m.xid(0x900)
   f.identity.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version) VALUES($1,$2,$3,$4,'fixture-amended','{}',1)",[m.ORG,f.identity.ids["project"],accepted,"sha256:"+__import__("hashlib").sha256(b"fixture-amended").hexdigest()])
   f.identity.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)",[m.ORG,m.RUN,accepted])
   f.identity.sql("UPDATE hyperfide.runs SET spec_revision_id=$3,spec_generation=2,state=\'PENDING_VALIDATION\',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[m.ORG,m.RUN,accepted])
   f.identity.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[m.ORG,m.RUN])
   m.check(IDS[28],lambda:lock_order_probe(f))
   seed=seed_inputs(f)
   m.check(IDS[29],lambda:graph_custody_probe(f,seed))
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
   oldbox=m.xid(0xd00);oldslot=m.xid(0xd01);oldattempt=m.xid(0xd02);oldhold=m.xid(0xd03)
   f.identity.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state) VALUES($1,$2,$3,'fixture-old-review-host','RUNNING')",[m.ORG,oldbox,f.identity.ids["pool"]])
   f.identity.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES($1,$2,$3,'historical-agent',1,'AGENT')",[m.ORG,oldslot,oldbox])
   f.identity.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,sandbox_id,slot_id,sandbox_boot_generation) VALUES($1,$2,$3,$4,2,$5,$6,$7,$8,1)",[m.ORG,m.RUN,oldattempt,m.xid(0x301),f.identity.ids["epoch"],m.DIGEST,oldbox,oldslot])
   f.identity.sql("INSERT INTO hyperfide.execution_controls(organisation_id,run_id,id,scope_kind,scope_id,sandbox_id,mode) VALUES($1,$2,$3,'SANDBOX',$4,$4,'STOP')",[m.ORG,m.RUN,oldhold,oldbox])
   claimed={}
   m.check(IDS[6],lambda:claimed.update(f.ok("review.obligation.claim",claim,component="17.3",key="watcher0")))
   m.check(IDS[25],lambda:m.expect(bool(claimed.get("lease_generation")) and f.identity.sql("SELECT lease_sandbox_id FROM hyperfide.review_obligations WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[m.ORG,m.RUN,obligation["obligation_id"]])[0]["lease_sandbox_id"]==f.identity.ids["sandbox"],"historical sandbox hold cancelled current independent review"))
   renewal=dict(claim,lease_generation=claimed["lease_generation"])
   renewed={}
   m.check(IDS[26],lambda:renewed.update(f.ok("review.obligation.renew",renewal,component="17.3",key="watcher0")))
   m.check(IDS[27],lambda:f.reject("review.obligation.renew",renewal,"REVIEW_LEASE_STALE",component="17.3",key="watcher1"))
   m.expect(renewed.get("lease_generation")==claimed["lease_generation"],"renewal replaced the current ownership generation")
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
   package_hold=m.xid(0xc01)
   f.identity.sql("INSERT INTO hyperfide.execution_controls(organisation_id,run_id,id,scope_kind,scope_id,package_id,mode) VALUES($1,$2,$3,'PACKAGE',$4,$4,'STOP')",[m.ORG,m.RUN,package_hold,m.xid(0x300)])
   m.check(IDS[23],lambda:f.reject("review.obligation.claim",dict(m.SCOPE,obligation_id=other["obligation_id"],generation=other["generation"],lease_seconds=120),"EXECUTION_HELD",component="17.3",key="watcher1"))
   f.identity.sql("UPDATE hyperfide.execution_controls SET mode='ACTIVE',generation=generation+1,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[m.ORG,m.RUN,package_hold])
   other_lease=f.ok("review.obligation.claim",dict(m.SCOPE,obligation_id=other["obligation_id"],generation=other["generation"],lease_seconds=120),component="17.3",key="watcher1")
   observation={"evidence_id":seed["evidence_id"],"origin_task_id":m.xid(0x301),"origin_attempt_id":m.xid(0xdead),"contract_id":None,"failure_fingerprint":m.DIGEST,"summary":"Fixture-observed unit mismatch, with explicit unknown graph limitation.","severity":"ERROR"}
   finding_request=dict(request,request_id=m.xid(0x801),obligation_id=other["obligation_id"],generation=other["generation"],lease_generation=other_lease["lease_generation"],outcome="FINDINGS",observations=[observation])
   m.check(IDS[18],lambda:f.reject("review.receipt.submit",finding_request,"REVIEW_OBSERVATION_INVALID",component="17.3",key="watcher1"))
   observation["origin_attempt_id"]=seed["attempt_id"]
   sandbox_hold=m.xid(0xc02)
   f.identity.sql("INSERT INTO hyperfide.execution_controls(organisation_id,run_id,id,scope_kind,scope_id,sandbox_id,mode) VALUES($1,$2,$3,'SANDBOX',$4,$4,'STOP')",[m.ORG,m.RUN,sandbox_hold,f.identity.ids["sandbox"]])
   m.check(IDS[24],lambda:f.reject("review.receipt.submit",finding_request,"EXECUTION_HELD",component="17.3",key="watcher1"))
   f.identity.sql("UPDATE hyperfide.execution_controls SET mode='ACTIVE',generation=generation+1,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[m.ORG,m.RUN,sandbox_hold])
   finding=f.ok("review.receipt.submit",finding_request,component="17.3",key="watcher1")
   def exact_observation():
    row=f.identity.sql("SELECT observer_session_id,origin_task_id,origin_attempt_id,repository_id,source_object_id FROM hyperfide.review_observations WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[m.ORG,m.RUN,finding["observation_ids"][0]])[0]
    m.expect(row=={"observer_session_id":m.xid(0x201),"origin_task_id":m.xid(0x301),"origin_attempt_id":seed["attempt_id"],"repository_id":m.REPOSITORY,"source_object_id":f.first},"immutable observation lost actual reviewer/source/attempt attribution")
   m.check(IDS[19],exact_observation)
   def immutable_observation():
    result=m.sql("17.3","UPDATE hyperfide.review_observations SET summary='rewritten';",allow_error=True)
    m.expect(result.returncode!=0 and "23514" in result.stderr,"immutable observation was overwritten")
   m.check(IDS[20],immutable_observation)
   f.identity.sql("UPDATE hyperfide.runs SET state='PENDING_VALIDATION',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[m.ORG,m.RUN])
   f.identity.sql("UPDATE hyperfide.tasks SET spec_revision_id=$3,spec_generation=2,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$4",[m.ORG,m.RUN,accepted,m.xid(0x301)])
   f.identity.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[m.ORG,m.RUN])
   m.check(IDS[21],lambda:m.expect(f.coverage(f.first,candidate_digest=m.DIGEST,input_manifest_digest=bound["input_manifest_digest"])["status"]=="STALE","partial task amendment retained review under unchanged global revision"))
   refreshed=f.ok("review.inputs.bind",binding,component="17.3")
   m.check(IDS[22],lambda:m.expect(all(row["generation"]=="2" for row in refreshed["obligations"]) and refreshed["input_manifest_digest"]!=bound["input_manifest_digest"],"changed task context did not fence old generation"))
   bound=refreshed
   f.identity.sql("UPDATE hyperfide.runs SET policy_digest=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[m.ORG,m.RUN,"sha256:"+"b"*64])
   m.check(IDS[16],lambda:m.expect(f.coverage(f.first,candidate_digest=m.DIGEST,input_manifest_digest=bound["input_manifest_digest"])["status"]=="STALE","changed policy retained current review"))
   reconciled=f.ok("review.inputs.reconcile",m.SCOPE,component="17.3")
   m.check(IDS[17],lambda:m.expect(len(reconciled["invalidated_obligation_ids"])==10 and f.identity.sql("SELECT count(*)::text AS count FROM hyperfide.review_receipts")[0]["count"]=="2","invalidation erased immutable receipt history"))
  finally:f.identity.close();f.save(m.FAILED)
 return int(bool(m.FAILED))
if __name__=="__main__":raise SystemExit(m.cleanup("17.3") if "--cleanup" in sys.argv else main())
