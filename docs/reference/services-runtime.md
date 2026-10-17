# Source reference: Control services: runtime

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the top-level modules of `services/hyperfide/src/` (bootstrap, issue watcher, supervisory host) and the `agents/`, `components/`, `events/`, `runner/`, `scheduler/` and `transport/` subtrees: 635 declarations in 34 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## services/hyperfide/src/agents/admission.ts

[Open source](../../services/hyperfide/src/agents/admission.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Policy` | type | 10 | <code>type Policy={organisation_id:string;run_id:string;run_policy_digest:string;quota_key:string;connector:string;connector_version:string;provider:string;model:string;auth_profile:string;permission_profil…</code> |
| `policies` | function | 11 | <code>async function policies(ctx:ComponentContext):Promise&lt;Policy&#91;&#93;&gt;{</code> |
| `AgentAdmissionCapability` | interface | 33 | <code>export interface AgentAdmissionCapability {</code> |
| `recoveryContext` | method | 35 | <code>recoveryContext(input:unknown,invocation:InvocationContext):Promise&lt;unknown&gt;;</code> |
| `recoveryContextInTransaction` | method | 36 | <code>recoveryContextInTransaction(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise&lt;unknown&gt;;</code> |
| `launchSelection` | method | 38 | <code>launchSelection(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;session_id:string},invocation:InvocationContext):Promise&lt;{selection:AdmissionPlanSelection&#124;null;reason:string&#124;null}&gt;;</code> |
| `isAgentAdmissionCapability` | function | 40 | <code>export function isAgentAdmissionCapability(value:unknown):value is AgentAdmissionCapability{</code> |
| `NativeAdmissionReason` | type | 47 | <code>export type NativeAdmissionReason='RATE_LIMIT'&#124;'QUOTA_LIMIT'&#124;'AUTH_EXPIRED'&#124;'APPROVAL_REQUIRED'&#124;'DELEGATION_UNSUPPORTED';</code> |
| `NativeSignalClassification` | interface | 48 | <code>export interface NativeSignalClassification {</code> |
| `field` | function | 54 | <code>const field=(value:unknown,key:string):unknown=&gt;object(value)?value&#91;key&#93;:undefined;</code> |
| `text` | function | 55 | <code>const text=(value:unknown):string&#124;null=&gt;typeof value==='string'&amp;&amp;value.length&lt;=128?value:null;</code> |
| `resetTime` | function | 56 | <code>function resetTime(value:unknown):string&#124;null{</code> |
| `classifyNativeEvent` | function | 62 | <code>export function classifyNativeEvent(connector:'codex'&#124;'claude',event:unknown):NativeSignalClassification{</code> |
| `assertRunPolicy` | function | 125 | <code>async function assertRunPolicy(client:{query:AuthorityTransaction&#91;'query'&#93;},s:{organisation_id:string;run_id:string},p:Policy):Promise&lt;string&gt;{</code> |
| `AdmissionPlanSelection` | interface | 132 | <code>export interface AdmissionPlanSelection {</code> |
| `createComponent` | function | 136 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/agents/dispatch.ts

[Open source](../../services/hyperfide/src/agents/dispatch.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Selection` | type | 17 | <code>type Selection={plan:RunnerLaunchPlan&#124;null;reason:string&#124;null;replayed:boolean};</code> |
| `launchPlan` | function | 19 | <code>function launchPlan(row:Record&lt;string,unknown&gt;):RunnerLaunchPlan{</code> |
| `select` | function | 22 | <code>async function select(tx:PrimaryTransaction,admission:AgentAdmissionCapability,input:RunnerSpawnInput,invocation:InvocationContext):Promise&lt;Selection&gt;{</code> |
| `createComponent` | function | 54 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/agents/qualification.ts

[Open source](../../services/hyperfide/src/agents/qualification.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ConnectorCapability` | type | 16 | <code>export type ConnectorCapability=typeof CONNECTOR_CAPABILITIES&#91;number&#93;;</code> |
| `CapabilityOutcome` | type | 17 | <code>export type CapabilityOutcome='QUALIFIED'&#124;'UNQUALIFIED'&#124;'UNSUPPORTED'&#124;'REFUSED';</code> |
| `ProbeResult` | type | 18 | <code>type ProbeResult='ACCEPTED'&#124;'REFUSED'&#124;'NOT_OFFERED';</code> |
| `CapabilityObservation` | interface | 19 | <code>export interface CapabilityObservation {result:ProbeResult;evidence_digest:string;context_restored:boolean}</code> |
| `ConnectorObservationInput` | interface | 20 | <code>export interface ConnectorObservationInput {</code> |
| `ConnectorQualificationPayload` | interface | 26 | <code>export interface ConnectorQualificationPayload {</code> |
| `SignedConnectorReceipt` | interface | 32 | <code>export interface SignedConnectorReceipt {schema_version:1;payload:string;signature:string}</code> |
| `ConnectorQualificationRecord` | interface | 33 | <code>export interface ConnectorQualificationRecord {</code> |
| `NativeQualificationView` | interface | 36 | <code>export interface NativeQualificationView {state:'UNQUALIFIED'&#124;'QUALIFIED'&#124;'STALE';live_qualified:boolean;receipt_digest:string&#124;null}</code> |
| `ConnectorQualificationAuthority` | interface | 37 | <code>export interface ConnectorQualificationAuthority {</code> |
| `record` | method | 39 | <code>record(i:InvocationContext,input:unknown):Promise&lt;ConnectorQualificationRecord&gt;;</code> |
| `inspect` | method | 40 | <code>inspect(profileId:string):ConnectorQualificationRecord&#124;null;</code> |
| `qualification` | method | 41 | <code>qualification(profileId:string):NativeQualificationView;</code> |
| `receipt` | method | 42 | <code>receipt(profileId:string):SignedConnectorReceipt&#124;null;</code> |
| `publicKey` | method | 43 | <code>publicKey():string;</code> |
| `isConnectorQualificationAuthority` | function | 45 | <code>export function isConnectorQualificationAuthority(v:unknown):v is ConnectorQualificationAuthority{</code> |
| `NativeAuthView` | interface | 49 | <code>interface NativeAuthView {resolve(profileId:string):AuthProfileSnapshot;probe(i:InvocationContext,profileId:string):Promise&lt;unknown&gt;}</code> |
| `resolve` | method | 49 | <code>interface NativeAuthView {resolve(profileId:string):AuthProfileSnapshot;probe(i:InvocationContext,profileId:string):Promise&lt;unknown&gt;}</code> |
| `probe` | method | 49 | <code>interface NativeAuthView {resolve(profileId:string):AuthProfileSnapshot;probe(i:InvocationContext,profileId:string):Promise&lt;unknown&gt;}</code> |
| `isNativeAuthView` | function | 50 | <code>function isNativeAuthView(v:unknown):v is NativeAuthView{return object(v)&amp;&amp;typeof v.resolve==='function'&amp;&amp;typeof v.probe==='function';}</code> |
| `RegistryOptions` | interface | 51 | <code>export interface RegistryOptions {</code> |
| `canonical` | function | 57 | <code>function canonical(v:unknown):string{</code> |
| `text` | function | 62 | <code>function text(v:unknown,re=ID):string{if(typeof v!=='string'&#124;&#124;!re.test(v))fail('CONNECTOR_QUALIFICATION_INVALID','Bounded native observation field required');return v;}</code> |
| `digestOf` | function | 63 | <code>function digestOf(v:unknown):string{return text(v,DIGEST);}</code> |
| `nullable` | function | 64 | <code>function nullable(v:unknown,re=ID):string&#124;null{return v===null?null:text(v,re);}</code> |
| `parseObservation` | function | 65 | <code>export function parseObservation(v:unknown):ConnectorObservationInput{</code> |
| `versionLine` | function | 82 | <code>export function versionLine(connector:'codex'&#124;'claude',version:string):string{return connector==='codex'?&#96;codex-cli ${version}&#96;:&#96;${version} (Claude Code)&#96;;}</code> |
| `deriveOutcomes` | function | 84 | <code>export function deriveOutcomes(s:AuthProfileSnapshot,o:ConnectorObservationInput):{capabilities:Record&lt;ConnectorCapability,CapabilityOutcome&gt;;reasons:string&#91;&#93;}{</code> |
| `signReceipt` | function | 96 | <code>export function signReceipt(key:KeyObject,payload:ConnectorQualificationPayload):SignedConnectorReceipt{</code> |
| `rawPublicKey` | function | 100 | <code>export function rawPublicKey(key:KeyObject):string{</code> |
| `createConnectorQualificationRegistry` | function | 104 | <code>export function createConnectorQualificationRegistry(options:RegistryOptions):ConnectorQualificationAuthority{</code> |
| `signingKey` | function | 145 | <code>async function signingKey(file:string&#124;undefined):Promise&lt;KeyObject&#124;null&gt;{</code> |
| `createComponent` | function | 153 | <code>export async function createComponent(ctx:ComponentContext):Promise&lt;Component&gt;{</code> |

## services/hyperfide/src/agents/sessions.ts

[Open source](../../services/hyperfide/src/agents/sessions.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `readTrustedAgentFile` | function | 11 | <code>export async function readTrustedAgentFile(filename:string,maxBytes:number):Promise&lt;Buffer&gt;{</code> |
| `AgentScope` | type | 30 | <code>export type AgentScope={organisation_id:string;run_id:string;session_id:string};</code> |
| `RecordValue` | type | 31 | <code>type RecordValue=Record&lt;string,unknown&gt;;</code> |
| `agentError` | function | 34 | <code>export function agentError(code:string):never{throw new FoundationError(code,'Native session operation refused: '+code);}</code> |
| `exactAgentObject` | function | 35 | <code>export function exactAgentObject(value:unknown,required:string&#91;&#93;,optional:string&#91;&#93;=&#91;&#93;):RecordValue{</code> |
| `agentString` | function | 39 | <code>export function agentString(value:unknown,kind:'uuid'&#124;'digest'&#124;'name'&#124;'decimal'='name'):string{</code> |
| `agentScope` | function | 44 | <code>export function agentScope(value:unknown,invocation:InvocationContext):AgentScope{</code> |
| `assertNativeRunnerScope` | function | 53 | <code>export function assertNativeRunnerScope(i:InvocationContext,admitted:Record&lt;string,unknown&gt;,nativeBinding?:Record&lt;string,unknown&gt;):void{</code> |
| `canonical` | function | 57 | <code>function canonical(value:unknown):string{</code> |
| `agentDigest` | function | 62 | <code>export function agentDigest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}</code> |
| `agentTransaction` | function | 63 | <code>export async function agentTransaction&lt;T&gt;(ctx:ComponentContext,invocation:InvocationContext,callback:(client:AuthorityTransaction)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt;{</code> |
| `getNativeSessionProfile` | function | 75 | <code>export async function getNativeSessionProfile(ctx:ComponentContext,authProfile:unknown):Promise&lt;RecordValue&gt;{</code> |
| `profileMatches` | function | 82 | <code>function profileMatches(p:RecordValue,admitted:RecordValue,b:RecordValue):void{</code> |
| `key` | function | 85 | <code>const key=(s:AgentScope)=&gt;&#91;s.organisation_id,s.run_id,s.session_id&#93;;</code> |
| `session` | function | 86 | <code>async function session(client:AuthorityTransaction,s:AgentScope,lock=true):Promise&lt;RecordValue&gt;{</code> |
| `binding` | function | 90 | <code>async function binding(client:AuthorityTransaction,s:AgentScope):Promise&lt;RecordValue&gt;{</code> |
| `agentOperation` | function | 94 | <code>export async function agentOperation(client:AuthorityTransaction,s:AgentScope,id:string,payload:unknown,run:()=&gt;Promise&lt;RecordValue&gt;,invocation:InvocationContext):Promise&lt;RecordValue&gt;{</code> |
| `resumeOperationId` | function | 106 | <code>function resumeOperationId(invocation:InvocationContext,request:unknown):string{</code> |
| `resumeLineage` | function | 111 | <code>async function resumeLineage(ctx:ComponentContext,client:AuthorityTransaction,s:AgentScope,admitted:RecordValue,b:RecordValue,r:RecordValue):Promise&lt;RecordValue&gt;{</code> |
| `lineageOf` | function | 134 | <code>async function lineageOf(client:AuthorityTransaction,s:AgentScope):Promise&lt;RecordValue&gt;{</code> |
| `AgentSessionsCapability` | interface | 139 | <code>export interface AgentSessionsCapability {</code> |
| `resumeCheck` | method | 141 | <code>resumeCheck(input:unknown,invocation:InvocationContext):Promise&lt;unknown&gt;;</code> |
| `isAgentSessionsCapability` | function | 143 | <code>export function isAgentSessionsCapability(value:unknown):value is AgentSessionsCapability{</code> |
| `createComponent` | function | 146 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/agents/supervision.ts

[Open source](../../services/hyperfide/src/agents/supervision.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `MainStartupBudget` | interface | 14 | <code>export interface MainStartupBudget {schema_version:1;host_id:string;pool_id:string;allowance:{cpu_millis:string;memory_bytes:string;agent_slots:string};headroom:{cpu_millis:string;memory_bytes:string}…</code> |
| `MainHostObservation` | interface | 15 | <code>export interface MainHostObservation {cpu_available_millis:string;memory_available_bytes:string;observed_at:string;source:'LINUX_PROCFS_CGROUP'}</code> |
| `validateSupervisorStartupBudget` | function | 16 | <code>export function validateSupervisorStartupBudget(declared:unknown,observation:unknown):{schema_version:1;sizing:'WITHIN_OBSERVED_HEADROOM';budget_digest:string;host_id:string;pool_id:string;observed_at…</code> |
| `MapValue` | type | 28 | <code>type MapValue=Record&lt;string,unknown&gt;;</code> |
| `Dimension` | type | 29 | <code>type Dimension={dimension:'CPU_MILLIS'&#124;'MEMORY_BYTES'&#124;'AGENT';capacity_account_id:string;quantity:string};</code> |
| `Profile` | type | 30 | <code>type Profile={profile_id:string;host_id:string;pool_id:string;restriction_profile_digest:string;cwd:string;home:string;temp:string;uid:number;gid:number;mcp_config_path:string;mcp_config_digest:string…</code> |
| `PlacementAuthority` | interface | 31 | <code>interface PlacementAuthority {authorizeSupervisor(tx:PrimaryTransaction,i:InvocationContext,v:MapValue):Promise&lt;MapValue&gt;}</code> |
| `authorizeSupervisor` | method | 31 | <code>interface PlacementAuthority {authorizeSupervisor(tx:PrimaryTransaction,i:InvocationContext,v:MapValue):Promise&lt;MapValue&gt;}</code> |
| `CredentialAuthority` | interface | 32 | <code>interface CredentialAuthority {inspectInTransaction(tx:PrimaryTransaction,i:InvocationContext,reference:string):Promise&lt;{reference_id:string;status:string}&gt;}</code> |
| `inspectInTransaction` | method | 32 | <code>interface CredentialAuthority {inspectInTransaction(tx:PrimaryTransaction,i:InvocationContext,reference:string):Promise&lt;{reference_id:string;status:string}&gt;}</code> |
| `credentialAuthority` | function | 33 | <code>const credentialAuthority=(v:unknown):v is CredentialAuthority=&gt;object(v)&amp;&amp;typeof v.inspectInTransaction==='function';</code> |
| `credentialCurrent` | function | 34 | <code>async function credentialCurrent(ctx:ComponentContext,tx:PrimaryTransaction,i:InvocationContext,native:{credential_reference:string}):Promise&lt;void&gt;{const value=await ctx.dependencies.require('14.2','i…</code> |
| `AllocationAuthority` | interface | 35 | <code>interface AllocationAuthority {allocateReservations(tx:PrimaryTransaction,v:{organisation_id:string;run_id:string;reservation_ids:string&#91;&#93;}):Promise&lt;void&gt;}</code> |
| `allocateReservations` | method | 35 | <code>interface AllocationAuthority {allocateReservations(tx:PrimaryTransaction,v:{organisation_id:string;run_id:string;reservation_ids:string&#91;&#93;}):Promise&lt;void&gt;}</code> |
| `allocationAuthority` | function | 36 | <code>const allocationAuthority=(v:unknown):v is AllocationAuthority=&gt;object(v)&amp;&amp;typeof v.allocateReservations==='function';</code> |
| `CapacityAuthority` | interface | 37 | <code>interface CapacityAuthority {reserveCapacity(tx:PrimaryTransaction,v:{organisation_id:string;run_id:string;request_id:string;dimensions:{capacity_account_id:string;quantity:string}&#91;&#93;;expires_at:string…</code> |
| `reserveCapacity` | method | 37 | <code>interface CapacityAuthority {reserveCapacity(tx:PrimaryTransaction,v:{organisation_id:string;run_id:string;request_id:string;dimensions:{capacity_account_id:string;quantity:string}&#91;&#93;;expires_at:string…</code> |
| `placementAuthority` | function | 38 | <code>const placementAuthority=(v:unknown):v is PlacementAuthority=&gt;object(v)&amp;&amp;typeof v.authorizeSupervisor==='function';</code> |
| `capacityAuthority` | function | 39 | <code>const capacityAuthority=(v:unknown):v is CapacityAuthority=&gt;object(v)&amp;&amp;typeof v.reserveCapacity==='function';</code> |
| `allowedTools` | variable | 40 | <code>const allowedTools=new Set(&#91;'spec_status','spec_frontier','spec_resolve','graph_status','graph_search','graph_context','graph_traverse','fleet_status','fleet_entities','fleet_resources','hierarchy_ins…</code> |
| `hash` | function | 41 | <code>function hash(b:Buffer):string{return 'sha256:'+createHash('sha256').update(b).digest('hex');}</code> |
| `pinned` | function | 42 | <code>async function pinned(filename:string,digest:string):Promise&lt;Buffer&gt;{</code> |
| `profiles` | function | 48 | <code>async function profiles(ctx:ComponentContext):Promise&lt;Profile&#91;&#93;&gt;{</code> |
| `runtimeFiles` | function | 65 | <code>async function runtimeFiles(p:Profile,target?:{session_id:string;run_id:string}):Promise&lt;MapValue&gt;{</code> |
| `nativeAdapter` | function | 85 | <code>async function nativeAdapter(ctx:ComponentContext,p:Profile,native:MapValue,action:string,payload:MapValue):Promise&lt;MapValue&gt;{</code> |
| `nativePlan` | function | 101 | <code>async function nativePlan(ctx:ComponentContext,p:Profile,native:MapValue):Promise&lt;string&#91;&#93;&gt;{</code> |
| `ProcessIdentity` | type | 107 | <code>type ProcessIdentity={pid:number;start_time:string;kernel_boot_id:string;pgid:number};</code> |
| `hostIdentity` | function | 108 | <code>function hostIdentity(v:unknown):ProcessIdentity{</code> |
| `hostRequest` | function | 113 | <code>async function hostRequest(ctx:ComponentContext,request:MapValue):Promise&lt;MapValue&gt;{</code> |
| `sealPlan` | function | 138 | <code>async function sealPlan(ctx:ComponentContext,body:MapValue):Promise&lt;{plan_path:string;plan_digest:string}&gt;{</code> |
| `createComponent` | function | 151 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/bootstrap.ts

[Open source](../../services/hyperfide/src/bootstrap.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `privateInput` | function | 12 | <code>async function privateInput(filename:string):Promise&lt;Buffer&gt;{</code> |
| `recoverCommand` | function | 29 | <code>async function recoverCommand(input:unknown,policy:{deployment_id:string;max_ttl_ms:number;journal_dir:string},env:Readonly&lt;NodeJS.ProcessEnv&gt;,signal?:AbortSignal):Promise&lt;unknown&gt;{</code> |
| `bootstrapCommand` | function | 42 | <code>export async function bootstrapCommand(args:readonly string&#91;&#93;,env:Readonly&lt;NodeJS.ProcessEnv&gt;=Object.freeze({...process.env}),signal?:AbortSignal):Promise&lt;unknown&gt;{</code> |

## services/hyperfide/src/bootstrap_identity.ts

[Open source](../../services/hyperfide/src/bootstrap_identity.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `BootstrapPolicy` | interface | 11 | <code>export interface BootstrapPolicy {deployment_id:string;max_ttl_ms:number;journal_dir:string}</code> |
| `OperatorBinding` | interface | 12 | <code>export interface OperatorBinding {</code> |
| `assertBootstrapExternalAuthority` | function | 16 | <code>export async function assertBootstrapExternalAuthority(resources:ServiceResources,policy:BootstrapPolicy,signal?:AbortSignal){</code> |
| `assertFreshAttestation` | function | 23 | <code>export async function assertFreshAttestation(tx:AuthorityTransaction,deploymentId:string,epoch:string,attestation:ExternalAuthorityAttestation):Promise&lt;void&gt;{</code> |
| `binding` | function | 30 | <code>function binding(p:Principal,digest:string,replayed:boolean):OperatorBinding{</code> |
| `issueOfflineOperator` | function | 36 | <code>export async function issueOfflineOperator(resources:ServiceResources,value:unknown,policy:BootstrapPolicy,signal?:AbortSignal):Promise&lt;OperatorBinding&gt;{</code> |

## services/hyperfide/src/bootstrap_recovery.ts

[Open source](../../services/hyperfide/src/bootstrap_recovery.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RecoveryReceipt` | interface | 17 | <code>export interface RecoveryReceipt {</code> |
| `recoverBootstrapOperator` | function | 23 | <code>export async function recoverBootstrapOperator(resources:ServiceResources,value:unknown,policy:BootstrapPolicy,signal?:AbortSignal):Promise&lt;RecoveryReceipt&gt;{</code> |

## services/hyperfide/src/components/registry.ts

[Open source](../../services/hyperfide/src/components/registry.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `StartupContext` | interface | 11 | <code>export interface StartupContext {</code> |
| `CapabilityResolver` | interface | 17 | <code>export interface CapabilityResolver {</code> |
| `require` | method | 18 | <code>require&lt;T&gt;(component:string,capability:string,validate:(value:unknown)=&gt;value is T):T;</code> |
| `ComponentContext` | interface | 20 | <code>export interface ComponentContext extends StartupContext {</code> |
| `Action` | type | 25 | <code>export type Action = (input: unknown, context: ComponentContext) =&gt; unknown &#124; Promise&lt;unknown&gt;;</code> |
| `Component` | interface | 26 | <code>export interface Component { apiVersion: 1; actions: Record&lt;string, Action&gt;; capabilities?:Readonly&lt;Record&lt;string,unknown&gt;&gt;; close?: () =&gt; void &#124; Promise&lt;void&gt; }</code> |
| `Fragment` | interface | 27 | <code>interface Fragment {</code> |
| `invalid` | function | 33 | <code>function invalid(message: string): never { throw new FoundationError('REGISTRY_INVALID', message); }</code> |
| `uniqueStrings` | function | 34 | <code>function uniqueStrings(value: unknown, regex: RegExp, nonempty: boolean): value is string&#91;&#93; {</code> |
| `fragment` | function | 38 | <code>function fragment(value: unknown): Fragment {</code> |
| `jsonFile` | function | 50 | <code>async function jsonFile(filename: string): Promise&lt;unknown&gt; {</code> |
| `ComponentRegistry` | class | 56 | <code>export class ComponentRegistry {</code> |
| `constructor` | method | 65 | <code>constructor(private readonly context: StartupContext) {</code> |
| `resolveCapability` | method | 77 | <code>resolveCapability&lt;T&gt;(id:string,capability:string,validate:(value:unknown)=&gt;value is T):T {</code> |
| `load` | method | 84 | <code>async load(directory: string, moduleRoot: string): Promise&lt;void&gt; {</code> |
| `describe` | method | 166 | <code>describe(): unknown {</code> |
| `hasComponent` | method | 170 | <code>hasComponent(id:string):boolean{return this.instances.has(id);}</code> |
| `installInvocationAuthorizer` | method | 172 | <code>installInvocationAuthorizer(authorize:(invocation:InvocationContext)=&gt;Promise&lt;void&gt;):void {</code> |
| `invoke` | method | 176 | <code>async invoke(id: string, action: string, input: unknown, invocation?:InvocationContext): Promise&lt;unknown&gt; {</code> |
| `close` | method | 192 | <code>async close(): Promise&lt;void&gt; {</code> |

## services/hyperfide/src/components/service.ts

[Open source](../../services/hyperfide/src/components/service.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `protocolLimits` | function | 14 | <code>function protocolLimits(): { request: number; response: number } {</code> |
| `errorValue` | function | 26 | <code>function errorValue(error: unknown): { code: string; message: string } {</code> |
| `options` | function | 30 | <code>function options(args: string&#91;&#93;): Record&lt;string,string&gt; {</code> |
| `ProtocolResponse` | type | 43 | <code>export type ProtocolResponse =</code> |
| `handleRequest` | function | 47 | <code>export async function handleRequest(registry: ComponentRegistry, request: unknown, responseLimit = MAX_BYTES, invocation?:InvocationContext): Promise&lt;ProtocolResponse&gt; {</code> |
| `runService` | function | 76 | <code>export async function runService(role: ServiceRole, args = process.argv.slice(2)): Promise&lt;void&gt; {</code> |

## services/hyperfide/src/events/api.ts

[Open source](../../services/hyperfide/src/events/api.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Action` | type | 14 | <code>type Action=(input:unknown,context:ComponentContext)=&gt;Promise&lt;unknown&gt;&#124;unknown;</code> |
| `nativeInvocation` | function | 16 | <code>async function nativeInvocation&lt;T&gt;(g:TransactionGateway,context:ComponentContext,input:unknown,</code> |
| `observedAt` | function | 47 | <code>function observedAt(value:unknown):string {</code> |
| `ingestRunnerEvent` | function | 52 | <code>export async function ingestRunnerEvent(g:TransactionGateway,context:ComponentContext,input:unknown):Promise&lt;unknown&gt; {</code> |
| `receipt` | function | 121 | <code>function receipt(value:unknown,status:'ADMITTED'&#124;'DUPLICATE'):Record&lt;string,unknown&gt; {</code> |
| `runnerApi` | function | 127 | <code>export function runnerApi(g:TransactionGateway):Record&lt;string,Action&gt; {</code> |

## services/hyperfide/src/events/dispatcher.ts

[Open source](../../services/hyperfide/src/events/dispatcher.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Route` | interface | 11 | <code>interface Route {aggregate_type:string;event_type:string;component:string;action:string;input_mode:'DELIVERY'&#124;'CLAIM'}</code> |
| `WorkerConfig` | interface | 12 | <code>interface WorkerConfig {organisation_id:string;run_id:string;credential_id:string;key_file:string;ca_file:string;</code> |
| `ContinuousDispatch` | interface | 14 | <code>export interface ContinuousDispatch {describe():Readonly&lt;Record&lt;string,unknown&gt;&gt;;close():Promise&lt;void&gt;}</code> |
| `describe` | method | 14 | <code>export interface ContinuousDispatch {describe():Readonly&lt;Record&lt;string,unknown&gt;&gt;;close():Promise&lt;void&gt;}</code> |
| `close` | method | 14 | <code>export interface ContinuousDispatch {describe():Readonly&lt;Record&lt;string,unknown&gt;&gt;;close():Promise&lt;void&gt;}</code> |
| `readOwned` | function | 15 | <code>async function readOwned(file:string,secret:boolean,max:number):Promise&lt;Buffer&gt; {</code> |
| `configuration` | function | 28 | <code>function configuration(value:unknown):WorkerConfig {</code> |
| `startContinuousDispatch` | function | 51 | <code>export async function startContinuousDispatch(context:ComponentContext):Promise&lt;ContinuousDispatch&#124;undefined&gt; {</code> |

## services/hyperfide/src/events/inbox.ts

[Open source](../../services/hyperfide/src/events/inbox.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `InboxResult` | interface | 8 | <code>export interface InboxResult { status:'APPLIED'&#124;'DUPLICATE'&#124;'GAP'&#124;'RESNAPSHOT_REQUIRED'; event_id:string;</code> |
| `aggregateKey` | function | 11 | <code>const aggregateKey=(type:string,id:string)=&gt;type+':'+id;</code> |
| `fetchEvent` | function | 12 | <code>async function fetchEvent(tx:PrimaryTransaction,s:Scope,id:string,consumer:string):Promise&lt;OutboxEvent&gt; {</code> |
| `receive` | function | 23 | <code>export async function receive(tx:PrimaryTransaction,input:unknown,</code> |
| `replay` | function | 71 | <code>export async function replay(tx:PrimaryTransaction,input:unknown):Promise&lt;unknown&gt; {</code> |
| `SnapshotBootstrap` | interface | 91 | <code>export interface SnapshotBootstrap extends Scope {bootstrap_id:string;consumer_id:string;aggregate_types:readonly string&#91;&#93;;limit:number}</code> |
| `bootstrapConsumer` | function | 92 | <code>export async function bootstrapConsumer(tx:PrimaryTransaction,input:SnapshotBootstrap,</code> |
| `DeliverySupersession` | interface | 161 | <code>export interface DeliverySupersession extends Scope {transfer_id:string;original_event_id:string;original_consumer_id:string;</code> |
| `supersedeDelivery` | function | 163 | <code>export async function supersedeDelivery(tx:PrimaryTransaction,input:DeliverySupersession,</code> |
| `EventInboxCapability` | interface | 221 | <code>export interface EventInboxCapability {receive:typeof receive;replay:typeof replay;bootstrapConsumer:typeof bootstrapConsumer;supersedeDelivery:typeof supersedeDelivery}</code> |
| `isEventInboxCapability` | function | 222 | <code>export function isEventInboxCapability(value:unknown):value is EventInboxCapability {</code> |
| `createComponent` | function | 226 | <code>export function createComponent(context:ComponentContext):Component {</code> |

## services/hyperfide/src/events/instructions.ts

[Open source](../../services/hyperfide/src/events/instructions.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Instruction` | interface | 15 | <code>export interface Instruction extends Scope { id:string; attempt_id:string; attempt_generation:string;</code> |
| `instruction` | function | 17 | <code>export function instruction(value:unknown):Instruction {</code> |
| `AuthoritySnapshot` | interface | 41 | <code>interface AuthoritySnapshot {sandbox_id:string;boot_id:string;observed_at:string;lease_expires_at:string&#124;null;remaining_lease_ms:number}</code> |
| `currentAuthority` | function | 42 | <code>async function currentAuthority(tx:PrimaryTransaction,i:Instruction,allowExpiredCancel=false):Promise&lt;AuthoritySnapshot&gt; {</code> |
| `bodyOf` | function | 80 | <code>function bodyOf(i:Instruction,target:{sandbox_id:string;boot_id:string}):Record&lt;string,unknown&gt; {</code> |
| `RunnerConsumerBinding` | interface | 84 | <code>export interface RunnerConsumerBinding extends Scope {consumer_id:string;sandbox_id:string;boot_id:string;boot_generation:string;</code> |
| `runnerConsumerIdentity` | function | 86 | <code>function runnerConsumerIdentity(s:Scope,consumer:string,sandbox:string,boot:string,generation:string):Record&lt;string,unknown&gt; {</code> |
| `resolveRunnerConsumer` | function | 89 | <code>export async function resolveRunnerConsumer(tx:PrimaryTransaction,input:unknown):Promise&lt;RunnerConsumerBinding&#124;null&gt; {</code> |
| `registerRunnerConsumer` | function | 113 | <code>export async function registerRunnerConsumer(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise&lt;unknown&gt; {</code> |
| `instructionRecipient` | function | 142 | <code>export async function instructionRecipient(tx:PrimaryTransaction,s:Scope,target:{sandbox_id:string;boot_id:string},generation:string,active:boolean):Promise&lt;string&gt; {</code> |
| `issue` | function | 149 | <code>export async function issue(tx:PrimaryTransaction,input:unknown):Promise&lt;unknown&gt; {</code> |
| `acceptInstruction` | function | 191 | <code>export async function acceptInstruction(tx:PrimaryTransaction,input:unknown):Promise&lt;unknown&gt; {</code> |
| `handoff` | function | 216 | <code>export async function handoff(tx:PrimaryTransaction,input:unknown,principal?:Principal):Promise&lt;unknown&gt; {</code> |
| `replayInstructions` | function | 245 | <code>export async function replayInstructions(tx:PrimaryTransaction,input:unknown):Promise&lt;unknown&gt; {</code> |
| `runnerMatches` | function | 264 | <code>export function runnerMatches(principal:Principal,i:Instruction,target:{sandbox_id:string;boot_id:string}):void {</code> |
| `recordRunnerAcknowledgement` | function | 271 | <code>export async function recordRunnerAcknowledgement(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise&lt;unknown&gt; {</code> |
| `issueAuthority` | function | 342 | <code>async function issueAuthority(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise&lt;void&gt; {</code> |
| `createComponent` | function | 359 | <code>export function createComponent(context:ComponentContext):Component {</code> |

## services/hyperfide/src/events/outbox.ts

[Open source](../../services/hyperfide/src/events/outbox.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Scope` | interface | 9 | <code>export interface Scope { organisation_id: string; run_id: string }</code> |
| `OutboxEvent` | interface | 10 | <code>export interface OutboxEvent extends Scope {</code> |
| `DeliveryClaim` | interface | 14 | <code>export interface DeliveryClaim extends OutboxEvent {</code> |
| `fail` | function | 17 | <code>export function fail(code: string, message: string): never { throw new FoundationError(code, message); }</code> |
| `fields` | function | 18 | <code>export function fields(value: unknown, required: readonly string&#91;&#93;, optional: readonly string&#91;&#93; = &#91;&#93;): Record&lt;string, unknown&gt; {</code> |
| `uuid` | function | 24 | <code>export function uuid(value: unknown): string {</code> |
| `name` | function | 29 | <code>export function name(value: unknown): string {</code> |
| `integer` | function | 34 | <code>export function integer(value: unknown, zero = false): string {</code> |
| `bounded` | function | 39 | <code>export function bounded(value: unknown, min: number, max: number): number {</code> |
| `scope` | function | 44 | <code>export function scope(value: Record&lt;string, unknown&gt;): Scope {</code> |
| `canonical` | function | 48 | <code>export function canonical(value: unknown): string {</code> |
| `digest` | function | 68 | <code>export function digest(value: unknown): string { return 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex'); }</code> |
| `event` | function | 69 | <code>export function event(value: unknown): OutboxEvent {</code> |
| `eventDigest` | function | 77 | <code>export function eventDigest(e: OutboxEvent): string {</code> |
| `gateway` | function | 81 | <code>export function gateway(context: ComponentContext): TransactionGateway {</code> |
| `require` | method | 83 | <code>dependencies: { require&lt;T&gt;(id:string,capability:string,guard:(v:unknown)=&gt;v is T):T }</code> |
| `run` | function | 89 | <code>export async function run&lt;T&gt;(g: TransactionGateway, operation:(tx:PrimaryTransaction)=&gt;Promise&lt;T&gt;): Promise&lt;T&gt; {</code> |
| `requireInvocation` | function | 92 | <code>export function requireInvocation(context:ComponentContext,input:unknown,roles:readonly string&#91;&#93;):InvocationContext {</code> |
| `authorizedRun` | function | 103 | <code>export function authorizedRun&lt;T&gt;(g:TransactionGateway,context:ComponentContext,input:unknown,roles:readonly string&#91;&#93;,</code> |
| `lockRun` | function | 111 | <code>export async function lockRun(tx: PrimaryTransaction, s: Scope, mode: 'shared'&#124;'exclusive' = 'shared'): Promise&lt;void&gt; {</code> |
| `registerConsumer` | function | 118 | <code>export async function registerConsumer(tx: PrimaryTransaction, input: unknown): Promise&lt;unknown&gt; {</code> |
| `enqueue` | function | 141 | <code>export async function enqueue(tx: PrimaryTransaction, value: unknown, options?: {consumer_ids:readonly string&#91;&#93;}): Promise&lt;{event:OutboxEvent; replayed:boolean; obligations:number}&gt; {</code> |
| `claimPending` | function | 181 | <code>export async function claimPending(tx: PrimaryTransaction, input:unknown):Promise&lt;DeliveryClaim&#91;&#93;&gt; {</code> |
| `currentClaim` | function | 204 | <code>export async function currentClaim(tx:PrimaryTransaction,input:unknown):Promise&lt;{scope:Scope;event_id:string;consumer_id:string;attempt_count:string;row:Record&lt;string,unknown&gt;}&gt; {</code> |
| `acknowledge` | function | 217 | <code>export async function acknowledge(tx:PrimaryTransaction,input:unknown):Promise&lt;unknown&gt; {</code> |
| `retry` | function | 236 | <code>export async function retry(tx:PrimaryTransaction,input:unknown):Promise&lt;unknown&gt; {</code> |
| `SessionConsumerNamespace` | type | 248 | <code>export type SessionConsumerNamespace='human_intent'&#124;'fleet_notification';</code> |
| `SessionConsumerBinding` | interface | 249 | <code>export interface SessionConsumerBinding extends Scope {consumer_id:string;session_id:string;namespace:SessionConsumerNamespace;</code> |
| `sessionNamespace` | function | 251 | <code>function sessionNamespace(value:unknown):SessionConsumerNamespace {</code> |
| `sessionConsumerKey` | function | 255 | <code>export function sessionConsumerKey(session_id:string,namespace:SessionConsumerNamespace):string {</code> |
| `sessionBindingAuthority` | function | 258 | <code>async function sessionBindingAuthority(tx:PrimaryTransaction,s:Scope,session:string,invocation:InvocationContext):Promise&lt;void&gt; {</code> |
| `readSessionBinding` | function | 272 | <code>async function readSessionBinding(tx:PrimaryTransaction,s:Scope,where:string,values:unknown&#91;&#93;):Promise&lt;SessionConsumerBinding&#124;null&gt; {</code> |
| `lookupConsumerBinding` | function | 287 | <code>export async function lookupConsumerBinding(tx:PrimaryTransaction,input:unknown):Promise&lt;SessionConsumerBinding&#124;null&gt; {</code> |
| `resolveSessionConsumer` | function | 291 | <code>export async function resolveSessionConsumer(tx:PrimaryTransaction,input:unknown):Promise&lt;SessionConsumerBinding&#124;null&gt; {</code> |
| `bindSessionConsumer` | function | 297 | <code>export async function bindSessionConsumer(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise&lt;SessionConsumerBinding&amp;{replayed:boolean}&gt; {</code> |
| `lookupNativeLaunch` | function | 318 | <code>export async function lookupNativeLaunch(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext):Promise&lt;unknown&gt; {</code> |
| `createComponent` | function | 383 | <code>export function createComponent(context:ComponentContext):Component {</code> |
| `EventOutboxCapability` | interface | 405 | <code>export interface EventOutboxCapability {</code> |
| `isEventOutboxCapability` | function | 410 | <code>export function isEventOutboxCapability(value:unknown):value is EventOutboxCapability {</code> |

## services/hyperfide/src/events/recovery.ts

[Open source](../../services/hyperfide/src/events/recovery.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `inspectPending` | function | 8 | <code>export async function inspectPending(tx:PrimaryTransaction,input:unknown):Promise&lt;unknown&gt; {</code> |
| `recoverySnapshot` | function | 20 | <code>export async function recoverySnapshot(tx:PrimaryTransaction,input:unknown):Promise&lt;unknown&gt; {</code> |
| `DispatchConfig` | interface | 63 | <code>export interface DispatchConfig extends Scope { consumer_id:string; batch_size:number; lease_ms:number; poll_ms:number; retry_ms:number }</code> |
| `DeliveryAdapter` | type | 64 | <code>export type DeliveryAdapter=(claim:DeliveryClaim,signal:AbortSignal)=&gt;Promise&lt;{inbox_id:string}&gt;;</code> |
| `DispatchPass` | interface | 65 | <code>export interface DispatchPass { claimed:number; acknowledged:number; pending:number }</code> |
| `DurableDispatcher` | class | 66 | <code>export class DurableDispatcher {</code> |
| `constructor` | method | 72 | <code>constructor(private readonly g:TransactionGateway,private readonly config:DispatchConfig,private readonly deliver:DeliveryAdapter,private readonly context:ComponentContext) {</code> |
| `wake` | method | 81 | <code>wake():void { this.wakeResolve?.(); }</code> |
| `start` | method | 82 | <code>start():void {</code> |
| `pass` | method | 98 | <code>pass():Promise&lt;DispatchPass&gt; {</code> |
| `transaction` | method | 102 | <code>private transaction&lt;T&gt;(operation:(tx:PrimaryTransaction)=&gt;Promise&lt;T&gt;):Promise&lt;T&gt; {</code> |
| `execute` | method | 107 | <code>private async execute():Promise&lt;DispatchPass&gt; {</code> |
| `close` | method | 143 | <code>async close():Promise&lt;void&gt; {</code> |
| `createComponent` | function | 149 | <code>export async function createComponent(context:ComponentContext):Promise&lt;Component&gt; {</code> |

## services/hyperfide/src/events/runner_commands.ts

[Open source](../../services/hyperfide/src/events/runner_commands.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `KINDS` | variable | 8 | <code>const KINDS=new Set(&#91;'START','STEER','CANCEL'&#93;);</code> |
| `exactTarget` | function | 9 | <code>function exactTarget(row:Record&lt;string,any&gt;,invocation:InvocationContext):void {</code> |
| `observationMatches` | function | 17 | <code>function observationMatches(value:unknown,row:Record&lt;string,any&gt;,invocation:InvocationContext):boolean {</code> |
| `nativeObservation` | function | 30 | <code>async function nativeObservation(tx:PrimaryTransaction,row:Record&lt;string,any&gt;,invocation:InvocationContext):Promise&lt;boolean&gt; {</code> |
| `pollRunnerCommands` | function | 41 | <code>export async function pollRunnerCommands(context:ComponentContext,input:unknown):Promise&lt;unknown&gt; {</code> |

## services/hyperfide/src/issue-watcher.ts

[Open source](../../services/hyperfide/src/issue-watcher.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `WatchedRepository` | interface | 25 | <code>export interface WatchedRepository {repository_id:string;owner:string;repository:string}</code> |
| `WatcherConfig` | interface | 26 | <code>export interface WatcherConfig {</code> |
| `CallOutcome` | interface | 31 | <code>export interface CallOutcome {component:string;action:string;subject:string&#124;null;outcome:'CONFIRMED'&#124;'REFUSED'&#124;'UNCONFIRMED';code:string&#124;null}</code> |
| `PassReport` | interface | 32 | <code>export interface PassReport {pass:number;confirmed:boolean;reconciled:string&#91;&#93;;deferred:string&#91;&#93;;calls:CallOutcome&#91;&#93;}</code> |
| `integer` | function | 33 | <code>function integer(value:unknown,low:number,high:number,label:string):number{</code> |
| `absolute` | function | 37 | <code>function absolute(value:unknown,label:string):string{</code> |
| `githubName` | function | 41 | <code>function githubName(value:unknown):string{</code> |
| `validateWatcherConfig` | function | 46 | <code>export function validateWatcherConfig(value:unknown):WatcherConfig{</code> |
| `plan` | function | 74 | <code>function plan(config:WatcherConfig):Record&lt;string,unknown&gt;{</code> |
| `ownedFile` | function | 82 | <code>async function ownedFile(file:string,secret:boolean,max:number):Promise&lt;Buffer&gt;{</code> |
| `RemoteRefusal` | class | 94 | <code>class RemoteRefusal extends Error{constructor(readonly code:string,readonly confirmed:boolean){super(code);}}</code> |
| `constructor` | method | 94 | <code>class RemoteRefusal extends Error{constructor(readonly code:string,readonly confirmed:boolean){super(code);}}</code> |
| `IssueWatcher` | class | 95 | <code>export class IssueWatcher {</code> |
| `constructor` | method | 97 | <code>constructor(private readonly config:WatcherConfig,private readonly key:KeyObject,private readonly ca:Buffer,private readonly signal:AbortSignal){}</code> |
| `call` | method | 98 | <code>private call(component:string,action:string,input:unknown):Promise&lt;unknown&gt;{</code> |
| `observed` | method | 124 | <code>private async observed(report:PassReport,component:string,action:string,subject:string&#124;null,input:unknown):Promise&lt;unknown&gt;{</code> |
| `pass` | method | 132 | <code>async pass():Promise&lt;PassReport&gt;{</code> |
| `issueWatcherCommand` | function | 170 | <code>export async function issueWatcherCommand(args:readonly string&#91;&#93;,env:Readonly&lt;NodeJS.ProcessEnv&gt;,signal:AbortSignal,emit:(line:Record&lt;string,unknown&gt;)=&gt;void):Promise&lt;number&gt;{</code> |
| `createComponent` | function | 189 | <code>export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:{</code> |

## services/hyperfide/src/runner/bridge.ts

[Open source](../../services/hyperfide/src/runner/bridge.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RunnerRemotePlan` | interface | 19 | <code>export interface RunnerRemotePlan {</code> |
| `RunnerStagingReference` | interface | 27 | <code>export interface RunnerStagingReference {</code> |
| `RunnerPreparationInput` | interface | 30 | <code>export interface RunnerPreparationInput {</code> |
| `RunnerPreparationPlan` | interface | 38 | <code>export interface RunnerPreparationPlan extends RunnerPreparationInput {</code> |
| `RunnerRemotePermit` | interface | 42 | <code>export interface RunnerRemotePermit {readonly &#91;permitBrand&#93;:true}</code> |
| `CapturedBytes` | interface | 43 | <code>export interface CapturedBytes {bytes:Uint8Array;digest:string;size_bytes:string;complete:boolean}</code> |
| `RunnerRemoteResult` | interface | 44 | <code>export interface RunnerRemoteResult {</code> |
| `RunnerRemote` | interface | 61 | <code>export interface RunnerRemote {</code> |
| `prepare` | method | 62 | <code>prepare(tx:PrimaryTransaction,invocation:InvocationContext,plan:RunnerRemotePlan):Promise&lt;RunnerRemotePermit&gt;;</code> |
| `execute` | method | 63 | <code>execute(permit:RunnerRemotePermit,signal:AbortSignal):Promise&lt;RunnerRemoteResult&gt;;</code> |
| `recover` | method | 64 | <code>recover(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerRemotePlan):Promise&lt;RunnerRemotePermit&gt;;</code> |
| `Binding` | interface | 66 | <code>interface Binding extends Record&lt;string,any&gt; {</code> |
| `ProviderExecution` | interface | 71 | <code>interface ProviderExecution {</code> |
| `registerRunnerBindingVerifier` | method | 72 | <code>registerRunnerBindingVerifier(reader:(tx:PrimaryTransaction,binding:Record&lt;string,unknown&gt;)=&gt;Promise&lt;{evidence_digest:string;observed_at:string}&#124;null&gt;):void;</code> |
| `executeBound` | method | 73 | <code>executeBound(request:Record&lt;string,unknown&gt;,signal:AbortSignal):Promise&lt;Record&lt;string,any&gt;&gt;;</code> |
| `Resources` | interface | 75 | <code>interface Resources {</code> |
| `assertJobReservation` | method | 76 | <code>assertJobReservation(tx:PrimaryTransaction,input:Record&lt;string,unknown&gt;):Promise&lt;Record&lt;string,any&gt;&gt;;</code> |
| `readJobAllocation` | method | 77 | <code>readJobAllocation(tx:PrimaryTransaction,input:Record&lt;string,unknown&gt;):Promise&lt;Record&lt;string,any&gt;&#124;null&gt;;</code> |
| `isRemote` | function | 79 | <code>const isRemote=(v:unknown):v is RunnerRemote=&gt;object(v)&amp;&amp;typeof v.prepare==='function'&amp;&amp;typeof v.execute==='function';</code> |
| `isResources` | function | 80 | <code>const isResources=(v:unknown):v is Resources=&gt;object(v)&amp;&amp;typeof v.assertJobReservation==='function'&amp;&amp;typeof v.readJobAllocation==='function';</code> |
| `isProvider` | function | 81 | <code>const isProvider=(v:unknown):v is ProviderExecution=&gt;object(v)&amp;&amp;typeof v.executeBound==='function'&amp;&amp;typeof v.registerRunnerBindingVerifier==='function';</code> |
| `RunnerPreparation` | interface | 82 | <code>export interface RunnerPreparation {prepare(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerPreparationPlan):Promise&lt;RunnerRemotePermit&gt;;execute(permit:RunnerRemotePermit,signal:AbortSignal):Prom…</code> |
| `prepare` | method | 82 | <code>export interface RunnerPreparation {prepare(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerPreparationPlan):Promise&lt;RunnerRemotePermit&gt;;execute(permit:RunnerRemotePermit,signal:AbortSignal):Prom…</code> |
| `execute` | method | 82 | <code>export interface RunnerPreparation {prepare(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerPreparationPlan):Promise&lt;RunnerRemotePermit&gt;;execute(permit:RunnerRemotePermit,signal:AbortSignal):Prom…</code> |
| `assertJobAdmission` | method | 82 | <code>export interface RunnerPreparation {prepare(tx:PrimaryTransaction,i:InvocationContext,plan:RunnerPreparationPlan):Promise&lt;RunnerRemotePermit&gt;;execute(permit:RunnerRemotePermit,signal:AbortSignal):Prom…</code> |
| `verifyReceipt` | method | 84 | <code>verifyReceipt(bytes:Buffer,plan:PreparationReceiptPlan):VerifiedPreparationReceipt;recordReceipt(tx:PrimaryTransaction,i:InvocationContext,input:{operation_id:string;receipt_base64:string}):Promise&lt;Re…</code> |
| `recordReceipt` | method | 84 | <code>verifyReceipt(bytes:Buffer,plan:PreparationReceiptPlan):VerifiedPreparationReceipt;recordReceipt(tx:PrimaryTransaction,i:InvocationContext,input:{operation_id:string;receipt_base64:string}):Promise&lt;Re…</code> |
| `readReceipt` | method | 84 | <code>verifyReceipt(bytes:Buffer,plan:PreparationReceiptPlan):VerifiedPreparationReceipt;recordReceipt(tx:PrimaryTransaction,i:InvocationContext,input:{operation_id:string;receipt_base64:string}):Promise&lt;Re…</code> |
| `requireRunnerPreparation` | function | 85 | <code>export function requireRunnerPreparation(ctx:ComponentContext):RunnerPreparation{return ctx.dependencies.require('12.4','runner.preparation.v1',(v:unknown):v is RunnerPreparation=&gt;object(v)&amp;&amp;typeof v.…</code> |
| `requireRunnerRemote` | function | 86 | <code>export function requireRunnerRemote(ctx:ComponentContext):RunnerRemote {</code> |
| `runnerCanonical` | function | 89 | <code>export function runnerCanonical(v:unknown):string {</code> |
| `safeRelative` | function | 95 | <code>function safeRelative(v:string):boolean {return v!==''&amp;&amp;!path.posix.isAbsolute(v)&amp;&amp;!v.includes('&#92;&#92;')&amp;&amp;!/&#91;&#92;x00-&#92;x1f&#93;/.test(v)&amp;&amp;v.split('/').every(p=&gt;p!==''&amp;&amp;p!=='.'&amp;&amp;p!=='..');}</code> |
| `absolute` | function | 96 | <code>function absolute(v:unknown):v is string {return typeof v==='string'&amp;&amp;v.startsWith('/')&amp;&amp;!v.includes('&#92;&#92;')&amp;&amp;!/&#91;&#92;x00-&#92;x1f&#93;/.test(v)&amp;&amp;v.split('/').slice(1).every(p=&gt;p!==''&amp;&amp;p!=='.'&amp;&amp;p!=='..');}</code> |
| `digest` | function | 97 | <code>function digest(v:unknown):v is string{return typeof v==='string'&amp;&amp;DIGEST.test(v);}</code> |
| `schema` | function | 98 | <code>async function schema(ctx:ComponentContext):Promise&lt;void&gt; {</code> |
| `readRunnerBinding` | function | 105 | <code>export async function readRunnerBinding(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;session_id:string}):Promise&lt;Binding&gt; {</code> |
| `readRunnerPreparationBinding` | function | 122 | <code>export async function readRunnerPreparationBinding(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;session_id:string}):Promise&lt;Binding&gt; {</code> |
| `readRunnerReadiness` | function | 140 | <code>export async function readRunnerReadiness(tx:PrimaryTransaction,r:Binding):Promise&lt;Record&lt;string,any&gt;&gt; {</code> |
| `observe` | function | 145 | <code>async function observe(tx:PrimaryTransaction,v:Record&lt;string,unknown&gt;,i:InvocationContext):Promise&lt;unknown&gt; {</code> |
| `RunnerJobNamespace` | type | 166 | <code>export type RunnerJobNamespace='QUALIFICATION'&#124;'REPRODUCTION'&#124;'CANDIDATE'&#124;'CHECKPOINT'&#124;'PREWARM';</code> |
| `RunnerPreparationJobBinding` | interface | 167 | <code>export interface RunnerPreparationJobBinding {</code> |
| `RunnerPreparationAdmission` | interface | 170 | <code>export interface RunnerPreparationAdmission {</code> |
| `RunnerPreparationAdmissionReader` | type | 173 | <code>export type RunnerPreparationAdmissionReader=(tx:PrimaryTransaction,i:InvocationContext,request:RunnerPreparationPlan)=&gt;Promise&lt;RunnerPreparationAdmission&#124;null&gt;;</code> |
| `RunnerEnvironmentRequest` | interface | 174 | <code>export interface RunnerEnvironmentRequest {</code> |
| `RunnerExpectedInputs` | interface | 178 | <code>export interface RunnerExpectedInputs {</code> |
| `RunnerInputReader` | type | 188 | <code>export type RunnerInputReader=(tx:PrimaryTransaction,i:InvocationContext,request:RunnerEnvironmentRequest)=&gt;Promise&lt;RunnerExpectedInputs&#124;null&gt;;</code> |
| `verifyEnvironment` | function | 189 | <code>async function verifyEnvironment(tx:PrimaryTransaction,i:InvocationContext,v:RunnerEnvironmentRequest,</code> |
| `createComponent` | function | 229 | <code>export async function createComponent(ctx:ComponentContext):Promise&lt;Component&gt; {</code> |
| `approvedRecipePolicy` | function | 292 | <code>async function approvedRecipePolicy(ctx:ComponentContext,tx:PrimaryTransaction,i:InvocationContext,target?:Binding):Promise&lt;{digest:string;recipes:Record&lt;string,any&gt;}&gt; {</code> |
| `permits` | variable | 306 | <code>const permits=new WeakMap&lt;object,{context:ComponentContext;plan:RunnerRemotePlan;binding:Binding;principal:Principal;invocation:InvocationContext;digest:string}&gt;();</code> |
| `validatePlan` | function | 307 | <code>function validatePlan(plan:RunnerRemotePlan):void {</code> |
| `runnerResultSigningBytes` | function | 311 | <code>export function runnerResultSigningBytes(org:string,run:string,op:string,plan:string,result:string):Buffer{return Buffer.from(&#96;HYPERFIDE-RUNNER-RESULT-V1&#92;n${org}&#92;n${run}&#92;n${op}&#92;n${plan}&#92;n${result}&#92;n&#96;)…</code> |
| `resolveRunnerCapturedReference` | function | 315 | <code>export async function resolveRunnerCapturedReference(store:ArtifactStoreCapability,i:InvocationContext,ref:unknown):Promise&lt;CapturedBytes&gt; {</code> |
| `decodeResult` | function | 348 | <code>async function decodeResult(row:Record&lt;string,any&gt;,store:ArtifactStoreCapability,i:InvocationContext,plan:RunnerRemotePlan):Promise&lt;RunnerRemoteResult&gt; {</code> |
| `createRemoteComponent` | function | 372 | <code>export async function createRemoteComponent(ctx:ComponentContext):Promise&lt;Component&gt; {</code> |
| `done` | function | 420 | <code>await new Promise&lt;void&gt;((resolve,reject)=&gt;{const timer=setTimeout(done,250);function done(){signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);reject(new Error…</code> |
| `cancel` | function | 420 | <code>await new Promise&lt;void&gt;((resolve,reject)=&gt;{const timer=setTimeout(done,250);function done(){signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);reject(new Error…</code> |

## services/hyperfide/src/runner/capture.ts

[Open source](../../services/hyperfide/src/runner/capture.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RunnerCaptureCapability` | interface | 18 | <code>export interface RunnerCaptureCapability {</code> |
| `putChunk` | method | 19 | <code>putChunk(i:InvocationContext,input:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;;</code> |
| `isRunnerCaptureCapability` | function | 22 | <code>export function isRunnerCaptureCapability(v:unknown):v is RunnerCaptureCapability{return object(v)&amp;&amp;typeof v.putChunk==='function'&amp;&amp;typeof v.assertPublicationAllowed==='function';}</code> |
| `stored` | function | 24 | <code>async function stored(store:ArtifactStoreCapability,i:InvocationContext,part:Buffer):Promise&lt;{artifact_id:string;digest:string}&gt;{</code> |
| `createComponent` | function | 31 | <code>export function createComponent(ctx:ComponentContext):Component{</code> |

## services/hyperfide/src/runner/dispatch.ts

[Open source](../../services/hyperfide/src/runner/dispatch.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RunnerSpawnInput` | interface | 15 | <code>export interface RunnerSpawnInput {</code> |
| `RunnerLaunchPlan` | interface | 19 | <code>export interface RunnerLaunchPlan {</code> |
| `RunnerPlanReader` | type | 24 | <code>export type RunnerPlanReader=(tx:PrimaryTransaction,input:RunnerSpawnInput,invocation:InvocationContext)=&gt;Promise&lt;RunnerLaunchPlan&#124;null&gt;;</code> |
| `RunnerDispatch` | interface | 25 | <code>export interface RunnerDispatch {</code> |
| `registerPlanReader` | method | 26 | <code>registerPlanReader(reader:RunnerPlanReader):()=&gt;void;</code> |
| `consume` | method | 27 | <code>consume(tx:PrimaryTransaction,i:InvocationContext,input:{event_id:string;attempt_count:string}):Promise&lt;unknown&gt;;</code> |
| `describe` | method | 28 | <code>describe():{route_ready:boolean;status:'READY'&#124;'NOT_READY';launch_authority:false;reason:string&#124;null};</code> |
| `isRunnerDispatch` | function | 30 | <code>export function isRunnerDispatch(v:unknown):v is RunnerDispatch {</code> |
| `requireRunnerDispatch` | function | 33 | <code>export function requireRunnerDispatch(ctx:ComponentContext):RunnerDispatch {</code> |
| `createComponent` | function | 37 | <code>export function createComponent(ctx:ComponentContext):Component {</code> |

## services/hyperfide/src/runner/executor.ts

[Open source](../../services/hyperfide/src/runner/executor.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Signer` | interface | 22 | <code>interface Signer {credential_id:string;key:KeyObject;public_key_b64:string}</code> |
| `ProviderResult` | interface | 23 | <code>interface ProviderResult {outcome:unknown;process_ref:unknown;captured?:CapturedProviderOutput;evidence_digest?:unknown;cleanup_confirmed?:unknown;&#91;name:string&#93;:unknown}</code> |
| `ProviderExecution` | interface | 24 | <code>interface ProviderExecution {</code> |
| `executeBound` | method | 25 | <code>executeBound(input:BoundProviderRequest,signal:AbortSignal,invocation:InvocationContext):Promise&lt;ProviderResult&gt;;</code> |
| `registerRunnerBindingVerifier` | method | 26 | <code>registerRunnerBindingVerifier(reader:(tx:PrimaryTransaction,binding:BoundProviderRequest&#91;'binding'&#93;,request:unknown)=&gt;Promise&lt;{evidence_digest:string;observed_at:string}&#124;null&gt;):void&#124;(()=&gt;void);</code> |
| `Packet` | interface | 28 | <code>interface Packet {source_state_digest:string;workspace_digest:string;request:RunnerRemotePlan;binding:Record&lt;string,any&gt;;allocation:Record&lt;string,any&gt;;reservations:unknown}</code> |
| `Job` | interface | 29 | <code>interface Job {organisation_id:string;run_id:string;operation_id:string;session_id:string;plan:Packet;plan_digest:string;principal:Principal;authority_epoch:string;reservation_id:string;expires_at:Dat…</code> |
| `ObjectReference` | interface | 30 | <code>interface ObjectReference {storage_kind:'manifest';artifact_id:string;digest:string;manifest_digest:string;size_bytes:string;complete:boolean}</code> |
| `NativeControlAction` | type | 31 | <code>export type NativeControlAction='runner.observe'&#124;'runner.stop'&#124;'runner.pause'&#124;'runner.drain'&#124;'runner.cancel'&#124;'runner.resume';</code> |
| `NativeRunnerRequest` | interface | 34 | <code>export interface NativeRunnerRequest {session_id:string;operation_id:string;action:NativeControlAction;command_id?:string;launch_id?:string}</code> |
| `NativeRunnerCapability` | interface | 35 | <code>export interface NativeRunnerCapability {</code> |
| `invokeNativeRunner` | method | 36 | <code>invokeNativeRunner(invocation:InvocationContext,input:NativeRunnerRequest,signal:AbortSignal):Promise&lt;unknown&gt;;</code> |
| `authenticatePlacementProbe` | method | 37 | <code>authenticatePlacementProbe(invocation:InvocationContext,input:{probe_id:string},signal:AbortSignal):Promise&lt;{request:BoundProviderRequest;invocation:InvocationContext}&gt;;</code> |
| `isNativeRunnerCapability` | function | 39 | <code>export function isNativeRunnerCapability(v:unknown):v is NativeRunnerCapability {</code> |
| `isProvider` | function | 42 | <code>const isProvider=(v:unknown):v is ProviderExecution=&gt;object(v)&amp;&amp;typeof v.executeBound==='function'&amp;&amp;typeof v.registerRunnerBindingVerifier==='function';</code> |
| `digest` | function | 45 | <code>function digest(v:unknown):v is string{return typeof v==='string'&amp;&amp;DIGEST.test(v);}</code> |
| `same` | function | 46 | <code>function same(a:unknown,b:unknown):boolean{return runnerCanonical(a)===runnerCanonical(b);}</code> |
| `privateBytes` | function | 49 | <code>async function privateBytes(filename:unknown,limit:number):Promise&lt;Buffer&gt;{</code> |
| `configuration` | function | 57 | <code>async function configuration(ctx:ComponentContext):Promise&lt;{signers:Signer&#91;&#93;;concurrency:number}&gt;{</code> |
| `currentSigner` | function | 71 | <code>function currentSigner(row:Record&lt;string,any&gt;&#124;undefined,s:Signer):row is Record&lt;string,any&gt;{</code> |
| `authenticate` | function | 74 | <code>async function authenticate(authority:IdentityAuthority,signer:Signer,run:string,epoch:string,input:BoundProviderRequest,signal:AbortSignal):Promise&lt;InvocationContext&gt;{</code> |
| `boundRequest` | function | 84 | <code>function boundRequest(binding:Record&lt;string,any&gt;,operation_id:string,argv:string&#91;&#93;,timeout_ms:number):BoundProviderRequest{</code> |
| `jobRequest` | function | 88 | <code>function jobRequest(row:Job):BoundProviderRequest{</code> |
| `decodeNative` | function | 93 | <code>function decodeNative(captured:CapturedProviderOutput):{raw:Buffer;digest:string;receipt:Record&lt;string,any&gt;}{</code> |
| `capturedItem` | function | 101 | <code>function capturedItem(value:unknown):{base64:string;digest:string;size_bytes:string;complete:boolean;bytes:Buffer}{</code> |
| `validateReceipt` | function | 106 | <code>function validateReceipt(row:Job,value:Record&lt;string,any&gt;):void{</code> |
| `storeBytes` | function | 118 | <code>async function storeBytes(store:ArtifactStoreCapability,i:InvocationContext,bytes:Buffer):Promise&lt;ObjectReference&gt;{</code> |
| `persistableResult` | function | 130 | <code>async function persistableResult(store:ArtifactStoreCapability,i:InvocationContext,row:Job,provider:ProviderResult,decoded:ReturnType&lt;typeof decodeNative&gt;):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `wait` | function | 138 | <code>async function wait(ms:number,signal:AbortSignal):Promise&lt;void&gt;{</code> |
| `done` | function | 139 | <code>if(signal.aborted)return;await new Promise&lt;void&gt;(resolve=&gt;{const timer=setTimeout(done,ms);function done(){signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);d…</code> |
| `cancel` | function | 139 | <code>if(signal.aborted)return;await new Promise&lt;void&gt;(resolve=&gt;{const timer=setTimeout(done,ms);function done(){signal.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);d…</code> |
| `retainedControlBinding` | function | 143 | <code>async function retainedControlBinding(tx:PrimaryTransaction,i:InvocationContext,session_id:string,launch_id:string):Promise&lt;Record&lt;string,any&gt;&gt;{</code> |
| `controlRequest` | function | 155 | <code>function controlRequest(binding:Record&lt;string,any&gt;,input:NativeRunnerRequest):BoundProviderRequest{</code> |
| `NativeControlTarget` | interface | 159 | <code>export interface NativeControlTarget {readonly launch_id:string;readonly attempt_id:string;readonly attempt_generation:string;readonly sandbox_id:string;readonly boot_id:string;readonly boot_generatio…</code> |
| `CONTROL_STATUS` | object | 162 | <code>const CONTROL_STATUS:Record&lt;string,readonly string&#91;&#93;&gt;={'runner.observe':&#91;'RUNNING','CONFIRMED_STOPPED','UNKNOWN','PAUSED','DRAINING','DRAINED','CANCELLED','UNRESOLVED'&#93;,'runner.stop':&#91;'CONFIRMED_STOPP…</code> |
| `validateControlCleanup` | function | 163 | <code>function validateControlCleanup(receipt:Record&lt;string,unknown&gt;,action:NativeControlAction):void{</code> |
| `validateNativeControlReceipt` | function | 171 | <code>export function validateNativeControlReceipt(value:unknown,target:NativeControlTarget,command_id?:string,action?:NativeControlAction):Record&lt;string,unknown&gt;{</code> |
| `createComponent` | function | 188 | <code>export async function createComponent(ctx:ComponentContext):Promise&lt;Component&gt;{</code> |

## services/hyperfide/src/runner/preparation_receipts.ts

[Open source](../../services/hyperfide/src/runner/preparation_receipts.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PreparationStageReceipt` | interface | 13 | <code>export interface PreparationStageReceipt {</code> |
| `PreparationReceiptPlan` | interface | 17 | <code>export interface PreparationReceiptPlan {operation_id:string;plan_digest:string;argv:readonly string&#91;&#93;;executable_digest:string;workspace_path?:string;uid?:number;gid?:number}</code> |
| `VerifiedPreparationReceipt` | interface | 18 | <code>export interface VerifiedPreparationReceipt {receipt:Record&lt;string,unknown&gt;;stage:PreparationStageReceipt;receipt_digest:string}</code> |
| `absolute` | function | 19 | <code>function absolute(v:unknown):v is string{return typeof v==='string'&amp;&amp;v.startsWith('/')&amp;&amp;!v.includes('&#92;0')&amp;&amp;v.split('/').slice(1).every(p=&gt;p!==''&amp;&amp;p!=='.'&amp;&amp;p!=='..');}</code> |
| `digest` | function | 20 | <code>function digest(v:unknown):v is string{return typeof v==='string'&amp;&amp;DIGEST.test(v);}</code> |
| `verifyPreparationReceipt` | function | 23 | <code>export function verifyPreparationReceipt(bytes:Buffer,plan:PreparationReceiptPlan):VerifiedPreparationReceipt{</code> |
| `recordPreparationReceipt` | function | 40 | <code>export async function recordPreparationReceipt(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `readPreparationReceipt` | function | 57 | <code>export async function readPreparationReceipt(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;operation_id:string}):Promise&lt;Record&lt;string,unknown&gt;&#124;null&gt;{</code> |

## services/hyperfide/src/runner/reproduction_jobs.ts

[Open source](../../services/hyperfide/src/runner/reproduction_jobs.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ReproductionJobInputRequest` | interface | 10 | <code>export interface ReproductionJobInputRequest {</code> |
| `ReproductionExpectedAuthority` | interface | 15 | <code>export interface ReproductionExpectedAuthority {</code> |
| `ReproductionAuthorityReader` | type | 25 | <code>export type ReproductionAuthorityReader=(tx:PrimaryTransaction,i:InvocationContext,request:ReproductionJobInputRequest)=&gt;Promise&lt;ReproductionExpectedAuthority&#124;null&gt;;</code> |
| `ReproductionPreparedInputs` | interface | 26 | <code>export interface ReproductionPreparedInputs extends RunnerExpectedInputs {</code> |
| `ReproductionPreparationReader` | type | 29 | <code>export type ReproductionPreparationReader=(tx:PrimaryTransaction,i:InvocationContext,authority:ReproductionExpectedAuthority)=&gt;Promise&lt;ReproductionPreparedInputs&#124;null&gt;;</code> |
| `EnvironmentCapability` | interface | 30 | <code>interface EnvironmentCapability {</code> |
| `registerInputReader` | method | 31 | <code>registerInputReader(namespace:'REPRODUCTION',reader:RunnerInputReader):()=&gt;void;</code> |
| `PreparationReceiptCapability` | interface | 33 | <code>interface PreparationReceiptCapability {</code> |
| `read` | method | 34 | <code>read(tx:PrimaryTransaction,i:InvocationContext,request:RunnerEnvironmentRequest):Promise&lt;ReproductionPreparedInputs&#124;null&gt;;</code> |
| `oid` | function | 37 | <code>const oid=(v:unknown):v is string=&gt;typeof v==='string'&amp;&amp;/^(?:&#91;a-f0-9&#93;{40}&#124;&#91;a-f0-9&#93;{64})$/.test(v);</code> |
| `digest` | function | 38 | <code>const digest=(v:unknown):v is string=&gt;typeof v==='string'&amp;&amp;DIGEST.test(v);</code> |
| `denied` | function | 39 | <code>const denied=():never=&gt;fail('REPRODUCTION_INPUT_AUTHORITY_DENIED','Exact reproduction namespace, job, lease and immutable source inputs are required');</code> |
| `reproductionJobRequest` | function | 41 | <code>export function reproductionJobRequest(request:RunnerEnvironmentRequest):ReproductionJobInputRequest {</code> |
| `bindReproductionInputs` | function | 49 | <code>export function bindReproductionInputs(authority:ReproductionExpectedAuthority,prepared:ReproductionPreparedInputs&#124;null,request:RunnerEnvironmentRequest,</code> |
| `createReproductionJobInputReader` | function | 74 | <code>export function createReproductionJobInputReader(readAuthority:ReproductionAuthorityReader,readPreparation:ReproductionPreparationReader):RunnerInputReader {</code> |
| `registerReproductionJobInputs` | function | 87 | <code>export function registerReproductionJobInputs(ctx:ComponentContext,readAuthority:ReproductionAuthorityReader,</code> |

## services/hyperfide/src/runner/workspaces.ts

[Open source](../../services/hyperfide/src/runner/workspaces.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RunnerControlAction` | type | 16 | <code>export type RunnerControlAction=typeof RUNNER_CONTROL_ACTIONS&#91;number&#93;;</code> |
| `OUTCOMES` | object | 17 | <code>const OUTCOMES:Record&lt;RunnerControlAction,readonly string&#91;&#93;&gt;={'runner.pause':&#91;'PAUSED','UNRESOLVED'&#93;,'runner.drain':&#91;'DRAINING','DRAINED','UNRESOLVED'&#93;,'runner.cancel':&#91;'CANCELLED','UNRESOLVED'&#93;,'runn…</code> |
| `TERMINATION` | object | 19 | <code>const TERMINATION:Record&lt;string,string&gt;={PAUSED:'FROZEN',DRAINED:'CONFIRMED',CANCELLED:'CONFIRMED',STOPPED:'CONFIRMED',RESUMED:'NOT_REQUIRED',DRAINING:'NOT_REQUIRED',UNRESOLVED:'UNRESOLVED'};</code> |
| `RunnerControlPolicy` | interface | 23 | <code>export interface RunnerControlPolicy {grace_ms:number;drain_deadline_ms:number;on_drain_deadline:'STOP'&#124;'REPORT'}</code> |
| `policyOf` | function | 24 | <code>function policyOf(v:unknown):RunnerControlPolicy{</code> |
| `scope` | function | 30 | <code>function scope(p:Principal):{organisation_id:string;run_id:string}{return {organisation_id:p.organisation_id,run_id:p.run_id};}</code> |
| `role` | function | 31 | <code>function role(i:InvocationContext,roles:readonly string&#91;&#93;):void{if(!roles.includes(i.principal.role))fail('ROLE_DENIED','Control role required: '+roles.join('&#124;'));}</code> |
| `commandView` | function | 32 | <code>export function commandView(row:Record&lt;string,any&gt;):Record&lt;string,unknown&gt;{</code> |
| `lockLaunch` | function | 35 | <code>async function lockLaunch(tx:PrimaryTransaction,s:{organisation_id:string;run_id:string},launch:string):Promise&lt;void&gt;{</code> |
| `load` | function | 38 | <code>async function load(tx:PrimaryTransaction,s:{organisation_id:string;run_id:string},command:string,lock=false):Promise&lt;Record&lt;string,any&gt;&#124;undefined&gt;{</code> |
| `issueRunnerControl` | function | 45 | <code>export async function issueRunnerControl(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `assertRunnerPublicationAllowed` | function | 73 | <code>export async function assertRunnerPublicationAllowed(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;attempt_id:string;attempt_generation:string}):Promise&lt;{fenced_generation:string&#124;n…</code> |
| `authorizeRunnerControl` | function | 82 | <code>export async function authorizeRunnerControl(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `captures` | function | 98 | <code>async function captures(tx:PrimaryTransaction,s:{organisation_id:string;run_id:string},command:string):Promise&lt;Record&lt;string,any&gt;&#91;&#93;&gt;{</code> |
| `outputsDurable` | function | 101 | <code>async function outputsDurable(tx:PrimaryTransaction,s:{organisation_id:string;run_id:string},row:Record&lt;string,any&gt;):Promise&lt;string&#91;&#93;&gt;{</code> |
| `reportRunnerControl` | function | 108 | <code>export async function reportRunnerControl(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `inspectRunnerControl` | function | 131 | <code>export async function inspectRunnerControl(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `registerRunnerWorkspace` | function | 142 | <code>export async function registerRunnerWorkspace(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `leaseRunnerWorkspace` | function | 150 | <code>export async function leaseRunnerWorkspace(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `releaseRunnerWorkspace` | function | 160 | <code>export async function releaseRunnerWorkspace(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |
| `inspectRunnerWorkspace` | function | 178 | <code>export async function inspectRunnerWorkspace(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise&lt;Record&lt;string,unknown&gt;&gt;{</code> |

## services/hyperfide/src/scheduler/claim.ts

[Open source](../../services/hyperfide/src/scheduler/claim.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ExecutionMode` | type | 13 | <code>export type ExecutionMode='ACTIVE'&#124;'PAUSE'&#124;'DRAIN'&#124;'STOP';</code> |
| `ExecutionControl` | interface | 14 | <code>export interface ExecutionControl {</code> |
| `applyExecutionControl` | function | 17 | <code>export async function applyExecutionControl(tx:PrimaryTransaction,scope:SchedulerScope,input:ExecutionControl):Promise&lt;unknown&gt;{</code> |
| `ExecutionTarget` | interface | 57 | <code>export interface ExecutionTarget {</code> |
| `admissionTimes` | function | 62 | <code>async function admissionTimes(tx:PrimaryTransaction,scope:SchedulerScope,target:ExecutionTarget):Promise&lt;string&#91;&#93;&gt;{</code> |
| `assertNoExecutionHold` | function | 78 | <code>export async function assertNoExecutionHold(tx:PrimaryTransaction,scope:SchedulerScope,target:ExecutionTarget):Promise&lt;void&gt;{</code> |
| `assertExecutionContinuation` | function | 105 | <code>export async function assertExecutionContinuation(tx:PrimaryTransaction,scope:SchedulerScope,target:ExecutionTarget):Promise&lt;void&gt;{</code> |
| `PacketResourceRequirements` | interface | 113 | <code>export interface PacketResourceRequirements {</code> |
| `packetResources` | function | 116 | <code>export function packetResources(value:unknown):PacketResourceRequirements {</code> |
| `packetPolicyResources` | function | 125 | <code>export function packetPolicyResources(packet:unknown):PacketResourceRequirements {</code> |
| `approvedDimensions` | function | 139 | <code>export async function approvedDimensions(tx:PrimaryTransaction,scope:SchedulerScope,pool_id:string,</code> |
| `approvedPhysicalDimensions` | function | 172 | <code>export async function approvedPhysicalDimensions(tx:PrimaryTransaction,scope:SchedulerScope,pool_id:string,resources:unknown,warm_spare=false):Promise&lt;CapacityDimension&#91;&#93;&gt;{</code> |
| `requireProofRegistry` | function | 185 | <code>export async function requireProofRegistry(tx:PrimaryTransaction,scope:SchedulerScope,task:{</code> |
| `SchedulerScope` | interface | 198 | <code>export interface SchedulerScope {organisation_id:string;run_id:string}</code> |
| `SchedulerActor` | interface | 199 | <code>export interface SchedulerActor {session_id:string;leader_generation:string;package_generation?:string}</code> |
| `CapacityDimension` | interface | 200 | <code>export interface CapacityDimension {capacity_account_id:string;quantity:string}</code> |
| `CapacityRequest` | interface | 201 | <code>export interface CapacityRequest extends SchedulerScope {</code> |
| `ComputeToken` | interface | 204 | <code>export interface ComputeToken extends SchedulerScope {</code> |
| `fail` | function | 210 | <code>export function fail(code:string,message:string):never{throw new FoundationError(code,message);}</code> |
| `object` | function | 211 | <code>export function object(value:unknown):Record&lt;string,unknown&gt;{</code> |
| `fields` | function | 215 | <code>export function fields(value:unknown,required:readonly string&#91;&#93;,optional:readonly string&#91;&#93;=&#91;&#93;):Record&lt;string,unknown&gt;{</code> |
| `uuid` | function | 221 | <code>export function uuid(value:unknown,label:string):string{</code> |
| `decimal` | function | 224 | <code>export function decimal(value:unknown,label:string,zero=false):string{</code> |
| `digest` | function | 229 | <code>export function digest(value:unknown,label:string):string{</code> |
| `boundedInteger` | function | 232 | <code>export function boundedInteger(value:unknown,label:string,min:number,max:number):number{</code> |
| `canonical` | function | 236 | <code>export function canonical(value:unknown):string{</code> |
| `requestDigest` | function | 243 | <code>export function requestDigest(value:unknown):string{</code> |
| `gatewayFor` | function | 246 | <code>export function gatewayFor(context:ComponentContext,continuation?:(tx:PrimaryTransaction)=&gt;Promise&lt;unknown&gt;):Pick&lt;TransactionGateway,'withPrimaryTransaction'&gt;{</code> |
| `invocationFor` | function | 268 | <code>export function invocationFor(context:ComponentContext):InvocationContext {</code> |
| `actorFor` | function | 271 | <code>export function actorFor(context:ComponentContext,scope:SchedulerScope,request:Record&lt;string,unknown&gt;):SchedulerActor{</code> |
| `dispatchRecipients` | function | 281 | <code>export function dispatchRecipients(context:ComponentContext,kind:'dispatch'&#124;'native'='dispatch'):{consumer_ids:string&#91;&#93;}{</code> |
| `requireSchedulerAuthority` | function | 287 | <code>export async function requireSchedulerAuthority(tx:PrimaryTransaction,scope:SchedulerScope,actor:SchedulerActor,</code> |
| `operationReplay` | function | 295 | <code>export async function operationReplay(tx:PrimaryTransaction,scope:SchedulerScope,principal:string,</code> |
| `recordOutcome` | function | 307 | <code>export async function recordOutcome(tx:PrimaryTransaction,scope:SchedulerScope,principal:string,</code> |
| `dimensions` | function | 313 | <code>export function dimensions(value:unknown):CapacityDimension&#91;&#93;{</code> |
| `reserveCapacity` | function | 321 | <code>export async function reserveCapacity(tx:PrimaryTransaction,input:CapacityRequest):Promise&lt;unknown&#91;&#93;&gt;{</code> |
| `declaredScopes` | function | 365 | <code>function declaredScopes(definition:unknown):string&#91;&#93;{</code> |
| `lockScopes` | function | 383 | <code>async function lockScopes(tx:PrimaryTransaction,scope:SchedulerScope,paths:string&#91;&#93;):Promise&lt;void&gt;{</code> |
| `overlap` | function | 399 | <code>const overlap=(a:string,b:string)=&gt;a==='.'&#124;&#124;b==='.'&#124;&#124;a===b&#124;&#124;a.startsWith(b+'/')&#124;&#124;b.startsWith(a+'/');</code> |
| `ClaimRequest` | interface | 400 | <code>export interface ClaimRequest extends SchedulerScope {</code> |
| `parseClaim` | function | 405 | <code>export function parseClaim(value:unknown):ClaimRequest{</code> |
| `requireMilestone` | function | 425 | <code>export async function requireMilestone(tx:PrimaryTransaction,scope:SchedulerScope,task_id:string,</code> |
| `requireTaskBarriers` | function | 448 | <code>export async function requireTaskBarriers(tx:PrimaryTransaction,scope:SchedulerScope,task_id:string,wave:number):Promise&lt;void&gt;{</code> |
| `requirePacketAdmission` | function | 471 | <code>export async function requirePacketAdmission(tx:PrimaryTransaction,input:ClaimRequest,task:{</code> |
| `jobPolicy` | function | 489 | <code>export async function jobPolicy(tx:PrimaryTransaction,scope:SchedulerScope,task_id:string,operation:'ADMISSION'&#124;'ADVANCE'='ADVANCE'):Promise&lt;PacketResourceRequirements&gt;{</code> |
| `allocateReservations` | function | 504 | <code>export async function allocateReservations(tx:PrimaryTransaction,input:SchedulerScope&amp;{reservation_ids:string&#91;&#93;}):Promise&lt;void&gt;{</code> |
| `assertJobReservation` | function | 522 | <code>export async function assertJobReservation(tx:PrimaryTransaction,input:SchedulerScope&amp;{</code> |
| `validateResourceVector` | function | 546 | <code>export async function validateResourceVector(tx:PrimaryTransaction,input:SchedulerScope&amp;{</code> |
| `JobAllocation` | interface | 561 | <code>export interface JobAllocation extends SchedulerScope {</code> |
| `bindJobReservation` | function | 566 | <code>export async function bindJobReservation(tx:PrimaryTransaction,input:SchedulerScope&amp;{</code> |
| `readJobAllocation` | function | 602 | <code>export async function readJobAllocation(tx:PrimaryTransaction,input:SchedulerScope&amp;{reservation_id:string}):Promise&lt;JobAllocation&gt;{</code> |
| `JobLeaseRequest` | interface | 616 | <code>export interface JobLeaseRequest extends SchedulerScope {</code> |
| `renewJobAllocation` | function | 619 | <code>export async function renewJobAllocation(tx:PrimaryTransaction,input:JobLeaseRequest&amp;{lease_ms:number}):Promise&lt;{</code> |
| `releaseJobAllocation` | function | 639 | <code>export async function releaseJobAllocation(tx:PrimaryTransaction,input:JobLeaseRequest):Promise&lt;unknown&gt;{</code> |
| `claimTask` | function | 655 | <code>export async function claimTask(tx:PrimaryTransaction,input:ClaimRequest,actor:SchedulerActor,recipients:{consumer_ids:string&#91;&#93;}):Promise&lt;unknown&gt;{</code> |
| `SandboxResourceVector` | interface | 764 | <code>export interface SandboxResourceVector {cpu_millis:string;memory_bytes:string;disk_bytes:string}</code> |
| `SandboxExecutor` | interface | 765 | <code>export interface SandboxExecutor extends SchedulerScope {sandbox_id:string;sandbox_boot_generation:string;slot_id:string}</code> |
| `SandboxBudgetQualification` | interface | 766 | <code>export interface SandboxBudgetQualification {</code> |
| `sandboxVector` | function | 770 | <code>function sandboxVector(value:SandboxResourceVector,headroom=false):SandboxResourceVector{</code> |
| `qualifySandboxBudget` | function | 776 | <code>export async function qualifySandboxBudget(tx:PrimaryTransaction,input:SandboxBudgetQualification):Promise&lt;unknown&gt;{</code> |
| `lockSandboxBudget` | function | 797 | <code>export async function lockSandboxBudget(tx:PrimaryTransaction,input:SandboxExecutor):Promise&lt;void&gt;{</code> |
| `reserveSandboxResources` | function | 808 | <code>export async function reserveSandboxResources(tx:PrimaryTransaction,input:SandboxExecutor&amp;{</code> |
| `markSandboxReleasePending` | function | 829 | <code>export async function markSandboxReleasePending(tx:PrimaryTransaction,input:SchedulerScope&amp;{request_id?:string;attempt_id?:string}):Promise&lt;void&gt;{</code> |
| `assertSandboxReservation` | function | 835 | <code>export async function assertSandboxReservation(tx:PrimaryTransaction,input:SchedulerScope&amp;{reservation_id:string}):Promise&lt;unknown&gt;{</code> |
| `readCurrentComputeToken` | function | 843 | <code>export async function readCurrentComputeToken(tx:PrimaryTransaction,input:SchedulerScope&amp;{task_id:string}):Promise&lt;ComputeToken&#124;null&gt;{</code> |
| `releaseSandboxCharges` | function | 850 | <code>export async function releaseSandboxCharges(tx:PrimaryTransaction,scope:SchedulerScope,request_ids:string&#91;&#93;):Promise&lt;void&gt;{</code> |
| `inspectSandboxCharge` | function | 864 | <code>export async function inspectSandboxCharge(tx:PrimaryTransaction,input:SchedulerScope&amp;{request_id:string}):Promise&lt;Record&lt;string,unknown&gt;&#124;null&gt;{</code> |
| `createComponent` | function | 869 | <code>export function createComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/scheduler/dispatch.ts

[Open source](../../services/hyperfide/src/scheduler/dispatch.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `NativeDispatchObservation` | interface | 13 | <code>export interface NativeDispatchObservation {</code> |
| `NativeReceiptReader` | type | 19 | <code>export type NativeReceiptReader=(tx:PrimaryTransaction,</code> |
| `DispatchRow` | interface | 21 | <code>interface DispatchRow {</code> |
| `rowToken` | function | 25 | <code>function rowToken(scope:SchedulerScope,row:DispatchRow):ComputeToken{</code> |
| `sameToken` | function | 29 | <code>function sameToken(a:ComputeToken,b:ComputeToken):boolean{</code> |
| `DispatchReconciler` | class | 33 | <code>export class DispatchReconciler {</code> |
| `registerReceiptReader` | method | 35 | <code>registerReceiptReader(reader:NativeReceiptReader):()=&gt;void{</code> |
| `close` | method | 39 | <code>close():void{this.reader=undefined;}</code> |
| `reconcile` | method | 40 | <code>async reconcile(tx:PrimaryTransaction,scope:SchedulerScope,request_id:string):Promise&lt;unknown&gt;{</code> |
| `ensureDispatch` | function | 89 | <code>export async function ensureDispatch(tx:PrimaryTransaction,token:ComputeToken,request:string,recipients:{consumer_ids:string&#91;&#93;}):Promise&lt;unknown&gt;{</code> |
| `consumeDispatchEvent` | function | 125 | <code>export async function consumeDispatchEvent(tx:PrimaryTransaction,input:SchedulerScope&amp;{event_id:string;consumer_id:string;native_recipients:{consumer_ids:string&#91;&#93;}}):Promise&lt;Awaited&lt;ReturnType&lt;typeof…</code> |
| `createComponent` | function | 140 | <code>export function createComponent(_startup:ComponentContext):Component{</code> |

## services/hyperfide/src/scheduler/leases.ts

[Open source](../../services/hyperfide/src/scheduler/leases.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ComputeAuthority` | interface | 12 | <code>export interface ComputeAuthority extends ComputeToken {</code> |
| `parseComputeToken` | function | 16 | <code>export function parseComputeToken(value:unknown):ComputeToken{</code> |
| `assertCurrentCompute` | function | 26 | <code>export async function assertCurrentCompute(tx:PrimaryTransaction,token:ComputeToken,</code> |
| `requireWorker` | function | 94 | <code>async function requireWorker(tx:PrimaryTransaction,token:ComputeToken,context:ComponentContext):Promise&lt;void&gt;{</code> |
| `renewCompute` | function | 106 | <code>export async function renewCompute(tx:PrimaryTransaction,token:ComputeToken,lease_ms:number):Promise&lt;unknown&gt;{</code> |
| `releaseCompute` | function | 122 | <code>export async function releaseCompute(tx:PrimaryTransaction,token:ComputeToken,</code> |
| `lockComputeFenceTargets` | function | 142 | <code>export async function lockComputeFenceTargets(tx:PrimaryTransaction,tokens:readonly ComputeToken&#91;&#93;):Promise&lt;void&gt;{</code> |
| `ComputeFenceOptions` | interface | 159 | <code>export interface ComputeFenceOptions {</code> |
| `fenceCompute` | function | 162 | <code>export async function fenceCompute(tx:PrimaryTransaction,token:ComputeToken,options:ComputeFenceOptions):Promise&lt;unknown&gt;{</code> |
| `expireCompute` | function | 207 | <code>export async function expireCompute(tx:PrimaryTransaction,scope:SchedulerScope,actor:SchedulerActor,</code> |
| `revokeRunForRecovery` | function | 228 | <code>export async function revokeRunForRecovery(tx:PrimaryTransaction,input:SchedulerScope&amp;{</code> |
| `createComponent` | function | 253 | <code>export function createComponent(context:ComponentContext):Component{</code> |

## services/hyperfide/src/scheduler/resources.ts

[Open source](../../services/hyperfide/src/scheduler/resources.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `EligibleTask` | interface | 17 | <code>export interface EligibleTask {</code> |
| `EligibleResult` | interface | 22 | <code>export interface EligibleResult {</code> |
| `eligibleTasks` | function | 26 | <code>export async function eligibleTasks(tx:PrimaryTransaction,input:SchedulerScope&amp;{pool_id:string;profile_id?:string;limit?:number;preparation?:boolean},invocation?:InvocationContext):Promise&lt;EligibleRes…</code> |
| `eligibleDemand` | function | 96 | <code>export async function eligibleDemand(tx:PrimaryTransaction,input:SchedulerScope&amp;{</code> |
| `QuiescenceReceipt` | interface | 158 | <code>export interface QuiescenceReceipt {id:string;digest:string;observed_at:string}</code> |
| `ProofReader` | type | 159 | <code>export type ProofReader=(tx:PrimaryTransaction,input:SchedulerScope&amp;{reservation_id:string})=&gt;Promise&lt;QuiescenceReceipt&#124;null&gt;;</code> |
| `DynamicCapacityRequest` | interface | 160 | <code>export interface DynamicCapacityRequest extends CapacityRequest {pool_id:string}</code> |
| `JOBS` | variable | 161 | <code>const JOBS=new Set(&#91;'AGENT','BUILD','TEST','REVIEW','INDEX','INTEGRATION','PREPARATION','EXCLUSIVE_SERVICE'&#93;);</code> |
| `REASONS` | variable | 162 | <code>const REASONS=new Set(&#91;'CAPACITY','MODEL','REVIEW','BUILD','PROVIDER_RATE','EXCLUSIVE_SERVICE'&#93;);</code> |
| `scopeOf` | function | 163 | <code>function scopeOf(input:Record&lt;string,unknown&gt;):SchedulerScope{</code> |
| `reserveDynamic` | function | 167 | <code>export async function reserveDynamic(tx:PrimaryTransaction,input:DynamicCapacityRequest):Promise&lt;unknown&gt;{</code> |
| `WAIT_FOR` | object | 215 | <code>const WAIT_FOR:Record&lt;string,string&gt;={MODEL_RATE:'MODEL',API_RATE:'PROVIDER_RATE',PROVISION_RATE:'PROVIDER_RATE',</code> |
| `AdmissionLimit` | interface | 217 | <code>export interface AdmissionLimit {</code> |
| `limitingResource` | function | 222 | <code>export async function limitingResource(tx:PrimaryTransaction,input:SchedulerScope&amp;{pool_id:string;dimensions:CapacityDimension&#91;&#93;;request_id?:string}):Promise&lt;AdmissionLimit&#124;null&gt;{</code> |
| `Backpressure` | interface | 257 | <code>export interface Backpressure {</code> |
| `reviewBackpressure` | function | 266 | <code>export async function reviewBackpressure(tx:PrimaryTransaction,scope:{organisation_id:string},pool_id:string):Promise&lt;Backpressure&gt;{</code> |
| `markWaiting` | function | 280 | <code>async function markWaiting(tx:PrimaryTransaction,scope:SchedulerScope,waiter:string,reason:string):Promise&lt;void&gt;{</code> |
| `ResourceScheduler` | class | 285 | <code>export class ResourceScheduler {</code> |
| `registerProofReader` | method | 287 | <code>registerProofReader(source:string,reader:ProofReader):()=&gt;void{</code> |
| `close` | method | 294 | <code>close():void{this.readers.clear();}</code> |
| `release` | method | 295 | <code>async release(tx:PrimaryTransaction,input:SchedulerScope&amp;{reservation_ids:string&#91;&#93;}):Promise&lt;unknown&gt;{</code> |
| `requireQueueActor` | function | 364 | <code>async function requireQueueActor(tx:PrimaryTransaction,scope:SchedulerScope,actor:SchedulerActor,</code> |
| `createComponent` | function | 375 | <code>export function createComponent(_startup:ComponentContext):Component{</code> |

## services/hyperfide/src/supervisory-host.ts

[Open source](../../services/hyperfide/src/supervisory-host.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `canonicalAbsolute` | function | 19 | <code>function canonicalAbsolute(value:unknown):value is string{</code> |
| `uidValue` | function | 22 | <code>function uidValue(value:unknown,low:number):boolean{return typeof value==='number'&amp;&amp;Number.isSafeInteger(value)&amp;&amp;value&gt;=low&amp;&amp;value&lt;=2147483646;}</code> |
| `validateSupervisoryHostConfig` | function | 24 | <code>export function validateSupervisoryHostConfig(value:unknown):Record&lt;string,unknown&gt;{</code> |
| `privateFile` | function | 40 | <code>async function privateFile(file:string,max:number,executable:boolean):Promise&lt;{bytes:Buffer&#124;null}&gt;{</code> |
| `SupervisoryLaunch` | interface | 53 | <code>export interface SupervisoryLaunch {python:string;script:string;config:string;config_sha256:string;argv:string&#91;&#93;;env:Record&lt;string,string&gt;}</code> |
| `prepareSupervisoryHost` | function | 54 | <code>export async function prepareSupervisoryHost(args:readonly string&#91;&#93;,env:Readonly&lt;NodeJS.ProcessEnv&gt;):Promise&lt;SupervisoryLaunch&gt;{</code> |
| `supervisoryHostCommand` | function | 72 | <code>export async function supervisoryHostCommand(args:readonly string&#91;&#93;,env:Readonly&lt;NodeJS.ProcessEnv&gt;,signal:AbortSignal):Promise&lt;number&gt;{</code> |

## services/hyperfide/src/transport/http.ts

[Open source](../../services/hyperfide/src/transport/http.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HttpTransportOptions` | interface | 8 | <code>export interface HttpTransportOptions{origin:string;host:string;port:number;certificate:string;privateKey:string;signal:AbortSignal;identity:IdentityAuthority;maxConcurrent?:number;deadlineMs?:number;…</code> |
| `HttpTransport` | interface | 9 | <code>export interface HttpTransport{readonly address:string;close():Promise&lt;void&gt;}</code> |
| `close` | method | 9 | <code>export interface HttpTransport{readonly address:string;close():Promise&lt;void&gt;}</code> |
| `tlsFile` | function | 10 | <code>async function tlsFile(file:string,secret:boolean):Promise&lt;Buffer&gt;{const fd=await fs.open(file,'r');try{const s=await fd.stat(),n=await fs.lstat(file);if(!s.isFile()&#124;&#124;n.isSymbolicLink()&#124;&#124;s.ino!==n.ino…</code> |
| `status` | function | 11 | <code>function status(code:string):number{if(code.includes('TOO_LARGE'))return 413;if(code==='ADMISSION_BUSY')return 429;if(code==='OUTCOME_UNKNOWN')return 504;if(code==='SHUTTING_DOWN')return 503;if(&#91;'AUTH…</code> |
| `send` | function | 12 | <code>function send(res:ServerResponse,v:unknown,limit:number,code=200):void{if(res.destroyed&#124;&#124;res.writableEnded)return;let text:string;try{text=JSON.stringify(v,(_key,value:unknown)=&gt;{if(&#91;'undefined','func…</code> |
| `startHttpTransport` | function | 13 | <code>export async function startHttpTransport(o:HttpTransportOptions):Promise&lt;HttpTransport&gt;{</code> |
| `abort` | function | 22 | <code>active++;const controller=new AbortController();controllers.add(controller);const abort=():void=&gt;controller.abort(),disconnected=():void=&gt;{if(!res.writableEnded)abort();};o.signal.addEventListener('ab…</code> |
| `disconnected` | function | 22 | <code>active++;const controller=new AbortController();controllers.add(controller);const abort=():void=&gt;controller.abort(),disconnected=():void=&gt;{if(!res.writableEnded)abort();};o.signal.addEventListener('ab…</code> |
| `error` | function | 33 | <code>await new Promise&lt;void&gt;((resolve,reject)=&gt;{const error=(e:Error):void=&gt;{server.removeListener('listening',ready);reject(e);},ready=():void=&gt;{server.removeListener('error',error);resolve();};server.onc…</code> |
| `ready` | function | 33 | <code>await new Promise&lt;void&gt;((resolve,reject)=&gt;{const error=(e:Error):void=&gt;{server.removeListener('listening',ready);reject(e);},ready=():void=&gt;{server.removeListener('error',error);resolve();};server.onc…</code> |
| `ServiceClientConfiguration` | interface | 40 | <code>export interface ServiceClientConfiguration {</code> |
| `ServiceCommand` | interface | 45 | <code>export interface ServiceCommand {readonly operation:import('./protocol.js').Operation;readonly payloadBytes:Buffer}</code> |
| `ServiceResponse` | type | 46 | <code>export type ServiceResponse={transport:'RESPONSE';status:number;body:unknown;operation_id:string}&#124;{transport:'UNKNOWN';operation_id:string;reason:string};</code> |
| `ServiceClient` | interface | 47 | <code>export interface ServiceClient {invoke(invocation:InvocationContext,command:ServiceCommand):Promise&lt;ServiceResponse&gt;}</code> |
| `invoke` | method | 47 | <code>export interface ServiceClient {invoke(invocation:InvocationContext,command:ServiceCommand):Promise&lt;ServiceResponse&gt;}</code> |
| `createServiceClient` | function | 48 | <code>export async function createServiceClient(config:ServiceClientConfiguration,gateway:import('../identity/enrollment.js').IdentityGateway):Promise&lt;ServiceClient&gt;{</code> |

## services/hyperfide/src/transport/isolation.ts

[Open source](../../services/hyperfide/src/transport/isolation.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `IsolationFenceReceipt` | interface | 12 | <code>export interface IsolationFenceReceipt {</code> |
| `IsolationPermitVerifier` | interface | 17 | <code>export interface IsolationPermitVerifier {verifySigned(serialized:Buffer&#124;string):VerifiedIsolationPermit}</code> |
| `verifySigned` | method | 17 | <code>export interface IsolationPermitVerifier {verifySigned(serialized:Buffer&#124;string):VerifiedIsolationPermit}</code> |
| `IsolationHttpTransportOptions` | interface | 18 | <code>export interface IsolationHttpTransportOptions {</code> |
| `IsolationHttpTransport` | interface | 25 | <code>export interface IsolationHttpTransport {readonly address:string;close():Promise&lt;void&gt;}</code> |
| `close` | method | 25 | <code>export interface IsolationHttpTransport {readonly address:string;close():Promise&lt;void&gt;}</code> |
| `IsolationHttpResult` | type | 26 | <code>export type IsolationHttpResult=</code> |
| `IsolationHttpClientOptions` | interface | 30 | <code>export interface IsolationHttpClientOptions {</code> |
| `IsolationHttpClient` | interface | 33 | <code>export interface IsolationHttpClient {isolate(permitEnvelope:string,signal:AbortSignal):Promise&lt;IsolationHttpResult&gt;}</code> |
| `isolate` | method | 33 | <code>export interface IsolationHttpClient {isolate(permitEnvelope:string,signal:AbortSignal):Promise&lt;IsolationHttpResult&gt;}</code> |
| `fail` | function | 35 | <code>function fail(code:string):never{throw new FoundationError(code,'Isolation transport refused the operation');}</code> |
| `exact` | function | 36 | <code>function exact(value:unknown,keys:readonly string&#91;&#93;):asserts value is Record&lt;string,unknown&gt;{</code> |
| `bounded` | function | 39 | <code>function bounded(value:number&#124;undefined,fallback:number,min:number,max:number):number{</code> |
| `utc` | function | 42 | <code>function utc(value:unknown):value is string{</code> |
| `plain` | function | 46 | <code>function plain(value:unknown):value is string{return typeof value==='string'&amp;&amp;value.length&gt;0&amp;&amp;value.length&lt;=2048&amp;&amp;!/&#91;&#92;x00-&#92;x1f&#92;x7f&#93;/.test(value);}</code> |
| `parseIsolationFenceReceipt` | function | 47 | <code>export function parseIsolationFenceReceipt(value:unknown):IsolationFenceReceipt{</code> |
| `tlsFile` | function | 58 | <code>async function tlsFile(filename:string,secret:boolean):Promise&lt;Buffer&gt;{</code> |
| `abortable` | function | 70 | <code>function abortable&lt;T&gt;(operation:Promise&lt;T&gt;,signal:AbortSignal):Promise&lt;T&gt;{</code> |
| `errorCode` | function | 78 | <code>function errorCode(error:unknown):string{</code> |
| `respond` | function | 81 | <code>function respond(res:ServerResponse,status:number,outcome:'SUCCEEDED'&#124;'REJECTED'&#124;'UNKNOWN',permitDigest:string&#124;null,detail:unknown):void{</code> |
| `headers` | function | 88 | <code>function headers(req:IncomingMessage,origin:string):void{</code> |
| `startIsolationHttpTransport` | function | 97 | <code>export async function startIsolationHttpTransport(options:IsolationHttpTransportOptions):Promise&lt;IsolationHttpTransport&gt;{</code> |
| `requestedBindings` | function | 184 | <code>function requestedBindings(serialized:string):{deployment_id:string;operation_id:string;source_epoch:string&#124;null}{</code> |
| `createIsolationHttpClient` | function | 193 | <code>export async function createIsolationHttpClient(options:IsolationHttpClientOptions):Promise&lt;IsolationHttpClient&gt;{</code> |

## services/hyperfide/src/transport/protocol.ts

[Open source](../../services/hyperfide/src/transport/protocol.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Principal` | interface | 10 | <code>export interface Principal {</code> |
| `Operation` | interface | 18 | <code>export interface Operation {</code> |
| `InvokePayload` | interface | 22 | <code>export interface InvokePayload {</code> |
| `AuthorityTransaction` | interface | 26 | <code>export interface AuthorityTransaction { query(sql: string, values?: unknown&#91;&#93;): Promise&lt;{rows: Record&lt;string, any&gt;&#91;&#93;; rowCount: number &#124; null}&gt; }</code> |
| `query` | method | 26 | <code>export interface AuthorityTransaction { query(sql: string, values?: unknown&#91;&#93;): Promise&lt;{rows: Record&lt;string, any&gt;&#91;&#93;; rowCount: number &#124; null}&gt; }</code> |
| `InvocationContext` | interface | 27 | <code>export interface InvocationContext {</code> |
| `EnrollmentPayload` | interface | 34 | <code>export interface EnrollmentPayload {</code> |
| `DecodedRequest` | interface | 38 | <code>export interface DecodedRequest&lt;T&gt; { operation: Operation; payload: T; raw: Buffer }</code> |
| `Proof` | interface | 39 | <code>export interface Proof { id: string; time: string; nonce: string; signature: Buffer }</code> |
| `fail` | function | 40 | <code>export function fail(code: string, message: string): never { throw new FoundationError(code, message); }</code> |
| `exact` | function | 41 | <code>export function exact(value: unknown, names: readonly string&#91;&#93;): asserts value is Record&lt;string, unknown&gt; {</code> |
| `uuid` | function | 45 | <code>export function uuid(value: unknown): value is string { return typeof value === 'string' &amp;&amp; UUID.test(value); }</code> |
| `decimal` | function | 46 | <code>export function decimal(value: unknown, positive = false): value is string {</code> |
| `hash` | function | 50 | <code>export function hash(bytes: Buffer &#124; string): string { return 'sha256:' + createHash('sha256').update(bytes).digest('hex'); }</code> |
| `base64` | function | 51 | <code>export function base64(value: unknown, size?: number): Buffer {</code> |
| `frozen` | function | 59 | <code>export function frozen&lt;T&gt;(value: T, depth = 0): T {</code> |
| `strictJSON` | function | 68 | <code>export function strictJSON(bytes: Buffer, limit = MAX_BODY_BYTES): unknown {</code> |
| `canonicalOrigin` | function | 126 | <code>export function canonicalOrigin(value: unknown): string {</code> |
| `envelope` | function | 135 | <code>function envelope(raw: Buffer): DecodedRequest&lt;unknown&gt; {</code> |
| `decodeInvoke` | function | 151 | <code>export function decodeInvoke(raw: Buffer): DecodedRequest&lt;InvokePayload&gt; {</code> |
| `decodeEnrollment` | function | 167 | <code>export function decodeEnrollment(raw: Buffer): DecodedRequest&lt;EnrollmentPayload&gt; {</code> |
| `proof` | function | 175 | <code>export function proof(headers: readonly string&#91;&#93;, enrollment = false): Proof {</code> |
| `enrollmentSecret` | function | 197 | <code>export function enrollmentSecret(headers: readonly string&#91;&#93;): Buffer {</code> |
| `signingBytes` | function | 202 | <code>export function signingBytes(origin: string, endpoint: '/v1/invoke' &#124; '/v1/enroll', item: Omit&lt;Proof,'signature'&gt;, body: Buffer): Buffer {</code> |
| `verifyProof` | function | 206 | <code>export function verifyProof(publicKey: string, item: Proof, origin: string, endpoint: '/v1/invoke' &#124; '/v1/enroll', body: Buffer): void {</code> |
| `authenticatedInvocations` | variable | 214 | <code>const authenticatedInvocations=new WeakSet&lt;object&gt;();</code> |
| `authenticatedInvocation` | function | 215 | <code>export function authenticatedInvocation(value:InvocationContext):InvocationContext {</code> |
| `assertInvocation` | function | 218 | <code>export function assertInvocation(value:unknown):asserts value is InvocationContext {</code> |

## services/hyperfide/src/transport/writer_observation.ts

[Open source](../../services/hyperfide/src/transport/writer_observation.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `WriterObservation` | interface | 12 | <code>export interface WriterObservation {</code> |
| `WriterObservationPermitVerifier` | interface | 19 | <code>export interface WriterObservationPermitVerifier {verifySigned(serialized:Buffer&#124;string):VerifiedWriterObservationPermit}</code> |
| `verifySigned` | method | 19 | <code>export interface WriterObservationPermitVerifier {verifySigned(serialized:Buffer&#124;string):VerifiedWriterObservationPermit}</code> |
| `WriterObservationHttpTransportOptions` | interface | 20 | <code>export interface WriterObservationHttpTransportOptions {</code> |
| `WriterObservationHttpTransport` | interface | 27 | <code>export interface WriterObservationHttpTransport {readonly address:string;close():Promise&lt;void&gt;}</code> |
| `close` | method | 27 | <code>export interface WriterObservationHttpTransport {readonly address:string;close():Promise&lt;void&gt;}</code> |
| `WriterObservationHttpResult` | type | 28 | <code>export type WriterObservationHttpResult=</code> |
| `WriterObservationHttpClientOptions` | interface | 32 | <code>export interface WriterObservationHttpClientOptions {</code> |
| `WriterObservationHttpClient` | interface | 35 | <code>export interface WriterObservationHttpClient {observe(permitEnvelope:string,signal:AbortSignal):Promise&lt;WriterObservationHttpResult&gt;}</code> |
| `observe` | method | 35 | <code>export interface WriterObservationHttpClient {observe(permitEnvelope:string,signal:AbortSignal):Promise&lt;WriterObservationHttpResult&gt;}</code> |
| `fail` | function | 37 | <code>function fail(code:string):never{throw new FoundationError(code,'WriterObservation transport refused the operation');}</code> |
| `exact` | function | 38 | <code>function exact(value:unknown,keys:readonly string&#91;&#93;):asserts value is Record&lt;string,unknown&gt;{</code> |
| `bounded` | function | 41 | <code>function bounded(value:number&#124;undefined,fallback:number,min:number,max:number):number{</code> |
| `utc` | function | 44 | <code>function utc(value:unknown):value is string{</code> |
| `parseWriterObservation` | function | 48 | <code>export function parseWriterObservation(value:unknown):WriterObservation{</code> |
| `tlsFile` | function | 64 | <code>async function tlsFile(filename:string,secret:boolean):Promise&lt;Buffer&gt;{</code> |
| `abortable` | function | 76 | <code>function abortable&lt;T&gt;(operation:Promise&lt;T&gt;,signal:AbortSignal):Promise&lt;T&gt;{</code> |
| `errorCode` | function | 84 | <code>function errorCode(error:unknown):string{</code> |
| `respond` | function | 87 | <code>function respond(res:ServerResponse,status:number,outcome:'OBSERVED'&#124;'REJECTED'&#124;'UNKNOWN',permitDigest:string&#124;null,detail:unknown):void{</code> |
| `headers` | function | 94 | <code>function headers(req:IncomingMessage,origin:string):void{</code> |
| `startWriterObservationHttpTransport` | function | 103 | <code>export async function startWriterObservationHttpTransport(options:WriterObservationHttpTransportOptions):Promise&lt;WriterObservationHttpTransport&gt;{</code> |
| `requestedBindings` | function | 190 | <code>function requestedBindings(serialized:string):{deployment_id:string;operation_id:string;source_epoch:string&#124;null;topology_digest:string;resource_count:number}{</code> |
| `createWriterObservationHttpClient` | function | 199 | <code>export async function createWriterObservationHttpClient(options:WriterObservationHttpClientOptions):Promise&lt;WriterObservationHttpClient&gt;{</code> |
