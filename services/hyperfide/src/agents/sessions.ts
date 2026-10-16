import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type pg from 'pg';
import {getPool} from '../storage/schema.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';

export type AgentScope={organisation_id:string;run_id:string;session_id:string};
type RecordValue=Record<string,unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST=/^sha256:[0-9a-f]{64}$/;
export function agentError(code:string):never{throw new FoundationError(code,'Native session operation refused: '+code);}
export function exactAgentObject(value:unknown,required:string[],optional:string[]=[]):RecordValue{
 if(!object(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))agentError('AGENT_INPUT_INVALID');
 return value;
}
export function agentString(value:unknown,kind:'uuid'|'digest'|'name'|'decimal'='name'):string{
 const regex=kind==='uuid'?UUID:kind==='digest'?DIGEST:kind==='decimal'?/^[1-9][0-9]{0,18}$/:/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,254}$/;
 if(typeof value!=='string'||!regex.test(value))agentError('AGENT_INPUT_INVALID');
 return value;
}
export function agentScope(value:unknown):AgentScope{
 const v=exactAgentObject(value,['organisation_id','run_id','session_id']);
 return {organisation_id:agentString(v.organisation_id,'uuid'),run_id:agentString(v.run_id,'uuid'),session_id:agentString(v.session_id,'uuid')};
}
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export function agentDigest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}
export async function agentTransaction<T>(pool:pg.Pool,callback:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
 const primary=await client.query<{recovery:boolean}>('SELECT pg_is_in_recovery() AS recovery');
 if(primary.rows[0]?.recovery)agentError('PRIMARY_REQUIRED');
 const result=await callback(client);await client.query('COMMIT');return result;
 }catch(error){try{await client.query('ROLLBACK');}catch{/* Unknown commit outcomes require exact-operation inspection. */}
 if(error instanceof FoundationError)throw error;
 const code=(error as {code?:unknown})?.code;
 if(code==='40001'||code==='40P01')agentError('AGENT_RETRY_TRANSACTION');
 if(code==='23505')agentError('AGENT_IDENTITY_CONFLICT');
 if(code==='23503')agentError('AGENT_REFERENCE_MISSING');
 if(code==='23514')agentError('AGENT_CONTRACT_VIOLATION');
 agentError('AGENT_DATABASE_OUTCOME_UNKNOWN');
 }finally{client.release();}
}
export async function getNativeSessionProfile(ctx:ComponentContext,authProfile:unknown):Promise<RecordValue>{
 if(typeof authProfile!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(authProfile))agentError('AGENT_INPUT_INVALID');
 const root=ctx.env.HF_NATIVE_AUTH_SNAPSHOT_ROOT;
 if(!root||!path.isAbsolute(root))agentError('AGENT_PROFILE_UNAVAILABLE');
 const filename=path.join(root,authProfile+'.json'),st=await fs.lstat(filename).catch(()=>undefined);
 if(!st||!st.isFile()||st.isSymbolicLink()||st.size>65536)agentError('AGENT_PROFILE_UNAVAILABLE');
 let p:unknown;try{p=JSON.parse(await fs.readFile(filename,'utf8'));}catch{agentError('AGENT_PROFILE_UNAVAILABLE');}
 if(!object(p)||p.schema_version!==1||p.profile_id!==authProfile||!object(p.binary)||!object(p.capabilities)||!object(p.qualification)||typeof p.profile_digest!=='string'||!DIGEST.test(p.profile_digest))agentError('AGENT_PROFILE_UNAVAILABLE');
 return p;
}
function profileMatches(p:RecordValue,admitted:RecordValue,b:RecordValue):void{
 if(p.connector!==admitted.connector||(p.binary as RecordValue).version!==b.connector_version||p.profile_digest!==b.configuration_digest)agentError('AGENT_PROFILE_MISMATCH');
}
const key=(s:AgentScope)=>[s.organisation_id,s.run_id,s.session_id];
async function session(client:pg.PoolClient,s:AgentScope,lock=true):Promise<RecordValue>{
 const row=await client.query('SELECT * FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3'+(lock?' FOR UPDATE':''),key(s));
 if(row.rows.length!==1)agentError('AGENT_SESSION_NOT_FOUND');return row.rows[0] as RecordValue;
}
async function binding(client:pg.PoolClient,s:AgentScope):Promise<RecordValue>{
 const row=await client.query('SELECT * FROM hyperfide.native_session_bindings WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3 FOR UPDATE',key(s));
 if(row.rows.length!==1)agentError('AGENT_BINDING_NOT_FOUND');return row.rows[0] as RecordValue;
}
export async function agentOperation(client:pg.PoolClient,s:AgentScope,id:string,payload:unknown,run:()=>Promise<RecordValue>):Promise<RecordValue>{
 // Locking the session serialises same-scope operation IDs and protects source/session binding.
 await session(client,s);
 const digest=agentDigest(payload);
 const old=await client.query('SELECT session_id,payload_digest,result FROM hyperfide.native_session_events WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[s.organisation_id,s.run_id,id]);
 if(old.rows.length){const row=old.rows[0] as RecordValue;if(row.session_id!==s.session_id||row.payload_digest!==digest)agentError('AGENT_OPERATION_CONFLICT');return row.result as RecordValue;}
 const result=await run();
 await client.query('INSERT INTO hyperfide.native_session_events(organisation_id,run_id,session_id,operation_id,payload_digest,result) VALUES($1,$2,$3,$4,$5,$6)',[...key(s),id,digest,result]);
 return result;
}
export interface AgentSessionsCapability {
 readonly schema_version:1;
 resumeCheck(input:unknown,context:ComponentContext):Promise<unknown>;
}
export function isAgentSessionsCapability(value:unknown):value is AgentSessionsCapability{
 return object(value)&&value.schema_version===1&&typeof value.resumeCheck==='function';
}
export function createComponent(ctx:ComponentContext):Component{
 const guard=(fn:(value:RecordValue)=>Promise<unknown>)=>async(input:unknown)=>{
 if(ctx.signal.aborted)agentError('AGENT_CLOSED');if(!object(input))agentError('AGENT_INPUT_INVALID');return fn(input);
 };
 const transact=<T>(fn:(client:pg.PoolClient)=>Promise<T>)=>agentTransaction(getPool(ctx.env),fn);
 const component:Component={apiVersion:1,actions:{
 'agent.session.bind':guard(async input=>{
 const v=exactAgentObject(input,['scope','binding']),s=agentScope(v.scope);
 const b=exactAgentObject(v.binding,['connector_version','auth_profile','configuration_digest','source_manifest_digest','process_id','process_start_time','boot_id','native_session_id','connector']);
 for(const k of ['connector_version','auth_profile','native_session_id','connector'])agentString(b[k]);
 for(const k of ['configuration_digest','source_manifest_digest'])agentString(b[k],'digest');
 agentString(b.boot_id,'uuid');agentString(b.process_start_time,'decimal');
 if(!Number.isSafeInteger(b.process_id)||Number(b.process_id)<1||Number(b.process_id)>2147483647||!['codex','claude'].includes(String(b.connector)))agentError('AGENT_INPUT_INVALID');
 return transact(async client=>{
 const admitted=await session(client,s);
 if(admitted.native_session_id!==b.native_session_id||admitted.connector!==b.connector)agentError('AGENT_NATIVE_ID_MISMATCH');
 profileMatches(await getNativeSessionProfile(ctx,b.auth_profile),admitted,b);
 const values=[...key(s),b.connector_version,b.auth_profile,b.configuration_digest,b.source_manifest_digest,b.process_id,b.process_start_time,b.boot_id];
 await client.query('INSERT INTO hyperfide.native_session_bindings(organisation_id,run_id,session_id,connector_version,auth_profile,configuration_digest,source_manifest_digest,process_id,process_start_time,boot_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',values);
 const actual=await binding(client,s);
 for(const k of ['connector_version','auth_profile','configuration_digest','source_manifest_digest','process_id','process_start_time','boot_id'])if(actual[k]!==b[k])agentError('AGENT_BINDING_CONFLICT');
 return {bound:true,scope:s,binding:actual,grants_authority:false};
 });
 }),
 'agent.session.inspect':guard(async input=>{
 const s=agentScope(exactAgentObject(input,['scope']).scope);
 return transact(async client=>({session:await session(client,s),binding:await binding(client,s),grants_authority:false}));
 }),
 'agent.session.transition':guard(async input=>{
 const v=exactAgentObject(input,['scope','operation_id','expected_state_version','state','process']),s=agentScope(v.scope),id=agentString(v.operation_id,'uuid'),expected=agentString(v.expected_state_version,'decimal');
 if(!['RUNNING','DISCONNECTED','STOPPED','FAILED'].includes(String(v.state)))agentError('AGENT_INPUT_INVALID');
 const p=exactAgentObject(v.process,['boot_id','process_id','process_start_time','exit_observed']);
 agentString(p.boot_id,'uuid');agentString(p.process_start_time,'decimal');
 if(typeof p.exit_observed!=='boolean'||!Number.isSafeInteger(p.process_id))agentError('AGENT_INPUT_INVALID');
 return transact(client=>agentOperation(client,s,id,v,async()=>{
 const admitted=await session(client,s),b=await binding(client,s);
 if(String(admitted.state_version)!==expected)agentError('AGENT_STATE_STALE');
 if(p.boot_id!==b.boot_id||p.process_id!==b.process_id||p.process_start_time!==b.process_start_time)agentError('AGENT_PROCESS_MISMATCH');
 const edges:Record<string,string[]>={REGISTERED:['RUNNING','FAILED','STOPPED'],RUNNING:['DISCONNECTED','STOPPED','FAILED'],DISCONNECTED:['RUNNING','STOPPED','FAILED'],STOPPED:[],FAILED:[]};
 if(!edges[String(admitted.state)]?.includes(String(v.state)))agentError('AGENT_TRANSITION_INVALID');
 if(['STOPPED','FAILED'].includes(String(v.state))&&!p.exit_observed)agentError('AGENT_TERMINATION_UNCONFIRMED');
 if(v.state==='RUNNING'&&p.exit_observed)agentError('AGENT_PROCESS_MISMATCH');
 const updated=await client.query('UPDATE hyperfide.agent_sessions SET state=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING state,state_version',[...key(s),v.state]);
 if(p.exit_observed)await client.query('UPDATE hyperfide.native_session_bindings SET process_exited=true WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3',key(s));
 return {scope:s,...updated.rows[0] as RecordValue,grants_authority:false};
 }));
 }),
 'agent.session.checkpoint':guard(async input=>{
 const v=exactAgentObject(input,['scope','operation_id','checkpoint']),s=agentScope(v.scope),id=agentString(v.operation_id,'uuid');
 const c=exactAgentObject(v.checkpoint,['checkpoint_id','checkpoint_digest','manifest_digest','source_manifest_digest','configuration_digest','native_session_id']);
 agentString(c.checkpoint_id,'uuid');agentString(c.native_session_id);for(const k of ['checkpoint_digest','manifest_digest','source_manifest_digest','configuration_digest'])agentString(c[k],'digest');
 return transact(client=>agentOperation(client,s,id,v,async()=>{
 const admitted=await session(client,s),b=await binding(client,s);
 if(c.native_session_id!==admitted.native_session_id||c.source_manifest_digest!==b.source_manifest_digest||c.configuration_digest!==b.configuration_digest)agentError('AGENT_CHECKPOINT_MISMATCH');
 const observed=await client.query('SELECT c.agent_session_id,c.support_level,a.digest,a.status FROM hyperfide.checkpoints c JOIN hyperfide.artifacts a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.id=c.artifact_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3',[s.organisation_id,s.run_id,c.checkpoint_id]);
 const row=observed.rows[0] as RecordValue|undefined;
 if(!row||row.agent_session_id!==s.session_id||row.digest!==c.checkpoint_digest||row.status!=='COMPLETE')agentError('AGENT_CHECKPOINT_UNAVAILABLE');
 await client.query('INSERT INTO hyperfide.native_session_checkpoints(organisation_id,run_id,session_id,checkpoint_id,checkpoint_digest,manifest_digest,source_manifest_digest,configuration_digest,native_session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[...key(s),c.checkpoint_id,c.checkpoint_digest,c.manifest_digest,c.source_manifest_digest,c.configuration_digest,c.native_session_id]);
 return {recorded:true,checkpoint_id:c.checkpoint_id,support_level:row.support_level,context_restored:false,grants_authority:false};
 }));
 }),
 'agent.session.resume-check':guard(async input=>{
 const v=exactAgentObject(input,['scope','checkpoint_id','native_session_id','configuration_digest','source_manifest_digest']),s=agentScope(v.scope);
 agentString(v.checkpoint_id,'uuid');agentString(v.native_session_id);agentString(v.configuration_digest,'digest');agentString(v.source_manifest_digest,'digest');
 return transact(async client=>{
 const admitted=await session(client,s),b=await binding(client,s);
 if(v.native_session_id!==admitted.native_session_id||v.configuration_digest!==b.configuration_digest||v.source_manifest_digest!==b.source_manifest_digest)agentError('AGENT_CHECKPOINT_MISMATCH');
 const found=await client.query('SELECT n.*,c.support_level,a.status AS artifact_status,a.digest AS artifact_digest FROM hyperfide.native_session_checkpoints n JOIN hyperfide.checkpoints c ON c.organisation_id=n.organisation_id AND c.run_id=n.run_id AND c.id=n.checkpoint_id JOIN hyperfide.artifacts a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.id=c.artifact_id WHERE n.organisation_id=$1 AND n.run_id=$2 AND n.session_id=$3 AND n.checkpoint_id=$4',[...key(s),v.checkpoint_id]);
 const c=found.rows[0] as RecordValue|undefined;
 if(!c||c.artifact_status!=='COMPLETE'||c.artifact_digest!==c.checkpoint_digest)agentError('AGENT_CHECKPOINT_UNAVAILABLE');
 if(c.native_session_id!==v.native_session_id||c.configuration_digest!==v.configuration_digest||c.source_manifest_digest!==v.source_manifest_digest)agentError('AGENT_CHECKPOINT_MISMATCH');
 if(!b.process_exited||!['STOPPED','FAILED'].includes(String(admitted.state)))return {decision:'RECONCILE_PROCESS',context_restored:false,grants_authority:false};
 const p=await getNativeSessionProfile(ctx,b.auth_profile);profileMatches(p,admitted,b);
 const q=p.qualification as RecordValue,cap=p.capabilities as RecordValue;
 const qualified=q.state==='QUALIFIED'&&q.live_qualified===true&&typeof q.receipt_digest==='string'&&DIGEST.test(q.receipt_digest)&&
 cap.explicit_resume===true&&cap.unattended===true&&typeof p.observed_model_id==='string'&&p.observed_model_id.length>0&&typeof p.observed_provider_id==='string'&&p.observed_provider_id.length>0;
 return {decision:c.support_level==='NATIVE_RESUME'&&qualified?'ELIGIBLE_NATIVE_CONTEXT':'FRESH_HANDOFF_REQUIRED',native_session_id:admitted.native_session_id,checkpoint_id:v.checkpoint_id,native_qualification_digest:qualified?q.receipt_digest:null,context_restored:false,grants_authority:false};
 });
 })
 }};
 const capability:AgentSessionsCapability=Object.freeze({
 schema_version:1 as const,
 resumeCheck:async(input:unknown,requestContext:ComponentContext)=>{
 if(requestContext.signal.aborted)agentError('AGENT_CLOSED');
 return await component.actions['agent.session.resume-check']!(input,requestContext);
 }});
 return Object.assign(component,{capabilities:Object.freeze({'agent.sessions.v1':capability})});
}
