#!/usr/bin/env python3
"""Preview refusal/fresh-image recovery plans; no live preview qualification."""
import copy,importlib.util,json,pathlib,subprocess,sys,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("blaxel_process",pathlib.Path(__file__).with_name("10_3.py"));p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
IDS=[];FAILED=[]
def check(name,fn):
 identity="blaxel.recovery."+name;IDS.append(identity)
 try:fn();actual="observed"
 except Exception as e:actual=type(e).__name__+": "+str(e);FAILED.append(identity)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def request():return {"source":"FRESH_IMAGE","authenticated_memory_present":False,"environment_changed":False,"retained_volumes":[],"checkpoint_digest":None}
def main():
 with tempfile.TemporaryDirectory(prefix="hyperfide-blaxel-recovery-")as td:
  f=p.Fixture(pathlib.Path(td),"10.4")
  def described():
   r=f.good("describe",{});p.expect(r["baseline"]=="FRESH_IMAGE_BOOT"and r["fresh_signed_enrollment_required"]and r["fresh_boot_generation_required"])
   p.expect(not r["inherited_authenticated_memory_permitted"]and not r["outward_action_before_fresh_enrollment"])
  check("service.fresh-image-enrollment-baseline",described)
  def fresh():
   r=f.good("plan",request());p.expect(r["candidate_compatible"]and r["authority"]=="NONE"and not r["outward_action_authorized"]and not r["credentials_restored"])
   steps=r["sequence"];p.expect(steps.index("FRESH_SIGNED_RUNNER_ENROLLMENT")<steps.index("ALLOW_OUTWARD_ACTION")and steps.index("VERIFY_OLD_CREDENTIALS_REVOKED")<steps.index("ALLOW_OUTWARD_ACTION"))
  check("plan.fresh-boot-before-outward-action",fresh)
  for feature in ["environment_updates","shared_storage"]:
   check("preview.default-disabled-"+feature,lambda feature=feature:f.bad("preview",{"feature":feature},"BLAXEL_PREVIEW_UNQUALIFIED"))
  for feature in ["memory_snapshot","memory_fork"]:
   check("preview.hard-disabled-"+feature,lambda feature=feature:f.bad("preview",{"feature":feature},"BLAXEL_AUTHENTICATED_CLONE_DISABLED"))
  for source in ["MEMORY_SNAPSHOT","MEMORY_FORK"]:
   def cloned(source=source):
    q=request();q["source"]=source;f.bad("plan",q,"BLAXEL_AUTHENTICATED_CLONE_DISABLED")
   check("clone.reject-"+source.lower(),cloned)
  def auth_memory():
   q=request();q["authenticated_memory_present"]=True;f.bad("plan",q,"BLAXEL_AUTHENTICATED_CLONE_DISABLED")
  check("clone.reject-authenticated-memory-on-fresh-label",auth_memory)
  def forge():
   q={"feature":"memory_fork","enabled":True,"qualification":{"status":"QUALIFIED"}}
   f.bad("preview",q,"BLAXEL_RECOVERY_INVALID")
  check("preview.caller-cannot-enable",forge)
  def disk():
   q=request();q.update(source="DISK_CHECKPOINT",checkpoint_digest="sha256:"+"a"*64)
   r=f.good("plan",q);p.expect("VERIFY_AND_RESTORE_DISK_CHECKPOINT"in r["sequence"]and not r["credentials_restored"]and not r["outward_action_authorized"])
  check("disk.restore-requires-independent-verification",disk)
  def missing():
   q=request();q["source"]="DISK_CHECKPOINT";f.bad("plan",q,"BLAXEL_RECOVERY_INVALID")
  check("disk.reject-unidentified-checkpoint",missing)
  def surprise():
   q=request();q["checkpoint_digest"]="sha256:"+"a"*64;f.bad("plan",q,"BLAXEL_RECOVERY_INVALID")
  check("disk.reject-silent-import-into-fresh-image",surprise)
  def volumes():
   q=request();q["retained_volumes"]=["retained-cache"];r=f.good("plan",q)
   p.expect(r["retained_volumes"]==[{"reference":"retained-cache","adopted":False,"mounted":False,"ownership":"UNVERIFIED","deleted_with_old_sandbox":False}])
   p.expect(r["sequence"].index("RECONCILE_RETAINED_VOLUMES")<r["sequence"].index("FRESH_SIGNED_RUNNER_ENROLLMENT"))
  check("volume.separate-lifetime-and-unverified-ownership",volumes)
  def duplicate():
   q=request();q["retained_volumes"]=["same","same"];f.bad("plan",q,"BLAXEL_RECOVERY_INVALID")
  check("volume.reject-duplicates",duplicate)
  def environment():
   q=request();q["environment_changed"]=True;r=f.good("plan",q);p.expect(r["environment_effect"]=="NEW_PROCESS_ENVIRONMENT_ONLY")
   p.expect(f.good("describe",{})["existing_process_environment"]=="UNCHANGED_UNTIL_EXPLICIT_PROCESS_RESTART")
  check("environment.existing-process-explicit",environment)
  def actual_environment():
   old={"HF_RECOVERY_VAR":"before"}
   child=subprocess.Popen([sys.executable,"-c","import os,sys;sys.stdin.read();sys.stdout.write(os.environ['HF_RECOVERY_VAR'])"],env=old,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
   old["HF_RECOVERY_VAR"]="after"
   result,_=child.communicate("",timeout=5)
   newer=subprocess.run([sys.executable,"-c","import os;print(os.environ['HF_RECOVERY_VAR'],end='')"],env=old,capture_output=True,text=True,timeout=5)
   p.expect(result=="before"and newer.stdout=="after"and child.returncode==0 and newer.returncode==0)
  check("environment.actual-existing-process-not-mutated",actual_environment)
  def memory_guard():
   script="import{createBlaxelRecoveryController}from"+json.dumps(str(ROOT/"services/hyperfide/dist/providers/blaxel/recovery.js"))+";let queried=0;const c=createBlaxelRecoveryController("+json.dumps(p.scope())+",{assertScope:async()=>{},readQualification:async()=>{queried++;throw Error('memory path touched qualification')},assertFreshEnrollment:async()=>{throw Error('enrollment must not run')}});for(const feature of['memory_snapshot','memory_fork']){try{await c.negotiate(feature);throw Error('clone enabled')}catch(e){if(e.code!=='BLAXEL_AUTHENTICATED_CLONE_DISABLED')throw e}}if(queried)throw Error('unsafe memory lookup');"
   r=subprocess.run(["node","--input-type=module","-e",script],capture_output=True,text=True,timeout=5);p.expect(r.returncode==0,r.stderr)
  check("controller.memory-path-disabled-before-evidence-lookup",memory_guard)

  f.close()
  # Fresh enrollment uses the real authority, signed HTTPS and owned primary
  # tables. RUNNING fixture state is a declared component precondition, not
  # physical provider readiness.
  secret_root=pathlib.Path(td)/"fresh-secrets";attachment_root=pathlib.Path(td)/"fresh-attachments"
  secret_root.mkdir(mode=0o700);attachment_root.mkdir(mode=0o700)
  credentials=pathlib.Path(td)/"fresh-credentials.json";credentials.write_text(json.dumps({"schema_version":1,"secret_root":str(secret_root),"attachment_root":str(attachment_root),"sources":[],"targets":[]}));credentials.chmod(0o600)
  selected={};added=set()
  def add(name):
   if name in added:return
   for dep in json.loads((ROOT/f"services/hyperfide/components/{name}.json").read_text())["requires"]:add(dep)
   added.add(name)
  add("10.4")
  def setup(auth):
   auth.apply_migration("0008-provider-coordination")
   account={"provider":"blaxel","account_key":"component-account","approved_limits":{"SANDBOX":"10","PROVISIONING":"2"},"planning_limits":{"SANDBOX":"10","PROVISIONING":"2"}}
   pool={"id":auth.ids["pool"],"provider":"blaxel","account_key":"component-account","environment_key":"component-workspace","region":"us-pdx-1","profile_id":None,"preparation_digest":auth.preparation,"approved_limits":{"SANDBOX":"10","PROVISIONING":"2"},"planning_limits":{"SANDBOX":"10","PROVISIONING":"2"},"create_policy":{"seed_reference":"sandbox/coding:"+"d"*64,"network":"ISOLATED","stdin_required":False}}
   config={"schema_version":1,"organisation_id":auth.ids["organisation"],"revision":"fresh-enrollment-component-v1","accounts":[account],"pools":[pool],"maximum_operation_ms":30000}
   config_path=auth.path/"pools.json";config_path.write_text(json.dumps(config));config_path.chmod(0o600);auth.env["HYPERFIDE_POOL_CONFIG"]=str(config_path)
   auth.sql("UPDATE hyperfide.provider_pools SET provider=$3,account_key=$4,environment_key=$5,region=$6 WHERE organisation_id=$1 AND id=$2",[auth.ids["organisation"],auth.ids["pool"],"blaxel","component-account","component-workspace","us-pdx-1"])
   selected.update({"organisation_id":auth.ids["organisation"],"pool_id":auth.ids["pool"],"provider":"blaxel","provider_account_id":"component-account","environment_id":"component-workspace","region":"us-pdx-1","configuration_digest":p.dg({"revision":config["revision"],"pool":pool,"account":account})})
  auth=p.identity.IdentityFixture(service_role="provisioner",extra_components=sorted(added),extra_env={"HF_CREDENTIAL_CONFIG_FILE":str(credentials)},extra_setup=setup)
  try:
   status,row=auth.invoke("provider.pools.configure",{},component="8.2",key="provisioner");p.expect(row.get("ok"),json.dumps(row))
   op=p.operation("create");op["scope"]=selected;op["preparation_digest"]=auth.preparation;p.rehash(op)
   auth.sql("INSERT INTO hyperfide.provisioning_intents(organisation_id,run_id,id,pool_id,sandbox_id,configuration_digest,kind,preparation_purpose,request_key,request_digest,payload_digest,operation,state,native_sandbox_id,boot_generation) VALUES($1,$2,$3,$4,$5,$6,'CREATE','EXECUTION',$7,$8,$9,$10,'ID_KNOWN','fixture-resource',1)",[auth.ids["organisation"],auth.ids["run"],auth.ids["intent"],auth.ids["pool"],auth.ids["sandbox"],selected["configuration_digest"],op["identity"]["idempotency_key"],p.dg(op),op["identity"]["payload_digest"],json.dumps(op)])
   target={"scope":selected,"resource":{"native_sandbox_id":"fixture-resource","sandbox_boot_generation":"1"}}
   def enrolled():
    auth.bootstrap_runner()
    _,registered=auth.invoke("identity.runner.register",{"preparation_digest":auth.preparation,"inventory":[]},key="runner");p.expect(registered.get("ok"),json.dumps(registered))
    _,result=auth.invoke("blaxel.recovery.enrollment",target,component="10.4",key="provisioner")
    p.expect(result.get("ok"),json.dumps(result));r=result["result"];p.expect(r["enrolled"]and not r["outward_action_authorized"]and r["authority"]=="NONE"and r["enrollment_digest"].startswith("sha256:"))
   check("enrollment.actual-signed-runner-consumed-grant-current-intent",enrolled)
   def wrong_boot():
    q=copy.deepcopy(target);q["resource"]["sandbox_boot_generation"]="2"
    _,result=auth.invoke("blaxel.recovery.enrollment",q,component="10.4",key="provisioner");p.expect(not result.get("ok"),json.dumps(result))
   check("enrollment.reject-other-boot",wrong_boot)
   def revoked():
    auth.sql("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",[auth.ids["runner"]])
    _,result=auth.invoke("blaxel.recovery.enrollment",target,component="10.4",key="provisioner");p.expect(not result.get("ok"),json.dumps(result))
   check("enrollment.reject-revoked-runner",revoked)
  finally:auth.close()
 print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
 return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
