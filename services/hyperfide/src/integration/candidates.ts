import fs from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {AsyncLocalStorage} from 'node:async_hooks';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {cleanupIntegration,releaseTerminalReservations} from './cleanup.js';

const exec=promisify(execFile);
export interface DB {query<Row extends pg.QueryResultRow=any>(text:string,values?:unknown[]):Promise<pg.QueryResult<Row>>}
interface IntegrationInvocation {context:ComponentContext;invocation:unknown}
const invocationStorage=new AsyncLocalStorage<IntegrationInvocation>();
interface Gateway {withPrimaryTransaction<T>(options:{timeoutMs:number;maxRetries:number;guard?:(db:DB)=>Promise<void>;signal?:AbortSignal},fn:(db:DB)=>Promise<T>):Promise<T>}
function gateway(context:ComponentContext):Gateway{
 const resources=(context as unknown as {resources?:{gateway?:Gateway}}).resources;
 if(!resources?.gateway)fail('INTEGRATION_DEPENDENCY_NOT_READY','Primary transaction gateway4.2 required');
 return resources.gateway;
}
export async function runnerRemote(context:ComponentContext):Promise<{prepare:(db:DB,invocation:unknown,plan:Record<string,unknown>)=>Promise<unknown>;execute:(permit:unknown,signal:AbortSignal)=>Promise<Record<string,any>>;recover?:(db:DB,invocation:unknown,plan:Record<string,unknown>)=>Promise<unknown>}>{
 const moduleName='../runner/bridge.js';let factory:unknown;try{factory=(await import(moduleName)).requireRunnerRemote;}catch{fail('INTEGRATION_REMOTE_EXECUTOR_UNAVAILABLE','Observed runner.remote.v1 provider execution required');}
 if(typeof factory!=='function')fail('INTEGRATION_REMOTE_EXECUTOR_UNAVAILABLE','Trusted remote execution factory unavailable');
 const remote=factory(context);if(!remote||typeof remote.prepare!=='function'||typeof remote.execute!=='function')fail('INTEGRATION_REMOTE_EXECUTOR_UNAVAILABLE','Remote capability shape invalid');return remote;
}
export function bindScope(ctx:ComponentContext,component:Component):Component{
 let settings:Promise<IntegrationConfig>|undefined;
 const actions:Component['actions']={};
 for(const [name,handler] of Object.entries(component.actions))actions[name]=async(input,context)=>{
 const cfg=await(settings??=config(ctx.env));const s=scope(obj(input));
 if(s.organisation_id!==cfg.organisation_id)fail('INTEGRATION_SCOPE_DENIED','Organisation differs from trusted service');
 let invocation:unknown;
 try{const moduleName='../identity/enrollment.js';invocation=(await import(moduleName)).invocationOf(context);}catch{fail('AUTH_REQUIRED','Authenticated action invocation required');}
 const principal=(invocation as {principal:{organisation_id:string;run_id:string}}).principal;if(principal.organisation_id!==s.organisation_id||principal.run_id!==s.run_id)fail('INTEGRATION_SCOPE_DENIED','Body scope differs from the authenticated invocation scope');
 return invocationStorage.run({context,invocation},()=>Promise.resolve(handler(input,context)));
 };return {...component,actions};
}
export function currentInvocation():IntegrationInvocation{
 const state=invocationStorage.getStore();if(!state?.invocation)fail('AUTH_REQUIRED','Authenticated action invocation required');return state;
}
export async function prepareRemote(db:DB,plan:Record<string,unknown>):Promise<{remote:Awaited<ReturnType<typeof runnerRemote>>;permit:unknown;plan:Record<string,unknown>;expected_source_object_id?:string|undefined;expected_source_tree_id?:string|undefined}>{
 const active=currentInvocation(),remote=await runnerRemote(active.context);
 const env=active.context.env;const executable=env.HYPERFIDE_REMOTE_NODE_DIGEST;if(!executable)fail('INTEGRATION_REMOTE_RUNTIME_UNAVAILABLE','Observed remote Node executable digest required');digest(executable);const bridgeName='../runner/bridge.js';const bindingReader=(await import(bridgeName)).readRunnerBinding;if(typeof bindingReader!=='function')fail('INTEGRATION_REMOTE_RUNTIME_UNAVAILABLE','Actual runner source binding reader required');const identity=active.invocation as {principal:{organisation_id:string;run_id:string}};const binding=await bindingReader(db,{organisation_id:identity.principal.organisation_id,run_id:identity.principal.run_id,session_id:plan.session_id});if(binding.repository_id!==plan.repository_id||plan.expected_source_object_id!==undefined&&binding.source_object_id!==plan.expected_source_object_id||plan.expected_source_tree_id!==undefined&&binding.source_tree_id!==plan.expected_source_tree_id)fail('INTEGRATION_REMOTE_SOURCE_NOT_PREPARED','Observed runner workspace must be prepared for the exact requested Git source');const {expected_source_object_id,expected_source_tree_id,...physicalPlan}=plan;plan={...physicalPlan,source_provenance_digest:plan.source_digest,source_digest:digest(binding.source_digest),executable_digest:executable,environment_digest:hash(canonical(plan.environment??{})),artifact_paths:[]};const permit=await remote.prepare(db,active.invocation,plan);return {remote,permit,plan,expected_source_object_id:typeof expected_source_object_id==='string'?expected_source_object_id:undefined,expected_source_tree_id:typeof expected_source_tree_id==='string'?expected_source_tree_id:undefined};
}
export function snapshotRemote(prepared:Awaited<ReturnType<typeof prepareRemote>>):Record<string,unknown>{
 const payload={plan:prepared.plan,expected_source_object_id:prepared.expected_source_object_id??null,expected_source_tree_id:prepared.expected_source_tree_id??null};return {...payload,digest:hash(canonical(payload))};
}
export async function restoreRemote(db:DB,snapshot:unknown):Promise<Awaited<ReturnType<typeof prepareRemote>>>{
 const value=obj(snapshot);keys(value,['plan','expected_source_object_id','expected_source_tree_id','digest']);const {digest:recorded,...payload}=value;if(hash(canonical(payload))!==recorded)fail('INTEGRATION_REMOTE_PLAN_CORRUPT','Immutable remote plan snapshot digest differs');
 const active=currentInvocation(),remote=await runnerRemote(active.context);if(typeof remote.recover!=='function')fail('INTEGRATION_REMOTE_RECOVERY_UNAVAILABLE','Actual runner.remote existing-only recovery required; no redispatch fallback');
 const plan=obj(value.plan),permit=await remote.recover(db,active.invocation,plan);return {remote,permit,plan,expected_source_object_id:value.expected_source_object_id===null?undefined:oid(value.expected_source_object_id),expected_source_tree_id:value.expected_source_tree_id===null?undefined:oid(value.expected_source_tree_id)};
}
export async function executeRemote(prepared:Awaited<ReturnType<typeof prepareRemote>>):Promise<Record<string,any>>{
 const active=currentInvocation();const captured=await prepared.remote.execute(prepared.permit,active.context.signal);const decode=(value:unknown):string=>{const output=obj(value);if(!(output.bytes instanceof Uint8Array)||output.complete!==true||String(output.size_bytes)!==String(output.bytes.byteLength)||hash(Buffer.from(output.bytes))!==output.digest)fail('INTEGRATION_REMOTE_OUTPUT_INVALID','Complete independently hashed capture required');return new TextDecoder('utf-8',{fatal:true}).decode(output.bytes);};const result:Record<string,any>={...captured,stdout:decode(captured.stdout),stderr:decode(captured.stderr)};
 if(result.status!=='COMPLETED'||result.output_complete!==true||typeof result.stdout!=='string'||typeof result.stderr!=='string'||result.exit_code!==0||result.session_id!==prepared.plan.session_id||result.source_digest!==prepared.plan.source_digest||result.policy_digest!==prepared.plan.policy_digest||result.source_provenance_digest!==prepared.plan.source_provenance_digest||!result.process_ref||!result.sandbox_id||!result.slot_id||!result.cleanup?.complete||result.cleanup.observed_process_absent!==true)fail('INTEGRATION_REMOTE_OUTCOME_UNKNOWN','Remote execution did not prove complete current bound output and process cleanup');
 if(prepared.expected_source_object_id!==undefined&&result.source_object_id!==prepared.expected_source_object_id||prepared.expected_source_tree_id!==undefined&&result.source_tree_id!==prepared.expected_source_tree_id||result.source_manifest_digest!==prepared.plan.source_digest)fail('INTEGRATION_REMOTE_SOURCE_INVALID','Physical result source differs from actual prepared candidate');
 if(hash(result.stdout)!==result.stdout_digest||hash(result.stderr)!==result.stderr_digest)fail('INTEGRATION_REMOTE_OUTPUT_INVALID','Remote captured output hash mismatch');
 digest(result.spool_digest);digest(result.cleanup.receipt_digest);return result;
}
export interface Scope {organisation_id:string;run_id:string}
export function fail(code:string,message:string):never{throw new FoundationError(code,message);}
export function obj(v:unknown):Record<string,unknown>{if(!object(v))fail('INTEGRATION_INVALID','Object required');return v;}
export function keys(v:Record<string,unknown>,required:string[],optional:string[]=[]):void{
if(required.some(k=>!(k in v))||Object.keys(v).some(k=>![...required,...optional].includes(k)))fail('INTEGRATION_INVALID','Unexpected or missing fields');}
export function uuid(v:unknown):string{if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v))fail('INTEGRATION_INVALID','Canonical UUID required');return v;}
export function oid(v:unknown):string{if(typeof v!=='string'||!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v))fail('INTEGRATION_INVALID','Full Git object ID required');return v;}
export function digest(v:unknown):string{if(typeof v!=='string'||!/^sha256:[0-9a-f]{64}$/.test(v))fail('INTEGRATION_INVALID','SHA256 digest required');return v;}
export function decimal(v:unknown):string{if(typeof v!=='string'||!/^[1-9][0-9]*$/.test(v)||BigInt(v)>9223372036854775807n)fail('INTEGRATION_INVALID','Positive canonical generation required');return v;}
export function scope(v:Record<string,unknown>):Scope{return {organisation_id:uuid(v.organisation_id),run_id:uuid(v.run_id)};}
export function canonical(v:unknown):string{
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'&&Number.isFinite(v)&&Number.isSafeInteger(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return fail('INTEGRATION_INVALID','Canonical JSON has unsupported value');
}
export const hash=(v:string|Buffer):string=>'sha256:'+createHash('sha256').update(v).digest('hex');
export function values(s:Scope):string[]{return [s.organisation_id,s.run_id];}
export async function semanticDisposition(db:DB,s:{organisation_id:string;run_id:string},mode:'READ'|'WRITE'):Promise<void>{
 const moduleName='../storage/dispositions.js';let fence:unknown;try{const api=await import(moduleName);fence=mode==='WRITE'?api.writeSemanticDisposition:api.readSemanticDisposition;}catch{fail('INTEGRATION_SEMANTIC_FENCE_UNAVAILABLE','Actual storage semantic disposition fence required');}
 if(typeof fence!=='function')fail('INTEGRATION_SEMANTIC_FENCE_UNAVAILABLE','Current semantic fence API unavailable');await fence(db,s);
}
export async function tx<T>(_pool:unknown,fn:(db:DB)=>Promise<T>,mode:'READ'|'WRITE'='WRITE'):Promise<T>{
 const active=currentInvocation(),i=active.invocation as {guard?:(db:DB)=>Promise<void>;signal?:AbortSignal};
 if(typeof i.guard!=='function')fail('AUTH_REQUIRED','Current primary invocation guard required');
 return gateway(active.context).withPrimaryTransaction({timeoutMs:10000,maxRetries:2,guard:async db=>{const principal=(active.invocation as {principal:{organisation_id:string;run_id:string}}).principal;await semanticDisposition(db,principal,mode);await i.guard!(db);},signal:active.context.signal},fn);
}
/** Detached reads still use the genuine current primary guard. This facade is
 * never accepted as a branded transaction or held across remote/Git work. */
export function primaryClient():DB{
 return {query:async<Row extends pg.QueryResultRow=any>(text:string,parameters?:unknown[])=>{if(!/^\s*SELECT\b/i.test(text))fail('INTEGRATION_DETACHED_WRITE_DENIED','Detached primary facade accepts reads only; mutations require WRITE-fenced tx');return tx(null,db=>db.query<Row>(text,parameters),'READ');}};
}
const REMOTE_GATE_SCRIPT="import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';\nconst chunks=[];for await(const part of process.stdin)chunks.push(part);const compressed=JSON.parse(Buffer.concat(chunks).toString('utf8'));const {inflateSync}=await import('node:zlib');const bytes=inflateSync(Buffer.from(compressed.base64,'base64'),{maxOutputLength:16777216});if('sha256:'+createHash('sha256').update(bytes).digest('hex')!==compressed.digest)throw Error('scope manifest digest mismatch');const input=JSON.parse(bytes.toString('utf8'));\nconst h=b=>'sha256:'+createHash('sha256').update(b).digest('hex');\nif(!path.isAbsolute(input.module_path)||h(await fs.readFile(input.module_path))!==input.module_digest)throw Error('qualified remote integration runtime missing');\nconst runtime=await import(pathToFileURL(input.module_path).href),base='/tmp/hyperfide/integration-'+input.operation_id;\nawait fs.mkdir(base,{mode:0o700});const added=[];\ntry{\n let workingDirectory;\n if(input.mode==='CANDIDATE'){\n  workingDirectory=path.join(base,'source');await runtime.integrationGit(process.cwd(),['worktree','add','--detach',workingDirectory,input.candidate_head]);added.push({repository:process.cwd(),directory:workingDirectory});\n }else{\n  const configured=JSON.parse(process.env.HYPERFIDE_INTEGRATION_REPOSITORIES_JSON??'{}');\n  for(const repository of input.scope.repositories){\n   const source=repository.repository_id===input.repository_id?process.cwd():configured[repository.repository_id];\n   if(typeof source!=='string'||!path.isAbsolute(source)||await fs.realpath(source)!==source)throw Error('prepared multi-repository workspace missing');\n   const publication=[...input.scope.publications].reverse().find(p=>p.repository_id===repository.repository_id&&p.state==='PUBLISHED'&&p.observed_head===p.candidate_head);if(!publication)throw Error('scope repository unpublished');\n   const directory=path.join(base,repository.repository_id);await runtime.integrationGit(source,['worktree','add','--detach',directory,publication.candidate_head]);added.push({repository:source,directory});if(!workingDirectory)workingDirectory=directory;\n  }\n  await fs.writeFile(path.join(base,'scope-manifest.json'),JSON.stringify(input.scope)+'\\n',{mode:0o600});\n }\n if(!workingDirectory)throw Error('empty execution scope');\n const observed=await runtime.registeredScopeGate(input.gate,workingDirectory,base,input.input_digest,{...process.env,...input.harness_env,HYPERFIDE_SCOPE_MANIFEST:path.join(base,'scope-manifest.json')},input.mode!=='CANDIDATE');\n for(const entry of added){if(await runtime.integrationGit(entry.directory,['status','--porcelain','--untracked-files=all']))throw Error('qualification changed candidate source');}\n for(const entry of added.reverse())await runtime.integrationGit(entry.repository,['worktree','remove','--force',entry.directory]);added.length=0;await fs.rm(base,{recursive:true,force:true});\n process.stdout.write(JSON.stringify(observed)+'\\n');\n}finally{for(const entry of added.reverse())await runtime.integrationGit(entry.repository,['worktree','remove','--force',entry.directory]);await fs.rm(base,{recursive:true,force:true});}\n";
export async function prepareRemoteGate(db:DB,s:Scope,request:{session_id:string;reservation_id:string;repository_id:string;input_digest:string;policy_digest:string;gate:GateConfig;mode:'CANDIDATE'|'WAVE'|'PROGRAMME';candidate_head?:string;snapshot?:Record<string,any>}):Promise<Awaited<ReturnType<typeof prepareRemote>>>{
 const context=currentInvocation().context,env=context.env,operationId=randomUUID();
 const modulePath=env.HYPERFIDE_REMOTE_CLOSURE_MODULE,moduleDigest=env.HYPERFIDE_REMOTE_CLOSURE_DIGEST;
 if(!modulePath||!moduleDigest)fail('INTEGRATION_REMOTE_RUNTIME_UNAVAILABLE','Qualified remote integration runtime and exact digest required');
 const harnessEnv={HYPERFIDE_QUALIFICATION_ROOT:env.HYPERFIDE_REMOTE_QUALIFICATION_ROOT??'',HYPERFIDE_QUALIFIER_DIGEST:env.HYPERFIDE_QUALIFIER_DIGEST??'',HYPERFIDE_CHECKER_DIGEST:env.HYPERFIDE_CHECKER_DIGEST??''};
 const compact=request.snapshot?.publications?{...request.snapshot,publications:request.snapshot.publications.map((p:Record<string,any>)=>({repository_id:p.repository_id,candidate_head:p.candidate_head,observed_head:p.observed_head,state:p.state,input_manifest_digest:p.input_manifest_digest})),reviewObservations:request.snapshot.reviewObservations.map((r:Record<string,any>)=>({repository_id:r.repository_id,source_object_id:r.source_object_id,status:r.status,receipt_ids:r.receipt_ids??[]}))}:undefined;
 const data={operation_id:operationId,module_path:modulePath,module_digest:moduleDigest,mode:request.mode,repository_id:request.repository_id,candidate_head:request.candidate_head??null,scope:compact??null,gate:{...request.gate,covers:request.gate.proof.case_ids},input_digest:request.input_digest,harness_env:harnessEnv};
 const raw=Buffer.from(canonical(data));const stdin=canonical({version:1,encoding:'zlib-base64',digest:hash(raw),base64:deflateSync(raw).toString('base64')});if(Buffer.byteLength(stdin)>65536)fail('INTEGRATION_REMOTE_MANIFEST_UNBOUNDED','Scope requires a durable artifact-backed remote manifest');
 const expectedSource=request.mode==='CANDIDATE'?request.candidate_head:[...(request.snapshot?.publications??[])].reverse().find((p:Record<string,any>)=>p.repository_id===request.repository_id&&p.state==='PUBLISHED'&&p.observed_head===p.candidate_head)?.candidate_head;if(!expectedSource)fail('INTEGRATION_REMOTE_SOURCE_NOT_PREPARED','Exact current source object required');
 return prepareRemote(db,{session_id:request.session_id,operation_id:operationId,repository_id:request.repository_id,reservation_id:request.reservation_id,argv:['node','--input-type=module','-e',REMOTE_GATE_SCRIPT],cwd:'.',environment:{},stdin,expected_source_object_id:expectedSource,expected_source_tree_id:request.mode==='CANDIDATE'?request.snapshot?.tree:undefined,timeout_ms:request.gate.timeout_ms+60000,source_digest:hash(canonical({input_digest:request.input_digest,script_digest:hash(REMOTE_GATE_SCRIPT),gate:request.gate})),policy_digest:request.policy_digest});
}
export interface AdmittedIntegrationWork {kind:'CANDIDATE'|'SCOPE'|'PREPARATION';id:string}
export async function currentRun(db:DB,s:Scope,lock=false,admittedPublicationId?:string,observe=false,admittedWork?:AdmittedIntegrationWork):Promise<Record<string,any>>{
 const r=await db.query('SELECT * FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2'+(lock?' FOR UPDATE':''),values(s));
 const row=r.rows[0];if(!row||!['READY','RUNNING',...(observe?['SUCCEEDED']:[]),...(admittedPublicationId||admittedWork?['DRAINING','DRAINED']:[])].includes(row.state))fail('INTEGRATION_RUN_HELD','Run does not permit integration');
 const halted=await db.query('SELECT mode FROM hyperfide.integration_admission_halts WHERE organisation_id=$1 AND run_id=$2',values(s));
 if(halted.rowCount)fail('INTEGRATION_ADMISSION_STOPPED','Emergency control holds all new integration admissions');
 const moduleName='../recovery/control.js';let inspect:unknown;
 try{inspect=(await import(moduleName)).inspectRecoveryHold;}catch{fail('INTEGRATION_RECOVERY_UNAVAILABLE','Recovery hold inspector unavailable');}
 if(typeof inspect!=='function')fail('INTEGRATION_RECOVERY_UNAVAILABLE','Recovery hold inspector unavailable');
 const holds=await inspect(db,{...s,authority_epoch:row.authority_epoch});
 if(!Array.isArray(holds))fail('INTEGRATION_RECOVERY_UNAVAILABLE','Invalid recovery observation');
 let drainEligible=false;
 for(const hold of holds.filter(h=>h.status==='ACTIVE')){
  if(hold.mode==='DRAIN'&&(admittedPublicationId||admittedWork)){
   const table=admittedPublicationId?'publication_operations':admittedWork?.kind==='CANDIDATE'?'integration_jobs':admittedWork?.kind==='SCOPE'?'integration_scope_jobs':admittedWork?.kind==='PREPARATION'?'integration_preparations':null;
   if(!table)fail('INTEGRATION_DRAIN_AUTHORITY_MISSING','Existing admitted integration work required');const column=table==='integration_preparations'?'request_id':'id',states=table==='integration_preparations'?['PREPARING','OUTCOME_UNKNOWN']:['PENDING','RUNNING','OUTCOME_UNKNOWN'];
   const eligible=await db.query('SELECT 1 FROM hyperfide.'+table+' WHERE organisation_id=$1 AND run_id=$2 AND '+column+'=$3 AND created_at<=$4::timestamptz AND clock_timestamp()<$5::timestamptz AND state=ANY($6::text[])',[...values(s),uuid(admittedPublicationId??admittedWork!.id),hold.accepted_at,hold.drain_deadline,states]);if(eligible.rowCount){drainEligible=true;continue;}
  }
  fail('INTEGRATION_RECOVERY_HELD','Recovery control holds integration or drain authority has expired');
 }
 if(['DRAINING','DRAINED'].includes(row.state)&&!drainEligible)fail('INTEGRATION_DRAIN_AUTHORITY_MISSING','Actual existing-work drain eligibility was not proven');
 return row;
}
export interface GateConfig {id:string;kind:'build'|'test';argv:string[];timeout_ms:number;proof:{manifest_path:string;manifest_digest:string;registry_path:string;registry_digest:string;expected_assertion_ids:string[];case_ids:string[]}}
export interface RepositoryConfig {repository_id:string;path:string;target_ref:string;receive_path?:string;gates:GateConfig[];review_policy_digest:string;review_rubrics:string[];required_graph:boolean}
export interface IntegrationConfig {version:1;organisation_id:string;root:string;repositories:RepositoryConfig[];closure:Record<string,unknown>}
export async function config(env:Readonly<NodeJS.ProcessEnv>):Promise<IntegrationConfig>{
 const filename=env.HYPERFIDE_INTEGRATION_CONFIG;if(!filename)fail('INTEGRATION_CONFIG_MISSING','Trusted integration configuration required');
 const info=await fs.lstat(filename);if(!info.isFile()||info.isSymbolicLink()||info.size>262144)fail('INTEGRATION_CONFIG_INVALID','Bounded regular configuration required');
 const c=obj(JSON.parse(await fs.readFile(filename,'utf8')));keys(c,['version','organisation_id','root','repositories','closure']);
 if(c.version!==1||typeof c.root!=='string'||!path.isAbsolute(c.root)||!Array.isArray(c.repositories)||c.repositories.length===0||c.repositories.length>100)fail('INTEGRATION_CONFIG_INVALID','Invalid configuration');
 uuid(c.organisation_id);const root=await fs.realpath(c.root);if(root!==c.root)fail('INTEGRATION_CONFIG_INVALID','Root must be canonical');
 const seen=new Set<string>();
 for(const item of c.repositories){
  const r=obj(item);keys(r,['repository_id','path','target_ref','gates','review_policy_digest','review_rubrics','required_graph'],['receive_path']);
  const id=uuid(r.repository_id);if(seen.has(id))fail('INTEGRATION_CONFIG_INVALID','Duplicate repository');seen.add(id);
  if(typeof r.path!=='string'||typeof r.target_ref!=='string'||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(r.target_ref)||r.target_ref.includes('..')||r.target_ref.endsWith('/')||typeof r.required_graph!=='boolean')fail('INTEGRATION_CONFIG_INVALID','Invalid repository/ref');
  await safeDirectory(root,r.path);if(r.receive_path!==undefined){if(typeof r.receive_path!=='string')fail('INTEGRATION_CONFIG_INVALID','Invalid receive path');await safeDirectory(root,r.receive_path);}
  digest(r.review_policy_digest);
  if(!Array.isArray(r.review_rubrics)||!r.review_rubrics.length||new Set(r.review_rubrics).size!==r.review_rubrics.length)fail('INTEGRATION_CONFIG_INVALID','Explicit review rubrics required');r.review_rubrics.forEach(digest);
  if(!Array.isArray(r.gates)||!r.gates.length)fail('INTEGRATION_CONFIG_INVALID','Required gates must not be empty');
  const gates=new Set<string>();
  for(const raw of r.gates){const g=obj(raw);keys(g,['id','kind','argv','timeout_ms','proof']);if(typeof g.id!=='string'||!/^[a-zA-Z0-9._-]{1,128}$/.test(g.id)||gates.has(g.id)||!['build','test'].includes(String(g.kind))||!Array.isArray(g.argv)||!g.argv.length||g.argv.some(x=>typeof x!=='string'||!x||x.includes('\0'))||!Number.isSafeInteger(g.timeout_ms)||Number(g.timeout_ms)<100||Number(g.timeout_ms)>900000)fail('INTEGRATION_CONFIG_INVALID','Invalid fixed gate');gates.add(g.id);const proof=obj(g.proof);keys(proof,['manifest_path','manifest_digest','registry_path','registry_digest','expected_assertion_ids','case_ids']);digest(proof.manifest_digest);digest(proof.registry_digest);if(typeof proof.manifest_path!=='string'||typeof proof.registry_path!=='string'||!Array.isArray(proof.expected_assertion_ids)||!proof.expected_assertion_ids.length||proof.expected_assertion_ids.some(x=>typeof x!=='string'||!x)||new Set(proof.expected_assertion_ids).size!==proof.expected_assertion_ids.length||!Array.isArray(proof.case_ids)||!proof.case_ids.length||proof.case_ids.some(x=>typeof x!=='string'||!/^V-[0-9]{3}$/.test(x)))fail('INTEGRATION_CONFIG_INVALID','Exact registered candidate gate proof required');}
 }
 return c as unknown as IntegrationConfig;
}
export async function safeDirectory(root:string,directory:string):Promise<string>{
 if(!path.isAbsolute(directory)||path.relative(root,directory).split(path.sep).includes('..'))fail('INTEGRATION_PATH_INVALID','Directory escapes trusted root');
 const relative=path.relative(root,directory);let cursor=root;
 for(const part of relative.split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);const st=await fs.lstat(cursor);if(!st.isDirectory()||st.isSymbolicLink())fail('INTEGRATION_PATH_INVALID','Symlink or non-directory rejected');}
 const actual=await fs.realpath(directory);if(actual!==directory)fail('INTEGRATION_PATH_INVALID','Noncanonical directory');return actual;
}
export function repository(c:IntegrationConfig,id:string):RepositoryConfig{return c.repositories.find(r=>r.repository_id===id)??fail('INTEGRATION_REPOSITORY_UNKNOWN','Repository absent from trusted profile');}
export async function git(directory:string,args:string[],env:NodeJS.ProcessEnv={}):Promise<string>{
 const result=await exec('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','gc.auto=0','-c','maintenance.auto=false',...args],{cwd:directory,encoding:'utf8',maxBuffer:2*1024*1024,timeout:120000,env:{PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',...env}});
 return result.stdout.trim();
}
/** Publication runs from a fresh private client Git directory. Source-owned
 * config cannot rewrite the target, invoke transports, or redirect credentials. */
export async function isolatedPush(repositoryPath:string,args:string[],environment:Readonly<NodeJS.ProcessEnv>,transport:'file'|'https'):Promise<{stdout:string;stderr:string}>{
 const os=await import('node:os'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'hyperfide-publish-'));
 const baseEnv:NodeJS.ProcessEnv={PATH:environment.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
 try{
  const objectDirectory=await git(repositoryPath,['rev-parse','--path-format=absolute','--git-path','objects']);
  const format=await git(repositoryPath,['rev-parse','--show-object-format']);
  if(!path.isAbsolute(objectDirectory)||objectDirectory.includes(path.delimiter)||!['sha1','sha256'].includes(format))fail('INTEGRATION_GIT_OBJECT_STORE_INVALID','Safe source object store required');
  await exec('git',['init','--bare','--template=','--object-format='+format,directory],{env:baseEnv,timeout:10000,maxBuffer:1048576});
  return await exec('git',['--no-replace-objects','--git-dir='+directory,'-c','gc.auto=0','-c','maintenance.auto=false','-c','protocol.allow=never','-c','protocol.'+transport+'.allow=always','-c','credential.helper=','-c','http.followRedirects=false','push','--no-verify',...args],{cwd:directory,timeout:120000,maxBuffer:1048576,encoding:'utf8',env:{...baseEnv,GIT_ALTERNATE_OBJECT_DIRECTORIES:objectDirectory,...(environment.GIT_ASKPASS?{GIT_ASKPASS:environment.GIT_ASKPASS,HYPERFIDE_GITHUB_INSTALLATION_TOKEN:environment.HYPERFIDE_GITHUB_INSTALLATION_TOKEN}: {})}});
 }finally{await fs.rm(directory,{recursive:true,force:true});}
}
export async function custody(db:DB,s:Scope,id:string,expectedGeneration?:string):Promise<Record<string,any>>{
 await semanticDisposition(db,s,'WRITE');
 const r=await db.query("SELECT c.*,t.current_custody_id,t.criteria_digest AS task_criteria,t.state AS task_state,t.spec_revision_id,t.spec_generation FROM hyperfide.submission_custodies c JOIN hyperfide.tasks t ON t.organisation_id=c.organisation_id AND t.run_id=c.run_id AND t.id=c.task_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3 FOR UPDATE OF c,t",[...values(s),id]);
 const c=r.rows[0];if(!c||c.authority!=='ACTIVE'||c.qualification_outcome!=='PASS'||c.current_custody_id!==c.id||!['QUALIFIED','INTEGRATING'].includes(c.task_state)||(expectedGeneration!==undefined&&String(c.custody_generation)!==expectedGeneration))fail('INTEGRATION_CUSTODY_STALE','Current qualified custody required');
 const moduleName='../assurance/coverage.js';let inspect:unknown;
 try{inspect=(await import(moduleName)).inspectCoverage;}catch{fail('INTEGRATION_QUALIFICATION_UNAVAILABLE','Current executable qualification evidence unavailable');}
 if(typeof inspect!=='function')fail('INTEGRATION_QUALIFICATION_UNAVAILABLE','Qualification inspector unavailable');
 const coverage=await inspect(db,s,c.id);
 if(!object(coverage)||coverage.qualified!==true||coverage.applicability!=='CURRENT'||coverage.authority!=='ACTIVE'||coverage.qualification_outcome!=='PASS'||String(coverage.custody_generation)!==String(c.custody_generation)||coverage.source_object_id!==c.source_object_id||coverage.criteria_digest!==c.criteria_digest||coverage.proof_criteria_digest!==c.task_criteria||coverage.proof_source_object_id!==c.source_object_id||coverage.proof_registry_current!==true||coverage.source_manifest_digest!==c.source_manifest_digest||coverage.evidence_manifest_digest!==c.evidence_manifest_digest)fail('INTEGRATION_QUALIFICATION_STALE','Current input-bound executable evidence required');
 digest(coverage.receipt_digest);return {...c,accepted_criteria_digest:coverage.proof_criteria_digest,qualification_receipt_digest:coverage.receipt_digest,proof_source_manifest_digest:coverage.proof_source_manifest_digest};
}
export interface CandidateManifest {
 version:1;request_id:string;run_id:string;spec_revision_id:string;spec_generation:string;policy_digest:string;authority_epoch:string;
 repository_id:string;branch_authority_id:string;branch_generation:string;target_ref:string;expected_old_head:string;candidate_head:string;tree:string;parents:string[];git_provenance_manifest:Record<string,unknown>;git_provenance_manifest_digest:string;
 contributors:{custody_id:string;custody_generation:string;task_id:string;source_object_id:string;criteria_digest:string;source_manifest_digest:string;evidence_manifest_digest:string;proof_criteria_digest:string;qualification_receipt_digest:string;proof_source_manifest_digest:string}[];
 commit_set:{repository_id:string;candidate_head:string;expected_old_head:string}[];
 execution_session_id:string;execution_receipt_digest:string;declared_context:{environment_digest:string;contract_digest:string;authority:'UNVERIFIED_CALLER_LABELS'};context_authority:'IMMUTABLE_REVIEW_INPUT_BINDINGS';required_gates:GateConfig[];review_policy_digest:string;review_rubrics:string[];required_graph:boolean;review_sources:string[];
}
export async function readCandidate(db:DB,s:Scope,id:string,lock=false):Promise<{row:Record<string,any>;manifest:CandidateManifest}>{
 const r=await db.query('SELECT c.*,m.manifest FROM hyperfide.integration_candidates c JOIN hyperfide.integration_candidate_manifests m USING(organisation_id,run_id) WHERE c.id=m.candidate_id AND c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3'+(lock?' FOR UPDATE OF c':''),[...values(s),id]);
 const row=r.rows[0];if(!row||hash(canonical(row.manifest))!==row.input_manifest_digest)fail('INTEGRATION_CANDIDATE_UNKNOWN','Candidate missing or immutable manifest mismatch');return {row,manifest:row.manifest};
}
type ReviewPhase='ADMISSION'|'CURRENT_PUBLISHED';
function completeReview(result:Record<string,any>):boolean{
 return result.status==='COMPLETE'&&result.authority==='POSTGRESQL_REVIEW_OBLIGATIONS'&&Number.isSafeInteger(result.required)&&result.required>0&&result.complete===result.required&&Array.isArray(result.missing)&&!result.missing.length&&Array.isArray(result.untriaged_observation_ids)&&!result.untriaged_observation_ids.length&&Array.isArray(result.blocking_observation_ids)&&!result.blocking_observation_ids.length&&object(result.input_bindings);
}
async function latestPublishedCandidate(db:DB,s:Scope,m:CandidateManifest,id:string):Promise<void>{
 const latest=(await db.query("SELECT p.candidate_id FROM hyperfide.publication_operations p JOIN hyperfide.integration_candidate_manifests m ON m.organisation_id=p.organisation_id AND m.run_id=p.run_id AND m.candidate_id=p.candidate_id WHERE p.organisation_id=$1 AND p.repository_id=$2 AND m.manifest->>'target_ref'=$3 AND p.state='PUBLISHED' AND p.observed_head=p.candidate_head ORDER BY p.created_at DESC,p.id DESC LIMIT 1",[s.organisation_id,m.repository_id,m.target_ref])).rows[0];
 if(latest?.candidate_id!==id)fail('INTEGRATION_REVIEW_SOURCE_STALE','Fresh published review must name the actual latest candidate head');
}
export async function reviewCoverage(db:DB,s:Scope,m:CandidateManifest,inputDigest:string,candidateId:string,phase:ReviewPhase='ADMISSION'):Promise<{digest:string;observations:Record<string,any>[]}>{
 const moduleName='../review/coverage.js';let inspect:unknown;try{inspect=(await import(moduleName)).inspectReviewCoverage;}catch{fail('INTEGRATION_REVIEW_UNAVAILABLE','Authoritative review obligations unavailable');}
 if(typeof inspect!=='function')fail('INTEGRATION_REVIEW_UNAVAILABLE','Authoritative review interface unavailable');
 if(phase==='CURRENT_PUBLISHED')await latestPublishedCandidate(db,s,m,candidateId);
 const sources=phase==='ADMISSION'?m.review_sources:[m.candidate_head];
 if(!Array.isArray(sources)||!sources.length)fail('INTEGRATION_REVIEW_INCOMPLETE','Required source denominator unavailable');
 const bindings=(await db.query("SELECT DISTINCT ON(source_object_id) * FROM hyperfide.integration_candidate_review_inputs WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3 AND (phase=$4 OR $4='CURRENT_PUBLISHED') ORDER BY source_object_id,generation DESC",[...values(s),candidateId,phase])).rows;
 const observations:Record<string,any>[]=[],snapshot:Record<string,unknown>[]=[];
 for(const source of sources){
  const binding=bindings.find(b=>b.source_object_id===source&&b.repository_id===m.repository_id&&(phase!=='ADMISSION'||b.policy_digest===m.review_policy_digest));if(!binding)fail('INTEGRATION_REVIEW_INCOMPLETE','Required exact source review binding missing');
  const result=await inspect(db,s,{repository_id:m.repository_id,source_object_id:source,candidate_digest:inputDigest,input_manifest_digest:binding.input_manifest_digest,policy_digest:binding.policy_digest});
  if(!object(result)||!completeReview(result)||hash(canonical(binding.input_bindings))!==binding.bindings_digest||canonical(result.input_bindings)!==canonical(binding.input_bindings))fail('INTEGRATION_REVIEW_INCOMPLETE','Current exact review, context or canonical finding ingestion remains incomplete');
  observations.push({...result,candidate_id:candidateId});snapshot.push({source_object_id:source,input_manifest_digest:binding.input_manifest_digest,policy_digest:binding.policy_digest,bindings_digest:binding.bindings_digest,generation:String(binding.generation)});
 }
 return {digest:hash(canonical(snapshot)),observations};
}
async function bindReviews(pool:DB,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','candidate_id','review_inputs']);const s=scope(v),id=uuid(v.candidate_id);if(!Array.isArray(v.review_inputs))fail('INTEGRATION_INVALID','Per-source review inputs required');const reviewInputs=v.review_inputs;
 return tx(pool,async db=>{
  await currentRun(db,s,true);const {row,manifest:m}=await readCandidate(db,s,id,true),phase:ReviewPhase=row.state==='PUBLISHED'?'CURRENT_PUBLISHED':'ADMISSION',expected=phase==='ADMISSION'?m.review_sources:[m.candidate_head];
  if(phase==='CURRENT_PUBLISHED')await latestPublishedCandidate(db,s,m,id);
  if(!Array.isArray(expected)||reviewInputs.length!==expected.length)fail('INTEGRATION_REVIEW_INCOMPLETE','Review source denominator differs');
  const sources=new Set<string>();
  for(const raw of reviewInputs){
   const item=obj(raw);keys(item,['repository_id','source_object_id','input_manifest_digest','policy_digest']);const source=oid(item.source_object_id),policy=digest(item.policy_digest);
   if(uuid(item.repository_id)!==m.repository_id||!expected.includes(source)||sources.has(source)||phase==='ADMISSION'&&policy!==m.review_policy_digest)fail('INTEGRATION_REVIEW_INCOMPLETE','Unexpected or duplicate review source');sources.add(source);
   const moduleName='../review/coverage.js';const coverage=await(await import(moduleName)).inspectReviewCoverage(db,s,{repository_id:m.repository_id,source_object_id:source,candidate_digest:row.input_manifest_digest,input_manifest_digest:digest(item.input_manifest_digest),policy_digest:policy});
   if(!object(coverage)||!completeReview(coverage)||coverage.policy_digest!==policy)fail('INTEGRATION_REVIEW_INPUTS_UNAVAILABLE','Actual independently validated current source/environment/contracts review required');
   await db.query('INSERT INTO hyperfide.integration_candidate_review_inputs(organisation_id,run_id,candidate_id,repository_id,source_object_id,input_manifest_digest,policy_digest,input_bindings,bindings_digest,phase) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',[...values(s),id,m.repository_id,source,item.input_manifest_digest,policy,coverage.input_bindings,hash(canonical(coverage.input_bindings)),phase]);
  }
  const inspected=await reviewCoverage(db,s,m,row.input_manifest_digest,id,phase);return {candidate_id:id,phase,review_inputs_bound:true,review_bindings_digest:inspected.digest,candidate_qualified:false};
 });
}
/** Latest recorded remote outcome per required gate for this exact immutable
 * manifest. A FAIL is a rejection of the combined commit set, independent of
 * the historical PASS receipts of its individually qualified contributors. */
export async function gateOutcomes(db:DB,s:Scope,id:string,row:Record<string,any>,m:CandidateManifest):Promise<Record<string,any>[]>{
 const receipts=(await db.query("SELECT DISTINCT ON(r.gate_id) r.gate_id,r.job_id,r.attempt,r.outcome,r.exit_code,r.assertion_count,r.stdout_digest,r.stderr_digest,r.input_manifest_digest,j.state AS job_state,j.reservation_id FROM hyperfide.integration_gate_receipts r JOIN hyperfide.integration_jobs j ON j.organisation_id=r.organisation_id AND j.run_id=r.run_id AND j.id=r.job_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.candidate_id=$3 AND j.state IN('SUCCEEDED','FAILED') ORDER BY r.gate_id,r.attempt DESC",[...values(s),id])).rows;
 return m.required_gates.map(gate=>{const r=receipts.find(x=>x.gate_id===gate.id);return r?{gate_id:gate.id,outcome:r.input_manifest_digest===row.input_manifest_digest?r.outcome:'STALE',job_id:r.job_id,job_state:r.job_state,attempt:String(r.attempt),exit_code:r.exit_code,assertion_count:String(r.assertion_count),stdout_digest:r.stdout_digest,stderr_digest:r.stderr_digest,reservation_id:r.reservation_id}:{gate_id:gate.id,outcome:'MISSING'};});
}
export function commitSetEvidence(row:Record<string,any>,m:CandidateManifest):Record<string,unknown>{
 return {candidate_head:m.candidate_head,tree:m.tree,input_manifest_digest:row.input_manifest_digest,commit_set:m.commit_set,commit_set_digest:hash(canonical(m.commit_set)),contributors:m.contributors.map(c=>({custody_id:c.custody_id,custody_generation:c.custody_generation,task_id:c.task_id,source_object_id:c.source_object_id,qualification_receipt_digest:c.qualification_receipt_digest}))};
}
interface Readiness {s:Scope;id:string;run:Record<string,any>;row:Record<string,any>;m:CandidateManifest;reviews?:{digest:string;observations:Record<string,any>[]}}
/** Ordered admission obligations. candidateReady fails closed on the first
 * unmet one; integration.candidate.status evaluates each independently. */
const READINESS:[string,(db:DB,r:Readiness)=>Promise<void>][]=[
 ['candidate_not_rejected',async(db,{s,id,row,m})=>{const failed=(await gateOutcomes(db,s,id,row,m)).filter(g=>g.outcome==='FAIL');if(row.state==='FAILED'||failed.length)fail('INTEGRATION_CANDIDATE_REJECTED','Combined candidate failed required gate(s) '+(failed.map(g=>g.gate_id).join(',')||'(recorded)')+' for exact commit set '+hash(canonical(m.commit_set))+' at '+m.candidate_head);}],
 ['run_inputs',async(_db,{run,m})=>{if(run.spec_revision_id!==m.spec_revision_id||String(run.spec_generation)!==m.spec_generation||run.policy_digest!==m.policy_digest||run.authority_epoch!==m.authority_epoch)fail('INTEGRATION_INPUT_STALE','Run inputs changed');}],
 ['branch_authority',async(db,{s,run,m})=>{
  const authority=await db.query("SELECT * FROM hyperfide.branch_authorities WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE",[...values(s),m.branch_authority_id]);
  const a=authority.rows[0];if(!a||a.authority!=='ACTIVE'||String(a.branch_generation)!==m.branch_generation||a.expected_old_head!==m.expected_old_head||a.authority_epoch!==run.authority_epoch)fail('INTEGRATION_BRANCH_STALE','Branch authority changed');}],
 ['contributors',async(db,{s,m})=>{for(const contributor of m.contributors){const c=await custody(db,s,contributor.custody_id,contributor.custody_generation);if(c.source_object_id!==contributor.source_object_id||c.source_manifest_digest!==contributor.source_manifest_digest||c.evidence_manifest_digest!==contributor.evidence_manifest_digest||c.accepted_criteria_digest!==contributor.proof_criteria_digest||c.qualification_receipt_digest!==contributor.qualification_receipt_digest||c.proof_source_manifest_digest!==contributor.proof_source_manifest_digest)fail('INTEGRATION_INPUT_STALE','Contributor input changed');}}],
 ['repository_set',async(db,{s,m})=>{
  const selected=(await db.query('SELECT repository_id FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 ORDER BY repository_id',values(s))).rows.map(r=>r.repository_id);
  if(canonical(selected)!==canonical(m.commit_set.map(entry=>entry.repository_id).sort()))fail('INTEGRATION_REPOSITORY_SET_MISMATCH','Immutable candidate must cover every run repository');
  for(const entry of m.commit_set.filter(entry=>entry.repository_id!==m.repository_id)){
   const inBatch=await db.query("SELECT 1 FROM hyperfide.integration_candidates c JOIN hyperfide.integration_candidate_manifests manifest ON manifest.organisation_id=c.organisation_id AND manifest.run_id=c.run_id AND manifest.candidate_id=c.id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.repository_id=$3 AND c.candidate_head=$4 AND manifest.manifest->>'request_id'=$5 AND c.state IN('PENDING','READY','PUBLISHED')",[...values(s),entry.repository_id,entry.candidate_head,m.request_id]);if(inBatch.rowCount)continue;
   const latest=(await db.query("SELECT candidate_head FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 AND state='PUBLISHED' AND observed_head=candidate_head ORDER BY created_at DESC,id DESC LIMIT 1",[...values(s),entry.repository_id])).rows[0];
   const unsettled=await db.query("SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=$1 AND repository_id=$2 AND state IN('RUNNING','OUTCOME_UNKNOWN')",[s.organisation_id,entry.repository_id]);
   if(latest?.candidate_head!==entry.candidate_head||unsettled.rowCount)fail('INTEGRATION_BASELINE_STALE','Pinned unchanged published repository has changed or is uncertain');
  }}],
 ['reviews',async(db,r)=>{r.reviews=await reviewCoverage(db,r.s,r.m,r.row.input_manifest_digest,r.id);}],
 ['gates',async(db,r)=>{
  const reviews=r.reviews??await reviewCoverage(db,r.s,r.m,r.row.input_manifest_digest,r.id);
  const receipts=await db.query("SELECT r.gate_id,r.outcome,r.input_manifest_digest,r.proof,j.review_bindings_digest,j.verification_input_digest FROM hyperfide.integration_gate_receipts r JOIN hyperfide.integration_jobs j ON j.organisation_id=r.organisation_id AND j.run_id=r.run_id AND j.id=r.job_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.candidate_id=$3 AND j.state='SUCCEEDED' ORDER BY r.attempt DESC",[...values(r.s),r.id]);
  for(const gate of r.m.required_gates){const receipt=receipts.rows.find(x=>x.gate_id===gate.id);if(!receipt||receipt.outcome!=='PASS'||receipt.input_manifest_digest!==r.row.input_manifest_digest||receipt.review_bindings_digest!==reviews.digest||receipt.proof?.scope_digest!==receipt.verification_input_digest)fail('INTEGRATION_GATE_INCOMPLETE','Required candidate gate is not current PASS');}}],
 ['findings',async(db,{s,m})=>{
  const findingsModule='../findings/registry.js';let inspectFindings:unknown;
  try{inspectFindings=(await import(findingsModule)).inspectBlockingFindings;}catch{fail('INTEGRATION_FINDINGS_UNAVAILABLE','Current finding disposition inspector unavailable');}
  if(typeof inspectFindings!=='function')fail('INTEGRATION_FINDINGS_UNAVAILABLE','Finding inspector unavailable');
  const findings=await inspectFindings(db,{...s,repository_id:m.repository_id,source_object_id:m.candidate_head});
  if(!object(findings)||findings.clear!==true||!Array.isArray(findings.blockers)||findings.blockers.length)fail('INTEGRATION_FINDING_BLOCKS','Applicable blocking findings remain');}],
 // The authoritative17 review inspector validates the actual graph source set/provenance for every required source. Candidate-manifest digests are not graph source-manifest identities.
];
export async function candidateReady(db:DB,s:Scope,id:string,admittedPublicationId?:string):Promise<{row:Record<string,any>;manifest:CandidateManifest}>{
 await semanticDisposition(db,s,'WRITE');
 const run=await currentRun(db,s,true,admittedPublicationId);const {row,manifest:m}=await readCandidate(db,s,id,true);
 const state:Readiness={s,id,run,row,m};for(const [,check] of READINESS)await check(db,state);
 return {row,manifest:m};
}
/** Candidate-level status (V-034): every obligation reports its own current
 * outcome; a lower-level PASS (isolated task qualification, one gate) never
 * implies candidate admission, integration or successor release. */
async function candidateStatus(pool:DB,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','candidate_id']);const s=scope(v),id=uuid(v.candidate_id);
 const base=await tx(pool,async db=>{
  const {row,manifest:m}=await readCandidate(db,s,id);const run=(await db.query('SELECT * FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',values(s))).rows[0];
  const tasks=(await db.query('SELECT t.id,t.state,c.qualification_outcome,c.authority FROM hyperfide.tasks t LEFT JOIN hyperfide.submission_custodies c ON c.organisation_id=t.organisation_id AND c.run_id=t.run_id AND c.id=t.current_custody_id WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.id=ANY($3::uuid[])',[...values(s),m.contributors.map(c=>c.task_id)])).rows;
  return {row,m,run,tasks,gates:await gateOutcomes(db,s,id,row,m)};
 },'READ');
 const obligations:{id:string;status:'MET'|'UNMET';code?:string;message?:string}[]=[];
 let current:Readiness|undefined;
 for(const [name,check] of READINESS){
  try{await tx(pool,async db=>{const run=(await db.query('SELECT * FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',values(s))).rows[0];const {row,manifest:m}=await readCandidate(db,s,id);const state:Readiness={s,id,run,row,m,...(current?.reviews?{reviews:current.reviews}:{})};current=state;await check(db,state);});obligations.push({id:name,status:'MET'});}
  catch(error){obligations.push({id:name,status:'UNMET',...(error instanceof FoundationError?{code:error.code,message:error.message}:{code:'INTEGRATION_OBLIGATION_UNOBSERVABLE',message:String((error as Error)?.message??error).slice(0,300)})});}
 }
 try{await tx(pool,db=>currentRun(db,s));obligations.unshift({id:'run_admits_integration',status:'MET'});}
 catch(error){obligations.unshift({id:'run_admits_integration',status:'UNMET',code:error instanceof FoundationError?error.code:'INTEGRATION_OBLIGATION_UNOBSERVABLE',message:String((error as Error)?.message??error).slice(0,300)});}
 const unmet=obligations.filter(o=>o.status==='UNMET');
 const verdict=unmet.some(o=>o.code==='INTEGRATION_CANDIDATE_REJECTED')?'REJECTED':base.row.state==='READY'||base.row.state==='PUBLISHED'?base.row.state:unmet.length?'HELD':'ADMISSIBLE';
 return {candidate_id:id,state:base.row.state,verdict,evidence:commitSetEvidence(base.row,base.m),gates:base.gates,obligations,unmet_obligations:unmet.map(o=>o.code),
  contributors:base.m.contributors.map(c=>{const t=base.tasks.find(x=>x.id===c.task_id);return {task_id:c.task_id,custody_id:c.custody_id,isolated_qualification:t?.qualification_outcome??'UNKNOWN',qualification_receipt_digest:c.qualification_receipt_digest,task_state:t?.state??'UNKNOWN',integrated:t?.state==='INTEGRATED'};}),
  candidate_qualified:false,integrated:base.row.state==='PUBLISHED',successors_released:false};
}
const CANDIDATE_BUILD_SCRIPT="import {execFileSync} from 'node:child_process';\nimport {randomUUID,createHash} from 'node:crypto';\nconst chunks=[];for await(const x of process.stdin)chunks.push(x);\nconst input=JSON.parse(Buffer.concat(chunks).toString('utf8'));\nconst env={PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Hyperfide',GIT_AUTHOR_EMAIL:'integration@hyperfide.invalid',GIT_COMMITTER_NAME:'Hyperfide',GIT_COMMITTER_EMAIL:'integration@hyperfide.invalid',GIT_AUTHOR_DATE:'2000-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2000-01-01T00:00:00Z'};\nconst g=(args,binary=false)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','gc.auto=0',...args],{env,encoding:binary?undefined:'utf8',maxBuffer:12*1024*1024,timeout:120000});\nconst oid=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;\nif(!oid.test(input.base)||!Array.isArray(input.commits)||!input.commits.length||input.commits.some(c=>!oid.test(c)))throw Error('invalid pinned commits');\nlet head=input.base;\nfor(const source of input.commits){if(g(['cat-file','-t',source]).trim()!=='commit')throw Error('source is not commit');const tree=g(['merge-tree','--write-tree',head,source]).trim();if(!oid.test(tree))throw Error('merge conflict');head=g(['commit-tree',tree,'-p',head,'-p',source,'-m','Hyperfide immutable integration candidate']).trim();}\nconst tree=g(['rev-parse',head+'^{tree}']).trim(),ref='refs/hyperfide/integration/'+randomUUID();\ng(['update-ref',ref,head]);\ntry{const bundle=g(['bundle','create','-',ref,'^'+input.base],true);if(bundle.length>8*1024*1024)throw Error('candidate delta exceeds captured bundle bound; durable object transfer required');console.log(JSON.stringify({head,tree,parents:g(['show','-s','--format=%P',head]).trim().split(' ').filter(Boolean),bundle:bundle.toString('base64'),bundle_digest:'sha256:'+createHash('sha256').update(bundle).digest('hex'),ref}));}\nfinally{g(['update-ref','-d',ref]);}\n";
async function createCandidate(pool:DB,cfg:IntegrationConfig,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','request_id','targets','environment_digest','contract_digest']);const s=scope(v);if(s.organisation_id!==cfg.organisation_id)fail('INTEGRATION_SCOPE_DENIED','Organisation differs from trusted profile');
 const request=uuid(v.request_id);digest(v.environment_digest);digest(v.contract_digest);
 if(!Array.isArray(v.targets)||!v.targets.length||v.targets.length>100)fail('INTEGRATION_INVALID','Bounded nonempty target set required');
 const parsed=v.targets.map(raw=>{const t=obj(raw);keys(t,['repository_id','branch_authority_id','custody_ids','session_id','reservation_id']);if(!Array.isArray(t.custody_ids)||!t.custody_ids.length||t.custody_ids.length>1000)fail('INTEGRATION_INVALID','Qualified contributors required');const ids=t.custody_ids.map(uuid);if(new Set(ids).size!==ids.length)fail('INTEGRATION_INVALID','Duplicate custody');return {repository_id:uuid(t.repository_id),branch_authority_id:uuid(t.branch_authority_id),custody_ids:ids,session_id:uuid(t.session_id),reservation_id:uuid(t.reservation_id)};});
 if(new Set(parsed.map(t=>t.repository_id)).size!==parsed.length)fail('INTEGRATION_INVALID','Duplicate repository target');
 const requestDigest=hash(canonical(v));
 const prior=await pool.query('SELECT request_digest,candidate_ids FROM hyperfide.integration_requests WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[...values(s),request]);
 if(prior.rows[0]){if(prior.rows[0].request_digest!==requestDigest)fail('INTEGRATION_IDEMPOTENCY_CONFLICT','Request identity reused with different inputs');return {candidate_ids:prior.rows[0].candidate_ids,replayed:true};}
 // The primary validates/persists intent and prepares an observed runner
 // permit. Git construction happens only through actual provider execution.
 const remotePlans=await tx(pool,async db=>{
  const run=await currentRun(db,s,true,undefined,false,{kind:'PREPARATION',id:request}),plans:{t:typeof parsed[number];r:RepositoryConfig;a:Record<string,any>;contributors:Record<string,any>[];id:string;prepared:Awaited<ReturnType<typeof prepareRemote>>}[]=[];
  const priorPreparation=(await db.query('SELECT request_digest,state,execution_manifest FROM hyperfide.integration_preparations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 FOR UPDATE',[...values(s),request])).rows[0];
  if(priorPreparation){
   if(priorPreparation.request_digest!==requestDigest)fail('INTEGRATION_IDEMPOTENCY_CONFLICT','Pending request identity has different immutable inputs');
   if(!['PREPARING','OUTCOME_UNKNOWN'].includes(priorPreparation.state)||!Array.isArray(priorPreparation.execution_manifest)||priorPreparation.execution_manifest.length!==parsed.length)fail('INTEGRATION_PREPARATION_PENDING','Recorded preparation cannot be recovered from this snapshot');
   for(const raw of priorPreparation.execution_manifest){const recorded=obj(raw),t=parsed.find(t=>t.repository_id===recorded.repository_id);if(!t||!recorded.target||!recorded.authority||!Array.isArray(recorded.contributors)||!recorded.remote||canonical(t)!==canonical(recorded.target))fail('INTEGRATION_PREPARATION_UNRECOVERABLE','Exact original request metadata unavailable');const r=repository(cfg,t.repository_id);if(hash(canonical(r))!==recorded.repository_config_digest)fail('INTEGRATION_PREPARATION_STALE','Trusted repository construction policy changed');plans.push({t,r,a:obj(recorded.authority),contributors:recorded.contributors,id:uuid(recorded.candidate_id),prepared:await restoreRemote(db,recorded.remote)});}
   return plans;
  }
  for(const t of parsed){
   const r=repository(cfg,t.repository_id);
   const a=(await db.query('SELECT * FROM hyperfide.branch_authorities WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),t.branch_authority_id])).rows[0];
   if(!a||a.repository_id!==t.repository_id||a.branch_ref!==r.target_ref||a.authority!=='ACTIVE'||a.authority_epoch!==run.authority_epoch||!a.expected_old_head)fail('INTEGRATION_BRANCH_STALE','Current pinned target authority required');
   const contributors=[];for(const id of t.custody_ids){const contributor=await custody(db,s,id);if(contributor.repository_id!==t.repository_id)fail('INTEGRATION_SCOPE_DENIED','Contributor belongs to another repository');contributors.push(contributor);}
   const source={repository_id:t.repository_id,base:a.expected_old_head,commits:contributors.map(c=>c.source_object_id),script_digest:hash(CANDIDATE_BUILD_SCRIPT)};
   const plan={session_id:t.session_id,operation_id:randomUUID(),repository_id:t.repository_id,reservation_id:t.reservation_id,argv:['node','--input-type=module','-e',CANDIDATE_BUILD_SCRIPT],cwd:'.',environment:{},expected_source_object_id:a.expected_old_head,timeout_ms:900000,source_digest:hash(canonical(source)),policy_digest:run.policy_digest,stdin:canonical({base:a.expected_old_head,commits:source.commits})};
   plans.push({t,r,a,contributors,id:randomUUID(),prepared:await prepareRemote(db,plan)});
  }
  await db.query("INSERT INTO hyperfide.integration_preparations(organisation_id,run_id,request_id,request_digest,state,execution_manifest) VALUES($1,$2,$3,$4,'PREPARING',$5) ON CONFLICT DO NOTHING",[...values(s),request,requestDigest,plans.map(p=>({candidate_id:p.id,repository_id:p.t.repository_id,target:p.t,authority:p.a,contributors:p.contributors,repository_config_digest:hash(canonical(p.r)),remote:snapshotRemote(p.prepared)}))]);
  return plans;
 });
 const prepared:{t:typeof parsed[number];r:RepositoryConfig;a:Record<string,any>;contributors:Record<string,any>[];id:string;head:string;tree:string;parents:string[];remote_receipt_digest:string;prepared:Awaited<ReturnType<typeof prepareRemote>>}[]=[];
 for(const p of remotePlans){
  const result=await executeRemote(p.prepared),output=obj(JSON.parse(result.stdout));
  const head=oid(output.head),tree=oid(output.tree);if(!Array.isArray(output.parents)||!output.parents.length)fail('INTEGRATION_REMOTE_OUTPUT_INVALID','Actual candidate parent objects required');const parents=output.parents.map(oid);
  if(typeof output.bundle!=='string'||typeof output.ref!=='string'||!/^refs\/hyperfide\/integration\/[a-f0-9-]{36}$/.test(output.ref))fail('INTEGRATION_REMOTE_OUTPUT_INVALID','Remote candidate bundle reference invalid');
  const bundle=Buffer.from(output.bundle,'base64');if(bundle.toString('base64')!==output.bundle||bundle.length>8*1024*1024||hash(bundle)!==output.bundle_digest)fail('INTEGRATION_REMOTE_OUTPUT_INVALID','Remote Git bundle bytes do not match capture');
  // Importing/verifying Git objects is publication custody, never a source
  // build or test on the control host.
  const filename=path.join(cfg.root,'candidate-transfer-'+p.id+'.bundle');try{await fs.writeFile(filename,bundle,{flag:'wx',mode:0o600});}catch(error){if((error as {code?:string}).code!=='EEXIST'||hash(await fs.readFile(filename))!==hash(bundle))throw error;}
  try{await git(p.r.path,['bundle','verify',filename]);await git(p.r.path,['fetch','--no-tags',filename,output.ref]);if(await git(p.r.path,['rev-parse',head+'^{tree}'])!==tree||canonical((await git(p.r.path,['show','-s','--format=%P',head])).split(' ').filter(Boolean))!==canonical(parents))fail('INTEGRATION_REMOTE_OUTPUT_INVALID','Imported candidate tree mismatch');}
  finally{await fs.rm(filename,{force:true});}
  prepared.push({...p,head,tree,parents,remote_receipt_digest:result.spool_digest});
 }
 const builtCommitSet=prepared.map(p=>({repository_id:p.t.repository_id,candidate_head:p.head,expected_old_head:String(p.a.expected_old_head)})).sort((a,b)=>a.repository_id.localeCompare(b.repository_id));
 return tx(pool,async db=>{
 const run=await currentRun(db,s,true,undefined,false,{kind:'PREPARATION',id:request});const existing=await db.query('SELECT request_digest,candidate_ids FROM hyperfide.integration_requests WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[...values(s),request]);
 if(existing.rows[0]){if(existing.rows[0].request_digest!==requestDigest)fail('INTEGRATION_IDEMPOTENCY_CONFLICT','Changed request');return {candidate_ids:existing.rows[0].candidate_ids,replayed:true};}
 const commitSet=[...builtCommitSet];const runRepositories=(await db.query('SELECT repository_id FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 ORDER BY repository_id',values(s))).rows;
 for(const registered of runRepositories){
  if(commitSet.some(entry=>entry.repository_id===registered.repository_id))continue;
  const latest=(await db.query("SELECT p.*,m.manifest FROM hyperfide.publication_operations p JOIN hyperfide.integration_candidate_manifests m ON m.organisation_id=p.organisation_id AND m.run_id=p.run_id AND m.candidate_id=p.candidate_id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.repository_id=$3 AND p.state='PUBLISHED' AND p.observed_head=p.candidate_head ORDER BY p.created_at DESC,p.id DESC LIMIT 1",[...values(s),registered.repository_id])).rows[0];
  if(!latest)fail('INTEGRATION_BASELINE_PUBLICATION_REQUIRED','A repository without an existing published baseline must be included in initial candidate construction');
  const uncertain=await db.query("SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=$1 AND repository_id=$2 AND state IN('RUNNING','OUTCOME_UNKNOWN')",[s.organisation_id,registered.repository_id]);if(uncertain.rowCount)fail('INTEGRATION_BASELINE_UNCERTAIN','Unchanged repository has an unresolved external outcome');
  commitSet.push({repository_id:registered.repository_id,candidate_head:latest.candidate_head,expected_old_head:latest.expected_old_head});
 }
 commitSet.sort((a,b)=>a.repository_id.localeCompare(b.repository_id));if(commitSet.length!==runRepositories.length||commitSet.some(entry=>!runRepositories.some(r=>r.repository_id===entry.repository_id)))fail('INTEGRATION_REPOSITORY_SET_MISMATCH','Candidate set must cover exact registered run repositories');
 for(const p of prepared){
  const contributors=[];
  for(const old of p.contributors){const c=await custody(db,s,old.id,String(old.custody_generation));if(c.source_object_id!==old.source_object_id||c.repository_id!==p.t.repository_id||c.authority_epoch!==run.authority_epoch)fail('INTEGRATION_INPUT_STALE','Contributor changed during candidate build');contributors.push({custody_id:c.id,custody_generation:String(c.custody_generation),task_id:c.task_id,source_object_id:c.source_object_id,criteria_digest:c.criteria_digest,source_manifest_digest:c.source_manifest_digest,evidence_manifest_digest:c.evidence_manifest_digest,proof_criteria_digest:c.accepted_criteria_digest,qualification_receipt_digest:c.qualification_receipt_digest,proof_source_manifest_digest:c.proof_source_manifest_digest});}
  const a=(await db.query('SELECT * FROM hyperfide.branch_authorities WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),p.a.id])).rows[0];
  if(!a||a.authority!=='ACTIVE'||String(a.branch_generation)!==String(p.a.branch_generation)||a.expected_old_head!==p.a.expected_old_head||a.authority_epoch!==run.authority_epoch)fail('INTEGRATION_BRANCH_STALE','Target authority changed during candidate build');
  const gitProvenance={schema_version:1,kind:'GIT_CANDIDATE_PROVENANCE_V1',repository_id:p.t.repository_id,source_object_id:p.head,tree:p.tree,parents:p.parents,baseline:p.a.expected_old_head,construction_receipt_digest:p.remote_receipt_digest};const m:CandidateManifest={version:1,request_id:request,run_id:s.run_id,spec_revision_id:run.spec_revision_id,spec_generation:String(run.spec_generation),policy_digest:run.policy_digest,authority_epoch:run.authority_epoch,repository_id:p.t.repository_id,branch_authority_id:a.id,branch_generation:String(a.branch_generation),target_ref:p.r.target_ref,expected_old_head:a.expected_old_head,candidate_head:p.head,tree:p.tree,parents:p.parents,git_provenance_manifest:gitProvenance,git_provenance_manifest_digest:hash(canonical(gitProvenance)),contributors,commit_set:commitSet,execution_session_id:p.t.session_id,execution_receipt_digest:p.remote_receipt_digest,declared_context:{environment_digest:String(v.environment_digest),contract_digest:String(v.contract_digest),authority:'UNVERIFIED_CALLER_LABELS'},context_authority:'IMMUTABLE_REVIEW_INPUT_BINDINGS',required_gates:p.r.gates,review_policy_digest:p.r.review_policy_digest,review_rubrics:p.r.review_rubrics,required_graph:p.r.required_graph,review_sources:[...new Set([p.head,...contributors.map(c=>c.source_object_id)])].sort()};
  const md=hash(canonical(m));const first=contributors[0]!;
  await db.query("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,'commit') ON CONFLICT DO NOTHING",[s.organisation_id,p.t.repository_id,p.head]);
  await db.query('INSERT INTO hyperfide.integration_candidates(organisation_id,run_id,id,task_id,custody_id,custody_generation,repository_id,branch_authority_id,branch_generation,expected_old_head,candidate_head,input_manifest_digest,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[...values(s),p.id,first.task_id,first.custody_id,first.custody_generation,p.t.repository_id,a.id,String(a.branch_generation),a.expected_old_head,p.head,md,randomUUID()]);
  await db.query('INSERT INTO hyperfide.integration_candidate_manifests(organisation_id,run_id,candidate_id,manifest) VALUES($1,$2,$3,$4)',[...values(s),p.id,m]);
  for(const c of contributors)await db.query('INSERT INTO hyperfide.candidate_custodies(organisation_id,run_id,candidate_id,custody_id,custody_generation,task_id,repository_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[...values(s),p.id,c.custody_id,c.custody_generation,c.task_id,p.t.repository_id]);
 }
 const ids=prepared.map(p=>p.id);await db.query('INSERT INTO hyperfide.integration_requests(organisation_id,run_id,request_id,request_digest,candidate_ids) VALUES($1,$2,$3,$4,$5)',[...values(s),request,requestDigest,ids]);await db.query("UPDATE hyperfide.integration_preparations SET state='PREPARED' WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3",[...values(s),request]);return {candidate_ids:ids,commit_set:commitSet,replayed:false};
 });
}
async function runGates(pool:DB,_cfg:IntegrationConfig,_env:Readonly<NodeJS.ProcessEnv>,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','candidate_id','reservation_id','session_id']);const s=scope(v),id=uuid(v.candidate_id),reservation=uuid(v.reservation_id),session=uuid(v.session_id);
 await remoteGateRuntime();
 const job=await tx(pool,async db=>{
  const run=await currentRun(db,s,true),candidate=await readCandidate(db,s,id,true);
  const active=await db.query("SELECT id,state FROM hyperfide.integration_jobs WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3 AND state IN ('RUNNING','OUTCOME_UNKNOWN') FOR UPDATE",[...values(s),id]);if(active.rows[0])return {existing_job_id:String(active.rows[0].id),state:String(active.rows[0].state)};
  const held=await db.query("SELECT 1 FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='ALLOCATED' AND attempt_id IS NULL AND quantity>0 AND expires_at>clock_timestamp() FOR UPDATE",[...values(s),reservation]);if(!held.rowCount)fail('INTEGRATION_RESERVATION_REQUIRED','Separate integration reservation required');
  const reviews=await reviewCoverage(db,s,candidate.manifest,candidate.row.input_manifest_digest,id),verificationInput=hash(canonical({candidate_input_manifest_digest:candidate.row.input_manifest_digest,review_bindings_digest:reviews.digest,source_object_id:candidate.manifest.candidate_head,tree:candidate.manifest.tree}));const jobId=randomUUID(),plans=[];
  for(const gate of candidate.manifest.required_gates)plans.push({gate,prepared:await prepareRemoteGate(db,s,{session_id:session,reservation_id:reservation,repository_id:candidate.manifest.repository_id,input_digest:verificationInput,policy_digest:run.policy_digest,gate,mode:'CANDIDATE',candidate_head:candidate.manifest.candidate_head,snapshot:{tree:candidate.manifest.tree}})});
  if(new Set(plans.map(p=>p.prepared.plan.source_digest)).size!==1)fail('INTEGRATION_SOURCE_CHANGED','Gates require one exact prepared physical source manifest');await db.query("INSERT INTO hyperfide.integration_jobs(organisation_id,run_id,id,candidate_id,executor_id,reservation_id,state,source_manifest_digest,source_object_id,source_tree_id,review_bindings_digest,verification_input_digest,execution_manifest) VALUES($1,$2,$3,$4,$5,$6,'RUNNING',$7,$8,$9,$10,$11,$12)",[...values(s),jobId,id,session,reservation,plans[0]!.prepared.plan.source_digest,candidate.manifest.candidate_head,candidate.manifest.tree,reviews.digest,verificationInput,plans.map(p=>({gate:p.gate,remote:snapshotRemote(p.prepared)}))]);return {id:jobId,...candidate,plans,verificationInput};
 });
 if('existing_job_id' in job)return {job_id:job.existing_job_id,state:job.state,recovery_required:true,redispatched:false};
 return executeCandidateJob(pool,s,id,job);
}
/** Required gates only ever run remotely: refuse before taking any job
 * authority or reservation when the qualified remote runtime is absent. */
async function remoteGateRuntime():Promise<void>{
 const context=currentInvocation().context,env=context.env;await runnerRemote(context);
 if(!env.HYPERFIDE_REMOTE_NODE_DIGEST||!env.HYPERFIDE_REMOTE_CLOSURE_MODULE||!env.HYPERFIDE_REMOTE_CLOSURE_DIGEST)fail('INTEGRATION_REMOTE_RUNTIME_UNAVAILABLE','Qualified remote integration runtime, closure digest and observed Node digest are required before candidate job authority is taken');
}
async function executeCandidateJob(pool:DB,s:Scope,id:string,job:{id:string;row:Record<string,any>;plans:{gate:GateConfig;prepared:Awaited<ReturnType<typeof prepareRemote>>}[];verificationInput:string}):Promise<unknown>{
 const results:Record<string,unknown>[]=[];
 for(const entry of job.plans){
  const existing=(await pool.query('SELECT * FROM hyperfide.integration_gate_receipts WHERE organisation_id=$1 AND run_id=$2 AND job_id=$3 AND gate_id=$4',[...values(s),job.id,entry.gate.id])).rows[0];if(existing){results.push({gate_id:entry.gate.id,outcome:existing.outcome,replayed:true});continue;}
  const capture=await executeRemote(entry.prepared),observed=obj(JSON.parse(capture.stdout));
  const stdout=String(observed.stdout??''),stderr=String(observed.stderr??''),assertions=Number(observed.assertions),proof=obj(observed.proof);
  const outcome=observed.exitCode===0&&Number.isSafeInteger(assertions)&&assertions>0&&proof.scope_digest===job.verificationInput?'PASS':'FAIL';
  await tx(pool,async db=>{await currentRun(db,s,true,undefined,false,{kind:'CANDIDATE',id:job.id});await readCandidate(db,s,id,true);await db.query('INSERT INTO hyperfide.integration_gate_receipts(organisation_id,run_id,candidate_id,job_id,gate_id,input_manifest_digest,outcome,exit_code,assertion_count,stdout_digest,stderr_digest,stdout,stderr,proof) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(organisation_id,run_id,job_id,gate_id) DO NOTHING',[...values(s),id,job.id,entry.gate.id,job.row.input_manifest_digest,outcome,observed.exitCode,assertions,hash(stdout),hash(stderr),stdout,stderr,{...proof,remote_spool_digest:capture.spool_digest,remote_cleanup_receipt_digest:capture.cleanup.receipt_digest}]);});
  results.push({gate_id:entry.gate.id,outcome,remote_process_ref:capture.process_ref,spool_digest:capture.spool_digest});
 }
 await tx(pool,async db=>{await currentRun(db,s,true,undefined,false,{kind:'CANDIDATE',id:job.id});await db.query("UPDATE hyperfide.integration_jobs SET state=$4,finished_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state IN ('RUNNING','OUTCOME_UNKNOWN')",[...values(s),job.id,results.every(r=>r.outcome==='PASS')?'SUCCEEDED':'FAILED']);if(results.some(r=>r.outcome!=='PASS'))await db.query("UPDATE hyperfide.integration_candidates SET state='FAILED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state IN('PENDING','VERIFYING')",[...values(s),id]);await releaseTerminalReservations(db,s,job.id);});
 return {job_id:job.id,results,scope:'CANDIDATE_GATES_ONLY',candidate_qualified:false};
}
async function recoverCandidateJob(pool:DB,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','job_id']);const s=scope(v),jobId=uuid(v.job_id);
 const saved=await tx(pool,async db=>{
  await currentRun(db,s,true,undefined,false,{kind:'CANDIDATE',id:jobId});const row=(await db.query('SELECT * FROM hyperfide.integration_jobs WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),jobId])).rows[0];if(!row)fail('INTEGRATION_JOB_UNKNOWN','Recorded integration job required');
  if(!['RUNNING','OUTCOME_UNKNOWN'].includes(row.state)){await releaseTerminalReservations(db,s,jobId);return {terminal:true,state:row.state};}
  if(!Array.isArray(row.execution_manifest)||!row.execution_manifest.length)fail('INTEGRATION_REMOTE_RECOVERY_UNAVAILABLE','Immutable exact remote plans unavailable; no redispatch');
  const candidate=await readCandidate(db,s,row.candidate_id),plans=[];for(const raw of row.execution_manifest){const entry=obj(raw);plans.push({gate:entry.gate as GateConfig,prepared:await restoreRemote(db,entry.remote)});}
  return {terminal:false,state:row.state,candidate_id:row.candidate_id,job:{id:jobId,row:candidate.row,plans,verificationInput:row.verification_input_digest}};
 });
 if(saved.terminal)return {job_id:jobId,state:saved.state,replayed:true};
 return executeCandidateJob(pool,s,saved.candidate_id!,saved.job!);
}
export function createComponent(ctx:ComponentContext):Component{
 let cfg:Promise<IntegrationConfig>|undefined;const settings=()=>cfg??=config(ctx.env);
 return bindScope(ctx,{apiVersion:1,actions:{
 'integration.candidate.create':async input=>createCandidate(primaryClient(),await settings(),input),
 'integration.candidate.bind_reviews':async input=>bindReviews(primaryClient(),input),
 'integration.candidate.inspect':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','candidate_id']);return readCandidate(primaryClient(),scope(v),uuid(v.candidate_id));},
 'integration.candidate.reconcile':async input=>recoverCandidateJob(primaryClient(),input),
 'integration.candidate.status':async input=>candidateStatus(primaryClient(),input),
 'integration.candidate.cleanup':async input=>cleanupIntegration(primaryClient(),await settings(),input),
 'integration.candidate.verify':async input=>runGates(primaryClient(),await settings(),ctx.env,input),
 'integration.candidate.admit':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','candidate_id']);const s=scope(v),id=uuid(v.candidate_id);return tx(primaryClient(),async db=>{const c=await candidateReady(db,s,id);await db.query("UPDATE hyperfide.integration_candidates SET state='READY',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),id]);return {candidate_id:id,input_manifest_digest:c.row.input_manifest_digest,state:'READY',integrated:false,wave_closed:false,programme_qualified:false};});}
 }});
}
