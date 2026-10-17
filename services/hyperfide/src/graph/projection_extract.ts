import type {QuerySession} from '../storage/transactions.js';
import {canonical,digest,fail} from './extraction.js';
import type {BundleManifest,ExtractionIdentity,JsonObject} from './extraction.js';
import type {GraphScope} from './ingestion.js';

// Indexes created by migration 0704-graph-query-parity. Queries that depend on
// them refuse with a precise diagnostic instead of silently scanning.
export const PARITY_INDEXES=Object.freeze(['graph_facts_local_id','graph_facts_route_id','graph_facts_routes','graph_facts_route_mounts','graph_facts_route_children']);
export const PARITY_MIGRATION='0704-graph-query-parity';
export async function assertParityIndexes(session:Pick<QuerySession,'query'>):Promise<void>{
 const rows=(await session.query<{name:string}>("SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hyperfide' AND c.relname=ANY($1::text[]) AND i.indisvalid AND i.indisready",[[...PARITY_INDEXES]])).rows;
 const missing=PARITY_INDEXES.filter(name=>!rows.some(row=>row.name===name));
 if(missing.length)fail('GRAPH_SCHEMA_UNAVAILABLE','Migration '+PARITY_MIGRATION+' is incomplete; missing or invalid index: '+missing.join(',')+'; re-apply the idempotent migration');
}

// Lock-free exact manifest read for read-only snapshots (replicas cannot take row locks).
// Primary admission performs the locking custody check in publication.ts.
export async function readPublishedManifest(session:Pick<QuerySession,'query'>,s:GraphScope,manifestId:string):Promise<JsonObject>{
 const m=(await session.query('SELECT m.*,b.input_digest,b.parser_digest,b.schema_digest,b.config_digest,b.state FROM hyperfide.graph_manifests m JOIN hyperfide.graph_builds b ON b.organisation_id=m.organisation_id AND b.run_id=m.run_id AND b.id=m.build_id WHERE m.organisation_id=$1 AND m.run_id=$2 AND m.id=$3 AND b.state=$4',[s.organisation_id,s.run_id,manifestId,'PUBLISHED'])).rows[0];
 if(!m)fail('GRAPH_VERSION_UNAVAILABLE','Requested immutable graph is unavailable or unpublished');
 const artifacts=await session.query<{manifest_text:string;digest:string;size_bytes:string;status:string}>('SELECT b.manifest_text,a.digest,a.size_bytes::text,a.status FROM hyperfide.graph_bundle_inputs b JOIN hyperfide.artifacts a ON a.organisation_id=b.organisation_id AND a.run_id=b.run_id AND a.id=b.artifact_id WHERE b.organisation_id=$1 AND b.run_id=$2 AND b.graph_id=$3 ORDER BY a.id',[s.organisation_id,s.run_id,m.build_id]);
 if(!artifacts.rows.length)fail('GRAPH_ARTIFACT_UNAVAILABLE','Exact graph manifest artifacts are unavailable');
 for(const row of artifacts.rows)if(row.status!=='COMPLETE'||row.digest!==digest(row.manifest_text)||row.size_bytes!==String(Buffer.byteLength(row.manifest_text)))fail('GRAPH_ARTIFACT_UNAVAILABLE','Exact graph manifest artifact is unavailable or has conflicting custody metadata');
 const sources=await session.query<{bundle_digest:string;identity:ExtractionIdentity;manifest:BundleManifest}>('SELECT bundle_digest,identity,manifest FROM hyperfide.graph_bundle_inputs WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 ORDER BY identity->>\'repository_id\'',[s.organisation_id,s.run_id,m.build_id]);
 return {...m,source_set:sources.rows.map(v=>v.identity),source_coverage:sources.rows.map(v=>({bundle_digest:v.bundle_digest,identity:v.identity,complete:v.manifest.complete,coverage:v.manifest.coverage}))};
}

export type Cell=string|null;
export interface NormalisedFile {path:string;content:Cell;lang:Cell;symbols:Cell[][];refs:Cell[][];comments:Cell[][];routes:Cell[][];edges:Cell[][]}
export interface RepositoryFacts {bundle_digest:string;identity:ExtractionIdentity;files:Map<string,NormalisedFile>;
 symbolNamesByPath:Map<string,Set<string>>;targetPathsByPath:Map<string,Set<string>>;refNamesByPath:Map<string,Set<string>>}
const FAMILIES=['files','symbols','refs','comments','routes','semantic_edges'];
export const MAX_PROJECTION_ROWS=200000;
const cell=(value:unknown):Cell=>value===null||value===undefined?null:String(value);
const ordered=(rows:Cell[][]):Cell[][]=>rows.map(row=>({row,key:Buffer.from(canonical(row))})).sort((a,b)=>Buffer.compare(a.key,b.key)).map(v=>v.row);

// One grouped read per repository bundle; never one query per file or symbol.
export async function repositoryFacts(session:Pick<QuerySession,'query'>,s:GraphScope,manifest:JsonObject,repositoryId:string):Promise<RepositoryFacts>{
 const source=(manifest.source_coverage as {bundle_digest:string;identity:ExtractionIdentity}[]).find(v=>v.identity.repository_id===repositoryId);
 if(!source)fail('GRAPH_SOURCE_SET_MISMATCH','Repository is absent from the exact graph source set');
 const rows=(await session.query<{family:string;payload:JsonObject}>('SELECT family,payload FROM hyperfide.graph_fact_rows WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND bundle_digest=$4 AND family=ANY($5::text[]) ORDER BY family,fact_key LIMIT $6',
  [s.organisation_id,s.run_id,manifest.build_id,source.bundle_digest,FAMILIES,MAX_PROJECTION_ROWS+1])).rows;
 if(rows.length>MAX_PROJECTION_ROWS)fail('GRAPH_QUERY_BUDGET','Repository projection exceeds bounded fact budget');
 const by=(family:string)=>rows.filter(r=>r.family===family).map(r=>r.payload);
 const paths=new Map<string,string>(),symbols=new Map<string,{name:Cell;path:Cell}>();
 const files=new Map<string,NormalisedFile>();
 for(const f of by('files')){const path=String(f.path);paths.set(String(f.id),path);files.set(path,{path,content:cell(f.hash),lang:cell(f.lang),symbols:[],refs:[],comments:[],routes:[],edges:[]});}
 const fileOf=(id:unknown)=>{const path=paths.get(String(id));if(path===undefined)fail('GRAPH_FACT_INCONSISTENT','Fact refers to a file absent from its bundle');return files.get(path)!;};
 for(const v of by('symbols'))symbols.set(String(v.id),{name:cell(v.name),path:paths.get(String(v.file_id))??null});
 const symbolName=(id:unknown)=>id===null||id===undefined?null:symbols.get(String(id))?.name??null;
 const symbolPath=(id:unknown)=>id===null||id===undefined?null:symbols.get(String(id))?.path??null;
 const symbolNamesByPath=new Map<string,Set<string>>(),targetPathsByPath=new Map<string,Set<string>>(),refNamesByPath=new Map<string,Set<string>>();
 const add=(map:Map<string,Set<string>>,key:string,value:Cell)=>{if(value===null)return;let set=map.get(key);if(!set)map.set(key,set=new Set());set.add(value);};
 for(const v of by('symbols')){const f=fileOf(v.file_id);f.symbols.push([cell(v.name),cell(v.kind),cell(v.line),cell(v.end_line),cell(v.sig)]);add(symbolNamesByPath,f.path,cell(v.name));}
 for(const v of by('refs')){const f=fileOf(v.file_id);f.refs.push([cell(v.name),cell(v.line),cell(v.kind),cell(v.qual),cell(v.verdict),symbolName(v.sym_id),symbolPath(v.target_id),symbolName(v.target_id)]);add(refNamesByPath,f.path,cell(v.name));const t=symbolPath(v.target_id);if(t!==null&&t!==f.path)add(targetPathsByPath,f.path,t);}
 for(const v of by('comments')){const f=fileOf(v.file_id);f.comments.push([cell(v.line),cell(v.end_line),cell(v.kind),cell(v.body),symbolName(v.sym_id)]);}
 for(const v of by('routes')){const f=fileOf(v.file_id);f.routes.push([cell(v.framework),cell(v.method),cell(v.pattern),cell(v.handler),cell(v.line)]);}
 for(const v of by('semantic_edges')){
  if(v.source_file_id===null||v.source_file_id===undefined)continue;
  const f=fileOf(v.source_file_id),target=v.target_file_id===null||v.target_file_id===undefined?null:paths.get(String(v.target_file_id))??null;
  f.edges.push([cell(v.kind),symbolName(v.source_id),target,symbolName(v.target_id),cell(v.original_text),cell(v.start_line)]);
  if(target!==null&&target!==f.path)add(targetPathsByPath,f.path,target);
 }
 for(const f of files.values()){f.symbols=ordered(f.symbols);f.refs=ordered(f.refs);f.comments=ordered(f.comments);f.routes=ordered(f.routes);f.edges=ordered(f.edges);}
 return {bundle_digest:source.bundle_digest,identity:source.identity,files,symbolNamesByPath,targetPathsByPath,refNamesByPath};
}
export function sortedFiles(files:Iterable<NormalisedFile>):NormalisedFile[]{return [...files].sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));}
export function factsDigest(files:Iterable<NormalisedFile>):string{return digest(canonical(sortedFiles(files)));}
