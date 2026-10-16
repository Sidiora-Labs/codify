#!/usr/bin/env python3
import copy,hashlib,json,os,subprocess,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,sha,canonical
SOURCE="[meta]\nslug = \"fixture\"\n[req.1]\nac_1 = \"An actual executable obligation\"\n[acceptance.1]\nreq = \"1.1\"\nchecks = [\"actual-check\"]\n[acceptance.2]\nreq = \"2.1\"\n[task.1]\nwave = 1\nfeature = \"fixture\"\nreqs = [\"1.1\"]\nverify_cmd = \"printf accepted\"\nartifacts = [\"proof.json\"]\nacceptance_ids = [\"1\"]\nrequires = []\ntouches = [\"src/a.ts\"]\n[task.2]\nwave = 2\nfeature = \"fixture\"\nreqs = [\"1.1\"]\nverify_cmd = \"printf accepted\"\nartifacts = [\"proof.json\"]\nacceptance_ids = [\"1\"]\nrequires = [\"1\"]\ntouches = [\"src/b.ts\"]\n"
def setup(f):
    for version,name in [(2,'0002-spec'),(202,'0202-spec-dependencies')]:
        raw=(ROOT/('services/hyperfide/migrations/'+name+'.sql')).read_bytes()
        f.sql("BEGIN;\n"+raw.decode()+"\nINSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES("+str(version)+",'"+name+"','"+sha(raw)+"');COMMIT;")
    f.ids.update({key:f.ids.get(key,str(uuid.uuid4())) for key in ['repository','accepted_spec','package','package2','task1','task2','task3','task4','task5']})
    i=f.ids
    executable=str(Path(sys.executable).resolve())
    source=SOURCE+'\n[proof]\nrubric_digest = '+json.dumps(sha(b'rubric'))+'\n[proof.check.actual-check]\n'+''.join(key+' = '+json.dumps(value)+'\n' for key,value in {'argv':[executable,'-c','raise SystemExit(1)',''],'executable_digest':sha(Path(executable).read_bytes()),'timeout_ms':600000,'required_artifacts':['proof.json'],'input_keys':['source']}.items())
    parsed=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{parseKvx}from'./services/hyperfide/dist/spec/import.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(parseKvx(s)));"],input=source.encode(),cwd=ROOT))
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

OBS=[]
def expect(value,message):
 if not value:raise AssertionError(message)
def check(ident,body):
 try:body();actual='observed'
 except Exception as e:actual=type(e).__name__+': '+str(e)
 OBS.append((ident,actual));print(json.dumps({'type':'assertion','id':ident,'expected':'observed','actual':actual}),flush=True)
def invoke(f,action,value,key='operator'):
 status,result=f.invoke(action,value,component='spec-revisions',key=key)
 expect(status==200,'Actual signed amendment transport failed')
 return result
def success(f,action,value):
 r=invoke(f,action,value);expect(r.get('ok') is True,'Amendment action failed: '+str(r.get('error',{}).get('code')));return r['result']
def refused(f,value,code):
 r=invoke(f,'spec.amendment.check',value);expect(r.get('ok') is False and r.get('error',{}).get('code')==code,'Expected exact '+code)
def request(f,source,purpose='REPLAN'):
 (f.path/'replacement.kvx').write_bytes(source.encode())
 return {'run_id':f.ids['run'],'base_spec_revision_id':f.ids['accepted_spec'],'base_spec_generation':'2','state_version':'2','purpose':purpose,'reason':'Explicit bounded fixture replan','replacement':{'run_id':f.ids['run'],'source':{'relative_path':'replacement.kvx','sha256':hashlib.sha256(source.encode()).hexdigest(),'size_bytes':str(len(source.encode()))},'repositories':[{'repository_id':f.ids['repository'],'source_object_id':'a'*40,'integration_ref':'refs/heads/main'}],'allowed_actions':f.actions,'closure_policy':{'required_evidence':['actual-check'],'required_review_roles':['VERIFIER'],'publication':'AFTER_QUALIFICATION'},'provenance':None}}
def probe(f):
 baseline=f.sql("SELECT source_content FROM hyperfide.spec_revisions WHERE id=$1",[f.ids['accepted_spec']])[0]['source_content']
 changed=baseline.replace('[task.1]','[task.1]\ntitle = "Replanned implementation"')
 p=request(f,changed);saved={}
 def analyse():
  saved.update(success(f,'spec.amendment.check',p))
  expect(saved['status']=='STRUCTURALLY_VALID' and saved['accepted'] is False and saved['dispatch_authority'] is False,'Proposal status/pins mismatch: '+str([d['code'] for d in saved['diagnostics']])+str([d['code'] for d in saved['structural']['diagnostics']]))
  expect(saved['impact']['changed']==['1'] and set(saved['impact']['affected_task_ids'])=={f.ids['task1'],f.ids['task2']},'Changed task/transitive impact was lost')
 check('amendment.analysis.actual-signed-service',analyse)
 check('amendment.analysis.readonly',lambda:expect(f.sql("SELECT count(*)::int n FROM hyperfide.spec_amendments")[0]['n']==0 and f.sql("SELECT spec_generation::text g FROM hyperfide.runs WHERE id=$1",[f.ids['run']])[0]['g']=='2','Analysis mutated accepted state'))
 def propose():
  saved['proposal']=success(f,'spec.amendment.propose',p)
  expect(saved['proposal']['decision']=='PROPOSED' and saved['proposal']['accepted'] is False,'Proposed amendment was accepted implicitly')
 check('amendment.propose.immutable-record',propose)
 check('amendment.propose.exact-replay',lambda:expect(success(f,'spec.amendment.propose',p)['amendment_id']==saved['proposal']['amendment_id'] and f.sql("SELECT count(*)::int n FROM hyperfide.spec_amendments")[0]['n']==1,'Proposal replay duplicated immutable intent'))
 def immutable():
  rejected=False
  try:f.sql("UPDATE hyperfide.spec_amendments SET proposal='{}'::jsonb")
  except AssertionError:rejected=True
  expect(rejected,'Stored proposed intent was mutable')
 check('amendment.propose.storage-immutable',immutable)
 check('amendment.pin.stale-base',lambda:refused(f,dict(p,base_spec_generation='1'),'AMENDMENT_BASE_STALE'))
 check('amendment.pin.strict-fields',lambda:refused(f,dict(p,force=True),'AMENDMENT_INPUT_INVALID'))
 wrong=copy.deepcopy(p);wrong['replacement']['source']['sha256']='f'*64
 check('amendment.pin.source-digest',lambda:refused(f,wrong,'DIGEST_MISMATCH'))
 def scenario(ident,source,code=None,purpose='REPLAN'):
  def body():
   r=success(f,'spec.amendment.check',request(f,source,purpose))
   if code:expect(r['status']=='INVALID' and (any(d['code']==code for d in r['diagnostics']) or any(d['code']==code for d in r['structural']['diagnostics'])),'Missing explicit '+code)
   else:expect(r['status']=='STRUCTURALLY_VALID','Valid proposal was rejected: '+str([d['code'] for d in r['diagnostics']])+str([d['code'] for d in r['structural']['diagnostics']]))
  check(ident,body)
 scenario('amendment.replan.cannot-weaken-global-intent',baseline.replace('An actual executable obligation','A weaker criterion'),'INTENT_APPROVAL_REQUIRED')
 scenario('amendment.replan.cannot-weaken-accepted-command',baseline.replace('printf accepted','true'),'ACCEPTED_TASK_CHECK_CANNOT_BE_WEAKENED')
 scenario('amendment.replan.invalid-graph-explicit',baseline.replace('requires = ["1"]','requires = ["missing"]'),'DEPENDENCY_UNRESOLVED')
 scenario('amendment.replan.relocation-needs-new-identity',baseline.replace('wave = 1','wave = 2'),'TASK_RELOCATION_REQUIRES_NEW_IDENTITY')
 scenario('amendment.intent.explicit-operator-proposal',baseline.replace('An actual executable obligation','Explicit new accepted intent'),purpose='INTENT_CHANGE')
 scenario('amendment.analysis.comments-are-not-task-change',baseline+'\n# Preserved raw intent comment\n')
 def noauthority():
  expect(f.sql("SELECT count(*)::int n FROM hyperfide.spec_amendment_decisions")[0]['n']==0 and f.sql("SELECT count(*)::int n FROM hyperfide.evidence")[0]['n']==0,'Proposal created acceptance/evidence')
  expect(f.sql("SELECT count(*)::int n FROM hyperfide.tasks WHERE state<>'PENDING'")[0]['n']==0,'Proposal changed runtime task state')
 check('amendment.proposal.never-accepted-or-qualified',noauthority)
def main():
 f=IdentityFixture(extra_components=('2.1','2.4','2.2','2.3'),extra_setup=setup)
 try:probe(f)
 finally:f.close()
 return 1 if any(actual!='observed' for _,actual in OBS) else 0
if __name__=='__main__':sys.exit(main())
