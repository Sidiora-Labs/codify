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
        # Alias resolution from the CLI's own configuration, native observation, child refusal and signed server receipts.
        def private_dir(label):
            d=base/label;d.mkdir(mode=0o700,exist_ok=True);return d
        def dirs_for(label):
            return [private_dir(label+x)for x in ["-workspace","-home","-tmp"]]
        codex_ws,codex_home,codex_tmp=dirs_for("codex-alias")
        (codex_home/"config.toml").write_text('model = "fixture-model"\nmodel_provider = "openai"\n')
        (codex_home/"fixture-frontier.config.toml").write_text('model = "fixture-model"\n')
        def codex_profile(**changes):
            p=configure("codex");p["configured_provider_id"]="openai";p.update(changes);config.write_text(json.dumps(p));return p
        def codex_launch_request(p,home=codex_home):
            return {"connector":"codex","expected_version":p["binary"]["version"],"alias":p["configured_model_alias"],"auth_profile":p["profile_id"],"workspace":str(codex_ws),"home":str(home),"temp":str(codex_tmp),"permission_mode":"workspace-write"}
        def resolve_codex():
            codex_profile()
            r=success("connector.resolve",{"connector":"codex","alias":"fixture-frontier","home":str(codex_home)},env)["resolution"]
            expect(r["source"]=="cli-config"and r["resolved_model_id"]=="fixture-model"and r["resolved_provider_id"]=="openai"and r["config_path"]==str(codex_home/"fixture-frontier.config.toml"),"Codex profile layer not resolved from actual CLI configuration")
            expect(r["config_digest"]==digest((codex_home/"fixture-frontier.config.toml").read_bytes()),"resolution lost configuration provenance")
        check("connectors.alias-resolution.codex",resolve_codex)
        def unresolved():
            codex_profile()
            refuse("connector.resolve",{"connector":"codex","alias":"undeclared-alias","home":str(codex_home)},env)
            bad=private_dir("codex-bad-home");(bad/"fixture-frontier.config.toml").write_text('model = "escaped\\"model"\n')
            refuse("connector.resolve",{"connector":"codex","alias":"fixture-frontier","home":str(bad)},env)
            refuse("connector.launch",codex_launch_request(codex_profile(),bad),env)
            (bad/"fixture-frontier.config.toml").write_text('model = "fixture-model"\n');os.chmod(bad/"fixture-frontier.config.toml",0o666)
            refuse("connector.resolve",{"connector":"codex","alias":"fixture-frontier","home":str(bad)},env)
        check("connectors.alias-unresolved-refusal",unresolved)
        def drift():
            drifted=private_dir("codex-drift-home");(drifted/"fixture-frontier.config.toml").write_text('model = "another-model"\n')
            p=codex_profile();ok=success("connector.launch",codex_launch_request(p),env)
            expect(ok["alias_resolution"]["source"]=="cli-config"and ok["alias_resolution"]["resolved_model_id"]=="fixture-model","launch omitted alias provenance")
            refuse("connector.launch",codex_launch_request(p,drifted),env)
            plain=success("connector.launch",codex_launch_request(p,private_dir("codex-unconfigured-home")),env)
            expect(plain["alias_resolution"]["source"]=="auth-profile"and plain["alias_resolution"]["config_path"]is None,"absent CLI alias invented a configuration source")
        check("connectors.alias-drift-refusal",drift)
        observed={}
        def codex_observed():
            p=codex_profile();native_env=os.environ.copy();native_env["CODEX_HOME"]=str(codex_home)
            argv=success("connector.launch",codex_launch_request(p),env)["argv"]
            proc=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=native_env,start_new_session=True,cwd=codex_ws)
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
                            if line.strip()and json.loads(line).get("id")==frame["id"]:
                                row=json.loads(line);expect("error"not in row,"actual protocol rejected: "+json.dumps(row.get("error",{})));return row
                    raise AssertionError("actual protocol timed out")
                finally:selector.close()
            try:
                steps=success("connector.initialize",{"connector":"codex","request_id":"alias-init","workspace":str(codex_ws)},env)["steps"]
                for step in steps[:2]:rpc(step["frame"],step["await_response"])
                own=rpc({"id":"cli-own-config","method":"thread/start","params":{"cwd":str(codex_ws),"approvalPolicy":"never","sandbox":"read-only"}})["result"]
                expect(own["model"]=="fixture-model"and own["modelProvider"]=="openai","installed CLI read its configuration differently from the resolver")
                row=rpc(steps[2]["frame"])
                o=success("connector.observe",{"connector":"codex","alias":"fixture-frontier","home":str(codex_home),"frame":json.dumps(row)},env)
                expect(o["native_session_id"]==row["result"]["thread"]["id"]and o["observed_model_id"]=="fixture-model"and o["observed_provider_id"]=="openai"and o["matches_configuration"]is True and o["live_qualified"]is False,"native-reported model/provider/identity not recorded")
                expect(o["observation_digest"]==digest(json.dumps(row).encode()),"observation lost exact frame provenance")
                forged=copy.deepcopy(row);forged["result"]["model"]="substituted-model"
                expect(success("connector.observe",{"connector":"codex","alias":"fixture-frontier","home":str(codex_home),"frame":json.dumps(forged)},env)["matches_configuration"]is False,"substituted model accepted as configured")
                refuse("connector.observe",{"connector":"codex","alias":"fixture-frontier","home":str(codex_home),"frame":json.dumps({"id":"x","result":{"model":"fixture-model"}})},env)
                observed["codex"]=o
            finally:
                if proc.poll()is None:os.killpg(proc.pid,signal.SIGTERM)
                try:proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.communicate(timeout=5)
        check("connectors.actual-codex-alias-observed",codex_observed)
        def codex_children():
            codex_profile();v=success("connector.children",{"connector":"codex","home":str(codex_home)},env)
            expect(v["child_registration"]=="REFUSED"and v["features"]=={"multi_agent":False,"multi_agent_v2":False,"multi_agent_v2_dynamic_tools":False}and v["evidence_digest"].startswith("sha256:"),"pinned Codex did not prove delegation disabled")
            observed["codex-children"]=v
        check("connectors.child-registration-refused.codex",codex_children)
        claude_ws,claude_home,claude_tmp=dirs_for("claude-alias")
        (claude_home/".claude").mkdir(mode=0o700,exist_ok=True)
        (claude_home/".claude"/"settings.json").write_text(json.dumps({"env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"fixture-claude-model"}}))
        def claude_profile(**changes):
            p=configure("claude");p.update({"configured_model_alias":"opus","requested_model_id":"fixture-claude-model"});p.update(changes);config.write_text(json.dumps(p));return p
        def claude_observed():
            p=claude_profile()
            r=success("connector.resolve",{"connector":"claude","alias":"opus","home":str(claude_home)},env)["resolution"]
            expect(r["source"]=="cli-config"and r["resolved_model_id"]=="fixture-claude-model"and r["resolved_provider_id"]is None,"Claude alias not resolved from settings or provider invented")
            plan=success("connector.launch",{"connector":"claude","expected_version":p["binary"]["version"],"alias":"opus","auth_profile":p["profile_id"],"workspace":str(claude_ws),"home":str(claude_home),"temp":str(claude_tmp),"permission_mode":"workspace-write"},env)
            args=plan["argv"];expect(args[args.index("--model")+1]=="fixture-claude-model"and args[args.index("--disallowedTools")+1]=="Agent,Task,Workflow","launch did not pin resolved model and delegation refusal")
            frame=success("connector.encode",{"connector":"claude","request_id":"init-1","native_session_id":"pending-native-init","operation":"input","text":"reply with nothing"},env)["frame"]
            native_env={k:v for k,v in os.environ.items()if not k.startswith(("ANTHROPIC_","CLAUDE"))};native_env.update(HOME=str(claude_home),TMPDIR=str(claude_tmp),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1")
            proc=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=native_env,start_new_session=True,cwd=claude_ws)
            try:
                proc.stdin.write((json.dumps(frame)+"\n").encode());proc.stdin.flush()
                selector=selectors.DefaultSelector();selector.register(proc.stdout,selectors.EVENT_READ);deadline=time.monotonic()+30;init=None;pending=b""
                try:
                    while init is None and time.monotonic()<deadline:
                        if not selector.select(.25):continue
                        data=os.read(proc.stdout.fileno(),65536)
                        if not data:break
                        pending+=data
                        while b"\n"in pending and init is None:
                            line,pending=pending.split(b"\n",1)
                            if line.strip().startswith(b"{")and json.loads(line).get("type")=="system"and json.loads(line).get("subtype")=="init":init=line.decode()
                finally:selector.close()
                expect(init is not None,"actual Claude Code session emitted no native identity")
                o=success("connector.observe",{"connector":"claude","alias":"opus","home":str(claude_home),"frame":init},env)
                row=json.loads(init)
                expect(o["native_session_id"]==row["session_id"]and o["observed_model_id"]=="fixture-claude-model"and o["observed_provider_id"]is None and o["matches_configuration"]is True,"Claude native identity/model not recorded from actual init")
                expect(o["child_registration"]=="REFUSED"and not {"Agent","Task","Workflow"}&set(row["tools"]),"pinned Claude Code still offers native delegation")
                escaped=dict(row,tools=row["tools"]+["Workflow"])
                expect(success("connector.observe",{"connector":"claude","alias":"opus","home":str(claude_home),"frame":json.dumps(escaped)},env)["child_registration"]=="AVAILABLE","delegation tool presence not detected")
                refuse("connector.observe",{"connector":"claude","alias":"opus","home":str(claude_home),"frame":json.dumps(dict(row,claude_code_version="0.0.0"))},env)
                observed["claude"]=o
            finally:
                if proc.poll()is None:os.killpg(proc.pid,signal.SIGTERM)
                try:proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.communicate(timeout=5)
        check("connectors.actual-claude-alias-observed",claude_observed)
        # Server-side capability qualification (agents/qualification.ts) consumed by the native plan.
        receipts={}
        def qualification_registry():
            expect("codex"in observed and "codex-children"in observed,"native observations unavailable")
            p=codex_profile();o=observed["codex"]
            cli=subprocess.run([p["binary"]["path"],"--version"],text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15).stdout
            resolution=success("connector.resolve",{"connector":"codex","alias":"fixture-frontier","home":str(codex_home)},env)["resolution"]
            # Inference turns need provider credentials this sandbox does not hold: these turn-level probe digests are
            # fixture evidence for the registry derivation only, never a live qualification claim.
            fixture=lambda label:digest(("fixture-turn-evidence:"+label).encode())
            probe=lambda result,evidence,restored=False:{"result":result,"evidence_digest":evidence,"context_restored":restored}
            obs={"profile_id":p["profile_id"],"cli_version_output":cli,"binary_digest":p["binary"]["digest"],
              "resolution":{"configured_model_alias":"fixture-frontier","resolved_model_id":resolution["resolved_model_id"],"resolved_provider_id":resolution["resolved_provider_id"],"source":resolution["source"],"config_digest":resolution["config_digest"]},
              "observation":{"native_session_id":o["native_session_id"],"observed_model_id":o["observed_model_id"],"observed_provider_id":o["observed_provider_id"],"observation_digest":o["observation_digest"]},
              "probes":{"launch":probe("ACCEPTED",o["observation_digest"]),"input":probe("ACCEPTED",fixture("input")),"output":probe("ACCEPTED",fixture("output")),"steer":probe("ACCEPTED",fixture("steer")),
                "cancel":probe("ACCEPTED",fixture("cancel")),"child_registration":probe("REFUSED",observed["codex-children"]["evidence_digest"]),"resume":probe("NOT_OFFERED",fixture("resume"))}}
            resumable=copy.deepcopy(p);resumable["capabilities"]["explicit_resume"]=True
            resume_obs=copy.deepcopy(obs);resume_obs["probes"]["resume"]=probe("ACCEPTED",fixture("resume-restored"),True)
            forged=copy.deepcopy(obs);forged["state"]="QUALIFIED"
            forged_probe=copy.deepcopy(obs);forged_probe["probes"]["launch"]["qualified"]=True
            escaped=copy.deepcopy(obs);escaped["probes"]["child_registration"]=probe("ACCEPTED",fixture("child"))
            substituted=copy.deepcopy(obs);substituted["observation"]["observed_model_id"]="substituted-model"
            stale_version=copy.deepcopy(obs);stale_version["cli_version_output"]="codex-cli 0.0.0\n"
            cases={"good":{"snapshot":p,"observation":obs},"resume":{"snapshot":resumable,"observation":resume_obs},"forged_state":{"snapshot":p,"observation":forged},
              "forged_probe":{"snapshot":p,"observation":forged_probe},"child_escaped":{"snapshot":p,"observation":escaped},"substituted_model":{"snapshot":p,"observation":substituted},
              "version_drift":{"snapshot":p,"observation":stale_version},"unauthenticated":{"snapshot":p,"observation":obs,"auth":False},"worker_role":{"snapshot":p,"observation":obs,"role":"WORKER"},
              "expired":{"snapshot":p,"observation":obs,"now":int(time.time())-7200,"ttl":3600}}
            script=r"""
import fs from 'node:fs';import {generateKeyPairSync} from 'node:crypto';
import {createConnectorQualificationRegistry,rawPublicKey} from './services/hyperfide/dist/agents/qualification.js';
const cases=JSON.parse(fs.readFileSync(0,'utf8')),{privateKey}=generateKeyPairSync('ed25519'),out={public_key:rawPublicKey(privateKey),results:{}};
for(const [name,c] of Object.entries(cases)){
 const options={signingKey:privateKey,ttlSeconds:c.ttl??3600,resolve:id=>{if(id!==c.snapshot.profile_id)throw new Error('unknown profile');return c.snapshot;},
  authenticate:async()=>c.auth===false?{native_authentication:'AUTH_BLOCKED',runtime_version_verified:true}:{native_authentication:'AUTHENTICATED',runtime_version_verified:true,live_qualified:false}};
 if(c.now!==undefined){let calls=0;options.now=()=>calls++?Math.floor(Date.now()/1000):c.now;}
 const registry=createConnectorQualificationRegistry(options);
 try{const r=await registry.record({principal:{role:c.role??'RUNNER'}},c.observation);out.results[name]={ok:true,state:r.state,reasons:r.reasons,capabilities:r.payload.capabilities,receipt:r.receipt,receipt_digest:r.receipt_digest,view:registry.qualification(c.snapshot.profile_id)};}
 catch(e){out.results[name]={ok:false,code:e.code??'ERROR'};}
}
console.log(JSON.stringify(out));
"""
            r=subprocess.run(["node","--input-type=module","-e",script],input=json.dumps(cases),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=60)
            expect(r.returncode==0,"qualification registry failed: "+r.stderr[-500:])
            v=json.loads(r.stdout);res=v["results"];receipts.update(public_key=v["public_key"],results=res,profile=p,resumable=resumable)
            good=res["good"];expect(good["ok"]and good["state"]=="QUALIFIED"and good["receipt"]is not None and good["view"]=={"state":"QUALIFIED","live_qualified":True,"receipt_digest":good["receipt_digest"]},"observed capabilities not qualified server-side")
            expect(good["capabilities"]=={"launch":"QUALIFIED","input":"QUALIFIED","output":"QUALIFIED","steer":"QUALIFIED","cancel":"QUALIFIED","child_registration":"REFUSED","resume":"UNSUPPORTED"},"capability outcomes not derived per observation")
            expect(good["receipt_digest"]==digest(good["receipt"]["payload"].encode()),"receipt digest not bound to signed payload")
            expect(res["resume"]["ok"]and res["resume"]["capabilities"]["resume"]=="QUALIFIED","observed restored context not qualified for explicit-resume profile")
            for name,code in [("forged_state","INVALID_REQUEST"),("forged_probe","INVALID_REQUEST"),("child_escaped","CONNECTOR_DELEGATION_ESCAPED"),("substituted_model","CONNECTOR_MODEL_MISMATCH"),("version_drift","NATIVE_VERSION_DRIFT"),("worker_role","CONNECTOR_QUALIFICATION_SCOPE")]:
                expect(res[name]=={"ok":False,"code":code},"registry accepted "+name+": "+json.dumps(res[name]))
            expect(res["unauthenticated"]["state"]=="UNQUALIFIED"and res["unauthenticated"]["receipt"]is None and "AUTH_MODE_NOT_AUTHENTICATED"in res["unauthenticated"]["reasons"],"14.3 auth-mode probe bypassed")
            expect(res["expired"]["view"]["state"]=="STALE","expired qualification remained current")
        check("connectors.qualification-registry-derivation",qualification_registry)
        def receipt_env(name,payload=None,key=None):
            res=receipts["results"][name];receipt=dict(res["receipt"])
            if payload is not None:receipt["payload"]=payload
            kf=base/"qualification-public.key";kf.write_text((key or receipts["public_key"])+"\n");os.chmod(kf,0o600)
            rf=base/"qualification-receipt.json";rf.write_text(json.dumps(receipt));os.chmod(rf,0o600)
            return dict(env,HF_CONNECTOR_QUALIFICATION_PUBLIC_KEY_FILE=str(kf),HF_CONNECTOR_QUALIFICATION_RECEIPT_FILE=str(rf))
        def receipt_dispatch():
            expect(receipts,"server receipts unavailable")
            p=codex_profile();good=receipts["results"]["good"];request=codex_launch_request(p)
            plan=success("connector.launch",request,receipt_env("good"))
            expect(plan["dispatch_eligible"]is True and plan["live_qualified"]is True and plan["qualification_receipt_digest"]==good["receipt_digest"]and plan["observed_model_id"]=="fixture-model"and plan["observed_provider_id"]=="openai","verified server receipt did not make the plan dispatch-eligible")
            expect(not success("connector.launch",request,env)["dispatch_eligible"],"plan eligible without receipt")
            payload=good["receipt"]["payload"].replace('"issued_at":','"issued_at":1',1)
            expect(not success("connector.launch",request,receipt_env("good",payload=payload))["dispatch_eligible"],"tampered receipt payload accepted")
            other=("0"if receipts["public_key"][0]!="0"else"1")+receipts["public_key"][1:]
            expect(not success("connector.launch",request,receipt_env("good",key=other))["dispatch_eligible"],"receipt accepted under another key")
            expect(not success("connector.launch",request,receipt_env("expired"))["dispatch_eligible"],"expired receipt accepted")
            codex_profile(profile_digest="sha256:"+"c"*64)
            expect(not success("connector.launch",request,receipt_env("good"))["dispatch_eligible"],"receipt crossed to a drifted profile")
            codex_profile()
        check("connectors.qualification-receipt-dispatch",receipt_dispatch)
        def receipt_resume():
            expect(receipts,"server receipts unavailable")
            resumable=receipts["resumable"];config.write_text(json.dumps(resumable))
            frame=dict(connector="codex",request_id="resume-1",native_session_id="thread-exact",operation="resume")
            refuse("connector.encode",frame,receipt_env("good"))
            refuse("connector.launch",dict(codex_launch_request(resumable),native_session_id="thread-exact"),receipt_env("good"))
            renv=receipt_env("resume")
            expect(success("connector.encode",frame,renv)["frame"]["method"]=="thread/resume","qualified native resume refused")
            plan=success("connector.launch",dict(codex_launch_request(resumable),native_session_id="thread-exact"),renv)
            expect(plan["dispatch_eligible"]and plan["native_session_id"]=="thread-exact","qualified resume plan not dispatch-eligible")
            boot=Path("/proc/sys/kernel/random/boot_id").read_text().strip()
            recover={"connector":"codex","native_session_id":"thread-exact","source_manifest_digest":"sha256:"+"a"*64,"configuration_digest":"sha256:"+"b"*64,"auth_state":"VALID","transport_state":"LOST",
              "process_state":"EXITED_VERIFIED","process_boot_id":boot,"observed_boot_id":boot,"process_start_time":"1","observed_process_start_time":"1","protocol_delivery":"ACKNOWLEDGED",
              "saved_native_session_id":"thread-exact","checkpoint_reference":"sha256:"+"d"*64,"checkpoint_source_manifest_digest":"sha256:"+"a"*64,"checkpoint_configuration_digest":"sha256:"+"b"*64}
            def recover_with(e):
                r=subprocess.run([ROOT/"build/hyperfide-native","--component","13.3","--action","connector.recover"],input=json.dumps(recover),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=e,cwd=ROOT,timeout=20)
                row=json.loads(r.stdout);expect(r.returncode==0 and row["ok"],"recovery refused");return row["result"]
            q=recover_with(renv);expect(q["decision"]=="RESUME_EXACT_SAVED"and q["native_qualification_digest"]==receipts["results"]["resume"]["receipt_digest"]and q["context_restored"]is False,"qualified receipt not consumed by 13.3 recovery")
            expect(recover_with(receipt_env("good"))["decision"]=="BLOCKED_CONTEXT","resume-unsupported receipt simulated preserved context")
            expect(recover_with(env)["decision"]=="BLOCKED_CONTEXT","offline explicit_resume flag simulated preserved context")
            codex_profile()
        check("connectors.qualification-receipt-resume",receipt_resume)
    check("connectors.supervisory-host-probe-complete",actual_supervisory_host)
    absent=drain_owned_children()
    print(json.dumps({"type":"cleanup","resources":[],"complete":absent,"descendant_processes_observed_absent":absent}),flush=True)
    expect(absent,"actual native descendants survived fixture cleanup")
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
