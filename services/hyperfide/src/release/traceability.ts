import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {boundedText,canonical,contentDigest,digest,fields,invalid,sha256,stringList,persistReleaseArtifact,type RecordValue} from '../docs/closure.js';

export interface ReleaseTask{id:string;reqs:string[];acceptance_ids:string[];requires:string[];wave:number}
export interface ClauseMapping{id:string;task_ids:string[];acceptance_ids:string[];chapters:string[]}
export interface SourcePin{path:string;sha256:string;size:number}
// Three distinct authorities: native implementation approval, design-pack review and per-case product qualification.
export interface ReviewStates{
 original_approval:{source:string;implementation_authorized:boolean;task_status:Record<string,string>;grants_product_qualification:false};
 pack_review:{source:string;sha256:string;scope:'DESIGN_AND_AUTHORING_ONLY';grants_implementation_approval:false;grants_product_qualification:false};
 product_qualification:{source:string;case_qualification:Record<string,string>;qualified_case_ids:string[];unresolved_case_ids:string[]};
}
export interface ReleaseContract{
 clauses:string[];tasks:ReleaseTask[];cases:Record<string,{full_assertion_ids:string[]}>;native_case_requirements:Record<string,string[]>;mappings:ClauseMapping[];
 source_pins:SourcePin[];review_states:ReviewStates;contract_digest:string;
}
const specBase='spec/hyperfide/';
function privatePath(relative:string):boolean{return relative.split('/').some(p=>p==='private'||p==='..'||p==='.'||p==='')||relative.includes('\\');}
function exact(a:string[],b:string[]):boolean{return a.length===b.length&&[...a].sort().every((v,i)=>v===[...b].sort()[i]);}
function unique(values:string[],label:string):void{if(new Set(values).size!==values.length)invalid('Duplicate '+label);}
function array(value:unknown,min=0,max=100000):unknown[]{if(!Array.isArray(value)||value.length<min||value.length>max)invalid('Invalid contract list');return value;}
function task(value:unknown):ReleaseTask{
 if(!object(value))invalid('Invalid task contract');
 const taskID=boundedText(value.id);if(!/^[1-9][0-9]*\.[1-9][0-9]*$/.test(taskID))invalid('Invalid task identity');
 if(!Number.isSafeInteger(value.wave)||(value.wave as number)<1)invalid('Invalid task wave');
 return {id:taskID,reqs:stringList(value.reqs),acceptance_ids:stringList(value.acceptance_ids),requires:stringList(value.requires,0),wave:value.wave as number};
}
function record(value:unknown,label:string):Record<string,unknown>{if(!object(value))invalid('Invalid '+label);return value;}
function textRecord(value:unknown,label:string):Record<string,string>{const r=record(value,label),out:Record<string,string>={};for(const[k,v]of Object.entries(r))out[boundedText(k)]=boundedText(v,1024);return out;}
function falseFlag(value:unknown,label:string):false{if(value!==false)invalid(label+' must not grant authority');return false;}
function reviewStates(value:unknown):ReviewStates{
 const r=fields(value,['original_approval','pack_review','product_qualification']);
 const o=fields(r.original_approval,['source','implementation_authorized','task_status','grants_product_qualification']);
 const p=fields(r.pack_review,['source','sha256','scope','grants_implementation_approval','grants_product_qualification']);
 const q=fields(r.product_qualification,['source','case_qualification','qualified_case_ids','unresolved_case_ids']);
 if(typeof o.implementation_authorized!=='boolean')invalid('Invalid original approval');
 if(p.scope!=='DESIGN_AND_AUTHORING_ONLY')invalid('Pack review scope widened');
 return {original_approval:{source:boundedText(o.source),implementation_authorized:o.implementation_authorized,task_status:textRecord(o.task_status,'task status'),grants_product_qualification:falseFlag(o.grants_product_qualification,'Original approval')},
 pack_review:{source:boundedText(p.source),sha256:digest(p.sha256),scope:'DESIGN_AND_AUTHORING_ONLY',grants_implementation_approval:falseFlag(p.grants_implementation_approval,'Pack review'),grants_product_qualification:falseFlag(p.grants_product_qualification,'Pack review')},
 product_qualification:{source:boundedText(q.source),case_qualification:textRecord(q.case_qualification,'case qualification'),qualified_case_ids:stringList(q.qualified_case_ids,0),unresolved_case_ids:stringList(q.unresolved_case_ids,0)}};
}
function sourcePin(value:unknown):SourcePin{
 const r=fields(value,['path','sha256','size']);
 if(!Number.isSafeInteger(r.size)||(r.size as number)<0)invalid('Invalid source pin size');
 return {path:boundedText(r.path,4096),sha256:digest(r.sha256),size:r.size as number};
}
// Parses an externally supplied (possibly controlled/tampered) release pack without trusting any field.
export function parseReleasePack(value:unknown):ReleaseContract{
 const r=fields(value,['clauses','tasks','cases','native_case_requirements','mappings','source_pins','review_states','contract_digest']);
 const cases:ReleaseContract['cases']={};
 for(const[name,entry]of Object.entries(record(r.cases,'case registry'))){if(!/^V-[0-9]{3}$/.test(name))invalid('Invalid canonical case');cases[name]={full_assertion_ids:stringList(fields(entry,['full_assertion_ids']).full_assertion_ids,0,100000)};}
 const native:Record<string,string[]>={};
 for(const[name,reqs]of Object.entries(record(r.native_case_requirements,'native case requirements')))native[boundedText(name)]=stringList(reqs);
 return {clauses:stringList(r.clauses,1,100000),tasks:array(r.tasks,1).map(task),cases,native_case_requirements:native,mappings:array(r.mappings,1).map(mapping),
 source_pins:array(r.source_pins,1).map(sourcePin),review_states:reviewStates(r.review_states),contract_digest:digest(r.contract_digest)};
}
function mapping(value:unknown):ClauseMapping{
 if(!object(value))invalid('Invalid clause mapping');
 return {id:boundedText(value.id),task_ids:stringList(value.task_ids),acceptance_ids:stringList(value.acceptance_ids),chapters:stringList(value.chapters)};
}
export function validateTraceability(contract:ReleaseContract,mappings:ClauseMapping[]=contract.mappings):RecordValue{
 unique(contract.clauses,'native clause');unique(contract.tasks.map(t=>t.id),'task');unique(mappings.map(m=>m.id),'clause mapping');
 const tasks=new Map(contract.tasks.map(t=>[t.id,t])),cases=Object.keys(contract.cases),mapped=mappings.map(m=>m.id),pinned=new Set(contract.source_pins.map(p=>p.path));
 unique(contract.source_pins.map(p=>p.path),'source pin');
 if(!exact(contract.clauses,mapped))invalid('Missing, extra or unknown clause mapping');
 const clausesFromTasks=contract.tasks.flatMap(t=>t.reqs);
 if(!exact(contract.clauses,[...new Set(clausesFromTasks)]))invalid('Task requirements differ from native clauses');
 const referencedCases=new Set<string>(),visited=new Set<string>(),active=new Set<string>();
 const visit=(name:string):void=>{
 if(visited.has(name))return;if(active.has(name))invalid('Task dependency cycle');
 const current=tasks.get(name);if(!current)invalid('Unknown task dependency');active.add(name);
 for(const dependency of current.requires){const previous=tasks.get(dependency);if(!previous||previous.wave>=current.wave)invalid('Invalid task prerequisite wave');visit(dependency);}
 active.delete(name);visited.add(name);
 };
 for(const t of contract.tasks){
 visit(t.id);unique(t.reqs,'task clause');unique(t.acceptance_ids,'task case');
 if(t.reqs.some(r=>!contract.clauses.includes(r))||t.acceptance_ids.some(c=>!Object.hasOwn(contract.cases,c)))invalid('Task references an unknown clause or case');
 t.acceptance_ids.forEach(c=>referencedCases.add(c));
 }
 if(!exact([...referencedCases],cases)||!exact(Object.keys(contract.native_case_requirements),cases))invalid('Case registry has unmapped or absent native cases');
 for(const [name,requirements]of Object.entries(contract.native_case_requirements)){
 unique(requirements,'native case requirement');
 if(requirements.some(r=>!contract.clauses.includes(r)))invalid('Native case references an unknown clause');
 const projected=contract.tasks.filter(t=>t.acceptance_ids.includes(name)).flatMap(t=>t.reqs);
 if(!exact([...new Set(projected)],requirements))invalid('Native acceptance case/task requirement mismatch: '+name+' native='+JSON.stringify([...requirements].sort())+' projected='+JSON.stringify([...new Set(projected)].sort()));
 }
 for(const m of mappings){
 const owners=contract.tasks.filter(t=>t.reqs.includes(m.id));
 const requiredCases=[...new Set(owners.flatMap(t=>t.acceptance_ids))];
 if(!exact(m.task_ids,owners.map(t=>t.id))||!exact(m.acceptance_ids,requiredCases))invalid('Clause/task/case mapping is not bidirectional: '+m.id);
 if(!m.chapters.length)invalid('Missing public source contract');
 for(const chapter of m.chapters){if(privatePath(chapter))invalid('Private source audit cannot be a traceability dependency');if(!pinned.has(specBase+chapter))invalid('Unpinned public source chapter');}
 }
 if(contract.source_pins.some(p=>privatePath(p.path)))invalid('Private source audit cannot be a traceability dependency');
 const states=contract.review_states,qualification=states.product_qualification;
 if(!exact(Object.keys(qualification.case_qualification),cases))invalid('Product qualification state differs from case registry');
 const qualified=cases.filter(c=>qualification.case_qualification[c]==='PASS');
 if(!exact(qualification.qualified_case_ids,qualified)||!exact(qualification.unresolved_case_ids,cases.filter(c=>!qualified.includes(c))))invalid('Unresolved qualification items are not reported explicitly');
 if(!exact(Object.keys(states.original_approval.task_status),contract.tasks.map(t=>t.id)))invalid('Original approval task states differ from task graph');
 const review=contract.source_pins.find(p=>p.path===states.pack_review.source);
 if(!review||review.sha256!==states.pack_review.sha256)invalid('Pack review disposition is not pinned');
 return {valid:true,clauses:contract.clauses.length,tasks:contract.tasks.length,cases:cases.length,
 implementation_approval_is_product_qualification:false,pack_review_is_implementation_approval:false,pack_review_is_product_qualification:false,component_receipt_is_full_case:false,
 review_states:{original_approval:{implementation_authorized:states.original_approval.implementation_authorized,source:states.original_approval.source},
 pack_review:{scope:states.pack_review.scope,source:states.pack_review.source,sha256:states.pack_review.sha256},
 product_qualification:{qualified_case_ids:[...qualification.qualified_case_ids],unresolved_case_ids:[...qualification.unresolved_case_ids]}},
 coverage:mappings.map(m=>({clause:m.id,task_ids:[...m.task_ids],case_ids:[...m.acceptance_ids],chapter_paths:[...m.chapters]}))};
}
const repositoryRoot=path.resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
export interface PackSource{root:string;origin:'IMPLEMENTED_REVISION'|'CONTROLLED'}
// A controlled pack root is a fixture-only substitute; receipts label it and never present it as the implemented revision.
export function packSource(env:NodeJS.ProcessEnv=process.env):PackSource{
 const configured=env.HF_TRACEABILITY_PACK_ROOT;if(configured===undefined||configured==='')return {root:repositoryRoot,origin:'IMPLEMENTED_REVISION'};
 if(!path.isAbsolute(configured)||path.resolve(configured)!==configured||configured===repositoryRoot)invalid('Invalid controlled traceability pack root');
 return {root:configured,origin:'CONTROLLED'};
}
async function publicFile(relative:string,root:string):Promise<Buffer>{
 if(path.isAbsolute(relative)||privatePath(relative))invalid('Private or escaping traceability source');
 const filename=path.join(root,relative),resolved=await fs.realpath(filename).catch(()=>invalid('Missing public contract source: '+relative));
 if(resolved!==filename||!resolved.startsWith(root+path.sep))invalid('Traceability source alias is forbidden');
 const info=await fs.lstat(filename);if(!info.isFile()||info.isSymbolicLink()||info.size>16*1024*1024)invalid('Missing/bounded public contract source');return fs.readFile(filename);
}
type LoadedContract={contract:ReleaseContract;records:{path:string;sha256:string;size:number;content_base64:string}[]};
export async function loadReleaseContract(source:PackSource=packSource()):Promise<LoadedContract>{
 const loaded=await snapshotReleaseContract(source);validateTraceability(loaded.contract);return loaded;
}
// Snapshot only; semantic validation is reported separately so genuine defects are diagnosed rather than dropped.
export async function snapshotReleaseContract(source:PackSource=packSource()):Promise<LoadedContract>{
 const read=(relative:string):Promise<Buffer>=>publicFile(relative,source.root);
 const base=specBase,required=['spec.kvx','evidence/task-catalog.json','evidence/traceability.json','requirements.md','decisions.md','schematics.md','implementation-plan.md','reviews/README.md','traceability.md','verification.md'];
 const buffers=new Map<string,Buffer>();
 for(const name of required)buffers.set(base+name,await read(base+name));
 buffers.set('docs/hyperfide/operations.md',await read('docs/hyperfide/operations.md'));
 const registryBytes=await read('tests/hyperfide/registry.json');buffers.set('tests/hyperfide/registry.json',registryBytes);
 const native=buffers.get(base+'spec.kvx')!.toString('utf8');
 const clauses:string[]=[],nativeCases:Record<string,string[]>={},taskStatus:Record<string,string>={},caseQualification:Record<string,string>={};let section='',authorized:boolean|null=null;
 for(const line of native.split(/\r?\n/u)){const header=/^\[([^\]]+)\]\s*$/u.exec(line);if(header){section=header[1]!;continue;}
 const criterion=/^ac_([1-9][0-9]*)\s*=/u.exec(line);if(section.startsWith('req.')&&criterion)clauses.push(section.slice(4)+'.'+criterion[1]);
 const quoted=/^(status|qualification)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/u.exec(line);
 if(section==='meta'){const flag=/^implementation_authorized\s*=\s*(true|false)\s*$/u.exec(line);if(flag)authorized=flag[1]==='true';}
 if(section.startsWith('task.')&&quoted?.[1]==='status')taskStatus[section.slice(5)]=boundedText(JSON.parse(quoted[2]!));
 if(section.startsWith('acceptance.')){const selected=/^reqs\s*=\s*(\[.*\])\s*$/u.exec(line);if(selected)nativeCases[section.slice(11)]=stringList(JSON.parse(selected[1]!));
 if(quoted?.[1]==='qualification')caseQualification[section.slice(11)]=boundedText(JSON.parse(quoted[2]!),1024);}}
 if(authorized===null)invalid('Native implementation approval is not declared');
 const rawCatalog=JSON.parse(buffers.get(base+'evidence/task-catalog.json')!.toString('utf8')) as unknown;
 const catalog=Array.isArray(rawCatalog)?rawCatalog:object(rawCatalog)?rawCatalog.tasks:null;
 const tasks=array(catalog,1).map(task);
 const crosswalk=JSON.parse(buffers.get(base+'evidence/traceability.json')!.toString('utf8')) as unknown;
 if(!object(crosswalk))invalid('Invalid public traceability record');
 const mappings=array(crosswalk.clause_mappings,1).map(mapping);
 const rawRegistry=JSON.parse(registryBytes.toString('utf8')) as unknown;
 if(!object(rawRegistry)||!object(rawRegistry.cases))invalid('Missing case registry');
 const cases:ReleaseContract['cases']={};
 for(const[name,entry]of Object.entries(rawRegistry.cases)){
 if(!/^V-[0-9]{3}$/.test(name)||!object(entry))invalid('Invalid canonical case');
 cases[name]={full_assertion_ids:stringList(entry.full_assertion_ids,0,100000)};
 }
 for(const m of mappings)for(const chapter of m.chapters){const relative=base+chapter;if(!buffers.has(relative))buffers.set(relative,await read(relative));}
 const sourcePins=[...buffers].map(([name,bytes])=>({path:name,sha256:sha256(bytes),size:bytes.length})).sort((a,b)=>a.path.localeCompare(b.path));
 const reviewPin=sourcePins.find(p=>p.path===base+'reviews/README.md')!,caseIDs=Object.keys(cases),qualified=caseIDs.filter(c=>caseQualification[c]==='PASS');
 const review_states:ReviewStates={
 original_approval:{source:base+'spec.kvx',implementation_authorized:authorized,task_status:taskStatus,grants_product_qualification:false},
 pack_review:{source:reviewPin.path,sha256:reviewPin.sha256,scope:'DESIGN_AND_AUTHORING_ONLY',grants_implementation_approval:false,grants_product_qualification:false},
 product_qualification:{source:base+'spec.kvx',case_qualification:Object.fromEntries(caseIDs.map(c=>[c,caseQualification[c]??'UNDECLARED'])),qualified_case_ids:qualified,unresolved_case_ids:caseIDs.filter(c=>!qualified.includes(c))}};
 const unsigned={clauses:clauses.sort(),tasks,cases,native_case_requirements:nativeCases,mappings,source_pins:sourcePins,review_states};
 const contract:ReleaseContract={...unsigned,contract_digest:contentDigest(unsigned)};
 for(const [name,bytes]of buffers)if(!(await read(name)).equals(bytes))invalid('Public release contract changed during snapshot');
 return {contract,records:[...buffers].map(([name,bytes])=>({path:name,sha256:sha256(bytes),size:bytes.length,content_base64:bytes.toString('base64')})).sort((a,b)=>a.path.localeCompare(b.path))};
}
export async function traceabilityReceipt(input:unknown):Promise<RecordValue>{
 const request=fields(input,['contract_digest','mapping_digest']),loaded=await loadReleaseContract();
 if(digest(request.contract_digest)!==loaded.contract.contract_digest||digest(request.mapping_digest)!==contentDigest(loaded.contract.mappings))invalid('Traceability revision changed');
 const observed=validateTraceability(loaded.contract);
 const receipt={schema_version:1,kind:'traceability_validation',contract_digest:loaded.contract.contract_digest,mapping_digest:contentDigest(loaded.contract.mappings),
 observed,pack_origin:packSource().origin,implemented_revision:packSource().origin==='IMPLEMENTED_REVISION',public_records:loaded.records.map(({content_base64:_bytes,...pin})=>pin),records_embedded:false,scope:'STRUCTURAL_TRACEABILITY',qualification_authority:'NONE',private_source_dependency:false};
 return {receipt,receipt_digest:contentDigest(receipt),product_qualification:false};
}
export async function archiveTraceability(input:unknown,context:ComponentContext):Promise<RecordValue>{
 const request=fields(input,['contract_digest','mapping_digest']),loaded=await loadReleaseContract();
 if(digest(request.contract_digest)!==loaded.contract.contract_digest||digest(request.mapping_digest)!==contentDigest(loaded.contract.mappings))invalid('Traceability revision changed');
 const receipt=await traceabilityReceipt(input);
 const archive={schema_version:1,pack_origin:packSource().origin,contract:loaded.contract,validation:receipt,public_records:loaded.records,review_states:loaded.contract.review_states,
 open_qualification_case_ids:loaded.contract.review_states.product_qualification.unresolved_case_ids,private_source_dependency:false,qualification_authority:'NONE'};
 const retained=await persistReleaseArtifact(context,'public_review_pack',archive);
 const fresh=await loadReleaseContract();
 if(fresh.contract.contract_digest!==loaded.contract.contract_digest)invalid('Public release contract changed during archive persistence');
 return {archived:true,contract_digest:loaded.contract.contract_digest,...retained,product_qualification:false};
}
// Validates a controlled/candidate pack: structure first, then self-digest integrity, then the implemented revision.
export async function checkReleasePack(input:unknown):Promise<RecordValue>{
 const pack=parseReleasePack(fields(input,['pack']).pack);
 const observed=validateTraceability(pack);
 const {contract_digest:claimed,...unsigned}=pack;
 if(contentDigest(unsigned)!==claimed)invalid('Tampered release pack digest');
 const current=await loadReleaseContract();
 if(claimed!==current.contract.contract_digest)invalid('Release pack does not match the implemented revision');
 return {accepted:true,contract_digest:claimed,observed,private_source_dependency:false,qualification_authority:'NONE',product_qualification:false};
}
export function createComponent(_context:ComponentContext):Component{
 return {apiVersion:1,actions:{
 'release.traceability.contract':async(input)=>{
 fields(input,[]);const source=packSource(),loaded=await snapshotReleaseContract(source);
 let validation:RecordValue;
 try{validateTraceability(loaded.contract);validation={valid:true,finding:null};}
 catch(error){if(!(error instanceof FoundationError)||error.code!=='CLOSURE_INVALID')throw error;validation={valid:false,finding:error.message};}
 return {contract:loaded.contract,mapping_digest:contentDigest(loaded.contract.mappings),validation,pack_origin:source.origin,implemented_revision:source.origin==='IMPLEMENTED_REVISION',product_qualification:false};},
 'release.traceability.validate':async(input)=>traceabilityReceipt(input),
 'release.traceability.check':async(input)=>checkReleasePack(input),
 'release.traceability.archive':archiveTraceability
 }};
}
