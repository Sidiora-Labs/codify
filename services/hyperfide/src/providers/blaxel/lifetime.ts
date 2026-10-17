import type {Component,ComponentContext} from '../../components/registry.js';
import {FoundationError} from '../../policy/programme.js';
import {configuredBlaxelSDK} from './images.js';

type Obj=Record<string,unknown>;
export interface BlaxelLifetimePolicy {
 schema_version:1;run_seconds:number;checkpoint_lead_seconds:number;termination_grace_seconds:number;
 api_wait_seconds:number;process:{keep_alive:true;timeout_seconds:0};
 expiration_policies:Array<{type:'ttl-idle'|'ttl-max-age'|'date';value:string;action:'delete'}>;
 runtime_ttl:string|null;runtime_expires_at:string|null;
}
export interface LifetimeObservation {
 created_at:string;observed_at:string;last_resume_or_suspend_at:string|null;
 expires_in_seconds:number|null;account_max_age_seconds:number|null;account_limits_qualified:boolean;
 process:{keep_alive:boolean;timeout_seconds:number|null;started_at:string;state:'RUNNING'|'EXITED'|'UNKNOWN'};
}
function fail(message:string):never{throw new FoundationError('BLAXEL_LIFETIME_INVALID',message);}
function shape(v:unknown,keys:string[]):Obj{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('Expected lifetime object');
 const o=v as Obj;if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))fail('Unknown or missing lifetime field');return o;
}
function integer(v:unknown,min=0,max=315360000):number{
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)fail('Invalid lifetime integer');return v;
}
function instant(v:unknown):number{
 if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)fail('Canonical UTC instant required');return Date.parse(v);
}
export function durationSeconds(v:unknown):number{
 if(typeof v!=='string')fail('Pinned duration string required');
 const match=v.match(/^([1-9][0-9]{0,9})(s|m|h|d|w)$/);
 if(!match)fail('Unsupported duration unit');
 const multiplier={s:1,m:60,h:3600,d:86400,w:604800}[match[2] as 's'|'m'|'h'|'d'|'w'];
 return integer(Number(match[1])*multiplier,1);
}
export function validateBlaxelLifetimePolicy(value:unknown):BlaxelLifetimePolicy{
 const o=shape(value,['schema_version','run_seconds','checkpoint_lead_seconds','termination_grace_seconds','api_wait_seconds','process','expiration_policies','runtime_ttl','runtime_expires_at']);
 if(o.schema_version!==1)fail('Unsupported lifetime schema');
 const process=shape(o.process,['keep_alive','timeout_seconds']);
 if(process.keep_alive!==true||process.timeout_seconds!==0)fail('Nonstop supervisors require explicit keepAlive true and timeout zero');
 if(!Array.isArray(o.expiration_policies)||o.expiration_policies.length>16)fail('Bounded explicit expiration policies required');
 const policies=o.expiration_policies.map(v=>{
  const p=shape(v,['type','value','action']);
  if(!['ttl-idle','ttl-max-age','date'].includes(p.type as string)||p.action!=='delete'||typeof p.value!=='string')fail('Unsupported expiration policy');
  if(p.type==='date')instant(p.value);
  else if(durationSeconds(p.value)<(p.type==='ttl-idle'?60:300))fail('Expiration below documented provider minimum');
  return p as unknown as BlaxelLifetimePolicy['expiration_policies'][number];
 });
 if(new Set(policies.map(p=>p.type)).size!==policies.length)fail('Duplicate expiration mechanism');
 if(o.runtime_ttl!==null&&durationSeconds(o.runtime_ttl)<300)fail('Runtime max age below documented minimum');
 if(o.runtime_expires_at!==null)instant(o.runtime_expires_at);
 return{schema_version:1,run_seconds:integer(o.run_seconds,1),checkpoint_lead_seconds:integer(o.checkpoint_lead_seconds,1),
  termination_grace_seconds:integer(o.termination_grace_seconds,0,3600),api_wait_seconds:integer(o.api_wait_seconds,1,60),
  process:{keep_alive:true,timeout_seconds:0},expiration_policies:policies,runtime_ttl:o.runtime_ttl as string|null,
  runtime_expires_at:o.runtime_expires_at as string|null};
}
export function blaxelProcessLifetimeOptions(policy:BlaxelLifetimePolicy):{keepAlive:true;timeout:0;waitForCompletion:false;restartOnFailure:false;maxRestarts:0}{
 validateBlaxelLifetimePolicy(policy);
 // API wait deadlines belong to separate observation requests. They do not own the process.
 return{keepAlive:true,timeout:0,waitForCompletion:false,restartOnFailure:false,maxRestarts:0};
}
export function blaxelSandboxLifetimeOptions(policy:BlaxelLifetimePolicy):{
 lifecycle:{expirationPolicies:BlaxelLifetimePolicy['expiration_policies']};
 runtime:{terminationGracePeriodSeconds:number;ttl?:string;expires?:string};
}{
 validateBlaxelLifetimePolicy(policy);
 return{lifecycle:{expirationPolicies:policy.expiration_policies},runtime:{terminationGracePeriodSeconds:policy.termination_grace_seconds,
  ...(policy.runtime_ttl===null?{}:{ttl:policy.runtime_ttl}),...(policy.runtime_expires_at===null?{}:{expires:policy.runtime_expires_at})}};
}
function observation(v:unknown):LifetimeObservation{
 const o=shape(v,['created_at','observed_at','last_resume_or_suspend_at','expires_in_seconds','account_max_age_seconds','account_limits_qualified','process']);
 instant(o.created_at);instant(o.observed_at);if(o.last_resume_or_suspend_at!==null)instant(o.last_resume_or_suspend_at);
 if(o.expires_in_seconds!==null)integer(o.expires_in_seconds);
 if(o.account_max_age_seconds!==null)integer(o.account_max_age_seconds,1);
 if(typeof o.account_limits_qualified!=='boolean')fail('Account capability qualification required');
 const p=shape(o.process,['keep_alive','timeout_seconds','started_at','state']);if(typeof p.keep_alive!=='boolean'||!['RUNNING','EXITED','UNKNOWN'].includes(p.state as string))fail('Invalid observed process');
 if(p.timeout_seconds!==null)integer(p.timeout_seconds);instant(p.started_at);
 return o as unknown as LifetimeObservation;
}
export function assessBlaxelLifetime(value:unknown):unknown{
 const o=shape(value,['policy','observation','evaluated_at']),p=validateBlaxelLifetimePolicy(o.policy),obs=observation(o.observation),now=instant(o.evaluated_at);
 const created=instant(obs.created_at),observed=instant(obs.observed_at),started=instant(obs.process.started_at),reasons:string[]=[],deadlines:Array<{mechanism:string;at:string}>=[];
 if(created>observed||observed>now||started<created||started>observed)fail('Observation times are inconsistent');
 const add=(mechanism:string,at:number)=>deadlines.push({mechanism,at:new Date(at).toISOString()});
 if(!obs.account_limits_qualified)reasons.push('ACCOUNT_LIFETIME_UNQUALIFIED');
 if(obs.account_max_age_seconds!==null)add('account-max-age',created+obs.account_max_age_seconds*1000);
 if(obs.expires_in_seconds!==null)add('observed-provider-expiry',observed+obs.expires_in_seconds*1000);
 if(p.runtime_ttl!==null)add('runtime-max-age',created+durationSeconds(p.runtime_ttl)*1000);
 if(p.runtime_expires_at!==null)add('runtime-date',instant(p.runtime_expires_at));
 for(const rule of p.expiration_policies){
  if(rule.type==='date')add('policy-date',instant(rule.value));
  else if(rule.type==='ttl-max-age')add('policy-max-age',created+durationSeconds(rule.value)*1000);
  else if(obs.last_resume_or_suspend_at===null)reasons.push('IDLE_EXPIRATION_ANCHOR_UNKNOWN');
  else{const at=instant(obs.last_resume_or_suspend_at);if(at<created||at>observed)fail('Invalid idle expiration transition');add('policy-ttl-idle',at+durationSeconds(rule.value)*1000);}
 }
 if(!obs.process.keep_alive)reasons.push('PROCESS_MAY_STANDBY');
 if(obs.process.timeout_seconds===null)reasons.push('PROCESS_DEFAULT_600_SECOND_KILL');
 else if(obs.process.timeout_seconds!==0&&started+obs.process.timeout_seconds*1000<started+(p.run_seconds+p.checkpoint_lead_seconds+p.termination_grace_seconds)*1000)reasons.push('PROCESS_EXECUTION_DEADLINE_TOO_SHORT');
 if(obs.process.state!=='RUNNING')reasons.push('PROCESS_NOT_OBSERVED_RUNNING');
 const requiredUntil=started+(p.run_seconds+p.checkpoint_lead_seconds+p.termination_grace_seconds)*1000;
 if(requiredUntil<=now)reasons.push('RUN_HORIZON_EXPIRED');
 if(now-observed>60000)reasons.push('STALE_LIFETIME_OBSERVATION');
 if(deadlines.some(d=>instant(d.at)<requiredUntil))reasons.push('SANDBOX_DELETION_BEFORE_SAFE_RUN_END');
 const nearest=deadlines.length?Math.min(...deadlines.map(d=>instant(d.at))):null;
 return{candidate_compatible:reasons.length===0,reasons:[...new Set(reasons)],deletion_deadlines:deadlines,
  required_until:new Date(requiredUntil).toISOString(),checkpoint_due_at:nearest===null?null:new Date(nearest-(p.checkpoint_lead_seconds+p.termination_grace_seconds)*1000).toISOString(),
  process_options:blaxelProcessLifetimeOptions(p),sandbox_options:blaxelSandboxLifetimeOptions(p),authority:'NONE',live_qualification:'NOT_EVALUATED'};
}
export async function boundedBlaxelRead<T>(read:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal,deadline:number):Promise<T>{
 const unavailable=()=>new FoundationError('BLAXEL_LIFETIME_UNAVAILABLE','Provider lifetime read did not complete within its trusted deadline');
 if(signal.aborted||!Number.isSafeInteger(deadline)||deadline<=Date.now())throw unavailable();
 const controller=new AbortController();let rejectAbort:(reason:Error)=>void=()=>{};
 const cancelled=new Promise<never>((_resolve,reject)=>{rejectAbort=reject;});
 const abort=()=>{controller.abort();rejectAbort(unavailable());};
 signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,Math.min(15000,Math.max(1,deadline-Date.now())));
 if(signal.aborted)abort();
 try{
  return await Promise.race([cancelled,Promise.resolve().then(()=>{
   if(controller.signal.aborted)throw unavailable();
   return read(controller.signal);
  })]);
 }catch{throw unavailable();}
 finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
}
export async function observeBlaxelLifetime(value:unknown,ctx:ComponentContext):Promise<unknown>{
 const o=shape(value,['sandbox_reference','process_reference']);
 if(typeof o.sandbox_reference!=='string'||!o.sandbox_reference.length||o.sandbox_reference.length>128||
   typeof o.process_reference!=='string'||!o.process_reference.length||o.process_reference.length>128)fail('Bounded native identities required');
 const deadline=Date.now()+15000,sdk=await configuredBlaxelSDK(ctx),sandbox=await boundedBlaxelRead(()=>sdk.SandboxInstance.get(o.sandbox_reference as string),ctx.signal,deadline);
 if(ctx.signal.aborted)fail('Observation cancelled');
 const actual=sandbox as unknown as {metadata:unknown;spec:unknown;expiresIn:unknown;lastUsedAt:unknown;process:{get(id:string,options:{signal:AbortSignal;retry:boolean}):Promise<unknown>}};
 if(typeof actual.process.get!=='function')fail('Pinned SDK observation API unavailable');
 const raw=await boundedBlaxelRead(signal=>actual.process.get(o.process_reference as string,{signal,retry:false}),ctx.signal,deadline);
 const metadata=actual.metadata as Obj, spec=actual.spec as Obj, runtime=(spec?.runtime??{}) as Obj, lifecycle=(spec?.lifecycle??{}) as Obj;
 const process=raw as Obj;
 // Never return raw runtime variables, commands or process logs across this API.
 return{observed_at:new Date().toISOString(),sandbox_reference:o.sandbox_reference,process_reference:o.process_reference,
  provider_lifetime:{created_at:metadata?.createdAt??null,runtime_ttl:runtime.ttl??null,
   runtime_expires_at:runtime.expires??null,expiration_policies:lifecycle.expirationPolicies??null,
   termination_grace_seconds:runtime.terminationGracePeriodSeconds??null,expires_in_seconds:actual.expiresIn??null,
   last_provider_used_at:actual.lastUsedAt??null},
  process:{native_process_id:process?.pid??null,state:process?.status??'unknown',keep_alive:process?.keepAlive??null,
   started_at:process?.startedAt??null,completed_at:process?.completedAt??null,
   exit_code:process?.status==='running'?null:process?.exitCode??null,timeout_seconds:null},
  account_limits_qualified:false,authority:'NONE',live_qualification:'NOT_EVALUATED'};
}
export function createComponent(_ctx:ComponentContext):Component{return{apiVersion:1,actions:{
 'blaxel.lifetime.describe':input=>{shape(input,[]);return{schema_version:1,provider_process_timeout_unit:'seconds',maximum_api_wait_seconds:60,
  standby_is_deletion:false,activity_resets_ttl_idle:false,default_keep_alive_timeout_seconds:600,authority:'NONE'};},
 'blaxel.lifetime.plan':input=>{const p=validateBlaxelLifetimePolicy(input);return{policy:p,process_options:blaxelProcessLifetimeOptions(p),sandbox_options:blaxelSandboxLifetimeOptions(p),authority:'NONE',live_qualification:'NOT_EVALUATED'};},
 'blaxel.lifetime.assess':assessBlaxelLifetime,'blaxel.lifetime.observe':observeBlaxelLifetime
}};}
