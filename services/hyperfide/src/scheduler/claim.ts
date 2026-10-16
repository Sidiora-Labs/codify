import {createHash,randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import type {PrimaryTransaction,TransactionGateway} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {requireAuthority} from '../hierarchy/packages.js';
import {enqueue,lockRun} from '../events/outbox.js';

export interface SchedulerScope {organisation_id:string;run_id:string}
export interface SchedulerActor {session_id:string;leader_generation:string;package_generation?:string}
export interface CapacityDimension {capacity_account_id:string;quantity:string}
export interface CapacityRequest extends SchedulerScope {
  request_id:string;attempt_id?:string;dimensions:CapacityDimension[];expires_at:string;
}
export interface ComputeToken extends SchedulerScope {
  task_id:string;attempt_id:string;attempt_generation:string;authority_epoch:string;
  sandbox_id:string;slot_id:string;sandbox_boot_generation:string;
}
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DIGEST=/^sha256:[0-9a-f]{64}$/;
export function fail(code:string,message:string):never{throw new FoundationError(code,message);}
export function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_REQUEST','Expected an object');
  return value as Record<string,unknown>;
}
export function fields(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
  const item=object(value),allowed=new Set([...required,...optional]);
  if(required.some(key=>!Object.hasOwn(item,key))||Object.keys(item).some(key=>!allowed.has(key)))
    fail('INVALID_REQUEST','Request fields do not match this operation');
  return item;
}
export function uuid(value:unknown,label:string):string{
  if(typeof value!=='string'||!UUID.test(value))fail('INVALID_REQUEST',label+' must be a UUID');return value;
}
export function decimal(value:unknown,label:string,zero=false):string{
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||value.length>19||
    BigInt(value)>9223372036854775807n||(!zero&&value==='0'))
    fail('INVALID_REQUEST',label+' must be a canonical bigint decimal string');return value;
}
export function digest(value:unknown,label:string):string{
  if(typeof value!=='string'||!DIGEST.test(value))fail('INVALID_REQUEST',label+' must be a SHA256 identity');return value;
}
export function boundedInteger(value:unknown,label:string,min:number,max:number):number{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)
    fail('INVALID_REQUEST',label+' is outside its declared range');return value;
}
export function canonical(value:unknown):string{
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const record=object(value);
  return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+canonical(record[key])).join(',')+'}';
}
export function requestDigest(value:unknown):string{
  return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
}
export function gatewayFor(context:ComponentContext):TransactionGateway{
  const resources=(context as ComponentContext & {resources?:{gateway?:TransactionGateway}}).resources;
  if(!resources?.gateway)fail('DEPENDENCY_UNAVAILABLE','The registered primary transaction gateway is required');
  return resources.gateway;
}
export interface SchedulerInvocation {
  principal:{actor_id:string;organisation_id:string;run_id:string;deployment_epoch:string};
  guard:(tx:PrimaryTransaction)=>Promise<void>;
}
export function invocationFor(context:ComponentContext):SchedulerInvocation {
  const invocation=(context as ComponentContext & {invocation?:SchedulerInvocation}).invocation;
  if(!invocation||typeof invocation.guard!=='function'||!invocation.principal)
    fail('AUTHENTICATED_ACTOR_REQUIRED','A server-authenticated invocation is required');
  return invocation;
}
export function actorFor(context:ComponentContext,scope:SchedulerScope,request:Record<string,unknown>):SchedulerActor{
  const principal=invocationFor(context).principal;
  if(context.policy.programme_id!==scope.run_id||principal.run_id!==scope.run_id||principal.organisation_id!==scope.organisation_id)
    fail('RUN_SCOPE_DENIED','Authenticated principal does not match the run scope');
  if(request.authority_epoch!==undefined&&principal.deployment_epoch!==request.authority_epoch)
    fail('STALE_AUTHORITY_EPOCH','Authenticated invocation is bound to another deployment epoch');
  return {session_id:uuid(principal.actor_id,'authenticated actor'),
    leader_generation:decimal(request.leader_generation,'leader_generation'),
    ...(request.package_generation===undefined?{}:{package_generation:decimal(request.package_generation,'package_generation')})};
}
export function dispatchRecipients(context:ComponentContext):{consumer_ids:string[]}{
  const primary=uuid(context.env.HF_SCHEDULER_DISPATCH_CONSUMER_ID,'trusted dispatch consumer');
  const audit=(context.env.HF_SCHEDULER_AUDIT_CONSUMER_IDS??'').split(',').filter(Boolean)
    .map(value=>uuid(value,'trusted audit consumer'));
  return {consumer_ids:[...new Set([primary,...audit])]};
}
export async function requireSchedulerAuthority(tx:PrimaryTransaction,scope:SchedulerScope,actor:SchedulerActor,
    authority_epoch:string,package_id?:string):Promise<void>{
  assertPrimaryTransaction(tx);
  await requireAuthority(tx,{organisation_id:scope.organisation_id,run_id:scope.run_id,authority_epoch,session_id:actor.session_id,
    leader_generation:actor.leader_generation,...(package_id?{package_id}:{}),
    ...(actor.package_generation?{package_generation:actor.package_generation}:{}),
    roles:['LEADER','FEATURE_MANAGER']});
}
export async function operationReplay(tx:PrimaryTransaction,scope:SchedulerScope,principal:string,
    operation:string,key:string,payload:unknown):Promise<unknown|undefined>{
  const rows=await tx.query<{request_digest:string;state:string;result:unknown}>(
    'SELECT request_digest,state,result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 '+
    'AND principal_scope=$3 AND operation=$4 AND idempotency_key=$5 FOR UPDATE',
    [scope.organisation_id,scope.run_id,principal,operation,key]);
  const previous=rows.rows[0];
  if(!previous)return undefined;
  if(previous.request_digest!==requestDigest(payload))fail('IDEMPOTENCY_CONFLICT','The operation key is bound to different input');
  if(previous.state==='COMPLETED')return previous.result;
  fail('RECONCILIATION_REQUIRED','This operation already has an unresolved durable outcome');
}
export async function recordOutcome(tx:PrimaryTransaction,scope:SchedulerScope,principal:string,
    operation:string,key:string,payload:unknown,result:unknown):Promise<void>{
  await tx.query('INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,'+
    'idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,$5,$6,$7,\'COMPLETED\',$8::jsonb)',
    [scope.organisation_id,scope.run_id,randomUUID(),principal,operation,key,requestDigest(payload),JSON.stringify(result)]);
}
export function dimensions(value:unknown):CapacityDimension[]{
  if(!Array.isArray(value)||!value.length||value.length>64)fail('INVALID_REQUEST','Capacity requires one to64 explicit dimensions');
  const parsed=value.map(item=>{const x=fields(item,['capacity_account_id','quantity']);return {
    capacity_account_id:uuid(x.capacity_account_id,'capacity_account_id'),quantity:decimal(x.quantity,'quantity')};});
  if(new Set(parsed.map(x=>x.capacity_account_id)).size!==parsed.length)fail('INVALID_REQUEST','Duplicate capacity account');
  return parsed.sort((a,b)=>a.capacity_account_id.localeCompare(b.capacity_account_id));
}
/** Caller holds shared run authority and acquires accounts in stable UUID order. */
export async function reserveCapacity(tx:PrimaryTransaction,input:CapacityRequest):Promise<unknown[]>{
  assertPrimaryTransaction(tx);
  const demand=dimensions(input.dimensions),reserved:unknown[]=[];
  for(const item of demand){
    const account=await tx.query<{id:string;pool_id:string;dimension:string;configured_limit:string;
      reserved:string;allocated:string;qualification_state:string}>(
      'SELECT * FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=$2 FOR UPDATE',
      [input.organisation_id,item.capacity_account_id]);
    const row=account.rows[0];if(!row)fail('CAPACITY_ACCOUNT_MISSING','A requested capacity account does not exist');
    if(row.dimension.endsWith('_RATE'))fail('RATE_BUDGET_REQUIRES_SCHEDULER','Rate budgets use durable time windows');
    if(row.qualification_state!=='QUALIFIED')fail('CAPACITY_UNQUALIFIED','Capacity dimension '+row.dimension+' is not qualified');
    const existing=await tx.query<{id:string;quantity:string;state:string}>(
      'SELECT id,quantity,state FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 '+
      'AND request_id=$3 AND capacity_account_id=$4 FOR UPDATE',
      [input.organisation_id,input.run_id,input.request_id,item.capacity_account_id]);
    if(existing.rows[0]){
      if(existing.rows[0].quantity!==item.quantity||existing.rows[0].state==='RELEASED')
        fail('IDEMPOTENCY_CONFLICT','Capacity request identity was reused incompatibly');
      reserved.push(existing.rows[0]);continue;
    }
    // PROVISIONING and RELEASE_PENDING remain counted; TTL is not proof of quiescence.
    const total=BigInt(row.reserved)+BigInt(row.allocated)+BigInt(item.quantity);
    if(total>BigInt(row.configured_limit))fail('CAPACITY_LIMIT','Admission is limited by '+row.dimension);
    await tx.query('UPDATE hyperfide.capacity_accounts SET reserved=reserved+$3::bigint,state_version=state_version+1 '+
      'WHERE organisation_id=$1 AND id=$2',[input.organisation_id,item.capacity_account_id,item.quantity]);
    const reservation=await tx.query('INSERT INTO hyperfide.reservations(organisation_id,run_id,id,request_id,'+
      'capacity_account_id,quantity,attempt_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [input.organisation_id,input.run_id,randomUUID(),input.request_id,item.capacity_account_id,
        item.quantity,input.attempt_id??null,input.expires_at]);
    reserved.push(reservation.rows[0]);
  }
  return reserved;
}
function declaredScopes(definition:unknown):string[]{
  const definitionObject=object(definition),section=definitionObject.section;
  let value:unknown=definitionObject.touches;
  if(section&&typeof section==='object'){
    const sectionFields=(section as {fields?:Record<string,{value?:unknown}>}).fields;
    value=sectionFields?.touches?.value??value;
  }
  if(!Array.isArray(value)||!value.length||value.some(x=>typeof x!=='string'))
    fail('TASK_SCOPE_MISSING','Accepted task intent must declare nonempty write scopes');
  const result=(value as string[]).map(path=>{
    if(path.startsWith('/')||path.includes('\\')||path.split('/').includes('..')||path.includes('\0'))
      fail('TASK_SCOPE_INVALID','Accepted task contains an unsafe write scope');
    const wildcard=path.search(/[*?\[]/);
    const prefix=wildcard<0?path:path.slice(0,path.lastIndexOf('/',wildcard)+1);
    return prefix.replace(/\/+$/,'')||'.';
  });
  return [...new Set(result)].sort();
}
async function lockScopes(tx:PrimaryTransaction,scope:SchedulerScope,paths:string[]):Promise<void>{
  const locks=new Map<string,boolean>();
  for(const path of paths){
    const parts=path==='.'?[]:path.split('/');
    locks.set('.',locks.get('.')||path==='.');
    for(let i=1;i<=parts.length;i++){
      const prefix=parts.slice(0,i).join('/');
      locks.set(prefix,locks.get(prefix)||i===parts.length);
    }
  }
  for(const [path,exclusive] of [...locks.entries()].sort(([a],[b])=>a.localeCompare(b))){
    const fn=exclusive?'pg_advisory_xact_lock':'pg_advisory_xact_lock_shared';
    await tx.query('SELECT '+fn+'(hashtextextended($1,0))',
      [scope.organisation_id+':'+scope.run_id+':write-scope:'+path]);
  }
}
const overlap=(a:string,b:string)=>a==='.'||b==='.'||a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
interface ClaimRequest extends SchedulerScope {
  request_id:string;task_id:string;attempt_id:string;attempt_generation:string;run_spec_generation:string;spec_generation:string;spec_revision_id:string;authority_epoch:string;
  leader_generation:string;package_generation?:string;sandbox_id:string;slot_id:string;
  sandbox_boot_generation:string;lease_ms:number;input_packet_digest:string;capacity:CapacityDimension[];
}
export function parseClaim(value:unknown):ClaimRequest{
  const input=fields(value,['organisation_id','run_id','request_id','task_id','attempt_id','attempt_generation','run_spec_generation','spec_generation','spec_revision_id',
    'authority_epoch','leader_generation','sandbox_id','slot_id','sandbox_boot_generation','lease_ms',
    'input_packet_digest','capacity'],['package_generation']);
  return {
    organisation_id:uuid(input.organisation_id,'organisation_id'),run_id:uuid(input.run_id,'run_id'),
    request_id:uuid(input.request_id,'request_id'),task_id:uuid(input.task_id,'task_id'),
    attempt_id:uuid(input.attempt_id,'attempt_id'),attempt_generation:decimal(input.attempt_generation,'attempt_generation'),
    run_spec_generation:decimal(input.run_spec_generation,'run_spec_generation'),
    spec_generation:decimal(input.spec_generation,'spec_generation'),spec_revision_id:uuid(input.spec_revision_id,'spec_revision_id'),
    authority_epoch:uuid(input.authority_epoch,'authority_epoch'),leader_generation:decimal(input.leader_generation,'leader_generation'),
    ...(input.package_generation===undefined?{}:{package_generation:decimal(input.package_generation,'package_generation')}),
    sandbox_id:uuid(input.sandbox_id,'sandbox_id'),slot_id:uuid(input.slot_id,'slot_id'),
    sandbox_boot_generation:decimal(input.sandbox_boot_generation,'sandbox_boot_generation'),
    lease_ms:boundedInteger(input.lease_ms,'lease_ms',1000,300000),
    input_packet_digest:digest(input.input_packet_digest,'input_packet_digest'),capacity:dimensions(input.capacity)
  };
}
export async function claimTask(tx:PrimaryTransaction,input:ClaimRequest,actor:SchedulerActor,recipients:{consumer_ids:string[]}):Promise<unknown>{
  assertPrimaryTransaction(tx);
  await lockRun(tx,{organisation_id:input.organisation_id,run_id:input.run_id});
  const run=await tx.query<{state:string;authority_epoch:string;spec_generation:string;spec_revision_id:string}>(
    'SELECT state,authority_epoch,spec_generation,spec_revision_id FROM hyperfide.runs '+
    'WHERE organisation_id=$1 AND id=$2 FOR SHARE',[input.organisation_id,input.run_id]);
  const currentRun=run.rows[0];
  if(!currentRun||!['READY','RUNNING'].includes(currentRun.state))fail('RUN_NOT_ADMITTING','Run is not validated and accepting dispatch');
  if(currentRun.authority_epoch!==input.authority_epoch||currentRun.spec_generation!==input.run_spec_generation)fail('STALE_SPEC_OR_EPOCH','Claim does not pin current run authority');
  const candidate=await tx.query<{feature_package_id:string;definition:unknown}>(
    'SELECT feature_package_id,definition FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
    [input.organisation_id,input.run_id,input.task_id]);
  if(!candidate.rows[0])fail('TASK_MISSING','Task does not exist in this run');
  await requireSchedulerAuthority(tx,input,actor,input.authority_epoch,candidate.rows[0].feature_package_id);
  const replay=await operationReplay(tx,input,actor.session_id,'scheduler.claim',input.request_id,input);
  if(replay!==undefined)return replay;
  const paths=declaredScopes(candidate.rows[0].definition);
  await lockScopes(tx,input,paths);
  // Capacity accounts lock before slot/task locks, consistently across every claim.
  for(const item of input.capacity){
    const row=await tx.query<{pool_id:string;dimension:string}>(
      'SELECT pool_id,dimension FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=$2 FOR UPDATE',
      [input.organisation_id,item.capacity_account_id]);
    if(!row.rows[0])fail('CAPACITY_ACCOUNT_MISSING','A requested capacity account does not exist');
  }
  const slot=await tx.query<{state:string;capacity_kind:string;pool_id:string;boot_generation:string;observed_state:string}>(
    'SELECT w.state,w.capacity_kind,s.pool_id,s.boot_generation,s.observed_state FROM hyperfide.worker_slots w '+
    'JOIN hyperfide.sandboxes s ON s.organisation_id=w.organisation_id AND s.id=w.sandbox_id '+
    'WHERE w.organisation_id=$1 AND w.sandbox_id=$2 AND w.id=$3 AND w.boot_generation=$4 FOR UPDATE OF w',
    [input.organisation_id,input.sandbox_id,input.slot_id,input.sandbox_boot_generation]);
  const selected=slot.rows[0];
  if(!selected||selected.state!=='READY'||selected.capacity_kind!=='AGENT'||
      selected.observed_state!=='RUNNING'||selected.boot_generation!==input.sandbox_boot_generation)
    fail('SLOT_UNAVAILABLE','Slot is not a current registered agent slot in a running sandbox');
  const accounts=await tx.query<{id:string;dimension:string;pool_id:string}>(
    'SELECT id,dimension,pool_id FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=ANY($2::uuid[])',
    [input.organisation_id,input.capacity.map(item=>item.capacity_account_id)]);
  if(accounts.rows.some(account=>account.pool_id!==selected.pool_id)||
      !accounts.rows.some(account=>account.dimension==='AGENT'))fail('CAPACITY_SCOPE_INVALID','Claim must reserve agent capacity from the selected pool');
  const taskResult=await tx.query<{state:string;generation:string;wave:number;spec_generation:string;spec_revision_id:string;
    current_attempt_id:string|null;current_custody_id:string|null}>(
    'SELECT * FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
    [input.organisation_id,input.run_id,input.task_id]);
  const task=taskResult.rows[0]!;
  if(task.spec_generation!==input.spec_generation||task.spec_revision_id!==input.spec_revision_id)
    fail('STALE_TASK_SPEC','Task has not been revalidated for the current accepted specification');
  const custody=await tx.query('SELECT id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 '+
    'AND task_id=$3 AND authority=\'ACTIVE\' FOR SHARE',[input.organisation_id,input.run_id,input.task_id]);
  if(custody.rows.length)fail('ACTIVE_SUBMISSION_CUSTODY','An admitted result retains coordinator ownership');
  if(!['PENDING','READY','FAILED','STALE'].includes(task.state))fail('TASK_NOT_ELIGIBLE','Task is not eligible for a new compute attempt');
  const active=await tx.query<{lease_expires_at:string}>('SELECT lease_expires_at FROM hyperfide.attempts '+
    'WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND compute_authority=\'CURRENT\' FOR UPDATE',
    [input.organisation_id,input.run_id,input.task_id]);
  // Even expired compute needs reconciled quiescence before its slot/reservations can be replaced.
  if(active.rows.length)fail('RECONCILIATION_REQUIRED','Existing compute authority must be explicitly reconciled');
  const scopeOwners=await tx.query<{id:string;definition:unknown}>(
    'SELECT t.id,t.definition FROM hyperfide.attempts a JOIN hyperfide.tasks t ON '+
    't.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id '+
    'WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.compute_authority=\'CURRENT\'',
    [input.organisation_id,input.run_id]);
  if(scopeOwners.rows.some(owner=>declaredScopes(owner.definition).some(other=>paths.some(path=>overlap(path,other)))))
    fail('WRITE_SCOPE_CONFLICT','Another current task owns overlapping declared write scope');
  const predecessors=await tx.query<{milestone:string;state:string;id:string;current_custody_id:string|null;predecessor_run_id:string}>(
    'SELECT d.milestone,d.predecessor_run_id,t.id,t.state,t.current_custody_id FROM hyperfide.task_dependencies d '+
    'JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.predecessor_run_id AND t.id=d.predecessor_task_id '+
    'WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.task_id=$3 ORDER BY t.run_id,t.id FOR SHARE OF t',
    [input.organisation_id,input.run_id,input.task_id]);
  for(const predecessor of predecessors.rows){
    if(predecessor.milestone==='RELEASED')fail('RELEASE_BARRIER_UNAVAILABLE','Programme release evidence is required before this dependency can open');
    if(predecessor.milestone==='QUALIFIED'){
      const evidence=await tx.query('SELECT c.id FROM hyperfide.submission_custodies c WHERE organisation_id=$1 AND run_id=$2 '+
        'AND task_id=$3 AND id=$4 AND qualification_outcome=\'PASS\' AND authority=\'ACTIVE\'',
        [input.organisation_id,predecessor.predecessor_run_id,predecessor.id,predecessor.current_custody_id]);
      if(!['QUALIFIED','INTEGRATING','INTEGRATED'].includes(predecessor.state)||!evidence.rows.length)
        fail('DEPENDENCY_NOT_QUALIFIED','A dependency lacks current admitted qualification');
    }else{
      const publication=await tx.query('SELECT p.id FROM hyperfide.publication_operations p JOIN hyperfide.integration_candidates c ON '+
        'c.organisation_id=p.organisation_id AND c.run_id=p.run_id AND c.id=p.candidate_id '+
        'WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.task_id=$3 AND p.state=\'PUBLISHED\'',
        [input.organisation_id,predecessor.predecessor_run_id,predecessor.id]);
      if(predecessor.state!=='INTEGRATED'||!publication.rows.length)
        fail('DEPENDENCY_NOT_INTEGRATED','A dependency lacks a confirmed publication receipt');
    }
  }
  const wave=await tx.query('SELECT id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND wave<$3 '+
    'AND state NOT IN (\'QUALIFIED\',\'INTEGRATED\') LIMIT 1',
    [input.organisation_id,input.run_id,task.wave]);
  if(wave.rows.length)fail('WAVE_BARRIER_CLOSED','An earlier wave has not completed required qualification');
  const now=await tx.query<{expires_at:string}>('SELECT (clock_timestamp()+$1::integer*interval\'1 millisecond\')::text AS expires_at',[input.lease_ms]);
  const expires=now.rows[0]!.expires_at,attempt_id=input.attempt_id,generation=(BigInt(task.generation)+1n).toString();
  if(generation!==input.attempt_generation)fail('STALE_ATTEMPT_GENERATION','Prospective packet generation is not the next task generation');
  await tx.query('INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,'+
    'execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,\'RESERVED\',\'CURRENT\',$8,$9,$10,$11)',
    [input.organisation_id,input.run_id,attempt_id,input.task_id,generation,input.authority_epoch,input.input_packet_digest,
      input.sandbox_id,input.slot_id,input.sandbox_boot_generation,expires]);
  const reservations=await reserveCapacity(tx,{organisation_id:input.organisation_id,run_id:input.run_id,request_id:input.request_id,attempt_id,dimensions:input.capacity,expires_at:expires});
  await tx.query('INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,'+
    'sandbox_boot_generation,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [input.organisation_id,input.run_id,randomUUID(),attempt_id,generation,input.authority_epoch,input.sandbox_boot_generation,expires]);
  await tx.query('INSERT INTO hyperfide.slot_allocations(organisation_id,run_id,id,slot_id,sandbox_id,sandbox_boot_generation,'+
    'attempt_id,attempt_generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [input.organisation_id,input.run_id,randomUUID(),input.slot_id,input.sandbox_id,input.sandbox_boot_generation,attempt_id,generation]);
  await tx.query('UPDATE hyperfide.worker_slots SET state=\'ALLOCATED\',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',
    [input.organisation_id,input.slot_id]);
  await tx.query('UPDATE hyperfide.tasks SET generation=$4,current_attempt_id=$5,state=\'RESERVED\',state_version=state_version+1 '+
    'WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[input.organisation_id,input.run_id,input.task_id,generation,attempt_id]);
  const token:ComputeToken={organisation_id:input.organisation_id,run_id:input.run_id,task_id:input.task_id,
    attempt_id,attempt_generation:generation,authority_epoch:input.authority_epoch,sandbox_id:input.sandbox_id,
    slot_id:input.slot_id,sandbox_boot_generation:input.sandbox_boot_generation};
  const result={token,lease_expires_at:expires,reservations};
  await enqueue(tx,{organisation_id:input.organisation_id,run_id:input.run_id,id:randomUUID(),aggregate_type:'scheduler-claim',aggregate_id:input.request_id,aggregate_version:'1',
    event_type:'scheduler.dispatch.requested',payload:{token,request_id:input.request_id,input_packet_digest:input.input_packet_digest}},recipients);
  await recordOutcome(tx,input,actor.session_id,'scheduler.claim',input.request_id,input,result);
  return result;
}
export function createComponent(context:ComponentContext):Component{
  return {apiVersion:1,capabilities:{'scheduler.claims.v1':Object.freeze({claimTask,reserveCapacity,requireSchedulerAuthority})},actions:{
    'scheduler.claim':async (value,context)=>{
      const input=parseClaim(value),actor=actorFor(context,input,object(value));
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal,guard:tx=>invocationFor(context).guard(tx)},
        tx=>claimTask(tx,input,actor,dispatchRecipients(context)));
    }
  }};
}
