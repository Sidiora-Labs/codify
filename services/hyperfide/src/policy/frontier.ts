import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from './programme.js';
import {isNativeAuthAuthority} from '../identity/native_auth.js';
import {invocationOf} from '../identity/enrollment.js';

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
export function createComponent(context:ComponentContext):Component {
  const nativeAuthority=context.dependencies.require('14.3','identity.native-auth',isNativeAuthAuthority);
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
  return {apiVersion:1,actions:{
    'frontier.check':async(input,current)=>{
      const {proposal}=await propose(input,current);
      return {...proposal,qualification_admitted:false};
    },
    'frontier.select':async(input,current)=>{
      invocationOf(current);
      const {policy,selection,proposal}=await propose(input,current);
      const approved=policy.deployments.find(row=>row.native_profile.configured_model_alias===proposal.selected_alias);
      if(!approved)deny('Approved deployment is unavailable');
      // Qualification authority is 14.3, never an operator-supplied live-qualified flag in this routing file.
      const actual=snapshot(nativeAuthority.resolve(approved.native_profile.profile_id));
      const actualDigest='sha256:'+createHash('sha256').update(canonical(actual)).digest('hex');
      if(actualDigest!==approved.expected_snapshot_digest)deny('Authoritative native snapshot differs from approved routing');
      return {...selectFrontierRoute(policy,selection),qualification_admitted:true};
    }
  }};
}
