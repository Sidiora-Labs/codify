import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {databaseError} from '../storage/schema.js';
import {assertPrimaryTransaction,type PrimaryTransaction} from '../storage/transactions.js';
import {lockRun as lockEventRun} from '../events/outbox.js';
import {readSemanticDisposition,writeSemanticDisposition} from '../storage/dispositions.js';
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
export interface RecoveryEvents {recoverySnapshot(tx:RecoveryTransaction,input:{organisation_id:string;run_id:string;limit:number}):Promise<unknown>}
export interface RecoverySnapshotReader {read(tx:RecoveryTransaction,scope:RecoveryScope):Promise<Record<string,unknown>>}
export function isRecoveryEvents(value:unknown):value is RecoveryEvents{return object(value)&&typeof value.recoverySnapshot==='function'}
export function isRecoverySnapshotReader(value:unknown):value is RecoverySnapshotReader{return object(value)&&typeof value.read==='function'}
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
export async function lockRun(tx:RecoveryTransaction,scope:RecoveryScope,write=true):Promise<pg.QueryResultRow>{
 const result=await tx.query('SELECT id,authority_epoch,state,spec_generation,state_version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 '+(write?'FOR UPDATE':'FOR SHARE'),[scope.organisation_id,scope.run_id]);
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
 try{return await gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal:context.signal,
  guard:async tx=>{await (observation?readSemanticDisposition:writeSemanticDisposition)(tx as PrimaryTransaction,scope);await lockEventRun(tx as PrimaryTransaction,scope,observation?'shared':'exclusive');await invocation.guard(tx);await recoveryReady(tx);await lockRun(tx,scope,!observation);if(authority)await authority.assertCurrent(tx,scope);}
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
export async function readControlSnapshot(tx:Pick<RecoveryTransaction,'query'>,scope:RecoveryScope,events?:RecoveryEvents):Promise<Record<string,unknown>>{
  await recoveryReady(tx);
  const runs=await tx.query('SELECT id,authority_epoch,state,spec_generation,state_version,clock_timestamp() AS observed_at FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[scope.organisation_id,scope.run_id]);
  if(runs.rows.length!==1)fail('RECOVERY_RUN_NOT_FOUND','Run is unavailable in this organisation');
  if(runs.rows[0]!.authority_epoch!==scope.authority_epoch)fail('RECOVERY_STALE_EPOCH','Run authority epoch changed');
  const query=async(sql:string)=> (await tx.query(sql,[scope.organisation_id,scope.run_id])).rows;
  const packages=await query('SELECT id,package_key,wave,revision,manager_session_id,state_version FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 ORDER BY wave,id LIMIT 10001');
  const sessions=await query('SELECT id,role,connector,native_session_id,attempt_id,sandbox_id,sandbox_boot_generation,state,state_version FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 ORDER BY id LIMIT 10001');
  const attempts=await query("SELECT a.id,a.task_id,a.generation,a.authority_epoch,a.execution_state,a.compute_authority,a.sandbox_id,a.sandbox_boot_generation,a.lease_expires_at,a.state_version,l.state AS lease_state,l.expires_at AS durable_lease_expires_at,COALESCE((a.compute_authority='CURRENT' AND a.authority_epoch=r.authority_epoch AND a.lease_expires_at>clock_timestamp() AND l.state='ACTIVE' AND l.expires_at>clock_timestamp() AND a.sandbox_boot_generation=s.boot_generation AND t.current_attempt_id=a.id AND t.generation=a.generation),false) AS compute_token_current FROM hyperfide.attempts a JOIN hyperfide.runs r ON r.organisation_id=a.organisation_id AND r.id=a.run_id JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id LEFT JOIN hyperfide.compute_leases l ON l.organisation_id=a.organisation_id AND l.run_id=a.run_id AND l.attempt_id=a.id AND l.state='ACTIVE' LEFT JOIN hyperfide.sandboxes s ON s.organisation_id=a.organisation_id AND s.id=a.sandbox_id WHERE a.organisation_id=$1 AND a.run_id=$2 ORDER BY a.id LIMIT 10001");
  const restorationRequests=await query("SELECT id,task_id,source_attempt_id,source_attempt_generation,source_boot_generation,authority_epoch,state,state_version,created_at,updated_at FROM hyperfide.recovery_replacement_requests WHERE organisation_id=$1 AND run_id=$2 AND state NOT IN ('READY','CANCELLED') ORDER BY id LIMIT 10001");
  const custody=await query("SELECT id,task_id,source_attempt_id,source_generation,custody_generation,authority,qualification_outcome,source_manifest_digest,evidence_manifest_digest FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND authority='ACTIVE' ORDER BY id LIMIT 10001");
  const jobs=await query("SELECT id,custody_id,state,lease_generation,lease_expires_at,outcome FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','RUNNING') ORDER BY id LIMIT 10001");
  const debts=await query("SELECT id,operation_id,resource_kind,resource_id,sandbox_boot_generation,command_id,status,desired_state,observed_state,observed_at,created_at FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND status<>'RESOLVED' ORDER BY id LIMIT 10001");
  const controls=await inspectRecoveryHold(tx,scope);
  const integration=await inspectIntegrationRecovery(tx,scope);
  const sessionRecovery=await inspectSessionRecovery(tx,scope);
  const eventRecovery=events?await events.recoverySnapshot(tx as RecoveryTransaction,{organisation_id:scope.organisation_id,run_id:scope.run_id,limit:64}):{ready:false,reason:'PRIMARY_BRANDED_EVENT_READER_REQUIRED',task_completion_authority:false};

  if([packages,sessions,attempts,custody,jobs,debts,sessionRecovery].some(rows=>rows.length>10000))fail('RECOVERY_SNAPSHOT_TOO_LARGE','Recovery snapshot exceeds bounded inventory; partition the run explicitly');
  return {scope,run:runs.rows[0],packages,sessions,attempts,submission_custody:custody,worker_restoration_requests:restorationRequests,qualification_jobs:jobs,integration_recovery:integration,event_recovery:eventRecovery,controls,unreachable_resource_debt:debts,
   session_recovery:sessionRecovery,
   adoption_candidates:attempts.filter(row=>row.compute_token_current&&!sessionRecovery.some(item=>item.attempt_id===row.id&&item.liveness!=='UNPROVEN')).map(row=>({attempt_id:row.id,generation:row.generation,authority:'NONE',requires:'EXACT_SUPERVISOR_IDENTITY_OBSERVATION'})),
   supervision_failure_domains:1,uninterrupted_leadership_failover:'UNQUALIFIED',snapshot_consistency:'SERIALIZABLE',new_work_authorized:false};
}
/** Recorded state, a PID or an open pipe is never live progress; only an exact supervisor identity observation is.
 * Native resume support is reported from durable checkpoints and is never claimed as verified here. */
export async function inspectSessionRecovery(tx:Pick<RecoveryTransaction,'query'>,scope:RecoveryScope):Promise<Record<string,unknown>[]>{
 const found=await tx.query("SELECT to_regclass('hyperfide.native_session_bindings') IS NOT NULL AND to_regclass('hyperfide.native_session_checkpoints') IS NOT NULL AS ready");
 const native=found.rows[0]?.ready===true;
 const rows=(await tx.query(native?
  "SELECT s.id,s.role,s.connector,s.attempt_id,s.state,s.native_session_id,a.generation AS attempt_generation,b.process_id IS NOT NULL AS process_identity_recorded,COALESCE(b.process_exited,false) AS process_exited,(b.boot_id IS NOT NULL AND cb.boot_id IS DISTINCT FROM b.boot_id) AS boot_identity_changed,c.id AS checkpoint_id,c.support_level,c.attempt_id AS checkpoint_attempt_id,c.attempt_generation AS checkpoint_generation,(n.checkpoint_id IS NOT NULL AND n.native_session_id=s.native_session_id AND n.source_manifest_digest=b.source_manifest_digest AND n.configuration_digest=b.configuration_digest) AS native_checkpoint_consistent FROM hyperfide.agent_sessions s LEFT JOIN hyperfide.attempts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND a.id=s.attempt_id LEFT JOIN hyperfide.native_session_bindings b ON b.organisation_id=s.organisation_id AND b.run_id=s.run_id AND b.session_id=s.id LEFT JOIN hyperfide.sandboxes x ON x.organisation_id=s.organisation_id AND x.id=s.sandbox_id LEFT JOIN hyperfide.sandbox_boots cb ON cb.organisation_id=x.organisation_id AND cb.sandbox_id=x.id AND cb.boot_generation=x.boot_generation LEFT JOIN LATERAL (SELECT id,support_level,attempt_id,attempt_generation FROM hyperfide.checkpoints k WHERE k.organisation_id=s.organisation_id AND k.run_id=s.run_id AND k.agent_session_id=s.id ORDER BY k.created_at DESC,k.id DESC LIMIT 1) c ON true LEFT JOIN hyperfide.native_session_checkpoints n ON n.organisation_id=s.organisation_id AND n.run_id=s.run_id AND n.session_id=s.id AND n.checkpoint_id=c.id WHERE s.organisation_id=$1 AND s.run_id=$2 ORDER BY s.id LIMIT 10001":
  "SELECT s.id,s.role,s.connector,s.attempt_id,s.state,s.native_session_id,a.generation AS attempt_generation,false AS process_identity_recorded,false AS process_exited,false AS boot_identity_changed,c.id AS checkpoint_id,c.support_level,c.attempt_id AS checkpoint_attempt_id,c.attempt_generation AS checkpoint_generation,false AS native_checkpoint_consistent FROM hyperfide.agent_sessions s LEFT JOIN hyperfide.attempts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND a.id=s.attempt_id LEFT JOIN LATERAL (SELECT id,support_level,attempt_id,attempt_generation FROM hyperfide.checkpoints k WHERE k.organisation_id=s.organisation_id AND k.run_id=s.run_id AND k.agent_session_id=s.id ORDER BY k.created_at DESC,k.id DESC LIMIT 1) c ON true WHERE s.organisation_id=$1 AND s.run_id=$2 ORDER BY s.id LIMIT 10001",
  [scope.organisation_id,scope.run_id])).rows;
 return rows.map(row=>{
  const liveness=row.process_exited?'PROCESS_EXITED':row.boot_identity_changed?'BOOT_IDENTITY_CHANGED':'UNPROVEN';
  const sameAttempt=row.checkpoint_id!==null&&row.checkpoint_attempt_id===row.attempt_id&&row.checkpoint_generation===row.attempt_generation;
  const support=row.checkpoint_id===null?'UNKNOWN':String(row.support_level);
  const consistent=sameAttempt&&(support==='SOURCE_ONLY'||(support==='NATIVE_RESUME'&&row.native_checkpoint_consistent===true));
  const recovery_mode=consistent&&support==='NATIVE_RESUME'?'NATIVE_RESUME_FROM_CHECKPOINT':consistent?'FRESH_SESSION_FROM_SOURCE_CHECKPOINT':'FRESH_SESSION_WITH_RECOVERY_PACKET';
  const limitation=row.checkpoint_id===null?'NO_CHECKPOINT':!sameAttempt?'CHECKPOINT_ATTEMPT_MISMATCH':support==='UNSUPPORTED'?'CONNECTOR_NATIVE_RESUME_UNSUPPORTED':support==='NATIVE_RESUME'&&!consistent?'NATIVE_CHECKPOINT_SESSION_OR_SOURCE_INCONSISTENT':support==='SOURCE_ONLY'?'SOURCE_ONLY_CHECKPOINT':'NATIVE_RESUME_UNVERIFIED_WITHOUT_SUPERVISOR';
  return {session_id:row.id,role:row.role,connector:row.connector,attempt_id:row.attempt_id,recorded_state:row.state,
   process_identity_recorded:row.process_identity_recorded===true,liveness,live_progress:false,liveness_requires:'EXACT_SUPERVISOR_IDENTITY_OBSERVATION',
   checkpoint_id:row.checkpoint_id,checkpoint_consistent:consistent,native_resume_support:support,native_resume_verified:false,native_resume_limitation:limitation,recovery_mode};
 });
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
export async function inspectIntegrationRecovery(tx:Pick<RecoveryTransaction,'query'>,scope:RecoveryScope):Promise<{ready:boolean;jobs:pg.QueryResultRow[];scope_jobs:pg.QueryResultRow[];preparations:pg.QueryResultRow[]}>{
 const found=await tx.query("SELECT to_regclass('hyperfide.integration_jobs') IS NOT NULL AND to_regclass('hyperfide.integration_scope_jobs') IS NOT NULL AND to_regclass('hyperfide.integration_preparations') IS NOT NULL AS ready");
 if(found.rows[0]?.ready!==true)return {ready:false,jobs:[],scope_jobs:[],preparations:[]};
 const jobs=await tx.query("SELECT id,executor_id,reservation_id,state FROM hyperfide.integration_jobs WHERE organisation_id=$1 AND run_id=$2 AND state IN ('RUNNING','OUTCOME_UNKNOWN') ORDER BY id LIMIT 10001",[scope.organisation_id,scope.run_id]);
 const scopes=await tx.query("SELECT id,executor_id,reservation_id,state,level,wave,input_manifest_digest FROM hyperfide.integration_scope_jobs WHERE organisation_id=$1 AND run_id=$2 AND state IN ('RUNNING','OUTCOME_UNKNOWN') ORDER BY id LIMIT 10001",[scope.organisation_id,scope.run_id]);
 const preparations=await tx.query("SELECT request_id,request_digest,state,created_at,false AS execution_manifest_included FROM hyperfide.integration_preparations WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PREPARING','OUTCOME_UNKNOWN') ORDER BY request_id LIMIT 10001",[scope.organisation_id,scope.run_id]);
 if(jobs.rows.length>10000||scopes.rows.length>10000||preparations.rows.length>10000)fail('RECOVERY_SNAPSHOT_TOO_LARGE','Integration recovery inventory exceeds bounded snapshot');
 return {ready:true,jobs:jobs.rows,scope_jobs:scopes.rows,preparations:preparations.rows};
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
   if(effects.rows[0]?.blocked!==false||!integration.ready||integration.jobs.length||integration.scope_jobs.length||integration.preparations.length)fail('RECOVERY_EXTERNAL_EFFECTS_UNRESOLVED','External effects require owner reconciliation');
  }
 });
}
export const SUPERVISOR_PROVIDER={id:'12.4',capability:'runner.supervisors.v1'} as const;
export function supervisorCapability(context:ComponentContext):RecoverySupervisor{
 try{return capability(context,SUPERVISOR_PROVIDER.id,SUPERVISOR_PROVIDER.capability,isSupervisor);}
 catch{fail('RECOVERY_DEPENDENCY_UNAVAILABLE','Recovery supervisor capability absent: no declared component provides '+SUPERVISOR_PROVIDER.capability+'; adoption is refused, never inferred');}
}
function supervisorPresent(context:ComponentContext):boolean{try{supervisorCapability(context);return true;}catch{return false;}}
export function createComponent(startup:ComponentContext):Component{
 const events=capability(startup,'6.4','events.recovery.v1',isRecoveryEvents);
 const snapshots:RecoverySnapshotReader=Object.freeze({read:(tx:RecoveryTransaction,scope:RecoveryScope)=>readControlSnapshot(tx,scope,events)});
 return {apiVersion:1,capabilities:{'recovery.snapshots.v1':snapshots},actions:{
  'recovery.control.describe':(input,context)=>{record(input,[]);return {api_version:1,supervision_failure_domains:1,uninterrupted_failover:'UNQUALIFIED',standby_qualification:'ABSENT',uninterrupted_failover_requires:'SEPARATELY_QUALIFIED_STANDBY',
   supervisor_capability:supervisorPresent(context)?'PRESENT':'ABSENT',compute_authority:'PRIMARY_GUARDED',offline_external_mutations:false,
   offline_policy:['PAUSE','BOUNDED_LOCAL'].includes(context.env.HYPERFIDE_OFFLINE_POLICY??'PAUSE')?context.env.HYPERFIDE_OFFLINE_POLICY??'PAUSE':'INVALID'};},
  'recovery.control.reconstruct':(input,context)=>{const scope=scopeOf(input);return recoveryTransaction(context,scope,tx=>snapshots.read(tx,scope),false,true);},
  'recovery.offline.evaluate':(input,context)=>{
   const mode=context.env.HYPERFIDE_OFFLINE_POLICY??'PAUSE',budget=context.env.HYPERFIDE_MAX_OFFLINE_MS??'0';
   if(!['PAUSE','BOUNDED_LOCAL'].includes(mode)||!/^(0|[1-9][0-9]*)$/.test(budget))fail('RECOVERY_CONFIG_INVALID','Invalid trusted offline policy');
   return evaluateOffline(input,Date.now(),{mode:mode as 'PAUSE'|'BOUNDED_LOCAL',maxOfflineMs:Number(budget)});
  },
  'recovery.control.adopt':async(input,context)=>{
   const value=record(input,['scope','operation_id','session_id']);
   const scope=scopeOf(value.scope),id=uuid(value.operation_id),sessionId=uuid(value.session_id);
   const before=await recoveryTransaction(context,scope,async tx=>{
    const sessions=await tx.query("SELECT s.id,s.attempt_id,s.sandbox_id,s.sandbox_boot_generation,s.state,a.generation,a.compute_authority,a.lease_expires_at,a.authority_epoch,a.execution_state,t.current_attempt_id,t.generation AS task_generation,b.boot_generation AS observed_boot FROM hyperfide.agent_sessions s LEFT JOIN hyperfide.attempts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND a.id=s.attempt_id LEFT JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id LEFT JOIN hyperfide.sandboxes b ON b.organisation_id=s.organisation_id AND b.id=s.sandbox_id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.id=$3",[scope.organisation_id,scope.run_id,sessionId]);
    const row=sessions.rows[0];if(!row||!row.attempt_id||row.compute_authority!=='CURRENT'||row.authority_epoch!==scope.authority_epoch||row.current_attempt_id!==row.attempt_id||row.task_generation!==row.generation||row.sandbox_boot_generation!==row.observed_boot||Date.parse(String(row.lease_expires_at))<=Date.now())
     fail('RECOVERY_ADOPTION_REFUSED','Session lacks an exact live current compute token');
    const liveness=(await inspectSessionRecovery(tx,scope)).find(item=>item.session_id===sessionId);
    if(liveness?.liveness!=='UNPROVEN')fail('RECOVERY_ADOPTION_REFUSED','Recorded process exited or belongs to another boot; a dead pipe or reused PID is not live progress');
    return row;
   },true);
   const supervisor=supervisorCapability(context);
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
    const holds=await inspectRecoveryHold(tx,scope);
    const run=(await tx.query('SELECT state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[scope.organisation_id,scope.run_id])).rows[0]!;
    if(holds.some(row=>row.mode==='CANCEL')||['CANCELLING','CANCELLED'].includes(String(run.state)))fail('RECOVERY_TERMINAL_CONTROL','Cancelled scopes cannot resume');
    if(!['PAUSED','DRAINED','STOPPED'].includes(String(run.state)))fail('RECOVERY_RUN_STATE_INVALID','Only a paused or fully stopped run can resume');
    const open=await tx.query("SELECT count(*)::text AS count FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND status<>'RESOLVED'",[scope.organisation_id,scope.run_id]);
    if(open.rows[0]!.count!=='0')fail('RECOVERY_DEBT_OPEN','External recovery debt must reconcile before resume');
    const blocked=await tx.query("SELECT (SELECT count(*) FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN'))+(SELECT count(*) FROM hyperfide.publication_intents WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','EXECUTING')) AS count",[scope.organisation_id,scope.run_id]);
    if(String(blocked.rows[0]!.count)!=='0')fail('RECOVERY_PUBLICATION_UNRESOLVED','External publication outcomes must reconcile before resume');
    await createRecoveryControlCapability().assertQuiesced(tx,scope);
    await createRecoveryControlCapability().assertNoNewEffects(tx,scope);
    await capability(context,'4.4','storage.authority.v1',isAuthority).assertCurrent(tx,scope);
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
   });
  }
 }};
}

export interface AcceptedRunRebindInput {
 schema_version:1;organisation_id:string;run_id:string;recovery_operation_id:string;activation_operation_id:string;deployment_id:string;
 expected_run_epoch:string;target_epoch:string;expected_spec_generation:string;expected_spec_revision_id:string;expected_revision_digest:string;
 external_previous_epoch:string|null;database_predecessor_epoch:string|null;fence_proof_digest:string;external_journal_sequence:string;
}
export interface AcceptedRunRecoveryIntent extends AcceptedRunRebindInput {intent_digest:string}
/** Only trusted local deployment composition receives this factory. A signed isolation
 * permit cannot call it or authorise run rebind. All proof is read from retained journals.
 */
export function createAcceptedRunRecoveryVerifier(options:{
 resources:import('../storage/runtime.js').ServiceResources;
 journal:import('../storage/authority_journal.js').ExternalAuthorityJournal;
 fenceJournal:import('./fencing.js').FileExternalFenceJournal;
 topology:import('./fencing.js').ExternalFenceTopology;
 revokeCompute:(tx:PrimaryTransaction,input:AcceptedRunRebindInput)=>Promise<{revoked_attempts:string;revoked_allocations:string;retained_debt_references:readonly string[]}>;
}){
 return Object.freeze({prepare:async(raw:AcceptedRunRebindInput)=>{
  const fields=['schema_version','organisation_id','run_id','recovery_operation_id','activation_operation_id','deployment_id','expected_run_epoch','target_epoch','expected_spec_generation','expected_spec_revision_id','expected_revision_digest','external_previous_epoch','database_predecessor_epoch','fence_proof_digest','external_journal_sequence'];
  const value=record(raw,fields);
  if(value.schema_version!==1)fail('RECOVERY_INPUT_INVALID','Versioned accepted-run recovery identity required');
  for(const key of ['organisation_id','run_id','recovery_operation_id','activation_operation_id','deployment_id','expected_run_epoch','target_epoch','expected_spec_revision_id'])uuid(value[key]);
  for(const key of ['external_previous_epoch','database_predecessor_epoch'])if(value[key]!==null)uuid(value[key]);
  positive(value.expected_spec_generation);positive(value.external_journal_sequence);digest(value.expected_revision_digest);digest(value.fence_proof_digest);
  const input=structuredClone(raw),trusted=options.topology;
  if(input.target_epoch===input.expected_run_epoch||input.deployment_id!==trusted.deployment_id||input.organisation_id!==trusted.organisation_id||input.run_id!==trusted.run_id||input.external_previous_epoch!==trusted.source_epoch||trusted.evidence_scope!=='LIVE_PROVIDER')
   fail('RECOVERY_REBIND_SCOPE_DENIED','Recovery does not match the trusted live writer topology');
  const [{assertExternalAuthorityCurrent,lookupAuthorityActivation},{externalFenceTopologyDigest}]=await Promise.all([import('../storage/durability.js'),import('./fencing.js')]);
  const attestation=await assertExternalAuthorityCurrent(options.resources,options.journal,{deployment_id:input.deployment_id});
  const activation=await lookupAuthorityActivation(options.resources,{deployment_id:input.deployment_id,operation_id:input.activation_operation_id,expected_previous_epoch:input.external_previous_epoch,database_predecessor_epoch:input.database_predecessor_epoch,epoch:input.target_epoch});
  const physical=await options.fenceJournal.readCompleted({deployment_id:input.deployment_id,operation_id:input.activation_operation_id,source_epoch:input.external_previous_epoch,topology_digest:externalFenceTopologyDigest(trusted),expected_proof_digest:input.fence_proof_digest});
  //04 stores the exact JSON bytes hash of the full eight-field receipt.
  const physicalDigest='sha256:'+createHash('sha256').update(JSON.stringify(physical)).digest('hex');
  if(physicalDigest!==activation.evidence_digest||input.fence_proof_digest!==activation.evidence_digest||attestation.epoch!==input.target_epoch||attestation.evidence_digest!==activation.evidence_digest||attestation.sequence!==input.external_journal_sequence)
   fail('RECOVERY_REBIND_PROOF_MISMATCH','Physical fence, committed activation and non-restored journal head differ');
  const intent=Object.freeze({...input,intent_digest:inputDigest(input)});
  const verified=new WeakSet<PrimaryTransaction>();
  return Object.freeze({
   verify:async(tx:PrimaryTransaction):Promise<AcceptedRunRecoveryIntent>=>{
    assertPrimaryTransaction(tx);await writeSemanticDisposition(tx,input);await recoveryReady(tx);
    const current=(await tx.query<{epoch:string;proof_digest:string;now:string}>("SELECT epoch::text,proof_digest,clock_timestamp()::text AS now FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE' FOR SHARE",[input.deployment_id])).rows[0];
    if(!current||current.epoch!==input.target_epoch||current.proof_digest!==input.fence_proof_digest||Date.parse(attestation.expires_at)<=Date.parse(current.now)||Date.parse(attestation.observed_at)>Date.parse(current.now)+1000)
     fail('RECOVERY_REBIND_PROOF_STALE','Recovery journal attestation changed or expired before the primary transaction');
    const run=(await tx.query<{authority_epoch:string;spec_generation:string;spec_revision_id:string;revision_digest:string|null;state:string}>(
     'SELECT r.authority_epoch::text,r.spec_generation::text,r.spec_revision_id::text,s.revision_digest,r.state FROM hyperfide.runs r JOIN hyperfide.run_spec_revisions a ON a.organisation_id=r.organisation_id AND a.run_id=r.id AND a.spec_generation=r.spec_generation AND a.spec_revision_id=r.spec_revision_id AND a.accepted JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id WHERE r.organisation_id=$1 AND r.id=$2 FOR UPDATE OF r',[input.organisation_id,input.run_id])).rows[0];
    if(!run||run.spec_generation!==input.expected_spec_generation||run.spec_revision_id!==input.expected_spec_revision_id||run.revision_digest!==input.expected_revision_digest||['CANCELLED','SUCCEEDED'].includes(run.state))
     fail('RECOVERY_ACCEPTED_INTENT_MISMATCH','Only the exact nonterminal accepted run intent may be rebound');
    const prior=(await tx.query<{intent_digest:string}>('SELECT intent_digest FROM hyperfide.recovery_accepted_run_intents WHERE organisation_id=$1 AND run_id=$2 AND recovery_operation_id=$3',[input.organisation_id,input.run_id,input.recovery_operation_id])).rows[0];
    if(prior&&prior.intent_digest!==intent.intent_digest)fail('RECOVERY_IDEMPOTENCY_CONFLICT','Recovery operation already binds different accepted intent');
    if(run.authority_epoch!==input.expected_run_epoch&&!(prior&&run.authority_epoch===input.target_epoch))fail('RECOVERY_STALE_EPOCH','Run epoch differs from the exact recovery predecessor');
    await tx.query('INSERT INTO hyperfide.recovery_accepted_run_intents(organisation_id,run_id,recovery_operation_id,activation_operation_id,deployment_id,source_epoch,target_epoch,spec_generation,spec_revision_id,revision_digest,fence_proof_digest,external_journal_sequence,intent_digest,intent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) ON CONFLICT(organisation_id,run_id,recovery_operation_id) DO NOTHING',[input.organisation_id,input.run_id,input.recovery_operation_id,input.activation_operation_id,input.deployment_id,input.expected_run_epoch,input.target_epoch,input.expected_spec_generation,input.expected_spec_revision_id,input.expected_revision_digest,input.fence_proof_digest,input.external_journal_sequence,intent.intent_digest,JSON.stringify(input)]);
    verified.add(tx);return intent;
   },
   revokeCompute:async(tx:PrimaryTransaction)=>{
    assertPrimaryTransaction(tx);if(!verified.has(tx))fail('RECOVERY_REBIND_UNVERIFIED','Verify the accepted recovery intent in this exact primary transaction first');
    const result=await options.revokeCompute(tx,input);
    for(const count of [result.revoked_attempts,result.revoked_allocations])if(typeof count!=='string'||!/^(0|[1-9][0-9]*)$/.test(count))fail('RECOVERY_REBIND_REVOCATION_INVALID','Actual scheduler revocation counts must be canonical decimals');
    if(!Array.isArray(result.retained_debt_references)||result.retained_debt_references.length>10000||result.retained_debt_references.some(v=>typeof v!=='string'||v.length<1||v.length>512))fail('RECOVERY_REBIND_REVOCATION_INVALID','Bounded retained physical debt references are required');
    for(const reference of new Set(result.retained_debt_references))await tx.query('INSERT INTO hyperfide.recovery_accepted_run_debts(organisation_id,run_id,recovery_operation_id,reference,source_epoch,target_epoch) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[input.organisation_id,input.run_id,input.recovery_operation_id,reference,input.expected_run_epoch,input.target_epoch]);
    return result;
   }
  });
 }});
}
