import type { Component, ComponentContext } from '../components/registry.js';
import type { PrimaryTransaction, TransactionGateway } from '../storage/transactions.js';
import { assertPrimaryTransaction } from '../storage/transactions.js';
import { fields, scope, uuid, bounded, fail, gateway, run, claimPending, acknowledge, retry } from './outbox.js';
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
export interface DispatchConfig extends Scope { consumer_id:string; batch_size:number; lease_ms:number; poll_ms:number; retry_ms:number }
export type DeliveryAdapter=(claim:DeliveryClaim,signal:AbortSignal)=>Promise<{inbox_id:string}>;
export interface DispatchPass { claimed:number; acknowledged:number; pending:number }
export class DurableDispatcher {
  private closed=false;
  private active:Promise<DispatchPass>|undefined;
  private loop:Promise<void>|undefined;
  private wakeResolve:(()=>void)|undefined;
  private readonly controller=new AbortController();
  constructor(private readonly g:TransactionGateway,private readonly config:DispatchConfig,private readonly deliver:DeliveryAdapter) {
    scope(config as unknown as Record<string,unknown>); uuid(config.consumer_id);
    bounded(config.batch_size,1,64);bounded(config.lease_ms,50,300000);
    bounded(config.poll_ms,10,60000);bounded(config.retry_ms,0,3600000);
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
  private async execute():Promise<DispatchPass> {
    const c=this.config;
    const claims=await run(this.g,tx=>claimPending(tx,{organisation_id:c.organisation_id,run_id:c.run_id,
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
        await run(this.g,tx=>acknowledge(tx,{organisation_id:c.organisation_id,run_id:c.run_id,
          consumer_id:c.consumer_id,event_id:claim.id,attempt_count:claim.attempt_count,inbox_id:receipt.inbox_id}));
        result.acknowledged++;
      } catch {
        result.pending++;
        try {await run(this.g,tx=>retry(tx,{organisation_id:c.organisation_id,run_id:c.run_id,
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
export function createComponent(context:ComponentContext):Component {
  const g=gateway(context);
  const component={apiVersion:1 as const,capabilities:{'events.recovery.v1':Object.freeze({inspectPending,DurableDispatcher})},actions:{
    'recovery.describe':()=>({schema_version:1,recovery:'bounded-primary-poll',notifications:'wakeups-only',
      acknowledgement:'receiver-inbox-commit',external_adapter:'trusted-linked-code-required',full_case_status:'INCOMPLETE'}),
    'recovery.inspect':(input:unknown)=>run(g,tx=>inspectPending(tx,input)),
    'recovery.claim':(input:unknown)=>run(g,tx=>claimPending(tx,input))
  }};
  return component;
}
