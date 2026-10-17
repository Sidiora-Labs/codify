import {createHash,randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {authorizeReview,canonical,decimal,digest,fail,hash,obj,oid,primary,reviewError,reviewInputCurrent,lockReviewDisposition,assertReviewExecutionAllowed,reviewControlMatches,scope,text,transaction,uuid} from './coverage.js';
import type {ReviewControl,ReviewDb,ReviewScope} from './coverage.js';
import {buildReviewSnapshot} from './receipts.js';
import {registerReproductionJobInputs} from '../runner/reproduction_jobs.js';
import {recordRepairReproduction,inspectRepairReproduction} from './repair_reproduction.js';

type Data=Record<string,any>;
interface Runner {
 prepare(db:ReviewDb,invocation:unknown,input:unknown):Promise<unknown>;
 execute(permit:unknown,signal:AbortSignal):Promise<unknown>;
}
interface ArtifactStore {invoke(action:string,input:unknown,context:ComponentContext):Promise<unknown>}
function capability<T>(ctx:ComponentContext,component:string,name:string,methods:string[]):T{
 const dependencies=(ctx as unknown as Data).dependencies;
 try{return dependencies.require(component,name,(value:unknown)=>!!value&&typeof value==='object'&&methods.every(method=>typeof(value as Data)[method]==='function')) as T;}
 catch{fail('REPRODUCTION_DEPENDENCY_UNAVAILABLE','Required trusted '+name+' capability is unavailable');}
}
function pairedId(planId:string):string{
 const bytes=createHash('sha256').update('hyperfide-review-repair:'+planId).digest().subarray(0,16);
 bytes[6]=(bytes[6]!&15)|80;bytes[8]=(bytes[8]!&63)|128;
 const value=bytes.toString('hex');return value.slice(0,8)+'-'+value.slice(8,12)+'-'+value.slice(12,16)+'-'+value.slice(16,20)+'-'+value.slice(20);
}
async function loadRegistry(db:ReviewDb,binding:ReviewScope,taskId:string):Promise<Data>{
 const task=await db.query<Data>('SELECT id,spec_generation,spec_revision_id,criteria_digest FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[binding.organisation_id,binding.run_id,taskId]);
 if(!task.rows[0])fail('REPRODUCTION_TASK_MISSING','Reproduction task is not in this run');
 try{
  const registryPath='../spec/obligations.js',registry=await import(registryPath) as Data;
  const loaded=await registry.loadProofObligations(db,{...binding,task_id:taskId,spec_generation:String(task.rows[0].spec_generation),spec_revision_id:task.rows[0].spec_revision_id});
  if(!loaded||!loaded.policy||loaded.policy.criteria_digest!==task.rows[0].criteria_digest||loaded.policy.spec_revision_id!==task.rows[0].spec_revision_id||String(loaded.policy.spec_generation)!==String(task.rows[0].spec_generation)||!Array.isArray(loaded.policy.checks)||loaded.registry_digest!==hash(loaded.policy))fail('REPRODUCTION_REGISTRY_INVALID','Accepted check registry is inconsistent');
  return {...loaded,task:task.rows[0]};
 }catch(error){
  if(error&&typeof error==='object'&&'code'in error&&String(error.code).startsWith('REPRODUCTION_'))throw error;
  fail('REPRODUCTION_REGISTRY_UNAVAILABLE','Actual accepted proof-obligation registry is unavailable');
 }
}
async function custody(db:ReviewDb,binding:ReviewScope,id:string):Promise<Data>{
 const found=await db.query<Data>('SELECT * FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[binding.organisation_id,binding.run_id,id]);
 if(!found.rows[0])fail('REPRODUCTION_CUSTODY_MISSING','Exact recorded source custody is unavailable');
 return found.rows[0];
}
function selectedCheck(registry:Data,id:string):Data{
 const checks=registry.policy.checks.filter((check:Data)=>check.id===id);
 if(checks.length!==1)fail('REPRODUCTION_CHECK_MISSING','Template must identify one actual accepted registered check');
 const check=checks[0];
 if(!Array.isArray(registry.policy.clauses)||!registry.policy.clauses.some((clause:Data)=>clause.mode==='EXECUTABLE'&&Array.isArray(clause.checks)&&clause.checks.includes(id)))fail('REPRODUCTION_CHECK_NOT_REQUIRED','Selected check is not an accepted executable proof obligation');
 if(!Array.isArray(check.argv)||!check.argv.length||check.argv.some((arg:unknown)=>typeof arg!=='string'||arg.includes('\0'))||
 !Number.isSafeInteger(check.timeout_ms)||check.timeout_ms<1||check.timeout_ms>259200000)
 fail('REPRODUCTION_REGISTRY_INVALID','Accepted check execution definition is invalid');
 digest(check.executable_digest);
 return check;
}
// Projection/graph conflicts are retained as immutable, explicitly uncertain
// guidance. They never satisfy coverage and never prove that a candidate builds.
const PROJECTION_SOURCES=['GRAPH','CONTRACT','PROJECTION'],PROJECTION_FACETS=['UNITS','PRECISION','STALENESS','ERRORS','RETRY','IDEMPOTENCY','ORDERING','SIGNATURE','OTHER'];
function projectionGuidance(value:unknown):Data[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>64)fail('REVIEW_INPUT_INVALID','Projection conflicts must be a bounded list');
 const items=value.map(item=>{
  const conflict=obj(item,['source','facet','producer','consumer','detail']);
  if(!PROJECTION_SOURCES.includes(String(conflict.source))||!PROJECTION_FACETS.includes(String(conflict.facet)))fail('REVIEW_INPUT_INVALID','Unknown projection conflict source or facet');
  return {kind:'PROJECTION_CONFLICT',source:conflict.source,facet:conflict.facet,producer:text(conflict.producer,512),consumer:text(conflict.consumer,512),detail:text(conflict.detail),certainty:'UNCERTAIN'};
 });
 if(new Set(items.map(item=>canonical(item))).size!==items.length)fail('REVIEW_INPUT_INVALID','Duplicate projection conflict');
 return items;
}
function uncertainGuidance(rows:Data[]):Data[]{
 const retained=rows.find(row=>Array.isArray(row.snapshot?.guidance))?.snapshot.guidance??[];
 const inferred=rows.some(row=>row.snapshot&&row.snapshot.graph_complete!==true)?[{kind:'GRAPH_INFERENCE',source:'GRAPH',facet:'OTHER',detail:'Graph references are inferred or incomplete for this reproduction input',certainty:'UNCERTAIN'}]:[];
 return [...retained,...inferred].map((item:Data)=>({...item,certainty:'UNCERTAIN',proof:false,satisfies_coverage:false,evidence_ids:[]}));
}
export async function planReproduction(ctx:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','request_id','candidate_digest','candidate_input_manifest_digest','template_id','qualification_scope','original','repaired','projection_conflicts'],['projection_conflicts']);
 const binding=scope(v);authorizeReview(ctx,binding,['OPERATOR','LEADER','COORDINATOR','FEATURE_MANAGER']);
 const requestId=uuid(v.request_id),candidate=digest(v.candidate_digest),candidateInput=digest(v.candidate_input_manifest_digest),template=text(v.template_id,128),guidance=projectionGuidance(v.projection_conflicts);
 if(!['COMPONENT','CONTRACT','SYSTEM'].includes(String(v.qualification_scope)))fail('REPRODUCTION_INPUT_INVALID','Unknown qualification scope');
 const original=obj(v.original,['custody_id','snapshot']),repaired=obj(v.repaired,['custody_id','snapshot']);
 const originalId=uuid(original.custody_id),repairedId=uuid(repaired.custody_id),requestDigest=hash(v);
 return transaction(ctx,binding,async db=>{
  const old=await db.query<Data>('SELECT id,request_digest FROM hyperfide.review_reproduction_jobs WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[binding.organisation_id,binding.run_id,requestId]);
  if(old.rows[0]){
   if(old.rows[0].request_digest!==requestDigest)fail('REPRODUCTION_REQUEST_CONFLICT','Stable request identity already has different reproduction inputs');
   return {plan_id:old.rows[0].id,job_ids:[old.rows[0].id,pairedId(old.rows[0].id)],replayed:true,status:'UNRUN'};
  }
  const before=await custody(db,binding,originalId),after=await custody(db,binding,repairedId);
  const registry=await loadRegistry(db,binding,after.task_id),originRegistry=await loadRegistry(db,binding,before.task_id),check=selectedCheck(registry,template),originCheck=selectedCheck(originRegistry,template);
  if(canonical(originCheck)!==canonical(check))fail('REPRODUCTION_CHECK_MISMATCH','Original and repair registries must name the same exact accepted executable definition');
  if(before.criteria_digest!==originRegistry.task.criteria_digest||after.criteria_digest!==registry.task.criteria_digest)fail('REPRODUCTION_CRITERIA_STALE','Recorded source criteria differ from their actual accepted task registries');
  const planId=randomUUID(),repairId=pairedId(planId),jobIds=[planId,repairId],snapshots=[],contexts:Data[]=[];
  for(const [index,input] of [original,repaired].entries()){
   const source=index===0?before:after;
   const current=await buildReviewSnapshot(db,binding,candidate,input.snapshot,ctx);
   contexts.push(current);
   if(index===1){
    if(hash(current)!==candidateInput)fail('REPRODUCTION_INPUT_MISMATCH','Repaired execution inputs differ from the exact server-bound candidate review snapshot');
    const admitted=await db.query<Data>(`SELECT 1 FROM hyperfide.review_obligation_inputs input JOIN hyperfide.review_obligations obligation ON obligation.organisation_id=input.organisation_id AND obligation.run_id=input.run_id AND obligation.id=input.obligation_id AND obligation.generation=input.generation JOIN hyperfide.review_policies policy ON policy.organisation_id=obligation.organisation_id AND policy.run_id=obligation.run_id AND policy.digest=obligation.policy_digest AND policy.active WHERE input.organisation_id=$1 AND input.run_id=$2 AND input.input_manifest_digest=$3 AND input.candidate_digest=$4 AND obligation.repository_id=$5 AND obligation.source_object_id=$6 LIMIT 1`,[binding.organisation_id,binding.run_id,candidateInput,candidate,source.repository_id,source.source_object_id]);
    if(!admitted.rows.length)fail('REPRODUCTION_INPUT_UNBOUND','Exact repaired candidate inputs must be server-bound to current watcher obligations');
   }
   const discovered=await db.query<Data>('SELECT tree_object_id FROM hyperfide.review_commits WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 AND source_object_id=$4',[binding.organisation_id,binding.run_id,source.repository_id,source.source_object_id]);
   if(!discovered.rows[0])fail('REPRODUCTION_DISCOVERY_REQUIRED','Actual Git commit/tree discovery must precede a reproduction plan');
   if(!(current.source_set as Data[]).some(item=>item.repository_id===source.repository_id&&item.source_object_id===source.source_object_id))fail('REPRODUCTION_SOURCE_MISMATCH','Execution snapshot omits its exact custody commit');
   const snapshot:Data={...current,plan_id:planId,variant:index===0?'ORIGINAL':'REPAIRED',candidate_input_manifest_digest:candidateInput,
    task_id:after.task_id,source_task_id:source.task_id,origin_task_id:before.task_id,origin_registry_digest:originRegistry.registry_digest,source_criteria_digest:source.criteria_digest,custody_id:source.id,custody_generation:String(source.custody_generation),attempt_id:source.source_attempt_id,attempt_generation:String(source.source_generation),
    repository_id:source.repository_id,source_object_id:source.source_object_id,criteria_digest:registry.task.criteria_digest,
    registry_digest:registry.registry_digest,source_manifest_digest:source.source_manifest_digest,source_tree_id:discovered.rows[0].tree_object_id,check,contract_ids:(current.contract_versions as Data[]).map(row=>row.id),guidance};
   snapshot.execution_inputs={source:{source_manifest_digest:source.source_manifest_digest,source_set:current.source_set},dependency:{manifest_digest:current.dependency_manifest_digest},toolchain:{environment_profile_id:current.environment_profile_id,digest:current.toolchain_digest},configuration:{digest:current.configuration_digest},graph:{manifest_id:current.graph_manifest_id,digest:current.graph_manifest_digest,source_set:current.graph_source_set},contract:{versions:current.contract_versions}};
   if(!Array.isArray(check.input_keys)||!check.input_keys.length||check.input_keys.some((key:unknown)=>typeof key!=='string'||!Object.hasOwn(snapshot.execution_inputs,key)))fail('REPRODUCTION_REGISTRY_INVALID','Registered check declares an unknown or unbound execution input');
   const inputDigest=hash(snapshot);
   await db.query('INSERT INTO hyperfide.review_reproduction_jobs(organisation_id,run_id,id,request_id,request_digest,candidate_digest,input_manifest_digest,snapshot,template_id,qualification_scope) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [binding.organisation_id,binding.run_id,jobIds[index],index===0?requestId:repairId,requestDigest,candidate,inputDigest,snapshot,template,v.qualification_scope]);
   snapshots.push({job_id:jobIds[index],variant:snapshot.variant,input_manifest_digest:inputDigest,source_set:snapshot.source_set});
  }
  for(const field of ['spec_revision_id','spec_digest','configuration_digest','dependency_manifest_digest','contract_versions','environment_profile_id','environment_digest','toolchain_digest'])if(canonical(contexts[0]![field])!==canonical(contexts[1]![field]))fail('REPRODUCTION_CONTEXT_MISMATCH','Original and repaired checks must share the same accepted criterion and execution context');
  return {plan_id:planId,candidate_digest:candidate,candidate_input_manifest_digest:candidateInput,jobs:snapshots,status:'UNRUN',execution_plane:'REMOTE',guidance:uncertainGuidance([{snapshot:{guidance,graph_complete:contexts[1]!.graph_complete}}]),replayed:false};
 });
}
async function lockJob(db:ReviewDb,binding:ReviewScope,id:string):Promise<Data>{
 const found=await db.query<Data>('SELECT *,lease_expires_at>clock_timestamp() AS lease_current FROM hyperfide.review_reproduction_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[binding.organisation_id,binding.run_id,id]);
 if(!found.rows[0])fail('REPRODUCTION_JOB_MISSING','Reproduction job is not in this run');
 const now=await db.query<Data>('SELECT clock_timestamp() AS now');found.rows[0].lease_current=!!found.rows[0].lease_expires_at&&new Date(found.rows[0].lease_expires_at).getTime()>new Date(now.rows[0]!.now).getTime();return found.rows[0];
}
async function assertCausalRepairCustody(db:ReviewDb,binding:ReviewScope,causalId:string,record:Data):Promise<void>{
 const found=await db.query<Data>('SELECT snapshot FROM hyperfide.review_reproduction_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[binding.organisation_id,binding.run_id,pairedId(causalId)]);
 const snapshot=found.rows[0]?.snapshot;
 if(!snapshot||snapshot.variant!=='REPAIRED'||snapshot.plan_id!==causalId||snapshot.plan_kind==='CURRENT_SOURCE'||snapshot.custody_id!==record.id||snapshot.custody_generation!==String(record.custody_generation)||snapshot.task_id!==record.task_id||snapshot.attempt_id!==record.source_attempt_id||snapshot.attempt_generation!==String(record.source_generation)||snapshot.source_object_id!==record.source_object_id||snapshot.source_manifest_digest!==record.source_manifest_digest||snapshot.source_criteria_digest!==record.criteria_digest)
  fail('REPRODUCTION_CAUSAL_CUSTODY_MISMATCH','Fresh current-source execution must preserve the exact historical repair custody, task and attempt; no accepted supersession authority exists');
}
async function currentJob(db:ReviewDb,binding:ReviewScope,job:Data):Promise<void>{
 if(hash(job.snapshot)!==job.input_manifest_digest||!await reviewInputCurrent(db,binding,job.snapshot))fail('REPRODUCTION_INPUTS_STALE','Immutable reproduction source and current spec/dependency/environment differ');
 const registry=await loadRegistry(db,binding,job.snapshot.task_id);
 if(job.snapshot.plan_kind==='CURRENT_SOURCE'){
  const record=await custody(db,binding,job.snapshot.custody_id),source=await integratedSource(db,binding,record,registry,job.snapshot.publication_operation_id,job.candidate_digest);
  await assertCausalRepairCustody(db,binding,job.snapshot.causal_plan_id,record);
  const causal=await inspectReproduction(db,binding,job.snapshot.causal_plan_id) as Data;
  if(causal.original?.job_id!==job.snapshot.historical_original_job_id||causal.original?.receipt_id!==job.snapshot.historical_original_receipt_id||causal.original?.outcome!=='FAIL'||causal.original?.check_definition_digest!==hash(job.snapshot.check))fail('REPRODUCTION_CAUSAL_PROOF_STALE','Exact original failing proof is no longer available');
  for(const key of ['source_object_id','source_manifest_digest','qualification_receipt_digest','git_provenance_manifest_digest','integration_input_manifest_digest'])if(source[key]!==job.snapshot[key])fail('REPRODUCTION_PUBLICATION_STALE','Current integrated proof source changed');
  if(source.tree!==job.snapshot.source_tree_id)fail('REPRODUCTION_PUBLICATION_STALE','Current integrated tree changed');
 }else{
  const origin=await loadRegistry(db,binding,job.snapshot.origin_task_id);
  if(origin.registry_digest!==job.snapshot.origin_registry_digest)fail('REPRODUCTION_REGISTRY_STALE','Original accepted failure criterion changed');
 }
 if(registry.registry_digest!==job.snapshot.registry_digest||canonical(selectedCheck(registry,job.template_id))!==canonical(job.snapshot.check))fail('REPRODUCTION_REGISTRY_STALE','Accepted registered executable or criterion changed');
}
export async function assignReproduction(ctx:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','job_id','worker_session_id','reservation_id','lease_seconds']);
 const binding=scope(v);authorizeReview(ctx,binding,['OPERATOR','LEADER','COORDINATOR','FEATURE_MANAGER']);
 const id=uuid(v.job_id),worker=uuid(v.worker_session_id),reservation=uuid(v.reservation_id),seconds=v.lease_seconds;
 if(typeof seconds!=='number'||!Number.isSafeInteger(seconds)||seconds<30||seconds>3600)fail('REPRODUCTION_INPUT_INVALID','Lease must be 30..3600 seconds');
 return transaction(ctx,binding,async db=>{
  const job=await lockJob(db,binding,id);await currentJob(db,binding,job);
  await assertReviewExecutionAllowed(ctx,db,binding,job.snapshot.source_set,job.sandbox_id??null,'ADMISSION',[job.snapshot.task_id]);
  if(!['PENDING','LEASED'].includes(job.state)||job.lease_current)fail('REPRODUCTION_ASSIGNMENT_CONFLICT','Job is terminal or already has a current lease');
  const found=await db.query<Data>(`SELECT session.id,session.slot_id,session.sandbox_id,session.sandbox_boot_generation FROM hyperfide.agent_sessions session JOIN hyperfide.sandboxes box ON box.organisation_id=session.organisation_id AND box.id=session.sandbox_id AND box.boot_generation=session.sandbox_boot_generation JOIN hyperfide.worker_slots slot ON slot.organisation_id=session.organisation_id AND slot.id=session.slot_id AND slot.sandbox_id=box.id AND slot.boot_generation=box.boot_generation WHERE session.organisation_id=$1 AND session.run_id=$2 AND session.id=$3 AND session.role='VERIFIER' AND session.state IN ('REGISTERED','RUNNING') AND box.observed_state='RUNNING' AND slot.capacity_kind='TEST' AND slot.state IN ('READY','ALLOCATED') FOR SHARE OF session,box,slot`,[binding.organisation_id,binding.run_id,worker]);
  const owner=found.rows[0];if(!owner)fail('REPRODUCTION_RESERVATION_INVALID','Actual independent remote TEST session and current boot are required');
  const source=await db.query<Data>('SELECT sandbox_id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[binding.organisation_id,binding.run_id,job.snapshot.attempt_id]);
  if(source.rows[0]?.sandbox_id===owner.sandbox_id)fail('REPRODUCTION_NOT_INDEPENDENT','The coding sandbox cannot verify its own source');
  const resources=capability<Data>(ctx,'5.1','scheduler.allocations.v1',['assertJobReservation','readJobAllocation']);
  await resources.assertJobReservation(db,{...binding,task_id:job.snapshot.task_id,job_kind:'TEST',reservation_id:reservation});
  const allocation=await resources.readJobAllocation(db,{...binding,reservation_id:reservation});
  if(!allocation||allocation.assignee_session_id!==worker||allocation.slot_id!==owner.slot_id||allocation.sandbox_id!==owner.sandbox_id||String(allocation.sandbox_boot_generation)!==String(owner.sandbox_boot_generation))fail('REPRODUCTION_RESERVATION_INVALID','Actual allocated TEST vector does not belong to the exact assigned session and boot');
  const updated=await db.query(`UPDATE hyperfide.review_reproduction_jobs SET state='LEASED',worker_session_id=$4,sandbox_id=$5,sandbox_boot_generation=$6,reservation_id=$8,slot_id=$9,allocation_generation=$10,allocation_id=$11,lease_generation=lease_generation+1,lease_expires_at=clock_timestamp()+$7*interval '1 second' WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING id,lease_generation,lease_expires_at`,[binding.organisation_id,binding.run_id,id,worker,owner.sandbox_id,owner.sandbox_boot_generation,seconds,reservation,owner.slot_id,decimal(allocation.generation),uuid(allocation.allocation_id)]);
  return {...updated.rows[0],execution_plane:'REMOTE',status:'UNRUN'};
 });
}
function ownerJob(ctx:ComponentContext,binding:ReviewScope,job:Data,generation:string):void{
 const trusted=authorizeReview(ctx,binding,['VERIFIER']),owner=trusted.invocation.principal;
 if(!['LEASED','RUNNING','OUTCOME_UNKNOWN'].includes(job.state)||!job.lease_current||String(job.lease_generation)!==generation||job.worker_session_id!==owner.actor_id||job.sandbox_id!==owner.sandbox_id||String(job.sandbox_boot_generation)!==owner.boot_generation)
 fail('REPRODUCTION_LEASE_STALE','Exact assigned remote owner, current lease and boot must match this job');
}
function bytesDigest(bytes:Buffer):string{return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}
async function upload(ctx:ComponentContext,binding:ReviewScope,bytes:Buffer):Promise<Data>{
 if(bytes.length>32*1024*1024)fail('REPRODUCTION_OUTPUT_INCOMPLETE','Complete output exceeds the bounded artifact admission limit');
 const store=capability<ArtifactStore>(ctx,'15.2','artifact.store.v1',['invoke']),common={...binding,retention_class:'RUN',retention_until:null,retention_hold:false},chunks:Data[]=[];
 for(let offset=0;offset<bytes.length||offset===0;offset+=256*1024){
  const part=bytes.subarray(offset,Math.min(offset+256*1024,bytes.length));
  const result=await store.invoke('artifact.object.put',{...common,digest:bytesDigest(part),size_bytes:String(part.length),data_base64:part.toString('base64')},ctx) as Data;
  if(result?.outcome!=='SUCCEEDED'||result?.availability!=='VERIFIED'||result?.artifact?.status!=='COMPLETE'||!result.receipt||result.artifact.digest!==bytesDigest(part)||String(result.artifact.size_bytes)!==String(part.length))fail('REPRODUCTION_ARTIFACT_UNAVAILABLE','Complete verified output chunk was not persisted');
  chunks.push({sequence:chunks.length,artifact_id:uuid(result.artifact.artifact_id),digest:bytesDigest(part),size_bytes:String(part.length),offset_bytes:String(offset)});
  if(bytes.length===0)break;
 }
 if(chunks.length===1)return {kind:'OBJECT',artifact_id:chunks[0]!.artifact_id,digest:bytesDigest(bytes),content_digest:bytesDigest(bytes),size_bytes:String(bytes.length),manifest_size_bytes:String(bytes.length)};
 const result=await store.invoke('artifact.manifest.commit',{...common,expected_chunks:chunks.length,total_size_bytes:String(bytes.length),content_digest:bytesDigest(bytes),complete:true,truncated:false,missing_ranges:[],chunks},ctx) as Data;
 if(result?.outcome!=='SUCCEEDED'||result?.availability!=='VERIFIED'||result?.artifact?.status!=='COMPLETE'||!result.receipt||result.content_digest!==bytesDigest(bytes))fail('REPRODUCTION_ARTIFACT_UNAVAILABLE','Complete output manifest was not persisted');
 const id=uuid(result.artifact.artifact_id),observed=await store.invoke('artifact.manifest.read',{...binding,artifact_id:id},ctx) as Data;
 if(observed?.outcome!=='SUCCEEDED'||observed?.availability!=='VERIFIED'||observed?.artifact?.status!=='COMPLETE'||!observed.receipt||observed.artifact.artifact_id!==id||observed.artifact.digest!==result.artifact.digest||observed.manifest?.content_digest!==bytesDigest(bytes)||observed.manifest?.total_size_bytes!==String(bytes.length)||observed.manifest?.complete!==true||observed.manifest?.truncated!==false||observed.manifest?.chunks?.length!==chunks.length)fail('REPRODUCTION_ARTIFACT_UNAVAILABLE','Exact complete logical output could not be independently read through its manifest');
 return {kind:'CHUNK_MANIFEST',artifact_id:id,digest:digest(observed.artifact.digest),content_digest:bytesDigest(bytes),size_bytes:String(bytes.length),manifest_size_bytes:String(observed.artifact.size_bytes),chunk_count:chunks.length};
}
async function artifactRefCurrent(db:ReviewDb,binding:ReviewScope,ref:Data):Promise<boolean>{
 if(!ref||!['OBJECT','CHUNK_MANIFEST'].includes(ref.kind)||typeof ref.artifact_id!=='string'||typeof ref.digest!=='string'||typeof ref.content_digest!=='string'||typeof ref.size_bytes!=='string'||typeof ref.manifest_size_bytes!=='string'||!(/^(0|[1-9][0-9]*)$/).test(ref.size_bytes)||!(/^(0|[1-9][0-9]*)$/).test(ref.manifest_size_bytes))return false;
 const rows=await db.query<Data>(`WITH RECURSIVE closure(id) AS (SELECT $3::uuid UNION SELECT edge.child_artifact_id FROM hyperfide.artifact_dependencies edge JOIN closure parent ON parent.id=edge.parent_artifact_id WHERE edge.organisation_id=$1 AND edge.run_id=$2) SELECT artifact.id,artifact.status,artifact.digest,artifact.size_bytes::text FROM hyperfide.artifacts artifact WHERE artifact.organisation_id=$1 AND artifact.run_id=$2 AND artifact.id IN (SELECT id FROM closure) ORDER BY artifact.id FOR SHARE OF artifact`,[binding.organisation_id,binding.run_id,ref.artifact_id]);
 const parent=rows.rows.find(row=>row.id===ref.artifact_id);
 if(!parent||parent.status!=='COMPLETE'||parent.digest!==ref.digest||parent.size_bytes!==ref.manifest_size_bytes||rows.rows.length>1025||rows.rows.some(row=>row.status!=='COMPLETE'))return false;
 if(ref.kind==='OBJECT')return rows.rows.length===1&&ref.digest===ref.content_digest&&ref.size_bytes===ref.manifest_size_bytes;
 const edges=await db.query<Data>('SELECT count(*)::text AS count FROM hyperfide.artifact_dependencies WHERE organisation_id=$1 AND run_id=$2 AND parent_artifact_id=$3',[binding.organisation_id,binding.run_id,ref.artifact_id]);
 return rows.rows.length>1&&Number.isSafeInteger(ref.chunk_count)&&ref.chunk_count>1&&edges.rows[0]?.count===String(ref.chunk_count);
}
function captured(value:unknown):Buffer{
 if(!value||typeof value!=='object')fail('REPRODUCTION_RECEIPT_INCOMPLETE','Complete captured bytes are required');
 const item=value as Data;
 if(!(item.bytes instanceof Uint8Array)||item.complete!==true)fail('REPRODUCTION_RECEIPT_INCOMPLETE','Captured output is unavailable or incomplete');
 const bytes=Buffer.from(item.bytes);
 if(item.digest!==bytesDigest(bytes)||item.size_bytes!==String(bytes.length))fail('REPRODUCTION_RECEIPT_INCOMPLETE','Captured output bytes differ from their actual digest and size');
 return bytes;
}
export async function renewReproduction(ctx:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','job_id','lease_generation']),binding=scope(v),id=uuid(v.job_id),generation=decimal(v.lease_generation);
 authorizeReview(ctx,binding,['VERIFIER']);
 return transaction(ctx,binding,async db=>{
  const job=await lockJob(db,binding,id);ownerJob(ctx,binding,job,generation);await currentJob(db,binding,job);
  await assertReviewExecutionAllowed(ctx,db,binding,job.snapshot.source_set,job.sandbox_id,'CHECKPOINT',[job.snapshot.task_id]);
  const resources=capability<Data>(ctx,'5.1','scheduler.allocations.v1',['assertJobReservation','readJobAllocation']);
  const allocation=await resources.readJobAllocation(db,{...binding,reservation_id:job.reservation_id});
  if(!allocation||allocation.allocation_id!==job.allocation_id||allocation.assignee_session_id!==job.worker_session_id||allocation.slot_id!==job.slot_id||String(allocation.generation)!==String(job.allocation_generation))fail('REPRODUCTION_LEASE_STALE','Current allocated reservation no longer belongs to this exact job owner');
  // Renew the actual capacity vector in this same primary transaction so a
  // long registered check cannot outlive its underlying reservation heartbeat.
  const renewal=capability<Data>(ctx,'5.1','scheduler.allocations.v1',['renewJobAllocation']);
  const renewed=await renewal.renewJobAllocation(db,{...binding,reservation_id:job.reservation_id,allocation_id:job.allocation_id,allocation_generation:String(job.allocation_generation),assignee_session_id:job.worker_session_id,lease_ms:120000});
  if(!renewed||renewed.allocation_id!==job.allocation_id||String(renewed.generation)!==String(job.allocation_generation)||typeof renewed.expires_at!=='string'||!Number.isFinite(Date.parse(renewed.expires_at)))fail('REPRODUCTION_LEASE_STALE','Capacity renewal did not retain the exact current allocation');
  const result=await db.query(`UPDATE hyperfide.review_reproduction_jobs SET lease_expires_at=$4::timestamptz WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING lease_generation,lease_expires_at`,[binding.organisation_id,binding.run_id,id,renewed.expires_at]);
  if(!result.rows[0])fail('REPRODUCTION_LEASE_STALE','Current reproduction lease disappeared during renewal');
  return result.rows[0];
 });
}
export interface ReproductionJobInputRequest {
 job_id:string;lease_generation:string;reservation_id:string;input_manifest_digest:string;
}
export interface ReproductionExpectedInputs {
 authority:'EXPECTED_AUTHORITY';namespace:'REPRODUCTION';organisation_id:string;run_id:string;
 job_id:string;lease_generation:string;reservation_id:string;input_manifest_digest:string;
 input_packet_digest:string;input_manifest:Record<string,unknown>;execution_inputs:Record<string,unknown>;
 task_id:string;worker_session_id:string;sandbox_id:string;sandbox_boot_generation:string;slot_id:string;allocation_id:string;allocation_generation:string;
 recorded_runner_session_id:string|null;recorded_runner_boot_id:string|null;recorded_runner_slot_generation:string|null;
 repository_id:string;source_manifest_digest:string;source_object_id:string;source_tree_id:string;
 profile_id:string;profile_digest:string;environment_digest:string;toolchain_digest:string;
 registry_digest:string;criteria_digest:string;check:Record<string,unknown>;
 custody_id:string;custody_generation:string;source_attempt_id:string;source_attempt_generation:string;
 source_origin:'SUBMITTED_RESULT'|'INTEGRATED_PUBLICATION';publication_operation_id:string|null;
}
/** Expected authority only. The12 adapter must independently resolve retained11
 * preparation receipts and measured08 runtime facts; these semantic role pins
 * must never be returned as VERIFIED measurements by themselves.
 */
export async function readReproductionJobInputs(tx:PrimaryTransaction,invocation:InvocationContext,request:ReproductionJobInputRequest):Promise<ReproductionExpectedInputs>{
 assertPrimaryTransaction(tx);assertInvocation(invocation);
 const p=invocation.principal,binding={organisation_id:uuid(p.organisation_id),run_id:uuid(p.run_id)};
 await lockReviewDisposition(tx,binding);await invocation.guard(tx);await primary(tx);
 const v=obj(request,['job_id','lease_generation','reservation_id','input_manifest_digest']);
 const id=uuid(v.job_id),generation=decimal(v.lease_generation),reservation=uuid(v.reservation_id),inputDigest=digest(v.input_manifest_digest);
 const found=await tx.query<Data>('SELECT *,lease_expires_at>clock_timestamp() AS lease_current FROM hyperfide.review_reproduction_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[binding.organisation_id,binding.run_id,id]);
 const job=found.rows[0];
 if(!job||p.role!=='VERIFIER'||!['LEASED','RUNNING','OUTCOME_UNKNOWN'].includes(job.state)||job.lease_current!==true||String(job.lease_generation)!==generation||job.worker_session_id!==p.actor_id||job.sandbox_id!==p.sandbox_id||String(job.sandbox_boot_generation)!==p.boot_generation||job.reservation_id!==reservation||job.input_manifest_digest!==inputDigest)
  fail('REPRODUCTION_INPUT_AUTHORITY_DENIED','Only the exact current reproduction verifier, lease, reservation and immutable packet may resolve expected inputs');
 await currentJob(tx,binding,job);
 const snapshot=job.snapshot,roles:Data={};
 for(const key of ['dependency','toolchain','configuration','graph','contract']){
  if(!Object.hasOwn(snapshot.execution_inputs??{},key))fail('REPRODUCTION_INPUTS_STALE','A registered expected execution role is missing');
  roles[key]=snapshot.execution_inputs[key];
 }
 return {authority:'EXPECTED_AUTHORITY',namespace:'REPRODUCTION',organisation_id:binding.organisation_id,run_id:binding.run_id,job_id:id,lease_generation:generation,reservation_id:reservation,input_manifest_digest:inputDigest,
  input_packet_digest:hash(snapshot.execution_inputs),input_manifest:roles,execution_inputs:snapshot.execution_inputs,
  task_id:snapshot.task_id,worker_session_id:job.worker_session_id,sandbox_id:job.sandbox_id,sandbox_boot_generation:String(job.sandbox_boot_generation),slot_id:job.slot_id,allocation_id:uuid(job.allocation_id),allocation_generation:String(job.allocation_generation),
  recorded_runner_session_id:job.runner_session_id??null,recorded_runner_boot_id:job.runner_boot_id??null,recorded_runner_slot_generation:job.runner_slot_generation?decimal(job.runner_slot_generation):null,
  repository_id:snapshot.repository_id,source_manifest_digest:snapshot.source_manifest_digest,source_object_id:snapshot.source_object_id,source_tree_id:snapshot.source_tree_id,
  profile_id:snapshot.environment_profile_id,profile_digest:snapshot.environment_digest,environment_digest:snapshot.environment_digest,toolchain_digest:snapshot.toolchain_digest,
  registry_digest:snapshot.registry_digest,criteria_digest:snapshot.criteria_digest,check:snapshot.check,
  custody_id:uuid(snapshot.custody_id),custody_generation:decimal(snapshot.custody_generation),source_attempt_id:snapshot.attempt_id,source_attempt_generation:snapshot.attempt_generation,
  source_origin:snapshot.source_origin??'SUBMITTED_RESULT',publication_operation_id:snapshot.publication_operation_id??null};
}
async function measuredReproductionInputs(ctx:ComponentContext,db:ReviewDb,binding:ReviewScope,job:Data):Promise<Data>{
 // The registered REPRODUCTION adapter joins this exact semantic job to its
 // retained preparation proof before12 validates current physical facts. Missing
 // or mismatched preparation remains unavailable; echoed labels are not proof.
 const reader=capability<Data>(ctx,'12.1','qualification.environment.v1',['verify']);
 const observed=await reader.verify(db,(ctx as Data).invocation,{job_namespace:'REPRODUCTION',job_id:job.id,lease_generation:String(job.lease_generation),reservation_id:job.reservation_id,input_manifest_digest:job.input_manifest_digest,environment_digest:job.snapshot.environment_digest});
 const validation=observed?.input_validation,roles:Data={};
 for(const key of ['dependency','toolchain','configuration','graph','contract'])roles[key]=job.snapshot.execution_inputs?.[key];
 if(!validation||validation.status!=='VERIFIED'||validation.namespace!=='REPRODUCTION'||validation.job_id!==job.id||validation.lease_generation!==String(job.lease_generation)||validation.input_manifest_digest!==job.input_manifest_digest||validation.input_packet_digest!==hash(job.snapshot.execution_inputs)||canonical(validation.input_manifest)!==canonical(roles)||typeof validation.receipt_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(validation.receipt_digest)||observed.runner_session_id!==job.runner_session_id||observed.sandbox_id!==job.sandbox_id||String(observed.boot_generation)!==String(job.sandbox_boot_generation)||observed.slot_id!==job.slot_id||observed.source_object_id!==job.snapshot.source_object_id||observed.source_tree_id!==job.snapshot.source_tree_id||observed.source_manifest_digest!==job.snapshot.source_manifest_digest)
  fail('REPRODUCTION_INPUT_MEASUREMENTS_UNAVAILABLE','Independent reproduction namespace and measured dependency/toolchain/configuration/graph/contract input bindings are required before dispatch and admission');
 return validation;
}
export async function executeReproduction(ctx:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','job_id','lease_generation']),binding=scope(v),id=uuid(v.job_id),generation=decimal(v.lease_generation);
 const trusted=authorizeReview(ctx,binding,['VERIFIER']);assertInvocation((ctx as Data).invocation);
 const runner=capability<Runner>(ctx,'12.4','runner.remote.v1',['prepare','execute']);
 const recorded=await transaction(ctx,binding,async db=>{
  const job=await lockJob(db,binding,id);
  const receipt=await db.query<Data>('SELECT id,result FROM hyperfide.review_reproduction_receipts WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 AND lease_generation=$4',[binding.organisation_id,binding.run_id,id,generation]);
  if(!receipt.rows[0])return null;
  if(job.worker_session_id!==trusted.invocation.principal.actor_id)fail('REPRODUCTION_JOB_DENIED','Recorded job belongs to another verifier');
  return {receipt_id:receipt.rows[0].id,result:receipt.rows[0].result,replayed:true,current:String(job.lease_generation)===generation&&await reviewInputCurrent(db,binding,job.snapshot)};
 },false);
 if(recorded)return recorded;
 const prepared=await transaction(ctx,binding,async db=>{
  const job=await lockJob(db,binding,id);ownerJob(ctx,binding,job,generation);await currentJob(db,binding,job);
  await assertReviewExecutionAllowed(ctx,db,binding,job.snapshot.source_set,job.sandbox_id,'CHECKPOINT',[job.snapshot.task_id]);
  if(!['LEASED','RUNNING','OUTCOME_UNKNOWN'].includes(job.state))fail('REPRODUCTION_DISPATCH_CONFLICT','Only the same current recorded remote operation may be resumed');
  const check=job.snapshot.check as Data;
  const artifactPaths=Array.isArray(check.required_artifacts)?check.required_artifacts:[];
  if(artifactPaths.some((item:unknown)=>typeof item!=='string'||item.length>255))fail('REPRODUCTION_REGISTRY_INVALID','Registered artifact path is invalid');
  const actual=await db.query<Data>(`SELECT session_id FROM hyperfide.runner_registry WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND slot_id=$4 AND boot_generation=$5 AND state='CURRENT'`,[binding.organisation_id,binding.run_id,job.sandbox_id,job.slot_id,job.sandbox_boot_generation]);
  if(actual.rows.length!==1)fail('REPRODUCTION_RUNNER_UNAVAILABLE','An exact current registered runner observation is required');
  // Reproductions are scheduled only onto a registered remote TEST slot; the
  // supervisory control host is never a placement target.
  const placement=await db.query<Data>(`SELECT 1 FROM hyperfide.worker_slots slot JOIN hyperfide.sandboxes box ON box.organisation_id=slot.organisation_id AND box.id=slot.sandbox_id AND box.boot_generation=slot.boot_generation WHERE slot.organisation_id=$1 AND slot.id=$2 AND slot.sandbox_id=$3 AND slot.boot_generation=$4 AND slot.capacity_kind='TEST' AND box.observed_state='RUNNING'`,[binding.organisation_id,job.slot_id,job.sandbox_id,job.sandbox_boot_generation]);
  if(placement.rows.length!==1)fail('REPRODUCTION_PLACEMENT_INVALID','Reproduction dispatch requires a current registered remote TEST slot');
  const registry=capability<Data>(ctx,'12.1','runner.registry.v1',['lookup']),registered=await registry.lookup(db,{...binding,session_id:actual.rows[0]!.session_id});
  if(registered.sandbox_id!==job.sandbox_id||registered.slot_id!==job.slot_id||String(registered.boot_generation)!==String(job.sandbox_boot_generation)||registered.repository_id!==job.snapshot.repository_id||registered.source_object_id!==job.snapshot.source_object_id||registered.source_tree_id!==job.snapshot.source_tree_id||registered.source_digest!==job.snapshot.source_manifest_digest)fail('REPRODUCTION_SOURCE_MISMATCH','Actual prepared runner source differs from the immutable reproduction source');
  if(job.runner_session_id&&(job.runner_session_id!==registered.session_id||String(job.runner_slot_generation)!==String(registered.slot_generation)))fail('REPRODUCTION_RECONCILE_REQUIRED','Recorded runner was replaced; reconcile the existing operation without relaunching');
  const measuredJob={...job,runner_session_id:registered.session_id};
  const inputValidation=await measuredReproductionInputs(ctx,db,binding,measuredJob);
  const permit=await runner.prepare(db,(ctx as Data).invocation,{job_namespace:'REPRODUCTION',input_validation:inputValidation,session_id:registered.session_id,operation_id:id,repository_id:job.snapshot.repository_id,reservation_id:job.reservation_id,task_id:job.snapshot.task_id,job_id:id,job_kind:'TEST',argv:check.argv,cwd:'.',environment:{},environment_digest:hash({}),artifact_paths:artifactPaths,
   timeout_ms:check.timeout_ms,source_digest:job.snapshot.source_manifest_digest,source_provenance_digest:hash(job.snapshot.execution_inputs),policy_digest:job.snapshot.registry_digest,
   executable_digest:check.executable_digest});
  await db.query("UPDATE hyperfide.review_reproduction_jobs SET state='RUNNING',runner_session_id=$4,runner_boot_id=$5,workspace_path=$6,runner_slot_generation=$7 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[binding.organisation_id,binding.run_id,id,registered.session_id,registered.boot_id,registered.workspace_path,decimal(registered.slot_generation)]);
  return {permit,inputValidation,job:{...job,runner_session_id:registered.session_id,runner_boot_id:registered.boot_id,runner_slot_generation:decimal(registered.slot_generation),workspace_path:registered.workspace_path} as Data};
 });
 // The runner executes only after the guarded dispatch intent commits. No transaction spans remote work or artifact I/O.
 const leaseAbort=new AbortController(),signal=AbortSignal.any([trusted.invocation.signal,leaseAbort.signal]);
 let renewing=false;
 const heartbeat=setInterval(()=>{if(renewing)return;renewing=true;void renewReproduction(ctx,{...binding,job_id:id,lease_generation:generation}).catch(()=>leaseAbort.abort()).finally(()=>{renewing=false;});},15000);
 try{
 let physical:Data;
 try{physical=await runner.execute(prepared.permit,signal) as Data;}
 catch(error){
  await transaction(ctx,binding,async db=>{const job=await lockJob(db,binding,id);ownerJob(ctx,binding,job,generation);await db.query("UPDATE hyperfide.review_reproduction_jobs SET state='OUTCOME_UNKNOWN' WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[binding.organisation_id,binding.run_id,id]);});
  fail('REPRODUCTION_OUTCOME_UNKNOWN','Remote execution outcome is unknown; retry cannot manufacture proof');
 }
 const sourceDigest=prepared.job.snapshot.source_manifest_digest,check=prepared.job.snapshot.check as Data;
 if(!physical||physical.execution_plane!=='REMOTE'||physical.organisation_id!==binding.organisation_id||physical.run_id!==binding.run_id||
 physical.operation_id!==id||physical.repository_id!==prepared.job.snapshot.repository_id||physical.session_id!==prepared.job.runner_session_id||physical.boot_id!==prepared.job.runner_boot_id||physical.sandbox_id!==prepared.job.sandbox_id||String(physical.boot_generation)!==String(prepared.job.sandbox_boot_generation)||
 physical.source_digest!==sourceDigest||physical.source_object_id!==prepared.job.snapshot.source_object_id||physical.source_tree_id!==prepared.job.snapshot.source_tree_id||physical.source_provenance_digest!==hash(prepared.job.snapshot.execution_inputs)||physical.policy_digest!==prepared.job.snapshot.registry_digest||physical.executable_digest!==check.executable_digest||
 physical.slot_id!==prepared.job.slot_id||String(physical.slot_generation)!==String(prepared.job.runner_slot_generation)||![ '.',prepared.job.workspace_path].includes(physical.cwd)||typeof physical.process_ref!=='string'||!physical.process_ref||!physical.start_identity||typeof physical.start_identity!=='object'||!Number.isSafeInteger(physical.start_identity.pid)||physical.start_identity.pid<1||!Number.isSafeInteger(physical.start_identity.pgid)||physical.start_identity.pgid<1||!Number.isSafeInteger(physical.start_identity.uid)||physical.start_identity.uid<1||typeof physical.start_identity.start_time!=='string'||!(/^(0|[1-9][0-9]*)$/).test(physical.start_identity.start_time)||typeof physical.start_identity.os_boot_id!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).test(physical.start_identity.os_boot_id)||physical.environment_digest!==hash({})||canonical(physical.input_validation)!==canonical(prepared.inputValidation)||canonical(physical.argv)!==canonical(check.argv)||physical.output_complete!==true||physical.truncated!==false||physical.status!=='COMPLETED'||
 !Number.isSafeInteger(physical.exit_code)||physical.timed_out!==false||physical.interrupted!==false||physical.cleanup_status!=='CONFIRMED'||physical.cleanup?.complete!==true||physical.cleanup?.observed_process_absent!==true)
 fail('REPRODUCTION_RECEIPT_INCOMPLETE','Actual remote executable/source/process/output provenance is incomplete; job cannot qualify');
 const stdout=captured(physical.stdout),stderr=captured(physical.stderr),out=await upload(ctx,binding,stdout),err=await upload(ctx,binding,stderr);
 const additional:Data[]=[];
 for(const path of check.required_artifacts??[]){
  const found=Array.isArray(physical.artifacts)?physical.artifacts.filter((item:Data)=>item.path===path):[];
  if(found.length!==1)fail('REPRODUCTION_ARTIFACT_UNAVAILABLE','Required registered artifact is missing or ambiguous');
  additional.push({path,...await upload(ctx,binding,captured(found[0]))});
 }
 const physicalMetadata={...physical,input_validation:prepared.inputValidation,requested_cwd:'.',verified_workspace_path:prepared.job.workspace_path,stdout:{digest:out.content_digest,size_bytes:String(stdout.length),complete:true},stderr:{digest:err.content_digest,size_bytes:String(stderr.length),complete:true},artifacts:additional};
 const outcome=physical.exit_code===0?'PASS':'FAIL',checks=[{id:check.id,status:outcome,exit_code:physical.exit_code}];
 const limitations:string[]=[];
 if((prepared.job.snapshot.source_set as Data[]).some(source=>source.repository_id!==prepared.job.snapshot.repository_id))limitations.push('PHYSICAL_SOURCE_SET_PARTIAL');
 if(prepared.job.snapshot.graph_complete!==true)limitations.push('GRAPH_REFERENCES_INCOMPLETE');
 if(prepared.job.snapshot.contracts_complete!==true)limitations.push('CONTRACT_FACETS_UNKNOWN');

 const receiptBody={schema_version:1,job_id:id,lease_generation:generation,candidate_digest:prepared.job.candidate_digest,input_manifest_digest:prepared.job.input_manifest_digest,
 source_set:prepared.job.snapshot.source_set,checks,physical:physicalMetadata,stdout:out,stderr:err,outcome,limitations};
 const receiptArtifact=await upload(ctx,binding,Buffer.from(canonical(receiptBody),'utf8'));
 return transaction(ctx,binding,async db=>{
  const job=await lockJob(db,binding,id);ownerJob(ctx,binding,job,generation);await currentJob(db,binding,job);
  await assertReviewExecutionAllowed(ctx,db,binding,job.snapshot.source_set,job.sandbox_id,'CHECKPOINT',[job.snapshot.task_id]);
  if(job.state!=='RUNNING')fail('REPRODUCTION_LEASE_STALE','Job was fenced after physical execution');
  const resources=capability<Data>(ctx,'5.1','scheduler.allocations.v1',['assertJobReservation','readJobAllocation']);
  await resources.assertJobReservation(db,{...binding,task_id:job.snapshot.task_id,job_kind:'TEST',reservation_id:job.reservation_id});
  const allocation=await resources.readJobAllocation(db,{...binding,reservation_id:job.reservation_id});
  if(!allocation||allocation.allocation_id!==job.allocation_id||allocation.assignee_session_id!==job.worker_session_id||allocation.slot_id!==job.slot_id||allocation.sandbox_id!==job.sandbox_id||String(allocation.sandbox_boot_generation)!==String(job.sandbox_boot_generation)||String(allocation.generation)!==String(job.allocation_generation))fail('REPRODUCTION_LEASE_STALE','Remote reservation was revoked or reassigned before output admission');
  const runnerRegistry=capability<Data>(ctx,'12.1','runner.registry.v1',['lookup']);
  const finalRunner=await runnerRegistry.lookup(db,{...binding,session_id:job.runner_session_id});
  if(String(finalRunner.slot_generation)!==String(job.runner_slot_generation)||String(job.runner_slot_generation)!==String(prepared.job.runner_slot_generation))fail('REPRODUCTION_RUNNER_STALE','Physical runner slot generation changed independently of its scheduler allocation');
  const finalInputs=await measuredReproductionInputs(ctx,db,binding,job);
  if(canonical(finalInputs)!==canonical(prepared.inputValidation))fail('REPRODUCTION_INPUTS_STALE','Measured execution context changed before evidence admission');
  const snapshot=job.snapshot;
  const evidence=await db.query<Data>(`INSERT INTO hyperfide.evidence(organisation_id,run_id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest,manifest_digest,artifact_id,admission_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ADMITTED') RETURNING id`,
   [binding.organisation_id,binding.run_id,snapshot.attempt_id,snapshot.attempt_generation,snapshot.repository_id,snapshot.source_object_id,snapshot.source_criteria_digest,hash(receiptBody),receiptArtifact.artifact_id]);
  const evidenceId=evidence.rows[0]!.id;
  for(const [artifact,role] of [[out,'stdout'],[err,'stderr']] as const)await db.query('INSERT INTO hyperfide.evidence_artifacts(organisation_id,run_id,evidence_id,artifact_id,role) VALUES($1,$2,$3,$4,$5)',[binding.organisation_id,binding.run_id,evidenceId,artifact.artifact_id,role]);
  for(const artifact of additional)await db.query('INSERT INTO hyperfide.evidence_artifacts(organisation_id,run_id,evidence_id,artifact_id,role) VALUES($1,$2,$3,$4,$5)',[binding.organisation_id,binding.run_id,evidenceId,artifact.artifact_id,artifact.path]);
  const result={...receiptBody,receipt_artifact:receiptArtifact,evidence_ids:[evidenceId]};
  const receipt=await db.query<Data>('INSERT INTO hyperfide.review_reproduction_receipts(organisation_id,run_id,job_id,lease_generation,input_manifest_digest,candidate_digest,result,stdout_artifact_id,stderr_artifact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
   [binding.organisation_id,binding.run_id,id,generation,job.input_manifest_digest,job.candidate_digest,result,out.artifact_id,err.artifact_id]);
  await db.query('UPDATE hyperfide.review_reproduction_jobs SET state=$4 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[binding.organisation_id,binding.run_id,id,outcome==='PASS'?'PASSED':'FAILED']);
  return {receipt_id:receipt.rows[0]!.id,evidence_ids:[evidenceId],job_id:id,outcome,checks,qualification_scope:job.qualification_scope,system_correctness:'NOT_PROVEN',proven_checks:checks.map(item=>item.id),limitations};
 });
 }catch(error){
  const code=reviewError(error).code;
  try{await transaction(ctx,binding,async db=>{const job=await lockJob(db,binding,id);if(job.state==='RUNNING'&&String(job.lease_generation)===generation&&job.worker_session_id===trusted.invocation.principal.actor_id)await db.query(`UPDATE hyperfide.review_reproduction_jobs SET state='OUTCOME_UNKNOWN',last_error_code=$4 WHERE organisation_id=$1 AND run_id=$2 AND id=$3`,[binding.organisation_id,binding.run_id,id,code]);});}catch{/* Scoped stop/credential fencing remains authoritative even when failure annotation cannot commit. */}
  throw error;
 }finally{clearInterval(heartbeat);}
}
function receiptManifestDigest(result:Data):string{const body={...result};delete body.evidence_ids;delete body.receipt_artifact;return hash(body);}
export async function inspectReproduction(db:ReviewDb,binding:ReviewScope,planId:string):Promise<unknown>{
 await primary(db);await lockReviewDisposition(db,binding);uuid(planId);
 const retained=await inspectRepairReproduction(db,binding,planId);if(retained)return retained;
 const rows=await db.query<Data>(`SELECT job.*,receipt.id AS receipt_id,receipt.lease_generation AS receipt_generation,receipt.result,slot.capacity_kind AS slot_capacity_kind FROM hyperfide.review_reproduction_jobs job LEFT JOIN hyperfide.review_reproduction_receipts receipt ON receipt.organisation_id=job.organisation_id AND receipt.run_id=job.run_id AND receipt.job_id=job.id AND receipt.lease_generation=job.lease_generation LEFT JOIN hyperfide.worker_slots slot ON slot.organisation_id=job.organisation_id AND slot.id=job.slot_id WHERE job.organisation_id=$1 AND job.run_id=$2 AND job.id=ANY($3::uuid[])`,[binding.organisation_id,binding.run_id,[planId,pairedId(planId)]]);
 const currentPlan=rows.rows.find(row=>row.snapshot?.plan_id===planId&&row.snapshot?.plan_kind==='CURRENT_SOURCE'&&row.snapshot?.variant==='REPAIRED');
 if(currentPlan){
  const causal=await db.query<Data>(`SELECT job.*,receipt.id AS receipt_id,receipt.lease_generation AS receipt_generation,receipt.result,slot.capacity_kind AS slot_capacity_kind FROM hyperfide.review_reproduction_jobs job LEFT JOIN hyperfide.review_reproduction_receipts receipt ON receipt.organisation_id=job.organisation_id AND receipt.run_id=job.run_id AND receipt.job_id=job.id AND receipt.lease_generation=job.lease_generation LEFT JOIN hyperfide.worker_slots slot ON slot.organisation_id=job.organisation_id AND slot.id=job.slot_id WHERE job.organisation_id=$1 AND job.run_id=$2 AND job.id=$3 AND job.snapshot->>'variant'='ORIGINAL' AND job.snapshot->>'plan_id'=$4`,[binding.organisation_id,binding.run_id,currentPlan.snapshot.historical_original_job_id,currentPlan.snapshot.causal_plan_id]);
  rows.rows.push(...causal.rows);
 }
 let status:'COMPLETE'|'INCOMPLETE'|'STALE'|'CONFLICT'='COMPLETE';
 const results:Data={};
 for(const variant of ['ORIGINAL','REPAIRED']){
  const matches=rows.rows.filter(row=>row.snapshot?.variant===variant&&(variant==='ORIGINAL'&&currentPlan?row.id===currentPlan.snapshot.historical_original_job_id:row.snapshot?.plan_id===planId));
  if(matches.length!==1){status=matches.length?'CONFLICT':status==='COMPLETE'?'INCOMPLETE':status;continue;}
  const row=matches[0]!,result=row.result as Data|undefined;
  const historical=variant==='ORIGINAL'&&!!currentPlan;
  let current=hash(row.snapshot)===row.input_manifest_digest&&(historical||await reviewInputCurrent(db,binding,row.snapshot)),registryCurrent=false,originRegistryCurrent=false;
  try{
   const registry=await loadRegistry(db,binding,row.snapshot.task_id);
   registryCurrent=registry.registry_digest===row.snapshot.registry_digest&&canonical(selectedCheck(registry,row.template_id))===canonical(row.snapshot.check);
   try{const origin=await loadRegistry(db,binding,row.snapshot.origin_task_id);originRegistryCurrent=origin.registry_digest===row.snapshot.origin_registry_digest&&canonical(selectedCheck(origin,row.template_id))===canonical(row.snapshot.check);}catch{originRegistryCurrent=false;}
   if(!historical)current=current&&registryCurrent&&(row.snapshot.plan_kind==='CURRENT_SOURCE'||originRegistryCurrent);
   if(row.snapshot.plan_kind==='CURRENT_SOURCE')await currentJob(db,binding,row);
  }catch{if(!historical)current=false;}
  if(!current)status='STALE';
  let admitted=false;
  if(result&&Array.isArray(result.evidence_ids)&&result.evidence_ids.length){
   const proof=await db.query<Data>(`SELECT evidence.id FROM hyperfide.evidence evidence JOIN hyperfide.artifacts artifact ON artifact.organisation_id=evidence.organisation_id AND artifact.run_id=evidence.run_id AND artifact.id=evidence.artifact_id WHERE evidence.organisation_id=$1 AND evidence.run_id=$2 AND evidence.id=ANY($3::uuid[]) AND evidence.admission_state='ADMITTED' AND evidence.repository_id=$4 AND evidence.source_object_id=$5 AND evidence.manifest_digest=$6 AND artifact.status='COMPLETE' AND evidence.attempt_id=$7 AND evidence.attempt_generation=$8 AND evidence.criteria_digest=$9 AND NOT EXISTS(SELECT 1 FROM hyperfide.evidence_artifacts support LEFT JOIN hyperfide.artifacts bytes ON bytes.organisation_id=support.organisation_id AND bytes.run_id=support.run_id AND bytes.id=support.artifact_id WHERE support.organisation_id=evidence.organisation_id AND support.run_id=evidence.run_id AND support.evidence_id=evidence.id AND (bytes.id IS NULL OR bytes.status<>'COMPLETE'))`,[binding.organisation_id,binding.run_id,result.evidence_ids,row.snapshot.repository_id,row.snapshot.source_object_id,receiptManifestDigest(result),row.snapshot.attempt_id,row.snapshot.attempt_generation,row.snapshot.source_criteria_digest]);
   const receiptBytes={...result};delete receiptBytes.evidence_ids;delete receiptBytes.receipt_artifact;
   const receiptRef=result.receipt_artifact;
   admitted=proof.rows.length===new Set(result.evidence_ids).size&&receiptRef?.content_digest===receiptManifestDigest(result)&&receiptRef?.size_bytes===String(Buffer.byteLength(canonical(receiptBytes)))&&await artifactRefCurrent(db,binding,receiptRef);
   if(admitted){
    const primary=await db.query('SELECT id FROM hyperfide.evidence WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) AND artifact_id=$4',[binding.organisation_id,binding.run_id,result.evidence_ids,receiptRef.artifact_id]);
    admitted=primary.rows.length===new Set(result.evidence_ids).size;
   }
   const required=[{role:'stdout',...result.stdout},{role:'stderr',...result.stderr},...(result.physical?.artifacts??[]).map((v:Data)=>({role:v.path,...v}))];
   for(const ref of required){
    if(!await artifactRefCurrent(db,binding,ref)){admitted=false;break;}
    const linked=await db.query('SELECT 1 FROM hyperfide.evidence_artifacts WHERE organisation_id=$1 AND run_id=$2 AND evidence_id=ANY($3::uuid[]) AND artifact_id=$4 AND role=$5',[binding.organisation_id,binding.run_id,result.evidence_ids,ref.artifact_id,ref.role]);
    if(linked.rows.length!==1){admitted=false;break;}
   }
  }
  if(!historical&&result&&Array.isArray(result.limitations)&&result.limitations.length&&status==='COMPLETE')status='INCOMPLETE';
  const checks=result?.checks,terminal=['PASSED','FAILED'].includes(row.state),valid=terminal&&row.receipt_id&&String(row.receipt_generation)===String(row.lease_generation)&&admitted&&Array.isArray(checks)&&checks.length===1&&checks[0]?.id===row.template_id&&checks[0]?.status===(row.state==='PASSED'?'PASS':'FAIL')&&result?.outcome===checks[0]?.status&&result?.job_id===row.id&&result?.candidate_digest===row.candidate_digest&&result?.input_manifest_digest===row.input_manifest_digest&&String(result?.lease_generation)===String(row.lease_generation)&&canonical(result?.source_set)===canonical(row.snapshot.source_set);
  if(!valid&&status==='COMPLETE')status='INCOMPLETE';
  results[variant.toLowerCase()]={historical,currentness:historical?'HISTORICAL_CAUSAL_PROOF':'CURRENT_EXECUTION_PROOF',causal_plan_id:historical?currentPlan!.snapshot.causal_plan_id:row.snapshot.plan_id,causal_job_id:historical?row.id:null,registry_current:registryCurrent,origin_registry_current:originRegistryCurrent,source_origin:row.snapshot.source_origin??'SUBMITTED_RESULT',publication_operation_id:row.snapshot.publication_operation_id??null,qualification_receipt_digest:row.snapshot.qualification_receipt_digest??null,git_provenance_manifest_digest:row.snapshot.git_provenance_manifest_digest??null,integration_input_manifest_digest:row.snapshot.integration_input_manifest_digest??null,limitations:result?.limitations??[],job_id:row.id,custody_id:row.snapshot.custody_id,custody_generation:row.snapshot.custody_generation??null,task_id:row.snapshot.task_id,source_task_id:row.snapshot.source_task_id,origin_task_id:row.snapshot.origin_task_id,criteria_digest:row.snapshot.criteria_digest,source_criteria_digest:row.snapshot.source_criteria_digest,registry_digest:row.snapshot.registry_digest,origin_registry_digest:row.snapshot.origin_registry_digest,template_id:row.template_id,check_definition_digest:hash(row.snapshot.check),qualification_scope:row.qualification_scope,source_set:row.snapshot.source_set,input_manifest_digest:row.input_manifest_digest,outcome:valid?(row.state==='PASSED'?'PASS':'FAIL'):'UNKNOWN',receipt_id:row.receipt_id??null,evidence_ids:admitted?result!.evidence_ids:[],checks:valid?checks:[],job_state:row.state,last_error_code:row.last_error_code??null,
   placement:{execution_plane:row.sandbox_id?'REMOTE':'UNASSIGNED',sandbox_id:row.sandbox_id??null,sandbox_boot_generation:row.sandbox_boot_generation==null?null:String(row.sandbox_boot_generation),slot_id:row.slot_id??null,capacity_kind:row.slot_capacity_kind??null,runner_session_id:row.runner_session_id??null,receipt_execution_plane:result?.physical?.execution_plane??null,receipt_sandbox_id:result?.physical?.sandbox_id??null}};
 }
 const first=rows.rows[0];
 return {status,plan_id:planId,plan_kind:currentPlan?'CURRENT_SOURCE':'PAIRED',causal_plan_id:currentPlan?.snapshot?.causal_plan_id??planId,candidate_digest:(currentPlan??first)?.candidate_digest??null,candidate_input_manifest_digest:(currentPlan??first)?.snapshot?.candidate_input_manifest_digest??null,...results,
  guidance:uncertainGuidance(rows.rows),proof_basis:'REMOTE_EXECUTION_RECEIPTS_ONLY',guidance_is_proof:false,candidate_build:'NOT_PROVEN_BY_GUIDANCE',system_correctness:'NOT_PROVEN'};
}
export async function fenceReproductionJobs(db:ReviewDb,binding:ReviewScope,control:ReviewControl):Promise<unknown>{
 await primary(db);await lockReviewDisposition(db,binding,true);
 const rows=await db.query<Data>(`SELECT * FROM hyperfide.review_reproduction_jobs WHERE organisation_id=$1 AND run_id=$2 AND state IN ('LEASED','RUNNING','OUTCOME_UNKNOWN') FOR UPDATE`,[binding.organisation_id,binding.run_id]);
 const fenced:Data[]=[],physical:Data[]=[];
 for(const row of rows.rows){
  const tasks=[...new Set([row.snapshot.task_id,row.snapshot.source_task_id,row.snapshot.origin_task_id].filter(Boolean))] as string[];
  if(!await reviewControlMatches(db,binding,control,tasks,row.sandbox_id))continue;
  physical.push({kind:'REPRODUCTION',job_id:row.id,session_id:row.worker_session_id,runner_session_id:row.runner_session_id,reservation_id:row.reservation_id,slot_id:row.slot_id,sandbox_id:row.sandbox_id,sandbox_boot_generation:row.sandbox_boot_generation,lease_generation:row.lease_generation,operation_id:['RUNNING','OUTCOME_UNKNOWN'].includes(row.state)?row.id:null});
  const changed=await db.query(`UPDATE hyperfide.review_reproduction_jobs SET lease_generation=lease_generation+1,worker_session_id=NULL,lease_expires_at=NULL,state=$4 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING id,lease_generation`,[binding.organisation_id,binding.run_id,row.id,control.mode==='CANCEL'?'CANCELLED':'OUTCOME_UNKNOWN']);
  const fencedRow=changed.rows[0];if(!fencedRow)fail('REVIEW_FENCE_CONFLICT','Locked review authority could not be fenced');fenced.push(fencedRow);
 }
 return {fenced,physical,cleanup_status:'UNKNOWN',reassignment_authorized:false,control_operation_id:control.operation_id,control_generation:control.control_generation};
}

async function integratedSource(db:ReviewDb,binding:ReviewScope,record:Data,registry:Data,operationId:string,candidateDigest:string):Promise<Data>{
 let proof:Data,publication:Data;
 try{const path='../assurance/coverage.js',module=await import(path) as Data;proof=await module.inspectCoverage(db,binding,record.id);}
 catch{fail('REPRODUCTION_QUALIFICATION_UNAVAILABLE','Actual current qualification inspector is unavailable');}
 if(proof.applicability!=='CURRENT'||proof.proof_complete!==true||proof.proof_registry_current!==true||proof.proof_source_origin!=='INTEGRATED_PUBLICATION'||proof.proof_registry_digest!==registry.registry_digest||proof.proof_criteria_digest!==registry.task.criteria_digest||proof.proof_publication_operation_id!==operationId||!Array.isArray(proof.required_check_ids)||!Array.isArray(proof.passed_check_ids)||!proof.required_check_ids.every((id:string)=>proof.passed_check_ids.includes(id)))fail('REPRODUCTION_QUALIFICATION_INCOMPLETE','Fresh current integrated qualification proof and exact accepted registry are required');
 try{const path='../integration/publication.js',module=await import(path) as Data;publication=await module.inspectIntegratedPublication(db,binding,{task_id:record.task_id,custody_id:record.id,custody_generation:String(record.custody_generation)});}
 catch{fail('REPRODUCTION_PUBLICATION_UNAVAILABLE','Actual contributor and custody publication lineage is unavailable');}
 const source=publication.current_source;
 if(publication.status!=='PUBLISHED'||publication.lineage_status!=='VERIFIED_PUBLISHED_CHAIN'||!source||source.operation_id!==operationId||source.repository_id!==record.repository_id||source.source_object_id!==publication.latest_repository_head||source.source_object_id!==proof.proof_source_object_id||source.tree!==proof.proof_source_tree_id||source.integration_input_manifest_digest!==candidateDigest||source.integration_input_manifest_digest!==proof.proof_integration_input_manifest_digest||source.git_provenance_manifest_digest!==proof.proof_git_provenance_manifest_digest)fail('REPRODUCTION_PUBLICATION_STALE','Qualification must name the exact latest verified publication contributor chain');
 if(source.source_manifest_digest!==null&&source.source_manifest_digest!==undefined&&source.source_manifest_digest!==proof.proof_source_manifest_digest)fail('REPRODUCTION_PUBLICATION_STALE','Independent physical source manifest identities differ');
 return {...source,source_manifest_digest:digest(proof.proof_source_manifest_digest),qualification_receipt_digest:digest(proof.receipt_digest),source_object_id:oid(source.source_object_id),tree:oid(source.tree),git_provenance_manifest_digest:digest(source.git_provenance_manifest_digest),integration_input_manifest_digest:digest(source.integration_input_manifest_digest)};
}
export async function planCurrentSourceReproduction(ctx:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','request_id','causal_plan_id','repair_custody_id','publication_operation_id','candidate_digest','candidate_input_manifest_digest','template_id','qualification_scope','snapshot']);
 const binding=scope(v);authorizeReview(ctx,binding,['OPERATOR','LEADER','COORDINATOR','FEATURE_MANAGER']);
 const requestId=uuid(v.request_id),causalId=uuid(v.causal_plan_id),custodyId=uuid(v.repair_custody_id),operationId=uuid(v.publication_operation_id),candidate=digest(v.candidate_digest),candidateInput=digest(v.candidate_input_manifest_digest),template=text(v.template_id,128),requestDigest=hash(v);
 if(!['COMPONENT','CONTRACT','SYSTEM'].includes(String(v.qualification_scope)))fail('REPRODUCTION_INPUT_INVALID','Unknown qualification scope');
 return transaction(ctx,binding,async db=>{
  const prior=await db.query<Data>('SELECT id,request_digest,snapshot FROM hyperfide.review_reproduction_jobs WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[binding.organisation_id,binding.run_id,requestId]);
  if(prior.rows[0]){
   if(prior.rows[0].request_digest!==requestDigest||prior.rows[0].snapshot.plan_kind!=='CURRENT_SOURCE')fail('REPRODUCTION_REQUEST_CONFLICT','Stable current-source request already has different immutable inputs');
   return {plan_id:prior.rows[0].snapshot.plan_id,job_id:prior.rows[0].id,plan_kind:'CURRENT_SOURCE',causal_plan_id:causalId,replayed:true,status:'UNRUN'};
  }
  const causal=await inspectReproduction(db,binding,causalId) as Data,original=causal.original;
  if(causal.plan_kind!=='PAIRED'||!original||original.outcome!=='FAIL'||!Array.isArray(original.evidence_ids)||!original.evidence_ids.length||original.template_id!==template||!original.receipt_id)fail('REPRODUCTION_CAUSAL_PROOF_INCOMPLETE','An actual immutable original failing execution is required; an unrun pair cannot authorize current-source reproduction');
  const record=await custody(db,binding,custodyId);
  await assertCausalRepairCustody(db,binding,causalId,record);
  if(!['ACTIVE','RELEASED'].includes(record.authority))fail('REPRODUCTION_CUSTODY_STALE','Current-source proof cannot revive disposed custody');
  const registry=await loadRegistry(db,binding,record.task_id),check=selectedCheck(registry,template);
  if(hash(check)!==original.check_definition_digest)fail('REPRODUCTION_CHECK_MISMATCH','Current accepted check differs from the recorded original failure definition');
  const source=await integratedSource(db,binding,record,registry,operationId,candidate);
  const current=await buildReviewSnapshot(db,binding,candidate,v.snapshot,ctx);
  if(hash(current)!==candidateInput||!(current.source_set as Data[]).some(row=>row.repository_id===record.repository_id&&row.source_object_id===source.source_object_id))fail('REPRODUCTION_INPUT_MISMATCH','New execution must use exact server-bound current publication inputs');
  const admitted=await db.query('SELECT 1 FROM hyperfide.review_obligation_inputs i JOIN hyperfide.review_obligations o ON o.organisation_id=i.organisation_id AND o.run_id=i.run_id AND o.id=i.obligation_id AND o.generation=i.generation JOIN hyperfide.review_policies p ON p.organisation_id=o.organisation_id AND p.run_id=o.run_id AND p.digest=o.policy_digest AND p.active WHERE i.organisation_id=$1 AND i.run_id=$2 AND i.input_manifest_digest=$3 AND i.candidate_digest=$4 AND o.repository_id=$5 AND o.source_object_id=$6 LIMIT 1',[binding.organisation_id,binding.run_id,candidateInput,candidate,record.repository_id,source.source_object_id]);
  if(!admitted.rows.length)fail('REPRODUCTION_INPUT_UNBOUND','Current-source review inputs must be admitted independently');
  const discovered=await db.query<Data>('SELECT tree_object_id FROM hyperfide.review_commits WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 AND source_object_id=$4',[binding.organisation_id,binding.run_id,record.repository_id,source.source_object_id]);
  if(discovered.rows[0]?.tree_object_id!==source.tree)fail('REPRODUCTION_DISCOVERY_REQUIRED','Actual Git discovery must confirm the exact published commit and tree');
  const planId=randomUUID(),jobId=pairedId(planId);
  const snapshot:Data={...current,plan_id:planId,plan_kind:'CURRENT_SOURCE',variant:'REPAIRED',causal_plan_id:causalId,historical_original_job_id:original.job_id,historical_original_receipt_id:original.receipt_id,candidate_input_manifest_digest:candidateInput,
   task_id:record.task_id,source_task_id:record.task_id,origin_task_id:original.origin_task_id,origin_registry_digest:original.origin_registry_digest,registry_digest:registry.registry_digest,
   custody_id:record.id,custody_generation:String(record.custody_generation),custody_source_object_id:record.source_object_id,custody_criteria_digest:record.criteria_digest,custody_source_manifest_digest:record.source_manifest_digest,attempt_id:record.source_attempt_id,attempt_generation:String(record.source_generation),
   source_origin:'INTEGRATED_PUBLICATION',publication_operation_id:operationId,qualification_receipt_digest:source.qualification_receipt_digest,
   git_provenance_manifest_digest:source.git_provenance_manifest_digest,integration_input_manifest_digest:source.integration_input_manifest_digest,
   repository_id:record.repository_id,source_object_id:source.source_object_id,source_tree_id:source.tree,source_manifest_digest:source.source_manifest_digest,
   source_criteria_digest:registry.task.criteria_digest,criteria_digest:registry.task.criteria_digest,check,contract_ids:(current.contract_versions as Data[]).map(row=>row.id)};
  snapshot.execution_inputs={source:{source_manifest_digest:snapshot.source_manifest_digest,source_set:current.source_set,publication_operation_id:operationId,git_provenance_manifest_digest:source.git_provenance_manifest_digest,integration_input_manifest_digest:source.integration_input_manifest_digest},dependency:{manifest_digest:current.dependency_manifest_digest},toolchain:{environment_profile_id:current.environment_profile_id,digest:current.toolchain_digest},configuration:{digest:current.configuration_digest},graph:{manifest_id:current.graph_manifest_id,digest:current.graph_manifest_digest,source_set:current.graph_source_set},contract:{versions:current.contract_versions}};
  if(!Array.isArray(check.input_keys)||!check.input_keys.length||check.input_keys.some((key:unknown)=>typeof key!=='string'||!Object.hasOwn(snapshot.execution_inputs,key)))fail('REPRODUCTION_REGISTRY_INVALID','Registered execution inputs are unavailable');
  const inputDigest=hash(snapshot);
  await db.query('INSERT INTO hyperfide.review_reproduction_jobs(organisation_id,run_id,id,request_id,request_digest,candidate_digest,input_manifest_digest,snapshot,template_id,qualification_scope) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[binding.organisation_id,binding.run_id,jobId,requestId,requestDigest,candidate,inputDigest,snapshot,template,v.qualification_scope]);
  return {plan_id:planId,job_id:jobId,jobs:[{job_id:jobId,variant:'REPAIRED',input_manifest_digest:inputDigest}],plan_kind:'CURRENT_SOURCE',causal_plan_id:causalId,source_origin:'INTEGRATED_PUBLICATION',publication_operation_id:operationId,status:'UNRUN',replayed:false};
 });
}

export function createComponent(context:ComponentContext):Component{
 const unregisterInputs=registerReproductionJobInputs(context,readReproductionJobInputs);
 const guarded=(fn:(ctx:ComponentContext,input:unknown)=>Promise<unknown>)=>async(input:unknown,ctx:ComponentContext)=>{try{return await fn(ctx,input);}catch(error){throw reviewError(error);}};
 return {apiVersion:1,close:unregisterInputs,actions:{
  'review.reproduction.renew':guarded(renewReproduction),'review.reproduction.plan':guarded(planReproduction),
  'review.reproduction.repair.record':guarded(recordRepairReproduction),
  'review.reproduction.current.plan':guarded(planCurrentSourceReproduction),'review.reproduction.assign':guarded(assignReproduction),'review.reproduction.execute':guarded(executeReproduction),
  'review.reproduction.inspect':guarded(async(ctx,input)=>{const v=obj(input,['organisation_id','run_id','plan_id']);return transaction(ctx,scope(v),db=>inspectReproduction(db,scope(v),uuid(v.plan_id)),false);})
 }};
}
