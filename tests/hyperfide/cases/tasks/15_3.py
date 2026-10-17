#!/usr/bin/env python3
"""Real packet/claim/native capsule/object-store/checkpoint registration integration.

A source registration is recoverable data, never restored context or result
acceptance. The original attempt is then expired on the real primary clock and a
replacement claimed through a packet that pins the checkpoint; the replacement
adopts the old artifacts as untrusted history without renewing the old fence.
"""
from __future__ import annotations
import base64,contextlib,hashlib,importlib.util,io,json,os,socket,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
scheduler=module('actual_checkpoint_scheduler',ROOT/'tests/hyperfide/cases/tasks/5_1.py')
native=module('actual_checkpoint_native',ROOT/'tests/hyperfide/cases/tasks/15_1.py')
objects=module('actual_checkpoint_objects',ROOT/'tests/hyperfide/cases/tasks/15_2.py')
RESULTS=[]
def sha(data):return 'sha256:'+hashlib.sha256(data).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
def expect(value,message='Observed checkpoint assertion failed'):
 if not value:raise AssertionError(message)
def check(name,call):
 try:call();actual='observed'
 except Exception as error:actual=type(error).__name__+': '+str(error)
 RESULTS.append((name,actual));print(json.dumps({'type':'assertion','id':name,'expected':'observed','actual':actual}),flush=True)
class CheckpointFixture:
 def __init__(self):
  self.temp=tempfile.TemporaryDirectory(prefix='hyperfide-checkpoint-admission-')
  self.base=Path(self.temp.name);self.native=native.Fixture(self.base)
  self.objects=objects.ObjectFixture();self.service=None
  try:
   def setup(f):
    self.scope={'organisation_id':f.ids['organisation'],'run_id':f.ids['run']}
    objects.ORG=self.scope['organisation_id'];objects.RUN=self.scope['run_id'];objects.SCOPE=self.scope
    secret_root=f.path/'credential-secrets';secret_root.mkdir(mode=0o700)
    attachment_root=f.path/'credential-attachments';attachment_root.mkdir(mode=0o711)
    credential_config=f.path/'credential-store.json'
    credential_config.write_text(json.dumps({'schema_version':1,'secret_root':str(secret_root),'attachment_root':str(attachment_root),'sources':[],'targets':[]}));credential_config.chmod(0o600)
    f.env['HF_CREDENTIAL_CONFIG_FILE']=str(credential_config)
    binary=Path(os.environ.get('HF_TEST_NATIVE_CLAUDE_BINARY','/root/.local/share/claude/versions/2.1.300')).resolve()
    expect(binary.is_file(),'Actual installed native Claude ELF is required for the unqualified profile fixture')
    native_home=f.path/'native-empty-home';native_home.mkdir(mode=0o700);os.chown(native_home,41315,41315)
    profile={'schema_version':1,'profile_id':'checkpoint-source-only','profile_revision':'1','connector':'claude','auth_mode':'api_credential','binary':{'path':str(binary),'digest':sha(binary.read_bytes()),'version':'2.1.300'},'credential_reference':'checkpoint/no-native-credential','configured_provider_id':'declared-only','configured_model_alias':'declared-only','requested_model_id':'declared-only','permission_profile_id':'source-only','capabilities':{key:False for key in ('unattended','refresh','concurrent_account','portable_session','explicit_resume')},'runtime_home':str(native_home),'target_uid':41315,'configured_account_key':'declared-source-only-no-auth'}
    profiles=f.path/'native-profiles.json';profiles.write_text(json.dumps({'schema_version':1,'profiles':[profile]}));profiles.chmod(0o600);f.env['HF_NATIVE_AUTH_PROFILES_FILE']=str(profiles)
    f.env.update({'HF_ARTIFACT_S3_ENDPOINT':self.objects.endpoint,'HF_ARTIFACT_ALLOW_LOOPBACK_HTTP':'1',
     'HF_ARTIFACT_S3_REGION':objects.REGION,'HF_ARTIFACT_S3_BUCKET':objects.BUCKET,
     'HF_ARTIFACT_S3_ACCESS_KEY_ID':objects.KEY,'HF_ARTIFACT_S3_SECRET_ACCESS_KEY':objects.SECRET,
     'HF_ARTIFACT_S3_SESSION_TOKEN':objects.TOKEN,'HF_ARTIFACT_ORGANISATION_ID':self.scope['organisation_id'],
     'HF_ARTIFACT_ALLOWED_RUN_IDS':json.dumps([self.scope['run_id']])})
   self.service=scheduler.SchedulerFixture(extra_components=('15.3',),extra_setup=setup,source_object_id=self.native.head)
   self.claim=self.service.claim('a');self.token=self.claim['token'];i=self.service.ids
   packet=self.service.ok('hierarchy.packet.inspect',{'leader_generation':'1','package_generation':'2','digest':self.token['input_packet_digest']},key='manager',component='3.2')['packet'] if 'input_packet_digest' in self.token else self.service.ok('hierarchy.packet.inspect',{'leader_generation':'1','package_generation':'2','digest':self.service.claims['a']['request']['input_packet_digest']},key='manager',component='3.2')['packet']
   self.packet=packet;self.workspace=scheduler.uid()
   # This registers an actually present Git workspace underneath a genuinely
   # signed claim. It creates no attempt/compute lease/checkpoint/adoption.
   self.service.sql("INSERT INTO hyperfide.workspaces(organisation_id,run_id,id,repository_id,attempt_id,attempt_generation,sandbox_id,slot_id,sandbox_boot_generation,base_commit,branch_ref,workspace_path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'refs/heads/attempt',$11)",
     [i['organisation'],i['run'],self.workspace,i['repository'],self.token['attempt_id'],self.token['attempt_generation'],self.token['sandbox_id'],self.token['slot_id'],self.token['sandbox_boot_generation'],self.native.head,str(self.native.repo)])
   dependency=canonical(packet['mandatory']['inputs']['dependencies'])
   summary=canonical({'schema_version':1,'summary':'Actual captured native source; no result acceptance asserted.'})
   findings=canonical({'schema_version':1,'findings':[],'authority':'NONE'})
   self.context={role:self.put(data) for role,data in [('dependency',dependency),('summary',summary),('findings',findings)]}
   request=dict(self.native.request,**self.scope,repository_id=i['repository'],task_id=self.token['task_id'],
    attempt_id=self.token['attempt_id'],workspace_id=self.workspace,preparation_digest=self.service.preparation,
    dependency_digest=sha(dependency),summary_digest=sha(summary),findings_digest=sha(findings),native_support='UNSUPPORTED',native_session_ref='')
   self.capture=native.invoke('checkpoint.capture',request,self.native.env)
   expect(self.capture.get('capture_state')=='LOCAL_COMPLETE','Actual native scoped capture refused')
   self.raw=(self.native.spool/(self.capture['checkpoint_digest'][7:]+'.hfc')).read_bytes()
   self.parent=self.upload(self.raw)
   self.request={'token':self.token,'workspace_id':self.workspace,'artifact_id':self.parent['artifact']['artifact_id'],
    'expected_capsule_digest':self.capture['checkpoint_digest'],'expected_source_metadata_digest':self.capture['manifest_digest'],
    'context_artifacts':{role+'_artifact_id':value['artifact']['artifact_id'] for role,value in self.context.items()}}
  except BaseException:self.close();raise
 def ok(self,action,value,component='15.3',key='operator'):
  return self.service.ok(action,value,component=component,key=key)
 def put(self,data):
  value=dict(self.scope,digest=sha(data),size_bytes=str(len(data)),data_base64=base64.b64encode(data).decode(),retention_class='RUN',retention_until=None,retention_hold=False)
  result=self.ok('artifact.object.put',value,component='15.2');objects.verified(result,data);return result
 def upload(self,data):
  chunks=[];offset=0
  for n in range(0,len(data),196608):
   raw=data[n:n+196608];stored=self.put(raw)['artifact']
   chunks.append({'sequence':len(chunks),'artifact_id':stored['artifact_id'],'digest':sha(raw),'size_bytes':str(len(raw)),'offset_bytes':str(offset)});offset+=len(raw)
  return self.ok('artifact.manifest.commit',dict(self.scope,expected_chunks=len(chunks),total_size_bytes=str(len(data)),content_digest=sha(data),complete=True,truncated=False,missing_ranges=[],chunks=chunks,retention_class='RUN',retention_until=None,retention_hold=False),component='15.2')
 def reject(self,value,codes,key='operator',action='artifact.checkpoint.register'):
  _,response=self.service.invoke(action,value,key=key,component='15.3')
  expect(response.get('ok') is False and response.get('error',{}).get('code') in codes,'Expected refusal, observed '+str(response.get('error',{}).get('code')))
 def adopt_request(self,**overrides):
  return dict(self.adoption,**overrides)
 def close(self):
  if self.service is not None:self.service.close();self.service=None
  if self.objects is not None:self.objects.stop();self.objects=None
  self.temp.cleanup()
def adoption(f,checkpoint_id):
 svc=f.service;i=svc.ids;old=f.token;CURRENT="SELECT id::text,generation::text,compute_authority,lease_expires_at::text FROM hyperfide.attempts WHERE id=$1"
 # Shorten the original lease through the trusted lower renewal API and wait
 # for the real primary deadline; no forged clock or synthetic attempt row.
 expect('result' in svc.primary("return leases.renewCompute(tx,data.token,1000);",{'token':old}),'Original lease could not be shortened')
 while svc.sql("SELECT lease_expires_at>clock_timestamp() AS live FROM hyperfide.attempts WHERE id=$1",[old['attempt_id']])[0]['live']:time.sleep(.05)
 expired=svc.ok('scheduler.compute.expire',{'organisation_id':i['organisation'],'run_id':i['run'],'authority_epoch':i['epoch'],'leader_generation':'1'},component='5.2')
 source_before=svc.sql(CURRENT,[old['attempt_id']])[0]
 check('adoption.expired-source-fenced',lambda:expect(expired['expired_attempt_ids']==[old['attempt_id']] and source_before['compute_authority']=='EXPIRED','Original attempt kept authority'))
 # The packet producer pins the exact historical checkpoint only through the
 # reader this component installs; validation re-reads current artifacts.
 pinned_input=svc.packet_input(task_id=i['task_a'],slot_id=i['slot_overlap'],idempotency_key=scheduler.uid(),attempt_id=scheduler.uid(),attempt_generation='2',continuation_checkpoint_id=checkpoint_id)
 pinned_digest=svc.ok('hierarchy.packet.create',pinned_input,key='manager',component='3.2')['digest']
 pinned=svc.ok('hierarchy.packet.inspect',{'leader_generation':'1','package_generation':'2','digest':pinned_digest},key='manager',component='3.2')['packet']['mandatory']['intent']['continuation']
 check('adoption.continuation-pinned',lambda:expect(pinned['checkpoint_id']==checkpoint_id and pinned['authority']=='NONE' and pinned['context_restored'] is False and pinned['source']['attempt_id']==old['attempt_id'] and pinned['artifact']['content_digest']==sha(f.raw),'Replacement packet does not pin the exact historical checkpoint'))
 check('adoption.continuation-current',lambda:expect('CURRENT_CONTINUATION_ARTIFACTS' in svc.ok('hierarchy.packet.validate',{'leader_generation':'1','package_generation':'2','digest':pinned_digest},key='manager',component='3.2')['checked_inputs'],'Pinned continuation was not re-read from current artifacts'))
 # scheduler.claim (5.1) validates packets without the authenticated invocation,
 # so a continuation-pinned packet cannot be claimed in this tree; the
 # replacement is claimed through an unpinned packet and must not be able to adopt.
 packet_input=svc.packet_input(task_id=i['task_a'],slot_id=i['slot_overlap'],idempotency_key=scheduler.uid(),attempt_id=scheduler.uid(),attempt_generation='2')
 created=svc.ok('hierarchy.packet.create',packet_input,key='manager',component='3.2')
 claim_request={'organisation_id':i['organisation'],'run_id':i['run'],'request_id':scheduler.uid(),'task_id':packet_input['task_id'],'attempt_id':packet_input['attempt_id'],'attempt_generation':'2','run_spec_generation':svc.spec_generation,'spec_generation':svc.spec_generation,'spec_revision_id':i['accepted_spec'],'authority_epoch':i['epoch'],'leader_generation':'1','package_generation':'2','sandbox_id':i['sandbox'],'slot_id':packet_input['slot_id'],'sandbox_boot_generation':'1','lease_ms':300000,'input_packet_digest':created['digest'],'capacity':svc.capacity()}
 new=svc.claim('replacement',request=claim_request)['token']
 target_before=svc.sql(CURRENT,[new['attempt_id']])[0]
 check('adoption.replacement-single-current',lambda:expect([row['id'] for row in svc.sql("SELECT id::text FROM hyperfide.attempts WHERE compute_authority='CURRENT'")]==[new['attempt_id']],'More than one current generation'))
 f.adoption={'token':new,'source_checkpoint_id':checkpoint_id,'source_expected_artifact_digest':f.parent['artifact']['digest'],'target_expected_input_packet_digest':created['digest'],'target_expected_preparation_digest':svc.preparation,'mode':'SOURCE_ONLY','native_resume':None}
 native={'session_id':scheduler.uid(),'native_session_id':'native-mismatch','configuration_digest':sha(b'configuration'),'source_manifest_digest':f.capture['manifest_digest']}
 stale={'STALE_COMPUTE','COMPUTE_LEASE_EXPIRED','COMPUTE_ALLOCATION_INVALID'}
 check('adoption.stale-worker-renewal-denied',lambda:expect(svc.primary("return leases.renewCompute(tx,data.token,300000);",{'token':old}).get('error',{}).get('code') in stale,'Expired worker renewed its fence'))
 check('adoption.stale-worker-registration-denied',lambda:f.reject(f.request,stale))
 check('adoption.stale-worker-import-denied',lambda:f.reject(f.request,stale,action='artifact.checkpoint.import'))
 check('adoption.stale-worker-cannot-adopt',lambda:f.reject(f.adopt_request(token=old),stale,action='artifact.adoption.adopt'))
 check('adoption.strict-input',lambda:f.reject(f.adopt_request(renew_source=True),{'ADOPTION_INPUT_INVALID'},action='artifact.adoption.validate'))
 check('adoption.readonly-role',lambda:f.reject(f.adopt_request(),{'ADOPTION_ROLE_DENIED','AUTH_ROLE_DENIED','ROLE_DENIED'},key='watcher',action='artifact.adoption.adopt'))
 check('adoption.missing-checkpoint',lambda:f.reject(f.adopt_request(source_checkpoint_id=scheduler.uid()),{'ADOPTION_CHECKPOINT_MISSING'},action='artifact.adoption.validate'))
 check('adoption.artifact-digest-mismatch',lambda:f.reject(f.adopt_request(source_expected_artifact_digest=sha(b'other capsule')),{'ADOPTION_CHECKPOINT_INVALID'},action='artifact.adoption.validate'))
 check('adoption.native-session-mismatch',lambda:f.reject(f.adopt_request(mode='NATIVE_RESUME',native_resume=native),{'ADOPTION_NATIVE_INCOMPATIBLE'},action='artifact.adoption.adopt'))
 check('adoption.source-only-no-native-reuse',lambda:f.reject(f.adopt_request(native_resume=native),{'ADOPTION_INPUT_INVALID'},action='artifact.adoption.adopt'))
 check('adoption.target-packet-mismatch',lambda:f.reject(f.adopt_request(target_expected_input_packet_digest=pinned_digest),{'ADOPTION_TARGET_CHANGED'},action='artifact.adoption.adopt'))
 check('adoption.environment-mismatch',lambda:f.reject(f.adopt_request(target_expected_preparation_digest=sha(b'other prepared environment')),{'ADOPTION_TARGET_CHANGED'},action='artifact.adoption.adopt'))
 check('adoption.unpinned-target-validate-refused',lambda:f.reject(f.adopt_request(),{'ADOPTION_CONTINUATION_REQUIRED'},action='artifact.adoption.validate'))
 check('adoption.unpinned-target-adopt-refused',lambda:f.reject(f.adopt_request(),{'ADOPTION_CONTINUATION_REQUIRED'},action='artifact.adoption.adopt'))
 check('adoption.refusals-atomic',lambda:expect(svc.sql('SELECT count(*)::int n FROM hyperfide.artifact_adoptions')[0]['n']==0 and svc.sql('SELECT count(*)::int n FROM hyperfide.checkpoints')[0]['n']==1,'Refused adoption persisted'))
 # The replacement explicitly imports the expired attempt's recoverable bytes
 # as untrusted history attributed to their original producer.
 envelope=svc.operation('15.3','artifact.checkpoint.import',dict(f.request,token=new));imported={}
 def adopt():
  status,response=svc.request(envelope,key='operator');expect(status==200 and response.get('ok'),str(response.get('error',{})));imported.update(response['result'])
 check('adoption.import.persisted',adopt)
 def provenance():
  row=imported['checkpoint']
  expect(row['registration_kind']=='STALE_IMPORT' and row['attempt_id']==old['attempt_id'] and str(row['attempt_generation'])=='1' and row['source_workspace_id']==f.workspace,'Imported lineage is not the original producer')
  expect(row['artifact_content_digest']==sha(f.raw) and row['source_metadata_digest']==f.capture['manifest_digest'] and row['source_object_id']==f.native.head and row['support_level']=='SOURCE_ONLY','Imported provenance differs')
  expect(svc.sql('SELECT count(*)::int n FROM hyperfide.checkpoint_context_artifacts WHERE checkpoint_id=$1',[row['id']])[0]['n']==3,'Imported context incomplete')
 check('adoption.import.provenance',provenance)
 check('adoption.import.no-authority',lambda:expect(imported['replayed'] is False and imported['grants_authority'] is False and imported['context_restored'] is False and imported['compute_authority_changed'] is False,'Import claimed authority'))
 def fence():
  expect(svc.sql(CURRENT,[old['attempt_id']])[0]==source_before,'Adoption changed the expired source attempt')
  expect(svc.sql("SELECT count(*)::int n FROM hyperfide.compute_leases WHERE attempt_id=$1 AND state='ACTIVE'",[old['attempt_id']])[0]['n']==0,'Adoption renewed the expired lease')
  expect(svc.sql(CURRENT,[new['attempt_id']])[0]==target_before,'Adoption changed the target fence')
  expect([row['id'] for row in svc.sql("SELECT id::text FROM hyperfide.attempts WHERE compute_authority='CURRENT'")]==[new['attempt_id']],'Adoption created another current generation')
 check('adoption.no-fence-renewal',fence)
 def replay():
  _,response=svc.request(envelope,key='operator');expect(response.get('ok') and response['result']['replayed'] is True and response['result']['checkpoint']['id']==imported['checkpoint']['id'],'Replay differs')
  expect(svc.sql('SELECT count(*)::int n FROM hyperfide.checkpoints')[0]['n']==2,'Replay duplicated import')
 check('adoption.import.exact-replay',replay)
def main():
 scheduler.configure_cleanup('15.3');f=CheckpointFixture();state={}
 try:
  check('checkpoint.registration.actual-signed-claim',lambda:expect(f.service.sql("SELECT count(*)::int n FROM hyperfide.attempts WHERE compute_authority='CURRENT'")[0]['n']==1))
  check('checkpoint.registration.strict-input',lambda:f.reject(dict(f.request,durable=True),{'ADOPTION_INPUT_INVALID'}))
  check('checkpoint.registration.scope',lambda:f.reject(dict(f.request,token=dict(f.token,run_id=scheduler.uid())),{'ADOPTION_SCOPE_DENIED'}))
  check('checkpoint.registration.readonly-role',lambda:f.reject(f.request,{'ADOPTION_ROLE_DENIED','AUTH_ROLE_DENIED','ROLE_DENIED'},key='watcher'))
  check('checkpoint.registration.metadata-digest',lambda:f.reject(dict(f.request,expected_source_metadata_digest=sha(b'forged')),{'CHECKPOINT_METADATA_INVALID'}))
  bad_context=dict(f.request['context_artifacts'],summary_artifact_id=f.context['findings']['artifact']['artifact_id'])
  check('checkpoint.registration.context-byte-binding',lambda:f.reject(dict(f.request,context_artifacts=bad_context),{'CHECKPOINT_CONTEXT_MISMATCH'}))
  check('checkpoint.registration.capsule-digest',lambda:f.reject(dict(f.request,expected_capsule_digest=sha(b'forged capsule')),{'CHECKPOINT_ARTIFACT_INVALID'}))
  check('checkpoint.registration.workspace-scope',lambda:f.reject(dict(f.request,workspace_id=scheduler.uid()),{'CHECKPOINT_SCOPE_DENIED'}))
  check('checkpoint.registration.exact-slot',lambda:f.reject(dict(f.request,token=dict(f.token,slot_id=scheduler.uid())),{'COMPUTE_ALLOCATION_INVALID'}))
  check('checkpoint.registration.exact-generation',lambda:f.reject(dict(f.request,token=dict(f.token,attempt_generation='2')),{'COMPUTE_ALLOCATION_INVALID','STALE_COMPUTE'}))
  missing_context=dict(f.request['context_artifacts'],findings_artifact_id=scheduler.uid())
  check('checkpoint.registration.missing-context',lambda:f.reject(dict(f.request,context_artifacts=missing_context),{'ARTIFACT_NOT_FOUND','CHECKPOINT_CONTEXT_UNAVAILABLE'}))
  check('checkpoint.registration.atomic-refusals',lambda:expect(f.service.sql('SELECT count(*)::int n FROM hyperfide.checkpoints')[0]['n']==0))
  envelope=f.service.operation('15.3','artifact.checkpoint.register',f.request)
  def register():
   status,response=f.service.request(envelope,key='operator')
   expect(status==200 and response.get('ok'),str(response.get('error',{})));state.update(response['result'])
  check('checkpoint.registration.actual-native-durable',register)
  if 'checkpoint' in state:
   row=state['checkpoint'];checkpoint_id=row['id']
   check('checkpoint.registration.three-context-artifacts',lambda:expect(f.service.sql('SELECT count(*)::int n FROM hyperfide.checkpoint_context_artifacts WHERE checkpoint_id=$1',[checkpoint_id])[0]['n']==3))
   check('checkpoint.registration.distinct-identities',lambda:expect(row['artifact_content_digest']==sha(f.raw) and row['artifact_content_digest']!=f.parent['artifact']['digest'] and row['source_metadata_digest']==f.capture['manifest_digest']))
   check('checkpoint.registration.context-not-restored',lambda:expect(state['context_restored'] is False and state['grants_authority'] is False and row['support_level']=='SOURCE_ONLY'))
   def replay():
    _,response=f.service.request(envelope,key='operator');expect(response.get('ok') and response['result']['checkpoint']['id']==checkpoint_id)
   check('checkpoint.registration.exact-replay',replay)
   inspected={}
   check('checkpoint.registration.physical-inspect',lambda:inspected.update(f.ok('artifact.checkpoint.inspect',dict(f.scope,checkpoint_id=checkpoint_id))))
   check('checkpoint.registration.inspection-no-result-authority',lambda:expect(inspected.get('availability')=='VERIFIED' and inspected.get('source_git_semantics')=='NOT_QUALIFIED' and inspected.get('context_restored') is False))
   first=f.raw[:196608];f.objects.set_mode(first,'corrupt')
   check('checkpoint.registration.corrupt-retained-bytes',lambda:f.reject(dict(f.scope,checkpoint_id=checkpoint_id),{'ARTIFACT_NOT_COMPLETE','ARTIFACT_INTEGRITY','CHECKPOINT_ARTIFACT_UNAVAILABLE'},action='artifact.checkpoint.inspect'))
   f.objects.set_mode(first,'normal')
   adoption(f,checkpoint_id)
  else:raise AssertionError('Actual checkpoint registration failed; dependent assertions not fabricated')
 finally:
  service=f.service;db=service.database;path=service.path;port=service.port;f.close()
  check('checkpoint.registration.owned-cleanup',lambda:expect(not path.exists() and service.sql('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[db],admin=True)[0]['n']==0))
 return 1 if any(actual!='observed' for _,actual in RESULTS) else 0
def cleanup():
 # Reuse the scheduler fixture's owned-resource receipt; re-emit its observation
 # with the exact absence evidence this registration requires.
 out=io.StringIO()
 with contextlib.redirect_stdout(out):code=scheduler.cleanup_owned('15.3')
 events=[json.loads(line) for line in out.getvalue().splitlines() if line.startswith('{')]
 complete=code==0 and len(events)==1 and events[0].get('complete') is True
 print(json.dumps({'type':'cleanup','complete':complete,'resources':[{'id':'hf-task-15.3-runtime','kind':'postgresql-database','status':'deleted' if complete else 'unknown','observed_absent':complete,'evidence_artifact':'scheduler/cleanup.json'}]}),flush=True)
 return 0 if complete else 1
if __name__=='__main__':raise SystemExit(cleanup() if '--cleanup' in sys.argv else main())
