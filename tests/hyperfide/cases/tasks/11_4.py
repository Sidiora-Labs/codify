#!/usr/bin/env python3
"""11.4: eligible-work-driven remote preparation through separate signed control and provisioner services.

Provider effects use a labelled simulated adapter fixture (COMPONENT_FIXTURE_SIMULATED_PROVIDER): no provider
adapter is registered, so the provider create is recorded by fixture SQL and never reaches a cloud account.
The remote sandbox is simulated by running the actual native 11.2 bootstrap with HF_EXECUTION_HOST_CLASS=remote;
the readiness observation is a labelled fixture receipt, not an 11.3 qualification.
"""
from __future__ import annotations
import copy,ctypes,hashlib,importlib.util,json,os,select,shutil,signal,socket,subprocess,sys,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
scheduler=load("hf_prewarm_scheduler_fixture","tests/hyperfide/cases/tasks/5_1.py")
prepared=load("hf_prewarm_manifest_fixture","tests/hyperfide/cases/tasks/11_1.py")
bootstrap=load("hf_prewarm_bootstrap_fixture","tests/hyperfide/cases/tasks/11_2.py")
SIMULATED="COMPONENT_FIXTURE_SIMULATED_PROVIDER"
IDS=["prewarm.component.control-registered","prewarm.component.provisioner-registered","prewarm.component.role-separated",
 "prewarm.demand.no-eligible-work-no-reservation","prewarm.warm.manager-refused","prewarm.warm.leader-reserved","prewarm.warm.budget-enforced",
 "prewarm.demand.reserved-job","prewarm.demand.limits-respected","prewarm.accounting.visible","prewarm.schedule.idempotent",
 "prewarm.intent.remote-preparation-purpose","prewarm.execute.principal-required","prewarm.retry.provider-unavailable-diagnostics",
 "prewarm.retry.backoff-enforced","prewarm.retry.bounded-limit","prewarm.retry.no-base-from-failure","prewarm.execute.awaiting-remote",
 "prewarm.placement.main-host-refused","prewarm.seal.incomplete-artifacts-refused","prewarm.seal.complete-published",
 "prewarm.seal.identity-matches-contents","prewarm.seal.no-secret-embedded","prewarm.cache.hit-after-seal",
 "prewarm.identity.deterministic","prewarm.identity.changed-input-miss","prewarm.recipe.digest-mismatch-refused",
 "prewarm.failure.package-no-base","prewarm.failure.partial-download-no-base","prewarm.failure.readiness-no-base",
 "prewarm.failure.obsolete-no-base","prewarm.obsolete.prior-base-stale","prewarm.failure.diagnostics-retained",
 "prewarm.warm.budget-preserved","prewarm.index.remote-indexing-job"]
FAILED=[];SEEN=[]
def expect(value,message):
 if not value:raise AssertionError(str(message)[:1500])
def check(name,callback):
 SEEN.append(name)
 try:callback();actual="observed"
 except Exception as error:FAILED.append(name);actual=type(error).__name__+": "+str(error)[:1500]
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()
def become_subreaper():
 # Native bootstrap's git may detach maintenance processes; the test owns and reaps everything it started.
 expect(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"PR_SET_CHILD_SUBREAPER unavailable")
def reap_orphans(keep,seconds=15):
 deadline=time.monotonic()+seconds
 while True:
  orphans=[int(pid) for pid in Path("/proc/self/task/"+str(os.getpid())+"/children").read_text().split() if int(pid) not in keep]
  if not orphans:return
  for pid in orphans:
   try:
    done,_=os.waitpid(pid,os.WNOHANG)
    if not done and time.monotonic()>deadline:os.kill(pid,signal.SIGKILL);os.waitpid(pid,0)
   except ChildProcessError:pass
  time.sleep(.02)
def recipe_policy(repository,command):
 return canonical({"schema_version":1,"kind":"hyperfide.preparation-policy","commands":[{"repository":repository,"argv":["/bin/sh","-c",command],"timeout_seconds":5}],
  "cache_scope":"fixture-scope","cache_paths":[],"minimum_free_bytes":"0","minimum_free_inodes":"0","network_timeout_milliseconds":1000})

class PrewarmFixture(scheduler.SchedulerFixture):
 """Scheduler/packet fixture whose accepted profile is a real 11.1 manifest pinning a stored recipe policy."""
 def __init__(self):
  self.work=Path(tempfile.mkdtemp(prefix="hf-prewarm-"));self.recipes=self.work/"recipes";self.recipes.mkdir(mode=0o700)
  self.swapped=False;self.provisioner=None
  try:super().__init__(extra_components=("8.2","8.3","11.4","11.4-provisioner"),extra_setup=PrewarmFixture.setup)
  except BaseException:shutil.rmtree(self.work,ignore_errors=True);raise
 def manifest(self,profile,command,name):
  base=self.work/name;base.mkdir()
  pre=prepared.Fixture(base);policy=recipe_policy(profile["repositories"][0]["id"],command)
  (pre.candidate/"prepare.json").write_bytes(policy);(pre.candidate/"prepare.json").chmod(0o644)
  value=copy.deepcopy(profile);value["recipe"]=pre.pin("prepare.json");value["preparation_evidence"]=[pre.pin("evidence.json")]
  for manager in value["package_managers"]:manager["locks"]=[pre.pin("package-lock.json")]
  pre.profile=value;created=pre.create()
  expect(not created.get("symlinks") and not created.get("hardlinks"),"Fixture candidate must not need v2 link inventory")
  # Accepted packet intent consumes schema-1 manifests; the inventory bytes are the actual 11.1 observation.
  manifest={key:created[key] for key in ("profile","files","directories","scan")};manifest["schema_version"]=1;manifest["digest"]=sha(canonical(manifest))
  store=self.recipes/(value["recipe"]["digest"][7:]+".json");store.write_bytes(policy);store.chmod(0o600)
  return manifest
 def sql(self,sql,values=None,admin=False,serial=True):
  # prepared_slot derives later bindings from its original manifest, before this substitution.
  if self.swapped and values:
   values=[v.replace(self.original_preparation,self.accepted["digest"]) if isinstance(v,str) else v for v in values]
  if not self.swapped and sql.startswith("INSERT INTO hyperfide.environment_profiles(organisation_id,id,content_digest,provider,runtime_platform,manifest)"):
   self.original_preparation=values[2]
   profile=json.loads(values[3])["profile"];self.profile_body=profile
   self.accepted=self.manifest(profile,"printf installed > dependency.bin","accepted")
   values=[values[0],values[1],self.accepted["digest"],json.dumps(self.accepted)];self.preparation=self.accepted["digest"];self.swapped=True
  if sql.startswith("INSERT INTO hyperfide.provider_pools(") and len(values)>2 and values[2]=="packet-fixture":
   sql=sql.replace("'fixture','fixture',$3,'fixture'","'railway','fixture-account',$3,'fixture-region'")
   values=list(values);values[2]="fixture-env"
  return super().sql(sql,values,admin,serial)
 def setup(f):
  f.preparation=f.accepted["digest"]
  i=f.ids;limits={"SANDBOX":"100","PROVISIONING":"10","CPU_MILLIS":"400000","MEMORY_BYTES":"858993459200","DISK_BYTES":"2147483648000"}
  f.deployment={"schema_version":1,"organisation_id":i["organisation"],"revision":"COMPONENT_FIXTURE_NOT_LIVE-1","accounts":[{"provider":"railway","account_key":"fixture-account","approved_limits":limits,"planning_limits":limits}],
   "pools":[{"id":i["pool"],"provider":"railway","account_key":"fixture-account","environment_key":"fixture-env","region":"fixture-region","profile_id":i["profile"],"preparation_digest":f.preparation,
   "approved_limits":limits,"planning_limits":limits,"create_policy":{"seed_reference":"fixture-approved-seed","network":"ISOLATED","stdin_required":False}}],"maximum_operation_ms":600000}
  f.pool_config=f.work/"pool-policy.json";f.write_pool_config()
  # Keep the refusal window open through the intervening diagnostics queries.
  f.env.update(HYPERFIDE_POOL_CONFIG=str(f.pool_config),HYPERFIDE_PREPARATION_RECIPE_DIR=str(f.recipes),HYPERFIDE_PREPARATION_MAX_ATTEMPTS="4",
   HYPERFIDE_PREPARATION_BACKOFF_BASE_MS="4000",HYPERFIDE_PREPARATION_BACKOFF_MAX_MS="16000")
  f.warm_account=str(uuid.uuid4())
  f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,configured_limit,provenance_digest,qualification_state) VALUES($1,$2,$3,'WARM_SPARE','EXECUTION',1,$4,'QUALIFIED')",[i["organisation"],f.warm_account,i["pool"],sha(b"operator-warm-spare-budget")])
  f.sql("UPDATE hyperfide.capacity_accounts SET configured_limit=3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],f.accounts["PREPARATION"]])
 def write_pool_config(f):
  f.pool_config.write_text(json.dumps(f.deployment));f.pool_config.chmod(0o600)
 def seed_quota(f):
  i=f.ids
  cfg=f.sql("SELECT configuration_digest FROM hyperfide.provider_pool_configurations WHERE organisation_id=$1 AND pool_id=$2 AND active",[i["organisation"],i["pool"]])[0]["configuration_digest"]
  for name in ("SANDBOX","PROVISIONING","CPU_MILLIS","MEMORY_BYTES","DISK_BYTES"):
   for kind,key in (("ACCOUNT","fixture-account"),("ENVIRONMENT","fixture-env")):
    f.sql("INSERT INTO hyperfide.provider_quota_observations(organisation_id,id,pool_id,configuration_digest,provider,account_key,scope_kind,scope_key,dimension,quota_limit,observed_at,expires_at,evidence_digest,basis,evidence_reference) VALUES($1,$2,$3,$4,'railway','fixture-account',$5,$6,$7,$8,clock_timestamp(),clock_timestamp()+interval '30 minutes',$9,'VERIFIED_OPERATOR_ATTESTATION','COMPONENT_FIXTURE_NOT_LIVE')",
     [i["organisation"],str(uuid.uuid4()),i["pool"],cfg,kind,key,name,f.deployment["pools"][0]["approved_limits"][name],sha(b"operator-attestation-fixture")])
  return cfg
 def start_provisioner(f):
  with socket.socket() as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
  components=f.work/"provisioner-components";components.mkdir()
  for name in ("1.4","4.2","4.4","14.1","8.2","8.3","11.4-provisioner"):shutil.copyfile(ROOT/("services/hyperfide/components/"+name+".json"),components/(name+".json"))
  origin="https://localhost:"+str(port);identity=json.loads(f.identity_config.read_text());identity["origin"]=origin
  config=f.work/"provisioner-identity.json";config.write_text(json.dumps(identity));config.chmod(0o600)
  env=dict(f.env,HF_IDENTITY_CONFIG_FILE=str(config))
  argv=["node",str(ROOT/"services/hyperfide/dist/provisioner.js"),"--policy",str(f.policy),"--spec-revision","fixture-identity-v1","--components",str(components),"--module-root",str(ROOT/"services/hyperfide/dist"),"--mode","https","--host","127.0.0.1","--port",str(port),"--tls-cert",str(f.ca),"--tls-key",str(f.tlskey)]
  f.provisioner=subprocess.Popen(argv,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
  deadline=time.monotonic()+20;lines=[]
  while time.monotonic()<deadline:
   ready,_,_=select.select([f.provisioner.stderr],[],[],0.1)
   if ready:
    line=f.provisioner.stderr.readline();lines.append(line)
    if '"event":"ready"' in line:break
   if f.provisioner.poll() is not None:raise AssertionError("Provisioner service exited: "+"".join(lines)[:1500])
  else:raise AssertionError("Provisioner service did not become ready: "+"".join(lines)[:1500])
  client=copy.copy(f);client.port=port;client.origin=origin;f.remote=client
 def stop_provisioner(f):
  if f.provisioner and f.provisioner.poll() is None:
   f.provisioner.terminate()
   try:f.provisioner.wait(timeout=8)
   except subprocess.TimeoutExpired:f.provisioner.kill();f.provisioner.wait(timeout=5)
  if f.provisioner and f.provisioner.stderr:f.provisioner.stderr.close()
 def close(f):
  try:f.stop_provisioner()
  finally:
   try:super().close()
   finally:shutil.rmtree(f.work,ignore_errors=True)

def main():
 if sys.argv[1:]==["--inventory"]:print(json.dumps(IDS));return 0
 expect(not sys.argv[1:],"unknown argument")
 expect((ROOT/"build/hyperfide-native").is_file(),"build/hyperfide-native is required (make hyperfide-native)")
 f=None;cleanup=False;provisioner_gone=False
 try:
  become_subreaper();f=PrewarmFixture();i=f.ids;org=i["organisation"];run=i["run"]
  def call(action,payload,key,component,remote=False):return (f.remote if remote else f).invoke(action,payload,key=key,component=component)
  def ok(action,payload,key="leader",component="11.4",remote=False):
   status,response=call(action,payload,key,component,remote);expect(status==200 and response.get("ok") is True,"Service refused: "+json.dumps(response));return response["result"]
  def refused(action,payload,code,key="leader",component="11.4",remote=False):
   status,response=call(action,payload,key,component,remote)
   expect(response.get("ok") is False and code in json.dumps(response.get("error")),"Expected "+code+", observed "+json.dumps(response));return response
  def schedule(warm=False,request_key=None,job_class="PREPARATION",pool=None,profile=None):
   return {"organisation_id":org,"run_id":run,"pool_id":pool or i["pool"],"profile_id":profile or i["profile"],"job_class":job_class,"warm_spare":warm,"request_key":request_key or "prewarm-"+uuid.uuid4().hex}
  def reservations():return f.sql("SELECT count(*)::int AS n FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2",[org,run])[0]["n"]
  def bases(where="TRUE",values=()):return f.sql("SELECT * FROM hyperfide.provider_prepared_bases WHERE organisation_id=$1 AND "+where,[org,*values])
  def account(dimension,klass="EXECUTION"):return f.sql("SELECT configured_limit::int AS limit,reserved::int AS reserved FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 AND dimension=$3 AND capacity_class=$4",[org,i["pool"],dimension,klass])[0]
  f.start_provisioner()
  ok("provider.pools.configure",{},key="operator",component="8.2",remote=True);config_digest=f.seed_quota()
  check(IDS[0],lambda:expect(ok("preparation.prewarm.inspect",{"organisation_id":org,"run_id":run,"pool_id":i["pool"]})["jobs"]==[],"control component not serving"))
  check(IDS[1],lambda:refused("preparation.jobs.get",{"job_id":str(uuid.uuid4())},"PREPARATION_JOB_UNKNOWN",key="provisioner",component="11.4-provisioner",remote=True))
  def separated():
   refused("preparation.jobs.execute",{"job_id":str(uuid.uuid4())},"UNKNOWN_COMPONENT",key="provisioner",component="11.4-provisioner")
   refused("preparation.prewarm.inspect",{"organisation_id":org,"run_id":run,"pool_id":i["pool"]},"UNKNOWN_COMPONENT",component="11.4",remote=True)
  check(IDS[2],separated)
  changed_profile=str(uuid.uuid4());idle_pool=str(uuid.uuid4())
  changed=f.manifest(dict(f.profile_body,profile_version="1.0.1"),"printf changed > dependency.bin","changed")
  f.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,id,content_digest,provider,runtime_platform,manifest) VALUES($1,$2,$3,'fixture','linux',$4)",[org,changed_profile,changed["digest"],json.dumps(changed)])
  f.sql("INSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region,profile_id) VALUES($1,$2,'railway','fixture-account','idle-env','fixture-region',$3)",[org,idle_pool,changed_profile])
  def no_work():
   before=reservations();result=ok("preparation.prewarm.schedule",schedule(pool=idle_pool,profile=changed_profile))
   expect(result["scheduled"] is False and result["reason"]=="NO_ELIGIBLE_WORK" and reservations()==before,"Preparation reserved capacity without eligible work: "+json.dumps(result))
  check(IDS[3],no_work)
  f.prepare_claim("a");f.prepare_claim("b")
  def manager_warm():
   before=reservations();refused("preparation.prewarm.schedule",schedule(True),"SPARE_DELEGATION_REQUIRED",key="manager");expect(reservations()==before,"Refused spare reserved capacity")
  check(IDS[4],manager_warm)
  jobs={}
  def warm():
   result=ok("preparation.prewarm.schedule",schedule(warm=True));jobs["B"]=result["job"]
   expect(result["scheduled"] and result["external_call_performed"] is False and result["execution_location"]=="REMOTE_EXECUTION","Warm prewarm not scheduled: "+json.dumps(result))
   expect(any(r["capacity_account_id"]==f.warm_account for r in result["reservations"]) and account("WARM_SPARE")["reserved"]==1,"Warm spare budget not charged")
  check(IDS[5],warm)
  def budget():
   before=reservations();refused("preparation.prewarm.schedule",schedule(warm=True),"CAPACITY_LIMIT")
   expect(reservations()==before and account("WARM_SPARE")["reserved"]==1,"Warm spare budget exceeded or leaked partial reservations")
  check(IDS[6],budget)
  first=schedule()
  def demand():
   result=ok("preparation.prewarm.schedule",first);jobs["A"]=result["job"]
   expect(result["scheduled"] and result["eligible_count"]>=1 and not result["job"]["warm_spare"],"Eligible work did not produce a job: "+json.dumps(result))
  check(IDS[7],demand)
  outcomes=[]
  def limits():
   for _ in range(4):
    status,response=f.invoke("preparation.prewarm.schedule",schedule(),key="leader",component="11.4")
    outcomes.append(response)
    if response.get("ok") and response["result"].get("scheduled"):jobs.setdefault("C",response["result"]["job"]);continue
    break
   last=outcomes[-1];text=json.dumps(last)
   expect("C" in jobs,"Second eligible job was not admitted: "+text)
   expect(("CAPACITY_LIMIT" in text and "PREPARATION" in text) or (last.get("ok") and last["result"].get("reason")=="DEMAND_SATISFIED"),"Limit not enforced: "+text)
   prep=account("PREPARATION");expect(prep["reserved"]<=prep["limit"] and len(jobs)<=3,"Preparation limit exceeded: "+json.dumps(prep))
  check(IDS[8],limits)
  def accounting():
   view=ok("preparation.prewarm.inspect",{"organisation_id":org,"run_id":run,"pool_id":i["pool"]})
   rows={r["capacity_class"]+":"+r["dimension"]:r for r in view["accounts"]}
   expect(rows["EXECUTION:WARM_SPARE"]["warm_spare_reserved"]=="1" and rows["EXECUTION:PREPARATION"]["preparation_reserved"]==str(len(jobs)),"Preparation/warm usage not visible: "+json.dumps(rows))
   expect(rows["PHYSICAL:SANDBOX"]["preparation_reserved"]==str(len(jobs)) and len(view["jobs"])==len(jobs),"Sandbox usage not accounted")
  check(IDS[9],accounting)
  def idempotent():
   before=reservations();replay=ok("preparation.prewarm.schedule",first)
   expect(replay["replayed"] is True and replay["job"]["id"]==jobs["A"]["id"] and reservations()==before,"Replay duplicated a job")
   refused("preparation.prewarm.schedule",dict(first,job_class="INDEX"),"IDEMPOTENCY_CONFLICT")
  check(IDS[10],idempotent)
  def intents():
   for job in jobs.values():
    row=f.sql("SELECT preparation_purpose,state,kind,sandbox_id FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND id=$2",[org,job["intent_id"]])[0]
    links=sorted(r["reservation_id"] for r in f.sql("SELECT reservation_id FROM hyperfide.provisioning_intent_reservations WHERE organisation_id=$1 AND intent_id=$2",[org,job["intent_id"]]))
    expect(row=={"preparation_purpose":"PREPARATION","state":"RECORDED","kind":"CREATE","sandbox_id":job["sandbox_id"]} and links==sorted(job["physical_reservation_ids"]),"Job lacks remote PREPARATION intent: "+json.dumps(row))
  check(IDS[11],intents)
  check(IDS[12],lambda:refused("preparation.jobs.execute",{"job_id":jobs["C"]["id"]},"AUTH_SCOPE_DENIED",key="operator",component="11.4-provisioner",remote=True))
  def execute(job):return ok("preparation.jobs.execute",{"job_id":job["id"]},key="provisioner",component="11.4-provisioner",remote=True)
  def get(job):return ok("preparation.jobs.get",{"job_id":job["id"]},key="provisioner",component="11.4-provisioner",remote=True)
  def wait_due(job):
   while f.sql("SELECT next_attempt_at>clock_timestamp() AS later FROM hyperfide.preparation_jobs WHERE organisation_id=$1 AND id=$2",[org,job["id"]])[0]["later"]:time.sleep(.05)
  def provider_unavailable():
   result=execute(jobs["C"])
   expect(result["state"]=="RETRY_WAIT" and result["failure_class"]=="PROVIDER_UNAVAILABLE" and result["provider_called"] is True and result["published"] is False,"Provider failure not retried: "+json.dumps(result))
   artifact=f.sql("SELECT status,storage_backend FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=$3",[org,run,result["diagnostics_artifact_digest"]])
   attempt=get(jobs["C"])["attempts"][0]
   expect(artifact==[{"status":"COMPLETE","storage_backend":"PRIMARY_DATABASE"}] and sha(canonical(attempt["diagnostics"]))==result["diagnostics_artifact_digest"] and attempt["diagnostics"]["code"]=="PROVIDER_UNAVAILABLE","Diagnostics not retained completely")
  check(IDS[13],provider_unavailable)
  check(IDS[14],lambda:refused("preparation.jobs.execute",{"job_id":jobs["C"]["id"]},"RETRY_NOT_DUE",key="provisioner",component="11.4-provisioner",remote=True))
  def bounded():
   gaps=[];result=None
   for _ in range(3):
    wait_due(jobs["C"]);result=execute(jobs["C"])
    if result.get("next_attempt_at"):gaps.append(result["next_attempt_at"])
   view=get(jobs["C"])
   expect(result["state"]=="FAILED" and view["job"]["attempts"]==4 and [a["outcome"] for a in view["attempts"]]==["RETRYABLE_FAILURE"]*3+["FAILED"],"Retry was not bounded: "+json.dumps(view))
   refused("preparation.jobs.execute",{"job_id":jobs["C"]["id"]},"PREPARATION_JOB_NOT_RUNNABLE",key="provisioner",component="11.4-provisioner",remote=True)
  check(IDS[15],bounded)
  check(IDS[16],lambda:expect(bases("source_sandbox_id=$2",[jobs["C"]["sandbox_id"]])==[],"Failed preparation produced a base"))
  def simulate_create(job):
   native=SIMULATED+"-"+job["sandbox_id"]
   f.sql("UPDATE hyperfide.sandboxes SET native_sandbox_id=$3,observed_state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,job["sandbox_id"],native])
   f.sql("UPDATE hyperfide.provisioning_intents SET state='TERMINAL',native_sandbox_id=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,job["intent_id"],native])
   return native
  simulate_create(jobs["B"]);simulate_create(jobs["A"])
  remote={}
  def awaiting():
   result=execute(jobs["B"]);remote["B"]=result
   expect(result["state"]=="AWAITING_REMOTE" and result["provider_called"] is False and result["execution_location"]=="REMOTE_EXECUTION" and result["placement_class"]=="dependency_preparation","Job not dispatched remotely: "+json.dumps(result))
   expect(result["plan"]["placement"]=={"job_class":"dependency_preparation","location":"REMOTE_EXECUTION"} and result["plan"]["preparation_digest"]==f.preparation,"Plan not bound to remote identity")
  check(IDS[17],awaiting)
  workdir=f.work/"remote";workdir.mkdir()
  def remote_run(job,command,host_class="remote"):
   base=Path(tempfile.mkdtemp(dir=workdir));fixture=bootstrap.Fixture(base)
   fixture.request.update(preparation_digest=job["preparation_digest"],boot_id=str(uuid.uuid4()))
   fixture.request["commands"]=[{"repository":"alpha","argv":["/bin/sh","-c",command],"timeout_seconds":5}]
   if host_class!="remote":fixture.env["HF_EXECUTION_HOST_CLASS"]=host_class
   row,_=fixture.invoke();reap_orphans({p.pid for p in (f.child,f.provisioner) if p})
   return row,fixture.workspaces/"slot-fixture"/"alpha"
  def store(document):
   raw=canonical(document);digest=sha(raw);path=f.work/("artifact-"+digest[7:]);path.write_bytes(raw)
   f.sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status) VALUES($1,$2,$3,$4,$5,'COMPONENT_FIXTURE',$6,'COMPLETE') ON CONFLICT DO NOTHING",[org,run,str(uuid.uuid4()),digest,str(len(raw)),str(path)])
   return digest
  manifest_digest=store(f.accepted)
  def report(job,dispatch,receipt,downloads,readiness="READY",host_class="remote",sandbox=None,persist=True,boot=None):
   attempt=get(job)["job"]["attempts"]
   execution={"schema_version":1,"kind":"hyperfide.preparation-execution","job_id":job["id"],"attempt":attempt,"plan_digest":job["plan_digest"],"preparation_digest":job["preparation_digest"],"bootstrap":receipt,"downloads":downloads}
   verification={"schema_version":1,"kind":"hyperfide.preparation-verification","job_id":job["id"],"attempt":attempt,"plan_digest":job["plan_digest"],"preparation_digest":job["preparation_digest"],
    "readiness":{"state":readiness,"boot_generation":dispatch["boot_generation"],"observation":"COMPONENT_FIXTURE_READINESS_RECEIPT","observation_id":str(uuid.uuid4())}}
   store(execution)
   if persist:store(verification)
   return {"job_id":job["id"],"attempt":attempt,"execution":{"host_class":host_class,"sandbox_id":sandbox or dispatch["sandbox_id"],"boot_generation":boot or dispatch["boot_generation"],"native_sandbox_id":dispatch["native_sandbox_id"]},
    "manifest_artifact_digest":manifest_digest,"provider_reference":{"preparation_reference":SIMULATED+"/snapshot-"+job["id"]},"execution_receipt":execution,"verification_receipt":verification}
  def downloads_of(path,expected=None):
   data=(path/"dependency.bin").read_bytes();want=expected if expected is not None else data
   return [{"path":"dependency.bin","expected_bytes":str(len(want)),"expected_digest":sha(want),"received_bytes":str(len(data)),"received_digest":sha(data)}]
  def send(payload):return f.remote.invoke("preparation.jobs.report",payload,key="provisioner",component="11.4-provisioner")[1]
  def main_host():
   row,_=remote_run(jobs["B"],"printf installed > dependency.bin",host_class="supervisory")
   expect(row.get("ok") is False,"Native bootstrap ran outside a remote host class: "+json.dumps(row))
   good,path=remote_run(jobs["B"],"printf installed > dependency.bin")
   for payload in (report(jobs["B"],remote["B"],good["result"],downloads_of(path),host_class="supervisory"),report(jobs["B"],remote["B"],good["result"],downloads_of(path),sandbox=i["sandbox"])):
    response=send(payload);expect(response.get("ok") is False and response["error"]["code"]=="PLACEMENT_DENIED","Main-host result accepted: "+json.dumps(response))
   expect(get(jobs["B"])["job"]["state"]=="AWAITING_REMOTE" and bases()==[],"Refused placement changed job or published")
  check(IDS[18],main_host)
  def incomplete():
   good,path=remote_run(jobs["B"],"printf installed > dependency.bin")
   response=send(report(jobs["B"],remote["B"],good["result"],downloads_of(path),persist=False))
   expect(response.get("ok") is False and response["error"]["code"]=="PREPARATION_EVIDENCE_INCOMPLETE" and bases()==[] and get(jobs["B"])["job"]["state"]=="AWAITING_REMOTE","Incomplete evidence accepted: "+json.dumps(response))
  check(IDS[19],incomplete)
  sealed={}
  def publish():
   good,path=remote_run(jobs["B"],"printf installed > dependency.bin")
   expect(good.get("ok") and good["result"]["state"]=="MATERIALIZED","Remote bootstrap failed: "+json.dumps(good))
   payload=report(jobs["B"],remote["B"],good["result"],downloads_of(path));response=send(payload)
   expect(response.get("ok") and response["result"]["published"] is True,"Complete preparation not sealed: "+json.dumps(response))
   sealed.update(response["result"],payload=payload)
   rows=bases("id=$2",[response["result"]["prepared_base_id"]])
   expect(len(rows)==1 and rows[0]["state"]=="QUALIFIED" and rows[0]["verification_scope"]=="POOL" and rows[0]["source_sandbox_id"]==jobs["B"]["sandbox_id"] and get(jobs["B"])["job"]["state"]=="SEALED","QUALIFIED base not published")
  check(IDS[20],publish)
  def identity_matches():
   row=bases("id=$2",[sealed["prepared_base_id"]])[0]
   expect(row["preparation_digest"]==f.preparation==f.accepted["digest"] and row["manifest_artifact_digest"]==sha(canonical(f.accepted)),"Base identity differs from actual manifest contents")
   expect(row["execution_receipt_artifact_digest"]==sha(canonical(sealed["payload"]["execution_receipt"])) and row["verification_receipt_artifact_digest"]==sha(canonical(sealed["payload"]["verification_receipt"])) and row["configuration_digest"]==config_digest,"Receipts not bound by content")
  check(IDS[21],identity_matches)
  def no_secret():
   text=json.dumps(bases("id=$2",[sealed["prepared_base_id"]])[0],default=str)
   expect(set(bases("id=$2",[sealed["prepared_base_id"]])[0]["provider_reference"])=={"preparation_reference"},"Provider reference carries extra fields")
   for value in [i["operator"],i["provisioner"],i["leader"],i["manager"]]+[k["public_key_b64"] for k in f.keys.values()]:expect(value not in text,"Live identity embedded in prepared base")
  check(IDS[22],no_secret)
  resolve={"organisation_id":org,"run_id":run,"pool_id":i["pool"],"profile_id":i["profile"],"job_class":"PREPARATION"}
  def cache_hit():
   view=ok("preparation.recipe.resolve",resolve);before=reservations()
   expect(view["cache"]=="HIT" and view["prepared_base_id"]==sealed["prepared_base_id"] and view["preparation_digest"]==f.preparation,"Sealed base not reused: "+json.dumps(view))
   result=ok("preparation.prewarm.schedule",schedule())
   expect(result["scheduled"] is False and result["cache"]=="HIT" and reservations()==before,"Cache hit still reserved/prepared: "+json.dumps(result))
  check(IDS[23],cache_hit)
  check(IDS[24],lambda:expect(ok("preparation.recipe.resolve",resolve)["plan_digest"]==ok("preparation.recipe.resolve",resolve)["plan_digest"]==jobs["B"]["plan_digest"],"Plan resolution is not deterministic"))
  def changed_input():
   original=ok("preparation.recipe.resolve",resolve);other=ok("preparation.recipe.resolve",dict(resolve,profile_id=changed_profile))
   expect(other["preparation_digest"]==changed["digest"]!=original["preparation_digest"] and other["recipe_digest"]!=original["recipe_digest"] and other["plan_digest"]!=original["plan_digest"],"Changed recipe kept the old identity")
   expect(other["cache"]=="MISS" and other["prepared_base_id"] is None and other["pool_pinned"] is False and original["cache"]=="HIT","Changed input hit the old cache")
  check(IDS[25],changed_input)
  def tampered():
   store=f.recipes/(changed["profile"]["recipe"]["digest"][7:]+".json");saved=store.read_bytes()
   try:store.write_bytes(saved.replace(b"changed",b"tamper!"));refused("preparation.recipe.resolve",dict(resolve,profile_id=changed_profile),"PREPARATION_POLICY_DIGEST_MISMATCH")
   finally:store.write_bytes(saved)
  check(IDS[26],tampered)
  def dispatch_a():
   wait_due(jobs["A"]);result=execute(jobs["A"]);expect(result["state"]=="AWAITING_REMOTE","A not dispatched: "+json.dumps(result));return result
  def no_base_for_a():return bases("source_sandbox_id=$2",[jobs["A"]["sandbox_id"]])==[]
  def package():
   dispatch=dispatch_a();row,_=remote_run(jobs["A"],"printf failure >&2; exit 23")
   expect(row.get("ok") and row["result"]["state"]=="FAILED","Native package failure not observed: "+json.dumps(row))
   response=send(report(jobs["A"],dispatch,row["result"],[]))
   expect(response.get("ok") and response["result"]["failure_class"]=="PACKAGE_FAILURE" and response["result"]["state"]=="RETRY_WAIT" and response["result"]["published"] is False and no_base_for_a(),"Package failure published: "+json.dumps(response))
  check(IDS[27],package)
  def partial():
   dispatch=dispatch_a();row,path=remote_run(jobs["A"],"head -c 1000 /dev/zero > dependency.bin")
   expect(row.get("ok") and row["result"]["state"]=="MATERIALIZED","Remote partial download fixture failed: "+json.dumps(row))
   response=send(report(jobs["A"],dispatch,row["result"],downloads_of(path,expected=b"\0"*4096)))
   expect(response.get("ok") and response["result"]["failure_class"]=="PARTIAL_DOWNLOAD" and response["result"]["published"] is False and no_base_for_a(),"Partial download published: "+json.dumps(response))
  check(IDS[28],partial)
  def readiness():
   dispatch=dispatch_a();row,path=remote_run(jobs["A"],"printf installed > dependency.bin")
   response=send(report(jobs["A"],dispatch,row["result"],downloads_of(path),readiness="FAILED"))
   expect(response.get("ok") and response["result"]["failure_class"]=="READINESS_FAILED" and response["result"]["published"] is False and no_base_for_a(),"Failed readiness published: "+json.dumps(response))
  check(IDS[29],readiness)
  def obsolete():
   dispatch=dispatch_a();row,path=remote_run(jobs["A"],"printf installed > dependency.bin")
   f.deployment["revision"]="COMPONENT_FIXTURE_NOT_LIVE-2";f.write_pool_config();ok("provider.pools.configure",{},key="operator",component="8.2",remote=True);f.seed_quota()
   response=send(report(jobs["A"],dispatch,row["result"],downloads_of(path)))
   expect(response.get("ok") and response["result"]["failure_class"]=="OBSOLETE_MANIFEST" and response["result"]["state"]=="OBSOLETE" and response["result"]["published"] is False and no_base_for_a(),"Obsolete manifest published: "+json.dumps(response))
   sealed["stale"]=response["result"]["stale_bases"]
  check(IDS[30],obsolete)
  def stale():
   expect(sealed["stale"]==[sealed["prepared_base_id"]] and bases("id=$2",[sealed["prepared_base_id"]])[0]["state"]=="STALE","Obsolete base remained QUALIFIED")
   expect(ok("preparation.recipe.resolve",resolve)["cache"]=="MISS" and bases("state='QUALIFIED'")==[],"Stale base still reusable")
  check(IDS[31],stale)
  def diagnostics():
   view=get(jobs["A"])["attempts"]
   expect([(a["outcome"],a["failure_class"]) for a in view]==[("RETRYABLE_FAILURE","PACKAGE_FAILURE"),("RETRYABLE_FAILURE","PARTIAL_DOWNLOAD"),("RETRYABLE_FAILURE","READINESS_FAILED"),("OBSOLETE","OBSOLETE_MANIFEST")],"Attempt history incomplete: "+json.dumps(view))
   for a in view:
    expect(sha(canonical(a["diagnostics"]))==a["diagnostics_artifact_digest"] and f.sql("SELECT status FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=$3",[org,run,a["diagnostics_artifact_digest"]])==[{"status":"COMPLETE"}],"Diagnostics artifact missing")
   try:f.sql("UPDATE hyperfide.preparation_job_attempts SET diagnostics='{}' WHERE organisation_id=$1 AND job_id=$2",[org,jobs["A"]["id"]])
   except AssertionError:return
   raise AssertionError("Finished diagnostics were mutable")
  check(IDS[32],diagnostics)
  def preserved():
   warm=account("WARM_SPARE");expect(warm["reserved"]==1 and warm["limit"]==1,"Warm spare budget drifted: "+json.dumps(warm))
   states={j["id"]:j["state"] for j in ok("preparation.prewarm.inspect",{"organisation_id":org,"run_id":run,"pool_id":i["pool"]})["jobs"]}
   expect(states[jobs["B"]["id"]]=="SEALED" and states[jobs["A"]["id"]]=="OBSOLETE" and states[jobs["C"]["id"]]=="FAILED","Unexpected final job states: "+json.dumps(states))
   expect(all(b["source_sandbox_id"]==jobs["B"]["sandbox_id"] for b in bases()) and len(bases())==1,"Incomplete preparation produced a base")
  check(IDS[33],preserved)
  def indexing():
   before=account("INDEX")["reserved"];result=ok("preparation.prewarm.schedule",schedule(job_class="INDEX"))
   expect(result["scheduled"] and result["job"]["job_class"]=="INDEX" and result["job"]["placement_class"]=="indexing" and result["execution_location"]=="REMOTE_EXECUTION","Indexing preparation not scheduled remotely: "+json.dumps(result))
   expect(account("INDEX")["reserved"]==before+1 and f.sql("SELECT preparation_purpose FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND id=$2",[org,result["job"]["intent_id"]])==[{"preparation_purpose":"PREPARATION"}],"Indexing job bypassed INDEX accounting or remote intent")
  check(IDS[34],indexing)
  f.stop_provisioner();provisioner_gone=f.provisioner.poll() is not None
  f.close();f=None;reap_orphans(set());cleanup=provisioner_gone
 finally:
  if f is not None:
   try:f.close()
   except Exception as error:print(json.dumps({"type":"diagnostic","message":"fixture cleanup failed: "+str(error)[:500]}),flush=True)
  for name in IDS:
   if name not in SEEN:FAILED.append(name);print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":"NOT_RUN"}),flush=True)
  print(json.dumps({"type":"cleanup","resources":[],"complete":cleanup}),flush=True)
 return 1 if FAILED or not cleanup else 0
if __name__=="__main__":raise SystemExit(main())
