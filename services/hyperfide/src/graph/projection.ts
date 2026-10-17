import type {ComponentContext} from '../components/registry.js';
import {exact,fail,text,uuid} from './extraction.js';
import type {JsonObject} from './extraction.js';
import {scopeInput} from './ingestion.js';
import {budget,packet,provenance,primaryGraphQueryExecutor,semanticInput} from './query.js';
import type {GraphQueryExecutor} from './query.js';
import {assertParityIndexes,factsDigest,readPublishedManifest,repositoryFacts,sortedFiles} from './projection_extract.js';
import type {NormalisedFile,RepositoryFacts} from './projection_extract.js';

export const MAX_PROJECTION_FILES=2000;
type Origin='BASE_REUSED'|'TARGET';
export interface Delta {invalidation:'FILE_CONTENT_AND_DEPENDENTS'|'FULL_PARSER_CONFIGURATION_CHANGE';added:string[];deleted:string[];changed:string[];dependents:string[];reused:string[];origin:Map<string,Origin>}
const sort=(values:Iterable<string>)=>[...values].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
const intersects=(a:Set<string>|undefined,b:Set<string>)=>!!a&&[...a].some(v=>b.has(v));

// Incremental invalidation: changed/added/deleted files plus unchanged dependents whose
// resolved targets or reference names touch invalidated symbols. Parser/configuration
// changes invalidate everything; no fact is reused across parser semantics.
export function computeDelta(base:RepositoryFacts,target:RepositoryFacts):Delta{
 const before=new Set(base.files.keys()),after=new Set(target.files.keys());
 const added=sort([...after].filter(p=>!before.has(p))),deleted=sort([...before].filter(p=>!after.has(p)));
 const changed=sort([...after].filter(p=>before.has(p)&&base.files.get(p)!.content!==target.files.get(p)!.content));
 const unchanged=sort([...after].filter(p=>before.has(p)&&base.files.get(p)!.content===target.files.get(p)!.content));
 const origin=new Map<string,Origin>();
 if(base.identity.parser_digest!==target.identity.parser_digest||base.identity.config_digest!==target.identity.config_digest){
  for(const p of after)origin.set(p,'TARGET');
  return {invalidation:'FULL_PARSER_CONFIGURATION_CHANGE',added,deleted,changed,dependents:unchanged,reused:[],origin};
 }
 const seeds=new Set([...added,...deleted,...changed]),names=new Set<string>();
 for(const p of [...deleted,...changed])for(const n of base.symbolNamesByPath.get(p)??[])names.add(n);
 for(const p of [...added,...changed])for(const n of target.symbolNamesByPath.get(p)??[])names.add(n);
 const dependents=unchanged.filter(p=>intersects(base.targetPathsByPath.get(p),seeds)||intersects(target.targetPathsByPath.get(p),seeds)||
  intersects(base.refNamesByPath.get(p),names)||intersects(target.refNamesByPath.get(p),names));
 const invalid=new Set([...added,...changed,...dependents]);
 for(const p of after)origin.set(p,invalid.has(p)?'TARGET':'BASE_REUSED');
 return {invalidation:'FILE_CONTENT_AND_DEPENDENTS',added,deleted,changed,dependents,reused:unchanged.filter(p=>!invalid.has(p)),origin};
}
export function compose(base:RepositoryFacts,target:RepositoryFacts,delta:Delta):NormalisedFile[]{
 return sortedFiles([...delta.origin].map(([path,origin])=>(origin==='TARGET'?target:base).files.get(path)!));
}
function summary(delta:Delta):JsonObject{
 return {invalidation:delta.invalidation,added:delta.added,deleted:delta.deleted,changed:delta.changed,dependents:delta.dependents,reused_count:delta.reused.length,
  invalidated_count:[...delta.origin.values()].filter(v=>v==='TARGET').length};
}
function pathFilter(value:unknown):Set<string>|null{
 if(value===undefined)return null;
 if(!Array.isArray(value)||!value.length||value.length>256)fail('GRAPH_INVALID','Bounded path filter required');
 const paths=value.map(v=>text(v,'file path',4096));if(new Set(paths).size!==paths.length)fail('GRAPH_INVALID','Duplicate path filter');return new Set(paths);
}
function selected(files:NormalisedFile[],paths:Set<string>|null):NormalisedFile[]{
 if(files.length>MAX_PROJECTION_FILES)fail('GRAPH_QUERY_BUDGET','Projection exceeds bounded file count');
 if(!paths)return files;
 const missing=[...paths].filter(p=>!files.some(f=>f.path===p));if(missing.length)fail('GRAPH_FILE_UNAVAILABLE','Requested projection file is absent from exact graph');
 return files.filter(f=>paths.has(f.path));
}
function source(facts:RepositoryFacts,manifest:JsonObject):JsonObject{return {manifest_id:manifest.id,manifest_digest:manifest.manifest_digest,bundle_digest:facts.bundle_digest,identity:facts.identity};}

// Full normalised facts for one repository of one exact manifest.
export async function projectionFacts(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','manifest_id','repository_id'],['paths','max_bytes','read_options']),s=scopeInput(r,ctx),manifestId=uuid(r.manifest_id),repository=uuid(r.repository_id),paths=pathFilter(r.paths),max=budget(r.max_bytes);
 return executor(ctx,s,manifestId,{kind:'projection.facts',input:semanticInput(r),max_bytes:max,read_options:r.read_options},async(session,manifest)=>{
  await assertParityIndexes(session);
  const facts=await repositoryFacts(session,s,manifest,repository),all=sortedFiles(facts.files.values());
  return packet({...provenance(manifest),repository:source(facts,manifest),files:selected(all,paths),facts_digest:factsDigest(all),file_count:all.length,complete:true,
   normalisation:'LEGACY_ROW_FACTS_WITHOUT_LOCAL_IDS_V1'},max);
 });
}
// Incremental invalidation between two exact published versions of one repository.
export async function projectionDelta(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','base_manifest_id','manifest_id','repository_id'],['max_bytes','read_options']),s=scopeInput(r,ctx),manifestId=uuid(r.manifest_id),baseId=uuid(r.base_manifest_id),repository=uuid(r.repository_id),max=budget(r.max_bytes);
 if(baseId===manifestId)fail('GRAPH_INVALID','Delta requires two distinct exact versions');
 return executor(ctx,s,manifestId,{kind:'projection.delta',input:semanticInput(r),max_bytes:max,read_options:r.read_options},async(session,manifest)=>{
  await assertParityIndexes(session);
  const baseManifest=await readPublishedManifest(session,s,baseId);
  const base=await repositoryFacts(session,s,baseManifest,repository),target=await repositoryFacts(session,s,manifest,repository),delta=computeDelta(base,target);
  const composed=compose(base,target,delta);
  return packet({...provenance(manifest),base:source(base,baseManifest),target:source(target,manifest),...summary(delta),
   incremental_facts_digest:factsDigest(composed),target_facts_digest:factsDigest(target.files.values()),complete:true},max);
 });
}
// Branch projection: an overlay version over its exact base revision; reused base facts
// are only those the overlay cannot have invalidated. Stale bases (rebases) are refused.
export async function projectionView(input:unknown,ctx:ComponentContext,executor:GraphQueryExecutor=primaryGraphQueryExecutor):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','base_manifest_id','manifest_id','repository_id'],['paths','max_bytes','read_options']),s=scopeInput(r,ctx),manifestId=uuid(r.manifest_id),baseId=uuid(r.base_manifest_id),repository=uuid(r.repository_id),paths=pathFilter(r.paths),max=budget(r.max_bytes);
 return executor(ctx,s,manifestId,{kind:'projection.view',input:semanticInput(r),max_bytes:max,read_options:r.read_options},async(session,manifest)=>{
  await assertParityIndexes(session);
  const baseManifest=await readPublishedManifest(session,s,baseId);
  const base=await repositoryFacts(session,s,baseManifest,repository),overlay=await repositoryFacts(session,s,manifest,repository);
  if(base.identity.source_kind!=='COMMIT'||base.identity.overlay_digest!==null)fail('GRAPH_PROJECTION_BASE_INVALID','Branch projection base must be a committed revision');
  if(overlay.identity.source_kind!=='OVERLAY'||overlay.identity.overlay_digest===null)fail('GRAPH_PROJECTION_OVERLAY_INVALID','Branch projection requires a named overlay version');
  if(overlay.identity.commit!==base.identity.commit)fail('GRAPH_PROJECTION_BASE_MISMATCH','Overlay was extracted against a different base revision; a rebase requires a fresh overlay extraction');
  const delta=computeDelta(base,overlay),composed=compose(base,overlay,delta);
  return packet({...provenance(manifest),base:source(base,baseManifest),overlay:source(overlay,manifest),branch:{name:overlay.identity.overlay_name,overlay_digest:overlay.identity.overlay_digest,base_commit:base.identity.commit},
   ...summary(delta),files:selected(composed,paths).map(f=>({...f,origin:delta.origin.get(f.path)})),facts_digest:factsDigest(composed),complete:true},max);
 });
}
