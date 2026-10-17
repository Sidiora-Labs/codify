import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {AuthorityTransaction} from '../transport/protocol.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {readSemanticDisposition,writeSemanticDisposition} from '../storage/dispositions.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {validIntegrationRef,specTransaction} from './import.js';

type Tx=AuthorityTransaction;
export interface DependencyScope {organisation_id:string;run_id:string}
export interface PlanPins {run_id:string;spec_revision_id:string;spec_generation:string;state_version:string}
export interface DependencyDiagnostic {code:string;run_id:string;task_key?:string;section?:string|undefined;key?:string|undefined;line?:number|undefined;target?:string|undefined;path?:string[]|undefined;path_truncated?:boolean;cycle_length?:number;
 qualified_target?:string;candidates?:string[];scope_path?:string;owners?:string[];excerpt?:string}
export interface AcceptedDependency {
 task_id:string;source_spec_generation:string;predecessor_run_id:string;predecessor_task_id:string;
 predecessor_spec_generation:string;predecessor_spec_revision_id:string;
 predecessor_repository_id:string|null;integration_ref:string|null;milestone:'QUALIFIED'|'INTEGRATED';
}
export interface ProposedDependencyTask {package_key:string;package_wave:number;id:string;task_key:string;definition:Record<string,any>;wave:number;state:string;state_version:string;spec_generation:string;spec_revision_id:string;criteria_digest:string;run_id:string}
type Task=ProposedDependencyTask;
interface Snapshot {run:Record<string,any>;tasks:Task[]}
export interface DependencyReport {
 status:'STRUCTURALLY_VALID'|'INVALID';authority:'STRUCTURAL_VALIDATION';spec_revision_id:string;spec_generation:string;state_version:string;
 task_count:number;edge_count:number;diagnostic_count:number;diagnostics_truncated:boolean;diagnostics:DependencyDiagnostic[];
 coordination_count:number;coordination_diagnostics:DependencyDiagnostic[];edges:AcceptedDependency[];
 edge_summary:{qualified_revision:number;integrated_target:number;cross_feature:number;cross_run:number;cross_repository:number};
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POS=/^[1-9][0-9]{0,18}$/;
const MAX_TASKS=50000,MAX_EDGES=200000,MAX_RUNS=32,MAX_DIAGNOSTICS=128,MAX_SCOPE_PAIRS=100000,MAX_REACH_VISITS=4000000;
// Prose is never authority. Fields carrying structure or commands are not scanned for task references.
const STRUCTURAL_FIELDS=new Set(['requires','touches','owner','wave','feature','status','reqs','acceptance_ids','artifacts','verify_cmd']);
const PROSE_REFERENCE=/\btasks?\s+([0-9]+(?:\.[0-9]+)*(?:\s*(?:,|\band\b|\bor\b|&|\/)\s*[0-9]+(?:\.[0-9]+)*)*)/gi;
// A prerequisite cue must govern the reference: at most three words between the cue and 'task N'.
const PROSE_PREREQUISITE=/\b(after|from|following|once|until|requires?|depends? on|blocked by|prerequisites?)\s+(?:[\w'-]+\s+){0,3}$/i;
const PROSE_COORDINATION=/\b(depends on|blocked by|after task|must precede|coordinate with)\b/i;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function positive(value:unknown):value is string{return typeof value==='string'&&POS.test(value)&&BigInt(value)<=9223372036854775807n;}
function exact(value:unknown,keys:string[],optional:string[]=[]):Record<string,unknown>{
 if(!object(value)||keys.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...keys,...optional].includes(key)))
  fail('SPEC_INPUT_INVALID','Request fields do not match the versioned spec contract');return value;
}
function scopeInput(scope:DependencyScope,value:unknown,keys:string[],optional:string[]=[]):Record<string,unknown>{
 const input=exact(value,['run_id',...keys],optional);
 if(!UUID.test(scope.organisation_id)||!UUID.test(scope.run_id)||input.run_id!==scope.run_id)
  fail('SPEC_SCOPE_MISMATCH','Request must match authenticated organisation and run');
 return input;
}
function taskFields(task:Task):Record<string,any>{return object(task.definition.section)&&object(task.definition.section.fields)?task.definition.section.fields:{};}
function feature(task:Task):string{return typeof task.definition.feature_key==='string'?task.definition.feature_key:'';}
function owner(task:Task):string{const value=taskFields(task).owner?.value;return typeof value==='string'&&value?value:'feature:'+feature(task);}
function qualified(run_id:string,feature_key:string,task_key:string,repository_id?:string|null):string{
 return 'run/'+run_id+'/feature/'+feature_key+'/task/'+task_key+(repository_id?'@repository/'+repository_id:'');
}
function overlaps(path:string):string[]{const parts=path.split('/');return parts.map((_,index)=>parts.slice(0,index+1).join('/'));}
function safeTouch(value:unknown):boolean{
 return typeof value==='string'&&value.length>0&&value.length<=1024&&!value.startsWith('/')&&!/[\\\x00-\x1f]/.test(value)&&
 value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
}
async function readySchema(tx:Tx):Promise<void>{
 const bytes=await readFile(new URL('../../migrations/0202-spec-dependencies.sql',import.meta.url));
 const checksum='sha256:'+createHash('sha256').update(bytes).digest('hex');
 const result=await tx.query('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=202');
 if(result.rows.length!==1||result.rows[0]!.name!=='0202-spec-dependencies'||result.rows[0]!.checksum!==checksum)
  fail('SPEC_SCHEMA_NOT_READY','Exact dependency migration must be applied by the trusted operator');
}
async function snapshot(tx:Tx,scope:DependencyScope,run_id:string,lock=false):Promise<Snapshot>{
 assertPrimaryTransaction(tx);
 try{await readSemanticDisposition(tx,{organisation_id:scope.organisation_id,run_id});}catch(error){if(error instanceof FoundationError&&error.code==='SEMANTIC_RUN_MISSING')fail('SPEC_RUN_NOT_FOUND','Accepted run does not exist in this organisation');throw error;}
 const result=await tx.query('SELECT r.*,r.spec_generation::text,r.state_version::text,pg_is_in_recovery() AS replica FROM hyperfide.runs r WHERE r.organisation_id=$1 AND r.id=$2'+(lock?' FOR UPDATE':' FOR SHARE'),[scope.organisation_id,run_id]);
 const run=result.rows[0];if(!run)fail('SPEC_RUN_NOT_FOUND','Accepted run does not exist in this organisation');
 if(run.replica)fail('PRIMARY_REQUIRED','Accepted plan authority requires primary state');
 const tasks=await tx.query('SELECT t.id,t.task_key,t.definition,t.wave,t.state,t.state_version::text,t.spec_generation::text,t.spec_revision_id,t.criteria_digest,t.run_id,p.package_key,p.wave AS package_wave FROM hyperfide.tasks t JOIN hyperfide.feature_packages p ON p.organisation_id=t.organisation_id AND p.run_id=t.run_id AND p.id=t.feature_package_id WHERE t.organisation_id=$1 AND t.run_id=$2 ORDER BY t.task_key LIMIT 50001',[scope.organisation_id,run_id]);
 if(tasks.rows.length>MAX_TASKS)fail('SPEC_GRAPH_LIMIT','Accepted task graph exceeds the bounded validation limit');
 return {run,tasks:tasks.rows as Task[]};
}
function assertPins(run:Record<string,any>,input:Record<string,unknown>):void{
 if(typeof input.spec_revision_id!=='string'||!UUID.test(input.spec_revision_id)||!positive(input.spec_generation)||!positive(input.state_version))
  fail('SPEC_INPUT_INVALID','Exact accepted revision, generation and state version are required');
 if(run.spec_revision_id!==input.spec_revision_id||run.spec_generation!==input.spec_generation||run.state_version!==input.state_version)
  fail('SPEC_PLAN_STALE','Accepted plan changed before the operation');
}
function declared(task:Task):unknown{return taskFields(task).requires?.value??[];}
function referenceRuns(tasks:Task[],organisation_id:string):string[]{
 const result=new Set<string>();
 for(const task of tasks){const values=declared(task);if(Array.isArray(values))for(const value of values)
  if(object(value)&&value.organisation_id===organisation_id&&typeof value.run_id==='string'&&UUID.test(value.run_id))result.add(value.run_id);}
 return [...result];
}
// Graph nodes are scoped UUIDs, never human task labels. All referenced run locks and
// reads share the caller's SERIALIZABLE transaction; admission retries revalidate it.
async function validateGraph(tx:Tx,scope:DependencyScope,input:PlanPins,proposed?:Task[]):Promise<DependencyReport>{
 const request=scopeInput(scope,input,['spec_revision_id','spec_generation','state_version']);
 await readySchema(tx);
 const current=await snapshot(tx,scope,scope.run_id);assertPins(current.run,request);
 if(proposed&&(proposed.length>MAX_TASKS||proposed.some(task=>task.run_id!==scope.run_id)||new Set(proposed.map(task=>task.id)).size!==proposed.length))fail('SPEC_GRAPH_LIMIT','Proposed graph must remain bounded and exactly scoped');
 const first=proposed?{run:current.run,tasks:proposed}:current;
 const snapshots=new Map<string,Snapshot>([[scope.run_id,first]]),queue=[scope.run_id],discovered=new Set<string>([scope.run_id]);
 let total=first.tasks.length;
 while(queue.length){const current=snapshots.get(queue.shift()!)!;
  for(const runId of referenceRuns(current.tasks,scope.organisation_id))if(!discovered.has(runId)){
   if(discovered.size>=MAX_RUNS)fail('SPEC_GRAPH_LIMIT','Cross-run validation exceeds the bounded run limit');
   discovered.add(runId);
   let next:Snapshot;
   try{next=await snapshot(tx,scope,runId);}catch(error){if(error instanceof FoundationError&&error.code==='SPEC_RUN_NOT_FOUND')continue;throw error;}
   total+=next.tasks.length;if(total>MAX_TASKS)fail('SPEC_GRAPH_LIMIT','Combined task graph exceeds validation limit');
   snapshots.set(runId,next);queue.push(runId);
  }
 }
 if(!first.tasks.length)fail('SPEC_EMPTY_PLAN','An accepted plan must contain at least one task');
 let diagnosticCount=0,edgeCount=0,coordinationCount=0;
 const diagnostics:DependencyDiagnostic[]=[],coordination:DependencyDiagnostic[]=[],edges:AcceptedDependency[]=[];
 const summary={qualified_revision:0,integrated_target:0,cross_feature:0,cross_run:0,cross_repository:0};
 const adjacency=new Map<string,string[]>(),nodes=new Map<string,Task>(),taskIndex=new Map<string,Task[]>(),keyIndex=new Map<string,Task[]>();
 const located=(code:string,task:Task,key:string,target?:string,extra:Partial<DependencyDiagnostic>={}):DependencyDiagnostic=>({code,run_id:task.run_id,task_key:task.task_key,
  ...(typeof task.definition.section?.name==='string'?{section:task.definition.section.name}:{}),key,
  ...(typeof taskFields(task)[key]?.line==='number'?{line:taskFields(task)[key].line}:{}),...(target?{target}:{}),...extra});
 const diagnostic=(code:string,task:Task,target?:string,key='requires',path?:string[],extra:Partial<DependencyDiagnostic>={})=>{
  diagnosticCount++;if(diagnostics.length<MAX_DIAGNOSTICS)diagnostics.push(located(code,task,key,target,{
   ...(path?{path:path.length>64?[...path.slice(0,32),...path.slice(-32)]:path,path_truncated:path.length>64,cycle_length:path.length-1}:{}),...extra}));
 };
 const advise=(code:string,task:Task,key:string,target?:string,extra:Partial<DependencyDiagnostic>={})=>{
  coordinationCount++;if(coordination.length<MAX_DIAGNOSTICS)coordination.push(located(code,task,key,target,extra));
 };
 const pinnedRepositories=new Map<string,Map<string,string>>();
 const repositoryPin=async(run_id:string,repository_id:string):Promise<string|undefined>=>{
  let pins=pinnedRepositories.get(run_id);
  if(!pins){pins=new Map((await tx.query('SELECT repository_id,integration_ref FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2',
   [scope.organisation_id,run_id])).rows.map(row=>[row.repository_id as string,row.integration_ref as string]));pinnedRepositories.set(run_id,pins);}
  return pins.get(repository_id);
 };
 for(const snap of snapshots.values())for(const task of snap.tasks){const key=task.run_id+':'+task.id;nodes.set(key,task);adjacency.set(key,[]);const logical=task.run_id+'\0'+feature(task)+'\0'+task.task_key;taskIndex.set(logical,[...(taskIndex.get(logical)??[]),task]);
  const bare=task.run_id+'\0'+task.task_key;keyIndex.set(bare,[...(keyIndex.get(bare)??[]),task]);}
 const SAME_RUN_KEYS=['feature_key','task_key','milestone','repository_id','integration_ref'];
 const CROSS_RUN_KEYS=['organisation_id','run_id','repository_id','feature_key','task_key','spec_generation','spec_revision_id','milestone','integration_ref'];
 for(const snap of snapshots.values())for(const task of snap.tasks){
  const fields=taskFields(task),raw=declared(task),localEdges=new Set<string>();
  if(!feature(task))diagnostic('FEATURE_NAMESPACE_MISSING',task,undefined,'feature');
  if(task.package_key!=='feature:'+feature(task)+':wave:'+String(task.definition.declared_wave)||task.package_wave!==task.wave||
   fields.feature!==undefined&&fields.feature.value!==feature(task))diagnostic('FEATURE_PACKAGE_MISMATCH',task,undefined,'feature');
  if(!Number.isSafeInteger(task.wave)||task.wave<1||!Number.isSafeInteger(task.definition.declared_wave)||task.definition.declared_wave<0)
   diagnostic('WAVE_INVALID',task,undefined,'wave');
  if(fields.touches!==undefined&&(!Array.isArray(fields.touches.value)||fields.touches.value.some((value:unknown)=>!safeTouch(value))))
   diagnostic('TOUCHES_INVALID',task,undefined,'touches');
  if(fields.owner!==undefined&&(typeof fields.owner.value!=='string'||fields.owner.value.length===0))
   diagnostic('OWNER_INVALID',task,undefined,'owner');
  if(!Array.isArray(raw)||raw.length>MAX_EDGES){diagnostic('REQUIRES_INVALID',task);continue;}
  for(const value of raw){
   if(++edgeCount>MAX_EDGES)fail('SPEC_GRAPH_LIMIT','Task graph exceeds the bounded edge limit');
   let targetRun=snap.run.id as string,targetKey='',targetFeature=feature(task),milestone:'QUALIFIED'|'INTEGRATED'='QUALIFIED';
   let repository:string|null=null,ref:string|null=null,targetGeneration=snap.run.spec_generation,targetRevision=snap.run.spec_revision_id;
   let form:'BARE'|'FEATURE'|'RUN'='BARE';
   if(typeof value==='string'&&value.length>0&&value.length<=255)targetKey=value;
   else if(object(value)&&!Object.hasOwn(value,'run_id')){
    // Same-run reference with a fully qualified feature identity; its revision is the run's own accepted revision.
    const integrated=value.milestone==='INTEGRATED';
    if(Object.keys(value).some(key=>!SAME_RUN_KEYS.includes(key))||typeof value.feature_key!=='string'||!value.feature_key||value.feature_key.length>255||
     typeof value.task_key!=='string'||!value.task_key||value.task_key.length>255||
     ![undefined,'QUALIFIED','INTEGRATED'].includes(value.milestone as string|undefined)||
     (value.repository_id!==undefined&&(typeof value.repository_id!=='string'||!UUID.test(value.repository_id)))||
     (integrated?(value.repository_id===undefined||typeof value.integration_ref!=='string'||!validIntegrationRef(value.integration_ref)):
      value.integration_ref!==undefined&&value.integration_ref!==null)){
     diagnostic('DEPENDENCY_DESCRIPTOR_INVALID',task);continue;
    }
    form='FEATURE';targetKey=value.task_key;targetFeature=value.feature_key;repository=(value.repository_id as string|undefined)??null;
    milestone=integrated?'INTEGRATED':'QUALIFIED';ref=integrated?value.integration_ref as string:null;
   }else if(object(value)){
    if(Object.keys(value).length!==CROSS_RUN_KEYS.length||CROSS_RUN_KEYS.some(key=>!Object.hasOwn(value,key))||value.organisation_id!==scope.organisation_id||
     typeof value.run_id!=='string'||!UUID.test(value.run_id)||typeof value.repository_id!=='string'||!UUID.test(value.repository_id)||
     typeof value.feature_key!=='string'||!value.feature_key||typeof value.task_key!=='string'||!value.task_key||
     !positive(value.spec_generation)||typeof value.spec_revision_id!=='string'||!UUID.test(value.spec_revision_id)||
     !['QUALIFIED','INTEGRATED'].includes(String(value.milestone))||
     (value.milestone==='INTEGRATED'?(typeof value.integration_ref!=='string'||!validIntegrationRef(value.integration_ref)):value.integration_ref!==null)){
      diagnostic('DEPENDENCY_DESCRIPTOR_INVALID',task);continue;
     }
    form='RUN';targetRun=value.run_id;targetKey=value.task_key;targetFeature=value.feature_key;repository=value.repository_id;
    targetGeneration=value.spec_generation;targetRevision=value.spec_revision_id;milestone=value.milestone as 'QUALIFIED'|'INTEGRATED';ref=value.integration_ref as string|null;
   }else {diagnostic('DEPENDENCY_REFERENCE_INVALID',task);continue;}
   const identity=qualified(targetRun,targetFeature,targetKey,repository);
   const targetSnapshot=snapshots.get(targetRun);
   if(!targetSnapshot){diagnostic('DEPENDENCY_RUN_MISSING',task,targetKey,'requires',undefined,{qualified_target:identity});continue;}
   const exactMatches=taskIndex.get(targetRun+'\0'+targetFeature+'\0'+targetKey)??[];
   const matches=exactMatches.length?exactMatches:(form==='BARE'?taskIndex.get(targetRun+'\0'+targetFeature+'\0'+targetFeature+'.'+targetKey)??[]:[]);
   if(matches.length!==1){
    const elsewhere=(keyIndex.get(targetRun+'\0'+targetKey)??[]).filter(other=>feature(other)!==targetFeature);
    if(form==='BARE'&&elsewhere.length)diagnostic('DEPENDENCY_FEATURE_UNQUALIFIED',task,targetKey,'requires',undefined,
     {qualified_target:identity,candidates:elsewhere.slice(0,8).map(other=>qualified(other.run_id,feature(other),other.task_key))});
    else diagnostic('DEPENDENCY_UNRESOLVED',task,targetKey,'requires',undefined,{qualified_target:identity});
    continue;
   }
   const predecessor=matches[0]!;
   if(form!=='RUN'){targetGeneration=predecessor.spec_generation;targetRevision=predecessor.spec_revision_id;}
   if(predecessor.spec_generation!==targetGeneration||predecessor.spec_revision_id!==targetRevision){diagnostic('DEPENDENCY_SPEC_STALE',task,targetKey,'requires',undefined,{qualified_target:identity});continue;}
   if(repository!==null){
    const pinned=await repositoryPin(targetRun,repository);
    if(pinned===undefined||milestone==='INTEGRATED'&&pinned!==ref){diagnostic('DEPENDENCY_REPOSITORY_MISMATCH',task,targetKey,'requires',undefined,{qualified_target:identity});continue;}
   }
   const node=targetRun+':'+predecessor.id;
   if(localEdges.has(node)){diagnostic('DEPENDENCY_DUPLICATE',task,targetKey,'requires',undefined,{qualified_target:identity});continue;}localEdges.add(node);
   if(targetRun===task.run_id&&predecessor.id===task.id){diagnostic('DEPENDENCY_SELF',task,targetKey);continue;}
   if(targetRun===task.run_id&&predecessor.wave>task.wave)diagnostic('DEPENDENCY_LATER_WAVE',task,targetKey,'wave',undefined,{qualified_target:identity});
   adjacency.get(task.run_id+':'+task.id)!.push(node);
   if(task.run_id===scope.run_id){
    edges.push({task_id:task.id,source_spec_generation:task.spec_generation,predecessor_run_id:targetRun,predecessor_task_id:predecessor.id,
     predecessor_spec_generation:targetGeneration,predecessor_spec_revision_id:targetRevision,predecessor_repository_id:repository,integration_ref:ref,milestone});
    summary[milestone==='INTEGRATED'?'integrated_target':'qualified_revision']++;
    if(targetRun!==task.run_id)summary.cross_run++;else if(feature(predecessor)!==feature(task))summary.cross_feature++;
    if(repository!==null)summary.cross_repository++;
   }
  }
 }
 // Bounded transitive predecessor search shared by ownership and prose ordering checks.
 let reachVisits=0;
 const reaches=(from:string,to:string):boolean|undefined=>{
  if(from===to)return true;
  const seen=new Set<string>([from]),stack=[from];
  while(stack.length){
   for(const next of adjacency.get(stack.pop()!)??[]){
    if(++reachVisits>MAX_REACH_VISITS)return undefined;
    if(next===to)return true;if(!seen.has(next)){seen.add(next);stack.push(next);}
   }
  }
  return false;
 };
 const ordered=(a:Task,b:Task):boolean|undefined=>{
  const ab=reaches(a.run_id+':'+a.id,b.run_id+':'+b.id);if(ab)return true;
  const ba=reaches(b.run_id+':'+b.id,a.run_id+':'+a.id);if(ba)return true;
  return ab===undefined||ba===undefined?undefined:false;
 };
 // Two tasks claiming the same path (or an enclosing directory) must be sequenced by a
 // wave barrier or a dependency path; unsequenced claims by different owners contradict.
 const claims=new Map<string,Task[]>();
 for(const task of first.tasks){const touches=taskFields(task).touches?.value;
  if(Array.isArray(touches))for(const path of new Set(touches.filter(safeTouch) as string[]))claims.set(path,[...(claims.get(path)??[]),task]);}
 const pairs=new Map<string,{a:Task;b:Task;path:string}>();
 for(const [path,holders] of claims)for(const prefix of overlaps(path)){
  for(const other of claims.get(prefix)??[])for(const holder of holders){
   if(other.id===holder.id||prefix===path&&other.task_key>=holder.task_key)continue;
   const [a,b]=other.task_key<holder.task_key?[other,holder]:[holder,other],pair=a.id+':'+b.id;
   if(!pairs.has(pair)){if(pairs.size>=MAX_SCOPE_PAIRS)fail('SPEC_GRAPH_LIMIT','Overlapping scope claims exceed the bounded validation limit');pairs.set(pair,{a,b,path:prefix});}
  }
 }
 for(const {a,b,path} of pairs.values()){
  if(a.wave!==b.wave)continue;
  const sequenced=ordered(a,b),owners=[owner(a),owner(b)];
  if(sequenced===undefined)diagnostic('SCOPE_ORDER_UNCHECKED',b,a.task_key,'touches',undefined,{scope_path:path,owners});
  else if(!sequenced&&owners[0]!==owners[1])diagnostic('SCOPE_OWNERSHIP_CONFLICT',b,a.task_key,'touches',undefined,
   {scope_path:path,owners,qualified_target:qualified(a.run_id,feature(a),a.task_key)});
  else if(!sequenced)advise('SCOPE_SHARED_UNSEQUENCED',b,'touches',a.task_key,{scope_path:path,owners});
 }
 // Prose prerequisites are extracted with exact source locations and compared to the structural graph.
 for(const task of first.tasks){
  const fields=taskFields(task),self=task.run_id+':'+task.id;
  for(const [key,field] of Object.entries(fields)){
   if(STRUCTURAL_FIELDS.has(key)||typeof field?.value!=='string')continue;
   const text=field.value as string;let referenced=false;
   for(const match of text.matchAll(PROSE_REFERENCE)){
    const clause=text.slice(Math.max(0,match.index-80),match.index).split(/[.;]/).at(-1)!;
    const excerpt=text.slice(Math.max(0,match.index-60),Math.min(text.length,match.index+match[0].length+20));
    for(const targetKey of match[1]!.split(/\s*(?:,|\band\b|\bor\b|&|\/)\s*/)){
     if(!targetKey||targetKey===task.task_key)continue;referenced=true;
     const local=taskIndex.get(task.run_id+'\0'+feature(task)+'\0'+targetKey)??[],any=keyIndex.get(task.run_id+'\0'+targetKey)??[];
     const target=local.length===1?local[0]:any.length===1?any[0]:undefined;
     if(!target){advise('PROSE_REFERENCE_UNKNOWN',task,key,targetKey,{excerpt,qualified_target:qualified(task.run_id,feature(task),targetKey)});continue;}
     const identity=qualified(target.run_id,feature(target),target.task_key),node=target.run_id+':'+target.id;
     const before=reaches(self,node);
     if(before)continue;
     if(before===undefined){advise('PROSE_REFERENCE_UNCHECKED',task,key,targetKey,{excerpt,qualified_target:identity});continue;}
     if(PROSE_PREREQUISITE.test(clause))advise('PROSE_PREREQUISITE_WITHOUT_EDGE',task,key,targetKey,{excerpt,qualified_target:identity});
     else if(target.wave===task.wave&&reaches(node,self)===false)advise('PROSE_REFERENCE_UNSEQUENCED',task,key,targetKey,{excerpt,qualified_target:identity});
    }
   }
   if(!referenced&&PROSE_COORDINATION.test(text))advise('PROSE_COORDINATION_REQUIRES_REVIEW',task,key,undefined,{excerpt:text.slice(0,160)});
  }
 }

 const acceptedBindings=await tx.query(
 'SELECT d.*,d.revision::text AS source_spec_generation,d.predecessor_spec_generation::text FROM hyperfide.task_dependencies d '+
 'JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.run_id AND t.id=d.task_id AND t.spec_generation=d.revision '+
 'WHERE d.organisation_id=$1 AND d.run_id=$2 LIMIT 200001',[scope.organisation_id,scope.run_id]);
 if(acceptedBindings.rows.length>MAX_EDGES)fail('SPEC_GRAPH_LIMIT','Stored current dependency bindings exceed the validation limit');
 const expectedBindings=new Map(edges.map(edge=>[[edge.task_id,edge.predecessor_run_id,edge.predecessor_task_id,edge.milestone,edge.source_spec_generation].join(':'),edge]));
 for(const binding of acceptedBindings.rows){
  const owner=nodes.get(scope.run_id+':'+binding.task_id);
  if(!owner||owner.spec_generation!==binding.source_spec_generation)continue;
  if(binding.binding_schema_version!==1){diagnostic('DEPENDENCY_LEGACY_BINDING_UNSUPPORTED',owner);continue;}
  const expected=expectedBindings.get([binding.task_id,binding.predecessor_run_id,binding.predecessor_task_id,binding.milestone,binding.source_spec_generation].join(':'));
  if(!expected){diagnostic('DEPENDENCY_UNDECLARED_BINDING',owner);continue;}
  if(expected.predecessor_spec_generation!==binding.predecessor_spec_generation||expected.predecessor_spec_revision_id!==binding.predecessor_spec_revision_id||
   expected.predecessor_repository_id!==binding.predecessor_repository_id||expected.integration_ref!==binding.integration_ref)
   diagnostic('DEPENDENCY_ACCEPTED_BINDING_STALE',owner);
 }

 const colors=new Map<string,number>();
 for(const start of adjacency.keys()){
  if(colors.has(start))continue;
  const stack:{key:string;next:number}[]=[{key:start,next:0}],active=new Map<string,number>([[start,0]]);colors.set(start,1);
  while(stack.length){const frame=stack[stack.length-1]!,targets=adjacency.get(frame.key)!;
   if(frame.next===targets.length){colors.set(frame.key,2);active.delete(frame.key);stack.pop();continue;}
   const target=targets[frame.next++]!;
   if(colors.get(target)===1){const at=active.get(target)!;diagnostic('DEPENDENCY_CYCLE',nodes.get(frame.key)!,undefined,'requires',
    diagnostics.length<MAX_DIAGNOSTICS?[...stack.slice(at).map(item=>nodes.get(item.key)!.run_id+'/'+nodes.get(item.key)!.task_key),nodes.get(target)!.run_id+'/'+nodes.get(target)!.task_key]:undefined);}
   else if(!colors.has(target)){colors.set(target,1);active.set(target,stack.length);stack.push({key:target,next:0});}
  }
 }
 return {status:diagnosticCount?'INVALID':'STRUCTURALLY_VALID',authority:'STRUCTURAL_VALIDATION',
  spec_revision_id:first.run.spec_revision_id,spec_generation:first.run.spec_generation,state_version:first.run.state_version,
  task_count:first.tasks.length,edge_count:edges.length,diagnostic_count:diagnosticCount,diagnostics_truncated:diagnosticCount>diagnostics.length,
  diagnostics,coordination_count:coordinationCount,coordination_diagnostics:coordination,edges,edge_summary:summary};
}
// Proposed graphs share the exact structural engine; this never grants admission.
export async function validateProposedDependencies(tx:Tx,scope:DependencyScope,input:PlanPins,tasks:ProposedDependencyTask[]):Promise<DependencyReport>{
 return validateGraph(tx,scope,input,tasks);
}
export async function validateDependencies(tx:Tx,scope:DependencyScope,input:PlanPins):Promise<DependencyReport>{
 return validateGraph(tx,scope,input);
}
// Admission is structural only. Proof obligations (task 2.4) gate each task at dispatch
// admission (hierarchy/packets.ts refuses PROOF_REGISTRY_MISSING), so the dependency
// graph neither imports nor requires the proof registry that is planned after it.
// Amendment admission (2.3) passes retired task identities as exempt; admission keeps
// accepting the option so that caller stays source-compatible, and it has no effect here.
export interface AdmissionOptions {exempt_task_ids?:readonly string[]}
export async function admitDependencies(tx:Tx,scope:DependencyScope,input:PlanPins,options:AdmissionOptions={}):Promise<Omit<DependencyReport,'edges'>&{admitted:boolean;proof_obligations:'ENFORCED_AT_DISPATCH_ADMISSION'}>{
 assertPrimaryTransaction(tx);await writeSemanticDisposition(tx,scope);
 const request=scopeInput(scope,input,['spec_revision_id','spec_generation','state_version']);
 const current=await snapshot(tx,scope,scope.run_id,true);assertPins(current.run,request);
 if(current.run.state!=='PENDING_VALIDATION')fail('SPEC_ADMISSION_STATE','Only a pending-validation generation can be admitted');
 const report=await validateDependencies(tx,scope,input);
 if(report.status!=='STRUCTURALLY_VALID'){const {edges,...publicReport}=report;return {...publicReport,admitted:false,proof_obligations:'ENFORCED_AT_DISPATCH_ADMISSION'};}
 for(const edge of report.edges)await tx.query(
 'INSERT INTO hyperfide.task_dependencies(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision,binding_schema_version,predecessor_spec_generation,predecessor_spec_revision_id,predecessor_repository_id,integration_ref) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11) ON CONFLICT(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision) DO UPDATE SET binding_schema_version=EXCLUDED.binding_schema_version,predecessor_spec_generation=EXCLUDED.predecessor_spec_generation,predecessor_spec_revision_id=EXCLUDED.predecessor_spec_revision_id,predecessor_repository_id=EXCLUDED.predecessor_repository_id,integration_ref=EXCLUDED.integration_ref',
 [scope.organisation_id,scope.run_id,edge.task_id,edge.predecessor_run_id,edge.predecessor_task_id,edge.milestone,edge.source_spec_generation,
 edge.predecessor_spec_generation,edge.predecessor_spec_revision_id,edge.predecessor_repository_id,edge.integration_ref]);
 const updated=await tx.query("UPDATE hyperfide.runs SET state='READY',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND state='PENDING_VALIDATION' AND spec_revision_id=$3 AND spec_generation=$4 AND state_version=$5 RETURNING state_version::text",
 [scope.organisation_id,scope.run_id,input.spec_revision_id,input.spec_generation,input.state_version]);
 if(updated.rows.length!==1)fail('SPEC_PLAN_STALE','Plan changed before atomic admission');
 const {edges,...publicReport}=report;return {...publicReport,state_version:updated.rows[0]!.state_version,admitted:true,proof_obligations:'ENFORCED_AT_DISPATCH_ADMISSION'};
}
export async function resolveTask(tx:Tx,scope:DependencyScope,input:unknown):Promise<unknown>{
 const request=scopeInput(scope,input,['task_key']);
 if(typeof request.task_key!=='string'||!request.task_key||request.task_key.length>255)fail('SPEC_INPUT_INVALID','Full task key must be bounded text');
 const snap=await snapshot(tx,scope,scope.run_id),matches=snap.tasks.filter(task=>task.task_key===request.task_key);
 if(matches.length!==1)fail('SPEC_TASK_NOT_FOUND','Exact task key is absent from the authenticated run');
 const task=matches[0]!;
 return {authority:'ACCEPTED_TASK_IDENTITY',task_id:task.id,task_key:task.task_key,feature_key:feature(task),wave:task.wave,
  task_state:task.state,task_state_version:task.state_version,spec_revision_id:task.spec_revision_id,spec_generation:task.spec_generation,run_spec_revision_id:snap.run.spec_revision_id,run_spec_generation:snap.run.spec_generation,run_state:snap.run.state,run_state_version:snap.run.state_version};
}
export async function structuralFrontier(tx:Tx,scope:DependencyScope,input:unknown):Promise<unknown>{
 const request=scopeInput(scope,input,[],['limit']);
 if(request.limit!==undefined&&(!Number.isInteger(request.limit)||(request.limit as number)<1||(request.limit as number)>100))fail('SPEC_INPUT_INVALID','Frontier limit must be an integer from1to100');
 const snap=await snapshot(tx,scope,scope.run_id);
 const report=await validateDependencies(tx,scope,{run_id:scope.run_id,spec_revision_id:snap.run.spec_revision_id,spec_generation:snap.run.spec_generation,state_version:snap.run.state_version});
 const limit=request.limit as number|undefined??25;
 const candidates=report.status==='STRUCTURALLY_VALID'?snap.tasks.filter(task=>['PENDING','READY','BLOCKED','STALE'].includes(task.state)&&
  !report.edges.some(edge=>edge.task_id===task.id)).sort((a,b)=>a.wave-b.wave||a.task_key.localeCompare(b.task_key)).slice(0,limit):[];
 return {authority:'CANDIDATE_DISCOVERY',kind:'STRUCTURAL_FRONTIER',operational_eligibility:'UNASSESSED',validation_status:report.status,
  spec_revision_id:report.spec_revision_id,spec_generation:report.spec_generation,state_version:report.state_version,
  candidates:candidates.map(task=>({task_id:task.id,task_key:task.task_key,wave:task.wave,criteria_digest:task.criteria_digest,spec_revision_id:task.spec_revision_id,spec_generation:task.spec_generation,task_state_version:task.state_version})),
  diagnostic_count:report.diagnostic_count,diagnostics:report.diagnostics};
}
export function createComponent(_startup:ComponentContext):Component{
 const read=(handler:(tx:Tx,scope:DependencyScope,input:unknown)=>Promise<unknown>)=>async(input:unknown,ctx:ComponentContext)=>
  specTransaction(ctx,'READ',async(tx,i)=>handler(tx,{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id},input));
 return {apiVersion:1,actions:{
  'spec.task.resolve':read(resolveTask),'spec.next':read(structuralFrontier),
  'spec.dependencies.check':read(async(tx,scope,input)=>{const report=await validateDependencies(tx,scope,input as PlanPins);const {edges,...result}=report;return result;}),
  'spec.dependencies.admit':async(input,ctx)=>specTransaction(ctx,'WRITE',async(tx,i)=>{
   if(!['OPERATOR','LEADER','COORDINATOR'].includes(i.principal.role))fail('ACTION_DENIED','Role cannot admit an accepted plan');
   return admitDependencies(tx,{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id},input as PlanPins);
  })
 }};
}
