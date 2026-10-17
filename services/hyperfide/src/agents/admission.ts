import path from 'node:path';
import type {Component,ComponentContext} from '../components/registry.js';
import {exactAgentObject,agentString,agentScope,agentDigest,agentTransaction,agentError,getNativeSessionProfile,agentOperation,readTrustedAgentFile,assertNativeRunnerScope} from './sessions.js';
import {assertInvocation} from '../transport/protocol.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import type {InvocationContext,AuthorityTransaction} from '../transport/protocol.js';
import {object} from '../policy/programme.js';

type Policy={organisation_id:string;run_id:string;run_policy_digest:string;quota_key:string;connector:string;connector_version:string;provider:string;model:string;auth_profile:string;permission_profile:string;qualification_digest:string;max_concurrent:number;max_attempts:number;retry_base_ms:number;retry_max_ms:number;unattended:true;native_delegation:false};
async function policies(ctx:ComponentContext):Promise<Policy[]>{
 const filename=ctx.env.HF_AGENT_ADMISSION_POLICY_FILE;
 if(!filename||!path.isAbsolute(filename))agentError('ADMISSION_NOT_CONFIGURED');
 let value:unknown;try{value=JSON.parse((await readTrustedAgentFile(filename,131072)).toString('utf8'));}catch{agentError('ADMISSION_POLICY_INVALID');}
 const root=exactAgentObject(value,['schema_version','policies']);
 if(root.schema_version!==1||!Array.isArray(root.policies)||!root.policies.length||root.policies.length>256)agentError('ADMISSION_POLICY_INVALID');
 const seen=new Set<string>();
 return root.policies.map(entry=>{
 const p=exactAgentObject(entry,['organisation_id','run_id','run_policy_digest','quota_key','connector','connector_version','provider','model','auth_profile','permission_profile','qualification_digest','max_concurrent','max_attempts','retry_base_ms','retry_max_ms','unattended','native_delegation']);
 agentString(p.organisation_id,'uuid');agentString(p.run_id,'uuid');
 for(const k of ['quota_key','connector_version','provider','model','auth_profile','permission_profile'])agentString(p[k]);
 agentString(p.qualification_digest,'digest');agentString(p.run_policy_digest,'digest');
 if(!['codex','claude'].includes(String(p.connector))||p.unattended!==true||p.native_delegation!==false||
 !Number.isSafeInteger(p.max_concurrent)||Number(p.max_concurrent)<1||Number(p.max_concurrent)>10000||
 !Number.isSafeInteger(p.max_attempts)||Number(p.max_attempts)<1||Number(p.max_attempts)>32||
 !Number.isSafeInteger(p.retry_base_ms)||Number(p.retry_base_ms)<100||Number(p.retry_base_ms)>60000||
 !Number.isSafeInteger(p.retry_max_ms)||Number(p.retry_max_ms)<Number(p.retry_base_ms)||Number(p.retry_max_ms)>3600000)agentError('ADMISSION_POLICY_INVALID');
 const key=[p.organisation_id,p.run_id,p.quota_key].join('/');
 if(seen.has(key))agentError('ADMISSION_POLICY_INVALID');seen.add(key);
 return p as unknown as Policy;
 });
}
export interface AgentAdmissionCapability {
 readonly schema_version:1;
 recoveryContext(input:unknown,invocation:InvocationContext):Promise<unknown>;
 recoveryContextInTransaction(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise<unknown>;
 /** Trusted 13.4 dispatch only: the current admitted plan inputs for a bound session, or the refusal reason. */
 launchSelection(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;session_id:string},invocation:InvocationContext):Promise<{selection:AdmissionPlanSelection|null;reason:string|null}>;
}
export function isAgentAdmissionCapability(value:unknown):value is AgentAdmissionCapability{
 return object(value)&&value.schema_version===1&&typeof value.recoveryContext==='function'&&typeof value.recoveryContextInTransaction==='function';
}
// Bounded native retry/escalation. A recorded condition change may reopen an escalated
// reservation at most this many times; unknown outcomes are reconciled, never retried.
export const MAX_ADMISSION_ESCALATIONS=3;
const REPORT_REASONS=['RATE_LIMIT','QUOTA_LIMIT','AUTH_EXPIRED','APPROVAL_REQUIRED','UNKNOWN_OUTCOME','DELEGATION_UNSUPPORTED','CONDITION_CHANGED','COMPLETE','TERMINATED'];
export type NativeAdmissionReason='RATE_LIMIT'|'QUOTA_LIMIT'|'AUTH_EXPIRED'|'APPROVAL_REQUIRED'|'DELEGATION_UNSUPPORTED';
export interface NativeSignalClassification {
 connector:'codex'|'claude';
 /** Liveness/waiting/progress are distinct: no classification ever reports useful progress. */
 signal:'RATE_LIMITED'|'QUOTA_EXHAUSTED'|'AUTH_FAILED'|'APPROVAL_PROMPT'|'DELEGATION_REQUESTED'|'MODEL_WAITING'|'MODEL_ERROR'|'RATE_LIMIT_STATUS'|'TURN_FINISHED'|'IGNORED';
 reason:NativeAdmissionReason|null;code:string|null;resets_at:string|null;useful_progress:false;
}
const field=(value:unknown,key:string):unknown=>object(value)?value[key]:undefined;
const text=(value:unknown):string|null=>typeof value==='string'&&value.length<=128?value:null;
function resetTime(value:unknown):string|null{
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return new Date(value<1e12?value*1000:value).toISOString();
 return null;
}
/** Maps one native connector protocol message (Codex app-server JSON-RPC, Claude Code stream-json)
 * to an admission report reason. Only normalized codes survive; native message text never does. */
export function classifyNativeEvent(connector:'codex'|'claude',event:unknown):NativeSignalClassification{
 const out=(signal:NativeSignalClassification['signal'],reason:NativeAdmissionReason|null,code:string|null=null,resets:string|null=null):NativeSignalClassification=>
  Object.freeze({connector,signal,reason,code,resets_at:resets,useful_progress:false as const});
 if(!object(event))agentError('ADMISSION_SIGNAL_INVALID');
 if(connector==='codex'){
  const method=event.method,params=field(event,'params');
  if(typeof method!=='string')agentError('ADMISSION_SIGNAL_INVALID');
  // Server-to-client requests need an interactive answer; unattended policy never auto-approves.
  if(event.id!==undefined&&['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','execCommandApproval','applyPatchApproval','item/tool/requestUserInput','mcpServer/elicitation/request'].includes(method))return out('APPROVAL_PROMPT','APPROVAL_REQUIRED',method);
  // Hyperfide never supplies account tokens to a native process (no credential sharing).
  if(event.id!==undefined&&method==='account/chatgptAuthTokens/refresh')return out('AUTH_FAILED','AUTH_EXPIRED',method);
  if(method==='error'){
   const info=field(field(params,'error'),'codexErrorInfo'),retrying=field(params,'willRetry')===true;
   if(typeof info==='string'){
    if(['usageLimitExceeded','sessionBudgetExceeded'].includes(info))return out('QUOTA_EXHAUSTED','QUOTA_LIMIT',info);
    if(['rateLimitExceeded','serverOverloaded'].includes(info))return out('RATE_LIMITED','RATE_LIMIT',info);
    if(info==='unauthorized')return out('AUTH_FAILED','AUTH_EXPIRED',info);
    return out(retrying?'MODEL_WAITING':'MODEL_ERROR',null,text(info));
   }
   if(object(info)){
    const kind=Object.keys(info)[0]??null,status=field(kind?info[kind]:undefined,'httpStatusCode');
    if(status===429)return out('RATE_LIMITED','RATE_LIMIT',kind+':429');
    if(status===401||status===403)return out('AUTH_FAILED','AUTH_EXPIRED',kind+':'+status);
    return out(retrying?'MODEL_WAITING':'MODEL_ERROR',null,text(kind));
   }
   return out(retrying?'MODEL_WAITING':'MODEL_ERROR',null);
  }
  if(method==='account/rateLimits/updated'){
   const limits=field(params,'rateLimits'),reached=field(limits,'rateLimitReachedType'),resets=resetTime(field(field(limits,'primary'),'resetsAt'));
   if(reached==='rate_limit_reached')return out('RATE_LIMITED','RATE_LIMIT',reached,resets);
   if(typeof reached==='string'&&/credits_depleted$|usage_limit_reached$/.test(reached))return out('QUOTA_EXHAUSTED','QUOTA_LIMIT',text(reached),resets);
   return out('RATE_LIMIT_STATUS',null,null,resets);
  }
  if(method==='item/started'||method==='item/completed'){
   const type=field(field(params,'item'),'type');
   if(type==='collabAgentToolCall'||type==='subAgentActivity')return out('DELEGATION_REQUESTED','DELEGATION_UNSUPPORTED',type);
   return out('IGNORED',null);
  }
  if(method==='turn/completed')return out('TURN_FINISHED',null,text(field(field(params,'turn'),'status')));
  return out('IGNORED',null);
 }
 const type=event.type;
 if(typeof type!=='string')agentError('ADMISSION_SIGNAL_INVALID');
 if(type==='rate_limit_event'){
  const info=field(event,'rate_limit_info'),status=field(info,'status'),resets=resetTime(field(info,'resetsAt'));
  if(status==='rejected')return out('RATE_LIMITED','RATE_LIMIT',text(field(info,'rateLimitType'))??'rejected',resets);
  return out('RATE_LIMIT_STATUS',null,text(status),resets);
 }
 if(type==='control_request'&&field(field(event,'request'),'subtype')==='can_use_tool')return out('APPROVAL_PROMPT','APPROVAL_REQUIRED','can_use_tool');
 if(type==='assistant'){
  const error=event.error;
  if(error==='rate_limit'||error==='overloaded')return out('RATE_LIMITED','RATE_LIMIT',error);
  if(error==='billing_error')return out('QUOTA_EXHAUSTED','QUOTA_LIMIT',error);
  if(['authentication_failed','oauth_org_not_allowed','account_on_hold','verification_required','cloud_credential_error'].includes(String(error)))return out('AUTH_FAILED','AUTH_EXPIRED',String(error));
  if(typeof error==='string')return out('MODEL_ERROR',null,text(error));
  const content=field(field(event,'message'),'content');
  if(Array.isArray(content)&&content.some(part=>field(part,'type')==='tool_use'&&['Task','Agent'].includes(String(field(part,'name')))))return out('DELEGATION_REQUESTED','DELEGATION_UNSUPPORTED','tool_use');
  return out('IGNORED',null);
 }
 if(type==='result')return out(event.is_error===true?'MODEL_ERROR':'TURN_FINISHED',null,text(event.subtype));
 return out('IGNORED',null);
}
/** The trusted admission entry must name the run's approved autonomous policy. */
async function assertRunPolicy(client:{query:AuthorityTransaction['query']},s:{organisation_id:string;run_id:string},p:Policy):Promise<string>{
 const run=await client.query('SELECT policy_digest,state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[s.organisation_id,s.run_id]);
 const row=run.rows[0] as Record<string,unknown>|undefined;
 if(!row||row.policy_digest!==p.run_policy_digest)agentError('ADMISSION_RUN_POLICY_UNAPPROVED');
 if(!['READY','RUNNING'].includes(String(row.state)))agentError('ADMISSION_RUN_NOT_EXECUTING');
 return String(row.policy_digest);
}
export interface AdmissionPlanSelection {
 reservation_id:string;reservation_attempt:number;policy_digest:string;run_policy_digest:string;connector:'codex'|'claude';connector_version:string;
 provider:string;model:string;auth_profile:string;permission_profile:string;qualification_digest:string;native_delegation:false;
}
export function createComponent(ctx:ComponentContext):Component{
 // Frozen once per component startup. Requests cannot replace approved permission or quota policy.
 const trusted=policies(ctx);void trusted.catch(()=>{});
 const keys:Record<string,[string[],string[]]>={
  reserve:[['scope','reservation_id','quota_key'],['native_delegation']],
  inspect:[['scope','reservation_id'],[]],context:[['scope','reservation_id'],[]],escalations:[['scope','reservation_id'],[]],
  report:[['scope','reservation_id','operation_id','reason'],['diagnostic_refs','command_receipt_refs','condition_digest']],
  observe:[['scope','reservation_id','operation_id','connector','event'],['diagnostic_refs','command_receipt_refs']]};
 const nativeEligible=(native:Record<string,unknown>,p:Policy,configuration:unknown):boolean=>{
  const cap=native.capabilities as Record<string,unknown>;
  return native.connector===p.connector&&(native.binary as Record<string,unknown>).version===p.connector_version&&native.profile_digest===configuration&&
   native.permission_profile_id===p.permission_profile&&native.configured_provider_id===p.provider&&native.requested_model_id===p.model&&cap.unattended===true;
 };
 const action=(name:string,providedTransaction?:PrimaryTransaction)=>async(input:unknown,requestContext:ComponentContext):Promise<unknown>=>{
 const invocation=requestContext.invocation;assertInvocation(invocation);
 if(ctx.signal.aborted)agentError('ADMISSION_CLOSED');
 const v=exactAgentObject(input,...keys[name]!);
 const s=agentScope(v.scope,invocation),id=agentString(v.reservation_id,'uuid');
 const selected=await trusted;
 const run=async(client:AuthorityTransaction)=>{
 const references=(value:unknown):string[]=>{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>32||new Set(value).size!==value.length)agentError('AGENT_INPUT_INVALID');
 return value.map(item=>agentString(item,'uuid'));
 };
 const dbNow=async()=>new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0]!.now).getTime();
 const execute=async(reason?:string,classification?:NativeSignalClassification)=>{
 const admitted=await client.query('SELECT s.connector,s.state,s.attempt_id,s.sandbox_id,s.sandbox_boot_generation,b.boot_id,b.auth_profile,b.connector_version,b.process_exited,b.configuration_digest FROM hyperfide.agent_sessions s JOIN hyperfide.native_session_bindings b ON b.organisation_id=s.organisation_id AND b.run_id=s.run_id AND b.session_id=s.id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.id=$3 FOR UPDATE OF s',[s.organisation_id,s.run_id,s.session_id]);
 if(admitted.rows.length!==1)agentError('AGENT_BINDING_NOT_FOUND');
 assertNativeRunnerScope(invocation,admitted.rows[0]!,admitted.rows[0]!);
 if(name==='reserve'){
 agentString(v.quota_key);
 // Native sub-agent delegation is not a supported, accountable launch mode.
 if(v.native_delegation!==undefined&&v.native_delegation!==false)agentError('ADMISSION_DELEGATION_UNSUPPORTED');
 const p=selected.find(p=>p.organisation_id===s.organisation_id&&p.run_id===s.run_id&&p.quota_key===v.quota_key);
 if(!p)agentError('ADMISSION_PROFILE_UNAVAILABLE');
 await assertRunPolicy(client,s,p);
 const session=admitted.rows[0] as Record<string,unknown>;
 if(session.connector!==p.connector||session.auth_profile!==p.auth_profile||session.connector_version!==p.connector_version||!['REGISTERED','RUNNING','DISCONNECTED'].includes(String(session.state)))agentError('ADMISSION_PROFILE_MISMATCH');
 const native=await getNativeSessionProfile(ctx,p.auth_profile),q=native.qualification as Record<string,unknown>;
 if(!nativeEligible(native,p,session.configuration_digest)||q.state!=='QUALIFIED'||q.live_qualified!==true||q.receipt_digest!==p.qualification_digest||
 typeof native.observed_model_id!=='string'||!native.observed_model_id||typeof native.observed_provider_id!=='string'||!native.observed_provider_id)agentError('ADMISSION_NATIVE_UNQUALIFIED');
 const policyDigest=agentDigest(p),payloadDigest=agentDigest(v);
 await client.query('INSERT INTO hyperfide.agent_admission_accounts(organisation_id,run_id,quota_key,policy_digest,max_concurrent) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[s.organisation_id,s.run_id,p.quota_key,policyDigest,p.max_concurrent]);
 const account=await client.query('SELECT * FROM hyperfide.agent_admission_accounts WHERE organisation_id=$1 AND run_id=$2 AND quota_key=$3 FOR UPDATE',[s.organisation_id,s.run_id,p.quota_key]);
 const quota=account.rows[0] as Record<string,unknown>;
 if(quota.policy_digest!==policyDigest)agentError('ADMISSION_POLICY_CHANGED');
 const previous=await client.query('SELECT * FROM hyperfide.agent_admission_reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[s.organisation_id,s.run_id,id]);
 if(previous.rows.length){
 const old=previous.rows[0] as Record<string,unknown>;
 if(old.payload_digest!==payloadDigest||old.policy_digest!==policyDigest||old.session_id!==s.session_id)agentError('ADMISSION_OPERATION_CONFLICT');
 return {reservation:old,replayed:true,grants_authority:false};
 }
 if(Number(quota.active)>=p.max_concurrent)agentError('ADMISSION_QUOTA_EXHAUSTED');
 await client.query('UPDATE hyperfide.agent_admission_accounts SET active=active+1 WHERE organisation_id=$1 AND run_id=$2 AND quota_key=$3',[s.organisation_id,s.run_id,p.quota_key]);
 const result=await client.query("INSERT INTO hyperfide.agent_admission_reservations(organisation_id,run_id,id,quota_key,session_id,payload_digest,policy_digest,state) VALUES($1,$2,$3,$4,$5,$6,$7,'RESERVED') RETURNING *",[s.organisation_id,s.run_id,id,p.quota_key,s.session_id,payloadDigest,policyDigest]);
 return {reservation:result.rows[0],permission_profile:p.permission_profile,provider:p.provider,model:p.model,qualification_digest:p.qualification_digest,run_policy_digest:p.run_policy_digest,native_delegation:false,grants_authority:false};
 }
 const found=await client.query('SELECT * FROM hyperfide.agent_admission_reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND session_id=$4 FOR UPDATE',[s.organisation_id,s.run_id,id,s.session_id]);
 if(found.rows.length!==1)agentError('ADMISSION_RESERVATION_NOT_FOUND');
 const row=found.rows[0] as Record<string,unknown>;
 if(name==='inspect')return {reservation:row,grants_authority:false};
 const history=async()=>(await client.query('SELECT * FROM hyperfide.agent_admission_escalations WHERE organisation_id=$1 AND run_id=$2 AND reservation_id=$3 ORDER BY sequence',[s.organisation_id,s.run_id,id])).rows as Record<string,unknown>[];
 if(name==='escalations'){
 const rows=await history();
 return {reservation_id:id,state:row.state,escalations:rows,open:rows.find(e=>e.state==='OPEN')??null,remaining_resolutions:Math.max(0,MAX_ADMISSION_ESCALATIONS-rows.filter(e=>e.state==='RESOLVED').length),grants_authority:false};
 }
 const p=selected.find(p=>p.organisation_id===s.organisation_id&&p.run_id===s.run_id&&p.quota_key===row.quota_key);
 if(!p||agentDigest(p)!==row.policy_digest)agentError('ADMISSION_POLICY_CHANGED');
 if(name==='context'){
 const now=await dbNow();
 const native=await getNativeSessionProfile(ctx,p.auth_profile),q=native.qualification as Record<string,unknown>;
 const eligible=nativeEligible(native,p,admitted.rows[0]?.configuration_digest)&&q.state==='QUALIFIED'&&q.live_qualified===true&&q.receipt_digest===p.qualification_digest&&typeof native.observed_model_id==='string'&&typeof native.observed_provider_id==='string';
 const events=await client.query("SELECT result FROM hyperfide.native_session_events WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3 AND result->>'kind'='ADMISSION_REPORT' AND result->>'reservation_id'=$4 ORDER BY created_at DESC,operation_id DESC LIMIT 1",[s.organisation_id,s.run_id,s.session_id,id]);
 const observation=events.rows[0]?.result as Record<string,unknown>|undefined;
 const wait=row.reason==='RATE_LIMIT'?'PROVIDER_RATE_LIMIT':row.reason==='QUOTA_LIMIT'?'MODEL_QUOTA':row.state==='RETRY_WAIT'?'RETRY_BACKOFF':row.state==='ESCALATED'?'RECONCILIATION_REQUIRED':'NONE';
 const runPolicy=await client.query('SELECT policy_digest FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[s.organisation_id,s.run_id]);
 const escalations=await history(),latest=escalations[escalations.length-1],resolution=latest?.state==='RESOLVED'?latest.resolution as Record<string,unknown>:null;
 const changeProof=resolution&&row.state!=='ESCALATED'?{escalation_id:latest!.id,sequence:latest!.sequence,previous_condition_digest:latest!.condition_digest??null,condition_digest:resolution.condition_digest,diagnostic_refs:resolution.diagnostic_refs,recorded_by_role:resolution.role}:null;
 const packet={schema_version:1,scope:s,run_policy_digest:runPolicy.rows[0]?.policy_digest??null,admission_policy_digest:row.policy_digest,run_policy_approved:runPolicy.rows[0]?.policy_digest===p.run_policy_digest,reservation_id:id,attempt_id:admitted.rows[0]?.attempt_id??null,
 policy_digest:row.policy_digest,capacity_wait:wait,capacity_retained:row.state!=='RELEASED',
 retry:{attempts_used:Number(row.attempt_count),maximum_attempts:p.max_attempts,remaining:Math.max(0,p.max_attempts-Number(row.attempt_count)),retry_after:row.retry_after===null||row.retry_after===undefined?null:new Date(String(row.retry_after)).toISOString(),
 eligible:row.state==='RETRY_WAIT'&&new Date(String(row.retry_after)).getTime()<=now&&eligible,requires_condition_change:row.state==='ESCALATED'},
 eligible_frontier_profiles:eligible?[{profile_id:p.auth_profile,connector:p.connector,connector_version:p.connector_version,provider:p.provider,requested_model_id:p.model,observed_model_id:native.observed_model_id,observed_provider_id:native.observed_provider_id,qualification_digest:p.qualification_digest}]:[],
 diagnostic_refs:observation?.diagnostic_refs??[],command_receipt_refs:observation?.command_receipt_refs??[],condition_digest:observation?.condition_digest??null,
 condition_changed_since_previous:changeProof!==null,condition_change_proof:changeProof??'UNAVAILABLE',
 escalation:{open_id:escalations.find(e=>e.state==='OPEN')?.id??null,count:escalations.length,remaining_resolutions:Math.max(0,MAX_ADMISSION_ESCALATIONS-escalations.filter(e=>e.state==='RESOLVED').length)},
 escalation_required:row.state==='ESCALATED',grants_authority:false};
 return {...packet,packet_digest:agentDigest(packet)};
 }
 const account=await client.query('SELECT * FROM hyperfide.agent_admission_accounts WHERE organisation_id=$1 AND run_id=$2 AND quota_key=$3 FOR UPDATE',[s.organisation_id,s.run_id,row.quota_key]);
 if(account.rows.length!==1)agentError('ADMISSION_PROFILE_UNAVAILABLE');
 if(!REPORT_REASONS.includes(String(reason)))agentError('AGENT_INPUT_INVALID');
 if(row.state==='RELEASED'){
 if(row.reason!==reason)agentError('ADMISSION_OPERATION_CONFLICT');
 return {reservation:row,replayed:true,grants_authority:false};
 }
 const diagnosticRefs=references(v.diagnostic_refs),commandRefs=references(v.command_receipt_refs),allRefs=[...new Set([...diagnosticRefs,...commandRefs])];
 const conditionDigest=classification?agentDigest(classification):v.condition_digest===undefined?null:agentString(v.condition_digest,'digest');
 const result=(reservation:unknown,extra:Record<string,unknown>)=>({kind:'ADMISSION_REPORT',reservation_id:id,reported_reason:reason,classification:classification??null,reservation,diagnostic_refs:diagnosticRefs,command_receipt_refs:commandRefs,condition_digest:conditionDigest,grants_authority:false,...extra});
 const operationId=agentString(v.operation_id,'uuid');
 if(reason==='CONDITION_CHANGED'){
 // Only the leader/operator plane may record a changed condition; the worker cannot re-admit itself.
 if(!['OPERATOR','COORDINATOR','LEADER'].includes(invocation.principal.role))agentError('ADMISSION_ESCALATION_ROLE_DENIED');
 if(row.state!=='ESCALATED')agentError('ADMISSION_NOT_ESCALATED');
 const escalations=await history(),open=escalations.find(e=>e.state==='OPEN');
 if(!open)agentError('ADMISSION_ESCALATION_MISSING');
 if(open.reason==='UNKNOWN_OUTCOME')agentError('ADMISSION_RECONCILIATION_REQUIRED');
 if(escalations.filter(e=>e.state==='RESOLVED').length>=MAX_ADMISSION_ESCALATIONS)agentError('ADMISSION_ESCALATION_BUDGET_EXHAUSTED');
 if(!conditionDigest||conditionDigest===open.condition_digest)agentError('ADMISSION_CONDITION_UNCHANGED');
 if(!diagnosticRefs.length)agentError('ADMISSION_DIAGNOSTICS_REQUIRED');
 await assertRunPolicy(client,s,p);
 }
 if(['COMPLETE','TERMINATED'].includes(String(reason))&&admitted.rows[0]?.process_exited!==true)agentError('AGENT_TERMINATION_UNCONFIRMED');
 if(row.state==='ESCALATED'&&reason==='UNKNOWN_OUTCOME'){
 // An unknown process outcome supersedes a retryable escalation: it must be reconciled, not retried.
 const open=(await history()).find(e=>e.state==='OPEN');
 if(open?.reason==='UNKNOWN_OUTCOME')return {reservation:row,capacity_retained:true,requires_escalation:true,grants_authority:false};
 if(open)await client.query("UPDATE hyperfide.agent_admission_escalations SET state='CLOSED',resolution=$4::jsonb,resolved_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[s.organisation_id,s.run_id,open.id,JSON.stringify({kind:'SUPERSEDED',operation_id:operationId,reason})]);
 }else if(row.state==='ESCALATED'&&!['COMPLETE','TERMINATED','CONDITION_CHANGED'].includes(String(reason)))return {reservation:row,capacity_retained:true,requires_escalation:true,grants_authority:false};
 if(allRefs.length){
 const actual=await client.query("SELECT id FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND status='COMPLETE' AND id=ANY($3::uuid[])",[s.organisation_id,s.run_id,allRefs]);
 if(actual.rows.length!==allRefs.length)agentError('ADMISSION_DIAGNOSTICS_UNAVAILABLE');
 }
 let state:string,delay=0,attempts=Number(row.attempt_count);
 if(reason==='COMPLETE'||reason==='TERMINATED')state='RELEASED';
 else if(reason==='CONDITION_CHANGED'){state='RETRY_WAIT';attempts=1;delay=p.retry_base_ms;}
 else if(reason==='RATE_LIMIT'||reason==='QUOTA_LIMIT'){
 if(row.state==='RETRY_WAIT'){
 const when=new Date(String(row.retry_after)).getTime();
 if(when>await dbNow())return {reservation:row,replayed:true,grants_authority:false};
 }
 if(attempts>=p.max_attempts)state='ESCALATED';
 else{state='RETRY_WAIT';delay=Math.min(p.retry_max_ms,p.retry_base_ms*2**(attempts-1));attempts++;}
 }else state='ESCALATED';
 // Unknown process outcomes retain capacity until reconciled. Escalation cannot admit a duplicate.
 const release=state==='RELEASED';
 if(release)await client.query('UPDATE hyperfide.agent_admission_accounts SET active=active-1 WHERE organisation_id=$1 AND run_id=$2 AND quota_key=$3',[s.organisation_id,s.run_id,row.quota_key]);
 const updated=await client.query('UPDATE hyperfide.agent_admission_reservations SET state=$4,attempt_count=$5,retry_after=CASE WHEN $6::integer>0 THEN clock_timestamp()+($6::text||\' milliseconds\')::interval ELSE NULL END,reason=$7 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING *',[s.organisation_id,s.run_id,id,state,attempts,delay,reason]);
 let escalation:unknown=null;
 if(reason==='CONDITION_CHANGED'||release&&row.state==='ESCALATED'){
 const resolution={kind:release?'RELEASED':'CONDITION_CHANGED',operation_id:operationId,actor_id:invocation.principal.actor_id,role:invocation.principal.role,condition_digest:conditionDigest,diagnostic_refs:diagnosticRefs};
 escalation=(await client.query("UPDATE hyperfide.agent_admission_escalations SET state=$4,resolution=$5::jsonb,resolved_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND reservation_id=$3 AND state='OPEN' RETURNING *",[s.organisation_id,s.run_id,id,release?'CLOSED':'RESOLVED',JSON.stringify(resolution)])).rows[0]??null;
 }else if(state==='ESCALATED'){
 const sequence=Number((await client.query('SELECT count(*)::int AS n FROM hyperfide.agent_admission_escalations WHERE organisation_id=$1 AND run_id=$2 AND reservation_id=$3',[s.organisation_id,s.run_id,id])).rows[0]!.n)+1;
 escalation=(await client.query('INSERT INTO hyperfide.agent_admission_escalations(organisation_id,run_id,id,reservation_id,session_id,sequence,reason,attempt_count,condition_digest,diagnostic_refs,raised_by_operation_id) VALUES($1,$2,gen_random_uuid(),$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *',[s.organisation_id,s.run_id,id,s.session_id,sequence,reason,attempts,conditionDigest,JSON.stringify(diagnosticRefs),operationId])).rows[0];
 }
 return result(updated.rows[0],{retry_delay_ms:delay,capacity_retained:!release,requires_escalation:state==='ESCALATED',escalation});
 };
 if(name==='report')return agentOperation(client,s,agentString(v.operation_id,'uuid'),{kind:'agent.admission.report',...v},()=>execute(String(v.reason)),invocation);
 if(name==='observe'){
 if(v.connector!=='codex'&&v.connector!=='claude')agentError('AGENT_INPUT_INVALID');
 if(JSON.stringify(v.event).length>65536)agentError('ADMISSION_SIGNAL_INVALID');
 const classification=classifyNativeEvent(v.connector,v.event);
 return agentOperation(client,s,agentString(v.operation_id,'uuid'),{kind:'agent.admission.observe',...v},async()=>{
 const reservation=(await client.query('SELECT quota_key FROM hyperfide.agent_admission_reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND session_id=$4',[s.organisation_id,s.run_id,id,s.session_id])).rows[0];
 const p=reservation&&selected.find(p=>p.organisation_id===s.organisation_id&&p.run_id===s.run_id&&p.quota_key===reservation.quota_key);
 if(p&&p.connector!==v.connector)agentError('ADMISSION_SIGNAL_CONNECTOR_MISMATCH');
 if(!classification.reason){
 // Observations without an admission consequence never become liveness or success evidence.
 if(!reservation)agentError('ADMISSION_RESERVATION_NOT_FOUND');
 return {kind:'ADMISSION_OBSERVATION',reservation_id:id,classification,reported:false,grants_authority:false};
 }
 if(!references(v.diagnostic_refs).length)agentError('ADMISSION_DIAGNOSTICS_REQUIRED');
 return {...await execute(classification.reason,classification),reported:true};
 },invocation);
 }
 return execute();
 };
 if(providedTransaction){assertPrimaryTransaction(providedTransaction);await invocation.guard(providedTransaction);return run(providedTransaction);}
 return agentTransaction(ctx,invocation,run);
 };
 const launchSelection:AgentAdmissionCapability['launchSelection']=async(tx,scope,invocation)=>{
 assertInvocation(invocation);assertPrimaryTransaction(tx);await invocation.guard(tx);
 const selected=await trusted;
 const refuse=(reason:string)=>({selection:null,reason});
 const bound=(await tx.query('SELECT s.connector,s.state,b.auth_profile,b.connector_version,b.configuration_digest,b.process_exited FROM hyperfide.agent_sessions s JOIN hyperfide.native_session_bindings b ON b.organisation_id=s.organisation_id AND b.run_id=s.run_id AND b.session_id=s.id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.id=$3 FOR SHARE OF s',[scope.organisation_id,scope.run_id,scope.session_id])).rows[0] as Record<string,unknown>|undefined;
 if(!bound)return refuse('AGENT_BINDING_NOT_FOUND');
 // Native child agents under a worker would bypass admission accounting.
 const children=await tx.query('SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND parent_session_id=$3 LIMIT 1',[scope.organisation_id,scope.run_id,scope.session_id]);
 if(children.rows.length)agentError('ADMISSION_DELEGATION_UNSUPPORTED');
 if(bound.process_exited===true||!['REGISTERED','RUNNING','DISCONNECTED'].includes(String(bound.state)))return refuse('AGENT_SESSION_NOT_LAUNCHABLE');
 const row=(await tx.query("SELECT * FROM hyperfide.agent_admission_reservations WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3 AND state IN('RESERVED','RETRY_WAIT','ESCALATED') FOR UPDATE",[scope.organisation_id,scope.run_id,scope.session_id])).rows[0] as Record<string,unknown>|undefined;
 if(!row)return refuse('ADMISSION_RESERVATION_REQUIRED');
 if(row.state==='ESCALATED')return refuse('ADMISSION_ESCALATED');
 if(row.state==='RETRY_WAIT'&&new Date(String(row.retry_after)).getTime()>new Date((await tx.query('SELECT clock_timestamp() AS now')).rows[0]!.now).getTime())return refuse('ADMISSION_RETRY_BACKOFF');
 const p=selected.find(p=>p.organisation_id===scope.organisation_id&&p.run_id===scope.run_id&&p.quota_key===row.quota_key);
 if(!p||agentDigest(p)!==row.policy_digest)return refuse('ADMISSION_POLICY_CHANGED');
 const runPolicy=await assertRunPolicy(tx,scope,p);
 // The reservation is the live-qualification witness (reserve admits only QUALIFIED profiles);
 // the frozen native configuration must still be the one that was qualified.
 const native=await getNativeSessionProfile(ctx,p.auth_profile);
 if(bound.connector!==p.connector||bound.auth_profile!==p.auth_profile||bound.connector_version!==p.connector_version||!nativeEligible(native,p,bound.configuration_digest))return refuse('ADMISSION_PROFILE_DRIFT');
 return {selection:Object.freeze({reservation_id:String(row.id),reservation_attempt:Number(row.attempt_count),policy_digest:String(row.policy_digest),run_policy_digest:runPolicy,connector:p.connector as 'codex'|'claude',connector_version:p.connector_version,provider:p.provider,model:p.model,auth_profile:p.auth_profile,permission_profile:p.permission_profile,qualification_digest:p.qualification_digest,native_delegation:false as const}),reason:null};
 };
 const component:Component={apiVersion:1,actions:{'agent.admission.reserve':action('reserve'),'agent.admission.inspect':action('inspect'),'agent.admission.report':action('report'),'agent.admission.recovery-context':action('context'),'agent.admission.observe':action('observe'),'agent.admission.escalations':action('escalations')}};
 const capability:AgentAdmissionCapability=Object.freeze({schema_version:1 as const,launchSelection,recoveryContextInTransaction:async(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext)=>{assertInvocation(invocation);assertPrimaryTransaction(tx);return action('context',tx)(input,Object.freeze({...ctx,invocation}));},recoveryContext:async(input:unknown,invocation:InvocationContext)=>{
 assertInvocation(invocation);return component.actions['agent.admission.recovery-context']!(input,Object.freeze({...ctx,invocation}));
 }});
 return Object.assign(component,{capabilities:Object.freeze({'agent.admission.v1':capability})});
}
