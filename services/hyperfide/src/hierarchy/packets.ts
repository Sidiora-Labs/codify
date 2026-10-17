import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {readSemanticDisposition} from '../storage/dispositions.js';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {Component,ComponentContext} from '../components/registry.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction,QuerySession} from '../storage/transactions.js';
import {FoundationError,object} from '../policy/programme.js';
import {validateProfile} from '../preparation/manifests.js';
import {loadProofObligations} from '../spec/obligations.js';
import type {PrimaryClient} from '../spec/obligations.js';

import {gateway,trustedActor,requireAuthority,record,uuid,decimal,digest,text,strings,canonical,hash,refuse,operation,ready,hierarchyReadGuard} from './packages.js';


export interface ContinuationArtifactBinding {
 artifact_id:string;artifact_digest:string;artifact_size_bytes:string;storage_kind:'object'|'manifest';content_digest:string;content_size_bytes:string;
}
export interface ContinuationBinding {
 schema_version:1;checkpoint_id:string;artifact:ContinuationArtifactBinding;
 source:{attempt_id:string;attempt_generation:string;task_id:string;workspace_id:string;repository_id:string;source_object_id:string;input_packet_digest:string;preparation_digest:string;dependency_digest:string;source_metadata_digest:string;agent_session_id:string|null;support_level:'NATIVE_RESUME'|'SOURCE_ONLY'|'UNSUPPORTED'};
 context_artifacts:{dependency:ContinuationArtifactBinding;summary:ContinuationArtifactBinding;findings:ContinuationArtifactBinding};
 instruction_cursor:string;authority:'NONE';context_restored:false;
}
export type ContinuationReader=(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;checkpoint_id:string},invocation:InvocationContext)=>Promise<ContinuationBinding>;
function continuationBinding(value:unknown,checkpointId:string):ContinuationBinding {
 const v=record(value,['schema_version','checkpoint_id','artifact','source','context_artifacts','instruction_cursor','authority','context_restored']);
 if(v.schema_version!==1||v.checkpoint_id!==checkpointId||v.authority!=='NONE'||v.context_restored!==false)return refuse('CONTINUATION_INPUT_INVALID','Checkpoint input must be the exact historical non-authoritative binding');
 function artifact(value:unknown):ContinuationArtifactBinding{
  const a=record(value,['artifact_id','artifact_digest','artifact_size_bytes','storage_kind','content_digest','content_size_bytes']);
  uuid(a.artifact_id);digest(a.artifact_digest);digest(a.content_digest);decimal(a.artifact_size_bytes,true);decimal(a.content_size_bytes,true);
  if(a.storage_kind!=='object'&&a.storage_kind!=='manifest')return refuse('CONTINUATION_INPUT_INVALID','Unknown stored continuation artifact format');
  return a as unknown as ContinuationArtifactBinding;
 }
 const capsule=artifact(v.artifact);
 if(capsule.storage_kind!=='manifest'||BigInt(capsule.content_size_bytes)<40n||BigInt(capsule.content_size_bytes)>134217728n)return refuse('CONTINUATION_INPUT_INVALID','Registered capsule size/format is unsupported');
 const source=record(v.source,['attempt_id','attempt_generation','task_id','workspace_id','repository_id','source_object_id','input_packet_digest','preparation_digest','dependency_digest','source_metadata_digest','agent_session_id','support_level']);
 for(const key of ['attempt_id','task_id','workspace_id','repository_id'])uuid(source[key]);
 if(source.agent_session_id!==null)uuid(source.agent_session_id);
 if(source.support_level==='NATIVE_RESUME'&&source.agent_session_id===null)return refuse('CONTINUATION_INPUT_INVALID','Native resume support requires an actual registered source session');
 decimal(source.attempt_generation);for(const key of ['input_packet_digest','preparation_digest','dependency_digest','source_metadata_digest'])digest(source[key]);
 if(typeof source.source_object_id!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source.source_object_id))return refuse('CONTINUATION_INPUT_INVALID','Full actual checkpoint source commit required');
 if(source.support_level!=='NATIVE_RESUME'&&source.support_level!=='SOURCE_ONLY')return refuse('CONTINUATION_UNSUPPORTED','Unsupported checkpoint cannot become a continuation input');
 const contexts=record(v.context_artifacts,['dependency','summary','findings']);for(const item of Object.values(contexts))artifact(item);
 if(typeof v.instruction_cursor!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(v.instruction_cursor))return refuse('CONTINUATION_INPUT_INVALID','Canonical persisted instruction cursor required');
 return freeze(v as unknown as ContinuationBinding);
}

interface ContinuationProvider {reader:ContinuationReader|null;sealed:boolean}
const continuationProviders=new Map<string,ContinuationProvider>();
async function currentContinuation(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;checkpoint_id:string},invocation:InvocationContext|undefined){
 if(!invocation)return refuse('AUTHENTICATED_ACTOR_REQUIRED','Continuation reads require the actual authenticated invocation');
 assertInvocation(invocation);
 if(invocation.principal.organisation_id!==scope.organisation_id||invocation.principal.run_id!==scope.run_id)return refuse('ACTOR_SCOPE_MISMATCH','Continuation scope differs from the authenticated actor');
 await invocation.guard(tx);
 const provider=continuationProviders.get(scope.run_id);
 if(provider)provider.sealed=true;
 if(!provider?.reader)return refuse('CONTINUATION_READER_REQUIRED','The actual checkpoint service must install its trusted historical reader before startup completes');
 return continuationBinding(await provider.reader(tx,scope,invocation),scope.checkpoint_id);
}

const MIGRATION_CHECKSUM='sha256:'+createHash('sha256').update(readFileSync(new URL('../../migrations/0032-execution-packets.sql',import.meta.url))).digest('hex');
async function packetSchema(tx:QuerySession):Promise<void>{
 const table=await tx.query("SELECT to_regclass('hyperfide.hierarchy_execution_packets') IS NOT NULL AS ready");
 if(!table.rows[0]?.ready)return refuse('PACKET_SCHEMA_REQUIRED','Apply the trusted execution-packet migration first');
 const metadata=await tx.query("SELECT 1 FROM hyperfide.schema_migrations WHERE version=32 AND name='0032-execution-packets' AND checksum=$1",[MIGRATION_CHECKSUM]);
 if(!metadata.rowCount)return refuse('PACKET_SCHEMA_REQUIRED','Execution packet migration provenance differs from trusted bytes');
}
function definitionField(definition:unknown,key:string):unknown{
 if(!object(definition))return undefined;
 let value:unknown=definition[key];
 if(value===undefined&&object(definition.section)&&object(definition.section.fields))value=definition.section.fields[key];
 if(object(value)&&Object.hasOwn(value,'value'))value=value.value;
 if(typeof value==='string'){try{return JSON.parse(value);}catch{return value;}}
 return value;
}
function resourceRequirements(value:unknown):Record<string,unknown>{
 if(!object(value))return refuse('RESOURCE_POLICY_REQUIRED','Accepted task intent must explicitly declare per-agent resource requirements');
 const v=record(value,['agent_sessions','cpu_millis','memory_bytes','disk_bytes','build_slots','test_slots','max_descendants']);
 if(v.agent_sessions!==1||!Number.isSafeInteger(v.cpu_millis)||Number(v.cpu_millis)<1)return refuse('RESOURCE_POLICY_INVALID','Each worker packet reserves one agent and a positive declared CPU budget');
 for(const k of ['build_slots','test_slots','max_descendants'])if(!Number.isSafeInteger(v[k])||Number(v[k])<0)return refuse('RESOURCE_POLICY_INVALID','Declared slot/descendant limits must be nonnegative safe integers');
 decimal(v.memory_bytes);decimal(v.disk_bytes);return v;
}



/** Metadata integrity only; actual filesystem verification remains the preparation service's job. */
function manifestMetadata(value:unknown){
 if(!object(value)||(value.schema_version!==1&&value.schema_version!==2))return refuse('ENVIRONMENT_PROFILE_INVALID','Supported complete preparation manifest required');
 const keys=value.schema_version===1?['schema_version','profile','files','directories','scan','digest']:['schema_version','profile','files','directories','symlinks','hardlinks','scan','digest'];
 const manifest=record(value,keys);
 if(!Array.isArray(manifest.files)||!Array.isArray(manifest.directories)||!object(manifest.scan)||(manifest.schema_version===2&&(!Array.isArray(manifest.symlinks)||!Array.isArray(manifest.hardlinks))))
  return refuse('ENVIRONMENT_PROFILE_INVALID','Complete preparation inventory arrays required');
 const {digest:preparationDigest,...body}=manifest;
 if(hash(body)!==digest(preparationDigest))return refuse('ENVIRONMENT_PROFILE_INVALID','Complete raw preparation manifest body differs from its digest');
 return manifest;
}

async function preparationManifest(tx:QuerySession,organisationId:string,profileId:string){
 const profiles=await tx.query('SELECT content_digest,manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2',[organisationId,profileId]);
 const row=profiles.rows[0];if(!row||!object(row.manifest))return refuse('ENVIRONMENT_PROFILE_REQUIRED','An immutable preparation manifest is required');
 const manifest=manifestMetadata(row.manifest),profile=validateProfile(manifest.profile);
 const clock=await tx.query('SELECT clock_timestamp() AS now');
 if(Date.parse(profile.policy.expires_at)<=new Date(clock.rows[0]!.now).getTime())return refuse('ENVIRONMENT_PROFILE_EXPIRED','Preparation profile expired before planning');
 if(manifest.digest!==row.content_digest)return refuse('ENVIRONMENT_PROFILE_INVALID','Stored preparation manifest identity is invalid');
 const {digest:manifestDigest,...body}=manifest;
 if(hash(body)!==manifestDigest)return refuse('ENVIRONMENT_PROFILE_INVALID','Stored preparation manifest bytes do not match its identity');
 return {preparation_digest:digest(row.content_digest),preparation_manifest:freeze(manifest),declared_profile:profile};
}
/** Accepted physical preparation demand, independent of a not-yet-created executor. */
export async function loadPreparationIntent(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;task_id:string;profile_id?:string}){
 assertPrimaryTransaction(tx);await readSemanticDisposition(tx,input);await ready(tx);
 const org=uuid(input.organisation_id),run=uuid(input.run_id),taskId=uuid(input.task_id);
 const tasks=await tx.query('SELECT id,spec_revision_id,spec_generation::text,criteria_digest,definition FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[org,run,taskId]);
 const task=tasks.rows[0];if(!task)return refuse('TASK_UNAVAILABLE','Preparation intent requires an accepted same-run task');
 const accepted=await tx.query('SELECT 1 FROM hyperfide.run_spec_revisions WHERE organisation_id=$1 AND run_id=$2 AND spec_generation=$3 AND spec_revision_id=$4',[org,run,task.spec_generation,task.spec_revision_id]);
 if(!accepted.rowCount)return refuse('SPEC_REVISION_UNACCEPTED','Task is not pinned to accepted immutable run history');
 const policyRows=await tx.query('SELECT policy_digest FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[org,run]);
 if(!policyRows.rows[0])return refuse('RUN_UNAVAILABLE','Accepted preparation intent requires a current run');
 const policyDigest=digest(policyRows.rows[0].policy_digest);
 const profileId=uuid(definitionField(task.definition,'environment_profile_id'));
 if(input.profile_id!==undefined&&uuid(input.profile_id)!==profileId)return refuse('ENVIRONMENT_PROFILE_MISMATCH','Requested profile differs from accepted task intent');
 const proof:unknown=await proofObligations(tx,{organisation_id:org,run_id:run,task_id:taskId,spec_generation:task.spec_generation,spec_revision_id:task.spec_revision_id});
 if(!object(proof)||!Array.isArray(proof.obligations)||!proof.obligations.length)return refuse('PROOF_REGISTRY_MISSING','Accepted preparation demand requires actual proof obligations');
 if(proof.criteria_digest!==task.criteria_digest||proof.spec_revision_id!==task.spec_revision_id||String(proof.spec_generation)!==task.spec_generation)return refuse('PROOF_REGISTRY_MISMATCH','Preparation proof policy differs from accepted task');
 const prepared=await preparationManifest(tx,org,profileId),requirements=resourceRequirements(definitionField(task.definition,'resource_requirements'));
 if(Number(requirements.cpu_millis)>prepared.declared_profile.resources.cpu_millis||BigInt(String(requirements.memory_bytes))>BigInt(prepared.declared_profile.resources.memory_bytes)||BigInt(String(requirements.disk_bytes))>BigInt(prepared.declared_profile.resources.disk_bytes))return refuse('RESOURCE_POLICY_INVALID','Declared agent resources exceed the accepted environment profile');
 return freeze({task_id:taskId,spec_revision_id:task.spec_revision_id,spec_generation:task.spec_generation,criteria_digest:task.criteria_digest,
  profile_id:profileId,profile_version:prepared.declared_profile.profile_version,...prepared,resource_requirements:requirements,
  registry_digest:digest(proof.registry_digest),proof_policy:proof.policy,execution_profile:acceptedExecutionProfile(task.definition,prepared.declared_profile),policy_digest:policyDigest,execution_authority:false as const});
}

/** Declared 7.3 capability; its graphGuard binds the authenticated role, scope and epoch to the read. */
export interface GraphSnapshotCapability {
 loadGraphSnapshot(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;authority_epoch:string;manifest_id:string;expected_sources:unknown[]},invocation:InvocationContext):Promise<Record<string,unknown>>;
}
export function isGraphSnapshotCapability(value:unknown):value is GraphSnapshotCapability {return object(value)&&typeof value.loadGraphSnapshot==='function';}
async function graphSnapshot(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;authority_epoch:string},manifestId:string,expected:unknown[],invocation:InvocationContext|undefined,reader:GraphSnapshotCapability|undefined):Promise<Record<string,unknown>>{
 if(reader){
  if(!invocation)return refuse('AUTHENTICATED_ACTOR_REQUIRED','Guarded graph capability reads require the actual authenticated invocation');
  return reader.loadGraphSnapshot(tx,{...scope,manifest_id:manifestId,expected_sources:expected},invocation);
 }
 // Legacy in-process callers (scheduler/adoption) already hold their own guarded transaction.
 const source=await import(new URL('../graph/publication.js',import.meta.url).href);
 if(typeof source.loadGraphSnapshot!=='function')return refuse('GRAPH_INPUT_UNAVAILABLE','Actual guarded graph snapshot loader is unavailable');
 return source.loadGraphSnapshot(tx,scope,manifestId,expected);
}
async function proofObligations(tx:PrimaryTransaction,pins:{organisation_id:string;run_id:string;task_id:string;spec_generation:string;spec_revision_id:string}):Promise<unknown>{
 if(typeof loadProofObligations!=='function')return refuse('PROOF_REGISTRY_MISSING','Actual proof obligation loader is unavailable');
 return loadProofObligations(tx as unknown as PrimaryClient,pins);
}
/** Every source the prepared environment declares must be the exact run-pinned commit. */
function assertProfileSources(profile:ReturnType<typeof validateProfile>,repositories:Record<string,unknown>[]):void{
 for(const declared of profile.repositories){
  const pinned=repositories.find(r=>r.repository_id===declared.id);
  if(!pinned||pinned.source_object_id!==declared.commit)return refuse('ENVIRONMENT_SOURCE_MISMATCH','Environment profile repository commit differs from the exact run source pin');
 }
}
async function currentRepositories(tx:QuerySession,org:string,run:string){
 return (await tx.query('SELECT repository_id,source_object_id,integration_ref FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 ORDER BY repository_id',[org,run])).rows;
}
async function currentDependencies(tx:QuerySession,org:string,run:string,taskId:string){
 const deps=await tx.query('SELECT d.predecessor_run_id,d.predecessor_task_id,d.milestone,t.state,t.current_custody_id,c.repository_id,c.source_object_id,c.custody_generation::text,c.authority,c.qualification_outcome FROM hyperfide.task_dependencies d JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.predecessor_run_id AND t.id=d.predecessor_task_id LEFT JOIN hyperfide.submission_custodies c ON c.organisation_id=t.organisation_id AND c.run_id=t.run_id AND c.id=t.current_custody_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.task_id=$3 ORDER BY d.predecessor_run_id,d.predecessor_task_id',[org,run,taskId]);
 if(deps.rows.some(d=>!d.repository_id||!d.source_object_id||d.qualification_outcome!=='PASS'||d.milestone==='RELEASED'||(d.milestone==='INTEGRATED'?d.state!=='INTEGRATED':!['QUALIFIED','INTEGRATING','INTEGRATED'].includes(d.state))))
  return refuse('DEPENDENCY_INPUT_UNAVAILABLE','Dependency requires exact qualified/integrated source evidence or a release-barrier input');
 return deps.rows;
}
/** Evidence identity of a dependency; lifecycle progress alone (QUALIFIED->INTEGRATED) is not a new input. */
const DEPENDENCY_EVIDENCE=['predecessor_run_id','predecessor_task_id','milestone','current_custody_id','repository_id','source_object_id','custody_generation','authority','qualification_outcome'];
function dependencyEvidence(rows:unknown[]):unknown[]{
 return rows.map(row=>{if(!object(row))return refuse('PACKET_INPUTS_MISSING','Invalid immutable dependency pin');return Object.fromEntries(DEPENDENCY_EVIDENCE.map(key=>[key,row[key]??null]));});
}
async function supersededContract(tx:QuerySession,org:string,run:string,contract:Record<string,unknown>):Promise<boolean>{
 const newer=await tx.query('SELECT 1 FROM hyperfide.contracts WHERE organisation_id=$1 AND run_id=$2 AND contract_key=$3 AND revision>$4 LIMIT 1',[org,run,text(contract.contract_key),decimal(contract.revision)]);
 return Boolean(newer.rowCount);
}
function contentDigest(value:string):string{return 'sha256:'+createHash('sha256').update(value,'utf8').digest('hex');}

export interface PacketAuthority {
 loadExecutionPacket:typeof loadExecutionPacket;readExecutionPacket:typeof readExecutionPacket;
 loadPreparationIntent:typeof loadPreparationIntent;validateExecutionInputs:typeof validateExecutionInputs;
 derivePreparedEnvironmentRoles:typeof derivePreparedEnvironmentRoles;deriveQualificationInputs:typeof deriveQualificationInputs;
 installContinuationReader:(reader:ContinuationReader)=>void;
}
export function isPacketAuthority(value:unknown):value is PacketAuthority {
 return object(value)&&['loadExecutionPacket','readExecutionPacket','loadPreparationIntent','validateExecutionInputs','derivePreparedEnvironmentRoles','deriveQualificationInputs','installContinuationReader'].every(key=>typeof value[key]==='function');
}

export interface ExecutionPacketRecord {packet_id:string;digest:string;mandatory_digest:string;packet:Record<string,unknown>}
function freeze<T>(value:T):T {
 if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
/** Return immutable historical inputs. Current admission/custody authority is a separate gate. */
export async function loadExecutionPacket(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;digest:string}):Promise<ExecutionPacketRecord>{
 assertPrimaryTransaction(tx);await readSemanticDisposition(tx,input);await ready(tx);return readExecutionPacket(tx,input);
}
/** Exact immutable observation only; caller owns authenticated causal snapshot admission. */
export async function readExecutionPacket(tx:QuerySession,input:{organisation_id:string;run_id:string;digest:string}):Promise<ExecutionPacketRecord>{
 await packetSchema(tx);
 const org=uuid(input.organisation_id),run=uuid(input.run_id),identity=digest(input.digest);
 const rows=await tx.query('SELECT *,attempt_generation::text,spec_generation::text,package_generation::text,leader_generation::text FROM hyperfide.hierarchy_execution_packets WHERE organisation_id=$1 AND run_id=$2 AND digest=$3',[org,run,identity]);
 const row=rows.rows[0];if(!row||!object(row.packet))return refuse('PACKET_UNAVAILABLE','No immutable execution packet matches the authenticated scope/digest');
 const p=row.packet;
 if(p.schema_version!==1||p.packet_phase!=='PROSPECTIVE_ADMISSION'||p.execution_authority!==false||!object(p.mandatory)||!object(p.mandatory.identity)||!object(p.mandatory.intent))
  return refuse('PACKET_CORRUPT','Stored execution packet schema is invalid');
 const i=p.mandatory.identity;
 for(const name of ['organisation_id','run_id','task_id','attempt_id','attempt_generation','spec_revision_id','spec_generation','package_id','package_generation','authority_epoch','leader_generation'])
  if(i[name]!==row[name])return refuse('PACKET_CORRUPT','Immutable packet column/body identity differs: '+name);
 if(hash(p)!==identity||p.mandatory_digest!==row.mandatory_digest||hash(p.mandatory)!==row.mandatory_digest||
    p.mandatory.policy_digest!==row.policy_digest||p.mandatory.intent.registry_digest!==row.registry_digest)
  return refuse('PACKET_CORRUPT','Immutable packet content differs from stored digests');
 deriveQualificationInputs(p);
 return freeze({packet_id:row.id,digest:identity,mandatory_digest:row.mandatory_digest,packet:p});
}

/** Current input eligibility for NEW admission only; never replace historical packet reads.
 * Each independently changeable input class is rechecked against current authority: accepted task intent,
 * platform epoch, environment manifest and its source commits, run source pins, dependency custody/qualification,
 * contract revisions, required graph artifacts and continuation bindings. Unrelated rows are never consulted. */
export async function validateExecutionInputs(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;digest:string},invocation?:InvocationContext,graphReader?:GraphSnapshotCapability){
 const loaded=await loadExecutionPacket(tx,input),m=loaded.packet.mandatory;
 if(!object(m)||!object(m.identity)||!object(m.intent)||!object(m.runtime)||!object(m.inputs)||!Array.isArray(m.inputs.repositories)||!Array.isArray(m.inputs.dependencies)||!Array.isArray(m.inputs.contracts)||!object(m.inputs.graph))return refuse('PACKET_INPUTS_MISSING','Admission requires complete immutable runtime/source inputs');
 const org=uuid(input.organisation_id),run=uuid(input.run_id),taskId=uuid(m.identity.task_id);
 const currentTask=await tx.query("SELECT t.spec_revision_id,t.spec_generation::text,t.criteria_digest,t.definition,r.authority_epoch FROM hyperfide.tasks t JOIN hyperfide.runs r ON r.organisation_id=t.organisation_id AND r.id=t.run_id WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.id=$3 FOR SHARE OF t,r",[org,run,taskId]);
 const current=currentTask.rows[0];
 if(!current||current.spec_revision_id!==m.identity.spec_revision_id||current.spec_generation!==m.identity.spec_generation||current.criteria_digest!==m.identity.criteria_digest||current.authority_epoch!==m.identity.authority_epoch||canonical(current.definition)!==canonical(m.intent.definition))
  return refuse('EXECUTION_INPUTS_STALE','Current task acceptance or platform epoch differs from immutable packet inputs');
 const prepared=await preparationManifest(tx,org,uuid(m.runtime.environment_profile_id));
 if(prepared.preparation_digest!==m.runtime.preparation_digest||hash(prepared.declared_profile)!==hash(m.runtime.declared_profile))return refuse('EXECUTION_INPUTS_STALE','Accepted environment manifest differs from immutable packet inputs');
 const checked=['IMMUTABLE_PACKET','CURRENT_ACCEPTED_TASK','CURRENT_AUTHORITY_EPOCH','ACCEPTED_ENVIRONMENT_MANIFEST'];
 const repositories=await currentRepositories(tx,org,run);
 if(canonical(repositories)!==canonical(m.inputs.repositories))return refuse('EXECUTION_INPUTS_STALE','Current run source pins differ from immutable packet inputs');
 assertProfileSources(prepared.declared_profile,repositories);
 checked.push('CURRENT_SOURCE_PINS');
 let dependencies:unknown[];
 try{dependencies=await currentDependencies(tx,org,run,taskId);}
 catch(error){if(error instanceof FoundationError&&error.code==='DEPENDENCY_INPUT_UNAVAILABLE')return refuse('EXECUTION_INPUTS_STALE','Current dependency custody/qualification no longer satisfies immutable packet inputs');throw error;}
 if(canonical(dependencyEvidence(dependencies))!==canonical(dependencyEvidence(m.inputs.dependencies)))return refuse('EXECUTION_INPUTS_STALE','Current dependency custody/qualification differs from immutable packet inputs');
 checked.push('CURRENT_DEPENDENCY_CUSTODY');
 for(const pinned of m.inputs.contracts){
  if(!object(pinned))return refuse('PACKET_INPUTS_MISSING','Invalid immutable contract pin');
  const rows=await tx.query('SELECT id AS contract_id,contract_key,revision::text,criteria_digest,definition FROM hyperfide.contracts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND revision=$4 AND criteria_digest=$5',[org,run,uuid(pinned.contract_id),decimal(pinned.revision),digest(pinned.criteria_digest)]);
  if(!rows.rowCount||canonical(rows.rows[0])!==canonical(pinned)||await supersededContract(tx,org,run,pinned))return refuse('EXECUTION_INPUTS_STALE','Pinned contract revision is unavailable or superseded');
 }
 checked.push('CURRENT_CONTRACT_REVISIONS');
 const graph=m.inputs.graph;
 if(graph.required){
  const current=await graphSnapshot(tx,{organisation_id:org,run_id:run,authority_epoch:uuid(m.identity.authority_epoch)},uuid(graph.manifest_id),
   m.inputs.repositories.map(value=>{if(!object(value))return refuse('PACKET_INPUTS_MISSING','Invalid immutable repository pin');return {repository_id:uuid(value.repository_id),source_object_id:text(value.source_object_id,64),overlay_digest:null};}),invocation,graphReader);
  const exact=['manifest_digest','source_manifest_digest','input_digest','parser_digest','schema_digest','config_digest','source_set','file_coverage','source_coverage','semantic_projection_complete','unprojected_semantic_edge_count','unresolved_reference_count'];
  if(!Array.isArray(current.source_coverage)||current.source_coverage.length<1||current.source_coverage.length>64||exact.some(key=>canonical(current[key])!==canonical(graph[key])))
   return refuse('EXECUTION_INPUTS_STALE','Current required graph provenance differs from the exact immutable packet inputs');
  checked.push('CURRENT_REQUIRED_GRAPH_ARTIFACTS');
 }else checked.push('GRAPH_EXPLICITLY_NOT_REQUIRED');
 if(m.intent.continuation!==undefined&&m.intent.continuation!==null){
  if(!object(m.intent.continuation))return refuse('CONTINUATION_INPUT_INVALID','Stored continuation binding is invalid');
  const continuation=await currentContinuation(tx,{organisation_id:org,run_id:run,checkpoint_id:uuid(m.intent.continuation.checkpoint_id)},invocation);
  if(canonical(continuation)!==canonical(m.intent.continuation))return refuse('EXECUTION_INPUTS_STALE','Historical checkpoint binding differs from immutable packet inputs');
  checked.push('CURRENT_CONTINUATION_ARTIFACTS');
 }
 return freeze({...loaded,checked_inputs:checked,execution_authority:false as const});
}

/** Pure hashes of supplied prepared bytes. The caller must establish provenance and readiness. */
export function derivePreparedEnvironmentRoles(manifest:unknown,context:unknown){
 const prepared=manifestMetadata(manifest),preparationDigest=digest(prepared.digest);
 const profile=validateProfile(prepared.profile),ctx=record(context,['execution_profile','resource_requirements','policy_digest']);
 const execution=record(ctx.execution_profile,['connector','model_profile_ref','credential_profile_ref','timeout_seconds']);
 if(!['codex','claude-code'].includes(String(execution.connector)))return refuse('EXECUTION_PROFILE_INVALID','An explicit frontier execution profile is required');
 text(execution.model_profile_ref);text(execution.credential_profile_ref);
 if(!Number.isSafeInteger(execution.timeout_seconds)||Number(execution.timeout_seconds)<1||Number(execution.timeout_seconds)>profile.policy.max_process_lifetime_seconds)
  return refuse('EXECUTION_PROFILE_INVALID','Effective execution lifetime exceeds its actual preparation policy');
 const resources=resourceRequirements(ctx.resource_requirements),policyDigest=digest(ctx.policy_digest);
 return freeze({preparation_digest:preparationDigest,profile_digest:hash(profile),
  toolchain_digest:hash({os:profile.os,image:profile.image,toolchains:profile.toolchains,package_managers:profile.package_managers,native_agents:profile.native_agents,connectors:profile.connectors,supervisor:profile.supervisor,hyperfide:profile.hyperfide,system_packages:profile.system_packages}),
  configuration_digest:hash({preparation_digest:preparationDigest,build_config:profile.build_config,generated_inputs:profile.generated_inputs,recipe:profile.recipe,execution_profile:execution,resource_requirements:resources,policy_digest:policyDigest}),
  authority:'NONE' as const});
}

function acceptedExecutionProfile(definition:unknown,profile:ReturnType<typeof validateProfile>){
 const execution=definitionField(definition,'execution_profile');
 if(!object(execution))return refuse('EXECUTION_PROFILE_REQUIRED','Accepted task intent must name its connector/model/auth profile references');
 record(execution,['connector','model_profile_ref','credential_profile_ref','timeout_seconds']);
 if(!['codex','claude-code'].includes(String(execution.connector)))return refuse('EXECUTION_PROFILE_INVALID','Only the approved frontier connector families are supported');
 text(execution.model_profile_ref);text(execution.credential_profile_ref);
 if(!Number.isSafeInteger(execution.timeout_seconds)||Number(execution.timeout_seconds)<1||Number(execution.timeout_seconds)>profile.policy.max_process_lifetime_seconds)return refuse('EXECUTION_PROFILE_INVALID','Execution lifetime exceeds the declared environment policy');
 return execution;
}

/** Hash actual non-result inputs; source-result commit/tree provenance stays distinct. */
export function deriveQualificationInputs(packet:unknown):{
 dependency_digest:string;toolchain_digest:string;configuration_digest:string;graph_digest:string;
 contract_digest:string;graph_manifest_digest:string|null;graph_status:'PINNED'|'NOT_REQUIRED'} {
 if(!object(packet)||packet.schema_version!==1||!object(packet.mandatory)||hash(packet.mandatory)!==packet.mandatory_digest)
  return refuse('PACKET_CORRUPT','Qualification inputs require the complete immutable mandatory packet');
 const m=packet.mandatory;
 if(!object(m.inputs)||!Array.isArray(m.inputs.dependencies)||!Array.isArray(m.inputs.contracts)||!object(m.inputs.graph)||
    !object(m.runtime)||!object(m.runtime.declared_profile)||!object(m.runtime.execution_profile)||!object(m.resource_requirements))
  return refuse('PACKET_INPUTS_MISSING','Required graph/contract/toolchain/configuration inputs are absent');
 const profile=validateProfile(m.runtime.declared_profile),graph=m.inputs.graph;
 if(typeof graph.required!=='boolean')return refuse('PACKET_INPUTS_MISSING','Graph requirement was not explicitly pinned');
 let graphDigest:string|null=null;
 if(graph.required){graphDigest=digest(graph.manifest_digest);uuid(graph.manifest_id);digest(graph.source_manifest_digest);if(!Array.isArray(graph.source_coverage)||graph.source_coverage.length<1||graph.source_coverage.length>64)return refuse('PACKET_INPUTS_MISSING','Required graph input lacks exact immutable source coverage');}
 else {if(graph.manifest_id!==null)return refuse('PACKET_CORRUPT','An unavailable graph cannot carry a substituted manifest');text(graph.reason,4096);}
 resourceRequirements(m.resource_requirements);digest(m.runtime.preparation_digest);digest(m.policy_digest);
 return freeze({dependency_digest:hash(m.inputs.dependencies),
  toolchain_digest:hash({os:profile.os,image:profile.image,toolchains:profile.toolchains,package_managers:profile.package_managers,native_agents:profile.native_agents,connectors:profile.connectors,supervisor:profile.supervisor,hyperfide:profile.hyperfide,system_packages:profile.system_packages}),
  configuration_digest:hash({preparation_digest:m.runtime.preparation_digest,build_config:profile.build_config,generated_inputs:profile.generated_inputs,recipe:profile.recipe,execution_profile:m.runtime.execution_profile,resource_requirements:m.resource_requirements,policy_digest:m.policy_digest}),
  graph_digest:hash(graph),contract_digest:hash(m.inputs.contracts),graph_manifest_digest:graphDigest,graph_status:graph.required?'PINNED':'NOT_REQUIRED'});
}

export function createComponent(context:ComponentContext):Component {
 const g=gateway(context),run=uuid(context.policy.programme_id);
 if(continuationProviders.has(run))return refuse('CONTINUATION_REGISTRY_EXISTS','The run already has a packet-service registry in this process');
 const provider:ContinuationProvider={reader:null,sealed:false};continuationProviders.set(run,provider);
 const installContinuationReader=(reader:ContinuationReader)=>{
  if(provider.sealed||provider.reader!==null||typeof reader!=='function')return refuse('CONTINUATION_REGISTRATION_CLOSED','Exactly one trusted checkpoint reader may register during component startup');
  provider.reader=reader;
 };
 // Declared dependency capability (7.3); resolved per use so its graphGuard binds each authenticated read.
 const graphReader=()=>context.dependencies.require('7.3','graph.snapshot.v1',isGraphSnapshotCapability);
 const validateInputs:typeof validateExecutionInputs=(tx,input,invocation,reader)=>validateExecutionInputs(tx,input,invocation,reader??(invocation?graphReader():undefined));
 return {apiVersion:1,capabilities:{'hierarchy.packets.v1':Object.freeze({loadExecutionPacket,readExecutionPacket,loadPreparationIntent,validateExecutionInputs:validateInputs,derivePreparedEnvironmentRoles,deriveQualificationInputs,installContinuationReader})},actions:{
 'hierarchy.packet.describe':async input=>{provider.sealed=true;record(input,[]);return {schema_version:1,packet_phase:'PROSPECTIVE_ADMISSION',execution_authority:false,hash:'SHA256_CANONICAL_JSON',max_packet_bytes:262144,
  mandatory_digest_scope:['identity','intent','inputs','runtime','resource_requirements','policy_digest'],optional_context:'RANKED_TRIMMABLE_SHA256_TEXT',post_admission_required:['CURRENT_COMPUTE_GRANT','VERIFIED_MATERIALISATION','QUALIFIED_CONNECTOR_LAUNCH']};},
 'hierarchy.packet.create':async (input,invocation)=>{
  provider.sealed=true;
  const v=record(input,['idempotency_key','leader_generation','package_generation','task_id','attempt_id','attempt_generation','sandbox_id','slot_id','sandbox_boot_generation','max_bytes','optional_context','continuation_checkpoint_id'],['idempotency_key','leader_generation','package_generation','task_id','attempt_id','attempt_generation','sandbox_id','slot_id','sandbox_boot_generation','max_bytes','optional_context']);
  const a=trustedActor(invocation),taskId=uuid(v.task_id),attemptId=uuid(v.attempt_id),generation=decimal(v.attempt_generation);
  const sandboxId=uuid(v.sandbox_id),slotId=uuid(v.slot_id),boot=decimal(v.sandbox_boot_generation);
  if(!Number.isInteger(v.max_bytes)||Number(v.max_bytes)<4096||Number(v.max_bytes)>262144||!Array.isArray(v.optional_context)||v.optional_context.length>64)return refuse('INVALID_REQUEST','Packet/context limits are out of bounds');
  // Optional context is ranked best-first; only it may be trimmed, lowest rank first, and every omission is recorded.
  const optionalInput=v.optional_context.map(value=>{
   const c=record(value,['source_id','digest','text']);text(c.source_id);digest(c.digest);
   if(contentDigest(text(c.text,4096))!==c.digest)return refuse('OPTIONAL_CONTEXT_DIGEST_MISMATCH','Optional context digest must be the SHA256 of its exact text');
   return c;
  });
  if(new Set(optionalInput.map(c=>c.source_id)).size!==optionalInput.length)return refuse('INVALID_REQUEST','Optional context source identities must be unique');
  let optional=optionalInput;
  return operation(g,a,'hierarchy.packet.create',v,async tx=>{
   await packetSchema(tx);
   const tasks=await tx.query('SELECT id,task_key,feature_package_id,spec_revision_id,spec_generation::text,criteria_digest,definition,wave,state,generation::text,state_version::text,current_attempt_id,current_custody_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[a.organisation_id,a.run_id,taskId]);
   const task=tasks.rows[0];if(!task)return refuse('TASK_UNAVAILABLE','Task is not in the authenticated run');
   const auth=await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:task.feature_package_id,package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER']});
   if(generation!==(BigInt(task.generation)+1n).toString())return refuse('ATTEMPT_GENERATION_STALE','Prospective generation must be current generation plus one');
   if(task.current_custody_id||['SUBMITTED','QUALIFYING','QUALIFIED','INTEGRATING','INTEGRATED','CANCELLED','STALE'].includes(task.state))return refuse('TASK_NOT_ADMISSIBLE','Task requires explicit disposition/revalidation before planning another attempt');
   const existing=await tx.query('SELECT compute_authority FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND compute_authority=\'CURRENT\' FOR SHARE',[a.organisation_id,a.run_id,taskId]);
   if(existing.rowCount)return refuse('TASK_NOT_ADMISSIBLE','A current compute attempt must be disposed before replanning');
   const runs=await tx.query('SELECT spec_revision_id,spec_generation::text,state_version::text,policy_digest,state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[a.organisation_id,a.run_id]);
   const run=runs.rows[0]!;
   const accepted=await tx.query('SELECT 1 FROM hyperfide.run_spec_revisions WHERE organisation_id=$1 AND run_id=$2 AND spec_generation=$3 AND spec_revision_id=$4',[a.organisation_id,a.run_id,task.spec_generation,task.spec_revision_id]);
   if(!accepted.rowCount)return refuse('SPEC_REVISION_UNACCEPTED','Task is not pinned to accepted immutable run history');
   const proof:unknown=await proofObligations(tx,{organisation_id:a.organisation_id,run_id:a.run_id,spec_generation:task.spec_generation,spec_revision_id:task.spec_revision_id,task_id:taskId});
   if(!object(proof)||!Array.isArray(proof.obligations)||!proof.obligations.length)return refuse('PROOF_REGISTRY_MISSING','Task has no executable/review proof obligations');
   if(proof.criteria_digest!==task.criteria_digest||proof.spec_revision_id!==task.spec_revision_id||String(proof.spec_generation)!==task.spec_generation)return refuse('PROOF_REGISTRY_MISMATCH','Proof obligations differ from exact task criteria/spec');
   digest(proof.registry_digest);
   const slots=await tx.query('SELECT s.id AS sandbox_id,s.boot_generation::text,s.observed_state,p.profile_id,w.id AS slot_id,w.state AS slot_state FROM hyperfide.sandboxes s JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id JOIN hyperfide.worker_slots w ON w.organisation_id=s.organisation_id AND w.sandbox_id=s.id AND w.boot_generation=s.boot_generation WHERE s.organisation_id=$1 AND s.id=$2 AND w.id=$3 FOR SHARE OF s,p,w',[a.organisation_id,sandboxId,slotId]);
   const slot=slots.rows[0];if(!slot||slot.boot_generation!==boot||slot.observed_state!=='RUNNING'||slot.slot_state!=='READY'||!slot.profile_id)return refuse('ENVIRONMENT_PROFILE_REQUIRED','Prospective slot/boot/profile is unavailable');
   const acceptedProfile=uuid(definitionField(task.definition,'environment_profile_id'));
   if(slot.profile_id!==acceptedProfile)return refuse('ENVIRONMENT_PROFILE_MISMATCH','Executor pool profile differs from accepted task environment');
   const prepared=await preparationManifest(tx,a.organisation_id,acceptedProfile);
   const profileRow={content_digest:prepared.preparation_digest},profile=prepared.declared_profile;
   const requirements=resourceRequirements(definitionField(task.definition,'resource_requirements'));
   if(Number(requirements.cpu_millis)>profile.resources.cpu_millis||BigInt(String(requirements.memory_bytes))>BigInt(profile.resources.memory_bytes)||BigInt(String(requirements.disk_bytes))>BigInt(profile.resources.disk_bytes))return refuse('RESOURCE_POLICY_INVALID','Per-agent declared requirements exceed the declared environment; usable capacity still requires independent admission');
   const execution=acceptedExecutionProfile(task.definition,profile);
   const scopeValue=definitionField(task.definition,'touches'),scope=strings(scopeValue,4096);
   if(!scope.length)return refuse('TASK_SCOPE_REQUIRED','Task has no explicit owned scope');
   const repos={rows:await currentRepositories(tx,a.organisation_id,a.run_id)};
   if(!repos.rows.length)return refuse('SOURCE_INPUTS_REQUIRED','No exact repository source input is pinned');
   assertProfileSources(profile,repos.rows);
   let continuation:ContinuationBinding|null=null;
   if(v.continuation_checkpoint_id!==undefined){
    continuation=await currentContinuation(tx,{organisation_id:a.organisation_id,run_id:a.run_id,checkpoint_id:uuid(v.continuation_checkpoint_id)},a.invocation);
    if(continuation.source.task_id!==taskId||continuation.source.attempt_id===attemptId||BigInt(continuation.source.attempt_generation)>=BigInt(generation)||!repos.rows.some(r=>r.repository_id===continuation!.source.repository_id))
     return refuse('CONTINUATION_SOURCE_MISMATCH','Checkpoint must belong to an older same-task attempt and accepted repository; its branch commit remains a separate immutable input');
   }
   const deps={rows:await currentDependencies(tx,a.organisation_id,a.run_id,taskId)};
   const contractPolicy=definitionField(task.definition,'contract_inputs');
   if(!Array.isArray(contractPolicy)||contractPolicy.length>256)return refuse('CONTRACT_INPUTS_REQUIRED','Accepted intent must explicitly name all required contract pins, including an explicit empty set');
   const contracts:Record<string,unknown>[]=[];
   for(const value of contractPolicy){
    const pin=record(value,['contract_id','revision','criteria_digest']);
    const contract=await tx.query('SELECT id AS contract_id,contract_key,revision::text,criteria_digest,definition FROM hyperfide.contracts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND revision=$4 AND criteria_digest=$5',
     [a.organisation_id,a.run_id,uuid(pin.contract_id),decimal(pin.revision),digest(pin.criteria_digest)]);
    if(!contract.rowCount)return refuse('CONTRACT_INPUT_UNAVAILABLE','Required immutable contract revision is unavailable');
    if(await supersededContract(tx,a.organisation_id,a.run_id,contract.rows[0]!))return refuse('CONTRACT_REVISION_SUPERSEDED','Accepted intent pins a superseded contract revision; revalidate the task first');
    contracts.push(contract.rows[0]!);
   }
   const graphPolicy=record(definitionField(task.definition,'graph_inputs'),['required','manifest_id','reason']);
   if(typeof graphPolicy.required!=='boolean')return refuse('GRAPH_INPUT_REQUIRED','Graph policy must explicitly declare required or not required');
   let graphInputs:Record<string,unknown>;
   if(graphPolicy.required){
    const graphId=uuid(graphPolicy.manifest_id);
    if(graphPolicy.reason!==null)return refuse('GRAPH_INPUT_REQUIRED','Pinned graph uses its exact manifest, not an absence reason');
    const graph=await graphSnapshot(tx,{organisation_id:a.organisation_id,run_id:a.run_id,authority_epoch:a.authority_epoch},graphId,repos.rows.map(r=>({repository_id:r.repository_id,source_object_id:r.source_object_id,overlay_digest:null})),a.invocation,graphReader());
    if(!Array.isArray(graph.source_coverage)||graph.source_coverage.length<1||graph.source_coverage.length>64||typeof graph.semantic_projection_complete!=='boolean')return refuse('GRAPH_INPUT_UNAVAILABLE','Published graph lacks exact source or semantic projection coverage');
    decimal(graph.unprojected_semantic_edge_count,true);decimal(graph.unresolved_reference_count,true);
    graphInputs={required:true,manifest_id:graphId,manifest_digest:digest(graph.manifest_digest),source_manifest_digest:digest(graph.source_manifest_digest),
     input_digest:digest(graph.input_digest),parser_digest:digest(graph.parser_digest),schema_digest:digest(graph.schema_digest),config_digest:digest(graph.config_digest),
     source_set:graph.source_set,file_coverage:graph.file_coverage,source_coverage:graph.source_coverage,semantic_projection_complete:graph.semantic_projection_complete,unprojected_semantic_edge_count:graph.unprojected_semantic_edge_count,unresolved_reference_count:graph.unresolved_reference_count};
   }else{
    if(graphPolicy.manifest_id!==null)return refuse('GRAPH_INPUT_REQUIRED','Non-required graph policy cannot substitute a graph manifest');
    graphInputs={required:false,manifest_id:null,reason:text(graphPolicy.reason,4096)};
   }
   const managers=await tx.query('SELECT manager_session_id FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[a.organisation_id,a.run_id,task.feature_package_id]);
   const manager=managers.rows[0]?.manager_session_id;if(!manager)return refuse('PACKAGE_UNAVAILABLE','A prospective worker needs one accountable manager');
   const mandatory={identity:{organisation_id:a.organisation_id,run_id:a.run_id,authority_epoch:a.authority_epoch,leader_generation:auth.leader_generation,
    package_id:task.feature_package_id,package_generation:auth.package_generation,task_id:taskId,task_key:task.task_key,attempt_id:attemptId,attempt_generation:generation,
    parent_session_id:manager,accountable_manager_session_id:manager,spec_revision_id:task.spec_revision_id,spec_generation:task.spec_generation,criteria_digest:task.criteria_digest},
    intent:{definition:task.definition,owned_scope:scope,proof_obligations:proof.obligations,proof_policy:proof.policy,registry_digest:proof.registry_digest,continuation},
    inputs:{repositories:repos.rows,dependencies:deps.rows,contracts,graph:graphInputs},
    runtime:{sandbox_id:sandboxId,slot_id:slotId,sandbox_boot_generation:boot,environment_profile_id:slot.profile_id,preparation_digest:profileRow.content_digest,
     declared_profile:profile,execution_profile:execution,connector_qualification:'REQUIRED_BEFORE_LAUNCH',materialisation:'REQUIRED_AFTER_ADMISSION'},
    resource_requirements:requirements,policy_digest:run.policy_digest};
   const mandatoryDigest=hash(mandatory);
   const payload=()=>({schema_version:1,packet_phase:'PROSPECTIVE_ADMISSION',execution_authority:false,mandatory,mandatory_digest:mandatoryDigest,
    observation:{run_spec_generation:run.spec_generation,run_state_version:run.state_version},optional_context:optional,omitted_optional_context:optionalInput.length-optional.length,
    omitted_optional_context_ids:optionalInput.slice(optional.length).map(c=>({source_id:c.source_id,digest:c.digest}))});
   while(Buffer.byteLength(canonical(payload()))>Number(v.max_bytes)){
    if(!optional.length)return refuse('PACKET_BUDGET_TOO_SMALL','Mandatory intent/constraints exceed packet budget and cannot be removed');
    optional=optional.slice(0,-1);
   }
   const packet=payload(),packetDigest=hash(packet),id=randomUUID();
   await tx.query('INSERT INTO hyperfide.hierarchy_execution_packets(organisation_id,run_id,id,digest,mandatory_digest,task_id,attempt_id,attempt_generation,spec_revision_id,spec_generation,package_id,package_generation,authority_epoch,leader_generation,policy_digest,registry_digest,packet) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
    [a.organisation_id,a.run_id,id,packetDigest,mandatoryDigest,taskId,attemptId,generation,task.spec_revision_id,task.spec_generation,task.feature_package_id,auth.package_generation,a.authority_epoch,auth.leader_generation,run.policy_digest,proof.registry_digest,JSON.stringify(packet)]);
   if(continuation){
    for(const [role,binding] of [['CAPSULE',continuation.artifact],['DEPENDENCY',continuation.context_artifacts.dependency],['SUMMARY',continuation.context_artifacts.summary],['FINDINGS',continuation.context_artifacts.findings]] as const)
     await tx.query('INSERT INTO hyperfide.hierarchy_execution_packet_artifacts(organisation_id,run_id,packet_id,artifact_role,artifact_id) VALUES($1,$2,$3,$4,$5)',[a.organisation_id,a.run_id,id,role,binding.artifact_id]);
   }
   return {packet_id:id,digest:packetDigest,mandatory_digest:mandatoryDigest,packet};
  });
 },
 'hierarchy.packet.validate':async (input,invocation)=>{
  provider.sealed=true;
  const v=record(input,['leader_generation','package_generation','digest']),a=trustedActor(invocation),identity=digest(v.digest);
  return g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyReadGuard(a),signal:a.signal},async tx=>{
   const loaded=await loadExecutionPacket(tx,{organisation_id:a.organisation_id,run_id:a.run_id,digest:identity});
   const m=loaded.packet.mandatory;if(!object(m)||!object(m.identity))return refuse('PACKET_CORRUPT','Immutable task identity is missing');
   await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:uuid(m.identity.package_id),package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER']});
   return validateInputs(tx,{organisation_id:a.organisation_id,run_id:a.run_id,digest:identity},a.invocation);
  });
 },
 'hierarchy.packet.derive':async (input,invocation)=>{
  provider.sealed=true;
  const v=record(input,['leader_generation','package_generation','digest','manifest']),a=trustedActor(invocation),identity=digest(v.digest);
  return g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyReadGuard(a),signal:a.signal},async tx=>{
   const loaded=await loadExecutionPacket(tx,{organisation_id:a.organisation_id,run_id:a.run_id,digest:identity});
   const m=loaded.packet.mandatory;if(!object(m)||!object(m.identity)||!object(m.runtime))return refuse('PACKET_CORRUPT','Immutable task identity is missing');
   await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:uuid(m.identity.package_id),package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER']});
   const roles=derivePreparedEnvironmentRoles(v.manifest,{execution_profile:m.runtime.execution_profile,resource_requirements:m.resource_requirements,policy_digest:m.policy_digest});
   return {digest:identity,roles,baseline:deriveQualificationInputs(loaded.packet),authority:'NONE'};
  });
 },
 'hierarchy.packet.inspect':async (input,invocation)=>{
  provider.sealed=true;
  const v=record(input,['leader_generation','package_generation','digest']),a=trustedActor(invocation),identity=digest(v.digest);
  return g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyReadGuard(a),signal:a.signal},async tx=>{
   await ready(tx);await packetSchema(tx);
   const packets=await tx.query('SELECT * FROM hyperfide.hierarchy_execution_packets WHERE organisation_id=$1 AND run_id=$2 AND digest=$3',[a.organisation_id,a.run_id,identity]);
   const p=packets.rows[0];if(!p)return refuse('PACKET_UNAVAILABLE','No immutable packet matches the authenticated scope/digest');
   const auth=await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:p.package_id,package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER']});
   if(hash(p.packet)!==identity||hash(p.packet.mandatory)!==p.mandatory_digest)return refuse('PACKET_CORRUPT','Stored packet content differs from its immutable identity');
   return {packet_id:p.id,digest:identity,mandatory_digest:p.mandatory_digest,packet:p.packet,authority:'NONE',
    package_binding_current:String(p.package_generation)===auth.package_generation,leader_binding_current:String(p.leader_generation)===auth.leader_generation};
  });
 }
 }};
}
