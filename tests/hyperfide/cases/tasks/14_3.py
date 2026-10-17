#!/usr/bin/env python3
from pathlib import Path
import sys,json,os,shutil,time,subprocess,hashlib
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,RESULTS,check,expect,uid,sha,canonical,b64

def file_hash(p):
    with p.open('rb') as stream:return 'sha256:'+hashlib.file_digest(stream,'sha256').hexdigest()
def main():
    from identity_fixture import cleanup_identity_evidence,write_identity_observations
    os.environ["HYPERFIDE_IDENTITY_EVIDENCE_TASK"]="14.3"
    if "--cleanup" in sys.argv:return cleanup_identity_evidence("14.3")
    canary='HF_NATIVE_TEST_'+uid();profiles={};accounts={};expiry=time.strftime('%Y-%m-%dT%H:%M:%S.000Z',time.gmtime(time.time()+1800))
    binaries={
      'claude':Path(os.environ.get('HF_TEST_NATIVE_CLAUDE_BINARY','/root/.local/share/claude/versions/2.1.300')),
      'codex':Path(os.environ.get('HF_TEST_NATIVE_CODEX_BINARY','/root/.local/share/mise/installs/node/lts/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex'))}
    for name,p in binaries.items():expect(p.is_file(),'Actual installed '+name+' native binary required')
    def setup(f):
        f.path.chmod(0o711);secrets=f.path/'secrets';secrets.mkdir(mode=0o700);(secrets/'token').write_text(canary);(secrets/'token').chmod(0o600)
        attachments=f.path/'attachments';attachments.mkdir(mode=0o711)
        credentials={'schema_version':1,'secret_root':str(secrets),'attachment_root':str(attachments),'sources':[{'name':'token','relative_path':'token','expires_at':expiry,'purposes':['WORKER_RUNTIME']}],'targets':[{'actor_id':f.ids['operator'],'uid':41201,'layers':['runtime']}]}
        c=f.path/'credentials.json';c.write_text(json.dumps(credentials));c.chmod(0o600);f.env['HF_CREDENTIAL_CONFIG_FILE']=str(c)
        for index,(name,p) in enumerate(binaries.items()):
            target=f.path/(name+'-native');shutil.copyfile(p,target);target.chmod(0o755)
            home=f.path/(name+'-empty-home');home.mkdir(mode=0o700);os.chown(home,41201+index,41201+index)
            profiles[name]={'schema_version':1,'profile_id':name+'-profile','profile_revision':'1','connector':name,'auth_mode':'api_credential','binary':{'path':str(target),'digest':file_hash(target),'version':'2.1.300' if name=='claude' else '0.162.1'},'credential_reference':'inference/native','configured_provider_id':name+'-configured','configured_model_alias':name+'-policy-alias','requested_model_id':'configured-only-model-id','permission_profile_id':'restricted-native','capabilities':{'unattended':False,'refresh':False,'concurrent_account':False,'portable_session':False,'explicit_resume':False},'runtime_home':str(home),'target_uid':41201+index,'configured_account_key':'declared-fixture-account-'+name}
            # Account-session mode is a separately configured profile with its own private empty home; no host auth directory is copied.
            account_home=f.path/(name+'-account-home');account_home.mkdir(mode=0o700);os.chown(account_home,41203+index,41203+index)
            accounts[name]=dict(profiles[name],profile_id=name+'-account',auth_mode='account_session',credential_reference='account/'+name,capabilities=dict(profiles[name]['capabilities'],refresh=True),runtime_home=str(account_home),target_uid=41203+index,configured_account_key='declared-fixture-session-'+name)
        f.mode_file=f.path/'native-auth-mode.json';f.env['HF_NATIVE_AUTH_MODE_FILE']=str(f.mode_file)
        f.profile_file=f.path/'native-profiles.json';f.profile_file.write_text(json.dumps({'schema_version':1,'profiles':list(profiles.values())+list(accounts.values())}));f.profile_file.chmod(0o600);f.env['HF_NATIVE_AUTH_PROFILES_FILE']=str(f.profile_file)
    f=IdentityFixture(extra_components=['14.2','14.3'],extra_setup=setup)
    try:
        for name in profiles:
            value=f.invoke('native.auth.snapshot',{'profile_id':name+'-profile'},component='14.3')[1]
            check('native.'+name+'.actual-profile-loaded',lambda v=value:expect(v.get('ok') is True,'Actual native profile failed: '+json.dumps(v)))
            snapshot=value['result']
            check('native.'+name+'.no-invented-live-qualification',lambda s=snapshot:expect(s['qualification']=={'state':'UNQUALIFIED','live_qualified':False,'receipt_digest':None},'Version pin promoted live qualification'))
            check('native.'+name+'.unknown-observed-identity',lambda s=snapshot:expect(s['observed_model_id'] is None and s['observed_provider_id'] is None and s['configured_model_alias']!=s['requested_model_id'],'Configured labels became observed identity'))
            check('native.'+name+'.public-no-private-runtime',lambda s=snapshot:expect('runtime_home' not in s and 'target_uid' not in s and canary not in json.dumps(s),'Private native material leaked'))
            result=f.invoke('native.auth.probe',{'profile_id':name+'-profile'},component='14.3',timeout_seconds=20)[1]
            check('native.'+name+'.real-clean-home-version-auth-probe',lambda r=result:expect(r.get('ok') is True and r['result']['runtime_version_verified'] is True and r['result']['native_authentication']=='AUTH_BLOCKED','Actual clean-home CLI probe failed: '+json.dumps(r)))
            check('native.'+name+'.probe-does-not-qualify-vendor',lambda r=result:expect(r['result']['live_qualified'] is False and r['result']['refresh_qualified'] is False and r['result']['endurance_72h_qualified'] is False and canary not in json.dumps(r),'Probe invented qualification or leaked secret'))
        def mode_config(revision,**changes):
            connectors=[]
            for name in profiles:
                entry={'connector':name,'selected_mode':'UNRESOLVED' if name=='claude' else 'api_credential','modes':{'account_session':{'profile_id':name+'-account','host_auth_import':None,'portable_session_claimed':False},'api_credential':{'profile_id':name+'-profile','host_auth_import':None,'portable_session_claimed':False}},'account_guidance':{'reference':'approved-'+name+'-account-guidance','concurrent_refresh':'SERIALISED_ONLY','renewal_assumption_hours':72}}
                for change in changes.get(name,()):change(entry)
                connectors.append(entry)
            f.mode_file.write_text(json.dumps({'schema_version':1,'config_revision':revision,'connectors':connectors}));f.mode_file.chmod(0o644)
        def code(value):return value.get('error',{}).get('code')
        check('native.qualification.unresolved-mode-refused',lambda:expect(not f.mode_file.exists() and code(f.invoke('native.auth.qualify',{'profile_id':'claude-profile'},component='14.3')[1])=='NATIVE_AUTH_MODE_UNRESOLVED','Qualification proceeded without an operator authentication-mode choice'))
        def secret_config_refused():
            f.mode_file.write_text(json.dumps({'schema_version':1,'config_revision':'secret','connectors':[],'api_key':canary}));f.mode_file.chmod(0o644)
            value=f.invoke('native.auth.qualify',{'profile_id':'claude-profile'},component='14.3')[1]
            expect(code(value)=='NATIVE_AUTH_MODE_CONFIG' and canary not in json.dumps(value),'Secret-bearing operator mode configuration accepted: '+json.dumps(value))
        check('native.qualification.secret-bearing-config-refused',secret_config_refused)
        mode_config('operator-modes-1');records={}
        for name in profiles:
            for profile_id in (name+'-account',name+'-profile'):
                records[profile_id]=f.invoke('native.auth.qualify',{'profile_id':profile_id},component='14.3',timeout_seconds=40)[1]
        def separately():
            expect(all(r.get('ok') is True for r in records.values()),'Mode qualification failed: '+json.dumps(records)[:1500])
            seen={(r['result']['connector'],r['result']['auth_mode']) for r in records.values()}
            expect(seen=={(c,m) for c in profiles for m in ('account_session','api_credential')} and len({r['result']['id'] for r in records.values()})==4,'Modes were not recorded separately per connector')
            for profile_id,r in records.items():
                v=r['result'];p=(accounts if profile_id.endswith('-account') else profiles)[v['connector']]
                expect(v['profile_id']==profile_id and v['cli']=={'version':p['binary']['version'],'digest':p['binary']['digest']},'Qualification record lacks the pinned CLI identity')
        check('native.qualification.modes-recorded-separately',separately)
        check('native.qualification.operator-config-recorded',lambda:expect(all(r['result']['operator_config']=={'revision':'operator-modes-1','digest':file_hash(f.mode_file),'selected_mode':'UNRESOLVED' if r['result']['connector']=='claude' else 'api_credential'} for r in records.values()),'Operator non-secret configuration reference not recorded'))
        check('native.qualification.auth-blocked-recorded',lambda:expect(all(r['result']['probe_outcome']=='AUTH_BLOCKED' and r['result']['state']=='BLOCKED' and r['result']['blocked_reasons']==['AUTH_BLOCKED'] for r in records.values()),'Clean-home probe outcome was not durably recorded as AUTH_BLOCKED'))
        check('native.qualification.refresh-race-serialised',lambda:expect(all(r['result']['refresh_race']=='SERIALISED' for r in records.values()),'Concurrent refresh race was not serialised'))
        check('native.qualification.no-72h-claim',lambda:expect(all(r['result']['endurance_72h']=='NOT_CLAIMED' and r['result']['live_qualified'] is False and r['result']['portability_qualified'] is False for r in records.values()),'Qualification claimed live, portability or 72-hour renewal results'))
        mode_config('operator-modes-2',codex=[lambda e:e['modes']['account_session'].update(host_auth_import='/root/.codex')],
                    claude=[lambda e:e['modes']['account_session'].update(portable_session_claimed=True),lambda e:e['account_guidance'].update(concurrent_refresh='ASSUMED_SAFE',renewal_assumption_hours=24)])
        blocked={name:f.invoke('native.auth.qualify',{'profile_id':name+'-account'},component='14.3',timeout_seconds=40)[1] for name in profiles}
        check('native.qualification.host-auth-copy-blocks-mode',lambda:expect(blocked['codex'].get('ok') is True and blocked['codex']['result']['state']=='BLOCKED' and blocked['codex']['result']['probe_outcome']=='NOT_RUN' and 'HOST_AUTH_DIRECTORY_COPY_UNSUPPORTED' in blocked['codex']['result']['blocked_reasons'],'Host auth directory copy did not block the mode: '+json.dumps(blocked['codex'])))
        check('native.qualification.portability-and-concurrency-claims-block-mode',lambda:expect(blocked['claude'].get('ok') is True and blocked['claude']['result']['probe_outcome']=='NOT_RUN' and {'CREDENTIAL_PORTABILITY_UNSUPPORTED','CONCURRENT_REFRESH_NOT_ASSUMED_SAFE','RENEWAL_GUIDANCE_BELOW_72H'}<=set(blocked['claude']['result']['blocked_reasons']),'Portability/concurrency claims did not block the mode: '+json.dumps(blocked['claude'])))
        def inspected():
            v=f.invoke('native.auth.qualification.inspect',{'connector':'codex'},component='14.3')[1]
            expect(v.get('ok') is True,'Qualification inspection failed: '+json.dumps(v));r=v['result']
            expect(r['selected_mode']=='api_credential' and r['selected_mode_blocked'] is True and r['live_qualified'] is False and r['endurance_72h']=='NOT_CLAIMED','Inspection promoted a blocked selected mode')
            expect(r['modes']['account_session']['latest']['id']==blocked['codex']['result']['id'] and r['modes']['api_credential']['latest']['id']==records['codex-profile']['result']['id'],'Inspection did not return the latest record per mode')
        check('native.qualification.inspect-latest-per-mode',inspected)
        def durable():
            rows=f.sql("SELECT * FROM hyperfide.native_auth_qualifications WHERE organisation_id=$1 AND run_id=$2",[f.ids['organisation'],f.ids['run']])
            text=json.dumps(rows)
            expect(len(rows)==6 and canary not in text and not any(str(p['runtime_home']) in text for p in list(profiles.values())+list(accounts.values())) and '/root/.codex' not in text,'Durable records missing or carrying secret/private material')
            expect(sorted(r['record_digest'] for r in rows)==sorted([r['result']['record_digest'] for r in list(records.values())+list(blocked.values())]),'Durable record digests differ from returned records')
        check('native.qualification.durable-records-no-secrets',durable)
        def append_only():
            try:f.sql("UPDATE hyperfide.native_auth_qualifications SET state='PROBED_UNQUALIFIED' WHERE organisation_id=$1",[f.ids['organisation']])
            except Exception as e:expect('append-only' in str(e),'Unexpected qualification update failure: '+str(e)[:300]);return
            raise AssertionError('Qualification record was rewritten')
        check('native.qualification.records-append-only',append_only)
        mode_config('operator-modes-1')
        import threading
        race=[None]*4;gate=threading.Barrier(4)
        def refresher(n):
            gate.wait();race[n]=f.invoke('native.auth.refresh.commit',{'connector':'codex','auth_mode':'account_session','expected_generation':'0','state_digest':sha(('refresh-'+str(n)).encode())},component='14.3',timeout_seconds=30)[1]
        threads=[threading.Thread(target=refresher,args=(n,)) for n in range(4)]
        for t in threads:t.start()
        for t in threads:t.join(60)
        check('native.refresh.concurrent-commit-single-winner',lambda:expect(sum(1 for r in race if r and r.get('ok') is True)==1 and sum(1 for r in race if r and code(r)=='STALE_REFRESH_STATE')==3,'Concurrent refresh writes were not serialised: '+json.dumps(race)[:1200]))
        def stale_refused():
            winner=next(r for r in race if r.get('ok') is True)['result']
            current=f.invoke('native.auth.refresh.commit',{'connector':'codex','auth_mode':'account_session','expected_generation':'1','state_digest':sha(b'refresh-next')},component='14.3')[1]
            stale=f.invoke('native.auth.refresh.commit',{'connector':'codex','auth_mode':'account_session','expected_generation':'1','state_digest':sha(b'refresh-stale')},component='14.3')[1]
            row=f.sql("SELECT generation,state_digest FROM hyperfide.native_auth_refresh_lineage WHERE organisation_id=$1 AND run_id=$2 AND lineage_id='runtime:codex:account_session'",[f.ids['organisation'],f.ids['run']])
            expect(winner['generation']=='1' and current.get('ok') is True and current['result']['generation']=='2' and code(stale)=='STALE_REFRESH_STATE' and len(row)==1 and str(row[0]['generation'])=='2' and row[0]['state_digest']==sha(b'refresh-next'),'Stale refresh state overwrote the current lineage')
        check('native.refresh.stale-write-cannot-overwrite-lineage',stale_refused)
        def migration_required():
            # Remove the 0042 history row (and later rows so only absence, not order, is tested); readiness must refuse, never repair.
            later=[m for m in sorted((ROOT/'services/hyperfide/migrations').glob('0*.sql')) if int(m.name[:4])>=42]
            args={'components':str(f.components),'policy':str(f.policy)}
            service="import fs from 'node:fs';import {ComponentRegistry} from './services/hyperfide/dist/components/registry.js';import {validatePolicy} from './services/hyperfide/dist/policy/programme.js';const a=JSON.parse(fs.readFileSync(0,'utf8')),c=new AbortController(),policy=validatePolicy(JSON.parse(fs.readFileSync(a.policy,'utf8')),'fixture-identity-v1','control'),r=new ComponentRegistry({role:'control',env:process.env,signal:c.signal,policy});try{await r.load(a.components,process.cwd()+'/services/hyperfide/dist');process.stdout.write('accepted')}catch(e){process.stdout.write(e.code==='COMPONENT_LOAD_FAILED'?'refused':String(e.code))}finally{await r.close();}"
            # The release storage gate refuses first in a full load, so the 14.3 factory's own gate is also exercised against the same database.
            factory="import {createRequire} from 'node:module';import {createComponent} from './services/hyperfide/dist/identity/native_auth.js';const pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg');const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();const gateway={withPrimaryTransaction:async(o,op)=>{await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');try{const r=await op(db);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}};const f=()=>Promise.resolve();const credentials={inspectInTransaction:f,resolveCredentialReferences:f,inspect:f,attach:f,privateAttachment:f};try{await createComponent({role:'control',env:process.env,signal:new AbortController().signal,resources:{gateway},dependencies:{require:(id,name,guard)=>{if(id!=='14.2'||!guard(credentials))throw new Error('unexpected dependency');return credentials;}}});process.stdout.write('loaded')}catch(e){process.stdout.write(String(e.code))}finally{await db.end();}"
            run=lambda script,data='':subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,env=f.env,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
            f.sql("DELETE FROM hyperfide.schema_migrations WHERE version>=42")
            try:absent_service=run(service,json.dumps(args));absent_factory=run(factory)
            finally:
                for m in later:f.sql("INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES($1,$2,$3)",[int(m.name[:4]),m.stem,sha(m.read_bytes())])
            present_factory=run(factory)
            expect(absent_service.stdout=='refused','Service loaded without the native qualification migration: '+absent_service.stdout[:200]+absent_service.stderr[:300])
            expect(absent_factory.stdout=='NATIVE_QUALIFICATION_SCHEMA_REQUIRED','14.3 readiness did not refuse an absent migration: '+absent_factory.stdout[:200]+absent_factory.stderr[:300])
            expect(present_factory.stdout=='loaded','14.3 readiness refused the exact applied migration: '+present_factory.stdout[:200]+present_factory.stderr[:300])
        check('native.qualification.migration-readiness-required',migration_required)
        check('native.claude.large-installed-binary',lambda:expect(Path(profiles['claude']['binary']['path']).stat().st_size>128*1024*1024,'Test did not exercise real >128MiB Claude payload'))
        check('native.unknown-profile-refused',lambda:expect(f.invoke('native.auth.snapshot',{'profile_id':'unknown'},component='14.3')[1].get('error',{}).get('code')=='NATIVE_AUTH_PROFILE_UNKNOWN','Unknown native profile accepted'))
        body=f.operation('14.3','native.auth.snapshot',{'profile_id':'claude-profile'});raw=canonical(body);seconds=str(int(time.time()));nonce=uid();signature=f.sign('operator',('\n'.join(('HYPERFIDE-REQUEST-V1','POST','/v1/invoke',f.origin,f.ids['operator'],seconds,nonce,sha(raw),''))).encode())
        args={'components':str(f.components),'policy':str(f.policy),'body':b64(raw),'headers':['HF-Credential-Id',f.ids['operator'],'HF-Request-Time',seconds,'HF-Request-Nonce',nonce,'HF-Request-Signature',signature]}
        script="""import fs from 'node:fs';import {ComponentRegistry} from './services/hyperfide/dist/components/registry.js';import {validatePolicy} from './services/hyperfide/dist/policy/programme.js';const a=JSON.parse(fs.readFileSync(0,'utf8')),c=new AbortController(),policy=validatePolicy(JSON.parse(fs.readFileSync(a.policy,'utf8')),'fixture-identity-v1','control'),r=new ComponentRegistry({role:'control',env:process.env,signal:c.signal,policy});try{await r.load(a.components,process.cwd()+'/services/hyperfide/dist');const auth=r.resolveCapability('14.1','identity.authority',v=>typeof v.authenticate==='function'),i=await auth.authenticate(Buffer.from(a.body,'base64url'),a.headers,c.signal),n=r.resolveCapability('14.3','identity.native-auth',v=>typeof v.privateRuntime==='function');let forged=false,missing=false,runtimeAvailable=false;try{await n.privateRuntime({...i},'claude-profile')}catch(e){forged=e.code==='AUTH_REQUIRED'}try{const p=await n.privateRuntime(i,'claude-profile');runtimeAvailable=p.target_uid===41201&&p.snapshot.qualification.state==='UNQUALIFIED'&&p.runtime_home.endsWith('claude-empty-home')&&p.configured_account_key==='declared-fixture-account-claude'&&p.observed_account_id===null}catch(e){missing=e.code==='AUTH_BLOCKED'}process.stdout.write(JSON.stringify({forged,missing,runtimeAvailable}));}finally{await r.close();}"""
        p=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,env=f.env,input=json.dumps(args),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        expect(p.returncode==0,'Actual private native capability process failed: '+p.stderr[:500]);private=json.loads(p.stdout)
        check('native.private-runtime.rejects-forged-context',lambda:expect(private['forged'],'Forged native runtime context accepted'))
        check('native.private-runtime.requires-current-credential',lambda:expect(private['missing'],'Missing credential granted private runtime launch config'))
        rotated=f.invoke('credentials.reference.rotate',{'reference_id':'inference/native','source_name':'token','expected_version':'0','expires_at':expiry,'allowed_layers':['runtime'],'allowed_roles':['OPERATOR'],'refresh_owner':f.ids['operator'],'purposes':['WORKER_RUNTIME']},component='14.2')[1]
        expect(rotated.get('ok') is True,'Actual native reference rotation failed: '+json.dumps(rotated))
        nonce=uid();seconds=str(int(time.time()));args['headers']=['HF-Credential-Id',f.ids['operator'],'HF-Request-Time',seconds,'HF-Request-Nonce',nonce,'HF-Request-Signature',f.sign('operator',('\n'.join(('HYPERFIDE-REQUEST-V1','POST','/v1/invoke',f.origin,f.ids['operator'],seconds,nonce,sha(raw),''))).encode())]
        p=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,env=f.env,input=json.dumps(args),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        expect(p.returncode==0,'Actual private native runtime getter failed: '+p.stderr[:500]);private=json.loads(p.stdout)
        check('native.private-runtime.current-reference-positive',lambda:expect(private['runtimeAvailable'] and not private['missing'],'Current native private binding unavailable'))
        check('native.private-runtime-does-not-return-secret-bytes',lambda:expect(canary not in p.stdout,'Private runtime getter exposed credential bytes'))
        import signal
        abort_body=f.operation('14.3','native.auth.probe',{'profile_id':'claude-profile'});abort_raw=canonical(abort_body);abort_seconds=str(int(time.time()));abort_nonce=uid()
        abort_args={'components':str(f.components),'policy':str(f.policy),'body':b64(abort_raw),'headers':['HF-Credential-Id',f.ids['operator'],'HF-Request-Time',abort_seconds,'HF-Request-Nonce',abort_nonce,'HF-Request-Signature',f.sign('operator',('\n'.join(('HYPERFIDE-REQUEST-V1','POST','/v1/invoke',f.origin,f.ids['operator'],abort_seconds,abort_nonce,sha(abort_raw),''))).encode())]}
        abort_script="import fs from 'node:fs';import {ComponentRegistry} from './services/hyperfide/dist/components/registry.js';import {validatePolicy} from './services/hyperfide/dist/policy/programme.js';const a=JSON.parse(fs.readFileSync(0,'utf8')),c=new AbortController();process.once('SIGUSR2',()=>c.abort());const policy=validatePolicy(JSON.parse(fs.readFileSync(a.policy,'utf8')),'fixture-identity-v1','control'),r=new ComponentRegistry({role:'control',env:process.env,signal:c.signal,policy});let refused=false;try{await r.load(a.components,process.cwd()+'/services/hyperfide/dist');const auth=r.resolveCapability('14.1','identity.authority',v=>typeof v.authenticate==='function'),i=await auth.authenticate(Buffer.from(a.body,'base64url'),a.headers,c.signal),native=r.resolveCapability('14.3','identity.native-auth',v=>typeof v.probe==='function');try{await native.probe(i,'claude-profile')}catch{refused=true}process.stdout.write(JSON.stringify({refused,aborted:c.signal.aborted,remaining_children:fs.readFileSync('/proc/self/task/'+process.pid+'/children','utf8').trim()}));}finally{await r.close()}"
        owned=subprocess.Popen(['node','--input-type=module','-e',abort_script],cwd=ROOT,env=f.env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        seen=[];owned.stdin.write(json.dumps(abort_args));owned.stdin.close();owned.stdin=None
        try:
            deadline=time.monotonic()+15
            while time.monotonic()<deadline and owned.poll() is None:
                children=Path('/proc/'+str(owned.pid)+'/task/'+str(owned.pid)+'/children')
                if children.exists():seen=[int(pid) for pid in children.read_text().split()]
                if seen:
                    owned.send_signal(signal.SIGUSR2);break
                time.sleep(0.01)
            expect(bool(seen),'Actual pinned native child was never observed for abort test')
            stdout,stderr=owned.communicate(timeout=20)
            expect(owned.returncode==0,'Actual native abort fixture failed: '+stderr[:700]);aborted=json.loads(stdout)
            check('native.abort.refuses-incomplete-probe',lambda:expect(aborted['refused'] and aborted['aborted'],'Native cancellation reported a completed probe'))
            check('native.abort.waits-for-actual-child-close',lambda:expect(aborted['remaining_children']=='' and all(not Path('/proc/'+str(pid)).exists() for pid in seen),'Native probe released ownership before actual child close'))
        finally:
            if owned.poll() is None:owned.kill();owned.communicate(timeout=5)
        target=Path(profiles['claude']['binary']['path'])
        with target.open('r+b') as stream:first=stream.read(1);stream.seek(0);stream.write(b'X')
        try:
            result=f.invoke('native.auth.probe',{'profile_id':'claude-profile'},component='14.3')[1]
            check('native.exec-time-binary-drift-refused',lambda:expect(result.get('error',{}).get('code')=='NATIVE_BINARY_DRIFT','Changed installed binary executed'))
        finally:
            with target.open('r+b') as stream:stream.write(first)
        def wrapper_refused():
            wrapper=f.path/'codex-wrapper';wrapper.write_text('#!/usr/bin/env node\nconsole.log("fake");\n');wrapper.chmod(0o755)
            changed=json.loads(json.dumps(profiles['codex']));changed['binary']={'path':str(wrapper),'digest':file_hash(wrapper),'version':'fake'}
            f.profile_file.write_text(json.dumps({'schema_version':1,'profiles':[changed]}))
            args={'components':str(f.components),'policy':str(f.policy)}
            script="""import fs from 'node:fs';import {ComponentRegistry} from './services/hyperfide/dist/components/registry.js';import {validatePolicy} from './services/hyperfide/dist/policy/programme.js';const a=JSON.parse(fs.readFileSync(0,'utf8')),c=new AbortController(),policy=validatePolicy(JSON.parse(fs.readFileSync(a.policy,'utf8')),'fixture-identity-v1','control'),r=new ComponentRegistry({role:'control',env:process.env,signal:c.signal,policy});try{await r.load(a.components,process.cwd()+'/services/hyperfide/dist');process.stdout.write('accepted')}catch(e){process.stdout.write(e.code==='COMPONENT_LOAD_FAILED'&&e.message.includes('native ELF payload')?'refused':e.code)}finally{await r.close();}"""
            p=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,env=f.env,input=json.dumps(args),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
            expect(p.returncode==0 and p.stdout=='refused','Wrapper/shim was treated as complete native binary identity: '+p.stdout+p.stderr[:300])
        check('native.shim-wrapper-cannot-stand-in-for-payload',wrapper_refused)
    finally:f.close()
    write_identity_observations()
    return int(any(actual!='observed' for _,actual in RESULTS))
if __name__=='__main__':raise SystemExit(main())
