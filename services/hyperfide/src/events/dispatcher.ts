import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {constants} from 'node:fs';
import {createPrivateKey,randomUUID,sign} from 'node:crypto';
import type {ComponentContext} from '../components/registry.js';
import {canonicalOrigin,strictJSON,signingBytes,hash,MAX_BODY_BYTES} from '../transport/protocol.js';
import {isIdentityAuthority} from '../identity/enrollment.js';
import {fields,scope,uuid,name,bounded,integer,event,fail} from './outbox.js';

interface Route {aggregate_type:string;event_type:string;component:string;action:string;input_mode:'DELIVERY'|'CLAIM'}
interface WorkerConfig {organisation_id:string;run_id:string;credential_id:string;key_file:string;ca_file:string;
 control_origin:string;consumer_ids:string[];routes:Route[];poll_ms:number;retry_ms:number;lease_ms:number;batch_size:number;request_timeout_ms:number;credential_ttl_seconds:number;credential_renewal_ms:number}
export interface ContinuousDispatch {describe():Readonly<Record<string,unknown>>;close():Promise<void>}
async function readOwned(file:string,secret:boolean,max:number):Promise<Buffer> {
 if(!path.isAbsolute(file)||file.includes('\0'))fail('DISPATCH_CONFIG_INVALID','Absolute trusted worker files required');
 let handle:Awaited<ReturnType<typeof fs.open>>|undefined;
 try {
  if(await fs.realpath(file)!==path.resolve(file))fail('DISPATCH_CONFIG_INVALID','Worker files cannot use symlinks');
  handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=await handle.stat(),named=await fs.lstat(file);
  if(!stat.isFile()||stat.uid!==process.getuid?.()||stat.ino!==named.ino||stat.dev!==named.dev||stat.size<1||stat.size>max||
     secret&&(stat.mode&0o777)!==0o600||!secret&&(stat.mode&0o022)!==0)
   fail('DISPATCH_CONFIG_INVALID','Bounded operator-owned worker files required');
  return await handle.readFile();
 }finally {await handle?.close();}
}
function configuration(value:unknown):WorkerConfig {
 const v=fields(value,['organisation_id','run_id','credential_id','key_file','ca_file','control_origin','consumer_ids','routes',
  'poll_ms','retry_ms','lease_ms','batch_size','request_timeout_ms','credential_ttl_seconds','credential_renewal_ms']);
 const s=scope(v);
 if(typeof v.key_file!=='string'||typeof v.ca_file!=='string'||typeof v.control_origin!=='string'||
  !Array.isArray(v.consumer_ids)||!v.consumer_ids.length||v.consumer_ids.length>256||
  !Array.isArray(v.routes)||!v.routes.length||v.routes.length>64)fail('DISPATCH_CONFIG_INVALID','Bounded explicit subscriptions and handlers required');
 const consumers=v.consumer_ids.map(uuid);
 if(new Set(consumers).size!==consumers.length)fail('DISPATCH_CONFIG_INVALID','Duplicate standing consumer');
 const routes=v.routes.map(raw=>{
  const r=fields(raw,['aggregate_type','event_type','component','action','input_mode']);
  if(!['DELIVERY','CLAIM'].includes(String(r.input_mode)))fail('DISPATCH_CONFIG_INVALID','Explicit handler input contract required');
  return {aggregate_type:name(r.aggregate_type),event_type:name(r.event_type),component:name(r.component),action:name(r.action),
   input_mode:r.input_mode as 'DELIVERY'|'CLAIM'};
 });
 if(new Set(routes.map(r=>r.aggregate_type+'\n'+r.event_type)).size!==routes.length)fail('DISPATCH_CONFIG_INVALID','Duplicate fixed delivery route');
 return {...s,credential_id:uuid(v.credential_id),key_file:v.key_file,ca_file:v.ca_file,
  control_origin:canonicalOrigin(v.control_origin),consumer_ids:consumers,routes,poll_ms:bounded(v.poll_ms,10,60000),
  retry_ms:bounded(v.retry_ms,10,3600000),lease_ms:bounded(v.lease_ms,100,300000),batch_size:bounded(v.batch_size,1,4),
  request_timeout_ms:bounded(v.request_timeout_ms,100,120000),credential_ttl_seconds:bounded(v.credential_ttl_seconds,60,86400),
  credential_renewal_ms:bounded(v.credential_renewal_ms,100,Math.min(3600000,bounded(v.credential_ttl_seconds,60,86400)*500))};
}
/** A standing service signs new requests; only the receiving14 server creates an invocation or grants authority. */
export async function startContinuousDispatch(context:ComponentContext):Promise<ContinuousDispatch|undefined> {
 if(context.role!=='dispatch')return undefined;
 const filename=context.env.HF_EVENT_DISPATCH_CONFIG;
 if(!filename)fail('DISPATCH_CONFIG_REQUIRED','Dispatch service requires its protected standing-worker configuration');
 const config=configuration(strictJSON(await readOwned(filename,true,65536)));
 const identity=context.dependencies.require('14.1','identity.transport',isIdentityAuthority),origin=canonicalOrigin(identity.origin);
 const [ca,keyBytes]=await Promise.all([readOwned(config.ca_file,false,65536),readOwned(config.key_file,true,4096)]);
 let key:ReturnType<typeof createPrivateKey>;
 try {key=createPrivateKey(keyBytes);}finally {keyBytes.fill(0);}
 if(key.asymmetricKeyType!=='ed25519')fail('DISPATCH_CONFIG_INVALID','Standing worker requires its DISPATCH Ed25519 key');
 const required=['identity.describe','identity.principal.renew','outbox.claim','outbox.acknowledge','outbox.retry',...config.routes.map(r=>r.action)];
 if(required.some(action=>!context.policy.allowed_actions.includes(action)))fail('DISPATCH_CONFIG_INVALID','Worker actions must be explicitly approved by the run policy');
 const stop=new AbortController(),signal=AbortSignal.any([context.signal,stop.signal]);
 let closed=false,timer:ReturnType<typeof setTimeout>|undefined,wake:(()=>void)|undefined;
 const status={state:'STARTING',passes:0,claimed:0,acknowledged:0,unconfirmed_attempts:0,last_error:null as string|null};
 const call=async(target:string,component:string,action:string,input:unknown,remaining?:number,operationId?:string):Promise<unknown>=>{
  if(signal.aborted)throw Error('DISPATCH_STOPPED');
  const id=operationId??randomUUID(),payload=Buffer.from(JSON.stringify({run_id:config.run_id,component,action,input,expected_version:null,authority:null}));
  const body=Buffer.from(JSON.stringify({protocol_version:1,operation_id:id,idempotency_key:id,payload_digest:hash(payload),
   correlation_id:id,causation_id:null,payload_b64:payload.toString('base64url')}));
  if(body.length>MAX_BODY_BYTES)fail('DISPATCH_REQUEST_INVALID','Worker request exceeds protocol limit');
  const proof={id:config.credential_id,time:String(Math.floor(Date.now()/1000)),nonce:randomUUID()};
  const signature=sign(null,signingBytes(target,'/v1/invoke',proof,body),key).toString('base64url');
  const timeout=Math.max(1,Math.min(config.request_timeout_ms,remaining??config.request_timeout_ms));
  return await new Promise((resolve,reject)=>{
   let done=false;
   const finish=(error:Error|null,value?:unknown):void=>{if(done)return;done=true;if(error)reject(error);else resolve(value);};
   const request=https.request(new URL('/v1/invoke',target),{method:'POST',ca,rejectUnauthorized:true,minVersion:'TLSv1.3',agent:false,
    signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)]),headers:{'Content-Type':'application/json','Content-Length':body.length,
     'HF-Credential-Id':proof.id,'HF-Request-Time':proof.time,'HF-Request-Nonce':proof.nonce,'HF-Request-Signature':signature}},response=>{
    const parts:Buffer[]=[];let size=0;
    if(response.headers['content-encoding']!==undefined||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers['content-type']??'')||
      (response.statusCode??0)>=300&&(response.statusCode??0)<400){response.destroy();finish(Error('DISPATCH_RESPONSE_UNKNOWN'));return;}
    response.on('data',(part:Buffer)=>{if(done)return;size+=part.length;if(size>MAX_BODY_BYTES){response.destroy();finish(Error('DISPATCH_RESPONSE_UNKNOWN'));}else parts.push(part);});
    response.once('aborted',()=>finish(Error('DISPATCH_RESPONSE_UNKNOWN')));response.once('error',()=>finish(Error('DISPATCH_RESPONSE_UNKNOWN')));
    response.once('end',()=>{
     try {
      const result=strictJSON(Buffer.concat(parts));
      if(!result||typeof result!=='object'||Array.isArray(result))throw Error('DISPATCH_RESPONSE_UNKNOWN');
      const r=result as Record<string,unknown>;
      if(response.statusCode!==200||r.protocol_version!==1||r.operation_id!==id||r.id!==id||r.ok!==true||!Object.hasOwn(r,'result'))
       throw Error('DISPATCH_RESPONSE_UNCONFIRMED');
      finish(null,r.result);
     }catch {finish(Error('DISPATCH_RESPONSE_UNKNOWN'));}
    });
   });
   request.once('error',()=>finish(Error('DISPATCH_TRANSPORT_UNKNOWN')));request.end(body);
  });
 };
 let verified=false,lastRenewal=-Infinity,renewalId=randomUUID();
 const maintainIdentity=async():Promise<void>=>{
  if(!verified){
   const response=await call(origin,'14.1','identity.describe',{});
   if(!response||typeof response!=='object'||!('principal' in response))throw Error('DISPATCH_IDENTITY_REQUIRED');
   const principal=(response as {principal:Record<string,unknown>}).principal,allowed=principal.allowed_actions;
   if(principal.role!=='DISPATCH'||principal.credential_id!==config.credential_id||principal.organisation_id!==config.organisation_id||principal.run_id!==config.run_id||
    !Array.isArray(allowed)||required.some(action=>!allowed.includes(action)))throw Error('DISPATCH_IDENTITY_REQUIRED');
   verified=true;
  }
  if(performance.now()-lastRenewal>=config.credential_renewal_ms){
   const result=await call(origin,'14.1','identity.principal.renew',{ttl_seconds:config.credential_ttl_seconds},undefined,renewalId);
   if(!result||typeof result!=='object'||!('compute_lease_renewed' in result)||result.compute_lease_renewed!==false)throw Error('DISPATCH_RENEWAL_UNCONFIRMED');
   lastRenewal=performance.now();renewalId=randomUUID();
  }
 };
 const pass=async():Promise<void>=>{
  await maintainIdentity();
  for(const consumer of config.consumer_ids) {
   if(signal.aborted)return;
   const s={organisation_id:config.organisation_id,run_id:config.run_id};
   const raw=await call(origin,'6.1','outbox.claim',{...s,consumer_id:consumer,limit:config.batch_size,lease_ms:config.lease_ms});
   if(!Array.isArray(raw)||raw.length>config.batch_size)throw Error('DISPATCH_CLAIM_INVALID');
   for(const item of raw) {
    const c=fields(item,['organisation_id','run_id','id','aggregate_type','aggregate_id','aggregate_version','event_type','payload',
     'consumer_id','attempt_count','lease_expires_at']);
    const e=event({organisation_id:c.organisation_id,run_id:c.run_id,id:c.id,aggregate_type:c.aggregate_type,aggregate_id:c.aggregate_id,
     aggregate_version:c.aggregate_version,event_type:c.event_type,payload:c.payload});
    if(e.organisation_id!==s.organisation_id||e.run_id!==s.run_id||uuid(c.consumer_id)!==consumer||
     typeof c.lease_expires_at!=='string'||!Number.isFinite(Date.parse(c.lease_expires_at)))throw Error('DISPATCH_CLAIM_INVALID');
    const claim={...s,event_id:e.id,consumer_id:consumer,attempt_count:integer(c.attempt_count)};
    status.claimed++;
    try {
     const route=config.routes.find(r=>r.aggregate_type===e.aggregate_type&&r.event_type===e.event_type);
     if(!route)throw Error('DISPATCH_HANDLER_UNREGISTERED');
     const remaining=Date.parse(c.lease_expires_at)-Date.now();
     if(remaining<=0)throw Error('DISPATCH_CLAIM_EXPIRED');
     const input=route.input_mode==='DELIVERY'?{...s,event_id:e.id,consumer_id:consumer}:{event_id:e.id,attempt_count:claim.attempt_count};
     const result=await call(config.control_origin,route.component,route.action,input,remaining);
     if(!result||typeof result!=='object'||Array.isArray(result)||!('inbox_id' in result))throw Error('DISPATCH_RECEIPT_REQUIRED');
     await call(origin,'6.1','outbox.acknowledge',{...claim,inbox_id:uuid((result as Record<string,unknown>).inbox_id)});
     status.acknowledged++;
    }catch {
     status.unconfirmed_attempts++;
     if(!signal.aborted)try {await call(origin,'6.1','outbox.retry',{...claim,delay_ms:config.retry_ms,error:'DELIVERY_OUTCOME_UNCONFIRMED'});}catch {/* Same durable obligation remains recoverable. */}
    }
   }
  }
 };
 const loop=(async()=>{
  while(!signal.aborted) {
   try {await pass();status.passes++;status.state='RUNNING';status.last_error=null;}
   catch {status.state='RETRYING';status.last_error='DISPATCH_PASS_UNCONFIRMED';}
   if(signal.aborted)break;
   await new Promise<void>(resolve=>{
    const finish=():void=>{if(timer)clearTimeout(timer);signal.removeEventListener('abort',finish);wake=undefined;resolve();};
    wake=finish;timer=setTimeout(finish,config.poll_ms);signal.addEventListener('abort',finish,{once:true});if(signal.aborted)finish();
   });
  }
  status.state='STOPPED';
 })();
 return Object.freeze({describe:()=>Object.freeze({...status,consumer_count:config.consumer_ids.length,route_count:config.routes.length,
  transport:'signed-HTTPS',task_completion_authority:false}),close:async()=>{if(closed)return;closed=true;stop.abort();wake?.();await loop;}});
}
