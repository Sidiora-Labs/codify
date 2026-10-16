#!/usr/bin/env node
/* Root operator promotion installs already-built signed bytes. It does not
 * provision identities, migrate data, activate an epoch, or start services. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {constants} from 'node:fs';
const args=process.argv.slice(2),options={};let promote=false;
function refuse(code){throw Object.assign(new Error(code),{code});}
function parseArguments(){for(let i=0;i<args.length;i++){
 if(args[i]==='--promote'){if(promote)refuse('INSTALL_ARGUMENTS');promote=true;continue;}
 const names={'--release-root':'source','--destination-root':'destination','--trusted-key':'key','--signature-file':'signature','--manifest-digest':'digest','--service-uid':'uid','--service-gid':'gid'};
 const key=names[args[i]];if(!key||options[key]!==undefined||!args[i+1])refuse('INSTALL_ARGUMENTS');options[key]=args[++i];
}}
let temporary=null,lock=null,pointerChanged=false;
async function protectedPath(filename,directory){
 if(!path.isAbsolute(filename)||path.normalize(filename)!==filename||await fs.realpath(filename)!==filename)refuse('INSTALL_UNPROTECTED_PATH');
 let current='/';
 for(const part of filename.split('/').filter(Boolean)){
  current=path.join(current,part);const st=await fs.lstat(current);
  if(st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)!==0&&!(st.isDirectory()&&(st.mode&0o1000)!==0))refuse('INSTALL_UNPROTECTED_PATH');
 }
 const st=await fs.lstat(filename);if(directory?!st.isDirectory():!st.isFile()||st.nlink!==1)refuse('INSTALL_UNPROTECTED_PATH');
}
async function syncDirectory(directory){const h=await fs.open(directory,'r');try{await h.sync();}finally{await h.close();}}
async function rootDirectory(directory){
 if(!path.isAbsolute(directory)||directory==='/'||path.normalize(directory)!==directory)refuse('INSTALL_UNPROTECTED_PATH');
 try{await fs.mkdir(directory,{mode:0o755});await fs.chmod(directory,0o755);}catch(e){if(e.code!=='EEXIST')throw e;}
 await protectedPath(directory,true);const st=await fs.stat(directory);if((st.mode&0o777)!==0o755)refuse('INSTALL_PUBLIC_DIRECTORY_REQUIRED');
}
async function copyFile(source,destination,mode,expectedSize){
 await protectedPath(source,false);
 const input=await fs.open(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),output=await fs.open(destination,'wx',mode);
 try{
  const before=await input.stat({bigint:true});if(before.uid!==0n||before.nlink!==1n||!before.isFile()||before.size!==expectedSize)refuse('INSTALL_UNPROTECTED_SOURCE');
  const buffer=Buffer.alloc(1024*1024);let offset=0;
  while(BigInt(offset)<expectedSize){const amount=Number(expectedSize-BigInt(offset)>BigInt(buffer.length)?BigInt(buffer.length):expectedSize-BigInt(offset));const r=await input.read(buffer,0,amount,offset);if(!r.bytesRead)refuse('INSTALL_SOURCE_CHANGED');let used=0;while(used<r.bytesRead){const w=await output.write(buffer,used,r.bytesRead-used,offset+used);if(!w.bytesWritten)refuse('INSTALL_COPY_FAILED');used+=w.bytesWritten;}offset+=r.bytesRead;}
  const tail=Buffer.alloc(1);if((await input.read(tail,0,1,offset)).bytesRead)refuse('INSTALL_SOURCE_CHANGED');
  const after=await input.stat({bigint:true});
  if(before.size!==BigInt(offset)||after.size!==before.size||after.dev!==before.dev||after.ino!==before.ino||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||after.mode!==before.mode||after.uid!==before.uid||after.nlink!==1n)refuse('INSTALL_SOURCE_CHANGED');
  await output.chmod(mode);await output.sync();
 }finally{await input.close();await output.close();}
}
async function readManifest(filename){
 await protectedPath(filename,false);
 const h=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
 const st=await h.stat({bigint:true});if(!st.isFile()||st.uid!==0n||st.nlink!==1n||st.size<1n||st.size>1048576n)refuse('INSTALL_MANIFEST_BOUND');
 const bytes=Buffer.alloc(Number(st.size));let offset=0;
 while(offset<bytes.length){const r=await h.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)refuse('INSTALL_SOURCE_CHANGED');offset+=r.bytesRead;}
 const extra=Buffer.alloc(1),after=await h.stat({bigint:true});
 if((await h.read(extra,0,1,offset)).bytesRead||after.size!==st.size||after.dev!==st.dev||after.ino!==st.ino||after.uid!==st.uid||after.mode!==st.mode||after.nlink!==1n||after.mtimeNs!==st.mtimeNs||after.ctimeNs!==st.ctimeNs)refuse('INSTALL_SOURCE_CHANGED');
 return bytes;
 }finally{await h.close();}
}
async function immutableTree(directory){
 const st=await fs.lstat(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o777)!==0o755)refuse('INSTALL_UNPROTECTED_TARGET');
 for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())await immutableTree(file);
  else{const f=await fs.lstat(file);if(!f.isFile()||f.isSymbolicLink()||f.uid!==0||f.nlink!==1||![0o644,0o755].includes(f.mode&0o777))refuse('INSTALL_UNPROTECTED_TARGET');}
 }
}
async function syncTree(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isDirectory())await syncTree(path.join(directory,entry.name));await syncDirectory(directory);}
async function run(){
 parseArguments();
 if(process.geteuid?.()!==0)refuse('INSTALL_ROOT_OPERATOR_REQUIRED');
 if(Object.keys(options).length!==7||!/^sha256:[0-9a-f]{64}$/.test(options.digest)||!/^([1-9][0-9]{3,9})$/.test(options.uid)||!/^([1-9][0-9]{3,9})$/.test(options.gid)||Number(options.uid)>4294967294||Number(options.gid)>4294967294)refuse('INSTALL_ARGUMENTS');
 for(const name of ['source','key','signature'])await protectedPath(options[name],name==='source');
 if(!path.isAbsolute(options.destination)||options.destination==='/'||path.normalize(options.destination)!==options.destination)refuse('INSTALL_UNPROTECTED_PATH');
 const parent=path.dirname(options.destination);await protectedPath(parent,true);
 const ownRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 let module=path.join(ownRoot,'services/dist/deployment/releases.js');
 try{await fs.access(module);}catch{module=path.join(ownRoot,'services/hyperfide/dist/deployment/releases.js');}
 await protectedPath(module,false);
 const {inspectPrebuiltRelease}=await import(pathToFileURL(module).href);
 const env={HYPERFIDE_RELEASE_ROOT:options.source,HYPERFIDE_TRUSTED_RELEASE_KEY_FILE:options.key,HYPERFIDE_RELEASE_SIGNATURE_FILE:options.signature};
 const verified=await inspectPrebuiltRelease(env,'manifest.json');
 if(verified.signature_status!=='VERIFIED'||verified.authentication?.mode!=='ED25519'||verified.manifest_digest!==options.digest)refuse('INSTALL_AUTHENTICATED_PIN_REQUIRED');
 const manifestBytes=await readManifest(path.join(options.source,'manifest.json'));
 if('sha256:'+createHash('sha256').update(manifestBytes).digest('hex')!==options.digest)refuse('INSTALL_SOURCE_CHANGED');
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
 let total=0n;for(const file of manifest.files){total+=BigInt(file.size_bytes);if(total>34359738368n)refuse('INSTALL_RELEASE_SIZE_BOUND');}
 await rootDirectory(options.destination);
 const releases=path.join(options.destination,'releases');await rootDirectory(releases);
 lock=path.join(options.destination,'.install.lock');try{await fs.mkdir(lock,{mode:0o700});}catch{lock=null;refuse('INSTALL_BUSY_RECONCILE');}
 const target=path.join(releases,options.digest.slice(7));let replayed=false;
 try{await fs.lstat(target);replayed=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!replayed){
  temporary=path.join(releases,'.staging-'+randomUUID());await fs.mkdir(temporary,{mode:0o755});await fs.chmod(temporary,0o755);
  for(const file of [...manifest.files,{path:'manifest.json',mode:'0644',size_bytes:String(manifestBytes.length)}]){
   const destination=path.join(temporary,file.path),directory=path.dirname(destination);
   await fs.mkdir(directory,{recursive:true,mode:0o755});
   let parent=temporary;for(const part of path.relative(temporary,directory).split(path.sep).filter(Boolean)){parent=path.join(parent,part);await fs.chmod(parent,0o755);}
   await copyFile(path.join(options.source,file.path),destination,parseInt(file.mode,8),BigInt(file.size_bytes));
  }
  await inspectPrebuiltRelease({...env,HYPERFIDE_RELEASE_ROOT:temporary},'manifest.json');
  await immutableTree(temporary);await syncTree(temporary);await fs.rename(temporary,target);temporary=null;await syncDirectory(releases);
 }
 await protectedPath(target,true);await immutableTree(target);
 const installed=await inspectPrebuiltRelease({...env,HYPERFIDE_RELEASE_ROOT:target},'manifest.json');
 if(installed.manifest_digest!==options.digest||installed.signature_status!=='VERIFIED')refuse('INSTALL_TARGET_CHANGED');
 const current=path.join(options.destination,'current');
 if(promote){
  try{const st=await fs.lstat(current);if(!st.isSymbolicLink()||st.uid!==0)refuse('INSTALL_CURRENT_CONFLICT');}catch(e){if(e.code!=='ENOENT')throw e;}
  const pending=path.join(options.destination,'.current-'+randomUUID());await fs.symlink(path.relative(options.destination,target),pending);
  try{await fs.rename(pending,current);pointerChanged=true;await syncDirectory(options.destination);}finally{await fs.unlink(pending).catch(()=>{});}
 }
 const receipt={schema_version:1,owner:'hyperfide-service-installer',manifest_digest:options.digest,release_directory:target,service_identity:{uid:options.uid,gid:options.gid},authentication:installed.authentication,promoted:promote,replayed,services_started:false,authority_activated:false,build_on_supervision_host:false};
 const receiptFile=path.join(options.destination,'.receipt-'+randomUUID());const h=await fs.open(receiptFile,'wx',0o600);try{await h.writeFile(JSON.stringify(receipt)+'\n');await h.sync();}finally{await h.close();}
 await fs.rename(receiptFile,path.join(options.destination,'service-installation.json'));await syncDirectory(options.destination);
 process.stdout.write(JSON.stringify({outcome:'SUCCEEDED',...receipt})+'\n');
}
try{await run();}catch(error){
 process.stdout.write(JSON.stringify({outcome:pointerChanged?'UNKNOWN':'REFUSED',error:{code:typeof error?.code==='string'?error.code:'INSTALL_FAILED'},services_started:false,authority_activated:false,automatic_replay:false})+'\n');process.exitCode=pointerChanged?75:78;
}finally{
 if(temporary)await fs.rm(temporary,{recursive:true,force:true}).catch(()=>{});
 if(lock)await fs.rmdir(lock).catch(()=>{});
}
