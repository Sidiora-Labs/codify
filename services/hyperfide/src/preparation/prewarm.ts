import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {REMOTE_JOB_CLASSES} from '../policy/placement.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertInvocation} from '../transport/protocol.js';
import {gatewayFor,fields,uuid} from '../scheduler/claim.js';
import type {CapacityDimension} from '../scheduler/claim.js';
import type {eligibleDemand,reserveDynamic} from '../scheduler/resources.js';
import {readDeployment,currentPool} from '../providers/pools.js';
import {isProviderIntentCapability,isProviderExecutionCapability} from '../providers/reconcile.js';
import type {ProviderIntentCapability,ProviderExecutionCapability,Intent} from '../providers/reconcile.js';
import {readTrustedRecipe,resolvePreparationPlan} from './recipe.js';
import type {PreparationJobClass} from './recipe.js';
import {classifyRemoteReport,documentDigest,finishAttempt,markObsoleteBases,requireCompleteArtifacts,sealPreparedBase,isObsolete} from './seal.js';
import type {PreparationJobRow,PreparationTarget,RemoteReport,FailureClass} from './seal.js';

interface SchedulerCapability {eligibleDemand:typeof eligibleDemand;reserveCapacity:typeof reserveDynamic}
const ACTIVE=['QUEUED','RUNNING','AWAITING_REMOTE','RETRY_WAIT'];
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function invocationOf(context:ComponentContext):InvocationContext{const value=context.invocation;assertInvocation(value);return value;}
function requireRole(invocation:InvocationContext,roles:readonly string[]):void{
 if(!roles.includes(invocation.principal.role))fail('AUTH_SCOPE_DENIED','Preparation action requires '+roles.join(' or ')+' authority');
}
function boundedInteger(value:string|undefined,fallback:number,min:number,max:number):number{
 if(value===undefined)return fallback;
 if(!/^[1-9][0-9]{0,9}$/.test(value)||Number(value)<min||Number(value)>max)fail('PREPARATION_POLICY_INVALID','Retry policy must be bounded');
 return Number(value);
}
/** Operator retry policy; every attempt is bounded and spaced by exponential backoff. */
export function retryPolicy(env:Readonly<NodeJS.ProcessEnv>):{max_attempts:number;backoff_base_ms:number;backoff_max_ms:number}{
 const max_attempts=boundedInteger(env.HYPERFIDE_PREPARATION_MAX_ATTEMPTS,3,1,16);
 const backoff_base_ms=boundedInteger(env.HYPERFIDE_PREPARATION_BACKOFF_BASE_MS,30000,1,3600000);
 const backoff_max_ms=boundedInteger(env.HYPERFIDE_PREPARATION_BACKOFF_MAX_MS,900000,1,86400000);
 if(backoff_base_ms>backoff_max_ms)fail('PREPARATION_POLICY_INVALID','Backoff base exceeds its maximum');
 return {max_attempts,backoff_base_ms,backoff_max_ms};
}
function primary<T>(context:ComponentContext,invocation:InvocationContext,body:(tx:PrimaryTransaction)=>Promise<T>):Promise<T>{
 return context.resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal:context.signal,guard:tx=>invocation.guard(tx)},body);
}
async function target(context:ComponentContext,tx:PrimaryTransaction,pool_id:string):Promise<PreparationTarget>{
 const config=await readDeployment(context.env);
 const {pool,scope}=await currentPool(tx,config,pool_id);
 return {provider:scope.provider,configuration_digest:scope.configuration_digest,preparation_digest:pool.preparation_digest,profile_id:pool.profile_id};
}
async function acceptedManifest(tx:PrimaryTransaction,organisation:string,profile:string,preparation:string):Promise<unknown>{
 const rows=await tx.query<{manifest:unknown}>('SELECT manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2 AND content_digest=$3',[organisation,profile,preparation]);
 if(!rows.rows[0])fail('PREPARATION_MISMATCH','The pool does not pin this accepted profile manifest');
 return rows.rows[0].manifest;
}
async function resolveCurrent(context:ComponentContext,tx:PrimaryTransaction,organisation:string,pool_id:string,profile_id:string,job_class:PreparationJobClass){
 const current=await target(context,tx,pool_id);
 if(current.profile_id!==profile_id)fail('PROFILE_POOL_MISMATCH','Preparation profile must be the pool profile');
 const manifest=await acceptedManifest(tx,organisation,profile_id,current.preparation_digest);
 const pinned=(manifest as {profile?:{recipe?:{digest?:unknown}}}).profile?.recipe?.digest;
 const recipe=await readTrustedRecipe(context.env,typeof pinned==='string'?pinned:'');
 const resolved=resolvePreparationPlan({manifest,recipe,configuration_digest:current.configuration_digest,job_class});
 if(resolved.identity!==current.preparation_digest)fail('PREPARATION_MISMATCH','Resolved preparation identity differs from the pool pin');
 return {current,manifest,resolved};
}
async function cachedBase(tx:PrimaryTransaction,organisation:string,pool_id:string,profile_id:string,current:PreparationTarget):Promise<string|null>{
 const rows=await tx.query<{id:string}>("SELECT id FROM hyperfide.provider_prepared_bases WHERE organisation_id=$1 AND pool_id=$2 AND profile_id=$3 AND preparation_digest=$4 AND configuration_digest=$5 AND provider=$6 AND verification_scope='POOL' AND state='QUALIFIED' AND expires_at>clock_timestamp() ORDER BY created_at DESC,id LIMIT 1",
  [organisation,pool_id,profile_id,current.preparation_digest,current.configuration_digest,current.provider]);
 return rows.rows[0]?.id??null;
}
function jobClass(value:unknown):PreparationJobClass{
 if(value!=='PREPARATION'&&value!=='INDEX')fail('INVALID_REQUEST','Preparation demand requires an explicit job class');return value;
}
function placementClass(job:PreparationJobClass):'dependency_preparation'|'indexing'{
 const value=job==='INDEX'?'indexing':'dependency_preparation';
 // Both classes are remote-only under the 1.1 placement contract; the supervisory host never runs them.
 if(!(REMOTE_JOB_CLASSES as readonly string[]).includes(value))fail('PLACEMENT_DENIED','Preparation must be a remote job class');
 return value;
}
function utcAfter(ms:number):string{return new Date(Date.now()+ms).toISOString();}
function publicJob(row:PreparationJobRow&Record<string,unknown>):Record<string,unknown>{
 return {id:row.id,pool_id:row.pool_id,profile_id:row.profile_id,job_class:row.job_class,placement_class:row.placement_class,warm_spare:row.warm_spare,
  state:row.state,attempts:row.attempts,max_attempts:row.max_attempts,next_attempt_at:new Date(row.next_attempt_at).toISOString(),
  preparation_digest:row.preparation_digest,configuration_digest:row.configuration_digest,recipe_digest:row.recipe_digest,plan_digest:row.plan_digest,
  intent_id:row.intent_id,sandbox_id:row.sandbox_id,reservation_ids:row.reservation_ids,physical_reservation_ids:row.physical_reservation_ids,
  prepared_base_id:row.prepared_base_id,eligible_count:row.eligible_count};
}

/** Control role: eligible work becomes reserved, durable remote preparation jobs with 8.3 PREPARATION intents. */
export function createComponent(context:ComponentContext):Component{
 if(context.role!=='control')fail('ROLE_FORBIDDEN','Preparation scheduling belongs to the control service');
 const scheduler=context.dependencies.require('5.4','scheduler.resources.v1',(value):value is SchedulerCapability=>
  !!value&&typeof value==='object'&&typeof (value as SchedulerCapability).eligibleDemand==='function'&&typeof (value as SchedulerCapability).reserveCapacity==='function');
 const intents:ProviderIntentCapability=context.dependencies.require('8.3','provider.intents.v1',isProviderIntentCapability);
 return {apiVersion:1,actions:{
  'preparation.prewarm.schedule':async(value,request)=>{
   const input=fields(value,['organisation_id','run_id','pool_id','profile_id','job_class','warm_spare','request_key']);
   const invocation=invocationOf(request);requireRole(invocation,['LEADER','FEATURE_MANAGER']);
   const organisation=uuid(input.organisation_id,'organisation_id'),run=uuid(input.run_id,'run_id'),pool_id=uuid(input.pool_id,'pool_id'),profile_id=uuid(input.profile_id,'profile_id');
   const job_class=jobClass(input.job_class);
   if(typeof input.warm_spare!=='boolean')fail('INVALID_REQUEST','Explicit warm spare policy required');
   if(typeof input.request_key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.request_key))fail('INVALID_REQUEST','Bounded request key required');
   const warm=input.warm_spare,key=input.request_key,requestDigest=documentDigest({...input});
   const policy=retryPolicy(context.env);
   return gatewayFor(request).withPrimaryTransaction({timeoutMs:15000,maxRetries:2,signal:context.signal},async tx=>{
    const prior=await tx.query<PreparationJobRow&Record<string,unknown>>('SELECT * FROM hyperfide.preparation_jobs WHERE organisation_id=$1 AND run_id=$2 AND request_key=$3 FOR UPDATE',[organisation,run,key]);
    if(prior.rows[0]){
     if(prior.rows[0].request_digest!==requestDigest)fail('IDEMPOTENCY_CONFLICT','Preparation request key was reused with another payload');
     return {scheduled:false,replayed:true,job:publicJob(prior.rows[0])};
    }
    // Demand, authority and spare delegation are decided by the 5.4 scheduler under this transaction.
    const demand=await scheduler.eligibleDemand(tx,{organisation_id:organisation,run_id:run,pool_id,profile_id,job_class,warm_spare:warm},invocation);
    if(demand.eligible_count<1)return {scheduled:false,reason:'NO_ELIGIBLE_WORK',eligible_count:0,reserved:false};
    const {current,resolved}=await resolveCurrent(context,tx,organisation,pool_id,profile_id,job_class);
    const hit=await cachedBase(tx,organisation,pool_id,profile_id,current);
    if(hit&&!warm)return {scheduled:false,reason:'CACHE_HIT',cache:'HIT',prepared_base_id:hit,preparation_digest:resolved.identity,eligible_count:demand.eligible_count,reserved:false};
    if(!warm){
     const active=await tx.query<{n:number}>('SELECT count(*)::int AS n FROM hyperfide.preparation_jobs WHERE organisation_id=$1 AND run_id=$2 AND pool_id=$3 AND profile_id=$4 AND job_class=$5 AND NOT warm_spare AND state=ANY($6::text[])',
      [organisation,run,pool_id,profile_id,job_class,ACTIVE]);
     if(active.rows[0]!.n>=demand.eligible_count)return {scheduled:false,reason:'DEMAND_SATISFIED',eligible_count:demand.eligible_count,active_jobs:active.rows[0]!.n,reserved:false};
    }
    const id=randomUUID(),sandbox=randomUUID();
    const dimensions:CapacityDimension[]=[...demand.reservation_dimensions,...demand.execution_dimensions];
    if(!dimensions.length)fail('CAPACITY_POLICY_UNQUALIFIED','Eligible work produced no reservation vector');
    const reserved=await scheduler.reserveCapacity(tx,{organisation_id:organisation,run_id:run,pool_id,request_id:id,dimensions,expires_at:utcAfter(3600000)}) as {reservations:{id:string;capacity_account_id:string}[]};
    const ids=reserved.reservations.map(row=>row.id);
    const classes=await tx.query<{id:string}>("SELECT r.id FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.id=ANY($3::uuid[]) AND a.capacity_class='PHYSICAL' ORDER BY r.id",[organisation,run,ids]);
    const physical=classes.rows.map(row=>row.id);
    const config=await readDeployment(context.env);
    const created=await intents.prepareCreateTx(tx,{run_id:run,pool_id,sandbox_id:sandbox,request_key:'preparation:'+id,deadline_at:utcAfter(Math.max(1000,config.maximum_operation_ms-1000)),
     reservation_ids:physical,profile_id,preparation_digest:resolved.identity,purpose:'PREPARATION'},invocation) as {intent:Intent};
    await tx.query('INSERT INTO hyperfide.preparation_jobs(organisation_id,run_id,id,request_key,request_digest,pool_id,profile_id,job_class,placement_class,warm_spare,scheduled_by,scheduled_role,eligible_count,configuration_digest,preparation_digest,recipe_digest,plan_digest,plan,reservation_ids,physical_reservation_ids,intent_id,sandbox_id,max_attempts,backoff_base_ms,backoff_max_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)',
     [organisation,run,id,key,requestDigest,pool_id,profile_id,job_class,placementClass(job_class),warm,invocation.principal.actor_id,invocation.principal.role,demand.eligible_count,
      current.configuration_digest,resolved.identity,resolved.recipe_digest,resolved.plan_digest,resolved.plan,ids.sort(),physical,created.intent.id,sandbox,policy.max_attempts,policy.backoff_base_ms,policy.backoff_max_ms]);
    const row=(await tx.query<PreparationJobRow&Record<string,unknown>>('SELECT * FROM hyperfide.preparation_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[organisation,run,id])).rows[0]!;
    return {scheduled:true,cache:'MISS',eligible_count:demand.eligible_count,job:publicJob(row),intent_id:created.intent.id,intent_state:created.intent.state,
     reservations:reserved.reservations,external_call_performed:false,execution_location:'REMOTE_EXECUTION'};
   });
  },
  'preparation.recipe.resolve':async(value,request)=>{
   const input=fields(value,['organisation_id','run_id','pool_id','profile_id','job_class']);
   const invocation=invocationOf(request);requireRole(invocation,['OPERATOR','LEADER','FEATURE_MANAGER']);
   const organisation=uuid(input.organisation_id,'organisation_id'),pool_id=uuid(input.pool_id,'pool_id'),profile_id=uuid(input.profile_id,'profile_id');
   if(invocation.principal.organisation_id!==organisation||invocation.principal.run_id!==uuid(input.run_id,'run_id'))fail('RUN_SCOPE_DENIED','Resolution belongs to another run');
   const job_class=jobClass(input.job_class);
   return primary(request,invocation,async tx=>{
    const current=await target(context,tx,pool_id);
    // A profile other than the pool pin resolves as a candidate identity; it can never hit the pool cache.
    const rows=await tx.query<{manifest:unknown;content_digest:string}>('SELECT manifest,content_digest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2',[organisation,profile_id]);
    if(!rows.rows[0])fail('PREPARATION_MISMATCH','Unknown accepted profile');
    const manifest=rows.rows[0].manifest,pinned=(manifest as {profile?:{recipe?:{digest?:unknown}}}).profile?.recipe?.digest;
    const resolved=resolvePreparationPlan({manifest,recipe:await readTrustedRecipe(context.env,typeof pinned==='string'?pinned:''),configuration_digest:current.configuration_digest,job_class});
    if(resolved.identity!==rows.rows[0].content_digest)fail('PREPARATION_MISMATCH','Accepted profile digest differs from its manifest');
    const pinnedProfile=current.profile_id===profile_id&&current.preparation_digest===resolved.identity;
    const hit=pinnedProfile?await cachedBase(tx,organisation,pool_id,profile_id,current):null;
    return {preparation_digest:resolved.identity,plan_digest:resolved.plan_digest,recipe_digest:resolved.recipe_digest,
     toolchain_digest:resolved.plan.toolchain_digest,lock_digest:resolved.plan.lock_digest,configuration_digest:current.configuration_digest,
     pool_pinned:pinnedProfile,cache:hit?'HIT':'MISS',prepared_base_id:hit,authority:'NONE'};
   });
  },
  'preparation.prewarm.inspect':async(value,request)=>{
   const input=fields(value,['organisation_id','run_id','pool_id']);
   const invocation=invocationOf(request);requireRole(invocation,['OPERATOR','LEADER','FEATURE_MANAGER']);
   const organisation=uuid(input.organisation_id,'organisation_id'),run=uuid(input.run_id,'run_id'),pool_id=uuid(input.pool_id,'pool_id');
   if(invocation.principal.organisation_id!==organisation||invocation.principal.run_id!==run)fail('RUN_SCOPE_DENIED','Inspection belongs to another run');
   return primary(request,invocation,async tx=>{
    const jobs=await tx.query<PreparationJobRow&Record<string,unknown>>('SELECT * FROM hyperfide.preparation_jobs WHERE organisation_id=$1 AND run_id=$2 AND pool_id=$3 ORDER BY created_at,id',[organisation,run,pool_id]);
    const attempts=await tx.query('SELECT job_id,attempt,outcome,failure_class,diagnostics_artifact_digest FROM hyperfide.preparation_job_attempts WHERE organisation_id=$1 AND run_id=$2 AND job_id=ANY($3::uuid[]) ORDER BY job_id,attempt',[organisation,run,jobs.rows.map(row=>row.id)]);
    const accounts=await tx.query("SELECT a.dimension,a.capacity_class,a.configured_limit::text,a.reserved::text,a.allocated::text,COALESCE(sum(r.quantity) FILTER(WHERE j.id IS NOT NULL),0)::text AS preparation_reserved,COALESCE(sum(r.quantity) FILTER(WHERE j.warm_spare),0)::text AS warm_spare_reserved FROM hyperfide.capacity_accounts a LEFT JOIN hyperfide.reservations r ON r.organisation_id=a.organisation_id AND r.capacity_account_id=a.id AND r.run_id=$2 AND r.state<>'RELEASED' LEFT JOIN hyperfide.preparation_jobs j ON j.organisation_id=r.organisation_id AND j.run_id=r.run_id AND r.id=ANY(j.reservation_ids) WHERE a.organisation_id=$1 AND a.pool_id=$3 GROUP BY a.organisation_id,a.id ORDER BY a.capacity_class,a.dimension",[organisation,run,pool_id]);
    return {jobs:jobs.rows.map(publicJob),attempts:attempts.rows,accounts:accounts.rows,observation:'PRIMARY_SNAPSHOT'};
   });
  }
 }};
}

function remoteReport(value:unknown):RemoteReport{
 const input=fields(value,['job_id','attempt','execution','manifest_artifact_digest','provider_reference','execution_receipt','verification_receipt']);
 const execution=fields(input.execution,['host_class','sandbox_id','boot_generation','native_sandbox_id']);
 const reference=fields(input.provider_reference,['preparation_reference']);
 if(typeof input.attempt!=='number'||!Number.isSafeInteger(input.attempt)||input.attempt<1)fail('INVALID_REQUEST','Attempt number required');
 if(typeof execution.host_class!=='string'||typeof execution.boot_generation!=='string'||!/^[1-9][0-9]{0,18}$/.test(execution.boot_generation)||
    typeof execution.native_sandbox_id!=='string'||!execution.native_sandbox_id||execution.native_sandbox_id.length>255)fail('INVALID_REQUEST','Remote execution binding required');
 if(typeof reference.preparation_reference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}$/.test(reference.preparation_reference))fail('INVALID_REQUEST','Bounded provider reference required');
 if(typeof input.manifest_artifact_digest!=='string')fail('INVALID_REQUEST','Manifest artifact digest required');
 const receipt=(raw:unknown,kind:string)=>{const row=fields(raw,kind==='hyperfide.preparation-execution'?['schema_version','kind','job_id','attempt','plan_digest','preparation_digest','bootstrap','downloads']:['schema_version','kind','job_id','attempt','plan_digest','preparation_digest','readiness']);
  if(row.schema_version!==1||row.kind!==kind)fail('INVALID_REQUEST','Unsupported receipt');return row;};
 return {job_id:uuid(input.job_id,'job_id'),attempt:input.attempt,
  execution:{host_class:execution.host_class,sandbox_id:uuid(execution.sandbox_id,'sandbox_id'),boot_generation:execution.boot_generation,native_sandbox_id:execution.native_sandbox_id},
  manifest_artifact_digest:input.manifest_artifact_digest,provider_reference:{preparation_reference:reference.preparation_reference},
  execution_receipt:receipt(input.execution_receipt,'hyperfide.preparation-execution'),verification_receipt:receipt(input.verification_receipt,'hyperfide.preparation-verification')};
}
async function lockJob(tx:PrimaryTransaction,invocation:InvocationContext,id:string):Promise<PreparationJobRow&Record<string,unknown>>{
 const rows=await tx.query<PreparationJobRow&Record<string,unknown>>('SELECT * FROM hyperfide.preparation_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[invocation.principal.organisation_id,invocation.principal.run_id,id]);
 if(!rows.rows[0])fail('PREPARATION_JOB_UNKNOWN','Preparation job is not in the authenticated run');
 return rows.rows[0];
}
function providerFailure(error:unknown):{failure_class:FailureClass;code:string;message:string}{
 const code=error instanceof FoundationError?error.code:'PROVIDER_ERROR',message=error instanceof Error?error.message.slice(0,2048):'unknown provider failure';
 return {failure_class:code==='PROVIDER_UNAVAILABLE'?'PROVIDER_UNAVAILABLE':'PROVIDER_FAILED',code,message};
}

/** Provisioner role: drives the 8.3 PREPARATION intent and accepts only remote, boot-bound results. */
export function createProvisionerComponent(context:ComponentContext):Component{
 if(context.role!=='provisioner')fail('ROLE_FORBIDDEN','Preparation execution belongs to the provisioner service');
 const intents:ProviderIntentCapability=context.dependencies.require('8.3','provider.intents.v1',isProviderIntentCapability);
 const execution:ProviderExecutionCapability=context.dependencies.require('8.3','provider.execution.v1',isProviderExecutionCapability);
 return {apiVersion:1,actions:{
  'preparation.jobs.execute':async(value,request)=>{
   const input=fields(value,['job_id']),invocation=invocationOf(request);requireRole(invocation,['PROVISIONER']);
   const id=uuid(input.job_id,'job_id');
   const claimed=await primary(request,invocation,async tx=>{
    const job=await lockJob(tx,invocation,id);
    if(!['QUEUED','RETRY_WAIT'].includes(job.state))fail('PREPARATION_JOB_NOT_RUNNABLE','Job is '+job.state);
    const due=await tx.query<{due:boolean}>('SELECT $1::timestamptz<=clock_timestamp() AS due',[job.next_attempt_at]);
    if(!due.rows[0]!.due)fail('RETRY_NOT_DUE','Bounded retry backoff has not elapsed');
    if(job.attempts>=job.max_attempts)fail('RETRY_LIMIT_REACHED','Preparation retry limit reached');
    const attempt=job.attempts+1;
    await tx.query('INSERT INTO hyperfide.preparation_job_attempts(organisation_id,run_id,job_id,attempt) VALUES($1,$2,$3,$4)',[job.organisation_id,job.run_id,job.id,attempt]);
    await tx.query("UPDATE hyperfide.preparation_jobs SET state='RUNNING',attempts=$4,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[job.organisation_id,job.run_id,job.id,attempt]);
    return {job:{...job,attempts:attempt},attempt};
   });
   const {job,attempt}=claimed;
   let created:Intent|null=null,failure:{failure_class:FailureClass;code:string;message:string}|null=null,providerCalled=false;
   try{
    let intent=await intents.getIntent(job.intent_id,invocation);
    if(intent.kind!=='CREATE'||intent.preparation_purpose!=='PREPARATION'||intent.sandbox_id!==job.sandbox_id)fail('PREPARATION_MISMATCH','Job intent is not its remote PREPARATION create');
    if(!(intent.state==='TERMINAL'&&intent.native_sandbox_id)){
     providerCalled=true;await execution.executeIntent(job.intent_id,request.signal,invocation);
     intent=await intents.getIntent(job.intent_id,invocation);
    }
    if(intent.state==='TERMINAL'&&intent.native_sandbox_id)created=intent;
    else failure={failure_class:'PROVIDER_FAILED',code:'PROVIDER_PENDING',message:'Remote sandbox creation is not confirmed ('+intent.state+')'};
   }catch(error){failure=providerFailure(error);}
   return primary(request,invocation,async tx=>{
    const locked=await lockJob(tx,invocation,id);
    if(locked.state!=='RUNNING'||locked.attempts!==attempt)fail('PREPARATION_ATTEMPT_STALE','Attempt changed concurrently');
    if(created){
     await tx.query("UPDATE hyperfide.preparation_jobs SET state='AWAITING_REMOTE',updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[locked.organisation_id,locked.run_id,locked.id]);
     return {state:'AWAITING_REMOTE',attempt,provider_called:providerCalled,sandbox_id:created.sandbox_id,native_sandbox_id:created.native_sandbox_id,
      boot_generation:String(created.boot_generation),plan:locked.plan,plan_digest:locked.plan_digest,preparation_digest:locked.preparation_digest,
      execution_location:'REMOTE_EXECUTION',placement_class:locked.placement_class};
    }
    const result=await finishAttempt(tx,locked,attempt,{outcome:'FAILURE',failure_class:failure!.failure_class,retryable:true},
     {kind:'hyperfide.preparation-diagnostics',stage:'PROVIDER_CREATE',failure_class:failure!.failure_class,code:failure!.code,message:failure!.message,intent_id:locked.intent_id,provider_called:providerCalled});
    return {...result,attempt,failure_class:failure!.failure_class,provider_called:providerCalled,published:false};
   });
  },
  'preparation.jobs.report':async(value,request)=>{
   const invocation=invocationOf(request);requireRole(invocation,['PROVISIONER']);
   const report=remoteReport(value);
   const ttl=boundedInteger(context.env.HYPERFIDE_PREPARED_BASE_TTL_MS,604800000,60000,2592000000);
   return primary(request,invocation,async tx=>{
    const job=await lockJob(tx,invocation,report.job_id);
    if(job.state!=='AWAITING_REMOTE'||job.attempts!==report.attempt)fail('PREPARATION_ATTEMPT_STALE','Only the current remote attempt may report');
    // The 1.1 placement contract: preparation results are accepted only from the job's own remote boot.
    if(report.execution.host_class!=='remote')fail('PLACEMENT_DENIED','Preparation must execute remotely, never on the supervisory host');
    const sandbox=await tx.query<{native_sandbox_id:string|null;boot_generation:string;pool_id:string;desired_state:string}>("SELECT s.native_sandbox_id,s.boot_generation::text,s.pool_id,s.desired_state FROM hyperfide.sandboxes s JOIN hyperfide.provisioning_intents i ON i.organisation_id=s.organisation_id AND i.sandbox_id=s.id WHERE s.organisation_id=$1 AND s.id=$2 AND i.run_id=$3 AND i.id=$4 AND i.kind='CREATE' AND i.preparation_purpose='PREPARATION' AND i.state='TERMINAL' FOR SHARE OF s",
     [job.organisation_id,report.execution.sandbox_id,job.run_id,job.intent_id]);
    const bound=sandbox.rows[0];
    if(report.execution.sandbox_id!==job.sandbox_id||!bound||bound.pool_id!==job.pool_id||bound.desired_state!=='RUNNING'||bound.native_sandbox_id!==report.execution.native_sandbox_id||bound.boot_generation!==report.execution.boot_generation)
     fail('PLACEMENT_DENIED','Report is not bound to the job\'s provider-created remote sandbox boot');
    for(const receipt of [report.execution_receipt,report.verification_receipt])
     if(receipt.job_id!==job.id||receipt.attempt!==report.attempt||receipt.plan_digest!==job.plan_digest)fail('PREPARATION_RECEIPT_MISMATCH','Receipt belongs to another job, attempt or plan');
    const execution=documentDigest(report.execution_receipt),verification=documentDigest(report.verification_receipt);
    // Incomplete evidence is refused outright: nothing is classified, retried or published from it.
    await requireCompleteArtifacts(tx,job,[execution,verification]);
    const current=await target(context,tx,job.pool_id);
    const verdict=classifyRemoteReport(job,report,current);
    const evidence={execution_receipt_artifact_digest:execution,verification_receipt_artifact_digest:verification,sandbox_id:job.sandbox_id,boot_generation:report.execution.boot_generation};
    if(!verdict.ok){
     const stale=verdict.failure_class==='OBSOLETE_MANIFEST'?await markObsoleteBases(tx,job,current):[];
     const result=await finishAttempt(tx,job,report.attempt,{outcome:'FAILURE',failure_class:verdict.failure_class,retryable:verdict.retryable},
      {kind:'hyperfide.preparation-diagnostics',stage:'REMOTE_PREPARATION',failure_class:verdict.failure_class,detail:verdict.detail,...evidence,
       current_configuration_digest:current.configuration_digest,current_preparation_digest:current.preparation_digest});
     return {...result,attempt:report.attempt,failure_class:verdict.failure_class,published:false,stale_bases:stale};
    }
    if(isObsolete(job,current))fail('PREPARATION_OBSOLETE','Obsolete preparation cannot be published');
    const manifest=await acceptedManifest(tx,job.organisation_id,job.profile_id,job.preparation_digest);
    const expiry=(manifest as {profile:{policy:{expires_at:string}}}).profile.policy.expires_at;
    const expiresAt=new Date(Math.min(Date.parse(expiry),Date.now()+ttl)).toISOString();
    if(Date.parse(expiresAt)<=Date.now()+1000)fail('PREPARATION_EXPIRED','Accepted profile expires before the base could be used');
    const sealed=await sealPreparedBase(tx,job,report,current,manifest,expiresAt);
    const result=await finishAttempt(tx,job,report.attempt,{outcome:'SUCCEEDED'},{kind:'hyperfide.preparation-diagnostics',stage:'SEALED',...evidence,
     manifest_artifact_digest:report.manifest_artifact_digest,prepared_base_id:sealed.base_id,provider_prepared_digest:sealed.provider_prepared_digest});
    return {...result,attempt:report.attempt,published:true,prepared_base_id:sealed.base_id,provider_prepared_digest:sealed.provider_prepared_digest,stale_bases:sealed.stale,expires_at:expiresAt};
   });
  },
  'preparation.jobs.get':async(value,request)=>{
   const input=fields(value,['job_id']),invocation=invocationOf(request);requireRole(invocation,['PROVISIONER','OPERATOR']);
   return primary(request,invocation,async tx=>{
    const job=await lockJob(tx,invocation,uuid(input.job_id,'job_id'));
    const attempts=await tx.query('SELECT attempt,outcome,failure_class,diagnostics,diagnostics_artifact_digest FROM hyperfide.preparation_job_attempts WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 ORDER BY attempt',[job.organisation_id,job.run_id,job.id]);
    return {job:publicJob(job),attempts:attempts.rows};
   });
  }
 }};
}
