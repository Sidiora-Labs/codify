import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {lockRun} from '../events/outbox.js';
import {actorFor,boundedInteger,canonical,claimTask,decimal,digest,dimensions,dispatchRecipients,fail,fields,
  gatewayFor,invocationFor,object,parseClaim,recordOutcome,requestDigest,reserveCapacity,
  requireSchedulerAuthority,uuid} from './claim.js';
import type {CapacityDimension,CapacityRequest,SchedulerActor,SchedulerScope} from './claim.js';

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
  return {reservations,rate_receipts:rates};
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
  const capability=Object.freeze({reserveCapacity:reserveDynamic,
    release:scheduler.release.bind(scheduler),registerProofReader:scheduler.registerProofReader.bind(scheduler)});
  return {apiVersion:1,capabilities:{'scheduler.resources.v1':capability},close:()=>scheduler.close(),actions:{
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
      if(job==='AGENT'&&!task)fail('TASK_REQUIRED','Agent admission must bind an accepted task');
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal,
        guard:tx=>invocationFor(context).guard(tx)},async tx=>{
        await lockRun(tx,scope);await requireQueueActor(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),task,package_id);
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
        const count=await tx.query<{count:string}>('SELECT count(*)::text FROM hyperfide.resource_waiters WHERE organisation_id=$1 AND pool_id=$2 AND state=\'WAITING\'',
          [scope.organisation_id,pool]);
        if(BigInt(count.rows[0]!.count)>=BigInt(policy.rows[0].max_waiters))fail('RESOURCE_QUEUE_OVERLOADED','The declared pool queue budget is full');
        const accounts=await tx.query<{id:string;dimension:string;pool_id:string}>('SELECT id,dimension,pool_id FROM hyperfide.capacity_accounts '+
          'WHERE organisation_id=$1 AND id=ANY($2::uuid[])',[scope.organisation_id,demand.map(item=>item.capacity_account_id)]);
        if(accounts.rows.length!==demand.length||accounts.rows.some(row=>row.pool_id!==pool)||
          !accounts.rows.some(row=>row.dimension===job))fail('CAPACITY_SCOPE_INVALID','The declared job capacity dimension must be reserved in the selected pool');
        const id=randomUUID();
        await tx.query('INSERT INTO hyperfide.resource_waiters(organisation_id,run_id,id,request_id,pool_id,owner_session_id,task_id,job_kind,priority,'+
          'wait_reason,deadline_at,attempt_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp()+$11::integer*interval\'1 millisecond\',$12)',
          [scope.organisation_id,scope.run_id,id,request,pool,actor.session_id,task??null,job,priority,reason,deadline,attempt]);
        for(const dimension of demand)await tx.query('INSERT INTO hyperfide.resource_waiter_dimensions(organisation_id,run_id,waiter_id,pool_id,capacity_account_id,quantity) '+
          'VALUES($1,$2,$3,$4,$5,$6)',[scope.organisation_id,scope.run_id,id,pool,dimension.capacity_account_id,dimension.quantity]);
        return {waiter_id:id,replayed:false,wait_reason:reason};
      });
    },
    'scheduler.resources.admit':async(value,context)=>{
      const input=fields(value,['organisation_id','run_id','pool_id','waiter_id','authority_epoch','leader_generation'],
        ['package_generation','package_id','claim']);
      const scope=scopeOf(input),actor=actorFor(context,scope,input),pool=uuid(input.pool_id,'pool_id'),waiter=uuid(input.waiter_id,'waiter_id');
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal,
        guard:tx=>invocationFor(context).guard(tx)},async tx=>{
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
        const rank=await tx.query<{id:string;run_id:string}>(
          'SELECT w.id,w.run_id FROM hyperfide.resource_waiters w JOIN hyperfide.runs r ON r.organisation_id=w.organisation_id AND r.id=w.run_id '+
          'JOIN hyperfide.scheduling_policies p ON p.organisation_id=w.organisation_id AND p.pool_id=w.pool_id '+
          'WHERE w.organisation_id=$1 AND w.pool_id=$2 AND w.state=\'WAITING\' AND w.deadline_at>clock_timestamp() '+
          'AND r.state IN (\'READY\',\'RUNNING\') ORDER BY w.priority+floor(extract(epoch FROM(clock_timestamp()-w.enqueued_at))/p.aging_seconds) DESC,w.enqueued_at,w.id LIMIT 1',
          [scope.organisation_id,pool]);
        if(rank.rows[0]?.id!==waiter||rank.rows[0]?.run_id!==scope.run_id)
          return {waiter_id:waiter,admitted:false,wait_reason:'FAIRNESS',state:'QUEUED'};
        const demand=await tx.query<CapacityDimension>('SELECT capacity_account_id,quantity FROM hyperfide.resource_waiter_dimensions '+
          'WHERE organisation_id=$1 AND run_id=$2 AND waiter_id=$3 ORDER BY capacity_account_id',[scope.organisation_id,scope.run_id,waiter]);
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
        await tx.query('UPDATE hyperfide.resource_waiters SET state=\'ADMITTED\',admitted_at=clock_timestamp(),attempt_id=$4,state_version=state_version+1 '+
          'WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,waiter,attempt]);
        return {waiter_id:waiter,admitted:true,replayed:false,result};
      });
    },
    'scheduler.resources.inspect':async(value,context)=>{
      const input=fields(value,['organisation_id','run_id','pool_id','authority_epoch','leader_generation'],['package_generation','package_id']);
      const scope=scopeOf(input),actor=actorFor(context,scope,input),pool=uuid(input.pool_id,'pool_id');
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:1,signal:context.signal,
        guard:tx=>invocationFor(context).guard(tx)},async tx=>{
        await requireQueueActor(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),undefined,
          input.package_id===undefined?undefined:uuid(input.package_id,'package_id'));
        const rows=await tx.query('SELECT dimension,resource_key,configured_limit,reserved,allocated,qualification_state,state_version '+
          'FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 ORDER BY dimension,resource_key',[scope.organisation_id,pool]);
        const queued=await tx.query('SELECT job_kind,wait_reason,count(*)::text AS count,min(enqueued_at)::text AS oldest '+
          'FROM hyperfide.resource_waiters WHERE organisation_id=$1 AND run_id=$2 AND pool_id=$3 AND state=\'WAITING\' GROUP BY job_kind,wait_reason',
          [scope.organisation_id,scope.run_id,pool]);
        return {accounts:rows.rows,queues:queued.rows,observation:'PRIMARY_SNAPSHOT',measurement_status:'NOT_A_PERFORMANCE_QUALIFICATION'};
      });
    },
    'scheduler.resources.release':async(value,context)=>{
      const input=fields(value,['organisation_id','run_id','reservation_ids','authority_epoch','leader_generation'],['package_generation','package_id']);
      const scope=scopeOf(input),actor=actorFor(context,scope,input);
      if(!Array.isArray(input.reservation_ids))fail('INVALID_REQUEST','reservation_ids must be an array');
      const ids=input.reservation_ids.map(id=>uuid(id,'reservation_id'));
      return gatewayFor(context).withPrimaryTransaction({timeoutMs:10000,maxRetries:3,signal:context.signal,
        guard:tx=>invocationFor(context).guard(tx)},async tx=>{
        await requireQueueActor(tx,scope,actor,uuid(input.authority_epoch,'authority_epoch'),undefined,
          input.package_id===undefined?undefined:uuid(input.package_id,'package_id'));
        return scheduler.release(tx,{...scope,reservation_ids:ids});
      });
    }
  }};
}
