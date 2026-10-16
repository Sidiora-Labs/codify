import {createHash} from 'node:crypto';
import {object} from '../policy/programme.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {loadPreparationIntent} from '../hierarchy/packets.js';
import {deriveEffectiveProfile} from '../preparation/effective.js';
import type {EffectiveResultSource,EffectiveProfileInput} from '../preparation/effective.js';
import {assuranceBarrier,canonical,digest,fail,hash,inspectSubmittedResult,uuid} from './submission.js';
import type {Data} from './submission.js';

export interface ResultPreparationContext {
 organisation_id:string;run_id:string;job_id:string;custody_id:string;
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
 const found=await tx.query("SELECT j.id,j.custody_id,j.custody_generation::text,j.state,j.rubric_digest,c.task_id,s.manifest,s.policy,"
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
 const accepted_context={
  task_id:intent.task_id,spec_revision_id:intent.spec_revision_id,spec_generation:String(intent.spec_generation),
  criteria_digest:intent.criteria_digest,registry_digest:intent.registry_digest,policy_digest:hash(intent.proof_policy),
  resource_requirements:intent.resource_requirements,
 };
 const body={organisation_id,run_id,job_id,custody_id:result.custody_id,result,
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
