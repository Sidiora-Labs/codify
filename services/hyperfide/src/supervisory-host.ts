import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {exact,fail,strictJSON} from './transport/protocol.js';

/* `hyperfide supervisory-host --config FILE` (deploy/hyperfide/supervisory-host.service).
 * The MAIN box stays supervisory (req 25 ac_4): this launcher only pins the private
 * process-custody configuration and execs the packaged runtime/supervisory_host.py.
 * It carries no placement, admission, model or authority credentials, and refuses
 * to start when the service environment would hand it any. */
const HOST_KEYS=['schema_version','socket_path','state_root','plan_root','allowed_uids','max_children','policy_file','policy_sha256',
 'termination_grace_seconds','max_output_bytes','control_uid','control_gid'];
// Environment that would let the MAIN host act as an execution, model or authority node.
const FORBIDDEN_ENV=/^(?:DATABASE_URL|PG[A-Z]+|HYPERFIDE_[A-Z_]*DATABASE_URL|HYPERFIDE_AUTHORITY_JOURNAL_DIR|HF_GITHUB_TOKEN|GITHUB_TOKEN|GH_TOKEN|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|CODEX_API_KEY|RAILWAY_[A-Z_]*TOKEN|RAILWAY_API_KEY|BL_API_KEY|BLAXEL_[A-Z_]*KEY|HF_PROVIDER_[A-Z_]+)$/;
const SHA=/^[0-9a-f]{64}$/;
function canonicalAbsolute(value:unknown):value is string{
 return typeof value==='string'&&path.isAbsolute(value)&&!value.includes('\0')&&path.normalize(value)===value&&value!=='/';
}
function uidValue(value:unknown,low:number):boolean{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=low&&value<=2147483646;}
/** Structural validation of the host contract; the Python host re-validates ownership and kernel state. */
export function validateSupervisoryHostConfig(value:unknown):Record<string,unknown>{
 exact(value,HOST_KEYS);
 if(value.schema_version!==1)fail('SUPERVISORY_CONFIG_INVALID','Unsupported supervisory host configuration version');
 for(const key of ['socket_path','state_root','plan_root','policy_file'])if(!canonicalAbsolute(value[key]))fail('SUPERVISORY_CONFIG_INVALID','Canonical absolute host paths are required');
 if(typeof value.policy_sha256!=='string'||!SHA.test(value.policy_sha256))fail('SUPERVISORY_CONFIG_INVALID','Exact execution policy digest is required');
 const uids=value.allowed_uids;
 if(!Array.isArray(uids)||uids.length<1||uids.length>256||new Set(uids).size!==uids.length||!uids.every(u=>uidValue(u,1000)))fail('SUPERVISORY_CONFIG_INVALID','Unique unprivileged native child UIDs are required');
 if(!uidValue(value.control_uid,1000)||!uidValue(value.control_gid,1000)||uids.includes(value.control_uid))fail('SUPERVISORY_CONFIG_INVALID','Control service identity must be separate from native child identities');
 if(typeof value.max_children!=='number'||!Number.isSafeInteger(value.max_children)||value.max_children<1||value.max_children>256||
    typeof value.max_output_bytes!=='number'||!Number.isSafeInteger(value.max_output_bytes)||value.max_output_bytes<4096||value.max_output_bytes>67108864||
    typeof value.termination_grace_seconds!=='number'||!(value.termination_grace_seconds>=0.05&&value.termination_grace_seconds<=30))
  fail('SUPERVISORY_CONFIG_INVALID','Bounded child, output and termination limits are required');
 return {role:'SUPERVISORY',launcher:'hyperfide supervisory-host --config FILE',runtime:'services/runtime/supervisory_host.py',
  socket_path:value.socket_path,state_root:value.state_root,allowed_uids:uids.slice().sort((a,b)=>a-b),max_children:value.max_children,
  policy_sha256:value.policy_sha256,placement_authority:false,admission_authority:false,model_credentials:false,engineering_execution:'REMOTE_ONLY'};
}
async function privateFile(file:string,max:number,executable:boolean):Promise<{bytes:Buffer|null}>{
 let handle:Awaited<ReturnType<typeof fs.open>>|undefined;
 try{
  if(await fs.realpath(file)!==file)fail('SUPERVISORY_CONFIG_INVALID','Host files cannot traverse symlinks');
  handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await handle.stat();
  if(!stat.isFile()||stat.size<1||stat.size>max)fail('SUPERVISORY_CONFIG_INVALID','Bounded regular host files are required');
  if(executable){if((stat.mode&0o111)===0||(stat.mode&0o022)!==0)fail('SUPERVISOR_RUNTIME_REQUIRED','Packaged supervisor runtime must be a protected executable');return {bytes:null};}
  if(stat.uid!==process.geteuid?.()||(stat.mode&0o077)!==0)fail('SUPERVISORY_CONFIG_INVALID','Host configuration must be a private owner file');
  return {bytes:await handle.readFile()};
 }catch(error){if(error instanceof Error&&'code' in error&&/^SUPERVIS/.test(String(error.code)))throw error;return fail(executable?'SUPERVISOR_RUNTIME_REQUIRED':'SUPERVISORY_CONFIG_INVALID','Host file is unavailable');}
 finally{await handle?.close();}
}
export interface SupervisoryLaunch {python:string;script:string;config:string;config_sha256:string;argv:string[];env:Record<string,string>}
export async function prepareSupervisoryHost(args:readonly string[],env:Readonly<NodeJS.ProcessEnv>):Promise<SupervisoryLaunch>{
 if(args.length!==2||args[0]!=='--config'||!canonicalAbsolute(args[1]))fail('INVALID_REQUEST','Usage: hyperfide supervisory-host --config /absolute/supervisory-host.json');
 const forbidden=Object.keys(env).filter(name=>FORBIDDEN_ENV.test(name)&&env[name]);
 if(forbidden.length)fail('SUPERVISORY_ONLY','The MAIN supervisory host refuses execution, model and authority credentials');
 const config=args[1]!,{bytes}=await privateFile(config,131072,false);
 validateSupervisoryHostConfig(strictJSON(bytes!,131072));
 const python=env.HYPERFIDE_SUPERVISOR_PYTHON;
 if(!canonicalAbsolute(python))fail('SUPERVISOR_RUNTIME_REQUIRED','The packaged supervisor Python runtime is required; PATH is never searched');
 await privateFile(python,1<<30,true);
 const script=fileURLToPath(new URL('../runtime/supervisory_host.py',import.meta.url));
 try{const stat=await fs.lstat(script);if(!stat.isFile()||(stat.mode&0o022)!==0)throw Error();}
 catch{fail('SUPERVISOR_RUNTIME_REQUIRED','The packaged supervisory host runtime is unavailable');}
 const digest=createHash('sha256').update(bytes!).digest('hex');
 // The Python host reads the config again and refuses drift against this exact digest.
 const childEnv:Record<string,string>={PATH:'/usr/bin:/bin',LANG:'C.UTF-8'};
 if(env.HYPERFIDE_MAIN_BUDGET_FILE&&canonicalAbsolute(env.HYPERFIDE_MAIN_BUDGET_FILE))childEnv.HYPERFIDE_MAIN_BUDGET_FILE=env.HYPERFIDE_MAIN_BUDGET_FILE;
 return {python:python!,script,config,config_sha256:digest,argv:['-I',script,'--config',config,'--config-sha256',digest],env:childEnv};
}
export async function supervisoryHostCommand(args:readonly string[],env:Readonly<NodeJS.ProcessEnv>,signal:AbortSignal):Promise<number>{
 const launch=await prepareSupervisoryHost(args,env);
 return new Promise(resolve=>{
  const child=spawn(launch.python,launch.argv,{env:launch.env,stdio:['ignore','inherit','inherit']});
  const forward=()=>{child.kill('SIGTERM');};
  signal.addEventListener('abort',forward,{once:true});
  child.once('error',()=>{signal.removeEventListener('abort',forward);process.stderr.write(JSON.stringify({ok:false,error:{code:'SUPERVISOR_RUNTIME_REQUIRED'},local_fallback:false})+'\n');resolve(78);});
  child.once('exit',(code,killed)=>{signal.removeEventListener('abort',forward);resolve(code??(killed==='SIGTERM'&&signal.aborted?0:1));});
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const controller=new AbortController(),stop=()=>controller.abort();process.on('SIGTERM',stop);process.on('SIGINT',stop);
 try{process.exitCode=await supervisoryHostCommand(process.argv.slice(2),Object.freeze({...process.env}),controller.signal);}
 catch(error){const code=typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='string'?error.code:'SUPERVISORY_HOST_FAILED';
  process.stderr.write(JSON.stringify({ok:false,error:{code},local_fallback:false})+'\n');process.exitCode=78;}
 finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
