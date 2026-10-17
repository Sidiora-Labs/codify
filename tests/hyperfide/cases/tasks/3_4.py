#!/usr/bin/env python3
"""Signed supervisor registration, native descendant accounting and manager adoption; no native readiness claim.

Compute is admitted through the real signed scheduler claim. The runner/native binder is outside this
component, so the fixture records its observations (native identity, RUNNING execution) as trusted SQL.
"""
from __future__ import annotations
import copy,hashlib,importlib.util,json,os,shutil,sys,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("hf_scheduler_adoption_fixture",ROOT/"tests/hyperfide/cases/tasks/5_1.py");sched=importlib.util.module_from_spec(s);s.loader.exec_module(sched)
m=sched.packet
FAILED=[]
def expect(value,message):
 if not value:raise AssertionError(message)
def check(identity,fn):
 try:fn();actual="observed"
 except Exception as error:FAILED.append(identity);actual=type(error).__name__+": "+str(error)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def native_profiles(f):
 """Trusted 14.2/14.3 configuration so the worker-registration fragment loads; no vendor binary is executed."""
 i=f.ids;secrets=f.path/"secrets";attachments=f.path/"attachments"
 secrets.mkdir(mode=0o700);attachments.mkdir(mode=0o700)
 config=f.path/"credentials.json";config.write_text(json.dumps({"schema_version":1,"secret_root":str(secrets),"attachment_root":str(attachments),"sources":[],"targets":[]}));config.chmod(0o600)
 f.env["HF_CREDENTIAL_CONFIG_FILE"]=str(config)
 binary=f.path/"codex-native";shutil.copyfile("/usr/bin/true",binary);binary.chmod(0o755)
 home=f.path/"codex-home";home.mkdir(mode=0o700);os.chown(home,41301,41301)
 profile={"schema_version":1,"profile_id":"fixture-frontier","profile_revision":"1","connector":"codex","auth_mode":"api_credential",
  "binary":{"path":str(binary),"digest":"sha256:"+hashlib.sha256(binary.read_bytes()).hexdigest(),"version":"0.0.0-fixture"},
  "credential_reference":"fixture-model-account","configured_provider_id":"fixture-provider","configured_model_alias":"fixture-alias","requested_model_id":"fixture-model",
  "permission_profile_id":"restricted-native","capabilities":{"unattended":False,"refresh":False,"concurrent_account":False,"portable_session":False,"explicit_resume":False},
  "runtime_home":str(home),"target_uid":41301,"configured_account_key":"fixture-model-account"}
 profiles=f.path/"native-profiles.json";profiles.write_text(json.dumps({"schema_version":1,"profiles":[profile]}));profiles.chmod(0o600)
 f.env["HF_NATIVE_AUTH_PROFILES_FILE"]=str(profiles)
 f.sql("INSERT INTO hyperfide.identity_credential_references(purposes,organisation_id,run_id,reference_id,credential_version,secret_locator,refresh_owner,allowed_layers,allowed_roles,state,expires_at) VALUES(ARRAY['WORKER_RUNTIME'],$1,$2,'fixture-model-account',1,'fixture-model-account',$3,ARRAY['runtime'],ARRAY['LEADER','FEATURE_MANAGER'],'AVAILABLE',clock_timestamp()+interval '1 hour')",[i["organisation"],i["run"],i["operator"]])
PARSE="import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"
def accepted_intent(f):
 """Next-generation accepted spec intent with an explicit review proof mapping for the claimed task."""
 f.spec_generation=sched.next_spec_generation(f)
 i=f.ids;rubric=f.packet_proof["rubric_digest"];accepted=m.uid();i["accepted_spec"]=accepted
 source=('[meta]\nslug = "hyperfide-3-4-fixture"\n[req.3]\nac_4 = "Native child agents register parentage, role, task association, sandbox/slot and resource use."\n'
  '[acceptance.V-007]\nreqs = ["3.4"]\n[task.3.4]\nwave = 1\nreqs = ["3.4"]\nrequires = []\ntouches = ["src/claim-a.ts"]\n'
  '[proof]\nrubric_digest = '+json.dumps(rubric)+'\n[proof.review.3.4]\nreviewers = '+json.dumps([i["watcher"]])+'\nrubric_digest = '+json.dumps(rubric)+'\n')
 parsed=json.loads(subprocess.check_output(["node","--input-type=module","-e",PARSE],input=source.encode(),cwd=ROOT))
 document={"schema_version":1,"revision_digest":m.sha(b"hyperfide-3.4-accepted-envelope"),"source_digest":m.sha(source.encode()),"repositories":[{"repository_id":i["repository"],"source_object_id":"a"*40,"integration_ref":"refs/heads/main"}],"allowed_actions":f.actions,"closure_policy":{"required_evidence":[],"required_review_roles":[],"publication":"AFTER_QUALIFICATION"},"provenance":None,"parsed":parsed,"runtime_wave_offset":0}
 f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[i["organisation"],i["project"],accepted,m.sha(source.encode()),source,json.dumps(document),document["revision_digest"]])
 f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$4,$3)",[i["organisation"],i["run"],accepted,f.spec_generation])
 f.sql("UPDATE hyperfide.runs SET spec_revision_id=$3,spec_generation=$4,state='PENDING_VALIDATION',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"],accepted,f.spec_generation])
 section=next(x for x in parsed["sections"] if x["name"]=="task.3.4")
 criteria=f.sql("SELECT criteria_digest FROM hyperfide.tasks WHERE id=$1",[i["task_a"]])[0]["criteria_digest"]
 f.sql("UPDATE hyperfide.tasks SET spec_revision_id=$3,spec_generation=$6,definition=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$5",[i["organisation"],i["run"],accepted,json.dumps(dict(f.definitions["a"],section=section)),i["task_a"],f.spec_generation])
 policy=copy.deepcopy(f.packet_proof);policy.update(criteria_digest=criteria,spec_revision_id=accepted,spec_generation=f.spec_generation,clauses=[{"id":"3.4","mode":"REVIEW","acceptance_ids":["V-007"],"reviewers":[i["watcher"]],"rubric_digest":rubric}])
 f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,$8,$4,$5,$6,$7)",[i["organisation"],i["run"],i["task_a"],accepted,criteria,m.identity(policy),json.dumps(policy),f.spec_generation])
 f.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"]])
def claim(f):
 request=f.packet_request("a");packet=f.ok("hierarchy.packet.create",request,key="manager",component="3.2");i=f.ids
 body={"organisation_id":i["organisation"],"run_id":i["run"],"request_id":m.uid(),"task_id":request["task_id"],"attempt_id":request["attempt_id"],"attempt_generation":request["attempt_generation"],"run_spec_generation":f.spec_generation,"spec_generation":f.spec_generation,"spec_revision_id":i["accepted_spec"],"authority_epoch":i["epoch"],"leader_generation":"1","package_generation":"2","sandbox_id":i["sandbox"],"slot_id":request["slot_id"],"sandbox_boot_generation":"1","lease_ms":300000,"input_packet_digest":packet["digest"],"capacity":f.capacity()}
 return f.ok("scheduler.claim",body,key="manager",component="5.1")
ROTATE="""import {randomUUID} from 'node:crypto';import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';import {AuthorityStore,lookupAuthorityActivation,assertExternalAuthorityCurrent} from './services/hyperfide/dist/storage/durability.js';import {FileExternalAuthorityJournal} from './services/hyperfide/dist/storage/authority_journal.js';import {hash} from './services/hyperfide/dist/transport/protocol.js';
const signal=new AbortController().signal,r=createResourceContainer({role:'control',env:process.env,signal}),deployment=process.env.HYPERFIDE_DEPLOYMENT_ID,previous=process.argv[1],writer=process.argv[2],journal=new FileExternalAuthorityJournal(process.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR,i=>lookupAuthorityActivation(r,i));
try{const fencer={isolate:async input=>{if(input.source_epoch!==previous||input.deployment_id!==deployment)throw Error('Fixture fences only the exact stopped predecessor');const now=Date.now();
return {deployment_id:deployment,operation_id:input.operation_id,source_epoch:input.source_epoch,fence_id:randomUUID(),isolated_writer:'stopped-fixture-process:'+writer,observed_at:new Date(now).toISOString(),expires_at:new Date(now+25000).toISOString(),evidence_digest:hash(JSON.stringify({kind:'COMPONENT_FIXTURE_STOPPED_WRITER',writer,previous}))};}};
const result=await new AuthorityStore(r,deployment,journal).activate({operation_id:randomUUID(),expected_previous_epoch:previous},fencer);await assertExternalAuthorityCurrent(r,journal,{deployment_id:deployment});process.stdout.write(JSON.stringify(result));}finally{await r.close();}"""
def rotate_epoch(f,writer):
 """Trusted platform-epoch recovery after the observed stop of the only fixture writer process."""
 env=f.env.copy()
 for key in ("DATABASE_URL","HYPERFIDE_CONTROL_PRIMARY_DATABASE_URL"):env[key]=f.url
 result=subprocess.run(["node","--input-type=module","-e",ROTATE,f.ids["epoch"],str(writer)],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=40)
 expect(result.returncode==0,"Trusted epoch activation failed: "+result.stderr[:1200])
 return json.loads(result.stdout)["epoch"]
class SupervisorFixture(sched.SchedulerFixture):
 def __init__(self,extra_setup=None,bootstrap=True):
  def setup(f):
   for name in ("0005-scheduling","0012-runner-registry","0034-child-sessions"):m.apply_migration(f,name)
   native_profiles(f);accepted_intent(f)
   if extra_setup:extra_setup(f)
  super().__init__(extra_components=("3.4","3.4-workers"),extra_setup=setup,bootstrap=bootstrap,agent_limit=4)
def main():
 f=SupervisorFixture();i=f.ids;new_manager=m.uid();new_leader=m.uid();state={}
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
  def reject_sql(column,value,session=None):
   try:f.sql("UPDATE hyperfide.agent_sessions SET "+column+"=$1,state_version=state_version+1 WHERE id=$2",[value,session or new_manager]);raise RuntimeError("Immutable binding changed")
   except AssertionError as error:expect('"code":"23514"' in str(error),"Wrong immutable identity refusal")
  check("supervisor.native.rebind-refused",lambda:reject_sql("native_session_id","fixture-replacement"))
  check("supervisor.native.nullification-refused",lambda:reject_sql("native_session_id",None))
  check("supervisor.role.immutable",lambda:reject_sql("role","LEADER"))
  check("supervisor.no-launch-side-effect",lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.attempts")[0]["n"]==0 and f.sql("SELECT count(*)::int n FROM hyperfide.reservations")[0]["n"]==0,"Supervisor metadata registration created compute/capacity authority"))
  def register_primary():
   result=f.ok("hierarchy.supervisor.register",dict(register,idempotency_key="new-primary",session_id=new_leader,role="LEADER"),component="3.4")
   expect(result["native_session_id"] is None and result["execution_authority"] is False,"Prelaunch primary invented a native identity or execution grant")
  check("supervisor.primary.register-unbound",register_primary)

  # Native descendants on an actual signed scheduler claim (active slot allocation, held AGENT charge, lease).
  token=claim(f)["token"];attempt=token["attempt_id"]
  seat={"idempotency_key":"worker-seat","leader_generation":"1","package_generation":"2","token":token}
  def worker_register():
   result=f.ok("hierarchy.worker.register",seat,key="manager",component="hierarchy-worker-registration");state["worker"]=result["session_id"]
   expect(result["native_session_id"] is None and result["state"]=="REGISTERED" and result["execution_authority"] is False,"Worker seat invented native identity or authority")
   row=f.sql("SELECT role,parent_session_id,attempt_id,slot_id,sandbox_id,sandbox_boot_generation::text FROM hyperfide.agent_sessions WHERE id=$1",[result["session_id"]])[0]
   expect(row=={"role":"WORKER","parent_session_id":i["manager"],"attempt_id":attempt,"slot_id":token["slot_id"],"sandbox_id":token["sandbox_id"],"sandbox_boot_generation":"1"},"Worker seat lost packet parentage/executor")
  check("worker.register.signed",worker_register)
  check("worker.register.exact-replay",lambda:expect(f.ok("hierarchy.worker.register",seat,key="manager",component="hierarchy-worker-registration")["session_id"]==state["worker"],"Worker seat replay created another seat"))
  check("worker.register.watcher-denied",lambda:f.reject("hierarchy.worker.register",dict(seat,idempotency_key="watcher-seat"),"ROLE_DENIED",key="watcher",component="hierarchy-worker-registration"))
  worker=state.get("worker",m.uid())
  # Trusted fixture stands in for the runner's observed native start of the parent worker.
  f.sql("UPDATE hyperfide.agent_sessions SET native_session_id='worker-native-a',state='RUNNING',state_version=state_version+1 WHERE id=$1",[worker])
  f.sql("UPDATE hyperfide.attempts SET execution_state='RUNNING',state_version=state_version+1 WHERE id=$1",[attempt])
  child1=m.uid();child2=m.uid();hidden=m.uid()
  child={"idempotency_key":"child-one","leader_generation":"1","package_generation":"2","parent_session_id":worker,"child_session_id":child1,"token":token,"capacity":f.capacity()}
  def child_register():
   result=f.ok("hierarchy.child.register",child,key="manager",component="3.4");state["child"]=result
   expect(result["launch_authority"] is False and result["credential_authority"] is False and len(result["reservation_ids"])==4,"Descendant registration granted authority or omitted charged dimensions")
  check("child.register.charged",child_register)
  def parentage():
   row=f.sql("SELECT c.parent_session_id,c.manager_session_id,c.package_id,c.task_id,c.attempt_id,c.slot_id,c.sandbox_id,s.role,s.state,s.native_session_id FROM hyperfide.hierarchy_child_registrations c JOIN hyperfide.agent_sessions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.child_session_id WHERE c.child_session_id=$1",[child1])[0]
   expect(row=={"parent_session_id":worker,"manager_session_id":i["manager"],"package_id":i["package"],"task_id":token["task_id"],"attempt_id":attempt,"slot_id":token["slot_id"],"sandbox_id":token["sandbox_id"],"role":"WORKER","state":"REGISTERED","native_session_id":None},"Descendant parentage/task/slot registration differs")
  check("child.register.parentage-task-slot",parentage)
  check("child.register.exact-replay",lambda:expect(f.ok("hierarchy.child.register",child,key="manager",component="3.4")==state["child"],"Descendant replay changed registration"))
  def counted():
   agent=[x for x in f.counts() if x["dimension"]=="AGENT"][0]
   held=f.sql("SELECT held_cpu_millis::text cpu FROM hyperfide.sandbox_execution_budgets WHERE sandbox_id=$1",[i["sandbox"]])[0]["cpu"]
   expect(agent=={"dimension":"AGENT","reserved":"1","allocated":"1"} and held=="2000","Child capacity is not counted alongside its parent")
  check("child.capacity.counted",counted)
  check("child.register.worker-parent-required",lambda:f.reject("hierarchy.child.register",dict(child,idempotency_key="manager-parent",child_session_id=m.uid(),parent_session_id=i["manager"]),"PARENT_IDENTITY_MISMATCH",key="manager",component="3.4"))
  check("child.register.watcher-denied",lambda:f.reject("hierarchy.child.register",dict(child,idempotency_key="watcher-child",child_session_id=m.uid()),"ROLE_DENIED",key="watcher",component="3.4"))
  # Trusted fixture stands in for the native binder observing the child CLI identity.
  f.sql("UPDATE hyperfide.agent_sessions SET native_session_id='child-native-1',state='RUNNING',state_version=state_version+1 WHERE id=$1",[child1])
  verify={"leader_generation":"1","package_generation":"2","session_id":child1}
  check("child.verify.accounted",lambda:expect(f.ok("hierarchy.child.verify",verify,key="manager",component="3.4")["status"]=="ACCOUNTED","Registered charged descendant was not accounted"))
  f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id,state) VALUES($1,$2,$3,'WORKER',$4,'codex','fixture-model-account','hidden-native',$5,$6,1,$7,'RUNNING')",[i["organisation"],i["run"],hidden,worker,token["slot_id"],token["sandbox_id"],attempt])
  check("child.hidden-spawn.authority-refused",lambda:f.reject("hierarchy.child.verify",dict(verify,session_id=hidden),"CHILD_REGISTRATION_REQUIRED",key="manager",component="3.4"))
  inspect={"leader_generation":"1","package_id":i["package"],"package_generation":"2"}
  def hidden_visible():
   view=f.ok("hierarchy.adoption.inspect",inspect,key="manager",component="3.4")
   expect(view["unaccounted_descendants"]==[hidden] and view["adoptable"] is False,"Hidden local spawn was not visible as unaccounted")
  check("child.hidden-spawn.visible",hidden_visible)
  handoff={"idempotency_key":"adopt","leader_generation":"1","package_ids":[i["package"],i["package2"]],"expected_generations":{i["package"]:"2",i["package2"]:"2"},"successor_id":i["manager2"],"context":{"summary":"Replace manager with recorded package","decision_refs":["decision:adopt"],"pending_instruction_refs":["instruction:continue"],"native_session_refs":["native:manager"]}}
  def unaccounted_refused():
   f.reject("hierarchy.adoption.propose",dict(handoff,idempotency_key="adopt-hidden"),"UNACCOUNTED_DESCENDANT",component="3.4")
   expect(f.sql("SELECT count(*)::int n FROM hyperfide.hierarchy_handoffs")[0]["n"]==0 and f.sql("SELECT count(*)::int n FROM hyperfide.hierarchy_packages WHERE state='HANDOFF_PENDING'")[0]["n"]==0,"Refused adoption left a pending handoff")
  check("adoption.unaccounted-refused",unaccounted_refused)
  # The observed stop of the hidden process removes it from the live descendant set.
  f.sql("UPDATE hyperfide.agent_sessions SET state='STOPPED',state_version=state_version+1 WHERE id=$1",[hidden])
  usage={"idempotency_key":"usage-1","leader_generation":"1","package_generation":"2","child_session_id":child1,"sample_id":m.uid(),"usage":{"cpu_millis":"500","memory_bytes":"1073741824","disk_bytes":"1073741824","model_input_tokens":"100","model_output_tokens":"50"}}
  check("child.usage.observed",lambda:expect(f.ok("hierarchy.child.usage.observe",usage,key="manager",component="3.4")["within_reservation"] is True,"Observed usage within reservation was not accepted"))
  over=dict(usage,idempotency_key="usage-2",sample_id=m.uid(),usage=dict(usage["usage"],cpu_millis="1500",model_input_tokens="200"))
  check("child.usage.over-reservation-visible",lambda:expect(f.ok("hierarchy.child.usage.observe",over,key="manager",component="3.4")["within_reservation"] is False,"Usage above the charged reservation was hidden"))
  check("child.usage.regression-refused",lambda:f.reject("hierarchy.child.usage.observe",dict(usage,idempotency_key="usage-3",sample_id=m.uid(),usage=dict(usage["usage"],model_input_tokens="10")),"USAGE_REGRESSION",key="manager",component="3.4"))
  def child_view():
   view=f.ok("hierarchy.adoption.inspect",inspect,key="manager",component="3.4")
   row=[c for c in view["children"] if c["child_session_id"]==child1][0]
   expect(row["usage"]["samples"]=="2" and row["usage"]["peak_cpu_millis"]=="1500" and row["usage"]["within_reservation"] is False and row["usage"]["model_input_tokens"]=="200","Usage aggregates are not visible")
   expect(sorted(r["dimension"] for r in row["reservations"])==["AGENT","CPU_MILLIS","DISK_BYTES","MEMORY_BYTES"] and row["sandbox_charge_state"]=="HELD" and row["charged_cpu_millis"]=="1000" and row["status"]=="ACCOUNTED","Child reservations/charge are not visible through the service")
   expect(row["parent_session_id"]==worker and row["task_id"]==token["task_id"] and row["slot_id"]==token["slot_id"],"Child parentage is not visible through the service")
  check("child.inspect.usage-visible",child_view)
  def renewal_gap():
   expect("result" in f.primary("return leases.renewCompute(tx,data.token,300000);",{"token":token}),"Trusted parent renewal failed")
   row=[c for c in f.ok("hierarchy.adoption.inspect",inspect,key="manager",component="3.4")["children"] if c["child_session_id"]==child1][0]
   expect(row["capacity_aligned"] is False,"Renewal unexpectedly extended child capacity; lower hook now exists")
  check("child.capacity.renewal-gap-observed",renewal_gap)
  def realigned():
   result=f.ok("hierarchy.child.usage.observe",dict(usage,idempotency_key="usage-4",sample_id=m.uid(),usage=dict(over["usage"])),key="manager",component="3.4")
   row=[c for c in f.ok("hierarchy.adoption.inspect",inspect,key="manager",component="3.4")["children"] if c["child_session_id"]==child1][0]
   expect(result["capacity_reservations_extended"]==4 and row["capacity_aligned"] is True and row["capacity_expires_at"]==row["parent_lease_expires_at"],"Child capacity did not follow the renewed parent lease")
  check("child.capacity.realigned-by-observation",realigned)
  second=dict(child,idempotency_key="child-two",child_session_id=child2)
  check("child.register.second",lambda:expect(f.ok("hierarchy.child.register",second,key="manager",component="3.4")["child_session_id"]==child2,"Second descendant within limits was refused"))
  check("child.limit.descendants",lambda:f.reject("hierarchy.child.register",dict(child,idempotency_key="child-three",child_session_id=m.uid()),"CHILD_LIMIT",key="manager",component="3.4"))
  release={"idempotency_key":"release-two","leader_generation":"1","package_generation":"2","child_session_id":child2,"observed_state":"UNBOUND","reason":"Child never launched"}
  def released():
   result=f.ok("hierarchy.child.release",release,key="manager",component="3.4");state["release"]=result
   rows=f.sql("SELECT r.state FROM hyperfide.hierarchy_child_reservations l JOIN hyperfide.reservations r ON r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id WHERE l.child_session_id=$1",[child2])
   charge=f.sql("SELECT x.state FROM hyperfide.hierarchy_child_registrations c JOIN hyperfide.sandbox_execution_charges x ON x.organisation_id=c.organisation_id AND x.run_id=c.run_id AND x.id=c.sandbox_charge_id WHERE c.child_session_id=$1",[child2])[0]["state"]
   expect(result["resources_still_counted"] is True and len(rows)==4 and all(r["state"]=="RELEASE_PENDING" for r in rows) and charge=="RELEASE_PENDING","Logical release did not fence capacity while keeping it counted")
  check("child.release.logical",released)
  check("child.release.exact-replay",lambda:expect(f.ok("hierarchy.child.release",release,key="manager",component="3.4")==state["release"],"Release replay changed outcome"))
  check("child.release.repeat-refused",lambda:f.reject("hierarchy.child.release",dict(release,idempotency_key="release-again"),"CHILD_RELEASED",key="manager",component="3.4"))
  check("child.release.state-mismatch",lambda:f.reject("hierarchy.child.release",dict(release,idempotency_key="release-bound",child_session_id=child1),"CHILD_STATE_MISMATCH",key="manager",component="3.4"))
  check("child.release.authority-revoked",lambda:f.reject("hierarchy.child.verify",dict(verify,session_id=child2),"CHILD_RELEASED",key="manager",component="3.4"))
  def still_counted():
   f.reject("hierarchy.child.register",dict(child,idempotency_key="child-four",child_session_id=m.uid()),"CHILD_LIMIT",key="manager",component="3.4")
   agent=[x for x in f.counts() if x["dimension"]=="AGENT"][0]
   expect(agent["reserved"]=="2" and agent["allocated"]=="1","Uncertain released child capacity was freed before quiescence")
  check("child.release.still-counted",still_counted)

  # Manager replacement adopts the recorded package and its valid descendants.
  def adoption_proposed():
   result=f.ok("hierarchy.adoption.propose",handoff,component="3.4");state["proposal"]=result
   status={d["session_id"]:d["status"] for d in result["descendants"]}
   expect(result["ownership_changed"] is False and status=={worker:"ACCOUNTED",child1:"ACCOUNTED",child2:"RELEASED"} and sorted(result["adoptable"])==sorted([worker,child1]),"Proposal did not persist the exact descendant set")
   row=f.sql("SELECT descendants_digest,jsonb_array_length(descendants) n FROM hyperfide.hierarchy_adoptions WHERE handoff_id=$1",[result["handoff_id"]])[0]
   expect(row=={"descendants_digest":result["descendants_digest"],"n":3},"Descendant snapshot is not durable")
  check("adoption.propose.persists-descendants",adoption_proposed)
  before={"sessions":f.sql("SELECT id,state,native_session_id,attempt_id,state_version::text FROM hyperfide.agent_sessions WHERE role='WORKER' ORDER BY id"),"attempts":f.sql("SELECT id,generation::text,compute_authority,execution_state FROM hyperfide.attempts ORDER BY id"),"leases":f.sql("SELECT id,state FROM hyperfide.compute_leases ORDER BY id")}
  ack={"idempotency_key":"adopt-ack","leader_generation":"1","handoff_id":state.get("proposal",{}).get("handoff_id",m.uid())}
  check("adoption.acknowledge.wrong-successor",lambda:f.reject("hierarchy.adoption.acknowledge",ack,"HANDOFF_SUCCESSOR_MISMATCH",key="manager",component="3.4"))
  def adopted():
   result=f.ok("hierarchy.adoption.acknowledge",ack,key="manager2",component="3.4");state["ack"]=result
   expect(result["ownership_changed"] is True and result["adopted_descendants"]==sorted([worker,child1]) and result["workers_restarted"] is False and result["not_adopted"]==[{"session_id":child2,"reason":"CHILD_RELEASED"}],"Successor did not adopt exactly the valid descendants")
  check("adoption.acknowledge.adopts",adopted)
  f.stop();f.start()
  check("adoption.acknowledge.restart-replay",lambda:expect(f.ok("hierarchy.adoption.acknowledge",ack,key="manager2",component="3.4")==state["ack"],"Durable adoption replay changed outcome"))
  def not_restarted():
   after={"sessions":f.sql("SELECT id,state,native_session_id,attempt_id,state_version::text FROM hyperfide.agent_sessions WHERE role='WORKER' ORDER BY id"),"attempts":f.sql("SELECT id,generation::text,compute_authority,execution_state FROM hyperfide.attempts ORDER BY id"),"leases":f.sql("SELECT id,state FROM hyperfide.compute_leases ORDER BY id")}
   expect(after==before,"Manager replacement restarted, replaced or mutated healthy worker/child execution")
   row=f.sql("SELECT workers_restarted,adopted FROM hyperfide.hierarchy_adoption_acknowledgements WHERE handoff_id=$1",[ack["handoff_id"]])[0]
   expect(row=={"workers_restarted":False,"adopted":sorted([worker,child1])},"Recorded restart observation differs")
  check("adoption.healthy-descendants-not-restarted",not_restarted)
  def single_owner():
   rows=f.sql("SELECT p.manager_session_id,h.owner_generation::text g FROM hyperfide.feature_packages p JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.id WHERE p.id=ANY($1::uuid[])",[[i["package"],i["package2"]]])
   expect(rows==[{"manager_session_id":i["manager2"],"g":"3"}]*2,"Package has competing or stale owners")
   f.reject("hierarchy.adoption.inspect",dict(inspect,package_generation="3"),"PACKAGE_OWNER_MISMATCH",key="manager",component="3.4")
  check("adoption.single-owner",single_owner)
  successor={"leader_generation":"1","package_generation":"3"}
  check("adoption.successor-accounts-child",lambda:expect(f.ok("hierarchy.child.verify",dict(successor,session_id=child1),key="manager2",component="3.4")["status"]=="ACCOUNTED","Successor cannot account for adopted descendant"))
  check("adoption.successor-observes-usage",lambda:expect(f.ok("hierarchy.child.usage.observe",dict(usage,idempotency_key="usage-5",package_generation="3",sample_id=m.uid(),usage=dict(over["usage"])),key="manager2",component="3.4")["child_session_id"]==child1,"Adopted descendant usage is not accountable to the successor"))
  def successor_view():
   view=f.ok("hierarchy.adoption.inspect",dict(inspect,package_generation="3"),key="manager2",component="3.4")
   expect(view["current_manager_session_id"]==i["manager2"] and view["adoptions"][0]["workers_restarted"] is False and view["adoptions"][0]["adopted"]==sorted([worker,child1]) and view["adoptable"] is True,"Adoption history is not visible to the successor")
  check("adoption.inspect.history",successor_view)
  def worker_seat_after_adoption():
   check_seat=f.ok("hierarchy.worker.register",dict(seat,idempotency_key="worker-seat-successor",package_generation="3"),key="manager2",component="hierarchy-worker-registration")
   expect(check_seat["session_id"]==worker and check_seat["native_session_id"]=="worker-native-a","Successor duplicated the existing worker seat")
  check("adoption.worker-seat-not-duplicated",worker_seat_after_adoption)

  select={"idempotency_key":"select-primary","expected_generation":"1","session_id":new_leader,"reason":"Restricted launcher will observe the actual native identity"}
  check("supervisor.primary.watcher-cannot-select",lambda:f.reject("hierarchy.supervisor.select",dict(select,idempotency_key="watcher-select"),"ROLE_DENIED",key="watcher",component="3.4"))
  check("supervisor.primary.manager-cannot-be-primary",lambda:f.reject("hierarchy.supervisor.select",dict(select,idempotency_key="bad-target",session_id=new_manager),"SUPERVISOR_SESSION_INVALID",component="3.4"))
  check("supervisor.primary.select-signed",lambda:expect(f.ok("hierarchy.supervisor.select",select,component="3.4")["leader_generation"]=="2","Logical selection did not CAS advance"))
  check("supervisor.primary.select-replay",lambda:expect(f.ok("hierarchy.supervisor.select",select,component="3.4")["leader_generation"]=="2","Selection replay changed the seat"))
  check("supervisor.primary.actual-admitter-history",lambda:expect(f.sql("SELECT leader_session_id,selected_by_credential_id,selected_by_actor_id,predecessor_session_id,predecessor_generation::text FROM hyperfide.hierarchy_leadership_selections")[0]=={"leader_session_id":new_leader,"selected_by_credential_id":i["leader"],"selected_by_actor_id":i["leader"],"predecessor_session_id":i["leader"],"predecessor_generation":"1"},"Logical selection fabricated its actual admitting principal/history"))
  check("supervisor.primary.old-leader-fenced",lambda:f.reject("hierarchy.supervisor.register",dict(register,idempotency_key="old-primary",session_id=m.uid()),"LEADER_GENERATION_STALE",component="3.4"))
  def snapshot_write():
   for table in ("hierarchy_supervisor_registrations","hierarchy_leadership_selections","hierarchy_child_registrations","hierarchy_child_reservations","hierarchy_child_usage","hierarchy_child_releases","hierarchy_adoptions","hierarchy_adoption_acknowledgements"):
    try:f.sql("BEGIN ISOLATION LEVEL REPEATABLE READ;INSERT INTO hyperfide."+table+" DEFAULT VALUES;ROLLBACK;");raise RuntimeError("RR authority write accepted")
    except AssertionError as error:expect('"code":"25001"' in str(error),"Wrong isolation refusal for "+table)
  check("adoption.repeatable-read-write-refused",snapshot_write)
  def immutable_history():
   for table in ("hierarchy_child_usage","hierarchy_child_releases","hierarchy_adoptions","hierarchy_adoption_acknowledgements"):
    try:f.sql("DELETE FROM hyperfide."+table);raise RuntimeError("History deleted")
    except AssertionError as error:expect("immutable" in str(error).lower(),"Wrong immutable history refusal for "+table)
  check("adoption.history.immutable",immutable_history)
  recovery={}
  def recovery_bootstrap():
   writer=f.child.pid;f.stop();recovery["epoch"]=rotate_epoch(f,writer);recovery["credential"]=m.uid();recovery["session"]=m.uid()
   f.sql("UPDATE hyperfide.runs SET authority_epoch=$1,state_version=state_version+1 WHERE organisation_id=$2 AND id=$3",[recovery["epoch"],i["organisation"],i["run"]])
   name="recovery_operator";key=f.path/(name+".pem")
   subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);key.chmod(0o600)
   public=subprocess.check_output(["openssl","pkey","-in",str(key),"-pubout","-outform","DER"],stderr=subprocess.DEVNULL)
   f.keys[name]={"path":key,"public_key_b64":m.module.b64(public[-32:])};f.ids[name]=recovery["credential"]
   config=json.loads(f.identity_config.read_text());record=dict(config["principals"][0],credential_id=recovery["credential"],actor_id=i["operator"],role="OPERATOR",deployment_epoch=recovery["epoch"],public_key_b64=f.keys[name]["public_key_b64"])
   f.seed_fixture_principal(record)
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
