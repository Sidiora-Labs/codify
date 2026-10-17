#!/usr/bin/env python3
"""Registered placement checks exercise actual service dispatch; this bounded suite does not claim OS restriction qualification."""
import copy,hashlib,json,os,pathlib,shutil,subprocess,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[4];FAILED=[]
def check(name,fn):
 try:fn();actual='observed'
 except Exception as error:actual=type(error).__name__+': '+str(error);FAILED.append(name)
 print(json.dumps({'type':'assertion','id':name,'expected':'observed','actual':actual}),flush=True)
def expect(ok,message='unexpected service outcome'):
 if not ok:raise AssertionError(message)
def digest(text):return 'sha256:'+hashlib.sha256(text.encode()).hexdigest()
POLICY={'schema_version':1,'programme_id':'fixture-run','repository':'fixture/repository','spec_revision':'fixture-revision','policy_revision':1,
 'status':'ACTIVE','approval':{'decision':'APPROVED','record_id':'fixture-approval','spec_revision':'fixture-revision','policy_revision':1},
 'allowed_roles':['control','provisioner','dispatch'],'allowed_actions':['programme.activate','programme.provision','programme.dispatch','programme.authorize',
 'placement.check','placement.authorize','placement.delegate','placement.runner.authorize']}
PROFILE={key:POLICY[key] for key in ['schema_version','programme_id','repository','spec_revision','policy_revision']}
PROFILE.update(supervisory_host_id='fixture-main',restrictions={'profile_digest':digest('restricted-native-profile'),
 'evidence_digest':digest('contract-fixture'),'qualification':'QUALIFIED','expires_at':'2099-01-01T00:00:00.000Z'})
REMOTE=['implementation','dependency_preparation','indexing','build','test','reproduction','review_execution','integration','installation','upgrade','self_development']
with tempfile.TemporaryDirectory(prefix='hyperfide-placement-') as folder:
 base=pathlib.Path(folder);components=base/'components';components.mkdir()
 for task in ['1.1','4.2','6.1']:shutil.copyfile(ROOT/f'services/hyperfide/components/{task}.json',components/f'{task}.json')
 (base/'policy.json').write_text(json.dumps(POLICY))
 def invoke(job='supervision',tool='supervise',host='main',profile=None,payload=None,action='placement.check',trusted=True,binding=None):
  (base/'placement.json').write_text(json.dumps(PROFILE if profile is None else profile));env=os.environ.copy()
  if trusted:
   env['HF_PLACEMENT_POLICY_FILE']=str(base/'placement.json');env['HF_EXECUTION_HOST_BINDING']=json.dumps({'host_id':'fixture-main' if host=='main' else 'fixture-remote','kind':'SUPERVISORY' if host=='main' else 'REMOTE','boot_generation':'1'})
  else:
   env.pop('HF_PLACEMENT_POLICY_FILE',None);env.pop('HF_EXECUTION_HOST_BINDING',None)
  if binding is not None:env['HF_EXECUTION_HOST_BINDING']=json.dumps(binding)
  result=subprocess.run(['node',str(ROOT/'services/hyperfide/dist/control.js'),'--policy',str(base/'policy.json'),'--spec-revision','fixture-revision',
   '--components',str(components),'--module-root',str(ROOT/'services/hyperfide/dist')],input=json.dumps({'id':'placement','component':'1.1',
   'action':action,'input':{'job_class':job,'tool':tool} if payload is None else payload})+'\n',text=True,capture_output=True,env=env,timeout=15,cwd=ROOT)
  rows=[json.loads(line) for line in (result.stdout+'\n'+result.stderr).splitlines() if line.strip()]
  expect(len(rows)==1,'missing bounded service result');return rows[0]
 def accepted(**kw):
  row=invoke(**kw);expect(row.get('ok') is True,str(row));return row['result']
 def rejected(**kw):expect(invoke(**kw).get('ok') is False,'unsafe placement accepted')
 for job in REMOTE:
  check('placement.main.deny.'+job,lambda job=job:rejected(job=job,tool='native.spawn'))
  check('placement.remote.accept.'+job,lambda job=job:expect(accepted(job=job,tool='native.spawn',host='remote')['location']=='REMOTE_EXECUTION'))
 for job,tool in [('supervision','supervise'),('control','state.query'),('source_inspection','source.read'),('graph_query','graph.query'),('context_composition','graph.query')]:
  check('placement.main.allow.'+job,lambda job=job,tool=tool:expect(accepted(job=job,tool=tool)['location']=='LOCAL_SUPERVISION'))
 for tool in ['native.shell','native.file.write','native.spawn','native.process.stop']:
  check('placement.main.disguised.'+tool,lambda tool=tool:rejected(job='source_inspection',tool=tool))
 check('placement.static.no-authority',lambda:expect(accepted()['authority']=='NONE' and accepted()['execution']=='NOT_STARTED'))
 for label,payload in [('host-override',{'job_class':'supervision','tool':'supervise','host_id':'remote'}),('kind-override',{'job_class':'build','tool':'native.spawn','kind':'REMOTE'}),
  ('unknown-job',{'job_class':'magic','tool':'supervise'}),('unknown-tool',{'job_class':'supervision','tool':'anything'}),('numeric-job',{'job_class':1,'tool':'supervise'})]:
  check('placement.reject.'+label,lambda payload=payload:rejected(payload=payload))
 for label,path,value in [('unqualified',['restrictions','qualification'],'UNQUALIFIED'),('expired',['restrictions','expires_at'],'2000-01-01T00:00:00Z'),
  ('evidence',['restrictions','evidence_digest'],'none'),('spec',['spec_revision'],'changed'),('policy',['policy_revision'],2)]:
  def negative(path=path,value=value):
   profile=copy.deepcopy(PROFILE);target=profile
   for key in path[:-1]:target=target[key]
   target[path[-1]]=value;rejected(profile=profile)
  check('placement.reject.'+label,negative)
 for label,binding in [('main-kind',{'host_id':'fixture-main','kind':'REMOTE','boot_generation':'1'}),('remote-kind',{'host_id':'fixture-remote','kind':'SUPERVISORY','boot_generation':'1'}),('numeric-boot',{'host_id':'fixture-main','kind':'SUPERVISORY','boot_generation':1}),('overflow-boot',{'host_id':'fixture-main','kind':'SUPERVISORY','boot_generation':'9223372036854775808'})]:
  check('placement.binding.reject-'+label,lambda binding=binding:rejected(binding=binding))
 for label,expiry in [('impossible-calendar','2099-02-30T00:00:00.000Z'),('noncanonical','2099-01-01T00:00:00Z')]:
  def bad_expiry(expiry=expiry):
   config=copy.deepcopy(PROFILE);config['restrictions']['expires_at']=expiry;rejected(profile=config)
  check('placement.restrictions.reject-'+label,bad_expiry)
 check('placement.reject.missing-trusted-config',lambda:rejected(trusted=False))
 check('placement.authority.reject-unauthenticated',lambda:rejected(action='placement.authorize'))
 for action in ['runner.slot.prepare','runner.agent.launch','runner.inspect','runner.stop']:
  check('placement.runner.reject-unauthenticated.'+action,lambda action=action:rejected(action='placement.runner.authorize',payload={'runner_action':action}))
 check('placement.runner.reject-override',lambda:rejected(action='placement.runner.authorize',payload={'runner_action':'runner.agent.launch','job_class':'source_inspection'}))
 check('placement.runner.reject-unknown',lambda:rejected(action='placement.runner.authorize',payload={'runner_action':'arbitrary'}))

# This fixture uses production TLS, Ed25519 proofs, enrollment, primary guards and the real outbox.
# Restriction qualification metadata remains a contract fixture; this does not qualify native OS policy.
import sys
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,uid as fresh_uuid,sha as byte_sha

def authenticated_checks():
 def setup(f):
  config=copy.deepcopy(PROFILE);config.update(programme_id=f.ids['run'],spec_revision='fixture-identity-v1')
  path=f.path/'placement.json';path.write_text(json.dumps(config));f.env['HF_PLACEMENT_POLICY_FILE']=str(path)
  f.ids['consumer']=fresh_uuid()
  f.sql("INSERT INTO hyperfide.event_consumers(organisation_id,run_id,id,consumer_key) VALUES($1,$2,$3,'placement-runner')",[f.ids['organisation'],f.ids['run'],f.ids['consumer']])
 f=IdentityFixture(extra_components=('6.1','1.1'),extra_setup=setup)
 fixture_path=f.path;database=f.database
 def call(action,payload,key='provisioner',credential=None):
  kwargs={} if credential is None else {'credential':credential}
  return f.invoke(action,payload,component='1.1',key=key,**kwargs)[1]
 def ok(action,payload,**kwargs):
  response=call(action,payload,**kwargs);expect(response.get('ok') is True,str(response));return response['result']
 def no(action,payload,**kwargs):expect(call(action,payload,**kwargs).get('ok') is False,'unsafe signed operation accepted')
 try:
  def forged_invocation():
   program="""import fs from 'node:fs';
import {createComponent} from './services/hyperfide/dist/policy/placement.js';
import {createResourceContainer} from './services/hyperfide/dist/storage/runtime.js';
const signal=new AbortController().signal;
const ctx={role:'control',policy:JSON.parse(fs.readFileSync(process.env.HF_NEGATIVE_POLICY_FILE,'utf8')),signal,env:process.env};
const resources=createResourceContainer(ctx);let guardCalls=0;
const component=createComponent({...ctx,resources,dependencies:{require(){throw Error('unexpected dependency')}}});
try {
 await resources.gateway.withPrimaryTransaction({timeoutMs:5000},async tx=>{
  const fake={principal:JSON.parse(process.env.HF_NEGATIVE_PRINCIPAL),guard:async()=>{guardCalls++;}};
  try {await component.capabilities['policy.placement.v1'].authorize(tx,fake,{job_class:'supervision',tool:'state.query'});throw Error('forged authority admitted');}
  catch(error){if(error.code!=='AUTH_REQUIRED')throw error;}
 });
 if(guardCalls!==0)throw Error('untrusted caller guard executed');
 console.log(JSON.stringify({refused:true,forged_guard_calls:0}));
} finally {await resources.close();}
"""
   env=f.env.copy();env['HF_NEGATIVE_POLICY_FILE']=str(f.policy);env['HF_NEGATIVE_PRINCIPAL']=json.dumps({'actor_id':f.ids['operator'],'organisation_id':f.ids['organisation'],'run_id':f.ids['run'],'role':'COORDINATOR','deployment_epoch':f.ids['epoch'],'sandbox_id':None,'boot_id':None,'boot_generation':None,'allowed_actions':['placement.authorize']})
   result=subprocess.run(['node','--input-type=module','-e',program],cwd=ROOT,env=env,text=True,capture_output=True,timeout=15)
   expect(result.returncode==0 and json.loads(result.stdout)=={'refused':True,'forged_guard_calls':0},'structural invocation forged authority: '+result.stderr[:500])
  check('placement.auth.forged-invocation-refused',forged_invocation)
  check('placement.https.manager-local-denied',lambda:no('placement.authorize',{'job_class':'build','tool':'native.spawn'}))
  check('placement.https.operator-cannot-delegate',lambda:no('placement.delegate',{'job_id':fresh_uuid(),'idempotency_key':'operator-denied','job_class':'implementation','tool':'native.spawn','target_sandbox_id':f.ids['sandbox'],'boot_generation':'1','packet_digest':digest('packet')},key='operator'))
  check('placement.https.provider-binding',lambda:expect(f.bind()[1].get('ok') is True,'provider observation refused'))
  grant={'grant_id':f.grant,'provisioning_intent_id':f.ids['intent'],'verifier':byte_sha(f.secret),
   'allowed_actions':['identity.describe','placement.authorize','placement.runner.authorize'],'ttl_seconds':300}
  issued=f.invoke('identity.grant.issue',grant)[1];expect(issued.get('ok') is True,str(issued))
  enrolled=f.request(f.enrollment(),key='runner',endpoint='/v1/enroll',credential=f.grant)[1];expect(enrolled.get('ok') is True,str(enrolled))
  credential=enrolled['result']['credential_id']
  check('placement.https.real-enrollment',lambda:expect(isinstance(credential,str)))
  for runner_action,job,tool in [('runner.test.execute','test','native.spawn'),('runner.review.execute','review_execution','native.spawn'),('runner.integration.execute','integration','native.spawn'),('runner.index.execute','indexing','native.spawn'),('runner.build.execute','build','native.spawn'),('runner.preparation.execute','dependency_preparation','native.spawn'),('runner.slot.prepare','dependency_preparation','native.file.write'),('runner.agent.launch','implementation','native.spawn'),('runner.inspect','supervision','state.query'),('runner.stop','control','native.process.stop')]:
   def admitted(runner_action=runner_action,job=job,tool=tool):
    result=ok('placement.runner.authorize',{'runner_action':runner_action},key='runner',credential=credential)
    expect(result['runner_action']==runner_action and result['job_class']==job and result['tool']==tool and result['host_id']==f.ids['sandbox'] and result['boot_generation']=='1' and result['location']=='REMOTE_EXECUTION','registered action or host binding changed')
    expect(result['authority']=='PLACEMENT_ONLY' and result['execution_started'] is False and result['capacity_reserved'] is False,'placement fabricated execution/capacity')
   check('placement.https.registered.'+runner_action,admitted)
  f.sql("UPDATE hyperfide.runs SET state='PAUSED',state_version=state_version+1 WHERE id=$1",[f.ids['run']])
  check('placement.https.quiescent-stop',lambda:expect(ok('placement.runner.authorize',{'runner_action':'runner.stop'},key='runner',credential=credential)['tool']=='native.process.stop'))
  check('placement.https.quiescent-start-denied',lambda:no('placement.runner.authorize',{'runner_action':'runner.agent.launch'},key='runner',credential=credential))
  check('placement.https.quiescent-prepare-denied',lambda:no('placement.runner.authorize',{'runner_action':'runner.slot.prepare'},key='runner',credential=credential))
  f.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE id=$1",[f.ids['run']])
  check('placement.https.host-spoof-refused',lambda:no('placement.runner.authorize',{'runner_action':'runner.agent.launch','host_id':'fixture-main'},key='runner',credential=credential))
  request={'job_id':fresh_uuid(),'idempotency_key':'one-remote-job','job_class':'implementation','tool':'native.spawn','target_sandbox_id':f.ids['sandbox'],'boot_generation':'1','packet_digest':digest('packet')}
  first=ok('placement.delegate',request)
  check('placement.https.durable-delegation',lambda:expect(first['status']=='ENQUEUED' and first['delivery_obligations']==1 and first['execution_started'] is False))
  second=ok('placement.delegate',request)
  check('placement.https.idempotent-replay',lambda:expect(second['replayed'] is True and second['event_id']==first['event_id']))
  persisted=f.sql("SELECT e.payload,d.consumer_id FROM hyperfide.outbox_events e JOIN hyperfide.event_deliveries d ON d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id WHERE e.id=$1",[first['event_id']])
  check('placement.https.real-delivery',lambda:expect(len(persisted)==1 and persisted[0]['consumer_id']==f.ids['consumer'] and persisted[0]['payload']['placement']['host_id']==f.ids['sandbox']))
  def envelope_binding():
   value=dict(request,job_id=fresh_uuid(),idempotency_key='envelope-job')
   operation=f.operation('1.1','placement.delegate',value)
   first=f.request(operation,key='provisioner')[1];expect(first.get('ok') is True,str(first))
   repeat=f.request(operation,key='provisioner')[1];expect(repeat.get('ok') is True and repeat['result']['event_id']==first['result']['event_id'],'exact signed envelope replay changed event')
   changed=f.operation('1.1','placement.delegate',dict(value,job_id=fresh_uuid(),idempotency_key='fresh-inner-key',packet_digest=digest('changed-envelope')))
   changed.update(idempotency_key=operation['idempotency_key'],operation_id=operation['operation_id'])
   rejected=f.request(changed,key='provisioner')[1]
   expect(rejected.get('ok') is False and rejected.get('error',{}).get('code')=='IDEMPOTENCY_CONFLICT','fresh inner key bypassed signed envelope binding')
   count=f.sql("SELECT count(*)::int AS n FROM hyperfide.outbox_events WHERE payload->>'job_id'=$1",[value['job_id']])[0]['n']
   expect(count==1,'envelope replay duplicated durable event')
  check('placement.https.envelope-replay-binding',envelope_binding)
  check('placement.https.conflicting-replay',lambda:no('placement.delegate',dict(request,packet_digest=digest('changed-packet'))))
  check('placement.https.stale-target-boot',lambda:no('placement.delegate',dict(request,idempotency_key='stale-boot',boot_generation='2')))
  check('placement.https.numeric-boot',lambda:no('placement.delegate',dict(request,idempotency_key='numeric-boot',boot_generation=1)))
  f.sql("UPDATE hyperfide.provider_pools SET state='DISABLED',state_version=state_version+1 WHERE id=$1",[f.ids['pool']])
  check('placement.https.disabled-provider',lambda:no('placement.delegate',dict(request,idempotency_key='disabled-provider')))
  f.sql("UPDATE hyperfide.provider_pools SET state='ACTIVE',state_version=state_version+1 WHERE id=$1",[f.ids['pool']])
  f.sql("UPDATE hyperfide.sandboxes SET boot_generation=boot_generation+1,state_version=state_version+1 WHERE id=$1",[f.ids['sandbox']])
  check('placement.https.old-runner-fenced',lambda:no('placement.runner.authorize',{'runner_action':'runner.agent.launch'},key='runner',credential=credential))
  check('placement.https.old-target-fenced',lambda:no('placement.delegate',dict(request,idempotency_key='obsolete-target')))
 finally:
  f.close()
  absent=f.sql('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[database],admin=True)[0]['n']==0
  expect(absent and not fixture_path.exists() and f.child is None,'authenticated fixture did not fully clean up')
check('placement.https.integration',authenticated_checks)


def supervisor_checks():
 def setup(f):
  migration=(ROOT/'services/hyperfide/migrations/0003-hierarchy.sql').read_bytes()
  f.sql("BEGIN;"+migration.decode()+";INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES(3,'0003-hierarchy','"+byte_sha(migration)+"');COMMIT;")
  config=copy.deepcopy(PROFILE);config.update(programme_id=f.ids['run'],spec_revision='fixture-identity-v1')
  f.profile_path=f.path/'supervisor-placement.json';f.profile_path.write_text(json.dumps(config));f.env['HF_PLACEMENT_POLICY_FILE']=str(f.profile_path)
  f.env['HF_EXECUTION_HOST_BINDING']=json.dumps({'host_id':'fixture-main','kind':'SUPERVISORY','boot_generation':'7'})
  identity=json.loads(f.identity_config.read_text())
  from identity_fixture import b64
  for key,role in [('leader','LEADER'),('successor','LEADER'),('manager','FEATURE_MANAGER'),('watcher','COMMIT_WATCHER')]:
   ident=fresh_uuid();f.ids[key]=ident;path=f.path/(key+'.pem')
   subprocess.run(['openssl','genpkey','-algorithm','Ed25519','-out',str(path)],check=True,capture_output=True);path.chmod(0o600)
   public=subprocess.check_output(['openssl','pkey','-in',str(path),'-pubout','-outform','DER'],stderr=subprocess.DEVNULL)
   f.keys[key]={'path':path,'public_key_b64':b64(public[-32:])}
   f.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id) VALUES($1,$2,$3,$4,'fixture','fixture',$5)",[f.ids['organisation'],f.ids['run'],ident,role,'native-'+key])
   if role in ['LEADER','FEATURE_MANAGER']:identity['principals'].append(dict(identity['principals'][0],credential_id=ident,actor_id=ident,role=role,public_key_b64=f.keys[key]['public_key_b64']))
  f.identity_config.write_text(json.dumps(identity));f.ids['package']=fresh_uuid()
  f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'feature:supervisor:wave:1',1)",[f.ids['organisation'],f.ids['run'],f.ids['package']])
 f=IdentityFixture(extra_components=('3.1','6.1','1.1'),extra_setup=setup);path=f.path;database=f.database
 def call(action,payload,key='leader',component='1.1'):return f.invoke(action,payload,key=key,component=component)[1]
 def ok(action,payload,**kwargs):
  value=call(action,payload,**kwargs);expect(value.get('ok') is True,str(value));return value['result']
 def no(payload,**kwargs):expect(call('placement.supervisor.authorize',payload,**kwargs).get('ok') is False,'invalid main session admitted')
 try:
  ok('hierarchy.leader.acquire',{'idempotency_key':'supervisor-leader','expected_generation':'0','reason':'Main leader placement fixture'},component='3.1')
  ok('hierarchy.package.configure',{'idempotency_key':'supervisor-package','leader_generation':'1','package_id':f.ids['package'],'feature_key':'supervisor','allocation_policy':'FEATURE_STABLE'},component='3.1')
  ok('hierarchy.package.assign',{'idempotency_key':'supervisor-assignment','leader_generation':'1','package_id':f.ids['package'],'expected_generation':'1','manager_session_id':f.ids['manager']},component='3.1')
  leader={'session_id':f.ids['leader'],'leader_generation':'1','package_id':None,'package_generation':None}
  manager={'session_id':f.ids['manager'],'leader_generation':'1','package_id':f.ids['package'],'package_generation':'2'}
  def authorised(request,key,role):
   result=ok('placement.supervisor.authorize',request,key=key)
   expect(result['location']=='LOCAL_SUPERVISION' and result['tool']=='supervisor.session.launch' and result['job_class']=='supervision')
   expect(result['supervisor_session_id']==request['session_id'] and result['supervisor_role']==role and result['boot_generation']=='7')
   expect(result['authority']=='PLACEMENT_ONLY' and result['capacity_reserved'] is False and result['execution_started'] is False,'placement claimed native launch or main budget')
   expect(result['restriction_profile_digest']==PROFILE['restrictions']['profile_digest'] and result['restriction_evidence_digest']==PROFILE['restrictions']['evidence_digest'])
  check('placement.supervisor.current-leader-plan',lambda:authorised(leader,'operator','LEADER'))
  check('placement.supervisor.owned-manager-plan',lambda:authorised(manager,'leader','FEATURE_MANAGER'))
  check('placement.supervisor.generic-spawn-denied',lambda:expect(call('placement.authorize',{'job_class':'supervision','tool':'native.spawn'}).get('ok') is False))
  check('placement.supervisor.unbound-special-tool-denied',lambda:expect(call('placement.authorize',{'job_class':'supervision','tool':'supervisor.session.launch'}).get('ok') is False))
  check('placement.supervisor.operator-cannot-manage-workers',lambda:no(manager,key='operator'))
  check('placement.supervisor.provisioner-cannot-launch-main',lambda:no(leader,key='provisioner'))
  check('placement.supervisor.stale-manager-owner',lambda:no(dict(manager,package_generation='1')))
  check('placement.supervisor.stale-leader-generation',lambda:no(dict(manager,leader_generation='2')))
  check('placement.supervisor.noncurrent-leader',lambda:no(dict(leader,session_id=f.ids['successor']),key='operator'))
  check('placement.supervisor.watcher-not-manager',lambda:no(dict(leader,session_id=f.ids['watcher'])))
  check('placement.supervisor.role-label-spoof',lambda:no(dict(manager,role='LEADER')))
  f.sql("UPDATE hyperfide.agent_sessions SET state='RUNNING',state_version=state_version+1 WHERE id=$1",[f.ids['manager']])
  check('placement.supervisor.already-running-denied',lambda:no(manager))
  f.sql("UPDATE hyperfide.agent_sessions SET state='REGISTERED',state_version=state_version+1 WHERE id=$1",[f.ids['manager']])
  config=json.loads(f.profile_path.read_text());config['restrictions']['qualification']='UNQUALIFIED';f.profile_path.write_text(json.dumps(config))
  check('placement.supervisor.unqualified-restrictions-denied',lambda:no(manager))
 finally:
  f.close();absent=f.sql('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[database],admin=True)[0]['n']==0
  expect(absent and not path.exists() and f.child is None,'supervisor fixture cleanup incomplete')
check('placement.supervisor.integration',supervisor_checks)

print(json.dumps({'type':'cleanup','complete':not base.exists(),'resources':[]}),flush=True)
raise SystemExit(bool(FAILED))
