import {createHash,randomUUID} from 'node:crypto';
import type {QuerySession} from '../storage/transactions.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';


export type Data=Record<string,unknown>;
export interface Scope {organisation_id:string;run_id:string}
export interface Revision {spec_revision_id:string;spec_generation:string;state_version:string;authority_epoch:string;policy_digest:string;repositories:Data[];graph_channels:Data[];contract_revisions:Data[]}
export interface Packet {schema_version:1;id:string;purpose:string;packet_hash:string;revision:Revision;state:Data;created_at:string;expires_at:string;authority:'NONE'}
export const STATUSES=['accepted_advice','abstained','invalid_response','unsupported','expired','cancelled','unavailable','budget_exhausted'] as const;
export function fail(code:string,message:string):never {throw new FoundationError(code,message)}
export function obj(value:unknown,label='object'):Data {
 if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail('DECISION_INVALID',label+' must be an object');
 return value as Data;
}
export function exact(value:unknown,keys:string[],required=keys):Data{
 const row=obj(value);if(Object.keys(row).some(key=>!keys.includes(key))||required.some(key=>!(key in row)))fail('DECISION_INVALID','Unexpected or missing fields');return row;
}
export function str(value:unknown,label='string',max=4096):string{
 if(typeof value!=='string'||!value.length||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))fail('DECISION_INVALID','Invalid '+label);return value;
}
export function uuid(value:unknown):string{
 const result=str(value,'UUID',36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result))fail('DECISION_INVALID','Canonical UUID required');return result;
}
export function list(value:unknown,max=128):unknown[]{
 if(!Array.isArray(value)||value.length>max)fail('DECISION_INVALID','Bounded array required');return value;
}
export function canonical(value:unknown):string {
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 const data=obj(value);return '{'+Object.keys(data).sort().map(key=>JSON.stringify(key)+':'+canonical(data[key])).join(',')+'}';
}
export function digest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex')}
export function safe(value:unknown,max=524288):void{
 const visit=(item:unknown,depth:number):void=>{
  if(depth>32)fail('DECISION_INVALID','Decision nesting exceeds bound');
  if(typeof item==='string'&&(/-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+\/-]{12,}/i.test(item)))fail('DECISION_SECRET','Authentication material is excluded');
  if(Array.isArray(item)){for(const child of item)visit(child,depth+1);}
  else if(item&&typeof item==='object')for(const [key,child]of Object.entries(item)){
   if(/^(?:__proto__|prototype|constructor|password|api_key|access_token|refresh_token|private_key|authorization|cookie)$/i.test(key))fail('DECISION_SECRET','Sensitive/control field excluded');
   visit(child,depth+1);
  }
 };visit(value,0);const encoded=canonical(value);if(Buffer.byteLength(encoded)>max)fail('DECISION_TOO_LARGE','Decision data exceeds bound');
}
export function scope(value:unknown):Scope{
 const data=exact(value,['organisation_id','run_id']);return {organisation_id:uuid(data.organisation_id),run_id:uuid(data.run_id)};
}
export interface Invocation {operation:unknown;payload:{action:string;run_id:string};principal:{organisation_id:string;run_id:string;allowed_actions:string[]};signal:AbortSignal;guard(tx:QuerySession):Promise<void>}
export async function withAuthority<T>(ctx:ComponentContext,s:Scope,action:string,work:(client:QuerySession)=>Promise<T>):Promise<T>{
 const invocation=(ctx as unknown as {invocation?:Invocation}).invocation;
 if(!invocation||typeof invocation.guard!=='function')fail('AUTH_REQUIRED','Authenticated invocation required');
 if(invocation.payload?.action!==action||invocation.payload.run_id!==invocation.principal.run_id||invocation.principal.organisation_id!==s.organisation_id||invocation.principal.run_id!==s.run_id||!invocation.principal.allowed_actions.includes(action))fail('AUTH_FORBIDDEN','Invocation does not permit this scope/action');
 return ctx.resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal:invocation.signal,guard:tx=>invocation.guard(tx)},work);
}
export async function currentRevision(client:QuerySession,s:Scope):Promise<{revision:Revision;document:Data;source_digest:string;source_content:string}>{
 const result=await client.query(`SELECT r.spec_revision_id::text,r.spec_generation::text,r.state_version::text,r.authority_epoch::text,r.policy_digest,s.document,s.source_digest,s.source_content
 FROM hyperfide.runs r JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id
 WHERE r.organisation_id=$1 AND r.id=$2 FOR SHARE OF r`,[s.organisation_id,s.run_id]);
 if(result.rowCount!==1)fail('DECISION_SCOPE_UNKNOWN','Run is not visible in this scope');
 const row=result.rows[0] as Data;
 const repositories=(await client.query('SELECT repository_id::text,source_object_id,integration_ref FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 ORDER BY repository_id',[s.organisation_id,s.run_id])).rows as Data[];
 const graph_channels=(await client.query('SELECT name,manifest_id::text,publication_generation::text,state_version::text FROM hyperfide.graph_channels WHERE organisation_id=$1 AND run_id=$2 ORDER BY name LIMIT 513',[s.organisation_id,s.run_id])).rows as Data[];
 const contract_revisions=(await client.query('SELECT id::text,contract_key,revision::text,criteria_digest FROM hyperfide.contracts WHERE organisation_id=$1 AND run_id=$2 ORDER BY contract_key,revision LIMIT 513',[s.organisation_id,s.run_id])).rows as Data[];
 if(graph_channels.length>512||contract_revisions.length>512)fail('DECISION_TOO_LARGE','Revision snapshot requires a narrower qualified packet');
 return {revision:{spec_revision_id:String(row.spec_revision_id),spec_generation:String(row.spec_generation),state_version:String(row.state_version),authority_epoch:String(row.authority_epoch),policy_digest:String(row.policy_digest),repositories,graph_channels,contract_revisions},
 document:obj(row.document),source_digest:String(row.source_digest),source_content:String(row.source_content)};
}
export async function loadPacket(client:QuerySession,s:Scope,id:string,requireFresh=true):Promise<Packet>{
 const rows=await client.query('SELECT content FROM hyperfide.decision_packets WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[s.organisation_id,s.run_id,uuid(id)]);
 if(rows.rowCount!==1)fail('DECISION_NOT_FOUND','Packet is not visible');const packet=rows.rows[0]!.content as Packet;
 if(requireFresh){const current=await currentRevision(client,s);
 if(canonical(current.revision)!==canonical(packet.revision))fail('DECISION_STALE','Current primary revisions differ from packet');
 if(Date.now()>=Date.parse(packet.expires_at))fail('DECISION_EXPIRED','Packet expired');
 if(packet.purpose==='recovery'){const attempt=obj(packet.state.attempt);const rows=await client.query('SELECT state_version::text FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[s.organisation_id,s.run_id,uuid(attempt.id)]);if(rows.rowCount!==1||String(rows.rows[0]!.state_version)!==String(attempt.state_version))fail('DECISION_STALE','Attempt changed after packet');}
}return packet;
}
export async function storePacket(client:QuerySession,s:Scope,purpose:string,state:Data,id=randomUUID(),ttl=30000):Promise<Packet>{
 safe(state);const current=await currentRevision(client,s),created=new Date(),expires=new Date(created.getTime()+ttl);
 const body={schema_version:1 as const,id:uuid(id),purpose,revision:current.revision,state,created_at:created.toISOString(),expires_at:expires.toISOString(),authority:'NONE' as const};
 const packet={...body,packet_hash:digest(body)};
 await client.query('INSERT INTO hyperfide.decision_packets(organisation_id,run_id,id,purpose,packet_hash,revision,content,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[s.organisation_id,s.run_id,id,purpose,packet.packet_hash,current.revision,packet,created,expires]);return packet;
}
export function validateAudit(value:unknown):Data{
 const row=exact(value,['id','packet_id','packet_hash','rubric_version','calibration_version','adapter_version','requested_model','returned_model','route','status','raw_output','interpretation','attempts','latency_ms','usage','cost','action','rejection_reason']);
 uuid(row.id);uuid(row.packet_id);if(!/^sha256:[0-9a-f]{64}$/.test(str(row.packet_hash)))fail('DECISION_INVALID','Packet digest required');
 for(const key of ['rubric_version','adapter_version','requested_model','route'])str(row[key],key,256);
 for(const key of ['calibration_version','returned_model'])if(row[key]!==null)str(row[key],key,256);
 if(!STATUSES.includes(row.status as typeof STATUSES[number]))fail('DECISION_INVALID','Unsupported advice status');
 if(row.status==='accepted_advice'&&(row.calibration_version===null||row.returned_model===null))fail('DECISION_INVALID','Accepted advice needs known calibration and observed model');
 if(typeof row.latency_ms!=='number'||!Number.isFinite(row.latency_ms)||row.latency_ms<0)fail('DECISION_INVALID','Latency must be observed nonnegative milliseconds');
 list(row.attempts,2);obj(row.usage);obj(row.cost);obj(row.raw_output);obj(row.interpretation);
 const action=obj(row.action);if(action.authority!=='NONE'||action.applied!==false)fail('DECISION_AUTHORITY_DENIED','Audit cannot grant or apply authority');
 if(row.status!=='accepted_advice'&&action.recommendation!==null)fail('DECISION_INVALID','Abstention cannot recommend an action');
 if(row.rejection_reason!==null)str(row.rejection_reason,'reason');
 safe(row);return row;
}
export async function recordAudit(client:QuerySession,s:Scope,value:unknown):Promise<Data>{
 const row=validateAudit(value);const packet=await loadPacket(client,s,String(row.packet_id),false);
 if(packet.packet_hash!==row.packet_hash)fail('DECISION_PACKET_MISMATCH','Result does not bind this packet');
 const hash=digest(row),existing=await client.query('SELECT payload_hash,payload FROM hyperfide.decision_audits WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[s.organisation_id,s.run_id,row.id]);
 if(existing.rowCount){if(existing.rows[0]!.payload_hash!==hash)fail('DECISION_CONFLICT','Audit identity replay differs');return existing.rows[0]!.payload as Data;}
 await client.query('INSERT INTO hyperfide.decision_audits(organisation_id,run_id,id,packet_id,packet_hash,payload,payload_hash,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[s.organisation_id,s.run_id,row.id,row.packet_id,row.packet_hash,row,hash,row.status]);
 return {...row,authority:'NONE'};
}
export function input(value:unknown,fields:string[]):{scope:Scope;data:Data}{
 const data=exact(value,['scope',...fields]);return {scope:scope(data.scope),data};
}
export async function auditFor(client:QuerySession,s:Scope,id:unknown,purpose:string):Promise<{audit:Data;packet:Awaited<ReturnType<typeof loadPacket>>}>{
 const rows=await client.query('SELECT payload FROM hyperfide.decision_audits WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[s.organisation_id,s.run_id,uuid(id)]);
 if(rows.rowCount!==1)fail('DECISION_NOT_FOUND','Decision is not visible');
 const audit=obj(rows.rows[0]!.payload),packet=await loadPacket(client,s,String(audit.packet_id));
 if(packet.purpose!==purpose)fail('DECISION_PURPOSE_MISMATCH','Advice purpose differs from packet');
 return {audit,packet};
}
export async function persistProposal(client:QuerySession,s:Scope,auditId:unknown,payload:Data,state='PROPOSED_UNVALIDATED'):Promise<Data>{
 safe(payload);const id=uuid(auditId),hash=digest(payload);
 const old=await client.query('SELECT payload_hash,state FROM hyperfide.decision_proposals WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[s.organisation_id,s.run_id,id]);
 if(old.rowCount){if(old.rows[0]!.payload_hash!==hash||old.rows[0]!.state!==state)fail('DECISION_CONFLICT','Proposal replay differs');return {id,state,payload,payload_hash:hash,authority:'NONE',applied:false,replayed:true};}
 await client.query('INSERT INTO hyperfide.decision_proposals(organisation_id,run_id,id,audit_id,payload,payload_hash,state) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.organisation_id,s.run_id,id,uuid(auditId),payload,hash,state]);
 return {id,state,payload,payload_hash:hash,authority:'NONE',applied:false};
}
export interface RevisionVector {spec_revision:string;repository_commits:Record<string,string>;graph_revision:string|null;contract_revisions:Record<string,string>;event_watermark:string;ownership_generation:string|null}
export function registerAdvisoryPurpose(ctx:ComponentContext,purpose:string,check?:(tx:QuerySession,s:Scope,packet:Packet,invocation:Invocation)=>Promise<void>):void{
 type Loader={load(tx:QuerySession,invocation:Invocation,value:unknown):Promise<{packet:Packet;request:Data;rubric_version:string}>;current(tx:QuerySession,s:Scope,packet:Packet,invocation:Invocation):Promise<RevisionVector>};
 const jobs=ctx.dependencies.require('20.4','decision.jobs.v1',(value:unknown):value is {registerPurpose(purpose:string,loader:Loader):void}=>!!value&&typeof value==='object'&&typeof(value as {registerPurpose?:unknown}).registerPurpose==='function');
 jobs.registerPurpose(purpose,{
  load:async(tx,invocation,value)=>{const s=scope({organisation_id:invocation.principal.organisation_id,run_id:invocation.principal.run_id});await invocation.guard(tx);
   const ref=exact(value,['packet_id']),packet=await loadPacket(tx,s,uuid(ref.packet_id));
   if(packet.purpose!==purpose)fail('DECISION_PURPOSE_MISMATCH','Job purpose differs from server packet');if(check)await check(tx,s,packet,invocation);
   const {questions,...state}=packet.state;return {packet,request:{state,questions:obj(questions)},rubric_version:'hyperfide.'+purpose+'.v1'};},
  current:async(tx,s,packet,invocation)=>{await invocation.guard(tx);if(invocation.principal.organisation_id!==s.organisation_id||invocation.principal.run_id!==s.run_id)fail('AUTH_FORBIDDEN','Current job scope differs from verified invocation');const fresh=await loadPacket(tx,s,packet.id);if(check)await check(tx,s,fresh,invocation);const current=(await currentRevision(tx,s)).revision;
   return {spec_revision:current.spec_revision_id,repository_commits:Object.fromEntries(current.repositories.map(row=>[String(row.repository_id),String(row.source_object_id)])),
    graph_revision:current.graph_channels.length?digest(current.graph_channels):null,contract_revisions:Object.fromEntries(current.contract_revisions.map(row=>[String(row.id),String(row.revision)])),
    event_watermark:digest({kind:'PRIMARY_RELEVANT_STATE_FINGERPRINT',revision:current,purpose,packet_state:fresh.state}),ownership_generation:current.state_version};}
 });
}
export function answers(value:unknown):Data{
 const result=exact(value,['answers','non_authoritative']);if(result.non_authoritative!==true)fail('DECISION_INVALID','Typed advice must be non authoritative');return obj(result.answers);
}
export function noul(value:unknown):number{
 const answer=obj(value);if(answer.type!=='noul'||typeof answer.value!=='number'||!Number.isFinite(answer.value)||answer.value<0||answer.value>1)fail('DECISION_INVALID','Validated Noul answer required');return answer.value;
}
export function createComponent(ctx:ComponentContext):Component{

 return {apiVersion:1,actions:{
 'decision.audit.describe':()=>({schema_version:1,authority:'NONE',append_only:true,raw_payload_retention:'bounded_json',full_case_qualification:'UNRUN'}),
 'decision.audit.capture':async (value,ctx)=>{const q=input(value,['decision_id','packet_id']);return withAuthority(ctx,q.scope,'decision.audit.capture',async client=>{
  const packet=await loadPacket(client,q.scope,uuid(q.data.packet_id),false);
  const jobs=ctx.dependencies.require('20.4','decision.jobs.v1',(value:unknown):value is {completedAudit(tx:QuerySession,scope:Scope,reference:{decision_id:string;packet_hash:string},invocation:Invocation):Promise<{available:boolean;payload?:unknown;reason?:string}>}=>!!value&&typeof value==='object'&&typeof(value as {completedAudit?:unknown}).completedAudit==='function');
  const result=await jobs.completedAudit(client,q.scope,{decision_id:uuid(q.data.decision_id),packet_hash:packet.packet_hash},(ctx as unknown as {invocation:Invocation}).invocation);
  if(!result.available)fail('DECISION_RESULT_UNAVAILABLE','Completed decision is '+String(result.reason));
  const raw=exact(result.payload,['decision_id','packet_hash','rubric_version','calibration_version','adapter_version','requested_model','returned_model','route','status','raw_output','interpretation','attempts','latency_ms','usage','cost','rejection_reason','authority']);
  if(raw.authority!=='NONE'||raw.decision_id!==q.data.decision_id||raw.packet_hash!==packet.packet_hash)fail('DECISION_PACKET_MISMATCH','Trusted job returned different identity');
  const {decision_id,authority,...fields}=raw;
  return recordAudit(client,q.scope,{...fields,id:decision_id,packet_id:packet.id,action:{authority:'NONE',applied:false,recommendation:raw.status==='accepted_advice'?raw.interpretation:null}});
 });},
 'decision.audit.record':async (value,ctx)=>{const q=input(value,['record']);if(obj(q.data.record).status==='accepted_advice')fail('DECISION_RESULT_REQUIRED','Accepted advice requires the trusted decision job audit sink, never wire assertions');return withAuthority(ctx,q.scope,'decision.audit.record',client=>recordAudit(client,q.scope,q.data.record));},
 'decision.audit.inspect':async (value,ctx)=>{const q=input(value,['id']);return withAuthority(ctx,q.scope,'decision.audit.inspect',async client=>{
 const rows=await client.query('SELECT payload,payload_hash,created_at FROM hyperfide.decision_audits WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[q.scope.organisation_id,q.scope.run_id,uuid(q.data.id)]);
 if(rows.rowCount!==1)fail('DECISION_NOT_FOUND','Audit is not visible');
 const outcomes=await client.query('SELECT id,payload,payload_hash,created_at FROM hyperfide.decision_outcomes WHERE organisation_id=$1 AND run_id=$2 AND audit_id=$3 ORDER BY created_at,id',[q.scope.organisation_id,q.scope.run_id,q.data.id]);
 return {...rows.rows[0],outcomes:outcomes.rows,authority:'NONE'};});},
 'decision.audit.outcome':async (value,ctx)=>{const q=input(value,['id','audit_id','outcome']);uuid(q.data.id);uuid(q.data.audit_id);
 const outcome=exact(q.data.outcome,['observed_kind','source_id','source_digest','occurred_at','action_taken','details']);
 if(!['task','repair','verification','policy_rejection','usage_reconciliation'].includes(str(outcome.observed_kind)))fail('DECISION_INVALID','Unknown outcome kind');
 str(outcome.source_id);if(!/^sha256:[0-9a-f]{64}$/.test(str(outcome.source_digest)))fail('DECISION_INVALID','Outcome source digest required');
 if(!Number.isFinite(Date.parse(str(outcome.occurred_at))))fail('DECISION_INVALID','Observed time required');safe(outcome,131072);
 return withAuthority(ctx,q.scope,'decision.audit.outcome',async client=>{const hash=digest(outcome),old=await client.query('SELECT payload_hash FROM hyperfide.decision_outcomes WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[q.scope.organisation_id,q.scope.run_id,q.data.id]);
 if(old.rowCount){if(old.rows[0]!.payload_hash!==hash)fail('DECISION_CONFLICT','Outcome replay differs');return {id:q.data.id,replayed:true,authority:'NONE'};}
 await client.query('INSERT INTO hyperfide.decision_outcomes(organisation_id,run_id,id,audit_id,payload,payload_hash) VALUES($1,$2,$3,$4,$5,$6)',[q.scope.organisation_id,q.scope.run_id,q.data.id,q.data.audit_id,outcome,hash]);
 return {id:q.data.id,replayed:false,authority:'NONE'};});}
 }};
}
