import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {identityTransaction,invocationOf} from '../identity/enrollment.js';
import type {IdentityTransaction} from '../identity/enrollment.js';
import {canonical,hash} from './sqlite.js';

interface Scope {organisation_id:string;run_id:string;authority_epoch:string}
interface RecoveryControls {
 assertQuiesced(tx:IdentityTransaction,scope:Scope):Promise<void>;
 assertNoNewEffects(tx:IdentityTransaction,scope:Scope):Promise<void>;
}
const names=['cutover.describe','cutover.inspect','cutover.prepare','cutover.validate','cutover.activate','cutover.rollback','cutover.recovery'] as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function controls(ctx:ComponentContext):RecoveryControls {
 try{return ctx.dependencies.require('24.3','recovery.controls.v1',(v:unknown):v is RecoveryControls=>object(v)&&typeof v.assertQuiesced==='function'&&typeof v.assertNoNewEffects==='function');}
 catch{return fail('CUTOVER_RECOVERY_UNAVAILABLE','Actual scoped recovery controls are required');}
}
function input(raw:unknown,mutation:boolean):Record<string,unknown>{
 const fields=mutation?['scope_id','operation_id','expected_generation','source_import_id']:['scope_id'];
 if(!object(raw)||fields.some(k=>!(k in raw))||Object.keys(raw).some(k=>!fields.includes(k))||typeof raw.scope_id!=='string'||!uuid.test(raw.scope_id))fail('CUTOVER_INPUT','Exact pinned cutover fields required');
 if(mutation&&(typeof raw.operation_id!=='string'||!uuid.test(raw.operation_id)||typeof raw.source_import_id!=='string'||!uuid.test(raw.source_import_id)||typeof raw.expected_generation!=='string'||!/^[1-9][0-9]{0,18}$/.test(raw.expected_generation)))fail('CUTOVER_INPUT','Canonical operation, import and generation required');
 return raw;
}
/** Preparing historical migration is not external-writer isolation. Epoch activation
 * belongs to 4.4 and must fence external writers before opening its own transaction.
 * Full-case parity belongs to the independently checked 27 campaign receipts. */
export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,actions:Object.fromEntries(names.map(action=>[action,async(raw:unknown,ctx:ComponentContext)=>{
 const i=invocationOf(ctx),principal=i.principal;
 if(i.payload.component!=='25.2'||i.payload.action!==action||i.payload.run_id!==principal.run_id||!['OPERATOR','LEADER','COORDINATOR'].includes(principal.role))fail('CUTOVER_FORBIDDEN','Authenticated scoped supervisor required');
 if(action==='cutover.describe'){
 if(!object(raw)||Object.keys(raw).length)fail('CUTOVER_INPUT','Description takes empty input');
 return identityTransaction(ctx,async()=>({schema_version:1,authority_granted:false,request_readiness_flags:false,
 states:['LOCAL','QUIESCED','VALIDATED','ACTIVE','RECOVERY_REQUIRED','ROLLED_BACK'],
 implemented:['SCOPED_HISTORICAL_INTENT','PRIMARY_INSPECTION','ACTUAL_RUN_QUIESCENCE','ACTUAL_EFFECT_HOLDS'],
 required_for_activation:['VERIFIED_DURABLE_SOURCE_ARCHIVE','FULL_CASE_CHECKER_PARITY_RECEIPTS','PRODUCTION_EXTERNAL_WRITER_FENCER','SEPARATE_4_4_ACTIVATION','FRESH_EPOCH_REBIND'],
 activation_available:false,implicit_reverse_migration:false}));
 }
 const v=input(raw,action!=='cutover.inspect');
 if(v.scope_id!==principal.run_id)fail('CUTOVER_SCOPE','Cutover scope must equal the authenticated run');
 const scope:Scope={organisation_id:principal.organisation_id,run_id:principal.run_id,authority_epoch:principal.deployment_epoch};
 if(action==='cutover.inspect')return identityTransaction(ctx,async tx=>{
 const result=await tx.query('SELECT c.scope_id,c.state,c.generation::text,c.epoch,c.source_import_id,c.checkpoint_digest,c.evidence FROM hyperfide_history.cutovers c JOIN hyperfide_history.imports h ON h.id=c.source_import_id WHERE c.scope_id=$1 AND h.organisation_id=$2',[scope.run_id,scope.organisation_id]);
 return {scope_id:scope.run_id,state:result.rows[0]??null,authority_granted:false,activation_available:false};
 });
 if(v.operation_id!==i.operation.idempotency_key)fail('CUTOVER_OPERATION','Intent identity must equal signed idempotency key');
 if(action==='cutover.activate')fail('CUTOVER_EXTERNAL_FENCER_UNAVAILABLE','A production external-writer fencer, independently checked parity, separate 4.4 activation and fresh-epoch rebind are not installed');
 if(action==='cutover.rollback')fail('CUTOVER_RESTORE_UNAVAILABLE','Restoring legacy authority requires a real external restoration controller and guarded proof of no new authoritative effects');
 const requestDigest=hash(canonical({action,...v})),recovery=controls(ctx);
 try{return await identityTransaction(ctx,async tx=>{
 const source=await tx.query('SELECT h.id,h.snapshot_digest,h.inventory FROM hyperfide_history.imports h JOIN hyperfide.run_repositories r ON r.organisation_id=h.organisation_id AND r.repository_id=h.repository_id WHERE h.id=$1 AND h.organisation_id=$2 AND r.run_id=$3',[v.source_import_id,scope.organisation_id,scope.run_id]);
 if(!source.rows[0])fail('CUTOVER_SOURCE','Import is not part of the authenticated run');
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,25))',[scope.run_id]);
 const prior=await tx.query('SELECT request_digest,result FROM hyperfide_history.cutover_receipts WHERE scope_id=$1 AND operation_id=$2',[scope.run_id,v.operation_id]);
 if(prior.rows[0]){
 if(prior.rows[0].request_digest!==requestDigest)fail('CUTOVER_CONFLICT','Immutable intent replay changed');
 return {...prior.rows[0].result,replayed:true,authority_granted:false};
 }
 const existing=await tx.query('SELECT * FROM hyperfide_history.cutovers WHERE scope_id=$1 FOR UPDATE',[scope.run_id]);
 let current=existing.rows[0];
 if(!current){
 if(action!=='cutover.prepare'||v.expected_generation!=='1')fail('CUTOVER_STATE','A new scoped intent must begin with preparation generation1');
 await tx.query("INSERT INTO hyperfide_history.cutovers(scope_id,state,generation,source_import_id,checkpoint_digest) VALUES($1,'LOCAL',1,$2,$3)",[scope.run_id,v.source_import_id,source.rows[0].snapshot_digest]);
 current={state:'LOCAL',generation:'1',source_import_id:v.source_import_id,epoch:null};
 }
 if(current.source_import_id!==v.source_import_id||String(current.generation)!==v.expected_generation)fail('CUTOVER_STALE','Pinned source import or intent generation changed');
 await recovery.assertQuiesced(tx,scope);
 if(action==='cutover.validate'){
 for(const table of source.rows[0].inventory.tables as {name:string;rows:string|null;disposition:string}[]){
 if(table.disposition==='ARCHIVE_ONLY')continue;
 if(table.rows===null)fail('CUTOVER_INCOMPLETE','Unavailable source count prevents validation');
 const count=await tx.query('SELECT count(*)::text AS count FROM hyperfide_history.rows WHERE import_id=$1 AND table_name=$2',[v.source_import_id,table.name]);
 if(count.rows[0]?.count!==table.rows)fail('CUTOVER_INCOMPLETE','Every ordinary historical row must reconcile');
 }
 // Count equality cannot establish semantic parity or verified remote archive custody.
 fail('MISSING_PARITY_EVIDENCE','Full independently checked parity receipts and verified durable archive custody are required; row-count equality grants no authority');
 }
 let next=String(current.state);
 if(action==='cutover.recovery'){
 await recovery.assertNoNewEffects(tx,scope);next='RECOVERY_REQUIRED';
 }else if(action!=='cutover.prepare')fail('CUTOVER_STATE','Unsupported transition');
 const generation=(BigInt(String(current.generation))+1n).toString();
 const evidence={run_quiescence:'OBSERVED',legacy_writer_isolation:'UNAVAILABLE',durable_archive:'UNQUALIFIED',semantic_parity:'UNAVAILABLE',external_epoch_activation:'NOT_PERFORMED'};
 await tx.query('UPDATE hyperfide_history.cutovers SET state=$2,generation=$3,evidence=$4,updated_at=clock_timestamp() WHERE scope_id=$1',[scope.run_id,next,generation,evidence]);
 const result={outcome:'SUCCEEDED',scope_id:scope.run_id,state:next,generation,source_import_id:v.source_import_id,authority_granted:false,legacy_writer_fenced:false,activation_available:false,evidence};
 await tx.query('INSERT INTO hyperfide_history.cutover_receipts(scope_id,operation_id,request_digest,result) VALUES($1,$2,$3,$4)',[scope.run_id,v.operation_id,requestDigest,result]);
 return result;
 });}catch(error){
 if(object(error)&&error.code==='COMMIT_AMBIGUOUS')return {outcome:'UNKNOWN',scope_id:scope.run_id,operation_id:v.operation_id,automatic_replay:false,authority_granted:false,reconcile:'INSPECT_DURABLE_INTENT'};
 throw error;
 }
 }]))};}
