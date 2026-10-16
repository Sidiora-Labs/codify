#!/usr/bin/env python3
"""Actual HTTPS/PostgreSQL docs authority probes; component fixtures are not release evidence."""
import copy,hashlib,importlib.util,json,os,subprocess,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location("hyperfide_identity_fixture",ROOT/"tests/hyperfide/support/identity_fixture.py")
identity=importlib.util.module_from_spec(spec);spec.loader.exec_module(identity)
IdentityFixture=identity.IdentityFixture
FAILED=[]

ACTIVE_TASK="28.2"
def configure_task(task):
    global ACTIVE_TASK
    ACTIVE_TASK=task
def fixture_artifact(name):
    base=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain28-standalone"))
    target=base/"docs"/name;target.parent.mkdir(parents=True,exist_ok=True);return target
def fixture_ledger():
    target=fixture_artifact("task-"+ACTIVE_TASK+"-databases.json")
    return target,json.loads(target.read_text())if target.exists()else[]
def ledger_record(name,**updates):
    target,entries=fixture_ledger()
    row=next((r for r in entries if r["database"]==name),None)
    if row is None:row={"database":name,"owner":"task:"+ACTIVE_TASK};entries.append(row)
    row.update(updates);target.write_text(json.dumps(entries,sort_keys=True)+"\n")
class TrackedIdentityFixture(IdentityFixture):
    def sql(self,sql,values=None,admin=False):
        if admin and sql.startswith('CREATE DATABASE "')and getattr(self,"database",None):
            ledger_record(self.database,creation_intent_recorded=True,observed_absent=False,service_started=False)
        return super().sql(sql,values,admin)
    def start(self):
        ledger_record(self.database,service_port=self.port,listener_absent=False,service_started=True)
        return super().start()
    def close(self):
        super().close()
        if getattr(self,"base_url",None)and getattr(self,"database",None):
            absent=super().sql("SELECT datname FROM pg_database WHERE datname=$1",[self.database],admin=True)==[]
            port=getattr(self,"port",None)
            listener_absent=True
            if port:
                import socket
                with socket.socket()as probe:listener_absent=probe.connect_ex(("127.0.0.1",port))!=0
            ledger_record(self.database,observed_absent=absent,service_port=port,listener_absent=listener_absent)
            require(absent and listener_absent,"owned database or HTTPS listener remains after cleanup")
IdentityFixture=TrackedIdentityFixture
def cleanup_event(task,extra_resources=None):
    configure_task(task)
    _,entries=fixture_ledger()
    complete=bool(entries)and all(r.get("observed_absent")is True and r.get("listener_absent",True)is True for r in entries)
    relative="docs/task-"+task+"-cleanup.json"
    fixture_artifact("task-"+task+"-cleanup.json").write_text(json.dumps({"complete":complete,"observations":entries,"extra_resources":extra_resources or[]},sort_keys=True)+"\n")
    resources=[{"id":"task"+task+"-fixture-resources","status":"deleted"if complete else"unknown","observed_absent":complete,"evidence_artifact":relative}]+(extra_resources or[])
    complete=complete and all(r.get("observed_absent")is True for r in resources)
    print(json.dumps({"type":"cleanup","resources":resources,"complete":complete}),flush=True)
    return complete
def cleanup_only(task):
    configure_task(task)
    _,entries=fixture_ledger()
    for record in entries:
        name=record["database"]
        import re
        require(re.fullmatch(r"hf_identity_[a-f0-9]{32}",name)is not None,"unsafe fixture database in cleanup intent")
        for statement in ['DROP DATABASE IF EXISTS "'+name+'" WITH(FORCE)',"SELECT datname FROM pg_database WHERE datname='"+name+"'"]:
            result=subprocess.run(["node","--input-type=commonjs","-e",identity.SQL_JS],input=json.dumps({"sql":statement,"values":[]}),text=True,capture_output=True,cwd=ROOT,env=os.environ.copy(),timeout=20)
            require(result.returncode==0,"owned fixture cleanup query failed")
        require(json.loads(result.stdout)==[],"owned fixture database remains")
        listener_absent=not record.get("service_started",False)
        if record.get("service_port"):
            import socket
            with socket.socket()as probe:listener_absent=probe.connect_ex(("127.0.0.1",record["service_port"]))!=0
        ledger_record(name,observed_absent=True,listener_absent=listener_absent)
    extras=[]
    if task=="28.4":
        intent=fixture_artifact("task-28.4-object-store.json")
        require(intent.exists(),"object-store fixture creation intent is absent")
        info=json.loads(intent.read_text());absent=True
        import socket
        for port in info["ports"]:
            with socket.socket()as probe:absent=absent and probe.connect_ex(("127.0.0.1",port))!=0
        extras=[{"id":"task28.4-fixture-object-store","status":"deleted"if absent else"unknown","observed_absent":absent,"evidence_artifact":"docs/task-28.4-object-store.json"}]
        info["observed_absent"]=absent;intent.write_text(json.dumps(info,sort_keys=True)+"\n")
    return 0 if cleanup_event(task,extras)else 1

def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()
def digest(value):return"sha256:"+hashlib.sha256(canonical(value)).hexdigest()
def require(value,message):
    if not value:raise AssertionError(message)
def check(name,callback):
    try:callback();actual="observed"
    except Exception as error:FAILED.append(name);actual=type(error).__name__+": "+str(error)
    print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def closure_factory(f):
    # This component variant tests the real closure-persistence factory only.
    # Production createComponent additionally requires actual5/12 remote execution.
    fragment=f.components/"28.2.json"
    if fragment.exists():
        declaration=json.loads(fragment.read_text())
        declaration["entry"]="createClosureComponent"
        declaration["actions"]=[a for a in declaration["actions"]if a!="docs.check"]
        declaration["requires"]=["4.2","14.1"]
        fragment.write_text(json.dumps(declaration))
def setup(f):
    closure_factory(f)
    sql=(ROOT/"services/hyperfide/migrations/0028-documentation.sql").read_text()
    f.sql("BEGIN;\n"+sql+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum)VALUES(28,\'0028-documentation\',\'sha256:"+hashlib.sha256(sql.encode()).hexdigest()+"\');\nCOMMIT;")
def fixture(extra=("28.2",),migrate=True):return IdentityFixture(extra_components=extra,extra_setup=setup if migrate else closure_factory)
def call(f,action,payload,component="28.2",ok=True,**kwargs):
    status,value=f.invoke(action,payload,component=component,**kwargs)
    if ok:require(status==200 and value.get("ok")is True,"unexpected actual service response: "+str((status,value)));return value["result"]
    require(value.get("ok")is False,"untrusted operation unexpectedly succeeded");return value.get("error",{})
def pins(f):return{"spec_revision_id":f.ids["spec"],"spec_generation":"1","programme_manifest_digest":digest("fixture-programme"),"source_manifest_digest":digest([])}
def node(script,value=None,env=None):
    return subprocess.run(["node","--input-type=module","-e",script],input=json.dumps(value)if value is not None else"",capture_output=True,text=True,cwd=ROOT,timeout=30,env=env)

def positive_fixture_setup(f):
    """Seed real relational custody/publication inputs; no programme gate is seeded."""
    setup(f)
    repo=f.path/"repository";repo.mkdir()
    def git(*args):
        return subprocess.check_output(["git","-C",str(repo),*args],env=f.env,stderr=subprocess.PIPE).decode().strip()
    git("init","-q")
    git("config","user.name","Hyperfide fixture");git("config","user.email","fixture@example.invalid")
    (repo/"README.md").write_text("Fixture documentation baseline.\n")
    git("add","README.md");git("commit","-qm","Fixture baseline");base=git("rev-parse","HEAD")
    (repo/"README.md").write_text("Fixture documentation for an exact integrated revision.\n")
    git("add","README.md");git("commit","-qm","Fixture documented revision");head=git("rev-parse","HEAD")
    ids={k:str(uuid.uuid4())for k in["repository","package","task","attempt","custody","branch","candidate","intent","publication","verifier"]}
    ids.update(f.ids);f.docs_ids=ids;f.docs_head=head
    org,run=f.ids["organisation"],f.ids["run"]
    new_spec=str(uuid.uuid4());f.ids["spec"]=new_spec;f.docs_generation="2"
    document={"parsed":{"sections":[{"name":"documentation","line":1,"fields":{k:{"key":k,"raw":json.dumps(v),"value":v,"line":n+2}for n,(k,v)in enumerate({"mode":"manual","targets":["README.md"],"check_cmd":"./cg docs check --json"}.items())}}]}}
    source="fixture accepted documentation policy"
    f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version)VALUES($1,$2,$3,$4,$5,$6::jsonb,1)",[org,new_spec,f.ids["project"],"sha256:"+hashlib.sha256(source.encode()).hexdigest(),source,json.dumps(document)])
    f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id)VALUES($1,$2,2,$3)",[org,run,new_spec])
    f.sql("UPDATE hyperfide.runs SET spec_revision_id=$3,spec_generation=2,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,run,new_spec])
    f.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url)VALUES($1,$2,$3,'docs-fixture','https://example.invalid/docs.git')",[org,ids["repository"],f.ids["project"]])
    f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id)VALUES($1,$2,$3),($1,$2,$4)",[org,ids["repository"],base,head])
    f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref)VALUES($1,$2,$3,$4,'refs/heads/main')",[org,run,ids["repository"],base])
    f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave)VALUES($1,$2,$3,'docs-fixture',1)",[org,run,ids["package"]])
    f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave)VALUES($1,$2,$3,'fixture.1',$4,$5,2,$6,'{}',1)",[org,run,ids["task"],ids["package"],new_spec,digest("fixture-criteria")])
    f.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,compute_authority,execution_state)VALUES($1,$2,$3,$4,1,$5,$6,'RELEASED','SUBMITTED')",[org,run,ids["attempt"],ids["task"],f.ids["epoch"],digest("fixture-packet")])
    f.sql("INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest)VALUES($1,$2,$3,$4,$5,1,1,$6,$7,$8,$9,$10,$11)",[org,run,ids["custody"],ids["task"],ids["attempt"],f.ids["epoch"],ids["repository"],head,digest("fixture-source"),digest("fixture-evidence"),digest("fixture-criteria")])
    f.sql("INSERT INTO hyperfide.branch_authorities(organisation_id,run_id,id,repository_id,branch_ref,branch_generation,authority_epoch,expected_old_head)VALUES($1,$2,$3,$4,'refs/heads/main',1,$5,$6)",[org,run,ids["branch"],ids["repository"],f.ids["epoch"],base])
    candidate_digest=digest("fixture-candidate")
    f.sql("INSERT INTO hyperfide.integration_candidates(organisation_id,run_id,id,task_id,custody_id,custody_generation,repository_id,branch_authority_id,branch_generation,expected_old_head,candidate_head,input_manifest_digest,request_id)VALUES($1,$2,$3,$4,$5,1,$6,$7,1,$8,$9,$10,$11)",[org,run,ids["candidate"],ids["task"],ids["custody"],ids["repository"],ids["branch"],base,head,candidate_digest,str(uuid.uuid4())])
    f.sql("INSERT INTO hyperfide.publication_intents(organisation_id,run_id,id,candidate_id,intent_digest)VALUES($1,$2,$3,$4,$5)",[org,run,ids["intent"],ids["candidate"],digest("fixture-intent")])
    f.sql("INSERT INTO hyperfide.publication_operations(organisation_id,run_id,id,publication_intent_id,candidate_id,branch_authority_id,branch_generation,authority_epoch,repository_id,expected_old_head,candidate_head,request_id,state,observed_head)VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,'PUBLISHED',$10)",[org,run,ids["publication"],ids["intent"],ids["candidate"],ids["branch"],f.ids["epoch"],ids["repository"],base,head,str(uuid.uuid4())])
    f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id)VALUES($1,$2,$3,'VERIFIER','fixture','fixture','fixture-docs-verifier')",[org,run,ids["verifier"]])
    versions=[{"repository_id":ids["repository"],"candidate_head":head,"input_manifest_digest":candidate_digest}]
    f.docs_pins={"spec_revision_id":new_spec,"spec_generation":"2","programme_manifest_digest":digest("fixture-programme"),"source_manifest_digest":digest(versions)}
    f.env["HYPERFIDE_REPOSITORY_ROOTS"]=json.dumps({"/".join([org,run,ids["repository"]]):str(repo)})
def seed_checker(f,packet_id,failed=False,cleanup='CONFIRMED'):
    """Seed an explicit synthetic executor result to test baseline persistence only."""
    selected=f.sql("SELECT payload,packet_digest FROM hyperfide.documentation_packets WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[f.ids["organisation"],f.ids["run"],packet_id])[0]
    packet=selected["payload"];repo=packet["snapshot"]["repositories"][0];job,check_id,request=[str(uuid.uuid4())for _ in range(3)];policy=digest("fixture-command-policy")
    report={"schema_version":1,"kind":"documentation_check","packet_digest":selected["packet_digest"],"snapshot_digest":packet["snapshot_digest"],"source_manifest_digest":packet["pins"]["source_manifest_digest"],"repository_id":repo["repository_id"],"commit":repo["commit"],"tree":repo["tree"],"targets":[{k:v for k,v in e.items()if k!="content_base64"}for e in repo["files"]],"checker_report":{"ok":not failed,"checks":1,"errors":1 if failed else 0,"report":("FAIL"if failed else"ok  ")+"seeded executor result; remote execution is not qualified\n"},"checker_stdout_digest":digest("fixture-stdout"),"checker_stderr_digest":digest("fixture-stderr"),"passed":not failed}
    receipt={"schema_version":1,"packet_id":packet_id,"packet_digest":selected["packet_digest"],"repository_id":repo["repository_id"],"policy_digest":policy,"report":report,"runner":{"cleanup_status":cleanup,"cleanup":{"complete":cleanup=="CONFIRMED","observed_process_absent":cleanup=="CONFIRMED","receipt_digest":digest("fixture-cleanup")},"artifacts":[]},"fixture_only":True}
    org,run=f.ids["organisation"],f.ids["run"]
    f.sql("INSERT INTO hyperfide.documentation_jobs(organisation_id,run_id,id,request_id,packet_id,packet_digest,state,verifier_session_id,policy_digest,remote_operation_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[org,run,job,request,packet_id,selected["packet_digest"],"FAILED"if failed else"SUCCEEDED",f.docs_ids["verifier"],policy,str(uuid.uuid4())])
    f.sql("INSERT INTO hyperfide.documentation_checks(organisation_id,run_id,id,packet_id,job_id,generation,outcome,checker_receipt_digest,canonical_content,payload)VALUES($1,$2,$3,$4,$5,1,$6,$7,$8::text,$8::text::jsonb)",[org,run,check_id,packet_id,job,"FAIL"if failed else"PASS",digest(receipt),canonical(receipt).decode()])
    return check_id
def positive_persistence_probes():
    f=IdentityFixture(extra_components=("28.2",),extra_setup=positive_fixture_setup)
    try:
        packet=call(f,"docs.packet",{"pins":f.docs_pins})
        check("docs.persistence.actual-manual-packet",lambda:require(packet["closed"]is False and packet["virtual_role"]=="@docs","manual explicit packet was waived or refused"))
        check_id=seed_checker(f,packet["packet_id"])
        unknown_cleanup_id=seed_checker(f,packet["packet_id"],cleanup="UNKNOWN")
        check("docs.persistence.unknown-cleanup-not-closure",lambda:call(f,"docs.close",{"packet_id":packet["packet_id"],"check_id":unknown_cleanup_id},ok=False))
        failed_id=seed_checker(f,packet["packet_id"],failed=True)
        check("docs.persistence.failed-check-refused",lambda:call(f,"docs.close",{"packet_id":packet["packet_id"],"check_id":failed_id},ok=False))
        def baseline_failure():
            f.sql("CREATE FUNCTION hyperfide.fixture_fail_baseline()RETURNS trigger LANGUAGE plpgsql AS $fixture$BEGIN RAISE EXCEPTION 'fixture baseline storage failure';END$fixture$;CREATE TRIGGER fixture_fail_baseline BEFORE INSERT ON hyperfide.documentation_baselines FOR EACH ROW EXECUTE FUNCTION hyperfide.fixture_fail_baseline()")
            try:
                call(f,"docs.close",{"packet_id":packet["packet_id"],"check_id":check_id},ok=False)
                count=f.sql("SELECT count(*)::int AS n FROM hyperfide.documentation_closures")[0]["n"]
                require(count==0,"warning-only baseline failure established closure")
            finally:f.sql("DROP TRIGGER fixture_fail_baseline ON hyperfide.documentation_baselines;DROP FUNCTION hyperfide.fixture_fail_baseline()")
        check("docs.persistence.baseline-failure-not-closure",baseline_failure)
        closed=call(f,"docs.close",{"packet_id":packet["packet_id"],"check_ids":[check_id]})
        check("docs.persistence.atomic-baseline-roundtrip",lambda:require(closed["closed"]and closed["status"]=="CURRENT"and closed["baseline_digest"]and closed["dispatches_new_run"]is False,"exact durable seeded-result closure did not persist"))
        def durable():
            f.stop();f.start()
            result=call(f,"docs.inspect",{"pins":f.docs_pins})
            require(result["closed"]and result["receipt_id"]==closed["receipt_id"],"exact durable closure disappeared across restart")
        check("docs.persistence.closed-baseline-survives-restart",durable)
        def mismatch():
            f.sql("UPDATE hyperfide.publication_operations SET observed_head=expected_old_head,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[f.ids["organisation"],f.ids["run"],f.docs_ids["publication"]])
            result=call(f,"docs.inspect",{"pins":f.docs_pins})
            require(not result["closed"]and result["status"]in["STALE","HELD"],"publication mismatch retained current closure")
        check("docs.persistence.changed-publication-held",mismatch)
    finally:f.close()

def main():
    f=fixture()
    try:
        def inspection_held():
            result=call(f,"docs.inspect",{"pins":pins(f)})
            require(result["status"]=="HELD"and result["closed"]is False,"missing source/policy was treated as closure")
        check("docs.authority.missing-inputs-held",inspection_held)
        def stale_spec():
            p=pins(f);p["spec_revision_id"]=str(uuid.uuid4())
            result=call(f,"docs.inspect",{"pins":p})
            require(result["status"]=="STALE"and not result["closed"],"wrong accepted specification was used")
        check("docs.authority.stale-spec-refused",stale_spec)
        def no_client_override():
            call(f,"docs.packet",{"pins":pins(f),"mode":"off","closed":True},ok=False)
        check("docs.authority.no-request-policy-bypass",no_client_override)
        def no_connector_success():
            call(f,"docs.close",{"packet_id":str(uuid.uuid4()),"check_id":str(uuid.uuid4()),"exit_code":0,"passed":True},ok=False)
        check("docs.authority.connector-exit-not-closure",no_connector_success)
        check("docs.authority.absent-checker-refused",lambda:call(f,"docs.close",{"packet_id":str(uuid.uuid4()),"check_id":str(uuid.uuid4())},ok=False))
        def no_plain_transaction():
            result=node("import{inspectDocumentationClosure}from'./services/hyperfide/dist/docs/closure.js';try{await inspectDocumentationClosure({query:async()=>({rows:[]})},{},{});process.exit(1)}catch(e){if(e.code!=='TX_CLOSED')throw e}")
            require(result.returncode==0,"unbranded transaction was accepted: "+result.stderr)
        check("docs.authority.requires-branded-primary",no_plain_transaction)
        def isolation_guards():
            rows=f.sql("SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hyperfide' AND c.relname LIKE 'documentation_%' AND t.tgname='aaa_supported_isolation'")
            require(rows[0]["n"]==5,"new documentation authority table lacks isolation guard")
        check("docs.authority.all-isolation-guards",isolation_guards)
        packet_id=str(uuid.uuid4());packet={"fixture_only":True};packet_bytes=canonical(packet).decode()
        args=[f.ids["organisation"],f.ids["run"],packet_id,str(uuid.uuid4()),f.ids["spec"],f.ids["epoch"],digest([]),digest("fixture-programme"),digest(packet),packet_bytes]
        f.sql("INSERT INTO hyperfide.documentation_packets(organisation_id,run_id,id,request_id,spec_revision_id,spec_generation,authority_epoch,source_manifest_digest,programme_manifest_digest,packet_digest,canonical_content,payload)VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10::text,$10::text::jsonb)",args)
        def immutable():
            try:f.sql("UPDATE hyperfide.documentation_packets SET payload='{}' WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[f.ids["organisation"],f.ids["run"],packet_id])
            except AssertionError as e:
                require('documentation evidence is immutable'in str(e),'wrong immutability failure: '+str(e));return
            raise AssertionError("persisted documentation packet mutated")
        check("docs.authority.packet-immutable",immutable)
        def isolation_refusal():
            values=args.copy();values[2]=str(uuid.uuid4());values[3]=str(uuid.uuid4())
            script="import pg from'./services/hyperfide/node_modules/pg/lib/index.js';import fs from'node:fs';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await c.query('INSERT INTO hyperfide.documentation_packets(organisation_id,run_id,id,request_id,spec_revision_id,spec_generation,authority_epoch,source_manifest_digest,programme_manifest_digest,packet_digest,canonical_content,payload)VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10::text,$10::text::jsonb)',JSON.parse(fs.readFileSync(0,'utf8')));process.exitCode=1}catch(e){if(e.code!=='25001')throw e}}finally{await c.query('ROLLBACK');await c.end()}"
            result=node(script,values,env=f.env)
            require(result.returncode==0,"unsupported isolation was not rejected by its actual guard: "+result.stderr)
        check("docs.authority.repeatable-write-refused",isolation_refusal)
        def restart():
            f.stop();f.start()
            rows=f.sql("SELECT packet_digest,canonical_content FROM hyperfide.documentation_packets WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[f.ids["organisation"],f.ids["run"],packet_id])
            require(rows==[{"packet_digest":digest(packet),"canonical_content":packet_bytes}],"durable packet disappeared after actual service restart")
            result=call(f,"docs.inspect",{"pins":pins(f)})
            require(not result["closed"],"a durable packet alone was promoted to closure")
        check("docs.authority.restart-does-not-promote-packet",restart)
    finally:f.close()
    missing=fixture(migrate=False)
    try:
        error=call(missing,"docs.inspect",{"pins":pins(missing)},ok=False)
        require(error.get("code")=="DOCS_SCHEMA_REQUIRED","missing migration did not refuse readiness")
        check("docs.authority.no-handler-ddl",lambda:require(missing.sql("SELECT to_regclass('hyperfide.documentation_closures') AS name")[0]["name"]is None,"handler created schema"))
    finally:missing.close()
    positive_persistence_probes()
    cleanup_event("28.2")
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(cleanup_only("28.2")if "--cleanup"in sys.argv else main())
