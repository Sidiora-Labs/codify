#!/usr/bin/env python3
"""Human programme routing through genuine TLS/Ed25519 authentication, hierarchy and PostgreSQL outbox."""
import copy,hashlib,json,os,pathlib,subprocess,sys,concurrent.futures
ROOT=pathlib.Path(__file__).resolve().parents[4];sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,uid,b64,sha
FAILED=[]
def expect(ok,message='unexpected human routing outcome'):
 if not ok:raise AssertionError(message)
def check(name,fn):
 try:fn();actual='observed'
 except Exception as error:actual=type(error).__name__+': '+str(error);FAILED.append(name)
 print(json.dumps({'type':'assertion','id':name,'expected':'observed','actual':actual}),flush=True)
ROUTINE=['schedule','provision','repair','retry','review','qualification']
EXECUTORS={'schedule':'scheduler.claim','provision':'programme.provision','repair':'finding.repair.request','retry':'programme.dispatch','review':'review.obligation.claim','qualification':'qualification.job.claim'}
class Unavailable:
 """A failed prerequisite; every dependent assertion reports it instead of aborting the probe."""
 def __init__(self,name,error):self.name=name;self.error=error
 def fail(self,*_):raise AssertionError('prerequisite '+self.name+' failed: '+self.error)
 __getitem__=get=__iter__=__eq__=__bool__=fail
def step(name,fn):
 try:return fn()
 except Exception as error:
  FAILED.append('step:'+name);detail=type(error).__name__+': '+str(error)[:500]
  print(json.dumps({'type':'diagnostic','step':name,'actual':detail}),file=sys.stderr,flush=True);return Unavailable(name,detail)
def setup(f):
 identity=json.loads(f.identity_config.read_text());actions=f.actions
 for key,role in [('leader','LEADER'),('successor','LEADER'),('manager','FEATURE_MANAGER')]:
  ident=uid();f.ids[key]=ident;path=f.path/(key+'.pem')
  subprocess.run(['openssl','genpkey','-algorithm','Ed25519','-out',str(path)],check=True,capture_output=True);path.chmod(0o600)
  public=subprocess.check_output(['openssl','pkey','-in',str(path),'-pubout','-outform','DER'],stderr=subprocess.DEVNULL)
  f.keys[key]={'path':path,'public_key_b64':b64(public[-32:])}
  f.sql('INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id) VALUES($1,$2,$3,$4,\'fixture\',\'fixture\',$5)',[f.ids['organisation'],f.ids['run'],ident,role,'native-'+key])
  record=dict(identity['principals'][0],credential_id=ident,actor_id=ident,role=role,public_key_b64=f.keys[key]['public_key_b64'],allowed_actions=actions);f.seed_fixture_principal(record);identity['principals'].append(record)
 f.identity_config.write_text(json.dumps(identity))
 f.ids['package']=uid();f.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'feature:fixture:wave:1',1)",[f.ids['organisation'],f.ids['run'],f.ids['package']])
 for key in ['leader_consumer','unrelated_consumer']+['routine_'+name for name in ROUTINE]:
  consumer_key=('session:'+f.ids['leader']+':human_intent') if key=='leader_consumer' else ('autonomous:routine.'+key[8:]) if key.startswith('routine_') else key
  f.ids[key]=uid();f.sql('INSERT INTO hyperfide.event_consumers(organisation_id,run_id,id,consumer_key) VALUES($1,$2,$3,$4)',[f.ids['organisation'],f.ids['run'],f.ids[key],consumer_key])
 f.ids['successor_consumer']=uid()
f=IdentityFixture(extra_components=('3.1','6.1','6.2','1.2'),extra_setup=setup,extra_actions=['routine.'+name for name in ROUTINE]+list(EXECUTORS.values()));fixture_path=f.path;database=f.database
try:
 def invoke(action,payload,key='operator',component='1.2'):
  return f.invoke(action,payload,key=key,component=component)[1]
 def ok(action,payload,**kwargs):
  response=invoke(action,payload,**kwargs);expect(response.get('ok') is True,str(response));return response['result']
 def no(action,payload,**kwargs):expect(invoke(action,payload,**kwargs).get('ok') is False,'unsafe intent accepted')
 def request(kind='INTENT',generation='1',package=False):
  return {'request_id':uid(),'idempotency_key':uid(),'expected_leader_generation':generation,'kind':kind,
   'package_id':f.ids['package'] if package else None,'package_generation':'2' if package else None,'payload':{'intent':'fixture intent'}}
 def deliveries(event):return f.sql('SELECT consumer_id FROM hyperfide.event_deliveries WHERE event_id=$1 ORDER BY consumer_id',[event])
 def bind(session,consumer):
  return ok('outbox.consumer.bind-session',{'organisation_id':f.ids['organisation'],'run_id':f.ids['run'],'session_id':session,'consumer_id':consumer,'namespace':'human_intent'},component='6.1')
 leader=step('leader',lambda:ok('hierarchy.leader.acquire',{'idempotency_key':'first-leader','expected_generation':'0','reason':'Initial signed leadership'},key='leader',component='3.1'))
 step('bind-leader-consumer',lambda:bind(f.ids['leader'],f.ids['leader_consumer']))
 check('human.describe.current-primary',lambda:expect(ok('human.describe',{})['leader_session_id']==f.ids['leader'] and ok('human.describe',{})['leader_generation']=='1'))
 check('human.describe.reject-body-scope',lambda:no('human.describe',{'run_id':uid()}))
 check('human.https.actual-primary-leader',lambda:expect(leader['leader_session_id']==f.ids['leader'] and leader['leader_generation']=='1'))
 step('configure-package',lambda:ok('hierarchy.package.configure',{'idempotency_key':'configure-package','leader_generation':'1','package_id':f.ids['package'],'feature_key':'fixture','allocation_policy':'FEATURE_STABLE'},key='leader',component='3.1'))
 assigned=step('assigned',lambda:ok('hierarchy.package.assign',{'idempotency_key':'assign-package','leader_generation':'1','package_id':f.ids['package'],'expected_generation':'1','manager_session_id':f.ids['manager']},key='leader',component='3.1'))
 check('human.https.actual-manager-ownership',lambda:expect(assigned['package_generation']=='2'))
 initial=request();submitted=step('submitted',lambda:ok('human.submit',initial))
 check('human.intent.primary-route',lambda:expect(submitted['status']=='ENQUEUED' and submitted['leader_session_id']==f.ids['leader'] and submitted['delivery_obligations']==1 and submitted['intent_authorized'] is False))
 check('human.intent.private-delivery',lambda:expect(deliveries(submitted['event_id'])==[{'consumer_id':f.ids['leader_consumer']}]))
 replay=step('replay',lambda:ok('human.submit',initial))
 check('human.intent.idempotent-replay',lambda:expect(replay['replayed'] is True and replay['event_id']==submitted['event_id']))
 check('human.intent.conflicting-replay',lambda:no('human.submit',dict(initial,payload={'intent':'changed'})))
 def concurrent_idempotence():
  value=request()
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:ok('human.submit',value),range(2)))
  expect(results[0]['event_id']==results[1]['event_id'] and sum(r['replayed'] for r in results)==1,'concurrent replay did not converge to one event')
  expect(len(deliveries(results[0]['event_id']))==1,'concurrent replay duplicated delivery')
 check('human.intent.concurrent-idempotence',concurrent_idempotence)
 def envelope_binding():
  value=request();operation=f.operation('1.2','human.submit',value)
  first=f.request(operation)[1];expect(first.get('ok') is True,str(first))
  repeat=f.request(operation)[1];expect(repeat.get('ok') is True and repeat['result']['event_id']==first['result']['event_id'],'exact signed envelope replay changed durable intent')
  changed=f.operation('1.2','human.submit',dict(value,idempotency_key=uid(),payload={'intent':'changed envelope'}))
  changed.update(idempotency_key=operation['idempotency_key'],operation_id=operation['operation_id'])
  refused=f.request(changed)[1];expect(refused.get('ok') is False and refused.get('error',{}).get('code')=='IDEMPOTENCY_CONFLICT','fresh inner intent key bypassed authenticated outer key')
  count=f.sql("SELECT count(*)::int AS n FROM hyperfide.outbox_events WHERE payload->>'request_id'=$1",[value['request_id']])[0]['n'];expect(count==1,'envelope replay duplicated intent event')
 check('human.intent.envelope-replay-binding',envelope_binding)
 check('human.intent.manager-cannot-submit',lambda:no('human.submit',request(package=True),key='manager'))
 for kind in ['CRITERIA','PROGRAMME_CHANGE']:
  def human_change(kind=kind):
   result=ok('human.submit',request(kind));expect(result['intent_authorized'] is False and result['leader_session_id']==f.ids['leader'])
   expect(deliveries(result['event_id'])==[{'consumer_id':f.ids['leader_consumer']}],'programme change reached a non-leader consumer')
  check('human.intent.'+kind.lower(),human_change)
 escalation=step('escalation',lambda:ok('human.escalate',request('UNRESOLVED_INTENT',package=True),key='manager'))
 check('human.escalation.manager-to-primary',lambda:expect(deliveries(escalation['event_id'])==[{'consumer_id':f.ids['leader_consumer']}]))
 check('human.escalation.criteria-denied',lambda:no('human.escalate',request('CRITERIA',package=True),key='manager'))
 check('human.escalation.package-required',lambda:no('human.escalate',request('UNRESOLVED_INTENT'),key='manager'))
 stale=request('UNRESOLVED_INTENT',package=True);stale['package_generation']='1'
 check('human.escalation.stale-package-owner',lambda:no('human.escalate',stale,key='manager'))
 routed={};leader_obligations=step('leader_obligations',lambda:f.sql("SELECT count(*)::int AS n FROM hyperfide.event_deliveries WHERE consumer_id=$1",[f.ids['leader_consumer']])[0]['n'])
 for operation in ROUTINE:
  def autonomous(operation=operation):
   result=ok('human.autonomous',{'operation':operation,'intent':request('ROUTINE',package=True)},key='manager')
   expect(result['requires_human_prompt'] is False and result['delivery_obligations']==1,'routine work demanded human worker prompt')
   expect(deliveries(result['event_id'])==[{'consumer_id':f.ids['routine_'+operation]}],'routine work was broadcast to human/other consumers')
   record=f.sql('SELECT aggregate_type,payload FROM hyperfide.outbox_events WHERE id=$1',[result['event_id']])[0];expect(record['aggregate_type']=='autonomous_command');payload=record['payload']
   expect(payload['target']=='AUTONOMOUS_CONTROL' and payload['target_session_id'] is None and payload['autonomous_operation']==operation)
   expect(payload['approval']['source']=='APPROVED_RUN_POLICY' and payload['approval']['executor_action']==EXECUTORS[operation],'routine work lacks approved-policy executor')
   routed[operation]=result['event_id']
  check('human.autonomous.'+operation,autonomous)
  def consumed(operation=operation):
   received=ok('human.routine.receive',{'event_id':routed[operation],'operation':operation},key='provisioner')
   admission=received['admission'];expect(received['status']=='APPLIED' and admission['admitted'] is True and admission['executor_action']==EXECUTORS[operation],str(received))
   expect(admission['human_prompts']==0 and admission['requires_human_prompt'] is False and admission['consumed_by_role']=='PROVISIONER' and admission['approval_source']=='APPROVED_RUN_POLICY')
   expect(f.sql("SELECT count(*)::int AS n FROM hyperfide.event_deliveries WHERE consumer_id=$1",[f.ids['leader_consumer']])[0]['n']==leader_obligations,'routine work created a leader/human obligation')
  check('human.routine.'+operation+'.executed-without-prompt',consumed)
 check('human.routine.receive-exactly-once',lambda:expect(ok('human.routine.receive',{'event_id':routed['repair'],'operation':'repair'},key='provisioner')['status']=='DUPLICATE'))
 check('human.routine.wrong-executor-denied',lambda:no('human.routine.receive',{'event_id':routed['schedule'],'operation':'repair'},key='provisioner'))
 check('human.routine.operator-cannot-consume',lambda:no('human.routine.receive',{'event_id':routed['review'],'operation':'review'}))
 check('human.routine.intent-not-consumable',lambda:no('human.routine.receive',{'event_id':escalation['event_id'],'operation':'repair'},key='provisioner'))
 def unapproved_executor():
  # The approved run policy is the only routine authority: withdraw one executor and restart the control service.
  original=f.policy.read_text();policy=json.loads(original);policy['allowed_actions']=[a for a in policy['allowed_actions'] if a!=EXECUTORS['qualification']]
  pending=ok('human.autonomous',{'operation':'qualification','intent':request('ROUTINE',package=True)},key='manager')
  f.stop();f.policy.write_text(json.dumps(policy));f.start()
  try:
   no('human.autonomous',{'operation':'qualification','intent':request('ROUTINE',package=True)},key='manager')
   no('human.routine.receive',{'event_id':pending['event_id'],'operation':'qualification'},key='provisioner')
  finally:f.stop();f.policy.write_text(original);f.start()
 check('human.routine.unapproved-executor-denied',unapproved_executor)
 check('human.autonomous.cannot-change-criteria',lambda:no('human.autonomous',{'operation':'repair','intent':request('CRITERIA',package=True)},key='manager'))
 check('human.autonomous.unknown-operation',lambda:no('human.autonomous',{'operation':'approve-new-intent','intent':request('ROUTINE',package=True)},key='manager'))
 check('human.autonomous.no-operator-worker-prompt',lambda:no('human.autonomous',{'operation':'repair','intent':request('ROUTINE')},key='operator'))
 check('human.intent.no-routine-smuggling',lambda:no('human.submit',request('ROUTINE')))
 # V-008 slice: the manager that escalated is lost and the control service restarts while the intent is still pending.
 escalation_state=lambda:f.sql("SELECT result FROM hyperfide.command_inbox WHERE operation='human.intent.state' AND idempotency_key=$1",[escalation['event_id']])
 def manager_loss():
  # The lost manager's credential is revoked and it leaves the configured fleet before control services restart.
  f.sql("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",[f.ids['manager']])
  config=json.loads(f.identity_config.read_text());config['principals']=[p for p in config['principals'] if p['credential_id']!=f.ids['manager']];f.identity_config.write_text(json.dumps(config))
 step('manager-loss',manager_loss)
 step('control-restart',lambda:(f.stop(),f.start()))
 check('human.v008.manager-lost',lambda:no('human.escalate',request('UNRESOLVED_INTENT',package=True),key='manager'))
 def survived_restart():
  rows=escalation_state();expect(len(rows)==1 and rows[0]['result']['state']=='PENDING' and rows[0]['result']['current_event_id']==escalation['event_id'],'pending escalation lost across restart')
  expect(deliveries(escalation['event_id'])==[{'consumer_id':f.ids['leader_consumer']}],'restart duplicated or dropped the leader obligation')
 check('human.v008.escalation-pending-after-restart',survived_restart)
 # Admission receipt records delivery, not semantic processing; it must survive adoption unchanged.
 admission=step('admission',lambda:ok('inbox.receive',{'organisation_id':f.ids['organisation'],'run_id':f.ids['run'],'event_id':submitted['event_id'],'consumer_id':f.ids['leader_consumer']},component='6.2'))
 admission_before=step('admission_before',lambda:f.sql("SELECT result FROM hyperfide.command_inbox WHERE operation='event.receive' AND principal_scope=$1 AND idempotency_key=$2",[f.ids['leader_consumer'],submitted['event_id']])[0]['result'])
 original_before=step('original_before',lambda:f.sql('SELECT payload FROM hyperfide.outbox_events WHERE id=$1',[submitted['event_id']])[0]['payload'])
 completed=step('completed',lambda:ok('human.submit',request()))
 report=step('report',lambda:{'event_id':completed['event_id'],'expected_leader_generation':'1','evidence_digest':'sha256:'+'a'*64})
 check('human.complete.actual-leader-report',lambda:expect(ok('human.intent.complete',report,key='leader')['state']=='LEADER_REPORTED_COMPLETE'))
 check('human.complete.report-not-qualification',lambda:expect(ok('human.intent.complete',report,key='leader')['qualified'] is False))
 check('human.complete.conflicting-evidence-denied',lambda:no('human.intent.complete',dict(report,evidence_digest='sha256:'+'b'*64),key='leader'))
 step('register-successor-consumer',lambda:ok('outbox.consumer.register',{'organisation_id':f.ids['organisation'],'run_id':f.ids['run'],'id':f.ids['successor_consumer'],'consumer_key':'session:'+f.ids['successor']+':human_intent','critical':False,'state':'BUFFERING'},component='6.1'))
 step('bind-successor-consumer',lambda:bind(f.ids['successor'],f.ids['successor_consumer']))
 replacement=step('replacement',lambda:ok('hierarchy.leader.acquire',{'idempotency_key':'replace-leader','expected_generation':'1','reason':'Signed successor replacement'},key='successor',component='3.1'))
 check('human.describe.replacement-primary',lambda:expect(ok('human.describe',{})['leader_session_id']==f.ids['successor'] and ok('human.describe',{})['leader_generation']=='2'))
 check('human.replacement.actual-generation',lambda:expect(replacement['leader_generation']=='2'))
 check('human.replacement.stale-leader-request',lambda:no('human.submit',request(generation='1')))
 check('human.replacement.old-leader-fenced',lambda:no('human.submit',request(generation='2'),key='leader'))
 snapshot=step('snapshot',lambda:ok('human.bootstrap',{'bootstrap_id':uid(),'expected_leader_generation':'2','limit':128},key='successor'))
 check('human.bootstrap.actual-late-activation',lambda:expect(snapshot['activated'] is True and snapshot['snapshot']['task_completed'] is False and any(r['event_id']==submitted['event_id'] for r in snapshot['snapshot']['pending'])))
 check('human.v008.replacement-snapshot-exactly-once',lambda:expect(sum(r['root_event_id']==escalation['event_id'] for r in snapshot['snapshot']['pending'])==1,'pending escalation not reconstructed exactly once for the replacement leader'))
 check('human.bootstrap.completion-excluded',lambda:expect(not any(r['event_id']==completed['event_id'] for r in snapshot['snapshot']['pending'])))
 read=step('read',lambda:ok('human.intent.read',{'event_id':submitted['event_id'],'expected_leader_generation':'2'},key='successor'))
 check('human.read.actual-replacement-proof',lambda:expect(read['event']['payload']==original_before and read['task_completed'] is False))
 adopted=step('adopted',lambda:ok('human.adopt',{'event_id':submitted['event_id'],'expected_leader_generation':'2'},key='successor'))
 check('human.adoption.explicit-new-event',lambda:expect(adopted['status']=='ADOPTED' and adopted['event_id']!=submitted['event_id'] and adopted['source_event_id']==submitted['event_id'] and adopted['task_completed'] is False))
 check('human.adoption.exact-private-delivery',lambda:expect(deliveries(adopted['event_id'])==[{'consumer_id':f.ids['successor_consumer']}]))
 check('human.adoption.original-immutable',lambda:expect(f.sql('SELECT payload FROM hyperfide.outbox_events WHERE id=$1',[submitted['event_id']])[0]['payload']==original_before))
 check('human.adoption.admission-preserved',lambda:expect(f.sql("SELECT result FROM hyperfide.command_inbox WHERE operation='event.receive' AND principal_scope=$1 AND idempotency_key=$2",[f.ids['leader_consumer'],submitted['event_id']])[0]['result']==admission_before))
 check('human.adoption.business-replay',lambda:expect(ok('human.adopt',{'event_id':submitted['event_id'],'expected_leader_generation':'2'},key='successor')['event_id']==adopted['event_id']))
 check('human.adoption.completed-intent-denied',lambda:no('human.adopt',{'event_id':completed['event_id'],'expected_leader_generation':'2'},key='successor'))
 check('human.adoption.operator-not-primary',lambda:no('human.adopt',{'event_id':escalation['event_id'],'expected_leader_generation':'2'}))
 check('human.adoption.old-primary-fenced',lambda:no('human.adopt',{'event_id':escalation['event_id'],'expected_leader_generation':'2'},key='leader'))
 check('human.adoption.stale-generation',lambda:no('human.adopt',{'event_id':escalation['event_id'],'expected_leader_generation':'1'},key='successor'))
 check('human.adoption.body-recipient-spoof',lambda:no('human.adopt',{'event_id':escalation['event_id'],'expected_leader_generation':'2','target_consumer_id':f.ids['unrelated_consumer']},key='successor'))
 check('human.read.old-source-not-current',lambda:no('human.intent.read',{'event_id':submitted['event_id'],'expected_leader_generation':'2'},key='successor'))
 check('human.complete.adopted-target-report',lambda:expect(ok('human.intent.complete',{'event_id':adopted['event_id'],'expected_leader_generation':'2','evidence_digest':'sha256:'+'c'*64},key='successor')['programme_completed'] is False))
 after=step('after',lambda:ok('human.submit',request(generation='2')))
 check('human.replacement.fresh-leader-route',lambda:expect(after['leader_session_id']==f.ids['successor'] and deliveries(after['event_id'])==[{'consumer_id':f.ids['successor_consumer']}]))
 historical=step('historical',lambda:ok('human.status',{'operation':'human.submit','idempotency_key':initial['idempotency_key']}))
 check('human.replacement.lost-ack-reconciliation',lambda:expect(historical['historical'] is True and historical['authority']=='NONE' and historical['result']['event_id']==submitted['event_id']))
 check('human.status.actor-isolation',lambda:expect(ok('human.status',{'operation':'human.submit','idempotency_key':initial['idempotency_key']},key='provisioner')['status']=='NOT_FOUND'))
 check('human.status.invalid-operation',lambda:no('human.status',{'operation':'anything','idempotency_key':initial['idempotency_key']}))
 check('human.intent.caller-role-spoof',lambda:no('human.submit',dict(request(generation='2'),role='LEADER')))
 check('human.intent.caller-recipient-spoof',lambda:no('human.submit',dict(request(generation='2'),consumer_ids=[f.ids['unrelated_consumer']])))
 check('human.intent.scope-spoof',lambda:no('human.submit',dict(request(generation='2'),run_id=uid())))
 step('revoke-manager',lambda:f.sql("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",[f.ids['manager']]))
 check('human.auth.revoked-manager',lambda:no('human.escalate',request('UNRESOLVED_INTENT',generation='2',package=True),key='manager'))
 for label,generation in [('numeric',2),('zero','0'),('leading-zero','02'),('overflow','9223372036854775808')]:
  check('human.intent.generation-'+label,lambda generation=generation:no('human.submit',request(generation=generation)))
 for label,change in [('package-unpaired',{'package_id':f.ids['package']}),('payload-type',{'payload':[]}),('payload-bound',{'payload':{'data':'x'*131073}}),('request-uuid',{'request_id':'not-a-uuid'}),('idempotency-key',{'idempotency_key':''})]:
  check('human.intent.invalid-'+label,lambda change=change:no('human.submit',dict(request(generation='2'),**change)))
 check('human.intent.no-direct-spec-mutation',lambda:expect(f.sql('SELECT source_content FROM hyperfide.spec_revisions WHERE id=$1',[f.ids['spec']])[0]['source_content']=='fixture'))
 # A third actual acquisition proves a two-link handoff and a same-session/new-generation transfer.
 damaged=step('damaged',lambda:ok('human.submit',request(generation='2')))
 step('damage-delivery',lambda:f.sql('DELETE FROM hyperfide.event_deliveries WHERE event_id=$1',[damaged['event_id']]))
 step('return-primary',lambda:ok('hierarchy.leader.acquire',{'idempotency_key':'return-primary','expected_generation':'2','reason':'Signed original session reacquires at a fresh generation'},key='leader',component='3.1'))
 returned=step('returned',lambda:ok('human.adopt',{'event_id':escalation['event_id'],'expected_leader_generation':'3'},key='leader'))
 check('human.adoption.multi-hop-same-consumer',lambda:expect(returned['status']=='ADOPTED' and deliveries(returned['event_id'])==[{'consumer_id':f.ids['leader_consumer']}]))
 transferred=step('transferred',lambda:f.sql('SELECT payload FROM hyperfide.outbox_events WHERE id=$1',[returned['event_id']])[0]['payload'])
 check('human.adoption.preserved-root-and-chain',lambda:expect(transferred['original_event_id']==escalation['event_id'] and transferred['supersedes_event_id']==escalation['event_id'] and transferred['replacement_proof']['authority']=='LEADER_REPLACEMENT_PROOF'))
 def delivered_once():
  step('control-restart-after-adoption',lambda:(f.stop(),f.start()))
  again=ok('human.adopt',{'event_id':escalation['event_id'],'expected_leader_generation':'3'},key='leader')
  expect(again['replayed'] is True and again['event_id']==returned['event_id'],'lost adoption acknowledgement duplicated the intent')
  chain=f.sql("SELECT id FROM hyperfide.outbox_events WHERE event_type='leader.intent.adopted' AND payload->>'original_event_id'=$1",[escalation['event_id']])
  expect(chain==[{'id':returned['event_id']}] and deliveries(returned['event_id'])==[{'consumer_id':f.ids['leader_consumer']}],'pending intent did not reach the replacement leader exactly once')
  expect(escalation_state()[0]['result']['current_event_id']==returned['event_id'])
 check('human.v008.replacement-leader-exactly-once',delivered_once)
 check('human.adoption.obsolete-successor-fenced',lambda:no('human.adopt',{'event_id':after['event_id'],'expected_leader_generation':'3'},key='successor'))
 before_count=step('before_count',lambda:f.sql('SELECT count(*)::int AS n FROM hyperfide.outbox_events')[0]['n'])
 check('human.adoption.missing-source-obligation-denied',lambda:no('human.adopt',{'event_id':damaged['event_id'],'expected_leader_generation':'3'},key='leader'))
 check('human.adoption.failed-transfer-atomic-rollback',lambda:expect(f.sql('SELECT count(*)::int AS n FROM hyperfide.outbox_events')[0]['n']==before_count and f.sql("SELECT result->>'current_event_id' AS current FROM hyperfide.command_inbox WHERE operation='human.intent.state' AND idempotency_key=$1",[damaged['event_id']])[0]['current']==damaged['event_id']))

finally:
 f.close();absent=f.sql('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[database],admin=True)[0]['n']==0
 complete=absent and not fixture_path.exists() and f.child is None
 print(json.dumps({'type':'cleanup','complete':complete,'resources':[]}),flush=True)
 expect(complete,'PG/listener/private-key fixture cleanup incomplete')
raise SystemExit(bool(FAILED))
