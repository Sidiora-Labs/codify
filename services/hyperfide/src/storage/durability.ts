import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {FoundationError,object} from '../policy/programme.js';
import type {Component,ComponentContext} from '../components/registry.js';
import type {ServiceResources} from './runtime.js';
import {StorageError,assertPrimaryTransaction,bounded,deadlineFrom} from './transactions.js';
import {FileExternalAuthorityJournal} from './authority_journal.js';
import type {ExternalAuthorityJournal,ExternalAuthorityAttestation} from './authority_journal.js';
import type {PrimaryTransaction,QuerySession,TransactionOptions} from './transactions.js';

export interface MigrationDefinition {version:number;name:string;checksum:string;sql:string}
const DIRECTORY=fileURLToPath(new URL('../../migrations/',import.meta.url));
const digest=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
export async function discoverMigrations(directory=DIRECTORY):Promise<readonly MigrationDefinition[]>{
 const root=await fs.realpath(directory),result:MigrationDefinition[]=[];let total=0;
 for(const name of (await fs.readdir(root)).sort()){
  if(!name.endsWith('.sql'))continue;
  const match=/^([0-9]{4})-([a-z][a-z0-9-]*)\.sql$/.exec(name);
  if(!match||Number(match[1])<1)throw new FoundationError('MIGRATION_INVALID','Invalid numeric migration filename');
  const info=await fs.lstat(path.join(root,name));
  if(!info.isFile()||info.isSymbolicLink()||info.size>4*1024*1024||(total+=info.size)>32*1024*1024)
   throw new FoundationError('MIGRATION_INVALID','Migration sources must be bounded regular files');
  const bytes=await fs.readFile(path.join(root,name));let sql:string;
  try{sql=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new FoundationError('MIGRATION_INVALID','Migration source must be exact UTF-8');}
  result.push(Object.freeze({version:Number(match[1]),name:name.slice(0,-4),checksum:digest(sql),sql}));
 }
 result.sort((a,b)=>a.version-b.version);
 if(!result.length||result.length>128||new Set(result.map(row=>row.version)).size!==result.length)
  throw new FoundationError('MIGRATION_INVALID','Migration inventory is empty, excessive or contains duplicate versions');
 return Object.freeze(result);
}

// Files are trusted release artifacts, but may never terminate their owning transaction.
export function assertMigrationSource(sql:string):void{
 let mode='normal',tag='',depth=0,statement='',escape=false;
 const inspect=()=>{
  const first=/^\s*([A-Za-z]+)/.exec(statement)?.[1]?.toUpperCase();
  if(first&&['BEGIN','START','COMMIT','END','ROLLBACK','ABORT','SAVEPOINT','RELEASE','PREPARE','SET','RESET','DISCARD','VACUUM','COPY'].includes(first))
   throw new FoundationError('MIGRATION_INVALID','Migration transaction/session control and external COPY are forbidden');
  if(/^\s*ALTER\s+SYSTEM\b/i.test(statement))throw new FoundationError('MIGRATION_INVALID','ALTER SYSTEM is not a transactional migration');
  statement='';
 };
 for(let i=0;i<sql.length;i++){
  const c=sql[i]!,n=sql[i+1];
  if(mode==='line'){if(c==='\n'){mode='normal';statement+=' ';}continue;}
  if(mode==='block'){if(c==='/'&&n==='*'){depth++;i++;}else if(c==='*'&&n==='/'){i++;if(--depth===0)mode='normal';}continue;}
  if(mode==='single'){if(c==='\\'&&escape){i++;continue;}if(c==="'"){if(n==="'")i++;else mode='normal';}continue;}
  if(mode==='double'){if(c==='"'){if(n==='"')i++;else mode='normal';}continue;}
  if(mode==='dollar'){if(sql.startsWith(tag,i)){i+=tag.length-1;mode='normal';}continue;}
  if(c==='-'&&n==='-'){mode='line';statement+=' ';i++;continue;}
  if(c==='/'&&n==='*'){mode='block';depth=1;statement+=' ';i++;continue;}
  if(c===';'){inspect();continue;}
  if(c==="'"){escape=i>0&&/[eE]/.test(sql[i-1]!)&&(i<2||!/[A-Za-z0-9_$]/.test(sql[i-2]!));mode='single';statement+=' VALUE ';continue;}
  if(c==='"'){mode='double';statement+=' IDENT ';continue;}
  if(c==='$'){const match=/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));if(match){tag=match[0];mode='dollar';i+=tag.length-1;statement+=' VALUE ';continue;}}
  statement+=c;
 }
 if(!['normal','line'].includes(mode))throw new FoundationError('MIGRATION_INVALID','Unterminated migration SQL token');
 inspect();
}

interface Applied {version:number;name:string;checksum:string}
function inspectHistory(files:readonly MigrationDefinition[],rows:Applied[]):MigrationDefinition[]{
 const known=new Map(files.map(row=>[row.version,row]));
 for(const row of rows){
  const source=known.get(row.version);
  if(!source||source.name!==row.name||source.checksum!==row.checksum)
   throw new FoundationError('MIGRATION_DRIFT','Applied migration is unknown or its exact source changed');
 }
 const applied=new Set(rows.map(row=>row.version)),highest=Math.max(0,...applied);
 const pending=files.filter(row=>!applied.has(row.version));
 if(pending.some(row=>row.version<highest))throw new FoundationError('MIGRATION_ORDER_INVALID','A lower migration was inserted below an applied version');
 return pending;
}
async function history(session:QuerySession):Promise<Applied[]>{
 if(!(await session.query<{exists:string|null}>("SELECT to_regclass('hyperfide.schema_migrations')::text AS exists")).rows[0]?.exists)return [];
 return (await session.query<Applied>('SELECT version,name,checksum FROM hyperfide.schema_migrations ORDER BY version')).rows;
}
async function isolationPostflight(session:QuerySession):Promise<void>{
 const missing=await session.query<{name:string}>(
  "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hyperfide' AND c.relkind IN ('r','p') AND c.relname<>'schema_migrations' AND NOT EXISTS("+
  "SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace f ON f.oid=p.pronamespace WHERE t.tgrelid=c.oid AND t.tgenabled IN ('O','A') AND f.nspname='hyperfide' AND p.proname='require_authority_isolation' GROUP BY t.tgrelid HAVING (bit_or(t.tgtype::integer)&28)=28)");
 if(missing.rows.length)throw new FoundationError('MIGRATION_GUARD_MISSING','Authority tables lack required isolation guards: '+missing.rows.map(row=>row.name).join(','));
}
export class MigrationCoordinator {
 constructor(private readonly resources:ServiceResources,private readonly directory=DIRECTORY){}
 async inspect():Promise<{ready:boolean;applied:Applied[];pending:number[]}>{
  const files=await discoverMigrations(this.directory);
  return (await this.resources.observe({preferReplica:false},async session=>{
   const rows=await history(session),pending=inspectHistory(files,rows);
   return {ready:pending.length===0,applied:rows,pending:pending.map(row=>row.version)};
  })).value;
 }
 async apply(options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<{applied:number[];alreadyApplied:number[]}>{
  const files=await discoverMigrations(this.directory);
  for(const migration of files)assertMigrationSource(migration.sql);
  return this.resources.withMigrationConnection({...options,timeoutMs:options.timeoutMs??30000},async session=>{
   let locked=false;
   try{
    while(!locked){
     locked=(await session.query<{locked:boolean}>('SELECT pg_try_advisory_lock(1945824101,1) AS locked')).rows[0]?.locked===true;
     if(!locked){if(session.remainingMs()<25)throw new StorageError('TX_TIMEOUT','Migration session lock deadline expired');await new Promise(resolve=>setTimeout(resolve,Math.min(25,session.remainingMs())));}
    }
    const recovery=(await session.query<{recovery:boolean}>('SELECT pg_is_in_recovery() AS recovery')).rows[0]?.recovery;
    if(recovery)throw new FoundationError('PRIMARY_REQUIRED','Migrations require the primary');
    const prior=await history(session),pending=inspectHistory(files,prior),applied:number[]=[];
    for(const migration of pending){
     let commitSent=false;
     try{
      await session.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await session.query(migration.sql);
      await isolationPostflight(session);
      await session.query('INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[migration.version,migration.name,migration.checksum]);
      await session.query("SET LOCAL synchronous_commit='on'");
      commitSent=true;await session.query('COMMIT');applied.push(migration.version);
     }catch(error){
      if(commitSent)throw new StorageError('MIGRATION_COMMIT_AMBIGUOUS','Reacquire migration lock and reconcile exact history before replay','unknown');
      try{await session.query('ROLLBACK');}catch{/* Session is destroyed by its resource owner. */}
      throw error;
     }
    }
    return {applied,alreadyApplied:prior.map(row=>row.version)};
   }finally{if(locked)try{await session.query('SELECT pg_advisory_unlock(1945824101,1)');}catch{/* Connection close releases session lock. */}}
  });
 }
}
export async function assertMigrationReady(resources:ServiceResources,version:number,name:string,checksum:string):Promise<void>{
 const row=(await resources.observe({preferReplica:false},session=>session.query<Applied>('SELECT version,name,checksum FROM hyperfide.schema_migrations WHERE version=$1',[version]))).value.rows[0];
 if(!row||row.name!==name||row.checksum!==checksum)throw new FoundationError('MIGRATION_NOT_READY','Required exact migration is unavailable');
}
export interface AuthorityScope {organisation_id:string;run_id:string;authority_epoch:string}
export interface FenceReceipt {deployment_id:string;operation_id:string;fence_id:string;source_epoch:string|null;isolated_writer:string;observed_at:string;expires_at:string;evidence_digest:string}
export interface ExternalWriterFence {
 isolate(input:{deployment_id:string;operation_id:string;source_epoch:string|null;signal?:AbortSignal}):Promise<FenceReceipt>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export async function assertCurrentAuthority(tx:PrimaryTransaction,scope:AuthorityScope&{deployment_id:string}):Promise<void>{
 if(!uuid.test(scope.deployment_id))throw new FoundationError('AUTHORITY_CONFIG_INVALID','Trusted deployment identity is required');
  assertPrimaryTransaction(tx);
  if(!uuid.test(scope.organisation_id)||!uuid.test(scope.run_id)||!uuid.test(scope.authority_epoch))
   throw new FoundationError('INVALID_REQUEST','Exact authority scope is required');
  const row=(await tx.query<{epoch:string}>("SELECT epoch FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE' FOR SHARE",[scope.deployment_id])).rows[0];
  const run=(await tx.query<{authority_epoch:string}>('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,scope.run_id])).rows[0];
  if(!row||row.epoch!==scope.authority_epoch||run?.authority_epoch!==scope.authority_epoch)
   throw new FoundationError('STALE_AUTHORITY','Current externally activated deployment and run epochs are required');
}

export async function lookupAuthorityActivation(resources:ServiceResources,input:{
 deployment_id:string;operation_id:string;expected_previous_epoch:string|null;epoch?:string;
 database_predecessor_epoch?:string|null;signal?:AbortSignal;timeoutMs?:number
}):Promise<{deployment_id:string;operation_id:string;previous_epoch:string|null;database_predecessor_epoch:string|null;epoch:string;evidence_digest:string}>{
 if(!uuid.test(input.deployment_id)||!uuid.test(input.operation_id))throw new FoundationError('INVALID_REQUEST','Exact activation lookup identity is required');
 return (await resources.observe({preferReplica:false,...(input.timeoutMs===undefined?{}:{timeoutMs:input.timeoutMs}),...(input.signal?{signal:input.signal}:{})},async session=>{
  const row=(await session.query<{epoch:string;request_digest:string;previous_epoch:string|null;database_predecessor_epoch:string|null;activation_kind:string;proof_digest:string;state:string;recovery:boolean}>(
   "SELECT a.epoch::text,a.request_digest,e.previous_epoch::text,e.database_predecessor_epoch::text,e.activation_kind,e.proof_digest,e.state,pg_is_in_recovery() AS recovery FROM hyperfide.authority_activations a JOIN hyperfide.authority_epochs e ON e.deployment_id=a.deployment_id AND e.epoch=a.epoch WHERE a.deployment_id=$1 AND a.operation_id=$2",[input.deployment_id,input.operation_id])).rows[0];
  if(!row)throw new FoundationError('AUTHORITY_OPERATION_UNCONFIRMED','No positive primary activation receipt is available; absence cannot abandon PENDING');
  if(row.recovery)throw new FoundationError('PRIMARY_REQUIRED','Only the actual primary may reconcile authority activation');
  const databasePrevious=input.database_predecessor_epoch===undefined?input.expected_previous_epoch:input.database_predecessor_epoch;
  const expected=row.activation_kind==='RESTORE'?
   digest(JSON.stringify({deployment_id:input.deployment_id,operation_id:input.operation_id,expected_external_epoch:input.expected_previous_epoch,expected_database_epoch:databasePrevious,mode:'RESTORE'})):
   digest(JSON.stringify({deployment_id:input.deployment_id,operation_id:input.operation_id,expected_previous_epoch:input.expected_previous_epoch}));
  if(row.request_digest!==expected||row.previous_epoch!==input.expected_previous_epoch||row.database_predecessor_epoch!==databasePrevious||(input.epoch!==undefined&&input.epoch!==row.epoch))
   throw new FoundationError('AUTHORITY_CONFLICT','Positive activation receipt differs from the exact persisted operation and both predecessor identities');
  if(row.state!=='ACTIVE')throw new FoundationError('STALE_AUTHORITY','Activation was superseded; it cannot reopen authority');
  return {deployment_id:input.deployment_id,operation_id:input.operation_id,previous_epoch:row.previous_epoch,database_predecessor_epoch:row.database_predecessor_epoch,epoch:row.epoch,evidence_digest:row.proof_digest};
 })).value;
}
export async function assertExternalAuthorityCurrent(resources:ServiceResources,journal:ExternalAuthorityJournal,input:{deployment_id:string;timeoutMs?:number;signal?:AbortSignal}):Promise<ExternalAuthorityAttestation>{
 if(!uuid.test(input.deployment_id)||!journal||typeof journal.current!=='function')throw new FoundationError('EXTERNAL_JOURNAL_REQUIRED','An actual non-restored authority journal and trusted deployment identity are required');
 const deadline=deadlineFrom(input.timeoutMs);
 // Strong external read precedes the database snapshot; no database lock spans it.
 const attestation=await bounded(journal.current({deployment_id:input.deployment_id,...(input.signal?{signal:input.signal}:{})}),deadline,input.signal);
 return (await resources.observe({preferReplica:false,timeoutMs:Math.max(1,Math.floor(deadline-performance.now())),...(input.signal?{signal:input.signal}:{})},async session=>{
  const row=(await session.query<{epoch:string;proof_digest:string;now:string;recovery:boolean}>("SELECT epoch::text,proof_digest,clock_timestamp()::text AS now,pg_is_in_recovery() AS recovery FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE'",[input.deployment_id])).rows[0];
  if(!row||row.recovery||row.epoch!==attestation.epoch||row.proof_digest!==attestation.evidence_digest||attestation.deployment_id!==input.deployment_id)
   throw new FoundationError('RESTORED_AUTHORITY_STALE','Non-restored authority journal differs from the active primary; explicit recovery is required');
  const now=Date.parse(row.now),observed=Date.parse(attestation.observed_at),expiry=Date.parse(attestation.expires_at);
  if(!/^[1-9][0-9]*$/.test(attestation.sequence)||!Number.isFinite(observed)||!Number.isFinite(expiry)||observed>now+1000||expiry<=now||expiry<=observed||expiry-observed>30000)
   throw new FoundationError('EXTERNAL_JOURNAL_STALE','External current-epoch attestation is not fresh at primary admission');
  return Object.freeze({...attestation,checked_at:row.now});
 })).value;
}
export class AuthorityStore {
 constructor(private readonly resources:ServiceResources,private readonly deploymentId:string,private readonly journal?:ExternalAuthorityJournal){
  if(!uuid.test(deploymentId))throw new FoundationError('AUTHORITY_CONFIG_INVALID','A trusted deployment UUID is required');
 }
 async assertCurrent(tx:PrimaryTransaction,scope:AuthorityScope):Promise<void>{return assertCurrentAuthority(tx,{...scope,deployment_id:this.deploymentId});}
 async activate(input:{operation_id:string;expected_previous_epoch:string|null},fencer:ExternalWriterFence,options:TransactionOptions={},journal=this.journal):Promise<{epoch:string;replayed:boolean}>{
  if(!object(input)||Object.keys(input).some(key=>!['operation_id','expected_previous_epoch'].includes(key))||!uuid.test(input.operation_id)||(input.expected_previous_epoch!==null&&!uuid.test(input.expected_previous_epoch)))
   throw new FoundationError('INVALID_REQUEST','Exact activation operation and external predecessor are required');
  return this.activateInternal(input.operation_id,input.expected_previous_epoch,input.expected_previous_epoch,false,fencer,options,journal);
 }
 async activateRestored(input:{operation_id:string;expected_external_epoch:string;expected_database_epoch:string|null},fencer:ExternalWriterFence,options:TransactionOptions={},journal=this.journal):Promise<{epoch:string;replayed:boolean}>{
  if(!object(input)||Object.keys(input).some(key=>!['operation_id','expected_external_epoch','expected_database_epoch'].includes(key))||!uuid.test(input.operation_id)||!uuid.test(input.expected_external_epoch)||(input.expected_database_epoch!==null&&!uuid.test(input.expected_database_epoch)))
   throw new FoundationError('INVALID_REQUEST','Explicit external and restored database predecessor identities are required');
  return this.activateInternal(input.operation_id,input.expected_external_epoch,input.expected_database_epoch,true,fencer,options,journal);
 }
 private async activateInternal(operationId:string,externalPrevious:string|null,databasePrevious:string|null,restore:boolean,fencer:ExternalWriterFence,options:TransactionOptions,journal?:ExternalAuthorityJournal):Promise<{epoch:string;replayed:boolean}>{
  if(!journal||typeof journal.prepareActivation!=='function'||typeof journal.publishCommitted!=='function')
   throw new FoundationError('EXTERNAL_JOURNAL_REQUIRED','Authority activation requires the actual independent durable journal');
  if(!fencer||typeof fencer.isolate!=='function')throw new FoundationError('EXTERNAL_FENCE_REQUIRED','A qualified physical writer isolation adapter is required');
  const deadline=deadlineFrom(options.timeoutMs);
  const remaining=()=>{const ms=Math.floor(deadline-performance.now());if(ms<1)throw new StorageError('TX_TIMEOUT','Authority activation deadline expired');return ms;};
  const wait=<T>(promise:Promise<T>)=>bounded(promise,deadline,options.signal);
  const lookup={deployment_id:this.deploymentId,operation_id:operationId,expected_previous_epoch:externalPrevious,database_predecessor_epoch:databasePrevious,...(options.signal?{signal:options.signal}:{})};
  const publish=async(epoch:string):Promise<void>=>{
   try{await wait(journal.publishCommitted({...lookup,epoch}));}
   catch{throw new StorageError('AUTHORITY_ACTIVATION_UNKNOWN','Database may be committed while external publication remains PENDING; positively reconcile the operation identity','unknown');}
  };
  try{
   const previous=await lookupAuthorityActivation(this.resources,{...lookup,timeoutMs:remaining()});
   await publish(previous.epoch);return {epoch:previous.epoch,replayed:true};
  }catch(error){if(!(error instanceof FoundationError)||error.code!=='AUTHORITY_OPERATION_UNCONFIRMED')throw error;}
  const active=(await this.resources.observe({preferReplica:false,timeoutMs:remaining(),...(options.signal?{signal:options.signal}:{})},session=>session.query<{epoch:string;recovery:boolean}>("SELECT epoch::text,pg_is_in_recovery() AS recovery FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE'",[this.deploymentId]))).value.rows[0];
  if(active?.recovery||(active?.epoch??null)!==databasePrevious)throw new FoundationError('STALE_AUTHORITY','Exact database predecessor changed before physical fencing');
  const returned=await wait(fencer.isolate({deployment_id:this.deploymentId,operation_id:operationId,source_epoch:externalPrevious,...(options.signal?{signal:options.signal}:{})}));
  let proof:FenceReceipt;
  try{proof=JSON.parse(JSON.stringify(returned)) as FenceReceipt;}catch{throw new FoundationError('EXTERNAL_FENCE_INVALID','Physical isolation receipt must be a stable JSON value');}
  if(!object(proof)||typeof proof.fence_id!=='string'||!proof.fence_id||typeof proof.isolated_writer!=='string'||!proof.isolated_writer||
    proof.deployment_id!==this.deploymentId||proof.operation_id!==operationId||proof.source_epoch!==externalPrevious||!/^sha256:[a-f0-9]{64}$/.test(proof.evidence_digest)||
    !Number.isFinite(Date.parse(proof.observed_at))||!Number.isFinite(Date.parse(proof.expires_at))||Date.parse(proof.expires_at)-Date.parse(proof.observed_at)>30000||Date.parse(proof.expires_at)<=Date.parse(proof.observed_at))
   throw new FoundationError('EXTERNAL_FENCE_INVALID','Physical writer isolation receipt is invalid or unbound');
  const proofDigest=digest(JSON.stringify(proof));
  const prepared=await wait(journal.prepareActivation({deployment_id:this.deploymentId,operation_id:operationId,expected_previous_epoch:externalPrevious,expected_database_epoch:databasePrevious,fence_evidence_digest:proofDigest,...(options.signal?{signal:options.signal}:{})}));
  if(!uuid.test(prepared.epoch))throw new FoundationError('EXTERNAL_JOURNAL_INVALID','Journal must durably bind one fresh UUID before the database attempt');
  if(prepared.replayed)throw new StorageError('AUTHORITY_OPERATION_PENDING','Existing PENDING has no positive commit receipt; absence cannot authorise another database attempt','unknown');
  const epoch=prepared.epoch;
  const requestDigest=restore?digest(JSON.stringify({deployment_id:this.deploymentId,operation_id:operationId,expected_external_epoch:externalPrevious,expected_database_epoch:databasePrevious,mode:'RESTORE'})):
   digest(JSON.stringify({deployment_id:this.deploymentId,operation_id:operationId,expected_previous_epoch:externalPrevious}));
  await this.resources.gateway.withPrimaryTransaction({...options,timeoutMs:remaining()},async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(1945824101,2)');
   const now=(await tx.query<{now:string}>('SELECT clock_timestamp()::text AS now')).rows[0]!.now;
   if(Date.parse(proof.expires_at)<=Date.parse(now)||Date.parse(proof.observed_at)>Date.parse(now)+1000)throw new FoundationError('EXTERNAL_FENCE_EXPIRED','Physical fence was not fresh at primary admission');
   const current=(await tx.query<{epoch:string}>("SELECT epoch::text FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE' FOR UPDATE",[this.deploymentId])).rows[0];
   if((current?.epoch??null)!==databasePrevious)throw new FoundationError('STALE_AUTHORITY','Exact database predecessor changed');
   if(current)await tx.query("UPDATE hyperfide.authority_epochs SET state='REVOKED' WHERE deployment_id=$1 AND epoch=$2",[this.deploymentId,current.epoch]);
   await tx.query("INSERT INTO hyperfide.authority_epochs(deployment_id,epoch,previous_epoch,database_predecessor_epoch,activation_kind,state,fence_id,proof_digest) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7)",[this.deploymentId,epoch,externalPrevious,databasePrevious,restore?'RESTORE':externalPrevious===null?'BOOTSTRAP':'ROTATE',proof.fence_id,proofDigest]);
   await tx.query('INSERT INTO hyperfide.authority_activations(operation_id,deployment_id,epoch,request_digest) VALUES($1,$2,$3,$4)',[operationId,this.deploymentId,epoch,requestDigest]);
  });
  await publish(epoch);
  return {epoch,replayed:false};
 }
}
export async function inspectDurability(resources:ServiceResources):Promise<unknown>{
 return (await resources.observe({preferReplica:false},async session=>{
  const settings=(await session.query<{recovery:boolean;fsync:string;full_page_writes:string;standbys:string}>(
   "SELECT pg_is_in_recovery() AS recovery,current_setting('fsync') AS fsync,current_setting('full_page_writes') AS full_page_writes,current_setting('synchronous_standby_names') AS standbys")).rows[0]!;
  const peers=(await session.query<{application_name:string;state:string;sync_state:string;flush_lsn:string|null}>('SELECT application_name,state,sync_state,flush_lsn::text FROM pg_stat_replication')).rows;
  const qualifiedConfiguration=!settings.recovery&&settings.fsync==='on'&&settings.full_page_writes==='on'&&settings.standbys.trim()!==''&&peers.some(peer=>peer.state==='streaming'&&['sync','quorum'].includes(peer.sync_state)&&peer.flush_lsn!==null);
  return {settings,peers,configuration_ready:qualifiedConfiguration,qualification:'observed-config-only',failure_domain_qualification:'not-established-by-this-query'};
 })).value;
}

export async function assertRuntimePrivileges(resources:ServiceResources):Promise<void>{
 const unsafe=(await resources.observe({preferReplica:false},session=>session.query<{unsafe:boolean}>(
  "SELECT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR has_database_privilege(current_user,current_database(),'CREATE') OR "+
  "EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='hyperfide' AND (n.nspowner=r.oid OR has_schema_privilege(current_user,n.oid,'CREATE'))) OR "+
  "EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hyperfide' AND c.relowner=r.oid) OR "+
  "has_table_privilege(current_user,'hyperfide.schema_migrations','INSERT,UPDATE,DELETE,TRUNCATE')) AS unsafe FROM pg_roles r WHERE r.rolname=current_user"))).value.rows[0]?.unsafe;
 if(unsafe!==false)throw new FoundationError('RUNTIME_DDL_PRIVILEGE','Ordinary runtime identity must not own schema objects or have migration privileges');
}
export async function createComponent(context:ComponentContext):Promise<Component>{
 const migrations=new MigrationCoordinator(context.resources);
 if(context.env.HYPERFIDE_MIGRATION_JOB!=='1'){
  if(!['0','1'].includes(context.env.HYPERFIDE_REQUIRE_SYNC_REPLICA??''))throw new FoundationError('DURABILITY_POLICY_REQUIRED','Declare synchronous replica policy explicitly; 0 means single-host acknowledgement only');
  if(context.env.HYPERFIDE_MIGRATION_DATABASE_URL)throw new FoundationError('MIGRATION_CREDENTIAL_EXPOSED','Ordinary service must not receive migration credentials');
  if(!(await migrations.inspect()).ready)throw new FoundationError('MIGRATION_NOT_READY','Expected release migration checksum set is not applied');
  await assertRuntimePrivileges(context.resources);
  if(context.env.HYPERFIDE_REQUIRE_SYNC_REPLICA==='1'&&!(await inspectDurability(context.resources) as {configuration_ready:boolean}).configuration_ready)throw new FoundationError('DURABILITY_UNAVAILABLE','Required synchronous standby is not ready');
 }
 const deployment=context.env.HYPERFIDE_DEPLOYMENT_ID;
 let journal:ExternalAuthorityJournal|undefined;
 if(context.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR){
  journal=new FileExternalAuthorityJournal(context.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR,input=>lookupAuthorityActivation(context.resources,input));
 }
 if(context.env.HYPERFIDE_MIGRATION_JOB!=='1'){
  if(!deployment||!journal)throw new FoundationError('EXTERNAL_JOURNAL_REQUIRED','Ordinary services require the trusted deployment and non-restored journal directory');
  await assertExternalAuthorityCurrent(context.resources,journal,{deployment_id:deployment,signal:context.signal});
 }
 const store=()=>{if(!deployment)throw new FoundationError('AUTHORITY_CONFIG_INVALID','Deployment identity is not configured');return new AuthorityStore(context.resources,deployment,journal);};
 const authority=Object.freeze({
  activate:(input:{operation_id:string;expected_previous_epoch:string|null},fencer:ExternalWriterFence,options:TransactionOptions={})=>store().activate(input,fencer,options),
  activateRestored:(input:{operation_id:string;expected_external_epoch:string;expected_database_epoch:string|null},fencer:ExternalWriterFence,options:TransactionOptions={})=>store().activateRestored(input,fencer,options),
  assertCurrent:(tx:PrimaryTransaction,scope:AuthorityScope)=>store().assertCurrent(tx,scope),
  assertExternalCurrent:(options:{timeoutMs?:number;signal?:AbortSignal}={})=>{
   if(!deployment||!journal)throw new FoundationError('EXTERNAL_JOURNAL_REQUIRED','Non-restored current authority is required');
   return assertExternalAuthorityCurrent(context.resources,journal,{deployment_id:deployment,...options});
  }
 });
 return {apiVersion:1,actions:{
  'storage.migrations.inspect':async()=>migrations.inspect(),
  'storage.migrations.apply':async input=>{
   if(!object(input)||Object.keys(input).length)throw new FoundationError('INVALID_REQUEST','Migration job input must be empty');
   if(context.env.HYPERFIDE_MIGRATION_JOB!=='1')throw new FoundationError('MIGRATION_JOB_REQUIRED','DDL only runs in an explicit isolated migration job');
   const configured=context.env.HYPERFIDE_MIGRATION_TIMEOUT_MS??'30000';
   if(!/^[1-9][0-9]*$/.test(configured)||Number(configured)>30000)throw new FoundationError('MIGRATION_CONFIG_INVALID','Trusted migration deadline must be from1to30000milliseconds');
   return migrations.apply({signal:context.signal,timeoutMs:Number(configured)});
  },
  'storage.durability.inspect':async()=>inspectDurability(context.resources)
 },capabilities:Object.freeze({'storage.authority.v1':authority,'storage.migrations.v1':Object.freeze({inspect:migrations.inspect.bind(migrations),assertReady:(version:number,name:string,checksum:string)=>assertMigrationReady(context.resources,version,name,checksum)})})};
}
