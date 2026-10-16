/**
 * Wire contracts for PostgreSQL authority metadata. Git and object storage retain
 * payload ownership; these records identify the exact objects being admitted.
 */
export type UUID = string;
export type Digest = string;
export type Generation = string;
export interface Scope { organisation_id: UUID; run_id: UUID }
export interface SourceReference extends Scope { repository_id: UUID; source_object_id: string }
export interface ArtifactReference extends Scope {
  id: UUID; digest: Digest; size_bytes: string; storage_key: string;
  status: 'PENDING' | 'COMPLETE' | 'QUARANTINED' | 'DELETED'; storage_backend: string;
  retention_class: 'EPHEMERAL' | 'RUN' | 'RELEASE' | 'LEGAL_HOLD';
}
export interface ComputeAuthorityToken extends Scope {
  task_id: UUID; attempt_id: UUID; attempt_generation: Generation; authority_epoch: UUID;
  sandbox_id: UUID; sandbox_boot_generation: Generation;
}
export interface CustodyAuthorityToken extends Scope {
  task_id: UUID; submission_id: UUID; custody_generation: Generation; authority_epoch: UUID;
}
export interface OrganisationRecord { id: UUID; name: string }
export interface ProjectRecord { organisation_id: UUID; id: UUID; name: string }
export interface RepositoryRecord extends ProjectRecord {
  project_id: UUID; url: string; object_format: 'sha1' | 'sha256';
}
export interface SpecRevisionRecord {
  organisation_id: UUID; project_id: UUID; id: UUID; source_digest: Digest; source_content: string;
  document: Record<string, unknown>; schema_version: number; repository_id?: UUID; git_object_id?: string;
}
export interface RunRecord {
  organisation_id: UUID;
  id: UUID; project_id: UUID; spec_revision_id: UUID; policy_digest: Digest; authority_epoch: UUID;
  state: string; spec_generation: Generation; state_version: Generation;
}
export interface TaskRecord extends Scope {
  id: UUID; task_key: string; feature_package_id: UUID; spec_revision_id: UUID; spec_generation: Generation;
  criteria_digest: Digest; definition: Record<string, unknown>; wave: number; state: string;
  generation: string; state_version: Generation;
}
export interface AttemptRecord extends Scope {
  id: UUID; task_id: UUID; generation: Generation; authority_epoch: UUID; input_packet_digest: Digest;
  kind?: string; execution_state?: string; compute_authority?: string; sandbox_id?: UUID | null;
  slot_id?: UUID | null; sandbox_boot_generation?: Generation | null; lease_expires_at?: string | null;
  state_version?: Generation;
}
export interface ComputeLeaseRecord extends Scope {
  id: UUID; attempt_id: UUID; attempt_generation: Generation; authority_epoch: UUID;
  sandbox_boot_generation: Generation; expires_at: string; state?: string; state_version?: Generation;
}
export interface SubmissionCustodyRecord extends Scope {
  id: UUID; task_id: UUID; source_attempt_id: UUID; source_generation: Generation;
  custody_generation: Generation; authority_epoch: UUID; repository_id: UUID; source_object_id: string;
  source_manifest_digest: Digest; evidence_manifest_digest: Digest; criteria_digest: Digest;
  authority?: string; qualification_outcome?: string; state_version?: Generation;
}
export interface EvidenceRecord extends SourceReference {
  id: UUID; attempt_id: UUID; attempt_generation: Generation; criteria_digest: Digest;
  manifest_digest: Digest; artifact_id: UUID; admission_state?: string; state_version?: Generation;
}
export interface QualificationJobRecord extends Scope {
  id: UUID; custody_id: UUID; custody_generation: Generation; rubric_digest: Digest; state?: string;
  lease_generation?: string; lease_owner?: UUID | null; lease_expires_at?: string | null;
  outcome?: string; state_version?: Generation;
}
export interface PublicationOperationRecord extends Scope {
  repository_id: UUID;
  id: UUID; publication_intent_id: UUID; candidate_id: UUID; branch_authority_id: UUID;
  branch_generation: Generation; authority_epoch: UUID; expected_old_head?: string | null;
  candidate_head: string; request_id: UUID; operation_generation?: Generation; state?: string;
  observed_head?: string | null; state_version?: Generation;
}

export class AuthorityRecordError extends Error {
  readonly code = 'INVALID_RECORD';
  constructor(message: string) { super(message); this.name = 'AuthorityRecordError'; }
}
type Validator = (value: unknown, path: string) => unknown;
export function recordObject(value: unknown, path = 'input'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new AuthorityRecordError(path + ' must be an object');
  return value as Record<string, unknown>;
}
function text(pattern: RegExp, maximum: number): Validator {
  return (value, path) => {
    if (typeof value !== 'string' || value.length > maximum || !pattern.test(value))
      throw new AuthorityRecordError(path + ' has an invalid encoding');
    return value;
  };
}
const uuid = text(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 36);
const digest = text(/^sha256:[0-9a-f]{64}$/, 71);
const oid = text(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 64);
const bigint = (positive: boolean): Validator => (value, path) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 19 ||
      BigInt(value) > 9223372036854775807n || (positive && value === '0'))
    throw new AuthorityRecordError(path + ' must be a canonical PostgreSQL bigint decimal string');
  return value;
};
const generation = bigint(true), nonnegative = bigint(false);
const timestamp: Validator = (value, path) => {
  if (typeof value !== 'string' || value.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || value.startsWith('0000-') ||
      new Date(value).toISOString().slice(0,19) !== value.slice(0,19))
    throw new AuthorityRecordError(path + ' must be a UTC timestamp');
  return value;
};
const enumValue = (...values: string[]): Validator => (value, path) => {
  if (typeof value !== 'string' || !values.includes(value))
    throw new AuthorityRecordError(path + ' is not a supported value');
  return value;
};
const nullable = (validator: Validator): Validator => (value, path) => value === null ? null : validator(value, path);
const scoped = { organisation_id: uuid, run_id: uuid };
const identified = { ...scoped, id: uuid };
interface Definition { table: string; fields: Record<string, Validator>; required: string[] }
export const CREATE_RECORDS: Readonly<Record<string, Definition>> = Object.freeze({
  source_object: { table: 'source_objects', fields: {
    organisation_id: uuid, repository_id: uuid, object_id: oid,
    object_type: enumValue('commit','tree','blob','tag')
  }, required: ['organisation_id','repository_id','object_id'] },
  attempt: { table: 'attempts', fields: {
    ...identified, task_id: uuid, generation, authority_epoch: uuid, input_packet_digest: digest,
    kind: enumValue('IMPLEMENTATION','REVIEW','VERIFICATION','INTEGRATION','INDEX'),
    execution_state: enumValue('PLANNED','RESERVED','PREPARING','START_REQUESTED','RUNNING','SUBMITTED','SUCCEEDED','FAILED','CANCELLED'),
    compute_authority: enumValue('CURRENT','RELEASED','REVOKED','EXPIRED'),
    sandbox_id: nullable(uuid), slot_id: nullable(uuid), sandbox_boot_generation: nullable(generation),
    lease_expires_at: nullable(timestamp), state_version: generation
  }, required: [...Object.keys(identified),'task_id','generation','authority_epoch','input_packet_digest'] },
  compute_lease: { table: 'compute_leases', fields: {
    ...identified, attempt_id: uuid, attempt_generation: generation, authority_epoch: uuid,
    sandbox_boot_generation: generation, expires_at: timestamp, state: enumValue('ACTIVE','RELEASED','REVOKED','EXPIRED'),
    state_version: generation
  }, required: [...Object.keys(identified),'attempt_id','attempt_generation','authority_epoch','sandbox_boot_generation','expires_at'] },
  submission_custody: { table: 'submission_custodies', fields: {
    ...identified, task_id: uuid, source_attempt_id: uuid, source_generation: generation,
    custody_generation: generation, authority_epoch: uuid, repository_id: uuid, source_object_id: oid,
    source_manifest_digest: digest, evidence_manifest_digest: digest, criteria_digest: digest,
    authority: enumValue('ACTIVE','REVOKED','SUPERSEDED','RELEASED'),
    qualification_outcome: enumValue('PENDING','PASS','FAIL'), state_version: generation
  }, required: [...Object.keys(identified),'task_id','source_attempt_id','source_generation','custody_generation',
    'authority_epoch','repository_id','source_object_id','source_manifest_digest','evidence_manifest_digest','criteria_digest'] },
  evidence: { table: 'evidence', fields: {
    ...identified, attempt_id: uuid, attempt_generation: generation, repository_id: uuid, source_object_id: oid,
    criteria_digest: digest, manifest_digest: digest, artifact_id: uuid,
    admission_state: enumValue('PENDING','ADMITTED','REJECTED','STALE'), state_version: generation
  }, required: [...Object.keys(identified),'attempt_id','attempt_generation','repository_id','source_object_id',
    'criteria_digest','manifest_digest','artifact_id'] },
  evidence_artifact: { table: 'evidence_artifacts', fields: {
    ...scoped, evidence_id: uuid, artifact_id: uuid, role: text(/^[a-z][a-z0-9_.-]*$/, 64)
  }, required: [...Object.keys(scoped),'evidence_id','artifact_id'] },
  qualification_job: { table: 'qualification_jobs', fields: {
    ...identified, custody_id: uuid, custody_generation: generation, rubric_digest: digest,
    state: enumValue('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED'),
    lease_generation: nonnegative, lease_owner: nullable(uuid), lease_expires_at: nullable(timestamp),
    outcome: enumValue('PENDING','PASS','FAIL'), state_version: generation
  }, required: [...Object.keys(identified),'custody_id','custody_generation','rubric_digest'] },
  publication_operation: { table: 'publication_operations', fields: {
    ...identified, publication_intent_id: uuid, candidate_id: uuid, branch_authority_id: uuid,
    branch_generation: generation, authority_epoch: uuid, repository_id: uuid,
    expected_old_head: nullable(oid), candidate_head: oid, request_id: uuid, operation_generation: generation,
    state: enumValue('PENDING','RUNNING','OUTCOME_UNKNOWN','PUBLISHED','FAILED','CANCELLED'),
    observed_head: nullable(oid), state_version: generation
  }, required: [...Object.keys(identified),'publication_intent_id','candidate_id','branch_authority_id',
    'branch_generation','authority_epoch','repository_id','candidate_head','request_id'] }
});
const VALIDATION_RECORDS: Readonly<Record<string, Record<string, Validator>>> = {
  scope: scoped,
  source: { ...scoped, repository_id: uuid, source_object_id: oid },
  artifact: { ...identified, digest, size_bytes: nonnegative,
    storage_key: text(/^[^\x00-\x1f\x7f]+$/, 2048),
    status: enumValue('PENDING','COMPLETE','QUARANTINED','DELETED'),
    storage_backend: text(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/,64),
    retention_class: enumValue('EPHEMERAL','RUN','RELEASE','LEGAL_HOLD') },
  compute_token: { ...scoped, task_id: uuid, attempt_id: uuid, attempt_generation: generation,
    authority_epoch: uuid, sandbox_id: uuid, sandbox_boot_generation: generation },
  custody_token: { ...scoped, task_id: uuid, submission_id: uuid, custody_generation: generation, authority_epoch: uuid }
};
function parseFields(value: unknown, fields: Record<string, Validator>, required: string[]): Record<string, unknown> {
  const record = recordObject(value, 'record');
  for (const key of Object.keys(record))
    if (!Object.hasOwn(fields, key)) throw new AuthorityRecordError('Unknown record field: ' + key);
  for (const key of required)
    if (!Object.hasOwn(record, key)) throw new AuthorityRecordError('Missing record field: ' + key);
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fields[key]!(value, 'record.' + key)]));
}
export function parseCreateRecord(kind: unknown, value: unknown): { table: string; record: Record<string, unknown> } {
  if (typeof kind !== 'string' || !Object.hasOwn(CREATE_RECORDS, kind))
    throw new AuthorityRecordError('Unsupported creation record kind');
  const definition = CREATE_RECORDS[kind]!;
  return { table: definition.table, record: parseFields(value, definition.fields, definition.required) };
}
export function validateAuthorityRecord(kind: unknown, value: unknown): Record<string, unknown> {
  if (typeof kind !== 'string' || !Object.hasOwn(VALIDATION_RECORDS, kind))
    throw new AuthorityRecordError('Unsupported validation record kind');
  const fields = VALIDATION_RECORDS[kind]!;
  return parseFields(value, fields, Object.keys(fields));
}
export function operationInput(value: unknown): { kind: unknown; record: unknown } {
  const input = recordObject(value);
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input,'kind') || !Object.hasOwn(input,'record'))
    throw new AuthorityRecordError('Operation requires exactly kind and record');
  return { kind: input.kind, record: input.record };
}

// Persisted operational views use explicit keys rather than arbitrary JSON bags.
export interface ProviderPoolRecord {
  organisation_id: UUID; id: UUID; provider: string; account_key: string;
  environment_key: string; region: string; profile_id: UUID | null;
  state: 'ACTIVE' | 'DRAINING' | 'DISABLED'; state_version: Generation;
}
export interface ReservationRecord extends Scope {
  id: UUID; request_id: UUID; capacity_account_id: UUID; quantity: string;
  attempt_id: UUID | null; expires_at: string;
  state: 'PROVISIONING' | 'ALLOCATED' | 'RELEASE_PENDING' | 'RELEASED';
  released_at: string | null; release_reason: string | null; state_version: Generation;
}
export interface SandboxRecord {
  organisation_id: UUID; id: UUID; pool_id: UUID; native_sandbox_id: string | null;
  desired_state: 'RUNNING' | 'STOPPED' | 'DESTROYED';
  observed_state: 'UNKNOWN' | 'CREATING' | 'RUNNING' | 'SUSPENDED' | 'STOPPED' | 'DESTROYING' | 'DESTROYED' | 'FAILED';
  boot_generation: Generation; preparation_digest: Digest | null; state_version: Generation;
}
export interface WorkerSlotRecord {
  organisation_id: UUID; id: UUID; sandbox_id: UUID; slot_key: string; boot_generation: Generation;
  capacity_kind: 'AGENT' | 'BUILD' | 'TEST' | 'INDEX' | 'REVIEW' | 'INTEGRATION';
  state: 'READY' | 'ALLOCATED' | 'DRAINING' | 'RETIRED'; state_version: Generation;
}
export interface AgentSessionRecord extends Scope {
  id: UUID; role: 'LEADER' | 'FEATURE_MANAGER' | 'WORKER' | 'COMMIT_WATCHER' | 'ISSUE_WATCHER' | 'VERIFIER' | 'INTEGRATOR' | 'INDEXER';
  parent_session_id: UUID | null; connector: string; account_key: string; native_session_id: string;
  slot_id: UUID | null; sandbox_id: UUID | null; sandbox_boot_generation: Generation | null;
  attempt_id: UUID | null; state: 'REGISTERED' | 'RUNNING' | 'DISCONNECTED' | 'STOPPED' | 'FAILED'; state_version: Generation;
}
export interface GraphBuildRecord extends Scope {
  id: UUID; input_digest: Digest; source_manifest_digest: Digest; parser_digest: Digest;
  schema_digest: Digest; config_digest: Digest; parent_build_id: UUID | null;
  state: 'STAGING' | 'RESOLVING' | 'VALIDATING' | 'READY' | 'PUBLISHED' | 'FAILED'; state_version: Generation;
}
export interface GraphManifestRecord extends Scope {
  id: UUID; build_id: UUID; manifest_digest: Digest; source_manifest_digest: Digest;
  file_count: string; symbol_count: string; reference_count: string; edge_count: string; published_at: string;
}
export interface FindingRecord extends SourceReference {
  id: UUID; dedup_digest: Digest; owner_package_id: UUID; contract_id: UUID | null;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'; summary: string;
  state: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED'; state_version: Generation;
}
