import type {Component,ComponentContext} from '../components/registry.js';
import {authorizeReview,canonical,decimal,dependencyDigest,digest,fail,hash,obj,oid,relevantContracts,reviewError,reviewInputCurrent,reviewTaskVersions,reviewAttributionComplete,scope,strings,text,transaction,uuid} from './coverage.js';
import {assertReviewExecutionAllowed,reviewControlMatches,primary,lockReviewDisposition} from './coverage.js';
import type {ReviewControl,ReviewDb,ReviewScope} from './coverage.js';
import {CONTRACT_FACETS} from './contracts.js';

interface Source {repository_id:string;source_object_id:string}
function sources(value:unknown):Source[]{
 if(!Array.isArray(value)||!value.length||value.length>1000)fail('REVIEW_SNAPSHOT_INVALID','Snapshot needs a bounded exact source set');
 const result=value.map(item=>{const v=obj(item,['repository_id','source_object_id']);return {repository_id:uuid(v.repository_id),source_object_id:oid(v.source_object_id)};});
 if(new Set(result.map(row=>row.repository_id+':'+row.source_object_id)).size!==result.length)fail('REVIEW_SNAPSHOT_INVALID','Duplicate source identity');
 return result.sort((a,b)=>a.repository_id.localeCompare(b.repository_id)||a.source_object_id.localeCompare(b.source_object_id));
}
async function snapshot(db:ReviewDb,binding:ReviewScope,candidateDigest:string,value:unknown,context?:ComponentContext):Promise<Record<string,unknown>>{
 const v=obj(value,['source_set','graph_manifest_id','contract_ids','environment_profile_id']);
 const sourceSet=sources(v.source_set),graphId=uuid(v.graph_manifest_id),profileId=uuid(v.environment_profile_id);
 const requestedContracts=strings(v.contract_ids,128).map(uuid);
 if(new Set(requestedContracts).size!==requestedContracts.length)fail('REVIEW_SNAPSHOT_INVALID','Duplicate contract version');
 const contracts=await relevantContracts(db,binding,[...new Set(sourceSet.map(row=>row.repository_id))]);
 const versions=contracts.map(row=>({id:row.id,revision:row.revision,criteria_digest:row.criteria_digest}));
 if(canonical([...requestedContracts].sort())!==canonical(versions.map(row=>row.id).sort()))
  fail('REVIEW_CONTRACTS_INCOMPLETE','Snapshot must name every current relevant producer/consumer contract');
 const run=await db.query<{spec_revision_id:string;source_digest:string;policy_digest:string;authority_epoch:string}>(`SELECT run.spec_revision_id,run.policy_digest,run.authority_epoch,spec.source_digest
 FROM hyperfide.runs run JOIN hyperfide.spec_revisions spec ON spec.organisation_id=run.organisation_id AND spec.id=run.spec_revision_id
 WHERE run.organisation_id=$1 AND run.id=$2`,[binding.organisation_id,binding.run_id]);
 const profile=await db.query<{content_digest:string;manifest:Record<string,unknown>}>('SELECT content_digest,manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=$2',
  [binding.organisation_id,profileId]);
 if(profile.rows.length!==1)fail('REVIEW_ENVIRONMENT_MISSING','Pinned environment profile is unavailable');
 const graph=await db.query<{manifest_digest:string;unresolved:string}>(`SELECT manifest.manifest_digest,
 (SELECT count(*)::text FROM hyperfide.graph_references reference WHERE reference.organisation_id=manifest.organisation_id AND reference.run_id=manifest.run_id AND reference.graph_id=manifest.build_id AND reference.resolution_state<>'RESOLVED') AS unresolved
 FROM hyperfide.graph_manifests manifest WHERE manifest.organisation_id=$1 AND manifest.run_id=$2 AND manifest.id=$3`,
  [binding.organisation_id,binding.run_id,graphId]);
 if(graph.rows.length!==1)fail('REVIEW_GRAPH_MISSING','Pinned published graph manifest is unavailable');
 const graphSources=await db.query<{repository_id:string;source_object_id:string}>(`SELECT DISTINCT file.repository_id,file.source_object_id FROM hyperfide.graph_manifests manifest JOIN hyperfide.graph_files file ON file.organisation_id=manifest.organisation_id AND file.run_id=manifest.run_id AND file.graph_id=manifest.build_id WHERE manifest.organisation_id=$1 AND manifest.run_id=$2 AND manifest.id=$3 ORDER BY file.repository_id,file.source_object_id`,[binding.organisation_id,binding.run_id,graphId]);
 const graphCoversSource=sourceSet.every(source=>graphSources.rows.some(row=>row.repository_id===source.repository_id&&row.source_object_id===source.source_object_id));
 const current=run.rows[0]!;
 let provenance:Record<string,unknown>|null=null;
 if(context){
  try{
   const dependencies=(context as unknown as {dependencies:{require:(id:string,name:string,guard:(value:unknown)=>boolean)=>unknown}}).dependencies;
   const reader=dependencies.require('7.3','graph.snapshot.v1',(value:unknown)=>!!value&&typeof value==='object'&&typeof(value as Record<string,unknown>).loadGraphSnapshot==='function') as {loadGraphSnapshot:(tx:ReviewDb,input:unknown,invocation:unknown)=>Promise<Record<string,unknown>>};
   provenance=await reader.loadGraphSnapshot(db,{...binding,authority_epoch:current.authority_epoch,manifest_id:graphId,expected_sources:sourceSet},(context as unknown as {invocation:unknown}).invocation);
  }catch{provenance=null;}
 }
 const admitted=provenance?.source_coverage;
 const sourceIdentity=provenance?.source_set;
 const projectionDebt=provenance?.unprojected_semantic_edge_count;
 const graphVerified=projectionDebt==='0'&&provenance?.expected_sources_validated===true&&Array.isArray(sourceIdentity)&&sourceIdentity.length===sourceSet.length&&sourceIdentity.every(source=>source&&typeof source==='object'&&(source as Record<string,unknown>).source_kind==='COMMIT'&&(source as Record<string,unknown>).overlay_digest===null)&&Array.isArray(admitted)&&admitted.length===sourceSet.length&&admitted.every(bundle=>bundle&&typeof bundle==='object'&&(bundle as Record<string,unknown>).complete===true&&(()=>{const coverage=(bundle as Record<string,unknown>).coverage as Record<string,unknown>|undefined;return !!coverage&&coverage.complete===true&&coverage.failed_files===0&&coverage.skipped_files===0&&Array.isArray(coverage.limitations)&&coverage.limitations.length===0;})());
 const result={schema_version:2,task_versions:await reviewTaskVersions(db,binding,sourceSet),task_attribution_complete:await reviewAttributionComplete(db,binding,sourceSet),candidate_digest:candidateDigest,source_set:sourceSet,
  spec_revision_id:current.spec_revision_id,spec_digest:current.source_digest,configuration_digest:current.policy_digest,
  dependency_manifest_digest:await dependencyDigest(db,binding),contract_versions:versions,
  graph_manifest_id:graphId,graph_manifest_digest:graph.rows[0]!.manifest_digest,graph_complete:graph.rows[0]!.unresolved==='0'&&graphVerified,graph_source_set:sourceIdentity??graphSources.rows,graph_provenance_verified:graphVerified,graph_unprojected_semantic_edge_count:typeof projectionDebt==='string'?projectionDebt:null,
  environment_profile_id:profileId,environment_digest:profile.rows[0]!.content_digest,
  toolchain_digest:hash(profile.rows[0]!.manifest),toolchain_projection:'ENTIRE_PINNED_ENVIRONMENT_MANIFEST',
  contracts_complete:contracts.every(row=>{
   const facets=row.definition.facets;
   return !!facets&&typeof facets==='object'&&Object.keys(facets).length===CONTRACT_FACETS.length&&CONTRACT_FACETS.every(name=>{const facet=(facets as Record<string,unknown>)[name];return !!facet&&typeof facet==='object'&&(facet as Record<string,unknown>).status==='DEFINED';});
  })};
 if(!await reviewInputCurrent(db,binding,result))fail('REVIEW_SNAPSHOT_INVALID','Source or dependency snapshot is unavailable');
 return result;
}
export async function buildReviewSnapshot(db:ReviewDb,binding:ReviewScope,candidateDigest:string,value:unknown,context?:ComponentContext):Promise<Record<string,unknown>>{return snapshot(db,binding,candidateDigest,value,context);}
export async function bindReviewInputs(context:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','repository_id','source_object_id','policy_digest','candidate_digest','snapshot']);
 const binding=scope(v);authorizeReview(context,binding,['OPERATOR','LEADER','COORDINATOR','FEATURE_MANAGER']);
 const repositoryId=uuid(v.repository_id),sourceId=oid(v.source_object_id),policyDigest=digest(v.policy_digest),candidateDigest=digest(v.candidate_digest);
 return transaction(context,binding,async db=>{
  const policy=await db.query('SELECT 1 FROM hyperfide.review_policies WHERE organisation_id=$1 AND run_id=$2 AND digest=$3 AND active',
   [binding.organisation_id,binding.run_id,policyDigest]);
  if(!policy.rows.length)fail('REVIEW_POLICY_STALE','Watcher policy is not current');
  const input=await snapshot(db,binding,candidateDigest,v.snapshot,context);
  if(!(input.source_set as Source[]).some(source=>source.repository_id===repositoryId&&source.source_object_id===sourceId))
   fail('REVIEW_SOURCE_MISMATCH','Reviewed commit is not part of its exact input set');
  const identity=hash(input);
  const obligations=await db.query<{id:string;generation:string;input_manifest_digest:string|null;candidate_digest:string|null}>(`SELECT id,generation,input_manifest_digest,candidate_digest FROM hyperfide.review_obligations
   WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 AND source_object_id=$4 AND policy_digest=$5 FOR UPDATE`,
   [binding.organisation_id,binding.run_id,repositoryId,sourceId,policyDigest]);
  if(!obligations.rows.length)fail('REVIEW_OBLIGATIONS_MISSING','Discover the commit before binding review inputs');
  const output=[];
  for(const obligation of obligations.rows){
   if(obligation.input_manifest_digest===identity&&obligation.candidate_digest===candidateDigest){
    output.push({obligation_id:obligation.id,generation:obligation.generation,replayed:true});continue;
   }
   const generation=obligation.input_manifest_digest?(BigInt(obligation.generation)+1n).toString():obligation.generation;
   await db.query('UPDATE hyperfide.review_obligations SET generation=$4,input_manifest_digest=$5,candidate_digest=$6,state=$7,current_receipt_id=NULL,lease_generation=lease_generation+1,lease_session_id=NULL,lease_expires_at=NULL,lease_sandbox_id=NULL,lease_boot_generation=NULL WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
    [binding.organisation_id,binding.run_id,obligation.id,generation,identity,candidateDigest,'PENDING']);
   await db.query('INSERT INTO hyperfide.review_obligation_inputs(organisation_id,run_id,obligation_id,generation,input_manifest_digest,candidate_digest,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [binding.organisation_id,binding.run_id,obligation.id,generation,identity,candidateDigest,input]);
   output.push({obligation_id:obligation.id,generation,replayed:false});
  }
  return {input_manifest_digest:identity,candidate_digest:candidateDigest,snapshot:input,obligations:output,qualification_status:'UNRUN'};
 });
}
interface Observation {evidence_id:string;origin_task_id:string;origin_attempt_id:string;contract_id:string|null;failure_fingerprint:string;summary:string;severity:string}
function observations(value:unknown):Observation[]{
 if(!Array.isArray(value)||value.length>1000)fail('REVIEW_RECEIPT_INVALID','Observation inventory exceeds its bound');
 return value.map(item=>{
  const v=obj(item,['evidence_id','origin_task_id','origin_attempt_id','contract_id','failure_fingerprint','summary','severity']);
  if(!['INFO','WARNING','ERROR','CRITICAL'].includes(String(v.severity)))fail('REVIEW_RECEIPT_INVALID','Unknown observation severity');
  return {evidence_id:uuid(v.evidence_id),origin_task_id:uuid(v.origin_task_id),origin_attempt_id:uuid(v.origin_attempt_id),
   contract_id:v.contract_id===null?null:uuid(v.contract_id),failure_fingerprint:digest(v.failure_fingerprint),summary:text(v.summary,2048),severity:String(v.severity)};
 });
}
async function watcherReservation(db:ReviewDb,binding:ReviewScope,actor:string,sandbox:string,boot:string):Promise<void>{
 const found=await db.query(`SELECT session.id FROM hyperfide.agent_sessions session JOIN hyperfide.sandboxes box ON box.organisation_id=session.organisation_id AND box.id=session.sandbox_id AND box.boot_generation=session.sandbox_boot_generation JOIN hyperfide.worker_slots slot ON slot.organisation_id=session.organisation_id AND slot.id=session.slot_id AND slot.sandbox_id=box.id AND slot.boot_generation=box.boot_generation WHERE session.organisation_id=$1 AND session.run_id=$2 AND session.id=$3 AND session.sandbox_id=$4 AND session.sandbox_boot_generation=$5 AND session.role='COMMIT_WATCHER' AND session.state IN ('REGISTERED','RUNNING') AND box.observed_state='RUNNING' AND slot.capacity_kind IN ('REVIEW','TEST') AND slot.state IN ('READY','ALLOCATED') FOR SHARE OF session,box,slot`,[binding.organisation_id,binding.run_id,actor,sandbox,boot]);
 if(!found.rows.length)fail('REVIEW_RESERVATION_REQUIRED','Watcher needs a current independent review slot and boot');
}
// Decision models (domain 20/21 ranking) may rank risk or flag insufficient evidence
// but never certify correctness; such fields cannot ride on a review receipt.
const DECISION_MODEL_FIELDS=['risk_rank','risk_score','rank','confidence','certified','certifies_correctness','decision_model','decision_id','ranking'];
export const REVIEW_CERTIFICATION={certifies_correctness:false,decision_model_role:'ADVISORY_RISK_RANK_ONLY',coverage_authority:'ASSIGNED_INDEPENDENT_WATCHER_RECEIPT'};
function refuseDecisionCertification(value:unknown):void{
 if(value&&typeof value==='object'&&!Array.isArray(value)&&DECISION_MODEL_FIELDS.some(key=>Object.hasOwn(value,key)))
  fail('REVIEW_INPUT_INVALID','Decision-model rank or confidence is advisory and cannot certify review correctness');
}
export async function submitReviewReceipt(context:ComponentContext,value:unknown):Promise<unknown>{
 refuseDecisionCertification(value);
 const v=obj(value,['organisation_id','run_id','request_id','obligation_id','generation','lease_generation','input_manifest_digest','candidate_digest','rubric_digest','outcome','limitations','evidence_ids','observations']);
 const binding=scope(v),trusted=authorizeReview(context,binding,['COMMIT_WATCHER']),actor=uuid(trusted.invocation.principal.actor_id);
 const requestId=uuid(v.request_id),obligationId=uuid(v.obligation_id),generation=decimal(v.generation),
  leaseGeneration=decimal(v.lease_generation),inputDigest=digest(v.input_manifest_digest),candidateDigest=digest(v.candidate_digest),rubric=digest(v.rubric_digest);
 if(!['NO_FINDINGS','FINDINGS','INCONCLUSIVE'].includes(String(v.outcome)))fail('REVIEW_RECEIPT_INVALID','Unknown review outcome');
 const outcome=String(v.outcome),limitations=strings(v.limitations,128),evidenceIds=strings(v.evidence_ids,128).map(uuid),items=observations(v.observations);
 if(!evidenceIds.length)fail('REVIEW_EVIDENCE_REQUIRED','A no-finding receipt still requires real admitted supporting artifacts');
 if((outcome==='FINDINGS')!==Boolean(items.length))fail('REVIEW_RECEIPT_INVALID','Finding outcome and observations disagree');
 if(items.some(item=>!evidenceIds.includes(item.evidence_id)))fail('REVIEW_RECEIPT_INVALID','Every observation must cite this receipt supporting evidence');
 const requestDigest=hash({actor,input:v});
 return transaction(context,binding,async db=>{
  const prior=await db.query<{id:string;request_digest:string}>('SELECT id,request_digest FROM hyperfide.review_receipts WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[binding.organisation_id,binding.run_id,requestId]);
  if(prior.rows[0]&&prior.rows[0].request_digest!==requestDigest)fail('REVIEW_REQUEST_CONFLICT','Review request identity was reused with different content');
  const current=await db.query<{repository_id:string;source_object_id:string;generation:string;input_manifest_digest:string|null;candidate_digest:string|null;reviewer_session_id:string;rubric_digest:string;snapshot:Record<string,unknown>;current_receipt_id:string|null;active:boolean;lease_generation:string;lease_session_id:string|null;lease_current:boolean;lease_sandbox_id:string|null;lease_boot_generation:string|null;lease_expires_at:string|null}>(`SELECT obligation.repository_id,obligation.source_object_id,obligation.generation,obligation.input_manifest_digest,obligation.candidate_digest,
   watcher.reviewer_session_id,watcher.rubric_digest,inputs.snapshot,obligation.current_receipt_id,policy.active,obligation.lease_generation,obligation.lease_session_id,(obligation.lease_expires_at>clock_timestamp()) AS lease_current,obligation.lease_sandbox_id,obligation.lease_boot_generation,obligation.lease_expires_at
   FROM hyperfide.review_obligations obligation
   JOIN hyperfide.review_watchers watcher ON watcher.organisation_id=obligation.organisation_id AND watcher.run_id=obligation.run_id AND watcher.policy_digest=obligation.policy_digest AND watcher.watcher_id=obligation.watcher_id
   JOIN hyperfide.review_policies policy ON policy.organisation_id=obligation.organisation_id AND policy.run_id=obligation.run_id AND policy.digest=obligation.policy_digest
   JOIN hyperfide.review_obligation_inputs inputs ON inputs.organisation_id=obligation.organisation_id AND inputs.run_id=obligation.run_id AND inputs.obligation_id=obligation.id AND inputs.generation=obligation.generation
   WHERE obligation.organisation_id=$1 AND obligation.run_id=$2 AND obligation.id=$3 FOR UPDATE OF obligation`,
   [binding.organisation_id,binding.run_id,obligationId]);
  const obligation=current.rows[0];
  const clock=(await db.query<{now:string}>('SELECT clock_timestamp() AS now')).rows[0]!.now;
  if(obligation)obligation.lease_current=!!obligation.lease_expires_at&&new Date(obligation.lease_expires_at).getTime()>new Date(clock).getTime();
  if(!obligation||!obligation.active||obligation.generation!==generation||obligation.input_manifest_digest!==inputDigest||obligation.candidate_digest!==candidateDigest)
   fail('REVIEW_INPUTS_STALE','Receipt does not match current obligation generation and inputs');
  if(obligation.reviewer_session_id!==actor||obligation.rubric_digest!==rubric)
   fail('REVIEW_INDEPENDENCE_REQUIRED','Only the assigned independent watcher can satisfy this exact rubric');
  if(!await reviewInputCurrent(db,binding,obligation.snapshot))fail('REVIEW_INPUTS_STALE','Current spec, dependency, contract, graph or environment input changed');
  if(prior.rows[0])return {receipt_id:prior.rows[0].id,replayed:true,current:prior.rows[0].id===obligation.current_receipt_id};
  // Duplicate activity is not coverage: a second distinct receipt cannot replace the
  // current one for the same obligation generation and inputs.
  if(obligation.current_receipt_id)fail('REVIEW_DUPLICATE_ACTIVITY','Obligation generation already has a current receipt; duplicate review activity cannot add coverage');
  if(obligation.lease_generation!==leaseGeneration||obligation.lease_session_id!==actor||!obligation.lease_current||obligation.lease_sandbox_id!==trusted.invocation.principal.sandbox_id||obligation.lease_boot_generation!==trusted.invocation.principal.boot_generation)fail('REVIEW_LEASE_STALE','Receipt owner, reservation or boot no longer owns this exact review job lease');
  await watcherReservation(db,binding,actor,obligation.lease_sandbox_id!,obligation.lease_boot_generation!);
  await assertReviewExecutionAllowed(context,db,binding,obligation.snapshot.source_set as Source[],obligation.lease_sandbox_id,'CHECKPOINT');
  const evidence=await db.query<{id:string;attempt_id:string}>(`SELECT evidence.id,evidence.attempt_id FROM hyperfide.evidence evidence JOIN hyperfide.artifacts artifact
   ON artifact.organisation_id=evidence.organisation_id AND artifact.run_id=evidence.run_id AND artifact.id=evidence.artifact_id
   WHERE evidence.organisation_id=$1 AND evidence.run_id=$2 AND evidence.id=ANY($3::uuid[]) AND evidence.repository_id=$4
    AND evidence.source_object_id=$5 AND evidence.admission_state='ADMITTED' AND artifact.status='COMPLETE'`,
   [binding.organisation_id,binding.run_id,evidenceIds,obligation.repository_id,obligation.source_object_id]);
  if(evidence.rows.length!==evidenceIds.length)fail('REVIEW_EVIDENCE_INVALID','Supporting evidence is unavailable, unadmitted or bound to another source');
  const evidenceById=new Map(evidence.rows.map(row=>[row.id,row]));
  for(const item of items){
   if(evidenceById.get(item.evidence_id)?.attempt_id!==item.origin_attempt_id)fail('REVIEW_OBSERVATION_INVALID','Observation origin differs from its supporting evidence');
   const origin=await db.query('SELECT 1 FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND task_id=$4',
    [binding.organisation_id,binding.run_id,item.origin_attempt_id,item.origin_task_id]);
   if(!origin.rows.length)fail('REVIEW_OBSERVATION_INVALID','Observation attempt is not owned by its claimed task');
  }
  const boundedLimitations=[...limitations];
  if(obligation.snapshot.graph_complete!==true)boundedLimitations.push('GRAPH_REFERENCES_INCOMPLETE');
  if(obligation.snapshot.contracts_complete!==true)boundedLimitations.push('CONTRACT_FACETS_UNKNOWN');
  const inserted=await db.query<{id:string}>(`INSERT INTO hyperfide.review_receipts(organisation_id,run_id,request_id,request_digest,obligation_id,generation,reviewer_session_id,rubric_digest,input_manifest_digest,candidate_digest,outcome,limitations,lease_generation)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
   [binding.organisation_id,binding.run_id,requestId,requestDigest,obligationId,generation,actor,rubric,inputDigest,candidateDigest,outcome,JSON.stringify([...new Set(boundedLimitations)]),leaseGeneration]);
  const receiptId=inserted.rows[0]!.id;
  await db.query('INSERT INTO hyperfide.review_receipt_evidence(organisation_id,run_id,receipt_id,evidence_id) SELECT $1,$2,$3,unnest($4::uuid[])',[binding.organisation_id,binding.run_id,receiptId,evidenceIds]);
  const observationIds=[];
  for(const item of items){
   const row=await db.query<{id:string}>(`INSERT INTO hyperfide.review_observations(organisation_id,run_id,review_receipt_id,evidence_id,observer_session_id,origin_task_id,origin_attempt_id,repository_id,source_object_id,contract_id,failure_fingerprint,summary,severity)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [binding.organisation_id,binding.run_id,receiptId,item.evidence_id,actor,item.origin_task_id,item.origin_attempt_id,obligation.repository_id,obligation.source_object_id,item.contract_id,item.failure_fingerprint,item.summary,item.severity]);
   observationIds.push(row.rows[0]!.id);
  }
  const state=outcome!=='INCONCLUSIVE'&&!boundedLimitations.length?'COMPLETE':'PENDING';
  await db.query('UPDATE hyperfide.review_obligations SET current_receipt_id=$4,state=$5,lease_session_id=NULL,lease_sandbox_id=NULL,lease_boot_generation=NULL,lease_expires_at=NULL WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
   [binding.organisation_id,binding.run_id,obligationId,receiptId,state]);
  return {receipt_id:receiptId,observation_ids:observationIds,replayed:false,obligation_state:state,qualification_status:'UNRUN',...REVIEW_CERTIFICATION};
 });
}
export async function claimReviewObligation(context:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','obligation_id','generation','lease_seconds']);
 const binding=scope(v),trusted=authorizeReview(context,binding,['COMMIT_WATCHER']),actor=uuid(trusted.invocation.principal.actor_id);
 const obligationId=uuid(v.obligation_id),generation=decimal(v.generation),seconds=v.lease_seconds;
 if(typeof seconds!=='number'||!Number.isSafeInteger(seconds)||seconds<30||seconds>3600)fail('REVIEW_INPUT_INVALID','Review lease must be 30..3600 seconds');
 const sandboxId=trusted.invocation.principal.sandbox_id,boot=trusted.invocation.principal.boot_generation;
 if(!sandboxId||!boot)fail('REVIEW_RESERVATION_REQUIRED','Watcher must have a live registered sandbox boot');
 return transaction(context,binding,async db=>{
  await watcherReservation(db,binding,actor,sandboxId,boot);
  await db.query(`UPDATE hyperfide.review_obligations SET state='PENDING',lease_generation=lease_generation+1,lease_session_id=NULL,lease_sandbox_id=NULL,lease_boot_generation=NULL,lease_expires_at=NULL WHERE organisation_id=$1 AND run_id=$2 AND lease_session_id=$3 AND state='RUNNING' AND lease_expires_at<=clock_timestamp()`,[binding.organisation_id,binding.run_id,actor]);
  const found=await db.query<{generation:string;reviewer_session_id:string;active:boolean;lease_current:boolean;lease_generation:string;lease_session_id:string|null;input_manifest_digest:string|null;candidate_digest:string|null;snapshot:Record<string,unknown>}>(`SELECT o.generation,w.reviewer_session_id,p.active,o.lease_generation,o.lease_session_id,o.lease_expires_at>clock_timestamp() AS lease_current,o.input_manifest_digest,o.candidate_digest,i.snapshot FROM hyperfide.review_obligations o JOIN hyperfide.review_watchers w USING(organisation_id,run_id,policy_digest,watcher_id) JOIN hyperfide.review_policies p ON p.organisation_id=o.organisation_id AND p.run_id=o.run_id AND p.digest=o.policy_digest LEFT JOIN hyperfide.review_obligation_inputs i ON i.organisation_id=o.organisation_id AND i.run_id=o.run_id AND i.obligation_id=o.id AND i.generation=o.generation WHERE o.organisation_id=$1 AND o.run_id=$2 AND o.id=$3 FOR UPDATE OF o`,[binding.organisation_id,binding.run_id,obligationId]);
  const row=found.rows[0];
  if(!row||!row.active||row.generation!==generation||row.reviewer_session_id!==actor||!row.input_manifest_digest||!row.snapshot)fail('REVIEW_JOB_DENIED','Principal is not assigned this exact current input generation');
  if(!await reviewInputCurrent(db,binding,row.snapshot))fail('REVIEW_INPUTS_STALE','Review input changed before claim');
  await assertReviewExecutionAllowed(context,db,binding,row.snapshot.source_set as Source[],sandboxId,'ADMISSION');
  if(row.lease_current)fail('REVIEW_LEASE_CONFLICT','Review job already has a live reservation');
  const result=await db.query(`UPDATE hyperfide.review_obligations SET lease_generation=lease_generation+1,lease_session_id=$4,lease_sandbox_id=$5,lease_boot_generation=$6,lease_expires_at=clock_timestamp()+$7*interval '1 second',state='RUNNING' WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING id,generation,lease_generation,lease_expires_at,input_manifest_digest,candidate_digest`,[binding.organisation_id,binding.run_id,obligationId,actor,sandboxId,boot,seconds]);
  return {...result.rows[0],snapshot:row.snapshot};
 });
}
export async function reconcileReviewInputs(db:ReviewDb,binding:ReviewScope,afterId:string|null=null,limit=100):Promise<unknown>{
 const rows=await db.query<{id:string;input_manifest_digest:string;snapshot:Record<string,unknown>}>(`SELECT obligation.id,obligation.input_manifest_digest,inputs.snapshot
 FROM hyperfide.review_obligations obligation JOIN hyperfide.review_obligation_inputs inputs ON inputs.organisation_id=obligation.organisation_id AND inputs.run_id=obligation.run_id AND inputs.obligation_id=obligation.id AND inputs.generation=obligation.generation
 WHERE obligation.organisation_id=$1 AND obligation.run_id=$2 AND ($3::uuid IS NULL OR obligation.id>$3) ORDER BY obligation.id LIMIT $4`,
 [binding.organisation_id,binding.run_id,afterId,limit+1]);
 const cache=new Map<string,boolean>(),changed:string[]=[];
 for(const row of rows.rows.slice(0,limit)){
  if(!cache.has(row.input_manifest_digest))cache.set(row.input_manifest_digest,await reviewInputCurrent(db,binding,row.snapshot));
  if(!cache.get(row.input_manifest_digest)){
   await db.query("UPDATE hyperfide.review_obligations SET state='STALE' WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[binding.organisation_id,binding.run_id,row.id]);changed.push(row.id);
  }
 }
 return {checked:Math.min(rows.rows.length,limit),invalidated_obligation_ids:changed,complete:rows.rows.length<=limit,next_cursor:rows.rows.length>limit?rows.rows[limit-1]!.id:null};
}
export function createComponent(_context:ComponentContext):Component{
 const guarded=(fn:(ctx:ComponentContext,input:unknown)=>Promise<unknown>)=>async(input:unknown,ctx:ComponentContext)=>{try{return await fn(ctx,input);}catch(error){throw reviewError(error);}};
 return {apiVersion:1,actions:{
  'review.inputs.bind':guarded(bindReviewInputs),
  'review.obligation.claim':guarded(claimReviewObligation),
  'review.obligation.renew':guarded(renewReviewObligation),
  'review.receipt.submit':guarded(submitReviewReceipt),
  'review.receipt.inspect':guarded(async(ctx,input)=>{
   const v=obj(input,['organisation_id','run_id','receipt_id']),binding=scope(v);
   return transaction(ctx,binding,async db=>{
    const row=await db.query('SELECT * FROM hyperfide.review_receipts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[binding.organisation_id,binding.run_id,uuid(v.receipt_id)]);
    if(row.rows.length!==1)fail('REVIEW_RECEIPT_MISSING','Receipt is unavailable in this run');
    const evidence=await db.query('SELECT evidence_id FROM hyperfide.review_receipt_evidence WHERE organisation_id=$1 AND run_id=$2 AND receipt_id=$3 ORDER BY evidence_id',[binding.organisation_id,binding.run_id,uuid(v.receipt_id)]);
    const observations=await db.query('SELECT id FROM hyperfide.review_observations WHERE organisation_id=$1 AND run_id=$2 AND review_receipt_id=$3 ORDER BY id',[binding.organisation_id,binding.run_id,uuid(v.receipt_id)]);
    return {receipt:row.rows[0],evidence_ids:evidence.rows.map(item=>item.evidence_id),observation_ids:observations.rows.map(item=>item.id),...REVIEW_CERTIFICATION};
   });
  }),
  'review.inputs.reconcile':guarded(async(ctx,input)=>{
   const v=obj(input,['organisation_id','run_id','after_id','limit'],['after_id','limit']),binding=scope(v);
   authorizeReview(ctx,binding,['OPERATOR','LEADER','COORDINATOR','FEATURE_MANAGER']);
   const limit=v.limit??100;if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>500)fail('REVIEW_INPUT_INVALID','Reconciliation bound is invalid');
   return transaction(ctx,binding,db=>reconcileReviewInputs(db,binding,v.after_id?uuid(v.after_id):null,limit));
  })
 }};
}

export async function fenceReviewObligations(db:ReviewDb,binding:ReviewScope,control:ReviewControl):Promise<unknown>{
 await primary(db);await lockReviewDisposition(db,binding,true);
 const rows=await db.query<Record<string,any>>(`SELECT o.*,i.snapshot FROM hyperfide.review_obligations o LEFT JOIN hyperfide.review_obligation_inputs i ON i.organisation_id=o.organisation_id AND i.run_id=o.run_id AND i.obligation_id=o.id AND i.generation=o.generation WHERE o.organisation_id=$1 AND o.run_id=$2 AND o.state='RUNNING' FOR UPDATE OF o`,[binding.organisation_id,binding.run_id]);
 const fenced:Record<string,unknown>[]=[],physical:Record<string,unknown>[]=[];
 for(const row of rows.rows){
  const tasks=row.snapshot?.task_attribution_complete===true&&Array.isArray(row.snapshot?.task_versions)?row.snapshot.task_versions.map((v:Record<string,unknown>)=>uuid(v.task_id)):[];
  if(!await reviewControlMatches(db,binding,control,tasks,row.lease_sandbox_id))continue;
  if(row.lease_session_id)physical.push({kind:'REVIEW',obligation_id:row.id,session_id:row.lease_session_id,sandbox_id:row.lease_sandbox_id,sandbox_boot_generation:row.lease_boot_generation,lease_generation:row.lease_generation,reservation_id:null,operation_id:null});
  const changed=await db.query(`UPDATE hyperfide.review_obligations SET state='PENDING',lease_generation=lease_generation+1,lease_session_id=NULL,lease_sandbox_id=NULL,lease_boot_generation=NULL,lease_expires_at=NULL WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING id,lease_generation`,[binding.organisation_id,binding.run_id,row.id]);
  const fencedRow=changed.rows[0];if(!fencedRow)fail('REVIEW_FENCE_CONFLICT','Locked review authority could not be fenced');fenced.push(fencedRow);
 }
 return {fenced,physical,cleanup_status:'UNKNOWN',reassignment_authorized:false,control_operation_id:control.operation_id,control_generation:control.control_generation};
}

export async function renewReviewObligation(context:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','obligation_id','generation','lease_generation','lease_seconds']);
 const binding=scope(v),trusted=authorizeReview(context,binding,['COMMIT_WATCHER']),actor=uuid(trusted.invocation.principal.actor_id);
 const id=uuid(v.obligation_id),generation=decimal(v.generation),lease=decimal(v.lease_generation),seconds=v.lease_seconds;
 if(typeof seconds!=='number'||!Number.isSafeInteger(seconds)||seconds<30||seconds>3600)fail('REVIEW_INPUT_INVALID','Review lease must be 30..3600 seconds');
 return transaction(context,binding,async db=>{
  const rows=await db.query<Record<string,any>>(`SELECT o.*,i.snapshot,p.active FROM hyperfide.review_obligations o JOIN hyperfide.review_obligation_inputs i ON i.organisation_id=o.organisation_id AND i.run_id=o.run_id AND i.obligation_id=o.id AND i.generation=o.generation JOIN hyperfide.review_policies p ON p.organisation_id=o.organisation_id AND p.run_id=o.run_id AND p.digest=o.policy_digest WHERE o.organisation_id=$1 AND o.run_id=$2 AND o.id=$3 FOR UPDATE OF o`,[binding.organisation_id,binding.run_id,id]);
  const row=rows.rows[0],principal=trusted.invocation.principal;
  if(!row||!row.active||row.state!=='RUNNING'||String(row.generation)!==generation||String(row.lease_generation)!==lease||row.lease_session_id!==actor||row.lease_sandbox_id!==principal.sandbox_id||String(row.lease_boot_generation)!==principal.boot_generation)fail('REVIEW_LEASE_STALE','Only the exact current review job owner may renew');
  if(!await reviewInputCurrent(db,binding,row.snapshot))fail('REVIEW_INPUTS_STALE','Accepted review inputs changed before renewal');
  await watcherReservation(db,binding,actor,row.lease_sandbox_id,row.lease_boot_generation);
  await assertReviewExecutionAllowed(context,db,binding,row.snapshot.source_set,row.lease_sandbox_id,'RENEWAL');
  const updated=await db.query(`UPDATE hyperfide.review_obligations SET lease_expires_at=clock_timestamp()+$6*interval '1 second' WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND generation=$4 AND lease_generation=$5 AND lease_expires_at>clock_timestamp() RETURNING id,generation,lease_generation,lease_expires_at`,[binding.organisation_id,binding.run_id,id,generation,lease,seconds]);
  if(!updated.rows[0])fail('REVIEW_LEASE_STALE','An expired review lease cannot be revived');
  return updated.rows[0];
 });
}
