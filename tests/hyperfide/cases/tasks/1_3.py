#!/usr/bin/env python3
"""Real registered frontier selection service; qualified records below are contract fixtures, not live vendor receipts."""
import base64,copy,hashlib,json,os,pathlib,shutil,subprocess,tempfile,sys,time,uuid

ROOT=pathlib.Path(__file__).resolve().parents[4]
FAILED=[]
def check(name,fn):
 try: fn();actual='observed'
 except Exception as error: actual=type(error).__name__+': '+str(error);FAILED.append(name)
 print(json.dumps({'type':'assertion','id':name,'expected':'observed','actual':actual}),flush=True)
def expect(ok,message='unexpected service outcome'):
 if not ok: raise AssertionError(message)
def sha(text):return 'sha256:'+hashlib.sha256(text.encode()).hexdigest()
def profile(connector,alias):
 return {'schema_version':1,'profile_id':connector+'-fixture','profile_revision':'r1','profile_digest':sha(connector),
  'connector':connector,'auth_mode':'account_session','binary':{'path':'/opt/'+connector,'digest':sha('binary-'+connector),'version':'fixture-1'},
  'credential_reference':'fixture/'+connector,'configured_model_alias':alias,'requested_model_id':'operator-configured-'+connector,
  'observed_model_id':None,'configured_provider_id':'configured-provider','observed_provider_id':None,'permission_profile_id':'fixture-unattended',
  'capabilities':{'unattended':True,'refresh':True,'concurrent_account':False,'portable_session':False,'explicit_resume':True},
  'qualification':{'state':'QUALIFIED','live_qualified':True,'receipt_digest':sha('contract-fixture-'+connector)}}
POLICY={'schema_version':1,'programme_id':'fixture-run','repository':'fixture/repository','spec_revision':'fixture-revision',
 'policy_revision':1,'status':'ACTIVE','approval':{'decision':'APPROVED','record_id':'fixture-approval','spec_revision':'fixture-revision','policy_revision':1},
 'allowed_roles':['control','provisioner','dispatch'],'allowed_actions':['programme.activate','programme.provision','programme.dispatch','programme.authorize','frontier.check','frontier.select']}
CONFIG={key:POLICY[key] for key in ['schema_version','programme_id','repository','spec_revision','policy_revision']}
CONFIG.update(short_critical_complex_alias='short-native',sustained_complex_alias='long-native',default_alias='long-native',deployments=[])
for connector,alias in [('claude','short-native'),('codex','long-native')]:
 native=profile(connector,alias);CONFIG['deployments'].append({'native_profile':native,'frontier':True,'engineering':True,
  'expected_profile_digest':native['profile_digest'],'expected_snapshot_digest':sha(json.dumps(native,sort_keys=True,separators=(',',':'),ensure_ascii=False)),'expires_at':'2099-01-01T00:00:00.000Z','measurements':None})
INPUT={'task_id':'fixture-task','duration':'SUSTAINED','critical':True,'complex':True,'required_capabilities':['unattended'],
 'requested_alias':None,'input_evidence_digest':sha('fixture-input')}
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture

def setup(f):
 secret=f.path/'secrets';attachment=f.path/'attachments';secret.mkdir(mode=0o700);attachment.mkdir(mode=0o700)
 credentials=f.path/'credentials.json';credentials.write_text(json.dumps({'schema_version':1,'secret_root':str(secret),'attachment_root':str(attachment),'sources':[],'targets':[]}))
 credentials.chmod(0o600);f.env['HF_CREDENTIAL_CONFIG_FILE']=str(credentials)
 profiles=[];binary=pathlib.Path('/usr/bin/true').resolve()
 for index,connector in enumerate(['claude','codex']):
  home=f.path/(connector+'-home');home.mkdir(mode=0o700);os.chown(home,41301+index,41301+index)
  native=profile(connector,'short-native' if connector=='claude' else 'long-native')
  profiles.append({'schema_version':1,'profile_id':native['profile_id'],'profile_revision':'r1','connector':connector,'auth_mode':'account_session',
   'binary':{'path':str(binary),'digest':'sha256:'+hashlib.sha256(binary.read_bytes()).hexdigest(),'version':'explicit-unqualified-contract-fixture'},
   'credential_reference':native['credential_reference'],'configured_provider_id':'configured-provider','configured_model_alias':native['configured_model_alias'],
   'requested_model_id':native['requested_model_id'],'permission_profile_id':native['permission_profile_id'],'capabilities':native['capabilities'],
   'runtime_home':str(home),'target_uid':41301+index,'configured_account_key':'declared-fixture-account-'+connector})
 native_file=f.path/'native.json';native_file.write_text(json.dumps({'schema_version':1,'profiles':profiles}));native_file.chmod(0o600);f.env['HF_NATIVE_AUTH_PROFILES_FILE']=str(native_file)
 route=f.path/'frontier.json';f.env['HF_FRONTIER_POLICY_FILE']=str(route)
 # Signed 13.1-shaped qualification receipts are contract fixtures from a fixture-held key, never live vendor qualification.
 for name in ['qualifier','forger']:
  key=f.path/(name+'.pem');subprocess.run(['openssl','genpkey','-algorithm','Ed25519','-out',str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);key.chmod(0o600)
  public=subprocess.check_output(['openssl','pkey','-in',str(key),'-pubout','-outform','DER'],stderr=subprocess.DEVNULL)
  f.keys[name]={'path':key,'public_key_b64':base64.urlsafe_b64encode(public[-32:]).decode().rstrip('=')}
 f.env['HF_FRONTIER_QUALIFIER_PUBLIC_KEY_B64']=f.keys['qualifier']['public_key_b64'];f.env['HF_FRONTIER_QUALIFICATION_FILE']=str(f.path/'qualification.json')
 # /usr/bin/true is a pinned ELF stand-in for a configured native runtime; no inference is executed.

f=IdentityFixture(extra_components=('14.2','14.3','1.3'),extra_setup=setup);base=f.path;database=f.database
CONFIG.update(programme_id=f.ids['run'],spec_revision='fixture-identity-v1')
try:
 def canon(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
 ORG,RUN,POOL=f.ids['organisation'],f.ids['run'],f.ids['pool']
 ACCOUNTS={}
 for dim,limit,state in [('AGENT',64,'QUALIFIED'),('CPU_MILLIS',8000,'QUALIFIED'),('BUILD',2,'UNQUALIFIED')]:
  ACCOUNTS[dim]=f.sql("INSERT INTO hyperfide.capacity_accounts(organisation_id,pool_id,dimension,configured_limit,provenance_digest,qualification_state) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text AS id",[ORG,POOL,dim,limit,sha('capacity-'+dim),state])[0]['id']
 def admit(dims,expires="clock_timestamp()+interval '1 hour'"):
  # Fixture precondition in the 5.4 admission ledger shape; selection reads it back as measured input.
  request=str(uuid.uuid4())
  for dim,quantity in dims:
   f.sql("INSERT INTO hyperfide.reservations(organisation_id,run_id,request_id,capacity_account_id,quantity,expires_at) VALUES($1,$2,$3,$4,$5,"+expires+")",[ORG,RUN,request,ACCOUNTS[dim],quantity])
   f.sql("UPDATE hyperfide.capacity_accounts SET reserved=reserved+$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[ORG,ACCOUNTS[dim],quantity])
  return request
 ADMISSION=admit([('AGENT',1),('CPU_MILLIS',2000)])
 def invoke(config=None,payload=None,trusted=True,role='control',action='frontier.check'):
  route=base/'frontier.json';route.write_text(json.dumps(CONFIG if config is None else config))
  if not trusted:route.unlink()
  return f.invoke(action,INPUT if payload is None else payload,component='1.3')[1]
 def accepted(payload=None):
  row=invoke(payload=payload);expect(row.get('ok') is True,str(row));return row['result']
 def rejected(config=None,payload=None,**kw):expect(invoke(config,payload,**kw).get('ok') is False,'unsafe route accepted')
 def mutate(path,value):
  config=copy.deepcopy(CONFIG);target=config
  for key in path[:-1]:target=target[key]
  target[path[-1]]=value;rejected(config)
 check('frontier.proposal.sustained',lambda:expect(accepted()['selected_alias']=='long-native'))
 short=dict(INPUT,duration='SHORT')
 check('frontier.proposal.short-critical',lambda:expect(accepted(short)['selected_alias']=='short-native'))
 check('frontier.proposal.default',lambda:expect(accepted(dict(short,critical=False))['selected_alias']=='long-native'))
 check('frontier.lineage.observed-unknown',lambda:expect(accepted()['observed_model_id'] is None and accepted()['observed_provider_id'] is None))
 check('frontier.lineage.configured',lambda:expect(accepted()['configured_provider_id']=='configured-provider'))
 check('frontier.selection.deterministic',lambda:expect(accepted()==accepted()))
 for label,path,value in [
  ('schema',['schema_version'],2),('programme',['programme_id'],'other'),('spec',['spec_revision'],'other'),('policy',['policy_revision'],2),
  ('frontier',['deployments',0,'frontier'],False),('engineering',['deployments',0,'engineering'],False),
  ('connector',['deployments',0,'native_profile','connector'],'decision-model'),('auth',['deployments',0,'native_profile','auth_mode'],'ambient'),
  ('unqualified',['deployments',0,'native_profile','qualification','state'],'UNQUALIFIED'),
  ('stale',['deployments',0,'native_profile','qualification','state'],'STALE'),
  ('not-live',['deployments',0,'native_profile','qualification','live_qualified'],False),
  ('missing-receipt',['deployments',0,'native_profile','qualification','receipt_digest'],None),
  ('profile-drift',['deployments',0,'expected_profile_digest'],sha('other')),
  ('expiry',['deployments',0,'expires_at'],'2000-01-01T00:00:00Z'),
  ('snapshot-binary-drift',['deployments',0,'native_profile','binary','digest'],sha('changed-binary')),
  ('snapshot-version-drift',['deployments',0,'native_profile','binary','version'],'changed-version'),
  ('snapshot-model-drift',['deployments',0,'native_profile','requested_model_id'],'changed-model'),
  ('snapshot-provider-drift',['deployments',0,'native_profile','configured_provider_id'],'changed-provider'),
  ('snapshot-capability-drift',['deployments',0,'native_profile','capabilities','unattended'],False),
  ('snapshot-receipt-drift',['deployments',0,'native_profile','qualification','receipt_digest'],sha('changed-receipt')),
  ('noncanonical-expiry',['deployments',0,'expires_at'],'2099-01-01T00:00:00Z'),
  ('impossible-expiry',['deployments',0,'expires_at'],'2099-02-30T00:00:00.000Z'),
  ('bad-binary-digest',['deployments',0,'native_profile','binary','digest'],'latest'),
  ('numeric-revision',['deployments',0,'native_profile','profile_revision'],1),
  ('duplicate-alias',['deployments',0,'native_profile','configured_model_alias'],'long-native'),
  ('short-connector-policy',['short_critical_complex_alias'],'long-native'),
  ('long-connector-policy',['sustained_complex_alias'],'short-native'),
  ('unknown-default',['default_alias'],'missing'),
  ('invented-metrics',['deployments',0,'measurements'],{'evidence_digest':sha('metrics'),'sample_count':0,'qualified_results':1,'failed_results':0,'p95_latency_ms':None,'observed_at':'2020-01-01T00:00:00Z'})]:
  check('frontier.reject.'+label,lambda path=path,value=value:mutate(path,value))
 for label,payload in [('unknown-capability',dict(INPUT,required_capabilities=['magic'])),('unsupported-capability',dict(INPUT,required_capabilities=['portable_session'])),
  ('duplicate-capability',dict(INPUT,required_capabilities=['unattended','unattended'])),('wrong-alias',dict(INPUT,requested_alias='short-native')),
  ('unknown-alias',dict(INPUT,requested_alias='decision-model')),('duration',dict(INPUT,duration='forever')),('boolean',dict(INPUT,complex='yes')),
  ('request-config',dict(INPUT,deployments=CONFIG['deployments'])),('request-host',dict(INPUT,host_id='main')),('input-evidence',dict(INPUT,input_evidence_digest='none'))]:
  check('frontier.reject.'+label,lambda payload=payload:rejected(payload=payload))
 check('frontier.reject.missing-trusted-config',lambda:rejected(trusted=False))
 check('frontier.proposal.no-qualification-admission',lambda:expect(accepted()['qualification_admitted'] is False and accepted()['authority']=='NONE'))
 def actual_unqualified():
  response=f.invoke('native.auth.snapshot',{'profile_id':'codex-fixture'},component='14.3')[1]
  expect(response.get('ok') is True,str(response));native=response['result']
  expect(native['qualification']['state']=='UNQUALIFIED' and native['qualification']['live_qualified'] is False and native['qualification']['receipt_digest'] is None)
 check('frontier.production.authoritative-unqualified',actual_unqualified)
 def refuse_file_only():
  (base/'qualification.json').unlink(missing_ok=True)
  response=invoke(action='frontier.select',payload={'selection':INPUT,'admission_request_id':ADMISSION})
  expect(response.get('ok') is False and response.get('error',{}).get('code')=='FRONTIER_QUALIFICATION_UNAVAILABLE','file-only qualification was admitted or wrong guard refused: '+json.dumps(response))
 check('frontier.production.reject-file-only-qualification',refuse_file_only)
 # ---- Authoritative selection: actual 14.3 configuration + signed qualification + 5.4 admission -> durable record.
 ACTUAL={}
 for connector in ['claude','codex']:
  response=f.invoke('native.auth.snapshot',{'profile_id':connector+'-fixture'},component='14.3')[1];expect(response.get('ok') is True,str(response));ACTUAL[connector]=response['result']
 def receipt_body(native,**changes):
  body={'schema_version':1,'qualifier':'13.1-connector-qualification','profile_id':native['profile_id'],'profile_digest':native['profile_digest'],
   'binary_digest':native['binary']['digest'],'binary_version':native['binary']['version'],'configured_model_alias':native['configured_model_alias'],
   'requested_model_id':native['requested_model_id'],'configured_provider_id':native['configured_provider_id'],'observed_model_id':native['requested_model_id'],
   'observed_provider_id':native['configured_provider_id'],'qualified_at':time.strftime('%Y-%m-%dT%H:%M:%S.000Z',time.gmtime(time.time()-60)),
   'expires_at':'2099-01-01T00:00:00.000Z','evidence_digest':sha('qualification-run-'+native['profile_id'])}
  body.update(changes);return body
 def envelope(body,key='qualifier'):return {'body':body,'signature_b64':f.sign(key,canon(body).encode())}
 BODIES={c:receipt_body(ACTUAL[c]) for c in ACTUAL}
 def write_receipts(envelopes,mode=0o600):
  target=base/'qualification.json';target.write_text(json.dumps({'schema_version':1,'receipts':envelopes}));target.chmod(mode)
 def qualified(connector):
  native=copy.deepcopy(ACTUAL[connector]);body=BODIES[connector]
  native.update(observed_model_id=body['observed_model_id'],observed_provider_id=body['observed_provider_id'],
   qualification={'state':'QUALIFIED','live_qualified':True,'receipt_digest':sha(canon(body))})
  return native
 QCONFIG=copy.deepcopy(CONFIG);QCONFIG['deployments']=[]
 for connector in ['claude','codex']:
  native=qualified(connector)
  QCONFIG['deployments'].append({'native_profile':native,'frontier':True,'engineering':True,'expected_profile_digest':native['profile_digest'],
   'expected_snapshot_digest':sha(canon(native)),'expires_at':'2099-01-01T00:00:00.000Z',
   'measurements':{'evidence_digest':sha('route-measure-'+connector),'sample_count':4,'qualified_results':4,'failed_results':0,'p95_latency_ms':1200,'observed_at':'2026-01-01T00:00:00.000Z'}})
 def select(task,admission=None,config=None,receipts=None,key='operator',**changes):
  write_receipts(receipts if receipts is not None else [envelope(BODIES['claude']),envelope(BODIES['codex'])])
  (base/'frontier.json').write_text(json.dumps(QCONFIG if config is None else config))
  return f.invoke('frontier.select',{'selection':dict(INPUT,task_id=task,**changes),'admission_request_id':admission or ADMISSION},component='1.3',key=key)[1]
 def selected(task,**kw):
  row=select(task,**kw);expect(row.get('ok') is True,json.dumps(row));return row['result']
 def denied(code,task,**kw):
  row=select(task,**kw);expect(row.get('ok') is False and row.get('error',{}).get('code')==code,'expected '+code+': '+json.dumps(row)[:600])
 def stored(selection_id):
  return f.sql("SELECT event_type,aggregate_version::int AS v,payload FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type='frontier.route' AND aggregate_id=$3 ORDER BY aggregate_version,event_type DESC",[ORG,RUN,selection_id])
 def qualified_sustained():
  r=selected('select-sustained');codex=ACTUAL['codex']
  expect(r['selected_alias']=='long-native' and r['connector']=='codex' and r['qualification_admitted'] is True and r['replayed'] is False)
  expect(r['profile_digest']==codex['profile_digest'] and r['requested_model_id']==codex['requested_model_id'] and r['observed_model_id']==codex['requested_model_id'])
  expect(r['configured_provider_id']=='configured-provider' and r['observed_provider_id']=='configured-provider' and r['qualification_receipt_digest']==sha(canon(BODIES['codex'])))
  expect(r['selected_alias'] not in (r['requested_model_id'],r['observed_model_id']),'user alias became a public model identifier')
 check('frontier.select.qualified-sustained',qualified_sustained)
 def qualified_short():
  r=selected('select-short',duration='SHORT');expect(r['selected_alias']=='short-native' and r['connector']=='claude' and r['binary_digest']==ACTUAL['claude']['binary']['digest'])
 check('frontier.select.qualified-short-critical',qualified_short)
 def recorded():
  r=selected('select-recorded');rows=stored(r['selection_id'])
  expect(len(rows)==1 and rows[0]['event_type']=='frontier.route.selected' and rows[0]['v']==1)
  p=rows[0]['payload'];expect(p['selection_digest']==r['selection_digest'] and p['observed_model_id']==r['observed_model_id'] and p['configured_provider_id']=='configured-provider')
  expect(p['task']['task_id']=='select-recorded' and p['selected_by']['role']=='OPERATOR' and p['request_digest']==r['request_digest'])
 check('frontier.select.recorded-lineage',recorded)
 def measured():
  r=selected('select-measured');m=r['measured_inputs']['admission']
  db={x['dimension']:x for x in f.sql("SELECT a.dimension,r.quantity::text AS quantity,a.configured_limit::text AS configured_limit,a.reserved::text AS reserved,a.allocated::text AS allocated FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.request_id=$1",[ADMISSION])}
  expect(m['source']=='5.4.resource-admission' and m['request_id']==ADMISSION and len(m['dimensions'])==2)
  for d in m['dimensions']:expect(all(d[k]==db[d['dimension']][k] for k in ('quantity','configured_limit','reserved','allocated')),'measured input differs from admission ledger')
  expect(r['measured_inputs']['route']['sample_count']==4 and r['measured_inputs']['prior_selections']==0)
 check('frontier.select.measured-admission',measured)
 def replay():
  first=selected('select-replay');second=selected('select-replay')
  expect(second['replayed'] is True and second['selection_digest']==first['selection_digest'] and second['selection_id']==first['selection_id'] and len(stored(first['selection_id']))==1)
 check('frontier.select.idempotent-replay',replay)
 check('frontier.select.reject-idempotency-conflict',lambda:(selected('select-conflict'),denied('FRONTIER_IDEMPOTENCY_CONFLICT','select-conflict',required_capabilities=[])))
 check('frontier.select.reject-missing-receipt',lambda:denied('FRONTIER_ROUTE_UNQUALIFIED','reject-receipt',receipts=[envelope(BODIES['claude'])]))
 check('frontier.select.reject-forged-signature',lambda:denied('FRONTIER_QUALIFICATION_INVALID','reject-forged',receipts=[envelope(BODIES['claude']),envelope(BODIES['codex'],key='forger')]))
 check('frontier.select.reject-expired-receipt',lambda:denied('FRONTIER_QUALIFICATION_STALE','reject-expired',receipts=[envelope(BODIES['claude']),envelope(receipt_body(ACTUAL['codex'],expires_at='2020-01-01T00:00:00.000Z'))]))
 check('frontier.select.reject-receipt-model-drift',lambda:denied('FRONTIER_ROUTE_UNQUALIFIED','reject-model',receipts=[envelope(BODIES['claude']),envelope(receipt_body(ACTUAL['codex'],observed_model_id='substituted-model'))]))
 check('frontier.select.reject-receipt-config-drift',lambda:denied('FRONTIER_ROUTE_UNQUALIFIED','reject-config',receipts=[envelope(BODIES['claude']),envelope(receipt_body(ACTUAL['codex'],profile_digest=sha('older-profile')))]))
 def insecure():
  row=select('reject-insecure');expect(row.get('ok') is True)
  write_receipts([envelope(BODIES['claude']),envelope(BODIES['codex'])],mode=0o644)
  response=f.invoke('frontier.select',{'selection':dict(INPUT,task_id='reject-insecure-2'),'admission_request_id':ADMISSION},component='1.3')[1]
  expect(response.get('ok') is False and response['error']['code']=='FRONTIER_QUALIFICATION_UNAVAILABLE')
 check('frontier.select.reject-insecure-receipt-file',insecure)
 def forged_snapshot():
  config=copy.deepcopy(QCONFIG);native=config['deployments'][1]['native_profile'];native['permission_profile_id']='broader-permissions'
  config['deployments'][1]['expected_snapshot_digest']=sha(canon(native));denied('FRONTIER_ROUTE_DENIED','reject-snapshot',config=config)
 check('frontier.select.reject-approved-snapshot-drift',forged_snapshot)
 check('frontier.select.reject-decision-substitution',lambda:denied('FRONTIER_ROUTE_DENIED','reject-decision',requested_alias='decision-model'))
 def decision_route():
  config=copy.deepcopy(QCONFIG);config['deployments'][1]['engineering']=False;denied('FRONTIER_ROUTE_DENIED','reject-decision-route',config=config)
 check('frontier.select.reject-nonengineering-route',decision_route)
 check('frontier.select.reject-missing-admission',lambda:denied('FRONTIER_ADMISSION_REQUIRED','reject-admission',admission=str(uuid.uuid4())))
 check('frontier.select.reject-expired-admission',lambda:denied('FRONTIER_ADMISSION_REQUIRED','reject-admission-expired',admission=admit([('AGENT',1)],"clock_timestamp()-interval '1 minute'")))
 check('frontier.select.reject-no-agent-capacity',lambda:denied('FRONTIER_ADMISSION_REQUIRED','reject-admission-agent',admission=admit([('CPU_MILLIS',1000)])))
 check('frontier.select.reject-unqualified-capacity',lambda:denied('FRONTIER_ADMISSION_REQUIRED','reject-admission-qualified',admission=admit([('AGENT',1),('BUILD',1)])))
 check('frontier.select.reject-role',lambda:denied('AUTH_ROLE_DENIED','reject-role',key='provisioner'))
 # ---- V-044 bounded outcome policy over the durable selection.
 def outcome(selection_id,sequence,signal,evidence=None):
  return f.invoke('frontier.outcome',{'selection_id':selection_id,'sequence':sequence,'signal':signal,'evidence_digest':evidence or sha(signal+str(sequence))},component='1.3')[1]
 def ok(row):expect(row.get('ok') is True,json.dumps(row)[:600]);return row['result']
 def code(row,expected):expect(row.get('ok') is False and row.get('error',{}).get('code')==expected,'expected '+expected+': '+json.dumps(row)[:600])
 def series(task,signals):
  sid=selected(task)['selection_id'];return sid,[ok(outcome(sid,n+1,s)) for n,s in enumerate(signals)]
 def distinct():
  _,(progress,alive,waiting)=series('outcome-distinct',['PROGRESS','PROCESS_ALIVE','MODEL_WAITING'])
  expect(progress['decision']=='CONTINUE' and progress['useful_progress'] is True and progress['classification']=='USEFUL_PROGRESS')
  expect(alive['decision']=='WAIT' and alive['useful_progress'] is False and alive['liveness_only'] is True and alive['classification']=='PROCESS_LIVENESS')
  expect(waiting['decision']=='WAIT' and waiting['useful_progress'] is False and waiting['model_waiting'] is True and waiting['classification']=='MODEL_WAITING')
 check('frontier.outcome.progress-liveness-waiting-distinct',distinct)
 def errors():
  _,rows=series('outcome-errors',['MODEL_ERROR','TOOL_ERROR','MODEL_ERROR'])
  expect([r['decision'] for r in rows]==['RETRY','RETRY','ESCALATE'] and rows[0]['retry_after_ms']<rows[1]['retry_after_ms'] and rows[2]['retry_after_ms'] is None)
  expect(all(r['respawn_permitted'] is False and r['context_preserved'] is True for r in rows) and rows[1]['retry_limit']==2)
 check('frontier.outcome.error-retry-bounded',errors)
 def limits():
  _,rows=series('outcome-limits',['RATE_LIMITED','QUOTA_LIMITED','RATE_LIMITED','QUOTA_LIMITED'])
  expect([r['decision'] for r in rows]==['BACKOFF','BACKOFF','BACKOFF','ESCALATE'] and rows[0]['retry_after_ms']<rows[1]['retry_after_ms']<rows[2]['retry_after_ms']<=900000)
 check('frontier.outcome.limit-backoff-bounded',limits)
 def auth():
  sid,(row,)=series('outcome-auth',['AUTH_FAILURE'])
  expect(row['decision']=='AUTH_BLOCKED' and row['respawn_permitted'] is False and row['retry_after_ms'] is None and row['classification']=='AUTHENTICATION_FAILURE')
  code(outcome(sid,2,'PROGRESS'),'FRONTIER_ROUTE_TERMINAL')
 check('frontier.outcome.auth-blocked-terminal',auth)
 def noop():
  _,rows=series('outcome-noop',['NO_OP','NO_OP','NO_OP'])
  expect([r['decision'] for r in rows]==['CONTINUE','CONTINUE','ESCALATE'] and not any(r['useful_progress'] for r in rows))
 check('frontier.outcome.no-op-bounded',noop)
 check('frontier.outcome.idle-bounded',lambda:expect([r['decision'] for r in series('outcome-idle',['IDLE','IDLE'])[1]]==['WAIT','ESCALATE']))
 def verbose():
  _,rows=series('outcome-verbose',['PROCESS_ALIVE']*6)
  expect([r['decision'] for r in rows]==['WAIT']*5+['ESCALATE'] and all(r['success_inferred'] is False and r['useful_progress'] is False for r in rows))
 check('frontier.outcome.liveness-never-success',verbose)
 def progress_resets():
  _,rows=series('outcome-reset',['NO_OP','NO_OP','PROGRESS','NO_OP','NO_OP'])
  expect([r['decision'] for r in rows]==['CONTINUE']*5)
 check('frontier.outcome.progress-resets-no-op',progress_resets)
 def recorded_outcomes():
  sid,rows=series('outcome-recorded',['PROGRESS','MODEL_ERROR'])
  db=stored(sid);expect([r['event_type'] for r in db]==['frontier.route.selected','frontier.route.outcome','frontier.route.outcome'] and [r['v'] for r in db]==[1,1,2])
  expect(db[2]['payload']['history_digest']==rows[1]['history_digest'] and rows[0]['history_digest']!=rows[1]['history_digest'] and db[2]['payload']['selection_id']==sid)
  view=ok(f.invoke('frontier.inspect',{'selection_id':sid},component='1.3')[1]);expect(view['launch_admissible'] is True and len(view['outcomes'])==2)
 check('frontier.outcome.recorded-history',recorded_outcomes)
 def replay_outcome():
  sid=selected('outcome-replay')['selection_id'];first=ok(outcome(sid,1,'TOOL_ERROR'));again=ok(outcome(sid,1,'TOOL_ERROR'))
  expect(again['replayed'] is True and again['history_digest']==first['history_digest']);code(outcome(sid,1,'PROGRESS'),'FRONTIER_IDEMPOTENCY_CONFLICT')
 check('frontier.outcome.idempotent-replay',replay_outcome)
 def gap():
  sid=selected('outcome-gap')['selection_id'];code(outcome(sid,2,'PROGRESS'),'FRONTIER_OUTCOME_SEQUENCE')
 check('frontier.outcome.reject-sequence-gap',gap)
 check('frontier.outcome.reject-unknown-selection',lambda:code(outcome(str(uuid.uuid4()),1,'PROGRESS'),'FRONTIER_SELECTION_UNKNOWN'))
 def unknown_signal():
  sid=selected('outcome-signal')['selection_id'];code(outcome(sid,1,'VERBOSE_LOGS'),'FRONTIER_ROUTE_DENIED')
 check('frontier.outcome.reject-unknown-signal',unknown_signal)
 def escalated():
  sid,_=series('outcome-escalated',['AUTH_FAILURE'])
  view=ok(f.invoke('frontier.inspect',{'selection_id':sid},component='1.3')[1]);expect(view['terminal'] is True and view['launch_admissible'] is False)
  denied('FRONTIER_ROUTE_ESCALATED','outcome-escalated',admission=admit([('AGENT',1)]))
 check('frontier.outcome.escalation-blocks-respawn',escalated)
 def budget():
  for n in range(3):selected('outcome-budget',admission=admit([('AGENT',1)]))
  denied('FRONTIER_RESPAWN_BOUNDED','outcome-budget',admission=admit([('AGENT',1)]))
 check('frontier.outcome.selection-budget-bounded',budget)
finally:
 f.close();absent=f.sql('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[database],admin=True)[0]['n']==0
 complete=not base.exists() and absent and f.child is None
 print(json.dumps({'type':'cleanup','complete':complete,'resources':[]}),flush=True)
 expect(complete,'native policy fixture cleanup incomplete')
raise SystemExit(bool(FAILED))
