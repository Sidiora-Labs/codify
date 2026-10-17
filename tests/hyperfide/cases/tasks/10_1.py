#!/usr/bin/env python3
"""Blaxel image component checks. Local fixtures never qualify live Blaxel mounts."""
import copy,hashlib,importlib.util,json,os,pathlib,shutil,socket,subprocess,sys,tempfile,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("preparation_fixture",pathlib.Path(__file__).with_name("11_1.py"))
up=importlib.util.module_from_spec(spec);spec.loader.exec_module(up)
SCAN=up.SCAN
IDS=[];FAILED=[]
RELEASE="https://github.com/blaxel-ai/sandbox/releases/download/v0.2.70/sandbox-api-linux-amd64"
RELEASE_SHA="e56a83fb1af52bfe755c80c060b6d5a37a4b02cbf435b3f7da676b81a402f10f"

def expect(v,m="assertion failed"):
 if not v:raise AssertionError(m)
def check(name,fn):
 identity="blaxel.images."+name;IDS.append(identity)
 try:fn();actual="observed"
 except Exception as e:actual=type(e).__name__+": "+str(e);FAILED.append(identity)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)

class Fixture(up.Fixture):
 def __init__(self,base,tools,port):
  super().__init__(base)
  self.tools=tools;self.port=port;self.runtime=base/"runtime";self.runtime.mkdir()
  for d in ["work/one","work/two","opt/hyperfide/prepared"]:(self.runtime/d).mkdir(parents=True,exist_ok=True)
  for x in ["8.1","10.1"]:shutil.copyfile(ROOT/f"services/hyperfide/components/{x}.json",self.components/f"{x}.json")
  self.profile["image"]={"provider":"blaxel","reference":"ubuntu@sha256:"+"b"*64,"digest":"sha256:"+"b"*64}
  self.profile["toolchains"]=[{"name":"node","version":"24.22.0"},{"name":"cc","version":"15.2.0"}]
  self.profile["native_agents"]=[{"name":"codex","version":"0.162.1"}]
  self.profile["supervisor"]={"name":"node","version":"24.22.0"}
  self.profile["hyperfide"]={"version":"2.0.0-dev"}
  self.profile["resources"]["persistent_volume_bytes"]="1073741824"
  policy=copy.deepcopy(up.POLICY);policy["allowed_actions"]+=["blaxel.image."+x for x in ["describe","plan","publish","inspect"]]
  self.policy_file.write_text(json.dumps(policy))
 def image(self):
  return {"name":"hyperfide-component","base_image":self.profile["image"]["reference"],"sandbox_api_image":"ghcr.io/blaxel-ai/sandbox@sha256:"+"c"*64,"sandbox_api_version":"0.2.70","install_script":"recipe.sh","slim":False,"build_memory_mib":1024,"build_volume_mib":1024,"build_region":"us-pdx-1","timeout_seconds":10}
 def storage(self):
  return {"overlay_bytes":"67108864","reserved_memory_bytes":"67108864","headroom_bytes":"1048576","volume":None,"writable_paths":[{"path":"/work/one","backend":"overlay","required_bytes":"1024"},{"path":"/work/two","backend":"overlay","required_bytes":"1024"}],"required_paths":[{"path":"/opt/hyperfide/prepared/recipe.sh","source":"image"}]}
 def create(self):return super().create()
 def call(self,action,payload,env=None):
  e=os.environ.copy();e.update(HF_PREPARATION_ALLOWED_ROOT=str(self.allowed),HF_BLAXEL_PROBE_ROOT=str(self.runtime),HF_BLAXEL_PROBE_TRANSPORT="local-component",HF_BLAXEL_PROBE_PATH=str(self.tools)+":/root/.local/share/mise/installs/node/24.22.0/bin:/usr/local/bin:/usr/bin:/bin",HF_BLAXEL_PROBE_API_PORT=str(self.port))
  for k in ["HF_BLAXEL_API_KEY","HF_BLAXEL_WORKSPACE","HF_BLAXEL_LIVE_ENABLED"]:e.pop(k,None)
  if env:e.update(env)
  argv=["node",str(ROOT/"services/hyperfide/dist/provisioner.js"),"--policy",str(self.policy_file),"--spec-revision","fixture-revision","--components",str(self.components),"--module-root",str(ROOT/"services/hyperfide/dist")]
  req={"id":1,"component":"10.1","action":"blaxel.image."+action,"input":payload}
  r=subprocess.run(argv,input=json.dumps(req)+"\n",text=True,capture_output=True,cwd=self.base,env=e,timeout=80)
  rows=[json.loads(s)for s in (r.stdout+"\n"+r.stderr).splitlines()if s.strip()]
  expect(len(rows)==1,"no single service response: "+r.stderr[:200]);return rows[0]
 def plan_input(self):
  return {"candidate_path":"candidate","manifest":self.create(),"scan_policy":SCAN,"image":self.image(),"storage":self.storage(),"probe_requirements":{"packages":[],"compile_c":True}}
 def plan(self,data=None):
  r=self.call("plan",data or self.plan_input());expect(r.get("ok"),json.dumps(r));return r["result"]
 def inspect_input(self,plan):
  return {"plan":plan,"candidate_path":"candidate","scan_policy":SCAN,"sandbox_reference":None}
 def published(self):
  shutil.copytree(self.candidate,self.runtime/"opt/hyperfide/prepared",dirs_exist_ok=True)
 def reject(self,action,payload,code=None,env=None):
  r=self.call(action,payload,env);expect(not r.get("ok"),"accepted invalid request")
  if code:expect(r.get("error",{}).get("code")==code,json.dumps(r))

def main():
 daemon=None
 with tempfile.TemporaryDirectory(prefix="hyperfide-blaxel-")as td:
  base=pathlib.Path(td);tools=base/"tools";tools.mkdir()
  binary=tools/"sandbox-api"
  with urllib.request.urlopen(RELEASE,timeout=60)as stream:content=stream.read()
  expect(hashlib.sha256(content).hexdigest()==RELEASE_SHA,"official sandbox API digest changed")
  binary.write_bytes(content);binary.chmod(0o700)
  (tools/"hyperfide").symlink_to(ROOT/"cg")
  # Real installed Codex executable, bypassing mise's HOME-dependent shim.
  codex=subprocess.check_output(["mise","which","codex"],text=True).strip()
  (tools/"codex").symlink_to(codex)
  with socket.socket()as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
  api_home=base/"api";api_home.mkdir();env=os.environ.copy();env["HOME"]=str(api_home)
  daemon=subprocess.Popen([str(binary),"-port",str(port),"-disable-telemetry"],cwd=api_home,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
  try:
   for _ in range(100):
    try:
     with urllib.request.urlopen(f"http://127.0.0.1:{port}/health",timeout=.5)as r:
      health=json.load(r);expect(health["version"].lstrip("v")=="0.2.70");break
    except Exception:
     if daemon.poll()is not None:raise AssertionError("real sandbox API did not start")
     time.sleep(.05)
   else:raise AssertionError("real sandbox API health unavailable")
   counter=[0]
   def case(name,fn):
    counter[0]+=1;fixture=Fixture(base/("case-"+str(counter[0])),tools,port)
    check(name,lambda:fn(fixture))
   case("service.describe",lambda f:expect(f.call("describe",{})["result"]["pins"]["sdk"]=="0.3.30"))
   case("recipe.disables-slimming",lambda f:expect("slim = false"in f.plan()["recipe"]["blaxel_toml"]))
   case("recipe.sandbox-api-retained",lambda f:expect('ENTRYPOINT ["/usr/local/bin/sandbox-api"]'in f.plan()["recipe"]["dockerfile"]))
   case("plan.roundtrip",lambda f:expect(f.plan()["preparation_digest"].startswith("sha256:")))
   def deterministic(f):expect(f.plan()==f.plan())
   case("plan.deterministic",deterministic)
   for name,key,value,code in [
    ("default-slimming","slim",True,"BLAXEL_IMAGE_INVALID"),("moving-base","base_image","ubuntu:latest","BLAXEL_IMAGE_INVALID"),
    ("moving-api","sandbox_api_image","ghcr.io/blaxel-ai/sandbox:latest","BLAXEL_IMAGE_INVALID"),("script-traversal","install_script","../secret","BLAXEL_IMAGE_INVALID"),
    ("wrong-profile","base_image","alpine@sha256:"+"d"*64,"PREPARATION_MISMATCH"),("boolean-memory","build_memory_mib",True,"BLAXEL_IMAGE_INVALID"),
    ("zero-memory","build_memory_mib",0,"BLAXEL_IMAGE_INVALID"),("unknown-image-field","arbitrary",True,"BLAXEL_IMAGE_INVALID")]:
    def bad(f,key=key,value=value,code=code):p=f.plan_input();p["image"][key]=value;f.reject("plan",p,code)
    case("reject."+name,bad)
   def memory(f):p=f.plan_input();p["storage"]["overlay_bytes"]="4294967296";f.reject("plan",p,"IMAGE_STORAGE_UNSATISFIED")
   case("reject.overlay-memory-budget",memory)
   def headroom(f):p=f.plan_input();p["storage"]["writable_paths"][0]["required_bytes"]="67108864";f.reject("plan",p,"IMAGE_STORAGE_UNSATISFIED")
   case("reject.storage-headroom",headroom)
   def overlap(f):p=f.plan_input();p["storage"]["writable_paths"][1]["path"]="/work/one/child";f.reject("plan",p,"IMAGE_STORAGE_UNSATISFIED")
   case("reject.overlapping-slots",overlap)
   def noncanonical(f):p=f.plan_input();p["storage"]["overlay_bytes"]="01";f.reject("plan",p,"BLAXEL_IMAGE_INVALID")
   case("reject.noncanonical-bytes",noncanonical)
   def mount(f):p=f.plan_input();p["storage"]["volume"]={"reference":"fixture-v1","mount_path":"/opt/hyperfide/prepared","size_bytes":"1073741824","template_revision":"r1","template_path":"empty"};f.reject("plan",p,"IMAGE_MOUNT_MASKED")
   case("reject.mount-masks-preload",mount)
   def drift(f):p=f.plan_input();(f.candidate/"recipe.sh").write_text("changed");f.reject("plan",p,"PREPARATION_MISMATCH")
   case("reject.changed-content",drift)
   def tamper(f):p=f.plan();p["recipe"]["dockerfile"]+="RUN malicious\n";f.reject("inspect",f.inspect_input(p),"PREPARATION_MISMATCH")
   case("reject.tampered-plan",tamper)
   def secret(f):q=f.plan_input();(f.candidate/"payload").write_text(up.SECRET);f.reject("plan",q,"PREPARATION_MISMATCH")
   case("reject.secret-candidate",secret)
   def local(f):
    p=f.plan();f.published();r=f.call("inspect",f.inspect_input(p));expect(r.get("ok"),json.dumps(r));x=r["result"];expect(x["transport"]=="local-component"and x["qualified"]is False and x["slot_isolation"]);expect(any(c.get("kind")=="compile_c"for c in x["checks"]));expect(any(c.get("kind")=="sandbox_api_health"for c in x["checks"]))
   case("inspect.actual-compiler-api-content-slots",local)
   def content_drift(f):p=f.plan();f.published();(f.runtime/"opt/hyperfide/prepared/recipe.sh").write_text("different");f.reject("inspect",f.inspect_input(p),"PREPARATION_MISMATCH")
   case("inspect.actual-published-drift",content_drift)
   def wrong_tool(f):f.profile["toolchains"][0]["version"]="0.0.1";p=f.plan();f.published();f.reject("inspect",f.inspect_input(p),"IMAGE_TOOL_MISMATCH")
   case("inspect.actual-version-mismatch",wrong_tool)
   def missing_api(f):p=f.plan();f.published();f.reject("inspect",f.inspect_input(p),"IMAGE_TOOL_MISMATCH",{"HF_BLAXEL_PROBE_API_PORT":"1"})
   case("inspect.missing-api",missing_api)
   def missing_compiler(f):p=f.plan();f.published();f.reject("inspect",f.inspect_input(p),"IMAGE_TOOL_MISMATCH",{"HF_BLAXEL_PROBE_PATH":str(tools)})
   case("inspect.missing-toolchain",missing_compiler)
   def package(f):
    directory=f.runtime/"work/one/node_modules/hyperfide-fixture";directory.mkdir(parents=True)
    (directory/"package.json").write_text('{"name":"hyperfide-fixture","version":"1.0.0","main":"index.js"}')
    (directory/"index.js").write_text("module.exports={real:'loaded'}")
    request=f.plan_input();request["probe_requirements"]["packages"]=[{"ecosystem":"node","name":"hyperfide-fixture","version":"1.0.0"}]
    p=f.plan(request);f.published();r=f.call("inspect",f.inspect_input(p));expect(r.get("ok"),json.dumps(r));expect(any(c.get("kind")=="package"for c in r["result"]["checks"]))
   case("inspect.actual-node-package-resolution",package)
   def missing_package(f):q=f.plan_input();q["probe_requirements"]["packages"]=[{"ecosystem":"node","name":"missing-hyperfide-fixture","version":"1.0.0"}];p=f.plan(q);f.published();f.reject("inspect",f.inspect_input(p),"IMAGE_PACKAGE_UNRESOLVED")
   case("inspect.missing-package",missing_package)
   def no_live(f):p=f.plan();q=f.inspect_input(p);q["sandbox_reference"]="fixture";f.reject("inspect",q,"BLAXEL_CREDENTIALS_UNAVAILABLE",{"HF_BLAXEL_PROBE_TRANSPORT":"blaxel"})
   case("live.credentials-required",no_live)
   def spoof_live(f):p=f.plan();q=f.inspect_input(p);q["sandbox_reference"]="pretend-live";f.reject("inspect",q,"BLAXEL_IMAGE_INVALID")
   case("reject.local-receipt-as-live",spoof_live)
   def omitted_probe(f):p=f.plan();q=f.inspect_input(p);q["tools"]=[];f.reject("inspect",q,"BLAXEL_IMAGE_INVALID")
   case("reject.omitted-mandatory-probes",omitted_probe)
   def symlink(f):p=f.plan();f.published();shutil.rmtree(f.runtime/"work/two");(f.runtime/"work/two").symlink_to(f.runtime/"work/one",target_is_directory=True);f.reject("inspect",f.inspect_input(p),"IMAGE_CONTEXT_UNSAFE")
   case("inspect.symlink-slot-denied",symlink)
   def expiry(f):p=f.plan();p["manifest"]["profile"]["policy"]["expires_at"]="2000-01-01T00:00:00.000Z";f.reject("inspect",f.inspect_input(p),"PREPARATION_MISMATCH")
   case("reject.expired-manifest",expiry)
   def operation(f,plan):
    scope={"organisation_id":"fixture-org","pool_id":"fixture-pool","provider":"blaxel","provider_account_id":"fixture-account","environment_id":"fixture-workspace","region":"us-pdx-1","configuration_digest":"sha256:"+"e"*64}
    op={"schema_version":1,"kind":"prepare","scope":scope,"deadline_at":"2099-01-01T00:00:00.000Z","resource":None,"preparation_digest":plan["preparation_digest"],"parameters":{"image_reference":"hyperfide/blaxel-plan@"+plan["plan_digest"],"recipe_digest":plan["preparation_digest"],"os":f.profile["os"]}}
    body={k:op[k]for k in ["kind","scope","deadline_at","resource","preparation_digest","parameters"]}
    op["identity"]={"operation_id":"fixture-operation","idempotency_key":"fixture-idempotency","payload_digest":up.digest(up.canonical(body)),"correlation_id":"fixture-correlation","causation_id":"fixture-causation"};return op
   def publisher(f,delay=False,bad_hash=False):
    request=f.plan_input()
    if delay:request["image"]["timeout_seconds"]=1
    plan=f.plan(request);marker=f.base/"publisher-observation.json";cli=f.base/"publisher-fixture"
    # Controlled CLI boundary double: it performs no provider request and can only
    # produce UNKNOWN. This tests process/context isolation, never live acceptance.
    code="#!/usr/bin/python3\nimport json,os,pathlib,sys,time\nif sys.argv[1]=='version':print('0.1.127');sys.exit(0)\np=pathlib.Path(sys.argv[sys.argv.index('--directory')+1]);canary=os.environ['BL_API_KEY'].encode();files=[x for x in p.rglob('*')if x.is_file()];data={'slim_disabled':'slim = false'in(p/'blaxel.toml').read_text(),'secret_embedded':any(canary in x.read_bytes()for x in files),'unexpected_env':'HF_UNRELATED_SECRET'in os.environ,'auth_home_empty':not list(pathlib.Path(os.environ['HOME']).iterdir())};pathlib.Path("+repr(str(marker))+").write_text(json.dumps(data));"+("time.sleep(5);"if delay else "")+"sys.exit(17)\n"
    cli.write_text(code);cli.chmod(0o700)
    env={"HF_BLAXEL_LIVE_ENABLED":"true","HF_BLAXEL_ACCOUNT_ID":"fixture-account","HF_BLAXEL_WORKSPACE":"fixture-workspace","HF_BLAXEL_API_KEY":"HF-PUBLISHER-CANARY-ONLY","HF_BLAXEL_CLI_PATH":str(cli),"HF_BLAXEL_CLI_SHA256":"0"*64 if bad_hash else hashlib.sha256(cli.read_bytes()).hexdigest(),"HF_UNRELATED_SECRET":"must-not-propagate"}
    row=f.call("publish",{"plan":plan,"candidate_path":"candidate","scan_policy":SCAN,"operation":operation(f,plan)},env)
    if bad_hash:expect(not row.get("ok")and row["error"]["code"]=="BLAXEL_PUBLISHER_UNAVAILABLE");expect(not marker.exists());return
    expect(row.get("ok"),json.dumps(row));out=row["result"];expect(out["status"]=="UNKNOWN"and out["reconcile_required"]and out["retry"]=="AFTER_RECONCILIATION",json.dumps(row));expect("READY"not in json.dumps(row));expect("HF-PUBLISHER-CANARY"not in json.dumps(row));facts=json.loads(marker.read_text());expect(facts=={"slim_disabled":True,"secret_embedded":False,"unexpected_env":False,"auth_home_empty":True},json.dumps(facts))
   case("publisher.unknown-context-privacy",lambda f:publisher(f))
   case("publisher.timeout-unknown",lambda f:publisher(f,delay=True))
   case("publisher.binary-digest-required",lambda f:publisher(f,bad_hash=True))
   def no_publish_credentials(f):
    p=f.plan();f.reject("publish",{"plan":p,"candidate_path":"candidate","scan_policy":SCAN,"operation":operation(f,p)},"BLAXEL_CREDENTIALS_UNAVAILABLE")
   case("publisher.no-credential-fallback",no_publish_credentials)
   def template_link(f,hard=False):
    directory=f.candidate/"template";directory.mkdir()
    (directory/"package").write_text("ordinary content")
    request=f.plan_input()
    if hard:os.link(directory/"package",directory/"package-link")
    else:(directory/"package-link").symlink_to("package")
    # Task11.1 already rejects links during verified preparation, before planner can publish.
    f.reject("plan",request,"PREPARATION_MISMATCH")
   case("template.pnpm-style-symlink-denied",lambda f:template_link(f))
   case("template.uv-style-hardlink-denied",lambda f:template_link(f,True))
   def volume_plan(f):
    q=f.plan_input();q["storage"]["volume"]={"reference":"fixture-volume","mount_path":"/persistent","size_bytes":"1073741824","template_revision":"immutable-r1","template_path":"empty"};q["storage"]["writable_paths"][1]={"path":"/persistent/two","backend":"volume","required_bytes":"1024"}
    p=f.plan(q);expect(p["storage"]["volume"]["template_revision"]=="immutable-r1")
   case("template.volume-budget-and-paths",volume_plan)
   def escaped_descendant(f):
    marker=f.base/"escaped-pid"
    child="setTimeout(()=>{},60000)"
    launcher="const{spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e',"+json.dumps(child)+"],{detached:true,stdio:'ignore'});fs.writeFileSync("+json.dumps(str(marker))+",String(c.pid));c.unref()"
    script="import{runBlaxelCommand}from"+json.dumps(str(ROOT/"services/hyperfide/dist/providers/blaxel/images.js"))+";const r=await runBlaxelCommand([process.execPath,'-e',"+json.dumps(launcher)+"],'/tmp',{PATH:'/usr/bin:/bin'},5000,new AbortController().signal);console.log(JSON.stringify(r))"
    r=subprocess.run(["node","--input-type=module","-e",script],text=True,capture_output=True,timeout=15,cwd=ROOT)
    expect(r.returncode==0,r.stderr);result=json.loads(r.stdout);expect(result["exit_code"]!=0,"accepted leaked background execution")
    pid=int(marker.read_text())
    try:os.kill(pid,0)
    except ProcessLookupError:return
    else:os.kill(pid,9);raise AssertionError("escaped descendant survived bounded command")
   case("process.detached-descendant-reaped",escaped_descendant)
   def supervisor_error(f):
    script="import{runBlaxelCommand}from"+json.dumps(str(ROOT/"services/hyperfide/dist/providers/blaxel/images.js"))+";try{await runBlaxelCommand([process.execPath,'--version'],"+json.dumps(str(f.base/"absent-working-directory"))+",{PATH:'/usr/bin:/bin'},1000,new AbortController().signal);throw Error('unexpected supervisor success')}catch(e){if(e.code!=='BLAXEL_SUPERVISOR_UNAVAILABLE'||e.message.includes('UNRELATED-CANARY'))throw e}"
    r=subprocess.run(["node","--input-type=module","-e",script],text=True,capture_output=True,timeout=5,cwd=ROOT);expect(r.returncode==0,r.stderr)
   case("process.supervisor-spawn-error-structured",supervisor_error)
   def supervisor_override(f,kind):
    marker=f.base/("override-"+kind)
    executable=subprocess.check_output(["python3","-c","import sys;print(sys.executable)"],text=True).strip()
    configured=executable if kind=="valid"else "relative-python"if kind=="relative"else str(f.base/"absent-supervisor")
    script="import{runBlaxelCommand,BLAXEL_SUPERVISOR_PYTHON}from"+json.dumps(str(ROOT/"services/hyperfide/dist/providers/blaxel/images.js"))+";if(BLAXEL_SUPERVISOR_PYTHON!=="+json.dumps(configured)+")throw Error('wrong configured supervisor');try{const r=await runBlaxelCommand([process.execPath,'-e',"+json.dumps("require('node:fs').writeFileSync("+json.dumps(str(marker))+",'executed')")+"],'/tmp',{PATH:'/usr/bin:/bin'},2000,new AbortController().signal);"+("if(r.exit_code!==0)throw Error('configured supervisor failed');"if kind=="valid"else "throw Error('unexpected fallback');")+"}catch(e){"+("throw e;"if kind=="valid"else "if(e.code!=='BLAXEL_SUPERVISOR_UNAVAILABLE')throw e;")+"}"
    env=os.environ.copy();env["HYPERFIDE_SUPERVISOR_PYTHON"]=configured;r=subprocess.run(["node","--input-type=module","-e",script],env=env,text=True,capture_output=True,timeout=7,cwd=ROOT);expect(r.returncode==0,r.stderr);expect(marker.exists()==(kind=="valid"))
   case("process.trusted-packaged-supervisor-used",lambda f:supervisor_override(f,"valid"))
   case("process.missing-supervisor-never-falls-back",lambda f:supervisor_override(f,"missing"))
   case("process.relative-supervisor-denied",lambda f:supervisor_override(f,"relative"))
   def isolated_python(f):
    directory=f.base/"pythonpath-canary";directory.mkdir();marker=directory/"executed";(directory/"sitecustomize.py").write_text("from pathlib import Path;Path("+repr(str(marker))+").write_text('unsafe startup hook')")
    script="import{runBlaxelCommand}from"+json.dumps(str(ROOT/"services/hyperfide/dist/providers/blaxel/images.js"))+";const r=await runBlaxelCommand([process.execPath,'--version'],'/tmp',{PATH:'/usr/bin:/bin',PYTHONPATH:"+json.dumps(str(directory))+"},2000,new AbortController().signal);if(r.exit_code!==0)throw Error('isolated Python failed')"
    r=subprocess.run(["node","--input-type=module","-e",script],text=True,capture_output=True,timeout=7,cwd=ROOT);expect(r.returncode==0,r.stderr);expect(not marker.exists(),'untrusted Python startup hook executed')
   case("process.supervisor-ignores-pythonpath-startup-hook",isolated_python)
   def sdk_config(f):
    (f.base/".env").write_text("BL_API_URL=https://untrusted.example.invalid\nBL_API_KEY=UNTRUSTED-CANARY\n")
    f.reject("describe",{},"BLAXEL_CREDENTIALS_UNAVAILABLE")
   case("sdk.repository-dotenv-denied",sdk_config)
   def sdk_override(f):f.reject("describe",{},"BLAXEL_CREDENTIALS_UNAVAILABLE",{"BL_API_URL":"https://untrusted.example.invalid"})
   case("sdk.endpoint-override-denied",sdk_override)
  finally:
   if daemon.poll()is None:
    os.killpg(daemon.pid,15)
    try:daemon.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(daemon.pid,9);daemon.wait(timeout=5)
 print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
 return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
