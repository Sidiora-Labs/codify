#!/usr/bin/env python3
"""Actual native/authenticated HTTPS/PostgreSQL domain07 component qualification.

Fixtures apply trusted migration files with operator credentials. Application
actions carry no SQL or DDL. Full migration, replica, ranking and scale campaigns
remain independent obligations.
"""
from __future__ import annotations
import concurrent.futures,copy,hashlib,importlib.util,json,os,re,sqlite3,subprocess,sys,tempfile,uuid
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("graph_extraction_fixture",ROOT/"tests/hyperfide/cases/tasks/7_1.py")
native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
encoded=native.encoded;sha=native.sha;expect=native.expect
SCOPE=dict(native.UUIDS,authority_epoch="10000000-0000-4000-8000-000000000006")
SCOPE.pop("repository_id")
DATABASE="hf_graph_domain07_qualification"
FAILED=[];OBS=[];IDS=[]
def check(identity,fn):
    IDS.append(identity)
    try:fn();actual="observed"
    except Exception as error:actual=type(error).__name__+": "+str(error);FAILED.append(identity)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def sql(statement,*,database=None,allow_error=False):
    database=database or DATABASE
    env=os.environ.copy();env["PGDATABASE"]=database
    p=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",database],input=statement,
        text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,cwd=ROOT,timeout=60)
    if not allow_error:expect(p.returncode==0,"PostgreSQL fixture failed: "+" | ".join(line for line in p.stderr.splitlines() if line.startswith(("ERROR:","DETAIL:")))[:1200])
    return p
def artifact_root():
    return Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain07-direct"))/"graph"
def cleanup():
    ledger=artifact_root()/"database-resource.json"
    if not ledger.exists():
        print(json.dumps({"type":"cleanup","complete":True,"resources":[]}))
        return 0
    item=json.loads(ledger.read_text());database=item["database"]
    expect((re.fullmatch(r"hf_identity_[0-9a-f]{32}",database) or database in ("hf_graph_7_1_qualification","hf_graph_domain07_qualification")),"fixture resource database name invalid")
    sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+database+"' AND pid<>pg_backend_pid()",database="postgres")
    sql('DROP DATABASE IF EXISTS "'+database+'"',database="postgres")
    absent=sql("SELECT count(*) FROM pg_database WHERE datname='"+database+"'",database="postgres").stdout.strip()=="0"
    artifact_root().mkdir(parents=True,exist_ok=True)
    (artifact_root()/"database-absence.json").write_text(encoded({"database":database,"observed_absent":absent,"observer":"pg_database after DROP DATABASE"})+"\n")
    print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":item["resource_id"],"status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"graph/database-absence.json"}]}),flush=True)
    return 0 if absent else 1
class Fixture:
    def __init__(self,base):
        global DATABASE
        (base/"native").mkdir()
        self.native=native.Service(base/"native",extra_components=("7.2","7.3","7.4"),database=DATABASE,graph_schema=True)
        self.fixture=self.native.fixture
        DATABASE=self.fixture.database
        SCOPE.update(organisation_id=self.fixture.ids["organisation"],run_id=self.fixture.ids["run"],authority_epoch=self.fixture.ids["epoch"])
        source=self.native.repo
        (source/"large.txt").write_text("bounded body source words\n"*6000)
        native.process(["git","add","large.txt"],source);native.process(["git","commit","-qm","multi-chunk body fixture"],source)
        self.native.commit=native.process(["git","rev-parse","HEAD"],source)
        self.native.tree=native.process(["git","rev-parse","HEAD^{tree}"],source)
        self.native.input.update(commit=self.native.commit,tree=self.native.tree)
        self.fixture.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[SCOPE["organisation_id"],native.UUIDS["repository_id"],self.native.commit])
        self.manifest=self.extract("1");self.chunks=self.native.chunks(self.manifest)
    def extract(self,generation):
        return self.native.ok("graph.extract.create",dict(self.native.input,generation=generation))
    def request(self,component,action,value):
        status,response=self.fixture.request(self.fixture.operation(component,action,value))
        OBS.append({"component":component,"action":action,"http_status":status,"ok":response.get("ok"),"code":response.get("error",{}).get("code")})
        return status,response
    def ok(self,component,action,value):
        status,response=self.request(component,action,value)
        expect(status==200 and response.get("ok") is True,"actual authenticated service refused operation: "+encoded(response.get("error",{})))
        return response["result"]
    def reject(self,component,action,value,code=None):
        status,response=self.request(component,action,value)
        expect(response.get("ok") is False,"invalid authenticated operation succeeded")
        if code:expect(response.get("error",{}).get("code")==code,"unexpected rejection: "+encoded(response))
    def scoped(self,**kw):return dict(SCOPE,**kw)
    def create(self,manifest=None):
        return self.ok("7.2","graph.ingest.create",self.scoped(bundles=[manifest or self.manifest]))
    def stage(self,build,manifest=None,chunks=None):
        m=manifest or self.manifest
        for chunk in chunks or self.chunks:self.ok("7.2","graph.ingest.chunk",self.scoped(build_id=build,bundle_digest=m["bundle_digest"],chunk=chunk))
    def ready(self,manifest=None):
        m=manifest or self.manifest;b=self.create(m)["build_id"];self.stage(b,m,self.native.chunks(m))
        self.ok("7.2","graph.ingest.seal",self.scoped(build_id=b))
        for _ in range(100):
            result=self.ok("7.2","graph.ingest.resolve",self.scoped(build_id=b,limit=2))
            if result["state"]=="READY":return b
        raise AssertionError("bounded resolution did not complete")
    def publish(self,build,channel="main",expected="0",operation=None):
        return self.ok("7.3","graph.publish.commit",self.scoped(build_id=build,channel=channel,expected_generation=expected,operation_id=operation or str(uuid.uuid4())))
def ingestion(f):
    state={}
    check("graph.ingestion.real-copy-describe",lambda:expect(f.ok("7.2","graph.ingest.describe",{})["transport"]=="POSTGRESQL_COPY_FROM_STDIN","COPY capability not advertised"))
    def create():state["build"]=f.create()["build_id"];expect(sql("SELECT count(*) FROM hyperfide.graph_builds").stdout.strip()=="1","build was not durably created")
    check("graph.ingestion.persist-build",create);b=state["build"]
    check("graph.ingestion.replay-build",lambda:expect(f.create()["build_id"]==b,"replay duplicated build"))
    check("graph.ingestion.reject-incomplete-seal",lambda:f.reject("7.2","graph.ingest.seal",f.scoped(build_id=b),"GRAPH_INCOMPLETE"))
    first=f.chunks[0]
    def chunk():
        r=f.ok("7.2","graph.ingest.chunk",f.scoped(build_id=b,bundle_digest=f.manifest["bundle_digest"],chunk=first))
        expect(r["transport"]=="POSTGRESQL_COPY_FROM_STDIN" and r["rows"]==len(first["rows"]),"COPY did not report actual copied count")
        expect(sql("SELECT count(*) FROM hyperfide.graph_fact_rows").stdout.strip()==str(len(first["rows"])),"independent SQL row count differs")
    check("graph.ingestion.actual-copy-row-count",chunk)
    def restart_staging():
        f.fixture.stop();f.fixture.start()
        r=f.ok("7.2","graph.ingest.chunk",f.scoped(build_id=b,bundle_digest=f.manifest["bundle_digest"],chunk=first))
        expect(r["replayed"] is True,"durable chunk replay failed after listener restart")
    check("graph.ingestion.restart-after-staged-chunk",restart_staging)
    check("graph.ingestion.replay-chunk",lambda:expect(f.ok("7.2","graph.ingest.chunk",f.scoped(build_id=b,bundle_digest=f.manifest["bundle_digest"],chunk=first))["replayed"],"replayed chunk was duplicated"))
    def corrupt():
        c=copy.deepcopy(first);c["rows"][0]["row"]["tampered"]=True
        f.reject("7.2","graph.ingest.chunk",f.scoped(build_id=b,bundle_digest=f.manifest["bundle_digest"],chunk=c),"GRAPH_DIGEST_MISMATCH")
    check("graph.ingestion.reject-tampered-copy",corrupt)
    check("graph.ingestion.reject-cross-run",lambda:f.reject("7.2","graph.ingest.inspect",dict(f.scoped(build_id=b),run_id="10000000-0000-4000-8000-000000000099"),"GRAPH_SCOPE_DENIED"))
    check("graph.ingestion.reject-stale-epoch",lambda:f.reject("7.2","graph.ingest.inspect",dict(f.scoped(build_id=b),authority_epoch="10000000-0000-4000-8000-000000000099"),"GRAPH_SCOPE_DENIED"))
    def rest():f.stage(b);expect(sql("SELECT count(*) FROM hyperfide.graph_fact_rows").stdout.strip()==str(sum(f.manifest["counts"].values())),"native facts were lost")
    check("graph.ingestion.complete-chunk-set",rest)
    check("graph.ingestion.seal-resume",lambda:expect(f.ok("7.2","graph.ingest.seal",f.scoped(build_id=b))["state"]=="RESOLVING","complete source did not seal"))
    check("graph.ingestion.reject-late-new-chunk",lambda:f.reject("7.2","graph.ingest.chunk",f.scoped(build_id=b,bundle_digest=f.manifest["bundle_digest"],chunk=dict(first,index=999)),"GRAPH_DIGEST_MISMATCH"))
    def resolve():
        for _ in range(100):
            r=f.ok("7.2","graph.ingest.resolve",f.scoped(build_id=b,limit=1))
            expect(r["rows"]<=1,"resolution ignored batch budget")
            if r["state"]=="READY":return
        raise AssertionError("bounded resolution did not finish")
    check("graph.ingestion.bounded-restart-resolution",resolve)
    check("graph.ingestion.file-projection",lambda:expect(sql("SELECT count(*) FROM hyperfide.graph_files").stdout.strip()==str(f.manifest["counts"]["files"]),"file projection differs"))
    check("graph.ingestion.symbol-projection",lambda:expect(sql("SELECT count(*) FROM hyperfide.graph_symbols").stdout.strip()==str(f.manifest["counts"]["symbols"]),"symbol projection differs"))
    check("graph.ingestion.reference-projection",lambda:expect(sql("SELECT count(*) FROM hyperfide.graph_references").stdout.strip()==str(f.manifest["counts"]["refs"]),"reference projection differs"))
    check("graph.ingestion.body-reconstruction",lambda:expect(sql("SELECT count(*) FROM hyperfide.graph_source_bodies WHERE body LIKE '%body words searchable corpus%'").stdout.strip()=="1","actual body parts were not reconstructed"))
    check("graph.ingestion.no-publication-side-effect",lambda:expect(sql("SELECT count(*) FROM hyperfide.graph_manifests").stdout.strip()=="0","staging published graph authority"))
    def concurrent_build():
        m=f.extract("4");value=f.scoped(bundles=[m])
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:f.request("7.2","graph.ingest.create",value),range(2)))
        expect(all(response.get("ok") is True for _,response in results),"concurrent exact create returned an uncertain database failure")
        build_ids={response["result"]["build_id"] for _,response in results}
        expect(len(build_ids)==1,"concurrent create duplicated immutable graph build")
        expect(sql("SELECT count(*) FROM hyperfide.graph_builds WHERE input_digest='"+sha(encoded([m]))+"'").stdout.strip()=="1","independent SQL found duplicate/missing build")
    check("graph.ingestion.concurrent-exact-build-replay",concurrent_build)
    def pending_artifact():
        m=f.extract("5");body=encoded(m);value=sha(body)
        f.fixture.sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,retention_class) VALUES($1,$2,$3,$4,$5,'FIXTURE_PENDING',$6,'PENDING','RUN')",[SCOPE["organisation_id"],SCOPE["run_id"],str(uuid.uuid4()),value,str(len(body.encode())),"pending-manifest-"+str(uuid.uuid4())])
        f.reject("7.2","graph.ingest.create",f.scoped(bundles=[m]),"GRAPH_ARTIFACT_CONFLICT")
        expect(sql("SELECT status FROM hyperfide.artifacts WHERE digest='"+value+"'").stdout.strip()=="PENDING","ingestion falsely completed another artifact")
        expect(sql("SELECT count(*) FROM hyperfide.graph_builds WHERE input_digest='"+sha(encoded([m]))+"'").stdout.strip()=="0","conflicting artifact left a partially admitted build")
    check("graph.ingestion.reject-incomplete-manifest-artifact-reuse",pending_artifact)
    def unavailable_replay():
        artifact_status(b,"QUARANTINED")
        try:f.reject("7.2","graph.ingest.create",f.scoped(bundles=[f.manifest]),"GRAPH_ARTIFACT_UNAVAILABLE")
        finally:artifact_status(b,"COMPLETE")
    check("graph.ingestion.reject-quarantined-build-replay",unavailable_replay)


def artifact_status(build,status):
    expect(status in ("COMPLETE","QUARANTINED"),"invalid fixture artifact state")
    sql("UPDATE hyperfide.artifacts a SET status='"+status+"',state_version=state_version+1 FROM hyperfide.graph_bundle_inputs b WHERE a.organisation_id=b.organisation_id AND a.run_id=b.run_id AND a.id=b.artifact_id AND b.graph_id='"+build+"'")

def publication(f):
    b=f.create()["build_id"];operation=str(uuid.uuid4());request=f.scoped(build_id=b,channel="main",expected_generation="0",operation_id=operation);state={}
    check("graph.publication.reject-partial",lambda:f.reject("7.3","graph.publish.commit",request,"GRAPH_INCOMPLETE"))
    def ready():state["build"]=f.ready();expect(state["build"]==b,"ready replay changed build")
    check("graph.publication.complete-build",ready)
    def quarantined_publish():
        artifact_status(b,"QUARANTINED")
        try:
            f.reject("7.3","graph.publish.commit",request,"GRAPH_ARTIFACT_UNAVAILABLE")
            expect(sql("SELECT count(*) FROM hyperfide.graph_manifests").stdout.strip()=="0","unavailable artifact published a manifest")
        finally:artifact_status(b,"COMPLETE")
    check("graph.publication.reject-quarantined-artifact",quarantined_publish)

    def publish():
        state["receipt"]=f.ok("7.3","graph.publish.commit",request)
        expect(state["receipt"]["publication_generation"]=="1","publication generation differs")
        expect(sql("SELECT count(*) FROM hyperfide.graph_manifests").stdout.strip()=="1","manifest was not committed")
    check("graph.publication.atomic-commit",publish)
    if "receipt" not in state:return
    receipt=state["receipt"]
    def isolation(table):
        expect(int(sql("SELECT count(*) FROM hyperfide."+table+" WHERE graph_id='"+b+"'").stdout.strip())>0,"authority isolation fixture table has no actual rows")
        result=sql("BEGIN ISOLATION LEVEL REPEATABLE READ; UPDATE hyperfide."+table+" SET organisation_id=organisation_id WHERE graph_id='"+b+"'; ROLLBACK;",allow_error=True)
        expect(result.returncode!=0 and "authority writes require READ COMMITTED or SERIALIZABLE" in result.stderr,"unsupported isolation was accepted or refused for another reason")
    check("graph.publication.reject-repeatable-read-graph_bundle_inputs",lambda:isolation("graph_bundle_inputs"))
    check("graph.publication.reject-repeatable-read-graph_ingestion_chunks",lambda:isolation("graph_ingestion_chunks"))
    check("graph.publication.reject-repeatable-read-graph_fact_rows",lambda:isolation("graph_fact_rows"))
    check("graph.publication.reject-repeatable-read-graph_resolution_progress",lambda:isolation("graph_resolution_progress"))
    check("graph.publication.reject-repeatable-read-graph_source_bodies",lambda:isolation("graph_source_bodies"))
    check("graph.publication.reject-repeatable-read-graph_publication_receipts",lambda:isolation("graph_publication_receipts"))
    check("graph.publication.durable-channel",lambda:expect(sql("SELECT manifest_id::text FROM hyperfide.graph_channels WHERE name='main'").stdout.strip()==receipt["manifest_id"],"channel differs from receipt"))
    def crash_after_publication():
        f.fixture.child.kill();f.fixture.child.communicate(timeout=8);f.fixture.child=None;f.fixture.start()
        replay=f.ok("7.3","graph.publish.commit",request)
        expect(replay["manifest_id"]==receipt["manifest_id"] and replay["replayed"] is True,"durable publication receipt lost after actual service process crash")
    check("graph.publication.crash-preserves-committed-receipt",crash_after_publication)
    check("graph.publication.idempotent-operation",lambda:expect(f.ok("7.3","graph.publish.commit",request)["manifest_id"]==receipt["manifest_id"],"replayed operation changed publication"))
    check("graph.publication.reject-operation-conflict",lambda:f.reject("7.3","graph.publish.commit",dict(request,channel="other"),"GRAPH_OPERATION_CONFLICT"))
    check("graph.publication.reject-cas-conflict",lambda:f.reject("7.3","graph.publish.commit",dict(request,operation_id=str(uuid.uuid4())),"GRAPH_GENERATION_CONFLICT"))
    def immutable():
        p=sql("UPDATE hyperfide.graph_fact_rows SET payload=payload||'{\"tampered\":true}'::jsonb WHERE family='symbols'",allow_error=True)
        expect(p.returncode!=0,"published source facts remained mutable")
    check("graph.publication.sql-immutable-facts",immutable)
    def next_generation():
        new=f.extract("2");new_build=f.ready(new);state["new"]=f.publish(new_build,expected="1")
        expect(state["new"]["publication_generation"]=="2","new extraction did not publish next generation")
    check("graph.publication.replace-new-generation",next_generation)
    def generation_collision():
        request=copy.deepcopy(f.native.input);request["generation"]="2";request["configuration"]["build_flags"]=["--distinct-index-configuration"]
        changed=f.native.ok("graph.extract.create",request);build=f.ready(changed)
        f.reject("7.3","graph.publish.commit",f.scoped(build_id=build,channel="main",expected_generation="2",operation_id=str(uuid.uuid4())),"GRAPH_GENERATION_CONFLICT")
    check("graph.publication.reject-same-generation-different-configuration",generation_collision)
    check("graph.publication.reject-delayed-extraction",lambda:f.reject("7.3","graph.publish.commit",dict(request,expected_generation="2",operation_id=str(uuid.uuid4())),"GRAPH_GENERATION_STALE"))
    check("graph.publication.preserve-old-version",lambda:expect(f.ok("7.3","graph.publish.inspect",f.scoped(manifest_id=receipt["manifest_id"]))["manifest_digest"]==receipt["manifest_digest"],"older immutable graph disappeared"))
    def extension_move_denied():
        # Operator-only fault setup: a disposable unpublished target has the same
        # parent bundle, so a missing old-graph guard cannot hide behind an FK.
        target=f.create(f.extract("3"))["build_id"]
        sql("INSERT INTO hyperfide.graph_bundle_inputs(organisation_id,run_id,graph_id,bundle_digest,identity,manifest,manifest_text,artifact_id) SELECT organisation_id,run_id,'"+target+"',bundle_digest,identity,manifest,manifest_text,artifact_id FROM hyperfide.graph_bundle_inputs WHERE graph_id='"+b+"'")
        result=sql("BEGIN; UPDATE hyperfide.graph_fact_rows SET graph_id='"+target+"' WHERE graph_id='"+b+"' AND family='comments'; ROLLBACK;",allow_error=True)
        expect(result.returncode!=0 and "graph extension scope immutable" in result.stderr,"published facts could move to an unpublished graph or refusal was unrelated")
    check("graph.publication.reject-published-extension-scope-move",extension_move_denied)
    pins=[{"repository_id":native.UUIDS["repository_id"],"source_object_id":f.native.commit}]
    def snapshot():
        snap=f.ok("7.3","graph.publish.snapshot",f.scoped(manifest_id=receipt["manifest_id"],expected_sources=pins))
        expect(snap["expected_sources_validated"] is True and snap["source_set"][0]["commit"]==f.native.commit,"exact source snapshot not validated")
        expect(snap["source_coverage"][0]["complete"] is True and snap["source_coverage"][0]["identity"]["source_kind"]=="COMMIT","immutable parse/overlay provenance lost")
        expect(snap["file_coverage"][0]["source_object_id"]==f.native.commit,"file coverage not pinned")
        expect(int(snap["unprojected_semantic_edge_count"])>0 and snap["semantic_projection_complete"] is False and snap["unknown_semantic_edges"],"snapshot hid actual native unprojected semantic edges")
    check("graph.publication.exact-source-snapshot",snapshot)
    check("graph.publication.reject-wrong-source-snapshot",lambda:f.reject("7.3","graph.publish.snapshot",f.scoped(manifest_id=receipt["manifest_id"],expected_sources=[dict(pins[0],source_object_id="f"*40)]),"GRAPH_SOURCE_SET_MISMATCH"))
    check("graph.publication.reject-overlay-relabel",lambda:f.reject("7.3","graph.publish.snapshot",f.scoped(manifest_id=receipt["manifest_id"],expected_sources=[dict(pins[0],overlay_digest=sha("unrelated overlay"))]),"GRAPH_SOURCE_SET_MISMATCH"))
    def race():
        requests=[f.scoped(build_id=b,channel="race",expected_generation="0",operation_id=str(uuid.uuid4())) for _ in range(2)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda r:f.request("7.3","graph.publish.commit",r),requests))
        expect(sum(response.get("ok") is True for _,response in results)==1,"concurrent publication admitted more or fewer than one winner")
        expect(sql("SELECT count(*) FROM hyperfide.graph_channels WHERE name='race'").stdout.strip()=="1","publication race left duplicate/missing channel")
    check("graph.publication.concurrent-cas",race)
    def quarantined_history():
        artifact_status(b,"QUARANTINED")
        try:
            f.reject("7.3","graph.publish.snapshot",f.scoped(manifest_id=receipt["manifest_id"],expected_sources=pins),"GRAPH_ARTIFACT_UNAVAILABLE")
            f.reject("7.3","graph.publish.commit",request,"GRAPH_ARTIFACT_UNAVAILABLE")
        finally:artifact_status(b,"COMPLETE")
    check("graph.publication.reject-unavailable-history-and-replay",quarantined_history)

def querying(f):
    state={}
    def ready():
        state["build"]=f.ready();state["receipt"]=f.publish(state["build"]);state["manifest"]=state["receipt"]["manifest_id"]
    check("graph.query.setup-published",ready)
    if "manifest" not in state:return
    manifest=state["manifest"]
    def request(action,**kw):return f.ok("7.4",action,f.scoped(manifest_id=manifest,**kw))
    check("graph.query.exact-manifest-status",lambda:expect(request("graph.query.status")["manifest_digest"]==state["receipt"]["manifest_digest"],"query substituted a graph"))
    def quarantined_query():
        artifact_status(state["build"],"QUARANTINED")
        try:
            f.reject("7.4","graph.query.status",f.scoped(manifest_id=manifest),"GRAPH_ARTIFACT_UNAVAILABLE")
            f.reject("7.4","graph.query.search",f.scoped(manifest_id=manifest,mode="body",q="searchable"),"GRAPH_ARTIFACT_UNAVAILABLE")
        finally:artifact_status(state["build"],"COMPLETE")
    check("graph.query.reject-quarantined-manifest-custody",quarantined_query)

    check("graph.query.reject-missing-version",lambda:f.reject("7.4","graph.query.status",f.scoped(manifest_id=str(uuid.uuid4())),"GRAPH_VERSION_UNAVAILABLE"))
    check("graph.query.channel-status",lambda:expect(f.ok("7.4","graph.query.status",f.scoped(channel="main"))["manifest_id"]==manifest,"channel status lost exact manifest"))
    # Independent real legacy SQLite baseline built from the identical Git source.
    (f.native.repo/".codegraph/objects").mkdir(parents=True)
    native.process([str(ROOT/"cg"),"index","--full","--json","--workers","1"],f.native.repo)
    baseline=sqlite3.connect(f.native.repo/".codegraph/graph.db")
    def symbols():
        expected=sorted(row[0] for row in baseline.execute("SELECT name FROM symbols WHERE lower(name)='helper'"))
        state["symbol_search"]=request("graph.query.search",mode="symbol",q="helper")
        actual=sorted(row["payload"]["name"] for row in state["symbol_search"]["rows"])
        expect(actual==expected and expected,"symbol search differs from real SQLite baseline")
    check("graph.query.symbol-baseline",symbols)
    def bodies():
        expected=sorted(row[0] for row in baseline.execute("SELECT f.path FROM body_fts JOIN files f ON f.id=body_fts.rowid WHERE body_fts MATCH 'searchable'"))
        actual=request("graph.query.search",mode="body",q="searchable")
        expect(sorted(row["path"] for row in actual["rows"])==expected and expected,"body search differs from real SQLite baseline")
    check("graph.query.body-baseline",bodies)
    def comments():
        expected=sorted(row[0] for row in baseline.execute("SELECT c.body FROM comments c JOIN comment_fts ft ON ft.rowid=c.id WHERE comment_fts MATCH 'counted'"))
        actual=request("graph.query.search",mode="comment",q="counted")
        expect(sorted(row["payload"]["body"] for row in actual["rows"])==expected,"comment search differs from real SQLite baseline")
    check("graph.query.comment-baseline",comments)
    def trigram():
        expected=sorted(row[0] for row in baseline.execute("SELECT name FROM symbols WHERE lower(name) LIKE '%elp%'"))
        actual=request("graph.query.search",mode="trigram",q="elp")
        expect(sorted(row["payload"]["name"] for row in actual["rows"] if row["family"]=="symbols")==expected and expected,"substring candidates differ")
    check("graph.query.trigram-baseline",trigram)
    def body_trigram():
        expected=sorted(row[0] for row in baseline.execute("SELECT f.path FROM body_tri JOIN files f ON f.id=body_tri.rowid WHERE body_tri MATCH 'afé'"))
        actual=request("graph.query.search",mode="body-trigram",q="afé")
        expect(sorted(row["path"] for row in actual["rows"])==expected and expected,"Unicode body trigrams differ from actual legacy SQLite")
    check("graph.query.unicode-body-trigram-baseline",body_trigram)
    def pagination():
        a=request("graph.query.search",mode="body",q="body",limit=1)
        expect(a["next_cursor"] is not None,"multi-result fixture did not paginate")
        b=request("graph.query.search",mode="body",q="body",limit=1,cursor=a["next_cursor"])
        expect(not ({(x["bundle_digest"],x["path"]) for x in a["rows"]}&{(x["bundle_digest"],x["path"]) for x in b["rows"]}),"pinned pagination repeated result")
        state["cursor"]=a["next_cursor"]
    check("graph.query.stable-pagination",pagination)
    def cursor():
        if "cursor" not in state:raise AssertionError("positive cursor fixture missing")
        f.reject("7.4","graph.query.search",f.scoped(manifest_id=manifest,mode="body",q="different",limit=1,cursor=state["cursor"]),"GRAPH_CURSOR_INVALID")
    check("graph.query.reject-cross-query-cursor",cursor)
    rows=sql("SELECT id::text FROM hyperfide.graph_symbols WHERE name='helper'").stdout.strip().splitlines()
    def context():
        actual=request("graph.query.context",symbol_ids=rows,files=[],max_bytes=262144)
        expect(actual["nodes"] and actual["files"] and actual["manifest_id"]==manifest,"grouped context omitted selected source")
        expect(any(row["family"]=="comments" for row in actual["source_facts"]),"source comments lost in context")
    check("graph.query.grouped-context",context)
    check("graph.query.reject-missing-context-symbol",lambda:f.reject("7.4","graph.query.context",f.scoped(manifest_id=manifest,symbol_ids=[str(uuid.uuid4())],files=[]),"GRAPH_SYMBOL_UNAVAILABLE"))
    check("graph.query.reject-partial-context-symbol-set",lambda:f.reject("7.4","graph.query.context",f.scoped(manifest_id=manifest,symbol_ids=rows+[str(uuid.uuid4())],files=[]),"GRAPH_SYMBOL_UNAVAILABLE"))
    check("graph.query.reject-missing-context-file",lambda:f.reject("7.4","graph.query.context",f.scoped(manifest_id=manifest,symbol_ids=[],files=[{"repository_id":native.UUIDS["repository_id"],"path":"missing.py"}]),"GRAPH_FILE_UNAVAILABLE"))
    check("graph.query.reject-wrong-repository-context-file",lambda:f.reject("7.4","graph.query.context",f.scoped(manifest_id=manifest,symbol_ids=[],files=[{"repository_id":str(uuid.uuid4()),"path":"maths.py"}]),"GRAPH_FILE_UNAVAILABLE"))
    def traversal():
        actual=request("graph.query.traverse",symbol_ids=rows,direction="both",depth=2,max_nodes=100)
        expect(actual["nodes"] and actual["manifest_id"]==manifest,"version-pinned traversal lost seed")
        expect(actual["complete"] is False or actual["unresolved_count"]=="0","unknown graph was reported complete")
    check("graph.query.traversal-unknowns",traversal)
    def semantic_debt():
        actual=request("graph.query.traverse",symbol_ids=rows,direction="both",depth=1,max_nodes=100)
        raw_count=int(sql("SELECT count(*) FROM hyperfide.graph_fact_rows WHERE family='semantic_edges' AND graph_id='"+state["build"]+"'").stdout.strip())
        projected=int(sql("SELECT count(*) FROM hyperfide.graph_edges WHERE graph_id='"+state["build"]+"'").stdout.strip())
        expected=raw_count-projected
        OBS.append({"observation":"semantic_projection_debt","raw_edges":raw_count,"projected_edges":projected,"unprojected_edges":expected,"unknown_rows_returned":len(actual["unknown_semantic_edges"])})
        expect(int(actual["unprojected_semantic_edge_count"])==expected,"raw semantic projection debt lost")
        expect(expected>0,"actual native top-level call fixture omitted expected unresolved source endpoint")
        expect(actual["unknown_semantic_edges"] and actual["complete"] is False,"unprojected semantic edges were called complete")
    check("graph.query.explicit-unprojected-semantic-edge-debt",semantic_debt)
    check("graph.query.reject-wrong-symbol-version",lambda:f.reject("7.4","graph.query.traverse",f.scoped(manifest_id=manifest,symbol_ids=[str(uuid.uuid4())],direction="both",depth=1,max_nodes=10),"GRAPH_SYMBOL_UNAVAILABLE"))
    check("graph.query.reject-unbounded-depth",lambda:f.reject("7.4","graph.query.traverse",f.scoped(manifest_id=manifest,symbol_ids=rows,direction="both",depth=100,max_nodes=100),"GRAPH_INVALID"))
    check("graph.query.primary-provenance",lambda:expect(request("graph.query.status")["provenance"]["route"]=="PRIMARY","unqualified replica freshness was claimed"))
    check("graph.query.literal-special-characters",lambda:expect(request("graph.query.search",mode="trigram",q="' OR true --")["rows"]==[],"literal query changed SQL structure"))
    check("graph.query.reject-sql-field",lambda:f.reject("7.4","graph.query.status",f.scoped(manifest_id=manifest,sql="SELECT 1"),"GRAPH_INVALID"))
    def readiness():
        sql("ALTER TABLE hyperfide.graph_fact_rows DISABLE TRIGGER aaa_supported_isolation")
        try:f.reject("7.4","graph.query.status",f.scoped(manifest_id=manifest),"GRAPH_SCHEMA_UNAVAILABLE")
        finally:sql("ALTER TABLE hyperfide.graph_fact_rows ENABLE TRIGGER aaa_supported_isolation")
    check("graph.query.reject-missing-authority-isolation-guard",readiness)
    baseline.close()
    def changed_source():
        source=f.native.repo
        native.process(["git","mv","route.js","renamed-route.js"],source)
        (source/"maths.py").unlink()
        (source/"fresh.py").write_text("def replacement_fresh():\n    return 43\n")
        native.process(["git","add","-u"],source);native.process(["git","add","fresh.py"],source);native.process(["git","commit","-qm","rename and remove fixture source"],source)
        commit=native.process(["git","rev-parse","HEAD"],source);tree=native.process(["git","rev-parse","HEAD^{tree}"],source)
        sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES('"+SCOPE["organisation_id"]+"','"+native.UUIDS["repository_id"]+"','"+commit+"')")
        f.native.input.update(commit=commit,tree=tree)
        new=f.extract("2");build=f.ready(new);receipt=f.publish(build,expected="1")
        state["next_manifest"]=receipt["manifest_id"]
        paths=sql("SELECT path FROM hyperfide.graph_files WHERE graph_id='"+build+"' ORDER BY path").stdout.splitlines()
        expect("maths.py" not in paths and "route.js" not in paths and "renamed-route.js" in paths and "fresh.py" in paths,"new graph retained removed/renamed files")
        old=request("graph.query.search",mode="symbol",q="helper")
        current=f.ok("7.4","graph.query.search",f.scoped(manifest_id=receipt["manifest_id"],mode="symbol",q="helper"))
        expect(old["rows"] and not current["rows"],"old/new version reads silently mixed source revisions")
    check("graph.query.source-delete-rename-version-isolation",changed_source)
    check("graph.query.reject-cross-version-context-symbol",lambda:f.reject("7.4","graph.query.context",f.scoped(manifest_id=state["next_manifest"],symbol_ids=rows,files=[]),"GRAPH_SYMBOL_UNAVAILABLE"))
    check("graph.query.reject-cross-version-cursor",lambda:f.reject("7.4","graph.query.search",f.scoped(manifest_id=state["next_manifest"],mode="body",q="body",limit=1,cursor=state["cursor"]),"GRAPH_CURSOR_INVALID"))
    def multiple_repositories():
        second_id=str(uuid.uuid4());second=f.native.base/"second-repository"
        native.process(["git","-c","maintenance.auto=false","clone","--quiet","--no-hardlinks",str(f.native.repo),str(second)],f.native.base)
        commit=native.process(["git","rev-parse","HEAD"],second);tree=native.process(["git","rev-parse","HEAD^{tree}"],second)
        org=SCOPE["organisation_id"];run=SCOPE["run_id"]
        f.fixture.sql("INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url) VALUES($1,$2,$3,'second-graph-fixture','https://example.invalid/second')",[org,f.fixture.ids["project"],second_id])
        f.fixture.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[org,second_id,commit])
        f.fixture.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[org,run,second_id,commit])
        f.native.configuration["repositories"][second_id]=str(second);f.native.config.write_text(encoded(f.native.configuration))
        try:
            second_manifest=f.native.ok("graph.extract.create",dict(f.native.input,repository_id=second_id,commit=commit,tree=tree,generation="1"))
            manifests=[f.manifest,second_manifest]
            build=f.ok("7.2","graph.ingest.create",f.scoped(bundles=manifests))["build_id"]
            for item in manifests:f.stage(build,item,f.native.chunks(item))
            f.ok("7.2","graph.ingest.seal",f.scoped(build_id=build))
            for _ in range(100):
                resolved=f.ok("7.2","graph.ingest.resolve",f.scoped(build_id=build,limit=8))
                if resolved["state"]=="READY":break
            else:raise AssertionError("two-repository graph failed bounded resolution")
            receipt=f.publish(build,channel="multi")
            result=f.ok("7.4","graph.query.search",f.scoped(manifest_id=receipt["manifest_id"],mode="body",q="Unicode"))
            bindings={row["bundle_digest"]:row["identity"] for row in result["source_coverage"]}
            matched=[bindings[row["bundle_digest"]] for row in result["rows"]]
            expected={native.UUIDS["repository_id"]:f.manifest["identity"]["commit"],second_id:commit}
            expect({row["repository_id"]:row["commit"] for row in matched}==expected,"same-path body search lost repository/source bindings")
            context=f.ok("7.4","graph.query.context",f.scoped(manifest_id=receipt["manifest_id"],symbol_ids=[],files=[{"repository_id":second_id,"path":"README.md"}]))
            expect(len(context["files"])==1 and context["files"][0]["repository_id"]==second_id,"file context crossed repository namespace")
            crossing=sql("SELECT count(*) FROM hyperfide.graph_edges e JOIN hyperfide.graph_symbols s ON s.id=e.source_symbol_id AND s.graph_id=e.graph_id JOIN hyperfide.graph_symbols t ON t.id=e.target_symbol_id AND t.graph_id=e.graph_id JOIN hyperfide.graph_files sf ON sf.id=s.file_id AND sf.graph_id=s.graph_id JOIN hyperfide.graph_files tf ON tf.id=t.file_id AND tf.graph_id=t.graph_id WHERE e.graph_id='"+build+"' AND sf.repository_id<>tf.repository_id").stdout.strip()
            expect(crossing=="0","matching native local symbol IDs created false cross-repository edges")
            OBS.append({"observation":"two-real-repository-namespace","manifest_id":receipt["manifest_id"],"source_pins":expected,"body_hits":len(result["rows"]),"false_cross_repository_edges":0})
        finally:
            f.native.configuration["repositories"].pop(second_id,None);f.native.config.write_text(encoded(f.native.configuration))
    check("graph.query.multiple-repository-namespace-and-provenance",multiple_repositories)
def main(mode="7.2"):
    fixture=None
    try:
        with tempfile.TemporaryDirectory(prefix="hf-domain07-") as directory:
            fixture=Fixture(Path(directory))
            {"7.2":ingestion,"7.3":publication,"7.4":querying}[mode](fixture)
            artifact_root().mkdir(parents=True,exist_ok=True)
            (artifact_root()/("task-"+mode+"-observations.json")).write_text(encoded({"scope":"task-component","task":mode,"source":fixture.manifest,
                "observations":OBS,"assertion_count":len(IDS),"failures":FAILED,"full_campaigns":"NOT_CLAIMED"})+"\n")
            return 1 if FAILED else 0
    finally:
        if fixture:fixture.native.close()
if __name__=="__main__":
    if "--cleanup" in sys.argv:sys.exit(cleanup())
    sys.exit(main())
