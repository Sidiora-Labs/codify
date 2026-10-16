import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {FoundationError,object} from '../policy/programme.js';

export interface ExternalAuthorityAttestation {
 deployment_id:string;epoch:string;sequence:string;evidence_digest:string;observed_at:string;expires_at:string;
}
export interface AuthorityJournalPreparation {
 deployment_id:string;operation_id:string;expected_previous_epoch:string|null;expected_database_epoch?:string|null;fence_evidence_digest:string;signal?:AbortSignal;
}
export interface AuthorityJournalPublication {
 deployment_id:string;operation_id:string;expected_previous_epoch:string|null;database_predecessor_epoch?:string|null;epoch:string;signal?:AbortSignal;
}
export interface CommittedAuthorityEvidence {
 deployment_id:string;operation_id:string;previous_epoch:string|null;database_predecessor_epoch:string|null;epoch:string;evidence_digest:string;
}
export type VerifyCommittedAuthority=(input:AuthorityJournalPublication)=>Promise<CommittedAuthorityEvidence>;
export interface PreparedAuthorityActivation {deployment_id:string;operation_id:string;expected_previous_epoch:string|null;expected_database_epoch:string|null;epoch:string;sequence:string;replayed:boolean}
export interface ExternalAuthorityJournal {
 current(input:{deployment_id:string;signal?:AbortSignal}):Promise<ExternalAuthorityAttestation>;
 prepareActivation(input:AuthorityJournalPreparation):Promise<PreparedAuthorityActivation>;
 publishCommitted(input:AuthorityJournalPublication):Promise<ExternalAuthorityAttestation>;
}
interface ActivationRecord {operation_id:string;previous_epoch:string|null;database_predecessor_epoch:string|null;epoch:string;sequence:string;fence_evidence_digest:string;commit_evidence_digest:string;previous_head_digest:string;head_digest:string}
interface Document {
 schema_version:1;deployment_id:string;state:'PENDING'|'ACTIVE';epoch:string|null;sequence:string;
 pending:{operation_id:string;expected_previous_epoch:string|null;expected_database_epoch:string|null;epoch:string;fence_evidence_digest:string;candidate_digests:string[]}|null;
 history:ActivationRecord[];head_digest:string;document_digest:string;
}
interface ProcessIdentity {hostname:string;machine_id:string;boot_id:string;pid_namespace:string;mount_namespace:string;pid:number;start_time:string}
const MAX_BYTES=4*1024*1024,MAX_HISTORY=4096;
function fail(code:string,message:string):never{throw new FoundationError(code,message)}
function canonical(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}'}
function hash(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex')}
function uuid(v:unknown):v is string{return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)}
function digest(v:unknown):v is string{return typeof v==='string'&&/^sha256:[0-9a-f]{64}$/.test(v)}
function decimal(v:unknown):v is string{return typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&BigInt(v)<=9223372036854775807n}
function identity(input:{deployment_id:string;operation_id?:string;expected_previous_epoch?:string|null;signal?:AbortSignal}):void{
 input.signal?.throwIfAborted();
 if(!uuid(input.deployment_id)||input.operation_id!==undefined&&!uuid(input.operation_id)||input.expected_previous_epoch!==undefined&&input.expected_previous_epoch!==null&&!uuid(input.expected_previous_epoch))fail('EXTERNAL_AUTHORITY_INVALID','Canonical deployment, operation, and epoch identities required');
}
async function processStart(pid:number):Promise<string|null>{
 try{const stat=await fs.readFile('/proc/'+pid+'/stat','utf8');const end=stat.lastIndexOf(')');const value=stat.slice(end+2).trim().split(/\s+/)[19];if(end<1||!value||!/^\d+$/.test(value))fail('EXTERNAL_AUTHORITY_UNVERIFIABLE','Kernel process identity could not be inspected');return value}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
}
async function selfIdentity():Promise<ProcessIdentity>{
 const [machine,boot,pidns,mountns,start]=await Promise.all([fs.readFile('/etc/machine-id','utf8'),fs.readFile('/proc/sys/kernel/random/boot_id','utf8'),fs.readlink('/proc/self/ns/pid'),fs.readlink('/proc/self/ns/mnt'),processStart(process.pid)]);
 if(!start)fail('EXTERNAL_AUTHORITY_UNVERIFIABLE','Current kernel process identity is unavailable');
 return {hostname:os.hostname(),machine_id:machine.trim(),boot_id:boot.trim(),pid_namespace:pidns,mount_namespace:mountns,pid:process.pid,start_time:start};
}
function documentDigest(document:Document):string{const {document_digest:_,...body}=document;return hash(body)}
function validate(document:Document,deployment:string):void{
 if(!object(document)||document.schema_version!==1||document.deployment_id!==deployment||!['PENDING','ACTIVE'].includes(document.state)||!decimal(document.sequence)||document.epoch!==null&&!uuid(document.epoch)||!Array.isArray(document.history)||document.history.length>MAX_HISTORY||!digest(document.head_digest)||document.document_digest!==documentDigest(document))fail('EXTERNAL_AUTHORITY_CORRUPT','External authority journal is invalid or changed');
 let previous=hash({deployment_id:deployment,initial:true}),epoch:string|null=null;const operations=new Set<string>(),epochs=new Set<string>();
 for(let index=0;index<document.history.length;index++){
  const record=document.history[index]!;
  if(!object(record)||!uuid(record.operation_id)||!uuid(record.epoch)||record.previous_epoch!==null&&!uuid(record.previous_epoch)||record.database_predecessor_epoch!==null&&!uuid(record.database_predecessor_epoch)||record.sequence!==String(index+1)||!digest(record.fence_evidence_digest)||!digest(record.commit_evidence_digest)||record.previous_head_digest!==previous)fail('EXTERNAL_AUTHORITY_CORRUPT','External epoch history is discontinuous');
  const {head_digest:_,...body}=record;if(record.head_digest!==hash(body)||index>0&&record.previous_epoch!==epoch)fail('EXTERNAL_AUTHORITY_CORRUPT','External epoch history does not match its accepted head');
  if(operations.has(record.operation_id)||epochs.has(record.epoch))fail('EXTERNAL_AUTHORITY_CORRUPT','External history reuses an operation or authority epoch');
  operations.add(record.operation_id);epochs.add(record.epoch);
  previous=record.head_digest;epoch=record.epoch;
 }
 if(document.sequence!==String(document.history.length)||document.head_digest!==previous||document.history.length>0&&document.epoch!==epoch)fail('EXTERNAL_AUTHORITY_CORRUPT','External authority sequence or epoch differs from its accepted history');
 if(document.state==='ACTIVE'&&(!uuid(document.epoch)||document.pending!==null||document.history.length===0)||document.state==='PENDING'&&(!object(document.pending)||!uuid(document.pending.operation_id)||document.pending.expected_previous_epoch!==null&&!uuid(document.pending.expected_previous_epoch)||document.pending.expected_database_epoch!==null&&!uuid(document.pending.expected_database_epoch)||!uuid(document.pending.epoch)||document.history.some(row=>row.epoch===document.pending!.epoch)||!digest(document.pending.fence_evidence_digest)||!Array.isArray(document.pending.candidate_digests)||document.pending.candidate_digests.length<1||document.pending.candidate_digests.length>16||!document.pending.candidate_digests.every(digest)||new Set(document.pending.candidate_digests).size!==document.pending.candidate_digests.length||!document.pending.candidate_digests.includes(document.pending.fence_evidence_digest)))fail('EXTERNAL_AUTHORITY_CORRUPT','External activation custody is inconsistent');
 if(document.pending&&document.history.length>0&&document.pending.expected_previous_epoch!==document.epoch)fail('EXTERNAL_AUTHORITY_CORRUPT','Pending activation does not extend the accepted epoch');
}
/** Store on an independently retained private local volume, outside every database restore.
 * This backend establishes the PostgreSQL-restore boundary. It does not claim whole-host recovery.
 */
export class FileExternalAuthorityJournal implements ExternalAuthorityJournal {
 constructor(private readonly directory:string,private readonly verifyCommitted:VerifyCommittedAuthority){
  if(typeof verifyCommitted!=='function')fail('EXTERNAL_AUTHORITY_VERIFIER_REQUIRED','Actual positive committed-operation verification is required');
 }
 private async root():Promise<fs.FileHandle>{
  if(!path.isAbsolute(this.directory)||path.resolve(this.directory)!==this.directory)fail('EXTERNAL_AUTHORITY_PATH_UNSAFE','Canonical absolute external journal directory required');
  const stat=await fs.lstat(this.directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||typeof process.getuid!=='function'||stat.uid!==process.getuid()||await fs.realpath(this.directory)!==this.directory)fail('EXTERNAL_AUTHORITY_PATH_UNSAFE','External authority directory must be private, owned, and independent of database restoration');
  const handle=await fs.open(this.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const opened=await handle.stat();if(opened.dev!==stat.dev||opened.ino!==stat.ino){await handle.close();fail('EXTERNAL_AUTHORITY_PATH_CHANGED','External journal directory changed during validation')}
  return handle;
 }
 private async read(root:fs.FileHandle,deployment:string):Promise<Document|null>{
  const file='/proc/self/fd/'+root.fd+'/'+deployment+'.authority.json';let source:fs.FileHandle|undefined;
  try{
   source=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await source.stat();
   if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid!()||(stat.mode&0o077)!==0||stat.size>MAX_BYTES)fail('EXTERNAL_AUTHORITY_PATH_UNSAFE','External journal head is not a bounded private regular file');
   const document=JSON.parse(await source.readFile('utf8')) as Document;validate(document,deployment);return document;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
  finally{await source?.close()}
 }
 private async write(root:fs.FileHandle,document:Document):Promise<void>{
  document.document_digest=documentDigest(document);validate(document,document.deployment_id);
  const bytes=canonical(document);if(Buffer.byteLength(bytes)>MAX_BYTES)fail('EXTERNAL_AUTHORITY_LIMIT','External authority history requires deliberate archival before further activation');
  const target='/proc/self/fd/'+root.fd+'/'+document.deployment_id+'.authority.json',temporary=target+'.'+randomUUID()+'.tmp';
  const file=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(bytes);await file.sync()}finally{await file.close()}
  try{await fs.rename(temporary,target);await root.sync()}catch(error){try{await fs.unlink(temporary)}catch{}throw error}
 }
 private async lock<T>(root:fs.FileHandle,deployment:string,body:()=>Promise<T>):Promise<T>{
  const directory='/proc/self/fd/'+root.fd+'/'+deployment+'.authority.lock',self=await selfIdentity();let acquired=false;
  for(let attempt=0;attempt<2;attempt++){
   try{await fs.mkdir(directory,{mode:0o700});acquired=true;break}
   catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.uid!==process.getuid!())fail('EXTERNAL_AUTHORITY_LOCK_UNSAFE','Authority lock is not a private owned directory');
    const entries=await fs.readdir(directory);if(entries.length!==1||!/^owner-[0-9a-f-]{36}\.json$/.test(entries[0]!))fail('EXTERNAL_AUTHORITY_BUSY','Authority lock has unverifiable ownership');
    const ownerFile=path.join(directory,entries[0]!),owner=await fs.open(ownerFile,constants.O_RDONLY|constants.O_NOFOLLOW);let prior:ProcessIdentity;
    try{const owned=await owner.stat();if(!owned.isFile()||owned.size>4096||owned.uid!==process.getuid!()||(owned.mode&0o077)!==0)fail('EXTERNAL_AUTHORITY_LOCK_UNSAFE','Authority lock owner is not a private bounded record');prior=JSON.parse(await owner.readFile('utf8')) as ProcessIdentity}finally{await owner.close()}
    if(!object(prior)||prior.hostname!==self.hostname||prior.machine_id!==self.machine_id||prior.boot_id!==self.boot_id||prior.pid_namespace!==self.pid_namespace||prior.mount_namespace!==self.mount_namespace||!Number.isSafeInteger(prior.pid)||prior.pid<1||typeof prior.start_time!=='string'||!/^\d+$/.test(prior.start_time))fail('EXTERNAL_AUTHORITY_BUSY','A different host, boot, or namespace owns the authority lock');
    const observed=await processStart(prior.pid);if(observed===prior.start_time)fail('EXTERNAL_AUTHORITY_BUSY','The actual authority lock owner is still alive');
    // Unique owner filename prevents two reclaimers from removing a newly acquired owner.
    try{await fs.unlink(ownerFile);await fs.rmdir(directory);await root.sync()}catch(error){if(['ENOENT','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))fail('EXTERNAL_AUTHORITY_BUSY','Authority lock ownership changed during dead-process reconciliation');throw error}
   }
  }
  if(!acquired)fail('EXTERNAL_AUTHORITY_BUSY','Authority transition is already executing');
  const ownerName='owner-'+randomUUID()+'.json',ownerPath=path.join(directory,ownerName);let ownerCreated=false;
  try{
   const owner=await fs.open(ownerPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);ownerCreated=true;
   try{await owner.writeFile(canonical(self));await owner.sync()}finally{await owner.close()}
   const lockDirectory=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await lockDirectory.sync()}finally{await lockDirectory.close()}await root.sync();
   return await body();
  }finally{
   if(ownerCreated)await fs.unlink(ownerPath);
   await fs.rmdir(directory);await root.sync();
  }
 }
 private attestation(document:Document):ExternalAuthorityAttestation{
  if(document.state!=='ACTIVE'||!document.epoch)fail('EXTERNAL_AUTHORITY_PENDING','Activation outcome is pending; positive committed-operation reconciliation is required');
  const observed=new Date(),expires=new Date(observed.getTime()+10000);
  return {deployment_id:document.deployment_id,epoch:document.epoch,sequence:document.sequence,evidence_digest:document.history[document.history.length-1]!.commit_evidence_digest,observed_at:observed.toISOString(),expires_at:expires.toISOString()};
 }
 async current(input:{deployment_id:string;signal?:AbortSignal}):Promise<ExternalAuthorityAttestation>{
  identity(input);const root=await this.root();
  try{const document=await this.read(root,input.deployment_id);input.signal?.throwIfAborted();if(!document)fail('EXTERNAL_AUTHORITY_UNAVAILABLE','No independent accepted authority exists');return this.attestation(document)}finally{await root.close()}
 }
 async prepareActivation(input:AuthorityJournalPreparation):Promise<PreparedAuthorityActivation>{
  identity(input);const databasePrevious=input.expected_database_epoch===undefined?input.expected_previous_epoch:input.expected_database_epoch;if(databasePrevious!==null&&!uuid(databasePrevious))fail('EXTERNAL_AUTHORITY_INVALID','Canonical database predecessor epoch required');if(!digest(input.fence_evidence_digest))fail('EXTERNAL_AUTHORITY_INVALID','Actual external fence evidence digest required');
  const root=await this.root();
  try{return await this.lock(root,input.deployment_id,async()=>{
   input.signal?.throwIfAborted();let document=await this.read(root,input.deployment_id);
   if(document?.state==='PENDING'){
    if(document.pending!.operation_id!==input.operation_id||document.pending!.expected_previous_epoch!==input.expected_previous_epoch||document.pending!.expected_database_epoch!==databasePrevious)fail('EXTERNAL_AUTHORITY_PENDING','A different activation still has unresolved external custody');
    if(!document.pending!.candidate_digests.includes(input.fence_evidence_digest)){
     if(document.pending!.candidate_digests.length>=16)fail('EXTERNAL_AUTHORITY_CANDIDATE_LIMIT','Pending activation has exhausted its bounded fence proof candidates');
     document.pending!.candidate_digests.push(input.fence_evidence_digest);document.pending!.fence_evidence_digest=input.fence_evidence_digest;await this.write(root,document);
    }
    return {deployment_id:input.deployment_id,operation_id:input.operation_id,expected_previous_epoch:input.expected_previous_epoch,expected_database_epoch:databasePrevious,epoch:document.pending!.epoch,sequence:(BigInt(document.sequence)+1n).toString(),replayed:true};
   }
   const completed=document?.history.find(row=>row.operation_id===input.operation_id);
   if(completed){if(completed.previous_epoch!==input.expected_previous_epoch||completed.database_predecessor_epoch!==databasePrevious)fail('EXTERNAL_AUTHORITY_CONFLICT','Accepted operation has different prior authority');return {deployment_id:input.deployment_id,operation_id:input.operation_id,expected_previous_epoch:input.expected_previous_epoch,expected_database_epoch:databasePrevious,epoch:completed.epoch,sequence:completed.sequence,replayed:true}}
   if(!document&&(input.expected_previous_epoch!==null||databasePrevious!==null))fail('EXTERNAL_AUTHORITY_UNAVAILABLE','A missing external journal cannot reconstruct an accepted epoch from the database');
   if(document&&document.epoch!==input.expected_previous_epoch)fail('EXTERNAL_AUTHORITY_STALE','Activation source differs from the independent accepted epoch');
   if(document&&document.history.length>=MAX_HISTORY)fail('EXTERNAL_AUTHORITY_LIMIT','External authority journal requires deliberate archival');
   document??={schema_version:1,deployment_id:input.deployment_id,state:'PENDING',epoch:null,sequence:'0',pending:null,history:[],head_digest:hash({deployment_id:input.deployment_id,initial:true}),document_digest:''};
   document.state='PENDING';document.pending={operation_id:input.operation_id,expected_previous_epoch:input.expected_previous_epoch,expected_database_epoch:databasePrevious,epoch:randomUUID(),fence_evidence_digest:input.fence_evidence_digest,candidate_digests:[input.fence_evidence_digest]};await this.write(root,document);
   return {deployment_id:input.deployment_id,operation_id:input.operation_id,expected_previous_epoch:input.expected_previous_epoch,expected_database_epoch:databasePrevious,epoch:document.pending!.epoch,sequence:(BigInt(document.sequence)+1n).toString(),replayed:false};
  })}finally{await root.close()}
 }
 async publishCommitted(input:AuthorityJournalPublication):Promise<ExternalAuthorityAttestation>{
  identity(input);const databasePrevious=input.database_predecessor_epoch===undefined?input.expected_previous_epoch:input.database_predecessor_epoch;if(databasePrevious!==null&&!uuid(databasePrevious))fail('EXTERNAL_AUTHORITY_INVALID','Canonical database predecessor epoch required');if(!uuid(input.epoch)||input.epoch===input.expected_previous_epoch)fail('EXTERNAL_AUTHORITY_INVALID','A fresh committed epoch is required');
  // Verification is a trusted primary operation lookup, never an input boolean or an absence inference.
  const proof=await this.verifyCommitted(input);
  if(!object(proof)||proof.deployment_id!==input.deployment_id||proof.operation_id!==input.operation_id||proof.previous_epoch!==input.expected_previous_epoch||proof.database_predecessor_epoch!==databasePrevious||proof.epoch!==input.epoch||!digest(proof.evidence_digest))fail('EXTERNAL_AUTHORITY_COMMIT_UNVERIFIED','Actual positive committed activation evidence is required');
  input.signal?.throwIfAborted();const root=await this.root();
  try{return await this.lock(root,input.deployment_id,async()=>{
   input.signal?.throwIfAborted();const document=await this.read(root,input.deployment_id);
   if(!document)fail('EXTERNAL_AUTHORITY_UNPREPARED','No durable pre-commit activation custody exists');
   const completed=document.history.find(row=>row.operation_id===input.operation_id);
   if(completed){if(completed.epoch!==input.epoch||completed.previous_epoch!==input.expected_previous_epoch||completed.database_predecessor_epoch!==databasePrevious||document.epoch!==input.epoch||document.state!=='ACTIVE')fail('EXTERNAL_AUTHORITY_STALE','Accepted activation is no longer the current authority');return this.attestation(document)}
   if(document.state!=='PENDING'||document.pending!.operation_id!==input.operation_id||document.pending!.expected_previous_epoch!==input.expected_previous_epoch||document.pending!.expected_database_epoch!==databasePrevious||document.pending!.epoch!==input.epoch)fail('EXTERNAL_AUTHORITY_CONFLICT','Committed activation does not match durable pending custody');
   if(!document.pending!.candidate_digests.includes(proof.evidence_digest))fail('EXTERNAL_AUTHORITY_COMMIT_UNVERIFIED','Committed proof does not match any durably prepared fence candidate');
   if(document.history.some(row=>row.epoch===input.epoch))fail('EXTERNAL_AUTHORITY_REUSED_EPOCH','Authority epochs cannot be reused after restoration');
   const sequence=(BigInt(document.sequence)+1n).toString();
   const body={operation_id:input.operation_id,previous_epoch:input.expected_previous_epoch,database_predecessor_epoch:databasePrevious,epoch:input.epoch,sequence,fence_evidence_digest:proof.evidence_digest,commit_evidence_digest:proof.evidence_digest,previous_head_digest:document.head_digest};
   const record={...body,head_digest:hash(body)};document.history.push(record);document.epoch=input.epoch;document.sequence=sequence;document.head_digest=record.head_digest;document.state='ACTIVE';document.pending=null;
   await this.write(root,document);return this.attestation(document);
  })}finally{await root.close()}
 }
}
