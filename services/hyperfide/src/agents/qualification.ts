import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createPrivateKey,createPublicKey,sign} from 'node:crypto';
import type {KeyObject} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {AuthProfileSnapshot} from '../identity/native_auth.js';
import {object} from '../policy/programme.js';
import {assertInvocation,DIGEST,exact,fail,frozen,hash} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';

/* Connector CAPABILITY qualification (task 13.1). Authentication-mode qualification stays with 14.3:
 * this registry consumes its profile snapshot and authenticated probe, then derives per-capability
 * outcomes from native observations. Callers never supply outcome/state/qualified flags. */
export const CONNECTOR_CAPABILITIES=['launch','input','output','steer','cancel','child_registration','resume'] as const;
export type ConnectorCapability=typeof CONNECTOR_CAPABILITIES[number];
export type CapabilityOutcome='QUALIFIED'|'UNQUALIFIED'|'UNSUPPORTED'|'REFUSED';
type ProbeResult='ACCEPTED'|'REFUSED'|'NOT_OFFERED';
export interface CapabilityObservation {result:ProbeResult;evidence_digest:string;context_restored:boolean}
export interface ConnectorObservationInput {
 profile_id:string;cli_version_output:string;binary_digest:string;
 resolution:{configured_model_alias:string;resolved_model_id:string;resolved_provider_id:string|null;source:'cli-config'|'auth-profile';config_digest:string|null};
 observation:{native_session_id:string;observed_model_id:string;observed_provider_id:string|null;observation_digest:string};
 probes:Record<ConnectorCapability,CapabilityObservation>;
}
export interface ConnectorQualificationPayload {
 schema_version:1;receipt_id:string;connector:'codex'|'claude';cli_version:string;binary_digest:string;auth_mode:string;
 profile_id:string;profile_digest:string;configured_model_alias:string;requested_model_id:string;
 observed_model_id:string;observed_provider_id:string;capabilities:Record<ConnectorCapability,CapabilityOutcome>;
 issued_at:number;expires_at:number;evidence_digest:string;auth_qualification_digest:string;
}
export interface SignedConnectorReceipt {schema_version:1;payload:string;signature:string}
export interface ConnectorQualificationRecord {
 key:string;state:'QUALIFIED'|'UNQUALIFIED';reasons:readonly string[];payload:ConnectorQualificationPayload;receipt_digest:string;receipt:SignedConnectorReceipt|null;
}
export interface NativeQualificationView {state:'UNQUALIFIED'|'QUALIFIED'|'STALE';live_qualified:boolean;receipt_digest:string|null}
export interface ConnectorQualificationAuthority {
 readonly schema_version:1;
 record(i:InvocationContext,input:unknown):Promise<ConnectorQualificationRecord>;
 inspect(profileId:string):ConnectorQualificationRecord|null;
 qualification(profileId:string):NativeQualificationView;
 receipt(profileId:string):SignedConnectorReceipt|null;
 publicKey():string;
}
export function isConnectorQualificationAuthority(v:unknown):v is ConnectorQualificationAuthority{
 return object(v)&&v.schema_version===1&&typeof v.record==='function'&&typeof v.inspect==='function'&&typeof v.qualification==='function'&&typeof v.receipt==='function'&&typeof v.publicKey==='function';
}
/* Structural subset of the 14.3 identity.native-auth authority; kept local so this module does not load its runtime. */
interface NativeAuthView {resolve(profileId:string):AuthProfileSnapshot;probe(i:InvocationContext,profileId:string):Promise<unknown>}
function isNativeAuthView(v:unknown):v is NativeAuthView{return object(v)&&typeof v.resolve==='function'&&typeof v.probe==='function';}
export interface RegistryOptions {
 signingKey:KeyObject|null;ttlSeconds:number;now?:()=>number;
 resolve:(profileId:string)=>AuthProfileSnapshot;
 authenticate:(i:InvocationContext,profileId:string)=>Promise<unknown>;
}
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function canonical(v:unknown):string{
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
function text(v:unknown,re=ID):string{if(typeof v!=='string'||!re.test(v))fail('CONNECTOR_QUALIFICATION_INVALID','Bounded native observation field required');return v;}
function digestOf(v:unknown):string{return text(v,DIGEST);}
function nullable(v:unknown,re=ID):string|null{return v===null?null:text(v,re);}
export function parseObservation(v:unknown):ConnectorObservationInput{
 exact(v,['profile_id','cli_version_output','binary_digest','resolution','observation','probes']);
 exact(v.resolution,['configured_model_alias','resolved_model_id','resolved_provider_id','source','config_digest']);
 exact(v.observation,['native_session_id','observed_model_id','observed_provider_id','observation_digest']);
 exact(v.probes,[...CONNECTOR_CAPABILITIES]);
 const r=v.resolution,o=v.observation,p=v.probes;
 if(typeof v.cli_version_output!=='string'||v.cli_version_output.length>256||r.source!=='cli-config'&&r.source!=='auth-profile')fail('CONNECTOR_QUALIFICATION_INVALID','Native version output and resolution source required');
 const probes={} as Record<ConnectorCapability,CapabilityObservation>;
 for(const name of CONNECTOR_CAPABILITIES){
  const x=p[name];exact(x,['result','evidence_digest','context_restored']);
  if(!['ACCEPTED','REFUSED','NOT_OFFERED'].includes(String(x.result))||typeof x.context_restored!=='boolean')fail('CONNECTOR_QUALIFICATION_INVALID','Observed probe result required');
  probes[name]={result:x.result as ProbeResult,evidence_digest:digestOf(x.evidence_digest),context_restored:x.context_restored};
 }
 return {profile_id:text(v.profile_id),cli_version_output:v.cli_version_output,binary_digest:digestOf(v.binary_digest),
  resolution:{configured_model_alias:text(r.configured_model_alias),resolved_model_id:text(r.resolved_model_id),resolved_provider_id:nullable(r.resolved_provider_id),source:r.source,config_digest:r.config_digest===null?null:digestOf(r.config_digest)},
  observation:{native_session_id:text(o.native_session_id),observed_model_id:text(o.observed_model_id),observed_provider_id:nullable(o.observed_provider_id),observation_digest:digestOf(o.observation_digest)},probes};
}
export function versionLine(connector:'codex'|'claude',version:string):string{return connector==='codex'?`codex-cli ${version}`:`${version} (Claude Code)`;}
/* Pure derivation: identical observations always produce identical outcomes. */
export function deriveOutcomes(s:AuthProfileSnapshot,o:ConnectorObservationInput):{capabilities:Record<ConnectorCapability,CapabilityOutcome>;reasons:string[]}{
 const reasons:string[]=[],out={} as Record<ConnectorCapability,CapabilityOutcome>,p=o.probes;
 for(const name of ['launch','input','output','cancel'] as const)out[name]=p[name].result==='ACCEPTED'?'QUALIFIED':'UNQUALIFIED';
 if(s.connector==='claude'){if(p.steer.result==='ACCEPTED')fail('CONNECTOR_QUALIFICATION_CONTRADICTED','Claude Code stream-json exposes no turn steering');out.steer='UNSUPPORTED';}
 else out.steer=p.steer.result==='ACCEPTED'?'QUALIFIED':'UNQUALIFIED';
 // Native delegation is disabled for coding workers; a CLI that registers children has escaped that boundary.
 if(p.child_registration.result==='ACCEPTED')fail('CONNECTOR_DELEGATION_ESCAPED','Pinned CLI registered a native child despite delegation disabling');
 out.child_registration=p.child_registration.result==='REFUSED'?'REFUSED':'UNQUALIFIED';
 out.resume=p.resume.result==='ACCEPTED'&&p.resume.context_restored&&s.capabilities.explicit_resume?'QUALIFIED':'UNSUPPORTED';
 for(const name of CONNECTOR_CAPABILITIES)if(out[name]==='UNQUALIFIED')reasons.push(name.toUpperCase()+'_NOT_OBSERVED');
 return {capabilities:out,reasons};
}
export function signReceipt(key:KeyObject,payload:ConnectorQualificationPayload):SignedConnectorReceipt{
 const bytes=canonical(payload);
 return frozen({schema_version:1 as const,payload:bytes,signature:sign(null,Buffer.from(bytes,'utf8'),key).toString('hex')});
}
export function rawPublicKey(key:KeyObject):string{
 const jwk=createPublicKey(key).export({format:'jwk'});if(jwk.crv!=='Ed25519'||typeof jwk.x!=='string')fail('CONNECTOR_QUALIFICATION_NOT_CONFIGURED','Ed25519 signing key required');
 return Buffer.from(jwk.x,'base64url').toString('hex');
}
export function createConnectorQualificationRegistry(options:RegistryOptions):ConnectorQualificationAuthority{
 const records=new Map<string,ConnectorQualificationRecord>(),now=options.now??(()=>Math.floor(Date.now()/1000));
 const keyOf=(s:AuthProfileSnapshot):string=>[s.connector,s.binary.version,s.binary.digest,s.auth_mode,s.profile_id].join('/');
 const current=(profileId:string):ConnectorQualificationRecord|null=>{const s=options.resolve(profileId),r=records.get(keyOf(s));return r&&r.payload.profile_digest===s.profile_digest?r:null;};
 const record=async(i:InvocationContext,input:unknown):Promise<ConnectorQualificationRecord>=>{
  if(!['RUNNER','OPERATOR'].includes(i.principal.role))fail('CONNECTOR_QUALIFICATION_SCOPE','Only runner or operator principals report native observations');
  const o=parseObservation(input),s=options.resolve(o.profile_id);
  if(s.profile_id!==o.profile_id)fail('CONNECTOR_QUALIFICATION_PROFILE','Configured profile identity changed');
  if(o.cli_version_output.trim()!==versionLine(s.connector,s.binary.version))fail('NATIVE_VERSION_DRIFT','Observed CLI version differs from the pinned version');
  if(o.binary_digest!==s.binary.digest)fail('NATIVE_BINARY_DRIFT','Observed binary differs from the pinned digest');
  const r=o.resolution,ob=o.observation;
  if(r.configured_model_alias!==s.configured_model_alias||r.resolved_model_id!==s.requested_model_id||(r.resolved_provider_id!==null&&r.resolved_provider_id!==s.configured_provider_id))fail('CONNECTOR_PROFILE_UNRESOLVED','Alias resolution differs from the configured frontier profile');
  if(ob.observed_model_id!==s.requested_model_id)fail('CONNECTOR_MODEL_MISMATCH','Native session reported a different model than configured');
  // Claude Code does not report its provider natively; only a provider resolved from the CLI configuration is accepted.
  const provider=ob.observed_provider_id??(r.source==='cli-config'?r.resolved_provider_id:null);
  if(provider!==null&&provider!==s.configured_provider_id)fail('CONNECTOR_PROVIDER_MISMATCH','Native session reported a different provider than configured');
  const derived=deriveOutcomes(s,o);
  if(provider===null)derived.reasons.push('PROVIDER_NOT_OBSERVED');
  const auth=await options.authenticate(i,o.profile_id);
  const authenticated=object(auth)&&auth.native_authentication==='AUTHENTICATED'&&auth.runtime_version_verified===true;
  if(!authenticated)derived.reasons.push('AUTH_MODE_NOT_AUTHENTICATED');
  if(!options.signingKey)derived.reasons.push('SIGNING_KEY_NOT_CONFIGURED');
  const issued=now(),evidence=hash(canonical({observation:ob,probes:o.probes,resolution:r}));
  const payload:ConnectorQualificationPayload={schema_version:1,receipt_id:evidence.slice(7,39),connector:s.connector,cli_version:s.binary.version,binary_digest:s.binary.digest,auth_mode:s.auth_mode,
   profile_id:s.profile_id,profile_digest:s.profile_digest,configured_model_alias:s.configured_model_alias,requested_model_id:s.requested_model_id,
   observed_model_id:ob.observed_model_id,observed_provider_id:provider??'',capabilities:derived.capabilities,issued_at:issued,expires_at:issued+options.ttlSeconds,
   evidence_digest:evidence,auth_qualification_digest:hash(canonical(auth??null))};
  const state=derived.reasons.length?'UNQUALIFIED':'QUALIFIED';
  const receipt=state==='QUALIFIED'&&options.signingKey?signReceipt(options.signingKey,payload):null;
  const result:ConnectorQualificationRecord=frozen({key:keyOf(s),state,reasons:derived.reasons,payload,receipt_digest:hash(canonical(payload)),receipt});
  records.set(result.key,result);return result;
 };
 const qualification=(profileId:string):NativeQualificationView=>{
  const r=current(profileId);if(!r)return {state:'UNQUALIFIED',live_qualified:false,receipt_digest:null};
  if(r.payload.expires_at<=now())return {state:'STALE',live_qualified:false,receipt_digest:null};
  return r.state==='QUALIFIED'&&r.receipt?{state:'QUALIFIED',live_qualified:true,receipt_digest:r.receipt_digest}:{state:'UNQUALIFIED',live_qualified:false,receipt_digest:null};
 };
 const receipt=(profileId:string):SignedConnectorReceipt|null=>qualification(profileId).live_qualified?current(profileId)!.receipt:null;
 const publicKey=():string=>{if(!options.signingKey)fail('CONNECTOR_QUALIFICATION_NOT_CONFIGURED','Receipt signing key not configured');return rawPublicKey(options.signingKey);};
 return Object.freeze({schema_version:1 as const,record,inspect:current,qualification,receipt,publicKey});
}
async function signingKey(file:string|undefined):Promise<KeyObject|null>{
 if(!file)return null;
 if(!path.isAbsolute(file))fail('CONNECTOR_QUALIFICATION_NOT_CONFIGURED','Absolute signing key path required');
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const st=await handle.stat();if(!st.isFile()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>4096)fail('CONNECTOR_QUALIFICATION_NOT_CONFIGURED','Private bounded signing key file required');
  const key=createPrivateKey(await handle.readFile());if(key.asymmetricKeyType!=='ed25519')fail('CONNECTOR_QUALIFICATION_NOT_CONFIGURED','Ed25519 signing key required');return key;}
 finally{await handle.close();}
}
export async function createComponent(ctx:ComponentContext):Promise<Component>{
 const key=await signingKey(ctx.env.HF_CONNECTOR_QUALIFICATION_SIGNING_KEY_FILE);
 const ttl=Number(ctx.env.HF_CONNECTOR_QUALIFICATION_TTL_SECONDS??'86400');
 if(!Number.isSafeInteger(ttl)||ttl<60||ttl>604800)fail('CONNECTOR_QUALIFICATION_NOT_CONFIGURED','Qualification lifetime must be 60s..7d');
 // Resolved lazily: the 14.3 authority is initialised before this component by declared dependency order.
 const native=():NativeAuthView=>ctx.dependencies.require('14.3','identity.native-auth',isNativeAuthView);
 const registry=createConnectorQualificationRegistry({signingKey:key,ttlSeconds:ttl,resolve:id=>native().resolve(id),authenticate:(i,id)=>native().probe(i,id)});
 const authority:ConnectorQualificationAuthority=Object.freeze({...registry,record:async(i:InvocationContext,input:unknown)=>{assertInvocation(i);return registry.record(i,input);}});
 const profile=(v:unknown):string=>{exact(v,['profile_id']);return text(v.profile_id);};
 const invocation=(c:ComponentContext):InvocationContext=>{const i=c.invocation;assertInvocation(i);return i;};
 return {apiVersion:1,capabilities:{'agents.connector-qualification':authority},actions:{
  'connector.qualification.record':async(v,c)=>{const r=await authority.record(invocation(c),v);return {state:r.state,reasons:r.reasons,receipt_digest:r.receipt_digest,capabilities:r.payload.capabilities,receipt:r.receipt};},
  'connector.qualification.inspect':async(v,c)=>{invocation(c);const id=profile(v);return {qualification:authority.qualification(id),record:authority.inspect(id),receipt:authority.receipt(id)};}
 }};
}
