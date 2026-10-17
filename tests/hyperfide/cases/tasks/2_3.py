#!/usr/bin/env python3
"""Task 2.3 component probe: versioned amendments and active-run replanning over signed HTTPS."""
import copy,hashlib,json,os,re,subprocess,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,sha,canonical
RESOURCE='hf-task-2.3-database'
SOURCE='''[meta]
slug = "fixture"
[req.1]
ac_1 = "An actual executable obligation"
[req.2]
ac_1 = "An independent executable obligation"
[acceptance.1]
req = "1.1"
checks = ["actual-check"]
[acceptance.2]
req = "2.1"
checks = ["actual-check"]
[task.1]
wave = 1
feature = "fixture"
reqs = ["1.1"]
verify_cmd = "printf accepted"
artifacts = ["proof.json"]
acceptance_ids = ["1"]
requires = []
touches = ["src/a.ts"]
[task.2]
wave = 2
feature = "fixture"
reqs = ["1.1"]
verify_cmd = "printf accepted"
artifacts = ["proof.json"]
acceptance_ids = ["1"]
requires = ["1"]
touches = ["src/b.ts"]
[task.3]
wave = 1
feature = "fixture"
reqs = ["2.1"]
verify_cmd = "printf independent"
artifacts = ["proof.json"]
acceptance_ids = ["2"]
requires = []
touches = ["src/c.ts"]
'''
OBS=[];FAILED=[];DATABASES=[]
def artifact_root():
    path=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/task-2.3-standalone'));path.mkdir(parents=True,exist_ok=True);return path
def expect(value,message):
    if not value:raise AssertionError(message)
def check(ident,body):
    OBS.append(ident)
    try:body();actual='observed'
    except Exception as error:actual=type(error).__name__+': '+str(error);FAILED.append(ident)
    print(json.dumps({'type':'assertion','id':ident,'expected':'observed','actual':actual}),flush=True)
def parse(source):
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT))
def executable():return str(Path(sys.executable).resolve())
def proof_source(base):
    check_fields={'argv':[executable(),'-c','raise SystemExit(1)',''],'executable_digest':sha(Path(executable()).read_bytes()),'timeout_ms':600000,'required_artifacts':['proof.json'],'input_keys':['source']}
    return base+'\n[proof]\nrubric_digest = '+json.dumps(sha(b'rubric'))+'\n[proof.check.actual-check]\n'+''.join(key+' = '+json.dumps(value)+'\n' for key,value in check_fields.items())
def setup(f):
    # The fixture migration engine applies the complete release; verify exact pins rather than re-applying DDL.
    for name in ['0002-spec','0004-durability','0016-qualification','0032-execution-packets','0202-spec-dependencies']:f.apply_migration(name)
    f.ids.update({key:str(uuid.uuid4()) for key in ['repository','accepted_spec','package','package2','task1','task2','task3']})
    i=f.ids;source=proof_source(SOURCE);parsed=parse(source)
    intent={'schema_version':1,'revision_digest':sha(b'accepted-envelope'),'source_digest':sha(source.encode()),'repositories':[{'repository_id':i['repository'],'source_object_id':'a'*40,'integration_ref':'refs/heads/main'}],'allowed_actions':f.actions,'closure_policy':{'required_evidence':['actual-check'],'required_review_roles':['VERIFIER'],'publication':'AFTER_QUALIFICATION'},'provenance':None,'parsed':parsed,'runtime_wave_offset':0}
    f.sql("INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url,object_format) VALUES($1,$2,$3,'fixture','https://example.invalid/fixture.git','sha1')",[i['organisation'],i['project'],i['repository']])
    f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,'commit')",[i['organisation'],i['repository'],'a'*40])
    f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[i['organisation'],i['project'],i['accepted_spec'],sha(source.encode()),source,json.dumps(intent),intent['revision_digest']])
    f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)",[i['organisation'],i['run'],i['accepted_spec']])
    f.sql("UPDATE hyperfide.runs SET spec_generation=2,spec_revision_id=$3,state='PENDING_VALIDATION',state_version=2 WHERE organisation_id=$1 AND id=$2",[i['organisation'],i['run'],i['accepted_spec']])
    f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[i['organisation'],i['run'],i['repository'],'a'*40])
    f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'feature:fixture:wave:1',1)",[i['organisation'],i['run'],i['package']])
    f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'feature:fixture:wave:2',2)",[i['organisation'],i['run'],i['package2']])
    f.criteria=sha(canonical({'reqs':['1.1'],'accepted_text':'An actual executable obligation'}))
    rows=[]
    for section in [section for section in parsed['sections'] if section['name'].startswith('task.')]:
        number=section['name'][5:];wave=section['fields']['wave']['value']
        definition={'schema_version':1,'section':section,'feature_key':'fixture','declared_wave':wave,'runtime_wave_offset':0,'declared_status':None,'history_only':True}
        rows.append({'id':i['task'+number],'task_key':number,'feature_package_id':i['package'] if wave==1 else i['package2'],'definition':definition,'wave':wave})
    f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave,state) SELECT $1,$2,x.id,x.task_key,x.feature_package_id,$3,2,$4,x.definition,x.wave,'PENDING' FROM jsonb_to_recordset($5::jsonb) AS x(id uuid,task_key text,feature_package_id uuid,definition jsonb,wave integer)",[i['organisation'],i['run'],i['accepted_spec'],f.criteria,json.dumps(rows)])
    f.env.update({'HF_SPEC_ALLOWED_ROOT':str(f.path),'HF_SPEC_ORGANISATION_ID':i['organisation'],'HF_SPEC_PROJECT_ID':i['project'],'HF_AUTHORITY_EPOCH':i['epoch'],'HF_PROOF_MAX_CHECK_MS':'1800000'})

def invoke(f,action,value,key='operator',component='spec-revisions'):
    status,result=f.invoke(action,value,component=component,key=key)
    expect(status==200,'Actual signed transport failed for '+action)
    return result
def success(f,action,value,key='operator',component='spec-revisions'):
    r=invoke(f,action,value,key,component);expect(r.get('ok') is True,action+' failed: '+str(r.get('error',{}).get('code'))+' '+str(r.get('error',{}).get('message')));return r['result']
def refused(f,action,value,code,key='operator'):
    r=invoke(f,action,value,key);expect(r.get('ok') is False and r.get('error',{}).get('code')==code,'Expected exact '+code+', observed '+str(r.get('error',{}).get('code') if r.get('ok') is False else 'success'))
def run_row(f):return f.sql("SELECT state,spec_generation::text g,spec_revision_id::text s,state_version::text v FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",[f.ids['organisation'],f.ids['run']])[0]
def task_row(f,name):return f.sql("SELECT state,spec_generation::text g,criteria_digest c,definition FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[f.ids['organisation'],f.ids['run'],f.ids[name]])[0]
def count(f,sql,values=None):return f.sql("SELECT count(*)::int n FROM "+sql,values or [])[0]['n']
def request(f,source,purpose='REPLAN',name='replacement.kvx'):
    raw=proof_source(source).encode();(f.path/name).write_bytes(raw);run=run_row(f)
    return {'run_id':f.ids['run'],'base_spec_revision_id':run['s'],'base_spec_generation':run['g'],'state_version':run['v'],'purpose':purpose,'reason':'Explicit bounded fixture replan','replacement':{'run_id':f.ids['run'],'source':{'relative_path':name,'sha256':hashlib.sha256(raw).hexdigest(),'size_bytes':str(len(raw))},'repositories':[{'repository_id':f.ids['repository'],'source_object_id':'a'*40,'integration_ref':'refs/heads/main'}],'allowed_actions':f.actions,'closure_policy':{'required_evidence':['actual-check'],'required_review_roles':['VERIFIER'],'publication':'AFTER_QUALIFICATION'},'provenance':None}}
def policy(f,task,criteria,spec,generation,clause,acceptance):
    return {'schema_version':1,'criteria_digest':criteria,'spec_revision_id':spec,'spec_generation':generation,'repository_id':f.ids['repository'],'source_object_id':'a'*40,'rubric_digest':sha(b'rubric'),'checks':[{'id':'actual-check','argv':[executable(),'-c','raise SystemExit(1)',''],'executable_digest':sha(Path(executable()).read_bytes()),'timeout_ms':600000,'required_artifacts':['proof.json'],'input_keys':['source']}],'clauses':[{'id':clause,'mode':'EXECUTABLE','acceptance_ids':[acceptance],'checks':['actual-check']}],'inputs':{key:sha(key.encode()) for key in ['source','dependency','toolchain','configuration','graph','contract']},'contract_digests':[]}
def admit(f,proposal,revalidate,proofs=None,key='operator'):
    return {'run_id':f.ids['run'],'amendment_id':proposal['amendment_id'],'proposal_digest':proposal['proposal_digest'],'revalidate_task_ids':revalidate,'justification':'Explicitly revalidated fixture amendment','proof_policies':proofs or []}

def activate(f):
    """Admit generation2 through 2.2/2.4, then seed live execution: task1 accepted work, task2 current compute."""
    i=f.ids;org,run=i['organisation'],i['run']
    for name,clause,acceptance in [('task1','1.1','1'),('task2','1.1','1'),('task3','2.1','2')]:
        success(f,'spec.proof.register',{'run_id':run,'task_id':i[name],'spec_revision_id':i['accepted_spec'],'spec_generation':'2','state_version':'2','policy':policy(f,name,f.criteria,i['accepted_spec'],'2',clause,acceptance)},component='spec-obligations')
    admitted=success(f,'spec.dependencies.admit',{'run_id':run,'spec_revision_id':i['accepted_spec'],'spec_generation':'2','state_version':'2'},component='spec-dependencies')
    expect(admitted['admitted'] is True,'Initial plan was not admitted')
    f.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[org,run])
    boot=f.sql("SELECT boot_generation::text g FROM hyperfide.sandbox_boots WHERE organisation_id=$1 AND sandbox_id=$2 ORDER BY boot_generation DESC LIMIT 1",[org,i['sandbox']])[0]['g']
    i.update({key:str(uuid.uuid4()) for key in ['slot','attempt1','attempt2','artifact','evidence','custody']})
    f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,'fixture-slot',$4,'AGENT','ALLOCATED')",[org,i['slot'],i['sandbox'],boot])
    # Accepted historical work on task1: released attempt, admitted evidence and a released passing custody.
    f.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority) VALUES($1,$2,$3,$4,1,$5,$6,'SUCCEEDED','RELEASED')",[org,run,i['attempt1'],i['task1'],i['epoch'],sha(b'packet-1')])
    f.sql("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status) VALUES($1,$2,$3,$4,5,'fixture','evidence/proof.json','COMPLETE')",[org,run,i['artifact'],sha(b'proof')])
    f.sql("INSERT INTO hyperfide.evidence(organisation_id,run_id,id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest,manifest_digest,artifact_id,admission_state) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,'ADMITTED')",[org,run,i['evidence'],i['attempt1'],i['repository'],'a'*40,f.criteria,sha(b'manifest'),i['artifact']])
    f.sql("INSERT INTO hyperfide.submission_custodies(organisation_id,run_id,id,task_id,source_attempt_id,source_generation,custody_generation,authority_epoch,repository_id,source_object_id,source_manifest_digest,evidence_manifest_digest,criteria_digest,authority,qualification_outcome) VALUES($1,$2,$3,$4,$5,1,1,$6,$7,$8,$9,$10,$11,'RELEASED','PASS')",[org,run,i['custody'],i['task1'],i['attempt1'],i['epoch'],i['repository'],'a'*40,sha(b'source-manifest'),sha(b'evidence-manifest'),f.criteria])
    f.sql("UPDATE hyperfide.tasks SET state='INTEGRATED',generation=1,current_attempt_id=$4,current_custody_id=$5,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,i['task1'],i['attempt1'],i['custody']])
    # task2 is executing now with current compute ownership.
    f.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) VALUES($1,$2,$3,$4,1,$5,$6,'RUNNING','CURRENT',$7,$8,$9,clock_timestamp()+interval '1 hour')",[org,run,i['attempt2'],i['task2'],i['epoch'],sha(b'packet-2'),i['sandbox'],i['slot'],boot])
    f.sql("UPDATE hyperfide.tasks SET state='RUNNING',generation=1,current_attempt_id=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,i['task2'],i['attempt2']])

def probe(f):
    i=f.ids;org,run=i['organisation'],i['run']
    manager=f.add_principal('manager','FEATURE_MANAGER')
    activate(f)
    baseline=SOURCE
    task3_only=baseline.replace('touches = ["src/c.ts"]','touches = ["src/c.ts", "src/c2.ts"]')
    task1_change=baseline.replace('touches = ["src/a.ts"]','touches = ["src/a.ts", "src/a2.ts"]')
    saved={}
    def analyse():
        r=success(f,'spec.amendment.check',request(f,task3_only),key='manager')
        expect(r['status']=='STRUCTURALLY_VALID' and r['accepted'] is False and r['dispatch_authority'] is False,'Valid amendment analysis mismatch: '+str(r['diagnostics'])+str([d['code'] for d in r['structural']['diagnostics']]))
        expect(r['impact']['changed']==['3'] and r['impact']['affected_task_ids']==[i['task3']],'Changed task impact was not exact')
        expect([x['task_id'] for x in r['impact']['revalidation']]==[i['task3']] and r['impact']['unaffected_active_task_ids']==[i['task2']],'Running unaffected work was not reported as continuing')
    check('amendment.analysis.actual-signed-service',analyse)
    check('amendment.analysis.readonly',lambda:expect(count(f,'hyperfide.spec_amendments')==0 and run_row(f)['g']=='2','Analysis mutated accepted state'))
    def active_impact():
        r=success(f,'spec.amendment.check',request(f,task1_change))
        rows={x['task_id']:x for x in r['impact']['revalidation']}
        expect(set(rows)=={i['task1'],i['task2']},'Transitive impact on active attempts was lost')
        expect(rows[i['task1']]['accepted_work'] is True and rows[i['task1']]['live_evidence']==1 and rows[i['task1']]['released_custody']==1 and rows[i['task1']]['disposition']=='REVALIDATE','Accepted work impact is not explicit')
        expect(rows[i['task2']]['current_compute']==1 and rows[i['task2']]['disposition']=='FENCE_REQUIRED','Active compute impact is not explicit')
    check('amendment.impact.active-attempts',active_impact)
    def propose():
        saved['p3']=success(f,'spec.amendment.propose',request(f,task3_only),key='manager')
        expect(saved['p3']['decision']=='PROPOSED' and saved['p3']['accepted'] is False,'Proposed amendment was accepted implicitly')
        expect(count(f,'hyperfide.spec_amendment_decisions')==0 and run_row(f)['g']=='2' and task_row(f,'task3')['state']=='PENDING','Proposal changed accepted or runtime state')
    check('amendment.propose.immutable-record',propose)
    def provenance():
        row=f.sql("SELECT proposer_session_id::text s,proposal FROM hyperfide.spec_amendments WHERE id=$1",[saved['p3']['amendment_id']])[0]
        expect(row['s']==manager['actor_id'] and row['proposal']['proposer']['role']=='FEATURE_MANAGER' and row['proposal']['justification']=='Explicit bounded fixture replan','Manager proposal lost actor/justification provenance')
    check('amendment.propose.manager-provenance',provenance)
    check('amendment.propose.exact-replay',lambda:expect(success(f,'spec.amendment.propose',request(f,task3_only),key='manager')['amendment_id']==saved['p3']['amendment_id'] and count(f,'hyperfide.spec_amendments')==1,'Proposal replay duplicated immutable intent'))
    def immutable():
        rejected=False
        try:f.sql("UPDATE hyperfide.spec_amendments SET proposal='{}'::jsonb")
        except AssertionError:rejected=True
        expect(rejected,'Stored proposed intent was mutable')
    check('amendment.propose.storage-immutable',immutable)
    p=request(f,task3_only)
    check('amendment.pin.stale-base',lambda:refused(f,'spec.amendment.check',dict(p,base_spec_generation='1'),'AMENDMENT_BASE_STALE'))
    check('amendment.pin.strict-fields',lambda:refused(f,'spec.amendment.check',dict(p,force=True),'AMENDMENT_INPUT_INVALID'))
    wrong=copy.deepcopy(p);wrong['replacement']['source']['sha256']='f'*64
    check('amendment.pin.source-digest',lambda:refused(f,'spec.amendment.check',wrong,'DIGEST_MISMATCH'))
    def scenario(ident,source,code=None,purpose='REPLAN'):
        def body():
            r=success(f,'spec.amendment.check',request(f,source,purpose))
            codes=[d['code'] for d in r['diagnostics']]+[d['code'] for d in r['structural']['diagnostics']]
            if code:expect(r['status']=='INVALID' and code in codes,'Missing explicit '+code+': '+str(codes))
            else:expect(r['status']=='STRUCTURALLY_VALID','Valid proposal was rejected: '+str(codes))
        check(ident,body)
    scenario('amendment.replan.cannot-weaken-global-intent',baseline.replace('An actual executable obligation','A weaker criterion'),'INTENT_APPROVAL_REQUIRED')
    scenario('amendment.replan.cannot-weaken-accepted-command',baseline.replace('printf accepted','true'),'ACCEPTED_TASK_CHECK_CANNOT_BE_WEAKENED')
    scenario('amendment.replan.cannot-narrow-acceptance',baseline.replace('acceptance_ids = ["2"]','acceptance_ids = []'),'ACCEPTANCE_IDS_CANNOT_BE_NARROWED')
    scenario('amendment.replan.cannot-drop-coverage',baseline[:baseline.index('[task.3]')],'ACCEPTANCE_COVERAGE_CANNOT_BE_REMOVED')
    scenario('amendment.replan.command-absence-is-intent',baseline.replace('verify_cmd = "printf independent"\n',''),'ACCEPTED_TASK_CHECK_CANNOT_BE_WEAKENED')
    scenario('amendment.replan.invalid-graph-explicit',baseline.replace('requires = ["1"]','requires = ["missing"]'),'DEPENDENCY_UNRESOLVED')
    scenario('amendment.replan.cyclic-graph-explicit',baseline.replace('requires = []\ntouches = ["src/a.ts"]','requires = ["2"]\ntouches = ["src/a.ts"]'),'DEPENDENCY_CYCLE')
    scenario('amendment.replan.relocation-needs-new-identity',baseline.replace('wave = 1','wave = 2'),'TASK_RELOCATION_REQUIRES_NEW_IDENTITY')
    scenario('amendment.intent.explicit-operator-proposal',baseline.replace('An independent executable obligation','Explicit new accepted intent'),purpose='INTENT_CHANGE')
    scenario('amendment.criteria.change-needs-new-identity',baseline.replace('An actual executable obligation','Explicit new accepted intent'),'CRITERIA_CHANGE_REQUIRES_NEW_IDENTITY',purpose='INTENT_CHANGE')
    check('amendment.intent.manager-cannot-change-intent',lambda:refused(f,'spec.amendment.check',request(f,baseline.replace('An actual executable obligation','Explicit new accepted intent'),'INTENT_CHANGE'),'ACTION_DENIED',key='manager'))
    scenario('amendment.analysis.comments-are-not-task-change',baseline+'\n# Preserved raw intent comment\n')
    def invalid_rejected():
        r=success(f,'spec.amendment.propose',request(f,baseline.replace('requires = ["1"]','requires = ["missing"]')))
        expect(r['decision']=='REJECTED' and r['status']=='INVALID','Invalid proposal was left open')
        decision=f.sql("SELECT decision,decision_record FROM hyperfide.spec_amendment_decisions WHERE amendment_id=$1",[r['amendment_id']])
        expect(len(decision)==1 and decision[0]['decision']=='REJECTED' and 'DEPENDENCY_UNRESOLVED' in [d['code'] for d in decision[0]['decision_record']['structural_diagnostics']],'Rejection diagnostics were not durable')
        a=success(f,'spec.amendment.admit',admit(f,r,[]))
        expect(a['decision']=='REJECTED' and a['replayed'] is True and run_row(f)['g']=='2','Invalid plan gained dispatch admission')
    check('amendment.admit.invalid-cannot-dispatch',invalid_rejected)
    stale_intent=success(f,'spec.amendment.propose',request(f,baseline.replace('An independent executable obligation','Explicit new accepted intent'),'INTENT_CHANGE'))
    expect(stale_intent['decision']=='PROPOSED','Operator intent proposal was not recorded')
    check('amendment.admit.manager-cannot-admit',lambda:refused(f,'spec.amendment.admit',admit(f,saved['p3'],[i['task3']]),'ACTION_DENIED',key='manager'))
    def explicit_revalidation():
        before=run_row(f);refused(f,'spec.amendment.admit',admit(f,saved['p3'],[]),'AMENDMENT_REVALIDATION_REQUIRED')
        expect(run_row(f)==before and count(f,'hyperfide.spec_amendment_decisions WHERE decision=$1',['ACCEPTED'])==0,'Refused admission mutated state')
    check('amendment.admit.revalidation-explicit',explicit_revalidation)
    def during_execution():
        saved['a3']=success(f,'spec.amendment.admit',admit(f,saved['p3'],[i['task3']]))
        r=run_row(f);expect(saved['a3']['decision']=='ACCEPTED' and r['g']=='3' and r['state']=='RUNNING' and saved['a3']['accepted']['run_state']=='RUNNING','Admission did not version the running plan')
        t3=task_row(f,'task3');expect(t3['g']=='3' and t3['state']=='PENDING','Revalidated task did not move to the new generation')
        t2=task_row(f,'task2');expect(t2['g']=='2' and t2['state']=='RUNNING' and count(f,"hyperfide.attempts WHERE id=$1 AND compute_authority='CURRENT'",[i['attempt2']])==1,'Unaffected running work was disturbed')
        expect(saved['a3']['unaffected_active_task_ids']==[i['task2']],'Decision did not record continuing active work')
    check('amendment.admit.during-execution',during_execution)
    def versioned():
        expect(f.sql("SELECT array_agg(spec_generation::text ORDER BY spec_generation) g FROM hyperfide.task_revisions WHERE task_id=$1",[i['task3']])[0]['g']==['2','3'],'Task intent history was not versioned')
        expect(count(f,'hyperfide.run_spec_revisions WHERE run_id=$1 AND spec_generation=3 AND spec_revision_id=$2',[run,run_row(f)['s']])==1,'Run generation was not recorded')
        expect(f.sql("SELECT spec_generation::text g FROM hyperfide.proof_registries WHERE task_id=$1 ORDER BY spec_generation",[i['task3']])==[{'g':'2'},{'g':'3'}] and saved['a3']['proof_registries'][0]['source']=='CARRIED_FORWARD','Proof policy was not re-registered for the new generation')
        expect(saved['a3']['actor']['role']=='OPERATOR' and saved['a3']['justification']=='Explicitly revalidated fixture amendment','Decision lost actor or justification')
    check('amendment.admit.versioned-history',versioned)
    check('amendment.evidence.irrelevant-change-retained',lambda:expect(count(f,"hyperfide.evidence WHERE id=$1 AND admission_state='ADMITTED'",[i['evidence']])==1 and task_row(f,'task1')['state']=='INTEGRATED' and saved['a3']['invalidation']['evidence_stale']==0,'Unrelated amendment invalidated accepted evidence'))
    def replay():
        r=success(f,'spec.amendment.admit',admit(f,saved['p3'],[i['task3']]))
        expect(r['replayed'] is True and r['decision_digest']==saved['a3']['decision_digest'] and run_row(f)['g']=='3','Admission replay was not exact')
    check('amendment.admit.exact-replay',replay)
    def stale():
        before=run_row(f);refused(f,'spec.amendment.admit',admit(f,stale_intent,[x['task_id'] for x in stale_intent['impact']['revalidation']]),'AMENDMENT_BASE_STALE')
        expect(run_row(f)==before,'Stale proposal changed accepted state')
    check('amendment.admit.stale-proposal',stale)
    # Later amendments build on the currently accepted generation-3 intent.
    p1=success(f,'spec.amendment.propose',request(f,task3_only.replace('touches = ["src/a.ts"]','touches = ["src/a.ts", "src/a2.ts"]')))
    def active_compute():
        before=run_row(f)
        refused(f,'spec.amendment.admit',admit(f,p1,[i['task1']]),'AMENDMENT_REVALIDATION_REQUIRED')
        refused(f,'spec.amendment.admit',admit(f,p1,[i['task1'],i['task2']]),'AMENDMENT_ACTIVE_COMPUTE')
        expect(run_row(f)==before and task_row(f,'task1')['g']=='2' and count(f,"hyperfide.evidence WHERE id=$1 AND admission_state='ADMITTED'",[i['evidence']])==1,'Refused admission was not atomic')
    check('amendment.admit.active-compute-refused',active_compute)
    # Scheduler-owned fencing (5.2 SPEC_REPLAN) revokes the current attempt; it is not an amendment authority.
    f.sql("UPDATE hyperfide.attempts SET compute_authority='REVOKED',execution_state='FAILED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,i['attempt2']])
    f.sql("UPDATE hyperfide.tasks SET state='STALE',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,i['task2']])
    def revalidate():
        saved['a1']=success(f,'spec.amendment.admit',admit(f,p1,[i['task2'],i['task1']]))
        r=run_row(f);t1=task_row(f,'task1');t2=task_row(f,'task2')
        expect(saved['a1']['decision']=='ACCEPTED' and r['g']=='4' and r['state']=='RUNNING','Fenced amendment was not admitted')
        expect(t1['g']=='4' and t1['state']=='STALE' and t2['g']=='4' and t2['state']=='PENDING' and task_row(f,'task3')['g']=='3','Only explicitly revalidated work may change generation')
    check('amendment.admit.revalidates-affected-only',revalidate)
    def evidence_stale():
        expect(count(f,"hyperfide.evidence WHERE id=$1 AND admission_state='STALE'",[i['evidence']])==1 and saved['a1']['invalidation']['evidence_stale']==1,'Relevant evidence did not become stale')
        expect(count(f,"hyperfide.submission_custodies WHERE id=$1 AND authority='RELEASED' AND qualification_outcome='PASS'",[i['custody']])==1 and saved['a1']['invalidation']['released_custody_retained']==1,'Historical pass or released custody was rewritten')
        history=f.sql("SELECT spec_generation::text g,criteria_digest c,definition->'section'->'fields'->'touches'->'value' t FROM hyperfide.task_revisions WHERE task_id=$1 ORDER BY spec_generation",[i['task1']])
        expect([row['g'] for row in history]==['2','4'] and history[0]['t']==['src/a.ts'] and history[1]['t']==['src/a.ts','src/a2.ts'],'Accepted work lost its original provenance')
        # Reuse rule: unchanged acceptance inputs keep the criteria identity bound by custody history.
        expect(all(row['c']==f.criteria for row in history) and {'task_id':i['task1'],'disposition':'RETAINED'} in saved['a1']['criteria'],'Criteria reuse was not explained')
    check('amendment.evidence.stale-history-retained',evidence_stale)
    def requalify():
        expect(count(f,"hyperfide.attempts WHERE task_id=ANY($1::uuid[]) AND compute_authority='CURRENT'",[[i['task1'],i['task2']]])==0,'Stale workers regained compute authority')
        expect(count(f,"hyperfide.proof_registries WHERE task_id=$1 AND spec_generation=4",[i['task1']])==1,'Requalification policy was not bound to the new generation')
        edge=f.sql("SELECT revision::text r,predecessor_spec_generation::text g FROM hyperfide.task_dependencies WHERE task_id=$1 AND predecessor_task_id=$2 ORDER BY revision",[i['task2'],i['task1']])
        expect(edge==[{'r':'2','g':'2'},{'r':'4','g':'4'}],'Dependency edges were not re-admitted for the new generation: '+str(edge))
    check('amendment.requalification.new-generation-only',requalify)
    def decomposition():
        split=baseline[:baseline.index('[task.3]')]
        for key,path in [('3a','src/c.ts'),('3b','src/c2.ts')]:
            split+='[task.'+key+']\nwave = 1\nfeature = "fixture"\nreqs = ["2.1"]\nverify_cmd = "printf independent"\nartifacts = ["proof.json"]\nacceptance_ids = ["2"]\nrequires = []\ntouches = ["'+path+'"]\n'
        split=split.replace('touches = ["src/a.ts"]','touches = ["src/a.ts", "src/a2.ts"]')
        raw=proof_source(split).encode()
        r=success(f,'spec.amendment.propose',request(f,split))
        expect(r['decision']=='PROPOSED' and r['impact']['retired']==['3'] and sorted(r['impact']['added'])==['3a','3b'],'Decomposition impact was not exact: '+str(r['diagnostics']))
        generation=str(int(run_row(f)['g'])+1)
        spec=f.sql("SELECT a.proposal->>'revision_digest' d FROM hyperfide.spec_amendments a WHERE a.id=$1",[r['amendment_id']])[0]['d']
        criteria=sha(json.dumps({'reqs':['2.1'],'source_digest':sha(raw)},separators=(',',':')).encode())
        refused(f,'spec.amendment.admit',admit(f,r,[i['task3']]),'AMENDMENT_PROOF_REQUIRED')
        spec_revision=derived(org+':'+i['project']+':'+spec)
        proofs=[{'task_key':key,'policy':policy(f,key,criteria,spec_revision,generation,'2.1','2')} for key in ['3a','3b']]
        a=success(f,'spec.amendment.admit',admit(f,r,[i['task3']],proofs))
        expect(a['decision']=='ACCEPTED' and run_row(f)['g']==generation,'Decomposition was not admitted')
        t3=task_row(f,'task3');expect(t3['state']=='CANCELLED' and t3['definition']['retirement']['amendment_id']==r['amendment_id'],'Retired identity lost change provenance')
        added=f.sql("SELECT task_key,state,spec_generation::text g FROM hyperfide.tasks WHERE run_id=$1 AND task_key IN ('3a','3b') ORDER BY task_key",[run])
        expect(added==[{'task_key':'3a','state':'PENDING','g':generation},{'task_key':'3b','state':'PENDING','g':generation}],'Decomposed tasks were not accepted')
        expect(task_row(f,'task1')['g']=='4' and task_row(f,'task2')['g']=='4','Decomposition touched unrelated tasks')
    check('amendment.decomposition.versioned-admission',decomposition)

def derived(value):
    h=list(hashlib.sha256(value.encode()).hexdigest()[:32]);h[12]='8';h[16]=format((int(h[16],16)&3)|8,'x');v=''.join(h)
    return v[:8]+'-'+v[8:12]+'-'+v[12:16]+'-'+v[16:20]+'-'+v[20:]
def components():
    fragments={}
    for path in (ROOT/'services/hyperfide/components').glob('*.json'):
        value=json.loads(path.read_text())
        if 'id' in value:fragments[value['id']]=(path.stem,value)
    selected=set()
    def include(key):
        if key in selected:return
        selected.add(key)
        for dependency in fragments[key][1]['requires']:include(dependency)
    include('spec-revisions')
    return tuple(fragments[key][0] for key in sorted(selected))
def main():
    root=artifact_root();(root/'proofs').mkdir(exist_ok=True);(root/'storage').mkdir(exist_ok=True)
    database='hf_identity_'+uuid.uuid4().hex;DATABASES.append(database)
    (root/'storage/database-names.json').write_text(json.dumps({'databases':DATABASES}))
    f=None
    try:
        f=IdentityFixture(extra_components=components(),extra_setup=setup,database=database)
        probe(f)
    finally:
        if f:f.close()
        (root/'proofs/observations.json').write_text(json.dumps({'scope':'task-component','actual_https':True,'assertion_ids':OBS,'failed_ids':FAILED})+'\n')
    return 1 if FAILED else 0
def cleanup():
    from identity_fixture import SQL_JS
    root=artifact_root();p=root/'storage/database-names.json'
    if not p.exists():raise RuntimeError('Owned fixture database descriptor is missing')
    names=json.loads(p.read_text())['databases']
    if not names or any(not re.fullmatch('hf_identity_[0-9a-f]{32}',name) for name in names):raise RuntimeError('Invalid owned fixture database inventory')
    for name in names:
        subprocess.run(['node','--input-type=commonjs','-e',SQL_JS],input=json.dumps({'sql':'DROP DATABASE IF EXISTS "'+name+'" WITH(FORCE)','values':[]}),text=True,cwd=ROOT,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    result=subprocess.run(['node','--input-type=commonjs','-e',SQL_JS],input=json.dumps({'sql':'SELECT count(*)::int n FROM pg_database WHERE datname=ANY($1::text[])','values':[names]}),text=True,cwd=ROOT,capture_output=True,timeout=15)
    absent=result.returncode==0 and json.loads(result.stdout)==[{'n':0}]
    (root/'storage/database-absence.json').write_text(json.dumps({'databases':names,'observed_absent':absent})+'\n')
    print(json.dumps({'type':'cleanup','complete':absent,'resources':[{'id':RESOURCE,'status':'deleted' if absent else 'unknown','observed_absent':absent,'evidence_artifact':'storage/database-absence.json'}]}),flush=True)
    return 0 if absent else 1
if __name__=='__main__':sys.exit(cleanup() if '--cleanup' in sys.argv else main())
