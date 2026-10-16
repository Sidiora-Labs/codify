import { randomUUID } from 'node:crypto';
import type { Component, ComponentContext } from '../components/registry.js';
import type { PrimaryTransaction } from '../storage/transactions.js';
import { assertPrimaryTransaction } from '../storage/transactions.js';
import { event, eventDigest, fields, scope, uuid, name, integer, bounded, canonical, digest, fail, gateway, run, lockRun } from './outbox.js';
import type { OutboxEvent, Scope } from './outbox.js';

export interface InboxResult { status:'APPLIED'|'DUPLICATE'|'GAP'|'RESNAPSHOT_REQUIRED'; event_id:string;
  inbox_id?:string; expected_version?:string; observed_version?:string; result?:unknown }
const keys=['organisation_id','run_id'] as const;
const aggregateKey=(type:string,id:string)=>type+':'+id;
async function fetchEvent(tx:PrimaryTransaction,s:Scope,id:string,consumer:string):Promise<OutboxEvent> {
  const result=await tx.query(`SELECT e.* FROM hyperfide.outbox_events e JOIN hyperfide.event_deliveries d
    ON(d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id)
    WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.id=$3 AND d.consumer_id=$4`,
    [s.organisation_id,s.run_id,id,consumer]);
  if(result.rowCount!==1) fail('INBOX_EVENT_NOT_FOUND','No scoped delivery binds this consumer and event');
  const r=result.rows[0]!;
  return event({organisation_id:r.organisation_id,run_id:r.run_id,id:r.id,aggregate_type:r.aggregate_type,
    aggregate_id:r.aggregate_id,aggregate_version:r.aggregate_version,event_type:r.event_type,payload:r.payload});
}
export async function receive(tx:PrimaryTransaction,input:unknown,
    apply?:(tx:PrimaryTransaction,e:OutboxEvent)=>Promise<unknown>):Promise<InboxResult> {
  assertPrimaryTransaction(tx);
  const v=fields(input,[...keys,'event_id','consumer_id']),s=scope(v),id=uuid(v.event_id),consumer=uuid(v.consumer_id);
  await lockRun(tx,s);
  const e=await fetchEvent(tx,s,id,consumer),requestDigest=eventDigest(e);
  if(e.aggregate_type==='attempt.instructions'&&!apply) fail('INBOX_TRUSTED_HANDLER_REQUIRED','Instructions require the generation-bound linked receiver');
  const existing=await tx.query("SELECT * FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.receive' AND idempotency_key=$4 FOR UPDATE",
    [s.organisation_id,s.run_id,consumer,id]);
  if(existing.rows.length) {
    const row=existing.rows[0]!;
    if(row.request_digest!==requestDigest) fail('INBOX_IDEMPOTENCY_CONFLICT','Inbox event identity has conflicting immutable contents');
    if(row.state!=='COMPLETED') fail('INBOX_RECEIPT_INCOMPLETE','Prior receiver effect is not durably complete');
    return {status:'DUPLICATE',event_id:id,inbox_id:row.id as string,result:row.result};
  }
  const key=aggregateKey(e.aggregate_type,e.aggregate_id);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[s.organisation_id+':'+s.run_id+':'+consumer+':'+key]);
  const counterDigest=digest({consumer_id:consumer,aggregate_key:key});
  let counter=await tx.query("SELECT * FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.aggregate' AND idempotency_key=$4 FOR UPDATE",
    [s.organisation_id,s.run_id,consumer,key]);
  if(!counter.rows.length) {
    await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'event.aggregate',$5,$6,'COMPLETED',$7::jsonb)",
      [s.organisation_id,s.run_id,randomUUID(),consumer,key,counterDigest,canonical({version:'0',terminal:false})]);
    counter=await tx.query("SELECT * FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.aggregate' AND idempotency_key=$4 FOR UPDATE",
      [s.organisation_id,s.run_id,consumer,key]);
  }
  const row=counter.rows[0]!,prior=row.result as Record<string,unknown>;
  if(row.request_digest!==counterDigest||row.state!=='COMPLETED'||!prior||typeof prior.terminal!=='boolean')
    fail('INBOX_COUNTER_INVALID','Durable aggregate cursor has invalid provenance');
  const current=BigInt(integer(prior.version,true)),expected=(current+1n).toString(),observed=e.aggregate_version;
  if(BigInt(observed)!==current+1n) {
    const available=await tx.query("SELECT min(aggregate_version)::text AS minimum FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type=$3 AND aggregate_id=$4 AND aggregate_version>$5",
      [s.organisation_id,s.run_id,e.aggregate_type,e.aggregate_id,current.toString()]);
    const minimum=available.rows[0]?.minimum as string|null;
    return {status:BigInt(observed)<=current||minimum!==expected?'RESNAPSHOT_REQUIRED':'GAP',
      event_id:id,expected_version:expected,observed_version:observed};
  }
  if(prior.terminal===true) fail('INBOX_TERMINAL','Terminal aggregate cannot accept another effect');
  // The effect callback is trusted linked code, never a caller-provided command or SQL string.
  // Its writes and this receipt share the caller primary transaction.
  const result=JSON.parse(canonical(apply?await apply(tx,e):{recorded:true})) as unknown,inboxId=randomUUID();
  await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'event.receive',$5,$6,'COMPLETED',$7::jsonb)",
    [s.organisation_id,s.run_id,inboxId,consumer,id,requestDigest,canonical(result)]);
  const terminal=['instruction.cancel','aggregate.cancelled','aggregate.completed'].includes(e.event_type);
  await tx.query("UPDATE hyperfide.command_inbox SET result=$5::jsonb,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.aggregate' AND idempotency_key=$4",
    [s.organisation_id,s.run_id,consumer,key,canonical({version:observed,terminal,last_event_id:id})]);
  return {status:'APPLIED',event_id:id,inbox_id:inboxId,result};
}
export async function replay(tx:PrimaryTransaction,input:unknown):Promise<unknown> {
  assertPrimaryTransaction(tx);
  const v=fields(input,[...keys,'consumer_id','aggregate_type','aggregate_id','limit']),s=scope(v),
    consumer=uuid(v.consumer_id),type=name(v.aggregate_type),id=uuid(v.aggregate_id),limit=bounded(v.limit,1,64);
  await lockRun(tx,s);
  const records=await tx.query(`SELECT e.id FROM hyperfide.outbox_events e JOIN hyperfide.event_deliveries d
    ON(d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id)
    WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.aggregate_type=$3 AND e.aggregate_id=$4 AND d.consumer_id=$5
      AND NOT EXISTS(SELECT 1 FROM hyperfide.command_inbox i WHERE i.organisation_id=e.organisation_id AND i.run_id=e.run_id
        AND i.principal_scope=$5::text AND i.operation='event.receive' AND i.idempotency_key=e.id::text AND i.state='COMPLETED')
    ORDER BY e.aggregate_version,e.id LIMIT $6`,[s.organisation_id,s.run_id,type,id,consumer,limit]);
  const results:InboxResult[]=[];
  for(const row of records.rows) {
    const result=await receive(tx,{...s,event_id:row.id,consumer_id:consumer});
    results.push(result);
    if(result.status==='GAP'||result.status==='RESNAPSHOT_REQUIRED') break;
  }
  return {results,resnapshot_required:results.some(r=>r.status==='RESNAPSHOT_REQUIRED'),complete:records.rows.length<limit && !results.some(r=>r.status==='GAP'||r.status==='RESNAPSHOT_REQUIRED')};
}
export function createComponent(context:ComponentContext):Component {
  const g=gateway(context);
  const component={apiVersion:1 as const,capabilities:{'events.inbox.v1':Object.freeze({receive,replay})},actions:{
    'inbox.describe':()=>({schema_version:1,effect:'transactional-linked-callback',duplicate_effects:false,
      gap:'defer-and-replay-or-resnapshot-required',full_case_status:'INCOMPLETE'}),
    'inbox.receive':(input:unknown)=>run(g,tx=>receive(tx,input)),
    'inbox.replay':(input:unknown)=>run(g,tx=>replay(tx,input))
  }};
  return component;
}
