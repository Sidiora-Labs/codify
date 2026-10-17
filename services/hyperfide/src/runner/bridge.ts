import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createPrivateKey,createPublicKey,randomBytes,randomUUID,sign,verify} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {isIdentityAuthority,gatewayOf,identityTransaction,invocationOf} from '../identity/enrollment.js';
import {assertInvocation,DIGEST,decimal,exact,fail,hash,uuid,strictJSON} from '../transport/protocol.js';
import type {InvocationContext,Principal} from '../transport/protocol.js';
import {readRuntimeReadiness} from '../providers/pools.js';
import {isArtifactStoreCapability} from '../artifacts/objects.js';
import type {ArtifactStoreCapability} from '../artifacts/objects.js';
import {assertSandboxReservation} from '../scheduler/claim.js';
import {readPreparationReceipt,recordPreparationReceipt,verifyPreparationReceipt} from './preparation_receipts.js';
import type {PreparationReceiptPlan,VerifiedPreparationReceipt} from './preparation_receipts.js';

export interface RunnerRemotePlan {
 session_id:string;operation_id:string;repository_id:string;reservation_id:string;
 job_id?:string;task_id?:string;job_kind?:string;argv:string[];cwd:string;
 environment:Record<string,string>;stdin?:string;timeout_ms:number;
 preparation?:RunnerPreparationInput;
 source_digest:string;source_provenance_digest?:string;policy_digest:string;executable_digest:string;
 environment_digest:string;artifact_paths:string[];
}
export interface RunnerStagingReference {
 role:string;artifact_id:string;storage_kind:'object'|'manifest';digest:string;manifest_digest?:string;size_bytes:string;
}
export interface RunnerPreparationInput {
 recipe_id:'environment.prepare.v1'|'checkpoint.restore.v1';
 input_manifest_artifact_id:string;input_manifest_digest:string;
 source:{repository_key:string;source_object_id:string;source_tree_id:string|null;source_manifest_digest:string};
 job_binding:RunnerPreparationJobBinding;
 staging:RunnerStagingReference[];
 target_binding?:Record<string,unknown>;
}
export interface RunnerPreparationPlan extends RunnerPreparationInput {
 operation_id:string;session_id:string;reservation_id:string;repository_id:string;timeout_ms:number;target_binding_id:string;
}
declare const permitBrand:unique symbol;
export interface RunnerRemotePermit {readonly [permitBrand]:true}
export interface CapturedBytes {bytes:Uint8Array;digest:string;size_bytes:string;complete:boolean}
export interface RunnerRemoteResult {
 execution_plane:'REMOTE';truncated:boolean;started_at:string;ended_at:string;duration_ms:number;
 source_manifest_digest:string;source_state_digest:string;source_object_id:string;source_tree_id:string;source_provenance_digest?:string;workspace_path:string;
 outcome:'SUCCEEDED'|'FAILED'|'UNKNOWN';status:'COMPLETED'|'TIMED_OUT'|'UNKNOWN';
 operation_id:string;session_id:string;organisation_id:string;run_id:string;
 repository_id:string;sandbox_id:string;boot_id:string;boot_generation:string;
 sandbox_boot_generation:string;slot_id:string;slot_generation:string;
 provider:string;native_resource_id:string;process_ref:string;start_identity:unknown;
 argv:string[];cwd:string;source_digest:string;policy_digest:string;
 executable_digest:string;environment_digest:string;exit_code:number|null;
 signal:number|null;timed_out:boolean;interrupted:boolean;
 stdout:CapturedBytes;stderr:CapturedBytes;stdout_digest:string;stderr_digest:string;
 spool_digest:string;output_complete:boolean;
 artifacts:Array<{path:string;bytes:Uint8Array;digest:string;size_bytes:string;complete:boolean}>;
 cleanup_status:'CONFIRMED'|'UNKNOWN';
 cleanup:{complete:boolean;observed_process_absent:boolean;receipt_digest:string};
}
export interface RunnerRemote {
 prepare(tx:PrimaryTransaction,invocation:InvocationContext,plan:RunnerRemotePlan):Promise<RunnerRemotePermit>;
 execute(permit:RunnerRemotePermit,signal:AbortSignal):Promise<RunnerRemoteResult>;
 recover(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerRemotePlan):Promise<RunnerRemotePermit>;
}
interface Binding extends Record<string,any> {
 organisation_id:string;run_id:string;session_id:string;credential_id:string;
 sandbox_id:string;boot_generation:string;boot_id:string;slot_id:string;
 preparation_digest:string;source_digest:string;workspace_path:string;
}
interface ProviderExecution {
 registerRunnerBindingVerifier(reader:(tx:PrimaryTransaction,binding:Record<string,unknown>)=>Promise<{evidence_digest:string;observed_at:string}|null>):void;
 executeBound(request:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,any>>;
}
interface Resources {
 assertJobReservation(tx:PrimaryTransaction,input:Record<string,unknown>):Promise<Record<string,any>>;
 readJobAllocation(tx:PrimaryTransaction,input:Record<string,unknown>):Promise<Record<string,any>|null>;
}
const isRemote=(v:unknown):v is RunnerRemote=>object(v)&&typeof v.prepare==='function'&&typeof v.execute==='function';
const isResources=(v:unknown):v is Resources=>object(v)&&typeof v.assertJobReservation==='function'&&typeof v.readJobAllocation==='function';
const isProvider=(v:unknown):v is ProviderExecution=>object(v)&&typeof v.executeBound==='function'&&typeof v.registerRunnerBindingVerifier==='function';
export interface RunnerPreparation {prepare(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerPreparationPlan):Promise<RunnerRemotePermit>;execute(permit:RunnerRemotePermit,signal:AbortSignal):Promise<RunnerRemoteResult>;assertJobAdmission(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerPreparationPlan):Promise<void>;
 /** Native preparation-stage receipts (12.4): verify against the committed plan, persist idempotently, read back. */
 verifyReceipt(bytes:Buffer,plan:PreparationReceiptPlan):VerifiedPreparationReceipt;recordReceipt(tx:PrimaryTransaction,i:InvocationContext,input:{operation_id:string;receipt_base64:string}):Promise<Record<string,unknown>>;readReceipt(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;operation_id:string}):Promise<Record<string,unknown>|null>}
export function requireRunnerPreparation(ctx:ComponentContext):RunnerPreparation{return ctx.dependencies.require('12.4','runner.preparation.v1',(v:unknown):v is RunnerPreparation=>object(v)&&typeof v.prepare==='function'&&typeof v.execute==='function');}
export function requireRunnerRemote(ctx:ComponentContext):RunnerRemote {
 return ctx.dependencies.require('12.4','runner.remote.v1',isRemote);
}
export function runnerCanonical(v:unknown):string {
 if(v instanceof Date)return JSON.stringify(v.toISOString());
 if(v===null||typeof v!=='object')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(runnerCanonical).join(',')+']';
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+runnerCanonical((v as Record<string,unknown>)[k])).join(',')+'}';
}
function safeRelative(v:string):boolean {return v!==''&&!path.posix.isAbsolute(v)&&!v.includes('\\')&&!/[\x00-\x1f]/.test(v)&&v.split('/').every(p=>p!==''&&p!=='.'&&p!=='..');}
function absolute(v:unknown):v is string {return typeof v==='string'&&v.startsWith('/')&&!v.includes('\\')&&!/[\x00-\x1f]/.test(v)&&v.split('/').slice(1).every(p=>p!==''&&p!=='.'&&p!=='..');}
function digest(v:unknown):v is string{return typeof v==='string'&&DIGEST.test(v);}
async function schema(ctx:ComponentContext):Promise<void> {
 const bytes=await fs.readFile(new URL('../../migrations/0012-runner-registry.sql',import.meta.url));
 await gatewayOf(ctx).withPrimaryTransaction({timeoutMs:5000},async tx=>{
  const r=(await tx.query('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=12')).rows[0];
  if(!r||r.name!=='0012-runner-registry'||r.checksum!==hash(bytes))fail('RUNNER_SCHEMA_REQUIRED','Apply the exact runner migration through the migration authority');
 });
}
export async function readRunnerBinding(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;session_id:string}):Promise<Binding> {
 assertPrimaryTransaction(tx);
 const r=(await tx.query(`SELECT r.*,s.pool_id,s.native_sandbox_id AS external_sandbox_id,p.provider,w.capacity_kind,
 c.public_key_b64,c.state AS credential_state,c.expires_at AS credential_expires_at,
 st.heartbeat_at,clock_timestamp() AS db_now FROM hyperfide.runner_registry r
 JOIN hyperfide.sandboxes s ON s.organisation_id=r.organisation_id AND s.id=r.sandbox_id AND s.boot_generation=r.boot_generation
 JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation AND b.boot_id=r.boot_id
 JOIN hyperfide.worker_slots w ON w.organisation_id=r.organisation_id AND w.id=r.slot_id AND w.sandbox_id=r.sandbox_id AND w.boot_generation=r.boot_generation
 JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id
 JOIN hyperfide.identity_principals c ON c.credential_id=r.credential_id AND c.organisation_id=r.organisation_id AND c.run_id=r.run_id AND c.role='RUNNER' AND c.sandbox_id=r.sandbox_id AND c.boot_id=r.boot_id AND c.boot_generation=r.boot_generation
 JOIN hyperfide.identity_runner_status st ON st.credential_id=c.credential_id AND st.preparation_digest=r.boot_preparation_digest
 WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.session_id=$3 AND r.state='CURRENT'
 AND s.observed_state='RUNNING' AND w.state IN('READY','ALLOCATED','DRAINING') FOR SHARE OF r,s,b,w,c,st`,[scope.organisation_id,scope.run_id,scope.session_id])).rows[0];
 if(!r||r.credential_state!=='ACTIVE'||new Date(r.credential_expires_at).getTime()<=new Date(r.db_now).getTime()||new Date(r.heartbeat_at).getTime()+90000<=new Date(r.db_now).getTime())fail('RUNNER_NOT_CURRENT','Current authenticated runner/boot/slot observation required');
 r.boot_generation=String(r.boot_generation);r.slot_generation=String(r.slot_generation);r.registration_version=String(r.registration_version);
 return r as Binding;
}
export async function readRunnerPreparationBinding(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;session_id:string}):Promise<Binding> {
 assertPrimaryTransaction(tx);
 const row=(await tx.query(`SELECT r.*,s.pool_id,s.native_sandbox_id AS external_sandbox_id,p.provider,w.capacity_kind,c.public_key_b64,
 clock_timestamp() AS db_now FROM hyperfide.runner_registry r
 JOIN hyperfide.sandboxes s ON s.organisation_id=r.organisation_id AND s.id=r.sandbox_id AND s.boot_generation=r.boot_generation
 JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation AND b.boot_id=r.boot_id
 JOIN hyperfide.worker_slots w ON w.organisation_id=r.organisation_id AND w.id=r.slot_id AND w.sandbox_id=r.sandbox_id AND w.boot_generation=r.boot_generation
 JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id
 JOIN hyperfide.environment_profiles ep ON ep.organisation_id=p.organisation_id AND ep.id=p.profile_id
 JOIN hyperfide.identity_principals c ON c.credential_id=r.credential_id AND c.organisation_id=r.organisation_id AND c.run_id=r.run_id AND c.role='RUNNER' AND c.sandbox_id=r.sandbox_id AND c.boot_id=r.boot_id AND c.boot_generation=r.boot_generation
 JOIN hyperfide.identity_runner_status st ON st.credential_id=c.credential_id
 WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.session_id=$3 AND r.state IN('PREPARING','CURRENT') AND s.observed_state='RUNNING'
 AND w.state IN('READY','ALLOCATED') AND r.boot_preparation_digest=s.preparation_digest AND st.preparation_digest=s.preparation_digest
 AND ep.content_digest=s.preparation_digest AND c.state='ACTIVE' AND c.expires_at>clock_timestamp()
 AND st.heartbeat_at>clock_timestamp()-interval '90 seconds' FOR SHARE OF r,s,b,w,p,ep,c,st`,[scope.organisation_id,scope.run_id,scope.session_id])).rows[0];
 if(!row||!object(row.preparation_recipes))fail('RUNNER_PREPARATION_UNAVAILABLE','Bound live runner and approved parent preparation identity required');
 row.boot_generation=String(row.boot_generation);row.slot_generation=String(row.slot_generation);row.registration_version=String(row.registration_version);return row as Binding;
}
export async function readRunnerReadiness(tx:PrimaryTransaction,r:Binding):Promise<Record<string,any>> {
 const request={organisation_id:r.organisation_id,run_id:r.run_id,sandbox_id:r.sandbox_id,boot_generation:r.boot_generation,slot_id:r.slot_id,boot_preparation_digest:String(r.boot_preparation_digest),preparation_digest:r.preparation_digest,source_digest:r.source_digest};const result=await readRuntimeReadiness(tx,request);
 if(!result||result.readiness_digest!==r.readiness_digest||result.source_object_id!==r.source_object_id||result.source_tree_id!==r.source_tree_id)fail('RUNNER_READINESS_STALE','Actual current source-specific runtime readiness required');
 return result;
}
async function observe(tx:PrimaryTransaction,v:Record<string,unknown>,i:InvocationContext):Promise<unknown> {
 if(i.principal.role!=='RUNNER')fail('ROLE_DENIED','Only the bound authenticated runner reports its physical observation');
 exact(v,['session_id','slot_id','repository_id','launch_id','state_dir','runner_binary','workspace_path','home_path','tmp_path','runner_binary_digest','preparation_digest','readiness_digest','source_digest','source_object_id','source_tree_id','slot_generation','uid','gid']);
 const p=i.principal;
 if(!uuid(v.session_id)||!uuid(v.slot_id)||!uuid(v.repository_id)||v.launch_id!==null&&!uuid(v.launch_id)||!absolute(v.state_dir)||!absolute(v.runner_binary)||!absolute(v.workspace_path)||!absolute(v.home_path)||!absolute(v.tmp_path)||![v.runner_binary_digest,v.preparation_digest,v.readiness_digest,v.source_digest].every(digest)||typeof v.source_object_id!=='string'||!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(v.source_object_id)||typeof v.source_tree_id!=='string'||!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(v.source_tree_id)||!decimal(v.slot_generation,true)||!Number.isInteger(v.uid)||Number(v.uid)<1||!Number.isInteger(v.gid)||Number(v.gid)<1)fail('INVALID_REQUEST','Invalid bounded runner observation');
 const inventory=(await tx.query('SELECT inventory FROM hyperfide.identity_runner_status WHERE credential_id=$1 FOR SHARE',[p.credential_id])).rows[0]?.inventory;
 if(!Array.isArray(inventory)||!inventory.some(item=>runnerCanonical(item)===runnerCanonical(v)))fail('RUNNER_OBSERVATION_UNREGISTERED','Observation must match the authenticated registered slot inventory');
 const seed=(await tx.query('SELECT preparation_digest FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND boot_generation=$3 FOR SHARE',[p.organisation_id,p.sandbox_id,p.boot_generation])).rows[0];
 if(!seed?.preparation_digest)fail('RUNNER_BOOT_PREPARATION_UNKNOWN','Current immutable sandbox seed required');
 const readinessRequest={organisation_id:p.organisation_id,run_id:p.run_id,sandbox_id:p.sandbox_id!,boot_generation:p.boot_generation!,slot_id:v.slot_id,boot_preparation_digest:String(seed.preparation_digest),preparation_digest:v.preparation_digest as string,source_digest:v.source_digest as string};
 const ready=await readRuntimeReadiness(tx,readinessRequest);
 if(!ready||ready.readiness_digest!==v.readiness_digest||ready.source_object_id!==v.source_object_id||ready.source_tree_id!==v.source_tree_id)fail('RUNNER_READINESS_STALE','Source-specific actual runtime readiness proof is required');
 const r=(await tx.query(`INSERT INTO hyperfide.runner_registry(organisation_id,run_id,session_id,credential_id,sandbox_id,boot_generation,boot_id,slot_id,repository_id,launch_id,state_dir,runner_binary,workspace_path,runner_binary_digest,boot_preparation_digest,preparation_digest,readiness_digest,source_digest,source_object_id,source_tree_id,slot_generation,uid,gid,observation_digest,home_path,tmp_path)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,(SELECT preparation_digest FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$5 AND boot_generation=$6),$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
 ON CONFLICT(organisation_id,run_id,session_id) DO UPDATE SET state=\'CURRENT\',credential_id=EXCLUDED.credential_id,launch_id=EXCLUDED.launch_id,boot_preparation_digest=EXCLUDED.boot_preparation_digest,preparation_digest=EXCLUDED.preparation_digest,readiness_digest=EXCLUDED.readiness_digest,source_digest=EXCLUDED.source_digest,source_object_id=EXCLUDED.source_object_id,source_tree_id=EXCLUDED.source_tree_id,observation_digest=EXCLUDED.observation_digest,registration_version=hyperfide.runner_registry.registration_version+1,observed_at=clock_timestamp()
 WHERE hyperfide.runner_registry.sandbox_id=EXCLUDED.sandbox_id AND hyperfide.runner_registry.boot_generation=EXCLUDED.boot_generation AND hyperfide.runner_registry.boot_id=EXCLUDED.boot_id AND hyperfide.runner_registry.slot_id=EXCLUDED.slot_id AND hyperfide.runner_registry.state_dir=EXCLUDED.state_dir AND hyperfide.runner_registry.runner_binary=EXCLUDED.runner_binary AND hyperfide.runner_registry.workspace_path=EXCLUDED.workspace_path AND hyperfide.runner_registry.repository_id=EXCLUDED.repository_id AND hyperfide.runner_registry.home_path=EXCLUDED.home_path AND hyperfide.runner_registry.tmp_path=EXCLUDED.tmp_path AND hyperfide.runner_registry.uid=EXCLUDED.uid AND hyperfide.runner_registry.gid=EXCLUDED.gid
 RETURNING registration_version,observed_at`,[p.organisation_id,p.run_id,v.session_id,p.credential_id,p.sandbox_id,p.boot_generation,p.boot_id,v.slot_id,v.repository_id,v.launch_id,v.state_dir,v.runner_binary,v.workspace_path,v.runner_binary_digest,v.preparation_digest,v.readiness_digest,v.source_digest,v.source_object_id,v.source_tree_id,v.slot_generation,v.uid,v.gid,hash(runnerCanonical(v)),v.home_path,v.tmp_path])).rows[0];
 if(!r)fail('RUNNER_REGISTRATION_CONFLICT','Runner cannot overwrite a different slot/process registry identity');
 return {registered:true,runner_session_id:v.session_id,registration_version:String(r.registration_version),observed_at:new Date(r.observed_at).toISOString(),authority:'OBSERVATION_ONLY',task_qualified:false};
}

export type RunnerJobNamespace='QUALIFICATION'|'REPRODUCTION'|'CANDIDATE'|'CHECKPOINT'|'PREWARM';
export interface RunnerPreparationJobBinding {
 namespace:RunnerJobNamespace;job_id:string;lease_generation:string;reservation_id:string;input_packet_digest:string;input_manifest_digest:string;
}
export interface RunnerPreparationAdmission {
 authority:'EXPECTED_JOB_AUTHORITY';job_binding:RunnerPreparationJobBinding;source:RunnerPreparationInput['source'];repository_id:string;job_kind:'PREPARATION'|'CHECKPOINT';
}
export type RunnerPreparationAdmissionReader=(tx:PrimaryTransaction,i:InvocationContext,request:RunnerPreparationPlan)=>Promise<RunnerPreparationAdmission|null>;
export interface RunnerEnvironmentRequest {
 job_namespace?:RunnerJobNamespace;job_id:string;lease_generation?:string;reservation_id:string;
 input_manifest_digest?:string;environment_digest:string;
}
export interface RunnerExpectedInputs {
 authority:'EXPECTED_AUTHORITY';namespace:RunnerJobNamespace;organisation_id:string;run_id:string;
 job_id:string;lease_generation?:string;reservation_id:string;runner_session_id:string;
 input_manifest_digest:string;input_packet_digest:string;input_manifest:Record<string,unknown>;
 profile_id:string;profile_digest:string;preparation_digest:string;
 repository_id:string;source_manifest_digest:string;source_object_id:string;source_tree_id:string;
 source_state_digest:string;workspace_digest:string;environment_digest:string;
 receipt_digest:string;baseline_packet_digest?:string;effective_result_input_receipt_digest?:string;
 custody_id?:string;custody_generation?:string;
}
export type RunnerInputReader=(tx:PrimaryTransaction,i:InvocationContext,request:RunnerEnvironmentRequest)=>Promise<RunnerExpectedInputs|null>;
async function verifyEnvironment(tx:PrimaryTransaction,i:InvocationContext,v:RunnerEnvironmentRequest,
 readers:ReadonlyMap<RunnerJobNamespace,RunnerInputReader>):Promise<unknown>{
 assertPrimaryTransaction(tx);assertInvocation(i);
 const namespace=v.job_namespace??'QUALIFICATION';
 if(!['QUALIFICATION','REPRODUCTION','CANDIDATE','CHECKPOINT','PREWARM'].includes(namespace)||!uuid(v.job_id)||!uuid(v.reservation_id)||!digest(v.environment_digest)||
    v.lease_generation!==undefined&&!decimal(v.lease_generation,true)||v.input_manifest_digest!==undefined&&!digest(v.input_manifest_digest))
  fail('QUALIFICATION_ENVIRONMENT_DENIED','Exact namespace-bound immutable job inputs required');
 const reader=readers.get(namespace);if(!reader)fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Trusted job input reader is not registered for this namespace');
 const expected=await reader(tx,i,v);await i.guard(tx);const p=i.principal;
 if(!expected||expected.authority!=='EXPECTED_AUTHORITY'||expected.namespace!==namespace||expected.organisation_id!==p.organisation_id||
 expected.run_id!==p.run_id||expected.job_id!==v.job_id||expected.reservation_id!==v.reservation_id||
 v.lease_generation!==undefined&&expected.lease_generation!==v.lease_generation||
 v.input_manifest_digest!==undefined&&expected.input_manifest_digest!==v.input_manifest_digest||
 expected.environment_digest!==v.environment_digest||!uuid(expected.runner_session_id)||!uuid(expected.repository_id)||
 !object(expected.input_manifest)||!['dependency','toolchain','configuration','graph','contract'].every(key=>key in expected.input_manifest)||
 ![expected.input_manifest_digest,expected.input_packet_digest,expected.profile_digest,expected.preparation_digest,
 expected.source_manifest_digest,expected.source_state_digest,expected.workspace_digest,expected.environment_digest,expected.receipt_digest].every(digest))
  fail('QUALIFICATION_ENVIRONMENT_DENIED','Trusted expected-input receipt is incomplete or differs from the assigned job');
 const r=await readRunnerBinding(tx,{organisation_id:p.organisation_id,run_id:p.run_id,session_id:expected.runner_session_id});
 const ready=await readRunnerReadiness(tx,r);
 if(r.repository_id!==expected.repository_id||r.source_object_id!==expected.source_object_id||r.source_tree_id!==expected.source_tree_id||
 r.source_digest!==expected.source_manifest_digest||r.preparation_digest!==expected.preparation_digest||
 ready.profile_id!==expected.profile_id||ready.profile_digest!==expected.profile_digest||
 ready.source_state_digest!==expected.source_state_digest||ready.workspace_digest!==expected.workspace_digest)
  fail('QUALIFICATION_MEASURED_INPUT_MISMATCH','Current physical workspace differs from the immutable prepared-input receipt');
 const descriptor={status:'VERIFIED',namespace,job_id:v.job_id,lease_generation:expected.lease_generation??null,
 input_manifest_digest:expected.input_manifest_digest,input_packet_digest:expected.input_packet_digest,input_manifest:expected.input_manifest,
 baseline_packet_digest:expected.baseline_packet_digest??null,effective_result_input_receipt_digest:expected.effective_result_input_receipt_digest??null,
 environment_digest:expected.environment_digest,expected_receipt_digest:expected.receipt_digest,
 runner_session_id:r.session_id,sandbox_id:r.sandbox_id,boot_id:r.boot_id,boot_generation:r.boot_generation,slot_id:r.slot_id,
 repository_id:r.repository_id,source_manifest_digest:r.source_digest,source_state_digest:ready.source_state_digest,
 workspace_digest:ready.workspace_digest,profile_digest:ready.profile_digest,preparation_digest:r.preparation_digest,
 readiness_digest:r.readiness_digest,provider_observation_id:ready.id};
 const input_validation=Object.freeze({...descriptor,receipt_digest:hash(runnerCanonical(descriptor))});
 return Object.freeze({runner_session_id:r.session_id,workspace_path:r.workspace_path,sandbox_id:r.sandbox_id,boot_id:r.boot_id,
 boot_generation:r.boot_generation,slot_id:r.slot_id,preparation_digest:r.preparation_digest,readiness_digest:r.readiness_digest,
 provider_observation_id:ready.id,runner_credential_id:r.credential_id,source_object_id:r.source_object_id,source_tree_id:r.source_tree_id,
 source_digest:r.source_digest,source_manifest_digest:r.source_digest,source_state_digest:ready.source_state_digest,
 workspace_digest:ready.workspace_digest,input_validation});
}
export async function createComponent(ctx:ComponentContext):Promise<Component> {
 await schema(ctx);
 const readers=new Map<RunnerJobNamespace,RunnerInputReader>();
 const admissionReaders=new Map<RunnerJobNamespace,RunnerPreparationAdmissionReader>();
 const environment=Object.freeze({
 registerPreparationAdmissionReader:(namespace:RunnerJobNamespace,reader:RunnerPreparationAdmissionReader)=>{
  if(!['QUALIFICATION','REPRODUCTION','CANDIDATE','CHECKPOINT','PREWARM'].includes(namespace)||typeof reader!=='function'||admissionReaders.has(namespace))fail('RUNNER_INPUT_READER_CONFLICT','One trusted semantic preparation admission reader owns each namespace');
  admissionReaders.set(namespace,reader);return()=>{if(admissionReaders.get(namespace)===reader)admissionReaders.delete(namespace);};
 },
 admitPreparation:async(tx:PrimaryTransaction,i:InvocationContext,request:RunnerPreparationPlan)=>{
  assertPrimaryTransaction(tx);assertInvocation(i);const reader=admissionReaders.get(request.job_binding.namespace);
  if(!reader)fail('PREPARATION_JOB_AUTHORITY_UNAVAILABLE','Trusted semantic preparation job reader is not registered');
  const admitted=await reader(tx,i,request);await i.guard(tx);
  if(!admitted||admitted.authority!=='EXPECTED_JOB_AUTHORITY'||runnerCanonical(admitted.job_binding)!==runnerCanonical(request.job_binding)||runnerCanonical(admitted.source)!==runnerCanonical(request.source)||admitted.repository_id!==request.repository_id||admitted.job_kind!==(request.recipe_id==='checkpoint.restore.v1'?'CHECKPOINT':'PREPARATION'))fail('PREPARATION_JOB_AUTHORITY_DENIED','Actual semantic job admission differs from the immutable preparation plan');
  return admitted;
 },verify:(tx:PrimaryTransaction,i:InvocationContext,v:RunnerEnvironmentRequest)=>verifyEnvironment(tx,i,v,readers),
 registerInputReader:(namespace:RunnerJobNamespace,reader:RunnerInputReader)=>{
  if(!['QUALIFICATION','REPRODUCTION','CANDIDATE','CHECKPOINT','PREWARM'].includes(namespace)||typeof reader!=='function'||readers.has(namespace))fail('RUNNER_INPUT_READER_CONFLICT','One trusted input reader owns each job namespace');
  readers.set(namespace,reader);return()=>{if(readers.get(namespace)===reader)readers.delete(namespace);};
 }});
 const registry=Object.freeze({lookup:readRunnerBinding,lookupSlot:async(tx:PrimaryTransaction,v:{organisation_id:string;run_id:string;sandbox_id:string;slot_id:string;boot_generation:string;preparation_digest:string})=>{
 assertPrimaryTransaction(tx);
 const rows=(await tx.query("SELECT session_id FROM hyperfide.runner_registry WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND slot_id=$4 AND boot_generation=$5 AND state='CURRENT'",[v.organisation_id,v.run_id,v.sandbox_id,v.slot_id,v.boot_generation])).rows;
 if(rows.length!==1)return null;
 const r=await readRunnerBinding(tx,{organisation_id:v.organisation_id,run_id:v.run_id,session_id:rows[0]!.session_id});
 if(r.preparation_digest!==v.preparation_digest||!absolute(r.home_path)||!absolute(r.tmp_path))return null;
 const ready=await readRunnerReadiness(tx,r);return Object.freeze({...r,profile_id:ready.profile_id,profile_digest:ready.profile_digest,source_state_digest:ready.source_state_digest,workspace_digest:ready.workspace_digest});
},lookupPreparation:readRunnerPreparationBinding,lookupSandbox:async(tx:PrimaryTransaction,v:{organisation_id:string;run_id:string;sandbox_id:string;boot_generation:string})=>{
 const rows=(await tx.query("SELECT session_id FROM hyperfide.runner_registry WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND boot_generation=$4 AND state='CURRENT' ORDER BY session_id",[v.organisation_id,v.run_id,v.sandbox_id,v.boot_generation])).rows;
 if(rows.length!==1)return null;return readRunnerBinding(tx,{organisation_id:v.organisation_id,run_id:v.run_id,session_id:rows[0]!.session_id});},
verifyBinding:async(tx:PrimaryTransaction,v:Record<string,unknown>)=>{try{const r=await readRunnerBinding(tx,v as any);return {evidence_digest:r.observation_digest,observed_at:new Date(r.db_now).toISOString()};}catch{return null;}}});
 return {apiVersion:1,capabilities:{'runner.registry.v1':registry,'qualification.environment.v1':environment},actions:{
  'runner.registry.observe':(v,context)=>identityTransaction(context,(tx,i)=>{if(!object(v))fail('INVALID_REQUEST','Object required');return observe(tx as PrimaryTransaction,v,i);}),
  'runner.registry.prepare':(v,context)=>identityTransaction(context,async(tx,i)=>{
   if(!object(v)||i.principal.role!=='RUNNER')fail('ROLE_DENIED','Actual bound runner preparation observation required');
   exact(v,['session_id','slot_id','repository_id','state_dir','runner_binary','workspace_path','home_path','tmp_path','runner_binary_digest','preparation_digest','slot_generation','uid','gid','preparation_recipes']);
   if(!uuid(v.session_id)||!uuid(v.slot_id)||!uuid(v.repository_id)||![v.state_dir,v.runner_binary,v.workspace_path,v.home_path,v.tmp_path].every(absolute)||![v.runner_binary_digest,v.preparation_digest].every(digest)||!decimal(v.slot_generation,true)||!Number.isSafeInteger(v.uid)||Number(v.uid)<=0||!Number.isSafeInteger(v.gid)||Number(v.gid)<=0||!object(v.preparation_recipes)||!Object.keys(v.preparation_recipes).length)fail('INVALID_REQUEST','Bound preparation registry identity required');
   for(const [name,item] of Object.entries(v.preparation_recipes)){
    if(!['environment.prepare.v1','checkpoint.restore.v1'].includes(name)||!object(item))fail('INVALID_REQUEST','Only release-owned preparation recipes are accepted');
    exact(item,['node_path','node_digest','recipe_path','recipe_digest','native_path','native_digest','base_root','max_stage_bytes','readiness_context','sealing']);
    if(!decimal(item.max_stage_bytes,true)||BigInt(item.max_stage_bytes)>68719476736n||![item.node_path,item.recipe_path,item.native_path,item.base_root].every(absolute)||![item.node_digest,item.recipe_digest,item.native_digest].every(digest))fail('INVALID_REQUEST','Pinned trusted recipe files required');
    if(!object(item.readiness_context)||!uuid(item.readiness_context.artifact_id)||!digest(item.readiness_context.digest)||!decimal(item.readiness_context.size_bytes,true)||BigInt(item.readiness_context.size_bytes)>262144n)fail('INVALID_REQUEST','Independently approved readiness context artifact required');
    exact(item.readiness_context,['artifact_id','digest','size_bytes']);
    if(!object(item.sealing)||![item.sealing.node_path,item.sealing.script_path].every(absolute)||![item.sealing.node_digest,item.sealing.script_digest].every(digest)||item.sealing.node_path!==item.node_path||item.sealing.node_digest!==item.node_digest||!Array.isArray(item.sealing.module_closure)||!item.sealing.module_closure.length||item.sealing.module_closure.length>32)fail('INVALID_REQUEST','Protected byte-only seal code closure required');
    exact(item.sealing,['node_path','node_digest','script_path','script_digest','module_closure']);
    const closure=new Set<string>();for(const module of item.sealing.module_closure){if(!object(module)||!absolute(module.path)||!digest(module.digest)||closure.has(module.path))fail('INVALID_REQUEST','Exact independent seal module pins required');exact(module,['path','digest']);closure.add(module.path);}
    const sealing=item.sealing;
    if(!(sealing.module_closure as unknown[]).some((module:unknown)=>object(module)&&module.path===sealing.script_path&&module.digest===sealing.script_digest))fail('INVALID_REQUEST','Seal entry must belong to the approved complete code closure');

   }
   const policy=await approvedRecipePolicy(ctx,tx as PrimaryTransaction,i);if(runnerCanonical(policy.recipes)!==runnerCanonical(v.preparation_recipes))fail('RUNNER_RECIPE_POLICY_INVALID','RUNNER inventory cannot approve its own executable recipes');
   const p=i.principal,inventory=(await tx.query('SELECT inventory FROM hyperfide.identity_runner_status WHERE credential_id=$1 FOR SHARE',[p.credential_id])).rows[0]?.inventory;
   if(!Array.isArray(inventory)||!inventory.some(item=>runnerCanonical(item)===runnerCanonical(v)))fail('RUNNER_OBSERVATION_UNREGISTERED','Exact authenticated boot inventory required');
   const base=(await tx.query(`SELECT s.preparation_digest,ep.content_digest FROM hyperfide.sandboxes s JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id JOIN hyperfide.environment_profiles ep ON ep.organisation_id=p.organisation_id AND ep.id=p.profile_id JOIN hyperfide.worker_slots w ON w.organisation_id=s.organisation_id AND w.sandbox_id=s.id AND w.boot_generation=s.boot_generation WHERE s.organisation_id=$1 AND s.id=$2 AND s.boot_generation=$3 AND w.id=$4 FOR SHARE OF s,p,ep,w`,[p.organisation_id,p.sandbox_id,p.boot_generation,v.slot_id])).rows[0];
   if(!base||base.preparation_digest!==v.preparation_digest||base.content_digest!==v.preparation_digest)fail('RUNNER_PREPARATION_UNAVAILABLE','Current accepted parent profile required');
   const result=await tx.query(`INSERT INTO hyperfide.runner_registry(organisation_id,run_id,session_id,credential_id,sandbox_id,boot_generation,boot_id,slot_id,repository_id,state_dir,runner_binary,workspace_path,runner_binary_digest,boot_preparation_digest,preparation_digest,slot_generation,uid,gid,preparation_recipes,preparation_policy_digest,observation_digest,home_path,tmp_path,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17,$18,$19,$20,$21,$22,'PREPARING') ON CONFLICT(organisation_id,run_id,session_id) DO NOTHING`,[p.organisation_id,p.run_id,v.session_id,p.credential_id,p.sandbox_id,p.boot_generation,p.boot_id,v.slot_id,v.repository_id,v.state_dir,v.runner_binary,v.workspace_path,v.runner_binary_digest,v.preparation_digest,v.slot_generation,v.uid,v.gid,JSON.stringify(v.preparation_recipes),policy.digest,hash(runnerCanonical(v)),v.home_path,v.tmp_path]);
   const current=await readRunnerPreparationBinding(tx as PrimaryTransaction,{organisation_id:p.organisation_id,run_id:p.run_id,session_id:v.session_id as string});
   if(current.observation_digest!==hash(runnerCanonical(v)))fail('RUNNER_REGISTRATION_CONFLICT','Prepared boot identity cannot change');
   return {registered:true,inserted:result.rowCount===1,runner_session_id:v.session_id,state:'PREPARING',ready:false,authority:'OBSERVATION_ONLY'};
  }),
  'runner.registry.describe':async(_v,context)=>{const i=invocationOf(context);return {protocol_version:1,organisation_id:i.principal.organisation_id,run_id:i.principal.run_id,authority:'OBSERVATION_ONLY'};}
 }};
}
async function approvedRecipePolicy(ctx:ComponentContext,tx:PrimaryTransaction,i:InvocationContext,target?:Binding):Promise<{digest:string;recipes:Record<string,any>}> {
 const file=ctx.env.HF_RUNNER_PREPARATION_RECIPES_FILE,pin=ctx.env.HF_RUNNER_PREPARATION_RECIPES_DIGEST;
 if(!absolute(file)||!digest(pin))fail('RUNNER_RECIPE_POLICY_REQUIRED','Independently pinned deployment recipe policy required');
 let ancestor=path.dirname(file);
 for(;;){const st=await fs.lstat(ancestor);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==(process.getuid?.()??0)||(st.mode&0o022)!==0)fail('RUNNER_RECIPE_POLICY_INVALID','Deployment policy ancestry must be protected');if(ancestor==='/')break;ancestor=path.dirname(ancestor);}
 const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
 try{const before=await fd.stat();if(!before.isFile()||before.uid!==(process.getuid?.()??0)||(before.mode&0o077)!==0||before.nlink!==1||before.size>1048576)fail('RUNNER_RECIPE_POLICY_INVALID','Protected bounded policy descriptor required');bytes=await fd.readFile();const after=await fd.stat();if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||hash(bytes)!==pin)fail('RUNNER_RECIPE_POLICY_INVALID','Policy bytes differ from trusted deployment pin');}finally{await fd.close();}
 const parsed=strictJSON(bytes!);if(!object(parsed)||parsed.schema_version!==1||!Array.isArray(parsed.policies))fail('RUNNER_RECIPE_POLICY_INVALID','Deployment recipe policy required');
 const p=i.principal,entries=parsed.policies.filter(v=>object(v)&&v.organisation_id===p.organisation_id&&v.run_id===p.run_id&&v.authority_epoch===p.deployment_epoch);
 if(entries.length!==1||!object(entries[0])||!Array.isArray(entries[0].base_profiles)||!object(entries[0].recipes))fail('RUNNER_RECIPE_POLICY_INVALID','Unique current organisation/run authority policy required');
 const item=entries[0];if(target&&(target.organisation_id!==p.organisation_id||target.run_id!==p.run_id))fail('RUNNER_RECIPE_POLICY_INVALID','Target is outside authenticated scope');const base=(await tx.query('SELECT p.profile_id,s.preparation_digest FROM hyperfide.sandboxes s JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id WHERE s.organisation_id=$1 AND s.id=$2 AND s.boot_generation=$3 FOR SHARE OF s,p',[p.organisation_id,target?.sandbox_id??p.sandbox_id,target?.boot_generation??p.boot_generation])).rows[0];
 if(!base||!(item.base_profiles as unknown[]).some((v:unknown)=>object(v)&&v.profile_id===base.profile_id&&v.preparation_digest===base.preparation_digest))fail('RUNNER_RECIPE_POLICY_INVALID','Actual parent pool profile is not approved by deployment policy');
 return {digest:pin,recipes:item.recipes as Record<string,any>};
}
const permits=new WeakMap<object,{context:ComponentContext;plan:RunnerRemotePlan;binding:Binding;principal:Principal;invocation:InvocationContext;digest:string}>();
function validatePlan(plan:RunnerRemotePlan):void {
 if(!object(plan)||![plan.session_id,plan.operation_id,plan.repository_id,plan.reservation_id].every(uuid)||plan.job_id!==undefined&&!uuid(plan.job_id)||!Array.isArray(plan.argv)||!plan.argv.length||plan.argv.length>256||typeof plan.argv[0]!=='string'||!plan.argv[0]||plan.argv.some(x=>typeof x!=='string'||x.length>4096||x.includes('\0'))||plan.cwd!=='.'&&!safeRelative(plan.cwd)||!object(plan.environment)||Object.entries(plan.environment).some(([k,v])=>!/^[A-Z][A-Z0-9_]{0,63}$/.test(k)||/^(LD_|DYLD_|HF_|HOME$|TMPDIR$|PATH$)/.test(k)||typeof v!=='string'||v.includes('\0'))||plan.stdin!==undefined&&(typeof plan.stdin!=='string'||Buffer.byteLength(plan.stdin)>65536)||!Number.isInteger(plan.timeout_ms)||plan.timeout_ms<1||plan.timeout_ms>259200000||![plan.source_digest,plan.policy_digest,plan.executable_digest,plan.environment_digest].every(digest)||!Array.isArray(plan.artifact_paths)||plan.artifact_paths.length>64||plan.artifact_paths.some(x=>typeof x!=='string'||!safeRelative(x))||new Set(plan.artifact_paths).size!==plan.artifact_paths.length)fail('INVALID_REMOTE_PLAN','Bounded immutable registered command/source/environment plan required');
 if(hash(runnerCanonical(plan.environment))!==plan.environment_digest)fail('REMOTE_ENVIRONMENT_MISMATCH','Explicit environment bytes differ from the registered digest');
}
export function runnerResultSigningBytes(org:string,run:string,op:string,plan:string,result:string):Buffer{return Buffer.from(`HYPERFIDE-RUNNER-RESULT-V1\n${org}\n${run}\n${op}\n${plan}\n${result}\n`);}

/** Read immutable15 payloads only after the SQL observation transaction closes.
 * Every child and concatenated content digest is checked again at this boundary. */
export async function resolveRunnerCapturedReference(store:ArtifactStoreCapability,i:InvocationContext,ref:unknown):Promise<CapturedBytes> {
 assertInvocation(i);
 if(!object(ref)||!['object','manifest'].includes(String(ref.storage_kind))||!uuid(ref.artifact_id)||!digest(ref.digest)||!decimal(ref.size_bytes)||typeof ref.complete!=='boolean'||BigInt(ref.size_bytes)>16777216n)fail('REMOTE_RESULT_INVALID','Bounded immutable captured-object reference required');
 const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
 const observe=async(action:string,id:string,expectedDigest:string,expectedSize?:string):Promise<Record<string,any>>=>{
  const result=await store.invoke(action,{...scope,artifact_id:id},i);
  if(!object(result)||result.outcome!=='SUCCEEDED'||result.availability!=='VERIFIED'||!object(result.artifact)||!object(result.receipt)||!digest(result.receipt.receipt_id)||result.artifact.artifact_id!==id||result.artifact.organisation_id!==scope.organisation_id||result.artifact.run_id!==scope.run_id||result.artifact.status!=='COMPLETE'||result.artifact.digest!==expectedDigest||expectedSize!==undefined&&result.artifact.size_bytes!==expectedSize)fail('REMOTE_RESULT_INVALID','Actual scoped COMPLETE artifact receipt required');
  return result;
 };
 const objectBytes=async(id:string,wanted:string,size:string):Promise<Buffer>=>{
  const result=await observe('artifact.object.read',id,wanted,size);
  if(typeof result.data_base64!=='string')fail('REMOTE_RESULT_INVALID','Full captured object bytes required');
  const bytes=Buffer.from(result.data_base64,'base64');
  if(bytes.toString('base64')!==result.data_base64||String(bytes.length)!==size||hash(bytes)!==wanted)fail('REMOTE_RESULT_INVALID','Captured object content differs');
  return bytes;
 };
 let bytes:Buffer;
 if(ref.storage_kind==='object')bytes=await objectBytes(ref.artifact_id,ref.digest,ref.size_bytes);
 else{
  if(!digest(ref.manifest_digest))fail('REMOTE_RESULT_INVALID','Manifest identity required separately from raw content digest');
  const result=await observe('artifact.manifest.read',ref.artifact_id,ref.manifest_digest),m=result.manifest;
  if(!object(m)||m.schema_version!==1||m.kind!=='chunk-manifest'||m.organisation_id!==scope.organisation_id||m.run_id!==scope.run_id||m.complete!==true||m.truncated!==false||!Array.isArray(m.missing_ranges)||m.missing_ranges.length||m.total_size_bytes!==ref.size_bytes||m.content_digest!==ref.digest||result.manifest_digest!==ref.manifest_digest||!Array.isArray(m.chunks)||m.expected_chunks!==m.chunks.length||m.chunks.length>4096)fail('REMOTE_RESULT_INVALID','Complete ordered capture manifest required');
  const chunks:Buffer[]=[];let offset=0;
  for(const [index,c] of m.chunks.entries()){
   if(!object(c)||c.sequence!==index||c.offset_bytes!==String(offset)||!uuid(c.artifact_id)||!digest(c.digest)||!decimal(c.size_bytes)||BigInt(c.size_bytes)>262144n)fail('REMOTE_RESULT_INVALID','Exact contiguous capture chunk required');
   const part=await objectBytes(c.artifact_id,c.digest,c.size_bytes);chunks.push(part);offset+=part.length;
   if(offset>16777216)fail('REMOTE_RESULT_INVALID','Captured content exceeds bound');
  }
  bytes=Buffer.concat(chunks);
 }
 if(String(bytes.length)!==ref.size_bytes||hash(bytes)!==ref.digest)fail('REMOTE_RESULT_INVALID','Concatenated captured bytes differ');
 return {bytes,digest:ref.digest,size_bytes:ref.size_bytes,complete:ref.complete};
}
async function decodeResult(row:Record<string,any>,store:ArtifactStoreCapability,i:InvocationContext,plan:RunnerRemotePlan):Promise<RunnerRemoteResult> {
 const wire=row.result;if(!object(wire))fail('REMOTE_RESULT_INVALID','Signed captured metadata required');
 for(const [key,wanted] of Object.entries({operation_id:plan.operation_id,session_id:plan.session_id,repository_id:plan.repository_id,organisation_id:i.principal.organisation_id,run_id:i.principal.run_id,argv:plan.argv,cwd:plan.cwd,source_digest:plan.source_digest,source_manifest_digest:plan.source_digest,policy_digest:plan.policy_digest,executable_digest:plan.executable_digest,environment_digest:plan.environment_digest}))if(runnerCanonical(wire[key])!==runnerCanonical(wanted))fail('REMOTE_RESULT_INVALID','Signed result differs from exact operation plan: '+key);
 if(wire.execution_plane!=='REMOTE'||!Array.isArray(wire.artifacts)||!object(wire.cleanup))fail('REMOTE_RESULT_INVALID','Physical execution and cleanup metadata required');
 const raw=await resolveRunnerCapturedReference(store,i,wire.native_receipt),native=strictJSON(Buffer.from(raw.bytes),16777216);
 if(!object(native)||raw.digest!==wire.cleanup.receipt_digest)fail('REMOTE_RESULT_INVALID','Exact native receipt content required');
 for(const key of ['operation_id','session_id','organisation_id','run_id','repository_id','sandbox_id','boot_id','boot_generation','slot_id','slot_generation','argv','workspace_path','source_manifest_digest','source_state_digest','executable_digest','environment_digest','policy_digest','started_at','ended_at','duration_ms','start_identity'])if(runnerCanonical(native[key])!==runnerCanonical(wire[key]))fail('REMOTE_RESULT_INVALID','Provisioner metadata differs from native bytes: '+key);
 const copy=structuredClone(wire) as Record<string,any>;
 for(const name of ['stdout','stderr']){
  const capture=await resolveRunnerCapturedReference(store,i,wire[name]),observed=native[name];
  if(!object(observed)||observed.digest!==capture.digest||observed.size_bytes!==capture.size_bytes||typeof observed.base64!=='string'||Buffer.from(observed.base64,'base64').toString('base64')!==observed.base64||!Buffer.from(observed.base64,'base64').equals(Buffer.from(capture.bytes))||capture.complete!==observed.complete&&capture.complete===true)fail('REMOTE_RESULT_INVALID','Captured stream differs from native bytes');
  copy[name]=capture;
 }
 if(!Array.isArray(native.artifacts)||wire.artifacts.length!==native.artifacts.length)fail('REMOTE_RESULT_INVALID','Native artifact inventory differs');
 copy.artifacts=[];
 for(const [index,item] of wire.artifacts.entries()){
  if(!object(item)||typeof item.path!=='string'||!plan.artifact_paths.includes(item.path))fail('REMOTE_RESULT_INVALID','Unexpected captured artifact');
  const capture=await resolveRunnerCapturedReference(store,i,item),n=native.artifacts[index];
  if(!object(n)||n.path!==item.path||n.digest!==capture.digest||n.size_bytes!==capture.size_bytes||typeof n.base64!=='string'||!Buffer.from(n.base64,'base64').equals(Buffer.from(capture.bytes)))fail('REMOTE_RESULT_INVALID','Captured artifact differs from native evidence');
  copy.artifacts.push({path:item.path,...capture});
 }
 if(wire.outcome==='SUCCEEDED'&&(wire.cleanup_status!=='CONFIRMED'||wire.cleanup.complete!==true||wire.cleanup.observed_process_absent!==true||native.observed_process_absent!==true||native.artifacts_complete!==true||wire.output_complete!==true||wire.truncated!==false||copy.stdout.complete!==true||copy.stderr.complete!==true||copy.artifacts.length!==plan.artifact_paths.length))fail('REMOTE_RESULT_INVALID','Successful execution requires full output and confirmed cleanup');
 return copy as RunnerRemoteResult;
}
export async function createRemoteComponent(ctx:ComponentContext):Promise<Component> {
 await schema(ctx);const resources=ctx.dependencies.require('5.1','scheduler.allocations.v1',isResources),g=gatewayOf(ctx),store=ctx.dependencies.require('15.2','artifact.store.v1',isArtifactStoreCapability),authority=ctx.dependencies.require('14.1','identity.authority',isIdentityAuthority);
 const remote:RunnerRemote=Object.freeze({
  prepare:async(tx:PrimaryTransaction,i:InvocationContext,request:RunnerRemotePlan)=>{
   assertPrimaryTransaction(tx);assertInvocation(i);await i.guard(tx);validatePlan(request);if(request.preparation!==undefined)fail('PREPARATION_CAPABILITY_REQUIRED','Use the dedicated guarded preparation primitive');
   const plan=structuredClone(request),p=i.principal;
   // An exact durable operation is inspectable after a disconnect without
   // readmitting or relaunching work, even if its original allocation expired.
   const prior=(await tx.query('SELECT * FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR SHARE',[p.organisation_id,p.run_id,plan.operation_id])).rows[0];
   if(prior){
    if(!object(prior.plan)||!object(prior.plan.binding)||runnerCanonical(prior.plan.request)!==runnerCanonical(plan)||prior.principal.actor_id!==p.actor_id||prior.principal.role!==p.role||prior.authority_epoch!==p.deployment_epoch)fail('REMOTE_OPERATION_CONFLICT','Recorded operation identity or exact immutable plan differs');
    const permit=Object.freeze({}) as RunnerRemotePermit;permits.set(permit,{context:ctx,plan,binding:prior.plan.binding as Binding,principal:p,invocation:i,digest:prior.plan_digest});return permit;
   }
   const r=await readRunnerBinding(tx,{organisation_id:p.organisation_id,run_id:p.run_id,session_id:plan.session_id});await readRunnerReadiness(tx,r);
   if(r.repository_id!==plan.repository_id||r.source_digest!==plan.source_digest)fail('REMOTE_SOURCE_MISMATCH','Registered actual source/repository differs');
   const allocation=await resources.readJobAllocation(tx,{organisation_id:p.organisation_id,run_id:p.run_id,reservation_id:plan.reservation_id});
   if(!allocation||allocation.slot_id!==r.slot_id||allocation.sandbox_id!==r.sandbox_id||String(allocation.sandbox_boot_generation)!==r.boot_generation||allocation.assignee_session_id!==p.actor_id)fail('REMOTE_JOB_ASSIGNMENT_MISMATCH','Actual dedicated reservation/slot/assignee binding required');
   const admitted=await resources.assertJobReservation(tx,{organisation_id:p.organisation_id,run_id:p.run_id,task_id:allocation.task_id,job_kind:allocation.job_kind,reservation_id:plan.reservation_id});
   const reservation=(await tx.query('SELECT expires_at,clock_timestamp() AS db_now FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state=\'ALLOCATED\' FOR SHARE',[p.organisation_id,p.run_id,plan.reservation_id])).rows[0];
   if(!reservation||new Date(reservation.expires_at).getTime()<=new Date(reservation.db_now).getTime())fail('REMOTE_RESERVATION_EXPIRED','Current allocated reservation required');
   const stableBinding=Object.fromEntries(['organisation_id','run_id','session_id','credential_id','sandbox_id','boot_id','boot_generation','slot_id','slot_generation','repository_id','launch_id','state_dir','runner_binary','runner_binary_digest','workspace_path','home_path','tmp_path','boot_preparation_digest','preparation_digest','readiness_digest','source_digest','source_object_id','source_tree_id','uid','gid','provider','pool_id','external_sandbox_id'].map(key=>[key,r[key]]));
   const stableAllocation=Object.fromEntries(['allocation_id','request_id','task_id','job_kind','reservation_id','slot_id','sandbox_id','sandbox_boot_generation','assignee_session_id','generation'].map(key=>[key,allocation[key]]));
   const checkedReadiness=await readRunnerReadiness(tx,r);
   const packet=JSON.parse(JSON.stringify({request:plan,binding:stableBinding,allocation:stableAllocation,source_state_digest:checkedReadiness.source_state_digest,workspace_digest:checkedReadiness.workspace_digest})) as Record<string,unknown>;const pin=hash(runnerCanonical(packet));
   await tx.query(`INSERT INTO hyperfide.runner_remote_jobs(organisation_id,run_id,operation_id,session_id,plan,plan_digest,principal,admission_digest,authority_epoch,reservation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,LEAST($11::timestamptz,$12::timestamptz)) ON CONFLICT(organisation_id,run_id,operation_id) DO NOTHING`,[p.organisation_id,p.run_id,plan.operation_id,plan.session_id,JSON.stringify(packet),pin,JSON.stringify(p),hash(runnerCanonical(admitted)),p.deployment_epoch,plan.reservation_id,reservation.expires_at,p.expires_at]);
   const stored=(await tx.query('SELECT plan_digest FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[p.organisation_id,p.run_id,plan.operation_id])).rows[0];if(stored?.plan_digest!==pin)fail('REMOTE_OPERATION_CONFLICT','Operation identity cannot change its immutable execution input');
   const permit=Object.freeze({}) as RunnerRemotePermit;permits.set(permit,{context:ctx,plan,binding:r,principal:p,invocation:i,digest:pin});return permit;
  },
  recover:async(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerRemotePlan)=>{
   assertPrimaryTransaction(tx);assertInvocation(i);await i.guard(tx);validatePlan(plan);
   const row=(await tx.query('SELECT operation_id FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR SHARE',[i.principal.organisation_id,i.principal.run_id,plan.operation_id])).rows[0];
   if(!row)fail('REMOTE_OPERATION_NOT_FOUND','Existing-only recovery cannot create or relaunch an operation');
   return remote.prepare(tx,i,plan);
  },
  execute:async(permit:RunnerRemotePermit,signal:AbortSignal)=>{
   const item=permits.get(permit);if(!item||item.context!==ctx)fail('REMOTE_PERMIT_REQUIRED','A genuine prepared execution permit is required');
   const deadline=performance.now()+item.plan.timeout_ms+120000;
   for(;;){if(signal.aborted)fail('REMOTE_WAIT_INTERRUPTED','Remote outcome remains reconciliable under the same operation identity');
    const row=await g.withPrimaryTransaction({timeoutMs:5000,signal},async tx=>(await tx.query('SELECT j.*,p.public_key_b64 FROM hyperfide.runner_remote_jobs j LEFT JOIN hyperfide.identity_principals p ON p.credential_id=j.executor_credential_id WHERE j.organisation_id=$1 AND j.run_id=$2 AND j.operation_id=$3',[item.principal.organisation_id,item.principal.run_id,item.plan.operation_id])).rows[0]);
    if(!row)fail('REMOTE_INTENT_NOT_COMMITTED','Execution intent must commit before execute');if(row.plan_digest!==item.digest)fail('REMOTE_OPERATION_CONFLICT','Execution plan changed');
    if(row.state==='UNKNOWN')fail('REMOTE_OUTCOME_UNKNOWN','Reconcile the recorded operation without launching a replacement');
    if(row.state==='COMPLETED'){
     if(!row.result||hash(runnerCanonical(row.result))!==row.result_digest||typeof row.public_key_b64!=='string'||typeof row.result_signature!=='string')fail('REMOTE_RESULT_INVALID','Signed provider-captured result required');
     const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(row.public_key_b64,'base64url')]),format:'der',type:'spki'});
     if(!verify(null,runnerResultSigningBytes(row.organisation_id,row.run_id,row.operation_id,row.plan_digest,row.result_digest),publicKey,Buffer.from(row.result_signature,'base64url')))fail('REMOTE_RESULT_INVALID','Provisioner result signature differs');
     return decodeResult(row,store,item.invocation,item.plan);
    }
    if(performance.now()>=deadline)fail('REMOTE_OUTCOME_UNKNOWN','Remote receipt deadline elapsed; operation remains durable for reconciliation');
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,250);function done(){signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);reject(new Error('Remote wait interrupted'));}signal.addEventListener('abort',cancel,{once:true});});
   }
  }
 });
 const assertPreparationJobAdmission=async(tx:PrimaryTransaction,i:InvocationContext,request:RunnerPreparationPlan):Promise<void>=>{
  assertPrimaryTransaction(tx);assertInvocation(i);
  const authority=ctx.dependencies.require('12.1','qualification.environment.v1',(value):value is {admitPreparation:(tx:PrimaryTransaction,i:InvocationContext,request:RunnerPreparationPlan)=>Promise<RunnerPreparationAdmission>}=>object(value)&&typeof value.admitPreparation==='function');
  await authority.admitPreparation(tx,i,request);
 };
 const preparation:RunnerPreparation=Object.freeze({
  assertJobAdmission:assertPreparationJobAdmission,
  prepare:async(tx:PrimaryTransaction,i:InvocationContext,request:RunnerPreparationPlan)=>{
   assertPrimaryTransaction(tx);assertInvocation(i);
   if(!object(request))fail('INVALID_PREPARATION_PLAN','Bound preparation object required');
   exact(request,['operation_id','session_id','reservation_id','repository_id','timeout_ms','recipe_id','input_manifest_artifact_id','input_manifest_digest','source','staging','job_binding','target_binding_id']);
   if(![request.operation_id,request.session_id,request.reservation_id,request.repository_id,request.input_manifest_artifact_id,request.target_binding_id].every(uuid)||!digest(request.input_manifest_digest)||!['environment.prepare.v1','checkpoint.restore.v1'].includes(request.recipe_id)||!Number.isSafeInteger(request.timeout_ms)||request.timeout_ms<1||request.timeout_ms>259200000||!object(request.source)||!Array.isArray(request.staging)||request.staging.length>64)fail('INVALID_PREPARATION_PLAN','Exact bounded preparation identities required');
   if(!object(request.job_binding))fail('INVALID_PREPARATION_PLAN','Logical job binding required');
   exact(request.job_binding,['namespace','job_id','lease_generation','reservation_id','input_packet_digest','input_manifest_digest']);
   // Lease generation 0 binds a job snapshot that has no claim yet: reproductions, and qualification before its first verifier
   // claim (matching src/hyperfide/preparation_stage.c). Staging at generation 0 grants no execution authority.
   if(!['QUALIFICATION','REPRODUCTION','CANDIDATE','CHECKPOINT','PREWARM'].includes(request.job_binding.namespace)||!uuid(request.job_binding.job_id)||(!decimal(request.job_binding.lease_generation,true)&&!(['REPRODUCTION','QUALIFICATION'].includes(request.job_binding.namespace)&&request.job_binding.lease_generation==='0'))||request.job_binding.reservation_id!==request.reservation_id||![request.job_binding.input_packet_digest,request.job_binding.input_manifest_digest].every(digest))fail('INVALID_PREPARATION_PLAN','Exact semantic job/lease/input binding required');
   exact(request.source,['repository_key','source_object_id','source_tree_id','source_manifest_digest']);
   if(typeof request.source.repository_key!=='string'||!request.source.repository_key.trim()||request.source.repository_key.length>128||!([request.source.source_object_id].every(x=>typeof x==='string'&&/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(x))&&(request.source.source_tree_id===null?request.recipe_id==='checkpoint.restore.v1':typeof request.source.source_tree_id==='string'&&/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(request.source.source_tree_id)))||!digest(request.source.source_manifest_digest))fail('INVALID_PREPARATION_PLAN','Accepted source envelope and exact Git facts required');
   const roles=new Set<string>();for(const ref of request.staging){if(!object(ref)||typeof ref.role!=='string'||!ref.role||ref.role.length>128||roles.has(ref.role)||!uuid(ref.artifact_id)||!['object','manifest'].includes(ref.storage_kind)||!digest(ref.digest)||!decimal(ref.size_bytes)||BigInt(ref.size_bytes)>536870912n||ref.storage_kind==='manifest'&&!digest(ref.manifest_digest))fail('INVALID_PREPARATION_PLAN','Exact bounded immutable staging refs required');roles.add(ref.role);}
   const p=i.principal;
   const previous=(await tx.query('SELECT * FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR SHARE',[p.organisation_id,p.run_id,request.operation_id])).rows[0];
   if(previous){await i.guard(tx);if(previous.job_class!=='PREPARATION'||runnerCanonical(previous.plan.preparation_request)!==runnerCanonical(request)||previous.principal.actor_id!==p.actor_id||previous.authority_epoch!==p.deployment_epoch)fail('REMOTE_OPERATION_CONFLICT','Recorded preparation operation differs');const permit=Object.freeze({}) as RunnerRemotePermit;permits.set(permit,{context:ctx,plan:previous.plan.request as RunnerRemotePlan,binding:previous.plan.binding as Binding,principal:p,invocation:i,digest:previous.plan_digest});return permit;}
   await assertPreparationJobAdmission(tx,i,request);
   const r=await readRunnerPreparationBinding(tx,{organisation_id:p.organisation_id,run_id:p.run_id,session_id:request.session_id});
   if(r.repository_id!==request.repository_id)fail('REMOTE_SOURCE_MISMATCH','Preparation repository differs from trusted slot');
   const approved=await approvedRecipePolicy(ctx,tx,i,r);if(approved.digest!==r.preparation_policy_digest||runnerCanonical(approved.recipes)!==runnerCanonical(r.preparation_recipes))fail('RUNNER_RECIPE_POLICY_INVALID','Current independently approved policy differs from registered inventory');
   const recipe=r.preparation_recipes[request.recipe_id];if(!object(recipe)||!digest(r.preparation_policy_digest)||recipe.native_path!==r.runner_binary||recipe.native_digest!==r.runner_binary_digest)fail('RUNNER_RECIPE_POLICY_REQUIRED','Independently approved native recipe binding required');
   const targetReader=resources as unknown as {readPreparationTarget?:(tx:PrimaryTransaction,input:Record<string,unknown>)=>Promise<Record<string,any>|null>;readCheckpointPreparationTarget?:(tx:PrimaryTransaction,input:Record<string,unknown>)=>Promise<Record<string,any>|null>};
   const readTarget=request.recipe_id==='checkpoint.restore.v1'?targetReader.readCheckpointPreparationTarget:targetReader.readPreparationTarget;
   if(typeof readTarget!=='function')fail('PREPARATION_TARGET_UNAVAILABLE','Actual scheduler target binding reader is required');
   const target=await readTarget(tx,{organisation_id:p.organisation_id,run_id:p.run_id,target_binding_id:request.target_binding_id,preparation_operation_id:request.operation_id,reservation_id:request.reservation_id});
   if(!target||target.target_runner_session_id!==r.session_id||target.target_slot_id!==r.slot_id||String(target.target_slot_generation)!==String(r.slot_generation)||String(target.target_uid)!==String(r.uid)||String(target.target_gid)!==String(r.gid)||target.sandbox_id!==r.sandbox_id||String(target.sandbox_boot_generation)!==r.boot_generation||target.boot_id!==r.boot_id||target.workspace_path!==r.workspace_path||target.home_path!==r.home_path||target.tmp_path!==r.tmp_path||target.repository_id!==request.repository_id||target.source_digest!==request.source.source_manifest_digest||target.source_object_id!==request.source.source_object_id||target.source_tree_id!==request.source.source_tree_id)fail('PREPARATION_TARGET_MISMATCH','Preparation must preserve the actual reserved target and immutable source intent');
   if(!object(recipe.readiness_context)||!uuid(recipe.readiness_context.artifact_id)||!digest(recipe.readiness_context.digest)||!decimal(recipe.readiness_context.size_bytes,true))fail('RUNNER_RECIPE_POLICY_REQUIRED','Approved readiness context is missing');
   const trustedContext:RunnerStagingReference={role:'readiness-context',artifact_id:recipe.readiness_context.artifact_id,storage_kind:'object',digest:recipe.readiness_context.digest,size_bytes:recipe.readiness_context.size_bytes};
   const suppliedContext=request.staging.find(ref=>ref.role==='readiness-context');
   if(suppliedContext&&runnerCanonical(suppliedContext)!==runnerCanonical(trustedContext))fail('RUNNER_RECIPE_POLICY_INVALID','Caller cannot select readiness tools or scanner authority');
   const staged=[...request.staging.filter(ref=>ref.role!=='readiness-context'),trustedContext];

   if(!decimal(recipe.max_stage_bytes,true)||staged.reduce((n,v)=>n+BigInt(v.size_bytes),0n)>BigInt(recipe.max_stage_bytes))fail('PREPARATION_STAGE_BUDGET_EXCEEDED','Declared stage exceeds independently approved recipe budget');
   const allocation=await resources.readJobAllocation(tx,{organisation_id:p.organisation_id,run_id:p.run_id,reservation_id:request.reservation_id});
   if(!allocation||allocation.slot_id!==r.slot_id||allocation.sandbox_id!==r.sandbox_id||String(allocation.sandbox_boot_generation)!==r.boot_generation||(!['OPERATOR','COORDINATOR'].includes(p.role)&&allocation.assignee_session_id!==p.actor_id)||allocation.job_kind!==(request.recipe_id==='checkpoint.restore.v1'?'CHECKPOINT':'PREPARATION'))fail('REMOTE_JOB_ASSIGNMENT_MISMATCH','Actual dedicated preparation reservation/slot/assignee required');
   await resources.assertJobReservation(tx,{organisation_id:p.organisation_id,run_id:p.run_id,task_id:allocation.task_id,job_kind:request.recipe_id==='checkpoint.restore.v1'?'CHECKPOINT':'PREPARATION',reservation_id:request.reservation_id});
   const environment={LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},plan:RunnerRemotePlan={operation_id:request.operation_id,session_id:request.session_id,repository_id:request.repository_id,reservation_id:request.reservation_id,argv:[String(recipe.node_path),String(recipe.recipe_path),'--job-context','/run/hyperfide-stage/'+request.operation_id+'/context.json'],cwd:'.',environment,timeout_ms:request.timeout_ms,source_digest:request.source.source_manifest_digest,policy_digest:request.input_manifest_digest,executable_digest:String(recipe.node_digest),environment_digest:hash(runnerCanonical(environment)),artifact_paths:[],preparation:{target_binding:structuredClone(target),job_binding:structuredClone(request.job_binding),recipe_id:request.recipe_id,input_manifest_artifact_id:request.input_manifest_artifact_id,input_manifest_digest:request.input_manifest_digest,source:structuredClone(request.source),staging:structuredClone(staged)}};
   validatePlan(plan);
   const prior=(await tx.query('SELECT * FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR SHARE',[p.organisation_id,p.run_id,plan.operation_id])).rows[0];
   if(prior){if(prior.job_class!=='PREPARATION'||runnerCanonical(prior.plan.request)!==runnerCanonical(plan)||prior.principal.actor_id!==p.actor_id||prior.authority_epoch!==p.deployment_epoch)fail('REMOTE_OPERATION_CONFLICT','Preparation identity or exact inputs changed');const permit=Object.freeze({}) as RunnerRemotePermit;permits.set(permit,{context:ctx,plan,binding:prior.plan.binding as Binding,principal:p,invocation:i,digest:prior.plan_digest});return permit;}
   const reservation=(await tx.query("SELECT expires_at,clock_timestamp() AS db_now FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='ALLOCATED' FOR SHARE",[p.organisation_id,p.run_id,request.reservation_id])).rows[0];if(!reservation||new Date(reservation.expires_at).getTime()<=new Date(reservation.db_now).getTime())fail('REMOTE_RESERVATION_EXPIRED','Current preparation reservation required');
   const binding=Object.fromEntries(['organisation_id','run_id','session_id','credential_id','sandbox_id','boot_id','boot_generation','slot_id','slot_generation','repository_id','launch_id','state_dir','runner_binary','runner_binary_digest','workspace_path','home_path','tmp_path','boot_preparation_digest','preparation_digest','preparation_recipes','preparation_policy_digest','uid','gid','provider','pool_id','external_sandbox_id'].map(k=>[k,r[k]])),pins=Object.fromEntries(['allocation_id','request_id','task_id','job_kind','reservation_id','slot_id','sandbox_id','sandbox_boot_generation','assignee_session_id','generation'].map(k=>[k,allocation[k]]));
   const packet={job_class:'PREPARATION',preparation_request:structuredClone(request),request:plan,binding,allocation:pins},pin=hash(runnerCanonical(packet));
   await tx.query("INSERT INTO hyperfide.runner_remote_jobs(organisation_id,run_id,operation_id,session_id,job_class,plan,plan_digest,principal,admission_digest,authority_epoch,reservation_id,expires_at) VALUES($1,$2,$3,$4,'PREPARATION',$5,$6,$7,$8,$9,$10,LEAST($11::timestamptz,$12::timestamptz))",[p.organisation_id,p.run_id,plan.operation_id,plan.session_id,JSON.stringify(packet),pin,JSON.stringify(p),hash(runnerCanonical(pins)),p.deployment_epoch,plan.reservation_id,reservation.expires_at,p.expires_at]);
   if(plan.preparation!.staging.some(ref=>ref.role==='input-manifest'))
    fail('PREPARATION_ARTIFACT_UNAVAILABLE','The native stager owns the declared input-manifest role');
   const refs=[{role:'input-manifest',artifact_id:request.input_manifest_artifact_id,storage_kind:'object',digest:request.input_manifest_digest,size_bytes:null},...plan.preparation!.staging];
   for(const ref of refs){const objectDigest=ref.storage_kind==='manifest'?(ref as RunnerStagingReference).manifest_digest!:ref.digest;const artifact=(await tx.query("SELECT digest,size_bytes FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND status='COMPLETE' FOR SHARE",[p.organisation_id,p.run_id,ref.artifact_id])).rows[0];if(!artifact||artifact.digest!==objectDigest||ref.storage_kind==='object'&&ref.size_bytes!==null&&String(artifact.size_bytes)!==ref.size_bytes)fail('PREPARATION_ARTIFACT_UNAVAILABLE','Actual scoped immutable COMPLETE inputs required');await tx.query('INSERT INTO hyperfide.runner_result_artifacts(organisation_id,run_id,operation_id,role,artifact_id,artifact_digest,content_digest,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.organisation_id,p.run_id,plan.operation_id,'input:'+hash(ref.role).slice(7),ref.artifact_id,objectDigest,ref.digest,ref.size_bytes??String(artifact.size_bytes)]);}
   const permit=Object.freeze({}) as RunnerRemotePermit;permits.set(permit,{context:ctx,plan,binding:r,principal:p,invocation:i,digest:pin});return permit;
  },execute:remote.execute,
  verifyReceipt:verifyPreparationReceipt,recordReceipt:recordPreparationReceipt,readReceipt:readPreparationReceipt
 });
 return {apiVersion:1,capabilities:{'runner.remote.v1':remote,'runner.preparation.v1':preparation},actions:{
  'runner.job.claim':(v,context)=>identityTransaction(context,async(tx,i)=>{
   exact(v,['operation_id']);if(!uuid(v.operation_id)||i.principal.role!=='RUNNER')fail('ROLE_DENIED','Bound runner operation required');const p=i.principal;
   const row=(await tx.query('SELECT * FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR SHARE',[p.organisation_id,p.run_id,v.operation_id])).rows[0];
   if(!row||row.state!=='CLAIMED')fail('REMOTE_JOB_NOT_CLAIMED','Provisioner must claim the committed operation first');
   if(row.authority_epoch!==p.deployment_epoch)fail('REMOTE_AUTHORITY_STALE','Committed admission belongs to a different current run authority');
   await authority.guard(tx,row.principal);
   const allocation=await resources.readJobAllocation(tx as PrimaryTransaction,{organisation_id:p.organisation_id,run_id:p.run_id,reservation_id:row.reservation_id});
   if(!allocation)fail('REMOTE_JOB_ASSIGNMENT_MISMATCH','Current reservation allocation required at native claim');
   for(const key of ['allocation_id','request_id','task_id','job_kind','reservation_id','slot_id','sandbox_id','sandbox_boot_generation','assignee_session_id','generation'])if(String(allocation[key])!==String(row.plan.allocation[key]))fail('REMOTE_JOB_ASSIGNMENT_MISMATCH','Native claim allocation differs from the committed admission');
   const reservation=(await tx.query("SELECT expires_at FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='ALLOCATED' AND expires_at>clock_timestamp() FOR SHARE",[p.organisation_id,p.run_id,row.reservation_id])).rows[0];
   if(!reservation)fail('REMOTE_RESERVATION_EXPIRED','Allocated reservation was revoked or expired before native claim');

   const r=await (row.job_class==='PREPARATION'?readRunnerPreparationBinding:readRunnerBinding)(tx as PrimaryTransaction,{organisation_id:p.organisation_id,run_id:p.run_id,session_id:row.session_id});
   if(r.credential_id!==p.credential_id||r.boot_id!==p.boot_id||r.boot_generation!==p.boot_generation)fail('REMOTE_JOB_SCOPE_DENIED','Operation belongs to another authenticated runner boot');const checked=row.job_class==='PREPARATION'?null:await readRunnerReadiness(tx as PrimaryTransaction,r);
   const clock=(await tx.query('SELECT clock_timestamp() AS db_now')).rows[0]!;const remaining_ms=Math.max(0,Math.floor(new Date(row.expires_at).getTime()-new Date(clock.db_now).getTime()));
   if(remaining_ms<=0)fail('REMOTE_RESERVATION_EXPIRED','Job admission expired');
   // The held per-boot charge (if any) is delivered with the authenticated claim; native
   // job execution attaches the job tree to that budget cgroup or reports it unavailable.
   let charge:unknown=null;
   try{charge=await assertSandboxReservation(tx as PrimaryTransaction,{organisation_id:p.organisation_id,run_id:p.run_id,reservation_id:row.reservation_id});}catch(error){if(!object(error)||error.code!=='SANDBOX_CHARGE_UNAVAILABLE')throw error;}
   const budget=charge===null?null:{charge,boot_id:r.boot_id,uid:r.uid,gid:r.gid};
   const {public_key_b64:_publicKey,...binding}=r;
   return {operation_id:row.operation_id,job_class:row.job_class,plan_digest:row.plan_digest,plan:row.plan.request,binding,allocation:row.plan.allocation,readiness:checked,budget,remaining_ms,expires_at:new Date(row.expires_at).toISOString(),authority:'BOUNDED_JOB_ONLY'};
  })
 }};
}
