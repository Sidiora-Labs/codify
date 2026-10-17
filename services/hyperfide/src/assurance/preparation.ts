import {createHash} from 'node:crypto';
import {object} from '../policy/programme.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import type {ComponentContext} from '../components/registry.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertInvocation} from '../transport/protocol.js';
import type {RunnerEnvironmentRequest,RunnerExpectedInputs,RunnerPreparationPlan,RunnerPreparationAdmission} from '../runner/bridge.js';
import {derivePreparedEnvironmentRoles,loadPreparationIntent} from '../hierarchy/packets.js';
import {deriveEffectiveProfile} from '../preparation/effective.js';
import type {EffectiveResultSource,EffectiveProfileInput} from '../preparation/effective.js';
import {assuranceBarrier,canonical,digest,fail,hash,inspectSubmittedResult,uuid,rawDigest,retainArtifactBytes,artifact,fields,roles,scope as invocationScope,transaction,executionGate,invocation} from './submission.js';
import type {Data,PrimaryClient} from './submission.js';

export interface ResultPreparationContext {
 organisation_id:string;run_id:string;job_id:string;custody_id:string;job_state:string;job_lease_generation:string;
 result:Data;parent_profile_id:string;parent_preparation_digest:string;parent_profile_digest:string;
 parent_preparation_manifest:EffectiveProfileInput['parent']['preparation_manifest'];
 repository_binding:EffectiveProfileInput['repository_binding'];
 baseline_packet_digest:string;baseline_input_manifest:Data;accepted_context:Data;context_digest:string;
}
const RESULT_FIELDS=['custody_id','custody_generation','binding_digest','source_manifest_artifact_id',
 'source_manifest_digest','repository_id','source_object_id','source_tree_id'] as const;
export function effectiveResultProjection(result:Data):EffectiveResultSource {
 const value=Object.fromEntries(RESULT_FIELDS.map(key=>[key,result[key]]));
 for(const key of ['custody_id','source_manifest_artifact_id','repository_id'])uuid(value[key]);
 digest(value.binding_digest);digest(value.source_manifest_digest);
 return value as unknown as EffectiveResultSource;
}
/** This context permits preparation of an admitted result before semantic proof.
 * Parent profile ownership is established on primary state; the pure11 helper
 * cannot establish it from caller metadata. No new coding packet is created. */
export async function loadResultPreparationContext(tx:PrimaryTransaction,
 scope:{organisation_id:string;run_id:string},query:{job_id:string}):Promise<ResultPreparationContext> {
 const organisation_id=uuid(scope.organisation_id),run_id=uuid(scope.run_id),job_id=uuid(query.job_id);
 await assuranceBarrier(tx,{organisation_id,run_id},'SHARED');
 const found=await tx.query("SELECT j.id,j.custody_id,j.custody_generation::text,j.state,j.lease_generation::text,j.rubric_digest,c.task_id,s.manifest,s.policy,"
 +"q.state AS requalification_state,i.manifest AS requalification_manifest,i.policy AS requalification_policy FROM hyperfide.qualification_jobs j "
 +"JOIN hyperfide.submission_custodies c ON c.organisation_id=j.organisation_id AND c.run_id=j.run_id AND c.id=j.custody_id "
 +"JOIN hyperfide.assurance_submissions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.custody_id=c.id "
 +"LEFT JOIN hyperfide.requalification_operations q ON q.organisation_id=j.organisation_id AND q.run_id=j.run_id AND q.qualification_job_id=j.id "
 +"LEFT JOIN hyperfide.assurance_requalification_inputs i ON i.organisation_id=q.organisation_id AND i.run_id=q.run_id AND i.operation_id=q.id "
 +"WHERE j.organisation_id=$1 AND j.run_id=$2 AND j.id=$3 FOR SHARE OF j,c,s",[organisation_id,run_id,job_id]);
 const job=found.rows[0];
 if(!job||!['PENDING','RUNNING'].includes(job.state))fail('QUALIFICATION_RESULT_PREPARATION_REQUIRED','Current pending or running qualification job is required');
 const result=await inspectSubmittedResult(tx,{organisation_id,run_id},{custody_id:job.custody_id});
 if(String(job.custody_generation)!==result.custody_generation)fail('QUALIFICATION_STALE_CUSTODY','Preparation job custody generation changed');
 if(job.requalification_manifest&&
  (job.requalification_manifest.source_object_id!==result.source_object_id||
   job.requalification_manifest.source_manifest_digest!==result.source_manifest_digest))
  fail('QUALIFICATION_PUBLICATION_PREPARATION_REQUIRED','Integrated result preparation requires its genuine current publication source envelope');
 const intent=await loadPreparationIntent(tx,{organisation_id,run_id,task_id:job.task_id});
 if(!object(intent.proof_policy))fail('QUALIFICATION_PROOF_STALE','Accepted proof policy is unavailable');
 const currentManifest=job.requalification_manifest??job.manifest,currentPolicy=job.requalification_policy??job.policy;
 if(currentManifest.criteria_digest!==intent.criteria_digest||hash(currentPolicy)!==intent.registry_digest||
  job.rubric_digest!==intent.proof_policy.rubric_digest)
  fail('QUALIFICATION_PROOF_STALE','Preparation job no longer binds the current accepted proof definition');
 const parent=(await tx.query('SELECT id,content_digest,manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2 FOR SHARE',
 [organisation_id,intent.profile_id])).rows[0];
 if(!parent||parent.content_digest!==intent.preparation_digest||canonical(parent.manifest)!==canonical(intent.preparation_manifest))
  fail('QUALIFICATION_PARENT_PREPARATION_INVALID','Current registered parent preparation identity differs from the accepted task');
 const repositories=(await tx.query('SELECT id,url FROM hyperfide.repositories WHERE organisation_id=$1 AND id=$2 FOR SHARE',
 [organisation_id,result.repository_id])).rows;
 if(repositories.length!==1)fail('QUALIFICATION_REPOSITORY_MAPPING_REQUIRED','Registered result repository is missing');
 const matches=intent.declared_profile.repositories.filter((r:Data)=>r.url===repositories[0]!.url);
 if(matches.length!==1)fail('QUALIFICATION_REPOSITORY_MAPPING_REQUIRED','Parent profile must uniquely map the registered repository URL to its logical key');
 const actualIntent=intent as Data;
 if(!object(actualIntent.execution_profile)||typeof actualIntent.policy_digest!=='string')
  fail('QUALIFICATION_PREPARATION_CONTEXT_REQUIRED','The actual accepted runtime and run policy context is unavailable');
 const counterfactuals=(await tx.query("SELECT f.resolution_condition->'counterfactual_check_ids' AS checks FROM hyperfide.finding_repairs r JOIN hyperfide.finding_registry_records f ON f.organisation_id=r.organisation_id AND f.run_id=r.run_id AND f.finding_id=r.finding_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.custody_id=$3 AND r.state='READY_FOR_RECHECK' FOR SHARE OF r,f",
  [organisation_id,run_id,result.custody_id])).rows;
 const counterfactual_check_ids=[...new Set(counterfactuals.flatMap(row=>Array.isArray(row.checks)?row.checks:[]))].sort();
 if(counterfactual_check_ids.some(id=>!actualIntent.proof_policy.checks.some((check:Data)=>check.id===id)))
  fail('QUALIFICATION_PROOF_STALE','Recorded repair counterfactual is absent from the current accepted registry');
 const accepted_context={
  execution_profile:actualIntent.execution_profile,policy_digest:digest(actualIntent.policy_digest),
  task_id:intent.task_id,spec_revision_id:intent.spec_revision_id,spec_generation:String(intent.spec_generation),
  criteria_digest:intent.criteria_digest,registry_digest:intent.registry_digest,proof_policy_digest:hash(intent.proof_policy),
  registered_checks:intent.proof_policy.checks,
  counterfactual_check_ids,
  resource_requirements:intent.resource_requirements,
 };
 const body={organisation_id,run_id,job_id,custody_id:result.custody_id,job_state:job.state,job_lease_generation:String(job.lease_generation),result,
  parent_profile_id:parent.id,parent_preparation_digest:parent.content_digest,parent_profile_digest:hash(intent.declared_profile),
  parent_preparation_manifest:intent.preparation_manifest as unknown as EffectiveProfileInput['parent']['preparation_manifest'],
  repository_binding:{repository_id:result.repository_id,repository_key:matches[0]!.id,repository_url:repositories[0]!.url},
  baseline_packet_digest:digest(job.manifest.input_packet_digest),baseline_input_manifest:job.manifest.input_manifest,accepted_context};
 return {...body,context_digest:hash(body)};
}
/** Recompute the metadata derivation against the actual rechecked context and the
 * exact retained measurement object. The fixed remote recipe supplies measured
 * bytes; this helper never manufactures preparation or readiness. */
export function rederiveResultProfile(context:ResultPreparationContext,
 measured:EffectiveProfileInput['measured'],derived_profile_id:string,measurement_bytes:Uint8Array) {
 const {observation_artifact_digest,...body}=measured;
 let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(measurement_bytes);}catch{fail('QUALIFICATION_MEASUREMENT_INTEGRITY','Measurement must be exact canonical UTF-8 bytes');}
 if(measurement_bytes.byteLength>256*1024||'sha256:'+createHash('sha256').update(measurement_bytes).digest('hex')!==observation_artifact_digest||
  text!==canonical(body)+'\n')
  fail('QUALIFICATION_MEASUREMENT_INTEGRITY','Retained measured-inputs bytes do not match the exact native measurement fields');
 return deriveEffectiveProfile({
  parent:{profile_id:context.parent_profile_id,preparation_manifest:context.parent_preparation_manifest},
  result:effectiveResultProjection(context.result),repository_binding:context.repository_binding,measured,derived_profile_id:uuid(derived_profile_id),
 });
}

/** Expected input authority only. The independently observed runner12 compares
 * this immutable ledger to actual profile, preparation, source and workspace.
 * No caller digest or old baseline environment can substitute for a missing row. */
export async function inspectEffectiveResultInputs(tx:PrimaryClient,
 scope:{organisation_id:string;run_id:string},query:{job_id:string}):Promise<Data> {
 assertPrimaryTransaction(tx);
 const organisation_id=uuid(scope.organisation_id),run_id=uuid(scope.run_id),job_id=uuid(query.job_id);
 await assuranceBarrier(tx,{organisation_id,run_id},'SHARED');
 const found=await tx.query("SELECT e.*,a.digest AS artifact_digest,a.status AS artifact_status,"
 +"p.content_digest AS preparation_digest,p.manifest AS preparation_manifest,"
 +"j.custody_generation::text AS current_custody_generation,j.rubric_digest,j.state AS job_state,pi.context_digest AS preparation_context_digest,pi.derived_profile_id "
 +"FROM hyperfide.assurance_effective_result_inputs e "
 +"JOIN hyperfide.artifacts a ON a.organisation_id=e.organisation_id AND a.run_id=e.run_id AND a.id=e.receipt_artifact_id "
 +"JOIN hyperfide.environment_profiles p ON p.organisation_id=e.organisation_id AND p.id=e.profile_id "
 +"JOIN hyperfide.assurance_preparation_intents pi ON pi.organisation_id=e.organisation_id AND pi.run_id=e.run_id AND pi.operation_id=e.preparation_operation_id "
 +"JOIN hyperfide.qualification_jobs j ON j.organisation_id=e.organisation_id AND j.run_id=e.run_id AND j.id=e.job_id "
 +"WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.job_id=$3 FOR SHARE OF e,a,p,j",[organisation_id,run_id,job_id]);
 const row=found.rows[0],receipt=row?.receipt;
 if(!row||!object(receipt)||row.artifact_status!=='COMPLETE'||row.artifact_digest!==row.receipt_digest||
  hash(receipt)!==row.receipt_digest||receipt.schema_version!==1||receipt.kind!=='EFFECTIVE_RESULT_INPUTS'||
  receipt.organisation_id!==organisation_id||receipt.run_id!==run_id||receipt.job_id!==job_id||
  receipt.custody_id!==row.custody_id||String(receipt.custody_generation)!==String(row.custody_generation)||
  String(row.custody_generation)!==row.current_custody_generation||
  receipt.profile_id!==row.profile_id||row.profile_id!==row.derived_profile_id||receipt.preparation_context_digest!==row.preparation_context_digest||receipt.preparation_operation_id!==row.preparation_operation_id||
  receipt.preparation_digest!==row.preparation_digest||receipt.baseline_packet_digest!==row.baseline_packet_digest||
  receipt.accepted_context_digest!==row.accepted_context_digest||canonical(receipt.input_manifest)!==canonical(row.input_manifest))
  fail('QUALIFICATION_RESULT_PREPARATION_REQUIRED','No immutable current effective-result input receipt is available');
 const result=await inspectSubmittedResult(tx,scope,{custody_id:row.custody_id});
 if(result.binding_digest!==receipt.result_binding_digest||receipt.repository_id!==result.repository_id||row.baseline_packet_digest!==result.input_packet_digest||result.authority==='REVOKED'||
  result.source_object_id!==receipt.source_object_id||result.source_tree_id!==receipt.source_tree_id||
  result.source_manifest_digest!==receipt.source_manifest_digest)
  fail('QUALIFICATION_RESULT_INPUTS_STALE','Prepared input receipt no longer binds the admitted immutable result');
 const accepted=await loadPreparationIntent(tx,{organisation_id,run_id,task_id:result.task_id});
 if(receipt.criteria_digest!==accepted.criteria_digest||receipt.registry_digest!==accepted.registry_digest||
  receipt.spec_revision_id!==accepted.spec_revision_id||String(receipt.spec_generation)!==String(accepted.spec_generation))
  fail('QUALIFICATION_RESULT_INPUTS_STALE','Prepared result criteria or accepted registry changed');
 const actualAccepted=accepted as Data;
 if(!object(actualAccepted.execution_profile)||typeof actualAccepted.policy_digest!=='string')
  fail('QUALIFICATION_PREPARATION_CONTEXT_REQUIRED','Actual accepted runtime policy roles are required');
 const roleContext={execution_profile:actualAccepted.execution_profile,resource_requirements:accepted.resource_requirements,policy_digest:digest(actualAccepted.policy_digest)};
 if(canonical(receipt.role_context)!==canonical(roleContext))
  fail('QUALIFICATION_RESULT_INPUTS_STALE','Effective roles differ from the actual accepted runtime, resources or run policy');
 const sourceDigest=hash({repository_id:result.repository_id,source_object_id:result.source_object_id,source_tree_id:result.source_tree_id,
  baseline_source_object_id:result.baseline_source_object_id,source_parent_ids:result.source_parent_ids,source_manifest_digest:result.source_manifest_digest});
 if(row.input_manifest.source!==sourceDigest)
  fail('QUALIFICATION_RESULT_INPUTS_STALE','Prepared input source role differs from the actual admitted result provenance');
 const roles=derivePreparedEnvironmentRoles(row.preparation_manifest,roleContext);
 if(roles.preparation_digest!==receipt.preparation_digest||roles.profile_digest!==receipt.profile_digest||
  roles.toolchain_digest!==row.input_manifest.toolchain||roles.configuration_digest!==row.input_manifest.configuration)
  fail('QUALIFICATION_RESULT_INPUTS_STALE','Actual retained prepared profile differs from the immutable effective role set');
 for(const role of ['source','dependency','toolchain','configuration','graph','contract'])digest(row.input_manifest[role]);
 for(const key of ['input_manifest_digest','source_state_digest','workspace_digest','environment_digest'])digest(receipt[key]);
 if(hash(row.input_manifest)!==receipt.input_manifest_digest||!Array.isArray(receipt.retained_artifacts)||!receipt.retained_artifacts.length)
  fail('QUALIFICATION_RESULT_INPUTS_STALE','Complete prepared artifact inventory and exact semantic role digest are required');
 const seen=new Set<string>();
 for(const reference of receipt.retained_artifacts){
  if(!object(reference)||seen.has(uuid(reference.artifact_id)))fail('QUALIFICATION_RESULT_INPUTS_STALE','Retained preparation reference is missing or duplicated');
  const artifactId=uuid(reference.artifact_id);seen.add(artifactId);
  const artifact=(await tx.query('SELECT digest,size_bytes::text,status FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
   [organisation_id,run_id,artifactId])).rows[0];
  if(!artifact||artifact.status!=='COMPLETE'||artifact.digest!==reference.artifact_digest||artifact.size_bytes!==reference.artifact_size_bytes)
   fail('QUALIFICATION_RESULT_INPUTS_STALE','Retained physical preparation artifact is no longer COMPLETE');
 }
 return {...receipt,authority:'EXPECTED_AUTHORITY',namespace:'QUALIFICATION',
  baseline_packet_digest:row.baseline_packet_digest,input_packet_digest:row.baseline_packet_digest,
  effective_result_input_receipt_digest:row.receipt_digest,receipt_digest:row.receipt_digest,
  object_bytes_reverified:false};
}

/** This factory-only adapter owns the QUALIFICATION namespace. The assignment and
 * execution lease remain primary authority; a prepared-input receipt grants none. */
export function registerQualificationInputReader(ctx:ComponentContext):()=>void {
 const environment=(ctx.dependencies as Data).require('12.1','qualification.environment.v1',(value:unknown):boolean=>
  object(value)&&typeof value.registerInputReader==='function'&&typeof value.registerPreparationAdmissionReader==='function') as Data;
 const resources=(ctx.dependencies as Data).require('5.1','scheduler.allocations.v1',(value:unknown):boolean=>
  object(value)&&typeof value.readJobAllocation==='function'&&typeof value.assertJobReservation==='function') as Data;
 const unregisterInputs=environment.registerInputReader('QUALIFICATION',async(tx:PrimaryTransaction,i:InvocationContext,request:RunnerEnvironmentRequest):Promise<RunnerExpectedInputs>=>{
  assertInvocation(i);
  const principal=i.principal,scope={organisation_id:principal.organisation_id,run_id:principal.run_id};
  await assuranceBarrier(tx,scope,'SHARED');await i.guard(tx);
  if(principal.role!=='VERIFIER'||principal.attempt_id!==null)
   fail('QUALIFICATION_ROLE_DENIED','Qualification expected inputs require an independent run-scoped verifier');
  const jobs=await tx.query("SELECT j.*,j.lease_expires_at>clock_timestamp() AS lease_current,"
   +"a.verifier_id,a.sandbox_id,a.slot_id,a.sandbox_boot_generation::text,a.reservation_id,a.environment_digest,"
   +"a.allocation_id,a.allocation_generation::text FROM hyperfide.qualification_jobs j "
   +"JOIN hyperfide.assurance_job_assignments a ON a.organisation_id=j.organisation_id AND a.run_id=j.run_id AND a.job_id=j.id "
   +"WHERE j.organisation_id=$1 AND j.run_id=$2 AND j.id=$3 ORDER BY a.assignment_generation DESC LIMIT 1 FOR SHARE OF j,a",
   [scope.organisation_id,scope.run_id,uuid(request.job_id)]);
  const job=jobs.rows[0];
  if(!job||!['PENDING','RUNNING'].includes(job.state)||job.verifier_id!==principal.actor_id||
   job.sandbox_id!==principal.sandbox_id||String(job.sandbox_boot_generation)!==String(principal.boot_generation)||
   job.reservation_id!==request.reservation_id||job.environment_digest!==request.environment_digest||
   request.lease_generation!==undefined&&request.lease_generation!==String(job.lease_generation)||
   job.state==='RUNNING'&&(!job.lease_current||job.lease_owner!==principal.actor_id))
   fail('QUALIFICATION_STALE_JOB','Exact current assigned verifier job, generation, boot and resource reservation are required');
  await resources.assertJobReservation(tx,{...scope,task_id:job.task_id??(await tx.query(
   'SELECT task_id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
   [scope.organisation_id,scope.run_id,job.custody_id])).rows[0]?.task_id,job_kind:'TEST',reservation_id:job.reservation_id});
  const allocation=await resources.readJobAllocation(tx,{...scope,reservation_id:job.reservation_id});
  if(!allocation||allocation.allocation_id!==job.allocation_id||String(allocation.generation)!==String(job.allocation_generation)||
   allocation.assignee_session_id!==principal.actor_id||allocation.slot_id!==job.slot_id||allocation.sandbox_id!==job.sandbox_id||
   String(allocation.sandbox_boot_generation)!==String(job.sandbox_boot_generation))
   fail('QUALIFICATION_STALE_JOB','Independent verifier allocation was revoked, expired or reassigned');
  const prepared=await inspectEffectiveResultInputs(tx,scope,{job_id:job.id});
  if(prepared.runner_session_id!==principal.actor_id||prepared.environment_digest!==job.environment_digest||
   request.input_manifest_digest!==undefined&&request.input_manifest_digest!==prepared.input_manifest_digest)
   fail('QUALIFICATION_RESULT_INPUTS_STALE','Current TEST runner must own the actual retained prepared workspace; preparation-seat readiness cannot be transferred by labels');
  return {...prepared,authority:'EXPECTED_AUTHORITY',namespace:'QUALIFICATION',...scope,job_id:uuid(job.id),
   lease_generation:String(job.lease_generation),reservation_id:uuid(job.reservation_id),runner_session_id:principal.actor_id,
   input_manifest_digest:digest(prepared.input_manifest_digest),input_packet_digest:digest(prepared.input_packet_digest),
   input_manifest:prepared.input_manifest,profile_id:uuid(prepared.profile_id),profile_digest:digest(prepared.profile_digest),
   preparation_digest:digest(prepared.preparation_digest),repository_id:uuid(prepared.repository_id),
   source_manifest_digest:digest(prepared.source_manifest_digest),source_object_id:prepared.source_object_id,source_tree_id:prepared.source_tree_id,
   source_state_digest:digest(prepared.source_state_digest),workspace_digest:digest(prepared.workspace_digest),
   environment_digest:digest(prepared.environment_digest),receipt_digest:digest(prepared.receipt_digest),
   baseline_packet_digest:digest(prepared.baseline_packet_digest),effective_result_input_receipt_digest:digest(prepared.receipt_digest),
   custody_id:uuid(prepared.custody_id),custody_generation:String(prepared.custody_generation)};
 });
 const unregisterPreparation=environment.registerPreparationAdmissionReader('QUALIFICATION',
  async(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerPreparationPlan):Promise<RunnerPreparationAdmission|null>=>{
   assertInvocation(i);
   const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
   await assuranceBarrier(tx,scope,'SHARED');await i.guard(tx);
   if(!['OPERATOR','COORDINATOR','VERIFIER'].includes(i.principal.role))
    fail('QUALIFICATION_ROLE_DENIED','Result preparation admission requires its actual coordinator');
   const row=(await tx.query("SELECT p.*,j.state AS job_state,j.lease_generation::text AS current_generation "
    +"FROM hyperfide.assurance_preparation_intents p JOIN hyperfide.qualification_jobs j ON j.organisation_id=p.organisation_id AND j.run_id=p.run_id AND j.id=p.job_id "
    +"WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.operation_id=$3 FOR SHARE OF p,j",
    [scope.organisation_id,scope.run_id,uuid(plan.operation_id)])).rows[0];
   if(!row)return null;
   if(i.principal.role==='VERIFIER'&&i.principal.actor_id!==row.session_id)fail('QUALIFICATION_ROLE_DENIED','Only the intended independent verifier may prepare this result');
   const supplied={...plan,staging:plan.staging.filter(reference=>reference.role!=='readiness-context')};
   if(row.job_state!=='PENDING'||String(row.job_lease_generation)!==row.current_generation||
    row.plan.job_binding.namespace!=='QUALIFICATION'||canonical(row.plan)!==canonical(supplied))
    fail('QUALIFICATION_PREPARATION_CONTEXT_INVALID','Preparation plan differs from the exact current immutable pending job intent');
   const context=await loadResultPreparationContext(tx,scope,{job_id:row.job_id});
   if(context.context_digest!==row.context_digest)
    fail('QUALIFICATION_PREPARATION_CONTEXT_INVALID','Accepted preparation context changed before native admission');
   await resources.assertJobReservation(tx,{...scope,task_id:context.result.task_id,job_kind:'PREPARATION',reservation_id:row.reservation_id});
   const allocation=await resources.readJobAllocation(tx,{...scope,reservation_id:row.reservation_id});
   if(!allocation||allocation.allocation_id!==row.allocation_id||String(allocation.generation)!==String(row.allocation_generation))
    fail('QUALIFICATION_PREPARATION_CAPACITY_REQUIRED','Distinct preparation allocation expired or changed');
   return {authority:'EXPECTED_JOB_AUTHORITY',job_binding:plan.job_binding,source:plan.source,
    repository_id:plan.repository_id,job_kind:'PREPARATION'};
  });
 return ()=>{unregisterPreparation();unregisterInputs();};

}

/** Only a strict policy whose bytes match the accepted recipe FilePin can supply
 * commands and preparation limits. Unsupported script recipes remain explicit. */
export async function buildResultPreparationControl(context:ResultPreparationContext,
 recipe_bytes:Uint8Array,derived_profile_id:string):Promise<{body:Data;bytes:Buffer;raw_control_digest:string;semantic_input_manifest_digest:string}> {
 const {context_digest,...body}=context;
 if(hash(body)!==context_digest)fail('QUALIFICATION_PREPARATION_CONTEXT_INVALID','Primary preparation context identity changed');
 const helper=await import('../preparation/effective.js') as unknown as Data;
 if(typeof helper.readPreparationRecipePolicy!=='function')
  fail('QUALIFICATION_PREPARATION_POLICY_UNAVAILABLE','Actual versioned accepted preparation-policy parser is required');
 const policy=helper.readPreparationRecipePolicy(context.parent_preparation_manifest,recipe_bytes);
 const control={schema_version:1,purpose:'RESULT',parent_profile_id:context.parent_profile_id,
  parent_profile_digest:context.parent_profile_digest,result:effectiveResultProjection(context.result),
  baseline_source_object_id:context.result.baseline_source_object_id,
  counterfactual_checks:context.accepted_context.registered_checks.filter((check:Data)=>context.accepted_context.counterfactual_check_ids.includes(check.id)),
  repository_binding:context.repository_binding,derived_profile_id:uuid(derived_profile_id),
  commands:policy.commands,cache_scope:policy.cache_scope,cache_paths:policy.cache_paths,
  minimum_free_bytes:policy.minimum_free_bytes,minimum_free_inodes:policy.minimum_free_inodes,
  network_timeout_milliseconds:policy.network_timeout_milliseconds};
 const bytes=Buffer.from(canonical(control)+'\n');
 if(bytes.length>256*1024)fail('QUALIFICATION_PREPARATION_POLICY_UNAVAILABLE','Preparation control body exceeds its actual retained object bound');
 return {body:control,bytes,raw_control_digest:rawDigest(bytes),semantic_input_manifest_digest:context_digest};
}
/** Publish declared control metadata through actual15 before constructing a
 * preparation intent. Physical parent bytes and readiness still require native
 * validation; object receipts alone never grant either. No payload enters PG. */
export async function retainResultPreparationControls(ctx:ComponentContext,context:ResultPreparationContext,
 recipe_bytes:Uint8Array,derived_profile_id:string):Promise<Data> {
 const control=await buildResultPreparationControl(context,recipe_bytes,derived_profile_id);
 const scope:[string,string]=[context.organisation_id,context.run_id];
 const reference=(role:string,value:Data)=>({
  role,artifact_id:value.artifact_id,storage_kind:value.storage_kind==='OBJECT'?'object':'manifest',
  digest:value.storage_kind==='OBJECT'?value.digest:value.content_digest,
  ...(value.storage_kind==='OBJECT'?{}:{manifest_digest:value.digest}),size_bytes:value.size_bytes,
 });
 const parent=await retainArtifactBytes(ctx,scope,Buffer.from(canonical(context.parent_preparation_manifest)+'\n'));
 const stored=await retainArtifactBytes(ctx,scope,control.bytes);
 return {input_manifest_artifact_id:stored.artifact_id,input_manifest_digest:control.raw_control_digest,
  semantic_input_manifest_digest:control.semantic_input_manifest_digest,
  staging:[reference('parent-manifest',parent)],
  derived_profile_id,authority:'NONE',physical_readiness:'NOT_EVALUATED'};
}

function resultProfileId(scope:[string,string],job_id:string,request_id:string):string {
 const characters=hash({kind:'RESULT_PROFILE',scope,job_id,request_id}).slice(7,39).split('');
 characters[12]='8';characters[16]=((parseInt(characters[16]!,16)&3)|8).toString(16);
 const value=characters.join('');return [value.slice(0,8),value.slice(8,12),value.slice(12,16),value.slice(16,20),value.slice(20)].join('-');
}
function recordedPlan(row:Data,replayed:boolean):Data {
 return {operation_id:row.operation_id,job_id:row.job_id,derived_profile_id:row.derived_profile_id,
  plan_digest:hash(row.plan),semantic_input_manifest_digest:row.context_digest,
  raw_control_digest:row.plan.input_manifest_digest,state:'RECORDED',replayed,
  authority:'NONE',physical_preparation:'NOT_EVALUATED'};
}
export async function planResultPreparation(ctx:ComponentContext,raw:unknown):Promise<Data> {
 roles(ctx,['OPERATOR','COORDINATOR']);
 const v=fields(raw,['organisation_id','run_id','job_id','request_id','session_id','reservation_id',
  'recipe_policy_artifact_id','source_bundles','timeout_ms']),s=invocationScope(ctx,v);
 for(const key of ['job_id','request_id','session_id','reservation_id','recipe_policy_artifact_id'])uuid(v[key]);
 if(v.request_id!==invocation(ctx).operation.idempotency_key)
  fail('QUALIFICATION_IDEMPOTENCY_CONFLICT','Preparation request differs from its authenticated idempotency identity');
 if(!Number.isSafeInteger(v.timeout_ms)||v.timeout_ms<1000||v.timeout_ms>259200000||
  !Array.isArray(v.source_bundles)||!v.source_bundles.length||v.source_bundles.length>64)
  fail('QUALIFICATION_INPUT_INVALID','A bounded preparation deadline and explicit source-bundle inventory are required');
 const requestDigest=hash(v);
 const existing=await transaction(ctx,tx=>tx.query('SELECT * FROM hyperfide.assurance_preparation_intents WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',
  [...s,v.request_id]),false,'READ');
 if(existing.rows[0]){
  if(existing.rows[0].request_digest!==requestDigest)fail('QUALIFICATION_IDEMPOTENCY_CONFLICT','Preparation request already binds another immutable plan');
  return recordedPlan(existing.rows[0],true);
 }
 const context=await transaction(ctx,async tx=>{
  assertPrimaryTransaction(tx);await executionGate(ctx,tx,s,'ADMISSION');
  return loadResultPreparationContext(tx,{organisation_id:s[0],run_id:s[1]},{job_id:v.job_id});
 });
 if(context.job_state!=='PENDING')fail('QUALIFICATION_CONFLICT','Only a pending verification job may start result preparation');
 if(v.timeout_ms>context.parent_preparation_manifest.profile.policy.max_process_lifetime_seconds*1000)
  fail('QUALIFICATION_BUDGET_EXCEEDED','Preparation exceeds the accepted environment process lifetime');
 const recipe=await artifact(ctx,'artifact.object.read',{organisation_id:s[0],run_id:s[1],artifact_id:v.recipe_policy_artifact_id});
 if(typeof recipe.data_base64!=='string')fail('QUALIFICATION_PREPARATION_POLICY_UNAVAILABLE','Complete retained accepted recipe-policy bytes are required');
 const derivedId=resultProfileId(s,v.job_id,v.request_id);
 const controls=await retainResultPreparationControls(ctx,context,Buffer.from(recipe.data_base64,'base64'),derivedId);
 const expectedKeys=context.parent_preparation_manifest.profile.repositories.map(repository=>repository.id).sort();
 const seen=new Set<string>(),sources:Data[]=[];
 for(const rawBundle of v.source_bundles){
  const bundle=fields(rawBundle,['repository_key','artifact_id','storage_kind']);
  if(typeof bundle.repository_key!=='string'||!expectedKeys.includes(bundle.repository_key)||seen.has(bundle.repository_key)||
   !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bundle.repository_key)||!['object','manifest'].includes(bundle.storage_kind))
   fail('QUALIFICATION_SOURCE_UNAVAILABLE','Source bundles must uniquely cover the exact accepted repository logical keys');
  seen.add(bundle.repository_key);uuid(bundle.artifact_id);
  const checked=await artifact(ctx,bundle.storage_kind==='object'?'artifact.object.inspect':'artifact.manifest.read',
   {organisation_id:s[0],run_id:s[1],artifact_id:bundle.artifact_id});
  if(bundle.storage_kind==='manifest'&&(!checked.manifest||!/^sha256:[0-9a-f]{64}$/.test(checked.manifest.content_digest??'')))
   fail('QUALIFICATION_SOURCE_UNAVAILABLE','Source-bundle manifest is not a complete verified byte stream');
  sources.push({role:'source:'+bundle.repository_key,artifact_id:bundle.artifact_id,storage_kind:bundle.storage_kind,
   digest:bundle.storage_kind==='object'?checked.artifact.digest:checked.manifest.content_digest,
   ...(bundle.storage_kind==='object'?{}:{manifest_digest:checked.artifact.digest}),
   size_bytes:bundle.storage_kind==='object'?String(checked.artifact.size_bytes):String(checked.manifest.total_size_bytes)});
 }
 if(seen.size!==expectedKeys.length)fail('QUALIFICATION_SOURCE_UNAVAILABLE','Every accepted repository needs its actual retained Git bundle');
 return transaction(ctx,async tx=>{
  assertPrimaryTransaction(tx);
  await executionGate(ctx,tx,s,'ADMISSION');
  const current=await loadResultPreparationContext(tx,{organisation_id:s[0],run_id:s[1]},{job_id:v.job_id});
  if(current.context_digest!==context.context_digest)fail('QUALIFICATION_PREPARATION_CONTEXT_INVALID','Accepted preparation context changed during immutable object retention');
  const prior=(await tx.query('SELECT * FROM hyperfide.assurance_preparation_intents WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',
   [...s,v.request_id])).rows[0];
  if(prior){
   if(prior.request_digest!==requestDigest)fail('QUALIFICATION_IDEMPOTENCY_CONFLICT','Concurrent preparation request differs');
   return recordedPlan(prior,true);
  }
  const resources=(ctx.dependencies as Data).require('5.1','scheduler.allocations.v1',(value:unknown):boolean=>
   object(value)&&typeof value.assertJobReservation==='function'&&typeof value.readJobAllocation==='function') as Data;
  await resources.assertJobReservation(tx,{organisation_id:s[0],run_id:s[1],task_id:context.result.task_id,job_kind:'PREPARATION',reservation_id:v.reservation_id});
  const allocation=await resources.readJobAllocation(tx,{organisation_id:s[0],run_id:s[1],reservation_id:v.reservation_id});
  if(!allocation||allocation.job_kind!=='PREPARATION'||allocation.task_id!==context.result.task_id)
   fail('QUALIFICATION_PREPARATION_CAPACITY_REQUIRED','Current distinct preparation allocation is required');
  const target=(await tx.query("SELECT a.id,a.sandbox_id FROM hyperfide.agent_sessions a JOIN hyperfide.sandboxes b ON b.organisation_id=a.organisation_id AND b.id=a.sandbox_id AND b.boot_generation=a.sandbox_boot_generation WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 AND a.role='VERIFIER' AND a.state IN ('REGISTERED','RUNNING') FOR SHARE OF a,b",
   [...s,v.session_id])).rows[0];
  const coding=(await tx.query('SELECT sandbox_id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
   [...s,context.result.source_attempt_id])).rows[0];
  if(!target||target.sandbox_id===coding?.sandbox_id)fail('QUALIFICATION_NOT_INDEPENDENT','Result preparation must target an actual independent verifier sandbox');
  const job=(await tx.query('SELECT lease_generation::text FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
   [...s,v.job_id])).rows[0];
  if(!job)fail('QUALIFICATION_NOT_FOUND','Preparation job disappeared');
  // Preparation binds the current job snapshot, including generation 0 before
  // its first verifier claim. Readiness must precede that execution lease.
  const plan={target_binding_id:allocation.allocation_id,operation_id:v.request_id,session_id:v.session_id,reservation_id:v.reservation_id,repository_id:context.result.repository_id,
   timeout_ms:v.timeout_ms,recipe_id:'environment.prepare.v1',
   input_manifest_artifact_id:controls.input_manifest_artifact_id,input_manifest_digest:controls.input_manifest_digest,
   job_binding:{namespace:'QUALIFICATION',job_id:v.job_id,lease_generation:String(job.lease_generation),reservation_id:v.reservation_id,
    input_packet_digest:context.baseline_packet_digest,input_manifest_digest:context.context_digest},
   source:{repository_key:context.repository_binding.repository_key,source_object_id:context.result.source_object_id,
    source_tree_id:context.result.source_tree_id,source_manifest_digest:context.result.source_manifest_digest},
   staging:[...controls.staging,...sources]};
  // Readiness/scanner context is injected by the protected12 recipe map. There
  // is no wire field through which this caller can choose that authority.
  const inserted=await tx.query("INSERT INTO hyperfide.assurance_preparation_intents(organisation_id,run_id,operation_id,job_id,job_lease_generation,custody_id,custody_generation,request_digest,context_digest,session_id,reservation_id,allocation_id,allocation_generation,derived_profile_id,plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
   [...s,v.request_id,v.job_id,String(job.lease_generation),context.custody_id,context.result.custody_generation,
    requestDigest,context.context_digest,v.session_id,v.reservation_id,uuid(allocation.allocation_id),String(allocation.generation),derivedId,plan]);
  return recordedPlan(inserted.rows[0]!,false);
 });
}
export async function inspectResultPreparation(ctx:ComponentContext,raw:unknown):Promise<Data> {
 const actor=roles(ctx,['OPERATOR','COORDINATOR','VERIFIER']);
 const v=fields(raw,['organisation_id','run_id','operation_id']),s=invocationScope(ctx,v);
 const row=await transaction(ctx,tx=>tx.query('SELECT * FROM hyperfide.assurance_preparation_intents WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',
  [...s,uuid(v.operation_id)]),false,'READ');
 if(!row.rows[0])fail('QUALIFICATION_NOT_FOUND','Preparation intent not found');
 if(actor.principal.role==='VERIFIER'&&row.rows[0].session_id!==actor.principal.actor_id)
  fail('QUALIFICATION_STALE_JOB','Preparation intent belongs to another verifier');
 return recordedPlan(row.rows[0],true);
}

/** Primary semantic authority for a retained-preparation publisher. This is the
 * initial intent, not a completed physical input receipt or readiness grant. */
export async function inspectResultPreparationIntent(tx:PrimaryClient,
 scope:{organisation_id:string;run_id:string},query:{operation_id:string}):Promise<Data> {
 assertPrimaryTransaction(tx);await assuranceBarrier(tx,scope,'SHARED');
 const row=(await tx.query("SELECT p.*,j.state AS job_state,j.lease_generation::text AS current_generation "
  +"FROM hyperfide.assurance_preparation_intents p JOIN hyperfide.qualification_jobs j ON j.organisation_id=p.organisation_id AND j.run_id=p.run_id AND j.id=p.job_id "
  +"WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.operation_id=$3 FOR SHARE OF p,j",
  [uuid(scope.organisation_id),uuid(scope.run_id),uuid(query.operation_id)])).rows[0];
 if(!row||row.job_state!=='PENDING'||String(row.job_lease_generation)!==row.current_generation)
  fail('QUALIFICATION_PREPARATION_CONTEXT_INVALID','Current immutable pending preparation intent is required');
 const context=await loadResultPreparationContext(tx,scope,{job_id:row.job_id});
 if(context.context_digest!==row.context_digest||row.plan.job_binding?.namespace!=='QUALIFICATION'||
  row.plan.job_binding.job_id!==row.job_id||String(row.plan.job_binding.lease_generation)!==row.current_generation||
  row.plan.job_binding.reservation_id!==row.reservation_id||row.plan.job_binding.input_packet_digest!==context.baseline_packet_digest||
  row.plan.job_binding.input_manifest_digest!==context.context_digest||row.plan.operation_id!==row.operation_id||
  row.plan.repository_id!==context.result.repository_id||row.plan.session_id!==row.session_id||
  row.plan.source.source_object_id!==context.result.source_object_id||row.plan.source.source_tree_id!==context.result.source_tree_id||
  row.plan.source.source_manifest_digest!==context.result.source_manifest_digest)
  fail('QUALIFICATION_PREPARATION_CONTEXT_INVALID','Immutable intent no longer matches actual admitted source and accepted context');
 return {authority:'EXPECTED_JOB_AUTHORITY',namespace:'QUALIFICATION',organisation_id:scope.organisation_id,run_id:scope.run_id,
  operation_id:row.operation_id,job_id:row.job_id,lease_generation:row.current_generation,
  custody_id:row.custody_id,custody_generation:String(row.custody_generation),session_id:row.session_id,
  reservation_id:row.reservation_id,allocation_id:row.allocation_id,allocation_generation:String(row.allocation_generation),
  derived_profile_id:row.derived_profile_id,job_binding:row.plan.job_binding,source:row.plan.source,repository_id:row.plan.repository_id,
  input_packet_digest:context.baseline_packet_digest,input_manifest_digest:context.context_digest,
  context_digest:context.context_digest,context,plan:row.plan,plan_digest:hash(row.plan),physical_readiness:'NOT_EVALUATED'};
}

/** Initial semantic reader for the lower12 retained-preparation publisher.
 * Values remain accepted baseline pins. Actual derived profile and prepared
 * roles are admitted only after independently retained native measurements. */
export function qualificationPreparationAuthorityReader(ctx:ComponentContext) {
 const resources=(ctx.dependencies as Data).require('5.1','scheduler.allocations.v1',(value:unknown):boolean=>
  object(value)&&typeof value.readJobAllocation==='function'&&typeof value.assertJobReservation==='function') as Data;
 return async(tx:PrimaryTransaction,i:InvocationContext,request:RunnerEnvironmentRequest&{operation_id?:string}):Promise<Data|null>=>{
  assertInvocation(i);
  const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
  await assuranceBarrier(tx,scope,'SHARED');await i.guard(tx);
  if(!request.operation_id)return null;
  const intent=await inspectResultPreparationIntent(tx,scope,{operation_id:request.operation_id});
  if(!['OPERATOR','COORDINATOR','VERIFIER'].includes(i.principal.role)||
   i.principal.role==='VERIFIER'&&i.principal.actor_id!==intent.session_id)
   fail('QUALIFICATION_ROLE_DENIED','Initial preparation inputs require their coordinator or exact assigned verifier');
  const context=intent.context as ResultPreparationContext;
  if(request.job_id!==intent.job_id||request.reservation_id!==intent.reservation_id||
   request.lease_generation!==undefined&&request.lease_generation!==intent.lease_generation||
   request.input_manifest_digest!==undefined&&request.input_manifest_digest!==intent.input_manifest_digest||
   request.environment_digest!==context.context_digest)
   fail('QUALIFICATION_PREPARATION_CONTEXT_INVALID','Initial retained preparation request differs from the immutable semantic job tuple');
  await resources.assertJobReservation(tx,{...scope,task_id:context.result.task_id,job_kind:'PREPARATION',reservation_id:intent.reservation_id});
  const allocation=await resources.readJobAllocation(tx,{...scope,reservation_id:intent.reservation_id});
  if(!allocation||allocation.allocation_id!==intent.allocation_id||String(allocation.generation)!==intent.allocation_generation)
   fail('QUALIFICATION_PREPARATION_CAPACITY_REQUIRED','Current distinct preparation allocation required');
  const target=(await tx.query("SELECT a.sandbox_id,a.sandbox_boot_generation::text,a.slot_id,b.boot_generation::text AS current_boot "
   +"FROM hyperfide.agent_sessions a JOIN hyperfide.sandboxes b ON b.organisation_id=a.organisation_id AND b.id=a.sandbox_id "
   +"WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 AND a.role='VERIFIER' AND a.state IN ('REGISTERED','RUNNING') FOR SHARE OF a,b",
   [scope.organisation_id,scope.run_id,intent.session_id])).rows[0];
  if(!target||target.sandbox_boot_generation!==target.current_boot)
   fail('QUALIFICATION_PREPARATION_CONTEXT_INVALID','Target verifier session is not on the current observed sandbox boot');
  const baseline:Data={};
  for(const role of ['dependency','toolchain','configuration','graph','contract'])baseline[role]=digest(context.baseline_input_manifest[role]);
  return {authority:'EXPECTED_AUTHORITY',namespace:'QUALIFICATION',...scope,job_id:intent.job_id,
   lease_generation:intent.lease_generation,reservation_id:intent.reservation_id,operation_id:intent.operation_id,
   input_packet_digest:context.baseline_packet_digest,input_manifest_digest:context.context_digest,input_manifest:baseline,
   baseline_packet_digest:context.baseline_packet_digest,baseline_input_manifest:context.baseline_input_manifest,
   profile_id:context.parent_profile_id,profile_digest:context.parent_profile_digest,
   baseline_preparation_digest:context.parent_preparation_digest,environment_digest:context.context_digest,
   repository_id:context.result.repository_id,source_manifest_digest:context.result.source_manifest_digest,
   source_object_id:context.result.source_object_id,source_tree_id:context.result.source_tree_id,
   assigned_sandbox_id:target.sandbox_id,sandbox_id:target.sandbox_id,sandbox_boot_generation:target.sandbox_boot_generation,
   slot_id:target.slot_id,runner_session_id:intent.session_id,custody_id:intent.custody_id,custody_generation:intent.custody_generation,
   prepared_roles_granted:false,physical_readiness:'NOT_EVALUATED'};
 };
}
