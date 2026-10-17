import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Component, ComponentContext } from '../../components/registry.js';
import { FoundationError } from '../../policy/programme.js';
import { canonicalJSON, validateProfile, verifyManifest } from '../../preparation/manifests.js';
import type { PreparationManifest } from '../../preparation/manifests.js';
import { validateProviderOperation, validateProviderOutcome } from '../contract.js';
import type { ProviderOperation, ProviderOutcome } from '../contract.js';

export const BLAXEL_PINS=Object.freeze({sdk:'0.3.30',cli:'0.1.127',
  linux_x86_64_archive_sha256:'a23b387dd309cd37ba381ad9383efe124bad306347c058a6bad2803cffb3b900'});
type Obj=Record<string,unknown>;
interface ImageRecipe{
 name:string;base_image:string;sandbox_api_image:string;sandbox_api_version:string;install_script:string;
 slim:false;build_memory_mib:number;build_volume_mib:number;build_region:string;timeout_seconds:number;
}
interface StoragePlan{
 overlay_bytes:string;reserved_memory_bytes:string;headroom_bytes:string;
 volume:null|{reference:string;mount_path:string;size_bytes:string;template_revision:string;template_path:string};
 writable_paths:Array<{path:string;backend:'overlay'|'volume';required_bytes:string}>;
 required_paths:Array<{path:string;source:'image'|'volume'}>;
}
interface PackageProbe{ecosystem:'node'|'python';name:string;version:string}
interface ProbeRequirements{packages:PackageProbe[];compile_c:boolean}
export interface BlaxelImagePlan{
 schema_version:1;preparation_digest:string;manifest:PreparationManifest;image:ImageRecipe;storage:StoragePlan;
 probe_requirements:ProbeRequirements;recipe:{dockerfile:string;blaxel_toml:string};plan_digest:string;
}
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function shape(value:unknown,keys:readonly string[]):Obj{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('BLAXEL_IMAGE_INVALID','Expected an object');
 const o=value as Obj;if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))fail('BLAXEL_IMAGE_INVALID','Fields do not match image schema');return o;
}
function text(v:unknown,max=256):string{
 if(typeof v!=='string'||!v.length||v.length>max||/[\x00-\x1f\x7f]/.test(v))fail('BLAXEL_IMAGE_INVALID','Invalid bounded string');return v;
}
function number(v:unknown,min:number,max:number):number{
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)fail('BLAXEL_IMAGE_INVALID','Invalid integer');return v;
}
function bytes(v:unknown,positive=false):string{
 if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(v)||BigInt(v)>9223372036854775807n||(positive&&v==='0'))fail('BLAXEL_IMAGE_INVALID','Invalid canonical byte quantity');return v;
}
function relative(v:unknown):string{
 const s=text(v,4096);if(path.posix.isAbsolute(s)||s.includes('\\')||s.split('/').some(p=>!p||p==='.'||p==='..'))fail('BLAXEL_IMAGE_INVALID','Unsafe relative path');return s;
}
function absolute(v:unknown):string{
 const s=text(v,4096);if(!s.startsWith('/')||s==='/'||s.includes('\\')||path.posix.normalize(s)!==s||s.split('/').slice(1).some(p=>!p||p==='.'||p==='..'))fail('BLAXEL_IMAGE_INVALID','Unsafe sandbox path');return s;
}
function imageRef(v:unknown):string{
 const s=text(v,512);if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(s))fail('BLAXEL_IMAGE_INVALID','Image must use content digest');return s;
}
function hash(v:unknown):string{return 'sha256:'+createHash('sha256').update(canonicalJSON(v)).digest('hex');}
function unique<T>(a:T[],key:(v:T)=>string):T[]{if(new Set(a.map(key)).size!==a.length)fail('BLAXEL_IMAGE_INVALID','Duplicate requirement');return a;}
function array<T>(v:unknown,f:(v:unknown)=>T,min=0):T[]{if(!Array.isArray(v)||v.length<min||v.length>128)fail('BLAXEL_IMAGE_INVALID','Invalid bounded list');return v.map(f);}
function under(p:string,root:string):boolean{return p===root||p.startsWith(root+'/');}
function recipe(v:unknown):ImageRecipe{
 const o=shape(v,['name','base_image','sandbox_api_image','sandbox_api_version','install_script','slim','build_memory_mib','build_volume_mib','build_region','timeout_seconds']);
 const name=text(o.name,63),region=text(o.build_region,64),api=text(o.sandbox_api_version,64);
 if(!/^[a-z][a-z0-9-]{0,62}$/.test(name)||!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region)||!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(api)||o.slim!==false)fail('BLAXEL_IMAGE_INVALID','Coding images require pinned API and slimming disabled');
 return{name,base_image:imageRef(o.base_image),sandbox_api_image:imageRef(o.sandbox_api_image),sandbox_api_version:api,install_script:relative(o.install_script),slim:false,build_memory_mib:number(o.build_memory_mib,1,32768),build_volume_mib:number(o.build_volume_mib,0,131072),build_region:region,timeout_seconds:number(o.timeout_seconds,1,3600)};
}
function storage(v:unknown,manifest:PreparationManifest):StoragePlan{
 const o=shape(v,['overlay_bytes','reserved_memory_bytes','headroom_bytes','volume','writable_paths','required_paths']);
 const volume=o.volume===null?null:(()=>{const x=shape(o.volume,['reference','mount_path','size_bytes','template_revision','template_path']);return{reference:text(x.reference),mount_path:absolute(x.mount_path),size_bytes:bytes(x.size_bytes,true),template_revision:text(x.template_revision),template_path:relative(x.template_path)};})();
 const p:StoragePlan={overlay_bytes:bytes(o.overlay_bytes,true),reserved_memory_bytes:bytes(o.reserved_memory_bytes,true),headroom_bytes:bytes(o.headroom_bytes,true),volume,
  writable_paths:unique(array(o.writable_paths,v=>{const x=shape(v,['path','backend','required_bytes']);if(!['overlay','volume'].includes(x.backend as string))fail('BLAXEL_IMAGE_INVALID','Unknown storage backend');return{path:absolute(x.path),backend:x.backend as 'overlay'|'volume',required_bytes:bytes(x.required_bytes,true)};},1),x=>x.path),
  required_paths:unique(array(o.required_paths,v=>{const x=shape(v,['path','source']);if(!['image','volume'].includes(x.source as string))fail('BLAXEL_IMAGE_INVALID','Unknown preload source');return{path:absolute(x.path),source:x.source as 'image'|'volume'};}),x=>x.path)};
 if(BigInt(p.overlay_bytes)+BigInt(p.reserved_memory_bytes)+BigInt(p.headroom_bytes)>BigInt(manifest.profile.resources.memory_bytes))fail('IMAGE_STORAGE_UNSATISFIED','RAM-backed overlay exceeds pinned memory budget');
 if(volume&&BigInt(volume.size_bytes)>BigInt(manifest.profile.resources.persistent_volume_bytes))fail('IMAGE_STORAGE_UNSATISFIED','Volume exceeds profile capacity');
 for(let i=0;i<p.writable_paths.length;i++){const w=p.writable_paths[i]!;
  if(p.writable_paths.some((other,j)=>i!==j&&(under(w.path,other.path)||under(other.path,w.path))))fail('IMAGE_STORAGE_UNSATISFIED','Writable slot paths overlap');
  if((w.backend==='volume')!==!!(volume&&under(w.path,volume.mount_path)))fail('IMAGE_STORAGE_UNSATISFIED','Writable path backend differs from mount');
 }
 for(const f of p.required_paths){if(f.source==='image'&&volume&&under(f.path,volume.mount_path))fail('IMAGE_MOUNT_MASKED','Volume would hide required image content');if(f.source==='volume'&&(!volume||!under(f.path,volume.mount_path)))fail('IMAGE_MOUNT_MASKED','Volume content lies outside mount');}
 for(const backend of ['overlay','volume'] as const){const required=p.writable_paths.filter(w=>w.backend===backend).reduce((s,w)=>s+BigInt(w.required_bytes),0n),capacity=backend==='overlay'?BigInt(p.overlay_bytes):BigInt(volume?.size_bytes??'0'),template=backend==='volume'&&volume?manifest.files.filter(f=>under(f.path,volume.template_path)).reduce((s,f)=>s+BigInt(f.size),0n):0n;if(required>0n&&required+template+BigInt(p.headroom_bytes)>capacity)fail('IMAGE_STORAGE_UNSATISFIED','Insufficient storage headroom');}
 if(volume&&!manifest.directories.some(d=>d.path===volume.template_path))fail('IMAGE_STORAGE_UNSATISFIED','Pinned template directory missing');return p;
}
function probes(v:unknown):ProbeRequirements{
 const o=shape(v,['packages','compile_c']);if(typeof o.compile_c!=='boolean')fail('BLAXEL_IMAGE_INVALID','compile_c must be boolean');
 return{compile_c:o.compile_c,packages:unique(array(o.packages,v=>{const p=shape(v,['ecosystem','name','version']),name=text(p.name,128),version=text(p.version,128);
  if(!['node','python'].includes(p.ecosystem as string)||!/^(?:@[a-z0-9._-]+\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)||!/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(version))fail('BLAXEL_IMAGE_INVALID','Invalid package probe');
  if(p.ecosystem==='python'&&(name.includes('/')||name.includes('-')))fail('BLAXEL_IMAGE_INVALID','Python import name required');return{ecosystem:p.ecosystem as 'node'|'python',name,version};}),p=>p.ecosystem+':'+p.name)};
}
async function candidatePath(value:unknown,ctx:ComponentContext):Promise<string>{
 const rel=relative(value),root=ctx.env.HF_PREPARATION_ALLOWED_ROOT;if(!root||!path.isAbsolute(root))fail('IMAGE_CONTEXT_UNSAFE','Trusted preparation root unavailable');
 let current=await fs.realpath(root);for(const part of rel.split('/')){current=path.join(current,part);const s=await fs.lstat(current);if(s.isSymbolicLink()||!s.isDirectory())fail('IMAGE_CONTEXT_UNSAFE','Candidate ancestor is not an ordinary directory');}return current;
}
async function validateCandidate(candidate:string,manifest:PreparationManifest,scan_policy:unknown,ctx:ComponentContext):Promise<void>{
 try{await verifyManifest({candidate_path:candidate,manifest,scan_policy},ctx);}catch{fail('PREPARATION_MISMATCH','Contents or scan declaration differ from manifest');}
 if(Date.parse(manifest.profile.policy.expires_at)<=Date.now())fail('PREPARATION_MISMATCH','Preparation policy expired');
}
function rendered(i:ImageRecipe):{dockerfile:string;blaxel_toml:string}{
 // SDK 0.3.30 ImageInstance.build() cannot disable publication slimming.
 return{dockerfile:['FROM '+i.base_image,'COPY --from='+i.sandbox_api_image+' /sandbox-api /usr/local/bin/sandbox-api','COPY candidate/ /opt/hyperfide/prepared/','RUN '+JSON.stringify(['/bin/sh','/opt/hyperfide/prepared/'+i.install_script]),'ENTRYPOINT ["/usr/local/bin/sandbox-api"]',''].join('\n'),
 blaxel_toml:['name = '+JSON.stringify(i.name),'type = "sandbox"','[build]','slim = false','memoryMb = '+i.build_memory_mib,'volumeMb = '+i.build_volume_mib,'region = '+JSON.stringify(i.build_region),''].join('\n')};
}
export async function planBlaxelImage(value:unknown,ctx:ComponentContext):Promise<BlaxelImagePlan>{
 const o=shape(value,['candidate_path','manifest','scan_policy','image','storage','probe_requirements']),manifest=o.manifest as PreparationManifest;
 if(!manifest||(manifest.schema_version!==1&&manifest.schema_version!==2))fail('BLAXEL_IMAGE_INVALID','Preparation manifest required');validateProfile(manifest.profile);
 const candidate=relative(o.candidate_path);await validateCandidate(candidate,manifest,o.scan_policy,ctx);const image=recipe(o.image);
 if(manifest.profile.image.provider!=='blaxel'||manifest.profile.image.reference!==image.base_image||manifest.profile.recipe.path!==image.install_script||!manifest.files.some(f=>f.path===image.install_script&&f.digest===manifest.profile.recipe.digest))fail('PREPARATION_MISMATCH','Image differs from preparation profile');
 const result={schema_version:1 as const,preparation_digest:manifest.digest,manifest,image,storage:storage(o.storage,manifest),probe_requirements:probes(o.probe_requirements),recipe:rendered(image)};
 await rejectTemplateLinks(await candidatePath(candidate,ctx),result.storage);return{...result,plan_digest:hash(result)};
}
export function validateBlaxelImagePlan(value:unknown):BlaxelImagePlan{
 const p=shape(value,['schema_version','preparation_digest','manifest','image','storage','probe_requirements','recipe','plan_digest']),manifest=p.manifest as PreparationManifest;
 if(p.schema_version!==1||!manifest||p.preparation_digest!==manifest.digest)fail('PREPARATION_MISMATCH','Plan preparation identity differs');validateProfile(manifest.profile);
 const image=recipe(p.image),expected={schema_version:1 as const,preparation_digest:manifest.digest,manifest,image,storage:storage(p.storage,manifest),probe_requirements:probes(p.probe_requirements),recipe:rendered(image)};
 if(canonicalJSON(p.recipe)!==canonicalJSON(expected.recipe)||p.plan_digest!==hash(expected))fail('PREPARATION_MISMATCH','Plan or generated recipe changed');
 if(manifest.profile.image.provider!=='blaxel'||manifest.profile.image.reference!==image.base_image||manifest.profile.recipe.path!==image.install_script||Date.parse(manifest.profile.policy.expires_at)<=Date.now())fail('PREPARATION_MISMATCH','Incompatible or expired preparation');
 return{...expected,plan_digest:p.plan_digest as string};
}
async function rejectTemplateLinks(root:string,p:StoragePlan):Promise<void>{
 if(!p.volume)return;const seen=new Set<string>();
 async function walk(dir:string):Promise<void>{for(const name of await fs.readdir(dir)){const child=path.join(dir,name),s=await fs.lstat(child);if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile())||(s.isFile()&&s.nlink!==1))fail('IMAGE_TEMPLATE_LINK','Template requires copied files without links');if(s.isDirectory())await walk(child);else{const key=s.dev+':'+s.ino;if(seen.has(key))fail('IMAGE_TEMPLATE_LINK','Template hardlink');seen.add(key);}}}
 await walk(path.join(root,p.volume.template_path));
}
const BOUNDED_PROCESS_WRAPPER="import ctypes,os,signal,subprocess,sys,time\nlibc=ctypes.CDLL(None,use_errno=True)\nif libc.prctl(36,1,0,0,0)!=0:\n sys.stderr.write(\"Bounded process supervision unavailable\\n\");sys.exit(125)\nstopping=False\ndef interrupt(signum,frame):\n global stopping\n stopping=True\nsignal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)\ntry:parent=subprocess.Popen(sys.argv[1:],stdin=subprocess.DEVNULL)\nexcept Exception:\n sys.stderr.write(\"Bounded command could not start\\n\");sys.exit(125)\nwhile parent.poll()is None and not stopping:time.sleep(.01)\nif stopping:\n try:parent.kill()\n except ProcessLookupError:pass\ntry:code=parent.wait(timeout=2)\nexcept subprocess.TimeoutExpired:code=125\nleaked=False;deadline=time.monotonic()+5\nwhile True:\n try:\n  children=open(\"/proc/self/task/\"+str(os.getpid())+\"/children\").read().split()\n  if children:leaked=True\n  for child in children:\n   try:os.kill(int(child),signal.SIGKILL)\n   except ProcessLookupError:pass\n  try:\n   pid,status=os.waitpid(-1,os.WNOHANG)\n   if pid:continue\n  except ChildProcessError:break\n except OSError:\n  sys.stderr.write(\"Descendant cleanup could not be verified\\n\");sys.exit(125)\n if time.monotonic()>=deadline:\n  sys.stderr.write(\"Descendant cleanup remains unresolved\\n\");sys.exit(125)\n time.sleep(.01)\nif leaked:sys.stderr.write(\"Unexpected bounded-command descendants were terminated and reaped\\n\")\nsys.exit(125 if leaked or stopping else(code if code>=0 else 128-code))\n";
interface ProcessObservation{exit_code:number|null;stdout:string;stderr:string;timed_out:boolean}
export const BLAXEL_SUPERVISOR_PYTHON=process.env.HYPERFIDE_SUPERVISOR_PYTHON??'/usr/bin/python3';
export async function runBlaxelCommand(argv:string[],cwd:string,env:NodeJS.ProcessEnv,timeout:number,signal:AbortSignal):Promise<ProcessObservation>{
 if(!path.isAbsolute(BLAXEL_SUPERVISOR_PYTHON)||BLAXEL_SUPERVISOR_PYTHON.includes('\0'))fail('BLAXEL_SUPERVISOR_UNAVAILABLE','Trusted absolute Python supervisor path is required');
 return new Promise((resolve,reject)=>{if(signal.aborted){reject(new Error('Operation cancelled'));return;}
 const child=spawn(BLAXEL_SUPERVISOR_PYTHON,['-I','-c',BOUNDED_PROCESS_WRAPPER,...argv],{cwd,env,stdio:['ignore','pipe','pipe'],detached:true});let stdout='',stderr='',timedOut=false,overflow=false,settled=false;
 let killTimer:ReturnType<typeof setTimeout>|undefined;
 const kill=()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}};
 const terminate=()=>{try{process.kill(-child.pid!,'SIGTERM');}catch{};killTimer??=setTimeout(kill,6000);},abort=()=>terminate();signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>{timedOut=true;terminate();},timeout);
 const consume=(which:'stdout'|'stderr',chunk:Buffer)=>{if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)+chunk.length>2*1024*1024){overflow=true;terminate();return;}if(which==='stdout')stdout+=chunk.toString();else stderr+=chunk.toString();};
 child.stdout.on('data',c=>consume('stdout',c));child.stderr.on('data',c=>consume('stderr',c));
 const finish=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal.removeEventListener('abort',abort);};
 child.on('error',_e=>{if(!settled){settled=true;finish();reject(new FoundationError('BLAXEL_SUPERVISOR_UNAVAILABLE','Configured Linux child-subreaper Python supervisor could not start'));}});child.on('close',code=>{if(!settled){settled=true;finish();resolve({exit_code:overflow?null:code,stdout,stderr,timed_out:timedOut||signal.aborted||overflow});}});
 });
}
const PROBE_SCRIPT="const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),Module=require('node:module');\nconst crypto=require('node:crypto');\nconst c=JSON.parse(Buffer.from(process.argv[1],'base64').toString()),checks=[];\nfunction bad(code,message){process.stdout.write(JSON.stringify({ok:false,error:{code,message}}));process.exit(1)}\nfunction safe(p){let x=c.root;for(const part of p.split('/').filter(Boolean)){x=path.join(x,part);let s;try{s=fs.lstatSync(x)}catch{bad('IMAGE_STORAGE_UNSATISFIED','Required sandbox path missing')}if(s.isSymbolicLink())bad('IMAGE_CONTEXT_UNSAFE','Symlink in inspected path')}return x}\nfunction call(exe,args,cwd){try{return cp.execFileSync(exe,args,{cwd,encoding:'utf8',timeout:15000,maxBuffer:65536,stdio:['ignore','pipe','pipe']}).trim()}catch{bad('IMAGE_TOOL_MISMATCH','Required executable failed: '+exe)}}\nconst allowed=new Set(['cc','gcc','g++','clang','make','cmake','rustc','cargo','go','node','npm','pnpm','uv','python','python3','git','claude','codex','hyperfide','hyperfide-runner','sandbox-api']);\nfor(const t of c.tools){if(t.name==='sandbox-api'){let health;try{const script=\"const r=await fetch('http://127.0.0.1:\"+c.api_port+\"/health',{signal:AbortSignal.timeout(5000)});if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))\";health=JSON.parse(call(process.execPath,['--input-type=module','-e',script],c.root));}catch{bad('IMAGE_TOOL_MISMATCH','sandbox API health unavailable')}if(health.status!=='ok'||String(health.version).replace(/^v/,'')!==t.version)bad('IMAGE_TOOL_MISMATCH','sandbox API version mismatch');checks.push({kind:'sandbox_api_health',version:t.version});continue;}if(!allowed.has(t.name))bad('IMAGE_TOOL_MISMATCH','Unsupported mandatory tool probe');const out=call(t.name,t.name==='go'?['version']:['--version'],c.root);const tokens=out.split(/\\s+/).map(x=>x.replace(/^v(?=\\d)/,''));if(!tokens.includes(t.version))bad('IMAGE_TOOL_MISMATCH','Pinned tool version mismatch: '+t.name);checks.push({kind:'tool',name:t.name,version:t.version})}\nfor(const f of c.files){const actual=safe('/opt/hyperfide/prepared/'+f.path),s=fs.statSync(actual);if(!s.isFile()||String(s.size)!==f.size||'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex')!==f.digest)bad('PREPARATION_MISMATCH','Published preparation content differs');}\nchecks.push({kind:'published_content',files:c.files.length});\nfor(const p of c.required_paths)safe(p.path);\nconst storage=[],spools=[];\ntry{\n for(const w of c.writable_paths){const dir=safe(w.path),s=fs.statSync(dir);if(!s.isDirectory())bad('IMAGE_STORAGE_UNSATISFIED','Writable path is not directory');const stat=fs.statfsSync(dir,{bigint:true}),available=stat.bavail*stat.bsize;if(available<BigInt(w.required_bytes)+BigInt(c.headroom_bytes))bad('IMAGE_STORAGE_UNSATISFIED','Observed free bytes below headroom');const f=path.join(dir,'.hyperfide-probe-'+process.pid);fs.writeFileSync(f,w.path,{flag:'wx',mode:384});spools.push(f);storage.push({path:w.path,backend:w.backend,available_bytes:available.toString(),device:String(s.dev),filesystem_type:String(stat.type)})}\n for(let i=0;i<spools.length;i++)if(fs.readFileSync(spools[i],'utf8')!==c.writable_paths[i].path)bad('IMAGE_STORAGE_UNSATISFIED','Writable slots alias');\n const cwd=safe(c.writable_paths[0].path);\n for(const p of c.packages){let version;try{if(p.ecosystem==='node'){const req=Module.createRequire(path.join(cwd,'package.json'));req(p.name);version=req(p.name+'/package.json').version}else{const s=\"import importlib,importlib.metadata;importlib.import_module(\"+JSON.stringify(p.name)+\");print(importlib.metadata.version(\"+JSON.stringify(p.name)+\"))\";version=call('python3',['-c',s],cwd)}}catch{bad('IMAGE_PACKAGE_UNRESOLVED','Actual package import failed')}if(version!==p.version)bad('IMAGE_PACKAGE_UNRESOLVED','Package version mismatch');checks.push({kind:'package',name:p.name,version})}\n if(c.compile_c){const dir=fs.mkdtempSync(path.join(cwd,'.hyperfide-compile-'));try{fs.writeFileSync(path.join(dir,'probe.c'),'#include <stdio.h>\\nint main(void){puts(\"hyperfide-native-probe\");return 0;}\\n');call('cc',['probe.c','-o','probe'],dir);if(call(path.join(dir,'probe'),[],dir)!=='hyperfide-native-probe')bad('IMAGE_TOOL_MISMATCH','Compiler output failed');checks.push({kind:'compile_c',passed:true})}finally{fs.rmSync(dir,{recursive:true,force:true})}}\n process.stdout.write(JSON.stringify({ok:true,checks,storage,slot_isolation:true}));\n}finally{for(const f of spools)try{fs.unlinkSync(f)}catch{}}";
function tools(p:BlaxelImagePlan):Array<{name:string;version:string}>{
 const x=p.manifest.profile,pins=[...x.toolchains,...x.package_managers.map(p=>({name:p.name,version:p.version})),...x.native_agents,x.supervisor,{name:'hyperfide',version:x.hyperfide.version},{name:'sandbox-api',version:p.image.sandbox_api_version}],map=new Map<string,string>();
 for(const pin of pins){if(map.has(pin.name)&&map.get(pin.name)!==pin.version)fail('IMAGE_TOOL_MISMATCH','Conflicting mandatory pins');map.set(pin.name,pin.version);}return[...map].map(([name,version])=>({name,version}));
}
function shell(v:string):string{return "'"+v.replaceAll("'","'\\''")+"'";}
export function blaxelCredentials(ctx:Pick<ComponentContext,'env'>):{workspace:string;apiKey:string}{
 if(ctx.env.HF_BLAXEL_LIVE_ENABLED!=='true'||!ctx.env.HF_BLAXEL_WORKSPACE||!ctx.env.HF_BLAXEL_API_KEY)fail('BLAXEL_CREDENTIALS_UNAVAILABLE','Live credentials and operator enablement unavailable');
 return{workspace:ctx.env.HF_BLAXEL_WORKSPACE,apiKey:ctx.env.HF_BLAXEL_API_KEY};
}
async function assertSDKConfiguration():Promise<void>{
 // The pinned SDK gives CWD .env/blaxel.toml precedence over process.env.
 // Provider administration must never resolve endpoints from repository files.
 for(const name of ['.env','blaxel.toml']){
  try{await fs.lstat(path.resolve(name));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
  fail('BLAXEL_CREDENTIALS_UNAVAILABLE','SDK requires a trusted working directory without automatic repository configuration');
 }
 for(const name of ['BL_API_URL','BL_RUN_URL','BL_API_VERSION','BL_PROXY']){
  if(process.env[name]!==undefined)fail('BLAXEL_CREDENTIALS_UNAVAILABLE','SDK endpoint overrides are not enabled in this provider profile');
 }
 if(process.env.BL_ENV!==undefined&&process.env.BL_ENV!=='prod')
  fail('BLAXEL_CREDENTIALS_UNAVAILABLE','SDK production endpoint policy differs');
}
let configuredWorkspace:string|undefined;
export interface BlaxelRuntimeSDK {
 settings:{readonly baseUrl:string;readonly runUrl:string;setConfig(config:{apiKey:string;workspace:string;maxConcurrentH2Requests:number;maxConcurrentUploadH2Requests:number;fsPartRetries:number;sandboxReadRetries:number;integration:string}):void};
 SandboxInstance:{get(name:string):Promise<{process:{exec(request:{command:string;workingDir:string;waitForCompletion:boolean;timeout:number;keepAlive:boolean}):Promise<unknown>}}>};
}

export async function configuredBlaxelSDK(ctx:Pick<ComponentContext,'env'>):Promise<BlaxelRuntimeSDK>{
 await assertSDKConfiguration();
 const auth=blaxelCredentials(ctx);if(configuredWorkspace&&configuredWorkspace!==auth.workspace)fail('BLAXEL_IMAGE_INVALID','Provisioner cannot switch workspaces');
 // The vendor root declarations import unrelated incompatible browser/MCP types.
 // Retain strict compiler checks and validate only the used SDK runtime boundary.
 const packageName:string='@blaxel/core';
 const loaded:unknown=await import(packageName);
 if(!loaded||typeof loaded!=='object'||!('settings' in loaded)||!('SandboxInstance' in loaded))
   fail('BLAXEL_PUBLISHER_UNAVAILABLE','Pinned SDK exports unavailable');
 const sdk=loaded as BlaxelRuntimeSDK;
 if(typeof sdk.settings?.setConfig!=='function'||typeof sdk.SandboxInstance?.get!=='function')
   fail('BLAXEL_PUBLISHER_UNAVAILABLE','Pinned SDK runtime shape differs');
 if(sdk.settings.baseUrl!=='https://api.blaxel.ai/v0'||sdk.settings.runUrl!=='https://run.blaxel.ai')fail('BLAXEL_CREDENTIALS_UNAVAILABLE','SDK resolved endpoints differ from trusted production policy');
 sdk.settings.setConfig({apiKey:auth.apiKey,workspace:auth.workspace,maxConcurrentH2Requests:16,maxConcurrentUploadH2Requests:2,fsPartRetries:0,sandboxReadRetries:2,integration:'hyperfide/2.0.0'});configuredWorkspace=auth.workspace;return sdk;
}
export async function inspectBlaxelImage(value:unknown,ctx:ComponentContext):Promise<unknown>{
 const o=shape(value,['plan','sandbox_reference','candidate_path','scan_policy']),p=validateBlaxelImagePlan(o.plan);await validateCandidate(relative(o.candidate_path),p.manifest,o.scan_policy,ctx);
 const local=ctx.env.HF_BLAXEL_PROBE_TRANSPORT==='local-component';let root='/',transport:'local-component'|'blaxel'='blaxel',raw:string;
 if(local){if(o.sandbox_reference!==null)fail('BLAXEL_IMAGE_INVALID','Component probe cannot identify live sandbox');const configured=ctx.env.HF_BLAXEL_PROBE_ROOT;if(!configured||!path.isAbsolute(configured)||await fs.realpath(configured)!==configured)fail('IMAGE_CONTEXT_UNSAFE','Trusted probe root unavailable');root=configured;transport='local-component';}
 else if(ctx.env.HF_BLAXEL_PROBE_TRANSPORT!==undefined&&ctx.env.HF_BLAXEL_PROBE_TRANSPORT!=='blaxel')fail('BLAXEL_IMAGE_INVALID','Unknown trusted transport');
 const port=local?Number(ctx.env.HF_BLAXEL_PROBE_API_PORT??'8080'):8080;
 if(!Number.isSafeInteger(port)||port<1||port>65535)fail('BLAXEL_IMAGE_INVALID','Invalid trusted API port');
 const config={root,api_port:port,tools:tools(p),files:p.manifest.files,required_paths:p.storage.required_paths,writable_paths:p.storage.writable_paths,headroom_bytes:p.storage.headroom_bytes,packages:p.probe_requirements.packages,compile_c:p.probe_requirements.compile_c},encoded=Buffer.from(JSON.stringify(config)).toString('base64');
 if(local){const env={PATH:ctx.env.HF_BLAXEL_PROBE_PATH??'/usr/local/bin:/usr/bin:/bin',HOME:root,TMPDIR:root},r=await runBlaxelCommand([process.execPath,'-e',PROBE_SCRIPT,encoded],root,env,60000,ctx.signal);raw=r.stdout;if(r.timed_out||r.exit_code!==0&&!raw)fail('IMAGE_TOOL_MISMATCH','Probe failed or exceeded bounds');}
 else{const sdk=await configuredBlaxelSDK(ctx),sandbox=await sdk.SandboxInstance.get(text(o.sandbox_reference,128));if(ctx.signal.aborted)fail('BLAXEL_IMAGE_INVALID','Inspection cancelled');
  const response=await sandbox.process.exec({command:['node','-e',PROBE_SCRIPT,encoded].map(shell).join(' '),workingDir:'/',waitForCompletion:true,keepAlive:true,timeout:60}),r=response as unknown as Obj;
  if(r.status!=='completed'||r.exitCode!==0||typeof r.stdout!=='string')fail('IMAGE_TOOL_MISMATCH','Live probe lacks complete successful observed exit and logs');raw=r.stdout;
 }
 let observed:Obj;try{observed=JSON.parse(raw) as Obj;}catch{fail('IMAGE_TOOL_MISMATCH','Incomplete probe output');}
 if(observed.ok!==true){const e=observed.error as Obj|undefined;fail(typeof e?.code==='string'?e.code:'IMAGE_TOOL_MISMATCH',typeof e?.message==='string'?e.message:'Inspection failed');}
 return{observed:true,transport,preparation_digest:p.preparation_digest,source_preparation_digest:p.preparation_digest,provider_prepared_digest:p.plan_digest,plan_digest:p.plan_digest,checks:observed.checks,storage_observations:observed.storage,slot_isolation:observed.slot_isolation,authority:'NONE',live_qualification:'NOT_EVALUATED',qualified:false};
}
async function copyContext(candidate:string,manifest:PreparationManifest,destination:string,signal:AbortSignal,deadline:number):Promise<void>{
 await fs.mkdir(destination,{mode:0o700});
 for(const d of manifest.directories.filter(d=>d.path!=='.').sort((a,b)=>a.path.split('/').length-b.path.split('/').length))
  await fs.mkdir(path.join(destination,d.path),{mode:d.mode});
 const held:Awaited<ReturnType<typeof fs.open>>[]=[];
 try{
  let root=await fs.open('/',fss.constants.O_RDONLY|fss.constants.O_DIRECTORY|fss.constants.O_NOFOLLOW);held.push(root);
  for(const part of candidate.split('/').filter(Boolean)){
   root=await fs.open('/proc/self/fd/'+root.fd+'/'+part,fss.constants.O_RDONLY|fss.constants.O_DIRECTORY|fss.constants.O_NOFOLLOW);held.push(root);
  }
  for(const f of manifest.files){
   if(signal.aborted||Date.now()>=deadline)fail('PREPARATION_MISMATCH','Context copy cancelled or deadline expired');
   const fileHeld:Awaited<ReturnType<typeof fs.open>>[]=[];
   let parent=root;
   try{
    const parts=f.path.split('/'),leaf=parts.pop()!;
    for(const part of parts){parent=await fs.open('/proc/self/fd/'+parent.fd+'/'+part,fss.constants.O_RDONLY|fss.constants.O_DIRECTORY|fss.constants.O_NOFOLLOW);fileHeld.push(parent);}
    const input=await fs.open('/proc/self/fd/'+parent.fd+'/'+leaf,fss.constants.O_RDONLY|fss.constants.O_NOFOLLOW|fss.constants.O_NONBLOCK);fileHeld.push(input);
    const before=await input.stat({bigint:true});
    if(!before.isFile()||before.nlink!==1n||String(before.size)!==f.size)fail('IMAGE_CONTEXT_UNSAFE','Context file type or links changed');
    const output=await fs.open(path.join(destination,f.path),'wx',f.mode),digest=createHash('sha256');let count=0n;
    try{
     for await(const chunk of input.createReadStream({autoClose:false})){
      if(signal.aborted||Date.now()>=deadline)fail('PREPARATION_MISMATCH','Context copy cancelled or deadline expired');
      count+=BigInt(chunk.length);if(count>BigInt(f.size))fail('PREPARATION_MISMATCH','Context grew during copy');
      digest.update(chunk);await output.writeFile(chunk);
     }
    }finally{await output.close();}
    const after=await input.stat({bigint:true});
    if(count!==BigInt(f.size)||'sha256:'+digest.digest('hex')!==f.digest||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||before.size!==after.size)
     fail('PREPARATION_MISMATCH','Candidate changed during context construction');
   }finally{for(const fd of fileHeld.reverse())await fd.close();}
  }
 }finally{for(const fd of held.reverse())await fd.close();}
}
export function blaxelImageOperationReference(plan:BlaxelImagePlan):string{return 'hyperfide/blaxel-plan@'+plan.plan_digest;}
export async function publishBlaxelImage(value:unknown,ctx:ComponentContext):Promise<ProviderOutcome<'prepare'>>{
 const o=shape(value,['plan','candidate_path','scan_policy','operation']),p=validateBlaxelImagePlan(o.plan);await validateCandidate(relative(o.candidate_path),p.manifest,o.scan_policy,ctx);
 const op=validateProviderOperation(o.operation) as ProviderOperation<'prepare'>;
 if(op.kind!=='prepare'||op.scope.provider!=='blaxel'||op.preparation_digest!==p.preparation_digest||op.parameters.recipe_digest!==p.preparation_digest||op.parameters.image_reference!==blaxelImageOperationReference(p)||canonicalJSON(op.parameters.os)!==canonicalJSON(p.manifest.profile.os))fail('PREPARATION_MISMATCH','Operation does not bind this plan');
 const auth=blaxelCredentials(ctx);if(!ctx.env.HF_BLAXEL_ACCOUNT_ID||op.scope.provider_account_id!==ctx.env.HF_BLAXEL_ACCOUNT_ID||op.scope.environment_id!==auth.workspace||op.scope.region!==p.image.build_region)fail('BLAXEL_IMAGE_INVALID','Scope differs from publisher config');if(Date.parse(op.deadline_at)<=Date.now())fail('BLAXEL_IMAGE_INVALID','Deadline expired');
 const cli=ctx.env.HF_BLAXEL_CLI_PATH,expected=ctx.env.HF_BLAXEL_CLI_SHA256;if(!cli||!path.isAbsolute(cli)||!expected||!/^[a-f0-9]{64}$/.test(expected))fail('BLAXEL_PUBLISHER_UNAVAILABLE','Pinned CLI path and binary digest required');
 const s=await fs.lstat(cli);if(!s.isFile()||s.isSymbolicLink()||createHash('sha256').update(await fs.readFile(cli)).digest('hex')!==expected)fail('BLAXEL_PUBLISHER_UNAVAILABLE','CLI digest mismatch');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hyperfide-blaxel-image-')),home=path.join(temp,'home'),dir=path.join(temp,'context');let attempted=false;
 const identity={schema_version:1 as const,operation_id:op.identity.operation_id,payload_digest:op.identity.payload_digest,scope:op.scope,observed_at:'',provider_request_id:null,resource:null};
 try{await fs.mkdir(home,{mode:0o700});await fs.mkdir(dir,{mode:0o700});await copyContext(await candidatePath(o.candidate_path,ctx),p.manifest,path.join(dir,'candidate'),ctx.signal,Date.parse(op.deadline_at));await fs.writeFile(path.join(dir,'Dockerfile'),p.recipe.dockerfile,{mode:0o600});await fs.writeFile(path.join(dir,'blaxel.toml'),p.recipe.blaxel_toml,{mode:0o600});
 const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,BL_WORKSPACE:auth.workspace,BL_API_KEY:auth.apiKey,BL_INSTALL_SKILLS:'false',BL_INSTALL_SETUP:'false',CI:'true'},version=await runBlaxelCommand([cli,'version'],dir,env,15000,ctx.signal);
 if(version.exit_code!==0||!version.stdout.split(/\s+/).some(s=>s.replace(/^v/,'')===BLAXEL_PINS.cli))fail('BLAXEL_PUBLISHER_UNAVAILABLE','CLI version mismatch');
 const tag=p.plan_digest.slice(7),timeout=Math.min(p.image.timeout_seconds*1000,Date.parse(op.deadline_at)-Date.now());if(timeout<=0||ctx.signal.aborted)fail('BLAXEL_IMAGE_INVALID','Deadline expired or cancelled');attempted=true;
 const r=await runBlaxelCommand([cli,'push','--yes','--skip-version-warning','--type','sandbox','--name',p.image.name,'--tag',tag,'--directory',dir,'--timeout',Math.ceil(timeout/1000)+'s','--output','json'],dir,env,timeout,ctx.signal);identity.observed_at=new Date().toISOString();
 if(r.exit_code!==0||r.timed_out||Date.now()>Date.parse(op.deadline_at))return{...identity,status:'UNKNOWN',acceptance:'UNKNOWN',result:null,error:{code:r.timed_out?'TIMEOUT':'UNAVAILABLE',provider_code:null,message:'Publication requires reconciliation before retry',retry_after_ms:null},reconcile_required:true,retry:'AFTER_RECONCILIATION'};
 const outcome:ProviderOutcome<'prepare'>={...identity,status:'SUCCEEDED',acceptance:'CONFIRMED_ACCEPTED',result:{preparation_reference:'sandbox/'+p.image.name+':'+tag,preparation_digest:p.preparation_digest},error:null,reconcile_required:false,retry:'NEVER'};validateProviderOutcome({operation:op,outcome});return outcome;
 }catch(error){if(!attempted)throw error;identity.observed_at=new Date().toISOString();return{...identity,status:'UNKNOWN',acceptance:'UNKNOWN',result:null,error:{code:'UNAVAILABLE',provider_code:null,message:'Reconcile immutable image tag before retry',retry_after_ms:null},reconcile_required:true,retry:'AFTER_RECONCILIATION'};}finally{await fs.rm(temp,{recursive:true,force:true});}
}
export function createComponent(_ctx:ComponentContext):Component{return{apiVersion:1,actions:{
 'blaxel.image.describe':async input=>{shape(input,[]);await assertSDKConfiguration();const name:string='@blaxel/core';const sdk:unknown=await import(name);
 const meta=JSON.parse(await fs.readFile(createRequire(import.meta.url).resolve('@blaxel/core/package.json'),'utf8')) as Obj;
 if(meta.version!==BLAXEL_PINS.sdk||!sdk||typeof sdk!=='object'||!('SandboxInstance'in sdk))fail('BLAXEL_PUBLISHER_UNAVAILABLE','Installed SDK differs from pin');
 return{schema_version:1,pins:BLAXEL_PINS,sdk_loaded:true,authority:'NONE',live_qualification:'NOT_EVALUATED',supported_transports:['blaxel','local-component'],slimming:false};},
 'blaxel.image.plan':planBlaxelImage,'blaxel.image.publish':publishBlaxelImage,'blaxel.image.inspect':inspectBlaxelImage
}};}
