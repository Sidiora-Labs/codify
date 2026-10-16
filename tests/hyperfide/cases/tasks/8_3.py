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
  f.close();f=None;cleanup=True
 finally:
  if f is not None:f.close()
  print(json.dumps({"type":"cleanup","resources":[],"complete":cleanup}),flush=True)
 return 1 if FAILED or not cleanup else 0
if __name__=="__main__":sys.exit(main())
