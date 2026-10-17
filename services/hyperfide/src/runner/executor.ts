import {verifyPreparationReceipt} from './preparation_receipts.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {createPrivateKey,createPublicKey,randomUUID,sign} from 'node:crypto';
import type {KeyObject} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {object} from '../policy/programme.js';
import {gatewayOf,isIdentityAuthority} from '../identity/enrollment.js';
import type {IdentityAuthority} from '../identity/enrollment.js';
import {assertInvocation,base64,decimal,DIGEST,exact,fail,hash,signingBytes,strictJSON,uuid} from '../transport/protocol.js';
import type {InvocationContext,Principal} from '../transport/protocol.js';
import {isArtifactStoreCapability} from '../artifacts/objects.js';
import type {ArtifactStoreCapability} from '../artifacts/objects.js';
import type {BoundProviderRequest,CapturedProviderOutput} from '../providers/reconcile.js';
import {readRunnerBinding,readRunnerPreparationBinding,readRunnerReadiness,runnerCanonical,runnerResultSigningBytes} from './bridge.js';
import type {RunnerRemotePlan} from './bridge.js';
import {readJobAllocation} from '../scheduler/claim.js';
import {lookupNativeLaunch} from '../events/outbox.js';
import {currentPool,digestDocument,readDeployment} from '../providers/pools.js';

interface Signer {credential_id:string;key:KeyObject;public_key_b64:string}
interface ProviderResult {outcome:unknown;process_ref:unknown;captured?:CapturedProviderOutput;evidence_digest?:unknown;cleanup_confirmed?:unknown;[name:string]:unknown}
interface ProviderExecution {
 executeBound(input:BoundProviderRequest,signal:AbortSignal,invocation:InvocationContext):Promise<ProviderResult>;
 registerRunnerBindingVerifier(reader:(tx:PrimaryTransaction,binding:BoundProviderRequest['binding'],request:unknown)=>Promise<{evidence_digest:string;observed_at:string}|null>):void|(()=>void);
}
interface Packet {source_state_digest:string;workspace_digest:string;request:RunnerRemotePlan;binding:Record<string,any>;allocation:Record<string,any>;reservations:unknown}
interface Job {organisation_id:string;run_id:string;operation_id:string;session_id:string;plan:Packet;plan_digest:string;principal:Principal;authority_epoch:string;reservation_id:string;expires_at:Date|string;state:string;claim_id:string|null;executor_credential_id:string|null;[name:string]:any}
interface ObjectReference {storage_kind:'manifest';artifact_id:string;digest:string;manifest_digest:string;size_bytes:string;complete:boolean}
export type NativeControlAction='runner.observe'|'runner.stop'|'runner.pause'|'runner.drain'|'runner.cancel'|'runner.resume';
/** Every action except observe is a coordinator command identified by command_id (task 12.4). */
export const NATIVE_CONTROL_ACTIONS:readonly NativeControlAction[]=Object.freeze(['runner.observe','runner.stop','runner.pause','runner.drain','runner.cancel','runner.resume']);
export interface NativeRunnerRequest {session_id:string;operation_id:string;action:NativeControlAction;command_id?:string;launch_id?:string}
export interface NativeRunnerCapability {
 invokeNativeRunner(invocation:InvocationContext,input:NativeRunnerRequest,signal:AbortSignal):Promise<unknown>;
 authenticatePlacementProbe(invocation:InvocationContext,input:{probe_id:string},signal:AbortSignal):Promise<{request:BoundProviderRequest;invocation:InvocationContext}>;
}
export function isNativeRunnerCapability(v:unknown):v is NativeRunnerCapability {
 return object(v)&&typeof v.invokeNativeRunner==='function'&&typeof v.authenticatePlacementProbe==='function';
}
const isProvider=(v:unknown):v is ProviderExecution=>object(v)&&typeof v.executeBound==='function'&&typeof v.registerRunnerBindingVerifier==='function';
const MAX_CAPTURE=96*1024*1024;
const RETENTION={retention_class:'RUN',retention_until:null,retention_hold:false} as const;
function digest(v:unknown):v is string{return typeof v==='string'&&DIGEST.test(v);}
function same(a:unknown,b:unknown):boolean{return runnerCanonical(a)===runnerCanonical(b);}
// Open the trusted credential itself, never a symlink or a group-readable copy.
// Descriptor metadata is checked again after the read to reject replacement.
async function privateBytes(filename:unknown,limit:number):Promise<Buffer>{
 if(typeof filename!=='string'||!path.isAbsolute(filename)||path.normalize(filename)!==filename||await fs.realpath(filename)!==filename)fail('RUNNER_EXECUTOR_CONFIG_INVALID','Absolute non-symlink trusted file required');
 const fd=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await fd.stat();if(!before.isFile()||before.nlink!==1||before.uid!==process.getuid?.()||(before.mode&0o777)!==0o600||before.size>limit)fail('RUNNER_EXECUTOR_CONFIG_INVALID','Private owned bounded regular file required');
 const bytes=await fd.readFile();const after=await fd.stat();
 if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==before.size)fail('RUNNER_EXECUTOR_CONFIG_INVALID','Trusted file changed during read');
 return bytes;}finally{await fd.close();}
}
async function configuration(ctx:ComponentContext):Promise<{signers:Signer[];concurrency:number}>{
 const value=strictJSON(await privateBytes(ctx.env.HF_RUNNER_EXECUTOR_CONFIG_FILE,65536));
 exact(value,['schema_version','principals','concurrency']);
 if(value.schema_version!==1||!Array.isArray(value.principals)||value.principals.length<1||value.principals.length>64||!Number.isSafeInteger(value.concurrency)||Number(value.concurrency)<1||Number(value.concurrency)>16)fail('RUNNER_EXECUTOR_CONFIG_INVALID','Bounded executor identity list and concurrency required');
 const signers:Signer[]=[];
 for(const item of value.principals){exact(item,['credential_id','key_path']);if(!uuid(item.credential_id)||signers.some(s=>s.credential_id===item.credential_id))fail('RUNNER_EXECUTOR_CONFIG_INVALID','Unique credential identity required');
 const raw=await privateBytes(item.key_path,16384);let key:KeyObject;
 try{key=raw[0]===45?createPrivateKey(raw):createPrivateKey({key:raw,format:'der',type:'pkcs8'});}finally{raw.fill(0);}
 if(key.asymmetricKeyType!=='ed25519')fail('RUNNER_EXECUTOR_CONFIG_INVALID','Ed25519 service key required');
 const der=createPublicKey(key).export({format:'der',type:'spki'}) as Buffer;
 if(der.length!==44||!der.subarray(0,12).equals(Buffer.from('302a300506032b6570032100','hex')))fail('RUNNER_EXECUTOR_CONFIG_INVALID','Canonical Ed25519 public key required');
 signers.push({credential_id:item.credential_id,key,public_key_b64:der.subarray(12).toString('base64url')});}
 return {signers,concurrency:Number(value.concurrency)};
}
function currentSigner(row:Record<string,any>|undefined,s:Signer):row is Record<string,any>{
 return !!row&&row.role==='PROVISIONER'&&row.public_key_b64===s.public_key_b64&&row.state==='ACTIVE'&&row.deployment_epoch===row.authority_epoch&&!['STOPPED','STOPPING','CANCELLED','FAILED'].includes(row.run_state)&&new Date(row.expires_at).getTime()>new Date(row.db_now).getTime()&&row.attempt_id===null&&Array.isArray(row.allowed_actions)&&row.allowed_actions.includes('provider.remote.execute-bound');
}
async function authenticate(authority:IdentityAuthority,signer:Signer,run:string,epoch:string,input:BoundProviderRequest,signal:AbortSignal):Promise<InvocationContext>{
 const payload=Buffer.from(JSON.stringify({run_id:run,component:'8.3',action:'provider.remote.execute-bound',input,expected_version:null,authority:null}));
 const operation=randomUUID(),body=Buffer.from(JSON.stringify({protocol_version:1,operation_id:operation,idempotency_key:operation,payload_digest:hash(payload),correlation_id:operation,causation_id:null,payload_b64:payload.toString('base64url')}));
 const proof={id:signer.credential_id,time:String(Math.floor(Date.now()/1000)),nonce:randomUUID()};
 const signature=sign(null,signingBytes(authority.origin,'/v1/invoke',proof,body),signer.key).toString('base64url');
 const invocation=await authority.authenticate(body,['hf-credential-id',proof.id,'hf-request-time',proof.time,'hf-request-nonce',proof.nonce,'hf-request-signature',signature],signal);
 await authority.authorize(invocation);assertInvocation(invocation);
 if(invocation.principal.role!=='PROVISIONER'||invocation.principal.credential_id!==signer.credential_id||invocation.principal.run_id!==run||invocation.principal.deployment_epoch!==epoch||!same(invocation.payload.input,input))fail('RUNNER_EXECUTOR_IDENTITY_MISMATCH','Authenticated service identity or exact request differs');
 return invocation;
}
function boundRequest(binding:Record<string,any>,operation_id:string,argv:string[],timeout_ms:number):BoundProviderRequest{
 if(!digest(binding.boot_preparation_digest))fail('RUNNER_BOOT_SEED_UNPINNED','Actual registered sandbox boot preparation identity required');
 return {binding:{organisation_id:binding.organisation_id,run_id:binding.run_id,session_id:binding.session_id,pool_id:binding.pool_id,sandbox_id:binding.sandbox_id,external_sandbox_id:binding.external_sandbox_id,boot_generation:String(binding.boot_generation),preparation_digest:binding.boot_preparation_digest},operation_id,argv,cwd:binding.workspace_path,env_refs:{},timeout_ms};
}
function jobRequest(row:Job):BoundProviderRequest{
 const b=row.plan.binding;
 const encoded=Buffer.from(JSON.stringify({config_path:b.state_dir+'/runner.json',operation_id:row.operation_id})).toString('base64url');
 const request=boundRequest(b,row.operation_id,[b.runner_binary,'--component','12.4','--action','runner.job.execute','--request-base64',encoded],Math.min(3600000,row.plan.request.timeout_ms+60000));
 if(row.job_class==='PREPARATION')request.cwd=path.dirname(b.workspace_path);
 return request;
}
function decodeNative(captured:CapturedProviderOutput):{raw:Buffer;digest:string;receipt:Record<string,any>}{
 if(captured.complete!==true||!(captured.stdout instanceof Uint8Array)||!(captured.stderr instanceof Uint8Array)||!digest(captured.spool_digest)||captured.stdout.byteLength>MAX_CAPTURE||captured.exit_code!==0)fail('RUNNER_CAPTURE_INCOMPLETE','Complete native invocation stdout and successful helper exit required');
 const outer=strictJSON(Buffer.from(captured.stdout),MAX_CAPTURE);if(!object(outer)||outer.ok!==true||!object(outer.result))fail('RUNNER_RECEIPT_INVALID','Actual native dispatcher result required');
 const result=outer.result;if(result.schema_version!==1||!digest(result.receipt_digest))fail('RUNNER_RECEIPT_INVALID','Versioned exact native receipt digest required');
 const raw=base64(result.receipt_json_b64);if(raw.length>MAX_CAPTURE||hash(raw)!==result.receipt_digest)fail('RUNNER_RECEIPT_INVALID','Exact native receipt bytes differ');
 const receipt=strictJSON(raw,MAX_CAPTURE);if(!object(receipt))fail('RUNNER_RECEIPT_INVALID','Native receipt object required');
 return {raw,digest:result.receipt_digest,receipt};
}
function capturedItem(value:unknown):{base64:string;digest:string;size_bytes:string;complete:boolean;bytes:Buffer}{
 if(!object(value)||typeof value.base64!=='string'||value.base64.length>MAX_CAPTURE*2||!digest(value.digest)||!decimal(value.size_bytes)||typeof value.complete!=='boolean')fail('RUNNER_RECEIPT_INVALID','Complete bounded captured bytes required');
 const bytes=Buffer.from(value.base64,'base64');if(bytes.length>MAX_CAPTURE||bytes.toString('base64')!==value.base64||hash(bytes)!==value.digest||String(bytes.length)!==value.size_bytes)fail('RUNNER_RECEIPT_INVALID','Captured bytes, size or digest differ');
 return {...value,base64:value.base64,digest:value.digest,size_bytes:value.size_bytes,complete:value.complete,bytes};
}
function validateReceipt(row:Job,value:Record<string,any>):void{
 const p=row.plan.request,b=row.plan.binding;
 const expected:Record<string,unknown>={operation_id:row.operation_id,organisation_id:row.organisation_id,run_id:row.run_id,session_id:row.session_id,repository_id:p.repository_id,sandbox_id:b.sandbox_id,boot_id:b.boot_id,boot_generation:String(b.boot_generation),slot_id:b.slot_id,slot_generation:String(b.slot_generation),plan_digest:row.plan_digest,argv:p.argv,requested_cwd:p.cwd,executable_digest:p.executable_digest,environment_digest:p.environment_digest,source_manifest_digest:p.source_digest,policy_digest:p.policy_digest};
 const preparing=row.job_class==='PREPARATION';
 if(preparing){
  verifyPreparationReceipt(Buffer.from(JSON.stringify(value)),{operation_id:row.operation_id,plan_digest:row.plan_digest,argv:p.argv,executable_digest:p.executable_digest,workspace_path:b.workspace_path,uid:b.uid,gid:b.gid});
 }else{
 expected.source_object_id=b.source_object_id;expected.source_tree_id=b.source_tree_id;
 if(!digest(row.plan.source_state_digest)||!digest(row.plan.workspace_digest))fail('RUNNER_MEASURED_INPUT_UNPINNED','Actual physical source and workspace measurements must be pinned in admission');
 expected.source_state_digest=row.plan.source_state_digest;expected.workspace_digest=row.plan.workspace_digest;
 }
 for(const [key,wanted] of Object.entries(expected))if(!same(value[key],wanted))fail('RUNNER_RECEIPT_BINDING_MISMATCH','Native receipt differs from the immutable admitted plan: '+key);
 if(value.execution_plane!=='REMOTE'||value.workspace_path!==b.workspace_path||(!preparing&&!digest(value.source_state_digest))||p.source_provenance_digest!==undefined&&value.source_provenance_digest!==p.source_provenance_digest||!object(value.start_identity)||!Number.isSafeInteger(value.start_identity.pid)||Number(value.start_identity.pid)<=0||!decimal(value.start_identity.start_time,true)||typeof value.start_identity.os_boot_id!=='string'||!uuid(value.start_identity.os_boot_id)||!Number.isSafeInteger(value.start_identity.pgid)||Number(value.start_identity.pgid)<=0||value.start_identity.uid!==b.uid)fail('RUNNER_PROCESS_IDENTITY_MISMATCH','Exact source and kernel process identity required');
 if(!Number.isSafeInteger(value.exit_code)||!Number.isSafeInteger(value.signal)||value.signal<0||![value.timed_out,value.interrupted,value.truncated,value.output_complete,value.artifacts_complete,value.observed_process_absent].every(x=>typeof x==='boolean')||!['CONFIRMED','UNKNOWN'].includes(value.cleanup_status)||!Number.isFinite(Date.parse(value.started_at))||!Number.isFinite(Date.parse(value.ended_at))||Date.parse(value.ended_at)<Date.parse(value.started_at)||!Number.isSafeInteger(value.duration_ms)||value.duration_ms<0)fail('RUNNER_RECEIPT_INVALID','Actual process outcome, timing and cleanup observations required');
 if(!Array.isArray(value.artifacts)||value.artifacts.length>p.artifact_paths.length||value.artifacts.some((a:unknown)=>!object(a)||!p.artifact_paths.includes(a.path as string))||new Set(value.artifacts.map((a:Record<string,unknown>)=>a.path)).size!==value.artifacts.length||value.artifacts_complete&&value.artifacts.length!==p.artifact_paths.length)fail('RUNNER_ARTIFACT_MISMATCH','Artifacts differ from requested exact paths');
 capturedItem(value.stdout);capturedItem(value.stderr);for(const item of value.artifacts)capturedItem(item);
}
async function storeBytes(store:ArtifactStoreCapability,i:InvocationContext,bytes:Buffer):Promise<ObjectReference>{
 const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id},chunks:Record<string,unknown>[]=[];let offset=0;
 // Even an empty capture has one immutable verified child object.
 do{const part=bytes.subarray(offset,Math.min(offset+196608,bytes.length));
 const response=await store.invoke('artifact.object.put',{...scope,digest:hash(part),size_bytes:String(part.length),data_base64:part.toString('base64'),...RETENTION},i) as Record<string,any>;
 if(response.outcome!=='SUCCEEDED'||response.availability!=='VERIFIED'||!object(response.artifact)||!object(response.receipt)||!uuid(response.artifact.artifact_id)||response.artifact.status!=='COMPLETE'||response.artifact.organisation_id!==scope.organisation_id||response.artifact.run_id!==scope.run_id||!digest(response.receipt.receipt_id)||response.receipt.artifact_id!==response.artifact.artifact_id||response.receipt.digest!==hash(part)||response.receipt.organisation_id!==scope.organisation_id||response.receipt.run_id!==scope.run_id||response.artifact.digest!==hash(part)||response.artifact.size_bytes!==String(part.length))fail('RUNNER_ARTIFACT_UNAVAILABLE','Actual durable captured object receipt required');
 chunks.push({sequence:chunks.length,artifact_id:response.artifact.artifact_id,digest:hash(part),size_bytes:String(part.length),offset_bytes:String(offset)});offset+=part.length;
 }while(offset<bytes.length);
 const response=await store.invoke('artifact.manifest.commit',{...scope,expected_chunks:chunks.length,total_size_bytes:String(bytes.length),content_digest:hash(bytes),complete:true,truncated:false,missing_ranges:[],chunks,...RETENTION},i) as Record<string,any>;
 if(response.outcome!=='SUCCEEDED'||response.availability!=='VERIFIED'||!object(response.artifact)||!object(response.receipt)||!uuid(response.artifact.artifact_id)||!digest(response.artifact.digest)||response.content_digest!==hash(bytes)||response.artifact.organisation_id!==scope.organisation_id||response.artifact.run_id!==scope.run_id||!digest(response.receipt.receipt_id))fail('RUNNER_ARTIFACT_UNAVAILABLE','Actual durable ordered manifest receipt required');
 return {storage_kind:'manifest',artifact_id:response.artifact.artifact_id,digest:hash(bytes),manifest_digest:response.artifact.digest,size_bytes:String(bytes.length),complete:true};
}
async function persistableResult(store:ArtifactStoreCapability,i:InvocationContext,row:Job,provider:ProviderResult,decoded:ReturnType<typeof decodeNative>):Promise<Record<string,unknown>>{
 const n=decoded.receipt,p=row.plan.request,b=row.plan.binding;
 const stdout=capturedItem(n.stdout),stderr=capturedItem(n.stderr);
 const stdoutRef=await storeBytes(store,i,stdout.bytes),stderrRef=await storeBytes(store,i,stderr.bytes),nativeRef=await storeBytes(store,i,decoded.raw);
 const artifacts:Record<string,unknown>[]=[];for(const item of n.artifacts){const capture=capturedItem(item);artifacts.push({path:item.path,...await storeBytes(store,i,capture.bytes),complete:capture.complete&&n.artifacts_complete});}
 const complete=provider.provider_process_termination_confirmed===true&&stdout.complete&&stderr.complete&&artifacts.every(a=>a.complete===true)&&n.output_complete&&!n.truncated&&n.artifacts_complete&&n.cleanup_status==='CONFIRMED'&&n.observed_process_absent;
 return {execution_plane:'REMOTE',outcome:complete?(n.exit_code===0&&n.signal===0&&!n.timed_out&&!n.interrupted?'SUCCEEDED':'FAILED'):'UNKNOWN',status:complete?(n.timed_out?'TIMED_OUT':'COMPLETED'):'UNKNOWN',operation_id:row.operation_id,session_id:row.session_id,organisation_id:row.organisation_id,run_id:row.run_id,repository_id:p.repository_id,sandbox_id:b.sandbox_id,boot_id:b.boot_id,boot_generation:String(b.boot_generation),sandbox_boot_generation:String(b.boot_generation),slot_id:b.slot_id,slot_generation:String(b.slot_generation),provider:b.provider,native_resource_id:b.external_sandbox_id,process_ref:provider.process_ref,start_identity:n.start_identity,argv:p.argv,cwd:n.requested_cwd,workspace_path:n.workspace_path,source_digest:p.source_digest,source_manifest_digest:p.source_digest,source_state_digest:n.source_state_digest,workspace_digest:n.workspace_digest,source_object_id:n.source_object_id,source_tree_id:n.source_tree_id,...(p.source_provenance_digest!==undefined?{source_provenance_digest:p.source_provenance_digest}:{}),policy_digest:p.policy_digest,executable_digest:p.executable_digest,environment_digest:p.environment_digest,exit_code:n.signal===0?n.exit_code:null,signal:n.signal===0?null:n.signal,timed_out:n.timed_out,interrupted:n.interrupted,truncated:n.truncated,started_at:n.started_at,ended_at:n.ended_at,duration_ms:n.duration_ms,stdout:{...stdoutRef,complete:stdout.complete&&n.output_complete&&!n.truncated},stderr:{...stderrRef,complete:stderr.complete&&n.output_complete&&!n.truncated},stdout_digest:stdout.digest,stderr_digest:stderr.digest,spool_digest:provider.captured!.spool_digest,output_complete:n.output_complete,artifacts,artifacts_complete:n.artifacts_complete,cleanup_status:n.cleanup_status,cleanup:{complete:provider.provider_process_termination_confirmed===true&&n.cleanup_status==='CONFIRMED'&&n.observed_process_absent,observed_process_absent:n.observed_process_absent,receipt_digest:decoded.digest},native_receipt:nativeRef,provider_evidence_digest:provider.evidence_digest};
}
async function wait(ms:number,signal:AbortSignal):Promise<void>{
 if(signal.aborted)return;await new Promise<void>(resolve=>{const timer=setTimeout(done,ms);function done(){signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);done();}signal.addEventListener('abort',cancel,{once:true});});
}
// Retained START observations grant no restart, admission, lease or cleanup
// authority. The registered executable digest remains historical only.
async function retainedControlBinding(tx:PrimaryTransaction,i:InvocationContext,session_id:string,launch_id:string):Promise<Record<string,any>>{
 const guards=await tx.query("SELECT tgname FROM pg_trigger WHERE tgrelid='hyperfide.runner_registry'::regclass AND NOT tgisinternal AND tgenabled IN('O','A') AND tgname=ANY($1::text[])",[['immutable_physical_binding','retain_runner_registry']]);
 if(new Set(guards.rows.map(r=>r.tgname)).size!==2)fail('RUNNER_RETAINED_SCHEMA_REQUIRED','Actual immutable physical registry and retention guards required');
 const launch=await lookupNativeLaunch(tx,{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id,launch_id},i);
 if(!object(launch)||launch.authority!=='NONE'||launch.execution_observed_only!==true)fail('RUNNER_CONTROL_TARGET_UNREGISTERED','Actual retained committed START required');
 const r=(await tx.query('SELECT r.*,s.pool_id,s.native_sandbox_id AS external_sandbox_id,p.provider,clock_timestamp() AS db_now FROM hyperfide.runner_registry r JOIN hyperfide.sandboxes s ON s.organisation_id=r.organisation_id AND s.id=r.sandbox_id AND s.boot_generation=r.boot_generation JOIN hyperfide.sandbox_boots b ON b.organisation_id=r.organisation_id AND b.sandbox_id=r.sandbox_id AND b.boot_generation=r.boot_generation AND b.boot_id=r.boot_id JOIN hyperfide.worker_slots w ON w.organisation_id=r.organisation_id AND w.id=r.slot_id AND w.sandbox_id=r.sandbox_id AND w.boot_generation=r.boot_generation JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.session_id=$3 FOR SHARE OF r,s,b,w,p',[i.principal.organisation_id,i.principal.run_id,session_id])).rows[0];
 if(!r||!['CURRENT','PREPARING','REVOKED'].includes(r.state))fail('RUNNER_CONTROL_TARGET_UNREGISTERED','Retained physical slot and exact existing resource boot required');
 for(const key of ['organisation_id','run_id','sandbox_id','boot_id','slot_id'])if(String(r[key])!==String(launch[key]))fail('RUNNER_CONTROL_TARGET_MISMATCH','Retained START and physical registry differ');
 if(String(r.boot_generation)!==String(launch.sandbox_boot_generation)||!uuid(launch.attempt_id)||!decimal(launch.attempt_generation,true)||!digest(launch.payload_digest)||!digest(r.observation_digest)||!digest(r.boot_preparation_digest)||!digest(r.runner_binary_digest)||!Number.isSafeInteger(r.uid)||r.uid<1||!Number.isSafeInteger(r.gid)||r.gid<1||!uuid(r.session_id)||!uuid(r.pool_id)||typeof r.external_sandbox_id!=='string'||!r.external_sandbox_id)fail('RUNNER_CONTROL_TARGET_MISMATCH','Retained observed target identity is incomplete');
 for(const key of ['state_dir','runner_binary','workspace_path'])if(typeof r[key]!=='string'||!path.isAbsolute(r[key])||path.normalize(r[key])!==r[key]||r[key].includes('\0'))fail('RUNNER_CONTROL_TARGET_MISMATCH','Registered fixed physical paths required');
 return {...r,boot_generation:String(r.boot_generation),launch_id,attempt_id:launch.attempt_id,attempt_generation:String(launch.attempt_generation),retained_start:launch};
}
function controlRequest(binding:Record<string,any>,input:NativeRunnerRequest):BoundProviderRequest{
 const target={state_dir:binding.state_dir,launch_id:binding.launch_id,attempt_id:binding.attempt_id,attempt_generation:String(binding.attempt_generation),sandbox_id:binding.sandbox_id,boot_id:binding.boot_id,boot_generation:String(binding.boot_generation),...(input.command_id?{command_id:input.command_id}:{})};
 return boundRequest(binding,input.operation_id,[binding.runner_binary,'--component','12.4','--action',input.action,'--request-base64',Buffer.from(JSON.stringify(target)).toString('base64url')],30000);
}
export interface NativeControlTarget {readonly launch_id:string;readonly attempt_id:string;readonly attempt_generation:string;readonly sandbox_id:string;readonly boot_id:string;readonly boot_generation:string;readonly uid:number}
// Coherence validation grants no authority. The runtime derives its target from
// guarded primary state and its receipt from actual provider-captured stdout.
const CONTROL_STATUS:Record<string,readonly string[]>={'runner.observe':['RUNNING','CONFIRMED_STOPPED','UNKNOWN','PAUSED','DRAINING','DRAINED','CANCELLED','UNRESOLVED'],'runner.stop':['CONFIRMED_STOPPED','UNKNOWN'],'runner.cancel':['CANCELLED','UNRESOLVED'],'runner.pause':['PAUSED','UNRESOLVED'],'runner.drain':['DRAINING','DRAINED','CONFIRMED_STOPPED','UNRESOLVED'],'runner.resume':['RUNNING','UNRESOLVED']};
function validateControlCleanup(receipt:Record<string,unknown>,action:NativeControlAction):void{
 const artifacts=receipt.required_artifacts,credentials=receipt.credential_revocation;
 if(!Array.isArray(artifacts)||!Array.isArray(credentials)||artifacts.length>64||credentials.length>256)fail('RUNNER_CONTROL_RECEIPT_INVALID','Explicit required artifact and credential revocation inventories required');
 for(const a of artifacts)if(!object(a)||typeof a.name!=='string'||typeof a.local_durable!=='boolean'||a.digest!==null&&!digest(a.digest)||a.capture_receipt!==null&&!digest(a.capture_receipt))fail('RUNNER_CONTROL_RECEIPT_INVALID','Required artifact entries must carry digests and capture receipts explicitly');
 for(const c of credentials)if(!object(c)||typeof c.name!=='string'||!['REVOKED','UNRESOLVED','ABSENT'].includes(String(c.state)))fail('RUNNER_CONTROL_RECEIPT_INVALID','Credential revocation must be reported explicitly');
 if(receipt.cleanup_complete===true&&(!['CONFIRMED_STOPPED','CANCELLED','DRAINED'].includes(String(receipt.status))||artifacts.some(a=>!a.local_durable||a.capture_receipt===null)||credentials.some(c=>c.state==='UNRESOLVED')))fail('RUNNER_CONTROL_RECEIPT_CONTRADICTION','Cleanup completion requires confirmed termination, durable captured outputs and revoked credentials');
 if(action!=='runner.observe'&&(!object(receipt.authority)||receipt.authority.command_id!==receipt.command_id||!uuid(receipt.authority.authority_epoch)||!decimal(String(receipt.authority.fence_sequence),true)))fail('RUNNER_CONTROL_RECEIPT_INVALID','Command receipts must carry the verified coordinator fence');
}
export function validateNativeControlReceipt(value:unknown,target:NativeControlTarget,command_id?:string,action?:NativeControlAction):Record<string,unknown>{
 if(action!==undefined&&action!=='runner.observe'){
  if(!object(value)||!CONTROL_STATUS[action]!.includes(String(value.status))||value.action!==action||value.command_id!==command_id||!uuid(command_id))fail('RUNNER_CONTROL_RECEIPT_INVALID','Control receipt status, action and command identity required');
  validateControlCleanup(value,action);
  if(value.status==='PAUSED'&&Array.isArray(value.processes)&&value.processes.some(p=>!object(p)||!['T','t'].includes(String(p.state))))fail('RUNNER_CONTROL_RECEIPT_CONTRADICTION','Paused receipt requires every slot process frozen');
  if(['CANCELLED','DRAINED'].includes(String(value.status))&&(!Array.isArray(value.processes)||value.processes.length!==0||value.remaining_descendants!==0))fail('RUNNER_CONTROL_RECEIPT_CONTRADICTION','Confirmed termination requires an empty tree');
  return validateNativeControlReceipt({...value,status:['CANCELLED','DRAINED'].includes(String(value.status))?'CONFIRMED_STOPPED':['PAUSED','DRAINING','UNRESOLVED'].includes(String(value.status))?'UNKNOWN':value.status},target,command_id)&&value;
 }
 if(!object(value))fail('RUNNER_CONTROL_RECEIPT_INVALID','Native observation object required');
 const receipt=value,scope=object(receipt.binding)?receipt.binding:receipt;
 for(const field of ['launch_id','attempt_id','attempt_generation','sandbox_id','boot_id','boot_generation'] as const){const actual=field==='launch_id'?receipt.launch_id:scope[field];if(String(actual)!==String(target[field]))fail('RUNNER_CONTROL_RECEIPT_MISMATCH','Physical observation target differs');}
 if(!['RUNNING','CONFIRMED_STOPPED','UNKNOWN'].includes(String(receipt.status))||!uuid(receipt.observation_id)||!Number.isSafeInteger(receipt.observed_at_seconds)||!Array.isArray(receipt.processes)||!Number.isSafeInteger(receipt.remaining_descendants)||Number(receipt.remaining_descendants)<0||receipt.remaining_descendants!==receipt.processes.length||typeof receipt.ipc_closed!=='boolean'||typeof receipt.cleanup_complete!=='boolean'||command_id!==undefined&&receipt.command_id!==command_id)fail('RUNNER_CONTROL_RECEIPT_INVALID','Full physical process and IPC observation required');
 if(receipt.status==='CONFIRMED_STOPPED'&&(receipt.processes.length!==0||receipt.remaining_descendants!==0||receipt.ipc_closed!==true))fail('RUNNER_CONTROL_RECEIPT_CONTRADICTION','Stopped process observation requires an empty tree and closed IPC');
 // Physical process absence does not discharge artifact/credential/provider debt.
 for(const value of receipt.processes){if(!object(value)||!Number.isSafeInteger(value.pid)||Number(value.pid)<=0||!Number.isSafeInteger(value.pgid)||Number(value.pgid)<=0||value.uid!==target.uid||!decimal(value.start_time,true)||!uuid(value.os_boot_id))fail('RUNNER_CONTROL_RECEIPT_INVALID','Actual kernel process identities required');}
 return receipt;
}
export async function createComponent(ctx:ComponentContext):Promise<Component>{
 if(ctx.role!=='provisioner')fail('ROLE_DENIED','Runner queue execution belongs to the provisioner');
 const authority=ctx.dependencies.require('14.1','identity.authority',isIdentityAuthority);
 const provider=ctx.dependencies.require('8.3','provider.execution.v1',isProvider);
 const store=ctx.dependencies.require('15.2','artifact.store.v1',isArtifactStoreCapability);
 const config=await configuration(ctx),g=gatewayOf(ctx),controller=new AbortController(),signal=AbortSignal.any([ctx.signal,controller.signal]);
 const migration=await fs.readFile(new URL('../../migrations/0012-runner-registry.sql',import.meta.url));
 await g.withPrimaryTransaction({timeoutMs:5000},async tx=>{const row=(await tx.query('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=12')).rows[0];if(!row||row.name!=='0012-runner-registry'||row.checksum!==hash(migration))fail('RUNNER_SCHEMA_REQUIRED','Apply the exact trusted runner migration before executor startup');});
 const retainedRequests=new WeakMap<object,{invocation:InvocationContext;input:NativeRunnerRequest}>();
 let unregister:void|(()=>void);
 let active=0,completed=0,unknown=0,last_error:string|null=null;
 async function next(s:Signer):Promise<Job|null>{return g.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal},async tx=>{
 const p=(await tx.query('SELECT p.*,r.authority_epoch,r.state AS run_state,clock_timestamp() AS db_now FROM hyperfide.identity_principals p JOIN hyperfide.runs r ON r.organisation_id=p.organisation_id AND r.id=p.run_id WHERE p.credential_id=$1 FOR SHARE OF p,r',[s.credential_id])).rows[0];
 if(!currentSigner(p,s))fail('RUNNER_EXECUTOR_IDENTITY_MISMATCH','Configured credential must be a live current provisioner with the matching public key');
 const row=(await tx.query("SELECT * FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND state='ADMITTED' AND authority_epoch=$3 AND expires_at>clock_timestamp() ORDER BY created_at,operation_id LIMIT 1",[p.organisation_id,p.run_id,p.deployment_epoch])).rows[0];return row?row as Job:null;
 });}
 async function claim(row:Job,s:Signer,i:InvocationContext):Promise<string|null>{
 return g.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal,guard:tx=>i.guard(tx)},async tx=>{
 const current=(await tx.query('SELECT *,clock_timestamp() AS db_now FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR UPDATE',[row.organisation_id,row.run_id,row.operation_id])).rows[0] as Job|undefined;
 if(!current||current.state!=='ADMITTED')return null;
 try {
 if(current.plan_digest!==row.plan_digest||hash(runnerCanonical(current.plan))!==row.plan_digest||current.authority_epoch!==i.principal.deployment_epoch||new Date(current.expires_at).getTime()<=new Date(current.db_now).getTime())fail('RUNNER_ADMISSION_STALE','Current immutable admission and run epoch required');
 await authority.guard(tx,current.principal);
 const preparing=row.job_class==='PREPARATION';
 const b=await (preparing?readRunnerPreparationBinding:readRunnerBinding)(tx as PrimaryTransaction,{organisation_id:row.organisation_id,run_id:row.run_id,session_id:row.session_id});if(!preparing)await readRunnerReadiness(tx as PrimaryTransaction,b);
 for(const key of Object.keys(row.plan.binding))if(!same(b[key],row.plan.binding[key]))fail('RUNNER_BINDING_STALE','Admitted physical runner binding changed');
 const allocation=await readJobAllocation(tx as PrimaryTransaction,{organisation_id:row.organisation_id,run_id:row.run_id,reservation_id:row.reservation_id});
 if(!allocation||(['allocation_id','generation','slot_id','sandbox_id','sandbox_boot_generation','assignee_session_id','request_id'] as const).some(key=>!same(allocation[key],row.plan.allocation[key])))fail('RUNNER_ALLOCATION_STALE','Current complete reservation assignment differs from admission');
 const reservation=(await tx.query("SELECT *,clock_timestamp() AS db_now FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='ALLOCATED' FOR SHARE",[row.organisation_id,row.run_id,row.reservation_id])).rows[0];
 if(!reservation||new Date(reservation.expires_at).getTime()<=new Date(reservation.db_now).getTime())fail('RUNNER_RESERVATION_EXPIRED','Current allocated reservation required');
 } catch(error) {
 const code=object(error)&&typeof error.code==='string'?error.code:'';
 if(!/^(AUTH_|RUNNER_|REMOTE_|JOB_|RESOURCE_|RESERVATION_)/.test(code))throw error;
 await tx.query("UPDATE hyperfide.runner_remote_jobs SET state='UNKNOWN' WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND state='ADMITTED'",[row.organisation_id,row.run_id,row.operation_id]);
 unknown++;return null;
 }
 const id=randomUUID();await tx.query("UPDATE hyperfide.runner_remote_jobs SET state='CLAIMED',claim_id=$4,executor_credential_id=$5,claimed_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND state='ADMITTED'",[row.organisation_id,row.run_id,row.operation_id,id,s.credential_id]);return id;
 });}
 async function execute(row:Job,s:Signer):Promise<void>{
 const request=jobRequest(row),i=await authenticate(authority,s,row.run_id,row.authority_epoch,request,signal);
 const claim_id=await claim(row,s,i);if(!claim_id)return;
 active++;
 try{const observed=await provider.executeBound(request,signal,i);
 if(!observed.captured||typeof observed.process_ref!=='string'||!observed.process_ref||!digest(observed.evidence_digest))fail('RUNNER_PROVIDER_CAPTURE_MISSING','Actual provider process and captured native receipt required');
 const decoded=decodeNative(observed.captured);validateReceipt(row,decoded.receipt);
 const result=await persistableResult(store,i,row,observed,decoded),result_digest=hash(runnerCanonical(result)),result_signature=sign(null,runnerResultSigningBytes(row.organisation_id,row.run_id,row.operation_id,row.plan_digest,result_digest),s.key).toString('base64url');
 await g.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal,guard:tx=>i.guard(tx)},async tx=>{
 const current=(await tx.query('SELECT state,claim_id,executor_credential_id FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR UPDATE',[row.organisation_id,row.run_id,row.operation_id])).rows[0];
 if(!current||current.state!=='CLAIMED'||current.claim_id!==claim_id||current.executor_credential_id!==s.credential_id)fail('RUNNER_CLAIM_CHANGED','Current owned execution claim required for final links');
 const references:Array<{role:string;ref:Record<string,any>}>=[{role:'stdout',ref:result.stdout as Record<string,any>},{role:'stderr',ref:result.stderr as Record<string,any>},{role:'native_receipt',ref:result.native_receipt as Record<string,any>}];
 for(const ref of result.artifacts as Record<string,any>[])references.push({role:'artifact:'+hash(String(ref.path)).slice(7),ref});
 for(const {role,ref} of references)await tx.query('INSERT INTO hyperfide.runner_result_artifacts(organisation_id,run_id,operation_id,role,artifact_id,artifact_digest,content_digest,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[row.organisation_id,row.run_id,row.operation_id,role,ref.artifact_id,ref.storage_kind==='manifest'?ref.manifest_digest:ref.digest,ref.digest,ref.size_bytes]);
 const update=await tx.query("UPDATE hyperfide.runner_remote_jobs SET state=$6,result=$7,result_digest=$8,result_signature=$9,completed_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND claim_id=$4 AND executor_credential_id=$5 AND state='CLAIMED'",[row.organisation_id,row.run_id,row.operation_id,claim_id,s.credential_id,result.outcome==='UNKNOWN'?'UNKNOWN':'COMPLETED',JSON.stringify(result),result_digest,result_signature]);if(update.rowCount!==1)fail('RUNNER_CLAIM_CHANGED','Execution claim no longer belongs to this executor');});
 if(result.outcome==='UNKNOWN')unknown++;else completed++;
 }catch(error){unknown++;last_error=object(error)&&typeof error.code==='string'?error.code:'RUNNER_EXECUTION_UNKNOWN';
 // A crash or ambiguous commit may leave CLAIMED. Neither this loop nor a
 // replacement process ever executes it again; reconciliation owns it.
 try{await g.withPrimaryTransaction({timeoutMs:5000,maxRetries:0},async tx=>{await tx.query("UPDATE hyperfide.runner_remote_jobs SET state='UNKNOWN' WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND claim_id=$4 AND executor_credential_id=$5 AND state='CLAIMED'",[row.organisation_id,row.run_id,row.operation_id,claim_id,s.credential_id]);});}catch{/* Durable CLAIMED also forbids replay. */}
 }finally{active--;}
 }
 async function worker(index:number):Promise<void>{let cursor=index;while(!signal.aborted){let found=false;
 try{for(let count=0;count<config.signers.length&&!signal.aborted;count++){const s=config.signers[cursor++%config.signers.length]!;const row=await next(s);if(row){found=true;await execute(row,s);break;}}}catch(error){last_error=object(error)&&typeof error.code==='string'?error.code:'RUNNER_EXECUTOR_UNAVAILABLE';}
 await wait(found?50:500,signal);
 }}
 // Control operations use the same actual provider journal and request proof.
 const native:NativeRunnerCapability=Object.freeze({invokeNativeRunner:async(i:InvocationContext,input:NativeRunnerRequest,requestedSignal:AbortSignal)=>{
 if(signal.aborted)fail('RUNNER_EXECUTOR_CLOSED','Provisioner executor is closed');
 assertInvocation(i);
 const controlSignal=AbortSignal.any([signal,requestedSignal,i.signal]);await authority.authorize(i);if(i.principal.role!=='PROVISIONER'||!object(input)||!uuid(input.session_id)||!uuid(input.operation_id)||!NATIVE_CONTROL_ACTIONS.includes(input.action)||input.command_id!==undefined&&!uuid(input.command_id)||input.launch_id!==undefined&&!uuid(input.launch_id)||input.action!=='runner.observe'&&!uuid(input.command_id)||Object.keys(input).some(k=>!['session_id','operation_id','action','command_id','launch_id'].includes(k)))fail('RUNNER_CONTROL_DENIED','Actual provisioner and bounded native control request required');
 const b=await g.withPrimaryTransaction<Record<string,any>>({timeoutMs:5000,signal:controlSignal,guard:tx=>i.guard(tx)},async tx=>{
  const launch_id=input.launch_id??(await readRunnerBinding(tx as PrimaryTransaction,{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id,session_id:input.session_id})).launch_id;
  if(!uuid(launch_id))fail('RUNNER_CONTROL_TARGET_UNREGISTERED','Actual committed START launch required');
  return retainedControlBinding(tx as PrimaryTransaction,i,input.session_id,launch_id);
 });
 const signer=config.signers.find(s=>s.credential_id===i.principal.credential_id);if(!signer)fail('RUNNER_CONTROL_DENIED','Current configured provisioner signer required');
 if(!uuid(b.launch_id)||!uuid(b.attempt_id)||!decimal(b.attempt_generation,true))fail('RUNNER_CONTROL_TARGET_UNREGISTERED','Authoritative native launch and attempt binding required');
 const target={state_dir:b.state_dir,launch_id:b.launch_id,attempt_id:b.attempt_id,attempt_generation:String(b.attempt_generation),sandbox_id:b.sandbox_id,boot_id:b.boot_id,boot_generation:String(b.boot_generation),...(input.command_id?{command_id:input.command_id}:{})};
 const request=controlRequest(b,input);
 retainedRequests.set(request,{invocation:i,input:{...input,launch_id:b.launch_id}});
 const proof=await authenticate(authority,signer,i.principal.run_id,i.principal.deployment_epoch,request,controlSignal);
 let observed:ProviderResult;try{observed=await provider.executeBound(request,controlSignal,proof);}finally{retainedRequests.delete(request);}if(!observed.captured||typeof observed.process_ref!=='string'||!observed.process_ref)fail('RUNNER_CONTROL_UNKNOWN','Actual provider native control capture required');
 const captured=observed.captured;if(captured.complete!==true||captured.exit_code!==0)fail('RUNNER_CONTROL_UNKNOWN','Complete native control observation required');
 const result=strictJSON(Buffer.from(captured.stdout),MAX_CAPTURE);if(!object(result)||result.ok!==true||!object(result.result))fail('RUNNER_CONTROL_UNKNOWN','Actual native control receipt required');
 const receipt=validateNativeControlReceipt(result.result,{...target,uid:b.uid},input.action==='runner.observe'?undefined:input.command_id,input.action);
 const evidence=await storeBytes(store,proof,Buffer.from(captured.stdout));
 return {native:receipt,native_receipt:evidence,provider:{process_ref:observed.process_ref,evidence_digest:observed.evidence_digest,spool_digest:captured.spool_digest},retained_start:b.retained_start,executable_identity:{registered_digest:b.runner_binary_digest,freshly_measured_digest:null,qualification:'NOT_EVALUATED'},authority:'OBSERVATION_ONLY'};
 },authenticatePlacementProbe:async(i:InvocationContext,input:{probe_id:string},requestedSignal:AbortSignal)=>{
 assertInvocation(i);
 if(signal.aborted)fail('RUNNER_EXECUTOR_CLOSED','Provisioner executor is closed');
 const probeSignal=AbortSignal.any([signal,requestedSignal,i.signal]);await authority.authorize(i);
 if(i.principal.role!=='PROVISIONER'||i.payload.component!=='8.4-probe'||i.payload.action!=='provider.placement.probe'||!object(input)||!uuid(input.probe_id)||Object.keys(input).some(k=>k!=='probe_id')||!object(i.payload.input))fail('RUNNER_PROBE_AUTHORITY_DENIED','Genuine bounded placement probe invocation required');
 const original=i.payload.input;
 if(!uuid(original.pool_id)||!uuid(original.sandbox_id)||original.run_id!==i.principal.run_id||Object.keys(original).some(k=>!['pool_id','sandbox_id','run_id'].includes(k)))fail('RUNNER_PROBE_AUTHORITY_DENIED','Exact authenticated placement target required');
 const signer=config.signers.find(s=>s.credential_id===i.principal.credential_id);
 if(!signer)fail('RUNNER_PROBE_AUTHORITY_DENIED','Configured current provisioner signer required');
 if(input.probe_id!==i.operation.operation_id)fail('RUNNER_PROBE_AUTHORITY_DENIED','Probe identity must equal the genuine source operation');
 const deployment=await readDeployment(ctx.env);
 const connectivity=strictJSON(await privateBytes(ctx.env.HYPERFIDE_CONNECTIVITY_CONFIG,1024*1024));
 if(!object(connectivity)||connectivity.schema_version!==1||!Array.isArray(connectivity.targets))fail('RUNNER_PLACEMENT_PROBE_INVALID','Actual protected connectivity targets required');
 const targetsDigest=digestDocument(connectivity.targets);
 const request=await g.withPrimaryTransaction<BoundProviderRequest>({timeoutMs:5000,signal:probeSignal,guard:tx=>i.guard(tx)},async tx=>{
  const row=(await tx.query('SELECT p.*,clock_timestamp() AS db_now FROM hyperfide.provider_connectivity_probes p JOIN hyperfide.provider_pool_configurations pc ON pc.organisation_id=p.organisation_id AND pc.pool_id=p.pool_id AND pc.configuration_digest=p.configuration_digest AND pc.active WHERE p.organisation_id=$1 AND p.id=$2 FOR SHARE OF p,pc',[i.principal.organisation_id,input.probe_id])).rows[0];
  if(!row||row.pool_id!==original.pool_id||row.sandbox_id!==original.sandbox_id||row.status!=='UNKNOWN'||new Date(row.expires_at).getTime()<=new Date(row.db_now).getTime()||!object(row.observation)||!object(row.observation.bound_request))fail('RUNNER_PLACEMENT_PROBE_UNAVAILABLE','Actual current scoped durable probe request required');
  const pool=await currentPool(tx as PrimaryTransaction,deployment,String(row.pool_id));
  if(pool.scope.organisation_id!==i.principal.organisation_id||pool.scope.configuration_digest!==row.configuration_digest||row.endpoints_digest!==targetsDigest||connectivity.evidence_scope!==row.evidence_scope)fail('RUNNER_PLACEMENT_POLICY_STALE','Protected current pool or connectivity policy differs');
  const expected={component:i.payload.component,action:i.payload.action,payload_digest:i.operation.payload_digest,operation_id:i.operation.operation_id,credential_id:i.principal.credential_id,run_id:i.principal.run_id};
  if(!same(row.observation.source_invocation,expected))fail('RUNNER_PROBE_AUTHORITY_DENIED','Persisted probe source differs from the genuine incoming invocation');
  const candidate=row.observation.bound_request;
  exact(candidate,['binding','operation_id','argv','cwd','env_refs','timeout_ms']);
  if(!object(candidate.binding)||candidate.operation_id!==input.probe_id||!Array.isArray(candidate.argv)||!candidate.argv.length||candidate.argv.length>256||candidate.argv.some((v:unknown)=>typeof v!=='string'||!v||v.length>4096||v.includes('\0'))||typeof candidate.cwd!=='string'||!path.isAbsolute(candidate.cwd)||!object(candidate.env_refs)||Object.entries(candidate.env_refs).some(([k,v])=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)||typeof v!=='string'||!v||v.length>4096)||typeof candidate.timeout_ms!=='number'||!Number.isSafeInteger(candidate.timeout_ms)||candidate.timeout_ms<1||candidate.timeout_ms>3600000)fail('RUNNER_PLACEMENT_PROBE_INVALID','Stored protected-policy probe request is invalid');
  const b=candidate.binding;
  exact(b,['organisation_id','run_id','session_id','pool_id','sandbox_id','external_sandbox_id','boot_generation','preparation_digest']);
  if(b.organisation_id!==i.principal.organisation_id||b.run_id!==i.principal.run_id||b.pool_id!==row.pool_id||b.sandbox_id!==row.sandbox_id||String(b.boot_generation)!==String(row.boot_generation)||!uuid(b.session_id))fail('RUNNER_PROBE_AUTHORITY_DENIED','Stored probe differs from authenticated scope and boot');
  const observed=await readRunnerBinding(tx as PrimaryTransaction,{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id,session_id:b.session_id});
  for(const key of Object.keys(b))if(!same(key==='preparation_digest'?observed.boot_preparation_digest:observed[key],b[key]))fail('RUNNER_BINDING_STALE','Current registered physical probe target differs');
  await readRunnerReadiness(tx as PrimaryTransaction,observed);
  return candidate as unknown as BoundProviderRequest;
 });
 const proof=await authenticate(authority,signer,i.principal.run_id,i.principal.deployment_epoch,request,probeSignal);
 return {request,invocation:proof};
 }});
 for(const signer of config.signers)await next(signer);
 unregister=provider.registerRunnerBindingVerifier(async(tx,b,request)=>{try{
 const retained=object(request)?retainedRequests.get(request):undefined;
 if(retained){
  await retained.invocation.guard(tx);
  const r=await retainedControlBinding(tx,retained.invocation,retained.input.session_id,retained.input.launch_id!);
  if(!same(controlRequest(r,retained.input),request))return null;
  for(const key of Object.keys(b))if(!same(key==='preparation_digest'?r.boot_preparation_digest:r[key],b[key as keyof typeof b]))return null;
  return {evidence_digest:hash(runnerCanonical({registry:r.observation_digest,registry_version:String(r.registration_version),launch:r.retained_start})),observed_at:new Date(r.db_now).toISOString()};
 }
const job=(await tx.query("SELECT job_class FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND state='CLAIMED'",[b.organisation_id,b.run_id,(request as Record<string,any>)?.operation_id])).rows[0];
 const preparing=job?.job_class==='PREPARATION';
 const r=await (preparing?readRunnerPreparationBinding:readRunnerBinding)(tx,b);for(const key of Object.keys(b))if(String(key==='preparation_digest'?r.boot_preparation_digest:r[key])!==String(b[key as keyof typeof b]))return null;if(!preparing)await readRunnerReadiness(tx,r);return {evidence_digest:r.observation_digest,observed_at:new Date(r.db_now).toISOString()};}catch{return null;}});
 const workers=Array.from({length:config.concurrency},(_,index)=>worker(index));
 return {apiVersion:1,capabilities:{'runner.native.v1':native},actions:{'runner.executor.describe':async(_input,context)=>{assertInvocation(context.invocation);await authority.authorize(context.invocation);if(context.invocation.principal.role!=='PROVISIONER'||!config.signers.some(s=>s.credential_id===context.invocation!.principal.credential_id))fail('ROLE_DENIED','Configured provisioner status required');return {active,completed,unknown,last_error,concurrency:config.concurrency,replay_policy:'NEVER_RELAUNCH_CLAIMED_OR_UNKNOWN',authority:'NONE'};}},close:async()=>{controller.abort();await Promise.all(workers);if(typeof unregister==='function')unregister();}};
}
