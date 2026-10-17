#!/usr/bin/env python3
"""Real registered frontier selection service; qualified records below are contract fixtures, not live vendor receipts."""
import copy,hashlib,json,os,pathlib,shutil,subprocess,tempfile,sys

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
 f.env['HF_CREDENTIAL_CONFIG_FILE']=str(credentials)
 profiles=[];binary=pathlib.Path('/usr/bin/true').resolve()
 for connector in ['claude','codex']:
  home=f.path/(connector+'-home');home.mkdir(mode=0o700);os.chown(home,1000,1000)
  native=profile(connector,'short-native' if connector=='claude' else 'long-native')
  profiles.append({'schema_version':1,'profile_id':native['profile_id'],'profile_revision':'r1','connector':connector,'auth_mode':'account_session',
   'binary':{'path':str(binary),'digest':'sha256:'+hashlib.sha256(binary.read_bytes()).hexdigest(),'version':'explicit-unqualified-contract-fixture'},
   'credential_reference':native['credential_reference'],'configured_provider_id':'configured-provider','configured_model_alias':native['configured_model_alias'],
   'requested_model_id':native['requested_model_id'],'permission_profile_id':native['permission_profile_id'],'capabilities':native['capabilities'],
   'runtime_home':str(home),'target_uid':1000})
 native_file=f.path/'native.json';native_file.write_text(json.dumps({'schema_version':1,'profiles':profiles}));f.env['HF_NATIVE_AUTH_PROFILES_FILE']=str(native_file)
 route=f.path/'frontier.json';f.env['HF_FRONTIER_POLICY_FILE']=str(route)
 # /usr/bin/true is intentionally an unqualified negative profile, never a claimed native coding runtime.

f=IdentityFixture(extra_components=('14.2','14.3','1.3'),extra_setup=setup);base=f.path;database=f.database
CONFIG.update(programme_id=f.ids['run'],spec_revision='fixture-identity-v1')
try:
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
  response=invoke(action='frontier.select')
  expect(response.get('ok') is False and response.get('error',{}).get('code')=='FRONTIER_ROUTE_DENIED','file-only qualification was admitted or wrong guard refused')
 check('frontier.production.reject-file-only-qualification',refuse_file_only)
finally:
 f.close();absent=f.sql('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[database],admin=True)[0]['n']==0
 complete=not base.exists() and absent and f.child is None
 print(json.dumps({'type':'cleanup','complete':complete,'resources':[]}),flush=True)
 expect(complete,'native policy fixture cleanup incomplete')
raise SystemExit(bool(FAILED))
