import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {AuthorityRecordError,CREATE_RECORDS,operationInput,parseCreateRecord,recordObject,validateAuthorityRecord} from '../contracts/records.js';

export const AUTHORITY_SCHEMA='hyperfide';
export const AUTHORITY_SCHEMA_VERSION=1;
export const AUTHORITY_TABLES=Object.freeze([
'organisations','projects','repositories','source_objects','spec_revisions','runs','run_spec_revisions',
'run_repositories','feature_packages','tasks','task_dependencies','environment_profiles','provider_pools',
'capacity_accounts','reservations','sandboxes','sandbox_boots','worker_slots','attempts','compute_leases','slot_allocations',
'agent_sessions','preparation_references','workspaces','branch_observations','branch_authorities',
'artifacts','artifact_dependencies','checkpoints','evidence','evidence_artifacts','submission_custodies','submission_evidence',
'qualification_jobs','requalification_operations','integration_candidates','candidate_evidence',
'candidate_custodies','publication_intents','publication_operations','contracts','findings','finding_observations',
'review_coverage','review_coverage_inputs','graph_builds','graph_manifests','graph_channels','parse_blobs',
'graph_files','graph_symbols','graph_references','graph_edges','command_inbox','event_consumers',
'outbox_events','event_deliveries'] as const);
export interface StorageConfig {
connectionString:string;max:number;connectionTimeoutMillis:number;
idleTimeoutMillis:number;statementTimeoutMillis:number;lockTimeoutMillis:number;
}
export interface SchemaReceipt {schema:string;schema_version:number;checksum:string;applied:boolean;tables:string[]}
export interface SchemaInspection {
schema:string;schema_version:number;checksum:string;tables:string[];
foreign_key_count:number;index_count:number;in_recovery:boolean;
}
function bounded(env:Readonly<NodeJS.ProcessEnv>,name:string,fallback:number,min:number,max:number):number {
const value=env[name];
if(value===undefined)return fallback;
if(!/^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)
throw new FoundationError('DATABASE_CONFIG_INVALID','Invalid bounded PostgreSQL setting '+name);
return Number(value);
}
export function storageConfig(env:Readonly<NodeJS.ProcessEnv>):StorageConfig {
const connectionString=env.DATABASE_URL;
if(!connectionString||connectionString.length>16384||/[\x00-\x1f]/.test(connectionString))
throw new FoundationError('DATABASE_CONFIG_INVALID','A trusted PostgreSQL DATABASE_URL is required');
try{
// libpq/pg permit an empty URI host when the socket directory is a query
// parameter. WHATWG URL requires a host with credentials; normalise only the
// validation copy, retaining the original connection string for pg.
const separator=connectionString.indexOf('://');
const start=separator+3;
const slash=connectionString.indexOf('/',start);
const authority=slash<0?'':connectionString.slice(start,slash);
const validationURL=separator>=0&&slash>=0&&(authority===''||authority.endsWith('@'))?
connectionString.slice(0,slash)+'localhost'+connectionString.slice(slash):connectionString;
const url=new URL(validationURL);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.hash)throw new Error();
// pg applies connection-string query settings after Client config. Reject any
// setting that could override bounded execution; permit transport settings only.
const allowed=new Set(['host','port','sslmode','sslrootcert','sslcert','sslkey','sslpassword']);
const seen=new Set<string>();
for(const key of url.searchParams.keys()){
if(!allowed.has(key)||seen.has(key))throw new Error();
seen.add(key);
}
}
catch{throw new FoundationError('DATABASE_CONFIG_INVALID','Invalid PostgreSQL connection configuration');}
return {connectionString,max:bounded(env,'HYPERFIDE_PG_POOL_MAX',4,1,16),
connectionTimeoutMillis:bounded(env,'HYPERFIDE_PG_CONNECT_TIMEOUT_MS',3000,100,30000),
idleTimeoutMillis:bounded(env,'HYPERFIDE_PG_IDLE_TIMEOUT_MS',10000,100,120000),
statementTimeoutMillis:bounded(env,'HYPERFIDE_PG_STATEMENT_TIMEOUT_MS',10000,100,120000),
lockTimeoutMillis:bounded(env,'HYPERFIDE_PG_LOCK_TIMEOUT_MS',3000,100,30000)};
}
export function createStoragePool(config:StorageConfig):pg.Pool {
// Validate exported-factory callers as strictly as trusted environment callers.
config=storageConfig({DATABASE_URL:config.connectionString,HYPERFIDE_PG_POOL_MAX:String(config.max),
HYPERFIDE_PG_CONNECT_TIMEOUT_MS:String(config.connectionTimeoutMillis),
HYPERFIDE_PG_IDLE_TIMEOUT_MS:String(config.idleTimeoutMillis),
HYPERFIDE_PG_STATEMENT_TIMEOUT_MS:String(config.statementTimeoutMillis),
HYPERFIDE_PG_LOCK_TIMEOUT_MS:String(config.lockTimeoutMillis)});
const pool=new pg.Pool({connectionString:config.connectionString,max:config.max,
connectionTimeoutMillis:config.connectionTimeoutMillis,idleTimeoutMillis:config.idleTimeoutMillis,
statement_timeout:config.statementTimeoutMillis,lock_timeout:config.lockTimeoutMillis,
application_name:'hyperfide-authority',allowExitOnIdle:true});
// Idle socket failure must not crash the process or disclose connection details.
pool.on('error',()=>{});
return pool;
}
let currentPool:pg.Pool|undefined;
let currentConfig:string|undefined;
let managedProvider:((env:Readonly<NodeJS.ProcessEnv>)=>pg.Pool)|undefined;
/** Registry owns the process pool lifecycle while legacy callers retain the stable facade. */
export function bindStoragePool(provider:(env:Readonly<NodeJS.ProcessEnv>)=>pg.Pool):()=>void{
if(managedProvider||currentPool)throw new FoundationError('DATABASE_CONFIG_CONFLICT','A process storage owner is already active');
managedProvider=provider;
return ()=>{if(managedProvider===provider)managedProvider=undefined;};
}

/** Stable process resource seam; task4.2 owns the later shared lifecycle. */
export function getPool(env:Readonly<NodeJS.ProcessEnv>):pg.Pool {
if(managedProvider)return managedProvider(env);
const config=storageConfig(env),signature=JSON.stringify(config);
if(currentPool&&signature!==currentConfig)
throw new FoundationError('DATABASE_CONFIG_CONFLICT','This process owns a different PostgreSQL configuration');
if(!currentPool){currentPool=createStoragePool(config);currentConfig=signature;}
return currentPool;
}
export async function closePool():Promise<void>{
if(managedProvider)return;
const pool=currentPool;currentPool=undefined;currentConfig=undefined;if(pool)await pool.end();
}
async function migration():Promise<{sql:string;checksum:string}>{
const filename=new URL('../../migrations/0001-authority.sql',import.meta.url),info=await fs.lstat(filename);
if(!info.isFile()||info.isSymbolicLink()||info.size>4*1024*1024)
throw new FoundationError('SCHEMA_INVALID','Authority migration must be a bounded regular file');
const sql=await fs.readFile(filename,'utf8');
return {sql,checksum:'sha256:'+createHash('sha256').update(sql).digest('hex')};
}
export function databaseError(error:unknown):FoundationError{
if(error instanceof FoundationError)return error;
if(error instanceof AuthorityRecordError)return new FoundationError('INVALID_RECORD',error.message);
const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
const categories:Record<string,string>={
'25001':'AUTHORITY_ISOLATION_INVALID','23505':'AUTHORITY_CONFLICT','23503':'AUTHORITY_REFERENCE_INVALID','23514':'AUTHORITY_CONSTRAINT_INVALID',
'23502':'AUTHORITY_CONSTRAINT_INVALID','22P02':'INVALID_RECORD','22007':'INVALID_RECORD','22008':'INVALID_RECORD',
'40001':'AUTHORITY_RETRY_REQUIRED','40P01':'AUTHORITY_RETRY_REQUIRED','55P03':'DATABASE_BUSY','57014':'DATABASE_TIMEOUT'};
if(Object.hasOwn(categories,code))
return new FoundationError(categories[code]!,'PostgreSQL rejected authority operation ('+code+')');
return new FoundationError('DATABASE_UNAVAILABLE','PostgreSQL authority operation failed');
}
async function tablesOf(client:pg.Pool|pg.PoolClient):Promise<string[]>{
const result=await client.query<{table_name:string}>(
"SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",[AUTHORITY_SCHEMA]);
return result.rows.map(row=>row.table_name).filter(name=>name!=='schema_migrations');
}
export async function bootstrapAuthoritySchema(pool:pg.Pool):Promise<SchemaReceipt>{
const input=await migration(),client=await pool.connect();
try{
await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
await client.query('SELECT pg_advisory_xact_lock(1945824101,1)');
const status=await client.query<{in_recovery:boolean}>('SELECT pg_is_in_recovery() AS in_recovery');
if(status.rows[0]?.in_recovery)throw new FoundationError('PRIMARY_REQUIRED','Authority bootstrap requires the PostgreSQL primary');
const exists=await client.query<{schema_exists:boolean;migration_exists:string|null}>(
"SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) AS schema_exists,to_regclass('hyperfide.schema_migrations')::text AS migration_exists",[AUTHORITY_SCHEMA]);
let applied=false;
if(exists.rows[0]?.migration_exists){
const prior=await client.query<{checksum:string}>('SELECT checksum FROM hyperfide.schema_migrations WHERE version=$1',[AUTHORITY_SCHEMA_VERSION]);
if(prior.rows.length!==1||prior.rows[0]!.checksum!==input.checksum)
throw new FoundationError('SCHEMA_CONFLICT','Existing authority schema does not match the pinned migration');
}else{
if(exists.rows[0]?.schema_exists)throw new FoundationError('SCHEMA_CONFLICT','Unidentified authority namespace already exists');
await client.query(input.sql);
await client.query('INSERT INTO hyperfide.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[AUTHORITY_SCHEMA_VERSION,'0001-authority',input.checksum]);
applied=true;
}
const tables=await tablesOf(client);
if(AUTHORITY_TABLES.some(table=>!tables.includes(table)))throw new FoundationError('SCHEMA_CONFLICT','Authority schema is incomplete');
await client.query('COMMIT');
return {schema:AUTHORITY_SCHEMA,schema_version:AUTHORITY_SCHEMA_VERSION,checksum:input.checksum,applied,tables};
}catch(error){try{await client.query('ROLLBACK');}catch{/* Connection loss cannot establish rollback success. */}throw databaseError(error);}
finally{client.release();}
}
export async function inspectAuthoritySchema(pool:pg.Pool):Promise<SchemaInspection>{
const client=await pool.connect();
try{
await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const metadata=await client.query<{version:number;checksum:string}>('SELECT version,checksum FROM hyperfide.schema_migrations WHERE version=$1',[AUTHORITY_SCHEMA_VERSION]);
if(metadata.rows.length!==1)throw new FoundationError('SCHEMA_NOT_INITIALISED','Authority schema is not initialised');
const tables=await tablesOf(client);
const facts=await client.query<{foreign_key_count:string;index_count:string;in_recovery:boolean}>(
"SELECT (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype='f') AS foreign_key_count,"+
"(SELECT count(*) FROM pg_indexes WHERE schemaname=$1) AS index_count,pg_is_in_recovery() AS in_recovery",[AUTHORITY_SCHEMA]);
await client.query('COMMIT');
return {schema:AUTHORITY_SCHEMA,schema_version:metadata.rows[0]!.version,checksum:metadata.rows[0]!.checksum,tables,
foreign_key_count:Number(facts.rows[0]!.foreign_key_count),index_count:Number(facts.rows[0]!.index_count),in_recovery:facts.rows[0]!.in_recovery};
}catch(error){try{await client.query('ROLLBACK');}catch{/* Preserve observed failure. */}throw databaseError(error);}
finally{client.release();}
}
function empty(input:unknown):void{
if(Object.keys(recordObject(input)).length)throw new AuthorityRecordError('Operation requires an empty object');
}
export function createComponent(context:ComponentContext):Component{
const guarded=(operation:(input:unknown)=>unknown|Promise<unknown>)=>async(input:unknown):Promise<unknown>=>{
if(context.signal.aborted)throw new FoundationError('AUTHORITY_CLOSED','Authority component is shutting down');
try{return await operation(input);}catch(error){throw databaseError(error);}
};
return {apiVersion:1,actions:{
'authority.schema.describe':guarded(input=>{
empty(input);return {schema:AUTHORITY_SCHEMA,schema_version:AUTHORITY_SCHEMA_VERSION,tables:[...AUTHORITY_TABLES],
creation_kinds:Object.keys(CREATE_RECORDS),generation_encoding:'canonical-positive-decimal-string',
payload_authorities:{source:'git',artifact:'object-storage',metadata:'postgresql'}};
}),
'authority.schema.bootstrap':guarded(async input=>{empty(input);return bootstrapAuthoritySchema(getPool(context.env));}),
'authority.database.inspect':guarded(async input=>{empty(input);return inspectAuthoritySchema(getPool(context.env));}),
'authority.record.validate':guarded(input=>{
const value=operationInput(input);return {valid:true,kind:value.kind,record:validateAuthorityRecord(value.kind,value.record)};
}),
'authority.record.create':guarded(async input=>{
const value=operationInput(input),parsed=parseCreateRecord(value.kind,value.record);
const columns=Object.keys(parsed.record);
// Identifiers originate only in the closed catalogue, never in caller text.
const identifiers=columns.map(column=>'"'+column+'"').join(',');
const placeholders=columns.map((_column,index)=>'$'+(index+1)).join(',');
const result=await getPool(context.env).query(
'INSERT INTO hyperfide."'+parsed.table+'"('+identifiers+') VALUES('+placeholders+') RETURNING *',
columns.map(column=>parsed.record[column]));
return {created:true,kind:value.kind,record:result.rows[0] as unknown};
})
},close:closePool};
}
