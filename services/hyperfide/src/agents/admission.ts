import path from 'node:path';
import type {Component,ComponentContext} from '../components/registry.js';
import {exactAgentObject,agentString,agentScope,agentDigest,agentTransaction,agentError,getNativeSessionProfile,agentOperation,readTrustedAgentFile,assertNativeRunnerScope} from './sessions.js';
import {assertInvocation} from '../transport/protocol.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import type {InvocationContext,AuthorityTransaction} from '../transport/protocol.js';
import {object} from '../policy/programme.js';

type Policy={organisation_id:string;run_id:string;quota_key:string;connector:string;connector_version:string;provider:string;model:string;auth_profile:string;permission_profile:string;qualification_digest:string;max_concurrent:number;max_attempts:number;retry_base_ms:number;retry_max_ms:number;unattended:true;native_delegation:false};
async function policies(ctx:ComponentContext):Promise<Policy[]>{
 const filename=ctx.env.HF_AGENT_ADMISSION_POLICY_FILE;
 if(!filename||!path.isAbsolute(filename))agentError('ADMISSION_NOT_CONFIGURED');
 let value:unknown;try{value=JSON.parse((await readTrustedAgentFile(filename,131072)).toString('utf8'));}catch{agentError('ADMISSION_POLICY_INVALID');}
 const root=exactAgentObject(value,['schema_version','policies']);
 if(root.schema_version!==1||!Array.isArray(root.policies)||!root.policies.length||root.policies.length>256)agentError('ADMISSION_POLICY_INVALID');
 const seen=new Set<string>();
 return root.policies.map(entry=>{
 const p=exactAgentObject(entry,['organisation_id','run_id','quota_key','connector','connector_version','provider','model','auth_profile','permission_profile','qualification_digest','max_concurrent','max_attempts','retry_base_ms','retry_max_ms','unattended','native_delegation']);
 agentString(p.organisation_id,'uuid');agentString(p.run_id,'uuid');
 for(const k of ['quota_key','connector_version','provider','model','auth_profile','permission_profile'])agentString(p[k]);
 agentString(p.qualification_digest,'digest');
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
}
export function isAgentAdmissionCapability(value:unknown):value is AgentAdmissionCapability{
 return object(value)&&value.schema_version===1&&typeof value.recoveryContext==='function'&&typeof value.recoveryContextInTransaction==='function';
}
export function createComponent(ctx:ComponentContext):Component{
 // Frozen once per component startup. Requests cannot replace approved permission or quota policy.
 const trusted=policies(ctx);void trusted.catch(()=>{});
 const action=(name:string,providedTransaction?:PrimaryTransaction)=>async(input:unknown,requestContext:ComponentContext):Promise<unknown>=>{
 const invocation=requestContext.invocation;assertInvocation(invocation);
 if(ctx.signal.aborted)agentError('ADMISSION_CLOSED');
 const v=exactAgentObject(input,name==='reserve'?['scope','reservation_id','quota_key']:['inspect','context'].includes(name)?['scope','reservation_id']:['scope','reservation_id','operation_id','reason'],name==='report'?['diagnostic_refs','command_receipt_refs','condition_digest']:[]);
 const s=agentScope(v.scope,invocation),id=agentString(v.reservation_id,'uuid');
 const selected=await trusted;
 const run=async(client:AuthorityTransaction)=>{
 const execute=async()=>{
 const admitted=await client.query('SELECT s.connector,s.state,s.attempt_id,s.sandbox_id,s.sandbox_boot_generation,b.boot_id,b.auth_profile,b.connector_version,b.process_exited,b.configuration_digest FROM hyperfide.agent_sessions s JOIN hyperfide.native_session_bindings b ON b.organisation_id=s.organisation_id AND b.run_id=s.run_id AND b.session_id=s.id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.id=$3 FOR UPDATE OF s',[s.organisation_id,s.run_id,s.session_id]);
 if(admitted.rows.length!==1)agentError('AGENT_BINDING_NOT_FOUND');
 assertNativeRunnerScope(invocation,admitted.rows[0]!,admitted.rows[0]!);
 if(name==='reserve'){
 agentString(v.quota_key);
 const p=selected.find(p=>p.organisation_id===s.organisation_id&&p.run_id===s.run_id&&p.quota_key===v.quota_key);
 if(!p)agentError('ADMISSION_PROFILE_UNAVAILABLE');
 const session=admitted.rows[0] as Record<string,unknown>;
 if(session.connector!==p.connector||session.auth_profile!==p.auth_profile||session.connector_version!==p.connector_version||!['REGISTERED','RUNNING','DISCONNECTED'].includes(String(session.state)))agentError('ADMISSION_PROFILE_MISMATCH');
 const native=await getNativeSessionProfile(ctx,p.auth_profile),cap=native.capabilities as Record<string,unknown>,q=native.qualification as Record<string,unknown>;
 if(native.connector!==p.connector||(native.binary as Record<string,unknown>).version!==p.connector_version||native.profile_digest!==session.configuration_digest||
 native.permission_profile_id!==p.permission_profile||native.configured_provider_id!==p.provider||native.requested_model_id!==p.model||
 cap.unattended!==true||q.state!=='QUALIFIED'||q.live_qualified!==true||q.receipt_digest!==p.qualification_digest||
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
 return {reservation:result.rows[0],permission_profile:p.permission_profile,provider:p.provider,model:p.model,qualification_digest:p.qualification_digest,native_delegation:false,grants_authority:false};
 }
 const found=await client.query('SELECT * FROM hyperfide.agent_admission_reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND session_id=$4 FOR UPDATE',[s.organisation_id,s.run_id,id,s.session_id]);
 if(found.rows.length!==1)agentError('ADMISSION_RESERVATION_NOT_FOUND');
 const row=found.rows[0] as Record<string,unknown>;
 if(name==='inspect')return {reservation:row,grants_authority:false};
 const p=selected.find(p=>p.organisation_id===s.organisation_id&&p.run_id===s.run_id&&p.quota_key===row.quota_key);
 if(!p||agentDigest(p)!==row.policy_digest)agentError('ADMISSION_POLICY_CHANGED');
 if(name==='context'){
 const dbNow=new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0]!.now).getTime();
 const native=await getNativeSessionProfile(ctx,p.auth_profile),q=native.qualification as Record<string,unknown>,cap=native.capabilities as Record<string,unknown>;
 const eligible=native.connector===p.connector&&(native.binary as Record<string,unknown>).version===p.connector_version&&native.profile_digest===admitted.rows[0]?.configuration_digest&&native.permission_profile_id===p.permission_profile&&native.configured_provider_id===p.provider&&native.requested_model_id===p.model&&q.state==='QUALIFIED'&&q.live_qualified===true&&q.receipt_digest===p.qualification_digest&&cap.unattended===true&&typeof native.observed_model_id==='string'&&typeof native.observed_provider_id==='string';
 const events=await client.query("SELECT result FROM hyperfide.native_session_events WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3 AND result->>'kind'='ADMISSION_REPORT' AND result->>'reservation_id'=$4 ORDER BY created_at DESC,operation_id DESC LIMIT 1",[s.organisation_id,s.run_id,s.session_id,id]);
 const observation=events.rows[0]?.result as Record<string,unknown>|undefined;
 const wait=row.reason==='RATE_LIMIT'?'PROVIDER_RATE_LIMIT':row.reason==='QUOTA_LIMIT'?'MODEL_QUOTA':row.state==='RETRY_WAIT'?'RETRY_BACKOFF':row.state==='ESCALATED'?'RECONCILIATION_REQUIRED':'NONE';
 const runPolicy=await client.query('SELECT policy_digest FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[s.organisation_id,s.run_id]);
 const packet={schema_version:1,scope:s,run_policy_digest:runPolicy.rows[0]?.policy_digest??null,admission_policy_digest:row.policy_digest,reservation_id:id,attempt_id:admitted.rows[0]?.attempt_id??null,
 policy_digest:row.policy_digest,capacity_wait:wait,capacity_retained:row.state!=='RELEASED',
 retry:{attempts_used:Number(row.attempt_count),maximum_attempts:p.max_attempts,remaining:Math.max(0,p.max_attempts-Number(row.attempt_count)),retry_after:row.retry_after===null||row.retry_after===undefined?null:new Date(String(row.retry_after)).toISOString(),
 eligible:row.state==='RETRY_WAIT'&&new Date(String(row.retry_after)).getTime()<=dbNow&&eligible,requires_condition_change:row.state==='ESCALATED'},
 eligible_frontier_profiles:eligible?[{profile_id:p.auth_profile,connector:p.connector,connector_version:p.connector_version,provider:p.provider,requested_model_id:p.model,observed_model_id:native.observed_model_id,observed_provider_id:native.observed_provider_id,qualification_digest:p.qualification_digest}]:[],
 diagnostic_refs:observation?.diagnostic_refs??[],command_receipt_refs:observation?.command_receipt_refs??[],condition_digest:observation?.condition_digest??null,condition_changed_since_previous:false,condition_change_proof:'UNAVAILABLE',
 escalation_required:row.state==='ESCALATED',grants_authority:false};
 return {...packet,packet_digest:agentDigest(packet)};
 }
const account=await client.query('SELECT * FROM hyperfide.agent_admission_accounts WHERE organisation_id=$1 AND run_id=$2 AND quota_key=$3 FOR UPDATE',[s.organisation_id,s.run_id,row.quota_key]);
 if(account.rows.length!==1)agentError('ADMISSION_PROFILE_UNAVAILABLE');
 if(!['RATE_LIMIT','QUOTA_LIMIT','AUTH_EXPIRED','APPROVAL_REQUIRED','UNKNOWN_OUTCOME','COMPLETE','TERMINATED'].includes(String(v.reason)))agentError('AGENT_INPUT_INVALID');
 if(row.state==='RELEASED'){
 if(row.reason!==v.reason)agentError('ADMISSION_OPERATION_CONFLICT');
 return {reservation:row,replayed:true,grants_authority:false};
 }
 if(row.state==='ESCALATED'&&!['COMPLETE','TERMINATED'].includes(String(v.reason)))return {reservation:row,capacity_retained:true,requires_escalation:true,grants_authority:false};
 if(['COMPLETE','TERMINATED'].includes(String(v.reason))&&admitted.rows[0]?.process_exited!==true)agentError('AGENT_TERMINATION_UNCONFIRMED');
 const references=(value:unknown):string[]=>{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>32||new Set(value).size!==value.length)agentError('AGENT_INPUT_INVALID');
 return value.map(item=>agentString(item,'uuid'));
 };
 const diagnosticRefs=references(v.diagnostic_refs),commandRefs=references(v.command_receipt_refs),allRefs=[...new Set([...diagnosticRefs,...commandRefs])];
 if(v.condition_digest!==undefined)agentString(v.condition_digest,'digest');
 if(allRefs.length){
 const actual=await client.query("SELECT id FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND status='COMPLETE' AND id=ANY($3::uuid[])",[s.organisation_id,s.run_id,allRefs]);
 if(actual.rows.length!==allRefs.length)agentError('ADMISSION_DIAGNOSTICS_UNAVAILABLE');
 }
let state:string,delay=0,attempts=Number(row.attempt_count);
 if(v.reason==='COMPLETE'||v.reason==='TERMINATED')state='RELEASED';
 else if(v.reason==='RATE_LIMIT'||v.reason==='QUOTA_LIMIT'){
 if(row.state==='RETRY_WAIT'){
 const when=new Date(String(row.retry_after)).getTime();
 const dbNow=new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0]!.now).getTime();
 if(when>dbNow)return {reservation:row,replayed:true,grants_authority:false};
 }
 if(attempts>=p.max_attempts)state='ESCALATED';
 else{state='RETRY_WAIT';delay=Math.min(p.retry_max_ms,p.retry_base_ms*2**(attempts-1));attempts++;}
 }else state='ESCALATED';
 // Unknown process outcomes retain capacity until reconciled. Escalation cannot admit a duplicate.
 const release=state==='RELEASED';
 if(release)await client.query('UPDATE hyperfide.agent_admission_accounts SET active=active-1 WHERE organisation_id=$1 AND run_id=$2 AND quota_key=$3',[s.organisation_id,s.run_id,row.quota_key]);
 const result=await client.query('UPDATE hyperfide.agent_admission_reservations SET state=$4,attempt_count=$5,retry_after=CASE WHEN $6::integer>0 THEN clock_timestamp()+($6::text||\' milliseconds\')::interval ELSE NULL END,reason=$7 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING *',[s.organisation_id,s.run_id,id,state,attempts,delay,v.reason]);
 return {kind:'ADMISSION_REPORT',reservation_id:id,reservation:result.rows[0],diagnostic_refs:diagnosticRefs,command_receipt_refs:commandRefs,condition_digest:v.condition_digest??null,retry_delay_ms:delay,capacity_retained:!release,requires_escalation:state==='ESCALATED',grants_authority:false};
 };
 if(name==='report')return agentOperation(client,s,agentString(v.operation_id,'uuid'),{kind:'agent.admission.report',...v},execute);
 return execute();
 };
 if(providedTransaction){assertPrimaryTransaction(providedTransaction);await invocation.guard(providedTransaction);return run(providedTransaction);}
 return agentTransaction(ctx,invocation,run);
 };
 const component:Component={apiVersion:1,actions:{'agent.admission.reserve':action('reserve'),'agent.admission.inspect':action('inspect'),'agent.admission.report':action('report'),'agent.admission.recovery-context':action('context')}};
 const capability:AgentAdmissionCapability=Object.freeze({schema_version:1 as const,recoveryContextInTransaction:async(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext)=>{assertInvocation(invocation);assertPrimaryTransaction(tx);return action('context',tx)(input,Object.freeze({...ctx,invocation}));},recoveryContext:async(input:unknown,invocation:InvocationContext)=>{
 assertInvocation(invocation);return component.actions['agent.admission.recovery-context']!(input,Object.freeze({...ctx,invocation}));
 }});
 return Object.assign(component,{capabilities:Object.freeze({'agent.admission.v1':capability})});
}
