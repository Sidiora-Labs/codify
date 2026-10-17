"""Real native privileged-staging integration against signed HTTPS/PG/SigV4.
The stager is driven through the linked 12.4 component action
(build/hyperfide-native --component 12.4 --action runner.preparation.stage),
the same hf_runner_stage_preparation the PREPARATION job path calls.
The helper does not claim source semantics, remote execution or launch authority.
"""
from __future__ import annotations
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid

def sha(data):
    return "sha256:"+hashlib.sha256(data).hexdigest()

class StageService:
    """Actual signed HTTPS/PG/SigV4 15.2 service through the shared identity fixture."""
    def __init__(self, root, objects, fixture, database):
        spec=importlib.util.spec_from_file_location("stage_identity_fixture",root/"tests/hyperfide/support/identity_fixture.py")
        identity=importlib.util.module_from_spec(spec);spec.loader.exec_module(identity)
        def setup(f):
            f.env.update({"HF_ARTIFACT_S3_ENDPOINT":fixture.endpoint,"HF_ARTIFACT_ALLOW_LOOPBACK_HTTP":"1","HF_ARTIFACT_S3_REGION":objects.REGION,"HF_ARTIFACT_S3_BUCKET":objects.BUCKET,
                "HF_ARTIFACT_S3_ACCESS_KEY_ID":objects.KEY,"HF_ARTIFACT_S3_SECRET_ACCESS_KEY":objects.SECRET,"HF_ARTIFACT_S3_SESSION_TOKEN":objects.TOKEN,
                "HF_ARTIFACT_ORGANISATION_ID":f.ids["organisation"],"HF_ARTIFACT_ALLOWED_RUN_IDS":json.dumps([f.ids["run"]])})
        self.auth=identity.IdentityFixture(extra_components=("15.2",),extra_setup=setup,database=database)
        self.scope={"organisation_id":self.auth.ids["organisation"],"run_id":self.auth.ids["run"]}
        # The object fixture derives backend keys from the 15.2 module's scope globals.
        objects.ORG,objects.RUN=self.scope["organisation_id"],self.scope["run_id"]
    def ok(self, action, value):
        status,response=self.auth.invoke(action,value,component="15.2")
        if status!=200 or response.get("ok") is not True:raise AssertionError("authenticated artifact service refused "+action+": "+str(response.get("error")))
        return response["result"]
    def put(self, data):
        return self.ok("artifact.object.put",{**self.scope,"digest":sha(data),"size_bytes":str(len(data)),"data_base64":__import__("base64").b64encode(data).decode(),"retention_class":"RUN","retention_until":None,"retention_hold":False})
    def close(self):
        self.auth.close()

def run_probe(binary, service_root):
    root=Path(service_root).resolve()
    spec=importlib.util.spec_from_file_location("actual_stage_artifacts",root/"tests/hyperfide/cases/tasks/15_2.py")
    objects=importlib.util.module_from_spec(spec);spec.loader.exec_module(objects)
    owned=Path("/run")/("hf-stage-qualification-"+uuid.uuid4().hex)
    owned.mkdir(mode=0o755);owned.chmod(0o755)
    workspace=owned/"work";workspace.mkdir(mode=0o700);os.chown(workspace,65534,65534)
    fixture=None;service=None;operations=[];checks=[]
    def check(name, condition):
        if not condition:raise AssertionError(name)
        checks.append({"id":name,"passed":True})
    try:
        fixture=objects.ObjectFixture()
        service=StageService(root,objects,fixture,"hf_stage_"+uuid.uuid4().hex)
        auth=service.auth;scope=service.scope
        transport=owned/"transport.json"
        transport.write_text(json.dumps({"origin":auth.origin,"ca_file":str(auth.ca),"key_path":str(auth.keys["operator"]["path"]),"credential_id":auth.ids["operator"],"timeout_ms":10000}))
        transport.chmod(0o600)
        recipe=owned/"recipe.js";recipe.write_text("// immutable qualification recipe; never executed\n");recipe.chmod(0o644)
        executable=Path("/usr/bin/true").resolve()
        pins={"node_path":str(executable),"node_digest":sha(executable.read_bytes()),
              "recipe_path":str(recipe),"recipe_digest":sha(recipe.read_bytes()),
              "native_path":str(executable),"native_digest":sha(executable.read_bytes()),
              "base_root":str(owned),"max_stage_bytes":"1048576"}
        config=owned/"config.json"
        config.write_text(json.dumps({**scope,"transport_config":str(transport),"preparation_recipes":{"environment.prepare.v1":pins,"checkpoint.restore.v1":pins}}));config.chmod(0o600)
        input_bytes=b'{"schema_version":1,"purpose":"native-staging-qualification"}'
        input_result=service.put(input_bytes);input_ref=input_result["artifact"]
        raw=b"\x00actual source bytes\xff"*19000
        pieces=[raw[i:i+196608] for i in range(0,len(raw),196608)]
        children=[service.put(part) for part in pieces]
        chunks=[];offset=0
        for sequence,(part,stored) in enumerate(zip(pieces,children)):
            a=stored["artifact"]
            chunks.append({"sequence":sequence,"artifact_id":a["artifact_id"],"digest":sha(part),"size_bytes":str(len(part)),"offset_bytes":str(offset)})
            offset+=len(part)
        committed=service.ok("artifact.manifest.commit",{**scope,"expected_chunks":len(chunks),"total_size_bytes":str(len(raw)),"content_digest":sha(raw),"complete":True,"truncated":False,"missing_ranges":[],"chunks":chunks,"retention_class":"RUN","retention_until":None,"retention_hold":False})
        manifest_ref=committed["artifact"]
        def claim(refs=None):
            op=str(uuid.uuid4());operations.append(op);reservation=str(uuid.uuid4())
            argv=[pins["node_path"],pins["recipe_path"],"--job-context","/run/hyperfide-stage/"+op+"/context.json"]
            value={"result":{"operation_id":op,"job_class":"PREPARATION","plan_digest":sha(b"bounded real staging claim"),
                "plan":{"reservation_id":reservation,"argv":argv,"executable_digest":pins["node_digest"],"preparation":{
                    "recipe_id":"environment.prepare.v1","job_binding":{"namespace":"QUALIFICATION","job_id":str(uuid.uuid4()),"lease_generation":"1","reservation_id":reservation,"input_packet_digest":sha(b"actual fixture packet identity"),"input_manifest_digest":sha(b"semantic job snapshot")},"input_manifest_artifact_id":input_ref["artifact_id"],"input_manifest_digest":sha(input_bytes),
                    "source":{"repository_key":"fixture","source_object_id":"a"*40,"source_tree_id":"b"*40,"source_manifest_digest":sha(b"source")},
                    "staging":refs if refs is not None else [{"role":"source:fixture","artifact_id":manifest_ref["artifact_id"],"storage_kind":"manifest","digest":sha(raw),"manifest_digest":manifest_ref["digest"],"size_bytes":str(len(raw))}]}},
                "binding":{**scope,"uid":65534,"gid":65534,"workspace_path":str(workspace/"candidate"),"sandbox_id":auth.ids["sandbox"],"boot_id":auth.ids["boot"],"boot_generation":"1","slot_id":str(uuid.uuid4()),"repository_id":str(uuid.uuid4()),"preparation_recipes":{"environment.prepare.v1":pins,"checkpoint.restore.v1":pins}}}}
            b=value["result"]["binding"];p=value["result"]["plan"]["preparation"]
            b.update(session_id=str(uuid.uuid4()),slot_generation="1",home_path=str(workspace),tmp_path=str(workspace))
            p["target_binding"]={
                "target_binding_id":str(uuid.uuid4()),"organisation_id":scope["organisation_id"],"run_id":scope["run_id"],
                "preparation_operation_id":op,"task_id":str(uuid.uuid4()),"request_id":str(uuid.uuid4()),"reservation_id":reservation,
                "allocation_id":str(uuid.uuid4()),"allocation_generation":"1","sandbox_id":b["sandbox_id"],"sandbox_boot_generation":b["boot_generation"],
                "boot_id":b["boot_id"],"target_slot_id":b["slot_id"],"target_slot_generation":b["slot_generation"],
                "target_runner_session_id":b["session_id"],"target_uid":str(b["uid"]),"target_gid":str(b["gid"]),
                "assignee_session_id":auth.ids["operator"],"repository_id":b["repository_id"],"source_digest":sha(b"accepted source envelope"),
                "source_object_id":p["source"]["source_object_id"],"source_tree_id":p["source"]["source_tree_id"],
                "profile_id":str(uuid.uuid4()),"profile_digest":sha(b"actual profile binding"),"boot_preparation_digest":sha(b"actual boot preparation"),
                "workspace_path":b["workspace_path"],"home_path":b["home_path"],"tmp_path":b["tmp_path"],
                "generation":"1","state":"BOUND","execution_authority":False}
            return value
        def invoke(value,config_path=None):
            path=owned/"claim.json";path.write_text(json.dumps(value));path.chmod(0o600)
            request=json.dumps({"config_path":str(config_path or config),"claim_path":str(path)})
            result=subprocess.run([str(binary),"--component","12.4","--action","runner.preparation.stage"],input=request,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=90)
            check("native-output-secret-free-"+str(len(checks)),all(term not in stream for term in (str(auth.keys["operator"]["path"]),objects.SECRET) for stream in (result.stdout,result.stderr)))
            envelope=json.loads(result.stdout)
            return result,({"ok":True,**envelope["result"]} if envelope.get("ok") else {"ok":False})
        value=claim();result,reply=invoke(value)
        check("native-staging-real-https-manifest",result.returncode==0 and reply["ok"])
        context_path=Path(reply["context_path"]);context=json.loads(context_path.read_text())
        staged={entry["role"]:entry for entry in context["staging"]}
        check("native-staging-full-raw-content",Path(staged["source:fixture"]["path"]).read_bytes()==raw)
        check("native-staging-input-manifest",Path(staged["input-manifest"]["path"]).read_bytes()==input_bytes)
        check("native-staging-secret-free-context",all(term not in context_path.read_text() for term in ("key_path","transport_config",objects.SECRET,str(auth.keys["operator"]["path"]))))
        check("native-staging-immutable-root-bindings",context_path.stat().st_uid==0 and context_path.stat().st_gid==65534 and context_path.stat().st_mode&0o777==0o440 and all(Path(e["path"]).stat().st_uid==0 and Path(e["path"]).stat().st_mode&0o777==0o440 for e in context["staging"]))
        child_code="import json,os,sys;from pathlib import Path;p=Path(sys.argv[1]);c=json.loads(p.read_text());assert all(Path(e['path']).read_bytes() is not None for e in c['staging']);assert all(not os.access(e['path'],os.W_OK) for e in c['staging']);Path(c['out_root'],'worker-result').write_bytes(b'ok');assert not os.access(sys.argv[2],os.R_OK)"
        def drop():
            os.setgroups([]);os.setgid(65534);os.setuid(65534)
        child=subprocess.run(["/usr/bin/python3","-c",child_code,str(context_path),str(auth.keys["operator"]["path"])],preexec_fn=drop,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
        check("native-staging-actual-worker-uid-access",child.returncode==0)
        result,reply=invoke(value)
        check("native-staging-no-operation-overwrite",result.returncode!=0 and not reply["ok"])
        alias=owned/"config-alias";alias.symlink_to(owned,target_is_directory=True)
        result,reply=invoke(claim(),alias/"config.json")
        check("native-staging-refuses-config-ancestor-symlink",result.returncode!=0 and not reply["ok"])
        unsafe=owned/"unsafe-config";unsafe.mkdir();unsafe.chmod(0o777)
        unsafe_config=unsafe/"config.json";unsafe_config.write_bytes(config.read_bytes());unsafe_config.chmod(0o600)
        result,reply=invoke(claim(),unsafe_config)
        check("native-staging-refuses-config-writable-ancestor",result.returncode!=0 and not reply["ok"])
        saved=config.read_text();changed=json.loads(saved);changed["transport_config"]=str(alias/"transport.json");config.write_text(json.dumps(changed))
        result,reply=invoke(claim())
        check("native-staging-refuses-transport-ancestor-symlink",result.returncode!=0 and not reply["ok"])
        config.write_text(saved)
        check("native-staging-preserves-logical-job-binding",context["job_binding"]==value["result"]["plan"]["preparation"]["job_binding"] and context["job_binding"]["input_manifest_digest"]!=sha(input_bytes))
        check("native-staging-preserves-actual-target-binding",context["target_binding"]==value["result"]["plan"]["preparation"]["target_binding"])
        tests=[]
        v=claim();v["result"]["binding"]["run_id"]=str(uuid.uuid4());tests.append(("scope",v))
        v=claim();v["result"]["plan"]["argv"][1]="/bin/sh";tests.append(("untrusted-recipe",v))
        v=claim();v["result"]["plan"]["preparation"]["staging"][0]["digest"]=sha(b"forged");tests.append(("raw-digest",v))
        v=claim();v["result"]["plan"]["preparation"]["staging"][0]["manifest_digest"]=sha(b"forged-parent");tests.append(("parent-digest",v))
        v=claim();v["result"]["plan"]["preparation"]["staging"][0]["size_bytes"]=str(len(raw)+1);tests.append(("total-size",v))
        v=claim();v["result"]["plan"]["preparation"]["staging"][0]["role"]="input-manifest";tests.append(("reserved-role",v))
        v=claim();v["result"]["plan"]["preparation"]["staging"][0]["size_bytes"]="1048577";tests.append(("trusted-budget",v))
        v=claim();v["result"]["binding"]["workspace_path"]=str(workspace);tests.append(("existing-target",v))
        link=owned/"parent-link";link.symlink_to(workspace,target_is_directory=True)
        v=claim();v["result"]["binding"]["workspace_path"]=str(link/"target");tests.append(("parent-symlink",v))
        v=claim();del v["result"]["plan"]["preparation"]["job_binding"];tests.append(("missing-job-binding",v))
        v=claim();v["result"]["plan"]["preparation"]["job_binding"]["reservation_id"]=str(uuid.uuid4());tests.append(("job-reservation-mismatch",v))
        v=claim();v["result"]["plan"]["preparation"]["job_binding"]["namespace"]="CALLER_AUTHORITY";tests.append(("job-namespace",v))
        v=claim();v["result"]["plan"]["preparation"]["source"]["source_tree_id"]=None;tests.append(("unmeasured-environment-tree",v))
        v=claim();del v["result"]["plan"]["preparation"]["target_binding"];tests.append(("missing-target-binding",v))
        v=claim();v["result"]["plan"]["preparation"]["target_binding"]["target_slot_id"]=str(uuid.uuid4());tests.append(("target-slot-alias",v))
        v=claim();v["result"]["plan"]["preparation"]["target_binding"]["target_uid"]="65533";tests.append(("target-uid-alias",v))
        v=claim();v["result"]["plan"]["preparation"]["target_binding"]["preparation_operation_id"]=str(uuid.uuid4());tests.append(("target-operation",v))
        v=claim();v["result"]["plan"]["preparation"]["target_binding"]["home_path"]="/etc";tests.append(("target-home-alias",v))
        v=claim();v["result"]["plan"]["preparation"]["target_binding"]["execution_authority"]=True;tests.append(("target-authority-flag",v))
        v=claim();v["result"]["plan"]["preparation"]["job_binding"].update(namespace="CANDIDATE",lease_generation="0");tests.append(("zero-active-job-generation",v))
        for name,v in tests:
            result,reply=invoke(v)
            check("native-staging-refuses-"+name,result.returncode!=0 and not reply["ok"] and not (Path("/run/hyperfide-stage")/v["result"]["operation_id"]/"context.json").exists())
        direct=b"small raw file"
        direct_ref=service.put(direct)["artifact"]
        v=claim([{"role":"source:small","artifact_id":direct_ref["artifact_id"],"storage_kind":"object","digest":sha(direct),"size_bytes":str(len(direct))}])
        result,reply=invoke(v)
        check("native-staging-direct-object",result.returncode==0 and Path(json.loads(Path(reply["context_path"]).read_text())["staging"][0]["path"]).read_bytes()==direct)
        restored=claim([{"role":"checkpoint.capsule","artifact_id":manifest_ref["artifact_id"],"storage_kind":"manifest","digest":sha(raw),"manifest_digest":manifest_ref["digest"],"size_bytes":str(len(raw))}])
        restored["result"]["plan"]["preparation"]["recipe_id"]="checkpoint.restore.v1"
        del restored["result"]["plan"]["preparation"]["target_binding"]
        restored["result"]["plan"]["preparation"]["job_binding"]["namespace"]="CHECKPOINT"
        restored["result"]["plan"]["preparation"]["source"]["source_tree_id"]=None
        result,reply=invoke(restored)
        checkpoint_context=json.loads(Path(reply["context_path"]).read_text()) if result.returncode==0 else {}
        check("native-staging-checkpoint-preserves-unmeasured-tree",result.returncode==0 and checkpoint_context["source"]["source_tree_id"] is None and checkpoint_context["job_binding"]==restored["result"]["plan"]["preparation"]["job_binding"])
        reproduction=claim()
        reproduction["result"]["plan"]["preparation"]["job_binding"].update(namespace="REPRODUCTION",lease_generation="0")
        result,reply=invoke(reproduction)
        check("native-staging-reproduction-zero-admission-generation",result.returncode==0 and json.loads(Path(reply["context_path"]).read_text())["job_binding"]["lease_generation"]=="0")
        qualification=claim()
        qualification["result"]["plan"]["preparation"]["job_binding"]["lease_generation"]="0"
        result,reply=invoke(qualification)
        check("native-staging-qualification-zero-admission-generation",result.returncode==0 and json.loads(Path(reply["context_path"]).read_text())["job_binding"]==qualification["result"]["plan"]["preparation"]["job_binding"])
        fixture.set_mode(pieces[0],"corrupt")
        v=claim();result,reply=invoke(v)
        check("native-staging-refuses-backend-corruption",result.returncode!=0 and not reply["ok"])
        fixture.set_mode(pieces[0],"normal")
    finally:
        if service is not None:service.close()
        if fixture is not None:fixture.stop()
        for operation in operations:
            target=Path("/run/hyperfide-stage")/operation
            if target.exists():shutil.rmtree(target)
        shutil.rmtree(owned)
    check("native-staging-owned-cleanup",not owned.exists() and all(not (Path("/run/hyperfide-stage")/op).exists() for op in operations))
    return {"schema_version":1,"scope":"ACTUAL_NATIVE_STAGING_HTTPS_PG_S3_FIXTURE","checks":checks,"assertions":len(checks),"full_case_status":"INCOMPLETE","live_provider_qualification":"NOT_EVALUATED"}

if __name__=="__main__":
    import sys
    print(json.dumps(run_probe(sys.argv[1],sys.argv[2]),sort_keys=True))
