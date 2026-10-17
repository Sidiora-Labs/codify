# Source reference: Control services: integration and review

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the `assurance/`, `decisions/`, `evaluation/`, `findings/`, `integration/` and `review/` subtrees of `services/hyperfide/src/`: 655 declarations in 31 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## services/hyperfide/src/assurance/coverage.ts

[Open source](../../services/hyperfide/src/assurance/coverage.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Queryable` | type | 7 | <code>export type Queryable=PrimaryClient;</code> |
| `CoverageScope` | interface | 8 | <code>export interface CoverageScope{organisation_id:string;run_id:string}</code> |
| `inspectCoverage` | function | 10 | <code>export async function inspectCoverage(db:Queryable,s:CoverageScope,custodyId:string):Promise&lt;Data&gt;{</code> |
| `inspect` | function | 127 | <code>async function inspect(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `judgement` | function | 131 | <code>async function judgement(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `accept` | function | 172 | <code>async function accept(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `createComponent` | function | 205 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/assurance/executor.ts

[Open source](../../services/hyperfide/src/assurance/executor.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `identity` | function | 9 | <code>function identity(ctx:ComponentContext):Data{</code> |
| `jobResources` | function | 14 | <code>function jobResources(ctx:ComponentContext):Data{</code> |
| `verifyEnvironment` | function | 19 | <code>async function verifyEnvironment(ctx:ComponentContext,tx:unknown,job:Data,owner:Data):Promise&lt;Data&gt;{</code> |
| `lockJob` | function | 57 | <code>async function lockJob(client:Parameters&lt;Parameters&lt;typeof transaction&gt;&#91;1&#93;&gt;&#91;0&#93;,s:&#91;string,string&#93;,id:string):Promise&lt;Data&gt;{</code> |
| `activeJob` | function | 64 | <code>function activeJob(job:Data,owner:Data,generation:string):void{</code> |
| `assignJob` | function | 68 | <code>async function assignJob(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `claimJob` | function | 110 | <code>export async function claimJob(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `bytesHash` | function | 139 | <code>function bytesHash(bytes:Buffer):string{return 'sha256:'+requireHash(bytes);}</code> |
| `requireHash` | function | 141 | <code>function requireHash(bytes:Buffer):string{return createHash('sha256').update(bytes).digest('hex');}</code> |
| `remoteExecutor` | function | 142 | <code>function remoteExecutor(ctx:ComponentContext):Data{</code> |
| `remoteBytes` | function | 150 | <code>function remoteBytes(value:Data):Buffer{</code> |
| `renewAllocation` | function | 158 | <code>async function renewAllocation(ctx:ComponentContext,db:unknown,s:&#91;string,string&#93;,owner:Data):Promise&lt;Data&gt;{</code> |
| `renewJob` | function | 166 | <code>async function renewJob(ctx:ComponentContext,s:&#91;string,string&#93;,id:string,generation:string,owner:Data):Promise&lt;void&gt;{</code> |
| `assertRemoteBinding` | function | 175 | <code>export function assertRemoteBinding(raw:Data,expected:{plan:Data;observed:Data;check:Data;snapshot:Data;sandbox_id:string;scope:&#91;string,string&#93;}):void{</code> |
| `commandRecord` | function | 191 | <code>export function commandRecord(check:Data,plan:Data,observed:Data,raw:Data):Data{</code> |
| `judgeCheck` | function | 197 | <code>export function judgeCheck(raw:Data,requiredArtifacts:readonly string&#91;&#93;,files:readonly Data&#91;&#93;):{outcome:'PASS'&#124;'FAIL';reasons:string&#91;&#93;}{</code> |
| `qualificationOutcome` | function | 215 | <code>export function qualificationOutcome(required:readonly string&#91;&#93;,results:readonly Data&#91;&#93;,sourceObjectId:string):{outcome:'PASS'&#124;'FAIL';unmet:Data&#91;&#93;}{</code> |
| `assertSnapshotCurrent` | function | 232 | <code>export function assertSnapshotCurrent(admitted:{policy:unknown;inputs:unknown},current:{policy:unknown;inputs:unknown}):void{</code> |
| `runRegisteredChecks` | function | 237 | <code>export async function runRegisteredChecks(ctx:ComponentContext,job:Data,snapshot:Data):Promise&lt;Data&gt;{</code> |
| `execute` | function | 310 | <code>async function execute(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `verifyStoredReceiptArtifacts` | function | 371 | <code>export async function verifyStoredReceiptArtifacts(ctx:ComponentContext,s:&#91;string,string&#93;,receipt:Data):Promise&lt;void&gt;{</code> |
| `verifyReceiptRecordArtifacts` | function | 385 | <code>export async function verifyReceiptRecordArtifacts(ctx:ComponentContext,s:&#91;string,string&#93;,record:Data):Promise&lt;void&gt;{</code> |
| `inspectExecutionReceipt` | function | 393 | <code>export async function inspectExecutionReceipt(db:PrimaryClient,</code> |
| `inspectExecution` | function | 417 | <code>export async function inspectExecution(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `classifyLegacyClaim` | function | 424 | <code>export function classifyLegacyClaim(claim:unknown):Data{</code> |
| `importHistory` | function | 441 | <code>async function importHistory(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `inspectQualificationHistory` | function | 452 | <code>export async function inspectQualificationHistory(db:PrimaryClient,s:{organisation_id:string;run_id:string},taskId:string):Promise&lt;Data&gt;{</code> |
| `inspectHistory` | function | 472 | <code>async function inspectHistory(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `createComponent` | function | 477 | <code>export function createComponent(ctx:ComponentContext):Component &amp; {capabilities:Record&lt;string,unknown&gt;}{</code> |

## services/hyperfide/src/assurance/preparation.ts

[Open source](../../services/hyperfide/src/assurance/preparation.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ResultPreparationContext` | interface | 15 | <code>export interface ResultPreparationContext {</code> |
| `effectiveResultProjection` | function | 24 | <code>export function effectiveResultProjection(result:Data):EffectiveResultSource {</code> |
| `loadResultPreparationContext` | function | 33 | <code>export async function loadResultPreparationContext(tx:PrimaryTransaction,</code> |
| `rederiveResultProfile` | function | 86 | <code>export function rederiveResultProfile(context:ResultPreparationContext,</code> |
| `inspectEffectiveResultInputs` | function | 103 | <code>export async function inspectEffectiveResultInputs(tx:PrimaryClient,</code> |
| `registerQualificationInputReader` | function | 171 | <code>export function registerQualificationInputReader(ctx:ComponentContext):()=&gt;void {</code> |
| `buildResultPreparationControl` | function | 250 | <code>export async function buildResultPreparationControl(context:ResultPreparationContext,</code> |
| `retainResultPreparationControls` | function | 271 | <code>export async function retainResultPreparationControls(ctx:ComponentContext,context:ResultPreparationContext,</code> |
| `resultProfileId` | function | 288 | <code>function resultProfileId(scope:&#91;string,string&#93;,job_id:string,request_id:string):string {</code> |
| `recordedPlan` | function | 293 | <code>function recordedPlan(row:Data,replayed:boolean):Data {</code> |
| `planResultPreparation` | function | 299 | <code>export async function planResultPreparation(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt; {</code> |
| `inspectResultPreparation` | function | 386 | <code>export async function inspectResultPreparation(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt; {</code> |
| `inspectResultPreparationIntent` | function | 399 | <code>export async function inspectResultPreparationIntent(tx:PrimaryClient,</code> |
| `qualificationPreparationAuthorityReader` | function | 429 | <code>export function qualificationPreparationAuthorityReader(ctx:ComponentContext) {</code> |

## services/hyperfide/src/assurance/submission.ts

[Open source](../../services/hyperfide/src/assurance/submission.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Data` | type | 10 | <code>export type Data=Record&lt;string,any&gt;;</code> |
| `fail` | function | 12 | <code>export function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `canonical` | function | 13 | <code>export function canonical(value:unknown):string {</code> |
| `hash` | function | 18 | <code>export function hash(value:unknown):string{return 'sha256:'+createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');}</code> |
| `fields` | function | 19 | <code>export function fields(input:unknown,required:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):Data{</code> |
| `uuid` | function | 24 | <code>export function uuid(value:unknown):string{</code> |
| `decimal` | function | 28 | <code>export function decimal(value:unknown):string{</code> |
| `digest` | function | 32 | <code>export function digest(value:unknown):string{</code> |
| `invocation` | function | 35 | <code>export function invocation(ctx:ComponentContext):Data{</code> |
| `roles` | function | 40 | <code>export function roles(ctx:ComponentContext,allowed:string&#91;&#93;):Data{</code> |
| `scope` | function | 45 | <code>export function scope(ctx:ComponentContext,input:Data):&#91;string,string&#93;{</code> |
| `PrimaryClient` | interface | 52 | <code>export interface PrimaryClient {query&lt;R extends pg.QueryResultRow=any&gt;(text:string,values?:readonly unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;R&gt;&gt;}</code> |
| `query` | method | 52 | <code>export interface PrimaryClient {query&lt;R extends pg.QueryResultRow=any&gt;(text:string,values?:readonly unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;R&gt;&gt;}</code> |
| `assuranceBarrier` | function | 53 | <code>export async function assuranceBarrier(db:PrimaryClient,s:{organisation_id:string;run_id:string},mode:'SHARED'&#124;'EXCLUSIVE'):Promise&lt;void&gt;{</code> |
| `transaction` | function | 64 | <code>export async function transaction&lt;T&gt;(ctx:ComponentContext,operation:(client:PrimaryClient)=&gt;Promise&lt;T&gt;,identityOnly=false,mode:'READ'&#124;'WRITE'='WRITE'):Promise&lt;T&gt;{</code> |
| `executionGate` | function | 78 | <code>export async function executionGate(ctx:ComponentContext,db:PrimaryClient,s:&#91;string,string&#93;,operation:'ADMISSION'&#124;'RENEWAL'&#124;'ADVANCE'&#124;'CLEANUP',options:Data={}):Promise&lt;void&gt;{</code> |
| `taskLock` | function | 84 | <code>export async function taskLock(client:PrimaryClient,s:&#91;string,string&#93;,taskId:string):Promise&lt;Data&gt;{</code> |
| `loadPolicy` | function | 91 | <code>export async function loadPolicy(ctx:ComponentContext,task:Data,client:PrimaryClient):Promise&lt;Data&gt;{</code> |
| `artifact` | function | 139 | <code>export async function artifact(ctx:ComponentContext,action:string,input:Data):Promise&lt;Data&gt;{</code> |
| `completeArtifact` | function | 150 | <code>export async function completeArtifact(ctx:ComponentContext,s:&#91;string,string&#93;,id:string):Promise&lt;Data&gt;{</code> |
| `custodyLock` | function | 158 | <code>export async function custodyLock(client:PrimaryClient,s:&#91;string,string&#93;,id:string):Promise&lt;Data&gt;{</code> |
| `currentCustody` | function | 165 | <code>export function currentCustody(c:Data,generation:string,version?:string):void{</code> |
| `loadPacketInputs` | function | 170 | <code>export async function loadPacketInputs(db:PrimaryClient,s:&#91;string,string&#93;,packetDigest:string):Promise&lt;Data&gt;{</code> |
| `resultInputs` | function | 182 | <code>export function resultInputs(facts:Data,sourceManifestDigest:string,derived:Data):Data{</code> |
| `acceptedSourceScope` | function | 188 | <code>function acceptedSourceScope(definition:unknown):string&#91;&#93;{</code> |
| `ownedSourcePath` | function | 199 | <code>function ownedSourcePath(file:string,scopes:string&#91;&#93;):boolean{</code> |
| `submittedGitFacts` | function | 210 | <code>export async function submittedGitFacts(ctx:ComponentContext,v:Data,policy:Data,workspace:Data,ownedScope:string&#91;&#93;):Promise&lt;Data&gt;{</code> |
| `STALE_COMPUTE_CODES` | variable | 238 | <code>const STALE_COMPUTE_CODES=new Set(&#91;'STALE_COMPUTE','COMPUTE_LEASE_EXPIRED','STALE_SANDBOX_BOOT','STALE_AUTHORITY_EPOCH','COMPUTE_ALLOCATION_INVALID','ACTIVE_SUBMISSION_CUSTODY'&#93;);</code> |
| `submit` | function | 239 | <code>async function submit(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `revoke` | function | 359 | <code>async function revoke(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `revokeCustodies` | function | 372 | <code>export async function revokeCustodies(db:PrimaryClient,s:{organisation_id:string;run_id:string},submissionIds:string&#91;&#93;,</code> |
| `fenceQualificationJobs` | function | 392 | <code>export async function fenceQualificationJobs(db:PrimaryClient,s:{organisation_id:string;run_id:string},</code> |
| `inspectSubmittedResult` | function | 408 | <code>export async function inspectSubmittedResult(db:PrimaryClient,scopeValue:{organisation_id:string;run_id:string},</code> |
| `rawDigest` | function | 432 | <code>export function rawDigest(bytes:Uint8Array):string{return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}</code> |
| `retainArtifactBytes` | function | 433 | <code>export async function retainArtifactBytes(ctx:ComponentContext,s:&#91;string,string&#93;,bytes:Buffer):Promise&lt;Data&gt;{</code> |
| `createComponent` | function | 449 | <code>export function createComponent(ctx:ComponentContext):Component &amp; {capabilities:Record&lt;string,unknown&gt;}{</code> |

## services/hyperfide/src/assurance/validity.ts

[Open source](../../services/hyperfide/src/assurance/validity.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `invalidateAcceptedSpec` | function | 11 | <code>export async function invalidateAcceptedSpec(db:Queryable,s:CoverageScope,taskIds:string&#91;&#93;,reason:string):Promise&lt;number&gt;{</code> |
| `evidenceReuse` | function | 26 | <code>function evidenceReuse(checks:Data&#91;&#93;,changed:string&#91;&#93;):Data&#91;&#93;{</code> |
| `publication` | function | 34 | <code>async function publication(db:Queryable,s:CoverageScope,custody:Data):Promise&lt;Data&gt;{</code> |
| `inspectValidity` | function | 44 | <code>export async function inspectValidity(db:PrimaryClient,s:CoverageScope,id:string):Promise&lt;Data&gt;{</code> |
| `inspect` | function | 60 | <code>async function inspect(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `freshContext` | function | 64 | <code>async function freshContext(ctx:ComponentContext,db:PrimaryClient,s:&#91;string,string&#93;,c:Data,saved:Data,v:Data):Promise&lt;Data&gt;{</code> |
| `invalidate` | function | 99 | <code>async function invalidate(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `acceptRequalification` | function | 187 | <code>async function acceptRequalification(ctx:ComponentContext,raw:unknown):Promise&lt;Data&gt;{</code> |
| `createComponent` | function | 257 | <code>export function createComponent(ctx:ComponentContext):Component &amp; {capabilities:Record&lt;string,unknown&gt;}{</code> |

## services/hyperfide/src/decisions/adapters.ts

[Open source](../../services/hyperfide/src/decisions/adapters.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `DecisionError` | class | 5 | <code>export class DecisionError extends FoundationError {</code> |
| `constructor` | method | 6 | <code>constructor(code: string, message: string, readonly retryable = false, readonly retryAfterMs: number &#124; null = null) {</code> |
| `fail` | function | 10 | <code>export const fail = (code: string, message: string): never =&gt; { throw new DecisionError(code, message); };</code> |
| `record` | function | 11 | <code>export function record(value: unknown, label: string): Record&lt;string, unknown&gt; {</code> |
| `exact` | function | 15 | <code>export function exact(value: Record&lt;string, unknown&gt;, allowed: string&#91;&#93;, required: string&#91;&#93; = &#91;&#93;): void {</code> |
| `text` | function | 19 | <code>export function text(value: unknown, label: string, limit = 4096): string {</code> |
| `integer` | function | 24 | <code>export function integer(value: unknown, label: string, min: number, max: number): number {</code> |
| `strictJson` | function | 30 | <code>export function strictJson(input: string, maxBytes = 8 &#42; 1024 &#42; 1024): unknown {</code> |
| `canonical` | function | 88 | <code>export function canonical(value: unknown): string {</code> |
| `freezeDeep` | function | 99 | <code>function freezeDeep&lt;T&gt;(value:T):T {</code> |
| `hash` | function | 103 | <code>export const hash = (value: unknown): string =&gt; 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex');</code> |
| `QuestionType` | type | 104 | <code>export type QuestionType = 'noul' &#124; 'choice' &#124; 'score' &#124; 'number' &#124; 'box';</code> |
| `Question` | interface | 105 | <code>export interface Question { type: QuestionType; instructions: unknown; criteria?: unknown }</code> |
| `DecisionRequest` | interface | 106 | <code>export interface DecisionRequest { state: unknown; questions: Record&lt;string, Question&gt; }</code> |
| `RouteId` | type | 107 | <code>export type RouteId = 'span-native' &#124; 'jev-native' &#124; 'ultra-native' &#124; 'span-openrouter' &#124; 'jev-openrouter' &#124; 'ultra-openrouter' &#124; 'span-selfhost';</code> |
| `RouteProfile` | interface | 108 | <code>export interface RouteProfile {</code> |
| `route` | function | 127 | <code>export function route(id: unknown): RouteProfile {</code> |
| `validateRequest` | function | 132 | <code>export function validateRequest(input: unknown, profile: RouteProfile, enabled: readonly QuestionType&#91;&#93; = &#91;&#93;, gatewayMedia = false): DecisionRequest {</code> |
| `PreparedRequest` | interface | 163 | <code>export interface PreparedRequest { route: RouteProfile; body: Record&lt;string,unknown&gt;; headers: Record&lt;string,string&gt;; request_hash:string; source_request:DecisionRequest }</code> |
| `prepared` | variable | 164 | <code>const prepared = new WeakSet&lt;object&gt;();</code> |
| `prepare` | function | 165 | <code>export function prepare(id: unknown, input: unknown, extensions: {gateway_media?:true;types?:readonly QuestionType&#91;&#93;;body?:Record&lt;string,unknown&gt;;headers?:Record&lt;string,string&gt;} = {}): PreparedRequest…</code> |
| `TransportProfile` | interface | 176 | <code>interface TransportProfile { enabled:boolean;mode:'live'&#124;'fixture';qualification_ref:string;credential_env:string;endpoint:string;max_body_bytes:number;returned_models:string&#91;&#93; }</code> |
| `configuredTransport` | function | 177 | <code>export function configuredTransport(profile:RouteProfile,env:Readonly&lt;NodeJS.ProcessEnv&gt;):TransportProfile {</code> |
| `TransportResult` | interface | 196 | <code>export interface TransportResult { route_id:RouteId;requested_model:string;returned_model:string;response:Record&lt;string,unknown&gt;;request_hash:string;response_hash:string;duration_ms:number;qualificati…</code> |
| `invokePrepared` | function | 197 | <code>export async function invokePrepared(request:PreparedRequest,env:Readonly&lt;NodeJS.ProcessEnv&gt;,options:{timeout_ms:number;signal?:AbortSignal}):Promise&lt;TransportResult&gt; {</code> |
| `legacyEndpoint` | function | 250 | <code>function legacyEndpoint(value:string&#124;undefined):string&#124;null {</code> |
| `legacyConfiguration` | function | 254 | <code>export function legacyConfiguration(env:Readonly&lt;NodeJS.ProcessEnv&gt;):unknown {</code> |
| `createComponent` | function | 259 | <code>export function createComponent(ctx:ComponentContext):unknown {</code> |

## services/hyperfide/src/decisions/audit.ts

[Open source](../../services/hyperfide/src/decisions/audit.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Data` | type | 7 | <code>export type Data=Record&lt;string,unknown&gt;;</code> |
| `Scope` | interface | 8 | <code>export interface Scope {organisation_id:string;run_id:string}</code> |
| `Revision` | interface | 9 | <code>export interface Revision {spec_revision_id:string;spec_generation:string;state_version:string;authority_epoch:string;policy_digest:string;repositories:Data&#91;&#93;;graph_channels:Data&#91;&#93;;contract_revisions:…</code> |
| `Packet` | interface | 10 | <code>export interface Packet {schema_version:1;id:string;purpose:string;packet_hash:string;revision:RevisionVector;state:Data;created_at:string;expires_at:string;authority:'NONE'}</code> |
| `fail` | function | 12 | <code>export function fail(code:string,message:string):never {throw new FoundationError(code,message)}</code> |
| `obj` | function | 13 | <code>export function obj(value:unknown,label='object'):Data {</code> |
| `exact` | function | 17 | <code>export function exact(value:unknown,keys:string&#91;&#93;,required=keys):Data{</code> |
| `str` | function | 20 | <code>export function str(value:unknown,label='string',max=4096):string{</code> |
| `uuid` | function | 23 | <code>export function uuid(value:unknown):string{</code> |
| `list` | function | 26 | <code>export function list(value:unknown,max=128):unknown&#91;&#93;{</code> |
| `canonical` | function | 29 | <code>export function canonical(value:unknown):string {</code> |
| `digest` | function | 35 | <code>export function digest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex')}</code> |
| `safe` | function | 36 | <code>export function safe(value:unknown,max=524288):void{</code> |
| `scope` | function | 47 | <code>export function scope(value:unknown):Scope{</code> |
| `Invocation` | interface | 50 | <code>export interface Invocation {operation:unknown;payload:{action:string;run_id:string};principal:{organisation_id:string;run_id:string;allowed_actions:string&#91;&#93;};signal:AbortSignal;guard(tx:QuerySession)…</code> |
| `guard` | method | 50 | <code>export interface Invocation {operation:unknown;payload:{action:string;run_id:string};principal:{organisation_id:string;run_id:string;allowed_actions:string&#91;&#93;};signal:AbortSignal;guard(tx:QuerySession)…</code> |
| `semanticDisposition` | function | 51 | <code>async function semanticDisposition(client:QuerySession,s:Scope,mode:'READ'&#124;'WRITE'):Promise&lt;void&gt;{</code> |
| `READ_ACTIONS` | variable | 59 | <code>const READ_ACTIONS=new Set(&#91;'decision.audit.inspect','decision.spec.flags'&#93;);</code> |
| `withAuthority` | function | 60 | <code>export async function withAuthority&lt;T&gt;(ctx:ComponentContext,s:Scope,action:string,work:(client:QuerySession)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `currentRevision` | function | 66 | <code>export async function currentRevision(client:QuerySession,s:Scope,includeDocument=false):Promise&lt;{revision:Revision;document?:Data;source_digest:string}&gt;{</code> |
| `loadPacket` | function | 79 | <code>export async function loadPacket(client:QuerySession,s:Scope,id:string,requireFresh=true):Promise&lt;Packet&gt;{</code> |
| `storePacket` | function | 88 | <code>export async function storePacket(client:QuerySession,s:Scope,purpose:string,state:Data,id=randomUUID(),ttl=30000):Promise&lt;Packet&gt;{</code> |
| `grantFree` | function | 97 | <code>export function grantFree(value:unknown):void{</code> |
| `validateAudit` | function | 104 | <code>export function validateAudit(value:unknown):Data{</code> |
| `recordAudit` | function | 120 | <code>export async function recordAudit(client:QuerySession,s:Scope,value:unknown):Promise&lt;Data&gt;{</code> |
| `input` | function | 128 | <code>export function input(value:unknown,fields:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):{scope:Scope;data:Data}{</code> |
| `auditFor` | function | 131 | <code>export async function auditFor(client:QuerySession,s:Scope,id:unknown,purpose:string):Promise&lt;{audit:Data;packet:Awaited&lt;ReturnType&lt;typeof loadPacket&gt;&gt;}&gt;{</code> |
| `persistProposal` | function | 138 | <code>export async function persistProposal(client:QuerySession,s:Scope,auditId:unknown,payload:Data,state='PROPOSED_UNVALIDATED'):Promise&lt;Data&gt;{</code> |
| `RevisionVector` | interface | 145 | <code>export interface RevisionVector {spec_revision:string;repository_commits:Record&lt;string,string&gt;;graph_revision:string&#124;null;contract_revisions:Record&lt;string,string&gt;;event_watermark:string;ownership_gene…</code> |
| `revisionVector` | function | 146 | <code>function revisionVector(current:Revision,purpose:string,state:Data):RevisionVector{</code> |
| `registerAdvisoryPurpose` | function | 151 | <code>export function registerAdvisoryPurpose(ctx:ComponentContext,purpose:string,check?:(tx:QuerySession,s:Scope,packet:Packet,invocation:Invocation)=&gt;Promise&lt;void&gt;):void{</code> |
| `Loader` | type | 152 | <code>type Loader={load(tx:QuerySession,invocation:Invocation,value:unknown):Promise&lt;{packet:Omit&lt;Packet,'packet_hash'&gt;;request:Data;rubric_version:string}&gt;;current(tx:QuerySession,s:Scope,packet:Omit&lt;Packe…</code> |
| `load` | method | 152 | <code>type Loader={load(tx:QuerySession,invocation:Invocation,value:unknown):Promise&lt;{packet:Omit&lt;Packet,'packet_hash'&gt;;request:Data;rubric_version:string}&gt;;current(tx:QuerySession,s:Scope,packet:Omit&lt;Packe…</code> |
| `current` | method | 152 | <code>type Loader={load(tx:QuerySession,invocation:Invocation,value:unknown):Promise&lt;{packet:Omit&lt;Packet,'packet_hash'&gt;;request:Data;rubric_version:string}&gt;;current(tx:QuerySession,s:Scope,packet:Omit&lt;Packe…</code> |
| `registerPurpose` | method | 153 | <code>const jobs=ctx.dependencies.require('20.4','decision.jobs.v1',(value:unknown):value is {registerPurpose(purpose:string,loader:Loader):void}=&gt;!!value&amp;&amp;typeof value==='object'&amp;&amp;typeof(value as {register…</code> |
| `answers` | function | 162 | <code>export function answers(value:unknown):Data{</code> |
| `noul` | function | 165 | <code>export function noul(value:unknown):number{</code> |
| `CompletedJobs` | type | 168 | <code>type CompletedJobs={completedAudit(tx:QuerySession,scope:Scope,reference:{decision_id:string;packet_hash:string},invocation:Invocation):Promise&lt;{available:boolean;payload?:unknown;reason?:string}&gt;};</code> |
| `completedAudit` | method | 168 | <code>type CompletedJobs={completedAudit(tx:QuerySession,scope:Scope,reference:{decision_id:string;packet_hash:string},invocation:Invocation):Promise&lt;{available:boolean;payload?:unknown;reason?:string}&gt;};</code> |
| `SubmittingJobs` | type | 169 | <code>type SubmittingJobs=CompletedJobs&amp;{submit(invocation:Invocation,value:unknown):Promise&lt;unknown&gt;};</code> |
| `submit` | method | 169 | <code>type SubmittingJobs=CompletedJobs&amp;{submit(invocation:Invocation,value:unknown):Promise&lt;unknown&gt;};</code> |
| `completedJobs` | function | 170 | <code>function completedJobs(ctx:ComponentContext):CompletedJobs{</code> |
| `captureCompleted` | function | 174 | <code>async function captureCompleted(client:QuerySession,s:Scope,jobs:CompletedJobs,invocation:Invocation,decisionId:string,packet:Packet):Promise&lt;{available:true;audit:Data}&#124;{available:false;reason:string…</code> |
| `LegacyPurpose` | type | 190 | <code>export type LegacyPurpose=keyof typeof LEGACY_PURPOSES;</code> |
| `legacyPurpose` | function | 193 | <code>function legacyPurpose(p:LegacyPurpose):string{return 'legacy.'+p}</code> |
| `derivedId` | function | 194 | <code>function derivedId(...parts:string&#91;&#93;):string{</code> |
| `principalScope` | function | 198 | <code>function principalScope(ctx:ComponentContext):{scope:Scope;invocation:Invocation}{</code> |
| `legacyRoutes` | function | 204 | <code>function legacyRoutes(env:Readonly&lt;NodeJS.ProcessEnv&gt;,purpose:string):{routes:string&#91;&#93;}&#124;{reason:string;status:'unsupported'&#124;'unavailable'}{</code> |
| `legacyAbstention` | function | 210 | <code>function legacyAbstention(packet:Packet,id:string,status:typeof STATUSES&#91;number&#93;,reason:string,latency:number):Data{</code> |
| `legacyView` | function | 214 | <code>function legacyView(packet:Packet,decisionId:string&#124;null,status:string,reason:string&#124;null,audit:Data&#124;null):Data{</code> |
| `legacySubmit` | function | 217 | <code>async function legacySubmit(ctx:ComponentContext,jobs:SubmittingJobs&#124;null,p:LegacyPurpose,value:unknown):Promise&lt;Data&gt;{</code> |
| `legacyResult` | function | 251 | <code>async function legacyResult(ctx:ComponentContext,jobs:CompletedJobs&#124;null,p:LegacyPurpose,value:unknown):Promise&lt;Data&gt;{</code> |
| `createComponent` | function | 264 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/decisions/capabilities.ts

[Open source](../../services/hyperfide/src/decisions/capabilities.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CapabilityProfile` | interface | 6 | <code>interface CapabilityProfile {</code> |
| `Media` | interface | 12 | <code>export interface Media { id:string; data_uri:string }</code> |
| `CapabilityRequest` | interface | 13 | <code>export interface CapabilityRequest {</code> |
| `profileFor` | function | 17 | <code>function profileFor(id:RouteId,env:Readonly&lt;NodeJS.ProcessEnv&gt;):CapabilityProfile {</code> |
| `image` | function | 38 | <code>function image(raw:unknown,maxBytes:number):{id:string;uri:string;bytes:number;width:number;height:number;format:'png'&#124;'jpeg';digest:string} {</code> |
| `strings` | function | 78 | <code>function strings(value:unknown):string&#91;&#93; {</code> |
| `prepareCapabilities` | function | 85 | <code>export function prepareCapabilities(raw:unknown,env:Readonly&lt;NodeJS.ProcessEnv&gt;):{prepared:PreparedRequest;metadata:Record&lt;string,unknown&gt;} {</code> |
| `billing` | function | 160 | <code>export function billing(raw:unknown,env:Readonly&lt;NodeJS.ProcessEnv&gt;):Record&lt;string,unknown&gt; {</code> |
| `createComponent` | function | 190 | <code>export function createComponent(ctx:ComponentContext) {</code> |

## services/hyperfide/src/decisions/jobs.ts

[Open source](../../services/hyperfide/src/decisions/jobs.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Scope` | interface | 16 | <code>export interface Scope{organisation_id:string;run_id:string}</code> |
| `DecisionPacket` | interface | 17 | <code>export interface DecisionPacket{schema_version:1;id:string;purpose:string;revision:RevisionVector;state:unknown;created_at:string;expires_at:string;authority:'NONE'}</code> |
| `PurposeLoader` | interface | 18 | <code>export interface PurposeLoader {</code> |
| `load` | method | 19 | <code>load(tx:PrimaryTransaction,invocation:InvocationContext,input:unknown):Promise&lt;{packet:DecisionPacket;request:unknown;rubric_version:string}&gt;;</code> |
| `current` | method | 20 | <code>current(tx:PrimaryTransaction,scope:Scope,packet:DecisionPacket,invocation:InvocationContext):Promise&lt;RevisionVector&gt;;</code> |
| `Outbox` | type | 22 | <code>type Outbox={enqueue:typeof enqueue;claimPending:typeof claimPending;acknowledge:typeof acknowledge};</code> |
| `Inbox` | type | 23 | <code>type Inbox={receive:typeof receive};</code> |
| `JobPolicy` | interface | 24 | <code>interface JobPolicy{</code> |
| `JobRow` | interface | 28 | <code>interface JobRow extends Scope{</code> |
| `uuid` | function | 32 | <code>function uuid(value:unknown):string{if(typeof value!=='string'&#124;&#124;!UUID.test(value))fail('DECISION_SCHEMA','Canonical UUID required');return value as string;}</code> |
| `scoped` | function | 33 | <code>function scoped(i:InvocationContext):Scope{assertInvocation(i);return{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};}</code> |
| `policy` | function | 34 | <code>function policy(env:Readonly&lt;NodeJS.ProcessEnv&gt;):JobPolicy{</code> |
| `packet` | function | 50 | <code>function packet(value:unknown,purpose:string):DecisionPacket{</code> |
| `sameRevision` | function | 59 | <code>function sameRevision(a:unknown,b:unknown):boolean{return canonical(a)===canonical(b);}</code> |
| `scopeValues` | function | 60 | <code>const scopeValues=(s:Scope):string&#91;&#93;=&gt;&#91;s.organisation_id,s.run_id&#93;;</code> |
| `DecisionJobs` | class | 62 | <code>export class DecisionJobs{</code> |
| `constructor` | method | 66 | <code>constructor(private readonly g:TransactionGateway,private readonly outbox:Outbox,private readonly inbox:Inbox,private readonly env:Readonly&lt;NodeJS.ProcessEnv&gt;,private readonly shutdown:AbortSignal){}</code> |
| `registerPurpose` | method | 67 | <code>registerPurpose(purpose:string,loader:PurposeLoader):void{</code> |
| `loader` | method | 72 | <code>private loader(purpose:string):PurposeLoader{</code> |
| `guard` | method | 75 | <code>private async guard(i:InvocationContext,tx:PrimaryTransaction,mode:'READ'&#124;'WRITE'):Promise&lt;void&gt;{</code> |
| `tx` | method | 81 | <code>private async tx&lt;T&gt;(i:InvocationContext,fn:(tx:PrimaryTransaction)=&gt;Promise&lt;T&gt;,timeoutMs=5000,mode:'READ'&#124;'WRITE'='WRITE'):Promise&lt;T&gt;{</code> |
| `lock` | method | 86 | <code>private async lock(tx:PrimaryTransaction,s:Scope):Promise&lt;void&gt;{</code> |
| `row` | method | 89 | <code>private async row(tx:PrimaryTransaction,s:Scope,id:string):Promise&lt;JobRow&gt;{</code> |
| `fresh` | method | 93 | <code>private async fresh(tx:PrimaryTransaction,s:Scope,j:JobRow,i:InvocationContext):Promise&lt;void&gt;{</code> |
| `submit` | method | 97 | <code>async submit(i:InvocationContext,raw:unknown):Promise&lt;unknown&gt;{</code> |
| `status` | method | 137 | <code>async status(i:InvocationContext,raw:unknown):Promise&lt;unknown&gt;{</code> |
| `cancel` | method | 145 | <code>async cancel(i:InvocationContext,raw:unknown):Promise&lt;unknown&gt;{</code> |
| `attempts` | method | 154 | <code>private async attempts(tx:PrimaryTransaction,s:Scope,id:string):Promise&lt;Record&lt;string,unknown&gt;&#91;&#93;&gt;{</code> |
| `receipt` | method | 157 | <code>private receipt(j:JobRow,decision:ValidatedDecision,attempts:number,finalStatus:string):unknown{</code> |
| `replay` | method | 173 | <code>async replay(i:InvocationContext,raw:unknown):Promise&lt;unknown&gt;{</code> |
| `finish` | method | 191 | <code>private async finish(tx:PrimaryTransaction,s:Scope,j:JobRow,status:string,reason:string&#124;null,decision:ValidatedDecision&#124;null):Promise&lt;void&gt;{</code> |
| `process` | method | 205 | <code>async process(i:InvocationContext,raw:unknown):Promise&lt;unknown&gt;{</code> |
| `completedAudit` | method | 337 | <code>async completedAudit(tx:PrimaryTransaction,s:Scope,input:{decision_id:string;packet_hash:string},i:InvocationContext):Promise&lt;unknown&gt;{</code> |
| `close` | method | 351 | <code>async close():Promise&lt;void&gt;{this.closed=true;for(const c of this.controllers.values())c.abort();}</code> |
| `createComponent` | function | 353 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/decisions/ranking.ts

[Open source](../../services/hyperfide/src/decisions/ranking.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RankingSource` | interface | 4 | <code>export interface RankingSource {eligibleTasks(tx:unknown,query:{organisation_id:string;run_id:string;pool_id:string;profile_id?:string;limit?:number}):Promise&lt;Data&gt;}</code> |
| `eligibleTasks` | method | 4 | <code>export interface RankingSource {eligibleTasks(tx:unknown,query:{organisation_id:string;run_id:string;pool_id:string;profile_id?:string;limit?:number}):Promise&lt;Data&gt;}</code> |
| `rankingSource` | function | 5 | <code>export function rankingSource(value:unknown):value is RankingSource {return !!value&amp;&amp;typeof value==='object'&amp;&amp;typeof(value as RankingSource).eligibleTasks==='function'}</code> |
| `candidatePins` | function | 6 | <code>function candidatePins(candidates:unknown&#91;&#93;):Data&#91;&#93;{return candidates.map(value=&gt;{const {execution_packet,...pins}=obj(value);return pins;});}</code> |
| `findingContext` | function | 7 | <code>async function findingContext(tx:unknown,scope:{organisation_id:string;run_id:string}):Promise&lt;Data&gt;{</code> |
| `findingSnapshot` | function | 13 | <code>export function findingSnapshot(value:unknown,scope:{organisation_id:string;run_id:string}):Data{</code> |
| `findingAdviceEntries` | function | 20 | <code>export function findingAdviceEntries(value:unknown):Data&#91;&#93;{</code> |
| `assertFindingContext` | function | 28 | <code>async function assertFindingContext(tx:unknown,scope:{organisation_id:string;run_id:string},state:Data):Promise&lt;void&gt;{</code> |
| `rankingState` | function | 31 | <code>export function rankingState(value:unknown):Data{</code> |
| `rankAdvice` | function | 44 | <code>export function rankAdvice(value:unknown,state:Data):Data{</code> |
| `rankTyped` | function | 55 | <code>export function rankTyped(value:unknown,state:Data):Data{</code> |
| `rankingQuestions` | function | 59 | <code>export function rankingQuestions(state:Data):Data{</code> |
| `deterministicRanking` | function | 63 | <code>export function deterministicRanking(state:Data):Data{</code> |
| `createComponent` | function | 71 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/decisions/recovery.ts

[Open source](../../services/hyperfide/src/decisions/recovery.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `recoveryAdvice` | function | 6 | <code>export function recoveryAdvice(value:unknown,state:Data):Data{</code> |
| `recoveryFallback` | function | 17 | <code>export function recoveryFallback(state:Data,reason:string):Data{</code> |
| `recoveryRepeat` | function | 21 | <code>export function recoveryRepeat(prior:Data&#124;null,state:Data):{prior_failure_evidence:Data&#124;null;changed_conditions:string&#91;&#93;}{</code> |
| `priorRecovery` | function | 33 | <code>async function priorRecovery(tx:QuerySession,s:Scope,attempt:Data):Promise&lt;Data&#124;null&gt;{</code> |
| `Admission` | interface | 37 | <code>interface Admission {recoveryContextInTransaction(tx:QuerySession,input:Data,invocation:Invocation):Promise&lt;unknown&gt;}</code> |
| `recoveryContextInTransaction` | method | 37 | <code>interface Admission {recoveryContextInTransaction(tx:QuerySession,input:Data,invocation:Invocation):Promise&lt;unknown&gt;}</code> |
| `admission` | function | 38 | <code>function admission(ctx:ComponentContext):Admission{return ctx.dependencies.require('13.4','agent.admission.v1',(value:unknown):value is Admission=&gt;!!value&amp;&amp;typeof value==='object'&amp;&amp;typeof(value as Adm…</code> |
| `admissionData` | function | 39 | <code>function admissionData(value:unknown):Data{</code> |
| `checkpointSnapshot` | function | 45 | <code>async function checkpointSnapshot(tx:QuerySession,s:Scope,attemptId:string):Promise&lt;Data&#91;&#93;&gt;{</code> |
| `Assurance` | interface | 48 | <code>interface Assurance {inspectExecutionReceipt(tx:QuerySession,s:Scope,job_id:string,lease_generation:string):Promise&lt;unknown&gt;}</code> |
| `inspectExecutionReceipt` | method | 48 | <code>interface Assurance {inspectExecutionReceipt(tx:QuerySession,s:Scope,job_id:string,lease_generation:string):Promise&lt;unknown&gt;}</code> |
| `preservedReceipt` | function | 49 | <code>async function preservedReceipt(ctx:ComponentContext,tx:QuerySession,s:Scope,value:unknown,attempt:Data):Promise&lt;Data&gt;{</code> |
| `recoveryCurrent` | function | 58 | <code>async function recoveryCurrent(ctx:ComponentContext,tx:QuerySession,s:Scope,packet:Packet,i:Invocation):Promise&lt;void&gt;{</code> |
| `createComponent` | function | 68 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/decisions/results.ts

[Open source](../../services/hyperfide/src/decisions/results.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RevisionVector` | interface | 7 | <code>export interface RevisionVector {</code> |
| `DecisionIdentity` | interface | 11 | <code>export interface DecisionIdentity {</code> |
| `ValidatedAnswer` | interface | 14 | <code>export interface ValidatedAnswer {</code> |
| `ResponseValidation` | interface | 20 | <code>export interface ResponseValidation {</code> |
| `ValidatedDecision` | interface | 24 | <code>export interface ValidatedDecision extends ResponseValidation {</code> |
| `attested` | variable | 28 | <code>const attested=new WeakSet&lt;object&gt;();</code> |
| `probability` | function | 29 | <code>function probability(value:unknown,label:string):number {</code> |
| `sameKeys` | function | 33 | <code>function sameKeys(value:Record&lt;string,unknown&gt;,expected:string&#91;&#93;):void{</code> |
| `distribution` | function | 37 | <code>function distribution(value:unknown,keys:string&#91;&#93;):{raw:Record&lt;string,number&gt;;normalized:Record&lt;string,number&gt;;sum:number}{</code> |
| `parseIdentity` | function | 44 | <code>export function parseIdentity(input:unknown):DecisionIdentity {</code> |
| `validateResponse` | function | 59 | <code>export function validateResponse(profile:RouteProfile,request:DecisionRequest,input:unknown):ResponseValidation {</code> |
| `Calibration` | interface | 118 | <code>interface Calibration { version:string;purpose:string;route_id:string;returned_model:string;rubric_version:string;minimum_concentration:number;qualification_ref:string }</code> |
| `calibration` | function | 119 | <code>function calibration(env:Readonly&lt;NodeJS.ProcessEnv&gt;,identity:DecisionIdentity,transport:TransportResult):Calibration&#124;null{</code> |
| `assertValidatedDecision` | function | 133 | <code>export function assertValidatedDecision(value:unknown,expected:{decision_id:string;packet_hash:string}):asserts value is ValidatedDecision{</code> |
| `evaluateDecision` | function | 137 | <code>export async function evaluateDecision(input:{route_id:unknown;request:unknown;identity:unknown;timeout_ms:number},env:Readonly&lt;NodeJS.ProcessEnv&gt;,signal?:AbortSignal):Promise&lt;ValidatedDecision&gt;{</code> |
| `evaluatePreparedDecision` | function | 141 | <code>export async function evaluatePreparedDecision(request:PreparedRequest,identityInput:unknown,env:Readonly&lt;NodeJS.ProcessEnv&gt;,options:{timeout_ms:number;signal?:AbortSignal}):Promise&lt;ValidatedDecision&gt;…</code> |
| `createComponent` | function | 161 | <code>export function createComponent(ctx:ComponentContext):unknown{</code> |

## services/hyperfide/src/decisions/spec_critique.ts

[Open source](../../services/hyperfide/src/decisions/spec_critique.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ClauseRef` | interface | 6 | <code>export interface ClauseRef {section:string;field:string}</code> |
| `clauseState` | function | 7 | <code>export function clauseState(document:unknown,selectors:unknown,sourceDigest:string):Data {</code> |
| `validateCritique` | function | 30 | <code>export function validateCritique(value:unknown,packetState:Data):Data&#91;&#93;{</code> |
| `amendmentSummary` | function | 41 | <code>export function amendmentSummary(value:unknown):Data{</code> |
| `validateAmendment` | function | 52 | <code>async function validateAmendment(client:QuerySession,ctx:ComponentContext,scope:Scope,packet:Data,value:unknown):Promise&lt;Data&gt;{</code> |
| `createComponent` | function | 68 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/evaluation/datasets.ts

[Open source](../../services/hyperfide/src/evaluation/datasets.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Obj` | type | 7 | <code>export type Obj = Record&lt;string, unknown&gt;;</code> |
| `EvidenceClass` | type | 8 | <code>export type EvidenceClass = 'live' &#124; 'synthetic';</code> |
| `fail` | function | 9 | <code>export function fail(message: string): never { throw new FoundationError('EVALUATION_INVALID', message); }</code> |
| `fields` | function | 10 | <code>export function fields(value: unknown, required: string&#91;&#93;, optional: string&#91;&#93; = &#91;&#93;): Obj {</code> |
| `text` | function | 15 | <code>export function text(value: unknown, max = 256): string {</code> |
| `id` | function | 19 | <code>export function id(value: unknown): string {</code> |
| `finite` | function | 24 | <code>export function finite(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {</code> |
| `integer` | function | 28 | <code>export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {</code> |
| `list` | function | 31 | <code>export function list(value: unknown, min = 0, max = 10000): unknown&#91;&#93; {</code> |
| `strings` | function | 35 | <code>export function strings(value: unknown, min = 0, max = 10000): string&#91;&#93; {</code> |
| `time` | function | 40 | <code>export function time(value: unknown): string {</code> |
| `hash` | function | 45 | <code>export function hash(value: unknown): string {</code> |
| `canonical` | function | 48 | <code>export function canonical(value: unknown): string {</code> |
| `digest` | function | 55 | <code>export function digest(value: unknown): string { return 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex'); }</code> |
| `Verified` | interface | 56 | <code>export interface Verified { payload: Obj; key: string; evidence_class: EvidenceClass; observed_at: string; receipt_digest: string }</code> |
| `attestation` | function | 57 | <code>export function attestation(context: ComponentContext, value: unknown, kind: string): Verified {</code> |
| `Artifact` | interface | 82 | <code>export interface Artifact&lt;T = Obj&gt; { schema_version: 1; kind: string; payload: T }</code> |
| `EvaluationStore` | class | 83 | <code>export class EvaluationStore {</code> |
| `constructor` | method | 84 | <code>constructor(private context: ComponentContext) {}</code> |
| `directory` | method | 85 | <code>private async directory(): Promise&lt;string&gt; {</code> |
| `put` | method | 97 | <code>async put&lt;T&gt;(kind: string, payload: T): Promise&lt;string&gt; {</code> |
| `get` | method | 112 | <code>async get&lt;T = Obj&gt;(identity: unknown, kind: string): Promise&lt;T&gt; {</code> |
| `Packet` | interface | 122 | <code>export interface Packet {</code> |
| `DatasetRow` | interface | 128 | <code>export interface DatasetRow { packet: Packet; target: string &#124; null; split: 'train'&#124;'calibration'&#124;'holdout'; packet_digest:string; label_digest:string; evidence_class:EvidenceClass; label_kind:string;…</code> |
| `Dataset` | interface | 129 | <code>export interface Dataset {</code> |
| `sequence` | function | 133 | <code>function sequence(value: unknown): string {</code> |
| `parsePacket` | function | 136 | <code>function parsePacket(v: unknown): Packet {</code> |
| `buildDataset` | function | 151 | <code>export async function buildDataset(input: unknown, context: ComponentContext): Promise&lt;Obj&gt; {</code> |
| `createComponent` | function | 208 | <code>export function createComponent(_context:ComponentContext):Component {</code> |

## services/hyperfide/src/evaluation/promotion.ts

[Open source](../../services/hyperfide/src/evaluation/promotion.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Thresholds` | interface | 6 | <code>interface Thresholds { minimum_coverage:number; minimum_accuracy_lower:number; maximum_ece:number; maximum_risk:number; maximum_p95_ms:number; maximum_actual_cost_microusd:number }</code> |
| `Policy` | interface | 7 | <code>interface Policy { version:string; purpose:string; profile:Profile; dataset_id:string; holdout_digest:string; thresholds:Thresholds; expires_at:string; required_cases:{route:string&#91;&#93;;invariants:string…</code> |
| `Gate` | interface | 8 | <code>interface Gate { policy:Policy; scorecard_id:string; trial_report_id:string; eligible:boolean; reasons:string&#91;&#93;; mode:string; evidence_digests:string&#91;&#93;; valid_until:string }</code> |
| `thresholds` | function | 9 | <code>function thresholds(v:unknown):Thresholds{</code> |
| `quality` | function | 15 | <code>function quality(score:Scorecard,p:Policy):string&#91;&#93;{</code> |
| `validQualification` | function | 32 | <code>function validQualification(context:ComponentContext,input:unknown,kind:string,profileDigest:string,requiredCases:string&#91;&#93;):{reasons:string&#91;&#93;;expires_at:string}{</code> |
| `assessPromotion` | function | 46 | <code>export async function assessPromotion(input:unknown,context:ComponentContext):Promise&lt;Obj&gt;{</code> |
| `checkDrift` | function | 83 | <code>export async function checkDrift(input:unknown,context:ComponentContext):Promise&lt;Obj&gt;{</code> |
| `createComponent` | function | 105 | <code>export function createComponent(_context:ComponentContext):Component{</code> |

## services/hyperfide/src/evaluation/scorecard.ts

[Open source](../../services/hyperfide/src/evaluation/scorecard.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Profile` | interface | 4 | <code>export interface Profile { id:string; model:string; route:string; purpose:string; rubric:string }</code> |
| `Prediction` | interface | 5 | <code>export interface Prediction { case_id:string; profile_id:string; probabilities:Record&lt;string,number&gt;&#124;null; decision:string&#124;null; status:'ok'&#124;'abstained'&#124;'error'; latency_ms:number; attempts:number; in…</code> |
| `Calibration` | interface | 6 | <code>export interface Calibration { dataset_id:string; holdout_digest:string; profile:Profile; bins:{count:number;correct:number;calibrated:number&#124;null}&#91;&#93;; fitted_split:'calibration'; evidence_class:string…</code> |
| `profile` | function | 7 | <code>export function profile(value:unknown):Profile {</code> |
| `wilson` | function | 11 | <code>export function wilson(successes:number,total:number):{lower:number;upper:number}&#124;null {</code> |
| `safeSum` | function | 17 | <code>function safeSum(values:number&#91;&#93;):number { const total=values.reduce((a,b)=&gt;a+b,0);return integer(total); }</code> |
| `quantile` | function | 18 | <code>function quantile(values:number&#91;&#93;,q:number):number&#124;null {</code> |
| `parsePredictions` | function | 21 | <code>export function parsePredictions(context:ComponentContext,values:unknown,rows:DatasetRow&#91;&#93;,profiles:Profile&#91;&#93;):Prediction&#91;&#93; {</code> |
| `calibrate` | function | 51 | <code>export async function calibrate(input:unknown,context:ComponentContext):Promise&lt;Obj&gt;{</code> |
| `Scorecard` | interface | 71 | <code>export interface Scorecard {</code> |
| `metrics` | function | 76 | <code>function metrics(rows:DatasetRow&#91;&#93;,predictions:Prediction&#91;&#93;,calibration:Calibration&#124;null):Obj{</code> |
| `score` | function | 130 | <code>export async function score(input:unknown,context:ComponentContext):Promise&lt;Obj&gt;{</code> |
| `createComponent` | function | 182 | <code>export function createComponent(_context:ComponentContext):Component {</code> |

## services/hyperfide/src/evaluation/trials.ts

[Open source](../../services/hyperfide/src/evaluation/trials.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Trial` | interface | 6 | <code>export interface Trial {</code> |
| `TrialReport` | interface | 14 | <code>export interface TrialReport {</code> |
| `createTrial` | function | 20 | <code>export async function createTrial(input:unknown,context:ComponentContext):Promise&lt;Obj&gt;{</code> |
| `reportTrial` | function | 57 | <code>export async function reportTrial(input:unknown,context:ComponentContext):Promise&lt;Obj&gt;{</code> |
| `createComponent` | function | 122 | <code>export function createComponent(_context:ComponentContext):Component {</code> |

## services/hyperfide/src/findings/github.ts

[Open source](../../services/hyperfide/src/findings/github.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GitHubFailure` | class | 6 | <code>class GitHubFailure extends Error {constructor(public readonly code:string,public readonly uncertain=false){super(code);}}</code> |
| `constructor` | method | 6 | <code>class GitHubFailure extends Error {constructor(public readonly code:string,public readonly uncertain=false){super(code);}}</code> |
| `Issue` | interface | 7 | <code>interface Issue {number:number;title:string;body:string;state:'open'&#124;'closed';updated_at:string;pull_request?:unknown}</code> |
| `issue` | function | 8 | <code>function issue(value:unknown):Issue{</code> |
| `repository` | function | 12 | <code>function repository(value:unknown):string{const out=text(value,'GitHub repository name',100);if(!/^&#91;A-Za-z0-9_.-&#93;+$/.test(out)&#124;&#124;out==='.'&#124;&#124;out==='..')fail('INVALID_REQUEST','Invalid GitHub repository…</code> |
| `marker` | function | 13 | <code>function marker(env:Readonly&lt;NodeJS.ProcessEnv&gt;,scope:FindingScope,findingId:string,repositoryId:string):string{</code> |
| `GitHubClient` | class | 18 | <code>export class GitHubClient {</code> |
| `constructor` | method | 20 | <code>constructor(readonly env:Readonly&lt;NodeJS.ProcessEnv&gt;,readonly signal?:AbortSignal,public deadline=Date.now()+30000){</code> |
| `request` | method | 28 | <code>async request(method:string,relative:string,payload?:unknown):Promise&lt;{data:unknown;link:string&#124;null}&gt;{</code> |
| `issues` | method | 40 | <code>async issues(owner:string,name:string,since:string):Promise&lt;Issue&#91;&#93;&gt;{</code> |
| `enqueue` | function | 51 | <code>async function enqueue(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `saveIssue` | function | 65 | <code>async function saveIssue(value:FindingTransaction,repositoryId:string,owner:string,name:string,external:Issue):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `dispatch` | function | 85 | <code>async function dispatch(context:ComponentContext,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `webhook` | function | 124 | <code>async function webhook(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `processDelivery` | function | 140 | <code>async function processDelivery(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `reconcile` | function | 152 | <code>async function reconcile(context:ComponentContext,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `createComponent` | function | 169 | <code>export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:{</code> |

## services/hyperfide/src/findings/registry.ts

[Open source](../../services/hyperfide/src/findings/registry.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FindingScope` | interface | 8 | <code>export interface FindingScope {organisation_id:string;run_id:string;repository_id?:string;source_object_id?:string}</code> |
| `FindingPrincipal` | interface | 9 | <code>export interface FindingPrincipal {credential_id:string;actor_id:string;organisation_id:string;run_id:string;deployment_epoch:string;role:string;allowed_actions:readonly string&#91;&#93;;expires_at:string}</code> |
| `FindingInvocation` | interface | 10 | <code>export interface FindingInvocation {principal:FindingPrincipal;operation:unknown;payload:{action:string;run_id:string};guard(tx:AuthorityTransaction):Promise&lt;void&gt;}</code> |
| `guard` | method | 10 | <code>export interface FindingInvocation {principal:FindingPrincipal;operation:unknown;payload:{action:string;run_id:string};guard(tx:AuthorityTransaction):Promise&lt;void&gt;}</code> |
| `FindingDatabase` | type | 11 | <code>export type FindingDatabase=AuthorityTransaction;</code> |
| `FindingTransaction` | interface | 12 | <code>export interface FindingTransaction {tx:FindingDatabase;scope:FindingScope;principal:FindingPrincipal;context:ComponentContext}</code> |
| `fail` | function | 13 | <code>export function fail(code:string,message:string):never {throw new FoundationError(code,message);}</code> |
| `record` | function | 14 | <code>export function record(value:unknown):Record&lt;string,unknown&gt;{if(!object(value))fail('INVALID_REQUEST','A bounded object is required');return value;}</code> |
| `fields` | function | 15 | <code>export function fields(value:Record&lt;string,unknown&gt;,required:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):void{</code> |
| `text` | function | 18 | <code>export function text(value:unknown,label:string,max=4096):string{if(typeof value!=='string'&#124;&#124;!value.trim()&#124;&#124;value.length&gt;max&#124;&#124;value.includes('&#92;0'))fail('INVALID_REQUEST','Invalid '+label);return value…</code> |
| `uuid` | function | 19 | <code>export function uuid(value:unknown):string{const out=text(value,'UUID',36);if(!/^&#91;0-9a-f&#93;{8}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{4}-&#91;0-9a-f&#93;{12}$/i.test(out))fail('INVALID_REQUEST','A UUID is required');…</code> |
| `decimal` | function | 20 | <code>export function decimal(value:unknown):string{if(typeof value!=='string'&#124;&#124;!/^&#91;1-9&#93;&#91;0-9&#93;{0,18}$/.test(value)&#124;&#124;BigInt(value)&gt;9223372036854775807n)fail('INVALID_REQUEST','A canonical positive decimal is…</code> |
| `digestValue` | function | 21 | <code>export function digestValue(value:unknown):string{if(typeof value!=='string'&#124;&#124;!/^sha256:&#91;0-9a-f&#93;{64}$/.test(value))fail('INVALID_REQUEST','A SHA256 content identity is required');return value;}</code> |
| `oid` | function | 22 | <code>export function oid(value:unknown):string{if(typeof value!=='string'&#124;&#124;!/^(&#91;0-9a-f&#93;{40}&#124;&#91;0-9a-f&#93;{64})$/.test(value))fail('INVALID_REQUEST','A Git object identity is required');return value;}</code> |
| `ids` | function | 23 | <code>export function ids(value:unknown,max=128):string&#91;&#93;{if(!Array.isArray(value)&#124;&#124;value.length&gt;max)fail('INVALID_REQUEST','A bounded UUID array is required');const result=value.map(uuid);if(new Set(result…</code> |
| `canonical` | function | 24 | <code>export function canonical(value:unknown):string{</code> |
| `digest` | function | 31 | <code>export function digest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}</code> |
| `invocation` | function | 32 | <code>export async function invocation(context:ComponentContext,action:string):Promise&lt;FindingInvocation&gt;{</code> |
| `readiness` | function | 42 | <code>export async function readiness(tx:FindingDatabase):Promise&lt;void&gt;{</code> |
| `semanticDisposition` | function | 48 | <code>export async function semanticDisposition(tx:FindingDatabase,scope:FindingScope,write=false):Promise&lt;void&gt;{</code> |
| `withFindingTransaction` | function | 53 | <code>export async function withFindingTransaction&lt;T&gt;(context:ComponentContext,action:string,fn:(value:FindingTransaction)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `admin` | function | 65 | <code>export async function admin(value:FindingTransaction):Promise&lt;void&gt;{</code> |
| `manager` | function | 70 | <code>export async function manager(value:FindingTransaction,packageId:string):Promise&lt;void&gt;{</code> |
| `emit` | function | 75 | <code>export async function emit(tx:FindingDatabase,scope:FindingScope,findingId:string,version:string,event:string,payload:Record&lt;string,unknown&gt;):Promise&lt;void&gt;{</code> |
| `finding` | function | 78 | <code>export async function finding(tx:FindingDatabase,scope:FindingScope,id:string,lock=false):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `admittedEvidence` | function | 82 | <code>export async function admittedEvidence(tx:FindingDatabase,scope:FindingScope,evidenceIds:string&#91;&#93;,repositoryId?:string,sourceObjectId?:string):Promise&lt;void&gt;{</code> |
| `resolution` | function | 87 | <code>function resolution(value:unknown):Record&lt;string,unknown&gt;{</code> |
| `acceptedResolution` | function | 92 | <code>export async function acceptedResolution(tx:FindingDatabase,scope:FindingScope,taskId:string,repositoryId:string,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `revalidateResolution` | function | 105 | <code>export async function revalidateResolution(tx:FindingDatabase,scope:FindingScope,f:Record&lt;string,any&gt;):Promise&lt;void&gt;{const stored=record(f.resolution_condition);const input=Object.fromEntries(&#91;'condit…</code> |
| `reportFinding` | function | 106 | <code>export async function reportFinding(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `readFindingContext` | function | 147 | <code>export async function readFindingContext(tx:FindingDatabase,scope:FindingScope,input:unknown={}):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `inspectBlockingFindings` | function | 154 | <code>export async function inspectBlockingFindings(tx:FindingDatabase,scope:FindingScope):Promise&lt;{clear:boolean;blockers:Record&lt;string,unknown&gt;&#91;&#93;} &gt;{</code> |
| `confirmDuplicate` | function | 163 | <code>async function confirmDuplicate(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `createComponent` | function | 193 | <code>export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:{</code> |

## services/hyperfide/src/findings/remediation.ts

[Open source](../../services/hyperfide/src/findings/remediation.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `repair` | function | 5 | <code>async function repair(value:FindingTransaction,id:string):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `limit` | function | 9 | <code>function limit(context:ComponentContext):number{</code> |
| `request` | function | 12 | <code>async function request(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `attach` | function | 31 | <code>async function attach(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `submit` | function | 44 | <code>async function submit(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `actualInspector` | function | 55 | <code>async function actualInspector(relative:string,name:string):Promise&lt;(...args:any&#91;&#93;)=&gt;Promise&lt;any&gt;&gt;{</code> |
| `qualifiedRepairProof` | function | 59 | <code>async function qualifiedRepairProof(tx:FindingTransaction&#91;'tx'&#93;,scope:FindingScope,r:Record&lt;string,any&gt;,f:Record&lt;string,any&gt;,reproductionPlanId:unknown,historical=false):Promise&lt;{proof:Record&lt;string,u…</code> |
| `resolve` | function | 101 | <code>async function resolve(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `failure` | function | 114 | <code>async function failure(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `inspectFindingResolution` | function | 124 | <code>export async function inspectFindingResolution(tx:FindingTransaction&#91;'tx'&#93;,scope:FindingScope,findingId:string):Promise&lt;{current:boolean;reason?:string}&gt;{</code> |
| `repairHistory` | function | 127 | <code>async function repairHistory(value:FindingTransaction,findingId:string):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `externalIssue` | function | 134 | <code>async function externalIssue(value:FindingTransaction,findingId:string):Promise&lt;Record&lt;string,unknown&gt;&#124;null&gt;{</code> |
| `inspect` | function | 139 | <code>async function inspect(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `recheck` | function | 144 | <code>async function recheck(value:FindingTransaction,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `createComponent` | function | 158 | <code>export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:{</code> |

## services/hyperfide/src/findings/routing.ts

[Open source](../../services/hyperfide/src/findings/routing.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `owner` | function | 5 | <code>async function owner(value:FindingTransaction,packageId:string):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `route` | function | 11 | <code>async function route(value:FindingTransaction,input:unknown,explicit=false):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `acknowledge` | function | 39 | <code>async function acknowledge(value:FindingTransaction,input:unknown,collaborator=false):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `createComponent` | function | 62 | <code>export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:{</code> |

## services/hyperfide/src/integration/candidates.ts

[Open source](../../services/hyperfide/src/integration/candidates.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `DB` | interface | 14 | <code>export interface DB {query&lt;Row extends pg.QueryResultRow=any&gt;(text:string,values?:unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;Row&gt;&gt;}</code> |
| `query` | method | 14 | <code>export interface DB {query&lt;Row extends pg.QueryResultRow=any&gt;(text:string,values?:unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;Row&gt;&gt;}</code> |
| `IntegrationInvocation` | interface | 15 | <code>interface IntegrationInvocation {context:ComponentContext;invocation:unknown}</code> |
| `invocationStorage` | variable | 16 | <code>const invocationStorage=new AsyncLocalStorage&lt;IntegrationInvocation&gt;();</code> |
| `Gateway` | interface | 17 | <code>interface Gateway {withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries:number;guard?:(db:DB)=&gt;Promise&lt;void&gt;;signal?:AbortSignal},fn:(db:DB)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;}</code> |
| `withPrimaryTransaction` | method | 17 | <code>interface Gateway {withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries:number;guard?:(db:DB)=&gt;Promise&lt;void&gt;;signal?:AbortSignal},fn:(db:DB)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;}</code> |
| `gateway` | function | 18 | <code>function gateway(context:ComponentContext):Gateway{</code> |
| `runnerRemote` | function | 23 | <code>export async function runnerRemote(context:ComponentContext):Promise&lt;{prepare:(db:DB,invocation:unknown,plan:Record&lt;string,unknown&gt;)=&gt;Promise&lt;unknown&gt;;execute:(permit:unknown,signal:AbortSignal)=&gt;Prom…</code> |
| `bindScope` | function | 28 | <code>export function bindScope(ctx:ComponentContext,component:Component):Component{</code> |
| `currentInvocation` | function | 40 | <code>export function currentInvocation():IntegrationInvocation{</code> |
| `prepareRemote` | function | 43 | <code>export async function prepareRemote(db:DB,plan:Record&lt;string,unknown&gt;):Promise&lt;{remote:Awaited&lt;ReturnType&lt;typeof runnerRemote&gt;&gt;;permit:unknown;plan:Record&lt;string,unknown&gt;;expected_source_object_id?:st…</code> |
| `snapshotRemote` | function | 47 | <code>export function snapshotRemote(prepared:Awaited&lt;ReturnType&lt;typeof prepareRemote&gt;&gt;):Record&lt;string,unknown&gt;{</code> |
| `restoreRemote` | function | 50 | <code>export async function restoreRemote(db:DB,snapshot:unknown):Promise&lt;Awaited&lt;ReturnType&lt;typeof prepareRemote&gt;&gt;&gt;{</code> |
| `executeRemote` | function | 55 | <code>export async function executeRemote(prepared:Awaited&lt;ReturnType&lt;typeof prepareRemote&gt;&gt;):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `Scope` | interface | 62 | <code>export interface Scope {organisation_id:string;run_id:string}</code> |
| `fail` | function | 63 | <code>export function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `obj` | function | 64 | <code>export function obj(v:unknown):Record&lt;string,unknown&gt;{if(!object(v))fail('INTEGRATION_INVALID','Object required');return v;}</code> |
| `keys` | function | 65 | <code>export function keys(v:Record&lt;string,unknown&gt;,required:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):void{</code> |
| `uuid` | function | 67 | <code>export function uuid(v:unknown):string{if(typeof v!=='string'&#124;&#124;!/^&#91;0-9a-f&#93;{8}-&#91;0-9a-f&#93;{4}-&#91;1-8&#93;&#91;0-9a-f&#93;{3}-&#91;89ab&#93;&#91;0-9a-f&#93;{3}-&#91;0-9a-f&#93;{12}$/.test(v))fail('INTEGRATION_INVALID','Canonical UUID required'…</code> |
| `oid` | function | 68 | <code>export function oid(v:unknown):string{if(typeof v!=='string'&#124;&#124;!/^(?:&#91;0-9a-f&#93;{40}&#124;&#91;0-9a-f&#93;{64})$/.test(v))fail('INTEGRATION_INVALID','Full Git object ID required');return v;}</code> |
| `digest` | function | 69 | <code>export function digest(v:unknown):string{if(typeof v!=='string'&#124;&#124;!/^sha256:&#91;0-9a-f&#93;{64}$/.test(v))fail('INTEGRATION_INVALID','SHA256 digest required');return v;}</code> |
| `decimal` | function | 70 | <code>export function decimal(v:unknown):string{if(typeof v!=='string'&#124;&#124;!/^&#91;1-9&#93;&#91;0-9&#93;&#42;$/.test(v)&#124;&#124;BigInt(v)&gt;9223372036854775807n)fail('INTEGRATION_INVALID','Positive canonical generation required');return v…</code> |
| `scope` | function | 71 | <code>export function scope(v:Record&lt;string,unknown&gt;):Scope{return {organisation_id:uuid(v.organisation_id),run_id:uuid(v.run_id)};}</code> |
| `canonical` | function | 72 | <code>export function canonical(v:unknown):string{</code> |
| `hash` | function | 79 | <code>export const hash=(v:string&#124;Buffer):string=&gt;'sha256:'+createHash('sha256').update(v).digest('hex');</code> |
| `values` | function | 80 | <code>export function values(s:Scope):string&#91;&#93;{return &#91;s.organisation_id,s.run_id&#93;;}</code> |
| `semanticDisposition` | function | 81 | <code>export async function semanticDisposition(db:DB,s:{organisation_id:string;run_id:string},mode:'READ'&#124;'WRITE'):Promise&lt;void&gt;{</code> |
| `tx` | function | 85 | <code>export async function tx&lt;T&gt;(_pool:unknown,fn:(db:DB)=&gt;Promise&lt;T&gt;,mode:'READ'&#124;'WRITE'='WRITE'):Promise&lt;T&gt;{</code> |
| `primaryClient` | function | 92 | <code>export function primaryClient():DB{</code> |
| `prepareRemoteGate` | function | 96 | <code>export async function prepareRemoteGate(db:DB,s:Scope,request:{session_id:string;reservation_id:string;repository_id:string;input_digest:string;policy_digest:string;gate:GateConfig;mode:'CANDIDATE'&#124;'W…</code> |
| `AdmittedIntegrationWork` | interface | 107 | <code>export interface AdmittedIntegrationWork {kind:'CANDIDATE'&#124;'SCOPE'&#124;'PREPARATION';id:string}</code> |
| `currentRun` | function | 108 | <code>export async function currentRun(db:DB,s:Scope,lock=false,admittedPublicationId?:string,observe=false,admittedWork?:AdmittedIntegrationWork):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `GateConfig` | interface | 130 | <code>export interface GateConfig {id:string;kind:'build'&#124;'test';argv:string&#91;&#93;;timeout_ms:number;proof:{manifest_path:string;manifest_digest:string;registry_path:string;registry_digest:string;expected_asser…</code> |
| `RepositoryConfig` | interface | 131 | <code>export interface RepositoryConfig {repository_id:string;path:string;target_ref:string;receive_path?:string;gates:GateConfig&#91;&#93;;review_policy_digest:string;review_rubrics:string&#91;&#93;;required_graph:boolean…</code> |
| `IntegrationConfig` | interface | 132 | <code>export interface IntegrationConfig {version:1;organisation_id:string;root:string;repositories:RepositoryConfig&#91;&#93;;closure:Record&lt;string,unknown&gt;}</code> |
| `config` | function | 133 | <code>export async function config(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;IntegrationConfig&gt;{</code> |
| `safeDirectory` | function | 153 | <code>export async function safeDirectory(root:string,directory:string):Promise&lt;string&gt;{</code> |
| `repository` | function | 159 | <code>export function repository(c:IntegrationConfig,id:string):RepositoryConfig{return c.repositories.find(r=&gt;r.repository_id===id)??fail('INTEGRATION_REPOSITORY_UNKNOWN','Repository absent from trusted pr…</code> |
| `git` | function | 160 | <code>export async function git(directory:string,args:string&#91;&#93;,env:NodeJS.ProcessEnv={}):Promise&lt;string&gt;{</code> |
| `isolatedPush` | function | 166 | <code>export async function isolatedPush(repositoryPath:string,args:string&#91;&#93;,environment:Readonly&lt;NodeJS.ProcessEnv&gt;,transport:'file'&#124;'https'):Promise&lt;{stdout:string;stderr:string}&gt;{</code> |
| `custody` | function | 177 | <code>export async function custody(db:DB,s:Scope,id:string,expectedGeneration?:string):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `CandidateManifest` | interface | 188 | <code>export interface CandidateManifest {</code> |
| `readCandidate` | function | 195 | <code>export async function readCandidate(db:DB,s:Scope,id:string,lock=false):Promise&lt;{row:Record&lt;string,any&gt;;manifest:CandidateManifest}&gt;{</code> |
| `ReviewPhase` | type | 199 | <code>type ReviewPhase='ADMISSION'&#124;'CURRENT_PUBLISHED';</code> |
| `completeReview` | function | 200 | <code>function completeReview(result:Record&lt;string,any&gt;):boolean{</code> |
| `latestPublishedCandidate` | function | 203 | <code>async function latestPublishedCandidate(db:DB,s:Scope,m:CandidateManifest,id:string):Promise&lt;void&gt;{</code> |
| `reviewCoverage` | function | 207 | <code>export async function reviewCoverage(db:DB,s:Scope,m:CandidateManifest,inputDigest:string,candidateId:string,phase:ReviewPhase='ADMISSION'):Promise&lt;{digest:string;observations:Record&lt;string,any&gt;&#91;&#93;}&gt;{</code> |
| `bindReviews` | function | 223 | <code>async function bindReviews(pool:DB,input:unknown):Promise&lt;unknown&gt;{</code> |
| `gateOutcomes` | function | 243 | <code>export async function gateOutcomes(db:DB,s:Scope,id:string,row:Record&lt;string,any&gt;,m:CandidateManifest):Promise&lt;Record&lt;string,any&gt;&#91;&#93;&gt;{</code> |
| `commitSetEvidence` | function | 247 | <code>export function commitSetEvidence(row:Record&lt;string,any&gt;,m:CandidateManifest):Record&lt;string,unknown&gt;{</code> |
| `Readiness` | interface | 250 | <code>interface Readiness {s:Scope;id:string;run:Record&lt;string,any&gt;;row:Record&lt;string,any&gt;;m:CandidateManifest;reviews?:{digest:string;observations:Record&lt;string,any&gt;&#91;&#93;}}</code> |
| `candidateReady` | function | 282 | <code>export async function candidateReady(db:DB,s:Scope,id:string,admittedPublicationId?:string):Promise&lt;{row:Record&lt;string,any&gt;;manifest:CandidateManifest}&gt;{</code> |
| `candidateStatus` | function | 291 | <code>async function candidateStatus(pool:DB,input:unknown):Promise&lt;unknown&gt;{</code> |
| `createCandidate` | function | 313 | <code>async function createCandidate(pool:DB,cfg:IntegrationConfig,input:unknown):Promise&lt;unknown&gt;{</code> |
| `runGates` | function | 386 | <code>async function runGates(pool:DB,_cfg:IntegrationConfig,_env:Readonly&lt;NodeJS.ProcessEnv&gt;,input:unknown):Promise&lt;unknown&gt;{</code> |
| `remoteGateRuntime` | function | 402 | <code>async function remoteGateRuntime():Promise&lt;void&gt;{</code> |
| `executeCandidateJob` | function | 406 | <code>async function executeCandidateJob(pool:DB,s:Scope,id:string,job:{id:string;row:Record&lt;string,any&gt;;plans:{gate:GateConfig;prepared:Awaited&lt;ReturnType&lt;typeof prepareRemote&gt;&gt;}&#91;&#93;;verificationInput:string…</code> |
| `recoverCandidateJob` | function | 419 | <code>async function recoverCandidateJob(pool:DB,input:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 431 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/integration/cleanup.ts

[Open source](../../services/hyperfide/src/integration/cleanup.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CleanupDebt` | interface | 9 | <code>export interface CleanupDebt {kind:string;resource:string;reason:string}</code> |
| `releaseTerminalReservations` | function | 17 | <code>export async function releaseTerminalReservations(db:DB,s:Scope,jobId?:string):Promise&lt;string&#91;&#93;&gt;{</code> |
| `refs` | function | 26 | <code>async function refs(directory:string):Promise&lt;string&#91;&#93;&gt;{</code> |
| `cleanupIntegration` | function | 29 | <code>export async function cleanupIntegration(pool:DB,cfg:IntegrationConfig,input:unknown):Promise&lt;unknown&gt;{</code> |

## services/hyperfide/src/integration/closure.ts

[Open source](../../services/hyperfide/src/integration/closure.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `semanticHold` | function | 11 | <code>function semanticHold(error:unknown):void{</code> |
| `Level` | type | 14 | <code>type Level='TASK'&#124;'WAVE'&#124;'PROGRAMME';</code> |
| `ScopeGate` | interface | 15 | <code>interface ScopeGate extends GateConfig {covers:string&#91;&#93;;proof:{manifest_path:string;manifest_digest:string;registry_path:string;registry_digest:string;expected_assertion_ids:string&#91;&#93;;case_ids:string&#91;&#93;…</code> |
| `ClosurePolicy` | interface | 16 | <code>interface ClosurePolicy {wave_gates:ScopeGate&#91;&#93;;programme_gates:ScopeGate&#91;&#93;;required_acceptance_ids:string&#91;&#93;;required_docs:boolean;end_to_end_ids?:string&#91;&#93;;activation_rehearsal_ids?:string&#91;&#93;}</code> |
| `ClosureObligation` | interface | 18 | <code>export interface ClosureObligation {level:Level;id:string;met:boolean;reason:string&#124;null;detail?:unknown}</code> |
| `closurePolicy` | function | 20 | <code>export function closurePolicy(c:IntegrationConfig):ClosurePolicy{</code> |
| `programmeCaseObligations` | function | 34 | <code>export function programmeCaseObligations(policy:ClosurePolicy,receipts:Record&lt;string,any&gt;&#91;&#93;,inputDigest:string):ClosureObligation&#91;&#93;{</code> |
| `registerClosurePolicy` | function | 47 | <code>async function registerClosurePolicy(db:DB,s:Scope,cfg:IntegrationConfig):Promise&lt;void&gt;{</code> |
| `closureSnapshot` | function | 54 | <code>export async function closureSnapshot(db:DB,s:Scope,level:Level,wave?:number,taskId?:string,admittedWork?:AdmittedIntegrationWork):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `parse` | function | 100 | <code>function parse(input:unknown):{s:Scope;level:Level;wave?:number;taskId?:string}{</code> |
| `evaluateClosure` | function | 108 | <code>export async function evaluateClosure(pool:import('./candidates.js').DB,cfg:IntegrationConfig,input:unknown):Promise&lt;unknown&gt;{</code> |
| `dependentRelease` | function | 172 | <code>async function dependentRelease(db:DB,s:Scope,taskIds:string&#91;&#93;):Promise&lt;Record&lt;string,unknown&gt;&#91;&#93;&gt;{</code> |
| `integratedRepositoryManifest` | function | 186 | <code>export function integratedRepositoryManifest(snapshot:Record&lt;string,any&gt;):Record&lt;string,string&gt;&#91;&#93;{</code> |
| `integratedManifestDigest` | function | 193 | <code>export function integratedManifestDigest(snapshot:Record&lt;string,any&gt;):string{return hash(canonical(integratedRepositoryManifest(snapshot)));}</code> |
| `proofFile` | function | 195 | <code>async function proofFile(root:string,name:string):Promise&lt;Buffer&gt;{</code> |
| `registeredScopeGate` | function | 201 | <code>export async function registeredScopeGate(gate:ScopeGate,cwd:string,work:string,inputDigest:string,env:Readonly&lt;NodeJS.ProcessEnv&gt;,requireFull=true):Promise&lt;{stdout:string;stderr:string;exitCode:numbe…</code> |
| `verifyScope` | function | 238 | <code>async function verifyScope(pool:import('./candidates.js').DB,cfg:IntegrationConfig,_env:Readonly&lt;NodeJS.ProcessEnv&gt;,input:unknown):Promise&lt;unknown&gt;{</code> |
| `executeScopeJob` | function | 255 | <code>async function executeScopeJob(pool:DB,p:ReturnType&lt;typeof parse&gt;,prepared:{id:string;snapshot:Record&lt;string,any&gt;;inputDigest:string;plans:{gate:ScopeGate;remote:Awaited&lt;ReturnType&lt;typeof prepareRemot…</code> |
| `recoverScopeJob` | function | 267 | <code>async function recoverScopeJob(pool:DB,input:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 279 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |
| `qualifiedIntegratedOutcomes` | function | 290 | <code>export async function qualifiedIntegratedOutcomes(db:DB,s:Scope):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `inspectProgrammeClosure` | function | 313 | <code>export async function inspectProgrammeClosure(db:DB,invocation:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |

## services/hyperfide/src/integration/github.ts

[Open source](../../services/hyperfide/src/integration/github.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GitHubProfile` | interface | 21 | <code>interface GitHubProfile {</code> |
| `GitHubProtection` | interface | 26 | <code>export interface GitHubProtection {</code> |
| `GitHubIntent` | interface | 31 | <code>export interface GitHubIntent {</code> |
| `HostedResult` | interface | 35 | <code>export interface HostedResult {outcome:'PUBLISHED'&#124;'REJECTED'&#124;'UNKNOWN';observed_head:string;credential_revocation:'CONFIRMED'&#124;'UNKNOWN';rules_digest:string;push_issued?:boolean;credential_expires_at?…</code> |
| `GitHubTransport` | type | 36 | <code>export type GitHubTransport=(route:string,token:string,method?:string,body?:unknown)=&gt;Promise&lt;{status:number;body:unknown}&gt;;</code> |
| `privateBytes` | function | 37 | <code>async function privateBytes(filename:string,max=65536):Promise&lt;Buffer&gt;{</code> |
| `githubHTTP` | function | 41 | <code>export async function githubHTTP(route:string,token:string,method='GET',body?:unknown):Promise&lt;{status:number;body:unknown}&gt;{</code> |
| `integer` | function | 51 | <code>function integer(v:unknown):number{if(!Number.isSafeInteger(v)&#124;&#124;Number(v)&lt;1)fail('GITHUB_CONFIG_INVALID','Positive provider integer required');return Number(v);}</code> |
| `loadGitHubProfile` | function | 52 | <code>export async function loadGitHubProfile(env:Readonly&lt;NodeJS.ProcessEnv&gt;,repositoryId:string):Promise&lt;GitHubProfile&gt;{</code> |
| `validateGitHubProtection` | function | 62 | <code>export function validateGitHubProtection(profile:GitHubProfile,repository:unknown,activeRules:unknown,rulesets:unknown&#91;&#93;,classic:unknown):string{</code> |
| `GitHubPublicationAdapter` | class | 81 | <code>export class GitHubPublicationAdapter {</code> |
| `constructor` | method | 82 | <code>constructor(private readonly profile:GitHubProfile,private readonly env:Readonly&lt;NodeJS.ProcessEnv&gt;,private readonly request:GitHubTransport=githubHTTP){}</code> |
| `base` | method | 83 | <code>private base():string{return '/repos/'+encodeURIComponent(this.profile.owner)+'/'+encodeURIComponent(this.profile.repository);}</code> |
| `audit` | method | 84 | <code>private async audit():Promise&lt;string&gt;{const value=(await privateBytes(this.profile.audit_token_file)).toString('utf8').trim();if(!value&#124;&#124;/&#92;s/.test(value))fail('GITHUB_CONFIG_INVALID','Audit credential…</code> |
| `jwt` | method | 85 | <code>private async jwt():Promise&lt;string&gt;{</code> |
| `observeHead` | method | 89 | <code>async observeHead():Promise&lt;string&gt;{</code> |
| `denial` | method | 93 | <code>private async denial(rulesDigest:string):Promise&lt;string&gt;{</code> |
| `inspectProtection` | method | 100 | <code>async inspectProtection():Promise&lt;GitHubProtection&gt;{</code> |
| `credentialPath` | method | 113 | <code>private credentialPath(intent:GitHubIntent):string{return path.join(this.profile.credential_directory,intent.operation_id+'.json');}</code> |
| `persistCredential` | method | 114 | <code>private async persistCredential(intent:GitHubIntent,token:Record&lt;string,unknown&gt;):Promise&lt;void&gt;{</code> |
| `revokeCredential` | method | 118 | <code>async revokeCredential(intent:GitHubIntent):Promise&lt;boolean&gt;{</code> |
| `preflightCustody` | method | 128 | <code>private async preflightCustody(intent:GitHubIntent):Promise&lt;void&gt;{</code> |
| `publish` | method | 134 | <code>async publish(intent:GitHubIntent,repositoryPath:string):Promise&lt;HostedResult&gt;{</code> |
| `reconcile` | method | 163 | <code>async reconcile(intent:GitHubIntent):Promise&lt;HostedResult&gt;{</code> |
| `githubAdapter` | function | 168 | <code>export async function githubAdapter(env:Readonly&lt;NodeJS.ProcessEnv&gt;,repositoryId:string):Promise&lt;GitHubPublicationAdapter&gt;{return new GitHubPublicationAdapter(await loadGitHubProfile(env,repositoryId)…</code> |

## services/hyperfide/src/integration/publication.ts

[Open source](../../services/hyperfide/src/integration/publication.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `hostedIntent` | function | 13 | <code>function hostedIntent(op:Record&lt;string,any&gt;,m:Record&lt;string,any&gt;):GitHubIntent{return {organisation_id:op.organisation_id,run_id:op.run_id,operation_id:op.id,operation_generation:String(op.operation_g…</code> |
| `hostedReceipt` | function | 14 | <code>async function hostedReceipt(db:import('./candidates.js').DB,s:Scope,id:string,result:HostedResult):Promise&lt;void&gt;{await db.query('INSERT INTO hyperfide.publication_hosted_receipts(organisation_id,run_…</code> |
| `ProtectedRemoteEvidence` | interface | 17 | <code>export interface ProtectedRemoteEvidence {</code> |
| `ProtectedRemoteAdapter` | interface | 22 | <code>export interface ProtectedRemoteAdapter {</code> |
| `inspectProtection` | method | 23 | <code>inspectProtection(scope:Scope,repositoryId:string):Promise&lt;{status:'ENFORCED'&#124;'UNSUPPORTED'&#124;'UNKNOWN';evidence?:ProtectedRemoteEvidence}&gt;;</code> |
| `publish` | method | 24 | <code>publish(intent:Readonly&lt;Permit&gt;,evidence:ProtectedRemoteEvidence):Promise&lt;{outcome:'PUBLISHED'&#124;'REJECTED'&#124;'UNKNOWN';observed_head?:string}&gt;;</code> |
| `reconcile` | method | 25 | <code>reconcile(intent:Readonly&lt;Permit&gt;):Promise&lt;{outcome:'PUBLISHED'&#124;'REJECTED'&#124;'UNKNOWN';observed_head?:string}&gt;;</code> |
| `Permit` | interface | 27 | <code>interface Permit {version:1;organisation_id:string;run_id:string;operation_id:string;generation:string;repository_id:string;ref:string;old:string;next:string;input_digest:string}</code> |
| `secret` | function | 28 | <code>async function secret(env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;Buffer&gt;{</code> |
| `sign` | function | 32 | <code>function sign(p:Permit,key:Buffer):string{const body=Buffer.from(canonical(p)).toString('base64url');return body+'.'+createHmac('sha256',key).update(body).digest('base64url');}</code> |
| `verify` | function | 33 | <code>function verify(token:string,key:Buffer):Permit{</code> |
| `receivePermit` | function | 41 | <code>export async function receivePermit(db:unknown,key:Buffer,token:string,lines:string,receivePath:string,cfg:IntegrationConfig,trustedGateway?:{withPrimaryTransaction:&lt;T&gt;(options:{timeoutMs:number;maxRe…</code> |
| `operation` | function | 54 | <code>async function operation(pool:import('./candidates.js').DB,s:Scope,id:string):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `authorizeGitRoute` | function | 57 | <code>async function authorizeGitRoute(repositoryId:string,targetRef:string):Promise&lt;void&gt;{</code> |
| `authorize` | function | 63 | <code>async function authorize(pool:import('./candidates.js').DB,input:unknown):Promise&lt;unknown&gt;{</code> |
| `reconcilePublication` | function | 79 | <code>export async function reconcilePublication(pool:import('./candidates.js').DB,cfg:IntegrationConfig,s:Scope,id:string,transportSettled=false,env:Readonly&lt;NodeJS.ProcessEnv&gt;=process.env,hostedResult?:Ho…</code> |
| `headChanged` | function | 125 | <code>async function headChanged(pool:import('./candidates.js').DB,s:Scope,id:string,intent:string):Promise&lt;never&gt;{</code> |
| `executePublication` | function | 130 | <code>async function executePublication(pool:import('./candidates.js').DB,cfg:IntegrationConfig,env:Readonly&lt;NodeJS.ProcessEnv&gt;,input:unknown):Promise&lt;unknown&gt;{</code> |
| `pushManaged` | function | 166 | <code>export async function pushManaged(repositoryPath:string,receivePath:string,ref:string,next:string,old:string,permitToken:string,env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;void&gt;{</code> |
| `installGatewayHook` | function | 169 | <code>export async function installGatewayHook(receivePath:string,serverConfigPath:string,node=process.execPath):Promise&lt;void&gt;{</code> |
| `inspectIntegratedPublication` | function | 179 | <code>export async function inspectIntegratedPublication(db:import('./candidates.js').DB,s:Scope,pins:{task_id:string;custody_id:string;custody_generation:string}):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `acceptPublished` | function | 197 | <code>async function acceptPublished(pool:import('./candidates.js').DB,cfg:IntegrationConfig,env:Readonly&lt;NodeJS.ProcessEnv&gt;,input:unknown):Promise&lt;unknown&gt;{</code> |
| `stopIntegration` | function | 226 | <code>export async function stopIntegration(db:import('./candidates.js').DB,s:Scope,control:{mode:'CANCEL'&#124;'STOP';control_generation:string}):Promise&lt;{cancelled_operation_ids:string&#91;&#93;;unresolved_operation_i…</code> |
| `createComponent` | function | 247 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/integration/release_barrier.ts

[Open source](../../services/hyperfide/src/integration/release_barrier.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `readBarrier` | function | 7 | <code>async function readBarrier(pool:DB,s:Scope,id:string,lock=false):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `candidateSet` | function | 11 | <code>function candidateSet(v:unknown):string&#91;&#93;{</code> |
| `insertBarrier` | function | 16 | <code>async function insertBarrier(db:DB,s:Scope,request:string,ids:string&#91;&#93;,policy:string,supersedes?:{barrier_id:string;manifest_digest:string;recovery_id:string}):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `createBarrier` | function | 30 | <code>async function createBarrier(pool:DB,cfg:IntegrationConfig,input:unknown):Promise&lt;unknown&gt;{</code> |
| `latestObservations` | function | 40 | <code>async function latestObservations(db:DB,s:Scope,id:string):Promise&lt;Record&lt;string,any&gt;&#91;&#93;&gt;{</code> |
| `readRecovery` | function | 43 | <code>async function readRecovery(db:DB,s:Scope,id:string):Promise&lt;Record&lt;string,any&gt;&#124;undefined&gt;{</code> |
| `recoveryStatus` | function | 50 | <code>function recoveryStatus(recovery:Record&lt;string,any&gt;,heads:Map&lt;string,string&#124;null&gt;):Record&lt;string,unknown&gt;{</code> |
| `observeHeads` | function | 57 | <code>async function observeHeads(cfg:IntegrationConfig,targets:Record&lt;string,any&gt;&#91;&#93;):Promise&lt;Map&lt;string,string&#124;null&gt;&gt;{</code> |
| `classify` | function | 64 | <code>function classify(op:Record&lt;string,any&gt;&#124;undefined,head:string,old:string&#124;null,observed:string&#124;null):string{</code> |
| `derive` | function | 71 | <code>function derive(outcomes:Record&lt;string,any&gt;&#91;&#93;):string{</code> |
| `refresh` | function | 74 | <code>async function refresh(pool:DB,cfg:IntegrationConfig,s:Scope,id:string):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `release` | function | 97 | <code>async function release(pool:DB,cfg:IntegrationConfig,input:unknown):Promise&lt;unknown&gt;{</code> |
| `recover` | function | 114 | <code>async function recover(pool:DB,cfg:IntegrationConfig,input:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 157 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/review/contracts.ts

[Open source](../../services/hyperfide/src/review/contracts.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Endpoint` | interface | 8 | <code>interface Endpoint {repository_id:string;source_object_id:string;symbol_ids:string&#91;&#93;}</code> |
| `ConsumerOrigin` | type | 9 | <code>type ConsumerOrigin='BASELINE'&#124;'CANDIDATE'&#124;'GRAPH';</code> |
| `AffectedConsumer` | interface | 10 | <code>interface AffectedConsumer extends Endpoint {origins:ConsumerOrigin&#91;&#93;}</code> |
| `ContractDefinition` | interface | 11 | <code>interface ContractDefinition {</code> |
| `endpoint` | function | 15 | <code>function endpoint(value:unknown):Endpoint{</code> |
| `definition` | function | 19 | <code>function definition(value:unknown):ContractDefinition{</code> |
| `publishContract` | function | 40 | <code>export async function publishContract(context:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `GraphCapability` | interface | 65 | <code>interface GraphCapability {traverse(input:unknown,invocation:unknown):Promise&lt;unknown&gt;;status(input:unknown,invocation:unknown):Promise&lt;unknown&gt;}</code> |
| `traverse` | method | 65 | <code>interface GraphCapability {traverse(input:unknown,invocation:unknown):Promise&lt;unknown&gt;;status(input:unknown,invocation:unknown):Promise&lt;unknown&gt;}</code> |
| `status` | method | 65 | <code>interface GraphCapability {traverse(input:unknown,invocation:unknown):Promise&lt;unknown&gt;;status(input:unknown,invocation:unknown):Promise&lt;unknown&gt;}</code> |
| `graphCapability` | function | 66 | <code>function graphCapability(value:unknown):value is GraphCapability{</code> |
| `analyseContractImpact` | function | 69 | <code>export async function analyseContractImpact(context:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `ContractCoverageBinding` | interface | 146 | <code>export interface ContractCoverageBinding {repository_id:string;source_object_id:string;candidate_digest?:string;input_manifest_digest?:string}</code> |
| `inspectContractCoverage` | function | 147 | <code>export async function inspectContractCoverage(db:ReviewDb,binding:ReviewScope,contractIds:string&#91;&#93;,source:ContractCoverageBinding):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 191 | <code>export function createComponent(_context:ComponentContext):Component{</code> |

## services/hyperfide/src/review/coverage.ts

[Open source](../../services/hyperfide/src/review/coverage.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ReviewDb` | type | 15 | <code>export type ReviewDb=Pick&lt;PrimaryTransaction,'query'&gt;;</code> |
| `ReviewScope` | interface | 16 | <code>export interface ReviewScope {organisation_id:string;run_id:string}</code> |
| `ReviewCoverageQuery` | interface | 17 | <code>export interface ReviewCoverageQuery {</code> |
| `fail` | function | 21 | <code>export function fail(code:string,message:string):never {throw new FoundationError(code,message);}</code> |
| `obj` | function | 22 | <code>export function obj(value:unknown,fields:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `uuid` | function | 29 | <code>export function uuid(value:unknown):string{</code> |
| `digest` | function | 33 | <code>export function digest(value:unknown):string{</code> |
| `oid` | function | 36 | <code>export function oid(value:unknown):string{</code> |
| `text` | function | 39 | <code>export function text(value:unknown,max=2048):string{</code> |
| `decimal` | function | 42 | <code>export function decimal(value:unknown):string{</code> |
| `scope` | function | 46 | <code>export function scope(value:Record&lt;string,unknown&gt;):ReviewScope{</code> |
| `canonical` | function | 49 | <code>export function canonical(value:unknown,depth=0):string{</code> |
| `hash` | function | 57 | <code>export function hash(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}</code> |
| `strings` | function | 58 | <code>export function strings(value:unknown,max=128):string&#91;&#93;{</code> |
| `primary` | function | 62 | <code>export async function primary(db:ReviewDb):Promise&lt;void&gt;{</code> |
| `ReviewInvocation` | interface | 66 | <code>interface ReviewInvocation {</code> |
| `ReviewGateway` | interface | 70 | <code>interface ReviewGateway {</code> |
| `withPrimaryTransaction` | method | 71 | <code>withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;signal:AbortSignal;guard:(db:ReviewDb)=&gt;Promise&lt;void&gt;},</code> |
| `authorizeReview` | function | 74 | <code>export function authorizeReview(context:ComponentContext,binding:ReviewScope,roles?:readonly string&#91;&#93;):</code> |
| `lockReviewDisposition` | function | 91 | <code>export async function lockReviewDisposition(db:ReviewDb,binding:ReviewScope,exclusive=false):Promise&lt;void&gt;{</code> |
| `transaction` | function | 95 | <code>export async function transaction&lt;T&gt;(context:ComponentContext,binding:ReviewScope,</code> |
| `reviewError` | function | 112 | <code>export function reviewError(error:unknown):FoundationError{</code> |
| `Watcher` | interface | 119 | <code>interface Watcher {watcher_id:string;reviewer_session_id:string;rubric_digest:string;review_class:string;path_prefixes:string&#91;&#93;}</code> |
| `WatcherPolicy` | interface | 120 | <code>interface WatcherPolicy {revision:string;mode:'ALL_COMMITS'&#124;'SPECIALIST';watchers:Watcher&#91;&#93;}</code> |
| `policy` | function | 121 | <code>function policy(value:unknown):WatcherPolicy{</code> |
| `configureReviewPolicy` | function | 144 | <code>export async function configureReviewPolicy(context:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `RepositoryConfig` | interface | 170 | <code>interface RepositoryConfig {path:string;refs:string&#91;&#93;}</code> |
| `repositoryConfig` | function | 171 | <code>async function repositoryConfig(env:Readonly&lt;NodeJS.ProcessEnv&gt;,repositoryId:string):Promise&lt;RepositoryConfig&gt;{</code> |
| `git` | function | 189 | <code>async function git(repository:string,args:string&#91;&#93;,acceptable:number&#91;&#93;=&#91;0&#93;):Promise&lt;string&gt;{</code> |
| `heads` | function | 203 | <code>async function heads(config:RepositoryConfig):Promise&lt;Record&lt;string,string&gt;&gt;{</code> |
| `Commit` | interface | 208 | <code>interface Commit {source_object_id:string;tree_object_id:string;parent_objects:string&#91;&#93;;changed_paths:string&#91;&#93;;attribution:Record&lt;string,unknown&gt;}</code> |
| `discoverReviewCommits` | function | 209 | <code>export async function discoverReviewCommits(context:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `dependencyDigest` | function | 285 | <code>export async function dependencyDigest(db:ReviewDb,binding:ReviewScope):Promise&lt;string&gt;{</code> |
| `relevantContracts` | function | 290 | <code>export async function relevantContracts(db:ReviewDb,binding:ReviewScope,repositories:string&#91;&#93;):Promise&lt;Array&lt;{id:string;revision:string;criteria_digest:string;definition:Record&lt;string,unknown&gt;}&gt;&gt;{</code> |
| `reviewTaskVersions` | function | 302 | <code>export async function reviewTaskVersions(db:ReviewDb,binding:ReviewScope,sources:unknown&#91;&#93;):Promise&lt;Array&lt;Record&lt;string,unknown&gt;&gt;&gt;{</code> |
| `reviewInputCurrent` | function | 306 | <code>export async function reviewInputCurrent(db:ReviewDb,binding:ReviewScope,snapshot:Record&lt;string,unknown&gt;):Promise&lt;boolean&gt;{</code> |
| `ReviewCoverageSummary` | interface | 339 | <code>export interface ReviewCoverageSummary {</code> |
| `inspectReviewCoverage` | function | 344 | <code>export async function inspectReviewCoverage(db:ReviewDb,binding:ReviewScope,query:ReviewCoverageQuery):Promise&lt;ReviewCoverageSummary&gt;{</code> |
| `createComponent` | function | 391 | <code>export function createComponent(_context:ComponentContext):Component{</code> |
| `ReviewControl` | interface | 407 | <code>export interface ReviewControl {</code> |
| `assertReviewExecutionAllowed` | function | 411 | <code>export async function assertReviewExecutionAllowed(context:ComponentContext,db:ReviewDb,binding:ReviewScope,</code> |
| `reviewControlMatches` | function | 434 | <code>export async function reviewControlMatches(db:ReviewDb,binding:ReviewScope,control:ReviewControl,</code> |
| `reviewAttributionComplete` | function | 455 | <code>export async function reviewAttributionComplete(db:ReviewDb,binding:ReviewScope,sources:unknown&#91;&#93;):Promise&lt;boolean&gt;{</code> |
| `reviewGraphCustodyCurrent` | function | 462 | <code>export async function reviewGraphCustodyCurrent(db:ReviewDb,binding:ReviewScope,manifestId:string):Promise&lt;boolean&gt;{</code> |

## services/hyperfide/src/review/receipts.ts

[Open source](../../services/hyperfide/src/review/receipts.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Source` | interface | 7 | <code>interface Source {repository_id:string;source_object_id:string}</code> |
| `sources` | function | 8 | <code>function sources(value:unknown):Source&#91;&#93;{</code> |
| `snapshot` | function | 14 | <code>async function snapshot(db:ReviewDb,binding:ReviewScope,candidateDigest:string,value:unknown,context?:ComponentContext):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `buildReviewSnapshot` | function | 62 | <code>export async function buildReviewSnapshot(db:ReviewDb,binding:ReviewScope,candidateDigest:string,value:unknown,context?:ComponentContext):Promise&lt;Record&lt;string,unknown&gt;&gt;{return snapshot(db,binding,can…</code> |
| `bindReviewInputs` | function | 63 | <code>export async function bindReviewInputs(context:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `Observation` | interface | 94 | <code>interface Observation {evidence_id:string;origin_task_id:string;origin_attempt_id:string;contract_id:string&#124;null;failure_fingerprint:string;summary:string;severity:string}</code> |
| `observations` | function | 95 | <code>function observations(value:unknown):Observation&#91;&#93;{</code> |
| `watcherReservation` | function | 104 | <code>async function watcherReservation(db:ReviewDb,binding:ReviewScope,actor:string,sandbox:string,boot:string):Promise&lt;void&gt;{</code> |
| `REVIEW_CERTIFICATION` | object | 111 | <code>export const REVIEW_CERTIFICATION={certifies_correctness:false,decision_model_role:'ADVISORY_RISK_RANK_ONLY',coverage_authority:'ASSIGNED_INDEPENDENT_WATCHER_RECEIPT'};</code> |
| `refuseDecisionCertification` | function | 112 | <code>function refuseDecisionCertification(value:unknown):void{</code> |
| `submitReviewReceipt` | function | 116 | <code>export async function submitReviewReceipt(context:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `claimReviewObligation` | function | 188 | <code>export async function claimReviewObligation(context:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `reconcileReviewInputs` | function | 208 | <code>export async function reconcileReviewInputs(db:ReviewDb,binding:ReviewScope,afterId:string&#124;null=null,limit=100):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 222 | <code>export function createComponent(_context:ComponentContext):Component{</code> |
| `fenceReviewObligations` | function | 248 | <code>export async function fenceReviewObligations(db:ReviewDb,binding:ReviewScope,control:ReviewControl):Promise&lt;unknown&gt;{</code> |
| `renewReviewObligation` | function | 262 | <code>export async function renewReviewObligation(context:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |

## services/hyperfide/src/review/reproductions.ts

[Open source](../../services/hyperfide/src/review/reproductions.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Data` | type | 12 | <code>type Data=Record&lt;string,any&gt;;</code> |
| `Runner` | interface | 13 | <code>interface Runner {</code> |
| `prepare` | method | 14 | <code>prepare(db:ReviewDb,invocation:unknown,input:unknown):Promise&lt;unknown&gt;;</code> |
| `execute` | method | 15 | <code>execute(permit:unknown,signal:AbortSignal):Promise&lt;unknown&gt;;</code> |
| `ArtifactStore` | interface | 17 | <code>interface ArtifactStore {invoke(action:string,input:unknown,context:ComponentContext):Promise&lt;unknown&gt;}</code> |
| `invoke` | method | 17 | <code>interface ArtifactStore {invoke(action:string,input:unknown,context:ComponentContext):Promise&lt;unknown&gt;}</code> |
| `capability` | function | 18 | <code>function capability&lt;T&gt;(ctx:ComponentContext,component:string,name:string,methods:string&#91;&#93;):T{</code> |
| `pairedId` | function | 23 | <code>function pairedId(planId:string):string{</code> |
| `loadRegistry` | function | 28 | <code>async function loadRegistry(db:ReviewDb,binding:ReviewScope,taskId:string):Promise&lt;Data&gt;{</code> |
| `custody` | function | 41 | <code>async function custody(db:ReviewDb,binding:ReviewScope,id:string):Promise&lt;Data&gt;{</code> |
| `selectedCheck` | function | 46 | <code>function selectedCheck(registry:Data,id:string):Data{</code> |
| `projectionGuidance` | function | 60 | <code>function projectionGuidance(value:unknown):Data&#91;&#93;{</code> |
| `uncertainGuidance` | function | 71 | <code>function uncertainGuidance(rows:Data&#91;&#93;):Data&#91;&#93;{</code> |
| `planReproduction` | function | 76 | <code>export async function planReproduction(ctx:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `lockJob` | function | 121 | <code>async function lockJob(db:ReviewDb,binding:ReviewScope,id:string):Promise&lt;Data&gt;{</code> |
| `assertCausalRepairCustody` | function | 126 | <code>async function assertCausalRepairCustody(db:ReviewDb,binding:ReviewScope,causalId:string,record:Data):Promise&lt;void&gt;{</code> |
| `currentJob` | function | 132 | <code>async function currentJob(db:ReviewDb,binding:ReviewScope,job:Data):Promise&lt;void&gt;{</code> |
| `assignReproduction` | function | 148 | <code>export async function assignReproduction(ctx:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `ownerJob` | function | 169 | <code>function ownerJob(ctx:ComponentContext,binding:ReviewScope,job:Data,generation:string):void{</code> |
| `bytesDigest` | function | 174 | <code>function bytesDigest(bytes:Buffer):string{return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}</code> |
| `upload` | function | 175 | <code>async function upload(ctx:ComponentContext,binding:ReviewScope,bytes:Buffer):Promise&lt;Data&gt;{</code> |
| `artifactRefCurrent` | function | 192 | <code>async function artifactRefCurrent(db:ReviewDb,binding:ReviewScope,ref:Data):Promise&lt;boolean&gt;{</code> |
| `captured` | function | 201 | <code>function captured(value:unknown):Buffer{</code> |
| `renewReproduction` | function | 209 | <code>export async function renewReproduction(ctx:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `ReproductionJobInputRequest` | interface | 228 | <code>export interface ReproductionJobInputRequest {</code> |
| `ReproductionExpectedInputs` | interface | 231 | <code>export interface ReproductionExpectedInputs {</code> |
| `readReproductionJobInputs` | function | 247 | <code>export async function readReproductionJobInputs(tx:PrimaryTransaction,invocation:InvocationContext,request:ReproductionJobInputRequest):Promise&lt;ReproductionExpectedInputs&gt;{</code> |
| `measuredReproductionInputs` | function | 273 | <code>async function measuredReproductionInputs(ctx:ComponentContext,db:ReviewDb,binding:ReviewScope,job:Data):Promise&lt;Data&gt;{</code> |
| `executeReproduction` | function | 285 | <code>export async function executeReproduction(ctx:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `receiptManifestDigest` | function | 387 | <code>function receiptManifestDigest(result:Data):string{const body={...result};delete body.evidence_ids;delete body.receipt_artifact;return hash(body);}</code> |
| `inspectReproduction` | function | 388 | <code>export async function inspectReproduction(db:ReviewDb,binding:ReviewScope,planId:string):Promise&lt;unknown&gt;{</code> |
| `fenceReproductionJobs` | function | 439 | <code>export async function fenceReproductionJobs(db:ReviewDb,binding:ReviewScope,control:ReviewControl):Promise&lt;unknown&gt;{</code> |
| `integratedSource` | function | 453 | <code>async function integratedSource(db:ReviewDb,binding:ReviewScope,record:Data,registry:Data,operationId:string,candidateDigest:string):Promise&lt;Data&gt;{</code> |
| `planCurrentSourceReproduction` | function | 465 | <code>export async function planCurrentSourceReproduction(ctx:ComponentContext,value:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 506 | <code>export function createComponent(context:ComponentContext):Component{</code> |
