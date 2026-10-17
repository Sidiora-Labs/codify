import {startContinuousDispatch} from './dispatcher.js';
import type { Component, ComponentContext } from '../components/registry.js';
import type { PrimaryTransaction, TransactionGateway } from '../storage/transactions.js';
import { assertPrimaryTransaction } from '../storage/transactions.js';
import { fields, scope, uuid, bounded, fail, gateway, run, authorizedRun, requireInvocation, claimPending, acknowledge, retry } from './outbox.js';
import type { Scope, DeliveryClaim } from './outbox.js';

export async function inspectPending(tx:PrimaryTransaction,input:unknown):Promise<unknown> {
  assertPrimaryTransaction(tx);
  const v=fields(input,['organisation_id','run_id','consumer_id']),s=scope(v),consumer=uuid(v.consumer_id);
  const r=await tx.query(`SELECT d.state,count(*)::text AS count,
    count(*) FILTER(WHERE d.state IN ('PENDING','DELIVERING') AND d.next_attempt_at<=clock_timestamp())::text AS discoverable,
    min(d.next_attempt_at) AS next_attempt_at
    FROM hyperfide.event_deliveries d WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.consumer_id=$3 GROUP BY d.state ORDER BY d.state`,
    [s.organisation_id,s.run_id,consumer]);
  return {consumer_id:consumer,queues:r.rows.map(row=>({...row,next_attempt_at:row.next_attempt_at instanceof Date?row.next_attempt_at.toISOString():null})),
    source:'primary-durable-obligations',notifications_required:false};
}
// Metadata only: callers join this to their own primary reconstruction transaction.
export async function recoverySnapshot(tx:PrimaryTransaction,input:unknown):Promise<unknown> {
  assertPrimaryTransaction(tx);
  const v=fields(input,['organisation_id','run_id','limit']),s=scope(v),limit=bounded(v.limit,1,256);
  const deliveries=await tx.query(`SELECT d.event_id,d.consumer_id,d.state,d.attempt_count,d.next_attempt_at,d.state_version,
    e.aggregate_type,e.aggregate_id,e.aggregate_version,e.event_type
    FROM hyperfide.event_deliveries d JOIN hyperfide.outbox_events e
      ON(e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id)
    WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.state<>'ACKNOWLEDGED'
    ORDER BY d.next_attempt_at,d.event_id,d.consumer_id LIMIT $3`,[s.organisation_id,s.run_id,limit+1]);
  const cursors=await tx.query(`SELECT id,principal_scope,operation,idempotency_key,state,request_digest,state_version,
      CASE WHEN operation='event.aggregate' THEN jsonb_build_object(
        'version',left(result->>'version',19),
        'terminal',CASE WHEN jsonb_typeof(result->'terminal')='boolean' THEN result->'terminal' ELSE NULL END,
        'last_event_id',left(result->>'last_event_id',36))
      WHEN operation='instruction.spool' THEN jsonb_build_object(
        'command_id',left(result->>'command_id',36),'kind',left(result->>'kind',6),
        'accepted',CASE WHEN jsonb_typeof(result->'accepted')='boolean' THEN result->'accepted' ELSE NULL END,
        'disposition',left(result->>'disposition',32),'target_generation',left(result->>'target_generation',19))
      ELSE jsonb_build_object('ledger_receipt_id',left(result->>'ledger_receipt_id',36),
        'ledger_version',left(result->>'ledger_version',19),'state',left(result->>'state',9),
        'credential_id',left(result->>'credential_id',36)) END AS metadata
    FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2
      AND operation IN('event.aggregate','instruction.spool','instruction.runner-state')
    ORDER BY operation,principal_scope,idempotency_key LIMIT $3`,[s.organisation_id,s.run_id,limit+1]);
  const nativeConsumers=await tx.query(`SELECT b.consumer_id,b.sandbox_id,b.boot_id,b.boot_generation,b.bootstrap_receipt_id,
    c.state,c.state_version FROM hyperfide.event_runner_bindings b JOIN hyperfide.event_consumers c
      ON(c.organisation_id=b.organisation_id AND c.run_id=b.run_id AND c.id=b.consumer_id)
    WHERE b.organisation_id=$1 AND b.run_id=$2 ORDER BY b.sandbox_id,b.boot_generation LIMIT $3`,[s.organisation_id,s.run_id,limit+1]);
  const counts=await tx.query(`SELECT
    (SELECT count(*)::text FROM hyperfide.event_deliveries WHERE organisation_id=$1 AND run_id=$2 AND state<>'ACKNOWLEDGED') AS pending_deliveries,
    (SELECT count(*)::text FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2
      AND operation IN('event.aggregate','instruction.spool','instruction.runner-state')) AS cursor_and_instruction_records,
    (SELECT count(*)::text FROM hyperfide.event_runner_bindings WHERE organisation_id=$1 AND run_id=$2) AS runner_consumers`,[s.organisation_id,s.run_id]);
  return {source:'primary-transaction',scope:s,counts:counts.rows[0],
    runner_consumers:nativeConsumers.rows.slice(0,limit),
    pending_deliveries:deliveries.rows.slice(0,limit).map(row=>({...row,next_attempt_at:row.next_attempt_at instanceof Date?row.next_attempt_at.toISOString():null})),
    cursor_and_instruction_records:cursors.rows.slice(0,limit).map(row=>({...row,
      result_reference:{inbox_id:row.id,request_digest:row.request_digest,state_version:row.state_version},
      result_payload_included:false})),
    record_projection:'bounded-metadata-with-retained-inbox-reference',
    truncated:{pending_deliveries:deliveries.rows.length>limit,cursor_and_instruction_records:cursors.rows.length>limit,runner_consumers:nativeConsumers.rows.length>limit},
    task_completion_authority:false};
}
export interface DispatchConfig extends Scope { consumer_id:string; batch_size:number; lease_ms:number; poll_ms:number; retry_ms:number }
export type DeliveryAdapter=(claim:DeliveryClaim,signal:AbortSignal)=>Promise<{inbox_id:string}>;
export interface DispatchPass { claimed:number; acknowledged:number; pending:number }
export class DurableDispatcher {
  private closed=false;
  private active:Promise<DispatchPass>|undefined;
  private loop:Promise<void>|undefined;
  private wakeResolve:(()=>void)|undefined;
  private readonly controller=new AbortController();
  constructor(private readonly g:TransactionGateway,private readonly config:DispatchConfig,private readonly deliver:DeliveryAdapter,private readonly context:ComponentContext) {
    scope(config as unknown as Record<string,unknown>); uuid(config.consumer_id);
    bounded(config.batch_size,1,64);bounded(config.lease_ms,50,300000);
    bounded(config.poll_ms,10,60000);bounded(config.retry_ms,0,3600000);
    requireInvocation(context,config,['OPERATOR','COORDINATOR','DISPATCH']);
    this.config=Object.freeze({...config});
    if(typeof deliver!=='function') fail('DISPATCH_ADAPTER_REQUIRED','Dispatch needs a trusted durable receiver adapter');
  }
  // A notification only shortens the sleep. Every pass queries durable delivery state.
  wake():void { this.wakeResolve?.(); }
  start():void {
    if(this.closed) fail('DISPATCH_CLOSED','Dispatcher is closed');
    if(this.loop) return;
    this.loop=(async()=>{
      while(!this.closed) {
        try { await this.pass(); } catch { /* Durable rows remain discoverable after database or transport uncertainty. */ }
        if(this.closed) break;
        await new Promise<void>(resolve=>{
          let settled=false;
          const done=()=>{if(settled)return;settled=true;clearTimeout(timer);this.wakeResolve=undefined;resolve();};
          const timer=setTimeout(done,this.config.poll_ms);
          this.wakeResolve=done;
        });
      }
    })();
  }
  pass():Promise<DispatchPass> {
    if(this.closed) return Promise.reject(new Error('Dispatcher is closed'));
    return this.active??=(this.execute().finally(()=>{this.active=undefined;}));
  }
  private transaction<T>(operation:(tx:PrimaryTransaction)=>Promise<T>):Promise<T> {
    const invocation=requireInvocation(this.context,this.config,['OPERATOR','COORDINATOR','DISPATCH']);
    return this.g.withPrimaryTransaction({timeoutMs:10000,maxRetries:3,guard:tx=>invocation.guard(tx),
      signal:AbortSignal.any([invocation.signal,this.controller.signal])},operation);
  }
  private async execute():Promise<DispatchPass> {
    const c=this.config;
    const claims=await this.transaction(tx=>claimPending(tx,{organisation_id:c.organisation_id,run_id:c.run_id,
      consumer_id:c.consumer_id,limit:c.batch_size,lease_ms:c.lease_ms}));
    const result={claimed:claims.length,acknowledged:0,pending:0};
    for(const claim of claims) {
      if(this.closed) {result.pending++;continue;}
      const remaining=Date.parse(claim.lease_expires_at)-Date.now();
      if(remaining<=0) {result.pending++;continue;}
      const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(Math.max(1,remaining))]);
      try {
        // Adapter handles exact event identity and receiver inbox commit. Abort alone never proves an external send did not happen.
        const receipt=await new Promise<{inbox_id:string}>((resolve,reject)=>{
          let timer:ReturnType<typeof setTimeout>|undefined;
          const cleanup=()=>{if(timer)clearTimeout(timer);signal.removeEventListener('abort',aborted);};
          const aborted=()=>{cleanup();reject(new Error('Delivery acceptance deadline expired'));};
          timer=setTimeout(aborted,Math.max(1,remaining));
          if(signal.aborted) {aborted();return;}
          signal.addEventListener('abort',aborted,{once:true});
          void Promise.resolve().then(()=>this.deliver(claim,signal)).then(resolve,reject)
            .finally(cleanup);
        });
        uuid(receipt.inbox_id);
        await this.transaction(tx=>acknowledge(tx,{organisation_id:c.organisation_id,run_id:c.run_id,
          consumer_id:c.consumer_id,event_id:claim.id,attempt_count:claim.attempt_count,inbox_id:receipt.inbox_id}));
        result.acknowledged++;
      } catch {
        result.pending++;
        try {await this.transaction(tx=>retry(tx,{organisation_id:c.organisation_id,run_id:c.run_id,
          consumer_id:c.consumer_id,event_id:claim.id,attempt_count:claim.attempt_count,
          delay_ms:c.retry_ms,error:'DELIVERY_OUTCOME_UNCONFIRMED'}));}
        catch { /* Lost lease or ambiguous commit: never acknowledge, delete or invent a replacement identity. */ }
      }
    }
    return result;
  }
  async close():Promise<void> {
    if(this.closed) return;
    this.closed=true;this.controller.abort();this.wake();
    await Promise.allSettled([this.active,this.loop].filter((p):p is Promise<DispatchPass>|Promise<void>=>p!==undefined));
  }
}
export async function createComponent(context:ComponentContext):Promise<Component> {
  const g=gateway(context),worker=await startContinuousDispatch(context);
  const component={apiVersion:1 as const,capabilities:{'events.recovery.v1':Object.freeze({inspectPending,recoverySnapshot,DurableDispatcher})},actions:{
    'recovery.describe':()=>({schema_version:1,recovery:'bounded-primary-poll',notifications:'wakeups-only',worker:worker?.describe()??null,
      acknowledgement:'receiver-inbox-commit',external_adapter:'trusted-linked-code-required',full_case_status:'INCOMPLETE'}),
    'recovery.inspect':(input:unknown,context:ComponentContext)=>authorizedRun(g,context,input,['OPERATOR','COORDINATOR','DISPATCH'],tx=>inspectPending(tx,input)),
    'recovery.claim':(input:unknown,context:ComponentContext)=>authorizedRun(g,context,input,['OPERATOR','COORDINATOR','DISPATCH'],tx=>claimPending(tx,input))
  }};
  return {...component,close:async()=>{await worker?.close();}};
}
