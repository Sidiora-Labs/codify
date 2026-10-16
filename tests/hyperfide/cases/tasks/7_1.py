#!/usr/bin/env python3
"""Real native extraction through the registered remote dispatch service.

This component receipt covers extraction and immutable transfer only. It does
not qualify legacy state migration or central graph search parity.
"""
from __future__ import annotations
import base64,copy,hashlib,json,os,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
ASSERTIONS=[]
FAILURES=[]
OBSERVATIONS=[]
UUIDS={"organisation_id":"10000000-0000-4000-8000-000000000001",
       "run_id":"10000000-0000-4000-8000-000000000002",
       "repository_id":"10000000-0000-4000-8000-000000000003"}
ACTIONS=["graph.extract.describe","graph.extract.create","graph.extract.inspect","graph.extract.read-chunk"]
def encoded(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)
def sha(value):return "sha256:"+hashlib.sha256(value if isinstance(value,bytes) else value.encode()).hexdigest()
def expect(value,message):
    if not value:raise AssertionError(message)
def check(identity,fn):
    ASSERTIONS.append(identity)
    try:fn();actual="observed"
    except Exception as error:actual=type(error).__name__+": "+str(error);FAILURES.append(identity)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def process(args,cwd,**kw):
    result=subprocess.run(args,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,**kw)
    expect(result.returncode==0,"fixture subprocess failed: "+result.stderr[-1000:])
    return result.stdout.strip()
class Service:
    def __init__(self,base):
        self.base=base;self.repo=base/"repo";self.repo.mkdir()
        self.scratch=base/"scratch";self.scratch.mkdir()
        process(["git","init","-q"],self.repo)
        process(["git","config","user.name","Hyperfide component fixture"],self.repo)
        process(["git","config","user.email","fixture@example.invalid"],self.repo)
        (self.repo/"maths.py").write_text("# @contract Preserve the counted result.\ndef helper(value):\n    return value + 1\n\ndef consume(value):\n    return helper(value)\n\nBODY_SENTINEL = 'body words searchable corpus'\n")
        (self.repo/"route.js").write_text("export function endpoint(value) { return value; }\n// Intent: this endpoint preserves its input.\napp.get('/api/items', endpoint);\n")
        (self.repo/"README.md").write_text("Documentation corpus includes unrelated prose and Unicode café.\n")
        process(["git","add","."],self.repo);process(["git","commit","-qm","pinned fixture"],self.repo)
        self.commit=process(["git","rev-parse","HEAD"],self.repo)
        self.tree=process(["git","rev-parse","HEAD^{tree}"],self.repo)
        self.config=base/"graph-config.json"
        self.configuration={"schema_version":1,"execution_role":"REMOTE","scratch_root":str(self.scratch),
            "cg_binary":str(ROOT/"cg"),"cg_digest":sha((ROOT/"cg").read_bytes()),"repositories":{UUIDS["repository_id"]:str(self.repo)}}
        self.config.write_text(encoded(self.configuration))
        self.parts=base/"components";self.parts.mkdir()
        for task in ["7.1"]:(self.parts/(task+".json")).write_bytes((ROOT/"services/hyperfide/components"/(task+".json")).read_bytes())
        policy={"schema_version":1,"programme_id":"graph-extraction-component","repository":"fixture/repo",
            "spec_revision":"graph-extraction-fixture-v1","policy_revision":1,"status":"ACTIVE",
            "approval":{"decision":"APPROVED","record_id":"approved-component-test","spec_revision":"graph-extraction-fixture-v1","policy_revision":1},
            "allowed_roles":["dispatch"],"allowed_actions":["programme.dispatch"]+ACTIONS}
        self.policy=base/"policy.json";self.policy.write_text(encoded(policy))
        self.input=dict(UUIDS,commit=self.commit,tree=self.tree,generation="1",
            configuration={"build_flags":[],"resolver_digest":sha(b"resolver-fixture"),"generated_manifest_digest":sha(b"generated-fixture")})
        self.env=os.environ.copy();self.env["HYPERFIDE_GRAPH_CONFIG"]=str(self.config)
    def request(self,action,value,env=None):
        result=subprocess.run(["node",str(ROOT/"services/hyperfide/dist/dispatch.js"),"--policy",str(self.policy),
            "--spec-revision","graph-extraction-fixture-v1","--components",str(self.parts),
            "--module-root",str(ROOT/"services/hyperfide/dist")],
            input=encoded({"id":"graph-probe","component":"7.1","action":action,"input":value})+"\n",
            text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,env=env or self.env,timeout=180)
        lines=result.stdout.splitlines()
        expect(len(lines)==1,"registered service must return one correlated response: "+result.stderr[-1500:])
        value=json.loads(lines[0]);expect(value.get("id")=="graph-probe","response correlation differs")
        OBSERVATIONS.append({"action":action,"ok":value.get("ok"),"code":value.get("error",{}).get("code")})
        return result,value
    def ok(self,action,value):
        process,response=self.request(action,value)
        expect(process.returncode==0 and response.get("ok") is True,"positive operation refused: "+encoded(response.get("error",{})))
        return response["result"]
    def reject(self,action,value,code=None):
        process,response=self.request(action,value)
        expect(process.returncode!=0 and response.get("ok") is False,"invalid operation was accepted")
        if code:expect(response.get("error",{}).get("code")==code,"rejection differs: "+encoded(response))
    def chunks(self,manifest):
        chunks=[self.ok("graph.extract.read-chunk",{"bundle_digest":manifest["bundle_digest"],"index":i}) for i in range(len(manifest["chunks"]))]
        for c,expected in zip(chunks,manifest["chunks"]):
            body={k:v for k,v in c.items() if k!="digest"}
            expect(sha(encoded(body))==c["digest"]==expected["digest"],"actual chunk hash differs")
            expect(len(encoded(c).encode())==expected["bytes"],"actual chunk bytes differ")
        return chunks
def main():
    with tempfile.TemporaryDirectory(prefix="hf-graph-7.1-") as directory:
        base=Path(directory);service=Service(base);state={}
        check("graph.extraction.describe",lambda:expect(service.ok("graph.extract.describe",{})["central_publication"] is False,"extraction claimed publication"))
        def create():
            state["manifest"]=service.ok("graph.extract.create",service.input)
            expect(state["manifest"]["complete"],"actual scanner produced incomplete fixture")
            expect(state["manifest"]["counts"]["symbols"]>=3,"actual scanner missed known fixture symbols")
        check("graph.extraction.actual-native",create)
        if "manifest" not in state:
            return 1
        manifest=state["manifest"]
        check("graph.extraction.immutable-inspect",lambda:expect(service.ok("graph.extract.inspect",{"bundle_digest":manifest["bundle_digest"]})==manifest,"inspection changed manifest"))
        def chunks():
            state["chunks"]=service.chunks(manifest)
            state["facts"]=[row for c in state["chunks"] for row in c["rows"]]
            expect(len(state["facts"])==sum(manifest["counts"].values()),"fact counts differ")
        check("graph.extraction.chunk-bytes-digests",chunks)
        facts=state.get("facts",[])
        check("graph.extraction.symbol-coverage",lambda:expect({"helper","consume","endpoint"}.issubset({f["row"].get("name") for f in facts if f["table"]=="symbols"}),"actual parser symbols lost"))
        check("graph.extraction.comment-coverage",lambda:expect(any("counted result" in f["row"].get("body","") for f in facts if f["table"]=="comments"),"actual anchored comment lost"))
        check("graph.extraction.body-coverage",lambda:expect(any(b"body words searchable corpus" in base64.b64decode(f["row"]["body_base64"]) for f in facts if f["table"]=="source_bodies"),"actual source body lost"))
        check("graph.extraction.semantic-coverage",lambda:expect(manifest["counts"]["semantic_symbols"]>0 and manifest["counts"]["semantic_references"]>0,"semantic facts lost"))
        check("graph.extraction.health-coverage",lambda:expect(any(f["table"]=="extraction_health" for f in facts),"parser/skip coverage missing"))
        check("graph.extraction.non-authoritative",lambda:expect(manifest["authority"]=="NONE" and manifest["cache"]=="NON_AUTHORITATIVE","local extraction granted authority"))
        check("graph.extraction.exact-source",lambda:expect(manifest["identity"]["commit"]==service.commit and manifest["identity"]["tree"]==service.tree,"source identity differs"))
        check("graph.extraction.repeat-deterministic",lambda:expect(service.ok("graph.extract.create",service.input)==manifest,"identical source produced different bundle"))
        def changed(field,value):
            request=copy.deepcopy(service.input);request[field]=value
            actual=service.ok("graph.extract.create",request)
            expect(actual["bundle_digest"]!=manifest["bundle_digest"],"relevant identity did not alter bundle")
        check("graph.extraction.generation-isolation",lambda:changed("generation","2"))
        def config_change():
            request=copy.deepcopy(service.input);request["configuration"]["build_flags"]=["--fixture-flag"]
            actual=service.ok("graph.extract.create",request)
            expect(actual["identity"]["config_digest"]!=manifest["identity"]["config_digest"],"build configuration was not pinned")
        check("graph.extraction.config-isolation",config_change)
        def overlay():
            body=b"def replacement():\n    return 42\n"
            files=[{"path":"maths.py","content_base64":base64.b64encode(body).decode(),"digest":sha(body),"mode":"100644"}]
            request=copy.deepcopy(service.input);request["overlay"]={"name":"review-candidate","digest":sha(encoded(files)),"files":files}
            result=service.ok("graph.extract.create",request)
            expect(result["identity"]["source_kind"]=="OVERLAY" and result["identity"]["overlay_digest"]==sha(encoded(files)),"overlay presented as committed source")
            parsed=[r for c in service.chunks(result) for r in c["rows"]]
            names={f["row"].get("name") for f in parsed if f["table"]=="symbols"}
            expect("replacement" in names and "helper" not in names,"overlay source did not drive actual parser")
        check("graph.extraction.named-overlay",overlay)
        check("graph.extraction.reject-false-tree",lambda:service.reject("graph.extract.create",dict(service.input,tree="f"*40),"GRAPH_SOURCE_MISMATCH"))
        check("graph.extraction.reject-unknown-repository",lambda:service.reject("graph.extract.create",dict(service.input,repository_id="10000000-0000-4000-8000-000000000099"),"GRAPH_REPOSITORY_DENIED"))
        check("graph.extraction.reject-numeric-generation",lambda:service.reject("graph.extract.create",dict(service.input,generation=1),"GRAPH_INVALID"))
        check("graph.extraction.reject-request-command",lambda:service.reject("graph.extract.create",dict(service.input,command="true"),"GRAPH_INVALID"))
        def placement():
            service.configuration["execution_role"]="MAIN";service.config.write_text(encoded(service.configuration))
            try:service.reject("graph.extract.create",service.input,"GRAPH_PLACEMENT_DENIED")
            finally:service.configuration["execution_role"]="REMOTE";service.config.write_text(encoded(service.configuration))
        check("graph.extraction.reject-main-placement",placement)
        def scanner():
            service.configuration["cg_digest"]="sha256:"+"0"*64;service.config.write_text(encoded(service.configuration))
            try:service.reject("graph.extract.create",service.input,"GRAPH_SCANNER_CHANGED")
            finally:service.configuration["cg_digest"]=sha((ROOT/"cg").read_bytes());service.config.write_text(encoded(service.configuration))
        check("graph.extraction.reject-changed-scanner",scanner)
        def tamper():
            chunk=service.scratch/"bundles"/manifest["bundle_digest"][7:]/"0.json";original=chunk.read_bytes()
            altered=json.loads(original);altered["rows"][0]["row"]["unexpected"]="tampered";chunk.write_text(encoded(altered))
            try:service.reject("graph.extract.read-chunk",{"bundle_digest":manifest["bundle_digest"],"index":0},"GRAPH_DIGEST_MISMATCH")
            finally:chunk.write_bytes(original)
        check("graph.extraction.reject-tampered-chunk",tamper)
        check("graph.extraction.reject-missing-chunk",lambda:service.reject("graph.extract.read-chunk",{"bundle_digest":manifest["bundle_digest"],"index":999},"GRAPH_CHUNK_UNAVAILABLE"))
        check("graph.extraction.scratch-disposition",lambda:expect(not list(service.scratch.glob("extract-*")),"transient scanner workspace leaked"))
        artifact=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR",str(base)))/"graph"
        artifact.mkdir(parents=True,exist_ok=True)
        (artifact/"extraction-observations.json").write_text(encoded({"scope":"task-component-extraction","native_scanner":sha((ROOT/"cg").read_bytes()),
            "manifest":manifest,"observations":OBSERVATIONS,"assertion_count":len(ASSERTIONS),"failed":FAILURES})+"\n")
    return 1 if FAILURES else 0
if __name__=="__main__":
    if "--cleanup" in sys.argv:
        print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));sys.exit(0)
    sys.exit(main())
