import type {Component,ComponentContext} from '../components/registry.js';
import {authorizeReview,canonical,digest,fail,hash,obj,oid,primary,reviewError,scope,strings,text,transaction,uuid,decimal,reviewInputCurrent,lockReviewDisposition} from './coverage.js';
import type {ReviewDb,ReviewScope} from './coverage.js';

export const CONTRACT_FACETS=['schema','signatures','errors','authentication','state','units','precision','ordering','idempotency','compatibility','operational_invariants'] as const;
// Facets whose change alters runtime behaviour while every symbol and signature may stay identical.
export const BEHAVIOURAL_FACETS=CONTRACT_FACETS.filter(name=>name!=='schema'&&name!=='signatures');
interface Endpoint {repository_id:string;source_object_id:string;symbol_ids:string[]}
type ConsumerOrigin='BASELINE'|'CANDIDATE'|'GRAPH';
interface AffectedConsumer extends Endpoint {origins:ConsumerOrigin[]}
interface ContractDefinition {
 producer:Endpoint;consumers:Endpoint[];facets:Record<string,{status:'DEFINED'|'UNKNOWN';definition:unknown}>;
 scenario_templates:Array<{template_id:string;assertion_ids:string[]}>;
}
function endpoint(value:unknown):Endpoint{
 const v=obj(value,['repository_id','source_object_id','symbol_ids']);
 return {repository_id:uuid(v.repository_id),source_object_id:oid(v.source_object_id),symbol_ids:strings(v.symbol_ids,500).map(uuid)};
}
function definition(value:unknown):ContractDefinition{
 const v=obj(value,['producer','consumers','facets','scenario_templates']);
 if(!Array.isArray(v.consumers)||v.consumers.length>1000)fail('CONTRACT_INVALID','Contract consumers exceed their bound');
 const consumers=v.consumers.map(endpoint),facets=obj(v.facets,[...CONTRACT_FACETS]);
 const result:ContractDefinition['facets']={};
 for(const name of CONTRACT_FACETS){
  const entry=obj(facets[name],['status','definition']);
  if(entry.status!=='DEFINED'&&entry.status!=='UNKNOWN')fail('CONTRACT_INVALID','Facet status must explicitly identify unknown semantics');
  if(canonical(entry.definition).length>65536)fail('CONTRACT_INVALID','Contract facet exceeds its bound');
  result[name]={status:entry.status,definition:entry.definition};
 }
 if(!Array.isArray(v.scenario_templates)||v.scenario_templates.length>128)fail('CONTRACT_INVALID','Scenario template list is invalid');
 const scenarios=v.scenario_templates.map(value=>{
  const item=obj(value,['template_id','assertion_ids']),template=text(item.template_id,128);
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(template))fail('CONTRACT_INVALID','Invalid reproduction template identity');
  const ids=strings(item.assertion_ids,128);if(!ids.length)fail('CONTRACT_INVALID','Scenario must identify its actual assertions');
  return {template_id:template,assertion_ids:ids};
 });
 if(new Set(scenarios.map(item=>item.template_id)).size!==scenarios.length)fail('CONTRACT_INVALID','Duplicate scenario template');
 return {producer:endpoint(v.producer),consumers,facets:result,scenario_templates:scenarios};
}
export async function publishContract(context:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','owner_package_id','contract_key','revision','definition']);
 const binding=scope(v);authorizeReview(context,binding,['OPERATOR','LEADER','COORDINATOR','FEATURE_MANAGER']);
 const contractKey=text(v.contract_key,255),revision=decimal(v.revision),owner=uuid(v.owner_package_id),body=definition(v.definition);
 const identity=hash({schema_version:1,contract_key:contractKey,revision,definition:body});
 return transaction(context,binding,async db=>{
  for(const point of [body.producer,...body.consumers]){
   const found=await db.query<{object_type:string}>(`SELECT source.object_type FROM hyperfide.run_repositories membership
    JOIN hyperfide.source_objects source ON source.organisation_id=membership.organisation_id AND source.repository_id=membership.repository_id
    WHERE membership.organisation_id=$1 AND membership.run_id=$2 AND membership.repository_id=$3 AND source.object_id=$4`,
    [binding.organisation_id,binding.run_id,point.repository_id,point.source_object_id]);
   if(found.rows.length!==1||found.rows[0]!.object_type!=='commit')fail('CONTRACT_SOURCE_INVALID','Every producer and consumer must name a scoped immutable source commit');
  }
  const previous=await db.query<{id:string;criteria_digest:string;revision:string}>('SELECT id,criteria_digest,revision FROM hyperfide.contracts WHERE organisation_id=$1 AND run_id=$2 AND contract_key=$3 ORDER BY revision DESC LIMIT 1',
   [binding.organisation_id,binding.run_id,contractKey]);
  if(previous.rows[0]?.revision===revision){
   if(previous.rows[0].criteria_digest!==identity)fail('CONTRACT_REVISION_CONFLICT','Contract revision already has another definition');
   return {contract_id:previous.rows[0].id,criteria_digest:identity,replayed:true};
  }
  if(previous.rows[0]&&BigInt(revision)<=BigInt(previous.rows[0].revision))fail('CONTRACT_REVISION_CONFLICT','Contract revision must increase');
  const inserted=await db.query<{id:string}>('INSERT INTO hyperfide.contracts(organisation_id,run_id,owner_package_id,contract_key,revision,criteria_digest,definition) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
   [binding.organisation_id,binding.run_id,owner,contractKey,revision,identity,body]);
  return {contract_id:inserted.rows[0]!.id,criteria_digest:identity,replayed:false};
 });
}
interface GraphCapability {traverse(input:unknown,invocation:unknown):Promise<unknown>;status(input:unknown,invocation:unknown):Promise<unknown>}
function graphCapability(value:unknown):value is GraphCapability{
 return !!value&&typeof value==='object'&&typeof(value as GraphCapability).traverse==='function'&&typeof(value as GraphCapability).status==='function';
}
export async function analyseContractImpact(context:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','contract_key','baseline_revision','candidate_revision','graph_manifest_id'],['graph_manifest_id']);
 const binding=scope(v),key=text(v.contract_key,255),baseline=decimal(v.baseline_revision),candidate=decimal(v.candidate_revision);
 const data=await transaction(context,binding,async db=>{
  const result=await db.query<{id:string;revision:string;criteria_digest:string;definition:ContractDefinition}>('SELECT id,revision,criteria_digest,definition FROM hyperfide.contracts WHERE organisation_id=$1 AND run_id=$2 AND contract_key=$3 AND revision=ANY($4::bigint[])',
   [binding.organisation_id,binding.run_id,key,[baseline,candidate]]);
  const before=result.rows.find(row=>row.revision===baseline),after=result.rows.find(row=>row.revision===candidate);
  if(!before||!after)fail('CONTRACT_REVISION_MISSING','Both exact contract revisions must exist');
  const run=await db.query<{authority_epoch:string}>('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[binding.organisation_id,binding.run_id]);
  return {before,after,authority_epoch:run.rows[0]!.authority_epoch};
 },false);
 const changed=CONTRACT_FACETS.filter(name=>canonical(data.before.definition.facets[name])!==canonical(data.after.definition.facets[name]));
 const unknown=CONTRACT_FACETS.filter(name=>data.after.definition.facets[name]?.status!=='DEFINED');
 const sourceChanged=canonical(data.before.definition.producer)!==canonical(data.after.definition.producer);
 const consumers=new Map<string,AffectedConsumer>();
 const declare=(consumer:Endpoint,origin:ConsumerOrigin)=>{
  const key=consumer.repository_id+':'+consumer.source_object_id,previous=consumers.get(key);
  consumers.set(key,{repository_id:consumer.repository_id,source_object_id:consumer.source_object_id,
   symbol_ids:[...new Set([...(previous?.symbol_ids??[]),...consumer.symbol_ids])],origins:[...new Set([...(previous?.origins??[]),origin])]});
 };
 for(const consumer of data.before.definition.consumers)declare(consumer,'BASELINE');
 for(const consumer of data.after.definition.consumers)declare(consumer,'CANDIDATE');
 const limitations:string[]=[];let graph:unknown=null,graphComplete=false;
 if(v.graph_manifest_id){
  const manifestId=uuid(v.graph_manifest_id);
  let capability:GraphCapability|null=null;
  try{
   const dependencies=(context as unknown as {dependencies?:{require:(id:string,key:string,guard:(value:unknown)=>boolean)=>unknown}}).dependencies;
   if(!dependencies)fail('CONTRACT_GRAPH_UNAVAILABLE','Graph capability is unavailable');
   const resolved=dependencies.require('7.4','graph.query.v1',graphCapability);
   if(!graphCapability(resolved))fail('CONTRACT_GRAPH_UNAVAILABLE','Graph capability is incompatible');
   capability=resolved;
  }catch(error){limitations.push('GRAPH_CAPABILITY_UNAVAILABLE');graph={error_code:reviewError(error).code};}
  if(capability)try{
   const response=await capability.traverse({...binding,authority_epoch:data.authority_epoch,manifest_id:manifestId,
    symbol_ids:data.after.definition.producer.symbol_ids,direction:'callers',depth:4,max_nodes:500},context.invocation);
   if(!response||typeof response!=='object')fail('CONTRACT_GRAPH_UNAVAILABLE','Graph traversal did not return provenance');
   const facts=response as Record<string,unknown>;
   if(facts.manifest_id!==manifestId||!Array.isArray(facts.nodes)||!Array.isArray(facts.unknown_references))
    fail('CONTRACT_GRAPH_UNAVAILABLE','Graph traversal does not identify the requested snapshot');
   graph=response;graphComplete=facts.complete===true&&facts.truncated===false&&facts.unknown_references.length===0;
   const sourceSet=Array.isArray(facts.source_set)?facts.source_set as Array<Record<string,unknown>>:[];
   const producerCovered=sourceSet.some(source=>source.repository_id===data.after.definition.producer.repository_id&&source.commit===data.after.definition.producer.source_object_id&&source.source_kind==='COMMIT'&&source.overlay_digest===null);
   if(!producerCovered){graphComplete=false;limitations.push('GRAPH_PRODUCER_SOURCE_UNBOUND');}
   for(const node of facts.nodes as Array<Record<string,unknown>>){
    const pins=sourceSet.filter(source=>source.repository_id===node.repository_id&&source.source_kind==='COMMIT'&&source.overlay_digest===null&&typeof source.commit==='string');
    if(pins.length!==1){graphComplete=false;limitations.push('GRAPH_CONSUMER_SOURCE_UNBOUND');continue;}
    const repository=uuid(node.repository_id),commit=oid(pins[0]!.commit),key=repository+':'+commit;
    const symbol=uuid(node.id);
    if(repository===data.after.definition.producer.repository_id&&commit===data.after.definition.producer.source_object_id&&data.after.definition.producer.symbol_ids.includes(symbol))continue;
    declare({repository_id:repository,source_object_id:commit,symbol_ids:[symbol]},'GRAPH');
   }
   if(!graphComplete)limitations.push('GRAPH_CONSUMERS_INCOMPLETE');
  }catch(error){limitations.push('GRAPH_SNAPSHOT_UNAVAILABLE');graph={error_code:reviewError(error).code};}
 }else limitations.push('GRAPH_SNAPSHOT_REQUIRED');
 if(unknown.length)limitations.push('UNKNOWN_BEHAVIOURAL_FACETS');
 const scenarios=data.after.definition.scenario_templates;
 if(!scenarios.length)limitations.push('EXECUTABLE_REPRODUCTIONS_REQUIRED');
 // Consumers whose own source is identical in both revisions (or only reached through the graph)
 // remain affected by any behavioural change; an unchanged consumer is never evidence of compatibility.
 const affected=[...consumers.values()],sides=affected.map(point=>({repository_id:point.repository_id,source_object_id:point.source_object_id,symbol_ids:point.symbol_ids}));
 const unchangedConsumers=affected.filter(point=>point.origins.includes('BASELINE')===point.origins.includes('CANDIDATE')).map(point=>({repository_id:point.repository_id,source_object_id:point.source_object_id}));
 const behavioural=changed.filter(name=>(BEHAVIOURAL_FACETS as readonly string[]).includes(name));
 const producers={baseline:data.before.definition.producer,candidate:data.after.definition.producer};
 // Each reproduction is a cross-component obligation pinned to both sides; symbol agreement never satisfies it.
 const reproductions=changed.length?scenarios.map(scenario=>({template_id:scenario.template_id,assertion_ids:scenario.assertion_ids,
  baseline_contract_id:data.before.id,candidate_contract_id:data.after.id,producer:producers,consumers:sides,facets:changed,status:'UNRUN'})):[];
 const findings=changed.map(facet=>({facet,kind:behavioural.includes(facet)?'BEHAVIOURAL':'STRUCTURAL',
  signature_unchanged:!changed.includes('signatures'),baseline:data.before.definition.facets[facet],candidate:data.after.definition.facets[facet],
  producer:producers,consumers:sides,reproducer_template_ids:scenarios.map(scenario=>scenario.template_id),
  status:scenarios.length?'REPRODUCTION_REQUIRED':'REPRODUCER_MISSING'}));
 return {baseline_contract_id:data.before.id,candidate_contract_id:data.after.id,
  changed_facets:changed,behavioural_facets_changed:behavioural,unchanged_signatures:!changed.includes('signatures'),producer_source_changed:sourceChanged,
  affected_consumers:affected,unchanged_consumers:unchangedConsumers,graph,unknown_facets:unknown,
  required_reproductions:scenarios,reproductions,findings,analysis_complete:graphComplete&&!unknown.length,
  requires_behavioural_qualification:true,qualification_status:'UNRUN',limitations};
}
export interface ContractCoverageBinding {repository_id:string;source_object_id:string;candidate_digest?:string;input_manifest_digest?:string}
export async function inspectContractCoverage(db:ReviewDb,binding:ReviewScope,contractIds:string[],source:ContractCoverageBinding):Promise<unknown>{
 await primary(db);await lockReviewDisposition(db,binding);
 const ids=[...new Set(contractIds.map(uuid))];if(ids.length!==contractIds.length||ids.length>128)fail('CONTRACT_INPUT_INVALID','Contract identities must be bounded and distinct');
 const missing:string[]=[],proofs:Array<Record<string,unknown>>=[];let stale=false;
 for(const id of ids){
  const contract=await db.query<{criteria_digest:string;revision:string;latest:string;definition:ContractDefinition}>(`SELECT c.criteria_digest,c.revision,c.definition,
   (SELECT max(newer.revision)::text FROM hyperfide.contracts newer WHERE newer.organisation_id=c.organisation_id AND newer.run_id=c.run_id AND newer.contract_key=c.contract_key) AS latest
   FROM hyperfide.contracts c WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3`,[binding.organisation_id,binding.run_id,id]);
  if(!contract.rows.length){missing.push(id);continue;}
  if(contract.rows[0]!.revision!==contract.rows[0]!.latest){stale=true;missing.push(id);continue;}
  const rows=await db.query<{id:string;input_manifest_digest:string;candidate_digest:string;snapshot:Record<string,unknown>;result:Record<string,unknown>;receipt_id:string;lease_generation:string;receipt_generation:string}>(`
   SELECT job.id,job.input_manifest_digest,job.candidate_digest,job.snapshot,job.lease_generation,
    receipt.id AS receipt_id,receipt.lease_generation AS receipt_generation,receipt.result
   FROM hyperfide.review_reproduction_jobs job JOIN hyperfide.review_reproduction_receipts receipt
   ON receipt.organisation_id=job.organisation_id AND receipt.run_id=job.run_id AND receipt.job_id=job.id
   WHERE job.organisation_id=$1 AND job.run_id=$2 AND job.state='PASSED'
    AND job.snapshot->>'variant'='REPAIRED' AND job.snapshot->'contract_ids' @> $3::jsonb`,
   [binding.organisation_id,binding.run_id,JSON.stringify([id])]);
  const expected=[...new Set(contract.rows[0]!.definition.scenario_templates.flatMap(scenario=>scenario.assertion_ids))],seen=new Set<string>(),admitted:Array<Record<string,unknown>>=[];
  if(!expected.length){missing.push(id);continue;}
  for(const row of rows.rows){
   if(row.receipt_generation!==row.lease_generation||hash(row.snapshot)!==row.input_manifest_digest||
      !source.candidate_digest||!source.input_manifest_digest||row.candidate_digest!==source.candidate_digest||
      row.snapshot.candidate_input_manifest_digest!==source.input_manifest_digest)continue;
   if(!await reviewInputCurrent(db,binding,row.snapshot))continue;
   const sourceSet=row.snapshot.source_set;
   if(!Array.isArray(sourceSet)||!sourceSet.some(entry=>entry&&typeof entry==='object'&&
    (entry as Record<string,unknown>).repository_id===source.repository_id&&(entry as Record<string,unknown>).source_object_id===source.source_object_id))continue;
   const versions=row.snapshot.contract_versions;
   if(!Array.isArray(versions)||!versions.some(entry=>entry&&typeof entry==='object'&&
    (entry as Record<string,unknown>).id===id&&(entry as Record<string,unknown>).criteria_digest===contract.rows[0]!.criteria_digest))continue;
   const result=row.result,evidenceIds=result.evidence_ids,checks=result.checks;
   if(!Array.isArray(evidenceIds)||!evidenceIds.length||!Array.isArray(checks)||!checks.length||
      checks.some(check=>!check||typeof check!=='object'||(check as Record<string,unknown>).status!=='PASS'))continue;
   const evidence=await db.query<{id:string}>(`SELECT evidence.id FROM hyperfide.evidence evidence JOIN hyperfide.artifacts artifact ON artifact.organisation_id=evidence.organisation_id AND artifact.run_id=evidence.run_id AND artifact.id=evidence.artifact_id WHERE evidence.organisation_id=$1 AND evidence.run_id=$2 AND evidence.id=ANY($3::uuid[]) AND evidence.admission_state='ADMITTED' AND evidence.repository_id=$4 AND evidence.source_object_id=$5 AND artifact.status='COMPLETE'`,[binding.organisation_id,binding.run_id,evidenceIds,source.repository_id,source.source_object_id]);
   if(evidence.rows.length!==new Set(evidenceIds).size)continue;
   for(const check of checks as Array<Record<string,unknown>>)if(typeof check.id==='string'&&expected.includes(check.id))seen.add(check.id);
   admitted.push({contract_id:id,plan_id:row.snapshot.plan_id,receipt_id:row.receipt_id,input_manifest_digest:row.snapshot.candidate_input_manifest_digest,execution_input_manifest_digest:row.input_manifest_digest,candidate_digest:row.candidate_digest});
  }
  if(expected.every(check=>seen.has(check)))proofs.push(...admitted);else missing.push(id);
 }
 return {status:stale?'STALE':missing.length?'INCOMPLETE':'COMPLETE',contract_ids:ids,
  source_set:[{repository_id:source.repository_id,source_object_id:source.source_object_id}],missing_contract_ids:missing,proofs};
}
export function createComponent(_context:ComponentContext):Component{
 const guarded=(fn:(ctx:ComponentContext,input:unknown)=>Promise<unknown>)=>async(input:unknown,ctx:ComponentContext)=>{try{return await fn(ctx,input);}catch(error){throw reviewError(error);}};
 return {apiVersion:1,actions:{
  'review.contract.publish':guarded(publishContract),
  'review.contract.impact':guarded(analyseContractImpact),
  'review.contract.coverage':guarded(async(ctx,input)=>{
   const v=obj(input,['organisation_id','run_id','contract_ids','repository_id','source_object_id','candidate_digest','input_manifest_digest']);
   return transaction(ctx,scope(v),db=>inspectContractCoverage(db,scope(v),strings(v.contract_ids,128),
    {repository_id:uuid(v.repository_id),source_object_id:oid(v.source_object_id),candidate_digest:digest(v.candidate_digest),input_manifest_digest:digest(v.input_manifest_digest)}),false);
  })
 }};
}
