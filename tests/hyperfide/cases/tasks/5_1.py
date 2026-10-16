#!/usr/bin/env python3
"""Signed scheduler claims against actual PostgreSQL, packets, hierarchy and quotas.
Import SchedulerFixture for downstream tests; import never grants authority.
"""
from __future__ import annotations
import concurrent.futures,copy,importlib.util,json,os,socket,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("hf_packet_fixture",ROOT/"tests/hyperfide/cases/tasks/3_2.py")
packet=importlib.util.module_from_spec(spec);spec.loader.exec_module(packet)
PacketFixture=packet.PacketFixture;uid=packet.uid;identity=packet.identity;sha=packet.sha
FAILED=[];ASSERTION_IDS=[]
def expect(value,message):
 if not value:raise AssertionError(message)
def check(name,callback):
 ASSERTION_IDS.append(name)
 try:callback();actual="observed"
 except Exception as error:FAILED.append(name);actual=type(error).__name__+": "+str(error)
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
class SchedulerFixture(PacketFixture):
 def __init__(self,extra_components=(),extra_setup=None,agent_limit=2,bootstrap=True,sandbox_cpu_limit=8000,sandbox_cpu_headroom=1000,source_object_id=None):
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
   for name,feature,package_key,path in (("a","alpha","package","src/claim-a.ts"),("b","beta","wave_package","src/claim-b.ts"),("overlap","alpha","package","src/claim-a.ts"),("missing","alpha","package","src/missing.ts")):
    task_id=uid();slot_id=uid();i["task_"+name]=task_id;i["slot_"+name]=slot_id
    definition=copy.deepcopy(f.packet_definition);definition.update(feature_key=feature,touches=[path]);f.definitions[name]=definition
    criteria=sha(("accepted-criteria-"+name).encode())
    f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)",[i["organisation"],i["run"],task_id,feature+".claim-"+name,i[package_key],i["spec"],criteria,json.dumps(definition)])
    f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,$4,1,'AGENT','READY')",[i["organisation"],slot_id,i["sandbox"],"claim-"+name])
    if name!="missing":
     policy=copy.deepcopy(f.packet_proof);policy["criteria_digest"]=criteria
     f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,1,$4,$5,$6,$7)",[i["organisation"],i["run"],task_id,i["spec"],criteria,identity(policy),json.dumps(policy)])
   if extra_setup:extra_setup(f)
  super().__init__(extra_components=("5.1","5.2","5.3","5.4")+tuple(extra_components),extra_setup=setup,bootstrap=bootstrap,seed_historical_runtime=False,**({"source_object_id":source_object_id} if source_object_id is not None else {}))
  # Explicit trusted fixed test envelope; not provider/kernel measurement evidence.
  qualified=self.primary("return claims.qualifySandboxBudget(tx,data.qualification);",{"qualification":{"organisation_id":self.ids["organisation"],"sandbox_id":self.ids["sandbox"],"sandbox_boot_generation":"1","qualification_id":uid(),"evidence_digest":sha(b"explicit-fixed-test-envelope"),"source":"OPERATOR_FIXED","hard_limits":{"cpu_millis":str(sandbox_cpu_limit),"memory_bytes":"17179869184","disk_bytes":"34359738368"},"headroom":{"cpu_millis":str(sandbox_cpu_headroom),"memory_bytes":"1073741824","disk_bytes":"0"}}})
  expect("result" in qualified,"Trusted fixture budget failed: "+json.dumps(qualified))
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
  return {"organisation_id":i["organisation"],"run_id":i["run"],"request_id":uid(),"task_id":request["task_id"],"attempt_id":request["attempt_id"],"attempt_generation":request["attempt_generation"],"run_spec_generation":"1","spec_generation":"1","spec_revision_id":i["spec"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","sandbox_id":i["sandbox"],"slot_id":request["slot_id"],"sandbox_boot_generation":"1","lease_ms":lease_ms,"input_packet_digest":result["digest"],"capacity":self.capacity()}
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
def main():
 f=SchedulerFixture();i=f.ids
 try:
  check("claim.fixture.no-seeded-authority",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==0,"Fixture fabricated compute authority"))
  a=f.prepare_claim("a")
  check("claim.strict.fields",lambda:f.reject("scheduler.claim",dict(a,claimed_owner=i["manager"]),"INVALID_REQUEST",key="manager",component="5.1"))
  check("claim.role.denied",lambda:f.reject("scheduler.claim",a,"ROLE_DENIED",key="watcher",component="5.1"))
  check("claim.manager.scope",lambda:f.reject("scheduler.claim",a,"PACKAGE_OWNER_MISMATCH",key="manager2",component="5.1"))
  check("claim.epoch.stale",lambda:f.reject("scheduler.claim",dict(a,authority_epoch=uid()),"STALE_AUTHORITY_EPOCH",key="manager",component="5.1"))
  check("claim.spec.stale",lambda:f.reject("scheduler.claim",dict(a,spec_generation="2"),"STALE_TASK_SPEC",key="manager",component="5.1"))
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
  f.sql("UPDATE hyperfide.sandboxes SET desired_state='DESTROYED' WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["sandbox"]])
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
 return 1 if FAILED else 0
if __name__=="__main__":
 if "--cleanup" in sys.argv:raise SystemExit("Independent crash cleanup requires the persisted owned-resource receipt; not falsely reporting success.")
 raise SystemExit(main())
