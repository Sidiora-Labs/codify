import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import type pg from 'pg';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction,TransactionGateway} from '../storage/transactions.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {databaseError} from '../storage/schema.js';
import {validateProfile} from '../preparation/manifests.js';
import {assertInvocation} from '../transport/protocol.js';
import {invocationOf} from '../identity/enrollment.js';
import type {InvocationContext} from '../transport/protocol.js';
import type {ProviderAdapter,ProviderOperation,ProviderOutcome,ProviderScope,ResourceRef} from './contract.js';

export interface ProviderPreparationBinding {
 purpose:'PREPARATION'|'EXECUTION';scope:ProviderScope;preparation_digest:string;
 parameters:ProviderOperation<'create'>['parameters'];adapter_policy_digest:string|null;prepared_base:Record<string,unknown>|null;
}
export interface ProviderProcessRecord {native_process_ref?:string|null;process_ref:string;payload_digest:string;resource:ResourceRef;state:'SUBMITTED'|'RUNNING'|'EXITED'|'UNKNOWN';provider_metadata:Record<string,unknown>}
export interface ProviderResourceBinding {organisation_id:string;run_id:string;sandbox_id:string;boot_id:string;boot_generation:string}
export interface ProviderArtifactReference {artifact_id:string;receipt_id:string;digest:string;size_bytes:string}
export type ProviderArtifactReferenceReader=(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string},references:readonly ProviderArtifactReference[])=>Promise<readonly unknown[]>;
export interface ProviderOutputArchive {index_reference:ProviderArtifactReference;segment_references:ProviderArtifactReference[]}
export interface ProviderPersistenceHooks {
  readonly invocation:InvocationContext;
  persistOutputArchive(operation:ProviderOperation<'execute'>,archive:ProviderOutputArchive):Promise<{archive_id:string;evidence_digest:string}>;
  assertResourceBinding(operation:ProviderOperation):Promise<void>;
  resolveResourceBinding(operation:ProviderOperation):Promise<ProviderResourceBinding>;
  resolvePreparation(operation:ProviderOperation<'create'>):Promise<ProviderPreparationBinding>;
  claimProcess(operation:ProviderOperation<'execute'>,record:ProviderProcessRecord):Promise<{disposition:'NEW'|'EXISTING';record:ProviderProcessRecord}>;
  resolveProcess(operation:ProviderOperation,processRef:string):Promise<ProviderProcessRecord|null>;
  persistEarlyProcess(operation:ProviderOperation<'execute'>,nativeProcessRef:string):Promise<void>;
  assignedBootGeneration(operation:ProviderOperation<'create'>):Promise<string>;
  persistEarlyResource(operation:ProviderOperation<'create'>,nativeSandboxId:string):Promise<ResourceRef>;
  recordObservation(operation:ProviderOperation,outcome:ProviderOutcome):Promise<void>;
}
export type ProviderAdapterFactory=(scope:ProviderScope,hooks:ProviderPersistenceHooks)=>ProviderAdapter;
export const QUOTA_DIMENSIONS=['SANDBOX','PROVISIONING','CPU_MILLIS','MEMORY_BYTES','DISK_BYTES','AGENT','BUILD','TEST','INDEX'] as const;
export type QuotaDimension=typeof QUOTA_DIMENSIONS[number];
export interface QuotaObservation {
  scope_kind:'ACCOUNT'|'ENVIRONMENT'|'POOL';scope_key:string;dimension:QuotaDimension;limit:string;
  observed_at:string;expires_at:string;evidence_digest:string;
  basis:'PROVIDER_API'|'VERIFIED_OPERATOR_ATTESTATION'|'OPERATOR_DECLARED_CAPACITY';evidence_reference:string;
}
export type ProviderQuotaObserver=(scope:ProviderScope,signal:AbortSignal)=>Promise<QuotaObservation[]>;
export interface OwnershipObservation {matches:boolean;operation_id:string;native_sandbox_id:string;evidence_digest:string}
export type ProviderOwnershipProbe=(scope:ProviderScope,operationId:string,nativeId:string,signal:AbortSignal)=>Promise<OwnershipObservation>;
export interface ProviderRunnerBinding extends Record<string,unknown> {organisation_id:string;run_id:string;session_id:string;pool_id:string;sandbox_id:string;external_sandbox_id:string;boot_generation:string;preparation_digest:string}
export interface ProviderRunnerBindingProof {evidence_digest:string;observed_at:string}
export type ProviderRunnerBindingVerifier=(tx:PrimaryTransaction,binding:ProviderRunnerBinding,request:unknown)=>Promise<ProviderRunnerBindingProof|null>;
export interface ProviderIsolationTransport {
 destroy(operation:ProviderOperation<'destroy'>,signal?:AbortSignal):Promise<ProviderOutcome<'destroy'>>;
 observe(operation:ProviderOperation<'observe'>,signal?:AbortSignal):Promise<ProviderOutcome<'observe'>>;
}
export type ProviderIsolationFactory=(scope:ProviderScope)=>ProviderIsolationTransport|Promise<ProviderIsolationTransport>;
export interface ProviderDestructionRequest {organisation_id:string;run_id:string;sandbox_id:string;boot_generation:string;operation_id:string}
export interface ProviderDestructionProof {evidence_digest:string;observed_at:string}
export type ProviderDestructionPreflight=(tx:PrimaryTransaction,input:ProviderDestructionRequest)=>Promise<ProviderDestructionProof|null>;
export interface ProviderRuntimeRegistry {
 connectivityProbe?:Readonly<{component:"8.4-probe";state:"CONFIGURED"}>;
 publicationVerifier?:RuntimeReadinessPublicationVerifier;
 artifactReferenceReader?:ProviderArtifactReferenceReader;
 destructionPreflight?:ProviderDestructionPreflight;
 isolation:Map<string,ProviderIsolationFactory>;
 runnerBindingVerifier?:ProviderRunnerBindingVerifier;
 adapters:Map<string,ProviderAdapterFactory>;observers:Map<string,ProviderQuotaObserver>;probes:Map<string,ProviderOwnershipProbe>;
}
export interface ProviderDatabase {
 query<R extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values?:readonly unknown[]):Promise<pg.QueryResult<R>>;
 gateway:Pick<TransactionGateway,'withPrimaryTransaction'>;runtime:ProviderRuntimeRegistry;readonly invocation?:InvocationContext;readonly deployment?:DeploymentConfig;
}
export function providerDeployment(database:ProviderDatabase):DeploymentConfig {if(!database.deployment)fail('POOL_CONFIG_REQUIRED','Authenticated deployment binding required');return database.deployment;}
export function providerInvocation(database:ProviderDatabase):InvocationContext {const i=database.invocation;assertInvocation(i);return i;}
export function bindProviderInvocation(database:ProviderDatabase,config:DeploymentConfig,invocation:InvocationContext,roles:readonly string[]=['OPERATOR','COORDINATOR','PROVISIONER','LEADER','FEATURE_MANAGER']):ProviderDatabase{
 assertInvocation(invocation);
 if(invocation.principal.organisation_id!==config.organisation_id||!roles.includes(invocation.principal.role))fail('AUTH_SCOPE_DENIED','Provider operation is outside authenticated deployment/role scope');
 const gateway:Pick<TransactionGateway,'withPrimaryTransaction'>={withPrimaryTransaction:<T>(options:Parameters<TransactionGateway['withPrimaryTransaction']>[0],body:(tx:PrimaryTransaction)=>Promise<T>|T)=>database.gateway.withPrimaryTransaction(
  {...options,signal:AbortSignal.any([invocation.signal,...(options.signal?[options.signal]:[])]),guard:async tx=>{await invocation.guard(tx);await options.guard?.(tx);}},body)};
 return{gateway,runtime:database.runtime,invocation,deployment:config,query:<R extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values?:readonly unknown[])=>gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2},tx=>tx.query<R>(text,values))};
}
export function assertInvocationRun(database:ProviderDatabase,run:string):void{
 const invocation=providerInvocation(database);if(invocation.principal.run_id!==run)fail('AUTH_SCOPE_DENIED','Provider operation belongs to another authenticated run');
}
export async function resolveSandboxBinding(database:ProviderDatabase,config:DeploymentConfig,run:string,sandbox:string,op:ProviderOperation):Promise<ProviderResourceBinding>{
 assertInvocationRun(database,run);
 return transaction(database,async tx=>{
  const rows=await tx.query('SELECT s.*,b.boot_id FROM hyperfide.sandboxes s JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation WHERE s.organisation_id=$1 AND s.id=$2 FOR SHARE OF s,b',[config.organisation_id,uuid(sandbox)]);
  const row=rows.rows[0];if(!row)fail('RESOURCE_OWNERSHIP_UNKNOWN','Current logical resource binding unavailable');
  const {scope}=await currentPool(tx,config,row.pool_id);
  if(digestDocument(scope)!==digestDocument(op.scope)||op.resource&&(op.resource.native_sandbox_id!==row.native_sandbox_id||op.resource.sandbox_boot_generation!==String(row.boot_generation)))fail('STALE_SANDBOX_GENERATION','Resource scope or current boot changed');
  if(op.preparation_digest!==null&&op.preparation_digest!==row.preparation_digest)fail('PREPARATION_MISMATCH','Resource preparation binding changed');
  return{organisation_id:config.organisation_id,run_id:run,sandbox_id:sandbox,boot_id:row.boot_id,boot_generation:String(row.boot_generation)};
 });
}
export function createProviderRuntimeRegistry():ProviderRuntimeRegistry{return{adapters:new Map(),observers:new Map(),probes:new Map(),isolation:new Map()};}
export function createProviderDatabase(context:ComponentContext):ProviderDatabase {
 const runtime=createProviderRuntimeRegistry(),gateway=context.resources.gateway;
 return{gateway,runtime,query:<R extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values?:readonly unknown[])=>gateway.withPrimaryTransaction(
 {timeoutMs:10000,maxRetries:2,signal:context.signal},tx=>tx.query<R>(text,values))};
}
function register<T>(map:Map<string,T>,provider:string,implementation:T):()=>void {
 if(!['railway','blaxel'].includes(provider)||typeof implementation!=='function'||map.has(provider))
  throw new FoundationError('PROVIDER_REGISTRATION_CONFLICT','Provider implementation must be registered once by trusted service startup');
 map.set(provider,implementation);return()=>{if(map.get(provider)===implementation)map.delete(provider);};
}
export function registerArtifactReferenceReader(runtime:ProviderRuntimeRegistry,reader:ProviderArtifactReferenceReader):()=>void{
 if(typeof reader!=='function'||runtime.artifactReferenceReader&&runtime.artifactReferenceReader!==reader)fail('PROVIDER_REGISTRATION_CONFLICT','Actual artifact reference reader must be installed by trusted startup');
 if(runtime.artifactReferenceReader===reader)return()=>{};
 runtime.artifactReferenceReader=reader;return()=>{if(runtime.artifactReferenceReader===reader)delete runtime.artifactReferenceReader;};
}
export function registerIsolationTransport(runtime:ProviderRuntimeRegistry,provider:'railway'|'blaxel',factory:ProviderIsolationFactory){return register(runtime.isolation,provider,factory);}
export function registerProviderAdapter(runtime:ProviderRuntimeRegistry,provider:'railway'|'blaxel',factory:ProviderAdapterFactory){return register(runtime.adapters,provider,factory);}
export function registerProviderQuotaObserver(runtime:ProviderRuntimeRegistry,provider:'railway'|'blaxel',observer:ProviderQuotaObserver){return register(runtime.observers,provider,observer);}
export function registerProviderOwnershipProbe(runtime:ProviderRuntimeRegistry,provider:'railway'|'blaxel',probe:ProviderOwnershipProbe){return register(runtime.probes,provider,probe);}
export const hasProviderAdapter=(provider:string,runtime:ProviderRuntimeRegistry)=>runtime.adapters.has(provider);
export function providerAdapter(scope:ProviderScope,hooks:ProviderPersistenceHooks,runtime:ProviderRuntimeRegistry):ProviderAdapter {
 const factory=runtime.adapters.get(scope.provider);if(!factory)fail('PROVIDER_UNAVAILABLE','No trusted provider adapter is registered');
 const adapter=factory(scope,hooks);if(adapter.provider!==scope.provider)fail('PROVIDER_SCOPE_MISMATCH','Adapter provider differs from persisted pool');return adapter;
}
export function providerOwnershipProbe(provider:string,runtime:ProviderRuntimeRegistry):ProviderOwnershipProbe {
 const probe=runtime.probes.get(provider);if(!probe)fail('OWNERSHIP_UNVERIFIED','Provider resource ownership cannot be established');return probe;
}
export function providerDatabase(context:ComponentContext):ProviderDatabase {
 return context.dependencies.require('8.2','provider.pools.v1',(value):value is ProviderDatabase=>
  !!value&&typeof value==='object'&&typeof (value as ProviderDatabase).query==='function'&&!!(value as ProviderDatabase).gateway);
}
export function fail(code:string,message:string):never {throw new FoundationError(code,message);}
export function obj(value:unknown,keys?:readonly string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_REQUEST','A bounded object is required');
  const o=value as Record<string,unknown>;
  if(keys&&(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k))))fail('INVALID_REQUEST','Object fields differ from provider schema');
  return o;
}
export function str(value:unknown,max=2048):string {
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail('INVALID_REQUEST','Invalid bounded string');
  return value;
}
export function uuid(value:unknown):string {
  const v=str(value,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v))fail('INVALID_REQUEST','A UUID identity is required');return v;
}
export function dec(value:unknown):string {
  if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(value)||BigInt(value)>9223372036854775807n)
    fail('INVALID_REQUEST','Invalid canonical bigint quantity');return value;
}
export function dg(value:unknown):string {
  if(typeof value!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value))fail('INVALID_REQUEST','A SHA256 digest is required');return value;
}
export function utc(value:unknown):string {
  const v=str(value,24);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)
    fail('INVALID_REQUEST','A canonical UTC timestamp is required');return v;
}
function canonical(value:unknown):string {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const o=obj(value);return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';
}
export const digestDocument=(value:unknown)=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
export async function transaction<T>(pool:ProviderDatabase,body:(client:PrimaryTransaction)=>Promise<T>):Promise<T>{
 return pool.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2},body);
}
type Limits=Partial<Record<QuotaDimension,string>>;
export interface PoolConfig {
  id:string;provider:'railway'|'blaxel';account_key:string;environment_key:string;region:string;
  profile_id:string|null;preparation_digest:string;approved_limits:Limits;planning_limits:Limits;
  create_policy:{seed_reference:string;network:'ISOLATED'|'PRIVATE';stdin_required:boolean;adapter_policy_digest?:string};
}
export interface DeploymentConfig {
  schema_version:1;organisation_id:string;revision:string;
  accounts:Array<{provider:'railway'|'blaxel';account_key:string;approved_limits:Limits;planning_limits:Limits}>;
  pools:PoolConfig[];maximum_operation_ms:number;
}
function limits(value:unknown):Limits {
  const o=obj(value);if(!Object.keys(o).length||Object.keys(o).some(k=>!QUOTA_DIMENSIONS.includes(k as QuotaDimension)))fail('POOL_CONFIG_INVALID','Unknown or empty quota dimensions');
  for(const v of Object.values(o))dec(v);return o as Limits;
}
function provider(value:unknown):'railway'|'blaxel' {
  if(value!=='railway'&&value!=='blaxel')fail('POOL_CONFIG_INVALID','Unsupported provider');return value;
}
export function validateDeployment(value:unknown):DeploymentConfig {
  const o=obj(value,['schema_version','organisation_id','revision','accounts','pools','maximum_operation_ms']);
  if(o.schema_version!==1)fail('POOL_CONFIG_INVALID','Unsupported deployment configuration');
  uuid(o.organisation_id);str(o.revision,128);
  if(!Number.isSafeInteger(o.maximum_operation_ms)||(o.maximum_operation_ms as number)<100||(o.maximum_operation_ms as number)>3600000)
    fail('POOL_CONFIG_INVALID','Operation deadline must be bounded');
  if(!Array.isArray(o.accounts)||!o.accounts.length||o.accounts.length>100||!Array.isArray(o.pools)||!o.pools.length||o.pools.length>3000)
    fail('POOL_CONFIG_INVALID','Invalid account or pool inventory');
  const accounts=new Set<string>(),ids=new Set<string>();
  for(const raw of o.accounts){const a=obj(raw,['provider','account_key','approved_limits','planning_limits']);
    const key=provider(a.provider)+':'+str(a.account_key,256);if(accounts.has(key))fail('POOL_CONFIG_INVALID','Duplicate account');
    accounts.add(key);limits(a.approved_limits);limits(a.planning_limits);
  }
  for(const raw of o.pools){const p=obj(raw,['id','provider','account_key','environment_key','region','profile_id','preparation_digest','approved_limits','planning_limits','create_policy']);
    const id=uuid(p.id);if(ids.has(id))fail('POOL_CONFIG_INVALID','Duplicate pool');ids.add(id);
    const key=provider(p.provider)+':'+str(p.account_key,256);if(!accounts.has(key))fail('POOL_CONFIG_INVALID','Pool account is not configured');
    str(p.environment_key,256);str(p.region,256);if(p.profile_id!==null)uuid(p.profile_id);dg(p.preparation_digest);
    const cp=obj(p.create_policy);if(Object.keys(cp).some(k=>!['seed_reference','network','stdin_required','adapter_policy_digest'].includes(k))||['seed_reference','network','stdin_required'].some(k=>!Object.hasOwn(cp,k)))fail('POOL_CONFIG_INVALID','Invalid create policy fields');if(cp.adapter_policy_digest!==undefined)dg(cp.adapter_policy_digest);str(cp.seed_reference);if(!['ISOLATED','PRIVATE'].includes(String(cp.network))||typeof cp.stdin_required!=='boolean')fail('POOL_CONFIG_INVALID','Invalid trusted create policy');
    const budget=limits(p.approved_limits);limits(p.planning_limits);
    if(budget.SANDBOX===undefined||budget.PROVISIONING===undefined)fail('POOL_CONFIG_INVALID','Sandbox and provisioning budgets must be separate');
  }
  return o as unknown as DeploymentConfig;
}
export async function readDeployment(env:Readonly<NodeJS.ProcessEnv>):Promise<DeploymentConfig>{
  const path=env.HYPERFIDE_POOL_CONFIG;if(!path||!path.startsWith('/'))fail('POOL_CONFIG_REQUIRED','A trusted private pool configuration path is required');
  const info=await fs.lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))
    fail('POOL_CONFIG_INVALID','Pool configuration must be a bounded owner-only regular file');
  return validateDeployment(JSON.parse(await fs.readFile(path,'utf8')));
}
export async function inspectProviderSchema(pool:ProviderDatabase):Promise<unknown>{
  const filename=new URL('../../migrations/0008-provider-coordination.sql',import.meta.url);
  const sql=await fs.readFile(filename,'utf8'),checksum='sha256:'+createHash('sha256').update(sql).digest('hex');
  const migration=await pool.query('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=8');
  if(migration.rows[0]?.name!=='0008-provider-coordination'||migration.rows[0]?.checksum!==checksum)
    fail('PROVIDER_SCHEMA_NOT_READY','The dedicated migration runner must apply the pinned provider migration');
  const tables=['provider_pool_configurations','provider_quota_observations','provisioning_intents','provisioning_intent_reservations','provider_observations','provider_orphans','provider_pool_health','provider_relocation_plans','provider_connectivity_probes','provider_prepared_bases','provider_remote_operations','runtime_environment_observations','provider_profile_lineage','provider_process_candidates','provider_remote_observations','provider_capacity_attestations','provider_process_archives','provider_process_archive_links'];
  const result=await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='hyperfide' AND tablename=ANY($1::text[])",[tables]);
  if(result.rows.length!==tables.length)fail('PROVIDER_SCHEMA_NOT_READY','Provider migration tables are incomplete');
  return{ready:true,version:8,name:'0008-provider-coordination',checksum};
}

export function configuredPool(config:DeploymentConfig,id:string):PoolConfig {
  const p=config.pools.find(p=>p.id===id);if(!p)fail('POOL_SCOPE_MISMATCH','Pool is outside trusted deployment configuration');return p;
}
export function configuredScope(config:DeploymentConfig,p:PoolConfig):ProviderScope {
  return {organisation_id:config.organisation_id,pool_id:p.id,provider:p.provider,provider_account_id:p.account_key,
    environment_id:p.environment_key,region:p.region,configuration_digest:digestDocument({revision:config.revision,pool:p,
      account:config.accounts.find(a=>a.provider===p.provider&&a.account_key===p.account_key)})};
}
async function applyConfig(pool:ProviderDatabase,config:DeploymentConfig):Promise<unknown>{
  return transaction(pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[config.organisation_id]);
    for(const p of config.pools){
      const scope=configuredScope(config,p);
      const existing=await c.query('SELECT * FROM hyperfide.provider_pools WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[config.organisation_id,p.id]);
      if(existing.rows.length&&['provider','account_key','environment_key','region'].some(k=>existing.rows[0]![k]!==p[k as keyof PoolConfig]))
        fail('POOL_IDENTITY_CONFLICT','A pool identity cannot be reassigned');
      await c.query('INSERT INTO hyperfide.provider_pools(organisation_id,id,provider,account_key,environment_key,region,profile_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organisation_id,id) DO NOTHING',
        [config.organisation_id,p.id,p.provider,p.account_key,p.environment_key,p.region,p.profile_id]);
      await c.query('UPDATE hyperfide.provider_pool_configurations SET active=false WHERE organisation_id=$1 AND pool_id=$2 AND configuration_digest<>$3',
        [config.organisation_id,p.id,scope.configuration_digest]);
      const account=config.accounts.find(a=>a.provider===p.provider&&a.account_key===p.account_key)!;
      await c.query('INSERT INTO hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest,document,active) VALUES($1,$2,$3,$4,true) ON CONFLICT(organisation_id,pool_id,configuration_digest) DO UPDATE SET active=true',
        [config.organisation_id,p.id,scope.configuration_digest,{scope,pool:p,account}]);
    }
    return{configured:config.pools.length,qualification:'UNQUALIFIED_UNTIL_OBSERVED',planning_grants_capacity:false};
  });
}
export function validateQuotaObservation(value:unknown,scope:ProviderScope):QuotaObservation {
  const o=obj(value,['scope_kind','scope_key','dimension','limit','observed_at','expires_at','evidence_digest','basis','evidence_reference']);
  if(!['ACCOUNT','ENVIRONMENT','POOL'].includes(String(o.scope_kind))||!QUOTA_DIMENSIONS.includes(o.dimension as QuotaDimension)||
     !['PROVIDER_API','VERIFIED_OPERATOR_ATTESTATION','OPERATOR_DECLARED_CAPACITY'].includes(String(o.basis)))fail('QUOTA_OBSERVATION_INVALID','Invalid quota provenance');
  const expected=o.scope_kind==='ACCOUNT'?scope.provider_account_id:o.scope_kind==='ENVIRONMENT'?scope.environment_id:scope.pool_id;
  if(o.scope_key!==expected)fail('QUOTA_SCOPE_MISMATCH','Quota observation belongs to another scope');
  dec(o.limit);dg(o.evidence_digest);str(o.evidence_reference);utc(o.observed_at);utc(o.expires_at);
  const now=Date.now();if(Date.parse(o.observed_at as string)>now||Date.parse(o.expires_at as string)<=now||
    Date.parse(o.observed_at as string)>=Date.parse(o.expires_at as string))fail('QUOTA_OBSERVATION_STALE','Quota observation is stale or from the future');
  return o as unknown as QuotaObservation;
}
export async function currentPool(client:Pick<PrimaryTransaction,'query'>,config:DeploymentConfig,id:string):Promise<{pool:PoolConfig;scope:ProviderScope}>{
  const p=configuredPool(config,id),scope=configuredScope(config,p);
  const rows=await client.query('SELECT p.state FROM hyperfide.provider_pools p JOIN hyperfide.provider_pool_configurations c ON c.organisation_id=p.organisation_id AND c.pool_id=p.id WHERE p.organisation_id=$1 AND p.id=$2 AND c.configuration_digest=$3 AND c.active',
    [config.organisation_id,id,scope.configuration_digest]);
  if(rows.rows[0]?.state!=='ACTIVE')fail('POOL_UNAVAILABLE','Pool is inactive, unconfigured or has a different deployment revision');
  return{pool:p,scope};
}
export async function poolCapacity(client:Pick<PrimaryTransaction,'query'>,config:DeploymentConfig,id:string):Promise<unknown>{
  const {pool:p,scope}=await currentPool(client,config,id),account=config.accounts.find(a=>a.provider===p.provider&&a.account_key===p.account_key)!;
  const observations=await client.query("SELECT q.* FROM hyperfide.provider_quota_observations q JOIN hyperfide.provider_pool_configurations c USING(organisation_id,pool_id,configuration_digest) WHERE q.organisation_id=$1 AND q.provider=$2 AND q.account_key=$3 AND c.active AND q.observed_at<=clock_timestamp() AND q.expires_at>clock_timestamp() AND (q.basis<>'OPERATOR_DECLARED_CAPACITY' OR EXISTS(SELECT 1 FROM hyperfide.provider_capacity_attestations d JOIN hyperfide.artifacts a ON a.organisation_id=d.organisation_id AND a.run_id=d.provenance_run_id AND a.id=d.provenance_artifact_id AND a.digest=d.provenance_digest WHERE d.organisation_id=q.organisation_id AND d.id=q.declaration_id AND a.status='COMPLETE' AND a.completed_at IS NOT NULL)) ORDER BY q.observed_at DESC",
    [config.organisation_id,p.provider,p.account_key]);
  const usage=await client.query("SELECT p.id AS pool_id,p.environment_key,count(s.id) FILTER(WHERE s.observed_state<>'DESTROYED')::text AS occupied FROM hyperfide.provider_pools p LEFT JOIN hyperfide.sandboxes s ON s.organisation_id=p.organisation_id AND s.pool_id=p.id WHERE p.organisation_id=$1 AND p.provider=$2 AND p.account_key=$3 GROUP BY p.id,p.environment_key",
    [config.organisation_id,p.provider,p.account_key]);
  const pending=await client.query("SELECT pool_id,count(*)::text AS creates,count(*) FILTER(WHERE state IN ('RECORDED','SUBMITTING','ID_KNOWN','UNKNOWN','RECONCILING','QUARANTINED'))::text AS inflight FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND kind='CREATE' AND state NOT IN ('TERMINAL','REJECTED') GROUP BY pool_id",
    [config.organisation_id]);
  const relevant=(kind:string,key:string,dimension:string)=>{
    const rows=observations.rows.filter(r=>r.scope_kind===kind&&r.scope_key===key&&r.dimension===dimension);
    return rows.length?rows.reduce((a,r)=>BigInt(r.quota_limit)<a?BigInt(r.quota_limit):a,BigInt(rows[0]!.quota_limit)):null;
  };
  const resourceUsage=await client.query("SELECT i.pool_id,COALESCE(sum((i.operation->'parameters'->'resources'->>'cpu_millis')::bigint),0)::text AS cpu,COALESCE(sum((i.operation->'parameters'->'resources'->>'memory_bytes')::bigint),0)::text AS memory,COALESCE(sum((i.operation->'parameters'->'resources'->>'disk_bytes')::bigint),0)::text AS disk FROM hyperfide.provisioning_intents i JOIN hyperfide.sandboxes s ON s.organisation_id=i.organisation_id AND s.id=i.sandbox_id WHERE i.organisation_id=$1 AND i.kind='CREATE' AND i.state<>'REJECTED' AND s.observed_state<>'DESTROYED' GROUP BY i.pool_id",[config.organisation_id]);
  const reservations=await client.query("SELECT a.pool_id,a.dimension,sum(r.quantity)::text AS quantity FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.state<>'RELEASED' AND (a.dimension NOT IN ('SANDBOX','CPU_MILLIS','MEMORY_BYTES','DISK_BYTES') OR a.capacity_class='PHYSICAL') GROUP BY a.pool_id,a.dimension",[config.organisation_id]);
  const orphanRows=await client.query("SELECT o.pool_id,count(*)::text AS unknown FROM hyperfide.provider_orphans o WHERE o.organisation_id=$1 AND o.state<>'DELETED' AND NOT EXISTS(SELECT 1 FROM hyperfide.sandboxes s WHERE s.organisation_id=o.organisation_id AND s.pool_id=o.pool_id AND s.native_sandbox_id=o.native_sandbox_id) GROUP BY o.pool_id",[config.organisation_id]);
  const amount=(poolId:string,name:QuotaDimension):bigint=>{
    const raw=name==='SANDBOX'?BigInt(usage.rows.find(r=>r.pool_id===poolId)?.occupied??'0')+BigInt(orphanRows.rows.find(r=>r.pool_id===poolId)?.unknown??'0'):
      name==='PROVISIONING'?BigInt(pending.rows.find(r=>r.pool_id===poolId)?.inflight??'0'):
      ['CPU_MILLIS','MEMORY_BYTES','DISK_BYTES'].includes(name)?
        BigInt(resourceUsage.rows.find(r=>r.pool_id===poolId)?.[{CPU_MILLIS:'cpu',MEMORY_BYTES:'memory',DISK_BYTES:'disk'}[name as 'CPU_MILLIS'|'MEMORY_BYTES'|'DISK_BYTES']]??'0'):0n;
    const reserved=BigInt(reservations.rows.find(r=>r.pool_id===poolId&&r.dimension===name)?.quantity??'0');
    return raw>reserved?raw:reserved;
  };
  const dimensions=QUOTA_DIMENSIONS.map(name=>{
    const accountObserved=relevant('ACCOUNT',p.account_key,name),environmentObserved=relevant('ENVIRONMENT',p.environment_key,name),poolObserved=relevant('POOL',p.id,name);
    const poolIds=usage.rows.map(r=>r.pool_id as string),environmentIds=usage.rows.filter(r=>r.environment_key===p.environment_key).map(r=>r.pool_id as string);
    const usedAccount=poolIds.reduce((n,id)=>n+amount(id,name),0n),usedEnvironment=environmentIds.reduce((n,id)=>n+amount(id,name),0n),usedPool=amount(id,name);
    const budgets=[{scope:'ACCOUNT',limit:account.approved_limits[name]??'0',observed:accountObserved,used:usedAccount},
      {scope:'ENVIRONMENT',limit:p.approved_limits[name]??'0',observed:environmentObserved,used:usedEnvironment},
      {scope:'POOL',limit:p.approved_limits[name]??'0',observed:poolObserved,used:usedPool}];
    const qualified=accountObserved!==null&&(environmentObserved!==null||poolObserved!==null);
    const origins=(scope:string)=>observations.rows.filter(r=>r.scope_kind===scope&&r.scope_key===(scope==='ACCOUNT'?p.account_key:scope==='ENVIRONMENT'?p.environment_key:p.id)&&r.dimension===name);
    const minimum=(rows:typeof observations.rows)=>rows.length?rows.reduce((n,r)=>BigInt(r.quota_limit)<n?BigInt(r.quota_limit):n,BigInt(rows[0]!.quota_limit)).toString():null;
    return{name,qualified,budgets:budgets.map(b=>({scope:b.scope,approved_limit:b.limit,capacity_limit:b.observed?.toString()??null,
      observed_limit:minimum(origins(b.scope).filter(r=>r.basis==='PROVIDER_API')),
      operator_declared_limit:minimum(origins(b.scope).filter(r=>r.basis!=='PROVIDER_API')),
      limit_sources:[...new Set(origins(b.scope).map(r=>r.basis))],used:b.used.toString()})),
      used_account:usedAccount.toString(),used_environment:usedEnvironment.toString(),used_pool:usedPool.toString()};
  });
  return {scope,dimensions,planning_limits:p.planning_limits,planning_grants_capacity:false,qualification:'DECLARED_OR_OBSERVED_LIMITS_ONLY',
    unknown_resource_capacity:orphanRows.rows.some(r=>usage.rows.some(u=>u.pool_id===r.pool_id)&&BigInt(r.unknown)>0n),authority:'OBSERVATION_ONLY'};
}
export async function assertPoolCapacity(client:PrimaryTransaction,config:DeploymentConfig,id:string,requested:Partial<Record<QuotaDimension,string>>,alreadyReserved=false):Promise<void>{
  // The same account lock serialises all environment/pool provisioning requests.
  assertPrimaryTransaction(client);
  const p=configuredPool(config,id);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[config.organisation_id+':'+p.provider+':'+p.account_key]);
  const report=await poolCapacity(client,config,id) as {unknown_resource_capacity:boolean;dimensions:Array<{name:QuotaDimension;qualified:boolean;budgets:Array<{scope:string;approved_limit:string;capacity_limit:string|null;observed_limit:string|null;used:string}>}>};
  if(report.unknown_resource_capacity)fail('CAPACITY_UNKNOWN','Unaccounted provider resources must be reconciled before placement');
  for(const [name,raw] of Object.entries(requested)){
    const quantity=BigInt(dec(raw));if(quantity===0n)continue;
    const d=report.dimensions.find(d=>d.name===name);if(!d?.qualified)fail('QUOTA_UNQUALIFIED','Required capacity dimension is unqualified');
    for(const b of d.budgets){
      if(BigInt(b.used)+(alreadyReserved&&name!=='PROVISIONING'?0n:quantity)>BigInt(b.approved_limit))fail('OPERATING_BUDGET_EXCEEDED','Approved operating budget would be exceeded');
      if(b.capacity_limit!==null&&BigInt(b.used)+(alreadyReserved&&name!=='PROVISIONING'?0n:quantity)>BigInt(b.capacity_limit))fail('PROVIDER_QUOTA_EXCEEDED','Observed provider quota would be exceeded');
    }
  }
}

async function providerPrimaryNow(tx:PrimaryTransaction):Promise<number>{
 assertPrimaryTransaction(tx);const row=(await tx.query('SELECT clock_timestamp() AS now')).rows[0];
 const now=new Date(row?.now).getTime();if(!Number.isFinite(now))fail('DATABASE_CLOCK_UNAVAILABLE','Actual primary transaction clock required');return now;
}
export function approvedProfilePolicyDigest(value:unknown):string{
 validateProfile(value);const profile=JSON.parse(JSON.stringify(value)) as Record<string,unknown>;
 delete profile.profile_id;delete profile.profile_version;
 const pins=(raw:unknown)=>{if(!Array.isArray(raw))fail('PREPARATION_MISMATCH','Profile pin collection unavailable');return raw.map(v=>({path:obj(v).path}));};
 profile.repositories=(profile.repositories as Array<Record<string,unknown>>).map(r=>({...r,commit:null,submodules:(r.submodules as Array<Record<string,unknown>>).map(m=>({...m,commit:null}))}));
 profile.package_managers=(profile.package_managers as Array<Record<string,unknown>>).map(m=>({...m,locks:pins(m.locks)}));
 // The versioned preparation-policy file is approval authority, not a source pin.
 profile.recipe=JSON.parse(JSON.stringify(profile.recipe));
 for(const key of ['generated_inputs','build_config','preparation_evidence'])profile[key]=pins(profile[key]);
 profile.caches=(profile.caches as Array<Record<string,unknown>>).map(c=>({...c,input_digest:null}));
 return digestDocument(profile);
}
export interface SelectedEnvironmentInput {
 organisation_id:string;pool_id:string;configuration_digest:string;parent_profile_id:string;parent_preparation_digest:string;
 profile_id:string;preparation_digest:string;source_manifest_digest?:string;
}
export async function readSelectedEnvironmentProfile(tx:PrimaryTransaction,input:SelectedEnvironmentInput):Promise<{manifest:Record<string,unknown>;lineage:Record<string,unknown>|null}|null>{
 assertPrimaryTransaction(tx);
 const read=async(id:string,expected:string)=>{
  const rows=await tx.query('SELECT manifest,content_digest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2 FOR SHARE',[input.organisation_id,id]);
  const row=rows.rows[0];if(!row||row.content_digest!==expected)return null;
  const raw=obj(row.manifest);if(raw.schema_version!==1&&raw.schema_version!==2)return null;
  const manifest=obj(raw,raw.schema_version===1?['schema_version','profile','files','directories','scan','digest']:['schema_version','profile','files','directories','symlinks','hardlinks','scan','digest']),body={...manifest};delete body.digest;
  if(manifest.digest!==expected||digestDocument(body)!==expected)return null;
  validateProfile(manifest.profile);return manifest;
 };
 const manifest=await read(input.profile_id,input.preparation_digest);if(!manifest)return null;
 if(input.profile_id===input.parent_profile_id&&input.preparation_digest===input.parent_preparation_digest)return{manifest,lineage:null};
 const parent=await read(input.parent_profile_id,input.parent_preparation_digest);if(!parent)return null;
 const rows=await tx.query("SELECT * FROM hyperfide.provider_profile_lineage WHERE organisation_id=$1 AND pool_id=$2 AND configuration_digest=$3 AND parent_profile_id=$4 AND parent_preparation_digest=$5 AND derived_profile_id=$6 AND derived_preparation_digest=$7 AND state='QUALIFIED' AND observed_at<=clock_timestamp() AND expires_at>clock_timestamp() FOR SHARE",
 [input.organisation_id,input.pool_id,input.configuration_digest,input.parent_profile_id,input.parent_preparation_digest,input.profile_id,input.preparation_digest]);
 if(rows.rows.length!==1)return null;const lineage=rows.rows[0]!;
 if(lineage.source_manifest_digest!==lineage.source_manifest_artifact_digest||input.source_manifest_digest&&lineage.source_manifest_digest!==input.source_manifest_digest)return null;
 if(approvedProfilePolicyDigest(parent.profile)!==lineage.accepted_policy_digest||approvedProfilePolicyDigest(manifest.profile)!==lineage.accepted_policy_digest)return null;
 const required=[...new Set([lineage.source_manifest_artifact_digest,lineage.execution_receipt_artifact_digest,lineage.verification_receipt_artifact_digest])];
 const retained=await tx.query("SELECT digest FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=ANY($3::text[]) AND status='COMPLETE' AND completed_at IS NOT NULL FOR SHARE",[input.organisation_id,lineage.source_run_id,required]);
 if(retained.rows.length!==required.length)return null;
 const {state,observed_at,expires_at,created_at,lineage_digest,...identity}=lineage;
 if(digestDocument(identity)!==lineage_digest)return null;
 const checkedAt=await providerPrimaryNow(tx);if(new Date(lineage.observed_at).getTime()>checkedAt||new Date(lineage.expires_at).getTime()<=checkedAt)return null;
 return{manifest,lineage};
}

async function attestCapacity(database:ProviderDatabase,config:DeploymentConfig,env:Readonly<NodeJS.ProcessEnv>):Promise<unknown>{
 const invocation=providerInvocation(database);
 if(invocation.principal.role!=='OPERATOR')fail('AUTH_SCOPE_DENIED','Capacity declarations require actual operator authority');
 const file=env.HYPERFIDE_CAPACITY_ATTESTATIONS;
 if(!file?.startsWith('/'))fail('CAPACITY_DECLARATION_REQUIRED','Protected operator capacity declarations required');
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))fail('CAPACITY_DECLARATION_INVALID','Capacity declarations must be bounded and owner-only');
 const document=obj(JSON.parse(await fs.readFile(file,'utf8')),['schema_version','organisation_id','attestations']);
 if(document.schema_version!==1||document.organisation_id!==config.organisation_id||!Array.isArray(document.attestations)||!document.attestations.length||document.attestations.length>1000)fail('CAPACITY_DECLARATION_INVALID','Explicit scoped capacity declarations required');
 const seen=new Set<string>();
 return transaction(database,async tx=>{
  for(const raw of document.attestations as unknown[]){
   const a=obj(raw,['id','pool_id','configuration_digest','scope_kind','scope_key','dimension','limit','declared_at','expires_at','provenance']);
   const id=uuid(a.id);if(seen.has(id))fail('CAPACITY_DECLARATION_INVALID','Duplicate declaration identity');seen.add(id);
   const {scope}=await currentPool(tx,config,uuid(a.pool_id));
   if(a.configuration_digest!==scope.configuration_digest)fail('CAPACITY_DECLARATION_STALE','Capacity declaration configuration changed');
   const at=utc(a.declared_at),until=utc(a.expires_at),now=Date.now();
   if(Date.parse(at)>now||now-Date.parse(at)>30*86400000||Date.parse(until)<=now||Date.parse(until)-Date.parse(at)>30*86400000)fail('CAPACITY_DECLARATION_STALE','Capacity declaration freshness/expiry invalid');
   const proof=obj(a.provenance,['run_id','artifact_id','digest']);uuid(proof.run_id);uuid(proof.artifact_id);dg(proof.digest);
   if(proof.run_id!==invocation.principal.run_id)fail('AUTH_SCOPE_DENIED','Capacity provenance belongs to another run');
   const artifacts=await tx.query("SELECT digest FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND digest=$4 AND status='COMPLETE' AND completed_at IS NOT NULL FOR SHARE",[config.organisation_id,proof.run_id,proof.artifact_id,proof.digest]);
   if(artifacts.rows.length!==1)fail('CAPACITY_PROVENANCE_UNRETAINED','Actual complete retained operator provenance required');
   const hash=digestDocument(a),observation=validateQuotaObservation({scope_kind:a.scope_kind,scope_key:a.scope_key,dimension:a.dimension,limit:a.limit,observed_at:at,expires_at:until,evidence_digest:hash,basis:'OPERATOR_DECLARED_CAPACITY',evidence_reference:'artifact:'+proof.artifact_id},scope);
   const prior=await tx.query('SELECT declaration_digest FROM hyperfide.provider_capacity_attestations WHERE organisation_id=$1 AND id=$2 FOR SHARE',[config.organisation_id,id]);
   if(prior.rows.length){if(prior.rows[0]!.declaration_digest!==hash)fail('CAPACITY_DECLARATION_CONFLICT','Declaration identity was reused');continue;}
   await tx.query('INSERT INTO hyperfide.provider_capacity_attestations(organisation_id,id,pool_id,configuration_digest,provenance_run_id,provenance_artifact_id,provenance_digest,declaration_digest,declaration,declared_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[config.organisation_id,id,scope.pool_id,scope.configuration_digest,proof.run_id,proof.artifact_id,proof.digest,hash,a,at,until]);
   await tx.query('INSERT INTO hyperfide.provider_quota_observations(organisation_id,id,pool_id,configuration_digest,provider,account_key,scope_kind,scope_key,dimension,quota_limit,observed_at,expires_at,evidence_digest,basis,evidence_reference,declaration_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$2)',
    [config.organisation_id,id,scope.pool_id,scope.configuration_digest,scope.provider,scope.provider_account_id,observation.scope_kind,observation.scope_key,observation.dimension,observation.limit,at,until,hash,observation.basis,observation.evidence_reference]);
  }
  return{recorded:seen.size,source:'OPERATOR_DECLARED_CAPACITY',provider_observed:false,free_inventory_granted:false};
 });
}

export function sourceBindingsMatchProfile(profile:unknown,bindings:unknown):boolean{
 const p=obj(profile);if(!Array.isArray(p.repositories)||!Array.isArray(bindings)||p.repositories.length!==bindings.length)return false;
 const seen=new Set<string>();
 return p.repositories.every((raw,n)=>{const r=obj(raw),b=obj(bindings[n]);if(typeof r.id!=='string'||seen.has(r.id))return false;seen.add(r.id);return b.id===r.id&&b.commit===r.commit&&typeof b.tree==='string'&&/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(b.tree);});
}
export interface RuntimeReadinessInput {
 organisation_id:string;run_id:string;sandbox_id:string;boot_generation:string;slot_id:string;boot_preparation_digest:string;preparation_digest:string;source_digest:string;
}
export interface RuntimeReadinessRecord extends Record<string,unknown> {
 readiness_digest:string;profile_digest:string;boot_preparation_digest:string;preparation_digest:string;source_digest:string;source_manifest_digest:string;source_state_digest:string;
 source_object_id:string;source_tree_id:string;source_repository_id:string;source_repository_key:string;execution_receipt_artifact_digest:string;verification_receipt_artifact_digest:string;source_bindings:Array<{id:string;commit:string;tree:string}>;
 execution_receipt_digest:string;verification_receipt_digest:string;observed_at:string;expires_at:string;readiness_input:Record<string,unknown>;readiness_input_digest:string;
}
export async function readRuntimeReadiness(tx:PrimaryTransaction,input:RuntimeReadinessInput):Promise<RuntimeReadinessRecord|null>{
 assertPrimaryTransaction(tx);uuid(input.organisation_id);uuid(input.run_id);uuid(input.sandbox_id);dec(input.boot_generation);uuid(input.slot_id);dg(input.boot_preparation_digest);dg(input.preparation_digest);dg(input.source_digest);
 const rows=await tx.query("SELECT o.*,s.desired_state AS current_desired_state,s.observed_state AS current_observed_state,s.boot_generation::text AS current_generation,s.preparation_digest AS current_preparation,b.boot_id AS current_boot_id,p.profile_id AS current_profile,p.id AS current_pool,pc.configuration_digest AS current_configuration,pc.document->'pool'->>'preparation_digest' AS parent_preparation,w.state AS slot_state,ep.manifest AS profile_manifest,ep.content_digest AS current_profile_preparation FROM hyperfide.runtime_environment_observations o JOIN hyperfide.sandboxes s ON s.organisation_id=o.organisation_id AND s.id=o.sandbox_id JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id JOIN hyperfide.provider_pool_configurations pc ON pc.organisation_id=p.organisation_id AND pc.pool_id=p.id AND pc.active JOIN hyperfide.worker_slots w ON w.organisation_id=o.organisation_id AND w.id=o.slot_id AND w.sandbox_id=o.sandbox_id AND w.boot_generation=o.boot_generation JOIN hyperfide.environment_profiles ep ON ep.organisation_id=o.organisation_id AND ep.id=o.profile_id WHERE o.organisation_id=$1 AND o.run_id=$2 AND o.sandbox_id=$3 AND o.boot_generation=$4 AND o.slot_id=$5 ORDER BY o.observed_at DESC,o.created_at DESC,o.id DESC LIMIT 1 FOR SHARE OF o,s,b,p,pc,w,ep",
  [input.organisation_id,input.run_id,input.sandbox_id,input.boot_generation,input.slot_id]);
 const row=rows.rows[0];if(!row)return null;const checkedAt=await providerPrimaryNow(tx);if(row.state!=='READY'||row.current_desired_state!=='RUNNING'||row.current_observed_state!=='RUNNING'||row.current_generation!==input.boot_generation||row.current_boot_id!==row.boot_id||
  row.current_preparation!==input.boot_preparation_digest||row.boot_preparation_digest!==input.boot_preparation_digest||row.preparation_digest!==input.preparation_digest||row.current_profile_preparation!==input.preparation_digest||
  row.source_manifest_digest!==input.source_digest||row.source_digest!==row.source_manifest_digest||row.source_manifest_digest!==row.source_manifest_artifact_digest||!['READY','ALLOCATED'].includes(row.slot_state)||new Date(row.observed_at).getTime()>checkedAt||new Date(row.expires_at).getTime()<=checkedAt)return null;
 const selected=await readSelectedEnvironmentProfile(tx,{organisation_id:input.organisation_id,pool_id:row.current_pool,configuration_digest:row.current_configuration,parent_profile_id:row.current_profile,parent_preparation_digest:row.parent_preparation,profile_id:row.profile_id,preparation_digest:input.preparation_digest,source_manifest_digest:row.source_manifest_digest});if(!selected)return null;
 const manifest=row.profile_manifest as Record<string,unknown>,manifestBody={...manifest};delete manifestBody.digest;
 if(manifest.digest!==input.preparation_digest||digestDocument(manifestBody)!==input.preparation_digest)return null;
 if(runtimeReadinessDigest(row)!==row.readiness_digest)return null;
 const profile=manifest.profile;
 if(!profile||digestDocument(profile)!==row.profile_digest||digestDocument(row.source_bindings)!==row.source_state_digest||digestDocument(row.readiness_input)!==row.readiness_input_digest)return null;
 if(!Array.isArray(row.source_bindings)||!Array.isArray((profile as Record<string,unknown>).repositories))return null;
 const measured=row.source_bindings.filter((v:unknown)=>!!v&&typeof v==='object'&&(v as Record<string,unknown>).id===row.source_repository_key);
 if(measured.length!==1||measured[0].commit!==row.source_object_id||measured[0].tree!==row.source_tree_id)return null;
 const declared=((profile as Record<string,unknown>).repositories as Array<Record<string,unknown>>).filter(v=>v.id===row.source_repository_key);
 if(declared.length!==1||typeof declared[0]!.url!=='string'||declared[0]!.commit!==row.source_object_id)return null;
 if(!sourceBindingsMatchProfile(profile,row.source_bindings))return null;
 // Repository keys belong to the profile; UUIDs belong to the accepted run.
 // Resolve them through the exact approved URL, never by copying caller labels.
 const mapped=await tx.query("SELECT r.repository_id,p.url FROM hyperfide.run_repositories r JOIN hyperfide.runs run ON run.organisation_id=r.organisation_id AND run.id=r.run_id JOIN hyperfide.repositories p ON p.organisation_id=r.organisation_id AND p.id=r.repository_id AND p.project_id=run.project_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND p.url=$3 FOR SHARE OF r,run,p",[input.organisation_id,input.run_id,declared[0]!.url]);
 if(mapped.rows.length!==1||mapped.rows[0]!.repository_id!==row.source_repository_id)return null;
 const artifacts=await tx.query("SELECT digest FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=ANY($3::text[]) AND status='COMPLETE' AND completed_at IS NOT NULL FOR SHARE",
  [input.organisation_id,input.run_id,[...new Set([row.stdout_artifact_digest,row.manifest_artifact_digest,row.source_manifest_artifact_digest,row.execution_receipt_artifact_digest,row.verification_receipt_artifact_digest])]]);
 if(artifacts.rows.length!==new Set([row.stdout_artifact_digest,row.manifest_artifact_digest,row.source_manifest_artifact_digest,row.execution_receipt_artifact_digest,row.verification_receipt_artifact_digest]).size)return null;
 const finalTime=await providerPrimaryNow(tx);
 if(new Date(row.observed_at).getTime()>finalTime||new Date(row.expires_at).getTime()<=finalTime||selected.lineage&&new Date(String(selected.lineage.expires_at)).getTime()<=finalTime)return null;
 const {current_generation,current_preparation,current_boot_id,current_profile,slot_state,profile_manifest,current_profile_preparation,...proof}=row;
 return{...proof,observed_at:new Date(row.observed_at).toISOString(),expires_at:new Date(row.expires_at).toISOString()} as RuntimeReadinessRecord;
}

export interface VerifiedRuntimeReadinessPublication {
 observation:{
  id:string;sandbox_id:string;boot_generation:string;boot_id:string;slot_id:string;profile_id:string;
  boot_preparation_digest:string;preparation_digest:string;source_manifest_digest:string;
  source_repository_id:string;source_repository_key:string;source_object_id:string;source_tree_id:string;
  source_bindings:Array<{id:string;commit:string;tree:string}>;workspace_digest:string|null;
  native_operation_id:string;input_digest:string;command_digest:string;readiness_input:Record<string,unknown>;
  execution_receipt_digest:string;verification_receipt_digest:string;
  state:'READY'|'NOT_READY';failure_code:string|null;observed_at:string;expires_at:string;
 };
 manifest:Record<string,unknown>;lineage_id:string|null;
 artifacts:{stdout:ProviderArtifactReference;manifest:ProviderArtifactReference;source_manifest:ProviderArtifactReference;
  execution_receipt:ProviderArtifactReference;verification_receipt:ProviderArtifactReference};
}
const readinessIdentityFields=[
 'organisation_id','run_id','id','sandbox_id','boot_generation','boot_id','slot_id','profile_id','profile_digest',
 'boot_preparation_digest','preparation_digest','source_digest','source_manifest_digest','source_manifest_artifact_digest','source_state_digest',
 'readiness_input','readiness_input_digest','source_repository_id','source_repository_key','source_object_id','source_tree_id',
 'source_bindings','workspace_digest','native_operation_id','input_digest','command_digest','stdout_artifact_digest',
 'execution_receipt_digest','verification_receipt_digest','execution_receipt_artifact_digest','verification_receipt_artifact_digest',
 'manifest_artifact_digest','state','failure_code','observed_at','expires_at',
] as const;
/** This digest identifies the retained publication envelope, not the native
 * checker, a Git tree, or the full preparation manifest. Those remain explicit. */
export function runtimeReadinessDigest(value:Record<string,unknown>):string {
 const identity:Record<string,unknown>={};
 for(const key of readinessIdentityFields){
  if(!Object.hasOwn(value,key))fail('RUNTIME_OBSERVATION_INVALID','Complete immutable readiness envelope required');
  const timestamp=value[key];
  identity[key]=['observed_at','expires_at'].includes(key)?(timestamp instanceof Date?timestamp:new Date(String(timestamp))).toISOString():key==='boot_generation'?String(value[key]):value[key];
 }
 return digestDocument({schema_version:1,kind:'RUNTIME_READINESS_PUBLICATION',identity});
}
export type RuntimeReadinessPublicationVerifier=(tx:PrimaryTransaction,invocation:InvocationContext,input:VerifiedRuntimeReadinessPublication,producerProof:unknown)=>Promise<void>;
export function registerPublicationVerifier(runtime:ProviderRuntimeRegistry,verifier:RuntimeReadinessPublicationVerifier):()=>void{
 if(typeof verifier!=="function"||runtime.publicationVerifier&&runtime.publicationVerifier!==verifier)fail("PROVIDER_REGISTRATION_CONFLICT","Actual private publication proof verifier must be installed once");
 if(runtime.publicationVerifier===verifier)return()=>{};runtime.publicationVerifier=verifier;return()=>{if(runtime.publicationVerifier===verifier)delete runtime.publicationVerifier;};
}
export interface ProviderReadinessCapability {
 registerPublicationVerifier(verifier:RuntimeReadinessPublicationVerifier):()=>void;
 registerArtifactReferenceReader(reader:ProviderArtifactReferenceReader):()=>void;
 readRuntimeReadiness:typeof readRuntimeReadiness;
 publishVerifiedRuntimeReadiness(tx:PrimaryTransaction,invocation:InvocationContext,input:VerifiedRuntimeReadinessPublication,producerProof:unknown):Promise<{created:boolean;id:string;readiness_digest:string;state:string;authority:'OBSERVATION_ONLY'}>;
}
export function isProviderReadinessCapability(value:unknown):value is ProviderReadinessCapability {
 return !!value&&typeof value==='object'&&['registerPublicationVerifier','registerArtifactReferenceReader','readRuntimeReadiness','publishVerifiedRuntimeReadiness'].every(k=>typeof (value as Record<string,unknown>)[k]==='function');
}
/** Private transaction-bound producer API. The actual12 retained-receipt
 * publisher must first verify the signed/root-sealed result, stored artifact
 * bytes and independently measured source. No JSON action exposes this method.
 * Lower08 revalidates its own authority, immutable profile/source identities,
 * retained metadata and current physical binding in the caller's transaction. */
export async function publishVerifiedRuntimeReadiness(tx:PrimaryTransaction,invocation:InvocationContext,
 raw:VerifiedRuntimeReadinessPublication,producerProof:unknown,reader:ProviderArtifactReferenceReader,verifier:RuntimeReadinessPublicationVerifier):Promise<{created:boolean;id:string;readiness_digest:string;state:string;authority:'OBSERVATION_ONLY'}>{
 assertPrimaryTransaction(tx);assertInvocation(invocation);
 if(!['PROVISIONER','VERIFIER'].includes(invocation.principal.role))fail('AUTH_SCOPE_DENIED','Actual retained-receipt provisioner/verifier producer required');
 if(typeof verifier!=='function')fail('RUNTIME_PRODUCER_UNAVAILABLE','Actual private retained-byte producer proof verifier required');
 if(typeof reader!=='function')fail('ARTIFACT_REFERENCE_READER_UNAVAILABLE','Actual retained artifact metadata reader required');
 // Clone before any await: later caller mutation cannot change committed facts.
 const input=obj(JSON.parse(JSON.stringify(raw)),['observation','manifest','lineage_id','artifacts']);
 if(JSON.stringify(input).length>16777216)fail('RUNTIME_OBSERVATION_INVALID','Bounded readiness publication required');
 const o=obj(input.observation,['id','sandbox_id','boot_generation','boot_id','slot_id','profile_id','boot_preparation_digest','preparation_digest','source_manifest_digest',
 'source_repository_id','source_repository_key','source_object_id','source_tree_id','source_bindings','workspace_digest','native_operation_id','input_digest','command_digest',
 'readiness_input','execution_receipt_digest','verification_receipt_digest','state','failure_code','observed_at','expires_at']);
 for(const k of ['id','sandbox_id','boot_id','slot_id','profile_id','source_repository_id','native_operation_id'])uuid(o[k]);dec(o.boot_generation);
 if(o.boot_generation==='0'||!['READY','NOT_READY'].includes(String(o.state))||o.state==='READY'&&o.failure_code!==null)fail('RUNTIME_OBSERVATION_INVALID','Valid observed state/current boot required');
 if(o.failure_code!==null)str(o.failure_code,128);
 for(const k of ['boot_preparation_digest','preparation_digest','source_manifest_digest','input_digest','command_digest','execution_receipt_digest','verification_receipt_digest'])dg(o[k]);
 if(o.workspace_digest!==null)dg(o.workspace_digest);str(o.source_repository_key,256);
 const oid=(v:unknown)=>{if(typeof v!=='string'||!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(v))fail('RUNTIME_OBSERVATION_INVALID','Exact measured Git object identity required');};
 oid(o.source_object_id);oid(o.source_tree_id);
 if(!Array.isArray(o.source_bindings)||!o.source_bindings.length||o.source_bindings.length>1024)fail('RUNTIME_OBSERVATION_INVALID','Bounded measured repository bindings required');
 const keys=new Set<string>();
 for(const rawBinding of o.source_bindings){const b=obj(rawBinding,['id','commit','tree']);const key=str(b.id,256);if(keys.has(key))fail('RUNTIME_OBSERVATION_INVALID','Duplicate measured repository key');keys.add(key);oid(b.commit);oid(b.tree);}
 const measured=o.source_bindings.filter(b=>b.id===o.source_repository_key);
 if(measured.length!==1||measured[0]!.commit!==o.source_object_id||measured[0]!.tree!==o.source_tree_id)fail('RUNTIME_SOURCE_MISMATCH','Observed source key/commit/tree must match the exact measured binding');
 const at=utc(o.observed_at),until=utc(o.expires_at);
 if(Date.parse(until)<=Date.parse(at)||Date.parse(until)-Date.parse(at)>300000)fail('RUNTIME_OBSERVATION_STALE','Bounded physical readiness publication required');
 const readinessInput=obj(o.readiness_input);if(JSON.stringify(readinessInput).length>1048576)fail('RUNTIME_OBSERVATION_INVALID','Bounded secret-free native readiness input required');
 if(readinessInput.boot_id!==o.boot_id||readinessInput.preparation_digest!==o.preparation_digest)fail('RUNTIME_OBSERVATION_INVALID','Native readiness input must retain exact boot/effective preparation');
 const manifest=obj(input.manifest),manifestBody={...manifest};delete manifestBody.digest;
 obj(manifest,manifest.schema_version===1?['schema_version','profile','files','directories','scan','digest']:['schema_version','profile','files','directories','symlinks','hardlinks','scan','digest']);
 if(![1,2].includes(Number(manifest.schema_version))||manifest.digest!==o.preparation_digest||digestDocument(manifestBody)!==o.preparation_digest)fail('PREPARATION_MISMATCH','Actual complete preparation manifest bytes required');
 validateProfile(manifest.profile);
 const profile=obj(manifest.profile),profileDigest=digestDocument(profile);
 if(readinessInput.profile_digest!==profileDigest)fail('RUNTIME_OBSERVATION_INVALID','Native readiness input must bind the actual effective profile');
 const declared=(profile.repositories as Array<Record<string,unknown>>).filter(r=>r.id===o.source_repository_key);
 if(declared.length!==1||declared[0]!.commit!==o.source_object_id||!sourceBindingsMatchProfile(profile,o.source_bindings))fail('RUNTIME_SOURCE_MISMATCH','Every measured repository must match the actual effective profile commit pin');
 const artifacts=obj(input.artifacts,['stdout','manifest','source_manifest','execution_receipt','verification_receipt']);
 const refs=Object.values(artifacts).map(rawRef=>{const r=obj(rawRef,['artifact_id','receipt_id','digest','size_bytes']);uuid(r.artifact_id);str(r.receipt_id,128);dg(r.digest);dec(r.size_bytes);return r as unknown as ProviderArtifactReference;});
 await invocation.guard(tx);
 await verifier(tx,invocation,input as unknown as VerifiedRuntimeReadinessPublication,producerProof);
 const organisation=invocation.principal.organisation_id,run=invocation.principal.run_id;
 const current=(await tx.query("SELECT s.*,b.boot_id,p.profile_id AS parent_profile_id,pc.configuration_digest,pc.document->'pool'->>'preparation_digest' AS parent_preparation_digest,ep.provider AS parent_provider,ep.runtime_platform AS parent_runtime_platform,ep.manifest AS parent_manifest,w.state AS slot_state FROM hyperfide.sandboxes s JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation JOIN hyperfide.worker_slots w ON w.organisation_id=s.organisation_id AND w.sandbox_id=s.id AND w.boot_generation=s.boot_generation AND w.id=$3 JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id JOIN hyperfide.provider_pool_configurations pc ON pc.organisation_id=p.organisation_id AND pc.pool_id=p.id AND pc.active JOIN hyperfide.environment_profiles ep ON ep.organisation_id=p.organisation_id AND ep.id=p.profile_id WHERE s.organisation_id=$1 AND s.id=$2 FOR SHARE OF s,b,w,p,pc,ep",[organisation,o.sandbox_id,o.slot_id])).rows;
 if(current.length!==1)fail('RUNTIME_BINDING_UNAVAILABLE','Unique current configured sandbox/slot/parent profile required');
 const physical=current[0]!;
 if(String(physical.boot_generation)!==o.boot_generation||physical.boot_id!==o.boot_id||physical.preparation_digest!==o.boot_preparation_digest||physical.observed_state!=='RUNNING'||physical.desired_state!=='RUNNING'||!['READY','ALLOCATED'].includes(physical.slot_state))fail('STALE_SANDBOX_GENERATION','Readiness must bind the current running physical boot and usable slot');
 const mapping=(await tx.query("SELECT r.repository_id FROM hyperfide.run_repositories r JOIN hyperfide.runs run ON run.organisation_id=r.organisation_id AND run.id=r.run_id JOIN hyperfide.repositories p ON p.organisation_id=r.organisation_id AND p.id=r.repository_id AND p.project_id=run.project_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND p.url=$3 FOR SHARE OF r,run,p",[organisation,run,declared[0]!.url])).rows;
 if(mapping.length!==1||mapping[0]!.repository_id!==o.source_repository_id)fail('RUNTIME_SOURCE_MISMATCH','Logical profile repository must resolve uniquely to the accepted run repository');
 const objects=(await tx.query("SELECT object_id,object_type FROM hyperfide.source_objects WHERE organisation_id=$1 AND repository_id=$2 AND object_id=ANY($3::text[]) FOR SHARE",[organisation,o.source_repository_id,[o.source_object_id,o.source_tree_id]])).rows;
 if(!objects.some(r=>r.object_id===o.source_object_id&&r.object_type==='commit')||!objects.some(r=>r.object_id===o.source_tree_id&&r.object_type==='tree'))fail('RUNTIME_SOURCE_MISMATCH','Accepted durable commit/tree identities required');
 const metadata=await reader(tx,{organisation_id:organisation,run_id:run},refs);
 if(!Array.isArray(metadata)||metadata.length!==refs.length)fail('ARTIFACT_REFERENCE_READER_INVALID','Complete actual artifact references required');
 const ref=(key:string)=>artifacts[key] as unknown as ProviderArtifactReference;
 if(ref('source_manifest').digest!==o.source_manifest_digest)fail('RUNTIME_SOURCE_MISMATCH','Source manifest digest must identify the exact retained source-envelope bytes');
 const now=await providerPrimaryNow(tx);
 if(Date.parse(at)>now||now-Date.parse(at)>30000||Date.parse(until)<=now)fail('RUNTIME_OBSERVATION_STALE','Fresh primary-clock physical readiness publication required');
 const parentManifest=obj(physical.parent_manifest),parentBody={...parentManifest};delete parentBody.digest;
 if(parentManifest.digest!==physical.parent_preparation_digest||digestDocument(parentBody)!==physical.parent_preparation_digest)fail('PREPARATION_MISMATCH','Accepted parent manifest identity changed');
 const existingProfile=(await tx.query('SELECT content_digest,manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2 FOR SHARE',[organisation,o.profile_id])).rows[0];
 if(existingProfile){if(existingProfile.content_digest!==o.preparation_digest||digestDocument(existingProfile.manifest)!==digestDocument(manifest))fail('PREPARATION_MISMATCH','Effective profile identity is immutable');}
 else await tx.query('INSERT INTO hyperfide.environment_profiles(organisation_id,id,provider,runtime_platform,content_digest,manifest) VALUES($1,$2,$3,$4,$5,$6)',[organisation,o.profile_id,physical.parent_provider,physical.parent_runtime_platform,o.preparation_digest,manifest]);
 const derived=o.profile_id!==physical.parent_profile_id||o.preparation_digest!==physical.parent_preparation_digest;
 if(derived){
  uuid(input.lineage_id);
  const policy=approvedProfilePolicyDigest(parentManifest.profile);
  if(approvedProfilePolicyDigest(profile)!==policy)fail('PREPARATION_POLICY_REAPPROVAL_REQUIRED','Derived result may not alter approved resources, tools, capabilities or preparation policy');
  const identity={organisation_id:organisation,id:input.lineage_id,pool_id:physical.pool_id,configuration_digest:physical.configuration_digest,parent_profile_id:physical.parent_profile_id,parent_preparation_digest:physical.parent_preparation_digest,derived_profile_id:o.profile_id,derived_preparation_digest:o.preparation_digest,source_run_id:run,source_manifest_digest:o.source_manifest_digest,source_manifest_artifact_digest:ref('source_manifest').digest,execution_receipt_artifact_digest:ref('execution_receipt').digest,verification_receipt_artifact_digest:ref('verification_receipt').digest,accepted_policy_digest:policy,allowed_delta:['source','dependency_pins','build_config_pins']};
  const lineageDigest=digestDocument(identity),prior=(await tx.query('SELECT * FROM hyperfide.provider_profile_lineage WHERE organisation_id=$1 AND pool_id=$2 AND configuration_digest=$3 AND derived_profile_id=$4 AND derived_preparation_digest=$5 FOR SHARE',[organisation,physical.pool_id,physical.configuration_digest,o.profile_id,o.preparation_digest])).rows[0];
  if(prior){if(prior.lineage_digest!==lineageDigest||prior.state!=='QUALIFIED'||new Date(prior.expires_at).getTime()<=now)fail('PREPARATION_LINEAGE_CONFLICT','Existing lineage cannot change, renew or regain qualification');}
  else{
   const row:Record<string,unknown>={...identity,lineage_digest:lineageDigest,state:'QUALIFIED',observed_at:at,expires_at:until},columns=Object.keys(row);
   await tx.query('INSERT INTO hyperfide.provider_profile_lineage('+columns.join(',')+') VALUES('+columns.map((_,n)=>'$'+(n+1)).join(',')+')',columns.map(k=>k==='allowed_delta'?JSON.stringify(row[k]):row[k]));
  }
 }else if(input.lineage_id!==null)fail('PREPARATION_LINEAGE_CONFLICT','Base profile requires no derived lineage');
 const row:Record<string,unknown>={organisation_id:organisation,run_id:run,...o,profile_digest:profileDigest,source_digest:o.source_manifest_digest,source_manifest_artifact_digest:ref('source_manifest').digest,source_state_digest:digestDocument(o.source_bindings),readiness_input_digest:digestDocument(readinessInput),stdout_artifact_digest:ref('stdout').digest,manifest_artifact_digest:ref('manifest').digest,execution_receipt_artifact_digest:ref('execution_receipt').digest,verification_receipt_artifact_digest:ref('verification_receipt').digest};
 row.readiness_digest=runtimeReadinessDigest(row);
 const prior=(await tx.query('SELECT * FROM hyperfide.runtime_environment_observations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[organisation,run,o.id])).rows[0];
 if(prior){if(prior.readiness_digest!==row.readiness_digest)fail('RUNTIME_OBSERVATION_CONFLICT','Physical publication identity changed');await invocation.guard(tx);const reuseTime=await providerPrimaryNow(tx);if(Date.parse(at)>reuseTime||reuseTime-Date.parse(at)>30000||Date.parse(until)<=reuseTime)fail('RUNTIME_OBSERVATION_STALE','Publication proof expired before reuse');return{created:false,id:String(o.id),readiness_digest:String(prior.readiness_digest),state:String(prior.state),authority:'OBSERVATION_ONLY'};}
 await invocation.guard(tx);
 const finalTime=await providerPrimaryNow(tx);
 if(Date.parse(at)>finalTime||finalTime-Date.parse(at)>30000||Date.parse(until)<=finalTime)fail('RUNTIME_OBSERVATION_STALE','Publication proof expired before the final write');
 const columns=Object.keys(row);
 await tx.query('INSERT INTO hyperfide.runtime_environment_observations('+columns.join(',')+') VALUES('+columns.map((_,n)=>'$'+(n+1)).join(',')+')',columns.map(k=>['source_bindings'].includes(k)?JSON.stringify(row[k]):row[k]));
 return{created:true,id:String(o.id),readiness_digest:String(row.readiness_digest),state:String(o.state),authority:'OBSERVATION_ONLY'};
}

export function createComponent(context:ComponentContext):Component {
  const database=createProviderDatabase(context);
  const provisioner=()=>{if(context.role!=='provisioner')fail('ROLE_FORBIDDEN','Provider administration requires the provisioner role');};
  const config=()=>readDeployment(context.env);
  const guarded=(fn:(input:unknown,database:ProviderDatabase)=>Promise<unknown>|unknown)=>async(input:unknown,requestContext:ComponentContext)=>{
    if(context.signal.aborted)fail('PROVIDER_CLOSED','Provider service is shutting down');
    try{return await fn(input,bindProviderInvocation(database,await config(),invocationOf(requestContext)));}catch(e){throw e instanceof FoundationError?e:databaseError(e);}
  };
  return {apiVersion:1,capabilities:{'provider.pools.v1':database,'provider.readiness.v1':{readRuntimeReadiness,registerPublicationVerifier:(verifier:RuntimeReadinessPublicationVerifier)=>registerPublicationVerifier(database.runtime,verifier),registerArtifactReferenceReader:(reader:ProviderArtifactReferenceReader)=>registerArtifactReferenceReader(database.runtime,reader),publishVerifiedRuntimeReadiness:(tx:PrimaryTransaction,i:InvocationContext,input:VerifiedRuntimeReadinessPublication,proof:unknown)=>{const reader=database.runtime.artifactReferenceReader;const verifier=database.runtime.publicationVerifier;if(!verifier)fail("RUNTIME_PRODUCER_UNAVAILABLE","Actual private retained-byte producer proof verifier required");if(!reader)fail('ARTIFACT_REFERENCE_READER_UNAVAILABLE','Actual retained artifact metadata reader required');return publishVerifiedRuntimeReadiness(tx,i,input,proof,reader,verifier);}},...(context.role==='provisioner'?{'provider.registry.v1':{
 registerArtifactReferenceReader:(reader:ProviderArtifactReferenceReader)=>registerArtifactReferenceReader(database.runtime,reader),
 registerIsolationTransport:(provider:'railway'|'blaxel',factory:ProviderIsolationFactory)=>registerIsolationTransport(database.runtime,provider,factory),
 registerProviderAdapter:(provider:'railway'|'blaxel',factory:ProviderAdapterFactory)=>registerProviderAdapter(database.runtime,provider,factory),
 registerProviderQuotaObserver:(provider:'railway'|'blaxel',observer:ProviderQuotaObserver)=>registerProviderQuotaObserver(database.runtime,provider,observer),
 registerProviderOwnershipProbe:(provider:'railway'|'blaxel',probe:ProviderOwnershipProbe)=>registerProviderOwnershipProbe(database.runtime,provider,probe)
 }}:{})},actions:{
    'provider.pools.describe':input=>{obj(input,[]);return{schema_version:1,dimensions:[...QUOTA_DIMENSIONS],configuration_source:'TRUSTED_PRIVATE_FILE',planning_grants_capacity:false,connectivity_probe_available:!!database.runtime.connectivityProbe,physical_readiness_granted:false};},
    'provider.pools.readiness':guarded(async(input,database)=>{obj(input,[]);return{...obj(await inspectProviderSchema(database)),connectivity_probe_available:!!database.runtime.connectivityProbe,physical_readiness_granted:false};}),
    'provider.pools.configure':guarded(async(input,database)=>{provisioner();if(!['OPERATOR','PROVISIONER'].includes(providerInvocation(database).principal.role))fail('AUTH_SCOPE_DENIED','Pool configuration requires operator/provisioner authority');obj(input,[]);return applyConfig(database,await config());}),
    'provider.pools.attest-capacity':guarded(async(input,database)=>{provisioner();obj(input,[]);return attestCapacity(database,await config(),context.env);}),
    'provider.pools.list':guarded(async(input,database)=>{obj(input,[]);const c=await config();return{pools:await Promise.all(c.pools.map(p=>poolCapacity(database,c,p.id)))};}),
    'provider.pools.capacity':guarded(async(input,database)=>{const i=obj(input,['pool_id']);return poolCapacity(database,await config(),uuid(i.pool_id));}),
    'provider.pools.observe':guarded(async(input,database)=>{
      provisioner();if(providerInvocation(database).principal.role!=='PROVISIONER')fail('AUTH_SCOPE_DENIED','Quota observation requires provisioner authority');const i=obj(input,['pool_id']),c=await config(),pool=database,{scope}=await currentPool(pool,c,uuid(i.pool_id));
      const observer=database.runtime.observers.get(scope.provider);if(!observer)fail('QUOTA_UNQUALIFIED','No trusted quota observer is registered');
      const raw=await observer(scope,context.signal);if(!Array.isArray(raw)||!raw.length||raw.length>100)fail('QUOTA_UNQUALIFIED','Quota observation is empty');
      const observations=raw.map(v=>validateQuotaObservation(v,scope));if(observations.some(v=>v.basis!=='PROVIDER_API'))fail('QUOTA_PROVENANCE_INVALID','Provider observation route accepts actual API evidence only; operator declarations use their separate retained-provenance admission');const seen=new Set<string>();
      for(const o of observations){const key=o.scope_kind+':'+o.scope_key+':'+o.dimension;if(seen.has(key))fail('QUOTA_OBSERVATION_INVALID','Duplicate quota observation');seen.add(key);}
      await transaction(pool,async client=>{
        await currentPool(client,c,scope.pool_id);
        for(const o of observations)await client.query('INSERT INTO hyperfide.provider_quota_observations(organisation_id,id,pool_id,configuration_digest,provider,account_key,scope_kind,scope_key,dimension,quota_limit,observed_at,expires_at,evidence_digest,basis,evidence_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [c.organisation_id,randomUUID(),scope.pool_id,scope.configuration_digest,scope.provider,scope.provider_account_id,o.scope_kind,o.scope_key,o.dimension,o.limit,o.observed_at,o.expires_at,o.evidence_digest,o.basis,o.evidence_reference]);
      });return poolCapacity(pool,c,scope.pool_id);
    }),
  }};
}
