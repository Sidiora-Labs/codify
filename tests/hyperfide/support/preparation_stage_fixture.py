"""Real native privileged-staging integration against signed HTTPS/PG/SigV4.
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
        service=objects.Service(root,fixture,database="hf_stage_"+uuid.uuid4().hex)
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
            return {"result":{"operation_id":op,"job_class":"PREPARATION","plan_digest":sha(b"bounded real staging claim"),
                "plan":{"reservation_id":reservation,"argv":argv,"executable_digest":pins["node_digest"],"preparation":{
                    "recipe_id":"environment.prepare.v1","job_binding":{"namespace":"QUALIFICATION","job_id":str(uuid.uuid4()),"lease_generation":"1","reservation_id":reservation,"input_packet_digest":sha(b"actual fixture packet identity"),"input_manifest_digest":sha(b"semantic job snapshot")},"input_manifest_artifact_id":input_ref["artifact_id"],"input_manifest_digest":sha(input_bytes),
                    "source":{"repository_key":"fixture","source_object_id":"a"*40,"source_tree_id":"b"*40,"source_manifest_digest":sha(b"source")},
                    "staging":refs if refs is not None else [{"role":"source:fixture","artifact_id":manifest_ref["artifact_id"],"storage_kind":"manifest","digest":sha(raw),"manifest_digest":manifest_ref["digest"],"size_bytes":str(len(raw))}]}},
                "binding":{**scope,"uid":65534,"gid":65534,"workspace_path":str(workspace/"candidate"),"sandbox_id":auth.ids["sandbox"],"boot_id":auth.ids["boot"],"boot_generation":"1","slot_id":str(uuid.uuid4()),"repository_id":str(uuid.uuid4()),"preparation_recipes":{"environment.prepare.v1":pins,"checkpoint.restore.v1":pins}}}}
        def invoke(value,config_path=None):
            path=owned/"claim.json";path.write_text(json.dumps(value));path.chmod(0o600)
            result=subprocess.run([str(binary),str(config_path or config),str(path)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=90)
            check("native-output-secret-free-"+str(len(checks)),str(auth.keys["operator"]["path"]) not in result.stdout and objects.SECRET not in result.stdout and not result.stderr)
            return result,json.loads(result.stdout)
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
        restored["result"]["plan"]["preparation"]["job_binding"]["namespace"]="CHECKPOINT"
        restored["result"]["plan"]["preparation"]["source"]["source_tree_id"]=None
        result,reply=invoke(restored)
        checkpoint_context=json.loads(Path(reply["context_path"]).read_text()) if result.returncode==0 else {}
        check("native-staging-checkpoint-preserves-unmeasured-tree",result.returncode==0 and checkpoint_context["source"]["source_tree_id"] is None and checkpoint_context["job_binding"]==restored["result"]["plan"]["preparation"]["job_binding"])
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
