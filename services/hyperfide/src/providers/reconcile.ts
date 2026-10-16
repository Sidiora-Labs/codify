import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {getPool} from '../storage/schema.js';
import {FoundationError} from '../policy/programme.js';
import {operationPayloadDigest,validateProviderOperation,validateProviderOutcome,validateInventory} from './contract.js';
import type {ProviderMethod,ProviderOperation,ProviderOutcome,ResourceRef} from './contract.js';
import {obj,str,uuid,utc,fail,readDeployment,currentPool,transaction,assertPoolCapacity,digestDocument,providerAdapter,hasProviderAdapter,providerOwnershipProbe} from './pools.js';
import type {DeploymentConfig,ProviderPersistenceHooks} from './pools.js';

interface Intent {
  organisation_id:string;run_id:string;id:string;pool_id:string;sandbox_id:string;configuration_digest:string;
  kind:'CREATE'|'DESTROY';request_key:string;request_digest:string;payload_digest:string;operation:ProviderOperation;
  state:string;native_sandbox_id:string|null;boot_generation:string;provider_request_id:string|null;
  last_outcome:ProviderOutcome|null;state_version:string;new_submission?:boolean;
}
function deadline(value:unknown,maximum:number):string {
  const result=utc(value),remaining=Date.parse(result)-Date.now();
  if(remaining<=0||remaining>maximum)fail('PROVIDER_DEADLINE_INVALID','A future operation deadline within approved bounds is required');
  return result;
}
function operation<K extends ProviderMethod>(kind:K,scope:ProviderOperation['scope'],id:string,deadlineAt:string,resource:ResourceRef|null,
  preparationDigest:string|null,parameters:unknown,correlation=id):ProviderOperation<K>{
  const base={schema_version:1 as const,kind,scope,deadline_at:deadlineAt,resource,preparation_digest:preparationDigest,parameters,
    identity:{operation_id:id,idempotency_key:id,payload_digest:'',correlation_id:correlation,causation_id:correlation}};
  base.identity.payload_digest=operationPayloadDigest(base as ProviderOperation);
  return validateProviderOperation(base) as ProviderOperation<K>;
}
async function intent(client:pg.Pool|pg.PoolClient,organisation:string,id:string,lock=false):Promise<Intent>{
  const result=await client.query<Intent>('SELECT * FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND id=$2'+(lock?' FOR UPDATE':''),[organisation,uuid(id)]);
  if(!result.rows.length)fail('PROVISIONING_INTENT_UNKNOWN','Provisioning intent does not exist in this deployment');return result.rows[0]!;
}
async function noActiveWork(client:pg.PoolClient,organisation:string,sandbox:string):Promise<void>{
  const result=await client.query("SELECT EXISTS(SELECT 1 FROM hyperfide.attempts WHERE organisation_id=$1 AND sandbox_id=$2 AND compute_authority='CURRENT') OR EXISTS(SELECT 1 FROM hyperfide.worker_slots WHERE organisation_id=$1 AND sandbox_id=$2 AND state='ALLOCATED') OR EXISTS(SELECT 1 FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND sandbox_id=$2 AND state IN ('REGISTERED','RUNNING','DISCONNECTED')) AS active",[organisation,sandbox]);
  if(result.rows[0].active)fail('SANDBOX_HAS_ACTIVE_WORK','Active or uncertain compute/session ownership prevents teardown');
}
export async function prepareCreate(pool:pg.Pool,config:DeploymentConfig,value:unknown):Promise<unknown>{
  return transaction(pool,c=>prepareCreateTx(c,config,value));
}
export async function prepareCreateTx(c:pg.PoolClient,config:DeploymentConfig,value:unknown):Promise<unknown>{
  const input=obj(value,['run_id','pool_id','sandbox_id','request_key','deadline_at','reservation_ids','profile_id','preparation_digest','parameters']);
  const run=uuid(input.run_id),poolId=uuid(input.pool_id),sandbox=uuid(input.sandbox_id),key=str(input.request_key,256);
  if(!Array.isArray(input.reservation_ids)||!input.reservation_ids.length||input.reservation_ids.length>32)fail('RESERVATION_REQUIRED','Capacity reservations are required before provisioning');
  const ids=input.reservation_ids.map(uuid);if(new Set(ids).size!==ids.length)fail('RESERVATION_INVALID','Duplicate reservations');
  const requestDigest=digestDocument(input);
  return (async()=>{
    const prior=await c.query('SELECT * FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND run_id=$2 AND request_key=$3 FOR UPDATE',[config.organisation_id,run,key]);
    if(prior.rows.length){if(prior.rows[0].request_digest!==requestDigest)fail('IDEMPOTENCY_CONFLICT','Provisioning key was reused with another payload');return{created:false,intent:prior.rows[0]};}
    const deadlineAt=deadline(input.deadline_at,config.maximum_operation_ms),{pool:configured,scope}=await currentPool(c,config,poolId);
    if(input.preparation_digest!==configured.preparation_digest||input.profile_id!==configured.profile_id)fail('PREPARATION_MISMATCH','Requested environment differs from trusted pool profile');
    const id=randomUUID(),op=operation('create',scope,id,deadlineAt,null,configured.preparation_digest,input.parameters);
    const activeRun=await c.query("SELECT state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE",[config.organisation_id,run]);
    if(activeRun.rows[0]?.state!=='RUNNING')fail('RUN_NOT_RUNNING','Provisioning requires a running admitted run');
    const requested={SANDBOX:'1',PROVISIONING:'1',CPU_MILLIS:String(op.parameters.resources.cpu_millis),
      MEMORY_BYTES:op.parameters.resources.memory_bytes,DISK_BYTES:op.parameters.resources.disk_bytes};
    await assertPoolCapacity(c,config,poolId,requested,true);
    const reservations=await c.query("SELECT r.*,a.pool_id,a.dimension FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.id=ANY($3::uuid[]) ORDER BY r.id FOR UPDATE OF r",[config.organisation_id,run,ids]);
    if(reservations.rows.length!==ids.length||reservations.rows.some(r=>r.pool_id!==poolId||r.state!=='PROVISIONING'||new Date(r.expires_at).getTime()<=Date.now()))
      fail('RESERVATION_INVALID','Reservation scope, disposition or expiry prevents provisioning');
    for(const [dimension,quantity] of Object.entries(requested).filter(([d])=>d!=='PROVISIONING')){
      if(reservations.rows.filter(r=>r.dimension===dimension).reduce((n,r)=>n+BigInt(r.quantity),0n)<BigInt(quantity))
        fail('RESERVATION_INSUFFICIENT','Required resource quantity is not reserved');
    }
    await c.query("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,desired_state,observed_state,preparation_digest) VALUES($1,$2,$3,'RUNNING','UNKNOWN',$4)",[config.organisation_id,sandbox,poolId,configured.preparation_digest]);
    await c.query("INSERT INTO hyperfide.provisioning_intents(organisation_id,run_id,id,pool_id,sandbox_id,configuration_digest,kind,request_key,request_digest,payload_digest,operation,boot_generation) VALUES($1,$2,$3,$4,$5,$6,'CREATE',$7,$8,$9,$10,1)",
      [config.organisation_id,run,id,poolId,sandbox,scope.configuration_digest,key,requestDigest,op.identity.payload_digest,op]);
    for(const reservation of ids)await c.query('INSERT INTO hyperfide.provisioning_intent_reservations VALUES($1,$2,$3,$4)',[config.organisation_id,run,id,reservation]);
    return{created:true,intent:await intent(c,config.organisation_id,id),external_call_performed:false};
  })();
}
export async function prepareDestroy(pool:pg.Pool,config:DeploymentConfig,value:unknown):Promise<unknown>{
  const input=obj(value,['run_id','pool_id','sandbox_id','request_key','deadline_at','reason']);
  const run=uuid(input.run_id),poolId=uuid(input.pool_id),sandbox=uuid(input.sandbox_id),key=str(input.request_key,256),requestDigest=digestDocument(input);
  return transaction(pool,async c=>{
    const prior=await c.query('SELECT * FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND run_id=$2 AND request_key=$3 FOR UPDATE',[config.organisation_id,run,key]);
    if(prior.rows.length){if(prior.rows[0].request_digest!==requestDigest)fail('IDEMPOTENCY_CONFLICT','Provisioning key was reused');return{created:false,intent:prior.rows[0]};}
    const {scope}=await currentPool(c,config,poolId);
    const rows=await c.query('SELECT * FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND pool_id=$3 FOR UPDATE',[config.organisation_id,sandbox,poolId]);
    const s=rows.rows[0];if(!s?.native_sandbox_id||s.observed_state==='DESTROYED')fail('RESOURCE_OWNERSHIP_UNKNOWN','A known live resource identity is required');
    await noActiveWork(c,config.organisation_id,sandbox);
    const id=randomUUID(),op=operation('destroy',scope,id,deadline(input.deadline_at,config.maximum_operation_ms),
      {native_sandbox_id:s.native_sandbox_id,sandbox_boot_generation:String(s.boot_generation)},s.preparation_digest,{reason:str(input.reason,1024)});
    await c.query("INSERT INTO hyperfide.provisioning_intents(organisation_id,run_id,id,pool_id,sandbox_id,configuration_digest,kind,request_key,request_digest,payload_digest,operation,boot_generation,native_sandbox_id) VALUES($1,$2,$3,$4,$5,$6,'DESTROY',$7,$8,$9,$10,$11,$12)",
      [config.organisation_id,run,id,poolId,sandbox,scope.configuration_digest,key,requestDigest,op.identity.payload_digest,op,s.boot_generation,s.native_sandbox_id]);
    await c.query("UPDATE hyperfide.sandboxes SET desired_state='DESTROYED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[config.organisation_id,sandbox]);
    return{created:true,intent:await intent(c,config.organisation_id,id),external_call_performed:false};
  });
}
export function persistenceHooks(pool:pg.Pool,organisation:string,id:string):ProviderPersistenceHooks{
  return {
    assignedBootGeneration:async op=>{
      validateProviderOperation(op);
      const row=await intent(pool,organisation,id);
      if(row.kind!=='CREATE'||row.id!==op.identity.operation_id||row.payload_digest!==op.identity.payload_digest||row.state!=='SUBMITTING')
        fail('PROVISIONING_INTENT_MISMATCH','Create must bind a durably submitted operation before external effects');
      const sandbox=await pool.query('SELECT boot_generation FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2',[organisation,row.sandbox_id]);
      if(String(sandbox.rows[0]?.boot_generation)!==String(row.boot_generation))fail('STALE_SANDBOX_GENERATION','Sandbox generation changed before create');
      return String(row.boot_generation);
    },
    persistEarlyResource:async(op,nativeId)=>{
      validateProviderOperation(op);str(nativeId);
      const result=await transaction(pool,async c=>{
        const row=await intent(c,organisation,id,true);
        if(row.kind!=='CREATE'||row.id!==op.identity.operation_id||row.payload_digest!==op.identity.payload_digest||digestDocument(row.operation)!==digestDocument(op)||
          ['RECORDED','REJECTED','TERMINAL'].includes(row.state))fail('EARLY_RESOURCE_MISMATCH','Early resource does not match submitted durable intent');
        const ref={native_sandbox_id:nativeId,sandbox_boot_generation:String(row.boot_generation)};
        if(row.native_sandbox_id===nativeId)return{ref};
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[organisation+':'+row.pool_id+':'+nativeId]);
        const collision=await c.query('SELECT id FROM hyperfide.sandboxes WHERE organisation_id=$1 AND pool_id=$2 AND native_sandbox_id=$3 AND id<>$4',[organisation,row.pool_id,nativeId,row.sandbox_id]);
        const sandbox=await c.query('SELECT boot_generation FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[organisation,row.sandbox_id]);
        if(row.native_sandbox_id||collision.rows.length||String(sandbox.rows[0]?.boot_generation)!==String(row.boot_generation)){
          await c.query("INSERT INTO hyperfide.provider_orphans(organisation_id,pool_id,native_sandbox_id,suspected_intent_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[organisation,row.pool_id,nativeId,id]);
          await c.query("UPDATE hyperfide.provisioning_intents SET state='QUARANTINED',failure_code='RESOURCE_ID_CONFLICT',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[organisation,id]);
          return{conflict:true};
        }
        await c.query("UPDATE hyperfide.sandboxes SET native_sandbox_id=$3,observed_state='CREATING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND boot_generation=$4",
          [organisation,row.sandbox_id,nativeId,row.boot_generation]);
        await c.query("UPDATE hyperfide.provisioning_intents SET native_sandbox_id=$3,state='ID_KNOWN',updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[organisation,id,nativeId]);
        return{ref};
      });
      if(result.conflict)fail('RESOURCE_ID_CONFLICT','Resource identity requires explicit reconciliation');
      return result.ref!;
    },
    recordObservation:async(op,outcome)=>{
      validateProviderOutcome({operation:op,outcome});
      await transaction(pool,async c=>{
        const row=await intent(c,organisation,id,true);
        if(op.identity.correlation_id!==id||digestDocument(op.scope)!==digestDocument(row.operation.scope))
          fail('OBSERVATION_SCOPE_MISMATCH','Provider observation does not bind this intent');
        const evidence=digestDocument({operation:op,outcome});
        await c.query('INSERT INTO hyperfide.provider_observations(organisation_id,id,intent_id,operation_id,payload_digest,observation,observed_at,evidence_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organisation_id,intent_id,operation_id,evidence_digest) DO NOTHING',
          [organisation,randomUUID(),id,op.identity.operation_id,op.identity.payload_digest,{operation:op,outcome},outcome.observed_at,evidence]);
        const previous=row.last_outcome as ProviderOutcome|null;
        if(row.state==='TERMINAL'||row.state==='REJECTED'||
          (previous&&previous.operation_id===outcome.operation_id&&previous.status==='SUCCEEDED'&&outcome.status==='UNKNOWN')||
          (previous&&Date.parse(previous.observed_at)>Date.parse(outcome.observed_at)))return;
        let state=row.state;
        if(op.kind==='create'&&outcome.status==='SUCCEEDED'){
          if(!row.native_sandbox_id||outcome.resource?.native_sandbox_id!==row.native_sandbox_id||
            outcome.resource.sandbox_boot_generation!==String(row.boot_generation))fail('EARLY_ID_NOT_PERSISTED','Adapter skipped durable early identity binding');
          const result=outcome.result as {provider_state:string};state=result.provider_state==='RUNNING'?'ACKNOWLEDGED':'ID_KNOWN';
          await c.query('UPDATE hyperfide.sandboxes SET observed_state=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',[organisation,row.sandbox_id,result.provider_state]);
        }else if(op.kind==='observe'&&outcome.status==='SUCCEEDED'){
          const result=outcome.result as {provider_state:string;health:string};
          if(result.provider_state==='DESTROYED'&&result.health==='ABSENT'){
            state='TERMINAL';
            await c.query("UPDATE hyperfide.sandboxes SET observed_state='DESTROYED',desired_state='DESTROYED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[organisation,row.sandbox_id]);
            await c.query("UPDATE hyperfide.provisioning_intents SET state='TERMINAL',updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND sandbox_id=$2 AND kind='CREATE' AND state<>'REJECTED'",[organisation,row.sandbox_id]);
            // Admission owns final reservation release; observed absence merely
            // permits its conservative RELEASE_PENDING transition.
            await c.query("UPDATE hyperfide.reservations r SET state='RELEASE_PENDING',state_version=state_version+1 FROM hyperfide.provisioning_intent_reservations l JOIN hyperfide.provisioning_intents i ON i.organisation_id=l.organisation_id AND i.run_id=l.run_id AND i.id=l.intent_id WHERE r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id AND i.organisation_id=$1 AND i.sandbox_id=$2 AND r.state<>'RELEASED'",[organisation,row.sandbox_id]);
          }else{
            if(result.provider_state==='FAILED')state='QUARANTINED';
            else if(result.provider_state==='RUNNING'&&row.kind==='CREATE')state='ACKNOWLEDGED';
            await c.query('UPDATE hyperfide.sandboxes SET observed_state=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',[organisation,row.sandbox_id,result.provider_state]);
          }
        }else if(outcome.status==='UNKNOWN'){
          state=row.state==='QUARANTINED'?'QUARANTINED':'UNKNOWN';
          if(op.kind==='create'&&outcome.resource&&!row.native_sandbox_id){
            if(outcome.resource.sandbox_boot_generation!==String(row.boot_generation))fail('STALE_SANDBOX_GENERATION','Candidate generation differs from durable intent');
            const candidate=outcome.resource.native_sandbox_id;
            const collision=await c.query('SELECT id FROM hyperfide.sandboxes WHERE organisation_id=$1 AND pool_id=$2 AND native_sandbox_id=$3 AND id<>$4',[organisation,row.pool_id,candidate,row.sandbox_id]);
            if(collision.rows.length){
              state='QUARANTINED';
              await c.query("INSERT INTO hyperfide.provider_orphans(organisation_id,pool_id,native_sandbox_id,suspected_intent_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[organisation,row.pool_id,candidate,id]);
            }else{
              await c.query("UPDATE hyperfide.sandboxes SET native_sandbox_id=$3,observed_state='CREATING',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND boot_generation=$4",[organisation,row.sandbox_id,candidate,row.boot_generation]);
              await c.query('UPDATE hyperfide.provisioning_intents SET native_sandbox_id=$3 WHERE organisation_id=$1 AND id=$2',[organisation,id,candidate]);
            }
          }
        }
        else if((outcome.status==='FAILED'||outcome.status==='UNSUPPORTED')&&op.kind==='create'){
          if(row.native_sandbox_id)state='QUARANTINED';
          else{
            state='REJECTED';await c.query("UPDATE hyperfide.sandboxes SET observed_state='DESTROYED',desired_state='DESTROYED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[organisation,row.sandbox_id]);
          }
        }else if(op.kind==='destroy'&&outcome.status==='SUCCEEDED')state='ACKNOWLEDGED';
        await c.query('UPDATE hyperfide.provisioning_intents SET state=$3,last_outcome=$4,provider_request_id=$5,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',
          [organisation,id,state,outcome,outcome.provider_request_id]);
      });
    },
  };
}
function unknownOutcome(op:ProviderOperation,resource:ResourceRef|null):ProviderOutcome {
  return {schema_version:1,status:'UNKNOWN',acceptance:'UNKNOWN',operation_id:op.identity.operation_id,payload_digest:op.identity.payload_digest,
    scope:op.scope,observed_at:new Date().toISOString(),provider_request_id:null,resource,result:null,
    error:{code:'UNAVAILABLE',provider_code:null,message:'Provider delivery or result could not be confirmed',retry_after_ms:null},
    reconcile_required:true,retry:'AFTER_RECONCILIATION'};
}
export async function executeIntent(pool:pg.Pool,config:DeploymentConfig,id:string,signal:AbortSignal):Promise<unknown>{
  const row=await transaction(pool,async c=>{
    const current=await intent(c,config.organisation_id,id,true);
    if(current.state!=='RECORDED')return current;
    const op=validateProviderOperation(current.operation);
    if(Date.parse(op.deadline_at)<=Date.now())fail('PROVIDER_DEADLINE_EXPIRED','Expired intent must be explicitly disposed, not submitted');
    await currentPool(c,config,current.pool_id);
    if(current.kind==='DESTROY')await noActiveWork(c,config.organisation_id,current.sandbox_id);
    // Resolve trusted implementation before recording possible delivery.
    if(!hasProviderAdapter(op.scope.provider))fail('PROVIDER_UNAVAILABLE','No trusted provider adapter is registered');
    await c.query("UPDATE hyperfide.provisioning_intents SET state='SUBMITTING',updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[config.organisation_id,id]);
    return{...current,state:'SUBMITTING',new_submission:true};
  });
  if(!row.new_submission)return{executed:false,intent:row,reconciliation_required:!['TERMINAL','REJECTED'].includes(row.state)};
  const op=validateProviderOperation(row.operation),hooks=persistenceHooks(pool,config.organisation_id,id),adapter=providerAdapter(op.scope,hooks);
  try{
    const timeout=AbortSignal.timeout(Math.max(1,Date.parse(op.deadline_at)-Date.now())),combined=AbortSignal.any([signal,timeout]);
    const outcome=row.kind==='CREATE'?await adapter.create(op as ProviderOperation<'create'>,combined):await adapter.destroy(op as ProviderOperation<'destroy'>,combined);
    await hooks.recordObservation(op,outcome);
  }catch{
    const current=await intent(pool,config.organisation_id,id);
    const ref=current.native_sandbox_id?{native_sandbox_id:current.native_sandbox_id,sandbox_boot_generation:String(current.boot_generation)}:null;
    await hooks.recordObservation(op,unknownOutcome(op,ref));
  }
  return{executed:true,intent:await intent(pool,config.organisation_id,id),readiness_granted:false};
}
export async function reconcileIntent(pool:pg.Pool,config:DeploymentConfig,id:string,signal:AbortSignal):Promise<unknown>{
  let row=await intent(pool,config.organisation_id,id);
  if(['TERMINAL','REJECTED','RECORDED'].includes(row.state))return{intent:row,external_call_performed:false};
  const original=validateProviderOperation(row.operation),hooks=persistenceHooks(pool,config.organisation_id,id),adapter=providerAdapter(original.scope,hooks);
  const next=<K extends ProviderMethod>(kind:K,parameters:unknown,ref:ResourceRef|null)=>
    operation(kind,original.scope,randomUUID(),new Date(Date.now()+config.maximum_operation_ms).toISOString(),ref,original.preparation_digest,parameters,id);
  if(!row.native_sandbox_id){
    const pages=[];let cursor:string|null=null;const seen=new Set<string>();
    for(let pageNumber=0;pageNumber<1000;pageNumber++){
      const op=next('list',{cursor,page_size:100},null),outcome=await adapter.list(op,signal);
      validateProviderOutcome({operation:op,outcome});await hooks.recordObservation(op,outcome);
      if(outcome.status!=='SUCCEEDED')return{intent:await intent(pool,config.organisation_id,id),reconciled:false,absence_authorized:false};
      const page=outcome.result.page;pages.push(page);if(!page.has_more)break;
      if(page.next_cursor===null||seen.has(page.next_cursor))fail('PROVIDER_INVENTORY_INVALID','Inventory cursor failed to advance');
      seen.add(page.next_cursor);cursor=page.next_cursor;
    }
    const report=validateInventory({scope:original.scope,pages,evaluated_at:new Date().toISOString()}) as {enumeration_complete:boolean};
    if(!report.enumeration_complete)fail('PROVIDER_INVENTORY_INCOMPLETE','Incomplete inventory cannot resolve uncertainty');
    const matches:Array<{nativeId:string;evidence:string}>=[];
    for(const page of pages)for(const item of page.items){
      const known=await pool.query('SELECT id FROM hyperfide.sandboxes WHERE organisation_id=$1 AND pool_id=$2 AND native_sandbox_id=$3',[config.organisation_id,row.pool_id,item.native_sandbox_id]);
      if(known.rows.length)continue;
      await pool.query("INSERT INTO hyperfide.provider_orphans(organisation_id,pool_id,native_sandbox_id,suspected_intent_id) VALUES($1,$2,$3,$4) ON CONFLICT(organisation_id,pool_id,native_sandbox_id) DO UPDATE SET last_observed_at=clock_timestamp()",[config.organisation_id,row.pool_id,item.native_sandbox_id,id]);
      try{
        const observed=await providerOwnershipProbe(original.scope.provider)(original.scope,id,item.native_sandbox_id,signal);
        if(observed.matches&&observed.operation_id===id&&observed.native_sandbox_id===item.native_sandbox_id){
          matches.push({nativeId:item.native_sandbox_id,evidence:observed.evidence_digest});
        }
      }catch{/* Missing ownership proof leaves a quarantined resource, never deletion authority. */}
    }
    if(matches.length!==1){
      await pool.query("UPDATE hyperfide.provisioning_intents SET state='QUARANTINED',failure_code=$3,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",
        [config.organisation_id,id,matches.length?'MULTIPLE_OWNED_CANDIDATES':'OWNERSHIP_UNVERIFIED']);
      return{intent:await intent(pool,config.organisation_id,id),candidate_count:matches.length,absence_authorized:false};
    }
    await hooks.persistEarlyResource(original as ProviderOperation<'create'>,matches[0]!.nativeId);
    await pool.query("UPDATE hyperfide.provider_orphans SET state='OWNERSHIP_VERIFIED',ownership_evidence_digest=$4 WHERE organisation_id=$1 AND pool_id=$2 AND native_sandbox_id=$3",
      [config.organisation_id,row.pool_id,matches[0]!.nativeId,matches[0]!.evidence]);
    row=await intent(pool,config.organisation_id,id);
  }
  if(!row.native_sandbox_id)fail('RESOURCE_OWNERSHIP_UNKNOWN','Reconciliation did not establish a resource identity');
  const ref={native_sandbox_id:row.native_sandbox_id,sandbox_boot_generation:String(row.boot_generation)};
  const op=next('observe',{},ref),outcome=await adapter.observe(op,signal);await hooks.recordObservation(op,outcome);
  return{intent:await intent(pool,config.organisation_id,id),reconciled:true,absence_authorized:false};
}
export function createComponent(context:ComponentContext):Component {
  const guarded=(fn:(input:unknown,config:DeploymentConfig)=>Promise<unknown>)=>async(input:unknown)=>{
    if(context.signal.aborted)fail('PROVIDER_CLOSED','Provider coordinator is shutting down');
    return fn(input,await readDeployment(context.env));
  };
  return{apiVersion:1,actions:{
    'provider.intents.prepare-create':guarded((input,c)=>prepareCreate(getPool(context.env),c,input)),
    'provider.intents.prepare-destroy':guarded((input,c)=>prepareDestroy(getPool(context.env),c,input)),
    'provider.intents.get':guarded(async(input,c)=>{const i=obj(input,['intent_id']);return intent(getPool(context.env),c.organisation_id,uuid(i.intent_id));}),
    'provider.intents.execute':guarded(async(input,c)=>{const i=obj(input,['intent_id']);return executeIntent(getPool(context.env),c,uuid(i.intent_id),context.signal);}),
    'provider.intents.reconcile':guarded(async(input,c)=>{const i=obj(input,['intent_id']);return reconcileIntent(getPool(context.env),c,uuid(i.intent_id),context.signal);}),
    'provider.orphans.list':guarded(async(input,c)=>{const i=obj(input,['pool_id']);await currentPool(getPool(context.env),c,uuid(i.pool_id));return(await getPool(context.env).query('SELECT native_sandbox_id,state,ownership_evidence_digest,first_observed_at,last_observed_at FROM hyperfide.provider_orphans WHERE organisation_id=$1 AND pool_id=$2',[c.organisation_id,i.pool_id])).rows;}),
  }};
}
