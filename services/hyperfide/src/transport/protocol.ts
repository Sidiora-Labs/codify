import { createHash, createPublicKey, verify } from 'node:crypto';
import { FoundationError, object } from '../policy/programme.js';

export const PROTOCOL_VERSION = 1;
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_PAYLOAD_BYTES = 768 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DIGEST = /^sha256:[0-9a-f]{64}$/;
export const NAME = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
export interface Principal {
  readonly credential_id: string; readonly actor_id: string; readonly organisation_id: string;
  readonly run_id: string; readonly role: string; readonly credential_version: string;
  readonly deployment_epoch: string; readonly sandbox_id: string | null; readonly boot_id: string | null;
  readonly boot_generation: string | null; readonly attempt_id: string | null;
  readonly attempt_generation: string | null; readonly allowed_actions: readonly string[];
  readonly expires_at: string;
}
export interface Operation {
  readonly protocol_version: 1; readonly operation_id: string; readonly idempotency_key: string;
  readonly payload_digest: string; readonly correlation_id: string; readonly causation_id: string | null;
}
export interface InvokePayload {
  readonly run_id: string; readonly component: string; readonly action: string; readonly input: unknown;
  readonly expected_version: string | null; readonly authority: Readonly<Record<string, unknown>> | null;
}
export interface AuthorityTransaction { query(sql: string, values?: unknown[]): Promise<{rows: Record<string, any>[]; rowCount: number | null}> }
export interface InvocationContext {
  readonly principal: Principal; readonly operation: Operation; readonly payload: InvokePayload;
  readonly signal: AbortSignal;
  readonly guard: (tx: AuthorityTransaction) => Promise<void>;
  readonly continuationGuard:(tx:AuthorityTransaction,validatePersistedAdmission:(tx:AuthorityTransaction,invocation:InvocationContext)=>Promise<void>)=>Promise<void>;
  readonly identityGuard: (tx: AuthorityTransaction) => Promise<void>;
}
export interface EnrollmentPayload {
  run_id: string; provisioning_intent_id: string; sandbox_id: string;
  boot_generation: string; boot_id: string; public_key_b64: string;
}
export interface DecodedRequest<T> { operation: Operation; payload: T; raw: Buffer }
export interface Proof { id: string; time: string; nonce: string; signature: Buffer }
export function fail(code: string, message: string): never { throw new FoundationError(code, message); }
export function exact(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).length !== names.length ||
      names.some(name => !Object.hasOwn(value, name))) fail('INVALID_REQUEST', 'Fields differ from the versioned contract');
}
export function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
export function decimal(value: unknown, positive = false): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) &&
    BigInt(value) <= 9223372036854775807n && (!positive || value !== '0');
}
export function hash(bytes: Buffer | string): string { return 'sha256:' + createHash('sha256').update(bytes).digest('hex'); }
export function base64(value: unknown, size?: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1)
    fail('INVALID_ENCODING', 'Canonical unpadded base64url required');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || size !== undefined && bytes.length !== size)
    fail('INVALID_ENCODING', 'Noncanonical base64url or incorrect length');
  return bytes;
}
export function frozen<T>(value: T, depth = 0): T {
  if (depth > 64) fail('INVALID_REQUEST', 'JSON nesting exceeds limit');
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child, depth + 1);
    Object.freeze(value);
  }
  return value;
}
// Parse once, reject duplicate decoded keys and invalid UTF8 rather than silently accepting last-key wins.
export function strictJSON(bytes: Buffer, limit = MAX_BODY_BYTES): unknown {
  if (bytes.length > limit) fail('REQUEST_TOO_LARGE', 'Request exceeds byte limit');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return fail('INVALID_ENCODING', 'Request is not valid UTF8'); }
  let offset = 0, count = 0;
  const whitespace = (): void => { while (/[ \r\n\t]/.test(text[offset] ?? '\0')) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') { offset++; continue; }
      if (char === '"') {
        try { return JSON.parse(text.slice(start, offset)) as string; }
        catch { return fail('INVALID_JSON', 'Invalid JSON string'); }
      }
    }
    return fail('INVALID_JSON', 'Unterminated JSON string');
  };
  const parse = (depth: number): unknown => {
    if (depth > 64 || ++count > 20000) fail('INVALID_JSON', 'JSON structure exceeds limits');
    whitespace();
    const char = text[offset];
    if (char === '"') return string();
    if (char === '{') {
      offset++; whitespace();
      const result = Object.create(null) as Record<string, unknown>, keys = new Set<string>();
      if (text[offset] === '}') { offset++; return result; }
      while (true) {
        whitespace(); if (text[offset] !== '"') fail('INVALID_JSON', 'Object key required');
        const key = string(); if (keys.has(key)) fail('INVALID_JSON', 'Duplicate JSON key');
        keys.add(key); whitespace(); if (text[offset++] !== ':') fail('INVALID_JSON', 'Object separator required');
        result[key] = parse(depth + 1); whitespace();
        const end = text[offset++]; if (end === '}') return result;
        if (end !== ',') fail('INVALID_JSON', 'Object delimiter required');
      }
    }
    if (char === '[') {
      offset++; whitespace(); const result: unknown[] = [];
      if (text[offset] === ']') { offset++; return result; }
      while (true) {
        result.push(parse(depth + 1)); whitespace(); const end = text[offset++];
        if (end === ']') return result; if (end !== ',') fail('INVALID_JSON', 'Array delimiter required');
      }
    }
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return value; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(offset));
    if (!number) fail('INVALID_JSON', 'Invalid JSON value');
    offset += number[0].length; const value = Number(number[0]);
    if (!Number.isFinite(value)) fail('INVALID_JSON', 'Nonfinite number is not supported');
    return value;
  };
  const result = parse(0); whitespace();
  if (offset !== text.length) fail('INVALID_JSON', 'Trailing JSON data');
  return result;
}
export function canonicalOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || /[^\x21-\x7e]/.test(value))
    return fail('TRANSPORT_CONFIG', 'Canonical ASCII HTTPS origin required');
  let url: URL;
  try { url = new URL(value); } catch { return fail('TRANSPORT_CONFIG', 'Invalid HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.origin !== value ||
      url.pathname !== '/' || url.search || url.hash) fail('TRANSPORT_CONFIG', 'Canonical HTTPS origin required');
  return value;
}
function envelope(raw: Buffer): DecodedRequest<unknown> {
  const value = strictJSON(raw);
  exact(value, ['protocol_version','operation_id','idempotency_key','payload_digest','correlation_id','causation_id','payload_b64']);
  if (value.protocol_version !== 1) fail('PROTOCOL_UNSUPPORTED', 'Unsupported protocol version');
  if (!uuid(value.operation_id) || !uuid(value.idempotency_key) || !uuid(value.correlation_id) ||
      value.causation_id !== null && !uuid(value.causation_id) ||
      typeof value.payload_digest !== 'string' || !DIGEST.test(value.payload_digest))
    fail('INVALID_REQUEST', 'Invalid operation identity or digest');
  const bytes = base64(value.payload_b64);
  if (bytes.length > MAX_PAYLOAD_BYTES) fail('REQUEST_TOO_LARGE', 'Payload exceeds byte limit');
  if (hash(bytes) !== value.payload_digest) fail('PAYLOAD_DIGEST_MISMATCH', 'Payload digest mismatch');
  const operation: Operation = frozen({ protocol_version: 1, operation_id: value.operation_id,
    idempotency_key: value.idempotency_key, payload_digest: value.payload_digest,
    correlation_id: value.correlation_id, causation_id: value.causation_id as string | null });
  return { operation, payload: strictJSON(bytes, MAX_PAYLOAD_BYTES), raw };
}
export function decodeInvoke(raw: Buffer): DecodedRequest<InvokePayload> {
  const decoded = envelope(raw), value = decoded.payload;
  exact(value, ['run_id','component','action','input','expected_version','authority']);
  if (!uuid(value.run_id) || typeof value.component !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.component) ||
      typeof value.action !== 'string' || !NAME.test(value.action) ||
      value.expected_version !== null && !decimal(value.expected_version) ||
      value.authority !== null && !object(value.authority))
    fail('INVALID_REQUEST', 'Invalid invocation scope or operation');
  if (value.authority !== null) {
    exact(value.authority, ['deployment_epoch','attempt_id','attempt_generation','sandbox_id','boot_generation']);
    if (!uuid(value.authority.deployment_epoch) || !uuid(value.authority.attempt_id) ||
        !uuid(value.authority.sandbox_id) || !decimal(value.authority.attempt_generation, true) ||
        !decimal(value.authority.boot_generation, true)) fail('INVALID_REQUEST', 'Invalid authority generation');
  }
  return { ...decoded, payload: frozen(value as unknown as InvokePayload) };
}
export function decodeEnrollment(raw: Buffer): DecodedRequest<EnrollmentPayload> {
  const decoded = envelope(raw), value = decoded.payload;
  exact(value, ['run_id','provisioning_intent_id','sandbox_id','boot_generation','boot_id','public_key_b64']);
  if (!uuid(value.run_id) || !uuid(value.provisioning_intent_id) || !uuid(value.sandbox_id) ||
      !uuid(value.boot_id) || !decimal(value.boot_generation, true)) fail('INVALID_REQUEST', 'Invalid enrollment binding');
  base64(value.public_key_b64, 32);
  return { ...decoded, payload: frozen(value as unknown as EnrollmentPayload) };
}
export function proof(headers: readonly string[], enrollment = false): Proof {
  const found = new Map<string, string>();
  for (let index = 0; index < headers.length; index += 2) {
    const name = headers[index]!.toLowerCase(), value = headers[index + 1]!;
    if (!name.startsWith('hf-') && name !== 'authorization') continue;
    if (found.has(name)) fail('AUTH_INVALID', 'Duplicate authentication header');
    found.set(name, value);
  }
  const allowed = new Set(['hf-request-time','hf-request-nonce','hf-request-signature',
    enrollment ? 'authorization' : 'hf-credential-id']);
  if ([...found.keys()].some(name => !allowed.has(name))) fail('AUTH_INVALID', 'Unknown authentication header');
  const time = found.get('hf-request-time'), nonce = found.get('hf-request-nonce');
  if (!time || !/^[1-9][0-9]{0,11}$/.test(time) || !uuid(nonce)) fail('AUTH_INVALID', 'Invalid request proof');
  let id = found.get('hf-credential-id');
  if (enrollment) {
    const grant = /^HyperfideGrant ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(found.get('authorization') ?? '');
    if (!grant || !uuid(grant[1])) fail('AUTH_INVALID', 'Enrollment grant required');
    base64(grant[2], 32); id = grant[1];
  }
  if (!uuid(id)) fail('AUTH_INVALID', 'Invalid credential identity');
  return { id, time, nonce, signature: base64(found.get('hf-request-signature'), 64) };
}
export function enrollmentSecret(headers: readonly string[]): Buffer {
  const index = headers.findIndex((name, i) => i % 2 === 0 && name.toLowerCase() === 'authorization');
  const match = /^HyperfideGrant [0-9a-f-]{36}\.([A-Za-z0-9_-]{43})$/.exec(headers[index + 1] ?? '');
  return base64(match?.[1], 32);
}
export function signingBytes(origin: string, endpoint: '/v1/invoke' | '/v1/enroll', item: Omit<Proof,'signature'>, body: Buffer): Buffer {
  const domain = endpoint === '/v1/enroll' ? 'HYPERFIDE-ENROLL-V1' : 'HYPERFIDE-REQUEST-V1';
  return Buffer.from([domain,'POST',endpoint,canonicalOrigin(origin),item.id,item.time,item.nonce,hash(body),''].join('\n'), 'utf8');
}
export function verifyProof(publicKey: string, item: Proof, origin: string, endpoint: '/v1/invoke' | '/v1/enroll', body: Buffer): void {
  const raw = base64(publicKey, 32);
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100','hex'), raw]), format: 'der', type: 'spki' });
  if (!verify(null, signingBytes(origin, endpoint, item, body), key, item.signature))
    fail('AUTH_INVALID', 'Request proof is invalid');
}

// Only genuine authenticated invocations can cross component capability boundaries.
const authenticatedInvocations=new WeakSet<object>();
export function authenticatedInvocation(value:InvocationContext):InvocationContext {
 const result=Object.freeze(value);authenticatedInvocations.add(result);return result;
}
export function assertInvocation(value:unknown):asserts value is InvocationContext {
 if(!object(value)||!authenticatedInvocations.has(value))fail('AUTH_REQUIRED','Verified authenticated invocation required');
}
