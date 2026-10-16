import path from 'node:path';
import {promises as fs} from 'node:fs';
import type {AuthorityTransaction} from '../transport/protocol.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {readSemanticDisposition} from '../storage/dispositions.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {canonical,digest,specTransaction} from './import.js';
import type {StoredIntent} from './import.js';

export interface ProofPins {organisation_id:string;run_id:string;task_id:string;spec_generation:string;spec_revision_id:string}
export interface ProofCheck {id:string;argv:string[];executable_digest:string;timeout_ms:number;required_artifacts:string[];input_keys:string[]}
export interface ProofClause {id:string;mode:'EXECUTABLE'|'REVIEW';acceptance_ids:string[];checks?:string[];reviewers?:string[];rubric_digest?:string}
// Source and inputs below pin accepted registration/input provenance.
// They do not identify the future implementation result: qualification binds
// candidate commit/manifests separately and checks accepted lineage. input_keys
// names the runtime identity roles that each executable must consume.
export interface ProofPolicy {
 schema_version:1;criteria_digest:string;spec_revision_id:string;spec_generation:string;repository_id:string;source_object_id:string;
 rubric_digest:string;checks:ProofCheck[];clauses:ProofClause[];inputs:Record<string,string>;contract_digests:string[];
}
export interface ProofObligations {
 registry_digest:string;criteria_digest:string;spec_revision_id:string;spec_generation:string;policy:ProofPolicy;
 obligations:{clause_id:string;acceptance_ids:string[];required_checks:string[];review_rubric?:{reviewers:string[];rubric_digest:string}}[];
}
export type PrimaryClient=AuthorityTransaction;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^sha256:[0-9a-f]{64}$/;
const OID=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const POSITIVE=/^[1-9][0-9]{0,18}$/;
const INPUTS=['source','dependency','toolchain','configuration','graph','contract'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!object(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))
  fail('PROOF_MAPPING_INVALID','Proof fields must match the versioned registry contract');
 return value;
}
function strings(value:unknown,pattern:RegExp,empty=false,max=128):value is string[]{
 return Array.isArray(value)&&(empty||value.length>0)&&value.length<=max&&new Set(value).size===value.length&&value.every(item=>typeof item==='string'&&pattern.test(item));
}
function safeArtifact(value:string):boolean{
 return value.length<=1024&&!path.isAbsolute(value)&&!value.includes('\\')&&!/[\x00-\x1f]/.test(value)&&
 value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
}
function pins(value:ProofPins):void{
 if(![value.organisation_id,value.run_id,value.task_id,value.spec_revision_id].every(item=>UUID.test(item))||
 !POSITIVE.test(value.spec_generation)||BigInt(value.spec_generation)>9223372036854775807n)
  fail('PROOF_REGISTRY_MISMATCH','Invalid exact proof scope pins');
}
export function validateProofPolicy(value:unknown):ProofPolicy{
 const input=exact(value,['schema_version','criteria_digest','spec_revision_id','spec_generation','repository_id','source_object_id',
 'rubric_digest','checks','clauses','inputs','contract_digests']);
 if(input.schema_version!==1||typeof input.criteria_digest!=='string'||!SHA.test(input.criteria_digest)||
 typeof input.spec_revision_id!=='string'||!UUID.test(input.spec_revision_id)||typeof input.spec_generation!=='string'||
 !POSITIVE.test(input.spec_generation)||BigInt(input.spec_generation)>9223372036854775807n||
 typeof input.repository_id!=='string'||!UUID.test(input.repository_id)||typeof input.source_object_id!=='string'||!OID.test(input.source_object_id)||
 typeof input.rubric_digest!=='string'||!SHA.test(input.rubric_digest))
  fail('PROOF_MAPPING_INVALID','Invalid proof source, criterion, revision or rubric identity');
 const inputs=exact(input.inputs,INPUTS);
 if(Object.values(inputs).some(item=>typeof item!=='string'||!SHA.test(item))||
 !strings(input.contract_digests,SHA,true)||!Array.isArray(input.checks)||input.checks.length>128||
 !Array.isArray(input.clauses)||input.clauses.length<1||input.clauses.length>128)
  fail('PROOF_MAPPING_INVALID','Proof requires explicit input identities and a bounded nonempty clause registry');
 const checks=new Set<string>();
 for(const candidate of input.checks){
  const check=exact(candidate,['id','argv','executable_digest','timeout_ms','required_artifacts','input_keys']);
  if(typeof check.id!=='string'||!ID.test(check.id)||checks.has(check.id)||!Array.isArray(check.argv)||check.argv.length<1||check.argv.length>64||
   check.argv.some(arg=>typeof arg!=='string'||arg.length>8192||arg.includes('\0'))||
   typeof check.argv[0]!=='string'||!path.isAbsolute(check.argv[0])||typeof check.executable_digest!=='string'||!SHA.test(check.executable_digest)||
   !Number.isInteger(check.timeout_ms)||(check.timeout_ms as number)<100||(check.timeout_ms as number)>259200000||
   !strings(check.required_artifacts,/^.+$/,true)||check.required_artifacts.some(item=>!safeArtifact(item))||
   !strings(check.input_keys,/^(source|dependency|toolchain|configuration|graph|contract)$/))
   fail('PROOF_MAPPING_INVALID','Executable checks require exact identities, bounded execution and safe required artifacts');
  checks.add(check.id);
 }
 const clauses=new Set<string>(),usedChecks=new Set<string>();
 for(const candidate of input.clauses){
  if(!object(candidate)||!['EXECUTABLE','REVIEW'].includes(String(candidate.mode)))fail('PROOF_MAPPING_INVALID','Unknown proof mode');
  const clause=exact(candidate,candidate.mode==='EXECUTABLE'?['id','mode','acceptance_ids','checks']:['id','mode','acceptance_ids','reviewers','rubric_digest']);
  if(typeof clause.id!=='string'||!/^[0-9]+(?:\.[0-9]+)+$/.test(clause.id)||clauses.has(clause.id)||!strings(clause.acceptance_ids,ID))
   fail('PROOF_MAPPING_INVALID','Each proof must identify a unique acceptance clause');
  clauses.add(clause.id);
  if(clause.mode==='EXECUTABLE'){
   if(!strings(clause.checks,ID)||clause.checks.some(check=>!checks.has(check)))fail('PROOF_MAPPING_INVALID','Clause references absent or empty executable checks');
   for(const check of clause.checks)usedChecks.add(check);
  }else if(!strings(clause.reviewers,UUID)||typeof clause.rubric_digest!=='string'||!SHA.test(clause.rubric_digest))
   fail('PROOF_MAPPING_INVALID','Review clauses require explicit reviewer identities and rubric digest');
 }
 if([...checks].some(check=>!usedChecks.has(check)))fail('PROOF_MAPPING_INVALID','Unmapped checks cannot establish proof coverage');
 return JSON.parse(canonical(input)) as ProofPolicy;
}
function obligations(policy:ProofPolicy,registry_digest:string):ProofObligations{
 return {registry_digest,criteria_digest:policy.criteria_digest,spec_revision_id:policy.spec_revision_id,spec_generation:policy.spec_generation,policy,
 obligations:policy.clauses.map(clause=>({clause_id:clause.id,acceptance_ids:[...clause.acceptance_ids],required_checks:[...(clause.checks??[])],
 ...(clause.mode==='REVIEW'?{review_rubric:{reviewers:[...clause.reviewers!],rubric_digest:clause.rubric_digest!}}:{})}))};
}
export async function loadProofObligations(db:PrimaryClient,scope:ProofPins):Promise<ProofObligations>{
 pins(scope);
 assertPrimaryTransaction(db);await readSemanticDisposition(db,scope);
 const result=await db.query(
 'SELECT pg_is_in_recovery() AS replica,p.registry_digest,p.criteria_digest,p.policy,t.criteria_digest AS current_criteria,t.definition,s.document AS accepted_document FROM hyperfide.proof_registries p '+
 'JOIN hyperfide.tasks t ON t.organisation_id=p.organisation_id AND t.run_id=p.run_id AND t.id=p.task_id '+
 'JOIN hyperfide.run_spec_revisions h ON h.organisation_id=t.organisation_id AND h.run_id=t.run_id AND h.spec_generation=t.spec_generation AND h.spec_revision_id=t.spec_revision_id '+
 'JOIN hyperfide.spec_revisions s ON s.organisation_id=t.organisation_id AND s.id=t.spec_revision_id '+
 'WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.task_id=$3 AND p.spec_generation=$4 AND p.spec_revision_id=$5 '+
 'AND t.spec_generation=p.spec_generation AND t.spec_revision_id=p.spec_revision_id AND h.accepted',
 [scope.organisation_id,scope.run_id,scope.task_id,scope.spec_generation,scope.spec_revision_id]);
 if(result.rows.length!==1)fail('PROOF_REGISTRY_MISSING','An exact current accepted proof registry is required');
 const row=result.rows[0]!;
 if(row.replica)fail('PRIMARY_REQUIRED','Proof authority requires the primary');
 const policy=validateProofPolicy(row.policy);
 if(row.criteria_digest!==row.current_criteria||policy.criteria_digest!==row.criteria_digest||
 policy.spec_revision_id!==scope.spec_revision_id||policy.spec_generation!==scope.spec_generation||
 row.registry_digest!==digest(canonical(policy)))fail('PROOF_REGISTRY_MISMATCH','Stored proof registry does not match its immutable authority pins');
 clauseCoverage(policy,row.definition,row.accepted_document as StoredIntent);
 await acceptedProofAuthority(policy,row.definition,row.accepted_document as StoredIntent);
 return obligations(policy,row.registry_digest);
}
function clauseCoverage(policy:ProofPolicy,definition:unknown,intent:StoredIntent):void{
 if(!object(definition)||!object(definition.section)||!object(definition.section.fields))fail('PROOF_MAPPING_INVALID','Task definition is absent');
 const fields=definition.section.fields,reqs=object(fields.reqs)?fields.reqs.value:undefined;
 if(!strings(reqs,/^[0-9]+(?:\.[0-9]+)+$/)||reqs.length!==policy.clauses.length||reqs.some(id=>!policy.clauses.some(clause=>clause.id===id)))
  fail('PROOF_MAPPING_INVALID','Every exact task acceptance clause needs one explicit proof mapping');
 const sections=new Map(intent.parsed.sections.map(section=>[section.name,section]));
 const declared=object(fields.acceptance_ids)?fields.acceptance_ids.value:undefined;
 if(declared!==undefined&&!strings(declared,ID))fail('PROOF_MAPPING_INVALID','Declared task acceptance identities are invalid');
 const explicit=new Map<string,Set<string>>();
 for(const clause of policy.clauses){
  const split=clause.id.lastIndexOf('.'),section=sections.get('req.'+clause.id.slice(0,split));
  if(typeof section?.fields['ac_'+clause.id.slice(split+1)]?.value!=='string')fail('PROOF_MAPPING_INVALID','Clause references an absent accepted criterion');
  const associated=new Set<string>();
  for(const candidate of intent.parsed.sections){
   const req=candidate.fields.req?.value,reqs=candidate.fields.reqs?.value;
   if((req===clause.id||Array.isArray(reqs)&&reqs.includes(clause.id))&&(candidate.name.startsWith('acceptance.')||candidate.name.startsWith('case.'))){
    const key=candidate.name.slice(candidate.name.indexOf('.')+1);
    if(declared===undefined||(declared as string[]).includes(key))associated.add(key);
   }
  }
  explicit.set(clause.id,associated);
 }
 const required=new Set<string>(declared===undefined?[...explicit.values()].flatMap(values=>[...values]):declared as string[]);
 const actual=new Set(policy.clauses.flatMap(clause=>clause.acceptance_ids));
 if(!required.size||required.size!==actual.size||[...required].some(id=>!actual.has(id)))
  fail('PROOF_MAPPING_INVALID','Proof mapping must preserve the complete accepted task scenario set');
 for(const clause of policy.clauses){
  const associated=explicit.get(clause.id)!;
  if(associated.size===0||clause.acceptance_ids.some(id=>!required.has(id)||(!sections.has('acceptance.'+id)&&!sections.has('case.'+id)))||
   (associated.size!==clause.acceptance_ids.length||clause.acceptance_ids.some(id=>!associated.has(id))))
   fail('PROOF_MAPPING_INVALID','Proof cannot substitute unrelated accepted scenarios for a clause');
 }
}

// A registrar binds accepted executable intent; it cannot author a weaker check
// or substitute its own reviewers while preserving only the acceptance labels.
async function acceptedProofAuthority(policy:ProofPolicy,definition:unknown,intent:StoredIntent):Promise<void>{
 if(!object(definition)||!object(definition.section)||!object(definition.section.fields))
  fail('PROOF_MAPPING_INVALID','Accepted task command intent is absent');
 const fields=definition.section.fields,sections=new Map(intent.parsed.sections.map(section=>[section.name,section]));
 const value=(name:string,key:string):unknown=>sections.get(name)?.fields[key]?.value;
 const taskValue=(key:string):unknown=>object(fields[key])?fields[key].value:undefined;
 const explicit=policy.checks.every(check=>sections.has('proof.check.'+check.id));
 if(!policy.checks.length&&value('proof','rubric_digest')!==policy.rubric_digest)
  fail('PROOF_MAPPING_INVALID','Review registry rubric must match accepted proof intent');
 if(explicit&&policy.checks.length){
  if(value('proof','rubric_digest')!==policy.rubric_digest)
   fail('PROOF_MAPPING_INVALID','Registry rubric must match accepted proof intent');
  for(const check of policy.checks){
   const accepted=sections.get('proof.check.'+check.id)!;
   const expected={id:check.id,...Object.fromEntries(['argv','executable_digest','timeout_ms','required_artifacts','input_keys'].map(key=>[key,accepted.fields[key]?.value]))};
   if(canonical(check)!==canonical(expected))
    fail('PROOF_MAPPING_INVALID','Executable registry differs from its accepted check definition');
  }
 }else if(policy.checks.length){
  const command=taskValue('verify_cmd'),artifacts=taskValue('artifacts');
  if(typeof command!=='string'||!command.length||command.length>8192||!strings(artifacts,/^.+$/,true)||artifacts.some(item=>!safeArtifact(item))||
   policy.checks.length!==1||policy.rubric_digest!==policy.criteria_digest)
   fail('PROOF_MAPPING_INVALID','Accepted executable definitions or exact task command and artifacts are required');
  let executable:string,executable_digest:string;
  try{executable=await fs.realpath('/bin/bash');executable_digest=digest(await fs.readFile(executable));}
  catch{fail('PROOF_MAPPING_INVALID','Trusted task command adapter is unavailable');}
  const check=policy.checks[0]!;
  if(canonical(check.argv)!==canonical([executable,'-c',command])||check.executable_digest!==executable_digest||
   canonical(check.required_artifacts)!==canonical(artifacts)||canonical([...check.input_keys].sort())!==canonical([...INPUTS].sort()))
   fail('PROOF_MAPPING_INVALID','Task command proof must preserve the exact accepted command, artifacts and input roles');
 }
 for(const clause of policy.clauses){
  if(clause.mode==='REVIEW'){
   const accepted=sections.get('proof.review.'+clause.id);
   if(!accepted||canonical(accepted.fields.reviewers?.value)!==canonical(clause.reviewers)||
    accepted.fields.rubric_digest?.value!==clause.rubric_digest)
    fail('PROOF_MAPPING_INVALID','Reviewer identities and rubric must be explicitly accepted before registration');
  }else if(explicit){
   const required=new Set<string>();
   for(const id of clause.acceptance_ids){
    const section=sections.get('acceptance.'+id)??sections.get('case.'+id),checks=section?.fields.checks?.value;
    if(!strings(checks,ID))fail('PROOF_MAPPING_INVALID','Accepted executable case must identify its exact registered checks');
    for(const check of checks)required.add(check);
   }
   if(required.size!==clause.checks!.length||clause.checks!.some(id=>!required.has(id)))
    fail('PROOF_MAPPING_INVALID','Clause check mapping substitutes unrelated accepted executable intent');
  }else if(clause.checks!.length!==1||clause.checks![0]!==policy.checks[0]?.id)
   fail('PROOF_MAPPING_INVALID','Whole-task command must cover every executable clause');
 }
}
function operatingMaximum(context:ComponentContext):number{
 const raw=context.env.HF_PROOF_MAX_CHECK_MS??'3600000';
 if(!/^[1-9][0-9]{0,8}$/.test(raw)||Number(raw)<100||Number(raw)>259200000)
  fail('PROOF_CONFIG_INVALID','Trusted check deadline must be bounded between100ms and72hours');
 return Number(raw);
}
export async function registerProofPolicy(client:PrimaryClient,scope:{organisation_id:string;run_id:string},input:unknown,allowReview=false,maximumMs=259200000):Promise<ProofObligations>{
 const request=exact(input,['run_id','task_id','spec_revision_id','spec_generation','state_version','policy']);
 const pin:ProofPins={organisation_id:scope.organisation_id,run_id:String(request.run_id),task_id:String(request.task_id),
 spec_revision_id:String(request.spec_revision_id),spec_generation:String(request.spec_generation)};
 pins(pin);
 if(request.run_id!==scope.run_id||typeof request.spec_generation!=='string'||typeof request.state_version!=='string'||!POSITIVE.test(request.state_version))
  fail('PROOF_REGISTRY_MISMATCH','Proof request does not match authenticated scope and exact generation');
 const policy=validateProofPolicy(request.policy);
 if(policy.spec_generation!==pin.spec_generation||policy.spec_revision_id!==pin.spec_revision_id)fail('PROOF_REGISTRY_MISMATCH','Policy pins differ from requested pins');
 if(policy.checks.some(check=>check.timeout_ms>maximumMs))fail('PROOF_MAPPING_INVALID','Check exceeds the trusted run operating deadline');
 if(!allowReview&&policy.clauses.some(clause=>clause.mode==='REVIEW'))fail('ACTION_DENIED','Review rubrics require explicitly permitted review registration');
 const run=await client.query(
  'SELECT r.state_version::text,r.spec_generation::text,r.spec_revision_id,r.state,s.document,pg_is_in_recovery() AS replica FROM hyperfide.runs r '+
  'JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id AND s.project_id=r.project_id '+
  'WHERE r.organisation_id=$1 AND r.id=$2 FOR SHARE OF r',[scope.organisation_id,scope.run_id]);
 const current=run.rows[0];
 if(!current||current.replica||current.state_version!==request.state_version||!['PENDING_VALIDATION','READY','RUNNING','PAUSED'].includes(current.state))
  fail('PROOF_REGISTRY_MISMATCH','Accepted run or state version changed before proof registration');
 const task=await client.query(
  'SELECT t.criteria_digest,t.definition,t.state,s.document AS accepted_document FROM hyperfide.tasks t JOIN hyperfide.spec_revisions s ON s.organisation_id=t.organisation_id AND s.id=t.spec_revision_id WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.id=$3 AND t.spec_generation=$4 AND t.spec_revision_id=$5 FOR UPDATE OF t',
  [pin.organisation_id,pin.run_id,pin.task_id,pin.spec_generation,pin.spec_revision_id]);
 const row=task.rows[0];
 if(!row||row.criteria_digest!==policy.criteria_digest)fail('PROOF_REGISTRY_MISMATCH','Proof criteria do not match current task');
 clauseCoverage(policy,row.definition,row.accepted_document as StoredIntent);
 await acceptedProofAuthority(policy,row.definition,row.accepted_document as StoredIntent);
 const source=await client.query('SELECT 1 FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 AND source_object_id=$4',
  [pin.organisation_id,pin.run_id,policy.repository_id,policy.source_object_id]);
 if(source.rows.length!==1)fail('PROOF_REGISTRY_MISMATCH','Proof baseline is outside the accepted input repository revision set');
 const registry_digest=digest(canonical(policy));
 const prior=await client.query('SELECT registry_digest FROM hyperfide.proof_registries WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND spec_generation=$4',
  [pin.organisation_id,pin.run_id,pin.task_id,pin.spec_generation]);
 if(prior.rows.length&&prior.rows[0]!.registry_digest!==registry_digest)fail('PROOF_REGISTRY_CONFLICT','Changing accepted proof policy requires a new specification generation');
 if(!prior.rows.length){
  if(!['PENDING','READY','BLOCKED','STALE'].includes(row.state))fail('PROOF_REGISTRY_CONFLICT','Proof mapping cannot first appear during active or completed execution');
  await client.query('INSERT INTO hyperfide.proof_registries(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,registry_digest,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [pin.organisation_id,pin.run_id,pin.task_id,pin.spec_generation,pin.spec_revision_id,policy.criteria_digest,registry_digest,JSON.stringify(policy)]);
 }
 return loadProofObligations(client,pin);
}
export function createComponent(_startup:ComponentContext):Component{
 const action=(review:boolean)=>async(input:unknown,context:ComponentContext):Promise<unknown>=>specTransaction(context,'WRITE',async(tx,invocation)=>{
  if(!['OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR'].includes(invocation.principal.role))
   fail('ACTION_DENIED','Authenticated role cannot register accepted proof policy');
  return registerProofPolicy(tx,{organisation_id:invocation.principal.organisation_id,run_id:invocation.principal.run_id},input,review,operatingMaximum(context));
 });
 return {apiVersion:1,actions:{
  'spec.proof.register':action(false),
  'spec.proof.review.register':action(true),
  'spec.proof.inspect':async(input,context)=>specTransaction(context,'READ',async(tx,invocation)=>{
   const request=exact(input,['run_id','task_id','spec_revision_id','spec_generation']);
   if(request.run_id!==invocation.principal.run_id||typeof request.spec_generation!=='string')fail('PROOF_REGISTRY_MISMATCH','Proof inspection is outside authenticated run scope');
   return loadProofObligations(tx,{organisation_id:invocation.principal.organisation_id,run_id:invocation.principal.run_id,
    task_id:String(request.task_id),spec_revision_id:String(request.spec_revision_id),spec_generation:request.spec_generation});
  })
 }};
}
