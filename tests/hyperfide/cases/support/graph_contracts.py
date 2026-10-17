"""Task 7.4 contract, caller, search-ranking and real-corpus parity against legacy SQLite.

Every comparison is against the actual `cg` SQLite index of the identical Git source.
Deliberate central/legacy differences are listed in DELIBERATE_DIFFERENCES with the
golden output each side must produce; nothing is hidden behind aggregate counts.
"""
from __future__ import annotations
import hashlib,sqlite3,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]

CONTRACT_FILES={
    "api/server.js":"const express = require('express');\nconst app = express();\nconst router = express.Router();\n"
        "// @contract listItems returns every stored item.\nfunction listItems(req, res) { return res.json([]); }\n"
        "// @contract createItem validates before storage.\nfunction createItem(req, res) { return listItems(req, res); }\n"
        "function health(req, res) { return res.send('ok'); }\n"
        "app.get('/api/items', listItems);\napp.post('/api/items', createItem);\napp.get('/health', health);\n"
        "router.get('/orders', listItems);\napp.use('/v1', router);\n",
    "api/contracts.py":"# @contract settle keeps ledger totals balanced.\ndef settle(ledger):\n    return balance(ledger)\n\n"
        "# @Contract decoy with different case is not a contract annotation.\ndef balance(ledger):\n    return sum(ledger)\n\n"
        "def audit(ledger):\n    return settle(ledger) + balance(ledger)\n",
    "ranking/three.md":"ledger ledger ledger review notes\n",
    "ranking/two.md":"ledger ledger review notes\n",
    "ranking/one-a.md":"ledger review notes\n",
    "ranking/one-b.md":"ledger review notes\n",
    "docs/unicode.md":"Größe café ÉCOLE naïve — ÅNGSTRÖM résumé\n",
}
# Approved differences: each names the legacy behaviour, the central behaviour and the golden output.
DELIBERATE_DIFFERENCES=[
    {"id":"fts-ranking-order","legacy":"FTS5 bm25 order","central":"ts_rank_cd('simple') DESC then bundle_digest,path",
     "query":{"mode":"body","q":"ledger"},"golden_central_paths":["ranking/three.md","ranking/two.md","ranking/one-a.md","ranking/one-b.md"]},
    {"id":"fts-diacritic-folding","legacy":"unicode61 remove_diacritics=1 matches 'resume' to 'résumé'","central":"'simple' configuration keeps diacritics",
     "query":{"mode":"body","q":"resume"},"golden_central_paths":[],"golden_legacy_paths":["docs/unicode.md"]},
    {"id":"fts-legacy-operator-syntax","legacy":"FTS5 operators (OR/NOT/NEAR/*/\"/:) change query structure","central":"refused with GRAPH_QUERY_UNSUPPORTED naming the operator",
     "query":{"mode":"body","q":"ledger OR review"},"golden_central_error":"GRAPH_QUERY_UNSUPPORTED"},
    {"id":"fts-unicode-case-c-ctype","legacy":"unicode61 folds non-ASCII case","central":"refused on C/POSIX lc_ctype; trigram modes fold with pg_c_utf8",
     "query":{"mode":"body","q":"école"},"golden_central_error":"GRAPH_QUERY_UNSUPPORTED"},
]
CORPUS_PATHS=["src/json.c","src/kvx.c","src/progress.c","src/hyperfide/control.c","src/hyperfide/entrypoint.c","src/hyperfide/process_tree.c",
    "src/hyperfide/transport.h","src/hyperfide/supervisor.h","services/hyperfide/src/graph/publication.ts","tests/hyperfide/cases/support/postgres_cluster.py"]
CORPUS_BODY_WORDS=["json","parse","progress","supervisor","publication","standby","stderr"]
CORPUS_COMMENT_WORDS=["parse","stderr","immutable"]
CORPUS_SUBSTRINGS=["kvx_","json_","publish","STDERR","reading — just","sync —","—","Größe","naïve","ÉCOLE","école"]

def legacy(path):
    db=sqlite3.connect(path/".codegraph/graph.db");db.row_factory=sqlite3.Row;return db
def body_paths(db,q):return sorted(r[0] for r in db.execute("SELECT f.path FROM body_fts JOIN files f ON f.id=body_fts.rowid WHERE body_fts MATCH ?",('"'+q.replace('"','""')+'"',)))
def body_paths_ranked(db,q):return [r[0] for r in db.execute("SELECT f.path FROM body_fts JOIN files f ON f.id=body_fts.rowid WHERE body_fts MATCH ? ORDER BY bm25(body_fts)",('"'+q+'"',))]
# Legacy substring search is `cg grep -i`: body_tri trigrams only narrow candidates, the
# checked-out text decides, and case folding is ASCII-only.
def grep_paths(checkout,q):
    result=subprocess.run([str(ROOT/"cg"),"grep","-i",q,"--files","--json","-n","100000","--budget","10000000"],cwd=checkout,text=True,capture_output=True,timeout=120)
    if result.returncode not in (0,1):raise AssertionError("legacy cg grep failed: "+result.stderr[-400:])
    import json
    return sorted(f["path"] for f in json.loads(result.stdout).get("files",[]))
def comment_bodies(db,q):return sorted(r[0] for r in db.execute("SELECT c.body FROM comments c JOIN comment_fts ft ON ft.rowid=c.id WHERE comment_fts MATCH ?",('"'+q+'"',)))
def symbol_substrings(db,q):return sorted(r[0] for r in db.execute("SELECT name FROM symbols WHERE instr(lower(name),lower(?))>0",(q,)))
def legacy_routes(db):
    return [list(r) for r in db.execute("SELECT f.path,r.framework,r.method,r.pattern,r.handler,CAST(r.line AS TEXT),sf.status,hs.name,hf.path FROM routes r JOIN files f ON f.id=r.file_id "
        "LEFT JOIN semantic_route_facts sf ON sf.route_id=r.id LEFT JOIN symbols hs ON hs.id=sf.handler_symbol_id LEFT JOIN files hf ON hf.id=sf.handler_file_id ORDER BY r.method,r.pattern,f.path,r.line")]
def legacy_compositions(db):return {(r[0],r[1]) for r in db.execute("SELECT m.pattern,c.pattern FROM semantic_route_compositions x JOIN routes m ON m.id=x.mount_route_id JOIN routes c ON c.id=x.child_route_id")}
def legacy_annotations(db):
    return [list(r) for r in db.execute("SELECT f.path,CAST(c.line AS TEXT),c.kind,c.body,s.name FROM comments c JOIN files f ON f.id=c.file_id LEFT JOIN symbols s ON s.id=c.sym_id WHERE instr(c.body,'@contract')>0 ORDER BY f.path,c.line")]
def legacy_callers(db,name):
    out={}
    for kind,source in db.execute("SELECT DISTINCT e.kind,s.name FROM semantic_edges e JOIN symbols s ON s.id=e.source_id JOIN symbols t ON t.id=e.target_id WHERE t.name=?",(name,)):out.setdefault(kind,[]).append(source)
    return {k:sorted(v) for k,v in out.items()}
def legacy_unprojected(db):return db.execute("SELECT count(*) FROM semantic_edges WHERE source_id IS NULL OR target_id IS NULL").fetchone()[0]

def symbol_ids(h,manifest,name):
    return h.sql("SELECT s.id FROM hyperfide.graph_symbols s JOIN hyperfide.graph_manifests m ON m.organisation_id=s.organisation_id AND m.run_id=s.run_id AND m.build_id=s.graph_id WHERE m.id='"+manifest+"' AND s.name='"+name+"' ORDER BY s.id").split()
def central_callers(h,manifest,name):
    seeds=symbol_ids(h,manifest,name)
    if not seeds:raise AssertionError("central graph lacks symbol "+name)
    result=h.ok("graph.query.traverse",manifest_id=manifest,symbol_ids=seeds,direction="callers",depth=1,max_nodes=100)
    names={n["id"]:n["name"] for n in result["nodes"]};out={}
    for e in result["edges"]:
        if e["target_symbol_id"] in seeds:out.setdefault(e["kind"],set()).add(names[e["source_symbol_id"]])
    return {k:sorted(v) for k,v in out.items()},result

def run(h):
    """V-020 contracts/callers/ranking parity on a real repository."""
    projection=h.projection;check=h.check;expect=h.expect;state={}
    def setup():
        repo=projection.Repo(h,"contracts");rev=repo.commit(CONTRACT_FILES,"contract fixture")
        state.update(repo=repo,rev=rev,manifest=h.publish_manifest(repo.extract(rev),"contracts"))
        h.repos["contracts"]=repo;h.revisions["contracts"]=rev
        checkout=repo.checkout(rev,"contracts");projection.legacy_index(checkout);state["db"]=legacy(checkout);state["checkout"]=checkout
    check("graph.query.contracts-fixture-published",setup)
    if "db" not in state:return
    db=state["db"];manifest=state["manifest"];repo=state["repo"]
    def routes():
        result=h.ok("graph.query.contracts",manifest_id=manifest,kind="routes")
        actual=[[r["path"],r["framework"],r["method"],r["pattern"],r["handler"],r["line"],r["status"],r["handler_symbol"],r["handler_path"]] for r in result["rows"]]
        expected=legacy_routes(db)
        expect(expected and actual==expected,"route contracts differ from legacy SQLite: "+h.encoded({"legacy":expected,"central":actual}))
        expect(all(r["repository_id"]==repo.id and r["source_object_id"]==state["rev"]["commit"] for r in result["rows"]),"route rows lost source provenance")
        composed=legacy_compositions(db)
        children=sum(int(r["mounted_children"]) for r in result["rows"]);parents=sum(int(r["mounted_parents"]) for r in result["rows"])
        expect(children==len(composed) and parents==len(composed),"route composition counts differ from legacy compositions")
        filtered=h.ok("graph.query.contracts",manifest_id=manifest,kind="routes",method="POST")
        expect([r["pattern"] for r in filtered["rows"]]==[r[3] for r in expected if r[2]=="POST"],"route method filter differs")
        page=h.ok("graph.query.contracts",manifest_id=manifest,kind="routes",limit=1);rest=h.ok("graph.query.contracts",manifest_id=manifest,kind="routes",limit=1,cursor=page["next_cursor"])
        expect(page["rows"][0]["fact_key"]!=rest["rows"][0]["fact_key"] and [page["rows"][0]["pattern"],rest["rows"][0]["pattern"]]==[r[3] for r in expected[:2]],"contract pagination is not stable")
        h.obs({"observation":"route-contract-parity","routes":len(actual),"compositions":len(composed)})
    check("graph.query.contracts-route-baseline",routes)
    def annotations():
        result=h.ok("graph.query.contracts",manifest_id=manifest,kind="annotations")
        actual=[[r["path"],r["line"],r["kind"],r["body"],r["symbol"]] for r in result["rows"]]
        expected=legacy_annotations(db)
        expect(len(expected)==3 and actual==expected,"contract annotations differ from legacy SQLite: "+h.encoded({"legacy":expected,"central":actual}))
        expect(not any("@Contract" in r[3] for r in actual),"case-variant decoy was treated as a contract annotation")
        h.reject("graph.query.contracts",manifest_id=manifest,kind="annotations",method="GET",code="GRAPH_INVALID")
    check("graph.query.contracts-annotation-baseline",annotations)
    def callers():
        for name in ("balance","settle","listItems","health"):
            actual,result=central_callers(h,manifest,name)
            expect(actual==legacy_callers(db,name),"callers of "+name+" differ: "+h.encoded({"legacy":legacy_callers(db,name),"central":actual}))
            expect(result["provenance"]["route"]=="PRIMARY" and result["manifest_id"]==manifest,"caller traversal lost exact provenance")
        traversal=h.ok("graph.query.traverse",manifest_id=manifest,symbol_ids=symbol_ids(h,manifest,"balance"),direction="callers",depth=1,max_nodes=100)
        expect(int(traversal["unprojected_semantic_edge_count"])==legacy_unprojected(db),"unprojected caller debt differs from legacy unresolved endpoints")
    check("graph.query.callers-baseline",callers)
    def ranking():
        golden=DELIBERATE_DIFFERENCES[0]
        full=h.ok("graph.query.search",manifest_id=manifest,mode="body",q="ledger",limit=50)
        paths=[r["path"] for r in full["rows"] if r["path"].startswith("ranking/")]
        expect(paths==golden["golden_central_paths"],"central ranking differs from golden: "+h.encoded(paths))
        scores=[r["score"] for r in full["rows"] if r["path"] in ("ranking/one-a.md","ranking/one-b.md")]
        expect(len(scores)==2 and scores[0]==scores[1],"tie fixture does not tie; ordering tie handling is unproven")
        pages=[];cursor=None
        while True:
            page=h.ok("graph.query.search",manifest_id=manifest,mode="body",q="ledger",limit=1,**({"cursor":cursor} if cursor else {}))
            pages+=[(r["bundle_digest"],r["path"]) for r in page["rows"]];cursor=page["next_cursor"]
            if not cursor:break
        expect(pages==[(r["bundle_digest"],r["path"]) for r in full["rows"]],"paged ties differ from unpaged ordering")
        again=h.ok("graph.query.search",manifest_id=manifest,mode="body",q="ledger",limit=50)
        expect(again["rows"]==full["rows"],"repeated ranking is not deterministic")
        expect(sorted(r["path"] for r in full["rows"])==body_paths(db,"ledger"),"ranked result set differs from legacy match set")
        h.obs({"observation":"declared-ranking-difference","legacy_bm25_order":body_paths_ranked(db,"ledger"),"central_order":[r["path"] for r in full["rows"]],"ties":"bundle_digest,path"})
    check("graph.query.ranking-ties-explicit",ranking)
    def declared():
        for item in DELIBERATE_DIFFERENCES[1:]:
            q=item["query"]
            if "golden_central_error" in item:
                h.reject("graph.query.search",manifest_id=manifest,code=item["golden_central_error"],**q)
            else:
                actual=sorted(r["path"] for r in h.ok("graph.query.search",manifest_id=manifest,**q)["rows"])
                expect(actual==item["golden_central_paths"],item["id"]+" central output differs from golden")
                legacy_paths=body_paths(db,q["q"])
                expect(legacy_paths==item["golden_legacy_paths"],item["id"]+" legacy output differs from golden: "+h.encoded(legacy_paths))
        h.obs({"observation":"deliberate-differences","items":DELIBERATE_DIFFERENCES})
    check("graph.query.declared-differences-golden",declared)
    def unicode_trigram():
        for q in ("école","ÉCOLE","größe","GRÖSSE","ångström","ÅNGSTRÖM","Ångström","é","LEDGER","naïve"):
            actual=sorted(r["path"] for r in h.ok("graph.query.search",manifest_id=manifest,mode="body-trigram",q=q)["rows"])
            expected=grep_paths(state["checkout"],q)
            expect(actual==expected,"Unicode body substring "+q+" differs from legacy cg grep -i: "+h.encoded({"legacy":expected,"central":actual}))
        sym=sorted(r["payload"]["name"] for r in h.ok("graph.query.search",manifest_id=manifest,mode="trigram",q="SETTL")["rows"] if r["family"]=="symbols")
        expect(sym and sym==symbol_substrings(db,"SETTL"),"case-insensitive symbol substring differs")
    check("graph.query.unicode-trigram-edge-cases",unicode_trigram)

def corpus(h):
    """do_2: pinned real source of this repository, central PostgreSQL versus legacy SQLite."""
    projection=h.projection;check=h.check;expect=h.expect;state={}
    base=subprocess.run(["git","rev-parse","87a941b0d1f2^{commit}"],cwd=ROOT,text=True,capture_output=True).stdout.strip()
    def setup():
        expect(len(base)==40,"pinned corpus commit is not available locally")
        files={p:subprocess.run(["git","show",base+":"+p],cwd=ROOT,capture_output=True,check=True).stdout for p in CORPUS_PATHS}
        state["pins"]={p:"sha256:"+hashlib.sha256(b).hexdigest() for p,b in files.items()}
        repo=projection.Repo(h,"corpus");state["repo"]=repo
        v1=repo.commit(files,"pinned real corpus "+base)
        v2=repo.commit({"src/hyperfide/process_tree.c":None,"docs/unicode.md":"Größe — ÉCOLE naïve café\n"},"delete and Unicode change")
        v3=repo.commit({"codify.kvx":"[index]\nwalk = \"full\"\n"},"configuration change")
        state["versions"]=[]
        for name,rev in (("v1",v1),("v2",v2),("v3",v3)):
            started=time.monotonic();manifest=h.publish_manifest(repo.extract(rev),"corpus")
            checkout=repo.checkout(rev,"corpus-"+name);started_legacy=time.monotonic();facts=projection.legacy_index(checkout)
            state["versions"].append({"name":name,"rev":rev,"manifest":manifest,"checkout":checkout,"facts":facts,"central_ingest_seconds":round(started_legacy-started,3),"legacy_index_seconds":round(time.monotonic()-started_legacy,3)})
        h.obs({"observation":"pinned-real-corpus","source_repository":"this repository","commit":base,"paths":state["pins"],
            "versions":[{k:v for k,v in item.items() if k in ("name","manifest","central_ingest_seconds","legacy_index_seconds")}|{"commit":item["rev"]["commit"],"files":len(item["facts"])} for item in state["versions"]],
            "performance_claim":"NONE"})
    check("graph.query.real-corpus-published",setup)
    if "versions" not in state:return
    repo=state["repo"]
    def facts():
        for item in state["versions"]:
            central=[]
            for f in item["facts"]:
                result=h.ok("graph.query.projection.facts",manifest_id=item["manifest"],repository_id=repo.id,paths=[f["path"]],max_bytes=786432)
                central+=result["files"]
            expect(sorted(f["path"] for f in central)==[f["path"] for f in item["facts"]] and result["file_count"]==len(item["facts"]),item["name"]+" file sets differ")
            expect(central==item["facts"],item["name"]+" symbol/reference/comment/edge facts differ: "+h.encoded(projection.differences(item["facts"],central)))
            expect(result["facts_digest"]==projection.facts_digest(item["facts"]),item["name"]+" facts digest differs")
            expect(sum(len(f["symbols"]) for f in central)>100 and sum(len(f["refs"]) for f in central)>500,"real corpus is too small to be meaningful")
    check("graph.query.real-corpus-symbols-references",facts)
    def callers():
        item=state["versions"][0];db=legacy(item["checkout"])
        try:
            names=[r[0] for r in db.execute("SELECT t.name FROM semantic_edges e JOIN symbols t ON t.id=e.target_id JOIN symbols s ON s.id=e.source_id WHERE e.kind='calls' GROUP BY t.name HAVING count(DISTINCT t.id)=1 ORDER BY count(*) DESC,t.name LIMIT 6")]
            expect(len(names)>=3,"real corpus has too few call targets")
            for name in names:
                actual,_=central_callers(h,item["manifest"],name)
                expect(actual==legacy_callers(db,name),"real-corpus callers of "+name+" differ")
            h.obs({"observation":"real-corpus-callers","targets":names})
        finally:db.close()
    check("graph.query.real-corpus-callers",callers)
    def search():
        for item in state["versions"]:
            db=legacy(item["checkout"])
            try:
                for word in CORPUS_BODY_WORDS:
                    actual=sorted(r["path"] for r in h.ok("graph.query.search",manifest_id=item["manifest"],mode="body",q=word,limit=200)["rows"])
                    expect(actual==body_paths(db,word),item["name"]+" body FTS "+word+" differs: "+h.encoded({"legacy":body_paths(db,word),"central":actual}))
                for word in CORPUS_COMMENT_WORDS:
                    actual=sorted(r["payload"]["body"] for r in h.ok("graph.query.search",manifest_id=item["manifest"],mode="comment",q=word,limit=200)["rows"])
                    expect(actual==comment_bodies(db,word),item["name"]+" comment FTS "+word+" differs")
            finally:db.close()
    check("graph.query.real-corpus-fts",search)
    def trigram():
        for item in state["versions"]:
            db=legacy(item["checkout"])
            try:
                for q in CORPUS_SUBSTRINGS:
                    actual=sorted(r["path"] for r in h.ok("graph.query.search",manifest_id=item["manifest"],mode="body-trigram",q=q,limit=200)["rows"])
                    expected=grep_paths(item["checkout"],q)
                    expect(actual==expected,item["name"]+" body substring "+q+" differs: "+h.encoded({"legacy":expected,"central":actual}))
                for q in ("kvx_","json"):
                    actual=sorted(r["payload"]["name"] for r in h.ok("graph.query.search",manifest_id=item["manifest"],mode="trigram",q=q,limit=200)["rows"] if r["family"]=="symbols")
                    expect(actual==symbol_substrings(db,q),item["name"]+" symbol substring "+q+" differs")
            finally:db.close()
    check("graph.query.real-corpus-trigram-unicode",trigram)
    def changes():
        v1,v2,v3=state["versions"]
        d=h.ok("graph.query.projection.delta",repository_id=repo.id,base_manifest_id=v1["manifest"],manifest_id=v2["manifest"])
        expect(d["deleted"]==["src/hyperfide/process_tree.c"] and d["added"]==["docs/unicode.md"],"real-corpus deletion/addition misclassified")
        expect(d["incremental_facts_digest"]==projection.facts_digest(v2["facts"]),"real-corpus incremental projection differs from legacy full rebuild")
        gone=h.ok("graph.query.search",manifest_id=v2["manifest"],mode="body-trigram",q="process_tree",limit=200)
        expect(not any(r["path"]=="src/hyperfide/process_tree.c" for r in gone["rows"]),"deleted real source remained searchable")
        c=h.ok("graph.query.projection.delta",repository_id=repo.id,base_manifest_id=v2["manifest"],manifest_id=v3["manifest"])
        expect(c["invalidation"]=="FULL_PARSER_CONFIGURATION_CHANGE" and c["incremental_facts_digest"]==projection.facts_digest(v3["facts"]),"real-corpus configuration change not fully invalidated")
    check("graph.query.real-corpus-deletion-config-change",changes)

def migration(h):
    """V-025: migration exactness, resumable re-application and precise diagnostics."""
    check=h.check;expect=h.expect
    source=(ROOT/"services/hyperfide/migrations/0704-graph-query-parity.sql").read_text()
    checksum="sha256:"+hashlib.sha256(source.encode()).hexdigest()
    manifest=h.sql("SELECT manifest_id::text FROM hyperfide.graph_channels WHERE name='contracts'")
    def applied():
        row=h.sql("SELECT name||'|'||checksum FROM hyperfide.schema_migrations WHERE version=704")
        expect(row=="0704-graph-query-parity|"+checksum,"exact 0704 migration checksum is not recorded: "+row)
        valid=h.sql("SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname IN ('graph_facts_local_id','graph_facts_route_id','graph_facts_routes','graph_facts_route_mounts','graph_facts_route_children') AND i.indisvalid AND i.indisready")
        expect(valid=="5","0704 indexes are not all valid")
        h.sql("ANALYZE hyperfide.graph_fact_rows")
        graph,bundle=h.sql("SELECT b.graph_id||'|'||b.bundle_digest FROM hyperfide.graph_bundle_inputs b JOIN hyperfide.graph_manifests m ON m.build_id=b.graph_id WHERE m.id='"+manifest+"'").split("|")
        plan=h.sql("EXPLAIN (COSTS OFF) SELECT payload FROM hyperfide.graph_fact_rows WHERE organisation_id='"+h.scope["organisation_id"]+"' AND run_id='"+h.scope["run_id"]+"' AND graph_id='"+graph+"' AND bundle_digest='"+bundle+"' AND family='symbols' AND payload->>'id'='1'")
        expect("Seq Scan" not in plan,"local fact identity lookup scans the fact table: "+plan)
        h.obs({"observation":"migration-0704","checksum":checksum,"local_id_plan":plan.splitlines()})
    check("graph.query.migration-0704-exact-checksum",applied)
    def interrupted():
        before=h.ok("graph.query.contracts",manifest_id=manifest,kind="routes")
        h.sql("DROP INDEX hyperfide.graph_facts_route_id")
        try:
            response=h.raw("graph.query.contracts",manifest_id=manifest,kind="routes")
            error=response.get("error",{})
            expect(response.get("ok") is False and error.get("code")=="GRAPH_SCHEMA_UNAVAILABLE" and "graph_facts_route_id" in error.get("message","") and "0704-graph-query-parity" in error.get("message",""),"incomplete migration lacked a precise diagnostic: "+h.encoded(error))
            expect(h.ok("graph.query.status",manifest_id=manifest)["manifest_id"]==manifest,"unrelated exact status failed during incomplete upgrade")
        finally:h.sql(source)
        after=h.ok("graph.query.contracts",manifest_id=manifest,kind="routes")
        expect(after["rows"]==before["rows"],"resumed migration changed query results")
        h.sql(source)
        expect(h.ok("graph.query.contracts",manifest_id=manifest,kind="routes")["rows"]==before["rows"],"idempotent re-application changed results")
    check("graph.query.migration-0704-resumable-precise-diagnostic",interrupted)
    def incomplete_snapshot():
        staged=h.sql("SELECT b.id||'|'||b.state FROM hyperfide.graph_builds b WHERE NOT EXISTS(SELECT 1 FROM hyperfide.graph_manifests m WHERE m.organisation_id=b.organisation_id AND m.run_id=b.run_id AND m.build_id=b.id) ORDER BY b.created_at LIMIT 1")
        expect(staged,"no incomplete snapshot fixture exists")
        build,state=staged.split("|")
        expect(state in ("STAGING","RESOLVING","READY"),"incomplete fixture state unexpected")
        for action,extra in (("graph.query.status",{}),("graph.query.search",{"mode":"body","q":"ledger"}),("graph.query.contracts",{"kind":"routes"})):
            h.reject(action,manifest_id=build,code="GRAPH_VERSION_UNAVAILABLE",**extra)
        h.obs({"observation":"incomplete-snapshot-refused","build":build,"state":state})
    check("graph.query.incomplete-snapshot-not-queryable",incomplete_snapshot)
    def legacy_syntax():
        for q,token in (("ledger OR review","OR"),('"ledger review"','"'),("ledg*","*"),("body:ledger",":"),("NEAR(ledger review)","NEAR(")):
            response=h.raw("graph.query.search",manifest_id=manifest,mode="body",q=q)
            error=response.get("error",{})
            expect(response.get("ok") is False and error.get("code")=="GRAPH_QUERY_UNSUPPORTED" and token.rstrip("(") in error.get("message",""),"legacy FTS operator "+token+" lacked a precise diagnostic")
        expect(h.ok("graph.query.search",manifest_id=manifest,mode="trigram",q="ledger OR review")["rows"]==[],"trigram literal was parsed as an operator")
    check("graph.query.reject-unsupported-legacy-fts-syntax",legacy_syntax)
