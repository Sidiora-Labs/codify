#!/usr/bin/env python3
"""Decision jobs: real signed HTTPS, real PostgreSQL, explicit synthetic provider servers."""
import base64,copy,hashlib,http.server,importlib.util,json,os,select,shutil,signal,socket,subprocess,sys,tempfile,threading,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("identity_fixture",ROOT/"tests/hyperfide/support/identity_fixture.py")
identity=importlib.util.module_from_spec(spec);spec.loader.exec_module(identity)
IDS=["decision.jobs.authenticated-submit","decision.jobs.no-wire-authority","decision.jobs.purpose-loader-required",
"decision.jobs.egress-permission","decision.jobs.total-online-bound","decision.jobs.admission-receipt",
"decision.jobs.idempotent-admission","decision.jobs.validated-fixture","decision.jobs.audit-server-owned",
"decision.jobs.finished-attempt-immutable","decision.jobs.result-immutable","decision.jobs.terminal-no-resend",
"decision.jobs.provider-auth-no-retry","decision.jobs.invalid-response","decision.jobs.two-route-fallback",
"decision.jobs.total-provider-deadline","decision.jobs.control-responsive","decision.jobs.queue-bound",
"decision.jobs.active-bound","decision.jobs.cost-admission","decision.jobs.route-rate","decision.jobs.circuit-open",
"decision.jobs.stale-admission","decision.jobs.stale-completion","decision.jobs.cancel-queued",
"decision.jobs.cancel-running","decision.jobs.restart-queued","decision.jobs.expired-queue",
"decision.jobs.synthetic-receipt","decision.jobs.no-authority-effects","decision.jobs.completed-audit-freshness",
"decision.jobs.revision-unknown-rejected","decision.jobs.slow-freshness-zero-send","decision.jobs.restart-inflight","decision.jobs.idempotency-conflict","decision.jobs.replay-after-revision-change","decision.jobs.retained-request-replay","decision.jobs.shared-account-quota","decision.jobs.completion-deadline","decision.jobs.admission-deadline","decision.jobs.semantic-lock-order"]
def expect(v,msg):
 if not v:raise AssertionError(msg)
def uid():return str(uuid.uuid4())
def canonical(v):return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
class Provider:
 def __init__(self,mode="valid",delay=0):
  self.on_reply=None;self.received=[];self.arrived=threading.Event();self.closed=threading.Event();self.release=threading.Event();outer=self
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_POST(self):
    body=json.loads(self.rfile.read(int(self.headers["content-length"])))
    outer.received.append(body);outer.arrived.set()
    if mode=="held":outer.release.wait(10)
    if delay:outer.closed.wait(delay)
    answers={k:{"type":"noul","noul":2 if mode=="invalid"else .8}for k in body["questions"]}
    raw=json.dumps({"model":body["model"],"answers":answers,"usage":{"input_tokens":11,"output_tokens":0}}).encode()
    if outer.on_reply:outer.on_reply()
    self.send_response(503 if mode=="overload"else 401 if mode=="auth"else 200)
    self.send_header("Content-Type","application/json");self.end_headers()
    try:self.wfile.write(raw)
    except(BrokenPipeError,ConnectionResetError):pass
  self.server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler);self.server.daemon_threads=False
  self.thread=threading.Thread(target=self.server.serve_forever);self.thread.start()
 def config(self,model):
  return {"enabled":True,"mode":"fixture","qualification_ref":"synthetic-loopback-only","credential_env":"HYPERFIDE_DECISION_FIXTURE_KEY",
   "endpoint":f"http://127.0.0.1:{self.server.server_port}/decisions","max_body_bytes":65536,"returned_models":[model]}
 def close(self):
  self.closed.set();self.release.set();self.server.shutdown();self.server.server_close();self.thread.join(timeout=3)
  expect(not self.thread.is_alive(),"owned provider thread leaked")
def capprofile():
 return {"qualification_ref":"synthetic-capability-fixture-not-live","mode":"fixture","extensions":[],"images":False,"image_token_reserve":2048,
 "max_images":4,"max_image_bytes":1048576,"max_request_bytes":65536,"max_question_bytes":32768,
 "context_request_tokens":64000,"context_question_tokens":32000,"tokenizer_ref":"synthetic-byte-upper-bound",
 "billing":"repeated-state","price_input_per_million":.042,"price_output_per_million":0}
LOADER="""import {assertInvocation} from './transport/protocol.js';
export function createComponent(ctx){
 const jobs=ctx.dependencies.require('20.4','decision.jobs.v1',v=>v&&typeof v.registerPurpose==='function'&&typeof v.completedAudit==='function');
 const current=async(tx,s,p,i)=>{assertInvocation(i);await tx.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[s.organisation_id+':'+s.run_id+':finding-disposition']);await i.guard(tx);const delay=(await tx.query('SELECT seconds,after_response FROM public.fixture_decision_delay')).rows[0];const completed=delay.after_response?(await tx.query('SELECT count(*)::int n FROM hyperfide.decision_attempts WHERE finished_at IS NOT NULL')).rows[0].n:1;if(delay.seconds>0&&completed>0)await tx.query('SELECT pg_sleep($1)',[delay.seconds]);const r=(await tx.query('SELECT spec_revision_id,state_version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[s.organisation_id,s.run_id])).rows[0];
 return {spec_revision:r.spec_revision_id,repository_commits:{},graph_revision:null,contract_revisions:{},event_watermark:'fixture-run:'+r.state_version,ownership_generation:String(r.state_version)};};
 jobs.registerPurpose('fixture-review',{current,load:async(tx,i,input)=>{assertInvocation(i);await i.guard(tx);if(!input||Object.keys(input).join(',')!=='packet_id')throw Error('fixture input schema');
 const r=(await tx.query('SELECT packet FROM public.fixture_decision_packets WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[i.principal.organisation_id,i.principal.run_id,input.packet_id])).rows[0];if(!r)throw Error('fixture packet absent');
 const {questions,...state}=r.packet.state;return{packet:r.packet,request:{state,questions},rubric_version:'fixture-rubric-v1'};}});
 return {apiVersion:1,actions:{'decision.fixture.audit':async(input,context)=>{const i=context.invocation;assertInvocation(i);
 return ctx.resources.gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{
 const s={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id},r=(await tx.query('SELECT packet_hash FROM hyperfide.decision_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[s.organisation_id,s.run_id,input.decision_id])).rows[0];
 return jobs.completedAudit(tx,s,{decision_id:input.decision_id,packet_hash:r.packet_hash},i);});}}};
}
"""
class Fixture(identity.IdentityFixture):
 def __init__(self,provider=None,second=None,settings=None,signer=False):
  self.provider=provider or Provider();self.second=second;self.owned=provider is None;self.settings=settings or {};self.signer=signer
  def setup(f):
   f.sql((ROOT/"services/hyperfide/migrations/0020-decision-jobs.sql").read_text())
   f.sql("CREATE TABLE public.fixture_decision_delay(seconds double precision,after_response boolean NOT NULL DEFAULT false); INSERT INTO public.fixture_decision_delay(seconds) VALUES(0)")
   f.sql("CREATE TABLE public.fixture_decision_packets(organisation_id uuid,run_id uuid,id uuid,packet jsonb,PRIMARY KEY(organisation_id,run_id,id))")
   f.runtime=f.path/"runtime";shutil.copytree(ROOT/"services/hyperfide/dist",f.runtime/"dist");shutil.copytree(ROOT/"services/hyperfide/migrations",f.runtime/"migrations")
   (f.runtime/"package.json").write_text('{"type":"module"}');(f.runtime/"node_modules").symlink_to(ROOT/"services/hyperfide/node_modules",target_is_directory=True)
   (f.runtime/"dist/fixture-purpose.js").write_text(LOADER)
   fragment={"schema_version":1,"id":"99.20","task":"99.20","roles":["control"],"module":"fixture-purpose.js","entry":"createComponent","api_version":1,"actions":["decision.fixture.audit"],"requires":["4.2","20.4"]}
   (f.components/"99.20.json").write_text(json.dumps(fragment))
   f.actions+=["decision.fixture.audit"]
   pol=json.loads(f.policy.read_text());pol["allowed_actions"]+=["decision.fixture.audit"];f.policy.write_text(json.dumps(pol))
   auth=json.loads(f.identity_config.read_text())
   for principal in auth["principals"]:principal["allowed_actions"]+=["decision.fixture.audit"]
   f.identity_config.write_text(json.dumps(auth))
   f.consumer=uid()
   policy={"schema_version":1,"revision":"fixture-job-policy-v1","allowed_purposes":{"fixture-review":["span-native","jev-native"]},"consumers":{f.ids["run"]:f.consumer},"quota_groups":{"span-native":"synthetic-decision-account","jev-native":"synthetic-decision-account"},
    "max_active":16,"max_queued":256,"requests_per_minute":100,"circuit_failures":3,"circuit_cooldown_ms":30000,"max_job_cost_microusd":10000}
   policy.update(f.settings)
   routes={"span-native":f.provider.config("span-02")}
   if f.second:routes["jev-native"]=f.second.config("jev-1.14.0")
   f.env.update({"HYPERFIDE_DECISION_FIXTURE_KEY":"synthetic-job-credential","HYPERFIDE_DECISION_ROUTES":json.dumps(routes),
    "HYPERFIDE_DECISION_CAPABILITY_PROFILES":json.dumps({"span-native":capprofile(),"jev-native":capprofile()}),
    "HYPERFIDE_DECISION_JOB_POLICY":json.dumps(policy)})
   if f.signer:
    key=f.path/"receipt-key.pem"
    subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    f.env["HYPERFIDE_DECISION_RECEIPT_KEY"]=key.read_text()
    f.env["HYPERFIDE_DECISION_SIGNER"]=json.dumps({"key_id":"synthetic-decision-key","private_key_env":"HYPERFIDE_DECISION_RECEIPT_KEY","evidence_class":"synthetic"})
  super().__init__(extra_components=("6.1","6.2","20.1","20.2","20.3","20.4"),extra_setup=setup)
  self.call("outbox.consumer.register",{"organisation_id":self.ids["organisation"],"run_id":self.ids["run"],"id":self.consumer,"consumer_key":"decision-fixture","critical":False,"state":"ACTIVE"},component="6.1")
 def start(self):
  argv=["node",str(self.runtime/"dist/control.js"),"--policy",str(self.policy),"--spec-revision","fixture-identity-v1","--components",str(self.components),"--module-root",str(self.runtime/"dist"),"--mode","https","--host","127.0.0.1","--port",str(self.port),"--tls-cert",str(self.ca),"--tls-key",str(self.tlskey)]
  self.child=subprocess.Popen(argv,cwd=ROOT,env=self.env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  deadline=time.monotonic()+15;lines=[]
  while time.monotonic()<deadline:
   ready,_,_=select.select([self.child.stderr],[],[],.1)
   if ready:
    line=self.child.stderr.readline();lines.append(line)
    if '"event":"ready"'in line:return
   if self.child.poll()is not None:break
  self.startup_failed=True
  raise AssertionError("Copied actual HTTPS service failed startup: "+"".join(lines)[:1500])
 def stop(self):
  if getattr(self,"startup_failed",False) and self.child:
   if self.child.poll()is None:self.child.kill()
   self.child.communicate(timeout=8);self.child=None;return
  return super().stop()
 def close(self):
  try:super().close()
  finally:
   if self.owned:self.provider.close()
 def call(self,action,input,component="20.4",**kwargs):
  status,r=self.invoke(action,input,component=component,**kwargs)
  expect(r.get("ok")is True,f"{action} failed: HTTP{status} {r}")
  return r["result"]
 def reject(self,action,input,code=None,component="20.4"):
  status,r=self.invoke(action,input,component=component)
  expect(r.get("ok")is False and(not code or r.get("error",{}).get("code")==code),f"unsafe success: HTTP{status} {r}")
  return r
 def packet(self):
  row=self.sql("SELECT spec_revision_id,state_version::text FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",[self.ids["organisation"],self.ids["run"]])[0]
  revision={"spec_revision":row["spec_revision_id"],"repository_commits":{},"graph_revision":None,"contract_revisions":{},"event_watermark":"fixture-run:"+row["state_version"],"ownership_generation":row["state_version"]}
  p={"schema_version":1,"id":uid(),"purpose":"fixture-review","revision":revision,"state":{"source":"Synthetic source only","questions":{"urgent":{"type":"noul","instructions":"Does this need review?"}}},
   "created_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()-1)),"expires_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+120)),"authority":"NONE"}
  self.sql("INSERT INTO public.fixture_decision_packets VALUES($1,$2,$3,$4::jsonb)",[self.ids["organisation"],self.ids["run"],p["id"],json.dumps(p)])
  return p
 def submission(self,packet=None,**kwargs):return {"purpose":"fixture-review","input":{"packet_id":(packet or self.packet())["id"]},"route_ids":["span-native"],"deadline_ms":2000,"mode":"online",**kwargs}
 def submit(self,**kwargs):return self.call("decision.jobs.submit",self.submission(**kwargs))["decision_id"]
 def process(self,id):return self.call("decision.jobs.process",{"decision_id":id})
 def status(self,id):return self.call("decision.jobs.status",{"decision_id":id})
 def advance(self):self.sql("UPDATE hyperfide.runs SET state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[self.ids["organisation"],self.ids["run"]])
def main():
 failed=[];observations={};cleanup_complete=True
 def check(i,fn):
  try:fn();actual="observed"
  except Exception as e:actual=f"{type(e).__name__}: {e}";failed.append(i)
  observations[i]=actual
  print("OBSERVATION "+json.dumps({"id":i,"actual":actual}),file=sys.stderr,flush=True)
 def basic():
  nonlocal cleanup_complete
  f=Fixture(signer=True)
  try:
   inp=f.submission();operation=f.operation("20.4","decision.jobs.submit",inp)
   start=time.monotonic();_,r=f.request(operation);expect(r.get("ok")is True,str(r));id=r["result"]["decision_id"]
   expect(not f.provider.received and time.monotonic()-start<2,"submit waited for provider")
   check(IDS[0],lambda:expect(f.status(id)["state"]=="QUEUED","not queued"))
   check(IDS[1],lambda:f.reject("decision.jobs.submit",{**inp,"principal":{"role":"OPERATOR"}},"DECISION_SCHEMA"))
   check(IDS[2],lambda:f.reject("decision.jobs.submit",{**inp,"purpose":"caller-purpose"},"DECISION_UNSUPPORTED"))
   check(IDS[3],lambda:f.reject("decision.jobs.submit",{**inp,"route_ids":["ultra-native"]},"DECISION_EGRESS_DENIED"))
   check(IDS[4],lambda:f.reject("decision.jobs.submit",{**inp,"deadline_ms":2001},"DECISION_SCHEMA"))
   def admission():
    rows=f.sql("SELECT count(*)::int n FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND operation='event.receive' AND state='COMPLETED'",[f.ids["organisation"],f.ids["run"]])
    expect(rows[0]["n"]==1,"admission lacked actual durable6.2 receipt")
   check(IDS[5],admission)
   def replay():
    _,v=f.request(operation);expect(v.get("ok")is True and v["result"]["decision_id"]==id and v["result"]["replayed"]is True,"duplicate admission created new job")
   check(IDS[6],replay)
   # Earlier admission/read tests consume time deliberately; refresh work on a background deadline.
   work=f.submit(mode="background",deadline_ms=10000);result=f.process(work)
   def validated():
    p=result["result"]["payload"];expect(result["state"]=="COMPLETED"and p["status"]=="abstained"and p["raw_output"]["answers"]["urgent"]["noul"]==.8 and len(result["attempts"])==1,"validated raw result missing")
   check(IDS[7],validated)
   check(IDS[8],lambda:expect(f.call("decision.fixture.audit",{"decision_id":work},component="99.20")["payload"]["authority"]=="NONE","audit not server-owned"))
   def immutable_attempt():
    try:f.sql("UPDATE hyperfide.decision_attempts SET outcome='forged' WHERE decision_id=$1",[work])
    except AssertionError:return
    raise AssertionError("finished attempt mutable")
   check(IDS[9],immutable_attempt)
   def immutable_result():
    try:f.sql("UPDATE hyperfide.decision_results SET status='accepted_advice' WHERE decision_id=$1",[work])
    except AssertionError:return
    raise AssertionError("accepted advice forgeable by result UPDATE")
   check(IDS[10],immutable_result)
   check(IDS[11],lambda:expect(len(f.process(work)["attempts"])==1 and len(f.provider.received)==1,"terminal replay resent provider"))
   def receipt():
    receipt=result["result"]["payload"]["evaluation_receipt"];expect(receipt["available"]is True and receipt["envelope"]["body"]["evidence_class"]=="synthetic","fixture receipt falsely live/unsigned")
    envelope=receipt["envelope"]
    script="const fs=require('fs'),c=require('crypto'),e=JSON.parse(fs.readFileSync(0,'utf8'));if(!c.verify(null,Buffer.from(e.canonical),c.createPublicKey(process.env.HYPERFIDE_DECISION_RECEIPT_KEY),Buffer.from(e.signature,'base64')))process.exit(1)"
    cp=subprocess.run(["node","--input-type=commonjs","-e",script],cwd=ROOT,env=f.env,input=json.dumps({"canonical":canonical(envelope["body"]).decode(),"signature":envelope["signature"]}),text=True,capture_output=True,timeout=10)
    expect(cp.returncode==0,"actual Ed25519 receipt invalid")
   check(IDS[28],receipt)
   def replay_request():
    shutil.rmtree(f.runtime/"dist/decisions")
    replay=f.call("decision.jobs.replay",{"decision_id":work,"part":"attempt","attempt_no":1})
    expect(replay["response"]["available"]is True and replay["response"]["body"]["answers"]["urgent"]["noul"]==.8,"actual response not retained")
    expect(replay["request"]["body"]["questions"]["urgent"]["type"]=="noul"and replay["request"]["hash"]==result["attempts"][0]["metadata"]["request_hash"],"exact prepared request not retained")
    expect("Authorization"not in replay["request"]["headers"]and"synthetic-job-credential"not in json.dumps(replay),"resolved credential persisted")
   check(IDS[36],replay_request)
   check(IDS[29],lambda:expect(f.sql("SELECT state FROM hyperfide.runs WHERE id=$1",[f.ids["run"]])[0]["state"]=="RUNNING","model altered run authority"))
   f.advance()
   def changed_submission():
    changed=f.operation("20.4","decision.jobs.submit",f.submission())
    changed["idempotency_key"]=operation["idempotency_key"]
    _,r=f.request(changed)
    expect(r.get("ok")is False and r.get("error",{}).get("code")=="DECISION_IDEMPOTENCY_CONFLICT","changed submission reused durable identity")
   check(IDS[34],changed_submission)
   def stale_replay():
    _,r=f.request(operation);expect(r.get("ok")is True and r["result"]["decision_id"]==id and r["result"]["replayed"]is True,"lost-response job identity became untraceable after revision change")
   check(IDS[35],stale_replay)
   check(IDS[30],lambda:f.reject("decision.fixture.audit",{"decision_id":work},"DECISION_STALE",component="99.20"))
   check(IDS[31],lambda:f.reject("decision.jobs.submit",{**f.submission(),"current_revision":{}},"DECISION_SCHEMA"))
  finally:
   try:f.close()
   except Exception:cleanup_complete=False;raise
 try:basic()
 except Exception as e:
  for i in [*IDS[:12],IDS[28],IDS[29],IDS[30],IDS[31],IDS[34],IDS[35],IDS[36]]:
   if i not in observations:
    observations[i]="fixture setup failed: "+str(e);failed.append(i)
 # Remaining cases are collected before output so assertion order remains exact.
 def scenario(index,fn,mode="valid",delay=0,settings=None,second=None):
  nonlocal cleanup_complete
  provider=Provider(mode,delay);other=Provider(second)if second else None;f=None;error=None;cleanup=[]
  try:f=Fixture(provider,other,settings);fn(f,provider,other)
  except Exception as e:error=f"{type(e).__name__}: {e}"
  finally:
   for resource in (f,provider,other):
    if resource:
     try:resource.close()
     except Exception as e:cleanup_complete=False;cleanup.append(type(e).__name__+": "+str(e))
  return "; ".join(([error]if error else[])+cleanup)or None
 def auth(f,p,o):
  v=f.process(f.submit());expect(len(p.received)==1 and v["result"]["status"]=="unavailable","auth retried or success")
 def invalid(f,p,o):
  v=f.process(f.submit());expect(v["result"]["status"]=="invalid_response"and len(p.received)==1,"malformed response actionable")
 def fallback(f,p,o):
  v=f.process(f.submit(route_ids=["span-native","jev-native"]));expect(len(p.received)==1 and len(o.received)==1 and len(v["attempts"])==2 and v["result"]["payload"]["returned_model"]=="jev-1.14.0","fallback/attempt bound incorrect")
 def deadline(f,p,o):
  started=time.monotonic();v=f.process(f.submit());elapsed=time.monotonic()-started
  expect(elapsed<3 and len(p.received)<=2 and v["result"]["status"]in("expired","unavailable","abstained"),"120s provider escaped total bound")
 def responsive(f,p,o):
  id=f.submit();box=[]
  t=threading.Thread(target=lambda:box.append(f.process(id)));t.start();expect(p.arrived.wait(5),"provider never started")
  start=time.monotonic();f.call("identity.describe",{},component="14.1");expect(time.monotonic()-start<1,"provider wait blocked control")
  t.join(5);expect(not t.is_alive(),"provider process leaked")
 def queue(f,p,o):
  f.submit();f.reject("decision.jobs.submit",f.submission(),"DECISION_OVERLOADED");expect(not p.received,"admission invoked provider")
 def active(f,p,o):
  id=f.submit(mode="background",deadline_ms=10000);second=f.submit(mode="background",deadline_ms=10000);box=[]
  t=threading.Thread(target=lambda:box.append(f.process(id)));t.start();expect(p.arrived.wait(5),"no active work")
  f.reject("decision.jobs.process",{"decision_id":second},"DECISION_OVERLOADED");t.join(12);expect(not t.is_alive()and len(p.received)==1,"active limit exceeded")
 def budget(f,p,o):
  v=f.process(f.submit());expect(v["result"]["status"]=="budget_exhausted"and not p.received,"unpriced/over-budget send escaped")
 def rate(f,p,o):
  f.process(f.submit());v=f.process(f.submit());expect(len(p.received)==1 and v["result"]["payload"]["rejection_reason"]=="DECISION_RATE_LIMIT","route rate unbounded")
 def circuit(f,p,o):
  f.process(f.submit());v=f.process(f.submit());expect(len(p.received)==1 and v["result"]["payload"]["rejection_reason"]=="DECISION_CIRCUIT_OPEN","open circuit sent")
 def stale_admission(f,p,o):
  pack=f.packet();f.advance();f.reject("decision.jobs.submit",f.submission(pack),"DECISION_STALE");expect(not p.received,"stale admission sent")
 def stale_completion(f,p,o):
  id=f.submit(mode="background",deadline_ms=10000);box=[];t=threading.Thread(target=lambda:box.append(f.process(id)));t.start();expect(p.arrived.wait(5),"no provider request");f.advance();p.release.set();t.join(5)
  expect(box and box[0]["result"]["payload"]["status"]=="abstained"and box[0]["result"]["payload"]["rejection_reason"]=="stale-at-completion","stale result not refused: "+json.dumps(box))
 def cancel_queued(f,p,o):
  id=f.submit();f.call("decision.jobs.cancel",{"decision_id":id});expect(f.status(id)["state"]=="CANCELLED"and not p.received,"queued cancellation sent")
 def cancel_running(f,p,o):
  id=f.submit();box=[];t=threading.Thread(target=lambda:box.append(f.process(id)));t.start();expect(p.arrived.wait(5),"no active request")
  f.call("decision.jobs.cancel",{"decision_id":id});t.join(5);expect(not t.is_alive()and f.status(id)["state"]=="CANCELLED"and len(p.received)==1,"running cancellation leaked/resubmitted")
 def restart(f,p,o):
  id=f.submit(mode="background",deadline_ms=10000);f.stop();f.start();expect(f.process(id)["state"]=="COMPLETED"and len(p.received)==1,"durable queued work lost/repeated")
 def expired(f,p,o):
  id=f.submit(deadline_ms=1000);time.sleep(1.05);v=f.process(id);expect(v["state"]=="EXPIRED"and not p.received,"expired queue sent")
 def slow_freshness(f,p,o):
  id=f.submit();f.sql("UPDATE public.fixture_decision_delay SET seconds=3")
  started=time.monotonic();f.reject("decision.jobs.process",{"decision_id":id},"TX_TIMEOUT")
  expect(time.monotonic()-started<3 and not p.received,"slow primary freshness caused a late external send")
  f.sql("UPDATE public.fixture_decision_delay SET seconds=0")
  expect(f.process(id)["state"]=="EXPIRED"and not p.received,"expired slow-freshness job dispatched")
 def restart_inflight(f,p,o):
  id=f.submit();box=[]
  def dispatch():
   try:box.append(f.process(id))
   except Exception as e:box.append({"interrupted":str(e)})
  t=threading.Thread(target=dispatch);t.start();expect(p.arrived.wait(5),"provider did not start")
  stopped=time.monotonic();f.stop();expect(time.monotonic()-stopped<3,"shutdown did not abort pending provider")
  t.join(5);expect(not t.is_alive(),"inflight HTTPS caller leaked")
  f.start();time.sleep(2.1);v=f.process(id)
  expect(v["state"]in("EXPIRED","COMPLETED")and len(v["attempts"])==1 and len(p.received)==1,"restart lost or resent uncertain inflight work")
 def completion_deadline(f,p,o):
  f.sql("UPDATE public.fixture_decision_delay SET seconds=3,after_response=true")
  id=f.submit()
  started=time.monotonic();v=f.process(id);elapsed=time.monotonic()-started
  expect(elapsed<3 and v["state"]=="EXPIRED"and v["result"]["payload"]["status"]=="expired","slow completion freshness escaped total job deadline: "+json.dumps({"elapsed":elapsed,"result":v}))
  expect(len(p.received)==1 and v["result"]["payload"]["raw_output"].get("answers",{}).get("urgent",{}).get("noul")==.8,"expired completion lost bounded raw response: "+json.dumps(v["result"]))
 def admission_deadline(f,p,o):
  inp=f.submission();f.sql("UPDATE public.fixture_decision_delay SET seconds=3")
  started=time.monotonic();f.reject("decision.jobs.submit",inp,"TX_TIMEOUT")
  expect(time.monotonic()-started<3 and not p.received,"slow packet admission exceeded total deadline")
  expect(f.sql("SELECT count(*)::int n FROM hyperfide.decision_jobs")[0]["n"]==0,"timed out admission committed a job")
 def semantic_lock_order(f,p,o):
  inp=f.submission(mode="background",deadline_ms=10000);box=[];t=None
  script="""import {createRequire} from 'node:module';
const pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg'),c=new pg.Client({connectionString:process.env.DATABASE_URL}),s=JSON.parse(process.argv[1]);
try{await c.connect();await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[s.organisation+':'+s.run+':finding-disposition']);
console.log('locked');await new Promise(resolve=>process.stdin.once('data',resolve));
await c.query('UPDATE hyperfide.runs SET state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',[s.organisation,s.run]);await c.query('COMMIT');console.log('committed');}
finally{await c.end();}"""
  writer=subprocess.Popen(["node","--input-type=module","-e",script,json.dumps(f.ids)],cwd=ROOT,env=f.env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   ready,_,_=select.select([writer.stdout],[],[],5);expect(ready and writer.stdout.readline().strip()=="locked","actual assurance writer did not hold barrier")
   t=threading.Thread(target=lambda:box.append(f.invoke("decision.jobs.submit",inp,component="20.4")));t.start()
   deadline=time.monotonic()+4;waiting=[]
   while time.monotonic()<deadline:
    waiting=f.sql("SELECT a.pid,(SELECT count(*)::int FROM pg_locks l WHERE l.pid=a.pid AND l.relation='hyperfide.runs'::regclass AND l.mode='RowShareLock' AND l.granted) AS run_locks FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event='advisory'")
    if waiting:break
    time.sleep(.03)
   expect(waiting and all(row["run_locks"]==0 for row in waiting),"decision waited for semantic barrier while retaining principal/run locks: "+json.dumps(waiting))
   out,err=writer.communicate("continue\n",timeout=4);expect(writer.returncode==0 and "committed"in out,"writer failed under concurrent decision guard: "+err)
   t.join(6);expect(not t.is_alive() and box and box[0][1].get("error",{}).get("code")=="DECISION_STALE","concurrent semantic writer was not observed as stale: "+json.dumps(box))
   expect(not p.received,"stale semantic packet invoked provider")
  finally:
   if writer.poll()is None:
    writer.kill();writer.communicate(timeout=5)
   if t:t.join(6)
 def account_quota(f,p,o):
  # Both sends must fall inside one real fixed-minute quota window.
  until_next=60-time.time()%60
  if until_next<6:time.sleep(until_next+.05)
  f.process(f.submit(mode="background",deadline_ms=10000));v=f.process(f.submit(route_ids=["jev-native"],mode="background",deadline_ms=10000))
  expect(len(p.received)==1 and not o.received and v["result"]["payload"]["rejection_reason"]=="DECISION_RATE_LIMIT","routes sharing one account bypassed its global quota: "+json.dumps({"first_sends":len(p.received),"second_sends":len(o.received),"result":v["result"]}))
 cases=[(12,auth,"auth",0,None,None),(13,invalid,"invalid",0,None,None),(14,fallback,"overload",0,None,"valid"),
 (15,deadline,"valid",120,None,None),(16,responsive,"valid",120,None,None),(17,queue,"valid",0,{"max_queued":1},None),
 (18,active,"valid",120,{"max_active":1},None),(19,budget,"valid",0,{"max_job_cost_microusd":0},None),
 (20,rate,"valid",0,{"requests_per_minute":1},None),(21,circuit,"overload",0,{"circuit_failures":1},None),
 (22,stale_admission,"valid",0,None,None),(23,stale_completion,"held",0,None,None),
 (24,cancel_queued,"valid",0,None,None),(25,cancel_running,"valid",120,None,None),
 (26,restart,"valid",0,None,None),(27,expired,"valid",0,None,None),(32,slow_freshness,"valid",0,None,None),(33,restart_inflight,"valid",120,None,None),(37,account_quota,"valid",0,{"requests_per_minute":1},"valid"),(38,completion_deadline,"valid",0,None,None),(39,admission_deadline,"valid",0,None,None),(40,semantic_lock_order,"valid",0,None,None)]
 # basic emitted nonsequential supplemental assertions; caller canonicalises recorded observations below.
 for index,fn,mode,delay,settings,second in cases:
  error=scenario(index,fn,mode,delay,settings,second)
  if error:failed.append(IDS[index])
  observations[IDS[index]]=error or"observed"
  print("OBSERVATION "+json.dumps({"id":IDS[index],"actual":error or"observed"}),file=sys.stderr,flush=True)
 for i in IDS:
  actual=observations.get(i,"missing observation")
  if actual!="observed"and i not in failed:failed.append(i)
  print(json.dumps({"type":"assertion","id":i,"expected":"observed","actual":actual}),flush=True)
 print(json.dumps({"type":"cleanup","resources":[],"complete":cleanup_complete}),flush=True)
 return 1 if failed else 0
if __name__=="__main__":sys.exit(main())
