#!/usr/bin/env python3
"""Execution packets through real signed HTTPS; reusable declarative input fixture."""
from __future__ import annotations
import hashlib,importlib.util,json,sys,time,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("hf_hierarchy_fixture",ROOT/"tests/hyperfide/cases/tasks/3_1.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
HierarchyFixture=module.HierarchyFixture;apply_migration=module.apply_migration
uid=module.uid;sha=module.sha
FAILED=[]
def expect(value,message):
 if not value:raise AssertionError(message)
def check(identity,fn):
 try:fn();actual="observed"
 except Exception as error:FAILED.append(identity);actual=type(error).__name__+": "+str(error)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False)
def identity(value):return sha(canonical(value).encode())
def dependencies(stems):
 fragments={}
 for p in (ROOT/"services/hyperfide/components").glob("*.json"):
  f=json.loads(p.read_text())
  if "id" in f:fragments[f["id"]]=(p.stem,f.get("requires",[]))
 result=[];seen=set()
 def visit(stem):
  f=json.loads((ROOT/"services/hyperfide/components"/(stem+".json")).read_text())
  if f["id"] in seen:return
  seen.add(f["id"])
  for dep in f.get("requires",[]):visit(fragments[dep][0])
  result.append(stem)
 for stem in stems:visit(stem)
 return tuple(result)
RUBRIC=sha(b"explicit-review-rubric")
def parse_kvx(source):
 return json.loads(subprocess.check_output(["node","--input-type=module","-e","import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT))
def accept_spec(f,generation,criterion="A task packet SHALL identify exact inputs. Mandatory intent and constraints SHALL not be removed by context ranking."):
 """Accepted immutable spec revision whose proof/review intent the 2.4 obligation loader verifies."""
 i=f.ids;spec=uid()
 source="[meta]\nslug = \"packet-fixture-g%d\"\n[req.3]\nac_2 = %s\n[acceptance.packet-intent]\nreq = \"3.2\"\n[proof]\nrubric_digest = %s\n[proof.review.3.2]\nreviewers = %s\nrubric_digest = %s\n[task.packet]\nwave = 2\nreqs = [\"3.2\"]\nacceptance_ids = [\"packet-intent\"]\n"%(generation,json.dumps(criterion),json.dumps(RUBRIC),json.dumps([i["watcher"]]),json.dumps(RUBRIC))
 parsed=parse_kvx(source)
 intent={"schema_version":1,"revision_digest":sha(("packet-envelope-%d"%generation).encode()),"source_digest":sha(source.encode()),"repositories":[{"repository_id":i["repository"],"source_object_id":f.source,"integration_ref":"refs/heads/main"}],"allowed_actions":f.actions,"closure_policy":{"required_evidence":[],"required_review_roles":[],"publication":"AFTER_QUALIFICATION"},"provenance":None,"parsed":parsed,"runtime_wave_offset":0}
 f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[i["organisation"],i["project"],spec,sha(source.encode()),source,json.dumps(intent),intent["revision_digest"]])
 f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$3,$4)",[i["organisation"],i["run"],generation,spec])
 section=next(x for x in parsed["sections"] if x["name"]=="task.packet")
 return spec,section,identity({"reqs":["3.2"],"accepted_text":criterion})
def move_run(f,generation,spec,state):
 f.sql("UPDATE hyperfide.runs SET spec_generation=$3,spec_revision_id=$4,state=$5,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[f.ids["organisation"],f.ids["run"],generation,spec,state])
def prepared_slot(f,key,commit):
 """Immutable preparation manifest + pool/sandbox/READY slot for one declared profile."""
 i=f.ids;i[key+"_profile"]=uid();i[key+"_pool"]=uid();i[key+"_sandbox"]=uid();i[key+"_slot"]=uid()
 profile={"schema_version":1,"profile_id":i[key+"_profile"],"profile_version":"1.0.0",
  "os":{"distribution":"debian","version":"12","architecture":"x86_64"},
  "image":{"provider":"fixture","reference":"fixture:1.0","digest":None},
  "resources":{"cpu_millis":4000,"memory_bytes":"8589934592","disk_bytes":"21474836480","persistent_volume_bytes":"0"},
  "toolchains":[{"name":"node","version":"24.0.0"}],
  "package_managers":[{"name":"npm","version":"11.0.0","locks":[{"path":"package-lock.json","digest":sha(b"lock")}]}],
  "native_agents":[{"name":"codex","version":"1.0.0"}],"connectors":[{"name":"codex","version":"1.0.0"}],
  "supervisor":{"name":"supervisor","version":"1.0.0"},"hyperfide":{"version":"2.0.0"},
  "system_packages":[],"repositories":[{"id":i["repository"],"url":"https://example.invalid/fixture.git","commit":commit,"submodules":[],"lfs":False}],
  "recipe":{"path":"prepare.sh","digest":sha(b"recipe")},"generated_inputs":[],"build_config":[],
  "caches":[],"required_capabilities":["processes"],"network":{"routes":[],"registries":[]},"credential_references":["fixture-model-account"],
  "policy":{"max_process_lifetime_seconds":259200,"expires_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+3600)),"rebuild_on":["source"]},
  "preparation_evidence":[{"path":"scan.json","digest":sha(("declarative-fixture-scan:"+key).encode())}]}
 body={"schema_version":1,"profile":profile,"files":[],"directories":[],"scan":{"policy_version":1,"canary_counts":{"secret":0,"identity":0,"lease":0},"checks":["sensitive_paths","private_key_markers","authority_json","designated_canaries"]}}
 preparation=identity(body);manifest=dict(body,digest=preparation)
 f.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,id,content_digest,provider,runtime_platform,manifest) VALUES($1,$2,$3,'fixture','linux',$4)",[i["organisation"],i[key+"_profile"],preparation,json.dumps(manifest)])
 f.sql("INSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region,profile_id) VALUES($1,$2,'fixture','fixture',$3,'fixture',$4)",[i["organisation"],i[key+"_pool"],key+"-fixture",i[key+"_profile"]])
 f.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state,preparation_digest) VALUES($1,$2,$3,$4,'RUNNING',$5)",[i["organisation"],i[key+"_sandbox"],i[key+"_pool"],key+"-fixture-resource",preparation])
 f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,$4,1,'AGENT','READY')",[i["organisation"],i[key+"_slot"],i[key+"_sandbox"],key+"-slot"])
 return preparation
class PacketFixture(HierarchyFixture):
 def __init__(self,extra_components=(),extra_setup=None,bootstrap=True,seed_historical_runtime=True,extra_env=None,source_object_id=None):
  def setup(f):
   apply_migration(f,"0002-spec");apply_migration(f,"0007-graph");apply_migration(f,"0032-execution-packets")
   i=f.ids;f.source=source_object_id or "a"*40
   f.preparation=prepared_slot(f,"packet",f.source)
   i["profile"]=i["packet_profile"];i["pool"]=i["packet_pool"];i["sandbox"]=i["packet_sandbox"];i["packet_slot"]=i["packet_slot"]
   i["boot"]=f.sql("SELECT boot_id FROM hyperfide.sandbox_boots WHERE organisation_id=$1 AND sandbox_id=$2",[i["organisation"],i["sandbox"]])[0]["boot_id"]
   spec,f.packet_section,f.packet_criteria=accept_spec(f,2)
   i["packet_spec"]=spec;move_run(f,2,spec,"RUNNING")
   f.packet_definition=f.task_definition()
   i["packet_task"]=f.insert_task("alpha.packet",f.packet_definition)
   f.packet_proof=f.proof_policy(f.packet_criteria)
   f.register_proof(i["packet_task"],f.packet_proof)
   if extra_setup:extra_setup(f)
  super().__init__(extra_components=dependencies(("3.2",)+tuple(extra_components)),extra_setup=setup,bootstrap=bootstrap,seed_historical_runtime=seed_historical_runtime,extra_env=extra_env,source_object_id=source_object_id)
 def task_definition(self,section=None,**overrides):
  """Accepted spec section envelope (as imported by 2.x) plus the explicit packet intent fields."""
  return dict({"schema_version":1,"section":section or self.packet_section,"feature_key":"alpha","declared_wave":2,"runtime_wave_offset":0,"declared_status":None,"history_only":True,
   "purpose":"Actual immutable execution input fixture","touches":["src/fixture.ts"],
   "environment_profile_id":self.ids["profile"],"resource_requirements":{"agent_sessions":1,"cpu_millis":1000,"memory_bytes":"2147483648","disk_bytes":"4294967296","build_slots":1,"test_slots":1,"max_descendants":2},
   "execution_profile":{"connector":"codex","model_profile_ref":"fixture-frontier","credential_profile_ref":"fixture-model-account","timeout_seconds":3600},
   "contract_inputs":[],"graph_inputs":{"required":False,"manifest_id":None,"reason":"Accepted fixture has no graph-dependent analysis"}},**overrides)
 def insert_task(self,key,definition,criteria=None,generation=2,spec=None):
  i=self.ids;task=uid()
  self.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,2)",[i["organisation"],i["run"],task,key,i["package2"],spec or i["packet_spec"],generation,criteria or self.packet_criteria,json.dumps(definition)])
  return task
 def proof_policy(self,criteria,generation=2,spec=None):
  i=self.ids
  return {"schema_version":1,"criteria_digest":criteria,"spec_revision_id":spec or i["packet_spec"],"spec_generation":str(generation),"repository_id":i["repository"],"source_object_id":self.source,
   "rubric_digest":RUBRIC,"checks":[],"clauses":[{"id":"3.2","mode":"REVIEW","acceptance_ids":["packet-intent"],"reviewers":[i["watcher"]],"rubric_digest":RUBRIC}],
   "inputs":{k:sha(("accepted-"+k).encode()) for k in ["source","dependency","toolchain","configuration","graph","contract"]},"contract_digests":[]}
 def register_proof(self,task,policy):
  i=self.ids
  self.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[i["organisation"],i["run"],task,int(policy["spec_generation"]),policy["spec_revision_id"],policy["criteria_digest"],identity(policy),json.dumps(policy)])
 def accepted_task(self,key,**overrides):
  task=self.insert_task(key,self.task_definition(**overrides));self.register_proof(task,self.packet_proof);return task
 def packet_input(self,**overrides):
  return dict({"idempotency_key":"packet-create","leader_generation":"1","package_generation":"2","task_id":self.ids["packet_task"],"attempt_id":uid(),"attempt_generation":"1","sandbox_id":self.ids["sandbox"],"slot_id":self.ids["packet_slot"],"sandbox_boot_generation":"1","max_bytes":262144,"optional_context":[]},**overrides)
 def create_packet(self,**overrides):
  return self.ok("hierarchy.packet.create",self.packet_input(**overrides),key="manager",component="3.2")
 def refuse_packet(self,code,**overrides):
  return self.reject("hierarchy.packet.create",self.packet_input(**overrides),code,key="manager",component="3.2")
 def validate(self,digest):
  return self.ok("hierarchy.packet.validate",{"leader_generation":"1","package_generation":"2","digest":digest},key="manager",component="3.2")
 def stale(self,digest,reason):
  response=self.reject("hierarchy.packet.validate",{"leader_generation":"1","package_generation":"2","digest":digest},"EXECUTION_INPUTS_STALE",key="manager",component="3.2")
  expect(reason in response["error"]["message"],"Stale refusal did not identify the changed input class: "+response["error"]["message"])
  return response
def without_attempt(mandatory):
 value=json.loads(json.dumps(mandatory));value["identity"]["attempt_id"]=None;return value
def main():
 state={};negative={};changes={}
 def setup(f):
  i=f.ids
  # Accepted task variants, each missing exactly one mandatory identity/input.
  negative["scope"]=f.accepted_task("alpha.no-scope",touches=[])
  negative["proof"]=f.insert_task("alpha.no-proof",f.task_definition())
  negative["contract"]=f.accepted_task("alpha.absent-contract",contract_inputs=[{"contract_id":uid(),"revision":"1","criteria_digest":sha(b"absent-contract")}])
  negative["graph"]=f.accepted_task("alpha.graph-undeclared",graph_inputs={"required":"unknown","manifest_id":None,"reason":None})
  negative["dependency"]=f.accepted_task("alpha.unqualified-dependency")
  f.sql("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone) VALUES($1,$2,$3,$2,$4,'QUALIFIED')",[i["organisation"],i["run"],negative["dependency"],i["task"]])
  f.prepared_source_mismatch=prepared_slot(f,"mismatch","b"*40)
  negative["environment_source"]=f.accepted_task("alpha.profile-source-mismatch",environment_profile_id=i["mismatch_profile"])
  # Independently changeable input classes for V-014 / V-001.
  i["contract"]=uid();f.contract_criteria=sha(b"contract-r1")
  f.sql("INSERT INTO hyperfide.contracts(organisation_id,run_id,id,contract_key,revision,criteria_digest,definition,owner_package_id) VALUES($1,$2,$3,'api.packet',1,$4,$5,$6)",[i["organisation"],i["run"],i["contract"],f.contract_criteria,json.dumps({"interface":"packet.v1"}),i["package2"]])
  changes["contract"]=f.accepted_task("alpha.contract-bound",contract_inputs=[{"contract_id":i["contract"],"revision":"1","criteria_digest":f.contract_criteria}])
  changes["dependency"]=f.accepted_task("alpha.dependency-change")
  changes["amend"]=f.accepted_task("alpha.amended-intent")
 f=PacketFixture(extra_setup=setup);i=f.ids
 try:
  request=f.packet_input()
  check("packet.create.signed",lambda:state.update(f.ok("hierarchy.packet.create",request,key="manager",component="3.2")))
  packet=state.get("packet",{})
  check("packet.no-execution-authority",lambda:expect(packet.get("execution_authority") is False and f.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE id=$1",[request["attempt_id"]])[0]["n"]==0,"Prospective packet granted compute or created an attempt"))
  def exact_identity():
   ident=packet["mandatory"]["identity"]
   expect(ident["attempt_id"]==request["attempt_id"] and ident["attempt_generation"]=="1" and ident["run_id"]==i["run"] and ident["task_id"]==i["packet_task"] and ident["spec_revision_id"]==i["packet_spec"] and ident["spec_generation"]=="2"
    and ident["parent_session_id"]==i["manager"] and ident["accountable_manager_session_id"]==i["manager"] and ident["package_generation"]=="2" and ident["leader_generation"]=="1","Accepted run/spec/task/attempt/generation/parent/manager pins missing")
  check("packet.exact-identity",exact_identity)
  def mandatory_intent():
   m=packet["mandatory"]
   expect(m["intent"]["definition"]==f.packet_definition and m["intent"]["owned_scope"]==["src/fixture.ts"] and m["intent"]["proof_policy"]==f.packet_proof and m["intent"]["proof_obligations"][0]["clause_id"]=="3.2"
    and m["inputs"]["repositories"]==[{"repository_id":i["repository"],"source_object_id":f.source,"integration_ref":"refs/heads/main"}] and m["inputs"]["contracts"]==[] and m["inputs"]["dependencies"]==[],"Mandatory accepted intent/scope/evidence/source inputs were reduced")
  check("packet.complete-mandatory-intent",mandatory_intent)
  check("packet.manifest-runtime-resource-pins",lambda:expect(packet["mandatory"]["runtime"]["preparation_digest"]==f.preparation and packet["mandatory"]["runtime"]["slot_id"]==i["packet_slot"] and packet["mandatory"]["resource_requirements"]==f.packet_definition["resource_requirements"],"Environment/resource/slot pins differ"))
  check("packet.canonical-digests",lambda:expect(identity(packet)==state["digest"] and identity(packet["mandatory"])==state["mandatory_digest"],"Packet digest does not bind immutable bytes"))
  check("packet.exact-replay",lambda:expect(f.ok("hierarchy.packet.create",request,key="manager",component="3.2")["digest"]==state["digest"],"Replay rebuilt immutable packet"))
  check("packet.conflicting-replay",lambda:f.reject("hierarchy.packet.create",dict(request,max_bytes=262143),"IDEMPOTENCY_CONFLICT",key="manager",component="3.2"))
  check("packet.generation-race-refused",lambda:f.refuse_packet("ATTEMPT_GENERATION_STALE",idempotency_key="generation-race",attempt_generation="2"))
  check("packet.stale-package-refused",lambda:f.refuse_packet("PACKAGE_GENERATION_STALE",idempotency_key="stale-package",package_generation="1"))
  check("packet.role-denied",lambda:f.reject("hierarchy.packet.create",f.packet_input(idempotency_key="watcher"),"ROLE_DENIED",key="watcher",component="3.2"))
  check("packet.scope-spoof-denied",lambda:f.reject("hierarchy.packet.create",dict(f.packet_input(),organisation_id=uid()),"INVALID_REQUEST",key="manager",component="3.2"))
  check("packet.inspect.exact",lambda:expect(f.ok("hierarchy.packet.inspect",{"leader_generation":"1","package_generation":"2","digest":state["digest"]},key="manager",component="3.2")["packet"]==packet,"Reader changed exact packet"))
  CURRENT=["IMMUTABLE_PACKET","CURRENT_ACCEPTED_TASK","CURRENT_AUTHORITY_EPOCH","ACCEPTED_ENVIRONMENT_MANIFEST","CURRENT_SOURCE_PINS","CURRENT_DEPENDENCY_CUSTODY","CURRENT_CONTRACT_REVISIONS","GRAPH_EXPLICITLY_NOT_REQUIRED"]
  def validate_inputs():
   actual=f.validate(state["digest"])
   expect(actual["packet"]==packet and actual["execution_authority"] is False and actual["checked_inputs"]==CURRENT,"Current-input validation changed immutable pins, skipped an input class or granted authority: "+json.dumps(actual.get("checked_inputs")))
  check("packet.inputs.validate.signed",validate_inputs)
  def prepared_roles():
   manifest=f.sql("SELECT manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["profile"]])[0]["manifest"]
   def derive(value):return f.ok("hierarchy.packet.derive",{"leader_generation":"1","package_generation":"2","digest":state["digest"],"manifest":value},key="manager",component="3.2")
   def refused(value):f.reject("hierarchy.packet.derive",{"leader_generation":"1","package_generation":"2","digest":state["digest"],"manifest":value},"ENVIRONMENT_PROFILE_INVALID",key="manager",component="3.2")
   def rehash(value):value["digest"]=identity({k:v for k,v in value.items() if k!="digest"});return value
   original=derive(manifest)
   expect(original["authority"]=="NONE" and original["roles"]["preparation_digest"]==f.preparation and original["roles"]["configuration_digest"]==original["baseline"]["configuration_digest"] and original["roles"]["toolchain_digest"]==original["baseline"]["toolchain_digest"],"Shared pure preimages differ from accepted baseline")
   changed=json.loads(json.dumps(manifest));changed["profile"]["profile_version"]="2.0.0";rehash(changed)
   actual=derive(changed)["roles"]
   expect(actual["configuration_digest"]!=original["roles"]["configuration_digest"] and actual["preparation_digest"]!=f.preparation and actual["toolchain_digest"]==original["roles"]["toolchain_digest"] and actual["authority"]=="NONE","New prepared bytes reused old configuration or granted readiness")
   toolchain=json.loads(json.dumps(manifest));toolchain["profile"]["toolchains"]=[{"name":"node","version":"24.1.0"}];rehash(toolchain)
   expect(derive(toolchain)["roles"]["toolchain_digest"]!=original["roles"]["toolchain_digest"],"Toolchain change did not change the toolchain evidence class")
   version2=json.loads(json.dumps(manifest));version2.update(schema_version=2,symlinks=[],hardlinks=[]);rehash(version2)
   v2roles=derive(version2)["roles"]
   expect(v2roles["preparation_digest"]==version2["digest"] and v2roles["configuration_digest"]!=original["roles"]["configuration_digest"],"V2 complete inventory schema was dropped or relabelled as V1")
   version2["symlinks"]=[{"path":"linked","target":"actual","digest":sha(b"actual")}];refused(version2)
   changed["profile"]["profile_version"]="tampered";refused(changed)
  check("packet.prepared-roles.explicit-new-manifest",prepared_roles)
  check("packet.inputs.validate.scope-owner",lambda:f.reject("hierarchy.packet.validate",{"leader_generation":"1","package_generation":"2","digest":state["digest"]},"PACKAGE_OWNER_MISMATCH",key="manager2",component="3.2"))
  def immutable():
   try:f.sql("UPDATE hyperfide.hierarchy_execution_packets SET packet='{}'");raise RuntimeError("Immutable packet updated")
   except AssertionError:pass
  check("packet.immutable-row",immutable)
  def repeatable_read_refused():
   try:f.sql("BEGIN ISOLATION LEVEL REPEATABLE READ;INSERT INTO hyperfide.hierarchy_execution_packets DEFAULT VALUES;ROLLBACK;");raise RuntimeError("RR authority write accepted")
   except AssertionError as error:expect('"code":"25001"' in str(error),"Wrong isolation refusal")
  check("packet.repeatable-read-write-refused",repeatable_read_refused)
  optional=[{"source_id":"context:"+str(n),"digest":sha((str(n)*4000).encode()),"text":str(n)*4000} for n in range(5)]
  def trim():
   limited=f.create_packet(idempotency_key="trim",max_bytes=len(canonical(packet).encode())+5000,optional_context=optional)["packet"]
   kept=len(limited["optional_context"]);omitted=limited["omitted_optional_context_ids"]
   expect(0<limited["omitted_optional_context"]==len(omitted) and kept+len(omitted)==5 and limited["optional_context"]==optional[:kept]
    and omitted==[{"source_id":c["source_id"],"digest":c["digest"]} for c in optional[kept:]],"Budget did not trim lowest-ranked optional context or omitted ids were not recorded")
   expect(limited["mandatory"]["intent"]==packet["mandatory"]["intent"] and limited["mandatory"]["runtime"]==packet["mandatory"]["runtime"] and limited["mandatory"]["inputs"]==packet["mandatory"]["inputs"],"Budget removed mandatory intent/constraints")
   state["trimmed"]=limited
  check("packet.optional-trim-only",trim)
  def mandatory_invariant():
   a,b=packet,state["trimmed"]
   expect(a["optional_context"]!=b["optional_context"] and without_attempt(a["mandatory"])==without_attempt(b["mandatory"]) and identity(b["mandatory"])==b["mandatory_digest"],"Mandatory digest depends on optional ranked context")
   expect(identity(dict(without_attempt(b["mandatory"]),identity=dict(b["mandatory"]["identity"],attempt_id=a["mandatory"]["identity"]["attempt_id"])))==a["mandatory_digest"],"Mandatory digest is not independent of optional context")
  check("packet.mandatory-digest.optional-invariant",mandatory_invariant)
  def optional_digest():
   forged=[dict(optional[0],text="substituted context")]
   f.refuse_packet("OPTIONAL_CONTEXT_DIGEST_MISMATCH",idempotency_key="forged-context",optional_context=forged)
   f.refuse_packet("INVALID_REQUEST",idempotency_key="duplicate-context",optional_context=[optional[0],optional[0]])
  check("packet.optional-digest-verified",optional_digest)
  check("packet.budget-too-small-refused",lambda:f.refuse_packet("PACKET_BUDGET_TOO_SMALL",idempotency_key="budget",max_bytes=4096,optional_context=optional[:1]))
  for ident,key,code,overrides in (
   ("packet.missing.scope-refused","scope","TASK_SCOPE_REQUIRED",{}),
   ("packet.missing.proof-registry-refused","proof","PROOF_REGISTRY_MISSING",{}),
   ("packet.missing.contract-refused","contract","CONTRACT_INPUT_UNAVAILABLE",{}),
   ("packet.missing.graph-policy-refused","graph","GRAPH_INPUT_REQUIRED",{}),
   ("packet.missing.dependency-refused","dependency","DEPENDENCY_INPUT_UNAVAILABLE",{}),
   ("packet.missing.environment-profile-refused",None,"ENVIRONMENT_PROFILE_REQUIRED",{"sandbox_boot_generation":"2"}),
   ("packet.environment-source-mismatch-refused","environment_source","ENVIRONMENT_SOURCE_MISMATCH",{"sandbox_id":i["mismatch_sandbox"],"slot_id":i["mismatch_slot"]})):
   check(ident,lambda key=key,code=code,overrides=overrides:f.refuse_packet(code,idempotency_key="missing-"+code,**dict({"task_id":negative[key]} if key else {},**overrides)))
  baseline={}
  def change_baseline():
   for key in ("contract","dependency","amend"):
    created=f.create_packet(idempotency_key="change-"+key,task_id=changes[key]);baseline[key]=created
    expect(f.validate(created["digest"])["checked_inputs"]==CURRENT,"Fresh packet was not current")
   expect(baseline["contract"]["packet"]["mandatory"]["inputs"]["contracts"][0]["revision"]=="1","Exact contract revision was not pinned")
  check("packet.change.baseline-current",change_baseline)
  def irrelevant():
   f.sql("INSERT INTO hyperfide.contracts(organisation_id,run_id,id,contract_key,revision,criteria_digest,definition,owner_package_id) VALUES($1,$2,$3,'api.unrelated',1,$4,'{}',$5)",[i["organisation"],i["run"],uid(),sha(b"unrelated"),i["package2"]])
   f.sql("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone) VALUES($1,$2,$3,$2,$4,'QUALIFIED')",[i["organisation"],i["run"],negative["scope"],i["task"]])
   for digest in [state["digest"]]+[baseline[k]["digest"] for k in baseline]:
    expect(f.validate(digest)["checked_inputs"]==CURRENT,"Unrelated contract/dependency change invalidated a packet")
  check("packet.change.irrelevant-input-reused",irrelevant)
  def dependency_change():
   f.sql("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone) VALUES($1,$2,$3,$2,$4,'QUALIFIED')",[i["organisation"],i["run"],changes["dependency"],i["task"]])
   f.stale(baseline["dependency"]["digest"],"dependency");expect(f.validate(state["digest"])["checked_inputs"]==CURRENT,"Dependency change leaked to an unrelated packet")
  check("packet.change.dependency-stale",dependency_change)
  def contract_change():
   f.sql("INSERT INTO hyperfide.contracts(organisation_id,run_id,id,contract_key,revision,criteria_digest,definition,owner_package_id) VALUES($1,$2,$3,'api.packet',2,$4,$5,$6)",[i["organisation"],i["run"],uid(),sha(b"contract-r2"),json.dumps({"interface":"packet.v2"}),i["package2"]])
   f.stale(baseline["contract"]["digest"],"contract");expect(f.validate(state["digest"])["checked_inputs"]==CURRENT,"Contract change leaked to an unrelated packet")
   f.refuse_packet("CONTRACT_REVISION_SUPERSEDED",idempotency_key="superseded-contract",task_id=changes["contract"])
  check("packet.change.contract-stale",contract_change)
  def amendment():
   spec,section,criteria=accept_spec(f,3,"A task packet SHALL identify exact inputs and amended evidence. Mandatory intent and constraints SHALL not be removed by context ranking.")
   move_run(f,3,spec,"PENDING_VALIDATION")
   definition=f.task_definition(section,resource_requirements=dict(f.packet_definition["resource_requirements"],max_descendants=1))
   f.sql("UPDATE hyperfide.tasks SET spec_generation=3,spec_revision_id=$4,criteria_digest=$5,definition=$6,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[i["organisation"],i["run"],changes["amend"],spec,criteria,json.dumps(definition)])
   move_run(f,3,spec,"RUNNING")
   f.stale(baseline["amend"]["digest"],"task acceptance")
   expect(f.validate(state["digest"])["checked_inputs"]==CURRENT,"Amendment invalidated work that was not explicitly revalidated")
   expect(f.ok("hierarchy.packet.inspect",{"leader_generation":"1","package_generation":"2","digest":baseline["amend"]["digest"]},key="manager",component="3.2")["packet"]==baseline["amend"]["packet"],"Historical packet provenance changed")
   f.refuse_packet("PROOF_REGISTRY_MISSING",idempotency_key="amend-unregistered",task_id=changes["amend"])
   f.register_proof(changes["amend"],f.proof_policy(criteria,3,spec))
   changes["amended"]=f.create_packet(idempotency_key="amend-revalidated",task_id=changes["amend"])
  check("packet.amendment.stale-and-history-preserved",amendment)
  def constraint_digest():
   old,new=baseline["amend"]["packet"]["mandatory"],changes["amended"]["packet"]["mandatory"]
   expect(new["identity"]["spec_generation"]=="3" and new["resource_requirements"]["max_descendants"]==1 and identity(without_attempt(old))!=identity(without_attempt(new)) and changes["amended"]["mandatory_digest"]==identity(new),"Changed constraint did not change mandatory digest")
  check("packet.mandatory-digest.constraint-sensitive",constraint_digest)
  def source_change():
   other=uid()
   f.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'fixture-two','https://example.invalid/fixture-two.git')",[i["organisation"],other,i["project"]])
   f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[i["organisation"],other,"c"*40])
   f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[i["organisation"],i["run"],other,"c"*40])
   f.stale(state["digest"],"source pins")
  check("packet.change.source-stale",source_change)
  def no_sources():
   # Simulate a run whose source pins are absent (rows are otherwise immutable); ids are fixture UUIDs.
   f.sql("SET session_replication_role=replica;DELETE FROM hyperfide.run_repositories WHERE organisation_id='%s' AND run_id='%s';"%(i["organisation"],i["run"]))
   f.refuse_packet("SOURCE_INPUTS_REQUIRED",idempotency_key="no-sources")
  check("packet.missing.source-inputs-refused",no_sources)
 finally:
  db=f.database;path=f.path;f.close()
  check("packet.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Fixture database/key directory remains"))
 graph_inputs_regression()
 return 1 if FAILED else 0

def graph_inputs_regression():
 """Native Git extraction, genuine graph publication, then immutable packet admission."""
 import copy,tempfile
 with tempfile.TemporaryDirectory(prefix="hf-packet-graph-") as directory:
  base=Path(directory);repo=base/"repo";repo.mkdir();scratch=base/"scratch";scratch.mkdir()
  def command(args):
   result=subprocess.run(args,cwd=repo,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
   expect(result.returncode==0,"Native graph fixture command failed: "+result.stderr[-1000:])
   return result.stdout.strip()
  command(["git","init","-q"]);command(["git","config","user.name","Hyperfide component fixture"]);command(["git","config","user.email","fixture@example.invalid"])
  # No detached auto-gc/maintenance may outlive the probe (the gate reaps owned descendants).
  command(["git","config","gc.auto","0"]);command(["git","config","maintenance.auto","false"]);command(["git","config","gc.autoDetach","false"])
  (repo/"owned.c").write_text("/* @contract Preserve the value. */\nint value(int input) { return input + 1; }\nint consume(void) { return value(2); }\n")
  command(["git","add","owned.c"]);command(["git","commit","-qm","pinned graph packet fixture"])
  commit=command(["git","rev-parse","HEAD"]);tree=command(["git","rev-parse","HEAD^{tree}"])
  config=base/"graph.json"
  configuration={"schema_version":1,"execution_role":"REMOTE","scratch_root":str(scratch),"cg_binary":str(ROOT/"cg"),"cg_digest":sha((ROOT/"cg").read_bytes()),"repositories":{}}
  def setup(f):
   configuration["repositories"][f.ids["repository"]]=str(repo);config.write_text(canonical(configuration))
  f=PacketFixture(extra_components=("7.1","7.2","7.3"),extra_setup=setup,seed_historical_runtime=False,extra_env={"HYPERFIDE_GRAPH_CONFIG":str(config)},source_object_id=commit)
  state={};i=f.ids
  def scoped(**kwargs):return dict(organisation_id=i["organisation"],run_id=i["run"],authority_epoch=i["epoch"],**kwargs)
  def graph(component,action,value):return f.ok(action,value,key="operator",component=component)
  try:
   def publish():
    manifest=graph("7.1","graph.extract.create",dict(organisation_id=i["organisation"],run_id=i["run"],repository_id=i["repository"],commit=commit,tree=tree,generation="1",configuration={"build_flags":[],"resolver_digest":sha(b"packet-native-resolver"),"generated_manifest_digest":sha(b"packet-native-generated")}))
    expect(manifest["complete"] is True and manifest["identity"]["commit"]==commit,"Native extraction did not preserve actual Git source")
    build=graph("7.2","graph.ingest.create",scoped(bundles=[manifest]))["build_id"]
    for n in range(len(manifest["chunks"])):
     chunk=graph("7.1","graph.extract.read-chunk",{"bundle_digest":manifest["bundle_digest"],"index":n})
     graph("7.2","graph.ingest.chunk",scoped(build_id=build,bundle_digest=manifest["bundle_digest"],chunk=chunk))
    graph("7.2","graph.ingest.seal",scoped(build_id=build))
    for _ in range(100):
     if graph("7.2","graph.ingest.resolve",scoped(build_id=build,limit=32))["state"]=="READY":break
    else:raise AssertionError("Native graph resolution did not complete")
    state.update(graph("7.3","graph.publish.commit",scoped(build_id=build,channel="packet",expected_generation="0",operation_id=uid())))
    state["bundle"]=manifest["bundle_digest"];state["build"]=build
   check("packet.graph.native-published-input",publish)
   if "manifest_id" not in state:return
   def packet():
    task=f.accepted_task("alpha.graph-packet",graph_inputs={"required":True,"manifest_id":state["manifest_id"],"reason":None})
    state["packet"]=f.create_packet(task_id=task,idempotency_key="native-graph-packet")
    raw=state["packet"]["packet"]["mandatory"]["inputs"]["graph"]
    expect(raw["source_coverage"][0]["bundle_digest"]==state["bundle"] and raw["source_set"][0]["commit"]==commit,"Exact graph bundle/source coverage was reduced or relabelled")
   check("packet.graph.exact-required-coverage",packet)
   if "packet" not in state:return
   params={"leader_generation":"1","package_generation":"2","digest":state["packet"]["digest"]}
   check("packet.graph.current-inputs-valid",lambda:expect("CURRENT_REQUIRED_GRAPH_ARTIFACTS" in f.ok("hierarchy.packet.validate",params,key="manager",component="3.2")["checked_inputs"],"Required graph was not currently checked"))
   def quarantine():
    rows=f.sql("UPDATE hyperfide.artifacts a SET status='QUARANTINED',state_version=state_version+1 FROM hyperfide.graph_bundle_inputs b WHERE b.organisation_id=a.organisation_id AND b.run_id=a.run_id AND b.artifact_id=a.id AND b.organisation_id=$1 AND b.run_id=$2 AND b.graph_id=$3 AND b.bundle_digest=$4 RETURNING a.id",[i["organisation"],i["run"],state["build"],state["bundle"]])
    expect(len(rows)==1,"Exact current graph artifact quarantine did not change one artifact")
    status,response=f.invoke("hierarchy.packet.validate",params,key="manager",component="3.2")
    expect(response.get("ok") is False and response.get("error",{}).get("code")=="GRAPH_ARTIFACT_UNAVAILABLE","Quarantined graph accepted or wrong refusal: "+json.dumps({"ok":response.get("ok"),"error":response.get("error")}))
   check("packet.graph.quarantine-admission-refused",quarantine)
   check("packet.graph.history-preserved",lambda:expect(f.ok("hierarchy.packet.inspect",params,key="manager",component="3.2")["packet"]==state["packet"]["packet"],"Quarantine rewrote or hid immutable historical packet"))
  finally:
   db=f.database;path=f.path;f.close()
   check("packet.graph.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Graph fixture authority database/key directory remains"))

if __name__=="__main__":
 if "--cleanup" in sys.argv:print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));raise SystemExit(0)
 raise SystemExit(main())
