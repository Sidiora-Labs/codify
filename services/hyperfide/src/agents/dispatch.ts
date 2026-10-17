import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {exactAgentObject,agentString,agentDigest,agentTransaction,agentError} from './sessions.js';
import {isAgentAdmissionCapability} from './admission.js';
import type {AgentAdmissionCapability} from './admission.js';
import {requireRunnerDispatch} from '../runner/dispatch.js';
import type {RunnerLaunchPlan,RunnerSpawnInput} from '../runner/dispatch.js';
import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {object} from '../policy/programme.js';

/** Trusted native launch-plan producer for the 12.2 START route. The plan names the admitted
 * connector/model/permission profile for the token's worker session and is persisted once per
 * scheduler command, so a replayed dispatch returns the same plan and never a second launch. */
type Selection={plan:RunnerLaunchPlan|null;reason:string|null;replayed:boolean};
const tokenKeys=['task_id','attempt_id','attempt_generation','authority_epoch','sandbox_id','slot_id','sandbox_boot_generation'] as const;
function launchPlan(row:Record<string,unknown>):RunnerLaunchPlan{
 return {launch_id:String(row.launch_id),slot_id:String(row.slot_id),agent_session_id:String(row.agent_session_id),connector_plan_digest:String(row.connector_plan_digest)};
}
async function select(tx:PrimaryTransaction,admission:AgentAdmissionCapability,input:RunnerSpawnInput,invocation:InvocationContext):Promise<Selection>{
 assertPrimaryTransaction(tx);assertInvocation(invocation);await invocation.guard(tx);
 const {organisation_id:org,run_id:run,command_id:command,token}=input;
 if(token.organisation_id!==org||token.run_id!==run||org!==invocation.principal.organisation_id||run!==invocation.principal.run_id)agentError('AGENT_SCOPE_DENIED');
 const existing=(await tx.query('SELECT * FROM hyperfide.native_launch_plans WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3',[org,run,command])).rows[0] as Record<string,unknown>|undefined;
 if(existing){
  if(existing.payload_digest!==input.payload_digest||existing.packet_digest!==input.packet_digest||existing.slot_id!==token.slot_id||existing.attempt_id!==token.attempt_id||String(existing.attempt_generation)!==String(token.attempt_generation))agentError('NATIVE_PLAN_CONFLICT');
  return {plan:launchPlan(existing),reason:null,replayed:true};
 }
 // Independent of the caller: the plan binds only a committed, unresolved scheduler dispatch.
 const dispatch=(await tx.query('SELECT * FROM hyperfide.scheduler_dispatches WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[org,run,command])).rows[0] as Record<string,unknown>|undefined;
 if(!dispatch||dispatch.payload_digest!==input.payload_digest||!['INTENT','UNKNOWN'].includes(String(dispatch.state)))return {plan:null,reason:'DISPATCH_NOT_PENDING',replayed:false};
 for(const key of tokenKeys)if(String(dispatch[key])!==String(token[key]))agentError('NATIVE_PLAN_TOKEN_MISMATCH');
 const sessions=(await tx.query("SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND role='WORKER' AND attempt_id=$3 AND slot_id=$4 AND sandbox_id=$5 AND sandbox_boot_generation=$6 FOR SHARE",[org,run,token.attempt_id,token.slot_id,token.sandbox_id,token.sandbox_boot_generation])).rows;
 if(sessions.length!==1)return {plan:null,reason:sessions.length?'AGENT_SESSION_AMBIGUOUS':'AGENT_SESSION_UNBOUND',replayed:false};
 const session_id=String(sessions[0]!.id);
 const admitted=await admission.launchSelection(tx,{organisation_id:org,run_id:run,session_id},invocation);
 if(!admitted.selection)return {plan:null,reason:admitted.reason??'ADMISSION_UNAVAILABLE',replayed:false};
 const a=admitted.selection;
 if(a.native_delegation!==false)agentError('ADMISSION_DELEGATION_UNSUPPORTED');
 const consumed=await tx.query('SELECT command_id FROM hyperfide.native_launch_plans WHERE organisation_id=$1 AND run_id=$2 AND admission_reservation_id=$3 AND reservation_attempt=$4',[org,run,a.reservation_id,a.reservation_attempt]);
 if(consumed.rows.length)return {plan:null,reason:'ADMISSION_ATTEMPT_CONSUMED',replayed:false};
 const launch_id=randomUUID();
 const body={schema_version:1,command_id:command,launch_id,agent_session_id:session_id,slot_id:token.slot_id,attempt_id:token.attempt_id,attempt_generation:String(token.attempt_generation),
  packet_digest:input.packet_digest,connector:a.connector,connector_version:a.connector_version,provider:a.provider,model:a.model,auth_profile:a.auth_profile,
  permission_profile:a.permission_profile,qualification_receipt_digest:a.qualification_digest,admission_reservation_id:a.reservation_id,reservation_attempt:a.reservation_attempt,
  admission_policy_digest:a.policy_digest,run_policy_digest:a.run_policy_digest,native_delegation:false,unattended:true};
 const digest=agentDigest(body);
 const row=(await tx.query('INSERT INTO hyperfide.native_launch_plans(organisation_id,run_id,command_id,launch_id,agent_session_id,slot_id,attempt_id,attempt_generation,connector,connector_plan_digest,admission_reservation_id,reservation_attempt,admission_policy_digest,run_policy_digest,qualification_receipt_digest,packet_digest,payload_digest,plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb) RETURNING *',
  [org,run,command,launch_id,session_id,token.slot_id,token.attempt_id,token.attempt_generation,a.connector,digest,a.reservation_id,a.reservation_attempt,a.policy_digest,a.run_policy_digest,a.qualification_digest,input.packet_digest,input.payload_digest,JSON.stringify(body)])).rows[0] as Record<string,unknown>;
 return {plan:launchPlan(row),reason:null,replayed:false};
}
export function createComponent(ctx:ComponentContext):Component{
 const admission=ctx.dependencies.require('13.4','agent.admission.v1',(value:unknown):value is AgentAdmissionCapability=>isAgentAdmissionCapability(value)&&typeof (value as unknown as Record<string,unknown>).launchSelection==='function');
 const route=requireRunnerDispatch(ctx);
 // Exactly one trusted reader owns the native START route; a second producer fails startup.
 const unregister=route.registerPlanReader(async(tx,input,invocation)=>(await select(tx,admission,input,invocation)).plan);
 const controller=(invocation:InvocationContext|undefined):InvocationContext=>{
  assertInvocation(invocation);
  if(!['OPERATOR','COORDINATOR','DISPATCH'].includes(invocation.principal.role))agentError('AGENT_ROLE_DENIED');
  return invocation;
 };
 const command=(input:unknown):string=>agentString(exactAgentObject(input,['command_id']).command_id,'uuid');
 return {apiVersion:1,close:()=>unregister(),actions:{
  'agent.launch-plan.describe':async(input,context)=>{
   controller(context.invocation);exactAgentObject(input,[]);
   return {plan_reader_registered:true,route:route.describe(),native_delegation:false,launch_authority:false};
  },
  // Runs the same trusted reader the START route uses against a committed scheduler dispatch.
  'agent.launch-plan.prepare':async(input,context)=>{
   const invocation=controller(context.invocation);const id=command(input);
   return agentTransaction(ctx,invocation,async client=>{
    const tx=client as unknown as PrimaryTransaction;assertPrimaryTransaction(tx);
    const {organisation_id,run_id}=invocation.principal;
    const row=(await tx.query('SELECT d.*,a.input_packet_digest FROM hyperfide.scheduler_dispatches d JOIN hyperfide.attempts a ON a.organisation_id=d.organisation_id AND a.run_id=d.run_id AND a.id=d.attempt_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.id=$3',[organisation_id,run_id,id])).rows[0] as Record<string,unknown>|undefined;
    if(!row)agentError('NATIVE_PLAN_DISPATCH_NOT_FOUND');
    const token={organisation_id,run_id,...Object.fromEntries(tokenKeys.map(k=>[k,String(row[k])]))} as RunnerSpawnInput['token'];
    const result=await select(tx,admission,{organisation_id,run_id,command_id:id,token,packet_digest:String(row.input_packet_digest),payload_digest:String(row.payload_digest)},invocation);
    return {...result,launch_authority:false,native_execution_observed:false};
   });
  },
  'agent.launch-plan.inspect':async(input,context)=>{
   const invocation=controller(context.invocation);const id=command(input);
   return agentTransaction(ctx,invocation,async client=>{
    const row=(await client.query('SELECT * FROM hyperfide.native_launch_plans WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3',[invocation.principal.organisation_id,invocation.principal.run_id,id])).rows[0];
    if(!object(row))agentError('NATIVE_PLAN_NOT_FOUND');
    return {plan:row,launch_authority:false};
   });
  }
 }};
}
