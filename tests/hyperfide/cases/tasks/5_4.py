#!/usr/bin/env python3
"""Dynamic resource admission, rate budgets, fairness, backpressure and proof-gated release.

Signed service behaviour runs through the established HTTPS entrypoint. Volume, rate, descendant and
replay checks use the trusted lower scheduler APIs with a real branded primary transaction. The V-047
share here is a reduced component replay, not the full V-047 campaign and not a live qualification.
"""
from __future__ import annotations
import contextlib,copy,importlib.util,io,json,os,random,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("hf_scheduler_fixture",ROOT/"tests/hyperfide/cases/tasks/5_1.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
expect=m.expect;check=m.check;uid=m.uid;sha=m.sha;identity=m.identity
FRAGMENT=json.loads((ROOT/"services/hyperfide/components/5.4.json").read_text())
RUBRIC=sha(b"explicit-review-rubric")
SPEC2='''[meta]
slug = "task5.4-fixture"
[req.5]
title = "Scheduling, reservations and fenced ownership"
ac_4 = "Declared agent, build, test, review, indexing, exclusive and provider limits without fixed ceilings"
[acceptance.V-007]
reqs = ["5.4"]
scenario = "Exceed declared limits"
[proof]
rubric_digest = RUBRIC
[proof.review.5.4]
reviewers = REVIEWERS
rubric_digest = RUBRIC
[task.5.4]
reqs = ["5.4"]
acceptance_ids = ["V-007"]
'''

def accept_resource_spec(f):
 """Re-accept scheduler tasks with the resource review proof mapping at the next generation."""
 f.spec_generation=m.next_spec_generation(f)
 i=f.ids
 source=SPEC2.replace("RUBRIC",json.dumps(RUBRIC)).replace("REVIEWERS",json.dumps([i["watcher"]]))
 parsed=json.loads(subprocess.check_output(["node","--input-type=module","-e","import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT))
 revision=uid();i["spec2"]=revision
 document={"schema_version":1,"revision_digest":sha(b"task5.4-generation-two"),"source_digest":sha(source.encode()),"repositories":[{"repository_id":i["repository"],"source_object_id":"a"*40,"integration_ref":"refs/heads/main"}],"allowed_actions":f.actions,"closure_policy":{"required_evidence":[],"required_review_roles":[],"publication":"AFTER_QUALIFICATION"},"provenance":None,"parsed":parsed,"runtime_wave_offset":0}
 f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[i["organisation"],i["project"],revision,sha(source.encode()),source,json.dumps(document),document["revision_digest"]])
 f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$4,$3)",[i["organisation"],i["run"],revision,f.spec_generation])
 f.sql("UPDATE hyperfide.runs SET spec_revision_id=$3,spec_generation=$4,state='PENDING_VALIDATION',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"],revision,f.spec_generation])
 section=next(x for x in parsed["sections"] if x["name"]=="task.5.4")
 for name in ("a","b","overlap"):
  row=f.sql("SELECT criteria_digest,definition FROM hyperfide.tasks WHERE id=$1",[i["task_"+name]])[0]
  f.sql("UPDATE hyperfide.tasks SET spec_revision_id=$3,spec_generation=$6,definition=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$5",[i["organisation"],i["run"],revision,json.dumps(dict(row["definition"],schema_version=1,section=section)),i["task_"+name],f.spec_generation])
  policy=copy.deepcopy(f.packet_proof);policy.update(criteria_digest=row["criteria_digest"],spec_revision_id=revision,spec_generation=f.spec_generation,rubric_digest=RUBRIC,clauses=[{"id":"5.4","mode":"REVIEW","acceptance_ids":["V-007"],"reviewers":[i["watcher"]],"rubric_digest":RUBRIC}])
  f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,$8,$4,$5,$6,$7)",[i["organisation"],i["run"],i["task_"+name],revision,row["criteria_digest"],identity(policy),json.dumps(policy),f.spec_generation])
 f.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"]])

def setup(f):
 accept_resource_spec(f)
 i=f.ids
 # Declared execution envelope large enough that job-kind dimensions, not CPU, are the binding limits.
 for dimension,limit in (("CPU_MILLIS","64000"),("MEMORY_BYTES","137438953472"),("DISK_BYTES","274877906944")):
  f.sql("UPDATE hyperfide.capacity_accounts SET configured_limit=$2,state_version=state_version+1 WHERE id=$1",[f.accounts[dimension],limit])
 f.named={}
 for key in ("fixture-db","fixture-cache"):
  f.named[key]=uid()
  f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,resource_key,configured_limit,provenance_digest,qualification_state) VALUES($1,$2,$3,'EXCLUSIVE_SERVICE','EXCLUSIVE',$4,1,$5,'QUALIFIED')",[i["organisation"],f.named[key],i["pool"],key,sha(b"declared-exclusive-service")])
 for dimension in ("PROVISION_RATE","API_RATE","MODEL_RATE"):
  f.accounts[dimension]=uid()
  f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,configured_limit,provenance_digest,qualification_state) VALUES($1,$2,$3,$4,'RATE',2,$5,'QUALIFIED')",[i["organisation"],f.accounts[dimension],i["pool"],dimension,sha(b"declared-provider-quota")])
 # Expose the established service's own registry description to the fixture principals.
 config=json.loads(f.identity_config.read_text())
 for principal in config["principals"]:
  if "system.describe" not in principal["allowed_actions"]:principal["allowed_actions"].append("system.describe")
 f.identity_config.write_text(json.dumps(config))
 f.sql("UPDATE hyperfide.identity_principals SET allowed_actions=array_append(allowed_actions,'system.describe') WHERE organisation_id=$1 AND NOT('system.describe'=ANY(allowed_actions))",[i["organisation"]])
 policy=json.loads(f.policy.read_text());policy["allowed_actions"].append("system.describe");f.policy.write_text(json.dumps(policy))

class ResourceFixture(m.SchedulerFixture):
 def __init__(self):
  super().__init__(extra_setup=setup)
 def prepare_claim(self,name="a",lease_ms=300000):
  return dict(super().prepare_claim(name,lease_ms),run_spec_generation=self.spec_generation,spec_generation=self.spec_generation,spec_revision_id=self.ids["spec2"])
 def set_policy(self,**values):
  sets=",".join(k+"="+str(int(v)) for k,v in values.items())
  self.sql("UPDATE hyperfide.scheduling_policies SET "+sets+",revision=revision+1,state_version=state_version+1 WHERE organisation_id=$1 AND pool_id=$2",[self.ids["organisation"],self.ids["pool"]])
 def account(self,ident):
  return self.sql("SELECT reserved::text,allocated::text,configured_limit::text FROM hyperfide.capacity_accounts WHERE id=$1",[ident])[0]
 def lower(self,body,data=None,timeout=60):
  """Trusted lower scheduler APIs inside real branded primary transactions; never a public auth substitute."""
  script="""import fs from 'node:fs';import crypto from 'node:crypto';
import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';
import * as claims from './services/hyperfide/dist/scheduler/claim.js';
import * as resources from './services/hyperfide/dist/scheduler/resources.js';
const data=JSON.parse(fs.readFileSync(0,'utf8'));
const container=createResourceContainer({role:'control',env:process.env,signal:new AbortController().signal});
const guard=async tx=>{const r=await tx.query('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[data.scope.organisation_id,data.scope.run_id]);if(r.rows[0]?.authority_epoch!==data.epoch)throw Error('Test primary epoch changed');};
const run=async fn=>{try{return {result:await container.gateway.withPrimaryTransaction({timeoutMs:20000,maxRetries:3,guard},fn)};}catch(e){if(typeof e?.code==='string')return {error:{code:e.code,message:e.message}};throw e;}};
const proof=()=>({id:crypto.randomUUID(),digest:'sha256:'+crypto.randomBytes(32).toString('hex'),observed_at:new Date().toISOString()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pending=(tx,ids)=>tx.query("UPDATE hyperfide.reservations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) AND state IN ('PROVISIONING','ALLOCATED')",[data.scope.organisation_id,data.scope.run_id,ids]);
try{const out=await (async()=>{"""+body+"""})();process.stdout.write(JSON.stringify(out));}finally{await container.close();}
"""
  payload={"scope":{"organisation_id":self.ids["organisation"],"run_id":self.ids["run"]},"epoch":self.ids["epoch"],"pool":self.ids["pool"],**(data or {})}
  result=subprocess.run(["node","--input-type=module","-e",script],input=json.dumps(payload),text=True,cwd=ROOT,env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
  expect(result.returncode==0,"Trusted lower API probe failed: "+result.stderr[:1500]);return json.loads(result.stdout)
 def new_pool(self,limits):
  i=self.ids;pool=uid();accounts={}
  self.sql("INSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region) VALUES($1,$2,'fixture','fixture',$3,'fixture')",[i["organisation"],pool,"volume-"+pool[:8]])
  self.sql("INSERT INTO hyperfide.scheduling_policies(organisation_id,pool_id) VALUES($1,$2)",[i["organisation"],pool])
  for dimension,limit in limits.items():
   accounts[dimension]=uid()
   self.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,capacity_class,configured_limit,provenance_digest,qualification_state) VALUES($1,$2,$3,$4,'EXECUTION',$5,$6,'QUALIFIED')",[i["organisation"],accounts[dimension],pool,dimension,str(limit),sha(b"declared-volume-budget")])
  return pool,accounts

def scope_of(f):
 i=f.ids
 return {"organisation_id":i["organisation"],"run_id":i["run"],"pool_id":i["pool"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","package_id":i["package"]}
def job(f,kind,priority=0,wait="CAPACITY",deadline=300000,task="a"):
 return dict(scope_of(f),request_id=uid(),task_id=f.ids["task_"+task],job_kind=kind,priority=priority,wait_reason=wait,deadline_ms=deadline,dimensions=f.capacity(kind))
def queue(f,request):return f.ok("scheduler.resources.queue",request,key="manager",component="5.4")
def admit(f,waiter,**extra):return f.ok("scheduler.resources.admit",dict(scope_of(f),waiter_id=waiter,**extra),key="manager",component="5.4")
def expire(f,waiter):
 while f.sql("SELECT deadline_at>clock_timestamp() AS live FROM hyperfide.resource_waiters WHERE id=$1",[waiter])[0]["live"]:time.sleep(.05)
def reservations(f,requests):
 return [r["id"] for r in f.sql("SELECT id FROM hyperfide.reservations WHERE request_id=ANY($1::uuid[]) ORDER BY id",[requests])]
def waiter_request(f,waiter):return f.sql("SELECT request_id FROM hyperfide.resource_waiters WHERE id=$1",[waiter])[0]["request_id"]

def limit_kind(f,kind,observed):
 """Admit at the declared limit of two, then show the third stays queued naming the dimension."""
 before=f.sql("SELECT count(*)::int n FROM hyperfide.reservations")[0]["n"]
 first=[admit(f,queue(f,job(f,kind))["waiter_id"]) for _ in range(2)]
 over=queue(f,job(f,kind,deadline=1500))["waiter_id"]
 refused=admit(f,over)
 observed[kind]={"admitted":[x["admitted"] for x in first],"refused":refused}
 expect(all(x["admitted"] is True for x in first),kind+" at its declared limit was refused")
 expect(refused["admitted"] is False and refused["state"]=="QUEUED" and refused["limiting_resource"]["dimension"]==kind and refused["limiting_resource"]["configured_limit"]=="2" and refused["limiting_resource"]["occupied"]=="2","Refusal did not name the actual limiting "+kind+" dimension: "+json.dumps(refused))
 expect(f.sql("SELECT count(*)::int n FROM hyperfide.reservations")[0]["n"]==before+8,"Queued refusal partially reserved capacity")
 expect(f.account(f.accounts[kind])["allocated"]=="2","Declared "+kind+" limit was not enforced exactly")
 expect(f.sql("SELECT wait_reason FROM hyperfide.resource_waiters WHERE id=$1",[over])[0]["wait_reason"]==refused["wait_reason"],"Durable wait reason differs from admission outcome")
 expire(f,over)

def primary_section(f):
 i=f.ids;scope=scope_of(f);state={}
 f.prepare_claim("a");f.prepare_claim("b")
 discovery=f.ok("scheduler.resources.eligible",scope,key="manager",component="5.4")
 check("resources.eligible.real-pins",lambda:expect(any(t["task_id"]==i["task_a"] and t["execution_packet"]["execution_authority"] is False for t in discovery["eligible"]),"Actual packet candidate missing: "+json.dumps(discovery["excluded"])))
 check("resources.eligible.manager-private",lambda:expect(all(t["task_id"]!=i["task_b"] for t in discovery["eligible"]) and all(t["task_id"]!=i["task_b"] for t in discovery["excluded"]),"Manager observed another owner's task shortlist"))
 check("resources.eligible.no-authority",lambda:expect(discovery["authority"]=="CANDIDATE_DISCOVERY" and f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==0,"Discovery granted compute"))
 demand={"organisation_id":i["organisation"],"run_id":i["run"],"pool_id":i["pool"],"profile_id":i["profile"],"job_class":"PREPARATION","warm_spare":True}
 creation=f.ok("scheduler.resources.demand",dict(demand,warm_spare=False),key="manager",component="5.4")
 physical={row["capacity_account_id"]:row["quantity"] for row in creation["reservation_dimensions"]}
 check("resources.prewarm.full-provisioned-profile",lambda:expect(physical[f.physical_accounts["CPU_MILLIS"]]=="4000" and physical[f.physical_accounts["MEMORY_BYTES"]]=="8589934592" and physical[f.physical_accounts["DISK_BYTES"]]=="21474836480" and len(physical)==4,"Creation undercharged fixed sandbox profile with smaller task demand"))
 check("resources.prewarm.execution-separate",lambda:expect(creation["preparation_task_id"] in (i["task_a"],i["task_overlap"]) and {r["capacity_account_id"]:r["quantity"] for r in creation["execution_dimensions"]}[f.accounts["CPU_MILLIS"]]=="1000" and len(creation["execution_dimensions"])==4,"Execution work was blended into physical CREATE quota"))
 check("resources.prewarm.manager-spares-denied",lambda:f.reject("scheduler.resources.demand",demand,"SPARE_DELEGATION_REQUIRED",key="manager",component="5.4"))
 request=job(f,"TEST",wait="BUILD")
 check("resources.task-required",lambda:f.reject("scheduler.resources.queue",{k:v for k,v in request.items() if k!="task_id"},"TASK_REQUIRED",key="manager",component="5.4"))
 check("resources.manager.scope",lambda:f.reject("scheduler.resources.queue",request,"PACKAGE_OWNER_MISMATCH",key="manager2",component="5.4"))
 bad=dict(request,request_id=uid(),dimensions=[d for d in request["dimensions"] if d["capacity_account_id"]==f.accounts["TEST"]])
 check("resources.full-vector-required",lambda:f.reject("scheduler.resources.queue",bad,"RESOURCE_VECTOR_MISMATCH",key="manager",component="5.4"))
 queued=queue(f,request)
 check("resources.queue-not-compute",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==0,"Independent TEST reservation fabricated coding attempt"))
 check("resources.queue-replay",lambda:expect(queue(f,request)["waiter_id"]==queued["waiter_id"],"Queue replay created another waiter"))
 check("resources.queue-conflict",lambda:f.reject("scheduler.resources.queue",dict(request,priority=1),"IDEMPOTENCY_CONFLICT",key="manager",component="5.4"))
 admitted=admit(f,queued["waiter_id"])
 check("resources.test.admitted",lambda:expect(admitted["admitted"] is True and f.sql("SELECT count(*)::int n FROM hyperfide.reservations WHERE state='ALLOCATED'")[0]["n"]==4,"TEST job lacks complete allocated vector"))
 check("resources.agent-independent",lambda:expect(next(r for r in f.counts() if r["dimension"]=="AGENT")["allocated"]=="0","Independent verifier consumed coding AGENT quota"))
 check("resources.admission-replay",lambda:expect(admit(f,queued["waiter_id"])["replayed"] is True and f.sql("SELECT count(*)::int n FROM hyperfide.reservations")[0]["n"]==4,"Admission replay duplicated counters"))
 ids=[r["id"] for r in f.sql("SELECT id FROM hyperfide.reservations")]
 check("resources.no-proof.no-release",lambda:f.reject("scheduler.resources.release",{k:v for k,v in dict(scope,reservation_ids=ids).items() if k!="pool_id"},"DEPENDENCY_UNAVAILABLE",key="manager",component="5.4"))
 inspected=f.ok("scheduler.resources.inspect",scope,key="manager",component="5.4")
 check("resources.primary-snapshot",lambda:expect(inspected["observation"]=="PRIMARY_SNAPSHOT" and inspected["measurement_status"]=="NOT_A_PERFORMANCE_QUALIFICATION","Inspect manufactured a performance qualification"))
 due=queue(f,dict(request,request_id=uid(),deadline_ms=1000))
 expire(f,due["waiter_id"])
 expired=admit(f,due["waiter_id"])
 check("resources.queue.primary-deadline",lambda:expect(expired["state"]=="EXPIRED" and expired["admitted"] is False,"Expired queue admitted work"))
 check("resources.deadline.no-physical-release",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.reservations WHERE state='ALLOCATED'")[0]["n"]==4,"Queue expiry freed another job's occupied capacity"))

 # do_1(a): every declared job class is a dynamic limit that names itself when it binds.
 limits={}
 for kind in ("REVIEW","INDEX","INTEGRATION"):
  check("resources.limit."+kind.lower()+".named",lambda kind=kind:limit_kind(f,kind,limits))
 def exclusive():
  body="""const r=resources,s=data.scope,expires=new Date(Date.now()+3600000).toISOString(),req=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  const reserve=(id,account)=>run(tx=>r.reserveDynamic(tx,{...s,request_id:id,pool_id:data.pool,dimensions:[{capacity_account_id:account,quantity:'1'}],expires_at:expires}));
  const first=await reserve(req[0],data.db),second=await reserve(req[1],data.db),limit=await run(tx=>r.limitingResource(tx,{...s,pool_id:data.pool,request_id:req[1],dimensions:[{capacity_account_id:data.db,quantity:'1'}]})),other=await reserve(req[2],data.cache);
  return {first,second,limit,other};"""
  out=f.lower(body,{"db":f.named["fixture-db"],"cache":f.named["fixture-cache"]})
  state["exclusive"]=out
  expect("result" in out["first"] and out["second"].get("error",{}).get("code")=="CAPACITY_LIMIT" and "EXCLUSIVE_SERVICE" in out["second"]["error"]["message"],"Second holder of a named exclusive service was admitted: "+json.dumps(out))
  expect(out["limit"]["result"]["dimension"]=="EXCLUSIVE_SERVICE" and out["limit"]["result"]["resource_key"]=="fixture-db" and out["limit"]["result"]["capacity_class"]=="EXCLUSIVE" and out["limit"]["result"]["wait_reason"]=="EXCLUSIVE_SERVICE","Exclusive limit was not named")
  expect("result" in out["other"] and f.account(f.named["fixture-db"])["reserved"]=="1" and f.account(f.named["fixture-cache"])["reserved"]=="1","Named exclusive services were not accounted independently")
 check("resources.limit.exclusive-service.named",exclusive)

 # Stalled work: current compute past its primary-clock lease. It must never be confused with queued work.
 b=f.prepare_claim("b",lease_ms=1500);stalled=f.ok("scheduler.claim",b,key="manager2",component="5.1")
 while f.sql("SELECT lease_expires_at>clock_timestamp() AS live FROM hyperfide.attempts WHERE id=$1",[stalled["token"]["attempt_id"]])[0]["live"]:time.sleep(.05)
 # BUILD-limited, MODEL-declared and REVIEW-backpressured waiters coexist.
 builds=[admit(f,queue(f,job(f,"BUILD"))["waiter_id"]) for _ in range(2)]
 build_wait=queue(f,job(f,"BUILD",deadline=8000))["waiter_id"];build_result=admit(f,build_wait)
 model_wait=queue(f,job(f,"TEST",wait="MODEL",deadline=8000))["waiter_id"]
 a=f.prepare_claim("a")
 agent=queue(f,dict(scope,request_id=a["request_id"],task_id=i["task_a"],job_kind="AGENT",priority=0,wait_reason="CAPACITY",deadline_ms=300000,dimensions=a["capacity"]))["waiter_id"]
 pressured=admit(f,agent,claim=a)
 def backpressure():
  expect(all(x["admitted"] for x in builds) and build_result["admitted"] is False and build_result["wait_reason"]=="BUILD" and build_result["limiting_resource"]["dimension"]=="BUILD","BUILD limit did not produce a BUILD wait: "+json.dumps(build_result))
  expect(pressured["admitted"] is False and pressured["state"]=="QUEUED" and pressured["wait_reason"]=="REVIEW" and pressured["limiting_resource"]["cause"]=="BACKPRESSURE" and pressured["limiting_resource"]["dimension"] in ("REVIEW","INTEGRATION") and pressured["backpressure"]["active"] is True,"Coding work was admitted against saturated review: "+json.dumps(pressured))
  expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE task_id=$1",[i["task_a"]])[0]["n"]==0 and f.sql("SELECT wait_reason,state FROM hyperfide.resource_waiters WHERE id=$1",[agent])[0]=={"wait_reason":"REVIEW","state":"WAITING"},"Backpressured coding wait is not durable or created compute")
 check("resources.backpressure.review-wait",backpressure)
 inspected=f.ok("scheduler.resources.inspect",scope,key="manager",component="5.4");state["inspect"]=inspected
 def distinguish():
  queues={(q["job_kind"],q["wait_reason"]):q for q in inspected["queues"]}
  expect(set(queues)=={("BUILD","BUILD"),("TEST","MODEL"),("AGENT","REVIEW")},"Inspect queue classes differ: "+json.dumps(inspected["queues"]))
  expect(all(q["state"]=="QUEUED" and q["stalled"] is False for q in queues.values()),"Queued work was classified as stalled")
  expect([x["attempt_id"] for x in inspected["stalled"]]==[stalled["token"]["attempt_id"]] and inspected["stalled"][0]["state"]=="STALLED","Stalled execution is not separately identified")
  expect(inspected["backpressure"]["active"] is True and inspected["backpressure"]["limiting_resource"] in ("REVIEW","INTEGRATION") and all(d["saturated"] for d in inspected["backpressure"]["dimensions"]),"Inspect hides review backpressure")
 check("resources.inspect.wait-vs-stalled",distinguish)
 expire(f,build_wait);expire(f,model_wait)
 # Backpressured coding work cannot hold the head of line against the review work that relieves it.
 relief=queue(f,job(f,"REVIEW"))["waiter_id"];blocked=admit(f,relief)
 check("resources.backpressure.no-head-of-line",lambda:expect(blocked["admitted"] is False and blocked["wait_reason"]=="REVIEW" and blocked["limiting_resource"]["dimension"]=="REVIEW","Review relief was blocked by backpressured coding fairness: "+json.dumps(blocked)))
 # do_2(f): positive proof-gated release of the admitted REVIEW and INTEGRATION jobs.
 review_requests=[r["request_id"] for r in f.sql("SELECT request_id FROM hyperfide.resource_waiters WHERE job_kind IN ('REVIEW','INTEGRATION') AND state='ADMITTED' ORDER BY admitted_at")]
 review_ids=reservations(f,review_requests);before=f.counts()
 body="""const ids=data.ids,s=data.scope;await run(tx=>pending(tx,ids));
 const none=await run(tx=>new resources.ResourceScheduler().release(tx,{...s,reservation_ids:ids}));
 const blind=new resources.ResourceScheduler();blind.registerProofReader('runner.quiescence',async()=>null);
 const unconfirmed=await run(tx=>blind.release(tx,{...s,reservation_ids:ids}));
 const seen=new resources.ResourceScheduler(),calls=[];seen.registerProofReader('runner.quiescence',async(tx,x)=>{calls.push(x.reservation_id);return proof();});
 const middle=(await run(tx=>tx.query('SELECT reserved::text,allocated::text FROM hyperfide.capacity_accounts WHERE id=$1',[data.review]))).result.rows[0];
 const released=await run(tx=>seen.release(tx,{...s,reservation_ids:ids}));
 const after=(await run(tx=>tx.query('SELECT reserved::text,allocated::text FROM hyperfide.capacity_accounts WHERE id=$1',[data.review]))).result.rows[0];
 const replay=await run(tx=>seen.release(tx,{...s,reservation_ids:ids}));
 const final=(await run(tx=>tx.query('SELECT reserved::text,allocated::text FROM hyperfide.capacity_accounts WHERE id=$1',[data.review]))).result.rows[0];
 return {none,unconfirmed,middle,released,after,replay,final,calls:calls.length};"""
 out=f.lower(body,{"ids":review_ids,"review":f.accounts["REVIEW"]});state["release"]=out
 def released():
  expect(out["none"]["error"]["code"]=="DEPENDENCY_UNAVAILABLE" and out["unconfirmed"]["error"]["code"]=="QUIESCENCE_UNCONFIRMED","Release proceeded without a quiescence proof")
  expect(out["middle"]=={"reserved":"0","allocated":"2"},"Pending release freed capacity before proof")
  expect(sorted(out["released"]["result"]["released_reservation_ids"])==sorted(review_ids) and out["after"]=={"reserved":"0","allocated":"0"},"Proof did not release exactly the pending reservations")
  expect(out["calls"]==len(review_ids) and sorted(out["replay"]["result"]["released_reservation_ids"])==sorted(review_ids) and out["final"]==out["after"],"Release replay decremented counters again")
  after={r["dimension"]:int(r["allocated"]) for r in f.counts()};prior={r["dimension"]:int(r["allocated"]) for r in before}
  expect(prior["CPU_MILLIS"]-after["CPU_MILLIS"]==4000 and prior["REVIEW"]-after["REVIEW"]==2 and prior["INTEGRATION"]-after["INTEGRATION"]==2,"Execution counters were not decremented exactly once")
  expect(f.sql("SELECT count(*)::int n FROM hyperfide.reservations WHERE id=ANY($1::uuid[]) AND state='RELEASED' AND release_reason='OBSERVED_QUIESCENT'",[review_ids])[0]["n"]==len(review_ids),"Durable release state differs")
 check("resources.release.proof-positive",released)
 # Once the backlog clears, the older coding waiter is the fair head again; the review job follows it.
 relieved=admit(f,agent,claim=a);relief_result=admit(f,relief)
 def relief_check():
  expect(relief_result["admitted"] is True,"Review relief was not admitted after release: "+json.dumps(relief_result))
  expect(relieved["admitted"] is True and f.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE task_id=$1 AND compute_authority='CURRENT'",[i["task_a"]])[0]["n"]==1,"Coding work stayed blocked after review backlog cleared: "+json.dumps(relieved))
 check("resources.backpressure.relieved",relief_check)
 def describe():
  result=f.ok("system.describe",{},key="operator",component="system")
  entries=[c for c in result["components"] if c["id"]=="5.4"]
  expect(len(entries)==1 and entries[0]["actions"]==FRAGMENT["actions"],"Established service did not load task 5.4 with its declared actions: "+json.dumps(entries))
 check("resources.service.registered",describe)
 return state

def fairness_section(f):
 i=f.ids;state={}
 f.set_policy(aging_seconds=3600,max_bypass_seconds=4)
 older=queue(f,job(f,"TEST",priority=0))["waiter_id"]
 newer=queue(f,job(f,"REVIEW",priority=10))["waiter_id"]
 bypassed=admit(f,older)
 b=f.prepare_claim("b")
 head=f.invoke("scheduler.claim",b,key="manager2",component="5.1")[1]
 first=admit(f,newer)
 def priority():
  expect(bypassed=={"waiter_id":older,"admitted":False,"wait_reason":"FAIRNESS","state":"QUEUED"},"Older waiter was not reported as fairly bypassed: "+json.dumps(bypassed))
  expect(head.get("error",{}).get("code")=="FAIRNESS_WAIT","Direct claim bypassed the resource queue head: "+json.dumps(head))
  expect(first["admitted"] is True,"High-priority newer waiter was not admitted first")
 check("resources.fairness.priority-first",priority)
 while f.sql("SELECT extract(epoch FROM clock_timestamp()-enqueued_at)>=4 AS due FROM hyperfide.resource_waiters WHERE id=$1",[older])[0]["due"] is not True:time.sleep(.05)
 later=queue(f,job(f,"INDEX",priority=10))["waiter_id"]
 starved=admit(f,later);rescued=admit(f,older)
 def bounded():
  expect(starved["admitted"] is False and starved["wait_reason"]=="FAIRNESS","Newer high priority kept bypassing past max_bypass_seconds")
  expect(rescued["admitted"] is True,"Bypassed older waiter was starved")
  expect(admit(f,later)["admitted"] is True,"Later waiter was not admitted after the starved one")
 check("resources.fairness.bounded-bypass",bounded)
 f.set_policy(max_waiters=2)
 x1=queue(f,job(f,"TEST",deadline=1000))["waiter_id"];x2=job(f,"INTEGRATION")
 x3=queue(f,job(f,"INTEGRATION",deadline=1000))["waiter_id"]
 def overload():
  f.reject("scheduler.resources.queue",x2,"RESOURCE_QUEUE_OVERLOADED",key="manager",component="5.4")
  expect(f.sql("SELECT count(*)::int n FROM hyperfide.resource_waiters WHERE request_id=$1",[x2["request_id"]])[0]["n"]==0,"Overloaded queue retained a waiter")
 check("resources.queue.overload",overload)
 expire(f,x1);expire(f,x3);f.set_policy(max_waiters=10000)
 # do_2(d): native descendants aggregate with the parent against the qualified per-sandbox budget.
 a=f.prepare_claim("a");parent=f.ok("scheduler.claim",a,key="manager",component="5.1")
 children=[uid() for _ in range(3)]
 body="""const s=data.scope,expires=new Date(Date.now()+3600000).toISOString(),ex={...s,sandbox_id:data.sandbox,sandbox_boot_generation:'1',slot_id:data.slot};
 const child=(id,cpu)=>run(async tx=>{const r=await resources.reserveDynamic(tx,{...s,request_id:id,pool_id:data.pool,attempt_id:data.attempt,expires_at:expires,dimensions:[{capacity_account_id:data.cpu,quantity:String(cpu)},{capacity_account_id:data.mem,quantity:'2147483648'},{capacity_account_id:data.disk,quantity:'4294967296'}]});const c=await claims.reserveSandboxResources(tx,{...ex,request_id:id,attempt_id:data.attempt,job_kind:'CHILD',resources:{cpu_millis:String(cpu),memory_bytes:'2147483648',disk_bytes:'4294967296'}});return {r,c};});
 const held=async()=>(await run(tx=>tx.query('SELECT held_cpu_millis::text FROM hyperfide.sandbox_execution_budgets WHERE organisation_id=$1 AND sandbox_id=$2',[s.organisation_id,data.sandbox]))).result.rows[0].held_cpu_millis;
 const one=await child(data.children[0],3000),two=await child(data.children[1],3000),full=await held(),three=await child(data.children[2],1000);
 const ids=(await run(tx=>tx.query('SELECT id FROM hyperfide.reservations WHERE request_id=$1',[data.children[0]]))).result.rows.map(r=>r.id);
 await run(async tx=>{await pending(tx,ids);await claims.markSandboxReleasePending(tx,{...s,request_id:data.children[0]});});
 const none=await run(tx=>new resources.ResourceScheduler().release(tx,{...s,reservation_ids:ids})),stillNone=await held();
 const blind=new resources.ResourceScheduler();blind.registerProofReader('runner.quiescence',async()=>null);
 const unconfirmed=await run(tx=>blind.release(tx,{...s,reservation_ids:ids})),stillBlind=await held();
 const seen=new resources.ResourceScheduler();seen.registerProofReader('runner.quiescence',async()=>proof());
 const released=await run(tx=>seen.release(tx,{...s,reservation_ids:ids})),after=await held(),retry=await child(data.children[2],1000),end=await held();
 return {one,two,full,three,none,stillNone,unconfirmed,stillBlind,released,after,retry,end};"""
 out=f.lower(body,{"children":children,"sandbox":i["sandbox"],"slot":i["slot_a"],"attempt":parent["token"]["attempt_id"],"cpu":f.accounts["CPU_MILLIS"],"mem":f.accounts["MEMORY_BYTES"],"disk":f.accounts["DISK_BYTES"]});state["children"]=out
 def descendants():
  expect("result" in out["one"] and "result" in out["two"] and out["full"]=="7000","Parent and native children did not aggregate on the sandbox budget: "+json.dumps(out)[:600])
  expect(out["three"].get("error",{}).get("code")=="SANDBOX_CAPACITY_EXHAUSTED","Child exceeding the aggregate per-sandbox budget was admitted")
  expect(f.sql("SELECT job_kind,count(*)::int n FROM hyperfide.sandbox_execution_charges WHERE attempt_id=$1 GROUP BY job_kind ORDER BY job_kind",[parent["token"]["attempt_id"]])==[{"job_kind":"AGENT","n":1},{"job_kind":"CHILD","n":3}],"Child usage is not visible against its parent attempt")
 check("resources.child.aggregate-budget",descendants)
 def child_release():
  expect(out["none"]["error"]["code"]=="DEPENDENCY_UNAVAILABLE" and out["unconfirmed"]["error"]["code"]=="QUIESCENCE_UNCONFIRMED" and out["stillNone"]=="7000" and out["stillBlind"]=="7000","Child capacity was freed without quiescence proof")
  expect("result" in out["released"] and out["after"]=="4000" and "result" in out["retry"] and out["end"]=="5000","Proof-released child capacity was not reusable exactly once")
 check("resources.child.counted-until-proof",child_release)
 # do_2(e): physical provisioning reservations remain occupied until provider absence is observed.
 creation=f.ok("scheduler.resources.demand",{"organisation_id":i["organisation"],"run_id":i["run"],"pool_id":i["pool"],"profile_id":i["profile"],"job_class":"PREPARATION","warm_spare":False},key="manager",component="5.4")
 body="""const s=data.scope,id=crypto.randomUUID();
 const made=await run(tx=>resources.reserveDynamic(tx,{...s,request_id:id,pool_id:data.pool,dimensions:data.dims,expires_at:new Date(Date.now()+3600000).toISOString()}));
 const ids=made.result.reservations.map(r=>r.id),occupied=async()=>(await run(tx=>tx.query("SELECT dimension,reserved::text FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 AND capacity_class='PHYSICAL' ORDER BY dimension",[s.organisation_id,data.pool]))).result.rows;
 const held=await occupied();await run(tx=>pending(tx,ids));
 const runner=new resources.ResourceScheduler();runner.registerProofReader('runner.quiescence',async()=>proof());
 const refused=await run(tx=>runner.release(tx,{...s,reservation_ids:ids})),still=await occupied();
 const provider=new resources.ResourceScheduler();provider.registerProofReader('provider.absence',async()=>proof());
 const released=await run(tx=>provider.release(tx,{...s,reservation_ids:ids})),after=await occupied();
 return {made,held,refused,still,released,after,count:ids.length};"""
 out=f.lower(body,{"dims":creation["reservation_dimensions"]});state["provision"]=out
 def provision():
  held={r["dimension"]:r["reserved"] for r in out["held"]}
  expect(out["count"]==4 and held=={"CPU_MILLIS":"4000","DISK_BYTES":"21474836480","MEMORY_BYTES":"8589934592","SANDBOX":"1"},"Provisioning did not hold the full provisioned profile: "+json.dumps(out["held"]))
  expect(out["refused"]["error"]["code"]=="QUIESCENCE_UNCONFIRMED" and out["still"]==out["held"],"Runner quiescence released physical provisioning")
  expect("result" in out["released"] and all(r["reserved"]=="0" for r in out["after"]),"Provider absence did not release the provisioning reservation")
 check("resources.provision.counted-until-absence",provision)
 # do_1(b): provider quota and API/model rate budgets in durable windows.
 f.set_policy(rate_window_ms=3000)
 body="""const s=data.scope,expires=new Date(Date.now()+3600000).toISOString();
 const reserve=(id,account)=>run(tx=>resources.reserveDynamic(tx,{...s,request_id:id,pool_id:data.pool,dimensions:[{capacity_account_id:account,quantity:'1'}],expires_at:expires}));
 while(Date.now()%3000>300)await sleep(10);
 const out={};
 for(const [name,account] of Object.entries(data.rates)){
  const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  const first=await reserve(ids[0],account),second=await reserve(ids[1],account),third=await reserve(ids[2],account),replay=await reserve(ids[0],account);
  const limit=await run(tx=>resources.limitingResource(tx,{...s,pool_id:data.pool,request_id:ids[2],dimensions:[{capacity_account_id:account,quantity:'1'}]}));
  const consumed=(await run(tx=>tx.query('SELECT sum(consumed)::text AS n FROM hyperfide.capacity_rate_windows WHERE capacity_account_id=$1',[account]))).result.rows[0].n;
  out[name]={ids,first,second,third,replay,limit,consumed};
 }
 const elapsed=Date.now()%3000;
 await sleep(3000-elapsed+100);
 for(const [name,account] of Object.entries(data.rates))out[name].next=await reserve(out[name].ids[2],account);
 out.same_window=elapsed<2900;return out;"""
 out=f.lower(body,{"rates":{k:f.accounts[k] for k in ("PROVISION_RATE","API_RATE","MODEL_RATE")}});state["rates"]=out
 def rates():
  expect(out["same_window"] is True,"Rate probe crossed a window boundary")
  for name,wait in (("PROVISION_RATE","PROVIDER_RATE"),("API_RATE","PROVIDER_RATE"),("MODEL_RATE","MODEL")):
   x=out[name]
   expect("result" in x["first"] and "result" in x["second"],name+" refused inside its declared budget")
   expect(x["third"].get("error",{}).get("code")=="RATE_LIMIT" and x["third"]["error"]["message"]=="Admission is limited by "+name,name+" over budget was admitted: "+json.dumps(x["third"]))
   expect(x["limit"]["result"]["dimension"]==name and x["limit"]["result"]["wait_reason"]==wait,"Limiting rate dimension was not named")
   expect("result" in x["next"] and x["next"]["result"]["rate_receipts"][0]["window_start"]!=x["first"]["result"]["rate_receipts"][0]["window_start"],name+" did not admit again in the next window")
 check("resources.rate.window-limit",rates)
 def rate_replay():
  for name in ("PROVISION_RATE","API_RATE","MODEL_RATE"):
   x=out[name]
   expect(x["replay"]==x["first"] and x["consumed"]=="2","Rate receipt replay consumed budget again")
   expect(f.sql("SELECT count(*)::int n FROM hyperfide.capacity_rate_receipts WHERE request_id=$1",[x["ids"][0]])[0]["n"]==1,"Rate receipt duplicated")
 check("resources.rate.idempotent-receipts",rate_replay)
 return state

def ceiling_section(f):
 """do_1(c): no fixed 16-slot or 256-start ceiling; declared limits still bind exactly."""
 pool,accounts=f.new_pool({"AGENT":1000})
 body="""const s=data.scope,expires=new Date(Date.now()+3600000).toISOString(),dims=[{capacity_account_id:data.agent,quantity:'1'}];
 const results=[];for(let n=0;n<40;n++)results.push(await run(tx=>resources.reserveDynamic(tx,{...s,request_id:crypto.randomUUID(),pool_id:data.target,dimensions:dims,expires_at:expires})));
 await run(tx=>tx.query('UPDATE hyperfide.capacity_accounts SET configured_limit=40,state_version=state_version+1 WHERE id=$1',[data.agent]));
 const over=await run(tx=>resources.reserveDynamic(tx,{...s,request_id:crypto.randomUUID(),pool_id:data.target,dimensions:dims,expires_at:expires}));
 return {admitted:results.filter(r=>'result' in r).length,over};"""
 concurrent=f.lower(body,{"target":pool,"agent":accounts["AGENT"]})
 check("resources.no-fixed-concurrency-ceiling",lambda:expect(concurrent["admitted"]==40 and f.account(accounts["AGENT"])["reserved"]=="40" and concurrent["over"].get("error",{}).get("code")=="CAPACITY_LIMIT" and concurrent["over"]["error"]["message"]=="Admission is limited by AGENT","Concurrent AGENT reservations hit a hidden ceiling or ignored the declared limit: "+json.dumps(concurrent)[:400]))
 pool,accounts=f.new_pool({"AGENT":1})
 body="""const s=data.scope,expires=new Date(Date.now()+3600000).toISOString(),dims=[{capacity_account_id:data.agent,quantity:'1'}];
 const reader=new resources.ResourceScheduler();reader.registerProofReader('runner.quiescence',async()=>proof());
 let started=0,refusedWhileHeld=0;
 for(let n=0;n<300;n++){
  const made=await run(tx=>resources.reserveDynamic(tx,{...s,request_id:crypto.randomUUID(),pool_id:data.target,dimensions:dims,expires_at:expires}));
  if(!('result' in made))break;started++;
  if(n%100===0){const blocked=await run(tx=>resources.reserveDynamic(tx,{...s,request_id:crypto.randomUUID(),pool_id:data.target,dimensions:dims,expires_at:expires}));if(blocked.error?.code==='CAPACITY_LIMIT')refusedWhileHeld++;}
  const ids=made.result.reservations.map(r=>r.id);
  const done=await run(async tx=>{await pending(tx,ids);return reader.release(tx,{...s,reservation_ids:ids});});
  if(!('result' in done))break;
 }
 return {started,refusedWhileHeld};"""
 t0=time.monotonic();starts=f.lower(body,{"target":pool,"agent":accounts["AGENT"]},timeout=300)
 def sequential():
  expect(starts["started"]==300 and starts["refusedWhileHeld"]==3,"Sequential starts hit a hidden ceiling or the declared single-slot limit leaked: "+json.dumps(starts))
  expect(f.account(accounts["AGENT"])=={"reserved":"0","allocated":"0","configured_limit":"1"},"Sequential starts leaked counters")
  expect(f.sql("SELECT count(*)::int n FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.id=r.capacity_account_id WHERE a.pool_id=$1 AND r.state='RELEASED'",[pool])[0]["n"]==300,"Durable start history differs")
 check("resources.no-fixed-start-ceiling",sequential)
 return {"concurrent":concurrent,"sequential":starts,"sequential_wall_seconds":round(time.monotonic()-t0,3)}

# V-047 component share: seeded workload, independent reference model, reduced scale.
SANDBOXES=100;CPU_PER_SANDBOX=1000;AGENT_LIMIT=106;SESSIONS=300;HORIZON=6*3600
def workload(seed):
 rng=random.Random(seed);events=[]
 for n in range(SESSIONS):
  # A 200-session burst saturates the declared limits; later sessions reuse released capacity.
  if n<200:start=rng.randrange(0,HORIZON//8);life=rng.randrange(HORIZON//4,HORIZON//2)
  else:start=rng.randrange(HORIZON//2,7*HORIZON//8);life=rng.randrange(HORIZON//16,HORIZON//8)
  cpu=rng.choice((250,500,1000,2000))
  sid="s%03d"%n;events.append((start,1,sid,cpu));events.append((start+life,0,sid,cpu))
 events.sort()
 return events
def reference(events):
 """Independent model: a session is admitted iff every declared dimension fits; no hidden caps."""
 agent=cpu=0;live={};outcomes=[];snapshots=[];peak_offered=offered=0
 for t,kind,sid,c in events:
  if kind==0:
   if sid in live:agent-=1;cpu-=live.pop(sid)
   offered-=1
  else:
   offered+=1;peak_offered=max(peak_offered,offered)
   exceeded=sorted(d for d,ok in (("AGENT",agent+1<=AGENT_LIMIT),("CPU_MILLIS",cpu+c<=SANDBOXES*CPU_PER_SANDBOX)) if not ok)
   if exceeded:outcomes.append({"sid":sid,"admitted":False,"exceeded":exceeded})
   else:agent+=1;cpu+=c;live[sid]=c;outcomes.append({"sid":sid,"admitted":True})
  snapshots.append({"AGENT":agent,"CPU_MILLIS":cpu})
 return {"outcomes":outcomes,"snapshots":snapshots,"final":{"AGENT":agent,"CPU_MILLIS":cpu},"admitted":sum(o["admitted"] for o in outcomes),"peak_offered":peak_offered,"peak_agent":max(x["AGENT"] for x in snapshots)}
REPLAY_JS="""const s=data.scope,expires=new Date(Date.now()+86400000).toISOString(),reader=new resources.ResourceScheduler();reader.registerProofReader('runner.quiescence',async()=>proof());
const held={},outcomes=[],snapshots=[];
const counters=async()=>{const rows=(await run(tx=>tx.query('SELECT dimension,(reserved+allocated)::text AS used FROM hyperfide.capacity_accounts WHERE pool_id=$1',[data.target]))).result.rows;return Object.fromEntries(rows.map(r=>[r.dimension,Number(r.used)]));};
for(const [index,[t,kind,sid,cpu]] of data.events.entries()){
 if(kind===0){
  if(held[sid]){const ids=held[sid];delete held[sid];const done=await run(async tx=>{await pending(tx,ids);return reader.release(tx,{...s,reservation_ids:ids});});if(!('result' in done))throw Error('release failed '+JSON.stringify(done));}
 }else{
  const made=await run(tx=>resources.reserveDynamic(tx,{...s,request_id:crypto.randomUUID(),pool_id:data.target,expires_at:expires,dimensions:[{capacity_account_id:data.agent,quantity:'1'},{capacity_account_id:data.cpu,quantity:String(cpu)}]}));
  if('result' in made){held[sid]=made.result.reservations.map(r=>r.id);outcomes.push({sid,admitted:true});}
  else{const limit=(await run(tx=>resources.limitingResource(tx,{...s,pool_id:data.target,dimensions:[{capacity_account_id:data.agent,quantity:'1'},{capacity_account_id:data.cpu,quantity:String(cpu)}]}))).result;outcomes.push({sid,admitted:false,code:made.error.code,message:made.error.message,limiting:limit?.dimension??null});}
 }
 if(index%25===0||index===data.events.length-1)snapshots.push({index,...await counters()});
}
const inventory=(await run(tx=>tx.query("SELECT r.state,count(*)::int AS n FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.id=r.capacity_account_id WHERE a.pool_id=$1 GROUP BY r.state ORDER BY r.state",[data.target]))).result.rows;
return {outcomes,snapshots,final:await counters(),inventory};"""
def replay_section(f,base_seed):
 seeds=[base_seed,base_seed+1,base_seed+2];report={"label":"component replay, not full V-047 / not live","scale":{"sandbox_equivalents":SANDBOXES,"session_lifetimes_per_seed":SESSIONS,"virtual_hours_per_seed":HORIZON/3600,"seeds":seeds},"runs":[]}
 failures=[];observed={}
 for seed in seeds+[base_seed]:
  events=workload(seed);expected=reference(events)
  pool,accounts=f.new_pool({"AGENT":AGENT_LIMIT,"CPU_MILLIS":SANDBOXES*CPU_PER_SANDBOX})
  t0=time.monotonic();out=f.lower(REPLAY_JS,{"events":events,"target":pool,"agent":accounts["AGENT"],"cpu":accounts["CPU_MILLIS"]},timeout=240);wall=time.monotonic()-t0
  run={"seed":seed,"pool_id":pool,"simulated_seconds":HORIZON,"wall_clock_seconds":round(wall,3),"session_lifetimes":SESSIONS,"admitted":expected["admitted"],"peak_offered_sessions":expected["peak_offered"],"peak_admitted_agents":expected["peak_agent"],"inventory":out["inventory"]}
  report["runs"].append(run)
  if [o["admitted"] for o in out["outcomes"]]!=[o["admitted"] for o in expected["outcomes"]]:failures.append((seed,"admission sequence differs from reference"))
  for got,want in zip(out["outcomes"],expected["outcomes"]):
   if not got["admitted"] and (got["code"]!="CAPACITY_LIMIT" or got["limiting"] not in want.get("exceeded",[]) or got["message"]!="Admission is limited by "+got["limiting"]):failures.append((seed,"refusal did not name an exceeded declared limit "+json.dumps(got)));break
  for snap in out["snapshots"]:
   want=expected["snapshots"][snap["index"]]
   if snap["AGENT"]!=want["AGENT"] or snap["CPU_MILLIS"]!=want["CPU_MILLIS"]:failures.append((seed,"limit counters differ at event %d"%snap["index"]));break
  if out["final"]!={"AGENT":0,"CPU_MILLIS":0} or expected["final"]!={"AGENT":0,"CPU_MILLIS":0}:failures.append((seed,"final inventory not empty"))
  if out["inventory"]!=[{"state":"RELEASED","n":2*expected["admitted"]}]:failures.append((seed,"durable reservation effects differ "+json.dumps(out["inventory"])))
  if seed in observed and observed[seed]!=[(o["sid"],o["admitted"]) for o in out["outcomes"]]:failures.append((seed,"replay of the same seed was not deterministic"))
  observed.setdefault(seed,[(o["sid"],o["admitted"]) for o in out["outcomes"]])
  if expected["peak_offered"]<=AGENT_LIMIT or expected["admitted"]==SESSIONS:failures.append((seed,"workload never exercised the declared limits"))
 report["runs"][-1]["determinism_rerun"]=True
 report["simulated_seconds_total"]=sum(r["simulated_seconds"] for r in report["runs"]);report["wall_clock_seconds_total"]=round(sum(r["wall_clock_seconds"] for r in report["runs"]),3)
 report["failures"]=failures
 m.write_json(m.campaign_root()/"scheduler"/"v047-component-replay.json",report)
 print(json.dumps({"type":"replay-report",**{k:report[k] for k in ("label","scale","simulated_seconds_total","wall_clock_seconds_total")}}),flush=True)
 check("resources.v047.component-replay.reference-match",lambda:expect(not failures,"Replay differs from independent reference: "+json.dumps(failures)[:800]))
 check("resources.v047.component-replay.labelled",lambda:expect(report["label"]=="component replay, not full V-047 / not live" and all(r["wall_clock_seconds"]>0 and r["simulated_seconds"]==HORIZON for r in report["runs"]) and len({r["seed"] for r in report["runs"]})==3,"Replay report lacks simulated versus wall-clock time"))

def run_fixture(name,section,*args):
 f=ResourceFixture()
 try:return section(f,*args)
 finally:
  db=f.database;path=f.path;f.close()
  check("resources.cleanup.observed"+name,lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Fixture resource remains"))

def main():
 m.configure_cleanup("5.4")
 seed=int(os.environ.get("HYPERFIDE_RANDOM_SEED","1"))
 run_fixture("",primary_section)
 def second(f):
  fairness_section(f);ceiling_section(f);replay_section(f,seed)
 run_fixture(".second",second)
 return 1 if m.FAILED else 0

def cleanup():
 """Shared 5.1 cleanup omits absence evidence; add it from the observed cleanup artifact (until 5.1 lands)."""
 buffer=io.StringIO()
 with contextlib.redirect_stdout(buffer):code=m.cleanup_owned("5.4")
 events=[json.loads(line) for line in buffer.getvalue().splitlines() if line.startswith("{")]
 event=events[-1] if events else {"type":"cleanup","complete":False,"resources":[{"id":"hf-task-5.4-runtime","status":"unknown"}]}
 artifact=m.campaign_root()/"scheduler"/"cleanup.json"
 try:observations=json.loads(artifact.read_text())
 except (OSError,ValueError):observations={}
 if code==0 and event.get("complete") is True and observations.get("complete") is True and all(o.get("observed_absent") is True for o in observations.get("observations",[])):
  for resource in event["resources"]:
   if resource.get("status")=="deleted":resource.update(observed_absent=True,evidence_artifact="scheduler/cleanup.json")
 else:code=1
 print(json.dumps(event),flush=True)
 return code

if __name__=="__main__":raise SystemExit(cleanup() if "--cleanup" in sys.argv else main())
