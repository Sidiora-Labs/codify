#!/usr/bin/env python3
"""13.2 real PostgreSQL/HTTPS metadata probes; controlled native profile fixtures."""
from __future__ import annotations
import copy,hashlib,json,os,select,shutil,signal,subprocess,sys,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/"tests/hyperfide/support"))
from identity_fixture import IdentityFixture
FAILED=[]
def uid():return str(uuid.uuid4())
def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def expect(value,message):
    if not value:raise AssertionError(message)
def check(identity,callback):
    try:callback();actual="observed"
    except Exception as error:actual=f"{type(error).__name__}: {error}";FAILED.append(identity)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)

def enable_subreaper():
    import ctypes
    expect(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"actual Linux child ownership tracking unavailable")
def drain_owned_children():
    children=Path("/proc/self/task/"+str(os.getpid())+"/children")
    deadline=time.monotonic()+8;signalled=set()
    while time.monotonic()<deadline:
        pending=[int(value)for value in children.read_text().split()]
        if not pending:return True
        for pid in pending:
            try:
                reaped,_=os.waitpid(pid,os.WNOHANG)
                if reaped:continue
                stat=Path("/proc/"+str(pid)+"/stat").read_text();rest=stat[stat.rfind(")")+2:].split()
                if int(rest[1])!=os.getpid():continue
                start=rest[19];fresh=Path("/proc/"+str(pid)+"/stat").read_text();now=fresh[fresh.rfind(")")+2:].split()
                if now[19]!=start or int(now[1])!=os.getpid():continue
                os.kill(pid,signal.SIGKILL if pid in signalled else signal.SIGTERM);signalled.add(pid)
            except (ChildProcessError,FileNotFoundError,ProcessLookupError):pass
        time.sleep(.05)
    return not children.read_text().strip()

class SessionIdentityFixture(IdentityFixture):
    def stop(self):
        if self.child and self.child.poll()is not None:
            self.child.communicate(timeout=5);self.child=None;return
        super().stop()

class NativeHandshake:
    """Import-safe bounded native transport; no inference, auth copying or DB authority."""
    def __init__(self,count=4):
        expect(type(count)is int and 1<=count<=16,"bounded native thread count required")
        enable_subreaper()
        self.native_folder=tempfile.TemporaryDirectory(prefix="hyperfide-native-transport-")
        native_root=Path(self.native_folder.name);native_env=os.environ.copy();native_env["CODEX_HOME"]=str(native_root/"codex-home");Path(native_env["CODEX_HOME"]).mkdir(mode=0o700)
        executable=subprocess.check_output(["mise","which","codex"],text=True).strip()if shutil.which("mise")else shutil.which("codex")
        expect(executable and Path(executable).is_file(),"actual installed Codex payload unavailable")
        self.executable=executable
        expect(subprocess.check_output([executable,"--version"],text=True).strip()=="codex-cli 0.162.1","pinned actual Codex version mismatch")
        self.child=subprocess.Popen([executable,"app-server","--listen","stdio://","--disable","multi_agent","--disable","multi_agent_v2","--disable","multi_agent_v2_dynamic_tools","-c","agents.enabled=false"],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=native_env,cwd=native_root,start_new_session=True)
        self.native_buffer=b""
        try:
            self.rpc({"id":"init","method":"initialize","params":{"clientInfo":{"name":"hyperfide-session-component-probe","version":"1"}}})
            self.child.stdin.write(b'{"method":"initialized","params":{}}\n');self.child.stdin.flush()
            self.native_sessions=[]
            for index in range(count):
                value=self.rpc({"id":"thread-"+str(index),"method":"thread/start","params":{"cwd":str(native_root),"approvalPolicy":"never","sandbox":"read-only"}})
                expect(isinstance(value.get("thread",{}).get("id"),str),"actual CLI omitted native thread identity")
                self.native_sessions.append(value["thread"]["id"])
                if index==0:
                    self.requested_model=value.get("model");self.configured_provider=value["thread"].get("modelProvider")
                    expect(isinstance(self.requested_model,str)and isinstance(self.configured_provider,str),"actual CLI omitted configured model/provider")
        except BaseException:
            self.terminate();self.native_folder.cleanup();drain_owned_children();raise
        stat=Path('/proc/'+str(self.child.pid)+'/stat').read_text()
        self.process_identity={'process_id':self.child.pid,'process_start_time':stat[stat.rfind(')')+2:].split()[19],'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
    def rpc(self,message):
        self.child.stdin.write(json.dumps(message).encode()+b"\n");self.child.stdin.flush();deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            if b"\n"not in self.native_buffer:
                if not select.select([self.child.stdout],[],[],.2)[0]:continue
                chunk=os.read(self.child.stdout.fileno(),65536);expect(chunk,"native transport closed before response");self.native_buffer+=chunk
                expect(len(self.native_buffer)<=1048576,"native protocol exceeded response bound")
            while b"\n"in self.native_buffer:
                line,self.native_buffer=self.native_buffer.split(b"\n",1)
                if not line.strip():continue
                row=json.loads(line)
                if row.get("id")==message["id"]:
                    expect("error"not in row,"actual native protocol refused request: "+json.dumps(row.get("error",{})))
                    return row["result"]
        raise AssertionError("actual native protocol response timed out")
    def terminate(self):
        if self.child.poll()is None:os.killpg(self.child.pid,signal.SIGTERM)
        try:self.child.communicate(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(self.child.pid,signal.SIGKILL);self.child.communicate(timeout=5)
    def close(self):
        self.terminate();self.native_folder.cleanup();expect(drain_owned_children(),'native descendants survived bounded handshake cleanup')
    def __enter__(self):return self
    def __exit__(self,*_):self.close()

class AgentFixture(NativeHandshake):
    def __init__(self,admission=False,qualified=False):
        super().__init__();self.inner=None
        native_root=Path(self.native_folder.name)
        try:
            def setup(f):
                self.f=f;i=f.ids
                for key in ["repository","feature","task","attempt","slot","parent","session","second","reviewer","bad_reviewer","artifact","checkpoint"]:i[key]=uid()
                self.scope={"organisation_id":i["organisation"],"run_id":i["run"],"session_id":i["session"]}
                self.configuration=sha(b"controlled-native-profile-v1");self.source=sha(b"source-tree-v1");self.checkpoint_digest=sha(b"checkpoint-fixture-bytes")
                migration=(ROOT/"services/hyperfide/migrations/0013-agents.sql").read_bytes()
                f.sql("BEGIN;\n"+migration.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES(13,'0013-agents','"+sha(migration)+"');\nCOMMIT;")
                org,run=i["organisation"],i["run"]
                seed=f"""BEGIN ISOLATION LEVEL SERIALIZABLE;
INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES('{org}','{i["repository"]}','{i["project"]}','fixture','https://example.invalid/fixture.git');
INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES('{org}','{i["repository"]}',repeat('a',40));
INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES('{org}','{run}','{i["repository"]}',repeat('a',40),'refs/heads/main');
INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES('{org}','{run}','{i["feature"]}','fixture',1);
INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave,generation,state) VALUES('{org}','{run}','{i["task"]}','fixture-13','{i["feature"]}','{i["spec"]}','{sha(b"criteria")}','{{}}',1,1,'RUNNING');
INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind) VALUES('{org}','{i["slot"]}','{i["sandbox"]}','fixture-13',1,'AGENT');
INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) VALUES('{org}','{run}','{i["attempt"]}','{i["task"]}',1,'{i["epoch"]}','{sha(b"packet")}','RUNNING','CURRENT','{i["sandbox"]}','{i["slot"]}',1,clock_timestamp()+interval '10 minutes');
UPDATE hyperfide.tasks SET current_attempt_id='{i["attempt"]}',state_version=state_version+1 WHERE organisation_id='{org}' AND run_id='{run}' AND id='{i["task"]}';
INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,state) VALUES('{org}','{run}','{i["parent"]}','LEADER','codex','fixture-account','fixture-parent','RUNNING');
INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id) VALUES('{org}','{run}','{i["session"]}','WORKER','{i["parent"]}','codex','fixture-account','{self.native_sessions[0]}','{i["slot"]}','{i["sandbox"]}',1,'{i["attempt"]}');
INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id) VALUES('{org}','{run}','{i["second"]}','FEATURE_MANAGER','{i["parent"]}','codex','fixture-account','{self.native_sessions[1]}'),('{org}','{run}','{i["reviewer"]}','VERIFIER','{i["parent"]}','codex','fixture-account','{self.native_sessions[2]}');
INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,attempt_id) VALUES('{org}','{run}','{i["bad_reviewer"]}','VERIFIER','{i["parent"]}','codex','fixture-account','{self.native_sessions[3]}','{i["attempt"]}');
INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status) VALUES('{org}','{run}','{i["artifact"]}','{self.checkpoint_digest}',24,'fixture','fixture-checkpoint','COMPLETE');
INSERT INTO hyperfide.checkpoints(organisation_id,run_id,id,attempt_id,attempt_generation,agent_session_id,artifact_id,repository_id,source_object_id,input_packet_digest,support_level) VALUES('{org}','{run}','{i["checkpoint"]}','{i["attempt"]}',1,'{i["session"]}','{i["artifact"]}','{i["repository"]}',repeat('a',40),'{sha(b"packet")}','NATIVE_RESUME');
COMMIT;"""
                f.sql(seed)
                runtime_home=f.path/"native-home";runtime_home.mkdir(mode=0o700);os.chown(runtime_home,1001,1001)
                self.profile={"schema_version":1,"profile_id":"fixture-native","profile_revision":"1","connector":"codex","auth_mode":"account_session",
                 "binary":{"path":self.executable,"digest":sha(Path(self.executable).read_bytes()),"version":"0.162.1"},"credential_reference":"fixture-reference",
                 "configured_model_alias":"fixture-frontier","requested_model_id":self.requested_model,
                 "configured_provider_id":self.configured_provider,"permission_profile_id":"fixture-permissions",
                 "capabilities":{"unattended":True,"refresh":False,"concurrent_account":False,"portable_session":False,"explicit_resume":True},
                 "runtime_home":str(runtime_home),"target_uid":1001}
                self.configuration=sha(json.dumps(self.profile,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode())
                self.profile_path=f.path/"native-profiles.json";self.profile_path.write_text(json.dumps({"schema_version":1,"profiles":[self.profile]}))
                f.env["HF_NATIVE_AUTH_PROFILES_FILE"]=str(self.profile_path)
                secret_root=f.path/"secrets";secret_root.mkdir(mode=0o700);attachments=f.path/"attachments";attachments.mkdir(mode=0o700)
                credential_config=f.path/"credential-store.json";credential_config.write_text(json.dumps({"schema_version":1,"secret_root":str(secret_root),"attachment_root":str(attachments),"sources":[],"targets":[]}))
                f.env["HF_CREDENTIAL_CONFIG_FILE"]=str(credential_config)
                self.binding={"connector":"codex","native_session_id":self.native_sessions[0],"connector_version":"0.162.1","auth_profile":"fixture-native","configuration_digest":self.configuration,"source_manifest_digest":self.source,"process_id":self.child.pid,"process_start_time":Path(f"/proc/{self.child.pid}/stat").read_text().split()[21],"boot_id":i["boot"]}
                self.checkpoint={"checkpoint_id":i["checkpoint"],"checkpoint_digest":self.checkpoint_digest,"manifest_digest":sha(b"fixture-manifest"),"source_manifest_digest":self.source,"configuration_digest":self.configuration,"native_session_id":self.native_sessions[0]}
                if admission:
                    self.admission_policy={"schema_version":1,"policies":[{"organisation_id":org,"run_id":run,"quota_key":"fixture-quota","connector":"codex","connector_version":"0.162.1","provider":self.configured_provider,"model":self.requested_model,"auth_profile":"fixture-native","permission_profile":"fixture-permissions","qualification_digest":sha(b"controlled-qualification"),"max_concurrent":1,"max_attempts":2,"retry_base_ms":100,"retry_max_ms":200,"unattended":True,"native_delegation":False}]}
                    self.policy_path=f.path/"admission.json";self.policy_path.write_text(json.dumps(self.admission_policy));f.env["HF_AGENT_ADMISSION_POLICY_FILE"]=str(self.policy_path)
            self.inner=SessionIdentityFixture(extra_components=["14.2","14.3","13.2"]+(["13.4"]if admission else[]),extra_setup=setup)
        except BaseException:
            self.terminate();raise
    def invoke(self,action,value,component="13.2"):
        return self.inner.invoke(action,value,component=component)
    def ok(self,action,value,component="13.2"):
        status,row=self.invoke(action,value,component);expect(status==200 and row.get("ok")is True,"valid signed action refused: "+str(row.get("error",{}).get("code")));return row["result"]
    def bad(self,action,value,code=None,component="13.2"):
        status,row=self.invoke(action,value,component);expect(status>=400 or row.get("ok")is False,"invalid signed action succeeded")
        if code:expect(row.get("error",{}).get("code")==code,"wrong refusal code: "+str(row.get("error",{}).get("code")))
    def bind(self,session=None,native=None):
        scope=dict(self.scope,session_id=session or self.scope["session_id"]);binding=dict(self.binding,native_session_id=native or self.binding["native_session_id"])
        return self.ok("agent.session.bind",{"scope":scope,"binding":binding})
    def close(self,resource):
        self.terminate();self.native_folder.cleanup();f=self.inner
        if f:
            f.close()
            absent=f.sql("SELECT datname FROM pg_database WHERE datname=$1",[f.database],admin=True)==[]
            expect(drain_owned_children(),"actual native descendants survived fixture cleanup")
            proof={"database":f.database,"observed_absent":absent,"observer":"independent pg_database query after DROP"}
            receipt=os.environ.get("HYPERFIDE_RECEIPT_ID");target=cleanup_state(resource)
            if target:
                with target.open("x")as state:state.write(json.dumps(proof))
                target.chmod(0o600)
            evidence="artifacts/"+receipt+"/stdout.log"if receipt else"raw-stdout"
            print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":resource,"status":"deleted"if absent else"unknown","observed_absent":absent,"evidence_artifact":evidence,"observation":proof}]}),flush=True)
            expect(absent,"disposable database survived cleanup")

def cleanup_state(resource):
    receipt=os.environ.get("HYPERFIDE_RECEIPT_ID")
    if receipt is None:return None
    expect(str(uuid.UUID(receipt))==receipt,"noncanonical cleanup receipt")
    return Path(tempfile.gettempdir())/("hyperfide-"+resource+"-"+receipt+".json")

def cleanup_only(resource):
    target=cleanup_state(resource);expect(target is not None,"cleanup receipt identity required")
    value=json.loads(target.read_text());database=value["database"]
    expect(database.startswith("hf_identity_")and len(database)==44,"invalid recorded cleanup database")
    from identity_fixture import SQL_JS
    result=subprocess.run(["node","--input-type=commonjs","-e",SQL_JS],input=json.dumps({"sql":"SELECT datname FROM pg_database WHERE datname=$1","values":[database]}),text=True,cwd=ROOT,env=os.environ.copy(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    absent=result.returncode==0 and json.loads(result.stdout)==[]
    if absent:target.unlink()
    return 0 if absent else 1

def main():
    fixture=None
    try:
        fixture=AgentFixture();f=fixture
        check("sessions.signed-registration",lambda:expect(f.bind()["bound"]is True,"binding missing"))
        check("sessions.exact-binding-replay",lambda:expect(f.bind()["binding"]["process_id"]==f.child.pid,"replay changed process identity"))
        check("sessions.binding-immutable-process",lambda:f.bad("agent.session.bind",{"scope":f.scope,"binding":dict(f.binding,process_id=f.child.pid+1)},"AGENT_BINDING_CONFLICT"))
        check("sessions.native-id-mismatch",lambda:f.bad("agent.session.bind",{"scope":f.scope,"binding":dict(f.binding,native_session_id="different")},"AGENT_NATIVE_ID_MISMATCH"))
        check("sessions.profile-config-mismatch",lambda:f.bad("agent.session.bind",{"scope":f.scope,"binding":dict(f.binding,configuration_digest=sha(b"other"))},"AGENT_PROFILE_MISMATCH"))
        check("sessions.cross-tenant-scope",lambda:f.bad("agent.session.inspect",{"scope":dict(f.scope,organisation_id=uid())},"AGENT_SCOPE_DENIED"))
        def lineage():
            row=f.ok("agent.session.inspect",{"scope":f.scope})["session"]
            expect(row["parent_session_id"]==f.inner.ids["parent"]and row["attempt_id"]==f.inner.ids["attempt"]and row["role"]=="WORKER","native lineage lost")
        check("sessions.persisted-lineage",lineage)
        check("sessions.review-role-null-attempt",lambda:expect(f.bind(f.inner.ids["reviewer"],f.native_sessions[2])["bound"],"reviewer without coding attempt refused"))
        check("sessions.reject-review-coding-attempt",lambda:f.bad("agent.session.bind",{"scope":dict(f.scope,session_id=f.inner.ids["bad_reviewer"]),"binding":dict(f.binding,native_session_id=f.native_sessions[3])},"AGENT_REVIEW_ATTEMPT_FORBIDDEN"))
        process={"boot_id":f.binding["boot_id"],"process_id":f.binding["process_id"],"process_start_time":f.binding["process_start_time"],"exit_observed":False}
        running={"scope":f.scope,"operation_id":uid(),"expected_state_version":"1","state":"RUNNING","process":process}
        check("sessions.exact-process-running",lambda:expect(f.ok("agent.session.transition",running)["state"]=="RUNNING","start observation lost"))
        check("sessions.operation-replay",lambda:expect(f.ok("agent.session.transition",running)["state_version"]=="2","same operation applied twice"))
        check("sessions.operation-payload-conflict",lambda:f.bad("agent.session.transition",dict(running,state="DISCONNECTED"),"AGENT_OPERATION_CONFLICT"))
        check("sessions.stale-state-version",lambda:f.bad("agent.session.transition",dict(running,operation_id=uid(),state="DISCONNECTED"),"AGENT_STATE_STALE"))
        check("sessions.pid-reuse-rejected",lambda:f.bad("agent.session.transition",dict(running,operation_id=uid(),expected_state_version="2",state="DISCONNECTED",process=dict(process,process_start_time=str(int(process["process_start_time"])+1))),"AGENT_PROCESS_MISMATCH"))
        check("sessions.checkpoint-source-mismatch",lambda:f.bad("agent.session.checkpoint",{"scope":f.scope,"operation_id":uid(),"checkpoint":dict(f.checkpoint,source_manifest_digest=sha(b"different"))},"AGENT_CHECKPOINT_MISMATCH"))
        check("sessions.actual-checkpoint-registration",lambda:expect(f.ok("agent.session.checkpoint",{"scope":f.scope,"operation_id":uid(),"checkpoint":f.checkpoint})["context_restored"]is False,"metadata registration claimed restored context"))
        resume={"scope":f.scope,"checkpoint_id":f.inner.ids["checkpoint"],"native_session_id":f.binding["native_session_id"],"configuration_digest":f.configuration,"source_manifest_digest":f.source}
        check("sessions.live-process-reconcile",lambda:expect(f.ok("agent.session.resume-check",resume)["decision"]=="RECONCILE_PROCESS","live process duplicated"))
        check("sessions.reject-unconfirmed-termination",lambda:f.bad("agent.session.transition",dict(running,operation_id=uid(),expected_state_version="2",state="STOPPED"),"AGENT_TERMINATION_UNCONFIRMED"))
        f.terminate()
        stopped=dict(running,operation_id=uid(),expected_state_version="2",state="STOPPED",process=dict(process,exit_observed=True))
        check("sessions.actual-exit-observation",lambda:expect(f.ok("agent.session.transition",stopped)["state"]=="STOPPED","actual process exit lost"))
        check("sessions.unqualified-native-resume-refused",lambda:expect(f.ok("agent.session.resume-check",resume)["decision"]=="FRESH_HANDOFF_REQUIRED","base support flag became qualified native context"))
        check("sessions.exact-checkpoint-session-only",lambda:f.bad("agent.session.resume-check",dict(resume,native_session_id="most-recent-other-session"),"AGENT_CHECKPOINT_MISMATCH"))
        check("sessions.source-tree-crossover-refused",lambda:f.bad("agent.session.resume-check",dict(resume,source_manifest_digest=sha(b"newtree")),"AGENT_CHECKPOINT_MISMATCH"))
        f.inner.stop();f.inner.start()
        check("sessions.restart-persists-lineage",lambda:expect(f.ok("agent.session.inspect",{"scope":f.scope})["session"]["state"]=="STOPPED","restart lost durable session state"))
    except Exception as error:check("sessions.setup",lambda:(_ for _ in()).throw(error))
    finally:
        if fixture:fixture.close("native-sessions-database")
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(cleanup_only("native-sessions-database")if "--cleanup"in sys.argv else main())
