import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {record,scopeOf,uuid,positive,recoveryTransaction,operationReplay,finishOperation,readControlSnapshot} from './control.js';

export function createComponent(_context:ComponentContext):Component{
 return {apiVersion:1,actions:{
  'recovery.worker.describe':(input,context)=>{record(input,[]);return {api_version:1,loss_revokes_compute:true,accepted_custody_survives:true,unknown_external_effects:'RECONCILE',automatic_replacement:false};},
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
    const result={scope,attempt_id:attempt,compute_authority:['CURRENT','EXPIRED'].includes(String(row.compute_authority))?'REVOKED':row.compute_authority,preserved_submission_custody:custody.rows,qualification_jobs_requeued:expiredJobs.rows,
     normal_scheduler_recovery_pending:custody.rows.length===0,recovery_operation_id:id,task_id:row.task_id,replacement_authorized:false,requires: custody.rows.length?'RECOVER_QUALIFICATION_UNDER_ITS_OWN_LEASE':'EXTERNAL_INVENTORY_AND_COMPATIBLE_CHECKPOINT',
     stale_outputs:'ARCHIVE_PROVENANCE_ONLY',publication_authorized:false};
    await finishOperation(tx,scope,id,result);return result;
   });
  },
  'recovery.worker.inventory':(input,context)=>{const scope=scopeOf(input);return recoveryTransaction(context,scope,tx=>readControlSnapshot(tx,scope),false,true);}
 }};
}
