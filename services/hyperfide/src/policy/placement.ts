import {assertPrimaryTransaction} from '../storage/transactions.js';
import {assertInvocation} from '../transport/protocol.js';
import type {Operation} from '../transport/protocol.js';
import {recorded} from '../identity/enrollment.js';
// 3.1 is a control-only fragment while 1.1 also serves provisioner/dispatch, so the registry cannot accept it in
// "requires" (Dependency lacks required service role). These are stateless helpers over 3.1's committed tables;
// authorizeSupervisor refuses every role except control before calling them. Likewise 8.1 is provisioner-only, so
// remote destinations are verified by the direct current sandbox/boot/pool lookup in remoteHost below.
import {leadership,requireAuthority} from '../hierarchy/packages.js';
import {event as outboxEvent,eventDigest} from '../events/outbox.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { Component, ComponentContext } from '../components/registry.js';
import { FoundationError, object } from './programme.js';

export const REMOTE_JOB_CLASSES = [
  'implementation','dependency_preparation','indexing','build','test','reproduction','review_execution',
  'integration','installation','upgrade','self_development'
] as const;
export const SUPERVISORY_JOB_CLASSES = ['supervision','control','source_inspection','graph_query','context_composition'] as const;
export type RemoteJobClass = typeof REMOTE_JOB_CLASSES[number];
export type JobClass = RemoteJobClass | typeof SUPERVISORY_JOB_CLASSES[number];
export type MainTool = 'source.read'|'graph.query'|'state.query'|'supervise'|'delegate'|'native.shell'|'native.file.write'|'native.spawn'|'native.process.stop'|'supervisor.session.launch';
export const REGISTERED_RUNNER_TOOLS = Object.freeze({
  'runner.test.execute': Object.freeze({job_class:'test' as const,tool:'native.spawn' as const}),
  'runner.review.execute': Object.freeze({job_class:'review_execution' as const,tool:'native.spawn' as const}),
  'runner.integration.execute': Object.freeze({job_class:'integration' as const,tool:'native.spawn' as const}),
  'runner.index.execute': Object.freeze({job_class:'indexing' as const,tool:'native.spawn' as const}),
  'runner.build.execute': Object.freeze({job_class:'build' as const,tool:'native.spawn' as const}),
  'runner.preparation.execute': Object.freeze({job_class:'dependency_preparation' as const,tool:'native.spawn' as const}),
  'runner.slot.prepare': Object.freeze({job_class:'dependency_preparation' as const,tool:'native.file.write' as const}),
  'runner.agent.launch': Object.freeze({job_class:'implementation' as const,tool:'native.spawn' as const}),
  'runner.inspect': Object.freeze({job_class:'supervision' as const,tool:'state.query' as const}),
  'runner.stop': Object.freeze({job_class:'control' as const,tool:'native.process.stop' as const})
});
export type RunnerAction = keyof typeof REGISTERED_RUNNER_TOOLS;
export function registeredRunnerTool(action:unknown):{job_class:JobClass;tool:MainTool} {
  if(typeof action!=='string'||!Object.hasOwn(REGISTERED_RUNNER_TOOLS,action))invalid('Unknown registered runner action');
  return REGISTERED_RUNNER_TOOLS[action as RunnerAction];
}
export interface PlacementProfile {
  schema_version: 1; programme_id: string; repository: string; spec_revision: string; policy_revision: number;
  supervisory_host_id: string;
  restrictions: { profile_digest: string; evidence_digest: string; qualification: 'QUALIFIED'; expires_at: string };
}
export interface HostBinding { host_id: string; kind: 'SUPERVISORY'|'REMOTE'; boot_generation: string }
export interface PlacementDecision {
  job_class: JobClass; host_id: string; location: 'LOCAL_SUPERVISION'|'REMOTE_EXECUTION';
  spec_revision: string; policy_revision: number; policy_digest: string;
}
function invalid(message: string): never { throw new FoundationError('PLACEMENT_DENIED', message); }
function exact(input: unknown, keys: string[]): Record<string,unknown> {
  if (!object(input) || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input,key)))
    invalid('Placement fields do not match the approved contract');
  return input;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value))
    invalid('Placement identity is invalid');
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) invalid('Placement digest is invalid');
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (object(value)) return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  if (value === null || ['string','number','boolean'].includes(typeof value)) return JSON.stringify(value);
  return invalid('Placement payload is not canonical JSON');
}
export function validatePlacementProfile(input: unknown, context: ComponentContext): PlacementProfile {
  const value = exact(input,['schema_version','programme_id','repository','spec_revision','policy_revision','supervisory_host_id','restrictions']);
  const restrictions = exact(value.restrictions,['profile_digest','evidence_digest','qualification','expires_at']);
  if (value.schema_version !== 1 || value.programme_id !== context.policy.programme_id ||
      value.repository !== context.policy.repository || value.spec_revision !== context.policy.spec_revision ||
      value.policy_revision !== context.policy.policy_revision) invalid('Placement policy is not the approved programme revision');
  if (restrictions.qualification !== 'QUALIFIED' || typeof restrictions.expires_at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(restrictions.expires_at) ||
      !Number.isFinite(Date.parse(restrictions.expires_at)) || new Date(restrictions.expires_at).toISOString()!==restrictions.expires_at || Date.parse(restrictions.expires_at) <= Date.now())
    invalid('Main-host native restrictions are not currently qualified');
  return { schema_version:1, programme_id:context.policy.programme_id, repository:context.policy.repository,
    spec_revision:context.policy.spec_revision,policy_revision:context.policy.policy_revision,
    supervisory_host_id:text(value.supervisory_host_id),
    restrictions:{profile_digest:digest(restrictions.profile_digest),evidence_digest:digest(restrictions.evidence_digest),
      qualification:'QUALIFIED',expires_at:restrictions.expires_at} };
}
export function validateHostBinding(input: unknown): HostBinding {
  const value = exact(input,['host_id','kind','boot_generation']);
  if (!['SUPERVISORY','REMOTE'].includes(value.kind as string) || typeof value.boot_generation !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(value.boot_generation) || BigInt(value.boot_generation)>9223372036854775807n) invalid('Trusted execution host binding is invalid');
  return {host_id:text(value.host_id),kind:value.kind as HostBinding['kind'],boot_generation:value.boot_generation};
}
/**
 * Execution gateways must pass their authenticated host binding and actual registered tool class.
 * An agent's prompt, job label, environment labels, or requested target cannot replace that binding.
 * No local shell, write or native spawn is admitted on the supervisory host, including upgrades/self-work.
 */
export function enforcePlacement(profile: PlacementProfile, binding: HostBinding, job: unknown, tool: unknown): PlacementDecision {
  if (typeof job !== 'string' || ![...REMOTE_JOB_CLASSES,...SUPERVISORY_JOB_CLASSES].includes(job as JobClass))
    invalid('Unknown job class cannot receive placement');
  if (typeof tool !== 'string' || !['source.read','graph.query','state.query','supervise','delegate','native.shell','native.file.write','native.spawn','native.process.stop','supervisor.session.launch'].includes(tool))
    invalid('Unknown native tool cannot receive placement');
  if (Date.parse(profile.restrictions.expires_at) <= Date.now()) invalid('Execution restrictions expired');
  const main = binding.host_id === profile.supervisory_host_id;
  if (main !== (binding.kind === 'SUPERVISORY')) invalid('Host kind conflicts with its registered identity');
  if (main && (REMOTE_JOB_CLASSES.includes(job as RemoteJobClass) || ['native.shell','native.file.write','native.spawn','native.process.stop'].includes(tool)))
    invalid('This operation must execute remotely');
  if (main && job === 'source_inspection' && tool !== 'source.read' ||
      main && job === 'graph_query' && tool !== 'graph.query')
    invalid('Read access cannot disguise a generic native tool');
  if(tool==='supervisor.session.launch'&&(!main||job!=='supervision'))invalid('Supervisor sessions require the main supervision boundary');
  const policy_digest = 'sha256:'+createHash('sha256').update(canonical(profile)).digest('hex');
  return {job_class:job as JobClass,host_id:binding.host_id,location:main?'LOCAL_SUPERVISION':'REMOTE_EXECUTION',
    spec_revision:profile.spec_revision,policy_revision:profile.policy_revision,policy_digest};
}
async function trustedConfiguration(context: ComponentContext): Promise<{profile:PlacementProfile;host:HostBinding}> {
  const filename = context.env.HF_PLACEMENT_POLICY_FILE;
  const binding = context.env.HF_EXECUTION_HOST_BINDING;
  if (!filename || !binding) invalid('Trusted placement policy and host binding are required');
  let raw: unknown, host: unknown;
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) invalid('Trusted placement policy is not a bounded regular file');
    raw = JSON.parse(await fs.readFile(filename,'utf8')); host = JSON.parse(binding);
  } catch { invalid('Trusted placement configuration is unavailable'); }
  return {profile:validatePlacementProfile(raw,context),host:validateHostBinding(host)};
}

interface PlacementPrincipal {
  credential_id?:string;actor_id:string; organisation_id:string;run_id:string;role:string;deployment_epoch:string;
  sandbox_id:string|null;boot_id:string|null;boot_generation:string|null;allowed_actions:readonly string[];
}
export interface PlacementInvocation {operation:Operation;principal:PlacementPrincipal;guard(tx:PrimaryTransaction):Promise<void>}
export interface RemoteDestinationInput {job_class:RemoteJobClass;tool:MainTool;target_sandbox_id:string;boot_generation:string}
export interface PlacementAuthorization extends PlacementDecision {
  authorized:true;authority:'PLACEMENT_ONLY';tool:MainTool;boot_generation:string;
  execution_started:false;capacity_reserved:false;
}
export interface SupervisorSessionInput {session_id:string;leader_generation:string;package_id:string|null;package_generation:string|null}
export interface SupervisorAuthorization extends PlacementAuthorization {supervisor_session_id:string;supervisor_role:'LEADER'|'FEATURE_MANAGER';restriction_profile_digest:string;restriction_evidence_digest:string}
export interface PlacementAuthority {
  authorizeSupervisor(tx:PrimaryTransaction,invocation:PlacementInvocation,input:SupervisorSessionInput):Promise<SupervisorAuthorization>;
  authorize(tx:PrimaryTransaction,invocation:PlacementInvocation,input:{job_class:JobClass;tool:MainTool}):Promise<PlacementAuthorization>;
  admitRemote(tx:PrimaryTransaction,invocation:PlacementInvocation,input:RemoteDestinationInput):Promise<PlacementAuthorization>;
}
function scopedUUID(value:unknown):string {
  if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))invalid('Invalid fleet identity');
  return value;
}
function currentInvocation(context:ComponentContext):PlacementInvocation {
  const value=context.invocation;
  assertInvocation(value);
  if(!value||typeof value.guard!=='function'||!value.principal)invalid('An authenticated invocation is required');
  return value;
}
async function checkPrincipal(context:ComponentContext,tx:PrimaryTransaction,invocation:PlacementInvocation,action:string,execution=true):Promise<PlacementPrincipal> {
  assertPrimaryTransaction(tx);
  assertInvocation(invocation);
  if(!invocation||typeof invocation.guard!=='function'||!invocation.principal)invalid('An authenticated invocation is required');
  await invocation.guard(tx);
  const principal=invocation.principal;
  scopedUUID(principal.actor_id);scopedUUID(principal.organisation_id);scopedUUID(principal.run_id);scopedUUID(principal.deployment_epoch);
  if(principal.run_id!==context.policy.programme_id||(!principal.allowed_actions.includes(action)||!context.policy.allowed_actions.includes(action)))invalid('Placement caller is outside the approved scope');
  const run=await tx.query<{state:string;authority_epoch:string}>(
    'SELECT state,authority_epoch::text FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',
    [principal.organisation_id,principal.run_id]);
  if(run.rowCount!==1||execution&&!['READY','RUNNING'].includes(run.rows[0]!.state)||run.rows[0]!.authority_epoch!==principal.deployment_epoch)
    invalid('Run no longer admits execution placement');
  return principal;
}
async function remoteHost(tx:PrimaryTransaction,principal:PlacementPrincipal,sandboxId:string,bootGeneration:string):Promise<HostBinding> {
  scopedUUID(sandboxId);
  if(typeof bootGeneration!=='string'||!/^[1-9][0-9]{0,18}$/.test(bootGeneration)||BigInt(bootGeneration)>9223372036854775807n)invalid('Invalid sandbox boot generation');
  const found=await tx.query<{id:string;boot_generation:string;boot_id:string}>(
    "SELECT s.id::text,s.boot_generation::text,b.boot_id::text FROM hyperfide.sandboxes s JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id WHERE s.organisation_id=$1 AND s.id=$2 AND s.boot_generation=$3 AND s.desired_state='RUNNING' AND s.observed_state='RUNNING' AND p.state='ACTIVE' FOR SHARE OF s,p",
    [principal.organisation_id,sandboxId,bootGeneration]);
  if(found.rowCount!==1)invalid('Destination is not a current active remote sandbox');
  if(principal.sandbox_id===sandboxId&&principal.boot_id!==null&&principal.boot_id!==found.rows[0]!.boot_id)
    invalid('Authenticated boot identity is obsolete');
  return {host_id:found.rows[0]!.id,kind:'REMOTE',boot_generation:found.rows[0]!.boot_generation};
}
/**
 * Trusted-startup boundary: HF_EXECUTION_HOST_BINDING is written by the deployment unit that starts this service,
 * never by an agent, request or job label. It must name the profile's supervisory host. Each boot generation is
 * registered append-only in the run's command inbox (1.1 owns no migration), and a process still carrying an older
 * generation than the newest registered boot is fenced.
 */
async function supervisoryHost(context:ComponentContext,tx:PrimaryTransaction,principal:PlacementPrincipal,profile:PlacementProfile):Promise<HostBinding> {
  const raw=context.env.HF_EXECUTION_HOST_BINDING;
  if(!raw)invalid('Trusted supervisory host binding is required');
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{invalid('Trusted supervisory host binding is unavailable');}
  const host=validateHostBinding(parsed);
  if(host.kind!=='SUPERVISORY'||host.host_id!==profile.supervisory_host_id)invalid('This service is not bound to the configured supervisory host');
  const scope='host:'+host.host_id,record={schema_version:1,host_id:host.host_id,boot_generation:host.boot_generation};
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[principal.organisation_id+':'+principal.run_id+':'+scope+':boot']);
  await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,'placement.supervisory.boot',$4,$5,'COMPLETED',$6::jsonb) ON CONFLICT(organisation_id,run_id,principal_scope,operation,idempotency_key) DO NOTHING",
    [principal.organisation_id,principal.run_id,scope,'boot:'+host.boot_generation,'sha256:'+createHash('sha256').update(canonical(record)).digest('hex'),JSON.stringify(record)]);
  const newest=await tx.query<{generation:string}>("SELECT max((result->>'boot_generation')::numeric)::text AS generation FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='placement.supervisory.boot'",
    [principal.organisation_id,principal.run_id,scope]);
  if(BigInt(newest.rows[0]?.generation??'0')>BigInt(host.boot_generation))invalid('Supervisory host boot generation is stale');
  return host;
}
async function trustedProfile(context:ComponentContext):Promise<PlacementProfile> {
  const filename=context.env.HF_PLACEMENT_POLICY_FILE;
  if(!filename)invalid('Trusted placement policy is required');
  let value:unknown;
  try{
    const info=await fs.lstat(filename);
    if(!info.isFile()||info.isSymbolicLink()||info.size>1048576)invalid('Trusted placement policy is not a bounded regular file');
    value=JSON.parse(await fs.readFile(filename,'utf8'));
  }catch{invalid('Trusted placement policy is unavailable');}
  return validatePlacementProfile(value,context);
}
export function isPlacementAuthority(value:unknown):value is PlacementAuthority {
  return object(value)&&typeof value.authorize==='function'&&typeof value.admitRemote==='function'&&typeof value.authorizeSupervisor==='function';
}
function placementAuthority(context:ComponentContext):PlacementAuthority {
  const finish=(profile:PlacementProfile,host:HostBinding,input:{job_class:JobClass;tool:MainTool}):PlacementAuthorization=>({
    ...enforcePlacement(profile,host,input.job_class,input.tool),authorized:true,authority:'PLACEMENT_ONLY',tool:input.tool,
    boot_generation:host.boot_generation,execution_started:false,capacity_reserved:false
  });
  return Object.freeze({
    authorize:async(tx:PrimaryTransaction,invocation:PlacementInvocation,input:{job_class:JobClass;tool:MainTool})=>{
      exact(input,['job_class','tool']);
      if(input.tool==='supervisor.session.launch')invalid('Supervisor launch requires a bound registered session');
      const principal=await checkPrincipal(context,tx,invocation,'placement.authorize',REMOTE_JOB_CLASSES.includes(input.job_class as RemoteJobClass)||['native.shell','native.file.write','native.spawn'].includes(input.tool));
      const profile=await trustedProfile(context);
      let host:HostBinding;
      if(['LEADER','FEATURE_MANAGER'].includes(principal.role)&&principal.sandbox_id!==null)invalid('Supervisory agents must remain on the supervisory host');
      if(principal.sandbox_id!==null){
        if(principal.boot_generation===null)invalid('Authenticated remote host lacks its boot generation');
        host=await remoteHost(tx,principal,principal.sandbox_id,principal.boot_generation);
      }else{
        if(!['OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR','PROVISIONER','DISPATCH'].includes(principal.role))
          invalid('Execution role lacks a registered remote host');
        host=await supervisoryHost(context,tx,principal,profile);
      }
      return finish(profile,host,input);
    },
    authorizeSupervisor:async(tx:PrimaryTransaction,invocation:PlacementInvocation,input:SupervisorSessionInput)=>{
      exact(input,['session_id','leader_generation','package_id','package_generation']);
      if(context.role!=='control')invalid('Supervisor placement belongs to the main control service');
      const principal=await checkPrincipal(context,tx,invocation,'placement.supervisor.authorize');
      if(!['OPERATOR','COORDINATOR','LEADER'].includes(principal.role)||principal.sandbox_id!==null)
        invalid('Caller cannot place main supervisory sessions');
      const targetId=scopedUUID(input.session_id);
      if(typeof input.leader_generation!=='string'||!/^[1-9][0-9]{0,18}$/.test(input.leader_generation)||BigInt(input.leader_generation)>9223372036854775807n)
        invalid('Leader generation is invalid');
      const current=await leadership(tx,{organisation_id:principal.organisation_id,run_id:principal.run_id});
      if(current.authority_epoch!==principal.deployment_epoch||current.leader_generation!==input.leader_generation)
        invalid('Supervisory hierarchy changed');
      if(principal.role==='LEADER')await requireAuthority(tx,{organisation_id:principal.organisation_id,run_id:principal.run_id,
        authority_epoch:principal.deployment_epoch,session_id:principal.actor_id,leader_generation:input.leader_generation,roles:['LEADER']});
      const target=await tx.query<{role:string;state:string;sandbox_id:string|null;slot_id:string|null;attempt_id:string|null}>(
        'SELECT role,state,sandbox_id,slot_id,attempt_id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
        [principal.organisation_id,principal.run_id,targetId]);
      const session=target.rows[0];
      if(target.rowCount!==1||!session||!['LEADER','FEATURE_MANAGER'].includes(session.role)||session.state!=='REGISTERED'||
          session.sandbox_id!==null||session.slot_id!==null||session.attempt_id!==null)
        invalid('Target is not an unlaunched main supervisory session');
      if(session.role==='LEADER'){
        if(targetId!==current.leader_session_id||input.package_id!==null||input.package_generation!==null)
          invalid('Leader target must be the current primary session');
      }else{
        if(principal.role==='OPERATOR'||input.package_id===null||input.package_generation===null)
          invalid('Feature managers require leader-owned package delegation');
        await requireAuthority(tx,{organisation_id:principal.organisation_id,run_id:principal.run_id,authority_epoch:principal.deployment_epoch,
          session_id:targetId,leader_generation:input.leader_generation,package_id:scopedUUID(input.package_id),
          package_generation:input.package_generation,roles:['FEATURE_MANAGER']});
      }
      const profile=await trustedProfile(context),host=await supervisoryHost(context,tx,principal,profile);
      const placed=finish(profile,host,{job_class:'supervision',tool:'supervisor.session.launch'});
      return {...placed,supervisor_session_id:targetId,supervisor_role:session.role as 'LEADER'|'FEATURE_MANAGER',
        restriction_profile_digest:profile.restrictions.profile_digest,restriction_evidence_digest:profile.restrictions.evidence_digest};
    },
    admitRemote:async(tx:PrimaryTransaction,invocation:PlacementInvocation,input:RemoteDestinationInput)=>{
      exact(input,['job_class','tool','target_sandbox_id','boot_generation']);
      if(!REMOTE_JOB_CLASSES.includes(input.job_class)||!['native.shell','native.file.write','native.spawn'].includes(input.tool))
        invalid('Remote execution destination requires an explicit execution class');
      const principal=await checkPrincipal(context,tx,invocation,'placement.delegate');
      if(!['LEADER','FEATURE_MANAGER','COORDINATOR','PROVISIONER','DISPATCH'].includes(principal.role))
        invalid('Caller cannot select remote execution destinations');
      const profile=await trustedProfile(context);
      const host=await remoteHost(tx,principal,input.target_sandbox_id,input.boot_generation);
      return finish(profile,host,input);
    }
  });
}
type Outbox={enqueue(tx:PrimaryTransaction,event:Record<string,unknown>,options?:{consumer_ids:readonly string[]}):Promise<{obligations:number}>;
  claimPending(tx:PrimaryTransaction,input:unknown):Promise<Array<Record<string,unknown>&{id:string;payload:Record<string,unknown>;attempt_count:string;lease_expires_at:string}>>;
  acknowledge(tx:PrimaryTransaction,input:unknown):Promise<unknown>};
function outboxOf(current:ComponentContext):Outbox {
  return current.dependencies.require('6.1','events.outbox.v1',(candidate):candidate is Outbox=>
    object(candidate)&&['enqueue','claimPending','acknowledge'].every(key=>typeof candidate[key]==='function'));
}
const EXECUTION_TOOLS=['native.shell','native.file.write','native.spawn'];
function requestDigest(value:unknown):string {return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}
function idempotencyKey(value:unknown):string {
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))invalid('Placement idempotency key is invalid');
  return value;
}
function queueKey(sandboxId:string):string {return 'placement-remote:'+sandboxId;}
/** Every delegated job is addressed to exactly one per-sandbox queue; only that sandbox's current runner can claim it. */
async function remoteQueue(tx:PrimaryTransaction,principal:PlacementPrincipal,sandboxId:string,create:boolean):Promise<string|null> {
  if(create)await tx.query("INSERT INTO hyperfide.event_consumers(organisation_id,run_id,consumer_key,critical,state) VALUES($1,$2,$3,true,'ACTIVE') ON CONFLICT(organisation_id,run_id,consumer_key) DO NOTHING",
    [principal.organisation_id,principal.run_id,queueKey(sandboxId)]);
  const found=await tx.query<{id:string;state:string}>('SELECT id::text,state FROM hyperfide.event_consumers WHERE organisation_id=$1 AND run_id=$2 AND consumer_key=$3',
    [principal.organisation_id,principal.run_id,queueKey(sandboxId)]);
  if(!found.rowCount)return null;
  if(found.rows[0]!.state!=='ACTIVE')invalid('Remote job queue is not active');
  return found.rows[0]!.id;
}
interface DelegationInput {job_id:string;idempotency_key:string;job_class:unknown;tool:unknown;target_sandbox_id:unknown;boot_generation:unknown;packet_digest:string}
async function delegateRemote(current:ComponentContext,authority:PlacementAuthority,tx:PrimaryTransaction,invocation:PlacementInvocation,
    value:DelegationInput,origin:'DIRECT'|'REROUTED_FROM_SUPERVISORY'):Promise<Record<string,unknown>> {
  const admitted=await authority.admitRemote(tx,invocation,{job_class:value.job_class as RemoteJobClass,tool:value.tool as MainTool,
    target_sandbox_id:value.target_sandbox_id as string,boot_generation:value.boot_generation as string});
  const actor=invocation.principal,scope='actor:'+actor.actor_id,request=requestDigest({...value,origin});
  const prior=await tx.query<{request_digest:string;state:string;result:Record<string,unknown>|null}>(
    'SELECT request_digest,state,result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation=$4 AND idempotency_key=$5 FOR UPDATE',
    [actor.organisation_id,actor.run_id,scope,'placement.delegate',value.idempotency_key]);
  if(prior.rowCount){
    const row=prior.rows[0]!;
    if(row.request_digest!==request||row.state!=='COMPLETED'||!row.result)invalid('Delegation replay conflicts with persisted state');
    return {...row.result,replayed:true};
  }
  const outbox=outboxOf(current),queue=(await remoteQueue(tx,actor,admitted.host_id,true))!;
  const commandId=randomUUID(),eventId=randomUUID();
  await tx.query('INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [actor.organisation_id,actor.run_id,commandId,scope,'placement.delegate',value.idempotency_key,request]);
  const queued=await outbox.enqueue(tx,{organisation_id:actor.organisation_id,run_id:actor.run_id,id:eventId,
    aggregate_type:'placement_job',aggregate_id:value.job_id,aggregate_version:'1',event_type:'remote.job.requested',
    payload:{schema_version:1,job_id:value.job_id,job_class:value.job_class,tool:value.tool,packet_digest:value.packet_digest,
      target_sandbox_id:value.target_sandbox_id,boot_generation:value.boot_generation,authority_epoch:actor.deployment_epoch,
      source_actor_id:actor.actor_id,source_role:actor.role,origin,placement:admitted}},{consumer_ids:[queue]});
  const result={status:'ENQUEUED',command_id:commandId,event_id:eventId,job_id:value.job_id,placement:admitted,consumer_id:queue,
    origin,delivery_obligations:queued.obligations,execution_started:false,replayed:false};
  await tx.query("UPDATE hyperfide.command_inbox SET state='COMPLETED',result=$4::jsonb,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",
    [actor.organisation_id,actor.run_id,commandId,JSON.stringify(result)]);
  return result;
}
function delegationInput(value:Record<string,unknown>):DelegationInput {
  return {job_id:scopedUUID(value.job_id),idempotency_key:idempotencyKey(value.idempotency_key),job_class:value.job_class,tool:value.tool,
    target_sandbox_id:value.target_sandbox_id,boot_generation:value.boot_generation,packet_digest:digest(value.packet_digest)};
}
/** Only the claiming sandbox's current runner may execute; its boot binding is re-proved at claim and completion time. */
async function runnerHost(context:ComponentContext,tx:PrimaryTransaction,invocation:PlacementInvocation,action:string):Promise<{principal:PlacementPrincipal;host:HostBinding}> {
  const principal=await checkPrincipal(context,tx,invocation,action);
  if(principal.role!=='RUNNER'||principal.sandbox_id===null||principal.boot_generation===null)invalid('Only an enrolled remote runner consumes delegated jobs');
  return {principal,host:await remoteHost(tx,principal,principal.sandbox_id,principal.boot_generation)};
}
async function delegatedEvent(tx:PrimaryTransaction,principal:PlacementPrincipal,eventId:string){
  const found=await tx.query('SELECT * FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[principal.organisation_id,principal.run_id,eventId]);
  const row=found.rows[0] as Record<string,unknown>|undefined;
  if(!row||row.aggregate_type!=='placement_job'||row.event_type!=='remote.job.requested'||!object(row.payload))invalid('Delegated job event is unknown');
  return outboxEvent({organisation_id:row.organisation_id,run_id:row.run_id,id:row.id,aggregate_type:row.aggregate_type,
    aggregate_id:row.aggregate_id,aggregate_version:String(row.aggregate_version),event_type:row.event_type,payload:row.payload});
}
/** Records the consumer receipt (the attribution evidence) and acknowledges the exact delivery claim. */
async function settleDelivery(current:ComponentContext,tx:PrimaryTransaction,principal:PlacementPrincipal,consumer:string,
    claim:{event_id:string;attempt_count:string},attribution:Record<string,unknown>,job:ReturnType<typeof outboxEvent>):Promise<Record<string,unknown>> {
  const request=eventDigest(job);
  const prior=await tx.query<{id:string;request_digest:string;result:Record<string,unknown>}>(
    "SELECT id::text,request_digest,result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='event.receive' AND idempotency_key=$4 FOR UPDATE",
    [principal.organisation_id,principal.run_id,consumer,claim.event_id]);
  let receipt:string,stored=attribution;
  if(prior.rowCount){
    const row=prior.rows[0]!;
    if(row.request_digest!==request||canonical(row.result)!==canonical(attribution))invalid('Completion conflicts with recorded attribution');
    receipt=row.id;stored=row.result;
  }else{
    receipt=randomUUID();
    await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'event.receive',$5,$6,'COMPLETED',$7::jsonb)",
      [principal.organisation_id,principal.run_id,receipt,consumer,claim.event_id,request,JSON.stringify(attribution)]);
  }
  await outboxOf(current).acknowledge(tx,{organisation_id:principal.organisation_id,run_id:principal.run_id,event_id:claim.event_id,
    consumer_id:consumer,attempt_count:claim.attempt_count,inbox_id:receipt});
  return {...stored,receipt_id:receipt,acknowledged:true};
}
function bounded(value:unknown,min:number,max:number):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)invalid('Placement integer is outside its bound');
  return value;
}
const AUDIT_LIMIT=1000;
export function createComponent(context:ComponentContext):Component {
  const authority=placementAuthority(context);
  const transaction=<T>(current:ComponentContext,invocation:PlacementInvocation,work:(tx:PrimaryTransaction)=>Promise<T>):Promise<T>=>
    current.resources.gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:current.signal,guard:tx=>invocation.guard(tx)},work);
  return {apiVersion:1,capabilities:{'policy.placement.v1':authority},actions:{
    'placement.supervisor.authorize':async(input,current)=>{
      const value=exact(input,['session_id','leader_generation','package_id','package_generation']);
      const invocation=currentInvocation(current);
      return transaction(current,invocation,tx=>authority.authorizeSupervisor(tx,invocation,value as unknown as SupervisorSessionInput));
    },
    'placement.check':async(input,current)=>{
      const value=exact(input,['job_class','tool']);
      const {profile,host}=await trustedConfiguration(current);
      return {...enforcePlacement(profile,host,value.job_class,value.tool),authority:'NONE',execution:'NOT_STARTED'};
    },
    'placement.runner.authorize':async(input,current)=>{
      const value=exact(input,['runner_action']);
      const registration=registeredRunnerTool(value.runner_action);
      const invocation=currentInvocation(current);
      const decision=await transaction(current,invocation,tx=>authority.authorize(tx,invocation,registration));
      return {...decision,runner_action:value.runner_action};
    },
    'placement.authorize':async(input,current)=>{
      const value=exact(input,['job_class','tool']);
      const invocation=currentInvocation(current);
      return transaction(current,invocation,tx=>authority.authorize(tx,invocation,value as unknown as {job_class:JobClass;tool:MainTool}));
    },
    'placement.delegate':async(input,current)=>{
      const value=delegationInput(exact(input,['job_id','idempotency_key','job_class','tool','target_sandbox_id','boot_generation','packet_digest']));
      const invocation=currentInvocation(current);
      return transaction(current,invocation,tx=>recorded(tx,invocation.principal.actor_id,'envelope.placement.delegate',invocation.operation,
        ()=>delegateRemote(current,authority,tx,invocation,value,'DIRECT')));
    },
    /**
     * Main-host execution gateway. Every local shell/write/spawn a leader, feature manager or control service would run
     * on the supervisory host (including installation, upgrade and Hyperfide self-development) is submitted here. It is
     * durably recorded against the bound supervisory boot, never admitted locally, and re-routed to remote delegation
     * when a destination is supplied. Only supervision/control/inspection read tools receive LOCAL_SUPERVISION.
     */
    'placement.exec.request':async(input,current)=>{
      const value=exact(input,['job_id','idempotency_key','job_class','tool','packet_digest','target_sandbox_id','boot_generation']);
      const job=value.job_class,tool=value.tool,key=idempotencyKey(value.idempotency_key),packet=digest(value.packet_digest),jobId=scopedUUID(value.job_id);
      if(typeof job!=='string'||![...REMOTE_JOB_CLASSES,...SUPERVISORY_JOB_CLASSES].includes(job as JobClass))invalid('Unknown job class cannot receive placement');
      if(typeof tool!=='string'||!['source.read','graph.query','state.query','supervise','delegate',...EXECUTION_TOOLS,'native.process.stop'].includes(tool))
        invalid('Unknown native tool cannot receive placement');
      if((value.target_sandbox_id===null)!==(value.boot_generation===null))invalid('Remote destination must name both sandbox and boot generation');
      const invocation=currentInvocation(current);
      return transaction(current,invocation,tx=>recorded(tx,invocation.principal.actor_id,'envelope.placement.exec.request',invocation.operation,async()=>{
        const execution=REMOTE_JOB_CLASSES.includes(job as RemoteJobClass)||EXECUTION_TOOLS.includes(tool);
        const principal=await checkPrincipal(context,tx,invocation,'placement.exec.request',execution);
        if(principal.sandbox_id!==null)invalid('Remote hosts launch through the registered runner path');
        if(!['OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR','PROVISIONER','DISPATCH'].includes(principal.role))invalid('Caller has no supervisory-host role');
        const profile=await trustedProfile(context),host=await supervisoryHost(context,tx,principal,profile);
        const scope='host:'+host.host_id,auditKey=principal.actor_id+':'+key;
        const request=requestDigest({job_id:jobId,job_class:job,tool,packet_digest:packet,target_sandbox_id:value.target_sandbox_id,boot_generation:value.boot_generation});
        const prior=await tx.query<{request_digest:string;result:Record<string,unknown>}>(
          "SELECT request_digest,result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='placement.exec.request' AND idempotency_key=$4 FOR UPDATE",
          [principal.organisation_id,principal.run_id,scope,auditKey]);
        if(prior.rowCount){
          if(prior.rows[0]!.request_digest!==request)invalid('Execution request replay conflicts with recorded decision');
          return {...prior.rows[0]!.result,replayed:true};
        }
        let decision:'ADMITTED_LOCAL'|'DENIED_LOCAL',reason:string|null=null,local:PlacementDecision|null=null;
        try{local=enforcePlacement(profile,host,job,tool);decision='ADMITTED_LOCAL';}
        catch(error){
          if(!(error instanceof FoundationError)||error.code!=='PLACEMENT_DENIED')throw error;
          decision='DENIED_LOCAL';reason=error.message;
        }
        let delegated:Record<string,unknown>|null=null;
        if(decision==='DENIED_LOCAL'&&REMOTE_JOB_CLASSES.includes(job as RemoteJobClass)&&EXECUTION_TOOLS.includes(tool)&&value.target_sandbox_id!==null)
          delegated=await delegateRemote(current,authority,tx,invocation,{job_id:jobId,idempotency_key:'exec:'+key,job_class:job,tool,
            target_sandbox_id:value.target_sandbox_id,boot_generation:value.boot_generation,packet_digest:packet},'REROUTED_FROM_SUPERVISORY');
        const result={schema_version:1,host_id:host.host_id,host_kind:host.kind,boot_generation:host.boot_generation,actor_id:principal.actor_id,
          role:principal.role,job_id:jobId,job_class:job,tool,decision,reason,local_execution:decision==='ADMITTED_LOCAL'?'SUPERVISORY_READ_ONLY':'DENIED',
          location:local?.location??null,delegated_job_id:delegated?(delegated.job_id as string):null,delegated_event_id:delegated?(delegated.event_id as string):null,
          delegated_host_id:delegated?(delegated.placement as PlacementDecision).host_id:null,execution_started:false};
        await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,'placement.exec.request',$4,$5,'COMPLETED',$6::jsonb)",
          [principal.organisation_id,principal.run_id,scope,auditKey,request,JSON.stringify(result)]);
        return {...result,replayed:false};
      }));
    },
    'placement.remote.claim':async(input,current)=>{
      const value=exact(input,['lease_ms']),lease=bounded(value.lease_ms,1000,300000);
      const invocation=currentInvocation(current);
      return transaction(current,invocation,async tx=>{
        const {principal,host}=await runnerHost(context,tx,invocation,'placement.remote.claim');
        const consumer=await remoteQueue(tx,principal,host.host_id,false);
        if(consumer===null)return {status:'EMPTY'};
        const claimed=await outboxOf(current).claimPending(tx,{organisation_id:principal.organisation_id,run_id:principal.run_id,consumer_id:consumer,limit:1,lease_ms:lease});
        const delivery=claimed[0];
        if(!delivery)return {status:'EMPTY'};
        const job=await delegatedEvent(tx,principal,delivery.id),payload=job.payload;
        if(payload.target_sandbox_id!==host.host_id)invalid('Delegated job is addressed to another host');
        const claim={event_id:delivery.id,attempt_count:delivery.attempt_count};
        if(payload.boot_generation!==host.boot_generation||payload.authority_epoch!==principal.deployment_epoch){
          // A job admitted for an earlier boot or authority epoch is settled without execution.
          const fenced=await settleDelivery(current,tx,principal,consumer,claim,{schema_version:1,job_id:payload.job_id,job_class:payload.job_class,tool:payload.tool,
            packet_digest:payload.packet_digest,outcome:'FENCED',executed_host_id:null,boot_generation:host.boot_generation,executor_actor_id:principal.actor_id,
            executor_credential_id:principal.credential_id??null,requested_by:payload.source_actor_id,origin:payload.origin??'DIRECT',exit_code:null,output_digest:null},job);
          return {status:'FENCED',job_id:payload.job_id,event_id:delivery.id,receipt_id:fenced.receipt_id};
        }
        const placement=enforcePlacement(await trustedProfile(context),host,payload.job_class,payload.tool);
        return {status:'CLAIMED',job_id:payload.job_id,event_id:delivery.id,consumer_id:consumer,attempt_count:delivery.attempt_count,
          lease_expires_at:delivery.lease_expires_at,job_class:payload.job_class,tool:payload.tool,packet_digest:payload.packet_digest,placement};
      });
    },
    'placement.remote.complete':async(input,current)=>{
      const value=exact(input,['event_id','attempt_count','exit_code','output_digest']);
      const eventId=scopedUUID(value.event_id),exitCode=bounded(value.exit_code,0,255),output=digest(value.output_digest);
      if(typeof value.attempt_count!=='string'||!/^[1-9][0-9]{0,18}$/.test(value.attempt_count))invalid('Delivery attempt is invalid');
      const invocation=currentInvocation(current);
      return transaction(current,invocation,tx=>recorded(tx,invocation.principal.actor_id,'envelope.placement.remote.complete',invocation.operation,async()=>{
        const {principal,host}=await runnerHost(context,tx,invocation,'placement.remote.complete');
        const consumer=await remoteQueue(tx,principal,host.host_id,false);
        if(consumer===null)invalid('No delegated job queue exists for this host');
        const job=await delegatedEvent(tx,principal,eventId),payload=job.payload;
        if(payload.target_sandbox_id!==host.host_id||payload.boot_generation!==host.boot_generation)invalid('Completion host differs from the admitted destination');
        enforcePlacement(await trustedProfile(context),host,payload.job_class,payload.tool);
        return settleDelivery(current,tx,principal,consumer,{event_id:eventId,attempt_count:value.attempt_count as string},{schema_version:1,
          job_id:payload.job_id,job_class:payload.job_class,tool:payload.tool,packet_digest:payload.packet_digest,outcome:exitCode===0?'SUCCEEDED':'FAILED',
          executed_host_id:host.host_id,host_kind:host.kind,boot_generation:host.boot_generation,executor_actor_id:principal.actor_id,
          executor_credential_id:principal.credential_id??null,requested_by:payload.source_actor_id,origin:payload.origin??'DIRECT',exit_code:exitCode,output_digest:output},job);
      }));
    },
    /** V-052 read model: what the supervisory host admitted, what it refused, and where every delegated job executed. */
    'placement.audit':async(input,current)=>{
      exact(input,[]);
      const invocation=currentInvocation(current);
      return transaction(current,invocation,async tx=>{
        const principal=await checkPrincipal(context,tx,invocation,'placement.audit',false);
        if(!['OPERATOR','COORDINATOR','LEADER'].includes(principal.role)||principal.sandbox_id!==null)invalid('Caller cannot audit host placement');
        const profile=await trustedProfile(context),scope='host:'+profile.supervisory_host_id;
        const main=await tx.query<{result:Record<string,unknown>}>(
          "SELECT result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='placement.exec.request' AND state='COMPLETED' ORDER BY created_at,id LIMIT $4",
          [principal.organisation_id,principal.run_id,scope,AUDIT_LIMIT]);
        const boots=await tx.query<{generation:string}>(
          "SELECT result->>'boot_generation' AS generation FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='placement.supervisory.boot' ORDER BY (result->>'boot_generation')::numeric",
          [principal.organisation_id,principal.run_id,scope]);
        const launches=await tx.query<{host_id:string;job_class:string|null;tool:string|null;state:string}>(
          "SELECT host_id,placement->>'job_class' AS job_class,placement->>'tool' AS tool,state FROM hyperfide.supervisor_launches WHERE organisation_id=$1 AND run_id=$2 ORDER BY created_at,id LIMIT $3",
          [principal.organisation_id,principal.run_id,AUDIT_LIMIT]);
        const jobs=await tx.query<{event_id:string;payload:Record<string,unknown>;consumer_key:string|null;result:Record<string,unknown>|null}>(
          `SELECT e.id::text AS event_id,e.payload,c.consumer_key,i.result FROM hyperfide.outbox_events e
           LEFT JOIN hyperfide.event_deliveries d ON d.organisation_id=e.organisation_id AND d.run_id=e.run_id AND d.event_id=e.id
           LEFT JOIN hyperfide.event_consumers c ON c.organisation_id=d.organisation_id AND c.run_id=d.run_id AND c.id=d.consumer_id
           LEFT JOIN hyperfide.command_inbox i ON i.organisation_id=e.organisation_id AND i.run_id=e.run_id AND i.operation='event.receive'
             AND i.idempotency_key=e.id::text AND i.principal_scope=d.consumer_id::text AND i.state='COMPLETED'
           WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.aggregate_type='placement_job' AND e.event_type='remote.job.requested'
           ORDER BY e.created_at,e.id LIMIT $3`,[principal.organisation_id,principal.run_id,AUDIT_LIMIT]);
        const entries=[...main.rows.map(row=>({source:'exec.request',job_class:row.result.job_class as string,tool:row.result.tool as string,
            decision:row.result.decision as string,actor_id:row.result.actor_id,role:row.result.role,boot_generation:row.result.boot_generation})),
          ...launches.rows.filter(row=>row.host_id===profile.supervisory_host_id).map(row=>({source:'supervisor.launch',job_class:row.job_class,tool:row.tool,
            decision:'ADMITTED_LOCAL',actor_id:null,role:null,boot_generation:null}))];
        const admitted=entries.filter(entry=>entry.decision==='ADMITTED_LOCAL');
        const remote=jobs.rows.map(row=>({event_id:row.event_id,job_id:row.payload.job_id,job_class:row.payload.job_class,tool:row.payload.tool,
          target_host_id:row.payload.target_sandbox_id,requested_by:row.payload.source_actor_id,origin:row.payload.origin??'DIRECT',
          queue:row.consumer_key,state:row.result?row.result.outcome:'REQUESTED',executed_host_id:row.result?.executed_host_id??null,
          executor_actor_id:row.result?.executor_actor_id??null,exit_code:row.result?.exit_code??null,output_digest:row.result?.output_digest??null}));
        const violations=[
          ...admitted.filter(entry=>!SUPERVISORY_JOB_CLASSES.includes(entry.job_class as typeof SUPERVISORY_JOB_CLASSES[number])||EXECUTION_TOOLS.includes(entry.tool??''))
            .map(entry=>({kind:'MAIN_HOST_EXECUTION',job_class:entry.job_class,tool:entry.tool,source:entry.source})),
          ...remote.filter(job=>job.executed_host_id!==null&&(job.executed_host_id!==job.target_host_id||job.executed_host_id===profile.supervisory_host_id))
            .map(job=>({kind:'REMOTE_ATTRIBUTION_MISMATCH',job_id:job.job_id,executed_host_id:job.executed_host_id}))];
        return {schema_version:1,supervisory_host_id:profile.supervisory_host_id,boot_generations:boots.rows.map(row=>row.generation),
          main_host:{entries,admitted_job_classes:[...new Set(admitted.map(entry=>entry.job_class))].sort(),
            denied_job_classes:[...new Set(entries.filter(entry=>entry.decision==='DENIED_LOCAL').map(entry=>entry.job_class))].sort()},
          remote_jobs:remote,violations,truncated:[main,launches,jobs].some(result=>result.rowCount===AUDIT_LIMIT)};
      });
    }
  }};
}
