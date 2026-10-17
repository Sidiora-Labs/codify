"""Task 7.4 replica/cache replay (V-023) and component-scope mixed load (V-048).

The standby is a real PostgreSQL 18 physical streaming replica owned by this run.
Replica and cache reads are only served after the primary admitted the exact
manifest in the same request; neither may grant authority or move publication.
"""
from __future__ import annotations
import concurrent.futures,json,os,statistics,subprocess,tempfile,threading,time,uuid
from pathlib import Path
from urllib.parse import parse_qsl,urlencode,urlsplit,urlunsplit
CACHE_ENTRIES=3

def routed(url,path):
    u=urlsplit(url);q=dict(parse_qsl(u.query));q["host"]=str(path);return urlunsplit((u.scheme,u.netloc,u.path,urlencode(q),u.fragment))
def drain(child):
    """The service writes diagnostics to pipes; a reader prevents pipe back-pressure under load."""
    for stream in (child.stdout,child.stderr):
        threading.Thread(target=lambda s=stream:[None for _ in iter(s.readline,"")],daemon=True).start()
def restart(h,**env):
    f=h.f.fixture;f.stop()
    for key,value in env.items():
        if value is None:f.env.pop(key,None)
        else:f.env[key]=value
    f.start();drain(f.child)
def attach(h):
    """Trusted operator setup: topology observation grant and a replica route for the runtime role."""
    f=h.f.fixture;c=h.cluster
    f.sql("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC")
    f.sql('GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO "'+f.runtime_role+'"')
    h.replica_url=routed(f.runtime_url,c.replica_socket)
    restart(h,HYPERFIDE_CONTROL_REPLICA_DATABASE_URL=h.replica_url,HYPERFIDE_GRAPH_QUERY_CACHE_ENTRIES=str(CACHE_ENTRIES))
def standby(h,statement):return h.cluster.sql(statement,replica=True,database=h.database)
def wait_replayed(h,timeout=20):
    target=h.cluster.sql("SELECT pg_current_wal_lsn()::text")
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if standby(h,"SELECT pg_last_wal_replay_lsn()>='"+target+"'::pg_lsn")=="t":return
        time.sleep(.05)
    raise AssertionError("standby did not replay within fixture deadline")
def semantic(result):return {k:v for k,v in result.items() if k!="provenance"}
def artifacts(h,manifest,status):
    h.sql("UPDATE hyperfide.artifacts a SET status='"+status+"',state_version=state_version+1 FROM hyperfide.graph_bundle_inputs b JOIN hyperfide.graph_manifests m ON m.organisation_id=b.organisation_id AND m.run_id=b.run_id AND m.build_id=b.graph_id WHERE a.organisation_id=b.organisation_id AND a.run_id=b.run_id AND a.id=b.artifact_id AND m.id='"+manifest+"'")
def authority_snapshot(h):
    return h.sql("SELECT string_agg(name||':'||manifest_id||':'||publication_generation||':'||state_version,',' ORDER BY name) FROM hyperfide.graph_channels")+"|"+h.sql("SELECT count(*)||':'||count(DISTINCT manifest_digest) FROM hyperfide.graph_manifests")+"|"+h.sql("SELECT count(*) FROM hyperfide.graph_publication_receipts")

def run(h):
    check=h.check;expect=h.expect;state={}
    manifest=h.sql("SELECT manifest_id::text FROM hyperfide.graph_channels WHERE name='contracts'")
    queries=[("graph.query.search",{"mode":"body","q":"ledger"}),("graph.query.search",{"mode":"body-trigram","q":"école"}),
        ("graph.query.contracts",{"kind":"routes"}),("graph.query.status",None)]
    def identity():
        wait_replayed(h)
        for action,extra in queries[:3]:
            primary=h.ok(action,manifest_id=manifest,**extra);replica=h.ok(action,manifest_id=manifest,read_options={"route":"REPLICA","wait_ms":2000},**extra)
            p=replica["provenance"]
            expect(p["route"]=="REPLICA" and p["exact_version"] is True and p["authority"]=="NONE" and p["replay_lsn"] and p["barrier_lsn"],"replica read lacked exact replica provenance: "+h.encoded(p))
            expect(semantic(replica)==semantic(primary),"replica result differs from primary for the same exact manifest")
        ids=h.sql("SELECT s.id FROM hyperfide.graph_symbols s JOIN hyperfide.graph_manifests m ON m.build_id=s.graph_id WHERE m.id='"+manifest+"' AND s.name='balance'").split()
        t1=h.ok("graph.query.traverse",manifest_id=manifest,symbol_ids=ids,direction="callers",depth=2,max_nodes=50)
        t2=h.ok("graph.query.traverse",manifest_id=manifest,symbol_ids=ids,direction="callers",depth=2,max_nodes=50,read_options={"route":"REPLICA","wait_ms":2000})
        expect(semantic(t1)==semantic(t2) and t2["provenance"]["route"]=="REPLICA","replica traversal differs")
        h.reject("graph.query.search",manifest_id=str(uuid.uuid4()),mode="body",q="ledger",read_options={"route":"REPLICA"},code="GRAPH_VERSION_UNAVAILABLE")
        h.reject("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"PRIMARY","fallback":"PRIMARY"},code="GRAPH_INVALID")
        h.obs({"observation":"replica-exact-identity","manifest":manifest,"provenance":t2["provenance"]})
    check("graph.query.replica-exact-version-identity",identity)
    def lag():
        standby(h,"SELECT pg_wal_replay_pause()")
        try:
            for _ in range(100):
                if standby(h,"SELECT pg_get_wal_replay_pause_state()")=="paused":break
                time.sleep(.02)
            else:raise AssertionError("standby replay did not pause")
            repo=h.repos["contracts"];newer=h.publish_manifest(repo.extract(h.revisions["contracts"]),"contracts-replica")
            state["newer"]=newer
            for target in (manifest,newer):
                h.reject("graph.query.search",manifest_id=target,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":150},code="GRAPH_REPLICA_LAG")
            exists=standby(h,"SELECT count(*) FROM hyperfide.graph_manifests WHERE id='"+newer+"'")
            expect(exists=="0","paused standby unexpectedly contains the newer manifest")
            fallback=h.ok("graph.query.search",manifest_id=newer,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":150,"fallback":"PRIMARY"})
            expect(fallback["provenance"]["route"]=="PRIMARY" and fallback["provenance"]["fallback"]=={"requested":"REPLICA","reason":"REPLICA_LAG"} and fallback["manifest_id"]==newer,"declared fallback was not explicit")
            expect(semantic(fallback)==semantic(h.ok("graph.query.search",manifest_id=newer,mode="body",q="ledger")),"fallback result differs from primary")
            # Custody can change after publication: a stale replica copy must not serve a quarantined graph.
            artifacts(h,manifest,"QUARANTINED")
            try:
                h.reject("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":150,"fallback":"PRIMARY"},code="GRAPH_ARTIFACT_UNAVAILABLE")
                expect(standby(h,"SELECT count(*) FROM hyperfide.artifacts WHERE status='QUARANTINED'")=="0","paused standby already observed quarantine")
            finally:artifacts(h,manifest,"COMPLETE")
            def resume():time.sleep(.6);standby(h,"SELECT pg_wal_replay_resume()")
            thread=threading.Thread(target=resume);thread.start()
            waited=h.ok("graph.query.search",manifest_id=newer,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":5000})
            thread.join()
            expect(waited["provenance"]["route"]=="REPLICA" and waited["provenance"]["replay_wait_ms"]>0 and waited["provenance"]["observations"]>1 and waited["manifest_id"]==newer,"replica did not wait for replay before its snapshot")
            h.obs({"observation":"replica-lag","paused_manifest":newer,"waited":waited["provenance"]})
        finally:standby(h,"SELECT pg_wal_replay_resume()")
    check("graph.query.replica-lag-explicit-refusal-and-declared-fallback",lag)
    def cache():
        before=authority_snapshot(h)
        options={"route":"PRIMARY","cache":"USE"}
        first=h.ok("graph.query.contracts",manifest_id=manifest,kind="routes",read_options=options)
        second=h.ok("graph.query.contracts",manifest_id=manifest,kind="routes",read_options=options)
        expect(first["provenance"]["cache"]=="MISS" and second["provenance"]["cache"]=="HIT" and second["provenance"]["cache_authority"]=="NONE","cache hit/miss is not explicit")
        expect(semantic(first)==semantic(second),"cached result differs")
        artifacts(h,manifest,"QUARANTINED")
        try:h.reject("graph.query.contracts",manifest_id=manifest,kind="routes",read_options=options,code="GRAPH_ARTIFACT_UNAVAILABLE")
        finally:artifacts(h,manifest,"COMPLETE")
        replica_cached=h.ok("graph.query.contracts",manifest_id=manifest,kind="routes",read_options={"route":"REPLICA","cache":"USE","wait_ms":2000})
        expect(replica_cached["provenance"]["cache"]=="HIT","replica-routed cache did not reuse the admitted exact result")
        expect(authority_snapshot(h)==before,"cache or replica reads changed authoritative publication")
    check("graph.query.cache-requires-primary-admission",cache)
    def eviction():
        described=h.ok_raw("graph.query.describe",{})
        expect(described["cache"]["capacity"]==CACHE_ENTRIES and described["cache"]["authority"]=="NONE","cache capacity is not explicit")
        options={"route":"PRIMARY","cache":"USE"}
        words=["ledger","review","notes","settle"]
        for word in words:h.ok("graph.query.search",manifest_id=manifest,mode="body",q=word,read_options=options)
        evicted=h.ok("graph.query.search",manifest_id=manifest,mode="body",q=words[0],read_options=options)
        kept=h.ok("graph.query.search",manifest_id=manifest,mode="body",q=words[-1],read_options=options)
        expect(evicted["provenance"]["cache"]=="MISS" and kept["provenance"]["cache"]=="HIT","bounded cache eviction is not observable")
        after=h.ok_raw("graph.query.describe",{})
        expect(after["cache"]["evictions"]>described["cache"]["evictions"] and after["cache"]["entries"]<=CACHE_ENTRIES,"cache exceeded its bound")
        expect(semantic(evicted)==semantic(h.ok("graph.query.search",manifest_id=manifest,mode="body",q=words[0])),"evicted entry reload differs")
    check("graph.query.cache-eviction-explicit",eviction)
    def disconnected():
        standby(h,"SELECT pg_wal_replay_pause()")
        try:
            h.sql("INSERT INTO hyperfide.outbox_events(organisation_id,run_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload) VALUES('"+h.scope["organisation_id"]+"','"+h.scope["run_id"]+"','hf74-disconnect',gen_random_uuid(),1,'graph.disconnect','{}')")
            op=h.f.fixture.operation("7.4","graph.query.search",h.f.scoped(manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":4000}))
            try:h.f.fixture.request(op,timeout_seconds=0.5);dropped=False
            except Exception:dropped=True
            expect(dropped,"client did not disconnect before the replica wait completed")
        finally:standby(h,"SELECT pg_wal_replay_resume()")
        wait_replayed(h);time.sleep(4.5)
        role=h.f.fixture.runtime_role
        leaked=standby(h,"SELECT count(*) FROM pg_stat_activity WHERE usename='"+role+"' AND state LIKE 'idle in transaction%'")
        expect(leaked=="0","disconnected client left a replica snapshot open")
        after=h.ok("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":2000})
        expect(after["provenance"]["route"]=="REPLICA","replica route did not recover after client disconnect")
    check("graph.query.disconnected-client-releases-replica",disconnected)
    def unavailable():
        try:
            restart(h,HYPERFIDE_CONTROL_REPLICA_DATABASE_URL=routed(h.f.fixture.runtime_url,h.cluster.root/"missing-socket"))
            h.reject("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":100},code="GRAPH_REPLICA_UNAVAILABLE")
            r=h.ok("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":100,"fallback":"PRIMARY"})
            expect(r["provenance"]["route"]=="PRIMARY" and r["provenance"]["fallback"]["requested"]=="REPLICA","unavailable replica fallback was not explicit")
            restart(h,HYPERFIDE_CONTROL_REPLICA_DATABASE_URL=routed(h.f.fixture.runtime_url,h.cluster.socket))
            response=h.raw("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":100})
            expect(response.get("ok") is False and response["error"]["code"]=="GRAPH_REPLICA_UNAVAILABLE" and "REPLICA_REQUIRED" in response["error"]["message"],"primary configured as replica was not refused")
            restart(h,HYPERFIDE_CONTROL_REPLICA_DATABASE_URL=None)
            h.reject("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA"},code="GRAPH_REPLICA_UNAVAILABLE")
        finally:restart(h,HYPERFIDE_CONTROL_REPLICA_DATABASE_URL=h.replica_url)
    check("graph.query.replica-unavailable-explicit",unavailable)
    def privilege():
        role=h.f.fixture.runtime_role
        h.f.fixture.sql('REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM "'+role+'"')
        try:
            response=h.raw("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA"})
            expect(response.get("ok") is False and "REPLICA_TOPOLOGY_PRIVILEGE_REQUIRED" in response["error"]["message"],"missing topology privilege was not explicit")
        finally:h.f.fixture.sql('GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO "'+role+'"')
        wait_replayed(h)
        expect(h.ok("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":2000})["provenance"]["route"]=="REPLICA","replica route did not recover")
    check("graph.query.replica-topology-privilege-explicit",privilege)

def percentiles(values):
    if not values:return None
    s=sorted(values);at=lambda p:s[min(len(s)-1,int(round(p*(len(s)-1))))]
    return {"n":len(s),"p50_ms":round(at(.5),2),"p95_ms":round(at(.95),2),"p99_ms":round(at(.99),2),"max_ms":round(s[-1],2),"mean_ms":round(statistics.fmean(s),2)}
PGBENCH="""BEGIN;
SELECT 1 FROM hyperfide.runs WHERE organisation_id=':org' AND id=':run' FOR NO KEY UPDATE;
INSERT INTO hyperfide.outbox_events(organisation_id,run_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload) VALUES(':org',':run','hf74-load',gen_random_uuid(),1,'graph.mixed-load','{"source":"pgbench"}');
END;
"""

def mixed_load(h,seconds=30):
    """V-048 at component scope: graph reads concurrent with graph writes, replica reads and claim/event writes."""
    check=h.check;expect=h.expect;state={}
    manifest=h.sql("SELECT manifest_id::text FROM hyperfide.graph_channels WHERE name='contracts'")
    corpus=h.sql("SELECT manifest_id::text FROM hyperfide.graph_channels WHERE name='corpus'")
    ids=h.sql("SELECT s.id FROM hyperfide.graph_symbols s JOIN hyperfide.graph_manifests m ON m.build_id=s.graph_id WHERE m.id='"+manifest+"' ORDER BY s.id").split()
    reads={
        "search":lambda:h.ok("graph.query.search",manifest_id=corpus or manifest,mode="body",q="parse",limit=50),
        "context":lambda:h.ok("graph.query.context",manifest_id=manifest,symbol_ids=ids[:8],files=[]),
        "traverse":lambda:h.ok("graph.query.traverse",manifest_id=manifest,symbol_ids=ids[:4],direction="both",depth=2,max_nodes=100),
        "contracts":lambda:h.ok("graph.query.contracts",manifest_id=manifest,kind="routes"),
        "replica":lambda:h.ok("graph.query.search",manifest_id=manifest,mode="body",q="ledger",read_options={"route":"REPLICA","wait_ms":2000,"fallback":"PRIMARY"}),
    }
    def amplification():
        # Count actual SQL statements the runtime role sends for grouped context with 1 versus many symbols.
        role=h.f.fixture.runtime_role;log=h.cluster.root/"primary.log"
        h.sql('ALTER ROLE "'+role+'" SET log_statement=\'all\'');restart(h)
        try:
            counts={}
            for n in (1,min(len(ids),20)):
                h.ok("graph.query.context",manifest_id=manifest,symbol_ids=ids[:1],files=[])
                start=log.stat().st_size;h.ok("graph.query.context",manifest_id=manifest,symbol_ids=ids[:n],files=[]);time.sleep(.3)
                with log.open("rb") as stream:stream.seek(start);text=stream.read().decode("utf-8","replace")
                counts[n]=sum(1 for line in text.splitlines() if "LOG:  statement:" in line or "LOG:  execute" in line)
        finally:h.sql('ALTER ROLE "'+role+'" RESET log_statement');restart(h)
        expect(len(counts)==2 and min(counts.values())>0,"statement observation failed")
        expect(len(set(counts.values()))==1,"grouped context statement count grows with symbol count: "+h.encoded(counts))
        h.obs({"observation":"grouped-context-amplification","statements_by_symbol_count":counts,"observer":"PostgreSQL log_statement=all for the runtime role"})
    check("graph.query.grouped-context-no-per-symbol-amplification",amplification)
    def baseline():
        state["baseline_results"]={name:semantic(fn()) for name,fn in reads.items()}
        state["baseline"]={}
        for name,fn in reads.items():
            values=[]
            for _ in range(15):started=time.perf_counter();fn();values.append((time.perf_counter()-started)*1000)
            state["baseline"][name]=percentiles(values)
    check("graph.query.mixed-load-quiet-baseline",baseline)
    def load():
        if "baseline" not in state:raise AssertionError("quiet baseline missing")
        latencies={name:[] for name in list(reads)+["graph-write"]};errors={name:{} for name in latencies};mismatch=[];samples=[];stop=time.monotonic()+seconds
        def reader(name):
            while time.monotonic()<stop:
                started=time.perf_counter()
                try:
                    value=reads[name]()
                    if semantic(value)!=state["baseline_results"][name]:mismatch.append(name)
                    latencies[name].append((time.perf_counter()-started)*1000)
                except Exception as error:code=str(error)[:120];errors[name][code]=errors[name].get(code,0)+1
        def writer():
            repo=h.repos["contracts"];n=0
            while time.monotonic()<stop:
                started=time.perf_counter()
                try:
                    rev=repo.commit({"load/batch-"+str(n)+".js":"function batch"+str(n)+"() { return "+str(n)+"; }\napp.get('/load/"+str(n)+"', batch"+str(n)+");\n"},"mixed load write "+str(n))
                    h.publish_manifest(repo.extract(rev),"load-writes");latencies["graph-write"].append((time.perf_counter()-started)*1000);n+=1
                except Exception as error:code=str(error)[:120];errors["graph-write"][code]=errors["graph-write"].get(code,0)+1
        def sampler():
            role=h.f.fixture.runtime_role
            while time.monotonic()<stop:
                row=h.sql("SELECT count(*) FILTER (WHERE usename='"+role+"')||'|'||count(*)||'|'||(SELECT count(*) FROM pg_locks WHERE NOT granted) FROM pg_stat_activity WHERE datname=current_database()")
                runtime,total,waiting=(int(v) for v in row.split("|"));samples.append({"runtime_connections":runtime,"database_connections":total,"waiting_locks":waiting});time.sleep(.2)
        script=Path(tempfile.mkdtemp(prefix="hf74-pgbench-"));(script/"claims.sql").write_text(PGBENCH.replace(":org",h.scope["organisation_id"]).replace(":run",h.scope["run_id"]))
        env=dict(os.environ,PGDATABASE=h.database)
        bench=subprocess.Popen(["/usr/lib/postgresql/18/bin/pgbench","-n","-c","4","-j","2","-T",str(seconds),"-f",str(script/"claims.sql"),"-l","--log-prefix",str(script/"claims")],cwd=script,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            futures=[pool.submit(reader,name) for name in reads for _ in range(2)]+[pool.submit(writer),pool.submit(sampler)]
            for future in futures:future.result()
        out,err=bench.communicate(timeout=seconds+60)
        claims=[]
        for path in script.glob("claims*"):
            for line in path.read_text().splitlines():
                parts=line.split()
                if len(parts)>=3 and parts[2].isdigit():claims.append(int(parts[2])/1000)
        result={"duration_seconds":seconds,"classes":{name:percentiles(values) for name,values in latencies.items()},"claims_events":percentiles(claims),
            "errors":errors,"pinned_result_mismatches":len(mismatch),"connections":{"max_runtime":max((s["runtime_connections"] for s in samples),default=0),
            "max_database":max((s["database_connections"] for s in samples),default=0),"max_waiting_locks":max((s["waiting_locks"] for s in samples),default=0),"samples":len(samples)},
            "pgbench_exit":bench.returncode,"pgbench_summary":[l for l in out.splitlines() if "latency" in l or "tps" in l or "failed" in l],
            "baseline":state["baseline"],"performance_claim":"NONE","speedup_claimed":False,
            "scope":"task-component: authenticated graph reads/writes and replica reads through the service; claim/event load is operator pgbench on real authority tables (claim/event components are outside this task closure); heartbeats and reviews not exercised"}
        state["result"]=result;h.obs({"observation":"mixed-load","result":result});h.write_artifact("graph/task-7.4-mixed-load.json",result)
        expect(bench.returncode==0 and claims,"claim/event load did not run: "+err[-400:])
        expect(all(result["classes"][name] and result["classes"][name]["n"]>=(1 if name=="graph-write" else 5) for name in latencies),"a load class starved: "+h.encoded({k:(v or {}).get("n") for k,v in result["classes"].items()}))
        expect(not mismatch,"exact-version results changed under load")
        expect(not any(errors.values()),"graph operations failed under mixed load: "+h.encoded(errors))
    check("graph.query.mixed-load-latency-distribution",load)
    def invariants():
        result=state.get("result")
        if not result:raise AssertionError("mixed load result missing")
        expect(result["connections"]["max_runtime"]<=40,"runtime connection pressure unbounded: "+str(result["connections"]))
        published=h.sql("SELECT count(*) FROM hyperfide.graph_manifests m JOIN hyperfide.graph_publication_receipts r ON r.organisation_id=m.organisation_id AND r.run_id=m.run_id AND r.manifest_id=m.id WHERE r.channel='load-writes'")
        generation=h.sql("SELECT publication_generation FROM hyperfide.graph_channels WHERE name='load-writes'")
        expect(int(published)==int(generation)==result["classes"]["graph-write"]["n"],"publication generations are not contiguous after saturation")
        expect(h.sql("SELECT count(*) FROM hyperfide.graph_builds b WHERE b.state='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM hyperfide.graph_manifests m WHERE m.organisation_id=b.organisation_id AND m.run_id=b.run_id AND m.build_id=b.id)")=="0","published build lacks a manifest")
        expect(result["performance_claim"]=="NONE" and result["speedup_claimed"] is False,"performance claim recorded without comparable baseline")
    check("graph.query.mixed-load-invariants-no-speedup-claim",invariants)
