#!/usr/bin/env python3
"""Execution packets through real signed HTTPS; reusable declarative input fixture."""
from __future__ import annotations
import hashlib,importlib.util,json,sys,time
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
class PacketFixture(HierarchyFixture):
 def __init__(self,extra_components=(),extra_setup=None,bootstrap=True,seed_historical_runtime=True):
  def setup(f):
   apply_migration(f,"0002-spec");apply_migration(f,"0007-graph");apply_migration(f,"0032-execution-packets")
   i=f.ids;i["profile"]=uid();i["packet_task"]=uid();i["packet_slot"]=uid()
   profile={"schema_version":1,"profile_id":i["profile"],"profile_version":"1.0.0",
    "os":{"distribution":"debian","version":"12","architecture":"x86_64"},
    "image":{"provider":"fixture","reference":"fixture:1.0","digest":None},
    "resources":{"cpu_millis":4000,"memory_bytes":"8589934592","disk_bytes":"21474836480","persistent_volume_bytes":"0"},
    "toolchains":[{"name":"node","version":"24.0.0"}],
    "package_managers":[{"name":"npm","version":"11.0.0","locks":[{"path":"package-lock.json","digest":sha(b"lock")}]}],
    "native_agents":[{"name":"codex","version":"1.0.0"}],"connectors":[{"name":"codex","version":"1.0.0"}],
    "supervisor":{"name":"supervisor","version":"1.0.0"},"hyperfide":{"version":"2.0.0"},
    "system_packages":[],"repositories":[{"id":i["repository"],"url":"https://example.invalid/fixture.git","commit":"a"*40,"submodules":[],"lfs":False}],
    "recipe":{"path":"prepare.sh","digest":sha(b"recipe")},"generated_inputs":[],"build_config":[],
    "caches":[],"required_capabilities":["processes"],"network":{"routes":[],"registries":[]},"credential_references":["fixture-model-account"],
    "policy":{"max_process_lifetime_seconds":259200,"expires_at":time.strftime("%Y-%m-%dT%H:%M:%S.000Z",time.gmtime(time.time()+3600)),"rebuild_on":["source"]},
    "preparation_evidence":[{"path":"scan.json","digest":sha(b"declarative-fixture-scan")}]}
   body={"schema_version":1,"profile":profile,"files":[],"directories":[],"scan":{"policy_version":1,"canary_counts":{"secret":0,"identity":0,"lease":0},"checks":["sensitive_paths","private_key_markers","authority_json","designated_canaries"]}}
   f.preparation=identity(body);manifest=dict(body,digest=f.preparation)
   f.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,id,content_digest,provider,runtime_platform,manifest) VALUES($1,$2,$3,'fixture','linux',$4)",[i["organisation"],i["profile"],f.preparation,json.dumps(manifest)])
   i["pool"]=uid();i["sandbox"]=uid()
   f.sql("INSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region,profile_id) VALUES($1,$2,'fixture','fixture','packet-fixture','fixture',$3)",[i["organisation"],i["pool"],i["profile"]])
   f.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state,preparation_digest) VALUES($1,$2,$3,'packet-fixture-resource','RUNNING',$4)",[i["organisation"],i["sandbox"],i["pool"],f.preparation])
   i["boot"]=f.sql("SELECT boot_id FROM hyperfide.sandbox_boots WHERE organisation_id=$1 AND sandbox_id=$2",[i["organisation"],i["sandbox"]])[0]["boot_id"]
   f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,'packet-slot',1,'AGENT','READY')",[i["organisation"],i["packet_slot"],i["sandbox"]])
   f.packet_definition={"feature_key":"alpha","purpose":"Actual immutable execution input fixture","touches":["src/fixture.ts"],
    "environment_profile_id":i["profile"],"resource_requirements":{"agent_sessions":1,"cpu_millis":1000,"memory_bytes":"2147483648","disk_bytes":"4294967296","build_slots":1,"test_slots":1,"max_descendants":2},
    "execution_profile":{"connector":"codex","model_profile_ref":"fixture-frontier","credential_profile_ref":"fixture-model-account","timeout_seconds":3600},
    "contract_inputs":[],"graph_inputs":{"required":False,"manifest_id":None,"reason":"Accepted fixture has no graph-dependent analysis"}}
   f.packet_criteria=sha(b"packet-criteria")
   f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,'alpha.packet',$4,$5,$6,$7,2)",[i["organisation"],i["run"],i["packet_task"],i["package2"],i["spec"],f.packet_criteria,json.dumps(f.packet_definition)])
   policy={"schema_version":1,"criteria_digest":f.packet_criteria,"spec_revision_id":i["spec"],"spec_generation":"1","repository_id":i["repository"],"source_object_id":"a"*40,
    "rubric_digest":sha(b"explicit-review-rubric"),"checks":[],"clauses":[{"id":"3.2.1","mode":"REVIEW","acceptance_ids":["packet-intent"],"reviewers":[i["watcher"]],"rubric_digest":sha(b"explicit-review-rubric")}],
    "inputs":{k:sha(("accepted-"+k).encode()) for k in ["source","dependency","toolchain","configuration","graph","contract"]},"contract_digests":[]}
   f.packet_proof=policy
   f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,1,$4,$5,$6,$7)",[i["organisation"],i["run"],i["packet_task"],i["spec"],f.packet_criteria,identity(policy),json.dumps(policy)])
   if extra_setup:extra_setup(f)
  super().__init__(extra_components=dependencies(("3.2",)+tuple(extra_components)),extra_setup=setup,bootstrap=bootstrap,seed_historical_runtime=seed_historical_runtime)
 def packet_input(self,**overrides):
  return dict({"idempotency_key":"packet-create","leader_generation":"1","package_generation":"2","task_id":self.ids["packet_task"],"attempt_id":uid(),"attempt_generation":"1","sandbox_id":self.ids["sandbox"],"slot_id":self.ids["packet_slot"],"sandbox_boot_generation":"1","max_bytes":262144,"optional_context":[]},**overrides)
 def create_packet(self,**overrides):
  return self.ok("hierarchy.packet.create",self.packet_input(**overrides),key="manager",component="3.2")
def main():
 f=PacketFixture();i=f.ids;state={}
 try:
  request=f.packet_input()
  check("packet.create.signed",lambda:state.update(f.ok("hierarchy.packet.create",request,key="manager",component="3.2")))
  packet=state.get("packet",{})
  check("packet.no-execution-authority",lambda:expect(packet.get("execution_authority") is False and f.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE id=$1",[request["attempt_id"]])[0]["n"]==0,"Prospective packet granted compute or created an attempt"))
  check("packet.exact-identity",lambda:expect(packet["mandatory"]["identity"]["attempt_id"]==request["attempt_id"] and packet["mandatory"]["identity"]["spec_revision_id"]==i["spec"] and packet["mandatory"]["identity"]["parent_session_id"]==i["manager"],"Accepted task/parent/attempt pins missing"))
  check("packet.complete-mandatory-intent",lambda:expect(packet["mandatory"]["intent"]["definition"]==f.packet_definition and packet["mandatory"]["intent"]["proof_policy"]==f.packet_proof and packet["mandatory"]["intent"]["proof_obligations"][0]["clause_id"]=="3.2.1","Mandatory accepted intent/proof registry was reduced"))
  check("packet.manifest-runtime-resource-pins",lambda:expect(packet["mandatory"]["runtime"]["preparation_digest"]==f.preparation and packet["mandatory"]["runtime"]["slot_id"]==i["packet_slot"] and packet["mandatory"]["resource_requirements"]==f.packet_definition["resource_requirements"],"Environment/resource/slot pins differ"))
  check("packet.canonical-digests",lambda:expect(identity(packet)==state["digest"] and identity(packet["mandatory"])==state["mandatory_digest"],"Packet digest does not bind immutable bytes"))
  check("packet.exact-replay",lambda:expect(f.ok("hierarchy.packet.create",request,key="manager",component="3.2")["digest"]==state["digest"],"Replay rebuilt immutable packet"))
  check("packet.conflicting-replay",lambda:f.reject("hierarchy.packet.create",dict(request,max_bytes=262143),"IDEMPOTENCY_CONFLICT",key="manager",component="3.2"))
  check("packet.generation-race-refused",lambda:f.reject("hierarchy.packet.create",f.packet_input(idempotency_key="generation-race",attempt_generation="2"),"ATTEMPT_GENERATION_STALE",key="manager",component="3.2"))
  check("packet.stale-package-refused",lambda:f.reject("hierarchy.packet.create",f.packet_input(idempotency_key="stale-package",package_generation="1"),"PACKAGE_GENERATION_STALE",key="manager",component="3.2"))
  check("packet.role-denied",lambda:f.reject("hierarchy.packet.create",f.packet_input(idempotency_key="watcher"),"ROLE_DENIED",key="watcher",component="3.2"))
  check("packet.scope-spoof-denied",lambda:f.reject("hierarchy.packet.create",dict(f.packet_input(),organisation_id=uid()),"INVALID_REQUEST",key="manager",component="3.2"))
  check("packet.inspect.exact",lambda:expect(f.ok("hierarchy.packet.inspect",{"leader_generation":"1","package_generation":"2","digest":state["digest"]},key="manager",component="3.2")["packet"]==packet,"Reader changed exact packet"))
  def immutable():
   try:f.sql("UPDATE hyperfide.hierarchy_execution_packets SET packet='{}'");raise RuntimeError("Immutable packet updated")
   except AssertionError:pass
  check("packet.immutable-row",immutable)
  optional=[{"source_id":"context:"+str(n),"digest":sha(str(n).encode()),"text":"x"*4000} for n in range(5)]
  def trim():
   limited=f.create_packet(idempotency_key="trim",max_bytes=len(canonical(packet).encode())+100,optional_context=optional)
   expect(limited["packet"]["omitted_optional_context"]>0 and limited["packet"]["mandatory"]["intent"]==packet["mandatory"]["intent"] and limited["packet"]["mandatory"]["runtime"]==packet["mandatory"]["runtime"],"Budget removed mandatory intent or did not trim optional context")
  check("packet.optional-trim-only",trim)
 finally:
  db=f.database;path=f.path;f.close()
  check("packet.cleanup.observed",lambda:expect(not path.exists() and f.sql("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[db],admin=True)[0]["n"]==0,"Fixture database/key directory remains"))
 return 1 if FAILED else 0
if __name__=="__main__":
 if "--cleanup" in sys.argv:print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));raise SystemExit(0)
 raise SystemExit(main())
