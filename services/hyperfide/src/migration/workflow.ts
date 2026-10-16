import type {Component,ComponentContext,Action} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {gateway,trustedActor,requireAuthority,record,text,decimal,digest,hash,canonical,refuse,ready,operation} from '../hierarchy/packages.js';
import type {TrustedActor} from '../hierarchy/packages.js';
import {createComponent as createViews} from '../hierarchy/views.js';
import {object} from '../policy/programme.js';

type Data=Record<string,unknown>;
const REVISION_OPERATION='legacy.work.revision';
function budget(value:unknown):number {
 const n=value===undefined?131072:value;
 if(!Number.isSafeInteger(n)||Number(n)<4096||Number(n)>262144)return refuse('INVALID_REQUEST','Work packet byte budget is out of bounds');
 return Number(n);
}
function bounded<T>(value:T,max:number):T {
 if(Buffer.byteLength(canonical(value))>max)return refuse('WORK_PACKET_BUDGET_TOO_SMALL','Complete accepted intent and required provenance exceed the requested budget');
 return value;
}
function field(definition:unknown,name:string,structured=true):unknown {
 if(!object(definition))return undefined;
 let value=definition[name];
 if(value===undefined&&object(definition.section)&&object(definition.section.fields))value=definition.section.fields[name];
 if(object(value)&&Object.hasOwn(value,'value'))value=value.value;
 if(structured&&typeof value==='string'){try{return JSON.parse(value);}catch{return value;}}
 return value;
}
function objectiveLabel(definition:unknown,fallback:string):string {
 for(const name of ['title','purpose']){const value=field(definition,name,false);if(typeof value==='string')return value;}
 return fallback;
}
async function revision(tx:PrimaryTransaction,a:TrustedActor,key:string):Promise<Data> {
 const rows=await tx.query("SELECT result,request_digest,state FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation=$4 AND idempotency_key=$5",[a.organisation_id,a.run_id,a.session_id,REVISION_OPERATION,digest(key)]);
 const row=rows.rows[0];
 if(!row||row.state!=='COMPLETED'||!object(row.result)||!object(row.result.snapshot)||row.result.actor_id!==a.session_id||hash(row.result.snapshot)!==row.request_digest||hash(row.result)!==key)
  return refuse('WORK_REVISION_UNAVAILABLE','Revision is absent or does not belong to this authenticated actor and run');
 return row.result;
}
async function task(tx:PrimaryTransaction,a:TrustedActor,reference:string,leader:string,owner:string):Promise<Data> {
 await ready(tx);
 const rows=await tx.query('SELECT id,task_key,feature_package_id,spec_revision_id,spec_generation::text,criteria_digest,definition,state,generation::text,state_version::text,current_attempt_id,current_custody_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND (id::text=$3 OR task_key=$3) FOR SHARE',[a.organisation_id,a.run_id,reference]);
 if(rows.rows.length!==1)return refuse('WORK_TASK_UNAVAILABLE','An unambiguous accepted task is required in the authenticated run');
 const row=rows.rows[0]!;
 const accepted=await tx.query('SELECT 1 FROM hyperfide.run_spec_revisions WHERE organisation_id=$1 AND run_id=$2 AND spec_revision_id=$3 AND spec_generation=$4',[a.organisation_id,a.run_id,row.spec_revision_id,row.spec_generation]);
 if(!accepted.rowCount)return refuse('SPEC_REVISION_UNACCEPTED','Task is not pinned to accepted immutable run history');
 const ownership=await requireAuthority(tx,{...a,leader_generation:leader,package_id:row.feature_package_id,package_generation:owner,roles:['LEADER','FEATURE_MANAGER']});
 return {...row,current_ownership:ownership};
}
async function capture(tx:PrimaryTransaction,a:TrustedActor,t:Data):Promise<Data> {
 const run=await tx.query('SELECT spec_revision_id,spec_generation::text,state,state_version::text,authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[a.organisation_id,a.run_id]);
 const deps=await tx.query('SELECT d.predecessor_run_id,d.predecessor_task_id,d.milestone,p.state AS observed_predecessor_state,p.state_version::text AS observed_predecessor_version FROM hyperfide.task_dependencies d JOIN hyperfide.tasks p ON p.organisation_id=d.organisation_id AND p.run_id=d.predecessor_run_id AND p.id=d.predecessor_task_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.task_id=$3 ORDER BY d.predecessor_run_id,d.predecessor_task_id,d.milestone LIMIT 129',[a.organisation_id,a.run_id,t.id]);
 if(deps.rows.length>128)return refuse('WORK_PACKET_DEPENDENCY_BOUND','Complete dependency context exceeds the supported packet bound');
 return {schema_version:1,organisation_id:a.organisation_id,run_id:a.run_id,task:t,run:run.rows[0],dependencies:deps.rows,dependency_assessment:'OBSERVATIONAL; release and compute authority remain with their owning services'};
}
async function save(tx:PrimaryTransaction,a:TrustedActor,snapshot:Data):Promise<string> {
 const body={schema_version:1,actor_id:a.session_id,snapshot},key=hash(body),content=hash(snapshot);
 await tx.query("INSERT INTO hyperfide.command_inbox(organisation_id,run_id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,$5,$6,'COMPLETED',$7) ON CONFLICT DO NOTHING",[a.organisation_id,a.run_id,a.session_id,REVISION_OPERATION,key,content,JSON.stringify(body)]);
 const stored=await revision(tx,a,key);
 if(canonical(stored)!==canonical(body))return refuse('WORK_REVISION_CONFLICT','Immutable revision content differs');
 return key;
}
async function provenance(tx:PrimaryTransaction){
 const clock=await tx.query('SELECT clock_timestamp() AS observed_at');
 return {source:'POSTGRESQL_PRIMARY',consistency:'SERIALIZABLE_SNAPSHOT',observed_at:new Date(clock.rows[0]!.observed_at).toISOString(),cache:false};
}
function omitted(){return {workspace_delta:{available:false,reason:'REMOTE_WORKSPACE_ATTESTATION_REQUIRED'},focused_graph:{available:false,reason:'EXACT_GRAPH_MANIFEST_REQUIRED'},memories:{available:false,reason:'MEMORY_AUTHORITY_NOT_REQUESTED'},runtime_evidence:{available:false,reason:'EXPLICIT_EVIDENCE_REFERENCE_REQUIRED'}};}
interface Handoff {propose:Action;acknowledge:Action}
function isHandoff(value:unknown):value is Handoff{return object(value)&&typeof value.propose==='function'&&typeof value.acknowledge==='function';}

/** Compatibility reads never claim an execution grant, status mutation or proof. */
export function createComponent(context:ComponentContext):Component {
 const g=gateway(context),handoff=context.dependencies!.require('3.1','hierarchy.handoff.v1',isHandoff),views=createViews(context);
 return {apiVersion:1,actions:{
  'work.open':async(input,ctx)=>{
   const v=record(input,['task','leader_generation','package_generation','max_bytes'],['task','leader_generation','package_generation']);
   const a=trustedActor(ctx),reference=text(v.task,256),leader=decimal(v.leader_generation),owner=decimal(v.package_generation),max=budget(v.max_bytes);
   // Revalidate current ownership before receipt replay, inside every actual primary attempt.
   const guarded={...a,guard:async(tx:PrimaryTransaction)=>{await a.guard(tx);await task(tx,a,reference,leader,owner);}};
   return operation(g,guarded,'legacy.work.open',{...v,idempotency_key:a.invocation.operation.idempotency_key},async tx=>{
    const current=await task(tx,a,reference,leader,owner),snapshot=await capture(tx,a,current),key=await save(tx,a,snapshot),scope=field(current.definition,'touches');
    return bounded({revision:key,task_id:current.id,task_key:current.task_key,objective:objectiveLabel(current.definition,String(current.task_key)),
     criteria:{digest:current.criteria_digest,accepted_definition:current.definition},allowed_scope:Array.isArray(scope)?scope:{available:false,reason:'ACCEPTED_SCOPE_NOT_STRUCTURED'},
     state:snapshot,provenance:await provenance(tx),authority:'NONE',execution_authority:false,read_only:true,omitted_context:omitted()},max);
   });
  },
  'work.update':async(input,ctx)=>{
   const v=record(input,['revision','leader_generation','package_generation','max_bytes'],['revision','leader_generation','package_generation']);
   const a=trustedActor(ctx),key=digest(v.revision),leader=decimal(v.leader_generation),owner=decimal(v.package_generation),max=budget(v.max_bytes);
   const load=async(tx:PrimaryTransaction)=>{const old=await revision(tx,a,key),snapshot=old.snapshot as Data;if(!object(snapshot.task))return refuse('WORK_REVISION_UNAVAILABLE','Revision task identity is absent');return {old:snapshot,current:await task(tx,a,text(snapshot.task.id),leader,owner)};};
   const guarded={...a,guard:async(tx:PrimaryTransaction)=>{await a.guard(tx);await load(tx);}};
   return operation(g,guarded,'legacy.work.update',{...v,idempotency_key:a.invocation.operation.idempotency_key},async tx=>{
    const before=await load(tx),snapshot=await capture(tx,a,before.current),next=await save(tx,a,snapshot),unchanged=next===key;
    return bounded({revision:next,since:key,unchanged,task_id:before.current.id,deltas:{state:unchanged?null:snapshot,dependencies:canonical(before.old.dependencies)===canonical(snapshot.dependencies)?null:snapshot.dependencies},provenance:await provenance(tx),authority:'NONE',execution_authority:false,read_only:true,omitted_context:omitted()},max);
   });
  },
  'work.handoff':async(input,ctx)=>{
   const v=record(input,['phase','request']);trustedActor(ctx);
   if(v.phase!=='propose'&&v.phase!=='acknowledge')return refuse('WORK_HANDOFF_PHASE_UNSUPPORTED','Use the explicit hierarchy propose or acknowledge phase');
   return handoff[v.phase](v.request,ctx);
  },
  'work.projection':async(input,ctx)=>{
   const view=await views.actions['hierarchy.view']!(input,ctx);
   return bounded({projection_kind:'DISTRIBUTED_WORKFLOW',folded_branch_projection:{available:false,reason:'NO_EQUIVALENT_REMOTE_BRANCH_FOLDING_AUTHORITY'},view},budget((input as Data).max_bytes));
  },
 }};
}
