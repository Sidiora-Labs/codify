import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {record,scopeOf,uuid,digest,recoveryTransaction,operationReplay,finishOperation,capability} from './control.js';
export type DrillScenario='DATABASE'|'OBJECT'|'GIT'|'PROVIDER'|'AUTH'|'FULL_DISK'|'RESTORE';
export interface RecoveryDrillProbe {
 execute(input:{scenario:DrillScenario;organisation_id:string;run_id:string;operation_id:string;source_epoch:string;signal:AbortSignal}):Promise<{
  status:'RECOVERED'|'FAILED'|'UNKNOWN';source_epoch:string;recovery_epoch:string|null;
  acknowledged_ids:readonly string[];recovered_ids:readonly string[];evidence_digest:string;limits:string;
 }>;
}
function isProbe(value:unknown):value is RecoveryDrillProbe{return object(value)&&typeof value.execute==='function';}
function bounded(value:unknown):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>604800000)throw new FoundationError('RECOVERY_INPUT_INVALID','RPO/RTO must be bounded integer milliseconds');
 return value;
}
export function createComponent(_context:ComponentContext):Component{
 return {apiVersion:1,actions:{
  'recovery.drill.describe':(input,context)=>{record(input,[]);return {api_version:1,scenarios:['DATABASE','OBJECT','GIT','PROVIDER','AUTH','FULL_DISK','RESTORE'],rpo_rto_units:'milliseconds',targets:'PROPOSED_UNTIL_MEASURED',operator_probe_required:true,full_case_qualification:'UNRUN'};},
  'recovery.drill.plan':async(input,context)=>{
   const value=record(input,['scope','operation_id','scenario','proposed_rpo_ms','proposed_rto_ms']);
   const scope=scopeOf(value.scope),id=uuid(value.operation_id),scenario=String(value.scenario);
   if(!['DATABASE','OBJECT','GIT','PROVIDER','AUTH','FULL_DISK','RESTORE'].includes(scenario))throw new FoundationError('RECOVERY_INPUT_INVALID','Unknown recovery scenario');
   const rpo=bounded(value.proposed_rpo_ms),rto=bounded(value.proposed_rto_ms);
   return recoveryTransaction(context,scope,async tx=>{
    const replay=await operationReplay(tx,scope,id,'DRILL',value);if(replay)return replay;
    await tx.query("INSERT INTO hyperfide.recovery_drill_runs(organisation_id,run_id,operation_id,scenario,source_epoch,proposed_rpo_ms,proposed_rto_ms,limits) VALUES($1,$2,$3,$4,$5,$6,$7,'Component probe only; production HA, external topology and full recovery remain unqualified')",[scope.organisation_id,scope.run_id,id,scenario,scope.authority_epoch,rpo,rto]);
    const result={scope,operation_id:id,scenario,state:'PROPOSED',proposed_rpo_ms:rpo,proposed_rto_ms:rto,measured_rpo_ms:null,measured_rto_ms:null,qualified:false};
    await finishOperation(tx,scope,id,result);return result;
   });
  },
  'recovery.drill.inspect':async(input,context)=>{
   const value=record(input,['scope','operation_id']);const scope=scopeOf(value.scope),id=uuid(value.operation_id);
   return recoveryTransaction(context,scope,async tx=>{
    const rows=await tx.query("SELECT scenario,source_epoch,recovery_epoch,state,proposed_rpo_ms,proposed_rto_ms,started_at,completed_at,measured_rto_ms,acknowledged_count,recovered_count,acknowledged_loss_count,evidence_digest,limits,clock_timestamp() AS observed_at FROM hyperfide.recovery_drill_runs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",[scope.organisation_id,scope.run_id,id]);
    if(rows.rows.length!==1)throw new FoundationError('RECOVERY_OPERATION_INVALID','No reviewed drill plan');
    return {scope,operation_id:id,source:'primary-transaction',drill:rows.rows[0],measured_rpo_ms:null,qualified:false,replay_disruptive_execution:false,reconcile_required:['RUNNING','UNKNOWN'].includes(String(rows.rows[0]!.state))};
   },false,true);
  },
  'recovery.drill.execute':async(input,context)=>{
   const value=record(input,['scope','operation_id']);const scope=scopeOf(value.scope),id=uuid(value.operation_id);
   const probe=capability(context,'4.4','recovery.drill.probes.v1',isProbe);
   const planned=await recoveryTransaction(context,scope,async tx=>{
    const result=await tx.query("SELECT * FROM hyperfide.recovery_drill_runs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR UPDATE",[scope.organisation_id,scope.run_id,id]);
    const row=result.rows[0];if(!row)throw new FoundationError('RECOVERY_OPERATION_INVALID','No reviewed drill plan');
    if(row.state==='RUNNING'||row.state==='UNKNOWN')throw new FoundationError('RECOVERY_OUTCOME_UNKNOWN','Drill outcome must reconcile before another execution');
    if(row.state==='MEASURED'||row.state==='FAILED')return {terminal:true,row};
    await tx.query("UPDATE hyperfide.recovery_drill_runs SET state='RUNNING',started_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",[scope.organisation_id,scope.run_id,id]);
    return {terminal:false,row};
   });
   if(planned.terminal)return {scope,operation_id:id,drill:planned.row,replayed:true};
   let observed:Awaited<ReturnType<RecoveryDrillProbe['execute']>>|undefined;
   try{observed=await probe.execute({scenario:planned.row.scenario as DrillScenario,organisation_id:scope.organisation_id,run_id:scope.run_id,operation_id:id,source_epoch:scope.authority_epoch,signal:context.signal});}
   catch{/* Once a disruptive probe begins, missing evidence is unknown and never safe to replay. */}
   return recoveryTransaction(context,scope,async tx=>{
    if(!observed||observed.status==='UNKNOWN'){
     await tx.query("UPDATE hyperfide.recovery_drill_runs SET state='UNKNOWN',completed_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",[scope.organisation_id,scope.run_id,id]);
     return {scope,operation_id:id,state:'UNKNOWN',reconcile_required:true,qualified:false};
    }
    digest(observed.evidence_digest);
    if(observed.source_epoch!==scope.authority_epoch||!['RECOVERED','FAILED'].includes(observed.status)||!Array.isArray(observed.acknowledged_ids)||!Array.isArray(observed.recovered_ids)||typeof observed.limits!=='string'||observed.limits.length>2048)
     throw new FoundationError('RECOVERY_PROBE_INVALID','Trusted probe returned incompatible evidence');
    const ids=(items:readonly string[])=>items.length<=100000&&items.every(item=>typeof item==='string'&&item.length>0&&item.length<=255)&&new Set(items).size===items.length;
    if(!ids(observed.acknowledged_ids)||!ids(observed.recovered_ids))throw new FoundationError('RECOVERY_PROBE_INVALID','Probe inventory contains invalid or repeated identities');
    if(planned.row.scenario==='RESTORE'&&observed.status==='RECOVERED'&&(!observed.recovery_epoch||uuid(observed.recovery_epoch)===scope.authority_epoch))
     throw new FoundationError('RECOVERY_RESTORE_EPOCH_REUSED','Restores require a fresh non-reused external authority epoch');
    const recovered=new Set(observed.recovered_ids),lost=observed.acknowledged_ids.filter(item=>!recovered.has(item)).length;
    const state=observed.status==='RECOVERED'?'MEASURED':'FAILED';
    const measured=await tx.query("UPDATE hyperfide.recovery_drill_runs SET state=$4,recovery_epoch=$5,completed_at=clock_timestamp(),measured_rto_ms=GREATEST(0,floor(extract(epoch FROM(clock_timestamp()-started_at))*1000))::bigint,acknowledged_count=$6,recovered_count=$7,acknowledged_loss_count=$8,evidence_digest=$9,limits=$10 WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 RETURNING scenario,state,proposed_rpo_ms,proposed_rto_ms,measured_rto_ms,acknowledged_count,recovered_count,acknowledged_loss_count,evidence_digest,limits",[scope.organisation_id,scope.run_id,id,state,observed.recovery_epoch,observed.acknowledged_ids.length,observed.recovered_ids.length,lost,observed.evidence_digest,observed.limits]);
    return {scope,operation_id:id,drill:measured.rows[0],measured_rpo_ms:null,rpo_measurement:'ACKNOWLEDGED_ID_LOSS_COUNT_ONLY_NO_TIME_BOUND_INFERRED',requires_reconciliation_before_resume:true,qualified:false};
   });
  }
 }};
}
