#!/usr/bin/env python3
from pathlib import Path
import importlib.util,sys
spec=importlib.util.spec_from_file_location("domain21_tests",Path(__file__).with_name("21_4.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

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
     before(f);helper.ensure_semantic_fence_schema(f,service);f.sql((service/"migrations/0021-decisions.sql").read_text())
    kwargs["extra_setup"]=setup
    kwargs["extra_components"]+=["20.4","16.2","21.4","21.2"]
    super().__init__(*args,**kwargs)
  native.SessionIdentityFixture=ExtendedFixture
  try:
   f=native.AgentFixture(admission=True);f.bind()
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
   f.inner.sql("INSERT INTO hyperfide.checkpoints(organisation_id,run_id,id,attempt_id,attempt_generation,agent_session_id,artifact_id,repository_id,source_object_id,input_packet_digest,support_level) SELECT organisation_id,run_id,$1,attempt_id,attempt_generation,agent_session_id,artifact_id,repository_id,source_object_id,input_packet_digest,support_level FROM hyperfide.checkpoints WHERE id=$2",[native.uid(),f.inner.ids["checkpoint"]])
   check("native21.new-checkpoint-stale",lambda:native.expect(current(waiting["id"]).get("error",{}).get("code")=="DECISION_STALE","new preserved context was ignored"))
   check("native21.foreign-reservation-refused",lambda:native.expect(f.inner.invoke("decision.recovery.packet",{**request,"reservation_id":native.uid()},component="21.2")[1].get("ok")is False,"foreign reservation became recovery authority"))
   check("native21.compute-authority-unchanged",lambda:native.expect(f.inner.sql("SELECT compute_authority,execution_state FROM hyperfide.attempts WHERE id=$1",[f.inner.ids["attempt"]])[0]=={"compute_authority":"CURRENT","execution_state":"RUNNING"},"advisory capture changed compute authority"))
  except Exception as error:check("native21.setup",lambda:(_ for _ in()).throw(error))
  finally:
   if f:f.close("domain21-native-admission-database")
   identity.ROOT=old_identity_root
 return int(bool(failed))

if __name__=="__main__":sys.exit(module.run_task("21.2"))
