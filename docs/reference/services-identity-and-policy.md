# Source reference: Control services: identity and policy

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the `identity/`, `observability/` and `policy/` subtrees of `services/hyperfide/src/`: 397 declarations in 14 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## services/hyperfide/src/identity/authorization.ts

[Open source](../../services/hyperfide/src/identity/authorization.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Rule` | interface | 9 | <code>interface Rule {role:string;actions:string&#91;&#93;;repositories:string&#91;&#93;;artifact_prefixes:string&#91;&#93;;git_refs:string&#91;&#93;;model_destinations:string&#91;&#93;;model_profiles:string&#91;&#93;}</code> |
| `AuthorizationAuthority` | interface | 10 | <code>export interface AuthorizationAuthority {authorize(i:InvocationContext):Promise&lt;void&gt;;resource(i:InvocationContext,input:unknown):Promise&lt;unknown&gt;}</code> |
| `authorize` | method | 10 | <code>export interface AuthorizationAuthority {authorize(i:InvocationContext):Promise&lt;void&gt;;resource(i:InvocationContext,input:unknown):Promise&lt;unknown&gt;}</code> |
| `resource` | method | 10 | <code>export interface AuthorizationAuthority {authorize(i:InvocationContext):Promise&lt;void&gt;;resource(i:InvocationContext,input:unknown):Promise&lt;unknown&gt;}</code> |
| `isAuthorizationAuthority` | function | 11 | <code>export function isAuthorizationAuthority(v:unknown):v is AuthorizationAuthority{return object(v)&amp;&amp;typeof v.authorize==='function'&amp;&amp;typeof v.resource==='function';}</code> |
| `code` | function | 17 | <code>function code(error:unknown):string{const c=(error as {code?:unknown})?.code;return typeof c==='string'&amp;&amp;/^&#91;A-Z_&#93;{1,64}$/.test(c)?c:'AUTHORIZATION_FAILED';}</code> |
| `audit` | function | 19 | <code>function audit(i:unknown,error:unknown,resource?:unknown):void{</code> |
| `list` | function | 26 | <code>function list(v:unknown):string&#91;&#93;{if(!Array.isArray(v)&#124;&#124;v.length&gt;256&#124;&#124;v.some(x=&gt;typeof x!=='string'&#124;&#124;!x.length&#124;&#124;x.length&gt;1024)&#124;&#124;new Set(v).size!==v.length)fail('AUTHORIZATION_CONFIG','Explicit bounded…</code> |
| `gitRef` | function | 27 | <code>function gitRef(v:string):boolean{return v.startsWith('refs/')&amp;&amp;!/&#91;&#92;x00-&#92;x20&#92;x7f~^:?&#42;&#92;&#92;&#91;&#93;/.test(v)&amp;&amp;!v.includes('..')&amp;&amp;!v.includes('@{')&amp;&amp;!v.endsWith('/')&amp;&amp;!v.endsWith('.')&amp;&amp;!v.split('/').some(p=&gt;!p&#124;&#124;…</code> |
| `rules` | function | 28 | <code>async function rules(ctx:ComponentContext):Promise&lt;readonly Rule&#91;&#93;&gt;{</code> |
| `createComponent` | function | 44 | <code>export async function createComponent(ctx:ComponentContext):Promise&lt;Component&gt;{</code> |

## services/hyperfide/src/identity/credentials.ts

[Open source](../../services/hyperfide/src/identity/credentials.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CredentialPurpose` | type | 11 | <code>export type CredentialPurpose='WORKER_BUILD'&#124;'WORKER_RUNTIME'&#124;'WORKER_PROCESS'&#124;'PROVIDER_API';</code> |
| `CredentialResolutionRequest` | interface | 12 | <code>export interface CredentialResolutionRequest {references:readonly {name:string;reference_id:string}&#91;&#93;;purpose:CredentialPurpose;sandbox_id:string;boot_id:string;boot_generation:string}</code> |
| `EnvironmentLayer` | type | 15 | <code>export type EnvironmentLayer='image'&#124;'build'&#124;'runtime'&#124;'process';</code> |
| `SecretLayer` | type | 16 | <code>export type SecretLayer=Exclude&lt;EnvironmentLayer,'image'&gt;;</code> |
| `LayeredEnvironment` | type | 17 | <code>export type LayeredEnvironment={readonly &#91;L in EnvironmentLayer&#93;:Readonly&lt;Record&lt;string,string&gt;&gt;};</code> |
| `CredentialStatus` | type | 20 | <code>export type CredentialStatus='AVAILABLE'&#124;'MISSING'&#124;'EXPIRED'&#124;'REVOKED'&#124;'AUTH_BLOCKED';</code> |
| `CredentialAvailability` | interface | 21 | <code>export interface CredentialAvailability {schema_version:1;reference_id:string;credential_version:string&#124;null;status:CredentialStatus;expires_at:string&#124;null;assignment_scope:{run_id:string;actor_id:str…</code> |
| `CredentialAuthority` | interface | 22 | <code>export interface CredentialAuthority {inspectInTransaction(tx:IdentityTransaction,i:InvocationContext,reference:string):Promise&lt;CredentialAvailability&gt;;resolveCredentialReferences(i:InvocationContext,…</code> |
| `inspectInTransaction` | method | 22 | <code>export interface CredentialAuthority {inspectInTransaction(tx:IdentityTransaction,i:InvocationContext,reference:string):Promise&lt;CredentialAvailability&gt;;resolveCredentialReferences(i:InvocationContext,…</code> |
| `resolveCredentialReferences` | method | 22 | <code>export interface CredentialAuthority {inspectInTransaction(tx:IdentityTransaction,i:InvocationContext,reference:string):Promise&lt;CredentialAvailability&gt;;resolveCredentialReferences(i:InvocationContext,…</code> |
| `inspect` | method | 22 | <code>export interface CredentialAuthority {inspectInTransaction(tx:IdentityTransaction,i:InvocationContext,reference:string):Promise&lt;CredentialAvailability&gt;;resolveCredentialReferences(i:InvocationContext,…</code> |
| `attach` | method | 22 | <code>export interface CredentialAuthority {inspectInTransaction(tx:IdentityTransaction,i:InvocationContext,reference:string):Promise&lt;CredentialAvailability&gt;;resolveCredentialReferences(i:InvocationContext,…</code> |
| `privateAttachment` | method | 22 | <code>export interface CredentialAuthority {inspectInTransaction(tx:IdentityTransaction,i:InvocationContext,reference:string):Promise&lt;CredentialAvailability&gt;;resolveCredentialReferences(i:InvocationContext,…</code> |
| `Source` | interface | 23 | <code>interface Source {name:string;relative_path:string;expires_at:string;purposes:CredentialPurpose&#91;&#93;}</code> |
| `Target` | interface | 24 | <code>interface Target {actor_id:string;uid:number;layers:string&#91;&#93;}</code> |
| `Configuration` | interface | 25 | <code>interface Configuration {secret_root:string;attachment_root:string;sources:Source&#91;&#93;;targets:Target&#91;&#93;}</code> |
| `isCredentialAuthority` | function | 26 | <code>export function isCredentialAuthority(v:unknown):v is CredentialAuthority{return object(v)&amp;&amp;typeof v.inspectInTransaction==='function'&amp;&amp;typeof v.resolveCredentialReferences==='function'&amp;&amp;typeof v.insp…</code> |
| `reference` | function | 27 | <code>function reference(v:unknown):v is string{return typeof v==='string'&amp;&amp;v.length&gt;0&amp;&amp;v.length&lt;=255&amp;&amp;/^&#91;A-Za-z0-9&#93;&#91;A-Za-z0-9._/-&#93;&#42;$/.test(v)&amp;&amp;!v.split('/').some(p=&gt;p==='..'&#124;&#124;p==='.'&#124;&#124;p==='');}</code> |
| `strings` | function | 28 | <code>function strings(v:unknown,allowed?:string&#91;&#93;):string&#91;&#93;{if(!Array.isArray(v)&#124;&#124;!v.length&#124;&#124;v.length&gt;128&#124;&#124;v.some(x=&gt;typeof x!=='string'&#124;&#124;!x.length&#124;&#124;allowed&amp;&amp;!allowed.includes(x))&#124;&#124;new Set(v).size!==v.leng…</code> |
| `composeEnvironment` | function | 29 | <code>export function composeEnvironment(layers:LayeredEnvironment&#124;unknown):Readonly&lt;Record&lt;string,string&gt;&gt;{</code> |
| `StreamingRedactor` | class | 36 | <code>export class StreamingRedactor {</code> |
| `constructor` | method | 38 | <code>constructor(secrets:readonly string&#91;&#93;){if(secrets.length&gt;128&#124;&#124;secrets.some(s=&gt;!s&#124;&#124;s.length&gt;65536))fail('REDACTION_CONFIG','Bounded nonempty secret values required');this.secrets=&#91;...new Set(secrets)&#93;.…</code> |
| `push` | method | 39 | <code>push(chunk:string,final=false):string{this.pending+=chunk;let out='';const boundary=final?this.pending.length:Math.max(0,this.pending.length-this.reserve);let index=0;while(index&lt;boundary){const found…</code> |
| `privateRoot` | function | 41 | <code>async function privateRoot(filename:string):Promise&lt;string&gt;{if(!path.isAbsolute(filename))fail('CREDENTIAL_CONFIG','Absolute private root required');const real=await fs.realpath(filename),s=await fs.l…</code> |
| `privateRead` | function | 42 | <code>async function privateRead(root:string,relative:string):Promise&lt;Buffer&gt;{</code> |
| `configuration` | function | 47 | <code>async function configuration(ctx:ComponentContext):Promise&lt;Configuration&gt;{</code> |
| `availability` | function | 57 | <code>function availability(reference_id:string,row:Record&lt;string,any&gt;&#124;undefined,i:InvocationContext,attachment_id:string&#124;null=null):CredentialAvailability{</code> |
| `discardRevoked` | function | 62 | <code>async function discardRevoked(config:Configuration,attachments:readonly unknown&#91;&#93;,locators:readonly unknown&#91;&#93;):Promise&lt;void&gt;{</code> |
| `createComponent` | function | 66 | <code>export async function createComponent(ctx:ComponentContext):Promise&lt;Component&gt;{</code> |
| `IsolationPermitClaims` | interface | 129 | <code>export interface IsolationPermitClaims {</code> |
| `IsolationPermitExpectation` | interface | 136 | <code>export interface IsolationPermitExpectation {</code> |
| `VerifiedIsolationPermit` | interface | 141 | <code>export interface VerifiedIsolationPermit extends IsolationPermitClaims {readonly permit_digest:string;readonly issuer_key_id:string}</code> |
| `IsolationPermitVerifier` | interface | 142 | <code>export interface IsolationPermitVerifier {verifySigned(serialized:Buffer&#124;string):VerifiedIsolationPermit;verify(serialized:Buffer&#124;string,expected:IsolationPermitExpectation):VerifiedIsolationPermit}</code> |
| `verifySigned` | method | 142 | <code>export interface IsolationPermitVerifier {verifySigned(serialized:Buffer&#124;string):VerifiedIsolationPermit;verify(serialized:Buffer&#124;string,expected:IsolationPermitExpectation):VerifiedIsolationPermit}</code> |
| `verify` | method | 142 | <code>export interface IsolationPermitVerifier {verifySigned(serialized:Buffer&#124;string):VerifiedIsolationPermit;verify(serialized:Buffer&#124;string,expected:IsolationPermitExpectation):VerifiedIsolationPermit}</code> |
| `verifiedIsolationPermits` | variable | 143 | <code>const verifiedIsolationPermits=new WeakSet&lt;object&gt;();</code> |
| `canonicalPermitJSON` | function | 144 | <code>function canonicalPermitJSON(value:unknown):string {</code> |
| `digestText` | function | 148 | <code>function digestText(v:unknown):v is string{return typeof v==='string'&amp;&amp;/^sha256:&#91;0-9a-f&#93;{64}$/.test(v);}</code> |
| `referenceKey` | function | 149 | <code>function referenceKey(v:unknown):v is string{return typeof v==='string'&amp;&amp;/^&#91;A-Za-z0-9&#93;&#91;A-Za-z0-9._:/-&#93;{0,127}$/.test(v);}</code> |
| `validateIsolationClaims` | function | 150 | <code>function validateIsolationClaims(v:unknown,nowMs:number):asserts v is IsolationPermitClaims {</code> |
| `isVerifiedIsolationPermit` | function | 158 | <code>export function isVerifiedIsolationPermit(value:unknown):value is VerifiedIsolationPermit{return object(value)&amp;&amp;verifiedIsolationPermits.has(value);}</code> |
| `assertVerifiedIsolationPermit` | function | 159 | <code>export function assertVerifiedIsolationPermit(value:unknown):asserts value is VerifiedIsolationPermit {</code> |
| `assertIsolationPermit` | function | 163 | <code>export function assertIsolationPermit(value:unknown,expected:IsolationPermitExpectation):asserts value is VerifiedIsolationPermit {</code> |
| `isolationSigningBytes` | function | 170 | <code>function isolationSigningBytes(keyId:string,payload:Buffer):Buffer{return Buffer.from('HYPERFIDE-ISOLATION-PERMIT-V1&#92;n'+keyId+'&#92;n'+hash(payload)+'&#92;n','utf8');}</code> |
| `issueIsolationPermit` | function | 171 | <code>export async function issueIsolationPermit(claims:IsolationPermitClaims,issuer:{key_id:string;private_key_file:string}):Promise&lt;string&gt;{</code> |
| `loadIsolationPermitVerifier` | function | 179 | <code>export async function loadIsolationPermitVerifier(configFile:string):Promise&lt;IsolationPermitVerifier&gt;{</code> |
| `WriterObservationPermitClaims` | type | 196 | <code>export type WriterObservationPermitClaims=Omit&lt;IsolationPermitClaims,'purpose'&gt;&amp;{readonly purpose:'EXTERNAL_WRITER_OBSERVATION_ONLY'};</code> |
| `VerifiedWriterObservationPermit` | interface | 197 | <code>export interface VerifiedWriterObservationPermit extends WriterObservationPermitClaims {readonly permit_digest:string;readonly issuer_key_id:string}</code> |
| `WriterObservationPermitVerifier` | interface | 198 | <code>export interface WriterObservationPermitVerifier {</code> |
| `verifySigned` | method | 199 | <code>verifySigned(serialized:Buffer&#124;string):VerifiedWriterObservationPermit;</code> |
| `verify` | method | 200 | <code>verify(serialized:Buffer&#124;string,expected:IsolationPermitExpectation):VerifiedWriterObservationPermit;</code> |
| `verifiedWriterObservationPermits` | variable | 202 | <code>const verifiedWriterObservationPermits=new WeakSet&lt;object&gt;();</code> |
| `validateWriterObservationClaims` | function | 203 | <code>function validateWriterObservationClaims(value:unknown,nowMs:number):asserts value is WriterObservationPermitClaims {</code> |
| `isVerifiedWriterObservationPermit` | function | 208 | <code>export function isVerifiedWriterObservationPermit(value:unknown):value is VerifiedWriterObservationPermit{return object(value)&amp;&amp;verifiedWriterObservationPermits.has(value);}</code> |
| `assertVerifiedWriterObservationPermit` | function | 209 | <code>export function assertVerifiedWriterObservationPermit(value:unknown):asserts value is VerifiedWriterObservationPermit {</code> |
| `assertWriterObservationPermit` | function | 213 | <code>export function assertWriterObservationPermit(value:unknown,expected:IsolationPermitExpectation):asserts value is VerifiedWriterObservationPermit {</code> |
| `writerObservationSigningBytes` | function | 220 | <code>function writerObservationSigningBytes(keyId:string,payload:Buffer):Buffer{return Buffer.from('HYPERFIDE-WRITER-OBSERVATION-PERMIT-V1&#92;n'+keyId+'&#92;n'+hash(payload)+'&#92;n','utf8');}</code> |
| `issueWriterObservationPermit` | function | 221 | <code>export async function issueWriterObservationPermit(claims:WriterObservationPermitClaims,issuer:{key_id:string;private_key_file:string}):Promise&lt;string&gt;{</code> |
| `loadWriterObservationPermitVerifier` | function | 229 | <code>export async function loadWriterObservationPermitVerifier(configFile:string):Promise&lt;WriterObservationPermitVerifier&gt;{</code> |

## services/hyperfide/src/identity/enrollment.ts

[Open source](../../services/hyperfide/src/identity/enrollment.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `IdentityTransaction` | type | 9 | <code>export type IdentityTransaction=AuthorityTransaction;</code> |
| `IdentityGateway` | interface | 10 | <code>export interface IdentityGateway {withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries?:number;signal?:AbortSignal;guard?:(tx:IdentityTransaction)=&gt;Promise&lt;void&gt;},operation:(tx:IdentityTrans…</code> |
| `withPrimaryTransaction` | method | 10 | <code>export interface IdentityGateway {withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries?:number;signal?:AbortSignal;guard?:(tx:IdentityTransaction)=&gt;Promise&lt;void&gt;},operation:(tx:IdentityTrans…</code> |
| `GlobalIdentityAuthority` | interface | 11 | <code>export interface GlobalIdentityAuthority {assertCurrent(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;authority_epoch:string}):Promise&lt;void&gt;}</code> |
| `assertCurrent` | method | 11 | <code>export interface GlobalIdentityAuthority {assertCurrent(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;authority_epoch:string}):Promise&lt;void&gt;}</code> |
| `FreshRunnerTarget` | interface | 12 | <code>export interface FreshRunnerTarget {sandbox_id:string;boot_id:string;boot_generation:string;provisioning_intent_id:string;credential_id:string;observed_after:string;grant_id?:string}</code> |
| `FreshRunnerObservation` | interface | 13 | <code>export interface FreshRunnerObservation {credential_id:string;sandbox_id:string;boot_id:string;boot_generation:string;grant_id:string;provisioning_intent_id:string;heartbeat_at:string;observation_only…</code> |
| `MainSessionIdentityBinding` | interface | 14 | <code>export interface MainSessionIdentityBinding {readonly organisation_id:string;readonly run_id:string;readonly session_id:string;readonly role:'LEADER'&#124;'FEATURE_MANAGER';readonly placement:'MAIN';readon…</code> |
| `MainSessionIdentityVerifier` | interface | 15 | <code>export interface MainSessionIdentityVerifier {verify(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;session_id:string},invocation:InvocationContext):Promise&lt;MainSessionIdentityBindi…</code> |
| `verify` | method | 15 | <code>export interface MainSessionIdentityVerifier {verify(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;session_id:string},invocation:InvocationContext):Promise&lt;MainSessionIdentityBindi…</code> |
| `IdentityAuthority` | interface | 16 | <code>export interface IdentityAuthority {installMainSessionVerifier(verifier:MainSessionIdentityVerifier):void;sealTrustedRegistrations():void;verifyFreshRunner(i:InvocationContext,tx:IdentityTransaction,t…</code> |
| `installMainSessionVerifier` | method | 16 | <code>export interface IdentityAuthority {installMainSessionVerifier(verifier:MainSessionIdentityVerifier):void;sealTrustedRegistrations():void;verifyFreshRunner(i:InvocationContext,tx:IdentityTransaction,t…</code> |
| `sealTrustedRegistrations` | method | 16 | <code>export interface IdentityAuthority {installMainSessionVerifier(verifier:MainSessionIdentityVerifier):void;sealTrustedRegistrations():void;verifyFreshRunner(i:InvocationContext,tx:IdentityTransaction,t…</code> |
| `verifyFreshRunner` | method | 16 | <code>export interface IdentityAuthority {installMainSessionVerifier(verifier:MainSessionIdentityVerifier):void;sealTrustedRegistrations():void;verifyFreshRunner(i:InvocationContext,tx:IdentityTransaction,t…</code> |
| `guard` | method | 16 | <code>export interface IdentityAuthority {installMainSessionVerifier(verifier:MainSessionIdentityVerifier):void;sealTrustedRegistrations():void;verifyFreshRunner(i:InvocationContext,tx:IdentityTransaction,t…</code> |
| `authenticate` | method | 16 | <code>export interface IdentityAuthority {installMainSessionVerifier(verifier:MainSessionIdentityVerifier):void;sealTrustedRegistrations():void;verifyFreshRunner(i:InvocationContext,tx:IdentityTransaction,t…</code> |
| `enroll` | method | 16 | <code>export interface IdentityAuthority {installMainSessionVerifier(verifier:MainSessionIdentityVerifier):void;sealTrustedRegistrations():void;verifyFreshRunner(i:InvocationContext,tx:IdentityTransaction,t…</code> |
| `authorize` | method | 16 | <code>export interface IdentityAuthority {installMainSessionVerifier(verifier:MainSessionIdentityVerifier):void;sealTrustedRegistrations():void;verifyFreshRunner(i:InvocationContext,tx:IdentityTransaction,t…</code> |
| `invocationOf` | function | 19 | <code>export function invocationOf(ctx:ComponentContext):InvocationContext {const i=(ctx as ComponentContext&amp;{invocation?:InvocationContext}).invocation;assertInvocation(i);return i;}</code> |
| `gatewayOf` | function | 20 | <code>export function gatewayOf(ctx:ComponentContext):IdentityGateway {const g=(ctx as unknown as {resources?:{gateway?:IdentityGateway}}).resources?.gateway;if(!g&#124;&#124;typeof g.withPrimaryTransaction!=='functi…</code> |
| `isIdentityAuthority` | function | 21 | <code>export function isIdentityAuthority(v:unknown):v is IdentityAuthority{return object(v)&amp;&amp;typeof v.guard==='function'&amp;&amp;typeof v.authenticate==='function'&amp;&amp;typeof v.enroll==='function'&amp;&amp;typeof v.authoriz…</code> |
| `allowed` | function | 22 | <code>function allowed(v:unknown):string&#91;&#93;{if(!Array.isArray(v)&#124;&#124;!v.length&#124;&#124;v.length&gt;256&#124;&#124;v.some(x=&gt;typeof x!=='string'&#124;&#124;!NAME.test(x))&#124;&#124;new Set(v).size!==v.length)fail('INVALID_REQUEST','Unique action capa…</code> |
| `principal` | function | 23 | <code>function principal(row:Record&lt;string,any&gt;):Principal{return frozen({credential_id:row.credential_id,organisation_id:row.organisation_id,run_id:row.run_id,actor_id:row.actor_id,role:row.role,credential…</code> |
| `assertCredentialIdentity` | function | 24 | <code>async function assertCredentialIdentity(tx:IdentityTransaction,p:Principal,strictCompute:boolean,action?:string,continuation=false):Promise&lt;void&gt;{</code> |
| `assertCurrentPrincipal` | function | 39 | <code>export async function assertCurrentPrincipal(tx:IdentityTransaction,p:Principal,authority:GlobalIdentityAuthority):Promise&lt;void&gt;{assertPrimaryTransaction(tx);if(!authority&#124;&#124;typeof authority.assertCurr…</code> |
| `continuationInvocation` | function | 41 | <code>export function continuationInvocation(i:InvocationContext,validatePersistedAdmission:(tx:IdentityTransaction,invocation:InvocationContext)=&gt;Promise&lt;void&gt;):InvocationContext{assertInvocation(i);if(typ…</code> |
| `identityTransaction` | function | 42 | <code>export async function identityTransaction&lt;T&gt;(ctx:ComponentContext,operation:(tx:IdentityTransaction,i:InvocationContext)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{const i=invocationOf(ctx);return gatewayOf(ctx).withPri…</code> |
| `recorded` | function | 43 | <code>export async function recorded&lt;T&gt;(tx:IdentityTransaction,scope:string,name:string,op:Operation,action:()=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `ready` | function | 49 | <code>async function ready(g:IdentityGateway):Promise&lt;void&gt;{const bytes=await fs.readFile(new URL('../../migrations/0014-enrollment.sql',import.meta.url));await g.withPrimaryTransaction({timeoutMs:5000},asy…</code> |
| `Config` | interface | 50 | <code>interface Config{origin:string;clock_skew_seconds:number;grant_ttl_seconds:number;credential_ttl_seconds:number;principals:unknown&#91;&#93;}</code> |
| `configOf` | function | 51 | <code>async function configOf(ctx:ComponentContext):Promise&lt;Config&gt;{const file=ctx.env.HF_IDENTITY_CONFIG_FILE;if(!file)fail('IDENTITY_CONFIG_REQUIRED','Trusted identity configuration required');const st=aw…</code> |
| `seed` | function | 52 | <code>async function seed(g:IdentityGateway,c:Config,authority:GlobalIdentityAuthority):Promise&lt;void&gt;{for(const v of c.principals){exact(v,&#91;'credential_id','organisation_id','run_id','actor_id','role','publ…</code> |
| `role` | function | 53 | <code>function role(i:InvocationContext,values:string&#91;&#93;):void{if(!values.includes(i.principal.role))fail('ROLE_DENIED','Principal role is not permitted');}</code> |
| `result` | function | 54 | <code>function result(p:Record&lt;string,any&gt;):unknown{return {protocol_version:1,credential_id:p.credential_id,actor_id:p.actor_id,run_id:p.run_id,role:p.role,sandbox_id:p.sandbox_id,boot_generation:p.boot_ge…</code> |
| `createComponent` | function | 55 | <code>export async function createComponent(ctx:ComponentContext):Promise&lt;Component&gt;{</code> |

## services/hyperfide/src/identity/native_auth.ts

[Open source](../../services/hyperfide/src/identity/native_auth.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AuthProfileSnapshot` | interface | 15 | <code>export interface AuthProfileSnapshot {</code> |
| `Profile` | interface | 22 | <code>interface Profile {snapshot:AuthProfileSnapshot;runtime_home:string;target_uid:number;configured_account_key:string}</code> |
| `NativeAuthAuthority` | interface | 23 | <code>export interface NativeAuthAuthority {resolve(profileId:string):AuthProfileSnapshot;privateRuntimeInTransaction(tx:PrimaryTransaction,i:InvocationContext,profileId:string):Promise&lt;{snapshot:AuthProfil…</code> |
| `resolve` | method | 23 | <code>export interface NativeAuthAuthority {resolve(profileId:string):AuthProfileSnapshot;privateRuntimeInTransaction(tx:PrimaryTransaction,i:InvocationContext,profileId:string):Promise&lt;{snapshot:AuthProfil…</code> |
| `privateRuntimeInTransaction` | method | 23 | <code>export interface NativeAuthAuthority {resolve(profileId:string):AuthProfileSnapshot;privateRuntimeInTransaction(tx:PrimaryTransaction,i:InvocationContext,profileId:string):Promise&lt;{snapshot:AuthProfil…</code> |
| `privateRuntime` | method | 23 | <code>export interface NativeAuthAuthority {resolve(profileId:string):AuthProfileSnapshot;privateRuntimeInTransaction(tx:PrimaryTransaction,i:InvocationContext,profileId:string):Promise&lt;{snapshot:AuthProfil…</code> |
| `probe` | method | 23 | <code>export interface NativeAuthAuthority {resolve(profileId:string):AuthProfileSnapshot;privateRuntimeInTransaction(tx:PrimaryTransaction,i:InvocationContext,profileId:string):Promise&lt;{snapshot:AuthProfil…</code> |
| `isNativeAuthAuthority` | function | 24 | <code>export function isNativeAuthAuthority(v:unknown):v is NativeAuthAuthority{return object(v)&amp;&amp;typeof v.resolve==='function'&amp;&amp;typeof v.privateRuntime==='function'&amp;&amp;typeof v.privateRuntimeInTransaction===…</code> |
| `sorted` | function | 25 | <code>function sorted(v:unknown):unknown {if(Array.isArray(v))return v.map(sorted);if(object(v))return Object.fromEntries(Object.keys(v).sort().map(k=&gt;&#91;k,sorted(v&#91;k&#93;)&#93;));return v;}</code> |
| `nonempty` | function | 26 | <code>function nonempty(v:unknown):v is string{return typeof v==='string'&amp;&amp;v.length&gt;0&amp;&amp;v.length&lt;=255&amp;&amp;!/&#91;&#92;x00-&#92;x1f&#93;/.test(v);}</code> |
| `binaryIdentity` | function | 27 | <code>async function binaryIdentity(filename:string):Promise&lt;{digest:string;header:Buffer}&gt;{</code> |
| `profiles` | function | 36 | <code>async function profiles(ctx:ComponentContext):Promise&lt;Map&lt;string,Profile&gt;&gt;{</code> |
| `run` | function | 54 | <code>async function run(profile:Profile,args:string&#91;&#93;,signal:AbortSignal):Promise&lt;{exit_code:number&#124;null;stdout:string;stderr:string}&gt;{</code> |
| `createComponent` | function | 76 | <code>export async function createComponent(ctx:ComponentContext):Promise&lt;Component&gt;{</code> |

## services/hyperfide/src/identity/qualification.ts

[Open source](../../services/hyperfide/src/identity/qualification.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Connector` | type | 11 | <code>type Connector=AuthProfileSnapshot&#91;'connector'&#93;;type Mode=AuthProfileSnapshot&#91;'auth_mode'&#93;;</code> |
| `Mode` | type | 11 | <code>type Connector=AuthProfileSnapshot&#91;'connector'&#93;;type Mode=AuthProfileSnapshot&#91;'auth_mode'&#93;;</code> |
| `ModeEntry` | interface | 13 | <code>interface ModeEntry {profile_id:string;host_auth_import:string&#124;null;portable_session_claimed:boolean}</code> |
| `ConnectorEntry` | interface | 14 | <code>interface ConnectorEntry {connector:Connector;selected_mode:Mode&#124;'UNRESOLVED';modes:Record&lt;Mode,ModeEntry&#124;null&gt;;account_guidance:{reference:string;concurrent_refresh:'UNSUPPORTED'&#124;'SERIALISED_ONLY'&#124;'A…</code> |
| `OperatorModeConfig` | interface | 15 | <code>export interface OperatorModeConfig {config_revision:string;config_digest:string;connectors:Map&lt;Connector,ConnectorEntry&gt;}</code> |
| `QualificationRecord` | interface | 16 | <code>export interface QualificationRecord {</code> |
| `QualificationStore` | interface | 22 | <code>export interface QualificationStore {</code> |
| `qualify` | method | 23 | <code>qualify(i:InvocationContext,snapshot:AuthProfileSnapshot,probe:()=&gt;Promise&lt;{native_authentication:string}&gt;):Promise&lt;QualificationRecord&gt;;</code> |
| `inspect` | method | 24 | <code>inspect(i:InvocationContext,connector:unknown):Promise&lt;unknown&gt;;</code> |
| `commitRefresh` | method | 25 | <code>commitRefresh(i:InvocationContext,v:unknown):Promise&lt;unknown&gt;;</code> |
| `qualificationReady` | function | 29 | <code>export async function qualificationReady(g:IdentityGateway):Promise&lt;void&gt;{</code> |
| `shape` | function | 33 | <code>function shape(v:unknown,names:readonly string&#91;&#93;):asserts v is Record&lt;string,unknown&gt;{if(!object(v)&#124;&#124;Object.keys(v).length!==names.length&#124;&#124;names.some(n=&gt;!Object.hasOwn(v,n)))fail('NATIVE_AUTH_MODE_CON…</code> |
| `label` | function | 34 | <code>function label(v:unknown):v is string{return typeof v==='string'&amp;&amp;NAME.test(v);}</code> |
| `modeConfig` | function | 36 | <code>async function modeConfig(ctx:ComponentContext,profiles:ReadonlyMap&lt;string,AuthProfileSnapshot&gt;):Promise&lt;OperatorModeConfig&gt;{</code> |
| `record` | function | 61 | <code>function record(r:Record&lt;string,any&gt;):QualificationRecord{</code> |
| `createQualificationStore` | function | 66 | <code>export function createQualificationStore(ctx:ComponentContext,g:IdentityGateway,profiles:ReadonlyMap&lt;string,AuthProfileSnapshot&gt;):QualificationStore{</code> |

## services/hyperfide/src/identity/recovery.ts

[Open source](../../services/hyperfide/src/identity/recovery.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AcceptedRunRebindInput` | interface | 10 | <code>export interface AcceptedRunRebindInput {</code> |
| `RecoveryEvidenceScope` | type | 17 | <code>export type RecoveryEvidenceScope='LIVE_PROVIDER'&#124;'ISOLATED_POSTGRESQL_FIXTURE';</code> |
| `AcceptedRunRecoveryIntent` | interface | 18 | <code>export interface AcceptedRunRecoveryIntent extends AcceptedRunRebindInput {readonly intent_digest:string;readonly evidence_scope:RecoveryEvidenceScope}</code> |
| `RecoveryComputeRevocation` | interface | 19 | <code>export interface RecoveryComputeRevocation {readonly revoked_attempts:string;readonly revoked_allocations:string;readonly retained_debt_references:readonly string&#91;&#93;}</code> |
| `PreparedAcceptedRunRecovery` | interface | 20 | <code>export interface PreparedAcceptedRunRecovery {</code> |
| `verify` | method | 21 | <code>verify(tx:PrimaryTransaction):Promise&lt;AcceptedRunRecoveryIntent&gt;;</code> |
| `revokeCompute` | method | 22 | <code>revokeCompute(tx:PrimaryTransaction):Promise&lt;RecoveryComputeRevocation&gt;;</code> |
| `RunRebindReceipt` | interface | 24 | <code>export interface RunRebindReceipt {</code> |
| `RunRebindReceiptExpectation` | interface | 34 | <code>export interface RunRebindReceiptExpectation {</code> |
| `digest` | function | 39 | <code>const digest=(v:unknown):v is string=&gt;typeof v==='string'&amp;&amp;/^sha256:&#91;0-9a-f&#93;{64}$/.test(v);</code> |
| `canonical` | function | 40 | <code>function canonical(v:unknown):string {if(v===null&#124;&#124;typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '&#91;'+v.map(canonical).join(',')+'&#93;';return '{'+Object.keys(v).sort().map(k=&gt;JS…</code> |
| `pin` | function | 41 | <code>function pin(v:unknown):string{return hash(Buffer.from(canonical(v)))}</code> |
| `inputOf` | function | 42 | <code>function inputOf(raw:AcceptedRunRebindInput):AcceptedRunRebindInput {</code> |
| `schema` | function | 50 | <code>async function schema(tx:PrimaryTransaction):Promise&lt;void&gt;{</code> |
| `accepted` | function | 55 | <code>async function accepted(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string}){</code> |
| `fresh` | function | 58 | <code>async function fresh(tx:PrimaryTransaction,input:AcceptedRunRebindInput,attestation:ExternalAuthorityAttestation):Promise&lt;void&gt;{</code> |
| `receiptOf` | function | 63 | <code>function receiptOf(row:Record&lt;string,any&gt;):RunRebindReceipt {</code> |
| `rebindAcceptedRun` | function | 74 | <code>export async function rebindAcceptedRun(resources:ServiceResources,journal:ExternalAuthorityJournal,raw:AcceptedRunRebindInput,prepared:PreparedAcceptedRunRecovery,options:TransactionOptions={}):Promi…</code> |
| `inspectRunRebindReceipt` | function | 116 | <code>export async function inspectRunRebindReceipt(tx:PrimaryTransaction,expected:RunRebindReceiptExpectation):Promise&lt;RunRebindReceipt&gt;{</code> |

## services/hyperfide/src/observability/metrics.ts

[Open source](../../services/hyperfide/src/observability/metrics.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `METRICS` | object | 4 | <code>const METRICS:Record&lt;string,string&gt;={readiness_to_start:'milliseconds',provisioning:'milliseconds',preparation:'milliseconds',lease_latency:'milliseconds',result_latency:'milliseconds',event_lag:'mill…</code> |
| `value` | function | 6 | <code>function value(raw:unknown):string {const s=text(raw,32);if(!/^(0&#124;&#91;1-9&#93;&#91;0-9&#93;{0,23})(&#92;.&#91;0-9&#93;{1,6})?$/.test(s))fail('OBSERVABILITY_INPUT_INVALID','Bounded nonnegative decimal string required');return s.…</code> |
| `fixed` | function | 7 | <code>function fixed(s:string):bigint {const &#91;a,b=''&#93;=s.split('.');return BigInt(a!)&#42;1000000n+BigInt(b.padEnd(6,'0'));}</code> |
| `display` | function | 8 | <code>function display(n:bigint):string {const whole=n/1000000n,f=(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return whole.toString()+(f?'.'+f:'');}</code> |
| `Series` | interface | 9 | <code>interface Series {id:string;name:string;phase:string;profile_key:string;variant:string;unit:string;currency:string&#124;null;provenance_digest:string;bucket_bounds:string&#91;&#93;}</code> |
| `parseSeries` | function | 10 | <code>function parseSeries(raw:unknown):Series{</code> |
| `recordMetrics` | function | 18 | <code>export async function recordMetrics(tx:Session,p:Principal,input:unknown):Promise&lt;unknown&gt;{</code> |
| `distribution` | function | 52 | <code>async function distribution(tx:Session,p:Principal,id:string):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `PoolState` | interface | 68 | <code>interface PoolState {maxActive:number;maxQueued:number;active:number;queued:number}</code> |
| `poolState` | function | 69 | <code>function poolState(resources:unknown):PoolState&#124;null{const d=(resources as {describe?():unknown}&#124;undefined)?.describe?.() as {primary?:PoolState}&#124;undefined,v=d?.primary;return v&amp;&amp;Number.isSafeInteger(…</code> |
| `describe` | method | 69 | <code>function poolState(resources:unknown):PoolState&#124;null{const d=(resources as {describe?():unknown}&#124;undefined)?.describe?.() as {primary?:PoolState}&#124;undefined,v=d?.primary;return v&amp;&amp;Number.isSafeInteger(…</code> |
| `PoolPressure` | class | 70 | <code>class PoolPressure {</code> |
| `constructor` | method | 73 | <code>constructor(private readonly resources:unknown){const s=poolState(resources);if(s){this.timer=setInterval(()=&gt;this.sample(),100);this.timer.unref();}}</code> |
| `sample` | method | 74 | <code>sample():void{const s=poolState(this.resources);if(!s)return;this.samples_total++;if(s.active&gt;=s.maxActive){this.saturated_total++;this.last_saturated_at=new Date().toISOString();}if(s.queued&gt;0)this.q…</code> |
| `admitted` | method | 75 | <code>admitted(ms:number):void{this.admission.push(ms);while(this.admission.length&gt;256)this.admission.shift();}</code> |
| `describe` | method | 76 | <code>describe():Record&lt;string,unknown&gt;&#124;null{if(!this.timer)return null;const w=this.window.filter(x=&gt;x.at&gt;=Date.now()-60000);return {interval_ms:100,window_ms:60000,window_samples:w.length,window_saturated…</code> |
| `close` | method | 77 | <code>close():void{if(this.timer)clearInterval(this.timer);this.timer=undefined;}</code> |
| `summary` | function | 79 | <code>function summary(values:number&#91;&#93;,truncated:boolean):Record&lt;string,unknown&gt;{</code> |
| `derived` | function | 85 | <code>function derived(name:string,phase:string,scope:string,basis:string,values:number&#91;&#93;,truncated:boolean,unknown:string,extra:Record&lt;string,unknown&gt;={}):Record&lt;string,unknown&gt;{</code> |
| `millis` | function | 88 | <code>async function millis(tx:Session,sql:string,values:unknown&#91;&#93;):Promise&lt;{values:number&#91;&#93;;truncated:boolean}&gt;{</code> |
| `serverDerived` | function | 91 | <code>async function serverDerived(tx:Session,p:Principal,pressure:PoolPressure,request:{queue_wait_ms:number;pool_at_entry:PoolState&#124;null}):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 110 | <code>export function createComponent(startup:ComponentContext):Component{</code> |
| `describe` | method | 114 | <code>'fleet.metrics.describe':async input=&gt;{object(input,&#91;&#93;);return {schema_version:1,metrics:METRICS,phases:PHASES,series_limit:128,receipt_limit:100000,batch_limit:100,retained_hours:72,queue_wait_is_api…</code> |

## services/hyperfide/src/observability/notifications.ts

[Open source](../../services/hyperfide/src/observability/notifications.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Outbox` | interface | 5 | <code>interface Outbox {</code> |
| `bindSessionConsumer` | method | 6 | <code>bindSessionConsumer(tx:Session,input:{organisation_id:string;run_id:string;session_id:string;consumer_id:string;namespace:'fleet_notification'},invocation:unknown):Promise&lt;{session_id:string;consumer_…</code> |
| `enqueue` | method | 7 | <code>enqueue(tx:Session,event:{organisation_id:string;run_id:string;id:string;aggregate_id:string;aggregate_type:string;aggregate_version:string;event_type:string;payload:Record&lt;string,unknown&gt;},options:{c…</code> |
| `isOutbox` | function | 9 | <code>function isOutbox(value:unknown):value is Outbox{return !!value&amp;&amp;typeof value==='object'&amp;&amp;typeof (value as Outbox).enqueue==='function'&amp;&amp;typeof (value as Outbox).bindSessionConsumer==='function';}</code> |
| `InboxBootstrap` | interface | 10 | <code>interface InboxBootstrap {bootstrapConsumer(tx:Session,input:{organisation_id:string;run_id:string;bootstrap_id:string;consumer_id:string;aggregate_types:string&#91;&#93;;limit:number},builder:(tx:Session)=&gt;P…</code> |
| `bootstrapConsumer` | method | 10 | <code>interface InboxBootstrap {bootstrapConsumer(tx:Session,input:{organisation_id:string;run_id:string;bootstrap_id:string;consumer_id:string;aggregate_types:string&#91;&#93;;limit:number},builder:(tx:Session)=&gt;P…</code> |
| `isInbox` | function | 11 | <code>function isInbox(value:unknown):value is InboxBootstrap{return !!value&amp;&amp;typeof value==='object'&amp;&amp;typeof (value as InboxBootstrap).bootstrapConsumer==='function';}</code> |
| `recipientAccess` | function | 12 | <code>function recipientAccess(p:Principal,target:string):void{</code> |
| `bootstrapRecipient` | function | 16 | <code>export async function bootstrapRecipient(tx:Session,p:Principal,input:unknown,inbox:InboxBootstrap):Promise&lt;unknown&gt;{</code> |
| `rejectCredentialSummary` | function | 30 | <code>function rejectCredentialSummary(raw:unknown,knownSecrets:readonly string&#91;&#93;):string{</code> |
| `evidenceRef` | function | 36 | <code>function evidenceRef(p:Principal,id:string):unknown{return {kind:'ARTIFACT',organisation_id:p.organisation_id,run_id:p.run_id,artifact_id:id,operation:{component:'15.2',action:'artifact.object.inspect…</code> |
| `reconcileAcknowledgements` | function | 38 | <code>async function reconcileAcknowledgements(tx:Session,p:Principal):Promise&lt;void&gt;{</code> |
| `bindRecipient` | function | 41 | <code>export async function bindRecipient(tx:Session,p:Principal,input:unknown,outbox:Outbox,invocation:unknown):Promise&lt;unknown&gt;{</code> |
| `enqueueNotice` | function | 48 | <code>export async function enqueueNotice(tx:Session,p:Principal,input:unknown,knownSecrets:readonly string&#91;&#93;=&#91;&#93;):Promise&lt;unknown&gt;{</code> |
| `dispatchNotices` | function | 69 | <code>export async function dispatchNotices(tx:Session,p:Principal,input:unknown,outbox:Outbox,budget:number):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 96 | <code>export function createComponent(startup:ComponentContext):Component{</code> |
| `require` | method | 97 | <code>const resolver=(startup as unknown as {dependencies?:{require&lt;T&gt;(id:string,capability:string,validate:(v:unknown)=&gt;v is T):T}}).dependencies;</code> |

## services/hyperfide/src/observability/resources.ts

[Open source](../../services/hyperfide/src/observability/resources.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `UNITS` | object | 6 | <code>const UNITS:Record&lt;string,string&gt;={SANDBOX:'instances',AGENT_SESSION:'sessions',CPU_MILLIS:'millicpu',MEMORY_BYTES:'bytes',DISK_BYTES:'bytes',BUILD:'jobs',LINK:'jobs',TEST:'jobs',EXCLUSIVE_SERVICE:'se…</code> |
| `decimal` | function | 7 | <code>export function decimal(value:unknown):string{</code> |
| `micros` | function | 11 | <code>export function micros(value:string):bigint{const &#91;whole,fraction=''&#93;=value.split('.');return BigInt(whole!)&#42;1000000n+BigInt(fraction.padEnd(6,'0'));}</code> |
| `putProfile` | function | 12 | <code>export async function putProfile(tx:Session,p:Principal,input:unknown):Promise&lt;unknown&gt;{</code> |
| `Sample` | interface | 30 | <code>interface Sample {profile_id:string;subject_id:string;dimension:string;value:string;observed_at:string;producer_sequence:string;origin:string;source_digest:string;source_artifact_id:string}</code> |
| `recordSamples` | function | 31 | <code>export async function recordSamples(tx:Session,p:Principal,input:unknown,allowReplay:boolean):Promise&lt;unknown&gt;{</code> |
| `resourceSnapshot` | function | 55 | <code>export async function resourceSnapshot(tx:Session,p:Principal,input:unknown):Promise&lt;unknown&gt;{</code> |
| `WAIT_STATES` | object | 72 | <code>const WAIT_STATES:Record&lt;string,string&gt;={BUILD:'BUILD_WAITING',MODEL:'MODEL_WAITING',PROVIDER_RATE:'PROVIDER_RATE_WAITING',EXCLUSIVE_SERVICE:'EXCLUSIVE_SERVICE_WAITING',REVIEW:'REVIEW_WAITING',CAPACIT…</code> |
| `WAIT_DIMENSIONS` | object | 73 | <code>const WAIT_DIMENSIONS:Record&lt;string,string&gt;={BUILD:'BUILD',MODEL:'MODEL_REQUEST',PROVIDER_RATE:'PROVIDER_API',EXCLUSIVE_SERVICE:'EXCLUSIVE_SERVICE'};</code> |
| `JOB_DIMENSIONS` | object | 74 | <code>const JOB_DIMENSIONS:Record&lt;string,string&gt;={AGENT:'AGENT_SESSION',BUILD:'BUILD',TEST:'TEST',INDEX:'INDEX',EXCLUSIVE_SERVICE:'EXCLUSIVE_SERVICE',REVIEW:'AGENT_SESSION',INTEGRATION:'BUILD',PREPARATION:'…</code> |
| `Utilisation` | interface | 76 | <code>interface Utilisation {profile_id:string;dimension:string;subjects:string;current:string;stale:string;saturated:string;max_current_value:string&#124;null;simulated:string}</code> |
| `canonical` | function | 77 | <code>function canonical(value:unknown):string&#124;null{return value===null&#124;&#124;value===undefined?null:decimal(String(value));}</code> |
| `observedUtilisation` | function | 78 | <code>function observedUtilisation(u:Utilisation&#124;undefined):unknown{</code> |
| `executionAccounting` | function | 83 | <code>export async function executionAccounting(tx:Session,scope:unknown&#91;&#93;,profile:string&#124;null){</code> |
| `sandboxBudgets` | function | 108 | <code>export async function sandboxBudgets(input:unknown,ctx:ComponentContext):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 166 | <code>export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,actions:{</code> |

## services/hyperfide/src/observability/views.ts

[Open source](../../services/hyperfide/src/observability/views.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Session` | interface | 7 | <code>export interface Session {query&lt;R extends pg.QueryResultRow=pg.QueryResultRow&gt;(text:string,values?:readonly unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;R&gt;&gt;}</code> |
| `query` | method | 7 | <code>export interface Session {query&lt;R extends pg.QueryResultRow=pg.QueryResultRow&gt;(text:string,values?:readonly unknown&#91;&#93;):Promise&lt;pg.QueryResult&lt;R&gt;&gt;}</code> |
| `Principal` | interface | 8 | <code>export interface Principal {organisation_id:string;run_id:string;actor_id:string;credential_id:string;role:string;attempt_id?:string;attempt_generation?:string;sandbox_id?:string;boot_generation?:stri…</code> |
| `Invocation` | interface | 9 | <code>interface Invocation {principal:Principal;payload:{action:string;run_id:string};signal:AbortSignal;guard(tx:unknown):Promise&lt;void&gt;}</code> |
| `guard` | method | 9 | <code>interface Invocation {principal:Principal;payload:{action:string;run_id:string};signal:AbortSignal;guard(tx:unknown):Promise&lt;void&gt;}</code> |
| `Runtime` | interface | 10 | <code>interface Runtime {</code> |
| `withPrimaryTransaction` | method | 11 | <code>gateway:{withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries:number;signal:AbortSignal;guard:(tx:Session)=&gt;Promise&lt;void&gt;},operation:(tx:Session)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;};</code> |
| `RequestContext` | interface | 13 | <code>interface RequestContext {invocation?:Invocation;resources?:Runtime}</code> |
| `fail` | function | 17 | <code>export function fail(code:string,message:string):never {throw new FoundationError(code,message);}</code> |
| `object` | function | 18 | <code>export function object(value:unknown,keys:readonly string&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `text` | function | 22 | <code>export function text(value:unknown,max=255):string{</code> |
| `uuid` | function | 25 | <code>export function uuid(value:unknown):string {const s=text(value,36);if(!UUID.test(s))fail('OBSERVABILITY_INPUT_INVALID','Canonical UUID required');return s;}</code> |
| `digest` | function | 26 | <code>export function digest(value:unknown):string {const s=text(value,71);if(!DIGEST.test(s))fail('OBSERVABILITY_INPUT_INVALID','SHA256 identity required');return s;}</code> |
| `integer` | function | 27 | <code>export function integer(value:unknown,min=0,max=1000):number {if(typeof value!=='number'&#124;&#124;!Number.isSafeInteger(value)&#124;&#124;value&lt;min&#124;&#124;value&gt;max)fail('OBSERVABILITY_INPUT_INVALID','Bounded integer require…</code> |
| `generation` | function | 28 | <code>export function generation(value:unknown,zero=false):string {const s=text(value,19);if(!/^(0&#124;&#91;1-9&#93;&#91;0-9&#93;&#42;)$/.test(s)&#124;&#124;BigInt(s)&gt;(2n&#42;&#42;63n-1n)&#124;&#124;(!zero&amp;&amp;s==='0'))fail('OBSERVABILITY_INPUT_INVALID','Canoni…</code> |
| `timestamp` | function | 29 | <code>export function timestamp(value:unknown):string {const s=text(value,32);if(!/^&#92;d{4}-&#92;d&#92;d-&#92;d&#92;dT&#92;d&#92;d:&#92;d&#92;d:&#92;d&#92;d(?:&#92;.&#92;d{1,3})?Z$/.test(s)&#124;&#124;!Number.isFinite(Date.parse(s))&#124;&#124;new Date(s).toISOString().slice(…</code> |
| `hash` | function | 30 | <code>export function hash(value:unknown):string {return 'sha256:'+createHash('sha256').update(JSON.stringify(value)).digest('hex');}</code> |
| `principal` | function | 31 | <code>export function principal(context:ComponentContext,operation:string):Principal{</code> |
| `authority` | function | 36 | <code>export async function authority&lt;T&gt;(context:ComponentContext,operation:string,fn:(tx:Session,scope:Principal)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `requireArtifact` | function | 41 | <code>export async function requireArtifact(tx:Session,p:Principal,id:string):Promise&lt;void&gt;{</code> |
| `lockRun` | function | 45 | <code>export async function lockRun(tx:Session,p:Principal,namespace='general'):Promise&lt;void&gt;{</code> |
| `numbers` | function | 50 | <code>export function numbers(value:unknown):unknown{</code> |
| `IntegratedProof` | interface | 56 | <code>export interface IntegratedProof {current_task_ids:string&#91;&#93;;status:'CURRENT'&#124;'HELD';count:string&#124;null;proof_level:'TASK_CURRENT_INTEGRATED';proof_digest:string&#124;null;as_of:string;programme_outcome:'PAS…</code> |
| `integratedProof` | function | 57 | <code>export async function integratedProof(tx:Session,p:Principal):Promise&lt;IntegratedProof&gt;{</code> |
| `TaskNode` | interface | 69 | <code>interface TaskNode {id:string;task_key:string;state:string}</code> |
| `Dependency` | interface | 70 | <code>interface Dependency {task_id:string;predecessor_task_id:string;predecessor_run_id:string;milestone:string;predecessor_state:string&#124;null}</code> |
| `criticalPath` | function | 71 | <code>export function criticalPath(tasks:TaskNode&#91;&#93;,dependencies:Dependency&#91;&#93;,runId:string,currentTaskIds:readonly string&#91;&#93;=&#91;&#93;,proofStatus='HELD'):unknown {</code> |
| `snapshot` | function | 83 | <code>export async function snapshot(tx:Session,p:Principal,input:unknown):Promise&lt;unknown&gt;{</code> |
| `requireCollector` | function | 109 | <code>export function requireCollector(p:Principal,subjectId?:string):void{</code> |
| `observationPriority` | function | 114 | <code>async function observationPriority(tx:Session,p:Principal,type:string,id:string,row:Record&lt;string,unknown&gt;):Promise&lt;number&gt;{</code> |
| `observe` | function | 127 | <code>export async function observe(tx:Session,p:Principal,input:unknown):Promise&lt;unknown&gt;{</code> |
| `entityPage` | function | 143 | <code>export async function entityPage(tx:Session,p:Principal,input:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 159 | <code>export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,actions:{</code> |

## services/hyperfide/src/policy/frontier.ts

[Open source](../../services/hyperfide/src/policy/frontier.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `NativeProfileSnapshot` | interface | 12 | <code>interface NativeProfileSnapshot {</code> |
| `Measurements` | interface | 21 | <code>interface Measurements {evidence_digest:string;sample_count:number;qualified_results:number;failed_results:number;p95_latency_ms:number&#124;null;observed_at:string}</code> |
| `QualifiedDeployment` | interface | 22 | <code>export interface QualifiedDeployment {native_profile:NativeProfileSnapshot;frontier:true;engineering:true;expected_profile_digest:string;expected_snapshot_digest:string;expires_at:string;measurements:…</code> |
| `FrontierPolicy` | interface | 23 | <code>export interface FrontierPolicy {</code> |
| `SelectionInput` | interface | 27 | <code>export interface SelectionInput {</code> |
| `deny` | function | 31 | <code>function deny(message:string):never{throw new FoundationError('FRONTIER_ROUTE_DENIED',message);}</code> |
| `exact` | function | 32 | <code>function exact(input:unknown,keys:string&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `text` | function | 36 | <code>function text(input:unknown,max=256):string{</code> |
| `digest` | function | 39 | <code>function digest(input:unknown):string{if(typeof input!=='string'&#124;&#124;!/^sha256:&#91;a-f0-9&#93;{64}$/.test(input))deny('Frontier evidence digest is invalid');return input;}</code> |
| `nonnegative` | function | 40 | <code>function nonnegative(input:unknown,integer=false):number{</code> |
| `strings` | function | 43 | <code>function strings(input:unknown):string&#91;&#93;{</code> |
| `timestamp` | function | 47 | <code>function timestamp(input:unknown):string {</code> |
| `future` | function | 53 | <code>function future(input:unknown):string{const out=timestamp(input);if(Date.parse(out)&lt;=Date.now())deny('Native route qualification expired');return out;}</code> |
| `canonical` | function | 54 | <code>function canonical(input:unknown):string{</code> |
| `snapshot` | function | 60 | <code>function snapshot(input:unknown):NativeProfileSnapshot{</code> |
| `measurements` | function | 80 | <code>function measurements(input:unknown):Measurements&#124;null{</code> |
| `validateFrontierPolicy` | function | 90 | <code>export function validateFrontierPolicy(input:unknown,context:ComponentContext):FrontierPolicy{</code> |
| `validateSelection` | function | 116 | <code>export function validateSelection(input:unknown):SelectionInput{</code> |
| `selectFrontierRoute` | function | 123 | <code>export function selectFrontierRoute(policy:FrontierPolicy,input:SelectionInput):Record&lt;string,unknown&gt;{</code> |
| `refuse` | function | 142 | <code>function refuse(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `sha` | function | 143 | <code>function sha(input:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(input)).digest('hex');}</code> |
| `nameId` | function | 145 | <code>function nameId(...parts:string&#91;&#93;):string{</code> |
| `uuid` | function | 151 | <code>function uuid(input:unknown):string{if(typeof input!=='string'&#124;&#124;!UUID.test(input))deny('Frontier record identity must be a canonical UUID');return input;}</code> |
| `ROUTE_ROLES` | variable | 152 | <code>const ROUTE_ROLES=new Set(&#91;'OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR'&#93;);</code> |
| `OutcomeSignal` | type | 158 | <code>type OutcomeSignal=typeof SIGNALS&#91;number&#93;;</code> |
| `CLASSIFICATION` | object | 159 | <code>const CLASSIFICATION:Record&lt;OutcomeSignal,string&gt;={PROGRESS:'USEFUL_PROGRESS',NO_OP:'NO_PROGRESS',PROCESS_ALIVE:'PROCESS_LIVENESS',MODEL_WAITING:'MODEL_WAITING',IDLE:'IDLE',</code> |
| `TERMINAL` | variable | 161 | <code>const TERMINAL=new Set(&#91;'ESCALATE','AUTH_BLOCKED'&#93;);</code> |
| `trailing` | function | 162 | <code>function trailing(history:OutcomeSignal&#91;&#93;,member:(s:OutcomeSignal)=&gt;boolean):number{let n=0;for(let i=history.length-1;i&gt;=0&amp;&amp;member(history&#91;i&#93;!);i--)n++;return n;}</code> |
| `decideOutcome` | function | 164 | <code>export function decideOutcome(prior:OutcomeSignal&#91;&#93;,signal:OutcomeSignal):{decision:string;reason:string;retry_after_ms:number&#124;null;retries_used:number;retry_limit:number&#124;null}{</code> |
| `trustedJSON` | function | 187 | <code>async function trustedJSON(filename:string&#124;undefined,label:string):Promise&lt;unknown&gt;{</code> |
| `QualificationReceipt` | interface | 195 | <code>interface QualificationReceipt {</code> |
| `qualificationReceipts` | function | 202 | <code>export async function qualificationReceipts(env:NodeJS.ProcessEnv):Promise&lt;Map&lt;string,{receipt:QualificationReceipt;receipt_digest:string}&gt;&gt;{</code> |
| `qualifiedSnapshot` | function | 231 | <code>export function qualifiedSnapshot(actual:unknown,receipts:Map&lt;string,{receipt:QualificationReceipt;receipt_digest:string}&gt;):NativeProfileSnapshot{</code> |
| `Tx` | type | 244 | <code>type Tx=IdentityTransaction;</code> |
| `Scope` | interface | 245 | <code>interface Scope {organisation_id:string;run_id:string}</code> |
| `admissionMeasurement` | function | 247 | <code>export async function admissionMeasurement(tx:Tx,scope:Scope,request_id:string):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `storedEvents` | function | 263 | <code>async function storedEvents(tx:Tx,scope:Scope,selection_id:string):Promise&lt;{selection:Record&lt;string,unknown&gt;&#124;null;outcomes:Record&lt;string,unknown&gt;&#91;&#93;}&gt;{</code> |
| `append` | function | 270 | <code>async function append(tx:Tx,scope:Scope,id:string,aggregate:string,version:number,type:string,payload:Record&lt;string,unknown&gt;):Promise&lt;boolean&gt;{</code> |
| `FrontierRouteAuthority` | interface | 276 | <code>export interface FrontierRouteAuthority {selectedRoute(tx:Tx,scope:Scope,selection_id:string):Promise&lt;Record&lt;string,unknown&gt;&gt;}</code> |
| `selectedRoute` | method | 276 | <code>export interface FrontierRouteAuthority {selectedRoute(tx:Tx,scope:Scope,selection_id:string):Promise&lt;Record&lt;string,unknown&gt;&gt;}</code> |
| `isFrontierRouteAuthority` | function | 277 | <code>export function isFrontierRouteAuthority(v:unknown):v is FrontierRouteAuthority{return object(v)&amp;&amp;typeof v.selectedRoute==='function';}</code> |
| `selectedRoute` | function | 278 | <code>async function selectedRoute(tx:Tx,scope:Scope,selection_id:string):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `scopeOf` | function | 285 | <code>function scopeOf(i:InvocationContext,current:ComponentContext):Scope{</code> |
| `createComponent` | function | 290 | <code>export function createComponent(context:ComponentContext):Component {</code> |

## services/hyperfide/src/policy/human_interface.ts

[Open source](../../services/hyperfide/src/policy/human_interface.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Tx` | interface | 7 | <code>interface Tx { query&lt;R extends QueryResultRow=QueryResultRow&gt;(text:string,values?:unknown&#91;&#93;):Promise&lt;QueryResult&lt;R&gt;&gt; }</code> |
| `query` | method | 7 | <code>interface Tx { query&lt;R extends QueryResultRow=QueryResultRow&gt;(text:string,values?:unknown&#91;&#93;):Promise&lt;QueryResult&lt;R&gt;&gt; }</code> |
| `Principal` | interface | 8 | <code>interface Principal {</code> |
| `Gateway` | interface | 12 | <code>interface Gateway { withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries:number;guard:(tx:Tx)=&gt;Promise&lt;void&gt;;signal:AbortSignal},operation:(tx:Tx)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt; }</code> |
| `withPrimaryTransaction` | method | 12 | <code>interface Gateway { withPrimaryTransaction&lt;T&gt;(options:{timeoutMs:number;maxRetries:number;guard:(tx:Tx)=&gt;Promise&lt;void&gt;;signal:AbortSignal},operation:(tx:Tx)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt; }</code> |
| `Leader` | interface | 13 | <code>interface Leader {organisation_id:string;run_id:string;authority_epoch:string;leader_session_id:string;leader_generation:string}</code> |
| `Hierarchy` | interface | 14 | <code>interface Hierarchy {</code> |
| `leadership` | method | 15 | <code>leadership(tx:Tx,scope:{organisation_id:string;run_id:string}):Promise&lt;Leader&gt;;</code> |
| `requireAuthority` | method | 16 | <code>requireAuthority(tx:Tx,input:Record&lt;string,unknown&gt;):Promise&lt;unknown&gt;;</code> |
| `requireLeaderReplacement` | method | 17 | <code>requireLeaderReplacement(tx:Tx,input:Record&lt;string,unknown&gt;):Promise&lt;Record&lt;string,unknown&gt;&gt;;</code> |
| `EventInput` | interface | 19 | <code>interface EventInput {organisation_id:string;run_id:string;id:string;aggregate_type:string;aggregate_id:string;aggregate_version:string;event_type:string;payload:Record&lt;string,unknown&gt;}</code> |
| `Binding` | interface | 20 | <code>interface Binding {organisation_id:string;run_id:string;session_id:string;consumer_id:string;namespace:string;consumer_state:string;session_role:string;session_state:string}</code> |
| `Outbox` | interface | 21 | <code>interface Outbox {</code> |
| `enqueue` | method | 22 | <code>enqueue(tx:Tx,event:EventInput,options:{consumer_ids:string&#91;&#93;}):Promise&lt;{event:unknown;replayed:boolean;obligations:number}&gt;;</code> |
| `resolveSessionConsumer` | method | 23 | <code>resolveSessionConsumer(tx:Tx,input:Record&lt;string,unknown&gt;):Promise&lt;Binding&#124;null&gt;;</code> |
| `lookupConsumerBinding` | method | 24 | <code>lookupConsumerBinding(tx:Tx,input:Record&lt;string,unknown&gt;):Promise&lt;Binding&#124;null&gt;;</code> |
| `Inbox` | interface | 26 | <code>interface Inbox {</code> |
| `receive` | method | 27 | <code>receive(tx:Tx,input:Record&lt;string,unknown&gt;,apply:(tx:Tx,event:EventInput)=&gt;Promise&lt;unknown&gt;):Promise&lt;{status:string;event_id:string;inbox_id:string;result:unknown}&gt;;</code> |
| `bootstrapConsumer` | method | 28 | <code>bootstrapConsumer(tx:Tx,input:Record&lt;string,unknown&gt;,build:(tx:Tx)=&gt;Promise&lt;unknown&gt;):Promise&lt;unknown&gt;;</code> |
| `supersedeDelivery` | method | 29 | <code>supersedeDelivery(tx:Tx,input:Record&lt;string,unknown&gt;,proof:(tx:Tx,events:{original:EventInput;replacement:EventInput})=&gt;Promise&lt;Record&lt;string,unknown&gt;&gt;):Promise&lt;Record&lt;string,unknown&gt;&gt;;</code> |
| `RuntimeContext` | type | 32 | <code>type RuntimeContext = ComponentContext &amp; {</code> |
| `guard` | method | 33 | <code>invocation?:{principal:Principal;guard(tx:Tx):Promise&lt;void&gt;};</code> |
| `RoutineOperation` | type | 36 | <code>type RoutineOperation=typeof routineOperations&#91;number&#93;;</code> |
| `refuse` | function | 53 | <code>function refuse(message:string):never{throw new FoundationError('HUMAN_INTERFACE_DENIED',message);}</code> |
| `exact` | function | 54 | <code>function exact(input:unknown,keys:string&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `uuid` | function | 58 | <code>function uuid(value:unknown):string{if(typeof value!=='string'&#124;&#124;!/^&#91;a-f0-9&#93;{8}-&#91;a-f0-9&#93;{4}-&#91;a-f0-9&#93;{4}-&#91;a-f0-9&#93;{4}-&#91;a-f0-9&#93;{12}$/.test(value))refuse('Scoped identity is invalid');return value;}</code> |
| `generation` | function | 59 | <code>function generation(value:unknown):string{if(typeof value!=='string'&#124;&#124;!/^&#91;1-9&#93;&#91;0-9&#93;{0,18}$/.test(value)&#124;&#124;BigInt(value)&gt;9223372036854775807n)refuse('Ownership generation is invalid');return value;}</code> |
| `canonical` | function | 60 | <code>function canonical(value:unknown):string{</code> |
| `capability` | function | 66 | <code>function capability&lt;T&gt;(context:RuntimeContext,id:string,name:string,methods:string&#91;&#93;):T{</code> |
| `principal` | function | 70 | <code>function principal(context:RuntimeContext,action:string):Principal{</code> |
| `IntentInput` | interface | 77 | <code>export interface IntentInput {request_id:string;idempotency_key:string;expected_leader_generation:string;kind:'INTENT'&#124;'CRITERIA'&#124;'PROGRAMME_CHANGE'&#124;'UNRESOLVED_INTENT'&#124;'ROUTINE';package_id:string&#124;nul…</code> |
| `validateIntent` | function | 78 | <code>export function validateIntent(input:unknown):IntentInput{</code> |
| `leaderConsumer` | function | 88 | <code>async function leaderConsumer(tx:Tx,outbox:Outbox,actor:Principal,session:string):Promise&lt;Binding&gt; {</code> |
| `routineConsumerKey` | function | 93 | <code>function routineConsumerKey(operation:string):string{return 'autonomous:routine.'+operation;}</code> |
| `autonomousConsumer` | function | 95 | <code>async function autonomousConsumer(tx:Tx,actor:Principal,operation:string):Promise&lt;string&gt; {</code> |
| `policyApproval` | function | 101 | <code>function policyApproval(context:RuntimeContext,operation:RoutineOperation):Record&lt;string,unknown&gt; {</code> |
| `route` | function | 108 | <code>async function route(context:RuntimeContext,action:string,input:IntentInput,autonomousOperation:string&#124;null):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `IntentState` | interface | 173 | <code>interface IntentState {state:'PENDING'&#124;'LEADER_REPORTED_COMPLETE';root_event_id:string;current_event_id:string;target_session_id:string;target_consumer_id:string;leader_generation:string;authority_epo…</code> |
| `digest` | function | 174 | <code>function digest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}</code> |
| `scope` | function | 175 | <code>function scope(actor:Principal):{organisation_id:string;run_id:string}{return {organisation_id:actor.organisation_id,run_id:actor.run_id};}</code> |
| `intentState` | function | 176 | <code>async function intentState(tx:Tx,actor:Principal,root:string,lock:boolean):Promise&lt;IntentState&gt;{</code> |
| `sourceEvent` | function | 181 | <code>async function sourceEvent(tx:Tx,actor:Principal,id:string):Promise&lt;EventInput&gt;{</code> |
| `currentLeader` | function | 188 | <code>async function currentLeader(tx:Tx,hierarchy:Hierarchy,actor:Principal,expected:string):Promise&lt;Leader&gt;{</code> |
| `sourceProof` | function | 195 | <code>async function sourceProof(tx:Tx,hierarchy:Hierarchy,outbox:Outbox,actor:Principal,leader:Leader,event:EventInput):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `processing` | function | 203 | <code>async function processing(context:RuntimeContext,action:string,input:unknown):Promise&lt;unknown&gt;{</code> |
| `routineReceive` | function | 264 | <code>async function routineReceive(context:RuntimeContext,input:unknown):Promise&lt;unknown&gt;{</code> |
| `createComponent` | function | 287 | <code>export function createComponent(_context:ComponentContext):Component{</code> |

## services/hyperfide/src/policy/placement.ts

[Open source](../../services/hyperfide/src/policy/placement.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RemoteJobClass` | type | 22 | <code>export type RemoteJobClass = typeof REMOTE_JOB_CLASSES&#91;number&#93;;</code> |
| `JobClass` | type | 23 | <code>export type JobClass = RemoteJobClass &#124; typeof SUPERVISORY_JOB_CLASSES&#91;number&#93;;</code> |
| `MainTool` | type | 24 | <code>export type MainTool = 'source.read'&#124;'graph.query'&#124;'state.query'&#124;'supervise'&#124;'delegate'&#124;'native.shell'&#124;'native.file.write'&#124;'native.spawn'&#124;'native.process.stop'&#124;'supervisor.session.launch';</code> |
| `RunnerAction` | type | 37 | <code>export type RunnerAction = keyof typeof REGISTERED_RUNNER_TOOLS;</code> |
| `registeredRunnerTool` | function | 38 | <code>export function registeredRunnerTool(action:unknown):{job_class:JobClass;tool:MainTool} {</code> |
| `PlacementProfile` | interface | 42 | <code>export interface PlacementProfile {</code> |
| `HostBinding` | interface | 47 | <code>export interface HostBinding { host_id: string; kind: 'SUPERVISORY'&#124;'REMOTE'; boot_generation: string }</code> |
| `PlacementDecision` | interface | 48 | <code>export interface PlacementDecision {</code> |
| `invalid` | function | 52 | <code>function invalid(message: string): never { throw new FoundationError('PLACEMENT_DENIED', message); }</code> |
| `exact` | function | 53 | <code>function exact(input: unknown, keys: string&#91;&#93;): Record&lt;string,unknown&gt; {</code> |
| `text` | function | 58 | <code>function text(value: unknown): string {</code> |
| `digest` | function | 63 | <code>function digest(value: unknown): string {</code> |
| `canonical` | function | 67 | <code>function canonical(value: unknown): string {</code> |
| `validatePlacementProfile` | function | 73 | <code>export function validatePlacementProfile(input: unknown, context: ComponentContext): PlacementProfile {</code> |
| `validateHostBinding` | function | 89 | <code>export function validateHostBinding(input: unknown): HostBinding {</code> |
| `enforcePlacement` | function | 100 | <code>export function enforcePlacement(profile: PlacementProfile, binding: HostBinding, job: unknown, tool: unknown): PlacementDecision {</code> |
| `trustedConfiguration` | function | 118 | <code>async function trustedConfiguration(context: ComponentContext): Promise&lt;{profile:PlacementProfile;host:HostBinding}&gt; {</code> |
| `PlacementPrincipal` | interface | 131 | <code>interface PlacementPrincipal {</code> |
| `PlacementInvocation` | interface | 135 | <code>export interface PlacementInvocation {operation:Operation;principal:PlacementPrincipal;guard(tx:PrimaryTransaction):Promise&lt;void&gt;}</code> |
| `guard` | method | 135 | <code>export interface PlacementInvocation {operation:Operation;principal:PlacementPrincipal;guard(tx:PrimaryTransaction):Promise&lt;void&gt;}</code> |
| `RemoteDestinationInput` | interface | 136 | <code>export interface RemoteDestinationInput {job_class:RemoteJobClass;tool:MainTool;target_sandbox_id:string;boot_generation:string}</code> |
| `PlacementAuthorization` | interface | 137 | <code>export interface PlacementAuthorization extends PlacementDecision {</code> |
| `SupervisorSessionInput` | interface | 141 | <code>export interface SupervisorSessionInput {session_id:string;leader_generation:string;package_id:string&#124;null;package_generation:string&#124;null}</code> |
| `SupervisorAuthorization` | interface | 142 | <code>export interface SupervisorAuthorization extends PlacementAuthorization {supervisor_session_id:string;supervisor_role:'LEADER'&#124;'FEATURE_MANAGER';restriction_profile_digest:string;restriction_evidence_…</code> |
| `PlacementAuthority` | interface | 143 | <code>export interface PlacementAuthority {</code> |
| `authorizeSupervisor` | method | 144 | <code>authorizeSupervisor(tx:PrimaryTransaction,invocation:PlacementInvocation,input:SupervisorSessionInput):Promise&lt;SupervisorAuthorization&gt;;</code> |
| `authorize` | method | 145 | <code>authorize(tx:PrimaryTransaction,invocation:PlacementInvocation,input:{job_class:JobClass;tool:MainTool}):Promise&lt;PlacementAuthorization&gt;;</code> |
| `admitRemote` | method | 146 | <code>admitRemote(tx:PrimaryTransaction,invocation:PlacementInvocation,input:RemoteDestinationInput):Promise&lt;PlacementAuthorization&gt;;</code> |
| `scopedUUID` | function | 148 | <code>function scopedUUID(value:unknown):string {</code> |
| `currentInvocation` | function | 152 | <code>function currentInvocation(context:ComponentContext):PlacementInvocation {</code> |
| `checkPrincipal` | function | 158 | <code>async function checkPrincipal(context:ComponentContext,tx:PrimaryTransaction,invocation:PlacementInvocation,action:string,execution=true):Promise&lt;PlacementPrincipal&gt; {</code> |
| `remoteHost` | function | 173 | <code>async function remoteHost(tx:PrimaryTransaction,principal:PlacementPrincipal,sandboxId:string,bootGeneration:string):Promise&lt;HostBinding&gt; {</code> |
| `supervisoryHost` | function | 190 | <code>async function supervisoryHost(context:ComponentContext,tx:PrimaryTransaction,principal:PlacementPrincipal,profile:PlacementProfile):Promise&lt;HostBinding&gt; {</code> |
| `trustedProfile` | function | 206 | <code>async function trustedProfile(context:ComponentContext):Promise&lt;PlacementProfile&gt; {</code> |
| `isPlacementAuthority` | function | 217 | <code>export function isPlacementAuthority(value:unknown):value is PlacementAuthority {</code> |
| `placementAuthority` | function | 220 | <code>function placementAuthority(context:ComponentContext):PlacementAuthority {</code> |
| `Outbox` | type | 292 | <code>type Outbox={enqueue(tx:PrimaryTransaction,event:Record&lt;string,unknown&gt;,options?:{consumer_ids:readonly string&#91;&#93;}):Promise&lt;{obligations:number}&gt;;</code> |
| `enqueue` | method | 292 | <code>type Outbox={enqueue(tx:PrimaryTransaction,event:Record&lt;string,unknown&gt;,options?:{consumer_ids:readonly string&#91;&#93;}):Promise&lt;{obligations:number}&gt;;</code> |
| `claimPending` | method | 293 | <code>claimPending(tx:PrimaryTransaction,input:unknown):Promise&lt;Array&lt;Record&lt;string,unknown&gt;&amp;{id:string;payload:Record&lt;string,unknown&gt;;attempt_count:string;lease_expires_at:string}&gt;&gt;;</code> |
| `acknowledge` | method | 294 | <code>acknowledge(tx:PrimaryTransaction,input:unknown):Promise&lt;unknown&gt;};</code> |
| `outboxOf` | function | 295 | <code>function outboxOf(current:ComponentContext):Outbox {</code> |
| `requestDigest` | function | 300 | <code>function requestDigest(value:unknown):string {return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}</code> |
| `idempotencyKey` | function | 301 | <code>function idempotencyKey(value:unknown):string {</code> |
| `queueKey` | function | 305 | <code>function queueKey(sandboxId:string):string {return 'placement-remote:'+sandboxId;}</code> |
| `remoteQueue` | function | 307 | <code>async function remoteQueue(tx:PrimaryTransaction,principal:PlacementPrincipal,sandboxId:string,create:boolean):Promise&lt;string&#124;null&gt; {</code> |
| `DelegationInput` | interface | 316 | <code>interface DelegationInput {job_id:string;idempotency_key:string;job_class:unknown;tool:unknown;target_sandbox_id:unknown;boot_generation:unknown;packet_digest:string}</code> |
| `delegateRemote` | function | 317 | <code>async function delegateRemote(current:ComponentContext,authority:PlacementAuthority,tx:PrimaryTransaction,invocation:PlacementInvocation,</code> |
| `delegationInput` | function | 345 | <code>function delegationInput(value:Record&lt;string,unknown&gt;):DelegationInput {</code> |
| `runnerHost` | function | 350 | <code>async function runnerHost(context:ComponentContext,tx:PrimaryTransaction,invocation:PlacementInvocation,action:string):Promise&lt;{principal:PlacementPrincipal;host:HostBinding}&gt; {</code> |
| `delegatedEvent` | function | 355 | <code>async function delegatedEvent(tx:PrimaryTransaction,principal:PlacementPrincipal,eventId:string){</code> |
| `settleDelivery` | function | 363 | <code>async function settleDelivery(current:ComponentContext,tx:PrimaryTransaction,principal:PlacementPrincipal,consumer:string,</code> |
| `bounded` | function | 383 | <code>function bounded(value:unknown,min:number,max:number):number {</code> |
| `createComponent` | function | 388 | <code>export function createComponent(context:ComponentContext):Component {</code> |

## services/hyperfide/src/policy/programme.ts

[Open source](../../services/hyperfide/src/policy/programme.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ServiceRole` | type | 3 | <code>export type ServiceRole = 'control' &#124; 'provisioner' &#124; 'dispatch';</code> |
| `ProgrammePolicy` | interface | 4 | <code>export interface ProgrammePolicy {</code> |
| `FoundationError` | class | 15 | <code>export class FoundationError extends Error {</code> |
| `constructor` | method | 16 | <code>constructor(public readonly code: string, message: string) { super(message); this.name = 'FoundationError'; }</code> |
| `object` | function | 18 | <code>export function object(value: unknown): value is Record&lt;string, unknown&gt; {</code> |
| `fields` | function | 21 | <code>function fields(value: Record&lt;string, unknown&gt;, expected: string&#91;&#93;, label: string): void {</code> |
| `nonempty` | function | 25 | <code>function nonempty(value: unknown): value is string { return typeof value === 'string' &amp;&amp; value.trim().length &gt; 0; }</code> |
| `validatePolicy` | function | 26 | <code>export function validatePolicy(value: unknown, expectedRevision: string, role: ServiceRole): ProgrammePolicy {</code> |
| `assertAdmission` | function | 53 | <code>export function assertAdmission(policy: ProgrammePolicy, role: ServiceRole, action: string): void {</code> |
| `createComponent` | function | 58 | <code>export function createComponent(_context: ComponentContext): Component {</code> |
