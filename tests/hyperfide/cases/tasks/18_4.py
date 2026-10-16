#!/usr/bin/env python3
"""Actual scheduled repair authority; execution and qualification stay hard gates.

Upstream immutable review facts are synthetic inputs. Compute authority is
obtained only through the production packet/claim HTTPS actions. No SQL write
manufactures CURRENT authority, RUNNING state, qualified custody or a PASS.
"""
from __future__ import annotations
import copy,importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('finding_test_fixture',Path(__file__).with_name('18_1.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
spec=importlib.util.spec_from_file_location('finding_scheduler_fixture',Path(__file__).with_name('5_1.py'));scheduler=importlib.util.module_from_spec(spec);spec.loader.exec_module(scheduler)
check=c.check;expect=c.expect;uid=c.uid
def setup(f):
    c.record_database('18.4',f.database,str(f.path))
    f.env['HF_FINDING_REPAIR_MAX_ATTEMPTS']='2'
    for filename in ('0004-durability.sql','0017-review.sql','0018-findings.sql'):
        f.sql('BEGIN;\n'+(c.ROOT/'services/hyperfide/migrations'/filename).read_text()+'\nCOMMIT;')
    i=f.ids
    accepted=f.sql('SELECT t.criteria_digest,t.definition,p.policy FROM hyperfide.tasks t JOIN hyperfide.proof_registries p ON p.organisation_id=t.organisation_id AND p.run_id=t.run_id AND p.task_id=t.id WHERE t.id=$1',[i['task_a']])[0]
    policy=copy.deepcopy(accepted['policy'])
    f.condition={'condition_id':policy['clauses'][0]['id'],'criteria_digest':accepted['criteria_digest'],'rubric_digest':policy['rubric_digest'],'requires_original_failure':False,'required_contract_ids':[]}
    x={key:uid() for key in ('task','attempt','artifact','evidence','policy','obligation','receipt')}
    x.update(repository=i['repository'],package=i['package'],manager=i['manager'],watcher=i['watcher']);f.x=x
    # Historical review input never grants compute; its accepted intent is a
    # declarative clone of the actual ordinary task's exact criterion/policy.
    c.insert(f,'tasks',c.scoped(f,id=x['task'],task_key='alpha.finding-origin',feature_package_id=x['package'],spec_revision_id=i['spec'],criteria_digest=accepted['criteria_digest'],definition=accepted['definition'],wave=1))
    c.insert(f,'proof_registries',c.scoped(f,task_id=x['task'],spec_generation='1',spec_revision_id=i['spec'],criteria_digest=accepted['criteria_digest'],registry_digest=scheduler.identity(policy),policy=policy))
    c.insert(f,'attempts',c.scoped(f,id=x['attempt'],task_id=x['task'],generation='1',authority_epoch=i['epoch'],input_packet_digest=c.sha(b'historical-review-input'),execution_state='FAILED',compute_authority='RELEASED'))
    f.sql("UPDATE hyperfide.tasks SET state='FAILED',generation=1,current_attempt_id=$1,state_version=state_version+1 WHERE id=$2",[x['attempt'],x['task']])
    c.insert(f,'artifacts',c.scoped(f,id=x['artifact'],digest=c.sha(b'historical-review-input'),size_bytes='1',storage_backend='fixture',storage_key='historical-review-input',status='COMPLETE',retention_class='RUN'))
    c.insert(f,'evidence',c.scoped(f,id=x['evidence'],attempt_id=x['attempt'],attempt_generation='1',repository_id=x['repository'],source_object_id=c.OID,criteria_digest=accepted['criteria_digest'],manifest_digest=c.sha(b'historical-review-manifest'),artifact_id=x['artifact'],admission_state='ADMITTED'))
    review_policy=c.sha(b'finding-review-policy');inputs=c.sha(b'finding-review-inputs');candidate=c.sha(b'finding-review-candidate')
    c.insert(f,'review_policies',c.scoped(f,digest=review_policy,revision='1',definition={}))
    c.insert(f,'review_watchers',c.scoped(f,policy_digest=review_policy,watcher_id='finding-fixture-reviewer',reviewer_session_id=x['watcher'],rubric_digest=policy['rubric_digest'],review_class='semantic',path_prefixes=[]))
    c.insert(f,'source_objects',{'organisation_id':i['organisation'],'repository_id':x['repository'],'object_id':'c'*40,'object_type':'tree'})
    c.insert(f,'review_commits',c.scoped(f,repository_id=x['repository'],source_object_id=c.OID,tree_object_id='c'*40,parent_objects=[],changed_paths=['src/claim-a.ts'],attribution={'task_id':x['task'],'attempt_id':x['attempt']}))
    c.insert(f,'review_obligations',c.scoped(f,id=x['obligation'],repository_id=x['repository'],source_object_id=c.OID,policy_digest=review_policy,watcher_id='finding-fixture-reviewer'))
    c.insert(f,'review_obligation_inputs',c.scoped(f,obligation_id=x['obligation'],generation='1',input_manifest_digest=inputs,candidate_digest=candidate,snapshot={}))
    c.insert(f,'review_receipts',c.scoped(f,id=x['receipt'],request_id=uid(),request_digest=c.sha(b'historical-review-request'),obligation_id=x['obligation'],lease_generation='1',generation='1',reviewer_session_id=x['watcher'],rubric_digest=policy['rubric_digest'],input_manifest_digest=inputs,candidate_digest=candidate,outcome='FINDINGS',limitations=[]))
    c.insert(f,'review_receipt_evidence',c.scoped(f,receipt_id=x['receipt'],evidence_id=x['evidence']))
    f.sql("UPDATE hyperfide.review_obligations SET state='COMPLETE',input_manifest_digest=$1,candidate_digest=$2,current_receipt_id=$3 WHERE id=$4",[inputs,candidate,x['receipt'],x['obligation']])
def main():
    if '--cleanup' in sys.argv:return c.cleanup('18.4')
    f=scheduler.SchedulerFixture(extra_components=('18.1','18.3','18.4'),extra_setup=setup)
    def call(action,payload):return c.call(f,action,payload,component='finding-remediation')
    def reject(action,payload,code=None):return c.reject(f,action,payload,code,component='finding-remediation')
    def finding_version(fid):return str(c.call(f,'finding.inspect',{'finding_id':fid})['finding']['registry_version'])
    def repair_version(rid):return str(f.sql('SELECT state_version::text AS version FROM hyperfide.finding_repairs WHERE id=$1',[rid])[0]['version'])
    try:
        check('findings.repair.no-seeded-compute-authority',lambda:expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.attempts WHERE compute_authority='CURRENT'")[0]['n']==0))
        fid=c.call(f,'finding.report',{'observation_id':c.observation(f),'resolution_condition':f.condition})['finding_id']
        packet={'finding_id':fid,'request_id':uid(),'repair_task_id':f.ids['task_a'],'expected_state_version':finding_version(fid)}
        check('findings.repair.requires-current-route',lambda:reject('finding.repair.request',packet,'ROUTING_REQUIRED'))
        routed=c.call(f,'finding.route',{'finding_id':fid,'request_id':uid(),'expected_state_version':finding_version(fid)},component='finding-routing')['route']
        c.call(f,'finding.route.acknowledge',{'route_id':routed['id'],'generation':str(routed['generation']),'owner_generation':str(routed['owner_generation'])},component='finding-routing',key='manager')
        packet['expected_state_version']=finding_version(fid);created=call('finding.repair.request',packet);rid=created['repair']['id']
        check('findings.repair.ordinary-task-request',lambda:expect(created['repair']['repair_task_id']==f.ids['task_a'] and created['repair']['max_attempts']==2 and created['replayed'] is False))
        check('findings.repair.request-replay',lambda:expect(call('finding.repair.request',packet)['repair']['id']==rid))
        check('findings.repair.no-duplicate-active-repair',lambda:reject('finding.repair.request',dict(packet,request_id=uid(),expected_state_version=finding_version(fid)),'REPAIR_ACTIVE'))
        claimed=f.claim('a');token=claimed['token']
        check('findings.repair.real-signed-ordinary-claim',lambda:expect(token['task_id']==f.ids['task_a'] and f.sql('SELECT current_attempt_id,generation::text FROM hyperfide.tasks WHERE id=$1',[f.ids['task_a']])[0]=={'current_attempt_id':token['attempt_id'],'generation':token['attempt_generation']}))
        check('findings.repair.actual-slot-allocation',lambda:expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.slot_allocations WHERE attempt_id=$1 AND state='ACTIVE'",[token['attempt_id']])[0]['n']==1))
        check('findings.repair.actual-live-primary-lease',lambda:expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.compute_leases WHERE attempt_id=$1 AND state='ACTIVE' AND expires_at>clock_timestamp()",[token['attempt_id']])[0]['n']==1))
        attach={'repair_id':rid,'attempt_id':token['attempt_id'],'attempt_generation':token['attempt_generation'],'expected_state_version':repair_version(rid)}
        check('findings.repair.wrong-attempt-generation',lambda:reject('finding.repair.attach',dict(attach,attempt_generation=str(int(token['attempt_generation'])+1)),'STALE_ATTEMPT'))
        check('findings.repair.unknown-attempt-refused',lambda:reject('finding.repair.attach',dict(attach,attempt_id=uid()),'STALE_ATTEMPT'))
        check('findings.repair.reservation-not-observed-running',lambda:expect(f.sql('SELECT execution_state FROM hyperfide.attempts WHERE id=$1',[token['attempt_id']])[0]['execution_state']=='RESERVED'))
        check('findings.repair.reserved-attempt-cannot-fake-running',lambda:reject('finding.repair.attach',attach,'STALE_ATTEMPT'))
        check('findings.repair.refused-attach-preserves-budget',lambda:expect(f.sql('SELECT attempt_count FROM hyperfide.finding_repairs WHERE id=$1',[rid])[0]['attempt_count']==0))
        submit={'repair_id':rid,'custody_id':uid(),'custody_generation':'1','intended_source_object_id':'b'*40,'expected_state_version':repair_version(rid)}
        check('findings.repair.missing-custody-refused',lambda:reject('finding.repair.submit',submit,'SUBMISSION_INVALID'))
        resolve={'repair_id':rid,'expected_state_version':repair_version(rid)}
        check('findings.repair.caller-qualified-boolean-refused',lambda:reject('finding.repair.resolve',dict(resolve,qualified=True),'INVALID_REQUEST'))
        check('findings.repair.no-resolution-before-submission',lambda:reject('finding.repair.resolve',resolve,'STALE_REPAIR'))
        check('findings.repair.unqualified-blocks-publication',lambda:expect(c.call(f,'finding.blockers.inspect',{})['clear'] is False))
        check('findings.repair.accepted-condition-immutable',lambda:c.assert_sql_refused(f,"UPDATE hyperfide.finding_registry_records SET resolution_condition='{}' WHERE finding_id='"+fid+"'"))
        check('findings.repair.request-policy-immutable',lambda:c.assert_sql_refused(f,'UPDATE hyperfide.finding_repairs SET max_attempts=100'))
        # These are genuine unresolved producer gates. Neither fixture SQL nor a
        # caller-supplied outcome may turn them into execution/qualification.
        check('findings.repair.genuine-execution-start-observed',lambda:expect(f.sql('SELECT execution_state FROM hyperfide.attempts WHERE id=$1',[token['attempt_id']])[0]['execution_state']=='RUNNING','Actual12/13 observed START receipt is not integrated'))
        check('findings.repair.genuine-independent-resolution',lambda:expect(c.call(f,'finding.inspect',{'finding_id':fid})['finding']['phase']=='RESOLVED','Actual16/17 independent repair proof is not integrated'))
    finally:f.close()
    return int(any(actual!='observed' for _,actual in c.RESULTS))
if __name__=='__main__':raise SystemExit(main())
