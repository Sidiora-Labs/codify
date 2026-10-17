import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from './programme.js';
import {isNativeAuthAuthority} from '../identity/native_auth.js';
import {gatewayOf,invocationOf} from '../identity/enrollment.js';
import {base64,strictJSON} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import type {IdentityTransaction} from '../identity/enrollment.js';

interface NativeProfileSnapshot {
  schema_version:1;profile_id:string;profile_revision:string;profile_digest:string;
  connector:'codex'|'claude';auth_mode:'account_session'|'api_credential';
  binary:{path:string;digest:string;version:string};credential_reference:string;
  configured_model_alias:string;requested_model_id:string;observed_model_id:string|null;
  configured_provider_id:string;observed_provider_id:string|null;permission_profile_id:string;
  capabilities:{unattended:boolean;refresh:boolean;concurrent_account:boolean;portable_session:boolean;explicit_resume:boolean};
  qualification:{state:'QUALIFIED';live_qualified:true;receipt_digest:string};
}
interface Measurements {evidence_digest:string;sample_count:number;qualified_results:number;failed_results:number;p95_latency_ms:number|null;observed_at:string}
export interface QualifiedDeployment {native_profile:NativeProfileSnapshot;frontier:true;engineering:true;expected_profile_digest:string;expected_snapshot_digest:string;expires_at:string;measurements:Measurements|null}
export interface FrontierPolicy {
  schema_version:1;programme_id:string;repository:string;spec_revision:string;policy_revision:number;
  short_critical_complex_alias:string;sustained_complex_alias:string;default_alias:string;deployments:QualifiedDeployment[];
}
export interface SelectionInput {
  task_id:string;duration:'SHORT'|'SUSTAINED';critical:boolean;complex:boolean;required_capabilities:string[];
  requested_alias:string|null;input_evidence_digest:string;
}
function deny(message:string):never{throw new FoundationError('FRONTIER_ROUTE_DENIED',message);}
function exact(input:unknown,keys:string[]):Record<string,unknown>{
  if(!object(input)||Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key)))deny('Frontier configuration or request fields are invalid');
  return input;
}
function text(input:unknown,max=256):string{
  if(typeof input!=='string'||!input.length||input.length>max||/[\x00-\x20\x7f]/.test(input))deny('Frontier identity is invalid');return input;
}
function digest(input:unknown):string{if(typeof input!=='string'||!/^sha256:[a-f0-9]{64}$/.test(input))deny('Frontier evidence digest is invalid');return input;}
function nonnegative(input:unknown,integer=false):number{
  if(typeof input!=='number'||!Number.isFinite(input)||input<0||integer&&!Number.isSafeInteger(input))deny('Selection measurements must be actual nonnegative observations');return input;
}
function strings(input:unknown):string[]{
  if(!Array.isArray(input)||input.length>128)deny('Frontier capability list is invalid');
  const out=input.map(value=>text(value));if(new Set(out).size!==out.length)deny('Frontier capabilities are duplicated');return out;
}
function timestamp(input:unknown):string {
  const out=text(input);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(out)||!Number.isFinite(Date.parse(out))||new Date(out).toISOString()!==out)
    deny('Native qualification time must be a real canonical UTC timestamp');
  return out;
}
function future(input:unknown):string{const out=timestamp(input);if(Date.parse(out)<=Date.now())deny('Native route qualification expired');return out;}
function canonical(input:unknown):string{
  if(Array.isArray(input))return '['+input.map(canonical).join(',')+']';
  if(object(input))return '{'+Object.keys(input).sort().map(key=>JSON.stringify(key)+':'+canonical(input[key])).join(',')+'}';
  if(input===null||typeof input==='string'||typeof input==='boolean'||typeof input==='number'&&Number.isFinite(input))return JSON.stringify(input);
  return deny('Frontier data is not canonical JSON');
}
function snapshot(input:unknown):NativeProfileSnapshot{
  const out=exact(input,['schema_version','profile_id','profile_revision','profile_digest','connector','auth_mode','binary','credential_reference',
    'configured_model_alias','requested_model_id','observed_model_id','configured_provider_id','observed_provider_id','permission_profile_id','capabilities','qualification']);
  if(out.schema_version!==1||!['codex','claude'].includes(out.connector as string)||!['account_session','api_credential'].includes(out.auth_mode as string))
    deny('Only native Claude/Codex engineering profiles are permitted');
  const binary=exact(out.binary,['path','digest','version']);
  const capabilities=exact(out.capabilities,['unattended','refresh','concurrent_account','portable_session','explicit_resume']);
  if(Object.values(capabilities).some(value=>typeof value!=='boolean'))deny('Native capabilities must be qualified observations');
  const q=exact(out.qualification,['state','live_qualified','receipt_digest']);
  if(q.state!=='QUALIFIED'||q.live_qualified!==true||q.receipt_digest===null)deny('Native profile has no current live qualification');
  return {schema_version:1,profile_id:text(out.profile_id),profile_revision:text(out.profile_revision),profile_digest:digest(out.profile_digest),
    connector:out.connector as NativeProfileSnapshot['connector'],auth_mode:out.auth_mode as NativeProfileSnapshot['auth_mode'],
    binary:{path:text(binary.path,4096),digest:digest(binary.digest),version:text(binary.version)},
    credential_reference:text(out.credential_reference),configured_model_alias:text(out.configured_model_alias),
    requested_model_id:text(out.requested_model_id),observed_model_id:out.observed_model_id===null?null:text(out.observed_model_id),
    configured_provider_id:text(out.configured_provider_id),observed_provider_id:out.observed_provider_id===null?null:text(out.observed_provider_id),
    permission_profile_id:text(out.permission_profile_id),
    capabilities:capabilities as NativeProfileSnapshot['capabilities'],
    qualification:{state:'QUALIFIED',live_qualified:true,receipt_digest:digest(q.receipt_digest)}};
}
function measurements(input:unknown):Measurements|null{
  if(input===null)return null;
  const out=exact(input,['evidence_digest','sample_count','qualified_results','failed_results','p95_latency_ms','observed_at']);
  const sample_count=nonnegative(out.sample_count,true),qualified_results=nonnegative(out.qualified_results,true),failed_results=nonnegative(out.failed_results,true);
  const observed_at=timestamp(out.observed_at);
  if(qualified_results+failed_results>sample_count||!Number.isFinite(Date.parse(observed_at))||Date.parse(observed_at)>Date.now()||
      sample_count===0&&out.p95_latency_ms!==null)deny('Selection measurement provenance is inconsistent');
  return {evidence_digest:digest(out.evidence_digest),sample_count,qualified_results,failed_results,
    p95_latency_ms:out.p95_latency_ms===null?null:nonnegative(out.p95_latency_ms),observed_at};
}
export function validateFrontierPolicy(input:unknown,context:ComponentContext):FrontierPolicy{
  const out=exact(input,['schema_version','programme_id','repository','spec_revision','policy_revision','short_critical_complex_alias','sustained_complex_alias','default_alias','deployments']);
  if(out.schema_version!==1||out.programme_id!==context.policy.programme_id||out.repository!==context.policy.repository||
      out.spec_revision!==context.policy.spec_revision||out.policy_revision!==context.policy.policy_revision)deny('Native model routing is not the approved programme revision');
  if(!Array.isArray(out.deployments)||!out.deployments.length||out.deployments.length>64)deny('Qualified native deployments are required');
  const deployments=out.deployments.map(value=>{
    const row=exact(value,['native_profile','frontier','engineering','expected_profile_digest','expected_snapshot_digest','expires_at','measurements']);
    if(row.frontier!==true||row.engineering!==true)deny('Decision or nonfrontier routes cannot implement engineering work');
    const native_profile=snapshot(row.native_profile),expected_profile_digest=digest(row.expected_profile_digest);
    if(native_profile.profile_digest!==expected_profile_digest)deny('Native configuration drift requires route requalification');
    // Profile-config identity belongs to 14.3. This independent approval pin binds its complete exported snapshot.
    const expected_snapshot_digest=digest(row.expected_snapshot_digest);
    const actualSnapshotDigest='sha256:'+createHash('sha256').update(canonical(native_profile)).digest('hex');
    if(actualSnapshotDigest!==expected_snapshot_digest)deny('Native snapshot content differs from its approved qualification');
    return {native_profile,frontier:true as const,engineering:true as const,expected_profile_digest,expected_snapshot_digest,expires_at:future(row.expires_at),measurements:measurements(row.measurements)};
  });
  if(new Set(deployments.map(row=>row.native_profile.configured_model_alias)).size!==deployments.length)deny('Model aliases must resolve uniquely');
  const policy:FrontierPolicy={schema_version:1,programme_id:context.policy.programme_id,repository:context.policy.repository,
    spec_revision:context.policy.spec_revision,policy_revision:context.policy.policy_revision,
    short_critical_complex_alias:text(out.short_critical_complex_alias),sustained_complex_alias:text(out.sustained_complex_alias),default_alias:text(out.default_alias),deployments};
  const find=(alias:string)=>deployments.find(row=>row.native_profile.configured_model_alias===alias);
  if(find(policy.short_critical_complex_alias)?.native_profile.connector!=='claude'||
      find(policy.sustained_complex_alias)?.native_profile.connector!=='codex'||!find(policy.default_alias))
    deny('Approved task routing aliases do not resolve to qualified Claude/Codex deployments');
  return policy;
}
export function validateSelection(input:unknown):SelectionInput{
  const out=exact(input,['task_id','duration','critical','complex','required_capabilities','requested_alias','input_evidence_digest']);
  if(!['SHORT','SUSTAINED'].includes(out.duration as string)||typeof out.critical!=='boolean'||typeof out.complex!=='boolean')deny('Task selection characteristics must be explicit');
  return {task_id:text(out.task_id),duration:out.duration as SelectionInput['duration'],critical:out.critical,complex:out.complex,
    required_capabilities:strings(out.required_capabilities),requested_alias:out.requested_alias===null?null:text(out.requested_alias),input_evidence_digest:digest(out.input_evidence_digest)};
}
/** Selection is an attributable route proposal. Capacity, current task ownership and launch are separate admissions. */
export function selectFrontierRoute(policy:FrontierPolicy,input:SelectionInput):Record<string,unknown>{
  const preferred=input.duration==='SUSTAINED'&&input.complex?policy.sustained_complex_alias:
    input.duration==='SHORT'&&input.critical&&input.complex?policy.short_critical_complex_alias:policy.default_alias;
  const alias=input.requested_alias??preferred;
  const selected=policy.deployments.find(row=>row.native_profile.configured_model_alias===alias);
  if(!selected||Date.parse(selected.expires_at)<=Date.now()||alias!==preferred)deny('Requested alias is absent, stale or outside the approved assignment policy');
  const native=selected.native_profile;
  if(input.required_capabilities.some(name=>!Object.hasOwn(native.capabilities,name)||!(native.capabilities as Record<string,boolean>)[name]))
    deny('Native deployment lacks a required qualified capability');
  const record={spec_revision:policy.spec_revision,policy_revision:policy.policy_revision,task:input,selected_alias:alias,
    profile_id:native.profile_id,profile_revision:native.profile_revision,profile_digest:native.profile_digest,
    connector:native.connector,connector_version:native.binary.version,binary_digest:native.binary.digest,
    auth_mode:native.auth_mode,credential_profile_ref:native.credential_reference,permission_profile_id:native.permission_profile_id,
    configured_provider_id:native.configured_provider_id,observed_provider_id:native.observed_provider_id,
    requested_model_id:native.requested_model_id,observed_model_id:native.observed_model_id,
    qualification_receipt_digest:native.qualification.receipt_digest,measurements:selected.measurements};
  return {...record,selection_digest:'sha256:'+createHash('sha256').update(canonical(record)).digest('hex'),
    authority:'NONE',execution:'NOT_STARTED'};
}
function refuse(code:string,message:string):never{throw new FoundationError(code,message);}
function sha(input:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(input)).digest('hex');}
/** Deterministic record identity (RFC 4122 name-based layout) so a retried selection converges on one durable row. */
function nameId(...parts:string[]):string{
  const b=createHash('sha256').update(parts.join('\0')).digest().subarray(0,16);
  b[6]=(b[6]!&0x0f)|0x50;b[8]=(b[8]!&0x3f)|0x80;const h=b.toString('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function uuid(input:unknown):string{if(typeof input!=='string'||!UUID.test(input))deny('Frontier record identity must be a canonical UUID');return input;}
const ROUTE_ROLES=new Set(['OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR']);
const AGGREGATE='frontier.route';
/** Bounded V-044 policy; every limit is reported with each decision so retries are attributable. */
export const OUTCOME_LIMITS=Object.freeze({error_retries:2,limit_backoffs:3,consecutive_no_op:3,consecutive_waiting:6,consecutive_idle:2,selections_per_task:3,
  error_backoff_ms:1000,limit_backoff_ms:30000,max_backoff_ms:900000});
const SIGNALS=['PROGRESS','NO_OP','PROCESS_ALIVE','MODEL_WAITING','IDLE','MODEL_ERROR','TOOL_ERROR','AUTH_FAILURE','QUOTA_LIMITED','RATE_LIMITED'] as const;
type OutcomeSignal=typeof SIGNALS[number];
const CLASSIFICATION:Record<OutcomeSignal,string>={PROGRESS:'USEFUL_PROGRESS',NO_OP:'NO_PROGRESS',PROCESS_ALIVE:'PROCESS_LIVENESS',MODEL_WAITING:'MODEL_WAITING',IDLE:'IDLE',
  MODEL_ERROR:'MODEL_FAILURE',TOOL_ERROR:'TOOL_FAILURE',AUTH_FAILURE:'AUTHENTICATION_FAILURE',QUOTA_LIMITED:'QUOTA_LIMIT',RATE_LIMITED:'RATE_LIMIT'};
const TERMINAL=new Set(['ESCALATE','AUTH_BLOCKED']);
function trailing(history:OutcomeSignal[],member:(s:OutcomeSignal)=>boolean):number{let n=0;for(let i=history.length-1;i>=0&&member(history[i]!);i--)n++;return n;}
/** Liveness, model waiting and useful progress are separate signals; verbose activity never becomes success. */
export function decideOutcome(prior:OutcomeSignal[],signal:OutcomeSignal):{decision:string;reason:string;retry_after_ms:number|null;retries_used:number;retry_limit:number|null}{
  const history=[...prior,signal],L=OUTCOME_LIMITS;
  const backoff=(base:number,n:number)=>Math.min(L.max_backoff_ms,base*2**(n-1));
  switch(signal){
    case 'PROGRESS':return {decision:'CONTINUE',reason:'Evidence-backed useful progress',retry_after_ms:null,retries_used:0,retry_limit:null};
    case 'NO_OP':{const n=trailing(history,s=>s==='NO_OP');
      return n>=L.consecutive_no_op?{decision:'ESCALATE',reason:'Repeated no-op activity is not progress',retry_after_ms:null,retries_used:n,retry_limit:L.consecutive_no_op}:
        {decision:'CONTINUE',reason:'No-op activity recorded without progress credit',retry_after_ms:null,retries_used:n,retry_limit:L.consecutive_no_op};}
    case 'IDLE':{const n=trailing(history,s=>s==='IDLE');
      if(n>=L.consecutive_idle)return {decision:'ESCALATE',reason:'Idle session exceeded the bounded idle budget',retry_after_ms:null,retries_used:n,retry_limit:L.consecutive_idle};}
    // falls through: an isolated idle observation is bounded by the waiting budget.
    case 'PROCESS_ALIVE':case 'MODEL_WAITING':{const n=trailing(history,s=>s==='PROCESS_ALIVE'||s==='MODEL_WAITING'||s==='IDLE');
      return n>=L.consecutive_waiting?{decision:'ESCALATE',reason:'Liveness or model waiting without progress exceeded its bound',retry_after_ms:null,retries_used:n,retry_limit:L.consecutive_waiting}:
        {decision:'WAIT',reason:'Process liveness or model waiting is not useful progress',retry_after_ms:null,retries_used:n,retry_limit:L.consecutive_waiting};}
    case 'MODEL_ERROR':case 'TOOL_ERROR':{const n=history.filter(s=>s==='MODEL_ERROR'||s==='TOOL_ERROR').length;
      return n>L.error_retries?{decision:'ESCALATE',reason:'Model/tool error retry budget exhausted',retry_after_ms:null,retries_used:n-1,retry_limit:L.error_retries}:
        {decision:'RETRY',reason:'Bounded retry in the same recorded session context',retry_after_ms:backoff(L.error_backoff_ms,n),retries_used:n,retry_limit:L.error_retries};}
    case 'QUOTA_LIMITED':case 'RATE_LIMITED':{const n=history.filter(s=>s==='QUOTA_LIMITED'||s==='RATE_LIMITED').length;
      return n>L.limit_backoffs?{decision:'ESCALATE',reason:'Quota/rate-limit backoff budget exhausted',retry_after_ms:null,retries_used:n-1,retry_limit:L.limit_backoffs}:
        {decision:'BACKOFF',reason:'Provider limit requires bounded backoff, never respawn',retry_after_ms:backoff(L.limit_backoff_ms,n),retries_used:n,retry_limit:L.limit_backoffs};}
    case 'AUTH_FAILURE':return {decision:'AUTH_BLOCKED',reason:'Authentication failure requires operator credential repair; retry and respawn are refused',retry_after_ms:null,retries_used:0,retry_limit:0};
  }
}
async function trustedJSON(filename:string|undefined,label:string):Promise<unknown>{
  if(!filename||!path.isAbsolute(filename))refuse('FRONTIER_QUALIFICATION_UNAVAILABLE',label+' is unavailable');
  let info;
  try{info=await fs.lstat(filename);}catch{return refuse('FRONTIER_QUALIFICATION_UNAVAILABLE',label+' is unavailable');}
  if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||info.size>1048576)
    refuse('FRONTIER_QUALIFICATION_UNAVAILABLE',label+' must be a bounded private regular file owned by the service');
  try{return strictJSON(await fs.readFile(filename),1048576);}catch{return refuse('FRONTIER_QUALIFICATION_UNAVAILABLE',label+' is not strict JSON');}
}
interface QualificationReceipt {
  schema_version:1;qualifier:string;profile_id:string;profile_digest:string;binary_digest:string;binary_version:string;configured_model_alias:string;
  requested_model_id:string;configured_provider_id:string;observed_model_id:string;observed_provider_id:string;qualified_at:string;expires_at:string;evidence_digest:string;
}
const RECEIPT_FIELDS=['schema_version','qualifier','profile_id','profile_digest','binary_digest','binary_version','configured_model_alias','requested_model_id',
  'configured_provider_id','observed_model_id','observed_provider_id','qualified_at','expires_at','evidence_digest'];
/** Live connector qualification receipts are signed by the configured 13.1 qualifier key; flags in routing config never qualify a route. */
export async function qualificationReceipts(env:NodeJS.ProcessEnv):Promise<Map<string,{receipt:QualificationReceipt;receipt_digest:string}>>{
  const keyText=env.HF_FRONTIER_QUALIFIER_PUBLIC_KEY_B64;
  let key;
  try{key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),base64(keyText,32)]),format:'der',type:'spki'});}
  catch{return refuse('FRONTIER_QUALIFICATION_UNAVAILABLE','Trusted connector qualifier key is unavailable');}
  const raw=await trustedJSON(env.HF_FRONTIER_QUALIFICATION_FILE,'Connector qualification receipt inventory');
  if(!object(raw)||Object.keys(raw).length!==2||raw.schema_version!==1||!Array.isArray(raw.receipts)||!raw.receipts.length||raw.receipts.length>64)
    refuse('FRONTIER_QUALIFICATION_INVALID','Connector qualification inventory is invalid');
  const out=new Map<string,{receipt:QualificationReceipt;receipt_digest:string}>();
  for(const envelope of raw.receipts as unknown[]){
    if(!object(envelope)||Object.keys(envelope).length!==2||!object(envelope.body)||typeof envelope.signature_b64!=='string')refuse('FRONTIER_QUALIFICATION_INVALID','Signed qualification envelope required');
    const body=envelope.body;
    let signature:Buffer;
    try{signature=base64(envelope.signature_b64,64);}catch{return refuse('FRONTIER_QUALIFICATION_INVALID','Qualification signature encoding is invalid');}
    if(!verify(null,Buffer.from(canonical(body)),key,signature))refuse('FRONTIER_QUALIFICATION_INVALID','Qualification receipt signature is invalid');
    if(Object.keys(body).length!==RECEIPT_FIELDS.length||RECEIPT_FIELDS.some(k=>!Object.hasOwn(body,k))||body.schema_version!==1||body.qualifier!=='13.1-connector-qualification')
      refuse('FRONTIER_QUALIFICATION_INVALID','Qualification receipt is not a 13.1 connector qualification');
    const receipt:QualificationReceipt={schema_version:1,qualifier:'13.1-connector-qualification',profile_id:text(body.profile_id),profile_digest:digest(body.profile_digest),
      binary_digest:digest(body.binary_digest),binary_version:text(body.binary_version),configured_model_alias:text(body.configured_model_alias),
      requested_model_id:text(body.requested_model_id),configured_provider_id:text(body.configured_provider_id),observed_model_id:text(body.observed_model_id),
      observed_provider_id:text(body.observed_provider_id),qualified_at:timestamp(body.qualified_at),expires_at:timestamp(body.expires_at),evidence_digest:digest(body.evidence_digest)};
    if(Date.parse(receipt.qualified_at)>Date.now())refuse('FRONTIER_QUALIFICATION_INVALID','Qualification cannot be observed in the future');
    if(Date.parse(receipt.expires_at)<=Date.now())refuse('FRONTIER_QUALIFICATION_STALE','Connector qualification receipt expired');
    if(out.has(receipt.profile_id))refuse('FRONTIER_QUALIFICATION_INVALID','One current qualification per native profile');
    out.set(receipt.profile_id,{receipt,receipt_digest:sha(body)});
  }
  return out;
}
/** Bind the actual 14.3 configuration to its signed live qualification; any drift requires requalification. */
export function qualifiedSnapshot(actual:unknown,receipts:Map<string,{receipt:QualificationReceipt;receipt_digest:string}>):NativeProfileSnapshot{
  if(!object(actual)||typeof actual.profile_id!=='string')deny('Authoritative native snapshot is unavailable');
  const found=receipts.get(actual.profile_id);
  if(!found)refuse('FRONTIER_ROUTE_UNQUALIFIED','Native profile has no signed live connector qualification');
  const r=found.receipt,binary=object(actual.binary)?actual.binary:{};
  if(actual.profile_digest!==r.profile_digest||binary.digest!==r.binary_digest||binary.version!==r.binary_version||actual.configured_model_alias!==r.configured_model_alias||
      actual.requested_model_id!==r.requested_model_id||actual.configured_provider_id!==r.configured_provider_id)
    refuse('FRONTIER_ROUTE_UNQUALIFIED','Actual native configuration differs from its qualified deployment');
  if(r.observed_provider_id!==r.configured_provider_id||r.observed_model_id!==r.requested_model_id)
    refuse('FRONTIER_ROUTE_UNQUALIFIED','Qualified observation did not confirm the configured provider/model deployment');
  return snapshot({...actual,observed_model_id:r.observed_model_id,observed_provider_id:r.observed_provider_id,
    qualification:{state:'QUALIFIED',live_qualified:true,receipt_digest:found.receipt_digest}});
}
type Tx=IdentityTransaction;
interface Scope {organisation_id:string;run_id:string}
/** Measured selection input: the current 5.4 resource admission for this request, observed on the primary clock. */
export async function admissionMeasurement(tx:Tx,scope:Scope,request_id:string):Promise<Record<string,unknown>>{
  const rows=(await tx.query(
    "SELECT r.id AS reservation_id,r.capacity_account_id,a.pool_id,a.dimension,r.quantity::text AS quantity,r.state,r.expires_at>clock_timestamp() AS live,"+
    "a.configured_limit::text AS configured_limit,a.reserved::text AS reserved,a.allocated::text AS allocated,a.qualification_state,"+
    "to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS observed_at "+
    "FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id "+
    "WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.request_id=$3 ORDER BY r.capacity_account_id",[scope.organisation_id,scope.run_id,request_id])).rows as {reservation_id:string;capacity_account_id:string;pool_id:string;dimension:string;quantity:string;state:string;live:boolean;
      configured_limit:string;reserved:string;allocated:string;qualification_state:string;observed_at:string}[];
  if(!rows.length)refuse('FRONTIER_ADMISSION_REQUIRED','No 5.4 resource admission exists for this selection');
  if(rows.some(r=>!['PROVISIONING','ALLOCATED'].includes(r.state)||!r.live))refuse('FRONTIER_ADMISSION_REQUIRED','Resource admission is released or expired');
  if(rows.some(r=>r.qualification_state!=='QUALIFIED'))refuse('FRONTIER_ADMISSION_REQUIRED','Admitted capacity is not qualified');
  if(!rows.some(r=>r.dimension==='AGENT'&&BigInt(r.quantity)>=1n))refuse('FRONTIER_ADMISSION_REQUIRED','Admission holds no engineering agent capacity');
  const dimensions=rows.map(r=>({reservation_id:r.reservation_id,capacity_account_id:r.capacity_account_id,pool_id:r.pool_id,dimension:r.dimension,
    quantity:r.quantity,state:r.state,configured_limit:r.configured_limit,reserved:r.reserved,allocated:r.allocated}));
  return {source:'5.4.resource-admission',request_id,dimensions,evidence_digest:sha(dimensions),observed_at:rows[0]!.observed_at};
}
async function storedEvents(tx:Tx,scope:Scope,selection_id:string):Promise<{selection:Record<string,unknown>|null;outcomes:Record<string,unknown>[]}>{
  const rows=(await tx.query(
    'SELECT event_type,aggregate_version::text AS aggregate_version,payload FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND aggregate_type=$3 AND aggregate_id=$4 ORDER BY aggregate_version,event_type',
    [scope.organisation_id,scope.run_id,AGGREGATE,selection_id])).rows as {event_type:string;aggregate_version:string;payload:Record<string,unknown>}[];
  return {selection:rows.find(r=>r.event_type==='frontier.route.selected')?.payload??null,
    outcomes:rows.filter(r=>r.event_type==='frontier.route.outcome').map(r=>r.payload)};
}
async function append(tx:Tx,scope:Scope,id:string,aggregate:string,version:number,type:string,payload:Record<string,unknown>):Promise<boolean>{
  const inserted=await tx.query('INSERT INTO hyperfide.outbox_events(organisation_id,run_id,id,aggregate_type,aggregate_id,aggregate_version,event_type,payload) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id',[scope.organisation_id,scope.run_id,id,AGGREGATE,aggregate,version,type,canonical(payload)]);
  return inserted.rowCount===1;
}
/** Launch admission seam: a 13.x launcher consumes only a durable, non-terminal 1.3 selection. */
export interface FrontierRouteAuthority {selectedRoute(tx:Tx,scope:Scope,selection_id:string):Promise<Record<string,unknown>>}
export function isFrontierRouteAuthority(v:unknown):v is FrontierRouteAuthority{return object(v)&&typeof v.selectedRoute==='function';}
async function selectedRoute(tx:Tx,scope:Scope,selection_id:string):Promise<Record<string,unknown>>{
  const {selection,outcomes}=await storedEvents(tx,scope,uuid(selection_id));
  if(!selection)refuse('FRONTIER_SELECTION_UNKNOWN','No recorded frontier selection in this run');
  const last=outcomes.at(-1);
  if(last&&TERMINAL.has(String(last.decision)))refuse('FRONTIER_ROUTE_TERMINAL','Selected route is escalated or authentication blocked');
  return selection;
}
function scopeOf(i:InvocationContext,current:ComponentContext):Scope{
  if(!ROUTE_ROLES.has(i.principal.role))refuse('AUTH_ROLE_DENIED','Principal role cannot select or report engineering routes');
  if(i.principal.run_id!==current.policy.programme_id)deny('Invocation run differs from the approved routing programme');
  return {organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
}
export function createComponent(context:ComponentContext):Component {
  const nativeAuthority=context.dependencies.require('14.3','identity.native-auth',isNativeAuthAuthority);
  const gateway=gatewayOf(context);
  const propose=async(input:unknown,current:ComponentContext)=>{
    const filename=current.env.HF_FRONTIER_POLICY_FILE;
    if(!filename)deny('Trusted frontier policy is unavailable');
    let raw:unknown;
    try {
      const info=await fs.lstat(filename);
      if(!info.isFile()||info.isSymbolicLink()||info.size>1048576)deny('Frontier policy must be a bounded regular file');
      raw=JSON.parse(await fs.readFile(filename,'utf8'));
    } catch {deny('Trusted frontier policy is unavailable');}
    const policy=validateFrontierPolicy(raw,current),selection=validateSelection(input);
    return {policy,selection,proposal:selectFrontierRoute(policy,selection)};
  };
  const transaction=<T>(i:InvocationContext,operation:(tx:Tx)=>Promise<T>)=>gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:i.signal,guard:i.guard},operation);
  const authority:FrontierRouteAuthority=Object.freeze({selectedRoute});
  return {apiVersion:1,capabilities:{'policy.frontier.v1':authority},actions:{
    'frontier.check':async(input,current)=>{
      const {proposal}=await propose(input,current);
      return {...proposal,qualification_admitted:false};
    },
    'frontier.select':async(input,current)=>{
      const i=invocationOf(current),scope=scopeOf(i,current);
      const request=exact(input,['selection','admission_request_id']),admission_request_id=uuid(request.admission_request_id);
      const {policy,selection,proposal}=await propose(request.selection,current);
      const approved=policy.deployments.find(row=>row.native_profile.configured_model_alias===proposal.selected_alias);
      if(!approved)deny('Approved deployment is unavailable');
      // Qualification authority: actual 14.3 configuration plus a signed 13.1 live receipt, never routing-file flags.
      const receipts=await qualificationReceipts(current.env);
      const actual=qualifiedSnapshot(nativeAuthority.resolve(approved.native_profile.profile_id),receipts);
      if(sha(actual)!==approved.expected_snapshot_digest)deny('Authoritative qualified snapshot differs from approved routing');
      const selection_id=nameId('frontier.selection',scope.organisation_id,scope.run_id,selection.task_id,admission_request_id);
      const request_digest=sha({selection,admission_request_id,policy_revision:policy.policy_revision,spec_revision:policy.spec_revision,approved_snapshot_digest:approved.expected_snapshot_digest});
      return transaction(i,async tx=>{
        const prior=await storedEvents(tx,scope,selection_id);
        if(prior.selection){
          if(prior.selection.request_digest!==request_digest)refuse('FRONTIER_IDEMPOTENCY_CONFLICT','Selection identity was reused with different inputs');
          return {...prior.selection,replayed:true};
        }
        const history=(await tx.query(
          "SELECT count(*) FILTER (WHERE s.event_type='frontier.route.selected')::int AS selections,"+
          "count(*) FILTER (WHERE s.event_type='frontier.route.outcome' AND s.payload->>'decision' IN ('ESCALATE','AUTH_BLOCKED') AND s.payload->>'selected_alias'=$5)::int AS blocked "+
          "FROM hyperfide.outbox_events s WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.aggregate_type=$3 AND s.payload->>'task_id'=$4",
          [scope.organisation_id,scope.run_id,AGGREGATE,selection.task_id,proposal.selected_alias])).rows[0] as {selections:number;blocked:number};
        if(history.blocked>0)refuse('FRONTIER_ROUTE_ESCALATED','This task route is escalated; a new launch requires a recorded leader decision');
        if(history.selections>=OUTCOME_LIMITS.selections_per_task)refuse('FRONTIER_RESPAWN_BOUNDED','Selection budget for this task is exhausted');
        const admission=await admissionMeasurement(tx,scope,admission_request_id);
        const record={...selectFrontierRoute({...policy,deployments:policy.deployments.map(row=>row===approved?{...row,native_profile:actual}:row)},selection),
          qualification_admitted:true,schema_version:1,selection_id,request_digest,task_id:selection.task_id,admission_request_id,
          approved_snapshot_digest:approved.expected_snapshot_digest,
          measured_inputs:{admission,route:approved.measurements,prior_selections:history.selections},
          selected_by:{actor_id:i.principal.actor_id,role:i.principal.role,credential_id:i.principal.credential_id}};
        if(!await append(tx,scope,selection_id,selection_id,1,'frontier.route.selected',record))refuse('FRONTIER_IDEMPOTENCY_CONFLICT','Concurrent selection identity conflict');
        return {...record,replayed:false};
      });
    },
    'frontier.outcome':async(input,current)=>{
      const i=invocationOf(current),scope=scopeOf(i,current);
      const v=exact(input,['selection_id','sequence','signal','evidence_digest']);
      const selection_id=uuid(v.selection_id),evidence_digest=digest(v.evidence_digest);
      if(!Number.isSafeInteger(v.sequence)||Number(v.sequence)<1||Number(v.sequence)>4096)deny('Outcome sequence must be a bounded positive integer');
      if(typeof v.signal!=='string'||!(SIGNALS as readonly string[]).includes(v.signal))deny('Outcome signal is not a recognised observation class');
      const sequence=Number(v.sequence),signal=v.signal as OutcomeSignal;
      return transaction(i,async tx=>{
        const {selection,outcomes}=await storedEvents(tx,scope,selection_id);
        if(!selection)refuse('FRONTIER_SELECTION_UNKNOWN','No recorded frontier selection in this run');
        const existing=outcomes.find(row=>row.sequence===sequence);
        if(existing){
          if(existing.signal!==signal||existing.evidence_digest!==evidence_digest)refuse('FRONTIER_IDEMPOTENCY_CONFLICT','Outcome sequence was reused with different observations');
          return {...existing,replayed:true};
        }
        if(sequence!==outcomes.length+1)refuse('FRONTIER_OUTCOME_SEQUENCE','Outcomes must be reported in contiguous order');
        const last=outcomes.at(-1);
        if(last&&TERMINAL.has(String(last.decision)))refuse('FRONTIER_ROUTE_TERMINAL','Escalated or authentication-blocked routes accept no further retries');
        const decided=decideOutcome(outcomes.map(row=>row.signal as OutcomeSignal),signal);
        const record={schema_version:1,selection_id,sequence,task_id:selection.task_id,selected_alias:selection.selected_alias,profile_id:selection.profile_id,
          signal,classification:CLASSIFICATION[signal],useful_progress:signal==='PROGRESS',liveness_only:signal==='PROCESS_ALIVE',model_waiting:signal==='MODEL_WAITING',
          ...decided,respawn_permitted:false,context_preserved:true,success_inferred:false,evidence_digest,
          history_digest:sha({previous:last?.history_digest??selection.selection_digest,sequence,signal,evidence_digest}),limits:OUTCOME_LIMITS,
          reported_by:{actor_id:i.principal.actor_id,role:i.principal.role}};
        if(!await append(tx,scope,nameId('frontier.outcome',selection_id,String(sequence)),selection_id,sequence,'frontier.route.outcome',record))
          refuse('FRONTIER_IDEMPOTENCY_CONFLICT','Concurrent outcome identity conflict');
        return {...record,replayed:false};
      });
    },
    'frontier.inspect':async(input,current)=>{
      const i=invocationOf(current),scope=scopeOf(i,current),v=exact(input,['selection_id']);
      return transaction(i,async tx=>{
        const stored=await storedEvents(tx,scope,uuid(v.selection_id));
        if(!stored.selection)refuse('FRONTIER_SELECTION_UNKNOWN','No recorded frontier selection in this run');
        const last=stored.outcomes.at(-1);
        return {...stored,terminal:Boolean(last&&TERMINAL.has(String(last.decision))),launch_admissible:!(last&&TERMINAL.has(String(last.decision)))};
      });
    }
  }};
}
