import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {record,scopeOf,uuid,positive,digest,timestamp,fail,inputDigest,recoveryTransaction,operationReplay,finishOperation,isRecoverySnapshotReader,capability,isExecutionControls,type RecoveryScope,type RecoveryTransaction} from './control.js';

// Inventory states that prove absence resolve a debt; anything else stays an explicit open survivor.
const OBSERVED:Record<string,{absent:string[];present:string[]}>={SUPERVISOR:{absent:['STOPPED'],present:['RUNNING','UNREACHABLE']},SANDBOX:{absent:['ABSENT'],present:['PRESENT','UNREACHABLE']}};
const REQUEST_COLUMNS='id,task_id,source_attempt_id,source_attempt_generation,source_boot_generation,authority_epoch,state,state_version,checkpoint_id,replacement_attempt_id,replacement_attempt_generation,hold_reason,restoration_digest,restoration,enrollment,outputs,created_at,updated_at';
function text(value:unknown,limit=255):string{if(typeof value!=='string'||value.length<1||value.length>limit)fail('RECOVERY_INPUT_INVALID','Bounded identifier required');return value;}
function leaseMs(value:unknown):number{if(typeof value!=='number'||!Number.isInteger(value)||value<1000||value>300000)fail('RECOVERY_INPUT_INVALID','lease_ms must be an integer between 1000 and 300000');return value;}
async function lockRequest(tx:RecoveryTransaction,scope:RecoveryScope,id:string):Promise<Record<string,unknown>>{
 const row=(await tx.query('SELECT '+REQUEST_COLUMNS+' FROM hyperfide.recovery_replacement_requests WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,id])).rows[0];
 if(!row)fail('RECOVERY_REQUEST_NOT_FOUND','No durable worker restoration request');
 return row;
}
/** Records exact inventory for every debt the loss opened; absence is only accepted when it was observed. */
async function recordInventory(tx:RecoveryTransaction,scope:RecoveryScope,lossId:string,input:unknown):Promise<{observed:Record<string,unknown>[];surviving:Record<string,unknown>[]}>{
 if(!Array.isArray(input)||input.length>64)fail('RECOVERY_INPUT_INVALID','Inventory must be a bounded list');
 const debts=(await tx.query('SELECT id,resource_kind,resource_id,status,observed_state FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 ORDER BY resource_kind,resource_id FOR UPDATE',[scope.organisation_id,scope.run_id,lossId])).rows;
 const reported=new Map<string,Record<string,unknown>>();
 for(const item of input){
  const value=record(item,['resource_kind','resource_id','observed_state','evidence_digest']),kind=String(value.resource_kind),key=kind+':'+uuid(value.resource_id);
  if(!OBSERVED[kind]||![...OBSERVED[kind]!.absent,...OBSERVED[kind]!.present].includes(String(value.observed_state)))fail('RECOVERY_INPUT_INVALID','Unsupported inventory observation');
  digest(value.evidence_digest);if(reported.has(key))fail('RECOVERY_INPUT_INVALID','Duplicate inventory observation');reported.set(key,value);
 }
 if(reported.size!==debts.length||debts.some(debt=>!reported.has(debt.resource_kind+':'+debt.resource_id)))fail('RECOVERY_INVENTORY_INCOMPLETE','Inventory must observe every lost process and sandbox exactly');
 const observed=[],surviving=[];
 for(const debt of debts){
  const value=reported.get(debt.resource_kind+':'+debt.resource_id)!,state=String(value.observed_state),absent=OBSERVED[debt.resource_kind]!.absent.includes(state);
  if(debt.status==='RESOLVED'){if(debt.observed_state!==state)fail('RECOVERY_INVENTORY_CONFLICT','Resolved absence cannot be contradicted');}
  else await tx.query("UPDATE hyperfide.recovery_resource_debts SET observed_state=$4,evidence_digest=$5,observed_at=clock_timestamp(),status=$6,resolved_at=CASE WHEN $6='RESOLVED' THEN clock_timestamp() END,command_generation=command_generation+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,debt.id,state,value.evidence_digest,absent?'RESOLVED':'RECONCILING']);
  const entry={resource_kind:debt.resource_kind,resource_id:debt.resource_id,observed_state:state,status:absent?'RESOLVED':'RECONCILING'};
  observed.push(entry);if(!absent)surviving.push(entry);
 }
 return {observed,surviving};
}
/** Checkpoint, environment and target-boot compatibility. Every mismatch is a reason for an explicit hold. */
async function compatibility(tx:RecoveryTransaction,scope:RecoveryScope,source:Record<string,unknown>,checkpointId:string,target:Record<string,unknown>):Promise<{reasons:string[];checkpoint:Record<string,unknown>|undefined}>{
 const reasons:string[]=[];
 const checkpoint=(await tx.query('SELECT c.id,c.attempt_id,c.attempt_generation,c.agent_session_id,c.artifact_id,c.repository_id,c.source_object_id,c.input_packet_digest,c.support_level,c.preparation_digest,c.registration_operation_id,a.status AS artifact_status,a.digest AS artifact_digest,s.native_session_id,s.connector,s.account_key FROM hyperfide.checkpoints c JOIN hyperfide.artifacts a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.id=c.artifact_id LEFT JOIN hyperfide.agent_sessions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.agent_session_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3 FOR SHARE OF c,a',[scope.organisation_id,scope.run_id,checkpointId])).rows[0];
 if(!checkpoint)reasons.push('CHECKPOINT_MISSING');
 else{
  if(checkpoint.attempt_id!==source.id||checkpoint.attempt_generation!==source.generation)reasons.push('CHECKPOINT_FOREIGN_ATTEMPT');
  if(!checkpoint.registration_operation_id||!checkpoint.preparation_digest)reasons.push('CHECKPOINT_UNREGISTERED');
  if(checkpoint.artifact_status!=='COMPLETE')reasons.push('CHECKPOINT_ARTIFACT_UNAVAILABLE');
  if(checkpoint.support_level==='UNSUPPORTED')reasons.push('CHECKPOINT_UNSUPPORTED');
  if(checkpoint.source_object_id!==target.source_object_id)reasons.push('SOURCE_OBJECT_MISMATCH');
  if(checkpoint.input_packet_digest!==target.input_packet_digest||checkpoint.input_packet_digest!==source.input_packet_digest)reasons.push('INPUT_PACKET_MISMATCH');
  if(checkpoint.preparation_digest!==target.environment_digest)reasons.push('ENVIRONMENT_MISMATCH');
  if(target.native_session_id!==null&&(checkpoint.support_level!=='NATIVE_RESUME'||checkpoint.native_session_id!==target.native_session_id))reasons.push('NATIVE_SESSION_INCOMPATIBLE');
 }
 const slot=(await tx.query('SELECT w.state,w.capacity_kind,w.boot_generation,s.boot_generation AS sandbox_boot_generation,s.desired_state,s.observed_state,s.preparation_digest FROM hyperfide.worker_slots w JOIN hyperfide.sandboxes s ON s.organisation_id=w.organisation_id AND s.id=w.sandbox_id WHERE w.organisation_id=$1 AND w.sandbox_id=$2 AND w.id=$3 FOR UPDATE OF w',[scope.organisation_id,target.sandbox_id,target.slot_id])).rows[0];
 if(!slot||slot.state!=='READY'||slot.capacity_kind!=='AGENT'||slot.boot_generation!==target.sandbox_boot_generation||slot.sandbox_boot_generation!==target.sandbox_boot_generation||slot.desired_state!=='RUNNING'||slot.observed_state!=='RUNNING')reasons.push('TARGET_SLOT_UNAVAILABLE');
 else if(slot.preparation_digest!==target.environment_digest)reasons.push('TARGET_ENVIRONMENT_MISMATCH');
 if(target.sandbox_id===source.sandbox_id&&target.sandbox_boot_generation===source.sandbox_boot_generation)reasons.push('TARGET_IS_LOST_BOOT');
 return {reasons,checkpoint};
}
/** The task's restoration lineage; normal attempts never enter this recovery-only authority path. */
async function lineage(tx:RecoveryTransaction,scope:RecoveryScope,attempt:string):Promise<{attempt:Record<string,unknown>;requests:Record<string,unknown>[]}>{
 const row=(await tx.query('SELECT a.id,a.task_id,a.generation,a.compute_authority,a.sandbox_id,a.slot_id,a.sandbox_boot_generation,t.current_attempt_id,t.generation AS task_generation FROM hyperfide.attempts a JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 FOR UPDATE OF a,t',[scope.organisation_id,scope.run_id,attempt])).rows[0];
 if(!row)fail('RECOVERY_ATTEMPT_UNKNOWN','Attempt identity is not registered in this run');
 const requests=(await tx.query('SELECT '+REQUEST_COLUMNS+' FROM hyperfide.recovery_replacement_requests WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 ORDER BY created_at,id FOR UPDATE',[scope.organisation_id,scope.run_id,row.task_id])).rows;
 if(!requests.some(request=>request.source_attempt_id===attempt||request.replacement_attempt_id===attempt))fail('RECOVERY_REQUEST_NOT_FOUND','Attempt is outside any worker restoration lineage');
 return {attempt:row,requests};
}
/** Current authority is decided only from primary state and primary time; worker clocks are never consulted. */
async function currentAuthority(tx:RecoveryTransaction,scope:RecoveryScope,attempt:Record<string,unknown>,generation:string,boot:string,session:string):Promise<{reason:string|null;lease?:Record<string,unknown>;primary_now:string}>{
 const clock=(await tx.query('SELECT clock_timestamp()::text AS primary_now')).rows[0]!.primary_now as string;
 if(attempt.current_attempt_id!==attempt.id||attempt.task_generation!==generation||attempt.generation!==generation)return {reason:'STALE_GENERATION',primary_now:clock};
 if(attempt.sandbox_boot_generation!==boot)return {reason:'IDENTITY_MISMATCH',primary_now:clock};
 if(attempt.compute_authority!=='CURRENT')return {reason:'NO_COMPUTE_AUTHORITY',primary_now:clock};
 const actor=await tx.query("SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND role='WORKER' AND state='RUNNING' AND attempt_id=$4 AND sandbox_id=$5 AND slot_id=$6 AND sandbox_boot_generation=$7",[scope.organisation_id,scope.run_id,session,attempt.id,attempt.sandbox_id,attempt.slot_id,boot]);
 if(actor.rows.length!==1)return {reason:'IDENTITY_MISMATCH',primary_now:clock};
 const lease=(await tx.query("SELECT id,expires_at::text,expires_at>clock_timestamp() AS live FROM hyperfide.compute_leases WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND attempt_generation=$4 AND sandbox_boot_generation=$5 AND state='ACTIVE' FOR UPDATE",[scope.organisation_id,scope.run_id,attempt.id,generation,boot])).rows[0];
 if(!lease)return {reason:'NO_COMPUTE_AUTHORITY',primary_now:clock};
 if(lease.live!==true)return {reason:'LEASE_EXPIRED',lease,primary_now:clock};
 return {reason:null,lease,primary_now:clock};
}

export function createComponent(_context:ComponentContext):Component{
 return {apiVersion:1,actions:{
  'recovery.worker.describe':(input,context)=>{record(input,[]);return {api_version:1,loss_revokes_compute:true,accepted_custody_survives:true,unknown_external_effects:'RECONCILE',automatic_replacement:false,restoration:'INVENTORY_THEN_COMPATIBLE_CHECKPOINT_TO_NEW_ATTEMPT',replacement_authority:'ENROLLMENT_REQUIRED',stale_outputs:'ARCHIVE_PROVENANCE_ONLY',worker_timestamps_trusted:false,uncertainty_policy:'UNOBSERVED_SURVIVORS_STAY_OPEN_DEBTS_FENCED_BY_PRIMARY_GENERATION'};},
  'recovery.worker.loss':async(input,context)=>{
   const value=record(input,['scope','operation_id','attempt_id','attempt_generation','sandbox_boot_generation']);
   const scope=scopeOf(value.scope),id=uuid(value.operation_id),attempt=uuid(value.attempt_id),generation=positive(value.attempt_generation),boot=positive(value.sandbox_boot_generation);
   return recoveryTransaction(context,scope,async tx=>{
    const replay=await operationReplay(tx,scope,id,'WORKER_LOSS',value);if(replay)return replay;
    const selected=await tx.query('SELECT a.*,t.current_attempt_id,t.generation AS task_generation FROM hyperfide.attempts a JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 FOR UPDATE OF a,t',[scope.organisation_id,scope.run_id,attempt]);
    const row=selected.rows[0];
    if(!row||row.generation!==generation||row.sandbox_boot_generation!==boot||row.authority_epoch!==scope.authority_epoch)
     throw new FoundationError('RECOVERY_STALE_ATTEMPT','Loss report does not identify the exact current attempt and boot');
    if(row.current_attempt_id!==attempt||row.task_generation!==generation)
     throw new FoundationError('RECOVERY_SUPERSEDED_ATTEMPT','Attempt was superseded; retain outputs as provenance only');
    const custody=await tx.query("SELECT id,custody_generation,qualification_outcome FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND source_attempt_id=$3 AND source_generation=$4 AND authority='ACTIVE'",[scope.organisation_id,scope.run_id,attempt,generation]);
    let replacementGate:unknown=null;
    if(custody.rows.length===0){
     const gate=capability(context,'5.1','scheduler.controls.v1',isExecutionControls);
     replacementGate=await gate.applyExecutionControl(tx,scope,{scope_kind:'ATTEMPT',scope_id:attempt,mode:'STOP',operation_id:id,reason:'Lost source requires verified inventory and checkpoint compatibility before replacement'});
    }
    await tx.query("UPDATE hyperfide.compute_leases SET state='REVOKED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state='ACTIVE'",[scope.organisation_id,scope.run_id,attempt]);
    await tx.query("UPDATE hyperfide.attempts SET compute_authority='REVOKED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND compute_authority IN ('CURRENT','EXPIRED')",[scope.organisation_id,scope.run_id,attempt]);
    await tx.query("UPDATE hyperfide.slot_allocations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state='ACTIVE'",[scope.organisation_id,scope.run_id,attempt]);
    const expiredJobs=await tx.query("UPDATE hyperfide.qualification_jobs SET state='PENDING',lease_generation=lease_generation+1,lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND custody_id IN (SELECT id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND source_attempt_id=$3 AND authority='ACTIVE') AND state='RUNNING' AND lease_expires_at<=clock_timestamp() RETURNING id,lease_generation",[scope.organisation_id,scope.run_id,attempt]);
    const sessions=await tx.query("SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state NOT IN ('STOPPED','FAILED')",[scope.organisation_id,scope.run_id,attempt]);
    for(const session of sessions.rows)await tx.query("INSERT INTO hyperfide.recovery_resource_debts(organisation_id,run_id,operation_id,resource_kind,resource_id,sandbox_boot_generation,desired_state,detail) VALUES($1,$2,$3,'SUPERVISOR',$4,$5,'STOPPED','Lost or partitioned process must be observed before replacement')",[scope.organisation_id,scope.run_id,id,session.id,boot]);
    if(row.sandbox_id)await tx.query("INSERT INTO hyperfide.recovery_resource_debts(organisation_id,run_id,operation_id,resource_kind,resource_id,sandbox_boot_generation,desired_state,detail) VALUES($1,$2,$3,'SANDBOX',$4,$5,'INVENTORIED','Inventory exact resource and boot; absence is not inferred')",[scope.organisation_id,scope.run_id,id,row.sandbox_id,boot]);
    if(custody.rows.length===0){
     // Revocation makes the task eligible for the normal scheduler; unresolved process/capacity stays held.
     await tx.query("UPDATE hyperfide.tasks SET state='STALE',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND current_attempt_id=$4 AND generation=$5 AND state NOT IN ('INTEGRATED','CANCELLED')",[scope.organisation_id,scope.run_id,row.task_id,attempt,generation]);
    }
    if(custody.rows.length===0)await tx.query("INSERT INTO hyperfide.recovery_replacement_requests(organisation_id,run_id,id,task_id,source_attempt_id,source_attempt_generation,source_boot_generation,authority_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[scope.organisation_id,scope.run_id,id,row.task_id,attempt,generation,boot,scope.authority_epoch]);
    const result={scope,attempt_id:attempt,compute_authority:['CURRENT','EXPIRED'].includes(String(row.compute_authority))?'REVOKED':row.compute_authority,preserved_submission_custody:custody.rows,qualification_jobs_requeued:expiredJobs.rows,
     restoration_request:custody.rows.length===0?{id,state:'WAITING_INVENTORY',authority:'NONE'}:null,replacement_gate:replacementGate,normal_scheduler_recovery_pending:custody.rows.length===0,recovery_operation_id:id,task_id:row.task_id,replacement_authorized:false,requires: custody.rows.length?'RECOVER_QUALIFICATION_UNDER_ITS_OWN_LEASE':'EXTERNAL_INVENTORY_AND_COMPATIBLE_CHECKPOINT',
     stale_outputs:'ARCHIVE_PROVENANCE_ONLY',publication_authorized:false};
    await finishOperation(tx,scope,id,result);return result;
   });
  },
  'recovery.worker.restoration.inspect':async(input,context)=>{const value=record(input,['scope','loss_operation_id']),scope=scopeOf(value.scope),id=uuid(value.loss_operation_id);return recoveryTransaction(context,scope,async tx=>{const rows=await tx.query('SELECT '+REQUEST_COLUMNS+' FROM hyperfide.recovery_replacement_requests WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,id]);if(!rows.rows.length)throw new FoundationError('RECOVERY_REQUEST_NOT_FOUND','No durable worker restoration request');const request=rows.rows[0]!;return {request,replacement_authorized:request.state==='READY',context_restored:request.state==='READY',authority:request.enrollment?'ENROLLED_REPLACEMENT_ONLY':'NONE'};},false,true);},
  // Inventory, compatibility, RESTORING and READY are one primary transaction; incompatible checkpoints are explicitly HELD.
  'recovery.worker.restore':async(input,context)=>{
   const value=record(input,['scope','loss_operation_id','checkpoint_id','inventory','target']);
   const scope=scopeOf(value.scope),id=uuid(value.loss_operation_id),checkpointId=uuid(value.checkpoint_id);
   const raw=record(value.target,['source_object_id','input_packet_digest','environment_digest','native_session_id','sandbox_id','slot_id','sandbox_boot_generation']);
   if(typeof raw.source_object_id!=='string'||!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(raw.source_object_id))fail('RECOVERY_INPUT_INVALID','Git object id required');
   const target={source_object_id:raw.source_object_id,input_packet_digest:digest(raw.input_packet_digest),environment_digest:digest(raw.environment_digest),native_session_id:raw.native_session_id===null?null:text(raw.native_session_id),sandbox_id:uuid(raw.sandbox_id),slot_id:uuid(raw.slot_id),sandbox_boot_generation:positive(raw.sandbox_boot_generation)};
   const hash=inputDigest(value);
   return recoveryTransaction(context,scope,async tx=>{
    const request=await lockRequest(tx,scope,id);
    if(request.restoration_digest===hash&&['READY','HELD'].includes(String(request.state)))return {...(request.restoration as object),replayed:true};
    if(request.state!=='WAITING_INVENTORY'&&request.state!=='HELD')fail(request.state==='READY'?'RECOVERY_IDEMPOTENCY_CONFLICT':'RECOVERY_REQUEST_STATE_INVALID','Restoration request is not awaiting inventory or a compatible checkpoint');
    const source=(await tx.query('SELECT a.*,t.current_attempt_id,t.generation AS task_generation,t.state AS task_state FROM hyperfide.attempts a JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 FOR UPDATE OF a,t',[scope.organisation_id,scope.run_id,request.source_attempt_id])).rows[0]!;
    if(source.current_attempt_id!==source.id||source.task_generation!==request.source_attempt_generation)fail('RECOVERY_SUPERSEDED_ATTEMPT','Another attempt already owns this task');
    if(source.compute_authority==='CURRENT')fail('RECOVERY_SOURCE_NOT_FENCED','Lost compute authority must be fenced before replacement');
    const custody=await tx.query("SELECT id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND authority='ACTIVE'",[scope.organisation_id,scope.run_id,source.task_id]);
    if(custody.rows.length)fail('ACTIVE_SUBMISSION_CUSTODY','Admitted custody recovers under its own qualification lease');
    const inventory=await recordInventory(tx,scope,id,value.inventory);
    const preserved=(await tx.query("SELECT 'CHECKPOINT' AS kind,c.id,c.artifact_id,a.digest,a.status FROM hyperfide.checkpoints c JOIN hyperfide.artifacts a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.id=c.artifact_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.attempt_id=$3 UNION ALL SELECT 'EVIDENCE',e.id,e.artifact_id,a.digest,a.status FROM hyperfide.evidence e JOIN hyperfide.artifacts a ON a.organisation_id=e.organisation_id AND a.run_id=e.run_id AND a.id=e.artifact_id WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.attempt_id=$3 ORDER BY 1,2 LIMIT 1001",[scope.organisation_id,scope.run_id,source.id])).rows;
    const {reasons,checkpoint}=await compatibility(tx,scope,source,checkpointId,target);
    const common={request_id:id,task_id:source.task_id,source_attempt:{id:source.id,generation:source.generation,sandbox_id:source.sandbox_id,sandbox_boot_generation:source.sandbox_boot_generation,compute_authority:source.compute_authority,renewable:false},
     inventory:{observed:inventory.observed,surviving:inventory.surviving,surviving_fenced_by:'PRIMARY_TASK_GENERATION'},preserved_artifacts:preserved,stale_outputs:'ARCHIVE_PROVENANCE_ONLY'};
    if(reasons.length){
     const held={...common,state:'HELD',hold_reason:reasons.join(','),reasons,replacement_attempt:null,replacement_authorized:false,authority:'NONE',publication_authorized:false};
     await tx.query("UPDATE hyperfide.recovery_replacement_requests SET state='HELD',hold_reason=$4,restoration_digest=$5,restoration=$6::jsonb,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,id,held.hold_reason,hash,JSON.stringify(held)]);
     return held;
    }
    const attempt=randomUUID(),generation=(BigInt(String(source.task_generation))+1n).toString();
    await tx.query("INSERT INTO hyperfide.attempts(organisation_id,run_id,id,task_id,generation,authority_epoch,input_packet_digest,execution_state,compute_authority,sandbox_id,slot_id,sandbox_boot_generation) VALUES($1,$2,$3,$4,$5,$6,$7,'RESERVED','RELEASED',$8,$9,$10)",[scope.organisation_id,scope.run_id,attempt,source.task_id,generation,scope.authority_epoch,target.input_packet_digest,target.sandbox_id,target.slot_id,target.sandbox_boot_generation]);
    await tx.query("UPDATE hyperfide.tasks SET generation=$4,current_attempt_id=$5,state='RESERVED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,source.task_id,generation,attempt]);
    await tx.query("UPDATE hyperfide.worker_slots SET state='ALLOCATED',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",[scope.organisation_id,target.slot_id]);
    const ready={...common,state:'READY',transitions:[String(request.state),'RESTORING','READY'],hold_reason:null,reasons:[],
     checkpoint:{id:checkpoint!.id,artifact_id:checkpoint!.artifact_id,artifact_digest:checkpoint!.artifact_digest,support_level:checkpoint!.support_level,source_object_id:checkpoint!.source_object_id,environment_digest:checkpoint!.preparation_digest,native_session_id:target.native_session_id,mode:target.native_session_id===null?'SOURCE_ONLY':'NATIVE_RESUME'},
     replacement_attempt:{id:attempt,generation,sandbox_id:target.sandbox_id,slot_id:target.slot_id,sandbox_boot_generation:target.sandbox_boot_generation,compute_authority:'RELEASED'},
     replacement_authorized:true,authority:'NONE',requires:'ENROLLMENT',publication_authorized:false,context_adoption:'artifact.adoption.adopt'};
    await tx.query("UPDATE hyperfide.recovery_replacement_requests SET state='RESTORING',checkpoint_id=$4,replacement_attempt_id=$5,replacement_attempt_generation=$6,hold_reason=NULL,restoration_digest=$7,restoration=$8::jsonb,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,id,checkpointId,attempt,generation,hash,JSON.stringify(ready)]);
    await tx.query("UPDATE hyperfide.recovery_replacement_requests SET state='READY',updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,id]);
    return ready;
   });
  },
  // A restored attempt has no authority until its exact new identity enrolls once from its own boot.
  'recovery.worker.enroll':async(input,context)=>{
   const value=record(input,['scope','loss_operation_id','attempt_id','attempt_generation','sandbox_id','slot_id','sandbox_boot_generation','native_session_id','lease_ms']);
   const scope=scopeOf(value.scope),id=uuid(value.loss_operation_id),attempt=uuid(value.attempt_id),generation=positive(value.attempt_generation),sandbox=uuid(value.sandbox_id),slot=uuid(value.slot_id),boot=positive(value.sandbox_boot_generation),native=text(value.native_session_id),duration=leaseMs(value.lease_ms),hash=inputDigest(value);
   return recoveryTransaction(context,scope,async tx=>{
    const request=await lockRequest(tx,scope,id);
    if(request.state!=='READY')fail('RECOVERY_NOT_RESTORED','Replacement is not restored from a compatible checkpoint');
    const prior=request.enrollment as Record<string,unknown>|null;
    if(prior){if(prior.input_digest===hash)return {...prior,replayed:true};fail('RECOVERY_ALREADY_ENROLLED','Replacement identity is already owned by one enrolled worker');}
    if(attempt!==request.replacement_attempt_id||generation!==request.replacement_attempt_generation)fail('RECOVERY_COPIED_AUTHORITY','Only the fresh replacement identity may enroll; copied source authority is fenced');
    const row=(await tx.query('SELECT a.*,t.current_attempt_id,t.generation AS task_generation FROM hyperfide.attempts a JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 FOR UPDATE OF a,t',[scope.organisation_id,scope.run_id,attempt])).rows[0]!;
    if(row.current_attempt_id!==attempt||row.task_generation!==generation)fail('RECOVERY_SUPERSEDED_ATTEMPT','Replacement was superseded before enrollment');
    if(row.sandbox_id!==sandbox||row.slot_id!==slot||row.sandbox_boot_generation!==boot)fail('RECOVERY_ENROLLMENT_MISMATCH','Enrollment must come from the exact restored target boot');
    if(row.compute_authority!=='RELEASED'||row.execution_state!=='RESERVED')fail('RECOVERY_ALREADY_ENROLLED','Replacement already holds or released authority');
    const live=(await tx.query('SELECT boot_generation,observed_state,desired_state FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,sandbox])).rows[0];
    if(!live||live.boot_generation!==boot||live.observed_state!=='RUNNING'||live.desired_state!=='RUNNING')fail('RECOVERY_ENROLLMENT_MISMATCH','Target boot is no longer current');
    const checkpoint=(await tx.query('SELECT s.connector,s.account_key FROM hyperfide.checkpoints c JOIN hyperfide.agent_sessions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.agent_session_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3',[scope.organisation_id,scope.run_id,request.checkpoint_id])).rows[0]
     ??(await tx.query("SELECT connector,account_key FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND role='WORKER' ORDER BY created_at,id LIMIT 1",[scope.organisation_id,scope.run_id,request.source_attempt_id])).rows[0];
    if(!checkpoint)fail('RECOVERY_SESSION_UNKNOWN','Source worker connector identity is unavailable');
    const session=randomUUID();
    await tx.query("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id,attempt_id,sandbox_id,slot_id,sandbox_boot_generation,state) VALUES($1,$2,$3,'WORKER',$4,$5,$6,$7,$8,$9,$10,'RUNNING')",[scope.organisation_id,scope.run_id,session,checkpoint.connector,checkpoint.account_key,native,attempt,sandbox,slot,boot]);
    const clock=(await tx.query("SELECT clock_timestamp()::text AS primary_now,(clock_timestamp()+$1::integer*interval '1 millisecond')::text AS expires_at",[duration])).rows[0]!;
    await tx.query("UPDATE hyperfide.attempts SET compute_authority='CURRENT',execution_state='RUNNING',lease_expires_at=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,attempt,clock.expires_at]);
    await tx.query('INSERT INTO hyperfide.compute_leases(organisation_id,run_id,id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[scope.organisation_id,scope.run_id,randomUUID(),attempt,generation,row.authority_epoch,boot,clock.expires_at]);
    await tx.query("UPDATE hyperfide.tasks SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,row.task_id]);
    const result={input_digest:hash,request_id:id,attempt_id:attempt,attempt_generation:generation,session_id:session,sandbox_id:sandbox,slot_id:slot,sandbox_boot_generation:boot,lease_expires_at:clock.expires_at,primary_now:clock.primary_now,authority:'CURRENT_COMPUTE',source_session_reused:false,worker_clock_trusted:false};
    await tx.query('UPDATE hyperfide.recovery_replacement_requests SET enrollment=$4::jsonb,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,id,JSON.stringify(result)]);
    return result;
   });
  },
  // Renewal never resurrects expired, superseded or copied authority; worker_observed_at is recorded only as an untrusted claim.
  'recovery.worker.renew':async(input,context)=>{
   const value=record(input,['scope','attempt_id','attempt_generation','sandbox_boot_generation','session_id','lease_ms','worker_observed_at']);
   const scope=scopeOf(value.scope),attempt=uuid(value.attempt_id),generation=positive(value.attempt_generation),boot=positive(value.sandbox_boot_generation),session=uuid(value.session_id),duration=leaseMs(value.lease_ms);timestamp(value.worker_observed_at);
   return recoveryTransaction(context,scope,async tx=>{
    const {attempt:row}=await lineage(tx,scope,attempt);
    const authority=await currentAuthority(tx,scope,row,generation,boot,session);
    if(authority.reason==='LEASE_EXPIRED')fail('RECOVERY_LEASE_EXPIRED','Primary time shows the lease expired; renewal cannot resurrect it');
    if(authority.reason==='STALE_GENERATION')fail('RECOVERY_STALE_GENERATION','A newer generation owns this task');
    if(authority.reason)fail('RECOVERY_NO_COMPUTE_AUTHORITY','Attempt holds no enrolled compute authority');
    const clock=(await tx.query("SELECT (clock_timestamp()+$1::integer*interval '1 millisecond')::text AS expires_at",[duration])).rows[0]!;
    await tx.query('UPDATE hyperfide.compute_leases SET expires_at=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,authority.lease!.id,clock.expires_at]);
    await tx.query('UPDATE hyperfide.attempts SET lease_expires_at=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,attempt,clock.expires_at]);
    return {attempt_id:attempt,attempt_generation:generation,lease_expires_at:clock.expires_at,primary_now:authority.primary_now,worker_observed_at:value.worker_observed_at,worker_clock_trusted:false};
   });
  },
  // Every returned output is retained with provenance; only the live current generation may publish one completion.
  'recovery.worker.output':async(input,context)=>{
   const value=record(input,['scope','operation_id','attempt_id','attempt_generation','sandbox_boot_generation','session_id','kind','output_digest','worker_reported_at']);
   const scope=scopeOf(value.scope),operation=uuid(value.operation_id),attempt=uuid(value.attempt_id),generation=positive(value.attempt_generation),boot=positive(value.sandbox_boot_generation),session=uuid(value.session_id),output=digest(value.output_digest);timestamp(value.worker_reported_at);
   if(value.kind!=='PARTIAL'&&value.kind!=='COMPLETION')fail('RECOVERY_INPUT_INVALID','Output kind must be PARTIAL or COMPLETION');
   const hash=inputDigest(value);
   return recoveryTransaction(context,scope,async tx=>{
    const {attempt:row,requests}=await lineage(tx,scope,attempt);
    const outputs=requests.flatMap(request=>(request.outputs as Record<string,unknown>[]));
    const prior=outputs.find(item=>item.operation_id===operation);
    if(prior){if(prior.input_digest===hash)return {...prior,replayed:true};fail('RECOVERY_IDEMPOTENCY_CONFLICT','Output operation identity has different immutable inputs');}
    const authority=await currentAuthority(tx,scope,row,generation,boot,session);
    let disposition=authority.reason?'ARCHIVE_PROVENANCE_ONLY':value.kind==='COMPLETION'?'AUTHORITATIVE_COMPLETION':'AUTHORITATIVE_PARTIAL';
    if(disposition==='AUTHORITATIVE_COMPLETION'&&outputs.some(item=>item.disposition==='AUTHORITATIVE_COMPLETION'))fail('RECOVERY_ALREADY_PUBLISHED','Exactly one generation may publish a completion');
    const newest=requests[requests.length-1]!;
    if((newest.outputs as unknown[]).length>=256)fail('RECOVERY_OUTPUT_LIMIT','Output provenance budget is exhausted');
    const entry={operation_id:operation,input_digest:hash,attempt_id:attempt,attempt_generation:generation,sandbox_boot_generation:boot,session_id:session,kind:value.kind,output_digest:output,disposition,reason:authority.reason,
     publication_authorized:disposition==='AUTHORITATIVE_COMPLETION',current_attempt_id:row.current_attempt_id,current_generation:row.task_generation,worker_reported_at:value.worker_reported_at,worker_clock_trusted:false,received_at:authority.primary_now};
    await tx.query("UPDATE hyperfide.recovery_replacement_requests SET outputs=outputs||jsonb_build_array($4::jsonb),updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,newest.id,JSON.stringify(entry)]);
    return entry;
   });
  },
  'recovery.worker.inventory':(input,context)=>{const scope=scopeOf(input);return recoveryTransaction(context,scope,tx=>capability(context,'24.1','recovery.snapshots.v1',isRecoverySnapshotReader).read(tx,scope),false,true);}
 }};
}
