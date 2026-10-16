import fs from 'node:fs/promises';
import path from 'node:path';
import {assertInvocation} from '../../transport/protocol.js';
import type {InvocationContext} from '../../transport/protocol.js';
import {createHash} from 'node:crypto';
import type {Component,ComponentContext} from '../../components/registry.js';
import {FoundationError} from '../../policy/programme.js';
import {validateProviderOperation,validateProviderOutcome,PROVIDER_METHODS} from '../contract.js';
import type {ProviderAdapter,ProviderOperation,ProviderOutcome,ProviderScope,ResourceRef,ProviderMethod,ProviderResults,ProcessResult,ProviderState} from '../contract.js';
import {configuredBlaxelSDK,BLAXEL_PINS} from './images.js';
import {blaxelSandboxLifetimeOptions,validateBlaxelLifetimePolicy} from './lifetime.js';
import type {BlaxelLifetimePolicy} from './lifetime.js';

type Obj=Record<string,unknown>;
const MAX_OUTPUT=16*1024*1024;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function object(v:unknown):Obj{
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('BLAXEL_PROCESS_INVALID','Object required');
 return v as Obj;
}
function shape(v:unknown,keys:string[]):Obj{const o=object(v);if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))fail('BLAXEL_PROCESS_INVALID','Missing or unknown field');return o;}
function text(v:unknown,max=4096):string{if(typeof v!=='string'||!v.length||v.length>max||v.includes('\0'))fail('BLAXEL_PROCESS_INVALID','Bounded string required');return v;}
function canonical(v:unknown):string{
 if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 const o=object(v);return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';
}
function digest(v:unknown):string{return 'sha256:'+createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');}
function bytesDigest(v:Uint8Array):string{return 'sha256:'+createHash('sha256').update(v).digest('hex');}
function equal(a:unknown,b:unknown):boolean{return canonical(a)===canonical(b);}
function nativeName(v:unknown):string{const n=text(v,49);if(!/^[a-z0-9][a-z0-9-]*$/.test(n))fail('BLAXEL_PROCESS_INVALID','Invalid native sandbox name');return n;}
function shell(v:string):string{return "'"+v.replaceAll("'","'\\''")+"'";}
function statusCode(e:unknown):number|null{if(e&&typeof e==='object'){const o=e as Obj;for(const v of [o.status,o.statusCode,(o.response as Obj|undefined)?.status])if(typeof v==='number')return v;}return null;}
function processName(operation:ProviderOperation<'execute'>):string{return 'hf-'+digest({operation_id:operation.identity.operation_id,payload_digest:operation.identity.payload_digest,resource:operation.resource}).slice(7,47);}
function scopeDigest(scope:ProviderScope):string{return digest(scope);}
function requireOperation<T extends ProviderMethod>(raw:unknown,kind:T,scope:ProviderScope):ProviderOperation<T>{
 const o=validateProviderOperation(raw);if(o.kind!==kind||o.scope.provider!=='blaxel'||!equal(o.scope,scope))fail('BLAXEL_PROCESS_INVALID','Operation scope or method differs from trusted adapter');
 return o as ProviderOperation<T>;
}
export interface CapturedBlaxelOutput{stdout:Uint8Array;stderr:Uint8Array;exit_code:number;complete:true;spool_digest:string;capture:{schema_version:1;scheme:'STREAM_DIGESTS_CANONICAL_JSON'}}
export interface BlaxelProcessRecord{native_process_ref?:string|null;process_ref:string;payload_digest:string;resource:ResourceRef;state:'SUBMITTED'|'RUNNING'|'EXITED'|'UNKNOWN';provider_metadata:Record<string,unknown>}
export interface BlaxelPersistenceHooks{
 persistEarlyProcess(operation:ProviderOperation<'execute'>,nativeProcessRef:string):Promise<void>;
 readonly invocation:InvocationContext;
 resolveResourceBinding(operation:ProviderOperation):Promise<{organisation_id:string;run_id:string;sandbox_id:string;boot_id:string;boot_generation:string}>;
 resolvePreparation(operation:ProviderOperation<'create'>):Promise<{purpose:'PREPARATION'|'EXECUTION';scope:ProviderScope;preparation_digest:string;parameters:ProviderOperation<'create'>['parameters'];prepared_base:Obj|null;adapter_policy_digest?:string|null}>;
 claimProcess(operation:ProviderOperation<'execute'>,record:BlaxelProcessRecord):Promise<{disposition:'NEW'|'EXISTING';record:BlaxelProcessRecord}>;
 resolveProcess(operation:ProviderOperation,processRef:string):Promise<BlaxelProcessRecord|null>;
 assignedBootGeneration(operation:ProviderOperation<'create'>):Promise<string>;
 persistEarlyResource(operation:ProviderOperation<'create'>,nativeSandboxId:string):Promise<ResourceRef>;
 recordObservation(operation:ProviderOperation,outcome:ProviderOutcome):Promise<void>;
 assertResourceBinding(operation:ProviderOperation):Promise<void>;
}
export interface QualifiedBlaxelBase{
 qualification_status:'QUALIFIED'|'TRUSTED_PREPARATION_SEED';purpose?:'PREPARATION'|'EXECUTION';preparation_digest:string;provider_prepared_digest:string;
 preparation_reference:string;scope:ProviderScope;resources:import('../contract.js').ResourceVector;
 lifecycle:BlaxelLifetimePolicy;network_mode:'ISOLATED'|'PRIVATE';network:Obj;
 volumes:Obj[];runtime_extra_args:Record<string,string>;
}
/** These closures are installed by authenticated controller components. Action
 * input cannot provide a resolver, enrollment token, prepared base or transport. */
export interface BlaxelTrustedDependencies{
 resolvePreparedBase(operation:ProviderOperation<'create'>):Promise<QualifiedBlaxelBase>;
 resolveCredentialReferences(operation:ProviderOperation<'execute'>,refs:Record<string,string>,signal:AbortSignal):Promise<Record<string,string>>;
 assertPreparedResource(operation:ProviderOperation):Promise<void>;

}
interface BlaxelProcess{
 get(id:string,options?:{signal?:AbortSignal;retry?:boolean}):Promise<Obj>;
 exec(request:Obj):Promise<Obj>;stop(id:string):Promise<Obj>;kill(id:string):Promise<Obj>;
 writeStdin(id:string,data:Uint8Array):Promise<void>;closeStdin(id:string):Promise<void>;
}
interface BlaxelSandbox{metadata:Obj;spec:Obj;status?:string;process:BlaxelProcess;fs:{readBinary(path:string):Promise<Blob>}}
interface BlaxelSDK{
 createSandbox(request:{body:Obj;throwOnError:false;signal:AbortSignal}):Promise<{data?:unknown;error?:unknown;response:Response}>;
 SandboxInstance:{get(name:string):Promise<BlaxelSandbox>;create(model:Obj,options:{safe:false;timeout:number}):Promise<BlaxelSandbox>;
 list(query:Obj):Promise<{data:BlaxelSandbox[];hasMore:boolean;nextCursor?:string}>;delete(name:string):Promise<unknown>};
}
function runtimeSDK(v:unknown):BlaxelSDK{
 if(!v||typeof v!=='object')fail('BLAXEL_PROCESS_UNAVAILABLE','Pinned SDK unavailable');const s=(v as Obj).SandboxInstance as Obj|undefined;
 if(typeof(v as Obj).createSandbox!=='function'||!s||!['get','list','delete'].every(k=>typeof s[k]==='function'))fail('BLAXEL_PROCESS_UNAVAILABLE','Pinned SDK runtime methods differ');
 return v as BlaxelSDK;
}
export async function boundedBlaxelOperation<T>(fn:(signal:AbortSignal)=>Promise<T>,parent:AbortSignal,deadline:number):Promise<T>{
 if(parent.aborted||deadline<=Date.now())fail('BLAXEL_OPERATION_UNAVAILABLE','Operation cancelled or deadline expired');
 const c=new AbortController();let reject:(reason:Error)=>void=()=>{};
 const interrupted=new Promise<never>((_r,j)=>{reject=j;});
 const abort=()=>{c.abort();reject(new FoundationError('BLAXEL_OPERATION_UNAVAILABLE','Provider operation exceeded its observation deadline'));};
 parent.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,Math.min(60000,deadline-Date.now()));
 if(parent.aborted)abort();
 try{return await Promise.race([interrupted,Promise.resolve().then(()=>{c.signal.throwIfAborted();return fn(c.signal);})]);}
 finally{clearTimeout(timer);parent.removeEventListener('abort',abort);c.abort();}
}
/** One capture shares the original deadline and every cancellation owner. */
export function blaxelCaptureControl(operation:ProviderOperation,contextSignal:AbortSignal,requestSignal:AbortSignal,identitySignal:AbortSignal):{deadline:number;signal:AbortSignal}{
 return{deadline:Math.min(Date.parse(operation.deadline_at),Date.now()+15000),signal:AbortSignal.any([contextSignal,requestSignal,identitySignal])};
}
export function blaxelCreateName(operation:ProviderOperation<'create'>,generation:string):string{
 if(!/^[1-9][0-9]{0,18}$/.test(generation))fail('BLAXEL_PROCESS_INVALID','Assigned boot generation required');
 return 'hf-'+digest({scope:operation.scope,operation_id:operation.identity.operation_id,generation}).slice(7,47);
}
export function planBlaxelCreate(operation:ProviderOperation<'create'>,generation:string,base:QualifiedBlaxelBase):Obj{
 validateProviderOperation(operation);const lifecycle=validateBlaxelLifetimePolicy(JSON.parse(canonical(base.lifecycle)));
 if(operation.kind!=='create'||operation.scope.provider!=='blaxel'||!['QUALIFIED','TRUSTED_PREPARATION_SEED'].includes(base.qualification_status)||!equal(operation.scope,base.scope)||
 base.preparation_digest!==operation.preparation_digest||base.preparation_reference!==operation.parameters.preparation_reference||
 !/^sha256:[a-f0-9]{64}$/.test(base.provider_prepared_digest)||!equal(base.resources,operation.parameters.resources)||
 base.network_mode!==operation.parameters.network||!(base.qualification_status==='QUALIFIED'?/^sandbox\/[a-z0-9-]+:[a-f0-9]{64}$/:/(?:@sha256:|:)[a-f0-9]{64}$/).test(base.preparation_reference)||
 base.qualification_status==='TRUSTED_PREPARATION_SEED'&&base.purpose!=='PREPARATION')
 fail('BLAXEL_PREPARATION_MISMATCH','Actual qualified base does not match the durable pool operation');
 const immutable=/(?:@sha256:|:)([a-f0-9]{64})$/.exec(base.preparation_reference);
 if(!immutable||base.provider_prepared_digest!=='sha256:'+immutable[1])fail('BLAXEL_PREPARATION_MISMATCH','Prepared artifact digest differs from immutable provider image reference');
 const memory=BigInt(base.resources.memory_bytes);
 // Blaxel couples CPU allocation to memory. Do not silently provision a different vector.
 if(memory%1048576n!==0n||memory/1048576n>BigInt(Number.MAX_SAFE_INTEGER)||
 BigInt(base.resources.cpu_millis)*2048n*1048576n!==memory*1000n)
 fail('BLAXEL_RESOURCE_UNSUPPORTED','Blaxel CPU and memory coupling does not match the requested vector');
 if(!Array.isArray(base.volumes)||base.volumes.length>16)fail('BLAXEL_PROCESS_INVALID','Trusted volume configuration required');
 if(base.volumes.length||base.resources.persistent_volume_bytes!=='0')fail('BLAXEL_PERSISTENT_STORAGE_UNSUPPORTED','Per-boot qualified volume allocation is required before persistent storage can be enabled');
 if(BigInt(base.resources.disk_bytes)>memory)fail('BLAXEL_RESOURCE_UNSUPPORTED','Requested writable overlay exceeds allocated memory');
 const lifetime=blaxelSandboxLifetimeOptions(lifecycle);
 return {metadata:{name:blaxelCreateName(operation,generation),labels:{
 'hyperfide-operation':operation.identity.operation_id,'hyperfide-payload':operation.identity.payload_digest,
 'hyperfide-scope':scopeDigest(operation.scope),'hyperfide-boot':generation,
 'hyperfide-preparation':base.preparation_digest,'hyperfide-provider-base':base.provider_prepared_digest,
 }},spec:{enabled:true,region:operation.scope.region,network:base.network,volumes:base.volumes,
 lifecycle:lifetime.lifecycle,runtime:{...lifetime.runtime,image:base.preparation_reference,memory:Number(memory/1048576n),
 envs:[],ports:[],extraArgs:base.runtime_extra_args}}};
}
export function verifyBlaxelCreate(observation:unknown,expected:Obj,scope:ProviderScope):{matches:true;native_sandbox_id:string}{
 const o=object(observation),m=object(o.metadata),s=object(o.spec),want=object(expected.metadata),spec=object(expected.spec);
 if(m.name!==want.name||m.workspace!==scope.environment_id||!equal(m.labels,want.labels))fail('BLAXEL_CREATE_CONFLICT','Named sandbox identity does not match durable ownership');
 for(const key of ['enabled','region','network','volumes','lifecycle'])if(!equal(s[key],spec[key]))fail('BLAXEL_CREATE_CONFLICT','Existing sandbox actual configuration differs');
 const runtime=object(s.runtime),desired=object(spec.runtime);
 for(const key of Object.keys(desired))if(!equal(runtime[key],desired[key]))fail('BLAXEL_CREATE_CONFLICT','Existing sandbox runtime configuration differs');
 if(['FAILED','TERMINATED','DELETING','ARCHIVED','ARCHIVING','UNARCHIVING'].includes(String(o.status)))fail('BLAXEL_CREATE_CONFLICT','Named sandbox cannot be silently replaced or restored');
 return{matches:true,native_sandbox_id:nativeName(m.name)};
}
/** Record candidate identity before validating ownership. This callback boundary
 * carries no readiness authority; persistence failures still retain the known ID. */
export async function retainBlaxelCreateCandidate(actual:{metadata:Obj;spec:Obj;status:string|undefined},expected:Obj,scope:ProviderScope,generation:string,remember:(resource:ResourceRef)=>void,persist:(nativeId:string)=>Promise<ResourceRef>):Promise<ResourceRef>{
 const returnedName=nativeName(actual.metadata?.name),candidate={native_sandbox_id:returnedName,sandbox_boot_generation:generation};
 remember(candidate);
 const persisted=await persist(returnedName);
 if(persisted.sandbox_boot_generation!==generation||persisted.native_sandbox_id!==returnedName)fail('BLAXEL_CREATE_CONFLICT','Persistence changed assigned boot identity');
 remember(persisted);
 verifyBlaxelCreate(actual,expected,scope);
 return persisted;
}
function state(raw:string|undefined):ProviderState{
 if(raw==='DEPLOYED')return 'RUNNING';if(raw==='FAILED')return 'FAILED';if(raw==='TERMINATED')return 'DESTROYED';
 if(raw==='DELETING')return 'DESTROYING';if(raw==='DEACTIVATED'||raw==='ARCHIVED')return 'STOPPED';
 if(['BUILDING','UPLOADING','DEPLOYING','BUILT'].includes(raw??''))return 'CREATING';return 'UNKNOWN';
}
/** The worker writes its own byte inventory before publishing the atomic receipt.
 * API logs are useful for display, but cannot prove complete binary output. */
// The remote coding profile must qualify /usr/bin/python3, prctl and procfs.
// API terminal state alone cannot prove escaped descendants were reaped.
const BLAXEL_JOB_SUBREAPER="import ctypes,os,signal,subprocess,sys,time\nlibc=ctypes.CDLL(None,use_errno=True)\nif libc.prctl(36,1,0,0,0)!=0:\n sys.stderr.write(\"Bounded process supervision unavailable\\n\");sys.exit(125)\nstopping=False\ndef interrupt(signum,frame):\n global stopping\n stopping=True\nsignal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)\ntry:parent=subprocess.Popen(sys.argv[1:],stdin=sys.stdin.buffer)\nexcept Exception:\n sys.stderr.write(\"Bounded command could not start\\n\");sys.exit(125)\nwhile parent.poll()is None and not stopping:time.sleep(.01)\nif stopping:\n try:parent.kill()\n except ProcessLookupError:pass\ntry:code=parent.wait(timeout=2)\nexcept subprocess.TimeoutExpired:code=125\nleaked=False;deadline=time.monotonic()+5\nwhile True:\n try:\n  children=open(\"/proc/self/task/\"+str(os.getpid())+\"/children\").read().split()\n  if children:leaked=True\n  for child in children:\n   try:os.kill(int(child),signal.SIGKILL)\n   except ProcessLookupError:pass\n  try:\n   pid,status=os.waitpid(-1,os.WNOHANG)\n   if pid:continue\n  except ChildProcessError:break\n except OSError:\n  sys.stderr.write(\"Descendant cleanup could not be verified\\n\");sys.exit(125)\n if time.monotonic()>=deadline:\n  sys.stderr.write(\"Descendant cleanup remains unresolved\\n\");sys.exit(125)\n time.sleep(.01)\nif leaked:sys.stderr.write(\"Unexpected bounded-command descendants were terminated and reaped\\n\")\nsys.exit(125 if leaked or stopping else(code if code>=0 else 128-code))\n";
export const BLAXEL_CAPTURE_SUPERVISOR=String.raw`
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const c=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));
function canon(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canon).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}'}
function hash(v){return 'sha256:'+crypto.createHash('sha256').update(v).digest('hex')}
fs.mkdirSync(c.path,{recursive:true,mode:0o700});
const lock=fs.openSync(c.path+'/launch','wx',0o600);fs.writeFileSync(lock,c.launch_digest);fs.fsyncSync(lock);fs.closeSync(lock);
let total=0,truncated=false,stdout=[],stderr=[],spawnError=false;
const child=cp.spawn(c.argv[0],c.argv.slice(1),{cwd:c.cwd,env:process.env,stdio:[c.stdin?'pipe':'ignore','pipe','pipe'],detached:false});
if(c.stdin){process.stdin.pipe(child.stdin);child.stdin.on('error',()=>{});}
function collect(target,chunk){const remaining=Math.max(0,c.limit-total);total+=chunk.length;if(chunk.length>remaining)truncated=true;if(remaining)target.push(chunk.subarray(0,remaining));}
child.stdout.on('data',b=>collect(stdout,b));child.stderr.on('data',b=>collect(stderr,b));
child.on('error',()=>{spawnError=true;});
let signal=null;for(const s of ['SIGTERM','SIGINT','SIGHUP'])process.on(s,()=>{signal=s;child.kill(s);});
child.on('close',(code,sig)=>{
 const out=Buffer.concat(stdout),err=Buffer.concat(stderr);
 fs.writeFileSync(c.path+'/stdout',out,{mode:0o600});fs.writeFileSync(c.path+'/stderr',err,{mode:0o600});
 const r={schema_version:1,scope_digest:c.scope_digest,resource:c.resource,process_ref:c.process_ref,
 operation_id:c.operation_id,payload_digest:c.payload_digest,launch_digest:c.launch_digest,
 stdout_size:out.length,stderr_size:err.length,stdout_digest:hash(out),stderr_digest:hash(err),
 exit_code:Number.isInteger(code)?code:128+({SIGKILL:9,SIGTERM:15,SIGINT:2,SIGHUP:1}[sig]||1),
 complete:!truncated&&!spawnError,truncated,signal:sig||signal};
 const full={...r,spool_digest:hash(canon(r))};
 fs.writeFileSync(c.path+'/receipt.tmp',JSON.stringify(full),{mode:0o600});fs.renameSync(c.path+'/receipt.tmp',c.path+'/receipt.json');
 process.exitCode=r.exit_code;
});
`;
export function planBlaxelProcess(operation:ProviderOperation<'execute'>):{process_ref:string;spool_path:string;launch_digest:string;request:Obj}{
 validateProviderOperation(operation);if(operation.kind!=='execute'||operation.scope.provider!=='blaxel'||!operation.resource)fail('BLAXEL_PROCESS_INVALID','Bound Blaxel execute required');
 const p=operation.parameters;if(p.process_timeout_ms!==null&&p.process_timeout_ms%1000!==0)fail('BLAXEL_RESOURCE_UNSUPPORTED','Execution timeout must be whole provider seconds');
 const ref=processName(operation),spool='/tmp/hyperfide-output/'+operation.resource.sandbox_boot_generation+'/'+ref;
 const launch={schema_version:1,scope_digest:scopeDigest(operation.scope),resource:operation.resource,
 process_ref:ref,operation_id:operation.identity.operation_id,payload_digest:operation.identity.payload_digest,
 argv:p.argv,cwd:p.cwd,stdin:p.stdin,limit:MAX_OUTPUT,path:spool},launchDigest=digest(launch);
 const encoded=Buffer.from(canonical({...launch,launch_digest:launchDigest})).toString('base64');
 return{process_ref:ref,spool_path:spool,launch_digest:launchDigest,request:{
 name:ref,command:['/usr/bin/python3','-I','-c',BLAXEL_JOB_SUBREAPER,'node','-e',BLAXEL_CAPTURE_SUPERVISOR,encoded].map(shell).join(' '),workingDir:p.cwd,
 stdin:p.stdin,keepAlive:true,timeout:p.process_timeout_ms===null?0:p.process_timeout_ms/1000,
 waitForCompletion:false,restartOnFailure:false,maxRestarts:0}};
}
export function verifyBlaxelCapturedOutput(input:{receipt:unknown;stdout:Uint8Array;stderr:Uint8Array;scope:ProviderScope;resource:ResourceRef;process_ref:string;expected:{operation_id:string;payload_digest:string;launch_digest:string;spool_path:string;scope_digest:string};maxBytes:number}):CapturedBlaxelOutput{
 const r=shape(input.receipt,['schema_version','scope_digest','resource','process_ref','operation_id','payload_digest','launch_digest','stdout_size','stderr_size','stdout_digest','stderr_digest','exit_code','complete','truncated','signal','spool_digest']);
 if(!Number.isSafeInteger(input.maxBytes)||input.maxBytes<0||input.maxBytes>MAX_OUTPUT||
 !(input.stdout instanceof Uint8Array)||!(input.stderr instanceof Uint8Array)||input.stdout.length+input.stderr.length>input.maxBytes||
 r.schema_version!==1||r.scope_digest!==scopeDigest(input.scope)||r.scope_digest!==input.expected.scope_digest||
 !equal(r.resource,input.resource)||r.process_ref!==input.process_ref||r.operation_id!==input.expected.operation_id||
 r.payload_digest!==input.expected.payload_digest||r.launch_digest!==input.expected.launch_digest||
 r.complete!==true||r.truncated!==false||!Number.isSafeInteger(r.exit_code)||
 r.stdout_size!==input.stdout.length||r.stderr_size!==input.stderr.length||
 r.stdout_digest!==bytesDigest(input.stdout)||r.stderr_digest!==bytesDigest(input.stderr))
 fail('BLAXEL_CAPTURE_UNAVAILABLE','Complete captured output is unavailable or belongs to another boot/process');
 const {spool_digest,...body}=r;if(spool_digest!==digest(body))fail('BLAXEL_CAPTURE_UNAVAILABLE','Capture receipt digest differs');
 return{stdout:input.stdout,stderr:input.stderr,exit_code:r.exit_code as number,complete:true,spool_digest:spool_digest as string,capture:{schema_version:1,scheme:'STREAM_DIGESTS_CANONICAL_JSON'}};
}
function noOutput(ref:string,raw:Obj):ProcessResult{
 if(raw.status==='running')return{process_ref:ref,phase:'STARTED',exit_code:null,timed_out:false,termination_confirmed:false,output:{complete:false,truncated:false,byte_count:'0',sha256:null}};
 if(!['completed','failed','killed','stopped'].includes(String(raw.status))||!Number.isSafeInteger(raw.exitCode))fail('BLAXEL_PROCESS_UNAVAILABLE','Unknown process phase or exit');
 return{process_ref:ref,phase:'EXITED',exit_code:raw.exitCode as number,timed_out:false,termination_confirmed:true,output:{complete:false,truncated:false,byte_count:'0',sha256:null}};
}
function outcome<K extends ProviderMethod>(op:ProviderOperation<K>,status:'SUCCEEDED'|'FAILED'|'UNKNOWN'|'UNSUPPORTED',result:ProviderResults[K]|null,resource:ResourceRef|null=op.resource):ProviderOutcome<K>{
 const common={schema_version:1 as const,operation_id:op.identity.operation_id,payload_digest:op.identity.payload_digest,scope:op.scope,
 observed_at:new Date().toISOString(),provider_request_id:null,resource};
 const o=status==='SUCCEEDED'?{...common,status,acceptance:'CONFIRMED_ACCEPTED',result,error:null,reconcile_required:false,retry:'NEVER'}:
 status==='UNKNOWN'?{...common,status,acceptance:'UNKNOWN',result:null,error:{code:'UNAVAILABLE',provider_code:null,message:'Provider acceptance or complete output requires reconciliation',retry_after_ms:null},reconcile_required:true,retry:'AFTER_RECONCILIATION'}:
 {...common,status,acceptance:'CONFIRMED_REJECTED',result:null,error:{code:status==='UNSUPPORTED'?'UNSUPPORTED':'CONFLICT',provider_code:null,message:status==='UNSUPPORTED'?'Required trusted capability is unavailable':'Provider configuration or operation was rejected',retry_after_ms:null},reconcile_required:false,retry:'NEVER'};
 validateProviderOutcome({operation:op,outcome:o});return o as ProviderOutcome<K>;
}
export interface BlaxelAdapter extends ProviderAdapter{
 readCapturedOutput(scope:ProviderScope,resource:ResourceRef,processRef:string,maxBytes:number):Promise<CapturedBlaxelOutput>;
}
export function createBlaxelAdapter(scope:ProviderScope,hooks:BlaxelPersistenceHooks,deps:Partial<BlaxelTrustedDependencies>,ctx:ComponentContext):BlaxelAdapter{
 if(scope.provider!=='blaxel'||scope.environment_id!==ctx.env.HF_BLAXEL_WORKSPACE||scope.provider_account_id!==ctx.env.HF_BLAXEL_ACCOUNT_ID)fail('BLAXEL_PROCESS_INVALID','Adapter scope differs from private account configuration');
 for(const key of ['persistEarlyProcess','resolvePreparation','resolveResourceBinding','assignedBootGeneration','persistEarlyResource','recordObservation','assertResourceBinding','claimProcess','resolveProcess'] as const)if(typeof hooks[key]!=='function')fail('BLAXEL_PROCESS_UNAVAILABLE','Durable provider hooks unavailable');
 let activeOperation:ProviderOperation|null=null;let activeSignal:AbortSignal|null=null;
 const sdk=async()=>runtimeSDK(await configuredBlaxelSDK(ctx));
 const bound=async(op:ProviderOperation,signal:AbortSignal)=>{await hooks.assertResourceBinding(op);if(!deps.assertPreparedResource)fail('BLAXEL_PROCESS_UNAVAILABLE','Qualified preparation binding unavailable');await deps.assertPreparedResource(op);if(signal.aborted)fail('BLAXEL_OPERATION_UNAVAILABLE','Cancelled');};
 const read=<T>(fn:(s:AbortSignal)=>Promise<T>,op:ProviderOperation,signal:AbortSignal)=>boundedBlaxelOperation(fn,signal,Date.parse(op.deadline_at));
 const sandbox=async(op:ProviderOperation,signal:AbortSignal)=>{await bound(op,signal);return read(async()=>await(await sdk()).SandboxInstance.get(nativeName(op.resource?.native_sandbox_id)),op,signal);};
 const save=async<K extends ProviderMethod>(op:ProviderOperation<K>,o:ProviderOutcome<K>)=>{await hooks.recordObservation(op as ProviderOperation,o as ProviderOutcome);return o;};
 const processBinding=async(op:ProviderOperation,ref:string)=>{
  const r=await hooks.resolveProcess(op,ref);if(!r||r.process_ref!==ref||!equal(r.resource,op.resource)||!r.provider_metadata)fail('BLAXEL_CAPTURE_UNAVAILABLE','No current durable process binding');
  const m=r.provider_metadata;return{operation_id:text(m.operation_id,128),payload_digest:r.payload_digest,launch_digest:text(m.launch_digest,80),spool_path:text(m.spool_path),scope_digest:text(m.scope_digest,80),native_process_ref:r.native_process_ref??null};
 };
 const capture=async(sc:ProviderScope,resource:ResourceRef,ref:string,max:number):Promise<CapturedBlaxelOutput>=>{
  if(!equal(sc,scope)||!deps.assertPreparedResource||max>MAX_OUTPUT||max<0)fail('BLAXEL_CAPTURE_UNAVAILABLE','Trusted process binding unavailable');
  if(!activeOperation||!equal(activeOperation.scope,sc)||!equal(activeOperation.resource,resource))fail('BLAXEL_CAPTURE_UNAVAILABLE','No active authenticated operation binds this capture');
  const operation=activeOperation,control=blaxelCaptureControl(operation,ctx.signal,activeSignal??hooks.invocation.signal,hooks.invocation.signal);
  const observe=<T>(fn:(signal:AbortSignal)=>Promise<T>)=>boundedBlaxelOperation(fn,control.signal,control.deadline);
  await observe(()=>hooks.assertResourceBinding(operation));await observe(()=>deps.assertPreparedResource!(operation));
  const expected=await observe(()=>processBinding(operation,text(ref,128)));
  const expectedPath='/tmp/hyperfide-output/'+resource.sandbox_boot_generation+'/'+ref;
  if(expected.spool_path!==expectedPath||expected.scope_digest!==scopeDigest(scope)||!/^hf-[a-f0-9]{40}$/.test(ref))fail('BLAXEL_CAPTURE_UNAVAILABLE','Process path binding differs');
  const instance=await observe(async()=>await(await sdk()).SandboxInstance.get(nativeName(resource.native_sandbox_id)));
  const readFile=async(path:string,limit:number)=>{
   const blob=await observe(()=>instance.fs.readBinary(path));
   if(!(blob instanceof Blob)||blob.size>limit)fail('BLAXEL_CAPTURE_UNAVAILABLE','Capture exceeds byte limit');
   return new Uint8Array(await observe(()=>blob.arrayBuffer()));
  };
  const providerProcess=await observe(signal=>instance.process.get(ref,{signal,retry:false}));
  if(providerProcess.status==='running'||providerProcess.name!==ref||providerProcess.pid!==expected.native_process_ref||!Number.isSafeInteger(providerProcess.exitCode))fail('BLAXEL_CAPTURE_UNAVAILABLE','Native process identity/terminal exit is not current');
  const receipt=JSON.parse(Buffer.from(await readFile(expectedPath+'/receipt.json',32768)).toString('utf8')) as unknown;
  const r=object(receipt),outSize=r.stdout_size,errSize=r.stderr_size;
  if(r.exit_code!==providerProcess.exitCode)fail('BLAXEL_CAPTURE_UNAVAILABLE','Actual provider/subreaper exit differs from captured child exit');
  if(!Number.isSafeInteger(outSize)||!Number.isSafeInteger(errSize)||(outSize as number)<0||(errSize as number)<0||(outSize as number)+(errSize as number)>max)fail('BLAXEL_CAPTURE_UNAVAILABLE','Capture inventory exceeds bounds');
  const stdout=await readFile(expectedPath+'/stdout',outSize as number),stderr=await readFile(expectedPath+'/stderr',errSize as number);
  // Re-read the atomically published receipt to refuse a concurrent replacement.
  const after=JSON.parse(Buffer.from(await readFile(expectedPath+'/receipt.json',32768)).toString('utf8'));
  if(!equal(receipt,after))fail('BLAXEL_CAPTURE_UNAVAILABLE','Capture changed during read');
  await observe(()=>hooks.assertResourceBinding(operation));await observe(()=>deps.assertPreparedResource!(operation));
  const verified=verifyBlaxelCapturedOutput({receipt,stdout,stderr,scope,resource,process_ref:ref,expected,maxBytes:max});
  if(control.signal.aborted||Date.now()>=control.deadline)fail('BLAXEL_CAPTURE_UNAVAILABLE','Capture deadline expired before verified evidence was released');
  return verified;
 };
 const adapter:Partial<BlaxelAdapter>={provider:'blaxel',readCapturedOutput:capture};
 for(const kind of PROVIDER_METHODS)(adapter as Obj)[kind]=async(raw:unknown,parent=ctx.signal)=>{
  const op=requireOperation(raw,kind,scope);activeOperation=op;activeSignal=parent;let attempted=false,known:ResourceRef|null=op.resource;
  if(parent.aborted||Date.parse(op.deadline_at)<=Date.now())return outcome(op,'UNKNOWN',null);
  try{
   if(kind==='create'){
    const create=op as ProviderOperation<'create'>;
    if(!deps.resolvePreparedBase)return outcome(op,'UNSUPPORTED',null);
    await hooks.assertResourceBinding(op);
    const generation=await hooks.assignedBootGeneration(create),base=await deps.resolvePreparedBase(create),model=planBlaxelCreate(create,generation,base),name=String((model.metadata as Obj).name),api=await sdk();
    let existing:BlaxelSandbox|null=null;
    try{existing=await read(()=>api.SandboxInstance.get(name),op,parent);}catch(e){if(statusCode(e)!==404)throw e;}
    let actual=existing;
    if(!actual){
     await hooks.assertResourceBinding(op);attempted=true;
     // The high-level helper can poll after a gateway timeout and perform
     // H2 warmup before returning. Use one official raw control-plane POST.
     const response=await read(signal=>api.createSandbox({body:model,throwOnError:false,signal}),op,parent);
     if(response.error!==undefined){
      if(response.response.status!==409)throw{status:response.response.status};
      actual=await read(()=>api.SandboxInstance.get(name),op,parent);
     }else{
      const value=object(response.data);
      actual={metadata:object(value.metadata),spec:object(value.spec),status:typeof value.status==='string'?value.status:undefined} as BlaxelSandbox;
     }
    }
    // Persist the actual returned candidate before placement/runtime validation.
    // A mismatch never grants ownership/readiness, but cannot erase an orphan.
    known=await retainBlaxelCreateCandidate({metadata:actual.metadata,spec:actual.spec,status:actual.status},model,scope,generation,
     candidate=>{known=candidate;},returnedName=>hooks.persistEarlyResource(create,returnedName));
    if(parent.aborted||Date.now()>Date.parse(op.deadline_at))return save(op,outcome(op,'UNKNOWN',null,known));
    return save(op,outcome(create,'SUCCEEDED',{provider_state:state(actual.status)==='RUNNING'?'RUNNING':'CREATING'},known));
   }
   if(kind==='execute'){
    const execute=op as ProviderOperation<'execute'>;
    if(!deps.resolveCredentialReferences||!deps.assertPreparedResource)return outcome(op,'UNSUPPORTED',null);
    const instance=await sandbox(op,parent),plan=planBlaxelProcess(execute);
    const env=await deps.resolveCredentialReferences(execute,execute.parameters.env_refs,parent);
    if(Object.keys(env).length!==Object.keys(execute.parameters.env_refs).length||Object.keys(env).some(k=>!Object.hasOwn(execute.parameters.env_refs,k)||typeof env[k]!=='string'||env[k]!.includes('\0')))fail('BLAXEL_PROCESS_INVALID','Credential resolver returned different bindings');
    const record={process_ref:plan.process_ref,spool_path:plan.spool_path,launch_digest:plan.launch_digest};
    const claim=await hooks.claimProcess(execute,{process_ref:plan.process_ref,payload_digest:op.identity.payload_digest,resource:op.resource!,state:'SUBMITTED',provider_metadata:{...record,operation_id:op.identity.operation_id,scope_digest:scopeDigest(scope)}});
    const claimed=claim.disposition;if(claimed!=='NEW'&&claimed!=='EXISTING'||claim.record.process_ref!==plan.process_ref||claim.record.payload_digest!==op.identity.payload_digest||!equal(claim.record.resource,op.resource))fail('BLAXEL_PROCESS_UNAVAILABLE','Process claim returned a different durable binding');
    let current:Obj|null=null;
    try{current=await read(s=>instance.process.get(plan.process_ref,{signal:s,retry:false}),op,parent);}catch(e){if(statusCode(e)!==404)throw e;}
    if(current){
     const prior=await processBinding(op,plan.process_ref);
     if(prior.operation_id!==op.identity.operation_id||prior.payload_digest!==op.identity.payload_digest||prior.launch_digest!==plan.launch_digest||current.command!==plan.request.command)fail('BLAXEL_CREATE_CONFLICT','Existing process does not match durable launch');
    }else{
     if(claimed==='EXISTING')return save(op,outcome(op,'UNKNOWN',null));
     await bound(op,parent);attempted=true;
     try{current=await read(()=>instance.process.exec({...plan.request,env}),op,parent);}
     catch(e){throw e;}
    }
    const nativePid=text(current.pid,128);await hooks.persistEarlyProcess(execute,nativePid);
    if(current.name!==plan.process_ref||current.command!==plan.request.command)fail('BLAXEL_CREATE_CONFLICT','Observed process does not match the durable launch');
    if(current.status==='running'&&!execute.parameters.durable){
     const waitDeadline=Math.min(Date.parse(op.deadline_at),Date.now()+execute.parameters.wait_timeout_ms);
     while(current.status==='running'&&!parent.aborted&&Date.now()<waitDeadline){
      await new Promise<void>(resolve=>setTimeout(resolve,Math.min(50,Math.max(1,waitDeadline-Date.now()))));
      if(Date.now()>=waitDeadline)break;
      current=await boundedBlaxelOperation(s=>instance.process.get(plan.process_ref,{signal:s,retry:false}),parent,waitDeadline);
     }
    }
    const result=noOutput(plan.process_ref,current);
    if(result.phase==='EXITED'){
     const captured=await capture(scope,op.resource!,plan.process_ref,MAX_OUTPUT);
     if(captured.exit_code!==result.exit_code)fail('BLAXEL_CAPTURE_UNAVAILABLE','API exit differs from captured exit');
     result.output={complete:true,truncated:false,byte_count:String(captured.stdout.length+captured.stderr.length),sha256:digest({stdout:bytesDigest(captured.stdout),stderr:bytesDigest(captured.stderr)})};
    }
    return save(op,outcome(execute,'SUCCEEDED',result));
   }
   if(kind==='inspect'||kind==='attach'){
    const processOp=op as ProviderOperation<'inspect'>|ProviderOperation<'attach'>;
    if(processOp.kind==='attach'&&processOp.parameters.resume_cursor!==null)return outcome(op,'UNSUPPORTED',null);
    const instance=await sandbox(op,parent),ref=processOp.parameters.process_ref;
    await processBinding(op,ref);
    const rawProcess=await read(s=>instance.process.get(ref,{signal:s,retry:false}),op,parent),result=noOutput(ref,rawProcess);
    if(result.phase==='EXITED'){
     const captured=await capture(scope,op.resource!,ref,MAX_OUTPUT);
     if(captured.exit_code!==result.exit_code)fail('BLAXEL_CAPTURE_UNAVAILABLE','Provider and spool exits differ');
     result.output={complete:true,truncated:false,byte_count:String(captured.stdout.length+captured.stderr.length),sha256:digest({stdout:bytesDigest(captured.stdout),stderr:bytesDigest(captured.stderr)})};
    }
    return save(op,outcome(processOp,'SUCCEEDED',result));
   }
   if(kind==='stop'){
    const stop=op as ProviderOperation<'stop'>;
    if(stop.parameters.signal==='KILL')return outcome(op,'UNSUPPORTED',null);
    const instance=await sandbox(op,parent);await processBinding(op,stop.parameters.process_ref);
    const prior=await read(signal=>instance.process.get(stop.parameters.process_ref,{signal,retry:false}),op,parent);
    if(prior.status!=='running'){
     const captured=await capture(scope,op.resource!,stop.parameters.process_ref,MAX_OUTPUT);
     return save(op,outcome(stop,'SUCCEEDED',{process_ref:stop.parameters.process_ref,termination:'CONFIRMED',exit_code:captured.exit_code}));
    }
    await bound(op,parent);attempted=true;await read(()=>instance.process.stop(stop.parameters.process_ref),op,parent);
    // Stopping the API parent is not independent proof that its complete job
    // tree is gone. Native12 cancellation or physical sandbox isolation supplies
    // that proof; keep resource ownership and require reconciliation meanwhile.
    return save(op,outcome(op,'UNKNOWN',null));
   }
   if(kind==='list'){
    const list=op as ProviderOperation<'list'>,api=await sdk(),page=await read(()=>api.SandboxInstance.list({limit:list.parameters.page_size,...(list.parameters.cursor===null?{}:{cursor:list.parameters.cursor})}),op,parent);
    if(!Array.isArray(page.data)||typeof page.hasMore!=='boolean'||page.data.length>list.parameters.page_size||page.hasMore&&typeof page.nextCursor!=='string')fail('BLAXEL_PROCESS_UNAVAILABLE','Provider inventory lacks bounded cursor metadata');
    const items=page.data.filter(s=>s.metadata.workspace===scope.environment_id&&s.spec.region===scope.region).map(s=>({native_sandbox_id:nativeName(s.metadata.name),provider_state:state(s.status)}));
    return save(op,outcome(list,'SUCCEEDED',{page:{scope,requested_cursor:list.parameters.cursor,next_cursor:page.hasMore?page.nextCursor!:null,has_more:page.hasMore,complete:!page.hasMore,consistency:'BEST_EFFORT',snapshot_id:null,observed_at:new Date().toISOString(),items}}));
   }
   if(kind==='observe'){
    const observed=op as ProviderOperation<'observe'>,instance=await sandbox(op,parent),st=state(instance.status);
    return save(op,outcome(observed,'SUCCEEDED',{provider_state:st,health:st==='RUNNING'?'HEALTHY':st==='FAILED'?'SUSPECT':'UNKNOWN'}));
   }
   if(kind==='destroy'){
    const destroy=op as ProviderOperation<'destroy'>;await sandbox(op,parent);await bound(op,parent);attempted=true;const api=await sdk();
    await read(()=>api.SandboxInstance.delete(op.resource!.native_sandbox_id),op,parent);
    try{await read(()=>api.SandboxInstance.get(op.resource!.native_sandbox_id),op,parent);return save(op,outcome(op,'UNKNOWN',null));}
    catch(e){if(statusCode(e)!==404)throw e;}
    return save(op,outcome(destroy,'SUCCEEDED',{deletion:'CONFIRMED'}));
   }
   // Unsupported methods are explicit. No fake quota, snapshot, network, copy or lifetime support.
   return outcome(op,'UNSUPPORTED',null);
  }catch(e){
   const code=(e as {code?:string})?.code??'';
   if(!attempted&&['BLAXEL_RUNTIME_ENV_UNSUPPORTED','BLAXEL_PERSISTENT_STORAGE_UNSUPPORTED','BLAXEL_POLICY_UNAVAILABLE','BLAXEL_RESOURCE_UNSUPPORTED'].includes(code))return save(op,outcome(op,'UNSUPPORTED',null));
   const unknown=attempted||known!==null||!['BLAXEL_PROCESS_INVALID','BLAXEL_PREPARATION_MISMATCH','BLAXEL_RESOURCE_UNSUPPORTED','BLAXEL_CREATE_CONFLICT'].includes((e as {code?:string})?.code??'');
   return save(op,outcome(op,unknown?'UNKNOWN':'FAILED',null,unknown?known:op.resource));
  }
 };
 return adapter as BlaxelAdapter;
}
export interface BlaxelStdinLedger{
 assertWritable(resource:ResourceRef,processRef:string):Promise<void>;
 beginWrite(resource:ResourceRef,processRef:string,instructionId:string,bytesDigest:string,byteCount:number):Promise<'NEW'|'CONFIRMED'|'UNKNOWN'>;
 finishWrite(resource:ResourceRef,processRef:string,instructionId:string,state:'CONFIRMED'|'UNKNOWN'):Promise<void>;
}
/** A transport failure may occur after a prefix was delivered. Never replay an
 * instruction or assume atomic stdin writes from an empty HTTP response. */
export async function writeBlaxelStdin(process:Pick<BlaxelProcess,'writeStdin'|'closeStdin'>,ledger:BlaxelStdinLedger,resource:ResourceRef,processRef:string,instructionId:string,bytes:Uint8Array,signal:AbortSignal,deadline:number):Promise<{state:'CONFIRMED'|'UNKNOWN';replay_allowed:false}>{
 text(instructionId,128);text(processRef,128);if(!(bytes instanceof Uint8Array)||bytes.length>1024*1024)fail('BLAXEL_PROCESS_INVALID','Bounded stdin bytes required');
 await ledger.assertWritable(resource,processRef);
 const prior=await ledger.beginWrite(resource,processRef,instructionId,bytesDigest(bytes),bytes.length);
 if(prior!=='NEW')return{state:prior,replay_allowed:false};
 try{await boundedBlaxelOperation(()=>process.writeStdin(processRef,bytes),signal,deadline);await ledger.finishWrite(resource,processRef,instructionId,'CONFIRMED');return{state:'CONFIRMED',replay_allowed:false};}
 catch{await ledger.finishWrite(resource,processRef,instructionId,'UNKNOWN');return{state:'UNKNOWN',replay_allowed:false};}
}
type RegistryCapability={registerProviderAdapter(provider:'blaxel',factory:(scope:ProviderScope,hooks:BlaxelPersistenceHooks)=>ProviderAdapter):()=>void;registerProviderOwnershipProbe?:(provider:'blaxel',probe:(scope:ProviderScope,operationId:string,nativeId:string,signal:AbortSignal)=>Promise<{matches:boolean;operation_id:string;native_sandbox_id:string;evidence_digest:string}>)=>()=>void;registerIsolationTransport?:(provider:'blaxel',factory:(scope:ProviderScope)=>ReturnType<typeof createBlaxelIsolationTransport>)=>()=>void};
type DependencyContext=ComponentContext&{dependencies?:{require<T>(id:string,name:string,guard:(v:unknown)=>v is T):T}};

interface BlaxelCredentialAuthority{
 resolveCredentialReferences(invocation:InvocationContext,request:{references:Array<{name:string;reference_id:string}>;purpose:'WORKER_PROCESS';sandbox_id:string;boot_id:string;boot_generation:string},signal?:AbortSignal):Promise<Readonly<Record<string,string>>>;
}
interface BlaxelPrivatePolicy{
 schema_version:1;lifecycle:BlaxelLifetimePolicy;network_mode:'ISOLATED'|'PRIVATE';network:Obj;
 volumes:Obj[];runtime_extra_args:Record<string,string>;runtime_env_refs:Record<string,string>;preparation_seed_reference:string;
}
async function readPrivateBlaxelPolicy(ctx:ComponentContext,scope:ProviderScope,expectedDigest:string):Promise<BlaxelPrivatePolicy>{
 const filename=ctx.env.HF_BLAXEL_ADAPTER_CONFIG;
 if(!filename||!path.isAbsolute(filename)||await fs.realpath(filename)!==filename)fail('BLAXEL_POLICY_UNAVAILABLE','Trusted absolute adapter policy file required');
 const stat=await fs.lstat(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576||(stat.mode&0o077)!==0||typeof process.getuid==='function'&&stat.uid!==process.getuid())fail('BLAXEL_POLICY_UNAVAILABLE','Private bounded owner-only policy required');
 const config=shape(JSON.parse(await fs.readFile(filename,'utf8')),['schema_version','profiles']);
 if(config.schema_version!==1||!Array.isArray(config.profiles)||config.profiles.length>1000)fail('BLAXEL_POLICY_UNAVAILABLE','Invalid provider policy version');
 const matches=config.profiles.filter(raw=>{
  const p=shape(raw,['routing','body']),routing=shape(p.routing,['organisation_id','pool_id','provider_account_id','environment_id','region']);
  return Object.keys(routing).every(k=>routing[k]===scope[k as keyof ProviderScope]);
 });
 if(matches.length!==1)fail('BLAXEL_POLICY_UNAVAILABLE','Exactly one provider policy must match this pool');
 const body=shape(object(matches[0]).body,['schema_version','lifecycle','network_mode','network','volumes','runtime_extra_args','runtime_env_refs','preparation_seed_reference']);
 if(digest(body)!==expectedDigest||body.schema_version!==1||!['ISOLATED','PRIVATE'].includes(String(body.network_mode)))
  fail('BLAXEL_POLICY_UNAVAILABLE','Provider policy body differs from durable configuration digest');
 validateBlaxelLifetimePolicy(body.lifecycle);object(body.network);object(body.runtime_extra_args);
 const refs=object(body.runtime_env_refs);
 // Current14 deliberately refuses preboot secret resolution. Preview runtime
 // updates remain gated; process references are injected only after RUNNING.
 if(Object.keys(refs).length)fail('BLAXEL_RUNTIME_ENV_UNSUPPORTED','Preboot worker credentials and unqualified runtime updates are disabled; use post-enrollment process references');
 if(!Array.isArray(body.volumes)||body.volumes.length>16)fail('BLAXEL_POLICY_UNAVAILABLE','Bounded volume policy required');
 text(body.preparation_seed_reference,2048);
 return body as unknown as BlaxelPrivatePolicy;
}
function trustedBlaxelDependencies(ctx:ComponentContext,hooks:BlaxelPersistenceHooks,credentials:BlaxelCredentialAuthority):BlaxelTrustedDependencies{
 return{
  assertPreparedResource:async op=>hooks.assertResourceBinding(op),
  resolvePreparedBase:async op=>{
   assertInvocation(hooks.invocation);
   const resolved=await hooks.resolvePreparation(op);
   if(!equal(resolved.scope,op.scope)||resolved.preparation_digest!==op.preparation_digest||!equal(resolved.parameters,op.parameters)||
    !resolved.adapter_policy_digest)fail('BLAXEL_POLICY_UNAVAILABLE','Actual preparation resolver must bind provider policy digest');
   const policy=await readPrivateBlaxelPolicy(ctx,op.scope,resolved.adapter_policy_digest);
   if(policy.network_mode!==op.parameters.network)fail('BLAXEL_POLICY_UNAVAILABLE','Network policy differs from durable intent');
   let artifactDigest:string,qualification:'QUALIFIED'|'TRUSTED_PREPARATION_SEED';
   if(resolved.purpose==='PREPARATION'){
    if(resolved.prepared_base!==null||op.parameters.preparation_reference!==policy.preparation_seed_reference)
     fail('BLAXEL_PREPARATION_MISMATCH','Preparation seed differs from trusted private policy');
    const pinned=/(?:@sha256:|:)([a-f0-9]{64})$/.exec(policy.preparation_seed_reference);
    if(!pinned)fail('BLAXEL_POLICY_UNAVAILABLE','Preparation seed must be an immutable pinned image');
    artifactDigest='sha256:'+pinned[1];qualification='TRUSTED_PREPARATION_SEED';
   }else{
    const row=object(resolved.prepared_base),reference=object(row.provider_reference);
    if(row.state!=='QUALIFIED'||row.preparation_digest!==op.preparation_digest||row.configuration_digest!==op.scope.configuration_digest||
      reference.preparation_reference!==op.parameters.preparation_reference||typeof row.expires_at!=='string'&&!(row.expires_at instanceof Date)||
      Date.parse(String(row.expires_at))<=Date.now())fail('BLAXEL_PREPARATION_MISMATCH','Actual qualified provider base is expired or mismatched');
    const pinned=/^sandbox\/[a-z0-9-]+:([a-f0-9]{64})$/.exec(op.parameters.preparation_reference);
    if(!pinned)fail('BLAXEL_PREPARATION_MISMATCH','Published provider image must bind an immutable full plan');
    artifactDigest='sha256:'+pinned[1];if(row.provider_prepared_digest!==artifactDigest)fail('BLAXEL_PREPARATION_MISMATCH','Qualified registry artifact digest differs from immutable provider image');qualification='QUALIFIED';
   }
   return{qualification_status:qualification,purpose:resolved.purpose,scope:op.scope,
    preparation_digest:resolved.preparation_digest,preparation_reference:op.parameters.preparation_reference,
    provider_prepared_digest:artifactDigest,resources:op.parameters.resources,lifecycle:policy.lifecycle,network_mode:policy.network_mode,
    network:policy.network,volumes:policy.volumes,runtime_extra_args:policy.runtime_extra_args};
  },
  resolveCredentialReferences:async(op,refs,signal)=>{
   assertInvocation(hooks.invocation);await hooks.assertResourceBinding(op);
   if(Object.keys(refs).length===0)return{};
   const target=await hooks.resolveResourceBinding(op);
   if(target.organisation_id!==op.scope.organisation_id||target.run_id!==hooks.invocation.principal.run_id||
     target.boot_generation!==op.resource?.sandbox_boot_generation)fail('BLAXEL_PROCESS_INVALID','Secret target differs from current authenticated operation');
   const values=await credentials.resolveCredentialReferences(hooks.invocation,{
    references:Object.entries(refs).map(([name,reference])=>({name,reference_id:reference.slice('secret-ref:'.length)})),
    purpose:'WORKER_PROCESS',sandbox_id:target.sandbox_id,boot_id:target.boot_id,boot_generation:target.boot_generation},signal);
   await hooks.assertResourceBinding(op);return{...values};
  },
 };
}
function assertBlaxelAdministrativeScope(scope:ProviderScope,ctx:Pick<ComponentContext,'env'>):void{
 if(scope.provider!=='blaxel'||!ctx.env.HF_BLAXEL_ACCOUNT_ID||scope.provider_account_id!==ctx.env.HF_BLAXEL_ACCOUNT_ID||!ctx.env.HF_BLAXEL_WORKSPACE||scope.environment_id!==ctx.env.HF_BLAXEL_WORKSPACE)fail('BLAXEL_PROCESS_INVALID','Administrative scope differs from trusted provider configuration');
}
async function probeBlaxelOwnership(ctx:ComponentContext,scope:ProviderScope,operationId:string,nativeId:string,signal:AbortSignal){
 assertBlaxelAdministrativeScope(scope,ctx);
 const api=runtimeSDK(await configuredBlaxelSDK(ctx)),actual=await boundedBlaxelOperation(()=>api.SandboxInstance.get(nativeName(nativeId)),signal,Date.now()+15000);
 const labels=object(actual.metadata.labels??{}),observed_at=new Date().toISOString();
 const matches=actual.metadata.name===nativeId&&actual.metadata.workspace===scope.environment_id&&actual.spec.region===scope.region&&labels['hyperfide-operation']===operationId&&labels['hyperfide-scope']===scopeDigest(scope)&&typeof labels['hyperfide-boot']==='string'&&/^[1-9][0-9]{0,18}$/.test(labels['hyperfide-boot'] as string);
 return{matches,operation_id:operationId,native_sandbox_id:nativeId,evidence_digest:digest({scope,operationId,nativeId,observed_at,labels:{operation:labels['hyperfide-operation']??null,scope:labels['hyperfide-scope']??null,boot:labels['hyperfide-boot']??null,preparation:labels['hyperfide-preparation']??null},matches})};
}
export function createBlaxelIsolationTransport(scope:ProviderScope,ctx:Pick<ComponentContext,'env'|'signal'>){
 assertBlaxelAdministrativeScope(scope,ctx);
 const check=(raw:unknown,kind:'destroy'|'observe')=>requireOperation(raw,kind,scope);
 const verify=(s:BlaxelSandbox,op:ProviderOperation)=>{
  const labels=s.metadata.labels as Obj|undefined;
  if(s.metadata.name!==op.resource?.native_sandbox_id||s.metadata.workspace!==scope.environment_id||s.spec.region!==scope.region||
   labels?.['hyperfide-scope']!==scopeDigest(scope)||labels?.['hyperfide-boot']!==op.resource?.sandbox_boot_generation||
   op.preparation_digest!==null&&labels?.['hyperfide-preparation']!==op.preparation_digest)
   fail('BLAXEL_CREATE_CONFLICT','Isolation refuses a resource whose current boot/configuration markers differ');
 };
 return Object.freeze({
  async destroy(raw:ProviderOperation<'destroy'>,signal=ctx.signal):Promise<ProviderOutcome<'destroy'>>{
   const op=check(raw,'destroy') as ProviderOperation<'destroy'>;let attempted=false;
   try{
    const api=runtimeSDK(await configuredBlaxelSDK(ctx));
    const before=await boundedBlaxelOperation(()=>api.SandboxInstance.get(nativeName(op.resource!.native_sandbox_id)),signal,Date.parse(op.deadline_at));verify(before,op);
    attempted=true;await boundedBlaxelOperation(()=>api.SandboxInstance.delete(op.resource!.native_sandbox_id),signal,Date.parse(op.deadline_at));
    try{const after=await boundedBlaxelOperation(()=>api.SandboxInstance.get(op.resource!.native_sandbox_id),signal,Date.parse(op.deadline_at));verify(after,op);return outcome(op,'UNKNOWN',null);}
    catch(e){if(statusCode(e)!==404)throw e;}
    return outcome(op,'SUCCEEDED',{deletion:'CONFIRMED'});
   }catch(e){return outcome(op,attempted||statusCode(e)!==409?'UNKNOWN':'FAILED',null);}
  },
  async observe(raw:ProviderOperation<'observe'>,signal=ctx.signal):Promise<ProviderOutcome<'observe'>>{
   const op=check(raw,'observe') as ProviderOperation<'observe'>;
   try{
    const api=runtimeSDK(await configuredBlaxelSDK(ctx));
    let actual:BlaxelSandbox;
    try{actual=await boundedBlaxelOperation(()=>api.SandboxInstance.get(nativeName(op.resource!.native_sandbox_id)),signal,Date.parse(op.deadline_at));}
    catch(e){if(statusCode(e)===404)return outcome(op,'SUCCEEDED',{provider_state:'DESTROYED',health:'ABSENT'});throw e;}
    verify(actual,op);const st=state(actual.status);return outcome(op,'SUCCEEDED',{provider_state:st,health:st==='RUNNING'?'HEALTHY':'UNKNOWN'});
   }catch{return outcome(op,'UNKNOWN',null);}
  }
 });
}

export function createComponent(ctx:ComponentContext):Component{
 const dependencies=(ctx as DependencyContext).dependencies;
 const disposers:Array<()=>void>=[];
 if(dependencies){
  const registry=dependencies.require<RegistryCapability>('8.2','provider.registry.v1',(v):v is RegistryCapability=>!!v&&typeof v==='object'&&typeof(v as RegistryCapability).registerProviderAdapter==='function');
  const credentials=dependencies.require<BlaxelCredentialAuthority>('14.2','identity.credentials',(v):v is BlaxelCredentialAuthority=>!!v&&typeof v==='object'&&typeof(v as BlaxelCredentialAuthority).resolveCredentialReferences==='function');
  disposers.push(registry.registerProviderAdapter('blaxel',(scope,hooks)=>createBlaxelAdapter(scope,hooks,trustedBlaxelDependencies(ctx,hooks,credentials),ctx)));
  if(typeof registry.registerProviderOwnershipProbe==='function')disposers.push(registry.registerProviderOwnershipProbe('blaxel',(scope,operationId,nativeId,signal)=>probeBlaxelOwnership(ctx,scope,operationId,nativeId,signal)));
  if(typeof registry.registerIsolationTransport==='function')disposers.push(registry.registerIsolationTransport('blaxel',scope=>createBlaxelIsolationTransport(scope,ctx)));
 }
 return{apiVersion:1,close:()=>{for(const dispose of disposers.reverse())dispose();},actions:{
  'blaxel.process.describe':input=>{shape(input,[]);return{schema_version:1,sdk:BLAXEL_PINS.sdk,adapter_registered:disposers.length>0,
   external_id_is_authority:false,automatic_failed_replacement:false,stdin_default_eof:true,
   stdin_pipe_survives_api_restart:false,ambiguous_stdin_replay:false,maximum_captured_output_bytes:MAX_OUTPUT,
   complete_output_requires_spool:true,authority:'NONE',live_qualification:'NOT_EVALUATED'};},
  'blaxel.process.create-plan':input=>{
   const o=shape(input,['operation','boot_generation','base']);const op=validateProviderOperation(o.operation);
   if(op.kind!=='create')fail('BLAXEL_PROCESS_INVALID','Create operation required');
   return{plan:planBlaxelCreate(op,text(o.boot_generation,19),o.base as QualifiedBlaxelBase),authority:'NONE',live_qualification:'NOT_EVALUATED'};
  },
  'blaxel.process.verify-create':input=>{
   const o=shape(input,['observation','expected','scope']);
   return{...verifyBlaxelCreate(o.observation,object(o.expected),o.scope as ProviderScope),authority:'NONE',input_observation_is_not_provider_evidence:true};
  },
  'blaxel.process.capture-validate':input=>{
   const o=shape(input,['receipt','stdout_base64','stderr_base64','scope','resource','process_ref','expected','max_bytes']);
   const decode=(v:unknown)=>{if(typeof v!=='string'||v.length>22369624)fail('BLAXEL_PROCESS_INVALID','Bounded base64 required');const b=Buffer.from(v,'base64');if(b.toString('base64')!==v)fail('BLAXEL_PROCESS_INVALID','Noncanonical output encoding');return b;};
   const r=verifyBlaxelCapturedOutput({receipt:o.receipt,stdout:decode(o.stdout_base64),stderr:decode(o.stderr_base64),scope:o.scope as ProviderScope,resource:o.resource as ResourceRef,process_ref:text(o.process_ref,128),expected:o.expected as Parameters<typeof verifyBlaxelCapturedOutput>[0]['expected'],maxBytes:o.max_bytes as number});
   return{complete:true,exit_code:r.exit_code,spool_digest:r.spool_digest,capture:r.capture,byte_count:r.stdout.length+r.stderr.length,authority:'NONE',input_observation_is_not_provider_evidence:true};
  },
  'blaxel.process.plan':input=>{
   const o=shape(input,['operation']);const op=validateProviderOperation(o.operation);
   if(op.kind!=='execute')fail('BLAXEL_PROCESS_INVALID','Execute operation required');
   const p=planBlaxelProcess(op);return{process_ref:p.process_ref,spool_path:p.spool_path,launch_digest:p.launch_digest,
    request:p.request,authority:'NONE',live_qualification:'NOT_EVALUATED'};
  },
 }};
}
