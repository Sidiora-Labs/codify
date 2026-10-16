#!/usr/bin/env python3
"""Native RUNNER daemon against actual14 HTTPS/Ed25519/least-privilege PostgreSQL.
No cloud/provider, consumer dispatch readiness, or72h availability claim.
The replay test commits exact persisted pending bytes through genuine14 then
restarts the native child: it proves lost-reply replay semantics without mocking14.
"""
from __future__ import annotations
import base64,fcntl,hashlib,importlib.util,json,os,signal,subprocess,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
RESULTS=[]
def expect(value,message):
    if not value:raise AssertionError(message)
def check(name,fn):
    try:fn();actual="observed"
    except Exception as exc:actual=type(exc).__name__+": "+str(exc)
    RESULTS.append((name,actual));print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def wait_for(fn,timeout=15):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        value=fn()
        if value:return value
        time.sleep(.05)
    raise AssertionError("bounded condition not reached")
def private(path,value):
    path.write_text(json.dumps(value,separators=(",",":")));path.chmod(0o600)
def build(folder):
    driver=folder/"daemon-main.c"
    driver.write_text('#define _GNU_SOURCE\n#include "supervisor.h"\n#include <stdlib.h>\nint hf_supervisor_daemon(const char*,FILE*);\nint main(int argc,char **argv){if(argc!=2)return 2;char *r=NULL;size_t n=0;FILE*s=open_memstream(&r,&n);if(!s)return 2;fputs("{\\"config_path\\":",s);hf_json_write_string(s,argv[1]);fputc(\'}\',s);if(fclose(s))return 2;int rc=hf_supervisor_daemon(r,stdout);free(r);return rc;}\n')
    binary=folder/"supervisor-daemon"
    result=subprocess.run(["cc","-std=c11","-O2","-g","-Wall","-Wextra","-ffunction-sections","-fdata-sections","-I"+str(ROOT/"src/hyperfide"),str(driver),str(ROOT/"src/hyperfide/supervisor_daemon.c"),str(ROOT/"src/hyperfide/supervisor.c"),str(ROOT/"src/hyperfide/transport.c"),"-Wl,--gc-sections","-o",str(binary),"-lcurl","-lssl","-lcrypto","-lsqlite3","-pthread"],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=60)
    expect(result.returncode==0,"actual native daemon build failed: "+result.stderr[:3000])
    own_warnings=[line for line in result.stderr.splitlines() if "supervisor_daemon.c:" in line]
    expect(not own_warnings,"daemon compiler diagnostic: "+";".join(own_warnings))
    return binary
def load_fixture():
    root=Path(os.environ.get("HYPERFIDE_IDENTITY_FIXTURE_ROOT",str(ROOT))).resolve()
    path=root/"tests/hyperfide/support/identity_fixture.py"
    spec=importlib.util.spec_from_file_location("daemon_actual_identity_fixture",path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
class Child:
    def __init__(self,binary,config):
        self.child=subprocess.Popen([str(binary),str(config)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    def stop(self,kill=False):
        if self.child.poll() is None:
            self.child.send_signal(signal.SIGKILL if kill else signal.SIGTERM)
        out,err=self.child.communicate(timeout=12)
        return self.child.returncode,out.decode(errors="replace"),err.decode(errors="replace")
def main():
    fixture_module=load_fixture()
    with tempfile.TemporaryDirectory(prefix="hf-runner-daemon-") as temp:
        folder=Path(temp);folder.chmod(0o700)
        binary=build(folder)
        with_actual=None;children=[]
        try:
            f=fixture_module.IdentityFixture();with_actual=f
            enrolled=f.bootstrap_runner()
            root=folder/"state";root.mkdir(mode=0o700)
            registration=folder/"registration.json"
            private(registration,{"preparation_digest":f.preparation,"inventory":[]})
            transport=folder/"transport.json"
            private(transport,{"origin":f.origin,"ca_file":str(f.ca),"key_path":str(f.keys["runner"]["path"]),"credential_id":f.ids["runner"],"timeout_ms":1000})
            config=folder/"runner.json"
            policy={"transport_config":str(transport),"state_dir":str(root),"organisation_id":f.ids["organisation"],"run_id":f.ids["run"],"sandbox_id":f.ids["sandbox"],"boot_id":f.ids["boot"],"boot_generation":"1","runner_registration_path":str(registration),"heartbeat_interval_ms":1000}
            private(config,policy)
            statepath=root/"daemon-state.json"
            def state():
                try:return json.loads(statepath.read_text())
                except FileNotFoundError:return None
            def db():
                rows=f.sql("SELECT state_version::text,preparation_digest,inventory FROM hyperfide.identity_runner_status WHERE credential_id=$1",[f.ids["runner"]])
                return rows[0] if rows else None
            # Leave a genuine native request pending while the actual service is down.
            f.stop();first=Child(binary,config);children.append(first)
            pending=wait_for(lambda:(state() or {}).get("pending"))
            check("daemon.pending-before-network",lambda:expect(pending["kind"]=="register" and db() is None,"registration not durable before transport"))
            stopped=first.stop()
            check("daemon.shutdown-bounded",lambda:expect(stopped[0]==0 and '"event":"STOPPED"' in stopped[1],"SIGTERM did not stop cleanly"))
            original=state()
            # Commit the exact saved operation through actual signed14, deliberately
            # discard its reply, then have the real native daemon replay it.
            f.start()
            payload=pending["payload"].encode()
            envelope={"protocol_version":1,"operation_id":pending["operation_id"],"idempotency_key":pending["idempotency_key"],"payload_digest":"sha256:"+hashlib.sha256(payload).hexdigest(),"correlation_id":pending["correlation_id"],"causation_id":None,"payload_b64":base64.urlsafe_b64encode(payload).decode().rstrip("=")}
            status,reply=f.request(envelope,key="runner")
            check("daemon.real-lost-reply-commit",lambda:expect(status==200 and reply.get("ok") is True and db()["state_version"]=="1","actual14 commit failed"))
            replay=Child(binary,config);children.append(replay)
            wait_for(lambda:(state() or {}).get("registered") and (state() or {}).get("pending") is None)
            check("daemon.replay-does-not-register-twice",lambda:expect(state()["state_version"]=="1" and db()["state_version"]=="1","replayed register changed state twice"))
            check("daemon.registration-bound-to-boot",lambda:expect(reply["result"]["credential_id"]==f.ids["runner"] and reply["result"]["boot_id"]==policy["boot_id"] and reply["result"]["sandbox_id"]==policy["sandbox_id"] and reply["result"]["boot_generation"]=="1","actual registration tuple differs"))
            wait_for(lambda:int((state() or {}).get("state_version","0"))>=2)
            check("daemon.real-heartbeat-cas",lambda:expect(int(db()["state_version"])>=2,"native signed heartbeat did not advance actual14"))
            check("daemon.inventory-and-preparation",lambda:expect(db()["preparation_digest"]==f.preparation and db()["inventory"]==[],"registration bytes changed"))
            # A second real child must not alter the incumbent runner's state.
            contender=Child(binary,config);children.append(contender);contender.child.communicate(timeout=3)
            check("daemon.exclusive-root-lock",lambda:expect(contender.child.returncode!=0,"duplicate daemon acquired state lock"))
            before=int(db()["state_version"])
            writer=os.open("/proc/"+str(replay.child.pid)+"/fd/1",os.O_WRONLY|os.O_NONBLOCK)
            try:
                while True:
                    try:os.write(writer,b"x"*4096)
                    except BlockingIOError:break
                wait_for(lambda:int(db()["state_version"])>before)
                check("daemon.controller-backpressure-survival",lambda:expect(replay.child.poll() is None,"full observer pipe blocked runner"))
            finally:os.close(writer)
            before=int(db()["state_version"])
            replay.child.stdout.close()
            wait_for(lambda:int(db()["state_version"])>before)
            check("daemon.controller-output-disconnect-survival",lambda:expect(replay.child.poll() is None,"observer disconnection killed runner"))
            # Outage creates one immutable heartbeat request. Killing the process
            # retains it; subsequent startup must reuse every saved request byte.
            f.stop()
            heartbeat=wait_for(lambda:(state() or {}).get("pending"))
            time.sleep(1.3)
            check("daemon.reconnect-keeps-pending-identity",lambda:expect(state()["pending"]==heartbeat,"outage minted a new operation"))
            # stdout was intentionally closed, so do not call communicate on it.
            replay.child.send_signal(signal.SIGKILL);replay.child.wait(timeout=3);replay.child.stderr.close()
            restarted=Child(binary,config);children.append(restarted);time.sleep(.4)
            check("daemon.restart-keeps-pending-identity",lambda:expect(state()["pending"]==heartbeat and restarted.child.poll() is None,"restart changed pending operation"))
            f.start()
            wait_for(lambda:(state() or {}).get("pending") is None and int((state() or {}).get("state_version","0"))>int(original["state_version"]))
            check("daemon.reconnect-recovers-actual14",lambda:expect(int(db()["state_version"])==int(state()["state_version"]),"reconnect did not acknowledge actual14 state"))
            restarted.stop()
            # State version conflicts require explicit reconciliation, never a
            # fresh register or silently substituted expected version.
            old=state();f.sql("UPDATE hyperfide.identity_runner_status SET state_version=state_version+1 WHERE credential_id=$1",[f.ids["runner"]])
            conflict=Child(binary,config);children.append(conflict);out,err=conflict.child.communicate(timeout=5)
            check("daemon.version-conflict-fails-explicitly",lambda:expect(conflict.child.returncode!=0 and b"VERSION_CONFLICT" in err,"CAS conflict was not explicit"))
            retained=state()
            check("daemon.version-conflict-retains-operation",lambda:expect(retained["state_version"]==old["state_version"] and retained["pending"]["kind"]=="heartbeat","conflict replaced state or lost pending request"))
            again=Child(binary,config);children.append(again);again.child.communicate(timeout=5)
            check("daemon.conflict-restart-no-new-request",lambda:expect(state()["pending"]==retained["pending"],"conflict restart minted an operation"))
            reader,writer=os.pipe()
            os.set_blocking(writer,False)
            while True:
                try:os.write(writer,b"x"*4096)
                except BlockingIOError:break
            os.set_blocking(writer,True)
            blocked=subprocess.Popen([str(binary),str(config)],stdin=subprocess.DEVNULL,stdout=writer,stderr=writer)
            os.close(writer)
            try:
                check("daemon.rejection-full-controller-pipe-exits",lambda:expect(blocked.wait(timeout=5)!=0 and state()["pending"]==retained["pending"],"real rejected request blocked final diagnostic"))
            finally:
                if blocked.poll() is None:blocked.kill();blocked.wait(timeout=3)
                os.close(reader)
            # Root-owned configuration/inventory changes invalidate local lineage.
            changed=dict(policy);changed["boot_id"]=str(uuid.uuid4());private(config,changed)
            wrong=Child(binary,config);children.append(wrong);wrong.child.communicate(timeout=3)
            check("daemon.restored-other-boot-refused",lambda:expect(wrong.child.returncode!=0 and state()==retained,"copied state admitted another boot"))
            private(config,policy);registration.chmod(0o644)
            insecure=Child(binary,config);children.append(insecure);insecure.child.communicate(timeout=3)
            check("daemon.public-registration-refused",lambda:expect(insecure.child.returncode!=0,"world-readable inventory accepted"))
            registration.chmod(0o600)
            writable=folder/"worker-writable";writable.mkdir();writable.chmod(0o777)
            insecure_config=writable/"config.json";private(insecure_config,policy)
            unsafe_parent=Child(binary,insecure_config);children.append(unsafe_parent);unsafe_parent.child.communicate(timeout=3)
            check("daemon.writable-config-ancestor-refused",lambda:expect(unsafe_parent.child.returncode!=0,"worker-replaceable config ancestor accepted"))
            unsafe_state=writable/"state";unsafe_state.mkdir(mode=0o700)
            changed=dict(policy);changed["state_dir"]=str(unsafe_state);private(config,changed)
            unsafe_root=Child(binary,config);children.append(unsafe_root);unsafe_root.child.communicate(timeout=3)
            check("daemon.writable-state-ancestor-refused",lambda:expect(unsafe_root.child.returncode!=0,"worker-replaceable state ancestor accepted"))
            private(config,policy)
            registration.unlink();registration.symlink_to(transport)
            linked=Child(binary,config);children.append(linked);linked.child.communicate(timeout=3)
            check("daemon.symlink-registration-refused",lambda:expect(linked.child.returncode!=0,"symlink registration accepted"))
            registration.unlink();os.mkfifo(registration,0o600)
            fifo=Child(binary,config);children.append(fifo);fifo.child.communicate(timeout=3)
            check("daemon.nonregular-registration-refused-bounded",lambda:expect(fifo.child.returncode!=0,"FIFO registration blocked or was accepted"))
            check("daemon.no-dispatch-authority",lambda:expect('"dispatch_ready":false' in stopped[1] and '"execution_authority":false' in stopped[1] and '"dispatch_ready":true' not in stopped[1],"14 heartbeat invented dispatch authority"))
            check("daemon.root-private-journal",lambda:expect(statepath.stat().st_mode&0o777==0o600 and root.stat().st_mode&0o777==0o700,"state permissions are not private"))
        finally:
            for child in children:
                if child.child.poll() is None:
                    child.child.kill();child.child.wait(timeout=3)
            if with_actual:with_actual.close()
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
    return int(any(value!="observed" for _,value in RESULTS))
if __name__=="__main__":raise SystemExit(main())
