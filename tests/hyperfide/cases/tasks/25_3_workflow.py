#!/usr/bin/env python3
"""Actual signed HTTPS/PG workflow adapter tests. No status or proof promotion."""
import importlib.util,json,sys
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
  f.ids['large_task']=module.uid();f.sql('INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)',[f.ids['organisation'],f.ids['run'],f.ids['large_task'],'alpha.large',f.ids['package'],f.ids['spec'],module.sha(b'large-criteria'),json.dumps({'title':'Large accepted task','touches':['src/b.c'],'context':'x'*8000})])
 f=HierarchyFixture(extra_components=('3.3','25.3-workflow'),extra_setup=seed);i=f.ids;state={}
 def payload(task=None,**extra):return dict(task=task or i['task'],leader_generation='1',package_generation='2',**extra)
 def ok(action,value,key='leader'):
  return f.ok(action,value,key=key,component='25.3-workflow')
 def no(action,value,code,key='leader'):
  return f.reject(action,value,code,key=key,component='25.3-workflow')
 try:
  opened=ok('work.open',payload());state['revision']=opened['revision']
  check('open.actual-accepted-task-criteria',lambda:expect(opened['task_id']==i['task'] and opened['criteria']['digest']==module.sha(b'criteria') and opened['allowed_scope']==['src/a.c']))
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
  f.close();complete=not f.path.exists();print(json.dumps({'type':'cleanup','complete':complete,'resources':[]}),flush=True);expect(complete,'Fixture private paths remain')
 return int(bool(FAILED))
if __name__=='__main__':raise SystemExit(main())
