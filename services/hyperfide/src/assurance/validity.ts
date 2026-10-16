import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {canonical,custodyLock,decimal,digest,fail,fields,hash,INPUT_KEYS,loadPacketInputs,loadPolicy,resultInputs,scope,transaction,uuid,roles,invocation,assuranceBarrier,artifact,executionGate} from './submission.js';
import type {Data,PrimaryClient} from './submission.js';
import {verifyReceiptRecordArtifacts} from './executor.js';
import {inspectCoverage} from './coverage.js';
import type {CoverageScope,Queryable} from './coverage.js';

/** Accepted-spec writers use their existing primary transaction; history remains immutable. */
export async function invalidateAcceptedSpec(db:Queryable,s:CoverageScope,taskIds:string[],reason:string):Promise<number>{
 await assuranceBarrier(db,s,'EXCLUSIVE');
 let count=0;
 for(const taskId of [...new Set(taskIds)].sort()){
  const result=await db.query("UPDATE hyperfide.assurance_applicability a SET applicability='STALE',reasons=$4::jsonb,state_version=a.state_version+1 "
   +"FROM hyperfide.submission_custodies c WHERE a.organisation_id=$1 AND a.run_id=$2 AND c.task_id=$3 "
   +"AND c.organisation_id=a.organisation_id AND c.run_id=a.run_id AND c.id=a.custody_id AND a.applicability<>'STALE'",
   [s.organisation_id,s.run_id,taskId,JSON.stringify([{kind:'ACCEPTED_SPEC_CHANGED',reason}])]);
  count+=result.rowCount??0;
  await db.query("UPDATE hyperfide.qualification_jobs j SET state='CANCELLED',lease_generation=j.lease_generation+1,lease_owner=NULL,lease_expires_at=NULL,state_version=j.state_version+1 "
   +"FROM hyperfide.submission_custodies c WHERE j.organisation_id=$1 AND j.run_id=$2 AND c.task_id=$3 AND c.organisation_id=j.organisation_id AND c.run_id=j.run_id AND c.id=j.custody_id AND j.state IN ('PENDING','RUNNING')",[s.organisation_id,s.run_id,taskId]);
 }
 return count;
}
async function publication(db:Queryable,s:CoverageScope,custody:Data):Promise<Data>{
 try{
  const name='../integration/publication.js',module=await import(name) as Data;
  return await module.inspectIntegratedPublication(db,s,{task_id:custody.task_id,custody_id:custody.id,custody_generation:String(custody.custody_generation)}) as Data;
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error)return {status:'MISSING',reason:String(error.code)};
  return {status:'MISSING',reason:'INTEGRATION_RECEIPT_UNAVAILABLE'};
 }
}
/** Read-only same-primary inspector for views and delivery accounting. */
export async function inspectValidity(db:PrimaryClient,s:CoverageScope,id:string):Promise<Data>{
 await assuranceBarrier(db,s,'SHARED');
 const c=await custodyLock(db,[s.organisation_id,s.run_id],uuid(id));
 const coverage=await inspectCoverage(db,s,id);
 const history=await db.query('SELECT count(*)::text AS count FROM hyperfide.assurance_job_receipts p JOIN hyperfide.qualification_jobs q ON q.organisation_id=p.organisation_id AND q.run_id=p.run_id AND q.id=p.job_id WHERE q.organisation_id=$1 AND q.run_id=$2 AND q.custody_id=$3',[s.organisation_id,s.run_id,id]);
 const integrated=c.authority==='RELEASED'?await publication(db,s,c):{status:'MISSING'};
 return {...coverage,implementation_progress:c.task.state,historical_receipt_count:history.rows[0].count,
  current_integrated_assurance:c.authority==='RELEASED'&&coverage.applicability==='CURRENT'&&coverage.proof_complete&&
   c.qualification_outcome==='PASS'&&integrated.status==='PUBLISHED'&&coverage.proof_registry_current===true&&
   coverage.proof_source_object_id===integrated.source_object_id&&coverage.proof_source_manifest_digest===integrated.source_manifest_digest,
  integration_receipt:integrated,original_compute_authority:'NOT_USED',released_custody_resurrected:false};
}
async function inspect(ctx:ComponentContext,raw:unknown):Promise<Data>{
 const v=fields(raw,['organisation_id','run_id','submission_id']),s=scope(ctx,v),id=uuid(v.submission_id);
 return transaction(ctx,db=>inspectValidity(db,{organisation_id:s[0],run_id:s[1]},id));
}
async function freshContext(ctx:ComponentContext,db:PrimaryClient,s:[string,string],c:Data,saved:Data,v:Data):Promise<Data>{
 if(v.input_packet_digest===undefined)fail('QUALIFICATION_PACKET_REQUIRED','Fresh requalification requires an actual immutable execution packet');
 const packet=await loadPacketInputs(db,s,digest(v.input_packet_digest)),policy=await loadPolicy(ctx,c.task,db);
 if(packet.packet.mandatory.identity.task_id!==c.task_id)
  fail('QUALIFICATION_PACKET_INVALID','Fresh packet belongs to another task');
 let manifest={...saved.manifest};
 if(c.authority==='RELEASED'){
  const observed=await publication(db,{organisation_id:s[0],run_id:s[1]},c);
  if(observed.status!=='PUBLISHED'||observed.observed_head!==observed.source_object_id||!Array.isArray(observed.parents)||
   !observed.tree||!observed.source_manifest_digest||
   v.publication_operation_id!==undefined&&v.publication_operation_id!==observed.operation_id)
   fail('QUALIFICATION_INTEGRATION_RECEIPT_REQUIRED','Released custody requires exact immutable published commit/tree/parent provenance');
  manifest={...manifest,repository_id:observed.repository_id,source_object_id:observed.source_object_id,
   source_tree_id:observed.tree,source_parent_ids:observed.parents,baseline_source_object_id:policy.source_object_id,
   source_manifest_digest:observed.source_manifest_digest,original_source_manifest_artifact_id:manifest.source_manifest_artifact_id,
   source_manifest_artifact_id:null,publication_operation_id:observed.operation_id,source_origin:'INTEGRATED_PUBLICATION'};
 }
 const inputs=resultInputs(manifest,manifest.source_manifest_digest,packet.derived);
 return {manifest:{...manifest,input_packet_digest:packet.digest,mandatory_digest:packet.mandatory_digest,
  registry_digest:hash(policy),input_manifest:inputs,graph_manifest_digest:packet.derived.graph_manifest_digest,
  graph_status:packet.derived.graph_status},policy,inputs};
}
async function invalidate(ctx:ComponentContext,raw:unknown):Promise<Data>{
 const inv=roles(ctx,['COORDINATOR','OPERATOR']);
 const v=fields(raw,['organisation_id','run_id','submission_id','request_id','expected_state_version','changes'],
  ['publication_operation_id','input_packet_digest']);
 const s=scope(ctx,v),id=uuid(v.submission_id),requestId=uuid(v.request_id),version=decimal(v.expected_state_version);
 if(requestId!==inv.operation.idempotency_key)fail('QUALIFICATION_IDEMPOTENCY_CONFLICT','Invalidation must bind authenticated idempotency identity');
 if(!v.changes||typeof v.changes!=='object'||Array.isArray(v.changes)||Object.keys(v.changes).length>64)
  fail('QUALIFICATION_INPUT_INVALID','Bounded input change map required');
 for(const value of Object.values(v.changes))digest(value);
 if(v.publication_operation_id!==undefined)uuid(v.publication_operation_id);
 if(v.input_packet_digest!==undefined)digest(v.input_packet_digest);
 const requestDigest=hash(v);
 return transaction(ctx,async db=>{
  const c=await custodyLock(db,s,id);
  const replay=await db.query('SELECT request_digest,affected_checks,requalification_id FROM hyperfide.assurance_invalidations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[...s,requestId]);
  if(replay.rows[0]){
   if(replay.rows[0].request_digest!==requestDigest)fail('QUALIFICATION_IDEMPOTENCY_CONFLICT','Invalidation identity already binds other inputs');
   return {...replay.rows[0],replayed:true};
  }
  const current=await db.query('SELECT * FROM hyperfide.assurance_applicability WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3 FOR UPDATE',[...s,id]);
  const applicable=current.rows[0];
  if(!applicable||String(applicable.state_version)!==version)fail('QUALIFICATION_CONFLICT','Applicability version changed');
  if(!['ACTIVE','RELEASED'].includes(c.authority))fail('QUALIFICATION_STALE_CUSTODY','Disposed custody cannot schedule requalification');
  const saved=(await db.query('SELECT manifest,policy FROM hyperfide.assurance_submissions WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3',[...s,id])).rows[0];
  const changed=Object.keys(v.changes).filter(key=>INPUT_KEYS.includes(key as any)&&v.changes[key]!==applicable.input_manifest[key]);
  const after={...applicable.input_manifest};for(const key of changed)after[key]=v.changes[key];
  let affected=saved.policy.checks.filter((check:Data)=>check.input_keys.some((key:string)=>changed.includes(key))).map((check:Data)=>check.id);
  let operation:string|null=null,blocked:string|null=null,context:Data|undefined;
  const needsRequalification=changed.length>0||applicable.applicability==='STALE'&&v.input_packet_digest!==undefined;
  if(needsRequalification){
   // Invalidation commits even when a fresh registry/packet/environment is not yet available.
   await db.query("UPDATE hyperfide.assurance_applicability SET applicability='STALE',input_manifest=$4,reasons=$5,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3",
    [...s,id,after,JSON.stringify(changed.map(key=>({input:key,before:applicable.input_manifest[key],after:after[key]})))]);
   if(c.authority==='ACTIVE')await db.query("UPDATE hyperfide.tasks SET state='STALE',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...s,c.task_id]);
   try{
    await executionGate(ctx,db,s,'ADMISSION');
    context=await freshContext(ctx,db,s,c,saved,v);
    if(canonical(context.inputs)!==canonical(after))blocked='QUALIFICATION_INPUT_MISMATCH';
   }catch(error){if(error&&typeof error==='object'&&'code' in error)blocked=String(error.code);else throw error;}
   if(context&&!blocked){
    if(hash(context.policy)!==hash(saved.policy))affected=context.policy.checks.map((check:Data)=>check.id);
    const pending=await db.query("SELECT q.id,q.qualification_job_id,i.policy,q.input_manifest_digest FROM hyperfide.requalification_operations q JOIN hyperfide.assurance_requalification_inputs i ON i.organisation_id=q.organisation_id AND i.run_id=q.run_id AND i.operation_id=q.id WHERE q.organisation_id=$1 AND q.run_id=$2 AND q.custody_id=$3 AND q.state IN ('PENDING','RUNNING') FOR UPDATE OF q",[...s,id]);
    const same=pending.rows.find((q:Data)=>q.input_manifest_digest===hash(after)&&hash(q.policy)===hash(context!.policy));
    if(same)operation=same.id;
    else{
     for(const old of pending.rows){
      await db.query("UPDATE hyperfide.qualification_jobs SET state='CANCELLED',lease_generation=lease_generation+1,lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state IN ('PENDING','RUNNING')",[...s,old.qualification_job_id]);
      await db.query("UPDATE hyperfide.requalification_operations SET state='CANCELLED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...s,old.id]);
     }
     operation=randomUUID();const job=randomUUID();
     await db.query('INSERT INTO hyperfide.qualification_jobs(organisation_id,run_id,id,custody_id,custody_generation,rubric_digest) VALUES($1,$2,$3,$4,$5,$6)',[...s,job,id,String(c.custody_generation),context.policy.rubric_digest]);
     await db.query('INSERT INTO hyperfide.requalification_operations(organisation_id,run_id,id,custody_id,custody_generation,qualification_job_id,request_id,input_manifest_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[...s,operation,id,String(c.custody_generation),job,requestId,hash(after)]);
     await db.query('INSERT INTO hyperfide.assurance_requalification_inputs(organisation_id,run_id,operation_id,publication_operation_id,manifest,policy,registry_digest,input_manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[...s,operation,context.manifest.publication_operation_id??null,context.manifest,context.policy,hash(context.policy),after]);
    }
   }
  }
  await db.query('INSERT INTO hyperfide.assurance_invalidations(organisation_id,run_id,request_id,custody_id,request_digest,before_inputs,after_inputs,affected_checks,requalification_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[...s,requestId,id,requestDigest,applicable.input_manifest,after,JSON.stringify(affected),operation]);
  return {replayed:false,applicability:needsRequalification?'STALE':applicable.applicability,affected_checks:affected,
   requalification_id:operation,requalification_blocked_reason:blocked,historical_receipts_preserved:true,
   custody_authority:c.authority,compute_authority_restored:false,state_version:(BigInt(version)+(needsRequalification?1n:0n)).toString()};
 });
}
async function acceptRequalification(ctx:ComponentContext,raw:unknown):Promise<Data>{
 roles(ctx,['COORDINATOR','OPERATOR']);
 const v=fields(raw,['organisation_id','run_id','operation_id','expected_state_version']);
 const s=scope(ctx,v),id=uuid(v.operation_id),version=decimal(v.expected_state_version);
 const checked=await transaction(ctx,async db=>{
  const receipt=await db.query("SELECT p.receipt,p.receipt_digest,p.receipt_artifact_id FROM hyperfide.requalification_operations q JOIN hyperfide.assurance_job_receipts p ON p.organisation_id=q.organisation_id AND p.run_id=q.run_id AND p.job_id=q.qualification_job_id JOIN hyperfide.qualification_jobs j ON j.organisation_id=p.organisation_id AND j.run_id=p.run_id AND j.id=p.job_id AND j.lease_generation=p.lease_generation WHERE q.organisation_id=$1 AND q.run_id=$2 AND q.id=$3 AND q.state='SUCCEEDED' AND j.state='SUCCEEDED' AND j.outcome='PASS'",[...s,id]);
  if(!receipt.rows[0])fail('QUALIFICATION_PROOF_INCOMPLETE','Current independent successful execution receipt required');
  const reviews=await db.query("SELECT support FROM hyperfide.assurance_judgements WHERE organisation_id=$1 AND run_id=$2 AND requalification_id=$3 AND disposition='PASS'",[...s,id]);
  return {...receipt.rows[0],support_artifact_ids:reviews.rows.flatMap((row:Data)=>row.support)};
 });
 await verifyReceiptRecordArtifacts(ctx,s,checked);
 for(const support of checked.support_artifact_ids)await artifact(ctx,'artifact.object.inspect',{organisation_id:s[0],run_id:s[1],artifact_id:support});
 return transaction(ctx,async db=>{
  const initial=await db.query('SELECT custody_id FROM hyperfide.requalification_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...s,id]);
  if(!initial.rows[0])fail('QUALIFICATION_NOT_FOUND','Requalification operation not found');
  const c=await custodyLock(db,s,initial.rows[0].custody_id);
  await executionGate(ctx,db,s,'ADVANCE');
  const app=(await db.query('SELECT * FROM hyperfide.assurance_applicability WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3 FOR UPDATE',[...s,c.id])).rows[0];
  const replay=await db.query('SELECT receipt_digest FROM hyperfide.assurance_requalification_acceptances WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[...s,id]);
  if(replay.rows[0])return {operation_id:id,receipt_digest:replay.rows[0].receipt_digest,replayed:true,
   applicability:app.applicability==='CURRENT'&&app.current_receipt_digest===replay.rows[0].receipt_digest?'CURRENT':'STALE',
   custody_authority:c.authority,compute_authority_restored:false};
  const operation=(await db.query("SELECT q.*,i.manifest,i.policy,i.input_manifest FROM hyperfide.requalification_operations q JOIN hyperfide.assurance_requalification_inputs i ON i.organisation_id=q.organisation_id AND i.run_id=q.run_id AND i.operation_id=q.id WHERE q.organisation_id=$1 AND q.run_id=$2 AND q.id=$3 FOR UPDATE OF q",[...s,id])).rows[0];
  if(!operation||operation.state!=='SUCCEEDED'||!['ACTIVE','RELEASED'].includes(c.authority))
   fail('QUALIFICATION_PROOF_INCOMPLETE','Current successful independent requalification job required');
  if(String(app.state_version)!==version||canonical(app.input_manifest)!==canonical(operation.input_manifest))
   fail('QUALIFICATION_CONFLICT','Requalification inputs or expected version changed');
  if(hash(await loadPolicy(ctx,c.task,db))!==hash(operation.policy))
   fail('QUALIFICATION_POLICY_STALE','Accepted proof obligations changed during requalification');
  if(c.authority==='RELEASED'){
   const integrated=await publication(db,{organisation_id:s[0],run_id:s[1]},c);
   if(integrated.status!=='PUBLISHED'||integrated.operation_id!==operation.manifest.publication_operation_id||
    integrated.source_object_id!==operation.manifest.source_object_id||integrated.tree!==operation.manifest.source_tree_id)
    fail('QUALIFICATION_INTEGRATION_RECEIPT_REQUIRED','Fresh proof no longer binds the current integrated publication');
  }
  const proof=(await db.query("SELECT p.receipt,p.receipt_digest,p.evidence_id FROM hyperfide.assurance_job_receipts p JOIN hyperfide.qualification_jobs q ON q.organisation_id=p.organisation_id AND q.run_id=p.run_id AND q.id=p.job_id AND q.lease_generation=p.lease_generation WHERE q.organisation_id=$1 AND q.run_id=$2 AND q.id=$3 AND q.state='SUCCEEDED' AND q.outcome='PASS'",[...s,operation.qualification_job_id])).rows[0];
  if(!proof||proof.receipt_digest!==checked.receipt_digest||hash(proof.receipt)!==proof.receipt_digest||proof.receipt.outcome!=='PASS'||
   proof.receipt.source_object_id!==operation.manifest.source_object_id||proof.receipt.rubric_digest!==operation.policy.rubric_digest||
   canonical(proof.receipt.required_check_ids)!==canonical(operation.policy.checks.map((check:Data)=>check.id))||
   proof.receipt.checks.length!==operation.policy.checks.length||
   !proof.receipt.checks.every((check:Data)=>check.outcome==='PASS'&&canonical(check.input_manifest)===canonical(operation.input_manifest)))
   fail('QUALIFICATION_PROOF_INCOMPLETE','Exact fresh-input command and artifact receipts required');
  for(const clause of operation.policy.clauses as Data[]){
   if(clause.mode==='EXECUTABLE'){
    if(!clause.checks.every((key:string)=>proof.receipt.checks.some((check:Data)=>check.check_id===key&&check.outcome==='PASS')))
     fail('QUALIFICATION_PROOF_INCOMPLETE','Required executable clause remains open');
   }else{
    const reviews=await db.query("SELECT reviewer_id,support FROM hyperfide.assurance_judgements WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3 AND clause_id=$4 AND rubric_digest=$5 AND input_manifest_digest=$6 AND requalification_id=$7 AND disposition='PASS' AND length(limitations)>0",
     [...s,c.id,clause.id,clause.rubric_digest,hash(operation.input_manifest),id]);
    const review=reviews.rows.find((r:Data)=>clause.reviewers.includes(r.reviewer_id)&&r.support?.length);
    if(!review)fail('QUALIFICATION_REVIEW_REQUIRED','Relevant changes require fresh policy-permitted clause review');
    for(const artifactId of review.support)await db.query('SELECT hyperfide.require_complete_artifact($1,$2,$3)',[...s,artifactId]);
   }
  }
  await db.query('INSERT INTO hyperfide.assurance_requalification_acceptances(organisation_id,run_id,operation_id,receipt_digest) VALUES($1,$2,$3,$4)',[...s,id,proof.receipt_digest]);
  await db.query("UPDATE hyperfide.assurance_applicability SET applicability='CURRENT',current_receipt_digest=$4,reasons='[]',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3",[...s,c.id,proof.receipt_digest]);
  if(c.authority==='ACTIVE'){
   await db.query("UPDATE hyperfide.submission_custodies SET qualification_outcome='PASS',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...s,c.id]);
   await db.query("UPDATE hyperfide.tasks SET state='QUALIFIED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...s,c.task_id]);
  }
  return {operation_id:id,replayed:false,applicability:'CURRENT',receipt_digest:proof.receipt_digest,
   evidence_id:proof.evidence_id,custody_authority:c.authority,compute_authority_restored:false,historical_receipts_preserved:true};
 });
}
export function createComponent(ctx:ComponentContext):Component & {capabilities:Record<string,unknown>}{
 return {apiVersion:1,capabilities:{'assurance.validity.v1':Object.freeze({inspectValidity,invalidateAcceptedSpec})},actions:{
  'assurance.validity.inspect':(raw,requestContext)=>inspect(requestContext,raw),
  'assurance.invalidate':(raw,requestContext)=>invalidate(requestContext,raw),
  'assurance.requalification.accept':(raw,requestContext)=>acceptRequalification(requestContext,raw)
 }};
}
