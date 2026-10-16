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
  def outer_conflict():
   body={"idempotency_key":"outer-first","expected_generation":"1","reason":"outer original"}
   envelope=f.operation("3.1","hierarchy.leader.acquire",body)
   first=f.request(envelope,key="leader");expect(first[1].get("ok") is True,"Initial envelope failed")
   altered=f.operation("3.1","hierarchy.leader.acquire",dict(body,idempotency_key="fresh-inner",expected_generation="2"))
   altered["idempotency_key"]=envelope["idempotency_key"]
   result=f.request(altered,key="leader")[1]
   expect(result.get("error",{}).get("code")=="IDEMPOTENCY_CONFLICT","Fresh application key bypassed envelope conflict")
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
   for table in ("hierarchy_leaders","hierarchy_packages","hierarchy_domain_owners","hierarchy_handoffs","hierarchy_handoff_acknowledgements","hierarchy_session_packages","hierarchy_ownership_events"):
    try:f.sql("BEGIN ISOLATION LEVEL REPEATABLE READ;INSERT INTO hyperfide."+table+" DEFAULT VALUES;ROLLBACK;");raise RuntimeError("RR hierarchy write accepted")
    except AssertionError as error:expect('"code":"25001"' in str(error),"Wrong isolation refusal for "+table)
  check("hierarchy.repeatable-read-write-refused",isolation)
  def race():
   def request(key):return f.invoke("hierarchy.leader.acquire",{"idempotency_key":"replace-"+key,"expected_generation":"1","reason":"Concurrent replacement"},component="3.1",key=key)[1]
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(request,["leader","leader2"]))
   expect(sum(r.get("ok") is True for r in responses)==1,"Concurrent replacement did not select one leader")
   expect(sum(r.get("error",{}).get("code")=="LEADER_GENERATION_STALE" for r in responses)==1,"Loser was not fenced")
  check("hierarchy.leader.concurrent-cas",race)
  check("hierarchy.leader.stale-mutation",lambda:f.reject("hierarchy.package.assign",dict(assign,idempotency_key="stale"),"LEADER_GENERATION_STALE"))
  check("hierarchy.leader.historical-replay",lambda:expect(f.ok("hierarchy.leader.acquire",leader)["leader_generation"]=="1","Historical result changed"))
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
