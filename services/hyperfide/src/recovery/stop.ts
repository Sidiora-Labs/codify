import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {record,scopeOf,uuid,positive,digest,timestamp,recoveryTransaction,operationReplay,finishOperation,capability,isSupervisor,inspectRecoveryHold,createRecoveryControlCapability,inspectIntegrationRecovery,isExecutionControls} from './control.js';

const modes=['PAUSE','DRAIN','CANCEL','STOP'] as const;
const ranks:Record<string,number>={PAUSE:2,DRAIN:1,CANCEL:4,STOP:3};
export async function publicationBlocked(tx:{query:(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]}>},org:string,run:string):Promise<boolean>{
 const result=await tx.query("SELECT EXISTS(SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) OR EXISTS(SELECT 1 FROM hyperfide.publication_intents WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','EXECUTING')) AS blocked",[org,run]);
 const integration=await inspectIntegrationRecovery(tx as Parameters<typeof inspectIntegrationRecovery>[0],{organisation_id:org,run_id:run,authority_epoch:'00000000-0000-4000-8000-000000000000'});
 return result.rows[0]?.blocked!==false||!integration.ready||integration.jobs.length>0||integration.scope_jobs.length>0;
}
export function createComponent(_context:ComponentContext):Component{
 return {apiVersion:1,capabilities:{'recovery.controls.v1':createRecoveryControlCapability()},actions:{
  'recovery.stop.describe':(input,context)=>{record(input,[]);return {api_version:1,modes:[...modes],scope_precedence:'RUN_ENCLOSES_PACKAGE_ATTEMPT_SANDBOX',external_stop_requires:'TRUSTED_IDENTITY_BOUND_SUPERVISOR',unreachable_means:'DEBT'};},
  'recovery.stop.request':async(input,context)=>{
   const value=record(input,['scope','operation_id','scope_kind','scope_id','mode','reason']);
   const scope=scopeOf(value.scope),id=uuid(value.operation_id),target=uuid(value.scope_id),kind=String(value.scope_kind),mode=String(value.mode);
   if(!['RUN','PACKAGE','ATTEMPT','SANDBOX'].includes(kind)||!Object.hasOwn(ranks,mode)||typeof value.reason!=='string'||value.reason.length<1||value.reason.length>1024)
    throw new FoundationError('RECOVERY_INPUT_INVALID','Invalid scoped control');
   if(kind==='RUN'&&target!==scope.run_id)throw new FoundationError('RECOVERY_SCOPE_INVALID','Run control must target its enclosing run');
   const drainBudget=context.env.HYPERFIDE_DRAIN_TIMEOUT_MS??'300000',fallback=context.env.HYPERFIDE_DRAIN_FALLBACK_MODE??'STOP';
   if(!/^[1-9][0-9]*$/.test(drainBudget)||!Number.isSafeInteger(Number(drainBudget))||Number(drainBudget)>86400000||!['PAUSE','STOP'].includes(fallback))throw new FoundationError('RECOVERY_CONFIG_INVALID','Invalid trusted drain deadline/fallback');
   return recoveryTransaction(context,scope,async tx=>{
    const replay=await operationReplay(tx,scope,id,'STOP',value);if(replay)return replay;
    const enclosing=await inspectRecoveryHold(tx,scope);
    if(enclosing.some(row=>row.scope_kind==='RUN'&&Number(ranks[String(row.mode)])>Number(ranks[mode])))
     throw new FoundationError('RECOVERY_ENCLOSING_CONTROL','Enclosing run control cannot be weakened');
    const conditions:Record<string,string>={RUN:'TRUE',PACKAGE:'t.feature_package_id=$3',ATTEMPT:'a.id=$3',SANDBOX:'a.sandbox_id=$3'};
    if(kind==='PACKAGE'){
     const exists=await tx.query('SELECT id FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,target]);
     if(!exists.rows.length)throw new FoundationError('RECOVERY_SCOPE_INVALID','Package is outside run');
    }
    const attempts=await tx.query('SELECT a.id,a.task_id,a.generation,a.sandbox_id,a.sandbox_boot_generation,a.compute_authority FROM hyperfide.attempts a JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id WHERE a.organisation_id=$1 AND a.run_id=$2 AND '+conditions[kind]+' ORDER BY a.id FOR UPDATE OF a',kind==='RUN'?[scope.organisation_id,scope.run_id]:[scope.organisation_id,scope.run_id,target]);
    if((kind==='ATTEMPT'||kind==='SANDBOX')&&!attempts.rows.length)throw new FoundationError('RECOVERY_SCOPE_INVALID','Scope has no bound attempt in this run');
    const previous=enclosing.find(row=>row.scope_kind===kind&&row.scope_id===target);
    if(previous&&Number(ranks[String(previous.mode)])>Number(ranks[mode]))throw new FoundationError('RECOVERY_CONTROL_REGRESSION','Active control cannot be weakened');
    const timing=await tx.query("SELECT clock_timestamp() AS accepted_at,clock_timestamp()+($1::bigint*interval '1 millisecond') AS deadline_at",[drainBudget]);
    const accepted=timing.rows[0]!.accepted_at,deadline=mode==='DRAIN'?timing.rows[0]!.deadline_at:null;
    const controls=await tx.query("INSERT INTO hyperfide.recovery_controls(organisation_id,run_id,scope_kind,scope_id,mode,authority_epoch,reason,accepted_at,deadline_at,fallback_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(organisation_id,run_id,scope_kind,scope_id) DO UPDATE SET mode=EXCLUDED.mode,authority_epoch=EXCLUDED.authority_epoch,reason=EXCLUDED.reason,accepted_at=EXCLUDED.accepted_at,deadline_at=EXCLUDED.deadline_at,fallback_mode=EXCLUDED.fallback_mode,status='ACTIVE',generation=hyperfide.recovery_controls.generation+1,updated_at=clock_timestamp() RETURNING generation",[scope.organisation_id,scope.run_id,kind,target,mode,scope.authority_epoch,value.reason,accepted,deadline,mode==='DRAIN'?fallback:null]);
    const generation=controls.rows[0]!.generation;
    const gate=capability(context,'5.1','scheduler.controls.v1',isExecutionControls);
    await gate.applyExecutionControl(tx,scope,{scope_kind:kind as 'RUN'|'PACKAGE'|'ATTEMPT'|'SANDBOX',scope_id:target,mode:(mode==='CANCEL'?'STOP':mode) as 'PAUSE'|'DRAIN'|'STOP',operation_id:id,reason:value.reason as string,...(mode==='DRAIN'?{deadline_at:new Date(String(deadline)).toISOString(),fallback_mode:fallback as 'PAUSE'|'STOP'}:{})});

    if(kind==='RUN'){
     const state=({PAUSE:'PAUSING',DRAIN:'DRAINING',CANCEL:'CANCELLING',STOP:'STOPPING'} as Record<string,string>)[mode]!;
     const changed=await tx.query("UPDATE hyperfide.runs SET state=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND state NOT IN ('STOPPED','SUCCEEDED','FAILED','CANCELLED') RETURNING id",[scope.organisation_id,scope.run_id,state]);
     if(!changed.rows.length)throw new FoundationError('RECOVERY_TERMINAL_CONTROL','Terminal run cannot accept new control');
    }
    const destructive=mode==='CANCEL'||mode==='STOP';
    if(destructive)for(const attempt of attempts.rows){
     await tx.query("UPDATE hyperfide.attempts SET compute_authority='REVOKED',execution_state=CASE WHEN execution_state IN ('SUCCEEDED','FAILED','CANCELLED','SUBMITTED') THEN execution_state ELSE 'CANCELLED' END,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND (compute_authority='CURRENT' OR execution_state NOT IN ('SUCCEEDED','FAILED','CANCELLED','SUBMITTED'))",[scope.organisation_id,scope.run_id,attempt.id]);
     await tx.query("UPDATE hyperfide.compute_leases SET state='REVOKED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state='ACTIVE'",[scope.organisation_id,scope.run_id,attempt.id]);
     await tx.query("UPDATE hyperfide.slot_allocations SET state='RELEASE_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state='ACTIVE'",[scope.organisation_id,scope.run_id,attempt.id]);
     const sessions=await tx.query("SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state NOT IN ('STOPPED','FAILED')",[scope.organisation_id,scope.run_id,attempt.id]);
     for(const session of sessions.rows)await tx.query("INSERT INTO hyperfide.recovery_resource_debts(organisation_id,run_id,operation_id,resource_kind,resource_id,sandbox_boot_generation,desired_state,detail) VALUES($1,$2,$3,'SUPERVISOR',$4,$5,'STOPPED','Stop requires exact OS process identity and descendant observation') ON CONFLICT DO NOTHING",[scope.organisation_id,scope.run_id,id,session.id,attempt.sandbox_boot_generation]);
    }
    if(mode==='PAUSE'||mode==='DRAIN')for(const attempt of attempts.rows){
     const sessions=await tx.query("SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state NOT IN ('STOPPED','FAILED')",[scope.organisation_id,scope.run_id,attempt.id]);
     for(const session of sessions.rows){
      await tx.query("INSERT INTO hyperfide.recovery_resource_debts(organisation_id,run_id,operation_id,resource_kind,resource_id,sandbox_boot_generation,command_generation,desired_state,detail) VALUES($1,$2,$3,'SUPERVISOR',$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",[scope.organisation_id,scope.run_id,id,session.id,attempt.sandbox_boot_generation,generation,mode==='PAUSE'?'QUIESCENT':'FINISHED',mode==='PAUSE'?'Verify durable checkpoint before unsupported native pause is terminated':'Observe already-admitted work; no successor dispatch']);
      if(mode==='PAUSE')await tx.query("INSERT INTO hyperfide.recovery_resource_debts(organisation_id,run_id,operation_id,resource_kind,resource_id,sandbox_boot_generation,command_generation,desired_state,detail) VALUES($1,$2,$3,'CHECKPOINT',$4,$5,$6,'DURABLE','Pause requires actual native export, immutable upload and verified checkpoint registration') ON CONFLICT DO NOTHING",[scope.organisation_id,scope.run_id,id,session.id,attempt.sandbox_boot_generation,generation]);
     }
    }
    const custodyDispositions:Record<string,unknown>[]=[];
    if(destructive){
     const taskIds=[...new Set(attempts.rows.map(row=>row.task_id))];
     const custodies=await tx.query("SELECT id,task_id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND task_id=ANY($3::uuid[]) AND authority='ACTIVE' ORDER BY id FOR UPDATE",[scope.organisation_id,scope.run_id,taskIds]);
     for(const custody of custodies.rows){
      const holds=await tx.query("SELECT EXISTS(SELECT 1 FROM hyperfide.integration_candidates c JOIN hyperfide.publication_operations p ON p.organisation_id=c.organisation_id AND p.run_id=c.run_id AND p.candidate_id=c.id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.custody_id=$3 AND p.state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) OR EXISTS(SELECT 1 FROM hyperfide.integration_candidates c JOIN hyperfide.publication_intents p ON p.organisation_id=c.organisation_id AND p.run_id=c.run_id AND p.candidate_id=c.id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.custody_id=$3 AND p.state IN ('PENDING','EXECUTING')) AS blocked",[scope.organisation_id,scope.run_id,custody.id]);
      if(holds.rows[0]?.blocked!==false){
       await tx.query("INSERT INTO hyperfide.recovery_resource_debts(organisation_id,run_id,operation_id,resource_kind,resource_id,desired_state,observed_state,detail) VALUES($1,$2,$3,'AUTHORITY',$4,'REVOKED','FROZEN_EXTERNAL_OUTCOME_UNKNOWN','Emergency control blocks advancement; immutable issued publication must reconcile before custody disposition') ON CONFLICT DO NOTHING",[scope.organisation_id,scope.run_id,id,custody.id]);
       custodyDispositions.push({custody_id:custody.id,authority:'CONTROL_BLOCKED',disposition:'PENDING_EXTERNAL_RECONCILIATION'});
      }else{
       await tx.query("UPDATE hyperfide.submission_custodies SET authority='REVOKED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND authority='ACTIVE'",[scope.organisation_id,scope.run_id,custody.id]);
       await tx.query("UPDATE hyperfide.qualification_jobs SET state='CANCELLED',lease_generation=lease_generation+1,lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3 AND state IN ('PENDING','RUNNING')",[scope.organisation_id,scope.run_id,custody.id]);
       await tx.query("UPDATE hyperfide.integration_candidates SET state='CANCELLED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3 AND state IN ('PENDING','VERIFYING','READY')",[scope.organisation_id,scope.run_id,custody.id]);
       custodyDispositions.push({custody_id:custody.id,authority:'REVOKED',history_preserved:true});
      }
     }
     await tx.query("UPDATE hyperfide.tasks SET state=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) AND state NOT IN ('INTEGRATED','CANCELLED')",[scope.organisation_id,scope.run_id,taskIds,mode==='CANCEL'?'CANCELLED':'BLOCKED']);
    }
    if(destructive&&kind==='RUN'){
     const allSessions=await tx.query("SELECT id,sandbox_boot_generation FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND state NOT IN ('STOPPED','FAILED')",[scope.organisation_id,scope.run_id]);
     for(const session of allSessions.rows)await tx.query("INSERT INTO hyperfide.recovery_resource_debts(organisation_id,run_id,operation_id,resource_kind,resource_id,sandbox_boot_generation,command_generation,desired_state,detail) VALUES($1,$2,$3,'SUPERVISOR',$4,$5,$6,'STOPPED','Stop includes leader and manager supervision sessions') ON CONFLICT DO NOTHING",[scope.organisation_id,scope.run_id,id,session.id,session.sandbox_boot_generation,generation]);
    }
    const result={scope,operation_id:id,scope_kind:kind,scope_id:target,mode,generation,accepted_at:accepted,drain_deadline:deadline,fallback_mode:mode==='DRAIN'?fallback:null,admission_blocked:true,compute_revoked:destructive,
     process_stop_complete:false,cleanup_complete:false,submission_custody_preserved:!destructive,custody_dispositions:custodyDispositions,custody_history_preserved:true,unknown_external_effects:'RECONCILE'};
    await finishOperation(tx,scope,id,result);return result;
   });
  },
  'recovery.stop.finalize':async(input,context)=>{
   const value=record(input,['scope','operation_id']);const scope=scopeOf(value.scope),id=uuid(value.operation_id);
   const cleanup=capability(context,'12.4','runner.supervisors.v1',(v):v is {verifyStop:(input:unknown)=>Promise<{cleanup_complete:boolean;processes_stopped:boolean;artifacts_preserved:boolean;credentials_cleared:boolean;resources_reconciled:boolean;evidence_digest:string;observed_at:string}>}=>typeof v==='object'&&v!==null&&'verifyStop' in v&&typeof v.verifyStop==='function');
   const plan=await recoveryTransaction(context,scope,async tx=>{
    const op=await tx.query("SELECT kind,result,created_at FROM hyperfide.recovery_operations WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",[scope.organisation_id,scope.run_id,id]);
    if(op.rows[0]?.kind!=='STOP')throw new FoundationError('RECOVERY_OPERATION_INVALID','No matching scoped stop intent');
    const commands=(await tx.query("SELECT resource_id AS session_id,command_id,command_generation AS generation FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND resource_kind='SUPERVISOR' ORDER BY resource_id LIMIT 1001",[scope.organisation_id,scope.run_id,id])).rows;
    if(commands.length>1000)throw new FoundationError('RECOVERY_INVENTORY_TOO_LARGE','Cleanup inventory requires bounded resource partitions');
    return {...op.rows[0]!,commands};
   });
   const receipt=await cleanup.verifyStop({scope,operation_id:id,scope_kind:(plan.result as Record<string,unknown>).scope_kind,scope_id:(plan.result as Record<string,unknown>).scope_id,commands:plan.commands});
   digest(receipt.evidence_digest);const at=timestamp(receipt.observed_at);
   if(at<Date.parse(String(plan.created_at))||at>Date.now()+1000)throw new FoundationError('RECOVERY_OBSERVATION_STALE','Cleanup receipt is outside the intent interval');
   return recoveryTransaction(context,scope,async tx=>{
    const open=await tx.query("SELECT count(*)::text AS count FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND status<>'RESOLVED'",[scope.organisation_id,scope.run_id,id]);
    const publication=await publicationBlocked(tx,scope.organisation_id,scope.run_id);
    const complete=receipt.cleanup_complete===true&&receipt.processes_stopped===true&&receipt.artifacts_preserved===true&&receipt.credentials_cleared===true&&receipt.resources_reconciled===true&&open.rows[0]!.count==='0'&&!publication;
    const intent=plan.result as Record<string,unknown>;
    if(complete&&intent.scope_kind==='RUN'&&['STOP','CANCEL'].includes(String(intent.mode))){
     await tx.query("UPDATE hyperfide.runs SET state=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND state IN ('STOPPING','CANCELLING')",[scope.organisation_id,scope.run_id,intent.mode==='CANCEL'?'CANCELLED':'STOPPED']);
    }
    const result={...intent,process_stop_complete:receipt.processes_stopped===true,cleanup_complete:complete,stop_complete:complete,evidence_digest:receipt.evidence_digest,observed_at:receipt.observed_at,publication_reconciled:!publication};
    await finishOperation(tx,scope,id,result,complete?'RECONCILED':'APPLIED');return result;
   });
  },
  'recovery.stop.reconcile':async(input,context)=>{
   const value=record(input,['scope','operation_id']);const scope=scopeOf(value.scope),id=uuid(value.operation_id);
   // External commands execute outside database transactions and retain stable command IDs.
   const debts=await recoveryTransaction(context,scope,async tx=>{
    const operation=await tx.query("SELECT kind,result FROM hyperfide.recovery_operations WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",[scope.organisation_id,scope.run_id,id]);
    if(operation.rows[0]?.kind!=='STOP'&&operation.rows[0]?.kind!=='WORKER_LOSS')throw new FoundationError('RECOVERY_OPERATION_INVALID','No matching stop/loss intent');
    return (await tx.query("SELECT id,resource_kind,resource_id,command_id,command_generation,sandbox_boot_generation,desired_state,created_at FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND status<>'RESOLVED' ORDER BY id LIMIT 1001",[scope.organisation_id,scope.run_id,id])).rows;
   });
   if(debts.length>1000)throw new FoundationError('RECOVERY_INVENTORY_TOO_LARGE','Reconcile bounded resource partitions');
   const supervisor=debts.some(row=>row.resource_kind==='SUPERVISOR')?capability(context,'12.4','runner.supervisors.v1',isSupervisor):undefined;
   const observations:Record<string,unknown>[]=[];
   for(const debt of debts){
    if(debt.resource_kind!=='SUPERVISOR'||!supervisor){observations.push({debt_id:debt.id,status:'UNKNOWN'});continue;}
    let receipt;
    if(debt.desired_state==='QUIESCENT'){
     const ready=await recoveryTransaction(context,scope,async tx=>(await tx.query("SELECT count(*)::text AS count FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND resource_kind='CHECKPOINT' AND resource_id=$4 AND status<>'RESOLVED'",[scope.organisation_id,scope.run_id,id,debt.resource_id])).rows[0]!.count==='0');
     if(!ready){observations.push({debt_id:debt.id,status:'CHECKPOINT_REQUIRED'});continue;}
    }
    try{receipt=debt.desired_state==='FINISHED'?await supervisor.observe({scope,session_id:uuid(debt.resource_id),attempt_id:null,sandbox_id:null,boot_generation:debt.sandbox_boot_generation as string|null}):await supervisor.stop({scope,session_id:uuid(debt.resource_id),command_id:uuid(debt.command_id),generation:positive(debt.command_generation)});}
    catch{observations.push({debt_id:debt.id,status:'UNKNOWN'});continue;}
    const observed=timestamp(receipt.observed_at),evidence=digest(receipt.evidence_digest);
    if(observed<Date.parse(String(debt.created_at))||observed>Date.now()+1000)throw new FoundationError('RECOVERY_OBSERVATION_STALE','Supervisor receipt is outside observation interval');
    if(!['CONFIRMED_STOPPED','MATCHED_RUNNING','UNKNOWN','IDENTITY_MISMATCH'].includes(receipt.status))throw new FoundationError('RECOVERY_OBSERVATION_INVALID','Unknown supervisor observation');
    observations.push({debt_id:debt.id,status:receipt.status});
    await recoveryTransaction(context,scope,async tx=>{
     if(receipt.status==='CONFIRMED_STOPPED'){
      await tx.query("UPDATE hyperfide.recovery_resource_debts SET status='RESOLVED',observed_state='STOPPED',observed_at=$4,evidence_digest=$5,resolved_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND status<>'RESOLVED'",[scope.organisation_id,scope.run_id,debt.id,receipt.observed_at,evidence]);
      await tx.query("UPDATE hyperfide.agent_sessions SET state='STOPPED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state<>'STOPPED'",[scope.organisation_id,scope.run_id,debt.resource_id]);
     }else await tx.query("UPDATE hyperfide.recovery_resource_debts SET observed_state=$4,observed_at=$5,evidence_digest=$6 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND status<>'RESOLVED'",[scope.organisation_id,scope.run_id,debt.id,receipt.status,receipt.observed_at,evidence]);
    });
   }
   return recoveryTransaction(context,scope,async tx=>{
    const unresolved=(await tx.query("SELECT id,resource_kind,resource_id,status,observed_state FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND status<>'RESOLVED' ORDER BY id",[scope.organisation_id,scope.run_id,id])).rows;
    const publication=await publicationBlocked(tx,scope.organisation_id,scope.run_id);
    return {scope,operation_id:id,observations,unreachable_resource_debt:unresolved,process_stop_complete:unresolved.length===0,publication_reconciled:!publication,
     cleanup_complete:false,stop_complete:false,reason:unresolved.length?'UNREACHABLE_OR_UNCONFIRMED_RESOURCES':publication?'PUBLICATION_OUTCOME_UNKNOWN':'ARTIFACT_AND_CREDENTIAL_CLEANUP_REQUIRES_QUALIFIED_RECEIPTS'};
   });
  }
 }};
}
