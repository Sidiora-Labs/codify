#!/usr/bin/env python3
"""Actual PostgreSQL + registered control-process specification qualification."""
from __future__ import annotations
import base64,copy,hashlib,importlib.util,json,os,re,shutil,stat,subprocess,sys,tempfile,uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[4]/"tests/hyperfide/support"))
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("storage_fixture",Path(__file__).with_name("4_1.py"))
storage=importlib.util.module_from_spec(spec);spec.loader.exec_module(storage)
DB="hf_task_2_1_qualification"
storage.DATABASE=DB;storage.RESOURCE="hf-task-2.1-database"
IDS=[];FAILED=[];OBS=[]
ORG="10000000-0000-0000-0000-000000000021";PROJECT="20000000-0000-0000-0000-000000000021"
REPO="30000000-0000-0000-0000-000000000021";EPOCH="40000000-0000-0000-0000-000000000021";OID="a"*40
ACTIONS=["programme.activate","authority.schema.bootstrap","spec.import","spec.inspect","spec.export","spec.projection.check","work.synthetic"]
SOURCE=('# preserve\r\n[meta]\r\nslug = "synthetic"\r\n[feature.1]\r\nname = "one"\r\n'
 '[unknown.extra]\r\nvalue = "${UNTRUSTED_VALUE} # literal"\r\n[req.1]\r\nac_1 = "actual"\r\n'
 '[acceptance.1]\r\nqualification = "UNRUN"\r\n[task.1.1]\r\nstatus = "done"\r\nwave = 0\r\n'
 'requires = []\r\nreqs = ["1.1"]\r\ntouches = ["src/example.c"]\r\n').encode()
def expect(value,message):
 if not value:raise AssertionError(message)
def sql(command,db=None,allow_error=False):return storage.sql(command,database=db or DB,allow_error=allow_error).stdout.strip()
def check(identity,callback):
 IDS.append(identity)
 try:callback();actual="observed"
 except Exception as error:actual=type(error).__name__+": "+str(error);FAILED.append(identity)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def outdir():
 p=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/task-2.1-standalone"))/"spec";p.mkdir(parents=True,exist_ok=True);return p
BOOTSTRAP_NODE="import{createResourceContainer}from'./services/hyperfide/dist/storage/runtime.js';import{bootstrapAcceptedIntentWithGateway}from'./services/hyperfide/dist/spec/bootstrap.js';let text='';for await(const c of process.stdin)text+=c;const v=JSON.parse(text),r=createResourceContainer({role:'control',env:process.env,signal:new AbortController().signal});try{const result=await bootstrapAcceptedIntentWithGateway(r.gateway,v.scope,v.metadata,v.input,v.deployment_id);process.stdout.write(JSON.stringify({ok:true,result}));}catch(error){process.stdout.write(JSON.stringify({ok:false,error:{code:typeof error.code==='string'?error.code:'BOOTSTRAP_FAILED'}}));}finally{await r.close();}"
class Service:
 def __init__(self,base):
  from identity_fixture import IdentityFixture,sha
  import threading
  self.base=base;self.root=base/"sources";self.root.mkdir();self.lock=threading.RLock();self.credentials={};self.counter=0
  def setup(f):
   global DB,ORG,PROJECT,REPO,EPOCH,OID,ACTIONS
   self.f=f;DB=f.database;storage.DATABASE=DB
   for version,name in [(2,"0002-spec"),(4,"0004-durability")]:
    raw=(ROOT/("services/hyperfide/migrations/"+name+".sql")).read_bytes()
    f.sql("BEGIN;"+raw.decode()+"INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES("+str(version)+",'"+name+"','"+sha(raw)+"');COMMIT;")
   self.deployment_id=str(uuid.uuid4())
   ORG=str(uuid.uuid4());PROJECT=str(uuid.uuid4());REPO=str(uuid.uuid4());EPOCH=str(uuid.uuid4())
   OID=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
   fmt=subprocess.check_output(["git","rev-parse","--show-object-format"],cwd=ROOT,text=True).strip()
   f.actions=list(dict.fromkeys(f.actions+["system.describe","work.synthetic"]));ACTIONS=f.actions
   self.metadata={"organisation":{"id":ORG,"name":"actual-intake-fixture"},"project":{"id":PROJECT,"name":"actual-intake-fixture"},"repositories":[{"id":REPO,"name":"actual-checkout","url":"https://github.com/Sidiora-Labs/codify.git","object_format":fmt,"checkout_root":str(ROOT),"source_objects":[{"object_id":OID,"object_type":"commit"}]}]}
   f.sql("INSERT INTO hyperfide.authority_epochs(deployment_id,epoch,activation_kind,state,fence_id,proof_digest) VALUES($1,$2,'BOOTSTRAP','ACTIVE','fixture-known-approved-epoch',$3)",[self.deployment_id,EPOCH,sha(b"fixture-approved-bootstrap-epoch")])
   self.initial_run=str(uuid.uuid4());initial=self.envelope(self.initial_run);self.initial_input=initial
   result=self._bootstrap(initial,self.initial_run)
   expect(result.get("ok") is True,"Actual offline intake did not accept initial synthetic source: "+str(result.get("error",{}).get("code")))
   self.initial_result=result["result"];f.ids.update(organisation=ORG,project=PROJECT,run=self.initial_run,epoch=EPOCH,spec=result["result"]["spec_revision_id"])
   config=json.loads(f.identity_config.read_text())
   for record in config["principals"]:record.update(organisation_id=ORG,run_id=self.initial_run,deployment_epoch=EPOCH,allowed_actions=f.actions)
   f.identity_config.write_text(json.dumps(config));f.identity_config.chmod(0o600)
   policy=json.loads(f.policy.read_text());policy.update(programme_id=self.initial_run,allowed_actions=f.actions);f.policy.write_text(json.dumps(policy))
   self.credentials[self.initial_run]=f.ids["operator"]
   f.env.update(HF_SPEC_ALLOWED_ROOT=str(self.root),UNTRUSTED_VALUE="must-not-interpolate")
  self.f=IdentityFixture(extra_components=("2.1",),extra_setup=setup)
  (outdir()/"database-names.json").write_text(json.dumps({"databases":[self.f.database]}))
 def _bootstrap(self,value,run,overrides=None):
  env=self.f.env.copy();env.update(overrides or {})
  data={"scope":{"organisation_id":ORG,"project_id":PROJECT,"run_id":run,"authority_epoch":EPOCH,"root":str(self.root),"allowed_actions":ACTIONS},"metadata":self.metadata,"input":value,"deployment_id":self.deployment_id}
  result=subprocess.run(["node","--input-type=module","-e",BOOTSTRAP_NODE],input=json.dumps(data),text=True,capture_output=True,cwd=ROOT,env=env,timeout=60)
  expect(result.returncode==0,"Actual offline intake process failed")
  try:return json.loads(result.stdout)
  except ValueError:raise AssertionError("Actual offline intake returned malformed bounded result")
 def _enrol(self,run):
  with self.lock:
   if run in self.credentials:return
   config=json.loads(self.f.identity_config.read_text());record=copy.deepcopy(config["principals"][0]);credential=str(uuid.uuid4())
   record.update(credential_id=credential,actor_id=credential,run_id=run)
   config["principals"].append(record);self.f.identity_config.write_text(json.dumps(config))
   self.f.stop();self.f.start();self.credentials[run]=credential
 def request(self,action,input,run,component="spec-import",overrides=None):
  if action=="spec.import" and run not in self.credentials:
   result=self._bootstrap(input,run,overrides)
   if result.get("ok"):self._enrol(run)
   OBS.append({"action":action,"transport":"TRUSTED_OFFLINE_INTAKE","ok":result.get("ok"),"error":result.get("error",{}).get("code")})
   return result
  if component=="system":run=self.initial_run
  with self.lock:
   before=self.f.env.copy()
   try:
    if overrides:self.f.env.update(overrides);self.f.stop();self.f.start()
    operation=self.f.operation(component,action,input,run=run)
    status,result=self.f.request(operation,key="operator",credential=self.credentials[run])
    expect(status==200,"Actual signed importer HTTPS dispatch failed")
    OBS.append({"action":action,"transport":"AUTHENTICATED_HTTPS","ok":result.get("ok"),"error":result.get("error",{}).get("code")})
    return result
   finally:
    if overrides:self.f.env=before;self.f.stop();self.f.start()
 def ok(self,*args,**kwargs):
  r=self.request(*args,**kwargs);expect(r.get("ok") is True,"Service rejected operation: "+str(r.get("error",{}).get("code")));return r["result"]
 def reject(self,action,input,run,codes,**kwargs):
  r=self.request(action,input,run,**kwargs);expect(r.get("ok") is False and r.get("error",{}).get("code") in codes,"Expected "+"/".join(codes)+"; observed "+str(r.get("error",{}).get("code")))
 def source(self,content=SOURCE):
  name=uuid.uuid4().hex+".kvx";p=self.root/name;p.write_bytes(content);p.chmod(0o600)
  return {"relative_path":name,"sha256":hashlib.sha256(content).hexdigest(),"size_bytes":str(len(content))}
 def envelope(self,run,source=None):
  return {"run_id":run,"source":source or self.source(),"repositories":[{"repository_id":REPO,"source_object_id":OID,"integration_ref":"refs/heads/main"}],"allowed_actions":ACTIONS,"closure_policy":{"required_evidence":["synthetic.assertion"],"required_review_roles":["VERIFIER"],"publication":"AFTER_QUALIFICATION"},"provenance":None}
def probe(s):
 run=str(uuid.uuid4());value=s.envelope(run);saved={}
 check("spec.service.linked",lambda:expect(any(x["id"]=="spec-import" for x in s.ok("system.describe",{},run,component="system")["components"]),"Disconnected module"))
 check("spec.schema.applied",lambda:expect(sql("SELECT name FROM hyperfide.schema_migrations WHERE version=2;")=="0002-spec","Pinned migration missing"))
 check("spec.schema.checksum",lambda:expect(sql("SELECT checksum FROM hyperfide.schema_migrations WHERE version=2;")=="sha256:"+hashlib.sha256((ROOT/"services/hyperfide/migrations/0002-spec.sql").read_bytes()).hexdigest(),"Migration checksum drift"))
 def imported():
  saved.update(s.ok("spec.import",value,run));expect(saved["state"]=="PENDING_VALIDATION" and saved["counts"]["tasks"]==1,"Import granted readiness")
 check("spec.import.actual",imported)
 check("spec.storage.exact-bytes",lambda:expect(sql("SELECT encode(convert_to(source_content,'UTF8'),'base64') FROM hyperfide.spec_revisions WHERE id='"+saved["spec_revision_id"]+"';").replace("\n","")==base64.b64encode(SOURCE).decode(),"Raw source changed"))
 check("spec.storage.restart",lambda:expect(s.ok("spec.inspect",{"run_id":run},run)["revision_digest"]==saved["revision_digest"],"Restart lost pin"))
 check("spec.storage.unknown-section",lambda:expect(sql("SELECT count(*) FROM hyperfide.spec_revisions s,jsonb_array_elements(s.document->'parsed'->'sections') x WHERE s.id='"+saved["spec_revision_id"]+"' AND x->>'name'='unknown.extra';")=="1","Unknown section dropped"))
 check("spec.storage.literal-env",lambda:expect(sql("SELECT position('${UNTRUSTED_VALUE}' in source_content)>0 FROM hyperfide.spec_revisions WHERE id='"+saved["spec_revision_id"]+"';")=="t","Literal environment token lost"))
 check("spec.history.declared-done",lambda:expect(sql("SELECT state||'|'||(definition->>'declared_status') FROM hyperfide.tasks WHERE run_id='"+run+"';")=="PENDING|done","Declaration became completion"))
 check("spec.history.no-evidence",lambda:expect(sql("SELECT (SELECT count(*) FROM hyperfide.evidence)+(SELECT count(*) FROM hyperfide.compute_leases)+(SELECT count(*) FROM hyperfide.submission_custodies);")=="0","Import fabricated proof"))
 check("spec.intent.repository",lambda:expect(sql("SELECT source_object_id FROM hyperfide.run_repositories WHERE run_id='"+run+"';")==OID,"Repository not pinned"))
 check("spec.intent.closure",lambda:expect(sql("SELECT document->'closure_policy'->>'publication' FROM hyperfide.spec_revisions WHERE id='"+saved["spec_revision_id"]+"';")=="AFTER_QUALIFICATION","Closure not pinned"))
 check("spec.replay.same",lambda:expect(s.ok("spec.import",value,run)["replayed"] is True,"Replay duplicated run"))
 changed=copy.deepcopy(value);changed["closure_policy"]["required_evidence"]=["different.assertion"]
 check("spec.replay.conflict",lambda:s.reject("spec.import",changed,run,["REVISION_CONFLICT"]))
 second=str(uuid.uuid4());changed["run_id"]=second
 check("spec.intent.same-source-new-envelope",lambda:expect(s.ok("spec.import",changed,second)["revision_digest"]!=saved["revision_digest"],"Distinct envelope collapsed"))
 def concurrent_replay():
  rid=str(uuid.uuid4());candidate=copy.deepcopy(value);candidate["run_id"]=rid
  with ThreadPoolExecutor(max_workers=2) as executor:
   results=list(executor.map(lambda _:s.ok("spec.import",candidate,rid),range(2)))
  expect(sorted(row["replayed"] for row in results)==[False,True],"Concurrent retry duplicated or lost import")
  expect(sql("SELECT count(*) FROM hyperfide.runs WHERE id='"+rid+"';")=="1","Concurrent retry duplicated authority")
 check("spec.replay.concurrent",concurrent_replay)
 check("spec.scope.programme",lambda:s.reject("spec.inspect",{"run_id":second},run,["SCOPE_MISMATCH"]))
 check("spec.scope.project",lambda:expect(s.ok("spec.inspect",{"run_id":run},run,overrides={"HF_SPEC_PROJECT_ID":str(uuid.uuid4())})["revision_digest"]==saved["revision_digest"],"Startup environment redirected authenticated project"))
 def badsource(content,code):
  rid=str(uuid.uuid4());v=s.envelope(rid,s.source(content));s.reject("spec.import",v,rid,[code])
  expect(sql("SELECT count(*) FROM hyperfide.runs WHERE id='"+rid+"';")=="0","Rejected input left partial run")
 for name,content,code in [
  ("string",b'[task.1]\ntitle = "bad\n',"SPEC_INVALID"),("duplicate-key",b'[task.1]\nwave = 1\nwave = 2\n',"SPEC_INVALID"),
  ("duplicate-section",b'[task.1]\nwave = 1\n[task.1]\nwave = 2\n',"SPEC_INVALID"),
  ("precision",b'[task.1]\nwave = 9007199254740993\n',"SPEC_INVALID"),("utf8",b'[task.1]\ntitle = "\xff"\n',"SOURCE_INVALID")]:
  check("spec.parse."+name,lambda content=content,code=code:badsource(content,code))
 for name,mutation,codes in [
  ("digest",lambda v:v["source"].update(sha256="0"*64),["DIGEST_MISMATCH"]),
  ("size",lambda v:v["source"].update(size_bytes="1"),["DIGEST_MISMATCH"]),
  ("traversal",lambda v:v["source"].update(relative_path="../escape"),["INVALID_REQUEST"]),
  ("numeric-size",lambda v:v["source"].update(size_bytes=1),["INVALID_REQUEST"]),
  ("leading-zero",lambda v:v["source"].update(size_bytes="01"),["INVALID_REQUEST"]),
  ("broaden-action",lambda v:v.update(allowed_actions=["unapproved.action"]),["INVALID_REQUEST"])]:
  v=copy.deepcopy(value);mutation(v);check("spec.refuse."+name,lambda v=v,codes=codes:s.reject("spec.import",v,run,codes))
 for name,ref in [("colon","refs/heads/a:b"),("lock","refs/heads/a.lock"),("slash","refs/heads/a\\b"),("reflog","refs/heads/@{x}"),("dot","refs/heads/a."),("empty","refs/heads/a//b")]:
  v=copy.deepcopy(value);v["repositories"][0]["integration_ref"]=ref;check("spec.git-ref."+name,lambda v=v:s.reject("spec.import",v,run,["INVALID_REQUEST"]))
 (s.root/"alias.kvx").symlink_to(s.root/value["source"]["relative_path"])
 v=copy.deepcopy(value);v["source"]["relative_path"]="alias.kvx";check("spec.source.symlink",lambda:s.reject("spec.import",v,run,["SOURCE_INVALID"]))
 (s.root/"aliasdir").symlink_to(s.root,target_is_directory=True)
 v=copy.deepcopy(value);v["source"]["relative_path"]="aliasdir/"+value["source"]["relative_path"];check("spec.source.symlink-ancestor",lambda:s.reject("spec.import",v,run,["SOURCE_INVALID"]))
 os.mkfifo(s.root/"fifo");v=copy.deepcopy(value);v["source"].update(relative_path="fifo",size_bytes="0")
 check("spec.source.nonregular",lambda:s.reject("spec.import",v,run,["SOURCE_INVALID"]))
 def changed_source():
  candidate=s.envelope(str(uuid.uuid4()));target=s.root/candidate["source"]["relative_path"]
  preload=s.base/"source-race.mjs"
  preload.write_text("import fs from 'node:fs/promises';import {constants} from 'node:fs';const open=fs.open;fs.open=async(...args)=>{const handle=await open(...args);if(typeof args[1]==='number'&&(args[1]&constants.O_NONBLOCK)){const read=handle.read.bind(handle);let changed=false;handle.read=async(...values)=>{const result=await read(...values);if(!changed){changed=true;await fs.appendFile(process.env.HF_TEST_SOURCE,'# changed\\n');}return result;};}return handle;};")
  s.reject("spec.import",candidate,candidate["run_id"],["SOURCE_CHANGED"],overrides={"NODE_OPTIONS":"--import "+str(preload),"HF_TEST_SOURCE":str(target)})
 check("spec.source.changed-during-read",changed_source)
 rid=str(uuid.uuid4());v=s.envelope(rid,s.source(b'[hyperfide.projection]\nstate_version = "1"\n[task.1]\nwave = 1\n'))
 check("spec.projection.write",lambda:s.reject("spec.import",v,rid,["PROJECTION_WRITE_FORBIDDEN"]))
 labels={key:saved[key] for key in ["revision_digest","spec_generation","state_version"]};labels["run_id"]=run
 check("spec.projection.readonly",lambda:expect(s.ok("spec.projection.check",labels,run)=={"current":True,"writable":False},"Projection acquired write authority"))
 for key in ["spec_generation","state_version"]:
  stale=dict(labels);stale[key]="2";check("spec.projection.stale-"+key,lambda stale=stale:s.reject("spec.projection.check",stale,run,["STALE_PROJECTION"]))
 def pages():
  cursor=None;content=[]
  while True:
   page=s.ok("spec.export",{"run_id":run,"revision_digest":saved["revision_digest"],"cursor":cursor,"max_bytes":53},run)
   expect("statuses_are_history = true" in page["projection_header"],"Projection lacks historical-status labels")
   content.append(base64.b64decode(page["chunk_base64"],validate=True));cursor=page["next_cursor"]
   if cursor is None:break
  expect(b"".join(content)==SOURCE,"Pagination changed bytes")
 check("spec.export.pages",pages)
 def export_reject(cursor,codes):
  s.reject("spec.export",{"run_id":run,"revision_digest":saved["revision_digest"],"cursor":cursor,"max_bytes":16},run,codes)
 check("spec.export.bounds",lambda:export_reject({"spec_generation":"1","state_version":"1","offset_bytes":"99999999"},["INVALID_REQUEST"]))
 check("spec.export.types",lambda:export_reject({"spec_generation":True,"state_version":"1","offset_bytes":"0"},["INVALID_REQUEST"]))
 sql("UPDATE hyperfide.runs SET state_version=state_version+1 WHERE id='"+run+"';")
 check("spec.export.drift",lambda:export_reject({"spec_generation":"1","state_version":"1","offset_bytes":"1"},["STALE_PROJECTION"]))
 def rollback():
  sql("CREATE FUNCTION hyperfide.inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.task_key='99.2' THEN RAISE EXCEPTION 'synthetic late failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER inject_failure BEFORE INSERT ON hyperfide.tasks FOR EACH ROW EXECUTE FUNCTION hyperfide.inject_failure();")
  try:
   rid=str(uuid.uuid4());v=s.envelope(rid,s.source(b'[task.99.1]\nwave = 1\n[task.99.2]\nwave = 1\n'));s.reject("spec.import",v,rid,["DB_UNAVAILABLE"])
   expect(sql("SELECT count(*) FROM hyperfide.runs WHERE id='"+rid+"';")=="0","Late failure retained run")
   expect(sql("SELECT count(*) FROM hyperfide.spec_revisions WHERE source_digest='sha256:"+v["source"]["sha256"]+"';")=="0","Late failure retained source")
  finally:sql("DROP TRIGGER inject_failure ON hyperfide.tasks;DROP FUNCTION hyperfide.inject_failure();")
 check("spec.transaction.late-rollback",rollback)
 check("spec.history.task-revision",lambda:expect(sql("SELECT count(*) FROM hyperfide.task_revisions WHERE run_id='"+run+"';")=="1","Task history absent"))
 def migration_readiness():
  checksum=sql("SELECT checksum FROM hyperfide.schema_migrations WHERE version=2;")
  try:
   sql("UPDATE hyperfide.schema_migrations SET checksum='sha256:"+("b"*64)+"' WHERE version=2;")
   s.reject("spec.import",value,run,["SPEC_SCHEMA_NOT_INITIALISED"])
  finally:sql("UPDATE hyperfide.schema_migrations SET checksum='"+checksum+"' WHERE version=2;")
 check("spec.schema.reject-drift",migration_readiness)
 check("spec.history.immutable-revision",lambda:expect(storage.sql("UPDATE hyperfide.task_revisions SET definition='{}'::jsonb WHERE run_id='"+run+"';",database=DB,allow_error=True).returncode!=0,"Immutable task revision changed"))
 for table in ["task_revisions","spec_amendments","spec_amendment_decisions","proof_registries"]:
  def isolation(table=table):
   result=storage.sql("BEGIN ISOLATION LEVEL REPEATABLE READ; INSERT INTO hyperfide."+table+" DEFAULT VALUES; COMMIT;",database=DB,allow_error=True)
   expect(result.returncode!=0 and "25001" in result.stderr,"New authority table accepted unsupported repeatable-read write")
  check("spec.isolation."+table,isolation)

 # Authentication and disposition checks run after the original byte/history
 # assertions; revocation is last so ordinary cleanup still observes the database.
 def inspect_fence():
  before=sql("SELECT semantic_generation FROM hyperfide.runs WHERE id='"+run+"';")
  s.ok("spec.inspect",{"run_id":run},run)
  expect(sql("SELECT semantic_generation FROM hyperfide.runs WHERE id='"+run+"';")==before,"Read projection advanced semantic generation")
 check("spec.auth.semantic-read",inspect_fence)
 def replay_fence():
  before=sql("SELECT state_version::text||'|'||semantic_generation::text FROM hyperfide.runs WHERE id='"+run+"';").split('|')
  s.ok("spec.import",value,run)
  after=sql("SELECT state_version::text||'|'||semantic_generation::text FROM hyperfide.runs WHERE id='"+run+"';").split('|')
  expect(after[0]==before[0] and int(after[1])==int(before[1])+1,"Replay disposition changed business CAS or omitted write fence")
 check("spec.auth.semantic-write",replay_fence)
 def raw_refused():
  argv=["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(s.f.policy),"--spec-revision","fixture-identity-v1","--components",str(s.f.components),"--module-root",str(ROOT/"services/hyperfide/dist")]
  result=subprocess.run(argv,input=json.dumps({"id":1,"component":"spec-import","action":"spec.inspect","input":{"run_id":run}})+"\n",text=True,capture_output=True,cwd=ROOT,env=s.f.env,timeout=30)
  rows=[json.loads(line) for line in result.stdout.splitlines() if line.strip()]
  expect(len(rows)==1 and rows[0].get("ok") is False and rows[0].get("error",{}).get("code")=="AUTH_REQUIRED","Unbranded JSONL acquired specification authority")
 check("spec.auth.no-startup-fallback",raw_refused)
 def role_refused():
  operation=s.f.operation("spec-import","spec.import",s.initial_input,run=s.initial_run)
  status,result=s.f.request(operation,key="provisioner",credential=s.f.ids["provisioner"])
  expect(status==200 and result.get("ok") is False and result.get("error",{}).get("code")=="ACTION_DENIED","Provisioner imported accepted intent")
 check("spec.auth.role-refused",role_refused)
 def revoked():
  before=sql("SELECT state_version::text||'|'||semantic_generation::text FROM hyperfide.runs WHERE id='"+run+"';")
  s.f.sql("UPDATE hyperfide.identity_principals SET state='REVOKED' WHERE credential_id=$1",[s.credentials[run]])
  status,result=s.f.request(s.f.operation("spec-import","spec.inspect",{"run_id":run},run=run),credential=s.credentials[run])
  expect(status in [401,403] or result.get("ok") is False,"Revoked credential read authority")
  expect(sql("SELECT state_version::text||'|'||semantic_generation::text FROM hyperfide.runs WHERE id='"+run+"';")==before,"Revoked call mutated accepted state")
 check("spec.auth.revoked-refused",revoked)
PRIVATE_IDS=["spec.private.first.import","spec.private.first.history","spec.private.first.export","spec.private.second.import","spec.private.second.history","spec.private.second.export","spec.private.joint-identities","spec.private.no-runtime-proof"]
def private_profile():
 base=ROOT/"spec/hyperfide/private/runtime/task-2.1-fixtures"
 profile=base/"profile.json"
 expect(profile.is_file() and not profile.is_symlink(),"Required approved private corpus is unavailable")
 expect(stat.S_IMODE(base.stat().st_mode)==0o700 and stat.S_IMODE(profile.stat().st_mode)==0o600,"Private corpus permissions are not restrictive")
 data=json.loads(profile.read_text())
 expect(data.get("schema_version")==1 and data.get("access_classification")=="private" and data.get("approved_for")=="task:2.1-private-corpus","Private corpus approval descriptor is invalid")
 rows=data.get("fixtures")
 expect(isinstance(rows,list) and len(rows)==2 and len({r.get("id") for r in rows})==2,"Both selected corpus inputs are required")
 for row in rows:
  expect(set(row)=={"id","relative_path","sha256","size_bytes"} and isinstance(row["relative_path"],str) and re.fullmatch(r"[A-Za-z0-9._-]+\.kvx",row["relative_path"]) is not None,"Private corpus reference is invalid")
  source=base/row["relative_path"]
  expect(source.is_file() and not source.is_symlink() and stat.S_IMODE(source.stat().st_mode)==0o600,"Private source is missing or unsafe")
  content=source.read_bytes()
  expect(str(len(content))==row["size_bytes"] and hashlib.sha256(content).hexdigest()==row["sha256"],"Private corpus pin mismatch")
  content.decode("utf8",errors="strict")
 return base,profile,data

def private_probe(service):
 base,profile,data=private_profile();service.root=base
 runs=[];expected_tasks=[]
 for index,row in enumerate(data["fixtures"]):
  content=(base/row["relative_path"]).read_bytes()
  text=content.decode("utf8")
  sections=re.findall(r"^\[([A-Za-z0-9_.:-]+)\]\s*(?:#.*)?$",text,flags=re.M)
  expected={"sections":len(sections),"tasks":sum(x.startswith("task.") for x in sections),"requirements":sum(x.startswith("req.") for x in sections),"acceptances":sum(x.startswith("acceptance.") for x in sections)}
  current_section="";fields_count=0;criteria_count=0
  for line in text.splitlines():
   header=re.match(r"^\[([A-Za-z0-9_.:-]+)\]",line)
   if header:current_section=header.group(1)
   elif re.match(r"^[A-Za-z_][A-Za-z0-9_.-]*\s*=",line):
    fields_count+=1
    if current_section.startswith("req.") and re.match(r"^ac_[0-9]+\s*=",line):criteria_count+=1
  expected["fields"]=fields_count;expected["criteria"]=criteria_count
  run=str(uuid.uuid4());runs.append(run);expected_tasks.append(expected["tasks"]);saved={}
  source={key:row[key] for key in ["relative_path","sha256","size_bytes"]}
  value=service.envelope(run,source)
  def imported():
   saved.update(service.ok("spec.import",value,run))
   expect(all(saved["counts"][key]==count for key,count in expected.items()),"Private corpus structural count mismatch")
   expect(saved["source_digest"]=="sha256:"+row["sha256"] and saved["state"]=="PENDING_VALIDATION","Private corpus identity/admission mismatch")
   actual=sql("SELECT encode(sha256(convert_to(source_content,'UTF8')),'hex')||'|'||octet_length(source_content)::text FROM hyperfide.spec_revisions WHERE id='"+saved["spec_revision_id"]+"';")
   expect(actual==row["sha256"]+"|"+row["size_bytes"],"Private corpus raw storage changed")
  check(PRIVATE_IDS[index*3],imported)
  def history():
   states=sql("SELECT count(*)||'|'||count(*) FILTER(WHERE state='PENDING' AND definition->>'history_only'='true') FROM hyperfide.tasks WHERE run_id='"+run+"';")
   expect(states==str(expected["tasks"])+"|"+str(expected["tasks"]),"Private declarations acquired runtime authority")
  check(PRIVATE_IDS[index*3+1],history)
  def exported():
   checksum=hashlib.sha256();size=0;cursor=None
   while True:
    page=service.ok("spec.export",{"run_id":run,"revision_digest":saved["revision_digest"],"cursor":cursor,"max_bytes":196608},run)
    chunk=base64.b64decode(page["chunk_base64"],validate=True);checksum.update(chunk);size+=len(chunk)
    cursor=page["next_cursor"]
    if cursor is None:break
   expect(checksum.hexdigest()==row["sha256"] and str(size)==row["size_bytes"],"Private paginated export mismatch")
  check(PRIVATE_IDS[index*3+2],exported)
 check(PRIVATE_IDS[6],lambda:expect(sql("SELECT count(DISTINCT run_id)||'|'||count(*) FROM hyperfide.tasks WHERE run_id IN ('"+runs[0]+"','"+runs[1]+"');")=="2|"+str(sum(expected_tasks)),"Private programme namespaces collapsed"))
 check(PRIVATE_IDS[7],lambda:expect(sql("SELECT (SELECT count(*) FROM hyperfide.evidence)+(SELECT count(*) FROM hyperfide.compute_leases)+(SELECT count(*) FROM hyperfide.submission_custodies);")=="0","Private import fabricated runtime proof"))

def qualify_private():
 base,profile,data=private_profile()
 public_manifest=ROOT/"tests/hyperfide/manifests/tasks/2.1.json"
 public_registration=ROOT/"tests/hyperfide/registrations/2.1.json"
 expect(public_manifest.is_file() and public_registration.is_file(),"Public component contract must exist before private qualification")
 identity=hashlib.sha256(public_manifest.read_bytes()+profile.read_bytes()).hexdigest()
 target=ROOT/"spec/hyperfide/private/runtime/task-2.1-private-qualification"/identity
 (target/"registrations").mkdir(parents=True,exist_ok=True,mode=0o700)
 registry={"schema_version":1,"cases":{"V-024":{"title":"Explicit private corpus component","full_assertion_ids":[]}},"suites":{},"registration_glob":"registrations/*.json"}
 registration=json.loads(public_registration.read_text());registration.update(variant="task:2.1-private",cases=["V-024"],assertion_ids=PRIVATE_IDS,argv=["python3","tests/hyperfide/cases/tasks/2_1.py","--private-corpus"],timeout_seconds=900)
 private_inputs=[profile]+[base/row["relative_path"] for row in data["fixtures"]]
 registration["fixtures"]=registration["fixtures"]+[str(path.relative_to(ROOT)) for path in private_inputs]
 manifest=json.loads(public_manifest.read_text());manifest.update(campaign_id="hyperfide-task-2.1-private-corpus-"+identity[:16],registered_variant=registration["variant"],case_ids=["V-024"],expected_assertion_ids=PRIVATE_IDS)
 registration_path=target/"registrations/2.1-private.json"
 registry_path=target/"registry.json"
 def pin(path):
  content=path.read_bytes();return {"path":str(path.relative_to(ROOT)),"sha256":hashlib.sha256(content).hexdigest(),"size":len(content)}
 def immutable(path,value):
  encoded=(json.dumps(value,sort_keys=True,indent=2)+"\n").encode()
  if path.exists():expect(path.read_bytes()==encoded,"Private immutable qualification contract changed")
  else:
   with path.open("xb") as handle:handle.write(encoded)
   path.chmod(0o600)
 immutable(registration_path,registration);immutable(registry_path,registry)
 manifest["inputs"]=[row for row in manifest["inputs"] if row["path"]!="tests/hyperfide/registrations/2.1.json"]+[pin(registration_path),pin(registry_path)]+[pin(path) for path in private_inputs]
 immutable(target/"manifest.json",manifest)
 with (target/"qualify.stdout").open("ab") as stdout,(target/"qualify.stderr").open("ab") as stderr:
  result=subprocess.run(["python3","tests/hyperfide/qualify.py","--case","V-024","--registry",str(registry_path),"--manifest",str(target/"manifest.json")],
   cwd=ROOT,stdout=stdout,stderr=stderr,timeout=1200)
 print("Private corpus qualification "+("passed." if result.returncode==0 else "failed; inspect private receipts."),flush=True)
 return result.returncode

def cleanup():
 from identity_fixture import SQL_JS
 p=outdir()/"database-names.json"
 expect(p.is_file(),"Owned fixture database descriptor missing")
 names=json.loads(p.read_text())["databases"]
 expect(names and all(re.fullmatch("hf_identity_[0-9a-f]{32}",name) for name in names),"Owned database identities invalid")
 for name in names:
  subprocess.run(["node","--input-type=commonjs","-e",SQL_JS],input=json.dumps({"sql":'DROP DATABASE IF EXISTS "'+name+'" WITH(FORCE)',"values":[]}),text=True,cwd=ROOT,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 result=subprocess.run(["node","--input-type=commonjs","-e",SQL_JS],input=json.dumps({"sql":"SELECT count(*)::int n FROM pg_database WHERE datname=ANY($1::text[])","values":[names]}),text=True,cwd=ROOT,capture_output=True,timeout=15)
 absent=result.returncode==0 and json.loads(result.stdout)==[{"n":0}]
 (outdir()/"database-absence.json").write_text(json.dumps({"databases":names,"observed_absent":absent})+"\n")
 print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":"hf-task-2.1-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"spec/database-absence.json"}]}),flush=True)
 return 0 if absent else 1
def main():
 with tempfile.TemporaryDirectory(prefix="hyperfide-2-1-") as temp:
  s=Service(Path(temp))
  try:private_probe(s) if "--private-corpus" in sys.argv else probe(s)
  finally:s.f.close()
 (outdir()/"observations.json").write_text(json.dumps({"scope":"task-component","assertion_ids":IDS,"failed_ids":FAILED,"operations":OBS})+"\n")
 return 1 if FAILED else 0
if __name__=="__main__":
 if "--cleanup" in sys.argv:sys.exit(cleanup())
 if "--qualify-private-corpus" in sys.argv:
  try:sys.exit(qualify_private())
  except (OSError,ValueError,AssertionError,subprocess.SubprocessError):
   print("Required approved private corpus qualification failed.",file=sys.stderr);sys.exit(2)
 sys.exit(main())
