import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {canonicalJSON,validateProfile} from './manifests.js';
import type {PreparationManifest,FilePin} from './manifests.js';

export interface CheckpointExpected {
 checkpoint_digest:string;source_metadata_digest:string;source_repository_id:string;
 source_workspace_id:string;source_object_id:string;source_preparation_digest:string;
}
export interface RestoredCheckpointInput {
 capsule:Uint8Array;expected:CheckpointExpected;native_result:unknown;
 workspace_path:string;scratch_root:string;parent_manifest:PreparationManifest;
 repository_key:string;signal?:AbortSignal;timeout_ms?:number;
}
type Row=Record<string,any>;
interface Entry {path:string;kind:'file'|'directory'|'symlink';mode:number;size_bytes:string;digest:string|null;git_blob_id?:string;target?:string}
interface IndexEntry {path:string;mode:string;object_id:string}
const MAX=128*1024*1024,TREE=64*1024*1024,FILE=16*1024*1024,ITEMS=20000;
const DIGEST=/^sha256:[a-f0-9]{64}$/,OID=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(code='CHECKPOINT_SOURCE_INVALID'):never{throw new Error(code);}
function hash(bytes:Uint8Array|string):string{return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}
function identity(value:unknown):string{return hash(canonicalJSON(value));}
function object(v:unknown):Row{if(!v||typeof v!=='object'||Array.isArray(v)||(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null))fail();return v as Row;}
function exact(v:unknown,keys:string[]):Row{const r=object(v);if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))fail();return r;}
function utf8(bytes:Buffer):string{const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))fail('CHECKPOINT_PATH_ENCODING_UNSUPPORTED');return text;}
function relative(value:string):void{if(!value||Buffer.byteLength(value)>4096||value.includes('\0')||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git'))fail('CHECKPOINT_PATH_INVALID');}
function same(a:fs.BigIntStats,b:fs.BigIntStats):boolean{return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mode===b.mode&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.nlink===b.nlink;}
function ordered<T extends {path:string}>(items:T[]):T[]{return items.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));}
function rootOpen(name:string):number{
 if(!path.isAbsolute(name)||path.resolve(name)!==name||name==='/')fail('CHECKPOINT_ROOT_INVALID');
 let fd=fs.openSync('/',fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
 try{for(const component of name.split('/').filter(Boolean)){const next=fs.openSync('/proc/self/fd/'+fd+'/'+component,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);fs.closeSync(fd);fd=next;}return fd;}catch{fs.closeSync(fd);return fail('CHECKPOINT_ROOT_INVALID');}
}
const META=['schema_version','capture_scope','consistency','organisation_id','run_id','repository_id','task_id','attempt_id','workspace_id','base_commit','head_commit','branch_ref','preparation_digest','dependency_digest','summary_digest','findings_digest','instruction_cursor','native_support','native_session_ref','workspace_mode','index_scope','ignored_disposition','authority'];
function metadata(bytes:Buffer):Row{
 const source=utf8(bytes),seen=new Set<string>();let offset=0;
 // Native15 metadata is a flat string object. Duplicate names must not be lost in JSON.parse.
 const pattern=/"(?:[^"\\]|\\.)*"/gy;
 const ws=()=>{while(/\s/.test(source[offset]??'')&&offset<source.length)offset++;};
 const token=()=>{pattern.lastIndex=offset;const found=pattern.exec(source);if(!found)fail('CHECKPOINT_METADATA_INVALID');offset=pattern.lastIndex;return JSON.parse(found[0]) as string;};
 ws();if(source[offset++]!=='{')fail();ws();
 while(source[offset]!=='}'){const key=token();if(seen.has(key))fail('CHECKPOINT_METADATA_DUPLICATE');seen.add(key);ws();if(source[offset++]!==':')fail();ws();token();ws();if(source[offset]===','){offset++;ws();continue;}if(source[offset]!=='}')fail();}
 offset++;ws();if(offset!==source.length)fail();
 const m=exact(JSON.parse(source),META);
 if(m.schema_version!=='1'||m.capture_scope!=='GIT_AND_NONIGNORED_WORKTREE'||m.consistency!=='STABLE_SCAN_REQUIRES_SUPERVISOR_QUIESCENCE'||m.index_scope!=='STAGED_TREE_NOT_LOCAL_INDEX_FLAGS'||m.ignored_disposition!=='EXCLUDED_NOT_RECOVERED'||m.authority!=='NONE')fail('CHECKPOINT_METADATA_INVALID');
 for(const key of ['organisation_id','run_id','repository_id','task_id','attempt_id','workspace_id'])if(!UUID.test(m[key]))fail();
 for(const key of ['preparation_digest','dependency_digest','summary_digest','findings_digest'])if(!DIGEST.test(m[key]))fail();
 if(!OID.test(m.base_commit)||!OID.test(m.head_commit)||!m.branch_ref.startsWith('refs/heads/')||!/^(0|[1-9][0-9]*)$/.test(m.workspace_mode)||BigInt(m.workspace_mode)>511n||!/^(0|[1-9][0-9]*)$/.test(m.instruction_cursor))fail();
 if(m.native_support==='RECORDED'?!UUID.test(m.native_session_ref):m.native_support!=='UNSUPPORTED'||m.native_session_ref!=='')fail();
 return m;
}
function unpack(capsule:Buffer):{metadata:Buffer;bundle:Buffer;patch:Buffer;tree:Buffer}{
 if(capsule.length<40||capsule.length>MAX||capsule.subarray(0,8).toString('ascii')!=='HFCP0001')fail('CHECKPOINT_CAPSULE_INVALID');
 const sections:Buffer[]=[];let offset=40;
 for(let i=0;i<4;i++){const size=capsule.readBigUInt64BE(8+i*8);if(size>BigInt(MAX-offset)||offset+Number(size)>capsule.length)fail('CHECKPOINT_CAPSULE_INVALID');sections.push(capsule.subarray(offset,offset+Number(size)));offset+=Number(size);}
 if(offset!==capsule.length||sections[0]!.length>65536||sections[3]!.length>TREE)fail('CHECKPOINT_CAPSULE_INVALID');
 return {metadata:sections[0]!,bundle:sections[1]!,patch:sections[2]!,tree:sections[3]!};
}
function parseTree(bytes:Buffer,algorithm:string):Entry[]{
 const result:Entry[]=[],seen=new Map<string,string>();let offset=0;
 while(offset<bytes.length){
  if(bytes.length-offset<17||result.length>=ITEMS)fail('CHECKPOINT_TREE_INVALID');
  const pn=bytes.readUInt32BE(offset),length=bytes.readBigUInt64BE(offset+4),mode=bytes.readUInt32BE(offset+12),kind=bytes[offset+16];offset+=17;
  if(!pn||pn>4096||length>BigInt(FILE)||pn+Number(length)>bytes.length-offset||mode>511)fail('CHECKPOINT_TREE_INVALID');
  const name=utf8(bytes.subarray(offset,offset+pn));relative(name);if(seen.has(name))fail('CHECKPOINT_TREE_DUPLICATE');
  const parent=name.includes('/')?name.slice(0,name.lastIndexOf('/')):null;if(parent&&seen.get(parent)!=='directory')fail('CHECKPOINT_TREE_ORDER');
  const data=bytes.subarray(offset+pn,offset+pn+Number(length));offset+=pn+Number(length);
  const blob=()=>createHash(algorithm).update('blob '+data.length+'\0').update(data).digest('hex');
  if(kind===1){seen.set(name,'file');result.push({path:name,kind:'file',mode,size_bytes:String(data.length),digest:hash(data),git_blob_id:blob()});}
  else if(kind===2&&length===0n){seen.set(name,'directory');result.push({path:name,kind:'directory',mode,size_bytes:'0',digest:null});}
  else if(kind===3&&data.length&&mode===511){const target=utf8(data);relative(target);seen.set(name,'symlink');result.push({path:name,kind:'symlink',mode,size_bytes:String(data.length),digest:hash(data),git_blob_id:blob(),target});}
  else fail('CHECKPOINT_TREE_INVALID');
 }
 return ordered(result);
}
async function git(root:string,args:string[],deadline:number,signal?:AbortSignal,extra:NodeJS.ProcessEnv={},input?:Uint8Array):Promise<Buffer>{
 const remaining=Math.floor(deadline-performance.now());if(remaining<=0||signal?.aborted)fail('CHECKPOINT_VALIDATION_TIMEOUT');
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.attributesFile=/dev/null','-c','maintenance.auto=false','-c','gc.auto=0','-c','protocol.allow=never',...args],{cwd:root,env:{PATH:'/usr/bin:/bin',LANG:'C',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',...extra},stdio:['pipe','pipe','pipe']});
  let total=0,invalid=false;const chunks:Buffer[]=[];
  const stop=()=>{invalid=true;child.kill('SIGKILL');};const timer=setTimeout(stop,remaining);signal?.addEventListener('abort',stop,{once:true});
  child.stdout.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>MAX)stop();else chunks.push(chunk);});child.stderr.resume();child.on('error',()=>{invalid=true;});
  child.stdin.on('error',()=>{});child.stdin.end(input?Buffer.from(input):undefined);
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(invalid||code!==0)reject(new Error(invalid?'CHECKPOINT_VALIDATION_TIMEOUT':'CHECKPOINT_GIT_INVALID'));else resolve(Buffer.concat(chunks));});
 });
}
function indexEntries(bytes:Buffer,head=false):IndexEntry[]{
 const result:IndexEntry[]=[],names=new Set<string>();
 for(const record of bytes.toString('utf8').split('\0').filter(Boolean)){
  const match=(head?/^([0-9]{6}) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/:/^([0-9]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t([\s\S]+)$/).exec(record);
  if(!match||!['100644','100755','120000'].includes(match[1]!))fail('CHECKPOINT_INDEX_UNSUPPORTED');
  const name=match[3]!;relative(name);if(names.has(name)||result.length>=ITEMS)fail('CHECKPOINT_INDEX_INVALID');names.add(name);result.push({path:name,mode:match[1]!,object_id:match[2]!});
 }
 if(!Buffer.from(bytes.toString('utf8')).equals(bytes))fail('CHECKPOINT_PATH_ENCODING_UNSUPPORTED');
 return ordered(result);
}
async function inventory(rootFd:number,algorithm:string,deadline:number,signal?:AbortSignal):Promise<Entry[]>{
 const result:Entry[]=[],held:number[]=[];const closure:{fd:number;before:fs.BigIntStats;names:string[]}[]=[];
 const walk=async(fd:number,prefix:string,depth:number):Promise<void>=>{
  if(depth>128||performance.now()>=deadline||signal?.aborted)fail('CHECKPOINT_VALIDATION_TIMEOUT');
  const before=fs.fstatSync(fd,{bigint:true}),names=fs.readdirSync('/proc/self/fd/'+fd).sort();
  closure.push({fd,before,names});
  for(const name of names){
   if(!prefix&&name==='.git')continue;
   const relativeName=prefix?prefix+'/'+name:name;relative(relativeName);if(result.length>=ITEMS)fail('CHECKPOINT_INVENTORY_LIMIT');
   const filename='/proc/self/fd/'+fd+'/'+name,before=fs.lstatSync(filename,{bigint:true}),mode=Number(before.mode&511n);
   if((before.mode&3584n)!==0n)fail('CHECKPOINT_ENTRY_UNSUPPORTED');
   if(before.isDirectory()){
    const child=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);held.push(child);if(!same(before,fs.fstatSync(child,{bigint:true})))fail('CHECKPOINT_SOURCE_UNSTABLE');
    result.push({path:relativeName,kind:'directory',mode,size_bytes:'0',digest:null});await walk(child,relativeName,depth+1);
   }else if(before.isSymbolicLink()){
    const data=fs.readlinkSync(filename,{encoding:'buffer'}),target=utf8(data);relative(target);
    if(before.nlink!==1n||!same(before,fs.lstatSync(filename,{bigint:true})))fail('CHECKPOINT_SOURCE_UNSTABLE');
    result.push({path:relativeName,kind:'symlink',mode,size_bytes:String(data.length),digest:hash(data),git_blob_id:createHash(algorithm).update('blob '+data.length+'\0').update(data).digest('hex'),target});
   }else if(before.isFile()&&before.nlink===1n&&before.size<=BigInt(FILE)){
    const file=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{
     if(!same(before,fs.fstatSync(file,{bigint:true})))fail('CHECKPOINT_SOURCE_UNSTABLE');
     const content=createHash('sha256'),blob=createHash(algorithm).update('blob '+before.size+'\0'),chunk=Buffer.alloc(65536);let count=0,n=0;
     while((n=fs.readSync(file,chunk,0,chunk.length,null))){count+=n;if(count>FILE)fail('CHECKPOINT_INVENTORY_LIMIT');content.update(chunk.subarray(0,n));blob.update(chunk.subarray(0,n));if(performance.now()>=deadline||signal?.aborted)fail('CHECKPOINT_VALIDATION_TIMEOUT');}
     if(BigInt(count)!==before.size||!same(before,fs.fstatSync(file,{bigint:true})))fail('CHECKPOINT_SOURCE_UNSTABLE');
     result.push({path:relativeName,kind:'file',mode,size_bytes:String(count),digest:'sha256:'+content.digest('hex'),git_blob_id:blob.digest('hex')});
    }finally{fs.closeSync(file);}
   }else fail('CHECKPOINT_ENTRY_UNSUPPORTED');
   if(result.length%64===0)await new Promise<void>(resolve=>setImmediate(resolve));
  }
 };
 try{await walk(rootFd,'',0);for(const item of closure)if(!same(item.before,fs.fstatSync(item.fd,{bigint:true}))||canonicalJSON(item.names)!==canonicalJSON(fs.readdirSync('/proc/self/fd/'+item.fd).sort()))fail('CHECKPOINT_SOURCE_UNSTABLE');return ordered(result);}
 finally{for(const fd of held.reverse())fs.closeSync(fd);}
}
function roles(manifest:PreparationManifest,key:string,entries:Entry[]):Row{
 const profile=validateProfile(manifest.profile),map=new Map(entries.map(e=>[e.path,e]));
 const measured=new Map<string,FilePin>();
 const observe=(pin:FilePin):Row=>{
  if(!pin.path.startsWith(key+'/'))return {...pin,digest:null,actual_size_bytes:null,state:'OUTSIDE_RESTORED_REPOSITORY',expected_digest:pin.digest};
  const name=pin.path.slice(key.length+1),actual=map.get(name);relative(name);
  if(!actual)return {path:pin.path,digest:null,actual_size_bytes:null,state:'REMOVED',expected_digest:pin.digest};
  if(actual.kind!=='file')fail('CHECKPOINT_ROLE_FILE_REQUIRED');
  measured.set(pin.path,{path:pin.path,digest:actual.digest!});
  return {path:pin.path,digest:actual.digest,actual_size_bytes:actual.size_bytes,state:actual.digest===pin.digest?'UNCHANGED':'CHANGED',expected_digest:pin.digest};
 };
 return {role_inputs:{locks:profile.package_managers.map(manager=>({name:manager.name,files:manager.locks.map(observe)})),build_config:profile.build_config.map(observe),generated_inputs:profile.generated_inputs.map(observe),recipe:observe(profile.recipe),preparation_evidence:profile.preparation_evidence.map(observe)},measured_file_pins:[...measured.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
}
/** Byte validation only. A stable local scan cannot prove external writer
 * quiescence or grant preparation/readiness.12 must seal these bytes separately. */
export async function validateRestoredCheckpoint(input:RestoredCheckpointInput):Promise<Row>{
 const limit=input.timeout_ms??30000;if(!Number.isSafeInteger(limit)||limit<100||limit>120000)fail();
 if(!(input.capsule instanceof Uint8Array)||input.capsule.byteLength>MAX)fail('CHECKPOINT_CAPSULE_INVALID');
 const deadline=performance.now()+limit,capsule=Buffer.from(input.capsule),expected=exact(input.expected,['checkpoint_digest','source_metadata_digest','source_repository_id','source_workspace_id','source_object_id','source_preparation_digest']);
 for(const key of ['checkpoint_digest','source_metadata_digest','source_preparation_digest'])if(!DIGEST.test(expected[key]))fail();
 if(!UUID.test(expected.source_repository_id)||!UUID.test(expected.source_workspace_id)||!OID.test(expected.source_object_id)||hash(capsule)!==expected.checkpoint_digest)fail('CHECKPOINT_CUSTODY_MISMATCH');
 const parts=unpack(capsule),meta=metadata(parts.metadata);
 if(hash(parts.metadata)!==expected.source_metadata_digest||meta.repository_id!==expected.source_repository_id||meta.workspace_id!==expected.source_workspace_id||meta.head_commit!==expected.source_object_id||meta.preparation_digest!==expected.source_preparation_digest)fail('CHECKPOINT_CUSTODY_MISMATCH');
 const native=exact(input.native_result,['capture_state','native_context','authority','checkpoint_digest','repository_id']);
 if(native.capture_state!=='LOCAL_RESTORED'||native.native_context!=='NOT_RESTORED'||native.authority!=='NONE'||native.checkpoint_digest!==expected.checkpoint_digest||native.repository_id!==expected.source_repository_id)fail('CHECKPOINT_NATIVE_RESULT_INVALID');
 const manifest=input.parent_manifest as PreparationManifest,{digest:manifestDigest,...manifestBody}=object(manifest);
 if(!DIGEST.test(manifestDigest)||identity(manifestBody)!==manifestDigest)fail('CHECKPOINT_PARENT_MANIFEST_INVALID');
 const profile=validateProfile(manifest.profile);if(!profile.repositories.some(repository=>repository.id===input.repository_key))fail('CHECKPOINT_REPOSITORY_BINDING_INVALID');
 const rootFd=rootOpen(input.workspace_path);let scratchFd:number|undefined,temporary:string|undefined;
 try{
  scratchFd=rootOpen(input.scratch_root);
  if((fs.fstatSync(scratchFd).mode&511)!==448||input.scratch_root===input.workspace_path||input.scratch_root.startsWith(input.workspace_path+'/'))fail('CHECKPOINT_SCRATCH_INVALID');
  if(Number(fs.fstatSync(rootFd,{bigint:true}).mode&511n)!==Number(meta.workspace_mode))fail('CHECKPOINT_MODE_MISMATCH');
  const gitDir=fs.openSync('/proc/self/fd/'+rootFd+'/.git',fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);fs.closeSync(gitDir);
  const head=(await git(input.workspace_path,['rev-parse','--verify','HEAD'],deadline,input.signal)).toString('utf8').trim();
  if(head!==meta.head_commit)fail('CHECKPOINT_HEAD_MISMATCH');
  const branch=(await git(input.workspace_path,['symbolic-ref','HEAD'],deadline,input.signal)).toString('utf8').trim();if(branch!==meta.branch_ref)fail('CHECKPOINT_BRANCH_MISMATCH');
  await git(input.workspace_path,['merge-base','--is-ancestor',meta.base_commit,'HEAD'],deadline,input.signal);
  await git(input.workspace_path,['fsck','--full','--strict','--no-reflogs'],deadline,input.signal);
  const algorithm=(await git(input.workspace_path,['rev-parse','--show-object-format'],deadline,input.signal)).toString('utf8').trim();if(!['sha1','sha256'].includes(algorithm))fail();
  const declared=parseTree(parts.tree,algorithm),actual=await inventory(rootFd,algorithm,deadline,input.signal);
  if(canonicalJSON(actual)!==canonicalJSON(declared))fail('CHECKPOINT_WORKTREE_MISMATCH');
  temporary=fs.mkdtempSync(path.join(input.scratch_root,'checkpoint-validation-'));fs.chmodSync(temporary,448);fs.mkdirSync(path.join(temporary,'objects'),{mode:448});
  const bundlePath=path.join(temporary,'source.bundle');fs.writeFileSync(bundlePath,parts.bundle,{mode:384,flag:'wx'});
  await git(input.workspace_path,['bundle','verify',bundlePath],deadline,input.signal);
  const bundleHeads=(await git(input.workspace_path,['bundle','list-heads',bundlePath],deadline,input.signal)).toString('utf8').trim().split('\n');
  if(!bundleHeads.some(line=>line===head+' HEAD'))fail('CHECKPOINT_BUNDLE_HEAD_MISMATCH');
  const gitPath=path.join(input.workspace_path,'.git'),alternate=path.join(gitPath,'objects'),env={GIT_INDEX_FILE:path.join(temporary,'expected-index'),GIT_OBJECT_DIRECTORY:path.join(temporary,'objects'),GIT_ALTERNATE_OBJECT_DIRECTORIES:alternate};
  await git(input.workspace_path,['read-tree','HEAD'],deadline,input.signal,env);
  if(parts.patch.length)await git(input.workspace_path,['apply','--cached','--binary','--whitespace=nowarn','-'],deadline,input.signal,env,parts.patch);
  const wanted=indexEntries(await git(input.workspace_path,['ls-files','--stage','-z'],deadline,input.signal,env));
  const actualIndex=indexEntries(await git(input.workspace_path,['ls-files','--stage','-z'],deadline,input.signal));
  if(canonicalJSON(wanted)!==canonicalJSON(actualIndex))fail('CHECKPOINT_INDEX_MISMATCH');
  const indexTree=(await git(input.workspace_path,['write-tree'],deadline,input.signal,env)).toString('utf8').trim(),headTree=(await git(input.workspace_path,['rev-parse','HEAD^{tree}'],deadline,input.signal)).toString('utf8').trim();
  const headEntries=indexEntries(await git(input.workspace_path,['ls-tree','-r','-z','HEAD'],deadline,input.signal),true),base=new Map(headEntries.map(e=>[e.path,e])),indexed=new Map(actualIndex.map(e=>[e.path,e])),work=new Map(actual.map(e=>[e.path,e]));
  const staged=[...new Set([...base.keys(),...indexed.keys()])].filter(name=>canonicalJSON(base.get(name)??null)!==canonicalJSON(indexed.get(name)??null)).sort();
  const unstaged=actualIndex.filter(entry=>{const file=work.get(entry.path);return !file||file.git_blob_id!==entry.object_id||(file.kind==='symlink'?'120000':file.kind==='file'?(file.mode&64?'100755':'100644'):'directory')!==entry.mode;}).map(e=>e.path);
  const untracked=actual.filter(e=>e.kind!=='directory'&&!indexed.has(e.path)).map(e=>e.path);
  const again=await inventory(rootFd,algorithm,deadline,input.signal);
  if(canonicalJSON(again)!==canonicalJSON(actual)||(await git(input.workspace_path,['rev-parse','HEAD'],deadline,input.signal)).toString('utf8').trim()!==head||canonicalJSON(indexEntries(await git(input.workspace_path,['ls-files','--stage','-z'],deadline,input.signal)))!==canonicalJSON(actualIndex))fail('CHECKPOINT_SOURCE_UNSTABLE');
  const overlay={head_commit:head,head_tree_id:headTree,index_tree_id:indexTree,index_entries:actualIndex,worktree:actual};
  return {schema_version:1,status:'RESTORED_SOURCE_ONLY',authority:'NONE',readiness_granted:false,installed_toolchain_verified:false,quiescence_verified:false,native_context_restored:false,checkpoint_digest:expected.checkpoint_digest,source_metadata_digest:expected.source_metadata_digest,metadata:meta,head_commit:head,head_tree_id:headTree,index_tree_id:indexTree,git_bundle_digest:hash(parts.bundle),index_patch_digest:hash(parts.patch),index_entries_digest:identity(actualIndex),worktree_inventory_digest:identity(actual),overlay_digest:identity(overlay),source_state_digest:identity({checkpoint_digest:expected.checkpoint_digest,source_metadata_digest:expected.source_metadata_digest,overlay}),staged_paths:staged,unstaged_paths:unstaged,untracked_paths:untracked,inventory:actual,...roles(manifest,input.repository_key,actual),consistency:'LOCAL_SCAN_REQUIRES_GENUINE_12_QUIESCENCE_AND_SEAL',index_scope:meta.index_scope,ignored_disposition:meta.ignored_disposition};
 }finally{if(temporary)fs.rmSync(temporary,{recursive:true,force:true});if(scratchFd!==undefined)fs.closeSync(scratchFd);fs.closeSync(rootFd);}
}
