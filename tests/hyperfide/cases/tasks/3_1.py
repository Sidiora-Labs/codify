#!/usr/bin/env python3
"""Real signed HTTPS hierarchy tests and reusable isolated PostgreSQL fixture.

Import HierarchyFixture for consumers; importing this module never executes tests.
Every authority-bearing request uses production Ed25519/TLS authentication.
"""
from __future__ import annotations
import concurrent.futures, json, os, socket, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
from identity_fixture import IdentityFixture,uid,b64,sha
FAILED=[];ASSERTION_IDS=[]
def expect(value,message):
 if not value:raise AssertionError(message)
def check(identity,callback):
 ASSERTION_IDS.append(identity)
 try:callback();actual="observed"
 except Exception as error:FAILED.append(identity);actual=type(error).__name__+": "+str(error)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def apply_migration(f,name):
 # Actual14 already applied the complete trusted release; verify exact bytes only.
 f.apply_migration(name)
class HierarchyFixture(IdentityFixture):
 def __init__(self,extra_components=(),extra_setup=None,bootstrap=True,extra_env=None,seed_historical_runtime=True,source_object_id=None):
  def setup(f):
   apply_migration(f,"0003-hierarchy")
   i=f.ids
   source=source_object_id or "a"*40
   for key in ("package","package2","wave_package","task","task2","repository","worker","slot","attempt","lease","finding"):i[key]=uid()
   identity=json.loads(f.identity_config.read_text())
   for key,role in (("leader","LEADER"),("leader2","LEADER"),("manager","FEATURE_MANAGER"),("manager2","FEATURE_MANAGER"),("watcher","COMMIT_WATCHER")):
    ident=uid();i[key]=ident;path=f.path/(key+".pem")
    subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(path)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);path.chmod(0o600)
    public=subprocess.check_output(["openssl","pkey","-in",str(path),"-pubout","-outform","DER"],stderr=subprocess.DEVNULL)
    f.keys[key]={"path":path,"public_key_b64":b64(public[-32:])}
    f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id) VALUES($1,$2,$3,$4,'fixture','fixture',$5)",[i["organisation"],i["run"],ident,role,"native-"+key])
    principal=dict(identity["principals"][0],credential_id=ident,actor_id=ident,role=role,public_key_b64=f.keys[key]["public_key_b64"])
    identity["principals"].append(principal)
    f.seed_fixture_principal(principal)
   f.identity_config.write_text(json.dumps(identity))
   f.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'fixture','https://example.invalid/fixture.git')",[i["organisation"],i["repository"],i["project"]])
   f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[i["organisation"],i["repository"],source])
   f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[i["organisation"],i["run"],i["repository"],source])
   for key,feature,wave in (("package","alpha",1),("package2","alpha",2),("wave_package","beta",1)):
    f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,$4,$5)",[i["organisation"],i["run"],i[key],"feature:"+feature+":wave:"+str(wave),wave])
   for key,package,wave in (("task","package",1),("task2","package2",2)):
    f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[i["organisation"],i["run"],i[key],"alpha."+str(wave),i[package],i["spec"],sha(b"criteria"),json.dumps({"feature_key":"alpha","purpose":"Preserve mandatory intent","touches":["src/a.c"]}),wave])
   f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES($1,$2,$3,'worker',1,'AGENT')",[i["organisation"],i["slot"],i["sandbox"]])
   if seed_historical_runtime:
    f.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) VALUES($1,$2,$3,$4,1,$5,$6,'RUNNING','CURRENT',$7,$8,1,clock_timestamp()+interval '1 hour')",[i["organisation"],i["run"],i["attempt"],i["task"],i["epoch"],sha(b"historical-attempt-packet"),i["sandbox"],i["slot"]])
    f.sql("UPDATE hyperfide.tasks SET generation=1,current_attempt_id=$1,state='RUNNING',state_version=state_version+1 WHERE organisation_id=$2 AND run_id=$3 AND id=$4",[i["attempt"],i["organisation"],i["run"],i["task"]])
    f.sql("INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation,expires_at) VALUES($1,$2,$3,$4,1,$5,1,clock_timestamp()+interval '1 hour')",[i["organisation"],i["run"],i["lease"],i["attempt"],i["epoch"]])
    f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id,state) VALUES($1,$2,$3,'WORKER',$4,'fixture','fixture','worker-one',$5,$6,1,$7,'RUNNING')",[i["organisation"],i["run"],i["worker"],i["manager"],i["slot"],i["sandbox"],i["attempt"]])
   f.sql("INSERT INTO hyperfide.findings(organisation_id,run_id,id,dedup_digest,owner_package_id,repository_id,source_object_id,severity,summary) VALUES($1,$2,$3,$4,$5,$6,$7,'ERROR','Persistent accountable finding')",[i["organisation"],i["run"],i["finding"],sha(b"finding"),i["package"],i["repository"],source])
   if extra_setup:extra_setup(f)
  super().__init__(extra_components=("3.1",)+tuple(extra_components),extra_setup=setup,extra_env=extra_env)
  if bootstrap:self.bootstrap()
 def ok(self,action,payload=None,key="leader",component="3.1"):
  status,response=self.invoke(action,payload or {},key=key,component=component)
  expect(status==200 and response.get("ok") is True,"Actual signed service refused: "+json.dumps(response))
  return response["result"]
 def reject(self,action,payload,code,key="leader",component="3.1"):
  status,response=self.invoke(action,payload,key=key,component=component)
  expect(response.get("ok") is False and response.get("error",{}).get("code")==code,"Expected "+code+", observed "+json.dumps(response))
  return response
 def bootstrap(self):
  self.ok("hierarchy.leader.acquire",{"idempotency_key":"bootstrap-leader","expected_generation":"0","reason":"Registered fixture leadership"})
  for key,feature,policy in (("package","alpha","FEATURE_STABLE"),("package2","alpha","FEATURE_STABLE"),("wave_package","beta","WAVE")):
   self.ok("hierarchy.package.configure",{"idempotency_key":"configure-"+key,"leader_generation":"1","package_id":self.ids[key],"feature_key":feature,"allocation_policy":policy})
   self.ok("hierarchy.package.assign",{"idempotency_key":"assign-"+key,"leader_generation":"1","package_id":self.ids[key],"expected_generation":"1","manager_session_id":self.ids["manager" if feature=="alpha" else "manager2"]})
 def snapshot(self):
  tables=["tasks","attempts","compute_leases","agent_sessions","submission_custodies","findings"]
  return {t:self.sql("SELECT to_jsonb(t) AS row FROM hyperfide."+t+" t ORDER BY id") for t in tables}
CONTEXT={"summary":"Persisted handoff","decision_refs":["decision:one"],"pending_instruction_refs":["instruction:one"],"native_session_refs":["native:manager"]}
ALPHA=("package","package2","package3")
def add_package(f,key,feature,wave,task=False):
 i=f.ids;i[key]=uid()
 f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,$4,$5)",[i["organisation"],i["run"],i[key],"feature:"+feature+":wave:"+str(wave)+":"+key,wave])
 if task:
  i[key+"_task"]=uid()
  f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[i["organisation"],i["run"],i[key+"_task"],feature+"."+key,i[key],i["spec"],sha(b"criteria"),json.dumps({"feature_key":feature,"purpose":"Preserve mandatory intent","touches":["src/a.c"]}),wave])
def configure(f,key,feature,policy,suffix=""):
 return {"idempotency_key":"configure-"+key+suffix,"leader_generation":"1","package_id":f.ids[key],"feature_key":feature,"allocation_policy":policy}
def assignment(f,key,manager,generation="1",suffix=""):
 return {"idempotency_key":"assign-"+key+suffix,"leader_generation":"1","package_id":f.ids[key],"expected_generation":generation,"manager_session_id":f.ids[manager]}
def move(f,key,generation,frm,to,suffix="",refs=(),lg="1"):
 return {"idempotency_key":"move-"+key+"-"+frm+"-"+to+suffix,"leader_generation":lg,"package_id":f.ids[key],"package_generation":generation,"from_state":frm,"to_state":to,"reason":"Probe lifecycle "+frm+" to "+to,"evidence_refs":list(refs)}
def package_row(f,key):
 return f.sql("SELECT p.manager_session_id,h.state,h.owner_generation::text AS generation FROM hyperfide.feature_packages p JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.id WHERE p.id=$1",[f.ids[key]])[0]
def generations(f,keys):
 return {f.ids[k]:package_row(f,k)["generation"] for k in keys}
def proposal(f,name,successor,keys=ALPHA,lg="1",supersedes=None):
 body={"idempotency_key":name,"leader_generation":lg,"package_ids":[f.ids[k] for k in keys],"expected_generations":generations(f,keys),"successor_id":f.ids[successor],"context":CONTEXT}
 if supersedes:body["supersedes_handoff_id"]=supersedes
 return body
def ownership_and_lifecycle(f,state):
 """Read APIs, policy selection, lifecycle, wave-boundary and domain handoffs, withdraw and single-outstanding (leader generation 1)."""
 i=f.ids
 def described():
  d=f.ok("hierarchy.describe")
  expect(d["proposed_allocation_policy"]=="FEATURE_STABLE" and d["allocation_policy_details"]["FEATURE_STABLE"]["status"]=="PROPOSED","Stable ownership is not marked as the proposed policy")
  expect(d["allocation_policy_details"]["WAVE"]["selectable"] is True and d["allocation_policies"]==["FEATURE_STABLE","WAVE"],"Wave allocation is not selectable")
  expect(len(set(d["hierarchy"].values()))==6 and d["hierarchy"]["reviewer"]=="VERIFIER" and d["hierarchy"]["integrator"]=="INTEGRATOR","Hierarchy roles are not distinct")
  expect(d["generations"]["leader_generation"]!=d["generations"]["authority_epoch"],"Leader generation reuses the platform epoch")
 check("hierarchy.describe.proposed-policy",described)
 def inspected():
  r=f.ok("hierarchy.inspect",{"leader_generation":"1"})
  owners={p["package_id"]:[p["manager_session_id"],p["state"],p["owner_generation"]] for p in r["packages"]}
  expect(owners.get(i["package"])==[i["manager2"],"ASSIGNED","3"] and owners.get(i["wave_package"])==[i["manager2"],"ASSIGNED","2"],"Inspect packages differ: "+json.dumps(owners))
  expect([[d["feature_key"],d["manager_session_id"],d["generation"]] for d in r["domain_owners"]]==[["alpha",i["manager2"],"2"]],"Inspect domain owners differ")
  expect(r["pending_handoffs"]==[] and r["proposed_allocation_policy"]=="FEATURE_STABLE","Inspect pending handoffs or policy differ")
 check("hierarchy.inspect",inspected)
 def history():
  r=f.ok("hierarchy.history",{"leader_generation":"1","package_id":i["package"]})
  moves=[[t["from_state"],t["to_state"],t["cause"]] for t in r["transitions"]]
  expect(moves==[[None,"PLANNED","CONFIGURED"],["PLANNED","ASSIGNED","ASSIGNED"],["ASSIGNED","HANDOFF_PENDING","HANDOFF_PROPOSED"],["HANDOFF_PENDING","ASSIGNED","HANDOFF_ACKNOWLEDGED"]],"Transition history differs: "+json.dumps(moves))
  expect([[h["handoff_id"],h["status"]] for h in r["handoffs"]]==[[state["handoff_id"],"ACKNOWLEDGED"]],"Handoff history differs")
  kinds=[e["kind"] for e in r["events"]]
  expect(kinds==["PACKAGE_CONFIGURED","PACKAGE_ASSIGNED","ROLE_BOUND","HANDOFF_PROPOSED","HANDOFF_ACKNOWLEDGED"],"Event history differs: "+json.dumps(kinds))
  f.reject("hierarchy.history",{"leader_generation":"1"},"ROLE_DENIED",key="manager2")
 check("hierarchy.history.read",history)
 add_package(f,"package3","alpha",3,task=True)
 def mismatch():
  f.reject("hierarchy.package.configure",configure(f,"package3","gamma","FEATURE_STABLE"),"PACKAGE_FEATURE_MISMATCH")
  expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.hierarchy_packages WHERE package_id=$1",[i["package3"]])[0]["n"]==0,"Mismatched package was configured")
 check("hierarchy.package.feature-mismatch",mismatch)
 check("hierarchy.policy.no-mixed-feature",lambda:f.reject("hierarchy.package.configure",configure(f,"package3","alpha","WAVE"),"OWNERSHIP_POLICY_CONFLICT"))
 def third_wave():
  f.ok("hierarchy.package.configure",configure(f,"package3","alpha","FEATURE_STABLE","-stable"))
  f.reject("hierarchy.package.assign",assignment(f,"package3","manager"),"OWNERSHIP_POLICY_CONFLICT")
  expect(f.ok("hierarchy.package.assign",assignment(f,"package3","manager2",suffix="-owner"))["package_generation"]=="2","Stable owner was not carried to wave three")
 check("hierarchy.policy.stable-third-wave",third_wave)
 check("hierarchy.package.already-configured",lambda:f.reject("hierarchy.package.configure",configure(f,"package3","alpha","FEATURE_STABLE","-again"),"PACKAGE_ALREADY_CONFIGURED"))
 check("hierarchy.lifecycle.skip-refused",lambda:f.reject("hierarchy.package.transition",move(f,"package3","2","ASSIGNED","CLOSED",refs=["wave:3"]),"PACKAGE_TRANSITION_INVALID"))
 check("hierarchy.lifecycle.manager-activate",lambda:expect(f.ok("hierarchy.package.transition",move(f,"package3","2","ASSIGNED","ACTIVE"),key="manager2")["to_state"]=="ACTIVE","Owner could not activate"))
 check("hierarchy.lifecycle.non-owner-refused",lambda:f.reject("hierarchy.package.transition",move(f,"package3","2","ACTIVE","BLOCKED","-other"),"PACKAGE_OWNER_MISMATCH",key="manager"))
 def blocked():
  f.ok("hierarchy.package.transition",move(f,"package3","2","ACTIVE","BLOCKED"),key="manager2")
  f.ok("hierarchy.package.transition",move(f,"package3","2","BLOCKED","ACTIVE"),key="manager2")
  expect(package_row(f,"package3")["state"]=="ACTIVE","Blocked package did not resume")
 check("hierarchy.lifecycle.blocked-resume",blocked)
 check("hierarchy.lifecycle.stale-state",lambda:f.reject("hierarchy.package.transition",move(f,"package3","2","ASSIGNED","ACTIVE","-stale"),"PACKAGE_STATE_CONFLICT"))
 check("hierarchy.lifecycle.closing",lambda:f.ok("hierarchy.package.transition",move(f,"package3","2","ACTIVE","CLOSING"),key="manager2"))
 check("hierarchy.lifecycle.manager-close-refused",lambda:f.reject("hierarchy.package.transition",move(f,"package3","2","CLOSING","CLOSED","-manager",refs=["wave:3"]),"ROLE_DENIED",key="manager2"))
 def unproven():
  response=f.reject("hierarchy.package.transition",move(f,"package3","2","CLOSING","CLOSED",refs=["wave:3"]),"PACKAGE_CLOSURE_UNPROVEN")
  expect("1 open tasks" in response["error"]["message"],"Closure diagnostic does not identify the open task")
  expect(package_row(f,"package3")["state"]=="CLOSING","Refused closure changed state")
 check("hierarchy.lifecycle.closure-unproven",unproven)
 add_package(f,"wave_package2","beta",2)
 def wave_allocation():
  f.ok("hierarchy.package.configure",configure(f,"wave_package2","beta","WAVE"))
  expect(f.ok("hierarchy.package.assign",assignment(f,"wave_package2","manager"))["manager_session_id"]==i["manager"],"Explicit wave allocation refused")
 check("hierarchy.policy.wave-allocation",wave_allocation)
 def wave_boundary():
  offered=f.ok("hierarchy.package.handoff.propose",proposal(f,"wave-boundary","manager",keys=("wave_package",)))
  f.ok("hierarchy.package.handoff.acknowledge",{"idempotency_key":"wave-boundary-ack","leader_generation":"1","handoff_id":offered["handoff_id"]},key="manager")
  expect(package_row(f,"wave_package")==({"manager_session_id":i["manager"],"state":"ASSIGNED","generation":"3"}),"Wave package handoff did not transfer")
  expect(package_row(f,"wave_package2")==({"manager_session_id":i["manager"],"state":"ASSIGNED","generation":"2"}),"Next-wave package changed")
  expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.hierarchy_domain_owners WHERE feature_key='beta'")[0]["n"]==0,"Wave policy created stable ownership")
 check("hierarchy.handoff.wave-boundary",wave_boundary)
 def closed():
  f.ok("hierarchy.package.transition",move(f,"wave_package","3","ASSIGNED","ACTIVE"),key="manager")
  f.ok("hierarchy.package.transition",move(f,"wave_package","3","ACTIVE","CLOSING"),key="manager")
  expect(f.ok("hierarchy.package.transition",move(f,"wave_package","3","CLOSING","CLOSED",refs=["wave:1:barrier"]))["to_state"]=="CLOSED","Leader closure failed")
  last=f.ok("hierarchy.history",{"leader_generation":"1","package_id":i["wave_package"]})["transitions"][-1]
  expect(last["to_state"]=="CLOSED" and last["evidence"]["evidence_refs"]==["wave:1:barrier"] and last["evidence"]["task_ids"]==[],"Closure evidence was not recorded")
 check("hierarchy.lifecycle.closed",closed)
 check("hierarchy.lifecycle.terminal",lambda:f.reject("hierarchy.package.transition",move(f,"wave_package","3","CLOSED","ACTIVE"),"PACKAGE_UNAVAILABLE"))
 def sql_graph():
  try:f.sql("UPDATE hyperfide.hierarchy_packages SET state='ACTIVE',state_version=state_version+1 WHERE package_id=$1",[i["wave_package"]]);raise RuntimeError("Terminal package reopened")
  except AssertionError as error:expect("illegal hierarchy package lifecycle" in str(error),"Wrong SQL refusal")
 check("hierarchy.lifecycle.sql-graph",sql_graph)
 add_package(f,"delta1","delta",1);add_package(f,"delta2","delta",2)
 def cancelled():
  f.ok("hierarchy.package.configure",configure(f,"delta1","delta","FEATURE_STABLE"))
  f.ok("hierarchy.package.assign",assignment(f,"delta1","manager2"))
  expect(f.ok("hierarchy.package.transition",move(f,"delta1","2","ASSIGNED","CANCELLED"))["to_state"]=="CANCELLED","Leader cancellation failed")
 check("hierarchy.lifecycle.cancelled",cancelled)
 def unassigned():
  f.ok("hierarchy.package.configure",configure(f,"delta2","delta","FEATURE_STABLE"))
  f.reject("hierarchy.package.assign",assignment(f,"delta2","manager"),"OWNERSHIP_POLICY_CONFLICT")
  f.reject("hierarchy.package.handoff.propose",proposal(f,"unassigned","manager",keys=("delta2",)),"PACKAGE_UNASSIGNED")
 check("hierarchy.handoff.unassigned-refused",unassigned)
 domain={"idempotency_key":"domain-delta","leader_generation":"1","feature_key":"delta","expected_generation":"1","successor_id":i["manager"],"reason":"Idle stable domain reallocated"}
 check("hierarchy.domain.live-refused",lambda:f.reject("hierarchy.domain.handoff",dict(domain,idempotency_key="domain-alpha",feature_key="alpha",expected_generation="2"),"HANDOFF_REQUIRED"))
 def domain_handoff():
  expect(f.ok("hierarchy.domain.handoff",domain)["domain_generation"]=="2","Domain generation differs")
  expect(f.ok("hierarchy.package.assign",assignment(f,"delta2","manager",suffix="-after-domain"))["manager_session_id"]==i["manager"],"New stable owner could not take the next wave")
  transfers=f.ok("hierarchy.history",{"leader_generation":"1"})["domain_transfers"]
  expect([[t["feature_key"],t["predecessor_id"],t["successor_id"]] for t in transfers]==[["delta",i["manager2"],i["manager"]]],"Domain transfer history differs")
 check("hierarchy.domain.handoff",domain_handoff)
 check("hierarchy.domain.stale",lambda:f.reject("hierarchy.domain.handoff",dict(domain,idempotency_key="domain-stale"),"DOMAIN_GENERATION_STALE"))
 withdraw={"idempotency_key":"withdraw","leader_generation":"1","reason":"Leader changed allocation"}
 def withdrawn():
  before=generations(f,ALPHA)
  withdraw["handoff_id"]=state["withdrawn"]=f.ok("hierarchy.package.handoff.propose",proposal(f,"withdrawn-handoff","manager"))["handoff_id"]
  result=f.ok("hierarchy.package.handoff.withdraw",withdraw)
  expect(result["ownership_changed"] is False and result["restored_states"]=={i["package"]:"ASSIGNED",i["package2"]:"ASSIGNED",i["package3"]:"CLOSING"},"Withdraw did not restore lifecycle states")
  expect(generations(f,ALPHA)==before and all(package_row(f,k)["manager_session_id"]==i["manager2"] for k in ALPHA),"Withdraw changed ownership")
 check("hierarchy.handoff.withdraw",withdrawn)
 check("hierarchy.handoff.withdrawn-ack-refused",lambda:f.reject("hierarchy.package.handoff.acknowledge",{"idempotency_key":"ack-withdrawn","leader_generation":"1","handoff_id":state.get("withdrawn",uid())},"HANDOFF_RESOLVED",key="manager"))
 def withdraw_replay():
  expect(f.ok("hierarchy.package.handoff.withdraw",withdraw)["ownership_changed"] is False,"Withdraw replay differs")
  f.reject("hierarchy.package.handoff.withdraw",dict(withdraw,idempotency_key="withdraw-again"),"HANDOFF_RESOLVED")
 check("hierarchy.handoff.withdraw-replay",withdraw_replay)
 def single():
  state["pending"]=f.ok("hierarchy.package.handoff.propose",proposal(f,"pending-handoff","manager"))["handoff_id"]
  f.reject("hierarchy.package.handoff.propose",proposal(f,"duplicate-handoff","manager"),"HANDOFF_ALREADY_PENDING")
 check("hierarchy.handoff.single-outstanding",single)
 def manager_loss():
  # The predecessor manager dies while its handoff is pending; recorded state alone must carry supervision.
  f.sql("UPDATE hyperfide.agent_sessions SET state='FAILED',state_version=state_version+1 WHERE id=$1",[i["manager2"]])
  state["before_loss"]=f.snapshot()
  r=f.ok("hierarchy.inspect",{"leader_generation":"1"})
  expect([h["handoff_id"] for h in r["pending_handoffs"]]==[state["pending"]],"Pending handoff not reconstructable")
  expect(all(package_row(f,k)=={"manager_session_id":i["manager2"],"state":"HANDOFF_PENDING","generation":generations(f,(k,))[i[k]]} for k in ALPHA),"Manager loss changed package ownership")
 check("hierarchy.manager-loss.state-retained",manager_loss)
def leader_loss_recovery(f,state):
 """V-008: leadership is replaced while a handoff is pending; the new leader supersedes it without duplicating work."""
 i=f.ids;key=state.get("winner") or "leader2"
 ack={"idempotency_key":"ack-pending","leader_generation":"2","handoff_id":state.get("pending",uid())}
 check("hierarchy.leader-loss.stale-proposal",lambda:f.reject("hierarchy.package.handoff.acknowledge",ack,"LEADER_GENERATION_STALE",key="manager"))
 def supersede():
  offered=f.ok("hierarchy.package.handoff.propose",proposal(f,"recovery-handoff","manager",lg="2",supersedes=state.get("pending",uid())),key=key)
  state["recovery"]=offered["handoff_id"]
  expect(offered["supersedes_handoff_id"]==state["pending"] and offered["predecessor_id"]==i["manager2"],"Supersession not recorded")
  f.reject("hierarchy.package.handoff.propose",proposal(f,"recovery-twice","manager",lg="2",supersedes=state["pending"]),"HANDOFF_RESOLVED",key=key)
 check("hierarchy.leader-loss.supersede",supersede)
 check("hierarchy.handoff.superseded-ack-refused",lambda:f.reject("hierarchy.package.handoff.acknowledge",dict(ack,idempotency_key="ack-superseded"),"HANDOFF_RESOLVED",key="manager"))
 def recovered():
  result=f.ok("hierarchy.package.handoff.acknowledge",{"idempotency_key":"ack-recovery","leader_generation":"2","handoff_id":state.get("recovery",uid())},key="manager")
  expect(result["restored_states"]=={i["package"]:"ASSIGNED",i["package2"]:"ASSIGNED",i["package3"]:"CLOSING"},"Recovered handoff lost lifecycle state")
  expect(all(package_row(f,k)["manager_session_id"]==i["manager"] for k in ALPHA),"Recovered ownership differs")
  expect(f.snapshot()==state.get("before_loss"),"Recovery duplicated or changed healthy task/attempt/lease/session/custody/finding")
  statuses=[h["status"] for h in f.ok("hierarchy.history",{"leader_generation":"2","package_id":i["package"]},key=key)["handoffs"]]
  expect(statuses==["ACKNOWLEDGED","WITHDRAWN","SUPERSEDED","ACKNOWLEDGED"],"Handoff outcome history differs: "+json.dumps(statuses))
 check("hierarchy.leader-loss.recovered",recovered)
def readiness_refusals(f):
 """do_5: hierarchy readiness is refused without the trusted 0003 migration; only trusted setup changes schema."""
 def refused():f.reject("hierarchy.describe",{},"HIERARCHY_SCHEMA_REQUIRED",key="manager")
 def provenance():
  original=f.sql("SELECT checksum FROM hyperfide.schema_migrations WHERE version=3")[0]["checksum"]
  f.sql("UPDATE hyperfide.schema_migrations SET checksum=$1 WHERE version=3",["sha256:"+"0"*64])
  try:
   refused()
   f.reject("hierarchy.inspect",{"leader_generation":"2"},"HIERARCHY_SCHEMA_REQUIRED",key="manager")
  finally:f.sql("UPDATE hyperfide.schema_migrations SET checksum=$1 WHERE version=3",[original])
  f.ok("hierarchy.describe",key="manager")
 check("hierarchy.readiness.provenance-refused",provenance)
 def table():
  f.sql("ALTER TABLE hyperfide.hierarchy_handoff_resolutions RENAME TO hierarchy_handoff_resolutions_absent")
  try:refused()
  finally:f.sql("ALTER TABLE hyperfide.hierarchy_handoff_resolutions_absent RENAME TO hierarchy_handoff_resolutions")
  f.ok("hierarchy.describe",key="manager")
 check("hierarchy.readiness.table-refused",table)
 def startup():
  # Migration history drift is refused earlier by task 4.4; an incompletely applied 0003 must be refused by the hierarchy itself.
  # Identity bootstrap refuses principals whose session is not current, so the lost manager is recovered first.
  f.sql("UPDATE hyperfide.agent_sessions SET state='RUNNING',state_version=state_version+1 WHERE id=$1",[f.ids["manager2"]])
  f.stop();f.sql("ALTER TABLE hyperfide.hierarchy_domain_transfers RENAME TO hierarchy_domain_transfers_absent")
  try:
   try:f.start();started=True
   except AssertionError as error:started=False;message=str(error)
   if started:raise RuntimeError("Service became ready without the complete hierarchy migration")
   expect("Apply the trusted hierarchy migration" in message,"Startup refused for another reason: "+message[:600])
  finally:
   if f.child:f.child.wait(timeout=10);f.child=None
   f.sql("ALTER TABLE hyperfide.hierarchy_domain_transfers_absent RENAME TO hierarchy_domain_transfers")
  f.start();f.ok("hierarchy.describe",key="manager")
 check("hierarchy.readiness.startup-refused",startup)
def main():
 f=HierarchyFixture(bootstrap=False);i=f.ids;state={}
 try:
  leader={"idempotency_key":"leader-first","expected_generation":"0","reason":"Initial signed leadership"}
  check("hierarchy.describe",lambda:expect(f.ok("hierarchy.describe")["dispatch_authority"] is False,"Describe granted dispatch"))
  check("hierarchy.leader.acquire",lambda:expect(f.ok("hierarchy.leader.acquire",leader)["leader_generation"]=="1","Leader generation differs"))
  check("hierarchy.leader.exact-replay",lambda:expect(f.ok("hierarchy.leader.acquire",leader)["leader_generation"]=="1","Replay advanced generation"))
  check("hierarchy.leader.conflicting-replay",lambda:f.reject("hierarchy.leader.acquire",dict(leader,reason="changed"),"IDEMPOTENCY_CONFLICT"))
  check("hierarchy.leader.role-refusal",lambda:f.reject("hierarchy.leader.acquire",dict(leader,idempotency_key="watcher",expected_generation="1"),"ROLE_DENIED",key="watcher"))
  for value in ("01","0","9223372036854775808",1):
   check("hierarchy.generation.invalid-"+str(value),lambda v=value:f.reject("hierarchy.package.configure",{"idempotency_key":"invalid-"+str(v),"leader_generation":v,"package_id":i["package"],"feature_key":"alpha","allocation_policy":"FEATURE_STABLE"},"INVALID_REQUEST"))
  check("hierarchy.actor.payload-denied",lambda:f.reject("hierarchy.leader.acquire",dict(leader,actor_id=i["leader2"]),"INVALID_REQUEST"))
  for key,feature,policy in (("package","alpha","FEATURE_STABLE"),("package2","alpha","FEATURE_STABLE"),("wave_package","beta","WAVE")):
   check("hierarchy.package.configure-"+key,lambda k=key,a=feature,p=policy:f.ok("hierarchy.package.configure",{"idempotency_key":"configure-"+k,"leader_generation":"1","package_id":i[k],"feature_key":a,"allocation_policy":p}))
  assign={"idempotency_key":"assign","leader_generation":"1","package_id":i["package"],"expected_generation":"1","manager_session_id":i["manager"]}
  check("hierarchy.package.assign",lambda:expect(f.ok("hierarchy.package.assign",assign)["package_generation"]=="2","Owner generation differs"))
  check("hierarchy.package.assign-replay",lambda:expect(f.ok("hierarchy.package.assign",assign)["package_generation"]=="2","Replay changed ownership"))
  check("hierarchy.package.no-silent-reassignment",lambda:f.reject("hierarchy.package.assign",dict(assign,idempotency_key="silent",expected_generation="2",manager_session_id=i["manager2"]),"HANDOFF_REQUIRED"))
  check("hierarchy.policy.stable-owner",lambda:f.reject("hierarchy.package.assign",dict(assign,idempotency_key="wrong-stable",package_id=i["package2"],manager_session_id=i["manager2"]),"OWNERSHIP_POLICY_CONFLICT"))
  check("hierarchy.policy.successive-waves",lambda:f.ok("hierarchy.package.assign",dict(assign,idempotency_key="wave2",package_id=i["package2"])))
  check("hierarchy.policy.wave-owner",lambda:f.ok("hierarchy.package.assign",dict(assign,idempotency_key="beta",package_id=i["wave_package"],manager_session_id=i["manager2"])))
  # Use an assignment replay for the outer-key test so leadership stays generation one.
  def envelope_binding():
   envelope=f.operation("3.1","hierarchy.package.assign",assign);expect(f.request(envelope,key="leader")[1].get("ok") is True,"Envelope replay failed")
   changed=f.operation("3.1","hierarchy.package.assign",dict(assign,idempotency_key="fresh-inner",expected_generation="2"));changed["idempotency_key"]=envelope["idempotency_key"]
   expect(f.request(changed,key="leader")[1].get("error",{}).get("code")=="IDEMPOTENCY_CONFLICT","Fresh inner key bypassed authenticated outer key")
  check("hierarchy.envelope.conflict-bound",envelope_binding)
  bind={"idempotency_key":"bind","leader_generation":"1","package_id":i["package"],"package_generation":"2","session_id":i["worker"],"role":"WORKER"}
  check("hierarchy.role.bind",lambda:expect(f.ok("hierarchy.role.bind",bind)["execution_authority"] is False,"Binding granted execution"))
  check("hierarchy.role.no-escalation",lambda:f.reject("hierarchy.role.bind",dict(bind,idempotency_key="escalate",role="INTEGRATOR"),"ROLE_DENIED"))
  handoff={"idempotency_key":"handoff","leader_generation":"1","package_ids":[i["package"],i["package2"]],"expected_generations":{i["package"]:"2",i["package2"]:"2"},"successor_id":i["manager2"],"context":{"summary":"Persisted handoff","decision_refs":["decision:one"],"pending_instruction_refs":["instruction:one"],"native_session_refs":["native:manager"]}}
  check("hierarchy.handoff.partial-refused",lambda:f.reject("hierarchy.package.handoff.propose",dict(handoff,idempotency_key="partial",package_ids=[i["package"]],expected_generations={i["package"]:"2"}),"OWNERSHIP_POLICY_CONFLICT"))
  before=f.snapshot()
  check("hierarchy.handoff.propose",lambda:state.update(f.ok("hierarchy.package.handoff.propose",handoff)))
  check("hierarchy.handoff.predecessor-retained",lambda:expect(f.sql("SELECT manager_session_id FROM hyperfide.feature_packages WHERE id=$1",[i["package"]])[0]["manager_session_id"]==i["manager"],"Proposal changed owner"))
  ack={"idempotency_key":"ack","leader_generation":"1","handoff_id":state.get("handoff_id",uid())}
  check("hierarchy.handoff.wrong-successor",lambda:f.reject("hierarchy.package.handoff.acknowledge",ack,"HANDOFF_SUCCESSOR_MISMATCH",key="manager"))
  check("hierarchy.handoff.acknowledge",lambda:expect(f.ok("hierarchy.package.handoff.acknowledge",ack,key="manager2")["ownership_changed"] is True,"Handoff did not transfer"))
  f.stop();f.start()
  check("hierarchy.handoff.restart-replay",lambda:expect(f.ok("hierarchy.package.handoff.acknowledge",ack,key="manager2")["ownership_changed"] is True,"Durable replay failed"))
  check("hierarchy.handoff.healthy-work-preserved",lambda:expect(f.snapshot()==before,"Handoff changed healthy task/attempt/lease/session/custody/finding"))
  check("hierarchy.handoff.current-owner",lambda:expect(len(f.sql("SELECT p.id FROM hyperfide.feature_packages p JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.id WHERE p.id=ANY($1::uuid[]) AND p.manager_session_id=$2 AND h.owner_generation=3",[[i["package"],i["package2"]],i["manager2"]]))==2,"Current manager generation differs"))
  def immutable():
   try:f.sql("UPDATE hyperfide.hierarchy_handoffs SET context='{}'");raise RuntimeError("History updated")
   except AssertionError as error:expect("immutable" in str(error).lower(),"Wrong SQL refusal")
  check("hierarchy.history.immutable",immutable)
  def isolation():
   for table in ("hierarchy_leaders","hierarchy_packages","hierarchy_domain_owners","hierarchy_handoffs","hierarchy_handoff_acknowledgements","hierarchy_session_packages","hierarchy_ownership_events","hierarchy_package_transitions","hierarchy_handoff_resolutions","hierarchy_domain_transfers"):
    try:f.sql("BEGIN ISOLATION LEVEL REPEATABLE READ;INSERT INTO hyperfide."+table+" DEFAULT VALUES;ROLLBACK;");raise RuntimeError("RR hierarchy write accepted")
    except AssertionError as error:expect('"code":"25001"' in str(error),"Wrong isolation refusal for "+table)
  check("hierarchy.repeatable-read-write-refused",isolation)
  ownership_and_lifecycle(f,state)
  def race():
   def request(key):return f.invoke("hierarchy.leader.acquire",{"idempotency_key":"replace-"+key,"expected_generation":"1","reason":"Concurrent replacement"},component="3.1",key=key)[1]
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(request,["leader","leader2"]))
   state["winner"]=["leader","leader2"][[r.get("ok") is True for r in responses].index(True)] if any(r.get("ok") is True for r in responses) else None
   expect(sum(r.get("ok") is True for r in responses)==1,"Concurrent replacement did not select one leader")
   expect(sum(r.get("error",{}).get("code")=="LEADER_GENERATION_STALE" for r in responses)==1,"Loser was not fenced")
  check("hierarchy.leader.concurrent-cas",race)
  check("hierarchy.leader.stale-mutation",lambda:f.reject("hierarchy.package.assign",dict(assign,idempotency_key="stale"),"LEADER_GENERATION_STALE"))
  check("hierarchy.leader.historical-replay",lambda:expect(f.ok("hierarchy.leader.acquire",leader)["leader_generation"]=="1","Historical result changed"))
  leader_loss_recovery(f,state)
  readiness_refusals(f)
  def revoked():
   f.sql("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",[i["leader"]])
   response=f.invoke("hierarchy.leader.acquire",leader,key="leader",component="3.1")[1]
   expect(response.get("ok") is False,"Revoked credential replayed authority")
  check("hierarchy.auth.revoked-before-replay",revoked)
 finally:
  db=f.database;path=f.path;port=f.port;f.close()
  def absence():
   expect(f.sql("SELECT count(*)::int AS n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Disposable database remains")
   expect(not path.exists(),"Fixture key/config directory remains")
   with socket.socket() as s:expect(s.connect_ex(("127.0.0.1",port))!=0,"HTTPS listener remains")
  check("hierarchy.cleanup.observed",absence)
 return 1 if FAILED else 0
if __name__=="__main__":
 if "--cleanup" in sys.argv:print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));raise SystemExit(0)
 raise SystemExit(main())
