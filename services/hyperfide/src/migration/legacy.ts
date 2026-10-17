import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
function hash(value:string|Buffer):string{return 'sha256:'+createHash('sha256').update(value).digest('hex');}

export interface LegacyWriterInput {deployment_id:string;operation_id:string;source_epoch:string|null;signal?:AbortSignal}
export interface LegacyAdmissionReceipt {deployment_id:string;operation_id:string;source_epoch:string|null;status:'ADMISSION_DISABLED';topology_digest:string;observed_at:string;evidence_digest:string;visibility:{scope:'CONFIGURED_PID_NAMESPACE';pid_namespace:string;mount_namespace:string}}
export interface LegacyIsolationReceipt {deployment_id:string;operation_id:string;source_epoch:string|null;status:'ISOLATED';topology_digest:string;isolated_writer:string;observed_at:string;expires_at:string;evidence_digest:string;visibility:{scope:'CONFIGURED_PID_NAMESPACE';pid_namespace:string;mount_namespace:string;checked_processes:number;checked_mount_namespaces:number};admission_disabled:true;writable_fds:0;writable_shared_mappings:0;read_only_aliases:number}
export interface LegacyRestoreReceipt {deployment_id:string;operation_id:string;source_epoch:string|null;status:'ADMISSION_RESTORED';topology_digest:string;restored_descriptor_digest:string;observed_at:string;evidence_digest:string}
export interface LegacyWriterCapability {disableAdmission(input:LegacyWriterInput):Promise<LegacyAdmissionReceipt>;observeIsolation(input:LegacyWriterInput):Promise<LegacyIsolationReceipt>;restoreAdmission(input:LegacyWriterInput):Promise<LegacyRestoreReceipt>}
interface Config {schema_version:1;deployment_id:string;source_epoch:string|null;workspace_root:string;data_roots:string[];legacy_writer_id:string;expected_pid_namespace:string;expected_mount_namespace:string}
interface Mount {id:string;device:string;root:string;point:string;readonly:boolean;filesystem:string}
interface Target {device:string;root:string;directory:string}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function alive(input:LegacyWriterInput):void{if(input.signal?.aborted)fail('LEGACY_FENCE_ABORTED','Legacy writer observation was cancelled');}
function inside(root:string,name:string):boolean{return name===root||name.startsWith(root.endsWith('/')?root:root+'/');}
function decode(s:string):string{return s.replace(/\\([0-7]{3})/g,(_m,n:string)=>String.fromCharCode(parseInt(n,8)));}
function mounts(text:string):Mount[]{
 return text.trim().split('\n').filter(Boolean).map(line=>{
 const sides=line.split(' - '),a=sides[0]?.split(' '),b=sides[1]?.split(' ');
 if(!a||a.length<6||!b||b.length<3)fail('LEGACY_VISIBILITY_UNAVAILABLE','Malformed kernel mount observation');
 return {id:a[0]!,device:a[2]!,root:decode(a[3]!),point:decode(a[4]!),filesystem:b[0]!,readonly:a[5]!.split(',').includes('ro')||b[2]!.split(',').includes('ro')};
 });
}
function covering(all:Mount[],name:string):Mount{
 const value=all.filter(m=>inside(m.point,name)).sort((a,b)=>b.point.length-a.point.length)[0];
 if(!value)fail('LEGACY_VISIBILITY_UNAVAILABLE','Legacy path has no observable mount');return value;
}
function device(value:bigint):string{
 const major=((value>>8n)&0xfffn)|((value>>32n)&0xfffff000n),minor=(value&0xffn)|((value>>12n)&0xffffff00n);
 return major.toString()+':'+minor.toString();
}
async function exactDirectory(name:string):Promise<void>{
 if(!path.isAbsolute(name)||path.resolve(name)!==name||await fs.realpath(name)!==name)fail('LEGACY_CONFIG_INVALID','Legacy scope must use canonical non-symlink directories');
 const st=await fs.lstat(name);if(!st.isDirectory()||st.isSymbolicLink())fail('LEGACY_CONFIG_INVALID','Legacy scope is not a real directory');
}
async function configuration(env:Readonly<NodeJS.ProcessEnv>,input:LegacyWriterInput):Promise<{config:Config;topology:string;roots:string[]}>{
 alive(input);
 if(!object(input)||Object.keys(input).some(k=>!['deployment_id','operation_id','source_epoch','signal'].includes(k))||![input.deployment_id,input.operation_id].every(v=>typeof v==='string'&&uuid.test(v))||!(input.source_epoch===null||typeof input.source_epoch==='string'&&uuid.test(input.source_epoch)))fail('LEGACY_FENCE_INPUT','Bound deployment, operation and source epoch required');
 const filename=env.HF_LEGACY_WRITER_CONFIG_FILE;
 if(!filename||!path.isAbsolute(filename)||await fs.realpath(filename)!==filename)fail('LEGACY_CONFIG_REQUIRED','Trusted legacy writer topology is required');
 const stat=await fs.lstat(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())fail('LEGACY_CONFIG_INVALID','Legacy topology must be an owner-private regular file');
 const value:unknown=JSON.parse(await fs.readFile(filename,'utf8')),keys=['schema_version','deployment_id','source_epoch','workspace_root','data_roots','legacy_writer_id','expected_pid_namespace','expected_mount_namespace'];
 if(!object(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!(k in value))||value.schema_version!==1||value.deployment_id!==input.deployment_id||value.source_epoch!==input.source_epoch||typeof value.workspace_root!=='string'||typeof value.legacy_writer_id!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.legacy_writer_id)||typeof value.expected_pid_namespace!=='string'||!/^pid:\[[0-9]+\]$/.test(value.expected_pid_namespace)||typeof value.expected_mount_namespace!=='string'||!/^mnt:\[[0-9]+\]$/.test(value.expected_mount_namespace)||!Array.isArray(value.data_roots)||value.data_roots.length<1||value.data_roots.length>32)fail('LEGACY_CONFIG_INVALID','Legacy topology does not match the pinned deployment and epoch');
 const config=value as unknown as Config;await exactDirectory(config.workspace_root);
 const roots:string[]=[];
 for(const relative of config.data_roots){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(x=>!x||x==='.'||x==='..'))fail('LEGACY_CONFIG_INVALID','Unsafe legacy data scope');
 const root=path.join(config.workspace_root,relative);await exactDirectory(root);roots.push(root);
 }
 if(new Set(roots).size!==roots.length)fail('LEGACY_CONFIG_INVALID','Duplicate legacy data roots');
 return {config,roots,topology:hash(canonical(config))};
}
async function namespaces(config:Config):Promise<{scope:'CONFIGURED_PID_NAMESPACE';pid_namespace:string;mount_namespace:string}>{
 const pid=await fs.readlink('/proc/self/ns/pid'),mount=await fs.readlink('/proc/self/ns/mnt');
 if(pid!==config.expected_pid_namespace||mount!==config.expected_mount_namespace)fail('LEGACY_NAMESPACE_MISMATCH','Observer is outside the configured process or mount namespace');
 return {scope:'CONFIGURED_PID_NAMESPACE',pid_namespace:pid,mount_namespace:mount};
}
// A null predecessor has no authority epoch. The operation UUID is only an
// admission-quarantine marker; receipts preserve null and never grant authority.
function descriptor(config:Config,input:LegacyWriterInput):string{return canonical({schema_version:1,mode:'distributed',authority_epoch:config.source_epoch??input.operation_id})+'\n';}
async function admission(config:Config,input:LegacyWriterInput):Promise<string>{
 const directory=path.join(config.workspace_root,'.hyperfide');await exactDirectory(directory);
 const ds=await fs.lstat(directory);if(ds.uid!==process.getuid?.()||(ds.mode&0o077)!==0)fail('LEGACY_ADMISSION_INVALID','Admission directory must be owner-private');
 const filename=path.join(directory,'authority.json'),st=await fs.lstat(filename);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>4096||await fs.readFile(filename,'utf8')!==descriptor(config,input))fail('LEGACY_ADMISSION_INVALID','Current distributed admission descriptor does not match source epoch');
 return hash(await fs.readFile(filename));
}
function aliases(all:Mount[],targets:Target[]):string[]{
 const result=new Set<string>();
 for(const t of targets)for(const m of all){
 if(m.device!==t.device)continue;
 if(inside(m.root,t.root))result.add(path.posix.join(m.point,path.posix.relative(m.root,t.root)));
 else if(inside(t.root,m.root))result.add(m.point);
 }
 return [...result];
}
async function identities(roots:string[]):Promise<Set<string>>{
 const found=new Set<string>();let count=0;
 async function walk(name:string):Promise<void>{
 if(++count>100000)fail('LEGACY_SCOPE_BOUND','Legacy scope exceeds bounded inode inventory');
 const st=await fs.lstat(name,{bigint:true});
 if(st.isSymbolicLink())fail('LEGACY_CONFIG_INVALID','Legacy data scope contains a symlink');
 if(st.isDirectory()){found.add(device(st.dev)+':'+st.ino.toString());for(const child of await fs.readdir(name))await walk(path.join(name,child));}
 else if(st.isFile()){if(st.nlink!==1n)fail('LEGACY_LINK_ALIAS','Multiply linked legacy files require independently established whole-device isolation');found.add(device(st.dev)+':'+st.ino.toString());}
 else fail('LEGACY_CONFIG_INVALID','Legacy data scope contains a special file');
 }
 for(const root of roots)await walk(root);return found;
}
async function pids():Promise<string[]>{
 const value=(await fs.readdir('/proc')).filter(n=>/^[1-9][0-9]*$/.test(n)).sort();
 if(value.length>32768)fail('LEGACY_SCOPE_BOUND','Process observation exceeds bounded scope');return value;
}
async function gone(pid:string):Promise<boolean>{try{await fs.stat('/proc/'+pid);return false;}catch(e){if(object(e)&&e.code==='ENOENT')return true;throw e;}}
/** This is a configured-namespace observation, never a claim about invisible
 * hosts/containers. The recovery controller must match topology and provider
 * isolation coverage before constructing a deployment-wide 4.4 fence receipt. */
export class LegacyWriterAdmission {
 constructor(private readonly env:Readonly<NodeJS.ProcessEnv>){}
 async disableAdmission(input:LegacyWriterInput):Promise<LegacyAdmissionReceipt>{
 const {config,topology}=await configuration(this.env,input),visibility=await namespaces(config),directory=path.join(config.workspace_root,'.hyperfide');
 try{await fs.mkdir(directory,{mode:0o700});}catch(e){if(!object(e)||e.code!=='EEXIST')throw e;}
 await exactDirectory(directory);
 const directoryInfo=await fs.lstat(directory);if(directoryInfo.uid!==process.getuid?.()||(directoryInfo.mode&0o077)!==0)fail('LEGACY_ADMISSION_INVALID','Admission directory must be owner-private');
 const marker=path.join(directory,'authority.json');
 try{await fs.lstat(marker);await admission(config,input);}
 catch(error){
 if(!object(error)||error.code!=='ENOENT')throw error;
 const temporary=path.join(directory,'.admission-'+randomUUID()),handle=await fs.open(temporary,'wx',0o600);
 try{await handle.writeFile(descriptor(config,input));await handle.sync();}finally{await handle.close();}
 try{await fs.link(temporary,marker);}catch(e){if(!object(e)||e.code!=='EEXIST')throw e;}finally{await fs.rm(temporary,{force:true});}
 const dir=await fs.open(directory,'r');try{await dir.sync();}finally{await dir.close();}
 }
 const workspace=await fs.open(config.workspace_root,'r');try{await workspace.sync();}finally{await workspace.close();}
 const admission_digest=await admission(config,input),observed_at=new Date().toISOString();
 return {...this.binding(input),status:'ADMISSION_DISABLED',topology_digest:topology,observed_at,evidence_digest:hash(canonical({topology,admission_digest,visibility,observed_at})),visibility};
 }
 /** Rollback before any new authoritative PostgreSQL write is the only caller. The exact
 * descriptor bound to this deployment/epoch is removed atomically; an unrelated or changed
 * descriptor is refused, and an already-absent descriptor is an idempotent replay. */
 async restoreAdmission(input:LegacyWriterInput):Promise<LegacyRestoreReceipt>{
 const {config,topology}=await configuration(this.env,input),visibility=await namespaces(config),directory=path.join(config.workspace_root,'.hyperfide');
 await exactDirectory(directory);
 const marker=path.join(directory,'authority.json');let restored:string;
 try{restored=await admission(config,input);}
 catch(error){if(!object(error)||error.code!=='ENOENT')throw error;restored=hash(descriptor(config,input));}
 alive(input);
 try{const quarantine=path.join(directory,'.restored-'+randomUUID());await fs.rename(marker,quarantine);
 if(hash(await fs.readFile(quarantine))!==restored){await fs.rename(quarantine,marker);fail('LEGACY_ADMISSION_INVALID','Admission descriptor changed during restoration');}
 await fs.rm(quarantine);}
 catch(error){if(!object(error)||error.code!=='ENOENT')throw error;}
 const dir=await fs.open(directory,'r');try{await dir.sync();}finally{await dir.close();}
 const observed_at=new Date().toISOString();
 return {...this.binding(input),status:'ADMISSION_RESTORED',topology_digest:topology,restored_descriptor_digest:restored,observed_at,evidence_digest:hash(canonical({topology,restored,visibility,observed_at}))};
 }
 private binding(input:LegacyWriterInput){return {deployment_id:input.deployment_id,operation_id:input.operation_id,source_epoch:input.source_epoch};}
 async observeIsolation(input:LegacyWriterInput):Promise<LegacyIsolationReceipt>{
 const {config,roots,topology}=await configuration(this.env,input),visibility=await namespaces(config),admission_digest=await admission(config,input);
 const inodes=await identities(roots),selfText=await fs.readFile('/proc/self/mountinfo','utf8'),selfMounts=mounts(selfText),targets:Target[]=roots.map(directory=>{
 const m=covering(selfMounts,directory);if(!['ext4','xfs','tmpfs'].includes(m.filesystem))fail('LEGACY_FILESYSTEM_UNSUPPORTED','Legacy isolation requires a qualified local filesystem; overlay or remote backing cannot be inferred safe');return {device:m.device,root:path.posix.join(m.root,path.posix.relative(m.point,directory)),directory};
 });
 const before=await pids(),seen=new Set<string>(),observations:string[]=[];let read_only_aliases=0,unsafeMount=false,checked_processes=0;
 for(const pid of before){
 alive(input);
 try{
 const start=await fs.readFile('/proc/'+pid+'/stat','utf8'),ns=await fs.readlink('/proc/'+pid+'/ns/mnt'),text=await fs.readFile('/proc/'+pid+'/mountinfo','utf8'),all=mounts(text),paths=aliases(all,targets);
 if(!seen.has(ns)){
 seen.add(ns);observations.push(hash(text));
 for(const alias of paths){
 const covered=covering(all,alias);
 if(!covered.readonly||all.some(m=>inside(alias,m.point)&&!m.readonly))unsafeMount=true;else read_only_aliases++;
 }
 }
 for(const fd of await fs.readdir('/proc/'+pid+'/fd')){
 try{
 const info=await fs.readFile('/proc/'+pid+'/fdinfo/'+fd,'utf8'),flags=/^flags:\s+([0-7]+)$/m.exec(info);
 if(!flags)fail('LEGACY_VISIBILITY_UNAVAILABLE','Kernel descriptor flags unavailable');
 const st=await fs.stat('/proc/'+pid+'/fd/'+fd,{bigint:true}),target=(await fs.readlink('/proc/'+pid+'/fd/'+fd)).replace(/ \(deleted\)$/,'');
 const relevant=inodes.has(device(st.dev)+':'+st.ino.toString())||paths.some(root=>inside(root,target));
 if(!relevant)continue;
 const mountId=/^mnt_id:\s+([0-9]+)$/m.exec(info)?.[1],fdMount=all.find(m=>m.id===mountId);
 if(st.isDirectory()&&(!fdMount||!fdMount.readonly))fail('LEGACY_WRITER_ACTIVE','Legacy directory handle can reconnect through a writable or detached mount');
 if(st.isFile()&&(BigInt('0o'+flags[1])&3n)!==0n)fail('LEGACY_WRITER_ACTIVE','Writable legacy storage descriptor remains open');
 }catch(error){if(object(error)&&error.code==='ENOENT')continue;throw error;}
 }
 const maps=await fs.readFile('/proc/'+pid+'/maps','utf8');
 for(const line of maps.split('\n')){
 const fields=line.trim().split(/\s+/);if(fields.length<5||fields[1]?.[1]!=='w'||fields[1]?.[3]!=='s')continue;
 const parts=fields[3]!.split(':'),key=BigInt('0x'+parts[0]).toString()+':'+BigInt('0x'+parts[1]).toString()+':'+fields[4],name=fields.slice(5).join(' ').replace(/ \(deleted\)$/,'');
 if(inodes.has(key)||paths.some(root=>inside(root,name)))fail('LEGACY_WRITER_ACTIVE','Writable shared legacy storage mapping remains active');
 }
 const end=await fs.readFile('/proc/'+pid+'/stat','utf8');
 const identity=(v:string)=>v.slice(v.lastIndexOf(')')+2).split(' ')[19];
 if(identity(start)!==identity(end))fail('LEGACY_OBSERVATION_CHANGED','Process identity changed during writer observation');
 observations.push(hash(pid+':'+identity(start)+':'+ns));checked_processes++;
 }catch(error){
 if(await gone(pid))continue;
 if(error instanceof FoundationError)throw error;
 fail('LEGACY_VISIBILITY_UNAVAILABLE','Cannot inspect every visible process storage handle and mapping');
 }
 }
 if(unsafeMount||read_only_aliases<roots.length)fail('LEGACY_STORAGE_WRITABLE','Every legacy storage alias must be observably read-only');
 const after=await pids();if(after.some(pid=>!before.includes(pid)))fail('LEGACY_OBSERVATION_CHANGED','New process appeared during writer observation; repeat the complete observation');
 if(await fs.readFile('/proc/self/mountinfo','utf8')!==selfText)fail('LEGACY_OBSERVATION_CHANGED','Observer mount topology changed');
 await namespaces(config);if(await admission(config,input)!==admission_digest)fail('LEGACY_OBSERVATION_CHANGED','Legacy admission changed');
 const observed_at=new Date().toISOString(),expires_at=new Date(Date.now()+10000).toISOString(),observed_visibility={...visibility,checked_processes,checked_mount_namespaces:seen.size};
 const evidence={topology,admission_digest,observations:observations.sort(),observed_visibility,read_only_aliases,observed_at,expires_at};
 return {...this.binding(input),status:'ISOLATED',topology_digest:topology,isolated_writer:config.legacy_writer_id,observed_at,expires_at,evidence_digest:hash(canonical(evidence)),visibility:observed_visibility,admission_disabled:true,writable_fds:0,writable_shared_mappings:0,read_only_aliases};
 }
}
export function createLegacyWriterAdmission(env:Readonly<NodeJS.ProcessEnv>):LegacyWriterAdmission{return new LegacyWriterAdmission(env);}

export function createLegacyComponent(ctx:ComponentContext):Component {
 return {apiVersion:1,capabilities:{'migration.legacy-writers.v1':createLegacyWriterAdmission(ctx.env)},actions:{
 'legacy.writer.describe':async(raw:unknown)=>{
 if(!object(raw)||Object.keys(raw).length)fail('LEGACY_FENCE_INPUT','Description takes empty input');
 return {server_only:true,proof_visibility:'CONFIGURED_PID_NAMESPACE',whole_host_authority:false,request_fence_registration:false};
 }}};
}
