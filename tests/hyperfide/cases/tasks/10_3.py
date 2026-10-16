#!/usr/bin/env python3
"""Real registered contracts + pinned sandbox-api byte/EOF behavior. No cloud acceptance."""
import atexit,base64,copy,ctypes,hashlib,importlib.util,json,os,pathlib,shlex,shutil,select,signal,socket,subprocess,sys,tempfile,time,urllib.request,uuid
ROOT=pathlib.Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("blaxel_images",pathlib.Path(__file__).with_name("10_1.py"));images=importlib.util.module_from_spec(s);s.loader.exec_module(images)
IDS=[];FAILED=[]
def expect(v,m="assertion failed"):
 if not v:raise AssertionError(m)
def check(name,fn):
 identity="blaxel.process."+name;IDS.append(identity)
 try:fn();actual="observed"
 except Exception as e:actual=type(e).__name__+": "+str(e);FAILED.append(identity)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def canon(v):return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False)
def dg(v):return "sha256:"+hashlib.sha256((v if isinstance(v,bytes)else canon(v).encode())).hexdigest()
def scope():return {"organisation_id":"org","pool_id":"pool","provider":"blaxel","provider_account_id":"account","environment_id":"workspace","region":"us-pdx-1","configuration_digest":"sha256:"+"a"*64}
def operation(kind="execute"):
 p={"argv":["node","-e","process.stdout.write(Buffer.from([0,255,65]));process.stderr.write('stderr');"],"cwd":"/tmp","env_refs":{},"stdin":False,"durable":False,"process_timeout_ms":None,"wait_timeout_ms":5000}
 if kind=="create":p={"preparation_reference":"sandbox/coding:"+"d"*64,"resources":{"cpu_millis":2000,"memory_bytes":"4294967296","disk_bytes":"1073741824","persistent_volume_bytes":"0"},"network":"ISOLATED","stdin_required":False}
 body={"kind":kind,"scope":scope(),"deadline_at":"2030-01-01T00:00:00.000Z","resource":None if kind=="create"else{"native_sandbox_id":"hf-component-fixture","sandbox_boot_generation":"1"},"preparation_digest":"sha256:"+"b"*64,"parameters":p}
 return {"schema_version":1,**body,"identity":{"operation_id":str(uuid.uuid4()),"idempotency_key":str(uuid.uuid4()),"payload_digest":dg(body),"correlation_id":str(uuid.uuid4()),"causation_id":str(uuid.uuid4())}}
def rehash(o):
 o["identity"]["payload_digest"]=dg({k:o[k]for k in ["kind","scope","deadline_at","resource","preparation_digest","parameters"]});return o
def lifetime():return {"schema_version":1,"run_seconds":259200,"checkpoint_lead_seconds":300,"termination_grace_seconds":30,"api_wait_seconds":30,"process":{"keep_alive":True,"timeout_seconds":0},"expiration_policies":[],"runtime_ttl":None,"runtime_expires_at":None}
def prepared(o):
 return {"qualification_status":"QUALIFIED","preparation_digest":o["preparation_digest"],"provider_prepared_digest":"sha256:"+"d"*64,"preparation_reference":o["parameters"]["preparation_reference"],"scope":o["scope"],"resources":o["parameters"]["resources"],"lifecycle":lifetime(),"network_mode":"ISOLATED","network":{"egress":{"mode":"deny"}},"volumes":[],"runtime_extra_args":{}}
identity_spec=importlib.util.spec_from_file_location("blaxel_identity",ROOT/"tests/hyperfide/support/identity_fixture.py");identity=importlib.util.module_from_spec(identity_spec);identity_spec.loader.exec_module(identity)
class Fixture:
 def __init__(self,base,root_component="10.3"):
  self.base=base;self.root_component=root_component;self.auth=None;added=set()
  def add(name):
   if name in added:return
   d=json.loads((ROOT/f"services/hyperfide/components/{name}.json").read_text())
   for dep in d["requires"]:add(dep)
   added.add(name)
  add(root_component)
  secret_root=base/"secrets";attachment_root=base/"attachments";secret_root.mkdir(mode=0o700);attachment_root.mkdir(mode=0o700)
  credential_config=base/"credentials.json";credential_config.write_text(json.dumps({"schema_version":1,"secret_root":str(secret_root),"attachment_root":str(attachment_root),"sources":[],"targets":[]}));credential_config.chmod(0o600)
  self.auth=identity.IdentityFixture(service_role="provisioner",extra_components=sorted(added),extra_env={"HF_CREDENTIAL_CONFIG_FILE":str(credential_config)})
  atexit.register(self.close)
 def close(self):
  if self.auth:
   auth=self.auth;self.auth=None;auth.close()
 def call(self,action,data):
  kind="process"if self.root_component=="10.3"else"recovery"
  status,result=self.auth.invoke("blaxel."+kind+"."+action,data,component=self.root_component,key="provisioner")
  return result
 def good(self,action,data):
  row=self.call(action,data);expect(row.get("ok"),json.dumps(row));return row["result"]
 def bad(self,action,data,code=None):
  row=self.call(action,data);expect(not row.get("ok"),json.dumps(row))
  if code:expect(row["error"]["code"]==code,json.dumps(row))
def reap():
 deadline=time.monotonic()+5
 while True:
  children=pathlib.Path("/proc/self/task/"+str(os.getpid())+"/children").read_text().split()
  for child in children:
   try:os.kill(int(child),signal.SIGKILL)
   except ProcessLookupError:pass
  try:
   pid,_=os.waitpid(-1,os.WNOHANG)
   if pid:continue
  except ChildProcessError:return True
  if time.monotonic()>deadline:return False
  time.sleep(.01)


def capture_deadline():
 script="import assert from 'node:assert/strict';import{blaxelCaptureControl,boundedBlaxelOperation}from './services/hyperfide/dist/providers/blaxel/processes.js';const op=OPERATION;op.deadline_at=new Date(Date.now()+150).toISOString();const c=new AbortController(),r=new AbortController(),i=new AbortController(),control=blaxelCaptureControl(op,c.signal,r.signal,i.signal);const started=Date.now();await boundedBlaxelOperation(()=>new Promise(ok=>setTimeout(ok,90)),control.signal,control.deadline);await assert.rejects(boundedBlaxelOperation(()=>new Promise(ok=>setTimeout(ok,90)),control.signal,control.deadline),e=>e.code==='BLAXEL_OPERATION_UNAVAILABLE');assert(Date.now()-started<280);const fresh=blaxelCaptureControl({...op,deadline_at:new Date(Date.now()+5000).toISOString()},c.signal,r.signal,i.signal);const cancelled=boundedBlaxelOperation(()=>new Promise(()=>{}),fresh.signal,fresh.deadline);r.abort();await assert.rejects(cancelled,e=>e.code==='BLAXEL_OPERATION_UNAVAILABLE');let called=false;const expired=blaxelCaptureControl({...op,deadline_at:new Date(Date.now()-1000).toISOString()},c.signal,new AbortController().signal,i.signal);await assert.rejects(boundedBlaxelOperation(async()=>{called=true},expired.signal,expired.deadline));assert(!called);"
 script=script.replace('OPERATION',json.dumps(operation()),1)
 result=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,capture_output=True,text=True,timeout=5)
 expect(result.returncode==0,result.stderr)

def pure_isolation():
 script="import assert from 'node:assert/strict';\nimport {createHash,randomUUID} from 'node:crypto';\nimport {createBlaxelIsolationTransport} from './services/hyperfide/dist/providers/blaxel/processes.js';\nimport {validateProviderOutcome} from './services/hyperfide/dist/providers/contract.js';\nconst scope={organisation_id:'org',pool_id:'pool',provider:'blaxel',provider_account_id:'account',environment_id:'workspace',region:'us-pdx-1',configuration_digest:'sha256:'+'a'.repeat(64)};\nconst ctx={env:{HF_BLAXEL_ACCOUNT_ID:'account',HF_BLAXEL_WORKSPACE:'workspace'},signal:new AbortController().signal},t=createBlaxelIsolationTransport(scope,ctx);\nassert.equal(typeof t.destroy,'function');assert.equal(typeof t.observe,'function');\nfor(const key of ['provider_account_id','environment_id'])assert.throws(()=>createBlaxelIsolationTransport({...scope,[key]:'other'},ctx),e=>e.code==='BLAXEL_PROCESS_INVALID');\nconst canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';\nfor(const kind of ['destroy','observe']){const body={kind,scope,deadline_at:new Date(Date.now()+10000).toISOString(),resource:{native_sandbox_id:'hf-isolation-negative',sandbox_boot_generation:'1'},preparation_digest:'sha256:'+'b'.repeat(64),parameters:kind==='destroy'?{reason:'owned qualification negative'}:{}};const op={schema_version:1,...body,identity:{operation_id:randomUUID(),idempotency_key:randomUUID(),payload_digest:'sha256:'+createHash('sha256').update(canonical(body)).digest('hex'),correlation_id:randomUUID(),causation_id:randomUUID()}};const result=await t[kind](op);assert.equal(result.status,'UNKNOWN');assert.equal(result.result,null);validateProviderOutcome({operation:op,outcome:result});}\nconsole.log(JSON.stringify({pure_factory:true,minimal_context_keys:Object.keys(ctx),wrong_account_workspace_refused:true,missing_credentials_never_absence:true,database_used:false}));"
 env=os.environ.copy();env.pop('DATABASE_URL',None)
 r=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,env=env,capture_output=True,text=True,timeout=10)
 expect(r.returncode==0,r.stderr)
 proof=json.loads(r.stdout);expect(proof['pure_factory']and not proof['database_used'])

def main():
 check("isolation.actual-pure-env-signal-no-database",pure_isolation)
 check("capture.actual-shared-deadline-and-cancellation",capture_deadline)
 expect(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0)
 cleanup=True;daemon=None;names=[];spools=[]
 with tempfile.TemporaryDirectory(prefix="hyperfide-blaxel-process-")as td:
  b=pathlib.Path(td);f=Fixture(b)
  check("service.registered",lambda:expect(f.good("describe",{})["adapter_registered"]))
  def plan():
   o=operation();r=f.good("plan",{"operation":o});p=r["request"]
   expect(p["keepAlive"]is True and p["timeout"]==0 and p["stdin"]is False and p["waitForCompletion"]is False and p["restartOnFailure"]is False)
   expect(r["authority"]=="NONE");expect("HF_BLAXEL_API_KEY"not in canon(r))
  check("plan.explicit-process-options",plan)
  def stable():
   o=operation();a=f.good("plan",{"operation":o});expect(f.good("plan",{"operation":o})==a)
   o["resource"]["sandbox_boot_generation"]="2";rehash(o);expect(f.good("plan",{"operation":o})["process_ref"]!=a["process_ref"])
  check("plan.stable-identity-and-boot-fencing",stable)
  def bad_timeout():
   o=operation();o["parameters"]["process_timeout_ms"]=1501;rehash(o);f.bad("plan",{"operation":o},"BLAXEL_RESOURCE_UNSUPPORTED")
  check("reject.fractional-provider-timeout",bad_timeout)
  def raw_secret():
   o=operation();o["parameters"]["env_refs"]={"API_KEY":"plain-secret"};rehash(o);f.bad("plan",{"operation":o})
  check("reject.inline-credentials",raw_secret)
  def tampered():
   o=operation();o["parameters"]["argv"].append("changed");f.bad("plan",{"operation":o})
  check("reject.payload-mutation",tampered)
  def create():
   o=operation("create");base=prepared(o);p=f.good("create-plan",{"operation":o,"boot_generation":"1","base":base})["plan"]
   actual={**copy.deepcopy(p),"status":"DEPLOYED"};actual["metadata"]["workspace"]="workspace"
   r=f.good("verify-create",{"observation":actual,"expected":p,"scope":o["scope"]});expect(r["matches"]and r["authority"]=="NONE")
  check("create.exact-config-verification",create)
  for key in ["image","memory","terminationGracePeriodSeconds"]:
   def mismatch(key=key):
    o=operation("create");p=f.good("create-plan",{"operation":o,"boot_generation":"1","base":prepared(o)})["plan"]
    actual={**copy.deepcopy(p),"status":"DEPLOYED"};actual["metadata"]["workspace"]="workspace";actual["spec"]["runtime"][key]="different"
    f.bad("verify-create",{"observation":actual,"expected":p,"scope":o["scope"]},"BLAXEL_CREATE_CONFLICT")
   check("create.reject-runtime-"+key,mismatch)
  def external():
   o=operation("create");p=f.good("create-plan",{"operation":o,"boot_generation":"1","base":prepared(o)})["plan"]
   actual={**copy.deepcopy(p),"status":"DEPLOYED"};actual["metadata"]["workspace"]="workspace";actual["metadata"]["externalId"]="same-external-id";actual["metadata"]["labels"]={}
   f.bad("verify-create",{"observation":actual,"expected":p,"scope":o["scope"]},"BLAXEL_CREATE_CONFLICT")
  check("create.external-id-not-ownership",external)
  def replaced():
   o=operation("create");p=f.good("create-plan",{"operation":o,"boot_generation":"1","base":prepared(o)})["plan"]
   actual={**copy.deepcopy(p),"status":"FAILED"};actual["metadata"]["workspace"]="workspace"
   f.bad("verify-create",{"observation":actual,"expected":p,"scope":o["scope"]},"BLAXEL_CREATE_CONFLICT")
  check("create.failed-instance-not-replaced",replaced)
  def vector():
   o=operation("create");o["parameters"]["resources"]["cpu_millis"]=1000;rehash(o)
   f.bad("create-plan",{"operation":o,"boot_generation":"1","base":prepared(o)},"BLAXEL_RESOURCE_UNSUPPORTED")
  check("create.reject-silent-cpu-memory-change",vector)
  def wrong_artifact():
   o=operation("create");base=prepared(o);base["provider_prepared_digest"]="sha256:"+"e"*64
   f.bad("create-plan",{"operation":o,"boot_generation":"1","base":base},"BLAXEL_PREPARATION_MISMATCH")
  check("create.reject-provider-artifact-tag-digest-mismatch",wrong_artifact)


  def retained_mismatch():
   o=operation("create");plan=f.good("create-plan",{"operation":o,"boot_generation":"1","base":prepared(o)})["plan"]
   script="import assert from 'node:assert/strict';import fs from 'node:fs';import{retainBlaxelCreateCandidate}from './services/hyperfide/dist/providers/blaxel/processes.js';const plan="+json.dumps(plan)+";const scope="+json.dumps(o["scope"])+";const record="+json.dumps(str(b/"persisted-candidate"))+";for(const field of['name','workspace','region','status']){const actual=structuredClone(plan);actual.status='DEPLOYED';actual.metadata.workspace='workspace';if(field==='name')actual.metadata.name='hf-actual-unexpected';else if(field==='workspace')actual.metadata.workspace='different';else if(field==='region')actual.spec.region='different';else actual.status='FAILED';let known=null;await assert.rejects(retainBlaxelCreateCandidate(actual,plan,scope,'1',r=>{known=r},async name=>{const fd=fs.openSync(record,'w',384);fs.writeFileSync(fd,name);fs.fsyncSync(fd);fs.closeSync(fd);return{native_sandbox_id:name,sandbox_boot_generation:'1'}}),e=>e.code==='BLAXEL_CREATE_CONFLICT');assert.equal(known.native_sandbox_id,actual.metadata.name);assert.equal(fs.readFileSync(record,'utf8'),actual.metadata.name);}const actual=structuredClone(plan);actual.metadata.workspace='workspace';let known=null;await assert.rejects(retainBlaxelCreateCandidate(actual,plan,scope,'1',r=>{known=r},async name=>{await fs.promises.writeFile(record+'/missing',name);return{native_sandbox_id:name,sandbox_boot_generation:'1'}}));assert.equal(known.native_sandbox_id,actual.metadata.name);"
   row=subprocess.run(["node","--input-type=module","-e",script],cwd=ROOT,capture_output=True,text=True,timeout=10);expect(row.returncode==0,row.stderr)
  check("create.actual-candidate-persisted-before-validation",retained_mismatch)

  binary=b/"sandbox-api"
  with urllib.request.urlopen(images.RELEASE,timeout=60)as stream:content=stream.read()
  expect(hashlib.sha256(content).hexdigest()==images.RELEASE_SHA);binary.write_bytes(content);binary.chmod(0o700)
  with socket.socket()as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
  home=b/"api";home.mkdir();env=os.environ.copy();env["HOME"]=str(home);node_path=subprocess.check_output(["node","-p","process.execPath"],text=True,cwd=ROOT).strip();env["PATH"]=str(pathlib.Path(node_path).parent)+os.pathsep+env.get("PATH","")
  daemon=subprocess.Popen([str(binary),"-port",str(port),"-disable-telemetry"],cwd=home,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
  def request(method,path,data=None,raw=False):
   body=data if raw else None if data is None else json.dumps(data).encode()
   with urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}"+path,data=body,method=method,headers={"Content-Type":"application/octet-stream"if raw else"application/json"}),timeout=5)as r:
    data=r.read();return json.loads(data)if data else{}
  def terminal(ref):
   deadline=time.monotonic()+8
   while time.monotonic()<deadline:
    r=request("GET","/process/"+ref)
    if r["status"]!="running":return r
    time.sleep(.03)
   raise AssertionError("actual native process did not exit")
  try:
   for _ in range(100):
    try:request("GET","/health");break
    except Exception:
     if daemon.poll()is not None:raise AssertionError("sandbox-api failed")
     time.sleep(.05)
   else:raise AssertionError("sandbox-api health unavailable")
   actual_capture={}
   def capture():
    o=operation();p=f.good("plan",{"operation":o});names.append(p["process_ref"]);spools.append(pathlib.Path(p["spool_path"]))
    request("POST","/process",p["request"]);row=terminal(p["process_ref"]);expect(row["exitCode"]==0,json.dumps(row))
    path=pathlib.Path(p["spool_path"]);receipt=json.loads((path/"receipt.json").read_text());out=(path/"stdout").read_bytes();err=(path/"stderr").read_bytes()
    expect(out==bytes([0,255,65])and err==b"stderr")
    q={"receipt":receipt,"stdout_base64":base64.b64encode(out).decode(),"stderr_base64":base64.b64encode(err).decode(),"scope":o["scope"],"resource":o["resource"],"process_ref":p["process_ref"],"expected":{"operation_id":o["identity"]["operation_id"],"payload_digest":o["identity"]["payload_digest"],"launch_digest":p["launch_digest"],"spool_path":p["spool_path"],"scope_digest":dg(o["scope"])},"max_bytes":16*1024*1024}
    r=f.good("capture-validate",q);expect(r["complete"]and r["exit_code"]==0 and r["byte_count"]==9 and r["authority"]=="NONE");actual_capture.update(q)
   check("capture.actual-binary-stdout-stderr-and-receipt",capture)
   def overflow():
    marker=b/"overflow-completed";o=operation();o["parameters"]["argv"]=["node","-e","process.stdout.write(Buffer.alloc(17*1024*1024,65));require('node:fs').writeFileSync("+json.dumps(str(marker))+",'completed')"];rehash(o);plan=f.good("plan",{"operation":o});names.append(plan["process_ref"]);spools.append(pathlib.Path(plan["spool_path"]))
    request("POST","/process",plan["request"]);row=terminal(plan["process_ref"]);receipt=json.loads((pathlib.Path(plan["spool_path"])/"receipt.json").read_text())
    expect(row["exitCode"]==0 and marker.read_text()=="completed","output cap killed process");expect(receipt["truncated"]is True and receipt["complete"]is False);expect(receipt["stdout_size"]+receipt["stderr_size"]<=16*1024*1024)
   check("capture.actual-limit-does-not-kill-job",overflow)
   def escaped():
    marker=b/"escaped-pid";o=operation();o["parameters"]["argv"]=["node","-e","const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{detached:true,stdio:'ignore'});require('node:fs').writeFileSync("+json.dumps(str(marker))+",String(c.pid));c.unref()"];rehash(o);plan=f.good("plan",{"operation":o});names.append(plan["process_ref"]);spools.append(pathlib.Path(plan["spool_path"]))
    request("POST","/process",plan["request"]);row=terminal(plan["process_ref"]);receipt=json.loads((pathlib.Path(plan["spool_path"])/"receipt.json").read_text());expect(row["exitCode"]==125 and receipt["exit_code"]==0,"escaped child got clean API success")
    try:os.kill(int(marker.read_text()),0)
    except ProcessLookupError:return
    raise AssertionError("escaped descendant remains alive")
   check("capture.actual-escaped-descendant-reaped-no-false-success",escaped)
   def captured_stdin():
    o=operation();o["parameters"].update(stdin=True,argv=["node","-e","let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(s));"]);rehash(o);plan=f.good("plan",{"operation":o});names.append(plan["process_ref"]);spools.append(pathlib.Path(plan["spool_path"]))
    request("POST","/process",plan["request"]);request("POST","/process/"+plan["process_ref"]+"/stdin",b"one-",True);request("POST","/process/"+plan["process_ref"]+"/stdin",b"two",True);request("DELETE","/process/"+plan["process_ref"]+"/stdin");row=terminal(plan["process_ref"])
    expect(row["exitCode"]==0 and (pathlib.Path(plan["spool_path"])/"stdout").read_bytes()==b"one-two")
   check("stdin.actual-captured-pipe-through-supervisor",captured_stdin)

   def bad_capture(change):
    expect(actual_capture,"capture fixture unavailable");q=copy.deepcopy(actual_capture);change(q);f.bad("capture-validate",q,"BLAXEL_CAPTURE_UNAVAILABLE")
   check("capture.reject-output-tampering",lambda:bad_capture(lambda q:q.update(stdout_base64="dGFtcGVyZWQ=")))
   check("capture.reject-other-boot",lambda:bad_capture(lambda q:q["resource"].update(sandbox_boot_generation="2")))
   check("capture.reject-other-process",lambda:bad_capture(lambda q:q.update(process_ref="hf-other")))
   check("capture.reject-incomplete",lambda:bad_capture(lambda q:q["receipt"].update(complete=False)))
   check("capture.reject-byte-limit",lambda:bad_capture(lambda q:q.update(max_bytes=1)))
   def lock():
    expect(actual_capture);p=pathlib.Path(actual_capture["expected"]["spool_path"]);before=(p/"stdout").read_bytes()
    # Run the same immutable supervisor command under another API name: its wx
    # launch lock refuses a second child rather than re-executing argv.
    op=operation();op["identity"]["operation_id"]=actual_capture["expected"]["operation_id"];op["identity"]["payload_digest"]=actual_capture["expected"]["payload_digest"]
    # Original full command was retained by the actual API.
    original=request("GET","/process/"+actual_capture["process_ref"]);newname="hf-replay-"+uuid.uuid4().hex[:16];names.append(newname)
    request("POST","/process",{"name":newname,"command":original["command"],"workingDir":"/tmp","keepAlive":True,"timeout":5,"waitForCompletion":False})
    row=terminal(newname);expect(row["exitCode"]!=0);expect((p/"stdout").read_bytes()==before)
   check("launch.actual-spool-lock-refuses-replay",lock)
   def eof():
    ref="hf-eof-"+uuid.uuid4().hex[:16];names.append(ref)
    command="node -e "+shlex.quote("process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('EOF'));")
    request("POST","/process",{"name":ref,"command":command,"workingDir":"/tmp","keepAlive":True,"timeout":5,"waitForCompletion":False})
    row=terminal(ref);expect(row["exitCode"]==0 and row["stdout"]=="EOF",json.dumps(row))
   check("stdin.actual-default-eof",eof)
   def partial():
    ref="hf-stdin-"+uuid.uuid4().hex[:16];names.append(ref)
    command="node -e "+shlex.quote("let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(s));")
    request("POST","/process",{"name":ref,"command":command,"workingDir":"/tmp","stdin":True,"keepAlive":True,"timeout":5,"waitForCompletion":False})
    request("POST","/process/"+ref+"/stdin",b"prefix-",True);request("POST","/process/"+ref+"/stdin",b"suffix",True);request("DELETE","/process/"+ref+"/stdin")
    row=terminal(ref);expect(row["stdout"]=="prefix-suffix"and row["exitCode"]==0,json.dumps(row))
   check("stdin.actual-segmented-byte-writes-and-eof",partial)

   def disconnect_post(path,body,accepted):
    # Real TCP disconnect after delivery, with no HTTP response consumed.
    wire=socket.create_connection(("127.0.0.1",port),timeout=5)
    wire.sendall(("POST "+path+" HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/octet-stream\r\nContent-Length: "+str(len(body))+"\r\nConnection: close\r\n\r\n").encode()+body)
    deadline=time.monotonic()+4
    while not accepted()and time.monotonic()<deadline:time.sleep(.02)
    expect(accepted(),"actual delivery was not observed before disconnect")
    wire.close()
   def launch_lost_response():
    marker=b/"lost-launch";ref="hf-lost-launch-"+uuid.uuid4().hex[:16];names.append(ref)
    command="node -e "+shlex.quote("require('node:fs').appendFileSync("+json.dumps(str(marker))+",'once\\n')")
    body=json.dumps({"name":ref,"command":command,"workingDir":"/tmp","keepAlive":True,"timeout":5,"waitForCompletion":False}).encode()
    disconnect_post("/process",body,marker.exists)
    # Reconcile the deterministic provider process; do not issue another POST.
    row=terminal(ref);expect(row["exitCode"]==0 and marker.read_text()=="once\n")
   check("launch.actual-lost-response-reconciled-without-repost",launch_lost_response)
   def stdin_lost_response():
    marker=b/"lost-stdin";ref="hf-lost-stdin-"+uuid.uuid4().hex[:16];names.append(ref)
    command="node -e "+shlex.quote("const fs=require('node:fs');let n=0;process.stdin.on('data',c=>{n+=c.length;fs.writeFileSync("+json.dumps(str(marker))+",String(n));});process.stdin.on('end',()=>process.stdout.write(String(n)));")
    request("POST","/process",{"name":ref,"command":command,"workingDir":"/tmp","stdin":True,"keepAlive":True,"timeout":10,"waitForCompletion":False})
    data=b"lost-ack-"*32768
    disconnect_post("/process/"+ref+"/stdin",data,lambda:marker.exists()and int(marker.read_text()or"0")==len(data))
    # A delivered instruction with a lost acknowledgement is never replayed.
    request("DELETE","/process/"+ref+"/stdin");row=terminal(ref)
    expect(row["exitCode"]==0 and row["stdout"]==str(len(data)),"lost acknowledgement duplicated stdin")
   check("stdin.actual-lost-acknowledgement-no-replay",stdin_lost_response)

   def restart_stdin():
    nonlocal daemon
    marker=b/"restart-launches";ref="hf-restart-"+uuid.uuid4().hex[:16];names.append(ref)
    command="node -e "+shlex.quote("const fs=require('node:fs');fs.appendFileSync("+json.dumps(str(marker))+",'launched\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));")
    request("POST","/process",{"name":ref,"command":command,"workingDir":"/tmp","stdin":True,"keepAlive":True,"timeout":30,"waitForCompletion":False})
    request("POST","/process/"+ref+"/stdin",b"before-restart",True)
    deadline=time.monotonic()+3
    while not marker.exists()and time.monotonic()<deadline:time.sleep(.02)
    expect(marker.exists(),"real process did not start")
    os.killpg(daemon.pid,signal.SIGTERM);daemon.wait(timeout=5)
    daemon=subprocess.Popen([str(binary),"-port",str(port),"-disable-telemetry"],cwd=home,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    for _ in range(100):
     try:request("GET","/health");break
     except Exception:time.sleep(.03)
    else:raise AssertionError("actual API restart unavailable")
    import urllib.error
    try:request("POST","/process/"+ref+"/stdin",b"must-not-replay",True)
    except urllib.error.HTTPError as error:expect(error.code in[400,404,409,410,422,500],str(error.code))
    else:raise AssertionError("old writable stdin pipe accepted bytes after API restart")
    expect(marker.read_text().count("launched")==1,"API restart relaunched logical instruction")
   check("stdin.actual-api-restart-refuses-old-pipe",restart_stdin)

  finally:
   for ref in names:
    try:request("DELETE","/process/"+ref+"/kill")
    except Exception:pass
   if daemon.poll()is None:
    os.killpg(daemon.pid,signal.SIGTERM)
    try:daemon.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(daemon.pid,signal.SIGKILL);daemon.wait(timeout=5)
   f.close()
   cleanup=reap()
   for p in spools:shutil.rmtree(p,ignore_errors=True)
   check("fixture.actual-descendants-reaped",lambda:expect(cleanup))
 print(json.dumps({"type":"cleanup","resources":[],"complete":cleanup}),flush=True)
 return 1 if FAILED or not cleanup else 0
if __name__=="__main__":sys.exit(main())
