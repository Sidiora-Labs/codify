import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {FoundationError} from '../policy/programme.js';
import {canonicalOrigin,strictJSON,hash,base64,UUID,DIGEST} from './protocol.js';
import {assertVerifiedIsolationPermit} from '../identity/credentials.js';
import type {VerifiedIsolationPermit} from '../identity/credentials.js';

const LIMIT=128*1024;
export interface IsolationFenceReceipt {
 readonly deployment_id:string;readonly operation_id:string;readonly fence_id:string;
 readonly source_epoch:string|null;readonly isolated_writer:string;
 readonly observed_at:string;readonly expires_at:string;readonly evidence_digest:string;
}
export interface IsolationPermitVerifier {verifySigned(serialized:Buffer|string):VerifiedIsolationPermit}
export interface IsolationHttpTransportOptions {
 readonly origin:string;readonly host:string;readonly port:number;
 readonly certificate:string;readonly privateKey:string;readonly signal:AbortSignal;
 readonly verifier:IsolationPermitVerifier;
 readonly dispatch:(permit:VerifiedIsolationPermit,signal:AbortSignal)=>Promise<IsolationFenceReceipt>;
 readonly maxConcurrent?:number;readonly deadlineMs?:number;
}
export interface IsolationHttpTransport {readonly address:string;close():Promise<void>}
export type IsolationHttpResult=
 |{readonly outcome:'SUCCEEDED';readonly receipt:IsolationFenceReceipt}
 |{readonly outcome:'REJECTED';readonly code:string}
 |{readonly outcome:'UNKNOWN';readonly code:'ISOLATION_OUTCOME_UNKNOWN'};
export interface IsolationHttpClientOptions {
 readonly origin:string;readonly caFile:string;readonly deadlineMs?:number;readonly maxConcurrent?:number;
}
export interface IsolationHttpClient {isolate(permitEnvelope:string,signal:AbortSignal):Promise<IsolationHttpResult>}

function fail(code:string):never{throw new FoundationError(code,'Isolation transport refused the operation');}
function exact(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail('ISOLATION_REQUEST_INVALID');
}
function bounded(value:number|undefined,fallback:number,min:number,max:number):number{
 const result=value??fallback;if(!Number.isSafeInteger(result)||result<min||result>max)fail('ISOLATION_TRANSPORT_CONFIG');return result;
}
function utc(value:unknown):value is string{
 if(typeof value!=='string'||value.length!==24||!Number.isFinite(Date.parse(value)))return false;
 return new Date(value).toISOString()===value;
}
function plain(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\x00-\x1f\x7f]/.test(value);}
export function parseIsolationFenceReceipt(value:unknown):IsolationFenceReceipt{
 exact(value,['deployment_id','operation_id','fence_id','source_epoch','isolated_writer','observed_at','expires_at','evidence_digest']);
 const now=Date.now();
 if(typeof value.deployment_id!=='string'||!UUID.test(value.deployment_id)||typeof value.operation_id!=='string'||!UUID.test(value.operation_id)||
  value.source_epoch!==null&&(typeof value.source_epoch!=='string'||!UUID.test(value.source_epoch))||
  !plain(value.fence_id)||!plain(value.isolated_writer)||!utc(value.observed_at)||!utc(value.expires_at)||
  typeof value.evidence_digest!=='string'||!DIGEST.test(value.evidence_digest)||
  Date.parse(value.observed_at)>now+1000||Date.parse(value.expires_at)<=now||
  Date.parse(value.expires_at)<=Date.parse(value.observed_at)||Date.parse(value.expires_at)-Date.parse(value.observed_at)>30000)fail('ISOLATION_RECEIPT_INVALID');
 return Object.freeze({...value}) as unknown as IsolationFenceReceipt;
}
async function tlsFile(filename:string,secret:boolean):Promise<Buffer>{
 if(typeof filename!=='string'||!path.isAbsolute(filename)||filename.includes('\0'))fail('ISOLATION_TLS_CONFIG');
 let fd:Awaited<ReturnType<typeof fs.open>>|undefined;
 try{
  if(await fs.realpath(filename)!==path.resolve(filename))fail('ISOLATION_TLS_CONFIG');
  fd=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  const current=await fd.stat(),name=await fs.lstat(filename);
  if(!current.isFile()||name.isSymbolicLink()||current.ino!==name.ino||current.dev!==name.dev||
   current.size<1||current.size>65536||secret&&(current.mode&0o777)!==0o600)fail('ISOLATION_TLS_CONFIG');
  return await fd.readFile();
 }catch{return fail('ISOLATION_TLS_CONFIG');}finally{await fd?.close();}
}
function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=():void=>reject(new FoundationError('ISOLATION_OUTCOME_UNKNOWN','Isolation interrupted; reconcile original operation'));
  if(signal.aborted){void operation.catch(()=>{});abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort)).catch(()=>{});
 });
}
function errorCode(error:unknown):string{
 return error instanceof FoundationError&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)?error.code:'ISOLATION_REQUEST_INVALID';
}
function respond(res:ServerResponse,status:number,outcome:'SUCCEEDED'|'REJECTED'|'UNKNOWN',permitDigest:string|null,detail:unknown):void{
 if(res.destroyed||res.writableEnded)return;
 const value=outcome==='SUCCEEDED'?{schema_version:1,outcome,permit_digest:permitDigest,receipt:detail}:{schema_version:1,outcome,permit_digest:permitDigest,code:detail};
 const body=Buffer.from(JSON.stringify(value));
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});
 res.end(body);
}
function headers(req:IncomingMessage,origin:string):void{
 const seen=new Set<string>(),allowed=new Set(['host','content-type','content-length','connection','user-agent','accept']);
 for(let n=0;n<req.rawHeaders.length;n+=2){const key=req.rawHeaders[n]!.toLowerCase();if(seen.has(key)||!allowed.has(key))fail('ISOLATION_REQUEST_INVALID');seen.add(key);}
 if(req.headers.host!==new URL(origin).host||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||
  typeof req.headers['content-length']!=='string'||!/^(0|[1-9][0-9]{0,6})$/.test(req.headers['content-length']))fail('ISOLATION_REQUEST_INVALID');
 if(Number(req.headers['content-length'])>LIMIT)fail('ISOLATION_REQUEST_TOO_LARGE');
}

/** Separate permit-only listener. It cannot enrol, register or activate any authority. */
export async function startIsolationHttpTransport(options:IsolationHttpTransportOptions):Promise<IsolationHttpTransport>{
 const origin=canonicalOrigin(options.origin),max=bounded(options.maxConcurrent,8,1,32),deadline=bounded(options.deadlineMs,15000,100,120000);
 if(!options.host||options.host.includes('\0')||!Number.isSafeInteger(options.port)||options.port<1||options.port>65535||
  typeof options.verifier?.verifySigned!=='function'||typeof options.dispatch!=='function')fail('ISOLATION_TRANSPORT_CONFIG');
 const [cert,key]=await Promise.all([tlsFile(options.certificate,false),tlsFile(options.privateKey,true)]);
 if(options.signal.aborted){key.fill(0);fail('ISOLATION_SHUTTING_DOWN');}
 let accepting=true,active=0;
 const controllers=new Set<AbortController>(),requests=new Set<Promise<void>>(),dispatches=new Set<Promise<IsolationFenceReceipt>>();
 const server=https.createServer({cert,key,minVersion:'TLSv1.3',handshakeTimeout:5000,maxHeaderSize:8192,headersTimeout:5000,requestTimeout:5000,keepAliveTimeout:1000,rejectNonStandardBodyWrites:true},(req,res)=>{
  const pending=handle(req,res).finally(()=>requests.delete(pending));requests.add(pending);
 });
 key.fill(0);
 server.maxHeadersCount=12;server.maxConnections=max*4;server.maxRequestsPerSocket=1;
 server.on('tlsClientError',()=>{});server.on('clientError',(_error,socket)=>socket.destroy());
 async function handle(req:IncomingMessage,res:ServerResponse):Promise<void>{
  if(!accepting){respond(res,503,'REJECTED',null,'ISOLATION_SHUTTING_DOWN');req.resume();return;}
  if(active>=max){respond(res,429,'REJECTED',null,'ISOLATION_ADMISSION_BUSY');req.resume();return;}
  active++;let dispatched=false,ownsDispatch=false,permitDigest:string|null=null;
  const controller=new AbortController();controllers.add(controller);
  const abort=():void=>{controller.abort();req.destroy();};
  const disconnected=():void=>{if(!res.writableEnded)controller.abort();};
  options.signal.addEventListener('abort',abort,{once:true});req.once('aborted',abort);res.once('close',disconnected);
  const timer=setTimeout(()=>{respond(res,dispatched?504:408,dispatched?'UNKNOWN':'REJECTED',permitDigest,dispatched?'ISOLATION_OUTCOME_UNKNOWN':'ISOLATION_REQUEST_DEADLINE');abort();},deadline);
  try{
   if(req.method!=='POST'||req.url!=='/v1/isolation')fail('ISOLATION_ROUTE_INVALID');
   headers(req,origin);
   const parts:Buffer[]=[];let size=0;
   for await(const data of req){
    if(controller.signal.aborted)fail('ISOLATION_OUTCOME_UNKNOWN');
    const part=Buffer.isBuffer(data)?data:Buffer.from(data);size+=part.length;
    if(size>LIMIT)fail('ISOLATION_REQUEST_TOO_LARGE');parts.push(part);
   }
   if(size!==Number(req.headers['content-length']))fail('ISOLATION_REQUEST_INVALID');
   const body=strictJSON(Buffer.concat(parts),LIMIT);exact(body,['schema_version','permit_envelope']);
   if(body.schema_version!==1||typeof body.permit_envelope!=='string'||Buffer.byteLength(body.permit_envelope)<1||Buffer.byteLength(body.permit_envelope)>LIMIT)fail('ISOLATION_REQUEST_INVALID');
   permitDigest=hash(body.permit_envelope);
   if(controller.signal.aborted)fail('ISOLATION_OUTCOME_UNKNOWN');
   const permit=options.verifier.verifySigned(body.permit_envelope);
   assertVerifiedIsolationPermit(permit);
   if(permit.permit_digest!==permitDigest)fail('ISOLATION_PERMIT_BINDING');
   if(controller.signal.aborted)fail('ISOLATION_OUTCOME_UNKNOWN');
   dispatched=true;
   const operation=Promise.resolve().then(()=>{if(controller.signal.aborted)fail('ISOLATION_OUTCOME_UNKNOWN');return options.dispatch(permit,controller.signal);});
   // The HTTP deadline cannot release a still-running external effect's admission.
   ownsDispatch=true;dispatches.add(operation);
   const settled=():void=>{dispatches.delete(operation);controllers.delete(controller);active--;};
   void operation.then(settled,settled);
   const receipt=parseIsolationFenceReceipt(await abortable(operation,controller.signal));
   assertVerifiedIsolationPermit(permit);
   if(receipt.deployment_id!==permit.deployment_id||receipt.operation_id!==permit.operation_id||receipt.source_epoch!==permit.source_epoch)fail('ISOLATION_RECEIPT_BINDING');
   if(controller.signal.aborted)fail('ISOLATION_OUTCOME_UNKNOWN');
   respond(res,200,'SUCCEEDED',permitDigest,receipt);
  }catch(error){
   const unknown=dispatched||controller.signal.aborted;
   respond(res,unknown?504:errorCode(error).includes('TOO_LARGE')?413:400,unknown?'UNKNOWN':'REJECTED',permitDigest,unknown?'ISOLATION_OUTCOME_UNKNOWN':errorCode(error));
  }finally{
   clearTimeout(timer);if(!ownsDispatch){controllers.delete(controller);active--;}
   options.signal.removeEventListener('abort',abort);req.removeListener('aborted',abort);res.removeListener('close',disconnected);
  }
 }
 await new Promise<void>((resolve,reject)=>{
  const error=(value:Error):void=>{server.removeListener('listening',ready);reject(value);};
  const ready=():void=>{server.removeListener('error',error);resolve();};
  server.once('error',error);server.once('listening',ready);server.listen(options.port,options.host);
 });
 let closing:Promise<void>|undefined;
 const close=():Promise<void>=>closing??=(async()=>{
  accepting=false;for(const controller of controllers)controller.abort();
  const closed=new Promise<void>(resolve=>server.close(()=>resolve()));
  server.closeIdleConnections();
  const bound=Math.min(deadline,5000);
  const timeout=setTimeout(()=>server.closeAllConnections(),bound);
  let dispatchTimeout:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.allSettled([...requests]);await closed;
   await Promise.race([Promise.allSettled([...dispatches]),new Promise<void>(resolve=>{dispatchTimeout=setTimeout(resolve,bound);})]);
   if(dispatches.size)fail('ISOLATION_SHUTDOWN_INCOMPLETE');
  }finally{clearTimeout(timeout);if(dispatchTimeout)clearTimeout(dispatchTimeout);options.signal.removeEventListener('abort',onAbort);}
 })().catch(error=>{closing=undefined;throw error;});
 const onAbort=():void=>{void close().catch(()=>{});};
 options.signal.addEventListener('abort',onAbort,{once:true});
 if(options.signal.aborted){await close();fail('ISOLATION_SHUTTING_DOWN');}
 return Object.freeze({address:origin,close});
}

// Parsing pins a response to the requested operation; only the server's real
// verifier and configured fencing handler grant permission to perform isolation.
function requestedBindings(serialized:string):{deployment_id:string;operation_id:string;source_epoch:string|null}{
 const envelope=strictJSON(Buffer.from(serialized),LIMIT);exact(envelope,['schema_version','key_id','payload_b64','signature_b64']);
 const claims=strictJSON(base64(envelope.payload_b64),LIMIT);
 if(!claims||typeof claims!=='object'||Array.isArray(claims))fail('ISOLATION_REQUEST_INVALID');
 const v=claims as Record<string,unknown>;
 if(v.schema_version!==1||v.purpose!=='EXTERNAL_WRITER_ISOLATION_ONLY'||!plain(v.deployment_id)||typeof v.operation_id!=='string'||!UUID.test(v.operation_id)||v.source_epoch!==null&&(typeof v.source_epoch!=='string'||!UUID.test(v.source_epoch)))fail('ISOLATION_REQUEST_INVALID');
 return {deployment_id:v.deployment_id,operation_id:v.operation_id,source_epoch:v.source_epoch as string|null};
}
/** No redirects, dynamic URLs, bearer identity or PG fallback are accepted. */
export async function createIsolationHttpClient(options:IsolationHttpClientOptions):Promise<IsolationHttpClient>{
 const origin=canonicalOrigin(options.origin),deadline=bounded(options.deadlineMs,15000,100,120000),max=bounded(options.maxConcurrent,8,1,32);
 const ca=await tlsFile(options.caFile,false);let active=0;
 return Object.freeze({isolate:async(permitEnvelope:string,signal:AbortSignal):Promise<IsolationHttpResult>=>{
  if(signal.aborted)return {outcome:'REJECTED',code:'ISOLATION_CANCELLED_BEFORE_SEND'};
  if(typeof permitEnvelope!=='string'||!permitEnvelope.length||Buffer.byteLength(permitEnvelope)>LIMIT)return {outcome:'REJECTED',code:'ISOLATION_REQUEST_INVALID'};
  let binding:ReturnType<typeof requestedBindings>;
  try{binding=requestedBindings(permitEnvelope);}catch{return {outcome:'REJECTED',code:'ISOLATION_REQUEST_INVALID'};}
  const body=Buffer.from(JSON.stringify({schema_version:1,permit_envelope:permitEnvelope})),expected=hash(permitEnvelope);
  if(body.length>LIMIT)return {outcome:'REJECTED',code:'ISOLATION_REQUEST_TOO_LARGE'};
  if(active>=max)return {outcome:'REJECTED',code:'ISOLATION_ADMISSION_BUSY'};
  active++;
  return new Promise<IsolationHttpResult>(resolve=>{
   let settled=false;
   const unknown=():IsolationHttpResult=>({outcome:'UNKNOWN',code:'ISOLATION_OUTCOME_UNKNOWN'});
   const finish=(value:IsolationHttpResult):void=>{if(settled)return;settled=true;active--;resolve(Object.freeze(value));};
   let request:ReturnType<typeof https.request>;
   try{request=https.request(new URL('/v1/isolation',origin),{method:'POST',ca,rejectUnauthorized:true,minVersion:'TLSv1.3',agent:false,signal:AbortSignal.any([signal,AbortSignal.timeout(deadline)]),headers:{'Content-Type':'application/json','Content-Length':body.length}},response=>{
    const parts:Buffer[]=[];let size=0;
    if((response.statusCode??0)>=300&&(response.statusCode??0)<400||response.headers['content-encoding']!==undefined||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers['content-type']??'')){response.destroy();finish(unknown());return;}
    response.on('data',(data:Buffer)=>{if(settled)return;size+=data.length;if(size>LIMIT){response.destroy();finish(unknown());}else parts.push(data);});
    response.once('aborted',()=>finish(unknown()));response.once('error',()=>finish(unknown()));
    response.once('end',()=>{
     try{
      const value=strictJSON(Buffer.concat(parts),LIMIT);
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('shape');
      const result=value as Record<string,unknown>;
      if(result.schema_version!==1)throw new Error('version');
      if(result.outcome==='SUCCEEDED'){
       exact(result,['schema_version','outcome','permit_digest','receipt']);
       if(response.statusCode!==200||result.permit_digest!==expected)throw new Error('binding');
       const receipt=parseIsolationFenceReceipt(result.receipt);
       if(receipt.deployment_id!==binding.deployment_id||receipt.operation_id!==binding.operation_id||receipt.source_epoch!==binding.source_epoch)throw new Error('receipt binding');
       finish({outcome:'SUCCEEDED',receipt});
      }else{
       exact(result,['schema_version','outcome','permit_digest','code']);
       if(result.outcome!=='REJECTED'&&result.outcome!=='UNKNOWN'||result.permit_digest!==null&&result.permit_digest!==expected||typeof result.code!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(result.code))throw new Error('error');
       finish(result.outcome==='UNKNOWN'?unknown():{outcome:'REJECTED',code:result.code});
      }
     }catch{finish(unknown());}
    });
   });
   }catch{finish(unknown());return;}
   request.once('error',()=>finish(unknown()));request.end(body);
  });
 }});
}
