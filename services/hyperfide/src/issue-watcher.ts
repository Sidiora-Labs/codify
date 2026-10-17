import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {constants} from 'node:fs';
import {createPrivateKey,randomUUID,sign} from 'node:crypto';
import type {KeyObject} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {Component,ComponentContext} from './components/registry.js';
import {canonicalOrigin,exact,fail,hash,MAX_BODY_BYTES,signingBytes,strictJSON,uuid} from './transport/protocol.js';
import {validateSupervisoryHostConfig} from './supervisory-host.js';

/* `hyperfide issue-watcher --config FILE` (deploy/hyperfide/issue-watcher.service).
 * The watcher is a signed client of control: it holds no database URL, never
 * writes local state, and only reports a pass as reconciled when control confirmed
 * every call. The ten-minute cadence is the accepted baseline (req 18 ac_2). */
export const BASELINE_INTERVAL_SECONDS=600;
const FINDINGS='finding-github';
export const WATCHER_CALLS=Object.freeze([
 ['14.1','identity.describe'],[FINDINGS,'finding.github.reconcile'],[FINDINGS,'finding.github.due'],
 [FINDINGS,'finding.github.dispatch'],[FINDINGS,'finding.github.process-delivery']
] as const);
export const WATCHER_ACTIONS=Object.freeze(WATCHER_CALLS.map(([,action])=>action));
const CONFIG_KEYS=['schema_version','organisation_id','run_id','credential_id','key_file','ca_file','control_origin',
 'repositories','interval_seconds','cadence_amendment','due_limit','request_timeout_ms'];
export interface WatchedRepository {repository_id:string;owner:string;repository:string}
export interface WatcherConfig {
 organisation_id:string;run_id:string;credential_id:string;key_file:string;ca_file:string;control_origin:string;
 repositories:WatchedRepository[];interval_seconds:number;cadence_amendment:{record_id:string;interval_seconds:number}|null;
 due_limit:number;request_timeout_ms:number;
}
export interface CallOutcome {component:string;action:string;subject:string|null;outcome:'CONFIRMED'|'REFUSED'|'UNCONFIRMED';code:string|null}
export interface PassReport {pass:number;confirmed:boolean;reconciled:string[];deferred:string[];calls:CallOutcome[]}
function integer(value:unknown,low:number,high:number,label:string):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<low||value>high)fail('WATCHER_CONFIG_INVALID',label+' must be an integer from '+low+' to '+high);
 return value;
}
function absolute(value:unknown,label:string):string{
 if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')||path.normalize(value)!==value)fail('WATCHER_CONFIG_INVALID',label+' must be a canonical absolute path');
 return value;
}
function githubName(value:unknown):string{
 if(typeof value!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(value)||value==='.'||value==='..')fail('WATCHER_CONFIG_INVALID','GitHub owner/repository names must be exact identifiers');
 return value;
}
/** Pure structural validation; file contents are only read by the launcher. */
export function validateWatcherConfig(value:unknown):WatcherConfig{
 exact(value,CONFIG_KEYS);
 if(value.schema_version!==1)fail('WATCHER_CONFIG_INVALID','Unsupported issue watcher configuration version');
 for(const key of ['organisation_id','run_id','credential_id'])if(!uuid(value[key]))fail('WATCHER_CONFIG_INVALID','Exact watcher scope and credential identities are required');
 if(!Array.isArray(value.repositories)||value.repositories.length<1||value.repositories.length>64)fail('WATCHER_CONFIG_INVALID','One to 64 watched repositories are required');
 const repositories=value.repositories.map(raw=>{
  exact(raw,['repository_id','owner','repository']);
  if(!uuid(raw.repository_id))fail('WATCHER_CONFIG_INVALID','Exact repository identity is required');
  return {repository_id:raw.repository_id as string,owner:githubName(raw.owner),repository:githubName(raw.repository)};
 });
 if(new Set(repositories.map(r=>r.repository_id)).size!==repositories.length||new Set(repositories.map(r=>(r.owner+'/'+r.repository).toLowerCase())).size!==repositories.length)
  fail('WATCHER_CONFIG_INVALID','Each repository is watched exactly once');
 let amendment:WatcherConfig['cadence_amendment']=null;
 if(value.cadence_amendment!==null){
  exact(value.cadence_amendment,['record_id','interval_seconds']);
  if(!uuid(value.cadence_amendment.record_id))fail('WATCHER_CONFIG_INVALID','A cadence amendment names its accepted policy record');
  amendment={record_id:value.cadence_amendment.record_id,interval_seconds:integer(value.cadence_amendment.interval_seconds,60,86400,'Amended interval')};
 }
 const interval=integer(value.interval_seconds,60,86400,'Interval');
 if(interval!==(amendment?amendment.interval_seconds:BASELINE_INTERVAL_SECONDS))
  fail('WATCHER_CADENCE_AMENDMENT_REQUIRED','The ten-minute reconciliation baseline changes only through an accepted run-policy amendment');
 let origin:string;
 try{origin=canonicalOrigin(value.control_origin);}catch{fail('WATCHER_CONFIG_INVALID','Control origin must be a canonical HTTPS origin');}
 return {organisation_id:value.organisation_id as string,run_id:value.run_id as string,credential_id:value.credential_id as string,
  key_file:absolute(value.key_file,'Key file'),ca_file:absolute(value.ca_file,'CA file'),control_origin:origin,repositories,
  interval_seconds:interval,cadence_amendment:amendment,due_limit:integer(value.due_limit,1,100,'Due limit'),
  request_timeout_ms:integer(value.request_timeout_ms,100,120000,'Request timeout')};
}
function plan(config:WatcherConfig):Record<string,unknown>{
 return {launcher:'hyperfide issue-watcher --config FILE',organisation_id:config.organisation_id,run_id:config.run_id,
  control_origin:config.control_origin,interval_seconds:config.interval_seconds,cadence:config.cadence_amendment?'AMENDED':'BASELINE',
  cadence_amendment:config.cadence_amendment,
  repositories:config.repositories.slice().sort((a,b)=>a.repository_id.localeCompare(b.repository_id)),
  per_pass:[...config.repositories.map(r=>'finding.github.reconcile:'+r.repository_id),'finding.github.due','finding.github.dispatch*','finding.github.process-delivery*'],
  required_actions:[...WATCHER_ACTIONS],principal_role:'COORDINATOR',local_state:false,local_fallback:false};
}
async function ownedFile(file:string,secret:boolean,max:number):Promise<Buffer>{
 let handle:Awaited<ReturnType<typeof fs.open>>|undefined;
 try{
  if(await fs.realpath(file)!==file)fail('WATCHER_CONFIG_INVALID','Watcher files cannot traverse symlinks');
  handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await handle.stat(),named=await fs.lstat(file);
  if(!stat.isFile()||stat.uid!==process.geteuid?.()||stat.ino!==named.ino||stat.dev!==named.dev||stat.size<1||stat.size>max||
     (secret?(stat.mode&0o077)!==0:(stat.mode&0o022)!==0))fail('WATCHER_CONFIG_INVALID','Bounded private operator-owned watcher files are required');
  return await handle.readFile();
 }catch(error){if(error instanceof Error&&'code' in error&&String(error.code).startsWith('WATCHER_'))throw error;return fail('WATCHER_CONFIG_INVALID','Watcher file is unavailable');}
 finally{await handle?.close();}
}
class RemoteRefusal extends Error{constructor(readonly code:string,readonly confirmed:boolean){super(code);}}
export class IssueWatcher {
 private verified=false;private passes=0;
 constructor(private readonly config:WatcherConfig,private readonly key:KeyObject,private readonly ca:Buffer,private readonly signal:AbortSignal){}
 private call(component:string,action:string,input:unknown):Promise<unknown>{
  const id=randomUUID(),payload=Buffer.from(JSON.stringify({run_id:this.config.run_id,component,action,input,expected_version:null,authority:null}));
  const body=Buffer.from(JSON.stringify({protocol_version:1,operation_id:id,idempotency_key:id,payload_digest:hash(payload),correlation_id:id,causation_id:null,payload_b64:payload.toString('base64url')}));
  if(body.length>MAX_BODY_BYTES)return Promise.reject(new RemoteRefusal('WATCHER_REQUEST_INVALID',true));
  const proof={id:this.config.credential_id,time:String(Math.floor(Date.now()/1000)),nonce:randomUUID()};
  const signature=sign(null,signingBytes(this.config.control_origin,'/v1/invoke',proof,body),this.key).toString('base64url');
  return new Promise((resolve,reject)=>{
   let done=false;const finish=(error:Error|null,value?:unknown)=>{if(done)return;done=true;if(error)reject(error);else resolve(value);};
   const request=https.request(new URL('/v1/invoke',this.config.control_origin),{method:'POST',ca:this.ca,rejectUnauthorized:true,minVersion:'TLSv1.3',agent:false,
    signal:AbortSignal.any([this.signal,AbortSignal.timeout(this.config.request_timeout_ms)]),
    headers:{'Content-Type':'application/json','Content-Length':body.length,'HF-Credential-Id':proof.id,'HF-Request-Time':proof.time,'HF-Request-Nonce':proof.nonce,'HF-Request-Signature':signature}},response=>{
    const parts:Buffer[]=[];let size=0;
    response.on('data',(part:Buffer)=>{size+=part.length;if(size>MAX_BODY_BYTES){response.destroy();finish(new RemoteRefusal('WATCHER_RESPONSE_UNKNOWN',false));}else parts.push(part);});
    response.once('error',()=>finish(new RemoteRefusal('WATCHER_RESPONSE_UNKNOWN',false)));
    response.once('end',()=>{
     let r:Record<string,unknown>;
     try{const parsed=strictJSON(Buffer.concat(parts));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();r=parsed as Record<string,unknown>;}
     catch{finish(new RemoteRefusal('WATCHER_RESPONSE_UNKNOWN',false));return;}
     if(r.ok===false&&r.error&&typeof r.error==='object'&&typeof (r.error as Record<string,unknown>).code==='string'){finish(new RemoteRefusal(String((r.error as Record<string,unknown>).code),true));return;}
     if(response.statusCode!==200||r.protocol_version!==1||r.operation_id!==id||r.ok!==true||!Object.hasOwn(r,'result')){finish(new RemoteRefusal('WATCHER_RESPONSE_UNCONFIRMED',false));return;}
     finish(null,r.result);
    });
   });
   request.once('error',()=>finish(new RemoteRefusal('CONTROL_UNAVAILABLE',false)));request.end(body);
  });
 }
 private async observed(report:PassReport,component:string,action:string,subject:string|null,input:unknown):Promise<unknown>{
  try{const result=await this.call(component,action,input);report.calls.push({component,action,subject,outcome:'CONFIRMED',code:null});return result;}
  catch(error){
   const refusal=error instanceof RemoteRefusal?error:new RemoteRefusal('CONTROL_UNAVAILABLE',false);
   report.calls.push({component,action,subject,outcome:refusal.confirmed?'REFUSED':'UNCONFIRMED',code:refusal.code});report.confirmed=false;return undefined;
  }
 }
 /** One reconciliation pass. A refusal or unknown outcome is never reported as reconciliation. */
 async pass():Promise<PassReport>{
  const report:PassReport={pass:++this.passes,confirmed:true,reconciled:[],deferred:[],calls:[]};
  if(!this.verified){
   const described=await this.observed(report,'14.1','identity.describe',null,{});
   const principal=described&&typeof described==='object'?(described as Record<string,unknown>).principal as Record<string,unknown>|undefined:undefined;
   const allowed=principal?.allowed_actions;
   if(!principal||principal.role!=='COORDINATOR'||principal.credential_id!==this.config.credential_id||principal.organisation_id!==this.config.organisation_id||
      principal.run_id!==this.config.run_id||!Array.isArray(allowed)||WATCHER_ACTIONS.some(action=>!allowed.includes(action))){
    if(report.confirmed)report.calls.push({component:'14.1',action:'identity.describe',subject:null,outcome:'REFUSED',code:'WATCHER_IDENTITY_REQUIRED'});
    report.confirmed=false;return report;
   }
   this.verified=true;
  }
  for(const r of this.config.repositories){
   if(this.signal.aborted)break;
   const result=await this.observed(report,FINDINGS,'finding.github.reconcile',r.repository_id,{repository_id:r.repository_id,owner:r.owner,repository:r.repository}) as Record<string,unknown>|undefined;
   if(result?.reconciled===true)report.reconciled.push(r.repository_id);
   else if(result?.reason==='NOT_DUE')report.deferred.push(r.repository_id);
   else if(result){report.confirmed=false;report.calls[report.calls.length-1]={...report.calls[report.calls.length-1]!,outcome:'REFUSED',code:typeof result.error_code==='string'?result.error_code:'RECONCILE_INCOMPLETE'};}
  }
  const due=await this.observed(report,FINDINGS,'finding.github.due',null,{limit:this.config.due_limit}) as Record<string,unknown>|undefined;
  if(!due)return report;
  const known=new Map(this.config.repositories.map(r=>[r.repository_id,r]));
  for(const item of Array.isArray(due.operations)?due.operations:[]){
   if(this.signal.aborted)break;
   const id=(item as Record<string,unknown>)?.operation_id;
   if(!uuid(id)){report.confirmed=false;continue;}
   await this.observed(report,FINDINGS,'finding.github.dispatch',id,{operation_id:id});
  }
  for(const item of Array.isArray(due.deliveries)?due.deliveries:[]){
   if(this.signal.aborted)break;
   const d=item as Record<string,unknown>,repository=typeof d?.repository_id==='string'?known.get(d.repository_id):undefined;
   if(!repository||typeof d.delivery_id!=='string'){report.calls.push({component:FINDINGS,action:'finding.github.process-delivery',subject:typeof d?.delivery_id==='string'?d.delivery_id:null,outcome:'REFUSED',code:'UNWATCHED_REPOSITORY'});report.confirmed=false;continue;}
   await this.observed(report,FINDINGS,'finding.github.process-delivery',d.delivery_id,{delivery_id:d.delivery_id,repository_id:repository.repository_id,owner:repository.owner,repository:repository.repository});
  }
  return report;
 }
}
export async function issueWatcherCommand(args:readonly string[],env:Readonly<NodeJS.ProcessEnv>,signal:AbortSignal,emit:(line:Record<string,unknown>)=>void):Promise<number>{
 const once=args.length===3&&args[2]==='--once';
 if(!(args.length===2||once)||args[0]!=='--config')fail('INVALID_REQUEST','Usage: hyperfide issue-watcher --config /absolute/watcher.json [--once]');
 if(env.HYPERFIDE_MODE==='local'||env.HYPERFIDE_MODE==='offline')fail('DISTRIBUTED_AUTHORITY_REQUIRED','The issue watcher reconciles only against the authenticated distributed coordinator');
 const config=validateWatcherConfig(strictJSON(await ownedFile(absolute(args[1],'Config file'),true,65536),65536));
 const [ca,keyBytes]=await Promise.all([ownedFile(config.ca_file,false,65536),ownedFile(config.key_file,true,4096)]);
 let key:KeyObject;
 try{key=createPrivateKey(keyBytes);}catch{fail('WATCHER_CONFIG_INVALID','Watcher key must be a private Ed25519 key');}finally{keyBytes.fill(0);}
 if(key.asymmetricKeyType!=='ed25519')fail('WATCHER_CONFIG_INVALID','Watcher key must be a private Ed25519 key');
 const watcher=new IssueWatcher(config,key,ca,signal);
 emit({event:'ready',mode:'distributed',interval_seconds:config.interval_seconds,cadence:config.cadence_amendment?'AMENDED':'BASELINE',repositories:config.repositories.length});
 for(;;){
  const report=await watcher.pass();emit({event:'pass',...report});
  if(once)return report.confirmed?0:75;
  if(signal.aborted)return 0;
  await new Promise<void>(resolve=>{const timer=setTimeout(resolve,config.interval_seconds*1000);signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
  if(signal.aborted)return 0;
 }
}
export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:{
 'issue.watcher.describe':(input,context)=>{
  exact(input,[]);
  return {launcher:'hyperfide issue-watcher --config FILE',compatibility_launcher:'cg issue-watcher --config FILE',
   baseline_interval_seconds:BASELINE_INTERVAL_SECONDS,required_actions:[...WATCHER_ACTIONS],
   actions_approved:WATCHER_ACTIONS.every(action=>context.policy.allowed_actions.includes(action)),
   principal_role:'COORDINATOR',modes:['distributed'],local_state:false,local_fallback:false};
 },
 'issue.watcher.plan':input=>plan(validateWatcherConfig(input)),
 'supervisory.host.validate':input=>validateSupervisoryHostConfig(input)
}};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const emit=(line:Record<string,unknown>)=>{process.stdout.write(JSON.stringify(line)+'\n');};
 try{process.exitCode=await issueWatcherCommand(process.argv.slice(2),Object.freeze({...process.env}),controller.signal,emit);}
 catch(error){const code=typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='string'?error.code:'WATCHER_FAILED';
  process.stderr.write(JSON.stringify({ok:false,error:{code},local_fallback:false})+'\n');process.exitCode=78;}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
