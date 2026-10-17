import {validateExecutionInputs} from '../hierarchy/packets.js';
import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {enqueue,lockRun,claimPending,acknowledge} from '../events/outbox.js';
import {actorFor,decimal,dispatchRecipients,fail,fields,gatewayFor,invocationFor,object,requestDigest,
  requireSchedulerAuthority,uuid} from './claim.js';
import {receive} from '../events/inbox.js';
import type {ComputeToken,SchedulerScope} from './claim.js';
import {assertCurrentCompute,parseComputeToken} from './leases.js';

export interface NativeDispatchObservation {
  central_receipt_id:string;command_id:string;token:ComputeToken;
  state:'ACCEPTED'|'EXECUTING'|'TERMINAL'|'UNCERTAIN';
  terminal_kind?:'ABSENT'|'STOPPED'|'SUCCEEDED'|'FAILED';
  native_session_id?:string;payload_digest:string;
}
export type NativeReceiptReader=(tx:PrimaryTransaction,
  input:SchedulerScope&{operation_id:string;token:ComputeToken;payload_digest:string})=>Promise<NativeDispatchObservation|null>;
interface DispatchRow {
 id:string;request_id:string;task_id:string;attempt_id:string;attempt_generation:string;authority_epoch:string;
 sandbox_id:string;slot_id:string;sandbox_boot_generation:string;payload_digest:string;state:string;event_id:string;
}
function rowToken(scope:SchedulerScope,row:DispatchRow):ComputeToken{
 return {...scope,task_id:row.task_id,attempt_id:row.attempt_id,attempt_generation:row.attempt_generation,
  authority_epoch:row.authority_epoch,sandbox_id:row.sandbox_id,slot_id:row.slot_id,sandbox_boot_generation:row.sandbox_boot_generation};
}
function sameToken(a:ComputeToken,b:ComputeToken):boolean{
 return ['organisation_id','run_id','task_id','attempt_id','attempt_generation','authority_epoch','sandbox_id','slot_id',
  'sandbox_boot_generation'].every(key=>a[key as keyof ComputeToken]===b[key as keyof ComputeToken]);
}
export class DispatchReconciler {
 private reader:NativeReceiptReader|undefined;
 registerReceiptReader(reader:NativeReceiptReader):()=>void{
  if(typeof reader!=='function'||this.reader)fail('INVALID_RECEIPT_READER','Exactly one trusted native receipt reader may be installed');
  this.reader=reader;return ()=>{if(this.reader===reader)this.reader=undefined;};
 }
 close():void{this.reader=undefined;}
 async reconcile(tx:PrimaryTransaction,scope:SchedulerScope,request_id:string):Promise<unknown>{
  assertPrimaryTransaction(tx);await lockRun(tx,scope);
  const found=await tx.query<DispatchRow>('SELECT * FROM hyperfide.scheduler_dispatches WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',
   [scope.organisation_id,scope.run_id,request_id]);
  const row=found.rows[0];if(!row)fail('DISPATCH_MISSING','Dispatch intent does not exist');
  if(['STOPPED','ABSENT','COMPLETED','FAILED'].includes(row.state))return {operation_id:row.id,state:row.state,replayed:true,replacement_allowed:false,resource_release_confirmed:false};
  if(!this.reader)fail('DEPENDENCY_UNAVAILABLE','Trusted central native receipt reconciliation is required');
  const token=rowToken(scope,row);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.organisation_id+':'+scope.run_id+':dispatch:'+row.attempt_id]);
  await tx.query('SELECT id FROM hyperfide.scheduler_dispatches WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,row.id]);
  // Reader performs primary SQL verification of persisted signed native receipts;
  // it must never call a provider or wait for an external process while locks are held.
  const observation=await this.reader(tx,{...scope,operation_id:row.id,token,payload_digest:row.payload_digest});
  if(!observation||observation.state==='UNCERTAIN'||observation.state==='ACCEPTED'){
   await tx.query('UPDATE hyperfide.scheduler_dispatches SET state=\'UNKNOWN\',observed_at=clock_timestamp(),state_version=state_version+1 '+
    'WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,row.id]);
   return {operation_id:row.id,state:'UNKNOWN',reconciliation_required:true,replacement_allowed:false};
  }
  if(observation.command_id!==row.id||observation.payload_digest!==row.payload_digest||!sameToken(observation.token,token))
   fail('NATIVE_RECEIPT_MISMATCH','Native observation is bound to a different operation or authority tuple');
  const receipt=uuid(observation.central_receipt_id,'central native receipt');
  const admitted=await tx.query<{state:string}>('SELECT state FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
   [scope.organisation_id,scope.run_id,receipt]);
  if(admitted.rows[0]?.state!=='COMPLETED')fail('NATIVE_RECEIPT_UNADMITTED','Native receipt has not been durably admitted by the central inbox');
  let state:string,authoritative=false;
  if(observation.state==='EXECUTING'){
   state='RUNNING';
   try{await assertCurrentCompute(tx,token);authoritative=true;}
   catch(error){
    const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
    if(!['STALE_AUTHORITY_EPOCH','STALE_SANDBOX_BOOT','STALE_COMPUTE','COMPUTE_LEASE_EXPIRED','ACTIVE_SUBMISSION_CUSTODY','EXECUTION_HELD','RUN_NOT_EXECUTING','STALE_TASK_SPEC','STALE_PREPARATION','COMPUTE_ALLOCATION_INVALID','COMPUTE_SANDBOX_BUDGET_INVALID','SANDBOX_NOT_ADMITTING'].includes(code))throw error;
   }
  }else{
   if(!observation.terminal_kind)fail('NATIVE_RECEIPT_INCOMPLETE','A terminal observation must identify the observed terminal condition');
   state=observation.terminal_kind==='ABSENT'?'ABSENT':observation.terminal_kind==='STOPPED'?'STOPPED':observation.terminal_kind==='SUCCEEDED'?'COMPLETED':'FAILED';
  }
  await tx.query('UPDATE hyperfide.scheduler_dispatches SET state=$4,observation_receipt_id=$5,native_session_id=$6,'+
   'observed_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
   [scope.organisation_id,scope.run_id,row.id,state,receipt,observation.native_session_id??null]);
  if(authoritative){
   await tx.query('UPDATE hyperfide.attempts SET execution_state=\'RUNNING\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
    [scope.organisation_id,scope.run_id,row.attempt_id]);
   await tx.query('UPDATE hyperfide.tasks SET state=\'RUNNING\',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
    [scope.organisation_id,scope.run_id,row.task_id]);
  }
  return {operation_id:row.id,state,authoritative,reconciliation_required:state==='RUNNING'&&!authoritative,
   replacement_allowed:false,resource_release_confirmed:false};
 }
}
export async function ensureDispatch(tx:PrimaryTransaction,token:ComputeToken,request:string,recipients:{consumer_ids:string[]}):Promise<unknown>{
 assertPrimaryTransaction(tx);const scope={organisation_id:token.organisation_id,run_id:token.run_id};
    await lockRun(tx,scope);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.organisation_id+':'+scope.run_id+':dispatch:'+token.attempt_id]);
    const old=await tx.query<DispatchRow>('SELECT * FROM hyperfide.scheduler_dispatches WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 FOR UPDATE',
     [scope.organisation_id,scope.run_id,request]);
    if(old.rows[0]){
     if(!sameToken(rowToken(scope,old.rows[0]),token))fail('IDEMPOTENCY_CONFLICT','Dispatch request is already bound to a different compute token');
     return {operation_id:old.rows[0].id,state:old.rows[0].state,replayed:true,replacement_allowed:false};
    }
    const authority=await assertCurrentCompute(tx,token);
    const existing=await tx.query('SELECT id,state FROM hyperfide.scheduler_dispatches WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND attempt_generation=$4 '+
     'FOR UPDATE',
     [scope.organisation_id,scope.run_id,token.attempt_id,token.attempt_generation]);
    if(existing.rows.length)fail('REPLACEMENT_REQUIRES_NEW_ATTEMPT','An attempt has one physical dispatch identity; replacement requires an explicitly admitted new attempt');
    // A superseded generation's create/spawn outcome is unknown until it enters reconciliation
    // (UNKNOWN, RUNNING or terminal). Duplicate physical execution may follow, but never unobserved.
    const unreconciled=await tx.query('SELECT id FROM hyperfide.scheduler_dispatches WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 '+
     'AND attempt_generation<$4 AND state=\'INTENT\' ORDER BY id FOR UPDATE',
     [scope.organisation_id,scope.run_id,token.task_id,token.attempt_generation]);
    if(unreconciled.rows.length)fail('RECONCILIATION_REQUIRED','A superseded dispatch outcome must enter reconciliation before a compatible replacement is dispatched');
    const packets=await tx.query<{digest:string}>('SELECT digest FROM hyperfide.hierarchy_execution_packets WHERE organisation_id=$1 AND run_id=$2 '+
     'AND task_id=$3 AND attempt_id=$4 AND attempt_generation=$5 AND digest=$6',
     [scope.organisation_id,scope.run_id,token.task_id,token.attempt_id,token.attempt_generation,authority.input_packet_digest]);
    if(packets.rows.length!==1)fail('EXECUTION_PACKET_MISSING','Dispatch requires the exact admitted immutable execution packet');
    await validateExecutionInputs(tx,{...scope,digest:authority.input_packet_digest});
    const operation=randomUUID(),event=randomUUID(),payload={command_id:operation,token,packet_digest:authority.input_packet_digest};
    const payload_digest=requestDigest(payload);
    await enqueue(tx,{...scope,id:event,aggregate_type:'scheduler-spawn',aggregate_id:operation,aggregate_version:'1',
     event_type:'runner.spawn.requested',payload:{...payload,payload_digest}},recipients);
    await tx.query('INSERT INTO hyperfide.scheduler_dispatches(organisation_id,run_id,id,request_id,task_id,attempt_id,attempt_generation,authority_epoch,'+
     'sandbox_id,slot_id,sandbox_boot_generation,payload_digest,event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
     [scope.organisation_id,scope.run_id,operation,request,token.task_id,token.attempt_id,token.attempt_generation,token.authority_epoch,
      token.sandbox_id,token.slot_id,token.sandbox_boot_generation,payload_digest,event]);
    return {operation_id:operation,state:'INTENT',replayed:false,replacement_allowed:false,execution_confirmed:false};
}
export async function consumeDispatchEvent(tx:PrimaryTransaction,input:SchedulerScope&{event_id:string;consumer_id:string;native_recipients:{consumer_ids:string[]}}):Promise<Awaited<ReturnType<typeof receive>>>{
 return receive(tx,{organisation_id:input.organisation_id,run_id:input.run_id,event_id:input.event_id,consumer_id:input.consumer_id},async(tx,event)=>{
  if(event.event_type!=='scheduler.dispatch.requested'||event.aggregate_type!=='scheduler-claim'||event.aggregate_version!=='1')fail('DISPATCH_EVENT_INVALID','This consumer accepts committed scheduler claims only');
  const payload=fields(event.payload,['token','request_id','input_packet_digest']),token=parseComputeToken(payload.token),request=uuid(payload.request_id,'claim request');
  if(event.aggregate_id!==request||token.organisation_id!==input.organisation_id||token.run_id!==input.run_id)fail('DISPATCH_EVENT_INVALID','Committed claim event has inconsistent authority scope');
  const admission=await tx.query<{result:unknown}>("SELECT result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND operation='scheduler.claim' AND idempotency_key=$3 AND state='COMPLETED'",[input.organisation_id,input.run_id,request]);
  if(admission.rows.length!==1||requestDigest(object(admission.rows[0]!.result).token)!==requestDigest(token))fail('DISPATCH_ADMISSION_MISSING','Event has no exact committed scheduler claim receipt');
  const target=await tx.query<{compute_authority:string;input_packet_digest:string}>('SELECT compute_authority,input_packet_digest FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND generation=$4',[input.organisation_id,input.run_id,token.attempt_id,token.attempt_generation]);
  if(target.rows[0]?.input_packet_digest!==payload.input_packet_digest)fail('DISPATCH_EVENT_INVALID','Claim packet differs from immutable admitted attempt');
  if(target.rows[0]!.compute_authority!=='CURRENT')return {effect:'OBSOLETE_COMPUTE_SUPPRESSED',attempt_id:token.attempt_id,execution_granted:false};
  await assertCurrentCompute(tx,token);
  const existing=await tx.query<{request_id:string}>('SELECT request_id FROM hyperfide.scheduler_dispatches WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND attempt_generation=$4',[input.organisation_id,input.run_id,token.attempt_id,token.attempt_generation]);
  return {effect:'DURABLE_DISPATCH_INTENT',dispatch:await ensureDispatch(tx,token,existing.rows[0]?.request_id??request,input.native_recipients),execution_granted:false};
 });
}
export function createComponent(startup:ComponentContext):Component{
 const reconciler=new DispatchReconciler();
 const receipts=startup.dependencies.require('6.3','events.instructions.v1',
  (value:unknown):value is {readDispatchReceipt:NativeReceiptReader}=>
   typeof value==='object'&&value!==null&&'readDispatchReceipt' in value&&typeof value.readDispatchReceipt==='function');
 reconciler.registerReceiptReader(receipts.readDispatchReceipt);
 return {apiVersion:1,capabilities:{'scheduler.dispatch.v1':Object.freeze({
  registerReceiptReader:reconciler.registerReceiptReader.bind(reconciler),reconcile:reconciler.reconcile.bind(reconciler),ensureDispatch,consumeDispatchEvent})},
  close:()=>reconciler.close(),actions:{
  'scheduler.dispatch.consume':async(value,context)=>{
   const input=fields(value,[],['limit']),invocation=invocationFor(context);
   if(!['COORDINATOR','DISPATCH'].includes(invocation.principal.role))fail('ROLE_DENIED','Claim-event processing requires a registered controller service identity');
   const scope={organisation_id:invocation.principal.organisation_id,run_id:invocation.principal.run_id};
   if(context.policy.programme_id!==scope.run_id)fail('RUN_SCOPE_DENIED','Controller must match the activated run');
   const consumer=uuid(context.env.HF_SCHEDULER_DISPATCH_CONSUMER_ID,'trusted scheduler consumer');
   const limit=input.limit===undefined?1:Number(input.limit);
   if(!Number.isSafeInteger(limit)||limit<1||limit>64)fail('INVALID_REQUEST','A bounded delivery page is required');
   return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},async tx=>{
    const deliveries=await claimPending(tx,{...scope,consumer_id:consumer,limit,lease_ms:30000}),results:unknown[]=[];
    for(const delivery of deliveries){
     const result=await consumeDispatchEvent(tx,{...scope,event_id:delivery.id,consumer_id:consumer,native_recipients:dispatchRecipients(context,'native')});
     if(result.inbox_id)await acknowledge(tx,{...scope,event_id:delivery.id,consumer_id:consumer,attempt_count:delivery.attempt_count,inbox_id:result.inbox_id});
     results.push(result);
    }
    return {consumer_id:consumer,processed:results.length,results};
   });
  },
  'scheduler.dispatch.ensure':async(value,context)=>{
   const input=fields(value,['token','request_id','leader_generation'],['package_generation']);
   const token=parseComputeToken(input.token),scope={organisation_id:token.organisation_id,run_id:token.run_id};
   const actor=actorFor(context,scope,{...input,authority_epoch:token.authority_epoch}),request=uuid(input.request_id,'request_id');
   return gatewayFor(context,async tx=>{
    const previous=await tx.query<DispatchRow>('SELECT * FROM hyperfide.scheduler_dispatches WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[scope.organisation_id,scope.run_id,request]);
    if(previous.rows[0]&&!sameToken(rowToken(scope,previous.rows[0]),token))fail('IDEMPOTENCY_CONFLICT','Dispatch request is already bound to a different immutable compute tuple');
    await assertCurrentCompute(tx,token,{operation:'ADVANCE'});
   }).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},async tx=>{
    await lockRun(tx,scope);
    const task=await tx.query<{feature_package_id:string}>('SELECT feature_package_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
     [scope.organisation_id,scope.run_id,token.task_id]);
    if(!task.rows[0])fail('TASK_MISSING','Dispatch task is absent');
    await requireSchedulerAuthority(tx,scope,actor,token.authority_epoch,task.rows[0].feature_package_id);
    return ensureDispatch(tx,token,request,dispatchRecipients(context,'native'));
   });
  },
  'scheduler.dispatch.reconcile':async(value,context)=>{
   const input=fields(value,['organisation_id','run_id','request_id','authority_epoch','leader_generation'],['package_generation','package_id']);
   const scope={organisation_id:uuid(input.organisation_id,'organisation_id'),run_id:uuid(input.run_id,'run_id')};
   const actor=actorFor(context,scope,input);
   return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},async tx=>{
    await lockRun(tx,scope);
    const request=uuid(input.request_id,'request_id');
    const target=await tx.query<{feature_package_id:string}>('SELECT t.feature_package_id FROM hyperfide.scheduler_dispatches d JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.run_id AND t.id=d.task_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.request_id=$3 FOR SHARE OF t',[scope.organisation_id,scope.run_id,request]);
    if(!target.rows[0])fail('DISPATCH_MISSING','Dispatch intent does not exist in this run');
    if(input.package_id!==undefined&&uuid(input.package_id,'package_id')!==target.rows[0].feature_package_id)
     fail('PACKAGE_SCOPE_DENIED','Requested package does not own this dispatch task');
    await requireSchedulerAuthority(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),target.rows[0].feature_package_id);
    return reconciler.reconcile(tx,scope,request);
   });
  }
 }};
}
