import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {createRecoveryProbe,reconciliationOf,LOCAL_DRILL_SCOPES} from '../storage/recovery_probes.js';
import type {DrillReconciliation} from '../storage/recovery_probes.js';
import {record,scopeOf,uuid,digest,recoveryTransaction,operationReplay,finishOperation,capability,isGateway,recoveryReady,lockRun,fail} from './control.js';
import type {RecoveryGateway,RecoveryScope} from './control.js';
export type DrillScenario='DATABASE'|'OBJECT'|'GIT'|'PROVIDER'|'AUTH'|'FULL_DISK'|'RESTORE';
const SCENARIOS:readonly DrillScenario[]=['DATABASE','OBJECT','GIT','PROVIDER','AUTH','FULL_DISK','RESTORE'];
// Recovery point loss is measured as acknowledged identities missing after recovery; no time bound is inferred.
const RPO_MEASUREMENT='ACKNOWLEDGED_ID_LOSS_COUNT_ONLY_NO_TIME_BOUND_INFERRED';
export interface RecoveryDrillProbe {
 ready():Promise<void>;
 execute(input:{scenario:DrillScenario;organisation_id:string;run_id:string;operation_id:string;source_epoch:string;signal:AbortSignal}):Promise<{
  status:'RECOVERED'|'FAILED'|'UNKNOWN';source_epoch:string;recovery_epoch:string|null;scope:string;
  acknowledged_ids:readonly string[];recovered_ids:readonly string[];evidence_digest:string;limits:string;reconciliation:DrillReconciliation|null;
 }>;
}
function bounded(value:unknown):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>604800000)throw new FoundationError('RECOVERY_INPUT_INVALID','RPO/RTO must be bounded integer milliseconds');
 return value;
}
function resumable(value:unknown):boolean{
 const item=reconciliationOf(value);
 return item!==null&&item.stale_workers.presented>0&&item.stale_workers.fenced===item.stale_workers.presented&&item.stale_workers.current_accepted&&item.external_effects.unresolved===0;
}
type Observed=Awaited<ReturnType<RecoveryDrillProbe['execute']>>;
async function completeDrill(gateway:RecoveryGateway,scope:RecoveryScope,id:string,observed:Observed|undefined):Promise<void>{
 const where=[scope.organisation_id,scope.run_id,id];
 // Completion is service-internal; it still requires the reviewed schema and the unchanged run authority epoch.
 await gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,guard:async tx=>{await recoveryReady(tx);await lockRun(tx,scope);}},async tx=>{
  const unknown=async(limits:string)=>{await tx.query("UPDATE hyperfide.recovery_drill_runs SET state='UNKNOWN',completed_at=clock_timestamp(),limits=$4 WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND state='RUNNING'",[...where,limits]);};
  if(!observed||observed.status==='UNKNOWN')return unknown('Probe outcome unknown; retained operation evidence must reconcile before any replay');
  let reconciliation:DrillReconciliation|null;
  const ids=(items:unknown)=>Array.isArray(items)&&items.length<=100000&&items.every(item=>typeof item==='string'&&item.length>0&&item.length<=255)&&new Set(items).size===items.length;
  try{
   digest(observed.evidence_digest);reconciliation=reconciliationOf(observed.reconciliation);
   if(observed.source_epoch!==scope.authority_epoch||!['RECOVERED','FAILED'].includes(observed.status)||!ids(observed.acknowledged_ids)||!ids(observed.recovered_ids)||typeof observed.limits!=='string'||observed.limits.length>2048)
    throw new FoundationError('RECOVERY_PROBE_INVALID','Trusted probe returned incompatible evidence');
   if(observed.status==='RECOVERED'&&(!observed.recovery_epoch||uuid(observed.recovery_epoch)===scope.authority_epoch))
    throw new FoundationError('RECOVERY_RESTORE_EPOCH_REUSED','Recoveries require a fresh non-reused authority epoch');
  }catch(error){return unknown('Probe evidence rejected ('+String((error as {code?:unknown}).code??'INVALID')+'); reconcile retained evidence');}
  const recovered=new Set(observed.recovered_ids),lost=observed.acknowledged_ids.filter(item=>!recovered.has(item)).length;
  await tx.query("UPDATE hyperfide.recovery_drill_runs SET state=$4,recovery_epoch=$5,completed_at=clock_timestamp(),measured_rto_ms=GREATEST(0,floor(extract(epoch FROM(clock_timestamp()-started_at))*1000))::bigint,acknowledged_count=$6,recovered_count=$7,acknowledged_loss_count=$8,evidence_digest=$9,limits=$10,reconciliation=$11::jsonb WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND state='RUNNING'",
   [...where,observed.status==='RECOVERED'?'MEASURED':'FAILED',observed.recovery_epoch,observed.acknowledged_ids.length,observed.recovered_ids.length,lost,observed.evidence_digest,observed.limits,reconciliation===null?null:JSON.stringify(reconciliation)]);
 });
}
export function createComponent(startup:ComponentContext):Component{
 const probe:RecoveryDrillProbe=createRecoveryProbe(startup.resources,startup.env);
 const lifetime=new AbortController(),running=new Set<Promise<void>>();
 let queue:Promise<void>=Promise.resolve();
 return {apiVersion:1,close:async()=>{lifetime.abort();await Promise.allSettled([...running]);},actions:{
  'recovery.drill.describe':(input)=>{record(input,[]);return {api_version:1,scenarios:[...SCENARIOS],rpo_rto_units:'milliseconds',targets:'PROPOSED_UNTIL_MEASURED',rpo_measurement:RPO_MEASUREMENT,
   measured_rpo_ms:null,operator_probe_required:true,probe_profile:'HYPERFIDE_RECOVERY_PROBE_PROFILE',execution:'ASYNCHRONOUS_POLL_INSPECT',
   scenario_scopes:{DATABASE:'ISOLATED_POSTGRESQL_FIXTURE',RESTORE:'ISOLATED_POSTGRESQL_FIXTURE',...LOCAL_DRILL_SCOPES},live_provider_rehearsal:'BLOCKED_PENDING_PROVIDER_CREDENTIALS_AND_PROGRAMME_APPROVAL',
   resume_gate:'recovery.drill.reconcile',full_case_qualification:'UNRUN'};},
  'recovery.drill.plan':async(input,context)=>{
   const value=record(input,['scope','operation_id','scenario','proposed_rpo_ms','proposed_rto_ms']);
   const scope=scopeOf(value.scope),id=uuid(value.operation_id),scenario=String(value.scenario);
   if(!(SCENARIOS as readonly string[]).includes(scenario))throw new FoundationError('RECOVERY_INPUT_INVALID','Unknown recovery scenario');
   const rpo=bounded(value.proposed_rpo_ms),rto=bounded(value.proposed_rto_ms);
   return recoveryTransaction(context,scope,async tx=>{
    const replay=await operationReplay(tx,scope,id,'DRILL',value);if(replay)return replay;
    await tx.query("INSERT INTO hyperfide.recovery_drill_runs(organisation_id,run_id,operation_id,scenario,source_epoch,proposed_rpo_ms,proposed_rto_ms,limits) VALUES($1,$2,$3,$4,$5,$6,$7,'Component probe only; production HA, external topology and full recovery remain unqualified')",[scope.organisation_id,scope.run_id,id,scenario,scope.authority_epoch,rpo,rto]);
    const result={scope,operation_id:id,scenario,state:'PROPOSED',proposed_rpo_ms:rpo,proposed_rto_ms:rto,measured_rpo_ms:null,rpo_measurement:RPO_MEASUREMENT,measured_rto_ms:null,qualified:false};
    await finishOperation(tx,scope,id,result);return result;
   });
  },
  'recovery.drill.inspect':async(input,context)=>{
   const value=record(input,['scope','operation_id']);const scope=scopeOf(value.scope),id=uuid(value.operation_id);
   return recoveryTransaction(context,scope,async tx=>{
    const rows=await tx.query("SELECT scenario,source_epoch,recovery_epoch,state,proposed_rpo_ms,proposed_rto_ms,started_at,completed_at,measured_rto_ms,acknowledged_count,recovered_count,acknowledged_loss_count,evidence_digest,limits,reconciliation,resume_state,clock_timestamp() AS observed_at FROM hyperfide.recovery_drill_runs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",[scope.organisation_id,scope.run_id,id]);
    if(rows.rows.length!==1)throw new FoundationError('RECOVERY_OPERATION_INVALID','No reviewed drill plan');
    const row=rows.rows[0]!;
    return {scope,operation_id:id,source:'primary-transaction',drill:row,measured_rpo_ms:null,rpo_measurement:RPO_MEASUREMENT,qualified:false,replay_disruptive_execution:false,
     terminal:['MEASURED','FAILED','UNKNOWN'].includes(String(row.state)),reconcile_required:['RUNNING','UNKNOWN'].includes(String(row.state)),
     requires_reconciliation_before_resume:row.resume_state!=='RECONCILED'};
   },false,true);
  },
  'recovery.drill.execute':async(input,context)=>{
   const value=record(input,['scope','operation_id']);const scope=scopeOf(value.scope),id=uuid(value.operation_id);
   // The protected probe profile is re-validated before any state changes: unconfigured or tampered profiles refuse.
   try{await probe.ready();}catch{fail('RECOVERY_PROBE_NOT_CONFIGURED','An explicit protected recovery probe profile is required before disruptive execution');}
   const gateway=capability(context,'4.2','storage.transactions.v1',isGateway);
   const planned=await recoveryTransaction(context,scope,async tx=>{
    const result=await tx.query("SELECT * FROM hyperfide.recovery_drill_runs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR UPDATE",[scope.organisation_id,scope.run_id,id]);
    const row=result.rows[0];if(!row)throw new FoundationError('RECOVERY_OPERATION_INVALID','No reviewed drill plan');
    if(row.state==='RUNNING'||row.state==='UNKNOWN')throw new FoundationError('RECOVERY_OUTCOME_UNKNOWN','Drill outcome must reconcile before another execution');
    if(row.state==='MEASURED'||row.state==='FAILED')return {terminal:true,row};
    await tx.query("UPDATE hyperfide.recovery_drill_runs SET state='RUNNING',started_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",[scope.organisation_id,scope.run_id,id]);
    return {terminal:false,row};
   });
   if(planned.terminal)return {scope,operation_id:id,drill:planned.row,replayed:true,replay_disruptive_execution:false};
   const scenario=String(planned.row.scenario) as DrillScenario;
   // Disruptive probes outlive the request deadline, run one at a time and are never replayed automatically.
   const job=queue.then(async()=>{
    let observed:Observed|undefined;
    try{observed=await probe.execute({scenario,organisation_id:scope.organisation_id,run_id:scope.run_id,operation_id:id,source_epoch:scope.authority_epoch,signal:lifetime.signal});}
    catch{/* Once a disruptive probe begins, missing evidence is unknown and never safe to replay. */}
    try{await completeDrill(gateway,scope,id,observed);}catch{/* The row stays RUNNING and inspection reports reconcile_required. */}
   });
   queue=job;running.add(job);void job.finally(()=>running.delete(job));
   return {scope,operation_id:id,scenario,state:'RUNNING',poll:'recovery.drill.inspect',measured_rpo_ms:null,rpo_measurement:RPO_MEASUREMENT,
    requires_reconciliation_before_resume:true,replay_disruptive_execution:false,qualified:false};
  },
  'recovery.drill.reconcile':async(input,context)=>{
   const value=record(input,['scope','operation_id']);const scope=scopeOf(value.scope),id=uuid(value.operation_id);
   return recoveryTransaction(context,scope,async tx=>{
    const rows=await tx.query("SELECT scenario,state,source_epoch,recovery_epoch,reconciliation,resume_state FROM hyperfide.recovery_drill_runs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR UPDATE",[scope.organisation_id,scope.run_id,id]);
    const row=rows.rows[0];if(!row)throw new FoundationError('RECOVERY_OPERATION_INVALID','No reviewed drill plan');
    if(row.state!=='MEASURED')fail('RECOVERY_RECONCILIATION_REQUIRED','Only a measured recovery with retained evidence can be reconciled');
    if(!resumable(row.reconciliation))fail('RECOVERY_RECONCILIATION_INCOMPLETE','Stale workers must be fenced and every external effect reconciled before resuming authority');
    await tx.query("UPDATE hyperfide.recovery_drill_runs SET resume_state='RECONCILED' WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",[scope.organisation_id,scope.run_id,id]);
    return {scope,operation_id:id,scenario:row.scenario,resume_state:'RECONCILED',resume_authorized:true,authorized_epoch:row.recovery_epoch,fenced_epochs:[row.source_epoch],reconciliation:row.reconciliation,authority_scope:'DRILL_FIXTURE_ONLY',qualified:false};
   });
  },
  'recovery.drill.accept_result':async(input,context)=>{
   const value=record(input,['scope','operation_id','worker_epoch','result_digest']);
   const scope=scopeOf(value.scope),id=uuid(value.operation_id),worker=uuid(value.worker_epoch),result=digest(value.result_digest);
   return recoveryTransaction(context,scope,async tx=>{
    const rows=await tx.query("SELECT state,recovery_epoch,resume_state FROM hyperfide.recovery_drill_runs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR SHARE",[scope.organisation_id,scope.run_id,id]);
    const row=rows.rows[0];if(!row)throw new FoundationError('RECOVERY_OPERATION_INVALID','No reviewed drill plan');
    if(row.recovery_epoch&&worker!==row.recovery_epoch)fail('RECOVERY_STALE_WORKER_FENCED','Worker result was produced under a pre-recovery authority epoch');
    if(row.state!=='MEASURED'||row.resume_state!=='RECONCILED')fail('RECOVERY_RECONCILIATION_REQUIRED','Results are not accepted until recovery is measured and reconciled');
    return {scope,operation_id:id,accepted:true,worker_epoch:worker,result_digest:result,authority_scope:'DRILL_FIXTURE_ONLY',qualified:false};
   },false,true);
  }
 }};
}
