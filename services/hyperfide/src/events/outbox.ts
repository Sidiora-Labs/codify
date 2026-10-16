import { createHash } from 'node:crypto';
import type { Component, ComponentContext } from '../components/registry.js';
import { FoundationError, object } from '../policy/programme.js';
import { assertPrimaryTransaction } from '../storage/transactions.js';
import type { PrimaryTransaction, TransactionGateway } from '../storage/transactions.js';

export interface Scope { organisation_id: string; run_id: string }
export interface OutboxEvent extends Scope {
  id: string; aggregate_type: string; aggregate_id: string; aggregate_version: string;
  event_type: string; payload: Record<string, unknown>;
}
export interface DeliveryClaim extends OutboxEvent {
  consumer_id: string; attempt_count: string; lease_expires_at: string;
}
export function fail(code: string, message: string): never { throw new FoundationError(code, message); }
export function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!object(value) || required.some(k => !Object.hasOwn(value, k)) ||
      Object.keys(value).some(k => !required.includes(k) && !optional.includes(k)))
    fail('EVENT_INPUT_INVALID', 'Fields do not match the bounded event operation');
  return value;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
    fail('EVENT_INPUT_INVALID', 'Expected a canonical scoped UUID');
  return value;
}
export function name(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value))
    fail('EVENT_INPUT_INVALID', 'Expected a bounded event name');
  return value;
}
export function integer(value: unknown, zero = false): string {
  if (typeof value !== 'string' || !(zero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value) ||
      BigInt(value) > 9223372036854775807n) fail('EVENT_INPUT_INVALID', 'Expected a canonical bigint decimal string');
  return value;
}
export function bounded(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail('EVENT_INPUT_INVALID', 'Integer is outside the operation bound');
  return value;
}
export function scope(value: Record<string, unknown>): Scope {
  return { organisation_id: uuid(value.organisation_id), run_id: uuid(value.run_id) };
}
const scopeKeys = ['organisation_id','run_id'] as const;
export function canonical(value: unknown): string {
  const seen = new Set<object>();
  function encode(v: unknown, depth: number): string {
    if (depth > 32) fail('EVENT_INPUT_INVALID', 'JSON nesting exceeds bound');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || v === null || seen.has(v)) fail('EVENT_INPUT_INVALID', 'Expected finite acyclic JSON');
    seen.add(v);
    let encoded: string;
    if (Array.isArray(v)) encoded = '[' + v.map(item => encode(item,depth+1)).join(',') + ']';
    else if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
      encoded = '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+encode((v as Record<string,unknown>)[k],depth+1)).join(',') + '}';
    else return fail('EVENT_INPUT_INVALID', 'Expected plain JSON values');
    seen.delete(v);
    return encoded;
  }
  const result = encode(value,0);
  if (Buffer.byteLength(result) > 196608) fail('EVENT_INPUT_INVALID', 'Event payload exceeds bound');
  return result;
}
export function digest(value: unknown): string { return 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex'); }
export function event(value: unknown): OutboxEvent {
  const v = fields(value,[...scopeKeys,'id','aggregate_type','aggregate_id','aggregate_version','event_type','payload']);
  if (!object(v.payload)) fail('EVENT_INPUT_INVALID','Event payload must be an object');
  const result = { ...scope(v), id: uuid(v.id), aggregate_type: name(v.aggregate_type),
    aggregate_id: uuid(v.aggregate_id), aggregate_version: integer(v.aggregate_version),
    event_type: name(v.event_type), payload: JSON.parse(canonical(v.payload)) as Record<string,unknown> };
  return result;
}
export function eventDigest(e: OutboxEvent): string {
  return digest({ ...scope(e as unknown as Record<string,unknown>), id:e.id, aggregate_type:e.aggregate_type,
    aggregate_id:e.aggregate_id, aggregate_version:e.aggregate_version, event_type:e.event_type, payload:e.payload });
}
export function gateway(context: ComponentContext): TransactionGateway {
  const dependencies = (context as ComponentContext & {
    dependencies: { require<T>(id:string,capability:string,guard:(v:unknown)=>v is T):T }
  }).dependencies;
  if (!dependencies) fail('EVENT_DEPENDENCY_UNAVAILABLE','Primary transaction dependency is required');
  return dependencies.require('4.2','storage.transactions.v1',
    (v:unknown):v is TransactionGateway => object(v) && typeof v.withPrimaryTransaction === 'function');
}
export async function run<T>(g: TransactionGateway, operation:(tx:PrimaryTransaction)=>Promise<T>): Promise<T> {
  return g.withPrimaryTransaction({timeoutMs:10000,maxRetries:3},operation);
}
// Registration and creation use the same short run lock, preventing a subscriber gap.
export async function lockRun(tx: PrimaryTransaction, s: Scope, mode: 'shared'|'exclusive' = 'shared'): Promise<void> {
  assertPrimaryTransaction(tx);
  if (!['shared','exclusive'].includes(mode)) fail('EVENT_INPUT_INVALID','Unknown run lock mode');
  const found = await tx.query('SELECT id FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR ' + (mode==='exclusive'?'UPDATE':'SHARE'),
    [s.organisation_id,s.run_id]);
  if (found.rowCount !== 1) fail('EVENT_SCOPE_NOT_FOUND','Run is absent in this organisation');
}
export async function registerConsumer(tx: PrimaryTransaction, input: unknown): Promise<unknown> {
  const v=fields(input,[...scopeKeys,'id','consumer_key','critical','state']);
  const s=scope(v), id=uuid(v.id), key=name(v.consumer_key);
  if (typeof v.critical !== 'boolean' || !['ACTIVE','BUFFERING'].includes(String(v.state)))
    fail('EVENT_INPUT_INVALID','Registration needs critical and ACTIVE or BUFFERING');
  await lockRun(tx,s,'exclusive');
  const old = await tx.query('SELECT * FROM hyperfide.event_consumers WHERE organisation_id=$1 AND run_id=$2 AND (id=$3 OR consumer_key=$4) FOR UPDATE',
    [s.organisation_id,s.run_id,id,key]);
  if (old.rows.length) {
    const r=old.rows[0]!;
    if (old.rows.length!==1 || r.id!==id || r.consumer_key!==key || r.critical!==v.critical || r.state!==v.state)
      fail('EVENT_IDEMPOTENCY_CONFLICT','Consumer registration differs from its durable identity');
    return r;
  }
  if (v.state === 'ACTIVE') {
    const previous=await tx.query('SELECT 1 FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 LIMIT 1',
      [s.organisation_id,s.run_id]);
    if (previous.rows.length) fail('EVENT_BOOTSTRAP_REQUIRED','New subscriber must buffer before snapshot/replay');
  }
  const inserted=await tx.query('INSERT INTO hyperfide.event_consumers(organisation_id,run_id,id,consumer_key,critical,state) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [s.organisation_id,s.run_id,id,key,v.critical,v.state]);
  return inserted.rows[0];
}
export async function enqueue(tx: PrimaryTransaction, value: unknown, options?: {consumer_ids:readonly string[]}): Promise<{event:OutboxEvent; replayed:boolean; obligations:number}> {
  assertPrimaryTransaction(tx);
  const e=event(value);
  let selected:string[]|undefined;
  if(options!==undefined) {
    fields(options,['consumer_ids']);
    if(!Array.isArray(options.consumer_ids)||options.consumer_ids.length>256) fail('EVENT_INPUT_INVALID','Bounded consumer selection required');
    selected=options.consumer_ids.map(uuid);
    if(new Set(selected).size!==selected.length) fail('EVENT_INPUT_INVALID','Consumer selection contains duplicates');
  }
  await lockRun(tx,e);
  const existing=await tx.query('SELECT * FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND (id=$3 OR (aggregate_type=$4 AND aggregate_id=$5 AND aggregate_version=$6)) FOR UPDATE',
    [e.organisation_id,e.run_id,e.id,e.aggregate_type,e.aggregate_id,e.aggregate_version]);
  if(existing.rows.length) {
    const r=existing.rows[0]!;
    const stored=event({organisation_id:r.organisation_id,run_id:r.run_id,id:r.id,aggregate_type:r.aggregate_type,
      aggregate_id:r.aggregate_id,aggregate_version:r.aggregate_version,event_type:r.event_type,payload:r.payload});
    if(existing.rows.length!==1 || eventDigest(stored)!==eventDigest(e))
      fail('EVENT_IDEMPOTENCY_CONFLICT','Event identity was reused with different immutable contents');
    const prior=await tx.query('SELECT d.consumer_id,c.critical FROM hyperfide.event_deliveries d JOIN hyperfide.event_consumers c ON(c.organisation_id=d.organisation_id AND c.run_id=d.run_id AND c.id=d.consumer_id) WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.event_id=$3',
      [e.organisation_id,e.run_id,e.id]);
    if(selected) {
      const known=new Map(prior.rows.map(r=>[r.consumer_id as string,r.critical as boolean]));
      if(selected.some(id=>!known.has(id))||prior.rows.some(r=>!selected!.includes(r.consumer_id as string)))
        fail('EVENT_IDEMPOTENCY_CONFLICT','Replay changed the original delivery recipients');
    }
    return {event:stored,replayed:true,obligations:prior.rows.length};
  }
  const consumers=await tx.query("SELECT id,critical FROM hyperfide.event_consumers WHERE organisation_id=$1 AND run_id=$2 AND state IN ('ACTIVE','BUFFERING') ORDER BY id",
    [e.organisation_id,e.run_id]);
  if(selected && selected.some(id=>!consumers.rows.some(r=>r.id===id))) fail('EVENT_CONSUMER_REQUIRED','Selected consumer is not registered and standing');
  const recipients=consumers.rows.filter(r=>selected===undefined||selected.includes(r.id as string));
  if(!recipients.length) fail('EVENT_CONSUMER_REQUIRED','Register standing consumers before producing work');
  if(recipients.length>256) fail('EVENT_CONSUMER_LIMIT','Standing consumer fan-out exceeds the configured baseline bound');
  await tx.query('INSERT INTO hyperfide.outbox_events(organisation_id,run_id,id,aggregate_type,aggregate_id,aggregate_version,event_type,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [e.organisation_id,e.run_id,e.id,e.aggregate_type,e.aggregate_id,e.aggregate_version,e.event_type,canonical(e.payload)]);
  await tx.query("INSERT INTO hyperfide.event_deliveries(organisation_id,run_id,event_id,consumer_id) SELECT $1,$2,$3,unnest($4::uuid[])",
    [e.organisation_id,e.run_id,e.id,recipients.map(r=>r.id)]);
  return {event:e,replayed:false,obligations:recipients.length};
}
export async function claimPending(tx: PrimaryTransaction, input:unknown):Promise<DeliveryClaim[]> {
  assertPrimaryTransaction(tx);
  const v=fields(input,[...scopeKeys,'consumer_id','limit','lease_ms']),s=scope(v),consumer=uuid(v.consumer_id);
  const limit=bounded(v.limit,1,64),lease=bounded(v.lease_ms,50,300000);
  const result=await tx.query(`WITH candidates AS (
    SELECT d.organisation_id,d.run_id,d.event_id,d.consumer_id FROM hyperfide.event_deliveries d
    JOIN hyperfide.event_consumers c ON(c.organisation_id=d.organisation_id AND c.run_id=d.run_id AND c.id=d.consumer_id)
    WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.consumer_id=$3 AND c.state='ACTIVE'
      AND d.state IN ('PENDING','DELIVERING') AND d.next_attempt_at<=clock_timestamp()
    ORDER BY d.next_attempt_at,d.created_at,d.event_id FOR UPDATE OF d SKIP LOCKED LIMIT $4
  ), claimed AS (
    UPDATE hyperfide.event_deliveries d SET state='DELIVERING',attempt_count=d.attempt_count+1,
      state_version=d.state_version+1,next_attempt_at=clock_timestamp()+($5::int*interval '1 millisecond')
    FROM candidates c WHERE(d.organisation_id,d.run_id,d.event_id,d.consumer_id)=(c.organisation_id,c.run_id,c.event_id,c.consumer_id)
    RETURNING d.*
  ) SELECT e.*,d.consumer_id,d.attempt_count,d.next_attempt_at AS lease_expires_at FROM claimed d
    JOIN hyperfide.outbox_events e ON(e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id)
    ORDER BY d.created_at,e.id`,[s.organisation_id,s.run_id,consumer,limit,lease]);
  return result.rows.map(r=>({...event({organisation_id:r.organisation_id,run_id:r.run_id,id:r.id,aggregate_type:r.aggregate_type,
    aggregate_id:r.aggregate_id,aggregate_version:r.aggregate_version,event_type:r.event_type,payload:r.payload}),
    consumer_id:r.consumer_id as string,attempt_count:r.attempt_count as string,
    lease_expires_at:(r.lease_expires_at as Date).toISOString()}));
}
export async function currentClaim(tx:PrimaryTransaction,input:unknown):Promise<{scope:Scope;event_id:string;consumer_id:string;attempt_count:string;row:Record<string,unknown>}> {
  assertPrimaryTransaction(tx);
  const v=fields(input,[...scopeKeys,'event_id','consumer_id','attempt_count']);
  const s=scope(v),id=uuid(v.event_id),consumer=uuid(v.consumer_id),attempt=integer(v.attempt_count);
  const r=await tx.query('SELECT *,next_attempt_at>clock_timestamp() AS unexpired FROM hyperfide.event_deliveries WHERE organisation_id=$1 AND run_id=$2 AND event_id=$3 AND consumer_id=$4 FOR UPDATE',
    [s.organisation_id,s.run_id,id,consumer]);
  if(r.rowCount!==1) fail('EVENT_DELIVERY_NOT_FOUND','Scoped delivery does not exist');
  const row=r.rows[0]!;
  if(row.attempt_count!==attempt) fail('EVENT_STALE_CLAIM','Delivery claim generation is stale');
  if(row.state!=='ACKNOWLEDGED' && (row.state!=='DELIVERING'||!row.unexpired))
    fail('EVENT_STALE_CLAIM','Delivery claim has expired or is no longer current');
  return {scope:s,event_id:id,consumer_id:consumer,attempt_count:attempt,row};
}
export async function acknowledge(tx:PrimaryTransaction,input:unknown):Promise<unknown> {
  const v=fields(input,[...scopeKeys,'event_id','consumer_id','attempt_count','inbox_id']);
  const {inbox_id,...claim}=v,c=await currentClaim(tx,claim),receipt=uuid(inbox_id);
  const found=await tx.query(`SELECT i.id,e.* FROM hyperfide.command_inbox i JOIN hyperfide.outbox_events e
    ON(e.organisation_id=i.organisation_id AND e.run_id=i.run_id AND e.id::text=i.idempotency_key)
    WHERE i.organisation_id=$1 AND i.run_id=$2 AND i.id=$3 AND i.principal_scope=$4 AND i.operation='event.receive'
      AND i.idempotency_key=$5 AND i.state='COMPLETED'`,
    [c.scope.organisation_id,c.scope.run_id,receipt,c.consumer_id,c.event_id]);
  if(found.rowCount!==1) fail('EVENT_RECEIPT_REQUIRED','Acknowledgement requires a durable matching inbox receipt');
  const e=found.rows[0]!;
  const valid=await tx.query('SELECT 1 FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND request_digest=$4',
    [c.scope.organisation_id,c.scope.run_id,receipt,eventDigest(event({organisation_id:e.organisation_id,run_id:e.run_id,id:c.event_id,
      aggregate_type:e.aggregate_type,aggregate_id:e.aggregate_id,aggregate_version:e.aggregate_version,event_type:e.event_type,payload:e.payload}))]);
  if(valid.rowCount!==1) fail('EVENT_RECEIPT_REQUIRED','Receipt does not bind the exact event');
  if(c.row.state==='ACKNOWLEDGED') return {acknowledged:true,replayed:true,event_id:c.event_id};
  await tx.query("UPDATE hyperfide.event_deliveries SET state='ACKNOWLEDGED',acknowledged_at=clock_timestamp(),state_version=state_version+1,last_error=NULL WHERE organisation_id=$1 AND run_id=$2 AND event_id=$3 AND consumer_id=$4",
    [c.scope.organisation_id,c.scope.run_id,c.event_id,c.consumer_id]);
  return {acknowledged:true,replayed:false,event_id:c.event_id};
}
export async function retry(tx:PrimaryTransaction,input:unknown):Promise<unknown> {
  const v=fields(input,[...scopeKeys,'event_id','consumer_id','attempt_count','delay_ms','error']);
  const {delay_ms,error,...claim}=v,delay=bounded(delay_ms,0,3600000);
  if(typeof error!=='string'||!error.length||error.length>512||/[\u0000-\u001f]/.test(error))
    fail('EVENT_INPUT_INVALID','A bounded diagnostic code is required');
  const c=await currentClaim(tx,claim);
  if(c.row.state==='ACKNOWLEDGED') fail('EVENT_ALREADY_ACKNOWLEDGED','Acknowledged work cannot return to pending');
  await tx.query("UPDATE hyperfide.event_deliveries SET state='PENDING',next_attempt_at=clock_timestamp()+($5::int*interval '1 millisecond'),last_error=$6,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND event_id=$3 AND consumer_id=$4",
    [c.scope.organisation_id,c.scope.run_id,c.event_id,c.consumer_id,delay,error]);
  return {pending:true,event_id:c.event_id};
}
export function createComponent(context:ComponentContext):Component {
  const g=gateway(context);
  const component={apiVersion:1 as const,capabilities:{'events.outbox.v1':Object.freeze({enqueue,lockRun,registerConsumer,claimPending,acknowledge,retry})},actions:{
    'outbox.describe':()=>({schema_version:1,delivery:'at-least-once',ordering:'per-aggregate-version',global_cursor:false,
      acknowledgement:'durable-matching-inbox',full_case_status:'INCOMPLETE'}),
    'outbox.consumer.register':(input:unknown)=>run(g,tx=>registerConsumer(tx,input)),
    'outbox.enqueue':(input:unknown)=>run(g,tx=>enqueue(tx,input)),
    'outbox.claim':(input:unknown)=>run(g,tx=>claimPending(tx,input)),
    'outbox.acknowledge':(input:unknown)=>run(g,tx=>acknowledge(tx,input)),
    'outbox.retry':(input:unknown)=>run(g,tx=>retry(tx,input))
  }};
  return component;
}

export interface EventOutboxCapability {
  enqueue:typeof enqueue; lockRun:typeof lockRun; registerConsumer:typeof registerConsumer;
  claimPending:typeof claimPending; acknowledge:typeof acknowledge; retry:typeof retry;
}
export function isEventOutboxCapability(value:unknown):value is EventOutboxCapability {
  return object(value)&&['enqueue','lockRun','registerConsumer','claimPending','acknowledge','retry'].every(key=>typeof value[key]==='function');
}
