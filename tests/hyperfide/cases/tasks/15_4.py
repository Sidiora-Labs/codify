#!/usr/bin/env python3
"""Actual signed HTTPS/PG retention transitions and independently checked SigV4 DELETE.
Current-object absence is bounded fixture evidence, never historical-version erasure.
"""
from __future__ import annotations
import base64,hashlib,importlib.util,json,os,socket,sys,tempfile,threading
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
objects=module('actual_artifact_objects',ROOT/'tests/hyperfide/cases/tasks/15_2.py')
identity=module('actual_retention_identity',ROOT/'tests/hyperfide/support/identity_fixture.py')
IDS=['retention.reference.unresolved-finding', 'retention.reference.finding-reopen', 'retention.actual.authenticated', 'retention.policy.required', 'retention.policy.digest', 'retention.minimum-age', 'retention.indefinite', 'retention.deadline', 'retention.explicit-hold', 'retention.reference.hold', 'retention.reference.release', 'retention.policy.audit', 'retention.collect.conditional', 'retention.collect.deleted-unreadable', 'retention.collect.no-blind-retry', 'retention.reconcile.absent', 'retention.delete.forbidden', 'retention.delete.precondition', 'retention.delete.etag-required', 'retention.delete.redirect', 'retention.reference.quarantine-race', 'retention.manifest.children', 'retention.scope.authenticated', 'retention.auth.required', 'retention.gc.binding', 'retention.gc.idempotency-conflict', 'retention.reference.release-audit', 'retention.reference.foreign-key-id', 'retention.reference.foreign-key-digest', 'retention.cleanup.physical']
RESULTS=[]
def expect(value,message):
 if not value:raise AssertionError(message)
def check(name,call):
 try:call();actual='observed'
 except Exception as error:actual=type(error).__name__+': '+str(error)
 RESULTS.append((name,actual));print(json.dumps({'type':'assertion','id':name,'expected':'observed','actual':actual}),flush=True)
def sha(data):return 'sha256:'+hashlib.sha256(data).hexdigest()
def output():
 p=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/task-15.4-standalone'))/'retention';p.mkdir(parents=True,exist_ok=True);return p
class DeleteFixture(objects.ObjectFixture):
 def __init__(self):
  super().__init__();self.delete_modes={};self.deletes=[]
  fixture=self;handler=self.http.RequestHandlerClass;reply=handler.reply
  def patched_reply(h,status,data=b'',*,length=None,headers=None):
   headers=dict(headers or {})
   if h.command=='GET' and status==200:
    if fixture.delete_modes.get(h.path)=='no-etag':headers.pop('ETag',None)
    else:headers['ETag']='"opaque-'+hashlib.sha256(data).hexdigest()+'"'
   return reply(h,status,data,length=length,headers=headers)
  def delete(h):
   length=int(h.headers.get('content-length','0'));body=h.rfile.read(length)
   if not fixture.signature('DELETE',h.path,h.headers,body):
    fixture.bad_signatures.append({'method':'DELETE'});h.reply(403);return
   fixture.deletes.append({'path':h.path,'if_match':h.headers.get('if-match'),'signature_verified':True})
   mode=fixture.delete_modes.get(h.path,'')
   if mode=='forbidden':h.reply(403);return
   if mode=='redirect':h.reply(307,headers={'Location':fixture.sink_url+h.path});return
   with fixture.lock:
    if mode=='replace':fixture.objects[h.path]=b'concurrently-replaced-content'
    data=fixture.objects.get(h.path)
    if data is None:h.reply(404);return
    if h.headers.get('if-match')!='"opaque-'+hashlib.sha256(data).hexdigest()+'"':
     h.reply(412);return
    del fixture.objects[h.path]
   if mode=='lost':
    h.close_connection=True
    try:h.connection.shutdown(socket.SHUT_RDWR)
    except OSError:pass
    return
   h.reply(204)
  handler.reply=patched_reply;handler.do_DELETE=delete
def main():
 backend=DeleteFixture();service=None;closed=False
 policy={'schema_version':1,'organisation_id':None,'policy_id':identity.uid(),'policy_revision':1,
 'minimum_age_ms':{'EPHEMERAL':0,'RUN':None,'RELEASE':None,'LEGAL_HOLD':None}}
 scope={};policy_path=None;policy_digest=None
 try:
  def setup(f):
   nonlocal policy_path,policy_digest,scope
   scope={'organisation_id':f.ids['organisation'],'run_id':f.ids['run']}
   objects.ORG=scope['organisation_id'];objects.RUN=scope['run_id'];objects.SCOPE=scope
   for name in ['0015-artifact-adoption.sql','0029-artifact-retention.sql']:
    raw=(ROOT/'services/hyperfide/migrations'/name).read_bytes()
    f.sql(raw.decode())
    f.sql('INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[int(name[:4]),name[:-4],sha(raw)])
   f.sql("CREATE TABLE hyperfide.fixture_release_links(organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),artifact_id uuid NOT NULL,PRIMARY KEY(organisation_id,run_id,id),FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id));CREATE TABLE hyperfide.fixture_prepared_links(organisation_id uuid NOT NULL,source_run_id uuid NOT NULL,manifest_digest hyperfide.digest NOT NULL,PRIMARY KEY(organisation_id,source_run_id,manifest_digest),FOREIGN KEY(organisation_id,source_run_id,manifest_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest));")
   policy['organisation_id']=scope['organisation_id'];policy_path=f.path/'retention-policy.json'
   raw=json.dumps(policy,separators=(',',':')).encode();policy_path.write_bytes(raw);policy_digest=sha(raw)
   f.env.update({'HF_ARTIFACT_RETENTION_POLICY_FILE':str(policy_path),
   'HF_ARTIFACT_S3_ENDPOINT':backend.endpoint,'HF_ARTIFACT_ALLOW_LOOPBACK_HTTP':'1',
   'HF_ARTIFACT_S3_REGION':objects.REGION,'HF_ARTIFACT_S3_BUCKET':objects.BUCKET,
   'HF_ARTIFACT_S3_ACCESS_KEY_ID':objects.KEY,'HF_ARTIFACT_S3_SECRET_ACCESS_KEY':objects.SECRET,
   'HF_ARTIFACT_S3_SESSION_TOKEN':objects.TOKEN,'HF_ARTIFACT_ORGANISATION_ID':scope['organisation_id'],
   'HF_ARTIFACT_ALLOWED_RUN_IDS':json.dumps([scope['run_id']])})
  service=identity.IdentityFixture(extra_components=('15.2','15.4'),extra_setup=setup,database='hf_task_15_4_qualification')
  def invoke(action,value,*,body=None):
   return service.request(body or service.operation('15.4',action,value))
  def ok(action,value,component='15.4',body=None):
   status,response=service.request(body or service.operation(component,action,value))
   expect(status==200 and response.get('ok') is True,'actual service rejected operation: '+str(response.get('error',{}).get('code')))
   return response['result']
  def rejected(action,value,codes):
   _,response=invoke(action,value)
   expect(response.get('ok') is False and response.get('error',{}).get('code') in set(codes),'rejection differs: '+str(response.get('error',{}).get('code')))
  def put(data,**changes):
   value=dict(scope,digest=sha(data),size_bytes=str(len(data)),data_base64=base64.b64encode(data).decode(),retention_class='EPHEMERAL',retention_until=None,retention_hold=False);value.update(changes)
   result=ok('artifact.object.put',value,component='15.2');objects.verified(result,data);return result
  def ref(result):return dict(scope,artifact_id=result['artifact']['artifact_id'],policy_digest=policy_digest)
  def inspect(result):return ok('artifact.retention.inspect',ref(result))
  def collect(result,body=None):
   value=dict(ref(result),expected_state_version=result['artifact']['state_version'],reason='fixture retention boundary')
   return ok('artifact.retention.collect',value,body=body)
  historical={}
  def finding_retention():
   # Historical RELEASED metadata has no compute lease, current attempt or
   # qualification claim. Only the artifact itself comes from real durable PUT.
   evidence_artifact=put(b'historical unresolved finding bytes')
   names=['repository','package','task','attempt','evidence','finding','observer']
   h={name:identity.uid() for name in names};historical.update(h);historical['artifact']=evidence_artifact
   o,r=scope['organisation_id'],scope['run_id'];git='d'*40
   service.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'retention-history','https://example.invalid/retention.git')",[o,h['repository'],service.ids['project']])
   service.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[o,h['repository'],git])
   service.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/retention-history')",[o,r,h['repository'],git])
   service.sql("INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,'retention-history',1)",[o,r,h['package']])
   service.sql("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,'retention-history',$4,$5,$6,'{}',1)",[o,r,h['task'],h['package'],service.ids['spec'],sha(b'criteria')])
   service.sql("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,compute_authority,execution_state) VALUES($1,$2,$3,$4,1,$5,$6,'RELEASED','FAILED')",[o,r,h['attempt'],h['task'],service.ids['epoch'],sha(b'historical-packet')])
   service.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,state) VALUES($1,$2,$3,'COMMIT_WATCHER','fixture','fixture',$4,'STOPPED')",[o,r,h['observer'],identity.uid()])
   service.sql("INSERT INTO hyperfide.evidence(organisation_id,run_id,id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest,manifest_digest,artifact_id,admission_state) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,'STALE')",[o,r,h['evidence'],h['attempt'],h['repository'],git,sha(b'criteria'),evidence_artifact['artifact']['digest'],evidence_artifact['artifact']['artifact_id']])
   service.sql("INSERT INTO hyperfide.findings(organisation_id,run_id,id,dedup_digest,owner_package_id,repository_id,source_object_id,severity,summary) VALUES($1,$2,$3,$4,$5,$6,$7,'ERROR','Synthetic historical finding')",[o,r,h['finding'],sha(b'finding'),h['package'],h['repository'],git])
   service.sql("INSERT INTO hyperfide.finding_observations(organisation_id,run_id,finding_id,evidence_id,observer_session_id) VALUES($1,$2,$3,$4,$5)",[o,r,h['finding'],h['evidence'],h['observer']])
   expect('UNRESOLVED_FINDING' in inspect(evidence_artifact)['blockers'],'STALE evidence lost unresolved finding retention')
   expect(collect(evidence_artifact)['operation']['state']=='RETAINED','GC deleted an unresolved finding artifact')
   expect(service.sql("SELECT count(*)::int n FROM hyperfide.compute_leases")[0]['n']==0,'Historical retention fixture fabricated a compute lease')
  check('retention.reference.unresolved-finding',finding_retention)
  def finding_reopen():
   h=historical
   service.sql("UPDATE hyperfide.findings SET state='RESOLVED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope['organisation_id'],scope['run_id'],h['finding']])
   expect(collect(h['artifact'])['current_object_absent'] is True,'Resolved historical finding was retained forever')
   rejected_reopen=False
   try:service.sql("UPDATE hyperfide.findings SET state='OPEN',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope['organisation_id'],scope['run_id'],h['finding']])
   except AssertionError:rejected_reopen=True
   expect(rejected_reopen,'Finding reopened against deleted evidence without the artifact lock')
  check('retention.reference.finding-reopen',finding_reopen)
  check('retention.actual.authenticated',lambda:expect(ok('identity.describe',{},component='14.1')['principal']['run_id']==scope['run_id'],'actual signed identity scope differs'))
  first=put(b'actual retention deletion')
  def no_policy():
   service.stop();name=service.env.pop('HF_ARTIFACT_RETENTION_POLICY_FILE')
   try:service.start();rejected('artifact.retention.inspect',ref(first),['RETENTION_POLICY_REQUIRED'])
   finally:service.stop();service.env['HF_ARTIFACT_RETENTION_POLICY_FILE']=name;service.start()
  check('retention.policy.required',no_policy)
  check('retention.policy.digest',lambda:rejected('artifact.retention.inspect',dict(ref(first),policy_digest=sha(b'wrong-policy')),['RETENTION_POLICY_CHANGED']))
  def minimum_age():
   old=policy_path.read_bytes();policy['minimum_age_ms']['EPHEMERAL']=60000;raw=json.dumps(policy,separators=(',',':')).encode();policy_path.write_bytes(raw)
   try:
    result=ok('artifact.retention.inspect',dict(ref(first),policy_digest=sha(raw)))
    expect(not result['eligible'] and 'MINIMUM_AGE' in result['blockers'],'minimum age ignored')
   finally:policy['minimum_age_ms']['EPHEMERAL']=0;policy_path.write_bytes(old)
  check('retention.minimum-age',minimum_age)
  run=put(b'indefinite run artifact',retention_class='RUN')
  check('retention.indefinite',lambda:expect('INDEFINITE_RETENTION' in inspect(run)['blockers'],'indefinite class ignored'))
  future=put(b'future deadline',retention_until='2099-01-01T00:00:00.000Z')
  check('retention.deadline',lambda:expect('RETENTION_DEADLINE' in inspect(future)['blockers'],'retention deadline ignored'))
  held=put(b'explicit legal hold',retention_class='LEGAL_HOLD',retention_hold=True)
  check('retention.explicit-hold',lambda:expect(not inspect(held)['eligible'],'legal hold eligible'))
  h=None
  def add_hold():
   nonlocal h
   h=ok('artifact.retention.hold',dict(ref(first),reference_kind='LEGAL',reference_id=identity.uid(),reason='owned legal case',expires_at=None))['hold']
   expect('ACTIVE_HOLD' in inspect(first)['blockers'],'active reference did not block')
  check('retention.reference.hold',add_hold)
  def release_hold():
   ok('artifact.retention.release',dict(scope,hold_id=h['id'],expected_state_version=str(h['state_version']),reason='case resolved',policy_digest=policy_digest))
   expect(inspect(first)['eligible'],'released hold still blocks candidate')
  check('retention.reference.release',release_hold)
  def audited_policy():
   result=ok('artifact.retention.policy',dict(ref(run),expected_state_version=run['artifact']['state_version'],retention_class='EPHEMERAL',retention_until=None,retention_hold=False,reason='approved archive release'))
   expect(result['event']['before_policy']['retention_class']=='RUN' and result['event']['after_policy']['retention_class']=='EPHEMERAL','policy audit missing before/after')
  check('retention.policy.audit',audited_policy)
  deleted=None
  def conditional_delete():
   nonlocal deleted
   deleted=collect(first)
   expect(deleted['current_object_absent'] and not deleted['cleanup_debt'] and deleted['physical_version_erasure']=='NOT_QUALIFIED','current-object absence proof incorrect')
   expect(backend.deletes[-1]['if_match'] and backend.deletes[-1]['signature_verified'],'DELETE lacked signed conditional binding')
   expect(backend.key(b'actual retention deletion') not in backend.objects,'physical object remains')
  check('retention.collect.conditional',conditional_delete)
  check('retention.collect.deleted-unreadable',lambda:expect(ok('artifact.retention.inspect',ref(first))['status']=='DELETED','deleted artifact metadata differs'))
  lost=put(b'lost delete response');backend.delete_modes[backend.key(b'lost delete response')]='lost';unknown=None
  def unknown_delete():
   nonlocal unknown
   before=len(backend.deletes);unknown=collect(lost)
   expect(unknown['cleanup_debt'] and not unknown['current_object_absent'] and len(backend.deletes)==before+1,'ambiguous delete was retried or called complete')
  check('retention.collect.no-blind-retry',unknown_delete)
  def reconcile():
   before=len(backend.deletes)
   result=ok('artifact.retention.reconcile',dict(scope,gc_operation_id=unknown['operation']['operation_id'],policy_digest=policy_digest))
   expect(result['current_object_absent'] and len(backend.deletes)==before,'absent object was blindly deleted again')
  check('retention.reconcile.absent',reconcile)
  def delete_fault(label):
   data=('retention fault '+label).encode();artifact=put(data);path=backend.key(data);backend.delete_modes[path]=label
   before=len(backend.deletes);result=collect(artifact)
   expect(result['cleanup_debt'] and not result['current_object_absent'] and path in backend.objects,'uncertain deletion lost explicit debt')
   if label=='no-etag':expect(len(backend.deletes)==before,'DELETE executed without strong ETag')
   return artifact
  check('retention.delete.forbidden',lambda:delete_fault('forbidden'))
  replaced=None
  def replace():
   nonlocal replaced
   replaced=delete_fault('replace');expect(backend.objects[backend.key(b'retention fault replace')]==b'concurrently-replaced-content','conditional mismatch deleted replacement')
  check('retention.delete.precondition',replace)
  check('retention.delete.etag-required',lambda:delete_fault('no-etag'))
  check('retention.delete.redirect',lambda:expect(delete_fault('redirect') and not backend.redirect_hits,'credentialed DELETE redirect followed'))
  def late_hold():
   rejected('artifact.retention.hold',dict(ref(replaced),reference_kind='LEGAL',reference_id=identity.uid(),reason='late case',expires_at=None),['RETENTION_UNAVAILABLE'])
   try:
    service.sql("INSERT INTO hyperfide.artifact_holds(organisation_id,run_id,artifact_id,reference_kind,reference_id,reason,authority_actor,policy_digest) VALUES($1,$2,$3,'LEGAL',$4,'late direct reference','fixture',$5)",[scope['organisation_id'],scope['run_id'],replaced['artifact']['artifact_id'],identity.uid(),policy_digest])
   except AssertionError:return
   raise AssertionError('DB allowed new reference after quarantine')
  check('retention.reference.quarantine-race',late_hold)
  def parent_dependency():
   data=b'child retained by complete manifest';child=put(data)
   value=dict(scope,expected_chunks=1,total_size_bytes=str(len(data)),content_digest=sha(data),complete=True,truncated=False,missing_ranges=[],chunks=[{'sequence':0,'artifact_id':child['artifact']['artifact_id'],'digest':sha(data),'size_bytes':str(len(data)),'offset_bytes':'0'}],retention_class='EPHEMERAL',retention_until=None,retention_hold=False)
   ok('artifact.manifest.commit',value,component='15.2')
   expect('COMPLETE_PARENT' in inspect(child)['blockers'],'complete parent did not retain child')
  check('retention.manifest.children',parent_dependency)
  check('retention.scope.authenticated',lambda:rejected('artifact.retention.inspect',dict(ref(run),run_id=identity.uid()),['RETENTION_SCOPE_DENIED']))
  def auth_required():
   import subprocess
   script="import {createComponent} from './services/hyperfide/dist/artifacts/retention.js';try{await createComponent({}).actions['artifact.retention.inspect']({},{});process.exitCode=2;}catch(e){console.log(e.code);if(e.code!=='AUTH_REQUIRED')process.exitCode=3;}"
   result=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,text=True,capture_output=True,timeout=10)
   expect(result.returncode==0 and result.stdout.strip()=='AUTH_REQUIRED','unverified retention invocation accepted')
  check('retention.auth.required',auth_required)
  def gc_binding():
   row=service.sql('SELECT * FROM hyperfide.artifact_gc_operations WHERE organisation_id=$1 AND run_id=$2 ORDER BY created_at LIMIT 1',[scope['organisation_id'],scope['run_id']])[0]
   try:service.sql("UPDATE hyperfide.artifact_gc_operations SET storage_key='different' WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",[scope['organisation_id'],scope['run_id'],row['operation_id']])
   except AssertionError:return
   raise AssertionError('GC binding was mutable')
  check('retention.gc.binding',gc_binding)
  def replay_conflict():
   candidate=put(b'idempotent gc');value=dict(ref(candidate),expected_state_version=candidate['artifact']['state_version'],reason='first operation')
   body=service.operation('15.4','artifact.retention.collect',value);ok('artifact.retention.collect',value,body=body)
   changed=dict(value,reason='changed operation');again=service.operation('15.4','artifact.retention.collect',changed)
   again['operation_id']=body['operation_id']
   _,response=service.request(again)
   expect(response.get('ok') is False,'operation identity accepted another payload')
  check('retention.gc.idempotency-conflict',replay_conflict)

  def release_audit():
   row=service.sql('SELECT * FROM hyperfide.artifact_holds WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope['organisation_id'],scope['run_id'],h['id']])[0]
   expect(row['release_actor']==service.ids['operator'] and row['release_reason']=='case resolved' and row['release_policy_digest']==policy_digest and row['release_operation_id'],'release audit lost actual actor/reason/policy/operation')
   try:service.sql("UPDATE hyperfide.artifact_holds SET release_reason='rewritten' WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope['organisation_id'],scope['run_id'],h['id']])
   except AssertionError:return
   raise AssertionError('released hold audit could be rewritten')
  check('retention.reference.release-audit',release_audit)
  def discovered_fk(kind):
   data=('discovered reference '+kind).encode();artifact=put(data)
   if kind=='id':
    service.sql('INSERT INTO hyperfide.fixture_release_links(organisation_id,run_id,artifact_id) VALUES($1,$2,$3)',[scope['organisation_id'],scope['run_id'],artifact['artifact']['artifact_id']])
    table='fixture_release_links';column='artifact_id';value=artifact['artifact']['artifact_id']
   else:
    service.sql('INSERT INTO hyperfide.fixture_prepared_links(organisation_id,source_run_id,manifest_digest) VALUES($1,$2,$3)',[scope['organisation_id'],scope['run_id'],artifact['artifact']['digest']])
    table='fixture_prepared_links';column='manifest_digest';value=artifact['artifact']['digest']
   expect('UNRELEASED_REFERENCE:hyperfide.'+table in inspect(artifact)['blockers'],'actual foreign key was not discovered')
   before=len(backend.deletes);result=collect(artifact)
   expect(result['operation']['state']=='RETAINED' and len(backend.deletes)==before and backend.key(data) in backend.objects,'referenced object was physically destroyed')
   service.sql('DELETE FROM hyperfide.'+table+' WHERE organisation_id=$1 AND '+column+'=$2',[scope['organisation_id'],value])
   expect(inspect(artifact)['eligible'],'released fixture reference still blocks candidate')
   expect(collect(artifact)['current_object_absent'],'released unneeded object could not be collected')
  check('retention.reference.foreign-key-id',lambda:discovered_fk('id'))
  check('retention.reference.foreign-key-digest',lambda:discovered_fk('digest'))
  owned=service;owned.close();database_absent=not owned.sql('SELECT datname FROM pg_database WHERE datname=$1',[owned.database],admin=True);service=None;closed=backend.stop()
  check('retention.cleanup.physical',lambda:expect(closed and database_absent,'owned fixture database/listener remains'))
 finally:
  if service:service.close()
  if not closed:backend.stop()
  (output()/'observations.json').write_text(json.dumps({'scope':'task-component','live_version_erasure':'NOT_EVALUATED','checks':RESULTS,'delete_operations':backend.deletes,'bad_signatures':backend.bad_signatures,'fixture_observed_absent':True},sort_keys=True)+'\n')
 expect([name for name,_ in RESULTS]==IDS,'retention assertion inventory differs')
 return 0 if all(actual=='observed' for _,actual in RESULTS) else 1
if __name__=='__main__':raise SystemExit(main())
