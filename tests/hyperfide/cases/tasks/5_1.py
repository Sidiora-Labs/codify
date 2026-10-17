#!/usr/bin/env python3
"""Signed scheduler claims against actual PostgreSQL, packets, hierarchy and quotas.
Import SchedulerFixture for downstream tests; import never grants authority.
"""
from __future__ import annotations
import concurrent.futures,copy,importlib.util,json,os,socket,subprocess,sys,hashlib,re,shutil,signal,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("hf_packet_fixture",ROOT/"tests/hyperfide/cases/tasks/3_2.py")
packet=importlib.util.module_from_spec(spec);spec.loader.exec_module(packet)
PacketFixture=packet.PacketFixture;uid=packet.uid;identity=packet.identity;sha=packet.sha
FAILED=[];ASSERTION_IDS=[]

TEST_TASK=None
def campaign_root():
 return Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/scheduler-standalone-"+str(TEST_TASK)))
def owned_receipt():
 return campaign_root()/"scheduler"/"owned-resources.json"
def write_json(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 temporary=path.with_suffix(".tmp")
 with temporary.open("w") as stream:
  json.dump(value,stream,sort_keys=True);stream.flush();os.fsync(stream.fileno())
 temporary.replace(path)
def configure_cleanup(task):
 global TEST_TASK
 TEST_TASK=task
 if "--cleanup" not in sys.argv:write_json(owned_receipt(),{"task":task,"fixtures":[]})
def process_start(pid):
 try:return Path("/proc/"+str(pid)+"/stat").read_text().rsplit(")",1)[1].split()[19]
 except FileNotFoundError:return None
def record_fixture(f):
 if TEST_TASK is None:return
 path=owned_receipt();data=json.loads(path.read_text())
 entry={"database":f.database,"runtime_role":f.runtime_role,"private_path":str(f.path),"port":getattr(f,"port",None),"process_id":f.child.pid if f.child else None,"process_start":process_start(f.child.pid) if f.child else None,"kernel_boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
 data["fixtures"]=[row for row in data["fixtures"] if row["database"]!=f.database]+[entry]
 write_json(path,data)
def cleanup_owned(task):
 configure_cleanup(task)
 resource="hf-task-"+task+"-runtime";observations=[]
 try:
  data=json.loads(owned_receipt().read_text())
  expect(data["task"]==task and isinstance(data["fixtures"],list),"Exact owned fixture receipt required")
  for row in data["fixtures"]:
   db=row["database"];role=row["runtime_role"];path=Path(row["private_path"])
   expect(re.fullmatch(r"hf_identity_[0-9a-f]{32}",db) and re.fullmatch(r"hf_ir_[0-9a-f]{32}",role),"Unexpected owned DB/role identity")
   expect(path.parent==Path("/tmp") and path.name.startswith("hyperfide-identity-") and not path.is_symlink(),"Unexpected private fixture path")
   pid=row["process_id"];start=row["process_start"]
   if pid and process_start(pid)==start:
    expect(Path("/proc/sys/kernel/random/boot_id").read_text().strip()==row["kernel_boot_id"],"Kernel boot changed")
    command=Path("/proc/"+str(pid)+"/cmdline").read_bytes()
    expect(str(path).encode() in command and b"/services/hyperfide/dist/" in command,"Owned process command identity mismatch")
    os.kill(pid,signal.SIGTERM);deadline=time.monotonic()+8
    while process_start(pid)==start and time.monotonic()<deadline:time.sleep(.05)
    if process_start(pid)==start:
     os.kill(pid,signal.SIGKILL);deadline=time.monotonic()+3
     while process_start(pid)==start and time.monotonic()<deadline:time.sleep(.05)
    expect(process_start(pid)!=start,"Owned listener process remains")
   payload={"sql":'DROP DATABASE IF EXISTS "'+db+'" WITH (FORCE)',"values":[],"serial":False}
   env=os.environ.copy()
   result=subprocess.run(["node","--input-type=commonjs","-e",SchedulerFixture.sql.__globals__["SQL_JS"]],input=json.dumps(payload),text=True,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
   expect(result.returncode==0,"Owned database cleanup failed")
   payload["sql"]='DROP ROLE IF EXISTS "'+role+'"'
   result=subprocess.run(["node","--input-type=commonjs","-e",SchedulerFixture.sql.__globals__["SQL_JS"]],input=json.dumps(payload),text=True,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
   expect(result.returncode==0,"Owned role cleanup failed")
   payload={"sql":"SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$2) AS absent","values":[db,role],"serial":False}
   result=subprocess.run(["node","--input-type=commonjs","-e",SchedulerFixture.sql.__globals__["SQL_JS"]],input=json.dumps(payload),text=True,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
   expect(result.returncode==0 and json.loads(result.stdout)[0]["absent"],"Database/role absence not observed")
   if path.exists():shutil.rmtree(path)
   expect(not path.exists(),"Private path remains")
   if row["port"]:
    with socket.socket() as sock:expect(sock.connect_ex(("127.0.0.1",row["port"]))!=0,"Owned listener port remains")
   observations.append({"database":db,"runtime_role":role,"observed_absent":True,"private_path_absent":True,"listener_absent":True})
  write_json(campaign_root()/"scheduler"/"cleanup.json",{"task":task,"observations":observations,"complete":True})
  print(json.dumps({"type":"cleanup","complete":True,"resources":[{"id":resource,"status":"deleted","observed_absent":True,"evidence_artifact":"scheduler/cleanup.json"}]}),flush=True)
  return 0
 except Exception as error:
  print(json.dumps({"type":"cleanup","complete":False,"resources":[{"id":resource,"status":"unknown"}],"error":str(error)}),flush=True);return 1

def expect(value,message):
 if not value:raise AssertionError(message)
def check(name,callback):
 ASSERTION_IDS.append(name)
 try:callback();actual="observed"
 except Exception as error:FAILED.append(name);actual=type(error).__name__+": "+str(error)
 record={"type":"assertion","id":name,"expected":"observed","actual":actual}
 print(json.dumps(record),flush=True)
 if TEST_TASK is not None:
  path=campaign_root()/"scheduler"/"observations.json";rows=json.loads(path.read_text()) if path.exists() else [];rows.append(record);write_json(path,rows)
PARSE_JS="import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"
def next_spec_generation(f):
 current=f.sql("SELECT spec_generation::text AS generation FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",[f.ids["organisation"],f.ids["run"]])[0]["generation"]
 return str(int(current)+1)
def accept_scheduler_spec(f,tasks):
 """Trusted fixture: bind scheduler tasks to an actual parsed accepted spec revision at the next run generation."""
 i=f.ids;i["accepted_spec"]=uid();f.spec_generation=next_spec_generation(f);f.review_rubric=sha(b"scheduler-review-rubric")
 source='[req.5]\ntitle = "Scheduling, reservations and fenced ownership"\nac_1 = "Claiming work SHALL atomically validate dependencies, wave policy, scope, role, run state and ownership and reserve eligible capacity."\n'
 source+='[acceptance.V-002]\nreqs = ["5.1"]\nscenario = "Concurrent claims and coordinator submission custody"\n[acceptance.V-007]\nreqs = ["5.1"]\nscenario = "Declared admission limits"\n'
 for name,feature,package_key,path,wave in tasks:
  source+='[task.claim-'+name+']\nreqs = ["5.1"]\nacceptance_ids = ["V-002", "V-007"]\nwave = '+str(wave)+'\ntouches = '+json.dumps([path])+'\n'
 source+='[proof]\nrubric_digest = '+json.dumps(f.review_rubric)+'\n[proof.review.5.1]\nreviewers = '+json.dumps([i["watcher"]])+'\nrubric_digest = '+json.dumps(f.review_rubric)+'\n'
 parsed=json.loads(subprocess.check_output(["node","--input-type=module","-e",PARSE_JS],input=source,text=True,cwd=ROOT))
 f.task_sections={section["name"][len("task.claim-"):]:section for section in parsed["sections"] if section["name"].startswith("task.claim-")}
 source_object=f.packet_proof["source_object_id"]
 document={"schema_version":1,"revision_digest":sha(b"scheduler-accepted-envelope"),"source_digest":sha(source.encode()),"repositories":[{"repository_id":i["repository"],"source_object_id":source_object,"integration_ref":"refs/heads/main"}],"allowed_actions":f.actions,"closure_policy":{"required_evidence":[],"required_review_roles":[],"publication":"AFTER_QUALIFICATION"},"provenance":None,"parsed":parsed,"runtime_wave_offset":0}
 f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[i["organisation"],i["project"],i["accepted_spec"],sha(source.encode()),source,json.dumps(document),document["revision_digest"]])
 f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$4,$3)",[i["organisation"],i["run"],i["accepted_spec"],f.spec_generation])
 f.sql("UPDATE hyperfide.runs SET spec_generation=$4,spec_revision_id=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"],i["accepted_spec"],f.spec_generation])
class SchedulerFixture(PacketFixture):
 def __init__(self,extra_components=(),extra_setup=None,agent_limit=2,bootstrap=True,sandbox_cpu_limit=8000,sandbox_cpu_headroom=1000,source_object_id=None,extra_env=None,extra_tasks=()):
  def setup(f):
   packet.apply_migration(f,"0005-scheduling")
   i=f.ids;f.accounts={};f.claims={}
   f.sql("INSERT INTO hyperfide.scheduling_policies(organisation_id,pool_id) VALUES($1,$2)",[i["organisation"],i["pool"]])
   i["dispatch_consumer"]=uid()
   f.sql("INSERT INTO hyperfide.event_consumers(organisation_id,run_id,id,consumer_key) VALUES($1,$2,$3,'scheduler-dispatch')",[i["organisation"],i["run"],i["dispatch_consumer"]])
   f.env["HF_SCHEDULER_DISPATCH_CONSUMER_ID"]=i["dispatch_consumer"]
   i["native_consumer"]=uid()
   f.sql("INSERT INTO hyperfide.event_consumers(organisation_id,run_id,id,consumer_key) VALUES($1,$2,$3,'native-control')",[i["organisation"],i["run"],i["native_consumer"]])
   f.env["HF_SCHEDULER_NATIVE_CONSUMER_ID"]=i["native_consumer"]
   limits={"AGENT":agent_limit,"CPU_MILLIS":8000,"MEMORY_BYTES":17179869184,"DISK_BYTES":34359738368,"BUILD":2,"TEST":2,"REVIEW":2,"INDEX":2,"INTEGRATION":2,"PREPARATION":2}
   for dimension,limit in limits.items():
    ident=uid();f.accounts[dimension]=ident
    f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,configured_limit,provenance_digest,qualification_state) VALUES($1,$2,$3,$4,'EXECUTION',$5,$6,'QUALIFIED')",[i["organisation"],ident,i["pool"],dimension,str(limit),sha(b"trusted-fixture-budget")])
   f.physical_accounts={}
   for dimension,limit in {"SANDBOX":"100","CPU_MILLIS":"400000","MEMORY_BYTES":"858993459200","DISK_BYTES":"2147483648000"}.items():
    ident=uid();f.physical_accounts[dimension]=ident
    f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,configured_limit,provenance_digest,qualification_state) VALUES($1,$2,$3,$4,'PHYSICAL',$5,$6,'QUALIFIED')",[i["organisation"],ident,i["pool"],dimension,limit,sha(b"fixed-test-pool-physical-envelope")])
   f.definitions={}
   tasks=(("a","alpha","package","src/claim-a.ts",1),("b","beta","wave_package","src/claim-b.ts",1),("overlap","alpha","package","src/claim-a.ts",1),("missing","alpha","package","src/missing.ts",1))+tuple(extra_tasks)
   accept_scheduler_spec(f,tasks)
   for name,feature,package_key,path,wave in tasks:
    task_id=uid();slot_id=uid();i["task_"+name]=task_id;i["slot_"+name]=slot_id
    definition=copy.deepcopy(f.packet_definition);definition.update(feature_key=feature,touches=[path],section=f.task_sections[name]);f.definitions[name]=definition
    criteria=sha(("accepted-criteria-"+name).encode())
    f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[i["organisation"],i["run"],task_id,feature+".claim-"+name,i[package_key],i["accepted_spec"],f.spec_generation,criteria,json.dumps(definition),wave])
    f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,$4,1,'AGENT','READY')",[i["organisation"],slot_id,i["sandbox"],"claim-"+name])
    if name!="missing":
     policy=copy.deepcopy(f.packet_proof);policy.update(criteria_digest=criteria,spec_revision_id=i["accepted_spec"],spec_generation=f.spec_generation,rubric_digest=f.review_rubric,clauses=[{"id":"5.1","mode":"REVIEW","acceptance_ids":["V-002","V-007"],"reviewers":[i["watcher"]],"rubric_digest":f.review_rubric}])
     f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[i["organisation"],i["run"],task_id,f.spec_generation,i["accepted_spec"],criteria,identity(policy),json.dumps(policy)])
   if extra_setup:extra_setup(f)
  super().__init__(extra_components=("5.1","5.2","5.3","5.4")+tuple(extra_components),extra_setup=setup,bootstrap=bootstrap,seed_historical_runtime=False,extra_env=extra_env,**({"source_object_id":source_object_id} if source_object_id is not None else {}))
  # Explicit trusted fixed test envelope; not provider/kernel measurement evidence.
  qualified=self.primary("return claims.qualifySandboxBudget(tx,data.qualification);",{"qualification":{"organisation_id":self.ids["organisation"],"sandbox_id":self.ids["sandbox"],"sandbox_boot_generation":"1","qualification_id":uid(),"evidence_digest":sha(b"explicit-fixed-test-envelope"),"source":"OPERATOR_FIXED","hard_limits":{"cpu_millis":str(sandbox_cpu_limit),"memory_bytes":"17179869184","disk_bytes":"34359738368"},"headroom":{"cpu_millis":str(sandbox_cpu_headroom),"memory_bytes":"1073741824","disk_bytes":"0"}}})
  expect("result" in qualified,"Trusted fixture budget failed: "+json.dumps(qualified))
 def start(self):
  record_fixture(self)
  try:super().start()
  finally:record_fixture(self)
 def capacity(self,job="AGENT"):
  requirements=self.packet_definition["resource_requirements"]
  dimensions={"CPU_MILLIS":str(requirements["cpu_millis"]),"MEMORY_BYTES":requirements["memory_bytes"],"DISK_BYTES":requirements["disk_bytes"],job:"1"}
  return sorted([{"capacity_account_id":self.accounts[key],"quantity":value} for key,value in dimensions.items()],key=lambda d:d["capacity_account_id"])
 def packet_request(self,name="a",**overrides):
  return self.packet_input(task_id=self.ids["task_"+name],slot_id=self.ids["slot_"+name],idempotency_key=uid(),**overrides)
 def prepare_claim(self,name="a",lease_ms=300000):
  request=self.packet_request(name);key="manager2" if name=="b" else "manager"
  result=self.ok("hierarchy.packet.create",request,key=key,component="3.2")
  i=self.ids
  return {"organisation_id":i["organisation"],"run_id":i["run"],"request_id":uid(),"task_id":request["task_id"],"attempt_id":request["attempt_id"],"attempt_generation":request["attempt_generation"],"run_spec_generation":self.spec_generation,"spec_generation":self.spec_generation,"spec_revision_id":i["accepted_spec"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","sandbox_id":i["sandbox"],"slot_id":request["slot_id"],"sandbox_boot_generation":"1","lease_ms":lease_ms,"input_packet_digest":result["digest"],"capacity":self.capacity()}
 def claim(self,name="a",request=None,lease_ms=300000):
  request=request or self.prepare_claim(name,lease_ms);result=self.ok("scheduler.claim",request,key="manager2" if name=="b" else "manager",component="5.1")
  self.claims[name]={"request":request,"result":result};return result
 def primary(self,body,data=None):
  """Exercise actual trusted lower APIs with a real primary brand; not a public auth substitute."""
  script="""import fs from 'node:fs';
import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';
import * as claims from './services/hyperfide/dist/scheduler/claim.js';
import * as leases from './services/hyperfide/dist/scheduler/leases.js';
import {ResourceScheduler} from './services/hyperfide/dist/scheduler/resources.js';
const data=JSON.parse(fs.readFileSync(0,'utf8'));
const resources=createResourceContainer({role:'control',env:process.env,signal:new AbortController().signal});
try{const result=await resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:3,guard:async tx=>{
 const run=await tx.query('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[data.scope.organisation_id,data.scope.run_id]);
 if(run.rows[0]?.authority_epoch!==data.epoch)throw Error('Test primary epoch changed');
}},async tx=>{"""+body+"""});
process.stdout.write(JSON.stringify({result}));}catch(e){process.stdout.write(JSON.stringify({error:{code:e.code??'ERROR',message:e.message}}));}finally{await resources.close();}
"""
  payload={"scope":{"organisation_id":self.ids["organisation"],"run_id":self.ids["run"]},"epoch":self.ids["epoch"],**(data or {})}
  result=subprocess.run(["node","--input-type=module","-e",script],input=json.dumps(payload),text=True,cwd=ROOT,env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
  expect(result.returncode==0,"Trusted product API probe failed: "+result.stderr[:1500]);return json.loads(result.stdout)
 def counts(self):
  return self.sql("SELECT dimension,reserved::text,allocated::text FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 AND capacity_class='EXECUTION' ORDER BY dimension",[self.ids["organisation"],self.ids["pool"]])
def allow_describe(f):
 """Trusted fixture authorization for the registry describe action (component wiring proof)."""
 config=json.loads(f.identity_config.read_text())
 for principal in config["principals"]:
  if "system.describe" not in principal["allowed_actions"]:principal["allowed_actions"].append("system.describe")
 f.identity_config.write_text(json.dumps(config))
 policy=json.loads(f.policy.read_text())
 if "system.describe" not in policy["allowed_actions"]:policy["allowed_actions"].append("system.describe")
 f.policy.write_text(json.dumps(policy))
 f.sql("UPDATE hyperfide.identity_principals SET allowed_actions=array_append(allowed_actions,'system.describe') WHERE NOT ('system.describe'=ANY(allowed_actions))")
def add_slot(f,key):
 slot=uid();f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,$4,1,'AGENT','READY')",[f.ids["organisation"],slot,f.ids["sandbox"],key]);return slot
def ledger(f):
 """Every admission side effect a refused claim must leave untouched."""
 return {"counts":f.counts(),
  "attempts":f.sql("SELECT id,task_id,generation::text,compute_authority FROM hyperfide.attempts ORDER BY id"),
  "reservations":f.sql("SELECT id,state FROM hyperfide.reservations ORDER BY id"),
  "charges":f.sql("SELECT id,state FROM hyperfide.sandbox_execution_charges ORDER BY id"),
  "budget":f.sql("SELECT held_cpu_millis::text,held_memory_bytes::text,held_disk_bytes::text FROM hyperfide.sandbox_execution_budgets ORDER BY sandbox_id"),
  "tasks":f.sql("SELECT id,state,generation::text,current_attempt_id FROM hyperfide.tasks ORDER BY id"),
  "slots":f.sql("SELECT id,state FROM hyperfide.worker_slots ORDER BY id"),
  "outbox":f.sql("SELECT count(*)::int n FROM hyperfide.outbox_events")[0]["n"]}
def refused_unchanged(f,request,code,key="manager",message=None):
 before=ledger(f);response=f.reject("scheduler.claim",request,code,key=key,component="5.1")
 if message is not None:expect(message in response["error"].get("message",""),"Refusal does not name "+message+": "+json.dumps(response))
 expect(ledger(f)==before,code+" refusal changed attempts, reservations, counters, slots or outbox")
 return response
def main():
 configure_cleanup("5.1")
 f=SchedulerFixture(extra_tasks=(("dep","alpha","package","src/claim-dep.ts",1),("later","alpha","package2","src/claim-later.ts",2)),extra_setup=lambda f:(allow_describe(f),f.sql("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision,binding_schema_version,predecessor_spec_generation,predecessor_spec_revision_id) VALUES($1,$2,$3,$2,$4,'QUALIFIED',$6,1,$6,$5)",[f.ids["organisation"],f.ids["run"],f.ids["task_dep"],f.ids["task_a"],f.ids["accepted_spec"],f.spec_generation])));i=f.ids
 try:
  check("claim.fixture.no-seeded-authority",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==0,"Fixture fabricated compute authority"))
  a=f.prepare_claim("a")
  check("claim.strict.fields",lambda:f.reject("scheduler.claim",dict(a,claimed_owner=i["manager"]),"INVALID_REQUEST",key="manager",component="5.1"))
  check("claim.role.denied",lambda:f.reject("scheduler.claim",a,"ROLE_DENIED",key="watcher",component="5.1"))
  check("claim.manager.scope",lambda:f.reject("scheduler.claim",a,"PACKAGE_OWNER_MISMATCH",key="manager2",component="5.1"))
  check("claim.epoch.stale",lambda:f.reject("scheduler.claim",dict(a,authority_epoch=uid()),"STALE_AUTHORITY_EPOCH",key="manager",component="5.1"))
  check("claim.spec.stale",lambda:f.reject("scheduler.claim",dict(a,spec_generation="1"),"STALE_TASK_SPEC",key="manager",component="5.1"))
  before=f.counts()
  check("claim.vector.refused",lambda:f.reject("scheduler.claim",dict(a,capacity=[dict(d,quantity=str(int(d["quantity"])+1)) if d["capacity_account_id"]==f.accounts["CPU_MILLIS"] else d for d in a["capacity"]]),"RESOURCE_VECTOR_MISMATCH",key="manager",component="5.1"))
  check("claim.failure.atomic",lambda:expect(f.counts()==before and f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==0,"Rejected claim leaked rows or counters"))
  result=f.claim("a",request=a)
  check("claim.signed.ownership",lambda:expect(result["token"]["attempt_id"]==a["attempt_id"] and f.sql("SELECT current_attempt_id,generation::text FROM hyperfide.tasks WHERE id=$1",[a["task_id"]])[0]=={"current_attempt_id":a["attempt_id"],"generation":"1"},"Task ownership differs"))
  check("claim.vector.exact",lambda:expect(len(result["reservations"])==4 and all(x["reserved"]=="0" for x in f.counts() if x["dimension"] in ("BUILD","TEST")),"Coding claim eagerly occupied BUILD/TEST or omitted execution dimensions"))
  check("claim.outbox.atomic",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.outbox_events WHERE event_type='scheduler.dispatch.requested'")[0]["n"]==1 and f.sql("SELECT count(*)::int n FROM hyperfide.event_deliveries")[0]["n"]==1,"Dispatch was not committed with standing delivery"))
  check("claim.exact.replay",lambda:expect(f.ok("scheduler.claim",a,key="manager",component="5.1")==result,"Replay changed attempt or lease"))
  check("claim.replay.conflict",lambda:f.reject("scheduler.claim",dict(a,lease_ms=299999),"IDEMPOTENCY_CONFLICT",key="manager",component="5.1"))
  overlap=f.prepare_claim("overlap")
  check("claim.write-scope.conflict",lambda:f.reject("scheduler.claim",overlap,"WRITE_SCOPE_CONFLICT",key="manager",component="5.1"))
  # 3.2 already refuses prospective packets for barrier-blocked tasks, so these claims carry another
  # task's packet digest: the claim barrier must refuse before any packet admission is reached.
  def barred(name):return dict(a,request_id=uid(),task_id=i["task_"+name],attempt_id=uid(),slot_id=i["slot_"+name])
  dep=barred("dep")
  check("claim.dependency.not-qualified",lambda:refused_unchanged(f,dep,"DEPENDENCY_NOT_QUALIFIED"))
  later=barred("later")
  check("claim.wave.earlier-unqualified",lambda:refused_unchanged(f,later,"DEPENDENCY_NOT_QUALIFIED"))
  def run_not_admitting():
   f.sql("UPDATE hyperfide.runs SET state='PENDING_VALIDATION',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"]])
   try:refused_unchanged(f,dep,"RUN_NOT_ADMITTING")
   finally:f.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"]])
  check("claim.run.not-admitting",run_not_admitting)
  missing=dict(a,request_id=uid(),task_id=i["task_missing"],attempt_id=uid(),slot_id=i["slot_missing"])
  check("claim.proof-registry.missing",lambda:refused_unchanged(f,missing,"PROOF_REGISTRY_MISSING"))
  def second_owner():
   spare=add_slot(f,"claim-a-second-owner")
   refused_unchanged(f,dict(a,request_id=uid(),attempt_id=uid(),attempt_generation="2",slot_id=spare),"TASK_NOT_ELIGIBLE")
   expect(f.sql("SELECT current_attempt_id,generation::text,state FROM hyperfide.tasks WHERE id=$1",[a["task_id"]])[0]=={"current_attempt_id":a["attempt_id"],"generation":"1","state":"RESERVED"},"Second claim displaced the single current owner")
   expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE task_id=$1 AND compute_authority='CURRENT'",[a["task_id"]])[0]["n"]==1,"Task gained a second current attempt")
  check("claim.single-owner.second-claim-refused",second_owner)
  def wired():
   status,response=f.invoke("system.describe",{},component="system",key="operator")
   expect(status==200 and response.get("ok") is True,"Registry describe failed: "+json.dumps(response))
   entries=[c for c in response["result"]["components"] if c["id"]=="5.1"]
   declared=json.loads((ROOT/"services/hyperfide/components/5.1.json").read_text())
   expect(len(entries)==1 and entries[0]["actions"]==declared["actions"]==["scheduler.claim"],"Loaded registry does not expose component 5.1 with exactly its declared actions: "+json.dumps(entries))
  check("claim.component.registered",wired)
  b=f.prepare_claim("b")
  def race():
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    responses=list(executor.map(lambda _:f.invoke("scheduler.claim",b,key="manager2",component="5.1")[1],range(2)))
   expect(all(r.get("ok") for r in responses) and responses[0]["result"]==responses[1]["result"],"Concurrent replay did not retain one result")
   expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE task_id=$1",[b["task_id"]])[0]["n"]==1,"Duplicate attempt created")
  check("claim.concurrent.idempotency",race)
  f.stop();f.start()
  check("claim.restart.replay",lambda:expect(f.ok("scheduler.claim",a,key="manager",component="5.1")==result,"Restart lost durable result"))
  def envelope_conflict():
   envelope=f.operation("5.1","scheduler.claim",a);expect(f.request(envelope,key="manager")[1].get("ok"),"Initial outer receipt failed")
   altered=f.operation("5.1","scheduler.claim",dict(a,request_id=uid()));altered["idempotency_key"]=envelope["idempotency_key"]
   expect(f.request(altered,key="manager")[1].get("error",{}).get("code")=="IDEMPOTENCY_CONFLICT","Fresh inner request bypassed protocol identity")
  check("claim.protocol.identity",envelope_conflict)
  check("claim.no-false-qualification",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.tasks WHERE state IN ('QUALIFIED','INTEGRATED','DONE')")[0]["n"]==0,"Claim manufactured qualification"))
  f.sql("UPDATE hyperfide.sandboxes SET desired_state='DESTROYED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["sandbox"]])
  check("claim.destroy-intent.blocks-continuation",lambda:expect(f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'ADVANCE'});",{"token":f.claims["a"]["result"]["token"]}).get("error",{}).get("code")=="SANDBOX_NOT_ADMITTING","Destroy intent allowed continued execution"))
 finally:
  db=f.database;path=f.path;port=f.port;f.close()
  def cleanup():
   expect(not path.exists(),"Private fixture files remain")
   expect(f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Fixture database remains")
   with socket.socket() as sock:expect(sock.connect_ex(("127.0.0.1",port))!=0,"Listener remains")
  check("claim.cleanup.observed",cleanup)
 q=SchedulerFixture(agent_limit=1)
 try:
  qa=q.prepare_claim('a');qb=q.prepare_claim('b')
  before=q.counts()
  def quota_race():
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    futures=[executor.submit(q.invoke,'scheduler.claim',request,key=key,component='5.1') for request,key in [(qa,'manager'),(qb,'manager2')]]
    replies=[future.result()[1] for future in futures]
   expect(sum(r.get('ok') is True for r in replies)==1,'Quota race granted zero or two owners')
   losers=[r for r in replies if r.get('ok') is not True]
   expect(len(losers)==1 and losers[0].get('error',{}).get('code')=='CAPACITY_LIMIT' and losers[0]['error'].get('message')=='Admission is limited by AGENT','Quota loser did not receive an explicit CAPACITY_LIMIT naming AGENT: '+json.dumps(losers))
   expect(q.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE compute_authority='CURRENT'")[0]['n']==1,'Quota loser leaked compute ownership')
   expect(q.sql("SELECT reserved+allocated AS occupied FROM hyperfide.capacity_accounts WHERE id=$1",[q.accounts['AGENT']])[0]['occupied']=='1','Pool exceeded its exact primary budget')
  check('claim.concurrent.multi-manager-quota',quota_race)
  check('claim.quota-rollback.full-vector',lambda:expect(q.sql("SELECT count(*)::int n FROM hyperfide.reservations")[0]['n']==4,'Failed quota claim leaked partial vector'))
 finally:
  db=q.database;path=q.path;q.close();check('claim.quota-cleanup.observed',lambda:expect(not path.exists() and q.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]['n']==0,'Quota fixture remains'))
 local=SchedulerFixture(agent_limit=2,sandbox_cpu_limit=1500,sandbox_cpu_headroom=0)
 try:
  la=local.prepare_claim('a');lb=local.prepare_claim('b')
  def sandbox_race():
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(local.invoke,'scheduler.claim',r,key=k,component='5.1') for r,k in [(la,'manager'),(lb,'manager2')]]
    responses=[f.result()[1] for f in futures]
   expect(sum(r.get('ok') is True for r in responses)==1,'A single sandbox admitted excess aggregate CPU')
   expect(sum(r.get('error',{}).get('code')=='SANDBOX_CAPACITY_EXHAUSTED' for r in responses)==1,'Budget loser did not identify actual sandbox constraint')
   budget=local.sql("SELECT held_cpu_millis::text cpu,held_memory_bytes::text memory FROM hyperfide.sandbox_execution_budgets WHERE sandbox_id=$1",[local.ids['sandbox']])[0]
   expect(budget=={'cpu':'1000','memory':'2147483648'},'Failed local charge leaked multidimensional counters')
  check('claim.concurrent.sandbox-budget',sandbox_race)
  check('claim.sandbox.pool-budget-independent',lambda:expect(local.sql("SELECT allocated::text amount,configured_limit::text budget FROM hyperfide.capacity_accounts WHERE id=$1",[local.accounts['AGENT']])[0]=={'amount':'1','budget':'2'},'Local limit was replaced with global pool quota'))
  check('claim.sandbox.exact-charge',lambda:expect(local.sql("SELECT count(*)::int n FROM hyperfide.sandbox_execution_charges WHERE state='HELD'")[0]['n']==1,'Failed admission left multiple per-box authorities'))
 finally:
  db=local.database;path=local.path;local.close();check('claim.sandbox-cleanup.observed',lambda:expect(not path.exists() and local.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]['n']==0,'Local budget fixture remains'))
 # do_2: creating/prepared (PROVISIONING) and uncertain (RELEASE_PENDING) occupancy stay counted at the boundary;
 # provider provisioning rate and running sandbox quota are separate limits.
 edge=SchedulerFixture(agent_limit=3,extra_setup=lambda f:f.sql("UPDATE hyperfide.scheduling_policies SET rate_window_ms=3600000,state_version=state_version+1 WHERE organisation_id=$1 AND pool_id=$2",[f.ids["organisation"],f.ids["pool"]]))
 try:
  e=edge.ids;agent=edge.accounts["AGENT"]
  def reserve(request,dimensions,dynamic=False):
   body=("const r=await import('./services/hyperfide/dist/scheduler/resources.js');return r.reserveDynamic(tx,{...data.scope,pool_id:data.pool,request_id:data.request,dimensions:data.dimensions,expires_at:data.expires});" if dynamic else
    "return claims.reserveCapacity(tx,{...data.scope,request_id:data.request,dimensions:data.dimensions,expires_at:data.expires});")
   return edge.primary(body,{"pool":e["pool"],"request":request,"dimensions":dimensions,"expires":"2099-01-01T00:00:00.000Z"})
  creating=reserve(uid(),[{"capacity_account_id":agent,"quantity":"1"}])
  uncertain_request=uid();uncertain=reserve(uncertain_request,[{"capacity_account_id":agent,"quantity":"1"}])
  seeded=edge.primary("await claims.allocateReservations(tx,{...data.scope,reservation_ids:data.ids});await tx.query(\"UPDATE hyperfide.reservations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[])\",[data.scope.organisation_id,data.scope.run_id,data.ids]);return true;",{"ids":[uncertain["result"][0]["id"]] if "result" in uncertain else []})
  def occupied():return edge.sql("SELECT reserved::text,allocated::text FROM hyperfide.capacity_accounts WHERE id=$1",[agent])[0]
  def seeded_counted():
   expect("result" in creating and "result" in uncertain and "result" in seeded,"Trusted lower-API seeding failed: "+json.dumps([creating,uncertain,seeded]))
   states=sorted(r["state"] for r in edge.sql("SELECT state FROM hyperfide.reservations WHERE capacity_account_id=$1",[agent]))
   expect(states==["PROVISIONING","RELEASE_PENDING"] and occupied()=={"reserved":"1","allocated":"1"},"Creating/prepared and uncertain occupancy not both counted: "+json.dumps([states,occupied()]))
  check("claim.capacity.creating-uncertain-counted",seeded_counted)
  ea=edge.prepare_claim("a");eb=edge.prepare_claim("b")
  check("claim.capacity.under-boundary-admitted",lambda:expect(edge.claim("a",request=ea)["token"]["attempt_id"]==ea["attempt_id"] and occupied()=={"reserved":"1","allocated":"2"},"Claim under the counted boundary was not admitted"))
  check("claim.capacity.boundary-refused-dimension",lambda:refused_unchanged(edge,eb,"CAPACITY_LIMIT",key="manager2",message="Admission is limited by AGENT"))
  physical=edge.physical_accounts["SANDBOX"];rate=uid()
  edge.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,configured_limit,provenance_digest,qualification_state) VALUES($1,$2,$3,'PROVISION_RATE','RATE','2',$4,'QUALIFIED')",[e["organisation"],rate,e["pool"],sha(b"fixed-test-provider-rate")])
  def sandbox_used():return edge.sql("SELECT (reserved+allocated)::text n FROM hyperfide.capacity_accounts WHERE id=$1",[physical])[0]["n"]
  def rate_used():return edge.sql("SELECT coalesce(sum(consumed),0)::text n FROM hyperfide.capacity_rate_windows WHERE capacity_account_id=$1",[rate])[0]["n"]
  def separate_limits():
   expect("result" in reserve(uid(),[{"capacity_account_id":rate,"quantity":"2"}],True) and rate_used()=="2" and sandbox_used()=="0","Provider rate admission consumed running sandbox quota")
   both=reserve(uid(),[{"capacity_account_id":rate,"quantity":"1"},{"capacity_account_id":physical,"quantity":"1"}],True)
   expect(both.get("error",{}).get("code")=="RATE_LIMIT" and both["error"]["message"]=="Admission is limited by PROVISION_RATE" and sandbox_used()=="0","Rate refusal did not name PROVISION_RATE or leaked sandbox quota: "+json.dumps(both))
   expect("result" in reserve(uid(),[{"capacity_account_id":physical,"quantity":"100"}],True) and sandbox_used()=="100" and rate_used()=="2","Exhausted provisioning rate refused or consumed running sandbox quota")
   full=reserve(uid(),[{"capacity_account_id":physical,"quantity":"1"}],True)
   expect(full.get("error",{}).get("code")=="CAPACITY_LIMIT" and full["error"]["message"]=="Admission is limited by SANDBOX" and rate_used()=="2","Sandbox refusal did not name SANDBOX or consumed provisioning rate: "+json.dumps(full))
   classes=edge.sql("SELECT dimension,capacity_class FROM hyperfide.capacity_accounts WHERE id=ANY($1::uuid[]) ORDER BY dimension",[[rate,physical]])
   expect(classes==[{"dimension":"PROVISION_RATE","capacity_class":"RATE"},{"dimension":"SANDBOX","capacity_class":"PHYSICAL"}],"Limits are not separate accounts")
  check("claim.capacity.rate-sandbox-separate",separate_limits)
 finally:
  db=edge.database;path=edge.path;edge.close();check("claim.capacity-cleanup.observed",lambda:expect(not path.exists() and edge.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Capacity fixture remains"))
 # do_3: coordinator submission custody survives worker-lease expiry and concurrent sweeping.
 states=("SUBMITTED","QUALIFYING","QUALIFIED","INTEGRATING")
 names=["c_"+state.lower() for state in states]
 custody_tasks=tuple((name,"alpha","package","src/custody-"+name+".ts",1) for name in names)+(("control","alpha","package","src/custody-control.ts",1),)
 c=SchedulerFixture(agent_limit=8,extra_tasks=custody_tasks)
 try:
  ci=c.ids;tokens={};reclaims={}
  source_object=c.packet_proof["source_object_id"]
  for name,state in zip(names,states):
   request=c.prepare_claim(name,lease_ms=4000);token=c.claim(name,request=request)["token"];tokens[name]=token
   transfer=c.primary("""await leases.releaseCompute(tx,data.token,{execution_state:'SUBMITTED'});
const custody=crypto.randomUUID();
await tx.query("INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest,authority) SELECT t.organisation_id,t.run_id,$3,t.id,$4,$5,1,$6,$7,$8,$9,$9,t.criteria_digest,'ACTIVE' FROM hyperfide.tasks t WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.id=$10",[data.scope.organisation_id,data.scope.run_id,custody,data.token.attempt_id,data.token.attempt_generation,data.token.authority_epoch,data.repository,data.source,data.digest,data.token.task_id]);
await tx.query("UPDATE hyperfide.tasks SET state=$4,current_custody_id=$5,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[data.scope.organisation_id,data.scope.run_id,data.token.task_id,data.state,custody]);
return custody;""",{"token":token,"repository":ci["repository"],"source":source_object,"digest":sha(b"immutable-durable-submission"),"state":state})
   expect("result" in transfer,"Trusted submission custody transfer failed: "+json.dumps(transfer))
   reclaims[name]=dict(request,request_id=uid(),attempt_id=uid(),attempt_generation="2",slot_id=add_slot(c,"reclaim-"+name))
  control=c.claim("control",lease_ms=1000)["token"]
  # Real primary deadlines only: wait until every original worker lease has expired on the primary clock.
  while c.sql("SELECT bool_or(lease_expires_at>clock_timestamp()) AS live FROM hyperfide.attempts WHERE id=ANY($1::uuid[])",[[t["attempt_id"] for t in tokens.values()]+[control["attempt_id"]]])[0]["live"]:time.sleep(.05)
  held=ledger(c)
  scope={"organisation_id":ci["organisation"],"run_id":ci["run"],"authority_epoch":ci["epoch"],"leader_generation":"1"}
  with concurrent.futures.ThreadPoolExecutor(max_workers=len(names)+1) as pool:
   sweep=pool.submit(c.invoke,"scheduler.compute.expire",scope,component="5.2",key="leader")
   claims={name:pool.submit(c.invoke,"scheduler.claim",reclaims[name],component="5.1",key="manager") for name in names}
   sweep_reply=sweep.result()[1];claim_replies={name:future.result()[1] for name,future in claims.items()}
  check("claim.custody.sweeper-reclaims-ordinary-expiry",lambda:expect(sweep_reply.get("ok") is True and sweep_reply["result"]["expired_attempt_ids"]==[control["attempt_id"]] and sweep_reply["result"]["resources_still_counted"] is True,"Concurrent sweeper did not reclaim exactly the uncustodied expired attempt: "+json.dumps(sweep_reply)))
  for name,state in zip(names,states):
   token=tokens[name]
   def survived(name=name,state=state,token=token):
    expect(token["attempt_id"] not in sweep_reply.get("result",{}).get("expired_attempt_ids",[token["attempt_id"]]),"Sweeper reclaimed submitted work")
    expect(c.sql("SELECT authority FROM hyperfide.submission_custodies WHERE task_id=$1",[token["task_id"]])==[{"authority":"ACTIVE"}],"Coordinator submission custody was released by worker expiry")
    expect(c.sql("SELECT state,generation::text,current_attempt_id FROM hyperfide.tasks WHERE id=$1",[token["task_id"]])[0]=={"state":state,"generation":"1","current_attempt_id":token["attempt_id"]},"Custody task state or ownership changed")
    expect(c.sql("SELECT compute_authority,execution_state FROM hyperfide.attempts WHERE id=$1",[token["attempt_id"]])[0]=={"compute_authority":"RELEASED","execution_state":"SUBMITTED"},"Expiry rewrote the submitted attempt")
   check("claim.custody."+state.lower()+".survives-expiry",survived)
   def reclaim_refused(name=name,token=token):
    reply=claim_replies[name]
    expect(reply.get("ok") is False and reply.get("error",{}).get("code")=="ACTIVE_SUBMISSION_CUSTODY","Re-claim was not refused by active custody: "+json.dumps(reply))
    expect(c.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE task_id=$1",[token["task_id"]])[0]["n"]==1,"Re-claim created a competing attempt")
    expect(c.sql("SELECT state FROM hyperfide.worker_slots WHERE id=$1",[reclaims[name]["slot_id"]])[0]["state"]=="READY","Refused re-claim consumed its READY slot")
   check("claim.custody."+state.lower()+".reclaim-refused",reclaim_refused)
  def custody_counted():
   after=ledger(c);custodied=[t["attempt_id"] for t in tokens.values()]
   expect(after["counts"]==held["counts"] and after["budget"]==held["budget"],"Expiry or refused re-claims changed occupied counters")
   pending=c.sql("SELECT r.state,count(*)::int n FROM hyperfide.reservations r WHERE r.attempt_id=ANY($1::uuid[]) GROUP BY r.state",[custodied])
   expect(pending==[{"state":"RELEASE_PENDING","n":4*len(custodied)}],"Uncertain reservations of submitted work were not retained: "+json.dumps(pending))
   charges=c.sql("SELECT state,count(*)::int n FROM hyperfide.sandbox_execution_charges WHERE attempt_id=ANY($1::uuid[]) GROUP BY state",[custodied])
   expect(charges==[{"state":"RELEASE_PENDING","n":len(custodied)}],"Sandbox charges of submitted work were released before quiescence: "+json.dumps(charges))
   agent=c.sql("SELECT (reserved+allocated)::text n FROM hyperfide.capacity_accounts WHERE id=$1",[c.accounts["AGENT"]])[0]["n"]
   expect(agent==str(len(custodied)+1),"AGENT occupancy does not include every uncertain and expired resource")
  check("claim.custody.uncertain-resources-counted",custody_counted)
  def no_replan():
   reply=c.invoke("hierarchy.packet.create",c.packet_input(task_id=ci["task_"+names[0]],slot_id=reclaims[names[0]]["slot_id"],idempotency_key=uid(),attempt_generation="2"),key="manager",component="3.2")[1]
   expect(reply.get("ok") is False and reply.get("error",{}).get("code")=="TASK_NOT_ADMISSIBLE","Custody task admitted a fresh N+1 prospective packet: "+json.dumps(reply))
  check("claim.custody.no-fresh-packet",no_replan)
 finally:
  db=c.database;path=c.path;c.close();check("claim.custody-cleanup.observed",lambda:expect(not path.exists() and c.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Custody fixture remains"))
 return 1 if FAILED else 0
if __name__=="__main__":
 if "--cleanup" in sys.argv:raise SystemExit(cleanup_owned("5.1"))
 raise SystemExit(main())
