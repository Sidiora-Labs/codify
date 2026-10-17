import {createHash,randomUUID} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {invocationOf} from '../identity/enrollment.js';
import {FoundationError,object} from '../policy/programme.js';
import {canonical,digest,exact,fail,text,uuid,sha,validateChunk,validateManifest} from './extraction.js';
import type {BundleManifest,ExtractionIdentity,JsonObject} from './extraction.js';

export interface GraphTransaction {
 query<R extends pg.QueryResultRow=pg.QueryResultRow>(sql:string,values?:unknown[]):Promise<pg.QueryResult<R>>;
 copyFrom(sql:string,bytes:Uint8Array):Promise<{rowCount:number}>;
 remainingMs():number;readonly signal:AbortSignal;
}
export interface GraphGateway {withPrimaryTransaction<T>(options:{timeoutMs:number;maxRetries?:number;guard?:(tx:GraphTransaction)=>void|Promise<void>;signal?:AbortSignal},fn:(tx:GraphTransaction)=>Promise<T>):Promise<T>;}
export interface GraphScope {organisation_id:string;run_id:string;authority_epoch:string;}
export function scopeInput(input:JsonObject,ctx:ComponentContext):GraphScope {
 const p=invocationOf(ctx).principal,scope={organisation_id:uuid(p.organisation_id),run_id:uuid(p.run_id),authority_epoch:uuid(p.deployment_epoch)};
 if(uuid(input.organisation_id)!==scope.organisation_id||uuid(input.run_id)!==scope.run_id||uuid(input.authority_epoch)!==scope.authority_epoch)fail('GRAPH_SCOPE_DENIED','Graph request differs from authenticated principal');
 return scope;
}
export function graphRole(ctx:ComponentContext,write:boolean):void {
 const i=invocationOf(ctx),roles=write?['INDEXER','COORDINATOR','LEADER','OPERATOR']:['INDEXER','COORDINATOR','LEADER','OPERATOR','FEATURE_MANAGER','WORKER','VERIFIER','INTEGRATOR','COMMIT_WATCHER','ISSUE_WATCHER'];
 if(!roles.includes(i.principal.role)||!i.principal.allowed_actions.includes(i.payload.action))fail('GRAPH_ROLE_DENIED','Role/action cannot use graph capability');
}
export function graphGateway(ctx:ComponentContext):GraphGateway {
 const c=ctx as unknown as {dependencies?:{require:(id:string,capability:string,guard:(value:unknown)=>boolean)=>unknown}};
 if(!c.dependencies)fail('GRAPH_STORAGE_REQUIRED','Shared transaction capability is unavailable');
 return c.dependencies.require('4.2','storage.transactions.v1',v=>object(v)&&typeof v.withPrimaryTransaction==='function') as GraphGateway;
}
export async function graphGuard(tx:GraphTransaction,scope:GraphScope,ctx:ComponentContext,write=true):Promise<void> {
 const i=invocationOf(ctx);graphRole(ctx,write);
 if(scope.organisation_id!==i.principal.organisation_id||scope.run_id!==i.principal.run_id||scope.authority_epoch!==i.principal.deployment_epoch)fail('GRAPH_SCOPE_DENIED','Graph scope differs from authenticated principal');
 await i.guard(tx);
 const readiness=await tx.query<{ready:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm' AND n.nspname='public') AND (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hyperfide' AND c.relname=ANY($1::text[]) AND i.indisvalid AND i.indisready)=5 AND (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hyperfide' AND c.relname=ANY($2::text[]) AND t.tgname='aaa_supported_isolation' AND t.tgfoid=to_regprocedure('hyperfide.require_authority_isolation()') AND NOT t.tgisinternal AND t.tgenabled IN ('O','A'))=6 AS ready",[['graph_bodies_fts','graph_bodies_trigram','graph_facts_trigram','graph_comments_fts','graph_symbols_fts'],['graph_bundle_inputs','graph_ingestion_chunks','graph_fact_rows','graph_resolution_progress','graph_source_bodies','graph_publication_receipts']]);
 if(readiness.rows[0]?.ready!==true)fail('GRAPH_SCHEMA_UNAVAILABLE','Required graph migration/extension/indexes unavailable');
 const result=await tx.query<{state:string;authority_epoch:string}>('SELECT state,authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,scope.run_id]);
 const row=result.rows[0];if(!row||row.authority_epoch!==scope.authority_epoch)fail('GRAPH_AUTHORITY_STALE','Graph authority epoch changed');
 if(write&&!['READY','RUNNING'].includes(row.state))fail('GRAPH_RUN_INACTIVE','Graph mutation requires a ready or running run');
}
// Process-local graph admission, independent of the shared 4.2 primary pool.
// Graph work never holds more than maxActive primary connections, always below
// the pool maximum, so claims/heartbeats/identity keep reserved capacity.
// Waiting graph work holds no connection; a full queue or expired wait is a typed refusal.
export interface GraphAdmissionLimits {max_active:number;max_queued:number;queue_wait_ms:number;primary_pool_max:number}
interface AdmissionWaiter {grant:()=>void;refuse:(error:FoundationError)=>void}
export class GraphAdmission {
 private active=0;private queue:AdmissionWaiter[]=[];private admitted=0;private refused=0;
 constructor(readonly limits:GraphAdmissionLimits){}
 private overloaded(message:string):FoundationError{this.refused++;return new FoundationError('GRAPH_OVERLOADED',message);}
 async run<T>(signal:AbortSignal|undefined,fn:()=>Promise<T>):Promise<T>{
  if(signal?.aborted)throw new FoundationError('GRAPH_CANCELLED','Graph request cancelled before admission');
  if(this.active<this.limits.max_active)this.active++;
  else{
   if(this.limits.max_active===0)throw this.overloaded('Graph admission disabled: primary pool cannot reserve coordination capacity');
   if(this.queue.length>=this.limits.max_queued)throw this.overloaded('Graph admission queue is full');
   await new Promise<void>((resolve,reject)=>{
    const settle=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);const i=this.queue.indexOf(waiter);if(i>=0)this.queue.splice(i,1);};
    const waiter:AdmissionWaiter={grant:()=>{settle();resolve();},refuse:error=>{settle();reject(error);}};
    const abort=()=>waiter.refuse(new FoundationError('GRAPH_CANCELLED','Graph request cancelled while queued'));
    const timer=setTimeout(()=>waiter.refuse(this.overloaded('Graph admission wait expired')),this.limits.queue_wait_ms);
    signal?.addEventListener('abort',abort,{once:true});this.queue.push(waiter);
   });
  }
  this.admitted++;
  try{return await fn();}
  finally{const next=this.queue[0];if(next)next.grant();else this.active--;}
 }
 metrics():JsonObject{return {...this.limits,active:this.active,queued:this.queue.length,admitted:this.admitted,refused:this.refused};}
}
function admissionSetting(env:Readonly<NodeJS.ProcessEnv>,name:string,fallback:number,min:number,max:number):number{
 const value=env[name];if(value===undefined)return fallback;
 if(!/^(0|[1-9][0-9]*)$/.test(value)||Number(value)<min||Number(value)>max)fail('GRAPH_CONFIG_INVALID','Invalid bounded setting '+name);
 return Number(value);
}
function primaryPoolMax(ctx:ComponentContext):number{
 try{const value=(ctx.resources.describe() as {primary?:{maxActive?:unknown}}).primary?.maxActive;if(Number.isSafeInteger(value)&&Number(value)>=1)return Number(value);}catch{/* fall back to the 4.2 default contract */}
 return admissionSetting(ctx.env??{},'HYPERFIDE_PG_POOL_MAX',4,1,16);
}
export function graphAdmissionLimits(ctx:ComponentContext):GraphAdmissionLimits{
 const env=ctx.env??{},pool=primaryPoolMax(ctx),ceiling=pool-1;
 const maxActive=admissionSetting(env,'HYPERFIDE_GRAPH_MAX_ACTIVE',Math.max(0,Math.min(ceiling,Math.floor(pool/2))),0,15);
 if(maxActive>ceiling)fail('GRAPH_CONFIG_INVALID','HYPERFIDE_GRAPH_MAX_ACTIVE must stay below the primary pool maximum');
 return {max_active:maxActive,max_queued:admissionSetting(env,'HYPERFIDE_GRAPH_MAX_QUEUED',8,0,256),queue_wait_ms:admissionSetting(env,'HYPERFIDE_GRAPH_QUEUE_WAIT_MS',2000,1,30000),primary_pool_max:pool};
}
const admissions=new WeakMap<object,GraphAdmission>();
export function graphAdmission(ctx:ComponentContext):GraphAdmission{
 const key=ctx.resources as object;let admission=admissions.get(key);
 if(!admission){admission=new GraphAdmission(graphAdmissionLimits(ctx));admissions.set(key,admission);}
 return admission;
}
export async function graphTransaction<T>(ctx:ComponentContext,scope:GraphScope,fn:(tx:GraphTransaction)=>Promise<T>,write=true):Promise<T>{
 const gateway=graphGateway(ctx),signal=invocationOf(ctx).signal;
 return graphAdmission(ctx).run(signal,()=>gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal,guard:tx=>graphGuard(tx,scope,ctx,write)},fn));
}
export function sourceId(build:string,bundle:string,family:string,legacy:unknown):string {
 const h=createHash('md5').update(build+':'+bundle+':'+family+':'+String(legacy)).digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
// Mirror resolve()'s sourceId(build,bundle,'semantic_edges',legacy-id) identity.
// Raw edges whose endpoints cannot be projected remain evidence, never proof of absence.
export async function semanticProjectionDebt(tx:Pick<GraphTransaction,'query'>,s:GraphScope,graphId:string):Promise<{count:string;rows:JsonObject[]}>{
 const result=await tx.query<{bundle_digest:string;fact_key:string;payload:JsonObject;unresolved_count:string}>("SELECT f.bundle_digest,f.fact_key,f.payload,count(*) OVER()::text AS unresolved_count FROM hyperfide.graph_fact_rows f WHERE f.organisation_id=$1 AND f.run_id=$2 AND f.graph_id=$3 AND f.family='semantic_edges' AND NOT EXISTS(SELECT 1 FROM hyperfide.graph_edges e WHERE e.organisation_id=f.organisation_id AND e.run_id=f.run_id AND e.graph_id=f.graph_id AND e.id=md5($3::text||':'||f.bundle_digest||':semantic_edges:'||COALESCE(f.payload->>'id',f.payload->>'symbol_id',f.fact_key))::uuid) ORDER BY f.bundle_digest,f.fact_key LIMIT 256",[s.organisation_id,s.run_id,graphId]);
 return {count:result.rows[0]?.unresolved_count??'0',rows:result.rows.map(({unresolved_count,...row})=>({...row,resolution_state:'UNPROJECTED_ENDPOINT'}))};
}
export async function getBuild(tx:GraphTransaction,s:GraphScope,id:string,lock=false):Promise<JsonObject> {
 const r=await tx.query('SELECT * FROM hyperfide.graph_builds WHERE organisation_id=$1 AND run_id=$2 AND id=$3'+(lock?' FOR UPDATE':''),[s.organisation_id,s.run_id,id]);
 if(!r.rows[0])fail('GRAPH_BUILD_UNAVAILABLE','Exact graph build unavailable');return r.rows[0] as JsonObject;
}
// Row locks serialize eligibility with actual artifact quarantine/GC. PostgreSQL
// manifest custody is checked here; COMPLETE does not attest external store health.
export async function assertGraphArtifacts(tx:GraphTransaction,s:GraphScope,id:string):Promise<void>{
 const rows=await tx.query<{manifest_text:string;digest:string;size_bytes:string;status:string}>('SELECT b.manifest_text,a.digest,a.size_bytes::text,a.status FROM hyperfide.graph_bundle_inputs b JOIN hyperfide.artifacts a ON a.organisation_id=b.organisation_id AND a.run_id=b.run_id AND a.id=b.artifact_id WHERE b.organisation_id=$1 AND b.run_id=$2 AND b.graph_id=$3 ORDER BY a.id FOR SHARE OF a',[s.organisation_id,s.run_id,id]);
 if(!rows.rows.length)fail('GRAPH_ARTIFACT_UNAVAILABLE','Exact graph manifest artifacts are unavailable');
 for(const row of rows.rows)if(row.status!=='COMPLETE'||row.digest!==digest(row.manifest_text)||row.size_bytes!==String(Buffer.byteLength(row.manifest_text)))fail('GRAPH_ARTIFACT_UNAVAILABLE','Exact graph manifest artifact is unavailable or has conflicting custody metadata');
}
export async function graphCoverage(tx:GraphTransaction,s:GraphScope,id:string):Promise<JsonObject>{
 const rows=await tx.query<{family:string;count:string}>('SELECT family,count(*)::text AS count FROM hyperfide.graph_fact_rows WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 GROUP BY family ORDER BY family',[s.organisation_id,s.run_id,id]);
 const health=await tx.query<{failed:string}>("SELECT count(*)::text AS failed FROM hyperfide.graph_fact_rows WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND family='extraction_health' AND (payload->>'status' IN ('failed','partial') OR payload->'pending_version'<>'null'::jsonb)",[s.organisation_id,s.run_id,id]);
 return {counts:Object.fromEntries(rows.rows.map(r=>[r.family,Number(r.count)])),failed_files:Number(health.rows[0]!.failed)};
}
async function createBuild(input:unknown,ctx:ComponentContext):Promise<unknown> {
 const r=exact(input,['organisation_id','run_id','authority_epoch','bundles']),s=scopeInput(r,ctx);
 if(!Array.isArray(r.bundles)||!r.bundles.length||r.bundles.length>64)fail('GRAPH_INVALID','Bounded exact source set required');
 const bundles=r.bundles.map(validateManifest).sort((a,b)=>a.identity.repository_id.localeCompare(b.identity.repository_id));
 if(new Set(bundles.map(b=>b.identity.repository_id)).size!==bundles.length)fail('GRAPH_BRANCH_MIX','One revision per repository required');
 for(const b of bundles)if(b.identity.organisation_id!==s.organisation_id||b.identity.run_id!==s.run_id)fail('GRAPH_BRANCH_MIX','Bundle scope differs');
 const inputDigest=digest(canonical(bundles)),sourceDigest=digest(canonical(bundles.map(b=>b.identity)));
 return graphTransaction(ctx,s,async tx=>{
  for(const b of bundles){
   const pin=await tx.query("SELECT 1 FROM hyperfide.run_repositories rr JOIN hyperfide.source_objects so ON so.organisation_id=rr.organisation_id AND so.repository_id=rr.repository_id AND so.object_id=$4 WHERE rr.organisation_id=$1 AND rr.run_id=$2 AND rr.repository_id=$3 AND so.object_type='commit'",[s.organisation_id,s.run_id,b.identity.repository_id,b.identity.commit]);
   if(pin.rowCount!==1)fail('GRAPH_SOURCE_DENIED','Source commit is not registered in run repository set');
  }
  const prior=await tx.query('SELECT id,state FROM hyperfide.graph_builds WHERE organisation_id=$1 AND run_id=$2 AND input_digest=$3',[s.organisation_id,s.run_id,inputDigest]);
  if(prior.rows[0]){await assertGraphArtifacts(tx,s,String(prior.rows[0].id));return {build_id:prior.rows[0].id,state:prior.rows[0].state,replayed:true,input_digest:inputDigest,source_manifest_digest:sourceDigest};}
  const id=randomUUID();
  const created=await tx.query('INSERT INTO hyperfide.graph_builds(organisation_id,run_id,id,input_digest,source_manifest_digest,parser_digest,schema_digest,config_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organisation_id,run_id,input_digest) DO NOTHING RETURNING id',[s.organisation_id,s.run_id,id,inputDigest,sourceDigest,digest(canonical(bundles.map(b=>b.identity.parser_digest))),digest('hyperfide.graph.bundle.v1'),digest(canonical(bundles.map(b=>b.identity.config_digest)))]);
  if(!created.rowCount){const existing=(await tx.query('SELECT id,state FROM hyperfide.graph_builds WHERE organisation_id=$1 AND run_id=$2 AND input_digest=$3',[s.organisation_id,s.run_id,inputDigest])).rows[0];if(!existing)fail('GRAPH_BUILD_UNAVAILABLE','Concurrent build requires exact replay');await assertGraphArtifacts(tx,s,String(existing.id));return {build_id:existing.id,state:existing.state,replayed:true,input_digest:inputDigest,source_manifest_digest:sourceDigest};}
  for(const b of bundles){
   const body=canonical(b),bodyDigest=digest(body),size=String(Buffer.byteLength(body));
   // Artifacts are content-addressed within the run, independent of graph build.
   // Reuse complete identical metadata; never relabel an incomplete object.
   const inserted=await tx.query("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,retention_class) VALUES($1,$2,$3,$4,$5,'POSTGRES_GRAPH',$6,'COMPLETE','RUN') ON CONFLICT(organisation_id,run_id,digest) DO NOTHING RETURNING id,size_bytes::text,status",[s.organisation_id,s.run_id,sourceId(id,b.bundle_digest,'manifest',0),bodyDigest,size,id+'/'+b.bundle_digest]);
   const stored=inserted.rows[0]??(await tx.query('SELECT id,size_bytes::text,status FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND digest=$3 FOR SHARE',[s.organisation_id,s.run_id,bodyDigest])).rows[0];
   if(!stored||stored.status!=='COMPLETE'||String(stored.size_bytes)!==size)fail('GRAPH_ARTIFACT_CONFLICT','Existing manifest artifact is unavailable or conflicts with exact bytes');
   const artifactId=String(stored.id);
   // Exact manifest bytes also persist here in the same primary transaction.
   // PostgreSQL-backed provenance does not claim external object-store qualification.
   await tx.query('INSERT INTO hyperfide.graph_bundle_inputs(organisation_id,run_id,graph_id,bundle_digest,identity,manifest,manifest_text,artifact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[s.organisation_id,s.run_id,id,b.bundle_digest,canonical(b.identity),body,body,artifactId]);
  }
  return {build_id:id,state:'STAGING',replayed:false,input_digest:inputDigest,source_manifest_digest:sourceDigest};
 });
}
function copyCell(value:string):string {return value.replace(/\\/g,'\\\\').replace(/\t/g,'\\t').replace(/\n/g,'\\n').replace(/\r/g,'\\r');}
async function stageChunk(input:unknown,ctx:ComponentContext):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','build_id','bundle_digest','chunk']),s=scopeInput(r,ctx),id=uuid(r.build_id),bundle=sha(r.bundle_digest),chunk=validateChunk(r.chunk);
 return graphTransaction(ctx,s,async tx=>{
  const build=await getBuild(tx,s,id,true);
  const source=await tx.query<{manifest:BundleManifest;identity:ExtractionIdentity}>('SELECT manifest,identity FROM hyperfide.graph_bundle_inputs WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND bundle_digest=$4',[s.organisation_id,s.run_id,id,bundle]);
  const expected=source.rows[0]?.manifest.chunks[chunk.index];
  if(!expected||canonical(source.rows[0]!.identity)!==canonical(chunk.identity)||expected.digest!==chunk.digest||expected.rows!==chunk.rows.length||expected.bytes!==Buffer.byteLength(canonical(chunk)))fail('GRAPH_CHUNK_MISMATCH','Chunk differs from pinned manifest');
  const prior=await tx.query('SELECT chunk_digest,row_count FROM hyperfide.graph_ingestion_chunks WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND bundle_digest=$4 AND chunk_index=$5',[s.organisation_id,s.run_id,id,bundle,chunk.index]);
  if(prior.rows[0]){if(prior.rows[0].chunk_digest!==chunk.digest)fail('GRAPH_CHUNK_CONFLICT','Existing chunk differs');return {replayed:true,chunk_index:chunk.index,rows:prior.rows[0].row_count};}
  if(build.state!=='STAGING')fail('GRAPH_BUILD_SEALED','Build no longer accepts chunks');
  const bytes=Buffer.from(chunk.rows.map(f=>[s.organisation_id,s.run_id,id,bundle,f.table,f.key,canonical(f.row)].map(copyCell).join('\t')).join('\n')+'\n');
  if(typeof tx.copyFrom!=='function')fail('GRAPH_STORAGE_REQUIRED','Gateway COPY capability required');
  const result=await tx.copyFrom('COPY hyperfide.graph_fact_rows(organisation_id,run_id,graph_id,bundle_digest,family,fact_key,payload) FROM STDIN',bytes);
  if(result.rowCount!==chunk.rows.length)fail('GRAPH_COPY_INCOMPLETE','COPY count differs');
  await tx.query('INSERT INTO hyperfide.graph_ingestion_chunks(organisation_id,run_id,graph_id,bundle_digest,chunk_index,chunk_digest,row_count,byte_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[s.organisation_id,s.run_id,id,bundle,chunk.index,chunk.digest,chunk.rows.length,expected.bytes]);
  return {replayed:false,chunk_index:chunk.index,rows:chunk.rows.length,transport:'POSTGRESQL_COPY_FROM_STDIN'};
 });
}
async function seal(input:unknown,ctx:ComponentContext):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','build_id']),s=scopeInput(r,ctx),id=uuid(r.build_id);
 return graphTransaction(ctx,s,async tx=>{
  const build=await getBuild(tx,s,id,true);if(build.state!=='STAGING')return {build_id:id,state:build.state,replayed:true};
  const inputs=await tx.query<{bundle_digest:string;manifest:BundleManifest}>('SELECT bundle_digest,manifest FROM hyperfide.graph_bundle_inputs WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3',[s.organisation_id,s.run_id,id]);
  for(const b of inputs.rows){
   const result=await tx.query<{family:string;count:string}>('SELECT family,count(*)::text AS count FROM hyperfide.graph_fact_rows WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND bundle_digest=$4 GROUP BY family',[s.organisation_id,s.run_id,id,b.bundle_digest]);
   const counts=Object.fromEntries(result.rows.map(v=>[v.family,Number(v.count)]));
   for(const [family,count]of Object.entries(b.manifest.counts))if((counts[family]??0)!==count)fail('GRAPH_INCOMPLETE','Fact counts incomplete');
   const chunks=await tx.query<{n:string}>('SELECT count(*)::text AS n FROM hyperfide.graph_ingestion_chunks WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND bundle_digest=$4',[s.organisation_id,s.run_id,id,b.bundle_digest]);
   if(Number(chunks.rows[0]!.n)!==b.manifest.chunks.length||!b.manifest.complete)fail('GRAPH_INCOMPLETE','Source/chunks incomplete');
  }
  const coverage=await graphCoverage(tx,s,id);if(coverage.failed_files!==0)fail('GRAPH_INCOMPLETE','Parse coverage incomplete');
  await tx.query("UPDATE hyperfide.graph_builds SET state='RESOLVING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[s.organisation_id,s.run_id,id]);
  await tx.query('INSERT INTO hyperfide.graph_resolution_progress(organisation_id,run_id,graph_id) VALUES($1,$2,$3)',[s.organisation_id,s.run_id,id]);
  return {build_id:id,state:'RESOLVING',replayed:false,coverage};
 });
}

const PHASES=['files','symbols','refs','semantic_edges','source_bodies','COMPLETE'];
function batchLimit(value:unknown):number {if(value===undefined)return 128;if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>256)fail('GRAPH_INVALID','Resolution limit must be1..256');return Number(value);}
async function bodyPage(tx:GraphTransaction,s:GraphScope,id:string,bundle:string,cursor:string):Promise<{bundle:string;key:string}|null>{
 const p=[s.organisation_id,s.run_id,id];
 const next=(await tx.query<{bundle_digest:string;path:string}>("SELECT DISTINCT bundle_digest,payload->>'path' AS path FROM hyperfide.graph_fact_rows WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND family='source_bodies' AND (bundle_digest::text,payload->>'path')>($4,$5) ORDER BY bundle_digest,path LIMIT1".replace('LIMIT1','LIMIT 1'),[...p,bundle,cursor])).rows[0];
 if(!next)return null;
 const parts=(await tx.query<{payload:JsonObject}>("SELECT payload FROM hyperfide.graph_fact_rows WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND bundle_digest=$4 AND family='source_bodies' AND payload->>'path'=$5 ORDER BY (payload->>'part_index')::integer",[...p,next.bundle_digest,next.path])).rows;
 const bytes:Buffer[]=[];let count=0,total=0,hash='';
 for(const [index,part]of parts.entries()){
  const v=exact(part.payload,['path','content_digest','part_index','part_count','total_bytes','body_base64']);
  if(!Number.isSafeInteger(v.part_index)||!Number.isSafeInteger(v.part_count)||!Number.isSafeInteger(v.total_bytes)||Number(v.part_count)<1||Number(v.part_count)>64||Number(v.total_bytes)<0||Number(v.total_bytes)>2097152||typeof v.body_base64!=='string')fail('GRAPH_BODY_INVALID','Invalid body part');
  if(index===0){count=Number(v.part_count);total=Number(v.total_bytes);hash=sha(v.content_digest);}
  if(Number(v.part_index)!==index||Number(v.part_count)!==count||Number(v.total_bytes)!==total||sha(v.content_digest)!==hash)fail('GRAPH_BODY_INVALID','Body identity differs');
  const raw=Buffer.from(v.body_base64,'base64');if(raw.toString('base64')!==v.body_base64||raw.length>32768)fail('GRAPH_BODY_INVALID','Invalid body encoding');bytes.push(raw);
 }
 const raw=Buffer.concat(bytes);if(parts.length!==count||raw.length!==total||digest(raw)!==hash)fail('GRAPH_BODY_INVALID','Body parts incomplete');
 let body:string;try{body=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{fail('GRAPH_BODY_UNSUPPORTED','Non-UTF8 bodies retain raw facts; text index cannot claim completeness');}
 await tx.query('INSERT INTO hyperfide.graph_source_bodies(organisation_id,run_id,graph_id,bundle_digest,path,content_digest,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[...p,next.bundle_digest,next.path,hash,body]);
 return {bundle:next.bundle_digest,key:next.path};
}
async function resolve(input:unknown,ctx:ComponentContext):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','build_id'],['limit']),s=scopeInput(r,ctx),id=uuid(r.build_id),limit=batchLimit(r.limit);
 return graphTransaction(ctx,s,async tx=>{
  const build=await getBuild(tx,s,id,true);if(build.state==='READY'||build.state==='PUBLISHED')return {build_id:id,state:build.state,replayed:true};
  if(build.state!=='RESOLVING')fail('GRAPH_STATE_INVALID','Seal build before resolution');
  const p=[s.organisation_id,s.run_id,id];
  const progress=(await tx.query('SELECT * FROM hyperfide.graph_resolution_progress WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 FOR UPDATE',p)).rows[0]!;
  const phase=String(progress.phase);
  if(!PHASES.includes(phase)||phase==='COMPLETE')fail('GRAPH_STATE_INVALID','Resolution progress disagrees');
  if(phase==='source_bodies'){
   const page=await bodyPage(tx,s,id,String(progress.cursor_bundle),String(progress.cursor_key));
   if(page){await tx.query('UPDATE hyperfide.graph_resolution_progress SET cursor_bundle=$4,cursor_key=$5,rows_processed=rows_processed+1 WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3',[...p,page.bundle,page.key]);return {build_id:id,state:'RESOLVING',phase,rows:1};}
  }else{
   const family=[phase];
   const page=await tx.query<{bundle_digest:string;fact_key:string;family:string;payload:JsonObject;identity:ExtractionIdentity;artifact_id:string}>(
    'SELECT f.bundle_digest,f.fact_key,f.family,f.payload,b.identity,b.artifact_id FROM hyperfide.graph_fact_rows f JOIN hyperfide.graph_bundle_inputs b USING(organisation_id,run_id,graph_id,bundle_digest) WHERE f.organisation_id=$1 AND f.run_id=$2 AND f.graph_id=$3 AND f.family=ANY($4::text[]) AND (f.bundle_digest::text,f.family||\':\'||f.fact_key)>($5,$6) ORDER BY f.bundle_digest,f.family,f.fact_key LIMIT $7',[...p,family,progress.cursor_bundle,progress.cursor_key,limit]);
   const rows=page.rows.map(f=>({...f.payload,bundle:f.bundle_digest,family:f.family,fact_key:f.fact_key,legacy_id:String(f.payload.id??f.payload.symbol_id??f.fact_key),
    repository_id:f.identity.repository_id,source_object_id:f.identity.commit,artifact_id:f.artifact_id,
    id:sourceId(id,f.bundle_digest,phase,f.payload.id??f.payload.symbol_id??f.fact_key),
    file_id:f.payload.file_id===undefined?null:sourceId(id,f.bundle_digest,'files',f.payload.file_id),
    target_id:f.payload.target_id===null||f.payload.target_id===undefined?null:sourceId(id,f.bundle_digest,'symbols',f.payload.target_id),
    source_symbol_id:f.payload.source_id===null||f.payload.source_id===undefined?null:sourceId(id,f.bundle_digest,'symbols',f.payload.source_id),
    parse_blob_id:sourceId(id,f.bundle_digest,'parse',f.payload.id??f.fact_key),
    parser_digest:digest(canonical({parser:f.identity.parser_digest,config:f.identity.config_digest,source:f.identity.source_manifest_digest}))
   }));
   if(rows.length){
    const params=[...p,canonical(rows)];
    if(phase==='files'){
     await tx.query("INSERT INTO hyperfide.parse_blobs(organisation_id,run_id,id,content_digest,parser_digest,language,parser_version,facts_artifact_id) SELECT $1,$2,x.parse_blob_id,'sha256:'||x.hash,x.parser_digest,COALESCE(x.lang,'text'),'native-context-v1',x.artifact_id FROM jsonb_to_recordset($4::jsonb) AS x(parse_blob_id uuid,hash text,parser_digest text,lang text,artifact_id uuid) WHERE $3::uuid IS NOT NULL ON CONFLICT(organisation_id,run_id,content_digest,parser_digest,language,parser_version) DO NOTHING",params);
     await tx.query("INSERT INTO hyperfide.graph_files(organisation_id,run_id,id,graph_id,repository_id,source_object_id,path,content_digest,parse_blob_id) SELECT $1,$2,x.id,$3,x.repository_id,x.source_object_id,x.path,'sha256:'||x.hash,p.id FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,repository_id uuid,source_object_id text,path text,hash text,parser_digest text,lang text) JOIN hyperfide.parse_blobs p ON p.organisation_id=$1 AND p.run_id=$2 AND p.content_digest='sha256:'||x.hash AND p.parser_digest=x.parser_digest AND p.language=COALESCE(x.lang,'text') AND p.parser_version='native-context-v1'",params);
    }else if(phase==='symbols'){
     await tx.query("INSERT INTO hyperfide.graph_symbols(organisation_id,run_id,id,graph_id,file_id,symbol_key,name,kind,start_byte,end_byte) SELECT $1,$2,x.id,$3,x.file_id,x.id::text,x.name,COALESCE(x.kind,'unknown'),COALESCE((s.payload->>'start_byte')::bigint,0),COALESCE((s.payload->>'end_byte')::bigint,0) FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,file_id uuid,name text,kind text,bundle text,legacy_id text) LEFT JOIN hyperfide.graph_fact_rows s ON s.organisation_id=$1 AND s.run_id=$2 AND s.graph_id=$3 AND s.bundle_digest=x.bundle AND s.family='semantic_symbols' AND s.payload->>'symbol_id'=x.legacy_id",params);
    }else if(phase==='refs'){
     await tx.query("INSERT INTO hyperfide.graph_references(organisation_id,run_id,id,graph_id,file_id,reference_key,name,resolution_state,target_symbol_id,start_byte,end_byte) SELECT $1,$2,x.id,$3,x.file_id,x.id::text,x.name,CASE WHEN t.id IS NOT NULL THEN 'RESOLVED' WHEN x.verdict='ambiguous' THEN 'AMBIGUOUS' ELSE 'UNRESOLVED' END,t.id,COALESCE((sr.payload->>'start_byte')::bigint,0),COALESCE((sr.payload->>'end_byte')::bigint,0) FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,file_id uuid,name text,target_id uuid,verdict text,bundle text,legacy_id text) LEFT JOIN hyperfide.graph_symbols t ON t.organisation_id=$1 AND t.run_id=$2 AND t.graph_id=$3 AND t.id=x.target_id LEFT JOIN hyperfide.graph_fact_rows sr ON sr.organisation_id=$1 AND sr.run_id=$2 AND sr.graph_id=$3 AND sr.bundle_digest=x.bundle AND sr.family='semantic_references' AND sr.payload->>'ref_id'=x.legacy_id",params);
    }else if(phase==='semantic_edges'){
     await tx.query("INSERT INTO hyperfide.graph_edges(organisation_id,run_id,id,graph_id,source_symbol_id,target_symbol_id,kind) SELECT $1,$2,x.id,$3,s.id,t.id,x.kind FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,source_symbol_id uuid,target_id uuid,kind text) JOIN hyperfide.graph_symbols s ON s.organisation_id=$1 AND s.run_id=$2 AND s.graph_id=$3 AND s.id=x.source_symbol_id JOIN hyperfide.graph_symbols t ON t.organisation_id=$1 AND t.run_id=$2 AND t.graph_id=$3 AND t.id=x.target_id ON CONFLICT DO NOTHING",params);
    }
    const last=page.rows[page.rows.length-1]!;
    await tx.query('UPDATE hyperfide.graph_resolution_progress SET cursor_bundle=$4,cursor_key=$5,rows_processed=rows_processed+$6 WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3',[...p,last.bundle_digest,last.family+':'+last.fact_key,rows.length]);
    return {build_id:id,state:'RESOLVING',phase,rows:rows.length,query_amplification:'BOUNDED_PER_BATCH'};
   }
  }
  const next=PHASES[PHASES.indexOf(phase)+1]!;
  if(next==='COMPLETE')await tx.query("UPDATE hyperfide.graph_builds SET state='READY',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",p);
  await tx.query('UPDATE hyperfide.graph_resolution_progress SET phase=$4,cursor_bundle=$5,cursor_key=$5 WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3',[...p,next,'']);
  return {build_id:id,state:next==='COMPLETE'?'READY':'RESOLVING',phase:next,rows:0};
 });
}
export function createComponent(ctx:ComponentContext):Component{
 graphAdmission(ctx);// validate trusted admission limits at startup
 const wrap=(fn:(value:unknown,context:ComponentContext)=>Promise<unknown>)=>async(input:unknown,context:ComponentContext)=>{try{return await fn(input,context);}catch(e){if(e instanceof FoundationError)throw e;throw new FoundationError('GRAPH_STORAGE_FAILED','Graph operation failed; reconcile durable build state before retry');}};
 return {apiVersion:1,actions:{
  'graph.ingest.describe':(input,context)=>{exact(input,[]);return {schema_version:1,transport:'POSTGRESQL_COPY_FROM_STDIN',max_chunk_bytes:262144,max_resolution_batch:256,publication:false,admission:graphAdmission(context).metrics()};},
  'graph.ingest.create':wrap(createBuild),'graph.ingest.chunk':wrap(stageChunk),'graph.ingest.seal':wrap(seal),'graph.ingest.resolve':wrap(resolve),
  'graph.ingest.inspect':wrap(async(input,context)=>{const r=exact(input,['organisation_id','run_id','authority_epoch','build_id']),s=scopeInput(r,context),id=uuid(r.build_id);return graphTransaction(context,s,async tx=>({build:await getBuild(tx,s,id),coverage:await graphCoverage(tx,s,id)}),false);})
 }};
}
