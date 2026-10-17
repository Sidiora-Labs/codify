#!/usr/bin/env python3
"""Public traceability is exercised through real authenticated service and controlled negatives."""
import base64,copy,hashlib,importlib.util,json,os,re,runpy,shutil,sys,tempfile
from pathlib import Path
H=runpy.run_path(str(Path(__file__).with_name("28_2.py")))
fixture=H["fixture"];call=H["call"];check=H["check"];require=H["require"];node=H["node"];FAILED=H["FAILED"]
ROOT=H["ROOT"];SPEC="spec/hyperfide/"
def kvx_sections(text):
    """Independent re-reading of native records: section -> key -> raw value."""
    sections,current={},None
    for line in text.splitlines():
        m=re.match(r"^\[([^\]]+)\]\s*$",line)
        if m:current=sections.setdefault(m.group(1),{});continue
        m=re.match(r"^([a-z_0-9]+)\s*=\s*(.*)$",line)
        if current is not None and m:current[m.group(1)]=m.group(2)
    return sections
def independent_view(root):
    sections=kvx_sections((root/SPEC/"spec.kvx").read_text())
    catalog=json.loads((root/SPEC/"evidence/task-catalog.json").read_text());tasks=catalog if isinstance(catalog,list)else catalog["tasks"]
    native={n[11:]:json.loads(v["reqs"])for n,v in sections.items()if n.startswith("acceptance.")}
    mismatches={}
    for case,reqs in native.items():
        projected=sorted({r for t in tasks if case in t["acceptance_ids"]for r in t["reqs"]})
        if projected!=sorted(reqs):mismatches[case]=projected
    clauses=[n[4:]+"."+k[3:]for n,v in sections.items()if n.startswith("req.")for k in v if re.fullmatch(r"ac_[1-9][0-9]*",k)]
    qualification={c:json.loads(sections["acceptance."+c].get("qualification",'"UNDECLARED"'))for c in native}
    return {"clauses":len(clauses),"tasks":len(tasks),"cases":len(json.loads((root/"tests/hyperfide/registry.json").read_text())["cases"]),
            "mismatches":mismatches,"authorized":sections["meta"].get("implementation_authorized")=="true",
            "unresolved":sorted(c for c,q in qualification.items()if q!="PASS")}
def controlled_pack(base,mismatches):
    """Copy the public pack; align only diagnosed native case lines so mechanics can be exercised. Real tree is never edited."""
    root=Path(os.path.realpath(base))
    shutil.copytree(ROOT/SPEC,root/SPEC)
    for rel in("docs/hyperfide/operations.md","tests/hyperfide/registry.json"):
        (root/rel).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/rel,root/rel)
    lines=(root/SPEC/"spec.kvx").read_text().split("\n");section=None
    for i,line in enumerate(lines):
        m=re.match(r"^\[([^\]]+)\]\s*$",line)
        if m:section=m.group(1);continue
        if section and section[11:]in mismatches and section.startswith("acceptance.")and line.startswith("reqs ="):lines[i]="reqs = "+json.dumps(mismatches[section[11:]])
    (root/SPEC/"spec.kvx").write_text("\n".join(lines))
    (root/SPEC/"private").mkdir();(root/SPEC/"private/audit.md").write_text("access-controlled source audit fixture\n")
    return root
def main():
    H["configure_task"]("28.4")
    backend_spec=importlib.util.spec_from_file_location("hyperfide_archive_backend",H["ROOT"]/"tests/hyperfide/cases/tasks/15_2.py")
    B=importlib.util.module_from_spec(backend_spec);backend_spec.loader.exec_module(B)
    backend=B.ObjectFixture()
    H["fixture_artifact"]("task-28.4-object-store.json").write_text(json.dumps({"ports":[backend.port,backend.sink.server_port],"owner":"task:28.4","observed_absent":False})+"\n")
    def setup_archive(f,pack_root=None):
        # The integrated fixture applies migrations; setup verifies the exact 0028 pin.
        H["setup"](f)
        if pack_root:f.env["HF_TRACEABILITY_PACK_ROOT"]=pack_root
        f.env.update({"HF_ARTIFACT_S3_ENDPOINT":backend.endpoint,"HF_ARTIFACT_ALLOW_LOOPBACK_HTTP":"1","HF_ARTIFACT_S3_REGION":B.REGION,"HF_ARTIFACT_S3_BUCKET":B.BUCKET,"HF_ARTIFACT_S3_ACCESS_KEY_ID":B.KEY,"HF_ARTIFACT_S3_SECRET_ACCESS_KEY":B.SECRET,"HF_ARTIFACT_S3_SESSION_TOKEN":B.TOKEN,"HF_ARTIFACT_ORGANISATION_ID":f.ids["organisation"],"HF_ARTIFACT_ALLOWED_RUN_IDS":json.dumps([f.ids["run"]])})
    real=independent_view(ROOT)
    workdir=tempfile.mkdtemp(prefix="task28.4-pack-")
    pack_root=controlled_pack(workdir,real["mismatches"])
    H["fixture_artifact"]("task-28.4-controlled-pack.json").write_text(json.dumps({"implemented_revision_mismatches":real["mismatches"],"controlled_alignment":"native acceptance reqs aligned to task projection in a temporary copy only"},sort_keys=True)+"\n")
    fa=fb=None
    try:
        fa=H["IdentityFixture"](extra_components=("15.2","28.4"),extra_setup=setup_archive)
        fb=H["IdentityFixture"](extra_components=("15.2","28.4"),extra_setup=lambda f:setup_archive(f,str(pack_root)))
        actual=call(fa,"release.traceability.contract",{},component="28.4")
        actual_request={"contract_digest":actual["contract"]["contract_digest"],"mapping_digest":actual["mapping_digest"]}
        def implemented_verdict():
            require(actual["pack_origin"]=="IMPLEMENTED_REVISION"and actual["implemented_revision"]is True,"implemented revision mislabelled")
            if real["mismatches"]:
                first=sorted(real["mismatches"])[0]
                require(actual["validation"]["valid"]is False and first in actual["validation"]["finding"]and "mismatch"in actual["validation"]["finding"],"genuine defect not diagnosed: "+str(actual["validation"]))
                for action in("release.traceability.validate","release.traceability.archive"):
                    error=call(fa,action,actual_request,component="28.4",ok=False)
                    require(error.get("code")=="CLOSURE_INVALID"and first in error.get("message",""),action+" accepted an invalid implemented revision")
            else:
                require(actual["validation"]["valid"]is True,"valid revision refused: "+str(actual["validation"]))
                ok=call(fa,"release.traceability.validate",actual_request,component="28.4")
                require(ok["receipt"]["implemented_revision"]is True and ok["receipt"]["pack_origin"]=="IMPLEMENTED_REVISION","implemented receipt mislabelled")
        check("traceability.implemented-revision-verdict",implemented_verdict)
        current=call(fb,"release.traceability.contract",{},component="28.4")
        contract=current["contract"]
        request={"contract_digest":contract["contract_digest"],"mapping_digest":current["mapping_digest"]}
        receipt=call(fb,"release.traceability.validate",request,component="28.4")
        check("traceability.actual-service-roundtrip",lambda:require(receipt["receipt"]["observed"]["valid"]and current["validation"]["valid"]and len(contract["clauses"])==real["clauses"]and len(contract["tasks"])==real["tasks"]and len(contract["cases"])==real["cases"]and receipt["receipt"]["pack_origin"]=="CONTROLLED"and receipt["receipt"]["implemented_revision"]is False,"native coverage is incomplete or controlled pack mislabelled"))
        check("traceability.not-product-qualification",lambda:require(receipt["product_qualification"]is False and receipt["receipt"]["qualification_authority"]=="NONE"and not receipt["receipt"]["observed"]["component_receipt_is_full_case"],"structural mapping was promoted"))
        check("traceability.public-source-manifest",lambda:require(len(receipt["receipt"]["public_records"])>=15 and receipt["receipt"]["records_embedded"]is False and all("/private/"not in r["path"]and "content_base64"not in r for r in receipt["receipt"]["public_records"]),"public evidence retention incomplete or private"))
        def review_states():
            observed=receipt["receipt"]["observed"];states=observed["review_states"]
            readme=(pack_root/SPEC/"reviews/README.md").read_bytes()
            require(observed["implementation_approval_is_product_qualification"]is False and observed["pack_review_is_implementation_approval"]is False and observed["pack_review_is_product_qualification"]is False,"authorities conflated")
            require(states["original_approval"]["implementation_authorized"]is real["authorized"]and states["original_approval"]["source"]==SPEC+"spec.kvx","original approval not read from native spec")
            require(states["pack_review"]["scope"]=="DESIGN_AND_AUTHORING_ONLY"and states["pack_review"]["sha256"]=="sha256:"+hashlib.sha256(readme).hexdigest(),"pack review disposition not pinned")
            q=states["product_qualification"]
            require(sorted(q["unresolved_case_ids"])==real["unresolved"]and sorted(q["qualified_case_ids"])==sorted(set(contract["cases"])-set(real["unresolved"])),"open qualification items not reported explicitly")
            full=contract["review_states"]
            require(full["original_approval"]["grants_product_qualification"]is False and full["pack_review"]["grants_implementation_approval"]is False and full["pack_review"]["grants_product_qualification"]is False,"review state grants authority")
        check("traceability.review-states-distinguished",review_states)
        def private_audit():
            require(all("private"not in r["path"].split("/")for r in contract["source_pins"]),"private audit pinned as a source")
            shutil.rmtree(pack_root/SPEC/"private")
            again=call(fb,"release.traceability.contract",{},component="28.4")
            require(again["contract"]["contract_digest"]==contract["contract_digest"]and again["validation"]["valid"],"private audit influenced the public contract")
            call(fb,"release.traceability.validate",request,component="28.4")
        check("traceability.private-audit-not-dependency",private_audit)
        def stale_digest():
            bad=dict(request);bad["mapping_digest"]=H["digest"]("stale")
            call(fb,"release.traceability.validate",bad,component="28.4",ok=False)
        check("traceability.stale-mapping-refused",stale_digest)
        def archive_roundtrip():
            archived=call(fb,"release.traceability.archive",request,component="28.4")
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
            call(fb,"release.traceability.archive",request,component="28.4",ok=False)
            with backend.lock:backend.modes.clear()
        check("traceability.unavailable-archive-not-success",archive_unknown_refused)
        def accepted():
            unsigned={k:v for k,v in contract.items()if k!="contract_digest"}
            require(H["digest"](unsigned)==contract["contract_digest"],"independent digest recomputation differs")
            result=call(fb,"release.traceability.check",{"pack":contract},component="28.4")
            require(result["accepted"]is True and result["product_qualification"]is False and result["qualification_authority"]=="NONE","controlled pack not accepted")
        check("traceability.controlled-pack-accepted",accepted)
        INTEGRITY=("Tampered release pack digest","Release pack does not match the implemented revision")
        def mutate_states(c,key,field,value):c["review_states"][key][field]=value
        changes={
          "missing-clause":lambda c:c["mappings"].pop(),
          "duplicate-clause":lambda c:c["mappings"].append(copy.deepcopy(c["mappings"][0])),
          "unknown-task":lambda c:c["mappings"][0].__setitem__("task_ids",["999.1"]),
          "wrong-case":lambda c:c["mappings"][0].__setitem__("acceptance_ids",["V-999"]),
          "missing-source-chapter":lambda c:c["mappings"][0].__setitem__("chapters",[]),
          "missing-task-requirement":lambda c:c["tasks"][0].__setitem__("reqs",["999.1"]),
          "unknown-case-registry":lambda c:c["cases"].__setitem__("V-999",{"full_assertion_ids":[]}),
          "dependency-cycle":lambda c:c["tasks"][0].__setitem__("requires",[c["tasks"][0]["id"]]),
          "native-case-mismatch":lambda c:c["native_case_requirements"][sorted(c["native_case_requirements"])[0]].pop(),
          "private-source":lambda c:c["mappings"][0].__setitem__("chapters",["private/audit.md"]),
          "review-promoted-to-qualification":lambda c:mutate_states(c,"pack_review","grants_product_qualification",True),
          "unreported-open-qualification":lambda c:mutate_states(c,"product_qualification","unresolved_case_ids",[]),
        }
        for name,change in changes.items():
            def reject(change=change):
                bad=copy.deepcopy(contract);change(bad)
                error=call(fb,"release.traceability.check",{"pack":bad},component="28.4",ok=False)
                require(error.get("code")=="CLOSURE_INVALID"and error.get("message")not in INTEGRITY,"controlled invalid pack not structurally rejected: "+str(error))
            check("traceability.reject-"+name,reject)
        def tampered():
            bad=copy.deepcopy(contract);bad["source_pins"][0]["sha256"]=H["digest"]("tampered")
            error=call(fb,"release.traceability.check",{"pack":bad},component="28.4",ok=False)
            require(error.get("message")==INTEGRITY[0],"tampered source pin not detected: "+str(error))
        check("traceability.reject-tampered-digest",tampered)
        def stale_revision():
            bad=copy.deepcopy(contract);bad["source_pins"][0]["sha256"]=H["digest"]("other revision")
            bad["contract_digest"]=H["digest"]({k:v for k,v in bad.items()if k!="contract_digest"})
            error=call(fb,"release.traceability.check",{"pack":bad},component="28.4",ok=False)
            require(error.get("message")==INTEGRITY[1],"self-consistent pack for another revision accepted: "+str(error))
        check("traceability.reject-stale-revision",stale_revision)
    finally:
        try:
            for f in(fb,fa):
                if f is not None:f.close()
        finally:
            shutil.rmtree(workdir,ignore_errors=True)
            backend_absent=backend.stop()
            H["fixture_artifact"]("task-28.4-object-store.json").write_text(json.dumps({"ports":[backend.port,backend.sink.server_port],"owner":"task:28.4","observed_absent":backend_absent})+"\n")
    H["cleanup_event"]("28.4",[{"id":"task28.4-fixture-object-store","status":"deleted"if backend_absent else"unknown","observed_absent":backend_absent,"evidence_artifact":"docs/task-28.4-object-store.json"}])
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(H["cleanup_only"]("28.4")if "--cleanup"in sys.argv else main())
