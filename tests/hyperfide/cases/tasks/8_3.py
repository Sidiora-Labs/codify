#!/usr/bin/env python3
"""Signed HTTPS + actual PostgreSQL durable provider-intent component checks."""
from __future__ import annotations
import copy,hashlib,importlib.util,json,os,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
pools=load("provider_pool_fixture","tests/hyperfide/cases/tasks/8_2.py")
prepared=load("provider_preparation_fixture","tests/hyperfide/cases/tasks/11_1.py")
expect=pools.expect
IDS=["provider.intent.configure","provider.intent.seed-admission","provider.intent.persist-before-effects","provider.intent.resource-reservations-bound","provider.intent.idempotent","provider.intent.key-payload-conflict","provider.intent.no-parameter-overrides","provider.intent.no-reservation","provider.intent.duplicate-reservation","provider.intent.stale-deadline","provider.intent.wrong-run","provider.intent.wrong-preparation","provider.intent.execution-needs-qualified-base","provider.intent.operator-no-effects","provider.intent.missing-adapter-no-submission","provider.intent.recorded-reconcile-no-effects","provider.intent.crash-state-no-replay","provider.intent.unknown-state-held","provider.intent.no-caller-remote-execution","provider.intent.no-known-resource-from-model","provider.intent.empty-boot-destroy","provider.intent.destroy-idempotent","provider.intent.destroy-stops-admission","provider.intent.worked-boot-needs-custody","provider.intent.remote-history-needs-custody","provider.intent.orphans-observation-only","provider.intent.exact-primary-brand","provider.intent.absence-unproven"]
IDS+=["provider.intent.physical-reservation-single-owner"]
IDS+=["provider.lineage.unregistered-refused","provider.lineage.exact-derived-selection","provider.lineage.full-manifest-tamper","provider.lineage.policy-escalation","provider.lineage.stale-refused","provider.lineage.expired-refused","provider.lineage.hash-tamper","provider.lineage.retained-proof-required","provider.lineage.parent-binding","provider.lineage.v2-full-body","provider.lineage.immutable-proof"]
IDS+=["provider.capture.stream-pair-framing","provider.capture.actual-ordered-framing","provider.capture.exact-byte-count","provider.capture.exact-output-hash","provider.capture.exact-spool-hash","provider.capture.contiguous-coverage","provider.capture.actual-range-hash","provider.capture.explicit-scheme","provider.process.terminal-absorbing","provider.process.terminal-conflict","provider.process.terminal-identical","provider.capture.immutable-byte-copy","provider.lineage.recipe-policy-immutable"]
IDS+=["provider.accounting.installs-actual-reader","provider.accounting.unproven-absence-held","provider.accounting.teardown-unregisters","provider.accounting.provisioner-refused","provider.accounting.no-provider-effects"]
IDS+=["provider.worker.missing-adapter-not-ready","provider.worker.missing-adapter-no-submission"]
WORKER_IDS=["provider.worker.control-role-refused","provider.worker.operator-cannot-start","provider.worker.incompatible-adapter-not-ready","provider.worker.ready-with-adapter","provider.worker.control-commits-intent","provider.worker.consumes-committed-intent","provider.worker.records-observed-state","provider.worker.crash-leaves-submitting","provider.worker.resumes-after-restart","provider.worker.paginated-inventory","provider.worker.ambiguous-quarantined","provider.worker.ambiguous-not-replayed","provider.worker.destroy-confirmed-absent","provider.worker.admin-credentials-provisioner-only"]
IDS+=WORKER_IDS
FAILED=[]
def check(name,fn):
 try:fn();actual="observed"
 except Exception as e:FAILED.append(name);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def sha(value):return "sha256:"+hashlib.sha256(value).hexdigest()
def utc(ms=60000):return time.strftime("%Y-%m-%dT%H:%M:%S",time.gmtime((time.time()*1000+ms)/1000))+".000Z"
def prepare_provider_intent_fixture(f):
 f.apply_migration("0005-scheduling");f.apply_migration("0008-provider-coordination")
 pre=prepared.Fixture(f.path/"source-preparation");manifest=pre.create()
 f.preparation=manifest["digest"];f.profile=str(uuid.uuid4());f.pool=str(uuid.uuid4())
 f.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,id,provider,runtime_platform,content_digest,manifest) VALUES($1,$2,'railway','linux-x86_64',$3,$4)",[f.ids["organisation"],f.profile,f.preparation,manifest])
 limits={"SANDBOX":"100","PROVISIONING":"10","CPU_MILLIS":"200000","MEMORY_BYTES":"429496729600","DISK_BYTES":"3221225472000"}
 f.config={"schema_version":1,"organisation_id":f.ids["organisation"],"revision":"COMPONENT_FIXTURE_NOT_LIVE","accounts":[{"provider":"railway","account_key":"fixture-account","approved_limits":limits,"planning_limits":limits}],"pools":[{"id":f.pool,"provider":"railway","account_key":"fixture-account","environment_key":"fixture-env","region":"fixture-region","profile_id":f.profile,"preparation_digest":f.preparation,"approved_limits":limits,"planning_limits":limits,"create_policy":{"seed_reference":"fixture-approved-seed","network":"ISOLATED","stdin_required":False}}],"maximum_operation_ms":120000}
 f.configfile=f.path/"pool-policy.json";f.configfile.write_text(json.dumps(f.config));f.configfile.chmod(0o600);f.env["HYPERFIDE_POOL_CONFIG"]=str(f.configfile)
 f.reservations=[]

def seed_provider_capacity(f):
 org=f.ids["organisation"];run=f.ids["run"]
 cfg=f.sql("SELECT configuration_digest FROM hyperfide.provider_pool_configurations WHERE organisation_id=$1 AND pool_id=$2 AND active",[org,f.pool])[0]["configuration_digest"]
 resources={"SANDBOX":"1","CPU_MILLIS":"2000","MEMORY_BYTES":"4294967296","DISK_BYTES":"32212254720"}
 for name,quantity in resources.items():
  aid=str(uuid.uuid4());rid=str(uuid.uuid4())
  f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,configured_limit,reserved,provenance_digest,qualification_state) VALUES($1,$2,$3,$4,'PHYSICAL',$5,$6,$7,'QUALIFIED')",[org,aid,f.pool,name,str(int(quantity)*100),quantity,sha(b"owned-capacity-fixture")])
  f.sql("INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '1 hour')",[org,run,rid,str(uuid.uuid4()),aid,quantity]);f.reservations.append(rid)
 for name,quantity in {**resources,"PROVISIONING":"1"}.items():
  for kind,key in [("ACCOUNT","fixture-account"),("ENVIRONMENT","fixture-env")]:
   f.sql("INSERT INTO hyperfide.provider_quota_observations(organisation_id,id,pool_id,configuration_digest,provider,account_key,scope_kind,scope_key,dimension,quota_limit,observed_at,expires_at,evidence_digest,basis,evidence_reference) VALUES($1,$2,$3,$4,'railway','fixture-account',$5,$6,$7,$8,clock_timestamp(),clock_timestamp()+interval '10 minutes',$9,'VERIFIED_OPERATOR_ATTESTATION','COMPONENT_FIXTURE_NOT_LIVE')",[org,str(uuid.uuid4()),f.pool,cfg,kind,key,name,str(int(quantity)*100),sha(b"owned-attestation-fixture")])


# SIMULATED controlled adapter fixture: qualifies the control/provisioner/worker
# composition only. It is registered through provider.registry.v1 inside the
# actual provisioner service process; real provider behaviour needs live variants.
SIMULATED_ADAPTER=r"""
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
const file=process.env.HF_SIMULATED_PROVIDER_STATE;
const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=v=>{fs.writeFileSync(file+'.next',JSON.stringify(v));fs.renameSync(file+'.next',file);};
const update=f=>{const v=read();const r=f(v);write(v);return r;};
const log=(op)=>update(v=>{v.calls.push({method:op.kind,operation_id:op.identity.operation_id,correlation_id:op.identity.correlation_id,cursor:op.parameters?.cursor??null});});
const sha=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
const ok=(op,resource,result)=>({schema_version:1,status:'SUCCEEDED',acceptance:'CONFIRMED_ACCEPTED',operation_id:op.identity.operation_id,payload_digest:op.identity.payload_digest,scope:op.scope,observed_at:new Date().toISOString(),provider_request_id:'simulated-'+randomUUID(),resource,result,error:null,reconcile_required:false,retry:'NEVER'});
const unsupported=op=>({schema_version:1,status:'UNSUPPORTED',acceptance:'CONFIRMED_REJECTED',operation_id:op.identity.operation_id,payload_digest:op.identity.payload_digest,scope:op.scope,observed_at:new Date().toISOString(),provider_request_id:null,resource:op.resource,result:null,error:{code:'UNSUPPORTED',provider_code:null,message:'simulated',retry_after_ms:null},reconcile_required:false,retry:'NEVER'});
function adapter(scope,hooks){
 if(read().incompatible)return {provider:'blaxel'};
 const a={provider:'railway'};
 for(const m of ['capabilities','prepare','attach','execute','inspect','stop','transfer','lifetime'])a[m]=async op=>{log(op);return unsupported(op)};
 a.create=async(op,signal)=>{
  log(op);await hooks.resolvePreparation(op);const generation=await hooks.assignedBootGeneration(op);
  const mode=read().create_mode,native='simulated-'+randomUUID();
  update(v=>{v.resources[native]={operation_id:op.identity.operation_id,owned:mode!=='lose',state:'RUNNING'};});
  if(mode==='hang')return await new Promise(()=>{});
  if(mode==='lose')throw new Error('simulated lost create response');
  const ref=await hooks.persistEarlyResource(op,native);
  if(ref.sandbox_boot_generation!==generation)throw new Error('generation changed');
  return ok(op,ref,{provider_state:'CREATING'});
 };
 a.list=async op=>{
  log(op);const ids=Object.keys(read().resources).sort(),start=op.parameters.cursor===null?0:Number(op.parameters.cursor);
  const items=ids.slice(start,start+1).map(id=>({native_sandbox_id:id,provider_state:'RUNNING'})),more=start+1<ids.length;
  return ok(op,null,{page:{scope:op.scope,requested_cursor:op.parameters.cursor,next_cursor:more?String(start+1):null,has_more:more,complete:!more,consistency:'BEST_EFFORT',snapshot_id:null,observed_at:new Date().toISOString(),items}});
 };
 a.observe=async op=>{log(op);const r=read().resources[op.resource.native_sandbox_id];return ok(op,op.resource,r?{provider_state:'RUNNING',health:'HEALTHY'}:{provider_state:'DESTROYED',health:'ABSENT'});};
 a.destroy=async op=>{log(op);update(v=>{delete v.resources[op.resource.native_sandbox_id];});return ok(op,op.resource,{deletion:'CONFIRMED'});};
 return a;
}
export function createComponent(context){
 const registry=context.dependencies.require('8.2','provider.registry.v1',v=>!!v&&typeof v.registerProviderAdapter==='function');
 const off=[registry.registerProviderAdapter('railway',adapter),registry.registerProviderOwnershipProbe('railway',async(scope,operationId,native)=>{
  const r=read().resources[native];return{matches:!!r&&r.owned&&r.operation_id===operationId,operation_id:operationId,native_sandbox_id:native,evidence_digest:sha('simulated-ownership:'+operationId+':'+native)};})];
 return{apiVersion:1,actions:{'provider.simulated.describe':()=>({simulated:true,live_qualification:'NOT_EVALUATED'})},close:()=>{for(const f of off)f();}};
}
"""
SIMULATED_FRAGMENT={"schema_version":1,"id":"8.3-simulated-adapter","task":"8.3","roles":["provisioner"],"module":"fixtures/simulated-provider.js","entry":"createComponent","api_version":1,"actions":["provider.simulated.describe"],"requires":["8.2"]}
def spawn_service(f,role,port,components,module_root):
 import select,signal as _signal
 argv=["node",str(Path(module_root)/(role+".js")),"--policy",str(f.policy),"--spec-revision","fixture-identity-v1","--components",str(components),"--module-root",str(module_root),"--mode","https","--host","127.0.0.1","--port",str(port),"--tls-cert",str(f.ca),"--tls-key",str(f.tlskey)]
 child=subprocess.Popen(argv,cwd=ROOT,env=f.env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
 deadline=time.monotonic()+20;lines=[]
 while time.monotonic()<deadline:
  ready,_,_=select.select([child.stderr],[],[],0.1)
  if ready:
   line=child.stderr.readline();lines.append(line)
   if '"event":"ready"' in line:return child
  if child.poll() is not None:break
 child.kill();child.wait()
 raise AssertionError(role+" service did not become ready: "+"".join(lines)[:1500])
def simulated_module_root(folder):
 # Byte-identical copy of the built runtime plus the simulated fixture module; the
 # registry refuses modules outside --module-root, so the fixture cannot live in dist.
 import shutil
 service=ROOT/"services/hyperfide";root=Path(folder)
 shutil.copytree(service/"dist",root/"dist",symlinks=False);shutil.copyfile(service/"package.json",root/"package.json")
 (root/"node_modules").symlink_to(service/"node_modules");(root/"migrations").symlink_to(service/"migrations")
 (root/"dist/fixtures").mkdir();(root/"dist/fixtures/simulated-provider.js").write_text(SIMULATED_ADAPTER)
 return root/"dist"
class SimulatedProvisionerFixture(pools.ProvisionerFixture):
 """Provisioner fixture whose actual service process also loads the simulated adapter."""
 def __init__(self,module_root,**kwargs):self.module_root=module_root;super().__init__(**kwargs)
 def start(self):self.child=spawn_service(self,"provisioner",self.port,self.components,self.module_root)
 def crash(self):
  if self.child:self.child.kill();self.child.wait();self.child.stderr.close();self.child=None
 def stop(self):
  if self.child:
   self.child.terminate()
   try:self.child.wait(timeout=10)
   except subprocess.TimeoutExpired:self.child.kill();self.child.wait()
   self.child.stderr.close();code=self.child.returncode;self.child=None
   expect(code==0,"simulated provisioner termination failed: "+str(code))
def wait_for(predicate,detail,seconds=30):
 deadline=time.monotonic()+seconds;last=None
 while time.monotonic()<deadline:
  try:
   last=predicate()
   if last:return last
  except AssertionError as e:last=str(e)
  time.sleep(0.2)
 raise AssertionError(detail+": "+json.dumps(last,default=str)[:800])
def worker_composition(check):
 """Separate control process commits intents; the provisioner worker consumes them."""
 import shutil,socket,tempfile
 folder=tempfile.mkdtemp(prefix="hyperfide-simulated-");f=None;control=None;complete=False
 state=Path(folder)/"provider-state.json"
 def provider():return json.loads(state.read_text())
 def configure(v):
  data=provider();data.update(v);state.write_text(json.dumps(data))
 try:
  state.write_text(json.dumps({"resources":{},"calls":[],"create_mode":"succeed","incompatible":False}))
  module_root=simulated_module_root(folder)
  def setup(fx):
   prepare_provider_intent_fixture(fx)
   (fx.components/"8.3-simulated-adapter.json").write_text(json.dumps(SIMULATED_FRAGMENT))
   fx.env.update({"HF_SIMULATED_PROVIDER_STATE":str(state),"HYPERFIDE_PROVISIONER_POLL_MS":"200","HYPERFIDE_PROVISIONER_RETRY_MS":"500","HYPERFIDE_PROVISIONER_LEASE_MS":"3000","HYPERFIDE_PROVISIONER_CONCURRENCY":"2"})
  f=SimulatedProvisionerFixture(module_root,extra_components=["8.2","8.3"],extra_setup=setup,extra_actions=["provider.simulated.describe"])
  org=f.ids["organisation"];run=f.ids["run"]
  status,response=f.invoke("provider.pools.configure",{},component="8.2",key="operator");expect(status==200 and response.get("ok"),response)
  # Separate control-role service process over the same PostgreSQL authority and identity origin.
  controls=Path(folder)/"control-components";controls.mkdir()
  for name in ("1.4","4.2","4.4","14.1","8.2","8.3"):shutil.copyfile(ROOT/("services/hyperfide/components/"+name+".json"),controls/(name+".json"))
  with socket.socket() as sock:sock.bind(("127.0.0.1",0));control_port=sock.getsockname()[1]
  control=spawn_service(f,"control",control_port,controls,ROOT/"services/hyperfide/dist")
  via=copy.copy(f);via.port=control_port
  def call(target,action,input,key,component="8.3"):
   status,response=target.invoke(action,input,component=component,key=key,timeout_seconds=30);return status,response
  def ok(target,action,input,key="operator",component="8.3"):
   status,response=call(target,action,input,key,component);expect(status==200 and response.get("ok") is True,(status,response));return response["result"]
  def refused(target,action,input,key,code):
   status,response=call(target,action,input,key);expect(status>=400 or response.get("ok") is False,(status,response));expect(code in json.dumps(response),response)
  def intent(iid):return f.sql("SELECT state,native_sandbox_id,failure_code,last_outcome FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND id=$2",[org,iid])[0]
  def calls(method,iid):return [c for c in provider()["calls"] if c["method"]==method and (c["operation_id"]==iid or c["correlation_id"]==iid)]
  seed_provider_capacity(f)
  def reserve():
   # Further physical reservations on the already-seeded owned capacity accounts.
   for name,quantity in {"SANDBOX":"1","CPU_MILLIS":"2000","MEMORY_BYTES":"4294967296","DISK_BYTES":"32212254720"}.items():
    aid=f.sql("SELECT id FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 AND dimension=$3 AND capacity_class='PHYSICAL'",[org,f.pool,name])[0]["id"];rid=str(uuid.uuid4())
    f.sql("UPDATE hyperfide.capacity_accounts SET reserved=reserved+$3::numeric,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,aid,quantity])
    f.sql("INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '1 hour')",[org,run,rid,str(uuid.uuid4()),aid,quantity]);f.reservations.append(rid)
  used=[0]
  def commit(deadline_ms=60000):
   if used[0]:reserve()
   used[0]+=1
   request={"run_id":run,"pool_id":f.pool,"sandbox_id":str(uuid.uuid4()),"request_key":str(uuid.uuid4()),"deadline_at":utc(deadline_ms),"reservation_ids":f.reservations[-4:],"profile_id":f.profile,"preparation_digest":f.preparation,"purpose":"PREPARATION"}
   answer=ok(via,"provider.intents.prepare-create",request);expect(answer["created"] is True and answer["external_call_performed"] is False,answer)
   return answer["intent"]["id"],request["sandbox_id"]
  check(WORKER_IDS[0],lambda:refused(via,"provider.worker.start",{},"provisioner","ROLE_FORBIDDEN"))
  check(WORKER_IDS[1],lambda:refused(f,"provider.worker.start",{},"operator","AUTH_SCOPE_DENIED"))
  def incompatible():
   configure({"incompatible":True})
   try:
    s=ok(f,"provider.worker.status",{})
    expect(s["operational_ready"] is False and s["pools"][0]["adapter_registered"] is True and s["pools"][0]["adapter_compatible"] is False and s["pools"][0]["reason"]=="PROVIDER_ADAPTER_INCOMPATIBLE",s)
   finally:configure({"incompatible":False})
  check(WORKER_IDS[2],incompatible)
  def ready():
   s=ok(f,"provider.worker.start",{},"provisioner")
   expect(s["started"] is True and s["running"] is True and s["settings"]["concurrency"]==2,s)
   s=ok(f,"provider.worker.status",{})
   expect(s["operational_ready"] is True and s["pools"][0]["adapter_compatible"] is True and s["pools"][0]["configuration_current"] is True,s)
  check(WORKER_IDS[3],ready)
  # (a) control commits; (b) the running worker consumes and records adapter-observed state.
  configure({"create_mode":"succeed"});first={}
  def committed():
   first["id"],first["sandbox"]=commit()
   expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND id=$2",[org,first["id"]])[0]["n"]==1,"control intent not durable")
  check(WORKER_IDS[4],committed)
  def consumed():
   row=wait_for(lambda:(lambda r:r if r["native_sandbox_id"] else None)(intent(first["id"])),"worker did not consume committed intent")
   expect(len(calls("create",first["id"]))==1 and row["native_sandbox_id"] in provider()["resources"],(row,provider()["calls"]))
  check(WORKER_IDS[5],consumed)
  def observed():
   wait_for(lambda:intent(first["id"])["state"]=="ACKNOWLEDGED","adapter-observed RUNNING not recorded")
   obs=f.sql("SELECT observation->'operation'->>'kind' AS kind,observation->'outcome'->'result'->>'provider_state' AS state FROM hyperfide.provider_observations WHERE organisation_id=$1 AND intent_id=$2 ORDER BY observed_at",[org,first["id"]])
   expect({"kind":"observe","state":"RUNNING"} in obs and f.sql("SELECT observed_state FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2",[org,first["sandbox"]])[0]["observed_state"]=="RUNNING",obs)
  check(WORKER_IDS[6],observed)
  # (c) crash between provider create and early-ID persistence, then restart.
  configure({"create_mode":"hang"});second={}
  def crashed():
   second["id"],second["sandbox"]=commit(9000)
   wait_for(lambda:any(r["operation_id"]==second["id"] for r in provider()["resources"].values()),"provider create not reached")
   f.crash()
   row=intent(second["id"]);expect(row["state"]=="SUBMITTING" and row["native_sandbox_id"] is None,row)
  check(WORKER_IDS[7],crashed)
  def resumed():
   configure({"create_mode":"succeed"});f.start()
   before=len(provider()["calls"])
   ok(f,"provider.worker.start",{},"provisioner")
   row=wait_for(lambda:(lambda r:r if r["state"]=="ACKNOWLEDGED" else None)(intent(second["id"])),"restarted worker did not reconcile in-flight intent",40)
   owned=[k for k,v in provider()["resources"].items() if v["operation_id"]==second["id"]]
   expect(owned==[row["native_sandbox_id"]] and len(calls("create",second["id"]))==1,("replayed or lost",row,owned))
   second["lists"]=[c for c in provider()["calls"][before:] if c["method"]=="list" and c["correlation_id"]==second["id"]]
  check(WORKER_IDS[8],resumed)
  check(WORKER_IDS[9],lambda:expect(len(second.get("lists",[]))>=2 and second["lists"][0]["cursor"] is None and second["lists"][-1]["cursor"]==str(len(second["lists"])-1),second.get("lists")))
  # (d) ambiguous outcome: lost response, ownership cannot be proven.
  configure({"create_mode":"lose"});third={}
  def ambiguous():
   third["id"],_=commit()
   row=wait_for(lambda:(lambda r:r if r["state"]=="QUARANTINED" else None)(intent(third["id"])),"ambiguous create not quarantined")
   orphans=ok(f,"provider.orphans.list",{"pool_id":f.pool})
   lost=[k for k,v in provider()["resources"].items() if v["operation_id"]==third["id"]]
   expect(row["failure_code"]=="OWNERSHIP_UNVERIFIED" and row["native_sandbox_id"] is None and len(lost)==1 and any(o["native_sandbox_id"]==lost[0] for o in orphans),(row,orphans))
  check(WORKER_IDS[10],ambiguous)
  def not_replayed():
   time.sleep(2)
   lost=[k for k,v in provider()["resources"].items() if v["operation_id"]==third["id"]]
   s=ok(f,"provider.worker.status",{})
   expect(len(calls("create",third["id"]))==1 and len(lost)==1 and not [c for c in provider()["calls"] if c["method"]=="destroy"] and intent(third["id"])["state"]=="QUARANTINED" and s["intents"].get("QUARANTINED")==1,("ambiguous outcome replayed or cleaned",s))
  check(WORKER_IDS[11],not_replayed)
  def destroyed():
   answer=ok(via,"provider.intents.prepare-destroy",{"run_id":run,"pool_id":f.pool,"sandbox_id":first["sandbox"],"request_key":str(uuid.uuid4()),"deadline_at":utc(),"reason":"simulated teardown of established-ownership resource"})
   did=answer["intent"]["id"];native=intent(first["id"])["native_sandbox_id"]
   try:wait_for(lambda:intent(did)["state"]=="TERMINAL" and intent(first["id"])["state"]=="TERMINAL","destroy not confirmed absent")
   except AssertionError as e:raise AssertionError((str(e),intent(did),intent(first["id"]),ok(f,"provider.worker.status",{})["errors"]))
   expect(native not in provider()["resources"] and f.sql("SELECT observed_state FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2",[org,first["sandbox"]])[0]["observed_state"]=="DESTROYED",provider())
  check(WORKER_IDS[12],destroyed)
  def credentials_isolated():
   status,response=call(via,"provider.simulated.describe",{},"operator",component="8.3-simulated-adapter")
   expect(status>=400 or response.get("ok") is False,"control process exposes provider adapter")
   s=ok(f,"provider.worker.stop",{},"provisioner");expect(s["running"] is False and s["operational_ready"] is False,s)
  check(WORKER_IDS[13],credentials_isolated)
  control.terminate();control.wait(timeout=10);control.stderr.close();control=None
  f.close();f=None;complete=True
 finally:
  if control is not None:control.kill();control.wait()
  if f is not None:
   try:f.close()
   except Exception:complete=False
  shutil.rmtree(folder,ignore_errors=True)
 return complete

def main():
 if sys.argv[1:]==["--inventory"]:print(json.dumps(IDS));return 0
 expect(not sys.argv[1:],"unknown argument")
 f=None;cleanup=False
 def invoke(action,input,key="operator",component="8.3"):
  return f.invoke(action,input,component=component,key=key)
 def result(action,input,key="operator",component="8.3"):
  status,response=invoke(action,input,key,component);expect(status==200 and response.get("ok") is True,(status,response));return response["result"]
 def reject(action,input,code=None,key="operator"):
  status,response=invoke(action,input,key);expect(status>=400 or response.get("ok") is False,(status,response))
  if code:expect(code in json.dumps(response),response)
 def changed(**kwargs):value=copy.deepcopy(request);value.update(kwargs);return value
 try:
  f=pools.ProvisionerFixture(extra_components=["8.2","8.3"],extra_setup=prepare_provider_intent_fixture)
  check(IDS[0],lambda:expect(result("provider.pools.configure",{},component="8.2")["configured"]==1,"actual pool not configured"))
  org=f.ids["organisation"];run=f.ids["run"]
  seed_provider_capacity(f)
  request={"run_id":run,"pool_id":f.pool,"sandbox_id":str(uuid.uuid4()),"request_key":str(uuid.uuid4()),"deadline_at":utc(),"reservation_ids":f.reservations,"profile_id":f.profile,"preparation_digest":f.preparation,"purpose":"PREPARATION"}
  created={}
  def create():
   created.update(result("provider.intents.prepare-create",request));expect(created["created"] is True and created["external_call_performed"] is False,created)
   expect(created["intent"]["operation"]["parameters"]["preparation_reference"]=="fixture-approved-seed","trusted seed not selected")
  check(IDS[1],create)
  iid=created["intent"]["id"]
  check(IDS[2],lambda:expect(f.sql("SELECT state,native_sandbox_id FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,iid])[0]=={"state":"RECORDED","native_sandbox_id":None},"intent not durably recorded before provider effect"))
  check(IDS[3],lambda:expect(len(f.sql("SELECT reservation_id FROM hyperfide.provisioning_intent_reservations WHERE organisation_id=$1 AND run_id=$2 AND intent_id=$3",[org,run,iid]))==4,"scoped capacity links missing"))
  check(IDS[4],lambda:expect(result("provider.intents.prepare-create",request)["created"] is False,"same key duplicated"))
  check(IDS[5],lambda:reject("provider.intents.prepare-create",changed(sandbox_id=str(uuid.uuid4())),"IDEMPOTENCY_CONFLICT"))
  check(IDS[6],lambda:reject("provider.intents.prepare-create",changed(parameters={"runtime_variables":{"SECRET":"forbidden"}}),"INVALID_REQUEST"))
  check(IDS[7],lambda:reject("provider.intents.prepare-create",changed(request_key=str(uuid.uuid4()),reservation_ids=[]),"RESERVATION_REQUIRED"))
  check(IDS[8],lambda:reject("provider.intents.prepare-create",changed(request_key=str(uuid.uuid4()),reservation_ids=[f.reservations[0]]*2),"RESERVATION_INVALID"))
  check(IDS[9],lambda:reject("provider.intents.prepare-create",changed(request_key=str(uuid.uuid4()),deadline_at=utc(-60000)),"PROVIDER_DEADLINE_INVALID"))
  check(IDS[10],lambda:reject("provider.intents.prepare-create",changed(run_id=str(uuid.uuid4())),"AUTH_SCOPE_DENIED"))
  check(IDS[11],lambda:reject("provider.intents.prepare-create",changed(request_key=str(uuid.uuid4()),preparation_digest=sha(b"other")),"PREPARATION_MISMATCH"))
  check(IDS[12],lambda:reject("provider.intents.prepare-create",changed(request_key=str(uuid.uuid4()),purpose="EXECUTION"),"PREPARED_BASE_UNAVAILABLE"))
  check(IDS[13],lambda:reject("provider.intents.execute",{"intent_id":iid},"AUTH_SCOPE_DENIED"))
  def no_adapter():
   reject("provider.intents.execute",{"intent_id":iid},"PROVIDER_UNAVAILABLE","provisioner")
   expect(result("provider.intents.get",{"intent_id":iid})["state"]=="RECORDED","unavailable adapter pretended submission")
  check(IDS[14],no_adapter)
  check(IDS[15],lambda:expect(result("provider.intents.reconcile",{"intent_id":iid},"provisioner")["external_call_performed"] is False,"RECORDED intent executed during reconcile"))
  def crash():
   f.sql("UPDATE hyperfide.provisioning_intents SET state='SUBMITTING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,iid])
   answer=result("provider.intents.execute",{"intent_id":iid},"provisioner")
   expect(answer["executed"] is False and answer["reconciliation_required"] is True,"ambiguous durable submission replayed")
  check(IDS[16],crash)
  def held():
   f.sql("UPDATE hyperfide.provisioning_intents SET state='UNKNOWN',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,iid])
   answer=result("provider.intents.execute",{"intent_id":iid},"provisioner")
   expect(answer["executed"] is False and len(f.sql("SELECT id FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) AND state='PROVISIONING'",[org,run,f.reservations]))==4,"unknown create freed held resources")
  check(IDS[17],held)
  check(IDS[18],lambda:reject("provider.remote.execute-bound",{"argv":["echo","unsafe"]},"TRUSTED_CAPABILITY_ONLY","provisioner"))
  check(IDS[19],lambda:reject("provider.inventory.observe-known",{"sandbox_id":request["sandbox_id"],"boot_generation":"1","native_sandbox_id":"caller-native"},"INVALID_REQUEST","provisioner"))
  sandbox=str(uuid.uuid4());f.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state,preparation_digest) VALUES($1,$2,$3,'fixture-never-worked','RUNNING',$4)",[org,sandbox,f.pool,f.preparation])
  destroy={"run_id":run,"pool_id":f.pool,"sandbox_id":sandbox,"request_key":str(uuid.uuid4()),"deadline_at":utc(),"reason":"owned empty component fixture"}
  check(IDS[20],lambda:expect(result("provider.intents.prepare-destroy",destroy)["created"] is True,"genuinely empty boot refused"))
  check(IDS[21],lambda:expect(result("provider.intents.prepare-destroy",destroy)["created"] is False,"destroy intent duplicated"))
  check(IDS[22],lambda:expect(f.sql("SELECT desired_state FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2",[org,sandbox])[0]["desired_state"]=="DESTROYED","new work admission still allowed"))
  def worked():
   target=str(uuid.uuid4());f.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state,preparation_digest,work_admitted) VALUES($1,$2,$3,$4,'RUNNING',$5,true)",[org,target,f.pool,"fixture-worked-"+target,f.preparation])
   reject("provider.intents.prepare-destroy",{**destroy,"sandbox_id":target,"request_key":str(uuid.uuid4())},"DESTRUCTION_CUSTODY_REQUIRED")
  check(IDS[23],worked)
  def irreversible():
   try:f.sql("UPDATE hyperfide.sandboxes SET work_admitted=false WHERE organisation_id=$1 AND work_admitted",[org])
   except AssertionError:return
   raise AssertionError("boot work admission was reversible")
  check(IDS[24],irreversible)
  check(IDS[25],lambda:expect(result("provider.orphans.list",{"pool_id":f.pool})==[],"orphan reader fabricated live resources"))
  script="import{readConfirmedAbsence}from'./services/hyperfide/dist/providers/reconcile.js';try{await readConfirmedAbsence({},{});throw Error('forged transaction accepted')}catch(e){if(e.code!=='TX_CLOSED')throw e}"
  def branded():
   p=subprocess.run(["node","--input-type=module","-e",script],cwd=ROOT,env=f.env,capture_output=True,text=True,timeout=10);expect(p.returncode==0,p.stderr)
  check(IDS[26],branded)
  check(IDS[27],lambda:expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.provider_observations WHERE organisation_id=$1",[org])[0]["n"]==0,"absence evidence invented without actual provider observation"))
  check(IDS[28],lambda:reject("provider.intents.prepare-create",changed(request_key=str(uuid.uuid4()),sandbox_id=str(uuid.uuid4()),deadline_at=utc()),"RESERVATION_ALREADY_BOUND"))
  parent=f.sql("SELECT manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2",[org,f.profile])[0]["manifest"]
  canonical=lambda value:json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
  policy_script="import fs from 'node:fs';import{approvedProfilePolicyDigest}from'./services/hyperfide/dist/providers/pools.js';process.stdout.write(approvedProfilePolicyDigest(JSON.parse(fs.readFileSync(0,'utf8'))));"
  policy=subprocess.run(["node","--input-type=module","-e",policy_script],input=json.dumps(parent["profile"]),cwd=ROOT,env=f.env,text=True,capture_output=True,timeout=10)
  expect(policy.returncode==0,policy.stderr);parent_policy=policy.stdout
  config_digest=f.sql("SELECT configuration_digest FROM hyperfide.provider_pool_configurations WHERE organisation_id=$1 AND pool_id=$2 AND active",[org,f.pool])[0]["configuration_digest"]
  def child_manifest(escalate=False,v2=False,tamper=False):
   value=copy.deepcopy(parent);value["profile"]["profile_version"]="derived-"+uuid.uuid4().hex[:8]
   if escalate:value["profile"]["resources"]["cpu_millis"]+=1
   if v2:value.update(schema_version=2,symlinks=[],hardlinks=[])
   value.pop("digest");value["digest"]=sha(canonical(value));identity=str(uuid.uuid4())
   if tamper:value["profile"]["profile_version"]="tampered-without-rehash"
   f.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,id,provider,runtime_platform,content_digest,manifest) VALUES($1,$2,'railway','linux-x86_64',$3,$4)",[org,identity,value["digest"],value])
   return identity,value
  def lineage(child,manifest,*,state="QUALIFIED",expired=False,tamper=False,parent_id=None):
   artifacts=[]
   for label in ["source","execution","verification"]:
    raw=("COMPONENT_FIXTURE_LINEAGE_ONLY:"+label+":"+child).encode();digest=sha(raw);aid=str(uuid.uuid4());artifact=f.path/(aid+".proof");artifact.write_bytes(raw)
    f.sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,completed_at) VALUES($1,$2,$3,$4,$5,'COMPONENT_FIXTURE',$6,'COMPLETE',clock_timestamp())",[org,run,aid,digest,str(len(raw)),str(artifact)]);artifacts.append((aid,digest))
   identity={"organisation_id":org,"id":str(uuid.uuid4()),"pool_id":f.pool,"configuration_digest":config_digest,"parent_profile_id":parent_id or f.profile,"parent_preparation_digest":f.preparation,"derived_profile_id":child,"derived_preparation_digest":manifest["digest"],"source_run_id":run,"source_manifest_digest":artifacts[0][1],"source_manifest_artifact_digest":artifacts[0][1],"execution_receipt_artifact_digest":artifacts[1][1],"verification_receipt_artifact_digest":artifacts[2][1],"accepted_policy_digest":parent_policy,"allowed_delta":["source","dependency_pins","build_config_pins"]}
   record={**identity,"lineage_digest":sha(b"tampered-lineage") if tamper else sha(canonical(identity)),"state":state,"observed_at":utc(-120000),"expires_at":utc(-60000 if expired else 60000)}
   columns=list(record)
   f.sql("INSERT INTO hyperfide.provider_profile_lineage("+",".join(columns)+") VALUES("+",".join("$"+str(i+1) for i in range(len(columns)))+")",[json.dumps(record[k]) if k=="allowed_delta" else record[k] for k in columns])
   return record,artifacts
  def select(child,manifest,code):
   reject("provider.intents.prepare-create",changed(request_key=str(uuid.uuid4()),sandbox_id=str(uuid.uuid4()),profile_id=child,preparation_digest=manifest["digest"],deadline_at=utc()),code)
  child,manifest=child_manifest()
  check(IDS[29],lambda:select(child,manifest,"PREPARATION_MISMATCH"))
  row,proofs=lineage(child,manifest)
  check(IDS[30],lambda:select(child,manifest,"RESERVATION_ALREADY_BOUND"))
  def manifest_tamper():
   badid,bad=child_manifest(tamper=True)
   select(badid,bad,"PREPARATION_MISMATCH")
  check(IDS[31],manifest_tamper)
  def escalated():
   cid,body=child_manifest(escalate=True);lineage(cid,body);select(cid,body,"PREPARATION_MISMATCH")
  check(IDS[32],escalated)
  def stale():
   cid,body=child_manifest();lineage(cid,body,state="STALE");select(cid,body,"PREPARATION_MISMATCH")
  check(IDS[33],stale)
  def expired():
   cid,body=child_manifest();lineage(cid,body,expired=True);select(cid,body,"PREPARATION_MISMATCH")
  check(IDS[34],expired)
  def hash_tamper():
   cid,body=child_manifest();lineage(cid,body,tamper=True);select(cid,body,"PREPARATION_MISMATCH")
  check(IDS[35],hash_tamper)
  def lost_custody():
   f.sql("UPDATE hyperfide.artifacts SET status='QUARANTINED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,proofs[1][0]])
   select(child,manifest,"PREPARATION_MISMATCH")
  check(IDS[36],lost_custody)
  def parent_binding():
   cid,body=child_manifest();other,_=child_manifest();lineage(cid,body,parent_id=other);select(cid,body,"PREPARATION_MISMATCH")
  check(IDS[37],parent_binding)
  def v2_body():
   cid,body=child_manifest(v2=True);lineage(cid,body);select(cid,body,"RESERVATION_ALREADY_BOUND")
  check(IDS[38],v2_body)
  def immutable_lineage():
   try:f.sql("UPDATE hyperfide.provider_profile_lineage SET source_manifest_digest=$3 WHERE organisation_id=$1 AND id=$2",[org,row["id"],sha(b"rewrite")])
   except AssertionError:return
   raise AssertionError("lineage proof identity was rewritten")
  check(IDS[39],immutable_lineage)

  capture_ids=["provider.capture.stream-pair-framing","provider.capture.actual-ordered-framing","provider.capture.exact-byte-count","provider.capture.exact-output-hash","provider.capture.exact-spool-hash","provider.capture.contiguous-coverage","provider.capture.actual-range-hash","provider.capture.explicit-scheme","provider.process.terminal-absorbing","provider.process.terminal-conflict","provider.process.terminal-identical","provider.capture.immutable-byte-copy"]
  capture_script=r"""
import{createHash}from'node:crypto';
import{verifyCapturedProviderOutput,processObservationDisposition}from'./services/hyperfide/dist/providers/reconcile.js';
import{digestDocument}from'./services/hyperfide/dist/providers/pools.js';
const ids=JSON.parse(process.env.HF_CAPTURE_ASSERTIONS),stdout=Buffer.from('abCD'),stderr=Buffer.from('!');
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
let failed=false;const assert=(v,m)=>{if(!v)throw Error(m)},clone=v=>structuredClone(v);
const check=(n,f)=>{try{f();console.log(JSON.stringify({type:'assertion',id:ids[n],expected:'observed',actual:'observed'}))}catch(e){failed=true;console.log(JSON.stringify({type:'assertion',id:ids[n],expected:'observed',actual:String(e)}))}};
const reject=f=>{try{f()}catch(e){if(!['REMOTE_CAPTURE_MISMATCH','REMOTE_OUTPUT_INCOMPLETE','INVALID_REQUEST'].includes(e.code))throw e;return}throw Error('invalid capture accepted')};
const result={process_ref:'logical',phase:'EXITED',exit_code:0,timed_out:false,termination_confirmed:true,output:{complete:true,truncated:false,byte_count:'5',sha256:digestDocument({stdout:sha(stdout),stderr:sha(stderr)})}};
const capture={stdout,stderr,exit_code:0,complete:true,spool_digest:sha(Buffer.from('private provider receipt is a distinct identity')),capture:{schema_version:1,scheme:'STREAM_DIGESTS_CANONICAL_JSON'}};
const ordered=clone(capture);ordered.capture={schema_version:1,scheme:'ORDERED_CHUNKS_SHA256',chunks:[{stream:'stdout',offset_bytes:'0',size_bytes:'2',digest:sha(stdout.subarray(0,2))},{stream:'stderr',offset_bytes:'0',size_bytes:'1',digest:sha(stderr)},{stream:'stdout',offset_bytes:'2',size_bytes:'2',digest:sha(stdout.subarray(2))}]};
ordered.spool_digest=sha(Buffer.from('ab!CD'));const orderedResult=clone(result);orderedResult.output.sha256=ordered.spool_digest;
check(0,()=>assert(verifyCapturedProviderOutput(result,capture).stdout.length===4,'actual stream digest framing failed'));
check(1,()=>assert(verifyCapturedProviderOutput(orderedResult,ordered).stderr.length===1,'actual interleaving proof failed'));
check(2,()=>{const r=clone(result);r.output.byte_count='6';reject(()=>verifyCapturedProviderOutput(r,capture))});
check(3,()=>{const r=clone(result);r.output.sha256=sha(Buffer.from('different bytes'));reject(()=>verifyCapturedProviderOutput(r,capture))});
check(4,()=>{const c=clone(ordered);c.spool_digest=sha(Buffer.from('different global order'));reject(()=>verifyCapturedProviderOutput(orderedResult,c))});
check(5,()=>{const c=clone(ordered);c.capture.chunks[2].offset_bytes='1';reject(()=>verifyCapturedProviderOutput(orderedResult,c))});
check(6,()=>{const c=clone(ordered);c.capture.chunks[0].digest=sha(Buffer.from('forged'));reject(()=>verifyCapturedProviderOutput(orderedResult,c))});
check(7,()=>{const c=clone(capture);delete c.capture;reject(()=>verifyCapturedProviderOutput(result,c))});
const terminal={status:'SUCCEEDED',observed_at:new Date().toISOString(),result:clone(result)};
check(8,()=>{const started=clone(terminal);started.result.phase='STARTED';started.observed_at=new Date(Date.now()+1).toISOString();assert(processObservationDisposition(terminal,started)==='IGNORE','terminal process regressed to RUNNING')});
check(9,()=>{const conflicting=clone(terminal);conflicting.result.exit_code=7;assert(processObservationDisposition(terminal,conflicting)==='CONFLICT','contradictory terminal exit accepted')});
check(10,()=>assert(processObservationDisposition(terminal,clone(terminal))==='IGNORE','identical terminal replay changed completion'));
check(11,()=>{const c=clone(capture),verified=verifyCapturedProviderOutput(result,c);c.stdout[0]=0;assert(verified.stdout[0]===97,'caller mutation changed verified capture bytes')});
process.exitCode=failed?1:0;
"""
  probe=subprocess.run(["node","--input-type=module","-e",capture_script],cwd=ROOT,env={**f.env,"HF_CAPTURE_ASSERTIONS":json.dumps(capture_ids)},capture_output=True,text=True,timeout=20)
  print(probe.stdout,end="",flush=True)
  if probe.returncode:FAILED.append("provider.capture.actual-verifier");print(probe.stderr,file=sys.stderr)
  def recipe_policy():
   value=copy.deepcopy(parent);value["profile"]["profile_version"]="recipe-policy-change";value["profile"]["recipe"]["digest"]=sha(b"changed-approved-preparation-policy");value.pop("digest");value["digest"]=sha(canonical(value));cid=str(uuid.uuid4())
   f.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,id,provider,runtime_platform,content_digest,manifest) VALUES($1,$2,'railway','linux-x86_64',$3,$4)",[org,cid,value["digest"],value]);lineage(cid,value);select(cid,value,"PREPARATION_MISMATCH")
  check(IDS[52],recipe_policy)


  accounting_ids=["provider.accounting.installs-actual-reader","provider.accounting.unproven-absence-held","provider.accounting.teardown-unregisters","provider.accounting.provisioner-refused","provider.accounting.no-provider-effects"]
  f.sql("UPDATE hyperfide.reservations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,f.reservations[0]])
  accounting_script=r"""
import assert from 'node:assert/strict';
import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';
import {createProviderDatabase} from './services/hyperfide/dist/providers/pools.js';
import {createComponent as providerComponent,createAccountingComponent} from './services/hyperfide/dist/providers/reconcile.js';
import {createComponent as schedulerComponent} from './services/hyperfide/dist/scheduler/resources.js';
const c=JSON.parse(process.env.HF_ACCOUNTING_CONTEXT),controller=new AbortController();
const startup={role:'control',policy:c.policy,env:process.env,signal:controller.signal},resources=createResourceContainer(startup),instances=new Map();
const context={...startup,resources,dependencies:{require(id,name,validate){const v=instances.get(id)?.capabilities?.[name];assert(validate(v),'actual dependency unavailable');return v}}};
let provider,scheduler,bridge;const results={};
try{
 instances.set('8.2',{capabilities:{'provider.pools.v1':createProviderDatabase(context)}});
 provider=providerComponent(context);instances.set('8.3',provider);
 scheduler=schedulerComponent(context);instances.set('5.4',scheduler);
 const cap=scheduler.capabilities['scheduler.resources.v1'],intents=provider.capabilities['provider.intents.v1'];
 bridge=createAccountingComponent(context);
 assert.throws(()=>cap.registerProofReader('provider.absence',intents.readConfirmedAbsence),e=>e.code==='DUPLICATE_PROOF_READER');
 results['provider.accounting.installs-actual-reader']=true;
 await assert.rejects(()=>resources.gateway.withPrimaryTransaction({timeoutMs:5000},tx=>cap.release(tx,{organisation_id:c.org,run_id:c.run,reservation_ids:[c.reservation]})),e=>e.code==='QUIESCENCE_UNCONFIRMED');
 results['provider.accounting.unproven-absence-held']=true;
 const describe=bridge.actions['provider.accounting.describe']({},context);
 assert.equal(describe.authority,'NONE');assert.equal(describe.provider_execution_available,false);assert.equal(Object.keys(bridge.actions).length,1);
 results['provider.accounting.no-provider-effects']=true;
 bridge.close();bridge.close();
 assert.throws(()=>bridge.actions['provider.accounting.describe']({},context),e=>e.code==='PROVIDER_CLOSED');
 const unregister=cap.registerProofReader('provider.absence',intents.readConfirmedAbsence);unregister();
 await assert.rejects(()=>resources.gateway.withPrimaryTransaction({timeoutMs:5000},tx=>cap.release(tx,{organisation_id:c.org,run_id:c.run,reservation_ids:[c.reservation]})),e=>e.code==='DEPENDENCY_UNAVAILABLE');
 results['provider.accounting.teardown-unregisters']=true;
 assert.throws(()=>createAccountingComponent({...context,role:'provisioner'}),e=>e.code==='ROLE_FORBIDDEN');
 results['provider.accounting.provisioner-refused']=true;
 console.log(JSON.stringify(results));
}finally{await bridge?.close?.();await scheduler?.close?.();await provider?.close?.();await resources.close();}
"""
  env={**f.env,"HF_ACCOUNTING_CONTEXT":json.dumps({"policy":json.loads(f.policy.read_text()),"org":org,"run":run,"reservation":f.reservations[0]})}
  accounting=subprocess.run(["node","--input-type=module","-e",accounting_script],cwd=ROOT,env=env,capture_output=True,text=True,timeout=30)
  try:accounting_result=json.loads(accounting.stdout) if accounting.returncode==0 else {}
  except Exception:accounting_result={}
  for name in accounting_ids:check(name,lambda name=name:expect(accounting_result.get(name) is True,accounting.stderr or accounting.stdout))
  expect(f.sql("SELECT state FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,f.reservations[0]])[0]["state"]=="RELEASE_PENDING","unproven absence released physical capacity")

  def missing_adapter():
   s=result("provider.worker.status",{})
   expect(s["operational_ready"] is False and s["pools"][0]["adapter_registered"] is False and s["pools"][0]["reason"]=="PROVIDER_ADAPTER_MISSING",s)
  check("provider.worker.missing-adapter-not-ready",missing_adapter)
  def missing_adapter_idle():
   f.sql("UPDATE hyperfide.provisioning_intents SET state='RECORDED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,iid])
   expect(result("provider.worker.start",{},"provisioner")["operational_ready"] is False,"worker without adapter reported ready")
   time.sleep(1);s=result("provider.worker.stop",{},"provisioner")
   expect(s["counters"]["claimed"]==0 and result("provider.intents.get",{"intent_id":iid})["state"]=="RECORDED","worker submitted without a trusted adapter")
  check("provider.worker.missing-adapter-no-submission",missing_adapter_idle)
  f.close();f=None
  cleanup=worker_composition(check)
 finally:
  if f is not None:f.close()
  print(json.dumps({"type":"cleanup","resources":[],"complete":cleanup}),flush=True)
 return 1 if FAILED or not cleanup else 0
if __name__=="__main__":sys.exit(main())
