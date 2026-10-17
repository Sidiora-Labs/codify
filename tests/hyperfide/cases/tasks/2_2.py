#!/usr/bin/env python3
"""Task 2.2 component probe: dependency graphs over plans accepted by the actual 2.1 importer.

Every plan is imported end to end through importRunTransaction from pinned source bytes and
checked through the registered spec-dependencies component over signed HTTPS. The proof
registry component (2.4) is deliberately not loaded: structural admission must stand alone.
"""
import copy,hashlib,json,os,re,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,sha
OBS=[]
FAILED=[]
RESOURCE='hf-task-2.2-database'
CORPUS='spec/hyperfide/spec.kvx'
OID='a'*40
def expect(condition,message):
    if not condition:raise AssertionError(message)
def check(ident,callback):
    OBS.append(ident)
    try:callback();actual='observed'
    except Exception as error:actual=type(error).__name__+': '+str(error);FAILED.append(ident)
    print(json.dumps({'type':'assertion','id':ident,'expected':'observed','actual':actual}),flush=True)
def artifact_root():
    path=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/task-2.2-auth-standalone'));path.mkdir(parents=True,exist_ok=True);return path
IMPORT_JS="""import pg from './services/hyperfide/node_modules/pg/lib/index.js';import{importRunTransaction}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;const v=JSON.parse(s),c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');try{const r=await importRunTransaction(c,v.scope,v.input);await c.query('COMMIT');process.stdout.write(JSON.stringify({ok:true,result:r}));}catch(e){await c.query('ROLLBACK');process.stdout.write(JSON.stringify({ok:false,error:{code:typeof e.code==='string'?e.code:'IMPORT_FAILED',message:String(e.message).slice(0,300)}}));}}finally{await c.end();}"""
PARSE_JS="""import{parseKvx,taskDefinitions}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;const d=parseKvx(s);process.stdout.write(JSON.stringify({counts:d.counts,tasks:taskDefinitions(d).map(t=>({key:t.key,feature_key:t.feature_key,wave:t.wave,requires:t.section.fields.requires?.value??[]}))}));"""

# ---- fixture plumbing: actual importer, actual principals, actual HTTPS service ----
def sources(f):
    path=f.path/'sources';path.mkdir(exist_ok=True);return path
def add_repository(f,name):
    repo=str(uuid.uuid4())
    f.sql("INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url,object_format) VALUES($1,$2,$3,$4,$5,'sha1')",[f.ids['organisation'],f.ids['project'],repo,name,'https://example.invalid/'+name+'.git'])
    f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,'commit')",[f.ids['organisation'],repo,OID])
    return repo
def import_run(f,content,repositories):
    """Import pinned source bytes through the actual 2.1 importer; repositories maps id->integration ref."""
    run=str(uuid.uuid4());data=content if isinstance(content,bytes) else content.encode()
    name=uuid.uuid4().hex+'.kvx';path=sources(f)/name;path.write_bytes(data);path.chmod(0o600)
    envelope={'run_id':run,'source':{'relative_path':name,'sha256':hashlib.sha256(data).hexdigest(),'size_bytes':str(len(data))},
     'repositories':[{'repository_id':repo,'source_object_id':OID,'integration_ref':ref} for repo,ref in repositories.items()],
     'allowed_actions':f.actions,'closure_policy':{'required_evidence':['actual-check'],'required_review_roles':['VERIFIER'],'publication':'AFTER_QUALIFICATION'},'provenance':None}
    scope={'organisation_id':f.ids['organisation'],'project_id':f.ids['project'],'run_id':run,'authority_epoch':f.ids['epoch'],'root':str(sources(f)),'allowed_actions':f.actions}
    result=subprocess.run(['node','--input-type=module','-e',IMPORT_JS],input=json.dumps({'scope':scope,'input':envelope}),text=True,capture_output=True,cwd=ROOT,env=f.env,timeout=300)
    expect(result.returncode==0,'Actual importer process failed: '+result.stderr[:600])
    outcome=json.loads(result.stdout)
    expect(outcome.get('ok') is True,'Actual importer refused fixture: '+json.dumps(outcome.get('error')))
    r=outcome['result'];expect(r['state']=='PENDING_VALIDATION' and r['replayed'] is False,'Import granted readiness or replayed')
    return {'run_id':run,'spec_revision_id':r['spec_revision_id'],'spec_generation':r['spec_generation'],'state_version':r['state_version'],'tasks':r['counts']['tasks'],'repositories':repositories}
def enrol(f,run):
    """Seed an actual OPERATOR principal for an imported run before the service starts."""
    credential=str(uuid.uuid4())
    record={'credential_id':credential,'organisation_id':f.ids['organisation'],'run_id':run,'actor_id':credential,'role':'OPERATOR','public_key_b64':f.keys['operator']['public_key_b64'],
     'deployment_epoch':f.ids['epoch'],'allowed_actions':f.actions,'expires_at':time.strftime('%Y-%m-%dT%H:%M:%S.000Z',time.gmtime(time.time()+3600))}
    f.seed_fixture_principal(record)
    config=json.loads(f.identity_config.read_text());config['principals'].append(record);f.identity_config.write_text(json.dumps(config))
    return credential
DATABASES=[]
def run_fixture(build,callback):
    plan={}
    def prepare(f):
        f.env['HF_SPEC_ALLOWED_ROOT']=str(sources(f))
        build(f,plan)
    f=IdentityFixture(extra_components=('2.1','2.2'),extra_setup=prepare,extra_actions=('system.describe',))
    DATABASES.append(f.database)
    root=artifact_root();(root/'storage').mkdir(exist_ok=True)
    (root/'storage/database-names.json').write_text(json.dumps({'databases':DATABASES}))
    try:callback(f,plan)
    finally:f.close()
def request(f,run,action,payload,component='spec-dependencies',timeout=60):
    status,result=f.request(f.operation(component,action,payload,run=run['run_id']),key='operator',credential=run['credential'],timeout_seconds=timeout)
    expect(status==200,'Actual spec HTTPS dispatch failed')
    return result
def success(f,run,action,payload,**kwargs):
    result=request(f,run,action,payload,**kwargs)
    expect(result.get('ok') is True,'Spec action failed: '+str(result.get('error',{}).get('code')))
    return result['result']
def refused(f,run,action,payload,code):
    result=request(f,run,action,payload)
    expect(result.get('ok') is False and result.get('error',{}).get('code')==code,'Expected refusal '+code+'; observed '+str(result.get('error',{}).get('code')))
def pins(run,**changes):return dict({key:run[key] for key in ['run_id','spec_revision_id','spec_generation','state_version']},**changes)
def current_state(f,run):return f.sql("SELECT state,spec_generation::text,state_version::text FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",[f.ids['organisation'],run['run_id']])[0]
def task_id(f,run,key):return f.sql("SELECT id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND task_key=$3",[f.ids['organisation'],run['run_id'],key])[0]['id']
def edges_of(f,run):return f.sql("SELECT t.task_key,p.task_key AS predecessor_key,d.predecessor_run_id,d.milestone,d.predecessor_repository_id,d.integration_ref,d.predecessor_spec_generation::text,d.predecessor_spec_revision_id,d.binding_schema_version FROM hyperfide.task_dependencies d JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.run_id AND t.id=d.task_id JOIN hyperfide.tasks p ON p.organisation_id=d.organisation_id AND p.run_id=d.predecessor_run_id AND p.id=d.predecessor_task_id WHERE d.organisation_id=$1 AND d.run_id=$2 ORDER BY t.task_key,p.task_key",[f.ids['organisation'],run['run_id']])
def descriptor(f,target,key,feature,milestone='QUALIFIED',repository=None,**changes):
    repo=repository or next(iter(target['repositories']))
    value={'organisation_id':f.ids['organisation'],'run_id':target['run_id'],'repository_id':repo,'feature_key':feature,'task_key':key,'spec_generation':target['spec_generation'],
     'spec_revision_id':target['spec_revision_id'],'milestone':milestone,'integration_ref':target['repositories'][repo] if milestone=='INTEGRATED' else None}
    value.update(changes);return value
def header(slug):return '[meta]\nslug = "'+slug+'"\n[req.1]\nac_1 = "An actual executable obligation"\n[acceptance.1]\nreq = "1.1"\n'
def task(key,requires,wave=1,**fields):
    values={'wave':wave,'reqs':['1.1'],'acceptance_ids':['1'],'requires':requires,**fields}
    return '[task.'+str(key)+']\n'+''.join(name+' = '+json.dumps(value,separators=(',',':'))+'\n' for name,value in values.items())
def codes_for(report,key):return {row['code'] for row in report['diagnostics'] if row.get('task_key')==key}
def find(rows,code,key=None):return [row for row in rows if row['code']==code and (key is None or row.get('task_key')==key)]

# ---- V-001 positive: cross-feature, cross-repository and cross-run edges with explicit milestones ----
def build_positive(f,plan):
    beta_repo=add_repository(f,'beta');core_repo=add_repository(f,'core');edge_repo=add_repository(f,'edge')
    beta=import_run(f,header('beta')+task(1,[])+task(2,['1'],2),{beta_repo:'refs/heads/main'})
    source=(header('alpha')+
     task(1,[],1,feature='core',owner='core',touches=['src/core/a.ts'])+
     task(2,['1'],2,feature='core',owner='core',touches=['src/core/b.ts'],do_1='Extend the API after task 1 qualifies.')+
     task(3,[{'feature_key':'core','task_key':'1'}],2,feature='edge',owner='edge',touches=['src/core/a.ts'])+
     task(4,[{'feature_key':'core','task_key':'2','milestone':'INTEGRATED','repository_id':edge_repo,'integration_ref':'refs/heads/release'},descriptor(f,beta,'1','programme:beta')],3,feature='edge',owner='edge')+
     task(5,[descriptor(f,beta,'2','programme:beta','INTEGRATED')],3,feature='edge',owner='edge'))
    alpha=import_run(f,source,{core_repo:'refs/heads/main',edge_repo:'refs/heads/release'})
    alpha['credential']=enrol(f,alpha['run_id'])
    plan.update(alpha=alpha,beta=beta,core_repo=core_repo,edge_repo=edge_repo,beta_repo=beta_repo)
def advance_run_snapshot(f,run):
    current=f.sql("SELECT r.spec_generation::text,r.state_version::text,s.source_content,s.document FROM hyperfide.runs r JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id WHERE r.organisation_id=$1 AND r.id=$2",[f.ids['organisation'],run['run_id']])[0]
    source=current['source_content']+'\n# An unrelated accepted run revision\n'
    document=copy.deepcopy(current['document']);document['source_digest']=sha(source.encode())
    document['parsed']=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT))
    accepted={key:document[key] for key in ['schema_version','source_digest','repositories','allowed_actions','closure_policy','provenance']}
    document['revision_digest']=sha(json.dumps(accepted,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
    spec=str(uuid.uuid4());generation=str(int(current['spec_generation'])+1)
    f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[f.ids['organisation'],f.ids['project'],spec,document['source_digest'],source,json.dumps(document),document['revision_digest']])
    f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$3,$4)",[f.ids['organisation'],run['run_id'],generation,spec])
    f.sql("UPDATE hyperfide.runs SET spec_generation=$3,spec_revision_id=$4,state='PENDING_VALIDATION',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[f.ids['organisation'],run['run_id'],generation,spec])
    return dict(run,spec_revision_id=spec,spec_generation=generation,state_version=str(int(current['state_version'])+1))
def positive(f,plan):
    alpha,beta=plan['alpha'],plan['beta'];p=pins(alpha);run=alpha['run_id'];saved={}
    def linked():
        result=request(f,alpha,'system.describe',{},component='system')
        ids=[row['id'] for row in result['result']['components']]
        expect('spec-dependencies' in ids and 'spec-obligations' not in ids,'Dependency component did not load independently of the later proof registry')
    check('dependencies.component.independent-of-proof-registry',linked)
    def imported():
        rows=f.sql("SELECT t.task_key,t.definition->>'feature_key' AS feature,p.package_key FROM hyperfide.tasks t JOIN hyperfide.feature_packages p ON p.organisation_id=t.organisation_id AND p.run_id=t.run_id AND p.id=t.feature_package_id WHERE t.run_id=$1 ORDER BY t.task_key",[run])
        expect([(r['task_key'],r['feature'],r['package_key']) for r in rows]==[('1','core','feature:core:wave:1'),('2','core','feature:core:wave:2'),('3','edge','feature:edge:wave:2'),('4','edge','feature:edge:wave:3'),('5','edge','feature:edge:wave:3')],'Importer did not produce canonical feature identities')
        expect(f.sql("SELECT s.revision_digest=s.document->>'revision_digest' AS ok FROM hyperfide.spec_revisions s WHERE s.id=$1",[alpha['spec_revision_id']])[0]['ok'] is True,'Imported revision digest is not canonical')
    check('dependencies.import.pinned-end-to-end',imported)
    def check_graph():
        saved.update(success(f,alpha,'spec.dependencies.check',p))
        expect(saved['status']=='STRUCTURALLY_VALID' and saved['task_count']==5 and saved['edge_count']==5 and saved['diagnostic_count']==0,'Actual multi-feature graph changed: '+json.dumps(saved['diagnostics'])[:400])
    check('dependencies.valid.actual-service',check_graph)
    check('dependencies.valid.cross-feature-qualified',lambda:expect(saved['edge_summary']['cross_feature']==2,'Same-run cross-feature edges were not resolved through qualified feature identity'))
    check('dependencies.valid.milestones-distinguished',lambda:expect(saved['edge_summary']=={'qualified_revision':3,'integrated_target':2,'cross_feature':2,'cross_run':2,'cross_repository':3},'Qualified-revision and integrated-target edges were not distinguished: '+json.dumps(saved['edge_summary'])))
    check('dependencies.valid.prose-backed-silent',lambda:expect(not find(saved['coordination_diagnostics'],'PROSE_PREREQUISITE_WITHOUT_EDGE') and not find(saved['coordination_diagnostics'],'SCOPE_SHARED_UNSEQUENCED'),'Structurally backed prose or wave-sequenced scope was misreported'))
    check('dependencies.check.readonly',lambda:expect(current_state(f,alpha)['state']=='PENDING_VALIDATION' and not f.sql('SELECT 1 FROM hyperfide.task_dependencies'),'Check mutated admission state'))
    check('dependencies.resolve.exact-logical-key',lambda:expect(success(f,alpha,'spec.task.resolve',{'run_id':run,'task_key':'2'})['task_id']==task_id(f,alpha,'2'),'Logical key did not resolve actual UUID'))
    check('dependencies.resolve.unknown',lambda:refused(f,alpha,'spec.task.resolve',{'run_id':run,'task_key':'absent'},'SPEC_TASK_NOT_FOUND'))
    check('dependencies.resolve.strict-type',lambda:refused(f,alpha,'spec.task.resolve',{'run_id':run,'task_key':2},'SPEC_INPUT_INVALID'))
    check('dependencies.resolve.scope',lambda:refused(f,alpha,'spec.task.resolve',{'run_id':str(uuid.uuid4()),'task_key':'1'},'SPEC_SCOPE_MISMATCH'))
    def frontier():
        result=success(f,alpha,'spec.next',{'run_id':run,'limit':1})
        expect(result['authority']=='CANDIDATE_DISCOVERY' and result['operational_eligibility']=='UNASSESSED' and [row['task_id'] for row in result['candidates']]==[task_id(f,alpha,'1')],'Frontier confused structure with operational authority')
    check('dependencies.frontier.discovery-only',frontier)
    check('dependencies.frontier.strict-limit',lambda:refused(f,alpha,'spec.next',{'run_id':run,'limit':True},'SPEC_INPUT_INVALID'))
    check('dependencies.input.unknown-key',lambda:refused(f,alpha,'spec.dependencies.check',dict(p,override=True),'SPEC_INPUT_INVALID'))
    check('dependencies.input.numeric-generation',lambda:refused(f,alpha,'spec.dependencies.check',dict(p,spec_generation=int(p['spec_generation'])),'SPEC_INPUT_INVALID'))
    check('dependencies.pin.stale-generation',lambda:refused(f,alpha,'spec.dependencies.check',dict(p,spec_generation=str(int(p['spec_generation'])+1)),'SPEC_PLAN_STALE'))
    check('dependencies.pin.stale-state',lambda:refused(f,alpha,'spec.dependencies.check',dict(p,state_version=str(int(p['state_version'])+1)),'SPEC_PLAN_STALE'))
    def late_failure():
        f.sql("CREATE FUNCTION hyperfide.inject_admission_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected late admission failure'; END $$;CREATE TRIGGER zzz_injected BEFORE UPDATE ON hyperfide.runs FOR EACH ROW WHEN(NEW.state='READY') EXECUTE FUNCTION hyperfide.inject_admission_failure();")
        try:
            result=request(f,alpha,'spec.dependencies.admit',p)
            expect(result.get('ok') is False,'Injected late transaction failure was ignored')
            expect(not f.sql('SELECT 1 FROM hyperfide.task_dependencies') and current_state(f,alpha)['state']=='PENDING_VALIDATION','Late failure left partial dependency writes')
        finally:f.sql("DROP TRIGGER zzz_injected ON hyperfide.runs;DROP FUNCTION hyperfide.inject_admission_failure();")
    check('dependencies.transaction.late-failure-rollback',late_failure)
    admitted_version=str(int(p['state_version'])+1)
    def admit():
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:request(f,alpha,'spec.dependencies.admit',p),range(2)))
        accepted=[r['result'] for r in responses if r.get('ok') is True]
        expect(len(accepted)==1 and any(r.get('error',{}).get('code')=='SPEC_PLAN_STALE' for r in responses),'Concurrent admission did not enforce one exact CAS winner')
        result=accepted[0];saved['admitted']=result
        expect(result['admitted'] is True and result['state_version']==admitted_version and current_state(f,alpha)['state']=='READY','Atomic admission did not advance exact run generation')
    check('dependencies.admit.atomic-ready',admit)
    check('dependencies.admit.proof-gate-deferred',lambda:expect(saved['admitted']['proof_obligations']=='ENFORCED_AT_DISPATCH_ADMISSION' and f.sql("SELECT count(*)::int n FROM hyperfide.tasks WHERE run_id=$1 AND state<>'PENDING'",[run])[0]['n']==0,'Structural admission claimed proof authority'))
    check('dependencies.admit.concurrent-cas',lambda:expect(current_state(f,alpha)['state_version']==admitted_version,'Concurrent admission advanced state more than once'))
    def exact_edges():
        rows=edges_of(f,alpha);g=alpha['spec_generation'];s=alpha['spec_revision_id']
        expected=[('2','1',run,'QUALIFIED',None,None,g,s),('3','1',run,'QUALIFIED',None,None,g,s),('4','1',beta['run_id'],'QUALIFIED',plan['beta_repo'],None,beta['spec_generation'],beta['spec_revision_id']),
         ('4','2',run,'INTEGRATED',plan['edge_repo'],'refs/heads/release',g,s),('5','2',beta['run_id'],'INTEGRATED',plan['beta_repo'],'refs/heads/main',beta['spec_generation'],beta['spec_revision_id'])]
        observed=[(r['task_key'],r['predecessor_key'],r['predecessor_run_id'],r['milestone'],r['predecessor_repository_id'],r['integration_ref'],r['predecessor_spec_generation'],r['predecessor_spec_revision_id']) for r in rows]
        expect(observed==expected and all(r['binding_schema_version']==1 for r in rows),'Resolved edges lost exact predecessor identity: '+json.dumps(observed))
    check('dependencies.storage.exact-pins',exact_edges)
    check('dependencies.storage.cross-run-integrated',lambda:expect([r['integration_ref'] for r in edges_of(f,alpha) if r['predecessor_run_id']==beta['run_id'] and r['milestone']=='INTEGRATED']==['refs/heads/main'],'Cross-run integrated-target milestone not stored'))
    check('dependencies.admit.stale-replay',lambda:refused(f,alpha,'spec.dependencies.admit',p,'SPEC_PLAN_STALE'))
    check('dependencies.admit.wrong-state',lambda:refused(f,alpha,'spec.dependencies.admit',dict(p,state_version=admitted_version),'SPEC_ADMISSION_STATE'))
    def immutable():
        rejected=False
        try:f.sql("UPDATE hyperfide.task_dependencies SET integration_ref='refs/heads/changed'")
        except AssertionError:rejected=True
        expect(rejected,'Accepted predecessor binding was rewritten')
    check('dependencies.storage.immutable-binding',immutable)
    def isolation():
        rejected=False
        try:f.sql("BEGIN ISOLATION LEVEL REPEATABLE READ;INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision) VALUES('"+f.ids['organisation']+"','"+run+"','"+task_id(f,alpha,'1')+"','"+run+"','"+task_id(f,alpha,'5')+"','QUALIFIED',"+p['spec_generation']+");COMMIT;")
        except AssertionError as error:rejected='25001' in str(error)
        expect(rejected,'Repeatable-read writer was not rejected')
    check('dependencies.storage.repeatable-read-refused',isolation)
    def restart():
        f.stop();f.start()
        result=success(f,alpha,'spec.task.resolve',{'run_id':run,'task_key':'2'})
        expect(result['spec_generation']==p['spec_generation'] and result['run_state']=='READY' and len(edges_of(f,alpha))==5,'Restart lost admitted plan')
    check('dependencies.restart.durable-plan',restart)
    check('dependencies.status-not-qualification',lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.tasks WHERE state<>'PENDING'")[0]['n']==0 and f.sql("SELECT count(*)::int n FROM hyperfide.evidence")[0]['n']==0,'Structural admission manufactured task qualification'))
    after=dict(p,state_version=admitted_version)
    def legacy_binding():
        f.sql("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision) VALUES($1,$2,$3,$2,$4,'QUALIFIED',$5)",[f.ids['organisation'],run,task_id(f,alpha,'1'),task_id(f,alpha,'5'),p['spec_generation']])
        result=success(f,alpha,'spec.dependencies.check',after)
        expect(result['status']=='INVALID' and find(result['diagnostics'],'DEPENDENCY_LEGACY_BINDING_UNSUPPORTED','1'),'Legacy persisted edge gained structural authority')
    check('dependencies.binding.legacy-refused',legacy_binding)
    def undeclared_binding():
        f.sql("INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision,binding_schema_version,predecessor_spec_generation,predecessor_spec_revision_id,predecessor_repository_id,integration_ref) VALUES($1,$2,$3,$2,$4,'INTEGRATED',$5,1,$5,$6,$7,'refs/heads/main')",[f.ids['organisation'],run,task_id(f,alpha,'1'),task_id(f,alpha,'5'),p['spec_generation'],alpha['spec_revision_id'],plan['core_repo']])
        result=success(f,alpha,'spec.dependencies.check',after)
        expect(find(result['diagnostics'],'DEPENDENCY_UNDECLARED_BINDING','1'),'Undeclared persisted edge gained authority')
    check('dependencies.binding.undeclared-refused',undeclared_binding)
    def stale_binding():
        current=advance_run_snapshot(f,dict(alpha,state_version=admitted_version))
        f.sql("UPDATE hyperfide.tasks SET spec_generation=$4,spec_revision_id=$5,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND task_key=$3",[f.ids['organisation'],run,'1',current['spec_generation'],current['spec_revision_id']])
        result=success(f,alpha,'spec.dependencies.check',pins(current))
        expect(find(result['diagnostics'],'DEPENDENCY_ACCEPTED_BINDING_STALE'),'Accepted predecessor binding silently rebound to changed task')
    check('dependencies.binding.stale-predecessor-refused',stale_binding)

# ---- V-001 negative: every defect class yields a located diagnostic and blocks admission ----
def build_invalid(f,plan):
    own_repo=add_repository(f,'own');beta_repo=add_repository(f,'beta-negative')
    beta=import_run(f,header('beta')+task(1,[]),{beta_repo:'refs/heads/main'})
    missing=descriptor(f,beta,'1','programme:beta',run_id=str(uuid.uuid4()))
    wrong_org=descriptor(f,beta,'1','programme:beta',organisation_id=str(uuid.uuid4()))
    source=(header('fixture')+task(1,['1'])+task(2,['missing'])+task(3,['4'])+task(4,['3'],2)+task(5,['1','1'])+task(6,'1')+task(7,[True])+
     task(8,[missing])+task(9,[wrong_org])+task(10,[],touches=['../escape'])+task(11,[],wave=False)+task(12,[],owner=[])+
     task(13,[],description='Depends on the upstream schema settling first')+task(14,['1'],feature='other')+task(15,[],feature='')+task(16,[],feature=5)+
     task(17,[descriptor(f,beta,'1','programme:beta',repository_id=own_repo)])+
     task(18,[{'feature_key':'programme:fixture','task_key':'2','milestone':'INTEGRATED','repository_id':own_repo,'integration_ref':'refs/heads/other'}],2)+
     task(19,[descriptor(f,beta,'1','programme:beta',spec_generation='7')])+
     task(20,[],owner='storage',touches=['src/shared/state.ts'])+task(21,[],owner='identity',touches=['src/shared'])+
     task(22,[{'feature_key':'programme:fixture','task_key':'2','milestone':'INTEGRATED'}],2)+
     task(23,[],2,owner='storage',touches=['src/other.ts'],do_1='Take src/other.ts ownership after task 12 qualifies; see also task 99.'))
    alpha=import_run(f,source,{own_repo:'refs/heads/main'})
    alpha['credential']=enrol(f,alpha['run_id'])
    plan.update(alpha=alpha,beta=beta)
def invalid(f,plan):
    alpha=plan['alpha'];result={}
    def checked():
        result.update(success(f,alpha,'spec.dependencies.check',pins(alpha)))
        expect(result['status']=='INVALID' and result['task_count']==23,'Invalid graph was accepted or lost tasks')
    check('dependencies.invalid.undispatchable',checked)
    codes=lambda:{row['code'] for row in result.get('diagnostics',[])}
    for suffix,code in [('self','DEPENDENCY_SELF'),('unknown','DEPENDENCY_UNRESOLVED'),('later-wave','DEPENDENCY_LATER_WAVE'),('cycle','DEPENDENCY_CYCLE'),('duplicate','DEPENDENCY_DUPLICATE'),('requires-type','REQUIRES_INVALID'),('reference-type','DEPENDENCY_REFERENCE_INVALID'),('unknown-run','DEPENDENCY_RUN_MISSING'),('descriptor-scope','DEPENDENCY_DESCRIPTOR_INVALID'),('touches','TOUCHES_INVALID'),('wave','WAVE_INVALID'),('owner','OWNER_INVALID')]:
        check('dependencies.invalid.'+suffix,lambda code=code:expect(code in codes(),'Missing bounded diagnostic '+code))
    def unqualified():
        rows=find(result['diagnostics'],'DEPENDENCY_FEATURE_UNQUALIFIED','14')
        expect(rows and rows[0]['target']=='1' and rows[0]['candidates']==['run/'+alpha['run_id']+'/feature/programme:fixture/task/1'],'Bare cross-feature reference lacked a qualified candidate identity')
    check('dependencies.invalid.cross-feature-unqualified',unqualified)
    check('dependencies.invalid.namespace-missing',lambda:expect('FEATURE_NAMESPACE_MISSING' in codes_for(result,'15'),'Empty feature namespace was accepted'))
    check('dependencies.invalid.package-mismatch',lambda:expect('FEATURE_PACKAGE_MISMATCH' in codes_for(result,'16'),'Feature declaration differing from its package was accepted'))
    check('dependencies.invalid.cross-repository',lambda:expect('DEPENDENCY_REPOSITORY_MISMATCH' in codes_for(result,'17') and 'DEPENDENCY_REPOSITORY_MISMATCH' in codes_for(result,'18'),'Unpinned repository or wrong integration target was accepted'))
    check('dependencies.invalid.spec-stale',lambda:expect('DEPENDENCY_SPEC_STALE' in codes_for(result,'19'),'Predecessor revision pin mismatch was accepted'))
    check('dependencies.invalid.integrated-needs-target',lambda:expect('DEPENDENCY_DESCRIPTOR_INVALID' in codes_for(result,'22'),'Integrated milestone without repository target was accepted'))
    def ownership():
        rows=find(result['diagnostics'],'SCOPE_OWNERSHIP_CONFLICT','21')
        expect(rows and rows[0]['target']=='20' and rows[0]['scope_path']=='src/shared' and sorted(rows[0]['owners'])==['identity','storage'] and rows[0].get('line',0)>0,'Contradictory scope ownership lacked a concrete diagnostic')
    check('dependencies.invalid.scope-ownership',ownership)
    def prose():
        rows=find(result['coordination_diagnostics'],'PROSE_PREREQUISITE_WITHOUT_EDGE','23')
        expect(rows and rows[0]['target']=='12' and rows[0]['section']=='task.23' and rows[0]['key']=='do_1' and rows[0]['line']>0 and 'after task 12' in rows[0]['excerpt'],'Prose prerequisite lacked a located missing-edge diagnostic')
        expect(find(result['coordination_diagnostics'],'PROSE_REFERENCE_UNKNOWN','23')[0]['target']=='99','Unknown prose reference was not reported')
    check('dependencies.invalid.prose-reference',prose)
    check('dependencies.invalid.prose-warning',lambda:expect(any(row.get('key')=='description' and row.get('line',0)>0 for row in find(result['coordination_diagnostics'],'PROSE_COORDINATION_REQUIRES_REVIEW','13')),'Prose cue was silently discarded or unlocated'))
    check('dependencies.invalid.source-locations',lambda:expect(any(row.get('line',0)>0 and row.get('section')=='task.2' for row in result['diagnostics']),'Diagnostic lost actual source location'))
    check('dependencies.invalid.concrete-cycle',lambda:expect(any(row['code']=='DEPENDENCY_CYCLE' and row.get('path') and row['path'][0]==row['path'][-1] and {item.rsplit('/',1)[1] for item in row['path']}=={'3','4'} for row in result['diagnostics']),'Cycle path is absent, not closed or not the actual cycle'))
    def refusal():
        admitted=success(f,alpha,'spec.dependencies.admit',pins(alpha))
        expect(admitted['admitted'] is False and current_state(f,alpha)['state']=='PENDING_VALIDATION' and not f.sql('SELECT 1 FROM hyperfide.task_dependencies'),'Invalid graph gained dispatch admission')
    check('dependencies.invalid.atomic-refusal',refusal)

# ---- V-024 scale and bounds: generated long chain, run-fanout limit, exact schema readiness ----
def build_large(f,plan):
    repo=add_repository(f,'large')
    large=import_run(f,header('large')+''.join(task(number,[] if number==1 else [str(number-1)]) for number in range(1,12001)),{repo:'refs/heads/main'})
    fanout=[descriptor(f,large,'1','programme:large',run_id=str(uuid.uuid4())) for _ in range(32)]
    wide=import_run(f,header('wide')+task(1,fanout),{repo:'refs/heads/main'})
    large['credential']=enrol(f,large['run_id']);wide['credential']=enrol(f,wide['run_id'])
    plan.update(large=large,wide=wide)
def large(f,plan):
    big=plan['large'];result={}
    def checked():
        result.update(success(f,big,'spec.dependencies.check',pins(big),timeout=120))
        expect(result['status']=='STRUCTURALLY_VALID' and result['task_count']==12000 and result['edge_count']==11999,'Large accepted graph lost tasks or edges')
    check('dependencies.scale.large-graph',checked)
    check('dependencies.scale.iterative-traversal',lambda:expect(result['diagnostic_count']==0,'Long graph produced recursion or malformed cycle diagnostics'))
    check('dependencies.limit.run-fanout',lambda:refused(f,plan['wide'],'spec.dependencies.check',pins(plan['wide']),'SPEC_GRAPH_LIMIT'))
    def schema():
        # Disposable fixture database only: the exact 0202 checksum no longer matches the tracked migration.
        f.sql("ALTER TABLE hyperfide.schema_migrations DISABLE TRIGGER USER")
        f.sql("UPDATE hyperfide.schema_migrations SET checksum=$1 WHERE version=202",[sha(b'not-the-tracked-migration')])
        f.sql("ALTER TABLE hyperfide.schema_migrations ENABLE TRIGGER USER")
        refused(f,big,'spec.dependencies.check',pins(big),'SPEC_SCHEMA_NOT_READY')
    check('dependencies.schema.not-ready',schema)

# ---- V-024 corpus: the tracked spec.kvx loaded verbatim, individually and jointly ----
def corpus_bytes():return (ROOT/CORPUS).read_bytes()
def build_corpus(f,plan):
    repo=add_repository(f,'corpus');data=corpus_bytes()
    spec=import_run(f,data,{repo:'refs/heads/main'})
    joint=import_run(f,header('joint')+task(1,[descriptor(f,spec,'2.1','programme:programme')])+task(2,[descriptor(f,spec,'2.2','programme:programme','INTEGRATED')],2,do_1='Consume the dependency checks after task 1.'),{repo:'refs/heads/main'})
    spec['credential']=enrol(f,spec['run_id']);joint['credential']=enrol(f,joint['run_id'])
    plan.update(spec=spec,joint=joint,digest=hashlib.sha256(data).hexdigest())
def corpus(f,plan):
    spec,joint=plan['spec'],plan['joint'];result={};expected={}
    parsed=json.loads(subprocess.check_output(['node','--input-type=module','-e',PARSE_JS],input=corpus_bytes(),cwd=ROOT))
    expected.update(tasks=len(re.findall(rb'^\[task\.[^\]]+\]',corpus_bytes(),re.M)),requires=sum(len(t['requires']) for t in parsed['tasks']),keys={t['key'] for t in parsed['tasks']})
    def unchanged():
        tracked=subprocess.run(['git','ls-files','--error-unmatch',CORPUS],cwd=ROOT,capture_output=True)
        expect(tracked.returncode==0 and plan['digest']==hashlib.sha256(corpus_bytes()).hexdigest(),'Corpus fixture is untracked or changed while loading')
        stored=f.sql("SELECT s.source_digest FROM hyperfide.spec_revisions s WHERE s.id=$1",[spec['spec_revision_id']])[0]['source_digest']
        expect(stored=='sha256:'+plan['digest'],'Stored corpus differs from the tracked fixture bytes')
    check('dependencies.corpus.fixture-verbatim',unchanged)
    def records():
        result.update(success(f,spec,'spec.dependencies.check',pins(spec),timeout=120))
        expect(spec['tasks']==expected['tasks']==parsed['counts']['tasks']==result['task_count'],'Parser or validator dropped declared task records')
        expect(result['edge_count']+result['diagnostic_count']>=expected['requires'] and result['edge_count']<=expected['requires'],'Declared corpus dependency references were silently dropped')
    check('dependencies.corpus.records-preserved',records)
    def genuine():
        structural={'DEPENDENCY_UNRESOLVED','DEPENDENCY_FEATURE_UNQUALIFIED','DEPENDENCY_LATER_WAVE','DEPENDENCY_CYCLE','DEPENDENCY_SELF','DEPENDENCY_DUPLICATE','SCOPE_OWNERSHIP_CONFLICT'}
        for row in result['diagnostics']:
            expect(row['task_key'] in expected['keys'] and row.get('section')=='task.'+row['task_key'] and row.get('line',0)>0,'Corpus diagnostic does not locate an actual declared task: '+json.dumps(row))
            expect(row['code'] in structural,'Corpus produced a non-graph diagnostic: '+row['code'])
        expect((result['status']=='INVALID')==(result['diagnostic_count']>0),'Corpus validation status disagrees with its diagnostics')
        for row in result['coordination_diagnostics']:
            expect(row.get('line',0)>0 and row.get('key') and row.get('section','').startswith('task.'),'Corpus prose diagnostic lacks an exact location: '+json.dumps(row))
    check('dependencies.corpus.genuine-diagnostics',genuine)
    def resolve():
        row=success(f,spec,'spec.task.resolve',{'run_id':spec['run_id'],'task_key':'2.2'})
        expect(row['feature_key']=='programme:programme' and row['task_state']=='PENDING','Corpus task identity was not fully qualified or gained status')
    check('dependencies.corpus.qualified-identity',resolve)
    def joint_query():
        report=success(f,joint,'spec.dependencies.check',pins(joint),timeout=120)
        expect(report['status']=='STRUCTURALLY_VALID' and report['edge_summary']['cross_run']==2 and report['edge_summary']['integrated_target']==1 and report['edge_summary']['qualified_revision']==1,'Joint cross-programme query lost explicit links: '+json.dumps(report['diagnostics'])[:400])
    check('dependencies.joint.cross-programme',joint_query)
    def not_completion():
        declared=sum(1 for line in corpus_bytes().decode().splitlines() if re.fullmatch(r'status = "(done|qualified)"',line))
        expect(f.sql("SELECT count(*)::int n FROM hyperfide.tasks WHERE run_id=$1 AND state='PENDING'",[spec['run_id']])[0]['n']==expected['tasks'] and f.sql("SELECT count(*)::int n FROM hyperfide.evidence")[0]['n']==0,'Planning counts implied completion ('+str(declared)+' declared statuses)')
    check('dependencies.corpus.planning-not-completion',not_completion)

def main():
    root=artifact_root();(root/'proofs').mkdir(exist_ok=True);(root/'storage').mkdir(exist_ok=True)
    try:
        for build,callback in [(build_positive,positive),(build_invalid,invalid),(build_large,large),(build_corpus,corpus)]:
            try:run_fixture(build,callback)
            except Exception as error:
                ident='dependencies.fixture.'+callback.__name__
                check(ident,lambda error=error:(_ for _ in ()).throw(error))
    finally:
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
