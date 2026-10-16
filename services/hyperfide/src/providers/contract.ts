import { createHash } from 'node:crypto';
import type { Component, ComponentContext } from '../components/registry.js';

/** Contract checks compare declared observations. Only the later authenticated
 * coordinator can admit work or authenticate live qualification provenance. */
const boundary = Object.freeze({ authority: 'NONE', live_qualification: 'NOT_EVALUATED' } as const);
export const CAPABILITY_NAMES = [
  'prepare','create','list','observe','attach','execute','inspect','stop','transfer','lifetime','destroy',
  'stdin','disk_snapshot','memory_snapshot','network_isolated','network_private','public_ingress',
  'persistent_storage','shared_storage',
] as const;
export type CapabilityName = typeof CAPABILITY_NAMES[number];
export const PROVIDER_METHODS = [
  'capabilities','prepare','create','list','observe','attach','execute','inspect','stop','transfer','lifetime','destroy',
] as const;
export type ProviderMethod = typeof PROVIDER_METHODS[number];
type Digest = string;
type OS = { distribution: string; version: string; architecture: string };
export interface ProviderScope {
  organisation_id: string; pool_id: string; provider: 'railway'|'blaxel'; provider_account_id: string;
  environment_id: string; region: string; configuration_digest: Digest;
}
export interface ResourceRef { native_sandbox_id: string; sandbox_boot_generation: string }
export interface ResourceVector {
  cpu_millis: number; memory_bytes: string; disk_bytes: string; persistent_volume_bytes: string;
}
export interface CapabilityProfile {
  schema_version: 1; scope: ProviderScope;
  pin: { sdk_name: string; sdk_version: string; sdk_integrity: string; api_revision: string };
  observed_at: string; expires_at: string; preparation_digest: Digest; os: OS;
  capabilities: Array<{ name: CapabilityName; support: 'SUPPORTED'|'UNSUPPORTED'|'UNKNOWN';
    availability: 'ENABLED'|'DISABLED'|'UNKNOWN'; basis: 'DOCUMENTED'|'OBSERVED'|'LIVE_QUALIFIED';
    evidence_digest: Digest|null }>;
}
export type ProviderState = 'CREATING'|'RUNNING'|'STOPPED'|'DESTROYING'|'DESTROYED'|'FAILED'|'UNKNOWN';
export interface InventoryPage {
  scope: ProviderScope; requested_cursor: string|null; next_cursor: string|null; has_more: boolean; complete: boolean;
  consistency: 'BEST_EFFORT'|'SNAPSHOT'; snapshot_id: string|null; observed_at: string;
  items: Array<{ native_sandbox_id: string; provider_state: ProviderState }>;
}
export interface ProviderParameters {
  capabilities: Record<string, never>;
  prepare: { image_reference: string; recipe_digest: Digest; os: OS };
  create: { preparation_reference: string; resources: ResourceVector; network: 'ISOLATED'|'PRIVATE'; stdin_required: boolean };
  list: { cursor: string|null; page_size: number };
  observe: Record<string, never>;
  attach: { process_ref: string; resume_cursor: string|null };
  execute: { argv: string[]; cwd: string; env_refs: Record<string,string>; stdin: boolean; durable: boolean;
    process_timeout_ms: number|null; wait_timeout_ms: number };
  inspect: { process_ref: string };
  stop: { process_ref: string; signal: 'TERM'|'KILL' };
  transfer: { direction: 'UPLOAD'|'DOWNLOAD'; path: string; artifact_digest: Digest; byte_count: string };
  lifetime: { policy: 'NO_IDLE_EXPIRY'|'BOUNDED'; timeout_ms: number|null };
  destroy: { reason: string };
}
export type ProviderOperation<K extends ProviderMethod = ProviderMethod> = {
  [M in K]: { schema_version: 1; kind: M; scope: ProviderScope; deadline_at: string;
    identity: { operation_id: string; idempotency_key: string; payload_digest: Digest; correlation_id: string; causation_id: string };
    resource: ResourceRef|null; preparation_digest: Digest|null; parameters: ProviderParameters[M] }
}[K];
export interface ProcessResult {
  process_ref: string; phase: 'STARTED'|'EXITED'; exit_code: number|null; timed_out: boolean; termination_confirmed: boolean;
  output: { complete: boolean; truncated: boolean; byte_count: string; sha256: Digest|null };
}
export interface ProviderResults {
  capabilities: { profile: CapabilityProfile };
  prepare: { preparation_reference: string; preparation_digest: Digest };
  create: { provider_state: 'CREATING'|'RUNNING' };
  list: { page: InventoryPage };
  observe: { provider_state: ProviderState; health: 'HEALTHY'|'SUSPECT'|'UNKNOWN'|'ABSENT' };
  attach: ProcessResult; execute: ProcessResult; inspect: ProcessResult;
  stop: { process_ref: string; termination: 'CONFIRMED'; exit_code: number };
  transfer: { artifact_digest: Digest; byte_count: string; complete: true };
  lifetime: ProviderParameters['lifetime'];
  destroy: { deletion: 'CONFIRMED' };
}
export type ErrorCode = 'AUTHENTICATION'|'AUTHORIZATION'|'RATE_LIMIT'|'NOT_FOUND'|'CONFLICT'|'INVALID_REQUEST'|
  'UNAVAILABLE'|'TIMEOUT'|'PROTOCOL'|'INTERNAL'|'UNSUPPORTED';
export interface ProviderError { code: ErrorCode; provider_code: string|null; message: string; retry_after_ms: number|null }
interface OutcomeIdentity {
  schema_version: 1; operation_id: string; payload_digest: Digest; scope: ProviderScope;
  observed_at: string; provider_request_id: string|null; resource: ResourceRef|null;
}
export type ProviderOutcome<K extends ProviderMethod = ProviderMethod> = OutcomeIdentity & (
  {status:'SUCCEEDED';acceptance:'CONFIRMED_ACCEPTED';result:ProviderResults[K];error:null;
    reconcile_required:false;retry:'NEVER'} |
  {status:'FAILED';acceptance:'CONFIRMED_REJECTED';result:null;
    error:ProviderError & {code:Exclude<ErrorCode,'UNSUPPORTED'>};reconcile_required:false;retry:'NEVER'|'BOUNDED'} |
  {status:'UNKNOWN';acceptance:'UNKNOWN';result:null;
    error:ProviderError & {code:Exclude<ErrorCode,'UNSUPPORTED'>};reconcile_required:true;retry:'AFTER_RECONCILIATION'} |
  {status:'UNSUPPORTED';acceptance:'CONFIRMED_REJECTED';result:null;
    error:ProviderError & {code:'UNSUPPORTED'};reconcile_required:false;retry:'NEVER'}
);
/**
 * Create returns at confirmed provider acceptance/CREATING, retaining the early
 * external ID before readiness polling. Later observe can report FAILED while
 * that resource remains inventoried. SUCCEEDED is an operation observation,
 * never worker readiness, successful code execution, or accepted evidence.
 * Adapters enforce the persisted deadline, retain provider request IDs when
 * available, and reconcile late responses without discarding known resources.
 * Adapter methods preserve provider observations, not database ownership.
 * Implementations must persist an intent before side effects outside this module,
 * retain early returned IDs, and resolve uncertain acceptance before replay. */
export type ProviderAdapter = {
  readonly provider: ProviderScope['provider'];
} & { [M in ProviderMethod]: (operation: ProviderOperation<M>, signal?: AbortSignal) => Promise<ProviderOutcome<M>> };

type Obj = Record<string, unknown>;
const scopeKeys = ['organisation_id','pool_id','provider','provider_account_id','environment_id','region','configuration_digest'];
const states = ['CREATING','RUNNING','STOPPED','DESTROYING','DESTROYED','FAILED','UNKNOWN'];
const methods = new Set<string>(PROVIDER_METHODS);
const capabilityNames = new Set<string>(CAPABILITY_NAMES);
const mutations = new Set<ProviderMethod>(['prepare','create','execute','stop','transfer','lifetime','destroy']);
const errorCodes = ['AUTHENTICATION','AUTHORIZATION','RATE_LIMIT','NOT_FOUND','CONFLICT','INVALID_REQUEST',
  'UNAVAILABLE','TIMEOUT','PROTOCOL','INTERNAL','UNSUPPORTED'];
function invalid(): never { throw new Error('Provider contract input is invalid'); }
function object(value: unknown): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value))) invalid();
  return value as Obj;
}
function shape(value: unknown, keys: readonly string[]): Obj {
  const out = object(value);
  if (Object.keys(out).length !== keys.length || keys.some(key => !Object.hasOwn(out,key))) invalid();
  return out;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) invalid();
  return value;
}
function identifier(value: unknown): string {
  const out = text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(out)) invalid();
  return out;
}
// Cursors and external identities are opaque provider data, including base64
// padding. They are never parsed as paths, authority, or logical identity.
function opaque(value: unknown): string { return text(value,2048); }
function nullableOpaque(value: unknown): string|null { return value === null ? null : opaque(value); }
function enumeration(value: unknown, values: readonly string[]): string {
  if (typeof value !== 'string' || !values.includes(value)) invalid();
  return value;
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid();
  return value;
}
function decimal(value: unknown, positive = false): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
      BigInt(value) > 9223372036854775807n || (positive && value === '0')) invalid();
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) invalid();
  return value;
}
function nullableDigest(value: unknown): string|null { return value === null ? null : digest(value); }
function instant(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid();
  const number = Date.parse(value);
  if (!Number.isFinite(number) || new Date(number).toISOString() !== value) invalid();
  return number;
}
function os(value: unknown): OS {
  const v = shape(value,['distribution','version','architecture']);
  for (const key of ['distribution','version','architecture']) text(v[key],128);
  return v as unknown as OS;
}
function scope(value: unknown): ProviderScope {
  const v = shape(value,scopeKeys);
  enumeration(v.provider,['railway','blaxel']);
  for (const key of ['organisation_id','pool_id']) identifier(v[key]);
  for (const key of ['provider_account_id','environment_id','region']) opaque(v[key]);
  digest(v.configuration_digest);
  return v as unknown as ProviderScope;
}
function resource(value: unknown): ResourceRef {
  const v = shape(value,['native_sandbox_id','sandbox_boot_generation']);
  opaque(v.native_sandbox_id); decimal(v.sandbox_boot_generation,true);
  return v as unknown as ResourceRef;
}
function absolutePath(value: unknown): string {
  const v = text(value,4096);
  if (!v.startsWith('/') || v.includes('\\') || v.split('/').includes('..')) invalid();
  return v;
}
function list(value: unknown, maximum = 1000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) invalid();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    integer(value,Number.MIN_SAFE_INTEGER);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + list(value,4096).map(item => canonical(item,depth+1)).join(',') + ']';
  const v = object(value);
  const keys = Object.keys(v).sort();
  if (keys.length > 1000 || keys.some(key => ['__proto__','constructor','prototype'].includes(key))) invalid();
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonical(v[key],depth+1)).join(',') + '}';
}
function same(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
function integrity(value: unknown): void {
  if (typeof value !== 'string') invalid();
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) invalid();
  const bytes = Buffer.from(match[2]!,'base64');
  if (bytes.toString('base64') !== match[2] || bytes.length !== {sha256:32,sha384:48,sha512:64}[match[1] as 'sha256'|'sha384'|'sha512']) invalid();
}
export function validateCapabilityProfile(value: unknown): CapabilityProfile {
  const p = shape(value,['schema_version','scope','pin','observed_at','expires_at','preparation_digest','os','capabilities']);
  if (p.schema_version !== 1) invalid();
  scope(p.scope); digest(p.preparation_digest); os(p.os);
  if (instant(p.observed_at) >= instant(p.expires_at)) invalid();
  const pin = shape(p.pin,['sdk_name','sdk_version','sdk_integrity','api_revision']);
  text(pin.sdk_name); identifier(pin.api_revision); integrity(pin.sdk_integrity);
  if (typeof pin.sdk_version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(pin.sdk_version)) invalid();
  const names = new Set<string>();
  for (const entry of list(p.capabilities,CAPABILITY_NAMES.length)) {
    const cap = shape(entry,['name','support','availability','basis','evidence_digest']);
    const name = enumeration(cap.name,CAPABILITY_NAMES);
    if (names.has(name)) invalid();
    names.add(name);
    enumeration(cap.support,['SUPPORTED','UNSUPPORTED','UNKNOWN']);
    enumeration(cap.availability,['ENABLED','DISABLED','UNKNOWN']);
    enumeration(cap.basis,['DOCUMENTED','OBSERVED','LIVE_QUALIFIED']);
    nullableDigest(cap.evidence_digest);
    if (cap.basis !== 'DOCUMENTED' && cap.evidence_digest === null) invalid();
  }
  return p as unknown as CapabilityProfile;
}
export function evaluateCapabilities(value: unknown): unknown {
  const v = shape(value,['profile','requirements','evaluated_at']);
  const profile = validateCapabilityProfile(v.profile);
  const required = shape(v.requirements,['capabilities','preparation_digest','os']);
  digest(required.preparation_digest); os(required.os);
  const requested = list(required.capabilities,CAPABILITY_NAMES.length);
  if (!requested.length) invalid();
  const seen = new Set<string>();
  for (const name of requested) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name) || seen.has(name)) invalid();
    seen.add(name);
  }
  const time = instant(v.evaluated_at);
  const reasons: Array<{capability:string|null;code:string}> = [];
  const add = (capability:string|null,code:string) => reasons.push({capability,code});
  if (time < instant(profile.observed_at)) add(null,'FUTURE_OBSERVATION');
  if (time >= instant(profile.expires_at)) add(null,'EXPIRED_CAPABILITIES');
  if (required.preparation_digest !== profile.preparation_digest) add(null,'PREPARATION_MISMATCH');
  if (!same(required.os,profile.os)) add(null,'OS_MISMATCH');
  for (const name of seen) {
    if (!capabilityNames.has(name)) { add(name,'UNKNOWN_CAPABILITY'); continue; }
    const cap = profile.capabilities.find(item => item.name === name);
    if (!cap) { add(name,'MISSING_CAPABILITY'); continue; }
    if (cap.support === 'UNSUPPORTED') add(name,'UNSUPPORTED_CAPABILITY');
    if (cap.support === 'UNKNOWN') add(name,'UNKNOWN_SUPPORT');
    if (cap.availability === 'DISABLED') add(name,'CAPABILITY_DISABLED');
    if (cap.availability === 'UNKNOWN') add(name,'UNKNOWN_AVAILABILITY');
    if (cap.basis !== 'LIVE_QUALIFIED') add(name,'UNQUALIFIED_CAPABILITY');
  }
  return {candidate_compatible:reasons.length === 0,reasons,...boundary};
}
/** Identity fields are excluded from the payload digest so an idempotency key
 * can bind a stable request. Durable key-conflict enforcement belongs to storage. */
export function operationPayloadDigest(operation: Pick<ProviderOperation,'kind'|'scope'|'deadline_at'|'resource'|'preparation_digest'|'parameters'>): Digest {
  return 'sha256:' + createHash('sha256').update(canonical({
    kind:operation.kind,scope:operation.scope,deadline_at:operation.deadline_at,resource:operation.resource,
    preparation_digest:operation.preparation_digest,parameters:operation.parameters,
  })).digest('hex');
}
function parameters(kind: ProviderMethod, input: unknown): Obj {
  let p: Obj;
  switch (kind) {
    case 'capabilities': case 'observe': return shape(input,[]);
    case 'prepare':
      p=shape(input,['image_reference','recipe_digest','os']); text(p.image_reference,2048); digest(p.recipe_digest); os(p.os); break;
    case 'create': {
      p=shape(input,['preparation_reference','resources','network','stdin_required']); text(p.preparation_reference,2048);
      const r=shape(p.resources,['cpu_millis','memory_bytes','disk_bytes','persistent_volume_bytes']);
      integer(r.cpu_millis,1); decimal(r.memory_bytes,true); decimal(r.disk_bytes); decimal(r.persistent_volume_bytes);
      enumeration(p.network,['ISOLATED','PRIVATE']); boolean(p.stdin_required); break;
    }
    case 'list':
      p=shape(input,['cursor','page_size']); nullableOpaque(p.cursor); integer(p.page_size,1,1000); break;
    case 'attach':
      p=shape(input,['process_ref','resume_cursor']); opaque(p.process_ref); nullableOpaque(p.resume_cursor); break;
    case 'execute': {
      p=shape(input,['argv','cwd','env_refs','stdin','durable','process_timeout_ms','wait_timeout_ms']);
      const argv=list(p.argv,256); if (!argv.length) invalid();
      for (let i=0;i<argv.length;i++) {
        const arg=argv[i];
        if (typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0') || (i === 0 && !arg.length)) invalid();
      }
      absolutePath(p.cwd);
      const env=object(p.env_refs); if (Object.keys(env).length > 128) invalid();
      for (const [key,ref] of Object.entries(env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof ref !== 'string' ||
            !/^secret-ref:[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(ref)) invalid();
      }
      boolean(p.stdin); boolean(p.durable);
      if (p.process_timeout_ms !== null) integer(p.process_timeout_ms,1);
      integer(p.wait_timeout_ms,1); break;
    }
    case 'inspect':
      p=shape(input,['process_ref']); opaque(p.process_ref); break;
    case 'stop':
      p=shape(input,['process_ref','signal']); opaque(p.process_ref); enumeration(p.signal,['TERM','KILL']); break;
    case 'transfer':
      p=shape(input,['direction','path','artifact_digest','byte_count']); enumeration(p.direction,['UPLOAD','DOWNLOAD']);
      absolutePath(p.path); digest(p.artifact_digest); decimal(p.byte_count); break;
    case 'lifetime':
      p=shape(input,['policy','timeout_ms']); enumeration(p.policy,['NO_IDLE_EXPIRY','BOUNDED']);
      if (p.policy === 'NO_IDLE_EXPIRY') { if (p.timeout_ms !== null) invalid(); } else integer(p.timeout_ms,1);
      break;
    case 'destroy': p=shape(input,['reason']); text(p.reason,1024); break;
  }
  return p;
}
export function validateProviderOperation(value: unknown): ProviderOperation {
  const o=shape(value,['schema_version','kind','scope','deadline_at','identity','resource','preparation_digest','parameters']);
  if (o.schema_version !== 1 || typeof o.kind !== 'string' || !methods.has(o.kind)) invalid();
  const kind=o.kind as ProviderMethod;
  scope(o.scope); instant(o.deadline_at);
  const id=shape(o.identity,['operation_id','idempotency_key','payload_digest','correlation_id','causation_id']);
  for (const key of ['operation_id','idempotency_key','correlation_id','causation_id']) identifier(id[key]);
  digest(id.payload_digest);
  if (['capabilities','prepare','create','list'].includes(kind)) { if (o.resource !== null) invalid(); }
  else resource(o.resource);
  nullableDigest(o.preparation_digest);
  if (['prepare','create'].includes(kind) && o.preparation_digest === null) invalid();
  const p=parameters(kind,o.parameters);
  if (kind === 'prepare' && p.recipe_digest !== o.preparation_digest) invalid();
  const operation=o as unknown as ProviderOperation;
  if (id.payload_digest !== operationPayloadDigest(operation)) invalid();
  return operation;
}
function inventoryPage(value: unknown): InventoryPage {
  const p=shape(value,['scope','requested_cursor','next_cursor','has_more','complete','consistency','snapshot_id','observed_at','items']);
  scope(p.scope); nullableOpaque(p.requested_cursor); nullableOpaque(p.next_cursor);
  boolean(p.has_more); boolean(p.complete); enumeration(p.consistency,['BEST_EFFORT','SNAPSHOT']);
  nullableOpaque(p.snapshot_id); instant(p.observed_at);
  if ((p.consistency === 'SNAPSHOT') !== (p.snapshot_id !== null) ||
      (p.has_more && (p.next_cursor === null || p.complete)) || (!p.has_more && p.next_cursor !== null)) invalid();
  const ids=new Set<string>();
  for (const raw of list(p.items)) {
    const item=shape(raw,['native_sandbox_id','provider_state']); const id=opaque(item.native_sandbox_id);
    enumeration(item.provider_state,states); if (ids.has(id)) invalid(); ids.add(id);
  }
  return p as unknown as InventoryPage;
}
export function validateInventory(value: unknown): unknown {
  const v=shape(value,['scope','pages','evaluated_at']); scope(v.scope);
  const time=instant(v.evaluated_at); const pages=list(v.pages,1000).map(inventoryPage);
  if (!pages.length) invalid();
  const ids=new Set<string>(), cursors=new Set<string>(); let previousTime=-Infinity;
  for (let i=0;i<pages.length;i++) {
    const page=pages[i]!, first=pages[0]!;
    if (!same(page.scope,v.scope) || page.consistency !== first.consistency || page.snapshot_id !== first.snapshot_id ||
        (i === 0 ? page.requested_cursor !== null : page.requested_cursor !== pages[i-1]!.next_cursor) ||
        instant(page.observed_at) < previousTime || instant(page.observed_at) > time) invalid();
    if (i < pages.length-1 && (!page.has_more || page.complete)) invalid();
    previousTime=instant(page.observed_at);
    if (page.next_cursor !== null) { if (cursors.has(page.next_cursor)) invalid(); cursors.add(page.next_cursor); }
    for (const item of page.items) { if (ids.has(item.native_sandbox_id)) invalid(); ids.add(item.native_sandbox_id); }
  }
  const last=pages.at(-1)!;
  const complete=!last.has_more && last.complete;
  return {valid:true,enumeration_complete:complete,absence_evidence_eligible:complete && last.consistency === 'SNAPSHOT',
    absence_authorized:false,resource_count:ids.size,...boundary};
}
function processResult(value: unknown): ProcessResult {
  const p=shape(value,['process_ref','phase','exit_code','timed_out','termination_confirmed','output']);
  opaque(p.process_ref); enumeration(p.phase,['STARTED','EXITED']); boolean(p.timed_out); boolean(p.termination_confirmed);
  if (p.phase === 'STARTED') {
    if (p.exit_code !== null || p.timed_out || p.termination_confirmed) invalid();
  } else { integer(p.exit_code,Number.MIN_SAFE_INTEGER); if (!p.termination_confirmed) invalid(); }
  const out=shape(p.output,['complete','truncated','byte_count','sha256']);
  boolean(out.complete); boolean(out.truncated); decimal(out.byte_count); nullableDigest(out.sha256);
  if ((out.complete && (out.truncated || out.sha256 === null)) || (p.phase === 'STARTED' && out.complete)) invalid();
  return p as unknown as ProcessResult;
}
function successResult(op: ProviderOperation, value: unknown): void {
  let r:Obj;
  switch(op.kind) {
    case 'capabilities':
      r=shape(value,['profile']);
      const profile=validateCapabilityProfile(r.profile);
      if (!same(profile.scope,op.scope)) invalid(); break;
    case 'prepare':
      r=shape(value,['preparation_reference','preparation_digest']); text(r.preparation_reference,2048); digest(r.preparation_digest);
      if (r.preparation_digest !== op.preparation_digest) invalid(); break;
    case 'create':
      r=shape(value,['provider_state']); enumeration(r.provider_state,['CREATING','RUNNING']); break;
    case 'list': {
      r=shape(value,['page']); const page=inventoryPage(r.page);
      if (!same(page.scope,op.scope) || page.requested_cursor !== op.parameters.cursor || page.items.length > op.parameters.page_size) invalid();
      break;
    }
    case 'observe':
      r=shape(value,['provider_state','health']); enumeration(r.provider_state,states); enumeration(r.health,['HEALTHY','SUSPECT','UNKNOWN','ABSENT']);
      if (r.health === 'ABSENT' && r.provider_state !== 'DESTROYED') invalid(); break;
    case 'execute': case 'attach': case 'inspect': {
      const process=processResult(value);
      if (op.kind !== 'execute' && process.process_ref !== op.parameters.process_ref) invalid();
      break;
    }
    case 'stop':
      r=shape(value,['process_ref','termination','exit_code']); opaque(r.process_ref);
      if (r.process_ref !== op.parameters.process_ref || r.termination !== 'CONFIRMED') invalid();
      integer(r.exit_code,Number.MIN_SAFE_INTEGER); break;
    case 'transfer':
      r=shape(value,['artifact_digest','byte_count','complete']); digest(r.artifact_digest); decimal(r.byte_count);
      if (r.artifact_digest !== op.parameters.artifact_digest || r.byte_count !== op.parameters.byte_count || r.complete !== true) invalid(); break;
    case 'lifetime': r=parameters('lifetime',value); if (!same(r,op.parameters)) invalid(); break;
    case 'destroy': r=shape(value,['deletion']); if (r.deletion !== 'CONFIRMED') invalid(); break;
  }
}
export function validateProviderOutcome(value: unknown): unknown {
  const v=shape(value,['operation','outcome']); const op=validateProviderOperation(v.operation);
  const o=shape(v.outcome,['schema_version','status','acceptance','operation_id','payload_digest','scope','observed_at',
    'provider_request_id','resource','result','error','reconcile_required','retry']);
  if (o.schema_version !== 1) invalid();
  enumeration(o.status,['SUCCEEDED','FAILED','UNKNOWN','UNSUPPORTED']);
  enumeration(o.acceptance,['CONFIRMED_ACCEPTED','CONFIRMED_REJECTED','UNKNOWN']);
  enumeration(o.retry,['NEVER','BOUNDED','AFTER_RECONCILIATION']); boolean(o.reconcile_required);
  scope(o.scope); instant(o.observed_at); nullableOpaque(o.provider_request_id);
  if (o.operation_id !== op.identity.operation_id || o.payload_digest !== op.identity.payload_digest || !same(o.scope,op.scope)) invalid();
  if (o.resource !== null) resource(o.resource);
  if (op.resource !== null && !same(o.resource,op.resource)) invalid();
  if (op.resource === null && op.kind !== 'create' && o.resource !== null) invalid();
  if (o.status === 'SUCCEEDED') {
    if (o.acceptance !== 'CONFIRMED_ACCEPTED' || o.error !== null || o.result === null || o.reconcile_required || o.retry !== 'NEVER' ||
        (op.kind === 'create' && o.resource === null)) invalid();
    successResult(op,o.result);
    // A successful wrapper cannot make a later observation exist in its past.
    if (op.kind === 'capabilities') {
      const profile=(o.result as ProviderResults['capabilities']).profile;
      if (instant(profile.observed_at) > instant(o.observed_at) || instant(profile.expires_at) <= instant(o.observed_at)) invalid();
      if (op.preparation_digest !== null && profile.preparation_digest !== op.preparation_digest) invalid();
    }
    if (op.kind === 'list' && instant((o.result as ProviderResults['list']).page.observed_at) > instant(o.observed_at)) invalid();
  } else {
    if (o.result !== null) invalid();
    const e=shape(o.error,['code','provider_code','message','retry_after_ms']);
    enumeration(e.code,errorCodes); nullableOpaque(e.provider_code); text(e.message,1024);
    if (e.retry_after_ms !== null) { integer(e.retry_after_ms); if (e.code !== 'RATE_LIMIT') invalid(); }
    if (o.status === 'UNKNOWN') {
      if (o.acceptance !== 'UNKNOWN' || !o.reconcile_required || o.retry !== 'AFTER_RECONCILIATION' || e.code === 'UNSUPPORTED') invalid();
    } else {
      if (o.acceptance !== 'CONFIRMED_REJECTED' || o.reconcile_required || o.retry === 'AFTER_RECONCILIATION') invalid();
      if (o.status === 'UNSUPPORTED') {
        if (e.code !== 'UNSUPPORTED' || o.retry !== 'NEVER') invalid();
      } else {
        if (e.code === 'UNSUPPORTED' || (o.retry === 'BOUNDED' && !['RATE_LIMIT','UNAVAILABLE'].includes(e.code as string))) invalid();
      }
      if (op.resource === null && o.resource !== null) invalid();
    }
  }
  const dispositions={SUCCEEDED:'ACCEPT_OBSERVATION',FAILED:'RECORD_FAILURE',UNKNOWN:'RECONCILE',UNSUPPORTED:'REFUSE_UNSUPPORTED'} as const;
  return {valid:true,status:o.status,disposition:dispositions[o.status as keyof typeof dispositions],
    resource_observation_only:true,...boundary};
}
export function createComponent(_context: ComponentContext): Component {
  return {apiVersion:1,actions:{
    'provider.contract.describe': input => {
      shape(input,[]);
      return {schema_version:1,provider_contract_version:1,methods:[...PROVIDER_METHODS],capability_names:[...CAPABILITY_NAMES],...boundary};
    },
    'provider.capabilities.check': input => evaluateCapabilities(input),
    'provider.operation.validate': input => {
      const op=validateProviderOperation(input);
      return {valid:true,operation_id:op.identity.operation_id,kind:op.kind,payload_digest:op.identity.payload_digest,
        requires_reconciliation_before_retry:mutations.has(op.kind),...boundary};
    },
    'provider.outcome.validate': input => validateProviderOutcome(input),
    'provider.inventory.validate': input => validateInventory(input),
  }};
}
