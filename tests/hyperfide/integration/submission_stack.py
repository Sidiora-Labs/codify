#!/usr/bin/env python3
"""Reusable task16.1 submission stack: a real signed scheduler claim plus immutable inputs.

Importing this module grants nothing. Compute authority comes only from the actual signed
scheduler claim and execution packet; the accepted spec revision, task definitions, proof
registries, workspaces and worker sessions are trusted fixture preconditions written through
the fixture's PostgreSQL superuser connection, never through a service handler.
"""
from __future__ import annotations
import base64,copy,hashlib,importlib.util,json,os,shutil,subprocess,tempfile,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]

def load(name,relative):
    spec=importlib.util.spec_from_file_location(name,ROOT/relative)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def uid():return str(uuid.uuid4())
def process_start(pid):
    try:return Path("/proc/"+str(pid)+"/stat").read_text().rsplit(")",1)[1].split()[19]
    except FileNotFoundError:return None

class SubmissionStack:
    """Owns one disposable database, signed control service, S3 object double and Git repository."""
    def __init__(self,record,tasks,extra_components=(),agent_limit=6,prefix="hyperfide-assurance-submit-",before_start=None):
        self.record=Path(record);self.tasks=tuple(tasks);self.attempts={};self.fixture=None;self.store=None
        self.scheduler=load("hf16_scheduler_fixture","tests/hyperfide/cases/tasks/5_1.py")
        self.objects=load("hf16_object_fixture","tests/hyperfide/cases/tasks/15_2.py")
        self.repository=Path(tempfile.mkdtemp(prefix=prefix))
        self.state={"repository":str(self.repository),"database":None,"runtime_role":None,"folder":None,"pid":None,"start":None,"port":None,"closed":False,"processes":[]}
        self.save()
        try:
            self.git("init","-q");self.git("config","user.name","Bounded submission test");self.git("config","user.email","fixture@example.invalid")
            (self.repository/"README").write_text("accepted baseline\n");self.git("add","--all");self.git("commit","-qm","accepted baseline")
            self.baseline=self.git("rev-parse","HEAD");self.heads={}
            for name in self.tasks:
                self.git("checkout","-q","--detach",self.baseline);(self.repository/"src").mkdir(exist_ok=True)
                (self.repository/"src"/(name+".ts")).write_text("actual result "+name+"\n");self.git("add","--all");self.git("commit","-qm","result "+name)
                self.heads[name]=self.git("rev-parse","HEAD");self.git("update-ref","refs/heads/attempt-"+name,self.heads[name])
            self.git("checkout","-q","--detach",self.baseline)
            for name in self.tasks:self.git("worktree","add","-q","--detach",str(self.repository/"worktrees"/name),self.heads[name])
            self.store=self.objects.ObjectFixture()
            stack=self
            class OwnedScheduler(self.scheduler.SchedulerFixture):
                def start(self):
                    try:super().start()
                    finally:stack.remember(self)
            def setup(f):
                self.setup(f)
                if before_start:before_start(f)
            try:
                self.fixture=OwnedScheduler(extra_components=("16.1","16.2")+tuple(extra_components),extra_setup=setup,source_object_id=self.baseline,agent_limit=agent_limit)
            finally:
                if self.fixture is None:self.state["closed"]=True;self.save()
            f=self.fixture;i=f.ids
            # PacketFixture replaces the identity fixture sandbox; bind the runner to the observed packet sandbox.
            f.bind=lambda:f.invoke("identity.binding.observe",{"provisioning_intent_id":i["intent"],"sandbox_id":i["sandbox"],"boot_generation":"1","boot_id":i["boot"],
                "native_sandbox_id":"packet-fixture-resource","observation_digest":sha(b"provider-observation"),"expected_version":"1"},key="provisioner")
            f.bootstrap_runner()
        except BaseException:
            self.close();raise
    def save(self):self.record.write_text(json.dumps(self.state))
    def remember(self,f):
        for key,value in (("database",getattr(f,"database",None)),("runtime_role",getattr(f,"runtime_role",None)),
                          ("folder",str(getattr(f,"path","")) or None),("port",getattr(f,"port",None))):
            if value is not None:self.state[key]=value
        child=getattr(f,"child",None)
        if child is not None:self.state["pid"]=child.pid;self.state["start"]=process_start(child.pid)
        self.save()
    def own_process(self,pid,label,port=None):
        """Record an additional owned process identity before it can outlive this probe."""
        self.state["processes"]=[row for row in self.state["processes"] if row["label"]!=label]+[{"label":label,"pid":pid,"start":process_start(pid),"port":port}]
        self.save()
    def own_path(self,path,prefix):
        self.state.setdefault("extra_paths",{})[str(path)]=prefix;self.save()
    def git(self,*args):
        return subprocess.run(["git","-c","core.hooksPath=/dev/null","-c","maintenance.auto=false","-c","gc.auto=0",*args],cwd=self.repository,
            env=dict(os.environ,GIT_CONFIG_NOSYSTEM="1",GIT_CONFIG_GLOBAL="/dev/null"),text=True,capture_output=True,check=True,timeout=15).stdout.strip()
    def setup(self,f):
        i=f.ids;objects=self.objects;scope={"organisation_id":i["organisation"],"run_id":i["run"]}
        objects.ORG=scope["organisation_id"];objects.RUN=scope["run_id"];objects.SCOPE=scope
        f.env.update({"HF_ARTIFACT_S3_ENDPOINT":self.store.endpoint,"HF_ARTIFACT_ALLOW_LOOPBACK_HTTP":"1","HF_ARTIFACT_S3_REGION":objects.REGION,
            "HF_ARTIFACT_S3_BUCKET":objects.BUCKET,"HF_ARTIFACT_S3_ACCESS_KEY_ID":objects.KEY,"HF_ARTIFACT_S3_SECRET_ACCESS_KEY":objects.SECRET,
            "HF_ARTIFACT_S3_SESSION_TOKEN":objects.TOKEN,"HF_ARTIFACT_ORGANISATION_ID":scope["organisation_id"],
            "HF_ARTIFACT_ALLOWED_RUN_IDS":json.dumps([scope["run_id"]]),"HF_QUALIFICATION_REPOSITORIES":json.dumps({i["repository"]:str(self.repository)})})
        executable=str(Path("/usr/bin/python3").resolve())
        check={"id":"unit","argv":[executable,"-c","raise SystemExit(0)"],"executable_digest":sha(Path(executable).read_bytes()),
            "timeout_ms":60000,"required_artifacts":["report.json"],"input_keys":["source"]}
        rubric=sha(b"submission-rubric")
        source=('[meta]\nslug = "submission-fixture"\n[req.16]\nac_1 = "Independent qualification of immutable worker submissions"\n'
            '[acceptance.V-013]\nreqs = ["16.1"]\nchecks = ["unit"]\n[proof]\nrubric_digest = '+json.dumps(rubric)+'\n[proof.check.unit]\n'+
            "".join(key+" = "+json.dumps(check[key])+"\n" for key in ("argv","executable_digest","timeout_ms","required_artifacts","input_keys")))
        for name in self.tasks:
            source+='[task.'+name+']\nwave = 1\nreqs = ["16.1"]\nacceptance_ids = ["V-013"]\nrequires = []\ntouches = ["src/'+name+'.ts"]\n'
        parsed=json.loads(subprocess.check_output(["node","--input-type=module","-e","import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT,timeout=30))
        spec=uid();i["submission_spec"]=spec
        self.spec_generation=self.scheduler.next_spec_generation(f)
        intent={"schema_version":1,"revision_digest":sha(b"submission-envelope-"+spec.encode()),"source_digest":sha(source.encode()),
            "repositories":[{"repository_id":i["repository"],"source_object_id":self.baseline,"integration_ref":"refs/heads/main"}],"allowed_actions":f.actions,
            "closure_policy":{"required_evidence":["unit"],"required_review_roles":[],"publication":"AFTER_QUALIFICATION"},"provenance":None,"parsed":parsed,"runtime_wave_offset":0}
        f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",
            [i["organisation"],i["project"],spec,sha(source.encode()),source,json.dumps(intent),intent["revision_digest"]])
        f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$4,$3)",[i["organisation"],i["run"],spec,self.spec_generation])
        f.sql("UPDATE hyperfide.runs SET spec_generation=$4,spec_revision_id=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[i["organisation"],i["run"],spec,self.spec_generation])
        sections={section["name"]:section for section in parsed["sections"]}
        f.submission_criteria={}
        for name in self.tasks:
            task,slot=uid(),uid();i["task_"+name]=task;i["slot_"+name]=slot
            definition=copy.deepcopy(f.packet_definition);definition.update(feature_key="alpha",touches=["src/"+name+".ts"],section=sections["task."+name])
            f.definitions[name]=definition
            criteria=sha(("accepted-submission-criteria-"+name).encode());f.submission_criteria[name]=criteria
            f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1)",
                [i["organisation"],i["run"],task,"alpha.submit-"+name,i["package"],spec,self.spec_generation,criteria,json.dumps(definition)])
            f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,$4,1,'AGENT','READY')",
                [i["organisation"],slot,i["sandbox"],"submit-"+name])
            policy={"schema_version":1,"criteria_digest":criteria,"spec_revision_id":spec,"spec_generation":self.spec_generation,"repository_id":i["repository"],"source_object_id":self.baseline,
                "rubric_digest":rubric,"checks":[check],"clauses":[{"id":"16.1","mode":"EXECUTABLE","acceptance_ids":["V-013"],"checks":["unit"]}],
                "inputs":{key:sha(("accepted-"+key).encode()) for key in ("source","dependency","toolchain","configuration","graph","contract")},"contract_digests":[]}
            f.sql("INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
                [i["organisation"],i["run"],task,self.spec_generation,spec,criteria,self.scheduler.identity(policy),json.dumps(policy)])
    # Signed HTTPS helpers.
    def put(self,data):
        i=self.fixture.ids
        value=dict(organisation_id=i["organisation"],run_id=i["run"],digest=sha(data),size_bytes=str(len(data)),data_base64=base64.b64encode(data).decode(),
                   retention_class="RUN",retention_until=None,retention_hold=False)
        return self.fixture.ok("artifact.object.put",value,component="15.2",key="operator")["artifact"]["artifact_id"]
    def claim(self,name,lease_ms=300000,upload=True):
        f=self.fixture;i=f.ids;org,run=i["organisation"],i["run"]
        request=f.prepare_claim(name,lease_ms);request.update(run_spec_generation=self.spec_generation,spec_generation=self.spec_generation,spec_revision_id=i["submission_spec"])
        token=f.claim(name,request=request)["token"]
        workspace,session=uid(),uid()
        f.sql("INSERT INTO hyperfide.workspaces(organisation_id,run_id,id,repository_id,attempt_id,attempt_generation,sandbox_id,slot_id,sandbox_boot_generation,base_commit,branch_ref,workspace_path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            [org,run,workspace,i["repository"],token["attempt_id"],token["attempt_generation"],token["sandbox_id"],token["slot_id"],token["sandbox_boot_generation"],self.baseline,"refs/heads/attempt-"+name,str(self.repository/"worktrees"/name)])
        f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id,state) VALUES($1,$2,$3,'WORKER',$4,'fixture','fixture',$5,$6,$7,1,$8,'RUNNING')",
            [org,run,session,i["manager"],"worker-"+name,token["slot_id"],token["sandbox_id"],token["attempt_id"]])
        f.delegate_principal("worker_"+name,session)
        attempt={"token":token,"workspace":workspace,"session":session,"request":request}
        if upload:
            attempt["log"]=self.put(json.dumps({"check":"unit","exit_code":0,"task":name}).encode()+b"\n")
            attempt["source_bytes"]=json.dumps({"repository_id":i["repository"],"source_object_id":self.heads[name],"workspace_id":workspace}).encode()
            attempt["evidence_bytes"]=json.dumps({"source_object_id":self.heads[name],"criteria_digest":f.submission_criteria[name],"artifact_ids":[attempt["log"]]}).encode()
            attempt["source"]=self.put(attempt["source_bytes"]);attempt["evidence"]=self.put(attempt["evidence_bytes"])
        self.attempts[name]=attempt;return attempt
    def submission(self,name,**changes):
        f=self.fixture;i=f.ids;a=self.attempts[name];t=a["token"]
        value={"organisation_id":i["organisation"],"run_id":i["run"],"task_id":t["task_id"],"request_id":uid(),"attempt_id":t["attempt_id"],"attempt_generation":t["attempt_generation"],
            "authority_epoch":t["authority_epoch"],"sandbox_id":t["sandbox_id"],"slot_id":t["slot_id"],"sandbox_boot_generation":t["sandbox_boot_generation"],
            "repository_id":i["repository"],"source_object_id":self.heads[name],"source_manifest_artifact_id":a.get("source"),"evidence_manifest_artifact_id":a.get("evidence"),
            "criteria_digest":f.submission_criteria[name],"contract_digests":[]}
        value.update(changes);return value
    def envelope(self,name,value):
        operation=self.fixture.operation("16.1","submission.submit",value,authority=self.fixture.authorities["worker_"+name])
        operation["idempotency_key"]=value["request_id"];return operation
    def send(self,name,operation):return self.fixture.request(operation,key="worker_"+name)[1]
    def submit(self,name,value):return self.send(name,self.envelope(name,value))
    # Independent PostgreSQL observers.
    def scalar(self,text,values):return self.fixture.sql(text,values)[0]
    def custodies(self,name):
        i=self.fixture.ids
        return int(self.scalar("SELECT count(*)::int AS n FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3",[i["organisation"],i["run"],i["task_"+name]])["n"])
    def attempt_state(self,name):
        i=self.fixture.ids;t=self.attempts[name]["token"]
        return self.scalar("SELECT a.compute_authority,a.execution_state,(SELECT string_agg(l.state,',' ORDER BY l.state) FROM hyperfide.compute_leases l WHERE l.organisation_id=a.organisation_id AND l.run_id=a.run_id AND l.attempt_id=a.id) AS leases FROM hyperfide.attempts a WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3",[i["organisation"],i["run"],t["attempt_id"]])
    def close(self):
        try:
            if self.fixture is not None:self.fixture.close()
        finally:
            self.fixture=None;self.state["closed"]=True;self.save()
            if self.store is not None:
                self.store.http.shutdown();self.store.sink.shutdown();self.store.http.server_close();self.store.sink.server_close();self.store=None
            shutil.rmtree(self.repository,ignore_errors=True)

def code(response):return response.get("error",{}).get("code") if isinstance(response,dict) and response.get("ok") is False else None

def cleanup_stack(record,prefix,run_sql,resource_prefix,artifact,write_absence):
    """Independent cleanup from the owned-resource record; observes absence of every owned resource."""
    import re,signal,socket,time
    record=Path(record)
    if not record.exists():return []
    state=json.loads(record.read_text())
    processes=[{"label":"control","pid":state.get("pid"),"start":state.get("start")}]+list(state.get("processes",[]))
    def alive(row):return row["pid"] is not None and row["start"] is not None and process_start(row["pid"])==row["start"]
    for row in processes:
        if alive(row):
            command=Path("/proc/"+str(row["pid"])+"/cmdline").read_bytes()
            if not any(marker in command for marker in (b"/services/hyperfide/dist/",b"hyperfide-native",b"tests/hyperfide/integration/")):raise ValueError("Unowned stack process")
            os.kill(row["pid"],signal.SIGTERM)
            for _ in range(80):
                if not alive(row):break
                time.sleep(.1)
            if alive(row):os.kill(row["pid"],signal.SIGKILL)
            for _ in range(30):
                if not alive(row):break
                time.sleep(.1)
    stopped=not any(alive(row) for row in processes)
    for port in [state.get("port")]+[row.get("port") for row in state.get("processes",[]) if row.get("port")]:
        if port:
            with socket.socket() as observer:
                observer.settimeout(.5);stopped=stopped and observer.connect_ex(("127.0.0.1",port))!=0
    database,role=state.get("database"),state.get("runtime_role")
    if database:
        if not re.fullmatch(r"hf_identity_[0-9a-f]{32}",database):raise ValueError("Unowned stack database")
        subprocess.run(["dropdb","--force","--if-exists",database],cwd=ROOT,check=True,capture_output=True,timeout=45)
    database_absent=database is None or run_sql("SELECT count(*) FROM pg_database WHERE datname='"+database+"';").strip()=="0"
    if role:
        if not re.fullmatch(r"hf_ir_[0-9a-f]{32}",role):raise ValueError("Unowned stack runtime role")
        run_sql('DROP ROLE IF EXISTS "'+role+'"')
    role_absent=role is None or run_sql("SELECT count(*) FROM pg_roles WHERE rolname='"+role+"';").strip()=="0"
    paths=[]
    for key,expected in (("folder","hyperfide-identity-"),("repository",prefix))+tuple((key,value) for key,value in state.get("extra_paths",{}).items()):
        location=state.get(key) if key in ("folder","repository") else key
        if location:
            location=Path(location)
            if location.parent!=Path(tempfile.gettempdir()) or not location.name.startswith(expected) or location.is_symlink():raise ValueError("Unowned stack fixture path")
            if stopped and location.exists():shutil.rmtree(location)
            paths.append(location)
    files_absent=all(not location.exists() for location in paths)
    write_absence({"database":database,"database_observed_absent":database_absent,"service_observed_absent":stopped,"runtime_role_observed_absent":role_absent,
        "fixture_files_observed_absent":files_absent,"paths":[str(location) for location in paths],"processes":processes,
        "observer":"PostgreSQL pg_database/pg_roles, exact PID/start identities, listener probes and owned temporary paths"})
    def row(key,absent):return {"id":resource_prefix+key,"status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":artifact}
    return [row("database",database_absent),row("service",stopped),row("role",role_absent),row("files",files_absent)]
