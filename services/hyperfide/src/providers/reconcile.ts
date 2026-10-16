import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {validateProfile} from '../preparation/manifests.js';
import type {EnvironmentProfile} from '../preparation/manifests.js';
import {assertInvocation} from '../transport/protocol.js';
import {invocationOf} from '../identity/enrollment.js';
import type {InvocationContext} from '../transport/protocol.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {FoundationError} from '../policy/programme.js';
import {operationPayloadDigest,validateProviderOperation,validateProviderOutcome,validateInventory} from './contract.js';
import type {ProviderMethod,ProviderOperation,ProviderOutcome,ResourceRef} from './contract.js';
import {providerDatabase,resolveSandboxBinding,providerDeployment,providerInvocation,bindProviderInvocation,assertInvocationRun,obj,str,uuid,dg,utc,fail,readDeployment,currentPool,transaction,assertPoolCapacity,digestDocument,providerAdapter,hasProviderAdapter,providerOwnershipProbe} from './pools.js';
import type {ProviderDatabase,DeploymentConfig,ProviderPersistenceHooks,ProviderRunnerBindingVerifier,ProviderRunnerBinding,ProviderProcessRecord,ProviderDestructionRequest,ProviderDestructionProof,ProviderDestructionPreflight} from './pools.js';

export interface Intent {
  organisation_id:string;run_id:string;id:string;pool_id:string;sandbox_id:string;configuration_digest:string;
  kind:'CREATE'|'DESTROY';preparation_purpose:'PREPARATION'|'EXECUTION'|null;request_key:string;request_digest:string;payload_digest:string;operation:ProviderOperation;
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
async function intent(client:Pick<PrimaryTransaction,'query'>,organisation:string,id:string,lock=false):Promise<Intent>{
  const result=await client.query<Intent>('SELECT * FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND id=$2'+(lock?' FOR UPDATE':''),[organisation,uuid(id)]);
  if(!result.rows.length)fail('PROVISIONING_INTENT_UNKNOWN','Provisioning intent does not exist in this deployment');return result.rows[0]!;
}
async function noActiveWork(client:PrimaryTransaction,organisation:string,sandbox:string):Promise<void>{
  const result=await client.query("SELECT EXISTS(SELECT 1 FROM hyperfide.attempts WHERE organisation_id=$1 AND sandbox_id=$2 AND compute_authority='CURRENT') OR EXISTS(SELECT 1 FROM hyperfide.worker_slots WHERE organisation_id=$1 AND sandbox_id=$2 AND state='ALLOCATED') OR EXISTS(SELECT 1 FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND sandbox_id=$2 AND state IN ('REGISTERED','RUNNING','DISCONNECTED')) AS active",[organisation,sandbox]);
  if(result.rows[0]!.active)fail('SANDBOX_HAS_ACTIVE_WORK','Active or uncertain compute/session ownership prevents teardown');
}
export interface PreparationSelection {
 run_id:string;pool_id:string;profile_id:string;preparation_digest:string;purpose:'PREPARATION'|'EXECUTION';
}
export async function preparationParameters(c:PrimaryTransaction,config:DeploymentConfig,value:unknown,invocation:InvocationContext):Promise<ProviderOperation<'create'>['parameters']>{
 assertPrimaryTransaction(c);assertInvocation(invocation);await invocation.guard(c);
 if(invocation.principal.organisation_id!==config.organisation_id||!['OPERATOR','COORDINATOR','PROVISIONER','LEADER','FEATURE_MANAGER'].includes(invocation.principal.role))fail('AUTH_SCOPE_DENIED','Preparation scope is not authenticated');
 const i=obj(value,['run_id','pool_id','profile_id','preparation_digest','purpose']);
 const run=uuid(i.run_id),poolId=uuid(i.pool_id),profileId=uuid(i.profile_id),desired=str(i.preparation_digest);
 if(run!==invocation.principal.run_id)fail('AUTH_SCOPE_DENIED','Preparation belongs to another run');
 if(!['PREPARATION','EXECUTION'].includes(String(i.purpose)))fail('PREPARATION_PURPOSE_INVALID','Explicit preparation purpose is required');
 const {pool,scope}=await currentPool(c,config,poolId);
 if(pool.profile_id!==profileId||pool.preparation_digest!==desired)fail('PREPARATION_MISMATCH','Pool/profile/desired preparation differ');
 const active=await c.query('SELECT state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[config.organisation_id,run]);
 if(active.rows[0]?.state!=='RUNNING')fail('RUN_NOT_RUNNING','Preparation requires an admitted running run');
 const rows=await c.query('SELECT manifest,content_digest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2',[config.organisation_id,profileId]);
 if(!rows.rows[0])fail('PREPARATION_PROFILE_UNKNOWN','Trusted profile is not registered');
 const stored=rows.rows[0].manifest as Record<string,unknown>;
 const manifest=obj(stored,['schema_version','profile','files','directories','scan','digest']);
 if(manifest.schema_version!==1||manifest.digest!==desired||rows.rows[0].content_digest!==desired)fail('PREPARATION_MISMATCH','Exact stored source preparation manifest is required');
 const body={...manifest};delete body.digest;if(digestDocument(body)!==desired)fail('PREPARATION_MISMATCH','Stored source preparation manifest digest changed');
 const profile=manifest.profile as EnvironmentProfile;validateProfile(profile);
 let reference=pool.create_policy.seed_reference;
 if(i.purpose==='EXECUTION'){
  const bases=await c.query("SELECT * FROM hyperfide.provider_prepared_bases WHERE organisation_id=$1 AND pool_id=$2 AND profile_id=$3 AND preparation_digest=$4 AND provider=$5 AND configuration_digest=$6 AND verification_scope='POOL' AND state='QUALIFIED' AND expires_at>clock_timestamp() ORDER BY created_at DESC,id LIMIT 2 FOR SHARE",
   [config.organisation_id,poolId,profileId,desired,pool.provider,scope.configuration_digest]);
  if(bases.rows.length!==1)fail('PREPARED_BASE_UNAVAILABLE','Exactly one current verified provider base must bind the desired preparation');
  const base=bases.rows[0]!;
  const custody=await c.query("SELECT digest FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=$3 AND status='COMPLETE' FOR SHARE",[config.organisation_id,base.source_run_id,base.manifest_artifact_digest]);
  if(custody.rows.length!==1)fail('PREPARED_BASE_CUSTODY_UNAVAILABLE','Prepared-base manifest artifact must remain complete under admission lock');
  reference=str(obj(base.provider_reference).preparation_reference);
 }
 return{preparation_reference:reference,resources:profile.resources,network:pool.create_policy.network,stdin_required:pool.create_policy.stdin_required};
}
export async function prepareCreate(pool:ProviderDatabase,config:DeploymentConfig,value:unknown):Promise<unknown>{
  return transaction(pool,c=>prepareCreateTx(c,config,value,providerInvocation(pool)));
}
export async function prepareCreateTx(c:PrimaryTransaction,config:DeploymentConfig,value:unknown,invocation:InvocationContext):Promise<unknown>{
  assertPrimaryTransaction(c);assertInvocation(invocation);await invocation.guard(c);
  if(invocation.principal.organisation_id!==config.organisation_id||!['OPERATOR','COORDINATOR','PROVISIONER','LEADER','FEATURE_MANAGER'].includes(invocation.principal.role))fail('AUTH_SCOPE_DENIED','Create intent scope is not authenticated');
  const input=obj(value,['run_id','pool_id','sandbox_id','request_key','deadline_at','reservation_ids','profile_id','preparation_digest','purpose']);
  const run=uuid(input.run_id),poolId=uuid(input.pool_id),sandbox=uuid(input.sandbox_id),key=str(input.request_key,256);
  if(!Array.isArray(input.reservation_ids)||!input.reservation_ids.length||input.reservation_ids.length>32)fail('RESERVATION_REQUIRED','Capacity reservations are required before provisioning');
  const ids=input.reservation_ids.map(uuid);if(new Set(ids).size!==ids.length)fail('RESERVATION_INVALID','Duplicate reservations');
  if(run!==invocation.principal.run_id)fail('AUTH_SCOPE_DENIED','Create intent belongs to another run');
  const requestDigest=digestDocument(input);
  return (async()=>{
    const prior=await c.query('SELECT * FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND run_id=$2 AND request_key=$3 FOR UPDATE',[config.organisation_id,run,key]);
    if(prior.rows.length){if(prior.rows[0]!.request_digest!==requestDigest)fail('IDEMPOTENCY_CONFLICT','Provisioning key was reused with another payload');return{created:false,intent:prior.rows[0]};}
    const deadlineAt=deadline(input.deadline_at,config.maximum_operation_ms),{pool:configured,scope}=await currentPool(c,config,poolId);
    if(input.preparation_digest!==configured.preparation_digest||input.profile_id!==configured.profile_id)fail('PREPARATION_MISMATCH','Requested environment differs from trusted pool profile');
    const parameters=await preparationParameters(c,config,{run_id:run,pool_id:poolId,profile_id:input.profile_id,preparation_digest:input.preparation_digest,purpose:input.purpose},invocation);
    const id=randomUUID(),op=operation('create',scope,id,deadlineAt,null,configured.preparation_digest,parameters);
    const activeRun=await c.query("SELECT state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE",[config.organisation_id,run]);
    if(activeRun.rows[0]?.state!=='RUNNING')fail('RUN_NOT_RUNNING','Provisioning requires a running admitted run');
    const requested={SANDBOX:'1',PROVISIONING:'1',CPU_MILLIS:String(op.parameters.resources.cpu_millis),
      MEMORY_BYTES:op.parameters.resources.memory_bytes,DISK_BYTES:op.parameters.resources.disk_bytes};
    await assertPoolCapacity(c,config,poolId,requested,true);
    const reservations=await c.query("SELECT r.*,a.pool_id,a.dimension,a.capacity_class FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.id=ANY($3::uuid[]) ORDER BY r.id FOR UPDATE OF r",[config.organisation_id,run,ids]);
    if(reservations.rows.length!==ids.length||reservations.rows.some(r=>r.pool_id!==poolId||r.capacity_class!=='PHYSICAL'||r.state!=='PROVISIONING'||new Date(r.expires_at).getTime()<=Date.now()))
      fail('RESERVATION_INVALID','Reservation scope, disposition or expiry prevents provisioning');
    for(const [dimension,quantity] of Object.entries(requested).filter(([d])=>d!=='PROVISIONING')){
      if(reservations.rows.filter(r=>r.dimension===dimension).reduce((n,r)=>n+BigInt(r.quantity),0n)<BigInt(quantity))
        fail('RESERVATION_INSUFFICIENT','Required resource quantity is not reserved');
    }
    await c.query("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,desired_state,observed_state,preparation_digest) VALUES($1,$2,$3,'RUNNING','UNKNOWN',$4)",[config.organisation_id,sandbox,poolId,configured.preparation_digest]);
    await c.query("INSERT INTO hyperfide.provisioning_intents(organisation_id,run_id,id,pool_id,sandbox_id,configuration_digest,kind,request_key,request_digest,payload_digest,operation,boot_generation,preparation_purpose) VALUES($1,$2,$3,$4,$5,$6,'CREATE',$7,$8,$9,$10,1,$11)",
      [config.organisation_id,run,id,poolId,sandbox,scope.configuration_digest,key,requestDigest,op.identity.payload_digest,op,input.purpose]);
    for(const reservation of ids)await c.query('INSERT INTO hyperfide.provisioning_intent_reservations VALUES($1,$2,$3,$4)',[config.organisation_id,run,id,reservation]);
    return{created:true,intent:await intent(c,config.organisation_id,id),external_call_performed:false};
  })();
}
export async function destructionPreflight(tx:PrimaryTransaction,pool:ProviderDatabase,input:ProviderDestructionRequest):Promise<ProviderDestructionProof>{
 assertPrimaryTransaction(tx);assertInvocationRun(pool,input.run_id);
 let proof:ProviderDestructionProof|null;
 if(pool.runtime.destructionPreflight)proof=await pool.runtime.destructionPreflight(tx,input);
 else{
  const rows=await tx.query("SELECT s.state_version,s.work_admitted,EXISTS(SELECT 1 FROM hyperfide.workspaces w WHERE w.organisation_id=s.organisation_id AND w.sandbox_id=s.id AND w.sandbox_boot_generation=$3) OR EXISTS(SELECT 1 FROM hyperfide.attempts a WHERE a.organisation_id=s.organisation_id AND a.sandbox_id=s.id AND a.sandbox_boot_generation=$3) OR EXISTS(SELECT 1 FROM hyperfide.agent_sessions a WHERE a.organisation_id=s.organisation_id AND a.sandbox_id=s.id AND a.sandbox_boot_generation=$3) OR EXISTS(SELECT 1 FROM hyperfide.provider_remote_operations p WHERE p.organisation_id=s.organisation_id AND p.sandbox_id=s.id AND p.boot_generation=$3) AS worked FROM hyperfide.sandboxes s WHERE s.organisation_id=$1 AND s.id=$2 AND s.boot_generation=$3 FOR UPDATE OF s",[input.organisation_id,input.sandbox_id,input.boot_generation]);
  const row=rows.rows[0];
  proof=row&&!row.work_admitted&&!row.worked?{evidence_digest:digestDocument({kind:'NEVER_ADMITTED_BOOT',input,state_version:String(row.state_version)}),observed_at:new Date().toISOString()}:null;
 }
 if(!proof)fail('DESTRUCTION_CUSTODY_REQUIRED','Worked or uncertain sandbox requires actual artifact custody and sealed workspace proof');
 dg(proof.evidence_digest);utc(proof.observed_at);
 if(Date.parse(proof.observed_at)>Date.now()||Date.now()-Date.parse(proof.observed_at)>30000)fail('DESTRUCTION_CUSTODY_STALE','Fresh destruction custody proof required');
 return proof;
}
export async function prepareDestroy(pool:ProviderDatabase,config:DeploymentConfig,value:unknown):Promise<unknown>{
  const input=obj(value,['run_id','pool_id','sandbox_id','request_key','deadline_at','reason']);
  const run=uuid(input.run_id),poolId=uuid(input.pool_id),sandbox=uuid(input.sandbox_id),key=str(input.request_key,256),requestDigest=digestDocument(input);assertInvocationRun(pool,run);
  return transaction(pool,async c=>{
    const prior=await c.query('SELECT * FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND run_id=$2 AND request_key=$3 FOR UPDATE',[config.organisation_id,run,key]);
    if(prior.rows.length){if(prior.rows[0]!.request_digest!==requestDigest)fail('IDEMPOTENCY_CONFLICT','Provisioning key was reused');return{created:false,intent:prior.rows[0]};}
    const {scope}=await currentPool(c,config,poolId);
    const rows=await c.query('SELECT * FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND pool_id=$3 FOR UPDATE',[config.organisation_id,sandbox,poolId]);
    const s=rows.rows[0];if(!s?.native_sandbox_id||s.observed_state==='DESTROYED')fail('RESOURCE_OWNERSHIP_UNKNOWN','A known live resource identity is required');
    await noActiveWork(c,config.organisation_id,sandbox);
    const id=randomUUID();await destructionPreflight(c,pool,{organisation_id:config.organisation_id,run_id:run,sandbox_id:sandbox,boot_generation:String(s.boot_generation),operation_id:id});
    const op=operation('destroy',scope,id,deadline(input.deadline_at,config.maximum_operation_ms),
      {native_sandbox_id:s.native_sandbox_id,sandbox_boot_generation:String(s.boot_generation)},s.preparation_digest,{reason:str(input.reason,1024)});
    await c.query("INSERT INTO hyperfide.provisioning_intents(organisation_id,run_id,id,pool_id,sandbox_id,configuration_digest,kind,request_key,request_digest,payload_digest,operation,boot_generation,native_sandbox_id) VALUES($1,$2,$3,$4,$5,$6,'DESTROY',$7,$8,$9,$10,$11,$12)",
      [config.organisation_id,run,id,poolId,sandbox,scope.configuration_digest,key,requestDigest,op.identity.payload_digest,op,s.boot_generation,s.native_sandbox_id]);
    await c.query("UPDATE hyperfide.sandboxes SET desired_state='DESTROYED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[config.organisation_id,sandbox]);
    return{created:true,intent:await intent(c,config.organisation_id,id),external_call_performed:false};
  });
}
export function persistenceHooks(pool:ProviderDatabase,organisation:string,id:string):ProviderPersistenceHooks{
  return {
    invocation:providerInvocation(pool),
    resolveResourceBinding:async op=>{const row=await intent(pool,organisation,id);if(op.identity.correlation_id!==id)fail('PROVIDER_SCOPE_MISMATCH','Resource operation differs from durable intent');return resolveSandboxBinding(pool,providerDeployment(pool),row.run_id,row.sandbox_id,op);},
    persistEarlyProcess:async()=>fail('PROCESS_LEDGER_REQUIRED','Process binding requires bound command ledger'),
    claimProcess:async()=>fail('PROCESS_LEDGER_REQUIRED','Process launch requires a bound remote command ledger'),
    resolveProcess:async()=>fail('PROCESS_LEDGER_REQUIRED','Process lookup requires a bound remote command ledger'),
    resolvePreparation:async op=>transaction(pool,async c=>{
      const row=await intent(c,organisation,id,true);assertInvocationRun(pool,row.run_id);
      if(row.kind!=='CREATE'||row.id!==op.identity.operation_id||digestDocument(op)!==digestDocument(row.operation)||!row.preparation_purpose)fail('PREPARATION_MISMATCH','Preparation resolver requires exact durable CREATE intent');
      const {pool:configured,scope}=await currentPool(c,providerDeployment(pool),row.pool_id);
      let prepared:Record<string,unknown>|null=null;
      if(row.preparation_purpose==='EXECUTION'){
       const rows=await c.query("SELECT * FROM hyperfide.provider_prepared_bases WHERE organisation_id=$1 AND pool_id=$2 AND profile_id=$3 AND preparation_digest=$4 AND configuration_digest=$5 AND provider=$6 AND state='QUALIFIED' AND verification_scope='POOL' AND expires_at>clock_timestamp() ORDER BY created_at DESC,id LIMIT 2 FOR SHARE",[organisation,row.pool_id,configured.profile_id,op.preparation_digest,scope.configuration_digest,scope.provider]);
       if(rows.rows.length!==1)fail('PREPARED_BASE_UNAVAILABLE','Exact immutable qualified base is no longer available');prepared=rows.rows[0]!;
       if(obj(prepared.provider_reference).preparation_reference!==op.parameters.preparation_reference)fail('PREPARATION_MISMATCH','Qualified provider reference changed');
      }else if(configured.create_policy.seed_reference!==op.parameters.preparation_reference)fail('PREPARATION_MISMATCH','Operator-approved seed changed');
      return{purpose:row.preparation_purpose,scope,preparation_digest:op.preparation_digest!,parameters:op.parameters,adapter_policy_digest:configured.create_policy.adapter_policy_digest??null,prepared_base:prepared};
    }),
    assertResourceBinding:async op=>{
      validateProviderOperation(op);await transaction(pool,async c=>{
       const row=await intent(c,organisation,id,true);assertInvocationRun(pool,row.run_id);
       if(digestDocument(op.scope)!==digestDocument(row.operation.scope)||op.identity.correlation_id!==id)fail('PROVIDER_SCOPE_MISMATCH','Operation is outside durable intent');
       const current=(await c.query('SELECT native_sandbox_id,boot_generation,preparation_digest FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 FOR SHARE',[organisation,row.sandbox_id])).rows[0];
       if(!current||String(current.boot_generation)!==String(row.boot_generation)||op.resource&&(op.resource.native_sandbox_id!==current.native_sandbox_id||op.resource.sandbox_boot_generation!==String(current.boot_generation)))fail('STALE_SANDBOX_GENERATION','Resource boot binding changed');
      });
    },
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
        if(op.resource&&(op.resource.native_sandbox_id!==row.native_sandbox_id||op.resource.sandbox_boot_generation!==String(row.boot_generation)))fail('OBSERVATION_RESOURCE_MISMATCH','Observation resource does not match original intent');
        const previous=row.last_outcome as ProviderOutcome|null;
        if(row.state==='TERMINAL'||row.state==='REJECTED'||
          (previous&&previous.operation_id===outcome.operation_id&&previous.status==='SUCCEEDED'&&outcome.status==='UNKNOWN')||
          (previous&&Date.parse(previous.observed_at)>Date.parse(outcome.observed_at)))return;
        let state=row.state;
        if(op.kind==='create'&&outcome.status==='SUCCEEDED'){
          if(!row.native_sandbox_id||outcome.resource?.native_sandbox_id!==row.native_sandbox_id||
            outcome.resource.sandbox_boot_generation!==String(row.boot_generation))fail('EARLY_ID_NOT_PERSISTED','Adapter skipped durable early identity binding');
          const result=outcome.result as {provider_state:string};state=result.provider_state==='RUNNING'?'ACKNOWLEDGED':'ID_KNOWN';
          await c.query('UPDATE hyperfide.sandboxes SET observed_state=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND boot_generation=$4',[organisation,row.sandbox_id,result.provider_state,row.boot_generation]);
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
            await c.query('UPDATE hyperfide.sandboxes SET observed_state=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND boot_generation=$4',[organisation,row.sandbox_id,result.provider_state,row.boot_generation]);
          }
        }else if(outcome.status==='UNKNOWN'){
          state=row.state==='QUARANTINED'?'QUARANTINED':'UNKNOWN';
          if(op.kind==='create'&&outcome.resource&&!row.native_sandbox_id){
            if(outcome.resource.sandbox_boot_generation!==String(row.boot_generation))fail('STALE_SANDBOX_GENERATION','Candidate generation differs from durable intent');
            const candidate=outcome.resource.native_sandbox_id;
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[organisation+':'+row.pool_id+':'+candidate]);
            const boot=await c.query('SELECT boot_generation FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[organisation,row.sandbox_id]);
            if(String(boot.rows[0]?.boot_generation)!==String(row.boot_generation))fail('STALE_SANDBOX_GENERATION','Candidate belongs to superseded generation');
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
export async function boundedProvider<T>(effect:Promise<T>,signal:AbortSignal,deadlineAt:string):Promise<T>{
 const ms=Date.parse(deadlineAt)-Date.now();if(ms<=0||signal.aborted)fail('PROVIDER_TIMEOUT','Provider deadline expired');
 let timer:ReturnType<typeof setTimeout>|undefined;let abort:(()=>void)|undefined;
 try{return await Promise.race([effect,new Promise<never>((_resolve,reject)=>{
  const stop=()=>reject(new FoundationError('PROVIDER_TIMEOUT','Provider outcome requires reconciliation'));
  timer=setTimeout(stop,ms);abort=stop;signal.addEventListener('abort',stop,{once:true});
  if(signal.aborted)stop();
 })]);}finally{if(timer)clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);}
}
export async function executeIntent(pool:ProviderDatabase,config:DeploymentConfig,id:string,signal:AbortSignal):Promise<unknown>{
  const row=await transaction(pool,async c=>{
    const current=await intent(c,config.organisation_id,id,true);assertInvocationRun(pool,current.run_id);
    if(current.state!=='RECORDED')return current;
    const op=validateProviderOperation(current.operation);
    if(Date.parse(op.deadline_at)<=Date.now())fail('PROVIDER_DEADLINE_EXPIRED','Expired intent must be explicitly disposed, not submitted');
    await currentPool(c,config,current.pool_id);
    if(current.kind==='DESTROY'){await noActiveWork(c,config.organisation_id,current.sandbox_id);await destructionPreflight(c,pool,{organisation_id:config.organisation_id,run_id:current.run_id,sandbox_id:current.sandbox_id,boot_generation:String(current.boot_generation),operation_id:current.id});}
    // Resolve trusted implementation before recording possible delivery.
    if(!hasProviderAdapter(op.scope.provider,pool.runtime))fail('PROVIDER_UNAVAILABLE','No trusted provider adapter is registered');
    await c.query("UPDATE hyperfide.provisioning_intents SET state='SUBMITTING',updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[config.organisation_id,id]);
    return{...current,state:'SUBMITTING',new_submission:true};
  });
  if(!row.new_submission)return{executed:false,intent:row,reconciliation_required:!['TERMINAL','REJECTED'].includes(row.state)};
  const op=validateProviderOperation(row.operation),hooks=persistenceHooks(pool,config.organisation_id,id),adapter=providerAdapter(op.scope,hooks,pool.runtime);
  try{
    await hooks.assertResourceBinding(op);
    const timeout=AbortSignal.timeout(Math.max(1,Date.parse(op.deadline_at)-Date.now())),combined=AbortSignal.any([signal,timeout]);
    const outcome=await boundedProvider<ProviderOutcome>(row.kind==='CREATE'?adapter.create(op as ProviderOperation<'create'>,combined):adapter.destroy(op as ProviderOperation<'destroy'>,combined),combined,op.deadline_at);
    await hooks.recordObservation(op,outcome);
  }catch{
    const current=await intent(pool,config.organisation_id,id);
    const ref=current.native_sandbox_id?{native_sandbox_id:current.native_sandbox_id,sandbox_boot_generation:String(current.boot_generation)}:null;
    await hooks.recordObservation(op,unknownOutcome(op,ref));
  }
  return{executed:true,intent:await intent(pool,config.organisation_id,id),readiness_granted:false};
}
export async function reconcileIntent(pool:ProviderDatabase,config:DeploymentConfig,id:string,signal:AbortSignal):Promise<unknown>{
  let row=await intent(pool,config.organisation_id,id);assertInvocationRun(pool,row.run_id);
  const reconciliationDeadline=new Date(Date.now()+config.maximum_operation_ms).toISOString();
  if(['TERMINAL','REJECTED','RECORDED'].includes(row.state))return{intent:row,external_call_performed:false};
  const original=validateProviderOperation(row.operation),hooks=persistenceHooks(pool,config.organisation_id,id),adapter=providerAdapter(original.scope,hooks,pool.runtime);
  const next=<K extends ProviderMethod>(kind:K,parameters:unknown,ref:ResourceRef|null)=>
    operation(kind,original.scope,randomUUID(),reconciliationDeadline,ref,original.preparation_digest,parameters,id);
  if(!row.native_sandbox_id){
    const pages=[];let cursor:string|null=null;const seen=new Set<string>();
    for(let pageNumber=0;pageNumber<1000;pageNumber++){
      const op:ProviderOperation<'list'>=next('list',{cursor,page_size:100},null);
      const outcome:ProviderOutcome<'list'>=await boundedProvider(adapter.list(op,signal),signal,op.deadline_at);
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
        const observed=await boundedProvider(providerOwnershipProbe(original.scope.provider,pool.runtime)(original.scope,id,item.native_sandbox_id,signal),signal,reconciliationDeadline);
        if(observed.matches&&observed.operation_id===id&&observed.native_sandbox_id===item.native_sandbox_id){
          dg(observed.evidence_digest);matches.push({nativeId:item.native_sandbox_id,evidence:observed.evidence_digest});
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
  const op=next('observe',{},ref),outcome=await boundedProvider(adapter.observe(op,signal),signal,op.deadline_at);await hooks.recordObservation(op,outcome);
  return{intent:await intent(pool,config.organisation_id,id),reconciled:true,absence_authorized:false};
}
export interface CapturedProviderOutput {
 stdout:Uint8Array;stderr:Uint8Array;exit_code:number;complete:true;spool_digest:string;
}
export interface BoundProviderRequest {
 binding:{organisation_id:string;run_id:string;session_id:string;pool_id:string;sandbox_id:string;external_sandbox_id:string;boot_generation:string;preparation_digest:string};
 operation_id:string;argv:string[];cwd:string;env_refs:Record<string,string>;timeout_ms:number;
}
function processRecord(value:unknown,op:ProviderOperation<'execute'>):ProviderProcessRecord{
 const r=obj(value);if(Object.keys(r).some(k=>!['process_ref','payload_digest','resource','state','provider_metadata','native_process_ref'].includes(k))||['process_ref','payload_digest','resource','state','provider_metadata'].some(k=>!Object.hasOwn(r,k))||r.native_process_ref!==undefined&&r.native_process_ref!==null)fail('PROCESS_BINDING_INVALID','Native process ID must be observed after submission');str(r.process_ref);dg(r.payload_digest);obj(r.provider_metadata);
 if(JSON.stringify(r).length>65536||r.state!=='SUBMITTED'||r.payload_digest!==op.identity.payload_digest||digestDocument(r.resource)!==digestDocument(op.resource))fail('PROCESS_BINDING_INVALID','Process claim must bind exact submitted execute operation');
 return r as unknown as ProviderProcessRecord;
}
export function remoteProcessHooks(pool:ProviderDatabase,organisation:string,run:string,id:string){
 return{
  persistEarlyProcess:async(op:ProviderOperation<'execute'>,nativeProcessRef:string):Promise<void>=>{
   validateProviderOperation(op);str(nativeProcessRef);assertInvocationRun(pool,run);
   const conflict=await transaction(pool,async c=>{
    const row=(await c.query('SELECT * FROM hyperfide.provider_remote_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[organisation,run,id])).rows[0];
    if(!row||digestDocument(row.operation)!==digestDocument(op))fail('PROCESS_BINDING_INVALID','Early native process identity differs from durable operation');
    await c.query('INSERT INTO hyperfide.provider_process_candidates(organisation_id,remote_operation_id,native_process_ref,evidence_digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[organisation,id,nativeProcessRef,digestDocument({operation:op,native_process_ref:nativeProcessRef})]);
    if(!row.process_claimed||row.native_process_ref&&row.native_process_ref!==nativeProcessRef){await c.query("UPDATE hyperfide.provider_remote_operations SET state='UNKNOWN',updated_at=clock_timestamp() WHERE organisation_id=$1 AND id=$2",[organisation,id]);return true;}
    await c.query('UPDATE hyperfide.provider_remote_operations SET native_process_ref=$3,updated_at=clock_timestamp() WHERE organisation_id=$1 AND id=$2',[organisation,id,nativeProcessRef]);return false;
   });if(conflict)fail('PROCESS_ID_CONFLICT','Known native process candidates require reconciliation');
  },
  claimProcess:async(op:ProviderOperation<'execute'>,value:ProviderProcessRecord):Promise<{disposition:'NEW'|'EXISTING';record:ProviderProcessRecord}>=>{
   validateProviderOperation(op);const record=processRecord(value,op);assertInvocationRun(pool,run);
   return transaction(pool,async c=>{
    const rows=await c.query('SELECT * FROM hyperfide.provider_remote_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[organisation,run,id]),row=rows.rows[0];
    if(!row||digestDocument(row.operation)!==digestDocument(op))fail('PROCESS_BINDING_INVALID','Process claim differs from durable operation');
    if(row.process_claimed){if(!row.process_record)fail('PROCESS_BINDING_INVALID','Claimed process metadata is unavailable');return{disposition:'EXISTING',record:row.process_record as ProviderProcessRecord};}
    await c.query('UPDATE hyperfide.provider_remote_operations SET process_claimed=true,process_record=$4,updated_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[organisation,run,id,record]);
    return{disposition:'NEW',record};
   });
  },
  resolveProcess:async(op:ProviderOperation,processRef:string):Promise<ProviderProcessRecord|null>=>{
   validateProviderOperation(op);str(processRef);assertInvocationRun(pool,run);
   const rows=await pool.query("SELECT operation,process_record,native_process_ref FROM hyperfide.provider_remote_operations WHERE organisation_id=$1 AND run_id=$2 AND process_claimed AND (process_record->>'process_ref'=$3 OR native_process_ref=$3) AND sandbox_id=(SELECT sandbox_id FROM hyperfide.provider_remote_operations WHERE organisation_id=$1 AND id=$4) AND boot_generation=$5 ORDER BY created_at DESC LIMIT 2",
    [organisation,run,processRef,id,op.resource?.sandbox_boot_generation??'0']);
   if(rows.rows.length!==1)return null;const row=rows.rows[0]!;
   if(digestDocument(row.operation.scope)!==digestDocument(op.scope)||digestDocument(row.operation.resource)!==digestDocument(op.resource))return null;
   return{...row.process_record,native_process_ref:row.native_process_ref} as ProviderProcessRecord;
  }
 };
}
export async function executeBound(pool:ProviderDatabase,config:DeploymentConfig,value:unknown,signal:AbortSignal):Promise<unknown>{
 const invocation=providerInvocation(pool);if(invocation.payload.component!=='8.3'||invocation.payload.action!=='provider.remote.execute-bound'||digestDocument(invocation.payload.input)!==digestDocument(value))fail('AUTH_SCOPE_DENIED','Private execution requires its exact authenticated request');
 const i=obj(value,['binding','operation_id','argv','cwd','env_refs','timeout_ms']),b=obj(i.binding,['organisation_id','run_id','session_id','pool_id','sandbox_id','external_sandbox_id','boot_generation','preparation_digest']);
 if(b.organisation_id!==config.organisation_id)fail('PROVIDER_SCOPE_MISMATCH','Runner belongs to another organisation');
 const run=uuid(b.run_id),session=uuid(b.session_id),sandbox=uuid(b.sandbox_id),poolId=uuid(b.pool_id),id=uuid(i.operation_id);assertInvocationRun(pool,run);
 if(!Number.isSafeInteger(i.timeout_ms)||(i.timeout_ms as number)<1||(i.timeout_ms as number)>config.maximum_operation_ms)fail('PROVIDER_DEADLINE_INVALID','Remote command timeout exceeds approved bound');
 const op=await transaction(pool,async c=>{
  const {scope}=await currentPool(c,config,poolId);
  if(!pool.runtime.runnerBindingVerifier)fail('RUNNER_REGISTRY_UNAVAILABLE','Actual trusted runner registration must be verified');
  const proof=await pool.runtime.runnerBindingVerifier(c,b as ProviderRunnerBinding);if(!proof)fail('RUNNER_BINDING_STALE','Runner registration is unavailable or stale');
  const bindingDigest=dg(proof.evidence_digest);utc(proof.observed_at);
  if(Date.parse(proof.observed_at)>Date.now()||Date.now()-Date.parse(proof.observed_at)>60000)fail('RUNNER_BINDING_STALE','Runner binding verification must be fresh');
  const rows=await c.query('SELECT native_sandbox_id,boot_generation,preparation_digest,desired_state FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND pool_id=$3 FOR UPDATE',[config.organisation_id,sandbox,poolId]);
  const current=rows.rows[0];
  if(!current||current.desired_state!=='RUNNING'||current.native_sandbox_id!==b.external_sandbox_id||String(current.boot_generation)!==b.boot_generation||current.preparation_digest!==b.preparation_digest)
   fail('RUNNER_BINDING_STALE','Remote execution requires the exact registered runner/resource boot');
  const operationValue=operation('execute',scope,id,new Date(Date.now()+(i.timeout_ms as number)).toISOString(),
   {native_sandbox_id:current.native_sandbox_id,sandbox_boot_generation:String(current.boot_generation)},current.preparation_digest,
   {argv:i.argv,cwd:i.cwd,env_refs:i.env_refs,stdin:false,durable:false,process_timeout_ms:i.timeout_ms,wait_timeout_ms:i.timeout_ms});
  if(!hasProviderAdapter(scope.provider,pool.runtime))fail('PROVIDER_UNAVAILABLE','No actual trusted adapter is registered');
  const prior=await c.query('SELECT request_digest,state FROM hyperfide.provider_remote_operations WHERE organisation_id=$1 AND id=$2',[config.organisation_id,id]);
  if(prior.rows.length){if(prior.rows[0]!.request_digest!==digestDocument(i))fail('IDEMPOTENCY_CONFLICT','Remote operation identity was reused');fail('REMOTE_OPERATION_RECONCILIATION_REQUIRED','A submitted remote command cannot be blindly replayed');}
  await c.query("INSERT INTO hyperfide.provider_remote_operations(organisation_id,run_id,id,session_id,sandbox_id,boot_generation,request_digest,operation,runner_binding_evidence_digest,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUBMITTING')",
   [config.organisation_id,run,id,session,sandbox,current.boot_generation,digestDocument(i),operationValue,bindingDigest]);
  await c.query('UPDATE hyperfide.sandboxes SET work_admitted=true,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2',[config.organisation_id,sandbox]);
  return operationValue;
 });
 const unavailable=async()=>fail('PROVIDER_HOOK_UNAVAILABLE','Remote command cannot create provider resources');
 const record=async(observedOperation:ProviderOperation,outcome:ProviderOutcome)=>{
  validateProviderOutcome({operation:observedOperation,outcome});
  if(digestDocument(observedOperation)!==digestDocument(op))fail('OBSERVATION_SCOPE_MISMATCH','Remote command observation identity differs');
  await transaction(pool,async c=>{
   await c.query("UPDATE hyperfide.provider_remote_operations SET state=$3,outcome=$4,process_record=CASE WHEN process_record IS NULL THEN NULL ELSE jsonb_set(process_record,'{state}',to_jsonb($5::text)) END,updated_at=clock_timestamp() WHERE organisation_id=$1 AND id=$2 AND (outcome IS NULL OR outcome->>'status'<>'SUCCEEDED')",
    [config.organisation_id,id,outcome.status==='UNKNOWN'?'UNKNOWN':'OBSERVED',outcome,outcome.status==='SUCCEEDED'&&'phase' in outcome.result?(outcome.result.phase==='EXITED'?'EXITED':'RUNNING'):'UNKNOWN']);
  });
 };
 const adapter=providerAdapter(op.scope,{...remoteProcessHooks(pool,config.organisation_id,run,id),invocation:providerInvocation(pool),resolveResourceBinding:observed=>resolveSandboxBinding(pool,config,run,sandbox,observed),resolvePreparation:unavailable,assertResourceBinding:async observed=>{
  if(digestDocument(observed)!==digestDocument(op))fail('PROVIDER_SCOPE_MISMATCH','Remote operation changed');
  await transaction(pool,async c=>{const proof=await pool.runtime.runnerBindingVerifier!(c,b as ProviderRunnerBinding);if(!proof)fail('RUNNER_BINDING_STALE','Runner binding expired');const current=(await c.query('SELECT native_sandbox_id,boot_generation FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 FOR SHARE',[config.organisation_id,sandbox])).rows[0];if(!current||current.native_sandbox_id!==b.external_sandbox_id||String(current.boot_generation)!==b.boot_generation)fail('STALE_SANDBOX_GENERATION','Remote resource boot changed');});
 },assignedBootGeneration:unavailable,persistEarlyResource:unavailable,recordObservation:record},pool.runtime) as ReturnType<typeof providerAdapter>&{
  readCapturedOutput?:(scope:ProviderOperation['scope'],resource:ResourceRef,processRef:string,maxBytes:number)=>Promise<CapturedProviderOutput>;
 };
 // Verify capture support before any command side effect.
 if(typeof adapter.readCapturedOutput!=='function'){await record(op,unknownOutcome(op,op.resource));fail('REMOTE_CAPTURE_UNAVAILABLE','Actual complete provider capture is required');}
 const combined=AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Date.parse(op.deadline_at)-Date.now()))]);
 try{
  const outcome=await boundedProvider(adapter.execute(op,combined),combined,op.deadline_at);await record(op,outcome);
  if(outcome.status!=='SUCCEEDED'||outcome.result.phase!=='EXITED'||outcome.result.exit_code===null||!outcome.result.output.complete||outcome.result.output.truncated)
   fail('REMOTE_OUTPUT_INCOMPLETE','Command outcome/output is incomplete or requires reconciliation');
  const captured=await boundedProvider(adapter.readCapturedOutput(op.scope,op.resource!,outcome.result.process_ref,16*1024*1024),combined,op.deadline_at);
  if(!(captured.stdout instanceof Uint8Array)||!(captured.stderr instanceof Uint8Array)||captured.complete!==true||captured.exit_code!==outcome.result.exit_code||captured.stdout.byteLength+captured.stderr.byteLength>16*1024*1024)
   fail('REMOTE_OUTPUT_INCOMPLETE','Actual captured bytes do not match terminal process outcome');
  return{operation:op,outcome,process_ref:outcome.result.process_ref,scope:op.scope,resource:op.resource,captured,
   evidence_digest:digestDocument({operation:op,outcome,spool_digest:captured.spool_digest}),cleanup_confirmed:outcome.result.termination_confirmed};
 }catch(error){await record(op,unknownOutcome(op,op.resource));throw error;}
}
export async function observeKnownSandbox(pool:ProviderDatabase,config:DeploymentConfig,value:unknown,signal:AbortSignal):Promise<unknown>{
 const i=obj(value,['sandbox_id','boot_generation']),sandbox=uuid(i.sandbox_id),generation=str(i.boot_generation,19);
 const rows=await pool.query("SELECT * FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND sandbox_id=$2 AND boot_generation=$3 AND kind='CREATE' AND native_sandbox_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",[config.organisation_id,sandbox,generation]);
 const row=rows.rows[0] as Intent|undefined;if(row)assertInvocationRun(pool,row.run_id);if(!row)fail('RESOURCE_OWNERSHIP_UNKNOWN','Known durable create ownership is required');
 const {scope}=await currentPool(pool,config,row.pool_id);
 if(digestDocument(scope)!==digestDocument(row.operation.scope))fail('POOL_CONFIG_CHANGED','Original resource configuration changed');
 const op=operation('observe',scope,randomUUID(),new Date(Date.now()+config.maximum_operation_ms).toISOString(),
  {native_sandbox_id:row.native_sandbox_id!,sandbox_boot_generation:String(row.boot_generation)},row.operation.preparation_digest,{},row.id);
 const hooks=persistenceHooks(pool,config.organisation_id,row.id),adapter=providerAdapter(scope,hooks,pool.runtime);
 let outcome:ProviderOutcome<'observe'>;
 try{outcome=await boundedProvider(adapter.observe(op,signal),signal,op.deadline_at);}
 catch{outcome=unknownOutcome(op,op.resource) as ProviderOutcome<'observe'>;}
 await hooks.recordObservation(op,outcome);
 return{operation:op,outcome,evidence_digest:digestDocument({operation:op,outcome}),complete:outcome.status==='SUCCEEDED',absence_authorized:false};
}
export async function readConfirmedAbsence(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;reservation_id:string}):Promise<{id:string;digest:string;observed_at:string}|null>{
 assertPrimaryTransaction(tx);uuid(input.organisation_id);uuid(input.run_id);uuid(input.reservation_id);
 const rows=await tx.query("SELECT o.id,o.evidence_digest AS digest,o.observed_at FROM hyperfide.provisioning_intent_reservations l JOIN hyperfide.provisioning_intents c ON c.organisation_id=l.organisation_id AND c.run_id=l.run_id AND c.id=l.intent_id JOIN hyperfide.provisioning_intents oi ON oi.organisation_id=c.organisation_id AND oi.sandbox_id=c.sandbox_id AND oi.boot_generation=c.boot_generation AND oi.native_sandbox_id=c.native_sandbox_id JOIN hyperfide.provider_observations o ON o.organisation_id=oi.organisation_id AND o.intent_id=oi.id WHERE l.organisation_id=$1 AND l.run_id=$2 AND l.reservation_id=$3 AND c.kind='CREATE' AND c.state='TERMINAL' AND oi.state='TERMINAL' AND o.observation->'operation'->>'kind'='observe' AND o.observation->'outcome'->>'status'='SUCCEEDED' AND o.observation->'outcome'->>'acceptance'='CONFIRMED_ACCEPTED' AND o.observation->'outcome'->'result'->>'provider_state'='DESTROYED' AND o.observation->'outcome'->'result'->>'health'='ABSENT' AND o.observation->'outcome'->'resource'->>'native_sandbox_id'=c.native_sandbox_id AND o.observation->'outcome'->'resource'->>'sandbox_boot_generation'=c.boot_generation::text ORDER BY o.observed_at DESC LIMIT 1",
  [input.organisation_id,input.run_id,input.reservation_id]);
 const row=rows.rows[0];return row?{id:row.id,digest:row.digest,observed_at:new Date(row.observed_at).toISOString()}:null;
}
export function createComponent(context:ComponentContext):Component {
  const database=providerDatabase(context);
  const provisioner=()=>{if(context.role!=='provisioner')fail('ROLE_FORBIDDEN','Execution requires the provisioner worker');};
  const guarded=(fn:(input:unknown,config:DeploymentConfig,database:ProviderDatabase)=>Promise<unknown>)=>async(input:unknown,requestContext:ComponentContext)=>{
    if(context.signal.aborted)fail('PROVIDER_CLOSED','Provider coordinator is shutting down');
    const config=await readDeployment(context.env);return fn(input,config,bindProviderInvocation(database,config,invocationOf(requestContext)));
  };
  return{apiVersion:1,capabilities:{'provider.intents.v1':{
 registerDestructionPreflight:(reader:ProviderDestructionPreflight)=>{if(typeof reader!=='function'||database.runtime.destructionPreflight)fail('PROVIDER_REGISTRATION_CONFLICT','Destruction custody reader must be installed once');database.runtime.destructionPreflight=reader;return()=>{if(database.runtime.destructionPreflight===reader)delete database.runtime.destructionPreflight;};},
 preparationParameters:async(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext)=>preparationParameters(tx,await readDeployment(context.env),input,invocation),
 prepareCreateTx:async(tx:PrimaryTransaction,input:unknown,invocation:InvocationContext)=>prepareCreateTx(tx,await readDeployment(context.env),input,invocation),
 getIntent:async(id:string,invocation:InvocationContext)=>{const c=await readDeployment(context.env),db=bindProviderInvocation(database,c,invocation);const row=await intent(db,c.organisation_id,id);assertInvocationRun(db,row.run_id);return row;},readConfirmedAbsence
 },...(context.role==='provisioner'?{'provider.execution.v1':{
 registerDestructionPreflight:(reader:ProviderDestructionPreflight)=>{if(typeof reader!=='function'||database.runtime.destructionPreflight)fail('PROVIDER_REGISTRATION_CONFLICT','Destruction custody reader must be installed once');database.runtime.destructionPreflight=reader;return()=>{if(database.runtime.destructionPreflight===reader)delete database.runtime.destructionPreflight;};},
 registerRunnerBindingVerifier:(reader:ProviderRunnerBindingVerifier)=>{if(typeof reader!=='function'||database.runtime.runnerBindingVerifier)fail('PROVIDER_REGISTRATION_CONFLICT','Runner reader must be registered once');database.runtime.runnerBindingVerifier=reader;return()=>{if(database.runtime.runnerBindingVerifier===reader)delete database.runtime.runnerBindingVerifier;};},
 executeIntent:async(id:string,signal:AbortSignal,invocation:InvocationContext)=>{const c=await readDeployment(context.env);return executeIntent(bindProviderInvocation(database,c,invocation,['PROVISIONER']),c,id,signal);},
 reconcileIntent:async(id:string,signal:AbortSignal,invocation:InvocationContext)=>{const c=await readDeployment(context.env);return reconcileIntent(bindProviderInvocation(database,c,invocation,['PROVISIONER']),c,id,signal);},
 executeBound:async(input:unknown,signal:AbortSignal,invocation:InvocationContext)=>{const c=await readDeployment(context.env);return executeBound(bindProviderInvocation(database,c,invocation,['PROVISIONER']),c,input,signal);},
 observeKnownSandbox:async(input:unknown,signal:AbortSignal,invocation:InvocationContext)=>{const c=await readDeployment(context.env);return observeKnownSandbox(bindProviderInvocation(database,c,invocation,['PROVISIONER']),c,input,signal);}
 }}:{})},actions:{
    'provider.intents.prepare-create':guarded((input,c,database)=>{if(!['OPERATOR','COORDINATOR','PROVISIONER'].includes(providerInvocation(database).principal.role))fail('AUTH_SCOPE_DENIED','Direct provider admission requires coordinator authority');return prepareCreate(database,c,input);}),
    'provider.intents.prepare-destroy':guarded((input,c,database)=>{if(!['OPERATOR','COORDINATOR','PROVISIONER'].includes(providerInvocation(database).principal.role))fail('AUTH_SCOPE_DENIED','Direct provider teardown requires coordinator authority');return prepareDestroy(database,c,input);}),
    'provider.intents.get':guarded(async(input,c,database)=>{const i=obj(input,['intent_id']);const row=await intent(database,c.organisation_id,uuid(i.intent_id));assertInvocationRun(database,row.run_id);return row;}),
    'provider.intents.execute':guarded(async(input,c,database)=>{provisioner();if(providerInvocation(database).principal.role!=='PROVISIONER')fail('AUTH_SCOPE_DENIED','Provider effects require the provisioner principal');const i=obj(input,['intent_id']);return executeIntent(database,c,uuid(i.intent_id),context.signal);}),
    'provider.intents.reconcile':guarded(async(input,c,database)=>{provisioner();if(providerInvocation(database).principal.role!=='PROVISIONER')fail('AUTH_SCOPE_DENIED','Provider effects require the provisioner principal');const i=obj(input,['intent_id']);return reconcileIntent(database,c,uuid(i.intent_id),context.signal);}),
    'provider.remote.execute-bound':()=>fail('TRUSTED_CAPABILITY_ONLY','Remote commands are admitted only by the trusted runner executor'),
    'provider.inventory.observe-known':guarded(async(input,c,database)=>{provisioner();if(providerInvocation(database).principal.role!=='PROVISIONER')fail('AUTH_SCOPE_DENIED','Inventory requires the provisioner principal');return observeKnownSandbox(database,c,input,context.signal);}),
    'provider.orphans.list':guarded(async(input,c,database)=>{const i=obj(input,['pool_id']);await currentPool(database,c,uuid(i.pool_id));return(await database.query('SELECT native_sandbox_id,state,ownership_evidence_digest,first_observed_at,last_observed_at FROM hyperfide.provider_orphans WHERE organisation_id=$1 AND pool_id=$2',[c.organisation_id,i.pool_id])).rows;}),
  }};
}
