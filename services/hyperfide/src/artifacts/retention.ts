import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction,QuerySession} from '../storage/transactions.js';
import {FoundationError} from '../policy/programme.js';
import {assertInvocation} from '../transport/protocol.js';

type Invocation={principal:{organisation_id:string;run_id:string;actor_id:string;deployment_epoch:string;role:string};operation:{operation_id:string};guard:(tx:QuerySession)=>Promise<void>;signal:AbortSignal};
type Context=ComponentContext&{invocation?:Invocation};
type Scope={organisation_id:string;run_id:string};
type Backend={destroyTombstoned:(input:unknown,context:ComponentContext)=>Promise<unknown>};
type Row=Record<string,any>;
type Policy={digest:string;minimum_age_ms:Record<string,number|null>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST=/^sha256:[0-9a-f]{64}$/;
const classes=['EPHEMERAL','RUN','RELEASE','LEGAL_HOLD'];
const ACTIONS=['artifact.retention.inspect','artifact.retention.hold','artifact.retention.release','artifact.retention.policy','artifact.retention.collect','artifact.retention.reconcile'];
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function record(value:unknown):Row{if(!value||typeof value!=='object'||Array.isArray(value))fail('RETENTION_INPUT_INVALID','Expected an object');return value as Row;}
function fields(value:unknown,required:string[]):Row{const row=record(value);if(Object.keys(row).length!==required.length||required.some(key=>!Object.hasOwn(row,key)))fail('RETENTION_INPUT_INVALID','Retention fields differ');return row;}
function uuid(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))fail('RETENTION_INPUT_INVALID','Expected UUID');return value;}
function digest(value:unknown):string{if(typeof value!=='string'||!DIGEST.test(value))fail('RETENTION_INPUT_INVALID','Expected SHA-256 digest');return value;}
function decimal(value:unknown):string{if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)fail('RETENTION_INPUT_INVALID','Expected positive canonical version');return value;}
function reason(value:unknown):string{if(typeof value!=='string'||value.length<1||value.length>2048||/[\x00-\x1f\x7f]/.test(value))fail('RETENTION_INPUT_INVALID','Bounded audit reason required');return value;}
function timestamp(value:unknown):string|null{if(value===null)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('RETENTION_INPUT_INVALID','Invalid UTC timestamp');return value;}
function canonical(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Row)[key])).join(',')+'}';}
function hash(value:string|Buffer):string{return 'sha256:'+createHash('sha256').update(value).digest('hex');}
function backend(value:unknown):value is Backend{return !!value&&typeof value==='object'&&'destroyTombstoned' in value&&typeof value.destroyTombstoned==='function';}
export class ArtifactRetention{
 constructor(private readonly context:Context){}
 private actor():Invocation{const actor=this.context.invocation;assertInvocation(actor);return actor;}
 private scope(value:Row):Scope{const scope={organisation_id:uuid(value.organisation_id),run_id:uuid(value.run_id)},actor=this.actor();if(scope.organisation_id!==actor.principal.organisation_id||scope.run_id!==actor.principal.run_id)fail('RETENTION_SCOPE_DENIED','Retention scope differs from verified caller');return scope;}
 private async policy(expected:unknown):Promise<Policy>{
 const name=this.context.env.HF_ARTIFACT_RETENTION_POLICY_FILE;if(!name)fail('RETENTION_POLICY_REQUIRED','Trusted retention policy required');
 try{
 const info=await fs.lstat(name);if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>65536)throw new Error();
 const bytes=await fs.readFile(name),identity=hash(bytes);if(digest(expected)!==identity)fail('RETENTION_POLICY_CHANGED','Retention policy digest differs');
 const value=fields(JSON.parse(bytes.toString('utf8')),['schema_version','organisation_id','policy_id','policy_revision','minimum_age_ms']);
 if(value.schema_version!==1||uuid(value.organisation_id)!==this.actor().principal.organisation_id||!uuid(value.policy_id)||!Number.isSafeInteger(value.policy_revision)||value.policy_revision<1)throw new Error();
 const ages=fields(value.minimum_age_ms,classes),limits:Record<string,number|null>={};
 for(const type of classes){const age=ages[type];if(age!==null&&(!Number.isSafeInteger(age)||age<0||age>31536000000))throw new Error();limits[type]=age;}
 if(limits.LEGAL_HOLD!==null)throw new Error();
 return {digest:identity,minimum_age_ms:limits};
 }catch(error){if(error instanceof FoundationError)throw error;fail('RETENTION_POLICY_INVALID','Trusted retention policy is invalid');}
 }
 private async transaction<T>(body:(tx:PrimaryTransaction)=>Promise<T>):Promise<T>{const actor=this.actor();return this.context.resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal:actor.signal,guard:tx=>actor.guard(tx)},async tx=>{const result=await body(tx);await actor.guard(tx);return result;});}
 private async artifact(tx:PrimaryTransaction,scope:Scope,id:string):Promise<Row>{const result=await tx.query('SELECT *,size_bytes::text,state_version::text,clock_timestamp() AS db_now FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,id]);const row=result.rows[0];if(!row)fail('RETENTION_NOT_FOUND','Artifact is not registered');return row;}
 private async blockers(tx:PrimaryTransaction,scope:Scope,row:Row,policy:Policy):Promise<string[]>{
 const reasons:string[]=[],now=new Date(row.db_now).getTime(),minimum=policy.minimum_age_ms[String(row.retention_class)];
 if(row.retention_hold||row.retention_class==='LEGAL_HOLD')reasons.push('LEGAL_OR_EXPLICIT_HOLD');
 if(minimum===undefined||minimum===null)reasons.push('INDEFINITE_RETENTION');
 else if(new Date(row.created_at).getTime()+minimum>now)reasons.push('MINIMUM_AGE');
 if(row.retention_until&&new Date(row.retention_until).getTime()>now)reasons.push('RETENTION_DEADLINE');
 const values=[scope.organisation_id,scope.run_id,row.id];
 const queries:Record<string,string>={
 UNRESOLVED_FINDING:"SELECT 1 FROM hyperfide.findings f JOIN hyperfide.finding_observations o ON o.organisation_id=f.organisation_id AND o.run_id=f.run_id AND o.finding_id=f.id JOIN hyperfide.evidence e ON e.organisation_id=o.organisation_id AND e.run_id=o.run_id AND e.id=o.evidence_id WHERE f.organisation_id=$1 AND f.run_id=$2 AND f.state IN ('OPEN','ACKNOWLEDGED') AND (e.artifact_id=$3 OR EXISTS(SELECT 1 FROM hyperfide.evidence_artifacts a WHERE a.organisation_id=e.organisation_id AND a.run_id=e.run_id AND a.evidence_id=e.id AND a.artifact_id=$3)) LIMIT 1",
 PENDING_PUBLICATION_EVIDENCE:"SELECT 1 FROM hyperfide.publication_intents p JOIN hyperfide.candidate_evidence c ON c.organisation_id=p.organisation_id AND c.run_id=p.run_id AND c.candidate_id=p.candidate_id JOIN hyperfide.evidence e ON e.organisation_id=c.organisation_id AND e.run_id=c.run_id AND e.id=c.evidence_id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.state IN ('PENDING','EXECUTING') AND (e.artifact_id=$3 OR EXISTS(SELECT 1 FROM hyperfide.evidence_artifacts a WHERE a.organisation_id=e.organisation_id AND a.run_id=e.run_id AND a.evidence_id=e.id AND a.artifact_id=$3)) LIMIT 1",
 PENDING_PUBLICATION_MANIFEST:"SELECT 1 FROM hyperfide.publication_intents p JOIN hyperfide.integration_candidates c ON c.organisation_id=p.organisation_id AND c.run_id=p.run_id AND c.id=p.candidate_id JOIN hyperfide.submission_custodies s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.custody_id JOIN hyperfide.artifacts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND a.digest IN (s.source_manifest_digest,s.evidence_manifest_digest,c.input_manifest_digest) WHERE p.organisation_id=$1 AND p.run_id=$2 AND a.id=$3 AND p.state IN ('PENDING','EXECUTING') LIMIT 1",
 ACTIVE_HOLD:"SELECT 1 FROM hyperfide.artifact_holds WHERE organisation_id=$1 AND run_id=$2 AND artifact_id=$3 AND status='ACTIVE' LIMIT 1",
 COMPLETE_PARENT:"SELECT 1 FROM hyperfide.artifact_dependencies d JOIN hyperfide.artifacts p ON p.organisation_id=d.organisation_id AND p.run_id=d.run_id AND p.id=d.parent_artifact_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.child_artifact_id=$3 AND p.status='COMPLETE' LIMIT 1",
 REQUIRED_EVIDENCE:"SELECT 1 FROM hyperfide.evidence e WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.artifact_id=$3 AND e.admission_state IN ('PENDING','ADMITTED') UNION ALL SELECT 1 FROM hyperfide.evidence_artifacts a JOIN hyperfide.evidence e ON e.organisation_id=a.organisation_id AND e.run_id=a.run_id AND e.id=a.evidence_id WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.artifact_id=$3 AND e.admission_state IN ('PENDING','ADMITTED') LIMIT 1",
 LIVE_CHECKPOINT:"SELECT 1 FROM hyperfide.checkpoints c JOIN hyperfide.attempts a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.id=c.attempt_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.artifact_id=$3 AND (a.compute_authority='CURRENT' OR EXISTS(SELECT 1 FROM hyperfide.submission_custodies s WHERE s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.source_attempt_id=c.attempt_id AND s.authority='ACTIVE')) LIMIT 1",
 ACTIVE_ADOPTION:"SELECT 1 FROM hyperfide.artifact_adoptions d JOIN hyperfide.attempts a ON a.organisation_id=d.organisation_id AND a.run_id=d.run_id AND a.id=d.target_attempt_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND d.source_artifact_id=$3 AND (a.compute_authority='CURRENT' OR EXISTS(SELECT 1 FROM hyperfide.submission_custodies s WHERE s.organisation_id=d.organisation_id AND s.run_id=d.run_id AND s.source_attempt_id=d.target_attempt_id AND s.authority='ACTIVE')) LIMIT 1",
 GRAPH_PARSE_REFERENCE:"SELECT 1 FROM hyperfide.parse_blobs WHERE organisation_id=$1 AND run_id=$2 AND facts_artifact_id=$3 LIMIT 1",
 ACTIVE_CUSTODY:"SELECT 1 FROM hyperfide.submission_custodies s JOIN hyperfide.artifacts a ON a.organisation_id=s.organisation_id AND a.run_id=s.run_id AND (a.digest=s.source_manifest_digest OR a.digest=s.evidence_manifest_digest) WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 AND s.authority='ACTIVE' LIMIT 1"
 };
 for(const [name,query] of Object.entries(queries))if((await tx.query(query,values)).rows.length)reasons.push(name);
 reasons.push(...await this.otherReferences(tx,row));
 return reasons;
 }
 private async otherReferences(tx:PrimaryTransaction,row:Row):Promise<string[]>{
 const catalog=await tx.query<{schema_name:string;table_name:string;columns:{local:string;remote:string}[]}>(
 "SELECT ns.nspname AS schema_name,rel.relname AS table_name,jsonb_agg(jsonb_build_object('local',local_att.attname,'remote',remote_att.attname) ORDER BY link.position) AS columns FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace CROSS JOIN LATERAL unnest(con.conkey,con.confkey) WITH ORDINALITY AS link(local_number,remote_number,position) JOIN pg_attribute local_att ON local_att.attrelid=con.conrelid AND local_att.attnum=link.local_number JOIN pg_attribute remote_att ON remote_att.attrelid=con.confrelid AND remote_att.attnum=link.remote_number WHERE con.contype='f' AND con.confrelid='hyperfide.artifacts'::regclass GROUP BY con.oid,ns.nspname,rel.relname ORDER BY ns.nspname,rel.relname,con.oid");
 if(catalog.rows.length>256)fail('RETENTION_REFERENCE_CATALOG_LIMIT','Artifact reference catalog exceeds the reviewed bound');
 const known=new Set(['artifact_dependencies','checkpoints','evidence','evidence_artifacts','parse_blobs','artifact_adoptions','artifact_holds','artifact_gc_operations','artifact_retention_events']);
 const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"',reasons:string[]=[];
 for(const reference of catalog.rows){
 if(reference.schema_name==='hyperfide'&&known.has(reference.table_name))continue;
 if(!Array.isArray(reference.columns)||!reference.columns.length||reference.columns.length>8||reference.columns.some(column=>typeof column.local!=='string'||typeof column.remote!=='string'||!Object.hasOwn(row,column.remote)))fail('RETENTION_REFERENCE_CATALOG_INVALID','Artifact foreign key cannot be safely evaluated');
 const values=reference.columns.map(column=>row[column.remote]);
 const predicate=reference.columns.map((column,index)=>quote(column.local)+'=$'+(index+1)).join(' AND ');
 if((await tx.query('SELECT 1 FROM '+quote(reference.schema_name)+'.'+quote(reference.table_name)+' WHERE '+predicate+' LIMIT 1',values)).rows.length)reasons.push('UNRELEASED_REFERENCE:'+reference.schema_name+'.'+reference.table_name);
 }
 return [...new Set(reasons)];
 }

 private result(row:Row):unknown{return {operation:row,current_object_absent:row.state==='ABSENT',cleanup_debt:['INTENT','REQUESTED','UNKNOWN','FAILED'].includes(row.state),physical_version_erasure:'NOT_QUALIFIED',grants_authority:false};}
 private async inspect(input:unknown):Promise<unknown>{const value=fields(input,['organisation_id','run_id','artifact_id','policy_digest']),scope=this.scope(value),policy=await this.policy(value.policy_digest);return this.transaction(async tx=>{const row=await this.artifact(tx,scope,uuid(value.artifact_id)),blockers=await this.blockers(tx,scope,row,policy);return {artifact_id:row.id,status:row.status,eligible:['PENDING','COMPLETE'].includes(row.status)&&blockers.length===0,blockers,policy_digest:policy.digest,grants_authority:false};});}
 private async reference(tx:PrimaryTransaction,scope:Scope,kind:string,id:string):Promise<void>{
 const tables:Record<string,string>={EVIDENCE:'evidence',FINDING:'findings',PUBLICATION:'publication_intents',RECOVERY:'checkpoints',ADOPTION:'artifact_adoptions'};
 const table=tables[kind];if(!table)fail('RETENTION_INPUT_INVALID','Unknown hold reference kind');
 const result=await tx.query('SELECT id FROM hyperfide.'+table+' WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[scope.organisation_id,scope.run_id,id]);if(!result.rows.length)fail('RETENTION_REFERENCE_MISSING','Hold reference is not registered in this run');
 }
 private async hold(input:unknown):Promise<unknown>{
 const value=fields(input,['organisation_id','run_id','artifact_id','reference_kind','reference_id','reason','policy_digest','expires_at']),scope=this.scope(value),policy=await this.policy(value.policy_digest),id=uuid(value.artifact_id),reference=uuid(value.reference_id),why=reason(value.reason),until=timestamp(value.expires_at),kind=String(value.reference_kind);
 return this.transaction(async tx=>{
 const row=await this.artifact(tx,scope,id);if(!['PENDING','COMPLETE'].includes(row.status))fail('RETENTION_UNAVAILABLE','Cannot hold an unavailable artifact');
 if(kind!=='LEGAL')await this.reference(tx,scope,kind,reference);
 const prior=(await tx.query('SELECT * FROM hyperfide.artifact_holds WHERE organisation_id=$1 AND run_id=$2 AND artifact_id=$3 AND reference_kind=$4 AND reference_id=$5 FOR UPDATE',[scope.organisation_id,scope.run_id,id,kind,reference])).rows[0];
 if(prior){if(prior.status!=='ACTIVE'||prior.reason!==why||prior.policy_digest!==policy.digest)fail('RETENTION_REPLAY_CONFLICT','Reference hold binding differs');return {hold:prior,replayed:true,grants_authority:false};}
 const result=await tx.query('INSERT INTO hyperfide.artifact_holds(organisation_id,run_id,artifact_id,reference_kind,reference_id,reason,authority_actor,policy_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[scope.organisation_id,scope.run_id,id,kind,reference,why,this.actor().principal.actor_id,policy.digest,until]);return {hold:result.rows[0],replayed:false,grants_authority:false};
 });
 }
 private async release(input:unknown):Promise<unknown>{
 const value=fields(input,['organisation_id','run_id','hold_id','expected_state_version','reason','policy_digest']),scope=this.scope(value),policy=await this.policy(value.policy_digest),why=reason(value.reason),payload=hash(canonical(value)),actor=this.actor();
 return this.transaction(async tx=>{
 const row=(await tx.query('SELECT * FROM hyperfide.artifact_holds WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,uuid(value.hold_id)])).rows[0];
 if(!row)fail('RETENTION_NOT_FOUND','Reference hold is unavailable');
 if(row.status==='RELEASED'){
 if(row.release_operation_id!==actor.operation.operation_id||row.release_payload_digest!==payload)fail('RETENTION_REPLAY_CONFLICT','Reference release is bound to another operation');
 return {hold:row,replayed:true,grants_authority:false};
 }
 if(String(row.state_version)!==decimal(value.expected_state_version))fail('RETENTION_VERSION_CONFLICT','Reference hold version changed');
 const result=await tx.query("UPDATE hyperfide.artifact_holds SET status='RELEASED',released_at=clock_timestamp(),state_version=state_version+1,release_operation_id=$4,release_payload_digest=$5,release_actor=$6,release_reason=$7,release_policy_digest=$8 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 RETURNING *",[scope.organisation_id,scope.run_id,row.id,actor.operation.operation_id,payload,actor.principal.actor_id,why,policy.digest]);
 return {hold:result.rows[0],replayed:false,grants_authority:false};
 });
 }
 private async changePolicy(input:unknown):Promise<unknown>{
 const value=fields(input,['organisation_id','run_id','artifact_id','expected_state_version','retention_class','retention_until','retention_hold','reason','policy_digest']),scope=this.scope(value),policy=await this.policy(value.policy_digest),why=reason(value.reason),until=timestamp(value.retention_until);
 if(!classes.includes(value.retention_class)||typeof value.retention_hold!=='boolean'||value.retention_class==='LEGAL_HOLD'&&!value.retention_hold)fail('RETENTION_INPUT_INVALID','Invalid new retention policy');
 const payload=hash(canonical(value)),actor=this.actor();
 return this.transaction(async tx=>{
 const prior=(await tx.query('SELECT * FROM hyperfide.artifact_retention_events WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[scope.organisation_id,scope.run_id,actor.operation.operation_id])).rows[0];if(prior){if(prior.payload_digest!==payload)fail('RETENTION_REPLAY_CONFLICT','Retention operation payload differs');return {event:prior,replayed:true,grants_authority:false};}
 const row=await this.artifact(tx,scope,uuid(value.artifact_id));if(!['PENDING','COMPLETE'].includes(row.status)||String(row.state_version)!==decimal(value.expected_state_version))fail('RETENTION_VERSION_CONFLICT','Artifact state or version changed');
 const before={retention_class:row.retention_class,retention_until:row.retention_until,retention_hold:row.retention_hold},after={retention_class:value.retention_class,retention_until:until,retention_hold:value.retention_hold};
 await tx.query('UPDATE hyperfide.artifacts SET retention_class=$4,retention_until=$5,retention_hold=$6,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,row.id,after.retention_class,after.retention_until,after.retention_hold]);
 const event=(await tx.query('INSERT INTO hyperfide.artifact_retention_events(organisation_id,run_id,operation_id,artifact_id,payload_digest,policy_digest,authority_actor,reason,before_policy,after_policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[scope.organisation_id,scope.run_id,actor.operation.operation_id,row.id,payload,policy.digest,actor.principal.actor_id,why,JSON.stringify(before),JSON.stringify(after)])).rows[0];return {event,replayed:false,grants_authority:false};
 });
 }
 private async advance(scope:Scope,operation:Row,policy:Policy):Promise<Row>{
 return this.transaction(async tx=>{
 const row=await this.artifact(tx,scope,operation.artifact_id);
 const current=(await tx.query('SELECT * FROM hyperfide.artifact_gc_operations WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,operation.operation_id])).rows[0];
 if(!current)fail('RETENTION_NOT_FOUND','GC intent is unavailable');
 if(current.state==='ABSENT'||current.state==='RETAINED')return current;
 if(current.policy_digest!==policy.digest||row.digest!==current.digest||row.storage_key!==current.storage_key||row.storage_backend!==current.storage_backend)fail('RETENTION_VERSION_CONFLICT','GC immutable binding or policy changed');
 if(current.state==='INTENT'){
 if(!['PENDING','COMPLETE'].includes(row.status)||String(row.state_version)!==String(current.expected_state_version))fail('RETENTION_VERSION_CONFLICT','GC candidate was superseded');
 const blockers=await this.blockers(tx,scope,row,policy);
 if(blockers.length)return (await tx.query("UPDATE hyperfide.artifact_gc_operations SET state='RETAINED',last_error_code='REFERENCE_OR_RETENTION',updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 RETURNING *",[scope.organisation_id,scope.run_id,current.operation_id])).rows[0]!;
 await tx.query("UPDATE hyperfide.artifacts SET status='QUARANTINED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,row.id]);
 }else if(row.status!=='QUARANTINED')fail('RETENTION_VERSION_CONFLICT','Destruction no longer owns the quarantined artifact');
 return (await tx.query("UPDATE hyperfide.artifact_gc_operations SET state='REQUESTED',last_error_code=NULL,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 RETURNING *",[scope.organisation_id,scope.run_id,current.operation_id])).rows[0]!;
 });
 }
 private async execute(scope:Scope,operation:Row,policy:Policy):Promise<unknown>{
 const active=await this.advance(scope,operation,policy);
 if(['ABSENT','RETAINED'].includes(active.state))return this.result(active);
 const store=this.context.dependencies.require('15.2','artifact.backend.v1',backend);
 let observed:Row;
 try{observed=record(await store.destroyTombstoned({...scope,artifact_id:active.artifact_id,gc_operation_id:active.operation_id,expected_digest:active.digest},this.context));}
 catch(error){observed={outcome:'UNKNOWN',error_code:error instanceof FoundationError?error.code:'BACKEND_UNKNOWN'};}
 const result=await this.transaction(async tx=>{
 const row=await this.artifact(tx,scope,active.artifact_id);
 const prior=(await tx.query('SELECT * FROM hyperfide.artifact_gc_operations WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,active.operation_id])).rows[0];
 if(!prior)fail('RETENTION_NOT_FOUND','GC intent is unavailable');
 if(prior.state==='ABSENT')return prior;
 if(row.status!=='QUARANTINED'||row.digest!==active.digest||row.storage_key!==active.storage_key)fail('RETENTION_VERSION_CONFLICT','GC finalization binding changed');
 const absent=observed.outcome==='ABSENT'&&observed.current_object_absent===true;
 if(absent)await tx.query("UPDATE hyperfide.artifacts SET status='DELETED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,row.id]);
 const error=typeof observed.error_code==='string'&&/^[A-Z][A-Z0-9_]{0,127}$/.test(observed.error_code)?observed.error_code:null;
 return (await tx.query("UPDATE hyperfide.artifact_gc_operations SET state=$4,last_error_code=$5,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 RETURNING *",[scope.organisation_id,scope.run_id,active.operation_id,absent?'ABSENT':'UNKNOWN',error])).rows[0]!;
 });return this.result(result);
 }
 private async collect(input:unknown):Promise<unknown>{
 const value=fields(input,['organisation_id','run_id','artifact_id','expected_state_version','reason','policy_digest']),scope=this.scope(value),policy=await this.policy(value.policy_digest),why=reason(value.reason),actor=this.actor(),payload=hash(canonical(value));
 const operation=await this.transaction(async tx=>{
 const prior=(await tx.query('SELECT * FROM hyperfide.artifact_gc_operations WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,actor.operation.operation_id])).rows[0];if(prior){if(prior.payload_digest!==payload)fail('RETENTION_REPLAY_CONFLICT','GC operation payload differs');return prior;}
 const row=await this.artifact(tx,scope,uuid(value.artifact_id));if(!['PENDING','COMPLETE'].includes(row.status)||String(row.state_version)!==decimal(value.expected_state_version))fail('RETENTION_VERSION_CONFLICT','Artifact candidate changed');
 if(row.storage_backend!=='s3-v1')fail('RETENTION_BACKEND_UNSUPPORTED','Backend deletion is not supported');
 return (await tx.query('INSERT INTO hyperfide.artifact_gc_operations(organisation_id,run_id,operation_id,artifact_id,payload_digest,policy_digest,authority_actor,reason,expected_state_version,storage_backend,storage_key,digest,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[scope.organisation_id,scope.run_id,actor.operation.operation_id,row.id,payload,policy.digest,actor.principal.actor_id,why,row.state_version,row.storage_backend,row.storage_key,row.digest,row.size_bytes])).rows[0]!;
 });
 return this.execute(scope,operation,policy);
 }
 private async reconcile(input:unknown):Promise<unknown>{const value=fields(input,['organisation_id','run_id','gc_operation_id','policy_digest']),scope=this.scope(value),policy=await this.policy(value.policy_digest);const operation=await this.transaction(async tx=>{const row=(await tx.query('SELECT * FROM hyperfide.artifact_gc_operations WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[scope.organisation_id,scope.run_id,uuid(value.gc_operation_id)])).rows[0];if(!row)fail('RETENTION_NOT_FOUND','GC intent is unavailable');return row;});return this.execute(scope,operation,policy);}
 async invoke(action:string,input:unknown):Promise<unknown>{
 const actor=this.actor();
 if(action!=='artifact.retention.inspect'&&!['OPERATOR','PROVISIONER'].includes(actor.principal.role))fail('AUTH_ROLE_DENIED','Retention mutations require an authorised control actor');
 try{switch(action){case 'artifact.retention.inspect':return await this.inspect(input);case 'artifact.retention.hold':return await this.hold(input);case 'artifact.retention.release':return await this.release(input);case 'artifact.retention.policy':return await this.changePolicy(input);case 'artifact.retention.collect':return await this.collect(input);case 'artifact.retention.reconcile':return await this.reconcile(input);default:fail('RETENTION_INPUT_INVALID','Unknown retention operation');}}
 catch(error){if(error instanceof FoundationError)throw error;fail('RETENTION_DATABASE_UNAVAILABLE','Retention operation failed; reconcile durable intent before retry');}
 }
}
export function createComponent(_context:ComponentContext):Component{return {apiVersion:1,actions:Object.fromEntries(ACTIONS.map(action=>[action,(input:unknown,context:ComponentContext)=>new ArtifactRetention(context as Context).invoke(action,input)]))};}
