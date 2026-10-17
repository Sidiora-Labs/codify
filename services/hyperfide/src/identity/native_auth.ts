import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';
import type {Component,ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {assertInvocation,exact,fail,frozen,hash,NAME,strictJSON} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {gatewayOf,invocationOf} from './enrollment.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {isCredentialAuthority} from './credentials.js';
import {createQualificationStore,qualificationReady} from './qualification.js';
export interface AuthProfileSnapshot {
 schema_version:1;profile_id:string;profile_revision:string;profile_digest:string;connector:'codex'|'claude';
 auth_mode:'account_session'|'api_credential';binary:{path:string;digest:string;version:string};
 credential_reference:string;configured_provider_id:string;observed_provider_id:string|null;configured_model_alias:string;requested_model_id:string;observed_model_id:string|null;
 permission_profile_id:string;capabilities:{unattended:boolean;refresh:boolean;concurrent_account:boolean;portable_session:boolean;explicit_resume:boolean};
 qualification:{state:'UNQUALIFIED'|'QUALIFIED'|'STALE';live_qualified:boolean;receipt_digest:string|null};
}
interface Profile {snapshot:AuthProfileSnapshot;runtime_home:string;target_uid:number;configured_account_key:string}
export interface NativeAuthAuthority {resolve(profileId:string):AuthProfileSnapshot;privateRuntimeInTransaction(tx:PrimaryTransaction,i:InvocationContext,profileId:string):Promise<{snapshot:AuthProfileSnapshot;runtime_home:string;target_uid:number;configured_account_key:string;observed_account_id:null}>;privateRuntime(i:InvocationContext,profileId:string):Promise<{snapshot:AuthProfileSnapshot;runtime_home:string;target_uid:number;configured_account_key:string;observed_account_id:null}>;probe(i:InvocationContext,profileId:string):Promise<unknown>}
export function isNativeAuthAuthority(v:unknown):v is NativeAuthAuthority{return object(v)&&typeof v.resolve==='function'&&typeof v.privateRuntime==='function'&&typeof v.privateRuntimeInTransaction==='function'&&typeof v.probe==='function';}
function sorted(v:unknown):unknown {if(Array.isArray(v))return v.map(sorted);if(object(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]));return v;}
function nonempty(v:unknown):v is string{return typeof v==='string'&&v.length>0&&v.length<=255&&!/[\x00-\x1f]/.test(v);}
async function binaryIdentity(filename:string):Promise<{digest:string;header:Buffer}>{
 const file=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await file.stat();if(!before.isFile()||before.size<1||before.size>1024*1024*1024||(before.mode&0o022)!==0||(before.mode&0o111)===0)fail('NATIVE_BINARY_DRIFT','Bounded immutable installed executable required');
 const digest=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let total=0,header=Buffer.alloc(0);
 while(true){const n=await file.read(buffer,0,buffer.length,null);if(!n.bytesRead)break;total+=n.bytesRead;if(total>1024*1024*1024)fail('NATIVE_BINARY_DRIFT','Installed executable exceeds trusted limit');if(!header.length)header=Buffer.from(buffer.subarray(0,Math.min(128,n.bytesRead)));digest.update(buffer.subarray(0,n.bytesRead));}
 const after=await file.stat();if(total!==before.size||before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)fail('NATIVE_BINARY_DRIFT','Installed executable changed while hashing');
 if(header.length<4||!header.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])))fail('NATIVE_BINARY_DRIFT','Pin the installed native ELF payload, not a shim or script wrapper');
 return {digest:'sha256:'+digest.digest('hex'),header};}finally{await file.close();}
}
async function profiles(ctx:ComponentContext):Promise<Map<string,Profile>>{
 const file=ctx.env.HF_NATIVE_AUTH_PROFILES_FILE;if(!file)fail('NATIVE_AUTH_CONFIG','Trusted native authentication profiles required');
 const st=await fs.lstat(file);if(!path.isAbsolute(file)||!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>1048576)fail('NATIVE_AUTH_CONFIG','Bounded regular profile file required');
 const raw=strictJSON(await fs.readFile(file));exact(raw,['schema_version','profiles']);if(raw.schema_version!==1||!Array.isArray(raw.profiles)||!raw.profiles.length||raw.profiles.length>128)fail('NATIVE_AUTH_CONFIG','Invalid profiles inventory');
 const result=new Map<string,Profile>(),homes=new Set<string>(),uids=new Set<number>();
 for(const v of raw.profiles){
  exact(v,['schema_version','profile_id','profile_revision','connector','auth_mode','binary','credential_reference','configured_provider_id','configured_model_alias','requested_model_id','permission_profile_id','capabilities','runtime_home','target_uid','configured_account_key']);
  if(v.schema_version!==1||typeof v.profile_id!=='string'||!NAME.test(v.profile_id)||result.has(v.profile_id)||!nonempty(v.profile_revision)||typeof v.connector!=='string'||!['codex','claude'].includes(v.connector)||typeof v.auth_mode!=='string'||!['account_session','api_credential'].includes(v.auth_mode)||!nonempty(v.credential_reference)||!nonempty(v.configured_provider_id)||!nonempty(v.configured_model_alias)||!nonempty(v.requested_model_id)||!nonempty(v.permission_profile_id)||!nonempty(v.configured_account_key)||typeof v.runtime_home!=='string'||!path.isAbsolute(v.runtime_home)||!Number.isInteger(v.target_uid)||Number(v.target_uid)<1000||Number(v.target_uid)>2147483647||homes.has(v.runtime_home)||uids.has(Number(v.target_uid)))fail('NATIVE_AUTH_CONFIG','Invalid connector/auth profile or shared native home');
  exact(v.binary,['path','digest','version']);if(typeof v.binary.path!=='string'||!path.isAbsolute(v.binary.path)||typeof v.binary.digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(v.binary.digest)||!nonempty(v.binary.version))fail('NATIVE_AUTH_CONFIG','Pinned binary identity required');
  exact(v.capabilities,['unattended','refresh','concurrent_account','portable_session','explicit_resume']);if(Object.values(v.capabilities).some(x=>typeof x!=='boolean'))fail('NATIVE_AUTH_CONFIG','Explicit capability booleans required');
  const real=await fs.realpath(v.binary.path),identity=await binaryIdentity(real);if(identity.digest!==v.binary.digest)fail('NATIVE_BINARY_DRIFT','Configured binary bytes differ from pinned digest');
  const home=await fs.lstat(v.runtime_home);if(!home.isDirectory()||home.isSymbolicLink()||home.uid!==Number(v.target_uid)||(home.mode&0o077)!==0)fail('NATIVE_AUTH_CONFIG','Native home requires private per-UID ownership');
  homes.add(v.runtime_home);uids.add(Number(v.target_uid));
  const snapshot:AuthProfileSnapshot=frozen({schema_version:1,profile_id:v.profile_id,profile_revision:v.profile_revision,profile_digest:hash(JSON.stringify(sorted(v))),connector:v.connector as 'codex'|'claude',auth_mode:v.auth_mode as 'account_session'|'api_credential',binary:{path:real,digest:v.binary.digest,version:v.binary.version},credential_reference:v.credential_reference,configured_provider_id:v.configured_provider_id,observed_provider_id:null,configured_model_alias:v.configured_model_alias,requested_model_id:v.requested_model_id,observed_model_id:null,permission_profile_id:v.permission_profile_id,capabilities:v.capabilities as unknown as AuthProfileSnapshot['capabilities'],qualification:{state:'UNQUALIFIED',live_qualified:false,receipt_digest:null}});
  result.set(v.profile_id,{snapshot,runtime_home:v.runtime_home,target_uid:Number(v.target_uid),configured_account_key:v.configured_account_key as string});
 }
 return result;
}
async function run(profile:Profile,args:string[],signal:AbortSignal):Promise<{exit_code:number|null;stdout:string;stderr:string}>{
 signal.throwIfAborted();const s=profile.snapshot,identity=await binaryIdentity(s.binary.path);signal.throwIfAborted();
 if(identity.digest!==s.binary.digest)fail('NATIVE_BINARY_DRIFT','Pinned runtime changed before execution');
 return new Promise((resolve,reject)=>{
  const child=spawn(s.binary.path,args,{shell:false,stdio:['ignore','pipe','pipe'],uid:profile.target_uid,gid:profile.target_uid,
   env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:profile.runtime_home,XDG_CONFIG_HOME:path.join(profile.runtime_home,'.config'),LANG:'C.UTF-8'}});
  const out:Buffer[]=[],err:Buffer[]=[];let size=0,failed=false,spawnError=false;
  const terminate=():void=>{failed=true;child.kill('SIGKILL');};
  const timer=setTimeout(terminate,10000);
  signal.addEventListener('abort',terminate,{once:true});
  const data=(target:Buffer[]) => (chunk:Buffer):void=>{size+=chunk.length;if(size>65536){terminate();return;}target.push(chunk);};
  child.stdout.on('data',data(out));child.stderr.on('data',data(err));
  // Failed spawn and abort must not release process ownership before actual close.
  child.once('error',()=>{spawnError=true;terminate();});
  child.once('close',(code,termination)=>{
   clearTimeout(timer);signal.removeEventListener('abort',terminate);
   if(failed||spawnError||signal.aborted||size>65536||termination)reject(new Error('Pinned native authentication probe did not complete safely'));
   else resolve({exit_code:code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});
  });
  if(signal.aborted)terminate();
 });
}
export async function createComponent(ctx:ComponentContext):Promise<Component>{
 const inventory=await profiles(ctx),gateway=gatewayOf(ctx),credentials=ctx.dependencies.require('14.2','identity.credentials',isCredentialAuthority);await qualificationReady(gateway);
 const qualification=createQualificationStore(ctx,gateway,new Map([...inventory].map(([id,p])=>[id,p.snapshot])));
 const resolve=(id:string):AuthProfileSnapshot=>{const p=inventory.get(id);if(!p)fail('NATIVE_AUTH_PROFILE_UNKNOWN','Unknown configured authentication profile');return p.snapshot;};
 const privateRuntimeInTransaction:NativeAuthAuthority['privateRuntimeInTransaction']=async(tx,i,id)=>{
  assertInvocation(i);await i.guard(tx);const profile=inventory.get(id);if(!profile)fail('NATIVE_AUTH_PROFILE_UNKNOWN','Unknown configured authentication profile');
  const available=await credentials.inspectInTransaction(tx,i,profile.snapshot.credential_reference);
  if(available.status!=='AVAILABLE')fail('AUTH_BLOCKED','Native profile credential reference is unavailable');
  await i.guard(tx);return frozen({snapshot:profile.snapshot,runtime_home:profile.runtime_home,target_uid:profile.target_uid,configured_account_key:profile.configured_account_key,observed_account_id:null});
 };
 const privateRuntime:NativeAuthAuthority['privateRuntime']=(i,id)=>gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:i.guard},async tx=>{assertPrimaryTransaction(tx);return privateRuntimeInTransaction(tx,i,id);});
 const probe:NativeAuthAuthority['probe']=async(i,id)=>{
  assertInvocation(i);await gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:i.guard},async()=>{});
  const profile=inventory.get(id);if(!profile)fail('NATIVE_AUTH_PROFILE_UNKNOWN','Unknown configured authentication profile');
  const availability=await credentials.inspect(i,profile.snapshot.credential_reference);
  const version=await run(profile,['--version'],i.signal),text=version.stdout.trim();
  if(version.exit_code!==0||!text.includes(profile.snapshot.binary.version))fail('NATIVE_VERSION_DRIFT','Pinned runtime reports an unexpected version');
  const status=await run(profile,profile.snapshot.connector==='codex'?['login','status']:['auth','status'],i.signal);
  // No raw auth stdout/stderr or account identifier enters ordinary evidence.
  const loggedIn=status.exit_code===0;
  await gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:i.guard},async()=>{});
  return {snapshot:profile.snapshot,runtime_version_verified:true,credential:availability,native_authentication:loggedIn?'AUTHENTICATED':'AUTH_BLOCKED',
    auth_mode:profile.snapshot.auth_mode,refresh_qualified:false,portability_qualified:false,endurance_72h_qualified:false,live_qualified:false,
    reason:'Version/auth-status probes do not qualify inference, model identity, permission behaviour, refresh or endurance'};
 };
 const authority:NativeAuthAuthority=Object.freeze({resolve,probe,privateRuntime,privateRuntimeInTransaction});
 const input=(v:unknown):string=>{exact(v,['profile_id']);if(typeof v.profile_id!=='string')fail('INVALID_REQUEST','Configured profile identity required');return v.profile_id;};
 return {apiVersion:1,capabilities:{'identity.native-auth':authority},actions:{
  'native.auth.snapshot':async(v,context)=>{const i=invocationOf(context);return gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:i.guard},async()=>resolve(input(v)));},
  'native.auth.probe':async(v,context)=>probe(invocationOf(context),input(v)),
  // Account-session and API-credential modes are qualified and recorded separately per connector.
  'native.auth.qualify':async(v,context)=>{const i=invocationOf(context),id=input(v);return qualification.qualify(i,resolve(id),async()=>probe(i,id) as Promise<{native_authentication:string}>);},
  'native.auth.qualification.inspect':async(v,context)=>{exact(v,['connector']);return qualification.inspect(invocationOf(context),v.connector);},
  'native.auth.refresh.commit':async(v,context)=>qualification.commitRefresh(invocationOf(context),v)
 }};
}
