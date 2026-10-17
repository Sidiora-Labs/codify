#!/usr/bin/env python3
"""Actual Git/PG/Ed25519 review dispatch probe.

Component, contract and integrated scenarios are dispatched through the actual
review.reproduction.plan/assign/execute API of the running control service. The
physical boundary (scheduler allocation, runner registration/measurement and
runner.remote.v1) is a controlled double: it forwards each job to an
out-of-process remote executor owned by this harness, which materialises the
exact commit in its own workspace and runs it as an unprivileged uid. Receipts
are labelled CONTROLLED_REMOTE_DOUBLE; a live provider execution remains a
separate canonical qualification requirement.
"""
from __future__ import annotations
import base64,copy,hashlib,importlib.util,json,os,shutil,signal,socketserver,subprocess,sys,tempfile,threading,time,uuid
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
"review.reproduction.no-physical-execution-inferred","review.reproduction.exact-registry-inspector","review.reproduction.current-source-unrun-causal-refused","review.reproduction.current-source-caller-head-refused","review.reproduction.registered-seventy-two-hour-timeout","review.reproduction.inspector-exact-custody-lineage","review.audit.closed-run-reproduction-read-only","review.audit.closed-run-reproduction-write-denied","review.inputs.reader-rejects-raw-client","review.inputs.reader-rejects-forged-invocation","review.audit.closed-run-nonprivileged-read-denied","review.reproduction.independent-allocation-and-slot-generations","review.reproduction.dispatched-slot-pin-immutable","review.reproduction.unassigned-renewal-refused",
"review.reproduction.projection-conflict-uncertain-guidance","review.reproduction.invalid-projection-conflict-refused",
"review.reproduction.integrated-failure-exact-commit-set","review.reproduction.executed-replay-no-redispatch",
"review.placement.remote-test-slot-only","review.placement.no-control-host-execution",
]
RESULTS={}
def check(identity,callback):
 # Same semantics as the17.1 fixture check, buffered so the independent
 # checker observes assertions in exact registration order.
 try:callback();actual="observed"
 except Exception as error:actual=f"{type(error).__name__}: {error}";m.FAILED.append(identity)
 RESULTS[identity]=actual
def emit():
 for identity in IDS:
  if identity in RESULTS:print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":RESULTS[identity]}),flush=True)
CHECKS={"units-system":"integration","units-producer":"producer","units-consumer":"consumer"}
def check_executable():
 # The remote executor runs scenarios as an unprivileged uid, so the registered
 # interpreter must be a system path that uid can execute.
 system=Path("/usr/bin/python3")
 return str(system.resolve()) if system.exists() else str(Path(sys.executable).resolve())
def check_definition(name):
 executable=check_executable()
 return {"id":name,"argv":[executable,"scenario.py",CHECKS[name]],"executable_digest":sha(Path(executable).read_bytes()),"timeout_ms":CHECK_TIMEOUT,"required_artifacts":["result.json"],"input_keys":["source","dependency","toolchain","configuration","graph","contract"]}
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
 source=SOURCE.replace("[task.1.1]",'checks = '+json.dumps(list(CHECKS))+'\n[task.1.1]')+'\n[proof]\nrubric_digest = '+json.dumps(m.DIGEST)+'\n'
 for name in CHECKS:
  fields={key:value for key,value in check_definition(name).items() if key!="id"}
  source+='[proof.check.'+name+']\n'+"".join(key+" = "+json.dumps(value)+"\n" for key,value in fields.items())
 parsed=json.loads(subprocess.check_output(["node","--input-type=module","-e","import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT))
 accepted=m.xid(0xa00)
 document={"schema_version":1,"revision_digest":sha(b"review17-accepted-envelope"),"source_digest":sha(source.encode()),"repositories":[{"repository_id":m.REPOSITORY,"source_object_id":f.pinned,"integration_ref":"refs/heads/main"}],"allowed_actions":d.actions,"closure_policy":{"required_evidence":list(CHECKS),"required_review_roles":[],"publication":"AFTER_QUALIFICATION"},"provenance":None,"parsed":parsed,"runtime_wave_offset":0}
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

DOUBLE_JS=r"""// Test-only controlled double for the physical execution boundary. It wraps the
// actual 5.1/12.1/12.4 components and overrides only fixture-registered
// reservations, runner sessions and REPRODUCTION permits; everything else is
// delegated to the actual capability. Execution happens in the out-of-process
// remote executor, never in this control-service process.
import net from 'node:net';
import {createHash} from 'node:crypto';
import {createComponent as createRunnerComponent,createRemoteComponent} from '../runner/bridge.js';
import {createComponent as createSchedulerComponent} from '../scheduler/claim.js';
import {readReproductionJobInputs} from '../review/reproductions.js';
import {hash} from '../review/coverage.js';
const socket=process.env.HF_REVIEW17_REMOTE_DOUBLE_SOCKET;
function refuse(code,message){throw Object.assign(new Error(message),{code});}
function remote(op,body){
 if(!socket)refuse('FIXTURE_REMOTE_UNAVAILABLE','Remote executor double is not configured');
 return new Promise((resolve,reject)=>{let data='';const s=net.createConnection(socket);s.setEncoding('utf8');
  s.on('data',chunk=>{data+=chunk;});s.on('error',reject);
  s.on('end',()=>{try{const r=JSON.parse(data);if(r.ok)resolve(r.result);else reject(Object.assign(new Error(r.message),{code:'FIXTURE_REMOTE_REFUSED'}));}catch(e){reject(e);}});
  s.end(JSON.stringify({op,...body,control_pid:process.pid})+'\n');});
}
function captured(item){const b=Buffer.from(item.base64,'base64');return {bytes:new Uint8Array(b),complete:true,digest:'sha256:'+createHash('sha256').update(b).digest('hex'),size_bytes:String(b.length)};}
async function registered(db,organisation_id,run_id,session_id){
 const measured=await remote('workspace',{session_id});if(!measured)return null;
 const row=(await db.query("SELECT * FROM hyperfide.runner_registry WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3 AND state='CURRENT'",[organisation_id,run_id,session_id])).rows[0];
 if(!row||row.workspace_path!==measured.workspace_path)refuse('RUNNER_UNAVAILABLE','Remote executor workspace is not the registered runner workspace');
 return {session_id,sandbox_id:row.sandbox_id,slot_id:row.slot_id,boot_generation:String(row.boot_generation),boot_id:row.boot_id,slot_generation:String(row.slot_generation),workspace_path:row.workspace_path,repository_id:row.repository_id,source_digest:row.source_digest,source_object_id:measured.source_object_id,source_tree_id:measured.source_tree_id};
}
export async function createSchedulerDouble(ctx){
 const real=await createSchedulerComponent(ctx),actual=real.capabilities['scheduler.allocations.v1'];
 const fixture=async(db,v)=>{
  const a=await remote('allocation',{reservation_id:v.reservation_id});if(!a)return null;
  const live=(await db.query("SELECT 1 FROM hyperfide.agent_sessions session JOIN hyperfide.worker_slots slot ON slot.organisation_id=session.organisation_id AND slot.id=session.slot_id JOIN hyperfide.sandboxes box ON box.organisation_id=slot.organisation_id AND box.id=slot.sandbox_id AND box.boot_generation=slot.boot_generation WHERE session.organisation_id=$1 AND session.run_id=$2 AND session.id=$3 AND session.role='VERIFIER' AND slot.id=$4 AND slot.capacity_kind='TEST' AND box.id=$5 AND box.observed_state='RUNNING'",[v.organisation_id,v.run_id,a.assignee_session_id,a.slot_id,a.sandbox_id])).rows.length===1;
  const held=(await db.query("SELECT r.expires_at FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.id=$3 AND r.state='ALLOCATED' AND r.expires_at>clock_timestamp() AND a.dimension='TEST' AND a.qualification_state='QUALIFIED' AND a.pool_id=$4 FOR SHARE OF r",[v.organisation_id,v.run_id,v.reservation_id,a.pool_id])).rows[0];
  if(!live||!held)refuse('JOB_ALLOCATION_INVALID','Fixture allocation is not a live allocated remote TEST reservation');
  return {...a,organisation_id:v.organisation_id,run_id:v.run_id,expires_at:new Date(held.expires_at).toISOString()};
 };
 const allocations=Object.freeze({...actual,
  assertJobReservation:async(db,v)=>{const a=await fixture(db,v);if(!a)return actual.assertJobReservation(db,v);if(a.task_id!==v.task_id||v.job_kind!=='TEST')refuse('JOB_RESERVATION_INVALID','Fixture reservation belongs to another task or kind');return {request_id:a.request_id,pool_id:a.pool_id,reservations:[],resource_requirements:{},spec_revision_id:null,spec_generation:null,criteria_digest:null,resource_policy_digest:null};},
  readJobAllocation:async(db,v)=>{const a=await fixture(db,v);if(!a)return actual.readJobAllocation(db,v);return {...a,primary_now:new Date().toISOString()};},
  renewJobAllocation:async(db,v)=>{const a=await fixture(db,v);if(!a)return actual.renewJobAllocation(db,v);if(a.allocation_id!==v.allocation_id||a.generation!==String(v.allocation_generation)||a.assignee_session_id!==v.assignee_session_id)refuse('JOB_ALLOCATION_STALE','Fixture allocation owner changed');const r=(await db.query("UPDATE hyperfide.reservations SET expires_at=clock_timestamp()+$4::integer*interval '1 millisecond',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='ALLOCATED' AND expires_at>clock_timestamp() RETURNING expires_at",[v.organisation_id,v.run_id,v.reservation_id,v.lease_ms])).rows[0];if(!r)refuse('JOB_ALLOCATION_EXPIRED','Fixture reservation cannot be renewed');return {allocation_id:a.allocation_id,generation:a.generation,expires_at:new Date(r.expires_at).toISOString()};}});
 return {...real,capabilities:{...real.capabilities,'scheduler.allocations.v1':allocations}};
}
export async function createRunnerDouble(ctx){
 const real=await createRunnerComponent(ctx),registry=real.capabilities['runner.registry.v1'],environment=real.capabilities['qualification.environment.v1'];
 const lookup=async(db,v)=>{const r=await registered(db,v.organisation_id,v.run_id,v.session_id);return r??registry.lookup(db,v);};
 const verify=async(db,invocation,v)=>{
  if(v.job_namespace!=='REPRODUCTION')return environment.verify(db,invocation,v);
  const expected=await readReproductionJobInputs(db,invocation,{job_id:v.job_id,lease_generation:v.lease_generation,reservation_id:v.reservation_id,input_manifest_digest:v.input_manifest_digest});
  const p=invocation.principal,session=(await db.query("SELECT session_id FROM hyperfide.runner_registry WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND slot_id=$4 AND boot_generation=$5 AND state='CURRENT'",[p.organisation_id,p.run_id,expected.sandbox_id,expected.slot_id,expected.sandbox_boot_generation])).rows[0]?.session_id;
  const runner=session?await registered(db,p.organisation_id,p.run_id,session):null;
  if(!runner||runner.source_object_id!==expected.source_object_id||runner.source_tree_id!==expected.source_tree_id||runner.source_digest!==expected.source_manifest_digest||v.environment_digest!==expected.environment_digest)return {input_validation:{status:'UNAVAILABLE'}};
  const validation={status:'VERIFIED',namespace:'REPRODUCTION',job_id:expected.job_id,lease_generation:expected.lease_generation,input_manifest_digest:expected.input_manifest_digest,input_packet_digest:expected.input_packet_digest,input_manifest:expected.input_manifest,measured_by:'CONTROLLED_REMOTE_DOUBLE'};
  return {input_validation:{...validation,receipt_digest:hash(validation)},runner_session_id:runner.session_id,sandbox_id:runner.sandbox_id,boot_generation:runner.boot_generation,slot_id:runner.slot_id,source_object_id:runner.source_object_id,source_tree_id:runner.source_tree_id,source_manifest_digest:runner.source_digest};
 };
 return {...real,capabilities:{...real.capabilities,'runner.registry.v1':Object.freeze({...registry,lookup}),'qualification.environment.v1':Object.freeze({...environment,verify})}};
}
export async function createRemoteDouble(ctx){
 const real=await createRemoteComponent(ctx),actual=real.capabilities['runner.remote.v1'],permits=new WeakMap();
 const prepare=async(db,invocation,plan)=>{
  if(plan?.job_namespace!=='REPRODUCTION')return actual.prepare(db,invocation,plan);
  const p=invocation.principal,runner=await registered(db,p.organisation_id,p.run_id,plan.session_id);
  if(!runner||plan.job_kind!=='TEST'||runner.repository_id!==plan.repository_id)refuse('REMOTE_JOB_INVALID','Fixture remote job requires a registered TEST runner');
  await remote('prepare',{operation_id:plan.operation_id,session_id:plan.session_id,argv:plan.argv,artifact_paths:plan.artifact_paths,timeout_ms:plan.timeout_ms});
  const permit=Object.freeze({});permits.set(permit,{plan,runner,organisation_id:p.organisation_id,run_id:p.run_id});return permit;
 };
 const execute=async(permit,signal)=>{
  const held=permits.get(permit);if(!held)return actual.execute(permit,signal);permits.delete(permit);
  const {plan,runner}=held,o=await remote('execute',{operation_id:plan.operation_id});
  return {execution_plane:'REMOTE',fixture_kind:'CONTROLLED_REMOTE_DOUBLE',execution_host:o.execution_host,organisation_id:held.organisation_id,run_id:held.run_id,operation_id:plan.operation_id,repository_id:plan.repository_id,
   session_id:runner.session_id,boot_id:runner.boot_id,sandbox_id:runner.sandbox_id,boot_generation:runner.boot_generation,slot_id:runner.slot_id,slot_generation:runner.slot_generation,cwd:o.cwd,
   source_digest:runner.source_digest,source_object_id:o.source_object_id,source_tree_id:o.source_tree_id,source_provenance_digest:plan.source_provenance_digest,policy_digest:plan.policy_digest,executable_digest:o.executable_digest,
   process_ref:o.process_ref,start_identity:o.start_identity,environment_digest:plan.environment_digest,input_validation:plan.input_validation,argv:o.argv,
   output_complete:true,truncated:false,status:'COMPLETED',exit_code:o.exit_code,timed_out:o.timed_out,interrupted:false,cleanup_status:o.cleanup.complete?'CONFIRMED':'UNKNOWN',cleanup:o.cleanup,
   stdout:captured(o.stdout),stderr:captured(o.stderr),artifacts:o.artifacts.map(item=>({path:item.path,...captured(item)}))};
 };
 return {...real,capabilities:{...real.capabilities,'runner.remote.v1':Object.freeze({...actual,prepare,execute})}};
}
"""
DOUBLE_ENTRIES={"5.1":"createSchedulerDouble","12.1":"createRunnerDouble","12.4":"createRemoteDouble"}
def descendants(pid):
 found=[];pending=[pid]
 while pending:
  current=pending.pop()
  try:tasks=os.listdir(f"/proc/{current}/task")
  except OSError:continue
  for task in tasks:
   try:children=Path(f"/proc/{current}/task/{task}/children").read_text().split()
   except OSError:continue
   for child in children:
    child=int(child)
    if child not in found:found.append(child);pending.append(child)
 return found
def cmdline(pid):
 try:return Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0",b" ").decode(errors="replace").strip()
 except OSError:return ""
class RemoteExecutor:
 """Out-of-process remote TEST executor double; never a child of the control service."""
 def __init__(self,repo,uid=65534):
  self.repo=repo;self.uid=uid;self.root=Path(tempfile.mkdtemp(prefix="hf-review17-remote-"));self.root.chmod(0o755)
  self.socket=str(self.root/"executor.sock");self.sessions={};self.allocations={};self.operations={};self.executions=[];self.control_pid=None;self.lock=threading.Lock()
  executor=self
  class Handler(socketserver.StreamRequestHandler):
   def handle(self):
    try:
     request=json.loads(self.rfile.readline());executor.control_pid=request.pop("control_pid",None)
     reply={"ok":True,"result":getattr(executor,"op_"+request.pop("op"))(**request)}
    except Exception as error:reply={"ok":False,"message":type(error).__name__+": "+str(error)[:500]}
    self.wfile.write(json.dumps(reply).encode())
  self.server=socketserver.ThreadingUnixStreamServer(self.socket,Handler);self.server.daemon_threads=True
  threading.Thread(target=self.server.serve_forever,daemon=True).start()
 def git(self,*args,cwd=None):
  return subprocess.run(["git",*args],cwd=cwd,capture_output=True,text=True,timeout=30,check=True).stdout.strip()
 def materialise(self,session_id,commit):
  workspace=self.root/("workspace-"+session_id)
  if workspace.exists():shutil.rmtree(workspace)
  self.git("clone","-q","--no-checkout",str(self.repo),str(workspace));self.git("checkout","-q","--detach",commit,cwd=workspace)
  for path in [workspace,*workspace.rglob("*")]:
   if ".git" not in path.relative_to(workspace).parts:path.chmod(0o777 if path.is_dir() else 0o644)
  measured={"workspace_path":str(workspace),"source_object_id":self.git("rev-parse","HEAD",cwd=workspace),"source_tree_id":self.git("rev-parse","HEAD^{tree}",cwd=workspace)}
  self.sessions[session_id]=measured;return measured
 def op_workspace(self,session_id):return self.sessions.get(session_id)
 def op_allocation(self,reservation_id):return self.allocations.get(reservation_id)
 def op_prepare(self,operation_id,session_id,argv,artifact_paths,timeout_ms):
  if operation_id in self.operations:raise RuntimeError("operation already prepared")
  self.operations[operation_id]={"session_id":session_id,"argv":argv,"artifact_paths":artifact_paths,"timeout_ms":timeout_ms};return {"accepted":True}
 def op_execute(self,operation_id):
  with self.lock:
   operation=self.operations[operation_id]
   if operation.get("executed"):raise RuntimeError("operation already executed; no relaunch")
   operation["executed"]=True
  workspace=Path(self.sessions[operation["session_id"]]["workspace_path"]);argv=operation["argv"]
  for name in operation["artifact_paths"]:(workspace/name).unlink(missing_ok=True)
  stop=threading.Event();control_children=set();control_commands=set()
  def watch():
   while not stop.is_set():
    if self.control_pid:
     for child in descendants(self.control_pid):control_children.add(child);control_commands.add(cmdline(child))
    time.sleep(0.002)
  watcher=threading.Thread(target=watch,daemon=True);watcher.start()
  def demote():os.setgid(self.uid);os.setuid(self.uid)
  process=subprocess.Popen(argv,cwd=workspace,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=demote,env={"PATH":"/usr/bin:/bin","LANG":"C.UTF-8"})
  stat=Path(f"/proc/{process.pid}/stat").read_text();fields=stat[stat.rindex(")")+2:].split()
  parent=int(fields[1]);start_time=fields[19];uid=os.stat(f"/proc/{process.pid}").st_uid
  during=descendants(self.control_pid) if self.control_pid else []
  # Positive control: the same /proc sampler must see the scenario under its real parent.
  sampler_detects_scenario=process.pid in descendants(os.getpid())
  try:stdout,stderr=process.communicate(timeout=min(operation["timeout_ms"]/1000,60));timed_out=False
  except subprocess.TimeoutExpired:process.kill();stdout,stderr=process.communicate();timed_out=True
  try:os.killpg(process.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  time.sleep(0.02);stop.set();watcher.join()
  absent=not Path(f"/proc/{process.pid}").exists()
  executable=str(Path(argv[0]).resolve())
  artifacts=[{"path":name,"base64":base64.b64encode((workspace/name).read_bytes()).decode()} for name in operation["artifact_paths"] if (workspace/name).is_file()]
  observed={"operation_id":operation_id,"argv":argv,"exit_code":process.returncode,"timed_out":timed_out,"cwd":str(workspace),"execution_host":"REMOTE_EXECUTOR_DOUBLE:"+str(os.getpid()),
   "executable_digest":sha(Path(executable).read_bytes()),"process_ref":"remote-double:"+str(process.pid),"source_object_id":self.git("rev-parse","HEAD",cwd=workspace),"source_tree_id":self.git("rev-parse","HEAD^{tree}",cwd=workspace),
   "start_identity":{"pid":process.pid,"pgid":process.pid,"uid":uid,"start_time":start_time,"os_boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip()},
   "cleanup":{"complete":absent,"observed_process_absent":absent},"stdout":{"base64":base64.b64encode(stdout).decode()},"stderr":{"base64":base64.b64encode(stderr).decode()},"artifacts":artifacts}
  self.executions.append({"operation_id":operation_id,"session_id":operation["session_id"],"argv":argv,"exit_code":process.returncode,"scenario_pid":process.pid,"scenario_parent_pid":parent,"scenario_uid":uid,"executor_pid":os.getpid(),
   "control_pid":self.control_pid,"control_descendants_at_spawn":during,"control_descendants_observed":sorted(control_children),"control_descendant_commands":sorted(control_commands),"source_object_id":observed["source_object_id"],"process_absent_after_cleanup":absent,"sampler_detects_scenario":sampler_detects_scenario})
  return observed
 def close(self):
  self.server.shutdown();self.server.server_close();shutil.rmtree(self.root,ignore_errors=True)
def remote_runtime(f,folder,executor,objects):
 """Restart the actual control service from a copied module root carrying the test-only double."""
 identity=f.identity;support=sys.modules[type(identity).__module__]
 runtime=Path(folder)/"runtime";service=runtime/"services/hyperfide";service.mkdir(parents=True)
 shutil.copytree(ROOT/"services/hyperfide/dist",service/"dist");shutil.copytree(ROOT/"services/hyperfide/migrations",service/"migrations")
 shutil.copyfile(ROOT/"services/hyperfide/package.json",service/"package.json");(service/"node_modules").symlink_to(ROOT/"services/hyperfide/node_modules")
 (service/"dist/fixture").mkdir();(service/"dist/fixture/review17_remote_double.js").write_text(DOUBLE_JS)
 identity.stop()
 for component,entry in DOUBLE_ENTRIES.items():
  fragment=json.loads((ROOT/"services/hyperfide/components"/(component+".json")).read_text())
  fragment.update({"module":"fixture/review17_remote_double.js","entry":entry});(identity.components/(component+".json")).write_text(json.dumps(fragment))
 o=sys.modules["review17_objects"]
 identity.env.update({"HF_REVIEW17_REMOTE_DOUBLE_SOCKET":executor.socket,"HF_ARTIFACT_S3_ENDPOINT":objects.endpoint,"HF_ARTIFACT_ALLOW_LOOPBACK_HTTP":"1","HF_ARTIFACT_S3_REGION":o.REGION,"HF_ARTIFACT_S3_BUCKET":o.BUCKET,"HF_ARTIFACT_S3_ACCESS_KEY_ID":o.KEY,"HF_ARTIFACT_S3_SECRET_ACCESS_KEY":o.SECRET,"HF_ARTIFACT_S3_SESSION_TOKEN":o.TOKEN,"HF_ARTIFACT_ORGANISATION_ID":m.ORG,"HF_ARTIFACT_ALLOWED_RUN_IDS":json.dumps([m.RUN])})
 start=type(identity).start
 def runtime_start():
  # Every later restart (e.g. principal additions) keeps the same runtime tree.
  original=support.ROOT;support.ROOT=runtime
  try:start(identity)
  finally:support.ROOT=original
 identity.start=runtime_start;identity.start()
 return identity.child.pid
def load_objects():
 spec=importlib.util.spec_from_file_location("review17_objects",Path(__file__).with_name("15_2.py"))
 module=importlib.util.module_from_spec(spec);sys.modules["review17_objects"]=module;spec.loader.exec_module(module);return module

CONFLICT={"source":"CONTRACT","facet":"UNITS","producer":"scenario.py:producer","consumer":"scenario.py:consumer","detail":"Producer emits integer cents while the consumer accepts the same integer signature as whole units"}
REMOTE_IDS=[0,1,2,3,34,35,36,37]
def remote_executions(f,folder,request,planned,verifier,bound):
 d=f.identity;executor=None;objects=None;failure=None
 observed={"fixture_kind":"CONTROLLED_REMOTE_DOUBLE","product_api":["review.reproduction.plan","review.reproduction.assign","review.reproduction.execute","review.reproduction.inspect"],"jobs":[]}
 results={};plans={"units-system":planned};inspections={}
 try:
  objects=load_objects().ObjectFixture();executor=RemoteExecutor(f.repo)
  control_pid=remote_runtime(f,folder,executor,objects);observed["control_pid"]=control_pid
  component={key:value for key,value in request.items() if key!="projection_conflicts"}
  for n,name in enumerate(["units-producer","units-consumer"]):
   plans[name]=f.ok("review.reproduction.plan",dict(component,request_id=m.xid(0xa50+n),template_id=name,qualification_scope="COMPONENT"),component="17.4")
  runner=m.xid(0xc01);slot=m.xid(0xb02);registered=False;account=m.xid(0xc03)
  # Scheduler-held capacity is a fixture input: a qualified remote TEST account
  # and one ALLOCATED reservation per job. The control host holds no capacity.
  d.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,configured_limit,allocated,provenance_digest,qualification_state) VALUES($1,$2,$3,'TEST',16,6,$4,'QUALIFIED')",[m.ORG,account,d.ids["pool"],m.DIGEST])
  for name,plan in plans.items():
   for item in plan["jobs"]:
    snapshot=d.sql("SELECT snapshot FROM hyperfide.review_reproduction_jobs WHERE id=$1",[item["job_id"]])[0]["snapshot"]
    measured=executor.materialise(runner,snapshot["source_object_id"])
    if not registered:
     d.sql("INSERT INTO hyperfide.runner_registry(organisation_id,run_id,session_id,credential_id,sandbox_id,boot_generation,boot_id,slot_id,repository_id,state_dir,runner_binary,workspace_path,home_path,tmp_path,runner_binary_digest,boot_preparation_digest,preparation_digest,readiness_digest,source_digest,source_object_id,source_tree_id,slot_generation,uid,gid,observation_digest) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,'/fixture/remote/state','/fixture/remote/runner',$9,'/fixture/remote/home','/fixture/remote/tmp',$10,$10,$10,$10,$11,$12,$13,1,65534,65534,$10)",
      [m.ORG,m.RUN,runner,m.xid(0xc02),d.ids["sandbox"],d.ids["boot"],slot,m.REPOSITORY,measured["workspace_path"],m.DIGEST,snapshot["source_manifest_digest"],measured["source_object_id"],measured["source_tree_id"]]);registered=True
    else:
     d.sql("UPDATE hyperfide.runner_registry SET source_object_id=$4,source_tree_id=$5,source_digest=$6 WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3",[m.ORG,m.RUN,runner,measured["source_object_id"],measured["source_tree_id"],snapshot["source_manifest_digest"]])
    reservation=str(uuid.uuid4())
    d.sql("INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,expires_at,state) VALUES($1,$2,$3,$4,$5,1,clock_timestamp()+interval '10 minutes','ALLOCATED')",[m.ORG,m.RUN,reservation,str(uuid.uuid4()),account])
    executor.allocations[reservation]={"allocation_id":str(uuid.uuid4()),"request_id":str(uuid.uuid4()),"pool_id":d.ids["pool"],"task_id":m.xid(0x301),"job_kind":"TEST","reservation_id":reservation,"slot_id":slot,"sandbox_id":d.ids["sandbox"],"sandbox_boot_generation":"1","assignee_session_id":verifier,"generation":"1"}
    lease=f.ok("review.reproduction.assign",dict(m.SCOPE,job_id=item["job_id"],worker_session_id=verifier,reservation_id=reservation,lease_seconds=120),component="17.4")
    m.expect(lease["execution_plane"]=="REMOTE","assignment was not a remote placement")
    result=f.ok("review.reproduction.execute",dict(m.SCOPE,job_id=item["job_id"],lease_generation=str(lease["lease_generation"])),component="17.4",key="verifier")
    results[(name,item["variant"])]=dict(result,lease_generation=str(lease["lease_generation"]),commit=snapshot["source_object_id"])
    observed["jobs"].append({"template_id":name,"variant":item["variant"],"job_id":item["job_id"],"commit":snapshot["source_object_id"],"input_manifest_digest":item["input_manifest_digest"],"receipt_id":result["receipt_id"],"outcome":result["outcome"],"limitations":result["limitations"]})
  for name,plan in plans.items():inspections[name]=f.ok("review.reproduction.inspect",dict(m.SCOPE,plan_id=plan["plan_id"]),component="17.4")
 except Exception as error:failure=error
 def guarded(callback):
  def run():
   if failure is not None:raise AssertionError("remote dispatch through the product API failed: "+type(failure).__name__+": "+str(failure)[:900])
   callback()
  return run
 receipts={}
 if failure is None:
  for row in d.sql("SELECT receipt.job_id,receipt.input_manifest_digest,receipt.candidate_digest,receipt.result,job.input_manifest_digest AS job_input,job.snapshot,job.sandbox_id,job.slot_id,job.state,slot.capacity_kind FROM hyperfide.review_reproduction_receipts receipt JOIN hyperfide.review_reproduction_jobs job ON job.organisation_id=receipt.organisation_id AND job.run_id=receipt.run_id AND job.id=receipt.job_id LEFT JOIN hyperfide.worker_slots slot ON slot.organisation_id=job.organisation_id AND slot.id=job.slot_id"):receipts[row["job_id"]]=row
 def bound_receipt(name,variant,outcome,commit):
  result=results[(name,variant)];row=receipts.get(results[(name,variant)]["job_id"])
  m.expect(result["outcome"]==outcome and row is not None and row["result"]["outcome"]==outcome,f"{name} {variant} remote receipt outcome was not {outcome}")
  m.expect(row["input_manifest_digest"]==row["job_input"] and row["snapshot"]["candidate_input_manifest_digest"]==bound["input_manifest_digest"] and row["candidate_digest"]==m.DIGEST,f"{name} {variant} receipt is not bound to its exact candidate input manifest")
  m.expect([s["source_object_id"] for s in row["result"]["source_set"] if s["repository_id"]==m.REPOSITORY]==[commit] and row["result"]["physical"]["source_object_id"]==commit,f"{name} {variant} receipt lost its exact commit")
 def component_pass(name):
  bound_receipt(name,"ORIGINAL","PASS",f.first);bound_receipt(name,"REPAIRED","PASS",f.second)
  m.expect(inspections[name]["original"]["outcome"]=="PASS" and inspections[name]["repaired"]["outcome"]=="PASS","separately passing component lost its admitted receipt")
 check(IDS[0],guarded(lambda:component_pass("units-producer")))
 check(IDS[1],guarded(lambda:component_pass("units-consumer")))
 check(IDS[2],guarded(lambda:bound_receipt("units-system","ORIGINAL","FAIL",f.first)))
 check(IDS[3],guarded(lambda:bound_receipt("units-system","REPAIRED","PASS",f.second)))
 def integrated():
  system=inspections["units-system"]
  m.expect(system["original"]["outcome"]=="FAIL" and system["original"]["evidence_ids"] and system["original"]["source_set"]==[{"repository_id":m.REPOSITORY,"source_object_id":f.first}],"integrated failure lost exact commit-set evidence")
  m.expect(system["repaired"]["outcome"]=="PASS" and system["repaired"]["source_set"]==[{"repository_id":m.REPOSITORY,"source_object_id":f.second}],"repaired integration lost exact commit-set evidence")
  m.expect(all(inspections[n]["original"]["outcome"]=="PASS" for n in ["units-producer","units-consumer"]),"component passes were not retained as historical")
  m.expect(any(g["kind"]=="PROJECTION_CONFLICT" and g["certainty"]=="UNCERTAIN" and g["proof"] is False for g in system["guidance"]) and system["guidance_is_proof"] is False and system["candidate_build"]=="NOT_PROVEN_BY_GUIDANCE" and system["system_correctness"]=="NOT_PROVEN","executed proof replaced retained uncertain guidance")
 check(IDS[34],guarded(integrated))
 def replay():
  item=results[("units-system","ORIGINAL")];before=len(executor.executions)
  again=f.ok("review.reproduction.execute",dict(m.SCOPE,job_id=item["job_id"],lease_generation=item["lease_generation"]),component="17.4",key="verifier")
  m.expect(again.get("replayed") is True and again["receipt_id"]==item["receipt_id"] and len(executor.executions)==before,"executed reproduction replay dispatched another physical run")
 check(IDS[35],guarded(replay))
 def placement():
  jobs=d.sql("SELECT job.id,job.state,job.sandbox_id,job.slot_id,slot.capacity_kind,box.native_sandbox_id FROM hyperfide.review_reproduction_jobs job LEFT JOIN hyperfide.worker_slots slot ON slot.organisation_id=job.organisation_id AND slot.id=job.slot_id LEFT JOIN hyperfide.sandboxes box ON box.organisation_id=job.organisation_id AND box.id=job.sandbox_id WHERE job.state IN ('LEASED','RUNNING','OUTCOME_UNKNOWN','PASSED','FAILED')")
  m.expect(len(jobs)==6 and all(j["sandbox_id"]==d.ids["sandbox"] and j["capacity_kind"]=="TEST" and j["state"] in ["PASSED","FAILED"] for j in jobs),"a dispatched job was not bound to the registered remote TEST sandbox slot")
  m.expect(len(receipts)==6 and all(r["result"]["physical"]["execution_plane"]=="REMOTE" and r["result"]["physical"]["sandbox_id"]==d.ids["sandbox"] and r["result"]["physical"]["execution_host"]!="CONTROL" for r in receipts.values()),"a receipt was not attributed to remote execution")
  for name,inspection in inspections.items():
   for variant in ["original","repaired"]:
    p=inspection[variant]["placement"]
    m.expect(p["execution_plane"]=="REMOTE" and p["capacity_kind"]=="TEST" and p["receipt_execution_plane"]=="REMOTE" and p["sandbox_id"]==d.ids["sandbox"],"inspector lost remote placement attribution")
  m.expect(sorted(r["result"]["physical"]["start_identity"]["pid"] for r in receipts.values())==sorted(e["scenario_pid"] for e in executor.executions),"receipt process identities differ from remote executor observations")
 check(IDS[36],guarded(placement))
 def control_host():
  m.expect(len(executor.executions)==6,"unexpected remote execution count")
  for e in executor.executions:
   m.expect(e["control_pid"]==observed["control_pid"] and e["scenario_parent_pid"]==e["executor_pid"]!=e["control_pid"],"scenario process was spawned by the control service")
   m.expect(e["scenario_pid"] not in e["control_descendants_observed"] and e["scenario_pid"] not in e["control_descendants_at_spawn"] and not any("scenario.py" in c for c in e["control_descendant_commands"]),"control service process tree contained a scenario process")
   m.expect(e["sampler_detects_scenario"] is True,"process-tree sampler could not observe a known scenario child")
   m.expect(e["scenario_uid"]==65534 and e["process_absent_after_cleanup"],"remote scenario identity or cleanup was not observed")
 check(IDS[37],guarded(control_host))
 if executor:observed["executions"]=executor.executions
 if failure is not None:observed["failure"]=type(failure).__name__+": "+str(failure)[:900]
 (m.evidence_dir("17.4")/"remote-fixture-observations.json").write_text(json.dumps(observed,indent=2,sort_keys=True)+"\n")
 if executor:executor.close()
 if objects:objects.stop()

def main():
 # Fixture commits must not daemonise `git maintenance --auto --detach`; that
 # orphan would outlive the probe and be reported as a leaked descendant.
 os.environ.update({"GIT_CONFIG_COUNT":"2","GIT_CONFIG_KEY_0":"maintenance.auto","GIT_CONFIG_VALUE_0":"false","GIT_CONFIG_KEY_1":"gc.auto","GIT_CONFIG_VALUE_1":"0"})
 with tempfile.TemporaryDirectory(prefix="hf-review-repro-") as folder:
  f=m.Fixture("17.4",Path(folder),["17.4"],extra_setup=setup)
  try:
   f.configure();f.discover();snapshot=seed(f)
   system_check=check_definition("units-system")
   policy={"schema_version":1,"criteria_digest":f.criteria,"spec_revision_id":f.identity.ids["accepted_spec"],"spec_generation":"2","repository_id":m.REPOSITORY,"source_object_id":f.pinned,"rubric_digest":m.DIGEST,"checks":[check_definition(name) for name in CHECKS],"clauses":[{"id":"1.1","mode":"EXECUTABLE","acceptance_ids":["1"],"checks":list(CHECKS)}],"inputs":{key:sha(key.encode()) for key in ["source","dependency","toolchain","configuration","graph","contract"]},"contract_digests":[]}
   registry=f.ok("spec.proof.register",{"run_id":m.RUN,"task_id":m.xid(0x301),"spec_revision_id":f.identity.ids["accepted_spec"],"spec_generation":"2","state_version":"2","policy":policy},component="spec-obligations")
   bound=f.ok("review.inputs.bind",dict(m.SCOPE,repository_id=m.REPOSITORY,source_object_id=f.second,policy_digest=f.policy_digest,candidate_digest=m.DIGEST,snapshot=snapshot),component="17.3")
   original=copy.deepcopy(snapshot);original["source_set"][0]["source_object_id"]=f.first
   request=dict(m.SCOPE,request_id=m.xid(0xa40),candidate_digest=m.DIGEST,candidate_input_manifest_digest=bound["input_manifest_digest"],template_id="units-system",qualification_scope="SYSTEM",original={"custody_id":m.xid(0xa21),"snapshot":original},repaired={"custody_id":m.xid(0xa22),"snapshot":snapshot},projection_conflicts=[CONFLICT])
   planned={}
   check(IDS[4],lambda:planned.update(f.ok("review.reproduction.plan",request,component="17.4")))
   rows=f.identity.sql("SELECT id,snapshot,qualification_scope FROM hyperfide.review_reproduction_jobs ORDER BY snapshot->>'variant'")
   check(IDS[22],lambda:m.expect(len(rows)==2 and all(r["snapshot"]["check"]["timeout_ms"]==CHECK_TIMEOUT for r in rows),"actual accepted72hcheck was shortened or refused during plan admission"))
   check(IDS[5],lambda:m.expect(len(rows)==2 and all(r["snapshot"]["source_object_id"]!=f.pinned and r["snapshot"]["check"]==system_check for r in rows),"result revision was confused with accepted baseline"))
   check(IDS[6],lambda:m.expect(f.ok("review.reproduction.plan",request,component="17.4")["plan_id"]==planned["plan_id"],"retry created another physical job"))
   check(IDS[7],lambda:f.reject("review.reproduction.plan",dict(request,qualification_scope="CONTRACT"),"REPRODUCTION_REQUEST_CONFLICT",component="17.4"))
   check(IDS[8],lambda:f.reject("review.reproduction.plan",dict(request,argv=["sh","-c","true"]),"REVIEW_INPUT_INVALID",component="17.4"))
   check(IDS[9],lambda:f.reject("review.reproduction.plan",dict(request,request_id=m.xid(0xa41),template_id="caller-check"),"REPRODUCTION_CHECK_MISSING",component="17.4"))
   check(IDS[10],lambda:f.reject("review.reproduction.plan",dict(request,request_id=m.xid(0xa42),candidate_input_manifest_digest="sha256:"+"b"*64),"REPRODUCTION_INPUT_MISMATCH",component="17.4"))
   absent=copy.deepcopy(request);absent["request_id"]=m.xid(0xa43);absent["original"]["custody_id"]=m.xid(0xdead)
   check(IDS[11],lambda:f.reject("review.reproduction.plan",absent,"REPRODUCTION_CUSTODY_MISSING",component="17.4"))
   def immutable():
    result=m.sql("17.4","UPDATE hyperfide.review_reproduction_jobs SET snapshot='{}';",allow_error=True)
    m.expect(result.returncode!=0 and "23514" in result.stderr,"immutable job input changed")
   check(IDS[12],immutable)
   inspection=f.ok("review.reproduction.inspect",dict(m.SCOPE,plan_id=planned["plan_id"]),component="17.4")
   check(IDS[13],lambda:m.expect(inspection["status"]=="INCOMPLETE" and inspection["original"]["outcome"]=="UNKNOWN" and not inspection["repaired"]["evidence_ids"],"unrun request became proof"))
   def guidance():
    retained=[g for g in inspection["guidance"] if g["kind"]=="PROJECTION_CONFLICT"]
    m.expect(len(retained)==1 and all(retained[0][k]==v for k,v in CONFLICT.items()) and retained[0]["certainty"]=="UNCERTAIN" and retained[0]["proof"] is False and retained[0]["satisfies_coverage"] is False and retained[0]["evidence_ids"]==[],"projection conflict was not retained as uncertain non-proof guidance")
    m.expect(inspection["status"]=="INCOMPLETE" and inspection["guidance_is_proof"] is False and inspection["candidate_build"]=="NOT_PROVEN_BY_GUIDANCE" and inspection["repaired"]["outcome"]=="UNKNOWN" and not inspection["repaired"]["evidence_ids"],"projection guidance was reported as proof that the candidate builds or behaves")
    m.expect(all(r["snapshot"]["guidance"][0]["certainty"]=="UNCERTAIN" for r in f.identity.sql("SELECT snapshot FROM hyperfide.review_reproduction_jobs")),"immutable job snapshot lost retained guidance")
   check(IDS[32],guidance)
   bogus=dict(request,request_id=m.xid(0xa44),projection_conflicts=[dict(CONFLICT,facet="PROVEN")])
   check(IDS[33],lambda:f.reject("review.reproduction.plan",bogus,"REVIEW_INPUT_INVALID",component="17.4"))
   job=planned["jobs"][0]["job_id"]
   assignment=dict(m.SCOPE,job_id=job,worker_session_id=m.xid(0x200),reservation_id=m.xid(0xb00),lease_seconds=120)
   check(IDS[14],lambda:f.reject("review.reproduction.assign",assignment,"REPRODUCTION_RESERVATION_INVALID",component="17.4"))
   verifier=m.xid(0xb01);slot=m.xid(0xb02)
   f.identity.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES($1,$2,$3,'independent-verifier',1,'TEST')",[m.ORG,slot,f.identity.ids["sandbox"]])
   f.identity.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation) VALUES($1,$2,$3,'VERIFIER','fixture','fixture','independent-verifier',$4,$5,1)",[m.ORG,m.RUN,verifier,slot,f.identity.ids["sandbox"]])
   f.identity.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[m.ORG,m.RUN])
   f.identity.bootstrap_runner();f.identity.delegate_principal("verifier",verifier)
   check(IDS[15],lambda:f.reject("review.reproduction.assign",dict(assignment,worker_session_id=verifier),"JOB_RESERVATION_INVALID",component="17.4"))
   check(IDS[16],lambda:f.reject("review.reproduction.execute",dict(m.SCOPE,job_id=job,lease_generation="1"),"REPRODUCTION_LEASE_STALE",component="17.4",key="verifier"))
   check(IDS[31],lambda:f.reject("review.reproduction.renew",dict(m.SCOPE,job_id=job,lease_generation="1"),"REPRODUCTION_LEASE_STALE",component="17.4",key="verifier"))
   check(IDS[17],lambda:f.reject("review.reproduction.inspect",dict(m.SCOPE,run_id=m.xid(0xdead),plan_id=planned["plan_id"]),"REVIEW_SCOPE_DENIED",component="17.4"))
   check(IDS[18],lambda:m.expect(f.identity.sql("SELECT count(*)::text AS n FROM hyperfide.runner_remote_jobs")[0]["n"]=="0" and f.identity.sql("SELECT count(*)::text AS n FROM hyperfide.review_reproduction_receipts")[0]["n"]=="0","unassigned validation fabricated physical execution"))
   check(IDS[19],lambda:m.expect(inspection["original"]["task_id"]==m.xid(0x301) and inspection["original"]["check_definition_digest"]==sha(canonical(system_check)) and inspection["original"]["registry_digest"]==inspection["repaired"]["registry_digest"] and inspection["original"]["qualification_scope"]=="SYSTEM","inspector lost exact accepted executable/source identity"))
   check(IDS[23],lambda:m.expect(inspection["original"]["custody_id"]==m.xid(0xa21) and inspection["original"]["custody_generation"]=="1" and inspection["repaired"]["custody_id"]==m.xid(0xa22) and inspection["repaired"]["custody_generation"]=="2","inspector lost immutable original and repair custody generations"))
   current_request=dict(m.SCOPE,request_id=m.xid(0xf01),causal_plan_id=planned["plan_id"],repair_custody_id=m.xid(0xa22),publication_operation_id=m.xid(0xf02),candidate_digest=m.DIGEST,candidate_input_manifest_digest=bound["input_manifest_digest"],template_id="units-system",qualification_scope="SYSTEM",snapshot=snapshot)
   check(IDS[20],lambda:f.reject("review.reproduction.current.plan",current_request,"REPRODUCTION_CAUSAL_PROOF_INCOMPLETE",component="17.4"))
   check(IDS[21],lambda:f.reject("review.reproduction.current.plan",dict(current_request,source_object_id=f.second),"REVIEW_INPUT_INVALID",component="17.4"))
   generation_boundary=generation_storage_boundary(f,job)
   check(IDS[29],lambda:m.expect(generation_boundary['independent'] and generation_boundary['rolled_back'],'independent scheduler/physical generation storage was conflated or fixture changed durable state'))
   check(IDS[30],lambda:m.expect(generation_boundary['refusal']=='23514' and generation_boundary['rolled_back'],'dispatched physical slot pin changed or fixture rollback failed'))
   boundaries=reader_boundaries(f)
   check(IDS[26],lambda:m.expect(boundaries['raw']=='TX_CLOSED','raw PG client acquired trusted reproduction reader authority'))
   check(IDS[27],lambda:m.expect(boundaries['forged']=='AUTH_REQUIRED','unbranded invocation acquired trusted reproduction reader authority'))
   remote_executions(f,folder,request,planned,verifier,bound)
   check(IDS[24],lambda:m.closed_audit(f,'review.reproduction.inspect',dict(m.SCOPE,plan_id=planned['plan_id']),'17.4'))
   check(IDS[25],lambda:m.closed_audit(f,'review.reproduction.current.plan',current_request,'17.4',write=True))
   check(IDS[28],lambda:f.reject('review.reproduction.inspect',dict(m.SCOPE,plan_id=planned['plan_id']),'AUTH_RUN_CLOSED',component='17.4',key='verifier'))
  finally:emit();f.identity.close();f.save(m.FAILED)
 return int(bool(m.FAILED))
if __name__=="__main__":raise SystemExit(m.cleanup("17.4") if "--cleanup" in sys.argv else main())
