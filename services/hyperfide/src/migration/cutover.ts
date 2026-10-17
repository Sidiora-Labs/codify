import fs from 'node:fs/promises';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {identityTransaction,invocationOf} from '../identity/enrollment.js';
import type {IdentityTransaction} from '../identity/enrollment.js';
import {canonical,hash} from './sqlite.js';
import type {LegacyWriterCapability,LegacyWriterInput} from './legacy.js';
import {historyDigest,shadowCompare} from './parity.js';
import type {ParityReport} from './parity.js';

interface Scope {organisation_id:string;run_id:string;authority_epoch:string}
interface RecoveryControls {
 assertQuiesced(tx:IdentityTransaction,scope:Scope):Promise<void>;
 assertNoNewEffects(tx:IdentityTransaction,scope:Scope):Promise<void>;
}
interface HierarchyAuthority {
 leadership(tx:IdentityTransaction,input:{organisation_id:string;run_id:string}):Promise<{leader_session_id:string;leader_generation:string;authority_epoch:string}>;
 requireAuthority(tx:IdentityTransaction,input:{organisation_id:string;run_id:string;authority_epoch:string;session_id:string;leader_generation:string;roles:string[]}):Promise<unknown>;
}
type Fingerprint=Record<string,{rows:string;digest:string}>;
async function guarded<T>(ctx:ComponentContext,action:string,fn:(tx:IdentityTransaction)=>Promise<T>):Promise<T>{
 const i=invocationOf(ctx),p=i.principal;
 return identityTransaction(ctx,async tx=>{
 const result=await tx.query('SELECT state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[p.organisation_id,p.run_id]);
 const state=result.rows[0]?.state;
 const closing=['PAUSED','PAUSING','DRAINING','DRAINED','STOPPING','STOPPED','CANCELLING','CANCELLED','FAILED'];
 const readable=['cutover.describe','cutover.inspect'].includes(action);
 if(closing.includes(state)&&!(readable?['PAUSED','DRAINED','STOPPED','CANCELLED']:['PAUSED','DRAINED','STOPPED']).includes(state))fail('CUTOVER_STATE','This metadata operation is unavailable in the current closing state');
 if(p.role==='LEADER'){
 const hierarchy=ctx.dependencies.require('3.1','hierarchy.authority.v1',(v:unknown):v is HierarchyAuthority=>object(v)&&typeof v.leadership==='function'&&typeof v.requireAuthority==='function');
 const scope={organisation_id:p.organisation_id,run_id:p.run_id},current=await hierarchy.leadership(tx,scope);
 await hierarchy.requireAuthority(tx,{...scope,authority_epoch:p.deployment_epoch,session_id:p.actor_id,leader_generation:current.leader_generation,roles:['LEADER']});
 }
 await ready(tx);
 return fn(tx);
 });
}
const names=['cutover.describe','cutover.inspect','cutover.prepare','cutover.validate','cutover.activate','cutover.rollback','cutover.recovery'] as const;
const fields:Record<string,string[]>={
 'cutover.inspect':['scope_id'],
 'cutover.prepare':['scope_id','operation_id','expected_generation','legacy_source_epoch'],
 'cutover.validate':['scope_id','operation_id','expected_generation','source_import_id','legacy_source_epoch'],
 'cutover.activate':['scope_id','operation_id','expected_generation','source_import_id','legacy_source_epoch'],
 'cutover.rollback':['scope_id','operation_id','expected_generation','legacy_source_epoch'],
 'cutover.recovery':['scope_id','operation_id','expected_generation','procedure','legacy_source_epoch']
};
// Run-scoped authority rows and organisation-visible external effects. Any change from
// the quiesced baseline means PostgreSQL has accepted new writes and plain rollback is unsafe.
const AUTHORITY=['attempts','compute_leases','agent_sessions','tasks','submission_custodies','qualification_jobs','publication_intents','publication_operations'];
const EFFECTS:[string,'run'|'organisation'][]=[['publication_intents','run'],['publication_operations','run'],['sandboxes','organisation']];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function controls(ctx:ComponentContext):RecoveryControls {
 try{return ctx.dependencies.require('24.3','recovery.controls.v1',(v:unknown):v is RecoveryControls=>object(v)&&typeof v.assertQuiesced==='function'&&typeof v.assertNoNewEffects==='function');}
 catch{return fail('CUTOVER_RECOVERY_UNAVAILABLE','Actual scoped recovery controls are required');}
}
function legacy(ctx:ComponentContext):LegacyWriterCapability {
 try{return ctx.dependencies.require('25.1','migration.legacy-writers.v1',(v:unknown):v is LegacyWriterCapability=>object(v)&&typeof v.disableAdmission==='function'&&typeof v.observeIsolation==='function'&&typeof v.restoreAdmission==='function');}
 catch{return fail('CUTOVER_LEGACY_UNAVAILABLE','Actual 25.1 legacy writer admission control is required');}
}
async function ready(tx:IdentityTransaction):Promise<void>{
 for(const [version,name] of [[25,'0025-sqlite-history'],[252,'0252-migration-proof']] as const){
  const checksum=hash(await fs.readFile(new URL('../../migrations/'+name+'.sql',import.meta.url)));
  const applied=await tx.query('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=$1',[version]);
  if(applied.rows.length!==1||applied.rows[0]?.name!==name||applied.rows[0]?.checksum!==checksum)fail('CUTOVER_SCHEMA_REQUIRED','Exact pinned '+name+' migration receipt required');
 }
}
function input(action:string,raw:unknown):Record<string,unknown>{
 // Inspection optionally carries one import for a read-only shadow comparison.
 const expected=action==='cutover.inspect'&&object(raw)&&'source_import_id' in raw?['scope_id','source_import_id']:fields[action]!;
 if(!object(raw)||expected.some(k=>!(k in raw))||Object.keys(raw).some(k=>!expected.includes(k))||typeof raw.scope_id!=='string'||!uuid.test(raw.scope_id))fail('CUTOVER_INPUT','Exact pinned cutover fields required');
 const id=(v:unknown)=>typeof v==='string'&&uuid.test(v);
 if('operation_id' in raw&&!id(raw.operation_id)||'source_import_id' in raw&&!id(raw.source_import_id)||'legacy_source_epoch' in raw&&raw.legacy_source_epoch!==null&&!id(raw.legacy_source_epoch)||
  'expected_generation' in raw&&(typeof raw.expected_generation!=='string'||!/^[1-9][0-9]{0,18}$/.test(raw.expected_generation)))fail('CUTOVER_INPUT','Canonical operation, import, epoch and generation required');
 if('procedure' in raw){
  if(['SQLITE_ARCHIVE','LEGACY_SQLITE','SQLITE_SNAPSHOT'].includes(String(raw.procedure)))fail('CUTOVER_SQLITE_AUTHORITY_FORBIDDEN','An archived SQLite snapshot can never reopen as current distributed authority');
  if(!['ROLLBACK_BEFORE_WRITES','POSTGRESQL_FORWARD_RECOVERY'].includes(String(raw.procedure)))fail('CUTOVER_INPUT','Recovery names exactly one separate procedure');
 }
 return raw;
}
async function fingerprint(tx:IdentityTransaction,scope:Scope):Promise<Fingerprint>{
 const result:Fingerprint={};
 const read=async(key:string,table:string,by:'run'|'organisation')=>{
  const where=by==='run'?'organisation_id=$1 AND run_id=$2':'organisation_id=$1';
  const r=await tx.query("SELECT count(*)::text AS n,COALESCE(md5(string_agg(md5(t::text),'' ORDER BY md5(t::text))),'') AS d FROM hyperfide."+table+' t WHERE '+where,by==='run'?[scope.organisation_id,scope.run_id]:[scope.organisation_id]);
  result[key]={rows:String(r.rows[0]?.n),digest:String(r.rows[0]?.d)};
 };
 for(const table of AUTHORITY)await read('authority:'+table,table,'run');
 for(const [table,by] of EFFECTS)await read('effect:'+table,table,by);
 return result;
}
function changes(baseline:Fingerprint,observed:Fingerprint,prefix:string):bigint{
 let total=0n;
 for(const key of Object.keys(observed).filter(k=>k.startsWith(prefix))){
  const before=baseline[key],after=observed[key]!;
  if(!before){total+=BigInt(after.rows)||1n;continue;}
  const delta=BigInt(after.rows)-BigInt(before.rows);
  total+=delta<0n?-delta:delta>0n?delta:after.digest!==before.digest?1n:0n;
 }
 return total;
}
function legacyInput(ctx:ComponentContext,operation:string,epoch:unknown,signal:AbortSignal):LegacyWriterInput{
 const deployment=ctx.env.HYPERFIDE_DEPLOYMENT_ID;
 if(!deployment||!uuid.test(deployment))fail('CUTOVER_LEGACY_UNAVAILABLE','Trusted deployment identity is required for legacy writer admission');
 return {deployment_id:deployment,operation_id:operation,source_epoch:epoch as string|null,signal};
}
/** States: LOCAL -> QUIESCED (legacy admission disabled, kernel isolation observed, 24.3
 * quiescence) -> VALIDATED (parity receipt). ACTIVE requires a separately approved 4.4
 * fence and stays refused here. Rollback before new PostgreSQL writes returns authority
 * to the quiesced legacy writer; after writes or external effects only forward recovery
 * from PostgreSQL is offered, and the SQLite archive never reopens as authority. */
export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,actions:Object.fromEntries(names.map(action=>[action,async(raw:unknown,ctx:ComponentContext)=>{
 const i=invocationOf(ctx),principal=i.principal;
 if(i.payload.component!=='25.2'||i.payload.action!==action||i.payload.run_id!==principal.run_id||!['OPERATOR','LEADER','COORDINATOR'].includes(principal.role))fail('CUTOVER_FORBIDDEN','Authenticated scoped supervisor required');
 if(action==='cutover.describe'){
 if(!object(raw)||Object.keys(raw).length)fail('CUTOVER_INPUT','Description takes empty input');
 return guarded(ctx,action,async()=>({schema_version:1,authority_granted:false,request_readiness_flags:false,
 states:['LOCAL','QUIESCED','VALIDATED','ACTIVE','RECOVERY_REQUIRED','ROLLED_BACK'],
 implemented:['LEGACY_ADMISSION_DISABLE','LEGACY_KERNEL_ISOLATION_OBSERVATION','ACTUAL_RUN_QUIESCENCE','COUNT_AND_SEMANTIC_PARITY','LIVE_SOURCE_RECONCILIATION','GIT_AND_ARTIFACT_RECONCILIATION','READ_ONLY_SHADOW','ROLLBACK_BEFORE_WRITES','FORWARD_RECOVERY_AFTER_EFFECTS'],
 required_for_activation:['APPROVED_4_4_EXTERNAL_WRITER_FENCE','FULL_CASE_CHECKER_PARITY_RECEIPTS','FRESH_EPOCH_REBIND'],
 activation_available:false,implicit_reverse_migration:false,sqlite_archive_authority:'NEVER'}));
 }
 const v=input(action,raw);
 if(v.scope_id!==principal.run_id)fail('CUTOVER_SCOPE','Cutover scope must equal the authenticated run');
 const scope:Scope={organisation_id:principal.organisation_id,run_id:principal.run_id,authority_epoch:principal.deployment_epoch};
 if(action==='cutover.inspect')return guarded(ctx,action,async tx=>{
 const state=await tx.query('SELECT scope_id,state,generation::text,epoch,source_import_id,checkpoint_digest,authoritative_writes::text,external_effects::text,evidence FROM hyperfide_history.cutovers WHERE scope_id=$1 AND organisation_id=$2',[scope.run_id,scope.organisation_id]);
 const parity=await tx.query('SELECT p.generation::text,p.import_id,p.receipt_digest,p.shadow_digest,p.outcome FROM hyperfide_history.cutover_parity_receipts p JOIN hyperfide_history.cutovers c USING(scope_id) WHERE p.scope_id=$1 AND c.organisation_id=$2 ORDER BY p.generation',[scope.run_id,scope.organisation_id]);
 const rehearsals=await tx.query('SELECT r.operation_id,r.generation::text,r.path,r.authoritative_writes::text,r.external_effects::text,r.sqlite_authority_reopened FROM hyperfide_history.cutover_rehearsals r JOIN hyperfide_history.cutovers c USING(scope_id) WHERE r.scope_id=$1 AND c.organisation_id=$2 ORDER BY r.generation',[scope.run_id,scope.organisation_id]);
 return {scope_id:scope.run_id,state:state.rows[0]??null,parity_receipts:parity.rows,rehearsals:rehearsals.rows,authority_granted:false,activation_available:false};
 }).then(async inspected=>({...inspected,shadow:typeof v.source_import_id==='string'?{...await shadowCompare(ctx,i,scope,v.source_import_id),mode:'READ_ONLY_SHADOW',authority_granted:false}:null}));
 if(v.operation_id!==i.operation.idempotency_key)fail('CUTOVER_OPERATION','Intent identity must equal signed idempotency key');
 const requestDigest=hash(canonical({action,...v})),recovery=controls(ctx);
 const replay=async(tx:IdentityTransaction)=>{
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,25))',[scope.run_id]);
 const prior=await tx.query('SELECT r.request_digest,r.result FROM hyperfide_history.cutover_receipts r JOIN hyperfide_history.cutovers c USING(scope_id) WHERE r.scope_id=$1 AND r.operation_id=$2 AND c.organisation_id=$3',[scope.run_id,v.operation_id,scope.organisation_id]);
 if(!prior.rows[0])return null;
 if(prior.rows[0].request_digest!==requestDigest)fail('CUTOVER_CONFLICT','Immutable intent replay changed');
 return {...prior.rows[0].result,replayed:true,authority_granted:false};
 };
 const current=async(tx:IdentityTransaction,allowed:string[])=>{
 const row=(await tx.query('SELECT state,generation::text,source_import_id,evidence,organisation_id FROM hyperfide_history.cutovers WHERE scope_id=$1 FOR UPDATE',[scope.run_id])).rows[0];
 if(row&&row.organisation_id!==scope.organisation_id)fail('CUTOVER_SCOPE','Cutover intent belongs to another organisation');
 const state=row?String(row.state):'LOCAL',generation=row?String(row.generation):'1';
 if(!allowed.includes(state))fail('CUTOVER_STATE','Transition is not permitted from '+state);
 if(generation!==v.expected_generation)fail('CUTOVER_STALE','Pinned intent generation changed');
 return {exists:!!row,state,generation,next:(BigInt(generation)+1n).toString(),source_import_id:row?.source_import_id??null,evidence:(row?.evidence??{}) as Record<string,unknown>};
 };
 const receipt=async(tx:IdentityTransaction,result:Record<string,unknown>)=>{
 await tx.query('INSERT INTO hyperfide_history.cutover_receipts(scope_id,operation_id,request_digest,result) VALUES($1,$2,$3,$4)',[scope.run_id,v.operation_id,requestDigest,result]);
 return result;
 };
 const fresh=async(tx:IdentityTransaction,expires:string)=>{
 const now=(await tx.query('SELECT clock_timestamp() AS now')).rows[0]?.now as Date;
 if(Date.parse(expires)<=now.getTime())fail('CUTOVER_LEGACY_ISOLATION_EXPIRED','Legacy writer isolation observation was not fresh at primary admission');
 };
 try{
 if(action==='cutover.activate')return await guarded(ctx,action,async tx=>{
 const prior=await replay(tx);if(prior)return prior;
 await current(tx,['VALIDATED']);
 return fail('CUTOVER_EXTERNAL_FENCER_UNAVAILABLE','No coordinator-approved 4.4 external-writer fence is installed for this deployment; the validated intent remains non-authoritative');
 });
 if(action==='cutover.prepare'){
 const early=await guarded(ctx,action,async tx=>{
 const prior=await replay(tx);if(prior)return prior;
 await current(tx,['LOCAL','ROLLED_BACK']);await recovery.assertQuiesced(tx,scope);return null;
 });
 if(early)return early;
 // Admission is disabled before isolation is observed; both are bound to this operation.
 const writers=legacy(ctx),li=legacyInput(ctx,String(v.operation_id),v.legacy_source_epoch,i.signal);
 const admission=await writers.disableAdmission(li),isolation=await writers.observeIsolation(li);
 return await guarded(ctx,action,async tx=>{
 const prior=await replay(tx);if(prior)return prior;
 const c=await current(tx,['LOCAL','ROLLED_BACK']);
 await recovery.assertQuiesced(tx,scope);await fresh(tx,isolation.expires_at);
 const baseline=await fingerprint(tx,scope),quiesced_at=((await tx.query('SELECT clock_timestamp()::text AS now')).rows[0]?.now) as string;
 const evidence={run_quiescence:'OBSERVED',legacy_admission:{status:admission.status,evidence_digest:admission.evidence_digest,source_epoch:admission.source_epoch},
  legacy_writer_isolation:{status:isolation.status,evidence_digest:isolation.evidence_digest,topology_digest:isolation.topology_digest,visibility:isolation.visibility,expires_at:isolation.expires_at},
  baseline,baseline_digest:hash(canonical(baseline)),quiesced_at,semantic_parity:'PENDING',external_epoch_activation:'NOT_PERFORMED'};
 if(c.exists)await tx.query("UPDATE hyperfide_history.cutovers SET state='QUIESCED',generation=$2,source_import_id=NULL,checkpoint_digest=NULL,authoritative_writes=0,external_effects=0,evidence=$3,updated_at=clock_timestamp() WHERE scope_id=$1",[scope.run_id,c.next,evidence]);
 else await tx.query("INSERT INTO hyperfide_history.cutovers(scope_id,organisation_id,state,generation,evidence) VALUES($1,$2,'QUIESCED',$3,$4)",[scope.run_id,scope.organisation_id,c.next,evidence]);
 return receipt(tx,{outcome:'SUCCEEDED',scope_id:scope.run_id,state:'QUIESCED',previous_state:c.state,generation:c.next,authority_granted:false,legacy_writer_fenced:true,legacy_isolation_digest:isolation.evidence_digest,baseline_digest:evidence.baseline_digest,activation_available:false});
 });
 }
 if(action==='cutover.validate'){
 const early=await guarded(ctx,action,async tx=>{
 const prior=await replay(tx);if(prior)return prior;
 await current(tx,['QUIESCED']);await recovery.assertQuiesced(tx,scope);return null;
 });
 if(early)return early;
 // Isolation is re-observed: a legacy writer that resumed after preparation invalidates parity.
 const isolation=await legacy(ctx).observeIsolation(legacyInput(ctx,String(v.operation_id),v.legacy_source_epoch,i.signal));
 const report:ParityReport=await shadowCompare(ctx,i,scope,String(v.source_import_id));
 if(report.outcome!=='MATCHED')fail('CUTOVER_PARITY_MISMATCH','Parity mismatch: '+report.mismatches.slice(0,8).join(','));
 return await guarded(ctx,action,async tx=>{
 const prior=await replay(tx);if(prior)return prior;
 const c=await current(tx,['QUIESCED']);
 await recovery.assertQuiesced(tx,scope);await fresh(tx,isolation.expires_at);
 if(isolation.topology_digest!==(c.evidence.legacy_writer_isolation as Record<string,unknown>|undefined)?.topology_digest)fail('CUTOVER_LEGACY_TOPOLOGY_CHANGED','Legacy writer topology changed after preparation');
 if(await historyDigest(tx,String(v.source_import_id))!==report.history_digest)fail('CUTOVER_STALE','Historical rows changed after parity comparison');
 const observed=await fingerprint(tx,scope),baseline=c.evidence.baseline as Fingerprint;
 if(changes(baseline,observed,'')!==0n)fail('CUTOVER_NOT_QUIESCED','PostgreSQL authority changed after quiescence; prepare again');
 const receiptDigest=hash(canonical({scope_id:scope.run_id,generation:c.next,isolation:isolation.evidence_digest,report:report.shadow_digest}));
 await tx.query("INSERT INTO hyperfide_history.cutover_parity_receipts(scope_id,generation,import_id,snapshot_digest,legacy_isolation_digest,counts,samples,source,git,artifacts,shadow_digest,receipt_digest,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'MATCHED')",
  [scope.run_id,c.next,v.source_import_id,report.snapshot_digest,isolation.evidence_digest,JSON.stringify(report.counts),JSON.stringify(report.samples),report.source,report.git,report.artifacts,report.shadow_digest,receiptDigest]);
 await tx.query("UPDATE hyperfide_history.cutovers SET state='VALIDATED',generation=$2,source_import_id=$3,checkpoint_digest=$4,evidence=evidence||$5::jsonb,updated_at=clock_timestamp() WHERE scope_id=$1",[scope.run_id,c.next,v.source_import_id,receiptDigest,JSON.stringify({semantic_parity:'MATCHED',parity_receipt_digest:receiptDigest})]);
 return receipt(tx,{outcome:'SUCCEEDED',scope_id:scope.run_id,state:'VALIDATED',generation:c.next,source_import_id:v.source_import_id,parity_receipt_digest:receiptDigest,shadow_digest:report.shadow_digest,
  counts:report.counts.length,samples:report.samples.length,authority_granted:false,activation_available:false});
 });
 }
 // cutover.recovery names one of two separate procedures; cutover.rollback is the first.
 const chosen=action==='cutover.rollback'?'ROLLBACK_BEFORE_WRITES':v.procedure;
 if(chosen==='ROLLBACK_BEFORE_WRITES'){
 const result=await guarded(ctx,action,async tx=>{
 const prior=await replay(tx);if(prior)return prior;
 const c=await current(tx,['QUIESCED','VALIDATED']);
 await recovery.assertQuiesced(tx,scope);
 const baseline=c.evidence.baseline as Fingerprint,observed=await fingerprint(tx,scope);
 const writes=changes(baseline,observed,'authority:'),effects=changes(baseline,observed,'effect:');
 const before=writes===0n&&effects===0n,path=before?'ROLLBACK_BEFORE_WRITES':'ROLLBACK_REFUSED_AFTER_WRITES',state=before?'ROLLED_BACK':'RECOVERY_REQUIRED';
 const procedure=before?{steps:['RECORD_ROLLED_BACK_INTENT','RESTORE_EXACT_LEGACY_ADMISSION','OPERATOR_REMOUNT_LEGACY_STORAGE_WRITABLE'],postgresql_history:'RETAINED_NON_AUTHORITATIVE',legacy_authority:'RESTORED_UNCHANGED'}:
  {steps:['REFUSE_LEGACY_RESTORE','KEEP_LEGACY_ADMISSION_DISABLED','RUN_CUTOVER_RECOVERY'],legacy_authority:'PERMANENTLY_SUPERSEDED',reason:'PostgreSQL accepted writes or external effects after quiescence'};
 await tx.query('UPDATE hyperfide_history.cutovers SET state=$2,generation=$3,authoritative_writes=$4,external_effects=$5,updated_at=clock_timestamp() WHERE scope_id=$1',[scope.run_id,state,c.next,writes.toString(),effects.toString()]);
 await tx.query('INSERT INTO hyperfide_history.cutover_rehearsals(scope_id,operation_id,generation,path,baseline,observed,authoritative_writes,external_effects,procedure) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[scope.run_id,v.operation_id,c.next,path,baseline,observed,writes.toString(),effects.toString(),procedure]);
 return receipt(tx,{outcome:before?'SUCCEEDED':'REFUSED',refusal:before?null:'CUTOVER_ROLLBACK_AFTER_WRITES',path,scope_id:scope.run_id,state,previous_state:c.state,generation:c.next,
  authoritative_writes:writes.toString(),external_effects:effects.toString(),procedure,sqlite_authority_reopened:false,authority_granted:false});
 });
 if(result.path!=='ROLLBACK_BEFORE_WRITES')return result;
 // Legacy admission is restored only after the rollback intent is durable, so a
 // failure here leaves both sides non-writable rather than two writable authorities.
 try{
 const restored=await legacy(ctx).restoreAdmission(legacyInput(ctx,String(v.operation_id),v.legacy_source_epoch,i.signal));
 return {...result,legacy_admission:{status:restored.status,evidence_digest:restored.evidence_digest}};
 }catch(error){
 return {...result,legacy_admission:{status:'RESTORE_PENDING',code:object(error)&&typeof error.code==='string'?error.code:'ERROR'}};
 }
 }
 return await guarded(ctx,action,async tx=>{
 const prior=await replay(tx);if(prior)return prior;
 const c=await current(tx,['RECOVERY_REQUIRED']);
 await recovery.assertQuiesced(tx,scope);await recovery.assertNoNewEffects(tx,scope);
 const baseline=c.evidence.baseline as Fingerprint,observed=await fingerprint(tx,scope);
 const writes=changes(baseline,observed,'authority:'),effects=changes(baseline,observed,'effect:');
 if(writes===0n&&effects===0n)fail('CUTOVER_USE_ROLLBACK','No new PostgreSQL writes or effects were observed; use the rollback-before-writes procedure');
 const reverse=Object.keys(observed).filter(k=>baseline[k]?.digest!==observed[k]!.digest).map(k=>({table:k,rows_before:baseline[k]?.rows??'0',rows_after:observed[k]!.rows}));
 const procedure={target:'POSTGRESQL_FORWARD_RECOVERY',source_of_truth:'POSTGRESQL',sqlite_archive:'READ_ONLY_HISTORY',legacy_admission:'REMAINS_DISABLED',reverse_export:reverse,
  steps:['ASSERT_RUN_QUIESCED','ASSERT_NO_UNRESOLVED_EFFECTS','EXPORT_POST_CUTOVER_ROWS_AS_NEW_HISTORY','RECONCILE_EXTERNAL_EFFECTS_FORWARD','NEVER_REOPEN_SQLITE_ARCHIVE'],
  irreversible:['POSTGRESQL_SCHEMA_0252','EXTERNAL_EFFECTS_ALREADY_PERFORMED']};
 await tx.query('UPDATE hyperfide_history.cutovers SET generation=$2,authoritative_writes=$3,external_effects=$4,updated_at=clock_timestamp() WHERE scope_id=$1',[scope.run_id,c.next,writes.toString(),effects.toString()]);
 await tx.query("INSERT INTO hyperfide_history.cutover_rehearsals(scope_id,operation_id,generation,path,baseline,observed,authoritative_writes,external_effects,procedure) VALUES($1,$2,$3,'RECOVERY_AFTER_EFFECTS',$4,$5,$6,$7,$8)",[scope.run_id,v.operation_id,c.next,baseline,observed,writes.toString(),effects.toString(),procedure]);
 return receipt(tx,{outcome:'RECOVERY_PLANNED',path:'RECOVERY_AFTER_EFFECTS',scope_id:scope.run_id,state:'RECOVERY_REQUIRED',generation:c.next,authoritative_writes:writes.toString(),external_effects:effects.toString(),
  procedure,sqlite_authority_reopened:false,restoration_performed:false,authority_granted:false});
 });
 }catch(error){
 if(object(error)&&error.code==='COMMIT_AMBIGUOUS')return {outcome:'UNKNOWN',scope_id:scope.run_id,operation_id:v.operation_id,automatic_replay:false,authority_granted:false,reconcile:'INSPECT_DURABLE_INTENT'};
 throw error;
 }
 }]))};}
