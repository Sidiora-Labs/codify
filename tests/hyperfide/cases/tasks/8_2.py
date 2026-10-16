#!/usr/bin/env python3
"""Actual signed provisioner + PostgreSQL tests; no provider network qualification."""
from __future__ import annotations
import hashlib,importlib.util,json,os,select,signal,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("identity_fixture",ROOT/"tests/hyperfide/support/identity_fixture.py")
identity=importlib.util.module_from_spec(spec);spec.loader.exec_module(identity)
IDS=["provider.pools.describe","provider.pools.real-schema","provider.pools.configure","provider.pools.persisted-config","provider.pools.planning-no-authority","provider.pools.unknown-request","provider.pools.quota-no-adapter","provider.pools.quota-operator-denied","provider.pools.private-mode","provider.pools.private-symlink","provider.pools.unknown-config","provider.pools.duplicate-account","provider.pools.duplicate-pool","provider.pools.unconfigured-account","provider.pools.noncanonical-quantity","provider.pools.zero-deadline","provider.pools.planning-separated","provider.pools.primary-brand","provider.pools.runtime-readiness-empty","provider.pools.registry-isolated"]
IDS+=["provider.pools.account-env-quota","provider.pools.observed-not-planning","provider.pools.quota-expiry","provider.pools.unknown-orphan-held","provider.pools.physical-execution-separated","provider.pools.release-pending-held","provider.pools.config-invalidates-observation"]
FAILED=[]
def expect(condition,detail):
 if not condition:raise AssertionError(str(detail))
def check(name,fn):
 try:fn();actual="observed"
 except Exception as error:FAILED.append(name);actual=type(error).__name__+": "+str(error)
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()
class ProvisionerFixture(identity.IdentityFixture):
 def start(self):
  argv=["node",str(ROOT/"services/hyperfide/dist/provisioner.js"),"--policy",str(self.policy),"--spec-revision","fixture-identity-v1","--components",str(self.components),"--module-root",str(ROOT/"services/hyperfide/dist"),"--mode","https","--host","127.0.0.1","--port",str(self.port),"--tls-cert",str(self.ca),"--tls-key",str(self.tlskey)]
  self.child=subprocess.Popen(argv,cwd=ROOT,env=self.env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  deadline=time.monotonic()+15;lines=[]
  while time.monotonic()<deadline:
   ready,_,_=select.select([self.child.stderr],[],[],0.1)
   if ready:
    line=self.child.stderr.readline();lines.append(line)
    if '"event":"ready"' in line:return
   if self.child.poll() is not None:break
  raise AssertionError("Actual provisioner did not become ready: "+"".join(lines)[:1500])
def main():
 if sys.argv[1:]==["--inventory"]:print(json.dumps(IDS));return 0
 expect(not sys.argv[1:],"unknown argument")
 cleanup=False;f=None
 def setup(f):
  scheduler=(ROOT/"services/hyperfide/migrations/0005-scheduling.sql").read_bytes()
  f.sql("BEGIN;\n"+scheduler.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES(5,'0005-scheduling','"+sha(scheduler)+"');\nCOMMIT;")
  migration=(ROOT/"services/hyperfide/migrations/0008-provider-coordination.sql").read_bytes()
  f.sql("BEGIN;\n"+migration.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES(8,'0008-provider-coordination','"+sha(migration)+"');\nCOMMIT;")
  f.provider_pool=str(uuid.uuid4())
  limits={"SANDBOX":"100","PROVISIONING":"10","CPU_MILLIS":"1000000","MEMORY_BYTES":"107374182400","DISK_BYTES":"1073741824000"}
  f.deployment={"schema_version":1,"organisation_id":f.ids["organisation"],"revision":"component-fixture-only","accounts":[{"provider":"railway","account_key":"component-fixture-account","approved_limits":limits,"planning_limits":{"SANDBOX":"3000"}}],"pools":[{"id":f.provider_pool,"provider":"railway","account_key":"component-fixture-account","environment_key":"component-fixture-environment","region":"component-fixture-region","profile_id":None,"preparation_digest":f.preparation,"approved_limits":limits,"planning_limits":{"SANDBOX":"3000"},"create_policy":{"seed_reference":"component-fixture-seed","network":"ISOLATED","stdin_required":False}}],"maximum_operation_ms":10000}
  f.config_path=f.path/"pools.json";f.config_path.write_text(json.dumps(f.deployment));f.config_path.chmod(0o600)
  f.env["HYPERFIDE_POOL_CONFIG"]=str(f.config_path)
 def invoke(action,input=None,key="operator"):
  status,response=f.invoke(action,input or {},component="8.2",key=key)
  return status,response
 def result(action,input=None,key="operator"):
  status,response=invoke(action,input,key);expect(status==200 and response.get("ok") is True,(status,response));return response["result"]
 def refused(action,input=None,key="operator",code=None):
  status,response=invoke(action,input,key);expect(status>=400 or response.get("ok") is False,(status,response))
  if code:expect(code in json.dumps(response),response)
 def config_negative(change):
  value=json.loads(json.dumps(f.deployment));change(value);f.config_path.write_text(json.dumps(value))
  try:refused("provider.pools.configure")
  finally:f.config_path.write_text(json.dumps(f.deployment))
 try:
  f=ProvisionerFixture(extra_components=["8.2"],extra_setup=setup)
  check(IDS[0],lambda:expect(result("provider.pools.describe")["planning_grants_capacity"] is False,"planning grants authority"))
  check(IDS[1],lambda:expect(result("provider.pools.readiness")["version"]==8,"actual migration not ready"))
  check(IDS[2],lambda:expect(result("provider.pools.configure")["configured"]==1,"configuration not persisted"))
  check(IDS[3],lambda:expect(len(f.sql("SELECT * FROM hyperfide.provider_pool_configurations WHERE organisation_id=$1 AND pool_id=$2 AND active",[f.ids["organisation"],f.provider_pool]))==1,"missing exact durable config"))
  check(IDS[4],lambda:expect(result("provider.pools.configure")["planning_grants_capacity"] is False,"planning became actual quota"))
  check(IDS[5],lambda:refused("provider.pools.configure",{"approved":True}))
  check(IDS[6],lambda:refused("provider.pools.observe",{"pool_id":f.provider_pool},key="provisioner",code="QUOTA_UNQUALIFIED"))
  check(IDS[7],lambda:refused("provider.pools.observe",{"pool_id":f.provider_pool},code="AUTH_SCOPE_DENIED"))
  def mode():
   f.config_path.chmod(0o644)
   try:refused("provider.pools.configure",code="POOL_CONFIG_INVALID")
   finally:f.config_path.chmod(0o600)
  check(IDS[8],mode)
  def symlink():
   actual=f.path/"pools-actual.json";f.config_path.rename(actual);f.config_path.symlink_to(actual)
   try:refused("provider.pools.configure",code="POOL_CONFIG_INVALID")
   finally:f.config_path.unlink();actual.rename(f.config_path)
  check(IDS[9],symlink)
  check(IDS[10],lambda:config_negative(lambda v:v.update(secret="forbidden-literal")))
  check(IDS[11],lambda:config_negative(lambda v:v["accounts"].append(v["accounts"][0])))
  check(IDS[12],lambda:config_negative(lambda v:v["pools"].append(v["pools"][0])))
  check(IDS[13],lambda:config_negative(lambda v:v["pools"][0].update(account_key="not-registered")))
  check(IDS[14],lambda:config_negative(lambda v:v["pools"][0]["approved_limits"].update(SANDBOX="0100")))
  check(IDS[15],lambda:config_negative(lambda v:v.update(maximum_operation_ms=0)))
  check(IDS[16],lambda:expect(f.sql("SELECT document->'pool'->'planning_limits'->>'SANDBOX' AS plan,document->'pool'->'approved_limits'->>'SANDBOX' AS budget FROM hyperfide.provider_pool_configurations WHERE organisation_id=$1 AND pool_id=$2 AND active",[f.ids["organisation"],f.provider_pool])[0]=={"plan":"3000","budget":"100"},"planning and actual budgets merged"))
  node=r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TransactionGateway} from './services/hyperfide/dist/storage/transactions.js';
import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';
import {createProviderDatabase,registerProviderAdapter,hasProviderAdapter,readRuntimeReadiness} from './services/hyperfide/dist/providers/pools.js';
const c=JSON.parse(process.env.HF_TEST_CONTEXT),controller=new AbortController();
const startup={role:'provisioner',policy:c.policy,env:process.env,signal:controller.signal};
const resources=createResourceContainer(startup),context={...startup,resources,dependencies:{require(){throw Error('not needed')}}};
let results={};try{
 await assert.rejects(()=>readRuntimeReadiness({},{}),e=>e.code==='TX_CLOSED');results['provider.pools.primary-brand']=true;
 const empty=await resources.gateway.withPrimaryTransaction({timeoutMs:5000},tx=>readRuntimeReadiness(tx,{organisation_id:c.org,run_id:c.run,sandbox_id:c.sandbox,boot_generation:'1',slot_id:c.slot,preparation_digest:c.digest,source_digest:c.digest}));
 assert.equal(empty,null);results['provider.pools.runtime-readiness-empty']=true;
 const one=createProviderDatabase(context),two=createProviderDatabase(context);
 registerProviderAdapter(one.runtime,'railway',()=>{throw Error('component registration fixture must not execute')});
 assert.equal(hasProviderAdapter('railway',one.runtime),true);assert.equal(hasProviderAdapter('railway',two.runtime),false);results['provider.pools.registry-isolated']=true;
 console.log(JSON.stringify(results));
}finally{await resources.close();}
"""
  env=f.env.copy();env["HF_TEST_CONTEXT"]=json.dumps({"policy":json.loads(f.policy.read_text()),"org":f.ids["organisation"],"run":f.ids["run"],"sandbox":f.ids["sandbox"],"slot":str(uuid.uuid4()),"digest":f.preparation})
  probe=subprocess.run(["node","--input-type=module","-e",node],cwd=ROOT,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
  try:payload=json.loads(probe.stdout) if probe.returncode==0 else {}
  except Exception:payload={}
  for name in IDS[17:20]:check(name,lambda name=name:expect(payload.get(name) is True,probe.stderr or probe.stdout))
  org=f.ids["organisation"];run=f.ids["run"]
  config_digest=f.sql("SELECT configuration_digest FROM hyperfide.provider_pool_configurations WHERE organisation_id=$1 AND pool_id=$2 AND active",[org,f.provider_pool])[0]["configuration_digest"]
  def observation(dimension,value,seconds=120):
   for kind,key in [("ACCOUNT","component-fixture-account"),("ENVIRONMENT","component-fixture-environment")]:
    f.sql("INSERT INTO hyperfide.provider_quota_observations(organisation_id,id,pool_id,configuration_digest,provider,account_key,scope_kind,scope_key,dimension,quota_limit,observed_at,expires_at,evidence_digest,basis,evidence_reference) VALUES($1,$2,$3,$4,'railway','component-fixture-account',$5,$6,$7,$8,clock_timestamp(),clock_timestamp()+($9::text||' seconds')::interval,$10,'VERIFIED_OPERATOR_ATTESTATION','COMPONENT_FIXTURE_ONLY_NOT_LIVE_PROVIDER')",[org,str(uuid.uuid4()),f.provider_pool,config_digest,kind,key,dimension,value,str(seconds),sha(b"owned-component-attestation")])
  def dimension(name):return next(d for d in result("provider.pools.capacity",{"pool_id":f.provider_pool})["dimensions"] if d["name"]==name)
  for name,value in [("SANDBOX","1000"),("PROVISIONING","50"),("CPU_MILLIS","2000000"),("MEMORY_BYTES","214748364800"),("DISK_BYTES","2147483648000")]:observation(name,value)
  check(IDS[20],lambda:expect(dimension("SANDBOX")["qualified"] is True,"fresh exact account/environment observations not recognised"))
  check(IDS[21],lambda:expect(dimension("SANDBOX")["budgets"][0]["approved_limit"]=="100" and dimension("SANDBOX")["budgets"][0]["observed_limit"]=="1000","observed limits replaced approved operating budget"))
  def expired():
   f.sql("UPDATE hyperfide.provider_quota_observations SET expires_at=clock_timestamp()-interval '1 second' WHERE organisation_id=$1 AND dimension='SANDBOX'",[org])
   expect(dimension("SANDBOX")["qualified"] is False,"expired provider observations retained authority")
   observation("SANDBOX","1000")
  check(IDS[22],expired)
  def orphan():
   f.sql("INSERT INTO hyperfide.provider_orphans(organisation_id,pool_id,native_sandbox_id) VALUES($1,$2,'component-fixture-unattributed-native')",[org,f.provider_pool])
   report=result("provider.pools.capacity",{"pool_id":f.provider_pool})
   expect(report["unknown_resource_capacity"] is True and dimension("SANDBOX")["used_pool"]=="1","unknown orphan released occupied physical capacity")
  check(IDS[23],orphan)
  ids={}
  # Separate parameterised statements: pg deliberately forbids a multi-command bind.
  def account(kind,quantity):
   aid=str(uuid.uuid4());rid=str(uuid.uuid4())
   f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,configured_limit,reserved,provenance_digest,qualification_state) VALUES($1,$2,$3,'CPU_MILLIS',$4,1000000,$5,$6,'QUALIFIED')",[org,aid,f.provider_pool,kind,quantity,sha(b"component-capacity")])
   f.sql("INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '1 hour')",[org,run,rid,str(uuid.uuid4()),aid,quantity])
   ids[kind]=rid
  def separate():
   account("PHYSICAL","1000");account("EXECUTION","900000")
   expect(dimension("CPU_MILLIS")["used_pool"]=="1000","execution capacity double-charged provider physical quota")
  check(IDS[24],separate)
  def pending():
   f.sql("UPDATE hyperfide.reservations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,ids["PHYSICAL"]])
   expect(dimension("CPU_MILLIS")["used_pool"]=="1000","release pending/TTL released physical capacity without actual proof")
  check(IDS[25],pending)
  def changed():
   f.deployment["revision"]="component-fixture-only-revised";f.config_path.write_text(json.dumps(f.deployment))
   result("provider.pools.configure")
   expect(dimension("SANDBOX")["qualified"] is False,"prior configuration observations crossed changed scope")
  check(IDS[26],changed)
  f.close();f=None;cleanup=True
 finally:
  if f is not None:f.close()
  print(json.dumps({"type":"cleanup","resources":[],"complete":cleanup}),flush=True)
 return 1 if FAILED or not cleanup else 0
if __name__=="__main__":sys.exit(main())
