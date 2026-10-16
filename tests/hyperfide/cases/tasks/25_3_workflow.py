#!/usr/bin/env python3
"""Actual signed HTTPS/PG workflow adapter tests. No status or proof promotion."""
import importlib.util,json,sys,os,subprocess,socket,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
spec=importlib.util.spec_from_file_location('workflow_hierarchy_fixture',ROOT/'tests/hyperfide/cases/tasks/3_1.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
HierarchyFixture=module.HierarchyFixture
FAILED=[]
def expect(value,message='Unexpected actual workflow behavior'):
 if not value:raise AssertionError(message)
def check(name,fn):
 try:fn();actual='observed'
 except Exception as error:FAILED.append(name);actual=type(error).__name__+': '+str(error)
 print(json.dumps({'type':'assertion','id':'workflow.'+name,'expected':'observed','actual':actual}),flush=True)
def main():
 def seed(f):
  f.ids['large_task']=module.uid();f.sql('INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)',[f.ids['organisation'],f.ids['run'],f.ids['large_task'],'alpha.large',f.ids['package'],f.ids['spec'],module.sha(b'large-criteria'),json.dumps({'title':'123','touches':['src/b.c'],'context':'x'*8000})])
 f=HierarchyFixture(extra_components=('3.3','25.3-workflow'),extra_setup=seed);i=f.ids;state={}
 def payload(task=None,**extra):return dict(task=task or i['task'],leader_generation='1',package_generation='2',**extra)
 def ok(action,value,key='leader'):
  return f.ok(action,value,key=key,component='25.3-workflow')
 def no(action,value,code,key='leader'):
  return f.reject(action,value,code,key=key,component='25.3-workflow')
 try:
  opened=ok('work.open',payload());state['revision']=opened['revision']
  check('open.actual-accepted-task-criteria',lambda:expect(opened['task_id']==i['task'] and opened['criteria']['digest']==module.sha(b'criteria') and opened['allowed_scope']==['src/a.c']))
  # Real exported native dispatcher boundary, linked against exact supplier C.
  # Full cg startup is separately tested by the25/26 owners; no transport stub.
  native_source=f.path/'workflow-native.c';native=f.path/'workflow-native'
  native_source.write_text('#include <stdio.h>\nint hf_client_dispatch(int,char**,FILE*,FILE*);\nint main(int n,char**v){int r=hf_client_dispatch(n,v,stdout,stderr);return r<0?90:r;}\n')
  build_command=['cc','-Wall','-Wextra','-Werror','-O2','-I',str(ROOT/'src/hyperfide'),str(native_source),str(ROOT/'src/hyperfide/client.c'),str(ROOT/'src/hyperfide/transport.c'),'-lcurl','-lcrypto','-lpthread','-o',str(native)];compiled=subprocess.run(build_command,capture_output=True,text=True);expect(compiled.returncode==0,'Actual native dispatcher build failed: '+compiled.stderr[:1600])
  native_evidence={'scope':'TASK_COMPONENT_NATIVE_DISPATCH','build_command':build_command,'driver_source_digest':module.sha(native_source.read_bytes()),'compiler_version':subprocess.check_output(['cc','--version'],text=True).splitlines()[0],'executable_digest':module.sha(native.read_bytes()),'sources':{str(path.relative_to(ROOT)):module.sha(path.read_bytes()) for path in (ROOT/'src/hyperfide/client.c',ROOT/'src/hyperfide/transport.c',ROOT/'src/hyperfide/transport.h')}}
  evidence_path=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/legacy-workflow-artifacts'))/'workflow-native-evidence.json';evidence_path.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(native,evidence_path.parent/'workflow-native.bin');shutil.copyfile(native_source,evidence_path.parent/'workflow-native-driver.c');native_evidence.update(executable_artifact='workflow-native.bin',driver_source_artifact='workflow-native-driver.c');evidence_path.write_text(json.dumps(native_evidence,sort_keys=True,indent=2)+'\n')
  config=f.path/'workflow-native-transport.json';config.write_text(json.dumps({'origin':f.origin,'ca_file':str(f.ca),'key_path':str(f.keys['manager']['path']),'credential_id':f.ids['manager'],'timeout_ms':5000}));config.chmod(0o600)
  marker=f.path/'workflow-authority.json';marker.write_text(json.dumps({'schema_version':1,'mode':'distributed','authority_epoch':i['epoch']}));marker.chmod(0o600)
  env={k:v for k,v in os.environ.items() if not k.startswith(('HYPERFIDE_','CG_','CODIFY_')) and k not in ('DATABASE_URL','ANTHROPIC_API_KEY','OPENAI_API_KEY')};env.update(HYPERFIDE_MODE='distributed',HYPERFIDE_AUTHORITY_DESCRIPTOR=str(marker),HYPERFIDE_TRANSPORT_CONFIG=str(config))
  def native_cli(sub,value):
   path=f.path/'workflow-native-input.json';path.write_text(json.dumps(value));args=[str(native),'work',sub,'--input-file',str(path),'--run-id',i['run'],'--operation-id',module.uid(),'--idempotency-key',module.uid(),'--correlation-id',module.uid()];r=subprocess.run(args,cwd=f.path,env=env,capture_output=True,text=True,timeout=15);expect(r.returncode==0,'Real native finite route failed: '+r.stderr[:500]);body=json.loads(r.stdout);expect(body.get('ok') is True,str(body));return body['result']
  def verify_native(value):
   row=f.sql('SELECT t.id,t.criteria_digest,t.feature_package_id,p.manager_session_id,h.owner_generation::text FROM hyperfide.tasks t JOIN hyperfide.feature_packages p ON p.organisation_id=t.organisation_id AND p.run_id=t.run_id AND p.id=t.feature_package_id JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.id WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.id=$3',[i['organisation'],i['run'],i['task']])[0];owner=value['state']['task']['current_ownership'];expect(value['task_id']==row['id'] and value['criteria']['digest']==row['criteria_digest'] and owner['package_id']==row['feature_package_id'] and owner['package_generation']==row['owner_generation'] and owner['session_id']==row['manager_session_id'])
  def cli_open():
   value=native_cli('open',payload());verify_native(value);state['native_revision']=value['revision']
  check('native.cli-open-actual-manager-primary',cli_open)
  def cli_update():
   value=native_cli('update',{'revision':state['native_revision'],'leader_generation':'1','package_generation':'2'});expect(value['unchanged'] is True and value['revision']==state['native_revision'] and value['execution_authority'] is False)
  check('native.cli-update-actual-opaque-revision',cli_update)
  def native_mcp(name,value):
   request={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':{'run_id':i['run'],'input':value,'operation_id':module.uid(),'idempotency_key':module.uid(),'correlation_id':module.uid()}}};r=subprocess.run([str(native),'mcp'],cwd=f.path,env=env,input=json.dumps(request)+'\n',capture_output=True,text=True,timeout=15);expect(r.returncode==0,'Native MCP failed: '+r.stderr[:500]);reply=json.loads(r.stdout);expect(reply.get('result',{}).get('isError') is False,str(reply));body=json.loads(reply['result']['content'][0]['text']);expect(body.get('ok') is True,str(body));return body['result']
  check('native.mcp-open-actual-manager-primary',lambda:verify_native(native_mcp('work_open',payload())))
  def mcp_update():
   value=native_mcp('work_update',{'revision':state['native_revision'],'leader_generation':'1','package_generation':'2'});expect(value['unchanged'] is True and value['revision']==state['native_revision'])
  check('native.mcp-update-actual-opaque-revision',mcp_update)
  def native_receipt():
   rows=f.sql("SELECT result,state FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='legacy.work.revision' AND idempotency_key=$4",[i['organisation'],i['run'],i['manager'],state['native_revision']]);expect(len(rows)==1 and rows[0]['state']=='COMPLETED' and rows[0]['result']['actor_id']==i['manager'] and rows[0]['result']['snapshot']['task']['id']==i['task'])
  check('native.primary-revision-receipt-bound-to-manager',native_receipt)

  check('open.primary-provenance-no-grant',lambda:expect(opened['provenance']['source']=='POSTGRESQL_PRIMARY' and opened['provenance']['cache'] is False and opened['execution_authority'] is False and opened['authority']=='NONE'))
  check('open.actual-historical-task-state',lambda:expect(opened['state']['task']['state']=='RUNNING' and opened['state']['task']['current_attempt_id']==i['attempt']))
  check('open.unsupported-context-explicit',lambda:expect(all(x['available'] is False for x in opened['omitted_context'].values())))
  check('open.task-key-resolves-same-revision',lambda:expect(ok('work.open',payload('alpha.1'))['revision']==opened['revision']))
  check('open.manager-real-scope',lambda:expect(ok('work.open',payload(),key='manager')['task_id']==i['task']))
  check('open.revision-is-actor-scoped',lambda:expect(ok('work.open',payload(),key='manager')['revision']!=opened['revision']))
  check('open.foreign-manager-refused',lambda:no('work.open',payload(),'PACKAGE_OWNER_MISMATCH',key='manager2'))
  check('open.watcher-refused',lambda:no('work.open',payload(),'ROLE_DENIED',key='watcher'))
  check('open.unknown-task-refused',lambda:no('work.open',payload(module.uid()),'WORK_TASK_UNAVAILABLE'))
  check('open.caller-identity-refused',lambda:no('work.open',dict(payload(),organisation_id=i['organisation']),'INVALID_REQUEST'))
  check('open.task-state-write-refused',lambda:no('work.open',dict(payload(),state='QUALIFIED'),'INVALID_REQUEST'))
  check('open.numeric-generation-refused',lambda:no('work.open',dict(payload(),leader_generation=1),'INVALID_REQUEST'))
  def exact_replay():
   body=f.operation('25.3-workflow','work.open',payload());state['read_request']=body;a=f.request(body,key='leader')[1];b=f.request(body,key='leader')[1];expect(a.get('ok') is True and a==b,'Signed exact replay changed stored read result')
  check('open.signed-envelope-exact-replay',exact_replay)
  def conflict():
   a=f.operation('25.3-workflow','work.open',payload());expect(f.request(a,key='leader')[1].get('ok') is True);b=f.operation('25.3-workflow','work.open',payload(i['task2']));b['idempotency_key']=a['idempotency_key'];response=f.request(b,key='leader')[1];expect(response.get('error',{}).get('code')=='IDEMPOTENCY_CONFLICT','Outer envelope reuse did not bind payload')
  check('open.envelope-conflicting-payload-refused',conflict)
  update=dict(revision=opened['revision'],leader_generation='1',package_generation='2');state['update_request']=f.operation('25.3-workflow','work.update',update);raw=f.request(state['update_request'],key='leader')[1];expect(raw.get('ok') is True);unchanged=raw['result']
  check('update.unchanged-revision-stable',lambda:expect(unchanged['unchanged'] is True and unchanged['revision']==opened['revision'] and unchanged['deltas']['state'] is None))
  check('update.actor-revision-isolation',lambda:no('work.update',update,'WORK_REVISION_UNAVAILABLE',key='manager'))
  check('update.unknown-revision-refused',lambda:no('work.update',dict(update,revision='sha256:'+'0'*64),'WORK_REVISION_UNAVAILABLE'))
  check('update.malformed-revision-refused',lambda:no('work.update',dict(update,revision='local-offline-token'),'INVALID_REQUEST'))
  check('update.completion-write-refused',lambda:no('work.update',dict(update,status='done'),'INVALID_REQUEST'))
  check('update.stale-owner-generation-refused',lambda:no('work.update',dict(update,package_generation='1'),'PACKAGE_GENERATION_STALE'))
  def budget():
   before=f.sql("SELECT count(*)::text AS n FROM hyperfide.command_inbox WHERE operation='legacy.work.revision'")[0]['n'];no('work.open',payload(i['large_task'],max_bytes=4096),'WORK_PACKET_BUDGET_TOO_SMALL');after=f.sql("SELECT count(*)::text AS n FROM hyperfide.command_inbox WHERE operation='legacy.work.revision'")[0]['n'];expect(before==after,'Failed bounded packet left a revision behind')
  check('open.complete-intent-budget-rollback',budget)
  check('open.numeric-looking-title-remains-text',lambda:expect(ok('work.open',payload(i['large_task']))['objective']=='123'))
  projection={'leader_generation':'1','package_id':i['package'],'package_generation':'2','page_size':10,'max_bytes':262144};view=ok('work.projection',projection,key='manager')
  check('projection.actual-hierarchy-primary-view',lambda:expect(view['projection_kind']=='DISTRIBUTED_WORKFLOW' and view['view']['authority']=='NONE' and view['view']['scope']['package_id']==i['package'] and view['view']['provenance']['source']=='POSTGRESQL_PRIMARY'))
  check('projection.never-claims-branch-folding',lambda:expect(view['folded_branch_projection']['available'] is False))
  check('projection.total-response-byte-bound',lambda:expect(len(json.dumps(ok('work.projection',dict(projection,max_bytes=4096)),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())<=4096))
  check('projection.unowned-package-refused',lambda:no('work.projection',dict(projection,package_id=i['wave_package']),'PACKAGE_OWNER_MISMATCH',key='manager'))
  check('projection.branch-build-write-refused',lambda:no('work.projection',dict(projection,build=True),'INVALID_REQUEST'))
  check('handoff.unknown-phase-refused',lambda:no('work.handoff',{'phase':'replace','request':{}},'WORK_HANDOFF_PHASE_UNSUPPORTED'))
  check('handoff.arbitrary-action-refused',lambda:no('work.handoff',{'phase':'propose','request':{},'action':'scheduler.claim'},'INVALID_REQUEST'))
  before=f.snapshot();proposal={'idempotency_key':'workflow-handoff','leader_generation':'1','package_ids':[i['package'],i['package2']],'expected_generations':{i['package']:'2',i['package2']:'2'},'successor_id':i['manager2'],'context':{'summary':'Actual adapter ownership transfer','decision_refs':[],'pending_instruction_refs':[],'native_session_refs':[]}}
  offered=ok('work.handoff',{'phase':'propose','request':proposal})
  check('handoff.proposal-is-not-ownership',lambda:expect(offered['ownership_changed'] is False))
  acknowledgment={'idempotency_key':'workflow-handoff-ack','leader_generation':'1','handoff_id':offered['handoff_id']}
  check('handoff.wrong-successor-refused',lambda:no('work.handoff',{'phase':'acknowledge','request':acknowledgment},'HANDOFF_SUCCESSOR_MISMATCH',key='manager'))
  accepted=ok('work.handoff',{'phase':'acknowledge','request':acknowledgment},key='manager2')
  check('handoff.actual-acknowledged-ownership',lambda:expect(accepted.get('ownership_changed') is True or f.sql('SELECT manager_session_id FROM hyperfide.feature_packages WHERE id=$1',[i['package']])[0]['manager_session_id']==i['manager2']))
  after=f.snapshot()
  check('handoff.workers-attempts-leases-preserved',lambda:expect(all(before[k]==after[k] for k in ('tasks','attempts','compute_leases','agent_sessions','submission_custodies','findings'))))
  check('update.receipt-replay-rechecks-current-ownership',lambda:expect(f.request(state['update_request'],key='leader')[1].get('error',{}).get('code')=='PACKAGE_GENERATION_STALE'))
  changed=ok('work.update',dict(update,package_generation='3'))
  check('update.actual-handoff-state-delta',lambda:expect(changed['unchanged'] is False and changed['revision']!=opened['revision'] and changed['deltas']['state']['task']['current_ownership']['package_generation']=='3'))
  check('update.delta-read-does-not-qualify',lambda:expect(changed['execution_authority'] is False and f.sql('SELECT state FROM hyperfide.tasks WHERE id=$1',[i['task']])[0]['state']=='RUNNING'))
  check('open.previous-manager-authority-refused',lambda:no('work.open',dict(payload(),package_generation='3'),'PACKAGE_OWNER_MISMATCH',key='manager'))
  check('open.current-manager-accepted',lambda:expect(ok('work.open',dict(payload(),package_generation='3'),key='manager2')['task_id']==i['task']))
  check('update.next-unchanged-revision-stable',lambda:expect(ok('work.update',dict(update,revision=changed['revision'],package_generation='3'))['unchanged'] is True))
  newleader=f.ok('hierarchy.leader.acquire',{'idempotency_key':'workflow-replacement','expected_generation':'1','reason':'Real authority replacement'},key='leader2')
  check('open.replaced-leader-refused',lambda:no('work.open',dict(payload(),package_generation='3'),'LEADER_GENERATION_STALE'))
  check('open.receipt-replay-rechecks-current-leader',lambda:expect(f.request(state['read_request'],key='leader')[1].get('error',{}).get('code')=='LEADER_GENERATION_STALE'))
  check('update.replaced-leader-refused',lambda:no('work.update',dict(update,package_generation='3'),'LEADER_GENERATION_STALE'))
  check('projection.replaced-generation-refused',lambda:no('work.projection',dict(projection,package_generation='3'),'LEADER_GENERATION_STALE'))
 finally:
  database,role,port=f.database,f.runtime_role,f.port;f.close();database_absent=not f.sql('SELECT datname FROM pg_database WHERE datname=$1',[database],admin=True);role_absent=not f.sql('SELECT rolname FROM pg_roles WHERE rolname=$1',[role],admin=True)
  with socket.socket() as connection:connection.settimeout(1);listener_absent=connection.connect_ex(('127.0.0.1',port))!=0
  complete=not f.path.exists() and database_absent and role_absent and listener_absent;cleanup={'database_absent':database_absent,'role_absent':role_absent,'https_listener_absent':listener_absent,'private_root_absent':not f.path.exists()};cleanup_path=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/legacy-workflow-artifacts'))/'workflow-cleanup.json';cleanup_path.parent.mkdir(parents=True,exist_ok=True);cleanup_path.write_text(json.dumps(cleanup,sort_keys=True)+'\n');check('cleanup.actual-database-role-listener-absence',lambda:expect(complete,'Owned database/role/listener/private paths remain'));print(json.dumps({'type':'cleanup','complete':complete,'resources':[]}),flush=True);expect(complete,'Fixture cleanup incomplete')
 return int(bool(FAILED))
if __name__=='__main__':raise SystemExit(main())
