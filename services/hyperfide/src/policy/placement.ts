import {assertPrimaryTransaction} from '../storage/transactions.js';
import {assertInvocation} from '../transport/protocol.js';
import type {Operation} from '../transport/protocol.js';
import {recorded} from '../identity/enrollment.js';
import {leadership,requireAuthority} from '../hierarchy/packages.js';
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
  actor_id:string; organisation_id:string;run_id:string;role:string;deployment_epoch:string;
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
        host={host_id:profile.supervisory_host_id,kind:'SUPERVISORY',boot_generation:'1'};
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
      const {profile,host}=await trustedConfiguration(context);
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
export function createComponent(context:ComponentContext):Component {
  const authority=placementAuthority(context);
  return {apiVersion:1,capabilities:{'policy.placement.v1':authority},actions:{
    'placement.supervisor.authorize':async(input,current)=>{
      const value=exact(input,['session_id','leader_generation','package_id','package_generation']);
      const invocation=currentInvocation(current);
      return current.resources.gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:current.signal,
        guard:tx=>invocation.guard(tx)},tx=>authority.authorizeSupervisor(tx,invocation,value as unknown as SupervisorSessionInput));
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
      const decision=await current.resources.gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:current.signal,
        guard:tx=>invocation.guard(tx)},tx=>authority.authorize(tx,invocation,registration));
      return {...decision,runner_action:value.runner_action};
    },
    'placement.authorize':async(input,current)=>{
      const value=exact(input,['job_class','tool']);
      const invocation=currentInvocation(current);
      return current.resources.gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:current.signal,
        guard:tx=>invocation.guard(tx)},tx=>authority.authorize(tx,invocation,value as unknown as {job_class:JobClass;tool:MainTool}));
    },
    'placement.delegate':async(input,current)=>{
      const value=exact(input,['job_id','idempotency_key','job_class','tool','target_sandbox_id','boot_generation','packet_digest']);
      const invocation=currentInvocation(current),jobId=scopedUUID(value.job_id);
      if(typeof value.idempotency_key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.idempotency_key))
        invalid('Delegation idempotency key is invalid');
      const packetDigest=digest(value.packet_digest);
      return current.resources.gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:current.signal,
        guard:tx=>invocation.guard(tx)},async tx=>recorded(tx,invocation.principal.actor_id,'envelope.placement.delegate',invocation.operation,async()=>{
        const admitted=await authority.admitRemote(tx,invocation,{job_class:value.job_class as RemoteJobClass,tool:value.tool as MainTool,
          target_sandbox_id:value.target_sandbox_id as string,boot_generation:value.boot_generation as string});
        const actor=invocation.principal,scope='actor:'+actor.actor_id;
        const requestDigest='sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
        const prior=await tx.query<{request_digest:string;state:string;result:Record<string,unknown>|null}>(
          'SELECT request_digest,state,result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation=$4 AND idempotency_key=$5 FOR UPDATE',
          [actor.organisation_id,actor.run_id,scope,'placement.delegate',value.idempotency_key]);
        if(prior.rowCount){
          const row=prior.rows[0]!;
          if(row.request_digest!==requestDigest||row.state!=='COMPLETED'||!row.result)invalid('Delegation replay conflicts with persisted state');
          return {...row.result,replayed:true};
        }
        const outbox=current.dependencies.require('6.1','events.outbox.v1',(candidate):candidate is {
          enqueue(tx:PrimaryTransaction,event:Record<string,unknown>):Promise<{obligations:number}>}=>object(candidate)&&typeof candidate.enqueue==='function');
        const commandId=randomUUID(),eventId=randomUUID();
        await tx.query('INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [actor.organisation_id,actor.run_id,commandId,scope,'placement.delegate',value.idempotency_key,requestDigest]);
        const queued=await outbox.enqueue(tx,{organisation_id:actor.organisation_id,run_id:actor.run_id,id:eventId,
          aggregate_type:'placement_job',aggregate_id:jobId,aggregate_version:'1',event_type:'remote.job.requested',
          payload:{schema_version:1,job_id:jobId,job_class:value.job_class,tool:value.tool,packet_digest:packetDigest,
            target_sandbox_id:value.target_sandbox_id,boot_generation:value.boot_generation,authority_epoch:actor.deployment_epoch,
            source_actor_id:actor.actor_id,placement:admitted}});
        const result={status:'ENQUEUED',command_id:commandId,event_id:eventId,job_id:jobId,placement:admitted,
          delivery_obligations:queued.obligations,execution_started:false,replayed:false};
        await tx.query("UPDATE hyperfide.command_inbox SET state='COMPLETED',result=$4::jsonb,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",
          [actor.organisation_id,actor.run_id,commandId,JSON.stringify(result)]);
        return result;
      }));
    }
  }};
}
