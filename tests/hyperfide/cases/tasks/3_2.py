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
class PacketFixture(HierarchyFixture):
 def __init__(self,extra_components=(),extra_setup=None,bootstrap=True,seed_historical_runtime=True,extra_env=None,source_object_id=None):
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
    "system_packages":[],"repositories":[{"id":i["repository"],"url":"https://example.invalid/fixture.git","commit":source_object_id or "a"*40,"submodules":[],"lfs":False}],
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
   policy={"schema_version":1,"criteria_digest":f.packet_criteria,"spec_revision_id":i["spec"],"spec_generation":"1","repository_id":i["repository"],"source_object_id":source_object_id or "a"*40,
    "rubric_digest":sha(b"explicit-review-rubric"),"checks":[],"clauses":[{"id":"3.2.1","mode":"REVIEW","acceptance_ids":["packet-intent"],"reviewers":[i["watcher"]],"rubric_digest":sha(b"explicit-review-rubric")}],
    "inputs":{k:sha(("accepted-"+k).encode()) for k in ["source","dependency","toolchain","configuration","graph","contract"]},"contract_digests":[]}
   f.packet_proof=policy
   f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,1,$4,$5,$6,$7)",[i["organisation"],i["run"],i["packet_task"],i["spec"],f.packet_criteria,identity(policy),json.dumps(policy)])
   if extra_setup:extra_setup(f)
  super().__init__(extra_components=dependencies(("3.2",)+tuple(extra_components)),extra_setup=setup,bootstrap=bootstrap,seed_historical_runtime=seed_historical_runtime,extra_env=extra_env,source_object_id=source_object_id)
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
  def validate_inputs():
   actual=f.ok("hierarchy.packet.validate",{"leader_generation":"1","package_generation":"2","digest":state["digest"]},key="manager",component="3.2")
   expect(actual["packet"]==packet and actual["execution_authority"] is False and actual["checked_inputs"]==["IMMUTABLE_PACKET","CURRENT_ACCEPTED_TASK","CURRENT_AUTHORITY_EPOCH","ACCEPTED_ENVIRONMENT_MANIFEST","GRAPH_EXPLICITLY_NOT_REQUIRED"],"Current-input validation changed immutable pins or granted authority")
  check("packet.inputs.validate.signed",validate_inputs)
  def prepared_roles():
   manifest=f.sql("SELECT manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["profile"]])[0]["manifest"]
   context={k:packet["mandatory"]["runtime"][k] for k in ["execution_profile"]}
   context.update(resource_requirements=packet["mandatory"]["resource_requirements"],policy_digest=packet["mandatory"]["policy_digest"])
   script="import fs from 'node:fs';import {derivePreparedEnvironmentRoles,deriveQualificationInputs} from './services/hyperfide/dist/hierarchy/packets.js';const v=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify({roles:derivePreparedEnvironmentRoles(v.manifest,v.context),baseline:deriveQualificationInputs(v.packet)}));"
   def roles(value):
    return json.loads(subprocess.check_output(["node","--input-type=module","-e",script],input=json.dumps(dict(manifest=value,context=context,packet=packet)).encode(),cwd=ROOT,stderr=subprocess.PIPE))
   original=roles(manifest)
   expect(original["roles"]["preparation_digest"]==f.preparation and original["roles"]["configuration_digest"]==original["baseline"]["configuration_digest"] and original["roles"]["toolchain_digest"]==original["baseline"]["toolchain_digest"],"Shared pure preimages differ from accepted baseline")
   changed=json.loads(json.dumps(manifest));changed["profile"]["profile_version"]="2.0.0"
   changed["digest"]=identity({k:v for k,v in changed.items() if k!="digest"})
   actual=roles(changed)
   expect(actual["roles"]["configuration_digest"]!=original["roles"]["configuration_digest"] and actual["roles"]["preparation_digest"]!=f.preparation and actual["roles"]["toolchain_digest"]==original["roles"]["toolchain_digest"] and actual["roles"]["authority"]=="NONE","New prepared bytes reused old configuration or granted readiness")
   version2=json.loads(json.dumps(manifest));version2.update(schema_version=2,symlinks=[],hardlinks=[])
   version2["digest"]=identity({k:v for k,v in version2.items() if k!="digest"})
   v2roles=roles(version2)["roles"]
   expect(v2roles["preparation_digest"]==version2["digest"] and v2roles["configuration_digest"]!=original["roles"]["configuration_digest"],"V2 complete inventory schema was dropped or relabelled as V1")
   version2["symlinks"]=[{"path":"linked","target":"actual","digest":sha(b"actual")}]
   try:roles(version2);raise AssertionError("Unhashed V2 link inventory accepted")
   except subprocess.CalledProcessError:pass
   changed["profile"]["profile_version"]="tampered"
   try:roles(changed);raise AssertionError("Tampered full manifest accepted")
   except subprocess.CalledProcessError:pass
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
  optional=[{"source_id":"context:"+str(n),"digest":sha(str(n).encode()),"text":"x"*4000} for n in range(5)]
  def trim():
   limited=f.create_packet(idempotency_key="trim",max_bytes=len(canonical(packet).encode())+100,optional_context=optional)
   expect(limited["packet"]["omitted_optional_context"]>0 and limited["packet"]["mandatory"]["intent"]==packet["mandatory"]["intent"] and limited["packet"]["mandatory"]["runtime"]==packet["mandatory"]["runtime"],"Budget removed mandatory intent or did not trim optional context")
  check("packet.optional-trim-only",trim)
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
    task=uid();definition=copy.deepcopy(f.packet_definition);definition["graph_inputs"]={"required":True,"manifest_id":state["manifest_id"],"reason":None};criteria=sha(b"native-required-graph-criteria")
    f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,'alpha.graph-packet',$4,$5,$6,$7,2)",[i["organisation"],i["run"],task,i["package2"],i["spec"],criteria,json.dumps(definition)])
    proof=copy.deepcopy(f.packet_proof);proof["criteria_digest"]=criteria
    f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,1,$4,$5,$6,$7)",[i["organisation"],i["run"],task,i["spec"],criteria,identity(proof),json.dumps(proof)])
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
