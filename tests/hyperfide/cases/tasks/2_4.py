#!/usr/bin/env python3
import copy,hashlib,importlib.util,json,os,subprocess,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,sha,canonical
SOURCE='''[meta]
slug = "fixture"
[req.1]
ac_1 = "An actual executable obligation"
ac_2 = "Second exact criterion"
[acceptance.1]
req = "1.1"
[acceptance.2]
req = "2.1"
[req.1.extra]
ac_1 = "Unused namespace"
[acceptance.3]
notes = "No clause association"
[acceptance.4]
req = "1.2"
[task.1]
wave = 1
reqs = ["1.1"]
acceptance_ids = ["1"]
requires = []
touches = ["src/a.ts"]
[task.2]
wave = 2
reqs = ["1.1"]
acceptance_ids = ["1"]
requires = ["1"]
touches = ["src/b.ts"]
[task.3]
wave = 2
reqs = ["1.1"]
acceptance_ids = ["3"]
[task.4]
wave = 2
reqs = ["1.1"]
acceptance_ids = ["absent"]
[task.5]
wave = 2
reqs = ["1.1", "1.2"]
acceptance_ids = ["1", "4"]
'''
OBS=[]
FAILED=[]
def expect(condition,message):
    if not condition:raise AssertionError(message)
def check(ident,callback):
    OBS.append(ident)
    try:callback();actual='observed'
    except Exception as error:actual=type(error).__name__+': '+str(error);FAILED.append(ident)
    print(json.dumps({'type':'assertion','id':ident,'expected':'observed','actual':actual}),flush=True)
def artifact_root():
    path=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/task-2.4-auth-standalone'));path.mkdir(parents=True,exist_ok=True);return path
def setup(f):
    for version,name in [(2,'0002-spec')]:
        raw=(ROOT/('services/hyperfide/migrations/'+name+'.sql')).read_bytes()
        f.sql("BEGIN;\n"+raw.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES("+str(version)+",'"+name+"','"+sha(raw)+"');COMMIT;")
    f.ids.update({key:str(uuid.uuid4()) for key in ['repository','accepted_spec','package','package2','task1','task2','task3','task4','task5']})
    i=f.ids
    parsed=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=SOURCE.encode(),cwd=ROOT))
    intent={'schema_version':1,'revision_digest':sha(b'accepted-envelope'),'source_digest':sha(SOURCE.encode()),'repositories':[{'repository_id':i['repository'],'source_object_id':'a'*40,'integration_ref':'refs/heads/main'}],'allowed_actions':f.actions,'closure_policy':{'required_evidence':['actual-check'],'required_review_roles':[],'publication':'AFTER_QUALIFICATION'},'provenance':None,'parsed':parsed,'runtime_wave_offset':0}
    f.sql("INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url,object_format) VALUES($1,$2,$3,'fixture','https://example.invalid/fixture.git','sha1')",[i['organisation'],i['project'],i['repository']])
    f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,'commit')",[i['organisation'],i['repository'],'a'*40])
    f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[i['organisation'],i['project'],i['accepted_spec'],sha(SOURCE.encode()),SOURCE,json.dumps(intent),intent['revision_digest']])
    f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)",[i['organisation'],i['run'],i['accepted_spec']])
    f.sql("UPDATE hyperfide.runs SET spec_generation=2,spec_revision_id=$3,state='PENDING_VALIDATION',state_version=2 WHERE organisation_id=$1 AND id=$2",[i['organisation'],i['run'],i['accepted_spec']])
    f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[i['organisation'],i['run'],i['repository'],'a'*40])
    f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'feature:fixture:wave:1',1)",[i['organisation'],i['run'],i['package']])
    f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'feature:fixture:wave:2',2)",[i['organisation'],i['run'],i['package2']])
    f.criteria=sha(canonical({'reqs':['1.1'],'accepted_text':'An actual executable obligation'}))
    for section in [section for section in parsed['sections'] if section['name'].startswith('task.')]:
        number=section['name'][5:]
        i.setdefault('task'+str(number),str(uuid.uuid4()))
        definition={'schema_version':1,'section':section,'feature_key':'fixture','declared_wave':section['fields']['wave']['value'],'runtime_wave_offset':0,'declared_status':None,'history_only':True}
        f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave,state) VALUES($1,$2,$3,$4,$5,$6,2,$7,$8,$9,'PENDING')",[i['organisation'],i['run'],i['task'+str(number)],str(number),i['package'] if section['fields']['wave']['value']==1 else i['package2'],i['accepted_spec'],f.criteria,json.dumps(definition),section['fields']['wave']['value']])
    f.env.update({'HF_SPEC_ALLOWED_ROOT':str(f.path),'HF_SPEC_ORGANISATION_ID':i['organisation'],'HF_SPEC_PROJECT_ID':i['project'],'HF_AUTHORITY_EPOCH':i['epoch'],'HF_PROOF_MAX_CHECK_MS':'1800000'})

def proof_input(f,task='task1'):
    i=f.ids;executable=str(Path(sys.executable).resolve())
    policy={'schema_version':1,'criteria_digest':f.criteria,'spec_revision_id':i['accepted_spec'],'spec_generation':'2','repository_id':i['repository'],'source_object_id':'a'*40,'rubric_digest':sha(b'rubric'),'checks':[{'id':'actual-check','argv':[executable,'-c','raise SystemExit(1)',''],'executable_digest':sha(Path(executable).read_bytes()),'timeout_ms':600000,'required_artifacts':['proof.json'],'input_keys':['source']}],'clauses':[{'id':'1.1','mode':'EXECUTABLE','acceptance_ids':['1'],'checks':['actual-check']}],'inputs':{key:sha(key.encode()) for key in ['source','dependency','toolchain','configuration','graph','contract']},'contract_digests':[]}
    return {'run_id':i['run'],'task_id':i[task],'spec_revision_id':i['accepted_spec'],'spec_generation':'2','state_version':'2','policy':policy}
def invoke(f,action,payload,key='operator'):
    status,result=f.invoke(action,payload,component='spec-obligations',key=key)
    return status,result
def success(f,action,payload):
    status,result=invoke(f,action,payload)
    expect(status==200 and result.get('ok') is True,'Real HTTPS action did not succeed: '+str(result.get('error',{}).get('code')))
    return result['result']
def refused(f,action,payload,code):
    status,result=invoke(f,action,payload)
    expect(status==200 and result.get('ok') is False and result.get('error',{}).get('code')==code,'Real HTTPS action did not return expected '+code)
def inspection(value):return {key:value[key] for key in ['run_id','task_id','spec_revision_id','spec_generation']}
def probe(f):
    value=proof_input(f);saved={}
    check('proof.missing-registry',lambda:refused(f,'spec.proof.inspect',inspection(value),'PROOF_REGISTRY_MISSING'))
    def register():
        saved.update(success(f,'spec.proof.register',value))
        expected=sha(json.dumps(value['policy'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
        expect(saved['registry_digest']==expected,'Immutable registry digest mismatch')
    check('proof.register.actual',register)
    check('proof.register.exact-clauses',lambda:expect(saved['obligations']==[{'clause_id':'1.1','acceptance_ids':['1'],'required_checks':['actual-check']}],'Accepted clause inventory mismatch'))
    def restart():
        f.stop();f.start()
        expect(success(f,'spec.proof.inspect',inspection(value))['registry_digest']==saved['registry_digest'],'Registry was lost on service restart')
    check('proof.storage.restart',restart)
    check('proof.register.replay',lambda:expect(success(f,'spec.proof.register',value)['registry_digest']==saved['registry_digest'],'Replay changed registry'))
    conflict=copy.deepcopy(value);conflict['policy']['rubric_digest']=sha(b'changed')
    check('proof.register.immutable-conflict',lambda:refused(f,'spec.proof.register',conflict,'PROOF_REGISTRY_CONFLICT'))
    mutations=[
      ('empty-clauses',lambda p:p.update(clauses=[])),
      ('whole-requirement',lambda p:p['clauses'][0].update(id='1')),
      ('unknown-clause',lambda p:p['clauses'][0].update(id='1.99')),
      ('unknown-scenario',lambda p:p['clauses'][0].update(acceptance_ids=['absent'])),
      ('empty-acceptance',lambda p:p['clauses'][0].update(acceptance_ids=[])),
      ('declaration-check',lambda p:p['clauses'][0].update(checks=['verify_cmd'])),
      ('empty-checks',lambda p:p.update(checks=[])),
      ('unmapped-check',lambda p:p['checks'].append(dict(p['checks'][0],id='unused'))),
      ('duplicate-check',lambda p:p['checks'].append(copy.deepcopy(p['checks'][0]))),
      ('duplicate-clause',lambda p:p['clauses'].append(copy.deepcopy(p['clauses'][0]))),
      ('relative-executable',lambda p:p['checks'][0].update(argv=['python3','--version'])),
      ('missing-executable-pin',lambda p:p['checks'][0].update(executable_digest='unidentified')),
      ('zero-timeout',lambda p:p['checks'][0].update(timeout_ms=0)),
      ('long-timeout',lambda p:p['checks'][0].update(timeout_ms=259200001)),
      ('over-operating-budget',lambda p:p['checks'][0].update(timeout_ms=1800001)),
      ('boolean-timeout',lambda p:p['checks'][0].update(timeout_ms=True)),
      ('artifact-traversal',lambda p:p['checks'][0].update(required_artifacts=['../secret'])),
      ('artifact-absolute',lambda p:p['checks'][0].update(required_artifacts=['/tmp/out'])),
      ('empty-artifacts',lambda p:p['checks'][0].update(required_artifacts=[])),
      ('unknown-input-key',lambda p:p['checks'][0].update(input_keys=['unknown'])),
      ('empty-input-keys',lambda p:p['checks'][0].update(input_keys=[])),
      ('missing-input',lambda p:p['inputs'].pop('graph')),
      ('unidentified-input',lambda p:p['inputs'].update(graph='unknown')),
      ('unknown-policy-key',lambda p:p.update(status='done')),
      ('unknown-mode',lambda p:p['clauses'][0].update(mode='DECLARED_DONE')),
    ]
    for name,mutation in mutations:
        candidate=copy.deepcopy(value);mutation(candidate['policy'])
        check('proof.reject.'+name,lambda candidate=candidate:refused(f,'spec.proof.register',candidate,'PROOF_MAPPING_INVALID'))
    for name,mutation in [
      ('criteria',lambda p:p['policy'].update(criteria_digest=sha(b'other'))),
      ('source',lambda p:p['policy'].update(source_object_id='b'*40)),
      ('repository',lambda p:p['policy'].update(repository_id=str(uuid.uuid4()))),
      ('state-version',lambda p:p.update(state_version='1')),
      ('numeric-generation',lambda p:p.update(spec_generation=2)),
      ('run',lambda p:p.update(run_id=str(uuid.uuid4()))),
    ]:
        candidate=copy.deepcopy(value);mutation(candidate)
        check('proof.pin.'+name,lambda candidate=candidate:refused(f,'spec.proof.register',candidate,'PROOF_REGISTRY_MISMATCH'))
    stale=inspection(value);stale['spec_generation']='1'
    check('proof.inspect.stale-generation',lambda:refused(f,'spec.proof.inspect',stale,'PROOF_REGISTRY_MISSING'))
    check('proof.check.long-and-empty-arg',lambda:expect(saved['policy']['checks'][0]['timeout_ms']==600000 and saved['policy']['checks'][0]['argv'][-1]=='','Long check/empty argument was not preserved'))
    missing=proof_input(f,'task4');missing['policy']['clauses'][0]['acceptance_ids']=['absent']
    check('proof.reject.nonexistent-declared-case',lambda:refused(f,'spec.proof.register',missing,'PROOF_MAPPING_INVALID'))
    unassociated=proof_input(f,'task3');unassociated['policy']['clauses'][0]['acceptance_ids']=['3']
    check('proof.reject.unassociated-declared-case',lambda:refused(f,'spec.proof.register',unassociated,'PROOF_MAPPING_INVALID'))
    substituted=proof_input(f,'task5')
    substituted['policy']['clauses']=[{'id':'1.1','mode':'EXECUTABLE','acceptance_ids':['4'],'checks':['actual-check']},{'id':'1.2','mode':'EXECUTABLE','acceptance_ids':['1'],'checks':['actual-check']}]
    check('proof.reject.substituted-clause-cases',lambda:refused(f,'spec.proof.register',substituted,'PROOF_MAPPING_INVALID'))
    for operation in ["UPDATE hyperfide.proof_registries SET policy=jsonb_set(policy,'{rubric_digest}',to_jsonb(('sha256:'||repeat('f',64))::text))",'DELETE FROM hyperfide.proof_registries']:
        def immutable(operation=operation):
            rejected=False
            try:f.sql(operation)
            except AssertionError:rejected=True
            expect(rejected,'Accepted proof registry mutation succeeded')
        check('proof.storage.immutable-'+('update' if operation.startswith('UPDATE') else 'delete'),immutable)
    review=proof_input(f,'task2');review['policy']['checks']=[]
    review['policy']['clauses']=[{'id':'1.1','mode':'REVIEW','acceptance_ids':['1'],'reviewers':[f.ids['operator']],'rubric_digest':sha(b'review-rubric')}]
    check('proof.review.explicit-permission',lambda:refused(f,'spec.proof.register',review,'ACTION_DENIED'))
    check('proof.review.actual-registration',lambda:expect('review_rubric' in success(f,'spec.proof.review.register',review)['obligations'][0],'Review rubric absent'))
    for name,mutation in [
      ('empty-reviewers',lambda p:p['clauses'][0].update(reviewers=[])),
      ('non-identity-reviewer',lambda p:p['clauses'][0].update(reviewers=['reviewer'])),
      ('unknown-rubric',lambda p:p['clauses'][0].update(rubric_digest='unknown')),
    ]:
        candidate=copy.deepcopy(review);mutation(candidate['policy'])
        check('proof.review.'+name,lambda candidate=candidate:refused(f,'spec.proof.review.register',candidate,'PROOF_MAPPING_INVALID'))
    def existing_tx():
        script="import{createRequire}from'node:module';const pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg');import{loadProofObligations}from'./services/hyperfide/dist/spec/obligations.js';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await c.query('BEGIN');const r=await loadProofObligations(c,JSON.parse(process.env.HF_PROOF_PINS));if(r.registry_digest!==process.env.HF_PROOF_EXPECTED)throw Error('mismatch');await c.query('ROLLBACK');}finally{await c.end();}"
        env=f.env.copy();env.update(HF_PROOF_PINS=json.dumps(dict(inspection(value),organisation_id=f.ids['organisation'])),HF_PROOF_EXPECTED=saved['registry_digest'])
        result=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
        expect(result.returncode==0,'Existing primary transaction loader failed')
    check('proof.api.existing-primary-transaction',existing_tx)
    def concurrent():
        from concurrent.futures import ThreadPoolExecutor
        left=proof_input(f,'task5');left['policy']['clauses'].append({'id':'1.2','mode':'EXECUTABLE','acceptance_ids':['4'],'checks':['actual-check']})
        right=copy.deepcopy(left);right['policy']['rubric_digest']=sha(b'other-concurrent')
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda p:invoke(f,'spec.proof.register',p),[left,right]))
        expect(sum(status==200 and result.get('ok') is True for status,result in responses)==1,'Concurrent policies did not produce exactly one winner')
        expect(any(result.get('error',{}).get('code')=='PROOF_REGISTRY_CONFLICT' for _,result in responses),'Concurrent loser did not observe immutable conflict')
    check('proof.register.concurrent-conflict',concurrent)
    def crossrun():
        i=f.ids;other=str(uuid.uuid4())
        f.sql("INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch,state) VALUES($1,$2,$3,$4,$5,$6,'PENDING_VALIDATION')",[i['organisation'],other,i['project'],i['accepted_spec'],sha(b'other-policy'),i['epoch']])
        candidate=copy.deepcopy(value);candidate['run_id']=other
        refused(f,'spec.proof.register',candidate,'PROOF_REGISTRY_MISMATCH')
        expect(f.sql("SELECT count(*)::int n FROM hyperfide.proof_registries WHERE run_id=$1",[other])[0]['n']==0,'Cross-run request mutated other run')
    check('proof.auth.existing-cross-run',crossrun)
    def role():
        status,result=invoke(f,'spec.proof.register',value,key='provisioner')
        expect(status==200 and result.get('ok') is False and result.get('error',{}).get('code')=='ACTION_DENIED','Provisioner registered proof authority')
    check('proof.auth.role-refused',role)
    def revoked():
        before=f.sql("SELECT count(*)::int n FROM hyperfide.proof_registries")[0]['n']
        f.sql("UPDATE hyperfide.identity_principals SET state='REVOKED' WHERE credential_id=$1",[f.ids['operator']])
        status,result=invoke(f,'spec.proof.register',value)
        expect(status in [401,403] or result.get('ok') is False,'Revoked credential was accepted')
        expect(f.sql("SELECT count(*)::int n FROM hyperfide.proof_registries")[0]['n']==before,'Revoked request mutated registry')
    check('proof.auth.revoked-refused',revoked)
    check('proof.registration-is-not-evidence',lambda:expect(f.sql("SELECT (SELECT count(*) FROM hyperfide.evidence)+(SELECT count(*) FROM hyperfide.attempts)+(SELECT count(*) FROM hyperfide.submission_custodies) AS n")[0]['n']=='0','Proof mapping created qualification evidence'))
def main():
    f=IdentityFixture(extra_components=('2.1','2.4'),extra_setup=setup)
    root=artifact_root();(root/'storage').mkdir(exist_ok=True);(root/'proofs').mkdir(exist_ok=True)
    (root/'storage/database-name.json').write_text(json.dumps({'database':f.database}))
    try:probe(f)
    finally:
        database=f.database;base=f.base_url
        f.close()
        env=os.environ.copy();env['DATABASE_URL']=base
        sql="SELECT count(*)::int n FROM pg_database WHERE datname=$1"
        from identity_fixture import SQL_JS
        result=subprocess.run(['node','--input-type=commonjs','-e',SQL_JS],input=json.dumps({'sql':sql,'values':[database]}),text=True,env=env,cwd=ROOT,capture_output=True,timeout=15)
        absent=result.returncode==0 and json.loads(result.stdout)==[{'n':0}]
        (root/'storage/database-absence.json').write_text(json.dumps({'database':database,'observed_absent':absent})+'\n')
        if not absent:FAILED.append('proof.cleanup.absence')
        (root/'proofs/observations.json').write_text(json.dumps({'scope':'task-component','actual_https':True,'assertion_ids':OBS,'failed_ids':FAILED})+'\n')
    return 1 if FAILED else 0
if __name__=='__main__':
    if '--cleanup' in sys.argv:
        root=artifact_root();p=root/'storage/database-name.json'
        if p.exists():
            from identity_fixture import SQL_JS
            name=json.loads(p.read_text())['database']
            import re
            if not re.fullmatch('hf_identity_[0-9a-f]{32}',name):raise RuntimeError('Invalid owned fixture database')
            subprocess.run(['node','--input-type=commonjs','-e',SQL_JS],input=json.dumps({'sql':'DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)','values':[]}),text=True,cwd=ROOT,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        else:raise RuntimeError('Owned fixture database descriptor is missing')
        result=subprocess.run(['node','--input-type=commonjs','-e',SQL_JS],input=json.dumps({'sql':'SELECT count(*)::int n FROM pg_database WHERE datname=$1','values':[name]}),text=True,cwd=ROOT,capture_output=True,timeout=15)
        absent=result.returncode==0 and json.loads(result.stdout)==[{'n':0}]
        (root/'storage/database-absence.json').write_text(json.dumps({'database':name,'observed_absent':absent})+'\n')
        print(json.dumps({'type':'cleanup','complete':absent,'resources':[{'id':'hf-task-2.4-database','status':'deleted' if absent else 'unknown','observed_absent':absent,'evidence_artifact':'storage/database-absence.json'}]}),flush=True)
        sys.exit(0 if absent else 1)
    sys.exit(main())
