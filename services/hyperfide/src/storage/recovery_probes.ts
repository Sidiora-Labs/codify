import {createHash,generateKeyPairSync,randomUUID,sign,verify} from 'node:crypto';
import type {KeyObject} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {Writable} from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {FoundationError,object} from '../policy/programme.js';
import type {ServiceResources} from './runtime.js';

interface ProbeInput {
 scenario:string;organisation_id:string;run_id:string;operation_id:string;source_epoch:string;signal:AbortSignal;
}
interface Artifact {path:string;sha256:string;size:number}
export interface DrillReconciliation {
 scope:string;mechanism:string;
 stale_workers:{presented:number;fenced:number;current_accepted:boolean};
 external_effects:{outstanding:number;adopted:number;orphans_removed:number;unresolved:number};
}
export interface DrillProbeResult {
 status:'RECOVERED'|'FAILED'|'UNKNOWN';source_epoch:string;recovery_epoch:string|null;
 acknowledged_ids:readonly string[];recovered_ids:readonly string[];evidence_digest:string;limits:string;
 scope:string;artifacts:readonly Artifact[];started_at:string;completed_at:string;
 cleanup:{complete:boolean;root_absent:boolean;processes_absent:boolean};reconciliation:DrillReconciliation|null;
}
export interface PostgresDrillResult extends DrillProbeResult {scope:'ISOLATED_POSTGRESQL_FIXTURE'}
interface Profile {schema_version:1;scope:'ISOLATED_POSTGRESQL_FIXTURE';python_path:string;producer_path:string;producer_sha256:string;evidence_directory:string;timeout_ms:number}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const PYTHON_BOOTSTRAP="import os,sys,hashlib; source=os.fdopen(3,'rb').read(1048577); assert len(source)<=1048576 and hashlib.sha256(source).hexdigest()==sys.argv[2], 'Trusted producer byte mismatch'; exec(compile(source,sys.argv[1],'exec'), {'__name__':'__main__','__file__':sys.argv[1]})";
async function checkedPath(value:unknown,directory=false,privateMode=false):Promise<string>{
 if(typeof value!=='string'||!path.isAbsolute(value)||path.normalize(value)!==value)
  throw new FoundationError('DRILL_PROFILE_INVALID','Trusted probe paths must be canonical and absolute');
 const info=await fs.lstat(value);
 if(info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile())||(info.mode&0o022)!==0||
    (privateMode&&((info.mode&0o077)!==0||info.uid!==process.getuid?.())))
  throw new FoundationError('DRILL_PROFILE_INVALID','Trusted probe paths require protected regular ownership');
 if(await fs.realpath(value)!==value)throw new FoundationError('DRILL_PROFILE_INVALID','Trusted probe paths cannot contain symlinks');
 return value;
}
async function loadProfile(env:Readonly<NodeJS.ProcessEnv>):Promise<Profile>{
 const configured=env.HYPERFIDE_RECOVERY_PROBE_PROFILE;
 if(!configured)throw new FoundationError('DRILL_PROBE_NOT_CONFIGURED','An explicit protected isolated PostgreSQL probe profile is required');
 await checkedPath(path.dirname(configured),true,true);await checkedPath(configured,false,true);
 const bytes=await fs.readFile(configured);if(bytes.length>16384)throw new FoundationError('DRILL_PROFILE_INVALID','Probe profile exceeds its bounded size');
 const raw:unknown=JSON.parse(bytes.toString('utf8'));
 const keys=['schema_version','scope','python_path','producer_path','producer_sha256','evidence_directory','timeout_ms'];
 if(!object(raw)||Object.keys(raw).length!==keys.length||Object.keys(raw).some(k=>!keys.includes(k))||
    raw.schema_version!==1||raw.scope!=='ISOLATED_POSTGRESQL_FIXTURE'||typeof raw.producer_sha256!=='string'||!SHA.test(raw.producer_sha256)||
    !Number.isSafeInteger(raw.timeout_ms)||Number(raw.timeout_ms)<1000||Number(raw.timeout_ms)>300000)
  throw new FoundationError('DRILL_PROFILE_INVALID','Explicit bounded isolated PostgreSQL profile is required');
 await checkedPath(raw.python_path);await checkedPath(raw.producer_path);await checkedPath(raw.evidence_directory,true,true);
 const producer=await fs.readFile(String(raw.producer_path));
 if(producer.length>1048576||createHash('sha256').update(producer).digest('hex')!==raw.producer_sha256)
  throw new FoundationError('DRILL_PROFILE_INVALID','Probe source must match its trusted exact checksum');
 return Object.freeze(raw) as unknown as Profile;
}
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=100000;
/** Strictly copies producer reconciliation evidence; anything malformed is treated as missing evidence. */
export function reconciliationOf(value:unknown):DrillReconciliation|null{
 if(value===null||value===undefined)return null;
 const workers=object(value)?value.stale_workers:undefined,effects=object(value)?value.external_effects:undefined;
 if(!object(value)||typeof value.scope!=='string'||value.scope.length>128||typeof value.mechanism!=='string'||value.mechanism.length>512||!object(workers)||!object(effects)||
    !count(workers.presented)||!count(workers.fenced)||workers.fenced>workers.presented||typeof workers.current_accepted!=='boolean'||
    !count(effects.outstanding)||!count(effects.adopted)||!count(effects.orphans_removed)||!count(effects.unresolved))
  throw new FoundationError('DRILL_EVIDENCE_INVALID','Reconciliation evidence has an invalid bounded shape');
 return {scope:value.scope,mechanism:value.mechanism,stale_workers:{presented:workers.presented,fenced:workers.fenced,current_accepted:workers.current_accepted},
  external_effects:{outstanding:effects.outstanding,adopted:effects.adopted,orphans_removed:effects.orphans_removed,unresolved:effects.unresolved}};
}
// This explicit operator fixture runs owned, disposable databases. It never targets the service authority pool.
// The protected profile is re-validated on every execution so removal or tampering refuses before disruption.
export function createPostgresRecoveryProbe(_resources:ServiceResources,env:Readonly<NodeJS.ProcessEnv>){
 return Object.freeze({execute:async(input:ProbeInput):Promise<PostgresDrillResult>=>{
  if(!['DATABASE','RESTORE'].includes(input.scenario))throw new FoundationError('DRILL_SCENARIO_UNSUPPORTED','This producer supports only isolated PostgreSQL DATABASE and RESTORE drills');
  for(const key of ['organisation_id','run_id','operation_id','source_epoch'] as const)
   if(!UUID.test(input[key]))throw new FoundationError('DRILL_INPUT_INVALID','Canonical scope identities are required');
  if(input.signal.aborted)throw new FoundationError('DRILL_ABORTED','Probe was cancelled before execution');
  const profile=await loadProfile(env);
  if(input.signal.aborted)throw new FoundationError('DRILL_ABORTED','Probe was cancelled before execution');
  await checkedPath(profile.producer_path);
  const currentSource=await fs.readFile(profile.producer_path);
  if(currentSource.length>1048576||createHash('sha256').update(currentSource).digest('hex')!==profile.producer_sha256)
   throw new FoundationError('DRILL_PROFILE_INVALID','Probe source changed after trusted configuration');
  const directory=path.join(profile.evidence_directory,input.operation_id);
  try{await fs.mkdir(directory,{mode:0o700});}
  catch(error){throw new FoundationError('DRILL_ALREADY_STARTED','Existing operation evidence requires reconciliation; disruptive probes are never automatically replayed');}
  const payload={schema_version:1,scope:profile.scope,scenario:input.scenario,organisation_id:input.organisation_id,run_id:input.run_id,operation_id:input.operation_id,source_epoch:input.source_epoch,evidence_directory:directory};
  await fs.writeFile(path.join(directory,'intent.json'),JSON.stringify(payload)+'\n',{mode:0o600,flag:'wx'});
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(profile.python_path,['-c',PYTHON_BOOTSTRAP,profile.producer_path,profile.producer_sha256],{stdio:['pipe','pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C.UTF-8',HYPERFIDE_PROBE_NODE:process.execPath}});
   let out=0,err=0,aborted=false,force:ReturnType<typeof setTimeout>|undefined;
   const abort=()=>{if(aborted)return;aborted=true;child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),10000);force.unref();};
   const timer=setTimeout(abort,profile.timeout_ms);timer.unref();input.signal.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',(bytes:Buffer)=>{out+=bytes.length;if(out>65536)abort();});
   child.stderr.on('data',(bytes:Buffer)=>{err+=bytes.length;if(err>65536)abort();});
   child.on('error',reject);
   child.on('close',(code)=>{clearTimeout(timer);if(force)clearTimeout(force);input.signal.removeEventListener('abort',abort);
    if(aborted)reject(new FoundationError('DRILL_ABORTED','Probe cancelled; retained operation evidence must reconcile before replay'));
    else if(code!==0)reject(new FoundationError('DRILL_OUTCOME_UNKNOWN','Probe did not return a complete checked result; inspect retained operation evidence'));
    else resolve();
   });
   const sourcePipe=child.stdio[3] as Writable;sourcePipe.on('error',()=>{});sourcePipe.end(currentSource);
   child.stdin.on('error',()=>{});if(input.signal.aborted)abort();else child.stdin.end(JSON.stringify(payload));
  });
  const resultFile=path.join(directory,'result.json');await checkedPath(resultFile,false,true);
  const bytes=await fs.readFile(resultFile);if(bytes.length>1048576)throw new FoundationError('DRILL_EVIDENCE_INVALID','Probe response exceeds bounded size');
  const result:unknown=JSON.parse(bytes.toString('utf8'));
  if(!object(result)||result.scope!==profile.scope||result.source_epoch!==input.source_epoch||
     !['RECOVERED','FAILED','UNKNOWN'].includes(String(result.status))||!Array.isArray(result.artifacts)||
     !object(result.cleanup)||result.cleanup.complete!==true||result.cleanup.root_absent!==true||result.cleanup.processes_absent!==true||
     typeof result.evidence_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(result.evidence_digest))
   throw new FoundationError('DRILL_EVIDENCE_INVALID','Complete scoped evidence and independently observed cleanup are required');
  for(const artifact of result.artifacts){
   if(!object(artifact)||typeof artifact.path!=='string'||path.basename(artifact.path)!==artifact.path||!SHA.test(String(artifact.sha256))||!Number.isSafeInteger(artifact.size))
    throw new FoundationError('DRILL_EVIDENCE_INVALID','Artifact manifest has invalid bounded references');
   const file=path.join(directory,artifact.path);await checkedPath(file,false,true);const data=await fs.readFile(file);
   if(data.length!==artifact.size||createHash('sha256').update(data).digest('hex')!==artifact.sha256)
    throw new FoundationError('DRILL_EVIDENCE_INVALID','Retained artifact bytes differ from the manifest');
  }
  const manifest=await fs.readFile(path.join(directory,'evidence.json'));
  if('sha256:'+createHash('sha256').update(manifest).digest('hex')!==result.evidence_digest)
   throw new FoundationError('DRILL_EVIDENCE_INVALID','Evidence digest does not match retained byte manifest');
  return {...result,reconciliation:reconciliationOf(result.reconciliation)} as unknown as PostgresDrillResult;
 }});
}

// Local operator fixtures for the non-PostgreSQL recovery scenarios. Each producer owns a private temporary
// root, retains byte-pinned evidence and proves cleanup; none contacts a cloud provider or shared service state.
type LocalScenario='OBJECT'|'GIT'|'AUTH'|'FULL_DISK'|'PROVIDER';
export const LOCAL_DRILL_SCOPES:Readonly<Record<LocalScenario,string>>=Object.freeze({
 OBJECT:'LOCAL_OBJECT_STORE_FIXTURE',GIT:'LOCAL_BARE_GIT_FIXTURE',AUTH:'LOCAL_CREDENTIAL_FIXTURE',FULL_DISK:'LOCAL_TMPFS_QUOTA_FIXTURE',PROVIDER:'PROVIDER_FAKE_LOOPBACK'
});
const LOCAL_LIMITS:Readonly<Record<LocalScenario,string>>=Object.freeze({
 OBJECT:'LOCAL_OBJECT_STORE_FIXTURE: content-addressed files on one VM; no remote object-store durability or cross-region replica qualification. RPO is acknowledged object identity loss, not an inferred temporal guarantee.',
 GIT:'LOCAL_BARE_GIT_FIXTURE: local bare repository restored from a verified bundle; no hosted Git provider, network partition or credential qualification. RPO is acknowledged ref identity loss.',
 AUTH:'LOCAL_CREDENTIAL_FIXTURE: Ed25519 credential expiry and key-epoch rotation in an owned trust store; external identity provider expiry is not exercised. RPO is acknowledged operation identity loss.',
 FULL_DISK:'LOCAL_TMPFS_QUOTA_FIXTURE: bounded 1MiB tmpfs quota on one VM; production volume, inode exhaustion and host journal loss are unqualified. RPO is acknowledged record identity loss.',
 PROVIDER:'PROVIDER_FAKE_LOOPBACK: loopback provider fake only. Live Railway/Blaxel rehearsal is BLOCKED pending provider credentials and programme approval. RPO is acknowledged create-intent identity loss.'
});
interface Cleanup {complete:boolean;root_absent:boolean;processes_absent:boolean}
interface LocalOutcome {status:'RECOVERED'|'FAILED';recovery_epoch:string|null;acknowledged_ids:string[];recovered_ids:string[];reconciliation:DrillReconciliation|null;limits?:string}
interface LocalContext {root:string;input:ProbeInput;save(name:string,value:unknown):Promise<void>;defer(step:()=>Promise<boolean>):void}
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const SAFE_ENV={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C.UTF-8'};
function run(file:string,args:string[],options:{cwd?:string;input?:string|undefined;env?:NodeJS.ProcessEnv}={}):Promise<{code:number|null;stdout:string;stderr:string}>{
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{cwd:options.cwd,env:options.env??SAFE_ENV,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),30000);timer.unref();
  child.stdout.on('data',(b:Buffer)=>{if(stdout.length<1048576)stdout+=b.toString('utf8');});
  child.stderr.on('data',(b:Buffer)=>{if(stderr.length<65536)stderr+=b.toString('utf8');});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr:stderr.slice(0,4096)});});
  child.stdin.on('error',()=>{});child.stdin.end(options.input??'');
 });
}
function must(condition:unknown,message:string):asserts condition{if(!condition)throw new FoundationError('DRILL_FIXTURE_FAILED',message);}
async function absent(file:string):Promise<boolean>{try{await fs.lstat(file);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ENOENT';}}
async function durable(file:string,bytes:Buffer|string,flag='wx'):Promise<void>{
 const handle=await fs.open(file,flag,0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
/** Single-writer epoch fence: admission compares the presented epoch with the current durable fence value. */
class EpochFence {
 constructor(private readonly file:string){}
 async init(epoch:string):Promise<void>{await durable(this.file,epoch);}
 async current():Promise<string>{return (await fs.readFile(this.file,'utf8')).trim();}
 async rotate(expected:string,next:string):Promise<void>{
  must(await this.current()===expected,'Fence rotation expected epoch differs');
  await durable(this.file+'.next',next);await fs.rename(this.file+'.next',this.file);
 }
 async admit(epoch:string):Promise<boolean>{return await this.current()===epoch;}
}
async function staleWorkers(fence:EpochFence,stale:string[],current:string,write:(epoch:string)=>Promise<void>){
 const observations:{epoch:string;accepted:boolean}[]=[];
 for(const epoch of [...stale,current]){const accepted=await fence.admit(epoch);if(accepted)await write(epoch);observations.push({epoch,accepted});}
 const prior=observations.slice(0,-1);
 return {presented:prior.length,fenced:prior.filter(item=>!item.accepted).length,current_accepted:observations.at(-1)!.accepted,observations};
}
function reconciliation(scenario:LocalScenario,mechanism:string,workers:{presented:number;fenced:number;current_accepted:boolean},effects:DrillReconciliation['external_effects']):DrillReconciliation{
 return {scope:LOCAL_DRILL_SCOPES[scenario],mechanism,stale_workers:{presented:workers.presented,fenced:workers.fenced,current_accepted:workers.current_accepted},external_effects:effects};
}

async function objectDrill(ctx:LocalContext):Promise<LocalOutcome>{
 const store=path.join(ctx.root,'objects'),replica=path.join(ctx.root,'replica'),quarantine=path.join(ctx.root,'quarantine');
 for(const directory of [store,replica,quarantine])await fs.mkdir(directory,{mode:0o700});
 const fence=new EpochFence(path.join(ctx.root,'store-epoch')),pre=randomUUID();await fence.init(pre);
 const put=async(directory:string,bytes:Buffer)=>{const id=sha(bytes);await durable(path.join(directory,id),bytes);return id;};
 const index:Record<string,'COMMITTED'|'PENDING'>={},acknowledged:string[]=[];
 for(let item=0;item<8;item++){const id=await put(store,Buffer.from(('artifact:'+ctx.input.operation_id+':'+item+'\n').repeat(64)));index[id]='COMMITTED';acknowledged.push(id);}
 for(const id of acknowledged){await fs.copyFile(path.join(store,id),path.join(replica,id));must(sha(await fs.readFile(path.join(replica,id)))===id,'Replica copy differs');}
 // The upload landed but its acknowledgement was lost; a stale writer also left an unindexed object.
 const pending=await put(store,Buffer.from('pending-upload:'+ctx.input.operation_id));index[pending]='PENDING';
 const orphan=await put(store,Buffer.from('stale-writer-orphan:'+ctx.input.operation_id));
 await ctx.save('index-snapshot.json',{index,replica:acknowledged});
 await fs.writeFile(path.join(store,acknowledged[0]!),'corrupted payload bytes');
 await fs.rm(path.join(store,acknowledged[1]!));
 const scan=async()=>{
  const corrupt:string[]=[],missing:string[]=[];
  for(const id of Object.keys(index)){
   try{if(sha(await fs.readFile(path.join(store,id)))!==id)corrupt.push(id);}
   catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')missing.push(id);else throw error;}
  }
  return {corrupt,missing,unindexed:(await fs.readdir(store)).filter(id=>!Object.hasOwn(index,id))};
 };
 const detected=await scan();await ctx.save('detection.json',detected);
 must(detected.corrupt.length===1&&detected.corrupt[0]===acknowledged[0]&&detected.missing.length===1&&detected.missing[0]===acknowledged[1],'Corruption and snapshot inconsistency were not both detected');
 for(const id of detected.corrupt)await fs.rename(path.join(store,id),path.join(quarantine,id));
 const recoveryEpoch=randomUUID();await fence.rotate(pre,recoveryEpoch);
 for(const id of [...detected.corrupt,...detected.missing]){
  const bytes=await fs.readFile(path.join(replica,id));must(sha(bytes)===id,'Replica object failed verification');await put(store,bytes);
 }
 const adopted:string[]=[],orphans:string[]=[];
 if(sha(await fs.readFile(path.join(store,pending)))===pending){index[pending]='COMMITTED';adopted.push(pending);}
 for(const id of detected.unindexed){await fs.rm(path.join(store,id));orphans.push(id);}
 must(orphans.includes(orphan),'Unindexed stale object was not identified');
 const after=await scan();
 const recovered:string[]=[];for(const id of acknowledged)if(!after.corrupt.includes(id)&&!after.missing.includes(id))recovered.push(id);
 const workers=await staleWorkers(fence,[pre],recoveryEpoch,async epoch=>{await put(store,Buffer.from('worker-result:'+epoch));});
 const unresolved=after.corrupt.length+after.missing.length+after.unindexed.length-orphans.length+Object.values(index).filter(v=>v==='PENDING').length;
 const value=reconciliation('OBJECT','Durable object-store epoch fence; digest scan against index snapshot and verified replica',workers,{outstanding:1+orphans.length,adopted:adopted.length,orphans_removed:orphans.length,unresolved:Math.max(0,unresolved)});
 await ctx.save('reconciliation.json',{...value,after,adopted,orphans,observations:workers.observations});
 return {status:'RECOVERED',recovery_epoch:recoveryEpoch,acknowledged_ids:acknowledged,recovered_ids:recovered,reconciliation:value};
}

async function gitDrill(ctx:LocalContext):Promise<LocalOutcome>{
 const env={...SAFE_ENV,HOME:ctx.root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  // Detached auto-maintenance would outlive the drill; hooks never run in the owned fixture.
  GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_0:'gc.auto',GIT_CONFIG_VALUE_0:'0',GIT_CONFIG_KEY_1:'maintenance.auto',GIT_CONFIG_VALUE_1:'false',GIT_CONFIG_KEY_2:'core.hooksPath',GIT_CONFIG_VALUE_2:'/dev/null',
  GIT_AUTHOR_NAME:'hyperfide-drill',GIT_AUTHOR_EMAIL:'drill@hyperfide.invalid',GIT_COMMITTER_NAME:'hyperfide-drill',GIT_COMMITTER_EMAIL:'drill@hyperfide.invalid'};
 const log:unknown[]=[];
 const git=async(cwd:string,args:string[],input?:string,allow=false)=>{const result=await run('/usr/bin/git',args,{cwd,env,input});log.push({args,code:result.code,stderr:result.stderr.slice(0,512)});if(!allow)must(result.code===0,'git '+args[0]+' failed: '+result.stderr.slice(0,200));return result;};
 const origin=path.join(ctx.root,'origin.git');
 await git(ctx.root,['init','-q','--bare','--initial-branch=main',origin]);
 const tree=(await git(origin,['mktree'],'')).stdout.trim();
 const commit=async(cwd:string,message:string,parent?:string)=>(await git(cwd,['commit-tree',tree,...(parent?['-p',parent]:[]),'-m',message])).stdout.trim();
 const blob=async(cwd:string,value:string)=>(await git(cwd,['hash-object','-w','--stdin'],value)).stdout.trim();
 const c1=await commit(origin,'one'),c2=await commit(origin,'two',c1);
 await git(origin,['update-ref','refs/heads/main',c2]);await git(origin,['update-ref','refs/tags/v1',c1]);
 const fence=new EpochFence(path.join(ctx.root,'git-epoch')),pre=randomUUID();await fence.init(pre);
 const preBlob=await blob(origin,pre);await git(origin,['update-ref','refs/hyperfide/epoch',preBlob]);
 const refs=async(cwd:string)=>(await git(cwd,['for-each-ref','--format=%(refname)@%(objectname)','refs/heads','refs/tags'])).stdout.trim().split('\n').filter(Boolean);
 const acknowledged=await refs(origin);
 const backup=path.join(ctx.root,'backup.bundle');
 await git(origin,['bundle','create','-q',backup,'refs/heads/main','refs/tags/v1']);await git(origin,['bundle','verify','-q',backup]);
 // A push acknowledged by Git after the recovery point; the worker keeps a custody bundle but the ack was not recorded.
 const c3=await commit(origin,'feature',c2);await git(origin,['update-ref','refs/heads/feature',c3]);
 const custody=path.join(ctx.root,'custody.bundle');await git(origin,['bundle','create','-q',custody,'refs/heads/feature']);
 const intents=[{ref:'refs/heads/feature',commit:c3,state:'PENDING'}];
 await fs.rm(origin,{recursive:true});
 // rev-parse observes the loss in-process; ls-remote would leave an unreaped upload-pack shell behind.
 const unavailable=await git(ctx.root,['--git-dir='+origin,'rev-parse','--verify','refs/heads/main'],undefined,true);
 must(unavailable.code!==0,'Lost repository remained reachable');
 await ctx.save('unavailability.json',{repository:'origin.git',rev_parse_exit:unavailable.code,stderr:unavailable.stderr.slice(0,512)});
 await git(ctx.root,['clone','-q','--bare',backup,origin]);
 await git(origin,['fsck','--full','--strict']);
 const recoveryEpoch=randomUUID();await fence.rotate(pre,recoveryEpoch);
 const recoveryBlob=await blob(origin,recoveryEpoch);
 await git(origin,['update-ref','refs/hyperfide/epoch',recoveryBlob,'0'.repeat(40)]);
 const restored=await refs(origin);await ctx.save('restored-refs.json',{acknowledged,restored});
 const adopted:string[]=[];
 for(const intent of intents){
  const present=await git(origin,['rev-parse','--verify','-q',intent.ref],undefined,true);
  if(present.code!==0){await git(origin,['fetch','-q',custody,intent.ref+':'+intent.ref]);}
  if((await git(origin,['rev-parse','--verify','-q',intent.ref])).stdout.trim()===intent.commit){intent.state='RECONCILED';adopted.push(intent.ref);}
 }
 const known=new Set([...acknowledged.map(item=>item.split('@')[0]),...intents.map(item=>item.ref)]);
 const unknown=(await refs(origin)).filter(item=>!known.has(item.split('@')[0]!));
 const head=(await git(origin,['rev-parse','refs/heads/main'])).stdout.trim();
 // Git ref transactions verify the epoch ref atomically with the result update, like a fenced worker push.
 const update=async(epochBlob:string)=>{
  const next=await commit(origin,'worker-result',head);
  return (await git(origin,['update-ref','--stdin'],'start\nverify refs/hyperfide/epoch '+epochBlob+'\nupdate refs/heads/worker '+next+'\nprepare\ncommit\n',true)).code===0;
 };
 const staleAccepted=await update(preBlob),currentAccepted=await update(recoveryBlob);
 const workers={presented:1,fenced:staleAccepted?0:1,current_accepted:currentAccepted};
 const value=reconciliation('GIT','Atomic Git ref transaction verifying refs/hyperfide/epoch; custody bundle re-drive of unacknowledged push',workers,{outstanding:intents.length,adopted:adopted.length,orphans_removed:0,unresolved:intents.filter(item=>item.state!=='RECONCILED').length+unknown.length});
 await ctx.save('reconciliation.json',{...value,intents,unknown});await ctx.save('git-commands.json',log);
 return {status:'RECOVERED',recovery_epoch:recoveryEpoch,acknowledged_ids:acknowledged,recovered_ids:acknowledged.filter(item=>restored.includes(item)),reconciliation:value};
}

async function authDrill(ctx:LocalContext):Promise<LocalOutcome>{
 const pre=randomUUID(),recoveryEpoch=randomUUID();
 const first=generateKeyPairSync('ed25519'),second=generateKeyPairSync('ed25519');
 let trust={epoch:pre,key:first.publicKey};const revoked=new Set<string>();
 const issue=(key:KeyObject,epoch:string,ttl:number)=>{
  const payload=Buffer.from(JSON.stringify({credential_id:'drill-worker',epoch,expires_at:Date.now()+ttl}));
  return payload.toString('base64url')+'.'+sign(null,payload,key).toString('base64url');
 };
 const check=(token:string):string=>{
  const [body,signature]=token.split('.');const payload=Buffer.from(body!,'base64url'),claims=JSON.parse(payload.toString('utf8'));
  if(revoked.has(claims.epoch)||claims.epoch!==trust.epoch)return 'CREDENTIAL_EPOCH_REVOKED';
  if(!verify(null,payload,trust.key,Buffer.from(signature!,'base64url')))return 'CREDENTIAL_SIGNATURE_INVALID';
  return Date.now()>=claims.expires_at?'CREDENTIAL_EXPIRED':'VALID';
 };
 const journal=path.join(ctx.root,'operations.jsonl');await durable(journal,'');
 const accept=async(operation:string,token:string)=>{const verdict=check(token);if(verdict==='VALID')await durable(journal,JSON.stringify({operation})+'\n','a');return verdict;};
 const journalled=async()=>new Set((await fs.readFile(journal,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line).operation as string));
 const expiring=issue(first.privateKey,pre,400),acknowledged:string[]=[];
 for(let item=0;item<4;item++){const operation=randomUUID();must(await accept(operation,expiring)==='VALID','Fresh credential was refused');acknowledged.push(operation);}
 const uncertain=randomUUID();must(await accept(uncertain,expiring)==='VALID','Fresh credential was refused');
 await new Promise(resolve=>setTimeout(resolve,450));
 const refusedOperation=randomUUID(),expired=await accept(refusedOperation,expiring);
 must(expired==='CREDENTIAL_EXPIRED','Expired credential was not refused');
 await ctx.save('expiry.json',{credential_id:'drill-worker',epoch:pre,refusal:expired});
 revoked.add(pre);trust={epoch:recoveryEpoch,key:second.publicKey};
 const renewed=issue(second.privateKey,recoveryEpoch,60000);
 const adopted:string[]=[];const seen=await journalled();
 if(seen.has(uncertain))adopted.push(uncertain);
 if(!seen.has(refusedOperation)&&await accept(refusedOperation,renewed)==='VALID')adopted.push(refusedOperation);
 const staleTokens=[expiring,issue(first.privateKey,pre,60000)];
 const staleVerdicts=staleTokens.map(check),currentVerdict=check(renewed);
 const workers={presented:staleTokens.length,fenced:staleVerdicts.filter(v=>v!=='VALID').length,current_accepted:currentVerdict==='VALID'};
 const final=await journalled();
 const value=reconciliation('AUTH','Ed25519 trust-store key epoch rotation with revoked predecessor; durable operation journal lookup',workers,{outstanding:2,adopted:adopted.length,orphans_removed:0,unresolved:2-adopted.length});
 await ctx.save('reconciliation.json',{...value,stale_verdicts:staleVerdicts,current_verdict:currentVerdict});
 return {status:'RECOVERED',recovery_epoch:recoveryEpoch,acknowledged_ids:acknowledged,recovered_ids:acknowledged.filter(item=>final.has(item)),reconciliation:value};
}

async function fullDiskDrill(ctx:LocalContext):Promise<LocalOutcome>{
 const volume=path.join(ctx.root,'volume');await fs.mkdir(volume,{mode:0o700});
 const mounted=await run('/usr/bin/mount',['-t','tmpfs','-o','size=1m,mode=0700,nosuid,nodev,noexec','hf-drill-full-disk',volume]);
 if(mounted.code!==0){
  await ctx.save('mount-refusal.json',{exit:mounted.code,stderr:mounted.stderr.slice(0,512)});
  return {status:'FAILED',recovery_epoch:null,acknowledged_ids:[],recovered_ids:[],reconciliation:null,limits:'UNVERIFIED_PRIVILEGE: bounded tmpfs quota could not be mounted in this sandbox; FULL_DISK recovery was not exercised. '+mounted.stderr.slice(0,256)};
 }
 const mountinfo=async()=>(await fs.readFile('/proc/self/mountinfo','utf8')).split('\n').some(line=>line.split(' ')[4]===volume);
 ctx.defer(async()=>{const result=await run('/usr/bin/umount',[volume]);return result.code===0&&!await mountinfo();});
 must(await mountinfo(),'Bounded volume mount was not observed');
 const records=path.join(volume,'records');await fs.mkdir(records,{mode:0o700});
 const fence=new EpochFence(path.join(ctx.root,'volume-epoch')),pre=randomUUID();await fence.init(pre);
 const payload=(id:string)=>Buffer.from(('record:'+id+'\n').repeat(24));
 const write=async(id:string)=>{try{await durable(path.join(records,id),payload(id));return 'WRITTEN';}catch(error){if((error as NodeJS.ErrnoException).code==='ENOSPC')return 'ENOSPC';throw error;}};
 const acknowledged:string[]=[];
 for(let item=0;item<16;item++){const id=randomUUID();must(await write(id)==='WRITTEN','Bounded volume refused an early record');acknowledged.push(id);}
 const filler=path.join(volume,'reclaimable-filler');let filled=0;
 const handle=await fs.open(filler,'wx',0o600);
 try{for(;;){try{await handle.write(Buffer.alloc(65536,1));filled+=65536;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOSPC')break;throw error;}must(filled<8*1048576,'Bounded quota was not enforced');}
  for(let size=4096;size>=1;size>>=1){for(;;){try{await handle.write(Buffer.alloc(size,1));filled+=size;}catch{break;}}}}
 finally{await handle.close();}
 const outstanding=randomUUID(),refusal=await write(outstanding);
 must(refusal==='ENOSPC','Full volume did not refuse a new record');
 await ctx.save('exhaustion.json',{filled_bytes:filled,refusal,record:outstanding});
 const recoveryEpoch=randomUUID();await fence.rotate(pre,recoveryEpoch);
 // Partial bytes from the refused write are never acknowledged; remove them before reclaiming space.
 const partial=!await absent(path.join(records,outstanding));if(partial)await fs.rm(path.join(records,outstanding));
 await fs.rm(filler);
 const adopted:string[]=[];if(await write(outstanding)==='WRITTEN')adopted.push(outstanding);
 const intact=async(id:string)=>{try{return (await fs.readFile(path.join(records,id))).equals(payload(id));}catch{return false;}};
 const recovered:string[]=[];for(const id of acknowledged)if(await intact(id))recovered.push(id);
 const workers=await staleWorkers(fence,[pre],recoveryEpoch,async epoch=>{must(await write('worker-'+epoch)==='WRITTEN','Recovered volume refused current worker');});
 const value=reconciliation('FULL_DISK','Durable volume epoch fence; partial refused write removed before reclaim and idempotent retry',workers,{outstanding:1,adopted:adopted.length,orphans_removed:partial?1:0,unresolved:1-adopted.length});
 await ctx.save('reconciliation.json',{...value,partial_removed:partial,observations:workers.observations});
 return {status:'RECOVERED',recovery_epoch:recoveryEpoch,acknowledged_ids:acknowledged,recovered_ids:recovered,reconciliation:value};
}

async function providerDrill(ctx:LocalContext):Promise<LocalOutcome>{
 const inventory=new Map<string,{id:string;idempotency_key:string}>();let mode:'UP'|'DOWN'|'APPLY_THEN_FAIL'='UP';
 const server=http.createServer((req,res)=>{
  let body='';req.on('data',(b:Buffer)=>{body+=b.toString('utf8');if(body.length>4096)req.destroy();});
  req.on('end',()=>{
   const reply=(code:number,value?:unknown)=>{res.writeHead(code,{'content-type':'application/json'});res.end(value===undefined?'':JSON.stringify(value));};
   if(mode==='DOWN')return reply(503,{error:'provider outage'});
   if(req.method==='GET'&&req.url==='/v1/sandboxes')return reply(200,[...inventory.values()]);
   if(req.method==='POST'&&req.url==='/v1/sandboxes'){
    const key=String(JSON.parse(body).idempotency_key);const existing=[...inventory.values()].find(item=>item.idempotency_key===key);
    const item=existing??{id:randomUUID(),idempotency_key:key};inventory.set(item.id,item);
    return mode==='APPLY_THEN_FAIL'?reply(503,{error:'response lost after apply'}):reply(existing?200:201,item);
   }
   const match=/^\/v1\/sandboxes\/([0-9a-f-]{36})$/.exec(req.url??'');
   if(req.method==='DELETE'&&match)return reply(inventory.delete(match[1]!)?204:404);
   reply(404);
  });
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
 let open=true;ctx.defer(async()=>{if(open)await new Promise<void>(resolve=>server.close(()=>resolve()));open=false;return !server.listening;});
 const base='http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1/sandboxes';
 const call=async(method:string,url:string,body?:unknown)=>{const response=await fetch(url,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});const text=await response.text();return {status:response.status,value:text?JSON.parse(text):null};};
 const list=async()=>{const response=await call('GET',base);must(response.status===200,'Provider inventory unavailable');return response.value as {id:string;idempotency_key:string}[];};
 const fence=new EpochFence(path.join(ctx.root,'provider-epoch')),pre=randomUUID();await fence.init(pre);
 const intents=new Map<string,'ACKNOWLEDGED'|'UNKNOWN'>();
 const create=async(key:string)=>{const response=await call('POST',base,{idempotency_key:key});intents.set(key,[200,201].includes(response.status)?'ACKNOWLEDGED':'UNKNOWN');return response.status;};
 const acknowledged=[randomUUID(),randomUUID()];for(const key of acknowledged)must([200,201].includes(await create(key)),'Healthy provider create failed');
 await call('POST',base,{idempotency_key:'stale-leak-'+pre});
 mode='APPLY_THEN_FAIL';const applied=randomUUID(),appliedStatus=await create(applied);
 mode='DOWN';const refused=randomUUID(),refusedStatus=await create(refused),outageList=(await call('GET',base)).status;
 await ctx.save('outage.json',{apply_then_fail_status:appliedStatus,down_create_status:refusedStatus,down_list_status:outageList});
 must(appliedStatus===503&&refusedStatus===503&&outageList===503,'Provider outage was not observed');
 mode='UP';const recoveryEpoch=randomUUID();await fence.rotate(pre,recoveryEpoch);
 const observed=await list(),adopted:string[]=[],orphans:string[]=[];
 for(const [key,state] of intents){
  if(state!=='UNKNOWN')continue;
  if(observed.some(item=>item.idempotency_key===key)||[200,201].includes(await create(key))){intents.set(key,'ACKNOWLEDGED');adopted.push(key);}
 }
 for(const item of await list())if(!intents.has(item.idempotency_key)){const removed=await call('DELETE',base+'/'+item.id);if(removed.status===204)orphans.push(item.id);}
 const final=await list();
 const unresolved=[...intents.values()].filter(v=>v!=='ACKNOWLEDGED').length+final.filter(item=>!intents.has(item.idempotency_key)).length;
 const workers=await staleWorkers(fence,[pre],recoveryEpoch,async epoch=>{must([200,201].includes(await create('worker-'+epoch)),'Recovered provider refused current worker');});
 const value=reconciliation('PROVIDER','Control-side epoch fence before provider calls; idempotency-key inventory reconciliation of unknown creates and orphan deletion',workers,{outstanding:adopted.length+orphans.length+(unresolved?1:0),adopted:adopted.length,orphans_removed:orphans.length,unresolved});
 await ctx.save('reconciliation.json',{...value,inventory_after:final,adopted,orphans,observations:workers.observations});
 const recovered=acknowledged.filter(key=>final.some(item=>item.idempotency_key===key));
 for(const item of await list())await call('DELETE',base+'/'+item.id);
 must((await list()).length===0,'Provider fake inventory was not cleaned');
 return {status:'RECOVERED',recovery_epoch:recoveryEpoch,acknowledged_ids:acknowledged,recovered_ids:recovered,reconciliation:value};
}

const LOCAL_PRODUCERS:Readonly<Record<LocalScenario,(ctx:LocalContext)=>Promise<LocalOutcome>>>=Object.freeze({OBJECT:objectDrill,GIT:gitDrill,AUTH:authDrill,FULL_DISK:fullDiskDrill,PROVIDER:providerDrill});
async function runLocalDrill(profile:Profile,input:ProbeInput,scenario:LocalScenario):Promise<DrillProbeResult>{
 const directory=path.join(profile.evidence_directory,input.operation_id);
 try{await fs.mkdir(directory,{mode:0o700});}
 catch{throw new FoundationError('DRILL_ALREADY_STARTED','Existing operation evidence requires reconciliation; disruptive probes are never automatically replayed');}
 const save=async(name:string,value:unknown)=>{await durable(path.join(directory,name),JSON.stringify(value,null,2)+'\n');};
 await save('intent.json',{schema_version:1,scope:LOCAL_DRILL_SCOPES[scenario],scenario,organisation_id:input.organisation_id,run_id:input.run_id,operation_id:input.operation_id,source_epoch:input.source_epoch});
 const started=new Date(),begin=process.hrtime.bigint(),deferred:(()=>Promise<boolean>)[]=[];
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hf-drill-'));await fs.chmod(root,0o700);
 let outcome:LocalOutcome;
 try{
  if(input.signal.aborted)throw new FoundationError('DRILL_ABORTED','Probe was cancelled before execution');
  outcome=await LOCAL_PRODUCERS[scenario]({root,input,save,defer:step=>{deferred.push(step);}});
 }catch(error){
  await save('failure.json',{type:(error as Error)?.name??'Error',code:(error as {code?:unknown})?.code??null,message:String((error as Error)?.message??error).slice(0,2048)});
  outcome={status:'FAILED',recovery_epoch:null,acknowledged_ids:[],recovered_ids:[],reconciliation:null};
 }
 let processesAbsent=true;
 for(const step of deferred.reverse()){try{processesAbsent=await step()&&processesAbsent;}catch{processesAbsent=false;}}
 if(processesAbsent)await fs.rm(root,{recursive:true,force:true});
 const cleanup:Cleanup={complete:false,root_absent:await absent(root),processes_absent:processesAbsent};cleanup.complete=cleanup.root_absent&&processesAbsent;
 await save('cleanup.json',cleanup);
 await save('timing.json',{started_unix_ms:started.getTime(),elapsed_ms:Number((process.hrtime.bigint()-begin)/1000000n),rpo:'ACKNOWLEDGED_IDENTITY_LOSS_COUNT_ONLY'});
 const limits=outcome.limits??LOCAL_LIMITS[scenario];
 const artifacts:Artifact[]=[];
 for(const name of (await fs.readdir(directory)).sort()){const data=await fs.readFile(path.join(directory,name));artifacts.push({path:name,sha256:sha(data),size:data.length});}
 const manifest=Buffer.from(JSON.stringify({schema_version:1,scope:LOCAL_DRILL_SCOPES[scenario],scenario,operation_id:input.operation_id,recovery_epoch:outcome.recovery_epoch,artifacts,cleanup,limits},null,2)+'\n');
 await durable(path.join(directory,'evidence.json'),manifest);
 if(!cleanup.complete)throw new FoundationError('DRILL_OUTCOME_UNKNOWN','Owned local fixture cleanup was not observed; inspect retained operation evidence');
 return {status:outcome.status,source_epoch:input.source_epoch,recovery_epoch:outcome.recovery_epoch,acknowledged_ids:outcome.acknowledged_ids,recovered_ids:outcome.recovered_ids,
  evidence_digest:'sha256:'+sha(manifest),limits,scope:LOCAL_DRILL_SCOPES[scenario],artifacts:[...artifacts,{path:'evidence.json',sha256:sha(manifest),size:manifest.length}],
  started_at:started.toISOString(),completed_at:new Date().toISOString(),cleanup,reconciliation:outcome.reconciliation};
}
/** Registered drill producer: isolated PostgreSQL for DATABASE/RESTORE and owned local fixtures for every other scenario. */
export function createRecoveryProbe(resources:ServiceResources,env:Readonly<NodeJS.ProcessEnv>){
 const postgres=createPostgresRecoveryProbe(resources,env);
 return Object.freeze({
  ready:async():Promise<void>=>{await loadProfile(env);},
  execute:async(input:ProbeInput):Promise<DrillProbeResult>=>{
   if(input.scenario==='DATABASE'||input.scenario==='RESTORE')return postgres.execute(input);
   if(!Object.hasOwn(LOCAL_PRODUCERS,input.scenario))throw new FoundationError('DRILL_SCENARIO_UNSUPPORTED','Unknown recovery drill scenario');
   for(const key of ['organisation_id','run_id','operation_id','source_epoch'] as const)
    if(!UUID.test(input[key]))throw new FoundationError('DRILL_INPUT_INVALID','Canonical scope identities are required');
   return runLocalDrill(await loadProfile(env),input,input.scenario as LocalScenario);
  }
 });
}
