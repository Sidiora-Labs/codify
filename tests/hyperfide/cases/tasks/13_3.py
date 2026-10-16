#!/usr/bin/env python3
"""13.3 recovery decisions, real child identity and pipe faults; no native resume claim."""
import copy,json,os,signal,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
FAILED=[]
def expect(ok,message):
    if not ok:raise AssertionError(message)
def check(identity,fn):
    try:fn();actual="observed"
    except Exception as error:actual=f"{type(error).__name__}: {error}";FAILED.append(identity)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def invoke(value):
    env=os.environ.copy();env.pop("HF_NATIVE_AUTH_SNAPSHOT_FILE",None)
    r=subprocess.run([ROOT/"build/hyperfide-native","--component","13.3","--action","connector.recover"],input=value if isinstance(value,str)else json.dumps(value),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=10)
    rows=[json.loads(x)for x in r.stdout.splitlines()if x.strip()]
    expect(len(rows)==1,"missing linked recovery response")
    return r,rows[0]
def result(value):
    r,p=invoke(value);expect(r.returncode==0 and p.get("ok")is True,"valid recovery refused");return p["result"]
def refuse(value):
    r,p=invoke(value);expect(r.returncode!=0 and p.get("ok")is False,"invalid recovery accepted")
def decision(value,name):
    p=result(value);expect(p["decision"]==name and not p["context_restored"] and not p["replay_pending_input"] and not p["grants_authority"],"recovery fabricated context/replay/authority: "+str(p))
    return p
def main():
    child=subprocess.Popen(["/bin/sleep","60"],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        boot=Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        start=Path(f"/proc/{child.pid}/stat").read_text().split()[21]
        request={"connector":"codex","native_session_id":"native-observed-fixture","source_manifest_digest":"sha256:"+"a"*64,"configuration_digest":"sha256:"+"b"*64,
         "auth_state":"VALID","transport_state":"LOST","process_state":"ALIVE_VERIFIED","process_boot_id":boot,"observed_boot_id":boot,
         "process_start_time":start,"observed_process_start_time":start,"protocol_delivery":"ACKNOWLEDGED"}
        def live():
            expect(child.poll()is None and Path(f"/proc/{child.pid}").exists(),"actual fixture child not live")
            decision(request,"RECONNECT_EXISTING")
        check("recovery.actual-process-reconnect",live)
        check("recovery.transport-independent-process",lambda:expect(child.poll()is None,"controller observation ended native child"))
        check("recovery.unknown-process-reconciles",lambda:decision(dict(request,process_state="UNKNOWN"),"RECONCILE"))
        check("recovery.pid-start-mismatch",lambda:decision(dict(request,observed_process_start_time=str(int(start)+1)),"RECONCILE"))
        check("recovery.boot-mismatch",lambda:decision(dict(request,observed_boot_id="new-boot"),"RECONCILE"))
        def partial():
            rd,wr=os.pipe()
            try:
                os.write(wr,b"partial-frame");expect(os.read(rd,1)==b"p","pipe fixture did not partially consume")
                os.close(rd);rd=-1
                try:os.write(wr,b"remaining")
                except BrokenPipeError:pass
                else:raise AssertionError("closed pipe accepted bytes")
                decision(dict(request,protocol_delivery="PARTIAL"),"REHANDSHAKE_EXISTING")
            finally:
                if rd>=0:os.close(rd)
                os.close(wr)
        check("recovery.actual-partial-pipe-no-replay",partial)
        check("recovery.auth-expired-explicit",lambda:decision(dict(request,auth_state="EXPIRED"),"BLOCKED_AUTH"))
        check("recovery.auth-revoked-explicit",lambda:decision(dict(request,auth_state="REVOKED"),"BLOCKED_AUTH"))
        os.killpg(child.pid,signal.SIGTERM);child.wait(timeout=5)
        expect(child.poll()is not None,"actual child did not exit")
        dead=dict(request,process_state="EXITED_VERIFIED")
        check("recovery.actual-exit-missing-context",lambda:decision(dead,"BLOCKED_CONTEXT"))
        fresh=dict(dead,new_agent_session_id="new-hyperfide-session",handoff_digest="sha256:"+"c"*64)
        def fresh_handoff():
            p=decision(fresh,"FRESH_HANDOFF")
            expect(p["context_lost"]and p["native_session_id"]is None and p["new_agent_session_id"]=="new-hyperfide-session"and p["handoff_digest"]=="sha256:"+"c"*64,"fresh launch invented native identity/lost handoff")
        check("recovery.fresh-handoff-explicit",fresh_handoff)
        cp=dict(dead,saved_native_session_id=request["native_session_id"],checkpoint_reference="sha256:"+"d"*64,checkpoint_source_manifest_digest=request["source_manifest_digest"],checkpoint_configuration_digest=request["configuration_digest"])
        check("recovery.unqualified-resume-blocked",lambda:decision(cp,"BLOCKED_CONTEXT"))
        def mismatch():
            p=decision(dict(cp,new_agent_session_id="fresh-context",handoff_digest="sha256:"+"e"*64,saved_native_session_id="unrelated-native-session"),"FRESH_HANDOFF")
            expect(p["reason"]=="CHECKPOINT_MISMATCH"and p["context_lost"],"session crossover disguised as resume")
        check("recovery.native-session-crossover-refused",mismatch)
        check("recovery.source-crossover-refused",lambda:decision(dict(cp,checkpoint_source_manifest_digest="sha256:"+"f"*64),"BLOCKED_CONTEXT"))
        check("recovery.reject-unknown-field",lambda:refuse(dict(request,resumed=True)))
        check("recovery.reject-duplicate-field",lambda:refuse(json.dumps(request)[:-1]+',"connector":"claude"}'))
    finally:
        if child.poll()is None:
            os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
    print(json.dumps({"type":"cleanup","resources":[],"complete":child.poll()is not None}),flush=True)
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
