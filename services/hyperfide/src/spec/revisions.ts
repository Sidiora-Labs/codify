import type {AuthorityTransaction,InvocationContext} from '../transport/protocol.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {identityTransaction} from '../identity/enrollment.js';
import {FoundationError,object} from '../policy/programme.js';
import {prepareAcceptedIntent,canonical,digest,derivedId} from './import.js';
import type {SpecScope,KvxSection,StoredIntent} from './import.js';
import {validateProposedDependencies} from './dependencies.js';
import type {ProposedDependencyTask,DependencyReport} from './dependencies.js';

type Tx=AuthorityTransaction;
type Prepared=Awaited<ReturnType<typeof prepareAcceptedIntent>>;
export interface AmendmentRequest {
 run_id:string;base_spec_revision_id:string;base_spec_generation:string;state_version:string;
 purpose:'REPLAN'|'INTENT_CHANGE';reason:string;replacement:unknown;
}
export interface AmendmentImpact {
 added:string[];changed:string[];retired:string[];affected_task_ids:string[];
 global_intent_changed:boolean;external_dependents:{run_id:string;task_id:string}[];
}
export interface AmendmentAnalysis {
 schema_version:1;proposal_digest:string;accepted:false;dispatch_authority:false;
 status:'STRUCTURALLY_VALID'|'INVALID';diagnostics:{code:string;task_key?:string}[];
 impact:AmendmentImpact;structural:DependencyReport;
}
interface InternalAnalysis {result:AmendmentAnalysis;prepared:Prepared;request:AmendmentRequest;tasks:ProposedDependencyTask[];prior:Record<string,any>}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POS=/^[1-9][0-9]{0,18}$/;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function requestOf(input:unknown,scope:SpecScope):AmendmentRequest{
 const keys=['run_id','base_spec_revision_id','base_spec_generation','state_version','purpose','reason','replacement'];
 if(!object(input)||Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||
 input.run_id!==scope.run_id||typeof input.base_spec_revision_id!=='string'||!UUID.test(input.base_spec_revision_id)||
 typeof input.base_spec_generation!=='string'||!POS.test(input.base_spec_generation)||BigInt(input.base_spec_generation)>=9223372036854775807n||
 typeof input.state_version!=='string'||!POS.test(input.state_version)||!['REPLAN','INTENT_CHANGE'].includes(String(input.purpose))||
 typeof input.reason!=='string'||input.reason.trim().length<1||input.reason.length>4096||input.reason.includes('\0'))
  fail('AMENDMENT_INPUT_INVALID','Exact accepted base pins, purpose, reason and replacement are required');
 return input as unknown as AmendmentRequest;
}
function semantic(section:KvxSection):unknown{
 return Object.fromEntries(Object.entries(section.fields).filter(([key])=>key!=='status').map(([key,field])=>[key,field.value]));
}
function globals(document:StoredIntent):unknown{
 return document.parsed.sections.filter(section=>!section.name.startsWith('task.')).map(section=>({name:section.name,fields:semantic(section)})).sort((a,b)=>a.name.localeCompare(b.name));
}
function ids(section:KvxSection|undefined,key:string):string[]{
 const value=section?.fields[key]?.value;return Array.isArray(value)&&value.every(item=>typeof item==='string')?value:[];
}
// Analysis shares the real dependency validator. It neither inserts accepted
// revisions nor changes task/compute/evidence authority.
async function analyse(tx:Tx,scope:SpecScope,input:unknown,storedSource?:Buffer):Promise<InternalAnalysis>{
 const request=requestOf(input,scope);
 const row=(await tx.query('SELECT r.*,r.spec_generation::text,r.state_version::text,s.document,s.source_digest FROM hyperfide.runs r JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id WHERE r.organisation_id=$1 AND r.id=$2 AND r.project_id=$3 FOR SHARE OF r',
  [scope.organisation_id,scope.run_id,scope.project_id])).rows[0];
 if(!row||row.spec_revision_id!==request.base_spec_revision_id||row.spec_generation!==request.base_spec_generation||row.state_version!==request.state_version||
 row.authority_epoch!==scope.authority_epoch)fail('AMENDMENT_BASE_STALE','Accepted run or authority changed before analysis');
 if(!['PENDING_VALIDATION','READY','RUNNING','PAUSED'].includes(row.state))fail('AMENDMENT_RUN_STATE','Run state does not permit accepted-plan amendments');
 const prepared=await prepareAcceptedIntent(scope,request.replacement,storedSource);
 const records=await tx.query('SELECT t.id,t.task_key,t.definition,t.wave,t.state,t.state_version::text,t.spec_generation::text,t.spec_revision_id,t.criteria_digest,t.run_id,p.package_key,p.wave AS package_wave FROM hyperfide.tasks t JOIN hyperfide.feature_packages p ON p.organisation_id=t.organisation_id AND p.run_id=t.run_id AND p.id=t.feature_package_id WHERE t.organisation_id=$1 AND t.run_id=$2 ORDER BY t.task_key LIMIT 50001',[scope.organisation_id,scope.run_id]);
 if(records.rows.length>50000||prepared.tasks.length>50000)fail('SPEC_GRAPH_LIMIT','Amendment exceeds the bounded task limit');
 const priorTasks=records.rows.filter(task=>!object(task.definition?.retirement)) as ProposedDependencyTask[];
 const priorByKey=new Map(priorTasks.map(task=>[task.task_key,task]));
 const proposedByKey=new Map(prepared.tasks.map(task=>[task.key,task]));
 const diagnostics:{code:string;task_key?:string}[]=[];
 const note=(code:string,key?:string)=>{if(diagnostics.length<128)diagnostics.push({code,...(key?{task_key:key}:{})});};
 const previous=row.document as StoredIntent;
 const global_intent_changed=canonical(globals(previous))!==canonical(globals(prepared.document))||
 canonical([...previous.allowed_actions].sort())!==canonical([...prepared.document.allowed_actions].sort())||canonical(previous.closure_policy)!==canonical(prepared.document.closure_policy);
 if(global_intent_changed&&request.purpose==='REPLAN')note('INTENT_APPROVAL_REQUIRED');
 if(canonical(previous.repositories)!==canonical(prepared.document.repositories))note('REPOSITORY_CHANGE_REQUIRES_NEW_RUN');
 const added=prepared.tasks.filter(task=>!priorByKey.has(task.key)).map(task=>task.key);
 const retired=priorTasks.filter(task=>!proposedByKey.has(task.task_key)).map(task=>task.task_key);
 const changed=prepared.tasks.filter(task=>{const old=priorByKey.get(task.key);return old&&(global_intent_changed||canonical(semantic(old.definition.section))!==canonical(semantic(task.section)));}).map(task=>task.key);
 for(const task of prepared.tasks){const old=priorByKey.get(task.key);
  if(old&&(old.package_key!==task.package_key||old.wave!==task.wave))note('TASK_RELOCATION_REQUIRES_NEW_IDENTITY',task.key);
  if(records.rows.some(old=>old.task_key===task.key&&!priorByKey.has(task.key)))note('RETIRED_TASK_IDENTITY_CANNOT_BE_REUSED',task.key);
 }
 if(request.purpose==='REPLAN'){
  const oldCoverage=new Set(priorTasks.flatMap(task=>ids(task.definition.section,'reqs')));
  const newCoverage=new Set(prepared.tasks.flatMap(task=>ids(task.section,'reqs')));
  if([...oldCoverage].some(id=>!newCoverage.has(id)))note('ACCEPTANCE_COVERAGE_CANNOT_BE_REMOVED');
  // Legacy whole-task checks cannot be weakened through decomposition/retry.
  for(const task of prepared.tasks)for(const req of ids(task.section,'reqs')){
   const old=priorTasks.filter(candidate=>ids(candidate.definition.section,'reqs').includes(req));
   const oldCommands=old.map(candidate=>candidate.definition.section?.fields?.verify_cmd?.value).filter(value=>typeof value==='string');
   if(oldCommands.length&&!old.some(candidate=>candidate.definition.section?.fields?.verify_cmd?.value===task.section.fields.verify_cmd?.value&&
    canonical(candidate.definition.section?.fields?.artifacts?.value)===canonical(task.section.fields.artifacts?.value)))
    note('ACCEPTED_TASK_CHECK_CANNOT_BE_WEAKENED',task.key);
  }
 }
 const affected=new Set([...changed,...retired].map(key=>priorByKey.get(key)!.id));
 const links=(await tx.query('SELECT task_id,predecessor_task_id,run_id FROM hyperfide.task_dependencies WHERE organisation_id=$1 AND predecessor_run_id=$2 LIMIT 200001',[scope.organisation_id,scope.run_id])).rows;
 if(links.length>200000)fail('SPEC_GRAPH_LIMIT','Amendment dependency impact exceeds the bounded edge limit');
 const reverse=new Map<string,Set<string>>();
 const add=(predecessor:string,dependent:string)=>{if(!reverse.has(predecessor))reverse.set(predecessor,new Set());reverse.get(predecessor)!.add(dependent);};
 for(const edge of links)if(edge.run_id===scope.run_id)add(edge.predecessor_task_id,edge.task_id);
 const planByFeatureKey=new Map(prepared.tasks.map(task=>[task.feature_key+'\0'+task.key,task]));
 for(const task of prepared.tasks){
  const values=task.section.fields.requires?.value;
  if(Array.isArray(values))for(const value of values){
   const key=typeof value==='string'?value:object(value)&&value.run_id===scope.run_id&&value.organisation_id===scope.organisation_id?value.task_key:undefined;
   const feature=typeof value==='string'?task.feature_key:object(value)?value.feature_key:undefined;
   if(typeof key==='string'&&typeof feature==='string'){
    const predecessor=planByFeatureKey.get(feature+'\0'+key)??planByFeatureKey.get(feature+'\0'+feature+'.'+key);
    if(predecessor)add(priorByKey.get(predecessor.key)?.id??derivedId(scope.run_id+':task:'+predecessor.key),priorByKey.get(task.key)?.id??derivedId(scope.run_id+':task:'+task.key));
   }
  }
 }
 const queue=[...affected];for(let at=0;at<queue.length;at++)for(const id of reverse.get(queue[at]!)??[])if(!affected.has(id)){affected.add(id);queue.push(id);}
 const external_dependents=links.filter(edge=>edge.run_id!==scope.run_id&&affected.has(edge.predecessor_task_id)).map(edge=>({run_id:String(edge.run_id),task_id:String(edge.task_id)}));
 if(external_dependents.length)note('EXTERNAL_RUN_COORDINATION_REQUIRED');
 const next=String(BigInt(row.spec_generation)+1n);
 const tasks:ProposedDependencyTask[]=prepared.tasks.map(task=>{
  const old=priorByKey.get(task.key),affectedTask=!old||affected.has(old.id);
  return {id:old?.id??derivedId(scope.run_id+':task:'+task.key),task_key:task.key,run_id:scope.run_id,package_key:task.package_key,package_wave:task.wave,wave:task.wave,
   state:affectedTask?'PENDING':old.state,state_version:old?.state_version??'1',spec_generation:affectedTask?next:old.spec_generation,spec_revision_id:affectedTask?prepared.specId:old.spec_revision_id,
   criteria_digest:affectedTask?digest(canonical({source_digest:prepared.document.source_digest,reqs:task.section.fields.reqs?.value??null})):old.criteria_digest,
   definition:affectedTask?{schema_version:1,section:task.section,feature_key:task.feature_key,declared_wave:task.declared_wave,runtime_wave_offset:prepared.document.runtime_wave_offset,declared_status:task.section.fields.status?.value??null,history_only:true}:old.definition};
 });
 const structural=await validateProposedDependencies(tx,{organisation_id:scope.organisation_id,run_id:scope.run_id},
  {run_id:scope.run_id,spec_revision_id:request.base_spec_revision_id,spec_generation:request.base_spec_generation,state_version:request.state_version},tasks);
 const proposal_digest=digest(canonical({schema_version:1,base_spec_revision_id:request.base_spec_revision_id,base_spec_generation:request.base_spec_generation,
  state_version:request.state_version,purpose:request.purpose,reason:request.reason,revision_digest:prepared.revision_digest}));
 return {request,prepared,tasks,prior:row,result:{schema_version:1,proposal_digest,accepted:false,dispatch_authority:false,
  status:diagnostics.length||structural.status==='INVALID'?'INVALID':'STRUCTURALLY_VALID',diagnostics,
  impact:{added,changed,retired,affected_task_ids:[...affected].sort(),global_intent_changed,external_dependents},structural}};
}
export async function validateSpecAmendment(tx:Tx,scope:SpecScope,input:unknown):Promise<AmendmentAnalysis>{
 return (await analyse(tx,scope,input)).result;
}
function bounded(result:AmendmentAnalysis):unknown{
 const {edges,...structural}=result.structural;
 return {...result,impact:{...result.impact,added:result.impact.added.slice(0,128),changed:result.impact.changed.slice(0,128),retired:result.impact.retired.slice(0,128),
  affected_task_ids:result.impact.affected_task_ids.slice(0,128),external_dependents:result.impact.external_dependents.slice(0,128),
  counts:{added:result.impact.added.length,changed:result.impact.changed.length,retired:result.impact.retired.length,affected:result.impact.affected_task_ids.length,external:result.impact.external_dependents.length}},structural};
}
async function scopeOf(tx:Tx,context:ComponentContext,invocation:InvocationContext):Promise<SpecScope>{
 const p=invocation.principal,row=(await tx.query('SELECT project_id,authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[p.organisation_id,p.run_id])).rows[0];
 if(!row||!context.env.HF_SPEC_ALLOWED_ROOT)fail('SPEC_CONFIG_INVALID','Trusted source root and current accepted run are required');
 return {organisation_id:p.organisation_id,project_id:row.project_id,run_id:p.run_id,authority_epoch:row.authority_epoch,root:context.env.HF_SPEC_ALLOWED_ROOT,allowed_actions:p.allowed_actions};
}
export function createComponent(_startup:ComponentContext):Component{
 const action=(persist:boolean)=>async(input:unknown,context:ComponentContext)=>identityTransaction(context,async(tx,invocation)=>{
  if(!['OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR'].includes(invocation.principal.role))fail('ACTION_DENIED','Role cannot propose accepted-plan amendments');
  const scope=await scopeOf(tx,context,invocation),analysis=await analyse(tx,scope,input);
  if(analysis.request.purpose==='INTENT_CHANGE'&&invocation.principal.role!=='OPERATOR')fail('ACTION_DENIED','Intent changes require an explicit operator');
  if(!persist)return bounded(analysis.result);
  const proposal={schema_version:1,request:analysis.request,source_content:analysis.prepared.source.text,revision_digest:analysis.prepared.revision_digest};
  if(Buffer.byteLength(canonical(proposal),'utf8')>67108864||Buffer.byteLength(canonical(analysis.result.impact),'utf8')>4194304)
   fail('AMENDMENT_STORAGE_LIMIT','Immutable proposal exceeds bounded storage');
  const id=derivedId(scope.run_id+':amendment:'+analysis.result.proposal_digest);
  await tx.query('INSERT INTO hyperfide.spec_amendments(organisation_id,run_id,id,base_spec_generation,base_spec_revision_id,base_state_version,proposal_digest,proposal,impact) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organisation_id,run_id,proposal_digest) DO NOTHING',
   [scope.organisation_id,scope.run_id,id,analysis.request.base_spec_generation,analysis.request.base_spec_revision_id,analysis.request.state_version,analysis.result.proposal_digest,JSON.stringify(proposal),JSON.stringify(analysis.result.impact)]);
  return {...bounded(analysis.result) as object,amendment_id:id,decision:'PROPOSED'};
 });
 return {apiVersion:1,actions:{'spec.amendment.check':action(false),'spec.amendment.propose':action(true)}};
}
