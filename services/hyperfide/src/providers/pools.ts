import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import type pg from 'pg';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction,TransactionGateway} from '../storage/transactions.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {databaseError} from '../storage/schema.js';
import {assertInvocation} from '../transport/protocol.js';
import {invocationOf} from '../identity/enrollment.js';
import type {InvocationContext} from '../transport/protocol.js';
import type {ProviderAdapter,ProviderOperation,ProviderOutcome,ProviderScope,ResourceRef} from './contract.js';

export interface ProviderPreparationBinding {
 purpose:'PREPARATION'|'EXECUTION';scope:ProviderScope;preparation_digest:string;
 parameters:ProviderOperation<'create'>['parameters'];prepared_base:Record<string,unknown>|null;
}
export interface ProviderPersistenceHooks {
  readonly invocation:InvocationContext;
  assertResourceBinding(operation:ProviderOperation):Promise<void>;
  resolvePreparation(operation:ProviderOperation<'create'>):Promise<ProviderPreparationBinding>;
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
  basis:'PROVIDER_API'|'VERIFIED_OPERATOR_ATTESTATION';evidence_reference:string;
}
export type ProviderQuotaObserver=(scope:ProviderScope,signal:AbortSignal)=>Promise<QuotaObservation[]>;
export interface OwnershipObservation {matches:boolean;operation_id:string;native_sandbox_id:string;evidence_digest:string}
export type ProviderOwnershipProbe=(scope:ProviderScope,operationId:string,nativeId:string,signal:AbortSignal)=>Promise<OwnershipObservation>;
export interface ProviderRunnerBinding extends Record<string,unknown> {organisation_id:string;run_id:string;session_id:string;pool_id:string;sandbox_id:string;external_sandbox_id:string;boot_generation:string;preparation_digest:string}
export interface ProviderRunnerBindingProof {evidence_digest:string;observed_at:string}
export type ProviderRunnerBindingVerifier=(tx:PrimaryTransaction,binding:ProviderRunnerBinding)=>Promise<ProviderRunnerBindingProof|null>;
export interface ProviderRuntimeRegistry {
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
export function createProviderDatabase(context:ComponentContext):ProviderDatabase {
 const runtime:ProviderRuntimeRegistry={adapters:new Map(),observers:new Map(),probes:new Map()},gateway=context.resources.gateway;
 return{gateway,runtime,query:<R extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values?:readonly unknown[])=>gateway.withPrimaryTransaction(
 {timeoutMs:10000,maxRetries:2,signal:context.signal},tx=>tx.query<R>(text,values))};
}
function register<T>(map:Map<string,T>,provider:string,implementation:T):()=>void {
 if(!['railway','blaxel'].includes(provider)||typeof implementation!=='function'||map.has(provider))
  throw new FoundationError('PROVIDER_REGISTRATION_CONFLICT','Provider implementation must be registered once by trusted service startup');
 map.set(provider,implementation);return()=>{if(map.get(provider)===implementation)map.delete(provider);};
}
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
  create_policy:{seed_reference:string;network:'ISOLATED'|'PRIVATE';stdin_required:boolean};
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
    const cp=obj(p.create_policy,['seed_reference','network','stdin_required']);str(cp.seed_reference);if(!['ISOLATED','PRIVATE'].includes(String(cp.network))||typeof cp.stdin_required!=='boolean')fail('POOL_CONFIG_INVALID','Invalid trusted create policy');
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
  const tables=['provider_pool_configurations','provider_quota_observations','provisioning_intents','provisioning_intent_reservations','provider_observations','provider_orphans','provider_pool_health','provider_relocation_plans','provider_connectivity_probes','provider_prepared_bases','provider_remote_operations','runtime_environment_observations'];
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
     !['PROVIDER_API','VERIFIED_OPERATOR_ATTESTATION'].includes(String(o.basis)))fail('QUOTA_OBSERVATION_INVALID','Invalid quota provenance');
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
  const observations=await client.query('SELECT q.* FROM hyperfide.provider_quota_observations q JOIN hyperfide.provider_pool_configurations c USING(organisation_id,pool_id,configuration_digest) WHERE q.organisation_id=$1 AND q.provider=$2 AND q.account_key=$3 AND c.active AND q.expires_at>clock_timestamp() ORDER BY q.observed_at DESC',
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
    return{name,qualified,budgets:budgets.map(b=>({scope:b.scope,approved_limit:b.limit,observed_limit:b.observed?.toString()??null,used:b.used.toString()})),
      used_account:usedAccount.toString(),used_environment:usedEnvironment.toString(),used_pool:usedPool.toString()};
  });
  return {scope,dimensions,planning_limits:p.planning_limits,planning_grants_capacity:false,qualification:'OBSERVED_LIMITS_ONLY',
    unknown_resource_capacity:orphanRows.rows.some(r=>usage.rows.some(u=>u.pool_id===r.pool_id)&&BigInt(r.unknown)>0n),authority:'OBSERVATION_ONLY'};
}
export async function assertPoolCapacity(client:PrimaryTransaction,config:DeploymentConfig,id:string,requested:Partial<Record<QuotaDimension,string>>,alreadyReserved=false):Promise<void>{
  // The same account lock serialises all environment/pool provisioning requests.
  assertPrimaryTransaction(client);
  const p=configuredPool(config,id);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[config.organisation_id+':'+p.provider+':'+p.account_key]);
  const report=await poolCapacity(client,config,id) as {unknown_resource_capacity:boolean;dimensions:Array<{name:QuotaDimension;qualified:boolean;budgets:Array<{scope:string;approved_limit:string;observed_limit:string|null;used:string}>}>};
  if(report.unknown_resource_capacity)fail('CAPACITY_UNKNOWN','Unaccounted provider resources must be reconciled before placement');
  for(const [name,raw] of Object.entries(requested)){
    const quantity=BigInt(dec(raw));if(quantity===0n)continue;
    const d=report.dimensions.find(d=>d.name===name);if(!d?.qualified)fail('QUOTA_UNQUALIFIED','Required capacity dimension is unqualified');
    for(const b of d.budgets){
      if(BigInt(b.used)+(alreadyReserved&&name!=='PROVISIONING'?0n:quantity)>BigInt(b.approved_limit))fail('OPERATING_BUDGET_EXCEEDED','Approved operating budget would be exceeded');
      if(b.observed_limit!==null&&BigInt(b.used)+(alreadyReserved&&name!=='PROVISIONING'?0n:quantity)>BigInt(b.observed_limit))fail('PROVIDER_QUOTA_EXCEEDED','Observed provider quota would be exceeded');
    }
  }
}

export interface RuntimeReadinessInput {
 organisation_id:string;run_id:string;sandbox_id:string;boot_generation:string;slot_id:string;preparation_digest:string;source_digest:string;
}
export interface RuntimeReadinessRecord extends Record<string,unknown> {
 readiness_digest:string;profile_digest:string;preparation_digest:string;source_digest:string;source_manifest_digest:string;source_state_digest:string;
 source_object_id:string;source_tree_id:string;source_repository_id:string;source_bindings:Array<{id:string;commit:string;tree:string}>;
 execution_receipt_digest:string;verification_receipt_digest:string;observed_at:string;expires_at:string;readiness_input:Record<string,unknown>;readiness_input_digest:string;
}
export async function readRuntimeReadiness(tx:PrimaryTransaction,input:RuntimeReadinessInput):Promise<RuntimeReadinessRecord|null>{
 assertPrimaryTransaction(tx);uuid(input.organisation_id);uuid(input.run_id);uuid(input.sandbox_id);dec(input.boot_generation);uuid(input.slot_id);dg(input.preparation_digest);dg(input.source_digest);
 const rows=await tx.query("SELECT o.*,s.boot_generation::text AS current_generation,s.preparation_digest AS current_preparation,b.boot_id AS current_boot_id,p.profile_id AS current_profile,w.state AS slot_state,ep.manifest AS profile_manifest,ep.content_digest AS current_profile_preparation FROM hyperfide.runtime_environment_observations o JOIN hyperfide.sandboxes s ON s.organisation_id=o.organisation_id AND s.id=o.sandbox_id JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id JOIN hyperfide.worker_slots w ON w.organisation_id=o.organisation_id AND w.id=o.slot_id AND w.sandbox_id=o.sandbox_id AND w.boot_generation=o.boot_generation JOIN hyperfide.environment_profiles ep ON ep.organisation_id=o.organisation_id AND ep.id=o.profile_id WHERE o.organisation_id=$1 AND o.run_id=$2 AND o.sandbox_id=$3 AND o.boot_generation=$4 AND o.slot_id=$5 ORDER BY o.observed_at DESC,o.created_at DESC,o.id DESC LIMIT 1 FOR SHARE OF o,s,b,p,w,ep",
  [input.organisation_id,input.run_id,input.sandbox_id,input.boot_generation,input.slot_id]);
 const row=rows.rows[0];if(!row||row.state!=='READY'||row.current_generation!==input.boot_generation||row.current_boot_id!==row.boot_id||row.current_profile!==row.profile_id||
  row.current_preparation!==input.preparation_digest||row.preparation_digest!==input.preparation_digest||row.current_profile_preparation!==input.preparation_digest||
  row.source_manifest_digest!==input.source_digest||row.source_digest!==row.source_manifest_digest||!['READY','ALLOCATED'].includes(row.slot_state)||new Date(row.observed_at).getTime()>Date.now()||new Date(row.expires_at).getTime()<=Date.now())return null;
 const profile=(row.profile_manifest as Record<string,unknown>).profile;
 if(!profile||digestDocument(profile)!==row.profile_digest||digestDocument(row.source_bindings)!==row.source_state_digest||digestDocument(row.readiness_input)!==row.readiness_input_digest)return null;
 const artifacts=await tx.query("SELECT count(*)::int AS count FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=ANY($3::text[]) AND status='COMPLETE'",
  [input.organisation_id,input.run_id,[...new Set([row.stdout_artifact_digest,row.manifest_artifact_digest])]]);
 if(artifacts.rows[0]?.count!==new Set([row.stdout_artifact_digest,row.manifest_artifact_digest]).size)return null;
 const {current_generation,current_preparation,current_boot_id,current_profile,slot_state,profile_manifest,current_profile_preparation,...proof}=row;
 return{...proof,observed_at:new Date(row.observed_at).toISOString(),expires_at:new Date(row.expires_at).toISOString()} as RuntimeReadinessRecord;
}
export function createComponent(context:ComponentContext):Component {
  const database=createProviderDatabase(context);
  const provisioner=()=>{if(context.role!=='provisioner')fail('ROLE_FORBIDDEN','Provider administration requires the provisioner role');};
  const config=()=>readDeployment(context.env);
  const guarded=(fn:(input:unknown,database:ProviderDatabase)=>Promise<unknown>|unknown)=>async(input:unknown,requestContext:ComponentContext)=>{
    if(context.signal.aborted)fail('PROVIDER_CLOSED','Provider service is shutting down');
    try{return await fn(input,bindProviderInvocation(database,await config(),invocationOf(requestContext)));}catch(e){throw e instanceof FoundationError?e:databaseError(e);}
  };
  return {apiVersion:1,capabilities:{'provider.pools.v1':database,'provider.readiness.v1':{readRuntimeReadiness},...(context.role==='provisioner'?{'provider.registry.v1':{
 registerProviderAdapter:(provider:'railway'|'blaxel',factory:ProviderAdapterFactory)=>registerProviderAdapter(database.runtime,provider,factory),
 registerProviderQuotaObserver:(provider:'railway'|'blaxel',observer:ProviderQuotaObserver)=>registerProviderQuotaObserver(database.runtime,provider,observer),
 registerProviderOwnershipProbe:(provider:'railway'|'blaxel',probe:ProviderOwnershipProbe)=>registerProviderOwnershipProbe(database.runtime,provider,probe)
 }}:{})},actions:{
    'provider.pools.describe':input=>{obj(input,[]);return{schema_version:1,dimensions:[...QUOTA_DIMENSIONS],configuration_source:'TRUSTED_PRIVATE_FILE',planning_grants_capacity:false};},
    'provider.pools.readiness':guarded(async(input,database)=>{obj(input,[]);return inspectProviderSchema(database);}),
    'provider.pools.configure':guarded(async(input,database)=>{provisioner();if(!['OPERATOR','PROVISIONER'].includes(providerInvocation(database).principal.role))fail('AUTH_SCOPE_DENIED','Pool configuration requires operator/provisioner authority');obj(input,[]);return applyConfig(database,await config());}),
    'provider.pools.list':guarded(async(input,database)=>{obj(input,[]);const c=await config();return{pools:await Promise.all(c.pools.map(p=>poolCapacity(database,c,p.id)))};}),
    'provider.pools.capacity':guarded(async(input,database)=>{const i=obj(input,['pool_id']);return poolCapacity(database,await config(),uuid(i.pool_id));}),
    'provider.pools.observe':guarded(async(input,database)=>{
      provisioner();if(providerInvocation(database).principal.role!=='PROVISIONER')fail('AUTH_SCOPE_DENIED','Quota observation requires provisioner authority');const i=obj(input,['pool_id']),c=await config(),pool=database,{scope}=await currentPool(pool,c,uuid(i.pool_id));
      const observer=database.runtime.observers.get(scope.provider);if(!observer)fail('QUOTA_UNQUALIFIED','No trusted quota observer is registered');
      const raw=await observer(scope,context.signal);if(!Array.isArray(raw)||!raw.length||raw.length>100)fail('QUOTA_UNQUALIFIED','Quota observation is empty');
      const observations=raw.map(v=>validateQuotaObservation(v,scope));const seen=new Set<string>();
      for(const o of observations){const key=o.scope_kind+':'+o.scope_key+':'+o.dimension;if(seen.has(key))fail('QUOTA_OBSERVATION_INVALID','Duplicate quota observation');seen.add(key);}
      await transaction(pool,async client=>{
        await currentPool(client,c,scope.pool_id);
        for(const o of observations)await client.query('INSERT INTO hyperfide.provider_quota_observations(organisation_id,id,pool_id,configuration_digest,provider,account_key,scope_kind,scope_key,dimension,quota_limit,observed_at,expires_at,evidence_digest,basis,evidence_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [c.organisation_id,randomUUID(),scope.pool_id,scope.configuration_digest,scope.provider,scope.provider_account_id,o.scope_kind,o.scope_key,o.dimension,o.limit,o.observed_at,o.expires_at,o.evidence_digest,o.basis,o.evidence_reference]);
      });return poolCapacity(pool,c,scope.pool_id);
    }),
  }};
}
