import {randomUUID} from 'node:crypto';
import type {ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {inspectEffectiveResultInputs} from '../assurance/preparation.js';
import {inspectCoverage} from '../assurance/coverage.js';
import {loadProofObligations} from '../spec/obligations.js';
import {authorizeReview,canonical,fail,hash,obj,primary,scope,transaction,uuid} from './coverage.js';
import type {ReviewDb,ReviewScope} from './coverage.js';

type Data=Record<string,any>;
async function context(db:ReviewDb,s:ReviewScope,repairId:string,template:string):Promise<Data>{
 const r=(await db.query<Data>(`SELECT r.*,f.origin_task_id,f.origin_attempt_id,f.resolution_condition,base.repository_id,
 a.generation::text AS origin_generation FROM hyperfide.finding_repairs r
 JOIN hyperfide.finding_registry_records f ON f.organisation_id=r.organisation_id AND f.run_id=r.run_id AND f.finding_id=r.finding_id
 JOIN hyperfide.findings base ON base.organisation_id=f.organisation_id AND base.run_id=f.run_id AND base.id=f.finding_id
 JOIN hyperfide.attempts a ON a.organisation_id=f.organisation_id AND a.run_id=f.run_id AND a.id=f.origin_attempt_id
 WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.id=$3 FOR SHARE OF r,f,base,a`,[s.organisation_id,s.run_id,repairId])).rows[0];
 if(!r||!r.custody_id)fail('REPRODUCTION_REPAIR_UNSUBMITTED','Exact submitted repair required');
 const proof=await inspectCoverage(db as any,s,r.custody_id);
 if(!proof.qualified||proof.proof_source_origin!=='SUBMITTED_RESULT')fail('REPRODUCTION_REPAIR_UNQUALIFIED','Current independent submitted-result qualification required');
 const executed=(await db.query<Data>(`SELECT p.*,j.custody_id FROM hyperfide.assurance_job_receipts p
 JOIN hyperfide.qualification_jobs j ON j.organisation_id=p.organisation_id AND j.run_id=p.run_id AND j.id=p.job_id AND j.lease_generation=p.lease_generation
 WHERE p.organisation_id=$1 AND p.run_id=$2 AND j.custody_id=$3 AND p.receipt_digest=$4`,
 [s.organisation_id,s.run_id,r.custody_id,proof.receipt_digest])).rows[0];
 if(!executed)fail('REPRODUCTION_REPAIR_UNQUALIFIED','Actual independent check receipt is unavailable');
 const prepared=await inspectEffectiveResultInputs(db as PrimaryTransaction,s,{job_id:executed.job_id});
 const registry=async(taskId:string)=>{
  const task=(await db.query<Data>('SELECT spec_revision_id,spec_generation::text FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
   [s.organisation_id,s.run_id,taskId])).rows[0];
  if(!task)fail('REPRODUCTION_TASK_MISSING','Accepted source task is unavailable');
  return loadProofObligations(db as any,{...s,task_id:taskId,spec_revision_id:task.spec_revision_id,spec_generation:task.spec_generation});
 };
 const origin=await registry(r.origin_task_id),current=await registry(r.repair_task_id);
 const checks=current.policy.checks.filter((c:Data)=>c.id===template),before=origin.policy.checks.filter((c:Data)=>c.id===template);
 if(checks.length!==1||before.length!==1||canonical(checks[0])!==canonical(before[0])||
  !r.resolution_condition.counterfactual_check_ids.includes(template))fail('REPRODUCTION_CHECK_MISMATCH','Exact accepted original and repaired executable required');
 const observed=prepared.counterfactual?.filter((c:Data)=>c.check.id===template),after=executed.receipt.checks.filter((c:Data)=>c.check_id===template);
 if(!Array.isArray(observed)||observed.length!==1||after.length!==1||canonical(observed[0].check)!==canonical(checks[0])||
  observed[0].source_object_id!==r.baseline_source_object_id||after[0].source_object_id!==r.intended_source_object_id||
  prepared.source_object_id!==r.intended_source_object_id||String(prepared.custody_generation)!==String(r.custody_generation))
  fail('REPRODUCTION_SOURCE_MISMATCH','Observed original and repaired executions differ from exact repair lineage');
 const native=(await db.query<Data>(`SELECT * FROM hyperfide.runner_remote_jobs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3`,
  [s.organisation_id,s.run_id,prepared.preparation_operation_id])).rows[0];
 if(!native||native.job_class!=='PREPARATION'||native.state!=='COMPLETED'||native.result?.outcome!=='SUCCEEDED'||
  native.result?.cleanup?.complete!==true||native.result?.cleanup?.observed_process_absent!==true||
  native.principal.actor_id!==executed.verifier_id||native.session_id!==executed.verifier_id||
  native.plan.binding.sandbox_id!==executed.receipt.verifier_sandbox_id||native.plan.binding.boot_id!==executed.receipt.verifier_boot_id)
  fail('REPRODUCTION_RECEIPT_INCOMPLETE','Retained native counterfactual execution and exact independent verifier required');
 return {r,proof,executed,prepared,origin,current,check:checks[0],original:observed[0],repaired:after[0],native};
}

/** Index actual observations already made by the independent native recipe and
 * checker. This does not invent a second execution lease or relabel a custody. */
export async function recordRepairReproduction(ctx:ComponentContext,raw:unknown):Promise<unknown>{
 const v=obj(raw,['organisation_id','run_id','request_id','repair_id','template_id']),s=scope(v);
 const actor=authorizeReview(ctx,s,['VERIFIER']);
 const repairId=uuid(v.repair_id),request=uuid(v.request_id);
 if(typeof v.template_id!=='string')fail('REPRODUCTION_CHECK_MISSING','Registered template required');
 return transaction(ctx,s,async db=>{
  const x=await context(db,s,repairId,v.template_id as string);
  if(actor.invocation.principal.actor_id!==x.executed.verifier_id)fail('REPRODUCTION_JOB_DENIED','Only the actual independent verifier may bind its observed pair');
  const old=(await db.query<Data>('SELECT * FROM hyperfide.review_repair_reproductions WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',
   [s.organisation_id,s.run_id,request])).rows[0];
  if(old){if(old.request_digest!==hash(v))fail('REPRODUCTION_REQUEST_CONFLICT','Exact observed-pair request changed');return {plan_id:old.id,replayed:true};}
  const stdout=x.prepared.retained_artifacts.find((a:Data)=>a.artifact_digest===x.native.result.stdout.digest);
  if(!stdout)fail('REPRODUCTION_ARTIFACT_UNAVAILABLE','Complete native preparation transcript is not retained');
  const evidence=(await db.query<Data>(`INSERT INTO hyperfide.evidence(organisation_id,run_id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest,manifest_digest,artifact_id,admission_state)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ADMITTED') RETURNING id`,
   [s.organisation_id,s.run_id,x.r.origin_attempt_id,x.r.origin_generation,x.r.repository_id,x.original.source_object_id,x.origin.policy.criteria_digest,hash(x.original),stdout.artifact_id])).rows[0]!.id;
  await db.query('INSERT INTO hyperfide.evidence_artifacts(organisation_id,run_id,evidence_id,artifact_id,role) VALUES($1,$2,$3,$4,$5)',
   [s.organisation_id,s.run_id,evidence,stdout.artifact_id,'native-counterfactual-transcript']);
  const id=randomUUID();
  await db.query(`INSERT INTO hyperfide.review_repair_reproductions(organisation_id,run_id,id,request_id,request_digest,repair_id,qualification_job_id,effective_receipt_digest,qualification_receipt_digest,origin_registry_digest,check_definition_digest,template_id,original_evidence_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
   [s.organisation_id,s.run_id,id,request,hash(v),repairId,x.executed.job_id,x.prepared.receipt_digest,x.executed.receipt_digest,x.origin.registry_digest,hash(x.check),v.template_id,evidence]);
  return {plan_id:id,replayed:false,proof_basis:'RETAINED_NATIVE_COUNTERFACTUAL_AND_INDEPENDENT_QUALIFICATION'};
 });
}

export async function inspectRepairReproduction(db:ReviewDb,s:ReviewScope,id:string):Promise<Data|null>{
 await primary(db);
 if(!(await db.query<Data>("SELECT to_regclass('hyperfide.review_repair_reproductions') AS table_name")).rows[0]?.table_name)return null;
 const row=(await db.query<Data>('SELECT * FROM hyperfide.review_repair_reproductions WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
  [s.organisation_id,s.run_id,id])).rows[0];
 if(!row)return null;
 let x:Data;
 try{x=await context(db,s,row.repair_id,row.template_id);}catch{return {plan_id:id,plan_kind:'PAIRED',status:'STALE',original:{},repaired:{}};}
 const evidence=(await db.query<Data>(`SELECT e.*,a.status AS artifact_status,a.digest AS artifact_digest FROM hyperfide.evidence e
 JOIN hyperfide.artifacts a ON a.organisation_id=e.organisation_id AND a.run_id=e.run_id AND a.id=e.artifact_id
 WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.id=$3 AND EXISTS(SELECT 1 FROM hyperfide.evidence_artifacts link
 WHERE link.organisation_id=e.organisation_id AND link.run_id=e.run_id AND link.evidence_id=e.id AND link.artifact_id=e.artifact_id AND link.role='native-counterfactual-transcript')`,[s.organisation_id,s.run_id,row.original_evidence_id])).rows[0];
 const valid=row.qualification_job_id===x.executed.job_id&&row.effective_receipt_digest===x.prepared.receipt_digest&&
  row.qualification_receipt_digest===x.executed.receipt_digest&&row.origin_registry_digest===x.origin.registry_digest&&row.check_definition_digest===hash(x.check)&&
  evidence?.admission_state==='ADMITTED'&&evidence.artifact_status==='COMPLETE'&&evidence.artifact_digest===x.native.result.stdout.digest&&
  evidence.attempt_id===x.r.origin_attempt_id&&String(evidence.attempt_generation)===x.r.origin_generation&&
  evidence.source_object_id===x.original.source_object_id&&evidence.criteria_digest===x.origin.policy.criteria_digest&&evidence.manifest_digest===hash(x.original);
 const common={task_id:x.r.repair_task_id,origin_task_id:x.r.origin_task_id,origin_registry_digest:x.origin.registry_digest,
  registry_digest:x.current.registry_digest,criteria_digest:x.current.policy.criteria_digest,template_id:row.template_id,
  check_definition_digest:hash(x.check),qualification_scope:'COMPONENT',historical:false,registry_current:true,origin_registry_current:true};
 const placement={execution_plane:'REMOTE',capacity_kind:'TEST',sandbox_id:x.native.plan.binding.sandbox_id,slot_id:x.native.plan.binding.slot_id,
  runner_session_id:x.native.session_id,receipt_execution_plane:'REMOTE'};
 const before=x.original.exit_code===0?'PASS':'FAIL';
 return {status:valid?'COMPLETE':'STALE',plan_id:id,plan_kind:'PAIRED',proof_basis:'RETAINED_NATIVE_COUNTERFACTUAL_AND_INDEPENDENT_QUALIFICATION',
  original:{...common,source_task_id:x.r.origin_task_id,source_criteria_digest:x.origin.policy.criteria_digest,
   preparation_operation_id:x.prepared.preparation_operation_id,source_tree_id:x.original.source_tree_id,
   command:{argv:x.original.argv,cwd:x.original.cwd,exit_code:x.original.exit_code,started_at:x.original.started_at,ended_at:x.original.ended_at},
   source_set:[{repository_id:x.r.repository_id,source_object_id:x.original.source_object_id}],outcome:before,
   checks:[{id:row.template_id,status:before}],evidence_ids:[row.original_evidence_id],placement},
  repaired:{...common,source_task_id:x.r.repair_task_id,source_criteria_digest:x.current.policy.criteria_digest,
   custody_id:x.r.custody_id,custody_generation:String(x.r.custody_generation),source_set:[{repository_id:x.r.repository_id,source_object_id:x.repaired.source_object_id}],
   outcome:x.repaired.outcome,checks:[{id:row.template_id,status:x.repaired.outcome}],evidence_ids:[x.executed.evidence_id],placement}};
}
