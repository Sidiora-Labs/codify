#!/usr/bin/env python3
"""Real packet/claim/native capsule/object-store/checkpoint registration integration.

A source registration is recoverable data, never restored context or result
acceptance. Replacement adoption tests require the mandatory continuation producer.
"""
from __future__ import annotations
import base64,hashlib,importlib.util,json,os,socket,tempfile
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
 def close(self):
  if self.service is not None:self.service.close();self.service=None
  if self.objects is not None:self.objects.stop();self.objects=None
  self.temp.cleanup()
def main():
 f=CheckpointFixture();state={}
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
  else:raise AssertionError('Actual checkpoint registration failed; dependent assertions not fabricated')
 finally:
  service=f.service;db=service.database;path=service.path;port=service.port;f.close()
  check('checkpoint.registration.owned-cleanup',lambda:expect(not path.exists() and service.sql('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[db],admin=True)[0]['n']==0))
 return 1 if any(actual!='observed' for _,actual in RESULTS) else 0
if __name__=='__main__':raise SystemExit(main())
