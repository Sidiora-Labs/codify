#!/usr/bin/env python3
"""Primary-clock expiry and cancellation through actual authenticated scheduler."""
from __future__ import annotations
import concurrent.futures,contextlib,importlib.util,io,json,sys,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("hf_scheduler_fixture",ROOT/"tests/hyperfide/cases/tasks/5_1.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
expect=m.expect;check=m.check;uid=m.uid
SchedulerFixture=m.SchedulerFixture
FRAGMENT=json.loads((ROOT/"services/hyperfide/components/5.2.json").read_text())
SPARE_SLOTS=12
def lease_setup(f):
 # Registry proof (as 15.2/19.1): the reserved system.describe action is granted to fixture principals only.
 config=json.loads(f.identity_config.read_text())
 for principal in config["principals"]:
  if "system.describe" not in principal["allowed_actions"]:principal["allowed_actions"].append("system.describe")
 f.identity_config.write_text(json.dumps(config))
 policy=json.loads(f.policy.read_text());policy["allowed_actions"].append("system.describe");f.policy.write_text(json.dumps(policy))
 f.actions.append("system.describe")
 f.sql("UPDATE hyperfide.identity_principals SET allowed_actions=array_append(allowed_actions,'system.describe') WHERE NOT ('system.describe'=ANY(allowed_actions))")
 # Trusted fixed test envelope large enough for retained expired generations plus reassignments.
 for dimension,limit in (("AGENT","16"),("CPU_MILLIS","64000"),("MEMORY_BYTES","137438953472"),("DISK_BYTES","274877906944")):
  f.sql("UPDATE hyperfide.capacity_accounts SET configured_limit=$2,state_version=state_version+1 WHERE id=$1",[f.accounts[dimension],limit])
 f.spare_slots=[]
 for n in range(SPARE_SLOTS):
  slot=uid();f.spare_slots.append(slot)
  f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,$4,1,'AGENT','READY')",[f.ids["organisation"],slot,f.ids["sandbox"],"spare-"+str(n)])
def lease_fixture():
 return SchedulerFixture(extra_setup=lease_setup,agent_limit=16,sandbox_cpu_limit=64000)
def reclaim(f,name,generation,lease_ms=300000):
 """Reassign the task: a fresh packet and claim for generation N+1 on a fresh slot."""
 slot=f.spare_slots.pop(0);i=f.ids;key="manager2" if name=="b" else "manager"
 request=f.packet_input(task_id=i["task_"+name],slot_id=slot,idempotency_key=uid(),attempt_generation=str(generation))
 packet=f.ok("hierarchy.packet.create",request,key=key,component="3.2")
 claim={"organisation_id":i["organisation"],"run_id":i["run"],"request_id":uid(),"task_id":request["task_id"],"attempt_id":request["attempt_id"],"attempt_generation":request["attempt_generation"],"run_spec_generation":f.spec_generation,"spec_generation":f.spec_generation,"spec_revision_id":i["accepted_spec"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","sandbox_id":i["sandbox"],"slot_id":slot,"sandbox_boot_generation":"1","lease_ms":lease_ms,"input_packet_digest":packet["digest"],"capacity":f.capacity()}
 return claim
def bootstrap_runner(f):
 """identity_fixture bootstrap_runner against the packet sandbox's actual provider identity and version."""
 i=f.ids;sandbox=f.sql("SELECT native_sandbox_id,state_version::text v FROM hyperfide.sandboxes WHERE id=$1",[i["sandbox"]])[0]
 bound=f.invoke("identity.binding.observe",{"provisioning_intent_id":i["intent"],"sandbox_id":i["sandbox"],"boot_generation":"1","boot_id":i["boot"],"native_sandbox_id":sandbox["native_sandbox_id"],"observation_digest":m.sha(b"provider-observation"),"expected_version":sandbox["v"]},key="provisioner")[1]
 expect(bound.get("ok") is True,"Trusted provider binding failed: "+json.dumps(bound))
 issued=f.issue(actions=f.actions)[1];expect(issued.get("ok") is True,"Runner grant issue failed: "+json.dumps(issued))
 enrolled=f.request(f.enrollment(),key="runner",endpoint="/v1/enroll",credential=f.grant)[1]
 expect(enrolled.get("ok") is True,"Actual runner enrollment failed: "+json.dumps(enrolled));i["runner"]=enrolled["result"]["credential_id"]
def try_reclaim(f,name,generation):
 """Reassignment as one observable outcome: packet admission, then the claim."""
 slot=f.spare_slots[0];i=f.ids;key="manager2" if name=="b" else "manager"
 request=f.packet_input(task_id=i["task_"+name],slot_id=slot,idempotency_key=uid(),attempt_generation=str(generation))
 packet=f.invoke("hierarchy.packet.create",request,key=key,component="3.2")[1]
 if packet.get("ok") is not True:return packet
 f.spare_slots.pop(0)
 claim={"organisation_id":i["organisation"],"run_id":i["run"],"request_id":uid(),"task_id":request["task_id"],"attempt_id":request["attempt_id"],"attempt_generation":request["attempt_generation"],"run_spec_generation":f.spec_generation,"spec_generation":f.spec_generation,"spec_revision_id":i["accepted_spec"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","sandbox_id":i["sandbox"],"slot_id":slot,"sandbox_boot_generation":"1","lease_ms":300000,"input_packet_digest":packet["result"]["digest"],"capacity":f.capacity()}
 return f.invoke("scheduler.claim",claim,key=key,component="5.1")[1]
def delegate_worker(f,token,name):
 """Actual runner delegation of a WORKER principal bound to the attempt, slot and boot."""
 i=f.ids;session=uid()
 f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id,state) VALUES($1,$2,$3,'WORKER',$4,'fixture','fixture',$5,$6,$7,$8,$9,'RUNNING')",[i["organisation"],i["run"],session,i["manager"],"worker-"+name,token["slot_id"],token["sandbox_id"],token["sandbox_boot_generation"],token["attempt_id"]])
 if not getattr(f,"runner_ready",False):bootstrap_runner(f);f.runner_ready=True
 f.delegate_principal(name,session);return session
def renew(f,key,token,lease_ms=1000,**kwargs):
 return f.invoke("scheduler.lease.renew",{"token":token,"lease_ms":lease_ms},key=key,component="5.2",**kwargs)[1]
def expire(f):
 i=f.ids;return f.invoke("scheduler.compute.expire",{"organisation_id":i["organisation"],"run_id":i["run"],"authority_epoch":i["epoch"],"leader_generation":"1"},key="leader",component="5.2")[1]
def code(response):return response.get("error",{}).get("code")
def primary_now(f):return f.sql("SELECT clock_timestamp()::text AS now")[0]["now"]
def from_primary(f,expires,before,after,ms):
 return f.sql("SELECT $1::timestamptz BETWEEN $2::timestamptz+$4::integer*interval '1 millisecond' AND $3::timestamptz+$4::integer*interval '1 millisecond' AS ok",[expires,before,after,ms])[0]["ok"]
def attempt_state(f,attempt):
 return f.sql("SELECT a.compute_authority,(SELECT string_agg(l.state,',') FROM hyperfide.compute_leases l WHERE l.attempt_id=a.id) AS leases,a.lease_expires_at::text AS expires FROM hyperfide.attempts a WHERE a.id=$1",[attempt])[0]
def current_generations(f,task):
 return f.sql("SELECT (SELECT count(*)::int FROM hyperfide.attempts WHERE task_id=$1 AND compute_authority='CURRENT') AS current,(SELECT count(*)::int FROM hyperfide.compute_leases l JOIN hyperfide.attempts a ON a.id=l.attempt_id WHERE a.task_id=$1 AND l.state='ACTIVE') AS leases,(SELECT count(*)::int FROM hyperfide.submission_custodies WHERE task_id=$1 AND authority='ACTIVE') AS custody",[task])[0]
def wait_past(f,expires,margin_ms=50):
 while f.sql("SELECT $1::timestamptz+$2::integer*interval '1 millisecond'>clock_timestamp() AS live",[expires,margin_ms])[0]["live"]:time.sleep(.05)
def concurrently(*calls):
 barrier=threading.Barrier(len(calls))
 def run(call):
  barrier.wait()
  try:return call()
  except Exception as error:return {"exception":type(error).__name__+": "+str(error)}
 with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls)) as executor:return list(executor.map(run,calls))
def admit_custody(f,token):
 """Trusted coordinator custody admission fixture (16.1 submission is pending): COMPLETE manifests, then ACTIVE custody."""
 i=f.ids;digests=[m.sha(("custody-"+name+token["attempt_id"]).encode()) for name in ("source","evidence")]
 for d in digests:f.sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,digest,size_bytes,storage_backend,storage_key,status,completed_at) VALUES($1,$2,$3,1,'fixture',$4,'COMPLETE',clock_timestamp()) ON CONFLICT DO NOTHING",[i["organisation"],i["run"],d,"custody/"+d])
 criteria=f.sql("SELECT criteria_digest FROM hyperfide.tasks WHERE id=$1",[token["task_id"]])[0]["criteria_digest"]
 custody=f.sql("INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11) RETURNING id::text",[i["organisation"],i["run"],token["task_id"],token["attempt_id"],token["attempt_generation"],i["epoch"],i["repository"],"a"*40,digests[0],digests[1],criteria])[0]["id"]
 # As 16.1 submit: the task now names its coordinator-owned custody.
 f.sql("UPDATE hyperfide.tasks SET current_custody_id=$2,state='SUBMITTED',state_version=state_version+1 WHERE id=$1",[token["task_id"],custody]);return custody
def revoke_custody(f,custody):
 """Explicit coordinator revocation; serialization failures are retried, deadlocks are not."""
 for _ in range(20):
  # One transaction: explicit coordinator reassignment revokes custody and disposes the task for a new
  # attempt (16.1's plain revoke leaves STALE, which requires separate revalidation before replanning).
  try:return f.sql("WITH c AS (UPDATE hyperfide.submission_custodies SET authority='REVOKED',state_version=state_version+1 WHERE id=$1 AND authority='ACTIVE' RETURNING organisation_id,run_id,id,task_id) UPDATE hyperfide.tasks t SET current_custody_id=NULL,state='READY',state_version=t.state_version+1 FROM c WHERE t.organisation_id=c.organisation_id AND t.run_id=c.run_id AND t.id=c.task_id AND t.current_custody_id=c.id RETURNING c.id::text",[custody])
  except AssertionError as error:
   if '"40001"' not in str(error):raise
   time.sleep(.05)
 raise AssertionError("Custody revocation never serialized")
def generations():
 f=lease_fixture();i=f.ids
 try:
  def registered():
   result=f.ok("system.describe",{},key="operator",component="system")
   entries=[c for c in result["components"] if c["id"]=="5.2"]
   expect(len(entries)==1 and entries[0]["actions"]==FRAGMENT["actions"],"Component 5.2 is not loaded with exactly its declared actions: "+json.dumps(entries))
  check("lease.component.registered",registered)
  first=f.claim("a");old=first["token"];delegate_worker(f,old,"worker1")
  other=f.claim("b")["token"]
  check("lease.generation.initial",lambda:expect(old["attempt_generation"]=="1" and attempt_state(f,old["attempt_id"])["compute_authority"]=="CURRENT","Initial claim did not issue generation 1"))
  def worker_renews():
   before=primary_now(f);response=renew(f,"worker1",old,300000);after=primary_now(f)
   expect(response.get("ok") is True,"Bound WORKER renewal refused: "+json.dumps(response))
   expires=response["result"]["lease_expires_at"]
   expect(from_primary(f,expires,before,after,300000) and attempt_state(f,old["attempt_id"])["expires"]==expires,"Renewed expiry is not derived from the primary clock")
  check("lease.renew.worker-principal",worker_renews)
  check("lease.renew.foreign-worker-denied",lambda:expect(code(renew(f,"worker1",other,300000)) in ("ACTOR_DENIED","AUTH_STALE_ATTEMPT"),"Worker renewed another attempt"))
  baseline=attempt_state(f,old["attempt_id"])
  invalid=(("missing-token",{"lease_ms":1000}),("missing-lease",{"token":old}),
   ("missing-generation",{"token":{k:v for k,v in old.items() if k!="attempt_generation"},"lease_ms":1000}),
   ("malformed-generation",{"token":dict(old,attempt_generation="one"),"lease_ms":1000}),
   ("malformed-attempt",{"token":dict(old,attempt_id="not-a-uuid"),"lease_ms":1000}),
   ("lease-below-range",{"token":old,"lease_ms":999}),("lease-above-range",{"token":old,"lease_ms":300001}),
   ("lease-string",{"token":old,"lease_ms":"1000"}),("lease-fraction",{"token":old,"lease_ms":1000.5}),
   ("client-expiry-field",{"token":old,"lease_ms":1000,"expires_at":"2999-01-01T00:00:00Z"}),
   ("client-token-clock",{"token":dict(old,lease_expires_at="2999-01-01T00:00:00Z"),"lease_ms":1000}))
  def refuses_invalid():
   observed={name:code(f.invoke("scheduler.lease.renew",payload,key="worker1",component="5.2")[1]) for name,payload in invalid}
   expect(all(v=="INVALID_REQUEST" for v in observed.values()),"Invalid renewal not refused: "+json.dumps(observed))
   expect(attempt_state(f,old["attempt_id"])==baseline,"Refused renewal changed the lease")
  check("lease.renew.invalid-authority-refused",refuses_invalid)
  scope={"organisation_id":i["organisation"],"run_id":i["run"],"authority_epoch":i["epoch"],"leader_generation":"1"}
  def strict_clock_inputs():
   cancel={"token":old,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
   observed=[code(f.invoke("scheduler.compute.cancel",dict(cancel,now="2999-01-01T00:00:00Z"),key="manager",component="5.2")[1]),
    code(f.invoke("scheduler.compute.cancel",{k:v for k,v in cancel.items() if k!="token"},key="manager",component="5.2")[1]),
    code(f.invoke("scheduler.compute.expire",dict(scope,now="2999-01-01T00:00:00Z"),key="leader",component="5.2")[1]),
    code(f.invoke("scheduler.compute.expire",dict(scope,primary_now="1970-01-01T00:00:00Z"),key="leader",component="5.2")[1])]
   expect(observed==["INVALID_REQUEST"]*4 and attempt_state(f,old["attempt_id"])==baseline,"Client time or missing token accepted: "+json.dumps(observed))
  check("lease.clock.strict-inputs",strict_clock_inputs)
  # A useful artifact written by generation 1 while current; it must survive replacement as untrusted history.
  artifact=f.sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,digest,size_bytes,storage_backend,storage_key,status,completed_at) VALUES($1,$2,$3,1,'fixture','stale/checkpoint','COMPLETE',clock_timestamp()) RETURNING id::text",[i["organisation"],i["run"],m.sha(b"generation-one-checkpoint")])[0]["id"]
  checkpoint=f.sql("INSERT INTO hyperfide.checkpoints(organisation_id,run_id,attempt_id,attempt_generation,artifact_id,repository_id,source_object_id,input_packet_digest,support_level) VALUES($1,$2,$3,1,$4,$5,$6,$7,'SOURCE_ONLY') RETURNING id::text",[i["organisation"],i["run"],old["attempt_id"],artifact,i["repository"],"a"*40,f.claims["a"]["request"]["input_packet_digest"]])[0]["id"]
  response=renew(f,"worker1",old,1000);expect(response.get("ok") is True,"Short renewal failed: "+json.dumps(response))
  wait_past(f,response["result"]["lease_expires_at"])
  def expired_refused():
   # The 14.1 identity layer refuses the expired worker before the component; the lower primary API refuses too.
   response=renew(f,"worker1",old,300000);lower=f.primary("return leases.renewCompute(tx,data.token,300000);",{"token":old})
   expect(code(response)=="AUTH_STALE_ATTEMPT" and lower.get("error",{}).get("code")=="COMPUTE_LEASE_EXPIRED" and attempt_state(f,old["attempt_id"])["compute_authority"]=="CURRENT","Renewal resurrected an expired primary lease: "+json.dumps([response,lower]))
  check("lease.expired.renew-refused",expired_refused)
  check("lease.expire.fences-generation",lambda:expect(expire(f).get("result",{}).get("expired_attempt_ids")==[old["attempt_id"]],"Expiry did not fence generation 1"))
  claim=reclaim(f,"a",2);new=f.claim("a",request=claim)["token"];delegate_worker(f,new,"worker2")
  check("lease.generation.monotonic-reassignment",lambda:expect(new["attempt_generation"]=="2" and new["attempt_id"]!=old["attempt_id"] and f.sql("SELECT generation::text g,current_attempt_id::text c FROM hyperfide.tasks WHERE id=$1",[old["task_id"]])[0]=={"g":"2","c":new["attempt_id"]},"Reassignment did not issue generation N+1"))
  stale={}
  def stale_refusals():
   stale["renew"]=code(renew(f,"worker1",old,300000))
   stale["forged-generation"]=code(renew(f,"worker1",dict(old,attempt_generation="2"),300000))
   stale["cancel"]=code(f.invoke("scheduler.compute.cancel",{"token":old,"request_id":uid(),"leader_generation":"1","package_generation":"2"},key="manager",component="5.2")[1])
   stale["dispatch"]=code(f.invoke("scheduler.dispatch.ensure",{"token":old,"request_id":uid(),"leader_generation":"1","package_generation":"2"},key="manager",component="5.3")[1])
   stale["checkpoint"]=f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'CHECKPOINT'});",{"token":old}).get("error",{}).get("code")
   documented={"STALE_COMPUTE","COMPUTE_ALLOCATION_INVALID","AUTH_STALE_ATTEMPT"}
   expect(all(v in documented for v in stale.values()),"Superseded generation was not refused: "+json.dumps(stale))
  check("lease.generation.stale-requests-refused",stale_refusals)
  print(json.dumps({"type":"observation","id":"lease.generation.stale-codes","codes":stale}),flush=True)
  def stale_never_current():
   expect(attempt_state(f,old["attempt_id"])["compute_authority"]=="EXPIRED" and attempt_state(f,old["attempt_id"])["leases"]=="EXPIRED","Stale generation regained authority")
   expect(current_generations(f,old["task_id"])=={"current":1,"leases":1,"custody":0} and attempt_state(f,new["attempt_id"])["compute_authority"]=="CURRENT","Independent audit found other than one current generation")
  check("lease.generation.one-current",stale_never_current)
  def stale_history():
   expect(f.sql("SELECT count(*)::int n FROM hyperfide.checkpoints WHERE id=$1 AND attempt_generation=1",[checkpoint])[0]["n"]==1 and f.sql("SELECT status FROM hyperfide.artifacts WHERE id=$1",[artifact])[0]["status"]=="COMPLETE","Useful stale artifact was discarded")
   expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE id=$1",[old["attempt_id"]])[0]["n"]==1 and f.sql("SELECT count(*)::int n FROM hyperfide.compute_leases WHERE attempt_id=$1",[old["attempt_id"]])[0]["n"]==1,"Stale authority history deleted")
   expect(f.sql("SELECT count(*)::int n FROM hyperfide.checkpoints WHERE attempt_id=$1",[new["attempt_id"]])[0]["n"]==0 and f.sql("SELECT count(*)::int n FROM hyperfide.submission_custodies")[0]["n"]==0,"Stale artifact was transferred into current ownership")
  check("lease.stale-artifact.retained-untrusted",stale_history)
  # do_3: worker compute authority versus coordinator-owned immutable submission custody.
  check("custody.requires-released-compute",lambda:expect("release compute ownership before admitting custody" in str(m_try(lambda:admit_custody(f,new))),"Custody admitted while compute was current"))
  response=renew(f,"worker2",new,5000);expect(response.get("ok") is True,"Generation 2 renewal failed: "+json.dumps(response))
  submitted=f.primary("await leases.releaseCompute(tx,data.token,{execution_state:'SUBMITTED'});return true;",{"token":new})
  expect(submitted.get("result") is True,"Trusted submission release failed: "+json.dumps(submitted))
  custody=admit_custody(f,new)
  check("custody.worker-renewal-refused",lambda:expect(code(renew(f,"worker2",new,300000)) in ("STALE_COMPUTE","AUTH_STALE_ATTEMPT","ACTIVE_SUBMISSION_CUSTODY") and current_generations(f,new["task_id"])["custody"]==1,"Released worker renewal touched custody"))
  check("custody.worker-cancel-refused",lambda:expect(code(f.invoke("scheduler.compute.cancel",{"token":new,"request_id":uid(),"leader_generation":"1","package_generation":"2"},key="manager",component="5.2")[1]) in ("STALE_COMPUTE","COMPUTE_ALLOCATION_INVALID") and current_generations(f,new["task_id"])["custody"]==1,"Released compute cancel touched custody"))
  wait_past(f,response["result"]["lease_expires_at"])
  def expiry_preserves():
   result=expire(f);expect(result.get("result",{}).get("expired_attempt_ids")==[],"Expiry reclaimed submitted work: "+json.dumps(result))
   expect(attempt_state(f,new["attempt_id"])["compute_authority"]=="RELEASED" and f.sql("SELECT authority FROM hyperfide.submission_custodies WHERE id=$1",[custody])[0]["authority"]=="ACTIVE","Primary-clock expiry changed active custody")
  check("custody.expiry-never-reclaims",expiry_preserves)
  def fence_preserves():
   result=f.primary("return leases.fenceCompute(tx,data.token,{actor:{session_id:data.leader,leader_generation:'1'},current_authority_epoch:data.epoch,reason:'EXPIRED',recipients:{consumer_ids:[data.consumer]}});",{"token":new,"leader":i["leader"],"consumer":i["native_consumer"]})
   expect(result.get("result",{}).get("fenced") is False and f.sql("SELECT authority FROM hyperfide.submission_custodies WHERE id=$1",[custody])[0]["authority"]=="ACTIVE","Compute fence reclaimed custody: "+json.dumps(result))
  check("custody.fence-preserves",fence_preserves)
  check("custody.reassignment-blocked",lambda:expect(code(try_reclaim(f,"a",3))=="TASK_NOT_ADMISSIBLE" and current_generations(f,new["task_id"])=={"current":0,"leases":0,"custody":1},"Reassignment overtook active custody"))
  outcome=concurrently(lambda:revoke_custody(f,custody),lambda:renew(f,"worker2",new,300000),lambda:expire(f),lambda:try_reclaim(f,"a",3))
  def revocation_serializes():
   expect(not any("40P01" in json.dumps(item) or "exception" in item for item in outcome if isinstance(item,dict)),"Revocation race deadlocked or crashed: "+json.dumps(outcome))
   expect(isinstance(outcome[0],list) and len(outcome[0])==1 and outcome[1].get("ok") is False and outcome[2].get("ok") is True and outcome[2]["result"]["expired_attempt_ids"]==[],"Unexpected racing outcome: "+json.dumps(outcome))
   claimed=outcome[3]
   if claimed.get("ok") is not True:
    expect(code(claimed) in ("TASK_NOT_ADMISSIBLE","ACTIVE_SUBMISSION_CUSTODY"),"Reassignment failed for another reason: "+json.dumps(claimed))
    claimed=try_reclaim(f,"a",3)
   expect(claimed.get("ok") is True and claimed["result"]["token"]["attempt_generation"]=="3","Reassignment after revocation failed: "+json.dumps(claimed))
   expect(f.sql("SELECT authority FROM hyperfide.submission_custodies WHERE id=$1",[custody])[0]["authority"]=="REVOKED" and current_generations(f,new["task_id"])=={"current":1,"leases":1,"custody":0},"Revocation and reassignment did not leave exactly one current generation")
   expect(attempt_state(f,new["attempt_id"])["compute_authority"]=="RELEASED" and attempt_state(f,old["attempt_id"])["compute_authority"]=="EXPIRED","Superseded generations changed")
  check("custody.revocation-reassignment-serialize",revocation_serializes)
  print(json.dumps({"type":"observation","id":"custody.revocation-race","revoked":outcome[0],"renew":code(outcome[1]) if isinstance(outcome[1],dict) else outcome[1],"expire":outcome[2].get("result") if isinstance(outcome[2],dict) else outcome[2],"reassign":outcome[3].get("ok") or code(outcome[3]) if isinstance(outcome[3],dict) else outcome[3]}),flush=True)
  check("custody.revoked-worker-stays-stale",lambda:expect(code(renew(f,"worker2",new,300000)) in ("STALE_COMPUTE","COMPUTE_ALLOCATION_INVALID","AUTH_STALE_ATTEMPT") and code(renew(f,"worker1",old,300000)) in ("STALE_COMPUTE","COMPUTE_ALLOCATION_INVALID","AUTH_STALE_ATTEMPT"),"Old workers regained authority after revocation"))
 finally:
  db=f.database;path=f.path;f.close();check("lease.generations.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Generation fixture remains"))
def m_try(call):
 try:call();return None
 except Exception as error:return error
# Offsets around the primary deadline, compensated for measured request latency. Expired
# generations correctly keep their sandbox charge, so at most MAX_EXPIRIES are forced.
RACE_OFFSETS_MS=(-600,600,-400,-250,-150,-75,-25,0,50,-500,25,-50)
MAX_EXPIRIES=5
def races():
 f=lease_fixture();i=f.ids
 try:
  token=f.claim("a")["token"];generation=1;delegate_worker(f,token,"racer1");key="racer1"
  def skewed_clients():
   observed=[]
   for skew in (25,-25):
    before=primary_now(f);response=renew(f,key,token,60000,seconds=str(int(time.time())+skew));after=primary_now(f)
    observed.append(response.get("ok") is True and from_primary(f,response["result"]["lease_expires_at"],before,after,60000))
   baseline=attempt_state(f,token["attempt_id"])
   far=renew(f,key,token,300000,seconds=str(int(time.time())+3600))
   expect(observed==[True,True] and far.get("ok") is False and attempt_state(f,token["attempt_id"])==baseline,"Skewed worker clock changed authority: "+json.dumps([observed,far]))
  check("lease.clock.skewed-worker-primary-expiry",skewed_clients)
  def skewed_timezone():
   f.env["TZ"]="Pacific/Kiritimati"
   try:before=primary_now(f);result=f.primary("return leases.renewCompute(tx,data.token,60000);",{"token":token});after=primary_now(f)
   finally:f.env.pop("TZ",None)
   expect(from_primary(f,result["result"]["lease_expires_at"],before,after,60000),"Client timezone shifted primary expiry: "+json.dumps(result))
  check("lease.clock.skewed-timezone-primary-expiry",skewed_timezone)
  outcomes=[];offsets=[];started=time.monotonic()
  expect(renew(f,key,token,60000).get("ok") is True,"Latency probe failed");latency=(time.monotonic()-started)*1000
  def race_iteration(offset):
   nonlocal token,generation,key
   response=renew(f,key,token,1000);expect(response.get("ok") is True,"Race setup renewal failed: "+json.dumps(response))
   deadline=response["result"]["lease_expires_at"]
   remaining=float(f.sql("SELECT extract(epoch FROM ($1::timestamptz-clock_timestamp()))*1000 AS ms",[deadline])[0]["ms"])
   if outcomes.count("EXPIRED")>=MAX_EXPIRIES:offset=-600
   offsets.append(offset)
   time.sleep(max(0,remaining+offset-latency)/1000)
   # Keep a winning renewal live through validation; the next iteration rearms the short deadline.
   renewed,expired=concurrently(lambda:renew(f,key,token,60000),lambda:expire(f))
   expect(expired.get("ok") is True,"Expiry sweep failed: "+json.dumps(expired))
   fenced=expired["result"]["expired_attempt_ids"]
   if renewed.get("ok") is True:
    expect(fenced==[] and attempt_state(f,token["attempt_id"])["compute_authority"]=="CURRENT","Renewal and expiry both won at offset "+str(offset))
    expect(f.sql("SELECT $1::timestamptz>$2::timestamptz AS later",[renewed["result"]["lease_expires_at"],deadline])[0]["later"],"Renewal did not extend from the primary clock")
    outcomes.append("RENEWED")
   else:
    # AUTH_EXPIRED: the 14.1 guard re-reads the attempt lease on the primary clock after waiting for the sweep's locks.
    expect(code(renewed) in ("COMPUTE_LEASE_EXPIRED","AUTH_EXPIRED","STALE_COMPUTE","COMPUTE_ALLOCATION_INVALID","AUTH_STALE_ATTEMPT"),"Renewal refused for an unrelated reason: "+json.dumps(renewed))
    if fenced==[]:fenced=expire(f)["result"]["expired_attempt_ids"]
    expect(fenced==[token["attempt_id"]] and attempt_state(f,token["attempt_id"])=={**attempt_state(f,token["attempt_id"]),"compute_authority":"EXPIRED","leases":"EXPIRED"},"Refused renewal left neither outcome at offset "+str(offset))
    outcomes.append("EXPIRED")
   expect(current_generations(f,token["task_id"])["current"]<=1,"Two current generations")
   if outcomes[-1]=="EXPIRED":
    stale_key=key;stale=token;generation+=1
    token=f.claim("a",request=reclaim(f,"a",generation))["token"];key="racer"+str(generation);delegate_worker(f,token,key)
    expect(code(renew(f,stale_key,stale,1000)) in ("STALE_COMPUTE","COMPUTE_ALLOCATION_INVALID","AUTH_STALE_ATTEMPT") and attempt_state(f,stale["attempt_id"])["compute_authority"]=="EXPIRED","Reconnected stale worker resurrected authority")
  def race_all():
   for offset in RACE_OFFSETS_MS:race_iteration(offset)
   expect(len(outcomes)==len(RACE_OFFSETS_MS) and "RENEWED" in outcomes and "EXPIRED" in outcomes,"Race did not exercise both outcomes: "+json.dumps(outcomes))
   rows=f.sql("SELECT generation::text g,compute_authority a FROM hyperfide.attempts WHERE task_id=$1 ORDER BY generation",[token["task_id"]])
   expect([r["g"] for r in rows]==[str(n) for n in range(1,generation+1)] and [r["a"] for r in rows].count("CURRENT")==1 and rows[-1]["a"]=="CURRENT","Generation history is not monotonic with one current owner: "+json.dumps(rows))
  check("lease.race.renew-expire-exactly-one",race_all)
  print(json.dumps({"type":"observation","id":"lease.race.outcomes","latency_ms":round(latency),"outcomes":list(zip(offsets,outcomes))}),flush=True)
 finally:
  db=f.database;path=f.path;f.close();check("lease.races.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Race fixture remains"))
def cleanup():
 """Reuses 5.1's owned-resource cleanup and reports the observed absence it records."""
 buffer=io.StringIO()
 with contextlib.redirect_stdout(buffer):status=m.cleanup_owned("5.2")
 events=[json.loads(line) for line in buffer.getvalue().splitlines() if line.startswith("{")]
 event=next((e for e in events if e.get("type")=="cleanup"),{"type":"cleanup","complete":False,"resources":[{"id":"hf-task-5.2-runtime","status":"unknown"}]})
 evidence=m.campaign_root()/"scheduler"/"cleanup.json"
 observed=status==0 and event.get("complete") is True and evidence.is_file() and json.loads(evidence.read_text()).get("complete") is True and all(o.get("observed_absent") is True for o in json.loads(evidence.read_text())["observations"])
 for resource in event["resources"]:
  if resource.get("status")=="deleted":
   if observed:resource.update(observed_absent=True,evidence_artifact="scheduler/cleanup.json")
   else:resource["status"]="unknown"
 if not observed:event["complete"]=False
 print(json.dumps(event),flush=True)
 return 0 if observed else 1
def main():
 m.configure_cleanup("5.2")
 f=SchedulerFixture();i=f.ids
 try:
  r=f.claim("a",lease_ms=1000);t=r["token"]
  scope={"organisation_id":i["organisation"],"run_id":i["run"],"authority_epoch":i["epoch"],"leader_generation":"1"}
  cancel={"token":t,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  check("lease.renew.manager-denied",lambda:f.reject("scheduler.lease.renew",{"token":t,"lease_ms":300000},"ACTOR_DENIED",key="manager",component="5.2"))
  check("lease.expiry.primary-clock",lambda:expect(f.sql("SELECT lease_expires_at>clock_timestamp() AS live FROM hyperfide.attempts WHERE id=$1",[t["attempt_id"]])[0]["live"] in (True,False),"Primary clock query unavailable"))
  # Wait for the real primary deadline; no forged clock or synthetic lease row.
  while f.sql("SELECT lease_expires_at>clock_timestamp() AS live FROM hyperfide.attempts WHERE id=$1",[t["attempt_id"]])[0]["live"]:time.sleep(.05)
  check("lease.expired.dispatch-denied",lambda:f.reject("scheduler.dispatch.ensure",dict(cancel,request_id=uid()),"COMPUTE_LEASE_EXPIRED",key="manager",component="5.3"))
  result=f.ok("scheduler.compute.expire",scope,component="5.2")
  check("lease.expiry.exact-attempt",lambda:expect(result["expired_attempt_ids"]==[t["attempt_id"]] and result["resources_still_counted"] is True,"Expiry did not identify exact current attempt"))
  check("lease.expiry.fences-authority",lambda:expect(f.sql("SELECT compute_authority,execution_state FROM hyperfide.attempts WHERE id=$1",[t["attempt_id"]])[0]=={"compute_authority":"EXPIRED","execution_state":"FAILED"},"Expired compute retains authority"))
  check("lease.expiry.keeps-quota",lambda:expect(all(int(x["reserved"])+int(x["allocated"])>0 for x in f.counts() if x["dimension"] in ("AGENT","CPU_MILLIS","MEMORY_BYTES","DISK_BYTES")),"TTL freed occupied capacity"))
  check("lease.expiry.requests-cleanup",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.outbox_events WHERE event_type='scheduler.compute.stop.requested'")[0]["n"]==1 and f.sql("SELECT state FROM hyperfide.worker_slots WHERE id=$1",[t["slot_id"]])[0]["state"]=="DRAINING","Expiry omitted durable cleanup or slot fence"))
  check("lease.expiry.idempotent",lambda:expect(f.ok("scheduler.compute.expire",scope,component="5.2")["expired_attempt_ids"]==[],"Expiry repeated authority transition"))
  b=f.claim("b");bt=b["token"];request={"token":bt,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
  lower={"token":bt}
  check("lease.trusted-primary.renew",lambda:expect("result" in f.primary("return leases.renewCompute(tx,data.token,300000);",lower),"Actual branded primary renewal failed"))
  pause=f.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'PAUSE',operation_id:crypto.randomUUID(),reason:'Bounded lower API control regression'});",{"package_id":i["wave_package"]})
  check("lease.pause.primary-history",lambda:expect(pause.get("result",{}).get("mode")=="PAUSE","Control was not durable"))
  check("lease.pause.blocks-advance",lambda:expect(f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'ADVANCE'});",lower).get("error",{}).get("code")=="EXECUTION_HELD","Paused compute advanced"))
  check("lease.pause.allows-checkpoint",lambda:expect("result" in f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'CHECKPOINT'});",lower),"Paused current compute could not register checkpoint"))
  check("lease.pause.allows-renewal",lambda:expect("result" in f.primary("return leases.renewCompute(tx,data.token,300000);",lower),"Paused compute lost bounded renewal"))
  check("lease.control.unknown-fields",lambda:expect(f.primary("await claims.assertNoExecutionHold(tx,data.scope,{task_id:data.token.task_id,operation:'ADVANCE'});return true;",lower).get("error",{}).get("code")=="INVALID_REQUEST","Unknown scope field was silently ignored"))
  check("lease.resume.requires-cas",lambda:expect(f.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'ACTIVE',operation_id:crypto.randomUUID(),reason:'Unverified weakening'});",{"package_id":i["wave_package"]}).get("error",{}).get("code")=="RESUME_REVALIDATION_REQUIRED","Hold weakened without exact resume generation"))
  resume=f.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'ACTIVE',operation_id:crypto.randomUUID(),reason:'Exact verified test resume',resume:true,expected_generation:data.generation});",{"package_id":i["wave_package"],"generation":pause["result"]["generation"]})
  check("lease.resume.exact-generation",lambda:expect(resume.get("result",{}).get("mode")=="ACTIVE","Exact resume failed"))
  drain=f.primary("const deadline=(await tx.query(`SELECT (clock_timestamp()+interval '60 seconds')::text AS deadline`)).rows[0].deadline;return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'DRAIN',deadline_at:new Date(deadline).toISOString(),fallback_mode:'STOP',operation_id:crypto.randomUUID(),reason:'Real pre-drain admission test'});",{"package_id":i["wave_package"]})
  check("lease.drain.persisted-admission",lambda:expect("result" in f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'ADVANCE'});",lower),"Pre-drain claimed attempt was blocked"))
  check("lease.drain.requires-selector",lambda:expect(f.primary("return claims.assertNoExecutionHold(tx,data.scope,{package_id:data.package_id,operation:'ADVANCE'});",{"package_id":i["wave_package"]}).get("error",{}).get("code")=="EXECUTION_CONTINUATION_UNPROVEN","Drain accepted an unproven continuation"))
  check("lease.drain.blocks-admission",lambda:expect(f.primary("return leases.assertCurrentCompute(tx,data.token,{operation:'ADMISSION'});",lower).get("error",{}).get("code")=="EXECUTION_HELD","Drain admitted new work"))
  f.primary("return claims.applyExecutionControl(tx,data.scope,{scope_kind:'PACKAGE',scope_id:data.package_id,mode:'ACTIVE',operation_id:crypto.randomUUID(),reason:'Resume after bounded drain regression',resume:true,expected_generation:data.generation});",{"package_id":i["wave_package"],"generation":drain["result"]["generation"]})
  check("lease.cancel.foreign-manager",lambda:f.reject("scheduler.compute.cancel",request,"PACKAGE_OWNER_MISMATCH",key="manager",component="5.2"))
  cancelled=f.ok("scheduler.compute.cancel",request,key="manager2",component="5.2")
  check("lease.cancel.logical-only",lambda:expect(cancelled["termination_confirmed"] is False and cancelled["resource_disposition"]=="RELEASE_PENDING","Cancellation fabricated physical termination"))
  check("lease.cancel.replay",lambda:expect(f.ok("scheduler.compute.cancel",request,key="manager2",component="5.2")==cancelled,"Cancellation replay revived authority"))
  check("lease.cancel.stale-result-denied",lambda:f.reject("scheduler.dispatch.ensure",dict(request,request_id=uid()),"COMPUTE_ALLOCATION_INVALID",key="manager2",component="5.3"))
  check("lease.cancel.immutable-history",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==2 and f.sql("SELECT count(*)::int n FROM hyperfide.compute_leases")[0]["n"]==2,"Cleanup deleted historical authority records"))
  check("lease.cleanup.retains-sandbox-charges",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.sandbox_execution_charges WHERE state='RELEASE_PENDING'")[0]["n"]==2 and f.sql("SELECT held_cpu_millis::text cpu FROM hyperfide.sandbox_execution_budgets WHERE sandbox_id=$1",[i["sandbox"]])[0]["cpu"]=="2000","TTL/cancel freed unknown physical execution capacity"))
  check("lease.expiry.no-custody-created",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.submission_custodies")[0]["n"]==0,"Compute expiry manufactured submission custody"))
 finally:
  db=f.database;path=f.path;f.close();check("lease.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Fixture resource remains"))
 recovery=SchedulerFixture()
 try:
  current=recovery.claim('a');token=current['token'];before=recovery.counts()
  data={"organisation_id":recovery.ids["organisation"],"run_id":recovery.ids["run"],"expected_run_epoch":recovery.ids["epoch"],"target_epoch":uid(),"recovery_operation_id":uid()}
  wrong=dict(data,expected_run_epoch=uid())
  check("lease.recovery.exact-source-epoch",lambda:expect(recovery.primary("return leases.revokeRunForRecovery(tx,data.input);",{"input":wrong}).get("error",{}).get("code")=="STALE_AUTHORITY_EPOCH","Foreign source epoch revoked compute"))
  def recovery_rollback():
   outcome=recovery.primary("await leases.lockComputeFenceTargets(tx,[data.token]);await leases.revokeRunForRecovery(tx,data.input);throw Error('bounded rollback injection');",{"input":data,"token":token})
   expect("error" in outcome and "result" not in outcome and recovery.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE compute_authority='CURRENT'")[0]["n"]==1 and recovery.counts()==before,"Rollback lost authority/counters: "+json.dumps(outcome))
  check("lease.recovery.transaction-rollback",recovery_rollback)
  revoked=recovery.primary("return leases.revokeRunForRecovery(tx,data.input);",{"input":data})["result"]
  check("lease.recovery.revokes-current",lambda:expect(revoked["revoked_attempts"]=="1" and revoked["revoked_allocations"]=="1" and recovery.sql("SELECT count(*)::int n FROM hyperfide.compute_leases WHERE state='ACTIVE'")[0]["n"]==0,"Offline revocation left active compute"))
  check("lease.recovery.retains-physical-debt",lambda:expect(recovery.counts()==before and any(x.startswith("sandbox-charge:") for x in revoked["retained_debt_references"]) and recovery.sql("SELECT state FROM hyperfide.sandbox_execution_charges")[0]["state"]=="RELEASE_PENDING","Offline recovery freed unknown physical capacity"))
  check("lease.recovery.does-not-rebind-run",lambda:expect(recovery.sql("SELECT authority_epoch FROM hyperfide.runs")[0]["authority_epoch"]==data["expected_run_epoch"],"Lower revoker bypassed14 epoch CAS"))
  check("lease.recovery.idempotent-revocation",lambda:expect(recovery.primary("return leases.revokeRunForRecovery(tx,data.input);",{"input":data})["result"]["revoked_attempts"]=="0","Repeated source revocation fabricated work"))
 finally:
  db=recovery.database;path=recovery.path;recovery.close();check("lease.recovery.cleanup.observed",lambda:expect(not path.exists() and recovery.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Recovery disposable fixture remains"))
 generations()
 races()
 return 1 if m.FAILED else 0
if __name__=="__main__":raise SystemExit(cleanup() if "--cleanup" in sys.argv else main())
