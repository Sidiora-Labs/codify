import {Buffer} from 'node:buffer';
import type {Component,ComponentContext} from '../components/registry.js';
import {invocationOf} from '../identity/enrollment.js';
import type {InvocationContext} from '../transport/protocol.js';
import {FoundationError} from '../policy/programme.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {QuerySession} from '../storage/transactions.js';
import {canonical,digest,exact,fail,text,uuid} from './extraction.js';
import {graphTransaction,scopeInput,semanticProjectionDebt} from './ingestion.js';
import type {GraphScope} from './ingestion.js';
import {publishedGraph} from './publication.js';
import type {JsonObject} from './extraction.js';
import {contracts} from './contract_query.js';
import {projectionDelta,projectionFacts,projectionView} from './projection.js';
import {cacheCapacity,GraphQueryCache,routedGraphQueryExecutor} from './replica_query.js';

export interface GraphQueryDescriptor {kind:string;input:JsonObject;max_bytes:number;read_options?:unknown}
export type GraphQueryExecutor=<T extends JsonObject>(ctx:ComponentContext,scope:GraphScope,manifestId:string,query:GraphQueryDescriptor,operation:(session:QuerySession,manifest:JsonObject)=>Promise<T>)=>Promise<T>;
export const primaryGraphQueryExecutor:GraphQueryExecutor=async(ctx,scope,manifestId,_query,operation)=>graphTransaction(ctx,scope,async tx=>{
 assertPrimaryTransaction(tx);return operation(tx,await publishedGraph(tx,scope,manifestId));
},false);
export function semanticInput(input:JsonObject):JsonObject{const {read_options,...semantic}=input;void read_options;return semantic;}

export function bounded(value:unknown,base:number,min:number,max:number):number{if(value===undefined)return base;if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)fail('GRAPH_INVALID','Invalid query budget');return Number(value);}
function ids(value:unknown,max=128):string[]{if(!Array.isArray(value)||value.length>max)fail('GRAPH_INVALID','Bounded ID array required');const all=value.map(uuid);if(new Set(all).size!==all.length)fail('GRAPH_INVALID','Duplicate query IDs');return all;}
// Routed executors annotate the manifest with the route that actually served the read.
export function provenance(manifest:JsonObject):JsonObject{const routed=manifest.query_route;return {manifest_id:manifest.id,manifest_digest:manifest.manifest_digest,source_manifest_digest:manifest.source_manifest_digest,source_set:manifest.source_set,source_coverage:manifest.source_coverage,provenance:routed&&typeof routed==='object'?routed:{route:'PRIMARY',exact_version:true,cache:'NONE',snapshot:'SERIALIZABLE_PRIMARY'}};}
export function budget(value:unknown):number{return bounded(value,262144,4096,786432);}
export function packet<T extends JsonObject>(value:T,max:number):T {if(Buffer.byteLength(JSON.stringify(value))>max)fail('GRAPH_PACKET_TOO_LARGE','Exact graph packet exceeds requested byte budget');return value;}
export function decodeCursor(value:unknown,queryDigest:string):number{
 const raw=text(value,'cursor',1024);let c:JsonObject;
 try{const bytes=Buffer.from(raw,'base64url');if(bytes.toString('base64url')!==raw)throw new Error();c=exact(JSON.parse(bytes.toString('utf8')),['query_digest','offset']);}catch{fail('GRAPH_CURSOR_INVALID','Invalid pinned search cursor');}
 if(c.query_digest!==queryDigest||!Number.isSafeInteger(c.offset)||Number(c.offset)<0||Number(c.offset)>1000000)fail('GRAPH_CURSOR_INVALID','Cursor belongs to different immutable query');
 return Number(c.offset);
}
export function encodeCursor(queryDigest:string,offset:number):string{return Buffer.from(canonical({query_digest:queryDigest,offset})).toString('base64url');}
// Legacy SQLite FTS5 query operators have no equivalent in plainto_tsquery; refusing them
// is the approved difference, rather than silently matching operators as literal words.
function legacySyntax(q:string):void{
 const operators=q.split(/\s+/).filter(token=>['AND','OR','NOT','NEAR'].includes(token)||/^NEAR\(/.test(token));
 const symbols=[...new Set(q.match(/["*^(){}:]/g)??[])];
 if(operators.length||symbols.length)fail('GRAPH_QUERY_UNSUPPORTED','Legacy FTS5 query syntax is unsupported: '+[...new Set(operators),...symbols].join(' ')+'; use plain words or a trigram mode');
}
function legacyWords(q:string):string[]{
 const words=[...new Set(q.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(word=>word.toLowerCase()))];
 if(!words.length||words.length>16)fail('GRAPH_INVALID','Full-text query requires one to sixteen words');
 return words;
}
async function status(input:unknown,ctx:ComponentContext):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch'],['manifest_id','channel']),s=scopeInput(r,ctx);
 if((r.manifest_id===undefined)===(r.channel===undefined))fail('GRAPH_INVALID','Name exactly one manifest or channel');
 return graphTransaction(ctx,s,async tx=>{
  let manifestId:string;let channel:JsonObject|null=null;
  if(r.manifest_id!==undefined)manifestId=uuid(r.manifest_id);else{
   const row=(await tx.query('SELECT manifest_id,publication_generation,state_version FROM hyperfide.graph_channels WHERE organisation_id=$1 AND run_id=$2 AND name=$3',[s.organisation_id,s.run_id,text(r.channel,'channel',128)])).rows[0];
   if(!row)fail('GRAPH_VERSION_UNAVAILABLE','Graph channel has no published manifest');manifestId=String(row.manifest_id);channel=row;
  }
  const manifest=await publishedGraph(tx,s,manifestId);
  return {...provenance(manifest),published_at:manifest.published_at,build_id:manifest.build_id,channel,availability:'AVAILABLE',complete:true};
 },false);
}
export async function search(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','manifest_id','mode','q'],['limit','cursor','max_bytes','read_options']),s=scopeInput(r,ctx),manifestId=uuid(r.manifest_id),
 q=text(r.q,'search query',256),limit=bounded(r.limit,50,1,200),max=budget(r.max_bytes),mode=r.mode;
 if(!['symbol','body','comment','trigram','body-trigram'].includes(String(mode)))fail('GRAPH_INVALID','Unsupported search mode');
 if(mode!=='trigram'&&mode!=='body-trigram')legacySyntax(q);
 const queryDigest=digest(canonical({manifest_id:manifestId,mode,q,limit,max_bytes:max})),offset=r.cursor===undefined?0:decodeCursor(r.cursor,queryDigest);
 return executor(ctx,s,manifestId,{kind:'search',input:semanticInput(r),max_bytes:max,read_options:r.read_options},async(tx,manifest)=>{
  const p=[s.organisation_id,s.run_id,manifest.build_id,q,limit+1,offset];
  let sql:string;
  // Substring modes fold ASCII case only, like legacy `cg grep -i`, independent of database locale;
  // ILIKE stays as the trigram-index prefilter because it never folds less than that.
  const unicodeCased=[...q].some(c=>c.charCodeAt(0)>127&&c.toLowerCase()!==c.toUpperCase());
  if(mode!=='trigram'&&mode!=='body-trigram'&&unicodeCased){
   const locale=(await tx.query<{provider:string;ctype:string}>('SELECT datlocprovider::text AS provider,datctype AS ctype FROM pg_database WHERE datname=current_database()')).rows[0]!;
   if(locale.provider==='c'&&['C','POSIX'].includes(locale.ctype))fail('GRAPH_QUERY_UNSUPPORTED','Unicode case folding for full-text search requires a Unicode-aware database ctype (ctype='+locale.ctype+'); use body-trigram or trigram mode');
  }
  // Legacy unicode61 splits words at every non-alphanumeric character (including '.', '_' and '-');
  // the PostgreSQL parser keeps tokens such as JSON.parse whole. Each query word must therefore
  // match either a lexeme or a delimited token, and an ILIKE prefilter keeps the trigram index usable.
  const words=mode==='body'||mode==='comment'?legacyWords(q):[],wordStart=p.length+1;
  if(words.length)p.push(words,...words.map(word=>'%'+word+'%'));
  const wordMatch=(vector:string,body:string,indexedBody:string)=>" AND NOT EXISTS(SELECT 1 FROM unnest($"+wordStart+"::text[]) AS w(word) WHERE NOT ("+vector+"@@plainto_tsquery('simple',w.word) OR "+body+" ~* ('(^|[^[:alnum:]])'||w.word||'([^[:alnum:]]|$)')))"+
   words.map((_word,index)=>" AND "+indexedBody+" ILIKE $"+(wordStart+1+index)).join('');
  if(mode==='body')sql="SELECT b.bundle_digest,b.path,b.content_digest,left(b.body,512) AS snippet,ts_rank_cd(b.search_vector,plainto_tsquery('simple',$4))::text AS score FROM hyperfide.graph_source_bodies b WHERE b.organisation_id=$1 AND b.run_id=$2 AND b.graph_id=$3"+wordMatch('b.search_vector','b.body','b.body')+" ORDER BY ts_rank_cd(b.search_vector,plainto_tsquery('simple',$4)) DESC,b.bundle_digest,b.path LIMIT $5 OFFSET $6";
  else if(mode==='body-trigram')sql="SELECT b.bundle_digest,b.path,b.content_digest,left(b.body,512) AS snippet,'1'::text AS score FROM hyperfide.graph_source_bodies b WHERE b.organisation_id=$1 AND b.run_id=$2 AND b.graph_id=$3 AND position(lower($4::text COLLATE \"C\") IN lower(b.body COLLATE \"C\"))>0 AND b.body ILIKE $7 ORDER BY b.bundle_digest,b.path LIMIT $5 OFFSET $6";
  else if(mode==='trigram')sql="SELECT f.bundle_digest,f.family,f.fact_key,f.payload,'1'::text AS score FROM hyperfide.graph_fact_rows f WHERE f.organisation_id=$1 AND f.run_id=$2 AND f.graph_id=$3 AND f.family IN ('symbols','comments') AND position(lower($4::text COLLATE \"C\") IN lower(COALESCE(f.payload->>'name',f.payload->>'body','') COLLATE \"C\"))>0 AND COALESCE(f.payload->>'name',f.payload->>'body','') ILIKE $7 ORDER BY f.family,f.bundle_digest,f.fact_key LIMIT $5 OFFSET $6";
  else{
   const family=mode==='symbol'?'symbols':'comments',expression=mode==='symbol'?"COALESCE(f.payload->>'name','')||' '||COALESCE(f.payload->>'sig','')":"COALESCE(f.payload->>'body','')";
   const match=mode==='symbol'?" AND to_tsvector('simple',"+expression+")@@plainto_tsquery('simple',$4)":wordMatch("to_tsvector('simple',"+expression+")",expression,"COALESCE(f.payload->>'name',f.payload->>'body','')");
   sql="SELECT f.bundle_digest,f.family,f.fact_key,f.payload,ts_rank_cd(to_tsvector('simple',"+expression+"),plainto_tsquery('simple',$4))::text AS score FROM hyperfide.graph_fact_rows f WHERE f.organisation_id=$1 AND f.run_id=$2 AND f.graph_id=$3 AND f.family='"+family+"'"+match+" ORDER BY ts_rank_cd(to_tsvector('simple',"+expression+"),plainto_tsquery('simple',$4)) DESC,f.bundle_digest,f.fact_key LIMIT $5 OFFSET $6";
  }
  if(mode==='body-trigram'||mode==='trigram')p.push('%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%');
  const all=(await tx.query(sql,p)).rows;const truncated=all.length>limit,rows=all.slice(0,limit);
  const result={...provenance(manifest),mode,ranking:(mode==='trigram'||mode==='body-trigram')?'STABLE_IDENTITY':'POSTGRES_SIMPLE_TS_RANK_CD_WITH_STABLE_TIES',
   rows,complete:!truncated,truncated,next_cursor:truncated?encodeCursor(queryDigest,offset+rows.length):null,
   limitations:['Task component ranking is explicit; full legacy FTS/ranking parity requires its independently approved corpus']};
  return packet(result,max);
 });
}
export async function context(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','manifest_id','symbol_ids','files'],['max_bytes','read_options']),s=scopeInput(r,ctx),manifestId=uuid(r.manifest_id),symbols=ids(r.symbol_ids),max=budget(r.max_bytes);
 if(!Array.isArray(r.files)||r.files.length>128)fail('GRAPH_INVALID','Bounded repository/file set required');
 const files=r.files.map(value=>{const v=exact(value,['repository_id','path']);return {repository_id:uuid(v.repository_id),path:text(v.path,'file path',4096)};});
 return executor(ctx,s,manifestId,{kind:'context',input:semanticInput(r),max_bytes:max,read_options:r.read_options},async(tx,m)=>{
  const p=[s.organisation_id,s.run_id,m.build_id,symbols,canonical(files)];
  const requested=(await tx.query('SELECT id FROM hyperfide.graph_symbols WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND id=ANY($4::uuid[])',p.slice(0,4))).rows;
  if(requested.length!==symbols.length)fail('GRAPH_SYMBOL_UNAVAILABLE','Requested context symbol is absent from exact graph');
  const selected=(await tx.query("SELECT DISTINCT f.* FROM hyperfide.graph_files f LEFT JOIN hyperfide.graph_symbols sy ON sy.organisation_id=f.organisation_id AND sy.run_id=f.run_id AND sy.graph_id=f.graph_id AND sy.file_id=f.id WHERE f.organisation_id=$1 AND f.run_id=$2 AND f.graph_id=$3 AND (sy.id=ANY($4::uuid[]) OR EXISTS(SELECT 1 FROM jsonb_to_recordset($5::jsonb) x(repository_id uuid,path text) WHERE x.repository_id=f.repository_id AND x.path=f.path)) ORDER BY f.repository_id,f.path LIMIT 257",p)).rows;
  if(selected.length>256)fail('GRAPH_QUERY_BUDGET','Selected file set exceeds packet budget');
  if(files.some(w=>!selected.some(f=>f.repository_id===w.repository_id&&f.path===w.path)))fail('GRAPH_FILE_UNAVAILABLE','Requested context file is absent from exact graph');
  const fileIds=selected.map(v=>v.id);
  const nodes=(await tx.query('SELECT * FROM hyperfide.graph_symbols WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND file_id=ANY($4::uuid[]) ORDER BY file_id,start_byte,id LIMIT 1001',[...p.slice(0,3),fileIds])).rows;
  const references=(await tx.query('SELECT * FROM hyperfide.graph_references WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND file_id=ANY($4::uuid[]) ORDER BY file_id,start_byte,id LIMIT 1001',[...p.slice(0,3),fileIds])).rows;
  const raw=(await tx.query("SELECT f.bundle_digest,f.family,f.fact_key,f.payload FROM hyperfide.graph_fact_rows f JOIN hyperfide.graph_bundle_inputs b USING(organisation_id,run_id,graph_id,bundle_digest) WHERE f.organisation_id=$1 AND f.run_id=$2 AND f.graph_id=$3 AND f.family IN ('imports','routes','comments','semantic_bindings','semantic_type_facts','extraction_health') AND EXISTS(SELECT 1 FROM hyperfide.graph_fact_rows lf JOIN hyperfide.graph_files gf ON gf.organisation_id=lf.organisation_id AND gf.run_id=lf.run_id AND gf.graph_id=lf.graph_id AND gf.repository_id=(b.identity->>'repository_id')::uuid AND gf.path=lf.payload->>'path' WHERE lf.organisation_id=f.organisation_id AND lf.run_id=f.run_id AND lf.graph_id=f.graph_id AND lf.bundle_digest=f.bundle_digest AND lf.family='files' AND gf.id=ANY($4::uuid[]) AND (f.payload->>'file_id'=lf.payload->>'id' OR f.payload->>'path'=lf.payload->>'path')) ORDER BY f.family,f.bundle_digest,f.fact_key LIMIT 1001",[...p.slice(0,3),fileIds])).rows;
  const semantic=await semanticProjectionDebt(tx,s,String(m.build_id));
  const truncated=nodes.length>1000||references.length>1000||raw.length>1000||BigInt(semantic.count)>256n,unknown=references.filter(v=>v.resolution_state!=='RESOLVED');
  return packet({...provenance(m),files:selected,nodes:nodes.slice(0,1000),references:references.slice(0,1000),source_facts:raw.slice(0,1000),unknown_references:unknown.slice(0,256),
   unknown_semantic_edges:semantic.rows,unprojected_semantic_edge_count:semantic.count,complete:!truncated&&unknown.length===0&&semantic.count==='0',truncated,unknown_edges:unknown.length>0||semantic.count!=='0',query_amplification:'BOUNDED_GROUPED_QUERIES'},max);
 });
}
export async function traverse(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','manifest_id','symbol_ids','direction','depth','max_nodes'],['max_bytes','read_options']),s=scopeInput(r,ctx),manifestId=uuid(r.manifest_id),
 seeds=ids(r.symbol_ids),depth=bounded(r.depth,1,0,4),maxNodes=bounded(r.max_nodes,100,1,500),max=budget(r.max_bytes),direction=r.direction;
 if(!['callers','callees','both'].includes(String(direction))||seeds.length>maxNodes)fail('GRAPH_INVALID','Invalid traversal');
 return executor(ctx,s,manifestId,{kind:'traverse',input:semanticInput(r),max_bytes:max,read_options:r.read_options},async(tx,m)=>{
  const p=[s.organisation_id,s.run_id,m.build_id];
  const selected=(await tx.query('SELECT s.*,f.repository_id,f.path FROM hyperfide.graph_symbols s JOIN hyperfide.graph_files f ON f.organisation_id=s.organisation_id AND f.run_id=s.run_id AND f.graph_id=s.graph_id AND f.id=s.file_id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.graph_id=$3 AND s.id=ANY($4::uuid[])',[...p,seeds])).rows;
  if(selected.length!==seeds.length)fail('GRAPH_SYMBOL_UNAVAILABLE','Traversal seed is absent from exact graph');
  const seen=new Set(seeds),edges=new Map<string,JsonObject>();let frontier=seeds,truncated=false;
  for(let level=0;level<depth&&frontier.length;level++){
   const condition=direction==='callers'?'target_symbol_id=ANY($4::uuid[])':direction==='callees'?'source_symbol_id=ANY($4::uuid[])':'(source_symbol_id=ANY($4::uuid[]) OR target_symbol_id=ANY($4::uuid[]))';
   const batch=(await tx.query('SELECT * FROM hyperfide.graph_edges WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND '+condition+' ORDER BY id LIMIT $5',[...p,frontier,maxNodes*4+1])).rows;
   if(batch.length>maxNodes*4)truncated=true;const next=new Set<string>();
   for(const edge of batch.slice(0,maxNodes*4)){edges.set(String(edge.id),edge);const endpoints=direction==='callers'?[edge.source_symbol_id]:direction==='callees'?[edge.target_symbol_id]:[edge.source_symbol_id,edge.target_symbol_id];for(const node of endpoints){const key=String(node);if(!seen.has(key)){if(seen.size>=maxNodes){truncated=true;continue;}seen.add(key);next.add(key);}}}
   frontier=[...next];
  }
  const nodes=(await tx.query('SELECT s.*,f.repository_id,f.path FROM hyperfide.graph_symbols s JOIN hyperfide.graph_files f ON f.organisation_id=s.organisation_id AND f.run_id=s.run_id AND f.graph_id=s.graph_id AND f.id=s.file_id WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.graph_id=$3 AND s.id=ANY($4::uuid[]) ORDER BY f.repository_id,f.path,s.start_byte,s.id',[...p,[...seen]])).rows;
  const count=(await tx.query<{n:string}>("SELECT count(*)::text AS n FROM hyperfide.graph_references WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND resolution_state<>'RESOLVED'",p)).rows[0]!.n;
  const unknown=(await tx.query("SELECT * FROM hyperfide.graph_references WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND resolution_state<>'RESOLVED' ORDER BY id LIMIT 256",p)).rows;
  const semantic=await semanticProjectionDebt(tx,s,String(m.build_id));
  return packet({...provenance(m),nodes,edges:[...edges.values()].filter(e=>seen.has(String(e.source_symbol_id))&&seen.has(String(e.target_symbol_id))),
   unknown_references:unknown,unresolved_count:count,unknown_semantic_edges:semantic.rows,unprojected_semantic_edge_count:semantic.count,complete:!truncated&&count==='0'&&semantic.count==='0',truncated:truncated||BigInt(count)>256n||BigInt(semantic.count)>256n,
   limitations:['Unresolved and cross-repository bindings remain explicit unknowns','Depth limits bound observed reachability; they do not prove system coherence']},max);
 });
}
export function createComponent(ctx:ComponentContext):Component {
 const wrap=(fn:(input:unknown,context:ComponentContext)=>Promise<unknown>)=>async(input:unknown,context:ComponentContext)=>{try{return await fn(input,context);}catch(e){if(e instanceof FoundationError)throw e;throw new FoundationError('GRAPH_QUERY_FAILED','Exact graph query could not complete within its storage budget');}};
 const bound=(invocation:InvocationContext):ComponentContext=>{const context=Object.freeze({...ctx,invocation});invocationOf(context);return context;};
 // Requests without read_options keep the exact primary path; read_options select a routed read.
 const cache=new GraphQueryCache(cacheCapacity(ctx.env)),executor=routedGraphQueryExecutor(primaryGraphQueryExecutor,cache);
 const routed=(fn:(input:unknown,context:ComponentContext,executor:GraphQueryExecutor)=>Promise<unknown>)=>(input:unknown,context:ComponentContext)=>fn(input,context,executor);
 return {apiVersion:1,capabilities:{'graph.query.v1':Object.freeze({
 traverse:(input:unknown,invocation:InvocationContext)=>traverse(input,bound(invocation),executor),
 context:(input:unknown,invocation:InvocationContext)=>context(input,bound(invocation),executor),
 search:(input:unknown,invocation:InvocationContext)=>search(input,bound(invocation),executor),
 status:(input:unknown,invocation:InvocationContext)=>status(input,bound(invocation)),
 contracts:(input:unknown,invocation:InvocationContext)=>contracts(input,bound(invocation),executor),
 projectionView:(input:unknown,invocation:InvocationContext)=>projectionView(input,bound(invocation),executor)
 })},actions:{
  'graph.query.describe':input=>{exact(input,[]);return {schema_version:1,exact_manifest_required:true,max_depth:4,max_nodes:500,route:'PRIMARY',
   routes:{default:'PRIMARY',replica:'PRIMARY_ADMISSION_WAL_BARRIER_THEN_REPEATABLE_READ_STANDBY',fallback:'DECLARED_PRIMARY_ONLY',offline:'REFUSED'},
   replica_qualification:'TASK_COMPONENT_ONLY',cache_authority:'NONE',cache:cache.describe(),performance_claim:'NONE'};},
  'graph.query.status':wrap(status),'graph.query.search':wrap(routed(search)),'graph.query.context':wrap(routed(context)),'graph.query.traverse':wrap(routed(traverse)),
  'graph.query.contracts':wrap(routed(contracts)),'graph.query.projection.facts':wrap(routed(projectionFacts)),
  'graph.query.projection.delta':wrap(routed(projectionDelta)),'graph.query.projection.view':wrap(routed(projectionView))
 }};
}
