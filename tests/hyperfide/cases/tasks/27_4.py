#!/usr/bin/env python3
"""Component validators exercise independent state, observed timing and full proof.

Synthetic validator inputs are not live fault, occupancy or recovery evidence.
"""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/campaigns'))
sys.path.insert(0,str(ROOT/'tests/hyperfide'))
import deterministic as d
import faults
from selftest_harness import Fixture
EPOCH1="11111111-1111-4111-8111-111111111111"
EPOCH2="22222222-2222-4222-8222-222222222222"
DEPLOYMENT="33333333-3333-4333-8333-333333333333"
ACTIVATION="44444444-4444-4444-8444-444444444444"
FAILED=[]

def check(identity,action):
    try:
        if action() is False:raise AssertionError('false observation')
        actual=True
    except BaseException as exc:
        actual=False;FAILED.append(identity);print(identity+': '+str(exc),file=sys.stderr)
    print(json.dumps({'type':'assertion','id':identity,'expected':True,'actual':actual}))

def reject(action,message=None):
    try:action()
    except d.CampaignError as exc:
        if message is not None and message not in str(exc):raise AssertionError('wrong validation failed: '+str(exc))
        return True
    raise AssertionError('false-success trap accepted')

def pin(path):
    path=Path(path).resolve();data=path.read_bytes();return {'path':str(path),'sha256':hashlib.sha256(data).hexdigest(),'size':len(data)}

def run():
    fixture=Fixture()
    try:
        campaign,summary=fixture.successful()
        receipt_pin=pin(campaign/'receipts'/(summary['receipt_id']+'.json'))
        kinds=sorted(faults.FAULTS)
        pairs=[['artifact_incomplete','controller_loss'],['controller_loss','sandbox_loss'],['credential_expiry','restore_epoch'],['database_failover','replica_lag'],['reversed_commits','stale_worker'],['duplicate_provision','unknown_create'],['git_ack_lost','stale_publisher']]
        manifest={'kind':'faults','source_revision':'a'*40,'source_manifest_digest':'sha256:'+'b'*64,'profile':{'sandboxes':100,'slots':200,'initial_authority_epoch':EPOCH1,'deployment_id':DEPLOYMENT,'required_composite_pairs':pairs},'inputs':{'accepted_receipts':[receipt_pin]},'adapters':{'control':{'component':'control'},'observer':{'component':'observer'},'cleanup':{'component':'cleanup'}},'faults':[{'id':'fault-'+kind,'kind':kind,'at_ms':0,'duration_ms':100}for kind in kinds],'slo':{'rpo_ms':1,'rto_ms':100,'schedule_tolerance_ms':0}}
        events=[{'sequence':1,'virtual_ms':1,'kind':'effect','epoch':EPOCH1,'operation_id':'effect1','effect_key':'once','accepted':True},{'sequence':2,'virtual_ms':2,'kind':'effect','epoch':EPOCH1,'operation_id':'effect2','effect_key':'once','accepted':False}]
        golden={'epoch':EPOCH1,'owners':{},'slots':{},'custody':{},'resources':[],'publications':{},'effect_count':1,'accepted_count':1,'peak_slots':0,'session_lifetimes':0,'pending_creates':[],'faults':[],'virtual_elapsed_ms':2,'reader_sessions':0,'reads':0,'authoritative_reads':0}
        observation={'basis':'INDEPENDENT_DURABLE_RECONSTRUCTION','source_revision':'a'*40,'source_manifest_digest':'sha256:'+'b'*64,'events':events,'final_state':golden,'protected_refs':{},'resource_inventory_complete':True,'resource_ids':[],'unknown_operations':[],'unacknowledged_effects':[],'hidden_backlog':[],'resource_debts':[],'receipts':[{'pin':receipt_pin,'trusted_anchor_sha256':receipt_pin['sha256']}],'campaign_start_monotonic_ns':0,'fault_reports':[{'fault_id':row['id'],'kind':row['kind'],'injection_observed':True,'recovery_observed':True,'basis':'INDEPENDENT_OBSERVATION','injected_monotonic_ns':0,'cleared_monotonic_ns':100000000,'recovered_monotonic_ns':100000000,'rpo_ms':0,'rto_ms':100}for row in manifest['faults']],'conflicting_accepted_owners':0,'unqualified_publications':0}
        check('campaign.faults.complete-composite-schedule',lambda:len(faults.validate_faults(manifest))==len(faults.FAULTS)==13)
        check('campaign.faults.actual-overlap-reference',lambda:faults.inspect_fault_reports(observation,manifest))
        check('campaign.faults.independent-state-reference',lambda:faults.inspect_state(observation,manifest)==golden)
        checked=subprocess.run([sys.executable,str(ROOT/'tests/hyperfide/check-evidence.py'),'--campaign',str(campaign),'--receipt',summary['receipt_id']],capture_output=True)
        check('campaign.faults.actual-canonical-component-receipt',lambda:checked.returncode==0)
        check('campaign.faults.component-receipt-not-full-proof',lambda:reject(lambda:faults.verify_recovery_receipts(observation,manifest,ROOT),'task-component or incomplete'))
        changes=[('incomplete-inventory',lambda x:x.update(resource_inventory_complete=False)),('orphan-resource',lambda x:x.update(resource_ids=['orphan'])),('lost-git-ack-unknown',lambda x:x.update(unknown_operations=['unknown-git'])),('resource-debt',lambda x:x.update(resource_debts=['unreachable-provider'])),('hidden-backlog',lambda x:x.update(hidden_backlog=['pending'])),('unacknowledged-effects',lambda x:x.update(unacknowledged_effects=['effect'])),('unqualified-ref',lambda x:x.update(protected_refs={'refs/heads/main':'b'*40})),('wrong-reference-state',lambda x:x['final_state'].update(effect_count=2)),('duplicate-accepted-effect',lambda x:x['events'][1].update(accepted=True)),('conflicting-owners',lambda x:x.update(conflicting_accepted_owners=1)),('unqualified-publications',lambda x:x.update(unqualified_publications=1)),('source-revision-drift',lambda x:x.update(source_revision='c'*40)),('repository-manifest-drift',lambda x:x.update(source_manifest_digest='sha256:'+'c'*64))]
        for name,mutate in changes:
            changed=copy.deepcopy(observation);mutate(changed)
            check('campaign.faults.'+name,lambda changed=changed:reject(lambda:faults.inspect_state(changed,manifest)))
        report_changes=[('missing-fault-observation',lambda x:x['fault_reports'].pop()),('controller-only-recovery',lambda x:x['fault_reports'][0].update(basis='CONTROLLER_DECLARATION')),('rto-invented',lambda x:x['fault_reports'][0].update(rto_ms=1)),('rpo-exceeded',lambda x:x['fault_reports'][0].update(rpo_ms=2)),('unverified-recovery',lambda x:x['fault_reports'][0].update(recovery_observed=False)),('missing-observed-timing',lambda x:x['fault_reports'][0].pop('injected_monotonic_ns')),('duration-mismatch',lambda x:x['fault_reports'][0].update(cleared_monotonic_ns=90000000)),('duplicate-observation',lambda x:x['fault_reports'].append(copy.deepcopy(x['fault_reports'][0])))]
        for name,mutate in report_changes:
            changed=copy.deepcopy(observation);mutate(changed)
            check('campaign.faults.'+name,lambda changed=changed:reject(lambda:faults.inspect_fault_reports(changed,manifest)))
        # Both observations remain within the frozen tolerance while the actual
        # first composite pair is sequential. Only the overlap check rejects it.
        sequential=copy.deepcopy(manifest);sequential['slo']['schedule_tolerance_ms']=20
        sequential['faults'][1]['at_ms']=80
        actual=copy.deepcopy(observation)
        actual['fault_reports'][0].update(cleared_monotonic_ns=80000000,recovered_monotonic_ns=80000000,rto_ms=80)
        actual['fault_reports'][1].update(injected_monotonic_ns=100000000,cleared_monotonic_ns=180000000,recovered_monotonic_ns=180000000,rto_ms=80)
        check('campaign.faults.sequential-real-drills-not-composite',lambda:reject(lambda:faults.inspect_fault_reports(actual,sequential),'actual fault intervals do not overlap'))
        no_anchor=copy.deepcopy(manifest);no_anchor['inputs']={}
        check('campaign.faults.external-anchor-required',lambda:reject(lambda:faults.verify_recovery_receipts(observation,no_anchor,ROOT),'externally approved'))
        self_anchor=copy.deepcopy(observation);self_anchor['receipts'][0]['trusted_anchor_sha256']='f'*64
        check('campaign.faults.observer-cannot-invent-anchor',lambda:reject(lambda:faults.verify_recovery_receipts(self_anchor,manifest,ROOT),'approved external anchor'))
        fake=fixture.root/'fake-campaign/receipts/00000000-0000-0000-0000-000000000001.json';fake.parent.mkdir(parents=True);fake.write_text('{"schema_version":1,"status":"PASS"}')
        fake_pin=pin(fake);fake_manifest=copy.deepcopy(manifest);fake_manifest['inputs']['accepted_receipts']=[fake_pin];fake_observation=copy.deepcopy(observation);fake_observation['receipts']=[{'pin':fake_pin,'trusted_anchor_sha256':fake_pin['sha256']}]
        check('campaign.faults.pass-label-not-proof',lambda:reject(lambda:faults.verify_recovery_receipts(fake_observation,fake_manifest,ROOT),'task-component or incomplete'))
        missing=copy.deepcopy(manifest);missing['faults'].pop()
        check('campaign.faults.missing-fault-kind',lambda:reject(lambda:faults.validate_faults(missing)))
        serial=copy.deepcopy(manifest)
        for index,row in enumerate(serial['faults']):row['at_ms']=index*101
        check('campaign.faults.single-fault-only-rejected',lambda:reject(lambda:faults.validate_faults(serial)))
        # Requirement-named fault classes and their composites cannot be dropped.
        for kind in ('replica_lag','reversed_commits','duplicate_provision'):
            name=kind.replace('_','-')
            dropped=copy.deepcopy(manifest);dropped['faults']=[row for row in dropped['faults']if row['kind']!=kind]
            check('campaign.faults.'+name+'-required',lambda dropped=dropped:reject(lambda:faults.validate_faults(dropped),'declared composite fault coverage incomplete'))
            unpaired=copy.deepcopy(manifest)
            unpaired['profile']['required_composite_pairs']=[pair for pair in unpaired['profile']['required_composite_pairs']if kind not in pair]+[sorted((member,'controller_loss'))for pair in unpaired['profile']['required_composite_pairs']if kind in pair for member in pair]
            check('campaign.faults.'+name+'-mandatory-pair',lambda unpaired=unpaired:reject(lambda:faults.validate_faults(unpaired),'mandatory composite fault pairs missing'))
        # Replica lag observed only after failover recovery is sequential, not composite.
        lagged=copy.deepcopy(manifest);lagged['slo']['schedule_tolerance_ms']=20
        index={row['kind']:position for position,row in enumerate(lagged['faults'])}
        lagged['faults'][index['replica_lag']]['at_ms']=80
        late=copy.deepcopy(observation)
        late['fault_reports'][index['database_failover']].update(cleared_monotonic_ns=80000000,recovered_monotonic_ns=80000000,rto_ms=80)
        late['fault_reports'][index['replica_lag']].update(injected_monotonic_ns=100000000,cleared_monotonic_ns=180000000,recovered_monotonic_ns=180000000,rto_ms=80)
        check('campaign.faults.replica-lag-after-failover-not-composite',lambda:reject(lambda:faults.inspect_fault_reports(late,lagged),'actual fault intervals do not overlap'))
        dup=copy.deepcopy(manifest);dup['faults'].append(copy.deepcopy(dup['faults'][0]))
        check('campaign.faults.duplicate-fault-id',lambda:reject(lambda:faults.validate_faults(dup)))
        unknown=copy.deepcopy(manifest);unknown['faults'][0]['kind']='invented'
        check('campaign.faults.unknown-fault-kind',lambda:reject(lambda:faults.validate_faults(unknown)))
        no_pairs=copy.deepcopy(manifest);no_pairs['profile'].pop('required_composite_pairs')
        check('campaign.faults.approved-composites-required',lambda:reject(lambda:faults.validate_faults(no_pairs)))
        short=copy.deepcopy(manifest);short['slo']['schedule_tolerance_ms']=50
        check('campaign.faults.tolerance-cannot-erase-duration',lambda:reject(lambda:faults.validate_faults(short)))
        no_independence=copy.deepcopy(manifest);no_independence['adapters']['observer']=no_independence['adapters']['control']
        check('campaign.faults.independent-observer',lambda:reject(lambda:faults.validate_faults(no_independence)))
        command=subprocess.run([sys.executable,str(ROOT/'tests/hyperfide/campaigns/faults.py'),'--manifest','missing','--evidence','unused'],capture_output=True,text=True)
        check('campaign.faults.no-implicit-execution',lambda:command.returncode==2 and'BLOCKED'in command.stderr)
    finally:
        root=fixture.root;fixture.close()
    print(json.dumps({'type':'cleanup','resources':[],'complete':not root.exists()}))
    return int(bool(FAILED))

if __name__=='__main__':raise SystemExit(run())
