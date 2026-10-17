"""Task 7.4 differential harness: legacy SQLite facts versus central projections.

Legacy facts come from the real `cg` index of an actual Git checkout; central facts
come from the authenticated graph.query.projection.* actions over published
manifests. Both are normalised without local row IDs (LEGACY_ROW_FACTS_WITHOUT_LOCAL_IDS_V1).
"""
from __future__ import annotations
import hashlib,json,shutil,sqlite3,subprocess,uuid
from pathlib import Path

def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)
def facts_digest(files):return "sha256:"+hashlib.sha256(canonical(sorted(files,key=lambda f:f["path"].encode())).encode()).hexdigest()
def cell(value):return None if value is None else str(value)
def ordered(rows):return sorted(rows,key=lambda row:canonical(row).encode())

def legacy_facts(db):
    """Normalise one legacy SQLite index exactly as projection_extract.ts normalises central facts."""
    db.row_factory=sqlite3.Row
    branches=db.execute("SELECT id FROM branches").fetchall()
    if len(branches)!=1:raise AssertionError("legacy index must hold exactly one branch")
    files={};paths={}
    for f in db.execute("SELECT id,path,hash,lang FROM files"):
        paths[f["id"]]=f["path"];files[f["path"]]={"path":f["path"],"content":cell(f["hash"]),"lang":cell(f["lang"]),"symbols":[],"refs":[],"comments":[],"routes":[],"edges":[]}
    symbols={s["id"]:(cell(s["name"]),paths.get(s["file_id"])) for s in db.execute("SELECT id,name,file_id FROM symbols")}
    name=lambda i:None if i is None else symbols.get(i,(None,None))[0]
    where=lambda i:None if i is None else symbols.get(i,(None,None))[1]
    for v in db.execute("SELECT * FROM symbols"):files[paths[v["file_id"]]]["symbols"].append([cell(v["name"]),cell(v["kind"]),cell(v["line"]),cell(v["end_line"]),cell(v["sig"])])
    for v in db.execute("SELECT * FROM refs"):files[paths[v["file_id"]]]["refs"].append([cell(v["name"]),cell(v["line"]),cell(v["kind"]),cell(v["qual"]),cell(v["verdict"]),name(v["sym_id"]),where(v["target_id"]),name(v["target_id"])])
    for v in db.execute("SELECT * FROM comments"):files[paths[v["file_id"]]]["comments"].append([cell(v["line"]),cell(v["end_line"]),cell(v["kind"]),cell(v["body"]),name(v["sym_id"])])
    for v in db.execute("SELECT * FROM routes"):files[paths[v["file_id"]]]["routes"].append([cell(v["framework"]),cell(v["method"]),cell(v["pattern"]),cell(v["handler"]),cell(v["line"])])
    for v in db.execute("SELECT * FROM semantic_edges WHERE source_file_id IS NOT NULL"):
        files[paths[v["source_file_id"]]]["edges"].append([cell(v["kind"]),name(v["source_id"]),paths.get(v["target_file_id"]) if v["target_file_id"] is not None else None,name(v["target_id"]),cell(v["original_text"]),cell(v["start_line"])])
    for f in files.values():
        for key in ("symbols","refs","comments","routes","edges"):f[key]=ordered(f[key])
    return sorted(files.values(),key=lambda f:f["path"].encode())

def differences(expected,actual,limit=12):
    """Field-level diagnostics; never an aggregate count."""
    e={f["path"]:f for f in expected};a={f["path"]:f for f in actual};out=[]
    for p in sorted(set(e)|set(a)):
        if p not in a:out.append({"path":p,"missing":"central"})
        elif p not in e:out.append({"path":p,"missing":"legacy"})
        else:
            for key in ("content","lang","symbols","refs","comments","routes","edges"):
                if e[p][key]!=a[p].get(key):
                    left=e[p][key];right=a[p].get(key)
                    if isinstance(left,list):out.append({"path":p,"field":key,"legacy_only":[r for r in left if r not in right][:4],"central_only":[r for r in right if r not in left][:4]})
                    else:out.append({"path":p,"field":key,"legacy":left,"central":right})
        if len(out)>=limit:break
    return out

def git(cwd,*args):
    result=subprocess.run(["git",*args],cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
    if result.returncode:raise AssertionError("git "+args[0]+" failed: "+result.stderr[-600:])
    return result.stdout.strip()

class Repo:
    """A real Git repository registered as a run repository of the fixture."""
    def __init__(self,h,name):
        self.h=h;self.id=str(uuid.uuid4());self.name=name;self.path=h.f.native.base/("repo-"+name);self.path.mkdir()
        git(self.path,"init","-q","-b","main")
        for key,value in (("user.name","Hyperfide 7.4 fixture"),("user.email","fixture@example.invalid"),("maintenance.auto","false"),("gc.auto","0")):git(self.path,"config",key,value)
        h.f.fixture.sql("INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url) VALUES($1,$2,$3,$4,$5)",[h.scope["organisation_id"],h.f.fixture.ids["project"],self.id,"graph-74-"+name,"https://example.invalid/"+name])
        h.f.native.configuration["repositories"][self.id]=str(self.path);h.f.native.config.write_text(h.encoded(h.f.native.configuration))
        self.registered=False;self.generation=0
    def commit(self,files,message):
        for rel,body in files.items():
            target=self.path/rel
            if body is None:target.unlink()
            else:
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(body if isinstance(body,bytes) else body.encode())
        git(self.path,"add","-A");git(self.path,"commit","-qm",message)
        commit=git(self.path,"rev-parse","HEAD");tree=git(self.path,"rev-parse","HEAD^{tree}")
        org=self.h.scope["organisation_id"]
        self.h.f.fixture.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[org,self.id,commit])
        if not self.registered:
            self.h.f.fixture.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[org,self.h.scope["run_id"],self.id,commit])
            self.registered=True
        return {"commit":commit,"tree":tree}
    def extract(self,revision,configuration=None,overlay=None):
        self.generation+=1
        request=dict(self.h.f.native.input,repository_id=self.id,commit=revision["commit"],tree=revision["tree"],generation=str(self.generation))
        if configuration is not None:request["configuration"]=configuration
        if overlay is not None:request["overlay"]=overlay
        return self.h.f.native.ok("graph.extract.create",request)
    def checkout(self,revision,name,overlay_files=None):
        """Independent legacy checkout of an exact revision (plus overlay edits)."""
        target=self.path.parent/("legacy-"+self.name+"-"+name)
        if target.exists():shutil.rmtree(target)
        git(self.path.parent,"clone","-q","--no-hardlinks",str(self.path),str(target));git(target,"checkout","-q","-B","main",revision["commit"])
        for rel,body in (overlay_files or {}).items():
            if body is None:(target/rel).unlink()
            else:(target/rel).parent.mkdir(parents=True,exist_ok=True);(target/rel).write_bytes(body if isinstance(body,bytes) else body.encode())
        return target

def legacy_index(checkout,full=True):
    (checkout/".codegraph/objects").mkdir(parents=True,exist_ok=True)
    args=[str(Path(__file__).resolve().parents[4]/"cg"),"index","--json","--workers","1"]+(["--full"] if full else [])
    result=subprocess.run(args,cwd=checkout,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=600)
    if result.returncode:raise AssertionError("legacy cg index failed: "+result.stderr[-600:])
    db=sqlite3.connect(checkout/".codegraph/graph.db")
    try:return legacy_facts(db)
    finally:db.close()

def overlay_payload(name,files):
    import base64
    entries=[]
    for rel,body in sorted(files.items()):
        if body is None:entries.append({"path":rel,"content_base64":None,"digest":None,"mode":"DELETE"})
        else:
            raw=body if isinstance(body,bytes) else body.encode()
            entries.append({"path":rel,"content_base64":base64.b64encode(raw).decode(),"digest":"sha256:"+hashlib.sha256(raw).hexdigest(),"mode":"100644"})
    return {"name":name,"digest":"sha256:"+hashlib.sha256(canonical(entries).encode()).hexdigest(),"files":entries}

INCREMENTAL_BASE={
    "lib/maths.py":"# @contract helper keeps the counted increment.\ndef helper(value):\n    return value + 1\n\ndef unused_shape(value):\n    return value\n",
    "lib/consumer.py":"from lib.maths import helper\n\ndef consume(value):\n    return helper(value)\n",
    "web/routes.js":"export function listItems(req) { return req; }\n// Intent: the item listing contract.\napp.get('/api/items', listItems);\n",
    "lib/obsolete.py":"def obsolete_marker():\n    return 'stale fact marker'\n",
    "lib/stable.py":"def stable_value():\n    return 7\n",
}
INCREMENTAL_EDIT={
    "lib/maths.py":"# @contract helper keeps the counted increment.\ndef helper_renamed(value, step):\n    return value + step\n\ndef unused_shape(value, extra):\n    return value\n",
    "lib/obsolete.py":None,
    "web/routes.js":None,
    "web/api_routes.js":"export function listItems(req) { return req; }\n// Intent: the item listing contract.\napp.get('/api/items', listItems);\n",
    "lib/added.py":"def added_entry():\n    return 1\n",
}
OVERLAY_FILES={"lib/stable.py":"def stable_value():\n    return 8\n\ndef overlay_only():\n    return stable_value()\n","lib/consumer.py":None}

def run(h):
    """V-021 incremental/full equivalence and V-020 branch projection parity."""
    check=h.check;expect=h.expect;state={}
    def setup():
        repo=Repo(h,"incremental");state["repo"]=repo
        a=repo.commit(INCREMENTAL_BASE,"base revision");b=repo.commit(INCREMENTAL_EDIT,"add delete rename and signature edit")
        state.update(a=a,b=b)
        state["ma"]=h.publish_manifest(repo.extract(a),"incremental")
        state["mb"]=h.publish_manifest(repo.extract(b),"incremental")
    check("graph.query.incremental-fixture-published",setup)
    if "mb" not in state:return
    repo=state["repo"]
    def q(action,**kw):return h.ok(action,repository_id=repo.id,**kw)
    def classification():
        d=q("graph.query.projection.delta",base_manifest_id=state["ma"],manifest_id=state["mb"])
        state["delta"]=d
        expect(d["invalidation"]=="FILE_CONTENT_AND_DEPENDENTS","source-only edit claimed a parser change")
        expect(d["added"]==["lib/added.py","web/api_routes.js"] and d["deleted"]==["lib/obsolete.py","web/routes.js"] and d["changed"]==["lib/maths.py"],"delta misclassified add/delete/rename/edit: "+h.encoded(d))
        expect("lib/consumer.py" in d["dependents"],"caller of a renamed symbol was not invalidated")
        expect(d["reused_count"]>=1 and "lib/stable.py" not in d["dependents"],"independent file was not reused")
    check("graph.query.incremental-delta-classification",classification)
    def equivalence():
        d=state.get("delta") or q("graph.query.projection.delta",base_manifest_id=state["ma"],manifest_id=state["mb"])
        full=q("graph.query.projection.facts",manifest_id=state["mb"])
        legacy=legacy_index(repo.checkout(state["b"],"full-b"))
        h.obs({"observation":"incremental-vs-full","incremental_digest":d["incremental_facts_digest"],"central_full_digest":full["facts_digest"],"legacy_full_digest":facts_digest(legacy)})
        expect(full["files"]==legacy,"central full rebuild differs from legacy full rebuild: "+h.encoded(differences(legacy,full["files"])))
        expect(d["incremental_facts_digest"]==full["facts_digest"]==d["target_facts_digest"]==facts_digest(legacy),"incremental projection differs from full rebuild")
    check("graph.query.incremental-equals-full-rebuild",equivalence)
    def legacy_incremental():
        checkout=repo.checkout(state["a"],"incremental-a");legacy_index(checkout)
        git(checkout,"reset","-q","--hard",state["b"]["commit"])
        incremental=legacy_index(checkout,full=False);full=legacy_index(repo.checkout(state["b"],"full-b2"))
        expect(incremental==full,"legacy incremental index differs from legacy full rebuild: "+h.encoded(differences(full,incremental)))
        central=q("graph.query.projection.facts",manifest_id=state["mb"])
        expect(central["files"]==incremental,"central graph differs from legacy incremental index")
    check("graph.query.legacy-incremental-equals-full",legacy_incremental)
    def stale_facts():
        new=h.ok("graph.query.search",manifest_id=state["mb"],mode="symbol",q="obsolete_marker")
        old=h.ok("graph.query.search",manifest_id=state["ma"],mode="symbol",q="obsolete_marker")
        expect(old["rows"] and not new["rows"],"deleted symbol survived in the new version or vanished from the old version")
        h.reject("graph.query.context",manifest_id=state["mb"],symbol_ids=[],files=[{"repository_id":repo.id,"path":"web/routes.js"}],code="GRAPH_FILE_UNAVAILABLE")
        renamed=h.ok("graph.query.search",manifest_id=state["mb"],mode="symbol",q="helper_renamed")
        expect([r["payload"]["sig"] for r in renamed["rows"]]==["def helper_renamed(value, step):"],"signature change was not published")
    check("graph.query.incremental-deletion-removes-stale-facts",stale_facts)
    def configuration():
        changed=dict(h.f.native.input["configuration"],build_flags=["--parity-configuration-change"])
        mc=h.publish_manifest(repo.extract(state["b"],configuration=changed),"incremental-config")
        d=q("graph.query.projection.delta",base_manifest_id=state["mb"],manifest_id=mc)
        expect(d["invalidation"]=="FULL_PARSER_CONFIGURATION_CHANGE" and d["reused_count"]==0,"parser configuration change reused facts")
        expect(d["incremental_facts_digest"]==d["target_facts_digest"],"full invalidation did not equal rebuild")
        c=repo.commit({"codify.kvx":"[index]\nwalk = \"full\"\n"},"native parser configuration change")
        mk=h.publish_manifest(repo.extract(c),"incremental-native-config")
        dk=q("graph.query.projection.delta",base_manifest_id=state["mb"],manifest_id=mk)
        expect(dk["invalidation"]=="FULL_PARSER_CONFIGURATION_CHANGE","native codify.kvx change did not invalidate parser facts")
        legacy=legacy_index(repo.checkout(c,"config-c"))
        expect(q("graph.query.projection.facts",manifest_id=mk)["files"]==legacy,"configuration-changed graph differs from legacy rebuild")
        state["c"]=c
    check("graph.query.incremental-parser-config-full-invalidation",configuration)
    def failed_parse():
        before=h.ok("graph.query.status",channel="incremental")["manifest_id"]
        broken=repo.commit({"lib/broken.py":"def broken(:\n    return (\n"},"failed parse chunk")
        manifest=repo.extract(broken)
        expect(manifest["complete"] is False,"scanner reported a failed parse as complete")
        build=h.f.create(manifest)["build_id"];h.f.stage(build,manifest,h.f.native.chunks(manifest))
        h.f.reject("7.2","graph.ingest.seal",h.f.scoped(build_id=build),"GRAPH_INCOMPLETE")
        h.f.reject("7.3","graph.publish.commit",h.f.scoped(build_id=build,channel="incremental",expected_generation=str(h.channels["incremental"]),operation_id=str(uuid.uuid4())),"GRAPH_INCOMPLETE")
        expect(h.sql("SELECT count(*) FROM hyperfide.graph_manifests WHERE build_id='"+build+"'")=="0","failed parse build was published")
        expect(h.ok("graph.query.status",channel="incremental")["manifest_id"]==before,"channel moved to incomplete staging")
        partial=repo.extract(repo.commit({"lib/broken.py":None,"lib/late.py":"def late():\n    return 2\n"},"repair"))
        staged=h.f.create(partial)["build_id"];chunks=h.f.native.chunks(partial)
        if len(chunks)>1:h.f.stage(staged,partial,chunks[:-1])
        h.f.reject("7.2","graph.ingest.seal",h.f.scoped(build_id=staged),"GRAPH_INCOMPLETE")
        h.f.reject("7.3","graph.publish.commit",h.f.scoped(build_id=staged,channel="incremental",expected_generation=str(h.channels["incremental"]),operation_id=str(uuid.uuid4())),"GRAPH_INCOMPLETE")
        expect(h.sql("SELECT count(*) FROM hyperfide.graph_manifests WHERE build_id='"+staged+"'")=="0","uncommitted staging was published")
        h.obs({"observation":"failed-and-uncommitted-staging","failed_parse_build":build,"partial_staging_build":staged,"staged_chunks":max(0,len(chunks)-1),"total_chunks":len(chunks)})
    check("graph.query.failed-parse-and-staging-never-published",failed_parse)
    def branch_projection():
        overlay=overlay_payload("review/stable-edit",OVERLAY_FILES)
        mo=h.publish_manifest(repo.extract(state["a"],overlay=overlay),"branch/review-a")
        view=q("graph.query.projection.view",base_manifest_id=state["ma"],manifest_id=mo)
        legacy=legacy_index(repo.checkout(state["a"],"overlay-a",OVERLAY_FILES))
        composed=[{k:v for k,v in f.items() if k!="origin"} for f in view["files"]]
        expect(composed==legacy,"branch projection differs from legacy index of the same overlay checkout: "+h.encoded(differences(legacy,composed)))
        expect(view["deleted"]==["lib/consumer.py"] and "lib/stable.py" in view["changed"] and view["branch"]["base_commit"]==state["a"]["commit"],"overlay projection lost deletion/edit/base binding")
        expect(any(f["origin"]=="BASE_REUSED" for f in view["files"]),"branch projection reused no base facts")
        state["overlay"]=overlay;state["mo"]=mo
        h.obs({"observation":"branch-projection","base":state["ma"],"overlay":mo,"facts_digest":view["facts_digest"],"reused":view["reused_count"],"invalidated":view["invalidated_count"]})
    check("graph.query.branch-projection-legacy-parity",branch_projection)
    def rebase():
        if "overlay" not in state:raise AssertionError("overlay fixture missing")
        rebased=h.publish_manifest(repo.extract(state["b"],overlay=state["overlay"]),"branch/review-b")
        h.reject("graph.query.projection.view",repository_id=repo.id,base_manifest_id=state["ma"],manifest_id=rebased,code="GRAPH_PROJECTION_BASE_MISMATCH")
        h.reject("graph.query.projection.view",repository_id=repo.id,base_manifest_id=state["mb"],manifest_id=state["mo"],code="GRAPH_PROJECTION_BASE_MISMATCH")
        view=q("graph.query.projection.view",base_manifest_id=state["mb"],manifest_id=rebased)
        legacy=legacy_index(repo.checkout(state["b"],"overlay-b",OVERLAY_FILES))
        expect([{k:v for k,v in f.items() if k!="origin"} for f in view["files"]]==legacy,"rebased branch projection differs from legacy rebuild")
        h.reject("graph.query.projection.view",repository_id=repo.id,base_manifest_id=state["mo"],manifest_id=rebased,code="GRAPH_PROJECTION_BASE_INVALID")
    check("graph.query.branch-rebase-requires-reprojection",rebase)
