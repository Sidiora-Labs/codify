import type {ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertInvocation,DIGEST,decimal,fail,uuid} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {runnerCanonical} from './bridge.js';
import type {RunnerEnvironmentRequest,RunnerExpectedInputs,RunnerInputReader} from './bridge.js';

export interface ReproductionJobInputRequest {
 job_id:string;lease_generation:string;reservation_id:string;input_manifest_digest:string;
}
/** This is semantic job authority, never physical readiness. The actual17 reader
 * owns the lease, allocation, accepted registry and source-currentness checks. */
export interface ReproductionExpectedAuthority {
 authority:'EXPECTED_AUTHORITY';namespace:'REPRODUCTION';organisation_id:string;run_id:string;
 job_id:string;lease_generation:string;reservation_id:string;input_manifest_digest:string;
 input_packet_digest:string;input_manifest:Record<string,unknown>;
 repository_id:string;source_manifest_digest:string;source_object_id:string;source_tree_id:string;
 profile_id:string;profile_digest:string;environment_digest:string;
 sandbox_id:string;sandbox_boot_generation:string;slot_id:string;
 recorded_runner_session_id:string|null;recorded_runner_boot_id:string|null;recorded_runner_slot_generation?:string|null;
 custody_id:string;custody_generation:string;
}
export type ReproductionAuthorityReader=(tx:PrimaryTransaction,i:InvocationContext,request:ReproductionJobInputRequest)=>Promise<ReproductionExpectedAuthority|null>;
export interface ReproductionPreparedInputs extends RunnerExpectedInputs {
 sandbox_id:string;boot_id:string;boot_generation:string;slot_id:string;slot_generation:string;
}
export type ReproductionPreparationReader=(tx:PrimaryTransaction,i:InvocationContext,authority:ReproductionExpectedAuthority)=>Promise<ReproductionPreparedInputs|null>;
interface EnvironmentCapability {
 registerInputReader(namespace:'REPRODUCTION',reader:RunnerInputReader):()=>void;
}
interface PreparationReceiptCapability {
 read(tx:PrimaryTransaction,i:InvocationContext,request:RunnerEnvironmentRequest):Promise<ReproductionPreparedInputs|null>;
}
const roles=['dependency','toolchain','configuration','graph','contract'] as const;
const oid=(v:unknown):v is string=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
const digest=(v:unknown):v is string=>typeof v==='string'&&DIGEST.test(v);
const denied=():never=>fail('REPRODUCTION_INPUT_AUTHORITY_DENIED','Exact reproduction namespace, job, lease and immutable source inputs are required');

export function reproductionJobRequest(request:RunnerEnvironmentRequest):ReproductionJobInputRequest {
 if(!object(request)||Object.keys(request).some(key=>!['job_namespace','job_id','lease_generation','reservation_id','input_manifest_digest','environment_digest'].includes(key))||request.job_namespace!=='REPRODUCTION'||!uuid(request.job_id)||!uuid(request.reservation_id)||
 !decimal(request.lease_generation,true)||!digest(request.input_manifest_digest)||!digest(request.environment_digest))denied();
 return {job_id:request.job_id,lease_generation:request.lease_generation!,reservation_id:request.reservation_id,input_manifest_digest:request.input_manifest_digest!};
}

/** The join is explicit: every semantic identity must agree with the retained
 * preparation receipt. Current measurements are checked separately by12.1. */
export function bindReproductionInputs(authority:ReproductionExpectedAuthority,prepared:ReproductionPreparedInputs|null,request:RunnerEnvironmentRequest,
 scope:{organisation_id:string;run_id:string}):ReproductionPreparedInputs|null {
 const selected=reproductionJobRequest(request);
 if(!authority||authority.authority!=='EXPECTED_AUTHORITY'||authority.namespace!=='REPRODUCTION'||
 authority.organisation_id!==scope.organisation_id||authority.run_id!==scope.run_id||
 authority.job_id!==selected.job_id||authority.lease_generation!==selected.lease_generation||
 authority.reservation_id!==selected.reservation_id||authority.input_manifest_digest!==selected.input_manifest_digest||
 authority.environment_digest!==request.environment_digest||!uuid(authority.repository_id)||!uuid(authority.profile_id)||
 !oid(authority.source_object_id)||!oid(authority.source_tree_id)||
 ![authority.input_packet_digest,authority.source_manifest_digest,authority.profile_digest,authority.environment_digest].every(digest)||
 !object(authority.input_manifest)||!roles.every(role=>object(authority.input_manifest[role])))denied();
 if(prepared===null)return null;
 const same=['organisation_id','run_id','job_id','lease_generation','reservation_id','input_manifest_digest','input_packet_digest',
 'repository_id','source_manifest_digest','source_object_id','source_tree_id','profile_id','profile_digest','environment_digest','custody_id','custody_generation'] as const;
 if(prepared.authority!=='EXPECTED_AUTHORITY'||prepared.namespace!=='REPRODUCTION'||
 same.some(key=>prepared[key]!==authority[key])||
 runnerCanonical(prepared.input_manifest)!==runnerCanonical(authority.input_manifest)||
 !uuid(prepared.runner_session_id)||![prepared.preparation_digest,prepared.source_state_digest,prepared.workspace_digest,prepared.receipt_digest].every(digest)||
 prepared.sandbox_id!==authority.sandbox_id||prepared.boot_generation!==authority.sandbox_boot_generation||prepared.slot_id!==authority.slot_id||!uuid(prepared.boot_id)||!decimal(prepared.slot_generation,true)||
 authority.recorded_runner_session_id!==null&&prepared.runner_session_id!==authority.recorded_runner_session_id||
 authority.recorded_runner_boot_id!==null&&prepared.boot_id!==authority.recorded_runner_boot_id||
 authority.recorded_runner_slot_generation!=null&&prepared.slot_generation!==authority.recorded_runner_slot_generation)denied();
 return Object.freeze(structuredClone(prepared));
}

export function createReproductionJobInputReader(readAuthority:ReproductionAuthorityReader,readPreparation:ReproductionPreparationReader):RunnerInputReader {
 if(typeof readAuthority!=='function'||typeof readPreparation!=='function')fail('RUNNER_INPUT_READER_INVALID','Actual semantic and retained preparation readers are required');
 return async(tx,i,request)=>{
  assertPrimaryTransaction(tx);assertInvocation(i);
  const selected=reproductionJobRequest(request);
  // The actual17 reader acquires the common04 fence before its14 guard.
  const authority=await readAuthority(tx,i,selected);
  if(authority===null)return null;
  const prepared=await readPreparation(tx,i,authority);
  return bindReproductionInputs(authority,prepared,request,i.principal);
 };
}

export function registerReproductionJobInputs(ctx:ComponentContext,readAuthority:ReproductionAuthorityReader,
 readPreparation?:ReproductionPreparationReader):()=>void {
 const environment=ctx.dependencies.require('12.1','qualification.environment.v1',(value:unknown):value is EnvironmentCapability=>
 object(value)&&typeof value.registerInputReader==='function');
 const physical=readPreparation??((tx,i,authority)=>{
  const receipts=ctx.dependencies.require('12.4','runner.preparation-receipts.v1',(value:unknown):value is PreparationReceiptCapability=>
   object(value)&&typeof value.read==='function');
  return receipts.read(tx,i,{job_namespace:'REPRODUCTION',job_id:authority.job_id,lease_generation:authority.lease_generation,
   reservation_id:authority.reservation_id,input_manifest_digest:authority.input_manifest_digest,environment_digest:authority.environment_digest});
 });
 return environment.registerInputReader('REPRODUCTION',createReproductionJobInputReader(readAuthority,physical));
}
