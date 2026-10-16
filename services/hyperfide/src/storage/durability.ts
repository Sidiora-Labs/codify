import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {FoundationError,object} from '../policy/programme.js';
import type {Component,ComponentContext} from '../components/registry.js';
import type {ServiceResources} from './runtime.js';
import {StorageError,assertPrimaryTransaction} from './transactions.js';
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
export class AuthorityStore {
 constructor(private readonly resources:ServiceResources,private readonly deploymentId:string){
  if(!uuid.test(deploymentId))throw new FoundationError('AUTHORITY_CONFIG_INVALID','A trusted deployment UUID is required');
 }
 async assertCurrent(tx:PrimaryTransaction,scope:AuthorityScope):Promise<void>{return assertCurrentAuthority(tx,{...scope,deployment_id:this.deploymentId});}
 async activate(input:{operation_id:string;expected_previous_epoch:string|null},fencer:ExternalWriterFence,options:TransactionOptions={}):Promise<{epoch:string;replayed:boolean}>{
  if(!uuid.test(input.operation_id)||(input.expected_previous_epoch!==null&&!uuid.test(input.expected_previous_epoch)))
   throw new FoundationError('INVALID_REQUEST','Exact activation operation and predecessor are required');
  if(!fencer||typeof fencer.isolate!=='function')throw new FoundationError('EXTERNAL_FENCE_REQUIRED','A qualified external writer isolation adapter is required');
  const requestDigest=digest(JSON.stringify({deployment_id:this.deploymentId,...input}));
  const previous=(await this.resources.observe({preferReplica:false},session=>session.query<{epoch:string;request_digest:string}>('SELECT epoch,request_digest FROM hyperfide.authority_activations WHERE operation_id=$1',[input.operation_id]))).value.rows[0];
  if(previous){
   if(previous.request_digest!==requestDigest)throw new FoundationError('AUTHORITY_CONFLICT','Activation operation identity has different inputs');
   const active=(await this.resources.observe({preferReplica:false},session=>session.query<{epoch:string}>("SELECT epoch FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE'",[this.deploymentId]))).value.rows[0];
   if(active?.epoch!==previous.epoch)throw new FoundationError('STALE_AUTHORITY','Replayed activation has been superseded');
   return {epoch:previous.epoch,replayed:true};
  }
  // Adapter is trusted server code, never a JSON boolean/proof supplied by a worker.
  // Its external isolation must finish before any database lock is acquired.
  const proof=await fencer.isolate({deployment_id:this.deploymentId,operation_id:input.operation_id,source_epoch:input.expected_previous_epoch,...(options.signal?{signal:options.signal}:{})});
  if(!object(proof)||typeof proof.fence_id!=='string'||!proof.fence_id||typeof proof.isolated_writer!=='string'||!proof.isolated_writer||
      proof.deployment_id!==this.deploymentId||proof.operation_id!==input.operation_id||proof.source_epoch!==input.expected_previous_epoch||!/^sha256:[a-f0-9]{64}$/.test(proof.evidence_digest)||
      !Number.isFinite(Date.parse(proof.observed_at))||!Number.isFinite(Date.parse(proof.expires_at))||Date.parse(proof.expires_at)-Date.parse(proof.observed_at)>30000||Date.parse(proof.expires_at)<=Date.parse(proof.observed_at))
   throw new FoundationError('EXTERNAL_FENCE_INVALID','External isolation receipt is invalid');
  const epoch=randomUUID();
  return this.resources.gateway.withPrimaryTransaction(options,async tx=>{
   const existing=(await tx.query<{epoch:string;request_digest:string}>('SELECT epoch,request_digest FROM hyperfide.authority_activations WHERE operation_id=$1',[input.operation_id])).rows[0];
   if(existing){if(existing.request_digest!==requestDigest)throw new FoundationError('AUTHORITY_CONFLICT','Activation inputs changed');const current=(await tx.query<{epoch:string}>("SELECT epoch FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE' FOR SHARE",[this.deploymentId])).rows[0];if(current?.epoch!==existing.epoch)throw new FoundationError('STALE_AUTHORITY','Replayed activation was superseded');return {epoch:existing.epoch,replayed:true};}
   await tx.query('SELECT pg_advisory_xact_lock(1945824101,2)');
   const now=(await tx.query<{now:string}>('SELECT clock_timestamp()::text AS now')).rows[0]!.now;
   if(Date.parse(proof.expires_at)<=Date.parse(now)||Date.parse(proof.observed_at)>Date.parse(now)+1000)
    throw new FoundationError('EXTERNAL_FENCE_EXPIRED','External isolation proof is not fresh at authority admission');
   const active=(await tx.query<{epoch:string}>("SELECT epoch FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE' FOR UPDATE",[this.deploymentId])).rows[0];
   if((active?.epoch??null)!==input.expected_previous_epoch)throw new FoundationError('STALE_AUTHORITY','Authority predecessor changed');
   if(active)await tx.query("UPDATE hyperfide.authority_epochs SET state='REVOKED' WHERE deployment_id=$1 AND epoch=$2",[this.deploymentId,active.epoch]);
   await tx.query("INSERT INTO hyperfide.authority_epochs(deployment_id,epoch,previous_epoch,state,fence_id,proof_digest) VALUES($1,$2,$3,'ACTIVE',$4,$5)",[this.deploymentId,epoch,input.expected_previous_epoch,proof.fence_id,digest(JSON.stringify(proof))]);
   await tx.query('INSERT INTO hyperfide.authority_activations(operation_id,deployment_id,epoch,request_digest) VALUES($1,$2,$3,$4)',[input.operation_id,this.deploymentId,epoch,requestDigest]);
   return {epoch,replayed:false};
  });
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
 const authority=Object.freeze({
  activate:async(input:{operation_id:string;expected_previous_epoch:string|null},fencer:ExternalWriterFence,options:TransactionOptions={})=>{
   const deployment=context.env.HYPERFIDE_DEPLOYMENT_ID;
   if(!deployment)throw new FoundationError('AUTHORITY_CONFIG_INVALID','Deployment identity is not configured');
   return new AuthorityStore(context.resources,deployment).activate(input,fencer,options);
  },
  assertCurrent:async(tx:PrimaryTransaction,scope:AuthorityScope)=>{
   const deployment=context.env.HYPERFIDE_DEPLOYMENT_ID;
   if(!deployment)throw new FoundationError('AUTHORITY_CONFIG_INVALID','Deployment identity is not configured');
   return new AuthorityStore(context.resources,deployment).assertCurrent(tx,scope);
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
