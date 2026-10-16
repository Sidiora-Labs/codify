#!/usr/bin/env python3
"""27.4 driver-component tests, with real canonical receipt checking."""
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
FAILED=[]

def check(identity,action):
    try:
        if action()is False:raise AssertionError('false observation')
        actual=True
    except BaseException as exc:
        actual=False;FAILED.append(identity);print(identity+': '+str(exc),file=sys.stderr)
    print(json.dumps({'type':'assertion','id':identity,'expected':True,'actual':actual}))

def reject(action):
    try:action()
    except d.CampaignError:return True
    raise AssertionError('false-success trap accepted')

def pin(path):
    path=Path(path).resolve();data=path.read_bytes();return {'path':str(path),'sha256':hashlib.sha256(data).hexdigest(),'size':len(data)}

def run():
    fixture=Fixture()
    try:
        campaign,summary=fixture.successful()
        receipt_pin=pin(campaign/'receipts'/(summary['receipt_id']+'.json'))
        manifest={'kind':'faults','source_revision':'a'*40,'source_manifest_digest':'sha256:'+'b'*64,'profile':{'sandboxes':100,'slots':200},'inputs':{'accepted_receipts':[receipt_pin]},'adapters':{'control':{'component':'control'},'observer':{'component':'observer'},'cleanup':{'component':'cleanup'}},'faults':[{'id':'fault-'+kind,'kind':kind,'at_ms':0,'duration_ms':100}for kind in sorted(faults.FAULTS)],'slo':{'rpo_ms':1,'rto_ms':100}}
        events=[{'sequence':1,'virtual_ms':1,'kind':'effect','operation_id':'effect1','effect_key':'once','accepted':True},{'sequence':2,'virtual_ms':2,'kind':'effect','operation_id':'effect2','effect_key':'once','accepted':False}]
        golden={'epoch':1,'owners':{},'slots':{},'resources':[],'publications':{},'effect_count':1,'accepted_count':1,'peak_slots':0,'session_lifetimes':0,'pending_creates':[],'faults':[],'virtual_elapsed_ms':2}
        observation={'basis':'INDEPENDENT_DURABLE_RECONSTRUCTION','source_revision':'a'*40,'source_manifest_digest':'sha256:'+'b'*64,'events':events,'final_state':golden,'protected_refs':{},'resource_inventory_complete':True,'resource_ids':[],'unknown_operations':[],'unacknowledged_effects':[],'hidden_backlog':[],'resource_debts':[],'receipts':[{'pin':receipt_pin,'trusted_anchor_sha256':receipt_pin['sha256'],'verified_by':'independent-checker'}],'fault_reports':[{'fault_id':row['id'],'kind':row['kind'],'injection_observed':True,'recovery_observed':True,'basis':'INDEPENDENT_OBSERVATION','rpo_ms':0,'rto_ms':1}for row in manifest['faults']],'conflicting_accepted_owners':0,'unqualified_publications':0}
        check('campaign.faults.complete-composite-schedule',lambda:len(faults.validate_faults(manifest))==10)
        check('campaign.faults.actual-canonical-receipt-check',lambda:faults.inspect_reconstruction(observation,manifest,ROOT)==golden)
        changes=[('incomplete-inventory',lambda x:x.update(resource_inventory_complete=False)),('orphan-resource',lambda x:x.update(resource_ids=['orphan'])),('lost-git-ack-unknown',lambda x:x.update(unknown_operations=['unknown-git'])),('resource-debt',lambda x:x.update(resource_debts=['unreachable-provider'])),('hidden-backlog',lambda x:x.update(hidden_backlog=['pending'])),('unacknowledged-effects',lambda x:x.update(unacknowledged_effects=['effect'])),('unqualified-ref',lambda x:x.update(protected_refs={'refs/heads/main':'b'*40})),('wrong-reference-state',lambda x:x['final_state'].update(effect_count=2)),('duplicate-accepted-effect',lambda x:x['events'][1].update(accepted=True)),('conflicting-owners',lambda x:x.update(conflicting_accepted_owners=1)),('unqualified-publications',lambda x:x.update(unqualified_publications=1)),('missing-fault-observation',lambda x:x['fault_reports'].pop()),('controller-only-recovery',lambda x:x['fault_reports'][0].update(basis='CONTROLLER_DECLARATION')),('rto-exceeded',lambda x:x['fault_reports'][0].update(rto_ms=101)),('unverified-recovery',lambda x:x['fault_reports'][0].update(recovery_observed=False))]
        for name,mutate in changes:
            changed=copy.deepcopy(observation);mutate(changed)
            check('campaign.faults.'+name,lambda changed=changed:reject(lambda:faults.inspect_reconstruction(changed,manifest,ROOT)))
        no_anchor=copy.deepcopy(manifest);no_anchor['inputs']={}
        check('campaign.faults.external-anchor-required',lambda:reject(lambda:faults.inspect_reconstruction(observation,no_anchor,ROOT)))
        self_anchor=copy.deepcopy(observation);self_anchor['receipts'][0]['trusted_anchor_sha256']='f'*64
        check('campaign.faults.observer-cannot-invent-anchor',lambda:reject(lambda:faults.inspect_reconstruction(self_anchor,manifest,ROOT)))
        fake=fixture.root/'fake-campaign/receipts/00000000-0000-0000-0000-000000000001.json';fake.parent.mkdir(parents=True);fake.write_text('{"schema_version":1,"status":"PASS"}')
        fake_pin=pin(fake);fake_manifest=copy.deepcopy(manifest);fake_manifest['inputs']['accepted_receipts']=[fake_pin];fake_observation=copy.deepcopy(observation);fake_observation['receipts']=[{'pin':fake_pin,'trusted_anchor_sha256':fake_pin['sha256'],'verified_by':'independent-checker'}]
        check('campaign.faults.pass-label-not-proof',lambda:reject(lambda:faults.inspect_reconstruction(fake_observation,fake_manifest,ROOT)))
        missing=copy.deepcopy(manifest);missing['faults'].pop()
        check('campaign.faults.missing-fault-kind',lambda:reject(lambda:faults.validate_faults(missing)))
        serial=copy.deepcopy(manifest)
        for index,row in enumerate(serial['faults']):row['at_ms']=index*101
        check('campaign.faults.single-fault-only-rejected',lambda:reject(lambda:faults.validate_faults(serial)))
        dup=copy.deepcopy(manifest);dup['faults'].append(copy.deepcopy(dup['faults'][0]))
        check('campaign.faults.duplicate-fault-id',lambda:reject(lambda:faults.validate_faults(dup)))
        unknown=copy.deepcopy(manifest);unknown['faults'][0]['kind']='invented'
        check('campaign.faults.unknown-fault-kind',lambda:reject(lambda:faults.validate_faults(unknown)))
        no_independence=copy.deepcopy(manifest);no_independence['adapters']['observer']=no_independence['adapters']['control']
        check('campaign.faults.independent-observer',lambda:reject(lambda:faults.validate_faults(no_independence)))
        command=subprocess.run([sys.executable,str(ROOT/'tests/hyperfide/campaigns/faults.py'),'--manifest','missing','--evidence','unused'],capture_output=True,text=True)
        check('campaign.faults.no-implicit-execution',lambda:command.returncode==2 and'BLOCKED'in command.stderr)
    finally:
        root=fixture.root;fixture.close()
    print(json.dumps({'type':'cleanup','resources':[],'complete':not root.exists()}))
    return int(bool(FAILED))

if __name__=='__main__':raise SystemExit(run())
