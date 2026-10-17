# Source reference: Control services: graph and spec

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the `docs/`, `graph/`, `hierarchy/` and `spec/` subtrees of `services/hyperfide/src/`: 422 declarations in 18 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## services/hyperfide/src/docs/closure.ts

[Open source](../../services/hyperfide/src/docs/closure.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RecordValue` | type | 10 | <code>export type RecordValue=Record&lt;string,unknown&gt;;</code> |
| `invalid` | function | 11 | <code>export function invalid(message:string):never{throw new FoundationError('CLOSURE_INVALID',message);}</code> |
| `fields` | function | 12 | <code>export function fields(value:unknown,required:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):RecordValue{</code> |
| `boundedText` | function | 16 | <code>export function boundedText(value:unknown,max=256):string{</code> |
| `sha256` | function | 19 | <code>export function sha256(value:Uint8Array&#124;string):string{return 'sha256:'+createHash('sha256').update(value).digest('hex');}</code> |
| `canonical` | function | 20 | <code>export function canonical(value:unknown):string{</code> |
| `contentDigest` | function | 27 | <code>export function contentDigest(value:unknown):string{return sha256(canonical(value));}</code> |
| `digest` | function | 28 | <code>export function digest(value:unknown):string{const s=boundedText(value,71);if(!/^sha256:&#91;a-f0-9&#93;{64}$/.test(s))invalid('Invalid digest');return s;}</code> |
| `uuid` | function | 29 | <code>export function uuid(value:unknown):string{const s=boundedText(value,36);if(!/^&#91;a-f0-9&#93;{8}-&#91;a-f0-9&#93;{4}-&#91;1-8&#93;&#91;a-f0-9&#93;{3}-&#91;89ab&#93;&#91;a-f0-9&#93;{3}-&#91;a-f0-9&#93;{12}$/i.test(s))invalid('Invalid UUID');return s;}</code> |
| `decimal` | function | 30 | <code>export function decimal(value:unknown):string{const s=boundedText(value,20);if(!/^&#91;1-9&#93;&#91;0-9&#93;&#42;$/.test(s)&#124;&#124;BigInt(s)&gt;9223372036854775807n)invalid('Invalid generation');return s;}</code> |
| `stringList` | function | 31 | <code>export function stringList(value:unknown,min=1,max=1000):string&#91;&#93;{</code> |
| `Scope` | interface | 35 | <code>export interface Scope{organisation_id:string;run_id:string}</code> |
| `DocumentationPins` | interface | 36 | <code>export interface DocumentationPins{spec_revision_id:string;spec_generation:string;programme_manifest_digest:string;source_manifest_digest:string}</code> |
| `DocumentationInspection` | interface | 37 | <code>export interface DocumentationInspection{</code> |
| `DocumentationPolicy` | interface | 41 | <code>interface DocumentationPolicy{mode:'auto'&#124;'manual';targets:string&#91;&#93;;check_cmd:string}</code> |
| `RepositoryVersion` | interface | 42 | <code>interface RepositoryVersion{repository_id:string;candidate_head:string;input_manifest_digest:string}</code> |
| `BlobSnapshot` | interface | 43 | <code>interface BlobSnapshot{path:string;digest:string;size:number;content_base64:string}</code> |
| `RepositorySnapshot` | interface | 44 | <code>interface RepositorySnapshot{repository_id:string;commit:string;tree:string;files:BlobSnapshot&#91;&#93;}</code> |
| `DocumentationPacket` | interface | 45 | <code>export interface DocumentationPacket{</code> |
| `DocumentationReload` | interface | 50 | <code>export interface DocumentationReload{previous_baseline_digest:string&#124;null;changed:{repository_id:string;path:string}&#91;&#93;;removed:{repository_id:string;path:string}&#91;&#93;;unchanged:number}</code> |
| `documentationReload` | function | 52 | <code>export function documentationReload(previous:unknown,files:{repositories:RepositorySnapshot&#91;&#93;},previousDigest:string&#124;null):DocumentationReload{</code> |
| `safeRelative` | function | 60 | <code>function safeRelative(value:unknown):string{</code> |
| `policyFromDocument` | function | 63 | <code>function policyFromDocument(document:unknown):DocumentationPolicy{</code> |
| `requireSchema` | function | 77 | <code>async function requireSchema(db:Pick&lt;PrimaryTransaction,'query'&gt;):Promise&lt;void&gt;{</code> |
| `current` | function | 82 | <code>async function current(db:Pick&lt;PrimaryTransaction,'query'&gt;,scope:Scope):Promise&lt;{spec_revision_id:string;spec_generation:string;authority_epoch:string;document:unknown}&gt;{</code> |
| `repositoryVersions` | function | 86 | <code>async function repositoryVersions(db:Pick&lt;PrimaryTransaction,'query'&gt;,scope:Scope):Promise&lt;RepositoryVersion&#91;&#93;&gt;{</code> |
| `pins` | function | 91 | <code>function pins(value:unknown):DocumentationPins{</code> |
| `assertCurrent` | function | 95 | <code>async function assertCurrent(db:Pick&lt;PrimaryTransaction,'query'&gt;,scope:Scope,p:DocumentationPins,epoch?:string):Promise&lt;{policy:DocumentationPolicy;versions:RepositoryVersion&#91;&#93;;authority_epoch:string}…</code> |
| `git` | function | 102 | <code>async function git(root:string,args:string&#91;&#93;,signal?:AbortSignal):Promise&lt;Buffer&gt;{</code> |
| `matches` | function | 105 | <code>function matches(pattern:string,name:string):boolean{</code> |
| `snapshot` | function | 112 | <code>async function snapshot(context:ComponentContext,scope:Scope,versions:RepositoryVersion&#91;&#93;,policy:DocumentationPolicy):Promise&lt;{repositories:RepositorySnapshot&#91;&#93;}&gt;{</code> |
| `inspectDocumentationClosure` | function | 137 | <code>export async function inspectDocumentationClosure(db:Pick&lt;PrimaryTransaction,'query'&gt;,scope:Scope,p:DocumentationPins):Promise&lt;DocumentationInspection&gt;{</code> |
| `packetDocumentation` | function | 156 | <code>export async function packetDocumentation(input:unknown,context:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `closeDocumentation` | function | 173 | <code>export async function closeDocumentation(input:unknown,context:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `createClosureComponent` | function | 197 | <code>export function createClosureComponent(_context:ComponentContext):Component{</code> |
| `DurableArtifactFacade` | interface | 205 | <code>interface DurableArtifactFacade{invoke(action:string,input:unknown,context:ComponentContext):Promise&lt;unknown&gt;}</code> |
| `invoke` | method | 205 | <code>interface DurableArtifactFacade{invoke(action:string,input:unknown,context:ComponentContext):Promise&lt;unknown&gt;}</code> |
| `artifactFacade` | function | 206 | <code>function artifactFacade(value:unknown):value is DurableArtifactFacade{return object(value)&amp;&amp;typeof value.invoke==='function';}</code> |
| `admittedArtifact` | function | 207 | <code>function admittedArtifact(value:unknown,scope:Scope,expected?:{digest:string;size:string}):RecordValue{</code> |
| `persistReleaseArtifact` | function | 213 | <code>export async function persistReleaseArtifact(context:ComponentContext,kind:string,payload:unknown):Promise&lt;RecordValue&gt;{</code> |
| `DocumentationRemotePlan` | interface | 234 | <code>interface DocumentationRemotePlan{</code> |
| `DocumentationRemote` | interface | 239 | <code>interface DocumentationRemote{</code> |
| `prepare` | method | 240 | <code>prepare(tx:PrimaryTransaction,invocation:ReturnType&lt;typeof invocationOf&gt;,plan:DocumentationRemotePlan):Promise&lt;object&gt;;</code> |
| `execute` | method | 241 | <code>execute(permit:object,signal:AbortSignal):Promise&lt;RecordValue&gt;;</code> |
| `validateDocumentationResult` | function | 244 | <code>export function validateDocumentationResult(value:unknown,packet:DocumentationPacket,packetDigest:string,repositoryID:string):RecordValue{</code> |
| `remoteCaptured` | function | 256 | <code>function remoteCaptured(value:unknown):Buffer{</code> |
| `checkDocumentation` | function | 262 | <code>export async function checkDocumentation(input:unknown,context:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `readJobAllocation` | method | 267 | <code>const allocations=context.dependencies.require('5.1','scheduler.allocations.v1',(v:unknown):v is {readJobAllocation(tx:PrimaryTransaction,input:RecordValue):Promise&lt;RecordValue&#124;null&gt;;assertJobReservat…</code> |
| `assertJobReservation` | method | 267 | <code>const allocations=context.dependencies.require('5.1','scheduler.allocations.v1',(v:unknown):v is {readJobAllocation(tx:PrimaryTransaction,input:RecordValue):Promise&lt;RecordValue&#124;null&gt;;assertJobReservat…</code> |
| `createComponent` | function | 333 | <code>export function createComponent(context:ComponentContext):Component{</code> |
| `DocumentationCheckReference` | interface | 337 | <code>interface DocumentationCheckReference{check_id:string;checker_receipt_digest:string;repository_id:string}</code> |
| `validatedDocumentationChecks` | function | 338 | <code>async function validatedDocumentationChecks(db:Pick&lt;PrimaryTransaction,'query'&gt;,scope:Scope,packetID:string,ids:string&#91;&#93;,packet:DocumentationPacket):Promise&lt;DocumentationCheckReference&#91;&#93;&gt;{</code> |
| `requireDocumentationCleanup` | function | 355 | <code>export function requireDocumentationCleanup(value:unknown):void{</code> |

## services/hyperfide/src/graph/contract_query.ts

[Open source](../../services/hyperfide/src/graph/contract_query.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `optional` | function | 28 | <code>function optional(value:unknown,kind:string,limit=256):string&#124;null{return value===undefined?null:text(value,kind,limit);}</code> |
| `contracts` | function | 29 | <code>export async function contracts(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise&lt;unknown&gt;{</code> |

## services/hyperfide/src/graph/extraction.ts

[Open source](../../services/hyperfide/src/graph/extraction.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `JsonObject` | type | 15 | <code>export type JsonObject=Record&lt;string,unknown&gt;;</code> |
| `fail` | function | 16 | <code>export function fail(code:string,message:string):never {throw new FoundationError(code,message);}</code> |
| `exact` | function | 17 | <code>export function exact(value:unknown,required:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):JsonObject {</code> |
| `canonical` | function | 22 | <code>export function canonical(value:unknown):string {</code> |
| `digest` | function | 29 | <code>export function digest(value:string&#124;Buffer):string{return 'sha256:'+createHash('sha256').update(value).digest('hex');}</code> |
| `verifiedFile` | function | 30 | <code>async function verifiedFile(filename:string,size:number,bodyEligible:boolean,signal:AbortSignal):Promise&lt;{hash:string;body:Buffer&#124;null}&gt;{</code> |
| `text` | function | 41 | <code>export function text(value:unknown,kind='text',limit=256):string {</code> |
| `uuid` | function | 45 | <code>export function uuid(value:unknown):string {const v=text(value,'UUID',36);if(!/^&#91;a-f0-9&#93;{8}-(?:&#91;a-f0-9&#93;{4}-){3}&#91;a-f0-9&#93;{12}$/.test(v))fail('GRAPH_INVALID','Invalid UUID');return v;}</code> |
| `decimal` | function | 46 | <code>export function decimal(value:unknown,zero=false):string {</code> |
| `sha` | function | 49 | <code>export function sha(value:unknown):string {const v=text(value,'digest',71);if(!/^sha256:&#91;a-f0-9&#93;{64}$/.test(v))fail('GRAPH_INVALID','Invalid digest');return v;}</code> |
| `oid` | function | 50 | <code>function oid(value:unknown):string {const v=text(value,'Git object',64);if(!/^(?:&#91;a-f0-9&#93;{40}&#124;&#91;a-f0-9&#93;{64})$/.test(v))fail('GRAPH_INVALID','Full Git object required');return v;}</code> |
| `relative` | function | 51 | <code>function relative(value:unknown):string {const v=text(value,'path',4096);if(v.startsWith('/')&#124;&#124;v.includes('&#92;&#92;')&#124;&#124;v.split('/').some(p=&gt;p===''&#124;&#124;p==='.'&#124;&#124;p==='..')&#124;&#124;v==='.git'&#124;&#124;v.startsWith('.git/')&#124;&#124;v==…</code> |
| `ExtractionIdentity` | interface | 52 | <code>export interface ExtractionIdentity {organisation_id:string;run_id:string;repository_id:string;commit:string;tree:string;generation:string;</code> |
| `Fact` | interface | 54 | <code>export interface Fact {table:string;key:string;row:JsonObject;}</code> |
| `GraphChunk` | interface | 55 | <code>export interface GraphChunk {schema_version:1;identity:ExtractionIdentity;index:number;rows:Fact&#91;&#93;;digest:string;}</code> |
| `BundleManifest` | interface | 56 | <code>export interface BundleManifest {schema_version:1;bundle_digest:string;identity:ExtractionIdentity;complete:boolean;</code> |
| `Config` | interface | 58 | <code>interface Config {scratch:string;binary:string;binaryDigest:string;repositories:Record&lt;string,string&gt;;maxBytes:number;maxRows:number;chunkBytes:number;}</code> |
| `config` | function | 59 | <code>async function config(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;Config&gt; {</code> |
| `command` | function | 74 | <code>async function command(executable:string,args:string&#91;&#93;,cwd:string,signal:AbortSignal,max=1048576):Promise&lt;string&gt; {</code> |
| `snapshotRows` | function | 87 | <code>function snapshotRows(db:DatabaseSync,maxRows:number,maxBytes:number):{facts:Fact&#91;&#93;;counts:Record&lt;string,number&gt;;coverage:JsonObject} {</code> |
| `validateIdentity` | function | 114 | <code>export function validateIdentity(value:unknown):ExtractionIdentity {</code> |
| `validateChunk` | function | 122 | <code>export function validateChunk(value:unknown):GraphChunk {</code> |
| `validateManifest` | function | 131 | <code>export function validateManifest(value:unknown):BundleManifest {</code> |
| `extractionGuard` | function | 147 | <code>async function extractionGuard(ctx:ComponentContext,identity?:Pick&lt;ExtractionIdentity,'organisation_id'&#124;'run_id'&#124;'repository_id'&#124;'commit'&gt;,write=false):Promise&lt;void&gt;{</code> |
| `create` | function | 155 | <code>async function create(input:unknown,ctx:ComponentContext,cfg:Config):Promise&lt;BundleManifest&gt; {</code> |
| `createComponent` | function | 235 | <code>export async function createComponent(ctx:ComponentContext):Promise&lt;Component&gt; {</code> |

## services/hyperfide/src/graph/ingestion.ts

[Open source](../../services/hyperfide/src/graph/ingestion.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GraphTransaction` | interface | 9 | <code>export interface GraphTransaction {</code> |
| `query` | method | 10 | <code>query&lt;R extends pg.QueryResultRow=pg.QueryResultRow&gt;(sql:string,values?:unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;R&gt;&gt;;</code> |
| `copyFrom` | method | 11 | <code>copyFrom(sql:string,bytes:Uint8Array):Promise&lt;{rowCount:number}&gt;;</code> |
| `remainingMs` | method | 12 | <code>remainingMs():number;readonly signal:AbortSignal;</code> |
| `GraphGateway` | interface | 14 | <code>export interface GraphGateway {withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries?:number;guard?:(tx:GraphTransaction)=&gt;void&#124;Promise&lt;void&gt;;signal?:AbortSignal},fn:(tx:GraphTransaction)=&gt;Pr…</code> |
| `withPrimaryTransaction` | method | 14 | <code>export interface GraphGateway {withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries?:number;guard?:(tx:GraphTransaction)=&gt;void&#124;Promise&lt;void&gt;;signal?:AbortSignal},fn:(tx:GraphTransaction)=&gt;Pr…</code> |
| `GraphScope` | interface | 15 | <code>export interface GraphScope {organisation_id:string;run_id:string;authority_epoch:string;}</code> |
| `scopeInput` | function | 16 | <code>export function scopeInput(input:JsonObject,ctx:ComponentContext):GraphScope {</code> |
| `graphRole` | function | 21 | <code>export function graphRole(ctx:ComponentContext,write:boolean):void {</code> |
| `graphGateway` | function | 25 | <code>export function graphGateway(ctx:ComponentContext):GraphGateway {</code> |
| `graphGuard` | function | 30 | <code>export async function graphGuard(tx:GraphTransaction,scope:GraphScope,ctx:ComponentContext,write=true):Promise&lt;void&gt; {</code> |
| `GraphAdmissionLimits` | interface | 44 | <code>export interface GraphAdmissionLimits {max_active:number;max_queued:number;queue_wait_ms:number;primary_pool_max:number}</code> |
| `AdmissionWaiter` | interface | 45 | <code>interface AdmissionWaiter {grant:()=&gt;void;refuse:(error:FoundationError)=&gt;void}</code> |
| `GraphAdmission` | class | 46 | <code>export class GraphAdmission {</code> |
| `constructor` | method | 48 | <code>constructor(readonly limits:GraphAdmissionLimits){}</code> |
| `overloaded` | method | 49 | <code>private overloaded(message:string):FoundationError{this.refused++;return new FoundationError('GRAPH_OVERLOADED',message);}</code> |
| `run` | method | 50 | <code>async run&lt;T&gt;(signal:AbortSignal&#124;undefined,fn:()=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `metrics` | method | 68 | <code>metrics():JsonObject{return {...this.limits,active:this.active,queued:this.queue.length,admitted:this.admitted,refused:this.refused};}</code> |
| `admissionSetting` | function | 70 | <code>function admissionSetting(env:Readonly&lt;NodeJS.ProcessEnv&gt;,name:string,fallback:number,min:number,max:number):number{</code> |
| `primaryPoolMax` | function | 75 | <code>function primaryPoolMax(ctx:ComponentContext):number{</code> |
| `graphAdmissionLimits` | function | 79 | <code>export function graphAdmissionLimits(ctx:ComponentContext):GraphAdmissionLimits{</code> |
| `admissions` | variable | 85 | <code>const admissions=new WeakMap&lt;object,GraphAdmission&gt;();</code> |
| `graphAdmission` | function | 86 | <code>export function graphAdmission(ctx:ComponentContext):GraphAdmission{</code> |
| `graphTransaction` | function | 91 | <code>export async function graphTransaction&lt;T&gt;(ctx:ComponentContext,scope:GraphScope,fn:(tx:GraphTransaction)=&gt;Promise&lt;T&gt;,write=true):Promise&lt;T&gt;{</code> |
| `sourceId` | function | 95 | <code>export function sourceId(build:string,bundle:string,family:string,legacy:unknown):string {</code> |
| `semanticProjectionDebt` | function | 101 | <code>export async function semanticProjectionDebt(tx:Pick&lt;GraphTransaction,'query'&gt;,s:GraphScope,graphId:string):Promise&lt;{count:string;rows:JsonObject&#91;&#93;}&gt;{</code> |
| `getBuild` | function | 105 | <code>export async function getBuild(tx:GraphTransaction,s:GraphScope,id:string,lock=false):Promise&lt;JsonObject&gt; {</code> |
| `assertGraphArtifacts` | function | 111 | <code>export async function assertGraphArtifacts(tx:GraphTransaction,s:GraphScope,id:string):Promise&lt;void&gt;{</code> |
| `graphCoverage` | function | 116 | <code>export async function graphCoverage(tx:GraphTransaction,s:GraphScope,id:string):Promise&lt;JsonObject&gt;{</code> |
| `createBuild` | function | 121 | <code>async function createBuild(input:unknown,ctx:ComponentContext):Promise&lt;unknown&gt; {</code> |
| `copyCell` | function | 153 | <code>function copyCell(value:string):string {return value.replace(/&#92;&#92;/g,'&#92;&#92;&#92;&#92;').replace(/&#92;t/g,'&#92;&#92;t').replace(/&#92;n/g,'&#92;&#92;n').replace(/&#92;r/g,'&#92;&#92;r');}</code> |
| `stageChunk` | function | 154 | <code>async function stageChunk(input:unknown,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `seal` | function | 172 | <code>async function seal(input:unknown,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `batchLimit` | function | 192 | <code>function batchLimit(value:unknown):number {if(value===undefined)return 128;if(!Number.isSafeInteger(value)&#124;&#124;Number(value)&lt;1&#124;&#124;Number(value)&gt;256)fail('GRAPH_INVALID','Resolution limit must be1..256');re…</code> |
| `bodyPage` | function | 193 | <code>async function bodyPage(tx:GraphTransaction,s:GraphScope,id:string,bundle:string,cursor:string):Promise&lt;{bundle:string;key:string}&#124;null&gt;{</code> |
| `resolve` | function | 211 | <code>async function resolve(input:unknown,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 259 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/graph/projection.ts

[Open source](../../services/hyperfide/src/graph/projection.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Origin` | type | 11 | <code>type Origin='BASE_REUSED'&#124;'TARGET';</code> |
| `Delta` | interface | 12 | <code>export interface Delta {invalidation:'FILE_CONTENT_AND_DEPENDENTS'&#124;'FULL_PARSER_CONFIGURATION_CHANGE';added:string&#91;&#93;;deleted:string&#91;&#93;;changed:string&#91;&#93;;dependents:string&#91;&#93;;reused:string&#91;&#93;;origin:Map&lt;st…</code> |
| `sort` | function | 13 | <code>const sort=(values:Iterable&lt;string&gt;)=&gt;&#91;...values&#93;.sort((a,b)=&gt;Buffer.compare(Buffer.from(a),Buffer.from(b)));</code> |
| `intersects` | function | 14 | <code>const intersects=(a:Set&lt;string&gt;&#124;undefined,b:Set&lt;string&gt;)=&gt;!!a&amp;&amp;&#91;...a&#93;.some(v=&gt;b.has(v));</code> |
| `computeDelta` | function | 19 | <code>export function computeDelta(base:RepositoryFacts,target:RepositoryFacts):Delta{</code> |
| `compose` | function | 38 | <code>export function compose(base:RepositoryFacts,target:RepositoryFacts,delta:Delta):NormalisedFile&#91;&#93;{</code> |
| `summary` | function | 41 | <code>function summary(delta:Delta):JsonObject{</code> |
| `pathFilter` | function | 45 | <code>function pathFilter(value:unknown):Set&lt;string&gt;&#124;null{</code> |
| `selected` | function | 50 | <code>function selected(files:NormalisedFile&#91;&#93;,paths:Set&lt;string&gt;&#124;null):NormalisedFile&#91;&#93;{</code> |
| `source` | function | 56 | <code>function source(facts:RepositoryFacts,manifest:JsonObject):JsonObject{return {manifest_id:manifest.id,manifest_digest:manifest.manifest_digest,bundle_digest:facts.bundle_digest,identity:facts.identity…</code> |
| `projectionFacts` | function | 59 | <code>export async function projectionFacts(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise&lt;unknown&gt;{</code> |
| `projectionDelta` | function | 69 | <code>export async function projectionDelta(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise&lt;unknown&gt;{</code> |
| `projectionView` | function | 83 | <code>export async function projectionView(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise&lt;unknown&gt;{</code> |

## services/hyperfide/src/graph/projection_extract.ts

[Open source](../../services/hyperfide/src/graph/projection_extract.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `assertParityIndexes` | function | 10 | <code>export async function assertParityIndexes(session:Pick&lt;QuerySession,'query'&gt;):Promise&lt;void&gt;{</code> |
| `readPublishedManifest` | function | 18 | <code>export async function readPublishedManifest(session:Pick&lt;QuerySession,'query'&gt;,s:GraphScope,manifestId:string):Promise&lt;JsonObject&gt;{</code> |
| `Cell` | type | 28 | <code>export type Cell=string&#124;null;</code> |
| `NormalisedFile` | interface | 29 | <code>export interface NormalisedFile {path:string;content:Cell;lang:Cell;symbols:Cell&#91;&#93;&#91;&#93;;refs:Cell&#91;&#93;&#91;&#93;;comments:Cell&#91;&#93;&#91;&#93;;routes:Cell&#91;&#93;&#91;&#93;;edges:Cell&#91;&#93;&#91;&#93;}</code> |
| `RepositoryFacts` | interface | 30 | <code>export interface RepositoryFacts {bundle_digest:string;identity:ExtractionIdentity;files:Map&lt;string,NormalisedFile&gt;;</code> |
| `cell` | function | 34 | <code>const cell=(value:unknown):Cell=&gt;value===null&#124;&#124;value===undefined?null:String(value);</code> |
| `ordered` | function | 35 | <code>const ordered=(rows:Cell&#91;&#93;&#91;&#93;):Cell&#91;&#93;&#91;&#93;=&gt;rows.map(row=&gt;({row,key:Buffer.from(canonical(row))})).sort((a,b)=&gt;Buffer.compare(a.key,b.key)).map(v=&gt;v.row);</code> |
| `repositoryFacts` | function | 38 | <code>export async function repositoryFacts(session:Pick&lt;QuerySession,'query'&gt;,s:GraphScope,manifest:JsonObject,repositoryId:string):Promise&lt;RepositoryFacts&gt;{</code> |
| `sortedFiles` | function | 67 | <code>export function sortedFiles(files:Iterable&lt;NormalisedFile&gt;):NormalisedFile&#91;&#93;{return &#91;...files&#93;.sort((a,b)=&gt;Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));}</code> |
| `factsDigest` | function | 68 | <code>export function factsDigest(files:Iterable&lt;NormalisedFile&gt;):string{return digest(canonical(sortedFiles(files)));}</code> |

## services/hyperfide/src/graph/publication.ts

[Open source](../../services/hyperfide/src/graph/publication.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `publishedGraph` | function | 12 | <code>export async function publishedGraph(tx:GraphTransaction,s:GraphScope,manifestId:string):Promise&lt;JsonObject&gt;{</code> |
| `loadGraphSnapshot` | function | 19 | <code>export async function loadGraphSnapshot(tx:GraphTransaction,s:GraphScope,manifestId:string,expected:unknown):Promise&lt;JsonObject&gt;{</code> |
| `stagingDebt` | function | 32 | <code>export async function stagingDebt(tx:GraphTransaction,s:GraphScope,id:string,channel:string):Promise&lt;JsonObject&gt;{</code> |
| `publish` | function | 44 | <code>async function publish(input:unknown,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 87 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/graph/query.ts

[Open source](../../services/hyperfide/src/graph/query.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GraphQueryDescriptor` | interface | 17 | <code>export interface GraphQueryDescriptor {kind:string;input:JsonObject;max_bytes:number;read_options?:unknown}</code> |
| `GraphQueryExecutor` | type | 18 | <code>export type GraphQueryExecutor=&lt;T extends JsonObject&gt;(ctx:ComponentContext,scope:GraphScope,manifestId:string,query:GraphQueryDescriptor,operation:(session:QuerySession,manifest:JsonObject)=&gt;Promise&lt;T…</code> |
| `primaryGraphQueryExecutor` | function | 19 | <code>export const primaryGraphQueryExecutor:GraphQueryExecutor=async(ctx,scope,manifestId,_query,operation)=&gt;graphTransaction(ctx,scope,async tx=&gt;{</code> |
| `semanticInput` | function | 22 | <code>export function semanticInput(input:JsonObject):JsonObject{const {read_options,...semantic}=input;void read_options;return semantic;}</code> |
| `bounded` | function | 24 | <code>export function bounded(value:unknown,base:number,min:number,max:number):number{if(value===undefined)return base;if(!Number.isSafeInteger(value)&#124;&#124;Number(value)&lt;min&#124;&#124;Number(value)&gt;max)fail('GRAPH_INVAL…</code> |
| `ids` | function | 25 | <code>function ids(value:unknown,max=128):string&#91;&#93;{if(!Array.isArray(value)&#124;&#124;value.length&gt;max)fail('GRAPH_INVALID','Bounded ID array required');const all=value.map(uuid);if(new Set(all).size!==all.length)fa…</code> |
| `provenance` | function | 27 | <code>export function provenance(manifest:JsonObject):JsonObject{const routed=manifest.query_route;return {manifest_id:manifest.id,manifest_digest:manifest.manifest_digest,source_manifest_digest:manifest.so…</code> |
| `budget` | function | 28 | <code>export function budget(value:unknown):number{return bounded(value,262144,4096,786432);}</code> |
| `packet` | function | 29 | <code>export function packet&lt;T extends JsonObject&gt;(value:T,max:number):T {if(Buffer.byteLength(JSON.stringify(value))&gt;max)fail('GRAPH_PACKET_TOO_LARGE','Exact graph packet exceeds requested byte budget');re…</code> |
| `decodeCursor` | function | 30 | <code>export function decodeCursor(value:unknown,queryDigest:string):number{</code> |
| `encodeCursor` | function | 36 | <code>export function encodeCursor(queryDigest:string,offset:number):string{return Buffer.from(canonical({query_digest:queryDigest,offset})).toString('base64url');}</code> |
| `legacySyntax` | function | 39 | <code>function legacySyntax(q:string):void{</code> |
| `legacyWords` | function | 44 | <code>function legacyWords(q:string):string&#91;&#93;{</code> |
| `status` | function | 49 | <code>async function status(input:unknown,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `search` | function | 62 | <code>export async function search(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise&lt;unknown&gt;{</code> |
| `context` | function | 101 | <code>export async function context(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise&lt;unknown&gt;{</code> |
| `traverse` | function | 122 | <code>export async function traverse(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 147 | <code>export function createComponent(ctx:ComponentContext):Component {</code> |

## services/hyperfide/src/graph/replica_query.ts

[Open source](../../services/hyperfide/src/graph/replica_query.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GraphReadOptions` | interface | 17 | <code>export interface GraphReadOptions {route:'PRIMARY'&#124;'REPLICA';fallback:'NONE'&#124;'PRIMARY';wait_ms:number;cache:'BYPASS'&#124;'USE'}</code> |
| `graphReadOptions` | function | 18 | <code>export function graphReadOptions(value:unknown):GraphReadOptions{</code> |
| `lsn` | function | 27 | <code>function lsn(value:string):bigint{if(!LSN.test(value))throw new StorageError('REPLICA_TOPOLOGY_MISMATCH','Canonical WAL position is required');const &#91;high,low&#93;=value.split('/');return (BigInt('0x'+hig…</code> |
| `GraphQueryCache` | class | 32 | <code>export class GraphQueryCache {</code> |
| `constructor` | method | 34 | <code>constructor(readonly capacity:number,readonly maxBytes=16&#42;1024&#42;1024){}</code> |
| `get` | method | 35 | <code>get(key:string):JsonObject&#124;undefined{const entry=this.entries.get(key);if(entry===undefined){this.misses++;return undefined;}this.hits++;this.entries.delete(key);this.entries.set(key,entry);return ent…</code> |
| `set` | method | 36 | <code>set(key:string,value:JsonObject):void{</code> |
| `remove` | method | 41 | <code>private remove(key:string):void{const entry=this.entries.get(key);if(entry){this.bytes-=entry.bytes;this.entries.delete(key);}}</code> |
| `describe` | method | 42 | <code>describe():JsonObject{return {capacity:this.capacity,max_bytes:this.maxBytes,entries:this.entries.size,bytes:this.bytes,hits:this.hits,misses:this.misses,evictions:this.evictions,authority:'NONE'};}</code> |
| `cacheCapacity` | function | 44 | <code>export function cacheCapacity(env:Readonly&lt;NodeJS.ProcessEnv&gt;):number{</code> |
| `Barrier` | interface | 49 | <code>interface Barrier {lsn:string;system_id:string}</code> |
| `Admission` | interface | 50 | <code>interface Admission {manifest:JsonObject;barrier:Barrier&#124;null}</code> |
| `route` | function | 51 | <code>function route(manifest:JsonObject,value:JsonObject):JsonObject{return {...manifest,query_route:{exact_version:true,authority:'NONE',...value}};}</code> |
| `replicaCode` | function | 52 | <code>function replicaCode(error:unknown):string&#124;null{</code> |
| `admit` | function | 56 | <code>async function admit(ctx:ComponentContext,s:GraphScope,manifestId:string,barrier:boolean):Promise&lt;Admission&gt;{</code> |
| `replicaRead` | function | 71 | <code>async function replicaRead&lt;T extends JsonObject&gt;(ctx:ComponentContext,s:GraphScope,manifestId:string,admitted:Admission,options:GraphReadOptions,operation:(session:QuerySession,manifest:JsonObject)=&gt;P…</code> |
| `routedGraphQueryExecutor` | function | 106 | <code>export function routedGraphQueryExecutor(primary:GraphQueryExecutor,cache:GraphQueryCache):GraphQueryExecutor{</code> |

## services/hyperfide/src/hierarchy/adoption.ts

[Open source](../../services/hyperfide/src/hierarchy/adoption.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `schema` | function | 20 | <code>async function schema(tx:PrimaryTransaction):Promise&lt;void&gt;{</code> |
| `name` | function | 31 | <code>function name(value:unknown):string{</code> |
| `currentManager` | function | 34 | <code>async function currentManager(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string},packageId:string):Promise&lt;string&gt;{</code> |
| `ChildState` | interface | 38 | <code>interface ChildState {row:Record&lt;string,any&gt;;reservations:Record&lt;string,any&gt;&#91;&#93;;charge:Record&lt;string,unknown&gt;&#124;null;release:Record&lt;string,any&gt;&#124;null;refusal:&#91;string,string&#93;&#124;null}</code> |
| `childState` | function | 40 | <code>async function childState(tx:PrimaryTransaction,org:string,run:string,child:string):Promise&lt;ChildState&#124;null&gt;{</code> |
| `childRegistration` | function | 54 | <code>export async function childRegistration(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;child_session_id:string}):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `alignChildCapacity` | function | 63 | <code>export async function alignChildCapacity(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;child_session_id:string;lease_expires_at:string}):Promise&lt;number&gt;{</code> |
| `childToken` | function | 69 | <code>function childToken(row:Record&lt;string,any&gt;):ComputeToken{</code> |
| `Descendant` | interface | 74 | <code>export interface Descendant {</code> |
| `liveDescendants` | function | 80 | <code>async function liveDescendants(tx:PrimaryTransaction,scope:Scope,filter:{package_ids?:string&#91;&#93;;session_id?:string}):Promise&lt;Descendant&#91;&#93;&gt;{</code> |
| `requireAccounted` | function | 100 | <code>function requireAccounted(found:readonly Descendant&#91;&#93;):void{</code> |
| `assertChildExecutionAuthority` | function | 105 | <code>export async function assertChildExecutionAuthority(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;session_id:string}):Promise&lt;Descendant&gt;{</code> |
| `identity` | function | 115 | <code>function identity(d:Descendant){</code> |
| `continues` | function | 119 | <code>function continues(before:Record&lt;string,any&gt;,after:Descendant&#124;undefined):boolean{</code> |
| `childAuthority` | function | 124 | <code>async function childAuthority(tx:PrimaryTransaction,a:TrustedActor,childId:string,v:Record&lt;string,unknown&gt;){</code> |
| `supervisorRegistration` | function | 134 | <code>export async function supervisorRegistration(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;session_id:string}){</code> |
| `createComponent` | function | 151 | <code>export function createComponent(context:ComponentContext):Component{</code> |
| `WorkerRegistrationInput` | interface | 391 | <code>export interface WorkerRegistrationInput {</code> |
| `WorkerRegistrationReceipt` | interface | 394 | <code>export interface WorkerRegistrationReceipt {</code> |
| `WorkerRegistrationAuthority` | interface | 397 | <code>export interface WorkerRegistrationAuthority {</code> |
| `isWorkerRegistrationAuthority` | function | 400 | <code>export function isWorkerRegistrationAuthority(value:unknown):value is WorkerRegistrationAuthority {</code> |
| `workerSchema` | function | 403 | <code>async function workerSchema(tx:PrimaryTransaction){</code> |
| `workerSeat` | function | 409 | <code>async function workerSeat(tx:PrimaryTransaction,token:ComputeToken,packetDigest:string,native:NativeAuthAuthority,i:InvocationContext):Promise&lt;WorkerRegistrationReceipt&gt;{</code> |
| `createWorkerComponent` | function | 435 | <code>export function createWorkerComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/hierarchy/packages.ts

[Open source](../../services/hyperfide/src/hierarchy/packages.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SessionRole` | type | 11 | <code>export type SessionRole='LEADER'&#124;'FEATURE_MANAGER'&#124;'WORKER'&#124;'COMMIT_WATCHER'&#124;'ISSUE_WATCHER'&#124;'VERIFIER'&#124;'INTEGRATOR'&#124;'INDEXER';</code> |
| `Scope` | interface | 12 | <code>export interface Scope {organisation_id:string;run_id:string}</code> |
| `AuthorityRequest` | interface | 13 | <code>export interface AuthorityRequest extends Scope {</code> |
| `Leadership` | interface | 17 | <code>export interface Leadership extends Scope {authority_epoch:string;leader_session_id:string;leader_generation:string}</code> |
| `AuthorityView` | interface | 18 | <code>export interface AuthorityView extends Leadership {session_id:string;role:SessionRole;package_id?:string;package_generation?:string}</code> |
| `HierarchyAuthority` | interface | 19 | <code>export interface HierarchyAuthority {</code> |
| `leadership` | method | 20 | <code>leadership(tx:PrimaryTransaction,scope:Scope):Promise&lt;Leadership&gt;;</code> |
| `requireAuthority` | method | 21 | <code>requireAuthority(tx:PrimaryTransaction,input:AuthorityRequest):Promise&lt;AuthorityView&gt;;</code> |
| `requireLeaderReplacement` | method | 22 | <code>requireLeaderReplacement(tx:PrimaryTransaction,input:LeaderReplacementRequest):Promise&lt;Record&lt;string,unknown&gt;&gt;;</code> |
| `LeaderReplacementRequest` | interface | 25 | <code>export interface LeaderReplacementRequest extends Scope {</code> |
| `requireLeaderReplacement` | function | 30 | <code>export async function requireLeaderReplacement(tx:PrimaryTransaction,input:LeaderReplacementRequest):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `Data` | type | 62 | <code>type Data=Record&lt;string,unknown&gt;;</code> |
| `refuse` | function | 64 | <code>export function refuse(code:string,message:string):never {throw new FoundationError(code,message);}</code> |
| `record` | function | 65 | <code>export function record(value:unknown,keys:readonly string&#91;&#93;,required:readonly string&#91;&#93;=keys):Data {</code> |
| `text` | function | 70 | <code>export function text(value:unknown,max=255):string {</code> |
| `uuid` | function | 75 | <code>export function uuid(value:unknown):string {</code> |
| `decimal` | function | 80 | <code>export function decimal(value:unknown,zero=false):string {</code> |
| `digest` | function | 85 | <code>export function digest(value:unknown):string {</code> |
| `canonical` | function | 88 | <code>export function canonical(value:unknown,depth=0):string {</code> |
| `hash` | function | 96 | <code>export function hash(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}</code> |
| `strings` | function | 97 | <code>export function strings(value:unknown,max=256):string&#91;&#93; {</code> |
| `isGateway` | function | 101 | <code>export function isGateway(value:unknown):value is TransactionGateway{return object(value)&amp;&amp;typeof value.withPrimaryTransaction==='function';}</code> |
| `gateway` | function | 102 | <code>export function gateway(context:ComponentContext):TransactionGateway {</code> |
| `isHierarchyAuthority` | function | 105 | <code>export function isHierarchyAuthority(value:unknown):value is HierarchyAuthority {</code> |
| `leadership` | function | 108 | <code>export async function leadership(tx:PrimaryTransaction,scope:Scope):Promise&lt;Leadership&gt; {</code> |
| `requireAuthority` | function | 114 | <code>export async function requireAuthority(tx:PrimaryTransaction,input:AuthorityRequest):Promise&lt;AuthorityView&gt; {</code> |
| `TrustedActor` | interface | 146 | <code>export interface TrustedActor extends Scope {session_id:string;authority_epoch:string;guard:(tx:PrimaryTransaction)=&gt;Promise&lt;void&gt;;signal:AbortSignal;invocation:InvocationContext}</code> |
| `trustedActor` | function | 147 | <code>export function trustedActor(context:ComponentContext):TrustedActor {</code> |
| `provenReady` | variable | 155 | <code>const provenReady=new WeakSet&lt;object&gt;();</code> |
| `ready` | function | 157 | <code>export async function ready(tx:PrimaryTransaction):Promise&lt;void&gt; {</code> |
| `event` | function | 166 | <code>export async function event(tx:PrimaryTransaction,actor:TrustedActor,generation:string,kind:string,payload:Data):Promise&lt;void&gt; {</code> |
| `hierarchyReadGuard` | function | 171 | <code>export function hierarchyReadGuard(actor:TrustedActor):(tx:PrimaryTransaction)=&gt;Promise&lt;void&gt; {</code> |
| `hierarchyWriteGuard` | function | 174 | <code>export function hierarchyWriteGuard(actor:TrustedActor):(tx:PrimaryTransaction)=&gt;Promise&lt;void&gt; {</code> |
| `operation` | function | 177 | <code>export async function operation&lt;T&gt;(g:TransactionGateway,actor:TrustedActor,name:string,input:Data,fn:(tx:PrimaryTransaction)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt; {</code> |
| `manager` | function | 206 | <code>async function manager(tx:PrimaryTransaction,actor:TrustedActor,id:string):Promise&lt;void&gt; {</code> |
| `packageRows` | function | 211 | <code>async function packageRows(tx:PrimaryTransaction,actor:TrustedActor,ids:string&#91;&#93;) {</code> |
| `Snapshot` | type | 236 | <code>type Snapshot={package_id:string;owner_generation:string;previous_state:string};</code> |
| `transition` | function | 238 | <code>async function transition(tx:PrimaryTransaction,actor:TrustedActor,leaderGeneration:string,packageId:string,from:string&#124;null,to:string,ownerGeneration:string,cause:string,reason:string,evidence:Data={…</code> |
| `handoffOutcome` | function | 242 | <code>async function handoffOutcome(tx:PrimaryTransaction,actor:TrustedActor,id:string):Promise&lt;string&#124;null&gt; {</code> |
| `stableComplete` | function | 246 | <code>async function stableComplete(tx:PrimaryTransaction,actor:TrustedActor,rows:Data&#91;&#93;,ids:string&#91;&#93;,code:string,message:string):Promise&lt;void&gt; {</code> |
| `restore` | function | 253 | <code>async function restore(tx:PrimaryTransaction,actor:TrustedActor,leaderGeneration:string,snapshots:Snapshot&#91;&#93;,acknowledged:boolean,cause:string,reason:string,handoffId:string):Promise&lt;Record&lt;string,str…</code> |
| `limitOf` | function | 264 | <code>function limitOf(value:unknown):number {</code> |
| `createComponent` | function | 269 | <code>export async function createComponent(context:ComponentContext):Promise&lt;Component&gt; {</code> |

## services/hyperfide/src/hierarchy/packets.ts

[Open source](../../services/hyperfide/src/hierarchy/packets.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ContinuationArtifactBinding` | interface | 17 | <code>export interface ContinuationArtifactBinding {</code> |
| `ContinuationBinding` | interface | 20 | <code>export interface ContinuationBinding {</code> |
| `ContinuationReader` | type | 26 | <code>export type ContinuationReader=(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;checkpoint_id:string},invocation:InvocationContext)=&gt;Promise&lt;ContinuationBinding&gt;;</code> |
| `continuationBinding` | function | 27 | <code>function continuationBinding(value:unknown,checkpointId:string):ContinuationBinding {</code> |
| `ContinuationProvider` | interface | 50 | <code>interface ContinuationProvider {reader:ContinuationReader&#124;null;sealed:boolean}</code> |
| `continuationProviders` | variable | 51 | <code>const continuationProviders=new Map&lt;string,ContinuationProvider&gt;();</code> |
| `currentContinuation` | function | 52 | <code>async function currentContinuation(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;checkpoint_id:string},invocation:InvocationContext&#124;undefined){</code> |
| `packetSchema` | function | 64 | <code>async function packetSchema(tx:QuerySession):Promise&lt;void&gt;{</code> |
| `definitionField` | function | 70 | <code>function definitionField(definition:unknown,key:string):unknown{</code> |
| `resourceRequirements` | function | 78 | <code>function resourceRequirements(value:unknown):Record&lt;string,unknown&gt;{</code> |
| `manifestMetadata` | function | 89 | <code>function manifestMetadata(value:unknown){</code> |
| `preparationManifest` | function | 100 | <code>async function preparationManifest(tx:QuerySession,organisationId:string,profileId:string){</code> |
| `loadPreparationIntent` | function | 112 | <code>export async function loadPreparationIntent(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;task_id:string;profile_id?:string}){</code> |
| `GraphSnapshotCapability` | interface | 135 | <code>export interface GraphSnapshotCapability {</code> |
| `loadGraphSnapshot` | method | 136 | <code>loadGraphSnapshot(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;authority_epoch:string;manifest_id:string;expected_sources:unknown&#91;&#93;},invocation:InvocationContext):Promise&lt;Record&lt;s…</code> |
| `isGraphSnapshotCapability` | function | 138 | <code>export function isGraphSnapshotCapability(value:unknown):value is GraphSnapshotCapability {return object(value)&amp;&amp;typeof value.loadGraphSnapshot==='function';}</code> |
| `graphSnapshot` | function | 139 | <code>async function graphSnapshot(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;authority_epoch:string},manifestId:string,expected:unknown&#91;&#93;,invocation:InvocationContext&#124;undefined,reade…</code> |
| `proofObligations` | function | 149 | <code>async function proofObligations(tx:PrimaryTransaction,pins:{organisation_id:string;run_id:string;task_id:string;spec_generation:string;spec_revision_id:string}):Promise&lt;unknown&gt;{</code> |
| `assertProfileSources` | function | 154 | <code>function assertProfileSources(profile:ReturnType&lt;typeof validateProfile&gt;,repositories:Record&lt;string,unknown&gt;&#91;&#93;):void{</code> |
| `currentRepositories` | function | 160 | <code>async function currentRepositories(tx:QuerySession,org:string,run:string){</code> |
| `currentDependencies` | function | 163 | <code>async function currentDependencies(tx:QuerySession,org:string,run:string,taskId:string){</code> |
| `dependencyEvidence` | function | 171 | <code>function dependencyEvidence(rows:unknown&#91;&#93;):unknown&#91;&#93;{</code> |
| `supersededContract` | function | 174 | <code>async function supersededContract(tx:QuerySession,org:string,run:string,contract:Record&lt;string,unknown&gt;):Promise&lt;boolean&gt;{</code> |
| `contentDigest` | function | 178 | <code>function contentDigest(value:string):string{return 'sha256:'+createHash('sha256').update(value,'utf8').digest('hex');}</code> |
| `PacketAuthority` | interface | 180 | <code>export interface PacketAuthority {</code> |
| `isPacketAuthority` | function | 186 | <code>export function isPacketAuthority(value:unknown):value is PacketAuthority {</code> |
| `ExecutionPacketRecord` | interface | 190 | <code>export interface ExecutionPacketRecord {packet_id:string;digest:string;mandatory_digest:string;packet:Record&lt;string,unknown&gt;}</code> |
| `freeze` | function | 191 | <code>function freeze&lt;T&gt;(value:T):T {</code> |
| `loadExecutionPacket` | function | 195 | <code>export async function loadExecutionPacket(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;digest:string}):Promise&lt;ExecutionPacketRecord&gt;{</code> |
| `readExecutionPacket` | function | 199 | <code>export async function readExecutionPacket(tx:QuerySession,input:{organisation_id:string;run_id:string;digest:string}):Promise&lt;ExecutionPacketRecord&gt;{</code> |
| `validateExecutionInputs` | function | 221 | <code>export async function validateExecutionInputs(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;digest:string},invocation?:InvocationContext,graphReader?:GraphSnapshotCapability){</code> |
| `derivePreparedEnvironmentRoles` | function | 266 | <code>export function derivePreparedEnvironmentRoles(manifest:unknown,context:unknown){</code> |
| `acceptedExecutionProfile` | function | 281 | <code>function acceptedExecutionProfile(definition:unknown,profile:ReturnType&lt;typeof validateProfile&gt;){</code> |
| `deriveQualificationInputs` | function | 292 | <code>export function deriveQualificationInputs(packet:unknown):{</code> |
| `createComponent` | function | 313 | <code>export function createComponent(context:ComponentContext):Component {</code> |

## services/hyperfide/src/hierarchy/views.ts

[Open source](../../services/hyperfide/src/hierarchy/views.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Row` | type | 4 | <code>type Row=Record&lt;string,any&gt;;</code> |
| `iso` | function | 14 | <code>const iso=(value:unknown):string&#124;null=&gt;value===null&#124;&#124;value===undefined?null:new Date(value as string).toISOString();</code> |
| `intentList` | function | 15 | <code>function intentList(value:unknown):unknown&#91;&#93;{</code> |
| `mandatoryIntent` | function | 20 | <code>function mandatoryIntent(row:Row){</code> |
| `freshness` | function | 32 | <code>function freshness(e:Row):'CURRENT'&#124;'PENDING'&#124;'STALE'&#124;'MISSING'{</code> |
| `createComponent` | function | 37 | <code>export function createComponent(context:ComponentContext):Component {</code> |

## services/hyperfide/src/spec/bootstrap.ts

[Open source](../../services/hyperfide/src/spec/bootstrap.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `BootstrapMetadata` | interface | 15 | <code>export interface BootstrapMetadata {</code> |
| `fail` | function | 22 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `exact` | function | 23 | <code>function exact(value:unknown,keys:string&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `name` | function | 28 | <code>function name(value:unknown):value is string{return typeof value==='string'&amp;&amp;value.length&gt;=1&amp;&amp;value.length&lt;=255&amp;&amp;value.trim().length&gt;0&amp;&amp;!/&#91;&#92;x00-&#92;x1f&#93;/.test(value);}</code> |
| `remote` | function | 29 | <code>function remote(value:unknown):value is string{</code> |
| `validateBootstrapMetadata` | function | 34 | <code>export function validateBootstrapMetadata(value:unknown,scope:SpecScope):BootstrapMetadata{</code> |
| `verifySources` | function | 63 | <code>async function verifySources(metadata:BootstrapMetadata):Promise&lt;void&gt;{</code> |
| `metadataTransaction` | function | 89 | <code>async function metadataTransaction(client:SpecTransaction,scope:SpecScope,metadata:BootstrapMetadata):Promise&lt;void&gt;{</code> |
| `bootstrapAcceptedIntent` | function | 113 | <code>export async function bootstrapAcceptedIntent(pool:pg.Pool,scope:SpecScope,rawMetadata:unknown,input:unknown):Promise&lt;unknown&gt;{</code> |
| `BootstrapQuery` | interface | 138 | <code>export interface BootstrapQuery {query(text:string,values?:unknown&#91;&#93;):Promise&lt;{rows:Record&lt;string,any&gt;&#91;&#93;;rowCount:number&#124;null}&gt;}</code> |
| `query` | method | 138 | <code>export interface BootstrapQuery {query(text:string,values?:unknown&#91;&#93;):Promise&lt;{rows:Record&lt;string,any&gt;&#91;&#93;;rowCount:number&#124;null}&gt;}</code> |
| `AcceptedBootstrapPins` | interface | 139 | <code>export interface AcceptedBootstrapPins {organisation_id:string;run_id:string;authority_epoch:string;accepted_revision_digest:string}</code> |
| `assertAcceptedBootstrap` | function | 140 | <code>export async function assertAcceptedBootstrap(tx:BootstrapQuery,pins:AcceptedBootstrapPins):Promise&lt;{</code> |
| `bootstrapAcceptedIntentWithGateway` | function | 187 | <code>export async function bootstrapAcceptedIntentWithGateway(</code> |

## services/hyperfide/src/spec/dependencies.ts

[Open source](../../services/hyperfide/src/spec/dependencies.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Tx` | type | 10 | <code>type Tx=AuthorityTransaction;</code> |
| `DependencyScope` | interface | 11 | <code>export interface DependencyScope {organisation_id:string;run_id:string}</code> |
| `PlanPins` | interface | 12 | <code>export interface PlanPins {run_id:string;spec_revision_id:string;spec_generation:string;state_version:string}</code> |
| `DependencyDiagnostic` | interface | 13 | <code>export interface DependencyDiagnostic {code:string;run_id:string;task_key?:string;section?:string&#124;undefined;key?:string&#124;undefined;line?:number&#124;undefined;target?:string&#124;undefined;path?:string&#91;&#93;&#124;undefin…</code> |
| `AcceptedDependency` | interface | 15 | <code>export interface AcceptedDependency {</code> |
| `ProposedDependencyTask` | interface | 20 | <code>export interface ProposedDependencyTask {package_key:string;package_wave:number;id:string;task_key:string;definition:Record&lt;string,any&gt;;wave:number;state:string;state_version:string;spec_generation:st…</code> |
| `Task` | type | 21 | <code>type Task=ProposedDependencyTask;</code> |
| `Snapshot` | interface | 22 | <code>interface Snapshot {run:Record&lt;string,any&gt;;tasks:Task&#91;&#93;}</code> |
| `DependencyReport` | interface | 23 | <code>export interface DependencyReport {</code> |
| `STRUCTURAL_FIELDS` | variable | 33 | <code>const STRUCTURAL_FIELDS=new Set(&#91;'requires','touches','owner','wave','feature','status','reqs','acceptance_ids','artifacts','verify_cmd'&#93;);</code> |
| `fail` | function | 38 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `positive` | function | 39 | <code>function positive(value:unknown):value is string{return typeof value==='string'&amp;&amp;POS.test(value)&amp;&amp;BigInt(value)&lt;=9223372036854775807n;}</code> |
| `exact` | function | 40 | <code>function exact(value:unknown,keys:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `scopeInput` | function | 44 | <code>function scopeInput(scope:DependencyScope,value:unknown,keys:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `taskFields` | function | 50 | <code>function taskFields(task:Task):Record&lt;string,any&gt;{return object(task.definition.section)&amp;&amp;object(task.definition.section.fields)?task.definition.section.fields:{};}</code> |
| `feature` | function | 51 | <code>function feature(task:Task):string{return typeof task.definition.feature_key==='string'?task.definition.feature_key:'';}</code> |
| `owner` | function | 52 | <code>function owner(task:Task):string{const value=taskFields(task).owner?.value;return typeof value==='string'&amp;&amp;value?value:'feature:'+feature(task);}</code> |
| `qualified` | function | 53 | <code>function qualified(run_id:string,feature_key:string,task_key:string,repository_id?:string&#124;null):string{</code> |
| `overlaps` | function | 56 | <code>function overlaps(path:string):string&#91;&#93;{const parts=path.split('/');return parts.map((_,index)=&gt;parts.slice(0,index+1).join('/'));}</code> |
| `safeTouch` | function | 57 | <code>function safeTouch(value:unknown):boolean{</code> |
| `readySchema` | function | 61 | <code>async function readySchema(tx:Tx):Promise&lt;void&gt;{</code> |
| `snapshot` | function | 68 | <code>async function snapshot(tx:Tx,scope:DependencyScope,run_id:string,lock=false):Promise&lt;Snapshot&gt;{</code> |
| `assertPins` | function | 78 | <code>function assertPins(run:Record&lt;string,any&gt;,input:Record&lt;string,unknown&gt;):void{</code> |
| `declared` | function | 84 | <code>function declared(task:Task):unknown{return taskFields(task).requires?.value??&#91;&#93;;}</code> |
| `referenceRuns` | function | 85 | <code>function referenceRuns(tasks:Task&#91;&#93;,organisation_id:string):string&#91;&#93;{</code> |
| `validateGraph` | function | 93 | <code>async function validateGraph(tx:Tx,scope:DependencyScope,input:PlanPins,proposed?:Task&#91;&#93;):Promise&lt;DependencyReport&gt;{</code> |
| `validateProposedDependencies` | function | 313 | <code>export async function validateProposedDependencies(tx:Tx,scope:DependencyScope,input:PlanPins,tasks:ProposedDependencyTask&#91;&#93;):Promise&lt;DependencyReport&gt;{</code> |
| `validateDependencies` | function | 316 | <code>export async function validateDependencies(tx:Tx,scope:DependencyScope,input:PlanPins):Promise&lt;DependencyReport&gt;{</code> |
| `AdmissionOptions` | interface | 324 | <code>export interface AdmissionOptions {exempt_task_ids?:readonly string&#91;&#93;}</code> |
| `admitDependencies` | function | 325 | <code>export async function admitDependencies(tx:Tx,scope:DependencyScope,input:PlanPins,options:AdmissionOptions={}):Promise&lt;Omit&lt;DependencyReport,'edges'&gt;&amp;{admitted:boolean;proof_obligations:'ENFORCED_AT_…</code> |
| `resolveTask` | function | 341 | <code>export async function resolveTask(tx:Tx,scope:DependencyScope,input:unknown):Promise&lt;unknown&gt;{</code> |
| `structuralFrontier` | function | 350 | <code>export async function structuralFrontier(tx:Tx,scope:DependencyScope,input:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 363 | <code>export function createComponent(_startup:ComponentContext):Component{</code> |

## services/hyperfide/src/spec/import.ts

[Open source](../../services/hyperfide/src/spec/import.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `KvxField` | interface | 13 | <code>export interface KvxField {key:string;raw:string;value:unknown;line:number}</code> |
| `KvxSection` | interface | 14 | <code>export interface KvxSection {name:string;line:number;fields:Record&lt;string,KvxField&gt;}</code> |
| `KvxDocument` | interface | 15 | <code>export interface KvxDocument {sections:KvxSection&#91;&#93;;counts:{sections:number;fields:number;tasks:number;requirements:number;criteria:number;acceptances:number}}</code> |
| `RepositoryPin` | interface | 16 | <code>export interface RepositoryPin {repository_id:string;source_object_id:string;integration_ref:string}</code> |
| `ImportEnvelope` | interface | 17 | <code>export interface ImportEnvelope {</code> |
| `SpecScope` | interface | 22 | <code>export interface SpecScope {organisation_id:string;project_id:string;run_id:string;authority_epoch:string;root:string;allowed_actions:readonly string&#91;&#93;}</code> |
| `fail` | function | 28 | <code>function fail(code:string,message:string):never {throw new FoundationError(code,message);}</code> |
| `fields` | function | 29 | <code>function fields(input:unknown,names:string&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `id` | function | 34 | <code>function id(value:unknown):value is string {return typeof value==='string'&amp;&amp;UUID.test(value);}</code> |
| `validIntegrationRef` | function | 35 | <code>export function validIntegrationRef(value:unknown):value is string {</code> |
| `strings` | function | 40 | <code>function strings(value:unknown,max=128):value is string&#91;&#93; {</code> |
| `canonical` | function | 43 | <code>export function canonical(value:unknown):string{</code> |
| `digest` | function | 48 | <code>export const digest=(value:string&#124;Buffer):string=&gt;'sha256:'+createHash('sha256').update(value).digest('hex');</code> |
| `derivedId` | function | 49 | <code>export function derivedId(value:string):string{</code> |
| `stripComment` | function | 54 | <code>function stripComment(line:string):string {</code> |
| `safeNumbers` | function | 65 | <code>function safeNumbers(value:unknown):void{</code> |
| `parseKvx` | function | 71 | <code>export function parseKvx(source:string):KvxDocument {</code> |
| `specScope` | function | 101 | <code>export function specScope(context:ComponentContext):SpecScope{</code> |
| `validateImport` | function | 109 | <code>export function validateImport(value:unknown,scope:SpecScope):ImportEnvelope{</code> |
| `readPinnedSource` | function | 140 | <code>export async function readPinnedSource(root:string,source:ImportEnvelope&#91;'source'&#93;):Promise&lt;{bytes:Buffer;text:string}&gt;{</code> |
| `StoredIntent` | interface | 175 | <code>export interface StoredIntent {</code> |
| `value` | function | 179 | <code>function value(section:KvxSection,key:string):unknown{return section.fields&#91;key&#93;?.value;}</code> |
| `taskDefinitions` | function | 180 | <code>export function taskDefinitions(parsed:KvxDocument):{section:KvxSection;key:string;feature_key:string;declared_wave:unknown;wave:number;package_key:string}&#91;&#93;{</code> |
| `SpecTransaction` | interface | 196 | <code>export interface SpecTransaction {query&lt;Row extends pg.QueryResultRow = pg.QueryResultRow&gt;(text:string,values?:unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;Row&gt;&gt;}</code> |
| `query` | method | 196 | <code>export interface SpecTransaction {query&lt;Row extends pg.QueryResultRow = pg.QueryResultRow&gt;(text:string,values?:unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;Row&gt;&gt;}</code> |
| `primary` | function | 197 | <code>async function primary(client:SpecTransaction):Promise&lt;void&gt;{</code> |
| `storageFailure` | function | 201 | <code>function storageFailure(error:unknown):never{</code> |
| `PinnedRun` | interface | 205 | <code>export interface PinnedRun {id:string;spec_revision_id:string;spec_generation:string;state_version:string;state:string;source_content:string;source_digest:string;document:StoredIntent}</code> |
| `loadPinnedRun` | function | 206 | <code>export async function loadPinnedRun(client:SpecTransaction,scope:SpecScope):Promise&lt;PinnedRun&gt;{</code> |
| `summary` | function | 213 | <code>function summary(run:PinnedRun):unknown{</code> |
| `prepareAcceptedIntent` | function | 218 | <code>export async function prepareAcceptedIntent(scope:SpecScope,raw:unknown,rawSource?:Buffer){</code> |
| `importRunTransaction` | function | 231 | <code>export async function importRunTransaction(client:SpecTransaction,scope:SpecScope,raw:unknown):Promise&lt;unknown&gt;{</code> |
| `importRun` | function | 281 | <code>export async function importRun(pool:pg.Pool,scope:SpecScope,raw:unknown):Promise&lt;unknown&gt;{</code> |
| `scoped` | function | 294 | <code>function scoped(input:unknown,scope:SpecScope,names:string&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `current` | function | 297 | <code>function current(run:PinnedRun,input:Record&lt;string,unknown&gt;):void{</code> |
| `exportProjection` | function | 301 | <code>export async function exportProjection(pool:SpecTransaction,scope:SpecScope,input:unknown):Promise&lt;unknown&gt;{</code> |
| `specTransaction` | function | 324 | <code>export async function specTransaction&lt;T&gt;(context:ComponentContext,mode:'READ'&#124;'WRITE',body:(tx:AuthorityTransaction,invocation:InvocationContext)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `authenticatedScope` | function | 332 | <code>async function authenticatedScope(tx:AuthorityTransaction,context:ComponentContext,i:InvocationContext):Promise&lt;SpecScope&gt;{</code> |
| `createComponent` | function | 338 | <code>export function createComponent(_startup:ComponentContext):Component{</code> |

## services/hyperfide/src/spec/obligations.ts

[Open source](../../services/hyperfide/src/spec/obligations.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ProofPins` | interface | 11 | <code>export interface ProofPins {organisation_id:string;run_id:string;task_id:string;spec_generation:string;spec_revision_id:string}</code> |
| `ProofCheck` | interface | 12 | <code>export interface ProofCheck {id:string;argv:string&#91;&#93;;executable_digest:string;timeout_ms:number;required_artifacts:string&#91;&#93;;input_keys:string&#91;&#93;}</code> |
| `ProofClause` | interface | 13 | <code>export interface ProofClause {id:string;mode:'EXECUTABLE'&#124;'REVIEW';acceptance_ids:string&#91;&#93;;checks?:string&#91;&#93;;reviewers?:string&#91;&#93;;rubric_digest?:string}</code> |
| `ProofPolicy` | interface | 18 | <code>export interface ProofPolicy {</code> |
| `ProofObligations` | interface | 22 | <code>export interface ProofObligations {</code> |
| `PrimaryClient` | type | 26 | <code>export type PrimaryClient=AuthorityTransaction;</code> |
| `fail` | function | 33 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `exact` | function | 34 | <code>function exact(value:unknown,keys:string&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `strings` | function | 39 | <code>function strings(value:unknown,pattern:RegExp,empty=false,max=128):value is string&#91;&#93;{</code> |
| `safeArtifact` | function | 42 | <code>function safeArtifact(value:string):boolean{</code> |
| `pins` | function | 46 | <code>function pins(value:ProofPins):void{</code> |
| `validateProofPolicy` | function | 51 | <code>export function validateProofPolicy(value:unknown):ProofPolicy{</code> |
| `obligations` | function | 93 | <code>function obligations(policy:ProofPolicy,registry_digest:string):ProofObligations{</code> |
| `loadProofObligations` | function | 98 | <code>export async function loadProofObligations(db:PrimaryClient,scope:ProofPins):Promise&lt;ProofObligations&gt;{</code> |
| `clauseCoverage` | function | 120 | <code>function clauseCoverage(policy:ProofPolicy,definition:unknown,intent:StoredIntent):void{</code> |
| `acceptedProofAuthority` | function | 156 | <code>async function acceptedProofAuthority(policy:ProofPolicy,definition:unknown,intent:StoredIntent):Promise&lt;void&gt;{</code> |
| `operatingMaximum` | function | 206 | <code>function operatingMaximum(context:ComponentContext):number{</code> |
| `registerProofPolicy` | function | 212 | <code>export async function registerProofPolicy(client:PrimaryClient,scope:{organisation_id:string;run_id:string},input:unknown,allowReview=false,maximumMs=259200000):Promise&lt;ProofObligations&gt;{</code> |
| `createComponent` | function | 251 | <code>export function createComponent(_startup:ComponentContext):Component{</code> |

## services/hyperfide/src/spec/revisions.ts

[Open source](../../services/hyperfide/src/spec/revisions.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Tx` | type | 12 | <code>type Tx=AuthorityTransaction;</code> |
| `Prepared` | type | 13 | <code>type Prepared=Awaited&lt;ReturnType&lt;typeof prepareAcceptedIntent&gt;&gt;;</code> |
| `AmendmentRequest` | interface | 14 | <code>export interface AmendmentRequest {</code> |
| `ActiveTaskImpact` | interface | 21 | <code>export interface ActiveTaskImpact {</code> |
| `AmendmentImpact` | interface | 25 | <code>export interface AmendmentImpact {</code> |
| `AmendmentAnalysis` | interface | 30 | <code>export interface AmendmentAnalysis {</code> |
| `InternalAnalysis` | interface | 35 | <code>interface InternalAnalysis {result:AmendmentAnalysis;prepared:Prepared;request:AmendmentRequest;tasks:ProposedDependencyTask&#91;&#93;;prior:Record&lt;string,any&gt;;</code> |
| `fail` | function | 41 | <code>function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `requestOf` | function | 42 | <code>function requestOf(input:unknown,scope:SpecScope):AmendmentRequest{</code> |
| `semantic` | function | 52 | <code>function semantic(section:KvxSection):unknown{</code> |
| `globals` | function | 55 | <code>function globals(document:StoredIntent):unknown{</code> |
| `ids` | function | 58 | <code>function ids(section:KvxSection&#124;undefined,key:string):string&#91;&#93;{</code> |
| `criteriaIntent` | function | 65 | <code>function criteriaIntent(document:StoredIntent,section:KvxSection&#124;undefined):string{</code> |
| `analyse` | function | 74 | <code>async function analyse(tx:Tx,scope:SpecScope,input:unknown,storedSource?:Buffer):Promise&lt;InternalAnalysis&gt;{</code> |
| `validateSpecAmendment` | function | 185 | <code>export async function validateSpecAmendment(tx:Tx,scope:SpecScope,input:unknown):Promise&lt;AmendmentAnalysis&gt;{</code> |
| `bounded` | function | 188 | <code>function bounded(result:AmendmentAnalysis):unknown{</code> |
| `scopeOf` | function | 196 | <code>async function scopeOf(tx:Tx,context:ComponentContext,invocation:InvocationContext):Promise&lt;SpecScope&gt;{</code> |
| `actorOf` | function | 201 | <code>function actorOf(invocation:InvocationContext):{actor_id:string;role:string;credential_id:string}{</code> |
| `decide` | function | 204 | <code>async function decide(tx:Tx,scope:SpecScope,amendment_id:string,record:Record&lt;string,unknown&gt;):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `record` | function | 211 | <code>async function record(tx:Tx,scope:SpecScope,invocation:InvocationContext,analysis:InternalAnalysis):Promise&lt;unknown&gt;{</code> |
| `AdmitRequest` | interface | 228 | <code>interface AdmitRequest {run_id:string;amendment_id:string;proposal_digest:string;revalidate_task_ids:string&#91;&#93;;justification:string;proof_policies:{task_key:string;policy:unknown}&#91;&#93;}</code> |
| `admitRequestOf` | function | 229 | <code>function admitRequestOf(input:unknown,scope:SpecScope):AdmitRequest{</code> |
| `ValidityCapability` | interface | 241 | <code>interface ValidityCapability {invalidateAcceptedSpec(db:Tx,scope:{organisation_id:string;run_id:string},taskIds:string&#91;&#93;,reason:string):Promise&lt;number&gt;}</code> |
| `invalidateAcceptedSpec` | method | 241 | <code>interface ValidityCapability {invalidateAcceptedSpec(db:Tx,scope:{organisation_id:string;run_id:string},taskIds:string&#91;&#93;,reason:string):Promise&lt;number&gt;}</code> |
| `isValidity` | function | 242 | <code>const isValidity=(value:unknown):value is ValidityCapability=&gt;object(value)&amp;&amp;typeof value.invalidateAcceptedSpec==='function';</code> |
| `proofDeadline` | function | 243 | <code>function proofDeadline(context:ComponentContext):number{</code> |
| `admit` | function | 252 | <code>async function admit(tx:Tx,context:ComponentContext,invocation:InvocationContext,scope:SpecScope,input:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 351 | <code>export function createComponent(_startup:ComponentContext):Component{</code> |
