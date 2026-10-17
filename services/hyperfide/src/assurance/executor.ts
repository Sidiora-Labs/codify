import {resultInputProducer} from './result_inputs.js';
import {randomUUID} from 'node:crypto';
import {inspectEffectiveResultInputs,registerQualificationInputReader,planResultPreparation,inspectResultPreparation} from './preparation.js';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {artifact,canonical,currentCustody,custodyLock,decimal,digest,fail,fields,hash,scope,transaction,uuid,invocation,roles,executionGate,assuranceBarrier,loadPolicy,retainArtifactBytes as uploadBytes} from './submission.js';
import type {Data,PrimaryClient} from './submission.js';

const MAX_OUTPUT=32*1024*1024;
function identity(ctx:ComponentContext):Data{
 const principal=roles(ctx,['VERIFIER']).principal;
 const verifier=uuid(principal.actor_id),sandbox=uuid(principal.sandbox_id);
 return {verifier_id:verifier,sandbox_id:sandbox};
}
function jobResources(ctx:ComponentContext):Data{
 try{return (ctx as unknown as Data).dependencies.require('5.1','scheduler.allocations.v1',(value:unknown):boolean=>
  !!value&&typeof value==='object'&&typeof (value as Data).assertJobReservation==='function'&&typeof (value as Data).readJobAllocation==='function'&&typeof (value as Data).renewJobAllocation==='function'&&typeof (value as Data).releaseJobAllocation==='function') as Data;}
 catch{fail('QUALIFICATION_CAPACITY_UNAVAILABLE','Actual scheduler allocation authority is required');}
}
async function verifyEnvironment(ctx:ComponentContext,tx:unknown,job:Data,owner:Data):Promise<Data>{
 const assignment=await (tx as Data).query('SELECT * FROM hyperfide.assurance_job_assignments WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 ORDER BY assignment_generation DESC LIMIT 1',[job.organisation_id,job.run_id,job.id]);
 const bound=assignment.rows[0],principal=invocation(ctx).principal;
 if(!bound||bound.verifier_id!==owner.verifier_id||bound.sandbox_id!==owner.sandbox_id||
  String(bound.sandbox_boot_generation)!==String(principal.boot_generation)||
  owner.environment_digest&&owner.environment_digest!==bound.environment_digest||
  owner.reservation_id&&owner.reservation_id!==bound.reservation_id)
  fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Current job assignment differs from the authenticated verifier boot');
 owner.environment_digest=digest(bound.environment_digest);owner.reservation_id=uuid(bound.reservation_id);
 const allocation=await jobResources(ctx).readJobAllocation(tx,{organisation_id:job.organisation_id,run_id:job.run_id,reservation_id:owner.reservation_id});
 if(!allocation||allocation.allocation_id!==bound.allocation_id||String(allocation.generation)!==String(bound.allocation_generation)||
  allocation.slot_id!==bound.slot_id||allocation.sandbox_id!==bound.sandbox_id||
  String(allocation.sandbox_boot_generation)!==String(bound.sandbox_boot_generation)||allocation.assignee_session_id!==owner.verifier_id)
  fail('QUALIFICATION_STALE_JOB','Current independent capacity assignment generation changed');
 owner.allocation_id=bound.allocation_id;owner.allocation_generation=String(bound.allocation_generation);
 const dependencies=(ctx as unknown as Data).dependencies;
 let reader:Data;
 try{
  reader=dependencies.require('12.1','qualification.environment.v1',(value:unknown):boolean=>
   !!value&&typeof value==='object'&&typeof (value as Data).verify==='function') as Data;
 }catch{fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Actual runner/provider environment authority is not linked');}
 const result=await reader!.verify(tx,invocation(ctx),{job_id:job.id,reservation_id:owner.reservation_id,environment_digest:owner.environment_digest});
 if(!result||result.sandbox_id!==owner.sandbox_id||result.slot_id!==bound.slot_id||String(result.boot_generation)!==String(bound.sandbox_boot_generation)||result.boot_id!==principal.boot_id||!result.preparation_digest||!result.readiness_digest||!result.provider_observation_id||!result.runner_credential_id||!result.boot_id||!result.slot_id)
 fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Current independent environment observation is incomplete or mismatched');
 const expected=await inspectEffectiveResultInputs(tx as PrimaryClient,{organisation_id:job.organisation_id,run_id:job.run_id},{job_id:job.id});
 const validation=result.input_validation;
 if(!expected||!validation||validation.status!=='VERIFIED'||validation.job_id!==job.id||
  validation.namespace!=='QUALIFICATION'||String(validation.lease_generation)!==String(job.lease_generation)||validation.effective_result_input_receipt_digest!==expected.receipt_digest||validation.input_packet_digest!==expected.input_packet_digest||!/^sha256:[0-9a-f]{64}$/.test(validation.receipt_digest??'')||
  ['dependency','toolchain','configuration','graph','contract'].some(key=>validation.input_manifest?.[key]!==expected.input_manifest?.[key]))
  fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Measured preparation and runtime inputs have not been independently validated against the immutable job packet');
 const registry=dependencies.require('12.1','runner.registry.v1',(value:unknown):boolean=>
  !!value&&typeof value==='object'&&typeof (value as Data).lookup==='function') as Data;
 const runner=await registry.lookup(tx,{organisation_id:job.organisation_id,run_id:job.run_id,session_id:result.runner_session_id});
 if(!runner||runner.slot_id!==result.slot_id||runner.sandbox_id!==result.sandbox_id||runner.boot_id!==result.boot_id||
  String(runner.boot_generation)!==String(result.boot_generation))
  fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Actual prepared runner slot binding changed');
 return {...result,slot_generation:decimal(String(runner.slot_generation))};
}
async function lockJob(client:Parameters<Parameters<typeof transaction>[1]>[0],s:[string,string],id:string):Promise<Data>{
 const found=await client.query('SELECT custody_id FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...s,id]);
 if(!found.rows[0])fail('QUALIFICATION_NOT_FOUND','Verification job not found');
 const custody=await custodyLock(client,s,found.rows[0].custody_id);
 const result=await client.query('SELECT *,lease_expires_at>clock_timestamp() AS lease_alive FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...s,id]);
 return {...result.rows[0],custody};
}
function activeJob(job:Data,owner:Data,generation:string):void{
 if(job.state!=='RUNNING'||job.lease_owner!==owner.verifier_id||String(job.lease_generation)!==generation||!job.lease_alive)
 fail('QUALIFICATION_STALE_JOB','Current independent verifier lease required');
}
async function assignJob(ctx:ComponentContext,raw:unknown):Promise<Data>{
 roles(ctx,['COORDINATOR','OPERATOR']);
 const v=fields(raw,['organisation_id','run_id','job_id','expected_state_version','verifier_id','sandbox_id','slot_id','sandbox_boot_generation','reservation_id','environment_digest']);
 const s=scope(ctx,v),id=uuid(v.job_id),version=decimal(v.expected_state_version);
 for(const name of ['verifier_id','sandbox_id','slot_id','reservation_id'])uuid(v[name]);
 decimal(v.sandbox_boot_generation);digest(v.environment_digest);
 return transaction(ctx,async db=>{
  const job=await lockJob(db,s,id);
  await executionGate(ctx,db,s,'ADMISSION');
  if(job.custody.authority==='ACTIVE')currentCustody(job.custody,String(job.custody_generation));
  else{
   const operation=await db.query("SELECT id FROM hyperfide.requalification_operations WHERE organisation_id=$1 AND run_id=$2 AND qualification_job_id=$3 AND state IN ('PENDING','RUNNING')",[...s,id]);
   if(job.custody.authority!=='RELEASED'||!operation.rows.length)fail('QUALIFICATION_STALE_CUSTODY','Released work needs an explicit coordinator requalification operation');
  }
  if(String(job.state_version)!==version||!['PENDING','RUNNING'].includes(job.state)||(job.state==='RUNNING'&&job.lease_alive))
   fail('QUALIFICATION_CONFLICT','Only pending or expired verification jobs can receive an independent assignment');
  const prepared=await inspectEffectiveResultInputs(db,{organisation_id:s[0],run_id:s[1]},{job_id:id});
  if(prepared.runner_session_id!==v.verifier_id||prepared.environment_digest!==v.environment_digest)
   fail('QUALIFICATION_ENVIRONMENT_INPUT_CONFLICT','Assignment must name the actual prepared TEST runner and server-derived effective environment receipt');
  const source=await db.query('SELECT sandbox_id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...s,job.custody.source_attempt_id]);
  if(source.rows[0]?.sandbox_id===v.sandbox_id)fail('QUALIFICATION_NOT_INDEPENDENT','Verifier assignment must use a separate coding sandbox');
  const session=await db.query("SELECT a.id FROM hyperfide.agent_sessions a JOIN hyperfide.worker_slots w ON w.organisation_id=a.organisation_id AND w.id=a.slot_id AND w.sandbox_id=a.sandbox_id AND w.boot_generation=a.sandbox_boot_generation JOIN hyperfide.sandboxes b ON b.organisation_id=w.organisation_id AND b.id=w.sandbox_id AND b.boot_generation=w.boot_generation WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 AND a.role='VERIFIER' AND a.state IN ('REGISTERED','RUNNING') AND a.sandbox_id=$4 AND a.slot_id=$5 AND a.sandbox_boot_generation=$6 AND w.capacity_kind='TEST' AND w.state IN ('READY','ALLOCATED') AND b.observed_state='RUNNING' FOR SHARE OF a,w,b",
   [...s,v.verifier_id,v.sandbox_id,v.slot_id,v.sandbox_boot_generation]);
  if(!session.rows.length)fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Current scoped verifier session and TEST slot are required');
  const capacity=jobResources(ctx);
  await capacity!.assertJobReservation(db,{organisation_id:s[0],run_id:s[1],task_id:job.custody.task_id,job_kind:'TEST',reservation_id:v.reservation_id});
  const allocation=await capacity.readJobAllocation(db,{organisation_id:s[0],run_id:s[1],reservation_id:v.reservation_id});
  if(!allocation||allocation.task_id!==job.custody.task_id||allocation.job_kind!=='TEST'||
   allocation.assignee_session_id!==v.verifier_id||allocation.slot_id!==v.slot_id||allocation.sandbox_id!==v.sandbox_id||
   String(allocation.sandbox_boot_generation)!==v.sandbox_boot_generation)
   fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Exact current independent slot allocation required');
  uuid(allocation.allocation_id);decimal(String(allocation.generation));
  const reservation=await db.query("SELECT r.id FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts c ON c.organisation_id=r.organisation_id AND c.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.id=$3 AND r.state='ALLOCATED' AND r.expires_at>clock_timestamp() AND r.quantity>0 AND c.dimension='TEST' AND c.qualification_state='QUALIFIED' FOR SHARE OF r,c",[...s,v.reservation_id]);
  if(!reservation.rows.length)fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Independent verification needs an actual qualified allocated TEST reservation');
  const generation=await db.query('SELECT (coalesce(max(assignment_generation),0)+1)::text AS generation FROM hyperfide.assurance_job_assignments WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3',[...s,id]);
  await db.query('INSERT INTO hyperfide.assurance_job_assignments(organisation_id,run_id,job_id,assignment_generation,verifier_id,sandbox_id,slot_id,sandbox_boot_generation,reservation_id,environment_digest,allocation_id,allocation_generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
   [...s,id,generation.rows[0].generation,v.verifier_id,v.sandbox_id,v.slot_id,v.sandbox_boot_generation,v.reservation_id,v.environment_digest,allocation.allocation_id,String(allocation.generation)]);
  await db.query('UPDATE hyperfide.qualification_jobs SET state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...s,id]);
  return {job_id:id,assignment_generation:generation.rows[0].generation,state_version:(BigInt(version)+1n).toString(),
   readiness:'NOT_EVALUATED',qualification:'PENDING'};
 });
}
export async function claimJob(ctx:ComponentContext,raw:unknown):Promise<Data>{
 const v=fields(raw,['organisation_id','run_id','job_id','expected_state_version']);
 const s=scope(ctx,v),id=uuid(v.job_id),version=decimal(v.expected_state_version),owner=identity(ctx);
 return transaction(ctx,async client=>{
  const job=await lockJob(client,s,id);
  await executionGate(ctx,client,s,'ADMISSION');
  if(String(job.state_version)!==version)fail('QUALIFICATION_CONFLICT','Verification job version changed');
  const assigned=await client.query('SELECT * FROM hyperfide.assurance_job_assignments WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 ORDER BY assignment_generation DESC LIMIT 1',[...s,id]);
  const assignment=assigned.rows[0];
  if(assignment){owner.environment_digest=assignment.environment_digest;owner.reservation_id=assignment.reservation_id;}
  if(!assignment||assignment.verifier_id!==owner.verifier_id||assignment.sandbox_id!==owner.sandbox_id||
  assignment.reservation_id!==owner.reservation_id||assignment.environment_digest!==owner.environment_digest)
   fail('QUALIFICATION_ENVIRONMENT_UNAVAILABLE','Verifier identity lacks the current immutable resource assignment');
  const requal=await client.query("SELECT id FROM hyperfide.requalification_operations WHERE organisation_id=$1 AND run_id=$2 AND qualification_job_id=$3 AND state IN ('PENDING','RUNNING')",[...s,id]);
  if(requal.rows.length===0)currentCustody(job.custody,String(job.custody_generation));
  else if(!['ACTIVE','RELEASED'].includes(job.custody.authority))fail('QUALIFICATION_STALE_CUSTODY','Requalification disposition no longer valid');
  await verifyEnvironment(ctx,client,job,owner);
  const source=await client.query('SELECT sandbox_id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...s,job.custody.source_attempt_id]);
  if(source.rows[0]?.sandbox_id===owner.sandbox_id)fail('QUALIFICATION_NOT_INDEPENDENT','Coding sandbox cannot qualify its own submission');
  if(!['PENDING','RUNNING'].includes(job.state)||(job.state==='RUNNING'&&job.lease_alive))
   fail('QUALIFICATION_CONFLICT','Verification job is not available for claim');
  const renewed=await renewAllocation(ctx,client,s,owner);
  const lease=await client.query("UPDATE hyperfide.qualification_jobs SET state='RUNNING',lease_generation=lease_generation+1,lease_owner=$4,lease_expires_at=$5::timestamptz,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING id,lease_generation::text,lease_owner,lease_expires_at,state_version::text",
   [...s,id,owner.verifier_id,renewed.expires_at]);
  await client.query("UPDATE hyperfide.requalification_operations SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND qualification_job_id=$3 AND state='PENDING'",[...s,id]);
  return {...lease.rows[0],...owner,authority:'VERIFICATION_JOB_ONLY'};
 });
}

function bytesHash(bytes:Buffer):string{return 'sha256:'+requireHash(bytes);}
import {createHash} from 'node:crypto';
function requireHash(bytes:Buffer):string{return createHash('sha256').update(bytes).digest('hex');}
function remoteExecutor(ctx:ComponentContext):Data{
 let remote:Data;
 try{
  remote=(ctx as unknown as Data).dependencies.require('12.4','runner.remote.v1',(value:unknown):boolean=>
   !!value&&typeof value==='object'&&typeof (value as Data).prepare==='function'&&typeof (value as Data).execute==='function') as Data;
 }catch{fail('QUALIFICATION_REMOTE_EXECUTION_UNAVAILABLE','Actual provider-bound remote runner is not linked');}
 return remote!;
}
function remoteBytes(value:Data):Buffer{
 if(!value||value.complete!==true||!value.bytes||!Number.isSafeInteger(Number(value.size_bytes)))
  fail('QUALIFICATION_REMOTE_OUTPUT_INCOMPLETE','Remote output is missing or incomplete');
 const bytes=Buffer.from(value.bytes);
 if(bytes.length>MAX_OUTPUT||String(bytes.length)!==String(value.size_bytes)||bytesHash(bytes)!==value.digest)
  fail('QUALIFICATION_REMOTE_OUTPUT_INTEGRITY','Remote output byte identity differs from independently observed spool');
 return bytes;
}
async function renewAllocation(ctx:ComponentContext,db:unknown,s:[string,string],owner:Data):Promise<Data>{
 const renewed=await jobResources(ctx).renewJobAllocation(db,{organisation_id:s[0],run_id:s[1],
  reservation_id:owner.reservation_id,allocation_id:owner.allocation_id,allocation_generation:owner.allocation_generation,
  assignee_session_id:owner.verifier_id,lease_ms:600000});
 if(renewed.allocation_id!==owner.allocation_id||String(renewed.generation)!==owner.allocation_generation||!renewed.expires_at)
  fail('QUALIFICATION_STALE_JOB','Resource lease renewal did not retain its exact allocation generation');
 return renewed;
}
async function renewJob(ctx:ComponentContext,s:[string,string],id:string,generation:string,owner:Data):Promise<void>{
 await transaction(ctx,async client=>{
  const job=await lockJob(client,s,id);activeJob(job,owner,generation);await executionGate(ctx,client,s,'ADVANCE');
  await verifyEnvironment(ctx,client,job,owner);
  const renewed=await renewAllocation(ctx,client,s,owner);
  await client.query("UPDATE hyperfide.qualification_jobs SET lease_expires_at=$4::timestamptz,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...s,id,renewed.expires_at]);
 });
}
/** Refuses provider results that are not the admitted check: an unrelated command's zero exit cannot stand in for it. */
export function assertRemoteBinding(raw:Data,expected:{plan:Data;observed:Data;check:Data;snapshot:Data;sandbox_id:string;scope:[string,string]}):void{
 const {plan,observed,check,snapshot}=expected,s=expected.scope;
 if(!raw||typeof raw!=='object'||raw.execution_plane!=='REMOTE'||raw.truncated!==false||raw.operation_id!==plan.operation_id||raw.session_id!==plan.session_id||
  raw.sandbox_id!==expected.sandbox_id||raw.boot_id!==observed.boot_id||
  raw.slot_id!==observed.slot_id||String(raw.slot_generation)!==observed.slot_generation||!raw.native_resource_id||!raw.process_ref||!raw.start_identity||
  canonical(raw.argv)!==canonical(check.argv)||raw.cwd!==plan.cwd||
  raw.source_manifest_digest!==snapshot.manifest.source_manifest_digest||raw.source_object_id!==snapshot.manifest.source_object_id||raw.source_tree_id!==snapshot.manifest.source_tree_id||raw.source_digest!==snapshot.manifest.source_manifest_digest||raw.source_provenance_digest!==snapshot.inputs.source||
  raw.source_state_digest!==observed.source_state_digest||raw.policy_digest!==plan.policy_digest||
  raw.executable_digest!==check.executable_digest||raw.environment_digest!==plan.environment_digest||
  raw.repository_id!==snapshot.manifest.repository_id||raw.organisation_id!==s[0]||raw.run_id!==s[1]||
  String(raw.boot_generation)!==String(observed.boot_generation)||typeof raw.started_at!=='string'||typeof raw.ended_at!=='string'||
  !Number.isFinite(raw.duration_ms)||raw.duration_ms<0||!Number.isFinite(Date.parse(raw.started_at))||!Number.isFinite(Date.parse(raw.ended_at))||
  Date.parse(raw.ended_at)<Date.parse(raw.started_at)||typeof raw.spool_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(raw.spool_digest))
  fail('QUALIFICATION_REMOTE_BINDING_INVALID','Provider-observed execution identity differs from admitted check');
}
/** Complete command/environment/exit record retained for every executed check, passing or not. */
export function commandRecord(check:Data,plan:Data,observed:Data,raw:Data):Data{
 return {argv:check.argv,cwd:plan.cwd,workspace_path:observed.workspace_path,
  environment:plan.environment,environment_digest:plan.environment_digest,exit_code:raw.exit_code,signal:raw.signal??null,timed_out:raw.timed_out,
  interrupted:raw.interrupted,output_truncated:false,started_at:raw.started_at,ended_at:raw.ended_at,duration_ms:raw.duration_ms};
}
/** A check passes only on an affirmative, complete observation; unknown or absent fields fail with visible reasons. */
export function judgeCheck(raw:Data,requiredArtifacts:readonly string[],files:readonly Data[]):{outcome:'PASS'|'FAIL';reasons:string[]}{
 const reasons:string[]=[];
 if(raw?.status!=='COMPLETED')reasons.push('REMOTE_STATUS_NOT_COMPLETED');
 if(raw?.outcome!=='SUCCEEDED')reasons.push('REMOTE_OUTCOME_NOT_SUCCEEDED');
 if(raw?.exit_code!==0)reasons.push('EXIT_STATUS_NOT_ZERO');
 if(raw?.signal!==null)reasons.push('SIGNAL_NOT_ABSENT');
 if(raw?.timed_out!==false)reasons.push('TIMED_OUT_OR_UNKNOWN');
 if(raw?.interrupted!==false)reasons.push('INTERRUPTED_OR_UNKNOWN');
 if(raw?.output_complete!==true)reasons.push('OUTPUT_INCOMPLETE');
 if(raw?.cleanup_status!=='CONFIRMED'||raw?.cleanup?.complete!==true||raw?.cleanup?.observed_process_absent!==true)reasons.push('CLEANUP_NOT_CONFIRMED');
 if(!Array.isArray(requiredArtifacts)||!requiredArtifacts.length)reasons.push('REQUIRED_ARTIFACTS_UNDECLARED');
 else for(const name of requiredArtifacts){
  const matches=files.filter(file=>file?.path===name);
  if(matches.length!==1||matches[0]!.status||!matches[0]!.artifact_id||!/^sha256:[0-9a-f]{64}$/.test(matches[0]!.digest??''))reasons.push('REQUIRED_ARTIFACT_MISSING:'+name);
 }
 return {outcome:reasons.length?'FAIL':'PASS',reasons};
}
/** Receipt outcome over the exact registered selection: missing, duplicate, unknown, failed or stale checks never PASS. */
export function qualificationOutcome(required:readonly string[],results:readonly Data[],sourceObjectId:string):{outcome:'PASS'|'FAIL';unmet:Data[]}{
 const unmet:Data[]=[],registered=Array.isArray(required)?required:[];
 if(!registered.length)unmet.push({check_id:null,reasons:['NO_REQUIRED_CHECKS']});
 else if(new Set(registered).size!==registered.length)unmet.push({check_id:null,reasons:['DUPLICATE_REQUIRED_CHECK']});
 for(const id of new Set(registered)){
  const matches=results.filter(result=>result?.check_id===id);
  if(!matches.length){unmet.push({check_id:id,reasons:['REQUIRED_CHECK_MISSING']});continue;}
  if(matches.length>1){unmet.push({check_id:id,reasons:['DUPLICATE_CHECK_RESULT']});continue;}
  const result=matches[0]!,reasons:string[]=[];
  if(result.outcome!=='PASS')reasons.push(...(Array.isArray(result.reasons)&&result.reasons.length?result.reasons:['CHECK_NOT_PASSED']));
  if(!sourceObjectId||result.source_object_id!==sourceObjectId)reasons.push('STALE_SOURCE_REVISION');
  if(reasons.length)unmet.push({check_id:id,reasons});
 }
 for(const result of results)if(!registered.includes(result?.check_id))unmet.push({check_id:result?.check_id??null,reasons:['UNKNOWN_CHECK']});
 return {outcome:unmet.length?'FAIL':'PASS',unmet};
}
/** Policy or inputs that changed after admission make the run stale; its gate result is never recorded. */
export function assertSnapshotCurrent(admitted:{policy:unknown;inputs:unknown},current:{policy:unknown;inputs:unknown}):void{
 if(hash(current.policy)!==hash(admitted.policy))fail('QUALIFICATION_POLICY_STALE','Accepted proof registry changed during execution');
 if(canonical(current.inputs)!==canonical(admitted.inputs)){
  const before=admitted.inputs as Data,after=current.inputs as Data;
  const changed=[...new Set([...Object.keys(before??{}),...Object.keys(after??{})])].filter(key=>before?.[key]!==after?.[key]);
  fail('QUALIFICATION_INPUT_STALE','Inputs changed while independent verification ran: '+changed.join(','));
 }
}
/** Orchestrates actual remote sessions. No command or Git checkout runs on control. */
export async function runRegisteredChecks(ctx:ComponentContext,job:Data,snapshot:Data):Promise<Data>{
 const s:[string,string]=[job.organisation_id,job.run_id],owner=identity(ctx),remote=remoteExecutor(ctx);
 if(!Array.isArray(snapshot.policy?.checks)||snapshot.policy.checks.length===0)fail('QUALIFICATION_PROOF_INCOMPLETE','Empty registered command selection cannot qualify');
 const maxCheckMs=Number(ctx.env.HF_QUALIFICATION_MAX_CHECK_MS??'3600000');
 if(!Number.isSafeInteger(maxCheckMs)||maxCheckMs<100||maxCheckMs>259200000)
  fail('QUALIFICATION_POLICY_INVALID','Approved verification deadline is invalid');
 const leaseAbort=new AbortController(),signal=AbortSignal.any([invocation(ctx).signal,leaseAbort.signal]);
 let renewing=false;
 const heartbeat=setInterval(()=>{
  if(renewing)return;renewing=true;
  void renewJob(ctx,s,job.id,String(job.lease_generation),owner).catch(()=>leaseAbort.abort()).finally(()=>{renewing=false;});
 },60000);
 const results:Data[]=[];
 try{
  for(const check of snapshot.policy.checks as Data[]){
   if(signal.aborted)fail('QUALIFICATION_INTERRUPTED','Current verifier lease or invocation was lost');
   if(check.timeout_ms>maxCheckMs)fail('QUALIFICATION_BUDGET_EXCEEDED','Registered check exceeds approved runtime deadline');
   const prepared=await transaction(ctx,async client=>{
    const current=await lockJob(client,s,job.id);activeJob(current,owner,String(job.lease_generation));await executionGate(ctx,client,s,'ADVANCE');
    const observed=await verifyEnvironment(ctx,client,current,owner);
    if(observed.source_object_id!==snapshot.manifest.source_object_id||observed.source_tree_id!==snapshot.manifest.source_tree_id||
      observed.source_manifest_digest!==snapshot.manifest.source_manifest_digest||!/^sha256:[0-9a-f]{64}$/.test(observed.source_state_digest??'')||!observed.workspace_path||!observed.runner_session_id)
     fail('QUALIFICATION_SOURCE_MISMATCH','Actual verification workspace does not contain the submitted immutable result');
    const existing=await client.query('SELECT operation_id,session_id,plan_digest FROM hyperfide.assurance_check_intents WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 AND lease_generation=$4 AND check_id=$5',
     [...s,job.id,String(job.lease_generation),check.id]);
    const operationId=existing.rows[0]?.operation_id??randomUUID();
    const plan={session_id:observed.runner_session_id,operation_id:operationId,argv:check.argv,cwd:'.',
     environment:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},timeout_ms:check.timeout_ms,
     artifact_paths:check.required_artifacts,repository_id:snapshot.manifest.repository_id,reservation_id:owner.reservation_id,executable_digest:check.executable_digest,environment_digest:hash({LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}),
     source_digest:snapshot.manifest.source_manifest_digest,source_provenance_digest:snapshot.inputs.source,policy_digest:hash(snapshot.policy)};
    if(existing.rows[0]&&(existing.rows[0].plan_digest!==hash(plan)||existing.rows[0].session_id!==plan.session_id))
     fail('QUALIFICATION_IDEMPOTENCY_CONFLICT','Recorded remote check intent differs');
    const permit=await remote.prepare(client,invocation(ctx),plan);
    if(!existing.rows[0])await client.query('INSERT INTO hyperfide.assurance_check_intents(organisation_id,run_id,job_id,lease_generation,check_id,operation_id,session_id,plan_digest,plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
     [...s,job.id,String(job.lease_generation),check.id,operationId,plan.session_id,hash(plan),plan]);
    return {permit,plan,observed};
   });
   // prepare() has returned and its transaction committed before any remote process starts.
   const raw=await remote.execute(prepared.permit,signal) as Data;
   assertRemoteBinding(raw,{plan:prepared.plan,observed:prepared.observed,check,snapshot,sandbox_id:owner.sandbox_id,scope:s});
   const stdout=remoteBytes(raw.stdout),stderr=remoteBytes(raw.stderr),files:Data[]=[];
   if(!Array.isArray(raw.artifacts))fail('QUALIFICATION_REMOTE_OUTPUT_INCOMPLETE','Remote artifact inventory missing');
   for(const name of check.required_artifacts){
    const file=raw.artifacts.find((item:Data)=>item.path===name);
    if(!file){files.push({path:name,status:'MISSING'});continue;}
    try{
     const bytes=remoteBytes(file);
     if(bytes.length>MAX_OUTPUT)throw new Error();
     files.push({path:name,...await uploadBytes(ctx,s,bytes)});
    }catch{files.push({path:name,status:'MISSING_OR_INVALID'});}
   }
   const output={stdout:await uploadBytes(ctx,s,stdout),stderr:await uploadBytes(ctx,s,stderr)};
   const verdict=judgeCheck(raw,check.required_artifacts,files);
   results.push({check_id:check.id,source_object_id:snapshot.manifest.source_object_id,environment_digest:owner.environment_digest,
    executable_digest:check.executable_digest,command:commandRecord(check,prepared.plan,prepared.observed,raw),output,artifacts:files,outcome:verdict.outcome,reasons:verdict.reasons,
    input_keys:check.input_keys,input_manifest:snapshot.inputs,
    execution:{source_manifest_digest:snapshot.manifest.source_manifest_digest,source_state_digest:raw.source_state_digest,source_provenance_digest:snapshot.inputs.source,
     environment_digest:prepared.plan.environment_digest,assignment_environment_digest:owner.environment_digest,input_validation:prepared.observed.input_validation,
     preparation_digest:prepared.observed.preparation_digest,readiness_digest:prepared.observed.readiness_digest,
     provider_observation_id:prepared.observed.provider_observation_id,runner_credential_id:prepared.observed.runner_credential_id,workspace_path:prepared.observed.workspace_path,
     session_id:raw.session_id,operation_id:raw.operation_id,provider:raw.provider,
     native_resource_id:raw.native_resource_id,sandbox_id:raw.sandbox_id,boot_id:raw.boot_id,slot_id:raw.slot_id,slot_generation:String(raw.slot_generation),
     process_ref:raw.process_ref,start_identity:raw.start_identity,spool_digest:raw.spool_digest,cleanup_status:raw.cleanup_status,cleanup:raw.cleanup}});
  }
  const required=snapshot.policy.checks.map((c:Data)=>c.id),summary=qualificationOutcome(required,results,snapshot.manifest.source_object_id);
  return {schema_version:1,job_id:job.id,task_id:job.custody.task_id,source_attempt_id:job.custody.source_attempt_id,source_attempt_generation:String(job.custody.source_generation),lease_generation:String(job.lease_generation),custody_id:job.custody_id,
   custody_generation:String(job.custody_generation),rubric_digest:job.rubric_digest,registry_digest:hash(snapshot.policy),criteria_digest:snapshot.manifest.criteria_digest,
   source_manifest_digest:snapshot.manifest.source_manifest_digest,source_origin:snapshot.manifest.source_origin??'SUBMITTED_RESULT',input_manifest:snapshot.inputs,
   source_object_id:snapshot.manifest.source_object_id,verifier_id:owner.verifier_id,verifier_sandbox_id:owner.sandbox_id,verifier_boot_id:invocation(ctx).principal.boot_id,verifier_boot_generation:invocation(ctx).principal.boot_generation,
   environment_digest:owner.environment_digest,environment_digest_kind:'ASSIGNMENT_DESCRIPTOR',reservation_id:owner.reservation_id,allocation_id:owner.allocation_id,allocation_generation:owner.allocation_generation,
   required_check_ids:required,checks:results,unmet:summary.unmet,outcome:summary.outcome};
 }finally{clearInterval(heartbeat);}
}
async function execute(ctx:ComponentContext,raw:unknown):Promise<Data>{
 const v=fields(raw,['organisation_id','run_id','job_id','lease_generation']);
 const s=scope(ctx,v),id=uuid(v.job_id),generation=decimal(v.lease_generation),owner=identity(ctx);
 const admission=await transaction(ctx,async client=>{
  const job=await lockJob(client,s,id);
  const existing=await client.query('SELECT receipt,receipt_digest,evidence_id,receipt_artifact_id FROM hyperfide.assurance_job_receipts WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 AND lease_generation=$4',[...s,id,generation]);
  if(existing.rows[0]){
   const recorded=existing.rows[0].receipt;
   if(String(job.lease_generation)!==generation||recorded.verifier_id!==owner.verifier_id||recorded.verifier_sandbox_id!==owner.sandbox_id||
    recorded.verifier_boot_id!==invocation(ctx).principal.boot_id||hash(recorded)!==existing.rows[0].receipt_digest)
    fail('QUALIFICATION_STALE_JOB','Recorded result replay belongs to a different verifier/job generation');
   return {replayed:existing.rows[0]};
  }
  activeJob(job,owner,generation);await executionGate(ctx,client,s,'ADVANCE');
  await verifyEnvironment(ctx,client,job,owner);
  const operations=await client.query("SELECT * FROM hyperfide.requalification_operations WHERE organisation_id=$1 AND run_id=$2 AND qualification_job_id=$3 AND state='RUNNING'",[...s,id]);
  if(!operations.rows[0])currentCustody(job.custody,String(job.custody_generation));
  else if(!['ACTIVE','RELEASED'].includes(job.custody.authority))fail('QUALIFICATION_STALE_CUSTODY','Requalification disposition revoked');
  const submitted=await client.query('SELECT manifest,policy FROM hyperfide.assurance_submissions WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3',[...s,job.custody_id]);
  const preparedInputs=await inspectEffectiveResultInputs(client,{organisation_id:s[0],run_id:s[1]},{job_id:id});
  const applicability=await client.query('SELECT input_manifest FROM hyperfide.assurance_applicability WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3',[...s,job.custody_id]);
  if(!submitted.rows[0])fail('QUALIFICATION_MANIFEST_INVALID','Job has no immutable admitted submission');
  const currentPolicy=await loadPolicy(ctx,job.custody.task,client);
  if(operations.rows[0]){
   const requalified=await client.query('SELECT manifest,policy,input_manifest FROM hyperfide.assurance_requalification_inputs WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[...s,operations.rows[0].id]);
   if(!requalified.rows[0])fail('QUALIFICATION_MANIFEST_INVALID','Requalification immutable inputs missing');
   if(hash(currentPolicy)!==hash(requalified.rows[0].policy))fail('QUALIFICATION_POLICY_STALE','Accepted proof registry changed before execution');
   return {job,snapshot:{manifest:requalified.rows[0].manifest,policy:requalified.rows[0].policy,inputs:preparedInputs.input_manifest},requalification:operations.rows[0].id};
  }
  if(hash(currentPolicy)!==hash(submitted.rows[0].policy))fail('QUALIFICATION_POLICY_STALE','Accepted proof registry changed before execution');
  return {job,snapshot:{...submitted.rows[0],inputs:preparedInputs.input_manifest},requalification:operations.rows[0]?.id};
 });
 if(admission.replayed)return {...admission.replayed,replayed:true,task_qualified:false};
 const receipt=await runRegisteredChecks(ctx,admission.job!,admission.snapshot!),receiptDigest=hash(receipt);
 const receiptArtifact=await uploadBytes(ctx,s,Buffer.from(canonical(receipt)));
 return transaction(ctx,async client=>{
  const job=await lockJob(client,s,id);activeJob(job,owner,generation);await executionGate(ctx,client,s,'ADVANCE');
  await verifyEnvironment(ctx,client,job,owner);
  if(!admission.requalification)currentCustody(job.custody,String(job.custody_generation));
  else if(!['ACTIVE','RELEASED'].includes(job.custody.authority))fail('QUALIFICATION_STALE_CUSTODY','Requalification disposition revoked');
  const current=await client.query('SELECT input_manifest FROM hyperfide.assurance_applicability WHERE organisation_id=$1 AND run_id=$2 AND custody_id=$3 FOR UPDATE',[...s,job.custody_id]);
  assertSnapshotCurrent(admission.snapshot!,{policy:await loadPolicy(ctx,job.custody.task,client),inputs:current.rows[0]?.input_manifest});
  const evidenceId=randomUUID();
  await client.query('SELECT hyperfide.require_complete_artifact($1,$2,$3)',[...s,receiptArtifact.artifact_id]);
  await client.query("INSERT INTO hyperfide.evidence(organisation_id,run_id,id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest,manifest_digest,artifact_id,admission_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ADMITTED')",
   [...s,evidenceId,job.custody.source_attempt_id,String(job.custody.source_generation),job.custody.repository_id,
    receipt.source_object_id,receipt.criteria_digest,receiptDigest,receiptArtifact.artifact_id]);
  for(const check of receipt.checks)for(const ref of [check.output.stdout,check.output.stderr,...check.artifacts]){
   if(ref.artifact_id)await client.query("INSERT INTO hyperfide.evidence_artifacts(organisation_id,run_id,evidence_id,artifact_id,role) VALUES($1,$2,$3,$4,'independent-qualification-output') ON CONFLICT DO NOTHING",[...s,evidenceId,ref.artifact_id]);
  }
  await client.query("INSERT INTO hyperfide.assurance_job_receipts(organisation_id,run_id,job_id,lease_generation,verifier_id,environment_digest,receipt_digest,evidence_id,receipt_artifact_id,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
   [...s,id,generation,owner.verifier_id,owner.environment_digest,receiptDigest,evidenceId,receiptArtifact.artifact_id,receipt]);
  const released=await jobResources(ctx).releaseJobAllocation(client,{organisation_id:s[0],run_id:s[1],reservation_id:owner.reservation_id,
   allocation_id:owner.allocation_id,allocation_generation:owner.allocation_generation,assignee_session_id:owner.verifier_id});
  if(!['RELEASE_PENDING','RELEASED'].includes(released.state))fail('QUALIFICATION_CAPACITY_UNAVAILABLE','Independent allocation logical release was not recorded');
  await client.query("UPDATE hyperfide.qualification_jobs SET state=$4,outcome=$5,lease_owner=NULL,lease_expires_at=NULL,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...s,id,receipt.outcome==='PASS'?'SUCCEEDED':'FAILED',receipt.outcome]);
  if(admission.requalification)await client.query("UPDATE hyperfide.requalification_operations SET state=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...s,admission.requalification,receipt.outcome==='PASS'?'SUCCEEDED':'FAILED']);
  // Gate PASS is evidence only; clause coverage and custody acceptance are a distinct fenced transition.
  return {receipt,receipt_digest:receiptDigest,evidence_id:evidenceId,allocation_state:released.state,resources_still_counted:released.resources_still_counted,replayed:false,task_qualified:false};
 });
}
export async function verifyStoredReceiptArtifacts(ctx:ComponentContext,s:[string,string],receipt:Data):Promise<void>{
 const seen=new Set<string>();
 for(const check of receipt.checks??[])for(const ref of [check.output?.stdout,check.output?.stderr,...(check.artifacts??[])]){
  if(!ref?.artifact_id||seen.has(ref.artifact_id))continue;
  seen.add(ref.artifact_id);
  const checked=await artifact(ctx,'artifact.object.inspect',{organisation_id:s[0],run_id:s[1],artifact_id:ref.artifact_id});
  if(checked.artifact.digest!==ref.digest||String(checked.artifact.size_bytes)!==String(ref.manifest_size_bytes??ref.size_bytes))fail('QUALIFICATION_ARTIFACT_INCOMPLETE','Accepted execution artifact identity changed');
  if(ref.storage_kind==='CHUNK_MANIFEST'){
   const manifest=await artifact(ctx,'artifact.manifest.read',{organisation_id:s[0],run_id:s[1],artifact_id:ref.artifact_id});
   if(manifest.manifest?.content_digest!==ref.content_digest||String(manifest.manifest?.total_size_bytes)!==ref.size_bytes)
    fail('QUALIFICATION_ARTIFACT_INCOMPLETE','Captured stream manifest content identity differs');
  }
 }
}
export async function verifyReceiptRecordArtifacts(ctx:ComponentContext,s:[string,string],record:Data):Promise<void>{
 await verifyStoredReceiptArtifacts(ctx,s,record.receipt);
 const stored=await artifact(ctx,'artifact.object.inspect',{organisation_id:s[0],run_id:s[1],artifact_id:record.receipt_artifact_id});
 if(stored.artifact.digest!==record.receipt_digest){
  const manifest=await artifact(ctx,'artifact.manifest.read',{organisation_id:s[0],run_id:s[1],artifact_id:record.receipt_artifact_id});
  if(manifest.manifest?.content_digest!==record.receipt_digest)fail('QUALIFICATION_ARTIFACT_INCOMPLETE','Immutable execution receipt content digest differs');
 }
}
export async function inspectExecutionReceipt(db:PrimaryClient,
 s:{organisation_id:string;run_id:string},jobId:string,generation:string):Promise<Data>{
 await assuranceBarrier(db,s,'SHARED');
 const result=await db.query("SELECT j.id,j.custody_id,j.custody_generation,j.state,j.outcome,j.rubric_digest,j.lease_generation,c.task_id,c.source_attempt_id,c.source_generation,"
 +"p.receipt,p.receipt_digest,p.evidence_id,p.receipt_artifact_id,p.verifier_id,p.environment_digest FROM hyperfide.qualification_jobs j "
 +"JOIN hyperfide.submission_custodies c ON c.organisation_id=j.organisation_id AND c.run_id=j.run_id AND c.id=j.custody_id "
 +"JOIN hyperfide.assurance_job_receipts p ON p.organisation_id=j.organisation_id AND p.run_id=j.run_id AND p.job_id=j.id "
 +"WHERE j.organisation_id=$1 AND j.run_id=$2 AND j.id=$3 AND p.lease_generation=$4",
 [s.organisation_id,s.run_id,uuid(jobId),decimal(generation)]);
 const row=result.rows[0];
 if(!row||hash(row.receipt)!==row.receipt_digest||row.receipt.job_id!==jobId||
 row.receipt.lease_generation!==generation||row.receipt.custody_id!==row.custody_id||
 row.receipt.task_id!==row.task_id||row.receipt.source_attempt_id!==row.source_attempt_id||String(row.receipt.source_attempt_generation)!==String(row.source_generation)||
 String(row.receipt.custody_generation)!==String(row.custody_generation)||
 row.receipt.rubric_digest!==row.rubric_digest||row.receipt.verifier_id!==row.verifier_id||
 row.receipt.environment_digest!==row.environment_digest)
  fail('QUALIFICATION_RECEIPT_INVALID','Actual server-generated execution receipt is missing or does not bind its job');
 return {job_id:row.id,task_id:row.task_id,source_attempt_id:row.source_attempt_id,source_attempt_generation:String(row.source_generation),custody_id:row.custody_id,custody_generation:String(row.custody_generation),
  lease_generation:generation,current_job_generation:String(row.lease_generation),receipt_is_current:String(row.lease_generation)===generation,
  state:row.state,outcome:row.outcome,source_origin:row.receipt.source_origin,receipt_digest:row.receipt_digest,evidence_id:row.evidence_id,receipt_artifact_id:row.receipt_artifact_id,receipt:row.receipt,
  qualification:'NOT_GRANTED',preparation_readiness:'NOT_EVALUATED'};
}
/** Read-only access to actual server-owned verifier execution observations.
 * This does not grant task qualification or authenticate privileged migration jobs. */
export async function inspectExecution(ctx:ComponentContext,raw:unknown):Promise<Data>{
 roles(ctx,['OPERATOR','COORDINATOR','VERIFIER','INTEGRATOR']);
 const v=fields(raw,['organisation_id','run_id','job_id','lease_generation']),s=scope(ctx,v);
 return transaction(ctx,db=>inspectExecutionReceipt(db,{organisation_id:s[0],run_id:s[1]},uuid(v.job_id),decimal(v.lease_generation)),false,'READ');
}
const FORCED_STATUS=/^(done|complete|completed|passed|pass|qualified|accepted|green|succeeded|success|closed|merged)$/i;
/** Names what a legacy claim asserts. Every signal stays historical: none is a gate receipt or releases dependent work. */
export function classifyLegacyClaim(claim:unknown):Data{
 const signals=new Set<string>();
 const visit=(value:unknown,key:string,depth:number):void=>{
  if(depth>8)return;
  if(Array.isArray(value)){for(const item of value)visit(item,key,depth+1);return;}
  if(value&&typeof value==='object'){for(const [name,item] of Object.entries(value as Data))visit(item,name.toLowerCase(),depth+1);return;}
  if(/status|state/.test(key)&&typeof value==='string'&&FORCED_STATUS.test(value.trim()))signals.add('FORCED_STATUS');
  if(/force|override|skip/.test(key)&&value===true)signals.add('FORCE_FLAG');
  if(/pass|qualified|success|done/.test(key)&&value===true)signals.add('ASSERTED_PASS');
  if(/proof|evidence|summary|notes?|log/.test(key)&&typeof value==='string'&&value.trim())signals.add('PROOF_TEXT');
  if(/message|comment|claim/.test(key)&&typeof value==='string'&&value.trim())signals.add('AGENT_MESSAGE');
  if(/exit/.test(key)&&value===0)signals.add('UNBOUND_EXIT_STATUS');
 };
 visit(claim,'',0);
 return {qualification:'HISTORY_ONLY',authoritative:false,releases_dependent_work:false,signals:[...signals].sort(),
  reason:'Legacy status, proof text, force flags and unbound exit codes are history; only a server-executed gate receipt with accepted coverage qualifies'};
}
async function importHistory(ctx:ComponentContext,raw:unknown):Promise<Data>{
 roles(ctx,['COORDINATOR','OPERATOR']);
 const v=fields(raw,['organisation_id','run_id','task_id','provenance','legacy_claim']),s=scope(ctx,v);
 uuid(v.task_id);
 if(typeof v.provenance!=='string'||!v.provenance.trim()||v.provenance.length>2048||!v.legacy_claim||typeof v.legacy_claim!=='object')
  fail('QUALIFICATION_INPUT_INVALID','Legacy claims require provenance and remain historical');
 await transaction(ctx,db=>db.query('INSERT INTO hyperfide.assurance_history(organisation_id,run_id,task_id,provenance,legacy_claim) VALUES($1,$2,$3,$4,$5)',[...s,v.task_id,v.provenance,v.legacy_claim]));
 return {imported:true,...classifyLegacyClaim(v.legacy_claim)};
}
const RELEASING_STATES=['QUALIFIED','INTEGRATING','INTEGRATED'];
/** Distinguishes forced historical task status and imported claims from current server-executed evidence. */
export async function inspectQualificationHistory(db:PrimaryClient,s:{organisation_id:string;run_id:string},taskId:string):Promise<Data>{
 await assuranceBarrier(db,s,'SHARED');
 const scopeValues=[uuid(s.organisation_id),uuid(s.run_id),uuid(taskId)];
 const task=(await db.query("SELECT state,definition->>'declared_status' AS declared_status,definition->'history_only' AS history_only FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3",scopeValues)).rows[0];
 if(!task)fail('QUALIFICATION_NOT_FOUND','Task not found');
 const history=(await db.query('SELECT legacy_claim FROM hyperfide.assurance_history WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 ORDER BY imported_at,id LIMIT 1001',scopeValues)).rows;
 const receipts=(await db.query("SELECT count(*) FILTER (WHERE p.receipt->>'outcome'='PASS')::text AS passing,count(*)::text AS total FROM hyperfide.assurance_job_receipts p "
  +"JOIN hyperfide.qualification_jobs j ON j.organisation_id=p.organisation_id AND j.run_id=p.run_id AND j.id=p.job_id "
  +"JOIN hyperfide.submission_custodies c ON c.organisation_id=j.organisation_id AND c.run_id=j.run_id AND c.id=j.custody_id "
  +"WHERE p.organisation_id=$1 AND p.run_id=$2 AND c.task_id=$3",scopeValues)).rows[0];
 const dependents=(await db.query("SELECT task_id FROM hyperfide.task_dependencies WHERE organisation_id=$1 AND predecessor_run_id=$2 AND predecessor_task_id=$3 AND milestone='QUALIFIED' ORDER BY task_id LIMIT 1001",scopeValues)).rows.map(row=>row.task_id as string);
 const qualified=RELEASING_STATES.includes(task.state);
 const signals=new Set<string>();
 if(typeof task.declared_status==='string'&&FORCED_STATUS.test(task.declared_status.trim()))signals.add('FORCED_DECLARED_STATUS');
 for(const row of history)for(const signal of classifyLegacyClaim(row.legacy_claim).signals)signals.add(signal);
 return {task_id:taskId,task_state:task.state,qualified,
  historical:{declared_status:task.declared_status??null,history_only:true,imported_claims:history.length,signals:[...signals].sort(),authoritative:false},
  current_evidence:{receipts:String(receipts?.total??'0'),passing_receipts:String(receipts?.passing??'0'),task_qualified:qualified},
  releases_dependent_work:qualified,blocked_dependents:qualified?[]:dependents};
}
async function inspectHistory(ctx:ComponentContext,raw:unknown):Promise<Data>{
 roles(ctx,['OPERATOR','COORDINATOR','VERIFIER','INTEGRATOR']);
 const v=fields(raw,['organisation_id','run_id','task_id']),s=scope(ctx,v);
 return transaction(ctx,db=>inspectQualificationHistory(db,{organisation_id:s[0],run_id:s[1]},uuid(v.task_id)),false,'READ');
}
export function createComponent(ctx:ComponentContext):Component & {capabilities:Record<string,unknown>}{
 const unregister=ctx.dependencies?registerQualificationInputReader(ctx):undefined;
 const producer=ctx.dependencies?resultInputProducer(ctx):undefined;
 return {apiVersion:1,close:async()=>{unregister?.();producer?.close();},capabilities:{'assurance.execution.v1':Object.freeze({inspectExecutionReceipt})},actions:{
  'qualification.execution.inspect':(raw,requestContext)=>inspectExecution(requestContext,raw),
  'qualification.preparation.execute':(raw,requestContext)=>producer!.execute(requestContext,raw),
  'qualification.preparation.plan':(raw,requestContext)=>planResultPreparation(requestContext,raw),
  'qualification.preparation.inspect':(raw,requestContext)=>inspectResultPreparation(requestContext,raw),
  'qualification.job.assign':(raw,requestContext)=>assignJob(requestContext,raw),
  'qualification.job.claim':(raw,requestContext)=>claimJob(requestContext,raw),
  'qualification.execute':(raw,requestContext)=>execute(requestContext,raw),
  'qualification.history.import':(raw,requestContext)=>importHistory(requestContext,raw),
  'qualification.history.inspect':(raw,requestContext)=>inspectHistory(requestContext,raw)
 }};
}
