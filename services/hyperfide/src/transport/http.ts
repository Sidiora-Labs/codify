import fs from 'node:fs/promises';
import https from 'node:https';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {FoundationError} from '../policy/programme.js';
import {MAX_BODY_BYTES,canonicalOrigin,fail} from './protocol.js';
import type {InvocationContext} from './protocol.js';
import type {IdentityAuthority} from '../identity/enrollment.js';
export interface HttpTransportOptions{origin:string;host:string;port:number;certificate:string;privateKey:string;signal:AbortSignal;identity:IdentityAuthority;maxConcurrent?:number;deadlineMs?:number;requestLimit?:number;responseLimit?:number;dispatch:(i:InvocationContext)=>Promise<unknown>;authorize?:(i:InvocationContext)=>Promise<void>}
export interface HttpTransport{readonly address:string;close():Promise<void>}
async function tlsFile(file:string,secret:boolean):Promise<Buffer>{const fd=await fs.open(file,'r');try{const s=await fd.stat(),n=await fs.lstat(file);if(!s.isFile()||n.isSymbolicLink()||s.ino!==n.ino||s.dev!==n.dev||s.size>65536||s.size<1||secret&&(s.mode&0o077)!==0)fail('TLS_CONFIG_INVALID','Bounded regular TLS files and private key permissions required');return await fd.readFile();}finally{await fd.close();}}
function status(code:string):number{if(code.includes('TOO_LARGE'))return 413;if(code==='ADMISSION_BUSY')return 429;if(code==='OUTCOME_UNKNOWN')return 504;if(code==='SHUTTING_DOWN')return 503;if(['AUTH_SCOPE_DENIED','ROLE_DENIED','ACTION_DENIED'].includes(code))return 403;if(code.startsWith('AUTH_'))return 401;if(code.includes('CONFLICT')||code.includes('STALE')||code==='ENROLLMENT_QUARANTINED')return 409;return 400;}
function send(res:ServerResponse,v:unknown,limit:number,code=200):void{if(res.destroyed||res.writableEnded)return;let text:string;try{text=JSON.stringify(v,(_key,value:unknown)=>{if(['undefined','function','symbol','bigint'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new Error('Invalid JSON');return value;});if(Buffer.byteLength(text)>limit)throw new Error('Limit');}catch{text=JSON.stringify({protocol_version:1,ok:false,error:{code:'RESPONSE_TOO_LARGE',message:'Response exceeds protocol limit'}});code=413;}res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(text),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(text);}
export async function startHttpTransport(o:HttpTransportOptions):Promise<HttpTransport>{
 const origin=canonicalOrigin(o.origin),max=o.maxConcurrent??32,deadline=o.deadlineMs??15000,requestLimit=o.requestLimit??MAX_BODY_BYTES,responseLimit=o.responseLimit??MAX_BODY_BYTES;
 if(origin!==o.identity.origin||!Number.isInteger(o.port)||o.port<1||o.port>65535||!o.host||o.host.includes('\0')||!Number.isInteger(max)||max<1||max>512||!Number.isInteger(deadline)||deadline<100||deadline>120000||!Number.isInteger(requestLimit)||requestLimit<256||requestLimit>MAX_BODY_BYTES||!Number.isInteger(responseLimit)||responseLimit<256||responseLimit>MAX_BODY_BYTES)fail('TRANSPORT_CONFIG','Invalid explicit bounded listener configuration');
 const [cert,key]=await Promise.all([tlsFile(o.certificate,false),tlsFile(o.privateKey,true)]);if(o.signal.aborted)fail('SHUTTING_DOWN','Startup cancelled');
 let accepting=true,active=0;const requests=new Set<Promise<void>>(),controllers=new Set<AbortController>();
 const server=https.createServer({cert,key,minVersion:'TLSv1.3',handshakeTimeout:5000,maxHeaderSize:8192,headersTimeout:5000,requestTimeout:5000,keepAliveTimeout:3000,rejectNonStandardBodyWrites:true},(req,res)=>{let p:Promise<void>;p=handle(req,res).finally(()=>requests.delete(p));requests.add(p);});
 server.maxHeadersCount=24;server.maxConnections=max*4;server.maxRequestsPerSocket=128;server.on('tlsClientError',()=>{});server.on('clientError',(_e,socket)=>socket.destroy());
 async function handle(req:IncomingMessage,res:ServerResponse):Promise<void>{
  if(!accepting){send(res,{protocol_version:1,ok:false,error:{code:'SHUTTING_DOWN',message:'Coordinator stopping'}},responseLimit,503);return;}if(active>=max){send(res,{protocol_version:1,ok:false,error:{code:'ADMISSION_BUSY',message:'Concurrent request budget exhausted'}},responseLimit,429);return;}
  active++;const controller=new AbortController();controllers.add(controller);const abort=():void=>controller.abort(),disconnected=():void=>{if(!res.writableEnded)abort();};o.signal.addEventListener('abort',abort,{once:true});res.once('close',disconnected);req.once('aborted',abort);
  const timer=setTimeout(()=>{abort();send(res,{protocol_version:1,ok:false,error:{code:'OUTCOME_UNKNOWN',message:'Deadline elapsed; reconcile original operation identity'}},responseLimit,504);req.destroy();},deadline);
  try{
   if(req.method!=='POST'||!['/v1/invoke','/v1/enroll'].includes(req.url??''))fail('INVALID_REQUEST','Fixed versioned POST endpoint required');
   if(req.headers['content-encoding']!==undefined||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))fail('INVALID_REQUEST','Uncompressed UTF8 application/json required');
   let size=0;const chunks:Buffer[]=[];for await(const item of req){if(controller.signal.aborted)fail('OUTCOME_UNKNOWN','Interrupted request');const part=Buffer.isBuffer(item)?item:Buffer.from(item);size+=part.length;if(size>requestLimit)fail('REQUEST_TOO_LARGE','Request exceeds byte limit');chunks.push(part);}const body=Buffer.concat(chunks);
   if(controller.signal.aborted)fail('OUTCOME_UNKNOWN','Interrupted request');
   if(req.url==='/v1/enroll'){const result=await o.identity.enroll(body,req.rawHeaders,controller.signal);send(res,{protocol_version:1,ok:true,result},responseLimit);}else{const i=await o.identity.authenticate(body,req.rawHeaders,controller.signal);if(o.authorize)await o.authorize(i);const result=await o.dispatch(i);send(res,{protocol_version:1,operation_id:i.operation.operation_id,...result as object},responseLimit);}
  }catch(error){const e=controller.signal.aborted?{code:'OUTCOME_UNKNOWN',message:'Interrupted; reconcile original operation identity'}:error instanceof FoundationError?{code:error.code,message:error.message}:{code:'HANDLER_FAILED',message:'Coordinator operation failed'};send(res,{protocol_version:1,ok:false,error:e},responseLimit,status(e.code));}
  finally{clearTimeout(timer);res.removeListener('close',disconnected);req.removeListener('aborted',abort);o.signal.removeEventListener('abort',abort);controllers.delete(controller);active--;}
 }
 await new Promise<void>((resolve,reject)=>{const error=(e:Error):void=>{server.removeListener('listening',ready);reject(e);},ready=():void=>{server.removeListener('error',error);resolve();};server.once('error',error);server.once('listening',ready);server.listen(o.port,o.host);});
 if(o.signal.aborted){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fail('SHUTTING_DOWN','Startup cancelled');}
 let cleanup:Promise<void>|undefined;const close=():Promise<void>=>cleanup??=(async()=>{accepting=false;const closed=new Promise<void>(resolve=>server.close(()=>resolve()));for(const c of controllers)c.abort();server.closeIdleConnections();const timer=setTimeout(()=>server.closeAllConnections(),Math.min(deadline,5000));try{await Promise.allSettled([...requests]);await closed;}finally{clearTimeout(timer);o.signal.removeEventListener('abort',onAbort);}})();const onAbort=():void=>{void close();};o.signal.addEventListener('abort',onAbort,{once:true});
 return Object.freeze({address:origin,close});
}


export interface ServiceClientConfiguration {
  readonly origin:string;readonly caFile:string;readonly keyFile:string;readonly credentialId:string;readonly runId:string;
  readonly routes:Readonly<Record<string,{readonly roles:readonly string[];readonly components:readonly string[];readonly actions:readonly string[]}>>;
  readonly timeoutMs?:number;readonly maxConcurrent?:number;
}
export interface ServiceCommand {readonly operation:import('./protocol.js').Operation;readonly payloadBytes:Buffer}
export type ServiceResponse={transport:'RESPONSE';status:number;body:unknown;operation_id:string}|{transport:'UNKNOWN';operation_id:string;reason:string};
export interface ServiceClient {invoke(invocation:InvocationContext,command:ServiceCommand):Promise<ServiceResponse>}
export async function createServiceClient(config:ServiceClientConfiguration,gateway:import('../identity/enrollment.js').IdentityGateway):Promise<ServiceClient>{
 const {createPrivateKey,sign,randomUUID}=await import('node:crypto');
 const {assertInvocation,decodeInvoke,hash,signingBytes,strictJSON,uuid,frozen}=await import('./protocol.js');
 const trusted=frozen({...config,routes:JSON.parse(JSON.stringify(config.routes)) as ServiceClientConfiguration['routes']});
 const origin=canonicalOrigin(trusted.origin),timeout=trusted.timeoutMs??15000,max=trusted.maxConcurrent??16;
 if(!uuid(trusted.credentialId)||!uuid(trusted.runId)||!Number.isInteger(timeout)||timeout<100||timeout>120000||!Number.isInteger(max)||max<1||max>128)fail('TRANSPORT_CONFIG','Invalid fixed service client configuration');
 const [ca,keyBytes]=await Promise.all([tlsFile(trusted.caFile,false),tlsFile(trusted.keyFile,true)]);
 const key=createPrivateKey(keyBytes);keyBytes.fill(0);
 if(key.asymmetricKeyType!=='ed25519')fail('TRANSPORT_CONFIG','Service proof requires an Ed25519 private key');
 let active=0;
 return Object.freeze({invoke:async(invocation:InvocationContext,command:ServiceCommand):Promise<ServiceResponse>=>{
  const assertVerified:(value:unknown)=>asserts value is InvocationContext=assertInvocation;
  assertVerified(invocation);
  const operation=command.operation,body=Buffer.from(JSON.stringify({...operation,payload_b64:command.payloadBytes.toString('base64url')}));
  const decoded=decodeInvoke(body),route=trusted.routes[invocation.payload.action];
  if(!route||!route.roles.includes(invocation.principal.role)||!route.components.includes(decoded.payload.component)||
      !route.actions.includes(decoded.payload.action)||decoded.payload.run_id!==trusted.runId||invocation.principal.run_id!==trusted.runId)
    fail('AUTH_SCOPE_DENIED','Service RPC is outside the trusted source/action/run route');
  await gateway.withPrimaryTransaction({timeoutMs:Math.min(timeout,5000),signal:invocation.signal,guard:invocation.guard},async()=>{});
  if(active>=max)fail('ADMISSION_BUSY','Service client concurrency budget exhausted');
  active++;
  const item={id:trusted.credentialId,time:String(Math.floor(Date.now()/1000)),nonce:randomUUID()};
  const signature=sign(null,signingBytes(origin,'/v1/invoke',item,body),key).toString('base64url');
  return await new Promise<ServiceResponse>(resolve=>{
   let settled=false;
   const finish=(result:ServiceResponse):void=>{if(settled)return;settled=true;active--;resolve(result);};
   const request=https.request(new URL('/v1/invoke',origin),{method:'POST',ca,rejectUnauthorized:true,minVersion:'TLSv1.3',agent:false,
    headers:{'Content-Type':'application/json','Content-Length':body.length,'HF-Credential-Id':item.id,'HF-Request-Time':item.time,'HF-Request-Nonce':item.nonce,'HF-Request-Signature':signature},
    signal:AbortSignal.any([invocation.signal,AbortSignal.timeout(timeout)])},response=>{
     const chunks:Buffer[]=[];let size=0;
     response.on('data',(part:Buffer)=>{size+=part.length;if(size>MAX_BODY_BYTES){response.destroy();finish({transport:'UNKNOWN',operation_id:operation.operation_id,reason:'Response exceeds protocol limit'});}else chunks.push(part);});
     response.once('aborted',()=>finish({transport:'UNKNOWN',operation_id:operation.operation_id,reason:'Response interrupted after send'}));
     response.once('error',()=>finish({transport:'UNKNOWN',operation_id:operation.operation_id,reason:'Response failed after send'}));
     response.once('end',()=>{
      try{
       const value=strictJSON(Buffer.concat(chunks));
       if(!value||typeof value!=='object'||!('ok' in value)||typeof value.ok!=='boolean'||!('protocol_version' in value)||value.protocol_version!==1)
        throw new Error('Invalid response envelope');
       if(value.ok===true&&(!('result' in value)||!('operation_id' in value)||value.operation_id!==operation.operation_id||!('id' in value)||value.id!==operation.operation_id))throw new Error('Response operation mismatch');
       if('operation_id' in value&&value.operation_id!==operation.operation_id)throw new Error('Response operation mismatch');
       finish({transport:'RESPONSE',status:response.statusCode??0,body:value,operation_id:operation.operation_id});
      }catch{finish({transport:'UNKNOWN',operation_id:operation.operation_id,reason:'Unverifiable response after send'});}
     });
    });
   request.once('error',()=>finish({transport:'UNKNOWN',operation_id:operation.operation_id,reason:'Transport failed; reconcile the original operation identity'}));
   request.end(body);
  });
 }});
}
