#!/usr/bin/env python3
"""27.3 driver-component validation; synthetic observations are never live proof."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import shutil
import sys
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/campaigns'))
import deterministic as d
import live
FAILED=[]

def check(identity, action):
    try:
        if action() is False:raise AssertionError('false observation')
        actual=True
    except BaseException as exc:
        actual=False;FAILED.append(identity);print(identity+': '+str(exc),file=sys.stderr)
    print(json.dumps({'type':'assertion','id':identity,'expected':True,'actual':actual}))

def reject(action):
    try:action()
    except d.CampaignError:return True
    raise AssertionError('false success accepted')

def manifest():
    return {'schema_version':1,'kind':'live','campaign_id':'component-only','source_revision':'a'*40,'source_manifest_digest':'sha256:'+'b'*64,'approval':{'approved':True,'kind':'live'},'profile':{'sandboxes':100,'slots':200,'session_lifetimes':1500,'virtual_hours':72,'duration_hours':48,'sustained_window_seconds':120,'poll_seconds':10,'ramp_timeout_seconds':60},'stages':[{'sandboxes':n,'sessions':s}for n,s in live.STAGES],'auth_references':{'codex':'secret-ref:component-codex','claude_code':'secret-ref:component-claude'},'main_host_id':'component-main','adapters':{'control':{'fixture':'control'},'observer':{'fixture':'observer'},'cleanup':{'fixture':'cleanup'}},'slo':{'maximum_errors':0,'maximum_queue_latency_ms':100,'maximum_observation_gap_seconds':30},'inputs':{}}

def snapshot():
    return {'basis':'REAL_PROVIDER_AND_NATIVE_OBSERVATION','source_revision':'a'*40,'source_manifest_digest':'sha256:'+'b'*64,'observed_at':'2026-10-16T12:00:00Z','monotonic_ns':10**9,'inventory_complete':True,'sandboxes':[{'id':'sandbox','provider':'railway','state':'RUNNING'}],'sessions':[{'id':'session1','native_id':'native1','connector':'codex','resolved_model':'component-configured-frontier','frontier_profile_qualified':True,'auth_reference':'secret-ref:component-codex','sandbox_id':'sandbox','state':'MODEL_RUNNING','lifetime_id':'lifetime1','placement':'REMOTE','attempt_id':'attempt1'},{'id':'session2','native_id':'native2','connector':'claude_code','resolved_model':'component-configured-frontier','frontier_profile_qualified':True,'auth_reference':'secret-ref:component-claude','sandbox_id':'sandbox','state':'TOOL_RUNNING','lifetime_id':'lifetime2','placement':'REMOTE','attempt_id':'attempt2'}],'main_host_audit':{'host_id':'component-main','complete':True,'forbidden_processes':[]},'jobs':[{'id':'job1','host_id':'remote','placement':'REMOTE','evidence_digest':'a'*64,'qualified_work_observed':True,'kind':'test'}],'metrics':{'errors':0,'queue_latency_ms':1}}

def run():
    m=manifest();s=snapshot()
    check('campaign.live.approved-staged-profile',lambda:live.validate_live(m)['duration_hours']==48)
    check('campaign.live.observed-activity-lineage',lambda:live.inspect_snapshot(s,m)['active_frontier_sessions']==2)
    waiting=copy.deepcopy(s);waiting['sessions'][0]['state']='WAITING'
    check('campaign.live.waiting-not-active',lambda:live.inspect_snapshot(waiting,m)['active_frontier_sessions']==1)
    resumed=copy.deepcopy(s);resumed['sessions'][1]['lifetime_id']='lifetime1'
    check('campaign.live.resume-not-new-lifetime',lambda:len(live.inspect_snapshot(resumed,m)['lifetimes'])==1)
    cases=[('snapshot.partial-inventory',lambda x:x.update(inventory_complete=False)),('snapshot.main-audit-missing',lambda x:x['main_host_audit'].update(complete=False)),('snapshot.main-build',lambda x:x['jobs'][0].update(host_id='component-main')),('snapshot.unapproved-frontier',lambda x:x['sessions'][0].update(frontier_profile_qualified=False)),('snapshot.missing-native-id',lambda x:x['sessions'][0].update(native_id='')),('snapshot.wrong-auth-reference',lambda x:x['sessions'][0].update(auth_reference='secret-ref:other')),('snapshot.unregistered-sandbox',lambda x:x['sessions'][0].update(sandbox_id='absent')),('snapshot.local-frontier',lambda x:x['sessions'][0].update(placement='MAIN')),('snapshot.main-implementation',lambda x:x['main_host_audit'].update(forbidden_processes=['cc'])),('snapshot.source-drift',lambda x:x.update(source_revision='b'*40)),('snapshot.slo-errors',lambda x:x['metrics'].update(errors=1)),('snapshot.slo-latency',lambda x:x['metrics'].update(queue_latency_ms=101)),('snapshot.unknown-activity',lambda x:x['sessions'][0].update(state='PRETEND_ACTIVE')),('snapshot.duplicate-session',lambda x:x['sessions'].append(copy.deepcopy(x['sessions'][0])))]
    for name,mutate in cases:
        changed=copy.deepcopy(s);mutate(changed)
        check('campaign.live.'+name,lambda changed=changed:reject(lambda:live.inspect_snapshot(changed,m)))
    check('campaign.live.replayed-observation',lambda:reject(lambda:live.inspect_snapshot(s,m,s)))
    gap=copy.deepcopy(s);gap['monotonic_ns']+=31*10**9
    check('campaign.live.observer-gap',lambda:reject(lambda:live.inspect_snapshot(gap,m,s)))
    short=copy.deepcopy(m);short['profile']['duration_hours']=1
    check('campaign.live.short-soak-not-promoted',lambda:reject(lambda:live.validate_live(short)))
    absent=copy.deepcopy(m);absent['auth_references']={}
    check('campaign.live.missing-auth-references',lambda:reject(lambda:live.validate_live(absent)))
    seventy=copy.deepcopy(m);seventy['profile']['duration_hours']=72
    check('campaign.live.prior48-receipt-required',lambda:reject(lambda:live.validate_live(seventy)))
    wrong=copy.deepcopy(m);wrong['stages']=[{'sandboxes':100,'sessions':200}]
    check('campaign.live.no-direct-scale-jump',lambda:reject(lambda:live.validate_live(wrong)))
    observer=copy.deepcopy(m);observer['adapters']['observer']=observer['adapters']['control']
    check('campaign.live.independent-observer-required',lambda:reject(lambda:live.validate_live(observer)))
    clean={'inventory_complete':True,'unknown_operations':[],'resources':[{'id':'sandbox','state':'DESTROYED','confirmed':True}]}
    check('campaign.live.confirmed-cleanup',lambda:live.cleanup_result(clean,{}, {'sandbox'}))
    pending=copy.deepcopy(clean);pending['resources'][0]['state']='DESTROYING'
    check('campaign.live.destroying-not-absent',lambda:reject(lambda:live.cleanup_result(pending,{})))
    unknown=copy.deepcopy(clean);unknown['unknown_operations']=['unknown']
    check('campaign.live.unknown-cleanup-debt',lambda:reject(lambda:live.cleanup_result(unknown,{})))
    omitted=copy.deepcopy(clean);omitted['resources']=[]
    check('campaign.live.cleanup-omitted-resource',lambda:reject(lambda:live.cleanup_result(omitted,{}, {'sandbox'})))
    retained={'sandbox':{'owner':'component-owner','expires_at':'2099-01-01T00:00:00Z'}}
    retained_result={'inventory_complete':True,'unknown_operations':[],'resources':[{'id':'sandbox','state':'RETAINED',**retained['sandbox']}]}
    check('campaign.live.explicit-retention',lambda:live.cleanup_result(retained_result,retained,{'sandbox'}))
    expired=copy.deepcopy(retained);expired['sandbox']['expires_at']='2000-01-01T00:00:00Z';expired_result=copy.deepcopy(retained_result);expired_result['resources'][0]['expires_at']=expired['sandbox']['expires_at']
    check('campaign.live.expired-retention',lambda:reject(lambda:live.cleanup_result(expired_result,expired)))
    allocated=copy.deepcopy(s);allocated['sandboxes'] += [{'id':'unknown-allocation','provider':'railway','state':'UNKNOWN'},{'id':'stopped-allocation','provider':'blaxel','state':'STOPPED'}]
    bounded=copy.deepcopy(m);bounded['profile']['sandboxes']=2
    check('campaign.live.nonrunning-resources-reserve-quota',lambda:reject(lambda:live.enforce_allocation(live.inspect_snapshot(allocated,bounded),bounded)))
    parked=copy.deepcopy(s);parked['sessions'].append({**s['sessions'][0],'id':'parked','native_id':'parked-native','state':'IDLE','lifetime_id':'parked-lifetime'})
    bounded=copy.deepcopy(m);bounded['profile']['slots']=2
    check('campaign.live.idle-native-reserves-quota',lambda:reject(lambda:live.enforce_allocation(live.inspect_snapshot(parked,bounded),bounded)))
    # Real Ed25519 key generation/signature verification exercises only this
    # component fixture. It creates no product identity or authenticated session.
    with tempfile.TemporaryDirectory(prefix='hyperfide-observer-component-') as directory:
        root=Path(directory);openssl=Path(shutil.which('openssl')).resolve()
        key=root/'component-private.pem';public=root/'component-public.pem'
        subprocess.run([str(openssl),'genpkey','-algorithm','ED25519','-out',str(key)],check=True,capture_output=True)
        key.chmod(0o600)
        subprocess.run([str(openssl),'pkey','-in',str(key),'-pubout','-out',str(public)],check=True,capture_output=True)
        def pin(path):
            data=Path(path).read_bytes();return {'path':str(path),'sha256':d.digest(data),'size':len(data)}
        trust={'schema_version':1,'controller_id':'component-controller','observer_id':'component-reader','key_id':'component-public-key','roles':['DURABLE_READER','MAIN_HOST_AUDITOR','NATIVE_READER','PROVIDER_READER'],'scope':{'organisation_id':'component-org','run_id':'component-run','authority_epoch':1},'public_key':pin(public),'verifier_executable':pin(openssl)}
        trust_path=root/'component-trust.json';trust_path.write_bytes(d.canonical(trust))
        approved=copy.deepcopy(m);approved['inputs']['observer_trust']=[pin(trust_path)]
        request={'operation':'observe','campaign_id':'component-only','nonce':'unique-component-request','source_revision':m['source_revision'],'source_manifest_digest':m['source_manifest_digest']}
        def signed(changes=None):
            value=copy.deepcopy(s)
            proof={'reader_id':trust['observer_id'],'key_id':trust['key_id'],'scope':trust['scope'],'roles':trust['roles'],'source_revision':m['source_revision'],'source_manifest_digest':m['source_manifest_digest'],'request_sha256':d.digest(d.canonical(request)+b'\n'),'observation_sha256':d.digest(d.canonical(value))}
            proof.update(changes or {})
            message=root/'signed-message.json';signature=root/'signature.bin';message.write_bytes(d.canonical(proof))
            subprocess.run([str(openssl),'pkeyutl','-sign','-inkey',str(key),'-rawin','-in',str(message),'-out',str(signature)],check=True,capture_output=True)
            value['provenance']={**proof,'signature_hex':signature.read_bytes().hex()};return value
        observed=signed()
        verify=lambda value=observed,selected=approved,challenge=request:d.verify_observation(value,selected,root,challenge,{'DURABLE_READER','PROVIDER_READER'})
        check('campaign.live.actual-ed25519-reader-proof',verify)
        check('campaign.live.trusted-reader-scope',lambda:d.observer_trust(approved,root)['scope']==trust['scope'])
        bad=copy.deepcopy(observed);bad['metrics']['errors']=20
        check('campaign.live.signed-content-tamper',lambda:reject(lambda:verify(bad)))
        bad=copy.deepcopy(observed);bad['provenance']['signature_hex']='0'*128
        check('campaign.live.invalid-actual-signature',lambda:reject(lambda:verify(bad)))
        check('campaign.live.unapproved-signed-reader',lambda:reject(lambda:verify(signed({'reader_id':'component-controller'}))))
        check('campaign.live.wrong-signed-scope',lambda:reject(lambda:verify(signed({'scope':{**trust['scope'],'authority_epoch':2}}))))
        check('campaign.live.wrong-signed-source',lambda:reject(lambda:verify(signed({'source_revision':'c'*40}))))
        check('campaign.live.wrong-signed-repositories',lambda:reject(lambda:verify(signed({'source_manifest_digest':'sha256:'+'c'*64}))))
        check('campaign.live.signed-replay-other-request',lambda:reject(lambda:verify(challenge={**request,'nonce':'different-component-request'})))
        check('campaign.live.reader-proof-required',lambda:reject(lambda:verify(s)))
        missing=copy.deepcopy(approved);missing['inputs'].pop('observer_trust')
        check('campaign.live.approved-trust-reference-required',lambda:reject(lambda:d.observer_trust(missing,root)))
        same=copy.deepcopy(trust);same['observer_id']=same['controller_id'];trust_path.write_bytes(d.canonical(same));same_manifest=copy.deepcopy(approved);same_manifest['inputs']['observer_trust']=[pin(trust_path)]
        check('campaign.live.same-controller-reader-rejected',lambda:reject(lambda:d.observer_trust(same_manifest,root)))
        trust_path.write_bytes(d.canonical(trust))
        changed=public.read_bytes();public.write_bytes(changed+b'\n')
        check('campaign.live.verification-key-pin-tamper',lambda:reject(lambda:verify()))
        public.write_bytes(changed)
        reduced=copy.deepcopy(trust);reduced['roles']=['PROVIDER_READER'];trust_path.write_bytes(d.canonical(reduced));limited=copy.deepcopy(approved);limited['inputs']['observer_trust']=[pin(trust_path)]
        check('campaign.live.missing-durable-reader-role',lambda:reject(lambda:verify(selected=limited)))
    command=subprocess.run([sys.executable,str(ROOT/'tests/hyperfide/campaigns/live.py'),'--manifest','missing','--evidence','unused'],capture_output=True,text=True)
    check('campaign.live.no-implicit-execution',lambda:command.returncode==2 and 'BLOCKED'in command.stderr)
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}))
    return int(bool(FAILED))

if __name__=='__main__':raise SystemExit(run())
