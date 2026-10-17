import {markSandboxReleasePending} from './claim.js';
import {loadExecutionPacket} from '../hierarchy/packets.js';
import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {lockRun,enqueue} from '../events/outbox.js';
import {actorFor,boundedInteger,decimal,dispatchRecipients,fail,fields,gatewayFor,invocationFor,object,operationReplay,
  recordOutcome,requireSchedulerAuthority,assertNoExecutionHold,uuid} from './claim.js';
import type {ComputeToken,SchedulerActor,SchedulerScope} from './claim.js';

export interface ComputeAuthority extends ComputeToken {
  compute_lease_id:string;lease_expires_at:string;primary_now:string;feature_package_id:string;
  input_packet_digest:string;spec_revision_id:string;spec_generation:string;criteria_digest:string;preparation_digest:string|null;
}
export function parseComputeToken(value:unknown):ComputeToken{
  const input=fields(value,['organisation_id','run_id','task_id','attempt_id','attempt_generation',
    'authority_epoch','sandbox_id','slot_id','sandbox_boot_generation']);
  return {organisation_id:uuid(input.organisation_id,'organisation_id'),run_id:uuid(input.run_id,'run_id'),
    task_id:uuid(input.task_id,'task_id'),attempt_id:uuid(input.attempt_id,'attempt_id'),
    attempt_generation:decimal(input.attempt_generation,'attempt_generation'),
    authority_epoch:uuid(input.authority_epoch,'authority_epoch'),sandbox_id:uuid(input.sandbox_id,'sandbox_id'),
    slot_id:uuid(input.slot_id,'slot_id'),sandbox_boot_generation:decimal(input.sandbox_boot_generation,'sandbox_boot_generation')};
}
/** Only a branded, live primary transaction may validate current compute authority. */
export async function assertCurrentCompute(tx:PrimaryTransaction,token:ComputeToken,
    options:{allowExpired?:boolean;operation?:'ADMISSION'|'RENEWAL'|'CHECKPOINT'|'ADVANCE'|'CLEANUP'}={}):Promise<ComputeAuthority>{
  assertPrimaryTransaction(tx);
  const scope={organisation_id:token.organisation_id,run_id:token.run_id};
  await lockRun(tx,scope);
  const run=await tx.query<{authority_epoch:string;state:string}>(
    'SELECT authority_epoch,state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',
    [token.organisation_id,token.run_id]);
  if(!run.rows[0]||run.rows[0].authority_epoch!==token.authority_epoch)
    fail('STALE_AUTHORITY_EPOCH','Compute token does not belong to the active run epoch');
  const operation=options.operation??'ADVANCE';
  if(options.allowExpired&&operation!=='CLEANUP')fail('INVALID_REQUEST','Expired authority may only be inspected for cleanup');
  if(operation!=='CLEANUP'&&!(['RENEWAL','CHECKPOINT'].includes(operation)?['READY','RUNNING','DRAINING','PAUSING','PAUSED']:['READY','RUNNING','DRAINING']).includes(run.rows[0].state))
    fail('RUN_NOT_EXECUTING','Run state does not permit this compute operation');
  const boot=await tx.query<{boot_generation:string;preparation_digest:string|null;desired_state:string;observed_state:string}>('SELECT boot_generation,preparation_digest,desired_state,observed_state FROM hyperfide.sandboxes '+
    'WHERE organisation_id=$1 AND id=$2 FOR SHARE',[token.organisation_id,token.sandbox_id]);
  if(boot.rows[0]?.boot_generation!==token.sandbox_boot_generation)
    fail('STALE_SANDBOX_BOOT','Compute token belongs to a previous sandbox boot');
  if(operation!=='CLEANUP'&&(boot.rows[0]!.desired_state!=='RUNNING'||boot.rows[0]!.observed_state!=='RUNNING'))fail('SANDBOX_NOT_ADMITTING','Sandbox destruction or stop intent forbids further execution');
  const allocations=await tx.query(
    "SELECT a.id FROM hyperfide.slot_allocations a JOIN hyperfide.worker_slots w ON w.organisation_id=a.organisation_id AND w.id=a.slot_id AND w.sandbox_id=a.sandbox_id AND w.boot_generation=a.sandbox_boot_generation WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.attempt_id=$3 AND a.attempt_generation=$4 AND a.slot_id=$5 AND a.sandbox_id=$6 AND a.sandbox_boot_generation=$7 AND a.state='ACTIVE' AND w.state='ALLOCATED' FOR UPDATE OF a,w",
    [token.organisation_id,token.run_id,token.attempt_id,token.attempt_generation,token.slot_id,token.sandbox_id,token.sandbox_boot_generation]);
  if(allocations.rows.length!==1)fail('COMPUTE_ALLOCATION_INVALID','Current compute requires its exact active slot allocation');
  const charge=await tx.query("SELECT id FROM hyperfide.sandbox_execution_charges WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND slot_id=$4 AND sandbox_id=$5 AND sandbox_boot_generation=$6 AND job_kind='AGENT' AND state='HELD'",[token.organisation_id,token.run_id,token.attempt_id,token.slot_id,token.sandbox_id,token.sandbox_boot_generation]);
  if(charge.rows.length!==1)fail('COMPUTE_SANDBOX_BUDGET_INVALID','Current compute requires its exact held per-sandbox charge');
  const tasks=await tx.query<{current_attempt_id:string|null;generation:string;feature_package_id:string;spec_revision_id:string;spec_generation:string;criteria_digest:string}>(
    'SELECT current_attempt_id,generation,feature_package_id,spec_revision_id,spec_generation,criteria_digest FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
    [token.organisation_id,token.run_id,token.task_id]);
  const task=tasks.rows[0];
  if(!task||task.current_attempt_id!==token.attempt_id||task.generation!==token.attempt_generation)
    fail('STALE_COMPUTE','Compute token is not the current task attempt');
  const attempts=await tx.query<{id:string;compute_authority:string;authority_epoch:string;sandbox_id:string;
    slot_id:string;sandbox_boot_generation:string;lease_expires_at:string|null;input_packet_digest:string}>(
    'SELECT id,compute_authority,authority_epoch,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at::text,input_packet_digest '+
    'FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND id=$4 AND generation=$5 FOR UPDATE',
    [token.organisation_id,token.run_id,token.task_id,token.attempt_id,token.attempt_generation]);
  await assertNoExecutionHold(tx,scope,{package_id:task.feature_package_id,attempt_id:token.attempt_id,sandbox_id:token.sandbox_id,operation:options.operation??'ADVANCE'});
  const attempt=attempts.rows[0];
  if(!attempt||attempt.compute_authority!=='CURRENT'||attempt.authority_epoch!==token.authority_epoch||
      attempt.sandbox_id!==token.sandbox_id||attempt.slot_id!==token.slot_id||
      attempt.sandbox_boot_generation!==token.sandbox_boot_generation)
    fail('STALE_COMPUTE','Compute authority is released, superseded or bound to another executor');
  const custody=await tx.query('SELECT id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 '+
    'AND task_id=$3 AND authority=\'ACTIVE\' FOR SHARE',[token.organisation_id,token.run_id,token.task_id]);
  if(custody.rows.length)fail('ACTIVE_SUBMISSION_CUSTODY','Worker compute cannot mutate coordinator-owned submission custody');
  const leases=await tx.query<{id:string;expires_at:string}>(
    'SELECT id,expires_at::text FROM hyperfide.compute_leases WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 '+
    'AND attempt_generation=$4 AND authority_epoch=$5 AND sandbox_boot_generation=$6 AND state=\'ACTIVE\' FOR UPDATE',
    [token.organisation_id,token.run_id,token.attempt_id,token.attempt_generation,token.authority_epoch,token.sandbox_boot_generation]);
  if(leases.rows.length!==1)fail('STALE_COMPUTE','Compute authority has no unique active primary lease');
  const lease=leases.rows[0]!;
  // Sample primary time only after all authority/lease locks have been acquired.
  const clock=await tx.query<{primary_now:string;live:boolean;same_expiry:boolean}>(
    'SELECT clock_timestamp()::text AS primary_now,$1::timestamptz>clock_timestamp() AS live,'+
    '$1::timestamptz=$2::timestamptz AS same_expiry',[lease.expires_at,attempt.lease_expires_at]);
  if(!clock.rows[0]!.same_expiry)fail('AUTHORITY_INCONSISTENT','Attempt and compute lease expiries do not agree');
  if(!options.allowExpired&&!clock.rows[0]!.live)fail('COMPUTE_LEASE_EXPIRED','An expired compute lease cannot renew or submit');
  const packet=object((await loadExecutionPacket(tx,{organisation_id:token.organisation_id,run_id:token.run_id,digest:attempt.input_packet_digest})).packet);
  const identity=object(object(packet.mandatory).identity);
  if(object(object(packet.mandatory).runtime).preparation_digest!==boot.rows[0]!.preparation_digest)
   fail('STALE_PREPARATION','Current sandbox preparation differs from accepted compute inputs');
  if(identity.task_id!==token.task_id||identity.attempt_id!==token.attempt_id||identity.attempt_generation!==token.attempt_generation||identity.spec_revision_id!==task.spec_revision_id||identity.spec_generation!==task.spec_generation||identity.criteria_digest!==task.criteria_digest)
   fail('STALE_TASK_SPEC','Compute packet no longer matches accepted task intent');
  return {...token,compute_lease_id:lease.id,lease_expires_at:lease.expires_at,
    primary_now:clock.rows[0]!.primary_now,feature_package_id:task.feature_package_id,
    input_packet_digest:attempt.input_packet_digest,spec_revision_id:task.spec_revision_id,
    spec_generation:task.spec_generation,criteria_digest:task.criteria_digest,preparation_digest:boot.rows[0]!.preparation_digest};
}
async function requireWorker(tx:PrimaryTransaction,token:ComputeToken,context:ComponentContext):Promise<void>{
  await lockRun(tx,token);
  const principal=invocationFor(context).principal;
  if(context.policy.programme_id!==token.run_id||principal.run_id!==token.run_id||principal.organisation_id!==token.organisation_id||principal.deployment_epoch!==token.authority_epoch)
    fail('RUN_SCOPE_DENIED','Trusted actor scope does not match the compute token');
  const actor=uuid(principal.actor_id,'authenticated actor');
  const sessions=await tx.query('SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 '+
    'AND role=\'WORKER\' AND state=\'RUNNING\' AND attempt_id=$4 AND sandbox_id=$5 AND slot_id=$6 '+
    'AND sandbox_boot_generation=$7 FOR SHARE',
    [token.organisation_id,token.run_id,actor,token.attempt_id,token.sandbox_id,token.slot_id,token.sandbox_boot_generation]);
  if(sessions.rows.length!==1)fail('ACTOR_DENIED','Only the registered worker bound to this attempt may renew it');
}
export async function renewCompute(tx:PrimaryTransaction,token:ComputeToken,lease_ms:number):Promise<unknown>{
  const authority=await assertCurrentCompute(tx,token,{operation:'RENEWAL'});
  const duration=boundedInteger(lease_ms,'lease_ms',1000,300000);
  const clock=await tx.query<{expires_at:string}>(
    'SELECT (clock_timestamp()+$1::integer*interval\'1 millisecond\')::text AS expires_at',[duration]);
  const expires=clock.rows[0]!.expires_at;
  await tx.query('UPDATE hyperfide.compute_leases SET expires_at=$4,state_version=state_version+1 '+
    'WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[token.organisation_id,token.run_id,authority.compute_lease_id,expires]);
  await tx.query('UPDATE hyperfide.attempts SET lease_expires_at=$4,state_version=state_version+1 '+
    'WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[token.organisation_id,token.run_id,token.attempt_id,expires]);
  return {token,lease_expires_at:expires};
}
/**
 * Submission transfers logical compute only. Physical allocation remains counted
 * until a separate trusted cleanup observation establishes quiescence.
 */
export async function releaseCompute(tx:PrimaryTransaction,token:ComputeToken,
    disposition:{execution_state:'SUBMITTED'|'CANCELLED'}):Promise<void>{
  await assertCurrentCompute(tx,token,{allowExpired:disposition.execution_state==='CANCELLED',operation:disposition.execution_state==='CANCELLED'?'CLEANUP':'ADVANCE'});
  await markSandboxReleasePending(tx,{organisation_id:token.organisation_id,run_id:token.run_id,attempt_id:token.attempt_id});
  await tx.query('UPDATE hyperfide.attempts SET compute_authority=\'RELEASED\',execution_state=$4,state_version=state_version+1 '+
    'WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
    [token.organisation_id,token.run_id,token.attempt_id,disposition.execution_state]);
  await tx.query('UPDATE hyperfide.compute_leases SET state=\'RELEASED\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 '+
    'AND attempt_id=$3 AND attempt_generation=$4 AND state=\'ACTIVE\'',
    [token.organisation_id,token.run_id,token.attempt_id,token.attempt_generation]);
  await tx.query('UPDATE hyperfide.slot_allocations SET state=\'RELEASE_PENDING\',state_version=state_version+1 '+
    'WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state=\'ACTIVE\'',
    [token.organisation_id,token.run_id,token.attempt_id]);
  await tx.query('UPDATE hyperfide.reservations SET state=\'RELEASE_PENDING\',state_version=state_version+1 '+
    'WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state IN (\'PROVISIONING\',\'ALLOCATED\')',
    [token.organisation_id,token.run_id,token.attempt_id]);
  await tx.query('UPDATE hyperfide.worker_slots SET state=\'DRAINING\',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',
    [token.organisation_id,token.slot_id]);
}

export async function lockComputeFenceTargets(tx:PrimaryTransaction,tokens:readonly ComputeToken[]):Promise<void>{
 assertPrimaryTransaction(tx);
 if(!Array.isArray(tokens)||tokens.length>10000)fail('INVALID_REQUEST','Compute fencing requires a bounded exact token set');
 const ordered=tokens.map(parseComputeToken).sort((a,b)=>[a.organisation_id,a.run_id,a.slot_id,a.attempt_id].join(':').localeCompare([b.organisation_id,b.run_id,b.slot_id,b.attempt_id].join(':')));
 const scopes=new Map(ordered.map(token=>[token.organisation_id+':'+token.run_id,token]));
 for(const token of scopes.values())await lockRun(tx,token);
 const pools=new Set<string>();
 for(const token of ordered){
  const row=await tx.query<{pool_id:string}>('SELECT pool_id FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2',[token.organisation_id,token.sandbox_id]);
  if(row.rows[0])pools.add(token.organisation_id+':'+row.rows[0].pool_id+':resource-admission');
 }
 for(const pool of [...pools].sort())await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[pool]);
 for(const token of ordered)await tx.query(
  'SELECT a.id FROM hyperfide.slot_allocations a JOIN hyperfide.worker_slots w ON w.organisation_id=a.organisation_id AND w.id=a.slot_id AND w.sandbox_id=a.sandbox_id AND w.boot_generation=a.sandbox_boot_generation WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.attempt_id=$3 AND a.attempt_generation=$4 ORDER BY a.id FOR UPDATE OF a,w',
  [token.organisation_id,token.run_id,token.attempt_id,token.attempt_generation]);
}

export interface ComputeFenceOptions {
 actor:SchedulerActor;current_authority_epoch:string;reason:'SPEC_REPLAN'|'STOP'|'EXPIRED'|'LOST';recipients:{consumer_ids:string[]};
}
export async function fenceCompute(tx:PrimaryTransaction,token:ComputeToken,options:ComputeFenceOptions):Promise<unknown>{
 assertPrimaryTransaction(tx);await lockRun(tx,token);
 if(!['SPEC_REPLAN','STOP','EXPIRED','LOST'].includes(options.reason))fail('INVALID_REQUEST','Unknown compute fence reason');
 const run=await tx.query<{authority_epoch:string}>('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[token.organisation_id,token.run_id]);
 if(run.rows[0]?.authority_epoch!==options.current_authority_epoch)fail('STALE_AUTHORITY_EPOCH','Fencing requires current run authority');
 await lockComputeFenceTargets(tx,[token]);
 const task=await tx.query<{current_attempt_id:string|null;generation:string;feature_package_id:string}>(
 'SELECT current_attempt_id,generation,feature_package_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
 [token.organisation_id,token.run_id,token.task_id]);
 const current=task.rows[0];if(!current)fail('TASK_MISSING','Compute target does not exist in this run');
 const role=await tx.query<{role:string}>('SELECT role FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[token.organisation_id,token.run_id,options.actor.session_id]);
 await requireSchedulerAuthority(tx,token,options.actor,options.current_authority_epoch,role.rows[0]?.role==='FEATURE_MANAGER'?current.feature_package_id:undefined);
 if(current.current_attempt_id!==token.attempt_id||current.generation!==token.attempt_generation)
  return {fenced:false,reason:'ALREADY_SUPERSEDED',resource_disposition:'UNCHANGED'};
 const attempts=await tx.query<{compute_authority:string;authority_epoch:string;sandbox_id:string;slot_id:string;sandbox_boot_generation:string;lease_expires_at:string}>(
 'SELECT compute_authority,authority_epoch,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at::text FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND id=$4 AND generation=$5 FOR UPDATE',
 [token.organisation_id,token.run_id,token.task_id,token.attempt_id,token.attempt_generation]);
 const attempt=attempts.rows[0];
 if(!attempt||attempt.authority_epoch!==token.authority_epoch||attempt.sandbox_id!==token.sandbox_id||attempt.slot_id!==token.slot_id||attempt.sandbox_boot_generation!==token.sandbox_boot_generation)
  fail('STALE_COMPUTE','Fencing target does not match its immutable executor identity');
 if(attempt.compute_authority!=='CURRENT')return {fenced:false,reason:'ALREADY_FENCED',resource_disposition:'UNCHANGED'};
 const custody=await tx.query("SELECT id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND authority='ACTIVE' FOR SHARE",[token.organisation_id,token.run_id,token.task_id]);
 if(custody.rows.length)return {fenced:false,reason:'ACTIVE_SUBMISSION_CUSTODY',preserved_custody:true,resource_disposition:'UNCHANGED'};
 if(options.reason==='EXPIRED'){
  const due=await tx.query<{expired:boolean}>('SELECT $1::timestamptz<=clock_timestamp() AS expired',[attempt.lease_expires_at]);
  if(!due.rows[0]?.expired)return {fenced:false,reason:'LEASE_CURRENT',resource_disposition:'UNCHANGED'};
 }
 const authority=options.reason==='EXPIRED'?'EXPIRED':'REVOKED';
 await markSandboxReleasePending(tx,{organisation_id:token.organisation_id,run_id:token.run_id,attempt_id:token.attempt_id});
 await tx.query('UPDATE hyperfide.attempts SET compute_authority=$4,execution_state=$5,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
 [token.organisation_id,token.run_id,token.attempt_id,authority,options.reason==='STOP'?'CANCELLED':'FAILED']);
 await tx.query("UPDATE hyperfide.compute_leases SET state=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state='ACTIVE'",
 [token.organisation_id,token.run_id,token.attempt_id,authority]);
 await tx.query("UPDATE hyperfide.slot_allocations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state='ACTIVE'",
 [token.organisation_id,token.run_id,token.attempt_id]);
 await tx.query("UPDATE hyperfide.reservations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state IN ('PROVISIONING','ALLOCATED')",
 [token.organisation_id,token.run_id,token.attempt_id]);
 await tx.query("UPDATE hyperfide.worker_slots SET state='DRAINING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND sandbox_id=$3 AND boot_generation=$4 AND state='ALLOCATED'",
 [token.organisation_id,token.slot_id,token.sandbox_id,token.sandbox_boot_generation]);
 await tx.query('UPDATE hyperfide.tasks SET state=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
 [token.organisation_id,token.run_id,token.task_id,options.reason==='SPEC_REPLAN'?'STALE':options.reason==='STOP'?'CANCELLED':'FAILED']);
 const result={token,fenced:true,compute_authority:authority,reason:options.reason,resource_disposition:'RELEASE_PENDING',termination_confirmed:false};
 await enqueue(tx,{organisation_id:token.organisation_id,run_id:token.run_id,id:randomUUID(),aggregate_type:'scheduler-fence',aggregate_id:token.attempt_id,aggregate_version:'1',event_type:'scheduler.compute.stop.requested',payload:result},options.recipients);
 return result;
}
export async function expireCompute(tx:PrimaryTransaction,scope:SchedulerScope,actor:SchedulerActor,
 authority_epoch:string,limit=100,recipients?:{consumer_ids:string[]}):Promise<unknown>{
 assertPrimaryTransaction(tx);await lockRun(tx,scope);await requireSchedulerAuthority(tx,scope,actor,authority_epoch);
 if(!recipients)fail('DEPENDENCY_UNAVAILABLE','Trusted dispatch recipients are required for durable expiry cleanup');
 const candidates=await tx.query<{task_id:string;id:string;generation:string;authority_epoch:string;sandbox_id:string;slot_id:string;sandbox_boot_generation:string}>(
 "SELECT a.task_id,a.id,a.generation,a.authority_epoch,a.sandbox_id,a.slot_id,a.sandbox_boot_generation FROM hyperfide.attempts a WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.compute_authority='CURRENT' AND a.lease_expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM hyperfide.submission_custodies c WHERE c.organisation_id=a.organisation_id AND c.run_id=a.run_id AND c.task_id=a.task_id AND c.authority='ACTIVE') ORDER BY a.task_id LIMIT $3",
 [scope.organisation_id,scope.run_id,boundedInteger(limit,'limit',1,1000)]);
 const expired:string[]=[];
 for(const row of candidates.rows){
  const result=object(await fenceCompute(tx,{...scope,task_id:row.task_id,attempt_id:row.id,attempt_generation:row.generation,
   authority_epoch:row.authority_epoch,sandbox_id:row.sandbox_id,slot_id:row.slot_id,sandbox_boot_generation:row.sandbox_boot_generation},
   {actor,current_authority_epoch:authority_epoch,reason:'EXPIRED',recipients}));
  if(result.fenced===true)expired.push(row.id);
 }
 return {expired_attempt_ids:expired,resources_still_counted:true};
}


/** Trusted offline recovery primitive. The caller validates external authority and
 * holds the semantic WRITE fence, then persists these debt references and performs
 * the run epoch CAS in this same transaction. This never proves process cleanup. */
export async function revokeRunForRecovery(tx:PrimaryTransaction,input:SchedulerScope&{
 expected_run_epoch:string;target_epoch:string;recovery_operation_id:string;
}):Promise<{revoked_attempts:string;revoked_allocations:string;retained_debt_references:readonly string[]}>{
 assertPrimaryTransaction(tx);
 fields(input,['organisation_id','run_id','expected_run_epoch','target_epoch','recovery_operation_id']);
 for(const key of ['organisation_id','run_id','expected_run_epoch','target_epoch','recovery_operation_id'] as const)uuid(input[key],key);
 if(input.expected_run_epoch===input.target_epoch)fail('INVALID_REQUEST','Offline recovery must install a fresh epoch');
 await lockRun(tx,input,'exclusive');
 const run=await tx.query<{authority_epoch:string}>('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[input.organisation_id,input.run_id]);
 if(run.rows[0]?.authority_epoch!==input.expected_run_epoch)fail('STALE_AUTHORITY_EPOCH','Offline revocation requires the exact accepted source epoch');
 const inconsistent=await tx.query("SELECT id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND compute_authority='CURRENT' AND authority_epoch<>$3 LIMIT 1",[input.organisation_id,input.run_id,input.expected_run_epoch]);
 if(inconsistent.rows.length)fail('STALE_AUTHORITY_EPOCH','Current compute contains a different epoch; recovery must reconcile it explicitly');
 const attempts=await tx.query<{id:string}>("UPDATE hyperfide.attempts SET compute_authority='REVOKED',execution_state='CANCELLED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND compute_authority='CURRENT' AND authority_epoch=$3 RETURNING id",[input.organisation_id,input.run_id,input.expected_run_epoch]);
 await tx.query("UPDATE hyperfide.compute_leases SET state='REVOKED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND authority_epoch=$3 AND state='ACTIVE'",[input.organisation_id,input.run_id,input.expected_run_epoch]);
 const ids=attempts.rows.map(row=>row.id);
 const slots=await tx.query<{id:string}>("UPDATE hyperfide.slot_allocations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=ANY($3::uuid[]) AND state='ACTIVE' RETURNING id",[input.organisation_id,input.run_id,ids]);
 const jobs=await tx.query<{id:string}>("UPDATE hyperfide.resource_job_allocations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND state='ACTIVE' RETURNING id",[input.organisation_id,input.run_id]);
 await tx.query("UPDATE hyperfide.reservations r SET state='RELEASE_PENDING',state_version=r.state_version+1 WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.state IN ('PROVISIONING','ALLOCATED') AND (r.attempt_id=ANY($3::uuid[]) OR EXISTS(SELECT 1 FROM hyperfide.resource_job_allocations a WHERE a.organisation_id=r.organisation_id AND a.run_id=r.run_id AND a.request_id=r.request_id AND a.state='RELEASE_PENDING'))",[input.organisation_id,input.run_id,ids]);
 await tx.query("UPDATE hyperfide.sandbox_execution_charges SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND state='HELD'",[input.organisation_id,input.run_id]);
 await tx.query("UPDATE hyperfide.worker_slots w SET state='DRAINING',state_version=w.state_version+1 WHERE w.organisation_id=$1 AND w.state='ALLOCATED' AND (EXISTS(SELECT 1 FROM hyperfide.slot_allocations a WHERE a.organisation_id=w.organisation_id AND a.run_id=$2 AND a.slot_id=w.id AND a.sandbox_id=w.sandbox_id AND a.sandbox_boot_generation=w.boot_generation AND a.state='RELEASE_PENDING') OR EXISTS(SELECT 1 FROM hyperfide.resource_job_allocations a WHERE a.organisation_id=w.organisation_id AND a.run_id=$2 AND a.slot_id=w.id AND a.sandbox_id=w.sandbox_id AND a.sandbox_boot_generation=w.boot_generation AND a.state='RELEASE_PENDING'))",[input.organisation_id,input.run_id]);
 await tx.query("UPDATE hyperfide.tasks t SET state='STALE',state_version=t.state_version+1 WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.current_attempt_id=ANY($3::uuid[]) AND NOT EXISTS(SELECT 1 FROM hyperfide.submission_custodies c WHERE c.organisation_id=t.organisation_id AND c.run_id=t.run_id AND c.task_id=t.id AND c.authority='ACTIVE')",[input.organisation_id,input.run_id,ids]);
 const debts=await tx.query<{ref:string}>("SELECT 'reservation:'||id::text AS ref FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND state<>'RELEASED' UNION ALL SELECT 'sandbox-charge:'||id::text FROM hyperfide.sandbox_execution_charges WHERE organisation_id=$1 AND run_id=$2 AND state<>'RELEASED' UNION ALL SELECT 'custody:'||id::text FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND authority='ACTIVE' UNION ALL SELECT 'slot-allocation:'||id::text FROM hyperfide.slot_allocations WHERE organisation_id=$1 AND run_id=$2 AND state<>'RELEASED' UNION ALL SELECT 'job-allocation:'||id::text FROM hyperfide.resource_job_allocations WHERE organisation_id=$1 AND run_id=$2 AND state<>'RELEASED' ORDER BY ref",[input.organisation_id,input.run_id]);
 return {revoked_attempts:String(attempts.rows.length),revoked_allocations:String(slots.rows.length+jobs.rows.length),retained_debt_references:Object.freeze(debts.rows.map(row=>row.ref))};
}

export function createComponent(context:ComponentContext):Component{
  return {apiVersion:1,capabilities:{'scheduler.compute.v1':Object.freeze({assertCurrentCompute,releaseCompute,renewCompute,fenceCompute,lockComputeFenceTargets,revokeRunForRecovery,parseComputeToken})},actions:{
    'scheduler.lease.renew':async (value,context)=>{
      const input=fields(value,['token','lease_ms']),token=parseComputeToken(input.token);
      return gatewayFor(context,tx=>assertCurrentCompute(tx,token,{operation:'RENEWAL'})).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},async tx=>{
        await requireWorker(tx,token,context);return renewCompute(tx,token,
          boundedInteger(input.lease_ms,'lease_ms',1000,300000));
      });
    },
    'scheduler.compute.cancel':async (value,context)=>{
      const input=fields(value,['token','request_id','leader_generation'],['package_generation']);
      const token=parseComputeToken(input.token),actor=actorFor(context,token,input),request=uuid(input.request_id,'request_id');
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},async tx=>{
        await lockRun(tx,{organisation_id:token.organisation_id,run_id:token.run_id});
        const replay=await operationReplay(tx,token,actor.session_id,'scheduler.cancel',request,input);
        if(replay!==undefined)return replay;
        const authority=await assertCurrentCompute(tx,token,{allowExpired:true,operation:'CLEANUP'});
        await requireSchedulerAuthority(tx,token,actor,token.authority_epoch,authority.feature_package_id);
        await releaseCompute(tx,token,{execution_state:'CANCELLED'});
        await tx.query('UPDATE hyperfide.tasks SET state=\'CANCELLED\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
          [token.organisation_id,token.run_id,token.task_id]);
        const result={token,cancel_requested:true,termination_confirmed:false,resource_disposition:'RELEASE_PENDING'};
        await enqueue(tx,{organisation_id:token.organisation_id,run_id:token.run_id,id:randomUUID(),aggregate_type:'scheduler-cancel',
          aggregate_id:request,aggregate_version:'1',event_type:'scheduler.compute.cancel.requested',payload:result},dispatchRecipients(context,'native'));
        await recordOutcome(tx,token,actor.session_id,'scheduler.cancel',request,input,result);return result;
      });
    },
    'scheduler.compute.expire':async (value,context)=>{
      const input=fields(value,['organisation_id','run_id','authority_epoch','leader_generation'],['package_generation','limit']);
      const scope={organisation_id:uuid(input.organisation_id,'organisation_id'),run_id:uuid(input.run_id,'run_id')};
      const actor=actorFor(context,scope,input);
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},
        tx=>expireCompute(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),
          input.limit===undefined?100:boundedInteger(input.limit,'limit',1,1000),dispatchRecipients(context,'native')));
    }
  }};
}

export type {ComputeToken} from './claim.js';
