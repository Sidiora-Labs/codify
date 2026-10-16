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
[acceptance.1]
req = "1.1"
checks = ["actual-check"]
[acceptance.2]
req = "2.1"
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
RESOURCE='hf-task-2.2-database'
def artifact_root():
    path=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/task-2.2-auth-standalone'));path.mkdir(parents=True,exist_ok=True);return path
def setup(f):
    for version,name in [(2,'0002-spec'),(202,'0202-spec-dependencies')]:
        raw=(ROOT/('services/hyperfide/migrations/'+name+'.sql')).read_bytes()
        f.sql("BEGIN;\n"+raw.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES("+str(version)+",'"+name+"','"+sha(raw)+"');COMMIT;")
    f.ids.update({key:f.ids.get(key,str(uuid.uuid4())) for key in ['repository','accepted_spec','package','package2','task1','task2','task3','task4','task5']})
    i=f.ids
    executable=str(Path(sys.executable).resolve())
    source=SOURCE+'\n[proof]\nrubric_digest = '+json.dumps(sha(b'rubric'))+'\n[proof.check.actual-check]\n'+''.join(key+' = '+json.dumps(value)+'\n' for key,value in {'argv':[executable,'-c','raise SystemExit(1)',''],'executable_digest':sha(Path(executable).read_bytes()),'timeout_ms':600000,'required_artifacts':['proof.json'],'input_keys':['source']}.items())
    parsed=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT))
    intent={'schema_version':1,'revision_digest':sha(b'accepted-envelope'),'source_digest':sha(source.encode()),'repositories':[{'repository_id':i['repository'],'source_object_id':'a'*40,'integration_ref':'refs/heads/main'}],'allowed_actions':f.actions,'closure_policy':{'required_evidence':['actual-check'],'required_review_roles':[],'publication':'AFTER_QUALIFICATION'},'provenance':None,'parsed':parsed,'runtime_wave_offset':0}
    f.sql("INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url,object_format) VALUES($1,$2,$3,'fixture','https://example.invalid/fixture.git','sha1')",[i['organisation'],i['project'],i['repository']])
    f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,'commit')",[i['organisation'],i['repository'],'a'*40])
    f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[i['organisation'],i['project'],i['accepted_spec'],sha(source.encode()),source,json.dumps(intent),intent['revision_digest']])
    f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,2,$3)",[i['organisation'],i['run'],i['accepted_spec']])
    f.sql("UPDATE hyperfide.runs SET spec_generation=2,spec_revision_id=$3,state='PENDING_VALIDATION',state_version=2 WHERE organisation_id=$1 AND id=$2",[i['organisation'],i['run'],i['accepted_spec']])
    f.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[i['organisation'],i['run'],i['repository'],'a'*40])
    f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'feature:fixture:wave:1',1)",[i['organisation'],i['run'],i['package']])
    f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'feature:fixture:wave:2',2)",[i['organisation'],i['run'],i['package2']])
    f.criteria=sha(canonical({'reqs':['1.1'],'accepted_text':'An actual executable obligation'}))
    rows=[];packages={('fixture',1):i['package'],('fixture',2):i['package2']}
    for section in [section for section in parsed['sections'] if section['name'].startswith('task.')]:
        number=section['name'][5:]
        i.setdefault('task'+str(number),str(uuid.uuid4()))
        definition={'schema_version':1,'section':section,'feature_key':section['fields'].get('feature',{}).get('value','fixture'),'declared_wave':section['fields']['wave']['value'],'runtime_wave_offset':0,'declared_status':None,'history_only':True}
        raw_wave=section['fields']['wave']['value'];wave=raw_wave if type(raw_wave) is int and raw_wave>=1 else 1
        namespace=definition['feature_key'];package_key=(namespace,wave)
        if package_key not in packages:
            packages[package_key]=str(uuid.uuid4())
            f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,$4,$5)",[i['organisation'],i['run'],packages[package_key],'feature:'+str(namespace)+':wave:'+str(raw_wave),wave])
        rows.append({'id':i['task'+str(number)],'task_key':str(number),'feature_package_id':packages[package_key],'definition':definition,'wave':wave})
    f.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave,state) SELECT $1,$2,x.id,x.task_key,x.feature_package_id,$3,2,$4,x.definition,x.wave,'PENDING' FROM jsonb_to_recordset($5::jsonb) AS x(id uuid,task_key text,feature_package_id uuid,definition jsonb,wave integer)",[i['organisation'],i['run'],i['accepted_spec'],f.criteria,json.dumps(rows)])
    f.env.update({'HF_SPEC_ALLOWED_ROOT':str(f.path),'HF_SPEC_ORGANISATION_ID':i['organisation'],'HF_SPEC_PROJECT_ID':i['project'],'HF_AUTHORITY_EPOCH':i['epoch'],'HF_PROOF_MAX_CHECK_MS':'1800000'})

def proof_input(f,task='task1'):
    i=f.ids;executable=str(Path(sys.executable).resolve())
    policy={'schema_version':1,'criteria_digest':f.criteria,'spec_revision_id':i['accepted_spec'],'spec_generation':'2','repository_id':i['repository'],'source_object_id':'a'*40,'rubric_digest':sha(b'rubric'),'checks':[{'id':'actual-check','argv':[executable,'-c','raise SystemExit(1)',''],'executable_digest':sha(Path(executable).read_bytes()),'timeout_ms':600000,'required_artifacts':['proof.json'],'input_keys':['source']}],'clauses':[{'id':'1.1','mode':'EXECUTABLE','acceptance_ids':['1'],'checks':['actual-check']}],'inputs':{key:sha(key.encode()) for key in ['source','dependency','toolchain','configuration','graph','contract']},'contract_digests':[]}
    return {'run_id':i['run'],'task_id':i[task],'spec_revision_id':i['accepted_spec'],'spec_generation':'2','state_version':'2','policy':policy}

DATABASES=[]
def request(f,action,payload):
    status,result=f.invoke(action,payload,component='spec-dependencies')
    expect(status==200,'Actual spec HTTPS dispatch failed')
    return result
def success(f,action,payload):
    result=request(f,action,payload)
    expect(result.get('ok') is True,'Spec action failed: '+str(result.get('error',{}).get('code')))
    return result['result']
def refused(f,action,payload,code):
    result=request(f,action,payload)
    expect(result.get('ok') is False and result.get('error',{}).get('code')==code,'Expected refusal '+code)
def pins(f):return {'run_id':f.ids['run'],'spec_revision_id':f.ids['accepted_spec'],'spec_generation':'2','state_version':'2'}
def current_state(f):return f.sql("SELECT state,spec_generation::text,state_version::text FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",[f.ids['organisation'],f.ids['run']])[0]
def run_fixture(source,callback,missing_schema=False):
    global SOURCE
    SOURCE=source
    def prepare(f):
        global SOURCE
        for key in ['repository','accepted_spec']:f.ids[key]=str(uuid.uuid4())
        SOURCE=SOURCE.replace('__ORG__',f.ids['organisation']).replace('__RUN__',f.ids['run']).replace('__REPO__',f.ids['repository']).replace('__SPEC__',f.ids['accepted_spec'])
        setup(f)
        if missing_schema:
            # Omit the migration in this fixture rather than mutating its immutable record.
            pass
    f=IdentityFixture(extra_components=('2.1','2.4','2.2'),extra_setup=prepare)
    DATABASES.append(f.database)
    root=artifact_root();(root/'storage').mkdir(exist_ok=True)
    (root/'storage/database-names.json').write_text(json.dumps({'databases':DATABASES}))
    try:callback(f)
    finally:f.close()
def advance_run_snapshot(f):
    current=f.sql("SELECT r.spec_generation::text,r.state_version::text,s.source_content,s.document FROM hyperfide.runs r JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id WHERE r.organisation_id=$1 AND r.id=$2",[f.ids['organisation'],f.ids['run']])[0]
    source=current['source_content']+'\n# An unrelated accepted run revision\n'
    document=copy.deepcopy(current['document']);document['source_digest']=sha(source.encode())
    document['parsed']=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT))
    accepted={key:document[key] for key in ['schema_version','source_digest','repositories','allowed_actions','closure_policy','provenance']}
    document['revision_digest']=sha(json.dumps(accepted,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
    spec=str(uuid.uuid4());generation=str(int(current['spec_generation'])+1)
    f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[f.ids['organisation'],f.ids['project'],spec,document['source_digest'],source,json.dumps(document),document['revision_digest']])
    f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$3,$4)",[f.ids['organisation'],f.ids['run'],generation,spec])
    f.sql("UPDATE hyperfide.runs SET spec_generation=$3,spec_revision_id=$4,state='PENDING_VALIDATION',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[f.ids['organisation'],f.ids['run'],generation,spec])
    return {'run_id':f.ids['run'],'spec_revision_id':spec,'spec_generation':generation,'state_version':str(int(current['state_version'])+1)}

def positive(f):
    p=pins(f);run=f.ids['run'];saved={}
    def check_graph():
        saved.update(success(f,'spec.dependencies.check',p))
        expect(saved['status']=='STRUCTURALLY_VALID' and saved['task_count']==2 and saved['edge_count']==1,'Actual two-task graph changed')
    check('dependencies.valid.actual-service',check_graph)
    check('dependencies.check.readonly',lambda:expect(current_state(f)['state']=='PENDING_VALIDATION' and not f.sql('SELECT 1 FROM hyperfide.task_dependencies'),'Check mutated admission state'))
    check('dependencies.resolve.exact-logical-key',lambda:expect(success(f,'spec.task.resolve',{'run_id':run,'task_key':'2'})['task_id']==f.ids['task2'],'Logical key did not resolve actual UUID'))
    check('dependencies.resolve.unknown',lambda:refused(f,'spec.task.resolve',{'run_id':run,'task_key':'absent'},'SPEC_TASK_NOT_FOUND'))
    check('dependencies.resolve.strict-type',lambda:refused(f,'spec.task.resolve',{'run_id':run,'task_key':2},'SPEC_INPUT_INVALID'))
    check('dependencies.resolve.scope',lambda:refused(f,'spec.task.resolve',{'run_id':str(uuid.uuid4()),'task_key':'1'},'SPEC_SCOPE_MISMATCH'))
    def frontier():
        result=success(f,'spec.next',{'run_id':run,'limit':1})
        expect(result['authority']=='CANDIDATE_DISCOVERY' and result['operational_eligibility']=='UNASSESSED' and [row['task_id'] for row in result['candidates']]==[f.ids['task1']],'Frontier confused structure with operational authority')
    check('dependencies.frontier.discovery-only',frontier)
    check('dependencies.frontier.strict-limit',lambda:refused(f,'spec.next',{'run_id':run,'limit':True},'SPEC_INPUT_INVALID'))
    check('dependencies.input.unknown-key',lambda:refused(f,'spec.dependencies.check',dict(p,override=True),'SPEC_INPUT_INVALID'))
    check('dependencies.input.numeric-generation',lambda:refused(f,'spec.dependencies.check',dict(p,spec_generation=2),'SPEC_INPUT_INVALID'))
    check('dependencies.pin.stale-generation',lambda:refused(f,'spec.dependencies.check',dict(p,spec_generation='1'),'SPEC_PLAN_STALE'))
    check('dependencies.pin.stale-state',lambda:refused(f,'spec.dependencies.check',dict(p,state_version='1'),'SPEC_PLAN_STALE'))
    check('dependencies.admit.requires-proof',lambda:refused(f,'spec.dependencies.admit',p,'PROOF_REGISTRY_MISSING'))
    check('dependencies.admit.no-partial-edges',lambda:expect(not f.sql('SELECT 1 FROM hyperfide.task_dependencies') and current_state(f)['state']=='PENDING_VALIDATION','Missing proof partially admitted graph'))
    def registry():
        for task in ['task1','task2']:
            status,result=f.invoke('spec.proof.register',proof_input(f,task),component='spec-obligations')
            expect(status==200 and result.get('ok') is True,'Actual proof policy prerequisite did not register')
    check('dependencies.proof.actual-registries',registry)
    def late_failure():
        f.sql("CREATE FUNCTION hyperfide.inject_admission_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected late admission failure'; END $$;CREATE TRIGGER zzz_injected BEFORE UPDATE ON hyperfide.runs FOR EACH ROW WHEN(NEW.state='READY') EXECUTE FUNCTION hyperfide.inject_admission_failure();")
        try:
            result=request(f,'spec.dependencies.admit',p)
            expect(result.get('ok') is False,'Injected late transaction failure was ignored')
            expect(not f.sql('SELECT 1 FROM hyperfide.task_dependencies') and current_state(f)['state']=='PENDING_VALIDATION','Late failure left partial dependency writes')
        finally:f.sql("DROP TRIGGER zzz_injected ON hyperfide.runs;DROP FUNCTION hyperfide.inject_admission_failure();")
    check('dependencies.transaction.late-failure-rollback',late_failure)
    def admit():
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:request(f,'spec.dependencies.admit',p),range(2)))
        accepted=[r['result'] for r in responses if r.get('ok') is True]
        expect(len(accepted)==1 and any(r.get('error',{}).get('code')=='SPEC_PLAN_STALE' for r in responses),'Concurrent admission did not enforce one exact CAS winner')
        result=accepted[0]
        expect(result['admitted'] is True and result['state_version']=='3' and current_state(f)['state']=='READY','Atomic admission did not advance exact run generation')
    check('dependencies.admit.atomic-ready',admit)
    check('dependencies.admit.concurrent-cas',lambda:expect(current_state(f)['state_version']=='3','Concurrent admission advanced state more than once'))
    def exact_edge():
        rows=f.sql("SELECT predecessor_task_id,predecessor_spec_generation::text,predecessor_spec_revision_id,binding_schema_version,revision::text,milestone FROM hyperfide.task_dependencies")
        expect(rows==[{'predecessor_task_id':f.ids['task1'],'predecessor_spec_generation':'2','predecessor_spec_revision_id':f.ids['accepted_spec'],'binding_schema_version':1,'revision':'2','milestone':'QUALIFIED'}],'Resolved edge lost exact accepted predecessor identity')
    check('dependencies.storage.exact-pins',exact_edge)
    check('dependencies.admit.stale-replay',lambda:refused(f,'spec.dependencies.admit',p,'SPEC_PLAN_STALE'))
    check('dependencies.admit.wrong-state',lambda:refused(f,'spec.dependencies.admit',dict(p,state_version='3'),'SPEC_ADMISSION_STATE'))
    def immutable():
        rejected=False
        try:f.sql("UPDATE hyperfide.task_dependencies SET integration_ref='refs/heads/changed'")
        except AssertionError:rejected=True
        expect(rejected,'Accepted predecessor binding was rewritten')
    check('dependencies.storage.immutable-binding',immutable)
    def isolation():
        rejected=False
        try:f.sql("BEGIN ISOLATION LEVEL REPEATABLE READ;INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision) VALUES('"+f.ids['organisation']+"','"+run+"','"+f.ids['task1']+"','"+run+"','"+f.ids['task2']+"','QUALIFIED',2);COMMIT;")
        except AssertionError as error:rejected='25001' in str(error)
        expect(rejected,'Repeatable-read writer was not rejected')
    check('dependencies.storage.repeatable-read-refused',isolation)
    def restart():
        f.stop();f.start()
        result=success(f,'spec.task.resolve',{'run_id':run,'task_key':'2'})
        expect(result['spec_generation']=='2' and result['run_state']=='READY' and len(f.sql('SELECT 1 FROM hyperfide.task_dependencies'))==1,'Restart lost admitted plan')
    check('dependencies.restart.durable-plan',restart)
    check('dependencies.status-not-qualification',lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.tasks WHERE state<>'PENDING'")[0]['n']==0 and f.sql("SELECT count(*)::int n FROM hyperfide.evidence")[0]['n']==0,'Structural admission manufactured task qualification'))
    def legacy_binding():
        f.sql("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision) VALUES($1,$2,$3,$2,$4,'QUALIFIED',2)",[f.ids['organisation'],run,f.ids['task1'],f.ids['task2']])
        result=success(f,'spec.dependencies.check',dict(p,state_version='3'))
        expect(result['status']=='INVALID' and any(d['code']=='DEPENDENCY_LEGACY_BINDING_UNSUPPORTED' for d in result['diagnostics']),'Legacy persisted edge gained structural authority')
    check('dependencies.binding.legacy-refused',legacy_binding)
    def undeclared_binding():
        f.sql("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision,binding_schema_version,predecessor_spec_generation,predecessor_spec_revision_id,predecessor_repository_id,integration_ref) VALUES($1,$2,$3,$2,$4,'INTEGRATED',2,1,2,$5,$6,'refs/heads/main')",[f.ids['organisation'],run,f.ids['task1'],f.ids['task2'],f.ids['accepted_spec'],f.ids['repository']])
        result=success(f,'spec.dependencies.check',dict(p,state_version='3'))
        expect(any(d['code']=='DEPENDENCY_UNDECLARED_BINDING' for d in result['diagnostics']),'Undeclared persisted edge gained authority')
    check('dependencies.binding.undeclared-refused',undeclared_binding)
    def stale_binding():
        current=advance_run_snapshot(f)
        f.sql("UPDATE hyperfide.tasks SET spec_generation=$4,spec_revision_id=$5,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[f.ids['organisation'],run,f.ids['task1'],current['spec_generation'],current['spec_revision_id']])
        result=success(f,'spec.dependencies.check',current)
        expect(any(d['code']=='DEPENDENCY_ACCEPTED_BINDING_STALE' for d in result['diagnostics']),'Accepted predecessor binding silently rebound to changed task')
    check('dependencies.binding.stale-predecessor-refused',stale_binding)

def header():return '[meta]\nslug="fixture"\n[req.1]\nac_1="An actual executable obligation"\n[acceptance.1]\nreq="1.1"\n'
def task(key,requires,wave=1,**fields):
    values={'wave':wave,'reqs':['1.1'],'acceptance_ids':['1'],'requires':requires,**fields}
    return '[task.'+str(key)+']\n'+''.join(name+'='+json.dumps(value,separators=(',',':'))+'\n' for name,value in values.items())
def invalid_source():
    descriptor={'organisation_id':'__ORG__','run_id':str(uuid.uuid4()),'repository_id':'__REPO__','feature_key':'fixture','task_key':'1','spec_generation':'2','spec_revision_id':'__SPEC__','milestone':'QUALIFIED','integration_ref':None}
    wrong=copy.deepcopy(descriptor);wrong['organisation_id']=str(uuid.uuid4())
    return header()+task(1,['1'])+task(2,['missing'])+task(3,['4'])+task(4,['3'],2)+task(5,['1','1'])+task(6,'1')+task(7,[True])+task(8,[descriptor])+task(9,[wrong])+task(10,[],touches=['../escape'])+task(11,[],wave=False)+task(12,[],owner=[])+task(13,[],description='Depends on task 1 before proceeding')+task(14,['1'],feature='other')
def invalid(f):
    result=success(f,'spec.dependencies.check',pins(f))
    codes={row['code'] for row in result['diagnostics']}
    check('dependencies.invalid.undispatchable',lambda:expect(result['status']=='INVALID','Invalid graph was accepted'))
    for suffix,code in [('self','DEPENDENCY_SELF'),('unknown','DEPENDENCY_UNRESOLVED'),('later-wave','DEPENDENCY_LATER_WAVE'),('cycle','DEPENDENCY_CYCLE'),('duplicate','DEPENDENCY_DUPLICATE'),('requires-type','REQUIRES_INVALID'),('reference-type','DEPENDENCY_REFERENCE_INVALID'),('unknown-run','DEPENDENCY_RUN_MISSING'),('descriptor-scope','DEPENDENCY_DESCRIPTOR_INVALID'),('touches','TOUCHES_INVALID'),('wave','WAVE_INVALID'),('owner','OWNER_INVALID')]:
        check('dependencies.invalid.'+suffix,lambda code=code:expect(code in codes,'Missing bounded diagnostic '+code))
    check('dependencies.invalid.prose-warning',lambda:expect(any(row['code']=='PROSE_COORDINATION_REQUIRES_REVIEW' for row in result['coordination_diagnostics']),'Prose cue was silently discarded'))
    check('dependencies.invalid.source-locations',lambda:expect(any(row.get('line',0)>0 and row.get('section')=='task.2' for row in result['diagnostics']),'Diagnostic lost actual source location'))
    check('dependencies.invalid.concrete-cycle',lambda:expect(any(row['code']=='DEPENDENCY_CYCLE' and row.get('path') and row['path'][0]==row['path'][-1] for row in result['diagnostics']),'Cycle path is absent or not closed'))
    admitted=success(f,'spec.dependencies.admit',pins(f))
    check('dependencies.invalid.atomic-refusal',lambda:expect(admitted['admitted'] is False and current_state(f)['state']=='PENDING_VALIDATION' and not f.sql('SELECT 1 FROM hyperfide.task_dependencies'),'Invalid graph gained dispatch admission'))
def large(f):
    result=success(f,'spec.dependencies.check',pins(f))
    check('dependencies.scale.large-graph',lambda:expect(result['status']=='STRUCTURALLY_VALID' and result['task_count']==12000 and result['edge_count']==11999,'Large accepted graph lost tasks or edges'))
    check('dependencies.scale.iterative-traversal',lambda:expect(result['diagnostic_count']==0,'Long graph produced recursion or malformed cycle diagnostics'))
def main():
    root=artifact_root();(root/'proofs').mkdir(exist_ok=True);(root/'storage').mkdir(exist_ok=True)
    baseline=SOURCE
    try:
        run_fixture(baseline,positive)
        run_fixture(invalid_source(),invalid)
        run_fixture(header()+''.join(task(number,[] if number==1 else [str(number-1)]) for number in range(1,12001)),large)
    finally:
        (root/'proofs/observations.json').write_text(json.dumps({'scope':'task-component','actual_https':True,'assertion_ids':OBS,'failed_ids':FAILED})+'\n')
    return 1 if FAILED else 0
def cleanup():
    from identity_fixture import SQL_JS
    root=artifact_root();p=root/'storage/database-names.json'
    if not p.exists():raise RuntimeError('Owned fixture database descriptor is missing')
    names=json.loads(p.read_text())['databases']
    import re
    if not names or any(not re.fullmatch('hf_identity_[0-9a-f]{32}',name) for name in names):raise RuntimeError('Invalid owned fixture database inventory')
    for name in names:
        subprocess.run(['node','--input-type=commonjs','-e',SQL_JS],input=json.dumps({'sql':'DROP DATABASE IF EXISTS "'+name+'" WITH(FORCE)','values':[]}),text=True,cwd=ROOT,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    result=subprocess.run(['node','--input-type=commonjs','-e',SQL_JS],input=json.dumps({'sql':'SELECT count(*)::int n FROM pg_database WHERE datname=ANY($1::text[])','values':[names]}),text=True,cwd=ROOT,capture_output=True,timeout=15)
    absent=result.returncode==0 and json.loads(result.stdout)==[{'n':0}]
    (root/'storage/database-absence.json').write_text(json.dumps({'databases':names,'observed_absent':absent})+'\n')
    print(json.dumps({'type':'cleanup','complete':absent,'resources':[{'id':RESOURCE,'status':'deleted' if absent else 'unknown','observed_absent':absent,'evidence_artifact':'storage/database-absence.json'}]}),flush=True)
    return 0 if absent else 1
if __name__=='__main__':sys.exit(cleanup() if '--cleanup' in sys.argv else main())
