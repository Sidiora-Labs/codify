#!/usr/bin/env python3
"""Registered placement checks exercise actual service dispatch; this bounded suite does not claim OS restriction qualification."""
import copy,hashlib,json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[4];FAILED=[]
def check(name,fn):
 try:fn();actual='observed'
 except Exception as error:actual=type(error).__name__+': '+str(error);FAILED.append(name)
 print(json.dumps({'type':'assertion','id':name,'expected':'observed','actual':actual}),flush=True)
def expect(ok,message='unexpected service outcome'):
 if not ok:raise AssertionError(message)
def digest(text):return 'sha256:'+hashlib.sha256(text.encode()).hexdigest()
# programme_id/spec_revision are replaced by each fixture's approved run identity.
PROFILE={'schema_version':1,'programme_id':'fixture-run','repository':'fixture/repository','spec_revision':'fixture-revision','policy_revision':1}
PROFILE.update(supervisory_host_id='fixture-main',restrictions={'profile_digest':digest('restricted-native-profile'),
 'evidence_digest':digest('contract-fixture'),'qualification':'QUALIFIED','expires_at':'2099-01-01T00:00:00.000Z'})
REMOTE=['implementation','dependency_preparation','indexing','build','test','reproduction','review_execution','integration','installation','upgrade','self_development']
SUPERVISORY=['supervision','control','source_inspection','graph_query','context_composition']
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,uid as fresh_uuid,sha as byte_sha
CLEANED=[]
def profile_for(f):
 config=copy.deepcopy(PROFILE);config.update(programme_id=f.ids['run'],spec_revision='fixture-identity-v1');return config
def binding(host='main',boot='1'):
 return json.dumps({'host_id':'fixture-main' if host=='main' else 'fixture-remote','kind':'SUPERVISORY' if host=='main' else 'REMOTE','boot_generation':boot})
def closed(f,path,database):
 absent=f.sql('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[database],admin=True)[0]['n']==0
 CLEANED.append(absent and not path.exists() and f.child is None);expect(CLEANED[-1],'fixture cleanup incomplete')

# Dry-run placement decisions through the registered component behind production signed HTTPS (14.1 is loaded, so
# stdio dispatch would be AUTH_REQUIRED). Host bindings are trusted startup configuration: each variant restarts the service.
def static_checks():
 def setup(f):
  f.placement=f.path/'placement.json';f.placement.write_text(json.dumps(profile_for(f)))
  f.env['HF_PLACEMENT_POLICY_FILE']=str(f.placement);f.env['HF_EXECUTION_HOST_BINDING']=binding()
 f=IdentityFixture(extra_components=('6.1','1.1'),extra_setup=setup);path=f.path;database=f.database
 def restart(value):
  f.stop()
  if value is None:f.env.pop('HF_EXECUTION_HOST_BINDING',None);f.env.pop('HF_PLACEMENT_POLICY_FILE',None)
  else:f.env['HF_EXECUTION_HOST_BINDING']=value;f.env['HF_PLACEMENT_POLICY_FILE']=str(f.placement)
  f.start()
 def invoke(job='supervision',tool='supervise',profile=None,payload=None,action='placement.check',credential=None):
  f.placement.write_text(json.dumps(profile_for(f) if profile is None else profile))
  kwargs={} if credential is None else {'credential':credential}
  return f.invoke(action,{'job_class':job,'tool':tool} if payload is None else payload,component='1.1',key='operator',**kwargs)[1]
 def accepted(**kw):
  row=invoke(**kw);expect(row.get('ok') is True,str(row));return row['result']
 def rejected(code='PLACEMENT_DENIED',**kw):
  row=invoke(**kw);actual=row.get('error',{}).get('code','')
  expect(row.get('ok') is False and (actual.startswith('AUTH_') if code=='AUTH' else actual==code),'unsafe placement accepted or refused for another reason: '+str(row)[:300])
 try:
  for job in REMOTE:check('placement.main.deny.'+job,lambda job=job:rejected(job=job,tool='native.spawn'))
  for job,tool in [('supervision','supervise'),('control','state.query'),('source_inspection','source.read'),('graph_query','graph.query'),('context_composition','graph.query')]:
   check('placement.main.allow.'+job,lambda job=job,tool=tool:expect(accepted(job=job,tool=tool)['location']=='LOCAL_SUPERVISION'))
  for tool in ['native.shell','native.file.write','native.spawn','native.process.stop']:
   check('placement.main.disguised.'+tool,lambda tool=tool:rejected(job='source_inspection',tool=tool))
  check('placement.static.no-authority',lambda:expect(accepted()['authority']=='NONE' and accepted()['execution']=='NOT_STARTED'))
  for label,payload in [('host-override',{'job_class':'supervision','tool':'supervise','host_id':'remote'}),('kind-override',{'job_class':'build','tool':'native.spawn','kind':'REMOTE'}),
   ('unknown-job',{'job_class':'magic','tool':'supervise'}),('unknown-tool',{'job_class':'supervision','tool':'anything'}),('numeric-job',{'job_class':1,'tool':'supervise'})]:
   check('placement.reject.'+label,lambda payload=payload:rejected(payload=payload))
  for label,keys,value in [('unqualified',['restrictions','qualification'],'UNQUALIFIED'),('expired',['restrictions','expires_at'],'2000-01-01T00:00:00Z'),
   ('evidence',['restrictions','evidence_digest'],'none'),('spec',['spec_revision'],'changed'),('policy',['policy_revision'],2)]:
   def negative(keys=keys,value=value):
    config=profile_for(f);target=config
    for key in keys[:-1]:target=target[key]
    target[keys[-1]]=value;rejected(profile=config)
   check('placement.reject.'+label,negative)
  for label,expiry in [('impossible-calendar','2099-02-30T00:00:00.000Z'),('noncanonical','2099-01-01T00:00:00Z')]:
   def bad_expiry(expiry=expiry):
    config=profile_for(f);config['restrictions']['expires_at']=expiry;rejected(profile=config)
   check('placement.restrictions.reject-'+label,bad_expiry)
  forged=fresh_uuid()
  check('placement.authority.reject-unauthenticated',lambda:rejected(code='AUTH',action='placement.authorize',credential=forged))
  for action in ['runner.slot.prepare','runner.agent.launch','runner.inspect','runner.stop']:
   check('placement.runner.reject-unauthenticated.'+action,lambda action=action:rejected(code='AUTH',action='placement.runner.authorize',payload={'runner_action':action},credential=forged))
  check('placement.runner.reject-override',lambda:rejected(action='placement.runner.authorize',payload={'runner_action':'runner.agent.launch','job_class':'source_inspection'}))
  check('placement.runner.reject-unknown',lambda:rejected(action='placement.runner.authorize',payload={'runner_action':'arbitrary'}))
  restart(binding('remote'))
  for job in REMOTE:check('placement.remote.accept.'+job,lambda job=job:expect(accepted(job=job,tool='native.spawn')['location']=='REMOTE_EXECUTION'))
  for label,value in [('main-kind',{'host_id':'fixture-main','kind':'REMOTE','boot_generation':'1'}),('remote-kind',{'host_id':'fixture-remote','kind':'SUPERVISORY','boot_generation':'1'}),('numeric-boot',{'host_id':'fixture-main','kind':'SUPERVISORY','boot_generation':1}),('overflow-boot',{'host_id':'fixture-main','kind':'SUPERVISORY','boot_generation':'9223372036854775808'})]:
   def bad_binding(value=value):restart(json.dumps(value));rejected()
   check('placement.binding.reject-'+label,bad_binding)
  def missing():restart(None);rejected()
  check('placement.reject.missing-trusted-config',missing)
 finally:
  f.close();closed(f,path,database)
check('placement.static.integration',static_checks)

# This fixture uses production TLS, Ed25519 proofs, enrollment, primary guards and the real outbox.
# Restriction qualification metadata remains a contract fixture; this does not qualify native OS policy.

def authenticated_checks():
 def setup(f):
  path=f.path/'placement.json';path.write_text(json.dumps(profile_for(f)));f.env['HF_PLACEMENT_POLICY_FILE']=str(path)
  f.env['HF_EXECUTION_HOST_BINDING']=binding('main','3')
  # An unrelated standing consumer must not receive host-addressed jobs.
  f.ids['consumer']=fresh_uuid()
  f.sql("INSERT INTO hyperfide.event_consumers(organisation_id,run_id,id,consumer_key) VALUES($1,$2,$3,'placement-runner')",[f.ids['organisation'],f.ids['run'],f.ids['consumer']])
 f=IdentityFixture(extra_components=('6.1','1.1'),extra_setup=setup)
 fixture_path=f.path;database=f.database
 def call(action,payload,key='provisioner',credential=None):
  kwargs={} if credential is None else {'credential':credential}
  return f.invoke(action,payload,component='1.1',key=key,**kwargs)[1]
 def ok(action,payload,**kwargs):
  response=call(action,payload,**kwargs);expect(response.get('ok') is True,str(response));return response['result']
 def no(action,payload,**kwargs):
  response=call(action,payload,**kwargs);expect(response.get('ok') is False,'unsafe signed operation accepted');return response.get('error',{})
 def restart(boot,host='main'):
  f.stop();f.env['HF_EXECUTION_HOST_BINDING']=binding(host,boot) if host in ('main','remote') else json.dumps({'host_id':host,'kind':'SUPERVISORY','boot_generation':boot});f.start()
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
  manager=f.add_principal('manager','FEATURE_MANAGER')
  check('placement.https.manager-local-denied',lambda:expect('remotely' in no('placement.authorize',{'job_class':'build','tool':'native.spawn'},key='manager').get('message',''),'manager local build was not refused by placement'))
  check('placement.https.manager-supervision-bound',lambda:expect(ok('placement.authorize',{'job_class':'supervision','tool':'state.query'},key='manager')['boot_generation']=='3','supervisory placement not bound to the trusted boot'))
  check('placement.https.operator-cannot-delegate',lambda:no('placement.delegate',{'job_id':fresh_uuid(),'idempotency_key':'operator-denied','job_class':'implementation','tool':'native.spawn','target_sandbox_id':f.ids['sandbox'],'boot_generation':'1','packet_digest':digest('packet')},key='operator'))
  check('placement.https.provider-binding',lambda:expect(f.bind()[1].get('ok') is True,'provider observation refused'))
  grant={'grant_id':f.grant,'provisioning_intent_id':f.ids['intent'],'verifier':byte_sha(f.secret),
   'allowed_actions':['identity.describe','placement.authorize','placement.runner.authorize','placement.remote.claim','placement.remote.complete','placement.exec.request'],'ttl_seconds':300}
  issued=f.invoke('identity.grant.issue',grant)[1];expect(issued.get('ok') is True,str(issued))
  enrolled=f.request(f.enrollment(),key='runner',endpoint='/v1/enroll',credential=f.grant)[1];expect(enrolled.get('ok') is True,str(enrolled))
  credential=enrolled['result']['credential_id'];runner_actor=enrolled['result']['actor_id']
  check('placement.https.real-enrollment',lambda:expect(isinstance(credential,str)))
  for runner_action,job,tool in [('runner.test.execute','test','native.spawn'),('runner.review.execute','review_execution','native.spawn'),('runner.integration.execute','integration','native.spawn'),('runner.index.execute','indexing','native.spawn'),('runner.build.execute','build','native.spawn'),('runner.preparation.execute','dependency_preparation','native.spawn'),('runner.slot.prepare','dependency_preparation','native.file.write'),('runner.agent.launch','implementation','native.spawn'),('runner.inspect','supervision','state.query'),('runner.stop','control','native.process.stop')]:
   def admitted(runner_action=runner_action,job=job,tool=tool):
    result=ok('placement.runner.authorize',{'runner_action':runner_action},key='runner',credential=credential)
    expect(result['runner_action']==runner_action and result['job_class']==job and result['tool']==tool and result['host_id']==f.ids['sandbox'] and result['boot_generation']=='1' and result['location']=='REMOTE_EXECUTION','registered action or host binding changed')
    expect(result['authority']=='PLACEMENT_ONLY' and result['execution_started'] is False and result['capacity_reserved'] is False,'placement fabricated execution/capacity')
   check('placement.https.registered.'+runner_action,admitted)
  f.sql("UPDATE hyperfide.runs SET state='PAUSED',state_version=state_version+1 WHERE id=$1",[f.ids['run']])
  check('placement.https.quiescent-runner-fenced',lambda:expect(no('placement.runner.authorize',{'runner_action':'runner.stop'},key='runner',credential=credential).get('code')=='AUTH_RUN_CLOSED','paused run admitted runner work'))
  check('placement.https.quiescent-start-denied',lambda:no('placement.runner.authorize',{'runner_action':'runner.agent.launch'},key='runner',credential=credential))
  check('placement.https.quiescent-prepare-denied',lambda:no('placement.runner.authorize',{'runner_action':'runner.slot.prepare'},key='runner',credential=credential))
  f.sql("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE id=$1",[f.ids['run']])
  check('placement.https.host-spoof-refused',lambda:no('placement.runner.authorize',{'runner_action':'runner.agent.launch','host_id':'fixture-main'},key='runner',credential=credential))
  request={'job_id':fresh_uuid(),'idempotency_key':'one-remote-job','job_class':'implementation','tool':'native.spawn','target_sandbox_id':f.ids['sandbox'],'boot_generation':'1','packet_digest':digest('packet')}
  first=ok('placement.delegate',request)
  check('placement.https.durable-delegation',lambda:expect(first['status']=='ENQUEUED' and first['delivery_obligations']==1 and first['execution_started'] is False))
  second=ok('placement.delegate',request)
  check('placement.https.idempotent-replay',lambda:expect(second['replayed'] is True and second['event_id']==first['event_id']))
  persisted=f.sql("SELECT e.payload,d.consumer_id,c.consumer_key FROM hyperfide.outbox_events e JOIN hyperfide.event_deliveries d ON d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id JOIN hyperfide.event_consumers c ON c.organisation_id=d.organisation_id AND c.run_id=d.run_id AND c.id=d.consumer_id WHERE e.id=$1",[first['event_id']])
  check('placement.https.real-delivery',lambda:expect(len(persisted)==1 and persisted[0]['consumer_key']=='placement-remote:'+f.ids['sandbox'] and persisted[0]['consumer_id']!=f.ids['consumer'] and persisted[0]['payload']['placement']['host_id']==f.ids['sandbox'],'job not addressed only to its host queue'))
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

  # Main-host execution gateway: a feature manager attempts each local job; the gateway refuses local execution and
  # re-routes it; the enrolled remote runner claims, actually executes, and reports attributed completion.
  executed={}
  def run_remote(expected_job):
   for _ in range(8):
    claimed=ok('placement.remote.claim',{'lease_ms':60000},key='runner',credential=credential)
    expect(claimed['status']=='CLAIMED','no delegated job reached the remote runner: '+str(claimed))
    expect(claimed['placement']['location']=='REMOTE_EXECUTION' and claimed['placement']['host_id']==f.ids['sandbox'],'claim placement not remote')
    script='import hashlib,json,os,sys;print(json.dumps({"job":sys.argv[1],"class":sys.argv[2],"packet":sys.argv[3],"pid":os.getpid()},sort_keys=True))'
    process=subprocess.run([sys.executable,'-I','-c',script,claimed['job_id'],claimed['job_class'],claimed['packet_digest']],capture_output=True,timeout=15)
    output='sha256:'+hashlib.sha256(process.stdout).hexdigest()
    done=ok('placement.remote.complete',{'event_id':claimed['event_id'],'attempt_count':claimed['attempt_count'],'exit_code':process.returncode,'output_digest':output},key='runner',credential=credential)
    executed[claimed['job_id']]={'output':output,'done':done,'claimed':claimed}
    if claimed['job_id']==expected_job:return done
   raise AssertionError('delegated job never reached the runner')
  for job in REMOTE:
   def delegated(job=job):
    job_id=fresh_uuid()
    result=ok('placement.exec.request',{'job_id':job_id,'idempotency_key':'local-'+job,'job_class':job,'tool':'native.spawn','packet_digest':digest('packet-'+job),'target_sandbox_id':f.ids['sandbox'],'boot_generation':'1'},key='manager')
    expect(result['decision']=='DENIED_LOCAL' and result['local_execution']=='DENIED' and result['host_id']=='fixture-main' and result['boot_generation']=='3','supervisory host admitted local '+job)
    expect(result['delegated_job_id']==job_id and result['delegated_host_id']==f.ids['sandbox'],'local attempt was not re-routed remotely')
    done=run_remote(job_id)
    expect(done['outcome']=='SUCCEEDED' and done['executed_host_id']==f.ids['sandbox'] and done['executor_actor_id']==runner_actor and done['requested_by']==manager['actor_id'],'remote completion lacks attribution')
    expect(done['origin']=='REROUTED_FROM_SUPERVISORY' and done['output_digest']==executed[job_id]['output'] and done['acknowledged'] is True,'completion evidence differs from observed execution')
   check('placement.exec.delegated.'+job,delegated)
  check('placement.exec.install-without-target-denied',lambda:expect(ok('placement.exec.request',{'job_id':fresh_uuid(),'idempotency_key':'install-no-target','job_class':'installation','tool':'native.shell','packet_digest':digest('install'),'target_sandbox_id':None,'boot_generation':None},key='manager')['delegated_job_id'] is None,'install had no destination yet was delegated'))
  check('placement.exec.disguised-read-denied',lambda:expect(ok('placement.exec.request',{'job_id':fresh_uuid(),'idempotency_key':'disguised','job_class':'source_inspection','tool':'native.shell','packet_digest':digest('disguised'),'target_sandbox_id':None,'boot_generation':None},key='manager')['decision']=='DENIED_LOCAL'))
  check('placement.exec.supervisory-read-admitted',lambda:expect(ok('placement.exec.request',{'job_id':fresh_uuid(),'idempotency_key':'inspect','job_class':'source_inspection','tool':'source.read','packet_digest':digest('inspect'),'target_sandbox_id':None,'boot_generation':None},key='manager')['location']=='LOCAL_SUPERVISION'))
  def exec_replay():
   value={'job_id':fresh_uuid(),'idempotency_key':'replayed-exec','job_class':'build','tool':'native.spawn','packet_digest':digest('replay'),'target_sandbox_id':f.ids['sandbox'],'boot_generation':'1'}
   one=ok('placement.exec.request',value,key='manager');two=ok('placement.exec.request',value,key='manager')
   expect(two['replayed'] is True and two['delegated_event_id']==one['delegated_event_id'],'gateway replay duplicated delegation')
   no('placement.exec.request',dict(value,packet_digest=digest('changed')),key='manager')
   run_remote(value['job_id'])
  check('placement.exec.idempotent-replay',exec_replay)
  check('placement.exec.remote-host-refused',lambda:no('placement.exec.request',{'job_id':fresh_uuid(),'idempotency_key':'runner-local','job_class':'build','tool':'native.spawn','packet_digest':digest('r'),'target_sandbox_id':None,'boot_generation':None},key='runner',credential=credential))
  check('placement.remote.main-host-cannot-claim',lambda:no('placement.remote.claim',{'lease_ms':60000},key='manager'))
  def completion_conflict():
   job_id=next(iter(executed));item=executed[job_id]
   no('placement.remote.complete',{'event_id':item['claimed']['event_id'],'attempt_count':item['claimed']['attempt_count'],'exit_code':1,'output_digest':item['output']},key='runner',credential=credential)
  check('placement.remote.completion-conflict',completion_conflict)
  def drained():
   while True:
    claimed=ok('placement.remote.claim',{'lease_ms':60000},key='runner',credential=credential)
    if claimed['status']=='EMPTY':return
    ok('placement.remote.complete',{'event_id':claimed['event_id'],'attempt_count':claimed['attempt_count'],'exit_code':0,'output_digest':digest('drain')},key='runner',credential=credential)
  check('placement.remote.queue-drained',drained)
  audit={}
  def audited():audit.update(ok('placement.audit',{},key='operator'))
  check('placement.audit.read',audited)
  check('placement.audit.main-host-supervision-only',lambda:expect(audit['violations']==[] and set(audit['main_host']['admitted_job_classes'])<=set(SUPERVISORY) and audit['main_host']['admitted_job_classes']!=[] and set(REMOTE)<=set(audit['main_host']['denied_job_classes']),'main host admitted non-supervisory work: '+json.dumps(audit.get('main_host'))[:500]))
  check('placement.audit.no-local-exec',lambda:expect(all(e['decision']=='DENIED_LOCAL' for e in audit['main_host']['entries'] if e['tool'] in ('native.shell','native.file.write','native.spawn')),'an execution tool was admitted on the main host'))
  def attribution():
   jobs={j['job_class']:j for j in audit['remote_jobs'] if j['origin']=='REROUTED_FROM_SUPERVISORY'}
   expect(set(REMOTE)<=set(jobs),'delegated class lacks remote job attribution')
   for job in REMOTE:
    j=jobs[job];expect(j['state']=='SUCCEEDED' and j['executed_host_id']==f.ids['sandbox']==j['target_host_id'] and j['executor_actor_id']==runner_actor and j['requested_by']==manager['actor_id'] and j['queue']=='placement-remote:'+f.ids['sandbox'],'attribution incomplete for '+job)
  check('placement.audit.remote-attribution',attribution)
  check('placement.audit.every-delegation-accounted',lambda:expect(len(audit['remote_jobs'])==f.sql("SELECT count(*)::int AS n FROM hyperfide.outbox_events WHERE aggregate_type='placement_job'")[0]['n'] and all(j['state']!='REQUESTED' for j in audit['remote_jobs']),'a delegated job is unaccounted or unsettled'))
  check('placement.audit.manager-refused',lambda:no('placement.audit',{},key='manager'))

  # Supervisory boot binding is trusted startup configuration fenced by the newest registered boot generation.
  def stale_boot():
   restart('2');error=no('placement.authorize',{'job_class':'supervision','tool':'state.query'},key='manager')
   expect('stale' in error.get('message',''),'older supervisory boot was admitted: '+str(error))
   no('placement.exec.request',{'job_id':fresh_uuid(),'idempotency_key':'stale-exec','job_class':'source_inspection','tool':'source.read','packet_digest':digest('s'),'target_sandbox_id':None,'boot_generation':None},key='manager')
  check('placement.host.stale-boot-generation',stale_boot)
  def newer_boot():
   restart('4');expect(ok('placement.authorize',{'job_class':'supervision','tool':'state.query'},key='manager')['boot_generation']=='4')
   restart('3');no('placement.authorize',{'job_class':'supervision','tool':'state.query'},key='manager')
   restart('4');expect(ok('placement.audit',{},key='operator')['boot_generations']==['3','4'],'boot register is not append-only')
  check('placement.host.newer-boot-fences-older',newer_boot)
  def foreign_host():
   restart('9','other-host');expect('supervisory host' in no('placement.authorize',{'job_class':'supervision','tool':'state.query'},key='manager').get('message',''))
   restart('9','remote');no('placement.authorize',{'job_class':'supervision','tool':'state.query'},key='manager')
   restart('4')
  check('placement.host.foreign-binding-refused',foreign_host)

  f.sql("UPDATE hyperfide.sandboxes SET boot_generation=boot_generation+1,state_version=state_version+1 WHERE id=$1",[f.ids['sandbox']])
  check('placement.https.old-runner-fenced',lambda:no('placement.runner.authorize',{'runner_action':'runner.agent.launch'},key='runner',credential=credential))
  check('placement.https.old-target-fenced',lambda:no('placement.delegate',dict(request,idempotency_key='obsolete-target')))
  check('placement.remote.old-runner-cannot-claim',lambda:no('placement.remote.claim',{'lease_ms':60000},key='runner',credential=credential))
 finally:
  f.close();closed(f,fixture_path,database)
check('placement.https.integration',authenticated_checks)


def supervisor_checks():
 def setup(f):
  f.apply_migration('0003-hierarchy')  # the complete trusted release is already migrated; verify its pin only
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
   if role in ['LEADER','FEATURE_MANAGER']:
    identity['principals'].append(dict(identity['principals'][0],credential_id=ident,actor_id=ident,role=role,public_key_b64=f.keys[key]['public_key_b64']))
    f.seed_fixture_principal(identity['principals'][-1])
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
  f.close();closed(f,path,database)
check('placement.supervisor.integration',supervisor_checks)

print(json.dumps({'type':'cleanup','complete':len(CLEANED)==3 and all(CLEANED),'resources':[]}),flush=True)
raise SystemExit(bool(FAILED))
