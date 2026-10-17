import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import type {Component,ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {assertInvocation,canonicalOrigin,decimal,exact,fail,frozen,hash,NAME,strictJSON,uuid} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {gatewayOf,invocationOf} from './enrollment.js';
interface Rule {role:string;actions:string[];repositories:string[];artifact_prefixes:string[];git_refs:string[];model_destinations:string[];model_profiles:string[]}
export interface AuthorizationAuthority {authorize(i:InvocationContext):Promise<void>;resource(i:InvocationContext,input:unknown):Promise<unknown>}
export function isAuthorizationAuthority(v:unknown):v is AuthorizationAuthority{return object(v)&&typeof v.authorize==='function'&&typeof v.resource==='function';}
// Protected Git publication credentials stay in the control plane; sandbox/attempt-scoped principals never receive them.
const PUBLISHERS=['INTEGRATOR','COORDINATOR','OPERATOR'];
// Runner liveness actions are only meaningful from a sandbox-bound runner; any other origin is a forged heartbeat.
const RUNNER_ORIGIN_ACTIONS=['identity.runner.register','identity.runner.heartbeat'];
const RESOURCE_FIELDS=['kind','repository_id','target','profile_id'];
function code(error:unknown):string{const c=(error as {code?:unknown})?.code;return typeof c==='string'&&/^[A-Z_]{1,64}$/.test(c)?c:'AUTHORIZATION_FAILED';}
// Denials are auditable without echoing caller-supplied text: only bounded identifiers and a digest of the target are emitted.
function audit(i:unknown,error:unknown,resource?:unknown):void{
 const v=i as Partial<InvocationContext>|undefined,p=v?.principal,r=object(resource)?resource:undefined;
 const id=(x:unknown)=>typeof x==='string'&&uuid(x)?x:null,name=(x:unknown)=>typeof x==='string'&&NAME.test(x)?x:null;
 try{process.stderr.write(JSON.stringify({event:'authorization.denied',code:code(error),credential_id:id(p?.credential_id),role:typeof p?.role==='string'&&/^[A-Z_]{1,32}$/.test(p.role)?p.role:null,
  run_id:id(p?.run_id),action:name(v?.payload?.action),operation_id:id(v?.operation?.operation_id),resource_kind:name(r?.kind),
  target_digest:typeof r?.target==='string'?hash(r.target):null})+'\n');}catch{}
}
function list(v:unknown):string[]{if(!Array.isArray(v)||v.length>256||v.some(x=>typeof x!=='string'||!x.length||x.length>1024)||new Set(v).size!==v.length)fail('AUTHORIZATION_CONFIG','Explicit bounded unique policy lists required');return v as string[];}
function gitRef(v:string):boolean{return v.startsWith('refs/')&&!/[\x00-\x20\x7f~^:?*\\[]/.test(v)&&!v.includes('..')&&!v.includes('@{')&&!v.endsWith('/')&&!v.endsWith('.')&&!v.split('/').some(p=>!p||p.startsWith('.')||p.endsWith('.lock'));}
async function rules(ctx:ComponentContext):Promise<readonly Rule[]>{
 const file=ctx.env.HF_AUTHORIZATION_CONFIG_FILE;if(!file||!path.isAbsolute(file)||file.includes('\0'))fail('AUTHORIZATION_CONFIG','Absolute trusted authorization policy file required');
 let handle:Awaited<ReturnType<typeof fs.open>>|undefined;let bytes:Buffer;
 try{
  if(await fs.realpath(file)!==path.resolve(file))fail('AUTHORIZATION_CONFIG','Authorization policy cannot use symlinked paths');
  handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  const st=await handle.stat(),named=await fs.lstat(file);
  if(!st.isFile()||st.size<1||st.size>1048576||st.uid!==process.getuid?.()||(st.mode&0o022)!==0||st.dev!==named.dev||st.ino!==named.ino)fail('AUTHORIZATION_CONFIG','Bounded operator-owned policy without untrusted write permission required');
  bytes=await handle.readFile();const after=await handle.stat();
  if(after.size!==st.size||after.mtimeMs!==st.mtimeMs||after.ctimeMs!==st.ctimeMs)fail('AUTHORIZATION_CONFIG','Authorization policy changed during trusted load');
 }finally{await handle?.close();}
 const value=strictJSON(bytes);exact(value,['schema_version','rules']);if(value.schema_version!==1||!Array.isArray(value.rules)||!value.rules.length||value.rules.length>128)fail('AUTHORIZATION_CONFIG','Explicit versioned policy rules required');
 const result:Rule[]=[];for(const r of value.rules){exact(r,['role','actions','repositories','artifact_prefixes','git_refs','model_destinations','model_profiles']);if(typeof r.role!=='string'||!/^[A-Z_]{1,32}$/.test(r.role))fail('AUTHORIZATION_CONFIG','Invalid principal role');const rule:Rule={role:r.role,actions:list(r.actions),repositories:list(r.repositories),artifact_prefixes:list(r.artifact_prefixes),git_refs:list(r.git_refs),model_destinations:list(r.model_destinations),model_profiles:list(r.model_profiles)};
 if(rule.actions.some(x=>!NAME.test(x))||rule.repositories.some(x=>!uuid(x))||rule.git_refs.some(x=>!gitRef(x))||rule.artifact_prefixes.some(x=>x.startsWith('/')||x.includes('..')||x.includes('\\')||/[\x00-\x20]/.test(x)))fail('AUTHORIZATION_CONFIG','Invalid action/repository/artifact/Git scope');
 for(const endpoint of rule.model_destinations)canonicalOrigin(endpoint);result.push(frozen(rule));}return frozen(result);
}
export async function createComponent(ctx:ComponentContext):Promise<Component>{
 const policy=await rules(ctx),gateway=gatewayOf(ctx);
 const check=async(i:InvocationContext):Promise<void>=>{
  assertInvocation(i);const p=i.principal,b=i.payload;
  await gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:i.identityGuard},async()=>{});
  if(b.run_id!==p.run_id||!p.allowed_actions.includes(b.action)||!policy.some(r=>r.role===p.role&&r.actions.includes(b.action)))fail('AUTH_SCOPE_DENIED','Operation denied by trusted role/run/action policy');
  // Attempt policy: only an attempt-scoped principal may present attempt authority, and only its own current generation.
  if(p.attempt_id===null){if(b.authority!==null)fail('AUTH_SCOPE_DENIED','Principal holds no attempt authority');}
  else if(!b.authority||b.authority.attempt_id!==p.attempt_id||b.authority.attempt_generation!==p.attempt_generation||b.authority.sandbox_id!==p.sandbox_id||b.authority.boot_generation!==p.boot_generation||b.authority.deployment_epoch!==p.deployment_epoch)fail('AUTH_STALE_GENERATION','Attempt authority is not the principal\'s current generation');
  if(RUNNER_ORIGIN_ACTIONS.includes(b.action)&&(p.role!=='RUNNER'||p.sandbox_id===null||p.boot_generation===null))fail('AUTH_SCOPE_DENIED','Runner liveness requires a sandbox-bound runner principal');
  if(object(b.input)){
   if(Object.hasOwn(b.input,'organisation_id')&&b.input.organisation_id!==p.organisation_id||Object.hasOwn(b.input,'run_id')&&b.input.run_id!==p.run_id)fail('AUTH_SCOPE_DENIED','Payload cannot replace authenticated organisation/run scope');
   if(Object.hasOwn(b.input,'actor_id')&&b.input.actor_id!==p.actor_id&&!['OPERATOR','COORDINATOR','LEADER'].includes(p.role))fail('AUTH_SCOPE_DENIED','Payload cannot replace authenticated actor');
  }
 };
 const authorize=async(i:InvocationContext):Promise<void>=>{try{await check(i);}catch(error){audit(i,error);throw error;}};
 const resource:AuthorizationAuthority['resource']=async(i,input)=>{try{return await checkResource(i,input);}catch(error){audit(i,error,input);throw error;}};
 const checkResource=async(i:InvocationContext,input:unknown):Promise<Record<string,unknown>>=>{
  await check(i);
  if(object(input)&&Object.hasOwn(input,'access'))exact(input,[...RESOURCE_FIELDS,'access']);else exact(input,RESOURCE_FIELDS);
  const access=input.access??'READ';if(access!=='READ'&&access!=='WRITE')fail('INVALID_REQUEST','Explicit READ/WRITE access required');if(typeof input.kind!=='string'||typeof input.target!=='string'||input.repository_id!==null&&!uuid(input.repository_id)||input.profile_id!==null&&typeof input.profile_id!=='string')fail('INVALID_REQUEST','Explicit resource scope required');
  const permitted=policy.filter(r=>r.role===i.principal.role&&r.actions.includes(i.payload.action));
  if(input.kind==='artifact'){
   const prefix='hyperfide/v1/'+i.principal.organisation_id+'/'+i.principal.run_id+'/';
   if(!input.target.startsWith(prefix)||input.target.includes('..')||/[\x00-\x20\x7f%?#\\]/.test(input.target)||!permitted.some(r=>r.artifact_prefixes.some(x=>input.target===x||(input.target as string).startsWith(x.endsWith('/')?x:x+'/'))))fail('AUTH_SCOPE_DENIED','Artifact namespace denied');
   // Writes are compare-and-swap only: the signed envelope must carry the expected version, never a blind overwrite.
   if(access==='WRITE'&&!decimal(i.payload.expected_version))fail('AUTH_STALE_WRITE','Artifact writes require the signed expected version');
   if(access==='WRITE'&&i.principal.attempt_id!==null)await gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:i.guard},async tx=>{
    const a=(await tx.query('SELECT generation FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND compute_authority=\'CURRENT\' FOR SHARE',[i.principal.organisation_id,i.principal.run_id,i.principal.attempt_id])).rows[0];
    if(!a||String(a.generation)!==i.principal.attempt_generation)fail('AUTH_STALE_GENERATION','Superseded attempt generation cannot write artifacts');
    await i.guard(tx);
   });
  }else if(input.kind==='git'||input.kind==='git_credential'){
   if(access!=='READ'&&input.kind==='git_credential')fail('INVALID_REQUEST','Credential access is read-only');
   if(input.kind==='git_credential'&&(!PUBLISHERS.includes(i.principal.role)||i.principal.sandbox_id!==null||i.principal.attempt_id!==null))fail('AUTH_SCOPE_DENIED','Protected Git credentials are unavailable to worker scope');
   if(typeof input.repository_id!=='string'||!gitRef(input.target)||!permitted.some(r=>r.repositories.includes(input.repository_id as string)&&r.git_refs.includes(input.target as string)))fail('AUTH_SCOPE_DENIED','Repository/ref policy denied');
   await gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:i.guard},async tx=>{
    const binding=(await tx.query('SELECT integration_ref FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 FOR SHARE',[i.principal.organisation_id,i.principal.run_id,input.repository_id])).rows[0];
    if(!binding)fail('AUTH_SCOPE_DENIED','Repository is not bound to the accepted run');
    if(input.target===binding.integration_ref&&!PUBLISHERS.includes(i.principal.role))fail('AUTH_SCOPE_DENIED','Protected integration ref requires a dedicated publication principal');
    if(input.kind==='git_credential'&&input.target!==binding.integration_ref)fail('AUTH_SCOPE_DENIED','Protected Git credentials exist only for the run integration ref');
    await i.guard(tx);
   });
  }else if(input.kind==='model'){
   const destination=canonicalOrigin(input.target);
   if(typeof input.profile_id!=='string'||!permitted.some(r=>r.model_destinations.includes(destination)&&r.model_profiles.includes(input.profile_id as string)))fail('AUTH_SCOPE_DENIED','Model egress destination/profile denied');
  }else fail('AUTH_SCOPE_DENIED','Unknown resource class denied');
  if(input.kind==='git_credential')return {allowed:true,kind:input.kind,authority:'POLICY_ONLY',publication_authorized:false,credential_scope:'CONTROL_PLANE_ONLY',credential_material:'WITHHELD'};
  return {allowed:true,kind:input.kind,access,authority:'POLICY_ONLY',publication_authorized:false};
 };
 const authority:AuthorizationAuthority=Object.freeze({authorize,resource});
 return {apiVersion:1,capabilities:{'identity.authorization':authority},actions:{
  'authorization.resource.check':async(v,context)=>resource(invocationOf(context),v),
  'authorization.inspect':async(v,context)=>{exact(v,[]);const i=invocationOf(context);await authorize(i);return {principal:i.principal,allowed_rules:policy.filter(r=>r.role===i.principal.role),authority:'POLICY_ONLY'};}
 }};
}
