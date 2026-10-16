import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertInvocation,exact,fail,uuid,decimal,DIGEST} from '../transport/protocol.js';
import {identityTransaction} from '../identity/enrollment.js';
import {object} from '../policy/programme.js';
import {parseComputeToken,assertCurrentCompute} from '../scheduler/leases.js';
import type {ComputeToken} from '../scheduler/claim.js';
import {requestDigest} from '../scheduler/claim.js';
import {receive} from '../events/inbox.js';
import {issue} from '../events/instructions.js';
import {currentClaim,acknowledge} from '../events/outbox.js';

export interface RunnerSpawnInput {
 organisation_id:string;run_id:string;command_id:string;token:ComputeToken;
 packet_digest:string;payload_digest:string;
}
export interface RunnerLaunchPlan {
 launch_id:string;slot_id:string;agent_session_id:string;connector_plan_digest:string;
}
/** Trusted13 startup code supplies the qualified model/connector plan. Models
 * cannot submit a callback or turn their own launch labels into authority. */
export type RunnerPlanReader=(tx:PrimaryTransaction,input:RunnerSpawnInput,invocation:InvocationContext)=>Promise<RunnerLaunchPlan|null>;
export interface RunnerDispatch {
 registerPlanReader(reader:RunnerPlanReader):()=>void;
 consume(tx:PrimaryTransaction,i:InvocationContext,input:{event_id:string;attempt_count:string}):Promise<unknown>;
 describe():{route_ready:boolean;status:'READY'|'NOT_READY';launch_authority:false;reason:string|null};
}
export function isRunnerDispatch(v:unknown):v is RunnerDispatch {
 return object(v)&&typeof v.registerPlanReader==='function'&&typeof v.consume==='function'&&typeof v.describe==='function';
}
export function requireRunnerDispatch(ctx:ComponentContext):RunnerDispatch {
 return ctx.dependencies.require('12.2','runner.dispatch.v1',isRunnerDispatch);
}
const tokenKeys=['organisation_id','run_id','task_id','attempt_id','attempt_generation','authority_epoch','sandbox_id','slot_id','sandbox_boot_generation'] as const;
export function createComponent(ctx:ComponentContext):Component {
 let reader:RunnerPlanReader|undefined;
 const consumer=ctx.env.HF_SCHEDULER_NATIVE_CONSUMER_ID;
 const cap:RunnerDispatch=Object.freeze({
  registerPlanReader:(next:RunnerPlanReader)=>{
   if(typeof next!=='function'||reader)fail('RUNNER_PLAN_READER_CONFLICT','A single trusted plan producer must own this route');
   reader=next;return ()=>{if(reader===next)reader=undefined;};
  },
  describe:():ReturnType<RunnerDispatch['describe']>=>({route_ready:!!reader&&uuid(consumer),status:reader&&uuid(consumer)?'READY':'NOT_READY',launch_authority:false,
   reason:!reader?'QUALIFIED_PLAN_READER_UNREGISTERED':!uuid(consumer)?'NATIVE_CONSUMER_UNCONFIGURED':null}),
  consume:async(tx:PrimaryTransaction,i:InvocationContext,input:{event_id:string;attempt_count:string})=>{
   assertPrimaryTransaction(tx);assertInvocation(i);await i.guard(tx);
   if(!['OPERATOR','COORDINATOR','DISPATCH'].includes(i.principal.role))fail('ROLE_DENIED','Authenticated dispatch controller required');
   exact(input,['event_id','attempt_count']);
   if(!uuid(input.event_id)||!decimal(input.attempt_count,true)||!uuid(consumer))fail('RUNNER_DISPATCH_INPUT_INVALID','Exact delivery claim and configured native consumer required');
   if(!reader)fail('RUNNER_PLAN_NOT_READY','Qualified plan reader is not registered; source delivery remains pending');
   const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
   const claim={...scope,event_id:input.event_id,consumer_id:consumer,attempt_count:input.attempt_count};
   await currentClaim(tx,claim);
   const admitted=await receive(tx,{...scope,event_id:input.event_id,consumer_id:consumer},async(t,event)=>{
    if(event.aggregate_type!=='scheduler-spawn'||event.event_type!=='runner.spawn.requested'||event.aggregate_version!=='1')fail('RUNNER_DISPATCH_EVENT_INVALID','Only committed scheduler spawn events enter the native route');
    const v=event.payload;exact(v,['command_id','token','packet_digest','payload_digest']);
    if(!uuid(v.command_id)||event.aggregate_id!==v.command_id||typeof v.packet_digest!=='string'||!DIGEST.test(v.packet_digest)||typeof v.payload_digest!=='string'||!DIGEST.test(v.payload_digest))fail('RUNNER_DISPATCH_EVENT_INVALID','Immutable dispatch identity and digests required');
    const token=parseComputeToken(v.token);
    if(requestDigest({command_id:v.command_id,token,packet_digest:v.packet_digest})!==v.payload_digest)fail('RUNNER_DISPATCH_EVENT_INVALID','Dispatch payload preimage differs from immutable scheduler request');
    if(token.organisation_id!==scope.organisation_id||token.run_id!==scope.run_id)fail('RUNNER_DISPATCH_SCOPE_DENIED','Event target is outside authenticated run');
    const row=(await t.query('SELECT * FROM hyperfide.scheduler_dispatches WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[scope.organisation_id,scope.run_id,v.command_id])).rows[0];
    if(!row||row.event_id!==event.id||row.payload_digest!==v.payload_digest||!['INTENT','UNKNOWN'].includes(row.state))fail('RUNNER_DISPATCH_EVENT_INVALID','Committed scheduler dispatch must bind this exact source event');
    for(const key of tokenKeys)if(String(row[key])!==String(token[key]))fail('RUNNER_DISPATCH_SCOPE_DENIED','Dispatch token differs from its primary journal');
    const current=await assertCurrentCompute(t,token,{operation:'ADVANCE'});
    if(current.input_packet_digest!==v.packet_digest)fail('RUNNER_DISPATCH_PACKET_STALE','Current authority requires a different immutable execution packet');
    const selected=await reader!(t,{...scope,command_id:v.command_id,token,packet_digest:v.packet_digest,payload_digest:v.payload_digest},i);
    if(!selected)fail('RUNNER_PLAN_NOT_READY','Actual connector/model/workspace qualification is unavailable; delivery stays pending');
    if(!uuid(selected.launch_id)||!uuid(selected.agent_session_id)||selected.slot_id!==token.slot_id||typeof selected.connector_plan_digest!=='string'||!DIGEST.test(selected.connector_plan_digest))fail('RUNNER_PLAN_INVALID','Trusted plan must preserve exact slot and immutable launch identity');
    const result=await issue(t,{...scope,id:v.command_id,attempt_id:token.attempt_id,attempt_generation:token.attempt_generation,
     authority_epoch:token.authority_epoch,sandbox_boot_generation:token.sandbox_boot_generation,kind:'START',
     body:{launch_id:selected.launch_id,slot_id:token.slot_id,agent_session_id:selected.agent_session_id,connector_plan_digest:selected.connector_plan_digest}});
    return {recorded:true,command_id:v.command_id,launch_id:selected.launch_id,instruction:result,authority:'NONE',native_execution_observed:false};
   });
   if(!admitted.inbox_id||!['APPLIED','DUPLICATE'].includes(admitted.status))return {...admitted,acknowledged:false};
   const ack=await acknowledge(tx,{...claim,inbox_id:admitted.inbox_id});
   return {...admitted,acknowledgement:ack,execution_confirmed:false,task_qualified:false};
  }
 });
 return {apiVersion:1,capabilities:{'runner.dispatch.v1':cap},actions:{
  'runner.dispatch.describe':()=>cap.describe(),
  'runner.dispatch.consume':(v,context)=>identityTransaction(context,(tx,i)=>{
   if(!object(v))fail('RUNNER_DISPATCH_INPUT_INVALID','Object delivery claim required');
   return cap.consume(tx as PrimaryTransaction,i,v as unknown as {event_id:string;attempt_count:string});
  })
 }};
}
