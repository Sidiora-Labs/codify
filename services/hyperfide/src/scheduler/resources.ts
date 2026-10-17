import {releaseSandboxCharges} from './claim.js';
import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {lockRun} from '../events/outbox.js';
import {FoundationError} from '../policy/programme.js';
import {loadExecutionPacket,loadPreparationIntent} from '../hierarchy/packets.js';
import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {actorFor,boundedInteger,canonical,claimTask,decimal,digest,dimensions,dispatchRecipients,fail,fields,
  gatewayFor,invocationFor,object,operationReplay,parseClaim,recordOutcome,requestDigest,reserveCapacity,
  requireSchedulerAuthority,uuid,jobPolicy,allocateReservations,assertJobReservation,bindJobReservation,readJobAllocation,renewJobAllocation,releaseJobAllocation,validateResourceVector,assertNoExecutionHold,requireTaskBarriers,requireProofRegistry,packetResources,packetPolicyResources,approvedDimensions,approvedPhysicalDimensions} from './claim.js';
import type {CapacityDimension,CapacityRequest,SchedulerActor,SchedulerScope,PacketResourceRequirements} from './claim.js';


export interface EligibleTask {
 task_id:string;task_key:string;task_state_version:string;spec_revision_id:string;spec_generation:string;criteria_digest:string;
 profile_id:string;profile_version:string;packet_digest:string;mandatory_digest:string;attempt_id:string;attempt_generation:string;
 resource_requirements:PacketResourceRequirements;execution_packet:unknown;
}
export interface EligibleResult {
 availability:'AVAILABLE'|'UNAVAILABLE';reason?:string;authority:'CANDIDATE_DISCOVERY';observed_at:string;
 spec_revision_id:string;spec_generation:string;eligible:EligibleTask[];excluded:{task_id:string;reason:string}[];
}
export async function eligibleTasks(tx:PrimaryTransaction,input:SchedulerScope&{pool_id:string;profile_id?:string;limit?:number;preparation?:boolean},invocation?:InvocationContext):Promise<EligibleResult>{
 assertPrimaryTransaction(tx);await lockRun(tx,input);
 const limit=boundedInteger(input.limit??100,'limit',1,500);
 let ownedPackages:string[]|null=null;
 if(invocation){
  assertInvocation(invocation);await invocation.guard(tx);
  if(invocation.principal.organisation_id!==input.organisation_id||invocation.principal.run_id!==input.run_id)fail('RUN_SCOPE_DENIED','Candidate discovery requires the authenticated run');
  if(invocation.principal.role==='FEATURE_MANAGER'){
   const owners=await tx.query<{id:string}>('SELECT p.id FROM hyperfide.feature_packages p JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.id JOIN hyperfide.hierarchy_leaders l ON l.organisation_id=p.organisation_id AND l.run_id=p.run_id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.manager_session_id=$3 AND l.authority_epoch=$4 AND h.state NOT IN ($5,$6) FOR SHARE OF p,h,l',[input.organisation_id,input.run_id,invocation.principal.actor_id,invocation.principal.deployment_epoch,'CLOSED','CANCELLED']);
   ownedPackages=owners.rows.map(row=>row.id);
  }else if(invocation.principal.role!=='LEADER')fail('ROLE_DENIED','Operational candidate discovery requires leader or feature manager authority');
 }

 const run=await tx.query<{state:string;authority_epoch:string;spec_revision_id:string;spec_generation:string;observed_at:string}>(
 'SELECT state,authority_epoch,spec_revision_id,spec_generation,clock_timestamp()::text AS observed_at FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',
 [input.organisation_id,input.run_id]);
 const current=run.rows[0];if(!current)fail('RUN_MISSING','Candidate discovery requires an existing run');
 const result:EligibleResult={availability:'AVAILABLE',authority:'CANDIDATE_DISCOVERY',observed_at:current.observed_at,
 spec_revision_id:current.spec_revision_id,spec_generation:current.spec_generation,eligible:[],excluded:[]};
 if(!['READY','RUNNING'].includes(current.state))return {...result,availability:'UNAVAILABLE',reason:'RUN_NOT_ADMITTING'};
 const tasks=await tx.query<{id:string;task_key:string;state_version:string;spec_revision_id:string;spec_generation:string;criteria_digest:string;feature_package_id:string;current_attempt_id:string|null;wave:number;generation:string}>(
 "SELECT * FROM hyperfide.tasks t WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','READY','FAILED','STALE') "+
 "AND NOT(t.definition ? 'retirement') AND NOT EXISTS(SELECT 1 FROM hyperfide.attempts a WHERE a.organisation_id=t.organisation_id AND a.run_id=t.run_id AND a.task_id=t.id AND a.compute_authority='CURRENT') "+
 "AND NOT EXISTS(SELECT 1 FROM hyperfide.submission_custodies c WHERE c.organisation_id=t.organisation_id AND c.run_id=t.run_id AND c.task_id=t.id AND c.authority='ACTIVE') "+
 "AND ($4::uuid[] IS NULL OR t.feature_package_id=ANY($4::uuid[])) ORDER BY wave,task_key,id LIMIT $3",
 [input.organisation_id,input.run_id,limit,ownedPackages]);
 for(const task of tasks.rows){
  try{
   await assertNoExecutionHold(tx,input,{package_id:task.feature_package_id,...(task.current_attempt_id?{attempt_id:task.current_attempt_id}:{}),operation:'ADMISSION'});
   await requireTaskBarriers(tx,input,task.id,task.wave);
   const registry=await requireProofRegistry(tx,input,task);
   const packets=await tx.query<{digest:string}>(
   'SELECT digest FROM hyperfide.hierarchy_execution_packets WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND attempt_generation=$4 AND spec_revision_id=$5 AND spec_generation=$6 ORDER BY created_at DESC,id DESC LIMIT 1',
   [input.organisation_id,input.run_id,task.id,(BigInt(task.generation)+1n).toString(),task.spec_revision_id,task.spec_generation]);
   if(!packets.rows[0])fail('EXECUTION_PACKET_MISSING','A prospective immutable packet is required');
   const loaded=await loadExecutionPacket(tx,{organisation_id:input.organisation_id,run_id:input.run_id,digest:packets.rows[0].digest});
   const packet=object(loaded.packet),mandatory=object(packet.mandatory),identity=object(mandatory.identity),runtime=object(mandatory.runtime),intent=object(mandatory.intent),observation=object(packet.observation);
   if(identity.authority_epoch!==current.authority_epoch||observation.run_spec_generation!==current.spec_generation||
    identity.task_id!==task.id||identity.criteria_digest!==task.criteria_digest||intent.registry_digest!==registry.registry_digest)
    fail('EXECUTION_PACKET_STALE','Prospective packet does not match current accepted authority');
   const profile=object(runtime.declared_profile),profileId=String(runtime.environment_profile_id);
   if(input.profile_id!==undefined&&profileId!==input.profile_id)fail('PROFILE_MISMATCH','Candidate belongs to another environment profile');
   if(typeof profile.profile_version!=='string'||!profile.profile_version)fail('PROFILE_VERSION_MISSING','Immutable environment profile version is required');
   const executor=await tx.query<{state:string;capacity_kind:string;observed_state:string;boot_generation:string;pool_id:string}>(
   'SELECT w.state,w.capacity_kind,s.observed_state,s.boot_generation,s.pool_id FROM hyperfide.worker_slots w JOIN hyperfide.sandboxes s ON s.organisation_id=w.organisation_id AND s.id=w.sandbox_id WHERE w.organisation_id=$1 AND w.id=$2 AND w.sandbox_id=$3 AND w.boot_generation=$4',
   [input.organisation_id,runtime.slot_id,runtime.sandbox_id,runtime.sandbox_boot_generation]);
   const slot=executor.rows[0];
   if(!slot||slot.pool_id!==input.pool_id||(!input.preparation&&(slot.state!=='READY'||slot.observed_state!=='RUNNING'))||slot.capacity_kind!=='AGENT'||slot.boot_generation!==runtime.sandbox_boot_generation)
    fail('SLOT_UNAVAILABLE','Pinned executor is not an available registered slot in this pool');
   await assertNoExecutionHold(tx,input,{package_id:task.feature_package_id,sandbox_id:String(runtime.sandbox_id),operation:'ADMISSION'});
   const requirements=packetPolicyResources(loaded.packet),demand=await approvedDimensions(tx,input,input.pool_id,requirements);
   const accounts=await tx.query<{id:string;free:string}>('SELECT id,(configured_limit-reserved-allocated)::text AS free FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=ANY($2::uuid[])',
    [input.organisation_id,demand.map(row=>row.capacity_account_id)]);
   if(!input.preparation&&demand.some(item=>BigInt(accounts.rows.find(row=>row.id===item.capacity_account_id)?.free??'-1')<BigInt(item.quantity)))
    fail('CAPACITY_WAIT','Approved resource vector is currently occupied');
   const local=await tx.query<{free_cpu:string;free_memory:string;free_disk:string}>('SELECT (hard_cpu_millis-headroom_cpu_millis-held_cpu_millis)::text free_cpu,(hard_memory_bytes-headroom_memory_bytes-held_memory_bytes)::text free_memory,(hard_disk_bytes-headroom_disk_bytes-held_disk_bytes)::text free_disk FROM hyperfide.sandbox_execution_budgets WHERE organisation_id=$1 AND sandbox_id=$2 AND sandbox_boot_generation=$3 FOR SHARE',[input.organisation_id,runtime.sandbox_id,runtime.sandbox_boot_generation]);
   if(!local.rows[0])fail('SANDBOX_BUDGET_UNQUALIFIED','No actual usable budget is qualified for this executor');
   if(BigInt(local.rows[0].free_cpu)<BigInt(requirements.cpu_millis)||BigInt(local.rows[0].free_memory)<BigInt(requirements.memory_bytes)||BigInt(local.rows[0].free_disk)<BigInt(requirements.disk_bytes))fail('SANDBOX_CAPACITY_WAIT','Pinned sandbox has no safe execution headroom');
   result.eligible.push({task_id:task.id,task_key:task.task_key,task_state_version:task.state_version,spec_revision_id:task.spec_revision_id,
    spec_generation:task.spec_generation,criteria_digest:task.criteria_digest,profile_id:profileId,profile_version:profile.profile_version,
    packet_digest:loaded.digest,mandatory_digest:loaded.mandatory_digest,attempt_id:uuid(identity.attempt_id,'packet attempt'),
    attempt_generation:decimal(identity.attempt_generation,'packet generation'),resource_requirements:requirements,execution_packet:loaded.packet});
  }catch(error){
   if(error instanceof FoundationError)result.excluded.push({task_id:task.id,reason:error.code});
   else throw error;
  }
 }
 return result;
}

export async function eligibleDemand(tx:PrimaryTransaction,input:SchedulerScope&{
 pool_id:string;profile_id:string;job_class:'PREPARATION'|'INDEX';warm_spare:boolean;
},invocation:InvocationContext):Promise<{
 eligible_count:number;reservation_dimensions:CapacityDimension[];spec_version:string;profile_version:string;observed_at:string;
 truncated:boolean;candidate_scan_limit:number;preparation_task_id:string|null;execution_dimensions:CapacityDimension[];
}>{
 assertPrimaryTransaction(tx);assertInvocation(invocation);
 if(invocation.principal.organisation_id!==input.organisation_id||invocation.principal.run_id!==input.run_id)
  fail('RUN_SCOPE_DENIED','Preparation demand must match the authenticated run');
 await invocation.guard(tx);await lockRun(tx,input);
 if(!['LEADER','FEATURE_MANAGER'].includes(invocation.principal.role))fail('ROLE_DENIED','Preparation demand requires current leader or feature manager authority');
 if(input.warm_spare&&invocation.principal.role!=='LEADER')fail('SPARE_DELEGATION_REQUIRED','Feature managers have no implicit global spare budget');
 const leadership=await tx.query<{generation:string}>('SELECT generation FROM hyperfide.hierarchy_leaders WHERE organisation_id=$1 AND run_id=$2 FOR SHARE',
 [input.organisation_id,input.run_id]);
 if(!leadership.rows[0])fail('LEADER_UNAVAILABLE','Current leadership is required for preparation demand');
 const actor:SchedulerActor={session_id:invocation.principal.actor_id,leader_generation:leadership.rows[0].generation};
 let packages:string[]|null=null;
 if(invocation.principal.role==='FEATURE_MANAGER'){
  const owned=await tx.query<{id:string;owner_generation:string}>(
  "SELECT p.id,h.owner_generation FROM hyperfide.feature_packages p JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.manager_session_id=$3 AND h.state NOT IN ('CLOSED','CANCELLED') ORDER BY p.id FOR SHARE OF p,h",
  [input.organisation_id,input.run_id,actor.session_id]);
  packages=owned.rows.map(row=>row.id);
  for(const item of owned.rows)await requireSchedulerAuthority(tx,input,{...actor,package_generation:item.owner_generation},invocation.principal.deployment_epoch,item.id);
 }else await requireSchedulerAuthority(tx,input,actor,invocation.principal.deployment_epoch);
 const run=await tx.query<{state:string;spec_generation:string;observed_at:string}>('SELECT state,spec_generation,clock_timestamp()::text AS observed_at FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',
 [input.organisation_id,input.run_id]);
 if(!['READY','RUNNING'].includes(run.rows[0]?.state??''))fail('RUN_NOT_ADMITTING','Run does not admit preparation');
 const pool=await tx.query<{profile_id:string}>('SELECT profile_id FROM hyperfide.provider_pools WHERE organisation_id=$1 AND id=$2 AND state=$3 FOR SHARE',
 [input.organisation_id,input.pool_id,'ACTIVE']);
 if(pool.rows[0]?.profile_id!==input.profile_id)fail('PROFILE_POOL_MISMATCH','Approved preparation profile must match the selected pool');
 const tasks=await tx.query<{id:string;feature_package_id:string;current_attempt_id:string|null;wave:number}>(
 "SELECT t.id,t.feature_package_id,t.current_attempt_id,t.wave FROM hyperfide.tasks t WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.state IN ('PENDING','READY','FAILED','STALE') "+
 "AND ($3::uuid[] IS NULL OR t.feature_package_id=ANY($3::uuid[])) "+
 "AND COALESCE(t.definition->>'environment_profile_id',t.definition#>>'{section,fields,environment_profile_id,value}')=$4 "+
 "AND NOT(t.definition ? 'retirement') AND NOT EXISTS(SELECT 1 FROM hyperfide.attempts a WHERE a.organisation_id=t.organisation_id AND a.run_id=t.run_id AND a.task_id=t.id AND a.compute_authority='CURRENT') "+
 "AND NOT EXISTS(SELECT 1 FROM hyperfide.submission_custodies c WHERE c.organisation_id=t.organisation_id AND c.run_id=t.run_id AND c.task_id=t.id AND c.authority='ACTIVE') ORDER BY t.wave,t.task_key,t.id LIMIT 501",
 [input.organisation_id,input.run_id,packages,input.profile_id]);
 let count=0,maximum:PacketResourceRequirements|undefined,version='';
 let preparationTask:string|null=null,selected:PacketResourceRequirements|undefined,profileResources:unknown;
 for(const task of tasks.rows.slice(0,500)){
  try{
   await assertNoExecutionHold(tx,input,{package_id:task.feature_package_id,...(task.current_attempt_id?{attempt_id:task.current_attempt_id}:{}),operation:'ADMISSION'});
   await requireTaskBarriers(tx,input,task.id,task.wave);
   const accepted=await loadPreparationIntent(tx,{organisation_id:input.organisation_id,run_id:input.run_id,task_id:task.id,profile_id:input.profile_id});
   const requirements=packetResources(accepted.resource_requirements);
   if(version&&version!==accepted.profile_version)fail('PROFILE_VERSION_CONFLICT','Approved profile identity resolves to incompatible immutable versions');
   version=accepted.profile_version;count++;
   if(preparationTask===null){preparationTask=task.id;selected=requirements;profileResources=object(accepted.declared_profile).resources;}
   if(!maximum)maximum={...requirements};
   else{
    maximum.cpu_millis=Math.max(maximum.cpu_millis,requirements.cpu_millis);
    maximum.memory_bytes=BigInt(maximum.memory_bytes)>BigInt(requirements.memory_bytes)?maximum.memory_bytes:requirements.memory_bytes;
    maximum.disk_bytes=BigInt(maximum.disk_bytes)>BigInt(requirements.disk_bytes)?maximum.disk_bytes:requirements.disk_bytes;
   }
  }catch(error){if(!(error instanceof FoundationError))throw error;}
 }
 return {eligible_count:count,reservation_dimensions:selected?await approvedPhysicalDimensions(tx,input,input.pool_id,profileResources,input.warm_spare):[],
 execution_dimensions:selected?await approvedDimensions(tx,input,input.pool_id,selected,input.job_class):[],preparation_task_id:preparationTask,
 spec_version:run.rows[0]!.spec_generation,profile_version:version,observed_at:run.rows[0]!.observed_at,
 truncated:tasks.rows.length>500,candidate_scan_limit:500};
}

export interface QuiescenceReceipt {id:string;digest:string;observed_at:string}
export type ProofReader=(tx:PrimaryTransaction,input:SchedulerScope&{reservation_id:string})=>Promise<QuiescenceReceipt|null>;
export interface DynamicCapacityRequest extends CapacityRequest {pool_id:string}
const JOBS=new Set(['AGENT','BUILD','TEST','REVIEW','INDEX','INTEGRATION','PREPARATION','EXCLUSIVE_SERVICE']);
const REASONS=new Set(['CAPACITY','MODEL','REVIEW','BUILD','PROVIDER_RATE','EXCLUSIVE_SERVICE']);
function scopeOf(input:Record<string,unknown>):SchedulerScope{
  return {organisation_id:uuid(input.organisation_id,'organisation_id'),run_id:uuid(input.run_id,'run_id')};
}
/** Rate receipts are separate from occupied-resource reservations and never inferred from worker TTL. */
export async function reserveDynamic(tx:PrimaryTransaction,input:DynamicCapacityRequest):Promise<unknown>{
  assertPrimaryTransaction(tx);
  const demand=dimensions(input.dimensions),physical:CapacityDimension[]=[],rates:unknown[]=[];
  const immutable={pool_id:input.pool_id,attempt_id:input.attempt_id??null,dimensions:demand,expires_at:String(input.expires_at)};
  const replay=await operationReplay(tx,input,'scheduler-dynamic-capacity','scheduler.capacity.dynamic',input.request_id,immutable);
  if(replay!==undefined)return replay;
  const accountRows=await tx.query<{id:string;pool_id:string;dimension:string;configured_limit:string;qualification_state:string}>(
    'SELECT id,pool_id,dimension,configured_limit,qualification_state FROM hyperfide.capacity_accounts '+
    'WHERE organisation_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
    [input.organisation_id,demand.map(item=>item.capacity_account_id)]);
  if(accountRows.rows.length!==demand.length||accountRows.rows.some(row=>row.pool_id!==input.pool_id))
    fail('CAPACITY_SCOPE_INVALID','Every requested dimension must belong to the selected pool');
  for(const item of demand){
    const row=accountRows.rows.find(candidate=>candidate.id===item.capacity_account_id)!;
    if(row.qualification_state!=='QUALIFIED')fail('CAPACITY_UNQUALIFIED','Capacity dimension '+row.dimension+' is not qualified');
    if(!row.dimension.endsWith('_RATE')){physical.push(item);continue;}
    const prior=await tx.query<{quantity:string;window_start:string}>(
      'SELECT quantity,window_start::text FROM hyperfide.capacity_rate_receipts WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 AND capacity_account_id=$4',
      [input.organisation_id,input.run_id,input.request_id,item.capacity_account_id]);
    if(prior.rows[0]){
      if(prior.rows[0].quantity!==item.quantity)fail('IDEMPOTENCY_CONFLICT','Rate request was reused with different input');
      rates.push({capacity_account_id:item.capacity_account_id,...prior.rows[0]});continue;
    }
    const clock=await tx.query<{window_start:string}>(
      'SELECT to_timestamp(floor(extract(epoch FROM clock_timestamp())*1000/p.rate_window_ms)*p.rate_window_ms/1000)::text AS window_start '+
      'FROM hyperfide.scheduling_policies p WHERE p.organisation_id=$1 AND p.pool_id=$2 FOR SHARE',
      [input.organisation_id,input.pool_id]);
    if(!clock.rows[0])fail('SCHEDULING_POLICY_MISSING','The selected pool has no approved scheduling policy');
    const start=clock.rows[0].window_start;
    const used=await tx.query<{consumed:string}>('SELECT consumed FROM hyperfide.capacity_rate_windows '+
      'WHERE organisation_id=$1 AND capacity_account_id=$2 AND window_start=$3 FOR UPDATE',
      [input.organisation_id,item.capacity_account_id,start]);
    if(BigInt(used.rows[0]?.consumed??'0')+BigInt(item.quantity)>BigInt(row.configured_limit))
      fail('RATE_LIMIT','Admission is limited by '+row.dimension);
    await tx.query('INSERT INTO hyperfide.capacity_rate_windows(organisation_id,capacity_account_id,window_start,consumed) '+
      'VALUES($1,$2,$3,$4) ON CONFLICT(organisation_id,capacity_account_id,window_start) DO UPDATE SET '+
      'consumed=hyperfide.capacity_rate_windows.consumed+EXCLUDED.consumed,state_version=hyperfide.capacity_rate_windows.state_version+1',
      [input.organisation_id,item.capacity_account_id,start,item.quantity]);
    await tx.query('INSERT INTO hyperfide.capacity_rate_receipts(organisation_id,run_id,request_id,capacity_account_id,window_start,quantity) VALUES($1,$2,$3,$4,$5,$6)',
      [input.organisation_id,input.run_id,input.request_id,item.capacity_account_id,start,item.quantity]);
    rates.push({capacity_account_id:item.capacity_account_id,quantity:item.quantity,window_start:start});
  }
  const reservations=physical.length?await reserveCapacity(tx,{...input,dimensions:physical}):[];
  const result={reservations,rate_receipts:rates};
  await recordOutcome(tx,input,'scheduler-dynamic-capacity','scheduler.capacity.dynamic',input.request_id,immutable,result);
  return result;
}

const WAIT_FOR:Record<string,string>={MODEL_RATE:'MODEL',API_RATE:'PROVIDER_RATE',PROVISION_RATE:'PROVIDER_RATE',
  EXCLUSIVE_SERVICE:'EXCLUSIVE_SERVICE',BUILD:'BUILD',REVIEW:'REVIEW',INTEGRATION:'REVIEW'};
export interface AdmissionLimit {
  capacity_account_id:string;dimension:string;resource_key:string;capacity_class:string;
  configured_limit:string;occupied:string;requested:string;wait_reason:string;window_start?:string;
}
/** Locks the exact accounts in UUID order and names the first declared dimension that cannot admit the vector. Writes nothing. */
export async function limitingResource(tx:PrimaryTransaction,input:SchedulerScope&{pool_id:string;dimensions:CapacityDimension[];request_id?:string}):Promise<AdmissionLimit|null>{
  assertPrimaryTransaction(tx);
  const demand=dimensions(input.dimensions);
  const rows=await tx.query<{id:string;pool_id:string;dimension:string;resource_key:string;capacity_class:string;configured_limit:string;occupied:string}>(
    'SELECT id,pool_id,dimension,resource_key,capacity_class,configured_limit::text,(reserved+allocated)::text AS occupied FROM hyperfide.capacity_accounts '+
    'WHERE organisation_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[input.organisation_id,demand.map(item=>item.capacity_account_id)]);
  if(rows.rows.length!==demand.length||rows.rows.some(row=>row.pool_id!==input.pool_id))
    fail('CAPACITY_SCOPE_INVALID','Every requested dimension must belong to the selected pool');
  for(const item of demand){
    const row=rows.rows.find(candidate=>candidate.id===item.capacity_account_id)!;
    let occupied=row.occupied,window:string|undefined;
    if(row.capacity_class!=='RATE'&&input.request_id){
      const prior=await tx.query("SELECT 1 FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 AND capacity_account_id=$4 AND state<>'RELEASED'",
        [input.organisation_id,input.run_id,input.request_id,row.id]);
      if(prior.rows.length)continue;
    }
    if(row.capacity_class==='RATE'){
      if(input.request_id){
        const prior=await tx.query('SELECT 1 FROM hyperfide.capacity_rate_receipts WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 AND capacity_account_id=$4',
          [input.organisation_id,input.run_id,input.request_id,row.id]);
        if(prior.rows.length)continue;
      }
      const used=await tx.query<{window_start:string;consumed:string}>(
        'SELECT k.window_start::text,COALESCE(w.consumed,0)::text AS consumed FROM (SELECT to_timestamp(floor(extract(epoch FROM clock_timestamp())*1000/p.rate_window_ms)*p.rate_window_ms/1000) AS window_start '+
        'FROM hyperfide.scheduling_policies p WHERE p.organisation_id=$1 AND p.pool_id=$2) k LEFT JOIN hyperfide.capacity_rate_windows w ON w.organisation_id=$1 AND w.capacity_account_id=$3 AND w.window_start=k.window_start',
        [input.organisation_id,input.pool_id,row.id]);
      if(!used.rows[0])fail('SCHEDULING_POLICY_MISSING','The selected pool has no approved scheduling policy');
      occupied=used.rows[0].consumed;window=used.rows[0].window_start;
    }
    if(BigInt(occupied)+BigInt(item.quantity)>BigInt(row.configured_limit))
      return {capacity_account_id:row.id,dimension:row.dimension,resource_key:row.resource_key,capacity_class:row.capacity_class,
        configured_limit:row.configured_limit,occupied,requested:item.quantity,wait_reason:WAIT_FOR[row.dimension]??'CAPACITY',...(window?{window_start:window}:{})};
  }
  return null;
}
export interface Backpressure {
  active:boolean;limiting_resource:string|null;
  dimensions:{dimension:string;configured_limit:string;occupied:string;queued:string;saturated:boolean}[];
}
/**
 * Review/integration backpressure. The declared REVIEW and INTEGRATION limits are the policy: once occupied plus live
 * queued downstream work reaches the declared limit, new coding (AGENT) admissions wait with REVIEW instead of
 * producing more unreviewable work. Pools with no outstanding downstream work never apply pressure.
 */
export async function reviewBackpressure(tx:PrimaryTransaction,scope:{organisation_id:string},pool_id:string):Promise<Backpressure>{
  assertPrimaryTransaction(tx);
  const rows=await tx.query<{dimension:string;configured_limit:string;occupied:string;queued:string}>(
    "SELECT a.dimension,a.configured_limit::text,(a.reserved+a.allocated)::text AS occupied,(SELECT count(*) FROM hyperfide.resource_waiters w "+
    "WHERE w.organisation_id=a.organisation_id AND w.pool_id=a.pool_id AND w.job_kind=a.dimension AND w.state='WAITING' AND w.deadline_at>clock_timestamp())::text AS queued "+
    "FROM hyperfide.capacity_accounts a WHERE a.organisation_id=$1 AND a.pool_id=$2 AND a.capacity_class='EXECUTION' AND a.dimension IN ('REVIEW','INTEGRATION') ORDER BY a.dimension",
    [scope.organisation_id,pool_id]);
  const result=rows.rows.map(row=>{
    const backlog=BigInt(row.occupied)+BigInt(row.queued);
    return {...row,saturated:backlog>0n&&backlog>=BigInt(row.configured_limit)};
  });
  const limiting=result.find(row=>row.saturated);
  return {active:limiting!==undefined,limiting_resource:limiting?.dimension??null,dimensions:result};
}
async function markWaiting(tx:PrimaryTransaction,scope:SchedulerScope,waiter:string,reason:string):Promise<void>{
  await tx.query('UPDATE hyperfide.resource_waiters SET wait_reason=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND wait_reason<>$4',
    [scope.organisation_id,scope.run_id,waiter,reason]);
}

export class ResourceScheduler {
  private readonly readers=new Map<string,ProofReader>();
  registerProofReader(source:string,reader:ProofReader):()=>void{
    if(!['provider.absence','runner.quiescence'].includes(source)||typeof reader!=='function')
      fail('INVALID_PROOF_READER','A trusted provider or runner observation reader is required');
    if(this.readers.has(source))fail('DUPLICATE_PROOF_READER','A proof reader is already installed for '+source);
    this.readers.set(source,reader);
    return ()=>{if(this.readers.get(source)===reader)this.readers.delete(source);};
  }
  close():void{this.readers.clear();}
  async release(tx:PrimaryTransaction,input:SchedulerScope&{reservation_ids:string[]}):Promise<unknown>{
    assertPrimaryTransaction(tx);await lockRun(tx,input);
    if(!input.reservation_ids.length||input.reservation_ids.length>1000)fail('INVALID_REQUEST','Release requires one to1000 exact reservation IDs');
    if(!this.readers.size)fail('DEPENDENCY_UNAVAILABLE','A trusted durable quiescence proof reader is required');
    const pools=await tx.query<{pool_id:string}>('SELECT DISTINCT a.pool_id FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.id=ANY($3::uuid[]) ORDER BY a.pool_id',[input.organisation_id,input.run_id,input.reservation_ids]);
    for(const pool of pools.rows)await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.organisation_id+':'+pool.pool_id+':resource-admission']);
    const initial=await tx.query<{capacity_account_id:string}>('SELECT DISTINCT capacity_account_id FROM hyperfide.reservations '+
      'WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY capacity_account_id',
      [input.organisation_id,input.run_id,input.reservation_ids]);
    for(const account of initial.rows)await tx.query('SELECT id FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=$2 FOR UPDATE',
      [input.organisation_id,account.capacity_account_id]);
    const rows=await tx.query<{id:string;capacity_account_id:string;quantity:string;state:string;accounting_bucket:string;attempt_id:string|null}>(
      'SELECT id,capacity_account_id,quantity,state,accounting_bucket,attempt_id FROM hyperfide.reservations '+
      'WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',
      [input.organisation_id,input.run_id,input.reservation_ids]);
    if(rows.rows.length!==new Set(input.reservation_ids).size)fail('RESERVATION_MISSING','A reservation does not belong to this run');
    const released:string[]=[];
    for(const reservation of rows.rows){
      if(reservation.state==='RELEASED'){released.push(reservation.id);continue;}
      if(reservation.state!=='RELEASE_PENDING')fail('RELEASE_NOT_PENDING','Revoke execution and request cleanup before releasing capacity');
      let proof:QuiescenceReceipt|null=null,source='';
      for(const [name,reader] of this.readers){
        const account=await tx.query<{capacity_class:string;dimension:string}>('SELECT capacity_class,dimension FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=$2',[input.organisation_id,reservation.capacity_account_id]);
        if((account.rows[0]?.capacity_class==='PHYSICAL'||account.rows[0]?.dimension==='WARM_SPARE')&&name!=='provider.absence')continue;
        proof=await reader(tx,{organisation_id:input.organisation_id,run_id:input.run_id,reservation_id:reservation.id});
        if(proof){source=name;break;}
      }
      if(!proof)fail('QUIESCENCE_UNCONFIRMED','Occupied capacity remains counted until exact resource absence is observed');
      uuid(proof.id,'observation receipt');digest(proof.digest,'observation digest');
      if(!Number.isFinite(Date.parse(proof.observed_at)))fail('INVALID_PROOF','Observation time is invalid');
      const counter=reservation.accounting_bucket==='ALLOCATED'?'allocated':'reserved';
      const changed=await tx.query('UPDATE hyperfide.capacity_accounts SET '+counter+'='+counter+'-$3::bigint,state_version=state_version+1 '+
        'WHERE organisation_id=$1 AND id=$2 AND '+counter+'>=$3::bigint RETURNING id',
        [input.organisation_id,reservation.capacity_account_id,reservation.quantity]);
      if(changed.rows.length!==1)fail('ACCOUNTING_INCONSISTENT','Capacity counters cannot explain the reservation');
      await tx.query('UPDATE hyperfide.reservations SET state=\'RELEASED\',released_at=clock_timestamp(),release_reason=\'OBSERVED_QUIESCENT\','+
        'state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
        [input.organisation_id,input.run_id,reservation.id]);
      await recordOutcome(tx,input,'scheduler-resources','scheduler.reservation.release',reservation.id,
        {reservation_id:reservation.id},{released:true,proof_source:source,proof_id:proof.id,proof_digest:proof.digest,
          observed_at:proof.observed_at});
      released.push(reservation.id);
    }
    for(const attempt of [...new Set(rows.rows.map(row=>row.attempt_id).filter((id):id is string=>id!==null))]){
      const remaining=await tx.query("SELECT id FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state<>'RELEASED' LIMIT 1",[input.organisation_id,input.run_id,attempt]);
      if(remaining.rows.length)continue;
      const allocations=await tx.query<{slot_id:string;sandbox_id:string;sandbox_boot_generation:string}>(
       "UPDATE hyperfide.slot_allocations SET state='RELEASED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state='RELEASE_PENDING' RETURNING slot_id,sandbox_id,sandbox_boot_generation",
       [input.organisation_id,input.run_id,attempt]);
      for(const allocation of allocations.rows)await tx.query(
       "UPDATE hyperfide.worker_slots w SET state=CASE WHEN s.observed_state='DESTROYED' THEN 'RETIRED' ELSE 'READY' END,state_version=w.state_version+1 FROM hyperfide.sandboxes s "+
       "WHERE w.organisation_id=$1 AND w.id=$2 AND w.sandbox_id=$3 AND w.boot_generation=$4 AND w.state='DRAINING' AND s.organisation_id=w.organisation_id AND s.id=w.sandbox_id AND s.boot_generation=w.boot_generation "+
       "AND s.observed_state IN ('RUNNING','DESTROYED') AND NOT EXISTS(SELECT 1 FROM hyperfide.slot_allocations a WHERE a.organisation_id=w.organisation_id AND a.slot_id=w.id AND a.state IN ('ACTIVE','RELEASE_PENDING'))",
       [input.organisation_id,allocation.slot_id,allocation.sandbox_id,allocation.sandbox_boot_generation]);
    }
    const jobs=await tx.query<{id:string;request_id:string;slot_id:string;sandbox_id:string;sandbox_boot_generation:string}>(
     "SELECT j.* FROM hyperfide.resource_job_allocations j WHERE j.organisation_id=$1 AND j.run_id=$2 AND j.state='RELEASE_PENDING' AND EXISTS(SELECT 1 FROM hyperfide.reservations r WHERE r.organisation_id=j.organisation_id AND r.run_id=j.run_id AND r.request_id=j.request_id AND r.id=ANY($3::uuid[])) FOR UPDATE",
     [input.organisation_id,input.run_id,input.reservation_ids]);
    for(const job of jobs.rows){
     const debt=await tx.query("SELECT r.id FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts c ON c.organisation_id=r.organisation_id AND c.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.request_id=$3 AND c.capacity_class<>'PHYSICAL' AND r.state<>'RELEASED' LIMIT 1",[input.organisation_id,input.run_id,job.request_id]);
     if(debt.rows.length)continue;
     await tx.query("UPDATE hyperfide.resource_job_allocations SET state='RELEASED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[input.organisation_id,input.run_id,job.id]);
     await tx.query("UPDATE hyperfide.worker_slots w SET state=CASE WHEN s.observed_state='DESTROYED' THEN 'RETIRED' ELSE 'READY' END,state_version=w.state_version+1 FROM hyperfide.sandboxes s WHERE w.organisation_id=$1 AND w.id=$2 AND w.sandbox_id=$3 AND w.boot_generation=$4 AND w.state='DRAINING' AND s.organisation_id=w.organisation_id AND s.id=w.sandbox_id AND s.boot_generation=w.boot_generation AND s.observed_state IN ('RUNNING','DESTROYED') AND NOT EXISTS(SELECT 1 FROM hyperfide.resource_job_allocations a WHERE a.organisation_id=w.organisation_id AND a.slot_id=w.id AND a.state IN ('ACTIVE','RELEASE_PENDING')) AND NOT EXISTS(SELECT 1 FROM hyperfide.slot_allocations a WHERE a.organisation_id=w.organisation_id AND a.slot_id=w.id AND a.state IN ('ACTIVE','RELEASE_PENDING'))",[input.organisation_id,job.slot_id,job.sandbox_id,job.sandbox_boot_generation]);
    }
    const requests=await tx.query<{request_id:string}>('SELECT DISTINCT request_id FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[])',[input.organisation_id,input.run_id,input.reservation_ids]);
    await releaseSandboxCharges(tx,input,requests.rows.map(row=>row.request_id));
    return {released_reservation_ids:released};
  }
}
async function requireQueueActor(tx:PrimaryTransaction,scope:SchedulerScope,actor:SchedulerActor,
    epoch:string,task_id?:string,package_id?:string):Promise<void>{
  if(task_id){
    const task=await tx.query<{feature_package_id:string}>('SELECT feature_package_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
      [scope.organisation_id,scope.run_id,task_id]);
    if(!task.rows[0])fail('TASK_MISSING','Resource task does not exist in this run');
    if(package_id&&package_id!==task.rows[0].feature_package_id)fail('PACKAGE_SCOPE_DENIED','Task is bound to another package');
    package_id=task.rows[0].feature_package_id;
  }
  await requireSchedulerAuthority(tx,scope,actor,epoch,package_id);
}
export function createComponent(_startup:ComponentContext):Component{
  const scheduler=new ResourceScheduler();
  const capability=Object.freeze({eligibleTasks,eligibleDemand,validateResourceVector,allocate:allocateReservations,assertJobReservation,bindJobReservation,readJobAllocation,renewJobAllocation,releaseJobAllocation,reserveCapacity:reserveDynamic,limitingResource,reviewBackpressure,
    release:scheduler.release.bind(scheduler),registerProofReader:scheduler.registerProofReader.bind(scheduler)});
  return {apiVersion:1,capabilities:{'scheduler.resources.v1':capability},close:()=>scheduler.close(),actions:{
    'scheduler.resources.eligible':async(value,context)=>{
      const input=fields(value,['organisation_id','run_id','pool_id','authority_epoch','leader_generation'],['package_id','package_generation','profile_id','limit']);
      const scope=scopeOf(input),actor=actorFor(context,scope,input);
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal:context.signal},async tx=>{
        await requireQueueActor(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),undefined,input.package_id===undefined?undefined:uuid(input.package_id,'package_id'));
        return eligibleTasks(tx,{...scope,pool_id:uuid(input.pool_id,'pool_id'),...(input.profile_id===undefined?{}:{profile_id:uuid(input.profile_id,'profile_id')}),...(input.limit===undefined?{}:{limit:boundedInteger(input.limit,'limit',1,500)})},invocationFor(context));
      });
    },
    'scheduler.resources.demand':async(value,context)=>{
      const input=fields(value,['organisation_id','run_id','pool_id','profile_id','job_class','warm_spare']);
      if(!['PREPARATION','INDEX'].includes(String(input.job_class))||typeof input.warm_spare!=='boolean')fail('INVALID_REQUEST','Preparation demand requires an explicit job class and spare policy');
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal:context.signal},tx=>eligibleDemand(tx,{...scopeOf(input),pool_id:uuid(input.pool_id,'pool_id'),profile_id:uuid(input.profile_id,'profile_id'),job_class:input.job_class as 'PREPARATION'|'INDEX',warm_spare:input.warm_spare as boolean},invocationFor(context)));
    },

    'scheduler.resources.queue':async(value,context)=>{
      const input=fields(value,['organisation_id','run_id','request_id','pool_id','job_kind','priority','wait_reason','deadline_ms','dimensions',
        'authority_epoch','leader_generation'],['package_generation','task_id','package_id','attempt_id']);
      const scope=scopeOf(input),actor=actorFor(context,scope,input),request=uuid(input.request_id,'request_id');
      const pool=uuid(input.pool_id,'pool_id'),demand=dimensions(input.dimensions);
      if(typeof input.job_kind!=='string'||!JOBS.has(input.job_kind)||typeof input.wait_reason!=='string'||!REASONS.has(input.wait_reason))
        fail('INVALID_REQUEST','Unknown resource job kind or wait reason');
      const job=input.job_kind,reason=input.wait_reason;
      const priority=boundedInteger(input.priority,'priority',-1000,1000),deadline=boundedInteger(input.deadline_ms,'deadline_ms',1000,86400000);
      const task=input.task_id===undefined?undefined:uuid(input.task_id,'task_id');
      const package_id=input.package_id===undefined?undefined:uuid(input.package_id,'package_id');
      const attempt=input.attempt_id===undefined?null:uuid(input.attempt_id,'attempt_id');
      if(!task)fail('TASK_REQUIRED','Public job admission must bind an accepted task resource policy');
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},async tx=>{
        await lockRun(tx,scope);await requireQueueActor(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),task,package_id);
        const priorInput=await operationReplay(tx,scope,actor.session_id,'scheduler.resource.queue',request,input);
        if(priorInput!==undefined)return priorInput;
        const prior=await tx.query<{id:string;owner_session_id:string;job_kind:string;pool_id:string;priority:number}>(
          'SELECT id,owner_session_id,job_kind,pool_id,priority FROM hyperfide.resource_waiters WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 FOR UPDATE',
          [scope.organisation_id,scope.run_id,request]);
        if(prior.rows[0]){
          const old=prior.rows[0];
          const oldDemand=await tx.query<{capacity_account_id:string;quantity:string}>('SELECT capacity_account_id,quantity FROM hyperfide.resource_waiter_dimensions '+
            'WHERE organisation_id=$1 AND run_id=$2 AND waiter_id=$3 ORDER BY capacity_account_id',[scope.organisation_id,scope.run_id,old.id]);
          if(old.owner_session_id!==actor.session_id||old.job_kind!==job||old.pool_id!==pool||old.priority!==priority||
            canonical(oldDemand.rows)!==canonical(demand))fail('IDEMPOTENCY_CONFLICT','Queue identity has different immutable input');
          return {waiter_id:old.id,replayed:true};
        }
        const policy=await tx.query<{max_waiters:number}>('SELECT max_waiters FROM hyperfide.scheduling_policies WHERE organisation_id=$1 AND pool_id=$2 FOR SHARE',
          [scope.organisation_id,pool]);
        if(!policy.rows[0])fail('SCHEDULING_POLICY_MISSING','A declared scheduling policy is required');
        const count=await tx.query<{count:string}>('SELECT count(*)::text FROM hyperfide.resource_waiters WHERE organisation_id=$1 AND pool_id=$2 AND state=\'WAITING\' AND deadline_at>clock_timestamp()',
          [scope.organisation_id,pool]);
        if(BigInt(count.rows[0]!.count)>=BigInt(policy.rows[0].max_waiters))fail('RESOURCE_QUEUE_OVERLOADED','The declared pool queue budget is full');
        const accounts=await tx.query<{id:string;dimension:string;pool_id:string}>('SELECT id,dimension,pool_id FROM hyperfide.capacity_accounts '+
          'WHERE organisation_id=$1 AND id=ANY($2::uuid[])',[scope.organisation_id,demand.map(item=>item.capacity_account_id)]);
        if(accounts.rows.length!==demand.length||accounts.rows.some(row=>row.pool_id!==pool)||
          !accounts.rows.some(row=>row.dimension===job))fail('CAPACITY_SCOPE_INVALID','The declared job capacity dimension must be reserved in the selected pool');
        const policyRequirements=await jobPolicy(tx,scope,task!,'ADMISSION');
        const expected=await approvedDimensions(tx,scope,pool,policyRequirements,job);
        if(canonical(expected)!==canonical(demand))fail('RESOURCE_VECTOR_MISMATCH','Queued resource vector must match accepted task policy');
        const pins=await tx.query<{spec_revision_id:string;spec_generation:string;criteria_digest:string}>('SELECT spec_revision_id,spec_generation,criteria_digest FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,task]);
        const id=randomUUID();
        await tx.query('INSERT INTO hyperfide.resource_waiters(organisation_id,run_id,id,request_id,pool_id,owner_session_id,task_id,job_kind,priority,'+
          'wait_reason,deadline_at,attempt_id,spec_revision_id,spec_generation,criteria_digest,resource_policy_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp()+$11::integer*interval\'1 millisecond\',$12,$13,$14,$15,$16)',
          [scope.organisation_id,scope.run_id,id,request,pool,actor.session_id,task??null,job,priority,reason,deadline,attempt,pins.rows[0]!.spec_revision_id,pins.rows[0]!.spec_generation,pins.rows[0]!.criteria_digest,requestDigest(policyRequirements)]);
        for(const dimension of demand)await tx.query('INSERT INTO hyperfide.resource_waiter_dimensions(organisation_id,run_id,waiter_id,pool_id,capacity_account_id,quantity) '+
          'VALUES($1,$2,$3,$4,$5,$6)',[scope.organisation_id,scope.run_id,id,pool,dimension.capacity_account_id,dimension.quantity]);
        const result={waiter_id:id,replayed:false,wait_reason:reason};await recordOutcome(tx,scope,actor.session_id,'scheduler.resource.queue',request,input,result);return result;
      });
    },
    'scheduler.resources.admit':async(value,context)=>{
      const input=fields(value,['organisation_id','run_id','pool_id','waiter_id','authority_epoch','leader_generation'],
        ['package_generation','package_id','claim']);
      const scope=scopeOf(input),actor=actorFor(context,scope,input),pool=uuid(input.pool_id,'pool_id'),waiter=uuid(input.waiter_id,'waiter_id');
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},async tx=>{
        await lockRun(tx,scope);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.organisation_id+':'+pool+':resource-admission']);
        const selected=await tx.query<{id:string;run_id:string;request_id:string;job_kind:string;task_id:string|null;attempt_id:string|null;deadline_at:string;owner_session_id:string;state:string;admitted_at:string|null}>(
          'SELECT * FROM hyperfide.resource_waiters WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND pool_id=$4 FOR UPDATE',
          [scope.organisation_id,scope.run_id,waiter,pool]);
        const row=selected.rows[0];if(!row)fail('WAITER_MISSING','Resource waiter does not exist in this run and pool');
        await requireQueueActor(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),row.task_id??undefined,
          input.package_id===undefined?undefined:uuid(input.package_id,'package_id'));
        if(row.state==='ADMITTED')return {waiter_id:waiter,admitted:true,replayed:true,attempt_id:row.attempt_id};
        if(row.state!=='WAITING')fail('WAITER_TERMINAL','Resource waiter is terminal');
        const live=await tx.query<{live:boolean}>('SELECT $1::timestamptz>clock_timestamp() AS live',[row.deadline_at]);
        if(!live.rows[0]?.live){
          await tx.query("UPDATE hyperfide.resource_waiters SET state='EXPIRED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,waiter]);
          return {waiter_id:waiter,admitted:false,state:'EXPIRED',wait_reason:'DEADLINE'};
        }
        // Coding work waits behind saturated review/integration instead of being admitted or appearing stalled.
        const pressure=await reviewBackpressure(tx,scope,pool);
        if(row.job_kind==='AGENT'&&pressure.active){
          await markWaiting(tx,scope,waiter,'REVIEW');
          return {waiter_id:waiter,admitted:false,state:'QUEUED',wait_reason:'REVIEW',limiting_resource:{dimension:pressure.limiting_resource,cause:'BACKPRESSURE'},backpressure:pressure};
        }
        // Backpressured coding waiters cannot hold the head of line against the review work that relieves them.
        const rank=await tx.query<{id:string;run_id:string}>(
          'SELECT w.id,w.run_id FROM hyperfide.resource_waiters w JOIN hyperfide.runs r ON r.organisation_id=w.organisation_id AND r.id=w.run_id '+
          'JOIN hyperfide.scheduling_policies p ON p.organisation_id=w.organisation_id AND p.pool_id=w.pool_id '+
          'WHERE w.organisation_id=$1 AND w.pool_id=$2 AND w.state=\'WAITING\' AND w.deadline_at>clock_timestamp() '+
          'AND NOT($3::boolean AND w.job_kind=\'AGENT\') AND r.state IN (\'READY\',\'RUNNING\') ORDER BY CASE WHEN extract(epoch FROM(clock_timestamp()-w.enqueued_at))>=p.max_bypass_seconds THEN 1 ELSE 0 END DESC,CASE WHEN extract(epoch FROM(clock_timestamp()-w.enqueued_at))>=p.max_bypass_seconds THEN w.enqueued_at END,w.priority+floor(extract(epoch FROM(clock_timestamp()-w.enqueued_at))/p.aging_seconds) DESC,w.enqueued_at,w.id LIMIT 1',
          [scope.organisation_id,pool,pressure.active]);
        if(rank.rows[0]?.id!==waiter||rank.rows[0]?.run_id!==scope.run_id)
          return {waiter_id:waiter,admitted:false,wait_reason:'FAIRNESS',state:'QUEUED'};
        const demand=await tx.query<CapacityDimension>('SELECT capacity_account_id,quantity FROM hyperfide.resource_waiter_dimensions '+
          'WHERE organisation_id=$1 AND run_id=$2 AND waiter_id=$3 ORDER BY capacity_account_id',[scope.organisation_id,scope.run_id,waiter]);
        const accepted=await jobPolicy(tx,scope,row.task_id!,'ADMISSION');
        const expected=await approvedDimensions(tx,scope,pool,accepted,row.job_kind);
        const pins=await tx.query<{valid:boolean}>('SELECT w.spec_revision_id=t.spec_revision_id AND w.spec_generation=t.spec_generation AND w.criteria_digest=t.criteria_digest AND w.resource_policy_digest=$4 AS valid FROM hyperfide.resource_waiters w JOIN hyperfide.tasks t ON t.organisation_id=w.organisation_id AND t.run_id=w.run_id AND t.id=w.task_id WHERE w.organisation_id=$1 AND w.run_id=$2 AND w.id=$3',[scope.organisation_id,scope.run_id,waiter,requestDigest(accepted)]);
        if(!pins.rows[0]?.valid)fail('JOB_POLICY_STALE','Queued job no longer matches its immutable accepted task policy');

        if(canonical(expected)!==canonical(demand.rows))fail('RESOURCE_VECTOR_MISMATCH','Queued policy changed before resource admission');
        // A declared limit leaves the waiter queued and names the actual limiting resource; nothing is partially reserved.
        const limit=await limitingResource(tx,{...scope,pool_id:pool,request_id:row.request_id,dimensions:demand.rows});
        if(limit){
          await markWaiting(tx,scope,waiter,limit.wait_reason);
          return {waiter_id:waiter,admitted:false,state:'QUEUED',wait_reason:limit.wait_reason,limiting_resource:limit};
        }
        let result:unknown;
        let attempt=row.attempt_id;
        if(row.job_kind==='AGENT'){
          const request=parseClaim(input.claim);
          if(request.request_id!==row.request_id||request.task_id!==row.task_id||request.run_id!==scope.run_id||
            request.organisation_id!==scope.organisation_id||canonical(request.capacity)!==canonical(demand.rows))
            fail('QUEUE_CLAIM_MISMATCH','Agent claim must match the exact queued task and resource vector');
          result=await claimTask(tx,request,actor,dispatchRecipients(context));
          attempt=object(object(result).token).attempt_id as string;
        }else result=await reserveDynamic(tx,{...scope,request_id:row.request_id,pool_id:pool,
          ...(attempt?{attempt_id:attempt}:{}),dimensions:demand.rows,expires_at:row.deadline_at});
        if(row.job_kind!=='AGENT'){
          const reserved=await tx.query<{id:string}>('SELECT id FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[scope.organisation_id,scope.run_id,row.request_id]);
          await allocateReservations(tx,{...scope,reservation_ids:reserved.rows.map(item=>item.id)});
        }
        await tx.query('UPDATE hyperfide.resource_waiters SET state=\'ADMITTED\',admitted_at=clock_timestamp(),attempt_id=$4,state_version=state_version+1 '+
          'WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,waiter,attempt]);
        return {waiter_id:waiter,admitted:true,replayed:false,result};
      });
    },
    'scheduler.resources.inspect':async(value,context)=>{
      const input=fields(value,['organisation_id','run_id','pool_id','authority_epoch','leader_generation'],['package_generation','package_id']);
      const scope=scopeOf(input),actor=actorFor(context,scope,input),pool=uuid(input.pool_id,'pool_id');
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:1,signal:context.signal},async tx=>{
        await requireQueueActor(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),undefined,
          input.package_id===undefined?undefined:uuid(input.package_id,'package_id'));
        const rows=await tx.query('SELECT capacity_class,dimension,resource_key,configured_limit,reserved,allocated,qualification_state,state_version '+
          'FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 ORDER BY capacity_class,dimension,resource_key',[scope.organisation_id,pool]);
        const queued=await tx.query('SELECT job_kind,wait_reason,count(*)::text AS count,min(enqueued_at)::text AS oldest,\'QUEUED\' AS state,false AS stalled '+
          'FROM hyperfide.resource_waiters WHERE organisation_id=$1 AND run_id=$2 AND pool_id=$3 AND state=\'WAITING\' AND deadline_at>clock_timestamp() GROUP BY job_kind,wait_reason ORDER BY job_kind,wait_reason',
          [scope.organisation_id,scope.run_id,pool]);
        // Stalled work holds current compute authority past its primary-clock lease; queued work never does.
        const stalled=await tx.query('SELECT a.id AS attempt_id,a.task_id,a.lease_expires_at::text,\'STALLED\' AS state,\'COMPUTE_LEASE_EXPIRED\' AS reason '+
          'FROM hyperfide.attempts a JOIN hyperfide.sandboxes s ON s.organisation_id=a.organisation_id AND s.id=a.sandbox_id '+
          'WHERE a.organisation_id=$1 AND a.run_id=$2 AND s.pool_id=$3 AND a.compute_authority=\'CURRENT\' AND a.lease_expires_at<=clock_timestamp() ORDER BY a.id LIMIT 500',
          [scope.organisation_id,scope.run_id,pool]);
        return {accounts:rows.rows,queues:queued.rows,stalled:stalled.rows,backpressure:await reviewBackpressure(tx,scope,pool),
          observation:'PRIMARY_SNAPSHOT',measurement_status:'NOT_A_PERFORMANCE_QUALIFICATION'};
      });
    },
    'scheduler.resources.release':async(value,context)=>{
      const input=fields(value,['organisation_id','run_id','reservation_ids','authority_epoch','leader_generation'],['package_generation','package_id']);
      const scope=scopeOf(input),actor=actorFor(context,scope,input);
      if(!Array.isArray(input.reservation_ids))fail('INVALID_REQUEST','reservation_ids must be an array');
      const ids=input.reservation_ids.map(id=>uuid(id,'reservation_id'));
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},async tx=>{
        await requireQueueActor(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),undefined,
          input.package_id===undefined?undefined:uuid(input.package_id,'package_id'));
        return scheduler.release(tx,{...scope,reservation_ids:ids});
      });
    }
  }};
}
