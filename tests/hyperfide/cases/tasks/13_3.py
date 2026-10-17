#!/usr/bin/env python3
"""13.3 recovery decisions measured by the linked component from /proc and inherited pipes; no native resume claim."""
import hashlib,json,os,signal,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
FAILED=[]
CHILDREN=[]
def expect(ok,message):
    if not ok:raise AssertionError(message)
def check(identity,fn):
    try:fn();actual="observed"
    except Exception as error:actual=f"{type(error).__name__}: {error}";FAILED.append(identity)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def invoke(value,fds=()):
    env=os.environ.copy();env.pop("HF_NATIVE_AUTH_SNAPSHOT_FILE",None)
    r=subprocess.run([ROOT/"build/hyperfide-native","--component","13.3","--action","connector.recover"],input=value if isinstance(value,str)else json.dumps(value),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=10,pass_fds=fds)
    rows=[json.loads(x)for x in r.stdout.splitlines()if x.strip()]
    expect(len(rows)==1,"missing linked recovery response")
    return r,rows[0]
def result(value,fds=()):
    r,p=invoke(value,fds);expect(r.returncode==0 and p.get("ok")is True,"valid recovery refused: "+r.stdout);return p["result"]
def refuse(value,fds=()):
    r,p=invoke(value,fds);expect(r.returncode!=0 and p.get("ok")is False,"invalid recovery accepted")
def decision(value,name,reason=None,fds=()):
    p=result(value,fds);expect(p["decision"]==name and not p["context_restored"] and not p["replay_pending_input"] and not p["grants_authority"],"recovery fabricated context/replay/authority: "+str(p))
    expect(reason is None or p["reason"]==reason,"wrong recovery reason: "+str(p))
    return p
def spawn(argv,**kw):
    child=subprocess.Popen(argv,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,**kw);CHILDREN.append(child);return child
def stat(pid):return Path(f"/proc/{pid}/stat").read_text().rsplit(")",1)[1].split()
def wait_for(fn,message):
    for _ in range(500):
        if fn():return
        time.sleep(0.01)
    raise AssertionError(message)
def handoff(base,new_session,**override):
    doc={"schema_version":1,"kind":"hyperfide.connector.handoff","connector":base["connector"],"prior_native_session_id":base["native_session_id"],"new_agent_session_id":new_session,
         "source_manifest_digest":base["source_manifest_digest"],"configuration_digest":base["configuration_digest"],"checkpoint_reference":base.get("checkpoint_reference"),"context_digest":"sha256:"+"9"*64}
    doc.update(override);text=json.dumps(doc,sort_keys=True,separators=(",",":"))
    return dict(base,new_agent_session_id=new_session,handoff_document=text,handoff_digest="sha256:"+hashlib.sha256(text.encode()).hexdigest())
def main():
    child=spawn(["/bin/sleep","60"],stdin=subprocess.PIPE)
    try:
        boot=Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        start=stat(child.pid)[19]
        request={"connector":"codex","native_session_id":"native-observed-fixture","source_manifest_digest":"sha256:"+"a"*64,"configuration_digest":"sha256:"+"b"*64,
         "auth_state":"VALID","transport_state":"LOST","process_pid":child.pid,"process_boot_id":boot,"process_start_time":start,"protocol_delivery":"ACKNOWLEDGED"}
        def live():
            expect(child.poll()is None,"actual fixture child not live")
            p=decision(request,"RECONNECT_EXISTING","EXACT_PROCESS_OBSERVED")
            o=p["process_observation"];expect(o["state"]=="ALIVE"and o["observed_start_time"]==start and o["kernel_boot_id"]==boot and o["pid"]==child.pid,"liveness not measured: "+str(o))
        check("recovery.actual-process-reconnect",live)
        def transport_independent():
            decision(dict(request,transport_state="CONNECTED"),"CONTINUE_EXISTING","EXACT_PROCESS_OBSERVED")
            expect(child.poll()is None,"controller observation ended native child")
        check("recovery.transport-independent-process",transport_independent)
        check("recovery.caller-process-claim-refused",lambda:refuse(dict(request,process_state="ALIVE_VERIFIED")))
        check("recovery.pid-start-mismatch",lambda:decision(dict(request,process_start_time=str(int(start)+1)),"RECONCILE","PROCESS_PID_REUSED"))
        check("recovery.boot-mismatch",lambda:decision(dict(request,process_boot_id=str(uuid.uuid4())),"RECONCILE","PROCESS_BOOT_CHANGED"))
        fd=child.stdin.fileno()
        def pending():
            os.write(fd,b"partial-frame")
            p=decision(dict(request,protocol_fd=fd),"REHANDSHAKE_EXISTING","PROTOCOL_DELIVERY_UNCERTAIN",fds=(fd,))
            expect(p["protocol_pipe"]=={"state":"OPEN","pending_bytes":13},"undelivered bytes not observed: "+str(p["protocol_pipe"]))
        check("recovery.actual-partial-pipe-no-replay",pending)
        check("recovery.declared-partial-write-rehandshake",lambda:decision(dict(request,protocol_delivery="PARTIAL"),"REHANDSHAKE_EXISTING","PROTOCOL_DELIVERY_UNCERTAIN"))
        def dead_pipe():
            closed=spawn(["/bin/sh","-c","exec 0<&-; exec /bin/sleep 60"],stdin=subprocess.PIPE)
            try:
                wait_for(lambda:Path(f"/proc/{closed.pid}/comm").read_text().strip()=="sleep","closed-stdin fixture did not exec")
                wfd=closed.stdin.fileno()
                p=decision(dict(request,process_pid=closed.pid,process_start_time=stat(closed.pid)[19],protocol_fd=wfd),"RECONCILE","PROTOCOL_PIPE_CLOSED",fds=(wfd,))
                expect(p["process_observation"]["state"]=="ALIVE"and p["protocol_pipe"]["state"]=="CLOSED","dead pipe mistaken for progress: "+str(p))
            finally:
                os.killpg(closed.pid,signal.SIGKILL);closed.wait(timeout=5);closed.stdin.close()
        check("recovery.observed-dead-pipe-live-process",dead_pipe)
        check("recovery.auth-expired-explicit",lambda:decision(dict(request,auth_state="EXPIRED"),"BLOCKED_AUTH","EXPIRED"))
        check("recovery.auth-revoked-explicit",lambda:decision(dict(request,auth_state="REVOKED"),"BLOCKED_AUTH","REVOKED"))
        os.killpg(child.pid,signal.SIGKILL)
        def zombie():
            wait_for(lambda:stat(child.pid)[0]=="Z","killed child did not become an unreaped zombie")
            p=decision(dict(request,protocol_fd=fd),"BLOCKED_CONTEXT","SAVED_CONTEXT_UNAVAILABLE",fds=(fd,))
            expect(p["process_observation"]["state"]=="EXITED"and p["process_observation"]["observed_state"]=="Z"and p["protocol_pipe"]["state"]=="CLOSED"and p["context_lost"],"zombie/dead pipe treated as live: "+str(p))
        check("recovery.observed-zombie-dead-pipe",zombie)
        child.wait(timeout=5);child.stdin.close()
        dead=dict(request)
        def absent():
            p=decision(dead,"BLOCKED_CONTEXT","SAVED_CONTEXT_UNAVAILABLE")
            expect(p["process_observation"]["state"]=="ABSENT"and p["context_lost"],"reaped process not observed absent: "+str(p))
        check("recovery.actual-exit-missing-context",absent)
        def reused():
            p=decision(dict(dead,process_pid=os.getpid()),"RECONCILE","PROCESS_PID_REUSED")
            expect(p["process_observation"]["observed_start_time"]==stat(os.getpid())[19],"pid reuse not observed from /proc: "+str(p))
        check("recovery.pid-reuse-observed",reused)
        def orphaned():
            rd,wr=os.pipe()
            holder=spawn(["/bin/sleep","60"],stdin=rd);os.close(rd)
            try:decision(dict(dead,protocol_fd=wr),"RECONCILE","PROTOCOL_PIPE_ORPHANED",fds=(wr,))
            finally:
                os.killpg(holder.pid,signal.SIGKILL);holder.wait(timeout=5);os.close(wr)
        check("recovery.orphaned-pipe-refused",orphaned)
        fresh=handoff(dead,"new-hyperfide-session")
        def fresh_handoff():
            p=decision(fresh,"FRESH_HANDOFF","SAVED_CONTEXT_UNAVAILABLE")
            v=p["provenance"]
            expect(p["context_lost"]and p["native_session_id"]is None and p["new_agent_session_id"]=="new-hyperfide-session"and p["handoff_digest"]==fresh["handoff_digest"],"fresh launch invented native identity/lost handoff")
            expect(v=={"prior_native_session_id":dead["native_session_id"],"new_agent_session_id":"new-hyperfide-session","handoff_digest":fresh["handoff_digest"],"context_digest":"sha256:"+"9"*64,
                       "checkpoint_reference":None,"source_manifest_digest":dead["source_manifest_digest"],"configuration_digest":dead["configuration_digest"],"recovery_reason":"SAVED_CONTEXT_UNAVAILABLE","session_persisted":False},"provenance incomplete: "+str(v))
        check("recovery.fresh-handoff-explicit",fresh_handoff)
        def unbound():
            decision(dict(fresh,handoff_digest="sha256:"+"c"*64),"BLOCKED_CONTEXT","HANDOFF_DIGEST_MISMATCH")
            decision({k:v for k,v in fresh.items()if k!="handoff_document"},"BLOCKED_CONTEXT","HANDOFF_DOCUMENT_ABSENT")
            decision(handoff(dead,"new-hyperfide-session",prior_native_session_id="other-native"),"BLOCKED_CONTEXT","HANDOFF_SESSION_MISMATCH")
        check("recovery.handoff-digest-unbound",unbound)
        check("recovery.handoff-source-substitution-refused",lambda:decision(handoff(dead,"new-hyperfide-session",source_manifest_digest="sha256:"+"f"*64),"BLOCKED_CONTEXT","HANDOFF_SOURCE_MISMATCH"))
        cp=dict(dead,saved_native_session_id=request["native_session_id"],checkpoint_reference="sha256:"+"d"*64,checkpoint_source_manifest_digest=request["source_manifest_digest"],checkpoint_configuration_digest=request["configuration_digest"])
        def unqualified():
            p=decision(cp,"BLOCKED_CONTEXT","NATIVE_RESUME_UNQUALIFIED");expect(p["native_qualification_digest"]is None,"resume qualification fabricated")
            decision(handoff(cp,"fresh-context"),"FRESH_HANDOFF","NATIVE_RESUME_UNQUALIFIED")
        check("recovery.unqualified-resume-blocked",unqualified)
        def mismatch():
            p=decision(handoff(dict(cp,saved_native_session_id="unrelated-native-session"),"fresh-context"),"FRESH_HANDOFF","CHECKPOINT_MISMATCH")
            expect(p["context_lost"]and p["provenance"]["checkpoint_reference"]==cp["checkpoint_reference"],"session crossover disguised as resume")
        check("recovery.native-session-crossover-refused",mismatch)
        check("recovery.source-crossover-refused",lambda:decision(dict(cp,checkpoint_source_manifest_digest="sha256:"+"f"*64),"BLOCKED_CONTEXT","SAVED_CONTEXT_UNAVAILABLE"))
        check("recovery.reject-unknown-field",lambda:refuse(dict(request,resumed=True)))
        check("recovery.reject-duplicate-field",lambda:refuse(json.dumps(request)[:-1]+',"connector":"claude"}'))
    finally:
        for c in CHILDREN:
            if c.poll()is None:
                try:os.killpg(c.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                c.wait(timeout=5)
    print(json.dumps({"type":"cleanup","resources":[],"complete":all(c.poll()is not None for c in CHILDREN)}),flush=True)
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
