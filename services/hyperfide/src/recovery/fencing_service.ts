import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {createProviderIsolation,type ProviderIsolationRuntime} from '../providers/placement.js';
import {loadIsolationPermitVerifier,assertVerifiedIsolationPermit,type VerifiedIsolationPermit} from '../identity/credentials.js';
import {startIsolationHttpTransport,type IsolationHttpTransport} from '../transport/isolation.js';
import {createExternalWriterFence,bindProviderIsolation,externalFenceTopologyDigest,FileExternalFenceJournal,type ExternalFenceTopology,type ExternalFenceReceipt,type ProviderIsolationCapability,type ProviderIsolationBackend,type LegacyWriterBackend} from './fencing.js';

interface FencingConfiguration {
 schema_version:1;topology:ExternalFenceTopology;journal_directory:string;verifier_file:string;
 transport:{origin:string;host:string;port:number;certificate:string;private_key:string;max_concurrent?:number;deadline_ms?:number};
}
export interface ExternalFencingService {
 readonly address:string;
 isolate(permit:VerifiedIsolationPermit,signal:AbortSignal):Promise<ExternalFenceReceipt>;
 describe():Readonly<Record<string,unknown>>;
 close():Promise<void>;
}
export interface ExternalFencingServiceOptions {
 readonly env:Readonly<NodeJS.ProcessEnv>;readonly signal:AbortSignal;
 readonly providers:ProviderIsolationCapability;readonly legacy:LegacyWriterBackend;readonly ownedHost?:ProviderIsolationBackend;
}
function fail(code:string,message:string):never{throw new FoundationError(code,message)}
function fields(value:unknown,required:readonly string[],optional:readonly string[]=[],code='EXTERNAL_FENCE_CONFIG_INVALID'):asserts value is Record<string,unknown>{
 if(!object(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))fail(code,code==='EXTERNAL_FENCE_CONFIG_INVALID'?'Unexpected or missing trusted fencing configuration field':'Fencing description takes empty input');
}
async function configuration(filename:string|undefined):Promise<FencingConfiguration>{
 if(!filename||!path.isAbsolute(filename)||path.resolve(filename)!==filename||await fs.realpath(filename)!==filename)fail('EXTERNAL_FENCE_CONFIG_REQUIRED','Canonical private server fencing configuration required');
 const file=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await file.stat(),named=await fs.lstat(filename);
  if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==0o600||stat.size<1||stat.size>262144||stat.dev!==named.dev||stat.ino!==named.ino)fail('EXTERNAL_FENCE_CONFIG_UNSAFE','Trusted fencing configuration must be a bounded owned0600 regular file');
  const value:unknown=JSON.parse(await file.readFile('utf8'));
  fields(value,['schema_version','topology','journal_directory','verifier_file','transport']);
  fields(value.transport,['origin','host','port','certificate','private_key'],['max_concurrent','deadline_ms']);
  if(value.schema_version!==1||!object(value.topology)||value.topology.evidence_scope!=='LIVE_PROVIDER'||typeof value.journal_directory!=='string'||typeof value.verifier_file!=='string'||!path.isAbsolute(value.journal_directory)||!path.isAbsolute(value.verifier_file))fail('EXTERNAL_FENCE_CONFIG_INVALID','Production topology and protected journal/verifier paths are required');
  externalFenceTopologyDigest(value.topology as unknown as ExternalFenceTopology);
  return value as unknown as FencingConfiguration;
 }finally{await file.close()}
}
/** This permit-only listener has no database startup or authority activation path.
 * Supply actual provisioner backends from trusted startup code. Missing custody proof remains a backend refusal.
 */
export async function startExternalFencingService(options:ExternalFencingServiceOptions):Promise<ExternalFencingService>{
 options.signal.throwIfAborted();
 const config=await configuration(options.env.HYPERFIDE_EXTERNAL_FENCE_CONFIG_FILE);
 const verifier=await loadIsolationPermitVerifier(config.verifier_file);
 const journal=new FileExternalFenceJournal(config.journal_directory);
 const description=Object.freeze({configured:true,evidence_scope:'LIVE_PROVIDER_REQUIRED',writer_routes:config.topology.required_writer_ids.length,resources:config.topology.resources.length,topology_digest:externalFenceTopologyDigest(config.topology),database_required_for_listener:false,activation_authority:false,production_qualification:'NOT_ESTABLISHED_BY_CONFIGURATION'});
 const isolate=async(permit:VerifiedIsolationPermit,signal:AbortSignal):Promise<ExternalFenceReceipt>=>{
  assertVerifiedIsolationPermit(permit);
  const bound=AbortSignal.any([options.signal,signal]);bound.throwIfAborted();
  const backend=bindProviderIsolation(options.providers,permit);
  const fence=createExternalWriterFence(config.topology,backend,options.legacy,journal,{kind:'ISOLATION_PERMIT',permit},options.ownedHost);
  return fence.isolate({deployment_id:permit.deployment_id,operation_id:permit.operation_id,source_epoch:permit.source_epoch,signal:bound});
 };
 const listener:IsolationHttpTransport=await startIsolationHttpTransport({
  origin:config.transport.origin,host:config.transport.host,port:config.transport.port,certificate:config.transport.certificate,privateKey:config.transport.private_key,
  signal:options.signal,verifier,dispatch:isolate,
  ...(config.transport.max_concurrent===undefined?{}:{maxConcurrent:config.transport.max_concurrent}),
  ...(config.transport.deadline_ms===undefined?{}:{deadlineMs:config.transport.deadline_ms})
 });
 return Object.freeze({address:listener.address,isolate,describe:()=>description,close:()=>listener.close()});
}
/** Offline provisioner bootstrap uses the real lower provider factory without constructing a database context. */
export async function startProviderExternalFencingService(options:Omit<ExternalFencingServiceOptions,'providers'>&{runtime:Omit<ProviderIsolationRuntime,'env'|'signal'>}):Promise<ExternalFencingService>{
 const isolateConfiguredResource=createProviderIsolation({...options.runtime,env:options.env,signal:options.signal});
 return startExternalFencingService({env:options.env,signal:options.signal,providers:{isolateConfiguredResource},legacy:options.legacy,...(options.ownedHost?{ownedHost:options.ownedHost}:{})});
}
function provider(value:unknown):value is ProviderIsolationCapability{return object(value)&&typeof value.isolateConfiguredResource==='function'}
function legacy(value:unknown):value is LegacyWriterBackend{return object(value)&&typeof value.disableAdmission==='function'&&typeof value.observeIsolation==='function'}
/** Managed provisioner startup shares genuine initialized backends; standalone embedding uses the pure factory above. */
export async function createComponent(context:ComponentContext):Promise<Component>{
 if(context.role!=='provisioner')fail('ROLE_DENIED','External writer fencing is provisioner-only');
 const service=await startExternalFencingService({
  env:context.env,signal:context.signal,
  providers:context.dependencies.require('8.4','provider.isolation.v1',provider),
  legacy:context.dependencies.require('legacy-writer-isolation','migration.legacy-writers.v1',legacy)
 });
 return {apiVersion:1,capabilities:{'recovery.external-fencing.v1':service},actions:{'recovery.fencing.describe':input=>{fields(input,[],[],'EXTERNAL_FENCE_INPUT_INVALID');return service.describe()}},close:()=>service.close()};
}
