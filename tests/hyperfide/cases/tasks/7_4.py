#!/usr/bin/env python3
"""Task 7.4 graph query parity on an owned PostgreSQL 18 primary and physical standby.

Runs the shared domain07 query assertions, then contract/caller/ranking parity,
incremental-versus-full and branch projections, a pinned real-source corpus,
migration diagnostics, replica/cache replay and a component-scope mixed load.
Every legacy baseline is the actual `cg` SQLite index of the identical Git source.
"""
import importlib.util,json,os,shutil,socket,subprocess,sys,tempfile,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
module=load("graph_domain_fixture",Path(__file__).with_name("7_2.py"))
physical=load("hf74_physical",ROOT/"tests/hyperfide/cases/support/postgres_cluster.py")
contracts=load("hf74_contracts",ROOT/"tests/hyperfide/cases/support/graph_contracts.py")
projection=load("hf74_projection",ROOT/"tests/hyperfide/cases/support/graph_projection.py")
replicas=load("hf74_replicas",ROOT/"tests/hyperfide/cases/support/graph_replicas.py")
RESOURCE="hf-task-7.4-postgres"

class CoordinatedSchemaService(module.native.Service):
    """MigrationCoordinator already applies 0007-graph with every release migration;
    the 7.1 fixture's second application fails with 'relation already exists'."""
    def __init__(self,*args,graph_schema=False,**kw):
        del graph_schema
        super().__init__(*args,graph_schema=False,**kw)
module.native.Service=CoordinatedSchemaService

class Harness:
    def __init__(self,fixture,cluster):
        self.f=fixture;self.cluster=cluster;self.scope=module.SCOPE;self.database=module.DATABASE
        self.check=module.check;self.expect=module.expect;self.encoded=module.encoded;self.projection=projection
        self.channels={};self.repos={};self.revisions={}
    def obs(self,value):module.OBS.append(value)
    def sql(self,statement):return module.sql(statement).stdout.strip()
    def raw(self,action,**kw):return self.f.request("7.4",action,self.f.scoped(**kw))[1]
    def ok(self,action,**kw):return self.f.ok("7.4",action,self.f.scoped(**kw))
    def ok_raw(self,action,value):return self.f.ok("7.4",action,value)
    def reject(self,action,code=None,**kw):return self.f.reject("7.4",action,self.f.scoped(**kw),code)
    def ready(self,manifest):
        build=self.f.create(manifest)["build_id"];self.f.stage(build,manifest,self.f.native.chunks(manifest))
        self.f.ok("7.2","graph.ingest.seal",self.f.scoped(build_id=build))
        for _ in range(2000):
            if self.f.ok("7.2","graph.ingest.resolve",self.f.scoped(build_id=build,limit=256))["state"]=="READY":return build
        raise AssertionError("bounded resolution did not complete")
    def publish_manifest(self,manifest,channel):
        expected=self.channels.get(channel,0)
        receipt=self.f.publish(self.ready(manifest),channel=channel,expected=str(expected))
        self.channels[channel]=int(receipt["publication_generation"]);return receipt["manifest_id"]
    def write_artifact(self,relative,value):
        path=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain07-direct"))/relative
        path.parent.mkdir(parents=True,exist_ok=True);path.write_text(self.encoded(value)+"\n")

def ledger():return module.artifact_root()/"cluster-resources.json"
def socket_up(path):
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
        s.settimeout(.2)
        try:s.connect(str(path));return True
        except OSError:return False
def absence(item):
    root=Path(item["root"]);result={"root_absent":not root.exists(),"sockets_unreachable":not any(socket_up(Path(p)) for p in item["sockets"])}
    module.artifact_root().mkdir(parents=True,exist_ok=True);(module.artifact_root()/"cluster-absence.json").write_text(module.encoded(result)+"\n")
    return result["root_absent"] and result["sockets_unreachable"]
def cleanup():
    path=ledger()
    if not path.exists():
        print(json.dumps({"type":"cleanup","complete":True,"resources":[]}),flush=True);return 0
    item=json.loads(path.read_text());root=Path(item["root"])
    module.expect(str(root).startswith("/tmp/hyperfide/hf-pg-") and "/" not in root.name,"owned cluster root malformed")
    if root.exists():
        for directory in [d for d in root.iterdir() if d.is_dir() and (d/"postmaster.pid").exists()]:
            subprocess.run(["runuser","-u","postgres","--","/usr/lib/postgresql/18/bin/pg_ctl","-D",str(directory),"-m","immediate","-w","stop"],capture_output=True,timeout=30)
        shutil.rmtree(root,ignore_errors=True)
    absent=absence(item)
    print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":RESOURCE,"status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"graph/cluster-absence.json"}]}),flush=True)
    return 0 if absent else 1

def mixed_load(h):
    # Ten readers plus one writer exceed the default two active + eight queued.
    # Size this no-refusal measurement for its producers, keeping pool reserves.
    replicas.restart(h,HYPERFIDE_GRAPH_MAX_ACTIVE="2",HYPERFIDE_GRAPH_MAX_QUEUED="9")
    def admission():return h.f.ok("7.2","graph.ingest.describe",{})["admission"]
    def budget():
        limits=admission()
        h.expect(limits["max_active"]==2 and limits["max_queued"]==9 and limits["primary_pool_max"]>2,
            "mixed-load admission must fit eleven producers below primary pool capacity: "+h.encoded(limits))
        h.obs({"observation":"mixed-load-admission","producers":11,"admission":limits})
    h.check("graph.query.mixed-load-admission-budget",budget)
    replicas.mixed_load(h)
    def drained():
        limits=admission()
        h.expect(limits["active"]==limits["queued"]==limits["refused"]==0,
            "mixed-load admission refused work or leaked permits: "+h.encoded(limits))
        h.obs({"observation":"mixed-load-admission-drained","admission":limits})
    h.check("graph.query.mixed-load-admission-drained",drained)

def main():
    cluster=None;fixture=None;item=None
    try:
        cluster=physical.PostgresCluster()
        item={"resource_id":RESOURCE,"root":str(cluster.root),"sockets":[str(cluster.socket/(".s.PGSQL."+str(cluster.port))),str(cluster.replica_socket/(".s.PGSQL."+str(cluster.port)))]}
        module.artifact_root().mkdir(parents=True,exist_ok=True);ledger().write_text(module.encoded(item)+"\n")
        cluster.replicate()
        # The whole run, including the shared domain07 psql helper, targets the owned primary.
        os.environ.update(DATABASE_URL=cluster.url(),PGHOST=str(cluster.socket),PGPORT=str(cluster.port),PGUSER="hf_operator")
        with tempfile.TemporaryDirectory(prefix="hf-graph-7.4-") as directory:
            fixture=module.Fixture(Path(directory))
            h=Harness(fixture,cluster);replicas.attach(h)
            module.querying(fixture)
            for phase in (contracts.run,projection.run,contracts.corpus,contracts.migration,replicas.run,mixed_load):phase(h)
            module.artifact_root().mkdir(parents=True,exist_ok=True)
            (module.artifact_root()/"task-7.4-observations.json").write_text(module.encoded({"scope":"task-component","task":"7.4","source":fixture.manifest,
                "observations":module.OBS,"assertion_count":len(module.IDS),"failures":module.FAILED,"full_campaigns":"NOT_CLAIMED",
                "postgresql":cluster.sql("SELECT version()"),"replica":"owned PG18 physical streaming standby"})+"\n")
            return 1 if module.FAILED else 0
    finally:
        try:
            if fixture:fixture.native.close()
        finally:
            if cluster:
                closed=cluster.close()
                (module.artifact_root()/"cluster-commands.json").write_text(module.encoded(cluster.logs)+"\n")
                if not closed:print(json.dumps({"type":"diagnostic","message":"owned cluster close incomplete"}),flush=True)

if __name__=="__main__":
    sys.exit(cleanup() if "--cleanup" in sys.argv else main())
