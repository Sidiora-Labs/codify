#!/usr/bin/env python3
"""Real authenticated admission and PostgreSQL state probes; no live-model qualification."""
import copy,json,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from importlib.util import spec_from_file_location,module_from_spec
spec=spec_from_file_location("sessions_probe",Path(__file__).with_name("13_2.py"));module=module_from_spec(spec);spec.loader.exec_module(module)
AgentFixture,uid,sha,expect=module.AgentFixture,module.uid,module.sha,module.expect
FAILED=[]
def check(identity,fn):
    try:fn();actual="observed"
    except Exception as error:actual=type(error).__name__+": "+str(error);FAILED.append(identity)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def startup_budget():
    script=r"""
import fs from 'node:fs';import os from 'node:os';
import {validateSupervisorStartupBudget as validate} from './services/hyperfide/dist/agents/supervision.js';
const max=9223372036854775807n;
let cpu=BigInt(os.availableParallelism())*1000n;
let memory=BigInt(/^MemAvailable:\s+(\d+)/m.exec(fs.readFileSync('/proc/meminfo','utf8'))[1])*1024n;
const membership=fs.readFileSync('/proc/self/cgroup','utf8').trim().split('\n').find(v=>v.startsWith('0::'));
if(!membership)throw Error('Current cgroup membership unavailable');
const parts=membership.slice(3).split('/').filter(Boolean);
for(let count=parts.length;count>=0;count--){
 const root='/sys/fs/cgroup'+(count?'/'+parts.slice(0,count).join('/'):'');
 if(fs.existsSync(root+'/cpu.max')){const q=fs.readFileSync(root+'/cpu.max','utf8').trim().split(' ');if(q[0]!=='max'){const limit=BigInt(q[0])*1000n/BigInt(q[1]);cpu=cpu<limit?cpu:limit;}}
 if(fs.existsSync(root+'/memory.max')){const q=fs.readFileSync(root+'/memory.max','utf8').trim();if(q!=='max'){const free=BigInt(q)-BigInt(fs.readFileSync(root+'/memory.current','utf8').trim());memory=memory<free?memory:free;}}
}
if(cpu<1n||memory<1n)throw Error('No measured fixture headroom');
const b={schema_version:1,host_id:'10000000-0000-0000-0000-000000000001',pool_id:'10000000-0000-0000-0000-000000000002',allowance:{cpu_millis:'1',memory_bytes:'1',agent_slots:'1'},headroom:{cpu_millis:'0',memory_bytes:'0'}};
const o={cpu_available_millis:cpu.toString(),memory_available_bytes:memory.toString(),observed_at:new Date().toISOString(),source:'LINUX_PROCFS_CGROUP'};
const ok=validate(b,o);if(ok.capacity_admitted!==false||ok.execution_started!==false)throw Error('Sizing became authority');
const reject=(budget,observation,code)=>{try{validate(budget,observation);}catch(e){if(e.code===code)return;throw e;}throw Error('Invalid budget admitted');};
reject({...b,allowance:{...b.allowance,memory_bytes:(memory+1n).toString()}},o,'SUPERVISOR_MAIN_HEADROOM_UNSATISFIED');
reject({...b,headroom:{...b.headroom,cpu_millis:cpu.toString()}},o,'SUPERVISOR_MAIN_HEADROOM_UNSATISFIED');
reject(b,{...o,observed_at:'2000-01-01T00:00:00.000Z'},'SUPERVISOR_MAIN_OBSERVATION_STALE');
reject({...b,allowance:{...b.allowance,cpu_millis:'01'}},o,'SUPERVISOR_MAIN_BUDGET_INVALID');
reject({...b,allowance:{...b.allowance,memory_bytes:(max+1n).toString()}},o,'SUPERVISOR_MAIN_BUDGET_INVALID');
console.log(JSON.stringify({sizing_only:true,measured_source:o.source,negative_cases:5}));
"""
    result=module.subprocess.run(["node","--input-type=module","-e",script],cwd=module.ROOT,text=True,stdout=module.subprocess.PIPE,stderr=module.subprocess.PIPE,timeout=15)
    expect(result.returncode==0,"actual sizing helper refused bounded fixture: "+result.stderr[-1000:])
    expect(json.loads(result.stdout)["negative_cases"]==5,"sizing negatives not exercised")

def main():
    f=None
    try:
        check('admission.main-startup-sizing-only',startup_budget)
        f=AgentFixture(admission=True);f.bind()
        f.inner.bootstrap_runner();f.inner.delegate_principal("native_worker",f.scope["session_id"])
        reserve={"scope":f.scope,"reservation_id":uid(),"quota_key":"fixture-quota"}
        def blocked():
            f.bad("agent.admission.reserve",reserve,"ADMISSION_NATIVE_UNQUALIFIED",component="13.4")
            rows=f.inner.sql("SELECT id FROM hyperfide.agent_admission_reservations");expect(rows==[],"unqualified launch consumed reservation")
        check("admission.actual-unqualified-native-blocked",blocked)
        def unsafe_policy(kind):
            original_mode=f.policy_path.stat().st_mode&0o777
            saved=f.policy_path.with_suffix(".safe")
            f.inner.stop()
            try:
                if kind=="writable":f.policy_path.chmod(0o666)
                else:f.policy_path.rename(saved);f.policy_path.symlink_to(saved)
                f.inner.start()
                f.bad("agent.admission.reserve",reserve,"ADMISSION_POLICY_INVALID",component="13.4")
            finally:
                f.inner.stop()
                if kind=="writable":f.policy_path.chmod(original_mode)
                else:f.policy_path.unlink();saved.rename(f.policy_path)
                f.inner.start()
        check("admission.rejects-writable-startup-policy",lambda:unsafe_policy("writable"))
        check("admission.rejects-symlink-startup-policy",lambda:unsafe_policy("symlink"))
        check("admission.reject-caller-qualified-flag",lambda:f.bad("agent.admission.reserve",dict(reserve,live_qualified=True),"AGENT_INPUT_INVALID",component="13.4"))
        check("admission.cross-tenant-denied",lambda:f.bad("agent.admission.reserve",dict(reserve,scope=dict(f.scope,organisation_id=uid())),"AGENT_SCOPE_DENIED",component="13.4"))
        # Historical reservation state is seeded explicitly by trusted fixture SQL.
        # It proves durable accounting/report paths, never production live admission.
        policy=f.admission_policy["policies"][0];digest=sha(json.dumps(policy,sort_keys=True,separators=(",",":")).encode())
        org,run=f.scope["organisation_id"],f.scope["run_id"];reservation=reserve["reservation_id"]
        f.inner.sql("INSERT INTO hyperfide.agent_admission_accounts(organisation_id,run_id,quota_key,policy_digest,max_concurrent,active) VALUES($1,$2,'fixture-quota',$3,1,1)",[org,run,digest])
        f.inner.sql("INSERT INTO hyperfide.agent_admission_reservations(organisation_id,run_id,id,quota_key,session_id,payload_digest,policy_digest,state) VALUES($1,$2,$3,'fixture-quota',$4,$5,$6,'RESERVED')",[org,run,reservation,f.scope["session_id"],sha(json.dumps(reserve,sort_keys=True,separators=(",",":")).encode()),digest])
        def call(action,value):return f.ok(action,value,component="13.4")
        def bad(value,code):return f.bad("agent.admission.report",value,code,component="13.4")
        base={"scope":f.scope,"reservation_id":reservation}
        def inspect():return call("agent.admission.inspect",base)["reservation"]
        check("admission.existing-reservation-observed",lambda:expect(inspect()["state"]=="RESERVED","durable reservation missing"))
        def context():
            packet=call("agent.admission.recovery-context",base)
            expect(packet["eligible_frontier_profiles"]==[] and packet["condition_changed_since_previous"]is False and packet["condition_change_proof"]=="UNAVAILABLE" and packet["attempt_id"]==f.inner.ids["attempt"] and not packet["grants_authority"],"recovery packet invented model eligibility or change")
        check("admission.no-forged-frontier-recovery-context",context)
        report=dict(base,operation_id=uid(),reason="RATE_LIMIT",diagnostic_refs=[f.inner.ids["artifact"]],command_receipt_refs=[],condition_digest=sha(b"reported-condition"))
        result={}
        def first():
            result.update(call("agent.admission.report",report))
            expect(result["reservation"]["state"]=="RETRY_WAIT" and result["reservation"]["attempt_count"]==2 and result["retry_delay_ms"]==100 and result["capacity_retained"],"bounded rate-limit accounting wrong")
        check("admission.rate-limit-bounded-backoff",first)
        check("admission.report-operation-replay",lambda:expect(call("agent.admission.report",report)["reservation"]["attempt_count"]==2,"same report charged twice"))
        check("admission.report-operation-conflict",lambda:bad(dict(report,reason="QUOTA_LIMIT"),"AGENT_OPERATION_CONFLICT"))
        check("admission.reject-missing-diagnostics",lambda:bad(dict(base,operation_id=uid(),reason="RATE_LIMIT",diagnostic_refs=[uid()]),"ADMISSION_DIAGNOSTICS_UNAVAILABLE"))
        def refs():
            p=call("agent.admission.recovery-context",base)
            expect(p["capacity_wait"]=="PROVIDER_RATE_LIMIT" and p["diagnostic_refs"]==report["diagnostic_refs"] and p["condition_digest"]==report["condition_digest"] and not p["retry"]["eligible"],"actual diagnostic/backoff packet wrong")
        check("admission.persisted-diagnostics-and-wait",refs)
        def portable():
            packet=call("agent.admission.recovery-context",base);deadline=packet["retry"]["retry_after"]
            expect(isinstance(deadline,str)and deadline.endswith("Z"),"retry deadline is not portable ISO text")
            digest=packet.pop("packet_digest")
            expect(digest==sha(json.dumps(packet,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()),"packet digest does not bind actual portable retry deadline")
        check("admission.context-date-is-portable",portable)
        time.sleep(.2)
        def bounded():
            p=call("agent.admission.report",dict(base,operation_id=uid(),reason="RATE_LIMIT"))
            expect(p["reservation"]["state"]=="ESCALATED" and p["reservation"]["attempt_count"]==2 and p["capacity_retained"],"retry budget exceeded or capacity released")
        check("admission.retry-budget-exhaustion",bounded)
        def worker_self_release():
            row=f.ok("agent.session.inspect",{"scope":f.scope})["session"]
            identity={"boot_id":f.binding["boot_id"],"process_id":f.binding["process_id"],"process_start_time":f.binding["process_start_time"],"exit_observed":True}
            f.bad("agent.session.transition",{"scope":f.scope,"operation_id":uid(),"expected_state_version":str(row["state_version"]),"state":"FAILED","process":identity},"AGENT_EXIT_REPORTER_DENIED",key="native_worker")
            f.bad("agent.admission.report",dict(base,operation_id=uid(),reason="COMPLETE"),"AGENT_TERMINATION_UNCONFIRMED",component="13.4",key="native_worker")
            expect(f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts")[0]["active"]==1,"worker self-report released native quota")
        check("admission.worker-self-release-denied",worker_self_release)
        check("admission.unconfirmed-exit-cannot-release",lambda:bad(dict(base,operation_id=uid(),reason="TERMINATED"),"AGENT_TERMINATION_UNCONFIRMED"))
        check("admission.unknown-outcome-retains-capacity",lambda:expect(call("agent.admission.report",dict(base,operation_id=uid(),reason="UNKNOWN_OUTCOME"))["capacity_retained"],"unknown outcome released capacity"))
        f.inner.stop();f.inner.start()
        check("admission.restart-retains-escalation",lambda:expect(inspect()["state"]=="ESCALATED","restart forgot unknown held reservation"))
        def held():
            expect(f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts")[0]["active"]==1,"escalation did not retain quota debt")
        check("admission.actual-primary-capacity-debt",held)
        f.terminate()
        process={"boot_id":f.binding["boot_id"],"process_id":f.child.pid,"process_start_time":f.binding["process_start_time"],"exit_observed":True}
        f.ok("agent.session.transition",{"scope":f.scope,"operation_id":uid(),"expected_state_version":str(f.ok("agent.session.inspect",{"scope":f.scope})["session"]["state_version"]),"state":"FAILED","process":process},key="runner")
        release=dict(base,operation_id=uid(),reason="TERMINATED")
        def release_observed():
            p=call("agent.admission.report",release)
            expect(p["reservation"]["state"]=="RELEASED" and not p["capacity_retained"] and f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts")[0]["active"]==0,"confirmed process exit did not release once")
        check("admission.confirmed-exit-releases",release_observed)
        check("admission.release-idempotent",lambda:expect(call("agent.admission.report",release)["reservation"]["state"]=="RELEASED" and f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts")[0]["active"]==0,"release replay changed accounting"))
        check("admission.foreign-reservation-hidden",lambda:f.bad("agent.admission.inspect",dict(base,reservation_id=uid()),"ADMISSION_RESERVATION_NOT_FOUND",component="13.4"))
    except Exception as error:check("admission.setup",lambda:(_ for _ in()).throw(error))
    finally:
        if f:f.close("native-admission-database")
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(module.cleanup_only("native-admission-database")if "--cleanup"in sys.argv else main())
