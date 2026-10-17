import {FoundationError} from '../policy/programme.js';

// Compatibility recipes for adopting a historical checkpoint into a new attempt.
// Each evidence class has one explicit rule; a recipe either records how the
// target may continue or refuses. No recipe restores, renews or transfers the
// source attempt's compute fence, generation, lease or native session.
export type EvidenceClass='SOURCE'|'SESSION'|'ENVIRONMENT';
export type AdoptionMode='SOURCE_ONLY'|'NATIVE_RESUME';
export interface RecipeOutcome{readonly evidence_class:EvidenceClass;readonly verdict:'COMPATIBLE'|'REBUILD_REQUIRED'|'FRESH_SESSION';readonly rule:string;readonly source:string|null;readonly target:string|null}
export interface CheckpointLineage{
 id:string;artifact_id:string;attempt_id:string;attempt_generation:string;repository_id:string;source_object_id:string;
 input_packet_digest:string;support_level:string;agent_session_id:string|null;digest:string;status:string;
 registration_operation_id:string|null;preparation_digest:string|null;artifact_content_digest:string|null;source_metadata_digest:string|null;
 source_compute_authority:string;source_packet_digest:string;source_task_id:string;source_expired:boolean;
}
export interface TargetIdentity{task_id:string;attempt_id:string;attempt_generation:string}
export interface TargetExecution{input_packet_digest:string;preparation_digest:string}
export interface NativeResumeRequest{session_id:string;native_session_id:string;configuration_digest:string;source_manifest_digest:string}

export const CHECKPOINT_RECIPES:Readonly<Record<EvidenceClass,string>>=Object.freeze({
 SOURCE:'Registered capsule bytes, packet lineage, task and commit must match the exact pinned continuation; the source attempt must be distinct, older and no longer hold live compute.',
 SESSION:'SOURCE_ONLY always starts a fresh native session; NATIVE_RESUME requires the recorded session, metadata digest and execution packet to match exactly and a qualified resume check.',
 ENVIRONMENT:'The target preparation must be the caller-expected one; a differing source preparation forces a rebuild for SOURCE_ONLY and refuses NATIVE_RESUME.'
});
function fail(code:string,message:string):never{throw new FoundationError(code,message);}

/** Registration provenance, byte identity and lineage of the historical source. */
export function sourceRecipe(source:CheckpointLineage,target:TargetIdentity,expectedArtifactDigest:string):RecipeOutcome{
 if(!source.registration_operation_id||!source.preparation_digest||!source.artifact_content_digest||!source.source_metadata_digest)fail('ADOPTION_CHECKPOINT_UNBOUND','Legacy checkpoint lacks verified registration provenance');
 if(source.status!=='COMPLETE'||source.digest!==expectedArtifactDigest)fail('ADOPTION_CHECKPOINT_INVALID','Source checkpoint artifact differs or is incomplete');
 if(source.input_packet_digest!==source.source_packet_digest)fail('ADOPTION_CHECKPOINT_INVALID','Source packet lineage differs');
 if(source.source_task_id!==target.task_id)fail('ADOPTION_SCOPE_DENIED','Source checkpoint belongs to another task');
 if(source.attempt_id===target.attempt_id)fail('ADOPTION_CHECKPOINT_INVALID','Current target cannot adopt itself');
 if(BigInt(source.attempt_generation)>=BigInt(target.attempt_generation))fail('ADOPTION_CHECKPOINT_INVALID','Adoption only moves recoverable history forward to a newer generation');
 if(source.source_compute_authority==='CURRENT'&&!source.source_expired)fail('ADOPTION_SOURCE_ACTIVE','Source still holds current compute authority');
 return Object.freeze({evidence_class:'SOURCE' as const,verdict:'COMPATIBLE' as const,rule:CHECKPOINT_RECIPES.SOURCE,source:source.source_object_id,target:source.source_object_id});
}

/** The committed source must still be the one validated before external reads. */
export function sourceUnchanged(initial:CheckpointLineage,current:CheckpointLineage):void{
 if(current.artifact_id!==initial.artifact_id||current.digest!==initial.digest||current.source_object_id!==initial.source_object_id||current.source_metadata_digest!==initial.source_metadata_digest)fail('ADOPTION_CHECKPOINT_INVALID','Source checkpoint changed');
}

/** Pre-check before asking the session service; a mismatch is refused, never downgraded. */
export function sessionPrecheck(source:CheckpointLineage,mode:AdoptionMode,native:NativeResumeRequest|null,expectedPacketDigest:string):void{
 if(mode!=='NATIVE_RESUME')return;
 if(!native||source.support_level!=='NATIVE_RESUME'||source.agent_session_id===null||source.agent_session_id!==native.session_id)fail('ADOPTION_NATIVE_INCOMPATIBLE','Native checkpoint session differs from the requested session');
 if(native.source_manifest_digest!==source.source_metadata_digest)fail('ADOPTION_NATIVE_INCOMPATIBLE','Native session source manifest differs from the checkpoint');
 if(source.input_packet_digest!==expectedPacketDigest)fail('ADOPTION_NATIVE_INCOMPATIBLE','Native resume requires the exact source execution packet');
}

export function sessionRecipe(source:CheckpointLineage,mode:AdoptionMode,resume:Record<string,unknown>|null):RecipeOutcome{
 if(mode==='SOURCE_ONLY')return Object.freeze({evidence_class:'SESSION' as const,verdict:'FRESH_SESSION' as const,rule:CHECKPOINT_RECIPES.SESSION,source:source.agent_session_id,target:null});
 if(!resume||resume.decision!=='ELIGIBLE_NATIVE_CONTEXT'||resume.context_restored!==false||resume.grants_authority!==false)fail('ADOPTION_NATIVE_INCOMPATIBLE','Native session does not have qualified resume eligibility');
 return Object.freeze({evidence_class:'SESSION' as const,verdict:'COMPATIBLE' as const,rule:CHECKPOINT_RECIPES.SESSION,source:source.agent_session_id,target:source.agent_session_id});
}

export function environmentRecipe(source:CheckpointLineage,mode:AdoptionMode,target:TargetExecution,expected:TargetExecution):RecipeOutcome{
 if(target.input_packet_digest!==expected.input_packet_digest||target.preparation_digest!==expected.preparation_digest)fail('ADOPTION_TARGET_CHANGED','Target execution packet or preparation differs');
 if(source.preparation_digest===target.preparation_digest)return Object.freeze({evidence_class:'ENVIRONMENT' as const,verdict:mode==='SOURCE_ONLY'?'REBUILD_REQUIRED' as const:'COMPATIBLE' as const,rule:CHECKPOINT_RECIPES.ENVIRONMENT,source:source.preparation_digest,target:target.preparation_digest});
 if(mode==='NATIVE_RESUME')fail('ADOPTION_ENVIRONMENT_INCOMPATIBLE','Native resume requires the identical prepared environment');
 return Object.freeze({evidence_class:'ENVIRONMENT' as const,verdict:'REBUILD_REQUIRED' as const,rule:CHECKPOINT_RECIPES.ENVIRONMENT,source:source.preparation_digest,target:target.preparation_digest});
}
