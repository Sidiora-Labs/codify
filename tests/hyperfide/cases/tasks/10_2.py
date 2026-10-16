#!/usr/bin/env python3
"""Lifetime contracts and real pinned sandbox-api timeout behavior, without cloud acceptance."""
import urllib.error
import ctypes
import copy,hashlib,importlib.util,json,os,pathlib,shutil,signal,socket,subprocess,sys,tempfile,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("image_fixture",pathlib.Path(__file__).with_name("10_1.py"));image=importlib.util.module_from_spec(s);s.loader.exec_module(image)
IDS=[];FAILED=[]
ACTIONS=["blaxel.lifetime."+x for x in ["describe","plan","assess","observe"]]
NOW="2026-10-16T00:00:00.000Z"
def expect(v,m="assertion failed"):
 if not v:raise AssertionError(m)
def check(name,fn):
 identity="blaxel.lifetime."+name;IDS.append(identity)
 try:fn();actual="observed"
 except Exception as e:actual=type(e).__name__+": "+str(e);FAILED.append(identity)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def policy():
 return {"schema_version":1,"run_seconds":259200,"checkpoint_lead_seconds":300,"termination_grace_seconds":30,"api_wait_seconds":30,"process":{"keep_alive":True,"timeout_seconds":0},"expiration_policies":[],"runtime_ttl":None,"runtime_expires_at":None}
def observed():
 return {"created_at":NOW,"observed_at":NOW,"last_resume_or_suspend_at":NOW,"expires_in_seconds":None,"account_max_age_seconds":None,"account_limits_qualified":True,"process":{"keep_alive":True,"timeout_seconds":0,"started_at":NOW,"state":"RUNNING"}}
class Fixture:
 def __init__(self,base):
  self.base=base;self.components=base/"components";self.components.mkdir()
  for name in ["8.1","11.1","10.1","10.2"]:shutil.copyfile(ROOT/f"services/hyperfide/components/{name}.json",self.components/f"{name}.json")
  p=copy.deepcopy(image.up.POLICY);p["allowed_actions"]+=ACTIONS;self.policy=base/"policy.json";self.policy.write_text(json.dumps(p))
 def call(self,action,data):
  env=os.environ.copy()
  for k in ["HF_BLAXEL_LIVE_ENABLED","HF_BLAXEL_API_KEY","HF_BLAXEL_WORKSPACE"]:env.pop(k,None)
  argv=["node",str(ROOT/"services/hyperfide/dist/provisioner.js"),"--policy",str(self.policy),"--spec-revision","fixture-revision","--components",str(self.components),"--module-root",str(ROOT/"services/hyperfide/dist")]
  r=subprocess.run(argv,cwd=self.base,env=env,text=True,input=json.dumps({"id":1,"component":"10.2","action":"blaxel.lifetime."+action,"input":data})+"\n",capture_output=True,timeout=20)
  rows=[json.loads(x)for x in (r.stdout+"\n"+r.stderr).splitlines()if x.strip()];expect(len(rows)==1,r.stderr);return rows[0]
 def assess(self,p=None,o=None,now=NOW):
  row=self.call("assess",{"policy":p or policy(),"observation":o or observed(),"evaluated_at":now});expect(row.get("ok"),json.dumps(row));return row["result"]
 def reject(self,data):
  row=self.call("plan",data);expect(not row.get("ok")and row["error"]["code"]=="BLAXEL_LIFETIME_INVALID",json.dumps(row))
def main():
 daemon=None;names=[];cleanup_confirmed=True
 expect(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"fixture child subreaper unavailable")
 with tempfile.TemporaryDirectory(prefix="hyperfide-lifetime-")as td:
  base=pathlib.Path(td);f=Fixture(base)
  check("service.describe",lambda:expect(f.call("describe",{})["result"]["provider_process_timeout_unit"]=="seconds"))
  def explicit():
   row=f.call("plan",policy());expect(row.get("ok"),json.dumps(row));p=row["result"]["process_options"];expect(p=={"keepAlive":True,"timeout":0,"waitForCompletion":False,"restartOnFailure":False,"maxRestarts":0})
  check("process.explicit-nonstop-options",explicit)
  check("assessment.no-authority",lambda:expect(f.assess()["candidate_compatible"]and f.assess()["authority"]=="NONE"))
  for name,mutator in [
   ("missing-timeout",lambda p:p["process"].pop("timeout_seconds")),
   ("default-600-timeout",lambda p:p["process"].update(timeout_seconds=600)),
   ("no-keepalive",lambda p:p["process"].update(keep_alive=False)),
   ("boolean-timeout",lambda p:p["process"].update(timeout_seconds=False)),
   ("api-wait-too-long",lambda p:p.update(api_wait_seconds=61)),
   ("zero-run",lambda p:p.update(run_seconds=0)),
   ("negative-grace",lambda p:p.update(termination_grace_seconds=-1)),
   ("unknown-field",lambda p:p.update(worker_activity_resets_expiry=True)),
   ("unqualified-unit",lambda p:p.update(runtime_ttl="72hours")),
   ("runtime-minimum",lambda p:p.update(runtime_ttl="1s")),
   ("idle-minimum",lambda p:p.update(expiration_policies=[{"type":"ttl-idle","value":"1s","action":"delete"}])),
   ("max-age-minimum",lambda p:p.update(expiration_policies=[{"type":"ttl-max-age","value":"60s","action":"delete"}])),
   ("unknown-expiration-action",lambda p:p.update(expiration_policies=[{"type":"ttl-idle","value":"60s","action":"suspend"}])),
   ("duplicate-clock",lambda p:p.update(expiration_policies=[{"type":"ttl-idle","value":"60s","action":"delete"}]*2)),
  ]:
   def bad(mutator=mutator):p=policy();mutator(p);f.reject(p)
   check("reject."+name,bad)
  def reason(name,change,pchange=None,now=NOW):
   p=policy();o=observed();change(o)
   if pchange:pchange(p)
   r=f.assess(p,o,now);expect(not r["candidate_compatible"]and name in r["reasons"],json.dumps(r))
  check("reject.account-unqualified",lambda:reason("ACCOUNT_LIFETIME_UNQUALIFIED",lambda o:o.update(account_limits_qualified=False)))
  check("reject.account-max-age",lambda:reason("SANDBOX_DELETION_BEFORE_SAFE_RUN_END",lambda o:o.update(account_max_age_seconds=3600)))
  check("reject.observed-provider-expiry",lambda:reason("SANDBOX_DELETION_BEFORE_SAFE_RUN_END",lambda o:o.update(expires_in_seconds=60)))
  check("reject.process-default-kill",lambda:reason("PROCESS_DEFAULT_600_SECOND_KILL",lambda o:o["process"].update(timeout_seconds=None)))
  check("reject.process-short-deadline",lambda:reason("PROCESS_EXECUTION_DEADLINE_TOO_SHORT",lambda o:o["process"].update(timeout_seconds=600)))
  check("reject.standby-risk",lambda:reason("PROCESS_MAY_STANDBY",lambda o:o["process"].update(keep_alive=False)))
  check("reject.process-not-running",lambda:reason("PROCESS_NOT_OBSERVED_RUNNING",lambda o:o["process"].update(state="UNKNOWN")))
  check("reject.stale-observation",lambda:reason("STALE_LIFETIME_OBSERVATION",lambda o:None,now="2026-10-16T00:02:00.000Z"))
  check("reject.idle-transition-unknown",lambda:reason("IDLE_EXPIRATION_ANCHOR_UNKNOWN",lambda o:o.update(last_resume_or_suspend_at=None),lambda p:p.update(expiration_policies=[{"type":"ttl-idle","value":"60s","action":"delete"}])))
  def idle():
   p=policy();p["expiration_policies"]=[{"type":"ttl-idle","value":"60s","action":"delete"}];o=observed();o["observed_at"]="2026-10-16T00:00:30.000Z"
   r=f.assess(p,o,"2026-10-16T00:00:30.000Z");d=next(d for d in r["deletion_deadlines"]if d["mechanism"]=="policy-ttl-idle");expect(d["at"]=="2026-10-16T00:01:00.000Z");expect(not r["candidate_compatible"])
  check("idle.activity-does-not-reset-deletion",idle)
  def heartbeat():
   p=policy();o=observed();a=f.assess(p,o)["required_until"];o["observed_at"]="2026-10-16T00:00:30.000Z";expect(f.assess(p,o,o["observed_at"])["required_until"]==a)
  check("run.horizon-not-extended-by-observation",heartbeat)
  def earliest():
   p=policy();p["runtime_ttl"]="7d";p["runtime_expires_at"]="2026-10-20T00:00:00.000Z";o=observed();o["account_max_age_seconds"]=5*86400
   r=f.assess(p,o);expect(r["candidate_compatible"]);expect(r["checkpoint_due_at"]=="2026-10-19T23:54:30.000Z")
  check("expiry.earliest-clock-and-checkpoint-lead",earliest)
  def missing_live():
   row=f.call("observe",{"sandbox_reference":"fixture-sandbox","process_reference":"fixture-process"});expect(not row.get("ok")and row["error"]["code"]=="BLAXEL_CREDENTIALS_UNAVAILABLE",json.dumps(row))
  check("live.no-credential-fallback",missing_live)
  def read_budget(cancel=False):
   action="const ctl=new AbortController();let cancelled=false;"+("setTimeout(()=>ctl.abort(),15);"if cancel else "")+"try{await boundedBlaxelRead(async signal=>{signal.addEventListener('abort',()=>cancelled=true);return await new Promise(()=>{})},ctl.signal,Date.now()+50);throw Error('unbounded read accepted')}catch(e){if(e.code!=='BLAXEL_LIFETIME_UNAVAILABLE'||!cancelled)throw e}"
   script="import{boundedBlaxelRead}from"+json.dumps(str(ROOT/"services/hyperfide/dist/providers/blaxel/lifetime.js"))+";"+action
   r=subprocess.run(["node","--input-type=module","-e",script],cwd=ROOT,text=True,capture_output=True,timeout=3);expect(r.returncode==0,r.stderr)
  check("read.actual-deadline-race",read_budget)
  check("read.actual-cancellation-race",lambda:read_budget(True))
  binary=base/"sandbox-api"
  with urllib.request.urlopen(image.RELEASE,timeout=60)as stream:content=stream.read()
  expect(hashlib.sha256(content).hexdigest()==image.RELEASE_SHA,"official API binary identity changed");binary.write_bytes(content);binary.chmod(0o700)
  with socket.socket()as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
  api_home=base/"api";api_home.mkdir();env=os.environ.copy();env["HOME"]=str(api_home)
  daemon=subprocess.Popen([str(binary),"-port",str(port),"-disable-telemetry"],cwd=api_home,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
  def request(method,path,data=None):
   body=None if data is None else json.dumps(data).encode()
   with urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}"+path,data=body,method=method,headers={"Content-Type":"application/json"}),timeout=5)as r:return json.load(r)
  try:
   for _ in range(100):
    try:request("GET","/health");break
    except Exception:
     if daemon.poll()is not None:raise AssertionError("sandbox API process failed")
     time.sleep(.05)
   else:raise AssertionError("sandbox API health timed out")
   def process_timeout():
    name="hyperfide-lifetime-finite";names.append(name);request("POST","/process",{"name":name,"command":"sleep 10","keepAlive":True,"timeout":1,"waitForCompletion":False})
    deadline=time.monotonic()+4
    while time.monotonic()<deadline:
     row=request("GET","/process/"+name)
     if row["status"]!="running":expect(row["exitCode"]!=0,json.dumps(row));return
     time.sleep(.05)
    raise AssertionError("real execution timeout did not terminate process")
   check("api.actual-execution-timeout",process_timeout)
   def infinite_timeout():
    name="hyperfide-lifetime-unlimited";names.append(name);request("POST","/process",{"name":name,"command":"sleep 10","keepAlive":True,"timeout":0,"waitForCompletion":False});time.sleep(1.1);expect(request("GET","/process/"+name)["status"]=="running")
   check("api.actual-explicit-zero-keeps-running",infinite_timeout)
   def api_wait():
    name="hyperfide-lifetime-api-wait";names.append(name);begin=time.monotonic()
    try:request("POST","/process",{"name":name,"command":"sleep 10","keepAlive":False,"timeout":1,"waitForCompletion":True})
    except urllib.error.HTTPError as error:
     detail=error.read().decode()
     expect(error.code in[408,422,504]and time.monotonic()-begin>=.5,detail)
    expect(request("GET","/process/"+name)["status"]=="running")
   check("api.actual-wait-timeout-does-not-kill",api_wait)
  finally:
   for name in names:
    try:request("DELETE","/process/"+name+"/kill")
    except Exception:pass
    settled=False
    for _ in range(100):
     try:
      row=request("GET","/process/"+name)
      if row["status"]in["completed","failed","killed","stopped"]and isinstance(row.get("exitCode"),int):settled=True;break
     except Exception:break
     time.sleep(.02)
    if not settled:cleanup_confirmed=False
   if daemon.poll()is None:
    os.killpg(daemon.pid,signal.SIGTERM)
    try:daemon.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(daemon.pid,signal.SIGKILL);daemon.wait(timeout=5)
   deadline=time.monotonic()+5
   while True:
    children=pathlib.Path("/proc/self/task/"+str(os.getpid())+"/children").read_text().split()
    for child in children:
     try:os.kill(int(child),signal.SIGKILL)
     except ProcessLookupError:pass
    try:
     pid,status=os.waitpid(-1,os.WNOHANG)
     if pid:continue
    except ChildProcessError:break
    if time.monotonic()>deadline:cleanup_confirmed=False;break
    time.sleep(.01)
   check("fixture.actual-descendants-reaped",lambda:expect(cleanup_confirmed,"fixture descendants remain unresolved"))
 print(json.dumps({"type":"cleanup","resources":[],"complete":cleanup_confirmed}),flush=True);return 1 if FAILED or not cleanup_confirmed else 0
if __name__=="__main__":sys.exit(main())
