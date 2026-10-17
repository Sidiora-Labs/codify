import type {ComponentContext} from '../components/registry.js';
import {canonical,digest,exact,fail,text,uuid} from './extraction.js';
import type {ExtractionIdentity,JsonObject} from './extraction.js';
import {scopeInput} from './ingestion.js';
import {bounded,budget,decodeCursor,encodeCursor,packet,provenance,primaryGraphQueryExecutor,semanticInput} from './query.js';
import type {GraphQueryExecutor} from './query.js';
import {assertParityIndexes} from './projection_extract.js';

// Contract queries over published route and annotation facts. Each row keeps the exact
// repository/source binding of the bundle that produced it.
const ROUTES="SELECT r.bundle_digest,r.fact_key,r.payload->>'framework' AS framework,r.payload->>'method' AS method,r.payload->>'pattern' AS pattern,r.payload->>'handler' AS handler,r.payload->>'line' AS line,"+
 "f.payload->>'path' AS path,rf.payload->>'status' AS status,hs.payload->>'name' AS handler_symbol,hf.payload->>'path' AS handler_path,"+
 "(SELECT count(*) FROM hyperfide.graph_fact_rows c WHERE c.organisation_id=r.organisation_id AND c.run_id=r.run_id AND c.graph_id=r.graph_id AND c.bundle_digest=r.bundle_digest AND c.family='semantic_route_compositions' AND c.payload->>'mount_route_id'=r.payload->>'id')::text AS mounted_children,"+
 "(SELECT count(*) FROM hyperfide.graph_fact_rows c WHERE c.organisation_id=r.organisation_id AND c.run_id=r.run_id AND c.graph_id=r.graph_id AND c.bundle_digest=r.bundle_digest AND c.family='semantic_route_compositions' AND c.payload->>'child_route_id'=r.payload->>'id')::text AS mounted_parents "+
 "FROM hyperfide.graph_fact_rows r "+
 "JOIN hyperfide.graph_fact_rows f ON f.organisation_id=r.organisation_id AND f.run_id=r.run_id AND f.graph_id=r.graph_id AND f.bundle_digest=r.bundle_digest AND f.family='files' AND f.payload->>'id'=r.payload->>'file_id' "+
 "LEFT JOIN hyperfide.graph_fact_rows rf ON rf.organisation_id=r.organisation_id AND rf.run_id=r.run_id AND rf.graph_id=r.graph_id AND rf.bundle_digest=r.bundle_digest AND rf.family='semantic_route_facts' AND rf.payload->>'route_id'=r.payload->>'id' "+
 "LEFT JOIN hyperfide.graph_fact_rows hs ON hs.organisation_id=r.organisation_id AND hs.run_id=r.run_id AND hs.graph_id=r.graph_id AND hs.bundle_digest=r.bundle_digest AND hs.family='symbols' AND hs.payload->>'id'=rf.payload->>'handler_symbol_id' "+
 "LEFT JOIN hyperfide.graph_fact_rows hf ON hf.organisation_id=r.organisation_id AND hf.run_id=r.run_id AND hf.graph_id=r.graph_id AND hf.bundle_digest=r.bundle_digest AND hf.family='files' AND hf.payload->>'id'=rf.payload->>'handler_file_id' "+
 "WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.graph_id=$3 AND r.family='routes' AND ($4::text IS NULL OR r.payload->>'method'=$4) AND ($5::text IS NULL OR r.payload->>'framework'=$5) AND ($6::text IS NULL OR starts_with(r.payload->>'pattern',$6)) "+
 "ORDER BY r.payload->>'method',r.payload->>'pattern',f.payload->>'path',(r.payload->>'line')::bigint,r.bundle_digest,r.fact_key LIMIT $7 OFFSET $8";
const ANNOTATIONS="SELECT c.bundle_digest,c.fact_key,c.payload->>'body' AS body,c.payload->>'kind' AS kind,c.payload->>'line' AS line,f.payload->>'path' AS path,s.payload->>'name' AS symbol,s.payload->>'kind' AS symbol_kind "+
 "FROM hyperfide.graph_fact_rows c "+
 "JOIN hyperfide.graph_fact_rows f ON f.organisation_id=c.organisation_id AND f.run_id=c.run_id AND f.graph_id=c.graph_id AND f.bundle_digest=c.bundle_digest AND f.family='files' AND f.payload->>'id'=c.payload->>'file_id' "+
 "LEFT JOIN hyperfide.graph_fact_rows s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.graph_id=c.graph_id AND s.bundle_digest=c.bundle_digest AND s.family='symbols' AND s.payload->>'id'=c.payload->>'sym_id' "+
 "WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.graph_id=$3 AND c.family='comments' AND COALESCE(c.payload->>'name',c.payload->>'body','') LIKE '%@contract%' AND ($4::text IS NULL OR s.payload->>'name'=$4) "+
 "ORDER BY f.payload->>'path',(c.payload->>'line')::bigint,c.bundle_digest,c.fact_key LIMIT $5 OFFSET $6";
function optional(value:unknown,kind:string,limit=256):string|null{return value===undefined?null:text(value,kind,limit);}
export async function contracts(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','manifest_id','kind'],['method','framework','pattern_prefix','symbol','limit','cursor','max_bytes','read_options']),s=scopeInput(r,ctx),manifestId=uuid(r.manifest_id),
 limit=bounded(r.limit,100,1,500),max=budget(r.max_bytes),kind=r.kind;
 if(kind!=='routes'&&kind!=='annotations')fail('GRAPH_INVALID','Unsupported contract query kind');
 if(kind==='routes'&&r.symbol!==undefined||kind==='annotations'&&(r.method!==undefined||r.framework!==undefined||r.pattern_prefix!==undefined))fail('GRAPH_INVALID','Filter does not apply to contract query kind');
 const method=optional(r.method,'route method',16),framework=optional(r.framework,'route framework',64),prefix=optional(r.pattern_prefix,'route pattern prefix',1024),symbol=optional(r.symbol,'contract symbol',256);
 const queryDigest=digest(canonical({manifest_id:manifestId,contracts:kind,method,framework,prefix,symbol,limit,max_bytes:max}));
 const offset=r.cursor===undefined?0:decodeCursor(r.cursor,queryDigest);
 return executor(ctx,s,manifestId,{kind:'contracts',input:semanticInput(r),max_bytes:max,read_options:r.read_options},async(session,manifest)=>{
  await assertParityIndexes(session);
  const p=[s.organisation_id,s.run_id,manifest.build_id];
  const all=(kind==='routes'?await session.query<JsonObject>(ROUTES,[...p,method,framework,prefix,limit+1,offset]):await session.query<JsonObject>(ANNOTATIONS,[...p,symbol,limit+1,offset])).rows;
  const sources=new Map((manifest.source_coverage as {bundle_digest:string;identity:ExtractionIdentity}[]).map(v=>[v.bundle_digest,v.identity]));
  const truncated=all.length>limit,rows=all.slice(0,limit).map(row=>{const identity=sources.get(String(row.bundle_digest));if(!identity)fail('GRAPH_FACT_INCONSISTENT','Contract fact lacks exact source binding');
   return {...row,repository_id:identity.repository_id,source_object_id:identity.commit,overlay_digest:identity.overlay_digest};});
  return packet({...provenance(manifest),kind,rows,complete:!truncated,truncated,next_cursor:truncated?encodeCursor(queryDigest,offset+rows.length):null,
   ordering:kind==='routes'?'METHOD_PATTERN_PATH_LINE_THEN_FACT_IDENTITY':'PATH_LINE_THEN_FACT_IDENTITY',
   limitations:['Route facts are those recognised by the native scanner; unrecognised frameworks remain absent, not inferred']},max);
 });
}
