#!/usr/bin/env python3
"""Domain18 real signed HTTPS/PostgreSQL probes; upstream review rows are trusted synthetic fixture inputs.

This component test does not qualify domain17 review execution or any live GitHub account.
"""
from __future__ import annotations
import hashlib, importlib.util, json, os, shutil, subprocess, sys, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,SQL_JS,uid,sha
RESULTS=[]
D=sha(b'finding-condition-v1'); RUBRIC=sha(b'finding-rubric-v1'); OID='a'*40
CONDITION={'condition_id':'finding.repaired','criteria_digest':D,'rubric_digest':RUBRIC,'requires_original_failure':True,'required_contract_ids':[]}
def expect(value,message='Observed result differs from the recorded contract'):
    if not value:raise AssertionError(message)
def check(name,callback):
    try:callback();actual='observed'
    except Exception as error:actual=type(error).__name__+': '+str(error)[:500]
    RESULTS.append((name,actual));print(json.dumps({'type':'assertion','id':name,'expected':'observed','actual':actual}),flush=True)
def campaign():return Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/domain18-standalone'))
def record_database(task,database,directory):
    target=campaign()/'findings';target.mkdir(parents=True,exist_ok=True)
    (target/('task-'+task+'-resource.json')).write_text(json.dumps({'database':database,'directory':directory})+'\n')
def cleanup(task):
    target=campaign()/'findings';target.mkdir(parents=True,exist_ok=True);complete=False
    try:
        profile=json.loads((target/('task-'+task+'-resource.json')).read_text());database=profile['database']
        expect(database=='hf_task_'+task.replace('.','_')+'_qualification','Unexpected disposable database identity')
        for query in ('DROP DATABASE IF EXISTS "'+database+'" WITH (FORCE)',"SELECT datname FROM pg_database WHERE datname='"+database+"'"):
            result=subprocess.run(['node','--input-type=commonjs','-e',SQL_JS],input=json.dumps({'sql':query,'values':[]}),text=True,cwd=ROOT,env=os.environ.copy(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
            expect(result.returncode==0,'Database absence observer failed')
        database_absent=json.loads(result.stdout)==[]
        directory=Path(profile['directory']);expect(directory.parent==Path('/tmp') and directory.name.startswith('hyperfide-identity-') and not directory.is_symlink(),'Unexpected fixture directory identity')
        if directory.exists():shutil.rmtree(directory)
        complete=database_absent and not directory.exists()
    except Exception:complete=False
    relative='findings/task-'+task+'-absence.json';(campaign()/relative).write_text(json.dumps({'observed_absent':complete,'observer':'actual PostgreSQL pg_database after DROP DATABASE','scope':'synthetic local component fixture'})+'\n')
    print(json.dumps({'type':'cleanup','complete':complete,'resources':[{'id':'hf-task-'+task+'-'+kind,'status':'deleted' if complete else 'unknown','observed_absent':complete,'evidence_artifact':relative} for kind in ('database','tls-directory')]}),flush=True)
    return int(not complete)
def insert(f,table,data):
    columns=list(data);return f.sql('INSERT INTO hyperfide.'+table+'('+','.join(columns)+') VALUES('+','.join('$'+str(i+1) for i in range(len(columns)))+')',[json.dumps(data[c]) if isinstance(data[c],(dict,list)) else data[c] for c in columns])
def scoped(f,**data):return dict(organisation_id=f.ids['organisation'],run_id=f.ids['run'],**data)
def seed(f,task):
    record_database(task,f.database,str(f.path))
    # Apply actual reviewed migrations only; missing prerequisite source is an error.
    for filename in ('0002-spec.sql','0003-hierarchy.sql','0017-review.sql','0018-findings.sql'):
        sql=(ROOT/'services/hyperfide/migrations'/filename).read_text();f.sql('BEGIN;\n'+sql+'\nCOMMIT;')
    f.x={key:uid() for key in ('repository','package','collaborator','task','attempt','watcher','manager','successor','peer','artifact','evidence','policy','obligation','receipt')}
    x=f.x;i=f.ids
    insert(f,'repositories',{'organisation_id':i['organisation'],'id':x['repository'],'project_id':i['project'],'name':'synthetic-findings','url':'https://example.invalid/synthetic-findings.git'})
    for value,kind in ((OID,'commit'),('b'*40,'commit'),('c'*40,'tree')):insert(f,'source_objects',{'organisation_id':i['organisation'],'repository_id':x['repository'],'object_id':value,'object_type':kind})
    insert(f,'run_repositories',scoped(f,repository_id=x['repository'],source_object_id=OID,integration_ref='refs/heads/main'))
    for key,role in (('watcher','COMMIT_WATCHER'),('manager','FEATURE_MANAGER'),('successor','FEATURE_MANAGER'),('peer','FEATURE_MANAGER')):
        insert(f,'agent_sessions',scoped(f,id=x[key],role=role,connector='fixture',account_key='fixture',native_session_id='fixture-'+key,state='RUNNING'))
    for key,manager in (('package','manager'),('collaborator','peer')):
        insert(f,'feature_packages',scoped(f,id=x[key],package_key='fixture-'+key,wave=1,manager_session_id=x[manager]))
        insert(f,'hierarchy_packages',scoped(f,package_id=x[key],feature_key='fixture-'+key,allocation_policy='FEATURE_STABLE',state='ACTIVE'))
    insert(f,'tasks',scoped(f,id=x['task'],task_key='18.fixture.origin',feature_package_id=x['package'],spec_revision_id=i['spec'],criteria_digest=D,definition={},wave=1))
    executable=Path(subprocess.check_output(['node','-p','process.execPath'],text=True).strip()).resolve(strict=True);proof_check={'id':'finding.repaired','argv':[str(executable),'--version'],'executable_digest':sha(executable.read_bytes()),'timeout_ms':1000,'required_artifacts':['fixture/stdout.log'],'input_keys':['source','dependency','toolchain','configuration','graph','contract']}
    proof_policy={'schema_version':1,'criteria_digest':D,'spec_revision_id':i['spec'],'spec_generation':'1','repository_id':x['repository'],'source_object_id':OID,'rubric_digest':RUBRIC,'checks':[proof_check,dict(proof_check,id='finding.other')],'clauses':[{'id':'18.1','mode':'EXECUTABLE','acceptance_ids':['V-032'],'checks':['finding.repaired','finding.other']}],'inputs':{name:sha(('fixture-'+name).encode()) for name in ('source','dependency','toolchain','configuration','graph','contract')},'contract_digests':[]}
    insert(f,'proof_registries',scoped(f,task_id=x['task'],spec_generation='1',spec_revision_id=i['spec'],criteria_digest=D,registry_digest=sha(json.dumps(proof_policy,sort_keys=True,separators=(',',':')).encode()),policy=proof_policy))
    insert(f,'attempts',scoped(f,id=x['attempt'],task_id=x['task'],generation='1',authority_epoch=i['epoch'],input_packet_digest=sha(b'fixture-input'),execution_state='SUBMITTED',compute_authority='RELEASED'))
    insert(f,'artifacts',scoped(f,id=x['artifact'],digest=sha(b'fixture-artifact'),size_bytes='1',storage_backend='fixture',storage_key='finding-evidence',status='COMPLETE',retention_class='RUN'))
    insert(f,'evidence',scoped(f,id=x['evidence'],attempt_id=x['attempt'],attempt_generation='1',repository_id=x['repository'],source_object_id=OID,criteria_digest=D,manifest_digest=sha(b'fixture-manifest'),artifact_id=x['artifact'],admission_state='ADMITTED'))
    policy=sha(b'fixture-review-policy');inputs=sha(b'fixture-review-inputs');candidate=sha(b'fixture-review-candidate')
    insert(f,'review_policies',scoped(f,digest=policy,revision='1',definition={}))
    insert(f,'review_watchers',scoped(f,policy_digest=policy,watcher_id='fixture-reviewer',reviewer_session_id=x['watcher'],rubric_digest=RUBRIC,review_class='semantic',path_prefixes=[]))
    insert(f,'review_commits',scoped(f,repository_id=x['repository'],source_object_id=OID,tree_object_id='c'*40,parent_objects=[],changed_paths=['fixture.ts'],attribution={'task_id':x['task'],'attempt_id':x['attempt']}))
    insert(f,'review_obligations',scoped(f,id=x['obligation'],repository_id=x['repository'],source_object_id=OID,policy_digest=policy,watcher_id='fixture-reviewer'))
    insert(f,'review_obligation_inputs',scoped(f,obligation_id=x['obligation'],generation='1',input_manifest_digest=inputs,candidate_digest=candidate,snapshot={}))
    insert(f,'review_receipts',scoped(f,id=x['receipt'],request_id=uid(),request_digest=sha(b'fixture-request'),obligation_id=x['obligation'],lease_generation='1',generation='1',reviewer_session_id=x['watcher'],rubric_digest=RUBRIC,input_manifest_digest=inputs,candidate_digest=candidate,outcome='FINDINGS',limitations=[]))
    insert(f,'review_receipt_evidence',scoped(f,receipt_id=x['receipt'],evidence_id=x['evidence']))
    f.sql("UPDATE hyperfide.review_obligations SET state='COMPLETE',input_manifest_digest=$1,candidate_digest=$2,current_receipt_id=$3 WHERE id=$4",[inputs,candidate,x['receipt'],x['obligation']])
def observation(f,fingerprint='same-reproducer',severity='ERROR',source=OID,evidence=None):
    value=uid();insert(f,'review_observations',scoped(f,id=value,review_receipt_id=f.x['receipt'],evidence_id=evidence or f.x['evidence'],observer_session_id=f.x['watcher'],origin_task_id=f.x['task'],origin_attempt_id=f.x['attempt'],repository_id=f.x['repository'],source_object_id=source,failure_fingerprint=sha(fingerprint.encode()),summary='Synthetic actionable finding',severity=severity));return value
def call(f,action,payload,component='finding-registry',key='operator'):
    status,body=f.invoke(action,payload,component=component,key=key)
    expect(status==200 and body.get('ok') is True,'Signed service call refused: '+str(body.get('error',{}).get('code')))
    return body['result']
def reject(f,action,payload,code=None,component='finding-registry',key='operator'):
    _,body=f.invoke(action,payload,component=component,key=key);expect(body.get('ok') is False,'Invalid request was accepted')
    if code:expect(body.get('error',{}).get('code')==code,'Unexpected rejection code '+str(body.get('error',{}).get('code')))
def finding(f,obs=None,condition=None,collaborators=None):
    return call(f,'finding.report',{'observation_id':obs or observation(f),'resolution_condition':condition or CONDITION,'collaborator_package_ids':collaborators or []})
def fixture(task,extra=(),env=None,after_seed=None):
    def setup(f):
        seed(f,task)
        if after_seed:after_seed(f)
    return IdentityFixture(database='hf_task_'+task.replace('.','_')+'_qualification',extra_components=('18.1',)+tuple(extra),extra_env=env,extra_setup=setup)
def main():
    if '--cleanup' in sys.argv:return cleanup('18.1')
    f=fixture('18.1')
    try:
        a=observation(f);first=finding(f,a,collaborators=[f.x['collaborator']]);fid=first['finding_id']
        check('findings.registry.signed-report',lambda:expect(first['phase']=='OPEN' and first['replayed'] is False))
        check('findings.registry.exact-replay',lambda:expect(finding(f,a,collaborators=[f.x['collaborator']])['replayed'] is True))
        changed=dict(CONDITION,condition_id='finding.other')
        check('findings.registry.replay-intent-conflict',lambda:reject(f,'finding.report',{'observation_id':a,'resolution_condition':changed},'IDEMPOTENCY_CONFLICT'))
        duplicate=finding(f,observation(f,severity='CRITICAL'));check('findings.registry.canonical-dedup',lambda:expect(duplicate['finding_id']==fid and duplicate['deduplicated'] is True))
        snapshot=call(f,'finding.inspect',{'finding_id':fid})
        check('findings.registry.all-observations-preserved',lambda:expect(len(snapshot['reports'])==2))
        check('findings.registry.severity-escalates',lambda:expect(snapshot['finding']['severity']=='CRITICAL'))
        check('findings.registry.origin-and-conditions',lambda:expect(snapshot['finding']['origin_attempt_id']==f.x['attempt'] and all(snapshot['finding']['resolution_condition'].get(key)==value for key,value in CONDITION.items()) and snapshot['finding']['collaborator_package_ids']==[f.x['collaborator']]))
        distinct=finding(f,observation(f,'different-reproducer'));check('findings.registry.distinct-reproducer',lambda:expect(distinct['finding_id']!=fid))
        untriaged=observation(f,'untriaged-upstream');check('findings.registry.untriaged-observation-blocks',lambda:expect(any(row.get('observation_id')==untriaged and row.get('reason')=='UNTRIAGED_BLOCKING_OBSERVATION' for row in call(f,'finding.blockers.inspect',{})['blockers'])))
        check('findings.registry.unknown-observation',lambda:reject(f,'finding.report',{'observation_id':uid(),'resolution_condition':CONDITION},'OBSERVATION_INVALID'))
        check('findings.registry.reject-counterfactual-waiver',lambda:reject(f,'finding.report',{'observation_id':observation(f),'resolution_condition':dict(CONDITION,requires_original_failure=False)},'CONDITION_MISMATCH'))
        check('findings.registry.reject-unaccepted-condition',lambda:reject(f,'finding.report',{'observation_id':observation(f),'resolution_condition':dict(CONDITION,condition_id='unaccepted.check')},'CONDITION_MISMATCH'))
        check('findings.registry.unknown-field',lambda:reject(f,'finding.report',{'observation_id':a,'resolution_condition':CONDITION,'resolved':True},'INVALID_REQUEST'))
        check('findings.registry.reject-unscoped-collaborator',lambda:reject(f,'finding.report',{'observation_id':observation(f),'resolution_condition':CONDITION,'collaborator_package_ids':[uid()]},'SCOPE_MISMATCH'))
        check('findings.registry.evidence-source-binding',lambda:reject(f,'finding.report',{'observation_id':observation(f,source='b'*40),'resolution_condition':CONDITION},'EVIDENCE_INVALID'))
        check('findings.registry.missing-finding',lambda:reject(f,'finding.inspect',{'finding_id':uid()},'FINDING_NOT_FOUND'))
        check('findings.registry.bounded-pagination',lambda:expect(len(call(f,'finding.list',{'limit':1})['findings'])==1 and call(f,'finding.list',{'limit':1})['next_after_id'] is not None))
        check('findings.registry.reject-pagination-overflow',lambda:reject(f,'finding.list',{'limit':101},'INVALID_REQUEST'))
        before=call(f,'finding.inspect',{'finding_id':distinct['finding_id']})['finding'];packet={'source_finding_id':distinct['finding_id'],'target_finding_id':fid,'reason':'Reviewed equivalent failure','evidence_ids':[f.x['evidence']],'expected_state_version':str(before['registry_version'])}
        check('findings.registry.confirm-duplicate',lambda:expect(call(f,'finding.duplicate.confirm',packet)['replayed'] is False))
        check('findings.registry.duplicate-replay',lambda:expect(call(f,'finding.duplicate.confirm',packet)['replayed'] is True))
        check('findings.registry.duplicate-preserves-reports',lambda:expect(len(call(f,'finding.inspect',{'finding_id':distinct['finding_id']})['reports'])==1))
        check('findings.registry.duplicate-cycle-rejected',lambda:reject(f,'finding.duplicate.confirm',dict(packet,source_finding_id=fid,target_finding_id=distinct['finding_id'],expected_state_version=str(snapshot['finding']['registry_version'])),'DUPLICATE_CYCLE'))
        f.sql("UPDATE hyperfide.finding_registry_records SET phase='RESOLVED',state_version=state_version+1 WHERE finding_id=$1",[fid]);f.sql("UPDATE hyperfide.findings SET state='RESOLVED',state_version=state_version+1 WHERE id=$1",[fid])
        reopened=finding(f,observation(f,'different-reproducer'))
        check('findings.registry.alias-observation-reopens-canonical',lambda:expect(reopened['finding_id']==fid and reopened['reopened'] is True and reopened['phase']=='REOPENED'))
        context=call(f,'finding.context.read',{'limit':100});check('findings.registry.context-preserves-provenance',lambda:expect(context['qualifies_findings'] is False and any(row['observation_id']==a and row['evidence_id']==f.x['evidence'] and row['source_object_id']==OID for row in context['observations']) and context['context_digest'].startswith('sha256:')))
        check('findings.registry.context-explicit-pagination',lambda:expect(call(f,'finding.context.read',{'limit':1})['next_observation_id'] is not None))
        check('findings.registry.no-implicit-repair',lambda:expect(f.sql('SELECT count(*)::text AS n FROM hyperfide.finding_repairs')[0]['n']=='0'))
        check('findings.registry.append-only-report-history',lambda:assert_sql_refused(f,'DELETE FROM hyperfide.finding_registry_reports'))
        check('findings.registry.operator-audit-identity',lambda:expect(f.sql('SELECT actor_id,actor_role,credential_id FROM hyperfide.finding_duplicate_links')[0]=={'actor_id':f.ids['operator'],'actor_role':'OPERATOR','credential_id':f.ids['operator']}))
        check('findings.registry.signed-cross-run-refused',lambda:expect(f.request(f.operation('finding-registry','finding.list',{},run=uid()))[1].get('ok') is False))
    finally:f.close()
    return int(any(actual!='observed' for _,actual in RESULTS))
def assert_sql_refused(f,query):
    try:f.sql(query)
    except AssertionError:return
    raise AssertionError('Append-only database history mutated')
if __name__=='__main__':raise SystemExit(main())
