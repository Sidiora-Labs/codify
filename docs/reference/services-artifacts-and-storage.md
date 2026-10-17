# Source reference: Control services: artifacts and storage

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the `artifacts/`, `contracts/`, `deployment/`, `migration/`, `release/` and `storage/` subtrees of `services/hyperfide/src/`: 614 declarations in 25 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## services/hyperfide/src/artifacts/adoption.ts

[Open source](../../services/hyperfide/src/artifacts/adoption.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Invocation` | type | 18 | <code>type Invocation=InvocationContext;</code> |
| `Context` | type | 19 | <code>type Context=ComponentContext;</code> |
| `Artifacts` | type | 20 | <code>type Artifacts={invoke:(action:string,input:unknown,context:ComponentContext)=&gt;Promise&lt;unknown&gt;};</code> |
| `Sessions` | type | 21 | <code>type Sessions={resumeCheck:(input:unknown,context:InvocationContext)=&gt;Promise&lt;unknown&gt;};</code> |
| `fail` | function | 24 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `record` | function | 25 | <code>function record(value:unknown):Record&lt;string,unknown&gt;{if(!value&#124;&#124;typeof value!=='object'&#124;&#124;Array.isArray(value))fail('ADOPTION_INPUT_INVALID','Expected an object');return value as Record&lt;string,unknown…</code> |
| `exact` | function | 26 | <code>function exact(value:unknown,required:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):Record&lt;string,unknown&gt;{const row=record(value);if(required.some(key=&gt;!Object.hasOwn(row,key))&#124;&#124;Object.keys(row).some(key=&gt;!&#91;...requ…</code> |
| `uuid` | function | 27 | <code>function uuid(value:unknown):string{if(typeof value!=='string'&#124;&#124;!UUID.test(value))fail('ADOPTION_INPUT_INVALID','Expected UUID');return value;}</code> |
| `digest` | function | 28 | <code>function digest(value:unknown):string{if(typeof value!=='string'&#124;&#124;!DIGEST.test(value))fail('ADOPTION_INPUT_INVALID','Expected SHA-256 digest');return value;}</code> |
| `byteCount` | function | 29 | <code>function byteCount(value:unknown):string{if(typeof value!=='string'&#124;&#124;!/^(0&#124;&#91;1-9&#93;&#91;0-9&#93;{0,18})$/.test(value)&#124;&#124;BigInt(value)&gt;1073741824n)fail('CHECKPOINT_CONTEXT_MISMATCH','Bounded context byte count req…</code> |
| `canonical` | function | 30 | <code>function canonical(value:unknown):string{</code> |
| `capability` | function | 35 | <code>function capability(value:unknown):value is Artifacts{return !!value&amp;&amp;typeof value==='object'&amp;&amp;'invoke' in value&amp;&amp;typeof value.invoke==='function';}</code> |
| `sessionCapability` | function | 36 | <code>function sessionCapability(value:unknown):value is Sessions{return !!value&amp;&amp;typeof value==='object'&amp;&amp;'resumeCheck' in value&amp;&amp;typeof value.resumeCheck==='function';}</code> |
| `Request` | type | 37 | <code>type Request={token:ComputeToken;source_checkpoint_id:string;source_expected_artifact_digest:string;target_expected_input_packet_digest:string;target_expected_preparation_digest:string;mode:'SOURCE_ON…</code> |
| `parse` | function | 38 | <code>function parse(input:unknown):Request{</code> |
| `Checkpoint` | type | 50 | <code>type Checkpoint=CheckpointLineage;</code> |
| `ArtifactAdoption` | class | 52 | <code>export class ArtifactAdoption{</code> |
| `constructor` | method | 53 | <code>constructor(private readonly context:Context){}</code> |
| `targetActor` | method | 54 | <code>private async targetActor(tx:PrimaryTransaction,token:ComputeToken,actor:Invocation):Promise&lt;void&gt;{</code> |
| `authority` | method | 72 | <code>private authority(request:Request):Invocation{</code> |
| `transaction` | method | 79 | <code>private async transaction&lt;T&gt;(actor:Invocation,body:(tx:PrimaryTransaction)=&gt;Promise&lt;T&gt;,identityOnly=false):Promise&lt;T&gt;{</code> |
| `checkpoint` | method | 83 | <code>private async checkpoint(tx:PrimaryTransaction,request:Request):Promise&lt;Checkpoint&gt;{</code> |
| `prior` | method | 90 | <code>private async prior(tx:PrimaryTransaction,actor:Invocation,payload:string):Promise&lt;Record&lt;string,unknown&gt;&#124;undefined&gt;{</code> |
| `adopt` | method | 95 | <code>async adopt(input:unknown,commit:boolean):Promise&lt;unknown&gt;{</code> |
| `registerCheckpoint` | method | 137 | <code>async registerCheckpoint(input:unknown,stale:boolean):Promise&lt;unknown&gt;{</code> |
| `inspectCheckpoint` | method | 234 | <code>async inspectCheckpoint(input:unknown):Promise&lt;unknown&gt;{</code> |
| `ArtifactAdoptionCapability` | interface | 253 | <code>export interface ArtifactAdoptionCapability{</code> |
| `adopt` | method | 254 | <code>adopt(input:unknown,context:ComponentContext&#124;InvocationContext):Promise&lt;unknown&gt;;</code> |
| `validate` | method | 255 | <code>validate(input:unknown,context:ComponentContext&#124;InvocationContext):Promise&lt;unknown&gt;;</code> |
| `registerCheckpoint` | method | 256 | <code>registerCheckpoint(input:unknown,context:ComponentContext&#124;InvocationContext):Promise&lt;unknown&gt;;</code> |
| `importCheckpoint` | method | 257 | <code>importCheckpoint(input:unknown,context:ComponentContext&#124;InvocationContext):Promise&lt;unknown&gt;;</code> |
| `inspectCheckpoint` | method | 258 | <code>inspectCheckpoint(input:unknown,context:ComponentContext&#124;InvocationContext):Promise&lt;unknown&gt;;</code> |
| `isArtifactAdoptionCapability` | function | 260 | <code>export function isArtifactAdoptionCapability(value:unknown):value is ArtifactAdoptionCapability{</code> |
| `createComponent` | function | 264 | <code>export function createComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/artifacts/checkpoint-recipes.ts

[Open source](../../services/hyperfide/src/artifacts/checkpoint-recipes.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `EvidenceClass` | type | 7 | <code>export type EvidenceClass='SOURCE'&#124;'SESSION'&#124;'ENVIRONMENT';</code> |
| `AdoptionMode` | type | 8 | <code>export type AdoptionMode='SOURCE_ONLY'&#124;'NATIVE_RESUME';</code> |
| `RecipeOutcome` | interface | 9 | <code>export interface RecipeOutcome{readonly evidence_class:EvidenceClass;readonly verdict:'COMPATIBLE'&#124;'REBUILD_REQUIRED'&#124;'FRESH_SESSION';readonly rule:string;readonly source:string&#124;null;readonly target:s…</code> |
| `CheckpointLineage` | interface | 10 | <code>export interface CheckpointLineage{</code> |
| `TargetIdentity` | interface | 16 | <code>export interface TargetIdentity{task_id:string;attempt_id:string;attempt_generation:string}</code> |
| `TargetExecution` | interface | 17 | <code>export interface TargetExecution{input_packet_digest:string;preparation_digest:string}</code> |
| `NativeResumeRequest` | interface | 18 | <code>export interface NativeResumeRequest{session_id:string;native_session_id:string;configuration_digest:string;source_manifest_digest:string}</code> |
| `fail` | function | 25 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `sourceRecipe` | function | 28 | <code>export function sourceRecipe(source:CheckpointLineage,target:TargetIdentity,expectedArtifactDigest:string):RecipeOutcome{</code> |
| `sourceUnchanged` | function | 40 | <code>export function sourceUnchanged(initial:CheckpointLineage,current:CheckpointLineage):void{</code> |
| `sessionPrecheck` | function | 45 | <code>export function sessionPrecheck(source:CheckpointLineage,mode:AdoptionMode,native:NativeResumeRequest&#124;null,expectedPacketDigest:string):void{</code> |
| `sessionRecipe` | function | 52 | <code>export function sessionRecipe(source:CheckpointLineage,mode:AdoptionMode,resume:Record&lt;string,unknown&gt;&#124;null):RecipeOutcome{</code> |
| `environmentRecipe` | function | 58 | <code>export function environmentRecipe(source:CheckpointLineage,mode:AdoptionMode,target:TargetExecution,expected:TargetExecution):RecipeOutcome{</code> |

## services/hyperfide/src/artifacts/continuation.ts

[Open source](../../services/hyperfide/src/artifacts/continuation.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CheckpointArtifactBinding` | interface | 7 | <code>export interface CheckpointArtifactBinding{</code> |
| `CheckpointContinuation` | interface | 11 | <code>export interface CheckpointContinuation{</code> |
| `fail` | function | 20 | <code>function fail():never{throw new FoundationError('CHECKPOINT_CONTINUATION_UNAVAILABLE','Registered immutable checkpoint context is unavailable');}</code> |
| `readCheckpointContinuation` | function | 24 | <code>export async function readCheckpointContinuation(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;checkpoint_id:string},invocation:InvocationContext):Promise&lt;CheckpointContinuation&gt;{</code> |

## services/hyperfide/src/artifacts/destruction.ts

[Open source](../../services/hyperfide/src/artifacts/destruction.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uuid` | function | 8 | <code>function uuid(value:string):void{if(typeof value!=='string'&#124;&#124;!UUID.test(value))throw new FoundationError('DESTRUCTION_SCOPE_INVALID','Canonical destruction scope is required');}</code> |
| `readArtifactDestructionPreflight` | function | 11 | <code>export const readArtifactDestructionPreflight:ProviderDestructionPreflight=async(tx,input)=&gt;{</code> |
| `registerArtifactDestructionPreflight` | function | 29 | <code>export function registerArtifactDestructionPreflight(context:ComponentContext):void{</code> |

## services/hyperfide/src/artifacts/objects.ts

[Open source](../../services/hyperfide/src/artifacts/objects.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ArtifactScope` | type | 16 | <code>export type ArtifactScope={organisation_id:string;run_id:string};</code> |
| `Scope` | type | 17 | <code>type Scope=ArtifactScope;</code> |
| `ArtifactReference` | interface | 18 | <code>export interface ArtifactReference{artifact_id:string;receipt_id:string;digest:string;size_bytes:string}</code> |
| `ArtifactReceipt` | interface | 19 | <code>export interface ArtifactReceipt extends ArtifactScope{schema_version:1;receipt_id:string;artifact_id:string;digest:string;size_bytes:string;storage_backend:string;storage_key:string;completed_at:stri…</code> |
| `Invocation` | type | 20 | <code>type Invocation={principal:{organisation_id:string;run_id:string;role:string};guard:(tx:QuerySession)=&gt;Promise&lt;void&gt;;signal:AbortSignal};</code> |
| `RequestContext` | type | 21 | <code>type RequestContext=ComponentContext&amp;{invocation?:Invocation};</code> |
| `Retention` | type | 22 | <code>type Retention={retention_class:string;retention_until:string&#124;null;retention_hold:boolean};</code> |
| `Artifact` | type | 23 | <code>type Artifact=Scope&amp;Retention&amp;{id:string;digest:string;size_bytes:string;storage_backend:string;storage_key:string;status:string;state_version:string;completed_at:Date&#124;null};</code> |
| `Chunk` | type | 24 | <code>type Chunk={sequence:number;artifact_id:string;digest:string;size_bytes:string;offset_bytes:string};</code> |
| `Manifest` | type | 25 | <code>type Manifest=Scope&amp;{schema_version:1;kind:'chunk-manifest';expected_chunks:number;total_size_bytes:string;content_digest:string;complete:true;truncated:false;missing_ranges:never&#91;&#93;;chunks:Chunk&#91;&#93;};</code> |
| `Config` | type | 26 | <code>type Config={endpoint:URL;region:string;bucket:string;access:string;secret:string;token:string&#124;undefined;organisation:string;runs:ReadonlySet&lt;string&gt;};</code> |
| `Observation` | type | 27 | <code>type Observation={availability:'VERIFIED';bytes:Buffer;etag:string&#124;null}&#124;{availability:'ABSENT'&#124;'UNKNOWN'};</code> |
| `hash` | function | 28 | <code>const hash=(bytes:Buffer&#124;string)=&gt;'sha256:'+createHash('sha256').update(bytes).digest('hex');</code> |
| `fail` | function | 29 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `fields` | function | 30 | <code>function fields(input:unknown,required:readonly string&#91;&#93;,optional:readonly string&#91;&#93;=&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `uuid` | function | 36 | <code>function uuid(value:unknown):string{if(typeof value!=='string'&#124;&#124;!UUID.test(value))fail('ARTIFACT_INPUT_INVALID','Expected a canonical UUID');return value;}</code> |
| `digest` | function | 37 | <code>function digest(value:unknown):string{if(typeof value!=='string'&#124;&#124;!DIGEST.test(value))fail('ARTIFACT_INPUT_INVALID','Expected a SHA-256 digest');return value;}</code> |
| `decimal` | function | 38 | <code>function decimal(value:unknown,max=BigInt(MAX_OBJECT)):string{</code> |
| `retention` | function | 44 | <code>function retention(value:Record&lt;string,unknown&gt;):Retention{</code> |
| `configuration` | function | 51 | <code>function configuration(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Config{</code> |
| `keyOf` | function | 68 | <code>function keyOf(scope:Scope,value:string,manifest=false):string{return 'hyperfide/v1/'+scope.organisation_id+'/'+scope.run_id+(manifest?'/manifests':'')+'/sha256/'+value.slice(7);}</code> |
| `hmac` | function | 69 | <code>function hmac(key:Buffer&#124;string,value:string):Buffer{return createHmac('sha256',key).update(value).digest();}</code> |
| `encode` | function | 70 | <code>function encode(value:string):string{return encodeURIComponent(value).replace(/&#91;!'()&#42;&#93;/g,c=&gt;'%'+c.charCodeAt(0).toString(16).toUpperCase());}</code> |
| `S3` | class | 72 | <code>class S3 {</code> |
| `constructor` | method | 73 | <code>constructor(private readonly config:Config,private readonly signal:AbortSignal){}</code> |
| `request` | method | 74 | <code>private async request(method:'GET'&#124;'PUT'&#124;'DELETE',key:string,body?:Buffer,etag?:string):Promise&lt;Response&gt;{</code> |
| `put` | method | 90 | <code>async put(key:string,bytes:Buffer):Promise&lt;'ACKNOWLEDGED'&#124;'EXISTS'&#124;'UNKNOWN'&gt;{</code> |
| `observe` | method | 99 | <code>async observe(key:string,expectedDigest:string,size:string):Promise&lt;Observation&gt;{</code> |
| `destroy` | method | 121 | <code>async destroy(key:string,expectedDigest:string,size:string):Promise&lt;'ABSENT'&#124;'UNKNOWN'&gt;{</code> |
| `assertCompleteArtifactReferences` | function | 148 | <code>export async function assertCompleteArtifactReferences(tx:PrimaryTransaction,scope:ArtifactScope,references:readonly ArtifactReference&#91;&#93;):Promise&lt;readonly Readonly&lt;ArtifactReceipt&gt;&#91;&#93;&gt;{</code> |
| `assertCompleteArtifactReference` | function | 167 | <code>export async function assertCompleteArtifactReference(tx:PrimaryTransaction,scope:ArtifactScope,reference:ArtifactReference):Promise&lt;Readonly&lt;ArtifactReceipt&gt;&gt;{</code> |
| `ArtifactStore` | class | 174 | <code>export class ArtifactStore{</code> |
| `constructor` | method | 176 | <code>constructor(private readonly context:RequestContext){}</code> |
| `config` | method | 177 | <code>private config():Config{return this.configValue??=configuration(this.context.env);}</code> |
| `scope` | method | 178 | <code>private scope(value:Record&lt;string,unknown&gt;):Scope{</code> |
| `backend` | method | 188 | <code>private backend():S3{return new S3(this.config(),AbortSignal.any(&#91;this.context.signal,this.context.invocation?.signal??this.context.signal&#93;));}</code> |
| `transaction` | method | 189 | <code>private async transaction&lt;T&gt;(operation:(client:PrimaryTransaction)=&gt;Promise&lt;T&gt;,mode:'READ'&#124;'WRITE'='WRITE'):Promise&lt;T&gt;{</code> |
| `load` | method | 198 | <code>private async load(scope:Scope,id:string,client?:QuerySession):Promise&lt;Artifact&gt;{</code> |
| `same` | method | 205 | <code>private same(row:Artifact,size:string,policy:Retention,manifest:boolean):void{</code> |
| `intent` | method | 209 | <code>private async intent(scope:Scope,value:string,size:string,policy:Retention,manifest:boolean):Promise&lt;{row:Artifact;created:boolean}&gt;{</code> |
| `complete` | method | 218 | <code>private async complete(row:Artifact,client?:PrimaryTransaction):Promise&lt;Artifact&gt;{</code> |
| `store` | method | 225 | <code>private async store(scope:Scope,bytes:Buffer,policy:Retention,manifest=false):Promise&lt;{row:Artifact;observation:Observation}&gt;{</code> |
| `put` | method | 237 | <code>private async put(input:unknown):Promise&lt;unknown&gt;{</code> |
| `object` | method | 244 | <code>private async object(input:unknown,operation:'read'&#124;'inspect'&#124;'reconcile'&#124;'manifest'):Promise&lt;unknown&gt;{</code> |
| `parseManifest` | method | 268 | <code>private parseManifest(value:Record&lt;string,unknown&gt;,scope:Scope):Manifest{</code> |
| `parseManifestBytes` | method | 283 | <code>private parseManifestBytes(bytes:Buffer,scope:Scope):Manifest{</code> |
| `verifyChunks` | method | 291 | <code>private async verifyChunks(scope:Scope,manifest:Manifest):Promise&lt;void&gt;{</code> |
| `edges` | method | 302 | <code>private async edges(scope:Scope,parent:string,client?:QuerySession):Promise&lt;Chunk&#91;&#93;&gt;{</code> |
| `sameEdges` | method | 307 | <code>private sameEdges(chunks:Chunk&#91;&#93;,edges:Chunk&#91;&#93;):void{if(JSON.stringify(chunks)!==JSON.stringify(edges))fail('ARTIFACT_BINDING_CONFLICT','Manifest dependency closure differs');}</code> |
| `commit` | method | 308 | <code>private async commit(input:unknown):Promise&lt;unknown&gt;{</code> |
| `locate` | method | 332 | <code>private async locate(input:unknown):Promise&lt;unknown&gt;{</code> |
| `pending` | method | 341 | <code>private async pending(input:unknown):Promise&lt;unknown&gt;{</code> |
| `invoke` | method | 348 | <code>async invoke(action:string,input:unknown,context?:ComponentContext&#124;InvocationContext):Promise&lt;unknown&gt;{</code> |
| `destroyTombstoned` | method | 370 | <code>async destroyTombstoned(input:unknown,context?:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `close` | method | 386 | <code>close():void{/&#42; Shared PostgreSQL pool lifecycle belongs to the storage resource owner. &#42;/}</code> |
| `ArtifactStoreCapability` | interface | 388 | <code>export interface ArtifactStoreCapability{invoke(action:string,input:unknown,context:ComponentContext&#124;InvocationContext):Promise&lt;unknown&gt;}</code> |
| `invoke` | method | 388 | <code>export interface ArtifactStoreCapability{invoke(action:string,input:unknown,context:ComponentContext&#124;InvocationContext):Promise&lt;unknown&gt;}</code> |
| `isArtifactStoreCapability` | function | 389 | <code>export function isArtifactStoreCapability(value:unknown):value is ArtifactStoreCapability{return !!value&amp;&amp;typeof value==='object'&amp;&amp;'invoke' in value&amp;&amp;typeof value.invoke==='function';}</code> |
| `createArtifactStore` | function | 390 | <code>export function createArtifactStore(context:ComponentContext):ArtifactStore{return new ArtifactStore(context);}</code> |
| `createComponent` | function | 391 | <code>export function createComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/artifacts/retention.ts

[Open source](../../services/hyperfide/src/artifacts/retention.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Invocation` | type | 10 | <code>type Invocation={principal:{organisation_id:string;run_id:string;actor_id:string;deployment_epoch:string;role:string};operation:{operation_id:string};guard:(tx:QuerySession)=&gt;Promise&lt;void&gt;;signal:Abor…</code> |
| `Context` | type | 11 | <code>type Context=ComponentContext&amp;{invocation?:Invocation};</code> |
| `Scope` | type | 12 | <code>type Scope={organisation_id:string;run_id:string};</code> |
| `Backend` | type | 13 | <code>type Backend={destroyTombstoned:(input:unknown,context:ComponentContext)=&gt;Promise&lt;unknown&gt;};</code> |
| `Row` | type | 14 | <code>type Row=Record&lt;string,any&gt;;</code> |
| `Policy` | type | 15 | <code>type Policy={digest:string;minimum_age_ms:Record&lt;string,number&#124;null&gt;};</code> |
| `fail` | function | 20 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `record` | function | 21 | <code>function record(value:unknown):Row{if(!value&#124;&#124;typeof value!=='object'&#124;&#124;Array.isArray(value))fail('RETENTION_INPUT_INVALID','Expected an object');return value as Row;}</code> |
| `fields` | function | 22 | <code>function fields(value:unknown,required:string&#91;&#93;):Row{const row=record(value);if(Object.keys(row).length!==required.length&#124;&#124;required.some(key=&gt;!Object.hasOwn(row,key)))fail('RETENTION_INPUT_INVALID','R…</code> |
| `uuid` | function | 23 | <code>function uuid(value:unknown):string{if(typeof value!=='string'&#124;&#124;!UUID.test(value))fail('RETENTION_INPUT_INVALID','Expected UUID');return value;}</code> |
| `digest` | function | 24 | <code>function digest(value:unknown):string{if(typeof value!=='string'&#124;&#124;!DIGEST.test(value))fail('RETENTION_INPUT_INVALID','Expected SHA-256 digest');return value;}</code> |
| `decimal` | function | 25 | <code>function decimal(value:unknown):string{if(typeof value!=='string'&#124;&#124;!/^&#91;1-9&#93;&#91;0-9&#93;{0,18}$/.test(value)&#124;&#124;BigInt(value)&gt;9223372036854775807n)fail('RETENTION_INPUT_INVALID','Expected positive canonical ver…</code> |
| `reason` | function | 26 | <code>function reason(value:unknown):string{if(typeof value!=='string'&#124;&#124;value.length&lt;1&#124;&#124;value.length&gt;2048&#124;&#124;/&#91;&#92;x00-&#92;x1f&#92;x7f&#93;/.test(value))fail('RETENTION_INPUT_INVALID','Bounded audit reason required');retur…</code> |
| `timestamp` | function | 27 | <code>function timestamp(value:unknown):string&#124;null{if(value===null)return null;if(typeof value!=='string'&#124;&#124;!/^&#92;d{4}-&#92;d{2}-&#92;d{2}T&#92;d{2}:&#92;d{2}:&#92;d{2}&#92;.&#92;d{3}Z$/.test(value)&#124;&#124;!Number.isFinite(Date.parse(value))&#124;…</code> |
| `canonical` | function | 28 | <code>function canonical(value:unknown):string{if(value===null&#124;&#124;typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '&#91;'+value.map(canonical).join(',')+'&#93;';return '{'+Object.k…</code> |
| `hash` | function | 29 | <code>function hash(value:string&#124;Buffer):string{return 'sha256:'+createHash('sha256').update(value).digest('hex');}</code> |
| `backend` | function | 30 | <code>function backend(value:unknown):value is Backend{return !!value&amp;&amp;typeof value==='object'&amp;&amp;'destroyTombstoned' in value&amp;&amp;typeof value.destroyTombstoned==='function';}</code> |
| `ArtifactRetention` | class | 31 | <code>export class ArtifactRetention{</code> |
| `constructor` | method | 32 | <code>constructor(private readonly context:Context){}</code> |
| `actor` | method | 33 | <code>private actor():Invocation{const actor=this.context.invocation;assertInvocation(actor);return actor;}</code> |
| `scope` | method | 34 | <code>private scope(value:Row):Scope{const scope={organisation_id:uuid(value.organisation_id),run_id:uuid(value.run_id)},actor=this.actor();if(scope.organisation_id!==actor.principal.organisation_id&#124;&#124;scope.…</code> |
| `policy` | method | 35 | <code>private async policy(expected:unknown):Promise&lt;Policy&gt;{</code> |
| `transaction` | method | 48 | <code>private async transaction&lt;T&gt;(body:(tx:PrimaryTransaction)=&gt;Promise&lt;T&gt;,mode:'READ'&#124;'WRITE'='WRITE'):Promise&lt;T&gt;{const actor=this.actor();return this.context.resources.gateway.withPrimaryTransaction({tim…</code> |
| `artifact` | method | 49 | <code>private async artifact(tx:PrimaryTransaction,scope:Scope,id:string):Promise&lt;Row&gt;{const result=await tx.query('SELECT &#42;,size_bytes::text,state_version::text,clock_timestamp() AS db_now FROM hyperfide.a…</code> |
| `blockers` | method | 50 | <code>private async blockers(tx:PrimaryTransaction,scope:Scope,row:Row,policy:Policy):Promise&lt;string&#91;&#93;&gt;{</code> |
| `otherReferences` | method | 74 | <code>private async otherReferences(tx:PrimaryTransaction,row:Row):Promise&lt;string&#91;&#93;&gt;{</code> |
| `result` | method | 90 | <code>private result(row:Row):unknown{return {operation:row,current_object_absent:row.state==='ABSENT',cleanup_debt:&#91;'INTENT','REQUESTED','UNKNOWN','FAILED'&#93;.includes(row.state),physical_version_erasure:'NO…</code> |
| `inspect` | method | 91 | <code>private async inspect(input:unknown):Promise&lt;unknown&gt;{const value=fields(input,&#91;'organisation_id','run_id','artifact_id','policy_digest'&#93;),scope=this.scope(value),policy=await this.policy(value.policy…</code> |
| `reference` | method | 92 | <code>private async reference(tx:PrimaryTransaction,scope:Scope,kind:string,id:string):Promise&lt;void&gt;{</code> |
| `hold` | method | 97 | <code>private async hold(input:unknown):Promise&lt;unknown&gt;{</code> |
| `release` | method | 107 | <code>private async release(input:unknown):Promise&lt;unknown&gt;{</code> |
| `changePolicy` | method | 121 | <code>private async changePolicy(input:unknown):Promise&lt;unknown&gt;{</code> |
| `advance` | method | 133 | <code>private async advance(scope:Scope,operation:Row,policy:Policy):Promise&lt;Row&gt;{</code> |
| `execute` | method | 149 | <code>private async execute(scope:Scope,operation:Row,policy:Policy):Promise&lt;unknown&gt;{</code> |
| `collect` | method | 168 | <code>private async collect(input:unknown):Promise&lt;unknown&gt;{</code> |
| `reconcile` | method | 178 | <code>private async reconcile(input:unknown):Promise&lt;unknown&gt;{const value=fields(input,&#91;'organisation_id','run_id','gc_operation_id','policy_digest'&#93;),scope=this.scope(value),policy=await this.policy(value.…</code> |
| `debt` | method | 180 | <code>private async debt(input:unknown):Promise&lt;unknown&gt;{</code> |
| `invoke` | method | 188 | <code>async invoke(action:string,input:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 195 | <code>export function createComponent(_context:ComponentContext):Component{registerArtifactDestructionPreflight(_context);return {apiVersion:1,actions:Object.fromEntries(ACTIONS.map(action=&gt;&#91;action,(input:u…</code> |

## services/hyperfide/src/contracts/records.ts

[Open source](../../services/hyperfide/src/contracts/records.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `UUID` | type | 5 | <code>export type UUID = string;</code> |
| `Digest` | type | 6 | <code>export type Digest = string;</code> |
| `Generation` | type | 7 | <code>export type Generation = string;</code> |
| `Scope` | interface | 8 | <code>export interface Scope { organisation_id: UUID; run_id: UUID }</code> |
| `SourceReference` | interface | 9 | <code>export interface SourceReference extends Scope { repository_id: UUID; source_object_id: string }</code> |
| `ArtifactReference` | interface | 10 | <code>export interface ArtifactReference extends Scope {</code> |
| `ComputeAuthorityToken` | interface | 15 | <code>export interface ComputeAuthorityToken extends Scope {</code> |
| `CustodyAuthorityToken` | interface | 19 | <code>export interface CustodyAuthorityToken extends Scope {</code> |
| `OrganisationRecord` | interface | 22 | <code>export interface OrganisationRecord { id: UUID; name: string }</code> |
| `ProjectRecord` | interface | 23 | <code>export interface ProjectRecord { organisation_id: UUID; id: UUID; name: string }</code> |
| `RepositoryRecord` | interface | 24 | <code>export interface RepositoryRecord extends ProjectRecord {</code> |
| `SpecRevisionRecord` | interface | 27 | <code>export interface SpecRevisionRecord {</code> |
| `RunRecord` | interface | 31 | <code>export interface RunRecord {</code> |
| `TaskRecord` | interface | 36 | <code>export interface TaskRecord extends Scope {</code> |
| `AttemptRecord` | interface | 41 | <code>export interface AttemptRecord extends Scope {</code> |
| `ComputeLeaseRecord` | interface | 47 | <code>export interface ComputeLeaseRecord extends Scope {</code> |
| `SubmissionCustodyRecord` | interface | 51 | <code>export interface SubmissionCustodyRecord extends Scope {</code> |
| `EvidenceRecord` | interface | 57 | <code>export interface EvidenceRecord extends SourceReference {</code> |
| `QualificationJobRecord` | interface | 61 | <code>export interface QualificationJobRecord extends Scope {</code> |
| `PublicationOperationRecord` | interface | 66 | <code>export interface PublicationOperationRecord extends Scope {</code> |
| `AuthorityRecordError` | class | 74 | <code>export class AuthorityRecordError extends Error {</code> |
| `constructor` | method | 76 | <code>constructor(message: string) { super(message); this.name = 'AuthorityRecordError'; }</code> |
| `Validator` | type | 78 | <code>type Validator = (value: unknown, path: string) =&gt; unknown;</code> |
| `recordObject` | function | 79 | <code>export function recordObject(value: unknown, path = 'input'): Record&lt;string, unknown&gt; {</code> |
| `text` | function | 84 | <code>function text(pattern: RegExp, maximum: number): Validator {</code> |
| `bigint` | function | 94 | <code>const bigint = (positive: boolean): Validator =&gt; (value, path) =&gt; {</code> |
| `timestamp` | function | 101 | <code>const timestamp: Validator = (value, path) =&gt; {</code> |
| `enumValue` | function | 109 | <code>const enumValue = (...values: string&#91;&#93;): Validator =&gt; (value, path) =&gt; {</code> |
| `nullable` | function | 114 | <code>const nullable = (validator: Validator): Validator =&gt; (value, path) =&gt; value === null ? null : validator(value, path);</code> |
| `scoped` | object | 115 | <code>const scoped = { organisation_id: uuid, run_id: uuid };</code> |
| `identified` | object | 116 | <code>const identified = { ...scoped, id: uuid };</code> |
| `Definition` | interface | 117 | <code>interface Definition { table: string; fields: Record&lt;string, Validator&gt;; required: string&#91;&#93; }</code> |
| `VALIDATION_RECORDS` | object | 168 | <code>const VALIDATION_RECORDS: Readonly&lt;Record&lt;string, Record&lt;string, Validator&gt;&gt;&gt; = {</code> |
| `parseFields` | function | 180 | <code>function parseFields(value: unknown, fields: Record&lt;string, Validator&gt;, required: string&#91;&#93;): Record&lt;string, unknown&gt; {</code> |
| `parseCreateRecord` | function | 188 | <code>export function parseCreateRecord(kind: unknown, value: unknown): { table: string; record: Record&lt;string, unknown&gt; } {</code> |
| `validateAuthorityRecord` | function | 194 | <code>export function validateAuthorityRecord(kind: unknown, value: unknown): Record&lt;string, unknown&gt; {</code> |
| `operationInput` | function | 200 | <code>export function operationInput(value: unknown): { kind: unknown; record: unknown } {</code> |
| `ProviderPoolRecord` | interface | 208 | <code>export interface ProviderPoolRecord {</code> |
| `ReservationRecord` | interface | 213 | <code>export interface ReservationRecord extends Scope {</code> |
| `SandboxRecord` | interface | 219 | <code>export interface SandboxRecord {</code> |
| `WorkerSlotRecord` | interface | 225 | <code>export interface WorkerSlotRecord {</code> |
| `AgentSessionRecord` | interface | 230 | <code>export interface AgentSessionRecord extends Scope {</code> |
| `GraphBuildRecord` | interface | 236 | <code>export interface GraphBuildRecord extends Scope {</code> |
| `GraphManifestRecord` | interface | 241 | <code>export interface GraphManifestRecord extends Scope {</code> |
| `FindingRecord` | interface | 245 | <code>export interface FindingRecord extends SourceReference {</code> |

## services/hyperfide/src/deployment/releases.ts

[Open source](../../services/hyperfide/src/deployment/releases.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SERVICE_UNITS` | object | 14 | <code>const SERVICE_UNITS:Readonly&lt;Record&lt;string,{status:'INSTALLABLE'}&#124;{status:'UNQUALIFIED';owner_task:string}&gt;&gt;={</code> |
| `fail` | function | 17 | <code>function fail(message:string):never{throw new FoundationError('RELEASE_INVALID',message);}</code> |
| `exact` | function | 18 | <code>function exact(v:unknown,keys:string&#91;&#93;):Record&lt;string,unknown&gt;{if(!object(v)&#124;&#124;Object.keys(v).some(k=&gt;!keys.includes(k))&#124;&#124;keys.some(k=&gt;!(k in v)))fail('Unexpected release fields');return v;}</code> |
| `version` | function | 19 | <code>function version(v:unknown):number{if(!Number.isSafeInteger(v)&#124;&#124;Number(v)&lt;1)fail('Positive protocol version required');return Number(v);}</code> |
| `file` | function | 20 | <code>async function file(root:string,relative:unknown):Promise&lt;string&gt;{</code> |
| `checksum` | function | 25 | <code>async function checksum(name:string):Promise&lt;string&gt;{const h=createHash('sha256');for await(const chunk of createReadStream(name))h.update(chunk);return 'sha256:'+h.digest('hex');}</code> |
| `compatibility` | function | 26 | <code>function compatibility(raw:unknown):unknown{</code> |
| `execute` | function | 37 | <code>async function execute(ctx:ComponentContext,action:typeof actions&#91;number&#93;,raw:unknown):Promise&lt;unknown&gt;{</code> |
| `trustedDetached` | function | 48 | <code>async function trustedDetached(filename:string,limit:number):Promise&lt;Buffer&gt;{</code> |
| `authenticateManifest` | function | 76 | <code>async function authenticateManifest(env:Readonly&lt;NodeJS.ProcessEnv&gt;,root:string,bytes:Buffer):Promise&lt;{mode:'UNAUTHENTICATED'}&#124;{mode:'ED25519';key_fingerprint:string;signature_digest:string}&gt;{</code> |
| `inspectPrebuiltRelease` | function | 92 | <code>export async function inspectPrebuiltRelease(env:Readonly&lt;NodeJS.ProcessEnv&gt;,relativeManifest:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 140 | <code>export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,actions:Object.fromEntries(actions.map(action=&gt;&#91;action,async(raw:unknown,ctx:ComponentContext)=&gt;{</code> |

## services/hyperfide/src/migration/cutover.ts

[Open source](../../services/hyperfide/src/migration/cutover.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Scope` | interface | 11 | <code>interface Scope {organisation_id:string;run_id:string;authority_epoch:string}</code> |
| `RecoveryControls` | interface | 12 | <code>interface RecoveryControls {</code> |
| `assertQuiesced` | method | 13 | <code>assertQuiesced(tx:IdentityTransaction,scope:Scope):Promise&lt;void&gt;;</code> |
| `assertNoNewEffects` | method | 14 | <code>assertNoNewEffects(tx:IdentityTransaction,scope:Scope):Promise&lt;void&gt;;</code> |
| `HierarchyAuthority` | interface | 16 | <code>interface HierarchyAuthority {</code> |
| `leadership` | method | 17 | <code>leadership(tx:IdentityTransaction,input:{organisation_id:string;run_id:string}):Promise&lt;{leader_session_id:string;leader_generation:string;authority_epoch:string}&gt;;</code> |
| `requireAuthority` | method | 18 | <code>requireAuthority(tx:IdentityTransaction,input:{organisation_id:string;run_id:string;authority_epoch:string;session_id:string;leader_generation:string;roles:string&#91;&#93;}):Promise&lt;unknown&gt;;</code> |
| `Fingerprint` | type | 20 | <code>type Fingerprint=Record&lt;string,{rows:string;digest:string}&gt;;</code> |
| `guarded` | function | 21 | <code>async function guarded&lt;T&gt;(ctx:ComponentContext,action:string,fn:(tx:IdentityTransaction)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `fields` | object | 39 | <code>const fields:Record&lt;string,string&#91;&#93;&gt;={</code> |
| `fail` | function | 52 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `controls` | function | 53 | <code>function controls(ctx:ComponentContext):RecoveryControls {</code> |
| `legacy` | function | 57 | <code>function legacy(ctx:ComponentContext):LegacyWriterCapability {</code> |
| `ready` | function | 61 | <code>async function ready(tx:IdentityTransaction):Promise&lt;void&gt;{</code> |
| `input` | function | 68 | <code>function input(action:string,raw:unknown):Record&lt;string,unknown&gt;{</code> |
| `fingerprint` | function | 81 | <code>async function fingerprint(tx:IdentityTransaction,scope:Scope):Promise&lt;Fingerprint&gt;{</code> |
| `changes` | function | 92 | <code>function changes(baseline:Fingerprint,observed:Fingerprint,prefix:string):bigint{</code> |
| `legacyInput` | function | 102 | <code>function legacyInput(ctx:ComponentContext,operation:string,epoch:unknown,signal:AbortSignal):LegacyWriterInput{</code> |
| `createComponent` | function | 112 | <code>export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,actions:Object.fromEntries(names.map(action=&gt;&#91;action,async(raw:unknown,ctx:ComponentContext)=&gt;{</code> |

## services/hyperfide/src/migration/generated.ts

[Open source](../../services/hyperfide/src/migration/generated.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fail` | function | 12 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `owned` | function | 13 | <code>function owned(file:string,bytes:Buffer):boolean{</code> |
| `inventory` | function | 19 | <code>async function inventory(root:FileHandle):Promise&lt;unknown&#91;&#93;&gt;{</code> |
| `execute` | function | 27 | <code>async function execute(binary:FileHandle,root:FileHandle,args:readonly string&#91;&#93;,context:ComponentContext):Promise&lt;{exit_code:number;stdout:Buffer;stderr:Buffer}&gt;{</code> |
| `executable` | function | 46 | <code>async function executable(context:ComponentContext):Promise&lt;FileHandle&gt;{</code> |
| `createComponent` | function | 57 | <code>export function createComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/migration/legacy.ts

[Open source](../../services/hyperfide/src/migration/legacy.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `canonical` | function | 6 | <code>function canonical(value:unknown):string {if(Array.isArray(value))return '&#91;'+value.map(canonical).join(',')+'&#93;';if(object(value))return '{'+Object.keys(value).sort().map(k=&gt;JSON.stringify(k)+':'+canon…</code> |
| `hash` | function | 7 | <code>function hash(value:string&#124;Buffer):string{return 'sha256:'+createHash('sha256').update(value).digest('hex');}</code> |
| `LegacyWriterInput` | interface | 9 | <code>export interface LegacyWriterInput {deployment_id:string;operation_id:string;source_epoch:string&#124;null;signal?:AbortSignal}</code> |
| `LegacyAdmissionReceipt` | interface | 10 | <code>export interface LegacyAdmissionReceipt {deployment_id:string;operation_id:string;source_epoch:string&#124;null;status:'ADMISSION_DISABLED';topology_digest:string;observed_at:string;evidence_digest:string;…</code> |
| `LegacyIsolationReceipt` | interface | 11 | <code>export interface LegacyIsolationReceipt {deployment_id:string;operation_id:string;source_epoch:string&#124;null;status:'ISOLATED';topology_digest:string;isolated_writer:string;observed_at:string;expires_at…</code> |
| `LegacyRestoreReceipt` | interface | 12 | <code>export interface LegacyRestoreReceipt {deployment_id:string;operation_id:string;source_epoch:string&#124;null;status:'ADMISSION_RESTORED';topology_digest:string;restored_descriptor_digest:string;observed_a…</code> |
| `LegacyWriterCapability` | interface | 13 | <code>export interface LegacyWriterCapability {disableAdmission(input:LegacyWriterInput):Promise&lt;LegacyAdmissionReceipt&gt;;observeIsolation(input:LegacyWriterInput):Promise&lt;LegacyIsolationReceipt&gt;;restoreAdmi…</code> |
| `disableAdmission` | method | 13 | <code>export interface LegacyWriterCapability {disableAdmission(input:LegacyWriterInput):Promise&lt;LegacyAdmissionReceipt&gt;;observeIsolation(input:LegacyWriterInput):Promise&lt;LegacyIsolationReceipt&gt;;restoreAdmi…</code> |
| `observeIsolation` | method | 13 | <code>export interface LegacyWriterCapability {disableAdmission(input:LegacyWriterInput):Promise&lt;LegacyAdmissionReceipt&gt;;observeIsolation(input:LegacyWriterInput):Promise&lt;LegacyIsolationReceipt&gt;;restoreAdmi…</code> |
| `restoreAdmission` | method | 13 | <code>export interface LegacyWriterCapability {disableAdmission(input:LegacyWriterInput):Promise&lt;LegacyAdmissionReceipt&gt;;observeIsolation(input:LegacyWriterInput):Promise&lt;LegacyIsolationReceipt&gt;;restoreAdmi…</code> |
| `Config` | interface | 14 | <code>interface Config {schema_version:1;deployment_id:string;source_epoch:string&#124;null;workspace_root:string;data_roots:string&#91;&#93;;legacy_writer_id:string;expected_pid_namespace:string;expected_mount_namespac…</code> |
| `Mount` | interface | 15 | <code>interface Mount {id:string;device:string;root:string;point:string;readonly:boolean;filesystem:string}</code> |
| `Target` | interface | 16 | <code>interface Target {device:string;root:string;directory:string}</code> |
| `fail` | function | 18 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `alive` | function | 19 | <code>function alive(input:LegacyWriterInput):void{if(input.signal?.aborted)fail('LEGACY_FENCE_ABORTED','Legacy writer observation was cancelled');}</code> |
| `inside` | function | 20 | <code>function inside(root:string,name:string):boolean{return name===root&#124;&#124;name.startsWith(root.endsWith('/')?root:root+'/');}</code> |
| `decode` | function | 21 | <code>function decode(s:string):string{return s.replace(/&#92;&#92;(&#91;0-7&#93;{3})/g,(_m,n:string)=&gt;String.fromCharCode(parseInt(n,8)));}</code> |
| `mounts` | function | 22 | <code>function mounts(text:string):Mount&#91;&#93;{</code> |
| `covering` | function | 29 | <code>function covering(all:Mount&#91;&#93;,name:string):Mount{</code> |
| `device` | function | 33 | <code>function device(value:bigint):string{</code> |
| `exactDirectory` | function | 37 | <code>async function exactDirectory(name:string):Promise&lt;void&gt;{</code> |
| `configuration` | function | 41 | <code>async function configuration(env:Readonly&lt;NodeJS.ProcessEnv&gt;,input:LegacyWriterInput):Promise&lt;{config:Config;topology:string;roots:string&#91;&#93;}&gt;{</code> |
| `namespaces` | function | 59 | <code>async function namespaces(config:Config):Promise&lt;{scope:'CONFIGURED_PID_NAMESPACE';pid_namespace:string;mount_namespace:string}&gt;{</code> |
| `descriptor` | function | 66 | <code>function descriptor(config:Config,input:LegacyWriterInput):string{return canonical({schema_version:1,mode:'distributed',authority_epoch:config.source_epoch??input.operation_id})+'&#92;n';}</code> |
| `admission` | function | 67 | <code>async function admission(config:Config,input:LegacyWriterInput):Promise&lt;string&gt;{</code> |
| `aliases` | function | 74 | <code>function aliases(all:Mount&#91;&#93;,targets:Target&#91;&#93;):string&#91;&#93;{</code> |
| `identities` | function | 83 | <code>async function identities(roots:string&#91;&#93;):Promise&lt;Set&lt;string&gt;&gt;{</code> |
| `pids` | function | 95 | <code>async function pids():Promise&lt;string&#91;&#93;&gt;{</code> |
| `gone` | function | 99 | <code>async function gone(pid:string):Promise&lt;boolean&gt;{try{await fs.stat('/proc/'+pid);return false;}catch(e){if(object(e)&amp;&amp;e.code==='ENOENT')return true;throw e;}}</code> |
| `LegacyWriterAdmission` | class | 103 | <code>export class LegacyWriterAdmission {</code> |
| `constructor` | method | 104 | <code>constructor(private readonly env:Readonly&lt;NodeJS.ProcessEnv&gt;){}</code> |
| `disableAdmission` | method | 105 | <code>async disableAdmission(input:LegacyWriterInput):Promise&lt;LegacyAdmissionReceipt&gt;{</code> |
| `restoreAdmission` | method | 126 | <code>async restoreAdmission(input:LegacyWriterInput):Promise&lt;LegacyRestoreReceipt&gt;{</code> |
| `binding` | method | 141 | <code>private binding(input:LegacyWriterInput){return {deployment_id:input.deployment_id,operation_id:input.operation_id,source_epoch:input.source_epoch};}</code> |
| `observeIsolation` | method | 142 | <code>async observeIsolation(input:LegacyWriterInput):Promise&lt;LegacyIsolationReceipt&gt;{</code> |
| `createLegacyWriterAdmission` | function | 196 | <code>export function createLegacyWriterAdmission(env:Readonly&lt;NodeJS.ProcessEnv&gt;):LegacyWriterAdmission{return new LegacyWriterAdmission(env);}</code> |
| `createLegacyComponent` | function | 198 | <code>export function createLegacyComponent(ctx:ComponentContext):Component {</code> |

## services/hyperfide/src/migration/names.ts

[Open source](../../services/hyperfide/src/migration/names.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Item` | type | 9 | <code>type Item={from:string;to:string;digest:string;size:number;mode:number};</code> |
| `NamesManifest` | interface | 10 | <code>export interface NamesManifest {</code> |
| `fail` | function | 279 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `strictObject` | function | 280 | <code>export function strictObject(value:unknown,keys:string&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `relativePath` | function | 286 | <code>export function relativePath(value:unknown,empty=false):string{</code> |
| `resolveEnvironmentAliases` | function | 292 | <code>export function resolveEnvironmentAliases(env:Readonly&lt;NodeJS.ProcessEnv&gt;):NodeJS.ProcessEnv{</code> |
| `contentDigest` | function | 301 | <code>export const contentDigest=(data:Uint8Array&#124;string):string=&gt;'sha256:'+createHash('sha256').update(data).digest('hex');</code> |
| `canonical` | function | 302 | <code>function canonical(value:unknown):string{</code> |
| `openDirectory` | function | 307 | <code>export async function openDirectory(root:FileHandle,relative:string,create=false):Promise&lt;FileHandle&gt;{</code> |
| `openWorkspace` | function | 320 | <code>export async function openWorkspace(context:ComponentContext,relative:unknown):Promise&lt;FileHandle&gt;{</code> |
| `readContained` | function | 326 | <code>export async function readContained(root:FileHandle,relative:string):Promise&lt;{bytes:Buffer;mode:number}&#124;null&gt;{</code> |
| `writeAtomic` | function | 345 | <code>async function writeAtomic(root:FileHandle,relative:string,bytes:Uint8Array,mode=0o600,exclusive=false):Promise&lt;void&gt;{</code> |
| `removeContained` | function | 357 | <code>async function removeContained(root:FileHandle,relative:string):Promise&lt;void&gt;{</code> |
| `json` | function | 362 | <code>async function json(root:FileHandle,relative:string):Promise&lt;unknown&#124;null&gt;{</code> |
| `writeJSON` | function | 366 | <code>async function writeJSON(root:FileHandle,relative:string,value:unknown):Promise&lt;void&gt;{</code> |
| `locked` | function | 369 | <code>async function locked&lt;T&gt;(root:FileHandle,operation:()=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `manifest` | function | 387 | <code>function manifest(value:unknown):NamesManifest{</code> |
| `plan` | function | 410 | <code>async function plan(root:FileHandle,id:unknown):Promise&lt;NamesManifest&gt;{</code> |
| `apply` | function | 431 | <code>async function apply(root:FileHandle,m:NamesManifest,signal:AbortSignal):Promise&lt;unknown&gt;{</code> |
| `quarantineContained` | function | 459 | <code>async function quarantineContained(root:FileHandle,relative:string,targetRelative:string):Promise&lt;void&gt;{</code> |
| `rollback` | function | 472 | <code>async function rollback(root:FileHandle,m:NamesManifest):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 514 | <code>export function createComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/migration/parity.ts

[Open source](../../services/hyperfide/src/migration/parity.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Json` | type | 8 | <code>type Json=Record&lt;string,unknown&gt;;</code> |
| `ParityReader` | interface | 10 | <code>export interface ParityReader {query(sql:string,values?:unknown&#91;&#93;):Promise&lt;{rows:Record&lt;string,any&gt;&#91;&#93;}&gt;}</code> |
| `query` | method | 10 | <code>export interface ParityReader {query(sql:string,values?:unknown&#91;&#93;):Promise&lt;{rows:Record&lt;string,any&gt;&#91;&#93;}&gt;}</code> |
| `Table` | interface | 11 | <code>interface Table {name:string;rows:string&#124;null;disposition:string}</code> |
| `Scope` | interface | 12 | <code>interface Scope {organisation_id:string;run_id:string}</code> |
| `ParityReport` | interface | 13 | <code>export interface ParityReport {</code> |
| `fail` | function | 20 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `offsets` | function | 22 | <code>function offsets(snapshot:string,table:string,rows:bigint):bigint&#91;&#93;{</code> |
| `sample` | function | 27 | <code>function sample(db:ReturnType&lt;typeof open&gt;,table:string,offset:bigint,source:string,repository:string):LogicalRow&#124;null{</code> |
| `historyDigest` | function | 31 | <code>export async function historyDigest(tx:ParityReader,importId:string):Promise&lt;string&gt;{</code> |
| `compareParity` | function | 38 | <code>export async function compareParity(tx:ParityReader,ctx:ComponentContext,i:InvocationContext,scope:Scope,importId:string):Promise&lt;ParityReport&gt;{</code> |
| `shadowCompare` | function | 107 | <code>export async function shadowCompare(ctx:ComponentContext,i:InvocationContext,scope:Scope,importId:string):Promise&lt;ParityReport&gt;{</code> |

## services/hyperfide/src/migration/sqlite.ts

[Open source](../../services/hyperfide/src/migration/sqlite.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Json` | type | 14 | <code>type Json=Record&lt;string,unknown&gt;;</code> |
| `Profile` | interface | 15 | <code>export interface Profile {id:string;source_id:string;repository_id:string;organisation_id:string;root:string;database:string;external?:{label:string;path:string;kind:string;sensitive?:boolean}&#91;&#93;;kvx?:…</code> |
| `known` | variable | 18 | <code>const known=new Set(&#91;'meta','branches','files','symbols','refs','routes','memories','memory_superseded','git_commits','git_churn','leases','attempts','agents','runtime_events','events','fleet_runs','f…</code> |
| `live` | variable | 19 | <code>const live=new Set(&#91;'leases','attempts','agents','fleet_runs','fleet_nodes','fleet_approvals'&#93;);</code> |
| `kinds` | variable | 20 | <code>const kinds=new Set(&#91;'configuration','journal','memory','attempt','event','graph','documentation','snapshot','native_session'&#93;);</code> |
| `fail` | function | 21 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `hash` | function | 22 | <code>export function hash(bytes:string&#124;Buffer):string{return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}</code> |
| `canonical` | function | 23 | <code>export function canonical(value:unknown):string{</code> |
| `mappedId` | function | 28 | <code>export function mappedId(source:string,repository:string,table:string,key:unknown):string{</code> |
| `input` | function | 32 | <code>function input(value:unknown,required:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):Json{</code> |
| `id` | function | 36 | <code>function id(value:unknown):string{if(typeof value!=='string'&#124;&#124;!uuid.test(value))fail('MIGRATION_INPUT','Canonical UUID required');return value;}</code> |
| `hex` | function | 37 | <code>function hex(value:unknown):string{if(typeof value!=='string'&#124;&#124;!digestPattern.test(value))fail('MIGRATION_INPUT','SHA256 digest required');return value;}</code> |
| `fileHash` | function | 38 | <code>export async function fileHash(filename:string):Promise&lt;string&gt;{const h=createHash('sha256');for await(const chunk of createReadStream(filename))h.update(chunk);return 'sha256:'+h.digest('hex');}</code> |
| `quote` | function | 39 | <code>function quote(name:string):string{return '"'+name.replaceAll('"','""')+'"';}</code> |
| `regular` | function | 40 | <code>export async function regular(root:string,relative:string):Promise&lt;string&gt;{</code> |
| `profiles` | function | 48 | <code>export async function profiles(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;Profile&#91;&#93;&gt;{</code> |
| `profile` | function | 65 | <code>async function profile(env:Readonly&lt;NodeJS.ProcessEnv&gt;,name:unknown):Promise&lt;Profile&gt;{</code> |
| `archiveRoot` | function | 68 | <code>export async function archiveRoot(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;string&gt;{</code> |
| `open` | function | 73 | <code>export function open(filename:string):DatabaseSync{</code> |
| `rows` | function | 77 | <code>function rows(db:DatabaseSync,sql:string):Record&lt;string,unknown&gt;&#91;&#93; {const q=db.prepare(sql);q.setReadBigInts(true);return q.all() as Record&lt;string,unknown&gt;&#91;&#93;;}</code> |
| `plain` | function | 78 | <code>function plain(value:unknown):unknown{</code> |
| `inventory` | function | 84 | <code>export function inventory(db:DatabaseSync):Json{</code> |
| `externalInventory` | function | 111 | <code>async function externalInventory(p:Profile):Promise&lt;unknown&#91;&#93;&gt;{</code> |
| `kvxInventory` | function | 131 | <code>async function kvxInventory(p:Profile):Promise&lt;unknown&#91;&#93;&gt;{</code> |
| `ready` | function | 162 | <code>async function ready(pool:IdentityTransaction):Promise&lt;void&gt;{</code> |
| `snapshot` | function | 170 | <code>async function snapshot(p:Profile,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `load` | function | 193 | <code>async function load(p:Profile,importId:string,ctx:ComponentContext):Promise&lt;Json&gt;{</code> |
| `cell` | function | 201 | <code>function cell(value:unknown):unknown {</code> |
| `LogicalRow` | interface | 209 | <code>export interface LogicalRow {key:unknown;data:unknown;mapped:string;digest:string;disposition:string}</code> |
| `logicalBatch` | function | 212 | <code>export function logicalBatch(db:DatabaseSync,table:string,offset:string,limit:number,source:string,repository:string):{rows:LogicalRow&#91;&#93;;total:bigint}{</code> |
| `importBatch` | function | 264 | <code>async function importBatch(p:Profile,value:Json,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `verifiedArtifact` | function | 292 | <code>function verifiedArtifact(raw:unknown,expectedDigest?:string,expectedSize?:string):Record&lt;string,unknown&gt;&#124;null {</code> |
| `preserve` | function | 298 | <code>async function preserve(p:Profile,importId:string,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `scoped` | function | 335 | <code>async function scoped(tx:IdentityTransaction,p:Profile,ctx:ComponentContext):Promise&lt;void&gt;{</code> |
| `createComponent` | function | 341 | <code>export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,capabilities:{'migration.legacy-writers.v1':createLegacyWriterAdmission(_startup.env)},actions:Object.fromEntr…</code> |

## services/hyperfide/src/migration/workflow.ts

[Open source](../../services/hyperfide/src/migration/workflow.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Data` | type | 8 | <code>type Data=Record&lt;string,unknown&gt;;</code> |
| `budget` | function | 10 | <code>function budget(value:unknown):number {</code> |
| `bounded` | function | 15 | <code>function bounded&lt;T&gt;(value:T,max:number):T {</code> |
| `field` | function | 19 | <code>function field(definition:unknown,name:string,structured=true):unknown {</code> |
| `objectiveLabel` | function | 27 | <code>function objectiveLabel(definition:unknown,fallback:string):string {</code> |
| `revision` | function | 31 | <code>async function revision(tx:PrimaryTransaction,a:TrustedActor,key:string):Promise&lt;Data&gt; {</code> |
| `task` | function | 38 | <code>async function task(tx:PrimaryTransaction,a:TrustedActor,reference:string,leader:string,owner:string):Promise&lt;Data&gt; {</code> |
| `capture` | function | 48 | <code>async function capture(tx:PrimaryTransaction,a:TrustedActor,t:Data):Promise&lt;Data&gt; {</code> |
| `save` | function | 54 | <code>async function save(tx:PrimaryTransaction,a:TrustedActor,snapshot:Data):Promise&lt;string&gt; {</code> |
| `provenance` | function | 61 | <code>async function provenance(tx:PrimaryTransaction){</code> |
| `omitted` | function | 65 | <code>function omitted(){return {workspace_delta:{available:false,reason:'REMOTE_WORKSPACE_ATTESTATION_REQUIRED'},focused_graph:{available:false,reason:'EXACT_GRAPH_MANIFEST_REQUIRED'},memories:{available:f…</code> |
| `Handoff` | interface | 66 | <code>interface Handoff {propose:Action;acknowledge:Action}</code> |
| `isHandoff` | function | 67 | <code>function isHandoff(value:unknown):value is Handoff{return object(value)&amp;&amp;typeof value.propose==='function'&amp;&amp;typeof value.acknowledge==='function';}</code> |
| `createComponent` | function | 70 | <code>export function createComponent(context:ComponentContext):Component {</code> |

## services/hyperfide/src/release/readiness.ts

[Open source](../../services/hyperfide/src/release/readiness.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `VerifiedReleaseEvidence` | interface | 12 | <code>export interface VerifiedReleaseEvidence{</code> |
| `ReleaseInventory` | interface | 17 | <code>export interface ReleaseInventory{</code> |
| `exact` | function | 24 | <code>function exact(a:string&#91;&#93;,b:string&#91;&#93;):boolean{return canonical(&#91;...a&#93;.sort())===canonical(&#91;...b&#93;.sort());}</code> |
| `values` | function | 25 | <code>function values(v:unknown,min=0,max=100000):unknown&#91;&#93;{if(!Array.isArray(v)&#124;&#124;v.length&lt;min&#124;&#124;v.length&gt;max)invalid('Invalid release inventory list');return v;}</code> |
| `parse` | function | 26 | <code>function parse(value:unknown):ReleaseInventory{</code> |
| `validateReadinessInventory` | function | 37 | <code>export function validateReadinessInventory(contract:ReleaseContract,value:unknown,evidence:ReadonlyMap&lt;string,VerifiedReleaseEvidence&gt;):RecordValue{</code> |
| `CampaignReference` | interface | 88 | <code>interface CampaignReference{reference:string;evidence_root:string;campaign:string;receipt_id:string;receipt_digest:string;gate_kinds:string&#91;&#93;}</code> |
| `protectedReleaseFile` | function | 89 | <code>async function protectedReleaseFile(filename:string,maximum:number):Promise&lt;Buffer&gt;{</code> |
| `checkReleaseCampaign` | function | 130 | <code>export async function checkReleaseCampaign(evidenceRoot:string,campaign:string,receipt:string,context:Pick&lt;ComponentContext,'env'&#124;'signal'&gt;):Promise&lt;RecordValue&gt;{</code> |
| `loadReleaseAdmissionIndex` | function | 146 | <code>export async function loadReleaseAdmissionIndex(context:Pick&lt;ComponentContext,'env'&gt;,scope:{organisation_id:string;run_id:string}):Promise&lt;CampaignReference&#91;&#93;&gt;{</code> |
| `trustedEvidence` | function | 156 | <code>async function trustedEvidence(context:ComponentContext,scope:{organisation_id:string;run_id:string},references:string&#91;&#93;):Promise&lt;Map&lt;string,VerifiedReleaseEvidence&gt;&gt;{</code> |
| `assessReleaseReadiness` | function | 183 | <code>export async function assessReleaseReadiness(input:unknown,context:ComponentContext):Promise&lt;RecordValue&gt;{</code> |
| `sealReleaseReadiness` | function | 202 | <code>export async function sealReleaseReadiness(input:unknown,context:ComponentContext):Promise&lt;RecordValue&gt;{</code> |
| `createComponent` | function | 240 | <code>export function createComponent(_context:ComponentContext):Component{</code> |
| `pinnedCampaignManifest` | function | 244 | <code>export function pinnedCampaignManifest(receipt:unknown,bytes:Uint8Array):RecordValue{</code> |

## services/hyperfide/src/release/traceability.ts

[Open source](../../services/hyperfide/src/release/traceability.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ReleaseTask` | interface | 8 | <code>export interface ReleaseTask{id:string;reqs:string&#91;&#93;;acceptance_ids:string&#91;&#93;;requires:string&#91;&#93;;wave:number}</code> |
| `ClauseMapping` | interface | 9 | <code>export interface ClauseMapping{id:string;task_ids:string&#91;&#93;;acceptance_ids:string&#91;&#93;;chapters:string&#91;&#93;}</code> |
| `SourcePin` | interface | 10 | <code>export interface SourcePin{path:string;sha256:string;size:number}</code> |
| `ReviewStates` | interface | 12 | <code>export interface ReviewStates{</code> |
| `ReleaseContract` | interface | 17 | <code>export interface ReleaseContract{</code> |
| `privatePath` | function | 22 | <code>function privatePath(relative:string):boolean{return relative.split('/').some(p=&gt;p==='private'&#124;&#124;p==='..'&#124;&#124;p==='.'&#124;&#124;p==='')&#124;&#124;relative.includes('&#92;&#92;');}</code> |
| `exact` | function | 23 | <code>function exact(a:string&#91;&#93;,b:string&#91;&#93;):boolean{return a.length===b.length&amp;&amp;&#91;...a&#93;.sort().every((v,i)=&gt;v===&#91;...b&#93;.sort()&#91;i&#93;);}</code> |
| `unique` | function | 24 | <code>function unique(values:string&#91;&#93;,label:string):void{if(new Set(values).size!==values.length)invalid('Duplicate '+label);}</code> |
| `array` | function | 25 | <code>function array(value:unknown,min=0,max=100000):unknown&#91;&#93;{if(!Array.isArray(value)&#124;&#124;value.length&lt;min&#124;&#124;value.length&gt;max)invalid('Invalid contract list');return value;}</code> |
| `task` | function | 26 | <code>function task(value:unknown):ReleaseTask{</code> |
| `record` | function | 32 | <code>function record(value:unknown,label:string):Record&lt;string,unknown&gt;{if(!object(value))invalid('Invalid '+label);return value;}</code> |
| `textRecord` | function | 33 | <code>function textRecord(value:unknown,label:string):Record&lt;string,string&gt;{const r=record(value,label),out:Record&lt;string,string&gt;={};for(const&#91;k,v&#93;of Object.entries(r))out&#91;boundedText(k)&#93;=boundedText(v,1024…</code> |
| `falseFlag` | function | 34 | <code>function falseFlag(value:unknown,label:string):false{if(value!==false)invalid(label+' must not grant authority');return false;}</code> |
| `reviewStates` | function | 35 | <code>function reviewStates(value:unknown):ReviewStates{</code> |
| `sourcePin` | function | 46 | <code>function sourcePin(value:unknown):SourcePin{</code> |
| `parseReleasePack` | function | 52 | <code>export function parseReleasePack(value:unknown):ReleaseContract{</code> |
| `mapping` | function | 61 | <code>function mapping(value:unknown):ClauseMapping{</code> |
| `validateTraceability` | function | 65 | <code>export function validateTraceability(contract:ReleaseContract,mappings:ClauseMapping&#91;&#93;=contract.mappings):RecordValue{</code> |
| `PackSource` | interface | 114 | <code>export interface PackSource{root:string;origin:'IMPLEMENTED_REVISION'&#124;'CONTROLLED'}</code> |
| `packSource` | function | 116 | <code>export function packSource(env:NodeJS.ProcessEnv=process.env):PackSource{</code> |
| `publicFile` | function | 121 | <code>async function publicFile(relative:string,root:string):Promise&lt;Buffer&gt;{</code> |
| `LoadedContract` | type | 127 | <code>type LoadedContract={contract:ReleaseContract;records:{path:string;sha256:string;size:number;content_base64:string}&#91;&#93;};</code> |
| `loadReleaseContract` | function | 128 | <code>export async function loadReleaseContract(source:PackSource=packSource()):Promise&lt;LoadedContract&gt;{</code> |
| `snapshotReleaseContract` | function | 132 | <code>export async function snapshotReleaseContract(source:PackSource=packSource()):Promise&lt;LoadedContract&gt;{</code> |
| `traceabilityReceipt` | function | 174 | <code>export async function traceabilityReceipt(input:unknown):Promise&lt;RecordValue&gt;{</code> |
| `archiveTraceability` | function | 182 | <code>export async function archiveTraceability(input:unknown,context:ComponentContext):Promise&lt;RecordValue&gt;{</code> |
| `checkReleasePack` | function | 194 | <code>export async function checkReleasePack(input:unknown):Promise&lt;RecordValue&gt;{</code> |
| `createComponent` | function | 203 | <code>export function createComponent(_context:ComponentContext):Component{</code> |

## services/hyperfide/src/storage/authority_journal.ts

[Open source](../../services/hyperfide/src/storage/authority_journal.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ExternalAuthorityAttestation` | interface | 8 | <code>export interface ExternalAuthorityAttestation {</code> |
| `AuthorityJournalPreparation` | interface | 11 | <code>export interface AuthorityJournalPreparation {</code> |
| `AuthorityJournalPublication` | interface | 14 | <code>export interface AuthorityJournalPublication {</code> |
| `CommittedAuthorityEvidence` | interface | 17 | <code>export interface CommittedAuthorityEvidence {</code> |
| `VerifyCommittedAuthority` | type | 20 | <code>export type VerifyCommittedAuthority=(input:AuthorityJournalPublication)=&gt;Promise&lt;CommittedAuthorityEvidence&gt;;</code> |
| `PreparedAuthorityActivation` | interface | 21 | <code>export interface PreparedAuthorityActivation {deployment_id:string;operation_id:string;expected_previous_epoch:string&#124;null;expected_database_epoch:string&#124;null;epoch:string;sequence:string;replayed:boo…</code> |
| `ExternalAuthorityJournal` | interface | 22 | <code>export interface ExternalAuthorityJournal {</code> |
| `current` | method | 23 | <code>current(input:{deployment_id:string;signal?:AbortSignal}):Promise&lt;ExternalAuthorityAttestation&gt;;</code> |
| `prepareActivation` | method | 24 | <code>prepareActivation(input:AuthorityJournalPreparation):Promise&lt;PreparedAuthorityActivation&gt;;</code> |
| `publishCommitted` | method | 25 | <code>publishCommitted(input:AuthorityJournalPublication):Promise&lt;ExternalAuthorityAttestation&gt;;</code> |
| `ActivationRecord` | interface | 27 | <code>interface ActivationRecord {operation_id:string;previous_epoch:string&#124;null;database_predecessor_epoch:string&#124;null;epoch:string;sequence:string;fence_evidence_digest:string;commit_evidence_digest:strin…</code> |
| `Document` | interface | 28 | <code>interface Document {</code> |
| `ProcessIdentity` | interface | 33 | <code>interface ProcessIdentity {hostname:string;machine_id:string;boot_id:string;pid_namespace:string;mount_namespace:string;pid:number;start_time:string}</code> |
| `fail` | function | 35 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message)}</code> |
| `canonical` | function | 36 | <code>function canonical(value:unknown):string{if(value===null&#124;&#124;typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '&#91;'+value.map(canonical).join(',')+'&#93;';return '{'+Object.k…</code> |
| `hash` | function | 37 | <code>function hash(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex')}</code> |
| `uuid` | function | 38 | <code>function uuid(v:unknown):v is string{return typeof v==='string'&amp;&amp;/^&#91;0-9a-f&#93;{8}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{12}$/.test(v)}</code> |
| `digest` | function | 39 | <code>function digest(v:unknown):v is string{return typeof v==='string'&amp;&amp;/^sha256:&#91;0-9a-f&#93;{64}$/.test(v)}</code> |
| `decimal` | function | 40 | <code>function decimal(v:unknown):v is string{return typeof v==='string'&amp;&amp;/^(0&#124;&#91;1-9&#93;&#91;0-9&#93;&#42;)$/.test(v)&amp;&amp;BigInt(v)&lt;=9223372036854775807n}</code> |
| `identity` | function | 41 | <code>function identity(input:{deployment_id:string;operation_id?:string;expected_previous_epoch?:string&#124;null;signal?:AbortSignal}):void{</code> |
| `processStart` | function | 45 | <code>async function processStart(pid:number):Promise&lt;string&#124;null&gt;{</code> |
| `selfIdentity` | function | 49 | <code>async function selfIdentity():Promise&lt;ProcessIdentity&gt;{</code> |
| `documentDigest` | function | 54 | <code>function documentDigest(document:Document):string{const {document_digest:_,...body}=document;return hash(body)}</code> |
| `validate` | function | 55 | <code>function validate(document:Document,deployment:string):void{</code> |
| `FileExternalAuthorityJournal` | class | 73 | <code>export class FileExternalAuthorityJournal implements ExternalAuthorityJournal {</code> |
| `constructor` | method | 74 | <code>constructor(private readonly directory:string,private readonly verifyCommitted:VerifyCommittedAuthority){</code> |
| `root` | method | 77 | <code>private async root():Promise&lt;fs.FileHandle&gt;{</code> |
| `read` | method | 85 | <code>private async read(root:fs.FileHandle,deployment:string):Promise&lt;Document&#124;null&gt;{</code> |
| `write` | method | 94 | <code>private async write(root:fs.FileHandle,document:Document):Promise&lt;void&gt;{</code> |
| `lock` | method | 102 | <code>private async lock&lt;T&gt;(root:fs.FileHandle,deployment:string,body:()=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `attestation` | method | 130 | <code>private attestation(document:Document):ExternalAuthorityAttestation{</code> |
| `current` | method | 135 | <code>async current(input:{deployment_id:string;signal?:AbortSignal}):Promise&lt;ExternalAuthorityAttestation&gt;{</code> |
| `prepareActivation` | method | 139 | <code>async prepareActivation(input:AuthorityJournalPreparation):Promise&lt;PreparedAuthorityActivation&gt;{</code> |
| `publishCommitted` | method | 163 | <code>async publishCommitted(input:AuthorityJournalPublication):Promise&lt;ExternalAuthorityAttestation&gt;{</code> |

## services/hyperfide/src/storage/dispositions.ts

[Open source](../../services/hyperfide/src/storage/dispositions.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SemanticDispositionScope` | interface | 5 | <code>export interface SemanticDispositionScope {readonly organisation_id:string;readonly run_id:string}</code> |
| `SemanticDispositionReceipt` | interface | 6 | <code>export interface SemanticDispositionReceipt extends SemanticDispositionScope {</code> |
| `held` | variable | 10 | <code>const held=new WeakMap&lt;PrimaryTransaction,Map&lt;string,{mode:'READ'&#124;'WRITE';promise:Promise&lt;SemanticDispositionReceipt&gt;}&gt;&gt;();</code> |
| `fence` | function | 16 | <code>async function fence(tx:PrimaryTransaction,scope:SemanticDispositionScope,mode:'READ'&#124;'WRITE'):Promise&lt;SemanticDispositionReceipt&gt;{</code> |
| `readSemanticDisposition` | function | 43 | <code>export function readSemanticDisposition(tx:PrimaryTransaction,scope:SemanticDispositionScope):Promise&lt;SemanticDispositionReceipt&gt;{return fence(tx,scope,'READ');}</code> |
| `writeSemanticDisposition` | function | 44 | <code>export function writeSemanticDisposition(tx:PrimaryTransaction,scope:SemanticDispositionScope):Promise&lt;SemanticDispositionReceipt&gt;{return fence(tx,scope,'WRITE');}</code> |

## services/hyperfide/src/storage/durability.ts

[Open source](../../services/hyperfide/src/storage/durability.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `MigrationDefinition` | interface | 13 | <code>export interface MigrationDefinition {version:number;name:string;checksum:string;sql:string}</code> |
| `digest` | function | 15 | <code>const digest=(value:string)=&gt;'sha256:'+createHash('sha256').update(value).digest('hex');</code> |
| `discoverMigrations` | function | 16 | <code>export async function discoverMigrations(directory=DIRECTORY):Promise&lt;readonly MigrationDefinition&#91;&#93;&gt;{</code> |
| `assertMigrationSource` | function | 36 | <code>export function assertMigrationSource(sql:string):void{</code> |
| `Applied` | interface | 64 | <code>interface Applied {version:number;name:string;checksum:string}</code> |
| `inspectHistory` | function | 65 | <code>function inspectHistory(files:readonly MigrationDefinition&#91;&#93;,rows:Applied&#91;&#93;):MigrationDefinition&#91;&#93;{</code> |
| `history` | function | 77 | <code>async function history(session:QuerySession):Promise&lt;Applied&#91;&#93;&gt;{</code> |
| `isolationPostflight` | function | 81 | <code>async function isolationPostflight(session:QuerySession):Promise&lt;void&gt;{</code> |
| `MigrationCoordinator` | class | 87 | <code>export class MigrationCoordinator {</code> |
| `constructor` | method | 88 | <code>constructor(private readonly resources:ServiceResources,private readonly directory=DIRECTORY){}</code> |
| `inspect` | method | 89 | <code>async inspect():Promise&lt;{ready:boolean;applied:Applied&#91;&#93;;pending:number&#91;&#93;}&gt;{</code> |
| `apply` | method | 96 | <code>async apply(options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise&lt;{applied:number&#91;&#93;;alreadyApplied:number&#91;&#93;}&gt;{</code> |
| `assertMigrationReady` | function | 129 | <code>export async function assertMigrationReady(resources:ServiceResources,version:number,name:string,checksum:string):Promise&lt;void&gt;{</code> |
| `AuthorityScope` | interface | 133 | <code>export interface AuthorityScope {organisation_id:string;run_id:string;authority_epoch:string}</code> |
| `FenceReceipt` | interface | 134 | <code>export interface FenceReceipt {deployment_id:string;operation_id:string;fence_id:string;source_epoch:string&#124;null;isolated_writer:string;observed_at:string;expires_at:string;evidence_digest:string}</code> |
| `ExternalWriterFence` | interface | 135 | <code>export interface ExternalWriterFence {</code> |
| `isolate` | method | 136 | <code>isolate(input:{deployment_id:string;operation_id:string;source_epoch:string&#124;null;signal?:AbortSignal}):Promise&lt;FenceReceipt&gt;;</code> |
| `assertCurrentAuthority` | function | 139 | <code>export async function assertCurrentAuthority(tx:PrimaryTransaction,scope:AuthorityScope&amp;{deployment_id:string}):Promise&lt;void&gt;{</code> |
| `lookupAuthorityActivation` | function | 150 | <code>export async function lookupAuthorityActivation(resources:ServiceResources,input:{</code> |
| `assertExternalAuthorityCurrent` | function | 170 | <code>export async function assertExternalAuthorityCurrent(resources:ServiceResources,journal:ExternalAuthorityJournal,input:{deployment_id:string;timeoutMs?:number;signal?:AbortSignal}):Promise&lt;ExternalAut…</code> |
| `AuthorityStore` | class | 185 | <code>export class AuthorityStore {</code> |
| `constructor` | method | 186 | <code>constructor(private readonly resources:ServiceResources,private readonly deploymentId:string,private readonly journal?:ExternalAuthorityJournal){</code> |
| `assertCurrent` | method | 189 | <code>async assertCurrent(tx:PrimaryTransaction,scope:AuthorityScope):Promise&lt;void&gt;{return assertCurrentAuthority(tx,{...scope,deployment_id:this.deploymentId});}</code> |
| `activate` | method | 190 | <code>async activate(input:{operation_id:string;expected_previous_epoch:string&#124;null},fencer:ExternalWriterFence,options:TransactionOptions={},journal=this.journal):Promise&lt;{epoch:string;replayed:boolean}&gt;{</code> |
| `activateRestored` | method | 195 | <code>async activateRestored(input:{operation_id:string;expected_external_epoch:string;expected_database_epoch:string&#124;null},fencer:ExternalWriterFence,options:TransactionOptions={},journal=this.journal):Pro…</code> |
| `activateInternal` | method | 200 | <code>private async activateInternal(operationId:string,externalPrevious:string&#124;null,databasePrevious:string&#124;null,restore:boolean,fencer:ExternalWriterFence,options:TransactionOptions,journal?:ExternalAutho…</code> |
| `inspectDurability` | function | 246 | <code>export async function inspectDurability(resources:ServiceResources):Promise&lt;unknown&gt;{</code> |
| `assertRuntimePrivileges` | function | 256 | <code>export async function assertRuntimePrivileges(resources:ServiceResources):Promise&lt;void&gt;{</code> |
| `createComponent` | function | 264 | <code>export async function createComponent(context:ComponentContext):Promise&lt;Component&gt;{</code> |

## services/hyperfide/src/storage/recovery_probes.ts

[Open source](../../services/hyperfide/src/storage/recovery_probes.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ProbeInput` | interface | 12 | <code>interface ProbeInput {</code> |
| `Artifact` | interface | 15 | <code>interface Artifact {path:string;sha256:string;size:number}</code> |
| `DrillReconciliation` | interface | 16 | <code>export interface DrillReconciliation {</code> |
| `DrillProbeResult` | interface | 21 | <code>export interface DrillProbeResult {</code> |
| `PostgresDrillResult` | interface | 27 | <code>export interface PostgresDrillResult extends DrillProbeResult {scope:'ISOLATED_POSTGRESQL_FIXTURE'}</code> |
| `Profile` | interface | 28 | <code>interface Profile {schema_version:1;scope:'ISOLATED_POSTGRESQL_FIXTURE';python_path:string;producer_path:string;producer_sha256:string;evidence_directory:string;timeout_ms:number}</code> |
| `checkedPath` | function | 32 | <code>async function checkedPath(value:unknown,directory=false,privateMode=false):Promise&lt;string&gt;{</code> |
| `loadProfile` | function | 42 | <code>async function loadProfile(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;Profile&gt;{</code> |
| `count` | function | 59 | <code>const count=(value:unknown):value is number=&gt;Number.isSafeInteger(value)&amp;&amp;Number(value)&gt;=0&amp;&amp;Number(value)&lt;=100000;</code> |
| `reconciliationOf` | function | 61 | <code>export function reconciliationOf(value:unknown):DrillReconciliation&#124;null{</code> |
| `createPostgresRecoveryProbe` | function | 73 | <code>export function createPostgresRecoveryProbe(_resources:ServiceResources,env:Readonly&lt;NodeJS.ProcessEnv&gt;){</code> |
| `LocalScenario` | type | 130 | <code>type LocalScenario='OBJECT'&#124;'GIT'&#124;'AUTH'&#124;'FULL_DISK'&#124;'PROVIDER';</code> |
| `Cleanup` | interface | 141 | <code>interface Cleanup {complete:boolean;root_absent:boolean;processes_absent:boolean}</code> |
| `LocalOutcome` | interface | 142 | <code>interface LocalOutcome {status:'RECOVERED'&#124;'FAILED';recovery_epoch:string&#124;null;acknowledged_ids:string&#91;&#93;;recovered_ids:string&#91;&#93;;reconciliation:DrillReconciliation&#124;null;limits?:string}</code> |
| `LocalContext` | interface | 143 | <code>interface LocalContext {root:string;input:ProbeInput;save(name:string,value:unknown):Promise&lt;void&gt;;defer(step:()=&gt;Promise&lt;boolean&gt;):void}</code> |
| `save` | method | 143 | <code>interface LocalContext {root:string;input:ProbeInput;save(name:string,value:unknown):Promise&lt;void&gt;;defer(step:()=&gt;Promise&lt;boolean&gt;):void}</code> |
| `defer` | method | 143 | <code>interface LocalContext {root:string;input:ProbeInput;save(name:string,value:unknown):Promise&lt;void&gt;;defer(step:()=&gt;Promise&lt;boolean&gt;):void}</code> |
| `sha` | function | 144 | <code>const sha=(bytes:Buffer&#124;string)=&gt;createHash('sha256').update(bytes).digest('hex');</code> |
| `SAFE_ENV` | object | 145 | <code>const SAFE_ENV={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C.UTF-8'};</code> |
| `run` | function | 146 | <code>function run(file:string,args:string&#91;&#93;,options:{cwd?:string;input?:string&#124;undefined;env?:NodeJS.ProcessEnv}={}):Promise&lt;{code:number&#124;null;stdout:string;stderr:string}&gt;{</code> |
| `must` | function | 157 | <code>function must(condition:unknown,message:string):asserts condition{if(!condition)throw new FoundationError('DRILL_FIXTURE_FAILED',message);}</code> |
| `absent` | function | 158 | <code>async function absent(file:string):Promise&lt;boolean&gt;{try{await fs.lstat(file);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ENOENT';}}</code> |
| `durable` | function | 159 | <code>async function durable(file:string,bytes:Buffer&#124;string,flag='wx'):Promise&lt;void&gt;{</code> |
| `EpochFence` | class | 163 | <code>class EpochFence {</code> |
| `constructor` | method | 164 | <code>constructor(private readonly file:string){}</code> |
| `init` | method | 165 | <code>async init(epoch:string):Promise&lt;void&gt;{await durable(this.file,epoch);}</code> |
| `current` | method | 166 | <code>async current():Promise&lt;string&gt;{return (await fs.readFile(this.file,'utf8')).trim();}</code> |
| `rotate` | method | 167 | <code>async rotate(expected:string,next:string):Promise&lt;void&gt;{</code> |
| `admit` | method | 171 | <code>async admit(epoch:string):Promise&lt;boolean&gt;{return await this.current()===epoch;}</code> |
| `staleWorkers` | function | 173 | <code>async function staleWorkers(fence:EpochFence,stale:string&#91;&#93;,current:string,write:(epoch:string)=&gt;Promise&lt;void&gt;){</code> |
| `reconciliation` | function | 179 | <code>function reconciliation(scenario:LocalScenario,mechanism:string,workers:{presented:number;fenced:number;current_accepted:boolean},effects:DrillReconciliation&#91;'external_effects'&#93;):DrillReconciliation{</code> |
| `objectDrill` | function | 183 | <code>async function objectDrill(ctx:LocalContext):Promise&lt;LocalOutcome&gt;{</code> |
| `gitDrill` | function | 225 | <code>async function gitDrill(ctx:LocalContext):Promise&lt;LocalOutcome&gt;{</code> |
| `authDrill` | function | 281 | <code>async function authDrill(ctx:LocalContext):Promise&lt;LocalOutcome&gt;{</code> |
| `fullDiskDrill` | function | 319 | <code>async function fullDiskDrill(ctx:LocalContext):Promise&lt;LocalOutcome&gt;{</code> |
| `providerDrill` | function | 356 | <code>async function providerDrill(ctx:LocalContext):Promise&lt;LocalOutcome&gt;{</code> |
| `runLocalDrill` | function | 407 | <code>async function runLocalDrill(profile:Profile,input:ProbeInput,scenario:LocalScenario):Promise&lt;DrillProbeResult&gt;{</code> |
| `createRecoveryProbe` | function | 440 | <code>export function createRecoveryProbe(resources:ServiceResources,env:Readonly&lt;NodeJS.ProcessEnv&gt;){</code> |

## services/hyperfide/src/storage/replicas.ts

[Open source](../../services/hyperfide/src/storage/replicas.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Scope` | interface | 13 | <code>interface Scope {organisation_id:string;run_id:string;authority_epoch:string}</code> |
| `PacketInput` | interface | 14 | <code>interface PacketInput {organisation_id:string;run_id:string;digest:string}</code> |
| `ExecutionPacketReader` | interface | 15 | <code>export interface ExecutionPacketReader {readExecutionPacket(snapshot:QuerySession,input:PacketInput):Promise&lt;unknown&gt;}</code> |
| `readExecutionPacket` | method | 15 | <code>export interface ExecutionPacketReader {readExecutionPacket(snapshot:QuerySession,input:PacketInput):Promise&lt;unknown&gt;}</code> |
| `Topology` | interface | 16 | <code>interface Topology {system_id:string;timeline:string;authority_epoch:string}</code> |
| `CausalBarrier` | interface | 17 | <code>export interface CausalBarrier extends Topology,PacketInput {schema_version:1;deployment_id:string;lsn:string;issued_at:string;expires_at:string;signature:string}</code> |
| `PacketReadOptions` | interface | 18 | <code>export interface PacketReadOptions {digest:string;barrier?:CausalBarrier;timeoutMs?:number;waitMs?:number;preferReplica?:boolean;expected_graph_manifest_digest?:string&#124;null}</code> |
| `lsn` | function | 21 | <code>function lsn(value:string):bigint{</code> |
| `remaining` | function | 25 | <code>function remaining(deadline:number):number{</code> |
| `topologyPrivileges` | function | 33 | <code>async function topologyPrivileges(session:QuerySession,replica=false):Promise&lt;void&gt;{</code> |
| `scopeOf` | function | 37 | <code>function scopeOf(invocation:InvocationContext):Scope{</code> |
| `body` | function | 41 | <code>function body(value:Omit&lt;CausalBarrier,'signature'&gt;&#124;CausalBarrier):string{</code> |
| `keyFrom` | function | 44 | <code>function keyFrom(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Buffer{</code> |
| `proof` | function | 49 | <code>function proof(key:Buffer,value:Omit&lt;CausalBarrier,'signature'&gt;&#124;CausalBarrier):string{</code> |
| `PacketSnapshots` | class | 53 | <code>export class PacketSnapshots {</code> |
| `constructor` | method | 55 | <code>constructor(private readonly resources:ServiceResources,private readonly reader:ExecutionPacketReader,env:Readonly&lt;NodeJS.ProcessEnv&gt;){</code> |
| `topology` | method | 59 | <code>private async topology(session:QuerySession,scope:Scope):Promise&lt;Topology&gt;{</code> |
| `admit` | method | 69 | <code>private async admit(invocation:InvocationContext,deadline:number,digest:string):Promise&lt;Topology&gt;{</code> |
| `validate` | method | 87 | <code>private validate(value:unknown,scope:Scope,digest:string,current:Topology):CausalBarrier{</code> |
| `mint` | method | 105 | <code>async mint(digest:string,invocation:InvocationContext,options:{timeoutMs?:number}={}):Promise&lt;CausalBarrier&gt;{</code> |
| `validatePins` | method | 117 | <code>private validatePins(record:unknown,options:PacketReadOptions):void{</code> |
| `read` | method | 126 | <code>async read(options:PacketReadOptions,invocation:InvocationContext):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 186 | <code>export function createComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/storage/runtime.ts

[Open source](../../services/hyperfide/src/storage/runtime.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Waiter` | interface | 9 | <code>interface Waiter {resolve:(release:()=&gt;void)=&gt;void;reject:(error:unknown)=&gt;void;cleanup:()=&gt;void}</code> |
| `BoundedPool` | class | 10 | <code>class BoundedPool {</code> |
| `constructor` | method | 16 | <code>constructor(private readonly config:StorageConfig,private readonly maxQueued:number,private readonly shutdown:AbortSignal){}</code> |
| `raw` | method | 17 | <code>raw():pg.Pool{return this.pool??=createStoragePool(this.config);}</code> |
| `permit` | method | 18 | <code>private async permit(deadline:number,signal?:AbortSignal):Promise&lt;()=&gt;void&gt;{</code> |
| `drain` | method | 34 | <code>private drain():void{</code> |
| `acquire` | method | 40 | <code>async acquire(deadline:number,signal?:AbortSignal):Promise&lt;DatabaseLease&gt;{</code> |
| `facade` | method | 65 | <code>facade():pg.Pool{</code> |
| `get` | method | 68 | <code>get(target,key){</code> |
| `get` | method | 73 | <code>get(client,property){</code> |
| `metrics` | method | 100 | <code>metrics(){return {maxActive:this.config.max,maxQueued:this.maxQueued,active:this.active,queued:this.queue.length,</code> |
| `close` | method | 102 | <code>async close():Promise&lt;void&gt;{</code> |
| `setting` | function | 109 | <code>function setting(env:Readonly&lt;NodeJS.ProcessEnv&gt;,name:string,fallback:number,max:number):number{</code> |
| `ObservationOptions` | interface | 115 | <code>export interface ObservationOptions {timeoutMs?:number;signal?:AbortSignal;preferReplica?:boolean}</code> |
| `ListenerSession` | interface | 116 | <code>export interface ListenerSession extends QuerySession {onNotification(listener:(event:{channel:string;payload?:string&#124;undefined;processId:number})=&gt;void):()=&gt;void}</code> |
| `onNotification` | method | 116 | <code>export interface ListenerSession extends QuerySession {onNotification(listener:(event:{channel:string;payload?:string&#124;undefined;processId:number})=&gt;void):()=&gt;void}</code> |
| `ServiceResources` | interface | 117 | <code>export interface ServiceResources {</code> |
| `observe` | method | 119 | <code>observe&lt;T&gt;(options:ObservationOptions,operation:(session:QuerySession)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;{value:T;route:'primary'&#124;'replica';observedAt:string}&gt;;</code> |
| `withReplicaConnection` | method | 120 | <code>withReplicaConnection&lt;T&gt;(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;T&gt;;</code> |
| `withMigrationConnection` | method | 121 | <code>withMigrationConnection&lt;T&gt;(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;T&gt;;</code> |
| `withListener` | method | 122 | <code>withListener&lt;T&gt;(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:ListenerSession)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;T&gt;;</code> |
| `describe` | method | 123 | <code>describe():unknown;</code> |
| `close` | method | 124 | <code>close():Promise&lt;void&gt;;</code> |
| `ResourceContainer` | class | 126 | <code>export class ResourceContainer implements ServiceResources {</code> |
| `constructor` | method | 134 | <code>constructor(private readonly role:ServiceRole,private readonly env:Readonly&lt;NodeJS.ProcessEnv&gt;,signal:AbortSignal){</code> |
| `validateCommit` | method | 140 | <code>async validateCommit(client:pg.PoolClient):Promise&lt;void&gt;{</code> |
| `config` | method | 147 | <code>private config(kind:'primary'&#124;'replica'&#124;'migration'&#124;'listener'):StorageConfig{</code> |
| `pool` | method | 156 | <code>private pool(kind:'primary'&#124;'replica'&#124;'migration'&#124;'listener'):BoundedPool{</code> |
| `compatibilityPool` | method | 167 | <code>private compatibilityPool(caller:Readonly&lt;NodeJS.ProcessEnv&gt;):pg.Pool{</code> |
| `commitMode` | method | 175 | <code>commitMode():'on'&#124;'remote_apply'{</code> |
| `acquirePrimary` | method | 179 | <code>acquirePrimary(deadline:number,signal?:AbortSignal):Promise&lt;DatabaseLease&gt;{return this.pool('primary').acquire(deadline,signal);}</code> |
| `session` | method | 180 | <code>private session(lease:DatabaseLease,deadline:number,readonly=false):QuerySession{</code> |
| `connection` | method | 192 | <code>private async connection&lt;T&gt;(kind:'migration'&#124;'listener',options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;T&gt;{</code> |
| `withReplicaConnection` | method | 198 | <code>async withReplicaConnection&lt;T&gt;(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;T&gt;{</code> |
| `withMigrationConnection` | method | 211 | <code>withMigrationConnection&lt;T&gt;(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;T&gt;{return this.connection('migration',options,operation);}</code> |
| `withListener` | method | 212 | <code>async withListener&lt;T&gt;(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:ListenerSession)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;T&gt;{</code> |
| `observe` | method | 226 | <code>async observe&lt;T&gt;(options:ObservationOptions,operation:(session:QuerySession)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;{value:T;route:'primary'&#124;'replica';observedAt:string}&gt;{</code> |
| `describe` | method | 238 | <code>describe():unknown{</code> |
| `close` | method | 243 | <code>async close():Promise&lt;void&gt;{</code> |
| `createResourceContainer` | function | 248 | <code>export function createResourceContainer(context:{role:ServiceRole;env:Readonly&lt;NodeJS.ProcessEnv&gt;;signal:AbortSignal}):ResourceContainer{</code> |
| `createComponent` | function | 251 | <code>export function createComponent(context:{resources:ServiceResources}){</code> |

## services/hyperfide/src/storage/schema.ts

[Open source](../../services/hyperfide/src/storage/schema.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `StorageConfig` | interface | 21 | <code>export interface StorageConfig {</code> |
| `SchemaReceipt` | interface | 25 | <code>export interface SchemaReceipt {schema:string;schema_version:number;checksum:string;applied:boolean;tables:string&#91;&#93;}</code> |
| `SchemaInspection` | interface | 26 | <code>export interface SchemaInspection {</code> |
| `bounded` | function | 30 | <code>function bounded(env:Readonly&lt;NodeJS.ProcessEnv&gt;,name:string,fallback:number,min:number,max:number):number {</code> |
| `storageConfig` | function | 37 | <code>export function storageConfig(env:Readonly&lt;NodeJS.ProcessEnv&gt;):StorageConfig {</code> |
| `createStoragePool` | function | 69 | <code>export function createStoragePool(config:StorageConfig):pg.Pool {</code> |
| `bindStoragePool` | function | 89 | <code>export function bindStoragePool(provider:(env:Readonly&lt;NodeJS.ProcessEnv&gt;)=&gt;pg.Pool):()=&gt;void{</code> |
| `getPool` | function | 96 | <code>export function getPool(env:Readonly&lt;NodeJS.ProcessEnv&gt;):pg.Pool {</code> |
| `closePool` | function | 105 | <code>export async function closePool():Promise&lt;void&gt;{</code> |
| `migration` | function | 109 | <code>async function migration():Promise&lt;{sql:string;checksum:string}&gt;{</code> |
| `databaseError` | function | 116 | <code>export function databaseError(error:unknown):FoundationError{</code> |
| `tablesOf` | function | 128 | <code>async function tablesOf(client:pg.Pool&#124;pg.PoolClient):Promise&lt;string&#91;&#93;&gt;{</code> |
| `bootstrapAuthoritySchema` | function | 134 | <code>export async function bootstrapAuthoritySchema(pool:pg.Pool):Promise&lt;SchemaReceipt&gt;{</code> |
| `inspectAuthoritySchema` | function | 143 | <code>export async function inspectAuthoritySchema(pool:pg.Pool):Promise&lt;SchemaInspection&gt;{</code> |
| `empty` | function | 159 | <code>function empty(input:unknown):void{</code> |
| `createComponent` | function | 162 | <code>export function createComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/storage/transactions.ts

[Open source](../../services/hyperfide/src/storage/transactions.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `StorageError` | class | 4 | <code>export class StorageError extends FoundationError {</code> |
| `constructor` | method | 5 | <code>constructor(code:string,message:string,public readonly outcome:'aborted'&#124;'unknown'='aborted',</code> |
| `QuerySession` | interface | 8 | <code>export interface QuerySession {</code> |
| `query` | method | 9 | <code>query&lt;R extends pg.QueryResultRow=pg.QueryResultRow&gt;(text:string,values?:readonly unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;R&gt;&gt;;</code> |
| `remainingMs` | method | 10 | <code>remainingMs():number;</code> |
| `PrimaryTransaction` | interface | 14 | <code>export interface PrimaryTransaction extends QuerySession {readonly &#91;primaryBrand&#93;:true;copyFrom(sql:string,bytes:Uint8Array):Promise&lt;{rowCount:number}&gt;}</code> |
| `copyFrom` | method | 14 | <code>export interface PrimaryTransaction extends QuerySession {readonly &#91;primaryBrand&#93;:true;copyFrom(sql:string,bytes:Uint8Array):Promise&lt;{rowCount:number}&gt;}</code> |
| `livePrimary` | variable | 15 | <code>const livePrimary=new WeakSet&lt;object&gt;();</code> |
| `assertPrimaryTransaction` | function | 16 | <code>export function assertPrimaryTransaction(value:unknown):asserts value is PrimaryTransaction {</code> |
| `TransactionOptions` | interface | 20 | <code>export interface TransactionOptions {</code> |
| `DatabaseLease` | interface | 24 | <code>export interface DatabaseLease {client:pg.PoolClient;signal:AbortSignal;release(destroy?:boolean):void}</code> |
| `release` | method | 24 | <code>export interface DatabaseLease {client:pg.PoolClient;signal:AbortSignal;release(destroy?:boolean):void}</code> |
| `PrimaryConnectionSource` | interface | 25 | <code>export interface PrimaryConnectionSource {</code> |
| `commitMode` | method | 26 | <code>commitMode?(): 'on'&#124;'remote_apply';</code> |
| `validateCommit` | method | 27 | <code>validateCommit?(client:pg.PoolClient):Promise&lt;void&gt;;</code> |
| `acquirePrimary` | method | 28 | <code>acquirePrimary(deadline:number,signal?:AbortSignal):Promise&lt;DatabaseLease&gt;;</code> |
| `deadlineFrom` | function | 30 | <code>export function deadlineFrom(timeoutMs=5000):number {</code> |
| `codeOf` | function | 35 | <code>function codeOf(error:unknown):string {</code> |
| `bounded` | function | 38 | <code>export async function bounded&lt;T&gt;(promise:Promise&lt;T&gt;,deadline:number,signal?:AbortSignal):Promise&lt;T&gt;{</code> |
| `assertTransactionStatement` | function | 55 | <code>export function assertTransactionStatement(sql:string):void{</code> |
| `CopyConnection` | interface | 87 | <code>interface CopyConnection {sendCopyFromChunk(chunk:Buffer):void;endCopyFrom():void}</code> |
| `sendCopyFromChunk` | method | 87 | <code>interface CopyConnection {sendCopyFromChunk(chunk:Buffer):void;endCopyFrom():void}</code> |
| `endCopyFrom` | method | 87 | <code>interface CopyConnection {sendCopyFromChunk(chunk:Buffer):void;endCopyFrom():void}</code> |
| `BoundedCopyInput` | class | 88 | <code>class BoundedCopyInput extends pg.Query {</code> |
| `constructor` | method | 89 | <code>constructor(sql:string,private readonly bytes:Buffer){super(sql);}</code> |
| `handleCopyInResponse` | method | 90 | <code>handleCopyInResponse(connection:CopyConnection):void{</code> |
| `TransactionGateway` | class | 95 | <code>export class TransactionGateway {</code> |
| `constructor` | method | 96 | <code>constructor(private readonly source:PrimaryConnectionSource){}</code> |
| `withPrimaryTransaction` | method | 97 | <code>async withPrimaryTransaction&lt;T&gt;(options:TransactionOptions,operation:(tx:PrimaryTransaction)=&gt;Promise&lt;T&gt;&#124;T):Promise&lt;T&gt;{</code> |
