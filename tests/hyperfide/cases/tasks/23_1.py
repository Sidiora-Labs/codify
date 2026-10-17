#!/usr/bin/env python3
"""Real signed-HTTPS component qualification for fleet observability.

Synthetic workload records are explicitly fixtures. No fixture grants a fabricated
InvocationContext; the actual identity authority verifies Ed25519 proofs and the
actual primary gateway guards every request.
"""
from __future__ import annotations
import base64,copy,hashlib,http.client,importlib.util,json,os,select,signal,socket,ssl,subprocess,sys,tempfile,time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit

ROOT=Path(__file__).resolve().parents[4]
TASK="23.1"
FAILED=[]; IDS=[]; OBSERVATIONS=[]
def uid(n): return f"23000000-0000-4000-8000-{n:012d}"
ORG,PROJECT,REPO,SPEC,RUN,RUN2,PACKAGE,TASK_ID,ATTEMPT,POOL,SANDBOX,SLOT,LEADER,VERIFIER,OPERATOR,CREDENTIAL,VERIFIER_CREDENTIAL,EPOCH,ARTIFACT=[uid(i) for i in range(1,20)]
DIGEST="sha256:"+"a"*64
def set_task(task):
 global TASK
 TASK=task
 IDS.clear();FAILED.clear();OBSERVATIONS.clear()
def database(): return "hf_task_"+TASK.replace(".","_")+"_qualification"
def output():
 p=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/task-"+TASK+"-standalone"))/"observability"
 p.mkdir(parents=True,exist_ok=True);return p
def db_env(name=None):
 env=os.environ.copy();name=name or database();env["PGDATABASE"]=name
 parsed=urlsplit(env["DATABASE_URL"])
 env["DATABASE_URL"]=urlunsplit((parsed.scheme,parsed.netloc,"/"+name,parsed.query,parsed.fragment))
 return env
def sql(query,name=None,allow_error=False):
 r=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose","-d",name or database()],input=query,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=db_env(name),cwd=ROOT,timeout=45)
 if r.returncode and not allow_error: raise AssertionError("PostgreSQL fixture rejected SQL: "+" | ".join(x for x in r.stderr.splitlines() if x.startswith(("ERROR:","DETAIL:","CONTEXT:")))[:1200])
 return r
def expect(value,message="observed result differs"):
 if not value: raise AssertionError(message)
def check(identity,fn):
 IDS.append(identity)
 try: fn();actual="observed"
 except Exception as e: FAILED.append(identity);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def cleanup():
 try:
  name=database();sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+name+"' AND pid<>pg_backend_pid();","postgres")
  sql('DROP DATABASE IF EXISTS "'+name+'";',"postgres")
  absent=sql("SELECT count(*) FROM pg_database WHERE datname='"+name+"';","postgres").stdout.strip()=="0"
  (output()/"database-absence.json").write_text(json.dumps({"database":name,"observed_absent":absent,"observer":"PostgreSQL pg_database after explicit DROP"})+"\n")
  print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":"hf-task-"+TASK+"-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"observability/database-absence.json"}]}),flush=True)
  return 0 if absent else 1
 except Exception:
  print(json.dumps({"type":"cleanup","complete":False,"resources":[{"id":"hf-task-"+TASK+"-database","status":"unknown"}]}),flush=True);return 1
def seed():
 source="fixture intent"
 h="sha256:"+hashlib.sha256(source.encode()).hexdigest()
 common=f"""
 INSERT INTO hyperfide.organisations(id,name) VALUES('{ORG}','observability-fixture');
 INSERT INTO hyperfide.projects(organisation_id,id,name) VALUES('{ORG}','{PROJECT}','fixture');
 INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES('{ORG}','{REPO}','{PROJECT}','fixture','https://example.invalid/fixture.git');
 INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES('{ORG}','{REPO}',repeat('a',40)),('{ORG}','{REPO}',repeat('b',40));
 INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version) VALUES('{ORG}','{SPEC}','{PROJECT}','{h}','{source}','{{}}',1);
 INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch,state) VALUES('{ORG}','{RUN}','{PROJECT}','{SPEC}','{DIGEST}','{EPOCH}','RUNNING'),('{ORG}','{RUN2}','{PROJECT}','{SPEC}','{DIGEST}','{EPOCH}','RUNNING');
 INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES('{ORG}','{RUN}','{REPO}',repeat('a',40),'refs/heads/main');
 INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES('{ORG}','{RUN}','{PACKAGE}','fixture',1);
 INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES('{ORG}','{RUN}','{TASK_ID}','1.1','{PACKAGE}','{SPEC}','{DIGEST}','{{}}',1);
 INSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region) VALUES('{ORG}','{POOL}','fixture','synthetic-account','synthetic-environment','synthetic-region');
 INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,boot_generation,observed_state) VALUES('{ORG}','{SANDBOX}','{POOL}',1,'RUNNING');
 INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES('{ORG}','{SLOT}','{SANDBOX}','agent-0',1,'AGENT');
 INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,sandbox_id,slot_id,sandbox_boot_generation,execution_state) VALUES('{ORG}','{RUN}','{ATTEMPT}','{TASK_ID}',1,'{EPOCH}','{DIGEST}','{SANDBOX}','{SLOT}',1,'RUNNING');
 INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,state) VALUES('{ORG}','{RUN}','{LEADER}','LEADER','fixture','fixture','fixture-leader','RUNNING'),('{ORG}','{RUN}','{VERIFIER}','VERIFIER','fixture','fixture','fixture-verifier','RUNNING');
 INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,retention_class) VALUES('{ORG}','{RUN}','{ARTIFACT}','{DIGEST}',1,'component-measurement-fixture','synthetic-report','COMPLETE','RUN');
 """
 sql("BEGIN;\n"+common+"\nCOMMIT;")
class Fixture:
 def __init__(self,task,components,extra_env=None):
  set_task(task);self.components_ids=components;self.extra_env=extra_env or {};self.process=None;self.temp=None;self.calls=[]
 def __enter__(self):
  try:return self._enter()
  except BaseException:
   self.__exit__(None,None,None)
   raise
 def _enter(self):
  for field in ("DATABASE_URL","PGHOST","PGPORT","PGUSER"): expect(os.environ.get(field),"Required PostgreSQL fixture is absent: "+field)
  self.temp=tempfile.TemporaryDirectory(prefix="hf-observability-"+TASK+"-");self.base=Path(self.temp.name)
  subprocess.run(["createdb",database()],env=db_env("postgres"),check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
  paths=["0001-authority.sql","0014-enrollment.sql","0023-observability.sql"]
  for name in paths:
   p=ROOT/"services/hyperfide/migrations"/name;expect(p.is_file(),"Actual dependency migration is absent: "+name)
   r=subprocess.run(["psql","-X","-q","-v","ON_ERROR_STOP=1","--single-transaction","-d",database(),"-f",str(p)],env=db_env(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
   expect(r.returncode==0,"Pinned actual migration failed: "+name+" "+r.stderr.decode()[-1000:])
   version=int(name.split("-")[0]);checksum="sha256:"+hashlib.sha256(p.read_bytes()).hexdigest()
   sql(f"INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES({version},'{p.stem}','{checksum}');")
  seed()
  self.component_dir=self.base/"components";self.component_dir.mkdir();self.fragments={}
  def add(identity):
   if identity in self.fragments:return
   p=ROOT/"services/hyperfide/components"/(identity+".json");expect(p.is_file(),"Actual component dependency absent: "+identity)
   declaration=json.loads(p.read_text());self.fragments[identity]=declaration
   for d in declaration["requires"]:add(d)
   (self.component_dir/p.name).write_bytes(p.read_bytes())
  for identity in self.components_ids:add(identity)
  self.actions=sorted({a for fragment in self.fragments.values() for a in fragment["actions"]})
  self.policy={"schema_version":1,"programme_id":"observability-component-fixture","repository":"fixture/repo","spec_revision":"task-"+TASK+"-reviewed","policy_revision":1,"status":"ACTIVE","approval":{"decision":"APPROVED","record_id":"programme-owner-authorized-implementation","spec_revision":"task-"+TASK+"-reviewed","policy_revision":1},"allowed_roles":["control"],"allowed_actions":["programme.activate"]+self.actions}
  (self.base/"policy.json").write_text(json.dumps(self.policy))
  with socket.socket() as sock:sock.bind(("127.0.0.1",0));self.port=sock.getsockname()[1]
  self.origin="https://127.0.0.1:"+str(self.port);self.keys={}
  principals=[]
  for role,actor,credential in [("OPERATOR",OPERATOR,CREDENTIAL),("VERIFIER",VERIFIER,VERIFIER_CREDENTIAL),("LEADER",LEADER,uid(20))]:
   private=self.base/(role+".pem")
   script="const c=require('node:crypto'),f=require('node:fs');const k=c.generateKeyPairSync('ed25519');f.writeFileSync(process.argv[1],k.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});process.stdout.write(k.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url'));"
   pub=subprocess.run(["node","-e",script,str(private)],check=True,stdout=subprocess.PIPE,text=True,timeout=10).stdout
   self.keys[role]=(private,credential)
   principals.append({"credential_id":credential,"organisation_id":ORG,"run_id":RUN,"actor_id":actor,"role":role,"public_key_b64":pub,"deployment_epoch":EPOCH,"allowed_actions":self.actions,"expires_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+3600))})
  cfg={"schema_version":1,"origin":self.origin,"clock_skew_seconds":30,"grant_ttl_seconds":60,"credential_ttl_seconds":3600,"principals":principals}
  (self.base/"identity.json").write_text(json.dumps(cfg));os.chmod(self.base/"identity.json",0o600)
  cert,key=self.base/"tls-cert.pem",self.base/"tls-key.pem"
  subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-keyout",str(key),"-out",str(cert),"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30);os.chmod(key,0o600)
  self.tls=ssl.create_default_context(cafile=str(cert))
  env=db_env();env.update(self.extra_env);env["HF_IDENTITY_CONFIG_FILE"]=str(self.base/"identity.json");env["HYPERFIDE_OBSERVABILITY_ALLOW_REPLAY"]="1"
  self.process=subprocess.Popen(["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(self.base/"policy.json"),"--spec-revision",self.policy["spec_revision"],"--components",str(self.component_dir),"--module-root",str(ROOT/"services/hyperfide/dist"),"--mode","https","--host","127.0.0.1","--port",str(self.port),"--tls-cert",str(cert),"--tls-key",str(key)],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  deadline=time.monotonic()+30;ready=False;diagnostic=[]
  while time.monotonic()<deadline:
   if self.process.poll() is not None:break
   if select.select([self.process.stderr],[],[],0.1)[0]:
    line=self.process.stderr.readline();diagnostic.append(line)
    try:ready=json.loads(line).get("event")=="ready"
    except Exception:pass
    if ready:break
  expect(ready,"Actual HTTPS service did not become ready: "+"".join(diagnostic)[-1200:])
  return self
 def request(self,component,action,value=None,role="OPERATOR",run=RUN,unsigned=False):
  import uuid as uuidlib
  identifier=str(uuidlib.uuid4());payload={"run_id":run,"component":component,"action":action,"input":{} if value is None else value,"expected_version":None,"authority":None};raw_payload=json.dumps(payload,separators=(",",":")).encode()
  body=json.dumps({"protocol_version":1,"operation_id":identifier,"idempotency_key":identifier,"payload_digest":"sha256:"+hashlib.sha256(raw_payload).hexdigest(),"correlation_id":identifier,"causation_id":None,"payload_b64":base64.urlsafe_b64encode(raw_payload).decode().rstrip("=")},separators=(",",":")).encode()
  private,credential=self.keys[role];stamp=str(int(time.time()));nonce=str(uuidlib.uuid4())
  headers={"Content-Type":"application/json"}
  if not unsigned:
   script="import fs from 'node:fs';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';const [file,origin,id,time,nonce]=process.argv.slice(1);const {signingBytes}=await import(pathToFileURL("+json.dumps(str(ROOT/"services/hyperfide/dist/transport/protocol.js"))+").href);const chunks=[];for await(const c of process.stdin)chunks.push(c);const body=Buffer.concat(chunks);process.stdout.write(crypto.sign(null,signingBytes(origin,'/v1/invoke',{id,time,nonce},body),fs.readFileSync(file)).toString('base64url'));"
   signature=subprocess.run(["node","--input-type=module","-e",script,str(private),self.origin,credential,stamp,nonce],input=body,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=10).stdout.decode()
   headers.update({"hf-credential-id":credential,"hf-request-time":stamp,"hf-request-nonce":nonce,"hf-request-signature":signature})
  client=http.client.HTTPSConnection("127.0.0.1",self.port,context=self.tls,timeout=15)
  start=time.monotonic()
  try:client.request("POST","/v1/invoke",body=body,headers=headers);response=client.getresponse();raw=response.read();result=json.loads(raw)
  finally:client.close()
  elapsed=(time.monotonic()-start)*1000
  self.calls.append({"component":component,"action":action,"ok":result.get("ok"),"error_code":result.get("error",{}).get("code"),"response_bytes":len(raw),"elapsed_ms":elapsed})
  return result
 def ok(self,component,action,value=None,**kw):
  r=self.request(component,action,value,**kw);expect(r.get("ok") is True,"Service refused positive operation: "+str(r.get("error")));return r["result"]
 def reject(self,component,action,value,code=None,**kw):
  r=self.request(component,action,value,**kw);expect(r.get("ok") is False,"Negative request succeeded")
  if code:expect(r.get("error",{}).get("code")==code,"Rejection differs: "+str(r.get("error")))
  return r
 def __exit__(self,typ,value,tb):
  closed=True
  if self.process:
   self.process.send_signal(signal.SIGTERM)
   try:self.process.communicate(timeout=12)
   except subprocess.TimeoutExpired:self.process.kill();self.process.communicate();closed=False
   with socket.socket() as sock:closed=closed and sock.connect_ex(("127.0.0.1",self.port))!=0
  (output()/"observations.json").write_text(json.dumps({"scope":"task-component","simulation":"Synthetic workload, real PostgreSQL/HTTPS/signature/registered service","requests":self.calls,"server_observed_closed":closed},sort_keys=True)+"\n")
  if self.temp:self.temp.cleanup()
  expect(closed,"Real service listener did not stop")
def finish():
 (output()/"assertion-inventory.json").write_text(json.dumps({"task":TASK,"ids":IDS,"failed":FAILED,"scope":"task-component","full_cases":"INCOMPLETE"})+"\n")
 return 1 if FAILED else 0
def views_cases(f):
 check("observability.views.registered",lambda:expect(f.ok("23.1","fleet.views.describe")["activity_is_progress"] is False))
 check("observability.views.primary-snapshot",lambda:expect(f.ok("23.1","fleet.views.snapshot")["freshness"]["route"]=="PRIMARY"))
 check("observability.views.cross-run-denied",lambda:f.reject("23.1","fleet.views.snapshot",{},run=RUN2))
 check("observability.views.unsigned-denied",lambda:f.reject("23.1","fleet.views.snapshot",{},unsigned=True))
 check("observability.views.input-closed",lambda:f.reject("23.1","fleet.views.snapshot",{"sql":"SELECT 1"},"OBSERVABILITY_INPUT_INVALID"))
 check("observability.views.page-budget",lambda:f.reject("23.1","fleet.views.snapshot",{"limit":501},"OBSERVABILITY_INPUT_INVALID"))
 record={"entity_type":"ATTEMPT","entity_id":ATTEMPT,"producer_sequence":"1","observed_state":"QUIESCENT","observed_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()-60)),"source_digest":DIGEST,"activity_bytes":"1073741824"}
 check("observability.views.record-observation",lambda:expect(f.ok("23.1","fleet.views.observe",record)["recorded"]))
 def distinct():
  r=f.ok("23.1","fleet.views.snapshot");expect(r["attempts"][0]["desired_state"]=="RUNNING" and r["observations"][0]["observed_state"]=="QUIESCENT")
 check("observability.views.desired-observed-distinct",distinct)
 check("observability.views.stale-visible",lambda:expect(f.ok("23.1","fleet.views.snapshot")["observations"][0]["freshness"]=="STALE"))
 check("observability.views.log-volume-not-progress",lambda:expect(f.ok("23.1","fleet.views.snapshot")["observations"][0]["activity_is_qualified_progress"] is False))
 check("observability.views.sequence-replay",lambda:expect(f.ok("23.1","fleet.views.observe",record)["replayed"]))
 check("observability.views.sequence-conflict",lambda:f.reject("23.1","fleet.views.observe",dict(record,observed_state="RUNNING"),"OBSERVABILITY_CONFLICT"))
 def future():
  r=dict(record,producer_sequence="2",observed_at=time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+600)));f.reject("23.1","fleet.views.observe",r,"OBSERVABILITY_INPUT_INVALID")
 check("observability.views.future-time-rejected",future)
 check("observability.views.nonowner-observer-denied",lambda:f.reject("23.1","fleet.views.observe",dict(record,producer_sequence="2"),"OBSERVABILITY_PRODUCER_FORBIDDEN",role="VERIFIER"))
 def priority():
  own=dict(record,entity_type="SESSION",entity_id=VERIFIER,producer_sequence="1")
  f.ok("23.1","fleet.views.observe",own,role="VERIFIER")
  f.ok("23.1","fleet.views.observe",dict(own,observed_state="RUNNING"))
  f.reject("23.1","fleet.views.observe",dict(own,producer_sequence="2"),"OBSERVABILITY_STALE_OBSERVATION",role="VERIFIER")
 check("observability.views.trusted-observer-priority",priority)
 check("observability.views.entity-pagination",lambda:expect(f.ok("23.1","fleet.views.entities",{"kind":"SESSION","limit":1})["pagination"]["next"] is not None))
 check("observability.views.evidence-unknown",lambda:expect(f.ok("23.1","fleet.views.snapshot")["evidence"]["status"]=="UNKNOWN"))
 check("observability.views.no-fabricated-release-count",lambda:expect(f.ok("23.1","fleet.views.snapshot")["progress"]["integrated_outcome_count"] is None))
 def graph():
  for n in [100,101]:
   sql(f"INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES('{ORG}','{RUN}','{uid(n)}','graph-{n}','{PACKAGE}','{SPEC}','{DIGEST}','{{}}',1)")
  sql(f"INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone) VALUES('{ORG}','{RUN}','{uid(100)}','{RUN}','{TASK_ID}','QUALIFIED'),('{ORG}','{RUN}','{uid(101)}','{RUN}','{uid(100)}','QUALIFIED')")
  r=f.ok("23.1","fleet.views.snapshot")["critical_path"];expect(r["complete"] and [n["id"] for n in r["path"]]==[TASK_ID,uid(100),uid(101)] and r["estimated_duration_ms"] is None)
 check("observability.views.actual-critical-path",graph)
 def cycle():
  sql(f"INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone) VALUES('{ORG}','{RUN}','{TASK_ID}','{RUN}','{uid(101)}','QUALIFIED')")
  expect(f.ok("23.1","fleet.views.snapshot")["critical_path"]["complete"] is False)
 check("observability.views.cycle-explicit",cycle)
 def large():
  sql(f"INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) SELECT '{ORG}','{RUN}',('24000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'scale-'||lpad(n::text,5,'0'),'{PACKAGE}','{SPEC}','{DIGEST}','{{}}',1 FROM generate_series(1,1483) n")
  r=f.ok("23.1","fleet.views.snapshot",{"limit":500});expect(len(r["tasks"])==500 and r["pagination"]["next"] and f.calls[-1]["response_bytes"]<1024*1024)
 check("observability.views.large-run-bounded",large)
def main():
 set_task("23.1")
 if "--cleanup" in sys.argv:return cleanup()
 try:
  with Fixture(TASK,["23.1"]) as fixture:views_cases(fixture)
  return finish()
 except Exception as error:
  print(json.dumps({"type":"fatal","error":type(error).__name__+": "+str(error)}),flush=True);return 1
if __name__=="__main__":raise SystemExit(main())
