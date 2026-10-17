#!/usr/bin/env python3
"""Real signed supervisor registration and adoption contract; no native readiness claim."""
from __future__ import annotations
import importlib.util,json,sys,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("hf_packet_adoption_fixture",ROOT/"tests/hyperfide/cases/tasks/3_2.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
FAILED=[]
def expect(value,message):
 if not value:raise AssertionError(message)
def check(identity,fn):
 try:fn();actual="observed"
 except Exception as error:FAILED.append(identity);actual=type(error).__name__+": "+str(error)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
class SupervisorFixture(m.PacketFixture):
 def __init__(self,extra_setup=None,bootstrap=True):
  def setup(f):
   m.apply_migration(f,"0005-scheduling");m.apply_migration(f,"0012-runner-registry");m.apply_migration(f,"0034-child-sessions")
   if extra_setup:extra_setup(f)
  super().__init__(extra_components=("3.4",),extra_setup=setup,bootstrap=bootstrap,seed_historical_runtime=False)
def main():
 f=SupervisorFixture();i=f.ids;new_manager=m.uid();new_leader=m.uid()
 register={"idempotency_key":"new-manager","expected_leader_generation":"1","session_id":new_manager,"role":"FEATURE_MANAGER","connector":"codex","account_key":"fixture-model-account"}
 try:
  check("supervisor.register.signed",lambda:expect(f.ok("hierarchy.supervisor.register",register,component="3.4")["native_ready"] is False,"Registration claimed native readiness"))
  check("supervisor.register.unbound-main",lambda:expect(f.sql("SELECT role,parent_session_id,native_session_id,sandbox_id,slot_id,attempt_id,state FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[i["organisation"],i["run"],new_manager])[0]=={"role":"FEATURE_MANAGER","parent_session_id":i["leader"],"native_session_id":None,"sandbox_id":None,"slot_id":None,"attempt_id":None,"state":"REGISTERED"},"Registered supervisor is not an immutable unattached main seat"))
  check("supervisor.register.exact-replay",lambda:expect(f.ok("hierarchy.supervisor.register",register,component="3.4")["session_id"]==new_manager,"Replay created another seat"))
  check("supervisor.register.changed-replay",lambda:f.reject("hierarchy.supervisor.register",dict(register,account_key="changed"),"IDEMPOTENCY_CONFLICT",component="3.4"))
  check("supervisor.register.worker-role-denied",lambda:f.reject("hierarchy.supervisor.register",dict(register,role="WORKER"),"ROLE_DENIED",component="3.4"))
  check("supervisor.register.watcher-denied",lambda:f.reject("hierarchy.supervisor.register",dict(register,idempotency_key="watcher",session_id=m.uid()),"ROLE_DENIED",key="watcher",component="3.4"))
  check("supervisor.register.operator-cannot-bypass-primary",lambda:f.reject("hierarchy.supervisor.register",dict(register,idempotency_key="operator-manager",session_id=m.uid()),"ROLE_DENIED",key="operator",component="3.4"))
  check("supervisor.register.native-id-spoof-denied",lambda:f.reject("hierarchy.supervisor.register",dict(register,native_session_id="caller-invented"),"INVALID_REQUEST",component="3.4"))
  check("supervisor.register.stale-generation",lambda:f.reject("hierarchy.supervisor.register",dict(register,idempotency_key="stale",session_id=m.uid(),expected_leader_generation="0"),"LEADER_GENERATION_STALE",component="3.4"))
  def unbound_running():
   try:f.sql("UPDATE hyperfide.agent_sessions SET state='RUNNING',state_version=state_version+1 WHERE id=$1",[new_manager]);raise RuntimeError("Unbound seat became running")
   except AssertionError as error:expect('"code":"23514"' in str(error),"Wrong unbound state refusal")
  check("supervisor.unbound-cannot-run",unbound_running)
  def first_binding():
   f.sql("UPDATE hyperfide.agent_sessions SET native_session_id='fixture-native-binding',state_version=state_version+1 WHERE id=$1",[new_manager])
   expect(f.sql("SELECT native_session_id FROM hyperfide.agent_sessions WHERE id=$1",[new_manager])[0]["native_session_id"]=="fixture-native-binding","First schema binding did not persist")
  check("supervisor.native.first-binding-schema",first_binding)
  def reject_sql(column,value):
   try:f.sql("UPDATE hyperfide.agent_sessions SET "+column+"=$1,state_version=state_version+1 WHERE id=$2",[value,new_manager]);raise RuntimeError("Immutable binding changed")
   except AssertionError as error:expect('"code":"23514"' in str(error),"Wrong immutable identity refusal")
  check("supervisor.native.rebind-refused",lambda:reject_sql("native_session_id","fixture-replacement"))
  check("supervisor.native.nullification-refused",lambda:reject_sql("native_session_id",None))
  check("supervisor.role.immutable",lambda:reject_sql("role","LEADER"))
  check("supervisor.no-launch-side-effect",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==0 and f.sql("SELECT count(*)::int n FROM hyperfide.reservations")[0]["n"]==0,"Supervisor metadata registration created compute/capacity authority"))
  def register_primary():
   result=f.ok("hierarchy.supervisor.register",dict(register,idempotency_key="new-primary",session_id=new_leader,role="LEADER"),component="3.4")
   expect(result["native_session_id"] is None and result["execution_authority"] is False,"Prelaunch primary invented a native identity or execution grant")
  check("supervisor.primary.register-unbound",register_primary)
  select={"idempotency_key":"select-primary","expected_generation":"1","session_id":new_leader,"reason":"Restricted launcher will observe the actual native identity"}
  check("supervisor.primary.watcher-cannot-select",lambda:f.reject("hierarchy.supervisor.select",dict(select,idempotency_key="watcher-select"),"ROLE_DENIED",key="watcher",component="3.4"))
  check("supervisor.primary.manager-cannot-be-primary",lambda:f.reject("hierarchy.supervisor.select",dict(select,idempotency_key="bad-target",session_id=new_manager),"SUPERVISOR_SESSION_INVALID",component="3.4"))
  check("supervisor.primary.select-signed",lambda:expect(f.ok("hierarchy.supervisor.select",select,component="3.4")["leader_generation"]=="2","Logical selection did not CAS advance"))
  check("supervisor.primary.select-replay",lambda:expect(f.ok("hierarchy.supervisor.select",select,component="3.4")["leader_generation"]=="2","Selection replay changed the seat"))
  check("supervisor.primary.actual-admitter-history",lambda:expect(f.sql("SELECT leader_session_id,selected_by_credential_id,selected_by_actor_id,predecessor_session_id,predecessor_generation::text FROM hyperfide.hierarchy_leadership_selections")[0]=={"leader_session_id":new_leader,"selected_by_credential_id":i["leader"],"selected_by_actor_id":i["leader"],"predecessor_session_id":i["leader"],"predecessor_generation":"1"},"Logical selection fabricated its actual admitting principal/history"))
  check("supervisor.primary.old-leader-fenced",lambda:f.reject("hierarchy.supervisor.register",dict(register,idempotency_key="old-primary",session_id=m.uid()),"LEADER_GENERATION_STALE",component="3.4"))
  def snapshot_write():
   for table in ("hierarchy_supervisor_registrations","hierarchy_leadership_selections","hierarchy_child_registrations","hierarchy_child_reservations"):
    try:f.sql("BEGIN ISOLATION LEVEL REPEATABLE READ;INSERT INTO hyperfide."+table+" DEFAULT VALUES;ROLLBACK;");raise RuntimeError("RR authority write accepted")
    except AssertionError as error:expect('"code":"25001"' in str(error),"Wrong isolation refusal")
  check("adoption.repeatable-read-write-refused",snapshot_write)
  recovery={}
  def recovery_bootstrap():
   f.stop();recovery["epoch"]=m.uid();recovery["credential"]=m.uid();recovery["session"]=m.uid()
   f.sql("UPDATE hyperfide.runs SET authority_epoch=$1,state_version=state_version+1 WHERE organisation_id=$2 AND id=$3",[recovery["epoch"],i["organisation"],i["run"]])
   name="recovery_operator";key=f.path/(name+".pem")
   subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);key.chmod(0o600)
   public=subprocess.check_output(["openssl","pkey","-in",str(key),"-pubout","-outform","DER"],stderr=subprocess.DEVNULL)
   f.keys[name]={"path":key,"public_key_b64":m.module.b64(public[-32:])};f.ids[name]=recovery["credential"]
   config=json.loads(f.identity_config.read_text());record=dict(config["principals"][0],credential_id=recovery["credential"],actor_id=i["operator"],role="OPERATOR",deployment_epoch=recovery["epoch"],public_key_b64=f.keys[name]["public_key_b64"])
   config["principals"]=[record];f.identity_config.write_text(json.dumps(config));f.start()
   result=f.ok("hierarchy.supervisor.register",dict(register,idempotency_key="recover-primary",expected_leader_generation="2",session_id=recovery["session"],role="LEADER"),key=name,component="3.4")
   expect(result["native_ready"] is False and result["session_id"]==recovery["session"],"Recovery invented readiness or could not register a fresh logical primary")
  check("supervisor.restore.fresh-primary-registration",recovery_bootstrap)
  def recovery_select():
   result=f.ok("hierarchy.supervisor.select",{"idempotency_key":"recovery-select","expected_generation":"2","session_id":recovery["session"],"reason":"Explicit trusted platform-epoch recovery fixture"},key="recovery_operator",component="3.4")
   expect(result["leader_generation"]=="3" and result["authority_epoch"]==recovery["epoch"],"Recovery selection did not explicitly advance the logical generation and platform epoch")
  check("supervisor.restore.explicit-selection",recovery_select)
  check("supervisor.restore.immutable-epoch-link",lambda:expect(f.sql("SELECT predecessor_authority_epoch,authority_epoch,selected_by_credential_id FROM hyperfide.hierarchy_leadership_selections WHERE leader_generation=3")[0]=={"predecessor_authority_epoch":i["epoch"],"authority_epoch":recovery["epoch"],"selected_by_credential_id":recovery["credential"]},"Recovery lost the actual predecessor epoch/admitting credential"))
  check("supervisor.restore.old-credential-fenced",lambda:expect(f.invoke("hierarchy.describe",{},key="leader",component="3.1")[1].get("error",{}).get("code")=="AUTH_REVOKED","Restored platform accepted the old credential"))

 finally:
  database=f.database;path=f.path;f.close()
  check("adoption.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[database],admin=True)[0]["n"]==0,"Fixture remains"))
 return 1 if FAILED else 0
if __name__=="__main__":
 if "--cleanup" in sys.argv:print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));raise SystemExit(0)
 raise SystemExit(main())
