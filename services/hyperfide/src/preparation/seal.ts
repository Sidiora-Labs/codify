import {createHash,randomUUID} from 'node:crypto';
import {FoundationError} from '../policy/programme.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {canonicalJSON} from './manifests.js';

export type FailureClass='PROVIDER_UNAVAILABLE'|'PROVIDER_FAILED'|'PACKAGE_FAILURE'|'PARTIAL_DOWNLOAD'|'READINESS_FAILED'|'OBSOLETE_MANIFEST';
export interface PreparationJobRow {
 organisation_id:string;run_id:string;id:string;pool_id:string;profile_id:string;job_class:'PREPARATION'|'INDEX';
 warm_spare:boolean;configuration_digest:string;preparation_digest:string;recipe_digest:string;plan_digest:string;plan:unknown;
 intent_id:string;sandbox_id:string;state:string;attempts:number;max_attempts:number;backoff_base_ms:number;backoff_max_ms:number;
 next_attempt_at:string;prepared_base_id:string|null;reservation_ids:string[];physical_reservation_ids:string[];
}
export interface PreparationTarget {provider:'railway'|'blaxel';configuration_digest:string;preparation_digest:string;profile_id:string|null}
export interface RemoteReport {
 job_id:string;attempt:number;
 execution:{host_class:string;sandbox_id:string;boot_generation:string;native_sandbox_id:string};
 manifest_artifact_digest:string;provider_reference:{preparation_reference:string};
 execution_receipt:Record<string,unknown>;verification_receipt:Record<string,unknown>;
}
export type Classification={ok:true}|{ok:false;failure_class:FailureClass;retryable:boolean;detail:string};

function fail(code:string,message:string):never{throw new FoundationError(code,message);}
export const documentDigest=(value:unknown)=>'sha256:'+createHash('sha256').update(canonicalJSON(value)).digest('hex');
function record(value:unknown,label:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_REQUEST',label+' must be an object');return value as Record<string,unknown>;
}
const digest=(value:unknown)=>typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value);

/** Only exact current pool configuration and preparation identity may be published. */
export function isObsolete(job:PreparationJobRow,target:PreparationTarget):boolean{
 return job.configuration_digest!==target.configuration_digest||job.preparation_digest!==target.preparation_digest||
  (target.profile_id!==null&&target.profile_id!==job.profile_id);
}

/**
 * Classifies a remote attempt from its retained receipts. Order matters: an obsolete manifest is never
 * retried, a package failure or partial download is retryable, and readiness must be observed READY.
 */
export function classifyRemoteReport(job:PreparationJobRow,report:RemoteReport,target:PreparationTarget):Classification{
 const execution=report.execution_receipt,verification=report.verification_receipt;
 const bootstrap=record(execution.bootstrap,'bootstrap receipt');
 const obsolete={ok:false as const,failure_class:'OBSOLETE_MANIFEST' as const,retryable:false,detail:'Prepared inputs no longer match the current pool configuration and manifest'};
 if(isObsolete(job,target)||execution.preparation_digest!==job.preparation_digest||verification.preparation_digest!==job.preparation_digest)return obsolete;
 if(bootstrap.state!=='MATERIALIZED'||bootstrap.authority_granted!==false)
  return {ok:false,failure_class:'PACKAGE_FAILURE',retryable:true,detail:'Remote bootstrap or dependency installation did not complete'};
 if(bootstrap.preparation_digest!==job.preparation_digest)return obsolete;
 if(!Array.isArray(execution.downloads)||execution.downloads.length>1024)fail('INVALID_REQUEST','Bounded download inventory required');
 for(const raw of execution.downloads){
  const item=record(raw,'download');
  if(typeof item.path!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(String(item.expected_bytes))||!digest(item.expected_digest))
   fail('INVALID_REQUEST','Download expectations must be exact');
  if(item.received_bytes!==item.expected_bytes||item.received_digest!==item.expected_digest)
   return {ok:false,failure_class:'PARTIAL_DOWNLOAD',retryable:true,detail:'Download '+item.path+' is partial or differs from its pin'};
 }
 const readiness=record(verification.readiness,'readiness');
 if(readiness.state!=='READY'||readiness.boot_generation!==report.execution.boot_generation)
  return {ok:false,failure_class:'READINESS_FAILED',retryable:true,detail:'Remote readiness verification did not observe READY on the prepared boot'};
 return {ok:true};
}

export function backoffMs(job:Pick<PreparationJobRow,'backoff_base_ms'|'backoff_max_ms'>,attempt:number):number{
 return Math.min(job.backoff_max_ms,job.backoff_base_ms*2**Math.max(0,Math.min(attempt-1,20)));
}

/** Diagnostics are retained as a COMPLETE artifact whose bytes live in the attempt row. */
export async function retainDiagnostics(tx:PrimaryTransaction,job:PreparationJobRow,attempt:number,diagnostics:Record<string,unknown>):Promise<string>{
 assertPrimaryTransaction(tx);
 const body=canonicalJSON(diagnostics),value=documentDigest(diagnostics);
 await tx.query("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status) VALUES($1,$2,$3,$4,$5,'PRIMARY_DATABASE',$6,'COMPLETE') ON CONFLICT(organisation_id,run_id,digest) DO NOTHING",
  [job.organisation_id,job.run_id,randomUUID(),value,String(Buffer.byteLength(body)),'hyperfide.preparation_job_attempts/'+job.id+'/'+attempt]);
 return value;
}

/** Ends the current attempt; retryable failures back off until the bounded attempt limit is reached. */
export async function finishAttempt(tx:PrimaryTransaction,job:PreparationJobRow,attempt:number,result:{outcome:'SUCCEEDED'}|{outcome:'FAILURE';failure_class:FailureClass;retryable:boolean},
 diagnostics:Record<string,unknown>):Promise<{state:string;outcome:string;next_attempt_at:string|null;diagnostics_artifact_digest:string}>{
 assertPrimaryTransaction(tx);
 const artifact=await retainDiagnostics(tx,job,attempt,{...diagnostics,job_id:job.id,attempt});
 let outcome:string,state:string,delay:number|null=null;
 if(result.outcome==='SUCCEEDED'){outcome='SUCCEEDED';state='SEALED';}
 else if(result.failure_class==='OBSOLETE_MANIFEST'){outcome='OBSOLETE';state='OBSOLETE';}
 else if(result.retryable&&attempt<job.max_attempts){outcome='RETRYABLE_FAILURE';state='RETRY_WAIT';delay=backoffMs(job,attempt);}
 else{outcome='FAILED';state='FAILED';}
 const finished=await tx.query("UPDATE hyperfide.preparation_job_attempts SET outcome=$5,failure_class=$6,diagnostics=$7,diagnostics_artifact_digest=$8,finished_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 AND attempt=$4 AND outcome='RUNNING'",
  [job.organisation_id,job.run_id,job.id,attempt,outcome,result.outcome==='SUCCEEDED'?null:result.failure_class,{...diagnostics,job_id:job.id,attempt},artifact]);
 if(finished.rowCount!==1)fail('PREPARATION_ATTEMPT_STALE','Only the current running attempt can finish');
 if(state!=='SEALED'){
  const row=await tx.query<{next_attempt_at:string}>("UPDATE hyperfide.preparation_jobs SET state=$4,next_attempt_at=CASE WHEN $5::integer IS NULL THEN next_attempt_at ELSE clock_timestamp()+make_interval(secs=>$5::integer/1000.0) END,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING next_attempt_at",
   [job.organisation_id,job.run_id,job.id,state,delay]);
  return {state,outcome,next_attempt_at:delay===null?null:new Date(row.rows[0]!.next_attempt_at).toISOString(),diagnostics_artifact_digest:artifact};
 }
 return {state,outcome,next_attempt_at:null,diagnostics_artifact_digest:artifact};
}

/** Older bases for this pool/profile become STALE once their configuration or preparation identity is not current. */
export async function markObsoleteBases(tx:PrimaryTransaction,job:Pick<PreparationJobRow,'organisation_id'|'pool_id'|'profile_id'>,target:PreparationTarget):Promise<string[]>{
 assertPrimaryTransaction(tx);
 const rows=await tx.query<{id:string}>("UPDATE hyperfide.provider_prepared_bases SET state='STALE' WHERE organisation_id=$1 AND pool_id=$2 AND profile_id=$3 AND state='QUALIFIED' AND (configuration_digest<>$4 OR preparation_digest<>$5) RETURNING id",
  [job.organisation_id,job.pool_id,job.profile_id,target.configuration_digest,target.preparation_digest]);
 return rows.rows.map(row=>row.id).sort();
}

/** Every receipt must be a COMPLETE retained artifact whose digest is the exact canonical receipt body. */
export async function requireCompleteArtifacts(tx:PrimaryTransaction,job:PreparationJobRow,digests:readonly string[]):Promise<void>{
 assertPrimaryTransaction(tx);
 const unique=[...new Set(digests)];
 if(unique.some(value=>!digest(value)))fail('PREPARATION_EVIDENCE_INCOMPLETE','Receipt artifact digests are required');
 const rows=await tx.query("SELECT digest FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=ANY($3::text[]) AND status='COMPLETE' AND completed_at IS NOT NULL FOR SHARE",
  [job.organisation_id,job.run_id,unique]);
 if(rows.rows.length!==unique.length)fail('PREPARATION_EVIDENCE_INCOMPLETE','Manifest, execution and verification artifacts must all be complete');
}

/**
 * Publishes one pool-verified reusable base. Callers have already classified the attempt as successful;
 * this re-checks currency and complete custody under lock before inserting the QUALIFIED row.
 */
export async function sealPreparedBase(tx:PrimaryTransaction,job:PreparationJobRow,report:RemoteReport,target:PreparationTarget,
 manifest:unknown,expiresAt:string):Promise<{base_id:string;provider_prepared_digest:string;stale:string[]}>{
 assertPrimaryTransaction(tx);
 if(isObsolete(job,target))fail('PREPARATION_OBSOLETE','Obsolete preparation cannot be published');
 if(documentDigest(manifest)!==report.manifest_artifact_digest)fail('PREPARATION_EVIDENCE_INCOMPLETE','Manifest artifact does not match the accepted manifest contents');
 const execution=documentDigest(report.execution_receipt),verification=documentDigest(report.verification_receipt);
 await requireCompleteArtifacts(tx,job,[report.manifest_artifact_digest,execution,verification]);
 const reference=report.provider_reference.preparation_reference;
 const prepared=documentDigest({preparation_digest:job.preparation_digest,configuration_digest:job.configuration_digest,provider:target.provider,
  preparation_reference:reference,manifest_artifact_digest:report.manifest_artifact_digest});
 const id=randomUUID();
 await tx.query("INSERT INTO hyperfide.provider_prepared_bases(organisation_id,id,pool_id,profile_id,preparation_digest,provider,configuration_digest,provider_prepared_digest,provider_reference,source_run_id,source_sandbox_id,source_boot_generation,manifest_artifact_digest,execution_receipt_digest,verification_receipt_digest,execution_receipt_artifact_digest,verification_receipt_artifact_digest,verification_scope,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14,$15,'POOL','QUALIFIED',$16)",
  [job.organisation_id,id,job.pool_id,job.profile_id,job.preparation_digest,target.provider,job.configuration_digest,prepared,{preparation_reference:reference},
   job.run_id,job.sandbox_id,report.execution.boot_generation,report.manifest_artifact_digest,execution,verification,expiresAt]);
 const stale=await markObsoleteBases(tx,job,target);
 await tx.query("UPDATE hyperfide.preparation_jobs SET state='SEALED',prepared_base_id=$4,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",
  [job.organisation_id,job.run_id,job.id,id]);
 return {base_id:id,provider_prepared_digest:prepared,stale};
}
