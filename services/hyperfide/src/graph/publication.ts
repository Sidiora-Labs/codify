import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {InvocationContext} from '../transport/protocol.js';
import {invocationOf} from '../identity/enrollment.js';
import {FoundationError} from '../policy/programme.js';
import {canonical,digest,exact,fail,text,uuid,decimal,sha} from './extraction.js';
import {getBuild,graphCoverage,graphTransaction,graphGuard,scopeInput,semanticProjectionDebt,assertGraphArtifacts} from './ingestion.js';
import type {GraphScope,GraphTransaction} from './ingestion.js';
import type {BundleManifest,ExtractionIdentity,JsonObject} from './extraction.js';

export async function publishedGraph(tx:GraphTransaction,s:GraphScope,manifestId:string):Promise<JsonObject>{
 const r=await tx.query('SELECT m.*,b.input_digest,b.parser_digest,b.schema_digest,b.config_digest,b.state FROM hyperfide.graph_manifests m JOIN hyperfide.graph_builds b ON b.organisation_id=m.organisation_id AND b.run_id=m.run_id AND b.id=m.build_id WHERE m.organisation_id=$1 AND m.run_id=$2 AND m.id=$3 AND b.state=$4',[s.organisation_id,s.run_id,manifestId,'PUBLISHED']);
 const m=r.rows[0];if(!m)fail('GRAPH_VERSION_UNAVAILABLE','Requested immutable graph is unavailable or unpublished');
 await assertGraphArtifacts(tx,s,String(m.build_id));
 const sources=await tx.query<{bundle_digest:string;identity:ExtractionIdentity;manifest:BundleManifest}>('SELECT bundle_digest,identity,manifest FROM hyperfide.graph_bundle_inputs WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 ORDER BY identity->>\'repository_id\'',[s.organisation_id,s.run_id,m.build_id]);
 return {...m,source_set:sources.rows.map(v=>v.identity),source_coverage:sources.rows.map(v=>({bundle_digest:v.bundle_digest,identity:v.identity,complete:v.manifest.complete,coverage:v.manifest.coverage}))};
}
export async function loadGraphSnapshot(tx:GraphTransaction,s:GraphScope,manifestId:string,expected:unknown):Promise<JsonObject>{
 assertPrimaryTransaction(tx);
 if(!Array.isArray(expected)||!expected.length||expected.length>64)fail('GRAPH_INVALID','Exact expected repository/source set required');
 const pins=expected.map(value=>{const p=exact(value,['repository_id','source_object_id'],['overlay_digest']);const source=text(p.source_object_id,'source commit',64);if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source))fail('GRAPH_INVALID','Full source commit required');return {repository_id:uuid(p.repository_id),source_object_id:source,overlay_digest:p.overlay_digest===undefined||p.overlay_digest===null?null:sha(p.overlay_digest)};});
 if(new Set(pins.map(p=>p.repository_id)).size!==pins.length)fail('GRAPH_INVALID','Duplicate expected repository');
 const manifest=await publishedGraph(tx,s,uuid(manifestId)),sources=manifest.source_set as ExtractionIdentity[];
 if(pins.length!==sources.length||pins.some(p=>!sources.some(v=>v.repository_id===p.repository_id&&v.commit===p.source_object_id&&v.overlay_digest===p.overlay_digest)))fail('GRAPH_SOURCE_SET_MISMATCH','Published graph differs from exact expected source set');
 const coverage=await tx.query('SELECT repository_id,source_object_id,count(*)::text AS file_count FROM hyperfide.graph_files WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 GROUP BY repository_id,source_object_id ORDER BY repository_id,source_object_id',[s.organisation_id,s.run_id,manifest.build_id]);
 const debt=await semanticProjectionDebt(tx,s,String(manifest.build_id));
 const unresolved=(await tx.query<{n:string}>("SELECT count(*)::text AS n FROM hyperfide.graph_references WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND resolution_state<>'RESOLVED'",[s.organisation_id,s.run_id,manifest.build_id])).rows[0]!.n;
 return {...manifest,file_coverage:coverage.rows,expected_sources_validated:true,unknown_semantic_edges:debt.rows,unprojected_semantic_edge_count:debt.count,semantic_projection_complete:debt.count==='0',unresolved_reference_count:unresolved};
}
// Unpublishable staging is reported as explicit debt beside the channel's retained generation.
export async function stagingDebt(tx:GraphTransaction,s:GraphScope,id:string,channel:string):Promise<JsonObject>{
 const p=[s.organisation_id,s.run_id,id],build=await getBuild(tx,s,id),coverage=await graphCoverage(tx,s,id);
 const sources=await tx.query<{bundle_digest:string;manifest:BundleManifest}>('SELECT bundle_digest,manifest FROM hyperfide.graph_bundle_inputs WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 ORDER BY bundle_digest',p);
 const progress=(await tx.query<{phase:string}>('SELECT phase FROM hyperfide.graph_resolution_progress WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3',p)).rows[0];
 const unresolved=(await tx.query<{n:string}>("SELECT count(*)::text AS n FROM hyperfide.graph_references WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND resolution_state<>'RESOLVED'",p)).rows[0]!.n;
 const semantic=await semanticProjectionDebt(tx,s,id),current=(await tx.query('SELECT manifest_id,publication_generation::text AS publication_generation FROM hyperfide.graph_channels WHERE organisation_id=$1 AND run_id=$2 AND name=$3',[s.organisation_id,s.run_id,channel])).rows[0];
 const incomplete=sources.rows.filter(v=>!v.manifest.complete).map(v=>({bundle_digest:v.bundle_digest,coverage:v.manifest.coverage}));
 const phase=progress?.phase??null,failed=Number(coverage.failed_files);
 return {build_id:id,state:build.state,resolution_phase:phase,coverage,failed_files:failed,incomplete_sources:incomplete,unresolved_reference_count:unresolved,unprojected_semantic_edge_count:semantic.count,
  publishable:(build.state==='READY'||build.state==='PUBLISHED')&&phase==='COMPLETE'&&failed===0&&sources.rows.length>0&&!incomplete.length,
  channel,published_manifest_id:current?.manifest_id??null,published_generation:String(current?.publication_generation??'0')};
}
async function publish(input:unknown,ctx:ComponentContext):Promise<unknown>{
 const r=exact(input,['organisation_id','run_id','authority_epoch','operation_id','build_id','channel','expected_generation']),s=scopeInput(r,ctx),
 id=uuid(r.build_id),operation=uuid(r.operation_id),channel=text(r.channel,'graph channel',128),expected=decimal(r.expected_generation,true),requestDigest=digest(canonical(r));
 if(!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(channel))fail('GRAPH_INVALID','Invalid channel');
 if(!['COORDINATOR','LEADER','OPERATOR'].includes(invocationOf(ctx).principal.role))fail('GRAPH_ROLE_DENIED','Graph publication requires coordinator authority');
 return graphTransaction(ctx,s,async tx=>{
  const p=[s.organisation_id,s.run_id,id];
  const prior=(await tx.query<{receipt:JsonObject}>('SELECT receipt FROM hyperfide.graph_publication_receipts WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[s.organisation_id,s.run_id,operation])).rows[0];
  if(prior){if(prior.receipt.request_digest!==requestDigest)fail('GRAPH_OPERATION_CONFLICT','Publication operation reused with different input');await assertGraphArtifacts(tx,s,String(prior.receipt.build_id));return {...prior.receipt,replayed:true};}
  const build=await getBuild(tx,s,id,true);
  const current=(await tx.query('SELECT * FROM hyperfide.graph_channels WHERE organisation_id=$1 AND run_id=$2 AND name=$3 FOR UPDATE',[s.organisation_id,s.run_id,channel])).rows[0];
  if(String(current?.publication_generation??'0')!==expected)fail('GRAPH_GENERATION_CONFLICT','Graph channel changed; recompute publication intent');
  if(build.state!=='READY'&&build.state!=='PUBLISHED')fail('GRAPH_INCOMPLETE','Graph build is not ready');
  const progress=(await tx.query('SELECT phase FROM hyperfide.graph_resolution_progress WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3',p)).rows[0];
  if(progress?.phase!=='COMPLETE')fail('GRAPH_INCOMPLETE','Resolution has not completed');
  await assertGraphArtifacts(tx,s,id);
  const sourceRows=await tx.query<{bundle_digest:string;manifest:BundleManifest;identity:ExtractionIdentity}>('SELECT bundle_digest,manifest,identity FROM hyperfide.graph_bundle_inputs WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 ORDER BY identity->>\'repository_id\'',p);
  const coverage=await graphCoverage(tx,s,id);if(!sourceRows.rows.length||coverage.failed_files!==0||sourceRows.rows.some(v=>!v.manifest.complete))fail('GRAPH_INCOMPLETE','Source/parse coverage incomplete');
  // A delayed extraction cannot displace a newer generation on this channel.
  if(current){
   const old=await tx.query<{identity:ExtractionIdentity;bundle_digest:string}>('SELECT b.identity,b.bundle_digest FROM hyperfide.graph_bundle_inputs b JOIN hyperfide.graph_manifests m ON m.organisation_id=b.organisation_id AND m.run_id=b.run_id AND m.build_id=b.graph_id WHERE m.organisation_id=$1 AND m.run_id=$2 AND m.id=$3',[s.organisation_id,s.run_id,current.manifest_id]);
   for(const v of sourceRows.rows){const previous=old.rows.find(o=>o.identity.repository_id===v.identity.repository_id);if(!previous)continue;const before=BigInt(previous.identity.generation),after=BigInt(v.identity.generation);if(before>after)fail('GRAPH_GENERATION_STALE','Older extraction cannot replace newer published source');if(before===after&&(canonical(previous.identity)!==canonical(v.identity)||previous.bundle_digest!==v.bundle_digest))fail('GRAPH_GENERATION_CONFLICT','One channel extraction generation cannot identify different source or parser facts');}
  }
  const counts=(await tx.query<{files:string;symbols:string;reference_count:string;edges:string;unresolved:string}>(
   "SELECT (SELECT count(*)::text FROM hyperfide.graph_files WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3) AS files,(SELECT count(*)::text FROM hyperfide.graph_symbols WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3) AS symbols,(SELECT count(*)::text FROM hyperfide.graph_references WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3) AS reference_count,(SELECT count(*)::text FROM hyperfide.graph_edges WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3) AS edges,(SELECT count(*)::text FROM hyperfide.graph_references WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND resolution_state<>'RESOLVED') AS unresolved",p)).rows[0]!;
  const expectedCounts=sourceRows.rows.reduce((v,b)=>({files:v.files+b.manifest.counts.files!,symbols:v.symbols+b.manifest.counts.symbols!,refs:v.refs+b.manifest.counts.refs!}),{files:0,symbols:0,refs:0});
  if(Number(counts.files)!==expectedCounts.files||Number(counts.symbols)!==expectedCounts.symbols||Number(counts.reference_count)!==expectedCounts.refs)fail('GRAPH_INCOMPLETE','Core graph projection counts differ from admitted source facts');
  const manifestBody={schema_version:1,build_id:id,input_digest:build.input_digest,source_manifest_digest:build.source_manifest_digest,
   source_set:sourceRows.rows.map(v=>v.identity),bundles:sourceRows.rows.map(v=>v.bundle_digest),counts,coverage,resolution:'NATIVE_REVISION_SCOPED_TARGETS_WITH_EXPLICIT_UNRESOLVED'};
  const manifestDigest=digest(canonical(manifestBody));
  let stored=(await tx.query('SELECT id,manifest_digest FROM hyperfide.graph_manifests WHERE organisation_id=$1 AND run_id=$2 AND build_id=$3',p)).rows[0];
  if(stored&&stored.manifest_digest!==manifestDigest)fail('GRAPH_MANIFEST_CONFLICT','Existing publication manifest differs');
  if(!stored){stored={id:randomUUID(),manifest_digest:manifestDigest};await tx.query('INSERT INTO hyperfide.graph_manifests(organisation_id,run_id,id,build_id,manifest_digest,source_manifest_digest,file_count,symbol_count,reference_count,edge_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[s.organisation_id,s.run_id,stored.id,id,manifestDigest,build.source_manifest_digest,counts.files,counts.symbols,counts.reference_count,counts.edges]);}
  const generation=(BigInt(expected)+1n).toString();
  if(current)await tx.query('UPDATE hyperfide.graph_channels SET manifest_id=$4,publication_generation=$5,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND name=$3',[s.organisation_id,s.run_id,channel,stored.id,generation]);
  else await tx.query('INSERT INTO hyperfide.graph_channels(organisation_id,run_id,name,manifest_id,publication_generation) VALUES($1,$2,$3,$4,$5)',[s.organisation_id,s.run_id,channel,stored.id,generation]);
  if(build.state!=='PUBLISHED')await tx.query("UPDATE hyperfide.graph_builds SET state='PUBLISHED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",p);
  const receipt={operation_id:operation,build_id:id,channel,manifest_id:stored.id,manifest_digest:manifestDigest,source_manifest_digest:build.source_manifest_digest,
   publication_generation:generation,request_digest:requestDigest,replayed:false,complete:true,unresolved_count:counts.unresolved};
  await tx.query('INSERT INTO hyperfide.graph_publication_receipts(organisation_id,run_id,operation_id,graph_id,channel,expected_generation,manifest_id,manifest_digest,publication_generation,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[s.organisation_id,s.run_id,operation,id,channel,expected,stored.id,manifestDigest,generation,canonical(receipt)]);
  return receipt;
 });
}
export function createComponent(ctx:ComponentContext):Component{
 return {apiVersion:1,capabilities:{'graph.snapshot.v1':Object.freeze({
 loadGraphSnapshot:async(tx:GraphTransaction,input:unknown,invocation:InvocationContext)=>{
  const context=Object.freeze({...ctx,invocation});invocationOf(context);assertPrimaryTransaction(tx);
  const r=exact(input,['organisation_id','run_id','authority_epoch','manifest_id','expected_sources']),s=scopeInput(r,context);
  await graphGuard(tx,s,context,false);
  return loadGraphSnapshot(tx,s,uuid(r.manifest_id),r.expected_sources);
 }
 })},actions:{
  'graph.publish.describe':input=>{exact(input,[]);return {schema_version:1,atomic_manifest_and_channel:true,publication_requires:'COMPLETE_SOURCE_AND_RESOLUTION',unknown_references:'PRESERVED'};},
  'graph.publish.commit':async(input,context)=>{try{return await publish(input,context);}catch(e){if(e instanceof FoundationError)throw e;throw new FoundationError('GRAPH_PUBLICATION_UNKNOWN','Publication response uncertain; replay the same operation identity to reconcile');}},
  'graph.publish.snapshot':async(input,context)=>{const r=exact(input,['organisation_id','run_id','authority_epoch','manifest_id','expected_sources']),s=scopeInput(r,context);return graphTransaction(context,s,tx=>loadGraphSnapshot(tx,s,uuid(r.manifest_id),r.expected_sources),false);},
  'graph.publish.debt':async(input,context)=>{const r=exact(input,['organisation_id','run_id','authority_epoch','build_id','channel']),s=scopeInput(r,context),channel=text(r.channel,'graph channel',128);return graphTransaction(context,s,tx=>stagingDebt(tx,s,uuid(r.build_id),channel),false);},
  'graph.publish.inspect':async(input,context)=>{const r=exact(input,['organisation_id','run_id','authority_epoch','manifest_id']),s=scopeInput(r,context);return graphTransaction(context,s,tx=>publishedGraph(tx,s,uuid(r.manifest_id)),false);}
 }};
}
