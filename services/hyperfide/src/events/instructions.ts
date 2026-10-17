import {runnerApi,RUNNER_EVENT_BOUNDS} from './api.js';
import { assertNoExecutionHold } from '../scheduler/claim.js';
import { ready as hierarchyReady,leadership,requireAuthority } from '../hierarchy/packages.js';
import { randomUUID } from 'node:crypto';
import { assertInvocation } from '../transport/protocol.js';
import type { InvocationContext, Principal } from '../transport/protocol.js';
import type { Component, ComponentContext } from '../components/registry.js';
import type { PrimaryTransaction } from '../storage/transactions.js';
import { assertPrimaryTransaction } from '../storage/transactions.js';
import { fields,scope,uuid,integer,bounded,canonical,digest,eventDigest,event,fail,gateway,run,lockRun,enqueue,authorizedRun,lookupNativeLaunch,registerConsumer,requireInvocation } from './outbox.js';
import type {NativeReceiptReader} from '../scheduler/dispatch.js';
import type { Scope,OutboxEvent } from './outbox.js';
import { receive } from './inbox.js';
export { lookupNativeLaunch } from './outbox.js';

export interface Instruction extends Scope { id:string; attempt_id:string; attempt_generation:string;
  authority_epoch:string; sandbox_boot_generation:string; kind:'START'|'STEER'|'CANCEL'; body:Record<string,unknown> }
export function instruction(value:unknown):Instruction {
  const v=fields(value,['organisation_id','run_id','id','attempt_id','attempt_generation','authority_epoch','sandbox_boot_generation','kind','body']);
  if(!['START','STEER','CANCEL'].includes(String(v.kind))||typeof v.body!=='object'||v.body===null||Array.isArray(v.body))
    fail('INSTRUCTION_INPUT_INVALID','Instruction needs a supported kind and JSON object body');
  const body=fields(v.body,v.kind==='START'?['launch_id','slot_id','agent_session_id','connector_plan_digest']:
    v.kind==='STEER'?['launch_id','request_id','frame_b64']:['launch_id']);
  uuid(body.launch_id);
  if(v.kind==='START') {
    uuid(body.slot_id);uuid(body.agent_session_id);
    if(typeof body.connector_plan_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(body.connector_plan_digest))
      fail('INSTRUCTION_INPUT_INVALID','START requires an immutable connector plan digest');
  }
  if(v.kind==='STEER') {
    uuid(body.request_id);
    if(typeof body.frame_b64!=='string'||body.frame_b64.length===0||!/^[A-Za-z0-9_-]+$/.test(body.frame_b64)||
      Buffer.from(body.frame_b64,'base64url').toString('base64url')!==body.frame_b64||Buffer.from(body.frame_b64,'base64url').length>4096)
      fail('INSTRUCTION_INPUT_INVALID','STEER frame must use canonical unpadded base64url');
  }
  const encoded=canonical(body);
  if(Buffer.byteLength(encoded)>65536) fail('INSTRUCTION_INPUT_INVALID','Instruction body exceeds spool bound');
  return {...scope(v),id:uuid(v.id),attempt_id:uuid(v.attempt_id),attempt_generation:integer(v.attempt_generation),
    authority_epoch:uuid(v.authority_epoch),sandbox_boot_generation:integer(v.sandbox_boot_generation),
    kind:v.kind as Instruction['kind'],body:JSON.parse(encoded) as Record<string,unknown>};
}
interface AuthoritySnapshot {sandbox_id:string;boot_id:string;observed_at:string;lease_expires_at:string|null;remaining_lease_ms:number}
async function currentAuthority(tx:PrimaryTransaction,i:Instruction,allowExpiredCancel=false):Promise<AuthoritySnapshot> {
  assertPrimaryTransaction(tx);
  await lockRun(tx,i);
  const target=await tx.query('SELECT task_id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
    [i.organisation_id,i.run_id,i.attempt_id]);
  if(target.rowCount!==1) fail('INSTRUCTION_STALE_AUTHORITY','Attempt does not exist in this run');
  await tx.query('SELECT id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
    [i.organisation_id,i.run_id,target.rows[0]!.task_id]);
  const found=await tx.query(`SELECT a.*,r.authority_epoch AS current_epoch,r.state AS current_run_state,t.current_attempt_id,t.generation AS current_generation,t.feature_package_id AS current_package_id,
    s.boot_generation AS current_boot,b.boot_id AS current_boot_id,l.state AS lease_state,l.expires_at AS observed_lease_expires_at
    FROM hyperfide.attempts a JOIN hyperfide.runs r ON(r.organisation_id=a.organisation_id AND r.id=a.run_id)
    JOIN hyperfide.tasks t ON(t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id)
    JOIN hyperfide.sandboxes s ON(s.organisation_id=a.organisation_id AND s.id=a.sandbox_id)
    JOIN hyperfide.sandbox_boots b ON(b.organisation_id=a.organisation_id AND b.sandbox_id=a.sandbox_id AND b.boot_generation=a.sandbox_boot_generation)
    LEFT JOIN hyperfide.compute_leases l ON(l.organisation_id=a.organisation_id AND l.run_id=a.run_id AND l.attempt_id=a.id AND l.state='ACTIVE')
    WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 FOR UPDATE OF a`,
    [i.organisation_id,i.run_id,i.attempt_id]);
  const a=found.rows[0];
  if(!a||a.current_attempt_id!==i.attempt_id||a.generation!==i.attempt_generation||a.current_generation!==i.attempt_generation||
      a.authority_epoch!==i.authority_epoch||a.current_epoch!==i.authority_epoch||
      a.sandbox_boot_generation!==i.sandbox_boot_generation||a.current_boot!==i.sandbox_boot_generation)
    fail('INSTRUCTION_STALE_AUTHORITY','Instruction target generation, epoch or sandbox boot is stale');
  await assertNoExecutionHold(tx,i,{package_id:uuid(a.current_package_id),attempt_id:i.attempt_id,sandbox_id:uuid(a.sandbox_id),
    operation:allowExpiredCancel?'CLEANUP':i.kind==='START'?'ADMISSION':i.kind==='STEER'?'ADVANCE':'CLEANUP'});
  if(i.kind==='START'&&i.body.slot_id!==a.slot_id)
    fail('INSTRUCTION_STALE_AUTHORITY','START slot does not match the current attempt placement');
  const clock=await tx.query('SELECT clock_timestamp() AS checked_at');
  const leaseUnexpired=a?.observed_lease_expires_at instanceof Date && a.observed_lease_expires_at.getTime()>(clock.rows[0]!.checked_at as Date).getTime();
  if(!allowExpiredCancel&&(a.current_run_state!=='RUNNING'||a.compute_authority!=='CURRENT'||a.lease_state!=='ACTIVE'||!leaseUnexpired||
      !['PLANNED','RESERVED','PREPARING','START_REQUESTED','RUNNING'].includes(a.execution_state as string)))
    fail('INSTRUCTION_STALE_AUTHORITY','Current live compute authority is required');
  const observed=clock.rows[0]!.checked_at as Date;
  const expiry=a.observed_lease_expires_at instanceof Date?a.observed_lease_expires_at:null;
  return {sandbox_id:uuid(a.sandbox_id),boot_id:uuid(a.current_boot_id),observed_at:observed.toISOString(),
    lease_expires_at:expiry?.toISOString()??null,
    remaining_lease_ms:a.compute_authority==='CURRENT'&&a.lease_state==='ACTIVE'&&expiry?
      Math.min(300000,Math.max(0,Math.floor(expiry.getTime()-observed.getTime())-1)):0};
}
function bodyOf(i:Instruction,target:{sandbox_id:string;boot_id:string}):Record<string,unknown> {
  return {instruction_id:i.id,attempt_id:i.attempt_id,attempt_generation:i.attempt_generation,
    authority_epoch:i.authority_epoch,sandbox_boot_generation:i.sandbox_boot_generation,kind:i.kind,body:i.body,sandbox_id:target.sandbox_id,boot_id:target.boot_id};
}
export interface RunnerConsumerBinding extends Scope {consumer_id:string;sandbox_id:string;boot_id:string;boot_generation:string;
  consumer_key:string;consumer_state:string;registered_credential_id:string;bootstrap_receipt_id:string}
function runnerConsumerIdentity(s:Scope,consumer:string,sandbox:string,boot:string,generation:string):Record<string,unknown> {
  return {...s,consumer_id:consumer,sandbox_id:sandbox,boot_id:boot,boot_generation:generation};
}
export async function resolveRunnerConsumer(tx:PrimaryTransaction,input:unknown):Promise<RunnerConsumerBinding|null> {
  assertPrimaryTransaction(tx);
  const v=fields(input,['organisation_id','run_id','sandbox_id','boot_id','boot_generation']),s=scope(v),
    sandbox=uuid(v.sandbox_id),boot=uuid(v.boot_id),generation=integer(v.boot_generation);
  const r=(await tx.query(`SELECT b.*,c.consumer_key,c.state AS consumer_state,i.request_digest AS bootstrap_digest,
    i.operation AS bootstrap_operation,i.state AS bootstrap_state,i.result AS bootstrap_result
    FROM hyperfide.event_runner_bindings b JOIN hyperfide.event_consumers c
      ON(c.organisation_id=b.organisation_id AND c.run_id=b.run_id AND c.id=b.consumer_id)
    JOIN hyperfide.command_inbox i ON(i.organisation_id=b.organisation_id AND i.run_id=b.run_id AND i.id=b.bootstrap_receipt_id)
    JOIN hyperfide.sandbox_boots boot ON(boot.organisation_id=b.organisation_id AND boot.sandbox_id=b.sandbox_id
      AND boot.boot_generation=b.boot_generation AND boot.boot_id=b.boot_id)
    WHERE b.organisation_id=$1 AND b.run_id=$2 AND b.sandbox_id=$3 AND b.boot_id=$4 AND b.boot_generation=$5 FOR SHARE OF c`,
    [s.organisation_id,s.run_id,sandbox,boot,generation])).rows[0];
  if(!r)return null;
  const consumer=uuid(r.consumer_id),expected=runnerConsumerIdentity(s,consumer,sandbox,boot,generation);
  if(r.consumer_key!=='runner:'+sandbox+':'+boot||r.bootstrap_digest!==digest(expected)||
    r.bootstrap_operation!=='instruction.consumer-genesis'||r.bootstrap_state!=='COMPLETED'||
    !r.bootstrap_result||r.bootstrap_result.empty_native_history!==true||
    Object.entries(expected).some(([key,value])=>r.bootstrap_result[key]!==value))
    fail('INSTRUCTION_CONSUMER_INVALID','Native consumer lost its exact immutable boot and bootstrap receipt');
  return {...s,consumer_id:consumer,sandbox_id:sandbox,boot_id:boot,boot_generation:generation,
    consumer_key:r.consumer_key as string,consumer_state:r.consumer_state as string,
    registered_credential_id:uuid(r.registered_credential_id),bootstrap_receipt_id:uuid(r.bootstrap_receipt_id)};
}
export async function registerRunnerConsumer(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise<unknown> {
  assertPrimaryTransaction(tx);assertInvocation(invocation);
  const v=fields(input,['organisation_id','run_id','consumer_id']),s=scope(v),consumer=uuid(v.consumer_id),p=invocation.principal;
  if(p.role!=='RUNNER'||p.organisation_id!==s.organisation_id||p.run_id!==s.run_id||
    !p.sandbox_id||!p.boot_id||!p.boot_generation)fail('AUTH_SCOPE_DENIED','Only the authenticated native boot may register its standing consumer');
  await invocation.guard(tx);await lockRun(tx,s,'exclusive');
  const identity=runnerConsumerIdentity(s,consumer,uuid(p.sandbox_id),uuid(p.boot_id),integer(p.boot_generation));
  const existing=await resolveRunnerConsumer(tx,{...s,sandbox_id:p.sandbox_id,boot_id:p.boot_id,boot_generation:p.boot_generation});
  if(existing) {
    if(existing.consumer_id!==consumer)fail('INSTRUCTION_CONSUMER_CONFLICT','A boot cannot replace its immutable standing native consumer');
    return {...existing,registered:true,replayed:true,needs_recovery:existing.consumer_state!=='ACTIVE',execution_authority:false};
  }
  const history=await tx.query(`SELECT 1 FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2
    AND aggregate_type='attempt.instructions' AND payload->>'sandbox_id'=$3 AND payload->>'boot_id'=$4 LIMIT 1`,
    [s.organisation_id,s.run_id,p.sandbox_id,p.boot_id]);
  if(history.rows.length)fail('INSTRUCTION_BOOTSTRAP_REQUIRES_RECOVERY','Existing native history cannot be replaced by an empty bootstrap');
  await registerConsumer(tx,{...s,id:consumer,consumer_key:'runner:'+p.sandbox_id+':'+p.boot_id,critical:true,state:'BUFFERING'});
  const receipt=randomUUID(),result={...identity,empty_native_history:true,covered_native_events:'0',
    bootstrap_scope:'EMPTY_TARGETED_NATIVE_STREAM',execution_authority:false};
  await tx.query(`INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result)
    VALUES($1,$2,$3,$4,'instruction.consumer-genesis',$4,$5,'COMPLETED',$6::jsonb)`,
    [s.organisation_id,s.run_id,receipt,consumer,digest(identity),canonical(result)]);
  await tx.query(`INSERT INTO hyperfide.event_runner_bindings(organisation_id,run_id,consumer_id,sandbox_id,boot_id,boot_generation,registered_credential_id,bootstrap_receipt_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[s.organisation_id,s.run_id,consumer,p.sandbox_id,p.boot_id,p.boot_generation,p.credential_id,receipt]);
  await tx.query("UPDATE hyperfide.event_consumers SET state='ACTIVE',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='BUFFERING'",
    [s.organisation_id,s.run_id,consumer]);
  return {...(await resolveRunnerConsumer(tx,{...s,sandbox_id:p.sandbox_id,boot_id:p.boot_id,boot_generation:p.boot_generation}))!,
    registered:true,replayed:false,needs_recovery:false,execution_authority:false};
}
export async function instructionRecipient(tx:PrimaryTransaction,s:Scope,target:{sandbox_id:string;boot_id:string},generation:string,active:boolean):Promise<string> {
  const binding=await resolveRunnerConsumer(tx,{organisation_id:s.organisation_id,run_id:s.run_id,
    sandbox_id:target.sandbox_id,boot_id:target.boot_id,boot_generation:generation});
  if(!binding||active&&binding.consumer_state!=='ACTIVE')
    fail('INSTRUCTION_CONSUMER_REQUIRED','A current boot-bound standing native consumer is required; broadcasting is forbidden');
  return binding.consumer_id;
}
export async function issue(tx:PrimaryTransaction,input:unknown):Promise<unknown> {
  assertPrimaryTransaction(tx);
  const i=instruction(input);
  await lockRun(tx,i);
  const old=await tx.query('SELECT * FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
    [i.organisation_id,i.run_id,i.id]);
  if(old.rows.length) {
    const r=old.rows[0]!;
    if(r.aggregate_type!=='attempt.instructions'||r.aggregate_id!==i.attempt_id||
      r.event_type!=='instruction.'+i.kind.toLowerCase()||canonical(r.payload)!==canonical(bodyOf(i,{sandbox_id:uuid(r.payload.sandbox_id),boot_id:uuid(r.payload.boot_id)})))
      fail('INSTRUCTION_IDEMPOTENCY_CONFLICT','Stable command ID was reused with a different instruction');
    const consumer=await instructionRecipient(tx,i,{sandbox_id:uuid(r.payload.sandbox_id),boot_id:uuid(r.payload.boot_id)},i.sandbox_boot_generation,false);
    return enqueue(tx,{...scope(i as unknown as Record<string,unknown>),id:r.id,aggregate_type:r.aggregate_type,
      aggregate_id:r.aggregate_id,aggregate_version:r.aggregate_version,event_type:r.event_type,payload:r.payload},{consumer_ids:[consumer]});
  }
  const target=await currentAuthority(tx,i,i.kind==='CANCEL');
  const consumer=await instructionRecipient(tx,i,target,i.sandbox_boot_generation,true);
  const queued=await tx.query(`SELECT count(DISTINCT e.id)::int AS count FROM hyperfide.outbox_events e
    JOIN hyperfide.event_deliveries d ON(d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id)
    WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.aggregate_type='attempt.instructions' AND e.aggregate_id=$3 AND d.state<>'ACKNOWLEDGED'`,
    [i.organisation_id,i.run_id,i.attempt_id]);
  if((queued.rows[0]!.count as number)>=256) fail('INSTRUCTION_BACKPRESSURE','Outstanding instruction spool is full; preserve and reconcile existing obligations');
  const history=await tx.query("SELECT event_type,aggregate_version,payload FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type='attempt.instructions' AND aggregate_id=$3 AND event_type IN('instruction.start','instruction.cancel') ORDER BY aggregate_version",
    [i.organisation_id,i.run_id,i.attempt_id]);
  if(history.rows.some(r=>r.event_type==='instruction.cancel')) fail('INSTRUCTION_CANCELLED','Cancellation intent already fences additional instructions');
  const start=history.rows.find(r=>r.event_type==='instruction.start');
  if(start&&i.kind!=='START'&&(start.payload as {body:{launch_id:unknown}}).body.launch_id!==i.body.launch_id)
    fail('INSTRUCTION_LAUNCH_CONFLICT','Later instructions must bind the original logical launch');
  if(i.kind==='STEER'&&!start) fail('INSTRUCTION_START_REQUIRED','STEER requires an existing logical START');
  if(i.kind==='START'&&history.rows.some(r=>r.event_type==='instruction.start'))
    fail('INSTRUCTION_START_EXISTS','This attempt already has a stable logical start command');
  if(i.kind==='START') {
    const priorLaunch=await tx.query("SELECT id FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type='attempt.instructions' AND event_type='instruction.start' AND payload->'body'->>'launch_id'=$3 LIMIT 1",
      [i.organisation_id,i.run_id,uuid(i.body.launch_id)]);
    if(priorLaunch.rows.length)fail('INSTRUCTION_LAUNCH_CONFLICT','One launch UUID cannot be attached to another logical START');
  }
  const latest=await tx.query("SELECT aggregate_version FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type='attempt.instructions' AND aggregate_id=$3 ORDER BY aggregate_version DESC LIMIT 1",
    [i.organisation_id,i.run_id,i.attempt_id]);
  const version=latest.rows.length?(BigInt(latest.rows[0]!.aggregate_version as string)+1n).toString():'1';
  return enqueue(tx,{...scope(i as unknown as Record<string,unknown>),id:i.id,aggregate_type:'attempt.instructions',
    aggregate_id:i.attempt_id,aggregate_version:version,event_type:'instruction.'+i.kind.toLowerCase(),payload:bodyOf(i,target)},{consumer_ids:[consumer]});
}
export async function acceptInstruction(tx:PrimaryTransaction,input:unknown):Promise<unknown> {
  return receive(tx,input,async(inner,e)=>{
    if(e.aggregate_type!=='attempt.instructions'||!['instruction.start','instruction.steer','instruction.cancel'].includes(e.event_type))
      fail('INSTRUCTION_EVENT_INVALID','Delivery is not a supported instruction');
    const p=e.payload,i=instruction({...scope(e as unknown as Record<string,unknown>),id:p.instruction_id,
      attempt_id:p.attempt_id,attempt_generation:p.attempt_generation,authority_epoch:p.authority_epoch,
      sandbox_boot_generation:p.sandbox_boot_generation,kind:p.kind,body:p.body});
    if(i.id!==e.id||i.attempt_id!==e.aggregate_id||e.event_type!=='instruction.'+i.kind.toLowerCase())
      fail('INSTRUCTION_EVENT_INVALID','Instruction event and target payload disagree');
    const cancelled=await inner.query("SELECT 1 FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type='attempt.instructions' AND aggregate_id=$3 AND event_type='instruction.cancel' LIMIT 1",
      [i.organisation_id,i.run_id,i.attempt_id]);
    const target=await currentAuthority(inner,i,i.kind==='CANCEL'||cancelled.rows.length>0);
    if(p.sandbox_id!==target.sandbox_id||p.boot_id!==target.boot_id) fail('INSTRUCTION_STALE_AUTHORITY','Instruction boot identity no longer matches the current target');
    const suppressed=i.kind!=='CANCEL'&&cancelled.rows.length>0;
    const result={command_id:i.id,kind:i.kind,accepted:!suppressed,
      disposition:suppressed?'SUPPRESSED_BY_CANCELLATION':'DURABLY_QUEUED',
      execution:'PENDING_NATIVE_CONNECTOR',target_generation:i.attempt_generation};
    // This durable spool is the handoff boundary, not evidence that an external process launched or stopped.
    const consumer=uuid(fields(input,['organisation_id','run_id','event_id','consumer_id']).consumer_id);
    await inner.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'instruction.spool',$5,$6,'COMPLETED',$7::jsonb)",
      [i.organisation_id,i.run_id,randomUUID(),consumer,i.id,eventDigest(e),canonical(result)]);
    return result;
  });
}

export async function handoff(tx:PrimaryTransaction,input:unknown,principal?:Principal):Promise<unknown> {
  assertPrimaryTransaction(tx);
  const v=fields(input,['organisation_id','run_id','event_id','consumer_id']),s=scope(v),id=uuid(v.event_id),consumer=uuid(v.consumer_id);
  await lockRun(tx,s);
  const found=await tx.query(`SELECT e.*,i.result AS spool_result FROM hyperfide.outbox_events e JOIN hyperfide.command_inbox i
    ON(i.organisation_id=e.organisation_id AND i.run_id=e.run_id AND i.idempotency_key=e.id::text)
    WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.id=$3 AND i.principal_scope=$4
      AND i.operation='instruction.spool' AND i.state='COMPLETED'`,[s.organisation_id,s.run_id,id,consumer]);
  if(found.rowCount!==1) fail('INSTRUCTION_SPOOL_REQUIRED','Native handoff requires the exact durable receiver spool');
  const row=found.rows[0]!,p=row.payload as Record<string,unknown>;
  const i=instruction({...s,id:p.instruction_id,attempt_id:p.attempt_id,attempt_generation:p.attempt_generation,
    authority_epoch:p.authority_epoch,sandbox_boot_generation:p.sandbox_boot_generation,kind:p.kind,body:p.body});
  if(i.id!==id||row.aggregate_type!=='attempt.instructions'||row.aggregate_id!==i.attempt_id||row.event_type!=='instruction.'+i.kind.toLowerCase())
    fail('INSTRUCTION_EVENT_INVALID','Native handoff source is not a matching instruction');
  const cancel=await tx.query("SELECT 1 FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type='attempt.instructions' AND aggregate_id=$3 AND event_type='instruction.cancel' LIMIT 1",
    [s.organisation_id,s.run_id,i.attempt_id]);
  const target=await currentAuthority(tx,i,i.kind==='CANCEL'||cancel.rows.length>0);
  if(p.sandbox_id!==target.sandbox_id||p.boot_id!==target.boot_id) fail('INSTRUCTION_STALE_AUTHORITY','Native handoff boot identity is stale');
  if(principal) runnerMatches(principal,i,target);
  if(i.kind!=='CANCEL'&&cancel.rows.length) return {accepted:false,state:'SUPPRESSED_BY_CANCELLATION',command_id:id,execution:'NOT_DISPATCHED'};
  return {accepted:true,command_id:id,operation_id:id,...s,attempt_id:i.attempt_id,attempt_generation:i.attempt_generation,
    authority_epoch:i.authority_epoch,sandbox_id:target.sandbox_id,boot_id:target.boot_id,
    sandbox_boot_generation:i.sandbox_boot_generation,sequence:integer(row.aggregate_version),kind:i.kind,
    payload_base64url:Buffer.from(canonical(i.body),'utf8').toString('base64url'),payload_digest:digest(i.body),
    observed_at:target.observed_at,lease_expires_at:target.lease_expires_at,remaining_lease_ms:target.remaining_lease_ms,
    state:'READY_FOR_NATIVE_ACCEPTANCE',execution:'PENDING_NATIVE_CONNECTOR'};
}


export async function replayInstructions(tx:PrimaryTransaction,input:unknown):Promise<unknown> {
  assertPrimaryTransaction(tx);
  const v=fields(input,['organisation_id','run_id','attempt_id','consumer_id','limit']),s=scope(v),
    attempt=uuid(v.attempt_id),consumer=uuid(v.consumer_id),limit=bounded(v.limit,1,64);
  await lockRun(tx,s);
  const pending=await tx.query(`SELECT e.id FROM hyperfide.outbox_events e JOIN hyperfide.event_deliveries d
    ON(d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id)
    WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.aggregate_type='attempt.instructions' AND e.aggregate_id=$3
      AND d.consumer_id=$4 AND NOT EXISTS(SELECT 1 FROM hyperfide.command_inbox i WHERE i.organisation_id=e.organisation_id
        AND i.run_id=e.run_id AND i.principal_scope=$4::text AND i.operation='event.receive' AND i.idempotency_key=e.id::text AND i.state='COMPLETED')
    ORDER BY e.aggregate_version,e.id LIMIT $5`,[s.organisation_id,s.run_id,attempt,consumer,limit]);
  const results:unknown[]=[];
  for(const e of pending.rows) {
    const result=await acceptInstruction(tx,{...s,event_id:e.id,consumer_id:consumer}) as {status:string};
    results.push(result);
    if(['GAP','RESNAPSHOT_REQUIRED'].includes(result.status)) return {results,complete:false,resnapshot_required:result.status==='RESNAPSHOT_REQUIRED'};
  }
  return {results,complete:pending.rows.length<limit,resnapshot_required:false};
}
export function runnerMatches(principal:Principal,i:Instruction,target:{sandbox_id:string;boot_id:string}):void {
  if(principal.role!=='RUNNER'||principal.organisation_id!==i.organisation_id||principal.run_id!==i.run_id||
    principal.sandbox_id!==target.sandbox_id||principal.boot_id!==target.boot_id||principal.boot_generation!==i.sandbox_boot_generation||
    principal.attempt_id!==null&&principal.attempt_id!==i.attempt_id||
    principal.attempt_generation!==null&&principal.attempt_generation!==i.attempt_generation)
    fail('AUTH_SCOPE_DENIED','Authenticated runner does not own this exact sandbox boot and attempt');
}
export async function recordRunnerAcknowledgement(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise<unknown> {
  assertPrimaryTransaction(tx);assertInvocation(invocation);
  const v=fields(input,['organisation_id','run_id','command_id','operation_id','attempt_id','attempt_generation','authority_epoch',
    'sandbox_id','boot_id','sandbox_boot_generation','sequence','payload_digest','ledger_receipt_id','ledger_version','state','observed_process']);
  const s=scope(v),command=uuid(v.command_id),operation=uuid(v.operation_id),ledger=uuid(v.ledger_receipt_id),version=integer(v.ledger_version);
  if(command!==operation||!['ACCEPTED','EXECUTING','TERMINAL','UNCERTAIN'].includes(String(v.state))||
    typeof v.payload_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(v.payload_digest))
    fail('INSTRUCTION_ACK_INVALID','Runner acknowledgement has an invalid identity, state or digest');
  if(v.observed_process!==null) {
    const p=fields(v.observed_process,['os_boot_id','pid','start_time','pgid']);
    uuid(p.os_boot_id);bounded(p.pid,1,2147483647);integer(p.start_time,true);bounded(p.pgid,1,2147483647);
  }
  if(v.state==='EXECUTING'&&v.observed_process===null||v.state==='ACCEPTED'&&v.observed_process!==null)
    fail('INSTRUCTION_ACK_INVALID','Process observation does not match the reported runner state');
  await lockRun(tx,s);
  const found=await tx.query("SELECT * FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND aggregate_type='attempt.instructions'",
    [s.organisation_id,s.run_id,command]);
  if(found.rowCount!==1) fail('INSTRUCTION_EVENT_INVALID','Runner acknowledgement has no committed instruction');
  const r=found.rows[0]!,p=r.payload as Record<string,unknown>;
  const i=instruction({...s,id:p.instruction_id,attempt_id:p.attempt_id,attempt_generation:p.attempt_generation,
    authority_epoch:p.authority_epoch,sandbox_boot_generation:p.sandbox_boot_generation,kind:p.kind,body:p.body});
  const target=await currentAuthority(tx,i,true);
  runnerMatches(invocation.principal,i,target);
  if(v.attempt_id!==i.attempt_id||v.attempt_generation!==i.attempt_generation||v.authority_epoch!==i.authority_epoch||
    v.sandbox_id!==target.sandbox_id||v.boot_id!==target.boot_id||v.sandbox_boot_generation!==i.sandbox_boot_generation||
    integer(v.sequence)!==r.aggregate_version||v.payload_digest!==digest(i.body)||p.sandbox_id!==target.sandbox_id||p.boot_id!==target.boot_id)
    fail('INSTRUCTION_ACK_INVALID','Runner acknowledgement differs from the immutable command and target tuple');
  const e=event({...s,id:r.id,aggregate_type:r.aggregate_type,aggregate_id:r.aggregate_id,aggregate_version:r.aggregate_version,
    event_type:r.event_type,payload:r.payload}),eventHash=eventDigest(e),requestHash=digest(v),principal='runner:'+target.sandbox_id+':'+target.boot_id;
  const spool=await tx.query("SELECT 1 FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND operation='instruction.spool' AND idempotency_key=$3 AND state='COMPLETED' AND request_digest=$4 LIMIT 1",
    [s.organisation_id,s.run_id,command,eventHash]);
  if(!spool.rows.length) fail('INSTRUCTION_SPOOL_REQUIRED','Runner acknowledgement requires the original durable handoff spool');
  const idempotency=command+':'+version;
  const earlier=await tx.query("SELECT * FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='instruction.runner-ack' AND idempotency_key=$4 FOR UPDATE",
    [s.organisation_id,s.run_id,principal,idempotency]);
  if(earlier.rows.length) {
    if(earlier.rows[0]!.request_digest!==requestHash||earlier.rows[0]!.state!=='COMPLETED')
      fail('INSTRUCTION_ACK_CONFLICT','Runner ledger revision was reused with different observation bytes');
    return {...earlier.rows[0]!.result as Record<string,unknown>,replayed:true};
  }
  const counter=await tx.query("SELECT * FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='instruction.runner-state' AND idempotency_key=$4 FOR UPDATE",
    [s.organisation_id,s.run_id,principal,command]);
  const previous=counter.rows[0],prior=previous?.result as Record<string,unknown>|undefined;
  if(previous&&previous.request_digest!==eventHash) fail('INSTRUCTION_ACK_CONFLICT','Runner state no longer binds the immutable command');
  if(prior&&prior.ledger_receipt_id!==ledger) fail('INSTRUCTION_ACK_CONFLICT','One logical command cannot switch local durable ledger identity');
  const newer=!prior||BigInt(version)>BigInt(integer(prior.ledger_version));
  const pinned=prior?.pinned_process??prior?.observed_process??null;
  if(pinned!==null&&v.observed_process!==null&&canonical(pinned)!==canonical(v.observed_process))
    fail('INSTRUCTION_ACK_CONFLICT','Stable command acknowledgement changed the pinned supervised process identity');
  const nextPinned=pinned??v.observed_process;
  const nextState=newer?{...v,pinned_process:nextPinned,credential_id:invocation.principal.credential_id}:{...prior,pinned_process:nextPinned};
  if(newer&&prior) {
    if(prior.state==='TERMINAL'&&v.state!=='TERMINAL'||prior.state!=='ACCEPTED'&&v.state==='ACCEPTED')
      fail('INSTRUCTION_ACK_REGRESSION','Runner observation cannot regress an established execution state');
    if(prior.observed_process!==null&&v.observed_process!==null&&canonical(prior.observed_process)!==canonical(v.observed_process))
      fail('INSTRUCTION_ACK_CONFLICT','Stable command acknowledgement changed the supervised process identity');
  }
  const result={recorded:true,replayed:false,command_id:command,ledger_receipt_id:ledger,ledger_version:version,
    reported_state:v.state,current:newer,authority:'NONE',task_qualified:false};
  await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'instruction.runner-ack',$5,$6,'COMPLETED',$7::jsonb)",
    [s.organisation_id,s.run_id,randomUUID(),principal,idempotency,requestHash,canonical(result)]);
  if(newer||pinned===null&&v.observed_process!==null) {
    if(previous) await tx.query("UPDATE hyperfide.command_inbox SET result=$5::jsonb,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='instruction.runner-state' AND idempotency_key=$4",
      [s.organisation_id,s.run_id,principal,command,canonical(nextState)]);
    else await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'instruction.runner-state',$5,$6,'COMPLETED',$7::jsonb)",
      [s.organisation_id,s.run_id,randomUUID(),principal,command,eventHash,canonical(nextState)]);
  }
  return result;
}


async function issueAuthority(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise<void> {
  const principal=invocation.principal;
  if(!['LEADER','FEATURE_MANAGER'].includes(principal.role))return;
  const i=instruction(input);await hierarchyReady(tx);
  const current=await leadership(tx,i);
  let owner:{package_id:string;package_generation:string}|undefined;
  if(principal.role==='FEATURE_MANAGER') {
    const row=(await tx.query(`SELECT t.feature_package_id,h.owner_generation::text FROM hyperfide.attempts a
      JOIN hyperfide.tasks t ON(t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id)
      JOIN hyperfide.hierarchy_packages h ON(h.organisation_id=t.organisation_id AND h.run_id=t.run_id AND h.package_id=t.feature_package_id)
      WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3`,[i.organisation_id,i.run_id,i.attempt_id])).rows[0];
    if(!row)fail('PACKAGE_UNAVAILABLE','Manager instructions require an actually assigned hierarchy package');
    owner={package_id:uuid(row.feature_package_id),package_generation:integer(row.owner_generation)};
  }
  await requireAuthority(tx,{...i,authority_epoch:principal.deployment_epoch,session_id:principal.actor_id,
    leader_generation:current.leader_generation,...owner,roles:['LEADER','FEATURE_MANAGER']});
}
export const readDispatchReceipt:NativeReceiptReader=async(tx,input)=>{
  assertPrimaryTransaction(tx);
  const rows=await tx.query(`SELECT e.*,i.id AS receipt_id,i.request_digest AS event_digest,i.result AS observation
    FROM hyperfide.outbox_events e JOIN hyperfide.command_inbox i
      ON i.organisation_id=e.organisation_id AND i.run_id=e.run_id
      AND i.operation='instruction.runner-state' AND i.idempotency_key=e.id::text
      AND i.principal_scope='runner:'||(e.payload->>'sandbox_id')||':'||(e.payload->>'boot_id')
      AND i.state='COMPLETED'
    WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.id=$3
      AND e.aggregate_type='attempt.instructions' AND e.event_type='instruction.start'`,
    [input.organisation_id,input.run_id,input.operation_id]);
  if(!rows.rows.length)return null;
  const row=rows.rows[0]!,p=row.payload,o=row.observation,t=input.token;
  const committed=event({organisation_id:input.organisation_id,run_id:input.run_id,id:row.id,aggregate_type:row.aggregate_type,aggregate_id:row.aggregate_id,
    aggregate_version:row.aggregate_version,event_type:row.event_type,payload:p});
  if(row.event_digest!==eventDigest(committed)||p.instruction_id!==input.operation_id||p.kind!=='START'||
    row.aggregate_id!==t.attempt_id||p.body.slot_id!==t.slot_id||o.command_id!==input.operation_id||
    o.operation_id!==input.operation_id||o.organisation_id!==input.organisation_id||o.run_id!==input.run_id||
    o.payload_digest!==digest(p.body)||o.sequence!==row.aggregate_version||
    ['attempt_id','attempt_generation','authority_epoch','sandbox_id','sandbox_boot_generation'].some(key=>
      p[key]!==t[key as keyof typeof t]||o[key]!==p[key])||o.boot_id!==p.boot_id)
    fail('NATIVE_RECEIPT_MISMATCH','Admitted native receipt differs from the committed START and compute tuple');
  uuid(o.ledger_receipt_id);integer(o.ledger_version);
  for(const process of [o.observed_process,o.pinned_process??null])if(process!==null){
    const value=fields(process,['os_boot_id','pid','start_time','pgid']);
    uuid(value.os_boot_id);bounded(value.pid,1,2147483647);integer(value.start_time,true);bounded(value.pgid,1,2147483647);
  }
  if(o.state==='EXECUTING'&&o.observed_process===null||o.state==='ACCEPTED'&&o.observed_process!==null||
    o.pinned_process!=null&&o.observed_process!==null&&canonical(o.pinned_process)!==canonical(o.observed_process))
    fail('NATIVE_RECEIPT_MISMATCH','Native state contradicts its retained process identity');
  const credential=await tx.query(`SELECT 1 FROM hyperfide.identity_principals WHERE organisation_id=$1 AND run_id=$2
    AND credential_id=$3 AND role='RUNNER' AND sandbox_id=$4 AND boot_id=$5 AND boot_generation=$6
    AND (attempt_id IS NULL OR attempt_id=$7) AND (attempt_generation IS NULL OR attempt_generation=$8)`,
    [input.organisation_id,input.run_id,uuid(o.credential_id),t.sandbox_id,p.boot_id,t.sandbox_boot_generation,t.attempt_id,t.attempt_generation]);
  if(credential.rowCount!==1)fail('NATIVE_RECEIPT_MISMATCH','Native observation lost its authenticated runner binding');
  // The acknowledgement protocol has no terminal outcome kind. Preserve uncertainty
  // until a producer supplies evidence that distinguishes stopped, absent and completed.
  const state=o.state==='TERMINAL'?'UNCERTAIN':o.state;
  if(!['ACCEPTED','EXECUTING','UNCERTAIN'].includes(state))fail('NATIVE_RECEIPT_INCOMPLETE','Unknown native observation state');
  return {central_receipt_id:row.receipt_id,command_id:input.operation_id,token:t,
    payload_digest:input.payload_digest,state};
};
export function createComponent(context:ComponentContext):Component {
  const g=gateway(context);
  const component={apiVersion:1 as const,capabilities:{'events.instructions.v1':Object.freeze({issue,acceptInstruction,handoff,replayInstructions,recordRunnerAcknowledgement,lookupNativeLaunch,registerRunnerConsumer,resolveRunnerConsumer,readDispatchReceipt})},actions:{
    'instructions.describe':()=>({schema_version:1,kinds:['START','STEER','CANCEL'],identity:'stable-command-UUID',
      bounds:{body_bytes:65536,outstanding:256,runner_event_bytes:RUNNER_EVENT_BOUNDS.payload_bytes,runner_events_per_stream:RUNNER_EVENT_BOUNDS.events_per_stream},execution:'native-connector-required',full_case_status:'INCOMPLETE'}),
    'instructions.issue':(input:unknown,context:ComponentContext)=>authorizedRun(g,context,input,['OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR'],async(tx,invocation)=>{await issueAuthority(tx,input,invocation);return issue(tx,input);}),
    'instructions.accept':(input:unknown,context:ComponentContext)=>authorizedRun(g,context,input,['OPERATOR','COORDINATOR','DISPATCH'],tx=>acceptInstruction(tx,input)),
    'instructions.replay':(input:unknown,context:ComponentContext)=>authorizedRun(g,context,input,['OPERATOR','COORDINATOR','DISPATCH'],tx=>replayInstructions(tx,input)),
    'instructions.lookup-native':(input:unknown,context:ComponentContext)=>authorizedRun(g,context,input,['RUNNER','OPERATOR','COORDINATOR','DISPATCH'],(tx,invocation)=>lookupNativeLaunch(tx,input,invocation)),
    // Runner-facing poll/delivery, acknowledgement and event ingress are bound in api.ts.
    ...runnerApi(g)
  }};
  return component;
}
