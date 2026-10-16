import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {FoundationError,object} from '../policy/programme.js';
import {assertInvocation,type InvocationContext} from '../transport/protocol.js';
import {assertIsolationPermit,type VerifiedIsolationPermit} from '../identity/credentials.js';
import {assertPrimaryTransaction,type TransactionGateway} from '../storage/transactions.js';

type Binding={deployment_id:string;operation_id:string;source_epoch:string|null;topology_digest:string;authority_digest:string;authority_nonce:string|null};
export interface ExternalFenceReceipt {deployment_id:string;operation_id:string;fence_id:string;source_epoch:string|null;isolated_writer:string;observed_at:string;expires_at:string;evidence_digest:string}
export interface ExternalWriterFence {isolate(input:{deployment_id:string;operation_id:string;source_epoch:string|null;signal?:AbortSignal}):Promise<ExternalFenceReceipt>}
export interface WriterIsolationReceipt {
 evidence_scope:'LIVE_PROVIDER'|'COMPONENT_FIXTURE';reference_key:string;operation_id:string;status:'ISOLATED'|'UNKNOWN';topology_digest:string;resource_identity_digest:string;
 observed_state:'DESTROYED'|'ABSENT'|'UNKNOWN';observed_at:string;expires_at:string;evidence_digest:string;
}
export interface IsolationJournalBinding {schema_version:1;reference_key:string;operation_id:string;topology_digest:string;resource_identity_digest:string;destroy_operation:unknown;authority_digest:string;custody_evidence_digest:string;custody_expires_at:string}
export interface IsolationJournalRecord {binding:IsolationJournalBinding;state:'PREPARED'|'UNKNOWN'|'ISOLATED';receipt:WriterIsolationReceipt|null;observations:readonly {operation:unknown;outcome:unknown}[]}
export interface IsolationJournal {
 read():Promise<IsolationJournalRecord|null>;
 prepare(binding:IsolationJournalBinding):Promise<{created:boolean;state:IsolationJournalRecord}>;
 record(outcome:{binding:IsolationJournalBinding;receipt:WriterIsolationReceipt|null;observations:readonly {operation:unknown;outcome:unknown}[]}):Promise<void>;
}
export interface ProviderIsolationBackend {
 isolateConfiguredResource(referenceKey:string,operationId:string,signal:AbortSignal|undefined,journal:IsolationJournal):Promise<WriterIsolationReceipt>;
}
export interface LegacyWriterReceipt {
 deployment_id:string;operation_id:string;source_epoch:string|null;status:'ADMISSION_DISABLED'|'ISOLATED';topology_digest:string;
 observed_at:string;evidence_digest:string;expires_at?:string;isolated_writer?:string;
 visibility:{scope:'CONFIGURED_PID_NAMESPACE';pid_namespace:string;mount_namespace:string;checked_processes?:number;checked_mount_namespaces?:number};
 admission_disabled?:boolean;writable_fds?:number;writable_shared_mappings?:number;read_only_aliases?:number;
}
export interface LegacyWriterBackend {
 disableAdmission(input:{deployment_id:string;operation_id:string;source_epoch:string|null;signal?:AbortSignal}):Promise<LegacyWriterReceipt>;
 observeIsolation(input:{deployment_id:string;operation_id:string;source_epoch:string|null;signal?:AbortSignal}):Promise<LegacyWriterReceipt>;
}
export interface ExternalFenceTopology {
 schema_version:1;deployment_id:string;organisation_id:string;run_id:string;source_epoch:string|null;evidence_scope:'LIVE_PROVIDER'|'COMPONENT_FIXTURE';
 legacy_topology_digest:string;legacy_pid_namespace:string;legacy_mount_namespace:string;
 required_writer_ids:string[];
 resources:{reference_key:string;topology_digest:string;writer_ids:string[];backend:'PROVIDER'|'OWNED_HOST'}[];
}
export type ExternalFenceAuthority={kind:'INVOCATION';invocation:InvocationContext;gateway:Pick<TransactionGateway,'withPrimaryTransaction'>}|{kind:'ISOLATION_PERMIT';permit:VerifiedIsolationPermit};
export interface ProviderIsolationCapability {
 isolateConfiguredResource(referenceKey:string,operationId:string,authority:InvocationContext|VerifiedIsolationPermit,signal:AbortSignal|undefined,journal:IsolationJournal):Promise<WriterIsolationReceipt>;
}
export function bindProviderIsolation(capability:ProviderIsolationCapability,authority:InvocationContext|VerifiedIsolationPermit):ProviderIsolationBackend {
 if(!capability||typeof capability.isolateConfiguredResource!=='function')fail('EXTERNAL_FENCE_BACKEND_UNAVAILABLE','Actual provisioner isolation capability is required');
 return Object.freeze({isolateConfiguredResource:(key:string,id:string,signal:AbortSignal|undefined,journal:IsolationJournal)=>capability.isolateConfiguredResource(key,id,authority,signal,journal)});
}
type JournalDocument={schema_version:1;binding:Binding;authorizations:{authority_digest:string;authority_nonce:string|null}[];resources:Record<string,IsolationJournalRecord>};
function coreBinding(v:Binding){return {deployment_id:v.deployment_id,operation_id:v.operation_id,source_epoch:v.source_epoch,topology_digest:v.topology_digest}}
function fail(code:string,message:string):never{throw new FoundationError(code,message)}
function canonical(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}'}
function hash(v:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(v)).digest('hex')}
function uuid(v:unknown):v is string{return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)}
function digest(v:unknown):v is string{return typeof v==='string'&&/^sha256:[0-9a-f]{64}$/.test(v)}
function name(v:unknown):v is string{return typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)}
function time(v:unknown):number{if(typeof v!=='string')fail('EXTERNAL_FENCE_INVALID','Missing observation timestamp');const n=Date.parse(v);if(!Number.isFinite(n)||new Date(n).toISOString()!==v)fail('EXTERNAL_FENCE_INVALID','Canonical UTC observation timestamp required');return n}
function checkBinding(v:Binding):void{if(!uuid(v.deployment_id)||!uuid(v.operation_id)||v.source_epoch!==null&&!uuid(v.source_epoch)||!digest(v.topology_digest)||!digest(v.authority_digest)||v.authority_nonce!==null&&!uuid(v.authority_nonce))fail('EXTERNAL_FENCE_INVALID','Invalid durable fence identity')}
function checkResourceBinding(v:IsolationJournalBinding):void{if(v.schema_version!==1||!uuid(v.operation_id)||!name(v.reference_key)||!digest(v.topology_digest)||!digest(v.resource_identity_digest)||!digest(v.authority_digest)||!digest(v.custody_evidence_digest)||typeof v.custody_expires_at!=='string'||!object(v.destroy_operation)||Buffer.byteLength(canonical(v.destroy_operation))>196608)fail('EXTERNAL_FENCE_INVALID','Invalid immutable provider resource binding')}
function checkReceipt(v:WriterIsolationReceipt,b:Binding,r:IsolationJournalBinding):void{
 if(!object(v)||v.reference_key!==r.reference_key||v.operation_id!==b.operation_id||v.topology_digest!==r.topology_digest||v.resource_identity_digest!==r.resource_identity_digest||!digest(v.evidence_digest)||!['LIVE_PROVIDER','COMPONENT_FIXTURE'].includes(v.evidence_scope)||!['ISOLATED','UNKNOWN'].includes(v.status)||!['DESTROYED','ABSENT','UNKNOWN'].includes(v.observed_state))fail('EXTERNAL_FENCE_INVALID','Provider observation is not bound to the trusted resource');
 time(v.observed_at);time(v.expires_at);
 if(v.status==='ISOLATED'&&!['DESTROYED','ABSENT'].includes(v.observed_state))fail('EXTERNAL_FENCE_INVALID','Accepted deletion is not physical isolation');
}
function checkFresh(observed:string,expires:string,now:number):void{
 const at=time(observed),until=time(expires);
 if(at>now+1000||until<=now||until-at>30000||until<=at)fail('EXTERNAL_FENCE_STALE','Physical isolation evidence is expired or outside the permitted interval');
}
/** Private fsynced custody survives a control restart independently of the database being fenced.
 * A crashed operation lock is deliberately not age-reclaimed: operator reconciliation must establish ownership.
 */
export class FileExternalFenceJournal {
 constructor(private readonly directory:string){}
 async withOperation<T>(binding:Binding,body:(resource:(key:string)=>IsolationJournal)=>Promise<T>):Promise<T>{
  checkBinding(binding);
  if(!path.isAbsolute(this.directory)||path.resolve(this.directory)!==this.directory)fail('EXTERNAL_FENCE_JOURNAL_UNSAFE','Canonical absolute private journal directory required');
  const info=await fs.lstat(this.directory);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||typeof process.getuid!=='function'||info.uid!==process.getuid()||await fs.realpath(this.directory)!==this.directory)fail('EXTERNAL_FENCE_JOURNAL_UNSAFE','Fence journal must be a private owned real directory');
  const root=await fs.open(this.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const opened=await root.stat();if(opened.dev!==info.dev||opened.ino!==info.ino){await root.close();fail('EXTERNAL_FENCE_JOURNAL_UNSAFE','Fence journal directory changed during validation')}
  const anchor='/proc/self/fd/'+root.fd,filename=path.join(anchor,binding.operation_id+'.json'),lockname=path.join(anchor,binding.operation_id+'.lock');
  let lock:fs.FileHandle|undefined;let active=true;let queue:Promise<void>=Promise.resolve();
  try{
   try{lock=await fs.open(lockname,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await lock.writeFile(canonical({binding,pid:process.pid}));await lock.sync();await root.sync();}
   catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')fail('EXTERNAL_FENCE_IN_PROGRESS','An existing durable operation lock requires ownership reconciliation');throw e}
   if(binding.authority_nonce!==null){
    const noncePath=path.join(anchor,'nonce-'+binding.authority_nonce+'.json');let nonce:fs.FileHandle|undefined;
    try{nonce=await fs.open(noncePath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await nonce.writeFile(canonical(binding));await nonce.sync();await root.sync()}
    catch(error){
     if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
     const prior=await fs.open(noncePath,constants.O_RDONLY|constants.O_NOFOLLOW);
     try{const stat=await prior.stat();if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.size>8192||await prior.readFile('utf8')!==canonical(binding))fail('EXTERNAL_FENCE_NONCE_CONFLICT','Isolation permit nonce already belongs to another durable operation')}finally{await prior.close()}
    }finally{await nonce?.close()}
   }
   let document:JournalDocument={schema_version:1,binding,authorizations:[{authority_digest:binding.authority_digest,authority_nonce:binding.authority_nonce}],resources:{}};
   try{
    const source=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const stat=await source.stat();if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)!==0||stat.uid!==process.getuid()||stat.size>1048576)fail('EXTERNAL_FENCE_JOURNAL_UNSAFE','Fence journal record is not a bounded private regular file');document=JSON.parse(await source.readFile('utf8')) as JournalDocument}
    finally{await source.close()}
    if(document.schema_version!==1||!object(document.binding)||canonical(coreBinding(document.binding))!==canonical(coreBinding(binding))||!Array.isArray(document.authorizations)||document.authorizations.length<1||document.authorizations.length>16||document.authorizations.some(a=>!object(a)||!digest(a.authority_digest)||a.authority_nonce!==null&&!uuid(a.authority_nonce))||!document.authorizations.some(a=>a.authority_digest===document.binding.authority_digest&&a.authority_nonce===document.binding.authority_nonce)||!object(document.resources))fail('EXTERNAL_FENCE_JOURNAL_CONFLICT','Fence operation already has a different immutable topology or epoch');
    for(const [key,row] of Object.entries(document.resources)){if(!object(row)||!object(row.binding)||key!==row.binding.reference_key||!['PREPARED','UNKNOWN','ISOLATED'].includes(row.state))fail('EXTERNAL_FENCE_JOURNAL_INVALID','Invalid durable isolation record');checkResourceBinding(row.binding);if(!Array.isArray(row.observations)||row.observations.length>8||row.observations.some(o=>!object(o)||!object(o.operation)||!object(o.outcome)))fail('EXTERNAL_FENCE_JOURNAL_INVALID','Invalid persisted provider observations');if(row.receipt)checkReceipt(row.receipt,binding,row.binding);if(row.state==='ISOLATED'&&row.receipt?.status!=='ISOLATED')fail('EXTERNAL_FENCE_JOURNAL_INVALID','Isolation record has no physical receipt')}
   }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
   if(!document.authorizations.some(a=>a.authority_digest===binding.authority_digest&&a.authority_nonce===binding.authority_nonce)){if(document.authorizations.length>=16)fail('EXTERNAL_FENCE_AUTHORIZATION_LIMIT','Isolation operation exhausted its bounded renewed authorization history');document.authorizations.push({authority_digest:binding.authority_digest,authority_nonce:binding.authority_nonce})}
   const save=async()=>{const text=canonical(document);if(Buffer.byteLength(text)>1048576)fail('EXTERNAL_FENCE_JOURNAL_LIMIT','Fence journal exceeds its bounded record size');const temp=filename+'.'+randomUUID()+'.tmp';const target=await fs.open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await target.writeFile(text);await target.sync()}finally{await target.close()}try{await fs.rename(temp,filename);await root.sync()}catch(e){try{await fs.unlink(temp)}catch{}throw e}};
   const serialize=<R>(fn:()=>Promise<R>):Promise<R>=>{const result=queue.then(()=>{if(!active)fail('EXTERNAL_FENCE_JOURNAL_CLOSED','Fence journal capability has expired');return fn()});queue=result.then(()=>{},()=>{});return result};
   const resource=(key:string):IsolationJournal=>{
    if(!name(key))fail('EXTERNAL_FENCE_INVALID','Invalid configured resource reference');
    return Object.freeze({
     read:()=>serialize(async()=>Object.hasOwn(document.resources,key)?structuredClone(document.resources[key]!):null),
     prepare:(value:IsolationJournalBinding)=>serialize(async()=>{
      checkResourceBinding(value);if(value.reference_key!==key||value.operation_id!==binding.operation_id)fail('EXTERNAL_FENCE_JOURNAL_CONFLICT','Resource journal reference does not match');
      const old=Object.hasOwn(document.resources,key)?document.resources[key]:undefined;if(old){if(canonical(old.binding)!==canonical(value))fail('EXTERNAL_FENCE_JOURNAL_CONFLICT','Provider resource identity changed under an existing fence operation');return {created:false,state:structuredClone(old)}}
      if(Object.keys(document.resources).length>=256)fail('EXTERNAL_FENCE_JOURNAL_LIMIT','Too many configured isolation resources');
      const row:IsolationJournalRecord={binding:structuredClone(value),state:'PREPARED',receipt:null,observations:[]};document.resources={...document.resources,[key]:row};await save();return {created:true,state:structuredClone(row)};
     }),
     record:(outcome:{binding:IsolationJournalBinding;receipt:WriterIsolationReceipt|null;observations:readonly {operation:unknown;outcome:unknown}[]})=>serialize(async()=>{
      const row=Object.hasOwn(document.resources,key)?document.resources[key]:undefined;if(!row)fail('EXTERNAL_FENCE_JOURNAL_UNPREPARED','Persist exact resource identity before any external effect');
      checkResourceBinding(outcome.binding);if(canonical(outcome.binding)!==canonical(row.binding))fail('EXTERNAL_FENCE_JOURNAL_CONFLICT','Observation cannot change an immutable resource identity');
      if(!Array.isArray(outcome.observations)||outcome.observations.length>8||outcome.observations.some(o=>!object(o)||!object(o.operation)||!object(o.outcome)))fail('EXTERNAL_FENCE_INVALID','Actual bounded provider operation observations required');
      const observations=[...row.observations,...outcome.observations].filter((v,i,all)=>all.findIndex(other=>canonical(other)===canonical(v))===i);
      if(observations.length>8)fail('EXTERNAL_FENCE_JOURNAL_LIMIT','Observation history exceeds its immutable bounded record');
      if(outcome.receipt)checkReceipt(outcome.receipt,binding,row.binding);
      document.resources={...document.resources,[key]:{binding:row.binding,state:outcome.receipt?.status==='ISOLATED'?'ISOLATED':'UNKNOWN',receipt:outcome.receipt?structuredClone(outcome.receipt):null,observations:structuredClone(observations)}};await save();
     })
    });
   };
   await save();
   return await body(resource);
  }finally{
   await queue;active=false;
   try{if(lock){await lock.close();await fs.unlink(lockname);await root.sync()}}finally{await root.close()}
  }
 }
}
function topology(value:ExternalFenceTopology):ExternalFenceTopology{
 if(!object(value)||value.schema_version!==1||!uuid(value.deployment_id)||!uuid(value.organisation_id)||!uuid(value.run_id)||!['LIVE_PROVIDER','COMPONENT_FIXTURE'].includes(value.evidence_scope)||value.source_epoch!==null&&!uuid(value.source_epoch)||!digest(value.legacy_topology_digest)||!/^pid:\[[0-9]+\]$/.test(value.legacy_pid_namespace)||!/^mnt:\[[0-9]+\]$/.test(value.legacy_mount_namespace)||!Array.isArray(value.required_writer_ids)||value.required_writer_ids.length===0||value.required_writer_ids.length>256||!value.required_writer_ids.every(name)||new Set(value.required_writer_ids).size!==value.required_writer_ids.length||!Array.isArray(value.resources)||value.resources.length===0||value.resources.length>256)fail('EXTERNAL_FENCE_CONFIG_INVALID','Trusted complete writer topology and namespace pins are required');
 const references=new Set<string>(),covered=new Set<string>();
 for(const r of value.resources){
  if(!object(r)||!name(r.reference_key)||references.has(r.reference_key)||!digest(r.topology_digest)||!['PROVIDER','OWNED_HOST'].includes(r.backend)||!Array.isArray(r.writer_ids)||r.writer_ids.length===0||!r.writer_ids.every(name))fail('EXTERNAL_FENCE_CONFIG_INVALID','Trusted resource topology contains an invalid or duplicate reference');
  references.add(r.reference_key);for(const id of r.writer_ids){if(!value.required_writer_ids.includes(id)||covered.has(id))fail('EXTERNAL_FENCE_CONFIG_INVALID','Every writer must have exactly one declared isolation boundary');covered.add(id)}
 }
 if(covered.size!==value.required_writer_ids.length)fail('EXTERNAL_FENCE_CONFIG_INCOMPLETE','Every configured writer route must have an actual isolation backend');
 return structuredClone(value);
}
/** Construct only in trusted deployment code. Request JSON cannot choose topology, backends, or journal paths. */
export function externalFenceTopologyDigest(config:ExternalFenceTopology):string{return hash(topology(config))}
export function createExternalWriterFence(config:ExternalFenceTopology,providers:ProviderIsolationBackend,legacy:LegacyWriterBackend,journal:FileExternalFenceJournal,authority:ExternalFenceAuthority,ownedHost?:ProviderIsolationBackend):ExternalWriterFence{
 const trusted=topology(config),configDigest=hash(trusted);
 if(trusted.evidence_scope!=='LIVE_PROVIDER')fail('EXTERNAL_FENCE_EVIDENCE_SCOPE_MISMATCH','Production authority activation requires live provider isolation evidence');
 if(!authority||!['INVOCATION','ISOLATION_PERMIT'].includes(authority.kind))fail('EXTERNAL_FENCE_AUTHORITY_REQUIRED','Actual invocation or verified isolation-only permit is required');
 const authorize=async(input:{deployment_id:string;operation_id:string;source_epoch:string|null;signal?:AbortSignal})=>{
  if(authority.kind==='ISOLATION_PERMIT'){
   const expected={deployment_id:input.deployment_id,operation_id:input.operation_id,organisation_id:trusted.organisation_id,run_id:trusted.run_id,source_epoch:input.source_epoch,topology_digest:configDigest};
   assertIsolationPermit(authority.permit,expected);
   const allowed=authority.permit.resources.map(r=>({reference_key:r.reference_key,topology_digest:r.topology_digest})).sort((a,b)=>a.reference_key.localeCompare(b.reference_key));
   const required=trusted.resources.map(r=>({reference_key:r.reference_key,topology_digest:r.topology_digest})).sort((a,b)=>a.reference_key.localeCompare(b.reference_key));
   if(canonical(allowed)!==canonical(required))fail('EXTERNAL_FENCE_AUTHORITY_DENIED','Isolation permit resource coverage must exactly match trusted topology');
   return {authority_digest:authority.permit.permit_digest,authority_nonce:authority.permit.nonce};
  }
  const i=authority.invocation;assertInvocation(i);
  if(!['OPERATOR','COORDINATOR','LEADER'].includes(i.principal.role)||i.principal.organisation_id!==trusted.organisation_id||i.principal.run_id!==trusted.run_id||i.principal.deployment_epoch!==input.source_epoch||i.operation.idempotency_key!==input.operation_id||i.payload.component!=='25.2'||i.payload.action!=='cutover.activate'||!object(i.payload.input)||i.payload.input.operation_id!==input.operation_id||i.payload.input.scope_id!==trusted.run_id)fail('EXTERNAL_FENCE_AUTHORITY_DENIED','Physical isolation must be bound to the genuine authorised activation invocation');
  await authority.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:0,...(input.signal?{signal:input.signal}:{})},async tx=>{assertPrimaryTransaction(tx);await i.guard(tx)});
  return {authority_digest:i.operation.payload_digest,authority_nonce:null};
 };
 if(!providers||typeof providers.isolateConfiguredResource!=='function'||!legacy||typeof legacy.disableAdmission!=='function'||typeof legacy.observeIsolation!=='function'||!(journal instanceof FileExternalFenceJournal))fail('EXTERNAL_FENCE_BACKEND_UNAVAILABLE','Actual provider, legacy observer, and durable journal are required');
 if(trusted.resources.some(r=>r.backend==='OWNED_HOST')&&(!ownedHost||typeof ownedHost.isolateConfiguredResource!=='function'))fail('EXTERNAL_FENCE_BACKEND_UNAVAILABLE','Owned main host or network writer routes need their actual isolation backend');
 const checkLegacy=(v:LegacyWriterReceipt,input:{deployment_id:string;operation_id:string;source_epoch:string|null},isolated:boolean)=>{
  if(!object(v)||v.deployment_id!==input.deployment_id||v.operation_id!==input.operation_id||v.source_epoch!==input.source_epoch||v.topology_digest!==trusted.legacy_topology_digest||!digest(v.evidence_digest)||v.visibility?.scope!=='CONFIGURED_PID_NAMESPACE'||v.visibility.pid_namespace!==trusted.legacy_pid_namespace||v.visibility.mount_namespace!==trusted.legacy_mount_namespace||v.status!==(isolated?'ISOLATED':'ADMISSION_DISABLED'))fail('EXTERNAL_FENCE_LEGACY_UNVERIFIED','Legacy observation does not cover the configured namespace and source');
  time(v.observed_at);
  if(isolated){if(v.admission_disabled!==true||v.writable_fds!==0||v.writable_shared_mappings!==0||!Number.isSafeInteger(v.read_only_aliases)||v.read_only_aliases!<1||!name(v.isolated_writer)||!v.expires_at)fail('EXTERNAL_FENCE_LEGACY_UNVERIFIED','Read-only storage and writer quiescence were not actually observed');checkFresh(v.observed_at,v.expires_at,Date.now())}
 };
 return Object.freeze({isolate:async(input:{deployment_id:string;operation_id:string;source_epoch:string|null;signal?:AbortSignal})=>{
  if(input.deployment_id!==trusted.deployment_id||input.source_epoch!==trusted.source_epoch||!uuid(input.operation_id))fail('EXTERNAL_FENCE_SCOPE_MISMATCH','Activation does not match the trusted deployment source epoch');
  input.signal?.throwIfAborted();
  const authorization=await authorize(input);
  return journal.withOperation({deployment_id:input.deployment_id,operation_id:input.operation_id,source_epoch:input.source_epoch,topology_digest:configDigest,...authorization},async resource=>{
   await authorize(input);
   const admission=await legacy.disableAdmission(input);checkLegacy(admission,input,false);
   const isolate=async(r:ExternalFenceTopology['resources'][number])=>{
    input.signal?.throwIfAborted();const custody=resource(r.reference_key),backend=r.backend==='PROVIDER'?providers:ownedHost!;
    let observed:WriterIsolationReceipt;
    try{observed=await backend.isolateConfiguredResource(r.reference_key,input.operation_id,input.signal,custody)}
    catch(e){const row=await custody.read();if(row?.state==='PREPARED')await custody.record({binding:row.binding,receipt:null,observations:[]});throw e}
    const persisted=await custody.read();
    if(!persisted||persisted.state!=='ISOLATED'||persisted.binding.topology_digest!==r.topology_digest||canonical(persisted.receipt)!==canonical(observed))fail('EXTERNAL_FENCE_OUTCOME_UNKNOWN','Actual provider isolation must be durably observed before activation');
    checkReceipt(observed,{deployment_id:input.deployment_id,operation_id:input.operation_id,source_epoch:input.source_epoch,topology_digest:configDigest,...authorization},persisted.binding);
    if(observed.evidence_scope!==trusted.evidence_scope)fail('EXTERNAL_FENCE_EVIDENCE_SCOPE_MISMATCH','Component fixture evidence cannot establish live provider isolation');
    if(observed.status!=='ISOLATED')fail('EXTERNAL_FENCE_OUTCOME_UNKNOWN','Unknown provider resources cannot establish isolation');
    return observed;
   };
   // First complete potentially slow destructive isolation; then refresh exact known resources without replaying effects.
   for(const r of trusted.resources)await isolate(r);
   const receipts:WriterIsolationReceipt[]=[];
   for(let index=0;index<trusted.resources.length;index+=8)receipts.push(...await Promise.all(trusted.resources.slice(index,index+8).map(isolate)));
   const legacyReceipt=await legacy.observeIsolation(input);checkLegacy(legacyReceipt,input,true);
   await authorize(input);
   const now=Date.now();for(const receipt of receipts)checkFresh(receipt.observed_at,receipt.expires_at,now);
   const observedAt=Math.max(...receipts.map(r=>time(r.observed_at)),time(legacyReceipt.observed_at)),expiresAt=Math.min(...receipts.map(r=>time(r.expires_at)),time(legacyReceipt.expires_at!),observedAt+30000);
   if(expiresAt<=now)fail('EXTERNAL_FENCE_STALE','Full writer coverage was not observed within one proof interval');
   return {deployment_id:input.deployment_id,operation_id:input.operation_id,source_epoch:input.source_epoch,fence_id:input.operation_id,isolated_writer:'topology:'+configDigest.slice(7),observed_at:new Date(observedAt).toISOString(),expires_at:new Date(expiresAt).toISOString(),evidence_digest:hash({topology_digest:configDigest,required_writer_ids:trusted.required_writer_ids,admission,resources:receipts,legacy:legacyReceipt})};
  });
 }});
}
