import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import type {ComputeToken} from '../scheduler/claim.js';
import {isNativeAuthAuthority} from '../identity/native_auth.js';
import type {NativeAuthAuthority} from '../identity/native_auth.js';
import {readSemanticDisposition} from '../storage/dispositions.js';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {object} from '../policy/programme.js';
import {gateway,trustedActor,operation,ready,record,uuid,decimal,text,strings,refuse,requireAuthority,hierarchyReadGuard,hierarchyWriteGuard,leadership,hash,digest,canonical} from './packages.js';
import type {TrustedActor,Scope} from './packages.js';
import {validateExecutionInputs} from './packets.js';
import {parseComputeToken,assertCurrentCompute} from '../scheduler/leases.js';
import {dimensions,validateResourceVector,reserveCapacity,lockSandboxBudget,reserveSandboxResources,inspectSandboxCharge,markSandboxReleasePending} from '../scheduler/claim.js';
const CHECKSUM='sha256:'+createHash('sha256').update(readFileSync(new URL('../../migrations/0034-child-sessions.sql',import.meta.url))).digest('hex');
const TABLES=['hierarchy_supervisor_registrations','hierarchy_child_registrations','hierarchy_child_reservations','hierarchy_leadership_selections','hierarchy_child_usage','hierarchy_child_releases','hierarchy_adoptions','hierarchy_adoption_acknowledgements'];
async function schema(tx:PrimaryTransaction):Promise<void>{
 await ready(tx);
 const found=await tx.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='hyperfide' AND table_name=ANY($1::text[])",[TABLES]);
 const provenance=await tx.query("SELECT 1 FROM hyperfide.schema_migrations WHERE version=34 AND name='0034-child-sessions' AND checksum=$1",[CHECKSUM]);
 let runnerChecksum:string;
 try{runnerChecksum='sha256:'+createHash('sha256').update(readFileSync(new URL('../../migrations/0012-runner-registry.sql',import.meta.url))).digest('hex');}
 catch{return refuse('HIERARCHY_ADOPTION_SCHEMA_REQUIRED','Trusted runner prelaunch migration bytes are absent');}
 const runner=await tx.query("SELECT 1 FROM hyperfide.schema_migrations WHERE version=12 AND name='0012-runner-registry' AND checksum=$1",[runnerChecksum]);
 const prelaunch=await tx.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='hyperfide' AND table_name='agent_sessions' AND column_name='native_session_id'");
 if(found.rows[0]?.n!==TABLES.length||!provenance.rowCount||!runner.rowCount||prelaunch.rows[0]?.is_nullable!=='YES')return refuse('HIERARCHY_ADOPTION_SCHEMA_REQUIRED','Apply trusted child-session and runner prelaunch migrations first');
}
function name(value:unknown):string{
 const s=text(value,128);if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(s))return refuse('INVALID_REQUEST','Expected a bounded runtime profile reference');return s;
}
async function currentManager(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string},packageId:string):Promise<string>{
 const rows=await tx.query('SELECT manager_session_id FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[scope.organisation_id,scope.run_id,packageId]);
 if(!rows.rows[0]?.manager_session_id)return refuse('PACKAGE_UNAVAILABLE','The task has no accountable current manager');return uuid(rows.rows[0].manager_session_id);
}
interface ChildState {row:Record<string,any>;reservations:Record<string,any>[];charge:Record<string,unknown>|null;release:Record<string,any>|null;refusal:[string,string]|null}
/** Reads one registered descendant and the exact capacity it still holds; null when never registered. */
async function childState(tx:PrimaryTransaction,org:string,run:string,child:string):Promise<ChildState|null>{
 const rows=await tx.query('SELECT c.*,c.package_generation::text,c.attempt_generation::text,c.sandbox_boot_generation::text,c.created_at::text,s.native_session_id,s.state FROM hyperfide.hierarchy_child_registrations c JOIN hyperfide.agent_sessions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.child_session_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.child_session_id=$3 FOR SHARE OF s',[org,run,child]);
 if(!rows.rows[0])return null;
 const row=rows.rows[0];
 const reservations=await tx.query('SELECT r.id,r.request_id,r.capacity_account_id,r.quantity::text,r.state,r.attempt_id,r.expires_at::text FROM hyperfide.hierarchy_child_reservations l JOIN hyperfide.reservations r ON r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id WHERE l.organisation_id=$1 AND l.run_id=$2 AND l.child_session_id=$3 ORDER BY r.capacity_account_id FOR SHARE OF r',[org,run,child]);
 const released=await tx.query('SELECT observed_state,reason,released_by_credential_id,released_at::text FROM hyperfide.hierarchy_child_releases WHERE organisation_id=$1 AND run_id=$2 AND child_session_id=$3',[org,run,child]);
 const charge=await inspectSandboxCharge(tx,{organisation_id:org,run_id:run,request_id:uuid(row.reservation_request_id)});
 let refusal:[string,string]|null=null;
 if(released.rows[0])refusal=['CHILD_RELEASED','The descendant was released and holds no execution authority'];
 else if(!reservations.rowCount||reservations.rows.some(r=>!['PROVISIONING','ALLOCATED'].includes(String(r.state))))refusal=['CHILD_CAPACITY_RELEASED','The descendant no longer holds its charged resource dimensions'];
 else if(!charge||charge.state!=='HELD'||charge.charge_id!==row.sandbox_charge_id||charge.job_kind!=='CHILD'||charge.attempt_id!==row.attempt_id||charge.sandbox_id!==row.sandbox_id||charge.slot_id!==row.slot_id||charge.sandbox_boot_generation!==row.sandbox_boot_generation)
  refusal=['CHILD_SANDBOX_CAPACITY_UNAVAILABLE','The descendant lacks its exact held physical executor charge'];
 return {row,reservations:reservations.rows,charge,release:released.rows[0]??null,refusal};
}
export async function childRegistration(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;child_session_id:string}):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);await schema(tx);
 const org=uuid(input.organisation_id),run=uuid(input.run_id),child=uuid(input.child_session_id);
 const found=await childState(tx,org,run,child);
 if(!found)return refuse('CHILD_REGISTRATION_REQUIRED','No charged native descendant registration exists');
 if(found.refusal)return refuse(...found.refusal);
 return {...found.row,reservations:found.reservations,sandbox_charge:found.charge,launch_authority:false};
}
/** Keeps a descendant's charged capacity expiry no earlier than its parent's current compute lease. */
export async function alignChildCapacity(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;child_session_id:string;lease_expires_at:string}):Promise<number>{
 assertPrimaryTransaction(tx);
 const updated=await tx.query("UPDATE hyperfide.reservations r SET expires_at=$4::timestamptz,state_version=r.state_version+1 FROM hyperfide.hierarchy_child_reservations l WHERE l.organisation_id=$1 AND l.run_id=$2 AND l.child_session_id=$3 AND r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id AND r.state IN ('PROVISIONING','ALLOCATED') AND r.expires_at<$4::timestamptz RETURNING r.id",
  [uuid(input.organisation_id),uuid(input.run_id),uuid(input.child_session_id),text(input.lease_expires_at,64)]);
 return updated.rows.length;
}
function childToken(row:Record<string,any>):ComputeToken{
 return {organisation_id:row.organisation_id,run_id:row.run_id,task_id:row.task_id,attempt_id:row.attempt_id,attempt_generation:row.attempt_generation,authority_epoch:row.authority_epoch,sandbox_id:row.sandbox_id,slot_id:row.slot_id,sandbox_boot_generation:row.sandbox_boot_generation};
}

const LIVE=['REGISTERED','RUNNING','DISCONNECTED'];
export interface Descendant {
 session_id:string;kind:'WORKER'|'CHILD';parent_session_id:string|null;task_id:string;package_id:string;attempt_id:string;attempt_generation:string;
 sandbox_id:string|null;slot_id:string|null;sandbox_boot_generation:string|null;state:string;native_session_id:string|null;
 status:'ACCOUNTED'|'RELEASED'|'STALE'|'UNACCOUNTED';reason:string|null;
}
/** Every live worker seat attached to a package attempt, classified by the capacity that accounts for it. */
async function liveDescendants(tx:PrimaryTransaction,scope:Scope,filter:{package_ids?:string[];session_id?:string}):Promise<Descendant[]>{
 const rows=await tx.query("SELECT s.id AS session_id,s.parent_session_id,p.role AS parent_role,p.state AS parent_state,s.state,s.native_session_id,s.attempt_id,a.generation::text AS attempt_generation,a.compute_authority,a.sandbox_id AS attempt_sandbox_id,a.slot_id AS attempt_slot_id,a.sandbox_boot_generation::text AS attempt_boot,s.sandbox_id,s.slot_id,s.sandbox_boot_generation::text AS sandbox_boot_generation,t.id AS task_id,t.feature_package_id AS package_id,c.child_session_id IS NOT NULL AS registered FROM hyperfide.agent_sessions s JOIN hyperfide.attempts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND a.id=s.attempt_id JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id LEFT JOIN hyperfide.agent_sessions p ON p.organisation_id=s.organisation_id AND p.run_id=s.run_id AND p.id=s.parent_session_id LEFT JOIN hyperfide.hierarchy_child_registrations c ON c.organisation_id=s.organisation_id AND c.run_id=s.run_id AND c.child_session_id=s.id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.role='WORKER' AND s.state=ANY($3::text[]) AND ($4::uuid[] IS NULL OR t.feature_package_id=ANY($4::uuid[])) AND ($5::uuid IS NULL OR s.id=$5) ORDER BY s.id LIMIT 1025 FOR SHARE OF s",
  [scope.organisation_id,scope.run_id,LIVE,filter.package_ids??null,filter.session_id??null]);
 if(rows.rows.length>1024)return refuse('DESCENDANTS_UNBOUNDED','Too many live descendants to account for in one adoption');
 const result:Descendant[]=[];
 for(const r of rows.rows){
  const child=Boolean(r.registered)||r.parent_role==='WORKER';
  let status:Descendant['status']='ACCOUNTED',reason:string|null=null;
  if(child){
   const found=r.registered?await childState(tx,scope.organisation_id,scope.run_id,r.session_id):null;
   if(!found){status='UNACCOUNTED';reason='CHILD_REGISTRATION_REQUIRED';}
   else if(found.release){status='RELEASED';reason='CHILD_RELEASED';}
   else if(found.refusal){status='UNACCOUNTED';reason=found.refusal[0];}
   else if(!LIVE.includes(String(r.parent_state))){status='UNACCOUNTED';reason='PARENT_NOT_LIVE';}
  }else if(r.compute_authority!=='CURRENT'||r.sandbox_id!==r.attempt_sandbox_id||r.slot_id!==r.attempt_slot_id||r.sandbox_boot_generation!==r.attempt_boot){status='STALE';reason='STALE_COMPUTE';}
  result.push({session_id:r.session_id,kind:child?'CHILD':'WORKER',parent_session_id:r.parent_session_id,task_id:r.task_id,package_id:r.package_id,attempt_id:r.attempt_id,attempt_generation:r.attempt_generation,
   sandbox_id:r.sandbox_id,slot_id:r.slot_id,sandbox_boot_generation:r.sandbox_boot_generation,state:r.state,native_session_id:r.native_session_id,status,reason});
 }
 return result;
}
function requireAccounted(found:readonly Descendant[]):void{
 const hidden=found.filter(d=>d.status==='UNACCOUNTED');
 if(hidden.length)refuse('UNACCOUNTED_DESCENDANT','Live descendants lack charged registration and cannot be adopted: '+hidden.slice(0,8).map(d=>d.session_id).join(','));
}
/** Hook for native binders/handoff: refuses execution authority to any worker seat not accounted for by capacity. */
export async function assertChildExecutionAuthority(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;session_id:string}):Promise<Descendant>{
 assertPrimaryTransaction(tx);await schema(tx);
 const scope={organisation_id:uuid(input.organisation_id),run_id:uuid(input.run_id)};
 const [found]=await liveDescendants(tx,scope,{session_id:uuid(input.session_id)});
 if(!found)return refuse('SESSION_NOT_LIVE','No live worker seat is attached to a package attempt');
 if(found.status==='ACCOUNTED')return found;
 if(found.status==='STALE')return refuse('STALE_COMPUTE','Worker compute authority is no longer current');
 if(found.reason==='CHILD_RELEASED')return refuse('CHILD_RELEASED','The descendant was released and holds no execution authority');
 return refuse(found.reason==='CHILD_REGISTRATION_REQUIRED'?'CHILD_REGISTRATION_REQUIRED':'CHILD_EXECUTION_UNACCOUNTED','Descendant execution is not accounted for by held capacity ('+found.reason+')');
}
function identity(d:Descendant){
 return {session_id:d.session_id,kind:d.kind,parent_session_id:d.parent_session_id,task_id:d.task_id,attempt_id:d.attempt_id,attempt_generation:d.attempt_generation,sandbox_id:d.sandbox_id,slot_id:d.slot_id,sandbox_boot_generation:d.sandbox_boot_generation,native_session_id:d.native_session_id,state:d.state};
}
/** A descendant continues unchanged when its executor tuple is identical and a bound native identity never changed. */
function continues(before:Record<string,any>,after:Descendant|undefined):boolean{
 if(!after||after.status!=='ACCOUNTED')return false;
 const now=identity(after);
 return ['kind','parent_session_id','task_id','attempt_id','attempt_generation','sandbox_id','slot_id','sandbox_boot_generation'].every(k=>before[k]===now[k as keyof typeof now])&&(before.native_session_id===null||before.native_session_id===now.native_session_id);
}
async function childAuthority(tx:PrimaryTransaction,a:TrustedActor,childId:string,v:Record<string,unknown>){
 const rows=await tx.query('SELECT package_id,parent_session_id FROM hyperfide.hierarchy_child_registrations WHERE organisation_id=$1 AND run_id=$2 AND child_session_id=$3',[a.organisation_id,a.run_id,childId]);
 const row=rows.rows[0];if(!row)return refuse('CHILD_REGISTRATION_REQUIRED','No charged native descendant registration exists');
 const auth=await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:row.package_id,package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER','WORKER']});
 if(auth.role==='WORKER'&&a.session_id!==row.parent_session_id)return refuse('PARENT_IDENTITY_MISMATCH','A worker may account only for its own descendants');
 return auth;
}
const USAGE=['cpu_millis','memory_bytes','disk_bytes','model_input_tokens','model_output_tokens'] as const;

/** Current supervisory identity witness; the caller separately proves the actual MAIN host/process. */
export async function supervisorRegistration(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;session_id:string}){
 assertPrimaryTransaction(tx);await readSemanticDisposition(tx,input);await schema(tx);
 const org=uuid(input.organisation_id),run=uuid(input.run_id),sessionId=uuid(input.session_id);
 const found=await tx.query("SELECT s.*,c.registered_by_credential_id,c.registered_by_actor_id,c.leader_generation::text AS registered_leader_generation,c.created_at AS registered_at FROM hyperfide.hierarchy_supervisor_registrations c JOIN hyperfide.agent_sessions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.session_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.session_id=$3 FOR SHARE OF s",[org,run,sessionId]);
 const row=found.rows[0];
 if(!row||!['LEADER','FEATURE_MANAGER'].includes(row.role)||!['REGISTERED','RUNNING','DISCONNECTED'].includes(row.state)||row.sandbox_id!==null||row.slot_id!==null||row.attempt_id!==null||typeof row.native_session_id!=='string'||!row.native_session_id.length)
  return refuse('SUPERVISOR_REGISTRATION_REQUIRED','An observed registered unattached supervisory seat is required');
 const current=await leadership(tx,{organisation_id:org,run_id:run});
 const packages=row.role==='FEATURE_MANAGER'?await tx.query("SELECT p.id AS package_id,h.owner_generation::text AS package_generation FROM hyperfide.feature_packages p JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.manager_session_id=$3 AND h.state NOT IN ('CLOSED','CANCELLED') ORDER BY p.id FOR SHARE OF p,h",[org,run,sessionId]):{rows:[]};
 if(row.role==='FEATURE_MANAGER'&&!packages.rows.length)return refuse('PACKAGE_OWNER_MISMATCH','Supervisory credentials require a current accountable manager package');
 await requireAuthority(tx,{organisation_id:org,run_id:run,session_id:sessionId,authority_epoch:current.authority_epoch,leader_generation:current.leader_generation,roles:['LEADER','FEATURE_MANAGER'],
  ...(row.role==='FEATURE_MANAGER'?{package_id:packages.rows[0]!.package_id,package_generation:packages.rows[0]!.package_generation}:{})});
 const receipt={schema_version:1,organisation_id:org,run_id:run,session_id:sessionId,role:row.role,parent_session_id:row.parent_session_id,connector:row.connector,account_key:row.account_key,
  registered_by_credential_id:row.registered_by_credential_id,registered_by_actor_id:row.registered_by_actor_id,leader_generation:row.registered_leader_generation,created_at:new Date(row.registered_at).toISOString()};
 return {organisation_id:org,run_id:run,session_id:sessionId,role:row.role as 'LEADER'|'FEATURE_MANAGER',native_session_id:text(row.native_session_id),leader_generation:current.leader_generation,package_bindings:packages.rows,registration_receipt_digest:hash(receipt),execution_authority:false as const};
}

export function createComponent(context:ComponentContext):Component{
 const g=gateway(context);
 const allocations=context.dependencies.require('5.1','scheduler.allocations.v1',(v):v is {validateResourceVector:typeof validateResourceVector}=>object(v)&&typeof v.validateResourceVector==='function');
 const claims=context.dependencies.require('5.1','scheduler.claims.v1',(v):v is {reserveCapacity:typeof reserveCapacity}=>object(v)&&typeof v.reserveCapacity==='function');
 const budget=context.dependencies.require('5.1','scheduler.sandbox-budget.v1',(v):v is {lockSandboxBudget:typeof lockSandboxBudget;reserveSandboxResources:typeof reserveSandboxResources}=>object(v)&&typeof v.lockSandboxBudget==='function'&&typeof v.reserveSandboxResources==='function');
 const handoff=context.dependencies.require('3.1','hierarchy.handoff.v1',(v):v is {propose:(input:unknown,ctx:ComponentContext)=>Promise<unknown>;acknowledge:(input:unknown,ctx:ComponentContext)=>Promise<unknown>}=>object(v)&&typeof v.propose==='function'&&typeof v.acknowledge==='function');
 return {apiVersion:1,capabilities:{'hierarchy.children.v1':Object.freeze({childRegistration,assertChildExecutionAuthority,alignChildCapacity}),'hierarchy.supervisor-registration.v1':Object.freeze({supervisorRegistration})},actions:{
 'hierarchy.supervisor.register':async(input,current)=>{
  const v=record(input,['idempotency_key','expected_leader_generation','session_id','role','connector','account_key']),a=trustedActor(current),expected=decimal(v.expected_leader_generation,true),sessionId=uuid(v.session_id);
  const role=v.role;if(role!=='LEADER'&&role!=='FEATURE_MANAGER')return refuse('ROLE_DENIED','Only supervisors may be registered on main');
  const connector=name(v.connector),account=name(v.account_key);
  if(!['codex','claude','claude-code'].includes(connector))return refuse('ROLE_DENIED','Supervisors require an approved frontier connector family');
  return operation(g,a,'hierarchy.supervisor.register',v,async tx=>{
   await schema(tx);
   const rows=await tx.query('SELECT leader_session_id,generation::text,authority_epoch FROM hyperfide.hierarchy_leaders WHERE organisation_id=$1 AND run_id=$2 FOR SHARE',[a.organisation_id,a.run_id]);
   const old=rows.rows[0],principal=a.invocation.principal;
   if((old?.generation??'0')!==expected)return refuse('LEADER_GENERATION_STALE','Supervisor registration belongs to another leader generation');
   const recoveryBootstrap=Boolean(old&&old.authority_epoch!==a.authority_epoch&&role==='LEADER'&&['OPERATOR','COORDINATOR'].includes(principal.role));
   if(old&&old.authority_epoch!==a.authority_epoch&&!recoveryBootstrap)return refuse('AUTHORITY_EPOCH_STALE','Only a trusted recovery primary bootstrap may cross the platform epoch');
   if(!old){
    if(role!=='LEADER'||!['OPERATOR','COORDINATOR'].includes(principal.role))return refuse('ROLE_DENIED','An authenticated bootstrap operator/coordinator must register the first primary');
   }else if(principal.role==='LEADER')await requireAuthority(tx,{...a,leader_generation:expected,roles:['LEADER']});
   else if(principal.role!=='COORDINATOR'&&!recoveryBootstrap)return refuse('ROLE_DENIED','Only the current primary/coordinator may register supervisors');
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
   const executor={organisation_id:a.organisation_id,run_id:a.run_id,sandbox_id:token.sandbox_id,sandbox_boot_generation:token.sandbox_boot_generation,slot_id:token.slot_id};
   await budget.lockSandboxBudget(tx,executor);
   const reservationRequest=randomUUID(),resources={cpu_millis:String(policy.resource_requirements.cpu_millis),memory_bytes:String(policy.resource_requirements.memory_bytes),disk_bytes:String(policy.resource_requirements.disk_bytes)};
   const physical=await budget.reserveSandboxResources(tx,{...executor,request_id:reservationRequest,attempt_id:token.attempt_id,job_kind:'CHILD',resources});
   if(!object(physical))return refuse('CHILD_SANDBOX_CAPACITY_UNAVAILABLE','Physical executor admission returned no exact charge');
   const chargeId=uuid(physical.charge_id);
   const expires=await tx.query("SELECT (clock_timestamp()+interval '5 minutes')::text AS expiry");
   const reserved=await claims.reserveCapacity(tx,{organisation_id:a.organisation_id,run_id:a.run_id,request_id:reservationRequest,attempt_id:token.attempt_id,dimensions:policy.dimensions,expires_at:expires.rows[0]!.expiry});
   const compute=await assertCurrentCompute(tx,token,{operation:'ADMISSION'});
   if(compute.feature_package_id!==packageId)return refuse('ACTOR_SCOPE_MISMATCH','Compute package differs from the current task');
   const running=await tx.query("SELECT 1 FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND generation=$4 AND execution_state='RUNNING'",[a.organisation_id,a.run_id,token.attempt_id,token.attempt_generation]);
   if(!running.rowCount)return refuse('PARENT_EXECUTION_UNCONFIRMED','Observed native transport or a START request cannot grant descendant authority');

   const packet=await validateExecutionInputs(tx,{organisation_id:a.organisation_id,run_id:a.run_id,digest:compute.input_packet_digest},a.invocation);
   const mandatory=packet.packet.mandatory;
   if(!object(mandatory)||!object(mandatory.identity))return refuse('CHILD_INPUT_STALE','Current compute lacks immutable accepted task inputs');
   const pins=mandatory.identity;
   if(!object(mandatory.runtime)||mandatory.runtime.sandbox_id!==token.sandbox_id||mandatory.runtime.slot_id!==token.slot_id||mandatory.runtime.sandbox_boot_generation!==token.sandbox_boot_generation||mandatory.runtime.preparation_digest!==compute.preparation_digest)return refuse('CHILD_INPUT_STALE','Current executor preparation differs from the accepted parent packet');
   if(!object(mandatory.runtime.declared_profile)||!object(mandatory.runtime.declared_profile.policy))return refuse('CHILD_INPUT_STALE','Accepted parent environment expiry policy is absent');
   const clock=await tx.query('SELECT clock_timestamp() AS now');
   const expiresAt=mandatory.runtime.declared_profile.policy.expires_at;
   if(typeof expiresAt!=='string'||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=new Date(clock.rows[0]!.now).getTime())return refuse('ENVIRONMENT_PROFILE_EXPIRED','A new descendant cannot launch from expired preparation intent');
   if(pins.task_id!==token.task_id||pins.attempt_id!==token.attempt_id||pins.attempt_generation!==token.attempt_generation||pins.spec_revision_id!==compute.spec_revision_id||pins.spec_generation!==compute.spec_generation||pins.criteria_digest!==compute.criteria_digest)return refuse('CHILD_INPUT_STALE','Current accepted task criteria/spec differ from the parent attempt packet');
   const count=await tx.query("SELECT count(DISTINCT s.id)::text AS n FROM hyperfide.agent_sessions s LEFT JOIN hyperfide.hierarchy_child_registrations c ON c.organisation_id=s.organisation_id AND c.run_id=s.run_id AND c.child_session_id=s.id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.attempt_id=$3 AND s.role='WORKER' AND (c.child_session_id IS NOT NULL OR EXISTS(SELECT 1 FROM hyperfide.agent_sessions p WHERE p.organisation_id=s.organisation_id AND p.run_id=s.run_id AND p.id=s.parent_session_id AND p.role='WORKER')) AND ((s.native_session_id IS NOT NULL AND s.state IN ('REGISTERED','RUNNING','DISCONNECTED')) OR EXISTS(SELECT 1 FROM hyperfide.hierarchy_child_reservations l JOIN hyperfide.reservations r ON r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id WHERE l.organisation_id=s.organisation_id AND l.run_id=s.run_id AND l.child_session_id=s.id AND r.state<>'RELEASED') OR EXISTS(SELECT 1 FROM hyperfide.sandbox_execution_charges x WHERE x.organisation_id=s.organisation_id AND x.run_id=s.run_id AND x.id=c.sandbox_charge_id AND x.state<>'RELEASED'))",[a.organisation_id,a.run_id,token.attempt_id]);
   if(BigInt(count.rows[0]!.n)>=BigInt(policy.resource_requirements.max_descendants))return refuse('CHILD_LIMIT','Accepted descendant limit is exhausted, including uncertain cleanup');
   const manager=await currentManager(tx,a,packageId);
   await tx.query("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id,state) VALUES($1,$2,$3,'WORKER',$4,$5,$6,NULL,$7,$8,$9,$10,'REGISTERED')",
    [a.organisation_id,a.run_id,childId,parentId,parent.connector,parent.account_key,token.slot_id,token.sandbox_id,token.sandbox_boot_generation,token.attempt_id]);
   await tx.query('INSERT INTO hyperfide.hierarchy_session_packages(organisation_id,run_id,session_id,package_id,registered_by) VALUES($1,$2,$3,$4,$5)',[a.organisation_id,a.run_id,childId,packageId,a.session_id]);
   await tx.query('INSERT INTO hyperfide.hierarchy_child_registrations(organisation_id,run_id,child_session_id,parent_session_id,manager_session_id,package_id,package_generation,task_id,attempt_id,attempt_generation,authority_epoch,sandbox_id,slot_id,sandbox_boot_generation,packet_digest,reservation_request_id,sandbox_charge_id,registered_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
    [a.organisation_id,a.run_id,childId,parentId,manager,packageId,auth.package_generation,token.task_id,token.attempt_id,token.attempt_generation,a.authority_epoch,token.sandbox_id,token.slot_id,token.sandbox_boot_generation,compute.input_packet_digest,reservationRequest,chargeId,a.invocation.principal.credential_id]);
   const reservationIds:string[]=[];
   for(const value of reserved){if(!object(value))return refuse('CHILD_CAPACITY_INVALID','Actual capacity reservation is invalid');const id=uuid(value.id);reservationIds.push(id);
    await tx.query('INSERT INTO hyperfide.hierarchy_child_reservations(organisation_id,run_id,child_session_id,reservation_id) VALUES($1,$2,$3,$4)',[a.organisation_id,a.run_id,childId,id]);
    await tx.query('UPDATE hyperfide.reservations SET expires_at=$1,state_version=state_version+1 WHERE organisation_id=$2 AND run_id=$3 AND id=$4',[compute.lease_expires_at,a.organisation_id,a.run_id,id]);}
   return {child_session_id:childId,parent_session_id:parentId,manager_session_id:manager,package_id:packageId,package_generation:auth.package_generation,attempt_id:token.attempt_id,reservation_ids:reservationIds,sandbox_charge_id:chargeId,state:'REGISTERED',native_session_id:null,launch_authority:false,credential_authority:false};
  });
 },
 'hierarchy.child.usage.observe':async(input,current)=>{
  const v=record(input,['idempotency_key','leader_generation','package_generation','child_session_id','sample_id','usage']),a=trustedActor(current),childId=uuid(v.child_session_id),sampleId=uuid(v.sample_id);
  const u=record(v.usage,USAGE),usage=Object.fromEntries(USAGE.map(k=>[k,decimal(u[k],true)])) as Record<typeof USAGE[number],string>;
  return operation(g,a,'hierarchy.child.usage.observe',v,async tx=>{
   await schema(tx);await childAuthority(tx,a,childId,v);
   const child=await childRegistration(tx,{organisation_id:a.organisation_id,run_id:a.run_id,child_session_id:childId});
   // Observation is the descendant heartbeat: parent compute must be current and child capacity follows its renewed lease.
   const compute=await assertCurrentCompute(tx,childToken(child),{operation:'CHECKPOINT'});
   const aligned=await alignChildCapacity(tx,{organisation_id:a.organisation_id,run_id:a.run_id,child_session_id:childId,lease_expires_at:compute.lease_expires_at});
   const last=await tx.query('SELECT model_input_tokens::text,model_output_tokens::text FROM hyperfide.hierarchy_child_usage WHERE organisation_id=$1 AND run_id=$2 AND child_session_id=$3 ORDER BY observed_at DESC,sample_id LIMIT 1',[a.organisation_id,a.run_id,childId]);
   if(last.rows[0]&&(BigInt(usage.model_input_tokens)<BigInt(last.rows[0].model_input_tokens)||BigInt(usage.model_output_tokens)<BigInt(last.rows[0].model_output_tokens)))return refuse('USAGE_REGRESSION','Cumulative model usage cannot decrease');
   const charged=(child.sandbox_charge as {resources:Record<string,string>}).resources;
   const within=(['cpu_millis','memory_bytes','disk_bytes'] as const).every(k=>BigInt(usage[k])<=BigInt(charged[k]!));
   await tx.query('INSERT INTO hyperfide.hierarchy_child_usage(organisation_id,run_id,child_session_id,sample_id,cpu_millis,memory_bytes,disk_bytes,model_input_tokens,model_output_tokens,within_reservation,observed_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [a.organisation_id,a.run_id,childId,sampleId,usage.cpu_millis,usage.memory_bytes,usage.disk_bytes,usage.model_input_tokens,usage.model_output_tokens,within,a.invocation.principal.credential_id]);
   return {child_session_id:childId,sample_id:sampleId,usage,charged,within_reservation:within,parent_lease_expires_at:compute.lease_expires_at,capacity_reservations_extended:aligned,execution_authority:false};
  });
 },
 'hierarchy.child.release':async(input,current)=>{
  const v=record(input,['idempotency_key','leader_generation','package_generation','child_session_id','observed_state','reason']),a=trustedActor(current),childId=uuid(v.child_session_id),reason=text(v.reason,4096);
  const observed=v.observed_state;if(observed!=='UNBOUND'&&observed!=='STOPPED'&&observed!=='FAILED')return refuse('INVALID_REQUEST','Release requires an observed UNBOUND, STOPPED or FAILED descendant state');
  return operation(g,a,'hierarchy.child.release',v,async tx=>{
   await schema(tx);await childAuthority(tx,a,childId,v);
   const sessions=await tx.query('SELECT state,native_session_id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[a.organisation_id,a.run_id,childId]);
   const found=await childState(tx,a.organisation_id,a.run_id,childId),session=sessions.rows[0];
   if(!found||!session)return refuse('CHILD_REGISTRATION_REQUIRED','No charged native descendant registration exists');
   if(found.release)return refuse('CHILD_RELEASED','The descendant was already released');
   if((session.native_session_id===null)!==(observed==='UNBOUND'))return refuse('CHILD_STATE_MISMATCH','Observed state must match whether a native identity was ever bound');
   if(observed!=='UNBOUND'&&LIVE.includes(session.state))
    await tx.query('UPDATE hyperfide.agent_sessions SET state=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[a.organisation_id,a.run_id,childId,observed]);
   // Logical release only: counters stay held until the scheduler records observed quiescence.
   await markSandboxReleasePending(tx,{organisation_id:a.organisation_id,run_id:a.run_id,request_id:uuid(found.row.reservation_request_id)});
   const pending=await tx.query("UPDATE hyperfide.reservations r SET state='RELEASE_PENDING',state_version=r.state_version+1 FROM hyperfide.hierarchy_child_reservations l WHERE l.organisation_id=$1 AND l.run_id=$2 AND l.child_session_id=$3 AND r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id AND r.state IN ('PROVISIONING','ALLOCATED') RETURNING r.id",[a.organisation_id,a.run_id,childId]);
   await tx.query('INSERT INTO hyperfide.hierarchy_child_releases(organisation_id,run_id,child_session_id,observed_state,reason,released_by_credential_id) VALUES($1,$2,$3,$4,$5,$6)',[a.organisation_id,a.run_id,childId,observed,reason,a.invocation.principal.credential_id]);
   return {child_session_id:childId,observed_state:observed,release_pending_reservation_ids:pending.rows.map(r=>r.id).sort(),sandbox_charge_state:'RELEASE_PENDING',resources_still_counted:true,execution_authority:false};
  });
 },
 'hierarchy.child.verify':async(input,current)=>{
  const v=record(input,['leader_generation','package_generation','session_id']),a=trustedActor(current),sessionId=uuid(v.session_id);
  return g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyReadGuard(a),signal:a.signal},async tx=>{
   await schema(tx);
   const rows=await tx.query('SELECT t.feature_package_id FROM hyperfide.agent_sessions s JOIN hyperfide.attempts x ON x.organisation_id=s.organisation_id AND x.run_id=s.run_id AND x.id=s.attempt_id JOIN hyperfide.tasks t ON t.organisation_id=x.organisation_id AND t.run_id=x.run_id AND t.id=x.task_id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.id=$3',[a.organisation_id,a.run_id,sessionId]);
   if(!rows.rows[0])return refuse('SESSION_NOT_LIVE','No worker seat is attached to a package attempt');
   await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:rows.rows[0].feature_package_id,package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER']});
   const found=await assertChildExecutionAuthority(tx,{organisation_id:a.organisation_id,run_id:a.run_id,session_id:sessionId});
   return {...found,accounted:true,execution_authority:false};
  });
 },
 'hierarchy.adoption.propose':async(input,current)=>{
  const v=record(input,['idempotency_key','leader_generation','package_ids','expected_generations','successor_id','context']),a=trustedActor(current),ids=strings(v.package_ids).map(uuid).sort();
  // Refuse before any handoff exists so unaccounted descendants never reach a pending ownership change.
  await g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyReadGuard(a),signal:a.signal},async tx=>{
   await schema(tx);await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),roles:['LEADER']});
   requireAccounted(await liveDescendants(tx,a,{package_ids:ids}));
  });
  const proposed=await handoff.propose(input,current);
  if(!object(proposed))return refuse('HANDOFF_INVALID','Handoff proposal returned no record');
  const handoffId=uuid(proposed.handoff_id);
  const adoption=await g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyWriteGuard(a),signal:a.signal},async tx=>{
   await schema(tx);
   const old=await tx.query('SELECT descendants,descendants_digest FROM hyperfide.hierarchy_adoptions WHERE organisation_id=$1 AND run_id=$2 AND handoff_id=$3',[a.organisation_id,a.run_id,handoffId]);
   if(old.rows[0])return {descendants:old.rows[0].descendants as Record<string,unknown>[],descendants_digest:String(old.rows[0].descendants_digest)};
   const found=await liveDescendants(tx,a,{package_ids:ids});requireAccounted(found);
   const descendants=found.map(d=>({...identity(d),status:d.status,reason:d.reason})),digestValue=hash(descendants);
   await tx.query('INSERT INTO hyperfide.hierarchy_adoptions(organisation_id,run_id,handoff_id,predecessor_id,successor_id,package_ids,descendants,descendants_digest,proposed_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [a.organisation_id,a.run_id,handoffId,uuid(proposed.predecessor_id),uuid(proposed.successor_id),JSON.stringify(ids),JSON.stringify(descendants),digestValue,a.invocation.principal.credential_id]);
   return {descendants,descendants_digest:digestValue};
  });
  return {...proposed,...adoption,adoptable:adoption.descendants.filter(d=>d.status==='ACCOUNTED').map(d=>d.session_id)};
 },
 'hierarchy.adoption.acknowledge':async(input,current)=>{
  const v=record(input,['idempotency_key','leader_generation','handoff_id']),a=trustedActor(current),handoffId=uuid(v.handoff_id);
  const load=async(tx:PrimaryTransaction)=>{
   const rows=await tx.query('SELECT successor_id,package_ids,descendants FROM hyperfide.hierarchy_adoptions WHERE organisation_id=$1 AND run_id=$2 AND handoff_id=$3',[a.organisation_id,a.run_id,handoffId]);
   const row=rows.rows[0];if(!row)return refuse('ADOPTION_REQUIRED','The handoff has no persisted descendant adoption record');
   if(row.successor_id!==a.session_id)return refuse('HANDOFF_SUCCESSOR_MISMATCH','Only the recorded successor can adopt descendants');
   const done=await tx.query('SELECT adopted,not_adopted,before_digest,after_digest,workers_restarted FROM hyperfide.hierarchy_adoption_acknowledgements WHERE organisation_id=$1 AND run_id=$2 AND handoff_id=$3',[a.organisation_id,a.run_id,handoffId]);
   return {package_ids:(row.package_ids as string[]).map(uuid),snapshot:row.descendants as Record<string,any>[],done:done.rows[0] as Record<string,unknown>|undefined};
  };
  const before=await g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyReadGuard(a),signal:a.signal},async tx=>{
   await schema(tx);const loaded=await load(tx);if(loaded.done)return loaded;
   const found=await liveDescendants(tx,a,{package_ids:loaded.package_ids});requireAccounted(found);
   for(const d of loaded.snapshot.filter(x=>x.status==='ACCOUNTED')){
    const now=found.find(x=>x.session_id===d.session_id);
    if(now&&now.status==='ACCOUNTED'&&!continues(d,now))return refuse('ADOPTION_DESCENDANT_CHANGED','A recorded descendant changed executor or identity; propose a fresh adoption');
   }
   return {...loaded,observed:found.filter(x=>x.status==='ACCOUNTED').map(identity)};
  });
  const acknowledged=await handoff.acknowledge(input,current);
  if(!object(acknowledged))return refuse('HANDOFF_INVALID','Handoff acknowledgement returned no record');
  const outcome=await g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyWriteGuard(a),signal:a.signal},async tx=>{
   await schema(tx);const loaded=await load(tx);if(loaded.done)return loaded.done;
   if(!('observed' in before))return refuse('ADOPTION_REQUIRED','The adoption pre-acknowledgement observation is absent');
   const after=await liveDescendants(tx,a,{package_ids:loaded.package_ids});
   const adopted:string[]=[],notAdopted:{session_id:string;reason:string}[]=[];let restarted=false;
   for(const d of before.observed){
    const now=after.find(x=>x.session_id===d.session_id);
    if(continues(d,now)){adopted.push(d.session_id);continue;}
    // A different live seat on the same task replacing a healthy one is a restart, not continuation.
    const replacement=after.some(x=>x.task_id===d.task_id&&x.kind===d.kind&&x.session_id!==d.session_id&&!before.observed.some(y=>y.session_id===x.session_id));
    restarted||=replacement;notAdopted.push({session_id:d.session_id,reason:replacement?'REPLACED':now?String(now.reason??'CHANGED'):'ENDED'});
   }
   for(const d of loaded.snapshot.filter(x=>x.status!=='ACCOUNTED'))notAdopted.push({session_id:d.session_id,reason:String(d.reason)});
   const result={adopted:adopted.sort(),not_adopted:notAdopted.sort((x,y)=>x.session_id.localeCompare(y.session_id)),before_digest:hash(before.observed),after_digest:hash(after.map(identity)),workers_restarted:restarted};
   await tx.query('INSERT INTO hyperfide.hierarchy_adoption_acknowledgements(organisation_id,run_id,handoff_id,successor_id,adopted,not_adopted,before_digest,after_digest,workers_restarted,acknowledged_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [a.organisation_id,a.run_id,handoffId,a.session_id,JSON.stringify(result.adopted),JSON.stringify(result.not_adopted),result.before_digest,result.after_digest,result.workers_restarted,a.invocation.principal.credential_id]);
   return result;
  });
  const {workers_restarted:_literal,...handed}=acknowledged;
  return {...handed,adopted_descendants:outcome.adopted,not_adopted:outcome.not_adopted,before_digest:outcome.before_digest,after_digest:outcome.after_digest,workers_restarted:outcome.workers_restarted};
 },
 'hierarchy.adoption.inspect':async(input,current)=>{
  const v=record(input,['leader_generation','package_id','package_generation']),a=trustedActor(current),packageId=uuid(v.package_id);
  return g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyReadGuard(a),signal:a.signal},async tx=>{
   await schema(tx);
   const auth=await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:packageId,package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER']});
   const sessions=await tx.query('SELECT s.id,s.parent_session_id,s.role,s.state,s.native_session_id,s.attempt_id,s.sandbox_id,s.slot_id,s.sandbox_boot_generation::text,t.id AS task_id,t.state AS task_state,a.compute_authority,a.execution_state FROM hyperfide.agent_sessions s JOIN hyperfide.attempts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND a.id=s.attempt_id JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.feature_package_id=$3 ORDER BY s.id LIMIT 257',[a.organisation_id,a.run_id,packageId]);
   const found=await liveDescendants(tx,a,{package_ids:[packageId]});
   const registered=await tx.query("SELECT c.child_session_id,c.parent_session_id,c.manager_session_id AS registering_manager_session_id,c.task_id,c.attempt_id,c.attempt_generation::text,c.sandbox_id,c.slot_id,c.sandbox_boot_generation::text,c.reservation_request_id,c.created_at::text AS registered_at,s.state,s.native_session_id,x.state AS sandbox_charge_state,x.cpu_millis::text AS charged_cpu_millis,x.memory_bytes::text AS charged_memory_bytes,x.disk_bytes::text AS charged_disk_bytes,p.lease_expires_at::text AS parent_lease_expires_at,(SELECT min(r.expires_at) FROM hyperfide.hierarchy_child_reservations l JOIN hyperfide.reservations r ON r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id WHERE l.organisation_id=c.organisation_id AND l.run_id=c.run_id AND l.child_session_id=c.child_session_id AND r.state IN ('PROVISIONING','ALLOCATED'))::text AS capacity_expires_at,COALESCE((SELECT min(r.expires_at) FROM hyperfide.hierarchy_child_reservations l JOIN hyperfide.reservations r ON r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id WHERE l.organisation_id=c.organisation_id AND l.run_id=c.run_id AND l.child_session_id=c.child_session_id AND r.state IN ('PROVISIONING','ALLOCATED'))>=p.lease_expires_at,false) AS capacity_aligned,rel.observed_state AS released_observed_state,rel.released_at::text FROM hyperfide.hierarchy_child_registrations c JOIN hyperfide.agent_sessions s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.child_session_id JOIN hyperfide.sandbox_execution_charges x ON x.organisation_id=c.organisation_id AND x.run_id=c.run_id AND x.id=c.sandbox_charge_id JOIN hyperfide.attempts p ON p.organisation_id=c.organisation_id AND p.run_id=c.run_id AND p.id=c.attempt_id LEFT JOIN hyperfide.hierarchy_child_releases rel ON rel.organisation_id=c.organisation_id AND rel.run_id=c.run_id AND rel.child_session_id=c.child_session_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.package_id=$3 ORDER BY c.child_session_id LIMIT 257",[a.organisation_id,a.run_id,packageId]);
   const childIds=registered.rows.slice(0,256).map(r=>r.child_session_id);
   const reservations=await tx.query('SELECT l.child_session_id,r.id,r.capacity_account_id,k.dimension,r.quantity::text,r.state,r.expires_at::text FROM hyperfide.hierarchy_child_reservations l JOIN hyperfide.reservations r ON r.organisation_id=l.organisation_id AND r.run_id=l.run_id AND r.id=l.reservation_id JOIN hyperfide.capacity_accounts k ON k.organisation_id=r.organisation_id AND k.id=r.capacity_account_id WHERE l.organisation_id=$1 AND l.run_id=$2 AND l.child_session_id=ANY($3::uuid[]) ORDER BY l.child_session_id,k.dimension',[a.organisation_id,a.run_id,childIds]);
   const usage=await tx.query('SELECT child_session_id,count(*)::text AS samples,max(cpu_millis)::text AS peak_cpu_millis,max(memory_bytes)::text AS peak_memory_bytes,max(disk_bytes)::text AS peak_disk_bytes,max(model_input_tokens)::text AS model_input_tokens,max(model_output_tokens)::text AS model_output_tokens,bool_and(within_reservation) AS within_reservation,max(observed_at)::text AS last_observed_at FROM hyperfide.hierarchy_child_usage WHERE organisation_id=$1 AND run_id=$2 AND child_session_id=ANY($3::uuid[]) GROUP BY child_session_id',[a.organisation_id,a.run_id,childIds]);
   const children=registered.rows.slice(0,256).map(c=>{
    const {child_session_id:_r,...used}=usage.rows.find(u=>u.child_session_id===c.child_session_id)??{child_session_id:null,samples:'0'};
    return {...c,reservations:reservations.rows.filter(r=>r.child_session_id===c.child_session_id).map(({child_session_id:_c,...r})=>r),usage:used,status:found.find(d=>d.session_id===c.child_session_id)?.status??(c.released_observed_state?'RELEASED':'ENDED')};
   });
   const adoptions=await tx.query('SELECT d.handoff_id,d.predecessor_id,d.successor_id,d.descendants_digest,d.created_at::text AS proposed_at,k.adopted,k.not_adopted,k.workers_restarted,k.created_at::text AS acknowledged_at FROM hyperfide.hierarchy_adoptions d LEFT JOIN hyperfide.hierarchy_adoption_acknowledgements k ON k.organisation_id=d.organisation_id AND k.run_id=d.run_id AND k.handoff_id=d.handoff_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.package_ids ? $3 ORDER BY d.created_at DESC,d.handoff_id LIMIT 16',[a.organisation_id,a.run_id,packageId]);
   const unaccounted=found.filter(d=>d.status==='UNACCOUNTED').map(d=>d.session_id);
   return {package_id:packageId,package_generation:auth.package_generation,current_manager_session_id:await currentManager(tx,a,packageId),sessions:sessions.rows.slice(0,256),omitted_at_least:Math.max(0,sessions.rows.length-256),
    descendants:found,children,children_omitted:registered.rows.length>256,unaccounted_descendants:unaccounted,adoptable:unaccounted.length===0,adoptions:adoptions.rows,authority:'NONE',ancestry:'IMMUTABLE; accountability follows current package ownership'};
  });
 }
 }};
}

export interface WorkerRegistrationInput {
 organisation_id:string;run_id:string;command_id:string;token:ComputeToken;packet_digest:string;payload_digest:string;
}
export interface WorkerRegistrationReceipt {
 session_id:string;registration_receipt_digest:string;native_session_id:string|null;state:string;execution_authority:false;
}
export interface WorkerRegistrationAuthority {
 registerWorker:(tx:PrimaryTransaction,input:WorkerRegistrationInput,invocation:InvocationContext)=>Promise<WorkerRegistrationReceipt>;
}
export function isWorkerRegistrationAuthority(value:unknown):value is WorkerRegistrationAuthority {
 return object(value)&&typeof value.registerWorker==='function';
}
async function workerSchema(tx:PrimaryTransaction){
 await schema(tx);
 const table=await tx.query("SELECT to_regclass('hyperfide.hierarchy_worker_registrations') IS NOT NULL AS ready");
 if(!table.rows[0]?.ready)return refuse('WORKER_REGISTRATION_SCHEMA_REQUIRED','Apply trusted normal-worker registration migration first');
}
/** An observed native identity is attached later by the actual runner/native binder. */
async function workerSeat(tx:PrimaryTransaction,token:ComputeToken,packetDigest:string,native:NativeAuthAuthority,i:InvocationContext):Promise<WorkerRegistrationReceipt>{
 assertPrimaryTransaction(tx);assertInvocation(i);await readSemanticDisposition(tx,token);await i.guard(tx);await workerSchema(tx);
 if(token.organisation_id!==i.principal.organisation_id||token.run_id!==i.principal.run_id||token.authority_epoch!==i.principal.deployment_epoch)return refuse('ACTOR_SCOPE_MISMATCH','Worker registration targets another authenticated scope');
 const compute=await assertCurrentCompute(tx,token,{operation:'ADMISSION'});
 if(compute.input_packet_digest!==packetDigest)return refuse('WORKER_PACKET_MISMATCH','Registration requires the actual claimed immutable packet');
 const loaded=await validateExecutionInputs(tx,{organisation_id:token.organisation_id,run_id:token.run_id,digest:packetDigest},i),m=loaded.packet.mandatory;
 if(!object(m)||!object(m.identity)||!object(m.runtime)||!object(m.runtime.execution_profile))return refuse('WORKER_PACKET_MISMATCH','Claimed packet lacks accepted native execution intent');
 const identity=m.identity,execution=m.runtime.execution_profile;
 for(const key of ['task_id','attempt_id','attempt_generation','authority_epoch'])if(identity[key]!==token[key as keyof ComputeToken])return refuse('WORKER_PACKET_MISMATCH','Accepted worker identity differs from current claim');
 if(m.runtime.sandbox_id!==token.sandbox_id||m.runtime.slot_id!==token.slot_id||m.runtime.sandbox_boot_generation!==token.sandbox_boot_generation)return refuse('WORKER_PACKET_MISMATCH','Worker executor differs from accepted packet');
 const profileId=name(execution.model_profile_ref),resolved=await native.privateRuntimeInTransaction(tx,i,profileId),snapshot=resolved.snapshot;
 const connector=execution.connector==='claude-code'?'claude':execution.connector;
 if(connector!==snapshot.connector||execution.credential_profile_ref!==snapshot.credential_reference)return refuse('WORKER_NATIVE_PROFILE_MISMATCH','Protected native profile connector or credential differs from accepted intent');
 const account=name(resolved.configured_account_key),parentId=uuid(identity.parent_session_id),packageId=uuid(identity.package_id);
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[token.organisation_id+':'+token.run_id+':worker-seat:'+token.attempt_id]);
 const old=await tx.query('SELECT w.*,w.attempt_generation::text,w.sandbox_boot_generation::text,s.native_session_id,s.state FROM hyperfide.hierarchy_worker_registrations w JOIN hyperfide.agent_sessions s ON s.organisation_id=w.organisation_id AND s.run_id=w.run_id AND s.id=w.session_id WHERE w.organisation_id=$1 AND w.run_id=$2 AND w.attempt_id=$3 FOR SHARE OF s',[token.organisation_id,token.run_id,token.attempt_id]);
 if(old.rows[0]){
  const row=old.rows[0];
  if(row.attempt_generation!==token.attempt_generation||row.packet_digest!==packetDigest||row.slot_id!==token.slot_id||row.sandbox_id!==token.sandbox_id||row.sandbox_boot_generation!==token.sandbox_boot_generation||row.native_profile_id!==profileId||row.native_profile_digest!==snapshot.profile_digest||row.account_key!==account||row.connector!==connector)return refuse('WORKER_REGISTRATION_CONFLICT','An attempt already has a different immutable worker seat');
  return {session_id:uuid(row.session_id),registration_receipt_digest:digest(row.registration_receipt_digest),native_session_id:row.native_session_id,state:String(row.state),execution_authority:false};
 }
 const id=randomUUID(),receipt=hash({schema_version:1,organisation_id:token.organisation_id,run_id:token.run_id,session_id:id,token,packet_digest:packetDigest,parent_session_id:parentId,package_id:packageId,native_profile_id:profileId,native_profile_digest:snapshot.profile_digest,connector,configured_account_key:account});
 await tx.query("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,parent_session_id,connector,account_key,native_session_id,slot_id,sandbox_id,sandbox_boot_generation,attempt_id,state) VALUES($1,$2,$3,'WORKER',$4,$5,$6,NULL,$7,$8,$9,$10,'REGISTERED')",[token.organisation_id,token.run_id,id,parentId,connector,account,token.slot_id,token.sandbox_id,token.sandbox_boot_generation,token.attempt_id]);
 await tx.query('INSERT INTO hyperfide.hierarchy_worker_registrations(organisation_id,run_id,session_id,task_id,attempt_id,attempt_generation,authority_epoch,sandbox_id,slot_id,sandbox_boot_generation,packet_digest,parent_session_id,package_id,native_profile_id,native_profile_digest,connector,account_key,registration_receipt_digest,registered_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)',[token.organisation_id,token.run_id,id,token.task_id,token.attempt_id,token.attempt_generation,token.authority_epoch,token.sandbox_id,token.slot_id,token.sandbox_boot_generation,packetDigest,parentId,packageId,profileId,snapshot.profile_digest,connector,account,receipt,i.principal.credential_id]);
 return {session_id:id,registration_receipt_digest:receipt,native_session_id:null,state:'REGISTERED',execution_authority:false};
}
export function createWorkerComponent(context:ComponentContext):Component{
 const g=gateway(context),native=context.dependencies.require('14.3','identity.native-auth',isNativeAuthAuthority);
 const registerWorker:WorkerRegistrationAuthority['registerWorker']=async(tx,input,i)=>{
  assertPrimaryTransaction(tx);assertInvocation(i);await readSemanticDisposition(tx,input);await i.guard(tx);
  const v=record(input,['organisation_id','run_id','command_id','token','packet_digest','payload_digest']),token=parseComputeToken(v.token);
  if(!['OPERATOR','COORDINATOR','DISPATCH'].includes(i.principal.role)||uuid(v.organisation_id)!==i.principal.organisation_id||uuid(v.run_id)!==i.principal.run_id)return refuse('ROLE_DENIED','Actual dispatch controller and same-scope command required');
  const command=uuid(v.command_id),packet=digest(v.packet_digest),payload=digest(v.payload_digest),expected={command_id:command,token,packet_digest:packet};
  if(hash(expected)!==payload)return refuse('WORKER_DISPATCH_MISMATCH','Committed dispatch payload digest preimage differs');
  const rows=await tx.query("SELECT d.*,d.attempt_generation::text,d.sandbox_boot_generation::text,e.aggregate_type,e.aggregate_id,e.aggregate_version::text,e.event_type,e.payload FROM hyperfide.scheduler_dispatches d JOIN hyperfide.outbox_events e ON e.organisation_id=d.organisation_id AND e.run_id=d.run_id AND e.id=d.event_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.id=$3 FOR SHARE OF d,e",[i.principal.organisation_id,i.principal.run_id,command]);
  const row=rows.rows[0];
  if(!row||!['INTENT','UNKNOWN'].includes(String(row.state))||row.aggregate_type!=='scheduler-spawn'||row.aggregate_id!==command||row.aggregate_version!=='1'||row.event_type!=='runner.spawn.requested'||row.payload_digest!==payload||canonical(row.payload)!==canonical({...expected,payload_digest:payload}))return refuse('WORKER_DISPATCH_MISMATCH','The exact committed scheduler spawn event is required');
  for(const key of ['task_id','attempt_id','attempt_generation','authority_epoch','sandbox_id','slot_id','sandbox_boot_generation'])if(String(row[key])!==String(token[key as keyof ComputeToken]))return refuse('WORKER_DISPATCH_MISMATCH','Dispatch journal differs from current worker tuple');
  return workerSeat(tx,token,packet,native,i);
 };
 return {apiVersion:1,capabilities:{'hierarchy.worker-registration.v1':Object.freeze({registerWorker})},actions:{
  'hierarchy.worker.register':async(input,current)=>{
   const v=record(input,['idempotency_key','leader_generation','package_generation','token']),a=trustedActor(current),token=parseComputeToken(v.token);
   const guarded={...a,guard:async(tx:PrimaryTransaction)=>{
    await a.guard(tx);
    const task=await tx.query('SELECT feature_package_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[a.organisation_id,a.run_id,token.task_id]);
    await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:uuid(task.rows[0]?.feature_package_id),package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER']});
   }};
   return operation(g,guarded,'hierarchy.worker.register',v,async tx=>{
    const compute=await assertCurrentCompute(tx,token,{operation:'ADMISSION'});
    return workerSeat(tx,token,compute.input_packet_digest,native,a.invocation);
   });
  }
 }};
}
