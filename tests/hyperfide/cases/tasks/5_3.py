#!/usr/bin/env python3
"""Stable dispatch identity and fail-closed uncertainty through the real service."""
from __future__ import annotations
import concurrent.futures,contextlib,importlib.util,io,json,socket,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("hf_scheduler_fixture",ROOT/"tests/hyperfide/cases/tasks/5_1.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
expect=m.expect;check=m.check;uid=m.uid
def describe_access(f):
 """Let fixture principals read the loaded component registry (system.describe)."""
 config=json.loads(f.identity_config.read_text())
 for principal in config["principals"]:
  if "system.describe" not in principal["allowed_actions"]:principal["allowed_actions"].append("system.describe")
 f.identity_config.write_text(json.dumps(config))
 policy=json.loads(f.policy.read_text());policy["allowed_actions"].append("system.describe");f.policy.write_text(json.dumps(policy))
 f.sql("UPDATE hyperfide.identity_principals SET allowed_actions=array_append(allowed_actions,'system.describe') WHERE NOT 'system.describe'=ANY(allowed_actions)")
def fixture(describe=False,**kwargs):
 def setup(f):
  if describe:describe_access(f)
 return m.SchedulerFixture(extra_setup=setup,**kwargs)
def registered(f):
 declared=json.loads((ROOT/"services/hyperfide/components/5.3.json").read_text())
 described=f.ok("system.describe",{},key="operator",component="system")
 entries=[c for c in described["components"] if c["id"]=="5.3"]
 expect(declared["id"]=="5.3" and len(entries)==1 and sorted(entries[0]["actions"])==sorted(declared["actions"]),"Loaded service does not expose component 5.3 with exactly its declared actions: "+json.dumps(entries))
# Test-owned trusted reader installed on the actual DispatchReconciler inside a branded
# primary transaction. It reports an observation bound to the persisted operation; the
# reconciler still independently checks the command/payload/token tuple and requires a
# COMPLETED central command_inbox receipt. No provider or process is contacted.
RECONCILE_JS="""const {DispatchReconciler}=await import('./services/hyperfide/dist/scheduler/dispatch.js');
const reconciler=new DispatchReconciler(),seen=[];
reconciler.registerReceiptReader(async(_tx,input)=>{seen.push(input.operation_id);
 return data.observation===null?null:{command_id:input.operation_id,token:input.token,payload_digest:input.payload_digest,...data.observation};});
try{if(data.second_reader){try{reconciler.registerReceiptReader(async()=>null);}catch(e){return {second_reader:e.code};}return {second_reader:'INSTALLED'};}
 return {outcome:await reconciler.reconcile(tx,data.scope,data.request_id),seen};}finally{reconciler.close();}"""
def reconcile_probe(f,request_id,observation):return f.primary(RECONCILE_JS,{"request_id":request_id,"observation":observation})
def outcome(response):
 expect("result" in response,"Trusted reconcile failed: "+json.dumps(response));return response["result"]["outcome"]
def refused(response,code):expect(response.get("error",{}).get("code")==code,"Expected "+code+", observed "+json.dumps(response))
def receipt(f,state="COMPLETED"):
 """Central inbox admission of a native runner receipt (production producer is runner 12.x)."""
 ident=uid()
 f.sql("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,'native-runner','runner.dispatch.receipt',$4,$5,$6,$7)",[f.ids["organisation"],f.ids["run"],ident,ident,m.sha(ident.encode()),state,None if state=="PENDING" else json.dumps({"receipt_id":ident})])
 return ident
def dispatch(f,request_id):
 return f.sql("SELECT id,state,state_version::text,observation_receipt_id,native_session_id FROM hyperfide.scheduler_dispatches WHERE request_id=$1",[request_id])[0]
def attempt(f,attempt_id):
 return f.sql("SELECT compute_authority,execution_state FROM hyperfide.attempts WHERE id=$1",[attempt_id])[0]
LOCK_JS="""import fs from 'node:fs';import {createRequire} from 'node:module';
const pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg'),q=JSON.parse(fs.readFileSync(0,'utf8'));
const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
try{await c.query('BEGIN');await c.query('SELECT id FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR NO KEY UPDATE',[q.organisation_id,q.run_id]);
 process.stdout.write('locked\\n');await new Promise(resolve=>setTimeout(resolve,q.hold_ms));await c.query('COMMIT');}finally{await c.end();}"""
def lost_response(f,action,payload,key,component):
 """Hold the run row past the client deadline: the client cannot know whether the server
 committed (the service cancels the request transaction when the client disconnects)."""
 env=dict(f.env,DATABASE_URL=f.url)
 locker=subprocess.Popen(["node","--input-type=module","-e",LOCK_JS],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,cwd=ROOT,env=env)
 locker.stdin.write(json.dumps({"organisation_id":f.ids["organisation"],"run_id":f.ids["run"],"hold_ms":2500}));locker.stdin.close()
 try:
  expect(locker.stdout.readline().strip()=="locked","Run lock was not held")
  try:f.invoke(action,payload,key=key,component=component,timeout_seconds=0.75);lost=False
  except (TimeoutError,socket.timeout):lost=True
 finally:locker.wait(timeout=30)
 expect(locker.returncode==0,"Run lock holder failed")
 return lost
CRASH_JS="""import fs from 'node:fs';
import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';
import {ensureDispatch} from './services/hyperfide/dist/scheduler/dispatch.js';
const data=JSON.parse(fs.readFileSync(0,'utf8'));
const resources=createResourceContainer({role:'control',env:process.env,signal:new AbortController().signal});
await resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:3},tx=>ensureDispatch(tx,data.token,data.request_id,{consumer_ids:[data.native_consumer]}));
process.kill(process.pid,'SIGKILL');"""
def crash_after_commit(f,request):
 """The dispatcher commits, then dies before any response leaves the process."""
 return subprocess.run(["node","--input-type=module","-e",CRASH_JS],input=json.dumps({"token":request["token"],"request_id":request["request_id"],"native_consumer":f.ids["native_consumer"]}),text=True,cwd=ROOT,env=f.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
def wait_rows(f,sql,values,deadline=20):
 end=time.monotonic()+deadline
 while time.monotonic()<end:
  rows=f.sql(sql,values)
  if rows:return rows
  time.sleep(.1)
 return []
def prepare_replacement(f,name,generation):
 """Next admitted attempt generation for the same task on a fresh READY slot; the superseded
 slot stays DRAINING until physical quiescence is reconciled."""
 i=f.ids;slot=uid()
 f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,$4,1,'AGENT','READY')",[i["organisation"],slot,i["sandbox"],"replacement-"+name+"-"+generation])
 request=f.packet_input(task_id=i["task_"+name],slot_id=slot,idempotency_key=uid(),attempt_generation=generation)
 packet=f.ok("hierarchy.packet.create",request,key="manager",component="3.2")
 return {"organisation_id":i["organisation"],"run_id":i["run"],"request_id":uid(),"task_id":request["task_id"],"attempt_id":request["attempt_id"],"attempt_generation":generation,"run_spec_generation":f.spec_generation,"spec_generation":f.spec_generation,"spec_revision_id":i["accepted_spec"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","sandbox_id":i["sandbox"],"slot_id":slot,"sandbox_boot_generation":"1","lease_ms":300000,"input_packet_digest":packet["digest"],"capacity":f.capacity()}
def cleanup():
 """Shared 5.1 cleanup observes DB/role/path/listener absence and writes scheduler/cleanup.json;
 report that observation as explicit absence evidence for the harness."""
 buffer=io.StringIO()
 with contextlib.redirect_stdout(buffer):code=m.cleanup_owned("5.3")
 events=[json.loads(line) for line in buffer.getvalue().splitlines() if line.strip()]
 event=events[-1] if events else {"type":"cleanup","complete":False,"resources":[{"id":"hf-task-5.3-runtime","status":"unknown"}]}
 evidence=m.campaign_root()/"scheduler"/"cleanup.json"
 observed=code==0 and event.get("complete") is True and evidence.is_file() and json.loads(evidence.read_text()).get("complete") is True
 for resource in event.get("resources",[]):
  if resource.get("status")=="deleted":
   if observed:resource.update(observed_absent=True,evidence_artifact="scheduler/cleanup.json")
   else:resource["status"]="unknown"
 if not observed:event["complete"]=False
 print(json.dumps(event),flush=True)
 return 0 if observed else 1
def main():
 m.configure_cleanup("5.3")
 f=fixture();i=f.ids
 try:
  claim=f.claim("a");token=claim["token"];request={"token":token,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  check("dispatch.role.denied",lambda:f.reject("scheduler.dispatch.ensure",request,"ROLE_DENIED",key="watcher",component="5.3"))
  result=f.ok("scheduler.dispatch.ensure",request,key="manager",component="5.3")
  check("dispatch.intent.not-execution",lambda:expect(result["state"]=="INTENT" and result["execution_confirmed"] is False and result["replacement_allowed"] is False,"Intent claimed execution"))
  check("dispatch.exact-physical-identity",lambda:expect(f.sql("SELECT id FROM hyperfide.scheduler_dispatches WHERE request_id=$1",[request["request_id"]])[0]["id"]==result["operation_id"],"Dispatch identity not durable"))
  check("dispatch.outbox-bound",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches d JOIN hyperfide.outbox_events e ON e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id WHERE d.id=$1 AND e.payload->>'command_id'=d.id::text AND e.payload->>'payload_digest'=d.payload_digest",[result["operation_id"]])[0]["n"]==1,"Outbox does not bind exact durable command"))
  f.stop();f.start()
  replay=f.ok("scheduler.dispatch.ensure",request,key="manager",component="5.3")
  check("dispatch.restart.same-command",lambda:expect(replay["operation_id"]==result["operation_id"] and replay["replayed"] is True,"Restart generated another physical dispatch"))
  check("dispatch.new-key.no-replacement",lambda:f.reject("scheduler.dispatch.ensure",dict(request,request_id=uid()),"REPLACEMENT_REQUIRES_NEW_ATTEMPT",key="manager",component="5.3"))
  check("dispatch.replay.token-conflict",lambda:f.reject("scheduler.dispatch.ensure",dict(request,token=dict(token,attempt_generation="2")),"IDEMPOTENCY_CONFLICT",key="manager",component="5.3"))
  reconcile={"organisation_id":i["organisation"],"run_id":i["run"],"request_id":request["request_id"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","package_id":i["package"]}
  check("dispatch.no-forged-receipt",lambda:f.reject("scheduler.dispatch.reconcile",dict(reconcile,receipt={"state":"EXECUTING"}),"INVALID_REQUEST",key="manager",component="5.3"))
  other=f.claim("b");other_request={"token":other["token"],"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  f.ok("scheduler.dispatch.ensure",other_request,key="manager2",component="5.3")
  check("dispatch.reconcile.package-spoof-denied",lambda:f.reject("scheduler.dispatch.reconcile",dict(reconcile,request_id=other_request["request_id"]),"PACKAGE_SCOPE_DENIED",key="manager",component="5.3"))
  check("dispatch.reconcile.target-owner-required",lambda:f.reject("scheduler.dispatch.reconcile",dict(reconcile,request_id=other_request["request_id"],package_id=i["wave_package"]),"PACKAGE_OWNER_MISMATCH",key="manager",component="5.3"))
  unbound=f.primary("const {DispatchReconciler}=await import('./services/hyperfide/dist/scheduler/dispatch.js');return new DispatchReconciler().reconcile(tx,data.scope,data.request_id);",{"request_id":request["request_id"]})
  check("dispatch.unbound-reader.refusal",lambda:refused(unbound,"DEPENDENCY_UNAVAILABLE"))
  check("dispatch.native-reader.missing-is-unknown",lambda:expect(f.ok("scheduler.dispatch.reconcile",reconcile,key="manager",component="5.3")["state"]=="UNKNOWN","Missing native receipt must remain uncertain"))
  check("dispatch.unknown.keeps-owner",lambda:expect(f.sql("SELECT compute_authority,execution_state FROM hyperfide.attempts WHERE id=$1",[token["attempt_id"]])[0]=={"compute_authority":"CURRENT","execution_state":"RESERVED"},"Missing external receipt changed execution authority"))
  check("dispatch.no-native-proof.no-release",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.reservations WHERE state='RELEASED'")[0]["n"]==0,"Unconfirmed dispatch freed resources"))
  def race():
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:f.invoke("scheduler.dispatch.ensure",request,key="manager",component="5.3")[1],range(2)))
   expect(all(r.get("ok") and r["result"]["operation_id"]==result["operation_id"] for r in responses),"Concurrent retries changed command identity")
   expect(f.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches WHERE attempt_id=$1",[token["attempt_id"]])[0]["n"]==1,"Retry created duplicate physical intent")
  check("dispatch.concurrent.one-command",race)
  f.add_principal("controller","COORDINATOR")
  check("dispatch.consumer.role-required",lambda:f.reject("scheduler.dispatch.consume",{},"ROLE_DENIED",key="manager",component="5.3"))
  consumed=f.ok("scheduler.dispatch.consume",{"limit":2},key="controller",component="5.3")
  check("dispatch.consumer.actual-inbox-effect",lambda:expect(consumed["processed"]==2 and all(r["status"]=="APPLIED" and r["inbox_id"] for r in consumed["results"]),"Committed claims were not processed by actual durable inbox"))
  check("dispatch.consumer.stable-existing-intent",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches")[0]["n"]==2,"Consumer duplicated an already stable physical command"))
  check("dispatch.consumer.receipt-before-ack",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.event_deliveries d JOIN hyperfide.outbox_events e ON e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id JOIN hyperfide.command_inbox i ON i.organisation_id=d.organisation_id AND i.run_id=d.run_id AND i.principal_scope=d.consumer_id::text AND i.idempotency_key=d.event_id::text AND i.operation='event.receive' AND i.state='COMPLETED' WHERE d.state='ACKNOWLEDGED' AND e.event_type='scheduler.dispatch.requested'")[0]["n"]==2,"ACK lacks actual committed effect receipt"))
  check("dispatch.consumer.native-route-distinct",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.event_deliveries d JOIN hyperfide.outbox_events e ON e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id WHERE d.consumer_id=$1 AND e.event_type='runner.spawn.requested' AND d.state='PENDING'",[i["native_consumer"]])[0]["n"]==2,"Native commands share claim-consumer route or were falsely acknowledged"))
  check("dispatch.consumer.restart-no-repeat",lambda:expect(f.ok("scheduler.dispatch.consume",{"limit":2},key="controller",component="5.3")["processed"]==0,"ACKed claims were reexecuted"))
  native_id=f.sql("SELECT native_sandbox_id FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["sandbox"]])[0]["native_sandbox_id"]
  f.ok("identity.binding.observe",{"provisioning_intent_id":i["intent"],"sandbox_id":i["sandbox"],"boot_generation":"1","boot_id":i["boot"],"native_sandbox_id":native_id,"observation_digest":m.sha(b"component-fixture-provider"),"expected_version":"1"},key="provisioner",component="14.1")
  expect(f.issue(actions=f.actions)[1].get("ok") is True,"Runner grant issue failed")
  enrolled=f.request(f.enrollment(),key="runner",endpoint="/v1/enroll",credential=f.grant)[1]
  expect(enrolled.get("ok") is True,"Runner enrollment failed: "+json.dumps(enrolled))
  i["runner"]=enrolled["result"]["credential_id"]
  scope={"organisation_id":i["organisation"],"run_id":i["run"]}
  f.ok("instructions.consumer.register",dict(scope,consumer_id=uid()),key="runner",component="6.3")
  start=dict(scope,id=result["operation_id"],attempt_id=token["attempt_id"],attempt_generation=token["attempt_generation"],authority_epoch=token["authority_epoch"],sandbox_boot_generation=token["sandbox_boot_generation"],kind="START",body={"launch_id":uid(),"slot_id":token["slot_id"],"agent_session_id":uid(),"connector_plan_digest":m.sha(b"component-fixture-plan")})
  f.ok("instructions.issue",start,key="operator",component="6.3")
  packet=f.ok("instructions.runner.poll",dict(scope,limit=1,lease_ms=1000),key="runner",component="6.3")["commands"][0]["packet"]
  report={k:packet[k] for k in ("organisation_id","run_id","command_id","operation_id","attempt_id","attempt_generation","authority_epoch","sandbox_id","boot_id","sandbox_boot_generation","sequence","payload_digest")}
  report.update(ledger_receipt_id=uid(),ledger_version="1",state="ACCEPTED",observed_process=None)
  f.ok("instructions.ack",report,key="runner",component="6.3")
  check("dispatch.native-reader.accepted-is-unknown",lambda:expect(f.ok("scheduler.dispatch.reconcile",reconcile,key="manager",component="5.3")["state"]=="UNKNOWN","Accepted intent claimed execution"))
  # Component-fixture process observation exercises signed receipt integration;
  # live native execution is qualified separately by the native runner cases.
  report.update(ledger_version="2",state="EXECUTING",observed_process={"os_boot_id":uid(),"pid":123,"start_time":"1","pgid":123})
  f.ok("instructions.ack",report,key="runner",component="6.3")
  f.stop();f.start()
  def integrated_running():
   observed=f.ok("scheduler.dispatch.reconcile",reconcile,key="manager",component="5.3")
   expect(observed["state"]=="RUNNING" and observed["authoritative"] is True,"Registered receipt reader did not reconcile the admitted native observation")
   expect(attempt(f,token["attempt_id"])["execution_state"]=="RUNNING","Native observation did not advance execution")
  check("dispatch.native-reader.signed-executing-after-restart",integrated_running)
  report.update(ledger_version="3",state="TERMINAL",observed_process=None)
  f.ok("instructions.ack",report,key="runner",component="6.3")
  check("dispatch.native-reader.terminal-without-kind-is-unknown",lambda:expect(f.ok("scheduler.dispatch.reconcile",reconcile,key="manager",component="5.3")["state"]=="UNKNOWN","Terminal acknowledgement invented an outcome kind"))
 finally:
  db=f.database;path=f.path;f.close();check("dispatch.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Fixture resource remains"))
 q=fixture()
 try:
  token=q.claim("a")["token"];q.add_principal("controller","COORDINATOR")
  hold=q.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'ATTEMPT',scope_id:data.token.attempt_id,mode:'PAUSE',operation_id:crypto.randomUUID(),reason:'Restore preparation must precede queued START'});",{"token":token})
  check("dispatch.consumer.pause-denied",lambda:q.reject("scheduler.dispatch.consume",{},"EXECUTION_HELD",key="controller",component="5.3"))
  check("dispatch.consumer.pause-rollback",lambda:expect(q.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches")[0]["n"]==0 and q.sql("SELECT state FROM hyperfide.event_deliveries WHERE consumer_id=$1",[q.ids["dispatch_consumer"]])[0]["state"]=="PENDING","Held event leaked effect or terminal ACK"))
  resumed=q.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'ATTEMPT',scope_id:data.token.attempt_id,mode:'ACTIVE',operation_id:crypto.randomUUID(),reason:'Lower API CAS test only',resume:true,expected_generation:data.generation});",{"token":token,"generation":hold["result"]["generation"]})
  expect("result" in resumed,"Exact resume CAS failed")
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:replies=list(pool.map(lambda _:q.invoke("scheduler.dispatch.consume",{"limit":4},key="controller",component="5.3")[1],range(2)))
  effects=[reply["result"] for reply in replies if reply.get("ok") and reply["result"]["processed"]]
  def concurrent_consumers():
   expect(all(reply.get("ok") or reply.get("error",{}).get("code") in ("SERIALIZATION_FAILURE","TRANSACTION_CONFLICT","RETRY_EXHAUSTED") for reply in replies),"Concurrent consumer failed unexpectedly: "+json.dumps(replies))
   expect(sum(effect["processed"] for effect in effects)==1 and q.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches")[0]["n"]==1 and q.sql("SELECT count(*)::int n FROM hyperfide.outbox_events WHERE event_type='runner.spawn.requested'")[0]["n"]==1,"Concurrent consumers duplicated or lost the dispatch intent")
  check("dispatch.consumer.concurrent-single-intent",concurrent_consumers)
  check("dispatch.consumer.actual-fresh-intent",lambda:expect(len(effects)==1 and effects[0]["results"][0]["result"]["effect"]=="DURABLE_DISPATCH_INTENT" and q.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches")[0]["n"]==1,"Released event did not create exactly one real dispatch intent"))
 finally:
  db=q.database;path=q.path;q.close();check("dispatch.consumer.cleanup.observed",lambda:expect(not path.exists() and q.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Consumer fixture remains"))
 r=fixture(describe=True,agent_limit=3);ri=r.ids
 try:
  check("dispatch.component.registered-entrypoint",lambda:registered(r))
  # do_2: responses lost across crash/timeout windows; a retry of the same request is the same command.
  b=r.claim("b");lost_request={"token":b["token"],"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  crashed=crash_after_commit(r,lost_request)
  def crash_retry():
   expect(crashed.returncode==-9 and crashed.stdout=="","Dispatcher did not die before responding: "+crashed.stderr[:500])
   rows=r.sql("SELECT id FROM hyperfide.scheduler_dispatches WHERE request_id=$1",[lost_request["request_id"]])
   expect(len(rows)==1,"Crashed dispatcher did not durably commit")
   retry=r.ok("scheduler.dispatch.ensure",lost_request,key="manager2",component="5.3")
   expect(retry["operation_id"]==rows[0]["id"] and retry["replayed"] is True,"Retry after lost response minted another command")
  check("dispatch.lost-response.crash-after-commit",crash_retry)
  lost=lost_response(r,"scheduler.dispatch.ensure",lost_request,"manager2","5.3")
  def timeout_retry():
   expect(lost,"Client received a response; timeout window not exercised")
   retry=r.ok("scheduler.dispatch.ensure",lost_request,key="manager2",component="5.3")
   expect(retry["operation_id"]==dispatch(r,lost_request["request_id"])["id"] and retry["replayed"] is True,"Retry after client timeout changed command identity")
   expect(r.sql("SELECT count(*)::int n FROM hyperfide.outbox_events WHERE event_type='runner.spawn.requested' AND aggregate_id=$1",[retry["operation_id"]])[0]["n"]==1 and r.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches WHERE attempt_id=$1",[b["token"]["attempt_id"]])[0]["n"]==1,"Lost responses duplicated spawn intent")
  check("dispatch.lost-response.client-timeout-retry",timeout_retry)
  first=r.claim("a",lease_ms=4000);old=first["token"]
  old_request={"token":old,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  d1=r.ok("scheduler.dispatch.ensure",old_request,key="manager",component="5.3")
  while r.sql("SELECT lease_expires_at>clock_timestamp() AS live FROM hyperfide.attempts WHERE id=$1",[old["attempt_id"]])[0]["live"]:time.sleep(.05)
  expired=r.ok("scheduler.compute.expire",{"organisation_id":ri["organisation"],"run_id":ri["run"],"authority_epoch":ri["epoch"],"leader_generation":"1"},component="5.2")
  check("dispatch.superseded.intent-unreconciled",lambda:expect(expired["expired_attempt_ids"]==[old["attempt_id"]] and dispatch(r,old_request["request_id"])["state"]=="INTENT","Expiry did not leave an unreconciled superseded dispatch"))
  new=r.claim("a",request=prepare_replacement(r,"a","2"))["token"]
  new_request={"token":new,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  check("dispatch.replacement.claim-is-not-dispatch",lambda:expect(new["attempt_generation"]=="2" and r.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches WHERE attempt_id=$1",[new["attempt_id"]])[0]["n"]==0,"Replacement claim fabricated a dispatch"))
  check("dispatch.replacement.requires-reconciliation",lambda:r.reject("scheduler.dispatch.ensure",new_request,"RECONCILIATION_REQUIRED",key="manager",component="5.3"))
  r.add_principal("controller","COORDINATOR")
  def consumer_waits():
   r.reject("scheduler.dispatch.consume",{"limit":64},"RECONCILIATION_REQUIRED",key="controller",component="5.3")
   expect(r.sql("SELECT count(*)::int n FROM hyperfide.scheduler_dispatches WHERE attempt_id=$1",[new["attempt_id"]])[0]["n"]==0 and r.sql("SELECT count(*)::int n FROM hyperfide.event_deliveries WHERE consumer_id=$1 AND state='ACKNOWLEDGED'",[ri["dispatch_consumer"]])[0]["n"]==0,"Consumer dispatched or acknowledged a replacement before reconciliation")
  check("dispatch.replacement.consumer-waits",consumer_waits)
  uncertain=reconcile_probe(r,old_request["request_id"],{"state":"UNCERTAIN","central_receipt_id":uid()})
  check("dispatch.reconcile.uncertain-unknown",lambda:expect(outcome(uncertain)=={"operation_id":d1["operation_id"],"state":"UNKNOWN","reconciliation_required":True,"replacement_allowed":False} and uncertain["result"]["seen"]==[d1["operation_id"]] and dispatch(r,old_request["request_id"])["state"]=="UNKNOWN" and attempt(r,old["attempt_id"])=={"compute_authority":"EXPIRED","execution_state":"FAILED"},"Uncertain outcome was not recorded as UNKNOWN without replacement"))
  check("dispatch.reconcile.null-observation-unknown",lambda:expect(outcome(reconcile_probe(r,old_request["request_id"],None))["state"]=="UNKNOWN","Missing receipt was not treated as uncertain"))
  consumed=r.ok("scheduler.dispatch.consume",{"limit":64},key="controller",component="5.3")
  replacement=r.sql("SELECT id,request_id,state FROM hyperfide.scheduler_dispatches WHERE attempt_id=$1",[new["attempt_id"]])
  check("dispatch.replacement.after-reconciliation",lambda:expect(len(replacement)==1 and replacement[0]["state"]=="INTENT" and any(item["status"]=="APPLIED" and item["result"]["effect"]=="DURABLE_DISPATCH_INTENT" and item["result"]["dispatch"]["operation_id"]==replacement[0]["id"] for item in consumed["results"]),"Reconciled superseded outcome did not admit exactly one replacement intent"))
  new_request["request_id"]=replacement[0]["request_id"] if replacement else new_request["request_id"]
  check("dispatch.replacement.ensure-replays",lambda:expect(r.ok("scheduler.dispatch.ensure",new_request,key="manager",component="5.3")["operation_id"]==replacement[0]["id"],"Replacement ensure minted another command"))
  stale=reconcile_probe(r,old_request["request_id"],{"state":"EXECUTING","central_receipt_id":receipt(r),"native_session_id":"old-worker"})
  check("dispatch.reconcile.superseded-executing-no-authority",lambda:expect(outcome(stale)["state"]=="RUNNING" and outcome(stale)["authoritative"] is False and outcome(stale)["reconciliation_required"] is True and attempt(r,old["attempt_id"])=={"compute_authority":"EXPIRED","execution_state":"FAILED"} and r.sql("SELECT current_attempt_id,state FROM hyperfide.tasks WHERE id=$1",[old["task_id"]])[0]=={"current_attempt_id":new["attempt_id"],"state":"RESERVED"},"Delayed superseded worker gained authority"))
  check("dispatch.superseded.renew-refused",lambda:expect("error" in r.primary("return leases.renewCompute(tx,data.token,300000);",{"token":old}) and attempt(r,old["attempt_id"])["compute_authority"]=="EXPIRED","Superseded worker renewed its lease"))
  live=reconcile_probe(r,new_request["request_id"],{"state":"EXECUTING","central_receipt_id":receipt(r),"native_session_id":"new-worker"})
  check("dispatch.reconcile.current-executing-authoritative",lambda:expect(outcome(live)["state"]=="RUNNING" and outcome(live)["authoritative"] is True and outcome(live)["reconciliation_required"] is False and attempt(r,new["attempt_id"])=={"compute_authority":"CURRENT","execution_state":"RUNNING"} and r.sql("SELECT state FROM hyperfide.tasks WHERE id=$1",[new["task_id"]])[0]["state"]=="RUNNING","Current generation did not reach authoritative RUNNING"))
  late=reconcile_probe(r,old_request["request_id"],{"state":"EXECUTING","central_receipt_id":receipt(r),"native_session_id":"old-worker"})
  def single_authority():
   expect(outcome(late)["authoritative"] is False,"Late superseded report gained authority after the current generation")
   rows=r.sql("SELECT id,compute_authority,execution_state FROM hyperfide.attempts WHERE task_id=$1 AND (compute_authority='CURRENT' OR execution_state='RUNNING')",[new["task_id"]])
   expect(rows==[{"id":new["attempt_id"],"compute_authority":"CURRENT","execution_state":"RUNNING"}],"Duplicate physical execution produced more than one accepted authority")
  check("dispatch.duplicate-execution.single-authority",single_authority)
  before=dispatch(r,new_request["request_id"])
  def mismatches():
   for override in ({"command_id":uid()},{"payload_digest":m.sha(b"forged-payload")},{"token":dict(new,slot_id=uid())},{"token":old}):
    refused(reconcile_probe(r,new_request["request_id"],dict({"state":"EXECUTING","central_receipt_id":receipt(r)},**override)),"NATIVE_RECEIPT_MISMATCH")
   expect(dispatch(r,new_request["request_id"])==before,"Mismatched receipt changed dispatch state")
  check("dispatch.reconcile.receipt-mismatch",mismatches)
  def unadmitted():
   refused(reconcile_probe(r,new_request["request_id"],{"state":"EXECUTING","central_receipt_id":uid()}),"NATIVE_RECEIPT_UNADMITTED")
   refused(reconcile_probe(r,new_request["request_id"],{"state":"TERMINAL","terminal_kind":"STOPPED","central_receipt_id":receipt(r,"PENDING")}),"NATIVE_RECEIPT_UNADMITTED")
   expect(dispatch(r,new_request["request_id"])==before,"Unadmitted receipt changed dispatch state")
  check("dispatch.reconcile.receipt-unadmitted",unadmitted)
  check("dispatch.reconcile.terminal-kind-required",lambda:refused(reconcile_probe(r,new_request["request_id"],{"state":"TERMINAL","central_receipt_id":receipt(r)}),"NATIVE_RECEIPT_INCOMPLETE"))
  check("dispatch.reconcile.single-reader",lambda:expect(r.primary(RECONCILE_JS,{"request_id":new_request["request_id"],"observation":None,"second_reader":True}).get("result")=={"second_reader":"INVALID_RECEIPT_READER"},"A second receipt reader was installed"))
  absent_receipt=receipt(r);absent=reconcile_probe(r,old_request["request_id"],{"state":"TERMINAL","terminal_kind":"ABSENT","central_receipt_id":absent_receipt})
  stopped=reconcile_probe(r,lost_request["request_id"],{"state":"TERMINAL","terminal_kind":"STOPPED","central_receipt_id":receipt(r)})
  check("dispatch.reconcile.terminal-states",lambda:expect(outcome(absent)["state"]=="ABSENT" and outcome(stopped)["state"]=="STOPPED" and not outcome(absent)["authoritative"] and outcome(absent)["resource_release_confirmed"] is False and dispatch(r,old_request["request_id"])["observation_receipt_id"]==absent_receipt and dispatch(r,lost_request["request_id"])["state"]=="STOPPED","Terminal observations did not reach exact terminal states"))
  replay=reconcile_probe(r,old_request["request_id"],{"state":"EXECUTING","central_receipt_id":receipt(r)})
  check("dispatch.reconcile.terminal-replay",lambda:expect(outcome(replay)=={"operation_id":d1["operation_id"],"state":"ABSENT","replayed":True,"replacement_allowed":False,"resource_release_confirmed":False} and replay["result"]["seen"]==[],"Terminal dispatch was reopened by a later report"))
  check("dispatch.reconcile.terminal-no-release",lambda:expect(r.sql("SELECT count(*)::int n FROM hyperfide.reservations WHERE state='RELEASED'")[0]["n"]==0 and r.sql("SELECT count(*)::int n FROM hyperfide.sandbox_execution_charges WHERE state='RELEASED'")[0]["n"]==0 and attempt(r,b["token"]["attempt_id"])["compute_authority"]=="CURRENT","Native terminal observation released capacity or authority"))
 finally:
  db=r.database;path=r.path;r.close();check("dispatch.reconcile.cleanup.observed",lambda:expect(not path.exists() and r.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Reconcile fixture remains"))
 return 1 if m.FAILED else 0
if __name__=="__main__":raise SystemExit(cleanup() if "--cleanup" in sys.argv else main())
