# Source reference: Control services: providers and preparation

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the `providers/` subtree (including `providers/blaxel/` and `providers/railway/`) and the `preparation/` and `recovery/` subtrees of `services/hyperfide/src/`: 864 declarations in 25 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## services/hyperfide/src/preparation/checkpoint.ts

[Open source](../../services/hyperfide/src/preparation/checkpoint.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CheckpointExpected` | interface | 8 | <code>export interface CheckpointExpected {</code> |
| `RestoredCheckpointInput` | interface | 12 | <code>export interface RestoredCheckpointInput {</code> |
| `Row` | type | 17 | <code>type Row=Record&lt;string,any&gt;;</code> |
| `Entry` | interface | 18 | <code>interface Entry {path:string;kind:'file'&#124;'directory'&#124;'symlink';mode:number;size_bytes:string;digest:string&#124;null;git_blob_id?:string;target?:string}</code> |
| `IndexEntry` | interface | 19 | <code>interface IndexEntry {path:string;mode:string;object_id:string}</code> |
| `fail` | function | 22 | <code>function fail(code='CHECKPOINT_SOURCE_INVALID'):never{throw new Error(code);}</code> |
| `hash` | function | 23 | <code>function hash(bytes:Uint8Array&#124;string):string{return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}</code> |
| `identity` | function | 24 | <code>function identity(value:unknown):string{return hash(canonicalJSON(value));}</code> |
| `object` | function | 25 | <code>function object(v:unknown):Row{if(!v&#124;&#124;typeof v!=='object'&#124;&#124;Array.isArray(v)&#124;&#124;(Object.getPrototypeOf(v)!==Object.prototype&amp;&amp;Object.getPrototypeOf(v)!==null))fail();return v as Row;}</code> |
| `exact` | function | 26 | <code>function exact(v:unknown,keys:string&#91;&#93;):Row{const r=object(v);if(Object.keys(r).length!==keys.length&#124;&#124;keys.some(k=&gt;!Object.hasOwn(r,k)))fail();return r;}</code> |
| `utf8` | function | 27 | <code>function utf8(bytes:Buffer):string{const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))fail('CHECKPOINT_PATH_ENCODING_UNSUPPORTED');return text;}</code> |
| `relative` | function | 28 | <code>function relative(value:string):void{if(!value&#124;&#124;Buffer.byteLength(value)&gt;4096&#124;&#124;value.includes('&#92;0')&#124;&#124;value.startsWith('/')&#124;&#124;value.split('/').some(p=&gt;!p&#124;&#124;p==='.'&#124;&#124;p==='..'&#124;&#124;p==='.git'))fail('CHECKPOINT…</code> |
| `same` | function | 29 | <code>function same(a:fs.BigIntStats,b:fs.BigIntStats):boolean{return a.dev===b.dev&amp;&amp;a.ino===b.ino&amp;&amp;a.size===b.size&amp;&amp;a.mode===b.mode&amp;&amp;a.mtimeNs===b.mtimeNs&amp;&amp;a.ctimeNs===b.ctimeNs&amp;&amp;a.nlink===b.nlink;}</code> |
| `ordered` | function | 30 | <code>function ordered&lt;T extends {path:string}&gt;(items:T&#91;&#93;):T&#91;&#93;{return items.sort((a,b)=&gt;Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));}</code> |
| `rootOpen` | function | 31 | <code>function rootOpen(name:string):number{</code> |
| `metadata` | function | 37 | <code>function metadata(bytes:Buffer):Row{</code> |
| `unpack` | function | 54 | <code>function unpack(capsule:Buffer):{metadata:Buffer;bundle:Buffer;patch:Buffer;tree:Buffer}{</code> |
| `parseTree` | function | 61 | <code>function parseTree(bytes:Buffer,algorithm:string):Entry&#91;&#93;{</code> |
| `git` | function | 78 | <code>async function git(root:string,args:string&#91;&#93;,deadline:number,signal?:AbortSignal,extra:NodeJS.ProcessEnv={},input?:Uint8Array):Promise&lt;Buffer&gt;{</code> |
| `indexEntries` | function | 89 | <code>function indexEntries(bytes:Buffer,head=false):IndexEntry&#91;&#93;{</code> |
| `inventory` | function | 99 | <code>async function inventory(rootFd:number,algorithm:string,deadline:number,signal?:AbortSignal):Promise&lt;Entry&#91;&#93;&gt;{</code> |
| `roles` | function | 132 | <code>function roles(manifest:PreparationManifest,key:string,entries:Entry&#91;&#93;):Row{</code> |
| `validateRestoredCheckpoint` | function | 147 | <code>export async function validateRestoredCheckpoint(input:RestoredCheckpointInput):Promise&lt;Row&gt;{</code> |

## services/hyperfide/src/preparation/effective.ts

[Open source](../../services/hyperfide/src/preparation/effective.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FilePin` | type | 5 | <code>type FilePin={path:string;digest:string};</code> |
| `SubmodulePin` | type | 6 | <code>type SubmodulePin={path:string;commit:string};</code> |
| `EffectiveResultSource` | interface | 7 | <code>export interface EffectiveResultSource {</code> |
| `RegisteredResultRepository` | interface | 12 | <code>export interface RegisteredResultRepository {</code> |
| `MeasuredResultInputs` | interface | 15 | <code>export interface MeasuredResultInputs {</code> |
| `EffectiveProfileInput` | interface | 19 | <code>export interface EffectiveProfileInput {</code> |
| `refuse` | function | 26 | <code>function refuse():never{throw new Error('EFFECTIVE_PROFILE_INPUT_INVALID');}</code> |
| `canonical` | function | 27 | <code>function canonical(value:unknown):string{</code> |
| `hash` | function | 35 | <code>function hash(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}</code> |
| `record` | function | 36 | <code>function record(value:unknown,keys:readonly string&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `text` | function | 43 | <code>function text(value:unknown,pattern:RegExp,max:number):string{</code> |
| `uuid` | function | 46 | <code>function uuid(value:unknown):string{return text(value,/^&#91;0-9a-f&#93;{8}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{12}$/,36);}</code> |
| `digest` | function | 47 | <code>function digest(value:unknown):string{return text(value,/^sha256:&#91;0-9a-f&#93;{64}$/,71);}</code> |
| `oid` | function | 48 | <code>function oid(value:unknown):string{return text(value,/^(?:&#91;0-9a-f&#93;{40}&#124;&#91;0-9a-f&#93;{64})$/,64);}</code> |
| `relative` | function | 49 | <code>function relative(value:unknown):string{</code> |
| `pins` | function | 53 | <code>function pins(profile:EnvironmentProfile):FilePin&#91;&#93;{</code> |
| `deriveEffectiveProfile` | function | 61 | <code>export function deriveEffectiveProfile(input:EffectiveProfileInput):{</code> |
| `PreparationRecipePolicy` | interface | 142 | <code>export interface PreparationRecipePolicy {</code> |
| `policyError` | function | 148 | <code>function policyError(code:string):never{throw new Error(code);}</code> |
| `policyKeys` | function | 149 | <code>function policyKeys(source:string):void{</code> |
| `readPreparationRecipePolicy` | function | 164 | <code>export function readPreparationRecipePolicy(parent:PreparationManifest,recipeBytes:Uint8Array):PreparationRecipePolicy {</code> |

## services/hyperfide/src/preparation/manifests.ts

[Open source](../../services/hyperfide/src/preparation/manifests.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `VersionPin` | interface | 6 | <code>export interface VersionPin { name: string; version: string }</code> |
| `FilePin` | interface | 7 | <code>export interface FilePin { path: string; digest: string }</code> |
| `EnvironmentProfile` | interface | 8 | <code>export interface EnvironmentProfile {</code> |
| `InventoryEntry` | interface | 24 | <code>export interface InventoryEntry { path: string; mode: number; size: string; digest: string }</code> |
| `DirectoryEntry` | interface | 25 | <code>export interface DirectoryEntry { path: string; mode: number }</code> |
| `ScanPolicy` | interface | 26 | <code>interface ScanPolicy { secret_canaries: string&#91;&#93;; identity_canaries: string&#91;&#93;; lease_canaries: string&#91;&#93; }</code> |
| `ScanDeclaration` | interface | 27 | <code>interface ScanDeclaration {</code> |
| `SymlinkEntry` | interface | 30 | <code>export interface SymlinkEntry { path: string; target: string; digest: string }</code> |
| `HardlinkGroup` | interface | 31 | <code>export interface HardlinkGroup { paths: string&#91;&#93; }</code> |
| `PreparationManifest` | interface | 32 | <code>export interface PreparationManifest {</code> |
| `InventoryContext` | type | 36 | <code>type InventoryContext = Pick&lt;ComponentContext, 'env' &#124; 'signal'&gt;;</code> |
| `operatingLimits` | function | 38 | <code>function operatingLimits(context: InventoryContext): { files: number; fileBytes: number; totalBytes: number; depth: number; directories: number } {</code> |
| `fail` | function | 54 | <code>function fail(reason: string): never { throw new Error('Preparation refused: ' + reason); }</code> |
| `record` | function | 55 | <code>function record(value: unknown, keys: string&#91;&#93;): Record&lt;string, unknown&gt; {</code> |
| `text` | function | 62 | <code>function text(value: unknown, maximum = 256): string {</code> |
| `id` | function | 66 | <code>function id(value: unknown): string {</code> |
| `version` | function | 69 | <code>function version(value: unknown): string {</code> |
| `relative` | function | 75 | <code>function relative(value: unknown): string {</code> |
| `digest` | function | 81 | <code>function digest(value: unknown): string {</code> |
| `decimal` | function | 84 | <code>function decimal(value: unknown, positive: boolean): string {</code> |
| `integer` | function | 89 | <code>function integer(value: unknown, minimum: number): number {</code> |
| `list` | function | 92 | <code>function list&lt;T&gt;(value: unknown, mapper: (item: unknown) =&gt; T, minimum = 0, maximum = 256): T&#91;&#93; {</code> |
| `unique` | function | 95 | <code>function unique&lt;T&gt;(values: T&#91;&#93;, key: (item: T) =&gt; string): T&#91;&#93; {</code> |
| `ids` | function | 98 | <code>function ids(value: unknown, minimum = 0): string&#91;&#93; { return unique(list(value, id, minimum), item =&gt; item); }</code> |
| `pin` | function | 99 | <code>function pin(value: unknown): VersionPin {</code> |
| `pins` | function | 102 | <code>function pins(value: unknown, minimum = 0): VersionPin&#91;&#93; { return unique(list(value, pin, minimum), item =&gt; item.name); }</code> |
| `filePin` | function | 103 | <code>function filePin(value: unknown): FilePin {</code> |
| `filePins` | function | 106 | <code>function filePins(value: unknown, minimum = 0): FilePin&#91;&#93; { return unique(list(value, filePin, minimum), item =&gt; item.path); }</code> |
| `commit` | function | 107 | <code>function commit(value: unknown): string {</code> |
| `timestamp` | function | 110 | <code>function timestamp(value: unknown): string {</code> |
| `repositoryURL` | function | 117 | <code>function repositoryURL(value: unknown): string {</code> |
| `validateProfile` | function | 125 | <code>export function validateProfile(input: unknown): EnvironmentProfile {</code> |
| `scanPolicy` | function | 177 | <code>function scanPolicy(input: unknown): ScanPolicy {</code> |
| `canonicalJSON` | function | 185 | <code>export function canonicalJSON(value: unknown): string {</code> |
| `sha` | function | 193 | <code>function sha(bytes: Buffer &#124; string): string { return 'sha256:' + createHash('sha256').update(bytes).digest('hex'); }</code> |
| `declaration` | function | 194 | <code>function declaration(policy: ScanPolicy): ScanDeclaration {</code> |
| `sensitivePath` | function | 198 | <code>function sensitivePath(filename: string): boolean {</code> |
| `authorityKeys` | variable | 204 | <code>const authorityKeys = new Set(&#91;'lease_token','lease_id','agent_session_id','ownership_generation','enrollment_token',</code> |
| `authorityJSON` | function | 206 | <code>function authorityJSON(value: unknown, depth = 0): void {</code> |
| `lexicalAuthority` | function | 214 | <code>function lexicalAuthority(value: string): void {</code> |
| `privateKeyMaterial` | function | 235 | <code>function privateKeyMaterial(value: string): boolean {</code> |
| `scanBytes` | function | 248 | <code>function scanBytes(bytes: Buffer, policy: ScanPolicy, json: boolean): void {</code> |
| `Stat` | type | 260 | <code>type Stat = fs.BigIntStats;</code> |
| `same` | function | 261 | <code>function same(before: Stat, after: Stat): boolean {</code> |
| `stat` | function | 265 | <code>function stat(fd: number): Stat { return fs.fstatSync(fd, { bigint: true }); }</code> |
| `mode` | function | 266 | <code>function mode(info: Stat): number {</code> |
| `names` | function | 269 | <code>function names(fd: number): string&#91;&#93; {</code> |
| `inventory` | function | 281 | <code>async function inventory(candidate: string, context: InventoryContext, policy: ScanPolicy, allowSymlinks: boolean): Promise&lt;{ files: InventoryEntry&#91;&#93;; directories: DirectoryEntry&#91;&#93;; symlinks: SymlinkE…</code> |
| `validateLinkGraph` | function | 452 | <code>async function validateLinkGraph(files: InventoryEntry&#91;&#93;, directories: DirectoryEntry&#91;&#93;, links: SymlinkEntry&#91;&#93;, signal: AbortSignal): Promise&lt;void&gt; {</code> |
| `pinInventory` | function | 483 | <code>function pinInventory(profile: EnvironmentProfile, files: InventoryEntry&#91;&#93;): void {</code> |
| `make` | function | 489 | <code>async function make(input: unknown, context: InventoryContext, verifying: boolean): Promise&lt;PreparationManifest&gt; {</code> |
| `createManifest` | function | 514 | <code>export async function createManifest(input: unknown, context: InventoryContext): Promise&lt;PreparationManifest&gt; { return make(input, context, false); }</code> |
| `verifyManifest` | function | 516 | <code>export async function verifyManifest(input: unknown, context: InventoryContext): Promise&lt;{ valid: true; digest: string; file_count: number }&gt; {</code> |
| `createComponent` | function | 519 | <code>export function createComponent(_context: InventoryContext): Component {</code> |
| `metadataHash` | function | 528 | <code>function metadataHash(value:unknown):string{return sha(canonicalJSON(value));}</code> |
| `metadataText` | function | 529 | <code>function metadataText(value:unknown,pattern:RegExp,max=256):string{</code> |
| `metadataInteger` | function | 532 | <code>function metadataInteger(value:unknown,min:number,max:number):number{</code> |
| `metadataDecimal` | function | 535 | <code>function metadataDecimal(value:unknown):string{</code> |
| `validateManifestMetadata` | function | 538 | <code>export function validateManifestMetadata(value:unknown):PreparationManifest{</code> |
| `compatibilitySortedPins` | function | 604 | <code>function compatibilitySortedPins&lt;T extends {name:string}&gt;(values:T&#91;&#93;):T&#91;&#93;{return &#91;...values&#93;.sort((a,b)=&gt;a.name&lt;b.name?-1:a.name&gt;b.name?1:0);}</code> |
| `compatibilitySoftware` | function | 605 | <code>function compatibilitySoftware(profile:EnvironmentProfile):unknown {</code> |
| `compareEnvironmentCompatibility` | function | 616 | <code>export async function compareEnvironmentCompatibility(source:unknown,target:unknown):Promise&lt;{</code> |

## services/hyperfide/src/preparation/prewarm.ts

[Open source](../../services/hyperfide/src/preparation/prewarm.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SchedulerCapability` | interface | 19 | <code>interface SchedulerCapability {eligibleDemand:typeof eligibleDemand;reserveCapacity:typeof reserveDynamic}</code> |
| `fail` | function | 21 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `invocationOf` | function | 22 | <code>function invocationOf(context:ComponentContext):InvocationContext{const value=context.invocation;assertInvocation(value);return value;}</code> |
| `requireRole` | function | 23 | <code>function requireRole(invocation:InvocationContext,roles:readonly string&#91;&#93;):void{</code> |
| `boundedInteger` | function | 26 | <code>function boundedInteger(value:string&#124;undefined,fallback:number,min:number,max:number):number{</code> |
| `retryPolicy` | function | 32 | <code>export function retryPolicy(env:Readonly&lt;NodeJS.ProcessEnv&gt;):{max_attempts:number;backoff_base_ms:number;backoff_max_ms:number}{</code> |
| `primary` | function | 39 | <code>function primary&lt;T&gt;(context:ComponentContext,invocation:InvocationContext,body:(tx:PrimaryTransaction)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `target` | function | 42 | <code>async function target(context:ComponentContext,tx:PrimaryTransaction,pool_id:string):Promise&lt;PreparationTarget&gt;{</code> |
| `acceptedManifest` | function | 47 | <code>async function acceptedManifest(tx:PrimaryTransaction,organisation:string,profile:string,preparation:string):Promise&lt;unknown&gt;{</code> |
| `resolveCurrent` | function | 52 | <code>async function resolveCurrent(context:ComponentContext,tx:PrimaryTransaction,organisation:string,pool_id:string,profile_id:string,job_class:PreparationJobClass){</code> |
| `cachedBase` | function | 62 | <code>async function cachedBase(tx:PrimaryTransaction,organisation:string,pool_id:string,profile_id:string,current:PreparationTarget):Promise&lt;string&#124;null&gt;{</code> |
| `jobClass` | function | 67 | <code>function jobClass(value:unknown):PreparationJobClass{</code> |
| `placementClass` | function | 70 | <code>function placementClass(job:PreparationJobClass):'dependency_preparation'&#124;'indexing'{</code> |
| `utcAfter` | function | 76 | <code>function utcAfter(ms:number):string{return new Date(Date.now()+ms).toISOString();}</code> |
| `publicJob` | function | 77 | <code>function publicJob(row:PreparationJobRow&amp;Record&lt;string,unknown&gt;):Record&lt;string,unknown&gt;{</code> |
| `createComponent` | function | 86 | <code>export function createComponent(context:ComponentContext):Component{</code> |
| `remoteReport` | function | 172 | <code>function remoteReport(value:unknown):RemoteReport{</code> |
| `lockJob` | function | 188 | <code>async function lockJob(tx:PrimaryTransaction,invocation:InvocationContext,id:string):Promise&lt;PreparationJobRow&amp;Record&lt;string,unknown&gt;&gt;{</code> |
| `providerFailure` | function | 193 | <code>function providerFailure(error:unknown):{failure_class:FailureClass;code:string;message:string}{</code> |
| `createProvisionerComponent` | function | 199 | <code>export function createProvisionerComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/preparation/recipe.ts

[Open source](../../services/hyperfide/src/preparation/recipe.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PreparationJobClass` | type | 10 | <code>export type PreparationJobClass='PREPARATION'&#124;'INDEX';</code> |
| `PreparationPlan` | interface | 12 | <code>export interface PreparationPlan {</code> |
| `ResolvedPreparation` | interface | 20 | <code>export interface ResolvedPreparation {identity:string;plan:PreparationPlan;plan_digest:string;recipe_digest:string}</code> |
| `fail` | function | 22 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `sha` | function | 23 | <code>const sha=(value:string&#124;Uint8Array)=&gt;'sha256:'+createHash('sha256').update(value).digest('hex');</code> |
| `planDigest` | function | 24 | <code>export const planDigest=(plan:PreparationPlan)=&gt;sha(canonicalJSON(plan));</code> |
| `readTrustedRecipe` | function | 27 | <code>export async function readTrustedRecipe(env:Readonly&lt;NodeJS.ProcessEnv&gt;,digest:string):Promise&lt;Uint8Array&gt;{</code> |
| `resolvePreparationPlan` | function | 45 | <code>export function resolvePreparationPlan(input:{manifest:unknown;recipe:Uint8Array;configuration_digest:string;job_class:PreparationJobClass}):ResolvedPreparation{</code> |

## services/hyperfide/src/preparation/seal.ts

[Open source](../../services/hyperfide/src/preparation/seal.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FailureClass` | type | 7 | <code>export type FailureClass='PROVIDER_UNAVAILABLE'&#124;'PROVIDER_FAILED'&#124;'PACKAGE_FAILURE'&#124;'PARTIAL_DOWNLOAD'&#124;'READINESS_FAILED'&#124;'OBSOLETE_MANIFEST';</code> |
| `PreparationJobRow` | interface | 8 | <code>export interface PreparationJobRow {</code> |
| `PreparationTarget` | interface | 14 | <code>export interface PreparationTarget {provider:'railway'&#124;'blaxel';configuration_digest:string;preparation_digest:string;profile_id:string&#124;null}</code> |
| `RemoteReport` | interface | 15 | <code>export interface RemoteReport {</code> |
| `Classification` | type | 21 | <code>export type Classification={ok:true}&#124;{ok:false;failure_class:FailureClass;retryable:boolean;detail:string};</code> |
| `fail` | function | 23 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `documentDigest` | function | 24 | <code>export const documentDigest=(value:unknown)=&gt;'sha256:'+createHash('sha256').update(canonicalJSON(value)).digest('hex');</code> |
| `record` | function | 25 | <code>function record(value:unknown,label:string):Record&lt;string,unknown&gt;{</code> |
| `digest` | function | 28 | <code>const digest=(value:unknown)=&gt;typeof value==='string'&amp;&amp;/^sha256:&#91;0-9a-f&#93;{64}$/.test(value);</code> |
| `isObsolete` | function | 31 | <code>export function isObsolete(job:PreparationJobRow,target:PreparationTarget):boolean{</code> |
| `classifyRemoteReport` | function | 40 | <code>export function classifyRemoteReport(job:PreparationJobRow,report:RemoteReport,target:PreparationTarget):Classification{</code> |
| `backoffMs` | function | 62 | <code>export function backoffMs(job:Pick&lt;PreparationJobRow,'backoff_base_ms'&#124;'backoff_max_ms'&gt;,attempt:number):number{</code> |
| `retainDiagnostics` | function | 67 | <code>export async function retainDiagnostics(tx:PrimaryTransaction,job:PreparationJobRow,attempt:number,diagnostics:Record&lt;string,unknown&gt;):Promise&lt;string&gt;{</code> |
| `finishAttempt` | function | 76 | <code>export async function finishAttempt(tx:PrimaryTransaction,job:PreparationJobRow,attempt:number,result:{outcome:'SUCCEEDED'}&#124;{outcome:'FAILURE';failure_class:FailureClass;retryable:boolean},</code> |
| `markObsoleteBases` | function | 97 | <code>export async function markObsoleteBases(tx:PrimaryTransaction,job:Pick&lt;PreparationJobRow,'organisation_id'&#124;'pool_id'&#124;'profile_id'&gt;,target:PreparationTarget):Promise&lt;string&#91;&#93;&gt;{</code> |
| `requireCompleteArtifacts` | function | 105 | <code>export async function requireCompleteArtifacts(tx:PrimaryTransaction,job:PreparationJobRow,digests:readonly string&#91;&#93;):Promise&lt;void&gt;{</code> |
| `sealPreparedBase` | function | 118 | <code>export async function sealPreparedBase(tx:PrimaryTransaction,job:PreparationJobRow,report:RemoteReport,target:PreparationTarget,</code> |

## services/hyperfide/src/providers/blaxel/images.ts

[Open source](../../services/hyperfide/src/providers/blaxel/images.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Obj` | type | 17 | <code>type Obj=Record&lt;string,unknown&gt;;</code> |
| `ImageRecipe` | interface | 18 | <code>interface ImageRecipe{</code> |
| `StoragePlan` | interface | 22 | <code>interface StoragePlan{</code> |
| `PackageProbe` | interface | 28 | <code>interface PackageProbe{ecosystem:'node'&#124;'python';name:string;version:string}</code> |
| `ProbeRequirements` | interface | 29 | <code>interface ProbeRequirements{packages:PackageProbe&#91;&#93;;compile_c:boolean}</code> |
| `BlaxelImagePlan` | interface | 30 | <code>export interface BlaxelImagePlan{</code> |
| `fail` | function | 34 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `shape` | function | 35 | <code>function shape(value:unknown,keys:readonly string&#91;&#93;):Obj{</code> |
| `text` | function | 39 | <code>function text(v:unknown,max=256):string{</code> |
| `number` | function | 42 | <code>function number(v:unknown,min:number,max:number):number{</code> |
| `bytes` | function | 45 | <code>function bytes(v:unknown,positive=false):string{</code> |
| `relative` | function | 48 | <code>function relative(v:unknown):string{</code> |
| `absolute` | function | 51 | <code>function absolute(v:unknown):string{</code> |
| `imageRef` | function | 54 | <code>function imageRef(v:unknown):string{</code> |
| `hash` | function | 57 | <code>function hash(v:unknown):string{return 'sha256:'+createHash('sha256').update(canonicalJSON(v)).digest('hex');}</code> |
| `unique` | function | 58 | <code>function unique&lt;T&gt;(a:T&#91;&#93;,key:(v:T)=&gt;string):T&#91;&#93;{if(new Set(a.map(key)).size!==a.length)fail('BLAXEL_IMAGE_INVALID','Duplicate requirement');return a;}</code> |
| `array` | function | 59 | <code>function array&lt;T&gt;(v:unknown,f:(v:unknown)=&gt;T,min=0):T&#91;&#93;{if(!Array.isArray(v)&#124;&#124;v.length&lt;min&#124;&#124;v.length&gt;128)fail('BLAXEL_IMAGE_INVALID','Invalid bounded list');return v.map(f);}</code> |
| `under` | function | 60 | <code>function under(p:string,root:string):boolean{return p===root&#124;&#124;p.startsWith(root+'/');}</code> |
| `recipe` | function | 61 | <code>function recipe(v:unknown):ImageRecipe{</code> |
| `storage` | function | 67 | <code>function storage(v:unknown,manifest:PreparationManifest):StoragePlan{</code> |
| `probes` | function | 83 | <code>function probes(v:unknown):ProbeRequirements{</code> |
| `candidatePath` | function | 89 | <code>async function candidatePath(value:unknown,ctx:ComponentContext):Promise&lt;string&gt;{</code> |
| `validateCandidate` | function | 93 | <code>async function validateCandidate(candidate:string,manifest:PreparationManifest,scan_policy:unknown,ctx:ComponentContext):Promise&lt;void&gt;{</code> |
| `rendered` | function | 97 | <code>function rendered(i:ImageRecipe):{dockerfile:string;blaxel_toml:string}{</code> |
| `planBlaxelImage` | function | 102 | <code>export async function planBlaxelImage(value:unknown,ctx:ComponentContext):Promise&lt;BlaxelImagePlan&gt;{</code> |
| `validateBlaxelImagePlan` | function | 110 | <code>export function validateBlaxelImagePlan(value:unknown):BlaxelImagePlan{</code> |
| `rejectTemplateLinks` | function | 118 | <code>async function rejectTemplateLinks(root:string,p:StoragePlan):Promise&lt;void&gt;{</code> |
| `ProcessObservation` | interface | 124 | <code>interface ProcessObservation{exit_code:number&#124;null;stdout:string;stderr:string;timed_out:boolean}</code> |
| `runBlaxelCommand` | function | 126 | <code>export async function runBlaxelCommand(argv:string&#91;&#93;,cwd:string,env:NodeJS.ProcessEnv,timeout:number,signal:AbortSignal):Promise&lt;ProcessObservation&gt;{</code> |
| `tools` | function | 141 | <code>function tools(p:BlaxelImagePlan):Array&lt;{name:string;version:string}&gt;{</code> |
| `shell` | function | 145 | <code>function shell(v:string):string{return "'"+v.replaceAll("'","'&#92;&#92;''")+"'";}</code> |
| `blaxelCredentials` | function | 146 | <code>export function blaxelCredentials(ctx:Pick&lt;ComponentContext,'env'&gt;):{workspace:string;apiKey:string}{</code> |
| `assertSDKConfiguration` | function | 150 | <code>async function assertSDKConfiguration():Promise&lt;void&gt;{</code> |
| `BlaxelRuntimeSDK` | interface | 165 | <code>export interface BlaxelRuntimeSDK {</code> |
| `setConfig` | method | 166 | <code>settings:{readonly baseUrl:string;readonly runUrl:string;setConfig(config:{apiKey:string;workspace:string;maxConcurrentH2Requests:number;maxConcurrentUploadH2Requests:number;fsPartRetries:number;sandb…</code> |
| `get` | method | 167 | <code>SandboxInstance:{get(name:string):Promise&lt;{process:{exec(request:{command:string;workingDir:string;waitForCompletion:boolean;timeout:number;keepAlive:boolean}):Promise&lt;unknown&gt;}}&gt;};</code> |
| `exec` | method | 167 | <code>SandboxInstance:{get(name:string):Promise&lt;{process:{exec(request:{command:string;workingDir:string;waitForCompletion:boolean;timeout:number;keepAlive:boolean}):Promise&lt;unknown&gt;}}&gt;};</code> |
| `configuredBlaxelSDK` | function | 170 | <code>export async function configuredBlaxelSDK(ctx:Pick&lt;ComponentContext,'env'&gt;):Promise&lt;BlaxelRuntimeSDK&gt;{</code> |
| `inspectBlaxelImage` | function | 185 | <code>export async function inspectBlaxelImage(value:unknown,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `copyContext` | function | 202 | <code>async function copyContext(candidate:string,manifest:PreparationManifest,destination:string,signal:AbortSignal,deadline:number):Promise&lt;void&gt;{</code> |
| `blaxelImageOperationReference` | function | 237 | <code>export function blaxelImageOperationReference(plan:BlaxelImagePlan):string{return 'hyperfide/blaxel-plan@'+plan.plan_digest;}</code> |
| `publishBlaxelImage` | function | 238 | <code>export async function publishBlaxelImage(value:unknown,ctx:ComponentContext):Promise&lt;ProviderOutcome&lt;'prepare'&gt;&gt;{</code> |
| `createComponent` | function | 256 | <code>export function createComponent(_ctx:ComponentContext):Component{return{apiVersion:1,actions:{</code> |

## services/hyperfide/src/providers/blaxel/lifetime.ts

[Open source](../../services/hyperfide/src/providers/blaxel/lifetime.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Obj` | type | 5 | <code>type Obj=Record&lt;string,unknown&gt;;</code> |
| `BlaxelLifetimePolicy` | interface | 6 | <code>export interface BlaxelLifetimePolicy {</code> |
| `LifetimeObservation` | interface | 12 | <code>export interface LifetimeObservation {</code> |
| `fail` | function | 17 | <code>function fail(message:string):never{throw new FoundationError('BLAXEL_LIFETIME_INVALID',message);}</code> |
| `shape` | function | 18 | <code>function shape(v:unknown,keys:string&#91;&#93;):Obj{</code> |
| `integer` | function | 22 | <code>function integer(v:unknown,min=0,max=315360000):number{</code> |
| `instant` | function | 25 | <code>function instant(v:unknown):number{</code> |
| `durationSeconds` | function | 28 | <code>export function durationSeconds(v:unknown):number{</code> |
| `validateBlaxelLifetimePolicy` | function | 35 | <code>export function validateBlaxelLifetimePolicy(value:unknown):BlaxelLifetimePolicy{</code> |
| `blaxelProcessLifetimeOptions` | function | 56 | <code>export function blaxelProcessLifetimeOptions(policy:BlaxelLifetimePolicy):{keepAlive:true;timeout:0;waitForCompletion:false;restartOnFailure:false;maxRestarts:0}{</code> |
| `blaxelSandboxLifetimeOptions` | function | 61 | <code>export function blaxelSandboxLifetimeOptions(policy:BlaxelLifetimePolicy):{</code> |
| `observation` | function | 69 | <code>function observation(v:unknown):LifetimeObservation{</code> |
| `assessBlaxelLifetime` | function | 79 | <code>export function assessBlaxelLifetime(value:unknown):unknown{</code> |
| `boundedBlaxelRead` | function | 108 | <code>export async function boundedBlaxelRead&lt;T&gt;(read:(signal:AbortSignal)=&gt;Promise&lt;T&gt;,signal:AbortSignal,deadline:number):Promise&lt;T&gt;{</code> |
| `observeBlaxelLifetime` | function | 125 | <code>export async function observeBlaxelLifetime(value:unknown,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `get` | method | 131 | <code>const actual=sandbox as unknown as {metadata:unknown;spec:unknown;expiresIn:unknown;lastUsedAt:unknown;process:{get(id:string,options:{signal:AbortSignal;retry:boolean}):Promise&lt;unknown&gt;}};</code> |
| `createComponent` | function | 147 | <code>export function createComponent(_ctx:ComponentContext):Component{return{apiVersion:1,actions:{</code> |

## services/hyperfide/src/providers/blaxel/processes.ts

[Open source](../../services/hyperfide/src/providers/blaxel/processes.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Obj` | type | 14 | <code>type Obj=Record&lt;string,unknown&gt;;</code> |
| `fail` | function | 16 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `object` | function | 17 | <code>function object(v:unknown):Obj{</code> |
| `shape` | function | 21 | <code>function shape(v:unknown,keys:string&#91;&#93;):Obj{const o=object(v);if(Object.keys(o).length!==keys.length&#124;&#124;keys.some(k=&gt;!Object.hasOwn(o,k)))fail('BLAXEL_PROCESS_INVALID','Missing or unknown field');return…</code> |
| `text` | function | 22 | <code>function text(v:unknown,max=4096):string{if(typeof v!=='string'&#124;&#124;!v.length&#124;&#124;v.length&gt;max&#124;&#124;v.includes('&#92;0'))fail('BLAXEL_PROCESS_INVALID','Bounded string required');return v;}</code> |
| `canonical` | function | 23 | <code>function canonical(v:unknown):string{</code> |
| `digest` | function | 28 | <code>function digest(v:unknown):string{return 'sha256:'+createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');}</code> |
| `bytesDigest` | function | 29 | <code>function bytesDigest(v:Uint8Array):string{return 'sha256:'+createHash('sha256').update(v).digest('hex');}</code> |
| `equal` | function | 30 | <code>function equal(a:unknown,b:unknown):boolean{return canonical(a)===canonical(b);}</code> |
| `nativeName` | function | 31 | <code>function nativeName(v:unknown):string{const n=text(v,49);if(!/^&#91;a-z0-9&#93;&#91;a-z0-9-&#93;&#42;$/.test(n))fail('BLAXEL_PROCESS_INVALID','Invalid native sandbox name');return n;}</code> |
| `shell` | function | 32 | <code>function shell(v:string):string{return "'"+v.replaceAll("'","'&#92;&#92;''")+"'";}</code> |
| `statusCode` | function | 33 | <code>function statusCode(e:unknown):number&#124;null{if(e&amp;&amp;typeof e==='object'){const o=e as Obj;for(const v of &#91;o.status,o.statusCode,(o.response as Obj&#124;undefined)?.status&#93;)if(typeof v==='number')return v;}ret…</code> |
| `processName` | function | 34 | <code>function processName(operation:ProviderOperation&lt;'execute'&gt;):string{return 'hf-'+digest({operation_id:operation.identity.operation_id,payload_digest:operation.identity.payload_digest,resource:operatio…</code> |
| `scopeDigest` | function | 35 | <code>function scopeDigest(scope:ProviderScope):string{return digest(scope);}</code> |
| `requireOperation` | function | 36 | <code>function requireOperation&lt;T extends ProviderMethod&gt;(raw:unknown,kind:T,scope:ProviderScope):ProviderOperation&lt;T&gt;{</code> |
| `CapturedBlaxelOutput` | interface | 40 | <code>export interface CapturedBlaxelOutput{stdout:Uint8Array;stderr:Uint8Array;exit_code:number;complete:true;spool_digest:string;capture:{schema_version:1;scheme:'STREAM_DIGESTS_CANONICAL_JSON'}}</code> |
| `BlaxelProcessRecord` | interface | 41 | <code>export interface BlaxelProcessRecord{native_process_ref?:string&#124;null;process_ref:string;payload_digest:string;resource:ResourceRef;state:'SUBMITTED'&#124;'RUNNING'&#124;'EXITED'&#124;'UNKNOWN';provider_metadata:Reco…</code> |
| `BlaxelPersistenceHooks` | interface | 42 | <code>export interface BlaxelPersistenceHooks{</code> |
| `persistEarlyProcess` | method | 43 | <code>persistEarlyProcess(operation:ProviderOperation&lt;'execute'&gt;,nativeProcessRef:string):Promise&lt;void&gt;;</code> |
| `resolveResourceBinding` | method | 45 | <code>resolveResourceBinding(operation:ProviderOperation):Promise&lt;{organisation_id:string;run_id:string;sandbox_id:string;boot_id:string;boot_generation:string}&gt;;</code> |
| `resolvePreparation` | method | 46 | <code>resolvePreparation(operation:ProviderOperation&lt;'create'&gt;):Promise&lt;{purpose:'PREPARATION'&#124;'EXECUTION';scope:ProviderScope;preparation_digest:string;parameters:ProviderOperation&lt;'create'&gt;&#91;'parameters'&#93;;…</code> |
| `claimProcess` | method | 47 | <code>claimProcess(operation:ProviderOperation&lt;'execute'&gt;,record:BlaxelProcessRecord):Promise&lt;{disposition:'NEW'&#124;'EXISTING';record:BlaxelProcessRecord}&gt;;</code> |
| `resolveProcess` | method | 48 | <code>resolveProcess(operation:ProviderOperation,processRef:string):Promise&lt;BlaxelProcessRecord&#124;null&gt;;</code> |
| `assignedBootGeneration` | method | 49 | <code>assignedBootGeneration(operation:ProviderOperation&lt;'create'&gt;):Promise&lt;string&gt;;</code> |
| `persistEarlyResource` | method | 50 | <code>persistEarlyResource(operation:ProviderOperation&lt;'create'&gt;,nativeSandboxId:string):Promise&lt;ResourceRef&gt;;</code> |
| `recordObservation` | method | 51 | <code>recordObservation(operation:ProviderOperation,outcome:ProviderOutcome):Promise&lt;void&gt;;</code> |
| `assertResourceBinding` | method | 52 | <code>assertResourceBinding(operation:ProviderOperation):Promise&lt;void&gt;;</code> |
| `QualifiedBlaxelBase` | interface | 54 | <code>export interface QualifiedBlaxelBase{</code> |
| `BlaxelTrustedDependencies` | interface | 62 | <code>export interface BlaxelTrustedDependencies{</code> |
| `resolvePreparedBase` | method | 63 | <code>resolvePreparedBase(operation:ProviderOperation&lt;'create'&gt;):Promise&lt;QualifiedBlaxelBase&gt;;</code> |
| `resolveCredentialReferences` | method | 64 | <code>resolveCredentialReferences(operation:ProviderOperation&lt;'execute'&gt;,refs:Record&lt;string,string&gt;,signal:AbortSignal):Promise&lt;Record&lt;string,string&gt;&gt;;</code> |
| `assertPreparedResource` | method | 65 | <code>assertPreparedResource(operation:ProviderOperation):Promise&lt;void&gt;;</code> |
| `BlaxelProcess` | interface | 68 | <code>interface BlaxelProcess{</code> |
| `get` | method | 69 | <code>get(id:string,options?:{signal?:AbortSignal;retry?:boolean}):Promise&lt;Obj&gt;;</code> |
| `exec` | method | 70 | <code>exec(request:Obj):Promise&lt;Obj&gt;;stop(id:string):Promise&lt;Obj&gt;;kill(id:string):Promise&lt;Obj&gt;;</code> |
| `stop` | method | 70 | <code>exec(request:Obj):Promise&lt;Obj&gt;;stop(id:string):Promise&lt;Obj&gt;;kill(id:string):Promise&lt;Obj&gt;;</code> |
| `kill` | method | 70 | <code>exec(request:Obj):Promise&lt;Obj&gt;;stop(id:string):Promise&lt;Obj&gt;;kill(id:string):Promise&lt;Obj&gt;;</code> |
| `writeStdin` | method | 71 | <code>writeStdin(id:string,data:Uint8Array):Promise&lt;void&gt;;closeStdin(id:string):Promise&lt;void&gt;;</code> |
| `closeStdin` | method | 71 | <code>writeStdin(id:string,data:Uint8Array):Promise&lt;void&gt;;closeStdin(id:string):Promise&lt;void&gt;;</code> |
| `BlaxelSandbox` | interface | 73 | <code>interface BlaxelSandbox{metadata:Obj;spec:Obj;status?:string;process:BlaxelProcess;fs:{readBinary(path:string):Promise&lt;Blob&gt;}}</code> |
| `readBinary` | method | 73 | <code>interface BlaxelSandbox{metadata:Obj;spec:Obj;status?:string;process:BlaxelProcess;fs:{readBinary(path:string):Promise&lt;Blob&gt;}}</code> |
| `BlaxelSDK` | interface | 74 | <code>interface BlaxelSDK{</code> |
| `createSandbox` | method | 75 | <code>createSandbox(request:{body:Obj;throwOnError:false;signal:AbortSignal}):Promise&lt;{data?:unknown;error?:unknown;response:Response}&gt;;</code> |
| `get` | method | 76 | <code>SandboxInstance:{get(name:string):Promise&lt;BlaxelSandbox&gt;;create(model:Obj,options:{safe:false;timeout:number}):Promise&lt;BlaxelSandbox&gt;;</code> |
| `create` | method | 76 | <code>SandboxInstance:{get(name:string):Promise&lt;BlaxelSandbox&gt;;create(model:Obj,options:{safe:false;timeout:number}):Promise&lt;BlaxelSandbox&gt;;</code> |
| `list` | method | 77 | <code>list(query:Obj):Promise&lt;{data:BlaxelSandbox&#91;&#93;;hasMore:boolean;nextCursor?:string}&gt;;delete(name:string):Promise&lt;unknown&gt;};</code> |
| `delete` | method | 77 | <code>list(query:Obj):Promise&lt;{data:BlaxelSandbox&#91;&#93;;hasMore:boolean;nextCursor?:string}&gt;;delete(name:string):Promise&lt;unknown&gt;};</code> |
| `runtimeSDK` | function | 79 | <code>function runtimeSDK(v:unknown):BlaxelSDK{</code> |
| `boundedBlaxelOperation` | function | 84 | <code>export async function boundedBlaxelOperation&lt;T&gt;(fn:(signal:AbortSignal)=&gt;Promise&lt;T&gt;,parent:AbortSignal,deadline:number):Promise&lt;T&gt;{</code> |
| `blaxelCaptureControl` | function | 95 | <code>export function blaxelCaptureControl(operation:ProviderOperation,contextSignal:AbortSignal,requestSignal:AbortSignal,identitySignal:AbortSignal):{deadline:number;signal:AbortSignal}{</code> |
| `blaxelCreateName` | function | 98 | <code>export function blaxelCreateName(operation:ProviderOperation&lt;'create'&gt;,generation:string):string{</code> |
| `planBlaxelCreate` | function | 102 | <code>export function planBlaxelCreate(operation:ProviderOperation&lt;'create'&gt;,generation:string,base:QualifiedBlaxelBase):Obj{</code> |
| `verifyBlaxelCreate` | function | 129 | <code>export function verifyBlaxelCreate(observation:unknown,expected:Obj,scope:ProviderScope):{matches:true;native_sandbox_id:string}{</code> |
| `retainBlaxelCreateCandidate` | function | 140 | <code>export async function retainBlaxelCreateCandidate(actual:{metadata:Obj;spec:Obj;status:string&#124;undefined},expected:Obj,scope:ProviderScope,generation:string,remember:(resource:ResourceRef)=&gt;void,persis…</code> |
| `state` | function | 149 | <code>function state(raw:string&#124;undefined):ProviderState{</code> |
| `planBlaxelProcess` | function | 186 | <code>export function planBlaxelProcess(operation:ProviderOperation&lt;'execute'&gt;):{process_ref:string;spool_path:string;launch_digest:string;request:Obj}{</code> |
| `verifyBlaxelCapturedOutput` | function | 199 | <code>export function verifyBlaxelCapturedOutput(input:{receipt:unknown;stdout:Uint8Array;stderr:Uint8Array;scope:ProviderScope;resource:ResourceRef;process_ref:string;expected:{operation_id:string;payload_…</code> |
| `noOutput` | function | 213 | <code>function noOutput(ref:string,raw:Obj):ProcessResult{</code> |
| `outcome` | function | 218 | <code>function outcome&lt;K extends ProviderMethod&gt;(op:ProviderOperation&lt;K&gt;,status:'SUCCEEDED'&#124;'FAILED'&#124;'UNKNOWN'&#124;'UNSUPPORTED',result:ProviderResults&#91;K&#93;&#124;null,resource:ResourceRef&#124;null=op.resource):ProviderOut…</code> |
| `BlaxelAdapter` | interface | 226 | <code>export interface BlaxelAdapter extends ProviderAdapter{</code> |
| `readCapturedOutput` | method | 227 | <code>readCapturedOutput(scope:ProviderScope,resource:ResourceRef,processRef:string,maxBytes:number):Promise&lt;CapturedBlaxelOutput&gt;;</code> |
| `createBlaxelAdapter` | function | 229 | <code>export function createBlaxelAdapter(scope:ProviderScope,hooks:BlaxelPersistenceHooks,deps:Partial&lt;BlaxelTrustedDependencies&gt;,ctx:ComponentContext):BlaxelAdapter{</code> |
| `BlaxelStdinLedger` | interface | 399 | <code>export interface BlaxelStdinLedger{</code> |
| `assertWritable` | method | 400 | <code>assertWritable(resource:ResourceRef,processRef:string):Promise&lt;void&gt;;</code> |
| `beginWrite` | method | 401 | <code>beginWrite(resource:ResourceRef,processRef:string,instructionId:string,bytesDigest:string,byteCount:number):Promise&lt;'NEW'&#124;'CONFIRMED'&#124;'UNKNOWN'&gt;;</code> |
| `finishWrite` | method | 402 | <code>finishWrite(resource:ResourceRef,processRef:string,instructionId:string,state:'CONFIRMED'&#124;'UNKNOWN'):Promise&lt;void&gt;;</code> |
| `writeBlaxelStdin` | function | 406 | <code>export async function writeBlaxelStdin(process:Pick&lt;BlaxelProcess,'writeStdin'&#124;'closeStdin'&gt;,ledger:BlaxelStdinLedger,resource:ResourceRef,processRef:string,instructionId:string,bytes:Uint8Array,signa…</code> |
| `RegistryCapability` | type | 414 | <code>type RegistryCapability={registerProviderAdapter(provider:'blaxel',factory:(scope:ProviderScope,hooks:BlaxelPersistenceHooks)=&gt;ProviderAdapter):()=&gt;void;registerProviderOwnershipProbe?:(provider:'blax…</code> |
| `registerProviderAdapter` | method | 414 | <code>type RegistryCapability={registerProviderAdapter(provider:'blaxel',factory:(scope:ProviderScope,hooks:BlaxelPersistenceHooks)=&gt;ProviderAdapter):()=&gt;void;registerProviderOwnershipProbe?:(provider:'blax…</code> |
| `DependencyContext` | type | 415 | <code>type DependencyContext=ComponentContext&amp;{dependencies?:{require&lt;T&gt;(id:string,name:string,guard:(v:unknown)=&gt;v is T):T}};</code> |
| `require` | method | 415 | <code>type DependencyContext=ComponentContext&amp;{dependencies?:{require&lt;T&gt;(id:string,name:string,guard:(v:unknown)=&gt;v is T):T}};</code> |
| `BlaxelCredentialAuthority` | interface | 417 | <code>interface BlaxelCredentialAuthority{</code> |
| `resolveCredentialReferences` | method | 418 | <code>resolveCredentialReferences(invocation:InvocationContext,request:{references:Array&lt;{name:string;reference_id:string}&gt;;purpose:'WORKER_PROCESS';sandbox_id:string;boot_id:string;boot_generation:string},…</code> |
| `BlaxelPrivatePolicy` | interface | 420 | <code>interface BlaxelPrivatePolicy{</code> |
| `readPrivateBlaxelPolicy` | function | 424 | <code>async function readPrivateBlaxelPolicy(ctx:ComponentContext,scope:ProviderScope,expectedDigest:string):Promise&lt;BlaxelPrivatePolicy&gt;{</code> |
| `trustedBlaxelDependencies` | function | 448 | <code>function trustedBlaxelDependencies(ctx:ComponentContext,hooks:BlaxelPersistenceHooks,credentials:BlaxelCredentialAuthority):BlaxelTrustedDependencies{</code> |
| `assertBlaxelAdministrativeScope` | function | 492 | <code>function assertBlaxelAdministrativeScope(scope:ProviderScope,ctx:Pick&lt;ComponentContext,'env'&gt;):void{</code> |
| `probeBlaxelOwnership` | function | 495 | <code>async function probeBlaxelOwnership(ctx:ComponentContext,scope:ProviderScope,operationId:string,nativeId:string,signal:AbortSignal){</code> |
| `createBlaxelIsolationTransport` | function | 502 | <code>export function createBlaxelIsolationTransport(scope:ProviderScope,ctx:Pick&lt;ComponentContext,'env'&#124;'signal'&gt;){</code> |
| `destroy` | method | 513 | <code>async destroy(raw:ProviderOperation&lt;'destroy'&gt;,signal=ctx.signal):Promise&lt;ProviderOutcome&lt;'destroy'&gt;&gt;{</code> |
| `observe` | method | 524 | <code>async observe(raw:ProviderOperation&lt;'observe'&gt;,signal=ctx.signal):Promise&lt;ProviderOutcome&lt;'observe'&gt;&gt;{</code> |
| `createComponent` | function | 537 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/providers/blaxel/recovery.ts

[Open source](../../services/hyperfide/src/providers/blaxel/recovery.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `BlaxelPreviewFeature` | type | 12 | <code>export type BlaxelPreviewFeature='environment_updates'&#124;'shared_storage'&#124;'memory_snapshot'&#124;'memory_fork';</code> |
| `BlaxelPreviewEvidence` | interface | 13 | <code>export interface BlaxelPreviewEvidence{</code> |
| `BlaxelRecoveryDependencies` | interface | 17 | <code>export interface BlaxelRecoveryDependencies{</code> |
| `readQualification` | method | 20 | <code>readQualification(scope:ProviderScope,feature:BlaxelPreviewFeature):Promise&lt;BlaxelPreviewEvidence&#124;null&gt;;</code> |
| `assertScope` | method | 21 | <code>assertScope(scope:ProviderScope):Promise&lt;void&gt;;</code> |
| `assertFreshEnrollment` | method | 22 | <code>assertFreshEnrollment(scope:ProviderScope,resource:ResourceRef):Promise&lt;{boot_credential_version:string;enrollment_digest:string}&gt;;</code> |
| `Obj` | type | 25 | <code>type Obj=Record&lt;string,unknown&gt;;</code> |
| `fail` | function | 26 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `shape` | function | 27 | <code>function shape(v:unknown,keys:string&#91;&#93;):Obj{</code> |
| `sameScope` | function | 31 | <code>function sameScope(a:ProviderScope,b:ProviderScope):boolean{</code> |
| `validateBlaxelPreviewEvidence` | function | 34 | <code>export function validateBlaxelPreviewEvidence(input:unknown,scope:ProviderScope,feature:BlaxelPreviewFeature,now:number):BlaxelPreviewEvidence{</code> |
| `blaxelRecoveryPolicy` | function | 46 | <code>export function blaxelRecoveryPolicy():unknown{</code> |
| `planBlaxelRecovery` | function | 54 | <code>export function planBlaxelRecovery(input:unknown):unknown{</code> |
| `createBlaxelRecoveryController` | function | 76 | <code>export function createBlaxelRecoveryController(scope:ProviderScope,deps:BlaxelRecoveryDependencies){</code> |
| `negotiate` | method | 84 | <code>async negotiate(feature:BlaxelPreviewFeature):Promise&lt;{enabled:true;evidence_digest:string}&gt;{</code> |
| `createFresh` | method | 96 | <code>async createFresh(adapter:BlaxelAdapter,operation:ProviderOperation&lt;'create'&gt;):Promise&lt;{outcome:ProviderOutcome&lt;'create'&gt;;enrollment:'PENDING'&#124;'VERIFIED';enrollment_digest:string&#124;null;outward_action_a…</code> |
| `FreshRunnerAuthority` | interface | 110 | <code>interface FreshRunnerAuthority{</code> |
| `verifyFreshRunner` | method | 111 | <code>verifyFreshRunner(invocation:InvocationContext,tx:AuthorityTransaction,target:{sandbox_id:string;boot_id:string;boot_generation:string;provisioning_intent_id:string;credential_id:string;observed_after…</code> |
| `authenticatedRecoveryController` | function | 115 | <code>function authenticatedRecoveryController(ctx:ComponentContext,invocation:InvocationContext,scope:ProviderScope){</code> |
| `createComponent` | function | 157 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/providers/contract.ts

[Open source](../../services/hyperfide/src/providers/contract.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CapabilityName` | type | 12 | <code>export type CapabilityName = typeof CAPABILITY_NAMES&#91;number&#93;;</code> |
| `ProviderMethod` | type | 16 | <code>export type ProviderMethod = typeof PROVIDER_METHODS&#91;number&#93;;</code> |
| `Digest` | type | 17 | <code>type Digest = string;</code> |
| `OS` | type | 18 | <code>type OS = { distribution: string; version: string; architecture: string };</code> |
| `ProviderScope` | interface | 19 | <code>export interface ProviderScope {</code> |
| `ResourceRef` | interface | 23 | <code>export interface ResourceRef { native_sandbox_id: string; sandbox_boot_generation: string }</code> |
| `ResourceVector` | interface | 24 | <code>export interface ResourceVector {</code> |
| `CapabilityProfile` | interface | 27 | <code>export interface CapabilityProfile {</code> |
| `ProviderState` | type | 35 | <code>export type ProviderState = 'CREATING'&#124;'RUNNING'&#124;'STOPPED'&#124;'DESTROYING'&#124;'DESTROYED'&#124;'FAILED'&#124;'UNKNOWN';</code> |
| `InventoryPage` | interface | 36 | <code>export interface InventoryPage {</code> |
| `ProviderParameters` | interface | 41 | <code>export interface ProviderParameters {</code> |
| `ProviderOperation` | type | 56 | <code>export type ProviderOperation&lt;K extends ProviderMethod = ProviderMethod&gt; = {</code> |
| `ProcessResult` | interface | 61 | <code>export interface ProcessResult {</code> |
| `ProviderResults` | interface | 65 | <code>export interface ProviderResults {</code> |
| `ErrorCode` | type | 77 | <code>export type ErrorCode = 'AUTHENTICATION'&#124;'AUTHORIZATION'&#124;'RATE_LIMIT'&#124;'NOT_FOUND'&#124;'CONFLICT'&#124;'INVALID_REQUEST'&#124;</code> |
| `ProviderError` | interface | 79 | <code>export interface ProviderError { code: ErrorCode; provider_code: string&#124;null; message: string; retry_after_ms: number&#124;null }</code> |
| `OutcomeIdentity` | interface | 80 | <code>interface OutcomeIdentity {</code> |
| `ProviderOutcome` | type | 84 | <code>export type ProviderOutcome&lt;K extends ProviderMethod = ProviderMethod&gt; = OutcomeIdentity &amp; (</code> |
| `ProviderAdapter` | type | 104 | <code>export type ProviderAdapter = {</code> |
| `Obj` | type | 108 | <code>type Obj = Record&lt;string, unknown&gt;;</code> |
| `methods` | variable | 111 | <code>const methods = new Set&lt;string&gt;(PROVIDER_METHODS);</code> |
| `capabilityNames` | variable | 112 | <code>const capabilityNames = new Set&lt;string&gt;(CAPABILITY_NAMES);</code> |
| `mutations` | variable | 113 | <code>const mutations = new Set&lt;ProviderMethod&gt;(&#91;'prepare','create','execute','stop','transfer','lifetime','destroy'&#93;);</code> |
| `invalid` | function | 116 | <code>function invalid(): never { throw new Error('Provider contract input is invalid'); }</code> |
| `object` | function | 117 | <code>function object(value: unknown): Obj {</code> |
| `shape` | function | 122 | <code>function shape(value: unknown, keys: readonly string&#91;&#93;): Obj {</code> |
| `text` | function | 127 | <code>function text(value: unknown, max = 256): string {</code> |
| `identifier` | function | 131 | <code>function identifier(value: unknown): string {</code> |
| `opaque` | function | 138 | <code>function opaque(value: unknown): string { return text(value,2048); }</code> |
| `nullableOpaque` | function | 139 | <code>function nullableOpaque(value: unknown): string&#124;null { return value === null ? null : opaque(value); }</code> |
| `enumeration` | function | 140 | <code>function enumeration(value: unknown, values: readonly string&#91;&#93;): string {</code> |
| `boolean` | function | 144 | <code>function boolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }</code> |
| `integer` | function | 145 | <code>function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {</code> |
| `decimal` | function | 149 | <code>function decimal(value: unknown, positive = false): string {</code> |
| `digest` | function | 154 | <code>function digest(value: unknown): string {</code> |
| `nullableDigest` | function | 158 | <code>function nullableDigest(value: unknown): string&#124;null { return value === null ? null : digest(value); }</code> |
| `instant` | function | 159 | <code>function instant(value: unknown): number {</code> |
| `os` | function | 165 | <code>function os(value: unknown): OS {</code> |
| `scope` | function | 170 | <code>function scope(value: unknown): ProviderScope {</code> |
| `resource` | function | 178 | <code>function resource(value: unknown): ResourceRef {</code> |
| `absolutePath` | function | 183 | <code>function absolutePath(value: unknown): string {</code> |
| `list` | function | 188 | <code>function list(value: unknown, maximum = 1000): unknown&#91;&#93; {</code> |
| `canonical` | function | 192 | <code>function canonical(value: unknown, depth = 0): string {</code> |
| `same` | function | 205 | <code>function same(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }</code> |
| `integrity` | function | 206 | <code>function integrity(value: unknown): void {</code> |
| `validateCapabilityProfile` | function | 213 | <code>export function validateCapabilityProfile(value: unknown): CapabilityProfile {</code> |
| `evaluateCapabilities` | function | 235 | <code>export function evaluateCapabilities(value: unknown): unknown {</code> |
| `operationPayloadDigest` | function | 268 | <code>export function operationPayloadDigest(operation: Pick&lt;ProviderOperation,'kind'&#124;'scope'&#124;'deadline_at'&#124;'resource'&#124;'preparation_digest'&#124;'parameters'&gt;): Digest {</code> |
| `parameters` | function | 274 | <code>function parameters(kind: ProviderMethod, input: unknown): Obj {</code> |
| `validateProviderOperation` | function | 322 | <code>export function validateProviderOperation(value: unknown): ProviderOperation {</code> |
| `inventoryPage` | function | 340 | <code>function inventoryPage(value: unknown): InventoryPage {</code> |
| `validateInventory` | function | 354 | <code>export function validateInventory(value: unknown): unknown {</code> |
| `processResult` | function | 374 | <code>function processResult(value: unknown): ProcessResult {</code> |
| `successResult` | function | 385 | <code>function successResult(op: ProviderOperation, value: unknown): void {</code> |
| `validateProviderOutcome` | function | 421 | <code>export function validateProviderOutcome(value: unknown): unknown {</code> |
| `createComponent` | function | 466 | <code>export function createComponent(_context: ComponentContext): Component {</code> |

## services/hyperfide/src/providers/placement.ts

[Open source](../../services/hyperfide/src/providers/placement.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FreshEnrollmentProof` | interface | 18 | <code>export interface FreshEnrollmentProof {</code> |
| `PlacementDependencies` | interface | 21 | <code>interface PlacementDependencies {</code> |
| `verifyFreshRunner` | method | 22 | <code>authority:{verifyFreshRunner(invocation:InvocationContext,tx:PrimaryTransaction,input:Record&lt;string,unknown&gt;):Promise&lt;Record&lt;string,unknown&gt;&gt;};</code> |
| `authenticatePlacementProbe` | method | 24 | <code>native:{authenticatePlacementProbe(invocation:InvocationContext,input:{probe_id:string},signal:AbortSignal):Promise&lt;{request:import('./reconcile.js').BoundProviderRequest;invocation:InvocationContext}…</code> |
| `identityPlacementDependencies` | function | 26 | <code>function identityPlacementDependencies(context:ComponentContext):Pick&lt;PlacementDependencies,"authority"&gt;{</code> |
| `placementDependencies` | function | 29 | <code>function placementDependencies(context:ComponentContext):PlacementDependencies {</code> |
| `EnvironmentCompatibilityProof` | interface | 36 | <code>export interface EnvironmentCompatibilityProof {compatible:boolean;evidence_digest:string}</code> |
| `EnvironmentCompatibilityVerifier` | type | 37 | <code>export type EnvironmentCompatibilityVerifier=(source:unknown,target:unknown)=&gt;Promise&lt;EnvironmentCompatibilityProof&gt;;</code> |
| `preparationCompatibilityVerifier` | function | 41 | <code>export const preparationCompatibilityVerifier:EnvironmentCompatibilityVerifier=async(source,target)=&gt;{</code> |
| `Target` | interface | 46 | <code>interface Target {name:'coordinator'&#124;'git'&#124;'artifact'&#124;'model';url:string;header_name:string;header_prefix:string;credential_ref:string;expected_status:number;denied_statuses:number&#91;&#93;;expected_body_sha…</code> |
| `ConnectivityConfig` | interface | 47 | <code>interface ConnectivityConfig {schema_version:1;evidence_scope:'LIVE_POOL'&#124;'COMPONENT_FIXTURE';targets:Target&#91;&#93;;timeout_ms:number;maximum_attempts:number;base_backoff_ms:number;max_backoff_ms:number;pr…</code> |
| `connectivity` | function | 48 | <code>async function connectivity(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;ConnectivityConfig&gt;{</code> |
| `boundedEffect` | function | 94 | <code>async function boundedEffect&lt;T&gt;(effect:Promise&lt;T&gt;,signal:AbortSignal,deadline:number):Promise&lt;T&gt;{</code> |
| `verifyEnrollmentInTx` | function | 102 | <code>async function verifyEnrollmentInTx(tx:PrimaryTransaction,pool:ProviderDatabase,config:DeploymentConfig,poolId:string,sandbox:Record&lt;string,any&gt;,runId:string,maxAge:number,dependencies:Pick&lt;PlacementD…</code> |
| `verifyEnrollment` | function | 114 | <code>async function verifyEnrollment(pool:ProviderDatabase,config:DeploymentConfig,poolId:string,sandbox:Record&lt;string,any&gt;,runId:string,maxAge:number,dependencies:Pick&lt;PlacementDependencies,"authority"&gt;):…</code> |
| `probePool` | function | 117 | <code>export async function probePool(pool:ProviderDatabase,config:DeploymentConfig,policy:ConnectivityConfig,value:unknown,signal:AbortSignal,resolveDependencies?:()=&gt;PlacementDependencies):Promise&lt;unknown…</code> |
| `recordPoolFailure` | function | 174 | <code>export async function recordPoolFailure(pool:ProviderDatabase,config:DeploymentConfig,policy:ConnectivityConfig,value:unknown):Promise&lt;unknown&gt;{</code> |
| `planRelocation` | function | 193 | <code>export async function planRelocation(pool:ProviderDatabase,config:DeploymentConfig,policy:ConnectivityConfig,value:unknown,environmentVerifier?:EnvironmentCompatibilityVerifier):Promise&lt;unknown&gt;{</code> |
| `ProviderIsolationReceipt` | interface | 256 | <code>export interface ProviderIsolationReceipt {</code> |
| `ProviderIsolationBinding` | interface | 261 | <code>export interface ProviderIsolationBinding {</code> |
| `ProviderIsolationState` | interface | 265 | <code>export interface ProviderIsolationState {binding:ProviderIsolationBinding;receipt:ProviderIsolationReceipt&#124;null}</code> |
| `ProviderIsolationJournal` | interface | 266 | <code>export interface ProviderIsolationJournal {</code> |
| `read` | method | 267 | <code>read():Promise&lt;ProviderIsolationState&#124;null&gt;;</code> |
| `prepare` | method | 268 | <code>prepare(binding:ProviderIsolationBinding):Promise&lt;{created:boolean;state:ProviderIsolationState}&gt;;</code> |
| `record` | method | 269 | <code>record(value:{binding:ProviderIsolationBinding;receipt:ProviderIsolationReceipt;observations:Array&lt;{operation:ProviderOperation;outcome:ProviderOutcome}&gt;}):Promise&lt;void&gt;;</code> |
| `IsolationTarget` | interface | 271 | <code>export interface IsolationTarget {</code> |
| `IsolationConfiguration` | interface | 275 | <code>interface IsolationConfiguration {</code> |
| `isolationConfiguration` | function | 279 | <code>async function isolationConfiguration(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;IsolationConfiguration&gt;{</code> |
| `isolationOperation` | function | 295 | <code>function isolationOperation&lt;K extends 'destroy'&#124;'observe'&gt;(kind:K,target:IsolationTarget,id:string,deadline:string,correlation:string):ProviderOperation&lt;K&gt;{</code> |
| `unknownIsolationOutcome` | function | 301 | <code>function unknownIsolationOutcome(op:ProviderOperation):ProviderOutcome {</code> |
| `ProviderIsolationCustodyProof` | interface | 306 | <code>export interface ProviderIsolationCustodyProof {</code> |
| `ProviderIsolationCustodyPreflight` | type | 309 | <code>export type ProviderIsolationCustodyPreflight=(target:Readonly&lt;IsolationTarget&gt;,operationId:string,authority:unknown,signal:AbortSignal)=&gt;Promise&lt;ProviderIsolationCustodyProof&#124;null&gt;;</code> |
| `ProviderIsolationRuntime` | interface | 310 | <code>export interface ProviderIsolationRuntime {</code> |
| `createProviderIsolation` | function | 314 | <code>export function createProviderIsolation(runtime:ProviderIsolationRuntime){</code> |
| `ProviderWriterObservation` | interface | 398 | <code>export interface ProviderWriterObservation {</code> |
| `ProviderIsolationObservationJournal` | interface | 403 | <code>export interface ProviderIsolationObservationJournal {</code> |
| `read` | method | 404 | <code>read():Promise&lt;ProviderIsolationState&#124;null&gt;;</code> |
| `recordObservation` | method | 405 | <code>recordObservation(value:{binding:ProviderIsolationBinding;observation:ProviderWriterObservation;</code> |
| `ProviderIsolationObserverRuntime` | interface | 409 | <code>export interface ProviderIsolationObserverRuntime {</code> |
| `createProviderIsolationObserver` | function | 415 | <code>export function createProviderIsolationObserver(runtime:ProviderIsolationObserverRuntime){</code> |
| `createComponent` | function | 470 | <code>export function createComponent(context:ComponentContext):Component{</code> |
| `createProbeComponent` | function | 500 | <code>export function createProbeComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/providers/pools.ts

[Open source](../../services/hyperfide/src/providers/pools.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ProviderPreparationBinding` | interface | 15 | <code>export interface ProviderPreparationBinding {</code> |
| `ProviderProcessRecord` | interface | 19 | <code>export interface ProviderProcessRecord {native_process_ref?:string&#124;null;process_ref:string;payload_digest:string;resource:ResourceRef;state:'SUBMITTED'&#124;'RUNNING'&#124;'EXITED'&#124;'UNKNOWN';provider_metadata:R…</code> |
| `ProviderResourceBinding` | interface | 20 | <code>export interface ProviderResourceBinding {organisation_id:string;run_id:string;sandbox_id:string;boot_id:string;boot_generation:string}</code> |
| `ProviderArtifactReference` | interface | 21 | <code>export interface ProviderArtifactReference {artifact_id:string;receipt_id:string;digest:string;size_bytes:string}</code> |
| `ProviderArtifactReferenceReader` | type | 22 | <code>export type ProviderArtifactReferenceReader=(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string},references:readonly ProviderArtifactReference&#91;&#93;)=&gt;Promise&lt;readonly unknown&#91;&#93;&gt;;</code> |
| `ProviderOutputArchive` | interface | 23 | <code>export interface ProviderOutputArchive {index_reference:ProviderArtifactReference;segment_references:ProviderArtifactReference&#91;&#93;}</code> |
| `ProviderPersistenceHooks` | interface | 24 | <code>export interface ProviderPersistenceHooks {</code> |
| `persistOutputArchive` | method | 26 | <code>persistOutputArchive(operation:ProviderOperation&lt;'execute'&gt;,archive:ProviderOutputArchive):Promise&lt;{archive_id:string;evidence_digest:string}&gt;;</code> |
| `assertResourceBinding` | method | 27 | <code>assertResourceBinding(operation:ProviderOperation):Promise&lt;void&gt;;</code> |
| `resolveResourceBinding` | method | 28 | <code>resolveResourceBinding(operation:ProviderOperation):Promise&lt;ProviderResourceBinding&gt;;</code> |
| `resolvePreparation` | method | 29 | <code>resolvePreparation(operation:ProviderOperation&lt;'create'&gt;):Promise&lt;ProviderPreparationBinding&gt;;</code> |
| `claimProcess` | method | 30 | <code>claimProcess(operation:ProviderOperation&lt;'execute'&gt;,record:ProviderProcessRecord):Promise&lt;{disposition:'NEW'&#124;'EXISTING';record:ProviderProcessRecord}&gt;;</code> |
| `resolveProcess` | method | 31 | <code>resolveProcess(operation:ProviderOperation,processRef:string):Promise&lt;ProviderProcessRecord&#124;null&gt;;</code> |
| `persistEarlyProcess` | method | 32 | <code>persistEarlyProcess(operation:ProviderOperation&lt;'execute'&gt;,nativeProcessRef:string):Promise&lt;void&gt;;</code> |
| `assignedBootGeneration` | method | 33 | <code>assignedBootGeneration(operation:ProviderOperation&lt;'create'&gt;):Promise&lt;string&gt;;</code> |
| `persistEarlyResource` | method | 34 | <code>persistEarlyResource(operation:ProviderOperation&lt;'create'&gt;,nativeSandboxId:string):Promise&lt;ResourceRef&gt;;</code> |
| `recordObservation` | method | 35 | <code>recordObservation(operation:ProviderOperation,outcome:ProviderOutcome):Promise&lt;void&gt;;</code> |
| `ProviderAdapterFactory` | type | 37 | <code>export type ProviderAdapterFactory=(scope:ProviderScope,hooks:ProviderPersistenceHooks)=&gt;ProviderAdapter;</code> |
| `QuotaDimension` | type | 39 | <code>export type QuotaDimension=typeof QUOTA_DIMENSIONS&#91;number&#93;;</code> |
| `QuotaObservation` | interface | 40 | <code>export interface QuotaObservation {</code> |
| `ProviderQuotaObserver` | type | 45 | <code>export type ProviderQuotaObserver=(scope:ProviderScope,signal:AbortSignal)=&gt;Promise&lt;QuotaObservation&#91;&#93;&gt;;</code> |
| `OwnershipObservation` | interface | 46 | <code>export interface OwnershipObservation {matches:boolean;operation_id:string;native_sandbox_id:string;evidence_digest:string}</code> |
| `ProviderOwnershipProbe` | type | 47 | <code>export type ProviderOwnershipProbe=(scope:ProviderScope,operationId:string,nativeId:string,signal:AbortSignal)=&gt;Promise&lt;OwnershipObservation&gt;;</code> |
| `ProviderRunnerBinding` | interface | 48 | <code>export interface ProviderRunnerBinding extends Record&lt;string,unknown&gt; {organisation_id:string;run_id:string;session_id:string;pool_id:string;sandbox_id:string;external_sandbox_id:string;boot_generatio…</code> |
| `ProviderRunnerBindingProof` | interface | 49 | <code>export interface ProviderRunnerBindingProof {evidence_digest:string;observed_at:string}</code> |
| `ProviderRunnerBindingVerifier` | type | 50 | <code>export type ProviderRunnerBindingVerifier=(tx:PrimaryTransaction,binding:ProviderRunnerBinding,request:unknown)=&gt;Promise&lt;ProviderRunnerBindingProof&#124;null&gt;;</code> |
| `ProviderIsolationTransport` | interface | 51 | <code>export interface ProviderIsolationTransport {</code> |
| `destroy` | method | 52 | <code>destroy(operation:ProviderOperation&lt;'destroy'&gt;,signal?:AbortSignal):Promise&lt;ProviderOutcome&lt;'destroy'&gt;&gt;;</code> |
| `observe` | method | 53 | <code>observe(operation:ProviderOperation&lt;'observe'&gt;,signal?:AbortSignal):Promise&lt;ProviderOutcome&lt;'observe'&gt;&gt;;</code> |
| `ProviderIsolationFactory` | type | 55 | <code>export type ProviderIsolationFactory=(scope:ProviderScope)=&gt;ProviderIsolationTransport&#124;Promise&lt;ProviderIsolationTransport&gt;;</code> |
| `ProviderDestructionRequest` | interface | 56 | <code>export interface ProviderDestructionRequest {organisation_id:string;run_id:string;sandbox_id:string;boot_generation:string;operation_id:string}</code> |
| `ProviderDestructionProof` | interface | 57 | <code>export interface ProviderDestructionProof {evidence_digest:string;observed_at:string}</code> |
| `ProviderDestructionPreflight` | type | 58 | <code>export type ProviderDestructionPreflight=(tx:PrimaryTransaction,input:ProviderDestructionRequest)=&gt;Promise&lt;ProviderDestructionProof&#124;null&gt;;</code> |
| `ProviderRuntimeRegistry` | interface | 59 | <code>export interface ProviderRuntimeRegistry {</code> |
| `ProviderDatabase` | interface | 68 | <code>export interface ProviderDatabase {</code> |
| `query` | method | 69 | <code>query&lt;R extends pg.QueryResultRow=pg.QueryResultRow&gt;(text:string,values?:readonly unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;R&gt;&gt;;</code> |
| `providerDeployment` | function | 72 | <code>export function providerDeployment(database:ProviderDatabase):DeploymentConfig {if(!database.deployment)fail('POOL_CONFIG_REQUIRED','Authenticated deployment binding required');return database.deploym…</code> |
| `providerInvocation` | function | 73 | <code>export function providerInvocation(database:ProviderDatabase):InvocationContext {const i=database.invocation;assertInvocation(i);return i;}</code> |
| `bindProviderInvocation` | function | 74 | <code>export function bindProviderInvocation(database:ProviderDatabase,config:DeploymentConfig,invocation:InvocationContext,roles:readonly string&#91;&#93;=&#91;'OPERATOR','COORDINATOR','PROVISIONER','LEADER','FEATURE_…</code> |
| `assertInvocationRun` | function | 81 | <code>export function assertInvocationRun(database:ProviderDatabase,run:string):void{</code> |
| `resolveSandboxBinding` | function | 84 | <code>export async function resolveSandboxBinding(database:ProviderDatabase,config:DeploymentConfig,run:string,sandbox:string,op:ProviderOperation):Promise&lt;ProviderResourceBinding&gt;{</code> |
| `createProviderRuntimeRegistry` | function | 95 | <code>export function createProviderRuntimeRegistry():ProviderRuntimeRegistry{return{adapters:new Map(),observers:new Map(),probes:new Map(),isolation:new Map()};}</code> |
| `createProviderDatabase` | function | 96 | <code>export function createProviderDatabase(context:ComponentContext):ProviderDatabase {</code> |
| `register` | function | 101 | <code>function register&lt;T&gt;(map:Map&lt;string,T&gt;,provider:string,implementation:T):()=&gt;void {</code> |
| `registerArtifactReferenceReader` | function | 106 | <code>export function registerArtifactReferenceReader(runtime:ProviderRuntimeRegistry,reader:ProviderArtifactReferenceReader):()=&gt;void{</code> |
| `registerIsolationTransport` | function | 111 | <code>export function registerIsolationTransport(runtime:ProviderRuntimeRegistry,provider:'railway'&#124;'blaxel',factory:ProviderIsolationFactory){return register(runtime.isolation,provider,factory);}</code> |
| `registerProviderAdapter` | function | 112 | <code>export function registerProviderAdapter(runtime:ProviderRuntimeRegistry,provider:'railway'&#124;'blaxel',factory:ProviderAdapterFactory){return register(runtime.adapters,provider,factory);}</code> |
| `registerProviderQuotaObserver` | function | 113 | <code>export function registerProviderQuotaObserver(runtime:ProviderRuntimeRegistry,provider:'railway'&#124;'blaxel',observer:ProviderQuotaObserver){return register(runtime.observers,provider,observer);}</code> |
| `registerProviderOwnershipProbe` | function | 114 | <code>export function registerProviderOwnershipProbe(runtime:ProviderRuntimeRegistry,provider:'railway'&#124;'blaxel',probe:ProviderOwnershipProbe){return register(runtime.probes,provider,probe);}</code> |
| `hasProviderAdapter` | function | 115 | <code>export const hasProviderAdapter=(provider:string,runtime:ProviderRuntimeRegistry)=&gt;runtime.adapters.has(provider);</code> |
| `providerAdapter` | function | 116 | <code>export function providerAdapter(scope:ProviderScope,hooks:ProviderPersistenceHooks,runtime:ProviderRuntimeRegistry):ProviderAdapter {</code> |
| `providerOwnershipProbe` | function | 120 | <code>export function providerOwnershipProbe(provider:string,runtime:ProviderRuntimeRegistry):ProviderOwnershipProbe {</code> |
| `providerDatabase` | function | 123 | <code>export function providerDatabase(context:ComponentContext):ProviderDatabase {</code> |
| `fail` | function | 127 | <code>export function fail(code:string,message:string):never {throw new FoundationError(code,message);}</code> |
| `obj` | function | 128 | <code>export function obj(value:unknown,keys?:readonly string&#91;&#93;):Record&lt;string,unknown&gt; {</code> |
| `str` | function | 134 | <code>export function str(value:unknown,max=2048):string {</code> |
| `uuid` | function | 138 | <code>export function uuid(value:unknown):string {</code> |
| `dec` | function | 141 | <code>export function dec(value:unknown):string {</code> |
| `dg` | function | 145 | <code>export function dg(value:unknown):string {</code> |
| `utc` | function | 148 | <code>export function utc(value:unknown):string {</code> |
| `canonical` | function | 152 | <code>function canonical(value:unknown):string {</code> |
| `digestDocument` | function | 158 | <code>export const digestDocument=(value:unknown)=&gt;'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');</code> |
| `transaction` | function | 159 | <code>export async function transaction&lt;T&gt;(pool:ProviderDatabase,body:(client:PrimaryTransaction)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `Limits` | type | 162 | <code>type Limits=Partial&lt;Record&lt;QuotaDimension,string&gt;&gt;;</code> |
| `PoolConfig` | interface | 163 | <code>export interface PoolConfig {</code> |
| `DeploymentConfig` | interface | 168 | <code>export interface DeploymentConfig {</code> |
| `limits` | function | 173 | <code>function limits(value:unknown):Limits {</code> |
| `provider` | function | 177 | <code>function provider(value:unknown):'railway'&#124;'blaxel' {</code> |
| `validateDeployment` | function | 180 | <code>export function validateDeployment(value:unknown):DeploymentConfig {</code> |
| `readDeployment` | function | 203 | <code>export async function readDeployment(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;DeploymentConfig&gt;{</code> |
| `inspectProviderSchema` | function | 210 | <code>export async function inspectProviderSchema(pool:ProviderDatabase):Promise&lt;unknown&gt;{</code> |
| `configuredPool` | function | 222 | <code>export function configuredPool(config:DeploymentConfig,id:string):PoolConfig {</code> |
| `configuredScope` | function | 225 | <code>export function configuredScope(config:DeploymentConfig,p:PoolConfig):ProviderScope {</code> |
| `applyConfig` | function | 230 | <code>async function applyConfig(pool:ProviderDatabase,config:DeploymentConfig):Promise&lt;unknown&gt;{</code> |
| `validateQuotaObservation` | function | 249 | <code>export function validateQuotaObservation(value:unknown,scope:ProviderScope):QuotaObservation {</code> |
| `currentPool` | function | 260 | <code>export async function currentPool(client:Pick&lt;PrimaryTransaction,'query'&gt;,config:DeploymentConfig,id:string):Promise&lt;{pool:PoolConfig;scope:ProviderScope}&gt;{</code> |
| `poolCapacity` | function | 267 | <code>export async function poolCapacity(client:Pick&lt;PrimaryTransaction,'query'&gt;,config:DeploymentConfig,id:string):Promise&lt;unknown&gt;{</code> |
| `assertPoolCapacity` | function | 309 | <code>export async function assertPoolCapacity(client:PrimaryTransaction,config:DeploymentConfig,id:string,requested:Partial&lt;Record&lt;QuotaDimension,string&gt;&gt;,alreadyReserved=false):Promise&lt;void&gt;{</code> |
| `providerPrimaryNow` | function | 326 | <code>async function providerPrimaryNow(tx:PrimaryTransaction):Promise&lt;number&gt;{</code> |
| `approvedProfilePolicyDigest` | function | 330 | <code>export function approvedProfilePolicyDigest(value:unknown):string{</code> |
| `SelectedEnvironmentInput` | interface | 342 | <code>export interface SelectedEnvironmentInput {</code> |
| `readSelectedEnvironmentProfile` | function | 346 | <code>export async function readSelectedEnvironmentProfile(tx:PrimaryTransaction,input:SelectedEnvironmentInput):Promise&lt;{manifest:Record&lt;string,unknown&gt;;lineage:Record&lt;string,unknown&gt;&#124;null}&#124;null&gt;{</code> |
| `attestCapacity` | function | 373 | <code>async function attestCapacity(database:ProviderDatabase,config:DeploymentConfig,env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;unknown&gt;{</code> |
| `sourceBindingsMatchProfile` | function | 405 | <code>export function sourceBindingsMatchProfile(profile:unknown,bindings:unknown):boolean{</code> |
| `RuntimeReadinessInput` | interface | 410 | <code>export interface RuntimeReadinessInput {</code> |
| `RuntimeReadinessRecord` | interface | 413 | <code>export interface RuntimeReadinessRecord extends Record&lt;string,unknown&gt; {</code> |
| `readRuntimeReadiness` | function | 418 | <code>export async function readRuntimeReadiness(tx:PrimaryTransaction,input:RuntimeReadinessInput):Promise&lt;RuntimeReadinessRecord&#124;null&gt;{</code> |
| `VerifiedRuntimeReadinessPublication` | interface | 450 | <code>export interface VerifiedRuntimeReadinessPublication {</code> |
| `runtimeReadinessDigest` | function | 474 | <code>export function runtimeReadinessDigest(value:Record&lt;string,unknown&gt;):string {</code> |
| `RuntimeReadinessPublicationVerifier` | type | 482 | <code>export type RuntimeReadinessPublicationVerifier=(tx:PrimaryTransaction,invocation:InvocationContext,input:VerifiedRuntimeReadinessPublication,producerProof:unknown)=&gt;Promise&lt;void&gt;;</code> |
| `registerPublicationVerifier` | function | 483 | <code>export function registerPublicationVerifier(runtime:ProviderRuntimeRegistry,verifier:RuntimeReadinessPublicationVerifier):()=&gt;void{</code> |
| `ProviderReadinessCapability` | interface | 487 | <code>export interface ProviderReadinessCapability {</code> |
| `registerPublicationVerifier` | method | 488 | <code>registerPublicationVerifier(verifier:RuntimeReadinessPublicationVerifier):()=&gt;void;</code> |
| `registerArtifactReferenceReader` | method | 489 | <code>registerArtifactReferenceReader(reader:ProviderArtifactReferenceReader):()=&gt;void;</code> |
| `publishVerifiedRuntimeReadiness` | method | 491 | <code>publishVerifiedRuntimeReadiness(tx:PrimaryTransaction,invocation:InvocationContext,input:VerifiedRuntimeReadinessPublication,producerProof:unknown):Promise&lt;{created:boolean;id:string;readiness_digest:…</code> |
| `isProviderReadinessCapability` | function | 493 | <code>export function isProviderReadinessCapability(value:unknown):value is ProviderReadinessCapability {</code> |
| `publishVerifiedRuntimeReadiness` | function | 501 | <code>export async function publishVerifiedRuntimeReadiness(tx:PrimaryTransaction,invocation:InvocationContext,</code> |
| `createComponent` | function | 586 | <code>export function createComponent(context:ComponentContext):Component {</code> |

## services/hyperfide/src/providers/railway/preparation.ts

[Open source](../../services/hyperfide/src/providers/railway/preparation.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `JsonObject` | type | 13 | <code>export type JsonObject = Record&lt;string,unknown&gt;;</code> |
| `object` | function | 14 | <code>export function object(value:unknown,keys?:readonly string&#91;&#93;):JsonObject {</code> |
| `text` | function | 21 | <code>export function text(value:unknown,max=2048):string {</code> |
| `digest` | function | 26 | <code>export function digest(value:unknown):string {</code> |
| `hash` | function | 30 | <code>export function hash(value:unknown):string { return 'sha256:'+createHash('sha256').update(canonicalJSON(value)).digest('hex'); }</code> |
| `absolute` | function | 31 | <code>export function absolute(value:unknown):string {</code> |
| `integer` | function | 37 | <code>export function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number {</code> |
| `instant` | function | 41 | <code>export function instant(value:unknown):string {</code> |
| `scope` | function | 46 | <code>export function scope(value:unknown):ProviderScope {</code> |
| `sameScope` | function | 53 | <code>export function sameScope(a:ProviderScope,b:ProviderScope):boolean { return canonicalJSON(a)===canonicalJSON(b); }</code> |
| `RailwayConfiguration` | interface | 54 | <code>export interface RailwayConfiguration {</code> |
| `RailwayRequestError` | class | 59 | <code>export class RailwayRequestError extends Error {</code> |
| `constructor` | method | 60 | <code>constructor(readonly code:'REJECTED'&#124;'UNKNOWN'&#124;'PROTOCOL',readonly providerCode:string&#124;null=null) {</code> |
| `boundedBody` | function | 64 | <code>async function boundedBody(response:Response):Promise&lt;Buffer&gt; {</code> |
| `RailwayClient` | class | 87 | <code>export class RailwayClient {</code> |
| `constructor` | method | 90 | <code>constructor(value:unknown,env:Readonly&lt;NodeJS.ProcessEnv&gt;,private readonly transport:typeof fetch=fetch) {</code> |
| `assertScope` | method | 115 | <code>assertScope(s:ProviderScope):void {</code> |
| `sdkOptions` | method | 119 | <code>sdkOptions(capture?:(stream:'stdout'&#124;'stderr',bytes:Uint8Array)=&gt;void):ConnectOptions {</code> |
| `RailwayWebSocket` | class | 120 | <code>class RailwayWebSocket extends WebSocket {</code> |
| `constructor` | method | 121 | <code>constructor(url:string,protocols?:string&#124;string&#91;&#93;){</code> |
| `request` | method | 140 | <code>async request&lt;T&gt;(query:string,variables:JsonObject,signal?:AbortSignal):Promise&lt;T&gt; {</code> |
| `provenance` | method | 159 | <code>provenance():{mode:RailwayConfiguration&#91;'mode'&#93;;sdk:typeof RAILWAY_PIN;live_qualification:'NOT_EVALUATED'} {</code> |
| `configuredClient` | function | 163 | <code>export function configuredClient(context:Pick&lt;ComponentContext,'env'&gt;):RailwayClient {</code> |
| `PreparedRailwayBase` | interface | 173 | <code>export interface PreparedRailwayBase {</code> |
| `validatePreparedBase` | function | 177 | <code>export function validatePreparedBase(value:unknown,expected:ProviderScope,expectedDigest:string):PreparedRailwayBase {</code> |
| `PreparationCaptureHooks` | interface | 185 | <code>export interface PreparationCaptureHooks {</code> |
| `quiesceAndVerify` | method | 188 | <code>quiesceAndVerify(sandboxId:string,manifest:PreparationManifest,signal:AbortSignal):Promise&lt;{</code> |
| `persistCheckpoint` | method | 191 | <code>persistCheckpoint(base:PreparedRailwayBase):Promise&lt;void&gt;;</code> |
| `withPreparationLock` | method | 193 | <code>withPreparationLock&lt;T&gt;(digest:string,action:()=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;;</code> |
| `capturePreparedBase` | function | 195 | <code>export async function capturePreparedBase(client:RailwayClient,input:{</code> |
| `buildRailwayTemplate` | function | 228 | <code>export async function buildRailwayTemplate(client:RailwayClient,input:{</code> |
| `freshRestoreObservation` | function | 257 | <code>export function freshRestoreObservation(base:PreparedRailwayBase,child:{</code> |
| `checkpointByKey` | function | 265 | <code>export async function checkpointByKey(client:RailwayClient,key:string,signal?:AbortSignal):Promise&lt;{id:string;key:string}&gt; {</code> |
| `RestoredSentinelObservation` | interface | 274 | <code>export interface RestoredSentinelObservation {</code> |
| `verifySentinelRestore` | function | 279 | <code>export function verifySentinelRestore(base:PreparedRailwayBase,sentinel:{path:string;sha256:string;process_marker:string},</code> |
| `SimulatedSandboxView` | class | 289 | <code>class SimulatedSandboxView {</code> |
| `constructor` | method | 290 | <code>constructor(private readonly client:RailwayClient){</code> |
| `root` | method | 293 | <code>private root(id:string):string {</code> |
| `read` | method | 297 | <code>private read(name:string,max:number):Buffer {</code> |
| `runner` | method | 302 | <code>runner(id:string):{boot_id:string;preparation_digest:string;environment_id:string;region:string;writers_stopped:boolean;credentials_revoked:boolean} {</code> |
| `processAlive` | method | 308 | <code>processAlive(id:string,marker:string):boolean {</code> |
| `fileDigest` | method | 318 | <code>fileDigest(id:string,relative:string):string&#124;null {</code> |
| `hooks` | method | 324 | <code>hooks(id:string,expected:ProviderScope):PreparationCaptureHooks {</code> |
| `locks` | variable | 339 | <code>const locks=new Map&lt;string,Promise&lt;unknown&gt;&gt;();</code> |
| `serialized` | function | 340 | <code>async function serialized&lt;T&gt;(key:string,action:()=&gt;Promise&lt;T&gt;):Promise&lt;T&gt; {</code> |
| `preparationInput` | function | 345 | <code>function preparationInput(value:unknown,keys:string&#91;&#93;):JsonObject {</code> |
| `createComponent` | function | 352 | <code>export function createComponent(_context:ComponentContext):Component {</code> |

## services/hyperfide/src/providers/railway/processes.ts

[Open source](../../services/hyperfide/src/providers/railway/processes.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Chunk` | interface | 10 | <code>interface Chunk { sequence:number;stream:'stdout'&#124;'stderr';offset:string;size:number;digest:string;file:string }</code> |
| `RailwaySessionRecord` | interface | 11 | <code>export interface RailwaySessionRecord {</code> |
| `RailwayChunkReceipt` | interface | 20 | <code>export interface RailwayChunkReceipt {artifact_id:string;receipt_id:string;digest:string;size_bytes:string}</code> |
| `RailwayOutputChunk` | interface | 21 | <code>export interface RailwayOutputChunk {</code> |
| `RailwayChunkSink` | type | 25 | <code>export type RailwayChunkSink=(chunk:RailwayOutputChunk)=&gt;Promise&lt;RailwayChunkReceipt&gt;;</code> |
| `RailwayArtifactUploadUnknown` | class | 26 | <code>export class RailwayArtifactUploadUnknown extends Error {</code> |
| `constructor` | method | 27 | <code>constructor(readonly candidateArtifactId:string&#124;null){super('Railway artifact upload requires actual store reconciliation');}</code> |
| `RailwayArchiveBinding` | interface | 30 | <code>export interface RailwayArchiveBinding {</code> |
| `RailwayArchiveReference` | interface | 34 | <code>export interface RailwayArchiveReference {artifact_id:string;receipt_id:string;digest:string;size_bytes:string}</code> |
| `RailwaySegmentReference` | interface | 35 | <code>export interface RailwaySegmentReference extends RailwayArchiveReference {</code> |
| `RailwayStreamIndex` | interface | 38 | <code>export interface RailwayStreamIndex {</code> |
| `RailwayArtifactInvoke` | type | 45 | <code>export type RailwayArtifactInvoke=(action:string,input:unknown)=&gt;Promise&lt;unknown&gt;;</code> |
| `archiveLines` | function | 46 | <code>function&#42; archiveLines(filename:string):Generator&lt;Record&lt;string,unknown&gt;&gt; {</code> |
| `archiveReceipt` | function | 64 | <code>function archiveReceipt(value:unknown,binding:Pick&lt;RailwayArchiveBinding,'organisation_id'&#124;'run_id'&gt;,</code> |
| `UploadState` | interface | 79 | <code>interface UploadState {schema_version:1;acknowledged:number;index_offset:number;</code> |
| `RailwayCaptureProof` | interface | 81 | <code>export interface RailwayCaptureProof {</code> |
| `RailwaySessionSpool` | class | 85 | <code>export class RailwaySessionSpool {</code> |
| `constructor` | method | 91 | <code>constructor(directory:string,private readonly maxBytes=64&#42;1024&#42;1024&#42;1024,private readonly chunkSink?:RailwayChunkSink) {</code> |
| `key` | method | 101 | <code>private key(operationId:string):string {return createHash('sha256').update(text(operationId)).digest('hex');}</code> |
| `folder` | method | 102 | <code>private folder(operationId:string):string {return path.join(this.directory,this.key(operationId));}</code> |
| `sessionKey` | method | 103 | <code>private sessionKey(resource:ResourceRef,sessionName:string):string {</code> |
| `indexSession` | method | 106 | <code>private indexSession(record:RailwaySessionRecord):void {</code> |
| `save` | method | 127 | <code>private save(record:RailwaySessionRecord):void {</code> |
| `read` | method | 137 | <code>read(operationId:string):RailwaySessionRecord {</code> |
| `append` | method | 146 | <code>private append(record:RailwaySessionRecord,stream:'stdout'&#124;'stderr',value:string&#124;Uint8Array):void {</code> |
| `index` | method | 165 | <code>private &#42;index(operationId:string):Generator&lt;Chunk&gt; {</code> |
| `verify` | method | 185 | <code>verify(operationId:string):{complete:boolean;byte_count:string;digest:string;chunks:number} {</code> |
| `uploadState` | method | 223 | <code>private uploadState(operationId:string):UploadState {</code> |
| `saveUploadState` | method | 234 | <code>private saveUploadState(operationId:string,state:UploadState):void {</code> |
| `receipt` | method | 242 | <code>private receipt(receipt:RailwayChunkReceipt,digestValue:string,size:string):void {</code> |
| `kickUploads` | method | 247 | <code>private kickUploads(operationId:string):void {</code> |
| `uploadPending` | method | 251 | <code>async uploadPending(operationId:string,sink:RailwayChunkSink):Promise&lt;void&gt; {</code> |
| `performUploads` | method | 257 | <code>private async performUploads(operationId:string,sink:RailwayChunkSink):Promise&lt;void&gt; {</code> |
| `uploadStatus` | method | 300 | <code>uploadStatus(operationId:string):{uploaded_chunks:number;total_chunks:number;pending_unknown:boolean;</code> |
| `reconcilePendingUpload` | method | 307 | <code>async reconcilePendingUpload(operationId:string,reconcile:(pending:NonNullable&lt;UploadState&#91;'pending'&#93;&gt;)=&gt;</code> |
| `archiveJournal` | method | 329 | <code>private archiveJournal(operationId:string,key:string,value:unknown):void {</code> |
| `archiveEffect` | method | 337 | <code>private async archiveEffect(operationId:string,action:'artifact.object.put'&#124;'artifact.manifest.commit',input:Record&lt;string,unknown&gt;,</code> |
| `sealStreams` | method | 372 | <code>async sealStreams(operationId:string,invoke:RailwayArtifactInvoke,binding:RailwayArchiveBinding,maxSegmentChunks=2048):Promise&lt;{</code> |
| `reconcileArtifactUploads` | method | 477 | <code>async reconcileArtifactUploads(operationId:string,invoke:RailwayArtifactInvoke,binding:Pick&lt;RailwayArchiveBinding,'organisation_id'&#124;'run_id'&gt;):Promise&lt;boolean&gt; {</code> |
| `result` | method | 499 | <code>private result(record:RailwaySessionRecord):ProcessResult {</code> |
| `start` | method | 508 | <code>async start(client:RailwayClient,operation:ProviderOperation&lt;'execute'&gt;,resolve:CredentialResolver,</code> |
| `find` | method | 568 | <code>find(resource:ResourceRef,sessionName:string):RailwaySessionRecord {</code> |
| `inspect` | method | 585 | <code>inspect(resource:ResourceRef,sessionName:string):ProcessResult {</code> |
| `stdin` | method | 591 | <code>async stdin(resource:ResourceRef,sessionName:string,bytes:Uint8Array):Promise&lt;void&gt; {</code> |
| `detach` | method | 597 | <code>async detach(resource:ResourceRef,sessionName:string):Promise&lt;void&gt; {</code> |
| `readCapturedOutput` | method | 604 | <code>readCapturedOutput(resource:ResourceRef,sessionName:string,maxBytes:number):{</code> |
| `detachAll` | method | 639 | <code>async detachAll():Promise&lt;void&gt; {</code> |
| `stop` | method | 649 | <code>async stop(client:RailwayClient,resource:ResourceRef,sessionName:string,signal:'TERM'&#124;'KILL'):Promise&lt;ProcessResult&gt; {</code> |
| `createRailwayArtifactChunkSink` | function | 679 | <code>export function createRailwayArtifactChunkSink(invoke:(action:string,input:unknown)=&gt;Promise&lt;unknown&gt;,binding:{</code> |
| `verifyRailwayStreamArchive` | function | 709 | <code>export async function verifyRailwayStreamArchive(invoke:RailwayArtifactInvoke,reference:RailwayArchiveReference,</code> |
| `createComponent` | function | 769 | <code>export function createComponent(_context:ComponentContext):Component {</code> |

## services/hyperfide/src/providers/railway/profile.ts

[Open source](../../services/hyperfide/src/providers/railway/profile.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RailwayRuntimeProfile` | interface | 6 | <code>export interface RailwayRuntimeProfile {</code> |
| `bytes` | function | 15 | <code>function bytes(value:unknown,positive=false):string {</code> |
| `validateRuntimeProfile` | function | 20 | <code>export function validateRuntimeProfile(value:unknown):RailwayRuntimeProfile {</code> |
| `CredentialResolver` | type | 72 | <code>export type CredentialResolver=(references:Readonly&lt;Record&lt;string,string&gt;&gt;,signal:AbortSignal,layer?:'runtime'&#124;'process',operation?:ProviderOperation)=&gt;Promise&lt;Record&lt;string,string&gt;&gt;;</code> |
| `runtimeOptions` | function | 73 | <code>export async function runtimeOptions(profile:RailwayRuntimeProfile,client:RailwayClient,resolve:CredentialResolver,</code> |
| `runtimeGraphQLInput` | function | 95 | <code>export function runtimeGraphQLInput(profile:RailwayRuntimeProfile,options:CreateOptions):JsonObject {</code> |
| `observeRuntimeProfile` | function | 104 | <code>export function observeRuntimeProfile(profile:RailwayRuntimeProfile,observed:unknown):{</code> |
| `createComponent` | function | 121 | <code>export function createComponent(_context:ComponentContext):Component {</code> |

## services/hyperfide/src/providers/railway/reconciliation.ts

[Open source](../../services/hyperfide/src/providers/railway/reconciliation.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ProviderInfo` | interface | 23 | <code>interface ProviderInfo {id:string;status:ProviderState;environmentId:string;region:string;idleTimeoutMinutes:number&#124;null}</code> |
| `info` | function | 24 | <code>function info(value:unknown,client:RailwayClient):ProviderInfo {</code> |
| `inventoryPage` | function | 30 | <code>export async function inventoryPage(client:RailwayClient,s:ProviderScope,cursor:string&#124;null,pageSize:number,</code> |
| `completeInventory` | function | 47 | <code>export async function completeInventory(client:RailwayClient,s:ProviderScope,signal?:AbortSignal,maxPages=10000):</code> |
| `completeSessions` | function | 61 | <code>export async function completeSessions(client:RailwayClient,sandboxId:string,signal?:AbortSignal,maxPages=10000):</code> |
| `observeRailwayQuota` | function | 85 | <code>export async function observeRailwayQuota(client:RailwayClient,s:ProviderScope,signal?:AbortSignal):Promise&lt;QuotaObservation&#91;&#93;&gt; {</code> |
| `qualifyRailwayProfileInputs` | function | 110 | <code>export function qualifyRailwayProfileInputs(client:RailwayClient,input:unknown,policies:readonly {scope:ProviderScope;idle_timeout_minutes:number}&#91;&#93;=&#91;&#93;) {</code> |
| `ProviderPersistenceHooks` | type | 126 | <code>export type ProviderPersistenceHooks=RuntimeProviderPersistenceHooks;</code> |
| `RailwayAdapterDependencies` | interface | 127 | <code>export interface RailwayAdapterDependencies {</code> |
| `binding` | method | 131 | <code>archive?:{invoke:RailwayArtifactInvoke;binding(operation:ProviderOperation&lt;'execute'&gt;):Promise&lt;RailwayArchiveBinding&gt;};</code> |
| `runtimeProfile` | method | 133 | <code>runtimeProfile(operation:ProviderOperation&lt;'create'&gt;):Promise&lt;RailwayRuntimeProfile&gt;;</code> |
| `preparedBase` | method | 134 | <code>preparedBase(reference:string,scope:ProviderScope):Promise&lt;PreparedRailwayBase&gt;;</code> |
| `allowSeedPreparation` | method | 135 | <code>allowSeedPreparation?(operation:ProviderOperation&lt;'create'&gt;,profile:RailwayRuntimeProfile):Promise&lt;boolean&gt;;</code> |
| `allowFreshPreparation` | method | 136 | <code>allowFreshPreparation?(operation:ProviderOperation&lt;'create'&gt;,profile:RailwayRuntimeProfile):Promise&lt;boolean&gt;;</code> |
| `verifyForkSource` | method | 137 | <code>verifyForkSource?(operation:ProviderOperation&lt;'create'&gt;,profile:RailwayRuntimeProfile,base:PreparedRailwayBase):Promise&lt;boolean&gt;;</code> |
| `capabilities` | method | 140 | <code>capabilities?(operation:ProviderOperation&lt;'capabilities'&gt;):Promise&lt;CapabilityProfile&gt;;</code> |
| `prepare` | method | 141 | <code>prepare?(operation:ProviderOperation&lt;'prepare'&gt;,signal:AbortSignal):Promise&lt;{preparation_reference:string;preparation_digest:string}&gt;;</code> |
| `transfer` | method | 142 | <code>transfer?(operation:ProviderOperation&lt;'transfer'&gt;,client:RailwayClient,signal:AbortSignal):Promise&lt;{</code> |
| `envelope` | function | 145 | <code>function envelope(operation:ProviderOperation,resource:ResourceRef&#124;null):Record&lt;string,unknown&gt; {</code> |
| `success` | function | 149 | <code>function success(operation:ProviderOperation,resource:ResourceRef&#124;null,result:unknown):ProviderOutcome {</code> |
| `unknown` | function | 153 | <code>function unknown(operation:ProviderOperation,resource:ResourceRef&#124;null):ProviderOutcome {</code> |
| `unsupported` | function | 158 | <code>function unsupported(operation:ProviderOperation):ProviderOutcome {</code> |
| `refused` | function | 163 | <code>function refused(operation:ProviderOperation):ProviderOutcome {</code> |
| `RailwayAdapter` | type | 168 | <code>export type RailwayAdapter=ProviderAdapter&amp;{</code> |
| `sealCapturedOutput` | method | 169 | <code>sealCapturedOutput(operation:ProviderOperation&lt;'execute'&gt;):Promise&lt;Awaited&lt;ReturnType&lt;RailwaySessionSpool&#91;'sealStreams'&#93;&gt;&gt;&amp;{</code> |
| `reconcileCapturedOutput` | method | 171 | <code>reconcileCapturedOutput(operation:ProviderOperation&lt;'execute'&gt;):Promise&lt;boolean&gt;;</code> |
| `readCapturedOutput` | method | 172 | <code>readCapturedOutput(scope:ProviderScope,resource:ResourceRef,processRef:string,maxBytes:number):Promise&lt;{</code> |
| `createRailwayAdapter` | function | 176 | <code>export function createRailwayAdapter(client:RailwayClient,dependencies:RailwayAdapterDependencies):RailwayAdapter {</code> |
| `RailwayRegistrar` | type | 400 | <code>export type RailwayRegistrar=(provider:'railway',factory:(scope:ProviderScope,hooks:ProviderPersistenceHooks)=&gt;ProviderAdapter)=&gt;()=&gt;void;</code> |
| `registerRailwayProvider` | function | 401 | <code>export function registerRailwayProvider(registrar:RailwayRegistrar,client:RailwayClient,</code> |
| `reconcileCreate` | function | 405 | <code>export function reconcileCreate(input:unknown):{decision:'ADOPT_CANDIDATE'&#124;'QUARANTINE'&#124;'NO_MATCH';</code> |
| `createComponent` | function | 428 | <code>export function createComponent(context:ComponentContext):Component {</code> |
| `RailwayIsolationTransport` | interface | 452 | <code>export interface RailwayIsolationTransport {</code> |
| `destroy` | method | 453 | <code>destroy(operation:ProviderOperation&lt;'destroy'&gt;,signal?:AbortSignal):Promise&lt;ProviderOutcome&lt;'destroy'&gt;&gt;;</code> |
| `observe` | method | 454 | <code>observe(operation:ProviderOperation&lt;'observe'&gt;,signal?:AbortSignal):Promise&lt;ProviderOutcome&lt;'observe'&gt;&gt;;</code> |
| `createRailwayIsolationTransport` | function | 456 | <code>export function createRailwayIsolationTransport(client:RailwayClient,fixedScope:ProviderScope):RailwayIsolationTransport {</code> |
| `configuredRailwayIsolationTransport` | function | 498 | <code>export function configuredRailwayIsolationTransport(</code> |
| `RailwayPoolPolicy` | interface | 506 | <code>interface RailwayPoolPolicy {</code> |
| `railwayRuntimePolicies` | function | 512 | <code>function railwayRuntimePolicies(context:ComponentContext):RailwayPoolPolicy&#91;&#93; {</code> |
| `railwayRuntimePolicyDigest` | function | 543 | <code>export function railwayRuntimePolicyDigest(policy:Omit&lt;RailwayPoolPolicy,'scope'&gt;&#124;RailwayPoolPolicy):string {</code> |
| `railwayBaseFromRow` | function | 548 | <code>function railwayBaseFromRow(row:Record&lt;string,unknown&gt;&#124;null,s:ProviderScope,preparation:string):PreparedRailwayBase {</code> |
| `railwayCredentialResolver` | function | 553 | <code>function railwayCredentialResolver(authority:CredentialAuthority,hooks:ProviderPersistenceHooks):CredentialResolver {</code> |
| `installRailwayRuntime` | function | 575 | <code>function installRailwayRuntime(context:ComponentContext):{close:()=&gt;Promise&lt;void&gt;;policies:RailwayPoolPolicy&#91;&#93;} {</code> |

## services/hyperfide/src/providers/reconcile.ts

[Open source](../../services/hyperfide/src/providers/reconcile.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Intent` | interface | 19 | <code>export interface Intent {</code> |
| `deadline` | function | 25 | <code>function deadline(value:unknown,maximum:number):string {</code> |
| `operation` | function | 30 | <code>function operation&lt;K extends ProviderMethod&gt;(kind:K,scope:ProviderOperation&#91;'scope'&#93;,id:string,deadlineAt:string,resource:ResourceRef&#124;null,</code> |
| `intent` | function | 37 | <code>async function intent(client:Pick&lt;PrimaryTransaction,'query'&gt;,organisation:string,id:string,lock=false):Promise&lt;Intent&gt;{</code> |
| `noActiveWork` | function | 41 | <code>async function noActiveWork(client:PrimaryTransaction,organisation:string,sandbox:string):Promise&lt;void&gt;{</code> |
| `PreparationSelection` | interface | 45 | <code>export interface PreparationSelection {</code> |
| `preparationParameters` | function | 48 | <code>export async function preparationParameters(c:PrimaryTransaction,config:DeploymentConfig,value:unknown,invocation:InvocationContext):Promise&lt;ProviderOperation&lt;'create'&gt;&#91;'parameters'&#93;&gt;{</code> |
| `prepareCreate` | function | 75 | <code>export async function prepareCreate(pool:ProviderDatabase,config:DeploymentConfig,value:unknown):Promise&lt;unknown&gt;{</code> |
| `prepareCreateTx` | function | 78 | <code>export async function prepareCreateTx(c:PrimaryTransaction,config:DeploymentConfig,value:unknown,invocation:InvocationContext):Promise&lt;unknown&gt;{</code> |
| `destructionPreflight` | function | 114 | <code>export async function destructionPreflight(tx:PrimaryTransaction,pool:ProviderDatabase,input:ProviderDestructionRequest):Promise&lt;ProviderDestructionProof&gt;{</code> |
| `prepareDestroy` | function | 128 | <code>export async function prepareDestroy(pool:ProviderDatabase,config:DeploymentConfig,value:unknown):Promise&lt;unknown&gt;{</code> |
| `persistenceHooks` | function | 147 | <code>export function persistenceHooks(pool:ProviderDatabase,organisation:string,id:string):ProviderPersistenceHooks{</code> |
| `unknownOutcome` | function | 280 | <code>function unknownOutcome(op:ProviderOperation,resource:ResourceRef&#124;null):ProviderOutcome {</code> |
| `boundedProvider` | function | 286 | <code>export async function boundedProvider&lt;T&gt;(effect:Promise&lt;T&gt;,signal:AbortSignal,deadlineAt:string):Promise&lt;T&gt;{</code> |
| `executeIntent` | function | 295 | <code>export async function executeIntent(pool:ProviderDatabase,config:DeploymentConfig,id:string,signal:AbortSignal):Promise&lt;unknown&gt;{</code> |
| `reconcileIntent` | function | 322 | <code>export async function reconcileIntent(pool:ProviderDatabase,config:DeploymentConfig,id:string,signal:AbortSignal):Promise&lt;unknown&gt;{</code> |
| `ProviderCaptureProof` | type | 370 | <code>export type ProviderCaptureProof=</code> |
| `CapturedProviderOutput` | interface | 373 | <code>export interface CapturedProviderOutput {</code> |
| `verifyCapturedProviderOutput` | function | 376 | <code>export function verifyCapturedProviderOutput(result:import('./contract.js').ProcessResult,value:CapturedProviderOutput,maxBytes=16&#42;1024&#42;1024):CapturedProviderOutput{</code> |
| `processObservationDisposition` | function | 409 | <code>export function processObservationDisposition(previous:ProviderOutcome&#124;null,next:ProviderOutcome):'ACCEPT'&#124;'IGNORE'&#124;'CONFLICT'{</code> |
| `BoundProviderRequest` | interface | 416 | <code>export interface BoundProviderRequest {</code> |
| `processRecord` | function | 420 | <code>function processRecord(value:unknown,op:ProviderOperation&lt;'execute'&gt;):ProviderProcessRecord{</code> |
| `remoteProcessHooks` | function | 425 | <code>export function remoteProcessHooks(pool:ProviderDatabase,organisation:string,run:string,id:string){</code> |
| `executeBound` | function | 482 | <code>export async function executeBound(pool:ProviderDatabase,config:DeploymentConfig,value:unknown,signal:AbortSignal):Promise&lt;unknown&gt;{</code> |
| `observeKnownSandbox` | function | 567 | <code>export async function observeKnownSandbox(pool:ProviderDatabase,config:DeploymentConfig,value:unknown,signal:AbortSignal):Promise&lt;unknown&gt;{</code> |
| `readConfirmedAbsence` | function | 582 | <code>export async function readConfirmedAbsence(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;reservation_id:string}):Promise&lt;{id:string;digest:string;observed_at:string}&#124;null&gt;{</code> |
| `ProviderIntentCapability` | interface | 588 | <code>export interface ProviderIntentCapability {</code> |
| `registerDestructionPreflight` | method | 589 | <code>registerDestructionPreflight(reader:ProviderDestructionPreflight):()=&gt;void;</code> |
| `preparationParameters` | method | 590 | <code>preparationParameters(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise&lt;ProviderOperation&lt;'create'&gt;&#91;'parameters'&#93;&gt;;</code> |
| `prepareCreateTx` | method | 591 | <code>prepareCreateTx(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise&lt;unknown&gt;;</code> |
| `getIntent` | method | 592 | <code>getIntent(id:string,invocation:InvocationContext):Promise&lt;Intent&gt;;</code> |
| `ProviderExecutionCapability` | interface | 595 | <code>export interface ProviderExecutionCapability {</code> |
| `registerDestructionPreflight` | method | 596 | <code>registerDestructionPreflight(reader:ProviderDestructionPreflight):()=&gt;void;</code> |
| `registerRunnerBindingVerifier` | method | 597 | <code>registerRunnerBindingVerifier(reader:ProviderRunnerBindingVerifier):()=&gt;void;</code> |
| `executeIntent` | method | 598 | <code>executeIntent(id:string,signal:AbortSignal,invocation:InvocationContext):Promise&lt;unknown&gt;;</code> |
| `reconcileIntent` | method | 599 | <code>reconcileIntent(id:string,signal:AbortSignal,invocation:InvocationContext):Promise&lt;unknown&gt;;</code> |
| `executeBound` | method | 600 | <code>executeBound(input:unknown,signal:AbortSignal,invocation:InvocationContext):Promise&lt;unknown&gt;;</code> |
| `observeKnownSandbox` | method | 601 | <code>observeKnownSandbox(input:unknown,signal:AbortSignal,invocation:InvocationContext):Promise&lt;unknown&gt;;</code> |
| `isProviderExecutionCapability` | function | 603 | <code>export function isProviderExecutionCapability(value:unknown):value is ProviderExecutionCapability{</code> |
| `isProviderIntentCapability` | function | 607 | <code>export function isProviderIntentCapability(value:unknown):value is ProviderIntentCapability{</code> |
| `createComponent` | function | 611 | <code>export function createComponent(context:ComponentContext):Component {</code> |
| `createAccountingComponent` | function | 651 | <code>export function createAccountingComponent(context:ComponentContext):Component {</code> |
| `SchedulerProofRegistry` | type | 654 | <code>type SchedulerProofRegistry={registerProofReader(source:'provider.absence',reader:typeof readConfirmedAbsence):()=&gt;void};</code> |
| `registerProofReader` | method | 654 | <code>type SchedulerProofRegistry={registerProofReader(source:'provider.absence',reader:typeof readConfirmedAbsence):()=&gt;void};</code> |

## services/hyperfide/src/providers/worker.ts

[Open source](../../services/hyperfide/src/providers/worker.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ProvisionerWorkerSettings` | interface | 12 | <code>export interface ProvisionerWorkerSettings {concurrency:number;poll_ms:number;retry_ms:number;lease_ms:number}</code> |
| `ProvisionerWorkerDriver` | interface | 13 | <code>export interface ProvisionerWorkerDriver {</code> |
| `execute` | method | 14 | <code>execute(database:ProviderDatabase,config:DeploymentConfig,id:string,signal:AbortSignal):Promise&lt;unknown&gt;;</code> |
| `reconcile` | method | 15 | <code>reconcile(database:ProviderDatabase,config:DeploymentConfig,id:string,signal:AbortSignal):Promise&lt;unknown&gt;;</code> |
| `PoolAdapterReadiness` | interface | 17 | <code>export interface PoolAdapterReadiness {</code> |
| `bounded` | function | 21 | <code>function bounded(env:Readonly&lt;NodeJS.ProcessEnv&gt;,name:string,fallback:number,min:number,max:number):number{</code> |
| `workerSettings` | function | 26 | <code>export function workerSettings(env:Readonly&lt;NodeJS.ProcessEnv&gt;):ProvisionerWorkerSettings{</code> |
| `poolAdapterReadiness` | function | 34 | <code>export async function poolAdapterReadiness(database:ProviderDatabase,config:DeploymentConfig,invocation:InvocationContext,running:boolean):Promise&lt;PoolAdapterReadiness&#91;&#93;&gt;{</code> |
| `ProvisionerWorker` | class | 69 | <code>export class ProvisionerWorker {</code> |
| `constructor` | method | 73 | <code>constructor(private readonly database:ProviderDatabase,private readonly env:Readonly&lt;NodeJS.ProcessEnv&gt;,private readonly signal:AbortSignal,private readonly driver:ProvisionerWorkerDriver){}</code> |
| `running` | method | 74 | <code>get running():boolean{return !!this.loop&amp;&amp;!!this.controller&amp;&amp;!this.controller.signal.aborted;}</code> |
| `start` | method | 75 | <code>async start(invocation:InvocationContext):Promise&lt;unknown&gt;{</code> |
| `run` | method | 90 | <code>private async run(settings:ProvisionerWorkerSettings,signal:AbortSignal):Promise&lt;void&gt;{</code> |
| `done` | function | 98 | <code>await new Promise&lt;void&gt;(resolve=&gt;{const timer=setTimeout(done,settings.poll_ms);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',…</code> |
| `tick` | method | 101 | <code>private async tick(settings:ProvisionerWorkerSettings,signal:AbortSignal):Promise&lt;void&gt;{</code> |
| `process` | method | 121 | <code>private async process(db:ProviderDatabase,config:DeploymentConfig,row:{id:string;state:string},settings:ProvisionerWorkerSettings,signal:AbortSignal):Promise&lt;void&gt;{</code> |
| `status` | method | 138 | <code>async status(invocation:InvocationContext):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `stop` | method | 148 | <code>async stop(timeoutMs=5000):Promise&lt;void&gt;{</code> |
| `createProvisionerWorker` | function | 156 | <code>export function createProvisionerWorker(database:ProviderDatabase,env:Readonly&lt;NodeJS.ProcessEnv&gt;,signal:AbortSignal,driver:ProvisionerWorkerDriver):ProvisionerWorker{</code> |

## services/hyperfide/src/recovery/control.ts

[Open source](../../services/hyperfide/src/recovery/control.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RecoveryScope` | interface | 12 | <code>export interface RecoveryScope {organisation_id:string;run_id:string;authority_epoch:string}</code> |
| `RecoveryTransaction` | interface | 13 | <code>export interface RecoveryTransaction {</code> |
| `query` | method | 14 | <code>query&lt;R extends pg.QueryResultRow=pg.QueryResultRow&gt;(sql:string,values?:unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;R&gt;&gt;;</code> |
| `remainingMs` | method | 15 | <code>remainingMs():number; readonly signal:AbortSignal;</code> |
| `RecoveryGateway` | interface | 17 | <code>export interface RecoveryGateway {</code> |
| `withPrimaryTransaction` | method | 18 | <code>withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries?:number;guard?:(tx:RecoveryTransaction)=&gt;Promise&lt;void&gt;;signal?:AbortSignal},body:(tx:RecoveryTransaction)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;;</code> |
| `RecoveryAuthority` | interface | 20 | <code>export interface RecoveryAuthority {</code> |
| `assertCurrent` | method | 21 | <code>assertCurrent(tx:RecoveryTransaction,scope:RecoveryScope):Promise&lt;void&gt;;</code> |
| `RecoverySupervisor` | interface | 23 | <code>export interface RecoverySupervisor {</code> |
| `observe` | method | 24 | <code>observe(input:{scope:RecoveryScope;session_id:string;attempt_id:string&#124;null;sandbox_id:string&#124;null;boot_generation:string&#124;null}):Promise&lt;{</code> |
| `stop` | method | 27 | <code>stop(input:{scope:RecoveryScope;session_id:string;command_id:string;generation:string}):Promise&lt;{</code> |
| `Dependencies` | interface | 31 | <code>interface Dependencies {require&lt;T&gt;(id:string,name:string,guard:(value:unknown)=&gt;value is T):T}</code> |
| `require` | method | 31 | <code>interface Dependencies {require&lt;T&gt;(id:string,name:string,guard:(value:unknown)=&gt;value is T):T}</code> |
| `fail` | function | 32 | <code>export function fail(code:string,message:string):never {throw new FoundationError(code,message);}</code> |
| `record` | function | 33 | <code>export function record(value:unknown,required:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `uuid` | function | 38 | <code>export function uuid(value:unknown):string {</code> |
| `positive` | function | 43 | <code>export function positive(value:unknown):string{</code> |
| `digest` | function | 48 | <code>export function digest(value:unknown):string{</code> |
| `timestamp` | function | 52 | <code>export function timestamp(value:unknown):number{</code> |
| `scopeOf` | function | 59 | <code>export function scopeOf(value:unknown):RecoveryScope{</code> |
| `capability` | function | 63 | <code>export function capability&lt;T&gt;(context:ComponentContext,id:string,name:string,guard:(value:unknown)=&gt;value is T):T{</code> |
| `RecoveryEvents` | interface | 69 | <code>export interface RecoveryEvents {recoverySnapshot(tx:RecoveryTransaction,input:{organisation_id:string;run_id:string;limit:number}):Promise&lt;unknown&gt;}</code> |
| `recoverySnapshot` | method | 69 | <code>export interface RecoveryEvents {recoverySnapshot(tx:RecoveryTransaction,input:{organisation_id:string;run_id:string;limit:number}):Promise&lt;unknown&gt;}</code> |
| `RecoverySnapshotReader` | interface | 70 | <code>export interface RecoverySnapshotReader {read(tx:RecoveryTransaction,scope:RecoveryScope):Promise&lt;Record&lt;string,unknown&gt;&gt;}</code> |
| `read` | method | 70 | <code>export interface RecoverySnapshotReader {read(tx:RecoveryTransaction,scope:RecoveryScope):Promise&lt;Record&lt;string,unknown&gt;&gt;}</code> |
| `isRecoveryEvents` | function | 71 | <code>export function isRecoveryEvents(value:unknown):value is RecoveryEvents{return object(value)&amp;&amp;typeof value.recoverySnapshot==='function'}</code> |
| `isRecoverySnapshotReader` | function | 72 | <code>export function isRecoverySnapshotReader(value:unknown):value is RecoverySnapshotReader{return object(value)&amp;&amp;typeof value.read==='function'}</code> |
| `isGateway` | function | 73 | <code>export function isGateway(value:unknown):value is RecoveryGateway{return object(value)&amp;&amp;typeof value.withPrimaryTransaction==='function';}</code> |
| `isAuthority` | function | 74 | <code>export function isAuthority(value:unknown):value is RecoveryAuthority{return object(value)&amp;&amp;typeof value.assertCurrent==='function';}</code> |
| `RecoveryExecutionControls` | interface | 75 | <code>export interface RecoveryExecutionControls {</code> |
| `applyExecutionControl` | method | 76 | <code>applyExecutionControl(tx:RecoveryTransaction,scope:RecoveryScope,input:{scope_kind:'RUN'&#124;'PACKAGE'&#124;'ATTEMPT'&#124;'SANDBOX';scope_id:string;mode:'ACTIVE'&#124;'PAUSE'&#124;'DRAIN'&#124;'STOP';operation_id:string;reason:s…</code> |
| `isExecutionControls` | function | 78 | <code>export function isExecutionControls(value:unknown):value is RecoveryExecutionControls{return object(value)&amp;&amp;typeof value.applyExecutionControl==='function';}</code> |
| `derivedOperationId` | function | 79 | <code>export function derivedOperationId(namespace:string,label:string):string{</code> |
| `isSupervisor` | function | 83 | <code>export function isSupervisor(value:unknown):value is RecoverySupervisor{return object(value)&amp;&amp;typeof value.observe==='function'&amp;&amp;typeof value.stop==='function';}</code> |
| `canonical` | function | 84 | <code>export function canonical(value:unknown):string{</code> |
| `inputDigest` | function | 89 | <code>export function inputDigest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}</code> |
| `recoveryReady` | function | 91 | <code>export async function recoveryReady(tx:Pick&lt;RecoveryTransaction,'query'&gt;):Promise&lt;void&gt;{</code> |
| `lockRun` | function | 98 | <code>export async function lockRun(tx:RecoveryTransaction,scope:RecoveryScope,write=true):Promise&lt;pg.QueryResultRow&gt;{</code> |
| `recoveryTransaction` | function | 105 | <code>export async function recoveryTransaction&lt;T&gt;(context:ComponentContext,scope:RecoveryScope,body:(tx:RecoveryTransaction)=&gt;Promise&lt;T&gt;,requiresExternalAuthority=false,observation=false):Promise&lt;T&gt;{</code> |
| `operationReplay` | function | 116 | <code>export async function operationReplay(tx:RecoveryTransaction,scope:RecoveryScope,operationId:string,kind:string,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&#124;null&gt;{</code> |
| `finishOperation` | function | 128 | <code>export async function finishOperation(tx:RecoveryTransaction,scope:RecoveryScope,id:string,result:Record&lt;string,unknown&gt;,state='APPLIED'):Promise&lt;void&gt;{</code> |
| `inspectRecoveryHold` | function | 131 | <code>export async function inspectRecoveryHold(tx:Pick&lt;RecoveryTransaction,'query'&gt;,scope:RecoveryScope):Promise&lt;pg.QueryResultRow&#91;&#93;&gt;{</code> |
| `readControlSnapshot` | function | 136 | <code>export async function readControlSnapshot(tx:Pick&lt;RecoveryTransaction,'query'&gt;,scope:RecoveryScope,events?:RecoveryEvents):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `inspectSessionRecovery` | function | 162 | <code>export async function inspectSessionRecovery(tx:Pick&lt;RecoveryTransaction,'query'&gt;,scope:RecoveryScope):Promise&lt;Record&lt;string,unknown&gt;&#91;&#93;&gt;{</code> |
| `reconstructControl` | function | 181 | <code>export async function reconstructControl(pool:pg.Pool,scope:RecoveryScope):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `evaluateOffline` | function | 190 | <code>export function evaluateOffline(input:unknown,now=Date.now(),limits:{mode:'PAUSE'&#124;'BOUNDED_LOCAL';maxOfflineMs:number}={mode:'PAUSE',maxOfflineMs:0}):Record&lt;string,unknown&gt;{</code> |
| `inspectIntegrationRecovery` | function | 207 | <code>export async function inspectIntegrationRecovery(tx:Pick&lt;RecoveryTransaction,'query'&gt;,scope:RecoveryScope):Promise&lt;{ready:boolean;jobs:pg.QueryResultRow&#91;&#93;;scope_jobs:pg.QueryResultRow&#91;&#93;;preparations:p…</code> |
| `createRecoveryControlCapability` | function | 216 | <code>export function createRecoveryControlCapability(){</code> |
| `supervisorCapability` | function | 235 | <code>export function supervisorCapability(context:ComponentContext):RecoverySupervisor{</code> |
| `supervisorPresent` | function | 239 | <code>function supervisorPresent(context:ComponentContext):boolean{try{supervisorCapability(context);return true;}catch{return false;}}</code> |
| `createComponent` | function | 240 | <code>export function createComponent(startup:ComponentContext):Component{</code> |
| `AcceptedRunRebindInput` | interface | 309 | <code>export interface AcceptedRunRebindInput {</code> |
| `AcceptedRunRecoveryIntent` | interface | 314 | <code>export interface AcceptedRunRecoveryIntent extends AcceptedRunRebindInput {intent_digest:string}</code> |
| `createAcceptedRunRecoveryVerifier` | function | 318 | <code>export function createAcceptedRunRecoveryVerifier(options:{</code> |

## services/hyperfide/src/recovery/drills.ts

[Open source](../../services/hyperfide/src/recovery/drills.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `DrillScenario` | type | 7 | <code>export type DrillScenario='DATABASE'&#124;'OBJECT'&#124;'GIT'&#124;'PROVIDER'&#124;'AUTH'&#124;'FULL_DISK'&#124;'RESTORE';</code> |
| `RecoveryDrillProbe` | interface | 11 | <code>export interface RecoveryDrillProbe {</code> |
| `ready` | method | 12 | <code>ready():Promise&lt;void&gt;;</code> |
| `execute` | method | 13 | <code>execute(input:{scenario:DrillScenario;organisation_id:string;run_id:string;operation_id:string;source_epoch:string;signal:AbortSignal}):Promise&lt;{</code> |
| `bounded` | function | 18 | <code>function bounded(value:unknown):number{</code> |
| `resumable` | function | 22 | <code>function resumable(value:unknown):boolean{</code> |
| `Observed` | type | 26 | <code>type Observed=Awaited&lt;ReturnType&lt;RecoveryDrillProbe&#91;'execute'&#93;&gt;&gt;;</code> |
| `completeDrill` | function | 27 | <code>async function completeDrill(gateway:RecoveryGateway,scope:RecoveryScope,id:string,observed:Observed&#124;undefined):Promise&lt;void&gt;{</code> |
| `createComponent` | function | 47 | <code>export function createComponent(startup:ComponentContext):Component{</code> |

## services/hyperfide/src/recovery/fencing.ts

[Open source](../../services/hyperfide/src/recovery/fencing.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Binding` | type | 11 | <code>type Binding={deployment_id:string;operation_id:string;source_epoch:string&#124;null;topology_digest:string;authority_digest:string;authority_nonce:string&#124;null};</code> |
| `ExternalFenceReceipt` | interface | 12 | <code>export interface ExternalFenceReceipt {deployment_id:string;operation_id:string;fence_id:string;source_epoch:string&#124;null;isolated_writer:string;observed_at:string;expires_at:string;evidence_digest:str…</code> |
| `ExternalWriterFence` | interface | 13 | <code>export interface ExternalWriterFence {isolate(input:{deployment_id:string;operation_id:string;source_epoch:string&#124;null;signal?:AbortSignal}):Promise&lt;ExternalFenceReceipt&gt;}</code> |
| `isolate` | method | 13 | <code>export interface ExternalWriterFence {isolate(input:{deployment_id:string;operation_id:string;source_epoch:string&#124;null;signal?:AbortSignal}):Promise&lt;ExternalFenceReceipt&gt;}</code> |
| `WriterIsolationReceipt` | type | 14 | <code>export type WriterIsolationReceipt=ProviderIsolationReceipt;</code> |
| `IsolationJournalBinding` | type | 15 | <code>export type IsolationJournalBinding=ProviderIsolationBinding;</code> |
| `IsolationJournalRecord` | interface | 16 | <code>export interface IsolationJournalRecord {binding:IsolationJournalBinding;state:'PREPARED'&#124;'UNKNOWN'&#124;'ISOLATED';receipt:WriterIsolationReceipt&#124;null;observations:readonly {operation:unknown;outcome:unkn…</code> |
| `WriterObservationReceipt` | type | 17 | <code>export type WriterObservationReceipt=ProviderWriterObservation;</code> |
| `WriterObservationJournalEntry` | type | 18 | <code>export type WriterObservationJournalEntry=Parameters&lt;ProviderIsolationObservationJournal&#91;'recordObservation'&#93;&gt;&#91;0&#93;;</code> |
| `WriterObservationJournal` | interface | 19 | <code>export interface WriterObservationJournal {</code> |
| `read` | method | 20 | <code>read():Promise&lt;IsolationJournalRecord&#124;null&gt;;</code> |
| `recordObservation` | method | 21 | <code>recordObservation(value:WriterObservationJournalEntry):Promise&lt;void&gt;;</code> |
| `IsolationJournal` | interface | 23 | <code>export interface IsolationJournal {</code> |
| `read` | method | 24 | <code>read():Promise&lt;IsolationJournalRecord&#124;null&gt;;</code> |
| `prepare` | method | 25 | <code>prepare(binding:IsolationJournalBinding):Promise&lt;{created:boolean;state:IsolationJournalRecord}&gt;;</code> |
| `record` | method | 26 | <code>record(outcome:{binding:IsolationJournalBinding;receipt:WriterIsolationReceipt&#124;null;observations:readonly {operation:unknown;outcome:unknown}&#91;&#93;}):Promise&lt;void&gt;;</code> |
| `ProviderIsolationBackend` | interface | 28 | <code>export interface ProviderIsolationBackend {</code> |
| `isolateConfiguredResource` | method | 29 | <code>isolateConfiguredResource(referenceKey:string,operationId:string,signal:AbortSignal,journal:IsolationJournal):Promise&lt;WriterIsolationReceipt&gt;;</code> |
| `LegacyWriterReceipt` | interface | 31 | <code>export interface LegacyWriterReceipt {</code> |
| `LegacyWriterBackend` | interface | 37 | <code>export interface LegacyWriterBackend {</code> |
| `disableAdmission` | method | 38 | <code>disableAdmission(input:{deployment_id:string;operation_id:string;source_epoch:string&#124;null;signal?:AbortSignal}):Promise&lt;LegacyWriterReceipt&gt;;</code> |
| `observeIsolation` | method | 39 | <code>observeIsolation(input:{deployment_id:string;operation_id:string;source_epoch:string&#124;null;signal?:AbortSignal}):Promise&lt;LegacyWriterReceipt&gt;;</code> |
| `ExternalFenceTopology` | interface | 41 | <code>export interface ExternalFenceTopology {</code> |
| `ExternalFenceAuthority` | type | 47 | <code>export type ExternalFenceAuthority={kind:'INVOCATION';invocation:InvocationContext;gateway:Pick&lt;TransactionGateway,'withPrimaryTransaction'&gt;}&#124;{kind:'ISOLATION_PERMIT';permit:VerifiedIsolationPermit};</code> |
| `ProviderIsolationCapability` | interface | 48 | <code>export interface ProviderIsolationCapability {</code> |
| `isolateConfiguredResource` | method | 49 | <code>isolateConfiguredResource(referenceKey:string,operationId:string,authority:InvocationContext&#124;VerifiedIsolationPermit,signal:AbortSignal,journal:IsolationJournal):Promise&lt;WriterIsolationReceipt&gt;;</code> |
| `bindProviderIsolation` | function | 51 | <code>export function bindProviderIsolation(capability:ProviderIsolationCapability,authority:InvocationContext&#124;VerifiedIsolationPermit):ProviderIsolationBackend {</code> |
| `JournalDocument` | type | 55 | <code>type JournalDocument={schema_version:1;binding:Binding;authorizations:{authority_digest:string;authority_nonce:string&#124;null}&#91;&#93;;resources:Record&lt;string,IsolationJournalRecord&gt;;completion_receipt?:Extern…</code> |
| `coreBinding` | function | 56 | <code>function coreBinding(v:Binding){return {deployment_id:v.deployment_id,operation_id:v.operation_id,source_epoch:v.source_epoch,topology_digest:v.topology_digest}}</code> |
| `fail` | function | 57 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message)}</code> |
| `canonical` | function | 58 | <code>function canonical(v:unknown):string{if(v===null&#124;&#124;typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '&#91;'+v.map(canonical).join(',')+'&#93;';return '{'+Object.keys(v).sort().map(k=&gt;JSO…</code> |
| `hash` | function | 59 | <code>function hash(v:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(v)).digest('hex')}</code> |
| `uuid` | function | 60 | <code>function uuid(v:unknown):v is string{return typeof v==='string'&amp;&amp;/^&#91;0-9a-f&#93;{8}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{12}$/.test(v)}</code> |
| `digest` | function | 61 | <code>function digest(v:unknown):v is string{return typeof v==='string'&amp;&amp;/^sha256:&#91;0-9a-f&#93;{64}$/.test(v)}</code> |
| `name` | function | 62 | <code>function name(v:unknown):v is string{return typeof v==='string'&amp;&amp;/^&#91;A-Za-z0-9&#93;&#91;A-Za-z0-9._:-&#93;{0,127}$/.test(v)}</code> |
| `time` | function | 63 | <code>function time(v:unknown):number{if(typeof v!=='string')fail('EXTERNAL_FENCE_INVALID','Missing observation timestamp');const n=Date.parse(v);if(!Number.isFinite(n)&#124;&#124;new Date(n).toISOString()!==v)fail('…</code> |
| `checkBinding` | function | 64 | <code>function checkBinding(v:Binding):void{if(!uuid(v.deployment_id)&#124;&#124;!uuid(v.operation_id)&#124;&#124;v.source_epoch!==null&amp;&amp;!uuid(v.source_epoch)&#124;&#124;!digest(v.topology_digest)&#124;&#124;!digest(v.authority_digest)&#124;&#124;v.authori…</code> |
| `checkResourceBinding` | function | 65 | <code>function checkResourceBinding(v:IsolationJournalBinding):void{if(v.schema_version!==1&#124;&#124;!uuid(v.operation_id)&#124;&#124;!name(v.reference_key)&#124;&#124;!digest(v.topology_digest)&#124;&#124;!digest(v.resource_identity_digest)&#124;&#124;!…</code> |
| `checkReceipt` | function | 66 | <code>function checkReceipt(v:WriterIsolationReceipt,b:Binding,r:IsolationJournalBinding):void{</code> |
| `checkFresh` | function | 71 | <code>function checkFresh(observed:string,expires:string,now:number):void{</code> |
| `FileExternalFenceJournal` | class | 78 | <code>export class FileExternalFenceJournal {</code> |
| `constructor` | method | 79 | <code>constructor(private readonly directory:string){}</code> |
| `readCompleted` | method | 80 | <code>async readCompleted(input:{deployment_id:string;operation_id:string;source_epoch:string&#124;null;topology_digest:string;expected_proof_digest?:string}):Promise&lt;ExternalFenceReceipt&gt;{</code> |
| `withOperation` | method | 107 | <code>async withOperation&lt;T&gt;(binding:Binding,body:(resource:(key:string)=&gt;IsolationJournal,recordCompletion:(receipt:ExternalFenceReceipt)=&gt;Promise&lt;void&gt;)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `withObservation` | method | 110 | <code>async withObservation&lt;T&gt;(binding:Binding,body:(resource:(key:string)=&gt;WriterObservationJournal)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `operate` | method | 113 | <code>private async operate&lt;T&gt;(binding:Binding,body:(resource:(key:string)=&gt;IsolationJournal,recordCompletion:(receipt:ExternalFenceReceipt)=&gt;Promise&lt;void&gt;,observations:(key:string)=&gt;WriterObservationJourna…</code> |
| `topology` | function | 196 | <code>function topology(value:ExternalFenceTopology):ExternalFenceTopology{</code> |
| `externalFenceTopologyDigest` | function | 207 | <code>export function externalFenceTopologyDigest(config:ExternalFenceTopology):string{return hash(topology(config))}</code> |
| `createExternalWriterFence` | function | 208 | <code>export function createExternalWriterFence(config:ExternalFenceTopology,providers:ProviderIsolationBackend,legacy:LegacyWriterBackend,journal:FileExternalFenceJournal,authority:ExternalFenceAuthority,o…</code> |
| `ExternalFenceObservation` | interface | 267 | <code>export interface ExternalFenceObservation {</code> |
| `ProviderWriterObservationCapability` | interface | 273 | <code>export interface ProviderWriterObservationCapability {</code> |
| `observeConfiguredResource` | method | 274 | <code>observeConfiguredResource(referenceKey:string,operationId:string,authority:VerifiedWriterObservationPermit,signal:AbortSignal,journal:WriterObservationJournal):Promise&lt;WriterObservationReceipt&gt;;</code> |
| `createExternalWriterObserver` | function | 277 | <code>export function createExternalWriterObserver(config:ExternalFenceTopology,providers:ProviderWriterObservationCapability,legacy:Pick&lt;LegacyWriterBackend,'observeIsolation'&gt;,journal:FileExternalFenceJou…</code> |

## services/hyperfide/src/recovery/fencing_service.ts

[Open source](../../services/hyperfide/src/recovery/fencing_service.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FencingConfiguration` | interface | 11 | <code>interface FencingConfiguration {</code> |
| `ExternalFencingService` | interface | 15 | <code>export interface ExternalFencingService {</code> |
| `isolate` | method | 17 | <code>isolate(permit:VerifiedIsolationPermit,signal:AbortSignal):Promise&lt;ExternalFenceReceipt&gt;;</code> |
| `describe` | method | 18 | <code>describe():Readonly&lt;Record&lt;string,unknown&gt;&gt;;</code> |
| `close` | method | 19 | <code>close():Promise&lt;void&gt;;</code> |
| `ExternalFencingServiceOptions` | interface | 21 | <code>export interface ExternalFencingServiceOptions {</code> |
| `fail` | function | 25 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message)}</code> |
| `fields` | function | 26 | <code>function fields(value:unknown,required:readonly string&#91;&#93;,optional:readonly string&#91;&#93;=&#91;&#93;,code='EXTERNAL_FENCE_CONFIG_INVALID'):asserts value is Record&lt;string,unknown&gt;{</code> |
| `configuration` | function | 29 | <code>async function configuration(filename:string&#124;undefined):Promise&lt;FencingConfiguration&gt;{</code> |
| `startExternalFencingService` | function | 46 | <code>export async function startExternalFencingService(options:ExternalFencingServiceOptions):Promise&lt;ExternalFencingService&gt;{</code> |
| `startProviderExternalFencingService` | function | 68 | <code>export async function startProviderExternalFencingService(options:Omit&lt;ExternalFencingServiceOptions,'providers'&gt;&amp;{runtime:Omit&lt;ProviderIsolationRuntime,'env'&#124;'signal'&gt;}):Promise&lt;ExternalFencingServic…</code> |
| `provider` | function | 72 | <code>function provider(value:unknown):value is ProviderIsolationCapability{return object(value)&amp;&amp;typeof value.isolateConfiguredResource==='function'}</code> |
| `legacy` | function | 73 | <code>function legacy(value:unknown):value is LegacyWriterBackend{return object(value)&amp;&amp;typeof value.disableAdmission==='function'&amp;&amp;typeof value.observeIsolation==='function'}</code> |
| `createComponent` | function | 75 | <code>export async function createComponent(context:ComponentContext):Promise&lt;Component&gt;{</code> |

## services/hyperfide/src/recovery/stop.ts

[Open source](../../services/hyperfide/src/recovery/stop.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ranks` | object | 6 | <code>const ranks:Record&lt;string,number&gt;={PAUSE:2,DRAIN:1,CANCEL:4,STOP:3};</code> |
| `publicationBlocked` | function | 7 | <code>export async function publicationBlocked(tx:{query:(sql:string,values:unknown&#91;&#93;)=&gt;Promise&lt;{rows:Record&lt;string,unknown&gt;&#91;&#93;}&gt;},org:string,run:string):Promise&lt;boolean&gt;{</code> |
| `requestScopedControl` | function | 12 | <code>async function requestScopedControl(input:unknown,context:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 91 | <code>export function createComponent(_context:ComponentContext):Component{</code> |

## services/hyperfide/src/recovery/workers.ts

[Open source](../../services/hyperfide/src/recovery/workers.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `OBSERVED` | object | 7 | <code>const OBSERVED:Record&lt;string,{absent:string&#91;&#93;;present:string&#91;&#93;}&gt;={SUPERVISOR:{absent:&#91;'STOPPED'&#93;,present:&#91;'RUNNING','UNREACHABLE'&#93;},SANDBOX:{absent:&#91;'ABSENT'&#93;,present:&#91;'PRESENT','UNREACHABLE'&#93;}};</code> |
| `text` | function | 9 | <code>function text(value:unknown,limit=255):string{if(typeof value!=='string'&#124;&#124;value.length&lt;1&#124;&#124;value.length&gt;limit)fail('RECOVERY_INPUT_INVALID','Bounded identifier required');return value;}</code> |
| `leaseMs` | function | 10 | <code>function leaseMs(value:unknown):number{if(typeof value!=='number'&#124;&#124;!Number.isInteger(value)&#124;&#124;value&lt;1000&#124;&#124;value&gt;300000)fail('RECOVERY_INPUT_INVALID','lease_ms must be an integer between 1000 and 300000…</code> |
| `lockRequest` | function | 11 | <code>async function lockRequest(tx:RecoveryTransaction,scope:RecoveryScope,id:string):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `recordInventory` | function | 17 | <code>async function recordInventory(tx:RecoveryTransaction,scope:RecoveryScope,lossId:string,input:unknown):Promise&lt;{observed:Record&lt;string,unknown&gt;&#91;&#93;;surviving:Record&lt;string,unknown&gt;&#91;&#93;}&gt;{</code> |
| `compatibility` | function | 38 | <code>async function compatibility(tx:RecoveryTransaction,scope:RecoveryScope,source:Record&lt;string,unknown&gt;,checkpointId:string,target:Record&lt;string,unknown&gt;):Promise&lt;{reasons:string&#91;&#93;;checkpoint:Record&lt;str…</code> |
| `lineage` | function | 59 | <code>async function lineage(tx:RecoveryTransaction,scope:RecoveryScope,attempt:string):Promise&lt;{attempt:Record&lt;string,unknown&gt;;requests:Record&lt;string,unknown&gt;&#91;&#93;}&gt;{</code> |
| `currentAuthority` | function | 67 | <code>async function currentAuthority(tx:RecoveryTransaction,scope:RecoveryScope,attempt:Record&lt;string,unknown&gt;,generation:string,boot:string,session:string):Promise&lt;{reason:string&#124;null;lease?:Record&lt;string…</code> |
| `createComponent` | function | 80 | <code>export function createComponent(_context:ComponentContext):Component{</code> |
