import {createHash,randomUUID,createPublicKey,verify} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import type {PrimaryTransaction,TransactionGateway} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {requireAuthority} from '../hierarchy/packages.js';
import {enqueue,lockRun} from '../events/outbox.js';
import {loadExecutionPacket,loadPreparationIntent,validateExecutionInputs} from '../hierarchy/packets.js';
import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';


export type ExecutionMode='ACTIVE'|'PAUSE'|'DRAIN'|'STOP';
export interface ExecutionControl {
 scope_kind:'RUN'|'PACKAGE'|'ATTEMPT'|'SANDBOX';scope_id:string;mode:ExecutionMode;operation_id:string;reason:string;expected_generation?:string;resume?:boolean;deadline_at?:string;fallback_mode?:'PAUSE'|'STOP';
}
export async function applyExecutionControl(tx:PrimaryTransaction,scope:SchedulerScope,input:ExecutionControl):Promise<unknown>{
 assertPrimaryTransaction(tx);
 if(!['RUN','PACKAGE','ATTEMPT','SANDBOX'].includes(input.scope_kind)||!['ACTIVE','PAUSE','DRAIN','STOP'].includes(input.mode))
  fail('INVALID_REQUEST','Execution control scope or mode is invalid');
 uuid(input.scope_id,'scope_id');uuid(input.operation_id,'operation_id');
 if(input.mode==='DRAIN'&&(typeof input.deadline_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(input.deadline_at)||!['PAUSE','STOP'].includes(input.fallback_mode??'')))fail('DRAIN_POLICY_REQUIRED','Drain requires an absolute UTC deadline and PAUSE or STOP fallback');
 if(input.mode!=='DRAIN'&&(input.deadline_at!==undefined||input.fallback_mode!==undefined))fail('INVALID_REQUEST','Only drain controls accept deadline and fallback');
 if(typeof input.reason!=='string'||input.reason.length<1||input.reason.length>4096)fail('INVALID_REQUEST','A bounded control reason is required');
 await lockRun(tx,scope,'exclusive');
 const prior=await tx.query<{request_digest:string;control_id:string;generation:string;mode:string}>(
  'SELECT request_digest,control_id,generation,mode FROM hyperfide.execution_control_history WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',
  [scope.organisation_id,scope.run_id,input.operation_id]);
 const hash=requestDigest(input);
 if(prior.rows[0]){
  if(prior.rows[0].request_digest!==hash)fail('IDEMPOTENCY_CONFLICT','Control operation identity has different input');
  return {control_id:prior.rows[0].control_id,generation:prior.rows[0].generation,mode:prior.rows[0].mode,replayed:true};
 }
 if(input.scope_kind==='RUN'&&input.scope_id!==scope.run_id)fail('RUN_SCOPE_DENIED','Run control must target this run');
 if(input.scope_kind==='SANDBOX'){
  const binding=await tx.query('SELECT id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 LIMIT 1',
   [scope.organisation_id,scope.run_id,input.scope_id]);
  if(!binding.rows.length)fail('RUN_SCOPE_DENIED','Sandbox is not bound to this run');
 }
 const current=await tx.query<{id:string;generation:string;mode:ExecutionMode}>(
  "SELECT id,generation,CASE WHEN mode='DRAIN' AND deadline_at<=clock_timestamp() THEN fallback_mode ELSE mode END AS mode FROM hyperfide.execution_controls WHERE organisation_id=$1 AND run_id=$2 AND scope_kind=$3 AND scope_id=$4 FOR UPDATE",
  [scope.organisation_id,scope.run_id,input.scope_kind,input.scope_id]);
 const old=current.rows[0];
 if(input.expected_generation!==undefined&&decimal(input.expected_generation,'expected_generation')!==old?.generation)fail('STALE_CONTROL_GENERATION','Control changed before this transition');
 const strength={ACTIVE:0,DRAIN:1,PAUSE:2,STOP:3};
 if(old&&strength[input.mode]<strength[old.mode]&&(input.resume!==true||input.expected_generation!==old.generation))fail('RESUME_REVALIDATION_REQUIRED','Weakening an execution hold requires explicit verified resume and current generation');
 const id=current.rows[0]?.id??randomUUID(),generation=(BigInt(current.rows[0]?.generation??'0')+1n).toString();
 if(current.rows.length)await tx.query('UPDATE hyperfide.execution_controls SET mode=$4,generation=$5,deadline_at=$6,fallback_mode=$7,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
  [scope.organisation_id,scope.run_id,id,input.mode,generation,input.deadline_at??null,input.fallback_mode??null]);
 else await tx.query('INSERT INTO hyperfide.execution_controls(organisation_id,run_id,id,scope_kind,scope_id,mode,package_id,attempt_id,sandbox_id,deadline_at,fallback_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
  [scope.organisation_id,scope.run_id,id,input.scope_kind,input.scope_id,input.mode,input.scope_kind==='PACKAGE'?input.scope_id:null,input.scope_kind==='ATTEMPT'?input.scope_id:null,input.scope_kind==='SANDBOX'?input.scope_id:null,input.deadline_at??null,input.fallback_mode??null]);
 await tx.query('INSERT INTO hyperfide.execution_control_history(organisation_id,run_id,operation_id,control_id,generation,request_digest,mode,reason,deadline_at,fallback_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [scope.organisation_id,scope.run_id,input.operation_id,id,generation,hash,input.mode,input.reason,input.deadline_at??null,input.fallback_mode??null]);
 return {control_id:id,generation,mode:input.mode,replayed:false};
}

export interface ExecutionTarget {
 package_id?:string;attempt_id?:string;sandbox_id?:string;resource_allocation_id?:string;
 qualification_job_id?:string;publication_operation_id?:string;
 operation:'ADMISSION'|'RENEWAL'|'CHECKPOINT'|'ADVANCE'|'CLEANUP';
}
async function admissionTimes(tx:PrimaryTransaction,scope:SchedulerScope,target:ExecutionTarget):Promise<string[]>{
 const sources=[
  ['attempt_id','attempts',""],
  ['resource_allocation_id','resource_job_allocations'," AND state='ACTIVE'"],
  ['qualification_job_id','qualification_jobs'," AND state='RUNNING'"],
  ['publication_operation_id','publication_operations',""]
 ] as const;
 const result:string[]=[];
 for(const [key,table,predicate] of sources){
  const id=target[key];if(id===undefined)continue;
  const row=await tx.query<{admitted_at:string}>('SELECT created_at::text AS admitted_at FROM hyperfide.'+table+' WHERE organisation_id=$1 AND run_id=$2 AND id=$3'+predicate+' FOR SHARE',[scope.organisation_id,scope.run_id,id]);
  if(!row.rows[0])fail('EXECUTION_CONTINUATION_UNPROVEN','Continuation requires its actual persisted admission in the authenticated run');
  result.push(row.rows[0].admitted_at);
 }
 return result;
}
export async function assertNoExecutionHold(tx:PrimaryTransaction,scope:SchedulerScope,target:ExecutionTarget):Promise<void>{
 assertPrimaryTransaction(tx);
 fields(target,['operation'],['package_id','attempt_id','sandbox_id','resource_allocation_id','qualification_job_id','publication_operation_id']);
 if(!['ADMISSION','RENEWAL','CHECKPOINT','ADVANCE','CLEANUP'].includes(target.operation))fail('INVALID_REQUEST','Unknown execution validation class');
 for(const key of ['package_id','attempt_id','sandbox_id','resource_allocation_id','qualification_job_id','publication_operation_id'] as const)if(target[key]!==undefined)uuid(target[key],key);
 if(target.operation==='CLEANUP')return;
 await lockRun(tx,scope);
 const currentRun=await tx.query<{state:string}>('SELECT state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,scope.run_id]);
 const rows=await tx.query<{scope_kind:string;declared_mode:ExecutionMode;mode:ExecutionMode;effective_at:string|null}>(
  "SELECT c.scope_kind,c.mode AS declared_mode,CASE WHEN c.mode='DRAIN' AND c.deadline_at<=clock_timestamp() THEN c.fallback_mode ELSE c.mode END AS mode,h.created_at::text AS effective_at FROM hyperfide.execution_controls c LEFT JOIN hyperfide.execution_control_history h ON h.organisation_id=c.organisation_id AND h.run_id=c.run_id AND h.control_id=c.id AND h.generation=c.generation WHERE c.organisation_id=$1 AND c.run_id=$2 AND "+
  "((c.scope_kind='RUN' AND c.scope_id=$2) OR (c.scope_kind='PACKAGE' AND c.package_id=$3) OR (c.scope_kind='ATTEMPT' AND c.attempt_id=$4) OR (c.scope_kind='SANDBOX' AND c.sandbox_id=$5)) FOR SHARE OF c",
  [scope.organisation_id,scope.run_id,target.package_id??null,target.attempt_id??null,target.sandbox_id??null]);
 if(currentRun.rows[0]?.state==='DRAINING'&&!rows.rows.some(row=>row.scope_kind==='RUN'&&row.declared_mode==='DRAIN'))fail('EXECUTION_CONTINUATION_UNPROVEN','Draining run requires its persisted run drain policy');
 let admissions:string[]|undefined;
 for(const hold of rows.rows){
  if(hold.mode==='STOP'||hold.mode==='PAUSE'&&!['RENEWAL','CHECKPOINT'].includes(target.operation)||hold.mode==='DRAIN'&&target.operation==='ADMISSION')
   fail('EXECUTION_HELD',hold.scope_kind+' execution control '+hold.mode+' forbids '+target.operation);
  if(hold.mode==='DRAIN'){
   admissions??=await admissionTimes(tx,scope,target);
   if(!admissions.length||!hold.effective_at)fail('EXECUTION_CONTINUATION_UNPROVEN','Drain continuation requires actual pre-drain admission and immutable control history');
   for(const admitted of admissions){
    const ordering=await tx.query<{allowed:boolean}>('SELECT $1::timestamptz<=$2::timestamptz AS allowed',[admitted,hold.effective_at]);
    if(!ordering.rows[0]?.allowed)fail('EXECUTION_CONTINUATION_UNPROVEN','Work admitted after the drain cannot continue');
   }
  }
 }
}
export async function assertExecutionContinuation(tx:PrimaryTransaction,scope:SchedulerScope,target:ExecutionTarget):Promise<void>{
 assertPrimaryTransaction(tx);
 if(!['ADVANCE','RENEWAL','CHECKPOINT'].includes(target.operation))fail('INVALID_REQUEST','Continuation cannot grant new admission or cleanup authority');
 if(!(await admissionTimes(tx,scope,target)).length)fail('EXECUTION_CONTINUATION_UNPROVEN','A persisted admission selector is required');
 await assertNoExecutionHold(tx,scope,target);
}


export interface PacketResourceRequirements {
 agent_sessions:1;cpu_millis:number;memory_bytes:string;disk_bytes:string;build_slots:number;test_slots:number;max_descendants:number;exclusive_services?:string[];
}
export function packetResources(value:unknown):PacketResourceRequirements {
 const item=fields(value,['agent_sessions','cpu_millis','memory_bytes','disk_bytes','build_slots','test_slots','max_descendants']);
 if(item.agent_sessions!==1)fail('RESOURCE_POLICY_INVALID','Accepted worker policy must reserve one agent session');
 return {agent_sessions:1,cpu_millis:boundedInteger(item.cpu_millis,'cpu_millis',1,1000000000),
 memory_bytes:decimal(item.memory_bytes,'memory_bytes'),disk_bytes:decimal(item.disk_bytes,'disk_bytes'),
 build_slots:boundedInteger(item.build_slots,'build_slots',0,1000000),test_slots:boundedInteger(item.test_slots,'test_slots',0,1000000),
 max_descendants:boundedInteger(item.max_descendants,'max_descendants',0,1000000)};
}

export function packetPolicyResources(packet:unknown):PacketResourceRequirements {
 const mandatory=object(object(packet).mandatory),requirements=packetResources(mandatory.resource_requirements);
 const definition=object(object(mandatory.intent).definition);
 const section=definition.section&&typeof definition.section==='object'?object(definition.section):undefined;
 const values=section?.fields&&typeof section.fields==='object'?object(section.fields):undefined;
 const entry=values?.exclusive_services&&typeof values.exclusive_services==='object'?object(values.exclusive_services):undefined;
 let declared=definition.exclusive_services??entry?.value;
 if(declared===undefined)return requirements;
 if(typeof declared==='string'){try{declared=JSON.parse(declared);}catch{fail('RESOURCE_POLICY_INVALID','Exclusive service policy must be an accepted JSON list');}}
 if(!Array.isArray(declared)||declared.length>64||declared.some(key=>typeof key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)))
  fail('RESOURCE_POLICY_INVALID','Exclusive services require bounded stable names');
 return {...requirements,exclusive_services:[...new Set(declared as string[])].sort()};
}

export async function approvedDimensions(tx:PrimaryTransaction,scope:SchedulerScope,pool_id:string,
 requirements:PacketResourceRequirements,job_class:string='AGENT',warm_spare=false,physical_preparation=false):Promise<CapacityDimension[]> {
 assertPrimaryTransaction(tx);
 const required:Record<string,string>={CPU_MILLIS:String(requirements.cpu_millis),MEMORY_BYTES:requirements.memory_bytes,DISK_BYTES:requirements.disk_bytes};
 if(job_class==='AGENT'){
  required.AGENT='1';
  // BUILD and TEST are admitted separately when a job actually needs them.
 }else{
  if(!['BUILD','TEST','REVIEW','INDEX','INTEGRATION','PREPARATION','EXCLUSIVE_SERVICE'].includes(job_class))fail('RESOURCE_POLICY_MISSING','Job has no accepted resource policy');
  if(job_class==='BUILD'&&!requirements.build_slots||job_class==='TEST'&&!requirements.test_slots)
   fail('RESOURCE_POLICY_DENIED','Accepted task does not allow this resource class');
  if(job_class!=='EXCLUSIVE_SERVICE')required[job_class]='1';
  else if(!requirements.exclusive_services?.length)fail('RESOURCE_POLICY_DENIED','Task declares no exclusive services');
  if(physical_preparation)required.SANDBOX='1';
 }
 if(warm_spare)required.WARM_SPARE='1';
 const classes=Object.keys(required).map(dimension=>physical_preparation&&['SANDBOX','CPU_MILLIS','MEMORY_BYTES','DISK_BYTES'].includes(dimension)?'PHYSICAL':'EXECUTION');
 const accounts=await tx.query<{id:string;dimension:string;capacity_class:string;qualification_state:string}>(
  'SELECT id,dimension,capacity_class,qualification_state FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 AND resource_key=$3 AND (dimension,capacity_class) IN (SELECT unnest($4::text[]),unnest($5::text[])) ORDER BY id FOR SHARE',
  [scope.organisation_id,pool_id,'',Object.keys(required),classes]);
 if(accounts.rows.length!==Object.keys(required).length||accounts.rows.some(row=>row.qualification_state!=='QUALIFIED'))
  fail('CAPACITY_POLICY_UNQUALIFIED','Every required resource dimension needs a qualified account in this pool');
 const result=accounts.rows.map(row=>({capacity_account_id:row.id,quantity:required[row.dimension]!}));
 if(requirements.exclusive_services?.length){
  const named=await tx.query<{id:string;resource_key:string;qualification_state:string}>(
   "SELECT id,resource_key,qualification_state FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 AND capacity_class='EXCLUSIVE' AND dimension='EXCLUSIVE_SERVICE' AND resource_key=ANY($3::text[]) ORDER BY id FOR SHARE",
   [scope.organisation_id,pool_id,requirements.exclusive_services]);
  if(named.rows.length!==requirements.exclusive_services.length||named.rows.some(row=>row.qualification_state!=='QUALIFIED'))fail('CAPACITY_POLICY_UNQUALIFIED','Named exclusive services require qualified accounts');
  result.push(...named.rows.map(row=>({capacity_account_id:row.id,quantity:'1'})));
 }
 return result.sort((a,b)=>a.capacity_account_id.localeCompare(b.capacity_account_id));
}

export async function approvedPhysicalDimensions(tx:PrimaryTransaction,scope:SchedulerScope,pool_id:string,resources:unknown,warm_spare=false):Promise<CapacityDimension[]>{
 assertPrimaryTransaction(tx);const input=object(resources);
 const required:Record<string,string>={SANDBOX:'1',CPU_MILLIS:String(boundedInteger(input.cpu_millis,'profile cpu_millis',1,Number.MAX_SAFE_INTEGER)),MEMORY_BYTES:decimal(input.memory_bytes,'profile memory_bytes'),DISK_BYTES:decimal(input.disk_bytes,'profile disk_bytes',true)};
 const accounts=await tx.query<{id:string;dimension:string;qualification_state:string}>("SELECT id,dimension,qualification_state FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 AND capacity_class='PHYSICAL' AND resource_key='' AND dimension=ANY($3::text[]) ORDER BY id",[scope.organisation_id,pool_id,Object.keys(required)]);
 if(accounts.rows.length!==4||accounts.rows.some(row=>row.qualification_state!=='QUALIFIED'))fail('CAPACITY_POLICY_UNQUALIFIED','Complete provisioned profile resources need qualified physical accounts');
 const result=accounts.rows.map(row=>({capacity_account_id:row.id,quantity:required[row.dimension]!}));
 if(warm_spare){
  const spare=await tx.query<{id:string}>("SELECT id FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 AND capacity_class='EXECUTION' AND dimension='WARM_SPARE' AND resource_key='' AND qualification_state='QUALIFIED'",[scope.organisation_id,pool_id]);
  if(!spare.rows[0])fail('CAPACITY_POLICY_UNQUALIFIED','Warm spare requires an explicit qualified pool budget');
  result.push({capacity_account_id:spare.rows[0].id,quantity:'1'});
 }
 return result.sort((a,b)=>a.capacity_account_id.localeCompare(b.capacity_account_id));
}
export async function requireProofRegistry(tx:PrimaryTransaction,scope:SchedulerScope,task:{
 id:string;spec_revision_id:string;spec_generation:string;criteria_digest:string;
}):Promise<{registry_digest:string;policy:unknown}> {
 const records=await tx.query<{registry_digest:string;policy:unknown;criteria_digest:string;spec_revision_id:string}>(
 'SELECT registry_digest,policy,criteria_digest,spec_revision_id FROM hyperfide.proof_registries WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND spec_generation=$4',
 [scope.organisation_id,scope.run_id,task.id,task.spec_generation]);
 const row=records.rows[0];
 if(!row)fail('PROOF_REGISTRY_MISSING','Accepted immutable proof registry is required before admission');
 if(row.criteria_digest!==task.criteria_digest||row.spec_revision_id!==task.spec_revision_id||requestDigest(row.policy)!==row.registry_digest)
  fail('PROOF_REGISTRY_INVALID','Proof registry does not match the accepted task snapshot');
 return row;
}

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
export function gatewayFor(context:ComponentContext,continuation?:(tx:PrimaryTransaction)=>Promise<unknown>):Pick<TransactionGateway,'withPrimaryTransaction'>{
  const resources=(context as ComponentContext & {resources?:{gateway?:TransactionGateway}}).resources;
  if(!resources?.gateway)fail('DEPENDENCY_UNAVAILABLE','The registered primary transaction gateway is required');
  const gateway=resources.gateway,invocation=invocationFor(context);
  return {withPrimaryTransaction:async <T>(options:Parameters<TransactionGateway['withPrimaryTransaction']>[0],operation:(tx:PrimaryTransaction)=>Promise<T>|T):Promise<T>=>{
   return gateway.withPrimaryTransaction({...options,guard:async tx=>{
    if(['scheduler.compute.cancel','scheduler.compute.expire'].includes(invocation.payload.action))await invocation.identityGuard(tx);
    else if(continuation)await invocation.continuationGuard(tx,async candidate=>{assertPrimaryTransaction(candidate);await continuation(candidate);});
    else await invocation.guard(tx);
    await options.guard?.(tx);
   }},async tx=>{
    const scope={organisation_id:invocation.principal.organisation_id,run_id:invocation.principal.run_id};
    const key=invocation.operation.idempotency_key,name='envelope.'+invocation.payload.action;
    const payload={payload_digest:invocation.operation.payload_digest};
    const replay=await operationReplay(tx,scope,invocation.principal.actor_id,name,key,payload);
    if(replay!==undefined)return replay as T;
    const result=await operation(tx);
    await recordOutcome(tx,scope,invocation.principal.actor_id,name,key,payload,result);
    return result;
   });
  }};
}
export function invocationFor(context:ComponentContext):InvocationContext {
 const invocation=context.invocation;assertInvocation(invocation);return invocation;
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
export function dispatchRecipients(context:ComponentContext,kind:'dispatch'|'native'='dispatch'):{consumer_ids:string[]}{
  const primary=uuid(kind==='native'?context.env.HF_SCHEDULER_NATIVE_CONSUMER_ID:context.env.HF_SCHEDULER_DISPATCH_CONSUMER_ID,'trusted '+kind+' consumer');
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
  const immutable={attempt_id:input.attempt_id??null,dimensions:demand,expires_at:String(input.expires_at)};
  const replay=await operationReplay(tx,input,'scheduler-capacity','scheduler.capacity.reserve',input.request_id,immutable);
  if(replay!==undefined){
    if(!Array.isArray(replay))fail('ACCOUNTING_INCONSISTENT','Capacity replay result is not a reservation vector');
    return replay;
  }
  let selectedPool:string|undefined;
  for(const item of demand){
    const account=await tx.query<{id:string;pool_id:string;dimension:string;configured_limit:string;
      reserved:string;allocated:string;qualification_state:string}>(
      'SELECT * FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=$2 FOR UPDATE',
      [input.organisation_id,item.capacity_account_id]);
    const row=account.rows[0];if(!row)fail('CAPACITY_ACCOUNT_MISSING','A requested capacity account does not exist');
    if(row.dimension.endsWith('_RATE'))fail('RATE_BUDGET_REQUIRES_SCHEDULER','Rate budgets use durable time windows');
    if(selectedPool!==undefined&&selectedPool!==row.pool_id)fail('CAPACITY_SCOPE_INVALID','One reservation request cannot mix provider pools');
    selectedPool=row.pool_id;
    if(row.dimension.endsWith('_RATE'))fail('CAPACITY_RATE_INTERFACE_REQUIRED','Rate credits use the bounded-window reservation interface');
    if(row.qualification_state!=='QUALIFIED')fail('CAPACITY_UNQUALIFIED','Capacity dimension '+row.dimension+' is not qualified');
    const existing=await tx.query<{id:string;quantity:string;state:string;attempt_id:string|null}>(
      'SELECT id,quantity,state,attempt_id FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 '+
      'AND request_id=$3 AND capacity_account_id=$4 FOR UPDATE',
      [input.organisation_id,input.run_id,input.request_id,item.capacity_account_id]);
    if(existing.rows[0]){
      if(existing.rows[0].quantity!==item.quantity||existing.rows[0].state==='RELEASED'||existing.rows[0].attempt_id!==(input.attempt_id??null))
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
  await recordOutcome(tx,input,'scheduler-capacity','scheduler.capacity.reserve',input.request_id,immutable,reserved);
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
export interface ClaimRequest extends SchedulerScope {
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


export async function requireMilestone(tx:PrimaryTransaction,scope:SchedulerScope,task_id:string,
 milestone:'QUALIFIED'|'INTEGRATED'|'RELEASED',pin?:{repository_id:string|null;integration_ref:string|null}):Promise<void>{
 if(milestone==='RELEASED')fail('RELEASE_BARRIER_UNAVAILABLE','Programme release requires an actual release receipt');
 const tasks=await tx.query<{state:string;current_custody_id:string|null;criteria_digest:string}>(
 'SELECT state,current_custody_id,criteria_digest FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
 [scope.organisation_id,scope.run_id,task_id]);
 const task=tasks.rows[0];if(!task)fail('DEPENDENCY_MISSING','Dependency is not an accepted task');
 const published=await tx.query(
 "SELECT p.id FROM hyperfide.publication_operations p JOIN hyperfide.integration_candidates i ON i.organisation_id=p.organisation_id AND i.run_id=p.run_id AND i.id=p.candidate_id "+
 "JOIN hyperfide.branch_authorities b ON b.organisation_id=p.organisation_id AND b.run_id=p.run_id AND b.id=p.branch_authority_id AND b.repository_id=p.repository_id AND b.branch_generation=p.branch_generation "+
 "JOIN hyperfide.submission_custodies c ON c.organisation_id=i.organisation_id AND c.run_id=i.run_id AND "+
 "((c.id=i.custody_id AND c.custody_generation=i.custody_generation) OR EXISTS(SELECT 1 FROM hyperfide.candidate_custodies cc WHERE cc.organisation_id=i.organisation_id AND cc.run_id=i.run_id AND cc.candidate_id=i.id AND cc.custody_id=c.id AND cc.custody_generation=c.custody_generation)) "+
 "WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.task_id=$3 AND c.criteria_digest=$4 AND c.qualification_outcome='PASS' AND p.state='PUBLISHED' "+
 "AND ($5::uuid IS NULL OR p.repository_id=$5) AND ($6::text IS NULL OR b.branch_ref=$6)",
 [scope.organisation_id,scope.run_id,task_id,task.criteria_digest,pin?.repository_id??null,pin?.integration_ref??null]);
 if(task.state==='INTEGRATED'&&published.rows.length)return;
 if(milestone==='INTEGRATED')fail('DEPENDENCY_NOT_INTEGRATED','Dependency lacks confirmed publication of matching qualified custody at the accepted repository/ref');
 const qualified=await tx.query(
 "SELECT id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND id=$4 AND criteria_digest=$5 AND qualification_outcome='PASS' AND authority='ACTIVE' AND ($6::uuid IS NULL OR repository_id=$6)",
 [scope.organisation_id,scope.run_id,task_id,task.current_custody_id,task.criteria_digest,pin?.repository_id??null]);
 if(!['QUALIFIED','INTEGRATING'].includes(task.state)||!qualified.rows.length)
  fail('DEPENDENCY_NOT_QUALIFIED','Dependency lacks current admitted matching qualification');
}
export async function requireTaskBarriers(tx:PrimaryTransaction,scope:SchedulerScope,task_id:string,wave:number):Promise<void>{
 const dependencies=await tx.query<{predecessor_task_id:string;predecessor_run_id:string;milestone:'QUALIFIED'|'INTEGRATED'|'RELEASED';
 binding_schema_version:number;predecessor_spec_generation:string|null;predecessor_spec_revision_id:string|null;predecessor_repository_id:string|null;integration_ref:string|null}>(
 'SELECT d.* FROM hyperfide.task_dependencies d JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.run_id AND t.id=d.task_id AND t.spec_generation=d.revision WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.task_id=$3 ORDER BY predecessor_run_id,predecessor_task_id',
 [scope.organisation_id,scope.run_id,task_id]);
 for(const dependency of dependencies.rows){
  if(dependency.binding_schema_version!==1||!dependency.predecessor_spec_generation||!dependency.predecessor_spec_revision_id)
   fail('DEPENDENCY_BINDING_LEGACY','Unversioned historical dependency edges cannot release work');
  const predecessor=await tx.query<{spec_generation:string;spec_revision_id:string}>(
   'SELECT spec_generation,spec_revision_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
   [scope.organisation_id,dependency.predecessor_run_id,dependency.predecessor_task_id]);
  if(predecessor.rows[0]?.spec_generation!==dependency.predecessor_spec_generation||predecessor.rows[0]?.spec_revision_id!==dependency.predecessor_spec_revision_id)
   fail('DEPENDENCY_BINDING_STALE','Dependency target changed after immutable edge admission');
  if(dependency.milestone==='INTEGRATED'&&(!dependency.predecessor_repository_id||!dependency.integration_ref))
   fail('DEPENDENCY_TARGET_MISSING','Integrated dependency must pin its exact repository and integration ref');
  await requireMilestone(tx,{organisation_id:scope.organisation_id,run_id:dependency.predecessor_run_id},dependency.predecessor_task_id,dependency.milestone,
   {repository_id:dependency.predecessor_repository_id,integration_ref:dependency.integration_ref});
 }
 const previous=await tx.query<{id:string}>('SELECT id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND wave<$3 AND NOT(definition ? $4) ORDER BY wave,id',
 [scope.organisation_id,scope.run_id,wave,'retirement']);
 for(const predecessor of previous.rows)await requireMilestone(tx,scope,predecessor.id,'QUALIFIED');
}

export async function requirePacketAdmission(tx:PrimaryTransaction,input:ClaimRequest,task:{
 id:string;feature_package_id:string;spec_revision_id:string;spec_generation:string;criteria_digest:string;
}):Promise<PacketResourceRequirements>{
 const proof=await requireProofRegistry(tx,input,task);
 const loaded=await validateExecutionInputs(tx,{organisation_id:input.organisation_id,run_id:input.run_id,digest:input.input_packet_digest});
 const packet=object(loaded.packet),mandatory=object(packet.mandatory),identity=object(mandatory.identity),runtime=object(mandatory.runtime),observation=object(packet.observation),intent=object(mandatory.intent);
 const pins={organisation_id:input.organisation_id,run_id:input.run_id,authority_epoch:input.authority_epoch,task_id:input.task_id,
 attempt_id:input.attempt_id,attempt_generation:input.attempt_generation,spec_revision_id:input.spec_revision_id,spec_generation:input.spec_generation,
 package_id:task.feature_package_id,criteria_digest:task.criteria_digest,leader_generation:input.leader_generation};
 if(Object.entries(pins).some(([key,value])=>identity[key]!==value)||observation.run_spec_generation!==input.run_spec_generation||
 runtime.sandbox_id!==input.sandbox_id||runtime.slot_id!==input.slot_id||runtime.sandbox_boot_generation!==input.sandbox_boot_generation||
 intent.registry_digest!==proof.registry_digest||input.package_generation!==undefined&&identity.package_generation!==input.package_generation)
  fail('EXECUTION_PACKET_MISMATCH','Prospective execution packet does not pin this exact admission');
 const prepared=await tx.query<{preparation_digest:string|null}>('SELECT preparation_digest FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2',[input.organisation_id,input.sandbox_id]);
 if(prepared.rows[0]?.preparation_digest!==runtime.preparation_digest)fail('PREPARATION_MISMATCH','Current sandbox preparation differs from the admitted packet');
 return packetPolicyResources(loaded.packet);
}

export async function jobPolicy(tx:PrimaryTransaction,scope:SchedulerScope,task_id:string,operation:'ADMISSION'|'ADVANCE'='ADVANCE'):Promise<PacketResourceRequirements>{
 const tasks=await tx.query<{id:string;feature_package_id:string;spec_revision_id:string;spec_generation:string;criteria_digest:string}>(
 'SELECT id,feature_package_id,spec_revision_id,spec_generation,criteria_digest FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
 [scope.organisation_id,scope.run_id,task_id]);
 const task=tasks.rows[0];if(!task)fail('TASK_MISSING','Job must bind an accepted task');
 const retired=await tx.query("SELECT id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND definition ? 'retirement'",[scope.organisation_id,scope.run_id,task_id]);
 if(retired.rows.length)fail('TASK_RETIRED','Retired accepted intent cannot admit a new resource job');
 await assertNoExecutionHold(tx,scope,{package_id:task.feature_package_id,operation});
 const run=await tx.query<{state:string}>('SELECT state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,scope.run_id]);
 if(!(operation==='ADVANCE'?['READY','RUNNING','DRAINING']:['READY','RUNNING']).includes(run.rows[0]?.state??''))fail('RUN_NOT_ADMITTING','Run state does not allow this resource job');
 await requireProofRegistry(tx,scope,task);
 const accepted=await loadPreparationIntent(tx,{...scope,task_id});
 const definition=await tx.query<{definition:unknown}>('SELECT definition FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,task_id]);
 return packetPolicyResources({mandatory:{resource_requirements:accepted.resource_requirements,intent:{definition:definition.rows[0]!.definition}}});
}
export async function allocateReservations(tx:PrimaryTransaction,input:SchedulerScope&{reservation_ids:string[]}):Promise<void>{
 assertPrimaryTransaction(tx);await lockRun(tx,input);
 const ids=input.reservation_ids.map(id=>uuid(id,'reservation_id'));
 if(!ids.length||ids.length>64||new Set(ids).size!==ids.length)fail('INVALID_REQUEST','Allocate one to 64 distinct reservation identities');
 const accounts=await tx.query<{capacity_account_id:string}>('SELECT DISTINCT capacity_account_id FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY capacity_account_id',
 [input.organisation_id,input.run_id,ids]);
 for(const account of accounts.rows)await tx.query('SELECT id FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[input.organisation_id,account.capacity_account_id]);
 const rows=await tx.query<{id:string;capacity_account_id:string;quantity:string;state:string}>('SELECT id,capacity_account_id,quantity,state FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',[input.organisation_id,input.run_id,ids]);
 if(rows.rows.length!==ids.length)fail('RESERVATION_MISSING','Allocation identity is outside this run');
 for(const row of rows.rows){
  if(row.state==='ALLOCATED')continue;
  if(row.state!=='PROVISIONING')fail('RESERVATION_NOT_ALLOCATABLE','Only admitted provisioning reservations may be allocated');
  const updated=await tx.query('UPDATE hyperfide.capacity_accounts SET reserved=reserved-$3::bigint,allocated=allocated+$3::bigint,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND reserved>=$3::bigint AND qualification_state=$4 RETURNING id',
   [input.organisation_id,row.capacity_account_id,row.quantity,'QUALIFIED']);
  if(updated.rows.length!==1)fail('ACCOUNTING_INCONSISTENT','Qualified reserved capacity does not cover this allocation');
  await tx.query("UPDATE hyperfide.reservations SET state='ALLOCATED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[input.organisation_id,input.run_id,row.id]);
 }
}
export async function assertJobReservation(tx:PrimaryTransaction,input:SchedulerScope&{
 task_id:string;job_kind:string;reservation_id:string;
}):Promise<{request_id:string;pool_id:string;reservations:unknown[];resource_requirements:PacketResourceRequirements;spec_revision_id:string;spec_generation:string;criteria_digest:string;resource_policy_digest:string}>{
 assertPrimaryTransaction(tx);await lockRun(tx,input);
 if(!['BUILD','TEST','REVIEW','INDEX','INTEGRATION','PREPARATION'].includes(input.job_kind))fail('INVALID_REQUEST','Unknown qualified job kind');
 const row=await tx.query<{request_id:string;pool_id:string;spec_revision_id:string;spec_generation:string;criteria_digest:string;resource_policy_digest:string}>(
 "SELECT r.request_id,w.pool_id,w.spec_revision_id,w.spec_generation,w.criteria_digest,w.resource_policy_digest FROM hyperfide.reservations r JOIN hyperfide.resource_waiters w ON w.organisation_id=r.organisation_id AND w.run_id=r.run_id AND w.request_id=r.request_id JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id "+
 "WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.id=$3 AND w.task_id=$4 AND w.job_kind=$5 AND w.state='ADMITTED' AND r.state='ALLOCATED' AND a.dimension=$5 AND a.qualification_state='QUALIFIED'",
 [input.organisation_id,input.run_id,input.reservation_id,input.task_id,input.job_kind]);
 const selected=row.rows[0];if(!selected)fail('JOB_RESERVATION_INVALID','Job requires its own admitted allocated reservation in a qualified account');
 const policy=await jobPolicy(tx,input,input.task_id),expected=await approvedDimensions(tx,input,selected.pool_id,policy,input.job_kind);
 const accepted=await tx.query<{spec_revision_id:string;spec_generation:string;criteria_digest:string}>('SELECT spec_revision_id,spec_generation,criteria_digest FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[input.organisation_id,input.run_id,input.task_id]);
 if(!accepted.rows[0]||['spec_revision_id','spec_generation','criteria_digest'].some(key=>accepted.rows[0]![key as keyof typeof accepted.rows[0]]!==selected[key as 'spec_revision_id'|'spec_generation'|'criteria_digest'])||selected.resource_policy_digest!==requestDigest(policy))
 fail('JOB_POLICY_STALE','Job reservation pins no longer match accepted task intent');

 const reservations=await tx.query<{id:string;capacity_account_id:string;quantity:string;state:string;qualification_state:string;live:boolean}>(
 'SELECT r.id,r.capacity_account_id,r.quantity,r.state,a.qualification_state,r.expires_at>clock_timestamp() AS live FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.request_id=$3 ORDER BY r.capacity_account_id FOR SHARE OF r,a',
 [input.organisation_id,input.run_id,selected.request_id]);
 if(reservations.rows.some(r=>r.state!=='ALLOCATED'||r.qualification_state!=='QUALIFIED'||!r.live)||
 canonical(reservations.rows.map(r=>({capacity_account_id:r.capacity_account_id,quantity:r.quantity})))!==canonical(expected))
  fail('JOB_RESOURCE_VECTOR_INVALID','Full allocated resource vector must equal accepted job policy');
 return {...selected,reservations:reservations.rows,resource_requirements:policy};
}

export async function validateResourceVector(tx:PrimaryTransaction,input:SchedulerScope&{
 pool_id:string;attempt_id:string;dimensions:CapacityDimension[];job_class?:string;
}):Promise<{resource_requirements:PacketResourceRequirements;dimensions:CapacityDimension[]}>{
 const attempts=await tx.query<{input_packet_digest:string}>('SELECT input_packet_digest FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
 [input.organisation_id,input.run_id,input.attempt_id]);
 if(!attempts.rows[0])fail('ATTEMPT_MISSING','Resource policy must bind an accepted attempt');
 const loaded=await loadExecutionPacket(tx,{organisation_id:input.organisation_id,run_id:input.run_id,digest:attempts.rows[0].input_packet_digest});
 const requirements=packetPolicyResources(loaded.packet);
 const expected=await approvedDimensions(tx,input,input.pool_id,requirements,input.job_class??'AGENT');
 if(canonical(expected)!==canonical(dimensions(input.dimensions)))fail('RESOURCE_VECTOR_MISMATCH','Resource vector differs from accepted immutable packet policy');
 return {resource_requirements:requirements,dimensions:expected};
}



export interface JobAllocation extends SchedulerScope {
 allocation_id:string;request_id:string;task_id:string;job_kind:string;reservation_id:string;
 slot_id:string;sandbox_id:string;sandbox_boot_generation:string;assignee_session_id:string;generation:string;
 expires_at:string;primary_now:string;
}
export async function bindJobReservation(tx:PrimaryTransaction,input:SchedulerScope&{
 task_id:string;job_kind:string;reservation_id:string;slot_id:string;sandbox_id:string;
 sandbox_boot_generation:string;assignee_session_id:string;
}):Promise<JobAllocation>{
 assertPrimaryTransaction(tx);await lockRun(tx,input);
 await lockSandboxBudget(tx,input);
 const approved=await assertJobReservation(tx,input);
 const existing=await tx.query<{id:string;slot_id:string;sandbox_id:string;sandbox_boot_generation:string;assignee_session_id:string}>(
 'SELECT id,slot_id,sandbox_id,sandbox_boot_generation,assignee_session_id FROM hyperfide.resource_job_allocations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 FOR UPDATE',
 [input.organisation_id,input.run_id,approved.request_id]);
 if(existing.rows[0]){
  const old=existing.rows[0];
  if(old.slot_id!==input.slot_id||old.sandbox_id!==input.sandbox_id||old.sandbox_boot_generation!==input.sandbox_boot_generation||old.assignee_session_id!==input.assignee_session_id)
   fail('IDEMPOTENCY_CONFLICT','Job resource request already has a different executor binding');
  return readJobAllocation(tx,input);
 }
 const slot=await tx.query<{state:string;capacity_kind:string;pool_id:string;observed_state:string;boot_generation:string}>(
 'SELECT w.state,w.capacity_kind,s.pool_id,s.observed_state,s.boot_generation FROM hyperfide.worker_slots w JOIN hyperfide.sandboxes s ON s.organisation_id=w.organisation_id AND s.id=w.sandbox_id WHERE w.organisation_id=$1 AND w.id=$2 AND w.sandbox_id=$3 AND w.boot_generation=$4 FOR UPDATE OF w',
 [input.organisation_id,input.slot_id,input.sandbox_id,input.sandbox_boot_generation]);
 const current=slot.rows[0];
 if(!current||current.state!=='READY'||(current.capacity_kind!==input.job_kind&&!(input.job_kind==='PREPARATION'&&current.capacity_kind==='TEST'))||current.pool_id!==approved.pool_id||current.observed_state!=='RUNNING'||current.boot_generation!==input.sandbox_boot_generation)
  fail('JOB_SLOT_UNAVAILABLE','Job slot is not a current ready slot of the declared kind in this pool');
 const roles:Record<string,string[]>={BUILD:['WORKER'],TEST:['VERIFIER'],REVIEW:['VERIFIER','COMMIT_WATCHER'],INDEX:['INDEXER'],INTEGRATION:['INTEGRATOR'],PREPARATION:['WORKER','INDEXER','VERIFIER']};
 const assignee=await tx.query<{role:string;state:string;slot_id:string;sandbox_id:string;sandbox_boot_generation:string}>(
 'SELECT role,state,slot_id,sandbox_id,sandbox_boot_generation FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
 [input.organisation_id,input.run_id,input.assignee_session_id]);
 const actor=assignee.rows[0];
 if(!actor||!roles[input.job_kind]?.includes(actor.role)||!['REGISTERED','RUNNING'].includes(actor.state)||actor.slot_id!==input.slot_id||actor.sandbox_id!==input.sandbox_id||actor.sandbox_boot_generation!==input.sandbox_boot_generation)
  fail('JOB_ASSIGNEE_INVALID','Registered job assignee is not bound to this exact executor and role');
 const id=randomUUID();
 await reserveSandboxResources(tx,{...input,request_id:approved.request_id,job_kind:input.job_kind,resources:{cpu_millis:String(approved.resource_requirements.cpu_millis),memory_bytes:approved.resource_requirements.memory_bytes,disk_bytes:approved.resource_requirements.disk_bytes}});
 await tx.query('INSERT INTO hyperfide.resource_job_allocations(organisation_id,run_id,id,request_id,task_id,reservation_id,job_kind,slot_id,sandbox_id,sandbox_boot_generation,assignee_session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
 [input.organisation_id,input.run_id,id,approved.request_id,input.task_id,input.reservation_id,input.job_kind,input.slot_id,input.sandbox_id,input.sandbox_boot_generation,input.assignee_session_id]);
 await tx.query("UPDATE hyperfide.worker_slots SET state='ALLOCATED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[input.organisation_id,input.slot_id]);
 return readJobAllocation(tx,input);
}
export async function readJobAllocation(tx:PrimaryTransaction,input:SchedulerScope&{reservation_id:string}):Promise<JobAllocation>{
 assertPrimaryTransaction(tx);
 const rows=await tx.query<JobAllocation>(
 "SELECT a.organisation_id,a.run_id,a.id AS allocation_id,a.request_id,a.task_id,a.job_kind,a.reservation_id,a.slot_id,a.sandbox_id,a.sandbox_boot_generation,a.assignee_session_id,a.generation,min(r.expires_at)::text AS expires_at,clock_timestamp()::text AS primary_now "+
 "FROM hyperfide.resource_job_allocations a JOIN hyperfide.reservations chosen ON chosen.organisation_id=a.organisation_id AND chosen.run_id=a.run_id AND chosen.request_id=a.request_id AND chosen.id=$3 "+
 "JOIN hyperfide.reservations r ON r.organisation_id=a.organisation_id AND r.run_id=a.run_id AND r.request_id=a.request_id "+
 "JOIN hyperfide.sandboxes s ON s.organisation_id=a.organisation_id AND s.id=a.sandbox_id AND s.boot_generation=a.sandbox_boot_generation AND s.observed_state='RUNNING' JOIN hyperfide.worker_slots w ON w.organisation_id=a.organisation_id AND w.id=a.slot_id AND w.sandbox_id=a.sandbox_id AND w.boot_generation=a.sandbox_boot_generation AND w.state='ALLOCATED' JOIN hyperfide.agent_sessions session ON session.organisation_id=a.organisation_id AND session.run_id=a.run_id AND session.id=a.assignee_session_id AND session.slot_id=a.slot_id AND session.sandbox_id=a.sandbox_id AND session.sandbox_boot_generation=a.sandbox_boot_generation AND session.state IN ('REGISTERED','RUNNING') WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.state='ACTIVE' AND r.state='ALLOCATED' GROUP BY a.organisation_id,a.run_id,a.id HAVING bool_and(r.expires_at>clock_timestamp())",
 [input.organisation_id,input.run_id,input.reservation_id]);
 const row=rows.rows[0];if(!row)fail('JOB_ALLOCATION_INVALID','Job has no current unexpired allocated executor binding');
 await assertJobReservation(tx,{...input,task_id:row.task_id,job_kind:row.job_kind});
 return row;
}


export interface JobLeaseRequest extends SchedulerScope {
 reservation_id:string;allocation_id:string;allocation_generation:string;assignee_session_id:string;
}
export async function renewJobAllocation(tx:PrimaryTransaction,input:JobLeaseRequest&{lease_ms:number}):Promise<{
 allocation_id:string;generation:string;expires_at:string;
}>{
 assertPrimaryTransaction(tx);await lockRun(tx,input);
 await tx.query('SELECT id FROM hyperfide.resource_job_allocations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
 [input.organisation_id,input.run_id,uuid(input.allocation_id,'allocation_id')]);
 const current=await readJobAllocation(tx,input);
 if(current.allocation_id!==input.allocation_id||current.generation!==decimal(input.allocation_generation,'allocation_generation')||current.assignee_session_id!==uuid(input.assignee_session_id,'assignee_session_id'))
  fail('JOB_ALLOCATION_STALE','Job allocation identity or owner changed');
 const duration=boundedInteger(input.lease_ms,'lease_ms',1000,600000);
 const clock=await tx.query<{expires_at:string}>("SELECT (clock_timestamp()+$1::integer*interval'1 millisecond')::text AS expires_at",[duration]);
 const expires=clock.rows[0]!.expires_at;
 const expected=await tx.query<{count:string}>('SELECT count(*)::text AS count FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',
 [input.organisation_id,input.run_id,current.request_id]);
 const updated=await tx.query(
 "UPDATE hyperfide.reservations SET expires_at=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 AND state='ALLOCATED' AND expires_at>clock_timestamp() RETURNING id",
 [input.organisation_id,input.run_id,current.request_id,expires]);
 if(String(updated.rows.length)!==expected.rows[0]!.count)fail('JOB_ALLOCATION_EXPIRED','Expired or revoked capacity cannot be renewed');
 return {allocation_id:current.allocation_id,generation:current.generation,expires_at:expires};
}
export async function releaseJobAllocation(tx:PrimaryTransaction,input:JobLeaseRequest):Promise<unknown>{
 assertPrimaryTransaction(tx);await lockRun(tx,input);
 const found=await tx.query<{id:string;generation:string;assignee_session_id:string;request_id:string;slot_id:string;sandbox_id:string;sandbox_boot_generation:string;state:string}>(
 'SELECT a.* FROM hyperfide.resource_job_allocations a JOIN hyperfide.reservations r ON r.organisation_id=a.organisation_id AND r.run_id=a.run_id AND r.request_id=a.request_id AND r.id=$4 WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 FOR UPDATE OF a',
 [input.organisation_id,input.run_id,input.allocation_id,input.reservation_id]);
 const row=found.rows[0];
 if(!row||row.generation!==decimal(input.allocation_generation,'allocation_generation')||row.assignee_session_id!==uuid(input.assignee_session_id,'assignee_session_id'))
  fail('JOB_ALLOCATION_STALE','Cleanup must identify the exact job allocation and assignee');
 if(row.state!=='ACTIVE')return {allocation_id:row.id,state:row.state,resources_still_counted:row.state!=='RELEASED',replayed:true};
 await markSandboxReleasePending(tx,{organisation_id:input.organisation_id,run_id:input.run_id,request_id:row.request_id});
 await tx.query("UPDATE hyperfide.resource_job_allocations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[input.organisation_id,input.run_id,row.id]);
 await tx.query("UPDATE hyperfide.reservations r SET state='RELEASE_PENDING',state_version=r.state_version+1 FROM hyperfide.capacity_accounts c WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.request_id=$3 AND r.state IN ('PROVISIONING','ALLOCATED') AND c.organisation_id=r.organisation_id AND c.id=r.capacity_account_id AND c.capacity_class<>'PHYSICAL'",[input.organisation_id,input.run_id,row.request_id]);
 await tx.query("UPDATE hyperfide.worker_slots SET state='DRAINING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND sandbox_id=$3 AND boot_generation=$4 AND state='ALLOCATED'",[input.organisation_id,row.slot_id,row.sandbox_id,row.sandbox_boot_generation]);
 return {allocation_id:row.id,state:'RELEASE_PENDING',resources_still_counted:true,replayed:false};
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
  await assertNoExecutionHold(tx,input,{package_id:candidate.rows[0].feature_package_id,sandbox_id:input.sandbox_id,operation:'ADMISSION'});
  const replay=await operationReplay(tx,input,actor.session_id,'scheduler.claim',input.request_id,input);
  if(replay!==undefined)return replay;
  const paths=declaredScopes(candidate.rows[0].definition);
  await lockScopes(tx,input,paths);
  const poolObservation=await tx.query<{pool_id:string}>('SELECT pool_id FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2',[input.organisation_id,input.sandbox_id]);
  const pool=poolObservation.rows[0]?.pool_id;if(!pool)fail('SLOT_UNAVAILABLE','Sandbox is not registered');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.organisation_id+':'+pool+':resource-admission']);
  const scheduling=await tx.query('SELECT pool_id FROM hyperfide.scheduling_policies WHERE organisation_id=$1 AND pool_id=$2 FOR SHARE',[input.organisation_id,pool]);
  if(!scheduling.rows.length)fail('SCHEDULING_POLICY_MISSING','Claim needs an explicit scheduling policy');
  const head=await tx.query<{request_id:string;run_id:string}>("SELECT w.request_id,w.run_id FROM hyperfide.resource_waiters w JOIN hyperfide.runs r ON r.organisation_id=w.organisation_id AND r.id=w.run_id JOIN hyperfide.scheduling_policies p ON p.organisation_id=w.organisation_id AND p.pool_id=w.pool_id WHERE w.organisation_id=$1 AND w.pool_id=$2 AND w.state='WAITING' AND w.deadline_at>clock_timestamp() AND r.state IN ('READY','RUNNING') ORDER BY CASE WHEN extract(epoch FROM(clock_timestamp()-w.enqueued_at))>=p.max_bypass_seconds THEN 1 ELSE 0 END DESC,CASE WHEN extract(epoch FROM(clock_timestamp()-w.enqueued_at))>=p.max_bypass_seconds THEN w.enqueued_at END,w.priority+floor(extract(epoch FROM(clock_timestamp()-w.enqueued_at))/p.aging_seconds) DESC,w.enqueued_at,w.id LIMIT 1",[input.organisation_id,pool]);
  if(head.rows[0]&&(head.rows[0].request_id!==input.request_id||head.rows[0].run_id!==input.run_id))fail('FAIRNESS_WAIT','An earlier eligible resource waiter must be admitted first');
  // Capacity accounts lock before slot/task locks, consistently across every claim.
  for(const item of input.capacity){
    const row=await tx.query<{pool_id:string;dimension:string}>(
      'SELECT pool_id,dimension FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=$2 FOR UPDATE',
      [input.organisation_id,item.capacity_account_id]);
    if(!row.rows[0])fail('CAPACITY_ACCOUNT_MISSING','A requested capacity account does not exist');
  }
  await lockSandboxBudget(tx,input);
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
    id:string;feature_package_id:string;criteria_digest:string;current_attempt_id:string|null;current_custody_id:string|null}>(
    'SELECT * FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',
    [input.organisation_id,input.run_id,input.task_id]);
  const task=taskResult.rows[0]!;
  if(task.spec_generation!==input.spec_generation||task.spec_revision_id!==input.spec_revision_id)
    fail('STALE_TASK_SPEC','Task has not been revalidated for the current accepted specification');
  await assertNoExecutionHold(tx,input,{package_id:task.feature_package_id,...(task.current_attempt_id?{attempt_id:task.current_attempt_id}:{}),sandbox_id:input.sandbox_id,operation:'ADMISSION'});
  const custody=await tx.query('SELECT id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 '+
    'AND task_id=$3 AND authority=\'ACTIVE\' FOR SHARE',[input.organisation_id,input.run_id,input.task_id]);
  if(custody.rows.length)fail('ACTIVE_SUBMISSION_CUSTODY','An admitted result retains coordinator ownership');
  if(object(candidate.rows[0].definition).retirement!==undefined)fail('TASK_RETIRED','Retired accepted history cannot be claimed');
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
  await requireTaskBarriers(tx,input,input.task_id,task.wave);
  const policy=await requirePacketAdmission(tx,input,task);
  const expected=await approvedDimensions(tx,input,selected.pool_id,policy);
  if(canonical(expected)!==canonical(input.capacity))fail('RESOURCE_VECTOR_MISMATCH','Claim resource vector must equal the accepted immutable packet policy');
  const now=await tx.query<{expires_at:string}>('SELECT (clock_timestamp()+$1::integer*interval\'1 millisecond\')::text AS expires_at',[input.lease_ms]);
  const expires=now.rows[0]!.expires_at,attempt_id=input.attempt_id,generation=(BigInt(task.generation)+1n).toString();
  if(generation!==input.attempt_generation)fail('STALE_ATTEMPT_GENERATION','Prospective packet generation is not the next task generation');
  await tx.query('INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,'+
    'execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation,lease_expires_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,\'RESERVED\',\'CURRENT\',$8,$9,$10,$11)',
    [input.organisation_id,input.run_id,attempt_id,input.task_id,generation,input.authority_epoch,input.input_packet_digest,
      input.sandbox_id,input.slot_id,input.sandbox_boot_generation,expires]);
  const reservations=await reserveCapacity(tx,{organisation_id:input.organisation_id,run_id:input.run_id,request_id:input.request_id,attempt_id,dimensions:input.capacity,expires_at:expires});
  await allocateReservations(tx,{organisation_id:input.organisation_id,run_id:input.run_id,reservation_ids:reservations.map(row=>uuid(object(row).id,'reservation_id'))});
  await reserveSandboxResources(tx,{...input,job_kind:'AGENT',resources:{cpu_millis:String(policy.cpu_millis),memory_bytes:policy.memory_bytes,disk_bytes:policy.disk_bytes}});
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
  const allocated=await tx.query('SELECT id,capacity_account_id,quantity,state,accounting_bucket FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 ORDER BY capacity_account_id',[input.organisation_id,input.run_id,input.request_id]);
  const result={token,lease_expires_at:expires,reservations:allocated.rows};
  await enqueue(tx,{organisation_id:input.organisation_id,run_id:input.run_id,id:randomUUID(),aggregate_type:'scheduler-claim',aggregate_id:input.request_id,aggregate_version:'1',
    event_type:'scheduler.dispatch.requested',payload:{token,request_id:input.request_id,input_packet_digest:input.input_packet_digest}},recipients);
  await recordOutcome(tx,input,actor.session_id,'scheduler.claim',input.request_id,input,result);
  return result;
}

export interface SandboxResourceVector {cpu_millis:string;memory_bytes:string;disk_bytes:string}
export interface SandboxExecutor extends SchedulerScope {sandbox_id:string;sandbox_boot_generation:string;slot_id:string}
export interface SandboxBudgetQualification {
 organisation_id:string;sandbox_id:string;sandbox_boot_generation:string;qualification_id:string;evidence_digest:string;
 source:'PROVIDER_OBSERVATION'|'OPERATOR_FIXED';hard_limits:SandboxResourceVector;headroom:SandboxResourceVector;
}
function sandboxVector(value:SandboxResourceVector,headroom=false):SandboxResourceVector{
 const row=fields(value,['cpu_millis','memory_bytes','disk_bytes']);
 return {cpu_millis:decimal(row.cpu_millis,'cpu_millis',headroom),memory_bytes:decimal(row.memory_bytes,'memory_bytes',headroom),disk_bytes:decimal(row.disk_bytes,'disk_bytes',true)};
}
/** Trusted producer seam. Callers must retain an actual measured or operator-qualified
 * fixed envelope; a requested provider size or nominal profile is not evidence. */
export async function qualifySandboxBudget(tx:PrimaryTransaction,input:SandboxBudgetQualification):Promise<unknown>{
 assertPrimaryTransaction(tx);uuid(input.organisation_id,'organisation_id');uuid(input.sandbox_id,'sandbox_id');
 decimal(input.sandbox_boot_generation,'sandbox_boot_generation');uuid(input.qualification_id,'qualification_id');digest(input.evidence_digest,'evidence_digest');
 if(!['PROVIDER_OBSERVATION','OPERATOR_FIXED'].includes(input.source))fail('SANDBOX_BUDGET_UNQUALIFIED','An actual trusted hard-limit qualification is required');
 const hard=sandboxVector(input.hard_limits),headroom=sandboxVector(input.headroom,true);
 for(const name of ['cpu_millis','memory_bytes','disk_bytes'] as const)
  if(BigInt(headroom[name])>BigInt(hard[name])||(name!=='disk_bytes'&&headroom[name]===hard[name]))fail('SANDBOX_HEADROOM_INVALID','Reserved headroom must leave usable capacity');
 const boot=await tx.query<{boot_generation:string}>('SELECT boot_generation FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 FOR SHARE',[input.organisation_id,input.sandbox_id]);
 if(boot.rows[0]?.boot_generation!==input.sandbox_boot_generation)fail('STALE_SANDBOX_BOOT','Budget qualification must bind the observed current boot');
 const old=await tx.query('SELECT * FROM hyperfide.sandbox_execution_budgets WHERE organisation_id=$1 AND sandbox_id=$2 AND sandbox_boot_generation=$3 FOR UPDATE',[input.organisation_id,input.sandbox_id,input.sandbox_boot_generation]);
 if(old.rows[0]){
  const row=old.rows[0];
  if(row.qualification_id!==input.qualification_id||row.evidence_digest!==input.evidence_digest||row.qualification_source!==input.source||
   Object.keys(hard).some(k=>row['hard_'+k]!==hard[k as keyof SandboxResourceVector]||row['headroom_'+k]!==headroom[k as keyof SandboxResourceVector]))
   fail('SANDBOX_BUDGET_CONFLICT','A boot hard-limit qualification is immutable; reconcile an actual changed resource envelope explicitly');
  return {qualified:true,replayed:true};
 }
 await tx.query('INSERT INTO hyperfide.sandbox_execution_budgets(organisation_id,sandbox_id,sandbox_boot_generation,qualification_id,evidence_digest,qualification_source,hard_cpu_millis,hard_memory_bytes,hard_disk_bytes,headroom_cpu_millis,headroom_memory_bytes,headroom_disk_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
 [input.organisation_id,input.sandbox_id,input.sandbox_boot_generation,input.qualification_id,input.evidence_digest,input.source,hard.cpu_millis,hard.memory_bytes,hard.disk_bytes,headroom.cpu_millis,headroom.memory_bytes,headroom.disk_bytes]);
 return {qualified:true,replayed:false};
}
export async function lockSandboxBudget(tx:PrimaryTransaction,input:SandboxExecutor):Promise<void>{
 assertPrimaryTransaction(tx);await lockRun(tx,input);
 const sandbox=await tx.query<{pool_id:string;boot_generation:string;desired_state:string;observed_state:string}>('SELECT pool_id,boot_generation,desired_state,observed_state FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 FOR SHARE',[input.organisation_id,input.sandbox_id]);
 if(sandbox.rows[0]?.boot_generation!==input.sandbox_boot_generation)fail('STALE_SANDBOX_BOOT','Execution budget belongs to another sandbox boot');
 if(sandbox.rows[0].desired_state!=='RUNNING'||sandbox.rows[0].observed_state!=='RUNNING')fail('SANDBOX_NOT_ADMITTING','Desired and observed sandbox state must both permit execution');
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.organisation_id+':'+sandbox.rows[0].pool_id+':resource-admission']);
 const budget=await tx.query('SELECT qualification_id FROM hyperfide.sandbox_execution_budgets WHERE organisation_id=$1 AND sandbox_id=$2 AND sandbox_boot_generation=$3 FOR UPDATE',[input.organisation_id,input.sandbox_id,input.sandbox_boot_generation]);
 if(!budget.rows[0])fail('SANDBOX_BUDGET_UNQUALIFIED','No trusted usable execution budget is qualified for this exact sandbox boot');
 const slot=await tx.query('SELECT id FROM hyperfide.worker_slots WHERE organisation_id=$1 AND sandbox_id=$2 AND id=$3 AND boot_generation=$4',[input.organisation_id,input.sandbox_id,input.slot_id,input.sandbox_boot_generation]);
 if(!slot.rows[0])fail('JOB_SLOT_UNAVAILABLE','Execution budget must bind a registered exact-boot slot');
}
export async function reserveSandboxResources(tx:PrimaryTransaction,input:SandboxExecutor&{
 request_id:string;attempt_id?:string;job_kind:string;resources:SandboxResourceVector;
}):Promise<unknown>{
 await lockSandboxBudget(tx,input);uuid(input.request_id,'request_id');
 if(!['AGENT','CHILD','BUILD','TEST','REVIEW','INDEX','INTEGRATION','PREPARATION'].includes(input.job_kind))fail('INVALID_REQUEST','Unknown sandbox execution job kind');
 const resources=sandboxVector(input.resources);
 const old=await tx.query('SELECT * FROM hyperfide.sandbox_execution_charges WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 FOR UPDATE',[input.organisation_id,input.run_id,input.request_id]);
 if(old.rows[0]){
  const row=old.rows[0];
  if(row.sandbox_id!==input.sandbox_id||row.sandbox_boot_generation!==input.sandbox_boot_generation||row.slot_id!==input.slot_id||row.attempt_id!==(input.attempt_id??null)||row.job_kind!==input.job_kind||Object.keys(resources).some(k=>row[k]!==resources[k as keyof SandboxResourceVector]))fail('IDEMPOTENCY_CONFLICT','Sandbox execution request has different immutable resource bindings');
  if(row.state!=='HELD')fail('SANDBOX_CHARGE_REVOKED','Released or uncertain execution cannot acquire fresh authority through replay');
  return {charge_id:row.id,generation:row.generation,replayed:true};
 }
 const counter=await tx.query('UPDATE hyperfide.sandbox_execution_budgets SET held_cpu_millis=held_cpu_millis+$4::bigint,held_memory_bytes=held_memory_bytes+$5::bigint,held_disk_bytes=held_disk_bytes+$6::bigint,state_version=state_version+1 WHERE organisation_id=$1 AND sandbox_id=$2 AND sandbox_boot_generation=$3 AND held_cpu_millis+$4::bigint<=hard_cpu_millis-headroom_cpu_millis AND held_memory_bytes+$5::bigint<=hard_memory_bytes-headroom_memory_bytes AND held_disk_bytes+$6::bigint<=hard_disk_bytes-headroom_disk_bytes RETURNING qualification_id',
 [input.organisation_id,input.sandbox_id,input.sandbox_boot_generation,resources.cpu_millis,resources.memory_bytes,resources.disk_bytes]);
 if(!counter.rows[0])fail('SANDBOX_CAPACITY_EXHAUSTED','Aggregate sandbox execution would exceed the qualified hard limit minus reserved headroom');
 const id=randomUUID();
 await tx.query('INSERT INTO hyperfide.sandbox_execution_charges(organisation_id,run_id,id,request_id,sandbox_id,sandbox_boot_generation,slot_id,attempt_id,job_kind,cpu_millis,memory_bytes,disk_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
 [input.organisation_id,input.run_id,id,input.request_id,input.sandbox_id,input.sandbox_boot_generation,input.slot_id,input.attempt_id??null,input.job_kind,resources.cpu_millis,resources.memory_bytes,resources.disk_bytes]);
 return {charge_id:id,generation:'1',replayed:false};
}
export async function markSandboxReleasePending(tx:PrimaryTransaction,input:SchedulerScope&{request_id?:string;attempt_id?:string}):Promise<void>{
 assertPrimaryTransaction(tx);
 if((input.request_id===undefined)===(input.attempt_id===undefined))fail('INVALID_REQUEST','Exact request or attempt identity is required for logical release');
 await tx.query("UPDATE hyperfide.sandbox_execution_charges SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND state='HELD' AND (($3::uuid IS NOT NULL AND request_id=$3) OR ($4::uuid IS NOT NULL AND attempt_id=$4))",
 [input.organisation_id,input.run_id,input.request_id??null,input.attempt_id??null]);
}
export async function assertSandboxReservation(tx:PrimaryTransaction,input:SchedulerScope&{reservation_id:string}):Promise<unknown>{
 assertPrimaryTransaction(tx);
 const row=await tx.query("SELECT c.*,b.qualification_id,b.evidence_digest,(b.hard_cpu_millis-b.headroom_cpu_millis)::text AS usable_cpu_millis,(b.hard_memory_bytes-b.headroom_memory_bytes)::text AS usable_memory_bytes,(b.hard_disk_bytes-b.headroom_disk_bytes)::text AS usable_disk_bytes FROM hyperfide.reservations r JOIN hyperfide.sandbox_execution_charges c ON c.organisation_id=r.organisation_id AND c.run_id=r.run_id AND c.request_id=r.request_id JOIN hyperfide.sandbox_execution_budgets b ON b.organisation_id=c.organisation_id AND b.sandbox_id=c.sandbox_id AND b.sandbox_boot_generation=c.sandbox_boot_generation JOIN hyperfide.sandboxes s ON s.organisation_id=c.organisation_id AND s.id=c.sandbox_id AND s.boot_generation=c.sandbox_boot_generation WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.id=$3 AND r.state='ALLOCATED' AND c.state='HELD' AND s.desired_state='RUNNING' AND s.observed_state='RUNNING' FOR SHARE OF c,b,s",
 [input.organisation_id,input.run_id,input.reservation_id]);
 if(!row.rows[0])fail('SANDBOX_CHARGE_UNAVAILABLE','Current native execution requires the exact held per-boot sandbox resource charge');
 const r=row.rows[0];
 return {charge_id:r.id,generation:r.generation,request_id:r.request_id,organisation_id:r.organisation_id,run_id:r.run_id,sandbox_id:r.sandbox_id,sandbox_boot_generation:r.sandbox_boot_generation,slot_id:r.slot_id,attempt_id:r.attempt_id,job_kind:r.job_kind,resources:{cpu_millis:r.cpu_millis,memory_bytes:r.memory_bytes,disk_bytes:r.disk_bytes},usable_limits:{cpu_millis:r.usable_cpu_millis,memory_bytes:r.usable_memory_bytes,disk_bytes:r.usable_disk_bytes},qualification_id:r.qualification_id,evidence_digest:r.evidence_digest};
}
export async function readCurrentComputeToken(tx:PrimaryTransaction,input:SchedulerScope&{task_id:string}):Promise<ComputeToken|null>{
 assertPrimaryTransaction(tx);await lockRun(tx,input);
 const rows=await tx.query<{task_id:string;attempt_id:string;attempt_generation:string;authority_epoch:string;sandbox_id:string;slot_id:string;sandbox_boot_generation:string}>(
 "SELECT a.task_id,a.id AS attempt_id,a.generation AS attempt_generation,a.authority_epoch,a.sandbox_id,a.slot_id,a.sandbox_boot_generation FROM hyperfide.tasks t JOIN hyperfide.attempts a ON a.organisation_id=t.organisation_id AND a.run_id=t.run_id AND a.id=t.current_attempt_id AND a.generation=t.generation WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.id=$3 AND a.compute_authority='CURRENT'",[input.organisation_id,input.run_id,input.task_id]);
 return rows.rows[0]?{organisation_id:input.organisation_id,run_id:input.run_id,...rows.rows[0]}:null;
}

export async function releaseSandboxCharges(tx:PrimaryTransaction,scope:SchedulerScope,request_ids:string[]):Promise<void>{
 assertPrimaryTransaction(tx);
 for(const request of [...new Set(request_ids)].sort()){
  const charges=await tx.query('SELECT * FROM hyperfide.sandbox_execution_charges WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,request]);
  const row=charges.rows[0];if(!row||row.state==='RELEASED')continue;
  if(row.state!=='RELEASE_PENDING')fail('RELEASE_NOT_PENDING','Sandbox execution retains logical authority');
  const debt=await tx.query<{total:string;unreleased:string}>("SELECT count(*)::text total,count(*) FILTER(WHERE r.state<>'RELEASED')::text unreleased FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.request_id=$3 AND a.capacity_class<>'PHYSICAL'",[scope.organisation_id,scope.run_id,request]);
  if(debt.rows[0]!.total==='0'||debt.rows[0]!.unreleased!=='0')continue;
  const changed=await tx.query('UPDATE hyperfide.sandbox_execution_budgets SET held_cpu_millis=held_cpu_millis-$4::bigint,held_memory_bytes=held_memory_bytes-$5::bigint,held_disk_bytes=held_disk_bytes-$6::bigint,state_version=state_version+1 WHERE organisation_id=$1 AND sandbox_id=$2 AND sandbox_boot_generation=$3 AND held_cpu_millis>=$4::bigint AND held_memory_bytes>=$5::bigint AND held_disk_bytes>=$6::bigint RETURNING qualification_id',[scope.organisation_id,row.sandbox_id,row.sandbox_boot_generation,row.cpu_millis,row.memory_bytes,row.disk_bytes]);
  if(!changed.rows[0])fail('ACCOUNTING_INCONSISTENT','Exact sandbox charge is not covered by its counter');
  await tx.query("UPDATE hyperfide.sandbox_execution_charges SET state='RELEASED',released_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,row.id]);
 }
}

export async function inspectSandboxCharge(tx:PrimaryTransaction,input:SchedulerScope&{request_id:string}):Promise<Record<string,unknown>|null>{
 assertPrimaryTransaction(tx);
 const result=await tx.query('SELECT * FROM hyperfide.sandbox_execution_charges WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 FOR SHARE',[input.organisation_id,input.run_id,uuid(input.request_id,'request_id')]);
 const r=result.rows[0];return r?{charge_id:r.id,generation:r.generation,request_id:r.request_id,organisation_id:r.organisation_id,run_id:r.run_id,sandbox_id:r.sandbox_id,sandbox_boot_generation:r.sandbox_boot_generation,slot_id:r.slot_id,attempt_id:r.attempt_id,job_kind:r.job_kind,state:r.state,resources:{cpu_millis:r.cpu_millis,memory_bytes:r.memory_bytes,disk_bytes:r.disk_bytes},execution_authority:false}:null;
}
export async function readPreparationTarget(tx:PrimaryTransaction,input:SchedulerScope&{
 target_binding_id:string;preparation_operation_id:string;reservation_id:string;
}):Promise<Record<string,any>|null>{
 assertPrimaryTransaction(tx);
 const allocation=await readJobAllocation(tx,input);
 if(!allocation||allocation.job_kind!=='PREPARATION'||allocation.allocation_id!==uuid(input.target_binding_id,'target_binding_id'))return null;
 const row=(await tx.query("SELECT p.*,j.state AS job_state,j.lease_generation::text AS current_generation,r.*,b.boot_id "
 +"FROM hyperfide.assurance_preparation_intents p JOIN hyperfide.qualification_jobs j ON j.organisation_id=p.organisation_id AND j.run_id=p.run_id AND j.id=p.job_id "
 +"JOIN hyperfide.runner_registry r ON r.organisation_id=p.organisation_id AND r.run_id=p.run_id AND r.session_id=p.session_id "
 +"JOIN hyperfide.sandbox_boots b ON b.organisation_id=r.organisation_id AND b.sandbox_id=r.sandbox_id AND b.boot_generation=r.boot_generation "
 +"WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.operation_id=$3 AND p.reservation_id=$4 FOR SHARE OF p,j,r,b",
 [input.organisation_id,input.run_id,uuid(input.preparation_operation_id,'preparation_operation_id'),input.reservation_id])).rows[0];
 if(!row||row.job_state!=='PENDING'||String(row.job_lease_generation)!==row.current_generation||
  row.allocation_id!==allocation.allocation_id||String(row.allocation_generation)!==String(allocation.generation)||
  row.sandbox_id!==allocation.sandbox_id||row.slot_id!==allocation.slot_id||
  String(row.boot_generation)!==String(allocation.sandbox_boot_generation)||row.session_id!==allocation.assignee_session_id)return null;
 return {target_binding_id:allocation.allocation_id,organisation_id:input.organisation_id,run_id:input.run_id,
  preparation_operation_id:input.preparation_operation_id,task_id:allocation.task_id,request_id:allocation.request_id,
  reservation_id:input.reservation_id,allocation_id:allocation.allocation_id,allocation_generation:String(allocation.generation),
  sandbox_id:row.sandbox_id,sandbox_boot_generation:String(row.boot_generation),boot_id:row.boot_id,
  target_slot_id:row.slot_id,target_slot_generation:String(row.slot_generation),target_runner_session_id:row.session_id,
  target_uid:String(row.uid),target_gid:String(row.gid),assignee_session_id:allocation.assignee_session_id,repository_id:row.repository_id,
  source_digest:row.plan.source.source_manifest_digest,source_object_id:row.plan.source.source_object_id,source_tree_id:row.plan.source.source_tree_id,
  profile_id:row.derived_profile_id,profile_digest:row.context_digest,boot_preparation_digest:row.boot_preparation_digest,
  workspace_path:row.workspace_path,home_path:row.home_path,tmp_path:row.tmp_path,generation:String(allocation.generation),state:'BOUND',execution_authority:false};
}
export async function finishPreparationAllocation(tx:PrimaryTransaction,input:SchedulerScope&{operation_id:string}):Promise<void>{
 assertPrimaryTransaction(tx);
 const job=(await tx.query("SELECT j.*,p.public_key_b64,p.role AS executor_role,clock_timestamp() AS now FROM hyperfide.runner_remote_jobs j JOIN hyperfide.identity_principals p ON p.credential_id=j.executor_credential_id WHERE j.organisation_id=$1 AND j.run_id=$2 AND j.operation_id=$3 FOR SHARE OF j,p",
  [input.organisation_id,input.run_id,uuid(input.operation_id,'operation_id')])).rows[0];
 const age=job?new Date(job.now).getTime()-Date.parse(job.result?.ended_at):NaN;
 if(!job||job.job_class!=='PREPARATION'||job.state!=='COMPLETED'||job.result?.outcome!=='SUCCEEDED'||
  job.result?.cleanup_status!=='CONFIRMED'||job.result?.cleanup?.complete!==true||job.result?.cleanup?.observed_process_absent!==true||
  job.executor_role!=='PROVISIONER'||job.result?.operation_id!==input.operation_id||
  !Number.isFinite(age)||age<0||age>30000)
  fail('QUIESCENCE_UNCONFIRMED','Fresh completed native preparation and confirmed empty slot are required');
 const {runnerCanonical,runnerResultSigningBytes}=await import('../runner/bridge.js');
 const resultDigest='sha256:'+createHash('sha256').update(runnerCanonical(job.result)).digest('hex');
 const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(job.public_key_b64,'base64url')]),format:'der',type:'spki'});
 if(resultDigest!==job.result_digest||typeof job.result_signature!=='string'||
  !verify(null,runnerResultSigningBytes(input.organisation_id,input.run_id,input.operation_id,job.plan_digest,resultDigest),key,Buffer.from(job.result_signature,'base64url')))
  fail('QUIESCENCE_UNCONFIRMED','Preparation cleanup requires the signed provider-captured result');
 const allocation=await readJobAllocation(tx,{...input,reservation_id:job.reservation_id});
 if(!allocation||allocation.allocation_id!==job.plan.allocation.allocation_id||allocation.generation!==job.plan.allocation.generation)
  fail('JOB_ALLOCATION_STALE','Preparation cleanup must bind the exact current allocation');
 await releaseJobAllocation(tx,{...input,reservation_id:job.reservation_id,allocation_id:allocation.allocation_id,
  allocation_generation:allocation.generation,assignee_session_id:allocation.assignee_session_id});
 const {ResourceScheduler}=await import('./resources.js');
 const scheduler=new ResourceScheduler();
 scheduler.registerProofReader('runner.quiescence',async(_tx,request)=>{
  const exact=(await tx.query('SELECT 1 FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND request_id=$4',
   [input.organisation_id,input.run_id,request.reservation_id,allocation.request_id])).rows.length===1;
  return exact?{id:input.operation_id,digest:job.result_digest,observed_at:job.result.ended_at}:null;
 });
 try{
  const reservations=(await tx.query('SELECT id FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',
   [input.organisation_id,input.run_id,allocation.request_id])).rows;
  await scheduler.release(tx,{...input,reservation_ids:reservations.map(row=>row.id)});
 }finally{scheduler.close();}
}
export function createComponent(context:ComponentContext):Component{
  return {apiVersion:1,capabilities:{'scheduler.allocations.v1':Object.freeze({assertJobReservation,allocateReservations,bindJobReservation,readJobAllocation,readPreparationTarget,finishPreparationAllocation,renewJobAllocation,releaseJobAllocation,validateResourceVector}),'scheduler.controls.v1':Object.freeze({applyExecutionControl,assertNoExecutionHold,assertExecutionContinuation}),'scheduler.claims.v1':Object.freeze({claimTask,reserveCapacity,requireSchedulerAuthority,readCurrentComputeToken}),'scheduler.sandbox-budget.v1':Object.freeze({qualifySandboxBudget,lockSandboxBudget,reserveSandboxResources,markSandboxReleasePending,assertSandboxReservation,inspectSandboxCharge})},actions:{
    'scheduler.claim':async (value,context)=>{
      const input=parseClaim(value),actor=actorFor(context,input,object(value));
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal},
        tx=>claimTask(tx,input,actor,dispatchRecipients(context)));
    }
  }};
}
