#!/usr/bin/env python3
from pathlib import Path
import importlib.util,json,os,subprocess,sys,tempfile,uuid
spec=importlib.util.spec_from_file_location("domain21_tests",Path(__file__).with_name("21_4.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ROOT=Path(__file__).resolve().parents[4];RESOURCE="domain21-native-admission-database"

def native_elf(executable):
 launcher=Path(executable).resolve()
 with launcher.open("rb") as handle:
  if handle.read(4)==b"\x7fELF":return launcher
 package=launcher.parent.parent
 for candidate in sorted(package.glob("node_modules/@openai/codex-*/vendor/*/bin/codex"))+sorted(package.glob("vendor/*/codex/codex")):
  with candidate.open("rb") as handle:
   if handle.read(4)==b"\x7fELF":return candidate
 raise AssertionError("installed native Codex ELF payload unavailable")

def native_admission_probe():
 """Actual13/14/PG+nativeCLI metadata; fixtures20/16 grant no production proof."""
 import importlib.util,json,os,shutil,tempfile,uuid,sys
 from pathlib import Path
 root=Path(__file__).resolve().parents[4]
 hspec=importlib.util.spec_from_file_location("domain21_helper",root/"tests/hyperfide/cases/tasks/21_4.py")
 helper=importlib.util.module_from_spec(hspec);hspec.loader.exec_module(helper)
 os.environ.update(helper.environment())
 spec=importlib.util.spec_from_file_location("domain21_native_fixture",root/"tests/hyperfide/cases/tasks/13_2.py")
 native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
 identity=sys.modules["identity_fixture"];old_identity_root=identity.ROOT
 failed=[];f=None
 def check(name,fn):
  try:fn();actual="observed"
  except Exception as error:failed.append(name);actual=type(error).__name__+": "+str(error)
  print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
 with tempfile.TemporaryDirectory(prefix="hf-domain21-native-") as folder:
  fixture_root=Path(folder);service=fixture_root/"services/hyperfide";service.mkdir(parents=True)
  for name in ["dist","migrations","components"]:shutil.copytree(root/"services/hyperfide"/name,service/name)
  shutil.copyfile(root/"services/hyperfide/package.json",service/"package.json")
  (service/"node_modules").symlink_to(root/"services/hyperfide/node_modules",target_is_directory=True)
  jobs="""import {readSemanticDisposition} from './storage/dispositions.js';const loaders=new Map();export function createComponent(){return {apiVersion:1,capabilities:{'decision.jobs.v1':{registerPurpose(p,l){loaders.set(p,l)},completedAudit(){return {available:false,reason:'missing'}}}},actions:{'fixture.jobs.current':async(input,ctx)=>ctx.resources.gateway.withPrimaryTransaction({guard:async tx=>{await readSemanticDisposition(tx,ctx.invocation.principal);await ctx.invocation.guard(tx)}},async tx=>{const p=await loaders.get('recovery').load(tx,ctx.invocation,{packet_id:input.packet_id});await loaders.get('recovery').current(tx,{organisation_id:ctx.invocation.principal.organisation_id,run_id:ctx.invocation.principal.run_id},p.packet,ctx.invocation);return {authority:'NONE',fresh:true,packet_id:p.packet.id}})}}}"""
  (service/"dist/fixture-recovery-jobs.js").write_text(jobs)
  (service/"dist/fixture-no-assurance.js").write_text("export function createComponent(){return {apiVersion:1,capabilities:{'assurance.execution.v1':{inspectExecutionReceipt(){throw Error('No assurance producer qualification in native metadata fixture')}}},actions:{'fixture.assurance.describe':()=>({authority:'NONE'})}}}")
  for ident,module,action in [("20.4","fixture-recovery-jobs.js","fixture.jobs.current"),("16.2","fixture-no-assurance.js","fixture.assurance.describe")]:
   (service/"components"/(ident+".json")).write_text(json.dumps({"schema_version":1,"id":ident,"task":ident,"roles":["control"],"module":module,"entry":"createComponent","api_version":1,"actions":[action],"requires":[]}))
  identity.ROOT=fixture_root;native.ROOT=fixture_root
  original=native.SessionIdentityFixture
  class ExtendedFixture(original):
   def __init__(self,*args,**kwargs):
    before=kwargs["extra_setup"]
    def setup(f):
     before(f)
     # Trusted config written by the shared 13.2 setup must be owner-only before the actual loaders read it.
     profiles=f.path/"native-profiles.json"
     if profiles.is_file():
      # Current 14.x native-auth contract pins the configured account; the shared 13.2 profile predates it.
      inventory=json.loads(profiles.read_text())
      for item in inventory["profiles"]:
       item.setdefault("configured_account_key","fixture-account")
       # 14.x pins the installed native ELF payload, never the npm launcher shim 13.2 resolves.
       elf=native_elf(item["binary"]["path"]);item["binary"]["path"]=str(elf);item["binary"]["digest"]=native.sha(elf.read_bytes())
      profiles.write_text(json.dumps(inventory))
     for name in ["credential-store.json","native-profiles.json","admission.json"]:
      if (f.path/name).is_file():(f.path/name).chmod(0o600)
     helper.ensure_semantic_fence_schema(f,service);helper.apply_advisory_fixture_migration(f,"0021-decisions",service)
    kwargs["extra_setup"]=setup
    kwargs["extra_components"]+=["20.4","16.2","21.4","21.2"]
    super().__init__(*args,**kwargs)
   def sql(self,query,values=None,**kwargs):
    # The complete release ledger already holds 13.2's foundation migrations; skip a replay only on an identical checksum pin.
    import re
    pinned=re.search(r"INSERT INTO hyperfide\.schema_migrations\(version,name,checksum\) VALUES\((12|13),'([0-9a-z-]+)','(sha256:[0-9a-f]{64})'\);",query) if query.startswith("BEGIN;\n") else None
    if pinned and not values:
     recorded=super().sql("SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=$1",[int(pinned.group(1))])
     if recorded==[{"name":pinned.group(2),"checksum":pinned.group(3)}]:return []
    return super().sql(query,values,**kwargs)
  native.SessionIdentityFixture=ExtendedFixture
  try:
   f=native.AgentFixture(admission=True)
   f.profile=json.loads(f.profile_path.read_text())["profiles"][0];f.configuration=native.sha(json.dumps(f.profile,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode())
   f.binding["configuration_digest"]=f.checkpoint["configuration_digest"]=f.configuration
   f.bind()
   org,run=f.scope["organisation_id"],f.scope["run_id"];scope={"organisation_id":org,"run_id":run};reservation=native.uid()
   policy=f.admission_policy["policies"][0];policy_digest=native.sha(json.dumps(policy,sort_keys=True,separators=(",",":")).encode())
   reserve={"scope":f.scope,"reservation_id":reservation,"quota_key":"fixture-quota"}
   f.inner.sql("INSERT INTO hyperfide.agent_admission_accounts(organisation_id,run_id,quota_key,policy_digest,max_concurrent,active) VALUES($1,$2,'fixture-quota',$3,1,1)",[org,run,policy_digest])
   f.inner.sql("INSERT INTO hyperfide.agent_admission_reservations(organisation_id,run_id,id,quota_key,session_id,payload_digest,policy_digest,state) VALUES($1,$2,$3,'fixture-quota',$4,$5,$6,'RESERVED')",[org,run,reservation,f.scope["session_id"],native.sha(json.dumps(reserve,sort_keys=True,separators=(",",":")).encode()),policy_digest])
   request={"scope":scope,"attempt_id":f.inner.ids["attempt"],"session_id":f.scope["session_id"],"reservation_id":reservation}
   def packet():
    status,row=f.inner.invoke("decision.recovery.packet",request,component="21.2");native.expect(row.get("ok") is True,"actual native-bound packet refused: "+str(row.get("error",{})));return row["result"]
   p=packet()
   check("native21.same-primary-context",lambda:native.expect(p["state"]["admission_context"]["attempt_id"]==f.inner.ids["attempt"],"native attempt binding lost"))
   check("native21.policy-domains-distinct",lambda:native.expect(p["state"]["admission_context"]["policy_digest"]==policy_digest and p["state"]["primary_revision"]["policy_digest"]!=policy_digest,"admission and accepted run policy confused"))
   check("native21.no-unproved-retry-or-profile",lambda:native.expect(p["state"]["retry_permitted"]is False and p["state"]["frontier_profile_ids"]==[] and p["state"]["condition_change_proof"]=="UNAVAILABLE","unqualified native profile or reported condition granted retry"))
   def current(packet_id):return f.inner.invoke("fixture.jobs.current",{"packet_id":packet_id},component="20.4")[1]
   check("native21.unchanged-context-fresh",lambda:native.expect(current(p["id"]).get("result",{}).get("fresh")is True,"stable native snapshot rejected"))
   f.ok("agent.admission.report",{"scope":f.scope,"reservation_id":reservation,"operation_id":native.uid(),"reason":"RATE_LIMIT","diagnostic_refs":[f.inner.ids["artifact"]],"condition_digest":native.sha(b"reported-only")} ,component="13.4")
   check("native21.changed-native-context-stale",lambda:native.expect(current(p["id"]).get("error",{}).get("code")=="DECISION_STALE","changed admission snapshot retained model freshness"))
   waiting=packet()
   check("native21.capacity-classified-not-stall",lambda:native.expect(waiting["state"]["waiting_for_capacity"]is True and waiting["state"]["capacity_wait"]["status"]=="PROVIDER_RATE_LIMIT" and waiting["state"]["retry_permitted"]is False,"capacity wait was confused with stalled implementation"))
   def repeat_preserved():
    prior=waiting["state"]["prior_failure_evidence"]
    native.expect(p["state"]["prior_failure_evidence"]is None and p["state"]["changed_conditions"]==[],"first capture invented prior evidence")
    native.expect(prior["packet_id"]==p["id"] and prior["packet_hash"]==p["packet_hash"] and prior["checkpoints"]==p["state"]["checkpoints"] and len(prior["checkpoints"])>=1 and prior["attempt"]["id"]==f.inner.ids["attempt"],"repeat lost prior failure checkpoints")
    native.expect(prior["assurance_context"]is None and prior["capacity_wait"]==p["state"]["capacity_wait"],"repeat altered prior receipt/capacity evidence")
   check("native21.repeat-preserves-prior-evidence",repeat_preserved)
   check("native21.repeat-identifies-change",lambda:native.expect("admission_context"in waiting["state"]["changed_conditions"] and "capacity_wait"in waiting["state"]["changed_conditions"] and "checkpoints"not in waiting["state"]["changed_conditions"] and waiting["state"]["repeat_without_change"]is False and waiting["state"]["retry_permitted"]is False and waiting["state"]["condition_change_proof"]=="UNAVAILABLE","repeat did not record what changed or treated observed change as retry proof"))
   f.inner.sql("INSERT INTO hyperfide.checkpoints(organisation_id,run_id,id,attempt_id,attempt_generation,agent_session_id,artifact_id,repository_id,source_object_id,input_packet_digest,support_level) SELECT organisation_id,run_id,$1,attempt_id,attempt_generation,agent_session_id,artifact_id,repository_id,source_object_id,input_packet_digest,support_level FROM hyperfide.checkpoints WHERE id=$2",[native.uid(),f.inner.ids["checkpoint"]])
   check("native21.new-checkpoint-stale",lambda:native.expect(current(waiting["id"]).get("error",{}).get("code")=="DECISION_STALE","new preserved context was ignored"))
   def repeat_checkpoint():
    again=packet();prior=again["state"]["prior_failure_evidence"]
    native.expect(prior["packet_id"]==waiting["id"] and prior["checkpoints"]==waiting["state"]["checkpoints"] and "checkpoints"in again["state"]["changed_conditions"] and len(again["state"]["checkpoints"])==len(prior["checkpoints"])+1,"new checkpoint not identified against preserved prior evidence")
   check("native21.repeat-new-checkpoint-identified",repeat_checkpoint)
   check("native21.foreign-reservation-refused",lambda:native.expect(f.inner.invoke("decision.recovery.packet",{**request,"reservation_id":native.uid()},component="21.2")[1].get("ok")is False,"foreign reservation became recovery authority"))
   check("native21.compute-authority-unchanged",lambda:native.expect(f.inner.sql("SELECT compute_authority,execution_state FROM hyperfide.attempts WHERE id=$1",[f.inner.ids["attempt"]])[0]=={"compute_authority":"CURRENT","execution_state":"RUNNING"},"advisory capture changed compute authority"))
   check("native21.setup",lambda:None)
  except Exception as error:check("native21.setup",lambda:(_ for _ in()).throw(error))
  finally:
   if f:f.close(RESOURCE)
   else:print(json.dumps({"type":"cleanup","complete":False,"resources":[{"id":RESOURCE,"status":"unknown","observed_absent":False}]}),flush=True)
   identity.ROOT=old_identity_root
 return int(bool(failed))

def emit(name,ok,detail):
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":"observed" if ok else detail}),flush=True);return 0 if ok else 1

def repeat_receipt_probe():
 """Pure repeat contract for a preserved 16.2 receipt; the receipt fixture grants no assurance proof."""
 script="import {recoveryRepeat} from "+json.dumps((ROOT/"services/hyperfide/dist/decisions/recovery.js").as_uri())+";const id=n=>'40000000-0000-0000-0000-'+String(n).padStart(12,'0'),h='sha256:'+'b'.repeat(64);const receipt={receipt_digest:h,current_job_generation:'1',state:'COMPLETED',outcome:'FAILED',source_origin:'SUBMITTED_RESULT'};const prior={id:id(1),packet_hash:h,created_at:new Date(0).toISOString(),state:{attempt:{id:id(2),task_id:id(3),generation:'1',state_version:'4'},checkpoints:[{id:id(5)}],assurance_reference:{job_id:id(6),lease_generation:'1'},assurance_context:receipt,failure_evidence_origin:'SUBMITTED_ATTEMPT_RESULT',capacity_wait:{status:'NONE'}}};const next={attempt:{id:id(7),task_id:id(3),generation:'2',state_version:'1'},checkpoints:[{id:id(5)}],capacity_wait:{status:'NONE'}};const r=recoveryRepeat(prior,next),same=recoveryRepeat(prior,prior.state);process.stdout.write(JSON.stringify({r,same,none:recoveryRepeat(null,next)}));"
 run=subprocess.run(["node","--input-type=module","-e",script],cwd=ROOT,text=True,capture_output=True,timeout=30)
 try:
  data=json.loads(run.stdout);r=data["r"];e=r["prior_failure_evidence"]
  ok=e["assurance_context"]["receipt_digest"]=="sha256:"+"b"*64 and e["assurance_reference"]["lease_generation"]=="1" and e["checkpoints"]==[{"id":"40000000-0000-0000-0000-000000000005"}] and r["changed_conditions"]==["attempt_replaced","assurance_context"] and data["same"]["changed_conditions"]==[] and data["none"]=={"prior_failure_evidence":None,"changed_conditions":[]}
  detail="repeat lost receipt/checkpoints or misreported change: "+run.stdout[-800:]
 except Exception as error:ok=False;detail=type(error).__name__+": "+str(error)+" "+run.stderr[-800:]
 return emit("recovery.repeat-preserves-receipt",ok,detail)

def triage_probe():
 """Legacy triage in distributed authority: explicit purpose route, no local Jev fallback (21.4 producer still absent)."""
 cg=ROOT/"cg";status=0
 if not cg.is_file() or cg.stat().st_mtime<(ROOT/"src/spec.c").stat().st_mtime:
  return emit("recovery.triage-distributed-explicit",False,"cg binary absent or older than src/spec.c")|emit("recovery.triage-legacy-local-refused",False,"cg binary absent or stale")
 with tempfile.TemporaryDirectory(prefix="hf-domain21-triage-") as folder:
  base=Path(folder);(base/".hyperfide").mkdir(mode=0o700)
  descriptor=base/".hyperfide/authority.json";descriptor.write_text(json.dumps({"schema_version":1,"mode":"distributed","authority_epoch":str(uuid.uuid4())}));descriptor.chmod(0o600)
  (base/"in.json").write_text(json.dumps({"task":"21.2","exit_code":1,"failure_tail":"fixture failure","authority":"NONE"}))
  env={k:v for k,v in os.environ.items() if not k.startswith("HYPERFIDE_") and not k.startswith("HF_")};ident=str(uuid.uuid4())
  r=subprocess.run([str(cg),"spec","triage","--run-id",ident,"--operation-id",ident,"--idempotency-key",ident,"--correlation-id",ident,"--input-file","in.json"],cwd=base,env=env,text=True,capture_output=True,timeout=30)
  try:row=json.loads((r.stdout or r.stderr).strip().splitlines()[-1])
  except Exception:row={}
  status|=emit("recovery.triage-distributed-explicit",r.returncode!=0 and row.get("ok") is False and row.get("local_fallback") is False and "jev triage" not in r.stdout+r.stderr,"triage was not explicit/bounded: "+str((r.returncode,r.stdout[-400:],r.stderr[-400:])))
  d=subprocess.run([str(cg),"spec","done","21.2"],cwd=base,env=env,text=True,capture_output=True,timeout=30)
  status|=emit("recovery.triage-legacy-local-refused",d.returncode==78 and "jev triage" not in d.stdout+d.stderr and '"local_fallback":false' in d.stdout+d.stderr and sorted(p.name for p in base.iterdir())==[".hyperfide","in.json"],"distributed legacy done reached local triage/store: "+str((d.returncode,d.stdout[-400:],d.stderr[-400:])))
 return status

def main():
 import contextlib,io
 buffer=io.StringIO()
 with contextlib.redirect_stdout(buffer):status=module.run_task("21.2")
 for line in buffer.getvalue().splitlines():
  try:event=json.loads(line)
  except ValueError:event=None
  # The run emits one cleanup event: the native probe's resource-bearing one.
  if isinstance(event,dict) and event.get("type")=="cleanup":
   if event.get("complete") is not True or event.get("resources"):status=1
   continue
  print(line,flush=True)
 status|=repeat_receipt_probe()
 status|=triage_probe()
 status|=native_admission_probe()
 return int(bool(status))

def cleanup():
 os.environ.update(module.environment())
 spec=importlib.util.spec_from_file_location("domain21_native_cleanup",ROOT/"tests/hyperfide/cases/tasks/13_2.py")
 native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
 target=native.cleanup_state(RESOURCE)
 if target is None or not target.exists():return 0
 return native.cleanup_only(RESOURCE)

if __name__=="__main__":sys.exit(cleanup() if "--cleanup" in sys.argv else main())
