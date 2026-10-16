import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {object} from '../policy/programme.js';
import {gateway,trustedActor,operation,ready,record,uuid,decimal,text,refuse,requireAuthority} from './packages.js';
import {parseComputeToken,assertCurrentCompute} from '../scheduler/leases.js';
import {dimensions,validateResourceVector,reserveCapacity} from '../scheduler/claim.js';
const CHECKSUM='sha256:'+createHash('sha256').update(readFileSync(new URL('../../migrations/0034-child-sessions.sql',import.meta.url))).digest('hex');
async function schema(tx:PrimaryTransaction):Promise<void>{
 await ready(tx);
 const found=await tx.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='hyperfide' AND table_name=ANY($1::text[])",[['hierarchy_supervisor_registrations','hierarchy_child_registrations','hierarchy_child_reservations','hierarchy_leadership_selections']]);
 const provenance=await tx.query("SELECT 1 FROM hyperfide.schema_migrations WHERE version=34 AND name='0034-child-sessions' AND checksum=$1",[CHECKSUM]);
 let runnerChecksum:string;
 try{runnerChecksum='sha256:'+createHash('sha256').update(readFileSync(new URL('../../migrations/0012-runner-registry.sql',import.meta.url))).digest('hex');}
 catch{return refuse('HIERARCHY_ADOPTION_SCHEMA_REQUIRED','Trusted runner prelaunch migration bytes are absent');}
 const runner=await tx.query("SELECT 1 FROM hyperfide.schema_migrations WHERE version=12 AND name='0012-runner-registry' AND checksum=$1",[runnerChecksum]);
 const prelaunch=await tx.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='hyperfide' AND table_name='agent_sessions' AND column_name='native_session_id'");
 if(found.rows[0]?.n!==4||!provenance.rowCount||!runner.rowCount||prelaunch.rows[0]?.is_nullable!=='YES')return refuse('HIERARCHY_ADOPTION_SCHEMA_REQUIRED','Apply trusted child-session and runner prelaunch migrations first');
}
function name(value:unknown):string{
 const s=text(value,128);if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(s))return refuse('INVALID_REQUEST','Expected a bounded runtime profile reference');return s;
}
async function currentManager(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string},packageId:string):Promise<string>{
 const rows=await tx.query('SELECT manager_session_id FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[scope.organisation_id,scope.run_id,packageId]);
 if(!rows.rows[0]?.manager_session_id)return refuse('PACKAGE_UNAVAILABLE','The task has no accountable current manager');return uuid(rows.rows[0].manager_session_id);
}
export async function childRegistration(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;child_session_id:string}):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);await schema(tx);
 const org=uuid(input.organisation_id),run=uuid(input.run_id),child=uuid(input.child_session_id);
 const rows=await tx.query('SELECT c.*,c.package_generation::text,c.attempt_generation::text,c.sandbox_boot_generation::text,s.native_session_id,s.state FROM hyperfide.hierarchy_child_registrations c JOIN hyperfide.agent_sessions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.child_session_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.child_session_id=$3 FOR SHARE OF s',[org,run,child]);
 if(!rows.rows[0])return refuse('CHILD_REGISTRATION_REQUIRED','No charged native descendant registration exists');
 const reservations=await tx.query('SELECT r.* FROM hyperfide.hierarchy_child_reservations l JOIN hyperfide.reservations r ON r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id WHERE l.organisation_id=$1 AND l.run_id=$2 AND l.child_session_id=$3 ORDER BY r.capacity_account_id FOR SHARE OF r',[org,run,child]);
 if(!reservations.rowCount||reservations.rows.some(r=>!['PROVISIONING','ALLOCATED'].includes(String(r.state))))return refuse('CHILD_CAPACITY_RELEASED','The descendant no longer holds its charged resource dimensions');
 return {...rows.rows[0],reservations:reservations.rows,launch_authority:false};
}
export function createComponent(context:ComponentContext):Component{
 const g=gateway(context);
 const allocations=context.dependencies.require('5.1','scheduler.allocations.v1',(v):v is {validateResourceVector:typeof validateResourceVector}=>object(v)&&typeof v.validateResourceVector==='function');
 const claims=context.dependencies.require('5.1','scheduler.claims.v1',(v):v is {reserveCapacity:typeof reserveCapacity}=>object(v)&&typeof v.reserveCapacity==='function');
 const handoff=context.dependencies.require('3.1','hierarchy.handoff.v1',(v):v is {propose:(input:unknown,ctx:ComponentContext)=>Promise<unknown>;acknowledge:(input:unknown,ctx:ComponentContext)=>Promise<unknown>}=>object(v)&&typeof v.propose==='function'&&typeof v.acknowledge==='function');
 return {apiVersion:1,capabilities:{'hierarchy.children.v1':Object.freeze({childRegistration})},actions:{
 'hierarchy.supervisor.register':async(input,current)=>{
  const v=record(input,['idempotency_key','expected_leader_generation','session_id','role','connector','account_key']),a=trustedActor(current),expected=decimal(v.expected_leader_generation,true),sessionId=uuid(v.session_id);
  const role=v.role;if(role!=='LEADER'&&role!=='FEATURE_MANAGER')return refuse('ROLE_DENIED','Only supervisors may be registered on main');
  const connector=name(v.connector),account=name(v.account_key);
  if(!['codex','claude','claude-code'].includes(connector))return refuse('ROLE_DENIED','Supervisors require an approved frontier connector family');
  return operation(g,a,'hierarchy.supervisor.register',v,async tx=>{
   await schema(tx);
   const rows=await tx.query('SELECT leader_session_id,generation::text,authority_epoch FROM hyperfide.hierarchy_leaders WHERE organisation_id=$1 AND run_id=$2 FOR SHARE',[a.organisation_id,a.run_id]);
   const old=rows.rows[0],principal=a.invocation.principal;
   if((old?.generation??'0')!==expected||old&&old.authority_epoch!==a.authority_epoch)return refuse('LEADER_GENERATION_STALE','Supervisor registration belongs to another leader generation');
   if(!old){
    if(role!=='LEADER'||!['OPERATOR','COORDINATOR'].includes(principal.role))return refuse('ROLE_DENIED','An authenticated bootstrap operator/coordinator must register the first primary');
   }else if(principal.role==='LEADER')await requireAuthority(tx,{...a,leader_generation:expected,roles:['LEADER']});
   else if(principal.role!=='COORDINATOR')return refuse('ROLE_DENIED','Only the current primary/coordinator may register supervisors');
   await tx.query("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,'REGISTERED')",
    [a.organisation_id,a.run_id,sessionId,role,role==='FEATURE_MANAGER'?old?.leader_session_id??null:null,connector,account]);
   await tx.query('INSERT INTO hyperfide.hierarchy_supervisor_registrations(organisation_id,run_id,session_id,registered_by_credential_id,registered_by_actor_id,leader_generation) VALUES($1,$2,$3,$4,$5,$6)',
    [a.organisation_id,a.run_id,sessionId,principal.credential_id,principal.actor_id,expected]);
   return {session_id:sessionId,role,state:'REGISTERED',native_session_id:null,native_ready:false,execution_authority:false,
    next_required:role==='LEADER'?['SELECT_LOGICAL_LEADER','RESTRICTED_NATIVE_LAUNCH','OBSERVED_NATIVE_BINDING','AGENT_CREDENTIAL']:['PACKAGE_ASSIGNMENT','RESTRICTED_NATIVE_LAUNCH','OBSERVED_NATIVE_BINDING','AGENT_CREDENTIAL']};
  });
 },
 'hierarchy.supervisor.select':async(input,current)=>{
  const v=record(input,['idempotency_key','expected_generation','session_id','reason']),a=trustedActor(current),expected=decimal(v.expected_generation,true),targetId=uuid(v.session_id);text(v.reason,4096);
  return operation(g,a,'hierarchy.supervisor.select',v,async tx=>{
   await schema(tx);
   await tx.query('SELECT id FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[a.organisation_id,a.run_id]);
   const existing=await tx.query('SELECT generation::text,leader_session_id,authority_epoch FROM hyperfide.hierarchy_leaders WHERE organisation_id=$1 AND run_id=$2 FOR UPDATE',[a.organisation_id,a.run_id]),old=existing.rows[0];
   if((old?.generation??'0')!==expected)return refuse('LEADER_GENERATION_STALE','Logical leader compare-and-set failed');
   const principal=a.invocation.principal;
   if(principal.role==='LEADER'){
    if(!old)return refuse('ROLE_DENIED','An initial leader seat needs operator/coordinator bootstrap');
    await requireAuthority(tx,{...a,leader_generation:expected,roles:['LEADER']});
   }else if(!['OPERATOR','COORDINATOR'].includes(principal.role))return refuse('ROLE_DENIED','Caller cannot select a logical primary');
   const target=await tx.query("SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND role='LEADER' AND state='REGISTERED' AND sandbox_id IS NULL AND slot_id IS NULL AND attempt_id IS NULL FOR SHARE",[a.organisation_id,a.run_id,targetId]);
   if(!target.rowCount)return refuse('SUPERVISOR_SESSION_INVALID','Target is not a registered unattached primary session');
   const next=decimal((BigInt(expected)+1n).toString());
   await tx.query('INSERT INTO hyperfide.hierarchy_leaders(organisation_id,run_id,authority_epoch,leader_session_id,generation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organisation_id,run_id) DO UPDATE SET authority_epoch=EXCLUDED.authority_epoch,leader_session_id=EXCLUDED.leader_session_id,generation=EXCLUDED.generation,state_version=hyperfide.hierarchy_leaders.state_version+1',[a.organisation_id,a.run_id,a.authority_epoch,targetId,next]);
   await tx.query('INSERT INTO hyperfide.hierarchy_leadership_selections(organisation_id,run_id,id,leader_session_id,leader_generation,authority_epoch,predecessor_session_id,predecessor_generation,predecessor_authority_epoch,selected_by_credential_id,selected_by_actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [a.organisation_id,a.run_id,randomUUID(),targetId,next,a.authority_epoch,old?.leader_session_id??null,old?.generation??null,old?.authority_epoch??null,principal.credential_id,principal.actor_id,v.reason]);
   return {leader_session_id:targetId,leader_generation:next,authority_epoch:a.authority_epoch,native_ready:false,execution_authority:false};
  });
 },
 'hierarchy.child.register':async(input,current)=>{
  const v=record(input,['idempotency_key','leader_generation','package_generation','parent_session_id','child_session_id','token','capacity']),a=trustedActor(current);
  const token=parseComputeToken(v.token),parentId=uuid(v.parent_session_id),childId=uuid(v.child_session_id),demand=dimensions(v.capacity);
  if(token.organisation_id!==a.organisation_id||token.run_id!==a.run_id||token.authority_epoch!==a.authority_epoch||childId===parentId)return refuse('ACTOR_SCOPE_MISMATCH','Descendant token/identity belongs to another authority scope');
  return operation(g,a,'hierarchy.child.register',v,async tx=>{
   await schema(tx);
   const tasks=await tx.query('SELECT feature_package_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[a.organisation_id,a.run_id,token.task_id]);
   const packageId=tasks.rows[0]?.feature_package_id;if(!packageId)return refuse('TASK_UNAVAILABLE','Descendant task is unavailable');
   const auth=await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:packageId,package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER','WORKER']});
   if(auth.role==='WORKER'&&a.session_id!==parentId)return refuse('PARENT_IDENTITY_MISMATCH','A worker may register only its own descendants');
   const parents=await tx.query("SELECT * FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND role='WORKER' AND state='RUNNING' AND native_session_id IS NOT NULL AND attempt_id=$4 AND sandbox_id=$5 AND slot_id=$6 AND sandbox_boot_generation=$7 FOR SHARE",
    [a.organisation_id,a.run_id,parentId,token.attempt_id,token.sandbox_id,token.slot_id,token.sandbox_boot_generation]);
   const parent=parents.rows[0];if(!parent)return refuse('PARENT_IDENTITY_MISMATCH','Parent is not the observed live worker for this exact executor/attempt');
   const sandboxes=await tx.query('SELECT pool_id FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 FOR SHARE',[a.organisation_id,token.sandbox_id]);
   const pool=uuid(sandboxes.rows[0]?.pool_id),policy=await allocations.validateResourceVector(tx,{organisation_id:a.organisation_id,run_id:a.run_id,pool_id:pool,attempt_id:token.attempt_id,dimensions:demand,job_class:'AGENT'});
   const reservationRequest=randomUUID(),expires=await tx.query("SELECT (clock_timestamp()+interval '5 minutes')::text AS expiry");
   const reserved=await claims.reserveCapacity(tx,{organisation_id:a.organisation_id,run_id:a.run_id,request_id:reservationRequest,attempt_id:token.attempt_id,dimensions:policy.dimensions,expires_at:expires.rows[0]!.expiry});
   const compute=await assertCurrentCompute(tx,token,{operation:'ADMISSION'});
   if(compute.feature_package_id!==packageId)return refuse('ACTOR_SCOPE_MISMATCH','Compute package differs from the current task');
   const count=await tx.query("SELECT count(DISTINCT s.id)::text AS n FROM hyperfide.agent_sessions s LEFT JOIN hyperfide.hierarchy_child_registrations c ON c.organisation_id=s.organisation_id AND c.run_id=s.run_id AND c.child_session_id=s.id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.attempt_id=$3 AND s.role='WORKER' AND (c.child_session_id IS NOT NULL OR EXISTS(SELECT 1 FROM hyperfide.agent_sessions p WHERE p.organisation_id=s.organisation_id AND p.run_id=s.run_id AND p.id=s.parent_session_id AND p.role='WORKER')) AND (s.state IN ('REGISTERED','RUNNING','DISCONNECTED') OR EXISTS(SELECT 1 FROM hyperfide.hierarchy_child_reservations l JOIN hyperfide.reservations r ON r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id WHERE l.organisation_id=s.organisation_id AND l.run_id=s.run_id AND l.child_session_id=s.id AND r.state<>'RELEASED'))",[a.organisation_id,a.run_id,token.attempt_id]);
   if(BigInt(count.rows[0]!.n)>=BigInt(policy.resource_requirements.max_descendants))return refuse('CHILD_LIMIT','Accepted descendant limit is exhausted, including uncertain cleanup');
   const manager=await currentManager(tx,a,packageId);
   await tx.query("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id,state) VALUES($1,$2,$3,'WORKER',$4,$5,$6,NULL,$7,$8,$9,$10,'REGISTERED')",
    [a.organisation_id,a.run_id,childId,parentId,parent.connector,parent.account_key,token.slot_id,token.sandbox_id,token.sandbox_boot_generation,token.attempt_id]);
   await tx.query('INSERT INTO hyperfide.hierarchy_session_packages(organisation_id,run_id,session_id,package_id,registered_by) VALUES($1,$2,$3,$4,$5)',[a.organisation_id,a.run_id,childId,packageId,a.session_id]);
   await tx.query('INSERT INTO hyperfide.hierarchy_child_registrations(organisation_id,run_id,child_session_id,parent_session_id,manager_session_id,package_id,package_generation,task_id,attempt_id,attempt_generation,authority_epoch,sandbox_id,slot_id,sandbox_boot_generation,packet_digest,reservation_request_id,registered_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
    [a.organisation_id,a.run_id,childId,parentId,manager,packageId,auth.package_generation,token.task_id,token.attempt_id,token.attempt_generation,a.authority_epoch,token.sandbox_id,token.slot_id,token.sandbox_boot_generation,compute.input_packet_digest,reservationRequest,a.invocation.principal.credential_id]);
   const reservationIds:string[]=[];
   for(const value of reserved){if(!object(value))return refuse('CHILD_CAPACITY_INVALID','Actual capacity reservation is invalid');const id=uuid(value.id);reservationIds.push(id);
    await tx.query('INSERT INTO hyperfide.hierarchy_child_reservations(organisation_id,run_id,child_session_id,reservation_id) VALUES($1,$2,$3,$4)',[a.organisation_id,a.run_id,childId,id]);
    await tx.query('UPDATE hyperfide.reservations SET expires_at=$1,state_version=state_version+1 WHERE organisation_id=$2 AND run_id=$3 AND id=$4',[compute.lease_expires_at,a.organisation_id,a.run_id,id]);}
   return {child_session_id:childId,parent_session_id:parentId,manager_session_id:manager,package_id:packageId,package_generation:auth.package_generation,attempt_id:token.attempt_id,reservation_ids:reservationIds,state:'REGISTERED',native_session_id:null,launch_authority:false,credential_authority:false};
  });
 },
 'hierarchy.adoption.propose':(input,current)=>handoff.propose(input,current),
 'hierarchy.adoption.acknowledge':(input,current)=>handoff.acknowledge(input,current),
 'hierarchy.adoption.inspect':async(input,current)=>{
  const v=record(input,['leader_generation','package_id','package_generation']),a=trustedActor(current),packageId=uuid(v.package_id);
  return g.withPrimaryTransaction({timeoutMs:10000,guard:a.guard,signal:a.signal},async tx=>{
   await schema(tx);
   const auth=await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:packageId,package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER']});
   const sessions=await tx.query('SELECT s.id,s.parent_session_id,s.role,s.state,s.native_session_id,s.attempt_id,s.sandbox_id,s.slot_id,s.sandbox_boot_generation::text,t.id AS task_id,t.state AS task_state,a.compute_authority,a.execution_state FROM hyperfide.agent_sessions s JOIN hyperfide.attempts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND a.id=s.attempt_id JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.feature_package_id=$3 ORDER BY s.id LIMIT 257',[a.organisation_id,a.run_id,packageId]);
   return {package_id:packageId,package_generation:auth.package_generation,current_manager_session_id:await currentManager(tx,a,packageId),sessions:sessions.rows.slice(0,256),omitted_at_least:Math.max(0,sessions.rows.length-256),authority:'NONE',restart_required:false,ancestry:'IMMUTABLE; accountability follows current package ownership'};
  });
 }
 }};
}
