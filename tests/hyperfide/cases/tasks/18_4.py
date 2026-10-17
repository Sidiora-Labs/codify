#!/usr/bin/env python3
"""Actual scheduled repair authority; execution and qualification stay hard gates.

Upstream immutable review facts are synthetic inputs. Compute authority is
obtained only through the production packet/claim HTTPS actions. No SQL write
manufactures CURRENT authority, RUNNING state, qualified custody or a PASS.
"""
from __future__ import annotations
import base64,hashlib,hmac,importlib.util,json,subprocess,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('finding_test_fixture',Path(__file__).with_name('18_1.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
spec=importlib.util.spec_from_file_location('finding_scheduler_fixture',Path(__file__).with_name('5_1.py'));scheduler=importlib.util.module_from_spec(spec);spec.loader.exec_module(scheduler)
check=c.check;expect=c.expect;uid=c.uid
SOURCE='''[meta]
slug = "fixture"
[req.5]
ac_1 = "Ordinary scoped work receives complete accepted execution intent"
[acceptance.V-002]
reqs = ["5.1"]
[acceptance.V-007]
reqs = ["5.1"]
[req.18]
ac_4 = "Issue closure requires the recorded resolution condition to pass on the intended revision"
[acceptance.V-032]
reqs = ["18.4"]
checks = ["finding-repaired"]
[task.alpha.claim-a]
wave = 1
reqs = ["5.1"]
acceptance_ids = ["V-002", "V-007"]
requires = []
touches = ["src/claim-a.ts"]
[task.alpha.finding-origin]
wave = 1
reqs = ["18.4"]
acceptance_ids = ["V-032"]
requires = []
touches = ["src/claim-a.ts"]
[proof]
rubric_digest = RUBRIC
[proof.review.5.1]
reviewers = REVIEWERS
rubric_digest = RUBRIC
[proof.check.finding-repaired]
'''
def accepted_intent(f,criteria):
    f.spec_generation=scheduler.next_spec_generation(f)
    i=f.ids;executable=Path(subprocess.check_output(['node','-p','process.execPath'],text=True).strip()).resolve(strict=True)
    repair=f.sql('SELECT definition,criteria_digest FROM hyperfide.tasks WHERE id=$1',[i['task_a']])[0]
    prior=f.sql('SELECT policy FROM hyperfide.proof_registries WHERE task_id=$1',[i['task_a']])[0]['policy']
    rubric=prior['rubric_digest'];reviewers=prior['clauses'][0]['reviewers']
    check={'id':'finding-repaired','argv':[str(executable),'--version'],'executable_digest':c.sha(executable.read_bytes()),'timeout_ms':1000,'required_artifacts':['fixture/stdout.log'],'input_keys':['source','dependency','toolchain','configuration','graph','contract']}
    source=SOURCE.replace('RUBRIC',json.dumps(rubric)).replace('REVIEWERS',json.dumps(reviewers))+''.join(key+' = '+json.dumps(check[key])+'\n' for key in ('argv','executable_digest','timeout_ms','required_artifacts','input_keys'))
    parsed=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=c.ROOT))
    spec=uid();document={'schema_version':1,'revision_digest':c.sha(b'finding-repair-accepted-envelope'),'source_digest':c.sha(source.encode()),'repositories':[{'repository_id':i['repository'],'source_object_id':c.OID,'integration_ref':'refs/heads/main'}],'allowed_actions':[],'closure_policy':{'required_evidence':['finding-repaired'],'required_review_roles':[],'publication':'AFTER_QUALIFICATION'},'provenance':None,'parsed':parsed,'runtime_wave_offset':0}
    sections={item['name']:item for item in parsed['sections']}
    f.sql('INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)',[i['organisation'],i['project'],spec,c.sha(source.encode()),source,json.dumps(document),document['revision_digest']])
    f.sql('INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$4,$3)',[i['organisation'],i['run'],spec,f.spec_generation])
    state=f.sql('SELECT state FROM hyperfide.runs WHERE id=$1',[i['run']])[0]['state']
    f.sql("UPDATE hyperfide.runs SET spec_generation=$3,spec_revision_id=$2,state='PENDING_VALIDATION',state_version=state_version+1 WHERE id=$1",[i['run'],spec,f.spec_generation])
    claim=dict(repair['definition'],section=sections['task.alpha.claim-a']);f.definitions['a']=claim
    f.sql('UPDATE hyperfide.tasks SET spec_generation=$4,spec_revision_id=$2,definition=$3,state_version=state_version+1 WHERE id=$1',[i['task_a'],spec,json.dumps(claim),f.spec_generation])
    revalidated=dict(prior,spec_revision_id=spec,spec_generation=f.spec_generation)
    c.insert(f,'proof_registries',c.scoped(f,task_id=i['task_a'],spec_generation=f.spec_generation,spec_revision_id=spec,criteria_digest=repair['criteria_digest'],registry_digest=scheduler.identity(revalidated),policy=revalidated))
    definition={'schema_version':1,'section':sections['task.alpha.finding-origin'],'feature_key':'alpha','declared_wave':1,'runtime_wave_offset':0,'declared_status':None,'history_only':True}
    policy={'schema_version':1,'criteria_digest':criteria,'spec_revision_id':spec,'spec_generation':f.spec_generation,'repository_id':i['repository'],'source_object_id':c.OID,'rubric_digest':rubric,'checks':[check],'clauses':[{'id':'18.4','mode':'EXECUTABLE','acceptance_ids':['V-032'],'checks':['finding-repaired']}],'inputs':{name:c.sha(('fixture-'+name).encode()) for name in ('source','dependency','toolchain','configuration','graph','contract')},'contract_digests':[]}
    return spec,definition,policy,state
def setup(f):
    c.record_database('18.4',f.database,str(f.path))
    f.env['HF_FINDING_REPAIR_MAX_ATTEMPTS']='2';f.env.update(HF_GITHUB_MARKER_SECRET=MARKER_SECRET,HF_GITHUB_WEBHOOK_SECRET=WEBHOOK_SECRET)
    for filename in ('0004-durability.sql','0017-review.sql','0018-findings.sql'):
        if callable(getattr(f,'apply_migration',None)):f.apply_migration(filename.removesuffix('.sql'))
        else:f.sql('BEGIN;\n'+(c.ROOT/'services/hyperfide/migrations'/filename).read_text()+'\nCOMMIT;')
    i=f.ids
    criteria=f.sql('SELECT criteria_digest FROM hyperfide.tasks WHERE id=$1',[i['task_a']])[0]['criteria_digest']
    spec,definition,policy,state=accepted_intent(f,criteria);f.accepted_spec=spec
    f.condition={'condition_id':policy['clauses'][0]['id'],'criteria_digest':criteria,'rubric_digest':policy['rubric_digest'],'requires_original_failure':True,'required_contract_ids':[]}
    x={key:uid() for key in ('task','attempt','artifact','evidence','policy','obligation','receipt')}
    x.update(repository=i['repository'],package=i['package'],manager=i['manager'],watcher=i['watcher']);f.x=x
    # Historical review input never grants compute; it shares the ordinary
    # repair task's exact criterion under its own accepted executable clause.
    c.insert(f,'tasks',c.scoped(f,id=x['task'],task_key='alpha.finding-origin',feature_package_id=x['package'],spec_generation=f.spec_generation,spec_revision_id=spec,criteria_digest=criteria,definition=definition,wave=1))
    c.insert(f,'proof_registries',c.scoped(f,task_id=x['task'],spec_generation=f.spec_generation,spec_revision_id=spec,criteria_digest=criteria,registry_digest=scheduler.identity(policy),policy=policy))
    c.insert(f,'attempts',c.scoped(f,id=x['attempt'],task_id=x['task'],generation='1',authority_epoch=i['epoch'],input_packet_digest=c.sha(b'historical-review-input'),execution_state='FAILED',compute_authority='RELEASED'))
    f.sql("UPDATE hyperfide.tasks SET state='FAILED',generation=1,current_attempt_id=$1,state_version=state_version+1 WHERE id=$2",[x['attempt'],x['task']])
    c.insert(f,'artifacts',c.scoped(f,id=x['artifact'],digest=c.sha(b'historical-review-input'),size_bytes='1',storage_backend='fixture',storage_key='historical-review-input',status='COMPLETE',retention_class='RUN'))
    c.insert(f,'evidence',c.scoped(f,id=x['evidence'],attempt_id=x['attempt'],attempt_generation='1',repository_id=x['repository'],source_object_id=c.OID,criteria_digest=criteria,manifest_digest=c.sha(b'historical-review-manifest'),artifact_id=x['artifact'],admission_state='ADMITTED'))
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
    f.sql('UPDATE hyperfide.runs SET state=$2,state_version=state_version+1 WHERE id=$1',[i['run'],state])
MARKER_SECRET='synthetic-marker-secret-with-32-bytes';WEBHOOK_SECRET='fixture-webhook-secret-with-32-bytes'
def closed_issue_delivery(f,fid):
    # Signed 18.2 inbox delivery: a human closes the projected issue without any fix.
    marker='<!-- hyperfide-finding:'+fid+':'+hmac.new(MARKER_SECRET.encode(),':'.join([f.ids['organisation'],f.ids['run'],f.x['repository'],fid]).encode(),hashlib.sha256).hexdigest()+' -->'
    issue={'number':7,'title':'Synthetic finding','body':'Closed externally without a repair\n\n'+marker,'state':'closed','updated_at':'2030-01-03T00:00:00Z'}
    raw=json.dumps({'repository':{'full_name':'fixture/repository'},'issue':issue},separators=(',',':')).encode()
    return {'delivery_id':uid(),'event_type':'issues','signature':'sha256='+hmac.new(WEBHOOK_SECRET.encode(),raw,hashlib.sha256).hexdigest(),'raw_body_base64':base64.b64encode(raw).decode()}
def restart(f,limit):
    f.stop()
    if limit is None:f.env.pop('HF_FINDING_REPAIR_MAX_ATTEMPTS',None)
    else:f.env['HF_FINDING_REPAIR_MAX_ATTEMPTS']=limit
    f.start()
def claim(f,name='a'):
    # Ordinary production packet + signed claim, pinned to the accepted generation.
    request=f.prepare_claim(name);return f.claim(name,request=dict(request,run_spec_generation=f.spec_generation,spec_generation=f.spec_generation,spec_revision_id=f.accepted_spec))
def reopen_after_change(f,call,fid):
    # Only a genuinely restored assurance can be withdrawn by a relevant change.
    resolved=call('finding.repair.inspect',{'finding_id':fid})
    expect(resolved['phase']=='RESOLVED' and resolved['resolution']['current'] is True,'Requires genuine16/17 resolution before a relevant 16.4 change can withdraw it')
    prior=[r for r in resolved['repairs'] if r['state']=='RESOLVED'][-1]
    c.call(f,'assurance.invalidate',{'organisation_id':f.ids['organisation'],'run_id':f.ids['run'],'submission_id':prior['custody_id'],'request_id':uid(),'expected_state_version':'1','changes':{'source':c.sha(b'relevant-change')}},component='16.4')
    reopened=call('finding.repair.recheck',{'finding_id':fid,'expected_state_version':resolved['registry_version']})
    after=call('finding.repair.inspect',{'finding_id':fid})
    expect(reopened['reopened'] is True and after['phase']=='REOPENED' and after['resolution']['current'] is False and [r for r in after['repairs'] if r['repair_id']==prior['repair_id']][0]['resolution_evidence_ids']==prior['resolution_evidence_ids'])
def main():
    if '--cleanup' in sys.argv:return c.cleanup('18.4')
    f=scheduler.SchedulerFixture(extra_components=('18.1','18.2','18.3','18.4'),extra_setup=setup)
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
        claimed=claim(f);token=claimed['token']
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
        state=call('finding.repair.inspect',{'finding_id':fid})
        check('findings.repair.inspect-api-current-status',lambda:expect(state['phase']=='REPAIRING' and state['resolution']=={'current':False,'reason':'FINDING_NOT_RESOLVED'} and [r['repair_id'] for r in state['repairs']]==[rid] and state['attempt_budget']=={'used':'0','max_attempts':'2','exhausted':False}))
        before=f.sql('SELECT id,state,attempt_count,state_version::text,resolution_evidence_ids FROM hyperfide.finding_repairs ORDER BY id')
        delivery=closed_issue_delivery(f,fid)
        c.call(f,'finding.github.webhook',delivery,component='finding-github')
        processed=c.call(f,'finding.github.process-delivery',{'delivery_id':delivery['delivery_id'],'repository_id':f.x['repository'],'owner':'fixture','repository':'repository'},component='finding-github')
        closed=call('finding.repair.inspect',{'finding_id':fid})
        check('findings.repair.external-close-recorded-descriptively',lambda:expect(processed.get('external_state')=='closed' and closed['external_issue'] is not None and closed['external_issue']['external_state']=='closed'))
        check('findings.repair.external-close-not-resolution',lambda:expect(closed['resolution']['current'] is False and closed['phase']=='REPAIRING' and c.call(f,'finding.inspect',{'finding_id':fid})['finding']['phase']!='RESOLVED' and c.call(f,'finding.blockers.inspect',{})['clear'] is False))
        check('findings.repair.external-close-no-repair-change',lambda:expect(f.sql('SELECT id,state,attempt_count,state_version::text,resolution_evidence_ids FROM hyperfide.finding_repairs ORDER BY id')==before and f.sql("SELECT count(*)::int AS n FROM hyperfide.outbox_events WHERE aggregate_id=$1 AND event_type IN ('finding.resolved','finding.repair-requested')",[fid])[0]['n']==1))
        check('findings.repair.recheck-requires-resolution',lambda:reject('finding.repair.recheck',{'finding_id':fid,'expected_state_version':finding_version(fid)},'FINDING_NOT_RESOLVED'))
        again=c.call(f,'finding.report',{'observation_id':c.observation(f),'resolution_condition':f.condition})
        check('findings.repair.matching-observation-no-duplicate-dispatch',lambda:expect(again['finding_id']==fid and call('finding.repair.inspect',{'finding_id':fid})['phase']=='REPAIRING' and f.sql('SELECT count(*)::int AS n FROM hyperfide.finding_repairs')[0]['n']==1))
        retry=dict(packet,request_id=uid())
        restart(f,'3')
        check('findings.repair.retry-policy-change-refused',lambda:reject('finding.repair.request',dict(retry,expected_state_version=finding_version(fid)),'REPAIR_POLICY_CHANGED'))
        restart(f,None)
        check('findings.repair.unbounded-retry-policy-refused',lambda:reject('finding.repair.request',dict(retry,expected_state_version=finding_version(fid)),'REPAIR_POLICY_REQUIRED'))
        restart(f,'2')
        check('findings.repair.refused-retries-preserve-evidence-links',lambda:expect(f.sql('SELECT id,state,attempt_count,state_version::text,resolution_evidence_ids FROM hyperfide.finding_repairs ORDER BY id')==before and f.sql('SELECT count(*)::int AS n FROM hyperfide.finding_registry_reports WHERE finding_id=$1',[fid])[0]['n']==2 and call('finding.repair.inspect',{'finding_id':fid})['attempt_budget']['max_attempts']=='2'))
        # These are genuine unresolved producer gates. Neither fixture SQL nor a
        # caller-supplied outcome may turn them into execution/qualification.
        check('findings.repair.genuine-execution-start-observed',lambda:expect(f.sql('SELECT execution_state FROM hyperfide.attempts WHERE id=$1',[token['attempt_id']])[0]['execution_state']=='RUNNING','Actual12/13 observed START receipt is not integrated'))
        check('findings.repair.genuine-independent-resolution',lambda:expect(c.call(f,'finding.inspect',{'finding_id':fid})['finding']['phase']=='RESOLVED','Actual16/17 independent repair proof is not integrated'))
        check('findings.repair.reopen-after-relevant-change',lambda:reopen_after_change(f,call,fid))
    finally:f.close()
    return int(any(actual!='observed' for _,actual in c.RESULTS))
if __name__=='__main__':raise SystemExit(main())
