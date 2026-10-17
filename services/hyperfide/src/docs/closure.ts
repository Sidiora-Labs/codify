import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {assertPrimaryTransaction,type PrimaryTransaction} from '../storage/transactions.js';
import {invocationOf} from '../identity/enrollment.js';

export type RecordValue=Record<string,unknown>;
export function invalid(message:string):never{throw new FoundationError('CLOSURE_INVALID',message);}
export function fields(value:unknown,required:string[],optional:string[]=[]):RecordValue{
 if(!object(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))invalid('Unexpected or missing closure fields');
 return value;
}
export function boundedText(value:unknown,max=256):string{
 if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0'))invalid('Invalid bounded closure string');return value;
}
export function sha256(value:Uint8Array|string):string{return 'sha256:'+createHash('sha256').update(value).digest('hex');}
export function canonical(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return invalid('Non-JSON closure value');
}
export function contentDigest(value:unknown):string{return sha256(canonical(value));}
export function digest(value:unknown):string{const s=boundedText(value,71);if(!/^sha256:[a-f0-9]{64}$/.test(s))invalid('Invalid digest');return s;}
export function uuid(value:unknown):string{const s=boundedText(value,36);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s))invalid('Invalid UUID');return s;}
export function decimal(value:unknown):string{const s=boundedText(value,20);if(!/^[1-9][0-9]*$/.test(s)||BigInt(s)>9223372036854775807n)invalid('Invalid generation');return s;}
export function stringList(value:unknown,min=1,max=1000):string[]{
 if(!Array.isArray(value)||value.length<min||value.length>max)invalid('Invalid bounded string list');
 const values=value.map(x=>boundedText(x,4096));if(new Set(values).size!==values.length)invalid('Duplicate closure entry');return values;
}
export interface Scope{organisation_id:string;run_id:string}
export interface DocumentationPins{spec_revision_id:string;spec_generation:string;programme_manifest_digest:string;source_manifest_digest:string}
export interface DocumentationInspection{
 status:'CURRENT'|'STALE'|'MISSING'|'HELD';closed:boolean;source_manifest_digest:string;reasons:string[];
 checker_receipt_digest?:string;snapshot_digest?:string;baseline_digest?:string;receipt_id?:string;
}
interface DocumentationPolicy{mode:'auto'|'manual';targets:string[];check_cmd:string}
interface RepositoryVersion{repository_id:string;candidate_head:string;input_manifest_digest:string}
interface BlobSnapshot{path:string;digest:string;size:number;content_base64:string}
interface RepositorySnapshot{repository_id:string;commit:string;tree:string;files:BlobSnapshot[]}
export interface DocumentationPacket{
 schema_version:1;scope:Scope;pins:DocumentationPins;authority_epoch:string;policy:DocumentationPolicy;
 repositories:RepositoryVersion[];snapshot:{repositories:RepositorySnapshot[]};snapshot_digest:string;previous_baseline_digest:string|null;
}
function safeRelative(value:unknown):string{
 const s=boundedText(value,4096);if(path.isAbsolute(s)||s.includes('\\')||s.split('/').some(x=>x==='..'||x==='.'||x===''))invalid('Unsafe documentation path');return s;
}
function policyFromDocument(document:unknown):DocumentationPolicy{
 if(!object(document)||!object(document.parsed)||!Array.isArray(document.parsed.sections))invalid('Accepted documentation policy is unavailable');
 const sections=document.parsed.sections.filter(s=>object(s)&&s.name==='documentation');
 if(sections.length!==1)invalid('One explicit accepted documentation policy is required');
 const section=sections[0] as RecordValue;
 if(!object(section.fields))invalid('Unsupported accepted documentation fields');
 const settings:RecordValue={};
 for(const [name,raw]of Object.entries(section.fields)){if(!object(raw)||raw.key!==name||!Object.hasOwn(raw,'value'))invalid('Ambiguous documentation policy');settings[name]=raw.value;}
 if(settings.mode!=='auto'&&settings.mode!=='manual')throw new FoundationError('DOCS_HELD','Documentation closure requires an explicit accepted auto or manual mode; off is not success');
 const targets=stringList(settings.targets,1,256).map(safeRelative);
 const command=boundedText(settings.check_cmd??'./cg docs check --json',16384);
 if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(command))invalid('Invalid documentation checker command');
 return {mode:settings.mode,targets,check_cmd:command};
}
async function requireSchema(db:Pick<PrimaryTransaction,'query'>):Promise<void>{
 const expected=sha256(await fs.readFile(new URL('../../migrations/0028-documentation.sql',import.meta.url)));
 const r=await db.query("SELECT to_regclass('hyperfide.documentation_closures') AS relation,(SELECT checksum FROM hyperfide.schema_migrations WHERE version=28) AS checksum");
 if(!r.rows[0]?.relation||r.rows[0]?.checksum!==expected)throw new FoundationError('DOCS_SCHEMA_REQUIRED','Dedicated documentation migration and its exact checksum must be applied by the migration operator');
}
async function current(db:Pick<PrimaryTransaction,'query'>,scope:Scope):Promise<{spec_revision_id:string;spec_generation:string;authority_epoch:string;document:unknown}>{
 const result=await db.query<{spec_revision_id:string;spec_generation:string;authority_epoch:string;document:unknown}>("SELECT r.spec_revision_id,r.spec_generation::text,r.authority_epoch,s.document FROM hyperfide.runs r JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id WHERE r.organisation_id=$1 AND r.id=$2 FOR SHARE OF r",[scope.organisation_id,scope.run_id]);
 if(result.rows.length!==1)invalid('Unknown documentation run');return result.rows[0]!;
}
async function repositoryVersions(db:Pick<PrimaryTransaction,'query'>,scope:Scope):Promise<RepositoryVersion[]>{
 const result=await db.query("SELECT rr.repository_id,p.candidate_head,c.input_manifest_digest FROM hyperfide.run_repositories rr LEFT JOIN LATERAL(SELECT op.* FROM hyperfide.publication_operations op WHERE op.organisation_id=rr.organisation_id AND op.run_id=rr.run_id AND op.repository_id=rr.repository_id AND op.state='PUBLISHED' AND op.observed_head=op.candidate_head ORDER BY op.created_at DESC,op.id DESC LIMIT 1)p ON true LEFT JOIN hyperfide.integration_candidates c ON c.organisation_id=p.organisation_id AND c.run_id=p.run_id AND c.id=p.candidate_id WHERE rr.organisation_id=$1 AND rr.run_id=$2 ORDER BY rr.repository_id",[scope.organisation_id,scope.run_id]);
 if(!result.rows.length||result.rows.some(r=>!r.candidate_head||!r.input_manifest_digest))invalid('Every run repository requires an exact observed PUBLISHED operation');
 return result.rows.map(r=>({repository_id:uuid(r.repository_id),candidate_head:boundedText(r.candidate_head,64),input_manifest_digest:digest(r.input_manifest_digest)}));
}
function pins(value:unknown):DocumentationPins{
 const p=fields(value,['spec_revision_id','spec_generation','programme_manifest_digest','source_manifest_digest']);
 return {spec_revision_id:uuid(p.spec_revision_id),spec_generation:decimal(p.spec_generation),programme_manifest_digest:digest(p.programme_manifest_digest),source_manifest_digest:digest(p.source_manifest_digest)};
}
async function assertCurrent(db:Pick<PrimaryTransaction,'query'>,scope:Scope,p:DocumentationPins,epoch?:string):Promise<{policy:DocumentationPolicy;versions:RepositoryVersion[];authority_epoch:string}>{
 const run=await current(db,scope);
 if(run.spec_revision_id!==p.spec_revision_id||run.spec_generation!==p.spec_generation||epoch&&run.authority_epoch!==epoch)throw new FoundationError('DOCS_STALE','Documentation accepted revision or authority changed');
 const policy=policyFromDocument(run.document),versions=await repositoryVersions(db,scope);
 if(contentDigest(versions)!==p.source_manifest_digest)throw new FoundationError('DOCS_STALE','Integrated documentation inputs changed');
 return {policy,versions,authority_epoch:run.authority_epoch};
}
async function git(root:string,args:string[],signal?:AbortSignal):Promise<Buffer>{
 return new Promise((resolve,reject)=>execFile('git',['-C',root,...args],{encoding:'buffer',timeout:10000,maxBuffer:64*1024*1024,...(signal?{signal}:{})},(error,stdout)=>error?reject(new FoundationError('DOCS_SOURCE_UNAVAILABLE','Exact Git documentation snapshot is unavailable')):resolve(stdout)));
}
function matches(pattern:string,name:string):boolean{
 let regex='^';for(let i=0;i<pattern.length;i++){
 const c=pattern[i]!;
 if(c==='*'){if(pattern[i+1]==='*'){i++;if(pattern[i+1]==='/'){i++;regex+='(?:.*/)?';}else regex+='.*';}else regex+='[^/]*';}
 else if(c==='?')regex+='[^/]';else regex+=c.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&');
 }return new RegExp(regex+'$','u').test(name);
}
async function snapshot(context:ComponentContext,scope:Scope,versions:RepositoryVersion[],policy:DocumentationPolicy):Promise<{repositories:RepositorySnapshot[]}>{
 let roots:unknown;try{roots=JSON.parse(context.env.HYPERFIDE_REPOSITORY_ROOTS??'');}catch{invalid('Trusted repository roots are required');}
 if(!object(roots))invalid('Trusted repository roots are required');
 const repositories:RepositorySnapshot[]=[];let total=0;
 for(const version of versions){
 const key=[scope.organisation_id,scope.run_id,version.repository_id].join('/');
 const configured=roots[key];if(typeof configured!=='string'||!path.isAbsolute(configured))invalid('Missing trusted run-scoped repository root');
 const root=await fs.realpath(configured);if(root!==path.resolve(configured))invalid('Repository root aliases are forbidden');
 const tree=(await git(root,['rev-parse',version.candidate_head+'^{tree}'],context.signal)).toString('utf8').trim();
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tree))invalid('Invalid exact Git tree');
 const entries=(await git(root,['ls-tree','-rz','--full-tree',version.candidate_head],context.signal)).toString('utf8').split('\0').filter(Boolean);
 if(entries.length>1000000)invalid('Repository inventory exceeds bounded documentation profile');
 const files:BlobSnapshot[]=[],matched=new Set<string>();
 for(const entry of entries){
 const tab=entry.indexOf('\t'),header=entry.slice(0,tab).split(' '),name=safeRelative(entry.slice(tab+1));
 const targets=policy.targets.filter(p=>matches(p,name));if(!targets.length)continue;
 if(!['100644','100755'].includes(header[0]??'')||header[1]!=='blob')invalid('Documentation targets must be regular Git blobs');
 const bytes=await git(root,['cat-file','blob',header[2]!],context.signal);total+=bytes.length;
 if(bytes.length>8*1024*1024||total>32*1024*1024)invalid('Documentation snapshot exceeds bounded profile');
 targets.forEach(p=>matched.add(p));files.push({path:name,digest:sha256(bytes),size:bytes.length,content_base64:bytes.toString('base64')});
 }
 if(policy.targets.some(p=>!matched.has(p)))invalid('A configured documentation target has no exact candidate file');
 files.sort((a,b)=>a.path.localeCompare(b.path));repositories.push({repository_id:version.repository_id,commit:version.candidate_head,tree,files});
 }return {repositories};
}
export async function inspectDocumentationClosure(db:Pick<PrimaryTransaction,'query'>,scope:Scope,p:DocumentationPins):Promise<DocumentationInspection>{
 assertPrimaryTransaction(db);await requireSchema(db);p=pins(p);scope={organisation_id:uuid(scope.organisation_id),run_id:uuid(scope.run_id)};
 let epoch:string;
 try{epoch=(await assertCurrent(db,scope,p)).authority_epoch;}catch(error){
 if(error instanceof FoundationError&&['DOCS_STALE','DOCS_HELD','CLOSURE_INVALID'].includes(error.code))return {status:error.code==='DOCS_STALE'?'STALE':'HELD',closed:false,source_manifest_digest:p.source_manifest_digest,reasons:[error.message]};throw error;
 }
 const rows=await db.query("SELECT c.id,c.closure_digest,c.payload AS closure,c.canonical_content AS closure_bytes,b.baseline_digest,b.snapshot_digest,b.payload AS baseline,b.canonical_content AS baseline_bytes,ch.checker_receipt_digest,ch.outcome,ch.payload AS checker,ch.canonical_content AS checker_bytes,j.state,p.payload AS packet,p.packet_digest,p.canonical_content AS packet_bytes FROM hyperfide.documentation_closures c JOIN hyperfide.documentation_packets p ON p.organisation_id=c.organisation_id AND p.run_id=c.run_id AND p.id=c.packet_id JOIN hyperfide.documentation_baselines b ON b.organisation_id=c.organisation_id AND b.run_id=c.run_id AND b.id=c.baseline_id JOIN hyperfide.documentation_checks ch ON ch.organisation_id=c.organisation_id AND ch.run_id=c.run_id AND ch.id=c.check_id JOIN hyperfide.documentation_jobs j ON j.organisation_id=ch.organisation_id AND j.run_id=ch.run_id AND j.id=ch.job_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND p.spec_revision_id=$3 AND p.spec_generation=$4 AND p.source_manifest_digest=$5 AND p.programme_manifest_digest=$6 ORDER BY c.created_at DESC,c.id DESC LIMIT 1",[scope.organisation_id,scope.run_id,p.spec_revision_id,p.spec_generation,p.source_manifest_digest,p.programme_manifest_digest]);
 const row=rows.rows[0];if(!row)return {status:'MISSING',closed:false,source_manifest_digest:p.source_manifest_digest,reasons:['No exact durable documentation closure']};
 if(!object(row.packet)||row.packet.authority_epoch!==epoch)return {status:'STALE',closed:false,source_manifest_digest:p.source_manifest_digest,reasons:['Documentation closure belongs to a previous authority epoch']};
 const checks:[unknown,unknown,unknown][]=[[row.closure,row.closure_bytes,row.closure_digest],[row.baseline,row.baseline_bytes,row.baseline_digest],[row.checker,row.checker_bytes,row.checker_receipt_digest],[row.packet,row.packet_bytes,row.packet_digest]];
 if(checks.some(([value,bytes,hash])=>canonical(value)!==bytes||sha256(String(bytes))!==hash)||row.outcome!=='PASS'||row.state!=='SUCCEEDED'||!object(row.baseline)||!object(row.packet)||contentDigest(row.packet.snapshot)!==row.snapshot_digest||canonical(row.baseline.snapshot)!==canonical(row.packet.snapshot))return {status:'HELD',closed:false,source_manifest_digest:p.source_manifest_digest,reasons:['Durable checker, snapshot or baseline integrity failed']};
 try{
 if(!object(row.closure)||!Array.isArray(row.closure.checks))invalid('Closure lacks independent repository checker references');
 const ids=row.closure.checks.map((v:unknown)=>{if(!object(v))invalid('Invalid stored checker reference');return uuid(v.check_id);});
 const checked=await validatedDocumentationChecks(db,scope,uuid(row.closure.packet_id),ids,row.packet as unknown as DocumentationPacket);
 if(canonical(checked)!==canonical(row.closure.checks)||canonical(checked)!==canonical(row.baseline.checks))invalid('Stored closure/baseline checker references differ');
 }catch(error){return {status:'HELD',closed:false,source_manifest_digest:p.source_manifest_digest,reasons:[error instanceof Error?error.message:'Independent documentation receipts are invalid']};}
 return {status:'CURRENT',closed:true,source_manifest_digest:p.source_manifest_digest,reasons:[],checker_receipt_digest:row.checker_receipt_digest,snapshot_digest:row.snapshot_digest,baseline_digest:row.baseline_digest,receipt_id:row.id};
}
export async function packetDocumentation(input:unknown,context:ComponentContext):Promise<unknown>{
 const request=fields(input,['pins']),p=pins(request.pins),i=invocationOf(context);
 const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
 const selected=await context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{await requireSchema(tx);return assertCurrent(tx,scope,p);});
 const files=await snapshot(context,scope,selected.versions,selected.policy);
 return context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{
 await assertCurrent(tx,scope,p,selected.authority_epoch);
 const previous=await tx.query("SELECT baseline_digest FROM hyperfide.documentation_baselines WHERE organisation_id=$1 AND run_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",[scope.organisation_id,scope.run_id]);
 const packet:DocumentationPacket={schema_version:1,scope,pins:p,authority_epoch:selected.authority_epoch,policy:selected.policy,repositories:selected.versions,snapshot:files,snapshot_digest:contentDigest(files),previous_baseline_digest:previous.rows[0]?.baseline_digest??null};
 const bytes=canonical(packet),hash=sha256(bytes);
 const existing=await tx.query("SELECT id,packet_digest,payload FROM hyperfide.documentation_packets WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3",[scope.organisation_id,scope.run_id,i.operation.idempotency_key]);
 if(existing.rows.length){const old=existing.rows[0]!.payload as DocumentationPacket;if(canonical(old.pins)!==canonical(p)||old.authority_epoch!==packet.authority_epoch||old.snapshot_digest!==packet.snapshot_digest||canonical(old.policy)!==canonical(packet.policy))invalid('Documentation request identity was reused with changed inputs');return {packet_id:existing.rows[0]!.id,packet_digest:existing.rows[0]!.packet_digest,snapshot_digest:old.snapshot_digest,replayed:true};}
 const id=randomUUID();await tx.query("INSERT INTO hyperfide.documentation_packets(organisation_id,run_id,id,request_id,spec_revision_id,spec_generation,authority_epoch,source_manifest_digest,programme_manifest_digest,packet_digest,canonical_content,payload)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)",[scope.organisation_id,scope.run_id,id,i.operation.idempotency_key,p.spec_revision_id,p.spec_generation,selected.authority_epoch,p.source_manifest_digest,p.programme_manifest_digest,hash,bytes,bytes]);
 return {packet_id:id,packet_digest:hash,snapshot_digest:packet.snapshot_digest,previous_baseline_digest:packet.previous_baseline_digest,virtual_role:'@docs',closed:false,dispatches_new_run:false};
 });
}
export async function closeDocumentation(input:unknown,context:ComponentContext):Promise<unknown>{
 const request=fields(input,['packet_id'],['check_id','check_ids']);
 if((request.check_id===undefined)===(request.check_ids===undefined))invalid('Provide check_id or check_ids, exclusively');
 const checkIDs=(request.check_ids===undefined?[uuid(request.check_id)]:stringList(request.check_ids,1,1024).map(uuid)).sort();
 const packetID=uuid(request.packet_id),checkID=checkIDs[0]!,i=invocationOf(context);
 const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
 return context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{
 await requireSchema(tx);
 const selected=await tx.query("SELECT p.payload,p.packet_digest,ch.payload AS checker,ch.checker_receipt_digest,ch.outcome,j.state FROM hyperfide.documentation_packets p JOIN hyperfide.documentation_checks ch ON ch.organisation_id=p.organisation_id AND ch.run_id=p.run_id AND ch.packet_id=p.id JOIN hyperfide.documentation_jobs j ON j.organisation_id=ch.organisation_id AND j.run_id=ch.run_id AND j.id=ch.job_id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.id=$3 AND ch.id=$4 FOR UPDATE OF j",[scope.organisation_id,scope.run_id,packetID,checkID]);
 const row=selected.rows[0];if(!row||row.outcome!=='PASS'||row.state!=='SUCCEEDED')throw new FoundationError('DOCS_CHECK_REQUIRED','A durable independently observed successful checker receipt is required');
 const packet=row.payload as DocumentationPacket;await assertCurrent(tx,scope,packet.pins,packet.authority_epoch);
 const independentChecks=await validatedDocumentationChecks(tx,scope,packetID,checkIDs,packet);
 if(contentDigest(packet)!==row.packet_digest||contentDigest(packet.snapshot)!==packet.snapshot_digest)invalid('Packet snapshot digest mismatch');
 const baseline={schema_version:1,packet_id:packetID,packet_digest:row.packet_digest,check_id:checkID,checks:independentChecks,checker_receipt_digest:row.checker_receipt_digest,snapshot:packet.snapshot,snapshot_digest:packet.snapshot_digest,source_manifest_digest:packet.pins.source_manifest_digest};
 const baselineBytes=canonical(baseline),baselineDigest=sha256(baselineBytes),baselineID=randomUUID();
 const b=await tx.query("INSERT INTO hyperfide.documentation_baselines(organisation_id,run_id,id,packet_id,check_id,baseline_digest,snapshot_digest,canonical_content,payload)VALUES($1,$2,$3,$4,$5,$6,$7,$8::text,$8::text::jsonb)ON CONFLICT(organisation_id,run_id,packet_id,check_id)DO NOTHING RETURNING id",[scope.organisation_id,scope.run_id,baselineID,packetID,checkID,baselineDigest,packet.snapshot_digest,baselineBytes]);
 const actual=b.rows[0]?.id??(await tx.query("SELECT id FROM hyperfide.documentation_baselines WHERE organisation_id=$1 AND run_id=$2 AND packet_id=$3 AND check_id=$4 AND baseline_digest=$5",[scope.organisation_id,scope.run_id,packetID,checkID,baselineDigest])).rows[0]?.id;
 if(!actual)invalid('Documentation baseline persistence failed');
 const receipt={schema_version:1,packet_id:packetID,check_id:checkID,checks:independentChecks,baseline_id:actual,baseline_digest:baselineDigest,snapshot_digest:packet.snapshot_digest,checker_receipt_digest:row.checker_receipt_digest,pins:packet.pins};
 const bytes=canonical(receipt),closureDigest=sha256(bytes);
 await tx.query("INSERT INTO hyperfide.documentation_closures(organisation_id,run_id,packet_id,check_id,baseline_id,baseline_digest,snapshot_digest,checker_receipt_digest,closure_digest,canonical_content,payload)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text,$10::text::jsonb)ON CONFLICT(organisation_id,run_id,packet_id,check_id,baseline_id)DO NOTHING",[scope.organisation_id,scope.run_id,packetID,checkID,actual,baselineDigest,packet.snapshot_digest,row.checker_receipt_digest,closureDigest,bytes]);
 const result=await inspectDocumentationClosure(tx,scope,packet.pins);if(!result.closed)invalid('Documentation closure could not be independently retrieved');return {...result,closure_digest:closureDigest,dispatches_new_run:false};
 });
}
export function createClosureComponent(_context:ComponentContext):Component{
 return {apiVersion:1,actions:{
 'docs.packet':packetDocumentation,'docs.close':closeDocumentation,
 'docs.inspect':async(input,context)=>{
 const r=fields(input,['pins']),i=invocationOf(context);return context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},tx=>inspectDocumentationClosure(tx,{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id},pins(r.pins)));
 }}};
}

interface DurableArtifactFacade{invoke(action:string,input:unknown,context:ComponentContext):Promise<unknown>}
function artifactFacade(value:unknown):value is DurableArtifactFacade{return object(value)&&typeof value.invoke==='function';}
function admittedArtifact(value:unknown,scope:Scope,expected?:{digest:string;size:string}):RecordValue{
 if(!object(value)||value.outcome!=='SUCCEEDED'||value.availability!=='VERIFIED'||!object(value.artifact)||!object(value.receipt))throw new FoundationError('RELEASE_ARTIFACT_UNAVAILABLE','Durable artifact outcome is absent or unknown');
 const a=value.artifact,r=value.receipt;
 if(a.status!=='COMPLETE'||a.organisation_id!==scope.organisation_id||a.run_id!==scope.run_id||r.artifact_id!==a.artifact_id||r.digest!==a.digest||r.size_bytes!==a.size_bytes||expected&&(a.digest!==expected.digest||a.size_bytes!==expected.size))invalid('Durable artifact scope/content receipt mismatch');
 uuid(a.artifact_id);digest(a.digest);return value;
}
export async function persistReleaseArtifact(context:ComponentContext,kind:string,payload:unknown):Promise<RecordValue>{
 const i=invocationOf(context),scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
 const store=context.dependencies.require('15.2','artifact.store.v1',artifactFacade);
 const bytes=Buffer.from(canonical({schema_version:1,kind:boundedText(kind),payload})),content=sha256(bytes);
 if(bytes.length>32*1024*1024)invalid('Release record exceeds bounded artifact profile');
 const retention={retention_class:'RELEASE',retention_until:null,retention_hold:false};
 const chunks:{sequence:number;artifact_id:string;digest:string;size_bytes:string;offset_bytes:string}[]=[];
 for(let offset=0;offset<bytes.length;offset+=262144){
 const part=bytes.subarray(offset,offset+262144),hash=sha256(part),size=String(part.length);
 const uploaded=admittedArtifact(await store.invoke('artifact.object.put',{...scope,digest:hash,size_bytes:size,data_base64:part.toString('base64'),...retention},context),scope,{digest:hash,size});
 const a=uploaded.artifact as RecordValue;
 chunks.push({sequence:chunks.length,artifact_id:uuid(a.artifact_id),digest:hash,size_bytes:size,offset_bytes:String(offset)});
 if(bytes.length<=262144)return {artifact:uploaded.artifact,receipt:uploaded.receipt,content_digest:content,size_bytes:String(bytes.length),manifest:false,grants_authority:false};
 }
 const committed=admittedArtifact(await store.invoke('artifact.manifest.commit',{...scope,expected_chunks:chunks.length,total_size_bytes:String(bytes.length),content_digest:content,complete:true,truncated:false,missing_ranges:[],chunks,...retention},context),scope);
 const a=committed.artifact as RecordValue;
 const checked=await store.invoke('artifact.manifest.read',{...scope,artifact_id:uuid(a.artifact_id)},context);
 if(!object(checked)||checked.outcome!=='SUCCEEDED'||checked.availability!=='VERIFIED'||!object(checked.manifest)||checked.manifest.content_digest!==content||checked.manifest.total_size_bytes!==String(bytes.length)||checked.manifest.complete!==true)throw new FoundationError('RELEASE_ARTIFACT_UNAVAILABLE','Retained release manifest could not be independently retrieved');
 return {artifact:committed.artifact,receipt:committed.receipt,content_digest:content,size_bytes:String(bytes.length),manifest:true,grants_authority:false};
}

interface DocumentationRemotePlan{
 session_id:string;operation_id:string;repository_id:string;reservation_id:string;job_id:string;job_kind:string;task_id:string;
 argv:string[];cwd:string;environment:Record<string,string>;stdin:string;timeout_ms:number;
 source_digest:string;policy_digest:string;executable_digest:string;environment_digest:string;artifact_paths:string[];
}
interface DocumentationRemote{
 prepare(tx:PrimaryTransaction,invocation:ReturnType<typeof invocationOf>,plan:DocumentationRemotePlan):Promise<object>;
 execute(permit:object,signal:AbortSignal):Promise<RecordValue>;
}
const documentationCheckScript="import hashlib,json,os,pathlib,resource,subprocess,sys,tempfile\ndef canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()\ndef digest(b):return 'sha256:'+hashlib.sha256(b).hexdigest()\nv=json.load(sys.stdin);repo=v['repository']\ndef git(*args):return subprocess.check_output(['git',*args],timeout=15).decode().strip()\ndef observe():\n    if git('rev-parse','HEAD')!=repo['commit']or git('rev-parse','HEAD^{tree}')!=repo['tree']:raise RuntimeError('exact repository revision changed')\n    found=[]\n    for entry in repo['files']:\n        p=pathlib.Path(entry['path'])\n        if p.is_symlink()or not p.is_file():raise RuntimeError('documentation target is not a regular file')\n        b=p.read_bytes()\n        if len(b)!=entry['size']or digest(b)!=entry['digest']:raise RuntimeError('documentation target differs from packet')\n        found.append({'path':entry['path'],'digest':digest(b),'size':len(b)})\n    return found\nbefore=observe()\ndef limits():resource.setrlimit(resource.RLIMIT_FSIZE,(16777216,16777216))\nwith tempfile.TemporaryFile()as out,tempfile.TemporaryFile()as err:\n    p=subprocess.run(['/bin/sh','-lc',v['command']],stdin=subprocess.DEVNULL,stdout=out,stderr=err,timeout=v['command_timeout_seconds'],preexec_fn=limits)\n    out.seek(0);raw=out.read(8388609);err.seek(0);errors=err.read(8388609)\n    if len(raw)>8388608 or len(errors)>8388608:raise RuntimeError('checker output exceeds bounded profile')\n    report=json.loads(raw)\n    if p.returncode!=0 or not isinstance(report,dict)or report.get('ok')is not True or type(report.get('checks'))is not int or report['checks']<1 or report.get('errors')!=0:raise RuntimeError('deterministic checker did not pass')\n    lines=report.get('report','').splitlines()\n    if len(lines)!=report['checks']or any(not line.startswith('ok  ')for line in lines):raise RuntimeError('deterministic assertion inventory is incomplete')\n    after=observe()\n    if before!=after:raise RuntimeError('checker modified packet documentation')\n    print(canonical({'schema_version':1,'kind':'documentation_check','packet_digest':v['packet_digest'],'snapshot_digest':v['snapshot_digest'],'source_manifest_digest':v['source_manifest_digest'],'repository_id':repo['repository_id'],'commit':repo['commit'],'tree':repo['tree'],'targets':after,'checker_report':report,'checker_stdout_digest':digest(raw),'checker_stderr_digest':digest(errors),'passed':True}).decode())\n";
export function validateDocumentationResult(value:unknown,packet:DocumentationPacket,packetDigest:string,repositoryID:string):RecordValue{
 const result=fields(value,['schema_version','kind','packet_digest','snapshot_digest','source_manifest_digest','repository_id','commit','tree','targets','checker_report','checker_stdout_digest','checker_stderr_digest','passed']);
 const repo=packet.snapshot.repositories.find(r=>r.repository_id===repositoryID);
 if(!repo||result.schema_version!==1||result.kind!=='documentation_check'||result.passed!==true||result.packet_digest!==packetDigest||result.snapshot_digest!==packet.snapshot_digest||result.source_manifest_digest!==packet.pins.source_manifest_digest||result.repository_id!==repo.repository_id||result.commit!==repo.commit||result.tree!==repo.tree)invalid('Deterministic documentation checker scope/source differs');
 const targets=repo.files.map(({path,digest,size})=>({path,digest,size}));
 if(canonical(targets)!==canonical(result.targets))invalid('Checker did not observe every exact documentation blob');
 const report=result.checker_report;
 if(!object(report)||report.ok!==true||!Number.isSafeInteger(report.checks)||(report.checks as number)<1||report.errors!==0||typeof report.report!=='string')invalid('Checker report is absent or unsuccessful');
 const lines=report.report.trimEnd().split('\n');
 if(lines.length!==report.checks||lines.some(line=>!line.startsWith('ok  ')))invalid('Checker named assertion inventory is incomplete');
 digest(result.checker_stdout_digest);digest(result.checker_stderr_digest);return result;
}
function remoteCaptured(value:unknown):Buffer{
 if(!object(value)||!(value.bytes instanceof Uint8Array)||value.complete!==true||typeof value.size_bytes!=='string')invalid('Complete actual runner stream is required');
 const bytes=Buffer.from(value.bytes);
 if(bytes.length>16*1024*1024||String(bytes.length)!==value.size_bytes||sha256(bytes)!==value.digest)invalid('Captured runner bytes do not match their receipt');
 return bytes;
}
export async function checkDocumentation(input:unknown,context:ComponentContext):Promise<unknown>{
 const request=fields(input,['packet_id','repository_id','runner_session_id','reservation_id']);
 const packetID=uuid(request.packet_id),repositoryID=uuid(request.repository_id),runnerSession=uuid(request.runner_session_id),reservationID=uuid(request.reservation_id),i=invocationOf(context);
 if(i.principal.role!=='VERIFIER')throw new FoundationError('DOCS_VERIFIER_REQUIRED','A dedicated authenticated verifier and TEST reservation are required');
 const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id};
 const allocations=context.dependencies.require('5.1','scheduler.allocations.v1',(v:unknown):v is {readJobAllocation(tx:PrimaryTransaction,input:RecordValue):Promise<RecordValue|null>;assertJobReservation(tx:PrimaryTransaction,input:RecordValue):Promise<RecordValue>}=>object(v)&&typeof v.readJobAllocation==='function'&&typeof v.assertJobReservation==='function');
 let imported:unknown;try{imported=await import(new URL('../runner/bridge.js',import.meta.url).href);}catch{throw new FoundationError('DOCS_RUNNER_REQUIRED','Actual remote runner capability is unavailable');}
 if(!object(imported)||typeof imported.requireRunnerRemote!=='function')invalid('Actual remote runner factory is required');
 const remote=(imported.requireRunnerRemote as (ctx:ComponentContext)=>DocumentationRemote)(context);
 const configured=JSON.parse(context.env.HYPERFIDE_DOCUMENTATION_EXECUTION_PROFILE??'null') as unknown;
 const profile=fields(configured,['python_executable','executable_digest','environment','timeout_ms']);
 const executable=boundedText(profile.python_executable,4096);
 if(!path.isAbsolute(executable)||!object(profile.environment)||Object.values(profile.environment).some(v=>typeof v!=='string')||!Number.isSafeInteger(profile.timeout_ms)||(profile.timeout_ms as number)<1000||(profile.timeout_ms as number)>3600000)invalid('Trusted bounded documentation execution profile is required');
 const executableDigest=digest(profile.executable_digest),environment=profile.environment as Record<string,string>,timeout=profile.timeout_ms as number;
 const prepared=await context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{
 await requireSchema(tx);
 const selected=(await tx.query('SELECT payload,packet_digest FROM hyperfide.documentation_packets WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[scope.organisation_id,scope.run_id,packetID])).rows[0];
 if(!selected)invalid('Unknown scoped documentation packet');
 const packet=selected.payload as DocumentationPacket,packetDigest=digest(selected.packet_digest);
 if(contentDigest(packet)!==packetDigest)invalid('Documentation packet bytes changed');
 await assertCurrent(tx,scope,packet.pins,packet.authority_epoch);
 const repo=packet.snapshot.repositories.find(r=>r.repository_id===repositoryID);if(!repo)invalid('Repository is not part of this packet');
 const binding=(await tx.query("SELECT source_digest,source_object_id,source_tree_id,repository_id FROM hyperfide.runner_registry WHERE organisation_id=$1 AND run_id=$2 AND session_id=$3 AND state='CURRENT' FOR SHARE",[scope.organisation_id,scope.run_id,runnerSession])).rows[0];
 if(!binding||binding.repository_id!==repo.repository_id||binding.source_object_id!==repo.commit||binding.source_tree_id!==repo.tree)invalid('Verifier workspace must contain the exact packet Git commit/tree');
 const allocation=await allocations.readJobAllocation(tx,{...scope,reservation_id:reservationID});
 if(!allocation||allocation.job_kind!=='TEST'||allocation.assignee_session_id!==i.principal.actor_id)invalid('Independent TEST allocation must belong to this verifier');
 await allocations.assertJobReservation(tx,{...scope,task_id:allocation.task_id,job_kind:'TEST',reservation_id:reservationID});
 const reservation=(await tx.query("SELECT expires_at FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='ALLOCATED' FOR SHARE",[scope.organisation_id,scope.run_id,reservationID])).rows[0];
 if(!reservation)invalid('Allocated documentation reservation is required');
 const prior=(await tx.query('SELECT * FROM hyperfide.documentation_jobs WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,i.operation.idempotency_key])).rows[0];
 const jobID=prior?.id??randomUUID(),operationID=prior?.remote_operation_id??i.operation.operation_id;
 const stdin=canonical({packet_digest:packetDigest,snapshot_digest:packet.snapshot_digest,source_manifest_digest:packet.pins.source_manifest_digest,repository:{...repo,files:repo.files.map(({path,digest,size})=>({path,digest,size}))},command:packet.policy.check_cmd,command_timeout_seconds:Math.max(1,Math.floor(timeout/1000)-5)});
 if(Buffer.byteLength(stdin)>65536)invalid('Documentation checker packet exceeds the bounded remote input profile');
 const policyDigest=contentDigest({packet_digest:packetDigest,repository_id:repositoryID,command:packet.policy.check_cmd,script:documentationCheckScript,executable_digest:executableDigest,environment,timeout_ms:timeout});
 if(prior&&(prior.packet_id!==packetID||prior.policy_digest!==policyDigest||prior.verifier_session_id!==i.principal.actor_id))invalid('Documentation request identity changed');
 if(prior&&['SUCCEEDED','FAILED','UNKNOWN'].includes(prior.state))return {terminal:true,job:prior};
 const plan:DocumentationRemotePlan={session_id:runnerSession,operation_id:operationID,repository_id:repositoryID,reservation_id:reservationID,job_id:jobID,job_kind:'TEST',task_id:uuid(allocation.task_id),argv:[executable,'-c',documentationCheckScript],cwd:'.',environment,stdin,timeout_ms:timeout,source_digest:digest(binding.source_digest),policy_digest:policyDigest,executable_digest:executableDigest,environment_digest:contentDigest(environment),artifact_paths:[]};
 const permit=await remote.prepare(tx,i,plan);
 await tx.query("INSERT INTO hyperfide.documentation_jobs(organisation_id,run_id,id,request_id,packet_id,packet_digest,state,verifier_session_id,lease_expires_at,policy_digest,remote_operation_id,prepared_permit_digest)VALUES($1,$2,$3,$4,$5,$6,'RUNNING',$7,$8,$9,$10,$11)ON CONFLICT(organisation_id,run_id,request_id)DO NOTHING",[scope.organisation_id,scope.run_id,jobID,i.operation.idempotency_key,packetID,packetDigest,i.principal.actor_id,reservation.expires_at,policyDigest,operationID,contentDigest(plan)]);
 return {terminal:false,permit,plan,packet,packetDigest,jobID};
 });
 if(prepared.terminal){const job=prepared.job;if(!job)invalid('Durable documentation job is missing');return {job_id:job.id,state:job.state,replayed:true,closed:false,requires_reconciliation:job.state==='UNKNOWN'};}
 let observed:RecordValue;
 try{observed=await remote.execute(prepared.permit!,i.signal);}catch(error){
 await context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{await tx.query("UPDATE hyperfide.documentation_jobs SET state='UNKNOWN' WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='RUNNING'",[scope.organisation_id,scope.run_id,prepared.jobID]);});
 throw error;
 }
 let out:Buffer,err:Buffer;
 try{out=remoteCaptured(observed.stdout);err=remoteCaptured(observed.stderr);}catch(error){
 await context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{await tx.query("UPDATE hyperfide.documentation_jobs SET state='UNKNOWN' WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='RUNNING'",[scope.organisation_id,scope.run_id,prepared.jobID]);});
 throw error;
 }
 let report:RecordValue|null=null,reason:string|null=null;
 try{
 requireDocumentationCleanup(observed);
 if(observed.outcome!=='SUCCEEDED'||observed.status!=='COMPLETED'||observed.exit_code!==0||observed.output_complete!==true||observed.operation_id!==prepared.plan!.operation_id||observed.session_id!==runnerSession||observed.repository_id!==repositoryID||observed.source_digest!==prepared.plan!.source_digest||observed.policy_digest!==prepared.plan!.policy_digest||observed.executable_digest!==executableDigest||observed.environment_digest!==prepared.plan!.environment_digest)invalid('Observed checker process identity or outcome differs');
 report=validateDocumentationResult(JSON.parse(out.toString('utf8')),prepared.packet!,prepared.packetDigest!,repositoryID);
 }catch(error){reason=error instanceof Error?error.message:'Checker report is invalid';}
 return context.resources.gateway.withPrimaryTransaction({signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{
 await assertCurrent(tx,scope,prepared.packet!.pins,prepared.packet!.authority_epoch);
 const locked=(await tx.query('SELECT *,clock_timestamp() AS db_now FROM hyperfide.documentation_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,prepared.jobID])).rows[0];
 if(!locked||locked.state!=='RUNNING'||locked.verifier_session_id!==i.principal.actor_id||new Date(locked.lease_expires_at).getTime()<=new Date(locked.db_now).getTime())invalid('Documentation verifier lease expired before receipt admission');
 const outcome=report?'PASS':'FAIL',checkID=randomUUID();
 const receipt={schema_version:1,kind:'documentation_checker_receipt',packet_id:packetID,packet_digest:prepared.packetDigest,repository_id:repositoryID,job_id:prepared.jobID,generation:String(locked.generation),verifier_session_id:i.principal.actor_id,source_manifest_digest:prepared.packet!.pins.source_manifest_digest,policy_digest:locked.policy_digest,report,reason,runner:{...observed,stdout:{base64:out.toString('base64'),digest:sha256(out),size_bytes:String(out.length),complete:true},stderr:{base64:err.toString('base64'),digest:sha256(err),size_bytes:String(err.length),complete:true},artifacts:[]}};
 const bytes=canonical(receipt),hash=sha256(bytes);
 await tx.query("INSERT INTO hyperfide.documentation_checks(organisation_id,run_id,id,packet_id,job_id,generation,outcome,checker_receipt_digest,canonical_content,payload)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::text,$9::text::jsonb)",[scope.organisation_id,scope.run_id,checkID,packetID,prepared.jobID,locked.generation,outcome,hash,bytes]);
 await tx.query("UPDATE hyperfide.documentation_jobs SET state=$4 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[scope.organisation_id,scope.run_id,prepared.jobID,outcome==='PASS'?'SUCCEEDED':'FAILED']);
 return {job_id:prepared.jobID,check_id:checkID,checker_receipt_digest:hash,outcome,closed:false,cleanup_status:observed.cleanup_status,capacity_release_authorised:false};
 });
}

export function createComponent(context:ComponentContext):Component{
 const closure=createClosureComponent(context);return {...closure,actions:{...closure.actions,'docs.check':checkDocumentation}};
}

interface DocumentationCheckReference{check_id:string;checker_receipt_digest:string;repository_id:string}
async function validatedDocumentationChecks(db:Pick<PrimaryTransaction,'query'>,scope:Scope,packetID:string,ids:string[],packet:DocumentationPacket):Promise<DocumentationCheckReference[]>{
 if(!ids.length||new Set(ids).size!==ids.length)invalid('One independent check per packet repository is required');
 const rows=(await db.query("SELECT ch.id,ch.payload,ch.canonical_content,ch.checker_receipt_digest,ch.outcome,j.state,j.policy_digest FROM hyperfide.documentation_checks ch JOIN hyperfide.documentation_jobs j ON j.organisation_id=ch.organisation_id AND j.run_id=ch.run_id AND j.id=ch.job_id AND j.generation=ch.generation WHERE ch.organisation_id=$1 AND ch.run_id=$2 AND ch.packet_id=$3 AND ch.id=ANY($4::uuid[])",[scope.organisation_id,scope.run_id,packetID,ids])).rows;
 if(rows.length!==ids.length)invalid('A documentation check is absent or belongs to a different packet');
 const refs=rows.map(row=>{
 const value=row.payload;
 if(row.outcome!=='PASS'||row.state!=='SUCCEEDED'||canonical(value)!==row.canonical_content||sha256(row.canonical_content)!==row.checker_receipt_digest||!object(value)||value.packet_id!==packetID||value.packet_digest!==contentDigest(packet)||value.policy_digest!==row.policy_digest||!object(value.report))invalid('Independent documentation checker receipt integrity failed');
 const repo=uuid(value.repository_id);
 requireDocumentationCleanup(value.runner);
 validateDocumentationResult(value.report,packet,contentDigest(packet),repo);
 return {check_id:uuid(row.id),checker_receipt_digest:digest(row.checker_receipt_digest),repository_id:repo};
 }).sort((a,b)=>a.repository_id.localeCompare(b.repository_id));
 const expected=packet.snapshot.repositories.map(r=>r.repository_id).sort(),observed=refs.map(r=>r.repository_id);
 if(canonical(expected)!==canonical(observed))invalid('Successful checks do not cover every exact packet repository once');
 return refs;
}

export function requireDocumentationCleanup(value:unknown):void{
 if(!object(value)||value.cleanup_status!=='CONFIRMED'||!object(value.cleanup)||value.cleanup.complete!==true||value.cleanup.observed_process_absent!==true||!Array.isArray(value.artifacts)||value.artifacts.length!==0)throw new FoundationError('DOCS_CLEANUP_REQUIRED','Confirmed checker process absence and the complete expected artifact inventory are required');
 digest(value.cleanup.receipt_digest);
}
