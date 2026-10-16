import { randomUUID } from 'node:crypto';
import type { Component, ComponentContext } from '../components/registry.js';
import type { PrimaryTransaction } from '../storage/transactions.js';
import { assertPrimaryTransaction } from '../storage/transactions.js';
import { event, eventDigest, fields, scope, uuid, name, integer, bounded, canonical, digest, fail, gateway, run, lockRun, authorizedRun } from './outbox.js';
import type { OutboxEvent, Scope } from './outbox.js';

export interface InboxResult { status:'APPLIED'|'DUPLICATE'|'GAP'|'RESNAPSHOT_REQUIRED'; event_id:string;
  inbox_id?:string; expected_version?:string; observed_version?:string; result?:unknown }
const keys=['organisation_id','run_id'] as const;
const aggregateKey=(type:string,id:string)=>type+':'+id;
async function fetchEvent(tx:PrimaryTransaction,s:Scope,id:string,consumer:string):Promise<OutboxEvent> {
  const result=await tx.query(`SELECT e.* FROM hyperfide.outbox_events e JOIN hyperfide.event_deliveries d
    ON(d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id)
    JOIN hyperfide.event_consumers c ON(c.organisation_id=d.organisation_id AND c.run_id=d.run_id AND c.id=d.consumer_id AND c.state='ACTIVE')
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
  const key=aggregateKey(e.aggregate_type,e.aggregate_id);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[s.organisation_id+':'+s.run_id+':'+consumer+':'+key]);
  const counterDigest=digest({consumer_id:consumer,aggregate_key:key});
  const existing=await tx.query("SELECT * FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.receive' AND idempotency_key=$4 FOR UPDATE",
    [s.organisation_id,s.run_id,consumer,id]);
  if(existing.rows.length) {
    const row=existing.rows[0]!;
    if(row.request_digest!==requestDigest) fail('INBOX_IDEMPOTENCY_CONFLICT','Inbox event identity has conflicting immutable contents');
    if(row.state!=='COMPLETED') fail('INBOX_RECEIPT_INCOMPLETE','Prior receiver effect is not durably complete');
    return {status:'DUPLICATE',event_id:id,inbox_id:row.id as string,result:row.result};
  }
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

export interface SnapshotBootstrap extends Scope {bootstrap_id:string;consumer_id:string;aggregate_types:readonly string[];limit:number}
export async function bootstrapConsumer(tx:PrimaryTransaction,input:SnapshotBootstrap,
    buildSnapshot:(tx:PrimaryTransaction)=>Promise<unknown>):Promise<unknown> {
  assertPrimaryTransaction(tx);
  const v=fields(input,['organisation_id','run_id','bootstrap_id','consumer_id','aggregate_types','limit']),s=scope(v),
    consumer=uuid(v.consumer_id),bootstrap=uuid(v.bootstrap_id),limit=bounded(v.limit,1,16384);
  if(!Array.isArray(v.aggregate_types)||v.aggregate_types.length<1||v.aggregate_types.length>32||typeof buildSnapshot!=='function')
    fail('INBOX_SNAPSHOT_INVALID','Bootstrap requires a trusted snapshot builder and bounded aggregate namespaces');
  const types=[...new Set(v.aggregate_types.map(name))].sort();
  if(types.length!==v.aggregate_types.length||types.includes('attempt.instructions'))
    fail('INBOX_SNAPSHOT_INVALID','Native instructions require their own generation-bound replay, never generic snapshot admission');
  const requestDigest=digest({...s,consumer_id:consumer,bootstrap_id:bootstrap,aggregate_types:types});
  await lockRun(tx,s,'exclusive');
  const old=await tx.query("SELECT request_digest,state,result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.snapshot' AND idempotency_key=$4",
    [s.organisation_id,s.run_id,consumer,bootstrap]);
  if(old.rows.length) {
    if(old.rows[0]!.state!=='COMPLETED'||old.rows[0]!.request_digest!==requestDigest)
      fail('INBOX_IDEMPOTENCY_CONFLICT','Snapshot identity was reused with different immutable scope');
    return {...old.rows[0]!.result as Record<string,unknown>,replayed:true};
  }
  const registered=await tx.query("SELECT state FROM hyperfide.event_consumers WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE",
    [s.organisation_id,s.run_id,consumer]);
  if(registered.rows[0]?.state!=='BUFFERING') fail('INBOX_SNAPSHOT_INVALID','Only a registered buffering consumer can bootstrap');
  const existing=await tx.query("SELECT 1 FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation IN('event.aggregate','event.receive') LIMIT 1",
    [s.organisation_id,s.run_id,consumer]);
  if(existing.rows.length) fail('INBOX_SNAPSHOT_INVALID','An unproven partially applied consumer needs explicit recovery');
  const unsupported=await tx.query(`SELECT 1 FROM hyperfide.event_deliveries d JOIN hyperfide.outbox_events e
    ON(e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id)
    WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.consumer_id=$3 AND NOT(e.aggregate_type=ANY($4::text[])) LIMIT 1`,
    [s.organisation_id,s.run_id,consumer,types]);
  if(unsupported.rows.length) fail('INBOX_SNAPSHOT_INVALID','Snapshot builder does not cover every buffered aggregate namespace');
  const baselines=await tx.query(`SELECT DISTINCT ON(aggregate_type,aggregate_id) aggregate_type,aggregate_id,aggregate_version,id AS last_event_id,
    bool_or(event_type IN('aggregate.cancelled','aggregate.completed')) OVER(PARTITION BY aggregate_type,aggregate_id) AS terminal
    FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type=ANY($3::text[])
    ORDER BY aggregate_type,aggregate_id,aggregate_version DESC LIMIT $4`,[s.organisation_id,s.run_id,types,limit+1]);
  const buffered=await tx.query(`SELECT e.* FROM hyperfide.outbox_events e JOIN hyperfide.event_deliveries d
    ON(d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id)
    WHERE e.organisation_id=$1 AND e.run_id=$2 AND d.consumer_id=$3 ORDER BY e.id LIMIT $4`,
    [s.organisation_id,s.run_id,consumer,limit+1]);
  if(baselines.rows.length>limit||buffered.rows.length>limit)
    fail('INBOX_SNAPSHOT_BOUND','Snapshot exceeds the declared transaction bound; consumer remains buffering');
  // Exclusive run coordination fences producers while the linked builder reads/writes its actual projection.
  const snapshot=JSON.parse(canonical(await buildSnapshot(tx))) as unknown,snapshotDigest=digest(snapshot),snapshotId=randomUUID();
  const result={bootstrap_id:bootstrap,snapshot_id:snapshotId,snapshot_digest:snapshotDigest,snapshot,
    aggregate_baselines:baselines.rows.length,covered_deliveries:buffered.rows.length,activated:true,replayed:false};
  if(baselines.rows.length) {
    const rows=baselines.rows.map(r=>({id:randomUUID(),key:aggregateKey(r.aggregate_type as string,r.aggregate_id as string),
      digest:digest({consumer_id:consumer,aggregate_key:aggregateKey(r.aggregate_type as string,r.aggregate_id as string)}),
      result:canonical({version:r.aggregate_version,terminal:r.terminal,last_event_id:r.last_event_id,snapshot_id:snapshotId})}));
    await tx.query(`INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result)
      SELECT $1,$2,x.id,$3,'event.aggregate',x.key,x.digest,'COMPLETED',x.result::jsonb
      FROM unnest($4::uuid[],$5::text[],$6::text[],$7::text[]) AS x(id,key,digest,result)`,
      [s.organisation_id,s.run_id,consumer,rows.map(r=>r.id),rows.map(r=>r.key),rows.map(r=>r.digest),rows.map(r=>r.result)]);
  }
  if(buffered.rows.length) {
    const rows=buffered.rows.map(r=>({id:randomUUID(),event_id:r.id,digest:eventDigest(event({...s,id:r.id,aggregate_type:r.aggregate_type,
      aggregate_id:r.aggregate_id,aggregate_version:r.aggregate_version,event_type:r.event_type,payload:r.payload}))}));
    await tx.query(`INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result)
      SELECT $1,$2,x.id,$3,'event.receive',x.event_id,x.digest,'COMPLETED',$7::jsonb
      FROM unnest($4::uuid[],$5::text[],$6::text[]) AS x(id,event_id,digest)`,
      [s.organisation_id,s.run_id,consumer,rows.map(r=>r.id),rows.map(r=>r.event_id),rows.map(r=>r.digest),
        canonical({recorded:true,mode:'SNAPSHOT_BASELINE',snapshot_id:snapshotId,snapshot_digest:snapshotDigest})]);
  }
  await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'event.snapshot',$5,$6,'COMPLETED',$7::jsonb)",
    [s.organisation_id,s.run_id,snapshotId,consumer,bootstrap,requestDigest,canonical(result)]);
  await tx.query("UPDATE hyperfide.event_consumers SET state='ACTIVE',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='BUFFERING'",
    [s.organisation_id,s.run_id,consumer]);
  return result;
}

export interface DeliverySupersession extends Scope {transfer_id:string;original_event_id:string;original_consumer_id:string;
  replacement_event_id:string;replacement_consumer_id:string}
export async function supersedeDelivery(tx:PrimaryTransaction,input:DeliverySupersession,
    authorize:(tx:PrimaryTransaction,events:{original:OutboxEvent;replacement:OutboxEvent})=>Promise<Record<string,unknown>>):Promise<unknown> {
  assertPrimaryTransaction(tx);
  const v=fields(input,['organisation_id','run_id','transfer_id','original_event_id','original_consumer_id','replacement_event_id','replacement_consumer_id']),
    s=scope(v),transfer=uuid(v.transfer_id),originalId=uuid(v.original_event_id),originalConsumer=uuid(v.original_consumer_id),
    replacementId=uuid(v.replacement_event_id),replacementConsumer=uuid(v.replacement_consumer_id);
  if(originalId===replacementId||typeof authorize!=='function')
    fail('INBOX_SUPERSESSION_INVALID','Transfer requires distinct immutable events and a trusted authority callback');
  await lockRun(tx,s,'exclusive');
  const rows=await tx.query(`SELECT e.*,d.consumer_id,d.state AS delivery_state FROM hyperfide.outbox_events e
    JOIN hyperfide.event_deliveries d ON(d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id)
    WHERE e.organisation_id=$1 AND e.run_id=$2 AND ((e.id=$3 AND d.consumer_id=$4) OR(e.id=$5 AND d.consumer_id=$6))
    FOR UPDATE OF d`,[s.organisation_id,s.run_id,originalId,originalConsumer,replacementId,replacementConsumer]);
  if(rows.rows.length!==2) fail('INBOX_SUPERSESSION_INVALID','Exact original and replacement obligations must already exist');
  const decode=(r:Record<string,unknown>)=>event({...s,id:r.id,aggregate_type:r.aggregate_type,aggregate_id:r.aggregate_id,
    aggregate_version:r.aggregate_version,event_type:r.event_type,payload:r.payload});
  const original=decode(rows.rows.find(r=>r.id===originalId)!),replacement=decode(rows.rows.find(r=>r.id===replacementId)!);
  if(!((original.aggregate_type==='human_command'&&original.event_type==='leader.intent.requested')||
      (original.aggregate_type==='human_intent_transfer'&&original.event_type==='leader.intent.adopted'))||
    replacement.aggregate_type!=='human_intent_transfer'||replacement.event_type!=='leader.intent.adopted'||
    original.aggregate_version!=='1'||replacement.aggregate_version!=='1'||
    replacement.payload.supersedes_event_id!==originalId||
    replacement.payload.original_event_id!==(original.aggregate_type==='human_command'?originalId:original.payload.original_event_id)||
    BigInt(integer(replacement.payload.leader_generation,true))<=BigInt(integer(original.payload.leader_generation,true)))
    fail('INBOX_SUPERSESSION_INVALID','Transfer does not preserve its direct source, root intent and strictly newer leadership generation');
  const evidence=await authorize(tx,{original,replacement});
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||Object.keys(evidence).length===0)
    fail('INBOX_SUPERSESSION_INVALID','Linked authority must produce durable replacement evidence');
  const requestDigest=digest({...s,transfer_id:transfer,original_event_id:originalId,original_consumer_id:originalConsumer,
    replacement_event_id:replacementId,replacement_consumer_id:replacementConsumer,
    original_digest:eventDigest(original),replacement_digest:eventDigest(replacement)});
  const prior=await tx.query("SELECT request_digest,state,result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.supersede' AND idempotency_key=$4",
    [s.organisation_id,s.run_id,originalConsumer,transfer]);
  if(prior.rows.length) {
    if(prior.rows[0]!.request_digest!==requestDigest||prior.rows[0]!.state!=='COMPLETED')
      fail('INBOX_IDEMPOTENCY_CONFLICT','Transfer identity was reused with different immutable event bindings');
    return {...prior.rows[0]!.result as Record<string,unknown>,replayed:true};
  }
  const edge=await tx.query("SELECT request_digest FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.superseded-edge' AND idempotency_key=$4",
    [s.organisation_id,s.run_id,originalConsumer,originalId]);
  if(edge.rows.length) fail('INBOX_SUPERSESSION_CONFLICT','The direct source already has a committed replacement; adopt that replacement to extend the chain');
  const admission=await tx.query("SELECT id,request_digest,state FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.receive' AND idempotency_key=$4 FOR UPDATE",
    [s.organisation_id,s.run_id,originalConsumer,originalId]);
  if(admission.rows.length&&(admission.rows[0]!.request_digest!==eventDigest(original)||admission.rows[0]!.state!=='COMPLETED'))
    fail('INBOX_RECEIPT_INCOMPLETE','Prior original admission has conflicting or incomplete provenance');
  const receiptId=admission.rows[0]?.id??randomUUID(),result={transfer_id:transfer,original_event_id:originalId,original_consumer_id:originalConsumer,
    replacement_event_id:replacementId,replacement_consumer_id:replacementConsumer,inbox_id:receiptId,
    original_retired:true,replacement_acknowledged_by_transfer:false,source_preserved:true,task_completed:false,replayed:false,evidence};
  if(!admission.rows.length) await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'event.receive',$5,$6,'COMPLETED',$7::jsonb)",
    [s.organisation_id,s.run_id,receiptId,originalConsumer,originalId,eventDigest(original),canonical({recorded:true,mode:'SUPERSEDED_BY_AUTHORISED_TRANSFER',transfer_id:transfer,replacement_event_id:replacementId})]);
  await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'event.supersede',$5,$6,'COMPLETED',$7::jsonb)",
    [s.organisation_id,s.run_id,randomUUID(),originalConsumer,transfer,requestDigest,canonical(result)]);
  await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'event.superseded-edge',$5,$6,'COMPLETED',$7::jsonb)",
    [s.organisation_id,s.run_id,randomUUID(),originalConsumer,originalId,requestDigest,canonical(result)]);
  await tx.query("UPDATE hyperfide.event_deliveries SET state='ACKNOWLEDGED',acknowledged_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND event_id=$3 AND consumer_id=$4 AND state<>'ACKNOWLEDGED'",
    [s.organisation_id,s.run_id,originalId,originalConsumer]);
  return result;
}
export interface EventInboxCapability {receive:typeof receive;replay:typeof replay;bootstrapConsumer:typeof bootstrapConsumer;supersedeDelivery:typeof supersedeDelivery}
export function isEventInboxCapability(value:unknown):value is EventInboxCapability {
  const v=value as Partial<EventInboxCapability>|null;
  return !!v&&typeof v.receive==='function'&&typeof v.replay==='function'&&typeof v.bootstrapConsumer==='function'&&typeof v.supersedeDelivery==='function';
}
export function createComponent(context:ComponentContext):Component {
  const g=gateway(context);
  const component={apiVersion:1 as const,capabilities:{'events.inbox.v1':Object.freeze({receive,replay,bootstrapConsumer,supersedeDelivery})},actions:{
    'inbox.describe':()=>({schema_version:1,effect:'transactional-linked-callback',duplicate_effects:false,
      gap:'defer-and-replay-or-resnapshot-required',full_case_status:'INCOMPLETE'}),
    'inbox.receive':(input:unknown,context:ComponentContext)=>authorizedRun(g,context,input,['OPERATOR','COORDINATOR','DISPATCH'],tx=>receive(tx,input)),
    'inbox.replay':(input:unknown,context:ComponentContext)=>authorizedRun(g,context,input,['OPERATOR','COORDINATOR','DISPATCH'],tx=>replay(tx,input))
  }};
  return component;
}
