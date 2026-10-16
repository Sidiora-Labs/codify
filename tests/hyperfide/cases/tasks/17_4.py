#!/usr/bin/env python3
"""Actual Git/PG/Ed25519 review dispatch probe.

The unit/integration observations execute on the assigned remote test VM. They
are not fabricated runner receipts and are never inserted as product evidence.
A live provider execution remains a separate canonical qualification requirement.
"""
from __future__ import annotations
import copy,hashlib,importlib.util,json,os,subprocess,sys,tempfile,uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location("review17_fixture",Path(__file__).with_name("17_1.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ROOT=m.ROOT
CHECK_TIMEOUT=72*60*60*1000
IDS=[
"review.remote.component-producer-pass","review.remote.component-consumer-pass",
"review.remote.integrated-behaviour-fails","review.remote.repaired-behaviour-passes",
"review.reproduction.actual-registry-plan","review.reproduction.result-source-not-baseline",
"review.reproduction.exact-request-replay","review.reproduction.conflicting-retry-refused",
"review.reproduction.caller-command-refused","review.reproduction.unregistered-check-refused",
"review.reproduction.candidate-input-mismatch-refused","review.reproduction.source-custody-missing",
"review.reproduction.immutable-job-inputs","review.reproduction.unrun-never-proof",
"review.reproduction.non-verifier-assignment-refused","review.reproduction.capacity-required",
"review.reproduction.unassigned-execution-refused","review.reproduction.cross-run-refused",
"review.reproduction.no-physical-execution-inferred","review.reproduction.exact-registry-inspector","review.reproduction.current-source-unrun-causal-refused","review.reproduction.current-source-caller-head-refused","review.reproduction.registered-seventy-two-hour-timeout","review.reproduction.inspector-exact-custody-lineage","review.audit.closed-run-reproduction-read-only","review.audit.closed-run-reproduction-write-denied","review.inputs.reader-rejects-raw-client","review.inputs.reader-rejects-forged-invocation","review.audit.closed-run-nonprivileged-read-denied","review.reproduction.independent-allocation-and-slot-generations","review.reproduction.dispatched-slot-pin-immutable",
]
SOURCE='''[meta]
slug = "fixture"
[req.1]
ac_1 = "Preserve producer and consumer monetary units"
[acceptance.1]
req = "1.1"
[task.1.1]
wave = 1
reqs = ["1.1"]
acceptance_ids = ["1"]
requires = []
touches = ["scenario.py"]
'''
def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
SCENARIO='''import json,sys
from pathlib import Path
def producer():return 100
def consumer(value):return CONVERSION
mode=sys.argv[1]
if mode=="producer":ok=producer()==100
elif mode=="consumer":ok=consumer(LOCAL_INPUT)==1
else:ok=consumer(producer())==1
Path("result.json").write_text(json.dumps({"mode":mode,"passed":ok}))
print(json.dumps({"mode":mode,"passed":ok}))
raise SystemExit(0 if ok else 1)
'''
def setup(f,d):
 f.first=f.commit("[spec:fixture/1.1] reproduce incompatible component units")
 (f.repo/"scenario.py").write_text(SCENARIO.replace("CONVERSION","value").replace("LOCAL_INPUT","1"))
 f.git("add","scenario.py");f.git("commit","-m","[spec:fixture/1.1] record failing system fixture");f.first=f.git("rev-parse","HEAD").strip()
 (f.repo/"scenario.py").write_text(SCENARIO.replace("CONVERSION","value/100").replace("LOCAL_INPUT","100"))
 f.git("add","scenario.py");f.git("commit","-m","[spec:fixture/1.1] align monetary units");f.second=f.git("rev-parse","HEAD").strip()
 executable=str(Path(sys.executable).resolve())
 fields={"argv":[executable,"scenario.py","integration"],"executable_digest":sha(Path(executable).read_bytes()),"timeout_ms":CHECK_TIMEOUT,"required_artifacts":["result.json"],"input_keys":["source","dependency","toolchain","configuration","graph","contract"]}
 source=SOURCE.replace("[task.1.1]",'checks = ["units-system"]\n[task.1.1]')+'\n[proof]\nrubric_digest = '+json.dumps(m.DIGEST)+'\n[proof.check.units-system]\n'+"".join(key+" = "+json.dumps(value)+"\n" for key,value in fields.items())
 parsed=json.loads(subprocess.check_output(["node","--input-type=module","-e","import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT))
 accepted=m.xid(0xa00)
 document={"schema_version":1,"revision_digest":sha(b"review17-accepted-envelope"),"source_digest":sha(source.encode()),"repositories":[{"repository_id":m.REPOSITORY,"source_object_id":f.pinned,"integration_ref":"refs/heads/main"}],"allowed_actions":d.actions,"closure_policy":{"required_evidence":["units-system"],"required_review_roles":[],"publication":"AFTER_QUALIFICATION"},"provenance":None,"parsed":parsed,"runtime_wave_offset":0}
 d.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[m.ORG,d.ids["project"],accepted,sha(source.encode()),source,document,document["revision_digest"]])
 d.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)",[m.ORG,m.RUN,accepted])
 d.sql("UPDATE hyperfide.runs SET spec_revision_id=$3,spec_generation=2,state='PENDING_VALIDATION',state_version=2 WHERE organisation_id=$1 AND id=$2",[m.ORG,m.RUN,accepted])
 section=next(s for s in parsed["sections"] if s["name"]=="task.1.1")
 definition={"schema_version":1,"section":section,"feature_key":"fixture","declared_wave":1,"runtime_wave_offset":0,"declared_status":None,"history_only":True}
 f.criteria=sha(canonical({"reqs":["1.1"],"accepted_text":"Preserve producer and consumer monetary units"}))
 d.sql("UPDATE hyperfide.tasks SET spec_revision_id=$3,spec_generation=2,criteria_digest=$4,definition=$5,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$6",[m.ORG,m.RUN,accepted,f.criteria,definition,m.xid(0x301)])
 d.ids["accepted_spec"]=accepted
 d.env.update({"HF_SPEC_ALLOWED_ROOT":str(d.path),"HF_SPEC_ORGANISATION_ID":m.ORG,"HF_SPEC_PROJECT_ID":d.ids["project"],"HF_AUTHORITY_EPOCH":d.ids["epoch"],"HF_PROOF_MAX_CHECK_MS":str(CHECK_TIMEOUT)})
def seed(f):
 d=f.identity;profile=m.xid(0xa01);graph=m.xid(0xa02);build=m.xid(0xa03)
 d.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,id,content_digest,provider,runtime_platform,manifest) VALUES($1,$2,$3,'fixture','linux',$4)",[m.ORG,profile,m.DIGEST,{"schema_version":1,"tools":{"python":sys.version}}])
 d.sql("INSERT INTO hyperfide.graph_builds(organisation_id,run_id,id,input_digest,source_manifest_digest,parser_digest,schema_digest,config_digest,state) VALUES($1,$2,$3,$4,$4,$4,$4,$4,'PUBLISHED')",[m.ORG,m.RUN,build,m.DIGEST])
 d.sql("INSERT INTO hyperfide.graph_manifests(organisation_id,run_id,id,build_id,manifest_digest,source_manifest_digest,file_count,symbol_count,reference_count,edge_count) VALUES($1,$2,$3,$4,$5,$5,0,0,0,0)",[m.ORG,m.RUN,graph,build,m.DIGEST])
 for generation,commit in [(1,f.first),(2,f.second)]:
  attempt=m.xid(0xa10+generation);custody=m.xid(0xa20+generation)
  d.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest) VALUES($1,$2,$3,$4,$5,$6,$7)",[m.ORG,m.RUN,attempt,m.xid(0x301),generation,d.ids["epoch"],m.DIGEST])
  d.sql("INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest,authority) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$10,$11,$12)",[m.ORG,m.RUN,custody,m.xid(0x301),attempt,generation,d.ids["epoch"],m.REPOSITORY,commit,m.DIGEST,f.criteria,"RELEASED" if generation==1 else "ACTIVE"])
 return {"source_set":[{"repository_id":m.REPOSITORY,"source_object_id":f.second}],"graph_manifest_id":graph,"contract_ids":[],"environment_profile_id":profile}
def reader_boundaries(f):
 # Actual PG plus actual gateway branding; deliberately invalid invocation is a
 # refusal test, never a substituted positive authentication context.
 js=r'''import{createRequire}from'node:module';import{TransactionGateway}from'./services/hyperfide/dist/storage/transactions.js';import{readReproductionJobInputs}from'./services/hyperfide/dist/review/reproductions.js';
 const pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg'),pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
 const request={job_id:process.argv[1],lease_generation:'1',reservation_id:process.argv[2],input_manifest_digest:process.argv[3]},out={};
 const refusal=async fn=>{try{await fn();return 'ACCEPTED';}catch(e){return e.code??'UNKNOWN';}};
 const raw=await pool.connect();try{out.raw=await refusal(()=>readReproductionJobInputs(raw,{},request));}finally{raw.release();}
 const gateway=new TransactionGateway({acquirePrimary:async(_deadline,signal)=>{const client=await pool.connect();return{client,signal:signal??new AbortController().signal,release:destroy=>client.release(destroy)}}});
 out.forged=await refusal(()=>gateway.withPrimaryTransaction({},tx=>readReproductionJobInputs(tx,{},request)));
 await pool.end();process.stdout.write(JSON.stringify(out));'''
 observed=json.loads(subprocess.check_output(['node','--input-type=module','-e',js,m.xid(0xa40),m.xid(0xb00),m.DIGEST],cwd=ROOT,env=f.identity.env))
 (m.evidence_dir('17.4')/'input-reader-boundary.json').write_text(json.dumps({'scope':'COMPONENT_SECURITY_BOUNDARY','authenticated_positive':False,'outcomes':observed},sort_keys=True)+'\n')
 return observed

def generation_storage_boundary(f,job):
 # This is an isolated, always-rolled-back SQL guard unit. It does not admit a
 # physical dispatch, runner observation or execution receipt.
 js=r'''import{createRequire}from'node:module';const pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg'),c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();const out={};
 try{await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await c.query("UPDATE hyperfide.review_reproduction_jobs SET allocation_id=$2,allocation_generation=3,runner_session_id=$3,runner_boot_id=$4,runner_slot_generation=7,workspace_path='/fixture/sql-unit' WHERE id=$1",process.argv.slice(1,5));
 const row=(await c.query('SELECT allocation_generation::text,runner_slot_generation::text FROM hyperfide.review_reproduction_jobs WHERE id=$1',[process.argv[1]])).rows[0];out.independent=row?.allocation_generation==='3'&&row?.runner_slot_generation==='7';
 await c.query('SAVEPOINT immutable');try{await c.query('UPDATE hyperfide.review_reproduction_jobs SET runner_slot_generation=8 WHERE id=$1',[process.argv[1]]);out.refusal='ACCEPTED';}catch(e){out.refusal=e.code;}await c.query('ROLLBACK TO SAVEPOINT immutable');
 }finally{await c.query('ROLLBACK');out.rolled_back=(await c.query('SELECT allocation_id IS NULL AND runner_session_id IS NULL AND runner_slot_generation IS NULL AS absent FROM hyperfide.review_reproduction_jobs WHERE id=$1',[process.argv[1]])).rows[0]?.absent===true;await c.end();}
 process.stdout.write(JSON.stringify(out));'''
 result=json.loads(subprocess.check_output(['node','--input-type=module','-e',js,job,m.xid(0xf11),m.xid(0xf12),f.identity.ids['boot']],cwd=ROOT,env=f.identity.env))
 (m.evidence_dir('17.4')/'generation-storage-boundary.json').write_text(json.dumps({'scope':'ROLLED_BACK_STORAGE_GUARD_UNIT','physical_execution':False,'observed':result},sort_keys=True)+'\n')
 return result

def main():
 with tempfile.TemporaryDirectory(prefix="hf-review-repro-") as folder:
  f=m.Fixture("17.4",Path(folder),["17.4"],extra_setup=setup)
  try:
   f.configure();f.discover();snapshot=seed(f)
   executable=str(Path(sys.executable).resolve())
   check={"id":"units-system","argv":[executable,"scenario.py","integration"],"executable_digest":sha(Path(executable).read_bytes()),"timeout_ms":CHECK_TIMEOUT,"required_artifacts":["result.json"],"input_keys":["source","dependency","toolchain","configuration","graph","contract"]}
   policy={"schema_version":1,"criteria_digest":f.criteria,"spec_revision_id":f.identity.ids["accepted_spec"],"spec_generation":"2","repository_id":m.REPOSITORY,"source_object_id":f.pinned,"rubric_digest":m.DIGEST,"checks":[check],"clauses":[{"id":"1.1","mode":"EXECUTABLE","acceptance_ids":["1"],"checks":["units-system"]}],"inputs":{key:sha(key.encode()) for key in ["source","dependency","toolchain","configuration","graph","contract"]},"contract_digests":[]}
   registry=f.ok("spec.proof.register",{"run_id":m.RUN,"task_id":m.xid(0x301),"spec_revision_id":f.identity.ids["accepted_spec"],"spec_generation":"2","state_version":"2","policy":policy},component="spec-obligations")
   bound=f.ok("review.inputs.bind",dict(m.SCOPE,repository_id=m.REPOSITORY,source_object_id=f.second,policy_digest=f.policy_digest,candidate_digest=m.DIGEST,snapshot=snapshot),component="17.3")
   original=copy.deepcopy(snapshot);original["source_set"][0]["source_object_id"]=f.first
   request=dict(m.SCOPE,request_id=m.xid(0xa40),candidate_digest=m.DIGEST,candidate_input_manifest_digest=bound["input_manifest_digest"],template_id="units-system",qualification_scope="SYSTEM",original={"custody_id":m.xid(0xa21),"snapshot":original},repaired={"custody_id":m.xid(0xa22),"snapshot":snapshot})
   outcomes={}
   def remote_fixture(commit,mode):
    with tempfile.TemporaryDirectory(prefix="hf-review-native-scenario-") as directory:
     path=Path(directory);(path/"scenario.py").write_text(f.git("show",commit+":scenario.py"))
     result=subprocess.run([executable,"scenario.py",mode],cwd=path,capture_output=True,timeout=30)
     artifact=(path/"result.json").read_bytes()
     outcomes[commit+":"+mode]={"exit_code":result.returncode,"stdout_digest":sha(result.stdout),"stderr_digest":sha(result.stderr),"artifact_digest":sha(artifact),"execution_plane":"REMOTE_TEST_VM","product_evidence_admitted":False}
     return result
   m.check(IDS[0],lambda:m.expect(remote_fixture(f.first,"producer").returncode==0,"producer component failed"))
   m.check(IDS[1],lambda:m.expect(remote_fixture(f.first,"consumer").returncode==0,"consumer component failed"))
   m.check(IDS[2],lambda:m.expect(remote_fixture(f.first,"integration").returncode==1,"incompatible components falsely passed integration"))
   m.check(IDS[3],lambda:m.expect(remote_fixture(f.second,"integration").returncode==0,"repaired integration still failed"))
   planned={}
   m.check(IDS[4],lambda:planned.update(f.ok("review.reproduction.plan",request,component="17.4")))
   rows=f.identity.sql("SELECT id,snapshot,qualification_scope FROM hyperfide.review_reproduction_jobs ORDER BY snapshot->>'variant'")
   m.check(IDS[22],lambda:m.expect(len(rows)==2 and all(r["snapshot"]["check"]["timeout_ms"]==CHECK_TIMEOUT for r in rows),"actual accepted72hcheck was shortened or refused during plan admission"))
   m.check(IDS[5],lambda:m.expect(len(rows)==2 and all(r["snapshot"]["source_object_id"]!=f.pinned and r["snapshot"]["check"]==check for r in rows),"result revision was confused with accepted baseline"))
   m.check(IDS[6],lambda:m.expect(f.ok("review.reproduction.plan",request,component="17.4")["plan_id"]==planned["plan_id"],"retry created another physical job"))
   m.check(IDS[7],lambda:f.reject("review.reproduction.plan",dict(request,qualification_scope="CONTRACT"),"REPRODUCTION_REQUEST_CONFLICT",component="17.4"))
   m.check(IDS[8],lambda:f.reject("review.reproduction.plan",dict(request,argv=["sh","-c","true"]),"REVIEW_INPUT_INVALID",component="17.4"))
   m.check(IDS[9],lambda:f.reject("review.reproduction.plan",dict(request,request_id=m.xid(0xa41),template_id="caller-check"),"REPRODUCTION_CHECK_MISSING",component="17.4"))
   m.check(IDS[10],lambda:f.reject("review.reproduction.plan",dict(request,request_id=m.xid(0xa42),candidate_input_manifest_digest="sha256:"+"b"*64),"REPRODUCTION_INPUT_MISMATCH",component="17.4"))
   absent=copy.deepcopy(request);absent["request_id"]=m.xid(0xa43);absent["original"]["custody_id"]=m.xid(0xdead)
   m.check(IDS[11],lambda:f.reject("review.reproduction.plan",absent,"REPRODUCTION_CUSTODY_MISSING",component="17.4"))
   def immutable():
    result=m.sql("17.4","UPDATE hyperfide.review_reproduction_jobs SET snapshot='{}';",allow_error=True)
    m.expect(result.returncode!=0 and "23514" in result.stderr,"immutable job input changed")
   m.check(IDS[12],immutable)
   inspection=f.ok("review.reproduction.inspect",dict(m.SCOPE,plan_id=planned["plan_id"]),component="17.4")
   m.check(IDS[13],lambda:m.expect(inspection["status"]=="INCOMPLETE" and inspection["original"]["outcome"]=="UNKNOWN" and not inspection["repaired"]["evidence_ids"],"unrun request became proof"))
   job=planned["jobs"][0]["job_id"]
   assignment=dict(m.SCOPE,job_id=job,worker_session_id=m.xid(0x200),reservation_id=m.xid(0xb00),lease_seconds=120)
   m.check(IDS[14],lambda:f.reject("review.reproduction.assign",assignment,"REPRODUCTION_RESERVATION_INVALID",component="17.4"))
   verifier=m.xid(0xb01);slot=m.xid(0xb02)
   f.identity.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES($1,$2,$3,'independent-verifier',1,'TEST')",[m.ORG,slot,f.identity.ids["sandbox"]])
   f.identity.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation) VALUES($1,$2,$3,'VERIFIER','fixture','fixture','independent-verifier',$4,$5,1)",[m.ORG,m.RUN,verifier,slot,f.identity.ids["sandbox"]])
   f.identity.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[m.ORG,m.RUN])
   f.identity.bootstrap_runner();f.identity.delegate_principal("verifier",verifier)
   m.check(IDS[15],lambda:f.reject("review.reproduction.assign",dict(assignment,worker_session_id=verifier),"JOB_RESERVATION_INVALID",component="17.4"))
   m.check(IDS[16],lambda:f.reject("review.reproduction.execute",dict(m.SCOPE,job_id=job,lease_generation="1"),"REPRODUCTION_LEASE_STALE",component="17.4",key="verifier"))
   m.check(IDS[17],lambda:f.reject("review.reproduction.inspect",dict(m.SCOPE,run_id=m.xid(0xdead),plan_id=planned["plan_id"]),"REVIEW_SCOPE_DENIED",component="17.4"))
   m.check(IDS[18],lambda:m.expect(f.identity.sql("SELECT count(*)::text AS n FROM hyperfide.runner_remote_jobs")[0]["n"]=="0" and f.identity.sql("SELECT count(*)::text AS n FROM hyperfide.review_reproduction_receipts")[0]["n"]=="0","unassigned validation fabricated physical execution"))
   m.check(IDS[19],lambda:m.expect(inspection["original"]["task_id"]==m.xid(0x301) and inspection["original"]["check_definition_digest"]==sha(canonical(check)) and inspection["original"]["registry_digest"]==inspection["repaired"]["registry_digest"] and inspection["original"]["qualification_scope"]=="SYSTEM","inspector lost exact accepted executable/source identity"))
   m.check(IDS[23],lambda:m.expect(inspection["original"]["custody_id"]==m.xid(0xa21) and inspection["original"]["custody_generation"]=="1" and inspection["repaired"]["custody_id"]==m.xid(0xa22) and inspection["repaired"]["custody_generation"]=="2","inspector lost immutable original and repair custody generations"))
   current_request=dict(m.SCOPE,request_id=m.xid(0xf01),causal_plan_id=planned["plan_id"],repair_custody_id=m.xid(0xa22),publication_operation_id=m.xid(0xf02),candidate_digest=m.DIGEST,candidate_input_manifest_digest=bound["input_manifest_digest"],template_id="units-system",qualification_scope="SYSTEM",snapshot=snapshot)
   m.check(IDS[20],lambda:f.reject("review.reproduction.current.plan",current_request,"REPRODUCTION_CAUSAL_PROOF_INCOMPLETE",component="17.4"))
   m.check(IDS[21],lambda:f.reject("review.reproduction.current.plan",dict(current_request,source_object_id=f.second),"REVIEW_INPUT_INVALID",component="17.4"))
   generation_boundary=generation_storage_boundary(f,job)
   m.check(IDS[29],lambda:m.expect(generation_boundary['independent'] and generation_boundary['rolled_back'],'independent scheduler/physical generation storage was conflated or fixture changed durable state'))
   m.check(IDS[30],lambda:m.expect(generation_boundary['refusal']=='23514' and generation_boundary['rolled_back'],'dispatched physical slot pin changed or fixture rollback failed'))
   boundaries=reader_boundaries(f)
   m.check(IDS[26],lambda:m.expect(boundaries['raw']=='TX_CLOSED','raw PG client acquired trusted reproduction reader authority'))
   m.check(IDS[27],lambda:m.expect(boundaries['forged']=='AUTH_REQUIRED','unbranded invocation acquired trusted reproduction reader authority'))
   m.check(IDS[24],lambda:m.closed_audit(f,'review.reproduction.inspect',dict(m.SCOPE,plan_id=planned['plan_id']),'17.4'))
   m.check(IDS[25],lambda:m.closed_audit(f,'review.reproduction.current.plan',current_request,'17.4',write=True))
   m.check(IDS[28],lambda:f.reject('review.reproduction.inspect',dict(m.SCOPE,plan_id=planned['plan_id']),'AUTH_RUN_CLOSED',component='17.4',key='verifier'))
   (m.evidence_dir("17.4")/"remote-fixture-observations.json").write_text(json.dumps(outcomes,indent=2)+"\n")
  finally:f.identity.close();f.save(m.FAILED)
 return int(bool(m.FAILED))
if __name__=="__main__":raise SystemExit(m.cleanup("17.4") if "--cleanup" in sys.argv else main())
