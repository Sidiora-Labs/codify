#!/usr/bin/env python3
"""Task 12.4 runner pause/drain/cancel/stop: registered task-component probe.

Drives build/hyperfide-native --component 12.4 against real slot-UID process
trees, real files and the real 12.4-capture HTTPS/PostgreSQL/15.2 service
(fenced coordinator authority over the 12.1 transport). Sub-probes: the 12.4
executor boundary (12_4_executor.py), native preparation staging through the
linked runner.preparation.stage action, kernel budget primitives and the
preparation-receipt verifier. No provider, frontier or cloud call is made; this
grants no full-case V-006/V-017 qualification.
"""
from __future__ import annotations
import base64,ctypes,hashlib,importlib.util,json,os,shutil,signal,sqlite3,subprocess,sys,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
SUPPORT=ROOT/"tests/hyperfide/support"
RESULTS=[]
def uid():return str(uuid.uuid4())
def sha(b):return "sha256:"+hashlib.sha256(b).hexdigest()
def expect(value,message):
    if not value:raise AssertionError(message)
def check(name,fn):
    try:fn();actual="observed"
    except Exception as error:actual=type(error).__name__+": "+str(error)[:800]
    RESULTS.append((name,actual));print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
slots=load("hf_12_4_workspace_fixture",SUPPORT/"workspace_registration_fixture.py")
POLICY={"grace_ms":1500,"drain_deadline_ms":60000,"on_drain_deadline":"REPORT"}
OUTPUTS=["launch.stderr","launch.stdout"]
TRAP=("import os,signal,sys,time\nmarker=sys.argv[1] if len(sys.argv)>1 else None\n"
      "def term(*_):\n    open(%r,'w').write('graceful');os._exit(0)\nsignal.signal(signal.SIGTERM,term)\ntime.sleep(600)")

class Control:
    def __init__(self):
        self.objects=load("hf_12_4_objects",ROOT/"tests/hyperfide/cases/tasks/15_2.py")
        identity=load("hf_12_4_identity",SUPPORT/"identity_fixture.py")
        self.store=self.objects.ObjectFixture();self.f=None;self.n=None
        o=self.objects
        def setup(f):
            f.env.update({"HF_ARTIFACT_S3_ENDPOINT":self.store.endpoint,"HF_ARTIFACT_ALLOW_LOOPBACK_HTTP":"1","HF_ARTIFACT_S3_REGION":o.REGION,"HF_ARTIFACT_S3_BUCKET":o.BUCKET,
                "HF_ARTIFACT_S3_ACCESS_KEY_ID":o.KEY,"HF_ARTIFACT_S3_SECRET_ACCESS_KEY":o.SECRET,"HF_ARTIFACT_S3_SESSION_TOKEN":o.TOKEN,
                "HF_ARTIFACT_ORGANISATION_ID":f.ids["organisation"],"HF_ARTIFACT_ALLOWED_RUN_IDS":json.dumps([f.ids["run"]])})
        try:
            self.f=identity.IdentityFixture(extra_components=("15.2","12.4-capture"),extra_setup=setup,database="hf_task_12_4_control")
            self.f.bootstrap_runner()
            i=self.f.ids;self.scope={"organisation_id":i["organisation"],"run_id":i["run"],"sandbox_id":i["sandbox"],"boot_id":i["boot"],"epoch":i["epoch"]}
            self.transport={"origin":self.f.origin,"ca_file":str(self.f.ca),"key_path":str(self.f.keys["runner"]["path"]),"credential_id":i["runner"],"timeout_ms":5000}
            self.base=Path(tempfile.mkdtemp(prefix="hf-12-4-control-"))
            self.n=slots.NativeRunner(self.base,self.scope)
            self.marks=Path(tempfile.mkdtemp(prefix="hf-12-4-marks-"));self.marks.chmod(0o1777)
        except BaseException:self.close();raise
    def svc(self,action,value,key="operator"):
        status,body=self.f.invoke(action,value,component="12.4-capture",key=key)
        return body.get("result") if body.get("ok") else None,(body.get("error") or {}).get("code")
    def ok(self,action,value,key="operator"):
        result,code=self.svc(action,value,key);expect(result is not None,action+" refused: "+str(code));return result
    def refused(self,action,value,code,key="operator"):
        result,actual=self.svc(action,value,key);expect(result is None and actual==code,action+" expected "+code+" got "+str(actual))
    def issue(self,action,launch,policy=POLICY,outputs=OUTPUTS,generation=None,command=None):
        value={"command_id":command or uid(),"action":action,"launch_id":launch["launch_id"],"slot_id":launch["slot_id"],"sandbox_id":self.scope["sandbox_id"],"boot_generation":"1",
               "attempt_id":launch["attempt_id"],"attempt_generation":generation or launch["attempt_generation"],"policy":policy,"required_outputs":list(outputs)}
        return self.ok("runner.control.issue",value)
    def run(self,action,launch,command,**extra):
        return self.n.native(action,self.n.request(launch,command,**extra))
    def inspect(self,command):return self.ok("runner.control.inspect",{"command_id":command})
    def published(self,attempt,generation):return self.ok("runner.publication.check",{"attempt_id":attempt,"attempt_generation":generation})["allowed"]
    def states(self,user):return [s for _,s in slots.uid_processes(user)]
    def close(self):
        clean=True
        if self.n:clean=self.n.close()
        if getattr(self,"marks",None):shutil.rmtree(self.marks,ignore_errors=True)
        if self.f:self.f.close()
        self.store.stop();return clean

RESPAWN=("import os,sys,time\nuser,until=int(sys.argv[1]),time.monotonic()+float(sys.argv[2])\n"
 "while time.monotonic()<until:\n    if os.fork()==0:\n        os.setgroups([]);os.setgid(user);os.setuid(user);time.sleep(600);os._exit(0)\n"
 "    time.sleep(.004)\n    try:\n        while os.waitpid(-1,os.WNOHANG)[0]>0:pass\n    except ChildProcessError:pass\n")
def respawner(user,seconds):
    """Root-owned escaping workload: keeps creating slot-UID processes during termination."""
    return subprocess.Popen([sys.executable,"-I","-c",RESPAWN,str(user),str(seconds)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

VALIDATE=r"""
import path from 'node:path';import {pathToFileURL} from 'node:url';
const {validateNativeControlReceipt}=await import(pathToFileURL(path.join(process.cwd(),'services/hyperfide/dist/runner/executor.js')).href);
let input='';for await(const chunk of process.stdin)input+=chunk;
const out=JSON.parse(input).map(({receipt,target,command_id,action})=>{try{validateNativeControlReceipt(receipt,target,command_id,action);return 'ACCEPTED';}catch(e){return e.code||String(e);}});
process.stdout.write(JSON.stringify(out));
"""
def validate(items):
    result=subprocess.run(["node","--input-type=module","-e",VALIDATE],input=json.dumps(items),cwd=ROOT,capture_output=True,text=True,timeout=60)
    expect(result.returncode==0,"validator process failed: "+result.stderr[-600:]);return json.loads(result.stdout)

def control_probe(c):
    n=c.n;receipts={}
    # ---------------------------------------------------------------- authority
    a=n.add_launch(n.add_slot(62041));n.tree(a["uid"],2)
    trap=n.spawn(a["uid"],TRAP%str(c.marks/"cancel-term"));n.wait(lambda:len(slots.uid_processes(a["uid"]))>=4)
    pause=c.issue("runner.pause",a)["command_id"]
    def transport_required():
        rc,result,code=c.run("runner.pause",a,pause)
        expect(rc!=0 and result is None and code=="AUTHORITY_TRANSPORT_UNCONFIGURED","native acted without coordinator transport: "+str(code))
        expect(n.launch_state(a["launch_id"])=="RUNNING" and "T" not in c.states(a["uid"]),"refused command changed the slot")
    check("control.authority.transport-required",transport_required)
    n.configure(c.transport)
    def unissued():
        command=uid();rc,_,code=c.run("runner.pause",a,command)
        expect(rc!=0 and code=="CONTROL_AUTHORITY_REFUSED:CONTROL_COMMAND_UNKNOWN","unissued command was not refused by the coordinator: "+str(code))
        expect(n.control("refusals","command=?",(command,))[0]["code"]==code and not n.control("commands","id=?",(command,)),"refusal not recorded or command applied")
    check("control.authority.unissued-command-refused",unissued)
    def unreachable():
        path=n.configure({**c.transport,"origin":"https://localhost:1","timeout_ms":1000},"unreachable.json")
        rc,_,code=c.run("runner.pause",a,pause,config_path=str(path))
        expect(rc!=0 and code=="AUTHORITY_UNAVAILABLE" and "T" not in c.states(a["uid"]),"unreachable coordinator did not fail closed: "+str(code))
    check("control.authority.unreachable-coordinator-refused",unreachable)
    check("service.control.issue-requires-coordinator",lambda:c.refused("runner.control.issue",{"command_id":uid(),"action":"runner.stop","launch_id":a["launch_id"],"slot_id":a["slot_id"],"sandbox_id":c.scope["sandbox_id"],"boot_generation":"1","attempt_id":a["attempt_id"],"attempt_generation":"1","policy":POLICY,"required_outputs":[]},"ROLE_DENIED",key="runner"))
    # ---------------------------------------------------------------- pause / resume
    def paused():
        rc,r,code=c.run("runner.pause",a,pause)
        expect(rc==0 and r["status"]=="PAUSED" and r["phase"]=="PAUSED" and r["termination"]=="FROZEN","pause not confirmed: "+str(code or r))
        expect(r["remaining_descendants"]==4 and all(p["state"] in ("T","t") for p in r["processes"]) and set(c.states(a["uid"]))<={"T","t"},"tree not frozen")
        expect(n.launch_state(a["launch_id"])=="PAUSED" and r["fence"]=={"admission_closed":True,"input_closed":True,"publication_fenced":False},"input/admission not fenced")
        expect(r["authority"]["verified_via"].startswith("12.1-transport") and r["authority"]["fence_sequence"]=="1","fenced coordinator authority not recorded")
        row=c.inspect(pause);expect(row["outcome"]=="PAUSED" and row["termination"]=="FROZEN" and r["report_delivered"] is True,"pause outcome not reported")
        receipts["pause"]=(r,a,pause)
    check("control.pause.freezes-tree-keeps-processes-fences-input",paused)
    def observed():
        rc,r,_=n.native("runner.observe",n.request(a))
        expect(rc==0 and r["control"]=={"command_id":pause,"action":"runner.pause","phase":"PAUSED"} and r["status"]=="UNKNOWN" and r["remaining_descendants"]==4 and r["cleanup_complete"] is False,"observation hides control phase")
    check("control.observe.reports-control-phase",observed)
    def resumed():
        command=c.issue("runner.resume",a)["command_id"];rc,r,code=c.run("runner.resume",a,command)
        expect(rc==0 and r["status"]=="RUNNING" and r["phase"]=="RESUMED" and not {"T","t"}&set(c.states(a["uid"])),"resume did not thaw: "+str(code or r))
        expect(n.launch_state(a["launch_id"])=="RUNNING" and r["fence"]["admission_closed"] is False and r["fence"]["input_closed"] is False,"resume did not reopen admission")
    check("control.resume.thaws-and-reopens-admission",resumed)
    # ---------------------------------------------------------------- drain
    drain=c.issue("runner.drain",a)["command_id"]
    def draining():
        rc,r,code=c.run("runner.drain",a,drain)
        expect(rc==0 and r["status"]=="DRAINING" and r["phase"]=="DRAINING" and r["remaining_descendants"]==4 and not {"T","t"}&set(c.states(a["uid"])),"drain stopped or froze in-flight work: "+str(code or r))
        expect(r["fence"]["admission_closed"] is True and n.launch_state(a["launch_id"])=="DRAINING","drain admitted new work")
        expect(c.inspect(drain)["outcome"]=="DRAINING","non-final drain not reported")
    check("control.drain.in-flight-work-continues",draining)
    def drain_repeat():
        rc,r,_=c.run("runner.drain",a,drain);expect(rc==0 and r["replayed"] is False and r["phase"]=="DRAINING" and len(slots.uid_processes(a["uid"]))==4,"repeat drain did not re-evaluate")
    check("control.drain.repeat-reevaluates-while-in-flight",drain_repeat)
    b=n.add_launch(n.add_slot(62042));n.spawn(b["uid"],"import time\ntime.sleep(2.5)");n.wait(lambda:slots.uid_processes(b["uid"]))
    drain_b=c.issue("runner.drain",b)["command_id"]
    def drained():
        rc,r,_=c.run("runner.drain",b,drain_b);expect(rc==0 and r["phase"]=="DRAINING","short work not in flight")
        expect(n.wait(lambda:not slots.uid_processes(b["uid"]),10),"in-flight work did not finish")
        rc,r,code=c.run("runner.drain",b,drain_b)
        expect(rc==0 and r["status"]=="DRAINED" and r["termination"]=="CONFIRMED" and r["terminated_by_policy"] is False and r["remaining_descendants"]==0,"drain did not complete: "+str(code or r))
        expect(r["cleanup_complete"] is True and n.slot_state(b["slot_id"])=="CLEANUP_REQUIRED" and n.credentials(b["slot_id"])==[],"drained slot not cleaned and gated")
    check("control.drain.completes-after-in-flight-work",drained)
    d=n.add_launch(n.add_slot(62043));n.tree(d["uid"],1)
    drain_d=c.issue("runner.drain",d,policy={"grace_ms":200,"drain_deadline_ms":300,"on_drain_deadline":"STOP"})["command_id"]
    def deadline():
        c.run("runner.drain",d,drain_d);time.sleep(1.4);rc,r,code=c.run("runner.drain",d,drain_d)
        expect(rc==0 and r["status"]=="DRAINED" and r["terminated_by_policy"] is True and not slots.uid_processes(d["uid"]),"deadline policy did not terminate: "+str(code or r))
    check("control.drain.deadline-policy-terminates",deadline)
    # ---------------------------------------------------------------- cancel
    cancel=c.issue("runner.cancel",a)
    def fenced_before_delivery():
        expect(cancel["revocation"]["publication_fenced"] is True and cancel["revocation"]["fenced_generation"]=="1","coordinator fence not raised at issue")
        expect(len(slots.uid_processes(a["uid"]))==4 and c.published(a["attempt_id"],"1") is False,"publication not fenced while the process continues")
        expect(c.published(a["attempt_id"],"2") is True,"replacement generation blocked after fence")
        expect(c.inspect(drain)["state"]=="SUPERSEDED","pending drain not superseded by cancel")
    check("service.cancel.publication-fenced-before-native-delivery",fenced_before_delivery)
    check("service.control.terminating-launch-blocks-pause",lambda:c.refused("runner.control.issue",{"command_id":uid(),"action":"runner.pause","launch_id":a["launch_id"],"slot_id":a["slot_id"],"sandbox_id":c.scope["sandbox_id"],"boot_generation":"1","attempt_id":a["attempt_id"],"attempt_generation":"1","policy":POLICY,"required_outputs":[]},"CONTROL_LAUNCH_TERMINATING"))
    first={}
    def cancelled():
        rc,r,code=c.run("runner.cancel",a,cancel["command_id"])
        expect(rc==0 and r["status"]=="CANCELLED" and r["phase"]=="CANCELLED" and r["termination"]=="CONFIRMED" and r["remaining_descendants"]==0 and r["processes"]==[] and r["ipc_closed"] is True,"cancel not confirmed: "+str(code or r))
        expect(not slots.uid_processes(a["uid"]) and not (c.marks/"cancel-term").exists(),"cancel granted a TERM grace period or left processes")
        expect(n.launch_state(a["launch_id"])=="CANCELLED" and r["fence"]["publication_fenced"] is True,"launch ledger not cancelled/fenced")
        first.update(r);receipts["cancel"]=(r,a,cancel["command_id"])
    check("control.cancel.kills-tree-without-grace",cancelled)
    def revoked():
        names={x["name"]:x["state"] for x in first["credential_revocation"]}
        expect(names=={"worker-token":"REVOKED","coordinator.publication-fence":"REVOKED"} and n.credentials(a["slot_id"])==[],"slot credentials not revoked: "+json.dumps(names))
    check("control.cancel.credentials-revoked",revoked)
    def durable():
        arts={x["name"]:x for x in first["required_artifacts"]}
        expect(sorted(arts)==OUTPUTS and all(x["local_durable"] and x["capture_receipt"] and x["capture_receipt"].startswith("sha256:") for x in arts.values()),"required outputs not captured")
        expect(arts["launch.stdout"]["digest"]==sha((n.state/(a["launch_id"]+".stdout")).read_bytes()),"captured digest differs from the log bytes")
        row=c.inspect(cancel["command_id"])
        expect(row["missing_outputs"]==[] and all(x["state"]=="COMPLETE" and x["manifest_artifact_id"] for x in row["captures"]),"service capture incomplete")
        manifest=c.f.invoke("artifact.manifest.read",{"organisation_id":c.scope["organisation_id"],"run_id":c.scope["run_id"],"artifact_id":row["captures"][1]["manifest_artifact_id"]},component="15.2")[1]
        expect(manifest.get("ok") and manifest["result"]["content_digest"]==arts["launch.stdout"]["digest"],"15.2 manifest does not hold the captured bytes")
    check("control.cancel.required-outputs-durable-in-artifact-store",durable)
    def confirmed():
        row=c.inspect(cancel["command_id"])
        expect(first["cleanup_complete"] is True and first["cleanup_debt"]==[] and row["outcome"]=="CANCELLED" and row["termination"]=="CONFIRMED" and row["cleanup_complete"] is True,"confirmed cleanup not reported")
    check("control.cancel.reports-confirmed-cleanup",confirmed)
    def repeat():
        rc,r,_=c.run("runner.cancel",a,cancel["command_id"])
        strip=lambda v:{k:x for k,x in v.items() if k not in ("replayed","report_delivered")}
        expect(rc==0 and r["replayed"] is True and strip(r)==strip(first),"repeat did not return the recorded outcome")
    check("control.repeat.cancel-returns-recorded-outcome",repeat)
    def conflict():
        rc,_,code=c.run("runner.stop",a,cancel["command_id"]);expect(rc!=0 and code=="COMMAND_CONFLICT","reused command id was not refused: "+str(code))
    check("control.repeat.conflicting-command-refused",conflict)
    def lost_ack():
        before=c.inspect(cancel["command_id"])["report_digest"]
        with sqlite3.connect(n.state/"control.db") as db:db.execute("UPDATE commands SET report_delivered=0 WHERE id=?",(cancel["command_id"],))
        rc,r,_=c.run("runner.cancel",a,cancel["command_id"])
        expect(rc==0 and r["replayed"] is True and r["report_delivered"] is True and c.inspect(cancel["command_id"])["report_digest"]==before,"lost acknowledgement not redelivered idempotently")
        expect(n.control("commands","id=?",(cancel["command_id"],))[0]["report_delivered"]==1,"redelivery not durable")
    check("control.ack.lost-report-redelivered-idempotently",lost_ack)
    # ---------------------------------------------------------------- ordering
    e=n.add_launch(n.add_slot(62044));n.tree(e["uid"],1)
    def superseded():
        stale=c.issue("runner.pause",e)["command_id"];c.issue("runner.drain",e)
        rc,_,code=c.run("runner.pause",e,stale)
        expect(rc!=0 and code=="CONTROL_AUTHORITY_REFUSED:CONTROL_COMMAND_SUPERSEDED" and "T" not in c.states(e["uid"]),"superseded command acted: "+str(code))
    check("control.ordering.superseded-command-refused",superseded)
    def stale_generation():
        c.issue("runner.drain",e,generation="3")
        c.refused("runner.control.issue",{"command_id":uid(),"action":"runner.drain","launch_id":e["launch_id"],"slot_id":e["slot_id"],"sandbox_id":c.scope["sandbox_id"],"boot_generation":"1","attempt_id":e["attempt_id"],"attempt_generation":"2","policy":POLICY,"required_outputs":[]},"CONTROL_ATTEMPT_GENERATION_STALE")
    check("service.control.stale-attempt-generation-refused",stale_generation)
    def mismatch():
        command=c.issue("runner.stop",e,generation="3")["command_id"];rc,_,code=c.run("runner.stop",e,command)
        expect(rc!=0 and code=="AUTHORITY_TARGET_MISMATCH" and len(slots.uid_processes(e["uid"]))==2,"command for another attempt generation acted: "+str(code))
    check("control.authority.generation-mismatch-refused",mismatch)
    # ---------------------------------------------------------------- stop, slot reuse gate
    s=n.add_launch(n.add_slot(62045));n.tree(s["uid"],1);n.spawn(s["uid"],TRAP%str(c.marks/"stop-term"));n.wait(lambda:len(slots.uid_processes(s["uid"]))>=3)
    c.ok("runner.workspace.register",{"slot_id":s["slot_id"],"slot_generation":"1"},key="runner")
    c.ok("runner.workspace.lease",{"sandbox_id":c.scope["sandbox_id"],"boot_generation":"1","slot_id":s["slot_id"],"launch_id":s["launch_id"],"expected_slot_generation":"1"})
    stop=c.issue("runner.stop",s,policy={"grace_ms":3000,"drain_deadline_ms":1000,"on_drain_deadline":"REPORT"})["command_id"]
    def graceful():
        rc,r,code=c.run("runner.stop",s,stop)
        expect(rc==0 and r["status"]=="CONFIRMED_STOPPED" and r["phase"]=="STOPPED" and r["termination"]=="CONFIRMED" and not slots.uid_processes(s["uid"]),"stop not confirmed: "+str(code or r))
        expect((c.marks/"stop-term").exists() and (c.marks/"stop-term").read_text()=="graceful","stop did not deliver TERM within the grace period")
        expect(n.slot_state(s["slot_id"])=="CLEANUP_REQUIRED" and c.inspect(stop)["outcome"]=="STOPPED","stopped slot remained reusable")
    check("control.stop.graceful-term-then-confirmed",graceful)
    release=lambda:n.native("runner.slot.release",{"state_dir":str(n.state),"launch_id":s["launch_id"],"command_id":stop})
    def process_residue():
        n.spawn(s["uid"],"import time\ntime.sleep(600)");n.wait(lambda:slots.uid_processes(s["uid"]))
        rc,r,_=release()
        expect(rc==0 and r["reusable"] is False and "PROCESS_RESIDUE" in r["blocking"] and r["coordinator_workspace"]=="CLEANING" and n.slot_state(s["slot_id"])=="CLEANUP_REQUIRED","process residue did not block reuse: "+json.dumps(r and r["blocking"]))
        c.refused("runner.workspace.lease",{"sandbox_id":c.scope["sandbox_id"],"boot_generation":"1","slot_id":s["slot_id"],"launch_id":uid(),"expected_slot_generation":"1"},"WORKSPACE_NOT_FREE")
        for pid,_ in slots.uid_processes(s["uid"]):os.kill(pid,signal.SIGKILL)
        n.wait(lambda:not slots.uid_processes(s["uid"]))
    check("control.slot.reuse-refused-with-process-residue",process_residue)
    def credential_residue():
        stale=n.slots/s["slot_id"]/"home/.hyperfide/credentials/agent-cache";stale.mkdir();os.chown(stale,s["uid"],s["uid"])
        rc,r,_=release()
        expect(rc==0 and r["reusable"] is False and r["blocking"]==["CREDENTIAL_RESIDUE","COORDINATOR_WORKSPACE_NOT_FREE"] and r["credential_residue"]==1,"credential residue did not block reuse: "+json.dumps(r and r["blocking"]))
        stale.rmdir()
    check("control.slot.reuse-refused-with-credential-residue",credential_residue)
    def reusable():
        rc,r,_=release()
        expect(rc==0 and r["reusable"] is True and r["blocking"]==[] and r["coordinator_workspace"]=="FREE" and n.slot_state(s["slot_id"])=="READY" and n.launch_state(s["launch_id"])=="STOPPED","verified cleanup did not release the slot: "+json.dumps(r and r["blocking"]))
        w=c.ok("runner.workspace.inspect",{"sandbox_id":c.scope["sandbox_id"],"boot_generation":"1","slot_id":s["slot_id"]})
        expect(w["state"]=="FREE" and w["slot_generation"]=="2" and w["process_residue"]=="ABSENT" and w["credential_residue"]=="ABSENT" and w["outputs_durable"] is True,"coordinator workspace not reset to a new generation")
        c.ok("runner.workspace.lease",{"sandbox_id":c.scope["sandbox_id"],"boot_generation":"1","slot_id":s["slot_id"],"launch_id":uid(),"expected_slot_generation":"2"})
    check("control.slot.reused-only-after-verified-cleanup",reusable)
    # ---------------------------------------------------------------- unresolved stop, restart
    u=n.add_launch(n.add_slot(62046));n.tree(u["uid"],1)
    unresolved=c.issue("runner.stop",u,policy={"grace_ms":100,"drain_deadline_ms":1000,"on_drain_deadline":"REPORT"})["command_id"]
    def unresolved_stop():
        helper=respawner(u["uid"],40);n.wait(lambda:len(slots.uid_processes(u["uid"]))>=4)
        try:
            rc,r,code=c.run("runner.stop",u,unresolved)
            expect(rc==0 and r["status"]=="UNKNOWN" and r["phase"]=="STOPPING" and r["termination"]=="UNRESOLVED" and r["cleanup_complete"] is False and r["recovery_required"] is True,"escaping tree reported as stopped: "+str(code or r))
            expect(any(x.startswith("PROCESS_RESIDUE") for x in r["cleanup_debt"]),"unresolved termination hidden from cleanup debt")
            row=c.inspect(unresolved);expect(row["outcome"]=="UNRESOLVED" and row["termination"]=="UNRESOLVED" and row["cleanup_complete"] is False,"coordinator received a false completion")
            receipts["stop"]=(r,u,unresolved)
        finally:helper.kill();helper.wait(timeout=10)
    check("control.stop.unresolved-termination-reported-never-complete",unresolved_stop)
    def restart():
        rc,r,code=n.native("runner.reconcile",{"state_dir":str(n.state)})
        item=[x for x in (r or {}).get("commands",[]) if x["command_id"]==unresolved]
        expect(rc==0 and item and item[0]["phase_before"]=="STOPPING" and item[0]["phase"]=="STOPPED" and item[0]["report_delivered"] is True,"restart reconciliation did not finish the stop: "+str(code or r))
        expect(not slots.uid_processes(u["uid"]) and c.inspect(unresolved)["outcome"]=="STOPPED","reconciled stop not confirmed")
    check("control.restart.reconcile-completes-in-progress-stop",restart)
    def repeat_stop():
        rc,r,_=c.run("runner.stop",u,unresolved);expect(rc==0 and r["replayed"] is True and r["status"]=="CONFIRMED_STOPPED","repeated stop after restart differs")
    check("control.repeat.stop-after-restart-returns-recorded-outcome",repeat_stop)
    # ---------------------------------------------------------------- cancel before launch acknowledgement
    p_slot=n.add_slot(62047);late={"launch_id":uid(),"attempt_id":uid(),"attempt_generation":"1",**p_slot}
    early=c.issue("runner.cancel",late)["command_id"]
    def before_ack():
        rc,r,code=c.run("runner.cancel",late,early)
        expect(rc==0 and r["prelaunch"] is True and r["status"]=="UNRESOLVED" and "LAUNCH_NOT_STARTED_FENCE_PENDING" in r["cleanup_debt"] and r["cleanup_complete"] is False,"pre-acknowledgement cancel misreported: "+str(code or r))
        expect(n.control("fences","launch=?",(late["launch_id"],))[0]["publication_fenced"]==1 and c.published(late["attempt_id"],"1") is False,"pre-launch cancel not fenced")
    check("control.cancel.before-launch-acknowledgement-fenced",before_ack)
    def after_reconnect():
        n.add_launch(p_slot,launch=late["launch_id"],attempt=late["attempt_id"]);n.tree(p_slot["uid"],1)
        rc,r,code=c.run("runner.cancel",late,early)
        expect(rc==0 and r["status"]=="CANCELLED" and r["prelaunch"] is False and not slots.uid_processes(p_slot["uid"]) and c.inspect(early)["outcome"]=="CANCELLED","late launch not cancelled: "+str(code or r))
    check("control.cancel.after-reconnect-terminates-late-launch",after_reconnect)
    # ---------------------------------------------------------------- disconnected jobs
    def disconnected_job():
        user=62048;n.uids.append(user);gone=subprocess.Popen(["/bin/true"]);gone.wait()
        op,live_op=uid(),uid();keeper=n.spawn(62049,"import time\ntime.sleep(600)");n.uids.append(62049);n.wait(lambda:slots.uid_processes(62049))
        start=(Path("/proc")/str(keeper.pid)/"stat").read_text().rsplit(")",1)[1].split()[19]
        with sqlite3.connect(n.state/"jobs.db") as db:
            db.executescript("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,digest TEXT NOT NULL,state TEXT NOT NULL,uid INTEGER NOT NULL,pid INTEGER,start_time TEXT,os_boot_id TEXT);")
            db.execute("INSERT INTO jobs VALUES(?,?,'START_RECORDED',?,?,'1',?)",(op,sha(b"job"),user,gone.pid,n.boot))
            db.execute("INSERT INTO jobs VALUES(?,?,'START_RECORDED',?,?,?,?)",(live_op,sha(b"live"),62049,keeper.pid,start,n.boot))
        (n.state/"jobs.db").chmod(0o600)
        n.spawn(user,"import time\ntime.sleep(600)");n.wait(lambda:slots.uid_processes(user))
        rc,r,code=n.native("runner.reconcile",{"state_dir":str(n.state)})
        jobs={x["operation_id"]:x for x in (r or {}).get("jobs",[])}
        expect(rc==0 and jobs.get(op,{}).get("outcome")=="CANCELLED_DISCONNECTED" and jobs[op]["termination"]=="CONFIRMED" and not slots.uid_processes(user),"disconnected job not cancelled: "+str(code or r))
        expect(json.loads((n.state/("job-"+op+".cancelled.json")).read_text())["outcome"]=="CANCELLED_DISCONNECTED","cancellation receipt missing")
        with sqlite3.connect(n.state/"jobs.db") as db:states=dict(db.execute("SELECT id,state FROM jobs"))
        expect(states[op]=="TERMINAL" and states[live_op]=="START_RECORDED" and live_op not in jobs and slots.uid_processes(62049),"reconcile touched a live job or left the slot occupied")
        expect(n.control("job_cancellations","operation=?",(op,))[0]["reason"]=="EXECUTOR_DISCONNECTED","job cancellation not recorded")
    check("control.restart.disconnected-job-cancelled-live-job-untouched",disconnected_job)
    def provisioner_validator():
        def item(name,action,mutate=None):
            r,launch,command=receipts[name];r=json.loads(json.dumps(r))
            if mutate:mutate(r)
            target={"launch_id":launch["launch_id"],"attempt_id":launch["attempt_id"],"attempt_generation":launch["attempt_generation"],"sandbox_id":c.scope["sandbox_id"],"boot_id":c.scope["boot_id"],"boot_generation":"1","uid":launch["uid"]}
            return {"receipt":r,"target":target,"command_id":command,"action":action}
        def thawed(r):r["processes"][0]["state"]="S"
        def forged(r):r["required_artifacts"][0]["capture_receipt"]=None
        def complete(r):r["cleanup_complete"]=True
        verdicts=validate([item("pause","runner.pause"),item("cancel","runner.cancel"),item("stop","runner.stop"),item("pause","runner.pause",thawed),item("cancel","runner.cancel",forged),item("stop","runner.stop",complete),item("cancel","runner.stop")])
        expect(verdicts==["ACCEPTED","ACCEPTED","ACCEPTED","RUNNER_CONTROL_RECEIPT_CONTRADICTION","RUNNER_CONTROL_RECEIPT_CONTRADICTION","RUNNER_CONTROL_RECEIPT_CONTRADICTION","RUNNER_CONTROL_RECEIPT_INVALID"],"provisioner validator verdicts differ: "+json.dumps(verdicts))
    check("control.provisioner-validator-checks-native-receipts",provisioner_validator)
    # ---------------------------------------------------------------- service negative boundaries
    t=n.add_launch(n.add_slot(62050))
    def contradiction():
        command=c.issue("runner.stop",t)["command_id"]
        c.refused("runner.control.report",{"command_id":command,"outcome":"STOPPED","termination":"CONFIRMED","remaining_descendants":2,"cleanup_complete":False,"cleanup_debt":[],"credential_revocation":[],"receipt_digest":sha(b"r")},"CONTROL_REPORT_CONTRADICTION",key="runner")
        c.refused("runner.control.report",{"command_id":command,"outcome":"STOPPED","termination":"UNRESOLVED","remaining_descendants":0,"cleanup_complete":False,"cleanup_debt":[],"credential_revocation":[],"receipt_digest":sha(b"r")},"CONTROL_REPORT_CONTRADICTION",key="runner")
        c.refused("runner.control.report",{"command_id":command,"outcome":"STOPPED","termination":"CONFIRMED","remaining_descendants":0,"cleanup_complete":True,"cleanup_debt":[],"credential_revocation":[],"receipt_digest":sha(b"r")},"CONTROL_CLEANUP_UNPROVEN",key="runner")
        c.refused("runner.capture.put",{"command_id":command,"name":"job."+uid()+".receipt","sequence":0,"offset_bytes":"0","total_digest":sha(b""),"total_size_bytes":"0","data_base64":""},"CAPTURE_NOT_REQUIRED",key="runner")
    check("service.report.contradiction-and-unproven-cleanup-refused",contradiction)
    check("service.control.resume-requires-paused-or-drained",lambda:c.refused("runner.control.issue",{"command_id":uid(),"action":"runner.resume","launch_id":uid(),"slot_id":t["slot_id"],"sandbox_id":c.scope["sandbox_id"],"boot_generation":"1","attempt_id":uid(),"attempt_generation":"1","policy":POLICY,"required_outputs":[]},"CONTROL_RESUME_STATE_INVALID"))
    def preparation_receipt():
        f=c.f;i=f.ids;org,run=i["organisation"],i["run"];repository,slot,session,reservation,account=uid(),uid(),uid(),uid(),uid()
        f.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'receipt-fixture','https://invalid.example/never-cloned.git')",[org,repository,i["project"]])
        f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,'receipt-fixture',1,'TEST','READY')",[org,slot,i["sandbox"]])
        f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,id,pool_id,dimension,configured_limit,provenance_digest) VALUES($1,$2,$3,'TEST',1,$4)",[org,account,i["pool"],sha(b"receipt")])
        f.sql("INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,capacity_account_id,quantity,expires_at) VALUES($1,$2,$3,$4,$5,0,clock_timestamp()+interval '1 hour')",[org,run,reservation,uid(),account])
        pin=sha(b"receipt-fixture")
        f.sql("INSERT INTO hyperfide.runner_registry(organisation_id,run_id,session_id,credential_id,sandbox_id,boot_generation,boot_id,slot_id,repository_id,state_dir,runner_binary,workspace_path,home_path,tmp_path,runner_binary_digest,boot_preparation_digest,preparation_digest,readiness_digest,source_digest,source_object_id,source_tree_id,slot_generation,uid,gid,observation_digest) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,'/srv/state','/srv/native','/srv/slots/w','/srv/slots/h','/srv/slots/t',$9,$9,$9,$9,$9,$10,$10,1,62051,62051,$9)",[org,run,session,i["provisioner"],i["sandbox"],i["boot"],slot,repository,pin,"1"*40])
        def committed():
            op=uid();root="/run/hyperfide-stage/"+op;argv=["/usr/bin/node","/opt/recipes/prepare.mjs","--job-context",root+"/context.json"]
            request={"operation_id":op,"argv":argv,"executable_digest":sha(b"node")}
            packet={"job_class":"PREPARATION","request":request,"binding":{"sandbox_id":i["sandbox"],"boot_generation":"1","workspace_path":"/srv/slots/w","uid":62051,"gid":62051}}
            plan_digest=sha(json.dumps(packet,sort_keys=True).encode())
            f.sql("INSERT INTO hyperfide.runner_remote_jobs(organisation_id,run_id,operation_id,session_id,job_class,plan,plan_digest,principal,admission_digest,authority_epoch,reservation_id,expires_at) VALUES($1,$2,$3,$4,'PREPARATION',$5,$6,'{}',$7,$8,$9,clock_timestamp()+interval '1 hour')",[org,run,op,session,json.dumps(packet),plan_digest,pin,i["epoch"],reservation])
            f.sql("UPDATE hyperfide.runner_remote_jobs SET state='CLAIMED',claim_id=$2,executor_credential_id=$3,claimed_at=clock_timestamp() WHERE operation_id=$1",[op,uid(),i["provisioner"]])
            receipt={"execution_plane":"REMOTE","operation_id":op,"plan_digest":plan_digest,"executable_digest":sha(b"node"),"preparation_stage":{"stage_root":root,"context_path":root+"/context.json","context_digest":sha(b"context"),"out_root":root+"/out","diagnostics_root":root+"/diagnostics","workspace_path":"/srv/slots/w","node_path":argv[0],"node_digest":sha(b"node"),"recipe_path":argv[1],"recipe_digest":sha(b"recipe"),"uid":62051,"gid":62051}}
            return op,receipt
        op,receipt=committed();raw=json.dumps(receipt).encode()
        recorded=c.ok("runner.preparation.receipt.record",{"operation_id":op,"receipt_base64":base64.b64encode(raw).decode()},key="runner")
        expect(recorded["verified"] is True and recorded["receipt_digest"]==sha(raw) and recorded["authority"]=="NONE","receipt not verified and persisted")
        expect(c.ok("runner.preparation.receipt.inspect",{"operation_id":op})["receipt_digest"]==sha(raw),"persisted receipt not readable")
        other=json.dumps({**receipt,"preparation_stage":{**receipt["preparation_stage"],"context_digest":sha(b"other")}}).encode()
        c.refused("runner.preparation.receipt.record",{"operation_id":op,"receipt_base64":base64.b64encode(other).decode()},"PREPARATION_RECEIPT_CONFLICT",key="runner")
        op2,receipt2=committed();forged=json.dumps({**receipt2,"preparation_stage":{**receipt2["preparation_stage"],"recipe_path":"/bin/sh"}}).encode()
        c.refused("runner.preparation.receipt.record",{"operation_id":op2,"receipt_base64":base64.b64encode(forged).decode()},"PREPARATION_RECEIPT_MISMATCH",key="runner")
    check("service.preparation-receipt.verified-persisted-and-conflicts-refused",preparation_receipt)

def subprobes():
    env=os.environ.copy()
    def receipts():
        result=subprocess.run(["node","--test",str(SUPPORT/"preparation_receipts.test.mjs")],cwd=ROOT,env=env,capture_output=True,text=True,timeout=120)
        expect(result.returncode==0 and ("# fail 0" in result.stdout or "ℹ fail 0" in result.stdout),"preparation receipt verifier tests failed: "+result.stdout[-800:]+result.stderr[-400:])
    check("subprobe.preparation-receipt-verifier",receipts)
    def staging():
        module=load("hf_12_4_stage",SUPPORT/"preparation_stage_fixture.py");report=module.run_probe(str(ROOT/"build/hyperfide-native"),str(ROOT))
        expect(report["assertions"]>=60 and all(x["passed"] for x in report["checks"]),"native staging through runner.preparation.stage failed")
    check("subprobe.preparation-stage-through-native-action",staging)
    def budget():
        result=subprocess.run([sys.executable,"-I",str(SUPPORT/"runner_budget_fixture.py")],cwd=ROOT,env=env,capture_output=True,text=True,timeout=600)
        report=json.loads(result.stdout.strip().splitlines()[-1])
        expect(result.returncode==0 and report["kernel_enforcement"]=="CPU_MEMORY_OBSERVED","linked cgroup-v2 budget primitives not enforced: "+json.dumps({k:v for k,v in report.items() if k!="observations"}))
    check("subprobe.runner-budget-kernel-enforcement",budget)
    # The executor boundary probe emits its own registered assertions verbatim.
    result=subprocess.run([sys.executable,"-I",str(ROOT/"tests/hyperfide/cases/tasks/12_4_executor.py")],cwd=ROOT,env=env,capture_output=True,text=True,timeout=900)
    emitted=0
    for line in result.stdout.splitlines():
        try:event=json.loads(line)
        except ValueError:continue
        if event.get("type")=="assertion":
            emitted+=1;RESULTS.append((event["id"],event["actual"]));print(json.dumps(event),flush=True)
    check("subprobe.executor-boundary-complete",lambda:expect(result.returncode==0 and emitted>=60,"executor sub-probe failed: "+result.stderr[-800:]))

def main():
    ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)
    expect(os.geteuid()==0,"root is required for slot UIDs")
    c=None;clean=False
    try:
        c=Control()
        try:control_probe(c)
        finally:clean=c.close();c=None
        subprobes()
    finally:
        if c is not None:clean=c.close()
        while True:
            try:
                if os.waitpid(-1,os.WNOHANG)==(0,0):break
            except ChildProcessError:break
    check("control.cleanup.no-slot-processes-remain",lambda:expect(clean,"slot UID processes remained after cleanup"))
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
    return 1 if any(actual!="observed" for _,actual in RESULTS) else 0
if __name__=="__main__":raise SystemExit(main())
