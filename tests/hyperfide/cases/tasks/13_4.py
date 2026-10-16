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
def main():
    f=None
    try:
        f=AgentFixture(admission=True);f.bind()
        reserve={"scope":f.scope,"reservation_id":uid(),"quota_key":"fixture-quota"}
        def blocked():
            f.bad("agent.admission.reserve",reserve,"ADMISSION_NATIVE_UNQUALIFIED",component="13.4")
            rows=f.inner.sql("SELECT id FROM hyperfide.agent_admission_reservations");expect(rows==[],"unqualified launch consumed reservation")
        check("admission.actual-unqualified-native-blocked",blocked)
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
        time.sleep(.2)
        def bounded():
            p=call("agent.admission.report",dict(base,operation_id=uid(),reason="RATE_LIMIT"))
            expect(p["reservation"]["state"]=="ESCALATED" and p["reservation"]["attempt_count"]==2 and p["capacity_retained"],"retry budget exceeded or capacity released")
        check("admission.retry-budget-exhaustion",bounded)
        check("admission.unconfirmed-exit-cannot-release",lambda:bad(dict(base,operation_id=uid(),reason="TERMINATED"),"AGENT_TERMINATION_UNCONFIRMED"))
        check("admission.unknown-outcome-retains-capacity",lambda:expect(call("agent.admission.report",dict(base,operation_id=uid(),reason="UNKNOWN_OUTCOME"))["capacity_retained"],"unknown outcome released capacity"))
        f.inner.stop();f.inner.start()
        check("admission.restart-retains-escalation",lambda:expect(inspect()["state"]=="ESCALATED","restart forgot unknown held reservation"))
        def held():
            expect(f.inner.sql("SELECT active FROM hyperfide.agent_admission_accounts")[0]["active"]==1,"escalation did not retain quota debt")
        check("admission.actual-primary-capacity-debt",held)
        f.terminate()
        process={"boot_id":f.binding["boot_id"],"process_id":f.child.pid,"process_start_time":f.binding["process_start_time"],"exit_observed":True}
        f.ok("agent.session.transition",{"scope":f.scope,"operation_id":uid(),"expected_state_version":"1","state":"FAILED","process":process})
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
