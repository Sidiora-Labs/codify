import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {artifact,canonical,currentCustody,custodyLock,decimal,digest,fail,fields,hash,scope,transaction,uuid,roles,loadPolicy,assuranceBarrier,executionGate} from './submission.js';
import {verifyReceiptRecordArtifacts} from './executor.js';
import type {Data,PrimaryClient} from './submission.js';

export type Queryable=PrimaryClient;
export interface CoverageScope{organisation_id:string;run_id:string}
/** Runs on the caller's primary transaction; never substitutes a second pool snapshot. */
export async function inspectCoverage(db:Queryable,s:CoverageScope,custodyId:string):Promise<Data>{
 await assuranceBarrier(db,s,'SHARED');
 const params=[s.organisation_id,s.run_id,custodyId];
 const result=await db.query("SELECT c.*,t.current_custody_id,t.criteria_digest AS current_criteria,r.authority_epoch AS current_epoch,"
 +"a.applicability,a.input_manifest,a.current_receipt_digest,a.state_version AS applicability_version,"
 +"p.policy,p.manifest FROM hyperfide.submission_custodies c JOIN hyperfide.tasks t ON t.organisation_id=c.organisation_id AND t.run_id=c.run_id AND t.id=c.task_id "
 +"JOIN hyperfide.runs r ON r.organisation_id=c.organisation_id AND r.id=c.run_id "
 +"JOIN hyperfide.assurance_submissions p ON p.organisation_id=c.organisation_id AND p.run_id=c.run_id AND p.custody_id=c.id "
 +"JOIN hyperfide.assurance_applicability a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.custody_id=c.id "
 +"WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3",params);
 const c=result.rows[0];
 if(!c)fail('QUALIFICATION_NOT_FOUND','Immutable submission proof context not found');
 let policy=c.policy as Data,proofManifest=c.manifest as Data,freshOperation:string|null=null;
 const fresh=await db.query("SELECT i.policy,i.manifest,q.id FROM hyperfide.assurance_requalification_acceptances a JOIN hyperfide.requalification_operations q ON q.organisation_id=a.organisation_id AND q.run_id=a.run_id AND q.id=a.operation_id JOIN hyperfide.assurance_requalification_inputs i ON i.organisation_id=q.organisation_id AND i.run_id=q.run_id AND i.operation_id=q.id WHERE q.organisation_id=$1 AND q.run_id=$2 AND q.custody_id=$3 AND q.state='SUCCEEDED' AND a.receipt_digest=$4 ORDER BY a.accepted_at DESC LIMIT 1",[...params,c.current_receipt_digest]);
 if(fresh.rows[0]){policy=fresh.rows[0].policy;proofManifest=fresh.rows[0].manifest;freshOperation=fresh.rows[0].id;}
 let registryCurrent=false;
 try{
  const name='../spec/obligations.js',reader=await import(name) as Data;
  const current=await reader.loadProofObligations(db,{organisation_id:s.organisation_id,run_id:s.run_id,task_id:c.task_id,
   spec_revision_id:policy.spec_revision_id,spec_generation:String(policy.spec_generation)});
  registryCurrent=current.registry_digest===hash(policy);
 }catch{/* Missing current accepted authority is explicit stale/missing applicability, never a historical PASS promotion. */}
 const receipts=await db.query("SELECT q.id AS job_id,q.rubric_digest,q.state,q.outcome,q.custody_generation,p.receipt,p.receipt_digest "
 +"FROM hyperfide.qualification_jobs q JOIN hyperfide.assurance_job_receipts p ON p.organisation_id=q.organisation_id AND p.run_id=q.run_id AND p.job_id=q.id AND p.lease_generation=q.lease_generation "
 +"WHERE q.organisation_id=$1 AND q.run_id=$2 AND q.custody_id=$3 AND q.state='SUCCEEDED' AND q.outcome='PASS' "
 +"AND (($4::text IS NOT NULL AND p.receipt_digest=$4) OR ($4::text IS NULL AND p.receipt->>'registry_digest'=$5 AND p.receipt->>'source_object_id'=$6 AND p.receipt->'input_manifest'=$7::jsonb)) "
 +"ORDER BY p.created_at DESC,q.id DESC LIMIT 9",[...params,c.current_receipt_digest,hash(policy),proofManifest.source_object_id,JSON.stringify(c.input_manifest)]);
 if(receipts.rows.length>8)fail('QUALIFICATION_INSPECTION_BUDGET','Explicit proof selection is required when the bounded receipt inventory is exceeded');
 const valid:Data[]=[];
 const required=policy.checks.map((check:Data)=>check.id);
 for(const row of receipts.rows){
  const receipt=row.receipt as Data;
  if(row.state!=='SUCCEEDED'||row.outcome!=='PASS'||row.rubric_digest!==policy.rubric_digest||
   String(row.custody_generation)!==String(c.custody_generation)||hash(receipt)!==row.receipt_digest||
   receipt.custody_id!==custodyId||String(receipt.custody_generation)!==String(c.custody_generation)||
   receipt.rubric_digest!==policy.rubric_digest||receipt.registry_digest!==hash(policy)||receipt.criteria_digest!==policy.criteria_digest||
   receipt.source_manifest_digest!==proofManifest.source_manifest_digest||
   receipt.source_object_id!==proofManifest.source_object_id||receipt.outcome!=='PASS'||
   canonical(receipt.required_check_ids)!==canonical(required)||!Array.isArray(receipt.checks)||receipt.checks.length!==required.length)continue;
  const seen=new Set<string>();let complete=true;
  for(const check of receipt.checks){
   const registered=policy.checks.find((gate:Data)=>gate.id===check.check_id);
   if(!registered||seen.has(check.check_id)||check.outcome!=='PASS'||
    check.source_object_id!==proofManifest.source_object_id||check.environment_digest!==receipt.environment_digest||
    check.executable_digest!==registered.executable_digest||canonical(check.command?.argv)!==canonical(registered.argv)||
    check.command?.cwd!=='.'||!check.command?.workspace_path||check.command?.environment_digest!==hash(check.command?.environment)||
    check.command?.exit_code!==0||check.command?.signal!==null||check.command?.timed_out!==false||
    check.command?.interrupted!==false||check.command?.output_truncated!==false||
    !check.command?.started_at||!check.command?.ended_at||!Number.isFinite(check.command?.duration_ms)||
    canonical(check.input_manifest)!==canonical(c.input_manifest)||
    !Array.isArray(check.artifacts)||canonical(check.artifacts.map((a:Data)=>a.path))!==canonical(registered.required_artifacts)||
    !check.output?.stdout||!check.output?.stderr||check.execution?.cleanup_status!=='CONFIRMED'||
    check.execution?.cleanup?.complete!==true||check.execution?.cleanup?.observed_process_absent!==true||
    !check.execution?.process_ref||!check.execution?.start_identity||!check.execution?.spool_digest||
    check.execution?.source_manifest_digest!==proofManifest.source_manifest_digest||check.execution?.source_provenance_digest!==c.input_manifest.source||
    !check.execution?.source_state_digest||check.execution?.input_validation?.status!=='VERIFIED'||
    check.execution?.input_validation?.job_id!==receipt.job_id||check.execution?.input_validation?.input_packet_digest!==proofManifest.input_packet_digest||
    !/^sha256:[0-9a-f]{64}$/.test(check.execution?.input_validation?.receipt_digest??'')||
    ['dependency','toolchain','configuration','graph','contract'].some(key=>check.execution?.input_validation?.input_manifest?.[key]!==c.input_manifest[key])){complete=false;break;}
   seen.add(check.check_id);
   for(const ref of [check.output.stdout,check.output.stderr,...check.artifacts]){
    if(!ref.artifact_id||!ref.digest||typeof ref.size_bytes!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(ref.size_bytes)||
     !['OBJECT','CHUNK_MANIFEST'].includes(ref.storage_kind)||
     ref.storage_kind==='CHUNK_MANIFEST'&&(typeof ref.manifest_size_bytes!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(ref.manifest_size_bytes)||!/^sha256:[0-9a-f]{64}$/.test(ref.content_digest??''))){complete=false;break;}
    const found=await db.query("SELECT digest,status,size_bytes::text FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3",
     [s.organisation_id,s.run_id,ref.artifact_id]);
    if(found.rows[0]?.status!=='COMPLETE'||found.rows[0]?.digest!==ref.digest||found.rows[0]?.size_bytes!==(ref.manifest_size_bytes??ref.size_bytes)){complete=false;break;}
   }
  }
  if(complete&&seen.size===required.length)valid.push(row);
 }
 const receipt=valid.find(row=>row.receipt_digest===c.current_receipt_digest)??valid[0];
 const judgements=await db.query('SELECT clause_id,reviewer_id,rubric_digest,input_manifest_digest,requalification_id,support,limitations,disposition FROM hyperfide.assurance_judgements WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3',params);
 const clauses:Data[]=[];
 const inputDigest=hash(c.input_manifest);
 for(const clause of policy.clauses as Data[]){
  let satisfied=false,reason:string,evidence:Data|null=null,review:Data|null=null;
  // Every judgement for this exact clause stays visible; only a policy-permitted one can close it.
  const recorded=judgements.rows.filter((j:Data)=>j.clause_id===clause.id).map((j:Data)=>({reviewer_id:j.reviewer_id,
   approved_reviewer:clause.mode==='REVIEW'&&clause.reviewers.includes(j.reviewer_id),rubric_digest:j.rubric_digest,
   input_manifest_digest:j.input_manifest_digest,current_inputs:j.input_manifest_digest===inputDigest,requalification_id:j.requalification_id??null,
   support_artifact_ids:j.support??[],limitations:j.limitations,disposition:j.disposition}));
  if(clause.mode==='EXECUTABLE'){
   const passed=receipt?clause.checks.filter((id:string)=>receipt.receipt.checks.some((gate:Data)=>gate.check_id===id&&gate.outcome==='PASS')):[];
   satisfied=!!receipt&&passed.length===clause.checks.length;
   evidence={kind:'EXECUTABLE_RECEIPT',receipt_digest:receipt?.receipt_digest??null,job_id:receipt?.job_id??null,
    required_check_ids:clause.checks,passed_check_ids:passed,missing_check_ids:clause.checks.filter((id:string)=>!passed.includes(id))};
   reason=satisfied?'Exact registered executable proof is complete':'Required executable proof missing, failed, stale or incomplete';
  }else{
   const candidate=judgements.rows.find((j:Data)=>j.clause_id===clause.id&&j.input_manifest_digest===inputDigest&&(!freshOperation||j.requalification_id===freshOperation)&&clause.reviewers.includes(j.reviewer_id)&&j.rubric_digest===clause.rubric_digest&&j.disposition==='PASS'&&j.limitations&&j.support?.length);
   satisfied=!!candidate;
   const unavailable:string[]=[];
   if(candidate)for(const id of candidate.support){
    const support=await db.query("SELECT status FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[s.organisation_id,s.run_id,id]);
    if(support.rows[0]?.status!=='COMPLETE'){satisfied=false;unavailable.push(id);}
   }
   if(candidate)review={reviewer_id:candidate.reviewer_id,rubric_digest:candidate.rubric_digest,input_manifest_digest:candidate.input_manifest_digest,
    requalification_id:candidate.requalification_id??null,support_artifact_ids:candidate.support,unavailable_support_artifact_ids:unavailable,
    limitations:candidate.limitations,disposition:candidate.disposition};
   evidence={kind:'REVIEW_JUDGEMENT',rubric_digest:clause.rubric_digest,permitted_reviewers:clause.reviewers,
    support_artifact_ids:candidate?.support??[]};
   reason=satisfied?'Policy-permitted independent rubric judgement with complete supporting artifacts':'Required independent rubric judgement missing or unsupported';
  }
  clauses.push({id:clause.id,mode:clause.mode,acceptance_ids:clause.acceptance_ids,check_ids:clause.mode==='EXECUTABLE'?clause.checks:[],satisfied,reason,
   evidence,review,judgements:recorded,mandatory_proof:clause.mode==='EXECUTABLE'?'EXECUTABLE':'POLICY_PERMITTED_REVIEW'});
 }
 const proofComplete=!!receipt&&clauses.length>0&&clauses.every(clause=>clause.satisfied);
 const applicability=registryCurrent?c.applicability:c.applicability==='CURRENT'?'STALE':c.applicability;
 const active=c.authority==='ACTIVE'&&c.current_custody_id===c.id&&c.authority_epoch===c.current_epoch&&policy.criteria_digest===c.current_criteria;
 return {submission_id:c.id,custody_generation:String(c.custody_generation),authority:c.authority,qualification_outcome:c.qualification_outcome,
  applicability,proof_registry_current:registryCurrent,proof_registry_digest:hash(policy),proof_source_object_id:proofManifest.source_object_id,proof_source_tree_id:proofManifest.source_tree_id,proof_source_origin:proofManifest.source_origin??'SUBMITTED_RESULT',proof_publication_operation_id:proofManifest.publication_operation_id??null,proof_source_manifest_digest:proofManifest.source_manifest_digest,
  proof_git_provenance_manifest_digest:proofManifest.git_provenance_manifest_digest??null,proof_integration_input_manifest_digest:proofManifest.integration_input_manifest_digest??null,proof_criteria_digest:policy.criteria_digest,applicability_version:String(c.applicability_version),source_object_id:c.source_object_id,
  criteria_digest:c.criteria_digest,source_manifest_digest:c.source_manifest_digest,evidence_manifest_digest:c.evidence_manifest_digest,
  receipt_digest:receipt?.receipt_digest??null,rubric_digest:policy.rubric_digest,required_check_ids:required,
  passed_check_ids:receipt?required:[],clauses,proof_complete:proofComplete,
  qualified:registryCurrent&&active&&proofComplete&&c.qualification_outcome==='PASS'&&applicability==='CURRENT'&&c.current_receipt_digest===receipt?.receipt_digest};
}
async function inspect(ctx:ComponentContext,raw:unknown):Promise<Data>{
 const v=fields(raw,['organisation_id','run_id','submission_id']),s=scope(ctx,v),id=uuid(v.submission_id);
 return transaction(ctx,async client=>inspectCoverage(client,{organisation_id:s[0],run_id:s[1]},id),false,'READ');
}
async function judgement(ctx:ComponentContext,raw:unknown):Promise<Data>{
 // A model score or confidence is never a judgement, support or substitute for mandatory executable proof.
 if(raw&&typeof raw==='object'&&Object.keys(raw).some(key=>/score|confidence|probability/i.test(key)))
  fail('QUALIFICATION_INPUT_INVALID','Model score or confidence cannot be recorded as review judgement or proof');
 const v=fields(raw,['organisation_id','run_id','submission_id','custody_generation','expected_state_version','clause_id',
 'rubric_digest','support_artifact_ids','limitations','disposition'],['requalification_id']);
 const s=scope(ctx,v),id=uuid(v.submission_id),generation=decimal(v.custody_generation),version=decimal(v.expected_state_version);
 const reviewer=uuid(roles(ctx,['VERIFIER','COMMIT_WATCHER','ISSUE_WATCHER']).principal.actor_id);
 digest(v.rubric_digest);
 if(typeof v.clause_id!=='string'||!v.clause_id||!['PASS','FAIL'].includes(v.disposition)||
 typeof v.limitations!=='string'||!v.limitations.trim()||v.limitations.length>8192||
 !Array.isArray(v.support_artifact_ids)||!v.support_artifact_ids.length||v.support_artifact_ids.length>64||
 new Set(v.support_artifact_ids).size!==v.support_artifact_ids.length)
 fail('QUALIFICATION_INPUT_INVALID','Judgement requires exact clause/rubric, support and explicit limitations');
 for(const support of v.support_artifact_ids){uuid(support);await artifact(ctx,'artifact.object.inspect',{organisation_id:s[0],run_id:s[1],artifact_id:support});}
 return transaction(ctx,async client=>{
  const c=await custodyLock(client,s,id);
  await executionGate(ctx,client,s,'ADVANCE');
  if(String(c.custody_generation)!==generation||String(c.state_version)!==version)fail('QUALIFICATION_STALE_CUSTODY','Custody expected version changed');
  if(v.requalification_id===undefined)currentCustody(c,generation,version);
  else if(!['ACTIVE','RELEASED'].includes(c.authority))fail('QUALIFICATION_STALE_CUSTODY','Requalification custody was disposed');
  const inputs=await client.query('SELECT input_manifest FROM hyperfide.assurance_applicability WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3',[...s,id]);
  let freshPolicy:Data|undefined;
  if(v.requalification_id!==undefined){
   uuid(v.requalification_id);
   const fresh=await client.query("SELECT i.policy FROM hyperfide.requalification_operations q JOIN hyperfide.assurance_requalification_inputs i ON i.organisation_id=q.organisation_id AND i.run_id=q.run_id AND i.operation_id=q.id WHERE q.organisation_id=$1 AND q.run_id=$2 AND q.id=$3 AND q.custody_id=$4 AND q.custody_generation=$5 AND q.state='SUCCEEDED' AND i.input_manifest=$6::jsonb",
    [...s,v.requalification_id,id,generation,JSON.stringify(inputs.rows[0]?.input_manifest)]);
   if(!fresh.rows[0])fail('QUALIFICATION_REVIEW_DENIED','Fresh current-input requalification operation required');
   freshPolicy=fresh.rows[0].policy;
  }
  const saved=await client.query('SELECT policy FROM hyperfide.assurance_submissions WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3',[...s,id]);
  if(hash(await loadPolicy(ctx,c.task,client))!==hash(freshPolicy??saved.rows[0]?.policy))fail('QUALIFICATION_POLICY_STALE','Accepted review policy changed');
  const clause=(freshPolicy??saved.rows[0]?.policy).clauses.find((row:Data)=>row.id===v.clause_id);
  if(!clause||clause.mode!=='REVIEW'||clause.rubric_digest!==v.rubric_digest||!clause.reviewers.includes(reviewer))
   fail('QUALIFICATION_REVIEW_DENIED','Review judgement cannot replace mandatory executable proof or unapproved reviewer');
  for(const support of v.support_artifact_ids)await client.query('SELECT hyperfide.require_complete_artifact($1,$2,$3)',[...s,support]);
  await client.query("INSERT INTO hyperfide.assurance_judgements(organisation_id,run_id,custody_id,clause_id,reviewer_id,rubric_digest,input_manifest_digest,requalification_id,support,limitations,disposition) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
   [...s,id,v.clause_id,reviewer,v.rubric_digest,hash(inputs.rows[0].input_manifest),v.requalification_id??null,JSON.stringify(v.support_artifact_ids),v.limitations,v.disposition]);
  return {recorded:true,clause_id:v.clause_id,reviewer_id:reviewer,qualification:'NOT_ACCEPTED'};
 });
}
async function accept(ctx:ComponentContext,raw:unknown):Promise<Data>{
 roles(ctx,['COORDINATOR','OPERATOR']);
 const v=fields(raw,['organisation_id','run_id','submission_id','custody_generation','expected_state_version']);
 const s=scope(ctx,v),id=uuid(v.submission_id),generation=decimal(v.custody_generation),version=decimal(v.expected_state_version);
 const preflight=await transaction(ctx,async db=>{
  const coverage=await inspectCoverage(db,{organisation_id:s[0],run_id:s[1]},id);
  if(!coverage.proof_complete||!coverage.receipt_digest)fail('QUALIFICATION_PROOF_INCOMPLETE','Mandatory current command and clause proof required');
  const stored=await db.query('SELECT receipt,receipt_digest,receipt_artifact_id,evidence_id FROM hyperfide.assurance_job_receipts WHERE organisation_id=$1 AND run_id=$2 AND receipt_digest=$3',[...s,coverage.receipt_digest]);
  const inputs=await db.query('SELECT input_manifest FROM hyperfide.assurance_applicability WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3',[...s,id]);
  const reviews=await db.query("SELECT support FROM hyperfide.assurance_judgements WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3 AND disposition='PASS' AND input_manifest_digest=$4",[...s,id,hash(inputs.rows[0].input_manifest)]);
  return {...stored.rows[0],support_artifact_ids:reviews.rows.flatMap((row:Data)=>row.support)};
 });
 if(!preflight.receipt)fail('QUALIFICATION_PROOF_INCOMPLETE','Stored command receipt required');
 await verifyReceiptRecordArtifacts(ctx,s,preflight);
 for(const support of preflight.support_artifact_ids)await artifact(ctx,'artifact.object.inspect',{organisation_id:s[0],run_id:s[1],artifact_id:support});
 return transaction(ctx,async client=>{
  const c=await custodyLock(client,s,id);currentCustody(c,generation,version);
  await executionGate(ctx,client,s,'ADVANCE');
  const policy=await loadPolicy(ctx,c.task,client);
  const saved=await client.query('SELECT policy FROM hyperfide.assurance_submissions WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3',[...s,id]);
  if(hash(policy)!==hash(saved.rows[0]?.policy))fail('QUALIFICATION_INPUT_STALE','Accepted proof obligations changed after submission');
  const coverage=await inspectCoverage(client,{organisation_id:s[0],run_id:s[1]},id);
  if(coverage.receipt_digest!==preflight.receipt_digest)fail('QUALIFICATION_INPUT_STALE','Verified command receipt changed during artifact verification');
  if(!coverage.proof_complete||!coverage.receipt_digest)
   fail('QUALIFICATION_PROOF_INCOMPLETE','One or more mandatory acceptance clauses remain open');
  if(coverage.applicability==='STALE')fail('QUALIFICATION_INPUT_STALE','Relevant input changes require independent requalification');
  const admitted=await client.query("SELECT id FROM hyperfide.evidence WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND attempt_id=$4 AND attempt_generation=$5 AND repository_id=$6 AND source_object_id=$7 AND criteria_digest=$8 AND manifest_digest=$9 AND artifact_id=$10 AND admission_state='ADMITTED' FOR SHARE",
   [...s,preflight.evidence_id,c.source_attempt_id,c.source_generation,c.repository_id,c.source_object_id,c.criteria_digest,coverage.receipt_digest,preflight.receipt_artifact_id]);
  if(admitted.rows.length!==1)fail('QUALIFICATION_PROOF_INCOMPLETE','Exact admitted independent receipt evidence is required');
  await client.query('INSERT INTO hyperfide.submission_evidence(organisation_id,run_id,custody_id,evidence_id,source_attempt_id,source_generation,repository_id,source_object_id,criteria_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',
   [...s,id,preflight.evidence_id,c.source_attempt_id,c.source_generation,c.repository_id,c.source_object_id,c.criteria_digest]);
  await client.query("UPDATE hyperfide.submission_custodies SET qualification_outcome='PASS',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...s,id]);
  await client.query("UPDATE hyperfide.assurance_applicability SET applicability='CURRENT',current_receipt_digest=$4,reasons='[]',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3",[...s,id,coverage.receipt_digest]);
  await client.query("UPDATE hyperfide.tasks SET state='QUALIFIED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...s,c.task_id]);
  return {...coverage,authority:'ACTIVE',qualification_outcome:'PASS',applicability:'CURRENT',qualified:true,
   custody_state_version:(BigInt(version)+1n).toString()};
 });
}
export function createComponent(ctx:ComponentContext):Component{
 return {apiVersion:1,actions:{
  'qualification.coverage.inspect':(raw,requestContext)=>inspect(requestContext,raw),
  'qualification.review.record':(raw,requestContext)=>judgement(requestContext,raw),
  'qualification.accept':(raw,requestContext)=>accept(requestContext,raw)
 }};
}
