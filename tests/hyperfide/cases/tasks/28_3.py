#!/usr/bin/env python3
"""Qualify the readiness checker with controlled inventories; never claim an actual release."""
import json,runpy,sys
from pathlib import Path
H=runpy.run_path(str(Path(__file__).with_name("28_2.py")))
fixture=H["fixture"];call=H["call"];check=H["check"];require=H["require"];node=H["node"];FAILED=H["FAILED"]
NODE_BASE="""
import{validateReadinessInventory,RELEASE_GATES}from'./services/hyperfide/dist/release/readiness.js';
import{contentDigest}from'./services/hyperfide/dist/docs/closure.js';
// Controlled pack: a self-consistent fixture contract, independent of live spec drift.
const c={clauses:['1.1','2.1','2.2'],
 tasks:[{id:'1.1',reqs:['1.1'],acceptance_ids:['V-901'],requires:[],wave:1},{id:'2.1',reqs:['2.1','2.2'],acceptance_ids:['V-902','V-903'],requires:['1.1'],wave:2}],
 cases:{'V-901':{},'V-902':{},'V-903':{}},native_case_requirements:{'V-901':['1.1'],'V-902':['2.1','2.2'],'V-903':['2.1','2.2']},
 mappings:[{id:'1.1',task_ids:['1.1'],acceptance_ids:['V-901'],chapters:['requirements.md']},{id:'2.1',task_ids:['2.1'],acceptance_ids:['V-902','V-903'],chapters:['requirements.md']},{id:'2.2',task_ids:['2.1'],acceptance_ids:['V-902','V-903'],chapters:['verification.md']}],
 source_pins:[]};
for(const[k,v]of Object.entries(c.cases))v.full_assertion_ids=['synthetic.assertion.'+k];
// Keep the controlled pack complete under the public traceability contract.
c.source_pins=['requirements.md','verification.md','reviews/README.md'].map(name=>({path:'spec/hyperfide/'+name,sha256:contentDigest('synthetic-'+name),size:0}));
c.review_states={
 original_approval:{source:'spec/hyperfide/spec.kvx',implementation_authorized:true,task_status:{'1.1':'done','2.1':'done'},grants_product_qualification:false},
 pack_review:{source:'spec/hyperfide/reviews/README.md',sha256:c.source_pins[2].sha256,scope:'DESIGN_AND_AUTHORING_ONLY',grants_implementation_approval:false,grants_product_qualification:false},
 product_qualification:{source:'spec/hyperfide/spec.kvx',case_qualification:Object.fromEntries(Object.keys(c.cases).map(name=>[name,'UNRUN'])),qualified_case_ids:[],unresolved_case_ids:Object.keys(c.cases)}
};
c.contract_digest=contentDigest({fixture_only:true,contract:c});
const revision='f'.repeat(40),source=contentDigest('synthetic-source-manifest');
const e=new Map(),names=Object.keys(c.cases);
for(const name of names)e.set(name,{reference:name,receipt_digest:contentDigest('synthetic-receipt-'+name),scope:'full-case',case_ids:[name],
 assertion_ids:c.cases[name].full_assertion_ids,outcome:'PASS',full_case_status:'PASS',implementation_revision:revision,source_manifest_digest:source,
 gate_kinds:[...RELEASE_GATES],resources:[]});
e.get(names[0]).resources=[{id:'fixture-resource',state:'CLEANED',owner:null,expires_at:null,retention_authorised:false,observed_at:new Date(Date.now()-1000).toISOString()}];
e.set('checker',{...e.get(names[0]),reference:'checker',scope:'task-component',full_case_status:'INCOMPLETE',gate_kinds:['checker_selftest'],resources:[]});
const p={schema_version:1,contract_digest:c.contract_digest,implementation_revision:revision,source_manifest_digest:source,
 clause_evidence:c.mappings.map(m=>({clause:m.id,task_ids:m.task_ids,case_ids:m.acceptance_ids,evidence_refs:m.acceptance_ids})),
 case_evidence:names.map(n=>({case_id:n,evidence_ref:n})),gate_evidence:RELEASE_GATES.map(kind=>({kind,evidence_refs:[kind==='checker_selftest'?'checker':names[0]]})),
 resource_ids:['fixture-resource'],unsupported_features:[]};
"""
def controlled(change="",positive=False):
    suffix=change+";let result;try{result=validateReadinessInventory(c,p,e)}catch(error){if("+str(positive).lower()+")throw error;process.exit(0)}if(result.complete!=="+str(positive).lower()+")throw Error('unexpected controlled result '+JSON.stringify(result));if("+str(positive).lower()+"&&(result.reasons.length!==0||result.checker_result_is_release_authority!==false||result.seal_requires_self_digest!==false))throw Error('checker selftest claimed authority');"
    result=node(NODE_BASE+suffix);require(result.returncode==0,result.stderr)


def portable_cleanup_resource(remove=False):
    import os,shutil
    record=H["fixture_artifact"]("task-28.3-portable.json")
    require(record.is_file(),"portable fixture ownership ledger missing")
    value=json.loads(record.read_text())
    require(value.get("owner")=="task:28.3" and isinstance(value.get("paths"),list)and value["paths"],"invalid portable cleanup ownership")
    for name in value["paths"]:
        path=Path(name)
        require(path.is_absolute()and path.parent==Path("/tmp")and (path.name.startswith("hyperfide-harness-selftest-")or path.name.startswith("hyperfide-proof-staging-")),"unsafe portable fixture cleanup path")
        require(not path.is_symlink(),"symbolic portable fixture root")
        if path.exists():
            require(path.is_dir()and path.stat().st_uid==os.geteuid(),"foreign portable fixture owner")
            if remove:shutil.rmtree(path)
    absent=all(not Path(name).exists()for name in value["paths"])
    value["observed_absent"]=absent;record.write_text(json.dumps(value,sort_keys=True)+"\n")
    return {"id":"task28.3-portable-fixtures","status":"deleted"if absent else"unknown","observed_absent":absent,"evidence_artifact":"docs/task-28.3-portable.json"}

def cleanup_readiness():
    import os
    portable=portable_cleanup_resource(True)
    saved_args=list(sys.argv);previous=os.environ.get("HYPERFIDE_CAMPAIGN_DIR")
    # The shared database cleaner performs real cleanup; publish one combined event.
    try:
        sys.argv=[value for value in sys.argv if value!="--cleanup"]
        if previous is None:os.environ["HYPERFIDE_CAMPAIGN_DIR"]="/tmp/hyperfide/domain28-standalone"
        H["cleanup_only"]("28.3")
    finally:
        sys.argv[:]=saved_args
        if previous is None:os.environ.pop("HYPERFIDE_CAMPAIGN_DIR",None)
    return 0 if H["cleanup_event"]("28.3",[portable])else 1


def portable_cases():
    import os,tempfile,importlib.util,fcntl
    assets=Path(os.environ.get("HYPERFIDE_RELEASE_TEST_PROOF_ASSETS","tests/hyperfide")).resolve()
    require((assets/"test_inspect_proof.py").is_file(),"actual 27 proof assets must be installed; no fallback checker")
    # Proof assets are the manifest-pinned 27.1 sources themselves; no unpinned staged copy.
    require(assets==Path("tests/hyperfide").resolve(),"proof assets must use the source-pinned test root")
    sys.path.insert(0,str(assets))
    spec=importlib.util.spec_from_file_location("actual27_release_probe",assets/"test_inspect_proof.py")
    supplier=importlib.util.module_from_spec(spec);spec.loader.exec_module(supplier)
    proof=supplier.ProofInspectionTests("test_portable_real_source_and_executable_checks")
    proof.setUp()
    paths=[str(proof.fixture.root)]
    def record_paths():H["fixture_artifact"]("task-28.3-portable.json").write_text(json.dumps({"owner":"task:28.3","paths":paths,"observed_absent":all(not Path(p).exists()for p in paths)},sort_keys=True)+"\n")
    record_paths()
    # Stage byte-identical copies of the pinned checker assets under a protected private root;
    # the workspace ancestry may be owned by a third account and is never trusted as-is.
    import shutil
    qualified=Path(tempfile.mkdtemp(prefix="hyperfide-proof-staging-qualified-"));paths.append(str(qualified));record_paths()
    for name in ("inspect-proof.py","check-evidence.py","proof_relocation.py","registry.json"):
        shutil.copyfile(assets/name,qualified/name);(qualified/name).chmod(0o644)
        require((qualified/name).read_bytes()==(assets/name).read_bytes(),"staged proof asset differs from pinned source: "+name)
    try:
        root,mapping=proof.portable()
        paths.append(str(root));record_paths()
        receipt=proof.request["receipt_id"]
        def inspect(expected=True,proof_assets=None):
            request={"root":str(root),"campaign":str(root/"campaign"),"receipt":receipt,"assets":str(proof_assets or qualified)}
            script="import{checkReleaseCampaign}from'./services/hyperfide/dist/release/readiness.js';const p="+json.dumps(request)+";try{const r=await checkReleaseCampaign(p.root,p.campaign,p.receipt,{env:{HYPERFIDE_RELEASE_QUALIFIED_PROOF_ROOT:p.assets},signal:new AbortController().signal});if(!"+str(expected).lower()+"||r.scope!=='task-component'||r.full_case_status!=='INCOMPLETE')throw Error('scope or expected refusal mismatch')}catch(e){if("+str(expected).lower()+"||!e.code)throw e}"
            result=node(script)
            require(result.returncode==0,"portable readiness check failed: "+result.stderr)
        check("readiness.portable-actual-canonical-component-only",inspect)
        def immutable_qualified_assets():
            import shutil
            with tempfile.TemporaryDirectory(prefix="hyperfide-proof-staging-assets-")as folder:
                isolated=Path(folder);paths.append(str(isolated));record_paths()
                for name in ("inspect-proof.py","check-evidence.py","proof_relocation.py","registry.json"):
                    shutil.copyfile(assets/name,isolated/name)
                before={p.name:p.read_bytes()for p in isolated.iterdir()}
                inspect(proof_assets=isolated)
                require(not list(isolated.rglob("__pycache__"))and not list(isolated.rglob("*.pyc")),"portable readiness wrote bytecode into qualified assets")
                require({p.name:p.read_bytes()for p in isolated.iterdir()}==before,"portable readiness changed qualified assets")
        check("readiness.portable-qualified-assets-remain-immutable",immutable_qualified_assets)
        def closed_environment():
            saved={key:os.environ.get(key)for key in["PATH","PYTHONHOME","PYTHONPATH","GIT_CONFIG_COUNT","GIT_CONFIG_KEY_0","GIT_CONFIG_VALUE_0"]}
            # Invalid benign paths demonstrate that no inherited lookup or import is used.
            try:
                os.environ.update(PATH="/nonexistent-release-probe",PYTHONHOME="/nonexistent-release-python",PYTHONPATH="/nonexistent-release-imports",
                                  GIT_CONFIG_COUNT="1",GIT_CONFIG_KEY_0="core.fsmonitor",GIT_CONFIG_VALUE_0="/nonexistent-release-helper")
                # node() resolves its trusted runtime before these overrides below.
                script="import{checkReleaseCampaign}from'./services/hyperfide/dist/release/readiness.js';const r=await checkReleaseCampaign("+json.dumps(str(root))+","+json.dumps(str(root/"campaign"))+","+json.dumps(receipt)+",{env:{HYPERFIDE_RELEASE_QUALIFIED_PROOF_ROOT:"+json.dumps(str(qualified))+"},signal:new AbortController().signal});if(r.scope!=='task-component')throw Error('unexpected scope');"
                import subprocess,shutil
                result=subprocess.run([node_runtime,"--input-type=module","-e",script],cwd=Path.cwd(),text=True,capture_output=True,timeout=160)
                require(result.returncode==0,"inherited environment affected checker: "+result.stderr)
            finally:
                for key,value in saved.items():
                    if value is None:os.environ.pop(key,None)
                    else:os.environ[key]=value
        import shutil
        node_runtime=shutil.which("node");require(bool(node_runtime),"trusted Node runtime missing")
        check("readiness.portable-closed-environment",closed_environment)
        def exposed():
            root.chmod(0o755)
            try:inspect(False)
            finally:root.chmod(0o700)
        check("readiness.portable-refuses-exposed-stage",exposed)
        def locked():
            with (root/".inspection.lock").open("a+b")as lock:
                fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
                try:inspect(False)
                finally:fcntl.flock(lock.fileno(),fcntl.LOCK_UN)
        check("readiness.portable-refuses-busy-stage",locked)
        def missing_map():
            path=root/"trusted-relocation.json";saved=path.read_bytes();path.unlink()
            try:inspect(False)
            finally:path.write_bytes(saved)
        check("readiness.portable-refuses-missing-relocation",missing_map)
        tool_entry=next(item for item in mapping["files"]if item["original"]==mapping["executables"][0]["original"])
        tool=root/tool_entry["staged"]
        def changed_tool():
            saved=tool.read_bytes();tool.write_bytes(saved+b"changed trusted archived tool")
            try:inspect(False)
            finally:tool.write_bytes(saved)
        check("readiness.portable-refuses-changed-original-tool",changed_tool)
        def changed_artifact():
            target=root/"campaign"/"artifacts"/receipt/"stdout.log";saved=target.read_bytes();target.write_bytes(saved+b"changed retained stream")
            try:inspect(False)
            finally:target.write_bytes(saved)
        check("readiness.portable-refuses-changed-artifact",changed_artifact)
        def missing_source_map():
            path=root/"trusted-relocation.json";saved=path.read_bytes();changed=dict(mapping)
            changed["files"]=[item for item in mapping["files"]if item["original"]!=str(Path(mapping["workspace"]["original"])/"probe.py")]
            path.write_text(json.dumps(changed))
            try:inspect(False)
            finally:path.write_bytes(saved)
        check("readiness.portable-refuses-unmapped-original-source",missing_source_map)
        # The source fixture has genuinely been removed; verify the retained anchor itself.
        check("readiness.portable-anchored-receipt-unchanged",lambda:require(supplier.sha((root/"campaign"/"receipts"/(receipt+".json")).read_bytes())==proof.request["receipt_digest"],"sealed receipt changed during relocation"))
    finally:
        if proof.staging and str(Path(proof.staging.name))not in paths:paths.append(str(Path(proof.staging.name)))
        proof.tearDown();shutil.rmtree(qualified,ignore_errors=True);record_paths()
    check("readiness.portable-temporary-sources-and-stage-removed",lambda:require(all(not Path(p).exists()for p in paths),"owned temporary source/stage remains"))
    with tempfile.TemporaryDirectory(prefix="hyperfide-release-index-")as folder:
        root=Path(folder);index=root/"admission.json"
        scope={"organisation_id":"10000000-0000-4000-8000-000000000001","run_id":"20000000-0000-4000-8000-000000000002"}
        body={"schema_version":2,**scope,"entries":[{"reference":"controlled","evidence_root":str(root),"campaign":str(root/"campaign"),"receipt_id":"30000000-0000-4000-8000-000000000003","receipt_digest":"sha256:"+"a"*64,"gate_kinds":["checker_selftest"]}]}
        index.write_text(json.dumps(body));index.chmod(0o600)
        def read(expected=True):
            script="import{loadReleaseAdmissionIndex}from'./services/hyperfide/dist/release/readiness.js';try{const r=await loadReleaseAdmissionIndex({env:{HYPERFIDE_RELEASE_EVIDENCE_INDEX:"+json.dumps(str(index))+"}},"+json.dumps(scope)+");if(!"+str(expected).lower()+"||r.length!==1||r[0].evidence_root!=="+json.dumps(str(root))+")throw Error('unexpected admission read')}catch(e){if("+str(expected).lower()+"||!e.code)throw e}"
            result=node(script);require(result.returncode==0,result.stderr)
        check("readiness.protected-scoped-index-v2",read)
        def unsafe_index():
            index.chmod(0o666)
            try:read(False)
            finally:index.chmod(0o600)
        check("readiness.refuses-writable-admission-index",unsafe_index)
        def symlink_index():
            saved=root/"saved.json";index.rename(saved);index.symlink_to(saved)
            try:read(False)
            finally:index.unlink();saved.rename(index)
        check("readiness.refuses-symbolic-admission-index",symlink_index)
        def legacy_index():
            index.write_text(json.dumps(dict(body,schema_version=1)))
            try:read(False)
            finally:index.write_text(json.dumps(body))
        check("readiness.refuses-nonportable-index-v1",legacy_index)

def main():
    H["configure_task"]("28.3")
    check("readiness.controlled-complete-inventory",lambda:controlled(positive=True))
    changes={
      "missing-case":"p.case_evidence.pop()",
      "missing-clause":"p.clause_evidence.pop()",
      "duplicate-case":"p.case_evidence.push(p.case_evidence[0])",
      "missing-gate":"p.gate_evidence.pop()",
      "component-is-not-full-case":"e.get(names[0]).scope='task-component';e.get(names[0]).full_case_status='INCOMPLETE'",
      "missing-assertion":"e.get(names[0]).assertion_ids=[]",
      "stale-commit":"e.get(names[0]).implementation_revision='a'.repeat(40)",
      "stale-source-manifest":"e.get(names[0]).source_manifest_digest=contentDigest('other-source')",
      "tampered-contract":"p.contract_digest=contentDigest('tampered')",
      "unknown-proof":"p.case_evidence[0].evidence_ref='absent'",
      "wrong-gate-proof":"e.get(names[0]).gate_kinds=[]",
      "omitted-resource":"p.resource_ids=[]",
      "unexplained-retention":"Object.assign(e.get(names[0]).resources[0],{state:'RETAINED',owner:null,expires_at:null,retention_authorised:false})",
      "expired-retention":"Object.assign(e.get(names[0]).resources[0],{state:'RETAINED',owner:'fixture-owner',expires_at:'2020-01-01T00:00:00.000Z',retention_authorised:true})",
      "wrong-clause-owner":"p.clause_evidence[0].task_ids=['999.1']",
      "missing-native-registration":"c.cases[names[0]].full_assertion_ids=[]",
      "force-override":"p.force=true",
      "recursive-seal-input":"p.seal_digest=contentDigest('self-reference')",
      "unsupported-feature-claimed":"p.unsupported_features=[{feature:names[0],reason:'not qualified'}]",
    }
    for name,change in changes.items():check("readiness.reject-"+name,lambda change=change:controlled(change))
    check("readiness.explicit-current-retention",lambda:controlled("Object.assign(e.get(names[0]).resources[0],{state:'RETAINED',owner:'fixture-owner',expires_at:new Date(Date.now()+60000).toISOString(),retention_authorised:true})",True))
    check("readiness.observed-later-cleanup",lambda:controlled("Object.assign(e.get(names[0]).resources[0],{state:'RETAINED',owner:'fixture-owner',expires_at:new Date(Date.now()+60000).toISOString(),retention_authorised:true});e.get(names[1]).resources=[{id:'fixture-resource',state:'CLEANED',owner:null,expires_at:null,retention_authorised:false,observed_at:new Date().toISOString()}]",True))
    def manifest_binding(tampered):
        script="import{pinnedCampaignManifest}from'./services/hyperfide/dist/release/readiness.js';import{sha256}from'./services/hyperfide/dist/docs/closure.js';const original=Buffer.from(JSON.stringify({policy:{source_manifest_digest:'sha256:'+('a'.repeat(64))}}));const receipt={manifest_sha256:sha256(original).slice(7)};const bytes="+("Buffer.from(JSON.stringify({policy:{source_manifest_digest:'sha256:'+('b'.repeat(64))}}))"if tampered else"original")+";try{const result=pinnedCampaignManifest(receipt,bytes);if("+str(tampered).lower()+")throw Error('tampered manifest accepted')}catch(e){if(!"+str(tampered).lower()+"||e.code!=='RELEASE_EVIDENCE_INVALID')throw e}"
        result=node(script);require(result.returncode==0,"manifest byte binding violated: "+result.stderr)
    check("readiness.exact-manifest-byte-binding",lambda:manifest_binding(False))
    check("readiness.reject-manifest-changed-after-checker",lambda:manifest_binding(True))
    portable_cases()
    # The trusted migration engine already applies 0028; do not re-apply it here.
    f=fixture(("15.2","28.4","28.3"),migrate=False)
    try:
        # A well-formed caller inventory; no caller field may substitute for admitted evidence.
        inventory={"schema_version":1,"contract_digest":H["digest"]("caller-contract"),"implementation_revision":"f"*40,"source_manifest_digest":H["digest"]("synthetic-source"),
          "clause_evidence":[{"clause":"1.1","task_ids":["1.1"],"case_ids":["V-901"],"evidence_refs":["unadmitted"]}],
          "case_evidence":[{"case_id":"V-901","evidence_ref":"unadmitted"}],
          "gate_evidence":[{"kind":k,"evidence_refs":["unadmitted"]}for k in["task","candidate","programme","policy","docs","restore","rollback","cleanup","traceability","checker_selftest"]],
          "resource_ids":[],"unsupported_features":[]}
        def no_unadmitted():
            error=call(f,"release.readiness.assess",{"inventory":inventory},component="28.3",ok=False)
            require(error.get("code")=="RELEASE_EVIDENCE_UNAVAILABLE","caller evidence substituted for authoritative admission")
        check("readiness.actual-service-refuses-unadmitted-proof",no_unadmitted)
        check("readiness.actual-service-rejects-empty-inventory",lambda:call(f,"release.readiness.assess",{"inventory":{}},component="28.3",ok=False))
        def seal_unadmitted():
            error=call(f,"release.readiness.seal",{"inventory":inventory},component="28.3",ok=False)
            require(error.get("code")=="RELEASE_EVIDENCE_UNAVAILABLE","seal bypassed trusted evidence admission")
            rows=f.sql("SELECT count(*)::int AS n FROM hyperfide.release_records")
            require(rows[0]["n"]==0,"held seal wrote an authority record")
        check("readiness.actual-seal-refuses-unadmitted-proof",seal_unadmitted)
        def seal_guard():
            rows=f.sql("SELECT tgname FROM pg_trigger WHERE tgrelid='hyperfide.release_records'::regclass AND NOT tgisinternal ORDER BY tgname")
            require([r["tgname"]for r in rows]==["aaa_supported_isolation","immutable_documentation"],"release seal lacks isolation or immutability")
        check("readiness.actual-seal-table-guarded",seal_guard)
    finally:f.close()
    H["cleanup_event"]("28.3",[portable_cleanup_resource()])
    return 1 if FAILED else 0
if __name__=="__main__" and "--portable-only" in sys.argv:
    portable_cases();sys.exit(bool(FAILED))
if __name__=="__main__":sys.exit(cleanup_readiness()if "--cleanup"in sys.argv else main())
