#!/usr/bin/env python3
"""Real ordinary repair fencing and independent-resolution qualification.

Full closure is deliberately required by the final assertion. Missing real16/17
execution proof remains a failure; a caller boolean or seeded PASS never replaces it.
"""
from __future__ import annotations
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('finding_test_fixture',Path(__file__).with_name('18_1.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
check=c.check;expect=c.expect;uid=c.uid
def main():
    if '--cleanup' in sys.argv:return c.cleanup('18.4')
    f=c.fixture('18.4',extra=('18.3','18.4'),env={'HF_FINDING_REPAIR_MAX_ATTEMPTS':'2'})
    def call(action,payload):return c.call(f,action,payload,component='finding-remediation')
    def reject(action,payload,code=None):return c.reject(f,action,payload,code,component='finding-remediation')
    def finding_version(fid):return str(c.call(f,'finding.inspect',{'finding_id':fid})['finding']['registry_version'])
    def repair_version(rid):return str(f.sql('SELECT state_version::text AS version FROM hyperfide.finding_repairs WHERE id=$1',[rid])[0]['version'])
    try:
        f.add_principal('manager','FEATURE_MANAGER',actor_id=f.x['manager'])
        fid=c.finding(f)['finding_id'];task=uid();slot=uid();attempt=uid();lease=uid();custody=uid()
        c.insert(f,'tasks',c.scoped(f,id=task,task_key='18.fixture.repair',feature_package_id=f.x['package'],spec_revision_id=f.ids['spec'],criteria_digest=c.D,definition={},wave=1))
        packet={'finding_id':fid,'request_id':uid(),'repair_task_id':task,'expected_state_version':finding_version(fid)}
        check('findings.repair.requires-current-route',lambda:reject('finding.repair.request',packet,'ROUTING_REQUIRED'))
        routed=c.call(f,'finding.route',{'finding_id':fid,'request_id':uid(),'expected_state_version':finding_version(fid)},component='finding-routing')['route']
        c.call(f,'finding.route.acknowledge',{'route_id':routed['id'],'generation':str(routed['generation']),'owner_generation':str(routed['owner_generation'])},component='finding-routing',key='manager')
        packet['expected_state_version']=finding_version(fid);created=call('finding.repair.request',packet);rid=created['repair']['id']
        check('findings.repair.ordinary-task-request',lambda:expect(created['repair']['repair_task_id']==task and created['repair']['max_attempts']==2 and created['replayed'] is False))
        check('findings.repair.request-replay',lambda:expect(call('finding.repair.request',packet)['repair']['id']==rid))
        check('findings.repair.no-duplicate-active-repair',lambda:reject('finding.repair.request',dict(packet,request_id=uid(),expected_state_version=finding_version(fid)),'REPAIR_ACTIVE'))
        c.insert(f,'worker_slots',{'organisation_id':f.ids['organisation'],'id':slot,'sandbox_id':f.ids['sandbox'],'slot_key':'repair-worker','boot_generation':'1','capacity_kind':'AGENT','state':'READY'})
        c.insert(f,'attempts',c.scoped(f,id=attempt,task_id=task,generation='1',authority_epoch=f.ids['epoch'],input_packet_digest=c.sha(b'repair-inputs'),kind='IMPLEMENTATION',execution_state='RUNNING',compute_authority='CURRENT',sandbox_id=f.ids['sandbox'],slot_id=slot,sandbox_boot_generation='1',lease_expires_at='2099-01-01T00:00:00Z'))
        f.sql("UPDATE hyperfide.tasks SET state='RUNNING',generation=1,current_attempt_id=$1,state_version=state_version+1 WHERE id=$2",[attempt,task])
        c.insert(f,'compute_leases',c.scoped(f,id=lease,attempt_id=attempt,attempt_generation='1',authority_epoch=f.ids['epoch'],sandbox_boot_generation='1',expires_at='2099-01-01T00:00:00Z'))
        attach={'repair_id':rid,'attempt_id':attempt,'attempt_generation':'1','expected_state_version':repair_version(rid)}
        check('findings.repair.wrong-attempt-generation',lambda:reject('finding.repair.attach',dict(attach,attempt_generation='2'),'STALE_ATTEMPT'))
        check('findings.repair.current-ordinary-attempt',lambda:expect(call('finding.repair.attach',attach)['replayed'] is False))
        check('findings.repair.attach-idempotent-budget',lambda:expect(call('finding.repair.attach',attach)['replayed'] is True and f.sql('SELECT attempt_count FROM hyperfide.finding_repairs WHERE id=$1',[rid])[0]['attempt_count']==1))
        f.sql("UPDATE hyperfide.compute_leases SET state='EXPIRED',expires_at='2020-01-01T00:00:00Z',state_version=state_version+1 WHERE id=$1",[lease])
        check('findings.repair.expired-lease-replay-refused',lambda:reject('finding.repair.attach',attach,'STALE_ATTEMPT'))
        f.sql("UPDATE hyperfide.attempts SET compute_authority='RELEASED',execution_state='SUBMITTED',state_version=state_version+1 WHERE id=$1",[attempt])
        c.insert(f,'submission_custodies',c.scoped(f,id=custody,task_id=task,source_attempt_id=attempt,source_generation='1',custody_generation='1',authority_epoch=f.ids['epoch'],repository_id=f.x['repository'],source_object_id='b'*40,source_manifest_digest=c.sha(b'repair-source'),evidence_manifest_digest=c.sha(b'repair-evidence'),criteria_digest=c.D))
        submit={'repair_id':rid,'custody_id':custody,'custody_generation':'1','intended_source_object_id':'b'*40,'expected_state_version':repair_version(rid)}
        check('findings.repair.wrong-intended-revision',lambda:reject('finding.repair.submit',dict(submit,intended_source_object_id=c.OID),'SUBMISSION_INVALID'))
        check('findings.repair.compute-independent-custody',lambda:expect(call('finding.repair.submit',submit)['state']=='READY_FOR_RECHECK'))
        check('findings.repair.submission-replay',lambda:expect(call('finding.repair.submit',submit)['replayed'] is True))
        resolve={'repair_id':rid,'expected_state_version':repair_version(rid)}
        check('findings.repair.caller-qualified-boolean-refused',lambda:reject('finding.repair.resolve',dict(resolve,qualified=True),'INVALID_REQUEST'))
        check('findings.repair.missing-independent-proof-refused',lambda:reject('finding.repair.resolve',resolve))
        check('findings.repair.unqualified-remains-open',lambda:expect(c.call(f,'finding.inspect',{'finding_id':fid})['finding']['phase']=='READY_FOR_RECHECK'))
        check('findings.repair.unqualified-blocks-publication',lambda:expect(c.call(f,'finding.blockers.inspect',{})['clear'] is False))
        check('findings.repair.accepted-condition-immutable',lambda:c.assert_sql_refused(f,"UPDATE hyperfide.finding_registry_records SET resolution_condition='{}' WHERE finding_id='"+fid+"'"))
        check('findings.repair.request-policy-immutable',lambda:c.assert_sql_refused(f,'UPDATE hyperfide.finding_repairs SET max_attempts=100'))
        check('findings.repair.repair-audit-principal',lambda:expect(f.sql('SELECT actor_id,actor_role,credential_id FROM hyperfide.finding_repair_events')[0]=={'actor_id':f.ids['operator'],'actor_role':'OPERATOR','credential_id':f.ids['operator']}))
        # Full proof is an explicit hard gate, not a skip or a manually populated PASS.
        # The actual16 AssuranceFixture/native12 remote executor handoff must drive
        # this candidate through real accepted checks and17 counterfactual receipts.
        check('findings.repair.genuine-independent-resolution',lambda:expect(c.call(f,'finding.inspect',{'finding_id':fid})['finding']['phase']=='RESOLVED','Real16/17 repair execution proof has not yet been integrated'))
    finally:f.close()
    return int(any(actual!='observed' for _,actual in c.RESULTS))
if __name__=='__main__':raise SystemExit(main())
