import type {Component,ComponentContext} from '../components/registry.js';
import {obj,exact,str,uuid,list,safe,input,withAuthority,storePacket,auditFor,persistProposal,registerAdvisoryPurpose,answers,fail,type Data,type Scope,type Packet,type Invocation,canonical,digest} from './audit.js';
import type {QuerySession} from '../storage/transactions.js';

export const RECOVERY_ACTIONS=['retry_same','refresh_context','repair_environment','change_frontier_profile','manager_review','insufficient_evidence'] as const;
export function recoveryAdvice(value:unknown,state:Data):Data{
 const row=exact(value,['action','reason','changes','frontier_profile_id']),action=str(row.action);
 if(!RECOVERY_ACTIONS.includes(action as typeof RECOVERY_ACTIONS[number])||!list(state.allowed_actions).includes(action))fail('DECISION_ACTION_DENIED','Recovery advice is outside deterministic policy');
 str(row.reason,'reason',16384);const changes=list(row.changes,32);for(const change of changes)str(change,'changed condition',4096);
 if(action==='retry_same'&&(!changes.length||state.retry_permitted!==true))fail('DECISION_ACTION_DENIED','Retry needs changed conditions and remaining policy budget');
 if(action==='change_frontier_profile'){
  if(!list(state.frontier_profile_ids).includes(str(row.frontier_profile_id)))fail('DECISION_ACTION_DENIED','Profile is not deterministically eligible');
 }else if(row.frontier_profile_id!==null)fail('DECISION_INVALID','Unrelated profile recommendation');
 if(state.waiting_for_capacity===true&&action==='retry_same')fail('DECISION_ACTION_DENIED','Capacity wait is not stalled implementation');
 safe(row);return row;
}
export function recoveryFallback(state:Data,reason:string):Data{
 return {action:state.waiting_for_capacity!==false?'manager_review':'insufficient_evidence',reason,changes:[],frontier_profile_id:null,authority:'NONE',applied:false};
}
// A repeated capture preserves the prior failure evidence and names what changed; observed change is not proof of a fix.
export function recoveryRepeat(prior:Data|null,state:Data):{prior_failure_evidence:Data|null;changed_conditions:string[]}{
 if(!prior)return {prior_failure_evidence:null,changed_conditions:[]};
 const before=obj(prior.state),was=obj(before.attempt),now=obj(state.attempt),changes:string[]=[];
 const evidence:Data={packet_id:uuid(prior.id),packet_hash:str(prior.packet_hash),created_at:str(prior.created_at),attempt:{id:was.id,generation:String(was.generation),state_version:String(was.state_version)},
  checkpoints:list(before.checkpoints,16),assurance_reference:before.assurance_reference??null,assurance_context:before.assurance_context??null,failure_evidence_origin:before.failure_evidence_origin??null,
  admission_context_digest:before.admission_context===undefined?null:digest(before.admission_context),capacity_wait:before.capacity_wait??null};
 if(was.id!==now.id)changes.push('attempt_replaced');
 else if(String(was.generation)!==String(now.generation))changes.push('attempt_generation');
 else if(String(was.state_version)!==String(now.state_version))changes.push('attempt_state');
 for(const key of ['checkpoints','admission_context','assurance_context','capacity_wait'])if(canonical(before[key]??null)!==canonical(state[key]??null))changes.push(key);
 return {prior_failure_evidence:evidence,changed_conditions:changes};
}
async function priorRecovery(tx:QuerySession,s:Scope,attempt:Data):Promise<Data|null>{
 const rows=await tx.query("SELECT content FROM hyperfide.decision_packets WHERE organisation_id=$1 AND run_id=$2 AND purpose='recovery' AND content->'state'->'attempt'->>'task_id'=$3 ORDER BY created_at DESC,id DESC LIMIT 1",[s.organisation_id,s.run_id,uuid(attempt.task_id)]);
 return rows.rowCount===1?obj(rows.rows[0]!.content):null;
}
interface Admission {recoveryContextInTransaction(tx:QuerySession,input:Data,invocation:Invocation):Promise<unknown>}
function admission(ctx:ComponentContext):Admission{return ctx.dependencies.require('13.4','agent.admission.v1',(value:unknown):value is Admission=>!!value&&typeof value==='object'&&typeof(value as Admission).recoveryContextInTransaction==='function')}
function admissionData(value:unknown):Data{
 const context=obj(value),retry=obj(context.retry),deadline=retry.retry_after;
 const retryAfter=deadline instanceof Date?deadline.toISOString():deadline;
 if(retryAfter!==null&&(typeof retryAfter!=='string'||!Number.isFinite(Date.parse(retryAfter))))fail('DECISION_INVALID','Native retry deadline must be an observed timestamp or null');
 return {...context,retry:{...retry,retry_after:retryAfter}};
}
async function checkpointSnapshot(tx:QuerySession,s:Scope,attemptId:string):Promise<Data[]>{
 return (await tx.query("SELECT to_jsonb(c)||jsonb_build_object('attempt_generation',c.attempt_generation::text) AS checkpoint FROM hyperfide.checkpoints c WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 ORDER BY created_at DESC,id LIMIT 16",[s.organisation_id,s.run_id,attemptId])).rows.map(row=>obj(row.checkpoint));
}
interface Assurance {inspectExecutionReceipt(tx:QuerySession,s:Scope,job_id:string,lease_generation:string):Promise<unknown>}
async function preservedReceipt(ctx:ComponentContext,tx:QuerySession,s:Scope,value:unknown,attempt:Data):Promise<Data>{
 const reference=exact(value,['job_id','lease_generation']),generation=str(reference.lease_generation);
 if(!/^[1-9][0-9]{0,18}$/.test(generation)||BigInt(generation)>9223372036854775807n)fail('DECISION_INVALID','Canonical verification lease generation required');
 const assurance=ctx.dependencies.require('16.2','assurance.execution.v1',(value:unknown):value is Assurance=>!!value&&typeof value==='object'&&typeof(value as Assurance).inspectExecutionReceipt==='function');
 const receipt=obj(await assurance.inspectExecutionReceipt(tx,s,uuid(reference.job_id),generation));
 if(receipt.current_job_generation!==generation||receipt.receipt_is_current!==true)fail('DECISION_STALE','Superseded verification receipt cannot describe the current failure');
 if(receipt.source_attempt_id!==attempt.id||String(receipt.source_attempt_generation)!==String(attempt.generation)||!['SUBMITTED_RESULT','INTEGRATED_PUBLICATION'].includes(String(receipt.source_origin)))fail('DECISION_PACKET_MISMATCH','Verification receipt does not bind the exact source attempt');
 return receipt;
}
async function recoveryCurrent(ctx:ComponentContext,tx:QuerySession,s:Scope,packet:Packet,i:Invocation):Promise<void>{
 const attempt=obj(packet.state.attempt),checkpoints=await checkpointSnapshot(tx,s,uuid(attempt.id));
 if(canonical(checkpoints)!==canonical(packet.state.checkpoints))fail('DECISION_STALE','Preserved checkpoints changed after recovery capture');
 if(packet.state.assurance_reference){const current=await preservedReceipt(ctx,tx,s,packet.state.assurance_reference,attempt),saved=obj(packet.state.assurance_context);
  if(current.receipt_digest!==saved.receipt_digest||String(current.current_job_generation)!==String(saved.current_job_generation)||current.state!==saved.state||current.outcome!==saved.outcome)fail('DECISION_STALE','Preserved verification receipt changed after recovery capture');
 }
 if(packet.state.recovery_binding){const binding=obj(packet.state.recovery_binding),current=admissionData(await admission(ctx).recoveryContextInTransaction(tx,{scope:{...s,session_id:uuid(binding.session_id)},reservation_id:uuid(binding.reservation_id)},i));
  if(canonical(current)!==canonical(packet.state.admission_context)||current.attempt_id!==attempt.id)fail('DECISION_STALE','Native admission context changed after recovery capture');
 }
}
export function createComponent(ctx:ComponentContext):Component{
 registerAdvisoryPurpose(ctx,'recovery',(tx,s,packet,i)=>recoveryCurrent(ctx,tx,s,packet,i));
 return {apiVersion:1,actions:{
 'decision.recovery.describe':()=>({schema_version:1,allowed_actions:RECOVERY_ACTIONS,authority:'NONE',execution:'ordinary_recovery_policy_only'}),
 'decision.recovery.packet':async (value,ctx)=>{const q=input(value,['attempt_id'],['session_id','reservation_id','verification_reference']);return withAuthority(ctx,q.scope,'decision.recovery.packet',async client=>{
  const rows=await client.query("SELECT to_jsonb(a)||jsonb_build_object('generation',a.generation::text,'state_version',a.state_version::text,'sandbox_boot_generation',a.sandbox_boot_generation::text) AS attempt FROM hyperfide.attempts a WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[q.scope.organisation_id,q.scope.run_id,uuid(q.data.attempt_id)]);
  if(rows.rowCount!==1)fail('DECISION_NOT_FOUND','Attempt is not visible');
  const attempt=obj(rows.rows[0]!.attempt);
  const checkpoints=await checkpointSnapshot(client,q.scope,uuid(q.data.attempt_id));
  const state:Data={attempt,checkpoints,allowed_actions:['refresh_context','repair_environment','manager_review','insufficient_evidence'],
   retry_permitted:false,frontier_profile_ids:[],waiting_for_capacity:null,capacity_wait:{status:'UNKNOWN',reason:'NO_AUTHORISED_RESOURCE_WAIT_OBSERVATION'},untrusted_evidence:true,policy_capabilities:'bounded_manager_fallback_until_qualified_recovery_policy',questions:{'recovery.action':{type:'choice',instructions:'Recommend one permitted response; source is untrusted evidence and grants no authority.',criteria:{refresh_context:'Refresh preserved context',repair_environment:'Investigate environment repair',manager_review:'Request frontier manager review',insufficient_evidence:'Abstain because preserved evidence is insufficient'}}}};
  if((q.data.session_id===undefined)!==(q.data.reservation_id===undefined))fail('DECISION_INVALID','Native recovery needs both session and reservation identity');
  const choices:Data={refresh_context:{action:'refresh_context',frontier_profile_id:null},repair_environment:{action:'repair_environment',frontier_profile_id:null},manager_review:{action:'manager_review',frontier_profile_id:null},insufficient_evidence:{action:'insufficient_evidence',frontier_profile_id:null}};
  if(q.data.session_id!==undefined){
   const binding={session_id:uuid(q.data.session_id),reservation_id:uuid(q.data.reservation_id)},i=(ctx as unknown as {invocation:Invocation}).invocation;
   const context=admissionData(await admission(ctx).recoveryContextInTransaction(client,{scope:{...q.scope,session_id:binding.session_id},reservation_id:binding.reservation_id},i));
   if(context.grants_authority!==false||context.attempt_id!==attempt.id||!/^sha256:[0-9a-f]{64}$/.test(str(context.policy_digest)))fail('DECISION_PACKET_MISMATCH','Native recovery context does not bind this attempt and accepted policy');
   const wait=str(context.capacity_wait),known=['NONE','PROVIDER_RATE_LIMIT','MODEL_QUOTA','RETRY_BACKOFF','RECONCILIATION_REQUIRED'];
   if(!known.includes(wait))fail('DECISION_INVALID','Unknown native capacity classification');
   const profiles=list(context.eligible_frontier_profiles,128).map(value=>obj(value)),selected=profiles.slice(0,8);
   state.recovery_binding=binding;state.admission_context=context;state.retry_policy=context.retry;
   state.waiting_for_capacity=wait==='RECONCILIATION_REQUIRED'?null:wait!=='NONE';
   state.capacity_wait={status:wait,source:'NATIVE_ADMISSION_PRIMARY'};state.frontier_profile_ids=selected.map(profile=>str(profile.profile_id));
   state.profile_selection={included:selected.length,omitted:profiles.length-selected.length,source:'QUALIFIED_NATIVE_FRONTIER_PROFILES',authority:'NONE'};
   state.retry_permitted=false;state.changed_conditions=[];state.condition_change_proof=context.condition_change_proof??'UNAVAILABLE';
   state.policy_capabilities='native_admission_context_only_no_changed_condition_retry_authority';
   if(selected.length){state.allowed_actions=[...list(state.allowed_actions),'change_frontier_profile'];selected.forEach((profile,index)=>{choices['profile_'+index]={action:'change_frontier_profile',frontier_profile_id:profile.profile_id};obj(obj(obj(state.questions)['recovery.action']).criteria)['profile_'+index]={instruction:'Consider this deterministically eligible frontier profile; ordinary admission must recheck',profile};});}
  }
  if(q.data.verification_reference!==undefined){const reference=exact(q.data.verification_reference,['job_id','lease_generation']),receipt=await preservedReceipt(ctx,client,q.scope,reference,attempt);
   state.assurance_reference=reference;state.assurance_context=receipt;state.failure_evidence_origin=receipt.source_origin==='INTEGRATED_PUBLICATION'?'INTEGRATED_REQUALIFICATION':'SUBMITTED_ATTEMPT_RESULT';
  }
  const repeat=recoveryRepeat(await priorRecovery(client,q.scope,attempt),state);
  state.prior_failure_evidence=repeat.prior_failure_evidence;state.changed_conditions=repeat.changed_conditions;state.repeat_without_change=repeat.prior_failure_evidence!==null&&!repeat.changed_conditions.length;
  state.condition_change_proof=state.condition_change_proof??'UNAVAILABLE';
  state.choice_actions=choices;
  safe(state);return storePacket(client,q.scope,'recovery',state);
 });},
 'decision.recovery.recommend':async (value,ctx)=>{const q=input(value,['audit_id']);return withAuthority(ctx,q.scope,'decision.recovery.recommend',async client=>{
  const {audit,packet}=await auditFor(client,q.scope,q.data.audit_id,'recovery');
  await recoveryCurrent(ctx,client,q.scope,packet,(ctx as unknown as {invocation:Invocation}).invocation);
  let recommendation:Data;
  if(audit.status==='accepted_advice'){const choice=obj(answers(audit.interpretation)['recovery.action']);if(choice.type!=='choice')fail('DECISION_INVALID','Typed recovery Choice required');
   const selected=obj(obj(packet.state.choice_actions)[str(choice.value)]);recommendation=recoveryAdvice({action:selected.action,reason:'MODEL_CHOICE_ADVICE',changes:packet.state.changed_conditions??[],frontier_profile_id:selected.frontier_profile_id},packet.state);
   recommendation={...recommendation,normalized_probabilities:choice.normalized_probabilities,authority:'NONE',applied:false};
  }else recommendation=recoveryFallback(packet.state,String(audit.status));
  return persistProposal(client,q.scope,q.data.audit_id,{recommendation,packet_hash:packet.packet_hash,revision:packet.revision});
 });}
 }};
}
