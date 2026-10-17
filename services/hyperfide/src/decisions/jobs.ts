import {randomUUID,sign,createPrivateKey} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {assertInvocation,UUID} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction,TransactionGateway} from '../storage/transactions.js';
import {readSemanticDisposition,writeSemanticDisposition} from '../storage/dispositions.js';
import type {enqueue,claimPending,acknowledge} from '../events/outbox.js';
import type {receive} from '../events/inbox.js';
import {canonical,configuredTransport,DecisionError,exact,fail,hash,integer,record,route,strictJson,text} from './adapters.js';
import {prepareCapabilities,billing} from './capabilities.js';
import {evaluatePreparedDecision,parseIdentity,assertValidatedDecision} from './results.js';
import type {RevisionVector,ValidatedDecision} from './results.js';

export interface Scope{organisation_id:string;run_id:string}
export interface DecisionPacket{schema_version:1;id:string;purpose:string;revision:RevisionVector;state:unknown;created_at:string;expires_at:string;authority:'NONE'}
export interface PurposeLoader {
 load(tx:PrimaryTransaction,invocation:InvocationContext,input:unknown):Promise<{packet:DecisionPacket;request:unknown;rubric_version:string}>;
 current(tx:PrimaryTransaction,scope:Scope,packet:DecisionPacket,invocation:InvocationContext):Promise<RevisionVector>;
}
type Outbox={enqueue:typeof enqueue;claimPending:typeof claimPending;acknowledge:typeof acknowledge};
type Inbox={receive:typeof receive};
interface JobPolicy{
 schema_version:1;revision:string;allowed_purposes:Record<string,string[]>;consumers:Record<string,string>;quota_groups:Record<string,string>;
 max_active:number;max_queued:number;requests_per_minute:number;circuit_failures:number;circuit_cooldown_ms:number;max_job_cost_microusd:number;
}
interface JobRow extends Scope{
 id:string;purpose:string;packet_hash:string;packet:DecisionPacket;request:unknown;rubric_version:string;route_ids:string[];
 policy_revision:string;consumer_id:string;event_id:string;state:string;deadline_at:Date;lease_id:string|null;reserved_microusd:string;mode:string;remaining_ms:string;lease_live:boolean;
}
function uuid(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))fail('DECISION_SCHEMA','Canonical UUID required');return value as string;}
function scoped(i:InvocationContext):Scope{assertInvocation(i);return{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};}
function policy(env:Readonly<NodeJS.ProcessEnv>):JobPolicy{
 const p=record(env.HYPERFIDE_DECISION_JOB_POLICY?strictJson(env.HYPERFIDE_DECISION_JOB_POLICY):null,'decision job policy');
 exact(p,['schema_version','revision','allowed_purposes','consumers','quota_groups','max_active','max_queued','requests_per_minute','circuit_failures','circuit_cooldown_ms','max_job_cost_microusd'],
 ['schema_version','revision','allowed_purposes','consumers','quota_groups','max_active','max_queued','requests_per_minute','circuit_failures','circuit_cooldown_ms','max_job_cost_microusd']);
 if(p.schema_version!==1)fail('DECISION_SCHEMA','Unsupported job policy');
 text(p.revision,'job policy revision',128);
 for(const [purpose,ids]of Object.entries(record(p.allowed_purposes,'egress allow-list'))){
  text(purpose,'purpose',128);if(!Array.isArray(ids)||!ids.length||ids.some(id=>{route(id);return false;}))fail('DECISION_SCHEMA','Purpose requires explicit route permission');
 }
 for(const [run,id]of Object.entries(record(p.consumers,'standing consumers'))){uuid(run);uuid(id);}
 for(const [id,group]of Object.entries(record(p.quota_groups,'account quota groups'))){route(id);if(typeof group!=='string'||!/^[A-Za-z][A-Za-z0-9._/-]{0,127}$/.test(group))fail('DECISION_SCHEMA','Bounded account quota group required');}
 integer(p.max_active,'active limit',1,16);integer(p.max_queued,'queue limit',0,256);
 integer(p.requests_per_minute,'route rate',1,100000);integer(p.circuit_failures,'circuit failure threshold',1,100);
 integer(p.circuit_cooldown_ms,'circuit cooldown',1,300000);integer(p.max_job_cost_microusd,'cost bound',0,1000000000);
 return p as unknown as JobPolicy;
}
function packet(value:unknown,purpose:string):DecisionPacket{
 const p=record(value,'trusted packet');exact(p,['schema_version','id','purpose','revision','state','created_at','expires_at','authority'],['schema_version','id','purpose','revision','state','created_at','expires_at','authority']);
 if(p.schema_version!==1||p.authority!=='NONE'||p.purpose!==purpose)fail('DECISION_SCHEMA','Packet authority/purpose differs');
 uuid(p.id);for(const key of ['created_at','expires_at'])if(typeof p[key]!=='string'||new Date(p[key] as string).toISOString()!==p[key])fail('DECISION_SCHEMA','Canonical packet time required');
 if(Date.parse(p.expires_at as string)<=Date.parse(p.created_at as string))fail('DECISION_EXPIRED','Packet time interval invalid');
 const identity=parseIdentity({decision_id:p.id,packet_hash:hash(p),purpose,rubric_version:'packet-shape',revision:p.revision});void identity;
 if(Buffer.byteLength(canonical(p))>196608)fail('DECISION_LIMIT','Retained packet exceeds replay bound');
 return JSON.parse(canonical(p)) as DecisionPacket;
}
function sameRevision(a:unknown,b:unknown):boolean{return canonical(a)===canonical(b);}
const scopeValues=(s:Scope):string[]=>[s.organisation_id,s.run_id];
const allowedRoles=['OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR'];
export class DecisionJobs{
 private readonly purposes=new Map<string,PurposeLoader>();
 private readonly controllers=new Map<string,AbortController>();
 private closed=false;
 constructor(private readonly g:TransactionGateway,private readonly outbox:Outbox,private readonly inbox:Inbox,private readonly env:Readonly<NodeJS.ProcessEnv>,private readonly shutdown:AbortSignal){}
 registerPurpose(purpose:string,loader:PurposeLoader):void{
  text(purpose,'purpose',128);
  if(this.closed||this.purposes.has(purpose)||typeof loader.load!=='function'||typeof loader.current!=='function')fail('DECISION_SCHEMA','Purpose loader unavailable or duplicate');
  this.purposes.set(purpose,Object.freeze({load:loader.load.bind(loader),current:loader.current.bind(loader)}));
 }
 private loader(purpose:string):PurposeLoader{
  const found=this.purposes.get(purpose);if(!found)fail('DECISION_UNSUPPORTED','No trusted purpose loader is registered');return found!;
 }
 private async guard(i:InvocationContext,tx:PrimaryTransaction,mode:'READ'|'WRITE'):Promise<void>{
  const s=scoped(i);
  // The shared generation fence must precede principal/run SHARE guards.
  await(mode==='WRITE'?writeSemanticDisposition(tx,s):readSemanticDisposition(tx,s));
  await i.guard(tx);
 }
 private async tx<T>(i:InvocationContext,fn:(tx:PrimaryTransaction)=>Promise<T>,timeoutMs=5000,mode:'READ'|'WRITE'='WRITE'):Promise<T>{
  scoped(i);if(!allowedRoles.includes(i.principal.role))fail('AUTH_SCOPE_DENIED','Role cannot operate decision jobs');
  if(this.closed)fail('DECISION_UNAVAILABLE','Decision jobs are closed');
  return this.g.withPrimaryTransaction({timeoutMs,signal:i.signal,guard:tx=>this.guard(i,tx,mode)},fn);
 }
 private async lock(tx:PrimaryTransaction,s:Scope):Promise<void>{
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[s.organisation_id+':decision-admission']);
 }
 private async row(tx:PrimaryTransaction,s:Scope,id:string):Promise<JobRow>{
  const q=await tx.query('SELECT *,extract(epoch FROM (deadline_at-clock_timestamp()))*1000 AS remaining_ms,lease_expires_at>clock_timestamp() AS lease_live FROM hyperfide.decision_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...scopeValues(s),id]);
  if(q.rowCount!==1)fail('DECISION_NOT_FOUND','Decision job absent in authenticated scope');return q.rows[0] as JobRow;
 }
 private async fresh(tx:PrimaryTransaction,s:Scope,j:JobRow,i:InvocationContext):Promise<void>{
  if(!(await tx.query('SELECT $1::timestamptz>clock_timestamp() AS fresh',[j.packet.expires_at])).rows[0]!.fresh)fail('DECISION_EXPIRED','Stored packet expired');
  if(!sameRevision(j.packet.revision,await this.loader(j.purpose).current(tx,s,j.packet,i)))fail('DECISION_STALE','Primary relevant state changed');
 }
 async submit(i:InvocationContext,raw:unknown):Promise<unknown>{
  const admissionStarted=performance.now();
  const s=scoped(i),v=record(raw,'decision submission');exact(v,['purpose','input','route_ids','deadline_ms','mode'],['purpose','input','route_ids','deadline_ms','mode']);
  const purpose=text(v.purpose,'purpose',128),p=policy(this.env),loader=this.loader(purpose);
  if(!Array.isArray(v.route_ids)||v.route_ids.length<1||v.route_ids.length>2||new Set(v.route_ids).size!==v.route_ids.length)fail('DECISION_SCHEMA','One or two distinct routes required');
  const routes=(v.route_ids as unknown[]).map(id=>route(id).id);
  if(!['online','background'].includes(String(v.mode)))fail('DECISION_SCHEMA','Unknown deadline class');
  const duration=integer(v.deadline_ms,'total job deadline',1,v.mode==='online'?2000:30000),id=randomUUID(),eventId=randomUUID();
  const submissionHash=hash({purpose,input:v.input,route_ids:routes,mode:v.mode,deadline_ms:duration});
  const admissionBudget=Math.floor(duration-(performance.now()-admissionStarted));
  if(admissionBudget<=0)fail('DECISION_EXPIRED','Request validation consumed the total job deadline');
  return this.tx(i,async tx=>{
   await this.lock(tx,s);
   const old=await tx.query('SELECT id,submission_hash,state FROM hyperfide.decision_jobs WHERE organisation_id=$1 AND run_id=$2 AND idempotency_key=$3',[...scopeValues(s),i.operation.idempotency_key]);
   if(old.rowCount){if(old.rows[0]!.submission_hash!==submissionHash)fail('DECISION_IDEMPOTENCY_CONFLICT','Job replay changed the original submission');return{decision_id:old.rows[0]!.id,state:old.rows[0]!.state,replayed:true,authority:'NONE'};}
   if(routes.some(id=>!p.allowed_purposes[purpose]?.includes(id)))fail('DECISION_EGRESS_DENIED','Purpose is not permitted on every requested/fallback route');
   const consumer=uuid(p.consumers[s.run_id]);
   const loaded=await loader.load(tx,i,v.input);exact(record(loaded,'purpose loader result'),['packet','request','rubric_version'],['packet','request','rubric_version']);
   const pack=packet(loaded.packet,purpose),packetHash=hash(pack);
   if(!(await tx.query('SELECT $1::timestamptz<=clock_timestamp() AND $2::timestamptz>clock_timestamp() AS fresh',[pack.created_at,pack.expires_at])).rows[0]!.fresh)fail('DECISION_EXPIRED','Packet is not currently valid at primary');
   const request=JSON.parse(canonical(loaded.request)) as unknown,rubric=text(loaded.rubric_version,'rubric version',128);
   if(!sameRevision(pack.revision,await loader.current(tx,s,pack,i)))fail('DECISION_STALE','Packet was stale at admission');
   const digest=hash({packet:pack,request,rubric,route_ids:routes,mode:v.mode,deadline_ms:duration});
   const count=await tx.query("SELECT count(*)::int AS n FROM hyperfide.decision_jobs WHERE organisation_id=$1 AND state='QUEUED' AND deadline_at>clock_timestamp()",[s.organisation_id]);
   if(count.rows[0]!.n>=p.max_queued)fail('DECISION_OVERLOADED','Bounded decision queue is full');
   const standing=await tx.query("SELECT 1 FROM hyperfide.event_consumers WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='ACTIVE'",[...scopeValues(s),consumer]);
   if(standing.rowCount!==1)fail('DECISION_UNAVAILABLE','Configured decision admission consumer is not standing');
   await this.outbox.enqueue(tx,{...s,id:eventId,aggregate_type:'decision.job',aggregate_id:id,aggregate_version:'1',event_type:'decision.admitted',payload:{decision_id:id,packet_hash:packetHash}},{consumer_ids:[consumer]});
   const applied=await this.inbox.receive(tx,{...s,event_id:eventId,consumer_id:consumer},async()=>{
    const remaining=Math.floor(duration-(performance.now()-admissionStarted));
    if(remaining<=0)fail('DECISION_EXPIRED','Admission consumed the total job deadline');
    await tx.query(`INSERT INTO hyperfide.decision_jobs(organisation_id,run_id,id,idempotency_key,submission_hash,request_hash,purpose,packet_hash,packet,request,rubric_version,route_ids,policy_revision,consumer_id,event_id,mode,deadline_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,least(clock_timestamp()+($17::int*interval '1 millisecond'),$18::timestamptz))`,
     [...scopeValues(s),id,i.operation.idempotency_key,submissionHash,digest,purpose,packetHash,canonical(pack),canonical(request),rubric,canonical(routes),p.revision,consumer,eventId,v.mode,remaining,pack.expires_at]);
    return{decision_id:id};
   });
   if(applied.status!=='APPLIED')fail('DECISION_IDEMPOTENCY_CONFLICT','New admission did not apply once');
   return{decision_id:id,state:'QUEUED',replayed:false,authority:'NONE'};
  },admissionBudget);
 }
 async status(i:InvocationContext,raw:unknown):Promise<unknown>{
  const v=record(raw,'status');exact(v,['decision_id'],['decision_id']);const id=uuid(v.decision_id),s=scoped(i);
  return this.tx(i,async tx=>{
   const j=await this.row(tx,s,id),result=await tx.query('SELECT status,payload FROM hyperfide.decision_results WHERE organisation_id=$1 AND run_id=$2 AND decision_id=$3',[...scopeValues(s),id]);
   const attempts=await tx.query('SELECT attempt_no,route,requested_model,started_at,finished_at,outcome,metadata FROM hyperfide.decision_attempts WHERE organisation_id=$1 AND run_id=$2 AND decision_id=$3 ORDER BY attempt_no',[...scopeValues(s),id]);
   return{decision_id:id,state:j.state,packet_hash:j.packet_hash,deadline_at:j.deadline_at,result:result.rows[0]??null,attempts:attempts.rows,authority:'NONE'};
  },5000,'READ');
 }
 async cancel(i:InvocationContext,raw:unknown):Promise<unknown>{
  const v=record(raw,'cancel');exact(v,['decision_id'],['decision_id']);const id=uuid(v.decision_id),s=scoped(i);
  const result=await this.tx(i,async tx=>{
   const j=await this.row(tx,s,id);
   if(['QUEUED','RUNNING'].includes(j.state)){await this.finish(tx,s,j,'cancelled','cancelled-by-authenticated-principal',null);return{cancelled:true,authority:'NONE'};}
   return{cancelled:j.state==='CANCELLED',already_terminal:true,authority:'NONE'};
  });
  this.controllers.get(id)?.abort();return result;
 }
 private async attempts(tx:PrimaryTransaction,s:Scope,id:string):Promise<Record<string,unknown>[]>{
  return(await tx.query('SELECT attempt_no,route,requested_model,started_at,finished_at,outcome,metadata FROM hyperfide.decision_attempts WHERE organisation_id=$1 AND run_id=$2 AND decision_id=$3 ORDER BY attempt_no',[...scopeValues(s),id])).rows.map(r=>({...r,started_at:r.started_at instanceof Date?r.started_at.toISOString():r.started_at,finished_at:r.finished_at instanceof Date?r.finished_at.toISOString():r.finished_at}));
 }
 private receipt(j:JobRow,decision:ValidatedDecision,attempts:number,finalStatus:string):unknown{
  if(!this.env.HYPERFIDE_DECISION_SIGNER)return{available:false,reason:'trusted-signer-unconfigured'};
  const config=record(strictJson(this.env.HYPERFIDE_DECISION_SIGNER),'signer');exact(config,['key_id','private_key_env','evidence_class'],['key_id','private_key_env','evidence_class']);
  const evidence=decision.transport.qualification==='fixture'?'synthetic':'live';
  if(config.evidence_class!==evidence)return{available:false,reason:'signer-evidence-class-mismatch'};
  const keyEnv=text(config.private_key_env,'signer key reference',128);
  if(!/^[A-Z][A-Z0-9_]{2,127}$/.test(keyEnv)||!this.env[keyEnv])return{available:false,reason:'signer-key-unavailable'};
  const answers=Object.values(decision.answers),answer=answers.length===1?answers[0]:undefined;
  const payload={case_id:j.packet.id,packet_digest:j.packet_hash,profile:{id:j.purpose+':'+decision.route_id,model:decision.returned_model,route:decision.route_id,purpose:j.purpose,rubric:hash(record(j.request,'request').questions)},
    probabilities:answer?.normalized_probabilities??null,decision:typeof answer?.value==='string'?answer.value:null,
    status:finalStatus==='accepted_advice'?'ok':'abstained',latency_ms:decision.transport.duration_ms,attempts,
    input_tokens:typeof decision.usage.input_tokens==='number'?decision.usage.input_tokens:null,cost_microusd:null,usage_class:'actual'};
  const body={schema_version:1,kind:'prediction_observation',evidence_class:evidence,observed_at:new Date().toISOString(),subject_digest:hash(payload),payload};
  try{return{available:true,envelope:{key_id:text(config.key_id,'signer id',128),signature:sign(null,Buffer.from(canonical(body)),createPrivateKey(this.env[keyEnv]!)).toString('base64'),body}};}
  catch{return{available:false,reason:'signer-failed'};}
 }
 async replay(i:InvocationContext,raw:unknown):Promise<unknown>{
  const v=record(raw,'replay');exact(v,['decision_id','part','attempt_no'],['decision_id','part']);
  const id=uuid(v.decision_id),s=scoped(i);
  if(!['packet','attempt'].includes(String(v.part)))fail('DECISION_SCHEMA','Unknown replay part');
  const number=v.part==='attempt'?integer(v.attempt_no,'attempt number',1,2):null;
  if(v.part==='packet'&&v.attempt_no!==undefined)fail('DECISION_SCHEMA','Packet replay has no attempt number');
  return this.tx(i,async tx=>{
   const job=await this.row(tx,s,id);
   if(v.part==='packet')return{schema_version:1,decision_id:id,packet_hash:job.packet_hash,packet:job.packet,rubric_version:job.rubric_version,authority:'NONE'};
   const row=(await tx.query('SELECT request_body,request_headers,configuration,metadata,outcome FROM hyperfide.decision_attempts WHERE organisation_id=$1 AND run_id=$2 AND decision_id=$3 AND attempt_no=$4',[...scopeValues(s),id,number])).rows[0];
   if(!row)return{available:false,reason:'attempt-not-found',authority:'NONE'};
   const result=(await tx.query('SELECT payload FROM hyperfide.decision_results WHERE organisation_id=$1 AND run_id=$2 AND decision_id=$3',[...scopeValues(s),id])).rows[0]?.payload as Record<string,unknown>|undefined;
   const rawOutput=result?.raw_output;
   const retained=rawOutput!==undefined&&object(row.metadata)&&row.metadata.response_hash===hash(rawOutput);
   return{schema_version:1,decision_id:id,packet_hash:job.packet_hash,attempt_no:number,request:{body:row.request_body,headers:row.request_headers,hash:hash(row.request_body)},
    configuration:row.configuration,outcome:row.outcome,response:retained?{available:true,body:rawOutput,hash:hash(rawOutput)}:{available:false,reason:'provider-response-not-retained'},authority:'NONE'};
  },5000,'READ');
 }
 private async finish(tx:PrimaryTransaction,s:Scope,j:JobRow,status:string,reason:string|null,decision:ValidatedDecision|null):Promise<void>{
  const attempts=await this.attempts(tx,s,j.id),last=attempts.at(-1);
  const payload={decision_id:j.id,packet_hash:j.packet_hash,rubric_version:j.rubric_version,calibration_version:decision?.calibration_version??null,adapter_version:'decision-adapters-v1',
   requested_model:decision?.requested_model??last?.requested_model??route(j.route_ids[0]).model,returned_model:decision?.returned_model??null,
   route:decision?.route_id??last?.route??j.route_ids[0],status,raw_output:decision?.raw_response??{available:false,reason:reason??'no-provider-response'},
   interpretation:{answers:decision?.answers??{},non_authoritative:true},attempts,latency_ms:attempts.reduce((n,a)=>n+Number((a.metadata as Record<string,unknown>|null)?.duration_ms??0),0),
   usage:decision?{class:'actual',...decision.usage}:{class:'unknown',input_tokens:null,output_tokens:null},
   cost:{class:'unknown',usd:null,reserved_microusd:Number(j.reserved_microusd),invoice_reconciled:false},rejection_reason:reason,authority:'NONE',fallback:status==='accepted_advice'?null:{policy:'deterministic',reason:reason??status},
   evaluation_receipt:decision?this.receipt(j,decision,attempts.length,status):{available:false,reason:'no-validated-result'}};
  if(Buffer.byteLength(canonical(payload))>190000)fail('DECISION_LIMIT','Audit payload exceeds bounded replay storage');
  await tx.query('INSERT INTO hyperfide.decision_results(organisation_id,run_id,decision_id,packet_hash,status,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING',[...scopeValues(s),j.id,j.packet_hash,status,canonical(payload)]);
  const state=status==='cancelled'?'CANCELLED':status==='expired'?'EXPIRED':'COMPLETED';
  await tx.query('UPDATE hyperfide.decision_jobs SET state=$4,lease_id=NULL,lease_expires_at=NULL,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...scopeValues(s),j.id,state]);
 }
 async process(i:InvocationContext,raw:unknown):Promise<unknown>{
  const v=record(raw,'process');exact(v,['decision_id'],['decision_id']);const id=uuid(v.decision_id),s=scoped(i),p=policy(this.env);
  if(!['OPERATOR','COORDINATOR'].includes(i.principal.role))fail('AUTH_SCOPE_DENIED','Only coordinator may dispatch decision work');
  const sampledAt=performance.now();
  const initialRemaining=await this.tx(i,async tx=>Number((await this.row(tx,s,id)).remaining_ms),5000,'READ');
  const processDeadline=sampledAt+Math.max(0,initialRemaining);
  const databaseTimeout=()=>Math.max(1,Math.min(5000,Math.floor(processDeadline-performance.now())));
  const lease=randomUUID();
  const job=await this.tx(i,async tx=>{
   await this.lock(tx,s);const j=await this.row(tx,s,id);
   if(['COMPLETED','CANCELLED','EXPIRED'].includes(j.state))return null;
   if(Number(j.remaining_ms)<=0){await this.finish(tx,s,j,'expired','queue-or-total-deadline',null);return null;}
   if(j.state==='RUNNING'&&j.lease_id&&j.lease_live)fail('DECISION_BUSY','Job already has a live dispatcher');
   if(j.policy_revision!==p.revision){await this.finish(tx,s,j,'abstained','job-policy-revision-changed',null);return null;}
   try{await this.fresh(tx,s,j,i);}catch(error){await this.finish(tx,s,j,'abstained',error instanceof DecisionError?error.code:'freshness-unavailable',null);return null;}
   const active=await tx.query("SELECT count(*)::int AS n FROM hyperfide.decision_jobs WHERE organisation_id=$1 AND state='RUNNING' AND lease_expires_at>clock_timestamp()",[s.organisation_id]);
   if(active.rows[0]!.n>=p.max_active)fail('DECISION_OVERLOADED','Bounded active decision capacity reached');
   const claims=await this.outbox.claimPending(tx,{...s,consumer_id:j.consumer_id,limit:64,lease_ms:30000});
   for(const claim of claims){
    // Core-loop events fan out to every standing consumer; the advisory consumer records them without effect so they never wedge dispatch.
    if(claim.aggregate_type!=='decision.job'||claim.event_type!=='decision.admitted'){
     if(claim.aggregate_type==='attempt.instructions')continue;
     const foreign=await this.inbox.receive(tx,{...s,event_id:claim.id,consumer_id:claim.consumer_id});
     if((foreign.status==='APPLIED'||foreign.status==='DUPLICATE')&&foreign.inbox_id)await this.outbox.acknowledge(tx,{...s,event_id:claim.id,consumer_id:claim.consumer_id,attempt_count:claim.attempt_count,inbox_id:foreign.inbox_id});
     continue;
    }
    const receipt=await tx.query("SELECT id FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.receive' AND idempotency_key=$4 AND state='COMPLETED'",[...scopeValues(s),claim.consumer_id,claim.id]);
    if(receipt.rowCount!==1)fail('DECISION_UNAVAILABLE','Admission delivery lacks exact completed inbox receipt');
    await this.outbox.acknowledge(tx,{...s,event_id:claim.id,consumer_id:claim.consumer_id,attempt_count:claim.attempt_count,inbox_id:receipt.rows[0]!.id});
   }
   await tx.query("UPDATE hyperfide.decision_jobs SET state='RUNNING',lease_id=$4,lease_expires_at=deadline_at+interval '1 second',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...scopeValues(s),id,lease]);
   j.lease_id=lease;return j;
  },initialRemaining<=0?5000:databaseTimeout());
  if(!job)return this.status(i,{decision_id:id});
  const controller=new AbortController();this.controllers.set(id,controller);
  const abort=()=>controller.abort();this.shutdown.addEventListener('abort',abort,{once:true});i.signal.addEventListener('abort',abort,{once:true});
  let decision:ValidatedDecision|null=null,lastReason='provider-unavailable',status='unavailable';
  try{
   while(true){
    if(controller.signal.aborted)fail('DECISION_CANCELLED','Decision processing cancelled');
    const attempt=await this.tx(i,async tx=>{
     await this.lock(tx,s);const j=await this.row(tx,s,id);
     if(j.state!=='RUNNING'||j.lease_id!==lease)fail('DECISION_CANCELLED','Dispatcher lease was revoked');
     await this.fresh(tx,s,j,i);
     const prior=await this.attempts(tx,s,id),number=prior.length+1;
     if(number>2)return null;
     let remaining=Math.floor(Number(j.remaining_ms)),observed=performance.now();if(remaining<=0)fail('DECISION_EXPIRED','Total deadline exhausted');
     const routeId=j.route_ids[Math.min(number-1,j.route_ids.length-1)]!,profile=route(routeId);
     if(!p.allowed_purposes[j.purpose]?.includes(routeId))fail('DECISION_EGRESS_DENIED','Fallback route permission revoked');
     const prepared=prepareCapabilities({route_id:routeId,request:j.request,timeout_ms:Math.min(30000,remaining)},this.env);
     const transport=configuredTransport(profile,this.env);
     if(prepared.metadata.qualification_class!==transport.mode)fail('DECISION_UNSUPPORTED','Capability and transport qualification classes differ');
     const req=record(j.request,'stored request'),q=record(req.questions,'questions');
     const cost=billing({route_id:routeId,questions:Object.keys(q).length,state_tokens:Buffer.byteLength(canonical(prepared.prepared.body)),question_tokens:0},this.env);
     if(typeof cost.estimated_usd!=='number')fail('DECISION_BUDGET','Unqualified/unknown price cannot admit a bounded paid send');
     const reserve=Math.ceil((cost.estimated_usd as number)*1000000);
     if(Number(j.reserved_microusd)+reserve>p.max_job_cost_microusd)fail('DECISION_BUDGET','Total reserved cost exceeds job budget');
     await tx.query(`INSERT INTO hyperfide.decision_route_windows(organisation_id,run_id,route,minute) VALUES($1,$2,$3,floor(extract(epoch FROM clock_timestamp())/60)) ON CONFLICT DO NOTHING`,[...scopeValues(s),routeId]);
     const window=await tx.query('SELECT *,floor(extract(epoch FROM clock_timestamp())/60)::bigint AS now_minute,open_until>clock_timestamp() AS open FROM hyperfide.decision_route_windows WHERE organisation_id=$1 AND run_id=$2 AND route=$3 FOR UPDATE',[...scopeValues(s),routeId]),w=window.rows[0]!;
     if(w.open)fail('DECISION_CIRCUIT_OPEN','Provider circuit is open');
     const group=p.quota_groups[routeId];if(!group)fail('DECISION_SCHEMA','Route has no trusted account quota group');
     await tx.query('INSERT INTO hyperfide.decision_quota_windows(quota_group,minute,rate_limit) VALUES($1,floor(extract(epoch FROM clock_timestamp())/60),$2) ON CONFLICT DO NOTHING',[group,p.requests_per_minute]);
     const quota=(await tx.query('SELECT *,floor(extract(epoch FROM clock_timestamp())/60)::bigint AS now_minute FROM hyperfide.decision_quota_windows WHERE quota_group=$1 FOR UPDATE',[group])).rows[0]!;
     if(quota.rate_limit!==p.requests_per_minute)fail('DECISION_SCHEMA','Shared account quota policy differs between service instances');
     const sends=quota.minute===quota.now_minute?quota.sends:0;
     if(sends>=quota.rate_limit)fail('DECISION_RATE_LIMIT','Shared account route quota exceeded');
     await tx.query('UPDATE hyperfide.decision_quota_windows SET sends=$2,minute=$3 WHERE quota_group=$1',[group,sends+1,quota.now_minute]);
     await tx.query('UPDATE hyperfide.decision_jobs SET reserved_microusd=reserved_microusd+$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...scopeValues(s),id,reserve]);
     observed=performance.now();
     const clock=await tx.query('SELECT floor(extract(epoch FROM(deadline_at-clock_timestamp()))*1000)::int AS remaining_ms FROM hyperfide.decision_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...scopeValues(s),id]);
     remaining=Number(clock.rows[0]!.remaining_ms);
     if(remaining<=0)fail('DECISION_EXPIRED','Preparation consumed the total deadline');
     const rawCalibrations=this.env.HYPERFIDE_DECISION_CALIBRATIONS?strictJson(this.env.HYPERFIDE_DECISION_CALIBRATIONS):[];
     if(!Array.isArray(rawCalibrations))fail('DECISION_SCHEMA','Calibration profiles must be an array');
     const calibrations=(rawCalibrations as unknown[]).map(value=>{
      const c=record(value,'calibration');exact(c,['version','purpose','route_id','returned_model','rubric_version','minimum_concentration','qualification_ref'],['version','purpose','route_id','returned_model','rubric_version','minimum_concentration','qualification_ref']);return c;
     }).filter(c=>c.purpose===j.purpose&&c.route_id===routeId&&c.rubric_version===j.rubric_version);
     const configuration={schema_version:1,job_policy_revision:p.revision,capability:prepared.metadata,transport,billing_estimate:cost,calibrations};
     if(Buffer.byteLength(canonical(prepared.prepared.body))>500000||Buffer.byteLength(canonical(configuration))>60000)fail('DECISION_LIMIT','Replayable request/configuration exceeds storage budget');
     await tx.query('INSERT INTO hyperfide.decision_attempts(organisation_id,run_id,decision_id,attempt_no,route,requested_model,lease_id,request_body,request_headers,configuration) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)',[...scopeValues(s),id,number,routeId,profile.model,lease,canonical(prepared.prepared.body),canonical(prepared.prepared.headers),canonical(configuration)]);
     job.reserved_microusd=String(Number(j.reserved_microusd)+reserve);
     return{number,prepared:prepared.prepared,remaining,observed,routeId};
    },databaseTimeout());
    if(!attempt)break;
    const started=performance.now();let error:unknown=null;
    try{
     const sendBudget=Math.floor(attempt.remaining-(performance.now()-attempt.observed));
     if(sendBudget<=0)fail('DECISION_EXPIRED','Total deadline exhausted before transport');
     decision=await evaluatePreparedDecision(attempt.prepared,{decision_id:id,packet_hash:job.packet_hash,purpose:job.purpose,rubric_version:job.rubric_version,revision:job.packet.revision},this.env,
      {timeout_ms:Math.max(1,Math.min(30000,Math.floor(sendBudget/(attempt.number===1?2:1)))),signal:controller.signal});
     assertValidatedDecision(decision,{decision_id:id,packet_hash:job.packet_hash});
     if(Buffer.byteLength(canonical(decision.raw_response))>120000)fail('DECISION_INVALID_RESPONSE','Raw response exceeds replayable audit budget');
     status=decision.status;lastReason=decision.abstention_reason??'';
    }catch(e){error=e;decision=null;lastReason=e instanceof DecisionError?e.code:'DECISION_UNAVAILABLE';}
    await this.tx(i,async tx=>{
     const j=await this.row(tx,s,id);
     await tx.query('UPDATE hyperfide.decision_attempts SET finished_at=clock_timestamp(),outcome=$5,metadata=$6::jsonb WHERE organisation_id=$1 AND run_id=$2 AND decision_id=$3 AND attempt_no=$4 AND finished_at IS NULL',[...scopeValues(s),id,attempt.number,error?'error':'validated',canonical({duration_ms:performance.now()-started,request_hash:attempt.prepared.request_hash,replay_ref:{decision_id:id,attempt_no:attempt.number},code:error?lastReason:null,response_hash:decision?.response_hash??null,usage:decision?.usage??null,returned_model:decision?.returned_model??null})]);
     await tx.query(`UPDATE hyperfide.decision_route_windows SET failures=CASE WHEN $4 THEN failures+1 ELSE 0 END,
       open_until=CASE WHEN $4 AND failures+1>=$5 THEN clock_timestamp()+($6::int*interval '1 millisecond') ELSE NULL END
       WHERE organisation_id=$1 AND run_id=$2 AND route=$3`,[...scopeValues(s),attempt.routeId,!!error,p.circuit_failures,p.circuit_cooldown_ms]);
     if(j.state!=='RUNNING'||j.lease_id!==lease)fail('DECISION_CANCELLED','Completed transport lost job lease');
    });
    if(!error)break;
    status=lastReason.includes('RESPONSE')?'invalid_response':lastReason==='DECISION_UNSUPPORTED'?'unsupported':'unavailable';
    if(!(error instanceof DecisionError)||!error.retryable||attempt.number>=2)break;
    const delay=Math.min(error.retryAfterMs??0,Math.max(0,attempt.remaining-(performance.now()-attempt.observed)));
    if(delay>0)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,delay);controller.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
   }
  }catch(error){
   decision=null;lastReason=error instanceof DecisionError?error.code:'DECISION_UNAVAILABLE';
   status=lastReason==='DECISION_BUDGET'?'budget_exhausted':lastReason==='DECISION_EXPIRED'?'expired':lastReason==='DECISION_CANCELLED'?'cancelled':'abstained';
  }finally{this.controllers.delete(id);this.shutdown.removeEventListener('abort',abort);i.signal.removeEventListener('abort',abort);}
  const complete=async(checkFresh:boolean,timeoutMs:number):Promise<void>=>this.tx(i,async tx=>{
   const j=await this.row(tx,s,id);if(j.state!=='RUNNING'||j.lease_id!==lease)return;
   if(checkFresh&&Number(j.remaining_ms)>0){try{await this.fresh(tx,s,j,i);}catch(error){
    if(error instanceof Error&&'code'in error&&error.code==='TX_TIMEOUT')throw error;
    status='abstained';lastReason='stale-at-completion';
   }}
   const clock=await tx.query('SELECT deadline_at<=clock_timestamp() AS expired FROM hyperfide.decision_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...scopeValues(s),id]);
   if(clock.rows[0]!.expired){status='expired';lastReason='total-deadline';}
   else if(!checkFresh)fail('DECISION_UNAVAILABLE','Completion freshness deadline interrupted before job expiry');
   await this.finish(tx,s,j,status,lastReason||null,decision);
  },timeoutMs);
  try{await complete(true,databaseTimeout());}
  catch(error){
   if(!(error instanceof Error)||!('code'in error)||error.code!=='TX_TIMEOUT')throw error;
   // A cancelled freshness query rolls back. Retain the bounded provider response only
   // after a new guarded primary transaction proves the absolute job deadline elapsed.
   await complete(false,5000);
  }
  return this.status(i,{decision_id:id});
 }
 async completedAudit(tx:PrimaryTransaction,s:Scope,input:{decision_id:string;packet_hash:string},i:InvocationContext):Promise<unknown>{
  assertPrimaryTransaction(tx);assertInvocation(i);uuid(s.organisation_id);uuid(s.run_id);uuid(input.decision_id);
  if(i.principal.organisation_id!==s.organisation_id||i.principal.run_id!==s.run_id)fail('AUTH_SCOPE_DENIED','Audit scope differs from verified principal');
  await this.guard(i,tx,'READ');
  const known=await tx.query('SELECT 1 FROM hyperfide.decision_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...scopeValues(s),input.decision_id]);
  if(!known.rowCount)return{available:false,reason:'missing'};
  const job=await this.row(tx,s,input.decision_id);await this.fresh(tx,s,job,i);
  const r=await tx.query('SELECT packet_hash,payload FROM hyperfide.decision_results WHERE organisation_id=$1 AND run_id=$2 AND decision_id=$3',[...scopeValues(s),input.decision_id]);
  if(!r.rowCount){const j=await tx.query('SELECT 1 FROM hyperfide.decision_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...scopeValues(s),input.decision_id]);return{available:false,reason:j.rowCount?'pending':'missing'};}
  if(r.rows[0]!.packet_hash!==input.packet_hash)fail('DECISION_STALE','Stored audit packet hash differs');
  const payload=r.rows[0]!.payload as Record<string,unknown>;
  if(Buffer.byteLength(canonical(payload))>190000)return{available:false,reason:'nonreplayable'};
  const {evaluation_receipt,fallback,...audit}=payload;void evaluation_receipt;void fallback;return{available:true,payload:audit};
 }
 async close():Promise<void>{this.closed=true;for(const c of this.controllers.values())c.abort();}
}
export function createComponent(ctx:ComponentContext):Component{
 const g=ctx.dependencies.require('4.2','storage.transactions.v1',(v):v is TransactionGateway=>object(v)&&typeof v.withPrimaryTransaction==='function');
 const outbox=ctx.dependencies.require('6.1','events.outbox.v1',(v):v is Outbox=>object(v)&&['enqueue','claimPending','acknowledge'].every(k=>typeof v[k]==='function'));
 const inbox=ctx.dependencies.require('6.2','events.inbox.v1',(v):v is Inbox=>object(v)&&typeof v.receive==='function');
 const jobs=new DecisionJobs(g,outbox,inbox,ctx.env,ctx.signal);
 const invocation=(context:ComponentContext):InvocationContext=>{if(!context.invocation)fail('AUTH_REQUIRED','Authenticated invocation required');assertInvocation(context.invocation);return context.invocation;};
 return{apiVersion:1,capabilities:{'decision.jobs.v1':Object.freeze({schemaVersion:1,registerPurpose:jobs.registerPurpose.bind(jobs),submit:jobs.submit.bind(jobs),replay:jobs.replay.bind(jobs),completedAudit:jobs.completedAudit.bind(jobs)})},
 actions:{'decision.jobs.submit':(input,context)=>jobs.submit(invocation(context),input),
  'decision.jobs.status':(input,context)=>jobs.status(invocation(context),input),
  'decision.jobs.replay':(input,context)=>jobs.replay(invocation(context),input),
  'decision.jobs.process':(input,context)=>jobs.process(invocation(context),input),
  'decision.jobs.cancel':(input,context)=>jobs.cancel(invocation(context),input)},close:()=>jobs.close()};
}
