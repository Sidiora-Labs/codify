import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {invocationOf,gatewayOf} from '../identity/enrollment.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';

export const GRAPH_SCHEMA_VERSION=1;
export const GRAPH_TABLES=Object.freeze(['files','symbols','refs','imports','routes','comments',
'semantic_symbols','semantic_references','semantic_bindings','semantic_type_facts','semantic_edges',
'semantic_dependencies','semantic_route_facts','semantic_route_compositions','semantic_identifier_postings','extraction_health']);
export type JsonObject=Record<string,unknown>;
export function fail(code:string,message:string):never {throw new FoundationError(code,message);}
export function exact(value:unknown,required:string[],optional:string[]=[]):JsonObject {
 if(!object(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))
  fail('GRAPH_INVALID','Missing or unknown graph fields');
 return value;
}
export function canonical(value:unknown):string {
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return fail('GRAPH_INVALID','Graph values must use bounded JSON types');
}
export function digest(value:string|Buffer):string{return 'sha256:'+createHash('sha256').update(value).digest('hex');}
async function verifiedFile(filename:string,size:number,bodyEligible:boolean,signal:AbortSignal):Promise<{hash:string;body:Buffer|null}>{
 const hash=createHash('sha256'),parts:Buffer[]=[];let length=0;
 for await(const part of createReadStream(filename,{highWaterMark:65536,signal})){
  const bytes=part as Buffer;length+=bytes.length;
  if(length>size)fail('GRAPH_SOURCE_CHANGED','Source grew during bounded verification');
  hash.update(bytes);if(bodyEligible)parts.push(bytes);
 }
 if(length!==size)fail('GRAPH_SOURCE_CHANGED','Source size changed during verification');
 return {hash:'sha256:'+hash.digest('hex'),body:bodyEligible?Buffer.concat(parts,length):null};
}

export function text(value:unknown,kind='text',limit=256):string {
 if(typeof value!=='string'||value.length<1||value.length>limit||/[\x00-\x1f]/.test(value))fail('GRAPH_INVALID','Invalid '+kind);
 return value;
}
export function uuid(value:unknown):string {const v=text(value,'UUID',36);if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v))fail('GRAPH_INVALID','Invalid UUID');return v;}
export function decimal(value:unknown,zero=false):string {
 const v=text(value,'decimal',19);if(!/^(0|[1-9][0-9]*)$/.test(v)||BigInt(v)>9223372036854775807n||(!zero&&v==='0'))fail('GRAPH_INVALID','Invalid decimal');return v;
}
export function sha(value:unknown):string {const v=text(value,'digest',71);if(!/^sha256:[a-f0-9]{64}$/.test(v))fail('GRAPH_INVALID','Invalid digest');return v;}
function oid(value:unknown):string {const v=text(value,'Git object',64);if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v))fail('GRAPH_INVALID','Full Git object required');return v;}
function relative(value:unknown):string {const v=text(value,'path',4096);if(v.startsWith('/')||v.includes('\\')||v.split('/').some(p=>p===''||p==='.'||p==='..')||v==='.git'||v.startsWith('.git/')||v==='.codegraph'||v.startsWith('.codegraph/'))fail('GRAPH_INVALID','Unsafe graph path');return v;}
export interface ExtractionIdentity {organisation_id:string;run_id:string;repository_id:string;commit:string;tree:string;generation:string;
 source_kind:'COMMIT'|'OVERLAY';overlay_digest:string|null;overlay_name:string|null;parser_digest:string;config_digest:string;source_manifest_digest:string;}
export interface Fact {table:string;key:string;row:JsonObject;}
export interface GraphChunk {schema_version:1;identity:ExtractionIdentity;index:number;rows:Fact[];digest:string;}
export interface BundleManifest {schema_version:1;bundle_digest:string;identity:ExtractionIdentity;complete:boolean;
 counts:Record<string,number>;chunks:{index:number;digest:string;rows:number;bytes:number}[];coverage:JsonObject;authority:'NONE';cache:'NON_AUTHORITATIVE';}
interface Config {scratch:string;binary:string;binaryDigest:string;repositories:Record<string,string>;maxBytes:number;maxRows:number;chunkBytes:number;}
async function config(env:Readonly<NodeJS.ProcessEnv>):Promise<Config> {
 const filename=env.HYPERFIDE_GRAPH_CONFIG;if(!filename)fail('GRAPH_CONFIG_REQUIRED','Trusted remote graph configuration required');
 const st=await fs.lstat(filename);if(!st.isFile()||st.isSymbolicLink()||st.size>262144)fail('GRAPH_CONFIG_INVALID','Invalid graph configuration file');
 const raw=exact(JSON.parse(await fs.readFile(filename,'utf8')),['schema_version','execution_role','scratch_root','cg_binary','cg_digest','repositories'],['max_total_bytes','max_rows','chunk_bytes']);
 if(raw.schema_version!==1||raw.execution_role!=='REMOTE')fail('GRAPH_PLACEMENT_DENIED','Extraction requires trusted remote placement');
 const scratch=await fs.realpath(text(raw.scratch_root,'scratch root',4096)),binary=await fs.realpath(text(raw.cg_binary,'scanner path',4096));
 const bs=await fs.stat(binary);if(!bs.isFile()||!(bs.mode&0o111)||bs.size>256*1024*1024)fail('GRAPH_CONFIG_INVALID','Scanner must be a bounded executable');
 const binaryDigest=digest(await fs.readFile(binary));if(binaryDigest!==sha(raw.cg_digest))fail('GRAPH_SCANNER_CHANGED','Scanner digest differs');
 if(!object(raw.repositories)||!Object.keys(raw.repositories).length)fail('GRAPH_CONFIG_INVALID','Repository map required');
 const repositories:Record<string,string>={};
 for(const [id,p] of Object.entries(raw.repositories)){uuid(id);repositories[id]=await fs.realpath(text(p,'repository path',4096));}
 const bounded=(v:unknown,base:number,max:number):number=>{if(v===undefined)return base;if(!Number.isSafeInteger(v)||Number(v)<1024||Number(v)>max)fail('GRAPH_CONFIG_INVALID','Invalid graph bound');return Number(v);};
 return {scratch,binary,binaryDigest,repositories,maxBytes:bounded(raw.max_total_bytes,32*1024*1024,128*1024*1024),
 maxRows:bounded(raw.max_rows,100000,1000000),chunkBytes:bounded(raw.chunk_bytes,131072,196608)};
}
async function command(executable:string,args:string[],cwd:string,signal:AbortSignal,max=1048576):Promise<string> {
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd,signal,env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:cwd,GIT_CONFIG_NOSYSTEM:'1',
   GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_0:'maintenance.auto',GIT_CONFIG_VALUE_0:'false',
   GIT_CONFIG_KEY_1:'gc.auto',GIT_CONFIG_VALUE_1:'0',GIT_CONFIG_KEY_2:'gc.autoDetach',GIT_CONFIG_VALUE_2:'false',GIT_TERMINAL_PROMPT:'0',LC_ALL:'C.UTF-8',CG_BUSY_TIMEOUT_MS:'1000'},stdio:['ignore','pipe','pipe']});
  let output=Buffer.alloc(0),errors=0,settled=false,overflow=false,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},120000);
  child.stdout.on('data',(data:Buffer)=>{if(output.length+data.length>max){overflow=true;child.kill('SIGKILL');return;}output=Buffer.concat([output,data]);});
  child.stderr.on('data',(data:Buffer)=>{errors+=data.length;if(errors>max){overflow=true;child.kill('SIGKILL');}});
  child.once('error',()=>{settled=true;clearTimeout(timer);reject(new FoundationError('GRAPH_EXECUTION_FAILED','Remote scanner process could not execute'));});
  child.once('close',(code)=>{clearTimeout(timer);if(settled)return;if(overflow){reject(new FoundationError('GRAPH_BUDGET_EXCEEDED','Remote process output exceeded its byte bound'));return;}if(timedOut){reject(new FoundationError('GRAPH_EXECUTION_TIMEOUT','Remote process exceeded its deadline'));return;}if(code!==0)reject(new FoundationError('GRAPH_EXECUTION_FAILED','Remote source/scanner process failed'));else resolve(output.toString('utf8').trim());});
 });
}
function snapshotRows(db:DatabaseSync,maxRows:number,maxBytes:number):{facts:Fact[];counts:Record<string,number>;coverage:JsonObject} {
 const facts:Fact[]=[],counts:Record<string,number>={};let rowBytes=0;
 const tableExists=(t:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
 for(const table of GRAPH_TABLES){
  if(!tableExists(table))fail('GRAPH_SCHEMA_UNSUPPORTED','Scanner omitted required fact table '+table);
  const statement=db.prepare('SELECT * FROM "'+table+'"');statement.setReadBigInts(true);
  const rows:JsonObject[]=[];
  for(const row of statement.iterate()){
   const normalized:JsonObject={};for(const [k,v]of Object.entries(row))normalized[k]=typeof v==='bigint'?v.toString():v instanceof Uint8Array?{base64:Buffer.from(v).toString('base64')}:v;
   // Filesystem times and physical checkout locations are not semantic facts.
   if(table==='files'){delete normalized.mtime;delete normalized.mtime_ns;}
   rowBytes+=Buffer.byteLength(canonical(normalized))+256;if(rowBytes>maxBytes)fail('GRAPH_BUDGET_EXCEEDED','Raw graph byte budget exceeded');
   rows.push(normalized);if(facts.length+rows.length>maxRows)fail('GRAPH_BUDGET_EXCEEDED','Graph row budget exceeded');
  }
  rows.sort((a,b)=>Buffer.compare(Buffer.from(canonical(a)),Buffer.from(canonical(b))));
  counts[table]=rows.length;
  rows.forEach((row,index)=>facts.push({table,key:String(index),row}));
 }
 const health=facts.filter(f=>f.table==='extraction_health').map(f=>f.row);
 const failed=health.filter(h=>h.status==='failed'||h.status==='partial'||h.pending_version!==null);
 const branches=db.prepare('SELECT id,name,head FROM branches ORDER BY id').all();
 if(branches.length!==1)fail('GRAPH_BRANCH_MIX','Extraction snapshot must contain exactly one branch');
 const debt=db.prepare("SELECT key,value FROM meta WHERE key LIKE '%pending_resolve%' AND value NOT IN ('','0')").all();
 if(debt.length||tableExists('semantic_change_debt')&&Number(db.prepare('SELECT count(*) AS n FROM semantic_change_debt').get()!.n)>0)fail('GRAPH_INCOMPLETE','Scanner has unresolved retry debt');
 return {facts,counts,coverage:{complete:failed.length===0,failed_files:failed.length,skipped_files:health.filter(h=>h.status==='skipped').length,
 parser_versions:[...new Set(health.map(h=>String(h.extraction_version)))].sort(),limitations:['Legacy parser diagnostics and size/ignore rules are preserved','Unsupported languages and skipped files remain explicit']}};
}
export function validateIdentity(value:unknown):ExtractionIdentity {
 const r=exact(value,['organisation_id','run_id','repository_id','commit','tree','generation','source_kind','overlay_digest','overlay_name','parser_digest','config_digest','source_manifest_digest']);
 const kind=r.source_kind;if(kind!=='COMMIT'&&kind!=='OVERLAY')fail('GRAPH_INVALID','Unknown source kind');
 if(kind==='COMMIT'&&(r.overlay_digest!==null||r.overlay_name!==null)||kind==='OVERLAY'&&(r.overlay_digest===null||r.overlay_name===null))fail('GRAPH_INVALID','Overlay identity is inconsistent');
 return {organisation_id:uuid(r.organisation_id),run_id:uuid(r.run_id),repository_id:uuid(r.repository_id),commit:oid(r.commit),tree:oid(r.tree),generation:decimal(r.generation),
 source_kind:kind,overlay_digest:r.overlay_digest===null?null:sha(r.overlay_digest),overlay_name:r.overlay_name===null?null:text(r.overlay_name,'overlay name',128),
 parser_digest:sha(r.parser_digest),config_digest:sha(r.config_digest),source_manifest_digest:sha(r.source_manifest_digest)};
}
export function validateChunk(value:unknown):GraphChunk {
 const r=exact(value,['schema_version','identity','index','rows','digest']);if(r.schema_version!==1||!Number.isSafeInteger(r.index)||Number(r.index)<0||!Array.isArray(r.rows)||r.rows.length>10000)fail('GRAPH_INVALID','Invalid graph chunk');
 const identity=validateIdentity(r.identity),rows:Fact[]=r.rows.map(v=>{const f=exact(v,['table','key','row']);if(![...GRAPH_TABLES,'source_bodies'].includes(String(f.table))||!object(f.row))fail('GRAPH_INVALID','Unknown fact family');return {table:String(f.table),key:text(f.key,'fact key',128),row:f.row};});
 const hash=sha(r.digest),body={schema_version:1,identity,index:Number(r.index),rows};
 if(digest(canonical(body))!==hash)fail('GRAPH_DIGEST_MISMATCH','Chunk digest mismatch');
 if(Buffer.byteLength(canonical({...body,digest:hash}))>262144)fail('GRAPH_BUDGET_EXCEEDED','Chunk too large');
 return {...body,schema_version:1,digest:hash};
}

export function validateManifest(value:unknown):BundleManifest {
 const r=exact(value,['schema_version','bundle_digest','identity','complete','counts','chunks','coverage','authority','cache']);
 if(r.schema_version!==1||typeof r.complete!=='boolean'||r.authority!=='NONE'||r.cache!=='NON_AUTHORITATIVE'||!object(r.counts)||!object(r.coverage)||!Array.isArray(r.chunks)||r.chunks.length>10000)fail('GRAPH_INVALID','Invalid bundle manifest');
 const identity=validateIdentity(r.identity),counts:Record<string,number>={};
 for(const family of [...GRAPH_TABLES,'source_bodies']){
  const n=r.counts[family];if(!Number.isSafeInteger(n)||Number(n)<0||Number(n)>1000000)fail('GRAPH_INVALID','Invalid fact counts');counts[family]=Number(n);
 }
 if(Object.keys(r.counts).length!==Object.keys(counts).length)fail('GRAPH_INVALID','Unknown fact counts');
 const chunks=r.chunks.map((v,index)=>{const c=exact(v,['index','digest','rows','bytes']);if(c.index!==index||!Number.isSafeInteger(c.rows)||Number(c.rows)<1||Number(c.rows)>10000||!Number.isSafeInteger(c.bytes)||Number(c.bytes)<1||Number(c.bytes)>262144)fail('GRAPH_INVALID','Invalid chunk declaration');return {index,digest:sha(c.digest),rows:Number(c.rows),bytes:Number(c.bytes)};});
 if(chunks.reduce((n,c)=>n+c.rows,0)!==Object.values(counts).reduce((a,b)=>a+b,0))fail('GRAPH_INVALID','Declared chunk/fact counts differ');
 const hash=sha(r.bundle_digest),body={schema_version:1 as const,identity,complete:r.complete,counts,chunks,coverage:r.coverage,authority:'NONE' as const,cache:'NON_AUTHORITATIVE' as const};
 if(digest(canonical(body))!==hash)fail('GRAPH_DIGEST_MISMATCH','Bundle manifest digest mismatch');
 if(Buffer.byteLength(canonical(r))>524288)fail('GRAPH_BUDGET_EXCEEDED','Manifest too large');
 return {...body,bundle_digest:hash};
}

async function extractionGuard(ctx:ComponentContext,identity?:Pick<ExtractionIdentity,'organisation_id'|'run_id'|'repository_id'|'commit'>,write=false):Promise<void>{
 const i=invocationOf(ctx),p=i.principal,roles=write?['INDEXER','COORDINATOR','LEADER','OPERATOR']:['INDEXER','COORDINATOR','LEADER','OPERATOR','FEATURE_MANAGER','WORKER','VERIFIER','INTEGRATOR','COMMIT_WATCHER','ISSUE_WATCHER'];
 if(!roles.includes(p.role)||!p.allowed_actions.includes(i.payload.action))fail('GRAPH_ROLE_DENIED','Authenticated role/action cannot use remote graph extraction');
 if(identity&&(identity.organisation_id!==p.organisation_id||identity.run_id!==p.run_id))fail('GRAPH_SCOPE_DENIED','Extraction differs from authenticated scope');
 await gatewayOf(ctx).withPrimaryTransaction({timeoutMs:5000,signal:i.signal,guard:tx=>i.guard(tx)},async tx=>{
  if(identity){const pin=await tx.query("SELECT 1 FROM hyperfide.run_repositories rr JOIN hyperfide.source_objects so ON so.organisation_id=rr.organisation_id AND so.repository_id=rr.repository_id AND so.object_id=$4 WHERE rr.organisation_id=$1 AND rr.run_id=$2 AND rr.repository_id=$3 AND so.object_type='commit'",[p.organisation_id,p.run_id,identity.repository_id,identity.commit]);if(pin.rowCount!==1)fail('GRAPH_SOURCE_DENIED','Extraction source is outside authenticated run repository set');}
 });
}
async function create(input:unknown,ctx:ComponentContext,cfg:Config):Promise<BundleManifest> {
 const r=exact(input,['organisation_id','run_id','repository_id','commit','tree','generation','configuration'],['overlay']);
 const org=uuid(r.organisation_id),run=uuid(r.run_id),repo=uuid(r.repository_id),commit=oid(r.commit),tree=oid(r.tree),generation=decimal(r.generation);
 await extractionGuard(ctx,{organisation_id:org,run_id:run,repository_id:repo,commit},true);
 const invocation=invocationOf(ctx);ctx={...ctx,signal:AbortSignal.any([ctx.signal,invocation.signal])};
 const source=cfg.repositories[repo];if(!source)fail('GRAPH_REPOSITORY_DENIED','Repository is outside trusted remote map');
 const configuration=exact(r.configuration,['build_flags','resolver_digest','generated_manifest_digest']);
 if(!Array.isArray(configuration.build_flags)||configuration.build_flags.length>128||configuration.build_flags.some(v=>typeof v!=='string'||v.length>1024))fail('GRAPH_INVALID','Invalid build flags');
 sha(configuration.resolver_digest);sha(configuration.generated_manifest_digest);
 const work=await fs.mkdtemp(path.join(cfg.scratch,'extract-'));let retain=false;
 try {
  await command('git',['-c','core.hooksPath=/dev/null','clone','--local','--no-hardlinks','--no-checkout','--',source,work+'/source'],cfg.scratch,ctx.signal);
  const root=work+'/source';
  const resolved=await command('git',['rev-parse',commit+'^{commit}'],root,ctx.signal);
  const resolvedTree=await command('git',['rev-parse',commit+'^{tree}'],root,ctx.signal);
  if(resolved!==commit||resolvedTree!==tree)fail('GRAPH_SOURCE_MISMATCH','Exact commit/tree identity differs');
  await command('git',['-c','core.hooksPath=/dev/null','checkout','--detach','--force',commit],root,ctx.signal);
  // Submodules need their own pinned repository extraction, never silently incomplete clones.
  const entries=await command('git',['ls-tree','-r',commit],root,ctx.signal,16*1024*1024);
  if(entries.split('\n').some(line=>line.startsWith('160000 ')))fail('GRAPH_SUBMODULE_MANIFEST_REQUIRED','Extract submodules as separately pinned repository bundles');
  let overlayDigest:string|null=null,overlayName:string|null=null;
  if(r.overlay!==undefined){
   const overlay=exact(r.overlay,['name','digest','files']);overlayName=text(overlay.name,'overlay name',128);overlayDigest=sha(overlay.digest);
   if(!Array.isArray(overlay.files)||overlay.files.length>256)fail('GRAPH_INVALID','Invalid bounded overlay');
   if(digest(canonical(overlay.files))!==overlayDigest)fail('GRAPH_DIGEST_MISMATCH','Overlay digest differs');
   const seen=new Set<string>();
   for(const value of overlay.files){
    const f=exact(value,['path','content_base64','digest','mode']);const rel=relative(f.path);
    if(seen.has(rel))fail('GRAPH_INVALID','Duplicate overlay path');seen.add(rel);
    if(f.mode!=='100644'&&f.mode!=='100755'&&f.mode!=='DELETE')fail('GRAPH_INVALID','Invalid overlay mode');
    const filename=path.join(root,rel);let parent=root;
    for(const part of rel.split('/').slice(0,-1)){parent=path.join(parent,part);try{const st=await fs.lstat(parent);if(!st.isDirectory()||st.isSymbolicLink())fail('GRAPH_PATH_DENIED','Overlay ancestor is unsafe');}catch(e){if(e instanceof FoundationError)throw e;if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await fs.mkdir(parent);}}
    try{const st=await fs.lstat(filename);if(!st.isFile()||st.isSymbolicLink())fail('GRAPH_PATH_DENIED','Overlay target is unsafe');}catch(e){if(e instanceof FoundationError)throw e;if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(f.mode==='DELETE'){if(f.content_base64!==null||f.digest!==null)fail('GRAPH_INVALID','Deleted overlay must have no body');await fs.rm(filename,{force:true});continue;}
    if(typeof f.content_base64!=='string'||f.content_base64.length>262144)fail('GRAPH_INVALID','Overlay body too large');
    const bytes=Buffer.from(f.content_base64,'base64');if(bytes.toString('base64')!==f.content_base64||digest(bytes)!==sha(f.digest))fail('GRAPH_DIGEST_MISMATCH','Overlay bytes differ');
    await fs.writeFile(filename,bytes,{mode:f.mode==='100755'?0o755:0o644});await fs.chmod(filename,f.mode==='100755'?0o755:0o644);
   }
  }
  try{await fs.lstat(root+'/.codegraph');fail('GRAPH_PATH_DENIED','Source cannot supply its own scanner database');}catch(e){if(e instanceof FoundationError)throw e;if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  await fs.mkdir(root+'/.codegraph/objects',{recursive:true});
  const before=await command('git',['rev-parse','HEAD'],root,ctx.signal);if(before!==commit)fail('GRAPH_SOURCE_MISMATCH','Checkout changed before extraction');
  const nativeStat=await fs.lstat(root+'/codify.kvx').catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;});
  if(nativeStat&&(!nativeStat.isFile()||nativeStat.isSymbolicLink()))fail('GRAPH_PATH_DENIED','Native configuration must be a regular file');
  await command(cfg.binary,['index','--full','--json','--workers','1'],root,ctx.signal);
  const db=new DatabaseSync(root+'/.codegraph/graph.db',{readOnly:true});
  let data:ReturnType<typeof snapshotRows>;
  try{db.exec('BEGIN');data=snapshotRows(db,cfg.maxRows,cfg.maxBytes);db.exec('COMMIT');}finally{db.close();}
  let factBytes=data.facts.reduce((n,f)=>n+Buffer.byteLength(canonical(f)),0);
  const appendFact=(fact:Fact)=>{const size=Buffer.byteLength(canonical(fact));if(data.facts.length>=cfg.maxRows||factBytes+size>cfg.maxBytes)fail('GRAPH_BUDGET_EXCEEDED','Source body facts exceed configured graph budget');factBytes+=size;data.facts.push(fact);};
  for(const f of data.facts.filter(f=>f.table==='files')){
   const rel=relative(f.row.path),filename=path.join(root,rel),st=await fs.lstat(filename);
   if(!st.isFile()||st.isSymbolicLink())fail('GRAPH_SOURCE_CHANGED','Source file no longer regular');
   const verified=await verifiedFile(filename,st.size,st.size<=2*1024*1024,ctx.signal);if(verified.hash!=='sha256:'+String(f.row.hash))fail('GRAPH_SOURCE_CHANGED','Source bytes changed after parsing');
   const bytes=verified.body;
   // Preserve body FTS coverage; large files remain explicitly body-ineligible.
   if(bytes!==null){const parts=Math.max(1,Math.ceil(bytes.length/32768));for(let part=0;part<parts;part++)appendFact({table:'source_bodies',key:digest(rel).slice(7)+':'+part,row:{path:rel,content_digest:digest(bytes),part_index:part,part_count:parts,total_bytes:bytes.length,body_base64:bytes.subarray(part*32768,(part+1)*32768).toString('base64')}});}
  }
  data.counts.source_bodies=data.facts.filter(f=>f.table==='source_bodies').length;
  const configStat=await fs.lstat(root+'/codify.kvx').catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;});
  if(configStat&&(!configStat.isFile()||configStat.isSymbolicLink()))fail('GRAPH_PATH_DENIED','Native configuration must be a regular file');
  const nativeConfigDigest=configStat?(await verifiedFile(root+'/codify.kvx',configStat.size,false,ctx.signal)).hash:digest(Buffer.alloc(0));
  const configDigest=digest(canonical({configuration,native_config_digest:nativeConfigDigest}));
  const sourceManifest={organisation_id:org,run_id:run,repository_id:repo,commit,tree,overlay_digest:overlayDigest,overlay_name:overlayName};
  const identity:ExtractionIdentity={...sourceManifest,generation,source_kind:overlayDigest?'OVERLAY':'COMMIT',parser_digest:cfg.binaryDigest,config_digest:configDigest,source_manifest_digest:digest(canonical(sourceManifest))};
  if(await command('git',['rev-parse','HEAD'],root,ctx.signal)!==commit)fail('GRAPH_SOURCE_CHANGED','Source HEAD changed during extraction');
  const chunks:GraphChunk[]=[];let pending:Fact[]=[];
  const finish=()=>{if(!pending.length)return;const body={schema_version:1 as const,identity,index:chunks.length,rows:pending};chunks.push({...body,digest:digest(canonical(body))});pending=[];};
  for(const fact of data.facts){if(Buffer.byteLength(canonical(fact))>cfg.chunkBytes-4096)fail('GRAPH_FACT_TOO_LARGE','One fact exceeds configured chunk bound');if(pending.length&&Buffer.byteLength(canonical(pending))+Buffer.byteLength(canonical(fact))>cfg.chunkBytes-4096)finish();pending.push(fact);}
  finish();
  if(chunks.reduce((n,c)=>n+Buffer.byteLength(canonical(c)),0)>cfg.maxBytes)fail('GRAPH_BUDGET_EXCEEDED','Graph byte budget exceeded');
  const body={schema_version:1 as const,identity,complete:data.coverage.complete===true,counts:data.counts,
   chunks:chunks.map(c=>({index:c.index,digest:c.digest,rows:c.rows.length,bytes:Buffer.byteLength(canonical(c))})),coverage:data.coverage,authority:'NONE' as const,cache:'NON_AUTHORITATIVE' as const};
  const manifest:BundleManifest={...body,bundle_digest:digest(canonical(body))};
  const destination=path.join(cfg.scratch,'bundles',manifest.bundle_digest.slice(7));await fs.mkdir(destination,{recursive:true});
  for(const c of chunks)await fs.writeFile(path.join(destination,c.index+'.json'),canonical(c),{flag:'wx',mode:0o600}).catch(async e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(await fs.readFile(path.join(destination,c.index+'.json'),'utf8')!==canonical(c))fail('GRAPH_DIGEST_MISMATCH','Existing chunk differs');});
  await fs.writeFile(path.join(destination,'manifest.json'),canonical(manifest),{flag:'wx',mode:0o600}).catch(async e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(await fs.readFile(path.join(destination,'manifest.json'),'utf8')!==canonical(manifest))fail('GRAPH_DIGEST_MISMATCH','Existing manifest differs');});
  await extractionGuard(ctx,identity,true);retain=true;return manifest;
 }finally{await fs.rm(work,{recursive:true,force:true});void retain;}
}
export async function createComponent(ctx:ComponentContext):Promise<Component> {
 let active=false;
 const getConfig=()=>config(ctx.env);
 const load=async(value:unknown)=>{const r=exact(value,['bundle_digest']),hash=sha(r.bundle_digest),cfg=await getConfig();const base=path.join(cfg.scratch,'bundles',hash.slice(7));const raw=await fs.readFile(path.join(base,'manifest.json'),'utf8').catch(()=>fail('GRAPH_BUNDLE_UNAVAILABLE','Named graph bundle is unavailable'));const m=validateManifest(JSON.parse(raw));const {bundle_digest,...body}=m;if(bundle_digest!==hash||digest(canonical(body))!==hash)fail('GRAPH_DIGEST_MISMATCH','Manifest differs');return {cfg,base,manifest:m};};
 return {apiVersion:1,actions:{
  'graph.extract.describe':input=>{exact(input,[]);return {schema_version:1,remote_execution_required:true,fact_families:[...GRAPH_TABLES,'source_bodies'],authority:'NONE',cache:'NON_AUTHORITATIVE',central_publication:false};},
  'graph.extract.create':async(input,context)=>{invocationOf(context);if(active)fail('GRAPH_OVERLOADED','One extraction per remote dispatcher');active=true;try{return await create(input,context,await getConfig());}finally{active=false;}},
  'graph.extract.inspect':async(input,context)=>{await extractionGuard(context);const loaded=await load(input);await extractionGuard(context,loaded.manifest.identity);return loaded.manifest;},
  'graph.extract.read-chunk':async(input,context)=>{await extractionGuard(context);const r=exact(input,['bundle_digest','index']);if(!Number.isSafeInteger(r.index)||Number(r.index)<0)fail('GRAPH_INVALID','Invalid chunk index');const {base,manifest}=await load({bundle_digest:r.bundle_digest});await extractionGuard(context,manifest.identity);const expected=manifest.chunks[Number(r.index)];if(!expected)fail('GRAPH_CHUNK_UNAVAILABLE','Chunk does not exist');const c=validateChunk(JSON.parse(await fs.readFile(path.join(base,r.index+'.json'),'utf8').catch(()=>fail('GRAPH_CHUNK_UNAVAILABLE','Named graph chunk is unavailable'))));if(c.digest!==expected.digest)fail('GRAPH_DIGEST_MISMATCH','Chunk differs from manifest');return c;}
 }};
}
