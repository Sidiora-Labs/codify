import type {AuthorityTransaction,InvocationContext} from '../transport/protocol.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {readSemanticDisposition} from '../storage/dispositions.js';
import {FoundationError,object} from '../policy/programme.js';
import {prepareAcceptedIntent,canonical,digest,derivedId,specTransaction} from './import.js';
import type {SpecScope,KvxSection,StoredIntent} from './import.js';
import {validateProposedDependencies,admitDependencies} from './dependencies.js';
import {registerProofPolicy} from './obligations.js';
import type {ProposedDependencyTask,DependencyReport} from './dependencies.js';

type Tx=AuthorityTransaction;
type Prepared=Awaited<ReturnType<typeof prepareAcceptedIntent>>;
export interface AmendmentRequest {
 run_id:string;base_spec_revision_id:string;base_spec_generation:string;state_version:string;
 purpose:'REPLAN'|'INTENT_CHANGE';reason:string;replacement:unknown;
}
// Active-work impact for one existing accepted task. Affected tasks are never
// silently reset: admission names each one for explicit revalidation, and any
// task still holding current compute must be fenced by the scheduler first.
export interface ActiveTaskImpact {
 task_id:string;task_key:string;state:string;spec_generation:string;current_compute:number;active_custody:number;released_custody:number;
 live_evidence:number;current_packets:number;accepted_work:boolean;disposition:'REVALIDATE'|'FENCE_REQUIRED'|'RETIRE';
}
export interface AmendmentImpact {
 added:string[];changed:string[];retired:string[];affected_task_ids:string[];
 global_intent_changed:boolean;external_dependents:{run_id:string;task_id:string}[];
 revalidation:ActiveTaskImpact[];unaffected_active_task_ids:string[];
}
export interface AmendmentAnalysis {
 schema_version:1;proposal_digest:string;accepted:false;dispatch_authority:false;
 status:'STRUCTURALLY_VALID'|'INVALID';diagnostics:{code:string;task_key?:string}[];
 impact:AmendmentImpact;structural:DependencyReport;
}
interface InternalAnalysis {result:AmendmentAnalysis;prepared:Prepared;request:AmendmentRequest;tasks:ProposedDependencyTask[];prior:Record<string,any>;
 records:Record<string,any>[];specId:string;next:string;retiredIds:string[]}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POS=/^[1-9][0-9]{0,18}$/;
const ACCEPTED_WORK=['SUBMITTED','QUALIFYING','QUALIFIED','INTEGRATING','INTEGRATED'];
const IN_FLIGHT=['RESERVED','PREPARING','RUNNING',...ACCEPTED_WORK];
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
// Criteria reuse rule: an amended task keeps its accepted criteria identity only
// when every acceptance-relevant input is unchanged (requirement text, scenario
// definitions, command/artifacts and proof intent). Custody history is bound to
// that identity, so a real criteria change needs a new task identity.
function criteriaIntent(document:StoredIntent,section:KvxSection|undefined):string{
 const sections=new Map(document.parsed.sections.map(item=>[item.name,item]));
 const reqs=ids(section,'reqs').map(id=>{const split=id.lastIndexOf('.');return [id,sections.get('req.'+id.slice(0,split))?.fields['ac_'+id.slice(split+1)]?.value??null];});
 const scenarios=ids(section,'acceptance_ids').map(id=>{const item=sections.get('acceptance.'+id)??sections.get('case.'+id);return [id,item?semantic(item):null];});
 const proof=document.parsed.sections.filter(item=>item.name==='proof'||item.name.startsWith('proof.')).map(item=>[item.name,semantic(item)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 return canonical({reqs,scenarios,proof,verify_cmd:section?.fields.verify_cmd?.value??null,artifacts:section?.fields.artifacts?.value??null});
}
// Analysis shares the real dependency validator. It neither inserts accepted
// revisions nor changes task/compute/evidence authority.
async function analyse(tx:Tx,scope:SpecScope,input:unknown,storedSource?:Buffer):Promise<InternalAnalysis>{
 assertPrimaryTransaction(tx);await readSemanticDisposition(tx,scope);
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
 if(prepared.revision_digest===previous.revision_digest)note('AMENDMENT_NO_CHANGE');
 if(request.purpose==='REPLAN'){
  // Ordinary replans may decompose work but never narrow accepted coverage,
  // scenarios or the exact command/artifact pair a requirement was accepted with.
  const union=(sections:(KvxSection|undefined)[],key:string)=>new Set(sections.flatMap(section=>ids(section,key)));
  const oldSections=priorTasks.map(task=>task.definition.section as KvxSection|undefined),newSections=prepared.tasks.map(task=>task.section);
  for(const [key,code] of [['reqs','ACCEPTANCE_COVERAGE_CANNOT_BE_REMOVED'],['acceptance_ids','ACCEPTANCE_SCENARIOS_CANNOT_BE_REMOVED']] as const){
   const after=union(newSections,key);if([...union(oldSections,key)].some(id=>!after.has(id)))note(code);
  }
  for(const task of prepared.tasks){
   const old=priorByKey.get(task.key);
   if(old)for(const [key,code] of [['reqs','ACCEPTANCE_COVERAGE_CANNOT_BE_REMOVED'],['acceptance_ids','ACCEPTANCE_IDS_CANNOT_BE_NARROWED']] as const){
    const after=new Set(ids(task.section,key));if(ids(old.definition.section,key).some(id=>!after.has(id)))note(code,task.key);
   }
   for(const req of ids(task.section,'reqs')){
    const candidates=priorTasks.filter(candidate=>ids(candidate.definition.section,'reqs').includes(req));
    // The absence of an accepted command is itself accepted intent: adding,
    // removing or altering it needs an explicit operator intent change.
    if(candidates.length&&!candidates.some(candidate=>canonical(candidate.definition.section?.fields?.verify_cmd?.value??null)===canonical(task.section.fields.verify_cmd?.value??null)&&
     canonical(candidate.definition.section?.fields?.artifacts?.value??null)===canonical(task.section.fields.artifacts?.value??null)))
     note('ACCEPTED_TASK_CHECK_CANNOT_BE_WEAKENED',task.key);
   }
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
 const existingSpec=await tx.query('SELECT id FROM hyperfide.spec_revisions WHERE organisation_id=$1 AND project_id=$2 AND revision_digest=$3',[scope.organisation_id,scope.project_id,prepared.revision_digest]);
 const specId:string=existingSpec.rows[0]?.id??prepared.specId;
 const retiredIds=retired.map(key=>priorByKey.get(key)!.id);
 const existingIds=new Set(records.rows.map(task=>task.id as string));
 const active=(await tx.query(
  "SELECT t.id,t.task_key,t.state,t.spec_generation::text,"+
  "(SELECT count(*) FROM hyperfide.attempts a WHERE a.organisation_id=t.organisation_id AND a.run_id=t.run_id AND a.task_id=t.id AND a.compute_authority='CURRENT')::int AS current_compute,"+
  "(SELECT count(*) FROM hyperfide.submission_custodies c WHERE c.organisation_id=t.organisation_id AND c.run_id=t.run_id AND c.task_id=t.id AND c.authority='ACTIVE')::int AS active_custody,"+
  "(SELECT count(*) FROM hyperfide.submission_custodies c WHERE c.organisation_id=t.organisation_id AND c.run_id=t.run_id AND c.task_id=t.id AND c.authority='RELEASED')::int AS released_custody,"+
  "(SELECT count(*) FROM hyperfide.submission_custodies c WHERE c.organisation_id=t.organisation_id AND c.run_id=t.run_id AND c.task_id=t.id)::int AS custody_history,"+
  "(SELECT count(*) FROM hyperfide.evidence e JOIN hyperfide.attempts a ON a.organisation_id=e.organisation_id AND a.run_id=e.run_id AND a.id=e.attempt_id AND a.generation=e.attempt_generation WHERE e.organisation_id=t.organisation_id AND e.run_id=t.run_id AND a.task_id=t.id AND e.admission_state IN ('PENDING','ADMITTED'))::int AS live_evidence,"+
  "(SELECT count(*) FROM hyperfide.hierarchy_execution_packets p WHERE p.organisation_id=t.organisation_id AND p.run_id=t.run_id AND p.task_id=t.id AND p.spec_generation=t.spec_generation)::int AS current_packets "+
  "FROM hyperfide.tasks t WHERE t.organisation_id=$1 AND t.run_id=$2 AND (t.id=ANY($3::uuid[]) OR EXISTS(SELECT 1 FROM hyperfide.attempts a WHERE a.organisation_id=t.organisation_id AND a.run_id=t.run_id AND a.task_id=t.id AND a.compute_authority='CURRENT')) ORDER BY t.id LIMIT 50001",
  [scope.organisation_id,scope.run_id,[...affected].filter(id=>existingIds.has(id))])).rows;
 const revalidation:ActiveTaskImpact[]=active.filter(task=>affected.has(task.id)).map(task=>({task_id:task.id,task_key:task.task_key,state:task.state,spec_generation:task.spec_generation,
  current_compute:task.current_compute,active_custody:task.active_custody,released_custody:task.released_custody,live_evidence:task.live_evidence,current_packets:task.current_packets,
  accepted_work:ACCEPTED_WORK.includes(task.state),disposition:task.current_compute>0?'FENCE_REQUIRED':retiredIds.includes(task.id)?'RETIRE':'REVALIDATE'}));
 const unaffected_active_task_ids=active.filter(task=>!affected.has(task.id)).map(task=>task.id as string);
 const tasks:ProposedDependencyTask[]=prepared.tasks.map(task=>{
  const old=priorByKey.get(task.key),affectedTask=!old||affected.has(old.id);
  return {id:old?.id??derivedId(scope.run_id+':task:'+task.key),task_key:task.key,run_id:scope.run_id,package_key:task.package_key,package_wave:task.wave,wave:task.wave,
   state:affectedTask?'PENDING':old.state,state_version:old?.state_version??'1',spec_generation:affectedTask?next:old.spec_generation,spec_revision_id:affectedTask?specId:old.spec_revision_id,
   criteria_digest:!affectedTask?old.criteria_digest:old&&criteriaIntent(previous,old.definition.section)===criteriaIntent(prepared.document,task.section)?old.criteria_digest:
    digest(canonical({source_digest:prepared.document.source_digest,reqs:task.section.fields.reqs?.value??null})),
   definition:affectedTask?{schema_version:1,section:task.section,feature_key:task.feature_key,declared_wave:task.declared_wave,runtime_wave_offset:prepared.document.runtime_wave_offset,declared_status:task.section.fields.status?.value??null,history_only:true}:old.definition};
 });
 const history=new Map(active.map(task=>[task.id as string,task.custody_history as number]));
 for(const task of tasks){const old=priorByKey.get(task.task_key);
  if(old&&old.criteria_digest!==task.criteria_digest&&(history.get(old.id)??0)>0)note('CRITERIA_CHANGE_REQUIRES_NEW_IDENTITY',task.task_key);}
 const structural=await validateProposedDependencies(tx,{organisation_id:scope.organisation_id,run_id:scope.run_id},
  {run_id:scope.run_id,spec_revision_id:request.base_spec_revision_id,spec_generation:request.base_spec_generation,state_version:request.state_version},tasks);
 const proposal_digest=digest(canonical({schema_version:1,base_spec_revision_id:request.base_spec_revision_id,base_spec_generation:request.base_spec_generation,
  state_version:request.state_version,purpose:request.purpose,reason:request.reason,revision_digest:prepared.revision_digest}));
 return {request,prepared,tasks,prior:row,records:records.rows,specId,next,retiredIds,result:{schema_version:1,proposal_digest,accepted:false,dispatch_authority:false,
  status:diagnostics.length||structural.status==='INVALID'?'INVALID':'STRUCTURALLY_VALID',diagnostics,
  impact:{added,changed,retired,affected_task_ids:[...affected].sort(),global_intent_changed,external_dependents,revalidation,unaffected_active_task_ids},structural}};
}
export async function validateSpecAmendment(tx:Tx,scope:SpecScope,input:unknown):Promise<AmendmentAnalysis>{
 return (await analyse(tx,scope,input)).result;
}
function bounded(result:AmendmentAnalysis):unknown{
 const {edges,...structural}=result.structural;
 return {...result,impact:{...result.impact,added:result.impact.added.slice(0,128),changed:result.impact.changed.slice(0,128),retired:result.impact.retired.slice(0,128),
  affected_task_ids:result.impact.affected_task_ids.slice(0,128),external_dependents:result.impact.external_dependents.slice(0,128),
  revalidation:result.impact.revalidation.slice(0,128),unaffected_active_task_ids:result.impact.unaffected_active_task_ids.slice(0,128),
  counts:{added:result.impact.added.length,changed:result.impact.changed.length,retired:result.impact.retired.length,affected:result.impact.affected_task_ids.length,external:result.impact.external_dependents.length,
   revalidation:result.impact.revalidation.length,unaffected_active:result.impact.unaffected_active_task_ids.length}},structural};
}
async function scopeOf(tx:Tx,context:ComponentContext,invocation:InvocationContext):Promise<SpecScope>{
 const p=invocation.principal,row=(await tx.query('SELECT project_id,authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[p.organisation_id,p.run_id])).rows[0];
 if(!row||!context.env.HF_SPEC_ALLOWED_ROOT)fail('SPEC_CONFIG_INVALID','Trusted source root and current accepted run are required');
 return {organisation_id:p.organisation_id,project_id:row.project_id,run_id:p.run_id,authority_epoch:row.authority_epoch,root:context.env.HF_SPEC_ALLOWED_ROOT,allowed_actions:p.allowed_actions};
}
function actorOf(invocation:InvocationContext):{actor_id:string;role:string;credential_id:string}{
 const p=invocation.principal;return {actor_id:p.actor_id,role:p.role,credential_id:p.credential_id};
}
async function decide(tx:Tx,scope:SpecScope,amendment_id:string,record:Record<string,unknown>):Promise<Record<string,unknown>>{
 const decision_digest=digest(canonical(record));
 const inserted=await tx.query('INSERT INTO hyperfide.spec_amendment_decisions(organisation_id,run_id,amendment_id,decision,decision_digest,decision_record) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organisation_id,run_id,amendment_id) DO NOTHING RETURNING decision',
  [scope.organisation_id,scope.run_id,amendment_id,record.decision,decision_digest,JSON.stringify(record)]);
 if(inserted.rows.length!==1)fail('AMENDMENT_ALREADY_DECIDED','Amendment decision is immutable once recorded');
 return {...record,decision_digest,replayed:false};
}
async function record(tx:Tx,scope:SpecScope,invocation:InvocationContext,analysis:InternalAnalysis):Promise<unknown>{
 const actor=actorOf(invocation);
 const session=(await tx.query('SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,actor.actor_id])).rows[0]?.id??null;
 const proposal={schema_version:1,request:analysis.request,source_content:analysis.prepared.source.text,revision_digest:analysis.prepared.revision_digest,
  proposer:{...actor,session_id:session},justification:analysis.request.reason};
 if(Buffer.byteLength(canonical(proposal),'utf8')>67108864||Buffer.byteLength(canonical(analysis.result.impact),'utf8')>4194304)
  fail('AMENDMENT_STORAGE_LIMIT','Immutable proposal exceeds bounded storage');
 const id=derivedId(scope.run_id+':amendment:'+analysis.result.proposal_digest);
 await tx.query('INSERT INTO hyperfide.spec_amendments(organisation_id,run_id,id,base_spec_generation,base_spec_revision_id,base_state_version,proposal_digest,proposer_session_id,proposal,impact) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(organisation_id,run_id,proposal_digest) DO NOTHING',
  [scope.organisation_id,scope.run_id,id,analysis.request.base_spec_generation,analysis.request.base_spec_revision_id,analysis.request.state_version,analysis.result.proposal_digest,session,JSON.stringify(proposal),JSON.stringify(analysis.result.impact)]);
 const prior=(await tx.query('SELECT decision,decision_digest,decision_record FROM hyperfide.spec_amendment_decisions WHERE organisation_id=$1 AND run_id=$2 AND amendment_id=$3',[scope.organisation_id,scope.run_id,id])).rows[0];
 // Invalid analyses are retained as immutable provenance with an explicit refusal, never as open proposals.
 if(!prior&&analysis.result.status==='INVALID')await decide(tx,scope,id,{schema_version:1,decision:'REJECTED',amendment_id:id,proposal_digest:analysis.result.proposal_digest,
  actor,reason:'AMENDMENT_INVALID',diagnostics:analysis.result.diagnostics,structural_diagnostics:analysis.result.structural.diagnostics.map(item=>({code:item.code,task_key:item.task_key??null}))});
 const decision=prior?.decision??(analysis.result.status==='INVALID'?'REJECTED':'PROPOSED');
 return {...bounded(analysis.result) as object,amendment_id:id,decision,proposer_session_id:session};
}
interface AdmitRequest {run_id:string;amendment_id:string;proposal_digest:string;revalidate_task_ids:string[];justification:string;proof_policies:{task_key:string;policy:unknown}[]}
function admitRequestOf(input:unknown,scope:SpecScope):AdmitRequest{
 const keys=['run_id','amendment_id','proposal_digest','revalidate_task_ids','justification','proof_policies'];
 if(!object(input)||Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||input.run_id!==scope.run_id||
 typeof input.amendment_id!=='string'||!UUID.test(input.amendment_id)||typeof input.proposal_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(input.proposal_digest)||
 !Array.isArray(input.revalidate_task_ids)||input.revalidate_task_ids.length>50000||input.revalidate_task_ids.some(id=>typeof id!=='string'||!UUID.test(id))||
 new Set(input.revalidate_task_ids).size!==input.revalidate_task_ids.length||
 typeof input.justification!=='string'||input.justification.trim().length<1||input.justification.length>4096||input.justification.includes('\0')||
 !Array.isArray(input.proof_policies)||input.proof_policies.length>50000||input.proof_policies.some(item=>!object(item)||Object.keys(item).length!==2||
  typeof item.task_key!=='string'||!item.task_key||!object(item.policy))||new Set(input.proof_policies.map(item=>(item as {task_key:string}).task_key)).size!==input.proof_policies.length)
  fail('AMENDMENT_INPUT_INVALID','Exact proposal identity, explicit revalidation set, justification and proof policies are required');
 return input as unknown as AdmitRequest;
}
interface ValidityCapability {invalidateAcceptedSpec(db:Tx,scope:{organisation_id:string;run_id:string},taskIds:string[],reason:string):Promise<number>}
const isValidity=(value:unknown):value is ValidityCapability=>object(value)&&typeof value.invalidateAcceptedSpec==='function';
function proofDeadline(context:ComponentContext):number{
 const raw=context.env.HF_PROOF_MAX_CHECK_MS??'3600000';
 if(!/^[1-9][0-9]{0,8}$/.test(raw)||Number(raw)<100||Number(raw)>259200000)fail('PROOF_CONFIG_INVALID','Trusted check deadline must be bounded between100ms and72hours');
 return Number(raw);
}
// Atomic admission: one primary transaction re-analyses the immutable proposal,
// opens a fenced PENDING_VALIDATION window, installs the next accepted
// generation, re-registers proof policy, invalidates affected evidence,
// re-admits the dependency graph and restores the prior run state.
async function admit(tx:Tx,context:ComponentContext,invocation:InvocationContext,scope:SpecScope,input:unknown):Promise<unknown>{
 const request=admitRequestOf(input,scope),actor=actorOf(invocation);
 const run=(await tx.query('SELECT state,state_version::text,spec_generation::text,spec_revision_id FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 AND project_id=$3 FOR UPDATE',
  [scope.organisation_id,scope.run_id,scope.project_id])).rows[0];
 if(!run)fail('SPEC_RUN_NOT_FOUND','Accepted run does not exist in this organisation');
 const stored=(await tx.query('SELECT id,proposal_digest,proposal FROM hyperfide.spec_amendments WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',
  [scope.organisation_id,scope.run_id,request.amendment_id])).rows[0];
 if(!stored||stored.proposal_digest!==request.proposal_digest)fail('AMENDMENT_NOT_FOUND','Exact immutable amendment proposal is required');
 const prior=(await tx.query('SELECT decision_digest,decision_record FROM hyperfide.spec_amendment_decisions WHERE organisation_id=$1 AND run_id=$2 AND amendment_id=$3',
  [scope.organisation_id,scope.run_id,request.amendment_id])).rows[0];
 if(prior)return {...prior.decision_record,decision_digest:prior.decision_digest,replayed:true};
 const proposal=stored.proposal as {request:AmendmentRequest;source_content:string};
 const analysis=await analyse(tx,scope,proposal.request,Buffer.from(proposal.source_content,'utf8'));
 if(analysis.result.proposal_digest!==stored.proposal_digest)fail('AMENDMENT_PROPOSAL_MISMATCH','Stored proposal no longer reproduces its immutable digest');
 const base={spec_revision_id:analysis.request.base_spec_revision_id,spec_generation:analysis.request.base_spec_generation,state_version:analysis.request.state_version};
 if(analysis.result.status==='INVALID')return decide(tx,scope,request.amendment_id,{schema_version:1,decision:'REJECTED',amendment_id:request.amendment_id,
  proposal_digest:stored.proposal_digest,actor,justification:request.justification,base,reason:'AMENDMENT_INVALID',diagnostics:analysis.result.diagnostics,
  structural_diagnostics:analysis.result.structural.diagnostics.map(item=>({code:item.code,task_key:item.task_key??null}))});
 if(analysis.request.purpose==='INTENT_CHANGE'&&invocation.principal.role!=='OPERATOR')fail('ACTION_DENIED','Intent changes require an explicit operator');
 const revalidation=analysis.result.impact.revalidation,required=new Set(revalidation.map(task=>task.task_id));
 if(required.size!==request.revalidate_task_ids.length||request.revalidate_task_ids.some(id=>!required.has(id)))
  fail('AMENDMENT_REVALIDATION_REQUIRED','Every affected accepted task must be named exactly for explicit revalidation');
 if(revalidation.some(task=>task.current_compute>0))
  fail('AMENDMENT_ACTIVE_COMPUTE','Affected tasks with current compute must be fenced by the scheduler before admission');
 const validity=context.dependencies.require('16.4','assurance.validity.v1',isValidity);
 const {next,specId,prepared}=analysis,org=scope.organisation_id,runId=scope.run_id;
 if(!(await tx.query('SELECT 1 FROM hyperfide.spec_revisions WHERE organisation_id=$1 AND id=$2',[org,specId])).rows.length)await tx.query(
  'INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,repository_id,git_object_id,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9)',
  [org,scope.project_id,specId,prepared.accepted.source_digest,prepared.source.text,JSON.stringify(prepared.document),prepared.input.provenance?.repository_id??null,prepared.input.provenance?.git_object_id??null,prepared.revision_digest]);
 await tx.query('INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$3,$4)',[org,runId,next,specId]);
 // Revalidation window: dispatch is fenced while the run is PENDING_VALIDATION; the
 // window is never visible outside this transaction.
 const opened=await tx.query("UPDATE hyperfide.runs SET spec_generation=$3,spec_revision_id=$4,policy_digest=$5,state='PENDING_VALIDATION',state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND state_version=$6 AND spec_generation=$7 RETURNING state_version::text",
  [org,runId,next,specId,digest(canonical({allowed_actions:prepared.accepted.allowed_actions,closure_policy:prepared.accepted.closure_policy})),base.state_version,base.spec_generation]);
 if(opened.rows.length!==1)fail('AMENDMENT_BASE_STALE','Accepted run changed before atomic admission');
 let stateVersion:string=opened.rows[0]!.state_version;
 const records=new Map(analysis.records.map(task=>[task.id as string,task]));
 const changedTasks=analysis.tasks.filter(task=>task.spec_generation===next);
 for(const task of changedTasks){
  const old=records.get(task.id);
  if(old){
   const state=IN_FLIGHT.includes(old.state)?'STALE':'PENDING';
   await tx.query('UPDATE hyperfide.tasks SET spec_generation=$4,spec_revision_id=$5,criteria_digest=$6,definition=$7,wave=$8,state=$9,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',
    [org,runId,task.id,next,specId,task.criteria_digest,JSON.stringify(task.definition),task.wave,state]);
  }else{
   let packageId=(await tx.query('SELECT id FROM hyperfide.feature_packages WHERE organisation_id=$1 AND run_id=$2 AND package_key=$3',[org,runId,task.package_key])).rows[0]?.id as string|undefined;
   if(!packageId){packageId=derivedId(runId+':package:'+task.package_key);
    await tx.query('INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,$4,$5)',[org,runId,packageId,task.package_key,task.package_wave]);}
   await tx.query("INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,spec_generation,criteria_digest,definition,wave,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING')",
    [org,runId,task.id,task.task_key,packageId,specId,next,task.criteria_digest,JSON.stringify(task.definition),task.wave]);
  }
 }
 // Retired identities keep their history in task_revisions and lose only dispatchable intent.
 for(const id of analysis.retiredIds){
  const old=records.get(id)!,section=old.definition.section as KvxSection;
  const definition={...old.definition,section:{...section,fields:Object.fromEntries(Object.entries(section.fields).filter(([key])=>key!=='requires'))},
   retirement:{schema_version:1,amendment_id:request.amendment_id,spec_generation:next,prior_spec_generation:old.spec_generation}};
  await tx.query("UPDATE hyperfide.tasks SET spec_generation=$4,spec_revision_id=$5,definition=$6,state='CANCELLED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",
   [org,runId,id,next,specId,JSON.stringify(definition)]);
 }
 const explicit=new Map(request.proof_policies.map(item=>[item.task_key,item.policy]));
 if([...explicit.keys()].some(key=>!changedTasks.some(task=>task.task_key===key)))fail('AMENDMENT_INPUT_INVALID','Proof policies may only name tasks in the new generation');
 const proofs:{task_id:string;registry_digest:string;source:'EXPLICIT'|'CARRIED_FORWARD'}[]=[];
 for(const task of changedTasks){
  let policy=explicit.get(task.task_key),source:'EXPLICIT'|'CARRIED_FORWARD'='EXPLICIT';
  if(policy===undefined){
   const old=records.get(task.id);
   const previous=old?(await tx.query('SELECT policy FROM hyperfide.proof_registries WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND spec_generation=$4',[org,runId,task.id,old.spec_generation])).rows[0]:undefined;
   if(!previous)fail('AMENDMENT_PROOF_REQUIRED','New or unregistered tasks need an explicit proof policy for the new generation');
   // Carried-forward policy is re-validated against the new accepted intent; changed checks fail closed.
   policy={...previous.policy,criteria_digest:task.criteria_digest,spec_revision_id:specId,spec_generation:next};source='CARRIED_FORWARD';
  }
  const registered=await registerProofPolicy(tx,{organisation_id:org,run_id:runId},{run_id:runId,task_id:task.id,spec_revision_id:specId,spec_generation:next,state_version:stateVersion,policy},false,proofDeadline(context));
  proofs.push({task_id:task.id,registry_digest:registered.registry_digest,source});
 }
 const revalidated=[...required].sort();
 const evidence=await tx.query("UPDATE hyperfide.evidence e SET admission_state='STALE',state_version=e.state_version+1 FROM hyperfide.attempts a WHERE e.organisation_id=$1 AND e.run_id=$2 AND a.organisation_id=e.organisation_id AND a.run_id=e.run_id AND a.id=e.attempt_id AND a.generation=e.attempt_generation AND a.task_id=ANY($3::uuid[]) AND e.admission_state IN ('PENDING','ADMITTED') RETURNING e.id",
  [org,runId,revalidated]);
 const assurance=await validity.invalidateAcceptedSpec(tx,{organisation_id:org,run_id:runId},revalidated,'Accepted amendment '+request.amendment_id+' installed spec generation '+next);
 const packets=revalidation.reduce((total,task)=>total+task.current_packets,0);
 let state=run.state as string;
 if(run.state!=='PENDING_VALIDATION'){
  const admitted=await admitDependencies(tx,{organisation_id:org,run_id:runId},{run_id:runId,spec_revision_id:specId,spec_generation:next,state_version:stateVersion},{exempt_task_ids:analysis.retiredIds});
  if(!admitted.admitted)fail('AMENDMENT_ADMISSION_INVALID','Amended plan failed atomic structural admission');
  stateVersion=admitted.state_version;state='READY';
  if(run.state!=='READY'){
   const restored=await tx.query("UPDATE hyperfide.runs SET state=$3,state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND state='READY' AND state_version=$4 RETURNING state_version::text",[org,runId,run.state,stateVersion]);
   if(restored.rows.length!==1)fail('AMENDMENT_BASE_STALE','Run changed inside the admission window');
   stateVersion=restored.rows[0]!.state_version;state=run.state;
  }
 }
 return decide(tx,scope,request.amendment_id,{schema_version:1,decision:'ACCEPTED',amendment_id:request.amendment_id,proposal_digest:stored.proposal_digest,
  purpose:analysis.request.purpose,actor,justification:request.justification,base,
  accepted:{spec_revision_id:specId,spec_generation:next,revision_digest:prepared.revision_digest,state_version:stateVersion,run_state:state},
  revalidated_task_ids:revalidated,criteria:changedTasks.map(task=>({task_id:task.id,disposition:!records.has(task.id)?'NEW':records.get(task.id)!.criteria_digest===task.criteria_digest?'RETAINED':'CHANGED'})),added:analysis.result.impact.added,retired_task_ids:[...analysis.retiredIds].sort(),
  unaffected_active_task_ids:analysis.result.impact.unaffected_active_task_ids,proof_registries:proofs,
  invalidation:{evidence_stale:evidence.rows.length,assurance_stale:assurance,packets_superseded:packets,released_custody_retained:revalidation.reduce((total,task)=>total+task.released_custody,0)},
  provenance:'PRIOR_GENERATIONS_AND_HISTORICAL_PASSES_RETAINED'});
}
export function createComponent(_startup:ComponentContext):Component{
 const action=(persist:boolean)=>async(input:unknown,context:ComponentContext)=>specTransaction(context,persist?'WRITE':'READ',async(tx,invocation)=>{
  if(!['OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR'].includes(invocation.principal.role))fail('ACTION_DENIED','Role cannot propose accepted-plan amendments');
  const scope=await scopeOf(tx,context,invocation),analysis=await analyse(tx,scope,input);
  if(analysis.request.purpose==='INTENT_CHANGE'&&invocation.principal.role!=='OPERATOR')fail('ACTION_DENIED','Intent changes require an explicit operator');
  return persist?record(tx,scope,invocation,analysis):bounded(analysis.result);
 });
 return {apiVersion:1,actions:{'spec.amendment.check':action(false),'spec.amendment.propose':action(true),
  'spec.amendment.admit':async(input:unknown,context:ComponentContext)=>specTransaction(context,'WRITE',async(tx,invocation)=>{
   if(!['OPERATOR','LEADER','COORDINATOR'].includes(invocation.principal.role))fail('ACTION_DENIED','Role cannot admit accepted-plan amendments');
   return admit(tx,context,invocation,await scopeOf(tx,context,invocation),input);
  })}};
}
