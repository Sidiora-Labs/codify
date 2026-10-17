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
        "qualification.preparation.plan": dict(scope,job_id=u,request_id=u,session_id=u,reservation_id=u,recipe_policy_artifact_id=u,
            source_bundles=[{"repository_key":"fixture","artifact_id":u,"storage_kind":"object"}],timeout_ms=1000),
        "qualification.preparation.inspect": dict(scope,operation_id=u),
        "qualification.job.assign": dict(scope, job_id=u, expected_state_version="1", verifier_id=u,
            sandbox_id=u, slot_id=u, sandbox_boot_generation="1", reservation_id=u, environment_digest=d),
        "qualification.job.claim": dict(scope, job_id=u, expected_state_version="1"),
        "qualification.execute": dict(scope, job_id=u, lease_generation="1"),
        "qualification.execution.inspect": dict(scope, job_id=u, lease_generation="1"),
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
        "16.2": ("executor", ["qualification.job.assign", "qualification.job.claim", "qualification.execute", "qualification.history.import", "qualification.preparation.plan", "qualification.preparation.inspect", "qualification.execution.inspect"]),
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
    if TASK=="16.2":
        results=node("""
const m=await import('./services/hyperfide/dist/assurance/preparation.js');
const scope=%s,id=%s;
for(const [key,call,expected] of [
 ['context',db=>m.loadResultPreparationContext(db,scope,{job_id:id}),'QUALIFICATION_PRIMARY_REQUIRED'],
 ['effective-inputs',db=>m.inspectEffectiveResultInputs(db,scope,{job_id:id}),'TX_CLOSED'],
 ['intent',db=>m.inspectResultPreparationIntent(db,scope,{operation_id:id}),'TX_CLOSED']
]){
 let queries=0,code=null,accepted=false;
 const db={query(){queries++;throw new Error('No unbranded decision query');}};
 try{await call(db);accepted=true;}catch(error){code=error.code??error.name;}
 console.log(JSON.stringify({key,valid:!accepted&&queries===0&&code===expected}));
}
""" % (json.dumps(scope),json.dumps(u)))
        if len(results)!=3:raise AssertionError("Incomplete preparation primary-capability negative inventory")
        for row in results:emit("assurance.16.2.primary.preparation-"+row["key"],row["valid"])


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
        state.update(runtime_role=fixture.runtime_role,folder=str(fixture.path),port=fixture.port)
        record.write_text(json.dumps(state))
        names=("0002-spec.sql","0003-hierarchy.sql","0004-durability.sql","0005-scheduling.sql","0007-graph.sql",
               "0008-provider-coordination.sql","0012-runner-registry.sql","0016-qualification.sql",
               "0032-execution-packets.sql","0034-child-sessions.sql","0202-spec-dependencies.sql")
        for name in names:
            path=ROOT/"services/hyperfide/migrations"/name
            version=int(path.name.split("-")[0])
            fixture.apply_migration(path.stem)
    class OwnedFixture(IdentityFixture):
        def __init__(self,**kwargs):
            try:super().__init__(**kwargs)
            finally:
                for attribute,key in (("runtime_role","runtime_role"),("path","folder"),("port","port")):
                    value=getattr(self,attribute,None)
                    if value is not None:state[key]=str(value) if key=="folder" else value
                child=getattr(self,"child",None)
                if child is not None:
                    state["pid"]=child.pid
                    stat=Path("/proc/"+str(child.pid)+"/stat")
                    if stat.exists():state["start"]=stat.read_text().split()[21]
                record.write_text(json.dumps(state))
    fixture=None
    try:
        fixture=OwnedFixture(extra_components=names,extra_setup=setup,extra_env={"HYPERFIDE_REQUIRE_SYNC_REPLICA":"0"},database=database)
        state["pid"]=fixture.child.pid
        state["start"]=Path("/proc/"+str(state["pid"])+"/stat").read_text().split()[21]
        record.write_text(json.dumps(state))
        org,run=fixture.ids["organisation"],fixture.ids["run"]
        u,d=str(uuid.uuid4()),"sha256:"+"b"*64
        read={"16.1":"submission.inspect","16.2":"qualification.execution.inspect","16.3":"qualification.coverage.inspect","16.4":"assurance.validity.inspect"}[TASK]
        value={"organisation_id":org,"run_id":run,"submission_id":u}
        if TASK=="16.2":
            value={"organisation_id":org,"run_id":run,"job_id":u,"lease_generation":"1"}
        def error(action,payload,key="operator"):
            status,response=fixture.invoke(action,payload,component=TASK,key=key)
            return status==200 and response.get("ok") is False and response.get("error",{}).get("code")
        emit("assurance."+TASK+".https.signed-missing",error(read,value)==("QUALIFICATION_RECEIPT_INVALID" if TASK=="16.2" else "QUALIFICATION_NOT_FOUND"))
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
    if state.get("port"):
        import socket
        with socket.socket() as observer:
            observer.settimeout(0.5)
            stopped=stopped and observer.connect_ex(("127.0.0.1",state["port"]))!=0
    name=state["database"]
    subprocess.run(["dropdb","--force","--if-exists",name],cwd=ROOT,check=True,capture_output=True,timeout=45)
    absent=sql("SELECT count(*) FROM pg_database WHERE datname='"+name+"';","postgres").stdout.strip()=="0"
    role=state.get("runtime_role")
    role_absent=role is not None
    if role:
        import re
        if not re.fullmatch(r"hf_ir_[0-9a-f]{32}",role):raise ValueError("Unowned runtime role")
        sql('DROP ROLE IF EXISTS "'+role+'"',"postgres")
        role_absent=sql("SELECT count(*) FROM pg_roles WHERE rolname='"+role+"';","postgres").stdout.strip()=="0"
    folder=state.get("folder")
    files_absent=folder is not None
    if folder:
        import tempfile,shutil
        location=Path(folder)
        if location.parent!=Path(tempfile.gettempdir()) or not location.name.startswith("hyperfide-identity-") or location.is_symlink():
            raise ValueError("Unowned identity fixture folder")
        if stopped and location.exists():shutil.rmtree(location)
        files_absent=not location.exists()
    artifact="assurance/signed-absence-"+TASK+".json"
    (directory()/("signed-absence-"+TASK+".json")).write_text(json.dumps({
        "database":name,"database_observed_absent":absent,"service_observed_absent":stopped,"runtime_role_observed_absent":role_absent,"fixture_files_observed_absent":files_absent,
        "observer":"PostgreSQL pg_database and exact service PID/start identity or scoped process enumeration"})+"\n")
    return [{"id":"hf-task-"+TASK+"-signed-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":artifact},
            {"id":"hf-task-"+TASK+"-signed-service","status":"deleted" if stopped else "unknown","observed_absent":stopped,"evidence_artifact":artifact},
            {"id":"hf-task-"+TASK+"-signed-role","status":"deleted" if role_absent else "unknown","observed_absent":role_absent,"evidence_artifact":artifact},
            {"id":"hf-task-"+TASK+"-signed-files","status":"deleted" if files_absent else "unknown","observed_absent":files_absent,"evidence_artifact":artifact}]

def cleanup(report=True):
    """In-run teardown is silent; only the independent --cleanup invocation reports one observed event."""
    global DATABASE, RESOURCE
    signed_resources=cleanup_signed()+cleanup_git()+cleanup_preparation()+cleanup_submission()
    signed_absent=all(row['observed_absent'] for row in signed_resources)
    record = directory()/("resource-"+TASK+".json")
    if DATABASE is None and record.exists():
        value=json.loads(record.read_text());DATABASE=value["database"];RESOURCE=value["resource"]
    if not DATABASE:
        if report:print(json.dumps({"type":"cleanup","complete":signed_absent,"resources":signed_resources}),flush=True)
        return signed_absent
    subprocess.run(["dropdb","--force","--if-exists",DATABASE],cwd=ROOT,check=True,capture_output=True,timeout=45)
    absent=sql("SELECT count(*) FROM pg_database WHERE datname='"+DATABASE+"';","postgres").stdout.strip()=="0"
    artifact="assurance/database-absence-"+TASK+".json"
    (directory()/("database-absence-"+TASK+".json")).write_text(json.dumps({
        "resource":RESOURCE,"database":DATABASE,"observed_absent":absent,
        "observer":"PostgreSQL pg_database after DROP DATABASE"})+"\n")
    if report:print(json.dumps({"type":"cleanup","complete":absent and signed_absent,"resources":signed_resources+[{"id":RESOURCE,
        "status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":artifact}]}),flush=True)
    return absent and signed_absent


def git_cases():
    """Measure actual immutable Git ancestry, branch head and accepted path ownership."""
    import tempfile
    import shutil
    location=Path(tempfile.mkdtemp(prefix="hyperfide-assurance-git-"))
    record=directory()/("git-resource-"+TASK+".json")
    record.write_text(json.dumps({"path":str(location)}))
    try:
        def git(*args):
            return subprocess.run(["git","-c","core.hooksPath=/dev/null","-c","maintenance.auto=false","-c","gc.auto=0",*args],cwd=location,
                env=dict(os.environ,GIT_CONFIG_NOSYSTEM="1",GIT_CONFIG_GLOBAL="/dev/null"),
                text=True,capture_output=True,check=True,timeout=15).stdout.strip()
        git("init","-q");git("config","user.name","Bounded source test");git("config","user.email","fixture@example.invalid")
        (location/"baseline").write_text("accepted baseline\n")
        git("add","--all");git("commit","-qm","accepted baseline")
        baseline=git("rev-parse","HEAD")
        def commit(changes):
            git("checkout","-q","--detach",baseline)
            git("clean","-fdq")
            for name,data in changes.items():
                target=location/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(data)
            git("add","--all");git("commit","-qm","actual result")
            return git("rev-parse","HEAD")
        result=commit({"src/allowed.ts":"actual result\n"})
        outside=commit({"outside.ts":"outside\n"})
        prefix=commit({"src-escape/allowed.ts":"outside prefix\n"})
        nested=commit({"src/deep/allowed.ts":"nested\n"})
        spaces=commit({"src/file with spaces.ts":"spaces\n"})
        git("checkout","-q","--detach",result)
        git("mv","src/allowed.ts","escaped.ts");git("commit","-qm","rename beyond scope")
        renamed=git("rev-parse","HEAD")
        git("checkout","-q","--orphan","unrelated")
        git("rm","-rf","--ignore-unmatch",".")
        (location/"unrelated").write_text("unrelated\n");git("add","--all");git("commit","-qm","unrelated history")
        unrelated=git("rev-parse","HEAD")
        git("checkout","-q","--detach",baseline)
        invalid_path=os.fsencode(location)+b"/invalid-\xff"
        descriptor=os.open(invalid_path,os.O_WRONLY|os.O_CREAT,0o600)
        os.write(descriptor,b"invalid utf8\n");os.close(descriptor)
        git("add","--all");git("commit","-qm","invalid path encoding")
        invalid=git("rev-parse","HEAD")
        cases=[
            ("different-result-owned",result,baseline,["src"],None),
            ("outside-scope",outside,baseline,["src"],"QUALIFICATION_SOURCE_SCOPE"),
            ("rename-outside-scope",renamed,result,["src"],"QUALIFICATION_SOURCE_SCOPE"),
            ("unrelated-history",unrelated,baseline,["."],"QUALIFICATION_SOURCE_MISMATCH"),
            ("postsubmit-head-amendment",result,baseline,["src"],"QUALIFICATION_SOURCE_MISMATCH"),
            ("prefix-escape",prefix,baseline,["src/*"],"QUALIFICATION_SOURCE_SCOPE"),
            ("single-star-depth",nested,baseline,["src/*"],"QUALIFICATION_SOURCE_SCOPE"),
            ("double-star-depth",nested,baseline,["src/**"],None),
            ("spaces-preserved",spaces,baseline,["src/file with spaces.ts"],None),
            ("malformed-utf8-path",invalid,baseline,["."],"QUALIFICATION_SOURCE_MISMATCH"),
            ("unchanged-source",baseline,baseline,["src"],None),
        ]
        repo=str(uuid.uuid4())
        prepared=[]
        for key,head,base,scope,expected in cases:
            branch="refs/heads/probe-"+key
            git("update-ref",branch,baseline if key=="postsubmit-head-amendment" else head)
            prepared.append(dict(key=key,head=head,base=base,scope=scope,expected=expected,branch=branch))
        program="""
const m=await import('./services/hyperfide/dist/assurance/submission.js');
const cases=%s,repository=%s,repo=%s;
const ctx={env:{HF_QUALIFICATION_REPOSITORIES:JSON.stringify({[repo]:repository})}};
for(const c of cases){
 let code=null,facts=null;
 try{facts=await m.submittedGitFacts(ctx,{repository_id:repo,source_object_id:c.head},
 {repository_id:repo,source_object_id:c.base},{branch_ref:c.branch},c.scope);}
 catch(error){code=error.code??error.name;}
 const valid=code===c.expected&&(code!==null||facts.source_object_id===c.head&&facts.baseline_source_object_id===c.base&&
 /^([0-9a-f]{40}|[0-9a-f]{64})$/.test(facts.source_tree_id)&&facts.changed_path_count>=0&&facts.owned_scope_digest===m.hash(c.scope));
 console.log(JSON.stringify({key:c.key,valid}));
}
""" % (json.dumps(prepared),json.dumps(str(location)),json.dumps(repo))
        rows=node(program)
        if len(rows)!=len(cases):raise AssertionError("Incomplete actual Git probe inventory")
        for row in rows:emit("assurance.16.1.git."+row["key"],row["valid"])


    finally:
        shutil.rmtree(location)
        (directory()/("git-absence-"+TASK+".json")).write_text(json.dumps({
            "observed_absent":not location.exists(),"observer":"owned temporary Git directory after removal"})+"\n")


def preparation_cases():
    import tempfile
    import shutil
    location=Path(tempfile.mkdtemp(prefix="hyperfide-assurance-preparation-"))
    (directory()/("preparation-resource-"+TASK+".json")).write_text(json.dumps({"path":str(location)}))
    try:
        def git(*args):
            return subprocess.run(["git","-c","core.hooksPath=/dev/null","-c","maintenance.auto=false","-c","gc.auto=0",*args],cwd=location,
                env=dict(os.environ,GIT_CONFIG_NOSYSTEM="1",GIT_CONFIG_GLOBAL="/dev/null"),
                text=True,capture_output=True,check=True,timeout=15).stdout.strip()
        git("init","-q");git("config","user.name","Bounded preparation test");git("config","user.email","fixture@example.invalid")
        (location/"source").write_text("baseline\n");git("add","source");git("commit","-qm","baseline")
        baseline=git("rev-parse","HEAD")
        (location/"source").write_text("actual result\n");git("add","source");git("commit","-qm","result")
        result=git("rev-parse","HEAD");repo=str(uuid.uuid4())
        # Metadata-only pure transformation against real fixture file bytes.
        # Random custody IDs here grant no primary or execution authority.
        import importlib.util
        spec=importlib.util.spec_from_file_location("preparation_fixture",ROOT/"tests/hyperfide/cases/tasks/11_1.py")
        support=importlib.util.module_from_spec(spec);spec.loader.exec_module(support)
        profile_base=location/"profile-data";profile_base.mkdir()
        fixture=support.Fixture(profile_base)
        profile=fixture.profile
        profile["repositories"][0]["commit"]=baseline
        files=[]
        for file in sorted(fixture.candidate.rglob("*")):
            if file.is_file():
                files.append({"path":str(file.relative_to(fixture.candidate)),"mode":file.stat().st_mode&0o777,
                    "size":str(file.stat().st_size),"digest":support.digest(file.read_bytes())})
        manifest={"schema_version":1,"profile":profile,"files":files,"directories":[],"scan":{}}
        manifest["digest"]=support.digest(support.canonical(manifest))
        measurement={"repository_id":repo,"source_object_id":result,"source_tree_id":git("rev-parse",result+"^{tree}"),
            "submodules":[],"file_pins":[profile["recipe"],*profile["preparation_evidence"],
                *[pin for manager in profile["package_managers"] for pin in manager["locks"]]]}
        measurement_bytes=support.canonical(measurement)+b"\n"
        measured=dict(measurement,observation_artifact_digest=support.digest(measurement_bytes))
        context={"parent_profile_id":str(uuid.uuid4()),"parent_preparation_manifest":manifest,
            "result":{"custody_id":str(uuid.uuid4()),"custody_generation":"1","binding_digest":"sha256:"+"b"*64,
                "source_manifest_artifact_id":str(uuid.uuid4()),"source_manifest_digest":"sha256:"+"c"*64,
                "repository_id":repo,"source_object_id":result,"source_tree_id":measurement["source_tree_id"]},
            "repository_binding":{"repository_id":repo,"repository_key":"fixture","repository_url":profile["repositories"][0]["url"]}}
        program="""
const m=await import('./services/hyperfide/dist/assurance/preparation.js');
const context=%s,measured=%s,bytes=Buffer.from(%s,'base64'),derived=%s;
const positive=m.rederiveResultProfile(context,measured,derived,bytes);
console.log(JSON.stringify({key:'exact-retained-bytes',valid:positive.requires_preparation===true&&positive.readiness_granted===false&&
 positive.profile.repositories[0].commit===context.result.source_object_id&&positive.lineage.parent_profile_id===context.parent_profile_id&&
 positive.lineage.parent_profile_key===context.parent_preparation_manifest.profile.profile_id}));
for(const [key,changed,raw] of [
 ['missing-newline',measured,bytes.subarray(0,-1)],
 ['field-relabel',{...measured,source_object_id:'f'.repeat(40)},bytes],
 ['malformed-utf8',measured,Buffer.from([255])]
]){
 let code=null;try{m.rederiveResultProfile(context,changed,derived,raw);}catch(error){code=error.code??error.message;}
 console.log(JSON.stringify({key,valid:code==='QUALIFICATION_MEASUREMENT_INTEGRITY'}));
}
""" % (json.dumps(context),json.dumps(measured),json.dumps(__import__("base64").b64encode(measurement_bytes).decode()),json.dumps(str(uuid.uuid4())))
        rows=node(program)
        if len(rows)!=4:raise AssertionError("Incomplete measurement readback inventory")
        for row in rows:emit("assurance.16.2.preparation."+row["key"],row["valid"])
    finally:
        shutil.rmtree(location)
        (directory()/("preparation-absence-"+TASK+".json")).write_text(json.dumps({
            "observed_absent":not location.exists(),"observer":"owned pure preparation fixture after removal"})+"\n")

def cleanup_preparation():
    if TASK!="16.2":return []
    record=directory()/("preparation-resource-"+TASK+".json")
    if not record.exists():return []
    location=Path(json.loads(record.read_text())["path"])
    import tempfile
    if location.parent!=Path(tempfile.gettempdir()) or not location.name.startswith("hyperfide-assurance-preparation-"):
        raise ValueError("Unowned preparation fixture path")
    absent=not location.exists()
    return [{"id":"hf-task-16.2-preparation","status":"deleted" if absent else "unknown",
        "observed_absent":absent,"evidence_artifact":"assurance/preparation-absence-16.2.json"}]

def cleanup_git():
    if TASK!="16.1":return []
    record=directory()/("git-resource-"+TASK+".json")
    if not record.exists():return []
    location=Path(json.loads(record.read_text())["path"])
    import tempfile
    if location.parent!=Path(tempfile.gettempdir()) or not location.name.startswith("hyperfide-assurance-git-"):
        raise ValueError("Unowned Git fixture path")
    absent=not location.exists()
    return [{"id":"hf-task-16.1-git","status":"deleted" if absent else "unknown",
        "observed_absent":absent,"evidence_artifact":"assurance/git-absence-16.1.json"}]

SUBMISSION_TASKS=("q1","q2","q3")

def submission_record():
    return directory()/("submission-resource-"+TASK+".json")

def submission_cases():
    """Positive and racing worker submissions through the production signed HTTPS service.

    Compute authority comes from an actual signed scheduler claim and packet; the accepted spec,
    task definitions and proof registries are trusted fixture preconditions written before start.
    """
    import base64,copy,hashlib,importlib.util,shutil,tempfile,threading,time
    def load(name,relative):
        spec=importlib.util.spec_from_file_location(name,ROOT/relative)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
    scheduler=load("hf16_scheduler_fixture","tests/hyperfide/cases/tasks/5_1.py")
    objects=load("hf16_object_fixture","tests/hyperfide/cases/tasks/15_2.py")
    uid,identity=scheduler.uid,scheduler.identity
    def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()
    record=submission_record()
    repository=Path(tempfile.mkdtemp(prefix="hyperfide-assurance-submit-"))
    state={"repository":str(repository),"database":None,"runtime_role":None,"folder":None,"pid":None,"start":None,"port":None,"closed":False}
    record.write_text(json.dumps(state))
    def git(*args):
        return subprocess.run(["git","-c","core.hooksPath=/dev/null","-c","maintenance.auto=false","-c","gc.auto=0",*args],cwd=repository,
            env=dict(os.environ,GIT_CONFIG_NOSYSTEM="1",GIT_CONFIG_GLOBAL="/dev/null"),text=True,capture_output=True,check=True,timeout=15).stdout.strip()
    git("init","-q");git("config","user.name","Bounded submission test");git("config","user.email","fixture@example.invalid")
    (repository/"README").write_text("accepted baseline\n");git("add","--all");git("commit","-qm","accepted baseline")
    baseline=git("rev-parse","HEAD");heads={}
    for name in SUBMISSION_TASKS:
        git("checkout","-q","--detach",baseline);(repository/"src").mkdir(exist_ok=True)
        (repository/"src"/(name+".ts")).write_text("actual result "+name+"\n");git("add","--all");git("commit","-qm","result "+name)
        heads[name]=git("rev-parse","HEAD");git("update-ref","refs/heads/attempt-"+name,heads[name])
    git("checkout","-q","--detach",baseline)
    for name in SUBMISSION_TASKS:git("worktree","add","-q","--detach",str(repository/"worktrees"/name),heads[name])
    store=objects.ObjectFixture()
    def setup(f):
        i=f.ids;scope={"organisation_id":i["organisation"],"run_id":i["run"]}
        objects.ORG=scope["organisation_id"];objects.RUN=scope["run_id"];objects.SCOPE=scope
        f.env.update({"HF_ARTIFACT_S3_ENDPOINT":store.endpoint,"HF_ARTIFACT_ALLOW_LOOPBACK_HTTP":"1","HF_ARTIFACT_S3_REGION":objects.REGION,
            "HF_ARTIFACT_S3_BUCKET":objects.BUCKET,"HF_ARTIFACT_S3_ACCESS_KEY_ID":objects.KEY,"HF_ARTIFACT_S3_SECRET_ACCESS_KEY":objects.SECRET,
            "HF_ARTIFACT_S3_SESSION_TOKEN":objects.TOKEN,"HF_ARTIFACT_ORGANISATION_ID":scope["organisation_id"],
            "HF_ARTIFACT_ALLOWED_RUN_IDS":json.dumps([scope["run_id"]]),"HF_QUALIFICATION_REPOSITORIES":json.dumps({i["repository"]:str(repository)})})
        executable=str(Path("/usr/bin/python3").resolve())
        check={"id":"unit","argv":[executable,"-c","raise SystemExit(0)"],"executable_digest":sha(Path(executable).read_bytes()),
            "timeout_ms":60000,"required_artifacts":["report.json"],"input_keys":["source"]}
        rubric=sha(b"submission-rubric")
        source=('[meta]\nslug = "submission-fixture"\n[req.16]\nac_1 = "Independent qualification of immutable worker submissions"\n'
            '[acceptance.V-013]\nreqs = ["16.1"]\nchecks = ["unit"]\n[proof]\nrubric_digest = '+json.dumps(rubric)+'\n[proof.check.unit]\n'+
            "".join(key+" = "+json.dumps(check[key])+"\n" for key in ("argv","executable_digest","timeout_ms","required_artifacts","input_keys")))
        for name in SUBMISSION_TASKS:
            source+='[task.'+name+']\nwave = 1\nreqs = ["16.1"]\nacceptance_ids = ["V-013"]\nrequires = []\ntouches = ["src/'+name+'.ts"]\n'
        parsed=json.loads(subprocess.check_output(["node","--input-type=module","-e","import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT,timeout=30))
        spec=uid();i["submission_spec"]=spec
        intent={"schema_version":1,"revision_digest":sha(b"submission-envelope-"+spec.encode()),"source_digest":sha(source.encode()),
            "repositories":[{"repository_id":i["repository"],"source_object_id":baseline,"integration_ref":"refs/heads/main"}],"allowed_actions":f.actions,
            "closure_policy":{"required_evidence":["unit"],"required_review_roles":[],"publication":"AFTER_QUALIFICATION"},"provenance":None,"parsed":parsed,"runtime_wave_offset":0}
        f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",
            [i["organisation"],i["project"],spec,sha(source.encode()),source,json.dumps(intent),intent["revision_digest"]])
        f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)",[i["organisation"],i["run"],spec])
        f.sql("UPDATE hyperfide.runs SET spec_generation=2,spec_revision_id=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"],spec])
        sections={section["name"]:section for section in parsed["sections"]}
        f.submission_criteria={}
        for name in SUBMISSION_TASKS:
            task,slot=uid(),uid();i["task_"+name]=task;i["slot_"+name]=slot
            definition=copy.deepcopy(f.packet_definition);definition.update(feature_key="alpha",touches=["src/"+name+".ts"],section=sections["task."+name])
            f.definitions[name]=definition
            criteria=sha(("accepted-submission-criteria-"+name).encode());f.submission_criteria[name]=criteria
            f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,2,$7,$8,1)",
                [i["organisation"],i["run"],task,"alpha.submit-"+name,i["package"],spec,criteria,json.dumps(definition)])
            f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,$4,1,'AGENT','READY')",
                [i["organisation"],slot,i["sandbox"],"submit-"+name])
            policy={"schema_version":1,"criteria_digest":criteria,"spec_revision_id":spec,"spec_generation":"2","repository_id":i["repository"],"source_object_id":baseline,
                "rubric_digest":rubric,"checks":[check],"clauses":[{"id":"16.1","mode":"EXECUTABLE","acceptance_ids":["V-013"],"checks":["unit"]}],
                "inputs":{key:sha(("accepted-"+key).encode()) for key in ("source","dependency","toolchain","configuration","graph","contract")},"contract_digests":[]}
            f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,2,$4,$5,$6,$7)",
                [i["organisation"],i["run"],task,spec,criteria,identity(policy),json.dumps(policy)])
    class OwnedScheduler(scheduler.SchedulerFixture):
        def start(self):
            try:super().start()
            finally:self.remember()
        def remember(self):
            for key,value in (("database",getattr(self,"database",None)),("runtime_role",getattr(self,"runtime_role",None)),
                              ("folder",str(getattr(self,"path","")) or None),("port",getattr(self,"port",None))):
                if value is not None:state[key]=value
            child=getattr(self,"child",None)
            if child is not None:
                state["pid"]=child.pid
                try:state["start"]=Path("/proc/"+str(child.pid)+"/stat").read_text().rsplit(")",1)[1].split()[19]
                except FileNotFoundError:pass
            record.write_text(json.dumps(state))
    f=None
    try:
        try:
            f=OwnedScheduler(extra_components=("16.1","16.2"),extra_setup=setup,source_object_id=baseline,agent_limit=6)
        finally:
            if f is None:state["closed"]=True;record.write_text(json.dumps(state))
        i=f.ids;org,run=i["organisation"],i["run"]
        f.bind=lambda:f.invoke("identity.binding.observe",{"provisioning_intent_id":i["intent"],"sandbox_id":i["sandbox"],"boot_generation":"1","boot_id":i["boot"],
            "native_sandbox_id":"packet-fixture-resource","observation_digest":sha(b"provider-observation"),"expected_version":"1"},key="provisioner")
        f.bootstrap_runner()
        def put(data):
            value=dict(organisation_id=org,run_id=run,digest=sha(data),size_bytes=str(len(data)),data_base64=base64.b64encode(data).decode(),
                       retention_class="RUN",retention_until=None,retention_hold=False)
            return f.ok("artifact.object.put",value,component="15.2",key="operator")["artifact"]["artifact_id"]
        def code(response):return response.get("error",{}).get("code") if response.get("ok") is False else None
        def scalar(text,values):return f.sql(text,values)[0]
        attempts={}
        def claim(name,lease_ms=300000):
            request=f.prepare_claim(name,lease_ms);request.update(run_spec_generation="2",spec_generation="2",spec_revision_id=i["submission_spec"])
            token=f.claim(name,request=request)["token"]
            workspace,session=uid(),uid()
            f.sql("INSERT INTO hyperfide.workspaces(organisation_id,run_id,id,repository_id,attempt_id,attempt_generation,sandbox_id,slot_id,sandbox_boot_generation,base_commit,branch_ref,workspace_path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
                [org,run,workspace,i["repository"],token["attempt_id"],token["attempt_generation"],token["sandbox_id"],token["slot_id"],token["sandbox_boot_generation"],baseline,"refs/heads/attempt-"+name,str(repository/"worktrees"/name)])
            f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id,state) VALUES($1,$2,$3,'WORKER',$4,'fixture','fixture',$5,$6,$7,1,$8,'RUNNING')",
                [org,run,session,i["manager"],"worker-"+name,token["slot_id"],token["sandbox_id"],token["attempt_id"]])
            f.delegate_principal("worker_"+name,session)
            log=put(json.dumps({"check":"unit","exit_code":0,"task":name}).encode()+b"\n")
            source=json.dumps({"repository_id":i["repository"],"source_object_id":heads[name],"workspace_id":workspace}).encode()
            evidence=json.dumps({"source_object_id":heads[name],"criteria_digest":f.submission_criteria[name],"artifact_ids":[log]}).encode()
            attempts[name]={"token":token,"workspace":workspace,"session":session,"log":log,"source_bytes":source,"evidence_bytes":evidence,
                            "source":put(source),"evidence":put(evidence)}
            return attempts[name]
        def submission(name,**changes):
            a=attempts[name];t=a["token"]
            value={"organisation_id":org,"run_id":run,"task_id":t["task_id"],"request_id":uid(),"attempt_id":t["attempt_id"],"attempt_generation":t["attempt_generation"],
                "authority_epoch":t["authority_epoch"],"sandbox_id":t["sandbox_id"],"slot_id":t["slot_id"],"sandbox_boot_generation":t["sandbox_boot_generation"],
                "repository_id":i["repository"],"source_object_id":heads[name],"source_manifest_artifact_id":a["source"],"evidence_manifest_artifact_id":a["evidence"],
                "criteria_digest":f.submission_criteria[name],"contract_digests":[]}
            value.update(changes);return value
        def envelope(name,value,operation_id=None):
            operation=f.operation("16.1","submission.submit",value,authority=f.authorities["worker_"+name])
            operation["idempotency_key"]=value["request_id"]
            if operation_id:operation["operation_id"]=operation_id
            return operation
        def send(name,operation):return f.request(operation,key="worker_"+name)[1]
        def submit(name,value):return send(name,envelope(name,value))
        def custodies(name):return int(scalar("SELECT count(*)::int AS n FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3",[org,run,i["task_"+name]])["n"])
        def attempt_state(name):
            t=attempts[name]["token"]
            return scalar("SELECT a.compute_authority,a.execution_state,(SELECT string_agg(l.state,',' ORDER BY l.state) FROM hyperfide.compute_leases l WHERE l.organisation_id=a.organisation_id AND l.run_id=a.run_id AND l.attempt_id=a.id) AS leases FROM hyperfide.attempts a WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3",[org,run,t["attempt_id"]])
        # V-013 refusals precede admission on the same current compute generation.
        a=claim("q1")
        fabricated=put(json.dumps({"source_object_id":heads["q1"],"criteria_digest":f.submission_criteria["q1"],"artifact_ids":[str(uuid.uuid4())]}).encode())
        emit("assurance.16.1.submit.fabricated-evidence-refused",code(submit("q1",submission("q1",evidence_manifest_artifact_id=fabricated))),"QUALIFICATION_ARTIFACT_INCOMPLETE")
        empty=put(json.dumps({"source_object_id":heads["q1"],"criteria_digest":f.submission_criteria["q1"],"artifact_ids":[]}).encode())
        emit("assurance.16.1.submit.empty-evidence-refused",code(submit("q1",submission("q1",evidence_manifest_artifact_id=empty))),"QUALIFICATION_MANIFEST_INVALID")
        stale_source=put(json.dumps({"repository_id":i["repository"],"source_object_id":baseline,"workspace_id":a["workspace"]}).encode())
        stale_evidence=put(json.dumps({"source_object_id":baseline,"criteria_digest":f.submission_criteria["q1"],"artifact_ids":[a["log"]]}).encode())
        emit("assurance.16.1.submit.mismatched-revision-refused",code(submit("q1",submission("q1",source_object_id=baseline,source_manifest_artifact_id=stale_source,evidence_manifest_artifact_id=stale_evidence))),"QUALIFICATION_SOURCE_MISMATCH")
        emit("assurance.16.1.submit.criteria-mismatch-refused",code(submit("q1",submission("q1",criteria_digest=sha(b"different-criteria")))),"QUALIFICATION_MANIFEST_INVALID")
        emit("assurance.16.1.submit.stale-generation-refused",code(submit("q1",submission("q1",attempt_generation="2"))),"QUALIFICATION_STALE_COMPUTE")
        emit("assurance.16.1.submit.refusals-leave-compute",{"custodies":custodies("q1"),**attempt_state("q1")},{"custodies":0,"compute_authority":"CURRENT","execution_state":"RESERVED","leases":"ACTIVE"})
        accepted=submission("q1");first=envelope("q1",accepted);response=send("q1",first)
        result=response.get("result",{})
        custody=result.get("submission",{}).get("id");job=result.get("job_id")
        emit("assurance.16.1.submit.admitted",{"ok":response.get("ok"),"authority":result.get("submission",{}).get("authority"),"outcome":result.get("submission",{}).get("qualification_outcome"),
             "qualification":result.get("qualification"),"replayed":result.get("replayed"),"job":isinstance(job,str)},
             {"ok":True,"authority":"ACTIVE","outcome":"PENDING","qualification":"PENDING","replayed":False,"job":True})
        emit("assurance.16.1.submit.compute-released",{**attempt_state("q1"),**scalar("SELECT state,current_custody_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,i["task_q1"]])},
             {"compute_authority":"RELEASED","execution_state":"SUBMITTED","leases":"RELEASED","state":"SUBMITTED","current_custody_id":custody})
        bound=scalar("SELECT c.authority,c.qualification_outcome,c.source_object_id,c.source_manifest_digest,c.evidence_manifest_digest,c.criteria_digest,c.source_attempt_id,c.source_generation::text,"
            "j.state AS job_state,j.custody_generation::text AS job_generation,s.request_id,s.source_artifact_id,s.evidence_artifact_id FROM hyperfide.submission_custodies c "
            "JOIN hyperfide.qualification_jobs j ON j.organisation_id=c.organisation_id AND j.run_id=c.run_id AND j.custody_id=c.id "
            "JOIN hyperfide.assurance_submissions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.custody_id=c.id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3 AND j.id=$4",[org,run,custody,job])
        emit("assurance.16.1.submit.immutable-binding",bound,{"authority":"ACTIVE","qualification_outcome":"PENDING","source_object_id":heads["q1"],"source_manifest_digest":sha(a["source_bytes"]),
             "evidence_manifest_digest":sha(a["evidence_bytes"]),"criteria_digest":f.submission_criteria["q1"],"source_attempt_id":a["token"]["attempt_id"],"source_generation":"1",
             "job_state":"PENDING","job_generation":"1","request_id":accepted["request_id"],"source_artifact_id":a["source"],"evidence_artifact_id":a["evidence"]})
        lost=send("q1",first)
        emit("assurance.16.1.submit.lost-response-replay",{"ok":lost.get("ok"),"custody":lost.get("result",{}).get("submission",{}).get("id"),"custodies":custodies("q1")},{"ok":True,"custody":custody,"custodies":1})
        replay=send("q1",envelope("q1",accepted))
        emit("assurance.16.1.submit.exact-replay",{"ok":replay.get("ok"),"custody":replay.get("result",{}).get("submission",{}).get("id"),"replayed":replay.get("result",{}).get("replayed"),"custodies":custodies("q1")},
             {"ok":True,"custody":custody,"replayed":True,"custodies":1})
        emit("assurance.16.1.submit.conflicting-replay",code(submit("q1",dict(accepted,criteria_digest=sha(b"conflicting-bytes")))),"QUALIFICATION_IDEMPOTENCY_CONFLICT")
        emit("assurance.16.1.submit.released-compute-cannot-resubmit",code(submit("q1",submission("q1"))),"AUTH_STALE_ATTEMPT")
        # do_2: worker completion text/exit codes and the coding sandbox cannot qualify the submission.
        job_version=scalar("SELECT state_version::text AS v FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,job])["v"]
        status,claimed=f.invoke("qualification.job.claim",{"organisation_id":org,"run_id":run,"job_id":job,"expected_state_version":job_version},component="16.2",key="worker_q1")
        emit("assurance.16.1.independence.coding-worker-claim-refused",{"refused":claimed.get("ok") is False,"code":code(claimed)},{"refused":True,"code":"QUALIFICATION_ROLE_DENIED"})
        status,assigned=f.invoke("qualification.job.assign",{"organisation_id":org,"run_id":run,"job_id":job,"expected_state_version":job_version,"verifier_id":a["session"],
            "sandbox_id":a["token"]["sandbox_id"],"slot_id":a["token"]["slot_id"],"sandbox_boot_generation":"1","reservation_id":uid(),"environment_digest":sha(b"coding-sandbox")},component="16.2",key="operator")
        emit("assurance.16.1.independence.coding-sandbox-assign-refused",{"refused":assigned.get("ok") is False,"code":code(assigned)},{"refused":True,"code":"QUALIFICATION_RESULT_PREPARATION_REQUIRED"})
        status,revoked=f.invoke("submission.revoke",{"organisation_id":org,"run_id":run,"submission_id":custody,"custody_generation":"1","expected_state_version":"1","reason":"worker claims completion"},component="16.1",key="worker_q1")
        emit("assurance.16.1.independence.worker-disposition-denied",code(revoked),"QUALIFICATION_ROLE_DENIED")
        emit("assurance.16.1.independence.outcome-pending",{**scalar("SELECT c.authority,c.qualification_outcome,j.state,j.lease_owner FROM hyperfide.submission_custodies c JOIN hyperfide.qualification_jobs j ON j.organisation_id=c.organisation_id AND j.run_id=c.run_id AND j.custody_id=c.id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3",[org,run,custody]),
             "assignments":int(scalar("SELECT count(*)::int AS n FROM hyperfide.assurance_job_assignments WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3",[org,run,job])["n"])},
             {"authority":"ACTIVE","qualification_outcome":"PENDING","state":"PENDING","lease_owner":None,"assignments":0})
        # do_3 races: concurrent identical admission, expiry sweeper and coding cleanup.
        claim("q2");value=submission("q2");responses=[None]*4
        def racer(index):responses[index]=send("q2",envelope("q2",value))
        threads=[threading.Thread(target=racer,args=(index,)) for index in range(len(responses))]
        for thread in threads:thread.start()
        for thread in threads:thread.join(60)
        ids={row.get("result",{}).get("submission",{}).get("id") for row in responses if row and row.get("ok")}
        emit("assurance.16.1.race.concurrent-identical",{"custodies":custodies("q2"),"distinct_admitted":len(ids),"jobs":int(scalar("SELECT count(*)::int AS n FROM hyperfide.qualification_jobs j JOIN hyperfide.submission_custodies c ON c.organisation_id=j.organisation_id AND c.run_id=j.run_id AND c.id=j.custody_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.task_id=$3",[org,run,i["task_q2"]])["n"])},
             {"custodies":1,"distinct_admitted":1,"jobs":1})
        lease_ms=6000
        claim("q3",lease_ms=lease_ms)
        expires=scalar("SELECT extract(epoch FROM lease_expires_at-clock_timestamp())::float8 AS s FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,attempts["q3"]["token"]["attempt_id"]])["s"]
        deadline=time.monotonic()+float(expires);race={}
        def late_submit():
            time.sleep(max(0,deadline-time.monotonic()-0.25));race["submit"]=submit("q3",submission("q3"))
        def sweeper():
            time.sleep(max(0,deadline-time.monotonic()));race["expired"]=[]
            stop=time.monotonic()+5
            while time.monotonic()<stop:
                swept=f.ok("scheduler.compute.expire",{"organisation_id":org,"run_id":run,"authority_epoch":i["epoch"],"leader_generation":"1"},component="5.2",key="leader")
                race["expired"]+=swept["expired_attempt_ids"]
                if attempts["q3"]["token"]["attempt_id"] in race["expired"] or race.get("submit",{}).get("ok"):break
                time.sleep(.05)
        threads=[threading.Thread(target=late_submit),threading.Thread(target=sweeper)]
        for thread in threads:thread.start()
        for thread in threads:thread.join(60)
        observed=attempt_state("q3");winner=race.get("submit",{})
        if winner.get("ok"):
            outcome={"admitted":True,"custodies":custodies("q3"),"compute":observed["compute_authority"],"custody":scalar("SELECT authority FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3",[org,run,i["task_q3"]])["authority"]}
            consistent=outcome=={"admitted":True,"custodies":1,"compute":"RELEASED","custody":"ACTIVE"} and attempts["q3"]["token"]["attempt_id"] not in race["expired"]
        else:
            outcome={"admitted":False,"code":code(winner),"custodies":custodies("q3"),"compute":observed["compute_authority"]}
            consistent=outcome["code"] in ("QUALIFICATION_STALE_COMPUTE","AUTH_STALE_ATTEMPT","AUTH_EXPIRED") and outcome["custodies"]==0 and outcome["compute"]=="EXPIRED"
        print(json.dumps({"type":"observation","id":"assurance.16.1.race.expiry-sweeper","outcome":outcome}),flush=True)
        emit("assurance.16.1.race.expiry-sweeper",consistent)
        swept=f.ok("scheduler.compute.expire",{"organisation_id":org,"run_id":run,"authority_epoch":i["epoch"],"leader_generation":"1"},component="5.2",key="leader")
        emit("assurance.16.1.race.expiry-after-admission",{"swept_admitted":attempts["q1"]["token"]["attempt_id"] in swept["expired_attempt_ids"],
             **scalar("SELECT authority,qualification_outcome FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,custody]),**attempt_state("q1")},
             {"swept_admitted":False,"authority":"ACTIVE","qualification_outcome":"PENDING","compute_authority":"RELEASED","execution_state":"SUBMITTED","leases":"RELEASED"})
        t=attempts["q1"]["token"]
        status,cancelled=f.invoke("scheduler.compute.cancel",{"token":t,"request_id":uid(),"leader_generation":"1","package_generation":"2"},component="5.2",key="manager")
        # Trusted provider-observation precondition: the coding slot is drained and the coding sandbox is gone.
        f.sql("UPDATE hyperfide.agent_sessions SET state='STOPPED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,attempts["q1"]["session"]])
        f.sql("UPDATE hyperfide.sandboxes SET desired_state='DESTROYED',observed_state='DESTROYED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,i["sandbox"]])
        status,inspected=f.invoke("submission.inspect",{"organisation_id":org,"run_id":run,"submission_id":custody},component="16.1",key="operator")
        status,after_cleanup=f.invoke("submission.submit",accepted,component="16.1",key="worker_q1")
        emit("assurance.16.1.race.coding-cleanup-preserves-custody",{"cancel_refused":cancelled.get("ok") is False,"authority":inspected.get("result",{}).get("authority"),
             "outcome":inspected.get("result",{}).get("qualification_outcome"),"job":scalar("SELECT state FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,job])["state"],
             "worker_refused":after_cleanup.get("ok") is False},{"cancel_refused":True,"authority":"ACTIVE","outcome":"PENDING","job":"PENDING","worker_refused":True})
        print(json.dumps({"type":"observation","id":"assurance.16.1.submission.codes","cancel":code(cancelled),"after_cleanup":code(after_cleanup)}),flush=True)
    finally:
        try:
            if f is not None:f.close()
        finally:
            state["closed"]=True;record.write_text(json.dumps(state))
            store.http.shutdown();store.sink.shutdown();store.http.server_close();store.sink.server_close()
            shutil.rmtree(repository,ignore_errors=True)

def cleanup_submission():
    if TASK!="16.1":return []
    record=submission_record()
    if not record.exists():return []
    import re,shutil,signal,socket,tempfile,time
    state=json.loads(record.read_text())
    pid,start=state.get("pid"),state.get("start")
    def current():
        if pid is None:return False
        try:return Path("/proc/"+str(pid)+"/stat").read_text().rsplit(")",1)[1].split()[19]==start
        except FileNotFoundError:return False
    if current():
        command=Path("/proc/"+str(pid)+"/cmdline").read_bytes()
        if b"/services/hyperfide/dist/" not in command:raise ValueError("Unowned submission service process")
        os.kill(pid,signal.SIGTERM)
        for _ in range(80):
            if not current():break
            time.sleep(.1)
        if current():os.kill(pid,signal.SIGKILL)
    stopped=not current()
    if state.get("port"):
        with socket.socket() as observer:
            observer.settimeout(.5);stopped=stopped and observer.connect_ex(("127.0.0.1",state["port"]))!=0
    database,role=state.get("database"),state.get("runtime_role")
    if database:
        if not re.fullmatch(r"hf_identity_[0-9a-f]{32}",database):raise ValueError("Unowned submission database")
        subprocess.run(["dropdb","--force","--if-exists",database],cwd=ROOT,check=True,capture_output=True,timeout=45)
    database_absent=database is None or sql("SELECT count(*) FROM pg_database WHERE datname='"+database+"';","postgres").stdout.strip()=="0"
    if role:
        if not re.fullmatch(r"hf_ir_[0-9a-f]{32}",role):raise ValueError("Unowned submission runtime role")
        sql('DROP ROLE IF EXISTS "'+role+'"',"postgres")
    role_absent=role is None or sql("SELECT count(*) FROM pg_roles WHERE rolname='"+role+"';","postgres").stdout.strip()=="0"
    paths=[]
    for key,prefix in (("folder","hyperfide-identity-"),("repository","hyperfide-assurance-submit-")):
        if state.get(key):
            location=Path(state[key])
            if location.parent!=Path(tempfile.gettempdir()) or not location.name.startswith(prefix) or location.is_symlink():raise ValueError("Unowned submission fixture path")
            if stopped and location.exists():shutil.rmtree(location)
            paths.append(location)
    files_absent=all(not location.exists() for location in paths)
    artifact="assurance/submission-absence-"+TASK+".json"
    (directory()/("submission-absence-"+TASK+".json")).write_text(json.dumps({"database":database,"database_observed_absent":database_absent,"service_observed_absent":stopped,
        "runtime_role_observed_absent":role_absent,"fixture_files_observed_absent":files_absent,"paths":[str(location) for location in paths],
        "observer":"PostgreSQL pg_database/pg_roles, exact service PID/start identity, listener probe and owned temporary paths"})+"\n")
    def row(key,absent):return {"id":"hf-task-16.1-submission-"+key,"status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":artifact}
    return [row("database",database_absent),row("service",stopped),row("role",role_absent),row("files",files_absent)]

def schema_cases():
    global DATABASE, RESOURCE
    DATABASE="hf_16_bounded_"+uuid.uuid4().hex[:16]
    RESOURCE="hf-task-"+TASK+"-database"
    (directory()/("resource-"+TASK+".json")).write_text(json.dumps({"database":DATABASE,"resource":RESOURCE})+"\n")
    subprocess.run(["createdb",DATABASE],cwd=ROOT,check=True,capture_output=True,timeout=30)
    for name in ["0001-authority.sql","0004-durability.sql","0016-qualification.sql"]:
        sql((ROOT/"services/hyperfide/migrations"/name).read_text())
    emit("assurance.16.1.schema.applied", sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='hyperfide' AND table_name LIKE 'assurance_%';").stdout.strip()=="13")
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
            git_cases()
            submission_cases()
        if TASK=="16.2":preparation_cases()
        primary_cases()
        signed_cases()
        passed=True
    finally:
        absent=cleanup(report=False)
        (directory()/("observations-"+TASK+".json")).write_text(json.dumps({
            "scope":"bounded-auth-and-ledger","physical_execution_qualification":"NOT_EVALUATED",
            "positive_submission_qualification":"BOUNDED_SIGNED_HTTPS_ADMISSION" if TASK=="16.1" else "NOT_EVALUATED","assertions":OBSERVATIONS},indent=2)+"\n")
    return 0 if passed and absent else 1

if __name__=="__main__":
    raise SystemExit(main())
