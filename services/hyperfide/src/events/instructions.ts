import { randomUUID } from 'node:crypto';
import type { Component, ComponentContext } from '../components/registry.js';
import type { PrimaryTransaction } from '../storage/transactions.js';
import { assertPrimaryTransaction } from '../storage/transactions.js';
import { fields,scope,uuid,integer,canonical,digest,eventDigest,event,fail,gateway,run,lockRun,enqueue } from './outbox.js';
import type { Scope,OutboxEvent } from './outbox.js';
import { receive } from './inbox.js';

interface Instruction extends Scope { id:string; attempt_id:string; attempt_generation:string;
  authority_epoch:string; sandbox_boot_generation:string; kind:'START'|'STEER'|'CANCEL'; body:Record<string,unknown> }
function instruction(value:unknown):Instruction {
  const v=fields(value,['organisation_id','run_id','id','attempt_id','attempt_generation','authority_epoch','sandbox_boot_generation','kind','body']);
  if(!['START','STEER','CANCEL'].includes(String(v.kind))||typeof v.body!=='object'||v.body===null||Array.isArray(v.body))
    fail('INSTRUCTION_INPUT_INVALID','Instruction needs a supported kind and JSON object body');
  const encoded=canonical(v.body);
  if(Buffer.byteLength(encoded)>65536) fail('INSTRUCTION_INPUT_INVALID','Instruction body exceeds spool bound');
  return {...scope(v),id:uuid(v.id),attempt_id:uuid(v.attempt_id),attempt_generation:integer(v.attempt_generation),
    authority_epoch:uuid(v.authority_epoch),sandbox_boot_generation:integer(v.sandbox_boot_generation),
    kind:v.kind as Instruction['kind'],body:JSON.parse(encoded) as Record<string,unknown>};
}
async function currentAuthority(tx:PrimaryTransaction,i:Instruction,allowExpiredCancel=false):Promise<{sandbox_id:string;boot_id:string}> {
  assertPrimaryTransaction(tx);
  await lockRun(tx,i);
  const target=await tx.query('SELECT task_id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
    [i.organisation_id,i.run_id,i.attempt_id]);
  if(target.rowCount!==1) fail('INSTRUCTION_STALE_AUTHORITY','Attempt does not exist in this run');
  await tx.query('SELECT id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
    [i.organisation_id,i.run_id,target.rows[0]!.task_id]);
  const found=await tx.query(`SELECT a.*,r.authority_epoch AS current_epoch,t.current_attempt_id,t.generation AS current_generation,
    s.boot_generation AS current_boot,b.boot_id AS current_boot_id,l.state AS lease_state,l.expires_at>clock_timestamp() AS lease_unexpired
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
  if(!allowExpiredCancel&&(a.compute_authority!=='CURRENT'||a.lease_state!=='ACTIVE'||!a.lease_unexpired||
      !['PLANNED','RESERVED','PREPARING','START_REQUESTED','RUNNING'].includes(a.execution_state as string)))
    fail('INSTRUCTION_STALE_AUTHORITY','Current live compute authority is required');
  return {sandbox_id:uuid(a.sandbox_id),boot_id:uuid(a.current_boot_id)};
}
function bodyOf(i:Instruction,target:{sandbox_id:string;boot_id:string}):Record<string,unknown> {
  return {instruction_id:i.id,attempt_id:i.attempt_id,attempt_generation:i.attempt_generation,
    authority_epoch:i.authority_epoch,sandbox_boot_generation:i.sandbox_boot_generation,kind:i.kind,body:i.body,...target};
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
    return enqueue(tx,{...scope(i as unknown as Record<string,unknown>),id:r.id,aggregate_type:r.aggregate_type,
      aggregate_id:r.aggregate_id,aggregate_version:r.aggregate_version,event_type:r.event_type,payload:r.payload});
  }
  const target=await currentAuthority(tx,i,i.kind==='CANCEL');
  const queued=await tx.query(`SELECT count(DISTINCT e.id)::int AS count FROM hyperfide.outbox_events e
    JOIN hyperfide.event_deliveries d ON(d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id)
    WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.aggregate_type='attempt.instructions' AND e.aggregate_id=$3 AND d.state<>'ACKNOWLEDGED'`,
    [i.organisation_id,i.run_id,i.attempt_id]);
  if((queued.rows[0]!.count as number)>=256) fail('INSTRUCTION_BACKPRESSURE','Outstanding instruction spool is full; preserve and reconcile existing obligations');
  const history=await tx.query("SELECT event_type,aggregate_version FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type='attempt.instructions' AND aggregate_id=$3 ORDER BY aggregate_version",
    [i.organisation_id,i.run_id,i.attempt_id]);
  if(history.rows.some(r=>r.event_type==='instruction.cancel')) fail('INSTRUCTION_CANCELLED','Cancellation intent already fences additional instructions');
  if(i.kind==='START'&&history.rows.some(r=>r.event_type==='instruction.start'))
    fail('INSTRUCTION_START_EXISTS','This attempt already has a stable logical start command');
  const version=history.rows.length?(BigInt(history.rows.at(-1)!.aggregate_version as string)+1n).toString():'1';
  return enqueue(tx,{...scope(i as unknown as Record<string,unknown>),id:i.id,aggregate_type:'attempt.instructions',
    aggregate_id:i.attempt_id,aggregate_version:version,event_type:'instruction.'+i.kind.toLowerCase(),payload:bodyOf(i,target)});
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
    const target=await currentAuthority(inner,i,i.kind==='CANCEL');
    if(p.sandbox_id!==target.sandbox_id||p.boot_id!==target.boot_id) fail('INSTRUCTION_STALE_AUTHORITY','Instruction boot identity no longer matches the current target');
    const cancelled=await inner.query("SELECT 1 FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type='attempt.instructions' AND aggregate_id=$3 AND event_type='instruction.cancel' LIMIT 1",
      [i.organisation_id,i.run_id,i.attempt_id]);
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

export async function handoff(tx:PrimaryTransaction,input:unknown):Promise<unknown> {
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
  const target=await currentAuthority(tx,i,i.kind==='CANCEL');
  if(p.sandbox_id!==target.sandbox_id||p.boot_id!==target.boot_id) fail('INSTRUCTION_STALE_AUTHORITY','Native handoff boot identity is stale');
  if(i.kind!=='CANCEL') {
    const cancel=await tx.query("SELECT 1 FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type='attempt.instructions' AND aggregate_id=$3 AND event_type='instruction.cancel' LIMIT 1",
      [s.organisation_id,s.run_id,i.attempt_id]);
    if(cancel.rows.length) return {accepted:false,state:'SUPPRESSED_BY_CANCELLATION',command_id:id,execution:'NOT_DISPATCHED'};
  }
  return {accepted:true,command_id:id,operation_id:id,...s,attempt_id:i.attempt_id,attempt_generation:i.attempt_generation,
    authority_epoch:i.authority_epoch,sandbox_id:target.sandbox_id,boot_id:target.boot_id,
    sandbox_boot_generation:i.sandbox_boot_generation,sequence:integer(row.aggregate_version),kind:i.kind,
    payload_base64url:Buffer.from(canonical(i.body),'utf8').toString('base64url'),payload_digest:digest(i.body),
    state:'READY_FOR_NATIVE_ACCEPTANCE',execution:'PENDING_NATIVE_CONNECTOR'};
}

export function createComponent(context:ComponentContext):Component {
  const g=gateway(context);
  const component={apiVersion:1 as const,capabilities:{'events.instructions.v1':Object.freeze({issue,acceptInstruction,handoff})},actions:{
    'instructions.describe':()=>({schema_version:1,kinds:['START','STEER','CANCEL'],identity:'stable-command-UUID',
      bounds:{body_bytes:65536,outstanding:256},execution:'native-connector-required',full_case_status:'INCOMPLETE'}),
    'instructions.issue':(input:unknown)=>run(g,tx=>issue(tx,input)),
    'instructions.accept':(input:unknown)=>run(g,tx=>acceptInstruction(tx,input)),
    'instructions.handoff':(input:unknown)=>run(g,tx=>handoff(tx,input))
  }};
  return component;
}
