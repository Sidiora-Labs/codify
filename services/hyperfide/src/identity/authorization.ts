import fs from 'node:fs/promises';
import type {Component,ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {assertInvocation,canonicalOrigin,exact,fail,frozen,NAME,strictJSON,uuid} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {gatewayOf,invocationOf} from './enrollment.js';
interface Rule {role:string;actions:string[];repositories:string[];artifact_prefixes:string[];git_refs:string[];model_destinations:string[];model_profiles:string[]}
export interface AuthorizationAuthority {authorize(i:InvocationContext):Promise<void>;resource(i:InvocationContext,input:unknown):Promise<unknown>}
export function isAuthorizationAuthority(v:unknown):v is AuthorizationAuthority{return object(v)&&typeof v.authorize==='function'&&typeof v.resource==='function';}
function list(v:unknown):string[]{if(!Array.isArray(v)||v.length>256||v.some(x=>typeof x!=='string'||!x.length||x.length>1024)||new Set(v).size!==v.length)fail('AUTHORIZATION_CONFIG','Explicit bounded unique policy lists required');return v as string[];}
function gitRef(v:string):boolean{return v.startsWith('refs/')&&!/[\x00-\x20\x7f~^:?*\\[]/.test(v)&&!v.includes('..')&&!v.includes('@{')&&!v.endsWith('/')&&!v.endsWith('.')&&!v.split('/').some(p=>!p||p.startsWith('.')||p.endsWith('.lock'));}
async function rules(ctx:ComponentContext):Promise<readonly Rule[]>{
 const file=ctx.env.HF_AUTHORIZATION_CONFIG_FILE;if(!file)fail('AUTHORIZATION_CONFIG','Trusted authorization policy file required');const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>1048576)fail('AUTHORIZATION_CONFIG','Bounded regular policy file required');const value=strictJSON(await fs.readFile(file));exact(value,['schema_version','rules']);if(value.schema_version!==1||!Array.isArray(value.rules)||!value.rules.length||value.rules.length>128)fail('AUTHORIZATION_CONFIG','Explicit versioned policy rules required');
 const result:Rule[]=[];for(const r of value.rules){exact(r,['role','actions','repositories','artifact_prefixes','git_refs','model_destinations','model_profiles']);if(typeof r.role!=='string'||!/^[A-Z_]{1,32}$/.test(r.role))fail('AUTHORIZATION_CONFIG','Invalid principal role');const rule:Rule={role:r.role,actions:list(r.actions),repositories:list(r.repositories),artifact_prefixes:list(r.artifact_prefixes),git_refs:list(r.git_refs),model_destinations:list(r.model_destinations),model_profiles:list(r.model_profiles)};
 if(rule.actions.some(x=>!NAME.test(x))||rule.repositories.some(x=>!uuid(x))||rule.git_refs.some(x=>!gitRef(x))||rule.artifact_prefixes.some(x=>x.startsWith('/')||x.includes('..')||x.includes('\\')||/[\x00-\x20]/.test(x)))fail('AUTHORIZATION_CONFIG','Invalid action/repository/artifact/Git scope');
 for(const endpoint of rule.model_destinations)canonicalOrigin(endpoint);result.push(frozen(rule));}return frozen(result);
}
export async function createComponent(ctx:ComponentContext):Promise<Component>{
 const policy=await rules(ctx),gateway=gatewayOf(ctx);
 const authorize=async(i:InvocationContext):Promise<void>=>{
  assertInvocation(i);const p=i.principal,b=i.payload;
  await gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:i.identityGuard},async()=>{});
  if(b.run_id!==p.run_id||!p.allowed_actions.includes(b.action)||!policy.some(r=>r.role===p.role&&r.actions.includes(b.action)))fail('AUTH_SCOPE_DENIED','Operation denied by trusted role/run/action policy');
  if(object(b.input)){
   if(Object.hasOwn(b.input,'organisation_id')&&b.input.organisation_id!==p.organisation_id||Object.hasOwn(b.input,'run_id')&&b.input.run_id!==p.run_id)fail('AUTH_SCOPE_DENIED','Payload cannot replace authenticated organisation/run scope');
   if(Object.hasOwn(b.input,'actor_id')&&b.input.actor_id!==p.actor_id&&!['OPERATOR','COORDINATOR','LEADER'].includes(p.role))fail('AUTH_SCOPE_DENIED','Payload cannot replace authenticated actor');
  }
 };
 const resource:AuthorizationAuthority['resource']=async(i,input)=>{
  await authorize(i);exact(input,['kind','repository_id','target','profile_id']);if(typeof input.kind!=='string'||typeof input.target!=='string'||input.repository_id!==null&&!uuid(input.repository_id)||input.profile_id!==null&&typeof input.profile_id!=='string')fail('INVALID_REQUEST','Explicit resource scope required');
  const permitted=policy.filter(r=>r.role===i.principal.role&&r.actions.includes(i.payload.action));
  if(input.kind==='artifact'){
   const prefix='hyperfide/v1/'+i.principal.organisation_id+'/'+i.principal.run_id+'/';
   if(!input.target.startsWith(prefix)||input.target.includes('..')||/[\x00-\x20\x7f%?#\\]/.test(input.target)||!permitted.some(r=>r.artifact_prefixes.some(x=>input.target===x||(input.target as string).startsWith(x.endsWith('/')?x:x+'/'))))fail('AUTH_SCOPE_DENIED','Artifact namespace denied');
  }else if(input.kind==='git'){
   if(typeof input.repository_id!=='string'||!gitRef(input.target)||!permitted.some(r=>r.repositories.includes(input.repository_id as string)&&r.git_refs.includes(input.target as string)))fail('AUTH_SCOPE_DENIED','Repository/ref policy denied');
   await gateway.withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:i.guard},async tx=>{
    const binding=(await tx.query('SELECT integration_ref FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 FOR SHARE',[i.principal.organisation_id,i.principal.run_id,input.repository_id])).rows[0];
    if(!binding)fail('AUTH_SCOPE_DENIED','Repository is not bound to the accepted run');
    if(input.target===binding.integration_ref&&!['INTEGRATOR','COORDINATOR','OPERATOR'].includes(i.principal.role))fail('AUTH_SCOPE_DENIED','Protected integration ref requires a dedicated publication principal');
    await i.guard(tx);
   });
  }else if(input.kind==='model'){
   const destination=canonicalOrigin(input.target);
   if(typeof input.profile_id!=='string'||!permitted.some(r=>r.model_destinations.includes(destination)&&r.model_profiles.includes(input.profile_id as string)))fail('AUTH_SCOPE_DENIED','Model egress destination/profile denied');
  }else fail('AUTH_SCOPE_DENIED','Unknown resource class denied');
  return {allowed:true,kind:input.kind,authority:'POLICY_ONLY',publication_authorized:false};
 };
 const authority:AuthorizationAuthority=Object.freeze({authorize,resource});
 return {apiVersion:1,capabilities:{'identity.authorization':authority},actions:{
  'authorization.resource.check':async(v,context)=>resource(invocationOf(context),v),
  'authorization.inspect':async(v,context)=>{exact(v,[]);const i=invocationOf(context);await authorize(i);return {principal:i.principal,allowed_rules:policy.filter(r=>r.role===i.principal.role),authority:'POLICY_ONLY'};}
 }};
}
