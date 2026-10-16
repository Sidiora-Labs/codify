import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {FoundationError,object} from '../policy/programme.js';
import type {ServiceResources} from './runtime.js';

interface ProbeInput {
 scenario:string;organisation_id:string;run_id:string;operation_id:string;source_epoch:string;signal:AbortSignal;
}
interface Artifact {path:string;sha256:string;size:number}
export interface PostgresDrillResult {
 status:'RECOVERED'|'FAILED'|'UNKNOWN';source_epoch:string;recovery_epoch:string|null;
 acknowledged_ids:readonly string[];recovered_ids:readonly string[];evidence_digest:string;limits:string;
 scope:'ISOLATED_POSTGRESQL_FIXTURE';artifacts:readonly Artifact[];started_at:string;completed_at:string;
 cleanup:{complete:boolean;root_absent:boolean;processes_absent:boolean};
}
interface Profile {schema_version:1;scope:'ISOLATED_POSTGRESQL_FIXTURE';python_path:string;producer_path:string;producer_sha256:string;evidence_directory:string;timeout_ms:number}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
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
// This explicit operator fixture runs owned, disposable databases. It never targets the service authority pool.
export function createPostgresRecoveryProbe(_resources:ServiceResources,env:Readonly<NodeJS.ProcessEnv>){
 const profilePromise=loadProfile(env);profilePromise.catch(()=>{});
 return Object.freeze({execute:async(input:ProbeInput):Promise<PostgresDrillResult>=>{
  if(!['DATABASE','RESTORE'].includes(input.scenario))throw new FoundationError('DRILL_SCENARIO_UNSUPPORTED','This producer supports only isolated PostgreSQL DATABASE and RESTORE drills');
  for(const key of ['organisation_id','run_id','operation_id','source_epoch'] as const)
   if(!UUID.test(input[key]))throw new FoundationError('DRILL_INPUT_INVALID','Canonical scope identities are required');
  if(input.signal.aborted)throw new FoundationError('DRILL_ABORTED','Probe was cancelled before execution');
  const profile=await profilePromise;
  const directory=path.join(profile.evidence_directory,input.operation_id);
  try{await fs.mkdir(directory,{mode:0o700});}
  catch(error){throw new FoundationError('DRILL_ALREADY_STARTED','Existing operation evidence requires reconciliation; disruptive probes are never automatically replayed');}
  const payload={schema_version:1,scope:profile.scope,scenario:input.scenario,organisation_id:input.organisation_id,run_id:input.run_id,operation_id:input.operation_id,source_epoch:input.source_epoch,evidence_directory:directory};
  await fs.writeFile(path.join(directory,'intent.json'),JSON.stringify(payload)+'\n',{mode:0o600,flag:'wx'});
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(profile.python_path,[profile.producer_path],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C.UTF-8',HYPERFIDE_PROBE_NODE:process.execPath}});
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
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
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
  return result as unknown as PostgresDrillResult;
 }});
}
