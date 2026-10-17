#!/usr/bin/env python3
"""Real authenticated admission, escalation and native launch-plan probes over PostgreSQL/HTTPS.
No live-model qualification: reservations are seeded by trusted fixture SQL and labelled as such."""
import copy,json,os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from importlib.util import spec_from_file_location,module_from_spec
spec=spec_from_file_location("sessions_probe",Path(__file__).with_name("13_2.py"));module=module_from_spec(spec);spec.loader.exec_module(module)
AgentFixture,uid,sha,expect=module.AgentFixture,module.uid,module.sha,module.expect
ROOT=module.ROOT
# Installed native ELF payload (the npm codex.js shim is refused by 14.3 binary pinning).
CODEX_ELF=Path(os.environ.get("HF_TEST_NATIVE_CODEX_BINARY","/root/.local/share/mise/installs/node/lts/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex"))
RUN_POLICY=sha(b"policy")  # IdentityFixture's approved run policy digest
DISPATCH_COMPONENTS=["3.1","4.1","2.1","2.4","7.2","7.3","3.2","6.1","5.1","5.2","6.2","6.3","12.2","13.4-dispatch"]
os.umask(0o077)  # trusted configuration files must be owner-only
def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
_raw_sql=module.SessionIdentityFixture.sql
def _release_sql(self,sql,values=None,**kwargs):
    # The 13.2 fixture replays 0012/0013 by hand; the complete-release migration engine
    # already applied them, so the replay becomes an exact checksum-pin observation.
    for name in ("0012-runner-registry","0013-agents"):
        body=(ROOT/("services/hyperfide/migrations/"+name+".sql")).read_bytes()
        if values is None and sql.startswith("BEGIN;\n"+body.decode()+"\nINSERT INTO hyperfide.schema_migrations"):
            return self.apply_migration(name)
    return _raw_sql(self,sql,values,**kwargs)
module.SessionIdentityFixture.sql=_release_sql
OWNER=[]
class ReleaseIdentityFixture(module.SessionIdentityFixture):
    """Adapts the 13.2 seed to the current release: pinned ELF profile, run-policy-bound admission
    entries and the 12.2 dispatch route with this task's registered plan reader."""
    def __init__(self,extra_components=(),extra_setup=None,**kwargs):
        def setup(f):
            extra_setup(f)
            if OWNER:OWNER[-1].adapt(f)
        super().__init__(extra_components=list(extra_components)+(DISPATCH_COMPONENTS if OWNER else[]),extra_setup=setup,**kwargs)
module.SessionIdentityFixture=ReleaseIdentityFixture
class AdmissionFixture(AgentFixture):
    def __init__(self):
        OWNER.append(self)
        try:super().__init__(admission=True)
        finally:OWNER.remove(self)
    def adapt(self,f):
        expect(CODEX_ELF.is_file() and CODEX_ELF.read_bytes()[:4]==b"\x7fELF","installed native Codex ELF payload unavailable")
        self.profile=dict(self.profile,binary=dict(self.profile["binary"],path=str(CODEX_ELF),digest=sha(CODEX_ELF.read_bytes())),configured_account_key="fixture-account")
        self.profile_path.write_text(json.dumps({"schema_version":1,"profiles":[self.profile]}))
        self.configuration=sha(canonical(self.profile))
        self.binding["configuration_digest"]=self.configuration;self.checkpoint["configuration_digest"]=self.configuration
        base=self.admission_policy["policies"][0]
        self.admission_policy["policies"]=[dict(base,retry_base_ms=2000,retry_max_ms=4000,run_policy_digest=RUN_POLICY),
         dict(base,quota_key="escalation-quota",max_concurrent=2,run_policy_digest=RUN_POLICY),
         dict(base,quota_key="unapproved-quota",run_policy_digest=sha(b"unapproved-run-policy"))]
        self.policy_path.write_text(json.dumps(self.admission_policy))
        f.env["HF_SCHEDULER_NATIVE_CONSUMER_ID"]=uid()
    def policy_digest(self,quota):
        return sha(canonical(next(p for p in self.admission_policy["policies"] if p["quota_key"]==quota)))
    def seed_reservation(self,quota,session,reservation,request,active):
        org,run=self.scope["organisation_id"],self.scope["run_id"];digest=self.policy_digest(quota)
        self.inner.sql("INSERT INTO hyperfide.agent_admission_accounts(organisation_id,run_id,quota_key,policy_digest,max_concurrent,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organisation_id,run_id,quota_key) DO UPDATE SET active=EXCLUDED.active",[org,run,quota,digest,1 if quota=="fixture-quota" else 2,active])
        self.inner.sql("INSERT INTO hyperfide.agent_admission_reservations(organisation_id,run_id,id,quota_key,session_id,payload_digest,policy_digest,state) VALUES($1,$2,$3,$4,$5,$6,$7,'RESERVED')",[org,run,reservation,quota,session,sha(canonical(request)),digest])
    def seed_dispatch(self):
        """Trusted fixture SQL for one committed, unresolved scheduler spawn intent (no runner effect)."""
        i=self.inner.ids;org,run=i["organisation"],i["run"];command,event=uid(),uid()
        self.inner.sql("INSERT INTO hyperfide.outbox_events(organisation_id,run_id,id,aggregate_type,aggregate_id,aggregate_version,event_type,payload) VALUES($1,$2,$3,'scheduler-spawn',$4,1,'runner.spawn.requested','{}'::jsonb)",[org,run,event,command])
        self.inner.sql("INSERT INTO hyperfide.scheduler_dispatches(organisation_id,run_id,id,request_id,task_id,attempt_id,attempt_generation,authority_epoch,sandbox_id,slot_id,sandbox_boot_generation,payload_digest,event_id) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,1,$10,$11)",[org,run,command,uid(),i["task"],i["attempt"],i["epoch"],i["sandbox"],i["slot"],sha(command.encode()),event])
        return command
    def resolve_dispatch(self,command):
        self.inner.sql("UPDATE hyperfide.scheduler_dispatches SET state='COMPLETED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[self.scope["organisation_id"],self.scope["run_id"],command])
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

CLASSIFIER=r"""
import {classifyNativeEvent as c} from './services/hyperfide/dist/agents/admission.js';
const cases=JSON.parse(process.argv[1]),out=[];
for(const [connector,event,reason,signal] of cases){const r=c(connector,event);out.push(r.reason===reason&&r.signal===signal&&r.useful_progress===false&&!JSON.stringify(r).includes('secret-native-text'));}
let invalid=false;try{c('codex',{params:{}})}catch(e){invalid=e.code==='ADMISSION_SIGNAL_INVALID'}
console.log(JSON.stringify({results:out,invalid}));
"""
SIGNALS=[
 ["codex",{"method":"error","params":{"error":{"message":"secret-native-text","codexErrorInfo":"usageLimitExceeded"},"willRetry":False,"threadId":"t","turnId":"u"}},"QUOTA_LIMIT","QUOTA_EXHAUSTED"],
 ["codex",{"method":"error","params":{"error":{"message":"secret-native-text","codexErrorInfo":"rateLimitExceeded"},"willRetry":True,"threadId":"t","turnId":"u"}},"RATE_LIMIT","RATE_LIMITED"],
 ["codex",{"method":"error","params":{"error":{"message":"secret-native-text","codexErrorInfo":{"responseStreamConnectionFailed":{"httpStatusCode":429}}},"willRetry":False,"threadId":"t","turnId":"u"}},"RATE_LIMIT","RATE_LIMITED"],
 ["codex",{"method":"error","params":{"error":{"message":"secret-native-text","codexErrorInfo":"unauthorized"},"willRetry":False,"threadId":"t","turnId":"u"}},"AUTH_EXPIRED","AUTH_FAILED"],
 ["codex",{"method":"error","params":{"error":{"message":"secret-native-text","codexErrorInfo":{"httpConnectionFailed":{"httpStatusCode":401}}},"willRetry":False,"threadId":"t","turnId":"u"}},"AUTH_EXPIRED","AUTH_FAILED"],
 ["codex",{"method":"error","params":{"error":{"message":"secret-native-text","codexErrorInfo":"internalServerError"},"willRetry":True,"threadId":"t","turnId":"u"}},None,"MODEL_WAITING"],
 ["codex",{"method":"error","params":{"error":{"message":"secret-native-text","codexErrorInfo":"sandboxError"},"willRetry":False,"threadId":"t","turnId":"u"}},None,"MODEL_ERROR"],
 ["codex",{"method":"account/rateLimits/updated","params":{"rateLimits":{"rateLimitReachedType":"rate_limit_reached","primary":{"usedPercent":100,"resetsAt":1900000000}}}},"RATE_LIMIT","RATE_LIMITED"],
 ["codex",{"method":"account/rateLimits/updated","params":{"rateLimits":{"rateLimitReachedType":"workspace_member_credits_depleted"}}},"QUOTA_LIMIT","QUOTA_EXHAUSTED"],
 ["codex",{"method":"account/rateLimits/updated","params":{"rateLimits":{"primary":{"usedPercent":10}}}},None,"RATE_LIMIT_STATUS"],
 ["codex",{"id":1,"method":"item/commandExecution/requestApproval","params":{"command":"secret-native-text"}},"APPROVAL_REQUIRED","APPROVAL_PROMPT"],
 ["codex",{"id":2,"method":"item/fileChange/requestApproval","params":{}},"APPROVAL_REQUIRED","APPROVAL_PROMPT"],
 ["codex",{"id":3,"method":"item/permissions/requestApproval","params":{}},"APPROVAL_REQUIRED","APPROVAL_PROMPT"],
 ["codex",{"id":4,"method":"account/chatgptAuthTokens/refresh","params":{}},"AUTH_EXPIRED","AUTH_FAILED"],
 ["codex",{"method":"item/started","params":{"item":{"type":"collabAgentToolCall","tool":"spawnAgent","id":"x"}}},"DELEGATION_UNSUPPORTED","DELEGATION_REQUESTED"],
 ["codex",{"method":"item/completed","params":{"item":{"type":"agentMessage","text":"secret-native-text"}}},None,"IGNORED"],
 ["codex",{"method":"turn/completed","params":{"turn":{"status":"completed"}}},None,"TURN_FINISHED"],
 ["claude",{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour","resetsAt":1900000000}},"RATE_LIMIT","RATE_LIMITED"],
 ["claude",{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning"}},None,"RATE_LIMIT_STATUS"],
 ["claude",{"type":"assistant","error":"authentication_failed","message":{"content":[{"type":"text","text":"secret-native-text"}]}},"AUTH_EXPIRED","AUTH_FAILED"],
 ["claude",{"type":"assistant","error":"billing_error","message":{"content":[]}},"QUOTA_LIMIT","QUOTA_EXHAUSTED"],
 ["claude",{"type":"assistant","error":"overloaded","message":{"content":[]}},"RATE_LIMIT","RATE_LIMITED"],
 ["claude",{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Task","input":{"prompt":"secret-native-text"}}]}},"DELEGATION_UNSUPPORTED","DELEGATION_REQUESTED"],
 ["claude",{"type":"control_request","request_id":"r","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{}}},"APPROVAL_REQUIRED","APPROVAL_PROMPT"],
 ["claude",{"type":"result","subtype":"error_during_execution","is_error":True}],
 ["claude",{"type":"result","subtype":"success","is_error":False,"result":"secret-native-text"},None,"TURN_FINISHED"],
]
SIGNALS[-2]=SIGNALS[-2]+[None,"MODEL_ERROR"]
def classifier_table():
    result=module.subprocess.run(["node","--input-type=module","-e",CLASSIFIER,json.dumps(SIGNALS)],cwd=ROOT,text=True,stdout=module.subprocess.PIPE,stderr=module.subprocess.PIPE,timeout=15)
    expect(result.returncode==0,"actual classifier unavailable: "+result.stderr[-1000:])
    value=json.loads(result.stdout)
    expect(all(value["results"]) and len(value["results"])==len(SIGNALS) and value["invalid"],"native signal classification wrong: "+str([i for i,ok in enumerate(value["results"]) if not ok]))

def main():
    f=None
    try:
        check('admission.main-startup-sizing-only',startup_budget)
        check('admission.native-signal-classifier',classifier_table)
        f=AdmissionFixture()
        # The shared session fixture includes resume contenders; this probe needs one worker seat.
        f.inner.sql("DELETE FROM hyperfide.agent_sessions WHERE id IN ($1,$2)",[f.inner.ids["successor"],f.inner.ids["rival"]])
        f.bind()
        f.inner.bootstrap_runner();f.inner.delegate_principal("native_worker",f.scope["session_id"]);f.foreign_runner()
        i=f.inner.ids;org,run,artifact=i["organisation"],i["run"],i["artifact"]
        reserve={"scope":f.scope,"reservation_id":uid(),"quota_key":"fixture-quota"}
        def plans():return f.inner.sql("SELECT * FROM hyperfide.native_launch_plans ORDER BY created_at")
        def blocked():
            f.bad("agent.admission.reserve",reserve,"ADMISSION_NATIVE_UNQUALIFIED",component="13.4")
            rows=f.inner.sql("SELECT id FROM hyperfide.agent_admission_reservations");expect(rows==[],"unqualified launch consumed reservation")
        check("admission.actual-unqualified-native-blocked",blocked)
        check("admission.unapproved-run-policy-refused",lambda:f.bad("agent.admission.reserve",dict(reserve,reservation_id=uid(),quota_key="unapproved-quota"),"ADMISSION_RUN_POLICY_UNAPPROVED",component="13.4"))
        check("admission.native-delegation-reserve-refused",lambda:f.bad("agent.admission.reserve",dict(reserve,native_delegation=True),"ADMISSION_DELEGATION_UNSUPPORTED",component="13.4"))
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
        # Native launch plans: the registered 12.2 plan reader, exercised through the 13.4.dispatch service actions.
        def plan_call(action,value,key="operator"):return f.ok(action,value,component="13.4.dispatch",key=key)
        def registered():
            d=plan_call("agent.launch-plan.describe",{})
            expect(d["plan_reader_registered"] is True and d["route"]["status"]=="READY" and d["route"]["reason"] is None and d["launch_authority"] is False and d["native_delegation"] is False,"plan reader not registered on the 12.2 route: "+json.dumps(d["route"]))
        check("dispatch.plan-reader-registered",registered)
        command=f.seed_dispatch()
        def unqualified_plan():
            r=plan_call("agent.launch-plan.prepare",{"command_id":command})
            expect(r["plan"] is None and r["reason"]=="ADMISSION_RESERVATION_REQUIRED" and plans()==[],"unqualified/unadmitted session received a launch plan")
        check("dispatch.unqualified-no-plan",unqualified_plan)
        check("dispatch.controller-role-required",lambda:f.bad("agent.launch-plan.prepare",{"command_id":command},"AGENT_ROLE_DENIED",component="13.4.dispatch",key="native_worker"))
        def child_delegation():
            child=uid()
            f.inner.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id) VALUES($1,$2,$3,'VERIFIER',$4,'codex','fixture-account','native-child-thread')",[org,run,child,f.scope["session_id"]])
            try:
                f.bad("agent.launch-plan.prepare",{"command_id":command},"ADMISSION_DELEGATION_UNSUPPORTED",component="13.4.dispatch")
                expect(plans()==[],"delegating session received a plan")
            finally:f.inner.sql("DELETE FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,child])
        check("dispatch.native-child-delegation-refused",child_delegation)
        # Historical reservation state is seeded explicitly by trusted fixture SQL.
        # It proves durable accounting/report paths, never production live admission.
        policy=next(p for p in f.admission_policy["policies"] if p["quota_key"]=="fixture-quota");reservation=reserve["reservation_id"]
        f.seed_reservation("fixture-quota",f.scope["session_id"],reservation,reserve,1)
        def call(action,value,key="operator"):return f.ok(action,value,component="13.4",key=key)
        def bad(value,code,key="operator"):return f.bad("agent.admission.report",value,code,component="13.4",key=key)
        base={"scope":f.scope,"reservation_id":reservation}
        def inspect():return call("agent.admission.inspect",base)["reservation"]
        check("admission.existing-reservation-observed",lambda:expect(inspect()["state"]=="RESERVED","durable reservation missing"))
        def context():
            packet=call("agent.admission.recovery-context",base)
            expect(packet["eligible_frontier_profiles"]==[] and packet["condition_changed_since_previous"]is False and packet["condition_change_proof"]=="UNAVAILABLE" and packet["attempt_id"]==i["attempt"] and packet["run_policy_approved"] is True and not packet["grants_authority"],"recovery packet invented model eligibility or change")
        check("admission.no-forged-frontier-recovery-context",context)
        report=dict(base,operation_id=uid(),reason="RATE_LIMIT",diagnostic_refs=[artifact],command_receipt_refs=[],condition_digest=sha(b"reported-condition"))
        result={}
        def first():
            result.update(call("agent.admission.report",report))
            expect(result["reservation"]["state"]=="RETRY_WAIT" and result["reservation"]["attempt_count"]==2 and result["retry_delay_ms"]==2000 and result["capacity_retained"],"bounded rate-limit accounting wrong")
        check("admission.rate-limit-bounded-backoff",first)
        def waiting_plan():
            r=plan_call("agent.launch-plan.prepare",{"command_id":command})
            expect(r["plan"] is None and r["reason"]=="ADMISSION_RETRY_BACKOFF" and plans()==[],"model-quota wait produced a launch plan: "+json.dumps(r))
        check("dispatch.admission-waiting-no-plan",waiting_plan)
        check("admission.foreign-runner-report-replay-denied",lambda:f.bad("agent.admission.report",report,"AGENT_SCOPE_DENIED",component="13.4",key="foreign_runner"))
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
        time.sleep(2.2)
        def bounded():
            p=call("agent.admission.report",dict(base,operation_id=uid(),reason="RATE_LIMIT"))
            expect(p["reservation"]["state"]=="ESCALATED" and p["reservation"]["attempt_count"]==2 and p["capacity_retained"],"retry budget exceeded or capacity released")
        check("admission.retry-budget-exhaustion",bounded)
        def durable_escalation():
            e=call("agent.admission.escalations",base)
            expect(e["open"] and e["open"]["reason"]=="RATE_LIMIT" and e["open"]["sequence"]==1 and e["open"]["attempt_count"]==2 and e["remaining_resolutions"]==3,"escalation was not durably recorded for the leader/operator")
            expect(len(f.inner.sql("SELECT id FROM hyperfide.agent_admission_escalations WHERE reservation_id=$1 AND state='OPEN'",[reservation]))==1,"escalation row missing")
        check("admission.escalation-record-durable",durable_escalation)
        check("admission.escalation-worker-cannot-resolve",lambda:bad(dict(base,operation_id=uid(),reason="CONDITION_CHANGED",condition_digest=sha(b"worker-claim"),diagnostic_refs=[artifact]),"ADMISSION_ESCALATION_ROLE_DENIED",key="native_worker"))
        def exhausted_plan():
            r=plan_call("agent.launch-plan.prepare",{"command_id":command})
            expect(r["plan"] is None and r["reason"]=="ADMISSION_ESCALATED" and plans()==[],"exhausted admission produced a launch plan: "+json.dumps(r))
        check("dispatch.admission-exhausted-no-plan",exhausted_plan)
        def operator_change():
            r=call("agent.admission.report",dict(base,operation_id=uid(),reason="CONDITION_CHANGED",condition_digest=sha(b"provider-window-reset"),diagnostic_refs=[artifact]))
            expect(r["reservation"]["state"]=="RETRY_WAIT" and r["reservation"]["attempt_count"]==1 and r["escalation"]["state"]=="RESOLVED","operator condition change did not reopen bounded retry")
        check("admission.operator-condition-change-reopens",operator_change)
        time.sleep(2.2)
        first_plan={}
        def persisted():
            r=plan_call("agent.launch-plan.prepare",{"command_id":command});first_plan.update(r["plan"] or {})
            rows=plans()
            expect(r["plan"] and r["replayed"] is False and r["reason"] is None and len(rows)==1,"admitted dispatch did not persist exactly one plan")
            row=rows[0]
            expect(row["launch_id"]==r["plan"]["launch_id"] and row["agent_session_id"]==f.scope["session_id"] and row["slot_id"]==i["slot"] and row["admission_reservation_id"]==reservation and row["reservation_attempt"]==1 and row["plan"]["reservation_attempt"]==1
                   and row["run_policy_digest"]==RUN_POLICY and row["admission_policy_digest"]==f.policy_digest("fixture-quota") and row["qualification_receipt_digest"]==policy["qualification_digest"]
                   and row["connector"]=="codex" and row["plan"]["permission_profile"]=="fixture-permissions" and row["plan"]["native_delegation"] is False
                   and row["connector_plan_digest"]==r["plan"]["connector_plan_digest"]==sha(canonical(row["plan"])),"persisted plan does not bind admission, run policy and qualification")
        check("dispatch.plan-persisted-once",persisted)
        def replay():
            r=plan_call("agent.launch-plan.prepare",{"command_id":command});seen=plan_call("agent.launch-plan.inspect",{"command_id":command})["plan"]
            expect(r["replayed"] is True and r["plan"]==first_plan and seen["launch_id"]==first_plan["launch_id"] and len(plans())==1,"replayed dispatch produced a different or second launch")
        check("dispatch.replay-same-plan",replay)
        def immutable():
            try:f.inner.sql("UPDATE hyperfide.native_launch_plans SET launch_id=$1",[uid()])
            except AssertionError as error:
                expect("immutable" in str(error),"wrong plan mutation refusal");return
            raise AssertionError("launch plan identity was mutable")
        check("dispatch.plan-row-immutable",immutable)
        def worker_self_release():
            row=f.ok("agent.session.inspect",{"scope":f.scope})["session"]
            identity={"boot_id":f.binding["boot_id"],"process_id":f.binding["process_id"],"process_start_time":f.binding["process_start_time"],"exit_observed":True}
            f.bad("agent.session.transition",{"scope":f.scope,"operation_id":uid(),"expected_state_version":str(row["state_version"]),"state":"FAILED","process":identity},"AGENT_EXIT_REPORTER_DENIED",key="native_worker")
            f.bad("agent.admission.report",dict(base,operation_id=uid(),reason="COMPLETE"),"AGENT_TERMINATION_UNCONFIRMED",component="13.4",key="native_worker")
            expect(f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts WHERE quota_key='fixture-quota'")[0]["active"]==1,"worker self-report released native quota")
        check("admission.worker-self-release-denied",worker_self_release)
        check("admission.unconfirmed-exit-cannot-release",lambda:bad(dict(base,operation_id=uid(),reason="TERMINATED"),"AGENT_TERMINATION_UNCONFIRMED"))
        check("admission.unknown-outcome-retains-capacity",lambda:expect(call("agent.admission.report",dict(base,operation_id=uid(),reason="UNKNOWN_OUTCOME"))["capacity_retained"],"unknown outcome released capacity"))
        def reconcile_first():
            bad(dict(base,operation_id=uid(),reason="CONDITION_CHANGED",condition_digest=sha(b"operator-change"),diagnostic_refs=[artifact]),"ADMISSION_RECONCILIATION_REQUIRED")
            e=call("agent.admission.escalations",base)["escalations"]
            expect([(x["reason"],x["state"]) for x in e]==[("RATE_LIMIT","RESOLVED"),("UNKNOWN_OUTCOME","OPEN")],"unknown outcome was not recorded as an unretryable escalation")
        check("admission.unknown-outcome-blocks-condition-retry",reconcile_first)
        f.inner.stop();f.inner.start()
        check("admission.restart-retains-escalation",lambda:expect(inspect()["state"]=="ESCALATED","restart forgot unknown held reservation"))
        def held():
            expect(f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts WHERE quota_key='fixture-quota'")[0]["active"]==1,"escalation did not retain quota debt")
        check("admission.actual-primary-capacity-debt",held)
        # Second bound session: native signal observation, recorded condition change and bounded resolution.
        second=i["second"];f.bind(second,f.native_sessions[1]);scope2=dict(f.scope,session_id=second);r2=uid()
        f.seed_reservation("escalation-quota",second,r2,{"scope":scope2,"reservation_id":r2,"quota_key":"escalation-quota"},1)
        base2={"scope":scope2,"reservation_id":r2}
        def observe(event,connector="codex",refs=True):
            return dict(base2,operation_id=uid(),connector=connector,event=event,**({"diagnostic_refs":[artifact]}if refs else{}))
        approval={"id":7,"method":"item/commandExecution/requestApproval","params":{"threadId":"t","turnId":"u","itemId":"i","command":"git push --force"}}
        def status_only():
            r=call("agent.admission.observe",observe({"method":"account/rateLimits/updated","params":{"rateLimits":{"primary":{"usedPercent":40}}}}))
            expect(r["reported"] is False and r["classification"]["signal"]=="RATE_LIMIT_STATUS" and r["classification"]["useful_progress"] is False and call("agent.admission.inspect",base2)["reservation"]["state"]=="RESERVED","status observation changed admission or claimed progress")
        check("admission.native-status-not-progress",status_only)
        check("admission.native-signal-connector-bound",lambda:f.bad("agent.admission.observe",observe({"type":"control_request","request":{"subtype":"can_use_tool"}},connector="claude"),"ADMISSION_SIGNAL_CONNECTOR_MISMATCH",component="13.4"))
        check("admission.native-signal-requires-diagnostics",lambda:f.bad("agent.admission.observe",observe(approval,refs=False),"ADMISSION_DIAGNOSTICS_REQUIRED",component="13.4"))
        escalated={}
        def approval_prompt():
            r=call("agent.admission.observe",observe(approval));escalated.update(r)
            expect(r["reported"] is True and r["reported_reason"]=="APPROVAL_REQUIRED" and r["reservation"]["state"]=="ESCALATED" and r["capacity_retained"] and r["escalation"]["reason"]=="APPROVAL_REQUIRED"
                   and r["condition_digest"]==sha(canonical(r["classification"])) and "git push" not in json.dumps(r),"native approval prompt was not escalated with normalized evidence")
        check("admission.native-approval-prompt-escalates",approval_prompt)
        def change(digest,refs=True):return dict(base2,operation_id=uid(),reason="CONDITION_CHANGED",**({"condition_digest":digest}if digest else{}),**({"diagnostic_refs":[artifact]}if refs else{}))
        def requires_change():
            bad(change(None),"ADMISSION_CONDITION_UNCHANGED")
            bad(change(escalated["condition_digest"]),"ADMISSION_CONDITION_UNCHANGED")
            bad(change(sha(b"approval-policy-updated"),refs=False),"ADMISSION_DIAGNOSTICS_REQUIRED")
            expect(call("agent.admission.inspect",base2)["reservation"]["state"]=="ESCALATED","refused change reopened reservation")
        check("admission.escalation-requires-condition-change",requires_change)
        def recorded_change():
            r=call("agent.admission.report",change(sha(b"approval-policy-updated")))
            expect(r["reservation"]["state"]=="RETRY_WAIT" and r["reservation"]["attempt_count"]==1 and r["escalation"]["state"]=="RESOLVED" and r["capacity_retained"],"recorded condition change did not reopen bounded retry")
            p=call("agent.admission.recovery-context",base2)
            expect(p["condition_changed_since_previous"] is True and p["condition_change_proof"]["condition_digest"]==sha(b"approval-policy-updated") and p["condition_change_proof"]["previous_condition_digest"]==escalated["condition_digest"]
                   and p["condition_change_proof"]["recorded_by_role"]=="OPERATOR" and p["escalation"]["remaining_resolutions"]==2,"condition change proof not recorded")
        check("admission.recorded-condition-change-retry",recorded_change)
        def delegation_signal():
            r=call("agent.admission.observe",observe({"method":"item/started","params":{"item":{"type":"collabAgentToolCall","tool":"spawnAgent","id":"c"}}}))
            expect(r["reported_reason"]=="DELEGATION_UNSUPPORTED" and r["reservation"]["state"]=="ESCALATED" and r["escalation"]["sequence"]==2,"native delegation was not refused")
        check("admission.native-delegation-signal-refused",delegation_signal)
        def resolution_budget():
            call("agent.admission.report",change(sha(b"delegation-disabled")))
            call("agent.admission.observe",observe(approval))
            call("agent.admission.report",change(sha(b"third-change")))
            call("agent.admission.observe",observe(approval))
            bad(change(sha(b"fourth-change")),"ADMISSION_ESCALATION_BUDGET_EXHAUSTED")
            e=call("agent.admission.escalations",base2)
            expect(e["state"]=="ESCALATED" and e["remaining_resolutions"]==0 and len(e["escalations"])==4 and f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts WHERE quota_key='escalation-quota'")[0]["active"]==1,"escalation resolutions were unbounded or released capacity")
        check("admission.escalation-resolution-bounded",resolution_budget)
        f.terminate()
        process={"boot_id":f.binding["boot_id"],"process_id":f.child.pid,"process_start_time":f.binding["process_start_time"],"exit_observed":True}
        f.ok("agent.session.transition",{"scope":f.scope,"operation_id":uid(),"expected_state_version":str(f.ok("agent.session.inspect",{"scope":f.scope})["session"]["state_version"]),"state":"FAILED","process":process},key="runner")
        release=dict(base,operation_id=uid(),reason="TERMINATED")
        def release_observed():
            p=call("agent.admission.report",release)
            expect(p["reservation"]["state"]=="RELEASED" and not p["capacity_retained"] and p["escalation"]["state"]=="CLOSED" and f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts WHERE quota_key='fixture-quota'")[0]["active"]==0,"confirmed process exit did not release once")
        check("admission.confirmed-exit-releases",release_observed)
        check("admission.release-idempotent",lambda:expect(call("agent.admission.report",release)["reservation"]["state"]=="RELEASED" and f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts WHERE quota_key='fixture-quota'")[0]["active"]==0,"release replay changed accounting"))
        check("admission.foreign-reservation-hidden",lambda:f.bad("agent.admission.inspect",dict(base,reservation_id=uid()),"ADMISSION_RESERVATION_NOT_FOUND",component="13.4"))
    except Exception as error:check("admission.setup",lambda:(_ for _ in()).throw(error))
    finally:
        if f:f.close("native-admission-database")
    return 1 if FAILED else 0
if __name__=="__main__":sys.exit(module.cleanup_only("native-admission-database")if "--cleanup"in sys.argv else main())
