import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {InvocationContext,Principal} from '../transport/protocol.js';
import {DIGEST,decimal,exact,fail,hash,uuid} from '../transport/protocol.js';
import {object} from '../policy/programme.js';
import {runnerCanonical} from './bridge.js';

/* Runner control semantics (execution-contract §5.1, req 12 ac_4).
 *  pause  PAUSING->PAUSED     fence input and new jobs, freeze (SIGSTOP) the slot tree; resumable.
 *  drain  DRAINING->DRAINED   admit nothing new, let in-flight work finish; by policy terminate at deadline.
 *  cancel CANCELLING->CANCELLED fence publication, revoke leases/credentials, kill without grace; work is discarded.
 *  stop   STOPPING->STOPPED   fence publication, revoke, TERM with grace then KILL; outputs kept for a fresh attempt.
 *  resume PAUSED/DRAINED->RUNNING as a new explicit command against current state.
 * Termination is CONFIRMED only by an observed empty slot-UID tree; otherwise UNRESOLVED. */
export const RUNNER_CONTROL_ACTIONS=Object.freeze(['runner.pause','runner.drain','runner.cancel','runner.stop','runner.resume'] as const);
export type RunnerControlAction=typeof RUNNER_CONTROL_ACTIONS[number];
const OUTCOMES:Record<RunnerControlAction,readonly string[]>={'runner.pause':['PAUSED','UNRESOLVED'],'runner.drain':['DRAINING','DRAINED','UNRESOLVED'],'runner.cancel':['CANCELLED','UNRESOLVED'],'runner.stop':['STOPPED','UNRESOLVED'],'runner.resume':['RESUMED','UNRESOLVED']};
const FINAL=['PAUSED','DRAINED','CANCELLED','STOPPED','RESUMED'];
const TERMINATION:Record<string,string>={PAUSED:'FROZEN',DRAINED:'CONFIRMED',CANCELLED:'CONFIRMED',STOPPED:'CONFIRMED',RESUMED:'NOT_REQUIRED',DRAINING:'NOT_REQUIRED',UNRESOLVED:'UNRESOLVED'};
const TERMINATING=['runner.cancel','runner.stop'];
export const OUTPUT_NAME=/^(launch\.stdout|launch\.stderr|job\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.receipt)$/;

export interface RunnerControlPolicy {grace_ms:number;drain_deadline_ms:number;on_drain_deadline:'STOP'|'REPORT'}
function policyOf(v:unknown):RunnerControlPolicy{
 if(!object(v))fail('INVALID_CONTROL_COMMAND','Explicit control policy required');
 exact(v,['grace_ms','drain_deadline_ms','on_drain_deadline']);
 if(!Number.isSafeInteger(v.grace_ms)||Number(v.grace_ms)<0||Number(v.grace_ms)>600000||!Number.isSafeInteger(v.drain_deadline_ms)||Number(v.drain_deadline_ms)<1||Number(v.drain_deadline_ms)>86400000||!['STOP','REPORT'].includes(String(v.on_drain_deadline)))fail('INVALID_CONTROL_COMMAND','Bounded grace, drain deadline and deadline policy required');
 return {grace_ms:Number(v.grace_ms),drain_deadline_ms:Number(v.drain_deadline_ms),on_drain_deadline:v.on_drain_deadline as 'STOP'|'REPORT'};
}
function scope(p:Principal):{organisation_id:string;run_id:string}{return {organisation_id:p.organisation_id,run_id:p.run_id};}
function role(i:InvocationContext,roles:readonly string[]):void{if(!roles.includes(i.principal.role))fail('ROLE_DENIED','Control role required: '+roles.join('|'));}
export function commandView(row:Record<string,any>):Record<string,unknown>{
 return {command_id:row.command_id,action:row.action,launch_id:row.launch_id,slot_id:row.slot_id,sandbox_id:row.sandbox_id,boot_id:row.boot_id,boot_generation:String(row.boot_generation),attempt_id:row.attempt_id,attempt_generation:String(row.attempt_generation),authority_epoch:row.authority_epoch,fence_sequence:String(row.fence_sequence),policy:row.policy,required_outputs:row.required_outputs,state:row.state,delivery_count:String(row.delivery_count),outcome:row.outcome??null,termination:row.termination??null,cleanup_complete:row.cleanup_complete??null,report_digest:row.report_digest??null};
}
async function lockLaunch(tx:PrimaryTransaction,s:{organisation_id:string;run_id:string},launch:string):Promise<void>{
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['runner-control:'+s.organisation_id+':'+s.run_id+':'+launch]);
}
async function load(tx:PrimaryTransaction,s:{organisation_id:string;run_id:string},command:string,lock=false):Promise<Record<string,any>|undefined>{
 return (await tx.query('SELECT * FROM hyperfide.runner_control_commands WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3'+(lock?' FOR UPDATE':''),[s.organisation_id,s.run_id,command])).rows[0];
}

/** Coordinator-issued control. Cancel/stop raise the publication fence and revoke
 * the attempt's compute leases and worker credentials in this same transaction,
 * so no replacement attempt can be admitted to publish before the fence exists. */
export async function issueRunnerControl(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);role(i,['OPERATOR','COORDINATOR']);
 exact(v,['command_id','action','launch_id','slot_id','sandbox_id','boot_generation','attempt_id','attempt_generation','policy','required_outputs']);
 if(![v.command_id,v.launch_id,v.slot_id,v.sandbox_id,v.attempt_id].every(uuid)||!RUNNER_CONTROL_ACTIONS.includes(v.action as RunnerControlAction)||!decimal(v.boot_generation,true)||!decimal(v.attempt_generation,true)||!Array.isArray(v.required_outputs)||v.required_outputs.length>16||v.required_outputs.some(n=>typeof n!=='string'||!OUTPUT_NAME.test(n))||new Set(v.required_outputs).size!==v.required_outputs.length)fail('INVALID_CONTROL_COMMAND','Exact control target, generation and bounded required outputs required');
 const policy=policyOf(v.policy),s=scope(i.principal),action=v.action as RunnerControlAction,digest=hash(runnerCanonical(v));
 await lockLaunch(tx,s,v.launch_id as string);
 const prior=await load(tx,s,v.command_id as string);
 if(prior){if(prior.request_digest!==digest)fail('CONTROL_COMMAND_CONFLICT','Command identity was already issued with different bytes');return {...commandView(prior),replayed:true};}
 const boot=(await tx.query('SELECT b.boot_id FROM hyperfide.sandboxes s JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation WHERE s.organisation_id=$1 AND s.id=$2 AND s.boot_generation=$3 FOR SHARE OF s,b',[s.organisation_id,v.sandbox_id,v.boot_generation])).rows[0];
 if(!boot)fail('CONTROL_TARGET_BOOT_STALE','Control must target the current sandbox boot generation');
 const history=(await tx.query("SELECT COALESCE(max(fence_sequence),0)::text AS fence,COALESCE(max(attempt_generation),0)::text AS generation,bool_or(action IN('runner.cancel','runner.stop') AND state<>'SUPERSEDED') AS terminating,(array_agg(action ORDER BY fence_sequence DESC))[1] AS latest FROM hyperfide.runner_control_commands WHERE organisation_id=$1 AND run_id=$2 AND launch_id=$3",[s.organisation_id,s.run_id,v.launch_id])).rows[0]!;
 if(BigInt(v.attempt_generation as string)<BigInt(history.generation))fail('CONTROL_ATTEMPT_GENERATION_STALE','A newer attempt generation already owns this launch');
 if(history.terminating&&!TERMINATING.includes(action))fail('CONTROL_LAUNCH_TERMINATING','Cancel/stop already fences this launch; only terminal commands may follow');
 if(action==='runner.resume'&&!['runner.pause','runner.drain'].includes(String(history.latest)))fail('CONTROL_RESUME_STATE_INVALID','Resume applies only to a paused or drained launch');
 const fence=String(BigInt(history.fence)+1n);
 await tx.query("UPDATE hyperfide.runner_control_commands SET state='SUPERSEDED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND launch_id=$3 AND (state IN('ISSUED','DELIVERED') OR state='REPORTED' AND outcome IN('DRAINING','UNRESOLVED'))",[s.organisation_id,s.run_id,v.launch_id]);
 const row=(await tx.query('INSERT INTO hyperfide.runner_control_commands(organisation_id,run_id,command_id,action,launch_id,slot_id,sandbox_id,boot_id,boot_generation,attempt_id,attempt_generation,authority_epoch,fence_sequence,policy,required_outputs,request_digest,issued_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *',[s.organisation_id,s.run_id,v.command_id,action,v.launch_id,v.slot_id,v.sandbox_id,boot.boot_id,v.boot_generation,v.attempt_id,v.attempt_generation,i.principal.deployment_epoch,fence,JSON.stringify(policy),JSON.stringify(v.required_outputs),digest,i.principal.credential_id])).rows[0]!;
 let revocation:Record<string,unknown>|null=null;
 if(TERMINATING.includes(action)){
  const leases=await tx.query("UPDATE hyperfide.compute_leases SET state='REVOKED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND attempt_generation<=$4 AND state='ACTIVE'",[s.organisation_id,s.run_id,v.attempt_id,v.attempt_generation]);
  const credentials=await tx.query("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND attempt_generation<=$4 AND state='ACTIVE'",[s.organisation_id,s.run_id,v.attempt_id,v.attempt_generation]);
  const fenced=(await tx.query('INSERT INTO hyperfide.runner_publication_fences(organisation_id,run_id,attempt_id,fenced_generation,launch_id,command_id,leases_revoked,credentials_revoked) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organisation_id,run_id,attempt_id) DO UPDATE SET fenced_generation=GREATEST(hyperfide.runner_publication_fences.fenced_generation,EXCLUDED.fenced_generation),launch_id=EXCLUDED.launch_id,command_id=EXCLUDED.command_id,leases_revoked=hyperfide.runner_publication_fences.leases_revoked+EXCLUDED.leases_revoked,credentials_revoked=hyperfide.runner_publication_fences.credentials_revoked+EXCLUDED.credentials_revoked,updated_at=clock_timestamp() RETURNING fenced_generation::text',[s.organisation_id,s.run_id,v.attempt_id,v.attempt_generation,v.launch_id,v.command_id,leases.rowCount??0,credentials.rowCount??0])).rows[0]!;
  revocation={publication_fenced:true,fenced_generation:fenced.fenced_generation,leases_revoked:String(leases.rowCount??0),credentials_revoked:String(credentials.rowCount??0)};
 }
 return {...commandView(row),replayed:false,revocation};
}

/** Exported publication guard: an attempt generation at or below a raised fence never publishes. */
export async function assertRunnerPublicationAllowed(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;attempt_id:string;attempt_generation:string}):Promise<{fenced_generation:string|null}>{
 assertPrimaryTransaction(tx);
 if(!uuid(input.organisation_id)||!uuid(input.run_id)||!uuid(input.attempt_id)||!decimal(input.attempt_generation,true))fail('INVALID_REQUEST','Exact attempt generation required');
 const row=(await tx.query('SELECT fenced_generation::text FROM hyperfide.runner_publication_fences WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 FOR SHARE',[input.organisation_id,input.run_id,input.attempt_id])).rows[0];
 if(row&&BigInt(input.attempt_generation)<=BigInt(row.fenced_generation))fail('RUNNER_PUBLICATION_FENCED','Cancelled/stopped attempt generation cannot publish');
 return {fenced_generation:row?.fenced_generation??null};
}

/** The bound runner fetches current coordinator authority over the 12.1 transport. */
export async function authorizeRunnerControl(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);role(i,['RUNNER']);exact(v,['command_id','launch_id','action']);
 if(!uuid(v.command_id)||!uuid(v.launch_id)||!RUNNER_CONTROL_ACTIONS.includes(v.action as RunnerControlAction))fail('INVALID_CONTROL_COMMAND','Exact command, launch and action required');
 const p=i.principal,s=scope(p);await lockLaunch(tx,s,v.launch_id as string);
 const row=await load(tx,s,v.command_id as string,true);
 if(!row)fail('CONTROL_COMMAND_UNKNOWN','No coordinator issued this command');
 if(row.action!==v.action||row.launch_id!==v.launch_id)fail('CONTROL_COMMAND_MISMATCH','Command differs from the requested native action or launch');
 if(row.sandbox_id!==p.sandbox_id||row.boot_id!==p.boot_id||String(row.boot_generation)!==p.boot_generation)fail('CONTROL_SCOPE_DENIED','Command targets another sandbox boot');
 if(row.authority_epoch!==p.deployment_epoch)fail('CONTROL_AUTHORITY_STALE','Command belongs to a superseded run authority');
 if(row.state==='SUPERSEDED')fail('CONTROL_COMMAND_SUPERSEDED','A newer command owns this launch');
 const latest=(await tx.query('SELECT max(fence_sequence)::text AS fence FROM hyperfide.runner_control_commands WHERE organisation_id=$1 AND run_id=$2 AND launch_id=$3',[s.organisation_id,s.run_id,row.launch_id])).rows[0]!;
 const updated=(await tx.query("UPDATE hyperfide.runner_control_commands SET state=CASE WHEN state='ISSUED' THEN 'DELIVERED' ELSE state END,delivery_count=delivery_count+1,delivered_at=COALESCE(delivered_at,clock_timestamp()),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 RETURNING *",[s.organisation_id,s.run_id,row.command_id])).rows[0]!;
 const fence=(await tx.query('SELECT fenced_generation::text,leases_revoked::text,credentials_revoked::text FROM hyperfide.runner_publication_fences WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3',[s.organisation_id,s.run_id,row.attempt_id])).rows[0];
 return {...commandView(updated),latest_fence_sequence:latest.fence,publication_fence:fence?{fenced_generation:fence.fenced_generation,leases_revoked:fence.leases_revoked,credentials_revoked:fence.credentials_revoked}:null,authority:'CURRENT_COORDINATOR_COMMAND'};
}

async function captures(tx:PrimaryTransaction,s:{organisation_id:string;run_id:string},command:string):Promise<Record<string,any>[]>{
 return (await tx.query('SELECT name,state,total_digest,total_size_bytes::text,manifest_artifact_id,manifest_digest,receipt_digest FROM hyperfide.runner_output_captures WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 ORDER BY name',[s.organisation_id,s.run_id,command])).rows;
}
async function outputsDurable(tx:PrimaryTransaction,s:{organisation_id:string;run_id:string},row:Record<string,any>):Promise<string[]>{
 const complete=new Set((await captures(tx,s,row.command_id)).filter(c=>c.state==='COMPLETE').map(c=>c.name));
 return (row.required_outputs as string[]).filter(name=>!complete.has(name));
}

/** Runner-reported outcome. Final outcomes are immutable except for a later proof
 * that cleanup completed; stop/cancel never claim completion without captures. */
export async function reportRunnerControl(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);role(i,['RUNNER']);
 exact(v,['command_id','outcome','termination','remaining_descendants','cleanup_complete','cleanup_debt','credential_revocation','receipt_digest']);
 if(!uuid(v.command_id)||typeof v.outcome!=='string'||typeof v.termination!=='string'||!Number.isSafeInteger(v.remaining_descendants)||Number(v.remaining_descendants)<-1||typeof v.cleanup_complete!=='boolean'||!Array.isArray(v.cleanup_debt)||v.cleanup_debt.length>64||v.cleanup_debt.some(x=>typeof x!=='string'||!/^[A-Z][A-Z0-9_:.-]{0,127}$/.test(x))||!Array.isArray(v.credential_revocation)||v.credential_revocation.length>256||typeof v.receipt_digest!=='string'||!DIGEST.test(v.receipt_digest))fail('INVALID_CONTROL_REPORT','Bounded control report required');
 for(const item of v.credential_revocation as unknown[])if(!object(item)||typeof item.name!=='string'||item.name.length>256||!['REVOKED','UNRESOLVED','ABSENT'].includes(String(item.state)))fail('INVALID_CONTROL_REPORT','Credential revocation entries must be explicit');
 const p=i.principal,s=scope(p),row=await load(tx,s,v.command_id as string,true);
 if(!row)fail('CONTROL_COMMAND_UNKNOWN','No coordinator issued this command');
 if(row.sandbox_id!==p.sandbox_id||row.boot_id!==p.boot_id||String(row.boot_generation)!==p.boot_generation)fail('CONTROL_SCOPE_DENIED','Command targets another sandbox boot');
 if(!OUTCOMES[row.action as RunnerControlAction].includes(v.outcome))fail('CONTROL_REPORT_CONTRADICTION','Outcome is not a valid result of this control action');
 if(TERMINATION[v.outcome]!==v.termination)fail('CONTROL_REPORT_CONTRADICTION','Termination evidence contradicts the reported outcome');
 if(['CANCELLED','STOPPED','DRAINED'].includes(v.outcome)&&v.remaining_descendants!==0)fail('CONTROL_REPORT_CONTRADICTION','Confirmed termination requires an observed empty tree');
 const unresolvedCredentials=(v.credential_revocation as Record<string,unknown>[]).some(c=>c.state==='UNRESOLVED');
 if(v.cleanup_complete){
  const missing=await outputsDurable(tx,s,row);
  if(missing.length||unresolvedCredentials||v.termination!=='CONFIRMED'||(v.cleanup_debt as unknown[]).length)fail('CONTROL_CLEANUP_UNPROVEN','Cleanup completion requires confirmed termination, revoked credentials and complete durable required outputs: '+missing.join(','));
 }
 const report={outcome:v.outcome,termination:v.termination,remaining_descendants:v.remaining_descendants,cleanup_complete:v.cleanup_complete,cleanup_debt:v.cleanup_debt,credential_revocation:v.credential_revocation,receipt_digest:v.receipt_digest},digest=hash(runnerCanonical(report));
 if(row.report_digest===digest)return {...commandView(row),replayed:true};
 if(row.outcome&&FINAL.includes(row.outcome)&&!(row.outcome===v.outcome&&row.cleanup_complete===false&&v.cleanup_complete===true))fail('CONTROL_REPORT_CONFLICT','A different final outcome is already recorded for this command');
 const updated=(await tx.query("UPDATE hyperfide.runner_control_commands SET state=CASE WHEN state='SUPERSEDED' THEN state ELSE 'REPORTED' END,outcome=$4,termination=$5,cleanup_complete=$6,report=$7,report_digest=$8,reported_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 RETURNING *",[s.organisation_id,s.run_id,row.command_id,v.outcome,v.termination,v.cleanup_complete,JSON.stringify(report),digest])).rows[0]!;
 return {...commandView(updated),replayed:false};
}

export async function inspectRunnerControl(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);role(i,['OPERATOR','COORDINATOR','RUNNER']);exact(v,['command_id']);
 if(!uuid(v.command_id))fail('INVALID_REQUEST','Command identity required');
 const s=scope(i.principal),row=await load(tx,s,v.command_id as string);if(!row)fail('CONTROL_COMMAND_UNKNOWN','No coordinator issued this command');
 const fence=(await tx.query('SELECT fenced_generation::text,command_id,leases_revoked::text,credentials_revoked::text FROM hyperfide.runner_publication_fences WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3',[s.organisation_id,s.run_id,row.attempt_id])).rows[0]??null;
 return {...commandView(row),report:row.report??null,captures:await captures(tx,s,row.command_id),missing_outputs:await outputsDurable(tx,s,row),publication_fence:fence};
}

/* Slot workspace reuse: FREE -> LEASED -> CLEANING -> FREE. Reuse waits for
 * observed process and credential residue absence plus durable required outputs. */
const WORKSPACE='SELECT sandbox_id,boot_generation::text,slot_id,slot_generation::text,state,launch_id,command_id,process_residue,credential_residue,outputs_durable,residue_evidence_digest,state_version::text FROM hyperfide.runner_workspaces';
export async function registerRunnerWorkspace(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);role(i,['RUNNER']);exact(v,['slot_id','slot_generation']);
 if(!uuid(v.slot_id)||!decimal(v.slot_generation,true))fail('INVALID_REQUEST','Exact slot identity required');
 const p=i.principal;if(!uuid(p.sandbox_id)||!decimal(p.boot_generation,true))fail('ROLE_DENIED','Boot-bound runner required');
 await tx.query('INSERT INTO hyperfide.runner_workspaces(organisation_id,run_id,sandbox_id,boot_generation,slot_id,slot_generation,registered_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[p.organisation_id,p.run_id,p.sandbox_id,p.boot_generation,v.slot_id,v.slot_generation,p.credential_id]);
 const row=(await tx.query(WORKSPACE+' WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND boot_generation=$4 AND slot_id=$5',[p.organisation_id,p.run_id,p.sandbox_id,p.boot_generation,v.slot_id])).rows[0]!;
 return {...row,reusable:row.state==='FREE'};
}
export async function leaseRunnerWorkspace(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);role(i,['OPERATOR','COORDINATOR']);exact(v,['sandbox_id','boot_generation','slot_id','launch_id','expected_slot_generation']);
 if(![v.sandbox_id,v.slot_id,v.launch_id].every(uuid)||!decimal(v.boot_generation,true)||!decimal(v.expected_slot_generation,true))fail('INVALID_REQUEST','Exact slot lease target required');
 const s=scope(i.principal);
 const row=(await tx.query(WORKSPACE+' WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND boot_generation=$4 AND slot_id=$5 FOR UPDATE',[s.organisation_id,s.run_id,v.sandbox_id,v.boot_generation,v.slot_id])).rows[0];
 if(!row)fail('WORKSPACE_UNREGISTERED','Slot workspace is not registered by its runner');
 if(row.state!=='FREE'||row.slot_generation!==v.expected_slot_generation)fail('WORKSPACE_NOT_FREE','Slot reuse waits for verified cleanup ('+row.state+' generation '+row.slot_generation+')');
 const updated=(await tx.query("UPDATE hyperfide.runner_workspaces SET state='LEASED',launch_id=$6,process_residue='UNCHECKED',credential_residue='UNCHECKED',outputs_durable=false,residue_evidence_digest=NULL,state_version=state_version+1,updated_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND boot_generation=$4 AND slot_id=$5 RETURNING slot_generation::text,state,launch_id",[s.organisation_id,s.run_id,v.sandbox_id,v.boot_generation,v.slot_id,v.launch_id])).rows[0]!;
 return {...updated,leased:true};
}
export async function releaseRunnerWorkspace(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);role(i,['RUNNER']);exact(v,['slot_id','launch_id','command_id','process_residue','credential_residue','evidence_digest']);
 if(![v.slot_id,v.launch_id,v.command_id].every(uuid)||!['ABSENT','PRESENT'].includes(String(v.process_residue))||!['ABSENT','PRESENT'].includes(String(v.credential_residue))||typeof v.evidence_digest!=='string'||!DIGEST.test(v.evidence_digest))fail('INVALID_REQUEST','Explicit observed residue evidence required');
 const p=i.principal,s=scope(p);
 const row=(await tx.query(WORKSPACE+' WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND boot_generation=$4 AND slot_id=$5 FOR UPDATE',[s.organisation_id,s.run_id,p.sandbox_id,p.boot_generation,v.slot_id])).rows[0];
 if(!row)fail('WORKSPACE_UNREGISTERED','Slot workspace is not registered by its runner');
 if(!['LEASED','CLEANING'].includes(row.state)||row.launch_id!==v.launch_id)fail('WORKSPACE_RELEASE_MISMATCH','Release must name the slot\'s current launch');
 const command=await load(tx,s,v.command_id as string);
 if(!command||command.launch_id!==v.launch_id||command.slot_id!==v.slot_id)fail('WORKSPACE_RELEASE_MISMATCH','Release requires the terminating command for this launch and slot');
 const missing=await outputsDurable(tx,s,command),blocking:string[]=[];
 if(v.process_residue!=='ABSENT')blocking.push('PROCESS_RESIDUE');
 if(v.credential_residue!=='ABSENT')blocking.push('CREDENTIAL_RESIDUE');
 for(const name of missing)blocking.push('OUTPUT_NOT_DURABLE:'+name);
 if(command.state!=='REPORTED'||!['CANCELLED','STOPPED','DRAINED'].includes(String(command.outcome))||command.termination!=='CONFIRMED')blocking.push('TERMINATION_UNCONFIRMED');
 const free=blocking.length===0;
 const updated=(await tx.query("UPDATE hyperfide.runner_workspaces SET state=$6,launch_id=CASE WHEN $6='FREE' THEN NULL ELSE launch_id END,command_id=CASE WHEN $6='FREE' THEN NULL ELSE $7::uuid END,slot_generation=slot_generation+CASE WHEN $6='FREE' THEN 1 ELSE 0 END,process_residue=$8,credential_residue=$9,outputs_durable=$10,residue_evidence_digest=$11,state_version=state_version+1,updated_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND boot_generation=$4 AND slot_id=$5 RETURNING slot_generation::text,state",[s.organisation_id,s.run_id,p.sandbox_id,p.boot_generation,v.slot_id,free?'FREE':'CLEANING',v.command_id,v.process_residue,v.credential_residue,missing.length===0,v.evidence_digest])).rows[0]!;
 return {...updated,reusable:free,blocking};
}
export async function inspectRunnerWorkspace(tx:PrimaryTransaction,i:InvocationContext,v:unknown):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);role(i,['OPERATOR','COORDINATOR','RUNNER']);exact(v,['sandbox_id','boot_generation','slot_id']);
 if(!uuid(v.sandbox_id)||!uuid(v.slot_id)||!decimal(v.boot_generation,true))fail('INVALID_REQUEST','Exact slot identity required');
 const s=scope(i.principal),row=(await tx.query(WORKSPACE+' WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id=$3 AND boot_generation=$4 AND slot_id=$5',[s.organisation_id,s.run_id,v.sandbox_id,v.boot_generation,v.slot_id])).rows[0];
 if(!row)fail('WORKSPACE_UNREGISTERED','Slot workspace is not registered by its runner');
 return {...row,reusable:row.state==='FREE'};
}
