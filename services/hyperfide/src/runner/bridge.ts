import fs from 'node:fs/promises';
import path from 'node:path';
import {createPrivateKey,createPublicKey,randomBytes,randomUUID,sign,verify} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertCurrentPrincipal,gatewayOf,identityTransaction,invocationOf} from '../identity/enrollment.js';
import {assertInvocation,DIGEST,decimal,exact,fail,hash,uuid} from '../transport/protocol.js';
import type {InvocationContext,Principal} from '../transport/protocol.js';
import {readRuntimeReadiness} from '../providers/pools.js';

export interface RunnerRemotePlan {
 session_id:string;operation_id:string;repository_id:string;reservation_id:string;
 job_id?:string;task_id?:string;job_kind?:string;argv:string[];cwd:string;
 environment:Record<string,string>;stdin?:string;timeout_ms:number;
 source_digest:string;source_provenance_digest?:string;policy_digest:string;executable_digest:string;
 environment_digest:string;artifact_paths:string[];
}
declare const permitBrand:unique symbol;
export interface RunnerRemotePermit {readonly [permitBrand]:true}
export interface CapturedBytes {bytes:Uint8Array;digest:string;size_bytes:string;complete:boolean}
export interface RunnerRemoteResult {
 execution_plane:'REMOTE';truncated:boolean;started_at:string;ended_at:string;duration_ms:number;
 source_manifest_digest:string;source_state_digest:string;source_provenance_digest?:string;workspace_path:string;
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
 JOIN hyperfide.identity_runner_status st ON st.credential_id=c.credential_id AND st.preparation_digest=r.preparation_digest
 WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.session_id=$3 AND r.state='CURRENT'
 AND s.observed_state='RUNNING' AND w.state IN('READY','ALLOCATED','DRAINING') FOR SHARE OF r,s,b,w,c,st`,[scope.organisation_id,scope.run_id,scope.session_id])).rows[0];
 if(!r||r.credential_state!=='ACTIVE'||new Date(r.credential_expires_at).getTime()<=new Date(r.db_now).getTime()||new Date(r.heartbeat_at).getTime()+90000<=new Date(r.db_now).getTime())fail('RUNNER_NOT_CURRENT','Current authenticated runner/boot/slot observation required');
 r.boot_generation=String(r.boot_generation);r.slot_generation=String(r.slot_generation);r.registration_version=String(r.registration_version);
 return r as Binding;
}
export async function readRunnerReadiness(tx:PrimaryTransaction,r:Binding):Promise<Record<string,any>> {
 const result=await readRuntimeReadiness(tx,{organisation_id:r.organisation_id,run_id:r.run_id,sandbox_id:r.sandbox_id,boot_generation:r.boot_generation,slot_id:r.slot_id,preparation_digest:r.preparation_digest,source_digest:r.source_digest});
 if(!result||result.readiness_digest!==r.readiness_digest||result.source_object_id!==r.source_object_id||result.source_tree_id!==r.source_tree_id)fail('RUNNER_READINESS_STALE','Actual current source-specific runtime readiness required');
 return result;
}
async function observe(tx:PrimaryTransaction,v:Record<string,unknown>,i:InvocationContext):Promise<unknown> {
 if(i.principal.role!=='RUNNER')fail('ROLE_DENIED','Only the bound authenticated runner reports its physical observation');
 exact(v,['session_id','slot_id','repository_id','launch_id','state_dir','runner_binary','workspace_path','runner_binary_digest','preparation_digest','readiness_digest','source_digest','source_object_id','source_tree_id','slot_generation','uid','gid']);
 const p=i.principal;
 if(!uuid(v.session_id)||!uuid(v.slot_id)||!uuid(v.repository_id)||v.launch_id!==null&&!uuid(v.launch_id)||!absolute(v.state_dir)||!absolute(v.runner_binary)||!absolute(v.workspace_path)||![v.runner_binary_digest,v.preparation_digest,v.readiness_digest,v.source_digest].every(digest)||typeof v.source_object_id!=='string'||!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(v.source_object_id)||typeof v.source_tree_id!=='string'||!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(v.source_tree_id)||!decimal(v.slot_generation,true)||!Number.isInteger(v.uid)||Number(v.uid)<1||!Number.isInteger(v.gid)||Number(v.gid)<1)fail('INVALID_REQUEST','Invalid bounded runner observation');
 const inventory=(await tx.query('SELECT inventory FROM hyperfide.identity_runner_status WHERE credential_id=$1 FOR SHARE',[p.credential_id])).rows[0]?.inventory;
 if(!Array.isArray(inventory)||!inventory.some(item=>runnerCanonical(item)===runnerCanonical(v)))fail('RUNNER_OBSERVATION_UNREGISTERED','Observation must match the authenticated registered slot inventory');
 const ready=await readRuntimeReadiness(tx,{organisation_id:p.organisation_id,run_id:p.run_id,sandbox_id:p.sandbox_id!,boot_generation:p.boot_generation!,slot_id:v.slot_id,preparation_digest:v.preparation_digest as string,source_digest:v.source_digest as string});
 if(!ready||ready.readiness_digest!==v.readiness_digest||ready.source_object_id!==v.source_object_id||ready.source_tree_id!==v.source_tree_id)fail('RUNNER_READINESS_STALE','Source-specific actual runtime readiness proof is required');
 const r=(await tx.query(`INSERT INTO hyperfide.runner_registry(organisation_id,run_id,session_id,credential_id,sandbox_id,boot_generation,boot_id,slot_id,repository_id,launch_id,state_dir,runner_binary,workspace_path,runner_binary_digest,preparation_digest,readiness_digest,source_digest,source_object_id,source_tree_id,slot_generation,uid,gid,observation_digest)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
 ON CONFLICT(organisation_id,run_id,session_id) DO UPDATE SET credential_id=EXCLUDED.credential_id,launch_id=EXCLUDED.launch_id,preparation_digest=EXCLUDED.preparation_digest,readiness_digest=EXCLUDED.readiness_digest,source_digest=EXCLUDED.source_digest,source_object_id=EXCLUDED.source_object_id,source_tree_id=EXCLUDED.source_tree_id,observation_digest=EXCLUDED.observation_digest,registration_version=hyperfide.runner_registry.registration_version+1,observed_at=clock_timestamp()
 WHERE hyperfide.runner_registry.sandbox_id=EXCLUDED.sandbox_id AND hyperfide.runner_registry.boot_generation=EXCLUDED.boot_generation AND hyperfide.runner_registry.boot_id=EXCLUDED.boot_id AND hyperfide.runner_registry.slot_id=EXCLUDED.slot_id AND hyperfide.runner_registry.state_dir=EXCLUDED.state_dir AND hyperfide.runner_registry.runner_binary=EXCLUDED.runner_binary AND hyperfide.runner_registry.workspace_path=EXCLUDED.workspace_path AND hyperfide.runner_registry.repository_id=EXCLUDED.repository_id AND hyperfide.runner_registry.uid=EXCLUDED.uid AND hyperfide.runner_registry.gid=EXCLUDED.gid
 RETURNING registration_version,observed_at`,[p.organisation_id,p.run_id,v.session_id,p.credential_id,p.sandbox_id,p.boot_generation,p.boot_id,v.slot_id,v.repository_id,v.launch_id,v.state_dir,v.runner_binary,v.workspace_path,v.runner_binary_digest,v.preparation_digest,v.readiness_digest,v.source_digest,v.source_object_id,v.source_tree_id,v.slot_generation,v.uid,v.gid,hash(runnerCanonical(v))])).rows[0];
 if(!r)fail('RUNNER_REGISTRATION_CONFLICT','Runner cannot overwrite a different slot/process registry identity');
 return {registered:true,runner_session_id:v.session_id,registration_version:String(r.registration_version),observed_at:new Date(r.observed_at).toISOString(),authority:'OBSERVATION_ONLY',task_qualified:false};
}
async function verifyEnvironment(tx:PrimaryTransaction,i:InvocationContext,v:Record<string,unknown>):Promise<unknown> {
 assertPrimaryTransaction(tx);assertInvocation(i);await i.guard(tx);
 if(i.principal.role!=='VERIFIER'||!uuid(v.job_id)||!uuid(v.reservation_id)||!digest(v.environment_digest))fail('QUALIFICATION_ENVIRONMENT_DENIED','Actual assigned verifier job required');
 const p=i.principal;
 const a=(await tx.query('SELECT * FROM hyperfide.assurance_job_assignments WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 ORDER BY assignment_generation DESC LIMIT 1',[p.organisation_id,p.run_id,v.job_id])).rows[0];
 if(!a||a.verifier_id!==p.actor_id||a.reservation_id!==v.reservation_id||a.environment_digest!==v.environment_digest||a.sandbox_id!==p.sandbox_id||String(a.sandbox_boot_generation)!==p.boot_generation)fail('QUALIFICATION_ENVIRONMENT_DENIED','Current verifier assignment differs');
 const job=(await tx.query(`SELECT j.*,c.source_attempt_id,COALESCE(i.manifest,s.manifest) AS manifest FROM hyperfide.qualification_jobs j JOIN hyperfide.submission_custodies c ON c.organisation_id=j.organisation_id AND c.run_id=j.run_id AND c.id=j.custody_id JOIN hyperfide.assurance_submissions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.custody_id=c.id LEFT JOIN hyperfide.requalification_operations q ON q.organisation_id=j.organisation_id AND q.run_id=j.run_id AND q.qualification_job_id=j.id LEFT JOIN hyperfide.assurance_requalification_inputs i ON i.organisation_id=q.organisation_id AND i.run_id=q.run_id AND i.operation_id=q.id WHERE j.organisation_id=$1 AND j.run_id=$2 AND j.id=$3`,[p.organisation_id,p.run_id,v.job_id])).rows[0];
 if(!job||!object(job.manifest))fail('QUALIFICATION_ENVIRONMENT_DENIED','Immutable result source manifest required');
 const current=(await tx.query('SELECT session_id FROM hyperfide.runner_registry WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND slot_id=$4 AND boot_generation=$5 AND state=\'CURRENT\'',[p.organisation_id,p.run_id,a.sandbox_id,a.slot_id,a.sandbox_boot_generation])).rows[0];
 if(!current)fail('QUALIFICATION_ENVIRONMENT_DENIED','Actual runner workspace registration required');
 const r=await readRunnerBinding(tx,{organisation_id:p.organisation_id,run_id:p.run_id,session_id:current.session_id}),ready=await readRunnerReadiness(tx,r);
 if(r.source_object_id!==job.manifest.source_object_id||r.source_tree_id!==job.manifest.source_tree_id||r.source_digest!==job.manifest.source_manifest_digest)fail('QUALIFICATION_SOURCE_MISMATCH','Verifier must inspect the submitted result source');
 const source=(await tx.query('SELECT sandbox_id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[p.organisation_id,p.run_id,job.source_attempt_id])).rows[0];
 if(!source||source.sandbox_id===r.sandbox_id)fail('QUALIFICATION_NOT_INDEPENDENT','Dedicated verifier resource is required');
 return Object.freeze({runner_session_id:r.session_id,workspace_path:r.workspace_path,sandbox_id:r.sandbox_id,boot_id:r.boot_id,boot_generation:r.boot_generation,slot_id:r.slot_id,preparation_digest:r.preparation_digest,readiness_digest:r.readiness_digest,provider_observation_id:ready.id,runner_credential_id:r.credential_id,observed_at:r.observed_at,registration_version:r.registration_version,source_object_id:r.source_object_id,source_tree_id:r.source_tree_id,source_digest:r.source_digest,source_manifest_digest:r.source_digest,source_state_digest:ready.source_state_digest});
}
export async function createComponent(ctx:ComponentContext):Promise<Component> {
 await schema(ctx);
 const registry=Object.freeze({lookup:readRunnerBinding,verifyBinding:async(tx:PrimaryTransaction,v:Record<string,unknown>)=>{try{const r=await readRunnerBinding(tx,v as any);return {evidence_digest:r.observation_digest,observed_at:new Date(r.observed_at).toISOString()};}catch{return null;}}});
 return {apiVersion:1,capabilities:{'runner.registry.v1':registry,'qualification.environment.v1':Object.freeze({verify:verifyEnvironment})},actions:{
  'runner.registry.observe':(v,context)=>identityTransaction(context,(tx,i)=>{if(!object(v))fail('INVALID_REQUEST','Object required');return observe(tx as PrimaryTransaction,v,i);}),
  'runner.registry.describe':async(_v,context)=>{const i=invocationOf(context);return {protocol_version:1,organisation_id:i.principal.organisation_id,run_id:i.principal.run_id,authority:'OBSERVATION_ONLY'};}
 }};
}
const permits=new WeakMap<object,{context:ComponentContext;plan:RunnerRemotePlan;binding:Binding;principal:Principal;digest:string}>();
function validatePlan(plan:RunnerRemotePlan):void {
 if(!object(plan)||![plan.session_id,plan.operation_id,plan.repository_id,plan.reservation_id].every(uuid)||plan.job_id!==undefined&&!uuid(plan.job_id)||!Array.isArray(plan.argv)||!plan.argv.length||plan.argv.length>256||typeof plan.argv[0]!=='string'||!plan.argv[0]||plan.argv.some(x=>typeof x!=='string'||x.length>4096||x.includes('\0'))||plan.cwd!=='.'&&!safeRelative(plan.cwd)||!object(plan.environment)||Object.entries(plan.environment).some(([k,v])=>!/^[A-Z][A-Z0-9_]{0,63}$/.test(k)||/^(LD_|DYLD_|HF_|HOME$|TMPDIR$|PATH$)/.test(k)||typeof v!=='string'||v.includes('\0'))||plan.stdin!==undefined&&(typeof plan.stdin!=='string'||Buffer.byteLength(plan.stdin)>65536)||!Number.isInteger(plan.timeout_ms)||plan.timeout_ms<1||plan.timeout_ms>259200000||![plan.source_digest,plan.policy_digest,plan.executable_digest,plan.environment_digest].every(digest)||!Array.isArray(plan.artifact_paths)||plan.artifact_paths.length>64||plan.artifact_paths.some(x=>typeof x!=='string'||!safeRelative(x))||new Set(plan.artifact_paths).size!==plan.artifact_paths.length)fail('INVALID_REMOTE_PLAN','Bounded immutable registered command/source/environment plan required');
 if(hash(runnerCanonical(plan.environment))!==plan.environment_digest)fail('REMOTE_ENVIRONMENT_MISMATCH','Explicit environment bytes differ from the registered digest');
}
export function runnerResultSigningBytes(org:string,run:string,op:string,plan:string,result:string):Buffer{return Buffer.from(`HYPERFIDE-RUNNER-RESULT-V1\n${org}\n${run}\n${op}\n${plan}\n${result}\n`);}
function decodeResult(row:Record<string,any>):RunnerRemoteResult {
 const wire=row.result as Record<string,any>;
 if(!object(wire))fail('REMOTE_RESULT_INVALID','Captured result required');
 const copy=structuredClone(wire) as Record<string,any>;
 for(const name of ['stdout','stderr']){const item=copy[name];if(!object(item)||typeof item.base64!=='string'||typeof item.digest!=='string')fail('REMOTE_RESULT_INVALID','Captured stream required');const bytes=Buffer.from(item.base64,'base64');if(bytes.toString('base64')!==item.base64||hash(bytes)!==item.digest||String(bytes.length)!==item.size_bytes||item.complete!==true)fail('REMOTE_RESULT_INVALID','Captured stream bytes/digest/completeness differs');item.bytes=bytes;delete item.base64;}
 for(const item of copy.artifacts??[]){const bytes=Buffer.from(item.base64,'base64');if(bytes.toString('base64')!==item.base64||hash(bytes)!==item.digest||String(bytes.length)!==item.size_bytes||item.complete!==true)fail('REMOTE_RESULT_INVALID','Captured artifact bytes differ');item.bytes=bytes;delete item.base64;}
 return copy as RunnerRemoteResult;
}
export async function createRemoteComponent(ctx:ComponentContext):Promise<Component> {
 await schema(ctx);const resources=ctx.dependencies.require('5.1','scheduler.allocations.v1',isResources),g=gatewayOf(ctx);
 const remote:RunnerRemote=Object.freeze({
  prepare:async(tx:PrimaryTransaction,i:InvocationContext,request:RunnerRemotePlan)=>{
   assertPrimaryTransaction(tx);assertInvocation(i);await i.guard(tx);validatePlan(request);
   const plan=structuredClone(request),p=i.principal,r=await readRunnerBinding(tx,{organisation_id:p.organisation_id,run_id:p.run_id,session_id:plan.session_id});await readRunnerReadiness(tx,r);
   if(r.repository_id!==plan.repository_id||r.source_digest!==plan.source_digest)fail('REMOTE_SOURCE_MISMATCH','Registered actual source/repository differs');
   const allocation=await resources.readJobAllocation(tx,{organisation_id:p.organisation_id,run_id:p.run_id,reservation_id:plan.reservation_id});
   if(!allocation||allocation.slot_id!==r.slot_id||allocation.sandbox_id!==r.sandbox_id||String(allocation.sandbox_boot_generation)!==r.boot_generation||String(allocation.generation)!==r.slot_generation||allocation.assignee_session_id!==p.actor_id)fail('REMOTE_JOB_ASSIGNMENT_MISMATCH','Actual dedicated reservation/slot/assignee binding required');
   const admitted=await resources.assertJobReservation(tx,{organisation_id:p.organisation_id,run_id:p.run_id,task_id:allocation.task_id,job_kind:allocation.job_kind,reservation_id:plan.reservation_id});
   const reservation=(await tx.query('SELECT expires_at,clock_timestamp() AS db_now FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state=\'ALLOCATED\' FOR SHARE',[p.organisation_id,p.run_id,plan.reservation_id])).rows[0];
   if(!reservation||new Date(reservation.expires_at).getTime()<=new Date(reservation.db_now).getTime())fail('REMOTE_RESERVATION_EXPIRED','Current allocated reservation required');
   const stableBinding=Object.fromEntries(['organisation_id','run_id','session_id','credential_id','sandbox_id','boot_id','boot_generation','slot_id','slot_generation','repository_id','launch_id','state_dir','runner_binary','runner_binary_digest','workspace_path','preparation_digest','readiness_digest','source_digest','source_object_id','source_tree_id','uid','gid','provider','pool_id','external_sandbox_id'].map(key=>[key,r[key]]));
   const packet=JSON.parse(JSON.stringify({request:plan,binding:stableBinding,allocation,reservations:admitted.reservations})) as Record<string,unknown>;const pin=hash(runnerCanonical(packet));
   await tx.query(`INSERT INTO hyperfide.runner_remote_jobs(organisation_id,run_id,operation_id,session_id,plan,plan_digest,principal,admission_digest,authority_epoch,reservation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,LEAST($11::timestamptz,$12::timestamptz)) ON CONFLICT(organisation_id,run_id,operation_id) DO NOTHING`,[p.organisation_id,p.run_id,plan.operation_id,plan.session_id,JSON.stringify(packet),pin,JSON.stringify(p),hash(runnerCanonical(admitted)),p.deployment_epoch,plan.reservation_id,reservation.expires_at,p.expires_at]);
   const stored=(await tx.query('SELECT plan_digest FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[p.organisation_id,p.run_id,plan.operation_id])).rows[0];if(stored?.plan_digest!==pin)fail('REMOTE_OPERATION_CONFLICT','Operation identity cannot change its immutable execution input');
   const permit=Object.freeze({}) as RunnerRemotePermit;permits.set(permit,{context:ctx,plan,binding:r,principal:p,digest:pin});return permit;
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
     return decodeResult(row);
    }
    if(performance.now()>=deadline)fail('REMOTE_OUTCOME_UNKNOWN','Remote receipt deadline elapsed; operation remains durable for reconciliation');
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,250);function done(){signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);reject(new Error('Remote wait interrupted'));}signal.addEventListener('abort',cancel,{once:true});});
   }
  }
 });
 return {apiVersion:1,capabilities:{'runner.remote.v1':remote},actions:{
  'runner.job.claim':(v,context)=>identityTransaction(context,async(tx,i)=>{
   exact(v,['operation_id']);if(!uuid(v.operation_id)||i.principal.role!=='RUNNER')fail('ROLE_DENIED','Bound runner operation required');const p=i.principal;
   const row=(await tx.query('SELECT * FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR SHARE',[p.organisation_id,p.run_id,v.operation_id])).rows[0];
   if(!row||row.state!=='CLAIMED')fail('REMOTE_JOB_NOT_CLAIMED','Provisioner must claim the committed operation first');
   const r=await readRunnerBinding(tx as PrimaryTransaction,{organisation_id:p.organisation_id,run_id:p.run_id,session_id:row.session_id});
   if(r.credential_id!==p.credential_id||r.boot_id!==p.boot_id||r.boot_generation!==p.boot_generation)fail('REMOTE_JOB_SCOPE_DENIED','Operation belongs to another authenticated runner boot');const checked=await readRunnerReadiness(tx as PrimaryTransaction,r);
   const clock=(await tx.query('SELECT clock_timestamp() AS db_now')).rows[0]!;const remaining_ms=Math.max(0,Math.floor(new Date(row.expires_at).getTime()-new Date(clock.db_now).getTime()));
   if(remaining_ms<=0)fail('REMOTE_RESERVATION_EXPIRED','Job admission expired');
   return {operation_id:row.operation_id,plan_digest:row.plan_digest,plan:row.plan.request,binding:{...r,public_key_b64:undefined},allocation:row.plan.allocation,readiness:checked,remaining_ms,expires_at:new Date(row.expires_at).toISOString(),authority:'BOUNDED_JOB_ONLY'};
  })
 }};
}
