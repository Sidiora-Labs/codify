#!/usr/bin/env python3
"""Bounded domain16 authority tests; these do not establish physical remote execution."""
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[4]
TASK = "16.1"
OBSERVATIONS = []
RESOURCE = None
DATABASE = None

def directory():
    target = Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR", "/tmp/hyperfide/task-" + TASK + "-bounded")) / "assurance"
    target.mkdir(parents=True, exist_ok=True)
    return target

def emit(key, actual, expected=True):
    OBSERVATIONS.append({"id": key, "actual": actual, "expected": expected})
    print(json.dumps({"type": "assertion", "id": key, "actual": actual, "expected": expected}), flush=True)
    if actual != expected:
        raise AssertionError(key)

def node(program):
    process = subprocess.run(["node", "--input-type=module", "-e", program], cwd=ROOT,
                             text=True, capture_output=True, timeout=45)
    if process.returncode:
        raise RuntimeError("Actual compiled assurance probe failed: " + process.stderr[-1200:])
    return [json.loads(line) for line in process.stdout.splitlines() if line.strip()]

def authority_cases():
    scope = {"organisation_id": str(uuid.uuid4()), "run_id": str(uuid.uuid4())}
    u = str(uuid.uuid4())
    d = "sha256:" + "a" * 64
    common = dict(scope, submission_id=u, custody_generation="1", expected_state_version="1")
    inputs = {
        "submission.submit": dict(scope, task_id=u, request_id=u, attempt_id=u, attempt_generation="1",
            authority_epoch=u, sandbox_id=u, slot_id=u, sandbox_boot_generation="1", repository_id=u,
            source_object_id="a"*40, source_manifest_artifact_id=u, evidence_manifest_artifact_id=u,
            criteria_digest=d, contract_digests=[]),
        "submission.revoke": dict(common, reason="bounded unauthenticated negative"),
        "submission.inspect": dict(scope, submission_id=u),
        "qualification.job.assign": dict(scope, job_id=u, expected_state_version="1", verifier_id=u,
            sandbox_id=u, slot_id=u, sandbox_boot_generation="1", reservation_id=u, environment_digest=d),
        "qualification.job.claim": dict(scope, job_id=u, expected_state_version="1"),
        "qualification.execute": dict(scope, job_id=u, lease_generation="1"),
        "qualification.history.import": dict(scope, task_id=u, provenance="untrusted fixture claim", legacy_claim={"PASS":True}),
        "qualification.coverage.inspect": dict(scope, submission_id=u),
        "qualification.review.record": dict(common, clause_id="clause", rubric_digest=d,
            support_artifact_ids=[u], limitations="bounded negative", disposition="PASS"),
        "qualification.accept": common,
        "assurance.validity.inspect": dict(scope, submission_id=u),
        "assurance.invalidate": dict(scope, submission_id=u, request_id=u, expected_state_version="1", changes={"source":d}),
        "assurance.requalification.accept": dict(scope, operation_id=u, expected_state_version="1"),
    }
    actions = {
        "16.1": ("submission", ["submission.submit", "submission.revoke", "submission.inspect"]),
        "16.2": ("executor", ["qualification.job.assign", "qualification.job.claim", "qualification.execute", "qualification.history.import"]),
        "16.3": ("coverage", ["qualification.coverage.inspect", "qualification.review.record", "qualification.accept"]),
        "16.4": ("validity", ["assurance.validity.inspect", "assurance.invalidate", "assurance.requalification.accept"]),
    }
    module, selected = actions[TASK]
    program = """
const module = await import('./services/hyperfide/dist/assurance/%s.js');
const inputs = %s;
const component = module.createComponent({});
for (const [action,input] of Object.entries(inputs)) {
 for(const [kind,context] of [['absent',{}],['forged',{invocation:{principal:{...input,role:'OPERATOR',actor_id:input.submission_id??input.task_id??input.job_id},guard:async()=>{},identityGuard:async()=>{},operation:{idempotency_key:input.request_id},signal:new AbortController().signal}}]]){
  let code=null, accepted=false;
  try { await component.actions[action](input,context); accepted=true; }
  catch(error) {code=error.code??error.name;}
  console.log(JSON.stringify({action,kind,code,accepted}));
 }
}
""" % (module, json.dumps({key:inputs[key] for key in selected}))
    results = node(program)
    if len(results) != 2*len(selected):
        raise AssertionError("Actual component emitted incomplete negative inventory")
    for row in results:
        emit("assurance."+TASK+".auth."+row["kind"]+"."+row["action"], row["code"]=="AUTH_REQUIRED" and row["accepted"] is False)

def primary_cases():
    scope = {"organisation_id":str(uuid.uuid4()),"run_id":str(uuid.uuid4())}
    u = str(uuid.uuid4())
    module, expression = {
        "16.1": ("submission", "module.fenceQualificationJobs(db,scope,[], 'negative plain client')"),
        "16.2": ("executor", "module.inspectExecutionReceipt(db,scope,id,'1')"),
        "16.3": ("coverage", "module.inspectCoverage(db,scope,id)"),
        "16.4": ("validity", "module.inspectValidity(db,scope,id)"),
    }[TASK]
    results = node("""
const module=await import('./services/hyperfide/dist/assurance/%s.js');
const storage=await import('./services/hyperfide/dist/storage/transactions.js');
if(typeof storage.assertPrimaryTransaction!=='function')throw new Error('Actual primary capability is missing');
let queries=0,code=null,accepted=false;
const db={query(){queries++;throw new Error('Unbranded client must never query');}};
const scope=%s,id=%s;
try{await %s;accepted=true;}catch(error){code=error.code??error.name;}
console.log(JSON.stringify({code,accepted,queries}));
""" % (module, json.dumps(scope), json.dumps(u), expression))
    emit("assurance."+TASK+".primary.unbranded-denied",
         results == [{"code":"QUALIFICATION_PRIMARY_REQUIRED","accepted":False,"queries":0}])

def sql(text, database=None, accept_error=False):
    result = subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1",
                              "-v","VERBOSITY=verbose","-d",database or DATABASE],
                             cwd=ROOT, input=text, text=True, capture_output=True, timeout=45)
    if result.returncode and not accept_error:
        raise RuntimeError("Disposable PostgreSQL probe failed: "+result.stderr[-1800:])
    return result



def semantic_cases():
    row=json.loads(sql("SELECT json_build_object('organisation_id',organisation_id,'run_id',run_id,'task_id',id) FROM hyperfide.tasks LIMIT 1;").stdout)
    program="""
import {ResourceContainer} from './services/hyperfide/dist/storage/runtime.js';
import {assuranceBarrier} from './services/hyperfide/dist/assurance/submission.js';
const scope=%s;
const url=new URL(process.env.DATABASE_URL);url.pathname='/'+%s;
const resources=new ResourceContainer('control',{...process.env,DATABASE_URL:url.href,HYPERFIDE_CONTROL_DATABASE_URL:url.href},new AbortController().signal);
const guarded=(mode,operation,maxRetries=2)=>resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries,guard:tx=>assuranceBarrier(tx,scope,mode)},operation);
try{
 let releaseWriter,notifyWriter;
 const release=new Promise(resolve=>releaseWriter=resolve),ready=new Promise(resolve=>notifyWriter=resolve);
 const writer=resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:0,guard:async tx=>{await assuranceBarrier(tx,scope,'EXCLUSIVE');notifyWriter();}},async tx=>{
  await tx.query("INSERT INTO hyperfide.assurance_history(organisation_id,run_id,task_id,provenance,legacy_claim) VALUES($1,$2,$3,'semantic-race','{}')",[scope.organisation_id,scope.run_id,scope.task_id]);
  await release;
 });
 await ready;
 const reader=guarded('SHARED',async tx=>Number((await tx.query('SELECT count(*) AS total FROM hyperfide.assurance_history WHERE organisation_id=$1 AND run_id=$2',[scope.organisation_id,scope.run_id])).rows[0].total));
 await new Promise(resolve=>setTimeout(resolve,50));releaseWriter();
 const [,observed]=await Promise.all([writer,reader]);
 console.log(JSON.stringify({id:'fresh',passed:observed===2}));
 const cached=await guarded('EXCLUSIVE',async tx=>{
  const before=(await tx.query('SELECT semantic_generation::text AS generation,state_version::text AS version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[scope.organisation_id,scope.run_id])).rows[0];
  await assuranceBarrier(tx,scope,'SHARED');await assuranceBarrier(tx,scope,'EXCLUSIVE');
  const after=(await tx.query('SELECT semantic_generation::text AS generation,state_version::text AS version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[scope.organisation_id,scope.run_id])).rows[0];
  return before.generation===after.generation&&before.version===after.version;
 });
 console.log(JSON.stringify({id:'cached',passed:cached}));
 let code=null;
 try{await guarded('SHARED',async tx=>assuranceBarrier(tx,scope,'EXCLUSIVE'),0);}catch(error){code=error.code;}
 console.log(JSON.stringify({id:'upgrade-refused',passed:code==='SEMANTIC_FENCE_ORDER'}));
}finally{await resources.close();}
""" % (json.dumps(row),json.dumps(DATABASE))
    results=node(program)
    if len(results)!=3:raise AssertionError("Actual semantic fence inventory incomplete")
    for result in results:emit("assurance.16.1.semantic."+result["id"],result["passed"])

def signed_cases():
    sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
    from identity_fixture import IdentityFixture
    import hashlib
    fragments={}
    for path in (ROOT/"services/hyperfide/components").glob("*.json"):
        value=json.loads(path.read_text())
        if "id" in value:fragments[value["id"]]=(path.stem,value)
    selected=set()
    def include(key):
        if key in selected:return
        selected.add(key)
        for dependency in fragments[key][1]["requires"]:include(dependency)
    include(TASK)
    names=[fragments[key][0] for key in sorted(selected)]
    database="hf_assurance_"+TASK.replace(".","_")+"_"+uuid.uuid4().hex[:16]
    record=directory()/("signed-resource-"+TASK+".json")
    state={"database":database,"pid":None,"start":None,"closed":False}
    record.write_text(json.dumps(state))
    def setup(fixture):
        names=("0002-spec.sql","0003-hierarchy.sql","0004-durability.sql","0005-scheduling.sql","0007-graph.sql",
               "0008-provider-coordination.sql","0012-runner-registry.sql","0016-qualification.sql",
               "0032-execution-packets.sql","0034-child-sessions.sql","0202-spec-dependencies.sql")
        for name in names:
            path=ROOT/"services/hyperfide/migrations"/name
            version=int(path.name.split("-")[0])
            data=path.read_bytes()
            fixture.sql(data.decode())
            fixture.sql("INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES($1,$2,$3)",
                        [version,path.stem,"sha256:"+hashlib.sha256(data).hexdigest()])
    fixture=None
    try:
        fixture=IdentityFixture(extra_components=names,extra_setup=setup,extra_env={"HYPERFIDE_REQUIRE_SYNC_REPLICA":"0"},database=database)
        state["pid"]=fixture.child.pid
        state["start"]=Path("/proc/"+str(state["pid"])+"/stat").read_text().split()[21]
        record.write_text(json.dumps(state))
        org,run=fixture.ids["organisation"],fixture.ids["run"]
        u,d=str(uuid.uuid4()),"sha256:"+"b"*64
        read={"16.1":"submission.inspect","16.2":"qualification.job.assign","16.3":"qualification.coverage.inspect","16.4":"assurance.validity.inspect"}[TASK]
        value={"organisation_id":org,"run_id":run,"submission_id":u}
        if TASK=="16.2":
            value={"organisation_id":org,"run_id":run,"job_id":u,"expected_state_version":"1",
                   "verifier_id":u,"sandbox_id":u,"slot_id":u,"sandbox_boot_generation":"1",
                   "reservation_id":u,"environment_digest":d}
        def error(action,payload,key="operator"):
            status,response=fixture.invoke(action,payload,component=TASK,key=key)
            return status==200 and response.get("ok") is False and response.get("error",{}).get("code")
        emit("assurance."+TASK+".https.signed-missing",error(read,value)=="QUALIFICATION_NOT_FOUND")
        emit("assurance."+TASK+".https.cross-scope",error(read,dict(value,organisation_id=str(uuid.uuid4()))) in ("AUTH_SCOPE_DENIED","QUALIFICATION_SCOPE_DENIED"))
        action,payload,key={
            "16.1":("submission.submit",{"organisation_id":org,"run_id":run,"task_id":u,"request_id":u,"attempt_id":u,"attempt_generation":"1",\
                "authority_epoch":u,"sandbox_id":u,"slot_id":u,"sandbox_boot_generation":"1","repository_id":u,"source_object_id":"a"*40,\
                "source_manifest_artifact_id":u,"evidence_manifest_artifact_id":u,"criteria_digest":d,"contract_digests":[]},"operator"),
            "16.2":("qualification.execute",{"organisation_id":org,"run_id":run,"job_id":u,"lease_generation":"1"},"operator"),
            "16.3":("qualification.review.record",{"organisation_id":org,"run_id":run,"submission_id":u,"custody_generation":"1","expected_state_version":"1",\
                "clause_id":"clause","rubric_digest":d,"support_artifact_ids":[u],"limitations":"bounded authenticated refusal","disposition":"PASS"},"operator"),
            "16.4":("assurance.invalidate",{},"provisioner"),
        }[TASK]
        emit("assurance."+TASK+".https.wrong-role",error(action,payload,key)=="QUALIFICATION_ROLE_DENIED")
        counts=fixture.sql("SELECT (SELECT count(*) FROM hyperfide.submission_custodies)::text AS custody,"
                           "(SELECT count(*) FROM hyperfide.qualification_jobs)::text AS jobs,"
                           "(SELECT count(*) FROM hyperfide.evidence)::text AS evidence")
        emit("assurance."+TASK+".https.no-authority",counts==[{"custody":"0","jobs":"0","evidence":"0"}])
    finally:
        if fixture is not None:
            fixture.close();state["closed"]=True;record.write_text(json.dumps(state))

def cleanup_signed():
    record=directory()/("signed-resource-"+TASK+".json")
    if not record.exists():return []
    import signal,time
    state=json.loads(record.read_text())
    pid=state.get("pid")
    observed_empty=False
    if pid is None:
        from urllib.parse import urlsplit
        matches=[]
        for process in Path("/proc").iterdir():
            if not process.name.isdigit():continue
            try:
                command=(process/"cmdline").read_bytes().split(b"\x00")
                expected=str(ROOT/"services/hyperfide/dist/control.js").encode()
                if expected not in command:continue
                environment=dict(item.split(b"=",1) for item in (process/"environ").read_bytes().split(b"\x00") if b"=" in item)
                if urlsplit(environment.get(b"DATABASE_URL",b"").decode()).path!="/"+state["database"]:continue
                matches.append((int(process.name),(process/"stat").read_text().split()[21]))
            except (FileNotFoundError,PermissionError,ProcessLookupError):continue
        observed_empty=not matches
        if len(matches)==1:pid,state["start"]=matches[0]
    def current():
        if pid is None:return not observed_empty
        try:return Path("/proc/"+str(pid)+"/stat").read_text().split()[21]==state.get("start")
        except FileNotFoundError:return False
    if pid is not None and current():
        os.kill(pid,signal.SIGTERM)
        for _ in range(50):
            if not current():break
            time.sleep(0.1)
        if current():os.kill(pid,signal.SIGKILL)
    stopped=not current()
    name=state["database"]
    subprocess.run(["dropdb","--force","--if-exists",name],cwd=ROOT,check=True,capture_output=True,timeout=45)
    absent=sql("SELECT count(*) FROM pg_database WHERE datname='"+name+"';","postgres").stdout.strip()=="0"
    artifact="assurance/signed-absence-"+TASK+".json"
    (directory()/("signed-absence-"+TASK+".json")).write_text(json.dumps({
        "database":name,"database_observed_absent":absent,"service_observed_absent":stopped,
        "observer":"PostgreSQL pg_database and exact service PID/start identity or scoped process enumeration"})+"\n")
    return [{"id":"hf-task-"+TASK+"-signed-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":artifact},
            {"id":"hf-task-"+TASK+"-signed-service","status":"deleted" if stopped else "unknown","observed_absent":stopped,"evidence_artifact":artifact}]

def cleanup():
    global DATABASE, RESOURCE
    signed_resources=cleanup_signed()
    signed_absent=all(row['observed_absent'] for row in signed_resources)
    record = directory()/("resource-"+TASK+".json")
    if DATABASE is None and record.exists():
        value=json.loads(record.read_text());DATABASE=value["database"];RESOURCE=value["resource"]
    if not DATABASE:
        print(json.dumps({"type":"cleanup","complete":signed_absent,"resources":signed_resources}),flush=True)
        return signed_absent
    subprocess.run(["dropdb","--force","--if-exists",DATABASE],cwd=ROOT,check=True,capture_output=True,timeout=45)
    absent=sql("SELECT count(*) FROM pg_database WHERE datname='"+DATABASE+"';","postgres").stdout.strip()=="0"
    artifact="assurance/database-absence-"+TASK+".json"
    (directory()/("database-absence-"+TASK+".json")).write_text(json.dumps({
        "resource":RESOURCE,"database":DATABASE,"observed_absent":absent,
        "observer":"PostgreSQL pg_database after DROP DATABASE"})+"\n")
    print(json.dumps({"type":"cleanup","complete":absent and signed_absent,"resources":signed_resources+[{"id":RESOURCE,
        "status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":artifact}]}),flush=True)
    return absent and signed_absent

def schema_cases():
    global DATABASE, RESOURCE
    DATABASE="hf_16_bounded_"+uuid.uuid4().hex[:16]
    RESOURCE="hf-task-"+TASK+"-database"
    (directory()/("resource-"+TASK+".json")).write_text(json.dumps({"database":DATABASE,"resource":RESOURCE})+"\n")
    subprocess.run(["createdb",DATABASE],cwd=ROOT,check=True,capture_output=True,timeout=30)
    for name in ["0001-authority.sql","0004-durability.sql","0016-qualification.sql"]:
        sql((ROOT/"services/hyperfide/migrations"/name).read_text())
    emit("assurance.16.1.schema.applied", sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='hyperfide' AND table_name LIKE 'assurance_%';").stdout.strip()=="11")
    ids=[str(uuid.uuid4()) for _ in range(7)]
    org,project,spec,run,epoch,package,task=ids
    import hashlib
    sha="sha256:"+hashlib.sha256(b"fixture").hexdigest()
    other="sha256:"+"b"*64
    seed=f"""
BEGIN ISOLATION LEVEL SERIALIZABLE;
INSERT INTO hyperfide.organisations(id,name) VALUES('{org}','bounded16');
INSERT INTO hyperfide.projects(organisation_id,id,name) VALUES('{org}','{project}','bounded16');
INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version)
 VALUES('{org}','{project}','{spec}','{sha}','fixture','{{}}',1);
INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch)
 VALUES('{org}','{run}','{project}','{spec}','{other}','{epoch}');
INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave)
 VALUES('{org}','{run}','{package}','bounded16',1);
INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave)
 VALUES('{org}','{run}','{task}','bounded16','{package}','{spec}','{other}','{{}}',1);
INSERT INTO hyperfide.assurance_history(organisation_id,run_id,task_id,provenance,legacy_claim)
 VALUES('{org}','{run}','{task}','untrusted historic fixture','{{"claimed_PASS":true}}');
COMMIT;
"""
    sql(seed)
    emit("assurance.16.1.history.no-authority",
        sql(f"SELECT state FROM hyperfide.tasks WHERE organisation_id='{org}' AND run_id='{run}' AND id='{task}';").stdout.strip()=="PENDING" and
        sql(f"SELECT count(*) FROM hyperfide.submission_custodies WHERE organisation_id='{org}' AND run_id='{run}';").stdout.strip()=="0" and
        sql(f"SELECT count(*) FROM hyperfide.qualification_jobs WHERE organisation_id='{org}' AND run_id='{run}';").stdout.strip()=="0")
    for name,mutation in [
        ("update",f"UPDATE hyperfide.assurance_history SET provenance='rewritten' WHERE organisation_id='{org}' AND run_id='{run}';"),
        ("delete",f"DELETE FROM hyperfide.assurance_history WHERE organisation_id='{org}' AND run_id='{run}';")
    ]:
        result=sql("BEGIN ISOLATION LEVEL SERIALIZABLE;\n"+mutation+"\nCOMMIT;",accept_error=True)
        emit("assurance.16.1.history.immutable-"+name,result.returncode!=0 and "assurance history is immutable" in result.stderr)
    count=sql(f"SELECT count(*) FROM hyperfide.assurance_history WHERE organisation_id='{org}' AND run_id='{run}';").stdout.strip()
    emit("assurance.16.1.history.preserved",count=="1")

def main(task="16.1"):
    global TASK
    TASK=task
    if "--cleanup" in sys.argv:
        return 0 if cleanup() else 1
    passed=False
    try:
        authority_cases()
        if TASK=="16.1":
            schema_cases()
            semantic_cases()
        primary_cases()
        signed_cases()
        passed=True
    finally:
        absent=cleanup()
        (directory()/("observations-"+TASK+".json")).write_text(json.dumps({
            "scope":"bounded-auth-and-ledger","physical_execution_qualification":"NOT_EVALUATED",
            "positive_submission_qualification":"NOT_EVALUATED","assertions":OBSERVATIONS},indent=2)+"\n")
    return 0 if passed and absent else 1

if __name__=="__main__":
    raise SystemExit(main())
