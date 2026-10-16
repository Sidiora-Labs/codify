#!/usr/bin/env python3
from pathlib import Path
import sys,json,os,shutil,time,subprocess,hashlib
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,RESULTS,check,expect,uid,sha,canonical,b64

def file_hash(p):
    with p.open('rb') as stream:return 'sha256:'+hashlib.file_digest(stream,'sha256').hexdigest()
def main():
    canary='HF_NATIVE_TEST_'+uid();profiles={};expiry=time.strftime('%Y-%m-%dT%H:%M:%S.000Z',time.gmtime(time.time()+1800))
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
            profiles[name]={'schema_version':1,'profile_id':name+'-profile','profile_revision':'1','connector':name,'auth_mode':'api_credential','binary':{'path':str(target),'digest':file_hash(target),'version':'2.1.300' if name=='claude' else '0.162.1'},'credential_reference':'inference/native','configured_provider_id':name+'-configured','configured_model_alias':name+'-policy-alias','requested_model_id':'configured-only-model-id','permission_profile_id':'restricted-native','capabilities':{'unattended':False,'refresh':False,'concurrent_account':False,'portable_session':False,'explicit_resume':False},'runtime_home':str(home),'target_uid':41201+index}
        f.profile_file=f.path/'native-profiles.json';f.profile_file.write_text(json.dumps({'schema_version':1,'profiles':list(profiles.values())}));f.profile_file.chmod(0o600);f.env['HF_NATIVE_AUTH_PROFILES_FILE']=str(f.profile_file)
    f=IdentityFixture(extra_components=['14.2','14.3'],extra_setup=setup)
    try:
        for name in profiles:
            value=f.invoke('native.auth.snapshot',{'profile_id':name+'-profile'},component='14.3')[1]
            check('native.'+name+'.actual-profile-loaded',lambda v=value:expect(v.get('ok') is True,'Actual native profile failed: '+json.dumps(v)))
            snapshot=value['result']
            check('native.'+name+'.no-invented-live-qualification',lambda s=snapshot:expect(s['qualification']=={'state':'UNQUALIFIED','live_qualified':False,'receipt_digest':None},'Version pin promoted live qualification'))
            check('native.'+name+'.unknown-observed-identity',lambda s=snapshot:expect(s['observed_model_id'] is None and s['observed_provider_id'] is None and s['configured_model_alias']!=s['requested_model_id'],'Configured labels became observed identity'))
            check('native.'+name+'.public-no-private-runtime',lambda s=snapshot:expect('runtime_home' not in s and 'target_uid' not in s and canary not in json.dumps(s),'Private native material leaked'))
            result=f.invoke('native.auth.probe',{'profile_id':name+'-profile'},component='14.3')[1]
            check('native.'+name+'.real-clean-home-version-auth-probe',lambda r=result:expect(r.get('ok') is True and r['result']['runtime_version_verified'] is True and r['result']['native_authentication']=='AUTH_BLOCKED','Actual clean-home CLI probe failed: '+json.dumps(r)))
            check('native.'+name+'.probe-does-not-qualify-vendor',lambda r=result:expect(r['result']['live_qualified'] is False and r['result']['refresh_qualified'] is False and r['result']['endurance_72h_qualified'] is False and canary not in json.dumps(r),'Probe invented qualification or leaked secret'))
        check('native.claude.large-installed-binary',lambda:expect(Path(profiles['claude']['binary']['path']).stat().st_size>128*1024*1024,'Test did not exercise real >128MiB Claude payload'))
        check('native.unknown-profile-refused',lambda:expect(f.invoke('native.auth.snapshot',{'profile_id':'unknown'},component='14.3')[1].get('error',{}).get('code')=='NATIVE_AUTH_PROFILE_UNKNOWN','Unknown native profile accepted'))
        body=f.operation('14.3','native.auth.snapshot',{'profile_id':'claude-profile'});raw=canonical(body);seconds=str(int(time.time()));nonce=uid();signature=f.sign('operator',('\n'.join(('HYPERFIDE-REQUEST-V1','POST','/v1/invoke',f.origin,f.ids['operator'],seconds,nonce,sha(raw),''))).encode())
        args={'components':str(f.components),'policy':str(f.policy),'body':b64(raw),'headers':['HF-Credential-Id',f.ids['operator'],'HF-Request-Time',seconds,'HF-Request-Nonce',nonce,'HF-Request-Signature',signature]}
        script="""import fs from 'node:fs';import {ComponentRegistry} from './services/hyperfide/dist/components/registry.js';import {validatePolicy} from './services/hyperfide/dist/policy/programme.js';const a=JSON.parse(fs.readFileSync(0,'utf8')),c=new AbortController(),policy=validatePolicy(JSON.parse(fs.readFileSync(a.policy,'utf8')),'fixture-identity-v1','control'),r=new ComponentRegistry({role:'control',env:process.env,signal:c.signal,policy});try{await r.load(a.components,process.cwd()+'/services/hyperfide/dist');const auth=r.resolveCapability('14.1','identity.authority',v=>typeof v.authenticate==='function'),i=await auth.authenticate(Buffer.from(a.body,'base64url'),a.headers,c.signal),n=r.resolveCapability('14.3','identity.native-auth',v=>typeof v.privateRuntime==='function');let forged=false,missing=false,runtimeAvailable=false;try{await n.privateRuntime({...i},'claude-profile')}catch(e){forged=e.code==='AUTH_REQUIRED'}try{const p=await n.privateRuntime(i,'claude-profile');runtimeAvailable=p.target_uid===41201&&p.snapshot.qualification.state==='UNQUALIFIED'&&p.runtime_home.endsWith('claude-empty-home')}catch(e){missing=e.code==='AUTH_BLOCKED'}process.stdout.write(JSON.stringify({forged,missing,runtimeAvailable}));}finally{await r.close();}"""
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
    return int(any(actual!='observed' for _,actual in RESULTS))
if __name__=='__main__':raise SystemExit(main())
