import type {ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import type {InvocationContext} from '../transport/protocol.js';
import {isArtifactStoreCapability} from '../artifacts/objects.js';
import {archiveRoot,canonical,fileHash,hash,inventory,logicalBatch,open,profiles,regular} from './sqlite.js';
import type {LogicalRow} from './sqlite.js';

type Json=Record<string,unknown>;
/** Parity only ever reads; any gateway session or transaction satisfies this. */
export interface ParityReader {query(sql:string,values?:unknown[]):Promise<{rows:Record<string,any>[]}>}
interface Table {name:string;rows:string|null;disposition:string}
interface Scope {organisation_id:string;run_id:string}
export interface ParityReport {
 schema_version:1;import_id:string;snapshot_digest:string;history_digest:string;
 counts:{table:string;source:string|null;archive:string|null;history:string}[];
 samples:{table:string;offset:string;mapped_id:string;payload_digest:string;history:boolean;live:boolean}[];
 source:Json;git:Json;artifacts:Json;mismatches:string[];outcome:'MATCHED'|'MISMATCHED';
 writable:false;authority:'NONE';shadow_digest:string;
}
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
/** Deterministic offsets: first, last and one digest-derived interior row per table. */
function offsets(snapshot:string,table:string,rows:bigint):bigint[]{
 if(rows<1n)return [];
 const seed=BigInt('0x'+hash(snapshot+'\n'+table).slice(7,23));
 return [...new Set([0n,rows-1n,seed%rows].map(String))].map(v=>BigInt(v)).sort((a,b)=>a<b?-1:a>b?1:0);
}
function sample(db:ReturnType<typeof open>,table:string,offset:bigint,source:string,repository:string):LogicalRow|null{
 return logicalBatch(db,table,offset.toString(),1,source,repository).rows[0]??null;
}
/** Run-scoped digest over every imported history row; a later mutation must observe the same value. */
export async function historyDigest(tx:ParityReader,importId:string):Promise<string>{
 const r=await tx.query("SELECT count(*)::text AS n,COALESCE(string_agg(mapped_id::text||':'||table_name||':'||payload_digest||':'||disposition,',' ORDER BY mapped_id),'') AS rows FROM hyperfide_history.rows WHERE import_id=$1",[importId]);
 return hash(String(r.rows[0]?.n)+'\n'+String(r.rows[0]?.rows));
}
/** Count, semantic-sample, live-source, Git and artifact reconciliation for one
 * historical import. Every statement here is a read; callers that only shadow the
 * result run it in a READ ONLY transaction so no write path exists at all. */
export async function compareParity(tx:ParityReader,ctx:ComponentContext,i:InvocationContext,scope:Scope,importId:string):Promise<ParityReport>{
 const found=await tx.query('SELECT h.id,h.source_id,h.repository_id,h.snapshot_digest,h.inventory,h.external_inventory,r.integration_ref,r.source_object_id,s.object_id AS observed_object FROM hyperfide_history.imports h JOIN hyperfide.run_repositories r ON r.organisation_id=h.organisation_id AND r.repository_id=h.repository_id LEFT JOIN hyperfide.source_objects s ON s.organisation_id=r.organisation_id AND s.repository_id=r.repository_id AND s.object_id=r.source_object_id WHERE h.id=$1 AND h.organisation_id=$2 AND r.run_id=$3',[importId,scope.organisation_id,scope.run_id]);
 const row=found.rows[0];if(!row)fail('CUTOVER_SOURCE','Import is not part of the authenticated run');
 const snapshot=String(row.snapshot_digest),stored=row.inventory as Json,tables=(stored.tables as Table[]).filter(t=>t.disposition!=='ARCHIVE_ONLY'),mismatches:string[]=[];
 const filename=await regular(await archiveRoot(ctx.env),snapshot.slice(7)+'.db');
 if(await fileHash(filename)!==snapshot)fail('CUTOVER_ARCHIVE_CORRUPT','Immutable snapshot archive digest differs from the import');
 const profile=(await profiles(ctx.env)).find(p=>p.source_id===row.source_id&&p.repository_id===row.repository_id&&p.organisation_id===scope.organisation_id);
 if(!profile)fail('CUTOVER_SOURCE_UNAVAILABLE','The quiesced legacy source for this import is not configured');
 const history=await tx.query('SELECT table_name,count(*)::text AS n FROM hyperfide_history.rows WHERE import_id=$1 GROUP BY table_name',[importId]);
 const imported=new Map(history.rows.map(r=>[String(r.table_name),String(r.n)]));
 const archive=open(filename),live=open(await regular(profile.root,profile.database));
 const counts:ParityReport['counts']=[],samples:ParityReport['samples']=[],probes:{table:string;offset:bigint;row:LogicalRow;live:boolean}[]=[];
 let liveTables:Table[]=[];
 try{
  const archived=new Map((inventory(archive).tables as Table[]).map(t=>[t.name,t.rows]));
  liveTables=(inventory(live).tables as Table[]).filter(t=>t.disposition!=='ARCHIVE_ONLY');
  for(const table of tables){
   const h=imported.get(table.name)??'0';imported.delete(table.name);
   counts.push({table:table.name,source:table.rows,archive:archived.get(table.name)??null,history:h});
   if(table.rows===null||archived.get(table.name)!==table.rows||h!==table.rows)mismatches.push('COUNT:'+table.name);
   const current=liveTables.find(t=>t.name===table.name);
   if(!current||current.rows!==table.rows)mismatches.push('SOURCE_COUNT:'+table.name);
   if(table.rows===null)continue;
   for(const offset of offsets(snapshot,table.name,BigInt(table.rows))){
    const expected=sample(archive,table.name,offset,String(row.source_id),String(row.repository_id));
    if(!expected){mismatches.push('SAMPLE_MISSING:'+table.name);continue;}
    const observed=current?.rows===table.rows?sample(live,table.name,offset,String(row.source_id),String(row.repository_id)):null;
    probes.push({table:table.name,offset,row:expected,live:observed?.mapped===expected.mapped&&observed.digest===expected.digest});
   }
  }
  for(const t of liveTables)if(!tables.some(x=>x.name===t.name))mismatches.push('SOURCE_TABLE_ADDED:'+t.name);
 }finally{archive.close();live.close();}
 for(const extra of imported.keys())mismatches.push('HISTORY_TABLE_UNEXPECTED:'+extra);
 const ids=probes.map(p=>p.row.mapped);
 const rows=ids.length?(await tx.query('SELECT mapped_id::text AS mapped_id,table_name,legacy_key,payload_digest,disposition FROM hyperfide_history.rows WHERE import_id=$1 AND mapped_id=ANY($2::uuid[])',[importId,ids])).rows:[];
 const byId=new Map(rows.map(r=>[String(r.mapped_id),r]));
 for(const p of probes){
  const h=byId.get(p.row.mapped);
  const matched=!!h&&h.table_name===p.table&&h.payload_digest===p.row.digest&&h.disposition===p.row.disposition&&canonical(h.legacy_key)===canonical(p.row.key);
  if(!matched)mismatches.push('SAMPLE:'+p.table+':'+p.offset.toString());
  if(!p.live)mismatches.push('SOURCE_SAMPLE:'+p.table+':'+p.offset.toString());
  samples.push({table:p.table,offset:p.offset.toString(),mapped_id:p.row.mapped,payload_digest:p.row.digest,history:matched,live:p.live});
 }
 // Git: the run's integration source object must be the observed repository object.
 const git={repository_id:row.repository_id,integration_ref:row.integration_ref,source_object_id:row.source_object_id,observed:row.observed_object===row.source_object_id,
  legacy_git_tables:tables.filter(t=>t.name.startsWith('git_')).map(t=>({table:t.name,rows:t.rows}))};
 if(!git.observed)mismatches.push('GIT_SOURCE_OBJECT');
 // Artifacts: the verified archive receipt must read back through the actual 15.2 store.
 const archives=object(stored.archives)?stored.archives:{},evidence=archives[scope.run_id];
 let artifacts:Json={archive:'MISSING'};
 if(object(evidence)&&evidence.availability==='VERIFIED'&&evidence.content_digest===snapshot&&typeof evidence.manifest_artifact_id==='string'){
  const store=ctx.dependencies.require('15.2','artifact.store.v1',isArtifactStoreCapability);
  const observed=await store.invoke('artifact.manifest.read',{organisation_id:scope.organisation_id,run_id:scope.run_id,artifact_id:evidence.manifest_artifact_id},i);
  const verified=object(observed)&&observed.outcome==='SUCCEEDED'&&observed.availability==='VERIFIED'&&observed.content_digest===snapshot;
  artifacts={archive:verified?'VERIFIED':'UNVERIFIED',manifest_artifact_id:evidence.manifest_artifact_id,content_digest:snapshot};
 }
 if(artifacts.archive!=='VERIFIED')mismatches.push('ARTIFACT_ARCHIVE');
 const external=(row.external_inventory as Json[]).map(e=>({label:e.label,kind:e.kind,availability:e.availability,digest:e.digest??null}));
 artifacts.external=external;
 // Unavailable declared inputs are recorded as explicit exclusions, never silently dropped.
 artifacts.explicit_exclusions=external.filter(e=>e.availability!=='OBSERVED').map(e=>e.label);
 const source={profile:profile.id,source_id:row.source_id,legacy_tables:liveTables.length,counts_match:!mismatches.some(m=>m.startsWith('SOURCE_COUNT')||m.startsWith('SOURCE_TABLE')),samples_match:!mismatches.some(m=>m.startsWith('SOURCE_SAMPLE'))};
 const body={schema_version:1 as const,import_id:importId,snapshot_digest:snapshot,history_digest:await historyDigest(tx,importId),counts,samples,source,git,artifacts,mismatches,
  outcome:mismatches.length?'MISMATCHED' as const:'MATCHED' as const,writable:false as const,authority:'NONE' as const};
 return {...body,shadow_digest:hash(canonical(body))};
}
/** Read-only shadow comparison in the gateway's primary REPEATABLE READ READ ONLY
 * transaction: PostgreSQL refuses any write, so shadowing cannot create a second
 * writable authority. */
export async function shadowCompare(ctx:ComponentContext,i:InvocationContext,scope:Scope,importId:string):Promise<ParityReport>{
 return (await ctx.resources.observe({preferReplica:false,signal:i.signal},async session=>{
  const r=await session.query<{ro:string}>("SELECT current_setting('transaction_read_only') AS ro");
  if(r.rows[0]?.ro!=='on')fail('CUTOVER_SHADOW_WRITABLE','Shadow comparison must run without a write path');
  return compareParity(session,ctx,i,scope,importId);
 })).value;
}
