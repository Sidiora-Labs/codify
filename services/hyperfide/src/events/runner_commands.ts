import type {ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import type {InvocationContext} from '../transport/protocol.js';
import {FoundationError} from '../policy/programme.js';
import {fields,scope,uuid,integer,bounded,event,eventDigest,digest,fail,gateway,requireInvocation,acknowledge,currentClaim} from './outbox.js';
import {resolveRunnerConsumer,acceptInstruction,handoff} from './instructions.js';

const KINDS=new Set(['START','STEER','CANCEL']);
function exactTarget(row:Record<string,any>,invocation:InvocationContext):void {
 const p=invocation.principal,v=row.payload;
 if(!v||typeof v!=='object'||Array.isArray(v)||row.aggregate_type!=='attempt.instructions'||
   !KINDS.has(v.kind)||row.event_type!=='instruction.'+String(v.kind).toLowerCase()||
   row.id!==v.instruction_id||row.aggregate_id!==v.attempt_id||
   v.sandbox_id!==p.sandbox_id||v.boot_id!==p.boot_id||v.sandbox_boot_generation!==p.boot_generation)
  fail('AUTH_SCOPE_DENIED','Command does not target this genuine RUNNER boot');
}
function observationMatches(value:unknown,row:Record<string,any>,invocation:InvocationContext):boolean {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>,p=row.payload,actor=invocation.principal;
 return v.organisation_id===actor.organisation_id&&v.run_id===actor.run_id&&v.command_id===row.id&&
  v.operation_id===row.id&&v.attempt_id===p.attempt_id&&v.attempt_generation===p.attempt_generation&&
  v.authority_epoch===p.authority_epoch&&v.sandbox_id===actor.sandbox_id&&v.boot_id===actor.boot_id&&
  v.sandbox_boot_generation===actor.boot_generation&&v.sequence===row.aggregate_version&&v.payload_digest===digest(p.body)&&
  ['ACCEPTED','EXECUTING','TERMINAL','UNCERTAIN'].includes(String(v.state))&&
  typeof v.ledger_receipt_id==='string'&&typeof v.ledger_version==='string';
}
// A scoped native acknowledgement is an observation of a durable native ledger,
// never process success or task qualification. Existing 6.3 ACK validates the
// full immutable tuple before creating this record.
async function nativeObservation(tx:PrimaryTransaction,row:Record<string,any>,invocation:InvocationContext):Promise<boolean> {
 const p=invocation.principal;
 const found=await tx.query(`SELECT request_digest,result FROM hyperfide.command_inbox
  WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3
   AND operation='instruction.runner-state' AND idempotency_key=$4 AND state='COMPLETED'`,
  [p.organisation_id,p.run_id,'runner:'+p.sandbox_id+':'+p.boot_id,row.id]);
 if(found.rows.length!==1)return false;
 const e=event({organisation_id:row.organisation_id,run_id:row.run_id,id:row.id,aggregate_type:row.aggregate_type,
  aggregate_id:row.aggregate_id,aggregate_version:row.aggregate_version,event_type:row.event_type,payload:row.payload});
 return found.rows[0]!.request_digest===eventDigest(e)&&observationMatches(found.rows[0]!.result,row,invocation);
}
export async function pollRunnerCommands(context:ComponentContext,input:unknown):Promise<unknown> {
 const v=fields(input,['organisation_id','run_id','limit','lease_ms']),s=scope(v),
  limit=bounded(v.limit,1,16),lease=bounded(v.lease_ms,1000,30000);
 const invocation=requireInvocation(context,input,['RUNNER']),p=invocation.principal;
 if(!p.sandbox_id||!p.boot_id||!p.boot_generation)
  fail('AUTH_SCOPE_DENIED','A genuine current sandbox boot is required for native polling');
 const g=gateway(context);
 const {binding,rows}=await g.withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:invocation.signal,
  guard:tx=>invocation.identityGuard(tx)},async tx=>{
  const binding=await resolveRunnerConsumer(tx,{...s,sandbox_id:uuid(p.sandbox_id),boot_id:uuid(p.boot_id),
   boot_generation:integer(p.boot_generation)});
  if(!binding||binding.consumer_state!=='ACTIVE')
   fail('INSTRUCTION_CONSUMER_REQUIRED','The authenticated boot has no active immutable consumer');
  // Fresh ordered receives precede already-spooled pending commands. In
  // particular, a prior accepted START awaiting native ACK cannot starve CANCEL.
  const claimed=await tx.query(`WITH candidates AS (
   SELECT d.organisation_id,d.run_id,d.event_id,d.consumer_id
   FROM hyperfide.event_deliveries d JOIN hyperfide.outbox_events e
    ON(e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id)
   WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.consumer_id=$3
    AND d.state IN ('PENDING','DELIVERING') AND d.next_attempt_at<=clock_timestamp()
    AND e.aggregate_type='attempt.instructions' AND e.payload->>'sandbox_id'=$4
    AND e.payload->>'boot_id'=$5 AND e.payload->>'sandbox_boot_generation'=$6
   ORDER BY EXISTS(SELECT 1 FROM hyperfide.command_inbox i WHERE i.organisation_id=e.organisation_id
    AND i.run_id=e.run_id AND i.principal_scope=$3::text AND i.operation='event.receive'
    AND i.idempotency_key=e.id::text AND i.state='COMPLETED'),
    e.aggregate_id,e.aggregate_version,e.id
   FOR UPDATE OF d SKIP LOCKED LIMIT $7
  ), claimed AS (
   UPDATE hyperfide.event_deliveries d SET state='DELIVERING',attempt_count=d.attempt_count+1,
    state_version=d.state_version+1,next_attempt_at=clock_timestamp()+($8::int*interval '1 millisecond')
   FROM candidates c WHERE(d.organisation_id,d.run_id,d.event_id,d.consumer_id)=
    (c.organisation_id,c.run_id,c.event_id,c.consumer_id) RETURNING d.*
  ) SELECT e.*,d.attempt_count,d.next_attempt_at AS lease_expires_at FROM claimed d
   JOIN hyperfide.outbox_events e ON(e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id)
   ORDER BY e.aggregate_id,e.aggregate_version,e.id`,
   [s.organisation_id,s.run_id,binding.consumer_id,p.sandbox_id,p.boot_id,p.boot_generation,limit,lease]);
  return {binding,rows:claimed.rows};
 });
 const commands:unknown[]=[],observations:unknown[]=[];
 for(const row of rows){
  try{
   const outcome=await g.withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:invocation.signal,
    guard:tx=>invocation.identityGuard(tx)},async tx=>{
    const currentBinding=await resolveRunnerConsumer(tx,{...s,sandbox_id:uuid(p.sandbox_id),boot_id:uuid(p.boot_id),
     boot_generation:integer(p.boot_generation)});
    if(!currentBinding||currentBinding.consumer_id!==binding.consumer_id||currentBinding.consumer_state!=='ACTIVE')
     fail('INSTRUCTION_CONSUMER_REQUIRED','The immutable boot consumer is no longer active');
    const current=await currentClaim(tx,{...s,event_id:uuid(row.id),consumer_id:binding.consumer_id,
     attempt_count:integer(row.attempt_count)});
    if(current.row.state==='ACKNOWLEDGED')
     return {observation:{event_id:row.id,status:'ALREADY_ACKNOWLEDGED',delivery_acknowledged:true}};
    let delivery:unknown,observation:unknown;
    exactTarget(row,invocation);
    const command={...s,event_id:uuid(row.id),consumer_id:binding.consumer_id};
    const cancelled=await tx.query(`SELECT id FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2
     AND aggregate_type='attempt.instructions' AND aggregate_id=$3 AND event_type='instruction.cancel'
     AND payload->>'sandbox_id'=$4 AND payload->>'boot_id'=$5
     AND payload->>'sandbox_boot_generation'=$6 LIMIT 1`,
     [s.organisation_id,s.run_id,row.aggregate_id,p.sandbox_id,p.boot_id,p.boot_generation]);
    const cleanup=row.payload.kind==='CANCEL'||cancelled.rows.length>0;
    const nativeBefore=await nativeObservation(tx,row,invocation);
    if(!cleanup&&!nativeBefore)await invocation.guard(tx);
    const receipt=await acceptInstruction(tx,command) as Record<string,any>;
    if(!['APPLIED','DUPLICATE'].includes(receipt.status)||!receipt.inbox_id){
     observation={event_id:row.id,status:receipt.status,delivery_acknowledged:false};
    }else{
     const claim={...command,attempt_count:integer(row.attempt_count),inbox_id:uuid(receipt.inbox_id)};
     const result=receipt.result as Record<string,unknown>|undefined;
     const suppressed=cancelled.rows.length>0&&result?.accepted===false&&
      result.disposition==='SUPPRESSED_BY_CANCELLATION'&&result.command_id===row.id;
     const native=nativeBefore;
     if(suppressed||native){
      await acknowledge(tx,claim);
      observation={event_id:row.id,status:suppressed?'SERVER_SUPPRESSED':'NATIVE_LEDGER_OBSERVED',
       delivery_acknowledged:true,native_delivery_observed:native,execution_authority:false};
     }else{
      const packet=await handoff(tx,command,p) as Record<string,unknown>;
      if(packet.accepted===true)delivery={...claim,packet};
      else observation={event_id:row.id,status:'PRIOR_ADMISSION_RETAINS_NATIVE_UNCERTAINTY',
       delivery_acknowledged:false,native_delivery_observed:false};
     }
    }
    if(!cleanup&&!nativeBefore)await invocation.guard(tx);else await invocation.identityGuard(tx);
    return {delivery,observation};
   });
   if(outcome.delivery)commands.push(outcome.delivery);
   if(outcome.observation)observations.push(outcome.observation);
  }catch(error){
   if(!(error instanceof FoundationError))throw error;
   observations.push({event_id:row.id,status:'BLOCKED',code:error.code,delivery_acknowledged:false});
  }
 }
 return {schema_version:1,...s,consumer_id:binding.consumer_id,sandbox_id:p.sandbox_id,boot_id:p.boot_id,
  boot_generation:p.boot_generation,commands,observations,execution_authority:false,task_qualified:false};
}
