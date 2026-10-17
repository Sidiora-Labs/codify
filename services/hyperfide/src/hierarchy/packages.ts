import {readSemanticDisposition,writeSemanticDisposition} from '../storage/dispositions.js';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {invocationOf} from '../identity/enrollment.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction,TransactionGateway} from '../storage/transactions.js';

export type SessionRole='LEADER'|'FEATURE_MANAGER'|'WORKER'|'COMMIT_WATCHER'|'ISSUE_WATCHER'|'VERIFIER'|'INTEGRATOR'|'INDEXER';
export interface Scope {organisation_id:string;run_id:string}
export interface AuthorityRequest extends Scope {
 authority_epoch:string;session_id:string;leader_generation:string;
 package_id?:string;package_generation?:string;roles:readonly SessionRole[];
}
export interface Leadership extends Scope {authority_epoch:string;leader_session_id:string;leader_generation:string}
export interface AuthorityView extends Leadership {session_id:string;role:SessionRole;package_id?:string;package_generation?:string}
export interface HierarchyAuthority {
 leadership(tx:PrimaryTransaction,scope:Scope):Promise<Leadership>;
 requireAuthority(tx:PrimaryTransaction,input:AuthorityRequest):Promise<AuthorityView>;
 requireLeaderReplacement(tx:PrimaryTransaction,input:LeaderReplacementRequest):Promise<Record<string,unknown>>;
}

export interface LeaderReplacementRequest extends Scope {
 actor_session_id:string;current_leader_generation:string;predecessor_session_id:string;
 predecessor_generation:string;predecessor_authority_epoch:string;
}
/** Immutable replacement proof for adopting an already-persisted leader-targeted intent. */
export async function requireLeaderReplacement(tx:PrimaryTransaction,input:LeaderReplacementRequest):Promise<Record<string,unknown>>{
 assertPrimaryTransaction(tx);await ready(tx);
 const org=uuid(input.organisation_id),run=uuid(input.run_id),actorId=uuid(input.actor_session_id);
 const currentGeneration=decimal(input.current_leader_generation),priorGeneration=decimal(input.predecessor_generation),priorId=uuid(input.predecessor_session_id),priorEpoch=uuid(input.predecessor_authority_epoch);
 const current=await leadership(tx,{organisation_id:org,run_id:run});
 await requireAuthority(tx,{organisation_id:org,run_id:run,authority_epoch:current.authority_epoch,session_id:actorId,leader_generation:currentGeneration,roles:['LEADER']});
 if(BigInt(priorGeneration)>=BigInt(currentGeneration)||BigInt(currentGeneration)-BigInt(priorGeneration)>1024n)return refuse('LEADER_REPLACEMENT_UNPROVEN','A bounded actual replacement chain is required');
 const selectionSchema=await tx.query("SELECT to_regclass('hyperfide.hierarchy_leadership_selections') IS NOT NULL AS ready");
 const source="SELECT id,actor_session_id,leader_generation,payload,'OWNERSHIP_EVENT'::text AS proof_kind FROM hyperfide.hierarchy_ownership_events WHERE organisation_id=$1 AND run_id=$2 AND kind='LEADER_ACQUIRED' AND leader_generation >= $3 AND leader_generation <= $4";
 const selections=" UNION ALL SELECT id,leader_session_id AS actor_session_id,leader_generation,jsonb_build_object('authority_epoch',authority_epoch,'predecessor_id',predecessor_session_id,'predecessor_generation',predecessor_generation::text,'predecessor_authority_epoch',predecessor_authority_epoch),'LEADERSHIP_SELECTION'::text AS proof_kind FROM hyperfide.hierarchy_leadership_selections WHERE organisation_id=$1 AND run_id=$2 AND leader_generation >= $3 AND leader_generation <= $4";
 const found=await tx.query("SELECT id,actor_session_id,leader_generation::text,payload,proof_kind FROM ("+source+(selectionSchema.rows[0]?.ready?selections:"")+") history ORDER BY leader_generation::bigint,id",[org,run,priorGeneration,currentGeneration]);
 const expected=Number(BigInt(currentGeneration)-BigInt(priorGeneration)+1n);
 if(found.rowCount!==expected)return refuse('LEADER_REPLACEMENT_UNPROVEN','Immutable leadership replacement history is incomplete or ambiguous');
 let session=priorId,epoch=priorEpoch,generation=priorGeneration;
 const eventIds:string[]=[],proofRefs:{kind:string;id:string}[]=[];
 for(let index=0;index<found.rows.length;index++){
  const row=found.rows[index]!,p=row.payload;
  if(!object(p)||row.leader_generation!==(BigInt(priorGeneration)+BigInt(index)).toString()||typeof p.authority_epoch!=='string')return refuse('LEADER_REPLACEMENT_UNPROVEN','History lacks exact platform epoch pins');
  uuid(p.authority_epoch);
  if(index===0){
   if(row.actor_session_id!==priorId||p.authority_epoch!==priorEpoch)return refuse('LEADER_REPLACEMENT_UNPROVEN','Original event target is not proven by immutable history');
  }else{
   if(p.predecessor_id!==session||p.predecessor_generation!==generation||p.predecessor_authority_epoch!==epoch)return refuse('LEADER_REPLACEMENT_UNPROVEN','Replacement history is not a contiguous actor/generation/epoch chain');
  }
  session=uuid(row.actor_session_id);epoch=p.authority_epoch;generation=row.leader_generation;eventIds.push(uuid(row.id));proofRefs.push(Object.freeze({kind:String(row.proof_kind),id:uuid(row.id)}));
 }
 if(session!==actorId||session!==current.leader_session_id||generation!==currentGeneration||epoch!==current.authority_epoch)return refuse('LEADER_REPLACEMENT_UNPROVEN','Replacement chain does not terminate at the current primary leader');
 const proof={organisation_id:org,run_id:run,predecessor_session_id:priorId,predecessor_generation:priorGeneration,predecessor_authority_epoch:priorEpoch,
  current_leader_session_id:session,current_leader_generation:generation,current_authority_epoch:epoch,event_ids:eventIds,proof_refs:proofRefs};
 return Object.freeze({authority:'LEADER_REPLACEMENT_PROOF',...proof,event_ids:Object.freeze(eventIds),proof_refs:Object.freeze(proofRefs),proof_digest:hash(proof)});
}

type Data=Record<string,unknown>;
const MIGRATION_CHECKSUM='sha256:'+createHash('sha256').update(readFileSync(new URL('../../migrations/0003-hierarchy.sql',import.meta.url))).digest('hex');
export function refuse(code:string,message:string):never {throw new FoundationError(code,message);}
export function record(value:unknown,keys:readonly string[],required:readonly string[]=keys):Data {
 if(!object(value)||Object.keys(value).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(value,k)))
  return refuse('INVALID_REQUEST','Fields do not match the bounded hierarchy operation');
 return value;
}
export function text(value:unknown,max=255):string {
 if(typeof value!=='string'||value.length<1||value.length>max||/[\u0000-\u001f\u007f]/.test(value))
  return refuse('INVALID_REQUEST','Expected bounded nonempty text');
 return value;
}
export function uuid(value:unknown):string {
 const v=text(value,36);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v))return refuse('INVALID_REQUEST','Expected canonical UUID');
 return v;
}
export function decimal(value:unknown,zero=false):string {
 if(typeof value!=='string'||!(/^(0|[1-9][0-9]*)$/).test(value)||BigInt(value)>9223372036854775807n||(!zero&&value==='0'))
  return refuse('INVALID_REQUEST','Expected canonical PostgreSQL bigint string');
 return value;
}
export function digest(value:unknown):string {
 const v=text(value,71);if(!/^sha256:[0-9a-f]{64}$/.test(v))return refuse('INVALID_REQUEST','Expected SHA256 identity');return v;
}
export function canonical(value:unknown,depth=0):string {
 if(depth>32)return refuse('INVALID_REQUEST','Value nesting limit exceeded');
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value)){if(value.length>4096)return refuse('INVALID_REQUEST','Array limit exceeded');return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';}
 if(object(value)){if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))return refuse('INVALID_REQUEST','Only plain JSON records may be canonicalised');const keys=Object.keys(value).sort();if(keys.length>1024)return refuse('INVALID_REQUEST','Object limit exceeded');return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';}
 return refuse('INVALID_REQUEST','Unsupported JSON value');
}
export function hash(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}
export function strings(value:unknown,max=256):string[] {
 if(!Array.isArray(value)||value.length>max)return refuse('INVALID_REQUEST','Expected bounded unique string array');
 const values=value.map(v=>text(v));if(new Set(values).size!==values.length)return refuse('INVALID_REQUEST','Duplicate identity');return values;
}
export function isGateway(value:unknown):value is TransactionGateway{return object(value)&&typeof value.withPrimaryTransaction==='function';}
export function gateway(context:ComponentContext):TransactionGateway {
 return context.dependencies.require('4.2','storage.transactions.v1',isGateway);
}
export function isHierarchyAuthority(value:unknown):value is HierarchyAuthority {
 return object(value)&&typeof value.leadership==='function'&&typeof value.requireAuthority==='function';
}
export async function leadership(tx:PrimaryTransaction,scope:Scope):Promise<Leadership> {
 assertPrimaryTransaction(tx);
 const result=await tx.query('SELECT authority_epoch,leader_session_id,generation::text AS leader_generation FROM hyperfide.hierarchy_leaders WHERE organisation_id=$1 AND run_id=$2 FOR SHARE',[uuid(scope.organisation_id),uuid(scope.run_id)]);
 const row=result.rows[0];if(!row)return refuse('LEADER_UNAVAILABLE','No current leader is registered');
 return {...scope,authority_epoch:row.authority_epoch,leader_session_id:row.leader_session_id,leader_generation:row.leader_generation};
}
export async function requireAuthority(tx:PrimaryTransaction,input:AuthorityRequest):Promise<AuthorityView> {
 assertPrimaryTransaction(tx);
 const org=uuid(input.organisation_id),run=uuid(input.run_id),actor=uuid(input.session_id),epoch=uuid(input.authority_epoch);
 const expected=decimal(input.leader_generation);
 const runs=await tx.query('SELECT authority_epoch,state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[org,run]);
 const r=runs.rows[0];if(!r||r.authority_epoch!==epoch)return refuse('AUTHORITY_EPOCH_STALE','Run/platform epoch is absent or stale');
 const current=await leadership(tx,{organisation_id:org,run_id:run});
 if(current.authority_epoch!==epoch||current.leader_generation!==expected)return refuse('LEADER_GENERATION_STALE','Leader generation changed');
 const sessions=await tx.query('SELECT role,state FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[org,run,actor]);
 const session=sessions.rows[0];
 if(!session||!['REGISTERED','RUNNING','DISCONNECTED'].includes(session.state)||!input.roles.includes(session.role))
  return refuse('ROLE_DENIED','Registered session role is not authorised');
 if(session.role==='LEADER'&&actor!==current.leader_session_id)return refuse('LEADER_GENERATION_STALE','Session is not the current leader');
 const result:AuthorityView={...current,session_id:actor,role:session.role};
 if(input.package_id!==undefined) {
  const id=uuid(input.package_id);
  const packages=await tx.query('SELECT p.manager_session_id,h.owner_generation::text,h.state FROM hyperfide.feature_packages p JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.id=$3 FOR SHARE OF p,h',[org,run,id]);
  const p=packages.rows[0];if(!p||['CLOSED','CANCELLED'].includes(p.state))return refuse('PACKAGE_UNAVAILABLE','Package is not current');
  if(input.package_generation===undefined||p.owner_generation!==decimal(input.package_generation))return refuse('PACKAGE_GENERATION_STALE','Package generation changed');
  if(session.role==='FEATURE_MANAGER'&&p.manager_session_id!==actor)return refuse('PACKAGE_OWNER_MISMATCH','Manager does not own the package');
  if(!['LEADER','FEATURE_MANAGER'].includes(session.role)) {
   const binding=await tx.query('SELECT 1 FROM hyperfide.hierarchy_session_packages WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3 AND package_id=$4',[org,run,actor,id]);
   if(!binding.rowCount){
    const registry=await tx.query("SELECT to_regclass('hyperfide.hierarchy_worker_registrations') IS NOT NULL AS available");
    const worker=registry.rows[0]?.available&&session.role==='WORKER'?await tx.query('SELECT 1 FROM hyperfide.hierarchy_worker_registrations WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3 AND package_id=$4',[org,run,actor,id]):null;
    if(!worker?.rowCount)return refuse('PACKAGE_OWNER_MISMATCH','Session has no immutable package role binding');
   }
  }
  result.package_id=id;result.package_generation=p.owner_generation;
 } else if(session.role==='FEATURE_MANAGER')return refuse('PACKAGE_REQUIRED','Manager authority requires an explicit package');
 return result;
}
export interface TrustedActor extends Scope {session_id:string;authority_epoch:string;guard:(tx:PrimaryTransaction)=>Promise<void>;signal:AbortSignal;invocation:InvocationContext}
export function trustedActor(context:ComponentContext):TrustedActor {
 const invocation=invocationOf(context),principal=invocation.principal;
 const run=uuid(principal.run_id);if(run!==context.policy.programme_id)return refuse('ACTOR_SCOPE_MISMATCH','Authenticated run differs from the approved programme');
 return {organisation_id:uuid(principal.organisation_id),run_id:run,session_id:uuid(principal.actor_id),
  authority_epoch:uuid(principal.deployment_epoch),guard:tx=>invocation.guard(tx),signal:invocation.signal,invocation};
}
export async function ready(tx:PrimaryTransaction):Promise<void> {
 assertPrimaryTransaction(tx);
 const names=['hierarchy_leaders','hierarchy_packages','hierarchy_domain_owners','hierarchy_handoffs','hierarchy_handoff_acknowledgements','hierarchy_session_packages','hierarchy_ownership_events'];
 const found=await tx.query('SELECT bool_and(to_regclass(\'hyperfide.\'||name) IS NOT NULL) AS ready FROM unnest($1::text[]) AS name',[names]);
 if(!found.rows[0]?.ready)return refuse('HIERARCHY_SCHEMA_REQUIRED','Apply the trusted hierarchy migration before using the hierarchy');
 const version=await tx.query("SELECT 1 FROM hyperfide.schema_migrations WHERE version=3 AND name='0003-hierarchy' AND checksum=$1",[MIGRATION_CHECKSUM]);
 if(!version.rowCount)return refuse('HIERARCHY_SCHEMA_REQUIRED','Hierarchy migration provenance is absent or differs from the trusted bytes');
}
export async function event(tx:PrimaryTransaction,actor:TrustedActor,generation:string,kind:string,payload:Data):Promise<void> {
 assertPrimaryTransaction(tx);
 await tx.query('INSERT INTO hyperfide.hierarchy_ownership_events(organisation_id,run_id,id,kind,actor_session_id,leader_generation,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [actor.organisation_id,actor.run_id,randomUUID(),kind,actor.session_id,generation,JSON.stringify(payload)]);
}
export function hierarchyReadGuard(actor:TrustedActor):(tx:PrimaryTransaction)=>Promise<void> {
 return async tx=>{await readSemanticDisposition(tx,actor);await actor.guard(tx);};
}
export function hierarchyWriteGuard(actor:TrustedActor):(tx:PrimaryTransaction)=>Promise<void> {
 return async tx=>{await writeSemanticDisposition(tx,actor);await actor.guard(tx);};
}
export async function operation<T>(g:TransactionGateway,actor:TrustedActor,name:string,input:Data,fn:(tx:PrimaryTransaction)=>Promise<T>):Promise<T> {
 const key=text(input.idempotency_key),identity=hash({name,actor:actor.session_id,input});
 const envelope=actor.invocation.operation;
 return g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyWriteGuard(actor),signal:actor.signal},async tx=>{
  await ready(tx);
  const lookup=async(operationName:string,operationKey:string,requestDigest:string)=>{
   await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,principal_scope,operation,idempotency_key,request_digest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
    [actor.organisation_id,actor.run_id,actor.session_id,operationName,operationKey,requestDigest]);
   const result=await tx.query('SELECT id,request_digest,state,result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation=$4 AND idempotency_key=$5 FOR UPDATE',
    [actor.organisation_id,actor.run_id,actor.session_id,operationName,operationKey]);
   const row=result.rows[0];if(!row||row.request_digest!==requestDigest)return refuse('IDEMPOTENCY_CONFLICT','Request key already has another payload');
   if(!['PENDING','COMPLETED'].includes(row.state))return refuse('OPERATION_FAILED','Operation has an immutable failed outcome');return row;
  };
  const finish=async(id:string,result:unknown)=>{
   await tx.query("UPDATE hyperfide.command_inbox SET state='COMPLETED',result=$1,state_version=state_version+1 WHERE organisation_id=$2 AND run_id=$3 AND id=$4",
    [JSON.stringify(result),actor.organisation_id,actor.run_id,id]);
  };
  // Bind both protocol and application keys. A fresh inner key cannot evade
  // conflicting reuse of an authenticated envelope's idempotency identity.
  const outer=await lookup('envelope.'+name,envelope.idempotency_key,envelope.payload_digest);
  if(outer.state==='COMPLETED')return outer.result as T;
  const old=await lookup(name,key,identity);
  if(old.state==='COMPLETED'){await finish(outer.id,old.result);return old.result as T;}
  const state=await tx.query('SELECT state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[actor.organisation_id,actor.run_id]);
  if(!state.rowCount||['SUCCEEDED','FAILED','CANCELLED','COMPLETED'].includes(state.rows[0]!.state))
   return refuse('RUN_TERMINAL','The run does not permit a new hierarchy mutation');
  const result=await fn(tx);await finish(old.id,result);await finish(outer.id,result);return result;
 });
}
async function manager(tx:PrimaryTransaction,actor:TrustedActor,id:string):Promise<void> {
 const found=await tx.query("SELECT 1 FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND role='FEATURE_MANAGER' AND state IN ('REGISTERED','RUNNING','DISCONNECTED') FOR SHARE",
  [actor.organisation_id,actor.run_id,id]);
 if(!found.rowCount)return refuse('MANAGER_INVALID','Successor is not a registered same-run feature manager');
}
async function packageRows(tx:PrimaryTransaction,actor:TrustedActor,ids:string[]) {
 const rows=await tx.query('SELECT h.*,h.owner_generation::text AS owner_generation,h.state_version::text AS state_version,p.manager_session_id,p.wave FROM hyperfide.hierarchy_packages h JOIN hyperfide.feature_packages p ON p.organisation_id=h.organisation_id AND p.run_id=h.run_id AND p.id=h.package_id WHERE h.organisation_id=$1 AND h.run_id=$2 AND h.package_id=ANY($3::uuid[]) ORDER BY h.package_id FOR UPDATE OF h,p',[actor.organisation_id,actor.run_id,ids]);
 if(rows.rowCount!==ids.length)return refuse('PACKAGE_UNAVAILABLE','One or more packages are missing');return rows.rows;
}
export function createComponent(context:ComponentContext):Component {
 const g=gateway(context);
 const actions:Component['actions']={
 'hierarchy.describe':async (input,invocation)=>{record(input,[]);return {api_version:1,actor_boundary:'TRUSTED_SERVICE_CONTEXT',allocation_policies:['FEATURE_STABLE','WAVE'],roles:['LEADER','FEATURE_MANAGER','WORKER','COMMIT_WATCHER','ISSUE_WATCHER','VERIFIER','INTEGRATOR','INDEXER'],dispatch_authority:false};},
 'hierarchy.leader.acquire':async (input,invocation)=>{
  const v=record(input,['idempotency_key','expected_generation','reason']);const a=trustedActor(invocation),expected=decimal(v.expected_generation,true);text(v.reason,4096);
  return operation(g,a,'hierarchy.leader.acquire',v,async tx=>{
   const runs=await tx.query('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[a.organisation_id,a.run_id]);
   if(runs.rows[0]?.authority_epoch!==a.authority_epoch)return refuse('AUTHORITY_EPOCH_STALE','Run platform epoch mismatch');
   const session=await tx.query("SELECT 1 FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND role='LEADER' AND state IN ('REGISTERED','RUNNING','DISCONNECTED') FOR SHARE",[a.organisation_id,a.run_id,a.session_id]);
   if(!session.rowCount)return refuse('ROLE_DENIED','Only a registered leader session may acquire leadership');
   const old=await tx.query('SELECT generation::text,leader_session_id,authority_epoch FROM hyperfide.hierarchy_leaders WHERE organisation_id=$1 AND run_id=$2 FOR UPDATE',[a.organisation_id,a.run_id]);
   if((old.rows[0]?.generation??'0')!==expected)return refuse('LEADER_GENERATION_STALE','Leadership compare-and-set failed');
   const next=(BigInt(expected)+1n).toString();decimal(next);
   await tx.query('INSERT INTO hyperfide.hierarchy_leaders(organisation_id,run_id,authority_epoch,leader_session_id,generation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organisation_id,run_id) DO UPDATE SET authority_epoch=EXCLUDED.authority_epoch,leader_session_id=EXCLUDED.leader_session_id,generation=EXCLUDED.generation,state_version=hyperfide.hierarchy_leaders.state_version+1',[a.organisation_id,a.run_id,a.authority_epoch,a.session_id,next]);
   await event(tx,a,next,'LEADER_ACQUIRED',{predecessor_id:old.rows[0]?.leader_session_id??null,predecessor_generation:old.rows[0]?.generation??null,predecessor_authority_epoch:old.rows[0]?.authority_epoch??null,authority_epoch:a.authority_epoch,reason:v.reason});
   return {organisation_id:a.organisation_id,run_id:a.run_id,authority_epoch:a.authority_epoch,leader_session_id:a.session_id,leader_generation:next};
  });
 },
 'hierarchy.package.configure':async (input,invocation)=>{
  const v=record(input,['idempotency_key','leader_generation','package_id','feature_key','allocation_policy']);
  const a=trustedActor(invocation),id=uuid(v.package_id),feature=text(v.feature_key);
  if(!['FEATURE_STABLE','WAVE'].includes(String(v.allocation_policy)))return refuse('INVALID_REQUEST','Unknown manager allocation policy');
  return operation(g,a,'hierarchy.package.configure',v,async tx=>{
   await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),roles:['LEADER']});
   const found=await tx.query('SELECT package_key FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[a.organisation_id,a.run_id,id]);
   if(!found.rowCount)return refuse('PACKAGE_UNAVAILABLE','Imported wave package does not exist');
   const tasks=await tx.query('SELECT definition FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND feature_package_id=$3',[a.organisation_id,a.run_id,id]);
   if(tasks.rows.some(row=>object(row.definition)&&typeof row.definition.feature_key==='string'&&row.definition.feature_key!==feature))
    return refuse('PACKAGE_FEATURE_MISMATCH','Feature key conflicts with immutable imported task definition');
   await tx.query('INSERT INTO hyperfide.hierarchy_packages(organisation_id,run_id,package_id,feature_key,allocation_policy) VALUES($1,$2,$3,$4,$5)',[a.organisation_id,a.run_id,id,feature,v.allocation_policy]);
   await event(tx,a,decimal(v.leader_generation),'PACKAGE_CONFIGURED',{package_id:id,feature_key:feature,allocation_policy:v.allocation_policy});
   return {package_id:id,owner_generation:'1',state:'PLANNED',dispatch_authority:false};
  });
 },
 'hierarchy.package.assign':async (input,invocation)=>{
  const v=record(input,['idempotency_key','leader_generation','package_id','expected_generation','manager_session_id']);
  const a=trustedActor(invocation),id=uuid(v.package_id),owner=uuid(v.manager_session_id),expected=decimal(v.expected_generation);
  return operation(g,a,'hierarchy.package.assign',v,async tx=>{
   await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),roles:['LEADER']});await manager(tx,a,owner);
   const p=(await packageRows(tx,a,[id]))[0]!;
   if(p.owner_generation!==expected)return refuse('PACKAGE_GENERATION_STALE','Package generation changed');
   if(p.manager_session_id!==null)return refuse('HANDOFF_REQUIRED','Assigned packages require an acknowledged handoff');
   if(p.allocation_policy==='FEATURE_STABLE'){
    await tx.query('INSERT INTO hyperfide.hierarchy_domain_owners(organisation_id,run_id,feature_key,manager_session_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[a.organisation_id,a.run_id,p.feature_key,owner]);
    const domain=await tx.query('SELECT manager_session_id FROM hyperfide.hierarchy_domain_owners WHERE organisation_id=$1 AND run_id=$2 AND feature_key=$3 FOR UPDATE',[a.organisation_id,a.run_id,p.feature_key]);
    if(domain.rows[0]?.manager_session_id!==owner)return refuse('OWNERSHIP_POLICY_CONFLICT','Stable feature owner differs; use an explicit domain handoff');
   }
   await tx.query('UPDATE hyperfide.feature_packages SET manager_session_id=$1,state_version=state_version+1 WHERE organisation_id=$2 AND run_id=$3 AND id=$4',[owner,a.organisation_id,a.run_id,id]);
   const changed=await tx.query("UPDATE hyperfide.hierarchy_packages SET owner_generation=owner_generation+1,state='ASSIGNED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND package_id=$3 RETURNING owner_generation::text",[a.organisation_id,a.run_id,id]);
   await event(tx,a,decimal(v.leader_generation),'PACKAGE_ASSIGNED',{package_id:id,manager_session_id:owner});
   return {package_id:id,manager_session_id:owner,package_generation:changed.rows[0]!.owner_generation,state:'ASSIGNED'};
  });
 },
 'hierarchy.package.handoff.propose':async (input,invocation)=>{
  const v=record(input,['idempotency_key','leader_generation','package_ids','expected_generations','successor_id','context']);
  const a=trustedActor(invocation),ids=strings(v.package_ids).map(uuid).sort(),successor=uuid(v.successor_id);
  if(!ids.length||!object(v.expected_generations)||Object.keys(v.expected_generations).sort().join(',')!==ids.join(','))return refuse('INVALID_REQUEST','Exact package generation map required');
  const expected=v.expected_generations;for(const id of ids)decimal(expected[id]);
  const handoff=record(v.context,['summary','decision_refs','pending_instruction_refs','native_session_refs']);
  text(handoff.summary,16384);strings(handoff.decision_refs);strings(handoff.pending_instruction_refs);strings(handoff.native_session_refs);
  return operation(g,a,'hierarchy.package.handoff.propose',v,async tx=>{
   await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),roles:['LEADER']});await manager(tx,a,successor);
   const rows=await packageRows(tx,a,ids),predecessor=rows[0]!.manager_session_id;
   if(!predecessor||predecessor===successor||rows.some(p=>p.manager_session_id!==predecessor||p.owner_generation!==expected[p.package_id]||['CLOSED','CANCELLED'].includes(p.state)))return refuse('PACKAGE_GENERATION_STALE','Handoff package ownership or generation changed');
   for(const feature of new Set(rows.filter(p=>p.allocation_policy==='FEATURE_STABLE').map(p=>p.feature_key))){
    const all=await tx.query("SELECT h.package_id FROM hyperfide.hierarchy_packages h JOIN hyperfide.feature_packages p ON p.organisation_id=h.organisation_id AND p.run_id=h.run_id AND p.id=h.package_id WHERE h.organisation_id=$1 AND h.run_id=$2 AND h.feature_key=$3 AND h.allocation_policy='FEATURE_STABLE' AND p.manager_session_id IS NOT NULL AND h.state NOT IN ('CLOSED','CANCELLED') FOR SHARE OF h,p",[a.organisation_id,a.run_id,feature]);
    if(all.rows.some(p=>!ids.includes(p.package_id)))return refuse('OWNERSHIP_POLICY_CONFLICT','Stable feature handoff must include every current owned package');
   }
   const tasks=await tx.query('SELECT id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND feature_package_id=ANY($3::uuid[]) ORDER BY id',[a.organisation_id,a.run_id,ids]);
   const findings=await tx.query("SELECT id FROM hyperfide.findings WHERE organisation_id=$1 AND run_id=$2 AND owner_package_id=ANY($3::uuid[]) ORDER BY id",[a.organisation_id,a.run_id,ids]);
   const id=randomUUID(),snapshot=rows.map(p=>({package_id:p.package_id,owner_generation:p.owner_generation,previous_state:p.state}));
   await tx.query('INSERT INTO hyperfide.hierarchy_handoffs(organisation_id,run_id,id,authority_epoch,leader_generation,predecessor_id,successor_id,package_snapshot,task_ids,finding_ids,context) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [a.organisation_id,a.run_id,id,a.authority_epoch,v.leader_generation,predecessor,successor,JSON.stringify(snapshot),JSON.stringify(tasks.rows.map(t=>t.id)),JSON.stringify(findings.rows.map(f=>f.id)),JSON.stringify(handoff)]);
   await tx.query("UPDATE hyperfide.hierarchy_packages SET state='HANDOFF_PENDING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND package_id=ANY($3::uuid[])",[a.organisation_id,a.run_id,ids]);
   await event(tx,a,decimal(v.leader_generation),'HANDOFF_PROPOSED',{handoff_id:id,predecessor_id:predecessor,successor_id:successor,package_ids:ids});
   return {handoff_id:id,predecessor_id:predecessor,successor_id:successor,package_ids:ids,ownership_changed:false};
  });
 },
 'hierarchy.package.handoff.acknowledge':async (input,invocation)=>{
  const v=record(input,['idempotency_key','leader_generation','handoff_id']);const a=trustedActor(invocation),id=uuid(v.handoff_id);
  return operation(g,a,'hierarchy.package.handoff.acknowledge',v,async tx=>{
   const run=await tx.query('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[a.organisation_id,a.run_id]);
   if(run.rows[0]?.authority_epoch!==a.authority_epoch)return refuse('AUTHORITY_EPOCH_STALE','Run/platform epoch changed');
   const current=await leadership(tx,a);
   if(current.authority_epoch!==a.authority_epoch||current.leader_generation!==decimal(v.leader_generation))return refuse('LEADER_GENERATION_STALE','Leader generation changed');
   await manager(tx,a,a.session_id);
   const result=await tx.query('SELECT * FROM hyperfide.hierarchy_handoffs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[a.organisation_id,a.run_id,id]);
   const h=result.rows[0];if(!h||h.successor_id!==a.session_id)return refuse('HANDOFF_SUCCESSOR_MISMATCH','Only the recorded successor can acknowledge');
   if(h.authority_epoch!==a.authority_epoch||String(h.leader_generation)!==current.leader_generation)return refuse('LEADER_GENERATION_STALE','Proposal belongs to another leadership generation');
   const snapshots=h.package_snapshot as {package_id:string;owner_generation:string;previous_state:string}[],ids=snapshots.map(p=>p.package_id);
   const rows=await packageRows(tx,a,ids);
   if(rows.some(p=>p.manager_session_id!==h.predecessor_id||p.state!=='HANDOFF_PENDING'||!snapshots.some(s=>s.package_id===p.package_id&&s.owner_generation===p.owner_generation)))return refuse('PACKAGE_GENERATION_STALE','Handoff package changed');
   const currentTasks=await tx.query('SELECT id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND feature_package_id=ANY($3::uuid[]) ORDER BY id',[a.organisation_id,a.run_id,ids]);
   const currentFindings=await tx.query('SELECT id FROM hyperfide.findings WHERE organisation_id=$1 AND run_id=$2 AND owner_package_id=ANY($3::uuid[]) ORDER BY id',[a.organisation_id,a.run_id,ids]);
   if(canonical(currentTasks.rows.map(t=>t.id))!==canonical(h.task_ids)||canonical(currentFindings.rows.map(f=>f.id))!==canonical(h.finding_ids))
    return refuse('HANDOFF_CONTENT_CHANGED','Task/finding membership changed; record and acknowledge a fresh handoff');
   for(const feature of new Set(rows.filter(p=>p.allocation_policy==='FEATURE_STABLE').map(p=>p.feature_key))){
    const all=await tx.query("SELECT h.package_id FROM hyperfide.hierarchy_packages h JOIN hyperfide.feature_packages p ON p.organisation_id=h.organisation_id AND p.run_id=h.run_id AND p.id=h.package_id WHERE h.organisation_id=$1 AND h.run_id=$2 AND h.feature_key=$3 AND h.allocation_policy='FEATURE_STABLE' AND p.manager_session_id IS NOT NULL AND h.state NOT IN ('CLOSED','CANCELLED') FOR SHARE OF h,p",[a.organisation_id,a.run_id,feature]);
    if(all.rows.some(p=>!ids.includes(p.package_id)))return refuse('HANDOFF_CONTENT_CHANGED','Stable feature package membership changed');
   }
   await tx.query('INSERT INTO hyperfide.hierarchy_handoff_acknowledgements(organisation_id,run_id,handoff_id,successor_id) VALUES($1,$2,$3,$4)',[a.organisation_id,a.run_id,id,a.session_id]);
   await tx.query('UPDATE hyperfide.feature_packages SET manager_session_id=$1,state_version=state_version+1 WHERE organisation_id=$2 AND run_id=$3 AND id=ANY($4::uuid[])',[a.session_id,a.organisation_id,a.run_id,ids]);
   await tx.query("UPDATE hyperfide.hierarchy_packages SET owner_generation=owner_generation+1,state='ASSIGNED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND package_id=ANY($3::uuid[])",[a.organisation_id,a.run_id,ids]);
   for(const feature of new Set(rows.filter(p=>p.allocation_policy==='FEATURE_STABLE').map(p=>p.feature_key)))
    await tx.query('UPDATE hyperfide.hierarchy_domain_owners SET manager_session_id=$1,generation=generation+1,state_version=state_version+1 WHERE organisation_id=$2 AND run_id=$3 AND feature_key=$4',[a.session_id,a.organisation_id,a.run_id,feature]);
   await event(tx,a,current.leader_generation,'HANDOFF_ACKNOWLEDGED',{handoff_id:id,package_ids:ids,predecessor_id:h.predecessor_id,successor_id:a.session_id});
   return {handoff_id:id,package_ids:ids,manager_session_id:a.session_id,ownership_changed:true,workers_restarted:false};
  });
 },
 'hierarchy.role.bind':async (input,invocation)=>{
  const v=record(input,['idempotency_key','leader_generation','package_id','package_generation','session_id','role']);
  const a=trustedActor(invocation),id=uuid(v.package_id),session=uuid(v.session_id);
  return operation(g,a,'hierarchy.role.bind',v,async tx=>{
   await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),package_id:id,package_generation:decimal(v.package_generation),roles:['LEADER','FEATURE_MANAGER']});
   const found=await tx.query('SELECT role FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[a.organisation_id,a.run_id,session]);
   if(found.rows[0]?.role!==v.role)return refuse('ROLE_DENIED','Role must match the existing immutable session identity');
   await tx.query('INSERT INTO hyperfide.hierarchy_session_packages(organisation_id,run_id,session_id,package_id,registered_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[a.organisation_id,a.run_id,session,id,a.session_id]);
   await event(tx,a,decimal(v.leader_generation),'ROLE_BOUND',{package_id:id,session_id:session,role:v.role});
   return {package_id:id,session_id:session,role:v.role,execution_authority:false};
  });
 },
 'hierarchy.inspect':async (input,invocation)=>{
  const v=record(input,['leader_generation']);const a=trustedActor(invocation);
  return g.withPrimaryTransaction({timeoutMs:5000,guard:hierarchyReadGuard(a),signal:a.signal},async tx=>{
   await ready(tx);const authority=await requireAuthority(tx,{...a,leader_generation:decimal(v.leader_generation),roles:['LEADER']});
   const packages=await tx.query('SELECT h.*,h.owner_generation::text AS owner_generation,h.state_version::text AS state_version,p.manager_session_id,p.wave FROM hyperfide.hierarchy_packages h JOIN hyperfide.feature_packages p ON p.organisation_id=h.organisation_id AND p.run_id=h.run_id AND p.id=h.package_id WHERE h.organisation_id=$1 AND h.run_id=$2 ORDER BY p.wave,h.package_id LIMIT 257',[a.organisation_id,a.run_id]);
   return {authority,packages:packages.rows.slice(0,256),has_more:packages.rows.length>256,dispatch_authority:false};
  });
 }};
 return {apiVersion:1,actions,capabilities:{'hierarchy.authority.v1':Object.freeze({leadership,requireAuthority,requireLeaderReplacement}),'hierarchy.handoff.v1':Object.freeze({propose:actions['hierarchy.package.handoff.propose'],acknowledge:actions['hierarchy.package.handoff.acknowledge']})}};
}
