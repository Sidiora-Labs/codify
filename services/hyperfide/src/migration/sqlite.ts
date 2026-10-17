import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {identityTransaction,invocationOf} from '../identity/enrollment.js';
import type {IdentityTransaction} from '../identity/enrollment.js';
import {createLegacyWriterAdmission} from './legacy.js';
import {isArtifactStoreCapability} from '../artifacts/objects.js';
import {parseKvx} from '../spec/import.js';

type Json=Record<string,unknown>;
export interface Profile {id:string;source_id:string;repository_id:string;organisation_id:string;root:string;database:string;external?:{label:string;path:string;kind:string;sensitive?:boolean}[];kvx?:{label:string;path:string}[];archive_approved_digests?:string[]}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digestPattern=/^sha256:[0-9a-f]{64}$/;
const known=new Set(['meta','branches','files','symbols','refs','routes','memories','memory_superseded','git_commits','git_churn','leases','attempts','agents','runtime_events','events','fleet_runs','fleet_nodes','fleet_approvals','runtime_files','work_packets','work_files','work_evidence','imports','comments','projections','projection_findings','extraction_health','journal_applied']);
const live=new Set(['leases','attempts','agents','fleet_runs','fleet_nodes','fleet_approvals']);
const kinds=new Set(['configuration','journal','memory','attempt','event','graph','documentation','snapshot','native_session']);
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
export function hash(bytes:string|Buffer):string{return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}
export function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export function mappedId(source:string,repository:string,table:string,key:unknown):string{
 const raw=createHash('sha256').update(canonical(['hyperfide/sqlite-history/v1',source,repository,table,key])).digest('hex');
 return raw.slice(0,8)+'-'+raw.slice(8,12)+'-8'+raw.slice(13,16)+'-'+((parseInt(raw[16]!,16)&3)|8).toString(16)+raw.slice(17,20)+'-'+raw.slice(20,32);
}
function input(value:unknown,required:string[],optional:string[]=[]):Json{
 if(!object(value)||required.some(k=>!(k in value))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))fail('MIGRATION_INPUT','Unexpected migration fields');
 return value;
}
function id(value:unknown):string{if(typeof value!=='string'||!uuid.test(value))fail('MIGRATION_INPUT','Canonical UUID required');return value;}
function hex(value:unknown):string{if(typeof value!=='string'||!digestPattern.test(value))fail('MIGRATION_INPUT','SHA256 digest required');return value;}
export async function fileHash(filename:string):Promise<string>{const h=createHash('sha256');for await(const chunk of createReadStream(filename))h.update(chunk);return 'sha256:'+h.digest('hex');}
function quote(name:string):string{return '"'+name.replaceAll('"','""')+'"';}
export async function regular(root:string,relative:string):Promise<string>{
 if(!path.isAbsolute(root)||!relative||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(p=>p===''||p==='.'||p==='..'))fail('MIGRATION_PATH','Unsafe relative migration path');
 const rootInfo=await fs.lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())fail('MIGRATION_PATH','Trusted root must be a real directory');
 let current=root;
 for(const segment of relative.split('/')){current=path.join(current,segment);const st=await fs.lstat(current);if(st.isSymbolicLink())fail('MIGRATION_PATH','Symlinks are forbidden');}
 if(!(await fs.lstat(current)).isFile())fail('MIGRATION_PATH','Source is not a regular file');
 return current;
}
export async function profiles(env:Readonly<NodeJS.ProcessEnv>):Promise<Profile[]>{
 const filename=env.HF_MIGRATION_SOURCES_FILE;if(!filename)fail('MIGRATION_CONFIG','Trusted migration sources are required');
 const info=await fs.lstat(filename);if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)fail('MIGRATION_CONFIG','Invalid migration sources');
 const raw:unknown=JSON.parse(await fs.readFile(filename,'utf8'));
 if(!Array.isArray(raw)||raw.length>128)fail('MIGRATION_CONFIG','Invalid source profiles');
 const result:Profile[]=[];
 for(const item of raw){
 if(!object(item)||typeof item.id!=='string'||!/^[a-zA-Z0-9._-]{1,64}$/.test(item.id)||typeof item.root!=='string'||typeof item.database!=='string')fail('MIGRATION_CONFIG','Invalid source profile');
 id(item.source_id);id(item.repository_id);id(item.organisation_id);
 if(item.external!==undefined&&(!Array.isArray(item.external)||item.external.length>512))fail('MIGRATION_CONFIG','Invalid external inventory');
 if(item.kvx!==undefined&&(!Array.isArray(item.kvx)||item.kvx.length>16||item.kvx.some(k=>!object(k)||typeof k.label!=='string'||!/^[a-zA-Z0-9._-]{1,64}$/.test(k.label)||typeof k.path!=='string'||Object.keys(k).some(n=>n!=='label'&&n!=='path'))))fail('MIGRATION_CONFIG','Invalid KVX status inventory');
 if(item.archive_approved_digests!==undefined&&(!Array.isArray(item.archive_approved_digests)||item.archive_approved_digests.length>1024||item.archive_approved_digests.some(d=>typeof d!=='string'||!digestPattern.test(d))))fail('MIGRATION_CONFIG','Invalid trusted digest-specific archive approval');
 result.push(item as unknown as Profile);
 }
 if(new Set(result.map(p=>p.id)).size!==result.length)fail('MIGRATION_CONFIG','Duplicate source profile');
 return result;
}
async function profile(env:Readonly<NodeJS.ProcessEnv>,name:unknown):Promise<Profile>{
 const p=(await profiles(env)).find(p=>p.id===name);if(!p)fail('MIGRATION_SCOPE','Unknown trusted source profile');return p;
}
export async function archiveRoot(env:Readonly<NodeJS.ProcessEnv>):Promise<string>{
 const root=env.HF_MIGRATION_ARCHIVE_ROOT;if(!root||!path.isAbsolute(root))fail('MIGRATION_CONFIG','Trusted archive root required');
 const st=await fs.lstat(root);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)fail('MIGRATION_CONFIG','Archive root must be a private real directory');
 return root;
}
export function open(filename:string):DatabaseSync{
 const db=new DatabaseSync(filename,{readOnly:true,allowExtension:false,timeout:3000,readBigInts:true});
 db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');return db;
}
function rows(db:DatabaseSync,sql:string):Record<string,unknown>[] {const q=db.prepare(sql);q.setReadBigInts(true);return q.all() as Record<string,unknown>[];}
function plain(value:unknown):unknown{
 if(typeof value==='bigint')return value.toString();
 if(Array.isArray(value))return value.map(plain);
 if(object(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)]));
 return value;
}
export function inventory(db:DatabaseSync):Json{
 const ver=rows(db,"SELECT value FROM meta WHERE key='schema_version'")[0]?.value;
 if(ver!=='18')fail('MIGRATION_VERSION','Only inventoried schema18 sources are supported; source was not upgraded');
 const tableList=rows(db,'PRAGMA table_list');
 const objects=rows(db,"SELECT name,type,tbl_name,sql FROM sqlite_master ORDER BY type,name").map(r=>plain(r));
 const tables=tableList.filter(t=>t.schema==='main'&&!String(t.name).startsWith('sqlite_')).map(t=>{
 const name=String(t.name),type=String(t.type),virtual=type==='virtual',shadow=type==='shadow';
 const columns=rows(db,'PRAGMA table_xinfo('+quote(name)+')').map(plain);
 const foreign_keys=rows(db,'PRAGMA foreign_key_list('+quote(name)+')').map(plain);
 let count:string|null=null,diagnostic:string|null=null;
 try{count=String(rows(db,'SELECT count(*) AS count FROM '+quote(name))[0]?.count??'0');}catch{diagnostic='COUNT_UNAVAILABLE';}
 return {name,type,columns,foreign_keys,relationship_reconstruction:'NOT_PERFORMED',rows:count,without_rowid:String(t.wr)==='1',strict:String(t.strict)==='1',
 disposition:shadow?'ARCHIVE_ONLY':virtual?'ARCHIVE_ONLY':known.has(name)||name.startsWith('semantic_')?'HISTORY':'UNSUPPORTED_SEMANTICS',
 diagnostic:diagnostic??(virtual?'VIRTUAL_SEMANTICS_NOT_REBUILT':null)};
 }).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 const foreignKeyViolations:Record<string,number>={};let foreignKeyCheck='OBSERVED';
 try{
 const check=db.prepare('PRAGMA foreign_key_check');check.setReadBigInts(true);
 let count=0;for(const item of check.iterate() as Iterable<Record<string,unknown>>){
 if(++count>10000){foreignKeyCheck='TRUNCATED';break;}
 const key=String(item.table)+':'+String(item.fkid);foreignKeyViolations[key]=(foreignKeyViolations[key]??0)+1;
 }
 }catch{foreignKeyCheck='UNAVAILABLE';}
 return {schema_version:18,sqlite_version:String(rows(db,'SELECT sqlite_version() AS version')[0]?.version),tables,objects,
 declared_foreign_key_check:{status:foreignKeyCheck,violation_counts:foreignKeyViolations,semantic_relationship_coverage:'UNQUALIFIED'},
 graph_state:'UNPUBLISHED_HISTORY',search_parity:'UNQUALIFIED',authority:'NONE',qualification:'UNQUALIFIED'};
}
async function externalInventory(p:Profile):Promise<unknown[]>{
 const found:unknown[]=[];
 for(const item of p.external??[]){
 if(!item||typeof item.label!=='string'||!kinds.has(item.kind)||typeof item.path!=='string')fail('MIGRATION_CONFIG','Invalid external source declaration');
 if(item.sensitive||item.kind==='native_session'){found.push({label:item.label,kind:item.kind,availability:'EXCLUDED_SENSITIVE'});continue;}
 try{
 const filename=await regular(p.root,item.path),st=await fs.stat(filename);
 if(st.size>16*1024*1024){found.push({label:item.label,kind:item.kind,availability:'UNAVAILABLE',reason:'SIZE_BOUND'});continue;}
 const bytes=await fs.readFile(filename);
 found.push({label:item.label,kind:item.kind,availability:'OBSERVED',digest:hash(bytes),size_bytes:String(bytes.length),preservation:'SOURCE_REFERENCE_ONLY'});
 }catch(error){
 if(error instanceof FoundationError)throw error;
 found.push({label:item.label,kind:item.kind,availability:'UNAVAILABLE',reason:'NOT_READABLE'});
 }
 }
 for(const kind of kinds)if(!(p.external??[]).some(item=>item.kind===kind))found.push({label:kind,kind,availability:kind==='native_session'?'EXCLUDED_SENSITIVE':'UNAVAILABLE',reason:'NOT_DECLARED'});
 return found;
}
// Declared KVX planning status is preserved as a historical claim only. A
// done/QUALIFIED declaration never becomes task ownership or qualification.
async function kvxInventory(p:Profile):Promise<unknown[]>{
 const found:unknown[]=[];
 for(const item of p.kvx??[]){
 let bytes:Buffer;
 try{
 const filename=await regular(p.root,item.path);
 if((await fs.stat(filename)).size>4*1024*1024){found.push({label:item.label,availability:'UNAVAILABLE',reason:'SIZE_BOUND'});continue;}
 bytes=await fs.readFile(filename);
 }catch(error){
 if(error instanceof FoundationError)throw error;
 found.push({label:item.label,availability:'UNAVAILABLE',reason:'NOT_READABLE'});continue;
 }
 let document:ReturnType<typeof parseKvx>;
 try{document=parseKvx(bytes.toString('utf8'));}
 catch(error){found.push({label:item.label,availability:'UNAVAILABLE',reason:'KVX_UNSUPPORTED',diagnostic:error instanceof FoundationError?error.code:'KVX_PARSE_FAILED',digest:hash(bytes)});continue;}
 const field=(section:{fields:Record<string,{value:unknown}>},key:string):unknown=>Object.hasOwn(section.fields,key)?section.fields[key]!.value:null;
 const acceptances=Object.fromEntries(document.sections.filter(s=>s.name.startsWith('acceptance.')).map(s=>{
 const declared=field(s,'qualification');
 return [s.name.slice(11),{declared_qualification:typeof declared==='string'?declared:null,qualification:'UNQUALIFIED',source_line:s.line}];
 }));
 const tasks=document.sections.filter(s=>s.name.startsWith('task.')).map(s=>{
 const declared=field(s,'status'),ids=field(s,'acceptance_ids'),acceptance=Array.isArray(ids)?ids.filter((v):v is string=>typeof v==='string'):[];
 return {task:s.name.slice(5),declared_status:typeof declared==='string'?declared:null,source_line:s.line,
 declared_acceptance:Object.fromEntries(acceptance.map(id=>[id,(acceptances[id] as Json|undefined)?.declared_qualification??'UNDECLARED'])),
 claim:'HISTORICAL_DECLARATION',disposition:'HISTORY',ownership:'NONE',authority:'NONE',qualification:'UNQUALIFIED'};
 }).sort((a,b)=>a.task<b.task?-1:a.task>b.task?1:0);
 found.push({label:item.label,availability:'OBSERVED',digest:hash(bytes),size_bytes:String(bytes.length),tasks,acceptances,authority:'NONE',qualification:'UNQUALIFIED'});
 }
 if(!(p.kvx??[]).length)found.push({label:'kvx',availability:'UNAVAILABLE',reason:'NOT_DECLARED'});
 return found;
}
async function ready(pool:IdentityTransaction):Promise<void>{
 const r=await pool.query("SELECT to_regclass('hyperfide_history.imports')::text AS name");
 if(!r.rows[0]?.name)fail('MIGRATION_SCHEMA_REQUIRED','Apply the trusted 0025 migration before importing');
 const checksum=hash(await fs.readFile(new URL('../../migrations/0025-sqlite-history.sql',import.meta.url)));
 const applied=await pool.query("SELECT checksum FROM hyperfide.schema_migrations WHERE version=25 AND name='0025-sqlite-history'");
 if(applied.rows[0]?.checksum!==checksum)fail('MIGRATION_SCHEMA_REQUIRED','Exact pinned 0025 migration receipt required');
 const primary=await pool.query('SELECT pg_is_in_recovery() AS standby');if(primary.rows[0]?.standby)fail('PRIMARY_REQUIRED','Historical registration requires the primary');
}
async function snapshot(p:Profile,ctx:ComponentContext):Promise<unknown>{
 const root=await archiveRoot(ctx.env),source=await regular(p.root,p.database);
 const area=await fs.mkdtemp(path.join(root,'.snapshot-')),destination=path.join(area,'source.db');
 let db:DatabaseSync|undefined;
 try{
 db=open(source);await backup(db,destination);db.close();db=undefined;
 const archived=open(destination);
 let inv:Json;
 try{if(rows(archived,'PRAGMA quick_check')[0]?.quick_check!=='ok')fail('MIGRATION_CORRUPT','Snapshot integrity check failed');inv=inventory(archived);}finally{archived.close();}
 const size=(await fs.stat(destination)).size;const digest=await fileHash(destination),archive=path.join(root,digest.slice(7)+'.db');
 await fs.chmod(destination,0o400);
 try{await fs.link(destination,archive);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(await fileHash(archive)!==digest)fail('MIGRATION_CONFLICT','Archive collision');}
 const ext=await externalInventory(p);inv.task_status_history=await kvxInventory(p);
 return identityTransaction(ctx,async pool=>{await ready(pool);await scoped(pool,p,ctx);
 const importId=mappedId(p.source_id,p.repository_id,'snapshot',digest);
 await pool.query("INSERT INTO hyperfide_history.imports(id,source_id,repository_id,organisation_id,snapshot_digest,archive_path,inventory,external_inventory) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING",[importId,p.source_id,p.repository_id,p.organisation_id,digest,archive,inv,JSON.stringify(ext)]);
 const existing=await pool.query('SELECT organisation_id,source_id,repository_id,snapshot_digest FROM hyperfide_history.imports WHERE id=$1',[importId]);
 const value=existing.rows[0];
 if(!value||value.organisation_id!==p.organisation_id||value.source_id!==p.source_id||value.repository_id!==p.repository_id||value.snapshot_digest!==digest)fail('MIGRATION_CONFLICT','Historical import identity conflict');
 return {import_id:importId,snapshot_digest:digest,size_bytes:String(size),archive_durability:'LOCAL_UNQUALIFIED',inventory:inv,external_inventory:ext,authority:'NONE',qualification:'UNQUALIFIED'};
 });
 }finally{db?.close();await fs.rm(area,{recursive:true,force:true});}
}
async function load(p:Profile,importId:string,ctx:ComponentContext):Promise<Json>{
 const result=await identityTransaction(ctx,async tx=>{await ready(tx);await scoped(tx,p,ctx);return tx.query('SELECT * FROM hyperfide_history.imports WHERE id=$1 AND source_id=$2 AND repository_id=$3 AND organisation_id=$4',[importId,p.source_id,p.repository_id,p.organisation_id]);});
 if(!result.rows[0])fail('MIGRATION_SCOPE','Import not found within trusted scope');
 const value=result.rows[0] as Json;const digest=hex(value.snapshot_digest),root=await archiveRoot(ctx.env);
 const filename=await regular(root,digest.slice(7)+'.db');
 if(await fileHash(filename)!==digest)fail('MIGRATION_CORRUPT','Snapshot digest mismatch');
 return {...value,archive_path:filename};
}
function cell(value:unknown):unknown {
 if(value===null)return {type:'null'};
 if(typeof value==='bigint')return {type:'integer',value:value.toString()};
 if(typeof value==='number'){const b=Buffer.alloc(8);b.writeDoubleBE(value);return {type:'real',ieee754:b.toString('hex')};}
 if(typeof value==='string')return {type:'text',utf8_base64:Buffer.from(value).toString('base64')};
 if(value instanceof Uint8Array)return {type:'blob',base64:Buffer.from(value).toString('base64')};
 return fail('MIGRATION_UNSUPPORTED','Unsupported SQLite value representation');
}
export interface LogicalRow {key:unknown;data:unknown;mapped:string;digest:string;disposition:string}
/** The one logical-row encoder. Import batches and cutover parity samples must agree
 * byte-for-byte, so neither may re-derive keys, cells or payload digests independently. */
export function logicalBatch(db:DatabaseSync,table:string,offset:string,limit:number,source:string,repository:string):{rows:LogicalRow[];total:bigint}{
 const payloads:LogicalRow[]=[];let total=0n;
 const inv=inventory(db),tables=inv.tables as Json[],meta=tables.find(t=>t.name===table);
 if(!meta||meta.disposition==='ARCHIVE_ONLY')fail('MIGRATION_UNSUPPORTED','Only inventoried ordinary tables can import logical history');
 const cols=rows(db,'PRAGMA table_xinfo('+quote(table)+')').filter(c=>String(c.hidden)!=='1');
 const primary=cols.filter(c=>BigInt(String(c.pk))>0n).sort((a,b)=>Number(a.pk)-Number(b.pk));
 const keyNames=primary.map(c=>String(c.name));
 const names=cols.map(c=>String(c.name));
 if(names.length>256)fail('MIGRATION_COLUMN_BOUND','Logical history table exceeds bounded column count; immutable source remains preserved');
 const lowerNames=new Set(names.map(n=>n.toLowerCase()));
 const rowidAlias=['rowid','_rowid_','oid'].find(n=>!lowerNames.has(n));
 if(!keyNames.length&&!rowidAlias)fail('MIGRATION_UNSUPPORTED','No unambiguous stable legacy key');
 const rowid=!keyNames.length;
 const order=rowid?quote(rowidAlias!):keyNames.map(quote).join(',');
 const expressions=names.flatMap((n,i)=>['typeof('+quote(n)+') AS '+quote('type_'+i),quote(n)+' AS '+quote('value_'+i),'CAST('+quote(n)+' AS BLOB) AS '+quote('bytes_'+i)]);
 if(rowidAlias&&meta.without_rowid!==true)expressions.push(quote(rowidAlias)+' AS "__hf_rowid"');
 // Length metadata is inspected before any BLOB/TEXT value crosses into JS.
 // Both the scan and retained logical batch have explicit byte budgets.
 const lengths=names.map(n=>'CASE WHEN typeof('+quote(n)+") IN ('blob','text') THEN length(CAST("+quote(n)+' AS BLOB)) ELSE 32 END');
 const preflight=db.prepare('SELECT '+lengths.join(',')+' FROM '+quote(table)+' ORDER BY '+order+' LIMIT ? OFFSET ?');preflight.setReadBigInts(true);
 let rawBatch=0n;
 for(const row of preflight.iterate(BigInt(limit),BigInt(offset)) as Iterable<Record<string,unknown>>){
 let rawRow=0n;
 for(const value of Object.values(row)){
 const bytes=BigInt(String(value??0));if(bytes>4n*1024n*1024n)fail('MIGRATION_CELL_SIZE_BOUND','One legacy cell exceeds bounded logical import; original archive remains preserved');
 rawRow+=bytes;
 }
 if(rawRow>6n*1024n*1024n)fail('MIGRATION_ROW_SIZE_BOUND','One legacy row exceeds bounded logical import; original archive remains preserved');
 rawBatch+=rawRow;if(rawBatch>6n*1024n*1024n)fail('MIGRATION_BATCH_SIZE_BOUND','Requested logical batch exceeds its aggregate byte budget; reduce the batch limit');
 }
 const q=db.prepare('SELECT '+expressions.join(',')+' FROM '+quote(table)+' ORDER BY '+order+' LIMIT ? OFFSET ?');q.setReadBigInts(true);
 const fetched=q.iterate(BigInt(limit),BigInt(offset)) as Iterable<Record<string,unknown>>;
 total=BigInt(String(meta.rows));
 if(BigInt(offset)>total)fail('MIGRATION_INPUT','Offset exceeds immutable source row count');
 let encodedBatch=0;
 for(const r of fetched){
 const values=names.map((_n,i)=>r['type_'+i]==='text'?{type:'text',utf8_base64:Buffer.from(r['bytes_'+i] as Uint8Array).toString('base64')}:cell(r['value_'+i]));
 const key=rowid?[cell(r.__hf_rowid)]:keyNames.map(n=>values[names.indexOf(n)]);
 if(!rowid&&key.some(value=>object(value)&&value.type==='null')){
 if(r.__hf_rowid===undefined)fail('MIGRATION_UNSUPPORTED','Nullable primary key has no unambiguous rowid identity; original archive remains preserved');
 key.push({type:'sqlite-rowid',value:cell(r.__hf_rowid)});
 }
 const data=names.map((n,i)=>({column:n,value:values[i]}));
 const encoded=canonical(data);
 const encodedBytes=Buffer.byteLength(encoded);
 if(encodedBytes>8*1024*1024)fail('MIGRATION_ROW_SIZE_BOUND','Logical row exceeds bounded representation; original archive preserved');
 encodedBatch+=encodedBytes;if(encodedBatch>8*1024*1024)fail('MIGRATION_BATCH_SIZE_BOUND','Logical batch exceeds aggregate encoded byte budget; reduce batch limit');
 payloads.push({key,data,mapped:mappedId(source,repository,table,key),digest:hash(encoded),
 disposition:live.has(table)?'REQUIRES_RECONCILIATION':String(meta.disposition)});
 }
 return {rows:payloads,total};
}
async function importBatch(p:Profile,value:Json,ctx:ComponentContext):Promise<unknown>{
 const importId=id(value.import_id),offset=value.offset,limit=value.limit,table=value.table;
 if(typeof offset!=='string'||!/^(0|[1-9][0-9]{0,14})$/.test(offset)||typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>500||typeof table!=='string')fail('MIGRATION_INPUT','Bounded table, decimal offset and batch limit required');
 const prior=await load(p,importId,ctx),db=open(String(prior.archive_path));let payloads:LogicalRow[]=[];
 let total=0n;
 try{({rows:payloads,total}=logicalBatch(db,table,offset,limit,p.source_id,p.repository_id));
 }finally{db.close();}
 const requestDigest=hash(canonical({importId,table,offset,limit,snapshot:prior.snapshot_digest}));
 try{return await identityTransaction(ctx,async client=>{
 await ready(client);await scoped(client,p,ctx);
 await client.query('SELECT id FROM hyperfide_history.imports WHERE id=$1 FOR UPDATE',[importId]);
 const existing=await client.query('SELECT request_digest,result FROM hyperfide_history.batches WHERE import_id=$1 AND table_name=$2 AND start_offset=$3',[importId,table,offset]);
 if(existing.rows[0]){if(existing.rows[0].request_digest!==requestDigest)fail('MIGRATION_CONFLICT','Batch replay changed the pinned request');return {...existing.rows[0].result,replayed:true};}
 const checkpoint=await client.query("SELECT COALESCE(max((result->>'next_offset')::bigint),0)::text AS next FROM hyperfide_history.batches WHERE import_id=$1 AND table_name=$2",[importId,table]);
 if(checkpoint.rows[0]?.next!==offset)fail('MIGRATION_CONFLICT','Batch offset must continue the durable checkpoint');
 // The immutable snapshot and deterministic key make restart/replay independent of local process state.
 for(const row of payloads){
 const inserted=await client.query('INSERT INTO hyperfide_history.rows(import_id,mapped_id,table_name,legacy_key,payload,payload_digest,disposition) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(import_id,mapped_id) DO UPDATE SET mapped_id=EXCLUDED.mapped_id WHERE hyperfide_history.rows.payload_digest=EXCLUDED.payload_digest RETURNING mapped_id',[importId,row.mapped,table,JSON.stringify(row.key),JSON.stringify(row.data),row.digest,row.disposition]);
 if(inserted.rowCount!==1)fail('MIGRATION_CONFLICT','Historical row changed under an existing key');
 }
 const next=BigInt(offset)+BigInt(payloads.length),result={outcome:'SUCCEEDED',import_id:importId,table,offset,next_offset:next.toString(),imported:payloads.length,complete:next>=total,authority:'NONE',qualification:'UNQUALIFIED'};
 await client.query('INSERT INTO hyperfide_history.batches(import_id,table_name,start_offset,request_digest,result) VALUES($1,$2,$3,$4,$5)',[importId,table,offset,requestDigest,result]);
 return result;
 });}catch(error){
 if(object(error)&&error.code==='COMMIT_AMBIGUOUS')return {outcome:'UNKNOWN',import_id:importId,table,offset,reconcile:'REPLAY_IDENTICAL_BATCH',automatic_replay:false,authority:'NONE',qualification:'UNQUALIFIED'};
 throw error;
 }
}
function verifiedArtifact(raw:unknown,expectedDigest?:string,expectedSize?:string):Record<string,unknown>|null {
 if(!object(raw)||raw.outcome!=='SUCCEEDED'||raw.availability!=='VERIFIED'||!object(raw.artifact)||!object(raw.receipt)||typeof raw.receipt.receipt_id!=='string'||!digestPattern.test(raw.receipt.receipt_id))return null;
 const a=raw.artifact;
 if(typeof a.artifact_id!=='string'||!uuid.test(a.artifact_id)||a.status!=='COMPLETE'||expectedDigest!==undefined&&a.digest!==expectedDigest||expectedSize!==undefined&&a.size_bytes!==expectedSize)return null;
 return a;
}
async function preserve(p:Profile,importId:string,ctx:ComponentContext):Promise<unknown>{
 const stored=await load(p,importId,ctx),snapshotDigest=hex(stored.snapshot_digest),i=invocationOf(ctx);
 // Approval comes from trusted server configuration and binds the exact bytes.
 // No caller assertion can classify an arbitrary historical database as safe.
 if(!p.archive_approved_digests?.includes(snapshotDigest))fail('SECRET_REVIEW_REQUIRED','Exact snapshot digest requires trusted sanitisation approval before external archival');
 const store=ctx.dependencies.require('15.2','artifact.store.v1',isArtifactStoreCapability);
 const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id},retention={retention_class:'RUN',retention_until:null,retention_hold:false};
 const filename=String(stored.archive_path),size=(await fs.stat(filename)).size;
 if(size>2048*256*1024)fail('MIGRATION_ARCHIVE_SIZE_BOUND','Archive exceeds bounded complete-manifest capacity; local snapshot remains preserved and unqualified');
 const handle=await fs.open(filename,'r'),chunks:Record<string,unknown>[]=[];let offset=0;
 try{
 while(offset<size){
 const bytes=Buffer.alloc(Math.min(256*1024,size-offset)),observed=await handle.read(bytes,0,bytes.length,offset);
 if(observed.bytesRead!==bytes.length)fail('MIGRATION_CORRUPT','Immutable archive changed during preservation');
 const digest=hash(bytes),raw=await store.invoke('artifact.object.put',{...scope,...retention,digest,size_bytes:String(bytes.length),data_base64:bytes.toString('base64')},i);
 const artifact=verifiedArtifact(raw,digest,String(bytes.length));
 if(!artifact)return identityTransaction(ctx,async()=>({outcome:'UNKNOWN',import_id:importId,snapshot_digest:snapshotDigest,archive_durability:'UNQUALIFIED',automatic_replay:false,reconcile:'REPEAT_IDENTICAL_ARCHIVE',authority:'NONE',qualification:'UNQUALIFIED'}));
 chunks.push({sequence:chunks.length,artifact_id:artifact.artifact_id,digest,size_bytes:String(bytes.length),offset_bytes:String(offset)});offset+=bytes.length;
 }
 }finally{await handle.close();}
 if(await fileHash(filename)!==snapshotDigest)fail('MIGRATION_CORRUPT','Snapshot changed during external preservation');
 const manifest={...scope,...retention,expected_chunks:chunks.length,total_size_bytes:String(size),content_digest:snapshotDigest,complete:true,truncated:false,missing_ranges:[],chunks};
 const raw=await store.invoke('artifact.manifest.commit',manifest,i),artifact=verifiedArtifact(raw);
 if(!artifact)return identityTransaction(ctx,async()=>({outcome:'UNKNOWN',import_id:importId,snapshot_digest:snapshotDigest,archive_durability:'UNQUALIFIED',automatic_replay:false,reconcile:'REPEAT_IDENTICAL_ARCHIVE',authority:'NONE',qualification:'UNQUALIFIED'}));
 const observed=await store.invoke('artifact.manifest.read',{...scope,artifact_id:artifact.artifact_id},i);
 if(!verifiedArtifact(observed)||!object(observed)||observed.content_digest!==snapshotDigest)fail('MIGRATION_ARCHIVE_UNAVAILABLE','Committed archive closure could not be verified');
 const evidence={classification:'TRUSTED_DIGEST_APPROVED',approved_snapshot_digest:snapshotDigest,manifest_artifact_id:artifact.artifact_id,manifest_digest:artifact.digest,receipt:object(raw)?raw.receipt:null,content_digest:snapshotDigest,size_bytes:String(size),availability:'VERIFIED'};
 try{return await identityTransaction(ctx,async tx=>{
 await scoped(tx,p,ctx);
 await tx.query("UPDATE hyperfide_history.imports SET inventory=inventory||jsonb_build_object('archives',COALESCE(inventory->'archives','{}'::jsonb)||jsonb_build_object($2::text,$3::jsonb)) WHERE id=$1",[importId,scope.run_id,JSON.stringify(evidence)]);
 return {outcome:'SUCCEEDED',import_id:importId,snapshot_digest:snapshotDigest,archive_durability:'ARTIFACT_RECEIPT',archive:evidence,authority:'NONE',qualification:'UNQUALIFIED'};
 });}catch(error){
 if(object(error)&&error.code==='COMMIT_AMBIGUOUS')return {outcome:'UNKNOWN',import_id:importId,manifest_artifact_id:artifact.artifact_id,automatic_replay:false,reconcile:'REPEAT_IDENTICAL_ARCHIVE',authority:'NONE',qualification:'UNQUALIFIED'};
 throw error;
 }
}
export const MIGRATION_ACTIONS=['migration.sqlite.describe','migration.sqlite.snapshot','migration.sqlite.inventory','migration.sqlite.archive','migration.sqlite.import','migration.sqlite.status'] as const;
async function scoped(tx:IdentityTransaction,p:Profile,ctx:ComponentContext):Promise<void>{
 const i=invocationOf(ctx),principal=i.principal;
 if(p.organisation_id!==principal.organisation_id)fail('MIGRATION_SCOPE','Source profile is outside authenticated organisation');
 const r=await tx.query('SELECT repository_id FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3',[principal.organisation_id,principal.run_id,p.repository_id]);
 if(!r.rows[0])fail('MIGRATION_SCOPE','Source repository is not part of authenticated run');
}
export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,capabilities:{'migration.legacy-writers.v1':createLegacyWriterAdmission(_startup.env)},actions:Object.fromEntries(MIGRATION_ACTIONS.map(action=>[action,async(raw:unknown,ctx:ComponentContext)=>{
 const i=invocationOf(ctx);
 if(i.payload.action!==action||i.payload.component!=='25.1'||i.payload.run_id!==i.principal.run_id)fail('MIGRATION_SCOPE','Authenticated action scope mismatch');
 if(!['OPERATOR','LEADER','COORDINATOR'].includes(i.principal.role))fail('MIGRATION_ROLE','Migration requires an authenticated supervisory role');
 if(ctx.signal.aborted)fail('MIGRATION_CLOSED','Migration is shutting down');
 await identityTransaction(ctx,async tx=>{await ready(tx);});
 if(action.endsWith('.describe')){input(raw,[]);return {schema_version:1,source_schema_versions:[18],snapshot:'SQLITE_BACKUP_API',authority:'NONE',qualification:'UNQUALIFIED',cutover:'SEPARATE_REQUIRED_OPERATION'};}
 const v=input(raw,['source'],action.endsWith('.snapshot')?[]:action.endsWith('.import')?['import_id','table','offset','limit']:['import_id']);
 const p=await profile(ctx.env,v.source);await identityTransaction(ctx,tx=>scoped(tx,p,ctx));
 if(action.endsWith('.snapshot'))return snapshot(p,ctx);
 const stored=await load(p,id(v.import_id),ctx);
 if(action.endsWith('.inventory'))return identityTransaction(ctx,async tx=>{await scoped(tx,p,ctx);return {import_id:stored.id,inventory:stored.inventory,external_inventory:stored.external_inventory,authority:'NONE',qualification:'UNQUALIFIED'};});
 if(action.endsWith('.archive'))return preserve(p,id(v.import_id),ctx);
 if(action.endsWith('.import'))return importBatch(p,v,ctx);
 return identityTransaction(ctx,async tx=>{await scoped(tx,p,ctx);
 const counts=await tx.query('SELECT table_name,count(*)::text AS rows FROM hyperfide_history.rows WHERE import_id=$1 GROUP BY table_name ORDER BY table_name',[stored.id]);
 return {import_id:stored.id,tables:counts.rows,authority:'NONE',qualification:'UNQUALIFIED'};
 });
 }]))};}
