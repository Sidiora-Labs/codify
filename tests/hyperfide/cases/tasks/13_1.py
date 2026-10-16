#!/usr/bin/env python3
"""13.1 component probes; actual CLI transport, no inference or live-resume claim."""
from __future__ import annotations
import copy, hashlib, json, os, selectors, shutil, signal, subprocess, sys, tempfile, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
FAILED=[]
IDS=[]
def expect(ok,detail):
    if not ok: raise AssertionError(detail)
def check(name,fn):
    IDS.append(name)
    try: fn(); actual="observed"
    except Exception as e: actual=f"{type(e).__name__}: {e}"; FAILED.append(name)
    print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def digest(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def invoke(action,value,env):
    r=subprocess.run([ROOT/"build/hyperfide-native","--component","13.1","--action",action],input=value if isinstance(value,str) else json.dumps(value),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,cwd=ROOT,timeout=20)
    rows=[json.loads(x) for x in r.stdout.splitlines() if x.strip()]
    expect(len(rows)==1,"native interface omitted bounded response")
    return r,rows[0]
def success(action,value,env):
    r,p=invoke(action,value,env);expect(r.returncode==0 and p.get("ok") is True,"native component refused valid fixture")
    return p["result"]
def refuse(action,value,env):
    r,p=invoke(action,value,env);expect(r.returncode!=0 and p.get("ok") is False,"invalid operation succeeded")
def profile(name,executable):
    version={"codex":"0.162.1","claude":"2.1.300"}[name]
    value={"schema_version":1,"profile_id":"fixture-"+name,"profile_revision":"1","profile_digest":"sha256:"+"a"*64,"connector":name,"auth_mode":"account_session",
      "binary":{"path":executable,"digest":digest(Path(os.path.realpath(executable)).read_bytes()),"version":version},"credential_reference":"fixture-unavailable",
      "configured_model_alias":"fixture-frontier","requested_model_id":"fixture-model","observed_model_id":None,"configured_provider_id":"fixture-provider","observed_provider_id":None,
      "permission_profile_id":"fixture-workspace","capabilities":{"unattended":True,"refresh":False,"concurrent_account":False,"portable_session":False,"explicit_resume":False},
      "qualification":{"state":"UNQUALIFIED","live_qualified":False,"receipt_digest":None}}
    return value
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

def actual_supervisory_host():
    result=subprocess.run([sys.executable,str(ROOT/"tests/hyperfide/cases/tasks/13_1_host.py")],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=240)
    rows=[json.loads(line)for line in result.stdout.splitlines()if line.strip()]
    assertions=[row for row in rows if row.get("type")=="assertion"]
    cleanup=[row for row in rows if row.get("type")=="cleanup"]
    expect(len(assertions)==65 and len({row.get("id")for row in assertions})==65,"host assertion inventory changed or duplicated")
    for row in assertions:
        expect(row.get("id")not in IDS,"duplicate host/native assertion identity")
        IDS.append(row["id"])
        if row.get("actual")!=row.get("expected"):FAILED.append(row["id"])
        print(json.dumps(row),flush=True)
    expect(result.returncode==0 and all(row.get("actual")==row.get("expected")for row in assertions),"actual supervisory host probe failed: "+result.stderr[-1000:])
    expect(len(cleanup)==1 and cleanup[0].get("complete")is True and cleanup[0].get("resources")==[],"host fixture cleanup incomplete")

def main():
    enable_subreaper()
    with tempfile.TemporaryDirectory(prefix="hyperfide-13-1-") as temporary:
        base=Path(temporary);env=os.environ.copy();env.pop("HF_NATIVE_AUTH_SNAPSHOT_FILE",None)
        config=base/"snapshot.json"
        def configure(name):
            exe=shutil.which(name)
            if shutil.which("mise"):
                selected=subprocess.run(["mise","which",name],text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
                if selected.returncode==0:exe=selected.stdout.strip()
            expect(exe is not None,"required installed native CLI missing")
            p=profile(name,exe);config.write_text(json.dumps(p));env["HF_NATIVE_AUTH_SNAPSHOT_FILE"]=str(config);return p
        check("connectors.registered-describe",lambda:expect(success("connector.describe",{},env)["live_qualified"] is False,"presence became live qualification"))
        check("connectors.unknown-field",lambda:refuse("connector.describe",{"fake":True},env))
        check("connectors.duplicate-field",lambda:refuse("connector.probe",'{"connector":"codex","connector":"claude"}',env))
        check("connectors.missing-trusted-profile",lambda:refuse("connector.probe",{"connector":"codex"},env))
        for name in ["codex","claude"]:
            def probe(name=name):
                p=configure(name);v=success("connector.probe",{"connector":name},env)
                expect(v["version"]==p["binary"]["version"] and v["executable_observed"] and not v["live_qualified"],"actual CLI version/presence mismatch")
            check("connectors.actual-version."+name,probe)
            def unknown_option(name=name):
                exe=shutil.which(name);expect(exe is not None,"CLI missing")
                r=subprocess.run([exe,"--hyperfide-unsupported-option"],input="",text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
                expect(r.returncode!=0,"actual CLI accepted unknown option")
            check("connectors.actual-option-refusal."+name,unknown_option)
            def launch(name=name):
                p=configure(name)
                dirs=[base/(name+x) for x in ["workspace","home","tmp"]]
                for d in dirs:d.mkdir(exist_ok=True)
                value={"connector":name,"expected_version":p["binary"]["version"],"alias":p["configured_model_alias"],"auth_profile":p["profile_id"],"workspace":str(dirs[0]),"home":str(dirs[1]),"temp":str(dirs[2]),"permission_mode":"workspace-write"}
                result=success("connector.launch",value,env)
                expect(result["argv"][0]==p["binary"]["path"] and result["requires_supervisor"] and not result["delegation_enabled"],"launch lost process/delegation boundary")
                if name=="codex":
                    args=result["argv"];expect(all(["--disable",feature]==args[index:index+2]for feature in ["multi_agent","multi_agent_v2","multi_agent_v2_dynamic_tools"]for index in [args.index(feature)-1])and "agents.enabled=false"in args,"configured delegation variant escaped explicit disabling")
                expect(not result["dispatch_eligible"] and result["observed_model_id"] is None and result["requested_model_id"]=="fixture-model","fixture config became observed model/qualified dispatch")
                if name=="claude":
                    mcp=base/"finite-supervisor-mcp.json";mcp.write_text('{"mcpServers":{}}');env["HF_SUPERVISOR_MCP_CONFIG_FILE"]=str(mcp)
                    restricted=success("connector.launch",dict(value,permission_mode="supervision"),env)
                    args=restricted["argv"];expect("--restricted"in args and args[args.index("--tools")+1]==""and "--strict-mcp-config"in args and args[args.index("--mcp-config")+1]==str(mcp)and restricted["permission_mode"]=="supervision"and not restricted["dispatch_eligible"],"native supervisor adapter lost fixed tool controls")
                else:refuse("connector.launch",dict(value,permission_mode="supervision"),env)
                forged=copy.deepcopy(p);forged["qualification"]={"state":"QUALIFIED","live_qualified":True,"receipt_digest":"sha256:"+"b"*64};forged["observed_model_id"]="forged-model";forged["observed_provider_id"]="forged-provider";config.write_text(json.dumps(forged))
                denied=success("connector.launch",value,env)
                expect(not denied["dispatch_eligible"]and denied["observed_model_id"]is None and denied["observed_provider_id"]is None,"offline flags forged authoritative native qualification")
                config.write_text(json.dumps(p))
                refuse("connector.launch",dict(value,alias="unconfigured"),env)
                refuse("connector.launch",dict(value,home=str(dirs[0])),env)
                refuse("connector.launch",dict(value,command="echo forged"),env)
            check("connectors.launch-boundary."+name,launch)
        p=configure("codex")
        changed=copy.deepcopy(p);changed["binary"]["version"]="0.0.0";config.write_text(json.dumps(changed))
        check("connectors.actual-version-mismatch",lambda:refuse("connector.probe",{"connector":"codex"},env))
        configure("codex")
        common={"connector":"codex","request_id":"request-17","native_session_id":"thread-exact"}
        check("connectors.encode-unique-request",lambda:expect(success("connector.encode",dict(common,operation="input",text="hello"),env)["frame"]["id"]=="request-17","RPC ID became shared constant"))
        def unicode():
            text="Keep café \U0001f642 and quotes: \" intact"
            value=success("connector.encode",dict(common,operation="input",text=text),env)
            expect(value["frame"]["params"]["input"][0]["text"]==text,"Unicode instruction changed")
        check("connectors.encode-unicode",unicode)
        check("connectors.steer-requires-turn",lambda:refuse("connector.encode",dict(common,operation="steer",text="change"),env))
        check("connectors.cancel-exact-turn",lambda:expect(success("connector.encode",dict(common,operation="cancel",turn_id="turn-exact"),env)["frame"]["params"]=={"threadId":"thread-exact","turnId":"turn-exact"},"cancellation lacks exact session/turn"))
        check("connectors.resume-unqualified-refusal",lambda:refuse("connector.encode",dict(common,operation="resume"),env))
        def initialize():
            steps=success("connector.initialize",{"connector":"codex","request_id":"init-1","workspace":str(base)},env)["steps"]
            expect([x["frame"]["method"] for x in steps]==["initialize","initialized","thread/start"] and steps[0]["await_response"] and steps[2]["await_response"],"handshake not sequenced")
            expect(steps[2]["frame"]["params"]["model"]=="fixture-model","requested model dropped")
        check("connectors.initialize-sequencing",initialize)
        def actual_init():
            p=configure("codex");native_home=base/"protocol-home";native_home.mkdir(mode=0o700)
            native_env=os.environ.copy();native_env["CODEX_HOME"]=str(native_home)
            proc=subprocess.Popen([p["binary"]["path"],"app-server","--listen","stdio://","--disable","multi_agent"],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=native_env,start_new_session=True,cwd=base)
            pending=b""
            def rpc(frame,reply=True):
                nonlocal pending
                proc.stdin.write(json.dumps(frame).encode()+b"\n");proc.stdin.flush()
                if not reply:return None
                selector=selectors.DefaultSelector();selector.register(proc.stdout,selectors.EVENT_READ);deadline=time.monotonic()+15
                try:
                    while time.monotonic()<deadline:
                        if b"\n"not in pending:
                            if not selector.select(.25):continue
                            data=os.read(proc.stdout.fileno(),65536);expect(data,"actual native transport closed");pending+=data
                        while b"\n"in pending:
                            line,pending=pending.split(b"\n",1)
                            if not line.strip():continue
                            row=json.loads(line)
                            if row.get("id")==frame["id"]:
                                expect("error"not in row,"actual generated protocol rejected: "+json.dumps(row.get("error",{})))
                                return row["result"]
                    raise AssertionError("actual generated protocol timed out: "+str(frame.get("method"))+" "+str(frame.get("id")))
                finally:selector.close()
            try:
                steps=success("connector.initialize",{"connector":"codex","request_id":"actual-init","workspace":str(base)},env)["steps"]
                for step in steps[:2]:rpc(step["frame"],step["await_response"])
                observed=rpc({"id":"observe-config","method":"thread/start","params":{"cwd":str(base),"approvalPolicy":"never","sandbox":"read-only"}})
                expect(isinstance(observed["thread"]["id"],str),"installed runtime omitted native identity")
                p["requested_model_id"]=observed["model"];p["configured_provider_id"]=observed["thread"]["modelProvider"];config.write_text(json.dumps(p))
                generated=success("connector.initialize",{"connector":"codex","request_id":"generated-thread","workspace":str(base)},env)["steps"][2]["frame"]
                response=rpc(generated)
                expect(isinstance(response["thread"]["id"],str)and response["thread"]["id"]!=observed["thread"]["id"],"generated start lost actual distinct native identity")
                expect(response["model"]==p["requested_model_id"]and response["thread"]["modelProvider"]==p["configured_provider_id"],"generated profile changed configured model/provider")
            finally:
                if proc.poll()is None:os.killpg(proc.pid,signal.SIGTERM)
                try:proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.communicate(timeout=5)
                expect(proc.poll()is not None,"actual CLI process escaped cleanup")
        check("connectors.actual-codex-initialize",actual_init)
        configure("claude")
        claude={"connector":"claude","request_id":"user-1","native_session_id":"session-exact","operation":"input","text":"bounded instruction"}
        check("connectors.claude-user-frame",lambda:expect(success("connector.encode",claude,env)["frame"]["message"]["content"]=="bounded instruction","Claude frame lost input"))
        check("connectors.claude-steer-unsupported",lambda:refuse("connector.encode",dict(claude,operation="steer",turn_id="turn-1"),env))
    check("connectors.supervisory-host-probe-complete",actual_supervisory_host)
    absent=drain_owned_children()
    print(json.dumps({"type":"cleanup","resources":[],"complete":absent,"descendant_processes_observed_absent":absent}),flush=True)
    expect(absent,"actual native descendants survived fixture cleanup")
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
