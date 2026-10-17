#!/usr/bin/env python3
"""Real signed manager routing acknowledgements against current PostgreSQL ownership."""
from __future__ import annotations
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('finding_test_fixture',Path(__file__).with_name('18_1.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
check=c.check;expect=c.expect;uid=c.uid
def managers(f):
    for name in ('manager','successor','peer'):f.add_principal(name,'FEATURE_MANAGER',actor_id=f.x[name])
def main():
    if '--cleanup' in sys.argv:return c.cleanup('18.3')
    f=c.fixture('18.3',extra=('18.3',));managers(f)
    def call(action,payload,key='operator'):return c.call(f,action,payload,component='finding-routing',key=key)
    def reject(action,payload,code=None,key='operator'):return c.reject(f,action,payload,code,component='finding-routing',key=key)
    def version(fid):return str(c.call(f,'finding.inspect',{'finding_id':fid})['finding']['registry_version'])
    try:
        found=c.finding(f,collaborators=[f.x['collaborator']]);fid=found['finding_id'];packet={'finding_id':fid,'request_id':uid(),'expected_state_version':version(fid)};first=call('finding.route',packet);route=first['route']
        check('findings.routing.origin-current-manager',lambda:expect(route['manager_session_id']==f.x['manager'] and route['owner_package_id']==f.x['package'] and route['leader_queue'] is False))
        check('findings.routing.collaborators-explicit',lambda:expect(first['collaborators']==[{'package_id':f.x['collaborator'],'manager_session_id':f.x['peer'],'owner_generation':'1'}]))
        check('findings.routing.request-replay',lambda:expect(call('finding.route',packet)['route']['id']==route['id'] and f.sql('SELECT count(*)::text AS n FROM hyperfide.finding_routes')[0]['n']=='1'))
        check('findings.routing.replay-intent-conflict',lambda:reject('finding.route',dict(packet,expected_state_version='999'),'IDEMPOTENCY_CONFLICT'))
        check('findings.routing.stale-finding-event',lambda:reject('finding.route',dict(packet,request_id=uid()),'STALE_FINDING'))
        ack={'route_id':route['id'],'generation':str(route['generation']),'owner_generation':str(route['owner_generation'])}
        check('findings.routing.operator-cannot-ack-manager',lambda:reject('finding.route.acknowledge',ack,'STALE_OWNER'))
        check('findings.routing.current-manager-ack',lambda:expect(call('finding.route.acknowledge',ack,key='manager')['acknowledged'] is True))
        check('findings.routing.ack-idempotent',lambda:expect(call('finding.route.acknowledge',ack,key='manager')['acknowledged'] is True and f.sql('SELECT count(*)::text AS n FROM hyperfide.finding_route_acknowledgements')[0]['n']=='1'))
        peer=dict(ack,package_id=f.x['collaborator'])
        check('findings.routing.collaborator-wrong-manager',lambda:reject('finding.route.collaborator.acknowledge',peer,'STALE_OWNER',key='manager'))
        check('findings.routing.collaborator-own-ack',lambda:expect(call('finding.route.collaborator.acknowledge',peer,key='peer')['acknowledged'] is True))
        # Trusted fixture models the durable result of an acknowledged3.4 transfer.
        # Domain18 must read current facts, never a historical ownership snapshot.
        f.sql('WITH owner_update AS (UPDATE hyperfide.feature_packages SET manager_session_id=$1,state_version=state_version+1 WHERE organisation_id=$2 AND run_id=$3 AND id=$4 RETURNING id) UPDATE hyperfide.hierarchy_packages SET owner_generation=owner_generation+1,state_version=state_version+1 WHERE organisation_id=$2 AND run_id=$3 AND package_id IN (SELECT id FROM owner_update)',[f.x['successor'],f.ids['organisation'],f.ids['run'],f.x['package']])
        check('findings.routing.transferred-manager-stale',lambda:reject('finding.route.acknowledge',ack,'STALE_OWNER',key='manager'))
        check('findings.routing.successor-cannot-ack-old-route',lambda:reject('finding.route.acknowledge',dict(ack,owner_generation='2'),'STALE_ROUTE',key='successor'))
        next_route=call('finding.route',{'finding_id':fid,'request_id':uid(),'expected_state_version':version(fid)})['route'];next_ack={'route_id':next_route['id'],'generation':str(next_route['generation']),'owner_generation':str(next_route['owner_generation'])}
        check('findings.routing.reroutes-to-successor',lambda:expect(next_route['manager_session_id']==f.x['successor'] and str(next_route['owner_generation'])=='2' and int(next_route['generation'])>int(route['generation'])))
        check('findings.routing.reordered-old-ack',lambda:reject('finding.route.acknowledge',ack,'STALE_ROUTE',key='manager'))
        check('findings.routing.successor-current-ack',lambda:expect(call('finding.route.acknowledge',next_ack,key='successor')['acknowledged'] is True))
        f.sql("UPDATE hyperfide.agent_sessions SET state='STOPPED',state_version=state_version+1 WHERE id=$1",[f.x['successor']])
        queued=call('finding.route',{'finding_id':fid,'request_id':uid(),'expected_state_version':version(fid)})['route']
        check('findings.routing.dead-manager-durable-leader-queue',lambda:expect(queued['leader_queue'] is True and queued['manager_session_id'] is None and f.sql('SELECT count(*)::text AS n FROM hyperfide.findings')[0]['n']=='1'))
        assigned=call('finding.route.assign',{'finding_id':fid,'request_id':uid(),'expected_state_version':version(fid),'package_id':f.x['collaborator'],'reason':'Explicit cross-feature accountability decision'})['route']
        check('findings.routing.explicit-leader-assignment',lambda:expect(assigned['owner_package_id']==f.x['collaborator'] and assigned['manager_session_id']==f.x['peer']))
        check('findings.routing.assignment-preserves-origin',lambda:expect(c.call(f,'finding.inspect',{'finding_id':fid})['finding']['origin_attempt_id']==f.x['attempt']))
        check('findings.routing.assignment-requires-rationale',lambda:reject('finding.route.assign',{'finding_id':fid,'request_id':uid(),'expected_state_version':version(fid),'package_id':f.x['package']},'INVALID_REQUEST'))
        check('findings.routing.no-implicit-repair-authority',lambda:expect(f.sql('SELECT count(*)::text AS n FROM hyperfide.finding_repairs')[0]['n']=='0'))
        check('findings.routing.append-only-ack-history',lambda:c.assert_sql_refused(f,'DELETE FROM hyperfide.finding_route_acknowledgements'))
    finally:f.close()
    return int(any(actual!='observed' for _,actual in c.RESULTS))
if __name__=='__main__':raise SystemExit(main())
