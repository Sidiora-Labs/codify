import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {invocationOf,gatewayOf} from '../identity/enrollment.js';
import type {InvocationContext,AuthorityTransaction} from '../transport/protocol.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {readSemanticDisposition,writeSemanticDisposition} from '../storage/dispositions.js';

export interface KvxField {key:string;raw:string;value:unknown;line:number}
export interface KvxSection {name:string;line:number;fields:Record<string,KvxField>}
export interface KvxDocument {sections:KvxSection[];counts:{sections:number;fields:number;tasks:number;requirements:number;criteria:number;acceptances:number}}
export interface RepositoryPin {repository_id:string;source_object_id:string;integration_ref:string}
export interface ImportEnvelope {
 run_id:string;source:{relative_path:string;sha256:string;size_bytes:string};repositories:RepositoryPin[];
 allowed_actions:string[];closure_policy:{required_evidence:string[];required_review_roles:string[];publication:'AFTER_QUALIFICATION'};
 provenance:null|{repository_id:string;git_object_id:string};
}
export interface SpecScope {organisation_id:string;project_id:string;run_id:string;authority_epoch:string;root:string;allowed_actions:readonly string[]}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const OID=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DECIMAL=/^(?:0|[1-9][0-9]*)$/;
const MAX_SOURCE=32*1024*1024;
function fail(code:string,message:string):never {throw new FoundationError(code,message);}
function fields(input:unknown,names:string[]):Record<string,unknown>{
 if(!object(input)||Object.keys(input).length!==names.length||names.some(key=>!Object.hasOwn(input,key)))
  fail('INVALID_REQUEST','Input fields must match the versioned specification contract');
 return input;
}
function id(value:unknown):value is string {return typeof value==='string'&&UUID.test(value);}
export function validIntegrationRef(value:unknown):value is string {
 if(typeof value!=='string'||!value.startsWith('refs/heads/')||value.length>1024||value.endsWith('.')||value.includes('..')||value.includes('@{')||value.includes('\\'))return false;
 if(/[\x00-\x20\x7f~^:?*\[]/.test(value))return false;
 return value.split('/').every(part=>part.length>0&&!part.startsWith('.')&&!part.endsWith('.lock'));
}
function strings(value:unknown,max=128):value is string[] {
 return Array.isArray(value)&&value.length>0&&value.length<=max&&value.every(x=>typeof x==='string'&&x.length>0&&x.length<=128&&!/[\x00-\x1f]/.test(x))&&new Set(value).size===value.length;
}
export function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
export const digest=(value:string|Buffer):string=>'sha256:'+createHash('sha256').update(value).digest('hex');
export function derivedId(value:string):string{
 const hex=createHash('sha256').update(value).digest('hex').slice(0,32).split('');
 hex[12]='8';hex[16]=((parseInt(hex[16]!,16)&3)|8).toString(16);
 const v=hex.join('');return v.slice(0,8)+'-'+v.slice(8,12)+'-'+v.slice(12,16)+'-'+v.slice(16,20)+'-'+v.slice(20);
}
function stripComment(line:string):string {
 let quoted=false,escaped=false;
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(escaped){escaped=false;continue;}
  if(c==='\\'&&quoted){escaped=true;continue;}
  if(c==='"')quoted=!quoted;
  if(c==='#'&&!quoted)return line.slice(0,i).trim();
 }
 return line.trim();
}
function safeNumbers(value:unknown):void{
 if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))
  fail('SPEC_INVALID','KVX numeric value is outside exact supported precision');
 if(Array.isArray(value))for(const item of value)safeNumbers(item);
 else if(object(value))for(const item of Object.values(value))safeNumbers(item);
}
export function parseKvx(source:string):KvxDocument {
 if(source.includes('\0'))fail('SPEC_INVALID','KVX cannot contain NUL bytes');
 const sections:KvxSection[]=[],seen=new Set<string>();
 let current:KvxSection|undefined;
 const counts={sections:0,fields:0,tasks:0,requirements:0,criteria:0,acceptances:0};
 const lines=source.split('\n');
 for(let index=0;index<lines.length;index++){
  const text=stripComment(lines[index]!);if(!text)continue;
  if(text.startsWith('[')){
   if(!/^\[[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}\]$/.test(text))fail('SPEC_INVALID','Malformed KVX section at line '+(index+1));
   const name=text.slice(1,-1);if(seen.has(name))fail('SPEC_INVALID','Duplicate KVX section at line '+(index+1));
   seen.add(name);current={name,line:index+1,fields:Object.create(null) as Record<string,KvxField>};sections.push(current);counts.sections++;
   if(name.startsWith('task.'))counts.tasks++;if(name.startsWith('req.'))counts.requirements++;if(name.startsWith('acceptance.'))counts.acceptances++;
   continue;
  }
  const match=/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.+)$/.exec(text);
  if(!current||!match)fail('SPEC_INVALID','Malformed KVX field at line '+(index+1));
  const key=match[1]!,raw=match[2]!.trim();
  if(Object.hasOwn(current.fields,key))fail('SPEC_INVALID','Duplicate KVX key at line '+(index+1));
  let value:unknown;
  try{
   if(/^(?:["[{]|true$|false$|null$|-?[0-9])/.test(raw))value=JSON.parse(raw);
   else if(/^[A-Za-z_][A-Za-z0-9_.:/{}$-]*$/.test(raw))value=raw;
   else fail('SPEC_INVALID','Malformed KVX value at line '+(index+1));
  }catch(error){if(error instanceof FoundationError)throw error;fail('SPEC_INVALID','Malformed KVX value at line '+(index+1));}
  safeNumbers(value);current.fields[key]={key,raw,value,line:index+1};counts.fields++;if(current.name.startsWith('req.')&&/^ac_[0-9]+$/.test(key))counts.criteria++;
 }
 if(!sections.length||!counts.tasks)fail('SPEC_INVALID','KVX requires nonempty sections and task definitions');
 return {sections,counts};
}
export function specScope(context:ComponentContext):SpecScope{
 const env=context.env;
 if(!id(env.HF_SPEC_ORGANISATION_ID)||!id(env.HF_SPEC_PROJECT_ID)||!id(env.HF_AUTHORITY_EPOCH)||!id(context.policy.programme_id)||
 !env.HF_SPEC_ALLOWED_ROOT||!path.isAbsolute(env.HF_SPEC_ALLOWED_ROOT))
  fail('SPEC_CONFIG_INVALID','Trusted specification scope, deployment epoch and source root are required');
 return {organisation_id:env.HF_SPEC_ORGANISATION_ID,project_id:env.HF_SPEC_PROJECT_ID,run_id:context.policy.programme_id,
 authority_epoch:env.HF_AUTHORITY_EPOCH,root:env.HF_SPEC_ALLOWED_ROOT,allowed_actions:context.policy.allowed_actions};
}
export function validateImport(value:unknown,scope:SpecScope):ImportEnvelope{
 const input=fields(value,['run_id','source','repositories','allowed_actions','closure_policy','provenance']);
 if(input.run_id!==scope.run_id)fail('SCOPE_MISMATCH','Run is outside the trusted service scope');
 const source=fields(input.source,['relative_path','sha256','size_bytes']);
 if(typeof source.relative_path!=='string'||!source.relative_path||source.relative_path.length>2048||
 path.isAbsolute(source.relative_path)||source.relative_path.includes('\\')||source.relative_path.includes('\0')||
 source.relative_path.split('/').some(part=>part===''||part==='.'||part==='..')||
 typeof source.sha256!=='string'||!SHA.test(source.sha256)||typeof source.size_bytes!=='string'||source.size_bytes.length>8||!DECIMAL.test(source.size_bytes)||
 BigInt(source.size_bytes)>BigInt(MAX_SOURCE))fail('INVALID_REQUEST','Invalid bounded pinned source reference');
 if(!Array.isArray(input.repositories)||!input.repositories.length||input.repositories.length>128)
  fail('INVALID_REQUEST','Explicit repository identity pins are required');
 const repos=new Set<string>();
 for(const item of input.repositories){
  const repo=fields(item,['repository_id','source_object_id','integration_ref']);
  if(!id(repo.repository_id)||typeof repo.source_object_id!=='string'||!OID.test(repo.source_object_id)||
   !validIntegrationRef(repo.integration_ref)||repos.has(repo.repository_id))
   fail('INVALID_REQUEST','Invalid or duplicate repository pin');
  repos.add(repo.repository_id);
 }
 if(!strings(input.allowed_actions)||input.allowed_actions.some(action=>!scope.allowed_actions.includes(action)))
  fail('INVALID_REQUEST','Imported actions must remain within trusted programme approval');
 const closure=fields(input.closure_policy,['required_evidence','required_review_roles','publication']);
 if(!strings(closure.required_evidence)||!strings(closure.required_review_roles)||closure.publication!=='AFTER_QUALIFICATION')
  fail('INVALID_REQUEST','Explicit evidence, review and qualification closure policy required');
 if(input.provenance!==null){
  const provenance=fields(input.provenance,['repository_id','git_object_id']);
  if(!id(provenance.repository_id)||!repos.has(provenance.repository_id)||typeof provenance.git_object_id!=='string'||!OID.test(provenance.git_object_id))
   fail('INVALID_REQUEST','Specification Git provenance must name an explicit pinned repository');
 }
 return input as unknown as ImportEnvelope;
}
export async function readPinnedSource(root:string,source:ImportEnvelope['source']):Promise<{bytes:Buffer;text:string}>{
 const handles:Awaited<ReturnType<typeof fs.open>>[]=[];
 try{
  const pieces=path.resolve(root).split(path.sep).filter(Boolean);
  let directory=await fs.open('/',constants.O_RDONLY|constants.O_DIRECTORY);handles.push(directory);
  for(const part of pieces){
   directory=await fs.open('/proc/self/fd/'+directory.fd+'/'+part,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   handles.push(directory);
  }
  const relative=source.relative_path.split('/');
  for(const part of relative.slice(0,-1)){
   directory=await fs.open('/proc/self/fd/'+directory.fd+'/'+part,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);handles.push(directory);
  }
  const file=await fs.open('/proc/self/fd/'+directory.fd+'/'+relative.at(-1)!,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  handles.push(file);
  const before=await file.stat({bigint:true});
  if(!before.isFile()||before.size>BigInt(MAX_SOURCE))fail('SOURCE_INVALID','Source must be a bounded regular file');
  if(String(before.size)!==source.size_bytes)fail('DIGEST_MISMATCH','Source length does not match its pin');
  const chunks:Buffer[]=[];let total=0;
  for(;;){
   const chunk=Buffer.allocUnsafe(Math.min(65536,MAX_SOURCE+1-total));
   const read=await file.read(chunk,0,chunk.length,null);if(read.bytesRead===0)break;
   total+=read.bytesRead;if(total>MAX_SOURCE)fail('SOURCE_CHANGED','Source exceeded the bounded read limit');
   chunks.push(chunk.subarray(0,read.bytesRead));
  }
  const bytes=Buffer.concat(chunks,total),after=await file.stat({bigint:true});
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||
   bytes.length!==Number(before.size))fail('SOURCE_CHANGED','Source changed during pinned read');
  if(digest(bytes)!=='sha256:'+source.sha256)fail('DIGEST_MISMATCH','Source digest does not match its pin');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('SOURCE_INVALID','Source must contain valid UTF8');}
  if(!Buffer.from(text,'utf8').equals(bytes)||text.includes('\0'))fail('SOURCE_INVALID','Source must contain exact UTF8 text without NUL');
  return {bytes,text};
 }catch(error){if(error instanceof FoundationError)throw error;throw new FoundationError('SOURCE_INVALID','Pinned source is unavailable or unsafe');}
 finally{for(const handle of handles.reverse())await handle.close();}
}
export interface StoredIntent {
 schema_version:1;revision_digest:string;source_digest:string;repositories:RepositoryPin[];allowed_actions:string[];
 closure_policy:ImportEnvelope['closure_policy'];provenance:ImportEnvelope['provenance'];parsed:KvxDocument;runtime_wave_offset:number;
}
function value(section:KvxSection,key:string):unknown{return section.fields[key]?.value;}
export function taskDefinitions(parsed:KvxDocument):{section:KvxSection;key:string;feature_key:string;declared_wave:unknown;wave:number;package_key:string}[]{
 const features=new Set(parsed.sections.filter(section=>section.name.startsWith('feature.')).map(section=>section.name.slice(8)));
 const programme=String(parsed.sections.find(section=>section.name==='meta')?.fields.slug?.value??'programme');
 const offset=parsed.sections.some(section=>section.name.startsWith('task.')&&value(section,'wave')===0)?1:0;
 return parsed.sections.filter(section=>section.name.startsWith('task.')).map(section=>{
  const key=section.name.slice(5),declared_wave=value(section,'wave')??null;
  if(!key||key.length>255)fail('SPEC_INVALID','Task identity is outside storage bounds');
  const explicit=value(section,'feature');
  const prefix=key.split('.')[0]!;
  const feature_key=typeof explicit==='string'?explicit:features.has(prefix)?prefix:'programme:'+programme;
  const wave=typeof declared_wave==='number'&&Number.isInteger(declared_wave)&&declared_wave>=0&&declared_wave<2147483647?declared_wave+offset:1;
  const package_key='feature:'+feature_key+':wave:'+String(declared_wave);
  if(package_key.length>255)fail('SPEC_INVALID','Feature package identity is outside storage bounds');
  return {section,key,feature_key,declared_wave,wave:Math.max(1,wave),package_key};
 });
}
export interface SpecTransaction {query<Row extends pg.QueryResultRow = pg.QueryResultRow>(text:string,values?:unknown[]):Promise<pg.QueryResult<Row>>}
async function primary(client:SpecTransaction):Promise<void>{
 const result=await client.query<{replica:boolean}>('SELECT pg_is_in_recovery() AS replica');
 if(result.rows[0]?.replica)fail('PRIMARY_REQUIRED','Specification authority requires the primary database');
}
function storageFailure(error:unknown):never{
 if(error instanceof FoundationError)throw error;
 fail('STORAGE_UNAVAILABLE','PostgreSQL rejected specification operation');
}
export interface PinnedRun {id:string;spec_revision_id:string;spec_generation:string;state_version:string;state:string;source_content:string;source_digest:string;document:StoredIntent}
export async function loadPinnedRun(client:SpecTransaction,scope:SpecScope):Promise<PinnedRun>{
 const rows=await client.query<PinnedRun>(
 'SELECT r.id,r.spec_revision_id,r.spec_generation::text,r.state_version::text,r.state,s.source_content,s.source_digest,s.document FROM hyperfide.runs r JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id WHERE r.organisation_id=$1 AND r.project_id=$2 AND r.id=$3',
 [scope.organisation_id,scope.project_id,scope.run_id]);
 if(rows.rows.length!==1)fail('SCOPE_MISMATCH','Pinned run is absent from the trusted scope');
 return rows.rows[0]!;
}
function summary(run:PinnedRun):unknown{
 return {run_id:run.id,spec_revision_id:run.spec_revision_id,revision_digest:run.document.revision_digest,source_digest:run.source_digest,
 spec_generation:run.spec_generation,state_version:run.state_version,state:run.state,validation_status:run.state==='PENDING_VALIDATION'?'PENDING':'NOT_ASSERTED',
 counts:run.document.parsed.counts};
}
export async function prepareAcceptedIntent(scope:SpecScope,raw:unknown,rawSource?:Buffer){
 const input=validateImport(raw,scope);
 const source=rawSource===undefined?await readPinnedSource(scope.root,input.source):{bytes:rawSource,text:new TextDecoder('utf-8',{fatal:true}).decode(rawSource)};
 if(source.bytes.length!==Number(input.source.size_bytes)||digest(source.bytes)!=='sha256:'+input.source.sha256||!Buffer.from(source.text,'utf8').equals(source.bytes)||source.text.includes('\0'))fail('DIGEST_MISMATCH','Stored proposed intent differs from its immutable source pin');
 const parsed=parseKvx(source.text);
 if(parsed.sections.some(section=>section.name==='hyperfide.projection'))fail('PROJECTION_WRITE_FORBIDDEN','Projections cannot replace authoritative specification state');
 const accepted={schema_version:1,source_digest:digest(source.bytes),repositories:[...input.repositories].sort((a,b)=>a.repository_id.localeCompare(b.repository_id)),
 allowed_actions:[...input.allowed_actions].sort(),closure_policy:input.closure_policy,provenance:input.provenance};
 const revision_digest=digest(canonical(accepted)),tasks=taskDefinitions(parsed);
 const document:StoredIntent={...accepted,schema_version:1,revision_digest,parsed,runtime_wave_offset:tasks.some(task=>task.declared_wave===0)?1:0};
 const specId=derivedId(scope.organisation_id+':'+scope.project_id+':'+revision_digest);
 return {input,source,parsed,tasks,document,specId,revision_digest,accepted};
}
export async function importRunTransaction(client:SpecTransaction,scope:SpecScope,raw:unknown):Promise<unknown>{
 const expected=digest(await fs.readFile(new URL('../../migrations/0002-spec.sql',import.meta.url)));
 const readiness=await client.query<{checksum:string;name:string}>('SELECT checksum,name FROM hyperfide.schema_migrations WHERE version=2');
 if(readiness.rows.length!==1||readiness.rows[0]!.name!=='0002-spec'||readiness.rows[0]!.checksum!==expected)
  fail('SPEC_SCHEMA_NOT_INITIALISED','Apply the exact versioned specification migration before importing');
 const {input,source,tasks,document,specId,revision_digest,accepted}=await prepareAcceptedIntent(scope,raw);
  await primary(client);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.organisation_id+':'+scope.run_id]);
  const existing=await client.query('SELECT id FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[scope.organisation_id,scope.run_id]);
  if(existing.rows.length){
   const prior=await loadPinnedRun(client,scope);
   if(prior.document.revision_digest!==revision_digest)fail('REVISION_CONFLICT','Existing run pins different accepted intent');
   return {...summary(prior) as object,replayed:true};
  }
  for(const repo of input.repositories){
   const record=await client.query(
    "SELECT 1 FROM hyperfide.repositories r JOIN hyperfide.source_objects s ON s.organisation_id=r.organisation_id AND s.repository_id=r.id WHERE r.organisation_id=$1 AND r.project_id=$2 AND r.id=$3 AND s.object_id=$4 AND s.object_type='commit'",
    [scope.organisation_id,scope.project_id,repo.repository_id,repo.source_object_id]);
   if(!record.rows.length)fail('SCOPE_MISMATCH','Repository commit is absent from the trusted project');
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[scope.organisation_id+':'+scope.project_id+':'+accepted.source_digest]);
  const priorSpec=await client.query<{id:string;document:StoredIntent}>('SELECT id,document FROM hyperfide.spec_revisions WHERE organisation_id=$1 AND project_id=$2 AND revision_digest=$3 FOR UPDATE',
   [scope.organisation_id,scope.project_id,revision_digest]);
  if(priorSpec.rows.length&&priorSpec.rows[0]!.document.revision_digest!==revision_digest)
   fail('REVISION_CONFLICT','Identical source already pins a different accepted envelope');
  if(!priorSpec.rows.length)await client.query(
   'INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,repository_id,git_object_id,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9)',
   [scope.organisation_id,scope.project_id,specId,accepted.source_digest,source.text,JSON.stringify(document),input.provenance?.repository_id??null,input.provenance?.git_object_id??null,revision_digest]);
  await client.query(
   "INSERT INTO hyperfide.runs(organisation_id,project_id,id,spec_revision_id,policy_digest,authority_epoch,state) VALUES($1,$2,$3,$4,$5,$6,'PENDING_VALIDATION')",
   [scope.organisation_id,scope.project_id,scope.run_id,priorSpec.rows[0]?.id??specId,digest(canonical({allowed_actions:accepted.allowed_actions,closure_policy:accepted.closure_policy})),scope.authority_epoch]);
  for(const repo of input.repositories)await client.query(
   'INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,$5)',
   [scope.organisation_id,scope.run_id,repo.repository_id,repo.source_object_id,repo.integration_ref]);
  const packages=new Map<string,string>();
  for(const task of tasks){
   if(!packages.has(task.package_key)){
    const packageId=derivedId(scope.run_id+':package:'+task.package_key);packages.set(task.package_key,packageId);
    await client.query('INSERT INTO hyperfide.feature_packages(organisation_id,run_id,id,package_key,wave) VALUES($1,$2,$3,$4,$5)',
     [scope.organisation_id,scope.run_id,packageId,task.package_key,task.wave]);
   }
   const definition={schema_version:1,section:task.section,feature_key:task.feature_key,declared_wave:task.declared_wave,
    runtime_wave_offset:document.runtime_wave_offset,declared_status:value(task.section,'status')??null,history_only:true};
   await client.query(
    "INSERT INTO hyperfide.tasks(organisation_id,run_id,id,task_key,feature_package_id,spec_revision_id,criteria_digest,definition,wave,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING')",
    [scope.organisation_id,scope.run_id,derivedId(scope.run_id+':task:'+task.key),task.key,packages.get(task.package_key),priorSpec.rows[0]?.id??specId,
     digest(canonical({source_digest:accepted.source_digest,reqs:value(task.section,'reqs')??null})),JSON.stringify(definition),task.wave]);
  }
  const run=await loadPinnedRun(client,scope);return {...summary(run) as object,replayed:false};
}
export async function importRun(pool:pg.Pool,scope:SpecScope,raw:unknown):Promise<unknown>{
 const client=await pool.connect();let committing=false;let discard:Error|undefined;
 try{
  await client.query('BEGIN');
  const result=await importRunTransaction(client,scope,raw);
  committing=true;await client.query('COMMIT');return result;
 }catch(error){
  if(committing){discard=new Error('Uncertain specification commit');fail('COMMIT_AMBIGUOUS','Reconcile exact accepted-intent identity before retry');}
  try{await client.query('ROLLBACK');}catch{/* Preserve the observed failure. */}
  return storageFailure(error);
 }finally{client.release(discard);}
}

function scoped(input:unknown,scope:SpecScope,names:string[]):Record<string,unknown>{
 const row=fields(input,names);if(row.run_id!==scope.run_id)fail('SCOPE_MISMATCH','Run is outside the trusted service scope');return row;
}
function current(run:PinnedRun,input:Record<string,unknown>):void{
 if(input.revision_digest!==run.document.revision_digest||input.spec_generation!==run.spec_generation||input.state_version!==run.state_version)
  fail('STALE_PROJECTION','Projection no longer identifies current authoritative state');
}
export async function exportProjection(pool:SpecTransaction,scope:SpecScope,input:unknown):Promise<unknown>{
 const request=scoped(input,scope,['run_id','revision_digest','cursor','max_bytes']);
 if(typeof request.revision_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(request.revision_digest)||
 !Number.isSafeInteger(request.max_bytes)||(request.max_bytes as number)<1||(request.max_bytes as number)>196608)
  fail('INVALID_REQUEST','Export requires pinned revision and bounded byte limit');
 const run=await loadPinnedRun(pool,scope);
 if(request.revision_digest!==run.document.revision_digest)fail('STALE_PROJECTION','Export revision is obsolete');
 let offset=0n;
 if(request.cursor!==null){
  const cursor=fields(request.cursor,['spec_generation','state_version','offset_bytes']);
  if(typeof cursor.spec_generation!=='string'||!DECIMAL.test(cursor.spec_generation)||typeof cursor.state_version!=='string'||!DECIMAL.test(cursor.state_version)||typeof cursor.offset_bytes!=='string'||cursor.offset_bytes.length>8||!DECIMAL.test(cursor.offset_bytes))fail('INVALID_REQUEST','Cursor offset must be a canonical decimal string');
  current(run,{...cursor,revision_digest:request.revision_digest});offset=BigInt(cursor.offset_bytes);
 }
 const bytes=Buffer.from(run.source_content,'utf8');
 if(offset>BigInt(bytes.length))fail('INVALID_REQUEST','Cursor is outside the pinned source');
 const end=Math.min(bytes.length,Number(offset)+(request.max_bytes as number));
 const cursor={spec_generation:run.spec_generation,state_version:run.state_version,offset_bytes:String(end)};
 const header='[hyperfide.projection]\nrevision_digest = '+JSON.stringify(run.document.revision_digest)+'\nspec_generation = '+JSON.stringify(run.spec_generation)+
 '\nstate_version = '+JSON.stringify(run.state_version)+'\nstatuses_are_history = true\n\n';
 return {projection_header:header,source_digest:run.source_digest,source_size_bytes:String(bytes.length),offset_bytes:String(offset),
 chunk_base64:bytes.subarray(Number(offset),end).toString('base64'),next_cursor:end===bytes.length?null:cursor};
}

export async function specTransaction<T>(context:ComponentContext,mode:'READ'|'WRITE',body:(tx:AuthorityTransaction,invocation:InvocationContext)=>Promise<T>):Promise<T>{
 const invocation=invocationOf(context),scope={organisation_id:invocation.principal.organisation_id,run_id:invocation.principal.run_id};
 return gatewayOf(context).withPrimaryTransaction({timeoutMs:30000,maxRetries:2,signal:invocation.signal,guard:async tx=>{
  assertPrimaryTransaction(tx);
  await(mode==='WRITE'?writeSemanticDisposition(tx,scope):readSemanticDisposition(tx,scope));
  await invocation.guard(tx);
 }},tx=>body(tx,invocation));
}
async function authenticatedScope(tx:AuthorityTransaction,context:ComponentContext,i:InvocationContext):Promise<SpecScope>{
 const row=(await tx.query('SELECT project_id,authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[i.principal.organisation_id,i.principal.run_id])).rows[0];
 if(!row||!context.env.HF_SPEC_ALLOWED_ROOT||!path.isAbsolute(context.env.HF_SPEC_ALLOWED_ROOT))fail('SPEC_CONFIG_INVALID','Trusted source root and accepted run required');
 return {organisation_id:i.principal.organisation_id,run_id:i.principal.run_id,project_id:row.project_id,authority_epoch:row.authority_epoch,
 root:context.env.HF_SPEC_ALLOWED_ROOT,allowed_actions:i.principal.allowed_actions};
}
export function createComponent(_startup:ComponentContext):Component{
 const action=(write:boolean,execute:(tx:SpecTransaction,scope:SpecScope,input:unknown)=>Promise<unknown>)=>
  async(input:unknown,context:ComponentContext)=>specTransaction(context,write?'WRITE':'READ',async(tx,i)=>{
   if(write&&!['OPERATOR','LEADER','COORDINATOR'].includes(i.principal.role))fail('ACTION_DENIED','Role cannot import accepted intent');
   assertPrimaryTransaction(tx);
   const scope=await authenticatedScope(tx,context,i);
   return execute(tx,scope,input);
  });
 return {apiVersion:1,actions:{
  // Fresh intake is the explicit offline bootstrap; authenticated import may
  // only replay the already accepted run that the current principal belongs to.
  'spec.import':action(true,importRunTransaction),
  'spec.inspect':action(false,async(tx,scope,input)=>{scoped(input,scope,['run_id']);return summary(await loadPinnedRun(tx,scope));}),
  'spec.export':action(false,exportProjection),
  'spec.projection.check':action(false,async(tx,scope,input)=>{
   const request=scoped(input,scope,['run_id','revision_digest','spec_generation','state_version']);
   if(typeof request.revision_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(request.revision_digest)||
    typeof request.spec_generation!=='string'||!DECIMAL.test(request.spec_generation)||
    typeof request.state_version!=='string'||!DECIMAL.test(request.state_version))fail('INVALID_REQUEST','Projection requires exact revision labels');
   current(await loadPinnedRun(tx,scope),request);return {current:true,writable:false};
  })
 }};
}
