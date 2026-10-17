import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type pg from 'pg';
import {FoundationError} from '../policy/programme.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {bindScope,primaryClient,obj,keys,scope,uuid,values,hash,canonical,fail,config,repository,git,tx,currentRun,custody,reviewCoverage,prepareRemoteGate,executeRemote,snapshotRemote,restoreRemote,semanticDisposition,type Scope,type DB,type IntegrationConfig,type GateConfig,type AdmittedIntegrationWork} from './candidates.js';
const exec=promisify(execFile);
function semanticHold(error:unknown):void{
 if(error instanceof FoundationError)return;const code=(error as {code?:unknown})?.code;if(code==='ERR_MODULE_NOT_FOUND'||code==='MODULE_NOT_FOUND')return;throw error;
}
type Level='TASK'|'WAVE'|'PROGRAMME';
interface ScopeGate extends GateConfig {covers:string[];proof:{manifest_path:string;manifest_digest:string;registry_path:string;registry_digest:string;expected_assertion_ids:string[];case_ids:string[]}}
interface ClosurePolicy {wave_gates:ScopeGate[];programme_gates:ScopeGate[];required_acceptance_ids:string[];required_docs:boolean;end_to_end_ids?:string[];activation_rehearsal_ids?:string[]}
/** One explicit obligation of exactly one closure level; unmet obligations are reported, never inferred from lower levels. */
export interface ClosureObligation {level:Level;id:string;met:boolean;reason:string|null;detail?:unknown}
const PROGRAMME_OBLIGATION_KINDS=[['end_to_end_ids','end-to-end','END_TO_END'],['activation_rehearsal_ids','activation-rehearsal','ACTIVATION_REHEARSAL']] as const;
export function closurePolicy(c:IntegrationConfig):ClosurePolicy{
 const p=obj(c.closure);keys(p,['wave_gates','programme_gates','required_acceptance_ids','required_docs'],['end_to_end_ids','activation_rehearsal_ids']);
 if(!Array.isArray(p.wave_gates)||!p.wave_gates.length||!Array.isArray(p.programme_gates)||!p.programme_gates.length||!Array.isArray(p.required_acceptance_ids)||!p.required_acceptance_ids.length||p.required_acceptance_ids.some(x=>typeof x!=='string'||!/^V-[0-9]{3}$/.test(x))||new Set(p.required_acceptance_ids).size!==p.required_acceptance_ids.length||typeof p.required_docs!=='boolean')fail('CLOSURE_POLICY_INVALID','Explicit aggregate, acceptance and documentation policy required');
 for(const gates of [p.wave_gates,p.programme_gates]){
 const ids=new Set<string>();for(const raw of gates){const g=obj(raw);keys(g,['id','kind','argv','timeout_ms','covers','proof']);if(typeof g.id!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(g.id)||ids.has(g.id)||!['build','test'].includes(String(g.kind))||!Array.isArray(g.argv)||!g.argv.length||g.argv.some(x=>typeof x!=='string'||!x||x.includes('\0'))||!Number.isSafeInteger(g.timeout_ms)||Number(g.timeout_ms)<100||Number(g.timeout_ms)>900000||!Array.isArray(g.covers)||g.covers.some(x=>typeof x!=='string')||new Set(g.covers).size!==g.covers.length)fail('CLOSURE_POLICY_INVALID','Invalid registered scope gate');ids.add(g.id);{const proof=obj(g.proof);keys(proof,['manifest_path','manifest_digest','registry_path','registry_digest','expected_assertion_ids','case_ids']);if(typeof proof.manifest_path!=='string'||typeof proof.registry_path!=='string'||!Array.isArray(proof.expected_assertion_ids)||!proof.expected_assertion_ids.length||proof.expected_assertion_ids.some(x=>typeof x!=='string'||!x)||new Set(proof.expected_assertion_ids).size!==proof.expected_assertion_ids.length)fail('CLOSURE_POLICY_INVALID','Exact registered scope proof required');if(!Array.isArray(proof.case_ids)||!proof.case_ids.length||proof.case_ids.some(x=>typeof x!=='string'||!/^V-[0-9]{3}$/.test(x))||new Set(proof.case_ids).size!==proof.case_ids.length||g.kind==='test'&&canonical([...(proof.case_ids as string[])].sort())!==canonical([...(g.covers as string[])].sort()))fail('CLOSURE_POLICY_INVALID','Declared acceptance coverage must equal the exact registered full-case inventory');for(const key of ['manifest_digest','registry_digest'])if(typeof proof[key]!=='string'||!/^sha256:[a-f0-9]{64}$/.test(String(proof[key])))fail('CLOSURE_POLICY_INVALID','Pinned scope inputs required');}}
 }
 for(const [field] of PROGRAMME_OBLIGATION_KINDS){
  const ids=p[field];if(ids===undefined)continue;
  // Specified end-to-end and activation/rehearsal obligations must be registered full cases of a programme test gate.
  if(!Array.isArray(ids)||!ids.length||ids.some(x=>typeof x!=='string'||!/^V-[0-9]{3}$/.test(x))||new Set(ids).size!==ids.length||ids.some(id=>!(p.programme_gates as Record<string,any>[]).some(g=>g.kind==='test'&&g.covers.includes(id))))fail('CLOSURE_POLICY_INVALID','Programme end-to-end and activation/rehearsal obligations must be covered by registered programme test gates');
 }
 return p as unknown as ClosurePolicy;
}
/** Programme-only end-to-end and activation/rehearsal obligations, satisfied only by current PASS programme receipts covering each case. */
export function programmeCaseObligations(policy:ClosurePolicy,receipts:Record<string,any>[],inputDigest:string):ClosureObligation[]{
 const obligations:ClosureObligation[]=[];
 for(const [field,name,code] of PROGRAMME_OBLIGATION_KINDS){
  const ids=policy[field]??[];
  obligations.push({level:'PROGRAMME',id:'programme.'+name+'-specified',met:ids.length>0,reason:ids.length?null:code+'_OBLIGATIONS_UNSPECIFIED'});
  for(const id of ids){
   const proven=policy.programme_gates.filter(g=>g.kind==='test'&&g.covers.includes(id)).some(gate=>{const receipt=receipts.find(r=>r.gate_id===gate.id);return receipt?.outcome==='PASS'&&receipt.input_manifest_digest===inputDigest&&Array.isArray(receipt.covered_ids)&&receipt.covered_ids.includes(id);});
   obligations.push({level:'PROGRAMME',id:'programme.'+name+':'+id,met:proven,reason:proven?null:code+'_UNPROVEN:'+id});
  }
 }
 return obligations;
}

async function registerClosurePolicy(db:DB,s:Scope,cfg:IntegrationConfig):Promise<void>{
 const run=await currentRun(db,s,true),policy=closurePolicy(cfg),policyDigest=hash(canonical(policy));
 await db.query('INSERT INTO hyperfide.integration_closure_policies(organisation_id,run_id,run_policy_digest,closure_policy_digest,policy) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[...values(s),run.policy_digest,policyDigest,policy]);
 const accepted=(await db.query('SELECT * FROM hyperfide.integration_closure_policies WHERE organisation_id=$1 AND run_id=$2 AND run_policy_digest=$3',[...values(s),run.policy_digest])).rows[0];
 if(!accepted||accepted.closure_policy_digest!==policyDigest||canonical(accepted.policy)!==canonical(policy))fail('CLOSURE_POLICY_CHANGED','Accepted immutable closure policy differs from trusted configuration');
}

export async function closureSnapshot(db:DB,s:Scope,level:Level,wave?:number,taskId?:string,admittedWork?:AdmittedIntegrationWork):Promise<Record<string,any>>{
 await semanticDisposition(db,s,'READ');const run=await currentRun(db,s,false,undefined,true,admittedWork);
 const closurePolicyRow=(await db.query('SELECT * FROM hyperfide.integration_closure_policies WHERE organisation_id=$1 AND run_id=$2 AND run_policy_digest=$3',[...values(s),run.policy_digest])).rows[0];if(!closurePolicyRow||hash(canonical(closurePolicyRow.policy))!==closurePolicyRow.closure_policy_digest)fail('CLOSURE_POLICY_UNAVAILABLE','Persisted current closure policy required');
 const tasks=(await db.query('SELECT id,task_key,state,state_version::text,generation::text,current_custody_id,criteria_digest,spec_generation::text,spec_revision_id,wave FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2'+(level==='TASK'?' AND id=$3':level==='WAVE'?' AND wave=$3':'')+' ORDER BY task_key',[...values(s),...(level==='TASK'?[taskId]:level==='WAVE'?[wave]:[])])).rows;
 if(tasks.length>10000)fail('CLOSURE_SCOPE_UNBOUNDED','Scope task count exceeds bounded10k inspection');if(!tasks.length)fail('CLOSURE_SCOPE_EMPTY','No tasks in declared closure scope');
 const publications=(await db.query("SELECT p.id,p.repository_id,p.candidate_id,p.candidate_head,p.observed_head,p.state,p.state_version::text,c.input_manifest_digest,m.manifest FROM hyperfide.publication_operations p JOIN hyperfide.integration_candidates c ON c.organisation_id=p.organisation_id AND c.run_id=p.run_id AND c.id=p.candidate_id JOIN hyperfide.integration_candidate_manifests m ON m.organisation_id=c.organisation_id AND m.run_id=c.run_id AND m.candidate_id=c.id WHERE p.organisation_id=$1 AND p.run_id=$2 ORDER BY p.repository_id,p.created_at,p.id",values(s))).rows;
 const repositories=(await db.query('SELECT repository_id,integration_ref FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 ORDER BY repository_id',values(s))).rows;
 const acceptances=(await db.query("SELECT a.operation_id,a.outcome FROM hyperfide.publication_acceptance_receipts a WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.outcome='ACCEPTED' ORDER BY a.operation_id,a.id",values(s))).rows;
 const findings:unknown[]=[]; // Canonical finding disposition is carried by findingObservations below.
 const barriers=level==='PROGRAMME'?(await db.query("SELECT id,manifest_digest,state,state_version::text FROM hyperfide.integration_release_barriers WHERE organisation_id=$1 AND run_id=$2 ORDER BY id",values(s))).rows:[];
 const proofInventory:Record<string,any>[]=[];
 const registryModule='../spec/obligations.js';
 for(const task of tasks){
  try{const loader=(await import(registryModule)).loadProofObligations;const proof=await loader(db,{...s,task_id:task.id,spec_generation:task.spec_generation,spec_revision_id:task.spec_revision_id});proofInventory.push({task_id:task.id,registry_digest:proof.registry_digest,criteria_digest:proof.criteria_digest,obligations:proof.obligations});}
  catch(error){semanticHold(error);proofInventory.push({task_id:task.id,unavailable:true});}
 }
 const assuranceObservations:Record<string,unknown>[]=[];
 const reviewObservations:Record<string,unknown>[]=[];
 const findingObservations:Record<string,unknown>[]=[];
 const assuranceModule='../assurance/coverage.js',reviewModule='../review/coverage.js',findingModule='../findings/registry.js';
 for(const publication of publications.filter(p=>p.state==='PUBLISHED'&&p.manifest.contributors.some((contributor:Record<string,any>)=>tasks.some(t=>t.id===contributor.task_id&&t.current_custody_id===contributor.custody_id)))){
  const manifest=publication.manifest;
  for(const contributor of manifest.contributors.filter((c:Record<string,any>)=>tasks.some(t=>t.id===c.task_id&&t.current_custody_id===c.custody_id))){
   try{const validityModule='../assurance/validity.js';const inspect=(await import(validityModule)).inspectValidity;
    const evidence=await inspect(db,s,contributor.custody_id);
    assuranceObservations.push({task_id:contributor.task_id,custody_id:contributor.custody_id,applicability:evidence.applicability,
     current:evidence.current_integrated_assurance===true&&evidence.proof_complete===true&&evidence.applicability==='CURRENT'&&evidence.proof_criteria_digest===tasks.find((t:Record<string,any>)=>t.id===contributor.task_id)?.criteria_digest,receipt_digest:evidence.receipt_digest??null,clauses:evidence.clauses??[],proof_complete:evidence.proof_complete===true});
   }catch(error){semanticHold(error);assuranceObservations.push({task_id:contributor.task_id,custody_id:contributor.custody_id,current:false,reason:'ASSURANCE_UNAVAILABLE'});}
  }

 }
 for(const repository of repositories){
  const publication=[...publications].reverse().find(p=>p.repository_id===repository.repository_id&&p.state==='PUBLISHED'&&p.observed_head===p.candidate_head);if(!publication){reviewObservations.push({repository_id:repository.repository_id,status:'INCOMPLETE',reason:'LATEST_PUBLICATION_MISSING'});continue;}
  try{const current=await reviewCoverage(db,s,publication.manifest,publication.input_manifest_digest,publication.candidate_id,'CURRENT_PUBLISHED');reviewObservations.push(...current.observations.map(o=>({...o,review_bindings_digest:current.digest})));}
  catch(error){semanticHold(error);reviewObservations.push({candidate_id:publication.candidate_id,repository_id:repository.repository_id,status:'INCOMPLETE',reason:'CURRENT_PUBLISHED_REVIEW_UNAVAILABLE'});}
 }
 for(const task of tasks.filter(t=>!assuranceObservations.some(a=>a.task_id===t.id))){
  try{const inspect=(await import(assuranceModule)).inspectCoverage;const evidence=await inspect(db,s,task.current_custody_id);assuranceObservations.push({task_id:task.id,custody_id:task.current_custody_id,applicability:evidence.applicability,current:evidence.proof_complete===true&&evidence.applicability==='CURRENT'&&evidence.proof_criteria_digest===task.criteria_digest,receipt_digest:evidence.receipt_digest??null,clauses:evidence.clauses??[],proof_complete:evidence.proof_complete===true});}
  catch(error){semanticHold(error);assuranceObservations.push({task_id:task.id,custody_id:task.current_custody_id,current:false,reason:'ASSURANCE_UNAVAILABLE'});}
 }
 for(const repository of repositories){
  try{const inspect=(await import(findingModule)).inspectBlockingFindings;findingObservations.push({repository_id:repository.repository_id,...await inspect(db,{...s,repository_id:repository.repository_id})});}
  catch(error){semanticHold(error);findingObservations.push({repository_id:repository.repository_id,clear:false,reason:'FINDINGS_UNAVAILABLE'});}
 }
 return {version:1,organisation_id:s.organisation_id,run_id:s.run_id,level,closure_policy_digest:closurePolicyRow.closure_policy_digest,closure_policy:closurePolicyRow.policy,wave:wave??null,task_id:taskId??null,spec_revision_id:run.spec_revision_id,spec_generation:String(run.spec_generation),policy_digest:run.policy_digest,authority_epoch:run.authority_epoch,tasks,publications,acceptances,repositories,findings,barriers,proofInventory,assuranceObservations,reviewObservations,findingObservations};
}
function parse(input:unknown):{s:Scope;level:Level;wave?:number;taskId?:string}{
 const v=obj(input);keys(v,['organisation_id','run_id','level'],['wave','task_id','reservation_id','session_id']);
 if(!['TASK','WAVE','PROGRAMME'].includes(String(v.level)))fail('CLOSURE_INVALID','Explicit level required');const level=v.level as Level;
 if(level==='TASK'){if(v.wave!==undefined)fail('CLOSURE_INVALID','Wave not valid for task scope');return {s:scope(v),level,taskId:uuid(v.task_id)};}
 if(v.task_id!==undefined)fail('CLOSURE_INVALID','Task ID not valid at aggregate scope');
 if(level==='WAVE'){if(!Number.isSafeInteger(v.wave)||Number(v.wave)<1)fail('CLOSURE_INVALID','Positive wave required');return {s:scope(v),level,wave:Number(v.wave)};}
 if(v.wave!==undefined)fail('CLOSURE_INVALID','Programme covers every wave');return {s:scope(v),level};
}
export async function evaluateClosure(pool:import('./candidates.js').DB,cfg:IntegrationConfig,input:unknown):Promise<unknown>{
 const p=parse(input);if(p.s.organisation_id!==cfg.organisation_id)fail('CLOSURE_SCOPE_DENIED','Wrong organisation');const policy=closurePolicy(cfg);
 return tx(pool,async db=>{
 await registerClosurePolicy(db,p.s,cfg);const m=await closureSnapshot(db,p.s,p.level,p.wave,p.taskId),inputDigest=hash(canonical(m)),obligations:ClosureObligation[]=[];let documentation:unknown=null;
 const prefix=p.level.toLowerCase(),need=(id:string,met:boolean,reason:string,detail?:unknown)=>{obligations.push({level:p.level,id:prefix+'.'+id,met,reason:met?null:reason,...(detail===undefined?{}:{detail})});};
 const receiptFor=(task:Record<string,any>)=>m.publications.find((pub:Record<string,any>)=>pub.state==='PUBLISHED'&&pub.observed_head===pub.candidate_head&&pub.manifest.contributors.some((c:Record<string,any>)=>c.task_id===task.id&&c.custody_id===task.current_custody_id));
 const accepted=(receipt:Record<string,any>|undefined)=>!!receipt&&m.acceptances.some((a:Record<string,any>)=>a.operation_id===receipt.id);
 for(const task of m.tasks){
  const receipt=receiptFor(task);
  if(p.level==='TASK'){
   // Task qualification is computed from current custody and later integration receipts only; attempt/coding leases are never consulted.
   if(task.state==='INTEGRATED'){need('integration-receipt:'+task.task_key,!!receipt,'TASK_INTEGRATION_RECEIPT_MISSING:'+task.task_key);need('accepted-candidate:'+task.task_key,accepted(receipt),'ACCEPTED_CANDIDATE_MISSING:'+task.task_key);}
   else if(task.current_custody_id){let current=true;try{await custody(db,p.s,task.current_custody_id);}catch(error){semanticHold(error);current=false;}need('current-custody:'+task.task_key,current,'TASK_QUALIFICATION_STALE:'+task.task_key,{custody_id:task.current_custody_id});}
   else need('current-custody:'+task.task_key,false,'TASK_CUSTODY_MISSING:'+task.task_key);
  }else{
   need('task-integrated:'+task.task_key,task.state==='INTEGRATED','TASK_NOT_INTEGRATED:'+task.task_key);
   need('integration-receipt:'+task.task_key,!!receipt,'TASK_INTEGRATION_RECEIPT_MISSING:'+task.task_key);
   need('accepted-candidate:'+task.task_key,accepted(receipt),'ACCEPTED_CANDIDATE_MISSING:'+task.task_key,receipt?{operation_id:receipt.id,candidate_id:receipt.candidate_id}:undefined);
  }
 }
 need('proof-registry',!m.proofInventory.some((r:Record<string,any>)=>r.unavailable===true),'ACCEPTED_PROOF_REGISTRY_UNAVAILABLE');
 for(const registration of m.proofInventory){
  const assurance=m.assuranceObservations.find((a:Record<string,any>)=>a.task_id===registration.task_id);
  for(const obligation of registration.obligations??[])need('criterion:'+obligation.clause_id,!!assurance?.clauses?.some((clause:Record<string,any>)=>clause.id===obligation.clause_id&&clause.satisfied===true),'ACCEPTED_CLAUSE_UNPROVEN:'+obligation.clause_id);
 }
 for(const task of m.tasks){const observed=m.assuranceObservations.filter((a:Record<string,any>)=>a.task_id===task.id);need('criteria-current:'+task.task_key,observed.length>0&&observed.every((a:Record<string,any>)=>a.current===true),'INTEGRATED_ASSURANCE_STALE',observed.map((a:Record<string,any>)=>a.reason??a.applicability??null));}
 for(const repository of m.repositories){const observed=m.reviewObservations.filter((r:Record<string,any>)=>r.repository_id===repository.repository_id||r.repository_id===undefined);need('reviews-current:'+repository.repository_id,observed.length>0&&observed.every((r:Record<string,any>)=>r.status==='COMPLETE'),'INTEGRATED_REVIEW_STALE',observed.filter((r:Record<string,any>)=>r.status!=='COMPLETE').map((r:Record<string,any>)=>r.reason??r.status??null));}
 for(const finding of m.findingObservations){const blockers=Array.isArray(finding.blockers)?finding.blockers:[];need('blocking-findings:'+finding.repository_id,finding.clear===true,blockers.length?'BLOCKING_FINDING_OPEN:'+finding.repository_id:'CURRENT_FINDING_DISPOSITION_UNAVAILABLE',blockers.map((b:Record<string,any>)=>({finding_id:b.finding_id??null,observation_id:b.observation_id??null,reason:b.reason??null})));}
 need('publications-settled',!m.publications.some((r:Record<string,any>)=>['PENDING','RUNNING','OUTCOME_UNKNOWN'].includes(r.state)),'PUBLICATION_UNCERTAIN');
 const waveStatuses:Record<string,unknown>[]=[];
 if(p.level!=='TASK'){
  const gates=p.level==='WAVE'?policy.wave_gates:policy.programme_gates;
  const receipts=(await db.query("SELECT r.* FROM hyperfide.integration_scope_receipts r JOIN hyperfide.integration_scope_jobs j ON j.organisation_id=r.organisation_id AND j.run_id=r.run_id AND j.id=r.job_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.level=$3 AND r.wave IS NOT DISTINCT FROM $4 AND j.state='SUCCEEDED' ORDER BY r.created_at DESC,r.id DESC",[...values(p.s),p.level,p.wave??null])).rows;
  for(const gate of gates){const receipt=receipts.find(r=>r.gate_id===gate.id);need('gate:'+gate.id,!!receipt&&receipt.outcome==='PASS'&&receipt.input_manifest_digest===inputDigest,'AGGREGATE_GATE_NOT_CURRENT:'+gate.id);}
  if(p.level==='PROGRAMME'){
   const covers=new Set(gates.filter(g=>g.kind==='test').flatMap(g=>g.covers));
   const required=new Set<string>(m.proofInventory.flatMap((r:Record<string,any>)=>(r.obligations??[]).flatMap((o:Record<string,any>)=>o.acceptance_ids??[])));
   need('acceptance-inventory',required.size>0,'ACCEPTED_ACCEPTANCE_INVENTORY_EMPTY');
   for(const id of required)need('acceptance-mapped:'+id,covers.has(id),'ACCEPTANCE_UNMAPPED:'+id);
   need('acceptance-inventory-current',canonical([...required].sort())===canonical([...policy.required_acceptance_ids].sort()),'ACCEPTED_ACCEPTANCE_INVENTORY_MISMATCH');
   obligations.push(...programmeCaseObligations(policy,receipts,inputDigest));
   let docsCurrent=false,docsReason='DOCUMENTATION_CLOSURE_UNAVAILABLE';
   try{const integratedDigest=integratedManifestDigest(m);const docsModule='../docs/closure.js';const inspect=(await import(docsModule)).inspectDocumentationClosure;const docs=await inspect(db,p.s,{spec_revision_id:m.spec_revision_id,spec_generation:m.spec_generation,programme_manifest_digest:integratedDigest,source_manifest_digest:integratedDigest});documentation=docs;docsCurrent=docs.status==='CURRENT'&&docs.closed===true&&docs.source_manifest_digest===integratedDigest;docsReason='DOCUMENTATION_CLOSURE_NOT_CURRENT';}
   catch(error){semanticHold(error);}
   need('documentation',docsCurrent,docsReason);
   for(const repository of m.repositories)need('repository-published:'+repository.repository_id,m.publications.some((r:Record<string,any>)=>r.repository_id===repository.repository_id&&r.state==='PUBLISHED'),'REPOSITORY_NOT_PUBLISHED:'+repository.repository_id);
   need('release-barrier',m.barriers.some((b:Record<string,any>)=>b.state==='RELEASED'),'RELEASE_BARRIER_HELD');
   // Programme closure requires each wave's own current PASS evaluation; passing tasks never stand in for a closed wave.
   for(const wave of [...new Set<number>(m.tasks.map((t:Record<string,any>)=>Number(t.wave)))].sort((a,b)=>a-b)){
    const waveDigest=hash(canonical(await closureSnapshot(db,p.s,'WAVE',wave)));
    const closed=(await db.query("SELECT 1 FROM hyperfide.integration_closure_evaluations WHERE organisation_id=$1 AND run_id=$2 AND level='WAVE' AND wave=$3 AND input_manifest_digest=$4 AND outcome='PASS' LIMIT 1",[...values(p.s),wave,waveDigest])).rowCount!>0;
    waveStatuses.push({wave,closed,input_manifest_digest:waveDigest});need('wave-closed:'+wave,closed,'WAVE_NOT_CLOSED:'+wave);
   }
  }
 }
 const unmet=obligations.filter(o=>!o.met),reasons=[...new Set(unmet.map(o=>o.reason!))],outcome=unmet.length?'HELD':'PASS',id=randomUUID();
 const taskStatuses=m.tasks.map((t:Record<string,any>)=>{const receipt=receiptFor(t);return {task_id:t.id,task_key:t.task_key,wave:t.wave,state:t.state,milestone:t.state==='INTEGRATED'&&accepted(receipt)?'INTEGRATED':['QUALIFIED','INTEGRATING','INTEGRATED'].includes(t.state)?'QUALIFIED':null};});
 const dependencyRelease=await dependentRelease(db,p.s,m.tasks.map((t:Record<string,any>)=>String(t.id)));
 const status={level:p.level,outcome,wave:p.wave??null,task_id:p.taskId??null,obligation_count:obligations.length,unmet_obligations:unmet.map(o=>o.id),lower_levels_complete:p.level==='TASK'?null:taskStatuses.every((t:Record<string,any>)=>t.milestone==='INTEGRATED'),closes_higher_levels:false};
 const evaluation={...m,documentation,input_manifest_digest:inputDigest,reasons,scope:p.level,outcome,status,obligations,unmet_obligations:unmet,task_statuses:taskStatuses,wave_statuses:waveStatuses,dependency_release:dependencyRelease,task_qualified:p.level==='TASK'&&outcome==='PASS',wave_closed:p.level==='WAVE'&&outcome==='PASS',programme_qualified:p.level==='PROGRAMME'&&outcome==='PASS',downstream_release_authorized:p.level==='WAVE'&&outcome==='PASS',external_activation_authorized:false};
 await db.query('INSERT INTO hyperfide.integration_closure_evaluations(organisation_id,run_id,id,level,wave,input_manifest_digest,outcome,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[...values(p.s),id,p.level,p.wave??null,inputDigest,outcome,evaluation]);return {evaluation_id:id,...evaluation};
 });
}
/** Reports, with the scheduler's own claim barrier, whether each dependent of the scoped tasks is released at its declared milestone. */
async function dependentRelease(db:DB,s:Scope,taskIds:string[]):Promise<Record<string,unknown>[]>{
 const dependents=(await db.query('SELECT DISTINCT d.run_id,d.task_id,t.task_key,t.wave,d.predecessor_task_id,d.milestone FROM hyperfide.task_dependencies d JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.run_id AND t.id=d.task_id AND t.spec_generation=d.revision WHERE d.organisation_id=$1 AND d.predecessor_run_id=$2 AND d.predecessor_task_id=ANY($3::uuid[]) ORDER BY d.run_id,d.task_id,d.predecessor_task_id,d.milestone LIMIT 10001',[s.organisation_id,s.run_id,taskIds])).rows;
 if(dependents.length>10000)fail('CLOSURE_SCOPE_UNBOUNDED','Dependent release inspection exceeds bounded10k edges');
 let barrier:((tx:DB,scope:Scope,task:string,wave:number)=>Promise<void>)|undefined;
 try{const schedulerModule='../scheduler/claim.js';barrier=(await import(schedulerModule)).requireTaskBarriers;}catch(error){semanticHold(error);}
 const verdicts=new Map<string,{released:boolean;code:string|null}>();
 for(const edge of dependents){
  const key=edge.run_id+':'+edge.task_id;if(verdicts.has(key))continue;
  if(typeof barrier!=='function'){verdicts.set(key,{released:false,code:'DEPENDENCY_RELEASE_UNAVAILABLE'});continue;}
  try{await barrier(db,{organisation_id:s.organisation_id,run_id:edge.run_id},edge.task_id,Number(edge.wave));verdicts.set(key,{released:true,code:null});}
  catch(error){semanticHold(error);verdicts.set(key,{released:false,code:String((error as {code?:unknown}).code??'DEPENDENCY_RELEASE_HELD')});}
 }
 return dependents.map(edge=>({run_id:edge.run_id,task_id:edge.task_id,task_key:edge.task_key,predecessor_task_id:edge.predecessor_task_id,milestone:edge.milestone,...verdicts.get(edge.run_id+':'+edge.task_id)!}));
}
export function integratedRepositoryManifest(snapshot:Record<string,any>):Record<string,string>[]{
 return snapshot.repositories.map((repository:Record<string,any>)=>{
 const receipt=[...snapshot.publications].reverse().find((p:Record<string,any>)=>p.repository_id===repository.repository_id&&p.state==='PUBLISHED'&&p.observed_head===p.candidate_head);
 if(!receipt)fail('CLOSURE_INPUT_INCOMPLETE','No exact published repository revision');
 return {repository_id:repository.repository_id,candidate_head:receipt.candidate_head,input_manifest_digest:receipt.input_manifest_digest};
 }).sort((a:Record<string,string>,b:Record<string,string>)=>a.repository_id!.localeCompare(b.repository_id!));
}
export function integratedManifestDigest(snapshot:Record<string,any>):string{return hash(canonical(integratedRepositoryManifest(snapshot)));}
export const integrationGit=git;
async function proofFile(root:string,name:string):Promise<Buffer>{
 if(path.isAbsolute(name)||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..'))fail('SCOPE_EVIDENCE_UNAVAILABLE','Unsafe scope proof input');
 const filename=path.join(root,name);if(await fs.realpath(filename)!==filename)fail('SCOPE_EVIDENCE_UNAVAILABLE','Symlinked proof input');
 const info=await fs.lstat(filename);if(!info.isFile()||info.size>4*1024*1024)fail('SCOPE_EVIDENCE_UNAVAILABLE','Proof input missing or unbounded');
 return fs.readFile(filename);
}
export async function registeredScopeGate(gate:ScopeGate,cwd:string,work:string,inputDigest:string,env:Readonly<NodeJS.ProcessEnv>,requireFull=true):Promise<{stdout:string;stderr:string;exitCode:number;assertions:number;proof:Record<string,unknown>}>{
 const p=gate.proof;if(!p)fail('SCOPE_EVIDENCE_UNAVAILABLE','Registered full-case proof required');
 const manifestBytes=await proofFile(cwd,p.manifest_path),registryBytes=await proofFile(cwd,p.registry_path);
 if(hash(manifestBytes)!==p.manifest_digest||hash(registryBytes)!==p.registry_digest)fail('SCOPE_EVIDENCE_UNAVAILABLE','Scope input pin mismatch');
 const manifest=obj(JSON.parse(manifestBytes.toString('utf8')));
 if(!(requireFull?['full-case','campaign']:['task-component','full-case','campaign']).includes(String(manifest.scope))||canonical(manifest.expected_assertion_ids)!==canonical(p.expected_assertion_ids))fail('SCOPE_EVIDENCE_UNAVAILABLE','Full registered inventory required');
 const cases=gate.covers.filter(id=>id!=='@docs').sort();
 if(!cases.length||canonical([...(manifest.case_ids as string[])].sort())!==canonical(cases))fail('SCOPE_EVIDENCE_UNAVAILABLE','Gate coverage does not match registered full cases');
 if(gate.covers.includes('@docs'))fail('SCOPE_EVIDENCE_UNAVAILABLE','Documentation requires durable documentation closure authority');
 const harnessRoot=env.HYPERFIDE_QUALIFICATION_ROOT;
 if(!harnessRoot||!path.isAbsolute(harnessRoot))fail('SCOPE_EVIDENCE_UNAVAILABLE','Qualified canonical harness root required');
 const runner=path.join(harnessRoot,'tests/hyperfide/qualify.py'),checker=path.join(harnessRoot,'tests/hyperfide/check-evidence.py');
 if(hash(await fs.readFile(runner))!==env.HYPERFIDE_QUALIFIER_DIGEST||hash(await fs.readFile(checker))!==env.HYPERFIDE_CHECKER_DIGEST)fail('SCOPE_EVIDENCE_UNAVAILABLE','Canonical runner/checker release pins required');
 let sourceManifestDigest:string|undefined;if(requireFull){const scopeFile=env.HYPERFIDE_SCOPE_MANIFEST;if(!scopeFile)fail('SCOPE_EVIDENCE_UNAVAILABLE','Exact multi-repository source manifest required');sourceManifestDigest=integratedManifestDigest(obj(JSON.parse(await fs.readFile(scopeFile,'utf8'))));}manifest.policy={...obj(manifest.policy),integration_scope_digest:inputDigest,...(sourceManifestDigest?{source_manifest_digest:sourceManifestDigest}:{})};
 manifest.campaign_id=String(manifest.campaign_id)+'-'+inputDigest.slice(7,23);
 const output=path.join(work,'proof-'+gate.id),manifestPath=path.join(work,'manifest-'+gate.id+'.json');
 await fs.writeFile(manifestPath,canonical(manifest)+'\n',{mode:0o600});
 const cleanEnv={PATH:env.PATH,HOME:'/nonexistent',CI:'1',HYPERFIDE_SCOPE_DIGEST:inputDigest};
 const result=await exec('python3',[runner,'--root',cwd,'--registry',path.join(cwd,p.registry_path),'--manifest',manifestPath,'--output-dir',output,...cases.flatMap(id=>['--case',id])],{cwd,timeout:gate.timeout_ms,maxBuffer:1048576,encoding:'utf8',env:cleanEnv});
 const summary=obj(JSON.parse(result.stdout.trim().split('\n').at(-1)!));
 if(summary.status!=='PASS'||requireFull&&summary.full_case_status!=='PASS'||!(requireFull?['full-case','campaign']:['task-component','full-case','campaign']).includes(String(summary.scope))||typeof summary.receipt_id!=='string')fail('SCOPE_EVIDENCE_UNAVAILABLE','Canonical full-case execution did not pass');
 const checked=await exec('python3',[checker,'--campaign',output,'--receipt',summary.receipt_id],{cwd,timeout:60000,maxBuffer:1048576,encoding:'utf8',env:cleanEnv});
 const inspection=obj(JSON.parse(checked.stdout));if(inspection.checked!==true||inspection.observed_outcome!=='PASS'||requireFull&&inspection.full_case_status!=='PASS')fail('SCOPE_EVIDENCE_UNAVAILABLE','Independent canonical check refused');
 const receipt=obj(JSON.parse(await fs.readFile(path.join(output,'receipts',summary.receipt_id+'.json'),'utf8')));
 if(canonical(receipt.expected_assertion_ids)!==canonical(p.expected_assertion_ids)||!Array.isArray(receipt.assertions)||receipt.assertions.length!==p.expected_assertion_ids.length)fail('SCOPE_EVIDENCE_UNAVAILABLE','Registered assertion denominator mismatch');
 const bundle:Record<string,string>={};let bytes=0;
 async function collect(directory:string):Promise<void>{
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
   const filename=path.join(directory,entry.name);if(entry.isSymbolicLink())fail('SCOPE_EVIDENCE_UNAVAILABLE','Proof artifact symlink rejected');
   if(entry.isDirectory())await collect(filename);
   else if(entry.isFile()){const content=await fs.readFile(filename);bytes+=content.length;if(bytes>8*1024*1024)fail('SCOPE_EVIDENCE_UNAVAILABLE','Scope proof exceeds bounded primary evidence store; durable object archive required');bundle[path.relative(output,filename)]=content.toString('base64');}
   else fail('SCOPE_EVIDENCE_UNAVAILABLE','Nonregular proof artifact rejected');
  }
 }
 await collect(output);
 return {stdout:result.stdout+'\n'+checked.stdout,stderr:result.stderr+'\n'+checked.stderr,exitCode:0,assertions:receipt.assertions.length,proof:{scope_digest:inputDigest,template_digest:p.manifest_digest,registry_digest:p.registry_digest,receipt_id:summary.receipt_id,checker_digest:env.HYPERFIDE_CHECKER_DIGEST,bundle_digest:hash(canonical(bundle)),files:bundle}};
}
async function verifyScope(pool:import('./candidates.js').DB,cfg:IntegrationConfig,_env:Readonly<NodeJS.ProcessEnv>,input:unknown):Promise<unknown>{
 const parsed=obj(input),p=parse(input);if(p.level==='TASK')fail('CLOSURE_INVALID','Task proof belongs to custody qualification');
 const session=uuid(parsed.session_id),reservation=uuid(parsed.reservation_id),policy=closurePolicy(cfg),gates=p.level==='WAVE'?policy.wave_gates:policy.programme_gates;
 const prepared=await tx(pool,async db=>{
  await registerClosurePolicy(db,p.s,cfg);const snapshot=await closureSnapshot(db,p.s,p.level,p.wave),inputDigest=hash(canonical(snapshot));
  if(snapshot.tasks.some((t:Record<string,any>)=>t.state!=='INTEGRATED')||snapshot.publications.some((r:Record<string,any>)=>['PENDING','RUNNING','OUTCOME_UNKNOWN'].includes(r.state)))fail('CLOSURE_INPUT_INCOMPLETE','Scope is not fully integrated');
  const primary=snapshot.repositories[0]?.repository_id;if(!primary)fail('CLOSURE_SCOPE_EMPTY','No scope repository');
  const active=(await db.query("SELECT id,state FROM hyperfide.integration_scope_jobs WHERE organisation_id=$1 AND run_id=$2 AND level=$3 AND wave IS NOT DISTINCT FROM $4 AND state IN ('RUNNING','OUTCOME_UNKNOWN') FOR UPDATE",[...values(p.s),p.level,p.wave??null])).rows[0];if(active)return {existing_job_id:String(active.id),state:String(active.state)};
  const held=await db.query("SELECT 1 FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='ALLOCATED' AND attempt_id IS NULL AND quantity>0 AND expires_at>clock_timestamp() FOR UPDATE",[...values(p.s),reservation]);if(!held.rowCount)fail('CLOSURE_RESERVATION_REQUIRED','Separate integration resource reservation required');
  const id=randomUUID(),plans=[];
  for(const gate of gates)plans.push({gate,remote:await prepareRemoteGate(db,p.s,{session_id:session,reservation_id:reservation,repository_id:primary,input_digest:inputDigest,policy_digest:snapshot.policy_digest,gate,mode:p.level as 'WAVE'|'PROGRAMME',snapshot})});
  await db.query("INSERT INTO hyperfide.integration_scope_jobs(organisation_id,run_id,id,executor_id,reservation_id,level,wave,input_manifest_digest,state,execution_manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RUNNING',$9)",[...values(p.s),id,session,reservation,p.level,p.wave??null,inputDigest,{snapshot,plans:plans.map(p=>({gate:p.gate,remote:snapshotRemote(p.remote)}))}]);
  return {id,snapshot,inputDigest,plans};
 });
 if('existing_job_id' in prepared)return {job_id:prepared.existing_job_id,state:prepared.state,recovery_required:true,redispatched:false};
 return executeScopeJob(pool,p,prepared);
}
async function executeScopeJob(pool:DB,p:ReturnType<typeof parse>,prepared:{id:string;snapshot:Record<string,any>;inputDigest:string;plans:{gate:ScopeGate;remote:Awaited<ReturnType<typeof prepareRemoteGate>>}[]}):Promise<unknown>{
 const results:Record<string,unknown>[]=[];
 for(const plan of prepared.plans){
  const existing=(await pool.query('SELECT outcome,id FROM hyperfide.integration_scope_receipts WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 AND gate_id=$4',[...values(p.s),prepared.id,plan.gate.id])).rows[0];if(existing){results.push({receipt_id:existing.id,gate_id:plan.gate.id,outcome:existing.outcome,replayed:true});continue;}
  const capture=await executeRemote(plan.remote),observed=obj(JSON.parse(capture.stdout)),stdout=String(observed.stdout??''),stderr=String(observed.stderr??''),assertions=Number(observed.assertions),proof=obj(observed.proof);
  let outcome=observed.exitCode===0&&Number.isSafeInteger(assertions)&&assertions>0&&proof.scope_digest===prepared.inputDigest?'PASS':'FAIL';
  const id=randomUUID();await tx(pool,async db=>{const current=await closureSnapshot(db,p.s,p.level,p.wave,undefined,{kind:'SCOPE',id:prepared.id});if(hash(canonical(current))!==prepared.inputDigest)outcome='STALE';await db.query('INSERT INTO hyperfide.integration_scope_receipts(organisation_id,run_id,id,level,wave,input_manifest_digest,manifest,gate_id,covered_ids,outcome,exit_code,assertion_count,stdout,stderr,job_id,proof) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(organisation_id,run_id,job_id,gate_id) DO NOTHING',[...values(p.s),id,p.level,p.wave??null,prepared.inputDigest,prepared.snapshot,plan.gate.id,plan.gate.covers,outcome,observed.exitCode,assertions,stdout,stderr,prepared.id,{...proof,remote_spool_digest:capture.spool_digest,remote_cleanup_receipt_digest:capture.cleanup.receipt_digest}]);});
  results.push({receipt_id:id,gate_id:plan.gate.id,outcome,spool_digest:capture.spool_digest});
 }
 await tx(pool,async db=>{const current=await closureSnapshot(db,p.s,p.level,p.wave,undefined,{kind:'SCOPE',id:prepared.id});await db.query('UPDATE hyperfide.integration_scope_jobs SET state=$4 WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...values(p.s),prepared.id,hash(canonical(current))===prepared.inputDigest&&results.every(r=>r.outcome==='PASS')?'SUCCEEDED':'FAILED']);});
 return {scope:p.level,input_manifest_digest:prepared.inputDigest,results,programme_qualified:false,external_activation_authorized:false};
}
async function recoverScopeJob(pool:DB,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','job_id']);const s=scope(v),id=uuid(v.job_id);
 const saved=await tx(pool,async db=>{
  await currentRun(db,s,true,undefined,false,{kind:'SCOPE',id});const row=(await db.query('SELECT * FROM hyperfide.integration_scope_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),id])).rows[0];if(!row)fail('CLOSURE_JOB_UNKNOWN','Existing scoped verification job required');
  if(!['RUNNING','OUTCOME_UNKNOWN'].includes(row.state))return {terminal:true,state:row.state};
  const manifest=obj(row.execution_manifest);if(!Array.isArray(manifest.plans)||!manifest.plans.length||hash(canonical(manifest.snapshot))!==row.input_manifest_digest)fail('INTEGRATION_REMOTE_RECOVERY_UNAVAILABLE','Original scoped input and exact remote plans unavailable');
  const plans=[];for(const raw of manifest.plans){const entry=obj(raw);plans.push({gate:entry.gate as ScopeGate,remote:await restoreRemote(db,entry.remote)});}
  const p:ReturnType<typeof parse>={s,level:row.level,...(row.wave===null?{}:{wave:row.wave})};return {terminal:false,state:row.state,p,prepared:{id,snapshot:obj(manifest.snapshot),inputDigest:row.input_manifest_digest,plans}};
 });
 if(saved.terminal)return {job_id:id,state:saved.state,replayed:true};
 return executeScopeJob(pool,saved.p!,saved.prepared!);
}
export function createComponent(ctx:ComponentContext):Component{
 let cfg:Promise<IntegrationConfig>|undefined;const settings=()=>cfg??=config(ctx.env);
 return bindScope(ctx,{apiVersion:1,actions:{
 'integration.closure.evaluate':async input=>evaluateClosure(primaryClient(),await settings(),input),
 'integration.closure.reconcile':async input=>recoverScopeJob(primaryClient(),input),
 'integration.closure.verify':async input=>verifyScope(primaryClient(),await settings(),ctx.env,input),
 'integration.closure.inspect':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','evaluation_id']);const rows=await primaryClient().query('SELECT * FROM hyperfide.integration_closure_evaluations WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...values(scope(v)),uuid(v.evaluation_id)]);return rows.rows[0]??fail('CLOSURE_UNKNOWN','Unknown closure evaluation');}
 }});
}

/** Primary-authoritative task delivery denominator; programme closure stays separate. */
export async function qualifiedIntegratedOutcomes(db:DB,s:Scope):Promise<Record<string,unknown>>{
 const as_of=new Date().toISOString(),reasons:string[]=[];
 try{
 const snapshot=await closureSnapshot(db,s,'PROGRAMME');
 const publicationModule='./publication.js',assuranceModule='../assurance/validity.js';
 const inspectPublication=(await import(publicationModule)).inspectIntegratedPublication;
 const inspectValidity=(await import(assuranceModule)).inspectValidity;
 const accepted:Record<string,unknown>[]=[];
 for(const task of snapshot.tasks){
  if(task.state!=='INTEGRATED'||!task.current_custody_id)continue;
  const contributor=snapshot.publications.flatMap((p:Record<string,any>)=>p.manifest.contributors).find((c:Record<string,any>)=>c.task_id===task.id&&c.custody_id===task.current_custody_id);
  if(!contributor)continue;
  const publication=await inspectPublication(db,s,{task_id:task.id,custody_id:task.current_custody_id,custody_generation:contributor.custody_generation});
  const validity=await inspectValidity(db,s,task.current_custody_id);
  const review=snapshot.reviewObservations.filter((r:Record<string,any>)=>r.repository_id===publication.repository_id&&r.source_object_id===publication.current_source?.source_object_id);
  if(publication.status==='PUBLISHED'&&validity.current_integrated_assurance===true&&review.length&&review.every((r:Record<string,any>)=>r.status==='COMPLETE')&&snapshot.findingObservations.every((r:Record<string,any>)=>r.clear===true))
   accepted.push({task_id:task.id,custody_id:task.current_custody_id,publication,assurance_receipt_digest:validity.receipt_digest,review_receipt_ids:review.flatMap((r:Record<string,any>)=>r.receipt_ids??[])});
 }
 const input=hash(canonical(snapshot)),programme=(await db.query("SELECT 1 FROM hyperfide.integration_closure_evaluations WHERE organisation_id=$1 AND run_id=$2 AND level='PROGRAMME' AND input_manifest_digest=$3 AND outcome='PASS'",[...values(s),input])).rowCount!>0;
 return {status:'CURRENT',count:String(accepted.length),current_task_ids:accepted.map(a=>String(a.task_id)).sort(),proof_level:'TASK_CURRENT_INTEGRATED',proof_digest:hash(canonical({input_manifest_digest:input,accepted})),as_of,programme_outcome:programme?'PASS':'HELD',reasons};
 }catch(error){semanticHold(error);return {status:'HELD',count:null,current_task_ids:[],proof_level:'TASK_CURRENT_INTEGRATED',proof_digest:null,as_of,programme_outcome:'HELD',reasons:['CURRENT_INTEGRATED_PROOF_UNAVAILABLE']};}
}
/** Uses the exact current primary snapshot and previously executed immutable full-case receipts. */
export async function inspectProgrammeClosure(db:DB,invocation:unknown):Promise<Record<string,unknown>>{
 const protocol='../transport/protocol.js';const identity=await import(protocol);identity.assertInvocation(invocation);
 const i=invocation as {principal:Record<string,unknown>;payload:Record<string,unknown>;guard:(tx:DB)=>Promise<void>};
 const input=obj(i.payload.input),s={organisation_id:uuid(i.principal.organisation_id),run_id:uuid(i.principal.run_id)};if(i.payload.run_id!==s.run_id)fail('INTEGRATION_SCOPE_DENIED','Programme inspector run differs from genuine invocation');await semanticDisposition(db,s,'READ');await i.guard(db);
 const snapshot=await closureSnapshot(db,s,'PROGRAMME'),inputDigest=hash(canonical(snapshot)),reasons:string[]=[];
 const evaluation=(await db.query("SELECT * FROM hyperfide.integration_closure_evaluations WHERE organisation_id=$1 AND run_id=$2 AND level='PROGRAMME' AND input_manifest_digest=$3 AND outcome='PASS' ORDER BY created_at DESC LIMIT 1",[...values(s),inputDigest])).rows[0];
 if(!evaluation)reasons.push('CURRENT_PROGRAMME_EVALUATION_UNAVAILABLE');
 const currentReceipts=(await db.query("SELECT r.* FROM hyperfide.integration_scope_receipts r JOIN hyperfide.integration_scope_jobs j ON j.organisation_id=r.organisation_id AND j.run_id=r.run_id AND j.id=r.job_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.level='PROGRAMME' AND r.input_manifest_digest=$3 AND j.state='SUCCEEDED' ORDER BY r.created_at DESC,r.id DESC",[...values(s),inputDigest])).rows;
 for(const gate of snapshot.closure_policy.programme_gates){const receipt=currentReceipts.find(r=>r.gate_id===gate.id);if(!receipt||receipt.outcome!=='PASS'||receipt.proof?.scope_digest!==inputDigest||receipt.proof?.template_digest!==gate.proof.manifest_digest||receipt.proof?.registry_digest!==gate.proof.registry_digest||hash(canonical(receipt.proof?.files))!==receipt.proof?.bundle_digest)reasons.push('CURRENT_FULL_CASE_RECEIPT_UNAVAILABLE:'+gate.id);}

 if(snapshot.tasks.some((t:Record<string,any>)=>t.state!=='INTEGRATED')||snapshot.assuranceObservations.some((a:Record<string,any>)=>a.current!==true)||snapshot.reviewObservations.some((r:Record<string,any>)=>r.status!=='COMPLETE')||snapshot.findingObservations.some((r:Record<string,any>)=>r.clear!==true))reasons.push('CURRENT_SCOPE_EVIDENCE_HELD');
 let sourceDigest:string|null=null;try{sourceDigest=integratedManifestDigest(snapshot);}catch(error){semanticHold(error);reasons.push('CURRENT_SOURCE_SET_UNAVAILABLE');}
 if(!snapshot.barriers.some((b:Record<string,any>)=>b.state==='RELEASED'))reasons.push('RELEASE_BARRIER_HELD');
 if(sourceDigest){try{const moduleName='../docs/closure.js';const docs=await(await import(moduleName)).inspectDocumentationClosure(db,s,{spec_revision_id:snapshot.spec_revision_id,spec_generation:snapshot.spec_generation,programme_manifest_digest:sourceDigest,source_manifest_digest:sourceDigest});if(docs.status!=='CURRENT'||docs.closed!==true)reasons.push('DOCUMENTATION_CLOSURE_HELD');}catch(error){semanticHold(error);reasons.push('DOCUMENTATION_CLOSURE_UNAVAILABLE');}}
 return {ready:!reasons.length,outcome:reasons.length?'HELD':'PASS',input_manifest_digest:inputDigest,source_manifest_digest:sourceDigest,spec_revision_id:snapshot.spec_revision_id,spec_generation:snapshot.spec_generation,reasons};
}
