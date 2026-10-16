import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {getPool,databaseError} from '../storage/schema.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {invocationOf} from '../identity/enrollment.js';

export interface RecoveryScope {organisation_id:string;run_id:string;authority_epoch:string}
export interface RecoveryTransaction {
 query<R extends pg.QueryResultRow=pg.QueryResultRow>(sql:string,values?:unknown[]):Promise<pg.QueryResult<R>>;
 remainingMs():number; readonly signal:AbortSignal;
}
export interface RecoveryGateway {
 withPrimaryTransaction<T>(options:{timeoutMs:number;maxRetries?:number;guard?:(tx:RecoveryTransaction)=>Promise<void>;signal?:AbortSignal},body:(tx:RecoveryTransaction)=>Promise<T>):Promise<T>;
}
export interface RecoveryAuthority {
 assertCurrent(tx:RecoveryTransaction,scope:RecoveryScope):Promise<void>;
}
export interface RecoverySupervisor {
 observe(input:{scope:RecoveryScope;session_id:string;attempt_id:string|null;sandbox_id:string|null;boot_generation:string|null}):Promise<{
 status:'MATCHED_RUNNING'|'CONFIRMED_STOPPED'|'UNKNOWN'|'IDENTITY_MISMATCH';evidence_digest:string;observed_at:string;
 }>;
 stop(input:{scope:RecoveryScope;session_id:string;command_id:string;generation:string}):Promise<{
 status:'CONFIRMED_STOPPED'|'UNKNOWN'|'IDENTITY_MISMATCH';evidence_digest:string;observed_at:string;
 }>;
}
interface Dependencies {require<T>(id:string,name:string,guard:(value:unknown)=>value is T):T}
export function fail(code:string,message:string):never {throw new FoundationError(code,message);}
export function record(value:unknown,required:string[],optional:string[]=[]):Record<string,unknown>{
 if(!object(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))
  fail('RECOVERY_INPUT_INVALID','Recovery input fields do not match the declared contract');
 return value;
}
export function uuid(value:unknown):string {
 if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
  fail('RECOVERY_INPUT_INVALID','Canonical UUID required');
 return value;
}
export function positive(value:unknown):string{
 if(typeof value!=='string'||!/^([1-9][0-9]*)$/.test(value)||BigInt(value)>9223372036854775807n)
  fail('RECOVERY_INPUT_INVALID','Canonical positive bigint string required');
 return value;
}
export function digest(value:unknown):string{
 if(typeof value!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value))fail('RECOVERY_INPUT_INVALID','SHA256 digest required');
 return value;
}
export function timestamp(value:unknown):number{
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
  fail('RECOVERY_INPUT_INVALID','Canonical UTC timestamp required');
 const time=Date.parse(value);
 if(!Number.isFinite(time)||new Date(time).toISOString()!==value)fail('RECOVERY_INPUT_INVALID','Invalid calendar timestamp');
 return time;
}
export function scopeOf(value:unknown):RecoveryScope{
 const input=record(value,['organisation_id','run_id','authority_epoch']);
 return {organisation_id:uuid(input.organisation_id),run_id:uuid(input.run_id),authority_epoch:uuid(input.authority_epoch)};
}
export function capability<T>(context:ComponentContext,id:string,name:string,guard:(value:unknown)=>value is T):T{
 const dependencies=(context as unknown as {dependencies?:Dependencies}).dependencies;
 if(!dependencies)fail('RECOVERY_DEPENDENCY_UNAVAILABLE','Required trusted recovery dependency is unavailable');
 try{return dependencies.require(id,name,guard);}
 catch{fail('RECOVERY_DEPENDENCY_UNAVAILABLE','Required trusted recovery dependency is unavailable');}
}
export function isGateway(value:unknown):value is RecoveryGateway{return object(value)&&typeof value.withPrimaryTransaction==='function';}
export function isAuthority(value:unknown):value is RecoveryAuthority{return object(value)&&typeof value.assertCurrent==='function';}
export interface RecoveryExecutionControls {
 applyExecutionControl(tx:RecoveryTransaction,scope:RecoveryScope,input:{scope_kind:'RUN'|'PACKAGE'|'ATTEMPT'|'SANDBOX';scope_id:string;mode:'ACTIVE'|'PAUSE'|'DRAIN'|'STOP';operation_id:string;reason:string;expected_generation?:string;resume?:boolean;deadline_at?:string;fallback_mode?:'PAUSE'|'STOP'}):Promise<unknown>;
}
export function isExecutionControls(value:unknown):value is RecoveryExecutionControls{return object(value)&&typeof value.applyExecutionControl==='function';}
export function derivedOperationId(namespace:string,label:string):string{
 const bytes=createHash('sha256').update(namespace+'\n'+label).digest().subarray(0,16);bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128;
 const h=bytes.toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
export function isSupervisor(value:unknown):value is RecoverySupervisor{return object(value)&&typeof value.observe==='function'&&typeof value.stop==='function';}
export function canonical(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
}
export function inputDigest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}
let migrationChecksum:Promise<string>|undefined;
export async function recoveryReady(tx:Pick<RecoveryTransaction,'query'>):Promise<void>{
 migrationChecksum??=fs.readFile(new URL('../../migrations/0024-recovery.sql',import.meta.url)).then(bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex'));
 const checksum=await migrationChecksum;
 const result=await tx.query('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=24');
 if(result.rows.length!==1||result.rows[0]!.name!=='0024-recovery'||result.rows[0]!.checksum!==checksum)
  fail('RECOVERY_SCHEMA_NOT_READY','Reviewed recovery migration is not installed');
}
export async function lockRun(tx:RecoveryTransaction,scope:RecoveryScope):Promise<pg.QueryResultRow>{
 const result=await tx.query('SELECT id,authority_epoch,state,spec_generation,state_version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[scope.organisation_id,scope.run_id]);
 if(result.rows.length!==1)fail('RECOVERY_RUN_NOT_FOUND','Run is unavailable in this organisation');
 const run=result.rows[0]!;
 if(run.authority_epoch!==scope.authority_epoch)fail('RECOVERY_STALE_EPOCH','Run authority epoch changed; reconcile before retry');
 return run;
}
export async function recoveryTransaction<T>(context:ComponentContext,scope:RecoveryScope,body:(tx:RecoveryTransaction)=>Promise<T>,requiresExternalAuthority=false,observation=false):Promise<T>{
 const invocation=invocationOf(context);
 if(invocation.principal.organisation_id!==scope.organisation_id||invocation.principal.run_id!==scope.run_id)fail('RECOVERY_SCOPE_DENIED','Recovery scope is outside authenticated principal');
 if(invocation.principal.deployment_epoch!==scope.authority_epoch)fail('RECOVERY_STALE_EPOCH','Authenticated deployment epoch differs from requested scope');
 if(!observation&&!['OPERATOR','COORDINATOR','LEADER'].includes(invocation.principal.role))fail('ROLE_DENIED','Run recovery mutation requires leader or coordinator authority');
 const gateway=capability(context,'4.2','storage.transactions.v1',isGateway);
 const authority=requiresExternalAuthority?capability(context,'4.4','storage.authority.v1',isAuthority):undefined;
 try{return await gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:0,signal:context.signal,
  guard:async tx=>{await invocation.guard(tx);await recoveryReady(tx);await lockRun(tx,scope);if(authority)await authority.assertCurrent(tx,scope);}
 },body);}catch(error){if(error instanceof FoundationError)throw error;throw databaseError(error);}
}
export async function operationReplay(tx:RecoveryTransaction,scope:RecoveryScope,operationId:string,kind:string,input:unknown):Promise<Record<string,unknown>|null>{
 const hash=inputDigest(input);
 const prior=await tx.query('SELECT kind,input_digest,authority_epoch,state,result FROM hyperfide.recovery_operations WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,operationId]);
 if(!prior.rows.length){
  await tx.query("INSERT INTO hyperfide.recovery_operations(organisation_id,run_id,operation_id,kind,input_digest,authority_epoch,state) VALUES($1,$2,$3,$4,$5,$6,'PENDING')",[scope.organisation_id,scope.run_id,operationId,kind,hash,scope.authority_epoch]);
  return null;
 }
 const row=prior.rows[0]!;
 if(row.kind!==kind||row.input_digest!==hash||row.authority_epoch!==scope.authority_epoch)fail('RECOVERY_IDEMPOTENCY_CONFLICT','Operation identity has different immutable inputs');
 if(row.state==='OUTCOME_UNKNOWN'||row.state==='PENDING')fail('RECOVERY_OUTCOME_UNKNOWN','Existing operation must reconcile before another mutation');
 return row.result as Record<string,unknown>;
}
export async function finishOperation(tx:RecoveryTransaction,scope:RecoveryScope,id:string,result:Record<string,unknown>,state='APPLIED'):Promise<void>{
 await tx.query('UPDATE hyperfide.recovery_operations SET state=$4,result=$5::jsonb,updated_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[scope.organisation_id,scope.run_id,id,state,JSON.stringify(result)]);
}
export async function inspectRecoveryHold(tx:Pick<RecoveryTransaction,'query'>,scope:RecoveryScope):Promise<pg.QueryResultRow[]>{
 const rows=await tx.query("SELECT scope_kind,scope_id,mode,generation,status,authority_epoch,accepted_at,deadline_at AS drain_deadline,fallback_mode FROM hyperfide.recovery_controls WHERE organisation_id=$1 AND run_id=$2 AND status='ACTIVE' ORDER BY scope_kind,scope_id",[scope.organisation_id,scope.run_id]);
 return rows.rows;
}
/** Reads one consistent authoritative snapshot. Candidate adoption grants no new compute authority. */
export async function readControlSnapshot(tx:Pick<RecoveryTransaction,'query'>,scope:RecoveryScope):Promise<Record<string,unknown>>{
  await recoveryReady(tx);
  const runs=await tx.query('SELECT id,authority_epoch,state,spec_generation,state_version,clock_timestamp() AS observed_at FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[scope.organisation_id,scope.run_id]);
  if(runs.rows.length!==1)fail('RECOVERY_RUN_NOT_FOUND','Run is unavailable in this organisation');
  if(runs.rows[0]!.authority_epoch!==scope.authority_epoch)fail('RECOVERY_STALE_EPOCH','Run authority epoch changed');
  const query=async(sql:string)=> (await tx.query(sql,[scope.organisation_id,scope.run_id])).rows;
  const packages=await query('SELECT id,package_key,wave,revision,manager_session_id,state_version FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 ORDER BY wave,id LIMIT 10001');
  const sessions=await query('SELECT id,role,connector,native_session_id,attempt_id,sandbox_id,sandbox_boot_generation,state,state_version FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 ORDER BY id LIMIT 10001');
  const attempts=await query("SELECT a.id,a.task_id,a.generation,a.authority_epoch,a.execution_state,a.compute_authority,a.sandbox_id,a.sandbox_boot_generation,a.lease_expires_at,a.state_version,l.state AS lease_state,l.expires_at AS durable_lease_expires_at,COALESCE((a.compute_authority='CURRENT' AND a.authority_epoch=r.authority_epoch AND a.lease_expires_at>clock_timestamp() AND l.state='ACTIVE' AND l.expires_at>clock_timestamp() AND a.sandbox_boot_generation=s.boot_generation AND t.current_attempt_id=a.id AND t.generation=a.generation),false) AS compute_token_current FROM hyperfide.attempts a JOIN hyperfide.runs r ON r.organisation_id=a.organisation_id AND r.id=a.run_id JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id LEFT JOIN hyperfide.compute_leases l ON l.organisation_id=a.organisation_id AND l.run_id=a.run_id AND l.attempt_id=a.id AND l.state='ACTIVE' LEFT JOIN hyperfide.sandboxes s ON s.organisation_id=a.organisation_id AND s.id=a.sandbox_id WHERE a.organisation_id=$1 AND a.run_id=$2 ORDER BY a.id LIMIT 10001");
  const custody=await query("SELECT id,task_id,source_attempt_id,source_generation,custody_generation,authority,qualification_outcome,source_manifest_digest,evidence_manifest_digest FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND authority='ACTIVE' ORDER BY id LIMIT 10001");
  const jobs=await query("SELECT id,custody_id,state,lease_generation,lease_expires_at,outcome FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','RUNNING') ORDER BY id LIMIT 10001");
  const debts=await query("SELECT id,operation_id,resource_kind,resource_id,sandbox_boot_generation,command_id,status,desired_state,observed_state,observed_at,created_at FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND status<>'RESOLVED' ORDER BY id LIMIT 10001");
  const controls=await inspectRecoveryHold(tx,scope);
  const integration=await inspectIntegrationRecovery(tx,scope);
  if([packages,sessions,attempts,custody,jobs,debts].some(rows=>rows.length>10000))fail('RECOVERY_SNAPSHOT_TOO_LARGE','Recovery snapshot exceeds bounded inventory; partition the run explicitly');
  return {scope,run:runs.rows[0],packages,sessions,attempts,submission_custody:custody,qualification_jobs:jobs,integration_recovery:integration,controls,unreachable_resource_debt:debts,
   adoption_candidates:attempts.filter(row=>row.compute_token_current).map(row=>({attempt_id:row.id,generation:row.generation,authority:'NONE',requires:'EXACT_SUPERVISOR_IDENTITY_OBSERVATION'})),
   supervision_failure_domains:1,uninterrupted_leadership_failover:'UNQUALIFIED',snapshot_consistency:'SERIALIZABLE',new_work_authorized:false};
}
export async function reconstructControl(pool:pg.Pool,scope:RecoveryScope):Promise<Record<string,unknown>>{
 const tx=await pool.connect();
 try{
  await tx.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const result=await readControlSnapshot(tx,scope);result.snapshot_consistency='REPEATABLE_READ';
  await tx.query('COMMIT');return result;
 }catch(error){try{await tx.query('ROLLBACK');}catch{}throw error instanceof FoundationError?error:databaseError(error);}
 finally{tx.release();}
}
export function evaluateOffline(input:unknown,now=Date.now(),limits:{mode:'PAUSE'|'BOUNDED_LOCAL';maxOfflineMs:number}={mode:'PAUSE',maxOfflineMs:0}):Record<string,unknown>{
 const value=record(input,['scope','attempt_id','generation','boot_generation','lease_expires_at','disconnected_at','max_offline_ms','policy','requested_operation']);
 const scope=scopeOf(value.scope);uuid(value.attempt_id);positive(value.generation);positive(value.boot_generation);
 const lease=timestamp(value.lease_expires_at),disconnected=timestamp(value.disconnected_at);
 if(typeof value.max_offline_ms!=='number'||!Number.isSafeInteger(value.max_offline_ms)||value.max_offline_ms<0||value.max_offline_ms>86400000||disconnected>now)
  fail('RECOVERY_INPUT_INVALID','Invalid bounded offline interval');
 if(!['PAUSE','BOUNDED_LOCAL'].includes(String(value.policy)))fail('RECOVERY_INPUT_INVALID','Unknown offline policy');
 if(!['LOCAL_REASONING','LOCAL_EDIT','LOCAL_TEST','CLAIM','RENEW','SUBMIT','PUBLISH','PROVISION','QUALIFY'].includes(String(value.requested_operation)))
  fail('RECOVERY_INPUT_INVALID','Unknown offline operation');
 if(!['PAUSE','BOUNDED_LOCAL'].includes(limits.mode)||!Number.isSafeInteger(limits.maxOfflineMs)||limits.maxOfflineMs<0||limits.maxOfflineMs>86400000)fail('RECOVERY_CONFIG_INVALID','Invalid trusted offline policy');
 const deadline=Math.min(lease,disconnected+Math.min(value.max_offline_ms,limits.maxOfflineMs));
 const local=['LOCAL_REASONING','LOCAL_EDIT','LOCAL_TEST'].includes(String(value.requested_operation));
 return {scope,local_continuation:limits.mode==='BOUNDED_LOCAL'&&value.policy==='BOUNDED_LOCAL'&&local&&now<deadline,deadline_at:new Date(deadline).toISOString(),
  authority:'NONE',requires_previously_validated_token:true,requires_runner_monotonic_deadline:true,
  new_claims:false,renewals:false,submission:false,publication:false,provisioning:false,qualification:false,
  reason:now>=deadline?'OFFLINE_BUDGET_EXPIRED':local&&limits.mode==='BOUNDED_LOCAL'&&value.policy==='BOUNDED_LOCAL'?'WITHIN_CONSERVATIVE_LOCAL_CEILING':'SAFE_PAUSE'};
}
export async function inspectIntegrationRecovery(tx:Pick<RecoveryTransaction,'query'>,scope:RecoveryScope):Promise<{ready:boolean;jobs:pg.QueryResultRow[];scope_jobs:pg.QueryResultRow[]}>{
 const found=await tx.query("SELECT to_regclass('hyperfide.integration_jobs') IS NOT NULL AND to_regclass('hyperfide.integration_scope_jobs') IS NOT NULL AS ready");
 if(found.rows[0]?.ready!==true)return {ready:false,jobs:[],scope_jobs:[]};
 const jobs=await tx.query("SELECT id,executor_id,reservation_id,state FROM hyperfide.integration_jobs WHERE organisation_id=$1 AND run_id=$2 AND state IN ('RUNNING','OUTCOME_UNKNOWN') ORDER BY id LIMIT 10001",[scope.organisation_id,scope.run_id]);
 const scopes=await tx.query("SELECT id,executor_id,reservation_id,state,level,wave,input_manifest_digest FROM hyperfide.integration_scope_jobs WHERE organisation_id=$1 AND run_id=$2 AND state IN ('RUNNING','OUTCOME_UNKNOWN') ORDER BY id LIMIT 10001",[scope.organisation_id,scope.run_id]);
 if(jobs.rows.length>10000||scopes.rows.length>10000)fail('RECOVERY_SNAPSHOT_TOO_LARGE','Integration recovery inventory exceeds bounded snapshot');
 return {ready:true,jobs:jobs.rows,scope_jobs:scopes.rows};
}
export function createRecoveryControlCapability(){
 return Object.freeze({
  inspectHolds:inspectRecoveryHold,
  assertQuiesced:async(tx:RecoveryTransaction,scope:RecoveryScope):Promise<void>=>{
   assertPrimaryTransaction(tx);await recoveryReady(tx);
   const run=await lockRun(tx,scope);
   if(!['PAUSED','DRAINED','STOPPED','CANCELLED'].includes(String(run.state)))fail('RECOVERY_NOT_QUIESCED','Run is not durably paused or stopped');
   const live=await tx.query("SELECT EXISTS(SELECT 1 FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND compute_authority='CURRENT' AND lease_expires_at>clock_timestamp()) OR EXISTS(SELECT 1 FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND state='RUNNING' AND lease_expires_at>clock_timestamp()) OR EXISTS(SELECT 1 FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND status<>'RESOLVED') AS blocked",[scope.organisation_id,scope.run_id]);
   if(live.rows[0]?.blocked!==false)fail('RECOVERY_NOT_QUIESCED','Live authority or unresolved resource debt remains');
  },
  assertNoNewEffects:async(tx:RecoveryTransaction,scope:RecoveryScope):Promise<void>=>{
   assertPrimaryTransaction(tx);await lockRun(tx,scope);
   const effects=await tx.query("SELECT EXISTS(SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) OR EXISTS(SELECT 1 FROM hyperfide.publication_intents WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','EXECUTING')) AS blocked",[scope.organisation_id,scope.run_id]);
   const integration=await inspectIntegrationRecovery(tx,scope);
   if(effects.rows[0]?.blocked!==false||!integration.ready||integration.jobs.length||integration.scope_jobs.length)fail('RECOVERY_EXTERNAL_EFFECTS_UNRESOLVED','External effects require owner reconciliation');
  }
 });
}
export function getPoolForRecovery(context:ComponentContext):pg.Pool{return getPool(context.env);}
export function createComponent(_context:ComponentContext):Component{
 return {apiVersion:1,actions:{
  'recovery.control.describe':(input,context)=>{record(input,[]);return {api_version:1,supervision_failure_domains:1,uninterrupted_failover:'UNQUALIFIED',compute_authority:'PRIMARY_GUARDED',offline_external_mutations:false};},
  'recovery.control.reconstruct':(input,context)=>{const scope=scopeOf(input);return recoveryTransaction(context,scope,tx=>readControlSnapshot(tx,scope),false,true);},
  'recovery.offline.evaluate':(input,context)=>{
   const mode=context.env.HYPERFIDE_OFFLINE_POLICY??'PAUSE',budget=context.env.HYPERFIDE_MAX_OFFLINE_MS??'0';
   if(!['PAUSE','BOUNDED_LOCAL'].includes(mode)||!/^(0|[1-9][0-9]*)$/.test(budget))fail('RECOVERY_CONFIG_INVALID','Invalid trusted offline policy');
   return evaluateOffline(input,Date.now(),{mode:mode as 'PAUSE'|'BOUNDED_LOCAL',maxOfflineMs:Number(budget)});
  },
  'recovery.control.adopt':async(input,context)=>{
   const value=record(input,['scope','operation_id','session_id']);
   const scope=scopeOf(value.scope),id=uuid(value.operation_id),sessionId=uuid(value.session_id);
   const supervisor=capability(context,'12.4','runner.supervisors.v1',isSupervisor);
   const before=await recoveryTransaction(context,scope,async tx=>{
    const sessions=await tx.query("SELECT s.id,s.attempt_id,s.sandbox_id,s.sandbox_boot_generation,s.state,a.generation,a.compute_authority,a.lease_expires_at,a.authority_epoch,a.execution_state,t.current_attempt_id,t.generation AS task_generation,b.boot_generation AS observed_boot FROM hyperfide.agent_sessions s LEFT JOIN hyperfide.attempts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND a.id=s.attempt_id LEFT JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id LEFT JOIN hyperfide.sandboxes b ON b.organisation_id=s.organisation_id AND b.id=s.sandbox_id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.id=$3",[scope.organisation_id,scope.run_id,sessionId]);
    const row=sessions.rows[0];if(!row||!row.attempt_id||row.compute_authority!=='CURRENT'||row.authority_epoch!==scope.authority_epoch||row.current_attempt_id!==row.attempt_id||row.task_generation!==row.generation||row.sandbox_boot_generation!==row.observed_boot||Date.parse(String(row.lease_expires_at))<=Date.now())
     fail('RECOVERY_ADOPTION_REFUSED','Session lacks an exact live current compute token');
    return row;
   },true);
   const observed=await supervisor.observe({scope,session_id:sessionId,attempt_id:before.attempt_id as string,sandbox_id:before.sandbox_id as string,boot_generation:before.sandbox_boot_generation as string});
   digest(observed.evidence_digest);const at=timestamp(observed.observed_at);
   if(observed.status!=='MATCHED_RUNNING'||Math.abs(Date.now()-at)>30000)fail('RECOVERY_ADOPTION_REFUSED','Exact current supervisor identity was not freshly observed');
   return recoveryTransaction(context,scope,async tx=>{
    const replay=await operationReplay(tx,scope,id,'CONTROL_RECOVER',value);if(replay)return replay;
    const current=await tx.query("SELECT s.id FROM hyperfide.agent_sessions s JOIN hyperfide.attempts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND a.id=s.attempt_id JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id JOIN hyperfide.compute_leases l ON l.organisation_id=a.organisation_id AND l.run_id=a.run_id AND l.attempt_id=a.id AND l.state='ACTIVE' JOIN hyperfide.sandboxes b ON b.organisation_id=s.organisation_id AND b.id=s.sandbox_id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.id=$3 AND a.generation=$4 AND t.current_attempt_id=a.id AND t.generation=a.generation AND a.compute_authority='CURRENT' AND a.authority_epoch=$5 AND a.lease_expires_at>clock_timestamp() AND l.expires_at>clock_timestamp() AND s.sandbox_boot_generation=b.boot_generation AND s.state IN ('RUNNING','DISCONNECTED') FOR UPDATE OF s,a",[scope.organisation_id,scope.run_id,sessionId,before.generation,scope.authority_epoch]);
    if(current.rows.length!==1)fail('RECOVERY_ADOPTION_REFUSED','Compute token changed while observing the supervisor');
    await tx.query("UPDATE hyperfide.agent_sessions SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='DISCONNECTED'",[scope.organisation_id,scope.run_id,sessionId]);
    const result={scope,session_id:sessionId,adopted_existing:true,new_attempt_created:false,lease_extended:false,evidence_digest:observed.evidence_digest,observed_at:observed.observed_at};
    await finishOperation(tx,scope,id,result);return result;
   },true);
  },
  'recovery.control.resume':async(input,context)=>{
   const value=record(input,['scope','operation_id']);const scope=scopeOf(value.scope),id=uuid(value.operation_id);
   return recoveryTransaction(context,scope,async tx=>{
    const replay=await operationReplay(tx,scope,id,'RESUME',value);if(replay)return replay;
    const open=await tx.query("SELECT count(*)::text AS count FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND status<>'RESOLVED'",[scope.organisation_id,scope.run_id]);
    if(open.rows[0]!.count!=='0')fail('RECOVERY_DEBT_OPEN','External recovery debt must reconcile before resume');
    const blocked=await tx.query("SELECT (SELECT count(*) FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN'))+(SELECT count(*) FROM hyperfide.publication_intents WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','EXECUTING')) AS count",[scope.organisation_id,scope.run_id]);
    if(String(blocked.rows[0]!.count)!=='0')fail('RECOVERY_PUBLICATION_UNRESOLVED','External publication outcomes must reconcile before resume');
    await createRecoveryControlCapability().assertQuiesced(tx,scope);
    await createRecoveryControlCapability().assertNoNewEffects(tx,scope);
    const holds=await inspectRecoveryHold(tx,scope);
    if(holds.some(row=>row.mode==='CANCEL'))fail('RECOVERY_TERMINAL_CONTROL','Cancelled scopes cannot resume');
    const gate=capability(context,'5.1','scheduler.controls.v1',isExecutionControls);
    for(const hold of holds){
     const current=await tx.query("SELECT generation,mode FROM hyperfide.execution_controls WHERE organisation_id=$1 AND run_id=$2 AND scope_kind=$3 AND scope_id=$4 FOR UPDATE",[scope.organisation_id,scope.run_id,hold.scope_kind,hold.scope_id]);
     const expected=hold.mode==='CANCEL'?'STOP':hold.mode;
     if(current.rows.length!==1||current.rows[0]!.mode!==expected)fail('RECOVERY_GATE_MISMATCH','Scheduler control must match the reconciled recovery hold');
     await gate.applyExecutionControl(tx,scope,{scope_kind:hold.scope_kind as 'RUN'|'PACKAGE'|'ATTEMPT'|'SANDBOX',scope_id:uuid(hold.scope_id),mode:'ACTIVE',operation_id:derivedOperationId(id,String(hold.scope_kind)+':'+String(hold.scope_id)),reason:'Verified recovery resume',expected_generation:positive(current.rows[0]!.generation),resume:true});
    }
    await tx.query("UPDATE hyperfide.recovery_controls SET status='COMPLETE',generation=generation+1,updated_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND status='ACTIVE' AND mode IN ('PAUSE','DRAIN','STOP')",[scope.organisation_id,scope.run_id]);
    const changed=await tx.query("UPDATE hyperfide.runs SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND state IN ('PAUSED','DRAINED','STOPPED') RETURNING state,state_version",[scope.organisation_id,scope.run_id]);
    if(changed.rowCount!==1)fail('RECOVERY_RUN_STATE_INVALID','Only a paused or fully stopped run can resume');
    const result={resumed:true,scope,state_version:changed.rows[0]!.state_version,reconciled:true,fresh_attempts_required:true};
    await finishOperation(tx,scope,id,result);return result;
   },true);
  }
 }};
}
