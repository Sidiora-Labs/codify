import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {FoundationError} from '../policy/programme.js';
import {canonicalOrigin,strictJSON,hash,base64,UUID,DIGEST} from './protocol.js';
import {assertVerifiedWriterObservationPermit} from '../identity/credentials.js';
import type {VerifiedWriterObservationPermit} from '../identity/credentials.js';

const LIMIT=128*1024;
export interface WriterObservation {
 readonly schema_version:1;readonly deployment_id:string;readonly operation_id:string;
 readonly source_epoch:string|null;readonly topology_digest:string;readonly status:'OBSERVED'|'UNKNOWN';
 readonly observed_at:string;readonly expires_at:string;readonly evidence_digest:string;
 readonly journal_operation_id:string;readonly resource_count:number;readonly isolated_count:number;readonly unknown_count:number;
 readonly legacy_status:'ISOLATED'|'UNKNOWN';readonly destruction_authority:false;readonly activation_authority:false;
}
export interface WriterObservationPermitVerifier {verifySigned(serialized:Buffer|string):VerifiedWriterObservationPermit}
export interface WriterObservationHttpTransportOptions {
 readonly origin:string;readonly host:string;readonly port:number;
 readonly certificate:string;readonly privateKey:string;readonly signal:AbortSignal;
 readonly verifier:WriterObservationPermitVerifier;
 readonly dispatch:(permit:VerifiedWriterObservationPermit,signal:AbortSignal)=>Promise<WriterObservation>;
 readonly maxConcurrent?:number;readonly deadlineMs?:number;
}
export interface WriterObservationHttpTransport {readonly address:string;close():Promise<void>}
export type WriterObservationHttpResult=
 |{readonly outcome:'OBSERVED';readonly observation:WriterObservation}
 |{readonly outcome:'REJECTED';readonly code:string}
 |{readonly outcome:'UNKNOWN';readonly code:'WRITER_OBSERVATION_OUTCOME_UNKNOWN'};
export interface WriterObservationHttpClientOptions {
 readonly origin:string;readonly caFile:string;readonly deadlineMs?:number;readonly maxConcurrent?:number;
}
export interface WriterObservationHttpClient {observe(permitEnvelope:string,signal:AbortSignal):Promise<WriterObservationHttpResult>}

function fail(code:string):never{throw new FoundationError(code,'WriterObservation transport refused the operation');}
function exact(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail('WRITER_OBSERVATION_REQUEST_INVALID');
}
function bounded(value:number|undefined,fallback:number,min:number,max:number):number{
 const result=value??fallback;if(!Number.isSafeInteger(result)||result<min||result>max)fail('WRITER_OBSERVATION_TRANSPORT_CONFIG');return result;
}
function utc(value:unknown):value is string{
 if(typeof value!=='string'||value.length!==24||!Number.isFinite(Date.parse(value)))return false;
 return new Date(value).toISOString()===value;
}
export function parseWriterObservation(value:unknown):WriterObservation{
 exact(value,['schema_version','deployment_id','operation_id','source_epoch','topology_digest','status','observed_at','expires_at','evidence_digest','journal_operation_id','resource_count','isolated_count','unknown_count','legacy_status','destruction_authority','activation_authority']);
 const now=Date.now();
 if(value.schema_version!==1||typeof value.deployment_id!=='string'||!UUID.test(value.deployment_id)||typeof value.operation_id!=='string'||!UUID.test(value.operation_id)||
  value.source_epoch!==null&&(typeof value.source_epoch!=='string'||!UUID.test(value.source_epoch))||
  typeof value.topology_digest!=='string'||!DIGEST.test(value.topology_digest)||typeof value.status!=='string'||!['OBSERVED','UNKNOWN'].includes(value.status)||
  !utc(value.observed_at)||!utc(value.expires_at)||typeof value.evidence_digest!=='string'||!DIGEST.test(value.evidence_digest)||
  value.journal_operation_id!==value.operation_id||!Number.isSafeInteger(value.resource_count)||Number(value.resource_count)<1||Number(value.resource_count)>256||
  !Number.isSafeInteger(value.isolated_count)||Number(value.isolated_count)<0||!Number.isSafeInteger(value.unknown_count)||Number(value.unknown_count)<0||
  Number(value.isolated_count)+Number(value.unknown_count)!==value.resource_count||typeof value.legacy_status!=='string'||!['ISOLATED','UNKNOWN'].includes(value.legacy_status)||
  value.status==='OBSERVED'&&(value.unknown_count!==0||value.legacy_status!=='ISOLATED')||
  value.destruction_authority!==false||value.activation_authority!==false||
  Date.parse(value.observed_at)>now+1000||Date.parse(value.expires_at)<=now||
  Date.parse(value.expires_at)<=Date.parse(value.observed_at)||Date.parse(value.expires_at)-Date.parse(value.observed_at)>30000)fail('WRITER_OBSERVATION_INVALID');
 return Object.freeze({...value}) as unknown as WriterObservation;
}
async function tlsFile(filename:string,secret:boolean):Promise<Buffer>{
 if(typeof filename!=='string'||!path.isAbsolute(filename)||filename.includes('\0'))fail('WRITER_OBSERVATION_TLS_CONFIG');
 let fd:Awaited<ReturnType<typeof fs.open>>|undefined;
 try{
  if(await fs.realpath(filename)!==path.resolve(filename))fail('WRITER_OBSERVATION_TLS_CONFIG');
  fd=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  const current=await fd.stat(),name=await fs.lstat(filename);
  if(!current.isFile()||name.isSymbolicLink()||current.ino!==name.ino||current.dev!==name.dev||
   current.size<1||current.size>65536||secret&&(current.mode&0o777)!==0o600)fail('WRITER_OBSERVATION_TLS_CONFIG');
  return await fd.readFile();
 }catch{return fail('WRITER_OBSERVATION_TLS_CONFIG');}finally{await fd?.close();}
}
function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=():void=>reject(new FoundationError('WRITER_OBSERVATION_OUTCOME_UNKNOWN','WriterObservation interrupted; reconcile original operation'));
  if(signal.aborted){void operation.catch(()=>{});abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  operation.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort)).catch(()=>{});
 });
}
function errorCode(error:unknown):string{
 return error instanceof FoundationError&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)?error.code:'WRITER_OBSERVATION_REQUEST_INVALID';
}
function respond(res:ServerResponse,status:number,outcome:'OBSERVED'|'REJECTED'|'UNKNOWN',permitDigest:string|null,detail:unknown):void{
 if(res.destroyed||res.writableEnded)return;
 const value=outcome==='OBSERVED'?{schema_version:1,outcome,permit_digest:permitDigest,observation:detail}:{schema_version:1,outcome,permit_digest:permitDigest,code:detail};
 const body=Buffer.from(JSON.stringify(value));
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});
 res.end(body);
}
function headers(req:IncomingMessage,origin:string):void{
 const seen=new Set<string>(),allowed=new Set(['host','content-type','content-length','connection','user-agent','accept']);
 for(let n=0;n<req.rawHeaders.length;n+=2){const key=req.rawHeaders[n]!.toLowerCase();if(seen.has(key)||!allowed.has(key))fail('WRITER_OBSERVATION_REQUEST_INVALID');seen.add(key);}
 if(req.headers.host!==new URL(origin).host||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||
  typeof req.headers['content-length']!=='string'||!/^(0|[1-9][0-9]{0,6})$/.test(req.headers['content-length']))fail('WRITER_OBSERVATION_REQUEST_INVALID');
 if(Number(req.headers['content-length'])>LIMIT)fail('WRITER_OBSERVATION_REQUEST_TOO_LARGE');
}

/** Observation-only listener: no destructive dispatcher or activation capability is accepted. */
export async function startWriterObservationHttpTransport(options:WriterObservationHttpTransportOptions):Promise<WriterObservationHttpTransport>{
 const origin=canonicalOrigin(options.origin),max=bounded(options.maxConcurrent,8,1,32),deadline=bounded(options.deadlineMs,15000,100,120000);
 if(!options.host||options.host.includes('\0')||!Number.isSafeInteger(options.port)||options.port<1||options.port>65535||
  typeof options.verifier?.verifySigned!=='function'||typeof options.dispatch!=='function')fail('WRITER_OBSERVATION_TRANSPORT_CONFIG');
 const [cert,key]=await Promise.all([tlsFile(options.certificate,false),tlsFile(options.privateKey,true)]);
 if(options.signal.aborted){key.fill(0);fail('WRITER_OBSERVATION_SHUTTING_DOWN');}
 let accepting=true,active=0;
 const controllers=new Set<AbortController>(),requests=new Set<Promise<void>>(),dispatches=new Set<Promise<WriterObservation>>();
 const server=https.createServer({cert,key,minVersion:'TLSv1.3',handshakeTimeout:5000,maxHeaderSize:8192,headersTimeout:5000,requestTimeout:5000,keepAliveTimeout:1000,rejectNonStandardBodyWrites:true},(req,res)=>{
  const pending=handle(req,res).finally(()=>requests.delete(pending));requests.add(pending);
 });
 key.fill(0);
 server.maxHeadersCount=12;server.maxConnections=max*4;server.maxRequestsPerSocket=1;
 server.on('tlsClientError',()=>{});server.on('clientError',(_error,socket)=>socket.destroy());
 async function handle(req:IncomingMessage,res:ServerResponse):Promise<void>{
  if(!accepting){respond(res,503,'REJECTED',null,'WRITER_OBSERVATION_SHUTTING_DOWN');req.resume();return;}
  if(active>=max){respond(res,429,'REJECTED',null,'WRITER_OBSERVATION_ADMISSION_BUSY');req.resume();return;}
  active++;let dispatched=false,ownsDispatch=false,permitDigest:string|null=null;
  const controller=new AbortController();controllers.add(controller);
  const abort=():void=>{controller.abort();req.destroy();};
  const disconnected=():void=>{if(!res.writableEnded)controller.abort();};
  options.signal.addEventListener('abort',abort,{once:true});req.once('aborted',abort);res.once('close',disconnected);
  const timer=setTimeout(()=>{respond(res,dispatched?504:408,dispatched?'UNKNOWN':'REJECTED',permitDigest,dispatched?'WRITER_OBSERVATION_OUTCOME_UNKNOWN':'WRITER_OBSERVATION_REQUEST_DEADLINE');abort();},deadline);
  try{
   if(req.method!=='POST'||req.url!=='/v1/isolation/observe')fail('WRITER_OBSERVATION_ROUTE_INVALID');
   headers(req,origin);
   const parts:Buffer[]=[];let size=0;
   for await(const data of req){
    if(controller.signal.aborted)fail('WRITER_OBSERVATION_OUTCOME_UNKNOWN');
    const part=Buffer.isBuffer(data)?data:Buffer.from(data);size+=part.length;
    if(size>LIMIT)fail('WRITER_OBSERVATION_REQUEST_TOO_LARGE');parts.push(part);
   }
   if(size!==Number(req.headers['content-length']))fail('WRITER_OBSERVATION_REQUEST_INVALID');
   const body=strictJSON(Buffer.concat(parts),LIMIT);exact(body,['schema_version','permit_envelope']);
   if(body.schema_version!==1||typeof body.permit_envelope!=='string'||Buffer.byteLength(body.permit_envelope)<1||Buffer.byteLength(body.permit_envelope)>LIMIT)fail('WRITER_OBSERVATION_REQUEST_INVALID');
   permitDigest=hash(body.permit_envelope);
   if(controller.signal.aborted)fail('WRITER_OBSERVATION_OUTCOME_UNKNOWN');
   const permit=options.verifier.verifySigned(body.permit_envelope);
   assertVerifiedWriterObservationPermit(permit);
   if(permit.permit_digest!==permitDigest)fail('WRITER_OBSERVATION_PERMIT_BINDING');
   if(controller.signal.aborted)fail('WRITER_OBSERVATION_OUTCOME_UNKNOWN');
   dispatched=true;
   const operation=Promise.resolve().then(()=>{if(controller.signal.aborted)fail('WRITER_OBSERVATION_OUTCOME_UNKNOWN');return options.dispatch(permit,controller.signal);});
   // The HTTP deadline cannot release a still-running external effect's admission.
   ownsDispatch=true;dispatches.add(operation);
   const settled=():void=>{dispatches.delete(operation);controllers.delete(controller);active--;};
   void operation.then(settled,settled);
   const receipt=parseWriterObservation(await abortable(operation,controller.signal));
   assertVerifiedWriterObservationPermit(permit);
   if(receipt.deployment_id!==permit.deployment_id||receipt.operation_id!==permit.operation_id||receipt.source_epoch!==permit.source_epoch||receipt.topology_digest!==permit.topology_digest)fail('WRITER_OBSERVATION_RECEIPT_BINDING');
   if(controller.signal.aborted)fail('WRITER_OBSERVATION_OUTCOME_UNKNOWN');
   respond(res,200,'OBSERVED',permitDigest,receipt);
  }catch(error){
   const unknown=dispatched||controller.signal.aborted;
   respond(res,unknown?504:errorCode(error).includes('TOO_LARGE')?413:400,unknown?'UNKNOWN':'REJECTED',permitDigest,unknown?'WRITER_OBSERVATION_OUTCOME_UNKNOWN':errorCode(error));
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
   if(dispatches.size)fail('WRITER_OBSERVATION_SHUTDOWN_INCOMPLETE');
  }finally{clearTimeout(timeout);if(dispatchTimeout)clearTimeout(dispatchTimeout);options.signal.removeEventListener('abort',onAbort);}
 })().catch(error=>{closing=undefined;throw error;});
 const onAbort=():void=>{void close().catch(()=>{});};
 options.signal.addEventListener('abort',onAbort,{once:true});
 if(options.signal.aborted){await close();fail('WRITER_OBSERVATION_SHUTTING_DOWN');}
 return Object.freeze({address:origin,close});
}

// Parsing pins a response to the requested operation; only the server's real
// verifier and configured fencing handler grant permission to observe the existing fenced topology.
function requestedBindings(serialized:string):{deployment_id:string;operation_id:string;source_epoch:string|null;topology_digest:string}{
 const envelope=strictJSON(Buffer.from(serialized),LIMIT);exact(envelope,['schema_version','key_id','payload_b64','signature_b64']);
 const claims=strictJSON(base64(envelope.payload_b64),LIMIT);
 if(!claims||typeof claims!=='object'||Array.isArray(claims))fail('WRITER_OBSERVATION_REQUEST_INVALID');
 const v=claims as Record<string,unknown>;
 if(typeof v.topology_digest!=='string'||!DIGEST.test(v.topology_digest)||v.schema_version!==1||v.purpose!=='EXTERNAL_WRITER_OBSERVATION_ONLY'||typeof v.deployment_id!=='string'||!UUID.test(v.deployment_id)||typeof v.operation_id!=='string'||!UUID.test(v.operation_id)||v.source_epoch!==null&&(typeof v.source_epoch!=='string'||!UUID.test(v.source_epoch)))fail('WRITER_OBSERVATION_REQUEST_INVALID');
 return {deployment_id:v.deployment_id,operation_id:v.operation_id,source_epoch:v.source_epoch as string|null,topology_digest:v.topology_digest as string};
}
/** No redirects, dynamic URLs, bearer identity or PG fallback are accepted. */
export async function createWriterObservationHttpClient(options:WriterObservationHttpClientOptions):Promise<WriterObservationHttpClient>{
 const origin=canonicalOrigin(options.origin),deadline=bounded(options.deadlineMs,15000,100,120000),max=bounded(options.maxConcurrent,8,1,32);
 const ca=await tlsFile(options.caFile,false);let active=0;
 return Object.freeze({observe:async(permitEnvelope:string,signal:AbortSignal):Promise<WriterObservationHttpResult>=>{
  if(signal.aborted)return {outcome:'REJECTED',code:'WRITER_OBSERVATION_CANCELLED_BEFORE_SEND'};
  if(typeof permitEnvelope!=='string'||!permitEnvelope.length||Buffer.byteLength(permitEnvelope)>LIMIT)return {outcome:'REJECTED',code:'WRITER_OBSERVATION_REQUEST_INVALID'};
  let binding:ReturnType<typeof requestedBindings>;
  try{binding=requestedBindings(permitEnvelope);}catch{return {outcome:'REJECTED',code:'WRITER_OBSERVATION_REQUEST_INVALID'};}
  const body=Buffer.from(JSON.stringify({schema_version:1,permit_envelope:permitEnvelope})),expected=hash(permitEnvelope);
  if(body.length>LIMIT)return {outcome:'REJECTED',code:'WRITER_OBSERVATION_REQUEST_TOO_LARGE'};
  if(active>=max)return {outcome:'REJECTED',code:'WRITER_OBSERVATION_ADMISSION_BUSY'};
  active++;
  return new Promise<WriterObservationHttpResult>(resolve=>{
   let settled=false;
   const unknown=():WriterObservationHttpResult=>({outcome:'UNKNOWN',code:'WRITER_OBSERVATION_OUTCOME_UNKNOWN'});
   const finish=(value:WriterObservationHttpResult):void=>{if(settled)return;settled=true;active--;resolve(Object.freeze(value));};
   let request:ReturnType<typeof https.request>;
   try{request=https.request(new URL('/v1/isolation/observe',origin),{method:'POST',ca,rejectUnauthorized:true,minVersion:'TLSv1.3',agent:false,signal:AbortSignal.any([signal,AbortSignal.timeout(deadline)]),headers:{'Content-Type':'application/json','Content-Length':body.length}},response=>{
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
      if(result.outcome==='OBSERVED'){
       exact(result,['schema_version','outcome','permit_digest','observation']);
       if(response.statusCode!==200||result.permit_digest!==expected)throw new Error('binding');
       const receipt=parseWriterObservation(result.observation);
       if(receipt.deployment_id!==binding.deployment_id||receipt.operation_id!==binding.operation_id||receipt.source_epoch!==binding.source_epoch||receipt.topology_digest!==binding.topology_digest)throw new Error('receipt binding');
       finish({outcome:'OBSERVED',observation:receipt});
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
