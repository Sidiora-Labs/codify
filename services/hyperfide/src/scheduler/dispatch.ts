import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {enqueue,lockRun} from '../events/outbox.js';
import {actorFor,decimal,dispatchRecipients,fail,fields,gatewayFor,invocationFor,object,requestDigest,
  requireSchedulerAuthority,uuid} from './claim.js';
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
    if(!['STALE_AUTHORITY_EPOCH','STALE_SANDBOX_BOOT','STALE_COMPUTE','COMPUTE_LEASE_EXPIRED','ACTIVE_SUBMISSION_CUSTODY','EXECUTION_HELD','RUN_NOT_EXECUTING','STALE_TASK_SPEC','STALE_PREPARATION','COMPUTE_ALLOCATION_INVALID'].includes(code))throw error;
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
export function createComponent(_startup:ComponentContext):Component{
 const reconciler=new DispatchReconciler();
 return {apiVersion:1,capabilities:{'scheduler.dispatch.v1':Object.freeze({
  registerReceiptReader:reconciler.registerReceiptReader.bind(reconciler),reconcile:reconciler.reconcile.bind(reconciler)})},
  close:()=>reconciler.close(),actions:{
  'scheduler.dispatch.ensure':async(value,context)=>{
   const input=fields(value,['token','request_id','leader_generation'],['package_generation']);
   const token=parseComputeToken(input.token),scope={organisation_id:token.organisation_id,run_id:token.run_id};
   const actor=actorFor(context,scope,{...input,authority_epoch:token.authority_epoch}),request=uuid(input.request_id,'request_id');
   return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal,
    guard:tx=>invocationFor(context).guard(tx)},async tx=>{
    await lockRun(tx,scope);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.organisation_id+':'+scope.run_id+':dispatch:'+token.attempt_id]);
    const task=await tx.query<{feature_package_id:string}>('SELECT feature_package_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
     [scope.organisation_id,scope.run_id,token.task_id]);
    if(!task.rows[0])fail('TASK_MISSING','Dispatch task is absent');
    await requireSchedulerAuthority(tx,scope,actor,token.authority_epoch,task.rows[0].feature_package_id);
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
    const packets=await tx.query<{digest:string}>('SELECT digest FROM hyperfide.hierarchy_execution_packets WHERE organisation_id=$1 AND run_id=$2 '+
     'AND task_id=$3 AND attempt_id=$4 AND attempt_generation=$5 AND digest=$6',
     [scope.organisation_id,scope.run_id,token.task_id,token.attempt_id,token.attempt_generation,authority.input_packet_digest]);
    if(packets.rows.length!==1)fail('EXECUTION_PACKET_MISSING','Dispatch requires the exact admitted immutable execution packet');
    const operation=randomUUID(),event=randomUUID(),payload={command_id:operation,token,packet_digest:authority.input_packet_digest};
    const payload_digest=requestDigest(payload);
    await enqueue(tx,{...scope,id:event,aggregate_type:'scheduler-spawn',aggregate_id:operation,aggregate_version:'1',
     event_type:'runner.spawn.requested',payload:{...payload,payload_digest}},dispatchRecipients(context));
    await tx.query('INSERT INTO hyperfide.scheduler_dispatches(organisation_id,run_id,id,request_id,task_id,attempt_id,attempt_generation,authority_epoch,'+
     'sandbox_id,slot_id,sandbox_boot_generation,payload_digest,event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
     [scope.organisation_id,scope.run_id,operation,request,token.task_id,token.attempt_id,token.attempt_generation,token.authority_epoch,
      token.sandbox_id,token.slot_id,token.sandbox_boot_generation,payload_digest,event]);
    return {operation_id:operation,state:'INTENT',replayed:false,replacement_allowed:false,execution_confirmed:false};
   });
  },
  'scheduler.dispatch.reconcile':async(value,context)=>{
   const input=fields(value,['organisation_id','run_id','request_id','authority_epoch','leader_generation'],['package_generation','package_id']);
   const scope={organisation_id:uuid(input.organisation_id,'organisation_id'),run_id:uuid(input.run_id,'run_id')};
   const actor=actorFor(context,scope,input);
   return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal,
    guard:tx=>invocationFor(context).guard(tx)},async tx=>{
    await requireSchedulerAuthority(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),
     input.package_id===undefined?undefined:uuid(input.package_id,'package_id'));
    return reconciler.reconcile(tx,scope,uuid(input.request_id,'request_id'));
   });
  }
 }};
}
