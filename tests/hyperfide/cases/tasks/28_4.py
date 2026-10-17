#!/usr/bin/env python3
"""Public traceability is exercised through real authenticated service and controlled negatives."""
import base64,copy,hashlib,importlib.util,json,runpy,sys
from pathlib import Path
H=runpy.run_path(str(Path(__file__).with_name("28_2.py")))
fixture=H["fixture"];call=H["call"];check=H["check"];require=H["require"];node=H["node"];FAILED=H["FAILED"]
def main():
    H["configure_task"]("28.4")
    backend_spec=importlib.util.spec_from_file_location("hyperfide_archive_backend",H["ROOT"]/"tests/hyperfide/cases/tasks/15_2.py")
    B=importlib.util.module_from_spec(backend_spec);backend_spec.loader.exec_module(B)
    backend=B.ObjectFixture()
    H["fixture_artifact"]("task-28.4-object-store.json").write_text(json.dumps({"ports":[backend.port,backend.sink.server_port],"owner":"task:28.4","observed_absent":False})+"\n")
    def setup_archive(f):
        H["setup"](f)
        f.env.update({"HF_ARTIFACT_S3_ENDPOINT":backend.endpoint,"HF_ARTIFACT_ALLOW_LOOPBACK_HTTP":"1","HF_ARTIFACT_S3_REGION":B.REGION,"HF_ARTIFACT_S3_BUCKET":B.BUCKET,"HF_ARTIFACT_S3_ACCESS_KEY_ID":B.KEY,"HF_ARTIFACT_S3_SECRET_ACCESS_KEY":B.SECRET,"HF_ARTIFACT_S3_SESSION_TOKEN":B.TOKEN,"HF_ARTIFACT_ORGANISATION_ID":f.ids["organisation"],"HF_ARTIFACT_ALLOWED_RUN_IDS":json.dumps([f.ids["run"]])})
    f=H["IdentityFixture"](extra_components=("15.2","28.4"),extra_setup=setup_archive)
    try:
        current=call(f,"release.traceability.contract",{},component="28.4")
        contract=current["contract"]
        request={"contract_digest":contract["contract_digest"],"mapping_digest":current["mapping_digest"]}
        receipt=call(f,"release.traceability.validate",request,component="28.4")
        check("traceability.actual-service-roundtrip",lambda:require(receipt["receipt"]["observed"]["valid"]and len(contract["clauses"])==112 and len(contract["tasks"])==112 and len(contract["cases"])==56,"native coverage is incomplete"))
        check("traceability.not-product-qualification",lambda:require(receipt["product_qualification"]is False and receipt["receipt"]["qualification_authority"]=="NONE"and not receipt["receipt"]["observed"]["component_receipt_is_full_case"],"structural mapping was promoted"))
        check("traceability.public-source-manifest",lambda:require(len(receipt["receipt"]["public_records"])>=15 and receipt["receipt"]["records_embedded"]is False and all("/private/"not in r["path"]and "content_base64"not in r for r in receipt["receipt"]["public_records"]),"public evidence retention incomplete or private"))
        def stale_digest():
            bad=dict(request);bad["mapping_digest"]=H["digest"]("stale")
            call(f,"release.traceability.validate",bad,component="28.4",ok=False)
        check("traceability.stale-mapping-refused",stale_digest)
        def archive_roundtrip():
            archived=call(f,"release.traceability.archive",request,component="28.4")
            require(archived["archived"]and archived["product_qualification"]is False and archived["grants_authority"]is False,"archive was promoted to qualification")
            require(archived["manifest"]is True and archived["artifact"]["status"]=="COMPLETE","large pack was not durably chunked")
            objects=list(backend.objects.values())
            manifests=[json.loads(b)for b in objects if b.startswith(b'{"schema_version":1,"kind":"chunked-artifact"')]
            if not manifests:manifests=[json.loads(b)for b in objects if b.startswith(b'{')and b'"chunks"'in b and b'"content_digest"'in b]
            manifest=next(m for m in manifests if m.get("content_digest")==archived["content_digest"])
            by_hash={"sha256:"+hashlib.sha256(b).hexdigest():b for b in objects}
            restored=b"".join(by_hash[c["digest"]]for c in manifest["chunks"])
            require("sha256:"+hashlib.sha256(restored).hexdigest()==archived["content_digest"],"stored archive bytes differ")
            payload=json.loads(restored)["payload"]
            require(len(payload["public_records"])>=15 and all("content_base64"in p and "/private/"not in p["path"]for p in payload["public_records"]),"retained source record missing or private")
            for record in payload["public_records"]:
                raw=base64.b64decode(record["content_base64"],validate=True)
                require(H["digest"](json.loads(raw))is not None if record["path"].endswith(".json")else True,"invalid retained JSON")
                require("sha256:"+hashlib.sha256(raw).hexdigest()==record["sha256"]and len(raw)==record["size"],"retained public source digest changed")
            require(not backend.bad_signatures and any(e["method"]=="GET"for e in backend.events),"actual independent signed byte verification absent")
        check("traceability.durable-public-archive",archive_roundtrip)
        def archive_unknown_refused():
            with backend.lock:
                for key in backend.objects:backend.modes[key]="forbidden"
            call(f,"release.traceability.archive",request,component="28.4",ok=False)
            with backend.lock:backend.modes.clear()
        check("traceability.unavailable-archive-not-success",archive_unknown_refused)
        changes={
          "missing-clause":"c.mappings.pop()",
          "duplicate-clause":"c.mappings.push(c.mappings[0])",
          "unknown-task":"c.mappings[0].task_ids=['999.1']",
          "wrong-case":"c.mappings[0].acceptance_ids=['V-999']",
          "missing-source-chapter":"c.mappings[0].chapters=[]",
          "missing-task-requirement":"c.tasks[0].reqs=['999.1']",
          "unknown-case-registry":"c.cases['V-999']={full_assertion_ids:[]}",
          "dependency-cycle":"c.tasks[0].requires=[c.tasks[0].id]",
          "native-case-mismatch":"c.native_case_requirements[Object.keys(c.native_case_requirements)[0]].pop()",
        }
        for name,change in changes.items():
            def reject(change=change):
                script="import fs from'node:fs';import{validateTraceability}from'./services/hyperfide/dist/release/traceability.js';const c=JSON.parse(fs.readFileSync(0,'utf8'));"+change+";try{validateTraceability(c);process.exit(1)}catch(e){if(e.code!=='CLOSURE_INVALID')throw e}"
                result=node(script,contract);require(result.returncode==0,"controlled invalid pack accepted: "+result.stderr)
            check("traceability.reject-"+name,reject)
    finally:
        try:f.close()
        finally:
            backend_absent=backend.stop()
            H["fixture_artifact"]("task-28.4-object-store.json").write_text(json.dumps({"ports":[backend.port,backend.sink.server_port],"owner":"task:28.4","observed_absent":backend_absent})+"\n")
    H["cleanup_event"]("28.4",[{"id":"task28.4-fixture-object-store","status":"deleted"if backend_absent else"unknown","observed_absent":backend_absent,"evidence_artifact":"docs/task-28.4-object-store.json"}])
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(H["cleanup_only"]("28.4")if "--cleanup"in sys.argv else main())
