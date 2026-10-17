#!/usr/bin/env python3
"""Task16.1 connected-stack variant: connected-stack/controlled-doubles.

Separately running control, dispatch and provisioner services share one disposable PostgreSQL
database; the coordinator HTTPS listener is the control service; a real native supervisor process
(compiled from the pinned native sources into an owned directory) heartbeats over signed HTTPS.
The coding agent is an explicitly selected controlled process double (no provider or model call);
network transport, database and process boundaries are real. Observations come only from
/proc process identities, PostgreSQL rows and the object store's stored bytes.

This evidence never qualifies a real provider or native frontier variant.
"""
from __future__ import annotations
import hashlib,importlib.util,json,os,shutil,signal,socket,subprocess,sys,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
TASK="16.1"
VARIANT="connected-stack/controlled-doubles"
PREFIX="assurance.16.1.connected."
OBSERVATIONS=[]

def directory():
    target=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/task-"+TASK+"-connected"))/"assurance"
    target.mkdir(parents=True,exist_ok=True);return target
def record():return directory()/("connected-resource-"+TASK+".json")
def emit(key,actual,expected=True):
    OBSERVATIONS.append({"id":PREFIX+key,"actual":actual,"expected":expected})
    print(json.dumps({"type":"assertion","id":PREFIX+key,"actual":actual,"expected":expected}),flush=True)
    if actual!=expected:raise AssertionError(PREFIX+key)
def observe(key,value):print(json.dumps({"type":"observation","id":PREFIX+key,"value":value}),flush=True)
def support():
    spec=importlib.util.spec_from_file_location("hf16_connected_stack_support",ROOT/"tests/hyperfide/integration/submission_stack.py")
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def start_of(pid):
    try:return Path("/proc/"+str(pid)+"/stat").read_text().rsplit(")",1)[1].split()[19]
    except FileNotFoundError:return None
def command_of(pid):
    try:return Path("/proc/"+str(pid)+"/cmdline").read_bytes().split(b"\0")
    except FileNotFoundError:return []
def free_port():
    with socket.socket() as sock:sock.bind(("127.0.0.1",0));return sock.getsockname()[1]
def wait_for(predicate,timeout=20,interval=.05):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        value=predicate()
        if value:return value
        time.sleep(interval)
    return None

class Service:
    """One separately running HTTPS service process for a declared deployment role."""
    def __init__(self,stack,role,fragments):
        self.stack,self.role,self.fragments=stack,role,fragments;self.child=None;self.port=free_port()
        f=stack.fixture;self.folder=f.path/("components-"+role);self.folder.mkdir(exist_ok=True)
        for name in fragments:shutil.copyfile(ROOT/("services/hyperfide/components/"+name+".json"),self.folder/(name+".json"))
        self.log=f.path/(role+".log")
    def start(self):
        f=self.stack.fixture
        argv=["node",str(ROOT/("services/hyperfide/dist/"+self.role+".js")),"--policy",str(f.policy),"--spec-revision","fixture-identity-v1","--components",str(self.folder),
              "--module-root",str(ROOT/"services/hyperfide/dist"),"--mode","https","--host","127.0.0.1","--port",str(self.port),"--tls-cert",str(f.ca),"--tls-key",str(f.tlskey)]
        self.starts=getattr(self,"starts",0)+1;self.log=f.path/(self.role+"-"+str(self.starts)+".log")
        log=open(self.log,"w")
        try:self.child=subprocess.Popen(argv,cwd=ROOT,env=f.env,stdin=subprocess.DEVNULL,stdout=log,stderr=log)
        finally:log.close()
        self.stack.own_process(self.child.pid,self.role,self.port)
        if not wait_for(lambda:'"event":"ready"' in self.log.read_text() or self.child.poll() is not None) or self.child.poll() is not None:
            raise AssertionError(self.role+" service did not become ready: "+self.log.read_text()[-1500:])
        self.identity=(self.child.pid,start_of(self.child.pid))
        return self.identity
    def stop(self):
        if self.child and self.child.poll() is None:
            self.child.send_signal(signal.SIGTERM)
            try:self.child.wait(timeout=10)
            except subprocess.TimeoutExpired:self.child.kill();self.child.wait(timeout=5)
        self.child=None
    def restart(self):
        before=self.identity;self.stop();after=self.start();return before,after

def main():
    stack=None;services={};processes=[];native=None;relay=None
    sql_support=support();code=sql_support.code;sha=sql_support.sha;uid=sql_support.uid
    native_root=Path(tempfile.mkdtemp(prefix="hyperfide-connected-native-"));native_root.chmod(0o700)
    record().write_text(json.dumps({"repository":None,"database":None,"runtime_role":None,"folder":None,"pid":None,"start":None,"port":None,"closed":False,
        "processes":[],"extra_paths":{str(native_root):"hyperfide-connected-native-"}}))
    try:
        observe("variant",{"variant":VARIANT,"provider":"controlled-double","agent_process":"controlled-double",
            "real":["network-transport","postgresql","service-processes","native-supervisor-process"],"qualifies_real_provider_or_frontier":False})
        stack=sql_support.SubmissionStack(record(),("c1",),prefix="hyperfide-connected-submit-")
        stack.own_path(native_root,"hyperfide-connected-native-")
        f=stack.fixture;i=f.ids;org,run=i["organisation"],i["run"]
        f.add_principal("dispatcher","DISPATCH")
        def call(service,action,payload,component,key="operator"):
            saved=f.port;f.port=service.port if service else saved
            try:return f.invoke(action,payload,component=component,key=key)[1]
            finally:f.port=saved
        class Control:port=None
        control=Control()
        # Separately running dispatch and provisioner services on the same database and identity authority.
        services["dispatch"]=Service(stack,"dispatch",["1.4","4.2","4.4","14.1","6.1","6.2"])
        services["provisioner"]=Service(stack,"provisioner",["1.4","4.2","4.4","14.1","15.2"])
        for service in services.values():service.start()
        control_pid=f.child.pid
        identities={"control":(control_pid,start_of(control_pid)),**{role:service.identity for role,service in services.items()}}
        described={role:call(service,"identity.describe",{},"14.1").get("result",{}).get("principal",{}).get("role") for role,service in [("control",None),*services.items()]}
        emit("services-separate",{"distinct_pids":len({pid for pid,_ in identities.values()}),
            "scripts":{role:any(part.endswith((role+".js").encode()) for part in command_of(pid)) for role,(pid,_) in identities.items()},"signed_describe":described},
            {"distinct_pids":3,"scripts":{"control":True,"dispatch":True,"provisioner":True},"signed_describe":{"control":"OPERATOR","dispatch":"OPERATOR","provisioner":"OPERATOR"}})
        # Real native supervisor process: the standard `make hyperfide-native` product, identified by digest.
        binary=ROOT/"build"/"hyperfide-native"
        if not binary.is_file():raise AssertionError("build/hyperfide-native is required; run make -s hyperfide-native")
        observe("native-binary",{"path":"build/hyperfide-native","sha256":hashlib.sha256(binary.read_bytes()).hexdigest()})
        state=native_root/"state";state.mkdir(mode=0o700)
        def private(path,value):path.write_text(json.dumps(value,separators=(",",":")));path.chmod(0o600)
        private(native_root/"registration.json",{"preparation_digest":f.preparation,"inventory":[]})
        private(native_root/"transport.json",{"origin":f.origin,"ca_file":str(f.ca),"key_path":str(f.keys["runner"]["path"]),"credential_id":i["runner"],"timeout_ms":1000})
        private(native_root/"runner.json",{"transport_config":str(native_root/"transport.json"),"state_dir":str(state),"organisation_id":org,"run_id":run,"sandbox_id":i["sandbox"],
            "boot_id":i["boot"],"boot_generation":"1","runner_registration_path":str(native_root/"registration.json"),"heartbeat_interval_ms":1000})
        def heartbeat():
            rows=f.sql("SELECT state_version::text AS v FROM hyperfide.identity_runner_status WHERE credential_id=$1",[i["runner"]]);return int(rows[0]["v"]) if rows else 0
        before=heartbeat();native_log=open(native_root/"native.out","w")
        env={name:os.environ[name] for name in ("PATH","LANG","LC_ALL","TZ") if name in os.environ}
        try:native=subprocess.Popen([str(binary),"--component","12.1","--action","supervisor.serve"],stdin=subprocess.PIPE,stdout=native_log,stderr=open(native_root/"native.err","w"),env=env)
        finally:native_log.close()
        stack.own_process(native.pid,"native-supervisor")
        native.stdin.write(json.dumps({"config_path":str(native_root/"runner.json")},separators=(",",":")).encode());native.stdin.close();native.stdin=None
        first=wait_for(lambda:(native_root/"native.out").read_text().splitlines()[:1])
        streamed=json.loads(first[0]) if first else {}
        advanced=wait_for(lambda:heartbeat()>before+1 or native.poll() is not None,timeout=15) and native.poll() is None
        if native.poll() is not None:observe("native-exit",{"code":native.returncode,"stdout":(native_root/"native.out").read_text()[-800:],"stderr":(native_root/"native.err").read_text()[-800:]})
        emit("native-supervisor-heartbeat",{"alive":native.poll() is None,"event":streamed.get("event"),"dispatch_ready":streamed.get("dispatch_ready"),"heartbeats_advanced":bool(advanced),
            "native_binary":any(part.endswith(b"hyperfide-native") for part in command_of(native.pid))},
            {"alive":True,"event":"RUNNER_HEARTBEATING","dispatch_ready":False,"heartbeats_advanced":True,"native_binary":True})
        # Eligibility/claim from an actual signed execution packet, then durable dispatch.
        attempt=stack.claim("c1");token=attempt["token"]
        packet=f.sql("SELECT a.input_packet_digest,a.compute_authority,a.execution_state,p.digest AS packet FROM hyperfide.attempts a LEFT JOIN hyperfide.hierarchy_execution_packets p ON p.organisation_id=a.organisation_id AND p.run_id=a.run_id AND p.digest=a.input_packet_digest WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3",[org,run,token["attempt_id"]])[0]
        emit("claim-from-packet",{"packet_bound":packet["packet"]==packet["input_packet_digest"]==token.get("input_packet_digest",packet["input_packet_digest"]),"compute_authority":packet["compute_authority"],"execution_state":packet["execution_state"]},
            {"packet_bound":True,"compute_authority":"CURRENT","execution_state":"RESERVED"})
        dispatch_request={"token":token,"request_id":uid(),"leader_generation":"1","package_generation":"2"}
        ensured=call(None,"scheduler.dispatch.ensure",dispatch_request,"5.3",key="manager").get("result",{})
        def delivery():
            rows=f.sql("SELECT d.event_id::text,d.state,d.attempt_count::text FROM hyperfide.scheduler_dispatches s JOIN hyperfide.event_deliveries d ON d.organisation_id=s.organisation_id AND d.run_id=s.run_id AND d.event_id=s.event_id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.id=$3 AND d.consumer_id=$4",[org,run,ensured.get("operation_id"),i["native_consumer"]])
            return rows[0] if rows else {}
        committed=delivery()
        emit("durable-dispatch-committed",{"state":ensured.get("state"),"execution_confirmed":ensured.get("execution_confirmed"),"delivery":committed.get("state")},
            {"state":"INTENT","execution_confirmed":False,"delivery":"PENDING"})
        # do_6: restart dispatch after commit and before send.
        old,new=services["dispatch"].restart()
        emit("dispatch-restart-before-send",{"pid_changed":old!=new and start_of(old[0])!=old[1],"delivery":delivery().get("state")},{"pid_changed":True,"delivery":"PENDING"})
        claimed=call(services["dispatch"],"outbox.claim",{"organisation_id":org,"run_id":run,"consumer_id":i["native_consumer"],"limit":1,"lease_ms":120000},"6.1",key="dispatcher")
        sent=(claimed.get("result") or [{}])[0]
        emit("dispatch-send",{"ok":claimed.get("ok"),"event":sent.get("id"),"event_type":sent.get("event_type"),"delivery":delivery().get("state")},
            {"ok":True,"event":committed.get("event_id"),"event_type":"runner.spawn.requested","delivery":"DELIVERING"})
        # Actual process spawn of the explicitly selected agent-process double behind a killable network segment.
        relay_folder=f.path/"relay";relay_folder.mkdir(exist_ok=True);events=relay_folder/"events.jsonl"
        def start_relay(drop):
            port_file=relay_folder/("port-"+uid())
            argv=[sys.executable,str(ROOT/"tests/hyperfide/integration/tls_relay.py"),"--port-file",str(port_file),"--cert",str(f.ca),"--key",str(f.tlskey),"--ca",str(f.ca),
                  "--event-file",str(events),"--target-port",str(f.port)]+(["--drop-first-response"] if drop else [])
            child=subprocess.Popen(argv,cwd=ROOT,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            stack.own_process(child.pid,"relay")
            if not wait_for(port_file.exists,timeout=10):raise AssertionError("relay did not listen")
            return child,int(port_file.read_text())
        relay,relay_port=start_relay(True)
        submission=stack.submission("c1");operation_id,correlation_id=uid(),uid()
        def spawn(port,label):
            config=relay_folder/(label+".json")
            config.write_text(json.dumps({"variant":VARIANT,"run_id":run,"origin":f.origin,"port":port,"ca":str(f.ca),"key_path":str(f.keys["worker_c1"]["path"]),
                "credential_id":i["worker_c1"],"authority":f.authorities["worker_c1"],"input":submission,"operation_id":operation_id,"correlation_id":correlation_id}))
            child=subprocess.Popen([sys.executable,str(ROOT/"tests/hyperfide/integration/agent_double.py"),str(config)],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            identity=(child.pid,start_of(child.pid));stack.own_process(child.pid,label);processes.append(child)
            out,err=child.communicate(timeout=90)
            report=json.loads(out.strip().splitlines()[-1]) if out.strip() else {"stderr":err[-800:]}
            return child,identity,report
        double,spawned,report=spawn(relay_port,"agent-double-1")
        services_pids={pid for pid,_ in identities.values()}|{native.pid}
        emit("agent-double-spawned",{"reported_pid_matches":report.get("process",{}).get("pid")==spawned[0] and report.get("process",{}).get("start")==spawned[1],
            "separate_process":spawned[0] not in services_pids and spawned[0]!=os.getpid(),"variant":report.get("variant")},
            {"reported_pid_matches":True,"separate_process":True,"variant":VARIANT})
        relay.wait(timeout=10)
        dropped=[json.loads(line) for line in events.read_text().splitlines() if '"dropped"' in line] if events.exists() else []
        custody_rows=f.sql("SELECT c.id::text,c.authority,c.qualification_outcome FROM hyperfide.submission_custodies c WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.task_id=$3",[org,run,i["task_c1"]])
        emit("network-cut-after-commit",{"double_lost_response":report.get("transport_error") is not None and double.returncode==3,"relay_died":relay.returncode==17 and start_of(relay.pid) is None,
            "service_replied_before_cut":bool(dropped) and dropped[0]["status_line"].endswith("200 OK"),"committed_custodies":len(custody_rows)},
            {"double_lost_response":True,"relay_died":True,"service_replied_before_cut":True,"committed_custodies":1})
        # do_6: restart dispatch again between send and acknowledgement.
        old,new=services["dispatch"].restart()
        received=call(services["dispatch"],"inbox.receive",{"organisation_id":org,"run_id":run,"event_id":sent.get("id"),"consumer_id":i["native_consumer"]},"6.2",key="dispatcher").get("result",{})
        ack={"organisation_id":org,"run_id":run,"event_id":sent.get("id"),"consumer_id":i["native_consumer"],"attempt_count":sent.get("attempt_count"),"inbox_id":received.get("inbox_id")}
        acked=call(services["dispatch"],"outbox.acknowledge",ack,"6.1",key="dispatcher").get("result",{})
        replayed=call(services["dispatch"],"outbox.acknowledge",ack,"6.1",key="dispatcher").get("result",{})
        emit("dispatch-restart-send-ack",{"pid_changed":old!=new and start_of(old[0])!=old[1],"acknowledged":acked.get("acknowledged"),"ack_replayed":replayed.get("replayed"),
            "delivery":delivery().get("state"),"attempt_count":delivery().get("attempt_count")},
            {"pid_changed":True,"acknowledged":True,"ack_replayed":True,"delivery":"ACKNOWLEDGED","attempt_count":"1"})
        relay,relay_port=start_relay(False)
        double2,spawned2,report2=spawn(relay_port,"agent-double-2")
        result=report2.get("response",{}).get("result",{})
        custody=custody_rows[0]["id"] if custody_rows else None
        emit("replay-after-reconnect",{"new_process":spawned2!=spawned,"ok":report2.get("response",{}).get("ok"),"custody":result.get("submission",{}).get("id"),
            "custodies":stack.custodies("c1")},{"new_process":True,"ok":True,"custody":custody,"custodies":1})
        transfer=f.sql("SELECT a.compute_authority,a.execution_state,(SELECT string_agg(l.state,',') FROM hyperfide.compute_leases l WHERE l.organisation_id=a.organisation_id AND l.run_id=a.run_id AND l.attempt_id=a.id) AS leases,"
            "c.authority,c.qualification_outcome,j.state AS job,t.state AS task FROM hyperfide.attempts a JOIN hyperfide.submission_custodies c ON c.organisation_id=a.organisation_id AND c.run_id=a.run_id AND c.source_attempt_id=a.id "
            "JOIN hyperfide.qualification_jobs j ON j.organisation_id=c.organisation_id AND j.run_id=c.run_id AND j.custody_id=c.id JOIN hyperfide.tasks t ON t.organisation_id=c.organisation_id AND t.run_id=c.run_id AND t.id=c.task_id "
            "WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3",[org,run,token["attempt_id"]])
        emit("compute-to-custody",transfer,[{"compute_authority":"RELEASED","execution_state":"SUBMITTED","leases":"RELEASED","authority":"ACTIVE","qualification_outcome":"PENDING","job":"PENDING","task":"SUBMITTED"}])
        digests=f.sql("SELECT source_manifest_digest,evidence_manifest_digest FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,custody])[0]
        stored={sha(data) for data in stack.store.objects.values()}
        read=call(services["provisioner"],"artifact.object.read",{"organisation_id":org,"run_id":run,"artifact_id":attempt["source"]},"15.2")
        import base64
        provisioner_bytes=base64.b64decode(read.get("result",{}).get("data_base64","")) if read.get("ok") else b""
        emit("immutable-artifacts",{"source_stored":digests["source_manifest_digest"] in stored,"evidence_stored":digests["evidence_manifest_digest"] in stored,
            "source_matches_upload":digests["source_manifest_digest"]==sha(attempt["source_bytes"]),"evidence_matches_upload":digests["evidence_manifest_digest"]==sha(attempt["evidence_bytes"]),
            "provisioner_read_matches":sha(provisioner_bytes)==digests["source_manifest_digest"]},
            {"source_stored":True,"evidence_stored":True,"source_matches_upload":True,"evidence_matches_upload":True,"provisioner_read_matches":True})
        # Coding-slot cleanup: the agent processes are gone, the native supervisor stops and the coding sandbox is destroyed.
        native.send_signal(signal.SIGTERM)
        try:native.wait(timeout=12)
        except subprocess.TimeoutExpired:native.kill();native.wait(timeout=5)
        f.sql("UPDATE hyperfide.agent_sessions SET state='STOPPED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,attempt["session"]])
        f.sql("UPDATE hyperfide.sandboxes SET desired_state='DESTROYED',observed_state='DESTROYED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,i["sandbox"]])
        inspected=call(None,"submission.inspect",{"organisation_id":org,"run_id":run,"submission_id":custody},"16.1").get("result",{})
        emit("coding-cleanup-preserves-custody",{"agent_processes_gone":all(start_of(pid)!=start for pid,start in (spawned,spawned2)),"native_stopped":native.returncode==0 and start_of(native.pid) is None,
            "authority":inspected.get("authority"),"outcome":inspected.get("qualification_outcome")},
            {"agent_processes_gone":True,"native_stopped":True,"authority":"ACTIVE","outcome":"PENDING"})
        # Independent qualification after coding cleanup: a separate verifier sandbox is required and the job stays PENDING until independently prepared.
        verifier_sandbox,verifier_slot,verifier=uid(),uid(),uid()
        f.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state,preparation_digest) VALUES($1,$2,$3,'connected-verifier-resource','RUNNING',$4)",[org,verifier_sandbox,i["pool"],f.preparation])
        f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,'verifier',1,'TEST','READY')",[org,verifier_slot,verifier_sandbox])
        f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,state) VALUES($1,$2,$3,'VERIFIER','fixture','fixture','connected-verifier',$4,$5,1,'RUNNING')",[org,run,verifier,verifier_slot,verifier_sandbox])
        job=f.sql("SELECT id::text,state_version::text AS version FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3",[org,run,custody])[0]
        assigned=call(None,"qualification.job.assign",{"organisation_id":org,"run_id":run,"job_id":job["id"],"expected_state_version":job["version"],"verifier_id":verifier,"sandbox_id":verifier_sandbox,
            "slot_id":verifier_slot,"sandbox_boot_generation":"1","reservation_id":uid(),"environment_digest":sha(b"verifier-environment")},"16.2")
        after=f.sql("SELECT j.state,j.lease_owner,c.qualification_outcome FROM hyperfide.qualification_jobs j JOIN hyperfide.submission_custodies c ON c.organisation_id=j.organisation_id AND c.run_id=j.run_id AND c.id=j.custody_id WHERE j.organisation_id=$1 AND j.run_id=$2 AND j.id=$3",[org,run,job["id"]])[0]
        emit("independent-qualification-pending",{"assignment":code(assigned),**after,"completion_text_ignored":report2.get("completion_text") is not None},
            {"assignment":"QUALIFICATION_RESULT_PREPARATION_REQUIRED","state":"PENDING","lease_owner":None,"qualification_outcome":"PENDING","completion_text_ignored":True})
        return 0
    except Exception as error:
        print(json.dumps({"type":"observation","id":PREFIX+"failure","error":type(error).__name__+": "+str(error)[:1500]}),flush=True)
        return 1
    finally:
        try:
            for child in processes:
                if child.poll() is None:child.kill();child.wait(timeout=5)
            if relay is not None and relay.poll() is None:relay.kill();relay.wait(timeout=5)
            if native is not None and native.poll() is None:native.kill();native.wait(timeout=5)
            for service in services.values():service.stop()
        finally:
            if stack is not None:stack.close()
            shutil.rmtree(native_root,ignore_errors=True)
            (directory()/("connected-observations-"+TASK+".json")).write_text(json.dumps({"variant":VARIANT,"scope":"connected-stack task-component variant",
                "qualifies_real_provider_or_frontier":False,"assertions":OBSERVATIONS},indent=2)+"\n")

def psql(text):
    result=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d","postgres"],cwd=ROOT,input=text,text=True,capture_output=True,timeout=45)
    if result.returncode:raise RuntimeError("PostgreSQL cleanup observation failed: "+result.stderr[-800:])
    return result.stdout

def cleanup_resources():
    def absence(value):(directory()/("connected-absence-"+TASK+".json")).write_text(json.dumps(value)+"\n")
    return support().cleanup_stack(record(),"hyperfide-connected-submit-",psql,"hf-task-16.1-connected-","assurance/connected-absence-"+TASK+".json",absence)

if __name__=="__main__":
    if "--cleanup" in sys.argv:
        rows=cleanup_resources();complete=bool(rows) and all(row["observed_absent"] for row in rows)
        print(json.dumps({"type":"cleanup","complete":complete,"resources":rows}),flush=True);raise SystemExit(0 if complete else 1)
    raise SystemExit(main())
