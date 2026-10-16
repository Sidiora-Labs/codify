import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {createReadStream} from 'node:fs';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {identityTransaction,invocationOf} from '../identity/enrollment.js';
const actions=['release.inspect','release.compatibility','release.plan'] as const;
function fail(message:string):never{throw new FoundationError('RELEASE_INVALID',message);}
function exact(v:unknown,keys:string[]):Record<string,unknown>{if(!object(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!(k in v)))fail('Unexpected release fields');return v;}
function version(v:unknown):number{if(!Number.isSafeInteger(v)||Number(v)<1)fail('Positive protocol version required');return Number(v);}
async function file(root:string,relative:unknown):Promise<string>{
 if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(x=>!x||x==='.'||x==='..'))fail('Unsafe release path');
 let current=root;for(const part of relative.split('/')){current=path.join(current,part);const info=await fs.lstat(current);if(info.isSymbolicLink())fail('Symlink release input');}
 if(!(await fs.stat(current)).isFile())fail('Missing regular release input');return current;
}
async function checksum(name:string):Promise<string>{const h=createHash('sha256');for await(const chunk of createReadStream(name))h.update(chunk);return 'sha256:'+h.digest('hex');}
function compatibility(raw:unknown):unknown{
 const v=exact(raw,['service_protocol','client_protocol','runner_protocol','schema_version','schema_min','schema_max','phase','old_clients']);
 const service=version(v.service_protocol),client=version(v.client_protocol),runner=version(v.runner_protocol),schema=version(v.schema_version),min=version(v.schema_min),max=version(v.schema_max);
 if(min>max||!['EXPAND','SERVICES','CONTRACT'].includes(String(v.phase))||typeof v.old_clients!=='number'||!Number.isSafeInteger(v.old_clients)||v.old_clients<0)fail('Invalid upgrade compatibility');
 const reasons:string[]=[];
 if(client!==service)reasons.push('CLIENT_PROTOCOL_UNSUPPORTED');
 if(runner!==service)reasons.push('RUNNER_PROTOCOL_UNSUPPORTED');
 if(schema<min||schema>max)reasons.push('SCHEMA_UNSUPPORTED');
 if(v.phase==='CONTRACT'&&v.old_clients!==0)reasons.push('OLD_CLIENTS_STILL_ACTIVE');
 return {compatible:reasons.length===0,reasons,authority:'NONE',deployment_authorized:false};
}
async function execute(ctx:ComponentContext,action:typeof actions[number],raw:unknown):Promise<unknown>{
 if(ctx.signal.aborted)fail('Release component is stopping');
 if(action==='release.compatibility')return compatibility(raw);
 if(action==='release.plan'){
 const v=exact(raw,['compatibility','release_digest']);if(typeof v.release_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(v.release_digest))fail('Pinned release digest required');
 const c=compatibility(v.compatibility) as {compatible:boolean;reasons:string[]};
 return {...c,release_digest:v.release_digest,steps:c.compatible?['VERIFY_PREBUILT_ARTIFACTS','EXPAND_SCHEMA','DRAIN_DISPATCH','INSTALL_CONTROL','INSTALL_PROVISIONER','INSTALL_DISPATCH','UPDATE_RUNNERS','CANARY','RECONCILE_OLD_CLIENTS','CONTRACT_SCHEMA']:[],build_on_supervision_host:false};
 }
 const v=exact(raw,['manifest']);return inspectPrebuiltRelease(ctx.env,v.manifest);
 }

async function trustedDetached(filename:string,limit:number):Promise<Buffer>{
 try{
 if(!path.isAbsolute(filename)||await fs.realpath(filename)!==filename)fail('Detached authentication input must be a canonical absolute file');
 const st=await fs.lstat(filename),owner=process.getuid?.();
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<1||st.size>limit||(st.mode&0o022)!==0||st.uid!==0&&st.uid!==owner)fail('Detached authentication input is not protected trusted material');
 return await fs.readFile(filename);
 }catch{fail('Detached release authentication material is unavailable or unsafe');}
}
async function authenticateManifest(env:Readonly<NodeJS.ProcessEnv>,root:string,bytes:Buffer):Promise<{mode:'UNAUTHENTICATED'}|{mode:'ED25519';key_fingerprint:string;signature_digest:string}>{
 const keyPath=env.HYPERFIDE_TRUSTED_RELEASE_KEY_FILE,signaturePath=env.HYPERFIDE_RELEASE_SIGNATURE_FILE;
 if(!keyPath&&!signaturePath)return {mode:'UNAUTHENTICATED'};
 if(!keyPath||!signaturePath)fail('Both the trusted release key and detached signature must be configured');
 if(signaturePath===root||signaturePath.startsWith(root+'/'))fail('Detached signature must be outside the immutable release inventory');
 const keyBytes=await trustedDetached(keyPath,16384),signature=await trustedDetached(signaturePath,64);
 if(signature.length!==64)fail('Ed25519 detached signature must contain exactly64 raw bytes');
 try{
 const key=createPublicKey(keyBytes),der=key.export({format:'der',type:'spki'});
 if(key.asymmetricKeyType!=='ed25519'||der.length!==44||der.subarray(0,12).toString('hex')!=='302a300506032b6570032100'||!verify(null,bytes,key,signature))fail('Prebuilt manifest signature is invalid');
 return {mode:'ED25519',key_fingerprint:'sha256:'+createHash('sha256').update(der).digest('hex'),signature_digest:'sha256:'+createHash('sha256').update(signature).digest('hex')};
 }catch{fail('Prebuilt manifest signature is invalid');}
}
/** Byte verification is separately reusable by a trusted operator installer.
 * Only configured detached Ed25519 trust material authenticates provenance;
 * request hashes or an installation receipt cannot establish authentication. */
export async function inspectPrebuiltRelease(env:Readonly<NodeJS.ProcessEnv>,relativeManifest:unknown):Promise<unknown>{
 const root=env.HYPERFIDE_RELEASE_ROOT;if(!root||!path.isAbsolute(root))fail('Trusted prebuilt release root required');
 const rootInfo=await fs.lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||await fs.realpath(root)!==root)fail('Release root must be a real directory');
 const filename=await file(root,relativeManifest);const info=await fs.stat(filename);if(info.size>1024*1024)fail('Oversized release manifest');
 const manifestBytes=await fs.readFile(filename),manifestDigest='sha256:'+createHash('sha256').update(manifestBytes).digest('hex');
 const authentication=await authenticateManifest(env,root,manifestBytes);
 const manifest=exact(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)),['schema_version','release_version','source_commit','source_date_epoch','protocol_version','schema_min','schema_max','runtime','files']);
 if(manifest.schema_version!==1||typeof manifest.release_version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(manifest.release_version)||typeof manifest.source_commit!=='string'||!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(manifest.source_commit)||typeof manifest.source_date_epoch!=='string'||!/^(0|[1-9][0-9]*)$/.test(manifest.source_date_epoch))fail('Invalid immutable release provenance');
 version(manifest.protocol_version);const min=version(manifest.schema_min),max=version(manifest.schema_max);if(min>max)fail('Inverted schema range');
 const runtime=exact(manifest.runtime,['node','npm','python','platform','architecture']);if(runtime.node!=='24.22.0'||runtime.npm!=='11.19.1'||runtime.python!=='3.14.8'||runtime.platform!=='linux'||runtime.architecture!=='x64')fail('Unqualified release runtime');
 if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>100000)fail('Invalid release file inventory');
 const names=new Set<string>();
 for(const item of manifest.files){
 const f=exact(item,['path','digest','size_bytes','mode']);
 if(typeof f.path!=='string'||names.has(f.path)||typeof f.digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(f.digest)||typeof f.size_bytes!=='string'||!/^(0|[1-9][0-9]*)$/.test(f.size_bytes)||!['0644','0755'].includes(String(f.mode)))fail('Invalid release file pin');
 names.add(f.path);const p=await file(root,f.path),st=await fs.stat(p);
 if(BigInt(st.size)!==BigInt(f.size_bytes)||await checksum(p)!==f.digest||(st.mode&0o777)!==parseInt(String(f.mode),8))fail('Prebuilt release file does not match its immutable pin');
 }
 for(const required of ['bin/hyperfide','bin/cg','bin/hyperfide-native','runtime/node','runtime/python/bin/python3','runtime/python/bin/python3.bin','runtime/python/lib/python3.14/ctypes/__init__.py','services/package.json','services/dist/control.js','services/dist/provisioner.js','services/dist/dispatch.js','services/package-lock.json'])if(!names.has(required))fail('Release lacks a required executable or dependency lock');
 const entries=manifest.files as Record<string,unknown>[];
 if(entries.find(f=>f.path==='bin/hyperfide')!.digest!==entries.find(f=>f.path==='bin/cg')!.digest)fail('Compatibility CLI differs from the canonical executable');
 if(!entries.some(f=>String(f.path).startsWith('lib/hyperfide/'))||!entries.some(f=>String(f.path).startsWith('services/node_modules/')))fail('Prebuilt runtime libraries and production dependencies are required');
 async function audit(directory:string):Promise<void>{
 for(const item of await fs.readdir(directory,{withFileTypes:true})){
 const p=path.join(directory,item.name),relative=path.relative(root!,p).split(path.sep).join('/');
 if(p===filename)continue;
 if(item.isSymbolicLink()||!item.isDirectory()&&!item.isFile())fail('Unexpected release entry');
 if(item.isDirectory())await audit(p);else if(!names.has(relative))fail('Unpinned file in release payload');
 }
 }
 await audit(root);
 if(await checksum(filename)!==manifestDigest)fail('Release manifest changed during inspection');
 return {verified:true,manifest_digest:manifestDigest,release_version:manifest.release_version,source_commit:manifest.source_commit,files:names.size,build_on_supervision_host:false,signature_status:authentication.mode==='ED25519'?'VERIFIED':'UNVERIFIED',authentication,deployment_authorized:false};
 }
export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,actions:Object.fromEntries(actions.map(action=>[action,async(raw:unknown,ctx:ComponentContext)=>{
 const i=invocationOf(ctx);
 if(i.payload.component!=='25.4'||i.payload.action!==action||i.payload.run_id!==i.principal.run_id||!['OPERATOR','LEADER','COORDINATOR'].includes(i.principal.role))throw new FoundationError('AUTH_FORBIDDEN','Authenticated release supervisor required');
 await identityTransaction(ctx,async()=>{});
 const result=await execute(ctx,action,raw);
 return identityTransaction(ctx,async()=>result);
 }]))};}
