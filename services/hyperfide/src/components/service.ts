import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundationError, object, validatePolicy } from '../policy/programme.js';
import type { ServiceRole } from '../policy/programme.js';
import { ComponentRegistry } from './registry.js';

const MAX_BYTES = 1024 * 1024;
const HARD_PROTOCOL_BYTES = 64 * 1024 * 1024;
function protocolLimits(): { request: number; response: number } {
  const read = (name: string): number => {
    const configured = process.env[name];
    if (configured === undefined) return MAX_BYTES;
    if (!/^[1-9][0-9]*$/.test(configured)) throw new FoundationError('PROTOCOL_CONFIG', 'Invalid trusted protocol byte limit');
    const value = Number(configured);
    if (!Number.isSafeInteger(value) || value < 256 || value > HARD_PROTOCOL_BYTES)
      throw new FoundationError('PROTOCOL_CONFIG', 'Invalid trusted protocol byte limit');
    return value;
  };
  return { request: read('HF_SERVICE_MAX_REQUEST_BYTES'), response: read('HF_SERVICE_MAX_RESPONSE_BYTES') };
}
function errorValue(error: unknown): { code: string; message: string } {
  return error instanceof FoundationError ? { code: error.code, message: error.message } :
    { code: 'HANDLER_FAILED', message: error instanceof Error ? error.message : 'Unknown component failure' };
}
function options(args: string[]): Record<string,string> {
  const result: Record<string,string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !['--policy','--spec-revision','--components','--module-root'].includes(flag) ||
        !value || value.startsWith('--') || Object.hasOwn(result, flag))
      throw new FoundationError('INVALID_ARGS', 'Use --policy FILE --spec-revision REV [--components DIR] [--module-root DIR]');
    result[flag] = value;
  }
  if (!result['--policy'] || !result['--spec-revision'])
    throw new FoundationError('INVALID_ARGS', 'Explicit trusted policy and pinned specification revision required');
  return result;
}
export type ProtocolResponse =
  | { id: string | number; ok: true; result: unknown }
  | { id: string | number | null; ok: false; error: { code: string; message: string } };
// Shared internal dispatcher: later authenticated transports reuse these exact admission checks.
export async function handleRequest(registry: ComponentRegistry, request: unknown, responseLimit = MAX_BYTES): Promise<ProtocolResponse> {
  let id: string | number | null = null;
  try {
    if (!Number.isSafeInteger(responseLimit) || responseLimit < 256 || responseLimit > HARD_PROTOCOL_BYTES)
      throw new FoundationError('PROTOCOL_CONFIG', 'Invalid trusted protocol byte limit');
    if (!object(request) || Object.keys(request).some(key => !['id','component','action','input'].includes(key)) ||
        !Object.hasOwn(request, 'input') || !(typeof request.id === 'string' && request.id.length > 0 && request.id.length <= 128 ||
          typeof request.id === 'number' && Number.isSafeInteger(request.id)) ||
        typeof request.component !== 'string' || typeof request.action !== 'string')
      throw new FoundationError('INVALID_REQUEST', 'Request requires bounded id, component, action and input');
    id = request.id as string | number;
    const result = request.component === 'system' && request.action === 'system.describe' ? registry.describe() :
      await registry.invoke(request.component, request.action, request.input);
    const response = { id, ok: true as const, result };
    const encoded = JSON.stringify(response, (_key, value: unknown) => {
      if (['undefined','function','symbol','bigint'].includes(typeof value) ||
          typeof value === 'number' && !Number.isFinite(value)) throw new Error('Result is not JSON serializable');
      return value;
    });
    if (Buffer.byteLength(encoded) > responseLimit) throw new Error('Response exceeds protocol limit');
    // Snapshot validated bytes so later wire serialization cannot invoke component toJSON or getters.
    return JSON.parse(encoded) as ProtocolResponse;
  } catch (error) {
    const response = { id, ok: false as const, error: errorValue(error) };
    if (Buffer.byteLength(JSON.stringify(response)) > responseLimit)
      return { id: null, ok: false, error: { code: 'RESPONSE_TOO_LARGE', message: 'Response exceeds protocol limit' } };
    return response;
  }
}
export async function runService(role: ServiceRole, args = process.argv.slice(2)): Promise<void> {
  let registry: ComponentRegistry | undefined;
  const controller = new AbortController();
  let stopping = false;
  let cleanup: Promise<void> | undefined;
  let terminationDeadline: ReturnType<typeof setTimeout> | undefined;
  const close = (): Promise<void> => cleanup ??= (async () => {
    stopping = true; controller.abort();
    if (registry) await registry.close();
  })();
  const terminate = (): void => {
    terminationDeadline ??= setTimeout(() => process.exit(1), 5000);
    void close().then(() => { process.stdin.destroy(); },
      error => { process.stderr.write(JSON.stringify({ ok: false, error: errorValue(error) }) + '\n'); process.exit(1); });
  };
  process.once('SIGTERM', terminate);
  process.once('SIGINT', terminate);
  try {
    // Operator-owned startup configuration is frozen before policy reads or component factories run.
    const limits = protocolLimits();
    const config = options(args);
    const policyFile = config['--policy']!;
    let stat;
    try { stat = await fs.stat(policyFile); }
    catch { throw new FoundationError('POLICY_INVALID', 'Trusted policy file is unavailable'); }
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new FoundationError('POLICY_INVALID', 'Policy must be a bounded regular file');
    let raw: unknown;
    try { raw = JSON.parse(await fs.readFile(policyFile, 'utf8')); }
    catch { throw new FoundationError('POLICY_INVALID', 'Invalid trusted policy JSON'); }
    // Startup configuration is an operator trust boundary; requests never select or replace approval.
    const policy = validatePolicy(raw, config['--spec-revision']!, role);
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    registry = new ComponentRegistry(Object.freeze({ role, policy, signal: controller.signal, env: Object.freeze({ ...process.env }) }));
    await registry.load(config['--components'] ?? path.join(packageRoot, 'components'), config['--module-root'] ?? path.join(packageRoot, 'dist'));
    const reply = async (line: string): Promise<void> => {
      let request: unknown;
      try { request = JSON.parse(line); } catch { request = undefined; }
      const response = await handleRequest(registry!, request, limits.response);
      if (!response.ok) process.exitCode = 1;
      if (!process.stdout.write(JSON.stringify(response) + '\n'))
        await new Promise<void>(resolve => process.stdout.once('drain', resolve));
    };
    let buffered = Buffer.alloc(0);
    for await (const chunk of process.stdin) {
      if (stopping) break;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let offset = 0;
      while (offset < data.length && !stopping) {
        const newline = data.indexOf(10, offset);
        const end = newline < 0 ? data.length : newline;
        if (buffered.length + end - offset > limits.request) throw new FoundationError('INVALID_REQUEST', 'Request exceeds protocol limit');
        buffered = Buffer.concat([buffered, data.subarray(offset, end)]);
        offset = end + (newline < 0 ? 0 : 1);
        if (newline >= 0) { await reply(buffered.toString('utf8')); buffered = Buffer.alloc(0); }
      }
    }
    if (!stopping && buffered.length) await reply(buffered.toString('utf8'));
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(JSON.stringify({ ok: false, error: errorValue(error) }) + '\n');
  } finally {
    try { await close(); } catch (error) {
      process.exitCode = 1;
      process.stderr.write(JSON.stringify({ ok: false, error: errorValue(error) }) + '\n');
    }
    if (terminationDeadline) clearTimeout(terminationDeadline);
    process.removeListener('SIGTERM', terminate);
    process.removeListener('SIGINT', terminate);
  }
}
