#!/usr/bin/env python3
"""Task4.1 component gates: real PostgreSQL constraints and control-service boundary.

This receipt qualifies relational foundations only. Claim transactions, network
authentication and complete V-002/V-015 campaigns belong to later task owners.
"""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[4]
DATABASE = "hf_task_4_1_qualification"
RESOURCE = "hf-task-4.1-database"
SCOPE = {"organisation_id":"10000000-0000-0000-0000-000000000001",
         "run_id":"20000000-0000-0000-0000-000000000001"}
def uid(n): return f"30000000-0000-0000-0000-{n:012d}"
DIGEST = "sha256:" + "a"*64
OID = "a"*40
FAILED = []
IDS = []
OBSERVATIONS = []
SQL_DIAGNOSTICS = []
ACTIONS = ["authority.schema.describe","authority.schema.bootstrap","authority.database.inspect",
           "authority.record.validate","authority.record.create"]
POLICY = {"schema_version":1,"programme_id":"task-4.1-relational-fixture",
          "repository":"fixture/repository","spec_revision":"task-4.1-reviewed-spec",
          "policy_revision":1,"status":"ACTIVE",
          "approval":{"decision":"APPROVED","record_id":"programme-owner-authorized-implementation",
                      "spec_revision":"task-4.1-reviewed-spec","policy_revision":1},
          "allowed_roles":["control"],"allowed_actions":["programme.activate"]+ACTIONS}

def expect(value, message):
    if not value: raise AssertionError(message)

def check(identity, callback):
    IDS.append(identity)
    try:
        callback()
        actual = "observed"
    except Exception as error:
        actual = f"{type(error).__name__}: {error}"
        FAILED.append(identity)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)

def database_env(database=DATABASE):
    env = os.environ.copy()
    env["PGDATABASE"] = database
    parsed = urlsplit(env["DATABASE_URL"])
    # Keep the actual pg-supported socket URI form, including its empty host.
    env["DATABASE_URL"] = urlunsplit((parsed.scheme,parsed.netloc,"/"+database,parsed.query,parsed.fragment))
    return env

def sql(text, *, database=DATABASE, allow_error=False):
    result = subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1",
                             "-v","VERBOSITY=verbose","-d",database],
                            input=text,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                            cwd=ROOT,env=database_env(database),timeout=30)
    if result.returncode:
        # Keep only server diagnostics from this synthetic fixture; never record
        # connection configuration or environment values.
        diagnostic=[line for line in result.stderr.splitlines() if line.startswith(("ERROR:","DETAIL:","CONTEXT:"))]
        SQL_DIAGNOSTICS.append({"returncode":result.returncode,"diagnostic":diagnostic[:8]})
        if not allow_error:
            expect(False,"PostgreSQL fixture failed: "+" | ".join(diagnostic[:3]))
    return result

def observation_dir():
    root = Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/task-4.1-standalone"))
    target=root/"storage";target.mkdir(parents=True,exist_ok=True)
    return target

def install_schema():
    # Task 4.4 owns production migration orchestration; this gate installs only the task 4.1 schema.
    source=(ROOT/"services/hyperfide/migrations/0001-authority.sql").read_bytes()
    checksum="sha256:"+hashlib.sha256(source).hexdigest()
    sql("BEGIN;\n"+source.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) "
        "VALUES(1,'0001-authority','"+checksum+"');\nCOMMIT;")

def cleanup():
    try:
        sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+DATABASE+"' AND pid<>pg_backend_pid();",
            database="postgres")
        sql('DROP DATABASE IF EXISTS "'+DATABASE+'";',database="postgres")
        rows=sql("SELECT datname FROM pg_database WHERE datname='"+DATABASE+"';",database="postgres").stdout.strip()
        absent=rows==""
        record={"resource":RESOURCE,"database":DATABASE,"observed_absent":absent,
                "observer":"PostgreSQL pg_database query after DROP DATABASE"}
        (observation_dir()/"database-absence.json").write_text(json.dumps(record,sort_keys=True)+"\n")
        print(json.dumps({"type":"cleanup","complete":absent,"resources":[
            {"id":RESOURCE,"status":"deleted" if absent else "unknown","observed_absent":absent,
             "evidence_artifact":"storage/database-absence.json"}]}),flush=True)
        return 0 if absent else 1
    except Exception:
        print(json.dumps({"type":"cleanup","complete":False,"resources":[{"id":RESOURCE,"status":"unknown"}]}),flush=True)
        return 1

class Service:
    def __init__(self, base):
        self.base=base
        self.policy=base/"policy.json"
        self.policy.write_text(json.dumps(POLICY))
        self.components=base/"components";self.components.mkdir()
        for name in ["1.4.json","4.1.json"]:
            source=ROOT/"services/hyperfide/components"/name
            if source.exists(): (self.components/name).write_bytes(source.read_bytes())
    def request(self, action, value=None, *, policy=None, env=None):
        if policy is not None: self.policy.write_text(json.dumps(policy))
        else: self.policy.write_text(json.dumps(POLICY))
        request={"id":"task-4.1-probe","component":"4.1","action":action,"input":{} if value is None else value}
        process=subprocess.run(["node",str(ROOT/"services/hyperfide/dist/control.js"),
            "--policy",str(self.policy),"--spec-revision",POLICY["spec_revision"],
            "--components",str(self.components),"--module-root",str(ROOT/"services/hyperfide/dist")],
            cwd=ROOT,input=json.dumps(request)+"\n",text=True,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env or database_env(),timeout=30)
        lines=[line for line in process.stdout.splitlines() if line.strip()]
        expect(len(lines)==1,"service did not emit exactly one JSONL response")
        response=json.loads(lines[0])
        expect(response.get("id")==request["id"],"service response lost correlation identity")
        OBSERVATIONS.append({"action":action,"ok":response.get("ok"),
                             "error_code":response.get("error",{}).get("code")})
        return process,response
    def ok(self,action,value=None):
        process,response=self.request(action,value)
        expect(process.returncode==0 and response.get("ok") is True,
               "service refused positive operation: "+str(response.get("error",{}).get("code")))
        return response["result"]
    def reject(self,action,value,code):
        process,response=self.request(action,value)
        expect(process.returncode!=0 and response.get("ok") is False and
               response.get("error",{}).get("code")==code,
               "service rejection differs: "+str(response.get("error",{}).get("code")))
    def create(self,kind,record):
        return self.ok("authority.record.create",{"kind":kind,"record":record})
    def reject_create(self,kind,record,code):
        self.reject("authority.record.create",{"kind":kind,"record":record},code)
        tables={"source_object":"source_objects","attempt":"attempts","compute_lease":"compute_leases",
                "submission_custody":"submission_custodies","evidence":"evidence",
                "evidence_artifact":"evidence_artifacts","qualification_job":"qualification_jobs",
                "publication_operation":"publication_operations"}
        if "id" in record and kind in tables:
            count=sql("SELECT count(*) FROM hyperfide."+tables[kind]+" WHERE id='"+record["id"]+"';").stdout.strip()
            expect(count=="0","rejected service creation persisted a row")

def validators(service):
    records={
      "scope":dict(SCOPE),
      "source":dict(SCOPE,repository_id=uid(2),source_object_id=OID),
      "artifact":dict(SCOPE,id=uid(3),digest=DIGEST,size_bytes="0",storage_key="fixture/object",
                      status="COMPLETE",storage_backend="fixture",retention_class="RUN"),
      "compute_token":dict(SCOPE,task_id=uid(4),attempt_id=uid(5),attempt_generation="1",
                           authority_epoch=uid(6),sandbox_id=uid(7),sandbox_boot_generation="1"),
      "custody_token":dict(SCOPE,task_id=uid(4),submission_id=uid(8),custody_generation="1",authority_epoch=uid(6))
    }
    for kind,record in records.items():
        def valid(k=kind,r=record):
            actual=service.ok("authority.record.validate",{"kind":k,"record":r})
            expect(actual=={"valid":True,"kind":k,"record":r},"validated record was not preserved exactly")
        check("storage.wire.valid-"+kind,valid)
    cases=[
      ("unknown-kind","scope",dict(SCOPE),lambda v:v.update(kind="unsupported")),
      ("unknown-input","scope",dict(SCOPE),lambda v:v.update(sql="DROP SCHEMA hyperfide CASCADE")),
      ("unknown-record","scope",dict(SCOPE),lambda v:v["record"].update(secret="fixture-canary")),
      ("missing-scope","scope",dict(SCOPE),lambda v:v["record"].pop("run_id")),
      ("bad-uuid","scope",dict(SCOPE),lambda v:v["record"].update(run_id="not-a-uuid")),
      ("uppercase-uuid","scope",dict(SCOPE),lambda v:v["record"].update(run_id="AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")),
      ("array-record","scope",dict(SCOPE),lambda v:v.update(record=[])),
      ("numeric-generation","compute_token",records["compute_token"],lambda v:v["record"].update(attempt_generation=1)),
      ("zero-generation","compute_token",records["compute_token"],lambda v:v["record"].update(attempt_generation="0")),
      ("leading-zero-generation","compute_token",records["compute_token"],lambda v:v["record"].update(attempt_generation="01")),
      ("overflow-generation","compute_token",records["compute_token"],lambda v:v["record"].update(attempt_generation="9223372036854775808")),
      ("numeric-bytes","artifact",records["artifact"],lambda v:v["record"].update(size_bytes=0)),
      ("negative-bytes","artifact",records["artifact"],lambda v:v["record"].update(size_bytes="-1")),
      ("overflow-bytes","artifact",records["artifact"],lambda v:v["record"].update(size_bytes="9223372036854775808")),
      ("digest-prefix","artifact",records["artifact"],lambda v:v["record"].update(digest="a"*64)),
      ("digest-uppercase","artifact",records["artifact"],lambda v:v["record"].update(digest="sha256:"+"A"*64)),
      ("artifact-state","artifact",records["artifact"],lambda v:v["record"].update(status="AVAILABLE")),
      ("missing-storage-backend","artifact",records["artifact"],lambda v:v["record"].pop("storage_backend")),
      ("retention-class","artifact",records["artifact"],lambda v:v["record"].update(retention_class="unspecified")),
      ("control-storage-key","artifact",records["artifact"],lambda v:v["record"].update(storage_key="bad\nkey")),
      ("bad-git-object","source",records["source"],lambda v:v["record"].update(source_object_id="floating-main")),
      ("extra-token-authority","custody_token",records["custody_token"],lambda v:v["record"].update(compute_lease_id=uid(9)))
    ]
    for name,kind,record,mutation in cases:
        value={"kind":kind,"record":copy.deepcopy(record)};mutation(value)
        check("storage.wire.reject-"+name,lambda v=value: service.reject("authority.record.validate",v,"INVALID_RECORD"))


    lease=dict(SCOPE,id=uid(20),attempt_id=uid(21),attempt_generation="1",authority_epoch=uid(22),
               sandbox_boot_generation="1",expires_at="2024-02-29T12:30:40Z")
    for name,stamp in [("nonleap-day","2025-02-29T12:30:40Z"),("invalid-month-day","2026-04-31T12:30:40Z"),
                       ("year-zero","0000-01-01T00:00:00Z")]:
        value=dict(lease,expires_at=stamp)
        check("storage.wire.reject-"+name,lambda v=value:service.reject_create("compute_lease",v,"INVALID_RECORD"))

def schema_checks(service):
    tables=set("""organisations projects repositories source_objects spec_revisions runs run_spec_revisions
run_repositories feature_packages tasks task_dependencies environment_profiles provider_pools capacity_accounts
reservations sandboxes sandbox_boots worker_slots attempts compute_leases slot_allocations agent_sessions preparation_references
workspaces branch_observations branch_authorities artifacts artifact_dependencies checkpoints evidence evidence_artifacts submission_custodies
submission_evidence qualification_jobs requalification_operations integration_candidates candidate_custodies candidate_evidence
publication_intents publication_operations contracts findings finding_observations review_coverage review_coverage_inputs
graph_builds graph_manifests graph_channels parse_blobs graph_files graph_symbols graph_references graph_edges
command_inbox event_consumers outbox_events event_deliveries""".split())
    checksum="sha256:"+hashlib.sha256((ROOT/"services/hyperfide/migrations/0001-authority.sql").read_bytes()).hexdigest()
    def describe():
        result=service.ok("authority.schema.describe")
        expect(result["schema"]=="hyperfide" and result["schema_version"]==1,"schema identity/version differs")
        expect(set(result["tables"])==tables and len(result["tables"])==len(tables),"declared schema inventory differs")
        expect(result["payload_authorities"]=={"source":"git","artifact":"object-storage","metadata":"postgresql"},
               "payload authorities were conflated")
        expect(set(result["creation_kinds"])=={"source_object","attempt","compute_lease","submission_custody",
               "evidence","evidence_artifact","qualification_job","publication_operation"},"creation catalogue is not finite")
    check("storage.service.describe",describe)
    def migration_required():
        service.reject("authority.schema.bootstrap",{},"MIGRATION_JOB_REQUIRED")
        expect(sql("SELECT to_regnamespace('hyperfide') IS NULL;").stdout.strip()=="t",
               "runtime bootstrap created schema before the migration operator")
    check("storage.migration.operator-required",migration_required)
    def bootstrap():
        install_schema()
        result=service.ok("authority.schema.bootstrap")
        expect(result["applied"] is False and result["schema_version"]==1 and result["checksum"]==checksum,
               "runtime did not verify the explicitly applied exact source bytes")
    check("storage.migration.bootstrap",bootstrap)
    def replay():
        result=service.ok("authority.schema.bootstrap")
        expect(result["applied"] is False and result["checksum"]==checksum,"migration replay changed applied outcome")
        expect(sql("SELECT count(*) FROM hyperfide.schema_migrations;").stdout.strip()=="1","migration replay duplicated ledger")
    check("storage.migration.replay",replay)
    def inspect():
        result=service.ok("authority.database.inspect")
        observed=set(sql("SELECT table_name FROM information_schema.tables WHERE table_schema='hyperfide' AND table_type='BASE TABLE';").stdout.split())
        expect(observed==tables|{"schema_migrations"},"database does not contain the declared entity inventory")
        foreign_keys=int(sql("SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='hyperfide' AND c.contype='f';").stdout.strip())
        indexes=int(sql("SELECT count(*) FROM pg_indexes WHERE schemaname='hyperfide';").stdout.strip())
        expect(set(result["tables"])==tables and result["checksum"]==checksum and result["schema_version"]==1,
               "inspection does not describe the exact applied schema")
        expect(result["foreign_key_count"]==foreign_keys and foreign_keys>30 and result["index_count"]==indexes and indexes>30,
               "inspection constraint/index counts differ from PostgreSQL catalogue")
        expect(result["in_recovery"] is False,"test fixture is not an observed primary")
    check("storage.service.inspect",inspect)
    for action in ["authority.schema.describe","authority.schema.bootstrap","authority.database.inspect"]:
        check("storage.api.empty-input-"+action.split(".")[-1],
              lambda a=action: service.reject(a,{"sql":"SELECT 1"},"INVALID_RECORD"))
    def config_missing():
        env=database_env();env.pop("DATABASE_URL",None)
        process,response=service.request("authority.database.inspect",env=env)
        expect(process.returncode!=0 and response.get("error",{}).get("code")=="DATABASE_CONFIG_INVALID",
               "missing trusted database endpoint was accepted")
    check("storage.api.trusted-database-required",config_missing)
    def config_bounded():
        env=database_env();env["HYPERFIDE_PG_POOL_MAX"]="1000"
        process,response=service.request("authority.database.inspect",env=env)
        expect(process.returncode!=0 and response.get("error",{}).get("code")=="DATABASE_CONFIG_INVALID",
               "unbounded trusted pool capacity was accepted")
    check("storage.api.pool-bound",config_bounded)
    def url_override():
        env=database_env();env["DATABASE_URL"]+=("&" if "?" in env["DATABASE_URL"] else "?")+"statement_timeout=0&lock_timeout=0"
        process,response=service.request("authority.database.inspect",env=env)
        expect(process.returncode!=0 and response.get("error",{}).get("code")=="DATABASE_CONFIG_INVALID",
               "connection URL overrode trusted bounded timeout policy")
        expect(env["DATABASE_URL"] not in json.dumps(response),"service error exposed connection configuration")
    check("storage.api.url-timeout-override",url_override)

    check("storage.api.creation-kind-bound",lambda:service.reject_create("arbitrary_table",dict(SCOPE),"INVALID_RECORD"))

def final_schema_negatives(service):
    original=sql("SELECT checksum FROM hyperfide.schema_migrations WHERE version=1;").stdout.strip()
    def checksum_conflict():
        try:
            sql("UPDATE hyperfide.schema_migrations SET checksum='sha256:"+"f"*64+"' WHERE version=1;")
            service.reject("authority.schema.bootstrap",{},"SCHEMA_CONFLICT")
            expect(sql("SELECT count(*) FROM hyperfide.schema_migrations;").stdout.strip()=="1","conflict changed migration ledger")
        finally:
            sql("UPDATE hyperfide.schema_migrations SET checksum='"+original+"' WHERE version=1;")
    check("storage.migration.checksum-conflict",checksum_conflict)
    def namespace_conflict():
        sql("DROP SCHEMA hyperfide CASCADE; CREATE SCHEMA hyperfide;")
        service.reject("authority.schema.bootstrap",{},"MIGRATION_JOB_REQUIRED")
        expect(sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='hyperfide';").stdout.strip()=="0",
               "refused bootstrap wrote a partial schema")
        sql("DROP SCHEMA hyperfide;")
        install_schema()
        result=service.ok("authority.schema.bootstrap")
        expect(result["applied"] is False and result["checksum"]==original and result["schema_version"]==1,
               "refused runtime bootstrap poisoned subsequent explicitly migrated schema")
    check("storage.migration.unidentified-namespace",namespace_conflict)

SEED = "-- Task 4.1 disposable fixture, never production authority.\nINSERT INTO hyperfide.organisations(id,name) VALUES('00000000-0000-4000-8000-000000000001','fixture');\nINSERT INTO hyperfide.projects(organisation_id,id,name) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','fixture');\nINSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','fixture','https://example.invalid/repo.git');\nINSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003',repeat('a',40)),('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003',repeat('b',40));\nINSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','sha256:'||encode(sha256(convert_to('fixture','UTF8')),'hex'),'fixture','{}',1);\nINSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','sha256:'||repeat('c',64),'00000000-0000-4000-8000-000000000099'),('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','sha256:'||repeat('c',64),'00000000-0000-4000-8000-000000000099');\nINSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000003',repeat('a',40),'refs/heads/main'),('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000003',repeat('a',40),'refs/heads/main');\nINSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','fixture',1),('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000016','fixture',1);\nINSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000007','1.1','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000004','sha256:'||repeat('c',64),'{}',1),('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000017','1.1','00000000-0000-4000-8000-000000000016','00000000-0000-4000-8000-000000000004','sha256:'||repeat('c',64),'{}',1);\nINSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000008','railway','fixture-account','fixture-env','fixture-region');\nINSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,boot_generation,desired_state,observed_state) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000008',1,'RUNNING','RUNNING');\nINSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000000a','00000000-0000-4000-8000-000000000009','agent-0',1,'AGENT','READY');\nINSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,retention_class) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-00000000000b','sha256:'||repeat('d',64),1,'fixture','complete','COMPLETE','RUN'),('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-00000000000c','sha256:'||repeat('e',64),1,'fixture','pending','PENDING','RUN');\n"

def relational(service):
    sql(SEED)
    def xid(n): return f"00000000-0000-4000-8000-{n:012x}"
    scope={"organisation_id":xid(1),"run_id":xid(5)}
    epoch=xid(0x99)
    criteria="sha256:"+"c"*64
    source={"organisation_id":xid(1),"repository_id":xid(3),"object_id":"c"*40,"object_type":"commit"}
    def source_create():
        result=service.create("source_object",source)
        expect(result["created"] is True and result["record"]["object_id"]=="c"*40,"source registration result differs")
        expect(sql("SELECT count(*) FROM hyperfide.source_objects WHERE object_id=repeat('c',40);").stdout.strip()=="1","source registration not stored")
    check("storage.source.create",source_create)
    check("storage.source.tree-metadata",lambda:service.create("source_object",dict(source,object_id="d"*40,object_type="tree")))
    check("storage.source.duplicate",lambda:service.reject_create("source_object",source,"AUTHORITY_CONFLICT"))
    check("storage.source.cross-organisation",lambda:service.reject_create("source_object",dict(source,organisation_id=xid(200)),"AUTHORITY_REFERENCE_INVALID"))
    current=dict(scope,id=xid(30),task_id=xid(7),generation="1",authority_epoch=epoch,input_packet_digest=DIGEST,compute_authority="CURRENT",execution_state="RUNNING",sandbox_id=xid(9),slot_id=xid(10),sandbox_boot_generation="1",lease_expires_at="2099-01-01T00:00:00Z")
    def attempt_create():
        result=service.create("attempt",current)
        expect(result["created"] is True and result["record"]["generation"]=="1","attempt generation lost wire precision")
    check("storage.attempt.create-current",attempt_create)
    check("storage.attempt.duplicate-current",lambda:service.reject_create("attempt",dict(current,id=xid(31),generation="2"),"AUTHORITY_CONFLICT"))
    check("storage.attempt.duplicate-generation",lambda:service.reject_create("attempt",dict(current,id=xid(32),compute_authority="RELEASED"),"AUTHORITY_CONFLICT"))
    check("storage.attempt.cross-run",lambda:service.reject_create("attempt",dict(current,id=xid(33),run_id=xid(0x15),compute_authority="RELEASED"),"AUTHORITY_REFERENCE_INVALID"))
    check("storage.attempt.cross-organisation",lambda:service.reject_create("attempt",dict(current,id=xid(34),organisation_id=xid(200),compute_authority="RELEASED"),"AUTHORITY_REFERENCE_INVALID"))
    check("storage.attempt.wrong-boot",lambda:service.reject_create("attempt",dict(current,id=xid(35),generation="2",sandbox_boot_generation="2",compute_authority="RELEASED"),"AUTHORITY_REFERENCE_INVALID"))
    lease=dict(scope,id=xid(40),attempt_id=xid(30),attempt_generation="1",authority_epoch=epoch,sandbox_boot_generation="1",expires_at="2099-01-01T00:00:00Z")
    check("storage.lease.create",lambda:service.create("compute_lease",lease))
    check("storage.lease.generation-binding",lambda:service.reject_create("compute_lease",dict(lease,id=xid(41),attempt_generation="2",state="EXPIRED"),"AUTHORITY_REFERENCE_INVALID"))
    check("storage.lease.valid-leap-day",lambda:service.reject_create("compute_lease",dict(lease,id=xid(42),attempt_id=xid(404),expires_at="2024-02-29T12:30:40Z"),"AUTHORITY_REFERENCE_INVALID"))
    sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,retention_class) VALUES('"+xid(1)+"','"+xid(0x15)+"','"+xid(13)+"','sha256:"+("f"*64)+"',1,'fixture','other-run','COMPLETE','RUN');")
    evidence=dict(scope,id=xid(50),attempt_id=xid(30),attempt_generation="1",repository_id=xid(3),source_object_id="a"*40,criteria_digest=criteria,manifest_digest=DIGEST,artifact_id=xid(11),admission_state="ADMITTED")
    def admitted():
        result=service.create("evidence",evidence)
        expect(result["record"]["admission_state"]=="ADMITTED","complete artifact evidence not admitted")
    check("storage.evidence.complete-artifact",admitted)
    check("storage.evidence.incomplete-artifact",lambda:service.reject_create("evidence",dict(evidence,id=xid(51),artifact_id=xid(12)),"AUTHORITY_CONSTRAINT_INVALID"))
    check("storage.evidence.absent-artifact",lambda:service.reject_create("evidence",dict(evidence,id=xid(52),artifact_id=xid(405)),"AUTHORITY_CONSTRAINT_INVALID"))
    check("storage.evidence.absent-source",lambda:service.reject_create("evidence",dict(evidence,id=xid(53),source_object_id="f"*40),"AUTHORITY_REFERENCE_INVALID"))
    check("storage.evidence.cross-run",lambda:service.reject_create("evidence",dict(evidence,id=xid(54),run_id=xid(0x15),artifact_id=xid(13)),"AUTHORITY_REFERENCE_INVALID"))
    check("storage.evidence.noncommit-source",lambda:service.reject_create("evidence",dict(evidence,id=xid(55),source_object_id="d"*40),"AUTHORITY_REFERENCE_INVALID"))
    check("storage.evidence.artifact-run-binding",lambda:service.reject_create("evidence",dict(evidence,id=xid(56),artifact_id=xid(13)),"AUTHORITY_CONSTRAINT_INVALID"))

    check("storage.evidence.attachment-complete",lambda:service.create("evidence_artifact",dict(scope,evidence_id=xid(50),artifact_id=xid(11),role="primary")))
    check("storage.evidence.attachment-incomplete",lambda:service.reject_create("evidence_artifact",dict(scope,evidence_id=xid(50),artifact_id=xid(12),role="log"),"AUTHORITY_CONSTRAINT_INVALID"))
    custody=dict(scope,id=xid(60),task_id=xid(7),source_attempt_id=xid(30),source_generation="1",custody_generation="1",authority_epoch=epoch,repository_id=xid(3),source_object_id="a"*40,source_manifest_digest=DIGEST,evidence_manifest_digest=DIGEST,criteria_digest=criteria)
    check("storage.custody.compute-separation",lambda:service.reject_create("submission_custody",custody,"AUTHORITY_CONSTRAINT_INVALID"))
    sql("UPDATE hyperfide.attempts SET compute_authority='RELEASED',execution_state='SUBMITTED',state_version=state_version+1 WHERE id='"+xid(30)+"';")
    def custody_create():
        result=service.create("submission_custody",custody)
        expect(result["record"]["authority"]=="ACTIVE" and result["record"]["qualification_outcome"]=="PENDING","custody authority conflates qualification")
    check("storage.custody.create",custody_create)
    check("storage.custody.duplicate-active",lambda:service.reject_create("submission_custody",dict(custody,id=xid(61),custody_generation="2"),"AUTHORITY_CONFLICT"))
    check("storage.custody.source-generation",lambda:service.reject_create("submission_custody",dict(custody,id=xid(62),custody_generation="2",source_generation="2",authority="RELEASED"),"AUTHORITY_REFERENCE_INVALID"))
    check("storage.custody.cross-run",lambda:service.reject_create("submission_custody",dict(custody,id=xid(63),run_id=xid(0x15),authority="RELEASED"),"AUTHORITY_REFERENCE_INVALID"))
    check("storage.custody.noncommit-source",lambda:service.reject_create("submission_custody",dict(custody,id=xid(64),custody_generation="2",source_object_id="d"*40,authority="RELEASED"),"AUTHORITY_REFERENCE_INVALID"))

    def compute_expiry():
        sql("UPDATE hyperfide.compute_leases SET state='EXPIRED',expires_at='2020-01-01T00:00:00Z',state_version=state_version+1 WHERE id='"+xid(40)+"';")
        expect(sql("SELECT authority||'|'||qualification_outcome FROM hyperfide.submission_custodies WHERE id='"+xid(60)+"';").stdout.strip()=="ACTIVE|PENDING","compute expiry changed independent custody")
    check("storage.custody.survives-compute-expiry",compute_expiry)
    def immutable():
        result=sql("UPDATE hyperfide.submission_custodies SET source_manifest_digest='sha256:"+"b"*64+"',state_version=state_version+1 WHERE id='"+xid(60)+"';",allow_error=True)
        expect(result.returncode!=0 and "23514" in result.stderr,"immutable submitted input changed")
        expect(sql("SELECT source_manifest_digest FROM hyperfide.submission_custodies WHERE id='"+xid(60)+"';").stdout.strip()==DIGEST,"rejected immutable update persisted")
    check("storage.custody.immutable-inputs",immutable)
    job=dict(scope,id=xid(70),custody_id=xid(60),custody_generation="1",rubric_digest=DIGEST)
    check("storage.qualification.create",lambda:service.create("qualification_job",job))
    check("storage.qualification.generation-binding",lambda:service.reject_create("qualification_job",dict(job,id=xid(71),custody_generation="2"),"AUTHORITY_REFERENCE_INVALID"))
    relational_final(service,xid,scope,epoch,custody)

def relational_final(service,xid,scope,epoch,custody):

    def publication_seed():
        sql("INSERT INTO hyperfide.branch_authorities(organisation_id,run_id,id,repository_id,branch_ref,branch_generation,authority_epoch,expected_old_head) VALUES('"+xid(1)+"','"+xid(5)+"','"+xid(80)+"','"+xid(3)+"','refs/heads/fixture',1,'"+epoch+"',repeat('a',40));"
            "INSERT INTO hyperfide.integration_candidates(organisation_id,run_id,id,task_id,custody_id,custody_generation,repository_id,branch_authority_id,branch_generation,expected_old_head,candidate_head,input_manifest_digest,request_id) VALUES('"+xid(1)+"','"+xid(5)+"','"+xid(81)+"','"+xid(7)+"','"+xid(60)+"',1,'"+xid(3)+"','"+xid(80)+"',1,repeat('a',40),repeat('b',40),'"+DIGEST+"','"+xid(85)+"');"
            "INSERT INTO hyperfide.publication_intents(organisation_id,run_id,id,candidate_id,intent_digest) VALUES('"+xid(1)+"','"+xid(5)+"','"+xid(82)+"','"+xid(81)+"','"+DIGEST+"');")
    check("storage.publication.seed-relations",publication_seed)
    operation=dict(scope,id=xid(83),publication_intent_id=xid(82),candidate_id=xid(81),
                   branch_authority_id=xid(80),branch_generation="1",authority_epoch=epoch,
                   repository_id=xid(3),expected_old_head="a"*40,candidate_head="b"*40,request_id=xid(84))
    def publication():
        result=service.create("publication_operation",operation)
        expect(result["record"]["state"]=="PENDING" and result["record"]["branch_generation"]=="1",
               "publication record fabricated completion or lost generation")
    check("storage.publication.create",publication)
    check("storage.publication.branch-generation",lambda:service.reject_create("publication_operation",
          dict(operation,id=xid(86),request_id=xid(87),branch_generation="2"),"AUTHORITY_REFERENCE_INVALID"))
    check("storage.publication.cross-run",lambda:service.reject_create("publication_operation",
          dict(operation,id=xid(88),request_id=xid(89),run_id=xid(0x15)),"AUTHORITY_REFERENCE_INVALID"))
    def rollback():
        rolled=xid(90)
        result=sql("BEGIN; INSERT INTO hyperfide.organisations(id,name) VALUES('"+rolled+"','rolled-back');"
                   "INSERT INTO hyperfide.projects(organisation_id,id,name) VALUES('"+xid(999)+"','"+xid(91)+"','invalid'); COMMIT;",allow_error=True)
        expect(result.returncode!=0 and "23503" in result.stderr,"invalid relationship did not abort transaction")
        expect(sql("SELECT count(*) FROM hyperfide.organisations WHERE id='"+rolled+"';").stdout.strip()=="0",
               "failed transaction left a partial accepted row")
    check("storage.transaction.rollback",rollback)
    def repeatable_write():
        result=sql("BEGIN ISOLATION LEVEL REPEATABLE READ; INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest) VALUES('"+xid(1)+"','"+xid(5)+"','"+xid(98)+"','"+xid(7)+"',2,'"+epoch+"','"+DIGEST+"'); COMMIT;",allow_error=True)
        expect(result.returncode!=0 and "25001" in result.stderr,"unsupported repeatable-read authority write was accepted")
        expect(sql("SELECT count(*) FROM hyperfide.attempts WHERE id='"+xid(98)+"';").stdout.strip()=="0",
               "rejected repeatable-read write persisted")
    check("storage.transaction.reject-repeatable-write",repeatable_write)

    def immutable_spec():
        result=sql("UPDATE hyperfide.spec_revisions SET document=jsonb_build_object('changed',true) WHERE id='"+xid(4)+"';",allow_error=True)
        expect(result.returncode!=0 and "23514" in result.stderr,"accepted spec revision was mutable")
    check("storage.spec.immutable-revision",immutable_spec)
    def history():
        sql("UPDATE hyperfide.runs SET authority_epoch='"+xid(0x100)+"',state_version=state_version+1 WHERE id='"+xid(5)+"';")
        sql("UPDATE hyperfide.sandboxes SET boot_generation=2,state_version=state_version+1 WHERE id='"+xid(9)+"';")
        row=sql("SELECT authority_epoch::text||'|'||sandbox_boot_generation::text FROM hyperfide.attempts WHERE id='"+xid(30)+"';").stdout.strip()
        expect(row==epoch+"|1","epoch or boot transition rewrote attempt history")
        expect(sql("SELECT count(*) FROM hyperfide.sandbox_boots WHERE sandbox_id='"+xid(9)+"';").stdout.strip()=="2",
               "reboot did not retain immutable boot identities")
        expect(sql("SELECT authority_epoch::text FROM hyperfide.submission_custodies WHERE id='"+xid(60)+"';").stdout.strip()==epoch,
               "epoch transition rewrote submission provenance")
    check("storage.history.epoch-boot-preserved",history)



def main():
    sql('CREATE DATABASE "'+DATABASE+'";',database="postgres")
    with tempfile.TemporaryDirectory(prefix="hyperfide-4-1-") as temporary:
        service=Service(Path(temporary))
        schema_checks(service)
        validators(service)
        relational(service)
        final_schema_negatives(service)
    (observation_dir()/"observations.json").write_text(json.dumps({"scope":"task-component","assertion_ids":IDS,
        "failed_ids":FAILED,"service_operations":OBSERVATIONS,"sql_diagnostics":SQL_DIAGNOSTICS,
        "runtime":{"node_version":subprocess.run(["node","--version"],capture_output=True,text=True,timeout=5).stdout.strip(),
                   "postgresql_version":sql("SHOW server_version;").stdout.strip(),
                   "package_lock_sha256":hashlib.sha256((ROOT/"services/hyperfide/package-lock.json").read_bytes()).hexdigest()}},sort_keys=True)+"\n")
    return 1 if FAILED else 0

if __name__=="__main__":
    sys.exit(cleanup() if "--cleanup" in sys.argv else main())
