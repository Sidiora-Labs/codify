import {randomUUID,createHash} from 'node:crypto';
import type {ComponentContext} from '../components/registry.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {isProviderReadinessCapability} from '../providers/pools.js';
import {readRunnerPreparationBinding,requireRunnerPreparation} from '../runner/bridge.js';
import {derivePreparedEnvironmentRoles} from '../hierarchy/packets.js';
import {validateManifestMetadata} from '../preparation/manifests.js';
import {inspectResultPreparationIntent,inspectEffectiveResultInputs,rederiveResultProfile} from './preparation.js';
import type {ResultPreparationContext} from './preparation.js';
import {artifact,canonical,fail,fields,hash,invocation,roles,scope,transaction,uuid,retainArtifactBytes,executionGate} from './submission.js';
import type {Data} from './submission.js';

export function resultInputProducer(ctx:ComponentContext){
 const readiness=ctx.dependencies.require('8.2','provider.readiness.v1',isProviderReadinessCapability);
 const proofs=new WeakMap<object,{digest:string;credential:string}>();
 const unregister=readiness.registerPublicationVerifier(async(_tx,i,input,proof)=>{
  const retained=proof&&typeof proof==='object'?proofs.get(proof):undefined;
  if(!retained||retained.credential!==i.principal.credential_id||retained.digest!==hash(input))
   fail('QUALIFICATION_PREPARATION_PROOF_REQUIRED','Only the retained native result producer may publish readiness');
 });
 const unregisterArtifacts=readiness.registerArtifactReferenceReader(async(tx,s,references)=>{
  const rows=[];
  for(const ref of references){
   const row=(await tx.query("SELECT * FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND status='COMPLETE' FOR SHARE",
    [s.organisation_id,s.run_id,ref.artifact_id])).rows[0];
   if(!row||row.digest!==ref.digest||String(row.size_bytes)!==ref.size_bytes)fail('QUALIFICATION_ARTIFACT_INCOMPLETE','Retained preparation reference changed');
   rows.push(row);
  }
  return rows;
 });
 return {close:()=>{unregisterArtifacts();unregister();},execute:async(requestContext:ComponentContext,raw:unknown):Promise<Data>=>{
  const actor=roles(requestContext,['VERIFIER']),v=fields(raw,['organisation_id','run_id','operation_id']),s=scope(requestContext,v);
  const operation=uuid(v.operation_id),remote=requireRunnerPreparation(requestContext);
  const admitted=await transaction(requestContext,async tx=>{
   assertPrimaryTransaction(tx);await executionGate(requestContext,tx,s,'ADMISSION');
   const existing=(await tx.query('SELECT job_id FROM hyperfide.assurance_effective_result_inputs WHERE organisation_id=$1 AND run_id=$2 AND preparation_operation_id=$3',[...s,operation])).rows[0];
   if(existing){
    const replayed=await inspectEffectiveResultInputs(tx,{organisation_id:s[0],run_id:s[1]},{job_id:existing.job_id});
    if(replayed.runner_session_id!==actor.principal.actor_id)fail('QUALIFICATION_NOT_INDEPENDENT','Only the intended independent verifier may replay result preparation');
    return {replayed};
   }
   const intent=await inspectResultPreparationIntent(tx,{organisation_id:s[0],run_id:s[1]},{operation_id:operation});
   if(intent.session_id!==actor.principal.actor_id)fail('QUALIFICATION_NOT_INDEPENDENT','Only the intended independent verifier may execute result preparation');
   const binding=await readRunnerPreparationBinding(tx,{organisation_id:s[0],run_id:s[1],session_id:intent.session_id});
   const permit=await remote.prepare(tx,invocation(requestContext) as any,intent.plan);
   return {intent,binding,permit};
  });
  if(admitted.replayed)return {...admitted.replayed,replayed:true};
  const result=await remote.execute(admitted.permit!,invocation(requestContext).signal);
  if(result.outcome!=='SUCCEEDED'||result.exit_code!==0||result.timed_out||result.interrupted||result.truncated||
   !result.output_complete||result.cleanup_status!=='CONFIRMED'||!result.cleanup.complete||!result.stdout.complete)
   fail('QUALIFICATION_PREPARATION_FAILED','Native preparation exit '+result.exit_code+': '+Buffer.from(result.stderr.bytes).toString('utf8').slice(-2000));
  let output:Data;
  try{output=JSON.parse(Buffer.from(result.stdout.bytes).toString('utf8'));}catch{fail('QUALIFICATION_MEASUREMENT_INTEGRITY','Preparation did not return complete measured JSON');}
  const intent=admitted.intent!,context=intent.context as ResultPreparationContext,binding=admitted.binding!;
  const counterfactual=output.counterfactual,checks=context.accepted_context.registered_checks.filter((check:Data)=>context.accepted_context.counterfactual_check_ids.includes(check.id));
  if(!Array.isArray(counterfactual)||!Array.isArray(checks)||counterfactual.length!==checks.length)
   fail('QUALIFICATION_COUNTERFACTUAL_INCOMPLETE','Every accepted original check needs complete native output');
  const captured=(value:Data)=>{
   if(!value||typeof value.base64!=='string')fail('QUALIFICATION_COUNTERFACTUAL_INCOMPLETE','Captured original bytes required');
   const bytes=Buffer.from(value.base64,'base64');
   if(bytes.toString('base64')!==value.base64||String(bytes.length)!==value.size_bytes||'sha256:'+createHash('sha256').update(bytes).digest('hex')!==value.digest)
    fail('QUALIFICATION_COUNTERFACTUAL_INCOMPLETE','Original captured bytes differ from retained measurement');
  };
  for(const [index,check] of checks.entries()){
   const original=counterfactual[index];
   if(!original||canonical(original.check)!==canonical(check)||canonical(original.argv)!==canonical(check.argv)||
    original.source_object_id!==context.result.baseline_source_object_id||!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(original.source_tree_id)||
    original.parent_profile_digest!==context.parent_profile_digest||!Number.isSafeInteger(original.exit_code)||original.exit_code<0||original.exit_code>255||
    original.signal!==null||original.timed_out!==false||original.output_complete!==true||!Number.isSafeInteger(original.pid)||original.pid<1||
    !Number.isFinite(Date.parse(original.started_at))||!Number.isFinite(Date.parse(original.ended_at))||Date.parse(original.ended_at)<Date.parse(original.started_at)||
    Date.parse(original.started_at)<Date.parse(result.started_at)||Date.parse(original.ended_at)>Date.parse(result.ended_at)||
    !Array.isArray(original.artifacts)||canonical(original.artifacts.map((a:Data)=>a.path))!==canonical(check.required_artifacts))
    fail('QUALIFICATION_COUNTERFACTUAL_INCOMPLETE','Original execution must bind the exact accepted baseline and registered command');
   captured(original.stdout);captured(original.stderr);for(const ref of original.artifacts)captured(ref);
  }
  const measurement=Buffer.from(output.measurement_base64,'base64'),measured=JSON.parse(measurement.toString('utf8'));
  const derived=rederiveResultProfile(context,{...measured,observation_artifact_digest:'sha256:'+createHash('sha256').update(measurement).digest('hex')},intent.derived_profile_id,measurement);
  const manifest=validateManifestMetadata(output.manifest),workspace=validateManifestMetadata(output.workspace_manifest),observed=output.readiness;
  if(canonical(manifest.profile)!==canonical(derived.profile)||canonical(workspace.profile)!==canonical(derived.profile)||
   !observed||observed.state!=='READY'||observed.authority_granted!==false||observed.boot_id!==binding.boot_id||
   observed.preparation_digest!==manifest.digest||observed.profile_digest!==derived.profile_digest||observed.workspace_digest!==workspace.digest||
   observed.source_state_digest!==hash(observed.source_bindings)||output.readiness_input.preparation_digest!==manifest.digest||
   output.readiness_input.profile_digest!==derived.profile_digest)
   fail('QUALIFICATION_MEASUREMENT_INTEGRITY','Native readiness does not bind the rederived profile, complete inventory and physical boot');
  const role_context={execution_profile:context.accepted_context.execution_profile,resource_requirements:context.accepted_context.resource_requirements,policy_digest:context.accepted_context.policy_digest};
  const preparedRoles=derivePreparedEnvironmentRoles(manifest,role_context);
  const input_manifest={...context.baseline_input_manifest,
   source:hash({repository_id:context.result.repository_id,source_object_id:context.result.source_object_id,source_tree_id:context.result.source_tree_id,
    baseline_source_object_id:context.result.baseline_source_object_id,source_parent_ids:context.result.source_parent_ids,source_manifest_digest:context.result.source_manifest_digest}),
   dependency:hash({package_managers:manifest.profile.package_managers,generated_inputs:manifest.profile.generated_inputs,build_config:manifest.profile.build_config}),
   toolchain:preparedRoles.toolchain_digest,configuration:preparedRoles.configuration_digest};
  const keep=async(bytes:Buffer)=>{
   const stored=await retainArtifactBytes(requestContext,s,bytes);
   if(stored.storage_kind!=='OBJECT')fail('QUALIFICATION_ARTIFACT_BUDGET','Preparation metadata exceeds its single-object bound');
   const checked=await artifact(requestContext,'artifact.object.read',{organisation_id:s[0],run_id:s[1],artifact_id:stored.artifact_id});
   if(!Buffer.from(checked.data_base64,'base64').equals(bytes))fail('QUALIFICATION_MEASUREMENT_INTEGRITY','Retained metadata bytes changed');
   return {artifact_id:stored.artifact_id,receipt_id:checked.receipt.receipt_id,digest:stored.digest,size_bytes:stored.size_bytes};
  };
  const storedManifest=await keep(Buffer.from(canonical(manifest)+'\n')),stdout=await keep(Buffer.from(result.stdout.bytes));
  const measuredRef=await keep(measurement),verification=await keep(Buffer.from(canonical({derived,observed,input_manifest})+'\n'));
  const {stdout:_stdout,stderr:_stderr,artifacts:_artifacts,...executionBody}=result;
  const execution=await keep(Buffer.from(canonical(executionBody)));
  const nativeArtifact=await transaction(requestContext,async tx=>{
   const ref=(result as Data).native_receipt;
   const row=(await tx.query("SELECT id,digest,size_bytes::text FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND status='COMPLETE'",
    [...s,ref?.artifact_id])).rows[0];
   if(!row)fail('QUALIFICATION_ARTIFACT_INCOMPLETE','Actual native receipt bytes must remain retained');
   return {artifact_id:row.id,digest:row.digest,size_bytes:row.size_bytes};
  },false,'READ');
  const source=await artifact(requestContext,'artifact.object.read',{organisation_id:s[0],run_id:s[1],artifact_id:context.result.source_manifest_artifact_id});
  const sourceRef={artifact_id:source.artifact.artifact_id,receipt_id:source.receipt.receipt_id,digest:source.artifact.digest,size_bytes:String(source.artifact.size_bytes)};
  const now=await transaction(requestContext,async tx=>(await tx.query('SELECT clock_timestamp() AS now')).rows[0].now,false,'READ');
  const at=new Date(now).toISOString(),until=new Date(new Date(now).getTime()+240000).toISOString();
  const publication={observation:{id:randomUUID(),sandbox_id:binding.sandbox_id,boot_generation:binding.boot_generation,boot_id:binding.boot_id,
   slot_id:binding.slot_id,profile_id:intent.derived_profile_id,boot_preparation_digest:binding.boot_preparation_digest,preparation_digest:manifest.digest,
   source_manifest_digest:context.result.source_manifest_digest,source_repository_id:context.result.repository_id,source_repository_key:context.repository_binding.repository_key,
   source_object_id:context.result.source_object_id,source_tree_id:context.result.source_tree_id,source_bindings:observed.source_bindings,workspace_digest:workspace.digest,
   native_operation_id:operation,input_digest:hash(output.readiness_input),command_digest:hash(result.argv),readiness_input:output.readiness_input,
   execution_receipt_digest:execution.digest,verification_receipt_digest:verification.digest,state:'READY' as const,failure_code:null,observed_at:at,expires_at:until},
   manifest:manifest as unknown as Data,lineage_id:randomUUID(),artifacts:{stdout,manifest:storedManifest,source_manifest:sourceRef,execution_receipt:execution,verification_receipt:verification}};
  const proof={};proofs.set(proof,{credential:actor.principal.credential_id,digest:hash(publication)});
  const receipt={schema_version:1,kind:'EFFECTIVE_RESULT_INPUTS',organisation_id:s[0],run_id:s[1],job_id:intent.job_id,
   custody_id:context.custody_id,custody_generation:context.result.custody_generation,result_binding_digest:context.result.binding_digest,
   repository_id:context.result.repository_id,source_object_id:context.result.source_object_id,source_tree_id:context.result.source_tree_id,source_manifest_digest:context.result.source_manifest_digest,
   profile_id:intent.derived_profile_id,profile_digest:derived.profile_digest,preparation_digest:manifest.digest,preparation_context_digest:context.context_digest,
   preparation_operation_id:operation,baseline_packet_digest:context.baseline_packet_digest,accepted_context_digest:hash(context.accepted_context),
   counterfactual,input_manifest,input_manifest_digest:hash(input_manifest),role_context,criteria_digest:context.accepted_context.criteria_digest,
   registry_digest:context.accepted_context.registry_digest,spec_revision_id:context.accepted_context.spec_revision_id,spec_generation:context.accepted_context.spec_generation,
   runner_session_id:intent.session_id,source_state_digest:observed.source_state_digest,workspace_digest:workspace.digest,
   environment_digest:hash({operation_id:operation,profile_digest:derived.profile_digest,workspace_digest:workspace.digest,source_state_digest:observed.source_state_digest}),
   retained_artifacts:[storedManifest,stdout,measuredRef,verification,execution,sourceRef,nativeArtifact].map(ref=>({artifact_id:ref.artifact_id,artifact_digest:ref.digest,artifact_size_bytes:ref.size_bytes}))};
  const receiptDigest=hash(receipt),receiptRef=await keep(Buffer.from(canonical(receipt)));
  try{return await transaction(requestContext,async tx=>{
   assertPrimaryTransaction(tx);await executionGate(requestContext,tx,s,'ADMISSION');
   const current=await inspectResultPreparationIntent(tx,{organisation_id:s[0],run_id:s[1]},{operation_id:operation});
   if(current.context_digest!==context.context_digest)fail('QUALIFICATION_RESULT_INPUTS_STALE','Preparation context changed during execution');
   const published=await readiness.publishVerifiedRuntimeReadiness(tx,invocation(requestContext) as any,publication,proof);
   await tx.query("UPDATE hyperfide.runner_registry SET state='CURRENT',preparation_digest=$4,readiness_digest=$5,source_digest=$6,source_object_id=$7,source_tree_id=$8,observed_at=clock_timestamp(),registration_version=registration_version+1 WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3 AND credential_id=$9 AND sandbox_id=$10 AND boot_generation=$11",
    [...s,intent.session_id,manifest.digest,published.readiness_digest,context.result.source_manifest_digest,context.result.source_object_id,context.result.source_tree_id,binding.credential_id,binding.sandbox_id,binding.boot_generation]);
   await tx.query('INSERT INTO hyperfide.assurance_effective_result_inputs(organisation_id,run_id,job_id,preparation_operation_id,custody_id,custody_generation,profile_id,baseline_packet_digest,accepted_context_digest,input_manifest,receipt_digest,receipt_artifact_id,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [...s,intent.job_id,operation,context.custody_id,context.result.custody_generation,intent.derived_profile_id,context.baseline_packet_digest,hash(context.accepted_context),input_manifest,receiptDigest,receiptRef.artifact_id,receipt]);
   const applicability=await tx.query('UPDATE hyperfide.assurance_applicability SET input_manifest=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3 AND applicability=\'MISSING\' AND current_receipt_digest IS NULL AND input_manifest=$5::jsonb',
    [...s,context.custody_id,input_manifest,context.baseline_input_manifest]);
   if(applicability.rowCount!==1)fail('QUALIFICATION_RESULT_INPUTS_STALE','Unqualified submission inputs changed during preparation');
   const resources=requestContext.dependencies.require('5.1','scheduler.allocations.v1',(value:any):value is Data=>typeof value?.finishPreparationAllocation==='function');
   await resources.finishPreparationAllocation(tx,{organisation_id:s[0],run_id:s[1],operation_id:operation});
   return {...receipt,receipt_digest:receiptDigest,readiness_digest:published.readiness_digest,readiness_environment:output.readiness_environment,replayed:false};
  });}finally{proofs.delete(proof);}
 }};
}
