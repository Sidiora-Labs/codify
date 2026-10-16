import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {lockRun,enqueue} from '../events/outbox.js';
import {actorFor,boundedInteger,decimal,dispatchRecipients,fail,fields,gatewayFor,invocationFor,object,operationReplay,
  recordOutcome,requireSchedulerAuthority,uuid} from './claim.js';
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
    options:{allowExpired?:boolean}={}):Promise<ComputeAuthority>{
  assertPrimaryTransaction(tx);
  const scope={organisation_id:token.organisation_id,run_id:token.run_id};
  await lockRun(tx,scope);
  const run=await tx.query<{authority_epoch:string;state:string}>(
    'SELECT authority_epoch,state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',
    [token.organisation_id,token.run_id]);
  if(!run.rows[0]||run.rows[0].authority_epoch!==token.authority_epoch)
    fail('STALE_AUTHORITY_EPOCH','Compute token does not belong to the active run epoch');
  const boot=await tx.query<{boot_generation:string;preparation_digest:string|null}>('SELECT boot_generation,preparation_digest FROM hyperfide.sandboxes '+
    'WHERE organisation_id=$1 AND id=$2 FOR SHARE',[token.organisation_id,token.sandbox_id]);
  if(boot.rows[0]?.boot_generation!==token.sandbox_boot_generation)
    fail('STALE_SANDBOX_BOOT','Compute token belongs to a previous sandbox boot');
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
  return {...token,compute_lease_id:lease.id,lease_expires_at:lease.expires_at,
    primary_now:clock.rows[0]!.primary_now,feature_package_id:task.feature_package_id,
    input_packet_digest:attempt.input_packet_digest,spec_revision_id:task.spec_revision_id,
    spec_generation:task.spec_generation,criteria_digest:task.criteria_digest,preparation_digest:boot.rows[0]!.preparation_digest};
}
async function requireWorker(tx:PrimaryTransaction,token:ComputeToken,context:ComponentContext):Promise<void>{
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
  const authority=await assertCurrentCompute(tx,token);
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
  await assertCurrentCompute(tx,token,{allowExpired:disposition.execution_state==='CANCELLED'});
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
export async function expireCompute(tx:PrimaryTransaction,scope:SchedulerScope,actor:SchedulerActor,
    authority_epoch:string,limit=100,recipients:{consumer_ids:string[]}):Promise<unknown>{
  assertPrimaryTransaction(tx);await lockRun(tx,scope);
  await requireSchedulerAuthority(tx,scope,actor,authority_epoch);
  const candidates=await tx.query<{task_id:string;id:string;generation:string;sandbox_id:string;slot_id:string;sandbox_boot_generation:string}>(
    'SELECT a.task_id,a.id,a.generation,a.sandbox_id,a.slot_id,a.sandbox_boot_generation FROM hyperfide.attempts a '+
    'WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.compute_authority=\'CURRENT\' AND a.lease_expires_at<=clock_timestamp() '+
    'AND NOT EXISTS(SELECT 1 FROM hyperfide.submission_custodies c WHERE c.organisation_id=a.organisation_id '+
    'AND c.run_id=a.run_id AND c.task_id=a.task_id AND c.authority=\'ACTIVE\') ORDER BY a.task_id LIMIT $3',
    [scope.organisation_id,scope.run_id,boundedInteger(limit,'limit',1,1000)]);
  const expired:string[]=[];
  for(const candidate of candidates.rows){
    const token:ComputeToken={...scope,task_id:candidate.task_id,attempt_id:candidate.id,attempt_generation:candidate.generation,
      authority_epoch,sandbox_id:candidate.sandbox_id,slot_id:candidate.slot_id,sandbox_boot_generation:candidate.sandbox_boot_generation};
    const authority=await assertCurrentCompute(tx,token,{allowExpired:true});
    const due=await tx.query<{expired:boolean}>('SELECT $1::timestamptz<=clock_timestamp() AS expired',[authority.lease_expires_at]);
    if(!due.rows[0]!.expired)continue;
    await tx.query('UPDATE hyperfide.attempts SET compute_authority=\'EXPIRED\',execution_state=\'FAILED\',state_version=state_version+1 '+
      'WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,candidate.id]);
    await tx.query('UPDATE hyperfide.compute_leases SET state=\'EXPIRED\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 '+
      'AND id=$3',[scope.organisation_id,scope.run_id,authority.compute_lease_id]);
    await tx.query('UPDATE hyperfide.slot_allocations SET state=\'RELEASE_PENDING\',state_version=state_version+1 '+
      'WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state=\'ACTIVE\'',
      [scope.organisation_id,scope.run_id,candidate.id]);
    await tx.query('UPDATE hyperfide.reservations SET state=\'RELEASE_PENDING\',state_version=state_version+1 '+
      'WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state IN (\'PROVISIONING\',\'ALLOCATED\')',
      [scope.organisation_id,scope.run_id,candidate.id]);
    await tx.query('UPDATE hyperfide.worker_slots SET state=\'DRAINING\',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',
      [scope.organisation_id,candidate.slot_id]);
    await tx.query('UPDATE hyperfide.tasks SET state=\'FAILED\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
      [scope.organisation_id,scope.run_id,candidate.task_id]);
    await enqueue(tx,{...scope,id:randomUUID(),aggregate_type:'scheduler-expiry',aggregate_id:candidate.id,
      aggregate_version:'1',event_type:'scheduler.compute.expired',payload:{token,resource_disposition:'RELEASE_PENDING'}},recipients);
    expired.push(candidate.id);
  }
  return {expired_attempt_ids:expired,resources_still_counted:true};
}
export function createComponent(context:ComponentContext):Component{
  return {apiVersion:1,capabilities:{'scheduler.compute.v1':Object.freeze({assertCurrentCompute,releaseCompute,renewCompute,parseComputeToken})},actions:{
    'scheduler.lease.renew':async (value,context)=>{
      const input=fields(value,['token','lease_ms']),token=parseComputeToken(input.token);
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal,guard:tx=>invocationFor(context).guard(tx)},async tx=>{
        await requireWorker(tx,token,context);return renewCompute(tx,token,
          boundedInteger(input.lease_ms,'lease_ms',1000,300000));
      });
    },
    'scheduler.compute.cancel':async (value,context)=>{
      const input=fields(value,['token','request_id','leader_generation'],['package_generation']);
      const token=parseComputeToken(input.token),actor=actorFor(context,token,input),request=uuid(input.request_id,'request_id');
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal,guard:tx=>invocationFor(context).guard(tx)},async tx=>{
        await lockRun(tx,{organisation_id:token.organisation_id,run_id:token.run_id});
        const replay=await operationReplay(tx,token,actor.session_id,'scheduler.cancel',request,input);
        if(replay!==undefined)return replay;
        const authority=await assertCurrentCompute(tx,token,{allowExpired:true});
        await requireSchedulerAuthority(tx,token,actor,token.authority_epoch,authority.feature_package_id);
        await releaseCompute(tx,token,{execution_state:'CANCELLED'});
        await tx.query('UPDATE hyperfide.tasks SET state=\'CANCELLED\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
          [token.organisation_id,token.run_id,token.task_id]);
        const result={token,cancel_requested:true,termination_confirmed:false,resource_disposition:'RELEASE_PENDING'};
        await enqueue(tx,{organisation_id:token.organisation_id,run_id:token.run_id,id:randomUUID(),aggregate_type:'scheduler-cancel',
          aggregate_id:request,aggregate_version:'1',event_type:'scheduler.compute.cancel.requested',payload:result},dispatchRecipients(context));
        await recordOutcome(tx,token,actor.session_id,'scheduler.cancel',request,input,result);return result;
      });
    },
    'scheduler.compute.expire':async (value,context)=>{
      const input=fields(value,['organisation_id','run_id','authority_epoch','leader_generation'],['package_generation','limit']);
      const scope={organisation_id:uuid(input.organisation_id,'organisation_id'),run_id:uuid(input.run_id,'run_id')};
      const actor=actorFor(context,scope,input);
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal,guard:tx=>invocationFor(context).guard(tx)},
        tx=>expireCompute(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),
          input.limit===undefined?100:boundedInteger(input.limit,'limit',1,1000),dispatchRecipients(context)));
    }
  }};
}

export type {ComputeToken} from './claim.js';
