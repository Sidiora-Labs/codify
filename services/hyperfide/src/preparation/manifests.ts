import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Component, ComponentContext } from '../components/registry.js';

export interface VersionPin { name: string; version: string }
export interface FilePin { path: string; digest: string }
export interface EnvironmentProfile {
  schema_version: 1; profile_id: string; profile_version: string;
  os: { distribution: string; version: string; architecture: 'x86_64' | 'aarch64' };
  image: { provider: string; reference: string; digest: string | null };
  resources: { cpu_millis: number; memory_bytes: string; disk_bytes: string; persistent_volume_bytes: string };
  toolchains: VersionPin[]; package_managers: { name: string; version: string; locks: FilePin[] }[];
  native_agents: VersionPin[]; connectors: VersionPin[]; supervisor: VersionPin; hyperfide: { version: string };
  system_packages: VersionPin[];
  repositories: { id: string; url: string; commit: string; submodules: { path: string; commit: string }[]; lfs: boolean }[];
  recipe: FilePin; generated_inputs: FilePin[]; build_config: FilePin[];
  caches: { name: string; trust_scope: string; input_digest: string }[];
  required_capabilities: string[]; network: { routes: string[]; registries: string[] };
  credential_references: string[];
  policy: { max_process_lifetime_seconds: number; expires_at: string; rebuild_on: string[] };
  preparation_evidence: FilePin[];
}
export interface InventoryEntry { path: string; mode: number; size: string; digest: string }
export interface DirectoryEntry { path: string; mode: number }
interface ScanPolicy { secret_canaries: string[]; identity_canaries: string[]; lease_canaries: string[] }
interface ScanDeclaration {
  policy_version: 1; canary_counts: { secret: number; identity: number; lease: number }; checks: string[];
}
export interface SymlinkEntry { path: string; target: string; digest: string }
export interface HardlinkGroup { paths: string[] }
export interface PreparationManifest {
  schema_version: 1 | 2; profile: EnvironmentProfile; files: InventoryEntry[]; directories: DirectoryEntry[];
  symlinks?: SymlinkEntry[]; hardlinks?: HardlinkGroup[]; scan: ScanDeclaration; digest: string;
}
type InventoryContext = Pick<ComponentContext, 'env' | 'signal'>;
const JSON_BYTES = 16 * 1024 * 1024;
function operatingLimits(context: InventoryContext): { files: number; fileBytes: number; totalBytes: number; depth: number; directories: number } {
  const read = (name: string, fallback: number, maximum: number): number => {
    const value = context.env['HF_PREPARATION_' + name];
    if (value === undefined) return fallback;
    if (!/^[1-9][0-9]*$/.test(value)) fail('operating limit');
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result > maximum) fail('operating limit');
    return result;
  };
  return { files: read('MAX_FILES', 100000, 1000000), fileBytes: read('MAX_FILE_BYTES', 2147483648, 68719476736),
    totalBytes: read('MAX_TOTAL_BYTES', 68719476736, 1099511627776), depth: read('MAX_DEPTH', 128, 256),
    directories: read('MAX_DIRECTORIES', 30000, 100000) };
}
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const checks = ['sensitive_paths', 'private_key_markers', 'authority_json', 'designated_canaries'];
function fail(reason: string): never { throw new Error('Preparation refused: ' + reason); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    fail('object schema');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) fail('object fields');
  return result;
}
function text(value: unknown, maximum = 256): string {
  if (typeof value !== 'string' || !value.length || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) fail('bounded string');
  return value;
}
function id(value: unknown): string {
  const result = text(value, 128); if (!identifierPattern.test(result)) fail('identifier'); return result;
}
function version(value: unknown): string {
  const result = text(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(result) || /^(latest|head|main|master|next|stable|nightly)$/i.test(result) ||
      /(^|[._-])[xX]($|[._-])/.test(result)) fail('unpinned version');
  return result;
}
function relative(value: unknown): string {
  const result = text(value, 4096);
  if (result.startsWith('/') || result.includes('\\') || result.split('/').some(piece => !piece || piece === '.' || piece === '..'))
    fail('relative path');
  return result;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !digestPattern.test(value)) fail('digest'); return value;
}
function decimal(value: unknown, positive: boolean): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 9223372036854775807n ||
      (positive && BigInt(value) === 0n)) fail('byte quantity');
  return value;
}
function integer(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) fail('integer'); return value;
}
function list<T>(value: unknown, mapper: (item: unknown) => T, minimum = 0, maximum = 256): T[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail('bounded array'); return value.map(mapper);
}
function unique<T>(values: T[], key: (item: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) fail('duplicate entry'); return values;
}
function ids(value: unknown, minimum = 0): string[] { return unique(list(value, id, minimum), item => item); }
function pin(value: unknown): VersionPin {
  const item = record(value, ['name', 'version']); return { name: id(item.name), version: version(item.version) };
}
function pins(value: unknown, minimum = 0): VersionPin[] { return unique(list(value, pin, minimum), item => item.name); }
function filePin(value: unknown): FilePin {
  const item = record(value, ['path', 'digest']); return { path: relative(item.path), digest: digest(item.digest) };
}
function filePins(value: unknown, minimum = 0): FilePin[] { return unique(list(value, filePin, minimum), item => item.path); }
function commit(value: unknown): string {
  if (typeof value !== 'string' || !/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) fail('source revision'); return value;
}
function timestamp(value: unknown): string {
  const result = text(value, 32);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(result) ||
      !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().replace('.000Z','Z') !== result.replace('.000Z','Z'))
    fail('UTC expiration');
  return result;
}
function repositoryURL(value: unknown): string {
  const result = text(value, 2048);
  let url: URL; try { url = new URL(result); } catch { return fail('repository URL'); }
  // Authentication is attached at runtime; even SSH usernames are deliberately excluded from this identity URL.
  if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash)
    fail('credential-free repository URL');
  return result;
}
export function validateProfile(input: unknown): EnvironmentProfile {
  const item = record(input, ['schema_version','profile_id','profile_version','os','image','resources','toolchains',
    'package_managers','native_agents','connectors','supervisor','hyperfide','system_packages','repositories','recipe',
    'generated_inputs','build_config','caches','required_capabilities','network','credential_references','policy','preparation_evidence']);
  if (item.schema_version !== 1) fail('profile version');
  const os = record(item.os, ['distribution','version','architecture']);
  if (!['x86_64','aarch64'].includes(os.architecture as string)) fail('architecture');
  const image = record(item.image, ['provider','reference','digest']);
  const imageReference = text(image.reference, 512);
  const imagePin = imageReference.match(/^([A-Za-z0-9][A-Za-z0-9._:/-]*)@(sha256:[a-f0-9]{64})$/);
  if (/[?#\s]/.test(imageReference) || (imageReference.includes('@') && !imagePin) ||
      imageReference.includes('://') || /(^|[:/])(latest|head|main|master)$/i.test(imageReference)) fail('image reference');
  if (imagePin && image.digest !== null && digest(image.digest) !== imagePin[2]) fail('image digest mismatch');
  const resources = record(item.resources, ['cpu_millis','memory_bytes','disk_bytes','persistent_volume_bytes']);
  const hyperfide = record(item.hyperfide, ['version']);
  const network = record(item.network, ['routes','registries']);
  const policy = record(item.policy, ['max_process_lifetime_seconds','expires_at','rebuild_on']);
  const profile: EnvironmentProfile = {
    schema_version: 1, profile_id: id(item.profile_id), profile_version: version(item.profile_version),
    os: { distribution: id(os.distribution), version: version(os.version), architecture: os.architecture as 'x86_64' | 'aarch64' },
    image: { provider: id(image.provider), reference: imageReference, digest: image.digest === null ? null : digest(image.digest) },
    resources: { cpu_millis: integer(resources.cpu_millis, 1), memory_bytes: decimal(resources.memory_bytes, true),
      disk_bytes: decimal(resources.disk_bytes, true), persistent_volume_bytes: decimal(resources.persistent_volume_bytes, false) },
    toolchains: pins(item.toolchains, 1),
    package_managers: unique(list(item.package_managers, value => {
      const manager = record(value, ['name','version','locks']);
      return { name: id(manager.name), version: version(manager.version), locks: filePins(manager.locks, 1) };
    }, 1), manager => manager.name),
    native_agents: pins(item.native_agents, 1), connectors: pins(item.connectors, 1), supervisor: pin(item.supervisor),
    hyperfide: { version: version(hyperfide.version) }, system_packages: pins(item.system_packages),
    repositories: unique(list(item.repositories, value => {
      const repository = record(value, ['id','url','commit','submodules','lfs']);
      if (typeof repository.lfs !== 'boolean') fail('LFS requirement');
      return { id: id(repository.id), url: repositoryURL(repository.url), commit: commit(repository.commit),
        submodules: unique(list(repository.submodules, sub => {
          const value = record(sub, ['path','commit']); return { path: relative(value.path), commit: commit(value.commit) };
        }), sub => sub.path), lfs: repository.lfs };
    }, 1), repository => repository.id),
    recipe: filePin(item.recipe), generated_inputs: filePins(item.generated_inputs), build_config: filePins(item.build_config),
    caches: unique(list(item.caches, value => {
      const cache = record(value, ['name','trust_scope','input_digest']);
      return { name: id(cache.name), trust_scope: id(cache.trust_scope), input_digest: digest(cache.input_digest) };
    }), cache => cache.name),
    required_capabilities: ids(item.required_capabilities, 1),
    network: { routes: ids(network.routes), registries: ids(network.registries) },
    credential_references: ids(item.credential_references),
    policy: { max_process_lifetime_seconds: integer(policy.max_process_lifetime_seconds, 1),
      expires_at: timestamp(policy.expires_at), rebuild_on: ids(policy.rebuild_on) },
    preparation_evidence: filePins(item.preparation_evidence, 1)
  };
  return profile;
}
function scanPolicy(input: unknown): ScanPolicy {
  const item = record(input, ['secret_canaries','identity_canaries','lease_canaries']);
  const canaries = (input: unknown): string[] => unique(list(input, value => {
    if (typeof value !== 'string' || value.length < 8 || value.length > 4096) fail('canary schema'); return value;
  }, 0, 64), value => value);
  return { secret_canaries: canaries(item.secret_canaries), identity_canaries: canaries(item.identity_canaries),
    lease_canaries: canaries(item.lease_canaries) };
}
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonicalJSON((value as Record<string, unknown>)[key])).join(',') + '}';
  return fail('noncanonical value');
}
function sha(bytes: Buffer | string): string { return 'sha256:' + createHash('sha256').update(bytes).digest('hex'); }
function declaration(policy: ScanPolicy): ScanDeclaration {
  return { policy_version: 1, canary_counts: { secret: policy.secret_canaries.length, identity: policy.identity_canaries.length,
    lease: policy.lease_canaries.length }, checks: [...checks] };
}
function sensitivePath(filename: string): boolean {
  const parts = filename.split('/');
  return parts.some(part => ['.ssh','.aws','.azure','.kube'].includes(part)) ||
    parts.some(part => /^\.env(?:\.|$)/.test(part) && part !== '.env.example') ||
    ['.npmrc','.netrc','.claude.json','auth.json','.credentials.json','credentials.json'].includes(parts.at(-1) ?? '');
}
const authorityKeys = new Set(['lease_token','lease_id','agent_session_id','ownership_generation','enrollment_token',
  'access_token','refresh_token','api_key','private_key','password']);
function authorityJSON(value: unknown, depth = 0): void {
  if (depth > 128) fail('JSON depth');
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (authorityKeys.has(key.toLowerCase()) && ((typeof item === 'string' && item.length > 0) || typeof item === 'number')) fail('runtime authority');
    authorityJSON(item, depth + 1);
  }
}
function lexicalAuthority(value: string): void {
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '"') continue;
    const start = i++;
    while (i < value.length && value[i] !== '"') { if (value[i] === '\\') i++; i++; }
    const token = value.slice(start, i + 1);
    let next = i + 1;
    while (next < value.length && /\s/.test(value[next]!)) next++;
    if (value[next] !== ':') continue;
    const key: unknown = JSON.parse(token);
    if (typeof key !== 'string' || !authorityKeys.has(key.toLowerCase())) continue;
    next++;
    while (next < value.length && /\s/.test(value[next]!)) next++;
    if (/[-0-9]/.test(value[next] ?? '')) fail('runtime authority');
    if (value[next] !== '"') continue;
    let end = next + 1;
    while (end < value.length && value[end] !== '"') { if (value[end] === '\\') end++; end++; }
    if ((JSON.parse(value.slice(next, end + 1)) as string).length) fail('runtime authority');
  }
}
// Compiled tools contain PEM labels; a label alone is not secret key material.
function privateKeyMaterial(value: string): boolean {
  const begin = /-----BEGIN ([A-Z0-9 ]{0,64}PRIVATE KEY)-----\r?\n/g;
  for (const match of value.matchAll(begin)) {
    const start = match.index! + match[0].length;
    const end = value.indexOf('-----END ' + match[1]! + '-----', start);
    if (end < start || end - start > 65536) continue;
    const lines = value.slice(start, end).replace(/\r/g, '').trim().split('\n');
    while (lines.length && (/^[A-Za-z0-9-]+: [^\n]*$/.test(lines[0]!) || lines[0] === '')) lines.shift();
    if (lines.length && lines.every(line => /^[A-Za-z0-9+/]+={0,2}$/.test(line)) &&
        lines.join('').length >= 32 && lines.join('').length % 4 === 0) return true;
  }
  return false;
}
function scanBytes(bytes: Buffer, policy: ScanPolicy, json: boolean): void {
  for (const canary of [...policy.secret_canaries, ...policy.identity_canaries, ...policy.lease_canaries])
    if (bytes.includes(Buffer.from(canary, 'utf8'))) fail('designated sensitive content');
  const value = bytes.toString('utf8');
  if (privateKeyMaterial(value)) fail('private key content');
  if (json) {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return; }
    authorityJSON(parsed);
    lexicalAuthority(value);
  }
}
type Stat = fs.BigIntStats;
function same(before: Stat, after: Stat): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode && before.uid === after.uid && before.gid === after.gid &&
    before.nlink === after.nlink && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}
function stat(fd: number): Stat { return fs.fstatSync(fd, { bigint: true }); }
function mode(info: Stat): number {
  if ((info.mode & 0o7000n) !== 0n) fail('special permissions'); return Number(info.mode & 0o777n);
}
function names(fd: number): string[] {
  const raw = fs.readdirSync('/proc/self/fd/' + fd, { encoding: 'buffer' });
  const result = raw.map(value => { const decoded = value.toString('utf8'); if (!Buffer.from(decoded, 'utf8').equals(value)) fail('directory encoding'); return decoded; }).sort();
  if (result.some(value => !value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') ||
      /[\x00-\x1f\x7f]/.test(value))) fail('directory names');
  return result;
}
/**
 * The configured root is trusted deployment input; caller paths never select an arbitrary host root.
 * Linux directory descriptors anchor bounded traversal and revalidation against concurrent changes.
 * Schema v2 may inventory policy-checked internal symlinks and hardlink groups; v1 rejects symlinks.
 * The preparation owner must quiesce writers: this scan is not an atomic filesystem snapshot.
 * Known sensitive state/canaries are rejected; this is no proof against unknown secrets or readiness probe.
 */
async function inventory(candidate: string, context: InventoryContext, policy: ScanPolicy, allowSymlinks: boolean): Promise<{ files: InventoryEntry[]; directories: DirectoryEntry[]; symlinks: SymlinkEntry[]; hardlinks: HardlinkGroup[] }> {
  const root = context.env.HF_PREPARATION_ALLOWED_ROOT;
  const LIMIT = operatingLimits(context);
  if (process.platform !== 'linux' || !root || !path.posix.isAbsolute(root) || root === '/' ||
      root.includes('\\') || root.includes('\0') || path.posix.normalize(root) !== root || root.endsWith('/')) fail('trusted preparation root');
  const rootParts = root.slice(1).split('/');
  if (rootParts.some(value => !value || value === '.' || value === '..')) fail('trusted preparation root');
  const held: number[] = [];
  const links: { parent: number; name: string; fd: number; before: Stat; strict: boolean }[] = [];
  const files: InventoryEntry[] = [], directories: DirectoryEntry[] = [], symlinks: SymlinkEntry[] = [];
  const inspectedSymlinks: { parent: number; name: string; before: Stat; target: Buffer }[] = [];
  const inodeGroups = new Map<string, { before: Stat; paths: string[]; digest: string }>();
  const directoryInodes = new Set<string>();
  const hardlinks: HardlinkGroup[] = [];
  const inspectedFiles: { parent: number; name: string; before: Stat }[] = [];
  const inspectedDirectories: { fd: number; before: Stat; names: string[] }[] = [];
  let total = 0;
  const openDirectory = (parent: number, name: string, strict = true): number => {
    const fd = fs.openSync('/proc/self/fd/' + parent + '/' + name, (strict ? fs.constants.O_RDONLY : 0x200000 /* Linux O_PATH: execute-only trusted ancestors. */) | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    held.push(fd); const before = stat(fd);
    if (!before.isDirectory()) fail('directory type');
    links.push({ parent, name, fd, before, strict }); return fd;
  };
  const visit = async (fd: number, prefix: string, depth: number): Promise<void> => {
    if (context.signal.aborted) fail('scan cancelled');
    if (depth > LIMIT.depth || directories.length >= LIMIT.directories) fail('inventory limit');
    const before = stat(fd), initialNames = names(fd);
    const directoryIdentity = before.dev.toString() + ':' + before.ino.toString();
    if (directoryInodes.has(directoryIdentity)) fail('directory alias');
    directoryInodes.add(directoryIdentity);
    inspectedDirectories.push({ fd, before, names: initialNames });
    directories.push({ path: prefix || '.', mode: mode(before) });
    let entryCount = 0;
    for (const name of initialNames) {
      if (++entryCount % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      if (context.signal.aborted) fail('scan cancelled');
      const filename = prefix ? prefix + '/' + name : name;
      if (filename.length > 4096 || sensitivePath(filename)) fail('sensitive path');
      scanBytes(Buffer.from(filename, 'utf8'), policy, false);
      const pathname = '/proc/self/fd/' + fd + '/' + name;
      const entry = fs.lstatSync(pathname, { bigint: true });
      if (entry.isSymbolicLink()) {
        if (!allowSymlinks || symlinks.length + files.length >= LIMIT.files || entry.nlink !== 1n) fail('symlink type or limit');
        // Procfs magic links are kernel references, not portable filesystem links.
        if (fs.statfsSync('/proc/self/fd/' + fd, { bigint: true }).type === 0x9fa0n) fail('magic link');
        const target = fs.readlinkSync(pathname, { encoding: 'buffer' });
        const decoded = target.toString('utf8');
        if (!target.length || target.length > 4096 || !Buffer.from(decoded, 'utf8').equals(target) ||
            decoded.startsWith('/') || decoded.includes('\\') || /[\x00-\x1f\x7f]/.test(decoded)) fail('symlink target');
        scanBytes(target, policy, false);
        if (!same(entry, fs.lstatSync(pathname, { bigint: true })) ||
            !target.equals(fs.readlinkSync(pathname, { encoding: 'buffer' }))) fail('symlink changed');
        total += target.length; if (total > LIMIT.totalBytes) fail('inventory byte limit');
        symlinks.push({ path: filename, target: decoded, digest: sha(target) });
        inspectedSymlinks.push({ parent: fd, name, before: entry, target }); continue;
      }
      if (entry.isDirectory()) {
        const child = openDirectory(fd, name);
        if (!same(entry, stat(child))) fail('directory changed');
        await visit(child, filename, depth + 1); continue;
      }
      if (!entry.isFile() || entry.nlink < 1n || (!allowSymlinks && entry.nlink !== 1n) || entry.size > BigInt(LIMIT.fileBytes) || files.length + symlinks.length >= LIMIT.files) fail('file type or limit');
      const file = fs.openSync(pathname, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const opened = stat(file);
        if (!opened.isFile() || !same(entry, opened)) fail('file changed');
        total += Number(opened.size); if (total > LIMIT.totalBytes) fail('inventory byte limit');
        let isJSON = filename.endsWith('.json'), sniffed = isJSON;
        if (isJSON && opened.size > BigInt(JSON_BYTES)) fail('JSON scan limit');
        const hash = createHash('sha256'), buffer = Buffer.alloc(65536), jsonChunks: Buffer[] = [];
        const canaries = [...policy.secret_canaries, ...policy.identity_canaries, ...policy.lease_canaries];
        const overlap = Math.max(66048, ...canaries.map(value => Buffer.byteLength(value, 'utf8'))) - 1;
        let carry = Buffer.alloc(0), position = 0;
        while (position < Number(opened.size)) {
          if (context.signal.aborted) fail('scan cancelled');
          const count = fs.readSync(file, buffer, 0, Math.min(buffer.length, Number(opened.size) - position), position);
          if (!count) fail('short file');
          const chunk = buffer.subarray(0, count);
          if (!sniffed) {
            const first = chunk.toString('utf8').trimStart()[0];
            if (first !== undefined) { isJSON = first === '{' || first === '['; sniffed = true; }
          }
          hash.update(chunk);
          const scanned = Buffer.concat([carry, chunk]);
          scanBytes(scanned, policy, false);
          carry = Buffer.from(scanned.subarray(Math.max(0, scanned.length - overlap)));
          if (isJSON) {
            if (Number(opened.size) > JSON_BYTES) fail('JSON scan limit');
            jsonChunks.push(Buffer.from(chunk));
          }
          position += count;
          if (position % 1048576 === 0) await new Promise<void>(resolve => setImmediate(resolve));
        }
        if (!same(opened, stat(file)) || !same(opened, fs.lstatSync(pathname, { bigint: true }))) fail('file changed');
        if (isJSON) scanBytes(Buffer.concat(jsonChunks), policy, true);
        const contentDigest = 'sha256:' + hash.digest('hex');
        files.push({ path: filename, mode: mode(opened), size: opened.size.toString(), digest: contentDigest });
        if (opened.nlink > 1n) {
          const key = opened.dev.toString() + ':' + opened.ino.toString(), prior = inodeGroups.get(key);
          if (prior && (!same(prior.before, opened) || prior.digest !== contentDigest)) fail('hardlink changed');
          if (prior) prior.paths.push(filename);
          else inodeGroups.set(key, { before: opened, paths: [filename], digest: contentDigest });
        }
        inspectedFiles.push({ parent: fd, name, before: opened });
      } finally { fs.closeSync(file); }
    }
    if (canonicalJSON(initialNames) !== canonicalJSON(names(fd)) || !same(before, stat(fd))) fail('directory changed');
  };
  try {
    const anchor = fs.openSync('/', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    held.push(anchor); let current = anchor;
    for (const part of rootParts) current = openDirectory(current, part, false);
    const candidateParts = candidate.split('/');
    for (let index = 0; index < candidateParts.length; index++)
      current = openDirectory(current, candidateParts[index]!, index === candidateParts.length - 1);
    await visit(current, '', 0);
    for (const group of inodeGroups.values()) {
      if (BigInt(group.paths.length) !== group.before.nlink) fail('unmeasured hardlink alias');
      hardlinks.push({ paths: group.paths.sort() });
    }
    hardlinks.sort((a,b) => a.paths[0]! < b.paths[0]! ? -1 : a.paths[0]! > b.paths[0]! ? 1 : 0);
    await validateLinkGraph(files, directories, symlinks, context.signal);
    let closureCount = 0;
    for (const link of links) {
      if (++closureCount % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      if (context.signal.aborted) fail('scan cancelled');
      // Check the original directory entry as well as the retained descriptor: a moved root is not a published current path.
      const equivalent = (value: Stat): boolean => link.strict ? same(link.before, value) :
        link.before.dev === value.dev && link.before.ino === value.ino && link.before.mode === value.mode &&
        link.before.uid === value.uid && link.before.gid === value.gid;
      if (!equivalent(stat(link.fd)) || !equivalent(
        fs.lstatSync('/proc/self/fd/' + link.parent + '/' + link.name, { bigint: true }))) fail('directory changed');
    }
    for (const file of inspectedFiles) {
      if (++closureCount % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      if (context.signal.aborted) fail('scan cancelled');
      if (!same(file.before, fs.lstatSync('/proc/self/fd/' + file.parent + '/' + file.name, { bigint: true })))
        fail('file changed before publication');
    }
    for (const link of inspectedSymlinks) {
      if (++closureCount % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      if (context.signal.aborted) fail('scan cancelled');
      const pathname = '/proc/self/fd/' + link.parent + '/' + link.name;
      if (!same(link.before, fs.lstatSync(pathname, { bigint: true })) ||
          !link.target.equals(fs.readlinkSync(pathname, { encoding: 'buffer' }))) fail('symlink changed before publication');
    }
    // The PREPARATION owner must quiesce writers before publishing inventory.
    // This final pass detects mutations during the yielding file/link closure;
    // a multi-file scan itself is not an atomic filesystem snapshot.
    for (const directory of inspectedDirectories) {
      if (++closureCount % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      if (context.signal.aborted) fail('scan cancelled');
      if (!same(directory.before, stat(directory.fd)) ||
          canonicalJSON(directory.names) !== canonicalJSON(names(directory.fd))) fail('directory changed before publication');
    }
    if (!files.length) fail('empty candidate');
    files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    directories.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    symlinks.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { files, directories, symlinks, hardlinks };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Preparation refused:')) throw error;
    // Filesystem error messages often contain local paths. Never expose them through the component.
    return fail('filesystem scan');
  } finally { for (const fd of held.reverse()) { try { fs.closeSync(fd); } catch { /* best-effort descriptor cleanup */ } } }
}
/**
 * Resolve against the complete physical inventory, never by opening a link.
 * Active expansion detects actual resolution loops; directory aliases and
 * normal cyclic package dependency graphs do not cause recursive traversal.
 */
async function validateLinkGraph(files: InventoryEntry[], directories: DirectoryEntry[], links: SymlinkEntry[], signal: AbortSignal): Promise<void> {
  const kinds = new Map<string, 'file' | 'directory' | 'link'>([['.', 'directory']]);
  for (const value of directories) kinds.set(value.path, 'directory');
  for (const value of files) kinds.set(value.path, 'file');
  const targets = new Map(links.map(link => [link.path, link.target]));
  for (const value of links) kinds.set(value.path, 'link');
  const lookup = (parts: string[]): string => parts.length ? parts.join('/') : '.';
  const expand = (key: string, active: Set<string>, budget: { remaining: number }): string[] => {
    if (active.has(key) || --budget.remaining < 0) fail('symlink resolution loop or limit');
    const target = targets.get(key);
    if (target === undefined) fail('symlink target');
    const next = new Set(active); next.add(key);
    let position = key.split('/').slice(0, -1);
    for (const part of target.split('/')) {
      if (kinds.get(lookup(position)) !== 'directory') fail('symlink non-directory');
      if (!part || part === '.') continue;
      if (part === '..') { if (!position.length) fail('symlink escape'); position.pop(); continue; }
      const candidate = [...position, part], selected = lookup(candidate), kind = kinds.get(selected);
      if (kind === undefined) fail('dangling symlink');
      position = kind === 'link' ? expand(selected, next, budget) : candidate;
    }
    return position;
  };
  let count = 0;
  for (const link of links) {
    if (++count % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    if (signal.aborted) fail('scan cancelled');
    expand(link.path, new Set(), { remaining: 40 });
  }
}

function pinInventory(profile: EnvironmentProfile, files: InventoryEntry[]): void {
  const byPath = new Map(files.map(file => [file.path, file.digest]));
  const required = [profile.recipe, ...profile.generated_inputs, ...profile.build_config, ...profile.preparation_evidence,
    ...profile.package_managers.flatMap(manager => manager.locks)];
  for (const pin of required) if (byPath.get(pin.path) !== pin.digest) fail('pinned content mismatch');
}
async function make(input: unknown, context: InventoryContext, verifying: boolean): Promise<PreparationManifest> {
  const item = record(input, verifying ? ['candidate_path','manifest','scan_policy'] : ['candidate_path','profile','scan_policy']);
  const candidate = relative(item.candidate_path), policy = scanPolicy(item.scan_policy);
  let provided: Record<string, unknown> | undefined;
  let schemaVersion: 1 | 2 = 2;
  if (verifying) {
    if (!item.manifest || typeof item.manifest !== 'object' || Array.isArray(item.manifest)) fail('manifest schema');
    const version = (item.manifest as Record<string, unknown>).schema_version;
    if (version !== 1 && version !== 2) fail('manifest schema');
    schemaVersion = version;
    provided = record(item.manifest, version === 1 ? ['schema_version','profile','files','directories','scan','digest'] :
      ['schema_version','profile','files','directories','symlinks','hardlinks','scan','digest']);
    digest(provided.digest);
  }
  const profile = validateProfile(verifying ? provided!.profile : item.profile);
  if (!verifying && Date.parse(profile.policy.expires_at) <= Date.now()) fail('expired profile');
  scanBytes(Buffer.from(canonicalJSON(profile)), policy, true);
  const entries = await inventory(candidate, context, policy, schemaVersion === 2);
  pinInventory(profile, entries.files);
  const body = { schema_version: schemaVersion, profile, files: entries.files, directories: entries.directories,
    ...(schemaVersion === 2 ? { symlinks: entries.symlinks, hardlinks: entries.hardlinks } : {}), scan: declaration(policy) };
  const manifest: PreparationManifest = { ...body, digest: sha(canonicalJSON(body)) };
  if (provided && canonicalJSON(provided) !== canonicalJSON(manifest)) fail('manifest content mismatch');
  return manifest;
}
export async function createManifest(input: unknown, context: InventoryContext): Promise<PreparationManifest> { return make(input, context, false); }
/** Re-scan the trusted candidate and compare canonical schema v1/v2 content, including link topology.
 * Expired historical profiles may verify; integrity grants no current reuse or execution authority. */
export async function verifyManifest(input: unknown, context: InventoryContext): Promise<{ valid: true; digest: string; file_count: number }> {
  const manifest = await make(input, context, true); return { valid: true, digest: manifest.digest, file_count: manifest.files.length };
}
export function createComponent(_context: InventoryContext): Component {
  return { apiVersion: 1, actions: {
    'preparation.manifest.create': createManifest,
    'preparation.manifest.verify': verifyManifest
  } };
}


/** Metadata/compatibility validation grants no filesystem, runtime or ownership authority. */
function metadataHash(value:unknown):string{return sha(canonicalJSON(value));}
function metadataText(value:unknown,pattern:RegExp,max=256):string{
 if(typeof value!=='string'||!value.length||value.length>max||!pattern.test(value))fail('manifest metadata');return value;
}
function metadataInteger(value:unknown,min:number,max:number):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail('manifest metadata');return value;
}
function metadataDecimal(value:unknown):string{
 const result=metadataText(value,/^(0|[1-9][0-9]{0,18})$/,19);if(BigInt(result)>9223372036854775807n)fail('manifest metadata');return result;
}
export function validateManifestMetadata(value:unknown):PreparationManifest{
 const version=value&&typeof value==='object'?(value as Record<string,unknown>).schema_version:undefined;
 const row=record(value,version===2?['schema_version','profile','files','directories','symlinks','hardlinks','scan','digest']:['schema_version','profile','files','directories','scan','digest']);
 if((row.schema_version!==1&&row.schema_version!==2)||!Array.isArray(row.files)||!Array.isArray(row.directories)||
   (row.schema_version===2&&(!Array.isArray(row.symlinks)||!Array.isArray(row.hardlinks))))fail('PREPARATION_MANIFEST_INVALID');
 validateProfile(row.profile);digest(row.digest);
 const body={schema_version:row.schema_version,profile:row.profile,files:row.files,directories:row.directories,
  ...(row.schema_version===2?{symlinks:row.symlinks,hardlinks:row.hardlinks}:{}),scan:row.scan};
 if(metadataHash(body)!==row.digest)fail('PREPARATION_MANIFEST_INVALID');
 const paths=new Set<string>(),directories=new Set<string>(),fileDigests=new Map<string,string>();let previous='';
 const validPath=(value:unknown,root=false):string=>{
  if(root&&value==='.')return '.';
  const path=metadataText(value,/^[^\x00-\x1f\x7f\\]+$/,4096);
  if(path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..'))fail('PREPARATION_MANIFEST_INVALID');
  return path;
 };
 if(!row.files.length||row.files.length>1000000||!row.directories.length||row.directories.length>1000000)fail('PREPARATION_MANIFEST_INVALID');
 for(const entry of row.directories){
  const directory=record(entry,['path','mode']),path=validPath(directory.path,true);
  if(directories.has(path)||path<=previous)fail('PREPARATION_MANIFEST_INVALID');
  directories.add(path);previous=path;metadataInteger(directory.mode,0,511);
 }
 if(!directories.has('.'))fail('PREPARATION_MANIFEST_INVALID');
 previous='';
 for(const entry of row.files){
  const file=record(entry,['path','mode','size','digest']),path=validPath(file.path);
  if(paths.has(path)||directories.has(path)||path<=previous)fail('PREPARATION_MANIFEST_INVALID');
  paths.add(path);previous=path;metadataInteger(file.mode,0,511);metadataDecimal(file.size);fileDigests.set(path,digest(file.digest));
 }
 if(row.schema_version===2){
  let previousLink='';const linked=new Set<string>();
  for(const value of row.symlinks as unknown[]){
   const link=record(value,['path','target','digest']),path=validPath(link.path),target=metadataText(link.target,/^[^\x00-\x1f\x7f\\]+$/,4096);
   if(path<=previousLink||paths.has(path)||directories.has(path)||target.startsWith('/')||
      Buffer.from(target,'utf8').toString('utf8')!==target||digest(link.digest)!=='sha256:'+createHash('sha256').update(target,'utf8').digest('hex'))fail('PREPARATION_MANIFEST_INVALID');
   previousLink=path;paths.add(path);
  }
  let previousGroup='';
  for(const value of row.hardlinks as unknown[]){
   const group=record(value,['paths']);
   if(!Array.isArray(group.paths)||group.paths.length<2)fail('PREPARATION_MANIFEST_INVALID');
   let prior='';let common:string|undefined;
   for(const item of group.paths){
    const path=validPath(item),content=fileDigests.get(path);
    if(path<=prior||!content||linked.has(path)||(common!==undefined&&common!==content))fail('PREPARATION_MANIFEST_INVALID');
    linked.add(path);prior=path;common=content;
   }
   const first=group.paths[0] as string;
   if(first<=previousGroup)fail('PREPARATION_MANIFEST_INVALID');previousGroup=first;
  }
 }
 for(const path of [...paths,...directories]){
  if(path==='.')continue;
  const slash=path.lastIndexOf('/'),parent=slash<0?'.':path.slice(0,slash);
  if(!directories.has(parent))fail('PREPARATION_MANIFEST_INVALID');
 }
 const scan=record(row.scan,['policy_version','canary_counts','checks']);
 const counts=record(scan.canary_counts,['secret','identity','lease']);
 if(scan.policy_version!==1||canonicalJSON(scan.checks)!==canonicalJSON(['sensitive_paths','private_key_markers','authority_json','designated_canaries']))fail('PREPARATION_MANIFEST_INVALID');
 for(const kind of ['secret','identity','lease'])metadataInteger(counts[kind],0,64);
 const profile=row.profile as EnvironmentProfile;
 for(const pin of [profile.recipe,...profile.generated_inputs,...profile.build_config,...profile.preparation_evidence,
   ...profile.package_managers.flatMap(manager=>manager.locks)])
  if(fileDigests.get(pin.path)!==pin.digest)fail('PREPARATION_MANIFEST_INVALID');
 return value as PreparationManifest;
}
function compatibilitySortedPins<T extends {name:string}>(values:T[]):T[]{return [...values].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);}
function compatibilitySoftware(profile:EnvironmentProfile):unknown {
 return {os:profile.os,recipe:profile.recipe,toolchains:compatibilitySortedPins(profile.toolchains),
  package_managers:compatibilitySortedPins(profile.package_managers).map(manager=>({...manager,locks:[...manager.locks].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)})),
  native_agents:compatibilitySortedPins(profile.native_agents),connectors:compatibilitySortedPins(profile.connectors),
  supervisor:profile.supervisor,hyperfide:profile.hyperfide,system_packages:compatibilitySortedPins(profile.system_packages),
  repositories:[...profile.repositories].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),
  generated_inputs:[...profile.generated_inputs].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),
  build_config:[...profile.build_config].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
}
/** This compares pinned preparation inputs. It grants neither readiness nor ownership.
 * Actual tool/resource/network/credential probes must still pass on the target boot. */
export async function compareEnvironmentCompatibility(source:unknown,target:unknown):Promise<{
 compatible:boolean;evidence_digest:string;source_digest:string;target_digest:string;scope:'pinned-preparation-compatibility'
}>{
 const from=validateManifestMetadata(source),to=validateManifestMetadata(target);
 let compatible=canonicalJSON(compatibilitySoftware(from.profile))===canonicalJSON(compatibilitySoftware(to.profile));
 for(const capability of from.profile.required_capabilities)if(!to.profile.required_capabilities.includes(capability))compatible=false;
 for(const key of ['memory_bytes','disk_bytes','persistent_volume_bytes'] as const)
  if(BigInt(to.profile.resources[key])<BigInt(from.profile.resources[key]))compatible=false;
 if(to.profile.resources.cpu_millis<from.profile.resources.cpu_millis)compatible=false;
 const targetFiles=new Map(to.files.map(file=>[file.path,file.digest]));
 const pins=[...from.profile.generated_inputs,...from.profile.build_config,
  ...from.profile.package_managers.flatMap(manager=>manager.locks)];
 for(const pin of pins)if(targetFiles.get(pin.path)!==pin.digest)compatible=false;
 const evidence={schema_version:1,scope:'pinned-preparation-compatibility' as const,
  source_digest:from.digest,target_digest:to.digest,source_projection:compatibilitySoftware(from.profile),
  target_projection:compatibilitySoftware(to.profile),compatible};
 return {compatible,evidence_digest:metadataHash(evidence),source_digest:from.digest,target_digest:to.digest,
  scope:'pinned-preparation-compatibility'};
}
