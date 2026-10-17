import fs, {constants as F} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {FileHandle} from 'node:fs/promises';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';

type Item={from:string;to:string;digest:string;size:number;mode:number};
export interface NamesManifest {
 schema_version:1;migration_id:string;files:Item[];
 retained_paths:{path:string;state:string;policy:'PRESERVE_IN_PLACE'}[];
 digest:string;
}
const MAP=Object.freeze([
 {from:'codify.kvx',to:'hyperfide.kvx'},
 {from:'.codify/agent-context.md',to:'.hyperfide/context/agent-context.md'}
]);
export const ENVIRONMENT_ALIASES=Object.freeze([
 [
  "HYPERFIDE_AGENT",
  "CG_AGENT"
 ],
 [
  "HYPERFIDE_ATTEMPT",
  "CG_ATTEMPT"
 ],
 [
  "HYPERFIDE_BASE",
  "CG_BASE"
 ],
 [
  "HYPERFIDE_BINARY",
  "CG_BINARY"
 ],
 [
  "HYPERFIDE_BODY_FIRST",
  "CG_BODY_FIRST"
 ],
 [
  "HYPERFIDE_BRANCH",
  "CG_BRANCH"
 ],
 [
  "HYPERFIDE_BUSY_TIMEOUT_MS",
  "CG_BUSY_TIMEOUT_MS"
 ],
 [
  "HYPERFIDE_CHANGELOG_CURL",
  "CG_CHANGELOG_CURL"
 ],
 [
  "HYPERFIDE_CHANGELOG_ENDPOINT",
  "CG_CHANGELOG_ENDPOINT"
 ],
 [
  "HYPERFIDE_CHANGELOG_KEY",
  "CG_CHANGELOG_KEY"
 ],
 [
  "HYPERFIDE_CHANGELOG_MODEL",
  "CG_CHANGELOG_MODEL"
 ],
 [
  "HYPERFIDE_CLAUDE",
  "CG_CLAUDE"
 ],
 [
  "HYPERFIDE_COLOR",
  "CG_COLOR"
 ],
 [
  "HYPERFIDE_EVENTS_KEEP",
  "CG_EVENTS_KEEP"
 ],
 [
  "HYPERFIDE_FEATURE",
  "CG_FEATURE"
 ],
 [
  "HYPERFIDE_FENCE",
  "CG_FENCE"
 ],
 [
  "HYPERFIDE_GH",
  "CG_GH"
 ],
 [
  "HYPERFIDE_HOST",
  "CG_HOST"
 ],
 [
  "HYPERFIDE_INDEX_SLOTS",
  "CG_INDEX_SLOTS"
 ],
 [
  "HYPERFIDE_INDEX_WORKERS",
  "CG_INDEX_WORKERS"
 ],
 [
  "HYPERFIDE_INSPECT_REACH_LIMIT",
  "CG_INSPECT_REACH_LIMIT"
 ],
 [
  "HYPERFIDE_JEV_ATTEMPTS",
  "CG_JEV_ATTEMPTS"
 ],
 [
  "HYPERFIDE_JEV_BACKOFF_MS",
  "CG_JEV_BACKOFF_MS"
 ],
 [
  "HYPERFIDE_JEV_CURL",
  "CG_JEV_CURL"
 ],
 [
  "HYPERFIDE_JEV_ENDPOINT",
  "CG_JEV_ENDPOINT"
 ],
 [
  "HYPERFIDE_JEV_MODEL",
  "CG_JEV_MODEL"
 ],
 [
  "HYPERFIDE_JEV_TIMEOUT",
  "CG_JEV_TIMEOUT"
 ],
 [
  "HYPERFIDE_MERGE_LOCK_WAIT_MS",
  "CG_MERGE_LOCK_WAIT_MS"
 ],
 [
  "HYPERFIDE_PACKET_BUDGET",
  "CG_PACKET_BUDGET"
 ],
 [
  "HYPERFIDE_PARENT",
  "CG_PARENT"
 ],
 [
  "HYPERFIDE_PROGRESS",
  "CG_PROGRESS"
 ],
 [
  "HYPERFIDE_PROGRESS_ENFORCE",
  "CG_PROGRESS_ENFORCE"
 ],
 [
  "HYPERFIDE_RECAP_CHUNK",
  "CG_RECAP_CHUNK"
 ],
 [
  "HYPERFIDE_RECAP_CLAUDE_DIR",
  "CG_RECAP_CLAUDE_DIR"
 ],
 [
  "HYPERFIDE_RECAP_CODEX_DIR",
  "CG_RECAP_CODEX_DIR"
 ],
 [
  "HYPERFIDE_RECAP_DECIDE_ENDPOINT",
  "CG_RECAP_DECIDE_ENDPOINT"
 ],
 [
  "HYPERFIDE_RECAP_DECIDE_MODEL",
  "CG_RECAP_DECIDE_MODEL"
 ],
 [
  "HYPERFIDE_RECAP_MAX_SNIPPETS",
  "CG_RECAP_MAX_SNIPPETS"
 ],
 [
  "HYPERFIDE_RECAP_MODEL",
  "CG_RECAP_MODEL"
 ],
 [
  "HYPERFIDE_RECAP_PARALLEL",
  "CG_RECAP_PARALLEL"
 ],
 [
  "HYPERFIDE_ROLE",
  "CG_ROLE"
 ],
 [
  "HYPERFIDE_RUN",
  "CG_RUN"
 ],
 [
  "HYPERFIDE_SEM_FAIL_BEFORE_PUBLISH",
  "CG_SEM_FAIL_BEFORE_PUBLISH"
 ],
 [
  "HYPERFIDE_SESSION",
  "CG_SESSION"
 ],
 [
  "HYPERFIDE_SHELL_ADVICE",
  "CG_SHELL_ADVICE"
 ],
 [
  "HYPERFIDE_SLOT_DIR",
  "CG_SLOT_DIR"
 ],
 [
  "HYPERFIDE_SUPERVISOR_LOG",
  "CG_SUPERVISOR_LOG"
 ],
 [
  "HYPERFIDE_TASK",
  "CG_TASK"
 ],
 [
  "HYPERFIDE_WALK_THREADS",
  "CG_WALK_THREADS"
 ],
 [
  "HYPERFIDE_WATCH_POLL_MS",
  "CG_WATCH_POLL_MS"
 ],
 [
  "HYPERFIDE_WATCH_TEST_EVENT",
  "CG_WATCH_TEST_EVENT"
 ],
 [
  "HYPERFIDE_WATCH_TEST_REG_FAIL_ONCE",
  "CG_WATCH_TEST_REG_FAIL_ONCE"
 ],
 [
  "HYPERFIDE_WATCH_TEST_SYNC_FAIL_ONCE",
  "CG_WATCH_TEST_SYNC_FAIL_ONCE"
 ],
 [
  "HYPERFIDE_WAVE",
  "CG_WAVE"
 ],
 [
  "HYPERFIDE_ROOT",
  "CODIFY_ROOT"
 ],
 [
  "HYPERFIDE_AUTHORITY_URL",
  "CG_AUTHORITY_URL",
  "CODIFY_AUTHORITY_URL"
 ],
 [
  "HYPERFIDE_CREDENTIAL_FILE",
  "CG_CREDENTIAL_FILE",
  "CODIFY_CREDENTIAL_FILE"
 ],
 [
  "HYPERFIDE_AUTHORITY_DESCRIPTOR",
  "CG_AUTHORITY_DESCRIPTOR",
  "CODIFY_AUTHORITY_DESCRIPTOR"
 ],
 [
  "HYPERFIDE_TRANSPORT_CONFIG",
  "CG_TRANSPORT_CONFIG",
  "CODIFY_TRANSPORT_CONFIG"
 ],
 [
  "HYPERFIDE_MCP_TOOL_POLICY_FILE",
  "CG_MCP_TOOL_POLICY_FILE",
  "CODIFY_MCP_TOOL_POLICY_FILE"
 ],
 [
  "HYPERFIDE_MODE",
  "CG_MODE",
  "CODIFY_MODE"
 ],
 [
  "HYPERFIDE_INSTALL_DIR",
  "CODIFY_INSTALL_DIR"
 ],
 [
  "HYPERFIDE_BASE_URL",
  "CODIFY_BASE_URL"
 ]
].map(x=>Object.freeze(x)));
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
export function strictObject(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_REQUEST','Expected an object');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail('INVALID_REQUEST','Unexpected request fields');
 return v;
}
export function relativePath(value:unknown,empty=false):string{
 if(typeof value!=='string'||value.length>4096||/[\\\x00-\x1f\x7f]/.test(value)||
 (!empty&&!value)||value.startsWith('/')||value.split('/').some(x=>x==='.'||x==='..'||(!x&&value!=='')))
 fail('INVALID_PATH','Expected a contained relative path');
 return value;
}
export function resolveEnvironmentAliases(env:Readonly<NodeJS.ProcessEnv>):NodeJS.ProcessEnv{
 const result={...env};
 for(const names of ENVIRONMENT_ALIASES){
  const supplied=names.filter(n=>env[n]!==undefined);
  if(supplied.some(n=>env[n]!==env[supplied[0]!]))fail('ALIAS_CONFLICT','Conflicting variable aliases: '+names.join(', '));
  if(supplied.length)for(const n of names)result[n]=env[supplied[0]!];
 }
 return result;
}
export const contentDigest=(data:Uint8Array|string):string=>'sha256:'+createHash('sha256').update(data).digest('hex');
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
export async function openDirectory(root:FileHandle,relative:string,create=false):Promise<FileHandle>{
 relativePath(relative,true);
 let current=await fs.open('/proc/self/fd/'+root.fd,F.O_RDONLY|F.O_DIRECTORY);
 try{
  for(const segment of relative?relative.split('/'):[]){
   const next='/proc/self/fd/'+current.fd+'/'+segment;
   if(create)try{await fs.mkdir(next,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
   const child=await fs.open(next,F.O_RDONLY|F.O_DIRECTORY|F.O_NOFOLLOW);
   await current.close();current=child;
  }
  return current;
 }catch(e){await current.close();throw e;}
}
export async function openWorkspace(context:ComponentContext,relative:unknown):Promise<FileHandle>{
 const configured=context.env.HF_MIGRATION_ALLOWED_ROOT;
 if(!configured||!path.isAbsolute(configured))fail('MIGRATION_ROOT_REQUIRED','A trusted absolute migration root is required');
 const root=await fs.open(configured,F.O_RDONLY|F.O_DIRECTORY|F.O_NOFOLLOW);
 try{return await openDirectory(root,relativePath(relative,true));}finally{await root.close();}
}
export async function readContained(root:FileHandle,relative:string):Promise<{bytes:Buffer;mode:number}|null>{
 relativePath(relative);
 let dir:FileHandle;
 try{dir=await openDirectory(root,path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative));}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
 try{
  let file:FileHandle;
  try{file=await fs.open('/proc/self/fd/'+dir.fd+'/'+path.posix.basename(relative),F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK);}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  try{
   const before=await file.stat({bigint:true});
   if(!before.isFile()||before.nlink!==1n||before.size>4194304n)fail('MIGRATION_INPUT_INVALID','Migration requires bounded regular files without hard links');
   const bytes=await file.readFile(),after=await file.stat({bigint:true});
   if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)
    fail('MIGRATION_INPUT_CHANGED','A migration input changed during inspection');
   return {bytes,mode:Number(before.mode)&0o777};
  }finally{await file.close();}
 }finally{await dir.close();}
}
async function writeAtomic(root:FileHandle,relative:string,bytes:Uint8Array,mode=0o600,exclusive=false):Promise<void>{
 const parent=path.posix.dirname(relative),dir=await openDirectory(root,parent==='.'?'':parent,true);
 const leaf=path.posix.basename(relative),target='/proc/self/fd/'+dir.fd+'/'+leaf;
 const temporary=target+'.tmp-'+process.pid+'-'+createHash('sha256').update(bytes).digest('hex').slice(0,16);
 try{
  const handle=await fs.open(temporary,F.O_WRONLY|F.O_CREAT|F.O_EXCL|F.O_NOFOLLOW,mode);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  if(exclusive){await fs.link(temporary,target);await fs.unlink(temporary);}
  else await fs.rename(temporary,target);
  await dir.sync();
 }finally{await fs.unlink(temporary).catch(()=>{});await dir.close();}
}
async function removeContained(root:FileHandle,relative:string):Promise<void>{
 const parent=path.posix.dirname(relative),dir=await openDirectory(root,parent==='.'?'':parent);
 try{await fs.unlink('/proc/self/fd/'+dir.fd+'/'+path.posix.basename(relative));await dir.sync();}
 finally{await dir.close();}
}
async function json(root:FileHandle,relative:string):Promise<unknown|null>{
 const data=await readContained(root,relative);if(!data)return null;
 try{return JSON.parse(data.bytes.toString('utf8'));}catch{fail('MIGRATION_JOURNAL_INVALID','Invalid migration metadata');}
}
async function writeJSON(root:FileHandle,relative:string,value:unknown):Promise<void>{
 await writeAtomic(root,relative,Buffer.from(canonical(value)+'\n'));
}
async function locked<T>(root:FileHandle,operation:()=>Promise<T>):Promise<T>{
 const dir=await openDirectory(root,'.hyperfide/migrations',true);
 const handle=await fs.open('/proc/self/fd/'+dir.fd+'/names.lock',F.O_RDWR|F.O_CREAT|F.O_NOFOLLOW,0o600);
 const lockInfo=await handle.stat();
 if(!lockInfo.isFile()||lockInfo.nlink!==1){await handle.close();await dir.close();fail('MIGRATION_LOCK_UNAVAILABLE','Migration lock must be a regular nonshared file');}
 const child=spawn('/bin/sh',['-c','/usr/bin/flock -n 3 || exit 75; printf "HF_LOCK_READY\\n"; cat >/dev/null'],
  {stdio:['pipe','pipe','pipe',handle.fd],env:{PATH:'/usr/bin:/bin'}});
 const ended=new Promise<void>(resolve=>child.once('close',()=>resolve()));
 try{
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new FoundationError('MIGRATION_BUSY','Migration lock deadline exceeded'));},3000);
   child.once('error',()=>{clearTimeout(timer);reject(new FoundationError('MIGRATION_LOCK_UNAVAILABLE','Kernel file locking is unavailable'));});
   child.once('exit',()=>{clearTimeout(timer);reject(new FoundationError('MIGRATION_BUSY','Another migration owns this workspace'));});
   child.stdout!.once('data',data=>{clearTimeout(timer);if(String(data).trim()==='HF_LOCK_READY')resolve();else reject(new FoundationError('MIGRATION_LOCK_UNAVAILABLE','Invalid lock handshake'));});
  });
  return await operation();
 }finally{child.stdin!.end();await ended;await handle.close();await dir.close();}
}
function manifest(value:unknown):NamesManifest{
 const m=strictObject(value,['schema_version','migration_id','files','retained_paths','digest']);
 if(m.schema_version!==1||typeof m.migration_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.migration_id)||
 !Array.isArray(m.files)||m.files.length>MAP.length||!Array.isArray(m.retained_paths))fail('INVALID_MANIFEST','Invalid names manifest');
 const files=m.files.map(v=>{
  const f=strictObject(v,['from','to','digest','size','mode']);
  if(!MAP.some(x=>x.from===f.from&&x.to===f.to)||typeof f.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(f.digest)||
   !Number.isSafeInteger(f.size)||Number(f.size)<0||Number(f.size)>4194304||
   !Number.isSafeInteger(f.mode)||Number(f.mode)<0||Number(f.mode)>0o777)fail('INVALID_MANIFEST','Invalid name mapping');
  return f as unknown as Item;
 });
 if(new Set(files.map(f=>f.from)).size!==files.length)fail('INVALID_MANIFEST','Duplicate name mapping');
 const retained=m.retained_paths.map(v=>{
  const r=strictObject(v,['path','state','policy']);
  if(!['.codegraph','.codify/plugins/claude-code','.codex','.claude'].includes(String(r.path))||
   !['present','absent','symbolic_link'].includes(String(r.state))||r.policy!=='PRESERVE_IN_PLACE')fail('INVALID_MANIFEST','Invalid retained path');
  return r as unknown as NamesManifest['retained_paths'][number];
 });
 if(retained.length!==4||new Set(retained.map(r=>r.path)).size!==4)fail('INVALID_MANIFEST','Incomplete retained inventory');
 const body={schema_version:1 as const,migration_id:m.migration_id,files,retained_paths:retained};
 if(m.digest!==contentDigest(canonical(body)))fail('INVALID_MANIFEST','Manifest digest mismatch');
 return {...body,digest:m.digest as string};
}
async function plan(root:FileHandle,id:unknown):Promise<NamesManifest>{
 if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))fail('INVALID_REQUEST','Expected a migration UUID');
 const files:Item[]=[];
 for(const mapping of MAP){
  const from=await readContained(root,mapping.from),to=await readContained(root,mapping.to);
  if(from&&to)fail('NAME_CONFLICT','Both legacy and canonical files exist; use the recorded migration or resolve the conflict explicitly');
  if(from)files.push({...mapping,digest:contentDigest(from.bytes),size:from.bytes.length,mode:from.mode});
 }
 const retained:NamesManifest['retained_paths']=[];
 for(const relative of ['.codegraph','.codify/plugins/claude-code','.codex','.claude']){
  let state='absent';
  const parent=path.posix.dirname(relative);
  let dir:FileHandle|undefined;
  try{dir=await openDirectory(root,parent==='.'?'':parent);const st=await fs.lstat('/proc/self/fd/'+dir.fd+'/'+path.posix.basename(relative));state=st.isSymbolicLink()?'symbolic_link':'present';}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  finally{await dir?.close();}
  retained.push({path:relative,state,policy:'PRESERVE_IN_PLACE'});
 }
 const body={schema_version:1 as const,migration_id:id,files,retained_paths:retained};
 return {...body,digest:contentDigest(canonical(body))};
}
async function apply(root:FileHandle,m:NamesManifest,signal:AbortSignal):Promise<unknown>{
 return locked(root,async()=>{
  const base='.hyperfide/migrations/'+m.migration_id,prior=await json(root,base+'/manifest.json');
  if(prior&&manifest(prior).digest!==m.digest)fail('MIGRATION_CONFLICT','Migration ID already names different inputs');
  const old=await json(root,base+'/state.json') as {state?:string}|null;
  if(old?.state==='ROLLED_BACK')fail('MIGRATION_CONFLICT','A rolled-back migration requires a new identity');
  if(!prior)await writeJSON(root,base+'/manifest.json',m);
  await writeJSON(root,base+'/state.json',{state:'APPLYING',manifest_digest:m.digest});
  for(const [index,item] of m.files.entries()){
   if(signal.aborted)fail('MIGRATION_CANCELLED','Migration interrupted; durable journal retained for retry');
   const source=await readContained(root,item.from);
   if(!source||contentDigest(source.bytes)!==item.digest||source.bytes.length!==item.size||source.mode!==item.mode)
    fail('MIGRATION_INPUT_CHANGED','Legacy input differs from the planned revision');
   const backup=base+'/backups/'+index+'.bin',saved=await readContained(root,backup);
   if(saved&&contentDigest(saved.bytes)!==item.digest)fail('MIGRATION_CONFLICT','Backup identity mismatch');
   if(!saved)await writeAtomic(root,backup,source.bytes,0o600,true);
   const destination=await readContained(root,item.to);
   if(destination&&contentDigest(destination.bytes)!==item.digest)fail('NAME_CONFLICT','Canonical file has conflicting user changes');
   if(!destination)await writeAtomic(root,item.to,source.bytes,item.mode,true);
  }
  await writeJSON(root,base+'/state.json',{state:'APPLIED',manifest_digest:m.digest});
  await writeJSON(root,'.hyperfide/names.json',{schema_version:1,migration_id:m.migration_id,manifest_digest:m.digest,state:'APPLIED',
   mappings:m.files.map(x=>({legacy:x.from,canonical:x.to,digest:x.digest})),retained_paths:m.retained_paths});
  return {state:'APPLIED',migration_id:m.migration_id,manifest_digest:m.digest,copied:m.files.length,legacy_inputs_preserved:true};
 });
}
// Rollback moves files into a durable private quarantine; it never unlinks user bytes.
// Every move is journalled before rename, so a crash or an uncooperative writer remains recoverable.
async function quarantineContained(root:FileHandle,relative:string,targetRelative:string):Promise<void>{
 const sourceParent=path.posix.dirname(relative),targetParent=path.posix.dirname(targetRelative);
 const source=await openDirectory(root,sourceParent==='.'?'':sourceParent),target=await openDirectory(root,targetParent,true);
 try{
  const destination='/proc/self/fd/'+target.fd+'/'+path.posix.basename(targetRelative);
  const reservation=await fs.open(destination,F.O_WRONLY|F.O_CREAT|F.O_EXCL|F.O_NOFOLLOW,0o600);
  await reservation.close();
  await fs.rename('/proc/self/fd/'+source.fd+'/'+path.posix.basename(relative),destination);
  const file=await fs.open(destination,F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK);
  try{await file.sync();}finally{await file.close();}
  await target.sync();await source.sync();
 }finally{await source.close();await target.close();}
}
async function rollback(root:FileHandle,m:NamesManifest):Promise<unknown>{
 return locked(root,async()=>{
  const base='.hyperfide/migrations/'+m.migration_id,recorded=await json(root,base+'/manifest.json');
  if(!recorded||manifest(recorded).digest!==m.digest)fail('MIGRATION_CONFLICT','No matching durable migration');
  const previous=await json(root,base+'/state.json') as {state?:string}|null;
  if(previous?.state==='ROLLED_BACK')return {state:'ROLLED_BACK',migration_id:m.migration_id,legacy_inputs_preserved:true,backups_retained:true,quarantine_retained:true};
  if(previous?.state==='ROLLING_BACK')fail('ROLLBACK_REQUIRES_RECOVERY','Prior rollback journal requires explicit recovery; quarantined bytes remain retained');
  for(const [index,item] of m.files.entries()){
   const source=await readContained(root,item.from),backup=await readContained(root,base+'/backups/'+index+'.bin');
   if(!source||contentDigest(source.bytes)!==item.digest||source.bytes.length!==item.size||source.mode!==item.mode||
      !backup||contentDigest(backup.bytes)!==item.digest||backup.bytes.length!==item.size)
    fail('ROLLBACK_SOURCE_UNAVAILABLE','Exact legacy inputs and durable backups are required before rollback');
   const destination=await readContained(root,item.to);
   if(destination&&(contentDigest(destination.bytes)!==item.digest||destination.bytes.length!==item.size||destination.mode!==item.mode))
    fail('NAME_CONFLICT','Rollback would remove a user-modified canonical file');
  }
  const journal:{state:string;manifest_digest:string;moves:{from:string;to:string;digest:string;state:string}[]}={state:'ROLLING_BACK',manifest_digest:m.digest,moves:[]};
  await writeJSON(root,base+'/state.json',journal);
  for(const [index,item] of m.files.entries()){
   if(!await readContained(root,item.to))continue;
   const target=base+'/rollback/'+index+'-'+createHash('sha256').update(String(process.pid)+':'+process.hrtime.bigint()).digest('hex')+'.bin';
   const move={from:item.to,to:target,digest:item.digest,state:'PLANNED'};journal.moves.push(move);await writeJSON(root,base+'/state.json',journal);
   await quarantineContained(root,item.to,target);
   const saved=await readContained(root,target);move.state='RETAINED';await writeJSON(root,base+'/state.json',journal);
   if(!saved||contentDigest(saved.bytes)!==item.digest||saved.bytes.length!==item.size||saved.mode!==item.mode)
    fail('ROLLBACK_REQUIRES_RECOVERY','Canonical file changed during rollback; moved bytes remain in the durable quarantine');
  }
  const current=await readContained(root,'.hyperfide/names.json');
  if(current){
   const descriptor=JSON.parse(current.bytes.toString('utf8')) as {migration_id?:string;manifest_digest?:string};
   if(descriptor.migration_id===m.migration_id&&descriptor.manifest_digest===m.digest){
    const target=base+'/rollback/names-'+createHash('sha256').update(String(process.hrtime.bigint())).digest('hex')+'.json';
    const move={from:'.hyperfide/names.json',to:target,digest:contentDigest(current.bytes),state:'PLANNED'};journal.moves.push(move);await writeJSON(root,base+'/state.json',journal);
    await quarantineContained(root,'.hyperfide/names.json',target);
    const saved=await readContained(root,target);move.state='RETAINED';await writeJSON(root,base+'/state.json',journal);
    if(!saved||contentDigest(saved.bytes)!==move.digest)fail('ROLLBACK_REQUIRES_RECOVERY','Portable descriptor changed; quarantined bytes remain retained');
   }
  }
  journal.state='ROLLED_BACK';await writeJSON(root,base+'/state.json',journal);
  return {state:'ROLLED_BACK',migration_id:m.migration_id,legacy_inputs_preserved:true,backups_retained:true,quarantine_retained:true};
 });
}
export function createComponent(context:ComponentContext):Component{
 const action=(fn:(root:FileHandle,input:Record<string,unknown>)=>Promise<unknown>,keys:string[])=>async(value:unknown)=>{
  const input=strictObject(value,['workspace',...keys]);const root=await openWorkspace(context,input.workspace);
  try{return await fn(root,input);}catch(e){
   if(e instanceof FoundationError)throw e;
   fail('MIGRATION_FILESYSTEM_ERROR','Contained filesystem operation failed; no secret values are included');
  }finally{await root.close();}
 };
 return {apiVersion:1,actions:{
  'migration.names.plan':action((root,input)=>plan(root,input.migration_id),['migration_id']),
  'migration.names.apply':action((root,input)=>apply(root,manifest(input.manifest),context.signal),['manifest']),
  'migration.names.rollback':action((root,input)=>rollback(root,manifest(input.manifest)),['manifest']),
  'migration.names.aliases':value=>{
   strictObject(value,[]);resolveEnvironmentAliases(context.env);
   return {aliases:ENVIRONMENT_ALIASES.map(names=>({canonical:names[0],names:[...names],present:names.filter(n=>context.env[n]!==undefined)})),values_redacted:true};
  }
 }};
}
