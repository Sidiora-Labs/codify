import fs from 'node:fs/promises';
import type {ServiceResources} from '../storage/runtime.js';
import type {ExternalAuthorityJournal,ExternalAuthorityAttestation} from '../storage/authority_journal.js';
import type {PrimaryTransaction,TransactionOptions} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {assertCurrentAuthority,assertExternalAuthorityCurrent,lookupAuthorityActivation} from '../storage/durability.js';
import {readSemanticDisposition,writeSemanticDisposition} from '../storage/dispositions.js';
import {decimal,exact,fail,frozen,hash,uuid} from '../transport/protocol.js';

export interface AcceptedRunRebindInput {
 readonly schema_version:1;readonly organisation_id:string;readonly run_id:string;readonly recovery_operation_id:string;
 readonly activation_operation_id:string;readonly deployment_id:string;readonly expected_run_epoch:string;readonly target_epoch:string;
 readonly expected_spec_generation:string;readonly expected_spec_revision_id:string;readonly expected_revision_digest:string;
 readonly external_previous_epoch:string|null;readonly database_predecessor_epoch:string|null;
 readonly fence_proof_digest:string;readonly external_journal_sequence:string;
}
export type RecoveryEvidenceScope='LIVE_PROVIDER'|'ISOLATED_POSTGRESQL_FIXTURE';
export interface AcceptedRunRecoveryIntent extends AcceptedRunRebindInput {readonly intent_digest:string;readonly evidence_scope:RecoveryEvidenceScope}
export interface RecoveryComputeRevocation {readonly revoked_attempts:string;readonly revoked_allocations:string;readonly retained_debt_references:readonly string[]}
export interface PreparedAcceptedRunRecovery {
 verify(tx:PrimaryTransaction):Promise<AcceptedRunRecoveryIntent>;
 revokeCompute(tx:PrimaryTransaction):Promise<RecoveryComputeRevocation>;
}
export interface RunRebindReceipt {
 readonly schema_version:1;readonly organisation_id:string;readonly run_id:string;readonly recovery_operation_id:string;
 readonly deployment_id:string;readonly activation_operation_id:string;readonly source_epoch:string;readonly target_epoch:string;
 readonly spec_generation:string;readonly spec_revision_id:string;readonly accepted_revision_digest:string;
 readonly input_digest:string;readonly intent_digest:string;readonly receipt_digest:string;readonly evidence_scope:RecoveryEvidenceScope;
 readonly revoked_principals:string;readonly revoked_grants:string;readonly revoked_attachments:string;
 readonly revoked_attempts:string;readonly revoked_allocations:string;readonly retained_debt_references:readonly string[];
 readonly run_state:'PAUSED';readonly state_version:string;readonly created_at:string;
 readonly compute_admission_granted:false;readonly publication_authorized:false;
}
export interface RunRebindReceiptExpectation {
 readonly organisation_id:string;readonly run_id:string;readonly recovery_operation_id:string;readonly receipt_digest:string;
 readonly deployment_id:string;readonly target_epoch:string;readonly accepted_revision_digest:string;readonly evidence_scope:RecoveryEvidenceScope;
}
const fields=['schema_version','organisation_id','run_id','recovery_operation_id','activation_operation_id','deployment_id','expected_run_epoch','target_epoch','expected_spec_generation','expected_spec_revision_id','expected_revision_digest','external_previous_epoch','database_predecessor_epoch','fence_proof_digest','external_journal_sequence'];
const digest=(v:unknown):v is string=>typeof v==='string'&&/^sha256:[0-9a-f]{64}$/.test(v);
function canonical(v:unknown):string {if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}'}
function pin(v:unknown):string{return hash(Buffer.from(canonical(v)))}
function inputOf(raw:AcceptedRunRebindInput):AcceptedRunRebindInput {
 exact(raw,fields);
 if(raw.schema_version!==1)fail('RECOVERY_INPUT_INVALID','Versioned offline accepted-run recovery required');
 for(const key of ['organisation_id','run_id','recovery_operation_id','activation_operation_id','deployment_id','expected_run_epoch','target_epoch','expected_spec_revision_id'] as const)if(!uuid(raw[key]))fail('RECOVERY_INPUT_INVALID','Canonical recovery identity required');
 for(const key of ['external_previous_epoch','database_predecessor_epoch'] as const)if(raw[key]!==null&&!uuid(raw[key]))fail('RECOVERY_INPUT_INVALID','Exact recovery predecessor required');
 if(raw.expected_run_epoch===raw.target_epoch||!decimal(raw.expected_spec_generation,true)||!decimal(raw.external_journal_sequence,true)||!digest(raw.expected_revision_digest)||!digest(raw.fence_proof_digest))fail('RECOVERY_INPUT_INVALID','Distinct epoch and exact accepted intent/proof pins required');
 return frozen(structuredClone(raw));
}
async function schema(tx:PrimaryTransaction):Promise<void>{
 const bytes=await fs.readFile(new URL('../../migrations/0040-identity-recovery.sql',import.meta.url));
 const row=(await tx.query('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=40')).rows[0];
 if(!row||row.name!=='0040-identity-recovery'||row.checksum!==hash(bytes))fail('IDENTITY_RECOVERY_SCHEMA_REQUIRED','Apply exact trusted recovery migration before offline recovery');
}
async function accepted(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string}){
 return (await tx.query('SELECT r.authority_epoch::text,r.spec_generation::text,r.spec_revision_id::text,r.state,r.state_version::text,s.revision_digest FROM hyperfide.runs r JOIN hyperfide.run_spec_revisions a ON a.organisation_id=r.organisation_id AND a.run_id=r.id AND a.spec_generation=r.spec_generation AND a.spec_revision_id=r.spec_revision_id AND a.accepted JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id WHERE r.organisation_id=$1 AND r.id=$2 FOR UPDATE OF r',[input.organisation_id,input.run_id])).rows[0];
}
async function fresh(tx:PrimaryTransaction,input:AcceptedRunRebindInput,attestation:ExternalAuthorityAttestation):Promise<void>{
 const row=(await tx.query("SELECT epoch::text,proof_digest,clock_timestamp()::text AS now FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE' FOR SHARE",[input.deployment_id])).rows[0];
 const now=(await tx.query('SELECT clock_timestamp()::text AS now')).rows[0]!.now;
 if(!row||row.epoch!==input.target_epoch||row.proof_digest!==input.fence_proof_digest||attestation.epoch!==input.target_epoch||attestation.sequence!==input.external_journal_sequence||attestation.evidence_digest!==input.fence_proof_digest||Date.parse(attestation.expires_at)<=Date.parse(now)||Date.parse(attestation.observed_at)>Date.parse(now)+1000)fail('RECOVERY_REBIND_PROOF_STALE','Actual external activation changed or expired while waiting for primary locks');
}
function receiptOf(row:Record<string,any>):RunRebindReceipt {
 const receipt=row.receipt as RunRebindReceipt;
 if(!receipt||typeof receipt!=='object'||!digest(receipt.receipt_digest))fail('RECOVERY_RECEIPT_INVALID','Immutable recovery receipt is incomplete');
 const {receipt_digest,...body}=receipt;
 if(pin(body)!==receipt_digest||row.receipt_digest!==receipt_digest||row.input_digest!==receipt.input_digest||row.intent_digest!==receipt.intent_digest||row.evidence_scope!==receipt.evidence_scope)fail('RECOVERY_RECEIPT_INVALID','Immutable recovery receipt bytes do not match persisted pins');
 return frozen(structuredClone(receipt));
}
/** Local trusted deployment composition only. The prepared verifier reads actual24
 * retained physical evidence; its scheduler callback revokes actual5 authority.
 * Neither caller JSON nor an isolation permit may construct this recovery proof.
 */
export async function rebindAcceptedRun(resources:ServiceResources,journal:ExternalAuthorityJournal,raw:AcceptedRunRebindInput,prepared:PreparedAcceptedRunRecovery,options:TransactionOptions={}):Promise<RunRebindReceipt>{
 const input=inputOf(raw),inputDigest=pin(input);
 if(!prepared||typeof prepared.verify!=='function'||typeof prepared.revokeCompute!=='function')fail('RECOVERY_VERIFIER_REQUIRED','Actual accepted recovery and scheduler revocation callbacks required');
 const attestation=await assertExternalAuthorityCurrent(resources,journal,{deployment_id:input.deployment_id,...(options.signal?{signal:options.signal}:{})});
 const activation=await lookupAuthorityActivation(resources,{deployment_id:input.deployment_id,operation_id:input.activation_operation_id,expected_previous_epoch:input.external_previous_epoch,database_predecessor_epoch:input.database_predecessor_epoch,epoch:input.target_epoch,...(options.signal?{signal:options.signal}:{})});
 if(activation.evidence_digest!==input.fence_proof_digest||attestation.sequence!==input.external_journal_sequence)fail('RECOVERY_REBIND_PROOF_MISMATCH','Actual activation and external journal do not match the pinned recovery');
 return resources.gateway.withPrimaryTransaction({...options,timeoutMs:options.timeoutMs??5000},async tx=>{
  assertPrimaryTransaction(tx);await schema(tx);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['identity-recovery:'+input.deployment_id+':'+input.recovery_operation_id]);
  const prior=(await tx.query('SELECT * FROM hyperfide.identity_run_rebindings WHERE organisation_id=$1 AND run_id=$2 AND recovery_operation_id=$3',[input.organisation_id,input.run_id,input.recovery_operation_id])).rows[0];
  if(prior){
   if(prior.input_digest!==inputDigest)fail('RECOVERY_IDEMPOTENCY_CONFLICT','Recovery operation already binds different immutable input');
   await readSemanticDisposition(tx,input);const run=await accepted(tx,input);
   if(!run||run.authority_epoch!==input.target_epoch||run.spec_generation!==input.expected_spec_generation||run.spec_revision_id!==input.expected_spec_revision_id||run.revision_digest!==input.expected_revision_digest)fail('RECOVERY_RECEIPT_STALE','Recorded recovery is no longer the current accepted run binding');
   await assertCurrentAuthority(tx,{...input,authority_epoch:input.target_epoch});await fresh(tx,input,attestation);return receiptOf(prior);
  }
  await writeSemanticDisposition(tx,input);
  const intent=await prepared.verify(tx);exact(intent,[...fields,'intent_digest','evidence_scope']);
  const {intent_digest,evidence_scope,...verifiedInput}=intent;
  if(!digest(intent_digest)||!['LIVE_PROVIDER','ISOLATED_POSTGRESQL_FIXTURE'].includes(evidence_scope)||pin(verifiedInput)!==inputDigest||intent_digest!==pin({...input,evidence_scope}))fail('RECOVERY_REBIND_PROOF_MISMATCH','Trusted recovery verifier returned a different exact accepted intent');
  const run=await accepted(tx,input);
  if(!run||run.authority_epoch!==input.expected_run_epoch||run.spec_generation!==input.expected_spec_generation||run.spec_revision_id!==input.expected_spec_revision_id||run.revision_digest!==input.expected_revision_digest||!['READY','RUNNING','PAUSING','PAUSED','DRAINING','DRAINED','STOPPED','FAILED'].includes(run.state))fail('RECOVERY_ACCEPTED_INTENT_MISMATCH','Exact recoverable accepted predecessor is required');
  await fresh(tx,input,attestation);
  // Scheduler must still observe the OLD epoch; it retains custody/effects as debt.
  const compute=await prepared.revokeCompute(tx);
  if(!decimal(compute.revoked_attempts)||!decimal(compute.revoked_allocations)||!Array.isArray(compute.retained_debt_references)||compute.retained_debt_references.length>10000||compute.retained_debt_references.some(v=>typeof v!=='string'||v.length<1||v.length>512))fail('RECOVERY_REBIND_REVOCATION_INVALID','Actual scheduler revocation result required');
  if((await tx.query("SELECT 1 FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND compute_authority='CURRENT' LIMIT 1",[input.organisation_id,input.run_id])).rows.length)fail('RECOVERY_COMPUTE_NOT_REVOKED','Scheduler left current compute authority behind');
  const principals=await tx.query("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE organisation_id=$1 AND run_id=$2 AND state='ACTIVE'",[input.organisation_id,input.run_id]);
  const grants=await tx.query("UPDATE hyperfide.identity_enrollment_grants SET state='REVOKED' WHERE organisation_id=$1 AND run_id=$2 AND state IN ('ISSUED','CONSUMED')",[input.organisation_id,input.run_id]);
  const attachments=await tx.query("UPDATE hyperfide.identity_credential_attachments SET state='REVOKED' WHERE organisation_id=$1 AND run_id=$2 AND state='AVAILABLE'",[input.organisation_id,input.run_id]);
  const changed=(await tx.query("UPDATE hyperfide.runs SET authority_epoch=$3,state='PAUSED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND authority_epoch=$4 RETURNING state_version::text,clock_timestamp()::text AS now",[input.organisation_id,input.run_id,input.target_epoch,input.expected_run_epoch])).rows[0];
  if(!changed)fail('RECOVERY_STALE_EPOCH','Run epoch changed during accepted recovery');
  await assertCurrentAuthority(tx,{...input,authority_epoch:input.target_epoch});await fresh(tx,input,attestation);
  const body={schema_version:1 as const,organisation_id:input.organisation_id,run_id:input.run_id,recovery_operation_id:input.recovery_operation_id,deployment_id:input.deployment_id,activation_operation_id:input.activation_operation_id,source_epoch:input.expected_run_epoch,target_epoch:input.target_epoch,spec_generation:input.expected_spec_generation,spec_revision_id:input.expected_spec_revision_id,accepted_revision_digest:input.expected_revision_digest,input_digest:inputDigest,intent_digest,evidence_scope,revoked_principals:String(principals.rowCount??0),revoked_grants:String(grants.rowCount??0),revoked_attachments:String(attachments.rowCount??0),revoked_attempts:compute.revoked_attempts,revoked_allocations:compute.revoked_allocations,retained_debt_references:[...new Set(compute.retained_debt_references)].sort(),run_state:'PAUSED' as const,state_version:changed.state_version,created_at:new Date(changed.now).toISOString(),compute_admission_granted:false as const,publication_authorized:false as const};
  const receipt=frozen({...body,receipt_digest:pin(body)});
  await tx.query('INSERT INTO hyperfide.identity_run_rebindings(organisation_id,run_id,recovery_operation_id,deployment_id,activation_operation_id,source_epoch,target_epoch,spec_generation,spec_revision_id,accepted_revision_digest,input_digest,intent_digest,receipt_digest,evidence_scope,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)',[input.organisation_id,input.run_id,input.recovery_operation_id,input.deployment_id,input.activation_operation_id,input.expected_run_epoch,input.target_epoch,input.expected_spec_generation,input.expected_spec_revision_id,input.expected_revision_digest,inputDigest,intent_digest,receipt.receipt_digest,evidence_scope,JSON.stringify(receipt)]);
  await fresh(tx,input,attestation);return receipt;
 });
}
/** Trusted26 issuer uses this in its own genuine primary transaction, after fresh
 * external journal verification. It does not accept a serialized receipt as proof.
 */
export async function inspectRunRebindReceipt(tx:PrimaryTransaction,expected:RunRebindReceiptExpectation):Promise<RunRebindReceipt>{
 assertPrimaryTransaction(tx);exact(expected,['organisation_id','run_id','recovery_operation_id','receipt_digest','deployment_id','target_epoch','accepted_revision_digest','evidence_scope']);
 for(const key of ['organisation_id','run_id','recovery_operation_id','deployment_id','target_epoch'] as const)if(!uuid(expected[key]))fail('INVALID_REQUEST','Exact recovery receipt scope required');
 if(!digest(expected.receipt_digest)||!digest(expected.accepted_revision_digest)||!['LIVE_PROVIDER','ISOLATED_POSTGRESQL_FIXTURE'].includes(expected.evidence_scope))fail('INVALID_REQUEST','Exact recovery receipt digests required');
 await schema(tx);await readSemanticDisposition(tx,expected);
 const row=(await tx.query('SELECT * FROM hyperfide.identity_run_rebindings WHERE organisation_id=$1 AND run_id=$2 AND recovery_operation_id=$3 FOR SHARE',[expected.organisation_id,expected.run_id,expected.recovery_operation_id])).rows[0];
 if(!row)fail('RECOVERY_RECEIPT_REQUIRED','No immutable accepted-run recovery receipt exists');
 const receipt=receiptOf(row);
 if(receipt.receipt_digest!==expected.receipt_digest||receipt.deployment_id!==expected.deployment_id||receipt.target_epoch!==expected.target_epoch||receipt.accepted_revision_digest!==expected.accepted_revision_digest||receipt.evidence_scope!==expected.evidence_scope)fail('RECOVERY_RECEIPT_INVALID','Persisted recovery receipt differs from exact issuer pins');
 const run=await accepted(tx,expected);
 if(!run||run.state!=='PAUSED'||run.authority_epoch!==receipt.target_epoch||run.spec_generation!==receipt.spec_generation||run.spec_revision_id!==receipt.spec_revision_id||run.revision_digest!==receipt.accepted_revision_digest)fail('RECOVERY_RECEIPT_STALE','Recovery issuance requires the current paused accepted run');
 await assertCurrentAuthority(tx,{...expected,authority_epoch:receipt.target_epoch});return receipt;
}
