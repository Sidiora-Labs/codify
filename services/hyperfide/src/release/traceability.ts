import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Component,ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {boundedText,canonical,contentDigest,digest,fields,invalid,sha256,stringList,persistReleaseArtifact,type RecordValue} from '../docs/closure.js';

export interface ReleaseTask{id:string;reqs:string[];acceptance_ids:string[];requires:string[];wave:number}
export interface ClauseMapping{id:string;task_ids:string[];acceptance_ids:string[];chapters:string[]}
export interface ReleaseContract{
 clauses:string[];tasks:ReleaseTask[];cases:Record<string,{full_assertion_ids:string[]}>;native_case_requirements:Record<string,string[]>;mappings:ClauseMapping[];
 source_pins:{path:string;sha256:string;size:number}[];contract_digest:string;
}
function exact(a:string[],b:string[]):boolean{return a.length===b.length&&[...a].sort().every((v,i)=>v===[...b].sort()[i]);}
function unique(values:string[],label:string):void{if(new Set(values).size!==values.length)invalid('Duplicate '+label);}
function array(value:unknown,min=0,max=100000):unknown[]{if(!Array.isArray(value)||value.length<min||value.length>max)invalid('Invalid contract list');return value;}
function task(value:unknown):ReleaseTask{
 if(!object(value))invalid('Invalid task contract');
 const taskID=boundedText(value.id);if(!/^[1-9][0-9]*\.[1-9][0-9]*$/.test(taskID))invalid('Invalid task identity');
 if(!Number.isSafeInteger(value.wave)||(value.wave as number)<1)invalid('Invalid task wave');
 return {id:taskID,reqs:stringList(value.reqs),acceptance_ids:stringList(value.acceptance_ids),requires:stringList(value.requires,0),wave:value.wave as number};
}
function mapping(value:unknown):ClauseMapping{
 if(!object(value))invalid('Invalid clause mapping');
 return {id:boundedText(value.id),task_ids:stringList(value.task_ids),acceptance_ids:stringList(value.acceptance_ids),chapters:stringList(value.chapters)};
}
export function validateTraceability(contract:ReleaseContract,mappings:ClauseMapping[]=contract.mappings):RecordValue{
 unique(contract.clauses,'native clause');unique(contract.tasks.map(t=>t.id),'task');unique(mappings.map(m=>m.id),'clause mapping');
 const tasks=new Map(contract.tasks.map(t=>[t.id,t])),cases=Object.keys(contract.cases),mapped=mappings.map(m=>m.id);
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
 if(!exact([...new Set(projected)],requirements))invalid('Native acceptance case/task requirement mismatch');
 }
 for(const m of mappings){
 const owners=contract.tasks.filter(t=>t.reqs.includes(m.id));
 const requiredCases=[...new Set(owners.flatMap(t=>t.acceptance_ids))];
 if(!exact(m.task_ids,owners.map(t=>t.id))||!exact(m.acceptance_ids,requiredCases))invalid('Clause/task/case mapping is not bidirectional');
 if(!m.chapters.length)invalid('Missing public source contract');
 }
 return {valid:true,clauses:contract.clauses.length,tasks:contract.tasks.length,cases:cases.length,
 implementation_approval_is_product_qualification:false,component_receipt_is_full_case:false,
 coverage:mappings.map(m=>({clause:m.id,task_ids:[...m.task_ids],case_ids:[...m.acceptance_ids],chapter_paths:[...m.chapters]}))};
}
const repositoryRoot=path.resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
async function publicFile(relative:string):Promise<Buffer>{
 if(path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(p=>p==='..'||p==='.'||p==='')||relative.includes('/private/'))invalid('Private or escaping traceability source');
 const filename=path.join(repositoryRoot,relative),resolved=await fs.realpath(filename);
 if(resolved!==filename||!resolved.startsWith(repositoryRoot+path.sep))invalid('Traceability source alias is forbidden');
 const info=await fs.lstat(filename);if(!info.isFile()||info.isSymbolicLink()||info.size>16*1024*1024)invalid('Missing/bounded public contract source');return fs.readFile(filename);
}
export async function loadReleaseContract():Promise<{contract:ReleaseContract;records:{path:string;sha256:string;size:number;content_base64:string}[]}>{
 const base='spec/hyperfide/',required=['spec.kvx','evidence/task-catalog.json','evidence/traceability.json','requirements.md','decisions.md','schematics.md','implementation-plan.md','reviews/README.md','traceability.md','verification.md'];
 const buffers=new Map<string,Buffer>();
 for(const name of required)buffers.set(base+name,await publicFile(base+name));
 buffers.set('docs/hyperfide/operations.md',await publicFile('docs/hyperfide/operations.md'));
 const registryBytes=await publicFile('tests/hyperfide/registry.json');buffers.set('tests/hyperfide/registry.json',registryBytes);
 const native=buffers.get(base+'spec.kvx')!.toString('utf8');
 const clauses:string[]=[],nativeCases:Record<string,string[]>={};let section='';
 for(const line of native.split(/\r?\n/u)){const header=/^\[([^\]]+)\]\s*$/u.exec(line);if(header){section=header[1]!;continue;}
 const criterion=/^ac_([1-9][0-9]*)\s*=/u.exec(line);if(section.startsWith('req.')&&criterion)clauses.push(section.slice(4)+'.'+criterion[1]);
 if(section.startsWith('acceptance.')){const selected=/^reqs\s*=\s*(\[.*\])\s*$/u.exec(line);if(selected)nativeCases[section.slice(11)]=stringList(JSON.parse(selected[1]!));}}
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
 for(const m of mappings)for(const chapter of m.chapters){const relative=base+chapter;if(!buffers.has(relative))buffers.set(relative,await publicFile(relative));}
 const sourcePins=[...buffers].map(([name,bytes])=>({path:name,sha256:sha256(bytes),size:bytes.length})).sort((a,b)=>a.path.localeCompare(b.path));
 const unsigned={clauses:clauses.sort(),tasks,cases,native_case_requirements:nativeCases,mappings,source_pins:sourcePins};
 const contract:ReleaseContract={...unsigned,contract_digest:contentDigest(unsigned)};
 validateTraceability(contract);
 for(const [name,bytes]of buffers)if(!(await publicFile(name)).equals(bytes))invalid('Public release contract changed during snapshot');
 return {contract,records:[...buffers].map(([name,bytes])=>({path:name,sha256:sha256(bytes),size:bytes.length,content_base64:bytes.toString('base64')})).sort((a,b)=>a.path.localeCompare(b.path))};
}
export async function traceabilityReceipt(input:unknown):Promise<RecordValue>{
 const request=fields(input,['contract_digest','mapping_digest']),loaded=await loadReleaseContract();
 if(digest(request.contract_digest)!==loaded.contract.contract_digest||digest(request.mapping_digest)!==contentDigest(loaded.contract.mappings))invalid('Traceability revision changed');
 const observed=validateTraceability(loaded.contract);
 const receipt={schema_version:1,kind:'traceability_validation',contract_digest:loaded.contract.contract_digest,mapping_digest:contentDigest(loaded.contract.mappings),
 observed,public_records:loaded.records.map(({content_base64:_bytes,...pin})=>pin),records_embedded:false,scope:'STRUCTURAL_TRACEABILITY',qualification_authority:'NONE',private_source_dependency:false};
 return {receipt,receipt_digest:contentDigest(receipt),product_qualification:false};
}
export async function archiveTraceability(input:unknown,context:ComponentContext):Promise<RecordValue>{
 const request=fields(input,['contract_digest','mapping_digest']),loaded=await loadReleaseContract();
 if(digest(request.contract_digest)!==loaded.contract.contract_digest||digest(request.mapping_digest)!==contentDigest(loaded.contract.mappings))invalid('Traceability revision changed');
 const receipt=await traceabilityReceipt(input);
 const archive={schema_version:1,contract:loaded.contract,validation:receipt,public_records:loaded.records,private_source_dependency:false,qualification_authority:'NONE'};
 const retained=await persistReleaseArtifact(context,'public_review_pack',archive);
 const fresh=await loadReleaseContract();
 if(fresh.contract.contract_digest!==loaded.contract.contract_digest)invalid('Public release contract changed during archive persistence');
 return {archived:true,contract_digest:loaded.contract.contract_digest,...retained,product_qualification:false};
}
export function createComponent(_context:ComponentContext):Component{
 return {apiVersion:1,actions:{
 'release.traceability.contract':async(input)=>{fields(input,[]);const loaded=await loadReleaseContract();return {contract:loaded.contract,mapping_digest:contentDigest(loaded.contract.mappings),product_qualification:false};},
 'release.traceability.validate':async(input)=>traceabilityReceipt(input),
 'release.traceability.archive':archiveTraceability
 }};
}
