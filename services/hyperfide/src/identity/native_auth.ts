import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import type {Component,ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {exact,fail,frozen,hash,NAME,strictJSON} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {invocationOf} from './enrollment.js';
import {isCredentialAuthority} from './credentials.js';
export interface AuthProfileSnapshot {
 schema_version:1;profile_id:string;profile_revision:string;profile_digest:string;connector:'codex'|'claude';
 auth_mode:'account_session'|'api_credential';binary:{path:string;digest:string;version:string};
 credential_reference:string;configured_provider_id:string;observed_provider_id:string|null;configured_model_alias:string;requested_model_id:string;observed_model_id:string|null;
 permission_profile_id:string;capabilities:{unattended:boolean;refresh:boolean;concurrent_account:boolean;portable_session:boolean;explicit_resume:boolean};
 qualification:{state:'UNQUALIFIED'|'QUALIFIED'|'STALE';live_qualified:boolean;receipt_digest:string|null};
}
interface Profile {snapshot:AuthProfileSnapshot;runtime_home:string;target_uid:number}
export interface NativeAuthAuthority {resolve(profileId:string):AuthProfileSnapshot;probe(i:InvocationContext,profileId:string):Promise<unknown>}
export function isNativeAuthAuthority(v:unknown):v is NativeAuthAuthority{return object(v)&&typeof v.resolve==='function'&&typeof v.probe==='function';}
function sorted(v:unknown):unknown {if(Array.isArray(v))return v.map(sorted);if(object(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]));return v;}
function nonempty(v:unknown):v is string{return typeof v==='string'&&v.length>0&&v.length<=255&&!/[\x00-\x1f]/.test(v);}
async function profiles(ctx:ComponentContext):Promise<Map<string,Profile>>{
 const file=ctx.env.HF_NATIVE_AUTH_PROFILES_FILE;if(!file)fail('NATIVE_AUTH_CONFIG','Trusted native authentication profiles required');
 const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>1048576)fail('NATIVE_AUTH_CONFIG','Bounded regular profile file required');
 const raw=strictJSON(await fs.readFile(file));exact(raw,['schema_version','profiles']);if(raw.schema_version!==1||!Array.isArray(raw.profiles)||!raw.profiles.length||raw.profiles.length>128)fail('NATIVE_AUTH_CONFIG','Invalid profiles inventory');
 const result=new Map<string,Profile>(),homes=new Set<string>();
 for(const v of raw.profiles){
  exact(v,['schema_version','profile_id','profile_revision','connector','auth_mode','binary','credential_reference','configured_provider_id','configured_model_alias','requested_model_id','permission_profile_id','capabilities','runtime_home','target_uid']);
  if(v.schema_version!==1||typeof v.profile_id!=='string'||!NAME.test(v.profile_id)||result.has(v.profile_id)||!nonempty(v.profile_revision)||!['codex','claude'].includes(String(v.connector))||!['account_session','api_credential'].includes(String(v.auth_mode))||!nonempty(v.credential_reference)||!nonempty(v.configured_provider_id)||!nonempty(v.configured_model_alias)||!nonempty(v.requested_model_id)||!nonempty(v.permission_profile_id)||typeof v.runtime_home!=='string'||!path.isAbsolute(v.runtime_home)||!Number.isInteger(v.target_uid)||Number(v.target_uid)<1000||homes.has(v.runtime_home))fail('NATIVE_AUTH_CONFIG','Invalid connector/auth profile or shared native home');
  exact(v.binary,['path','digest','version']);if(typeof v.binary.path!=='string'||!path.isAbsolute(v.binary.path)||typeof v.binary.digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(v.binary.digest)||!nonempty(v.binary.version))fail('NATIVE_AUTH_CONFIG','Pinned binary identity required');
  exact(v.capabilities,['unattended','refresh','concurrent_account','portable_session','explicit_resume']);if(Object.values(v.capabilities).some(x=>typeof x!=='boolean'))fail('NATIVE_AUTH_CONFIG','Explicit capability booleans required');
  const real=await fs.realpath(v.binary.path),info=await fs.stat(real);if(!info.isFile()||info.size<1||info.size>128*1024*1024||hash(await fs.readFile(real))!==v.binary.digest)fail('NATIVE_BINARY_DRIFT','Configured binary bytes differ from pinned digest');
  const home=await fs.lstat(v.runtime_home);if(!home.isDirectory()||home.isSymbolicLink()||home.uid!==Number(v.target_uid)||(home.mode&0o077)!==0)fail('NATIVE_AUTH_CONFIG','Native home requires private per-UID ownership');
  homes.add(v.runtime_home);
  const snapshot:AuthProfileSnapshot=frozen({schema_version:1,profile_id:v.profile_id,profile_revision:v.profile_revision,profile_digest:hash(JSON.stringify(sorted(v))),connector:v.connector as 'codex'|'claude',auth_mode:v.auth_mode as 'account_session'|'api_credential',binary:{path:real,digest:v.binary.digest,version:v.binary.version},credential_reference:v.credential_reference,configured_provider_id:v.configured_provider_id,observed_provider_id:null,configured_model_alias:v.configured_model_alias,requested_model_id:v.requested_model_id,observed_model_id:null,permission_profile_id:v.permission_profile_id,capabilities:v.capabilities as unknown as AuthProfileSnapshot['capabilities'],qualification:{state:'UNQUALIFIED',live_qualified:false,receipt_digest:null}});
  result.set(v.profile_id,{snapshot,runtime_home:v.runtime_home,target_uid:Number(v.target_uid)});
 }
 return result;
}
async function run(profile:Profile,args:string[],signal:AbortSignal):Promise<{exit_code:number|null;stdout:string;stderr:string}>{
 const s=profile.snapshot,bytes=await fs.readFile(s.binary.path);if(hash(bytes)!==s.binary.digest)fail('NATIVE_BINARY_DRIFT','Pinned runtime changed before execution');
 const javascript=bytes.subarray(0,128).toString('utf8').startsWith('#!')&&bytes.subarray(0,128).toString('utf8').includes('node');
 const executable=javascript?process.execPath:s.binary.path,argv=javascript?[s.binary.path,...args]:args;
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,argv,{shell:false,stdio:['ignore','pipe','pipe'],uid:profile.target_uid,gid:profile.target_uid,
    env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:profile.runtime_home,XDG_CONFIG_HOME:path.join(profile.runtime_home,'.config'),LANG:'C.UTF-8'},signal});
  const out:Buffer[]=[],err:Buffer[]=[];let size=0,settled=false;
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  const data=(target:Buffer[])=> (chunk:Buffer):void=>{size+=chunk.length;if(size>65536){child.kill('SIGKILL');return;}target.push(chunk);};
  child.stdout.on('data',data(out));child.stderr.on('data',data(err));
  child.once('error',()=>{if(!settled){settled=true;clearTimeout(timer);reject(new Error('Pinned native authentication probe could not start'));}});
  child.once('close',(code,termination)=>{if(settled)return;settled=true;clearTimeout(timer);if(size>65536||termination)reject(new Error('Pinned native authentication probe exceeded bounds'));else resolve({exit_code:code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});});
 });
}
export async function createComponent(ctx:ComponentContext):Promise<Component>{
 const inventory=await profiles(ctx),credentials=ctx.dependencies.require('14.2','identity.credentials',isCredentialAuthority);
 const resolve=(id:string):AuthProfileSnapshot=>{const p=inventory.get(id);if(!p)fail('NATIVE_AUTH_PROFILE_UNKNOWN','Unknown configured authentication profile');return p.snapshot;};
 const probe:NativeAuthAuthority['probe']=async(i,id)=>{
  const profile=inventory.get(id);if(!profile)fail('NATIVE_AUTH_PROFILE_UNKNOWN','Unknown configured authentication profile');
  const availability=await credentials.inspect(i,profile.snapshot.credential_reference);
  const version=await run(profile,['--version'],i.signal),text=version.stdout.trim();
  if(version.exit_code!==0||!text.includes(profile.snapshot.binary.version))fail('NATIVE_VERSION_DRIFT','Pinned runtime reports an unexpected version');
  const status=await run(profile,profile.snapshot.connector==='codex'?['login','status']:['auth','status'],i.signal);
  // No raw auth stdout/stderr or account identifier enters ordinary evidence.
  const loggedIn=status.exit_code===0;
  return {snapshot:profile.snapshot,runtime_version_verified:true,credential:availability,native_authentication:loggedIn?'AUTHENTICATED':'AUTH_BLOCKED',
    auth_mode:profile.snapshot.auth_mode,refresh_qualified:false,portability_qualified:false,endurance_72h_qualified:false,live_qualified:false,
    reason:'Version/auth-status probes do not qualify inference, model identity, permission behaviour, refresh or endurance'};
 };
 const authority:NativeAuthAuthority=Object.freeze({resolve,probe});
 const input=(v:unknown):string=>{exact(v,['profile_id']);if(typeof v.profile_id!=='string')fail('INVALID_REQUEST','Configured profile identity required');return v.profile_id;};
 return {apiVersion:1,capabilities:{'identity.native-auth':authority},actions:{
  'native.auth.snapshot':async(v,context)=>{invocationOf(context);return resolve(input(v));},
  'native.auth.probe':async(v,context)=>probe(invocationOf(context),input(v))
 }};
}
