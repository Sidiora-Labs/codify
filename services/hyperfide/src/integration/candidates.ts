import fs from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError,object} from '../policy/programme.js';
import {getPool} from '../storage/schema.js';

const exec=promisify(execFile);
export type DB=Pick<pg.PoolClient,'query'>;
interface IntegrationInvocation {context:ComponentContext;invocation:unknown}
const invocationStorage=new AsyncLocalStorage<IntegrationInvocation>();
interface Gateway {withPrimaryTransaction<T>(options:{timeoutMs:number;maxRetries:number;guard?:(db:DB)=>Promise<void>;signal?:AbortSignal},fn:(db:DB)=>Promise<T>):Promise<T>}
function gateway(context:ComponentContext):Gateway{
 const resources=(context as unknown as {resources?:{gateway?:Gateway}}).resources;
 if(!resources?.gateway)fail('INTEGRATION_DEPENDENCY_NOT_READY','Primary transaction gateway4.2 required');
 return resources.gateway;
}
export async function runnerRemote(context:ComponentContext):Promise<{prepare:(db:DB,invocation:unknown,plan:Record<string,unknown>)=>Promise<unknown>;execute:(permit:unknown,signal:AbortSignal)=>Promise<Record<string,any>>}>{
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
 return invocationStorage.run({context,invocation},()=>Promise.resolve(handler(input,context)));
 };return {...component,actions};
}
export function currentInvocation():IntegrationInvocation{
 const state=invocationStorage.getStore();if(!state?.invocation)fail('AUTH_REQUIRED','Authenticated action invocation required');return state;
}
export async function prepareRemote(db:DB,plan:Record<string,unknown>):Promise<{remote:Awaited<ReturnType<typeof runnerRemote>>;permit:unknown;plan:Record<string,unknown>}>{
 const active=currentInvocation(),remote=await runnerRemote(active.context);
 const env=active.context.env;const executable=env.HYPERFIDE_REMOTE_NODE_DIGEST;if(!executable)fail('INTEGRATION_REMOTE_RUNTIME_UNAVAILABLE','Observed remote Node executable digest required');digest(executable);plan={...plan,executable_digest:executable,environment_digest:hash(canonical(plan.environment??{})),artifact_paths:[]};const permit=await remote.prepare(db,active.invocation,plan);return {remote,permit,plan};
}
export async function executeRemote(prepared:Awaited<ReturnType<typeof prepareRemote>>):Promise<Record<string,any>>{
 const active=currentInvocation();const captured=await prepared.remote.execute(prepared.permit,active.context.signal);const decode=(value:unknown):string=>{const output=obj(value);if(!(output.bytes instanceof Uint8Array)||output.complete!==true||output.size_bytes!==output.bytes.byteLength||hash(Buffer.from(output.bytes))!==output.digest)fail('INTEGRATION_REMOTE_OUTPUT_INVALID','Complete independently hashed capture required');return new TextDecoder('utf-8',{fatal:true}).decode(output.bytes);};const result:Record<string,any>={...captured,stdout:decode(captured.stdout),stderr:decode(captured.stderr)};
 if(result.status!=='COMPLETED'||result.output_complete!==true||typeof result.stdout!=='string'||typeof result.stderr!=='string'||result.exit_code!==0||result.session_id!==prepared.plan.session_id||result.source_digest!==prepared.plan.source_digest||result.policy_digest!==prepared.plan.policy_digest||!result.process_ref||!result.sandbox_id||!result.slot_id||!result.cleanup?.complete||result.cleanup.observed_process_absent!==true)fail('INTEGRATION_REMOTE_OUTCOME_UNKNOWN','Remote execution did not prove complete current bound output and process cleanup');
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
export async function tx<T>(_pool:pg.Pool,fn:(db:DB)=>Promise<T>):Promise<T>{
 const active=currentInvocation(),i=active.invocation as {guard?:(db:DB)=>Promise<void>;signal?:AbortSignal};
 if(typeof i.guard!=='function')fail('AUTH_REQUIRED','Current primary invocation guard required');
 return gateway(active.context).withPrimaryTransaction({timeoutMs:10000,maxRetries:0,guard:i.guard,signal:active.context.signal},fn);
}
const REMOTE_GATE_SCRIPT="import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';\nconst chunks=[];for await(const part of process.stdin)chunks.push(part);const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));\nconst h=b=>'sha256:'+createHash('sha256').update(b).digest('hex');\nif(!path.isAbsolute(input.module_path)||h(await fs.readFile(input.module_path))!==input.module_digest)throw Error('qualified remote integration runtime missing');\nconst runtime=await import(pathToFileURL(input.module_path).href),base='/tmp/hyperfide/integration-'+input.operation_id;\nawait fs.mkdir(base,{mode:0o700});const added=[];\ntry{\n let workingDirectory;\n if(input.mode==='CANDIDATE'){\n  workingDirectory=path.join(base,'source');await runtime.integrationGit(process.cwd(),['worktree','add','--detach',workingDirectory,input.candidate_head]);added.push({repository:process.cwd(),directory:workingDirectory});\n }else{\n  const configured=JSON.parse(process.env.HYPERFIDE_INTEGRATION_REPOSITORIES_JSON??'{}');\n  for(const repository of input.scope.repositories){\n   const source=repository.repository_id===input.repository_id?process.cwd():configured[repository.repository_id];\n   if(typeof source!=='string'||!path.isAbsolute(source)||await fs.realpath(source)!==source)throw Error('prepared multi-repository workspace missing');\n   const publication=[...input.scope.publications].reverse().find(p=>p.repository_id===repository.repository_id&&p.state==='PUBLISHED'&&p.observed_head===p.candidate_head);if(!publication)throw Error('scope repository unpublished');\n   const directory=path.join(base,repository.repository_id);await runtime.integrationGit(source,['worktree','add','--detach',directory,publication.candidate_head]);added.push({repository:source,directory});if(!workingDirectory)workingDirectory=directory;\n  }\n  await fs.writeFile(path.join(base,'scope-manifest.json'),JSON.stringify(input.scope)+'\\n',{mode:0o600});\n }\n if(!workingDirectory)throw Error('empty execution scope');\n const observed=await runtime.registeredScopeGate(input.gate,workingDirectory,base,input.input_digest,{...process.env,...input.harness_env,HYPERFIDE_SCOPE_MANIFEST:path.join(base,'scope-manifest.json')},input.mode!=='CANDIDATE');\n for(const entry of added){if(await runtime.integrationGit(entry.directory,['status','--porcelain','--untracked-files=all']))throw Error('qualification changed candidate source');}\n for(const entry of added.reverse())await runtime.integrationGit(entry.repository,['worktree','remove','--force',entry.directory]);added.length=0;await fs.rm(base,{recursive:true,force:true});\n process.stdout.write(JSON.stringify(observed)+'\\n');\n}finally{for(const entry of added.reverse())await runtime.integrationGit(entry.repository,['worktree','remove','--force',entry.directory]);await fs.rm(base,{recursive:true,force:true});}\n";
export async function prepareRemoteGate(db:DB,s:Scope,request:{session_id:string;reservation_id:string;repository_id:string;input_digest:string;policy_digest:string;gate:GateConfig;mode:'CANDIDATE'|'WAVE'|'PROGRAMME';candidate_head?:string;snapshot?:Record<string,any>}):Promise<Awaited<ReturnType<typeof prepareRemote>>>{
 const context=currentInvocation().context,env=context.env,operationId=randomUUID();
 const modulePath=env.HYPERFIDE_REMOTE_CLOSURE_MODULE,moduleDigest=env.HYPERFIDE_REMOTE_CLOSURE_DIGEST;
 if(!modulePath||!moduleDigest)fail('INTEGRATION_REMOTE_RUNTIME_UNAVAILABLE','Qualified remote integration runtime and exact digest required');
 const harnessEnv={HYPERFIDE_QUALIFICATION_ROOT:env.HYPERFIDE_REMOTE_QUALIFICATION_ROOT??'',HYPERFIDE_QUALIFIER_DIGEST:env.HYPERFIDE_QUALIFIER_DIGEST??'',HYPERFIDE_CHECKER_DIGEST:env.HYPERFIDE_CHECKER_DIGEST??''};
 const compact=request.snapshot?{...request.snapshot,publications:request.snapshot.publications.map((p:Record<string,any>)=>({repository_id:p.repository_id,candidate_head:p.candidate_head,observed_head:p.observed_head,state:p.state,input_manifest_digest:p.input_manifest_digest})),reviewObservations:request.snapshot.reviewObservations.map((r:Record<string,any>)=>({repository_id:r.repository_id,source_object_id:r.source_object_id,status:r.status,receipt_ids:r.receipt_ids??[]}))}:undefined;
 const data={operation_id:operationId,module_path:modulePath,module_digest:moduleDigest,mode:request.mode,repository_id:request.repository_id,candidate_head:request.candidate_head??null,scope:compact??null,gate:{...request.gate,covers:request.gate.proof.case_ids},input_digest:request.input_digest,harness_env:harnessEnv};
 const stdin=canonical(data);if(Buffer.byteLength(stdin)>1024*1024)fail('INTEGRATION_REMOTE_MANIFEST_UNBOUNDED','Scope requires a durable artifact-backed remote manifest');
 return prepareRemote(db,{session_id:request.session_id,operation_id:operationId,repository_id:request.repository_id,reservation_id:request.reservation_id,argv:['node','--input-type=module','-e',REMOTE_GATE_SCRIPT],cwd:'.',environment:{},stdin,timeout_ms:request.gate.timeout_ms+60000,source_digest:hash(canonical({input_digest:request.input_digest,script_digest:hash(REMOTE_GATE_SCRIPT),gate:request.gate})),policy_digest:request.policy_digest});
}
export async function currentRun(db:DB,s:Scope,lock=false,admittedPublicationId?:string,observe=false):Promise<Record<string,any>>{
 const r=await db.query('SELECT * FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2'+(lock?' FOR UPDATE':''),values(s));
 const row=r.rows[0];if(!row||!['READY','RUNNING',...(observe?['SUCCEEDED']:[]),...(admittedPublicationId?['DRAINING','DRAINED']:[])].includes(row.state))fail('INTEGRATION_RUN_HELD','Run does not permit integration');
 const halted=await db.query('SELECT mode FROM hyperfide.integration_admission_halts WHERE organisation_id=$1 AND run_id=$2',values(s));
 if(halted.rowCount)fail('INTEGRATION_ADMISSION_STOPPED','Emergency control holds all new integration admissions');
 const moduleName='../recovery/control.js';let inspect:unknown;
 try{inspect=(await import(moduleName)).inspectRecoveryHold;}catch{fail('INTEGRATION_RECOVERY_UNAVAILABLE','Recovery hold inspector unavailable');}
 if(typeof inspect!=='function')fail('INTEGRATION_RECOVERY_UNAVAILABLE','Recovery hold inspector unavailable');
 const holds=await inspect(db,{...s,authority_epoch:row.authority_epoch});
 if(!Array.isArray(holds))fail('INTEGRATION_RECOVERY_UNAVAILABLE','Invalid recovery observation');
 for(const hold of holds.filter(h=>h.status==='ACTIVE')){if(hold.mode==='DRAIN'&&admittedPublicationId){const eligible=await db.query("SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND created_at<=$4::timestamptz AND clock_timestamp()<$5::timestamptz AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')",[...values(s),uuid(admittedPublicationId),hold.accepted_at,hold.drain_deadline]);if(eligible.rowCount)continue;}fail('INTEGRATION_RECOVERY_HELD','Recovery control holds integration or drain authority has expired');}
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
export async function custody(db:DB,s:Scope,id:string,expectedGeneration?:string):Promise<Record<string,any>>{
 const r=await db.query("SELECT c.*,t.current_custody_id,t.criteria_digest AS task_criteria,t.state AS task_state,t.spec_revision_id,t.spec_generation FROM hyperfide.submission_custodies c JOIN hyperfide.tasks t ON t.organisation_id=c.organisation_id AND t.run_id=c.run_id AND t.id=c.task_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3 FOR UPDATE OF c,t",[...values(s),id]);
 const c=r.rows[0];if(!c||c.authority!=='ACTIVE'||c.qualification_outcome!=='PASS'||c.current_custody_id!==c.id||c.criteria_digest!==c.task_criteria||!['QUALIFIED','INTEGRATING'].includes(c.task_state)||(expectedGeneration!==undefined&&String(c.custody_generation)!==expectedGeneration))fail('INTEGRATION_CUSTODY_STALE','Current qualified custody required');
 const moduleName='../assurance/coverage.js';let inspect:unknown;
 try{inspect=(await import(moduleName)).inspectCoverage;}catch{fail('INTEGRATION_QUALIFICATION_UNAVAILABLE','Current executable qualification evidence unavailable');}
 if(typeof inspect!=='function')fail('INTEGRATION_QUALIFICATION_UNAVAILABLE','Qualification inspector unavailable');
 const coverage=await inspect(db,s,c.id);
 if(!object(coverage)||coverage.qualified!==true||coverage.applicability!=='CURRENT'||coverage.authority!=='ACTIVE'||coverage.qualification_outcome!=='PASS'||String(coverage.custody_generation)!==String(c.custody_generation)||coverage.source_object_id!==c.source_object_id||coverage.criteria_digest!==c.criteria_digest||coverage.source_manifest_digest!==c.source_manifest_digest||coverage.evidence_manifest_digest!==c.evidence_manifest_digest)fail('INTEGRATION_QUALIFICATION_STALE','Current input-bound executable evidence required');
 digest(coverage.receipt_digest);return c;
}
export interface CandidateManifest {
 version:1;request_id:string;run_id:string;spec_revision_id:string;spec_generation:string;policy_digest:string;authority_epoch:string;
 repository_id:string;branch_authority_id:string;branch_generation:string;target_ref:string;expected_old_head:string;candidate_head:string;tree:string;parents:string[];
 contributors:{custody_id:string;custody_generation:string;task_id:string;source_object_id:string;criteria_digest:string;source_manifest_digest:string;evidence_manifest_digest:string}[];
 commit_set:{repository_id:string;candidate_head:string;expected_old_head:string}[];
 execution_session_id:string;execution_receipt_digest:string;environment_digest:string;contract_digest:string;required_gates:GateConfig[];review_policy_digest:string;review_rubrics:string[];required_graph:boolean;review_sources:string[];
}
export async function readCandidate(db:DB,s:Scope,id:string,lock=false):Promise<{row:Record<string,any>;manifest:CandidateManifest}>{
 const r=await db.query('SELECT c.*,m.manifest FROM hyperfide.integration_candidates c JOIN hyperfide.integration_candidate_manifests m USING(organisation_id,run_id) WHERE c.id=m.candidate_id AND c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3'+(lock?' FOR UPDATE OF c':''),[...values(s),id]);
 const row=r.rows[0];if(!row||hash(canonical(row.manifest))!==row.input_manifest_digest)fail('INTEGRATION_CANDIDATE_UNKNOWN','Candidate missing or immutable manifest mismatch');return {row,manifest:row.manifest};
}
export async function reviewCoverage(db:DB,s:Scope,m:CandidateManifest,inputDigest:string,candidateId:string):Promise<void>{
 const moduleName='../review/coverage.js';let inspect:unknown;try{inspect=(await import(moduleName)).inspectReviewCoverage;}catch{fail('INTEGRATION_REVIEW_UNAVAILABLE','Authoritative review obligations unavailable');}
 if(typeof inspect!=='function')fail('INTEGRATION_REVIEW_UNAVAILABLE','Authoritative review interface unavailable');
 const bindings=(await db.query('SELECT * FROM hyperfide.integration_candidate_review_inputs WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3',[...values(s),candidateId])).rows;
 if(!Array.isArray(m.review_sources)||bindings.length!==m.review_sources.length)fail('INTEGRATION_REVIEW_INCOMPLETE','Complete per-source review bindings required');
 for(const source of m.review_sources){
 const binding=bindings.find(b=>b.source_object_id===source&&b.repository_id===m.repository_id&&b.policy_digest===m.review_policy_digest);if(!binding)fail('INTEGRATION_REVIEW_INCOMPLETE','Required source review binding missing');
 const result=await inspect(db,s,{repository_id:m.repository_id,source_object_id:source,candidate_digest:inputDigest,input_manifest_digest:binding.input_manifest_digest,policy_digest:binding.policy_digest});
 if(!object(result)||result.status!=='COMPLETE'||result.authority!=='POSTGRESQL_REVIEW_OBLIGATIONS'||!Number.isSafeInteger(result.required)||Number(result.required)<=0||result.complete!==result.required||!Array.isArray(result.missing)||result.missing.length||!Array.isArray(result.untriaged_observation_ids)||result.untriaged_observation_ids.length||!Array.isArray(result.blocking_observation_ids)||result.blocking_observation_ids.length)fail('INTEGRATION_REVIEW_INCOMPLETE','Exact review denominator or canonical finding ingestion remains incomplete');
 }
}
async function bindReviews(pool:pg.Pool,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','candidate_id','review_inputs']);const s=scope(v),id=uuid(v.candidate_id);if(!Array.isArray(v.review_inputs))fail('INTEGRATION_INVALID','Per-source review inputs required');const reviewInputs=v.review_inputs;
 return tx(pool,async db=>{
 await currentRun(db,s,true);const {row,manifest:m}=await readCandidate(db,s,id,true);if(!Array.isArray(m.review_sources)||reviewInputs.length!==m.review_sources.length)fail('INTEGRATION_REVIEW_INCOMPLETE','Review source denominator differs');
 const sources=new Set<string>();for(const raw of reviewInputs){const item=obj(raw);keys(item,['repository_id','source_object_id','input_manifest_digest','policy_digest']);const source=oid(item.source_object_id);
 if(uuid(item.repository_id)!==m.repository_id||!m.review_sources.includes(source)||sources.has(source)||digest(item.policy_digest)!==m.review_policy_digest)fail('INTEGRATION_REVIEW_INCOMPLETE','Unexpected or duplicate review source');sources.add(source);
 await db.query('INSERT INTO hyperfide.integration_candidate_review_inputs(organisation_id,run_id,candidate_id,repository_id,source_object_id,input_manifest_digest,policy_digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[...values(s),id,m.repository_id,source,digest(item.input_manifest_digest),m.review_policy_digest]);
 const binding=(await db.query('SELECT input_manifest_digest FROM hyperfide.integration_candidate_review_inputs WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3 AND source_object_id=$4',[...values(s),id,source])).rows[0];if(binding?.input_manifest_digest!==item.input_manifest_digest)fail('INTEGRATION_IDEMPOTENCY_CONFLICT','Immutable review input binding differs');
 }
 await reviewCoverage(db,s,m,row.input_manifest_digest,id);return {candidate_id:id,review_inputs_bound:true,candidate_qualified:false};
 });
}
export async function candidateReady(db:DB,s:Scope,id:string,admittedPublicationId?:string):Promise<{row:Record<string,any>;manifest:CandidateManifest}>{
 const run=await currentRun(db,s,true,admittedPublicationId);const {row,manifest:m}=await readCandidate(db,s,id,true);
 if(run.spec_revision_id!==m.spec_revision_id||String(run.spec_generation)!==m.spec_generation||run.policy_digest!==m.policy_digest||run.authority_epoch!==m.authority_epoch)fail('INTEGRATION_INPUT_STALE','Run inputs changed');
 const authority=await db.query("SELECT * FROM hyperfide.branch_authorities WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE",[...values(s),m.branch_authority_id]);
 const a=authority.rows[0];if(!a||a.authority!=='ACTIVE'||String(a.branch_generation)!==m.branch_generation||a.expected_old_head!==m.expected_old_head||a.authority_epoch!==run.authority_epoch)fail('INTEGRATION_BRANCH_STALE','Branch authority changed');
 for(const contributor of m.contributors){const c=await custody(db,s,contributor.custody_id,contributor.custody_generation);if(c.source_object_id!==contributor.source_object_id||c.source_manifest_digest!==contributor.source_manifest_digest||c.evidence_manifest_digest!==contributor.evidence_manifest_digest)fail('INTEGRATION_INPUT_STALE','Contributor input changed');}
 const receipts=await db.query("SELECT r.gate_id,r.outcome,r.input_manifest_digest FROM hyperfide.integration_gate_receipts r JOIN hyperfide.integration_jobs j ON j.organisation_id=r.organisation_id AND j.run_id=r.run_id AND j.id=r.job_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.candidate_id=$3 AND j.state='SUCCEEDED' ORDER BY r.attempt DESC",[...values(s),id]);
 for(const gate of m.required_gates){const receipt=receipts.rows.find(r=>r.gate_id===gate.id);if(!receipt||receipt.outcome!=='PASS'||receipt.input_manifest_digest!==row.input_manifest_digest)fail('INTEGRATION_GATE_INCOMPLETE','Required candidate gate is not current PASS');}
 await reviewCoverage(db,s,m,row.input_manifest_digest,id);
 const findingsModule='../findings/registry.js';let inspectFindings:unknown;
 try{inspectFindings=(await import(findingsModule)).inspectBlockingFindings;}catch{fail('INTEGRATION_FINDINGS_UNAVAILABLE','Current finding disposition inspector unavailable');}
 if(typeof inspectFindings!=='function')fail('INTEGRATION_FINDINGS_UNAVAILABLE','Finding inspector unavailable');
 const findings=await inspectFindings(db,{...s,repository_id:m.repository_id,source_object_id:m.candidate_head});
 if(!object(findings)||findings.clear!==true||!Array.isArray(findings.blockers)||findings.blockers.length)fail('INTEGRATION_FINDING_BLOCKS','Applicable blocking findings remain');
 if(m.required_graph){const graph=await db.query('SELECT 1 FROM hyperfide.graph_manifests WHERE organisation_id=$1 AND run_id=$2 AND source_manifest_digest=$3',[...values(s),row.input_manifest_digest]);if(!graph.rowCount)fail('INTEGRATION_GRAPH_STALE','Exact candidate graph required');}
 return {row,manifest:m};
}
const CANDIDATE_BUILD_SCRIPT="import {execFileSync} from 'node:child_process';\nimport {randomUUID,createHash} from 'node:crypto';\nconst chunks=[];for await(const x of process.stdin)chunks.push(x);\nconst input=JSON.parse(Buffer.concat(chunks).toString('utf8'));\nconst env={PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Hyperfide',GIT_AUTHOR_EMAIL:'integration@hyperfide.invalid',GIT_COMMITTER_NAME:'Hyperfide',GIT_COMMITTER_EMAIL:'integration@hyperfide.invalid',GIT_AUTHOR_DATE:'2000-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2000-01-01T00:00:00Z'};\nconst g=(args,binary=false)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','gc.auto=0',...args],{env,encoding:binary?undefined:'utf8',maxBuffer:12*1024*1024,timeout:120000});\nconst oid=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;\nif(!oid.test(input.base)||!Array.isArray(input.commits)||!input.commits.length||input.commits.some(c=>!oid.test(c)))throw Error('invalid pinned commits');\nlet head=input.base;\nfor(const source of input.commits){if(g(['cat-file','-t',source]).trim()!=='commit')throw Error('source is not commit');const tree=g(['merge-tree','--write-tree',head,source]).trim();if(!oid.test(tree))throw Error('merge conflict');head=g(['commit-tree',tree,'-p',head,'-p',source,'-m','Hyperfide immutable integration candidate']).trim();}\nconst tree=g(['rev-parse',head+'^{tree}']).trim(),ref='refs/hyperfide/integration/'+randomUUID();\ng(['update-ref',ref,head]);\ntry{const bundle=g(['bundle','create','-',ref,'^'+input.base],true);if(bundle.length>8*1024*1024)throw Error('candidate delta exceeds captured bundle bound; durable object transfer required');console.log(JSON.stringify({head,tree,parents:g(['show','-s','--format=%P',head]).trim().split(' ').filter(Boolean),bundle:bundle.toString('base64'),bundle_digest:'sha256:'+createHash('sha256').update(bundle).digest('hex'),ref}));}\nfinally{g(['update-ref','-d',ref]);}\n";
async function createCandidate(pool:pg.Pool,cfg:IntegrationConfig,input:unknown):Promise<unknown>{
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
  const run=await currentRun(db,s,true),plans:{t:typeof parsed[number];r:RepositoryConfig;a:Record<string,any>;contributors:Record<string,any>[];id:string;prepared:Awaited<ReturnType<typeof prepareRemote>>}[]=[];
  const priorPreparation=(await db.query('SELECT request_digest,state FROM hyperfide.integration_preparations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 FOR UPDATE',[...values(s),request])).rows[0];
  if(priorPreparation){if(priorPreparation.request_digest!==requestDigest)fail('INTEGRATION_IDEMPOTENCY_CONFLICT','Pending request identity has different immutable inputs');fail('INTEGRATION_PREPARATION_PENDING','Reconcile recorded remote execution before repeating candidate preparation');}
  for(const t of parsed){
   const r=repository(cfg,t.repository_id);
   const a=(await db.query('SELECT * FROM hyperfide.branch_authorities WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),t.branch_authority_id])).rows[0];
   if(!a||a.repository_id!==t.repository_id||a.branch_ref!==r.target_ref||a.authority!=='ACTIVE'||a.authority_epoch!==run.authority_epoch||!a.expected_old_head)fail('INTEGRATION_BRANCH_STALE','Current pinned target authority required');
   const contributors=[];for(const id of t.custody_ids){const contributor=await custody(db,s,id);if(contributor.repository_id!==t.repository_id)fail('INTEGRATION_SCOPE_DENIED','Contributor belongs to another repository');contributors.push(contributor);}
   const source={repository_id:t.repository_id,base:a.expected_old_head,commits:contributors.map(c=>c.source_object_id),script_digest:hash(CANDIDATE_BUILD_SCRIPT)};
   const plan={session_id:t.session_id,operation_id:randomUUID(),repository_id:t.repository_id,reservation_id:t.reservation_id,argv:['node','--input-type=module','-e',CANDIDATE_BUILD_SCRIPT],cwd:'.',environment:{},timeout_ms:900000,source_digest:hash(canonical(source)),policy_digest:run.policy_digest,stdin:canonical({base:a.expected_old_head,commits:source.commits})};
   plans.push({t,r,a,contributors,id:randomUUID(),prepared:await prepareRemote(db,plan)});
  }
  await db.query("INSERT INTO hyperfide.integration_preparations(organisation_id,run_id,request_id,request_digest,state,execution_manifest) VALUES($1,$2,$3,$4,'PREPARING',$5) ON CONFLICT DO NOTHING",[...values(s),request,requestDigest,plans.map(p=>({candidate_id:p.id,plan:p.prepared.plan}))]);
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
  const filename=path.join(cfg.root,'candidate-transfer-'+p.id+'.bundle');await fs.writeFile(filename,bundle,{flag:'wx',mode:0o600});
  try{await git(p.r.path,['bundle','verify',filename]);await git(p.r.path,['fetch','--no-tags',filename,output.ref]);if(await git(p.r.path,['rev-parse',head+'^{tree}'])!==tree)fail('INTEGRATION_REMOTE_OUTPUT_INVALID','Imported candidate tree mismatch');}
  finally{await fs.rm(filename,{force:true});}
  prepared.push({...p,head,tree,parents,remote_receipt_digest:result.spool_digest});
 }
 const commitSet=prepared.map(p=>({repository_id:p.t.repository_id,candidate_head:p.head,expected_old_head:String(p.a.expected_old_head)})).sort((a,b)=>a.repository_id.localeCompare(b.repository_id));
 return tx(pool,async db=>{
 const run=await currentRun(db,s,true);const existing=await db.query('SELECT request_digest,candidate_ids FROM hyperfide.integration_requests WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[...values(s),request]);
 if(existing.rows[0]){if(existing.rows[0].request_digest!==requestDigest)fail('INTEGRATION_IDEMPOTENCY_CONFLICT','Changed request');return {candidate_ids:existing.rows[0].candidate_ids,replayed:true};}
 for(const p of prepared){
  const contributors=[];
  for(const old of p.contributors){const c=await custody(db,s,old.id,String(old.custody_generation));if(c.source_object_id!==old.source_object_id||c.repository_id!==p.t.repository_id||c.authority_epoch!==run.authority_epoch)fail('INTEGRATION_INPUT_STALE','Contributor changed during candidate build');contributors.push({custody_id:c.id,custody_generation:String(c.custody_generation),task_id:c.task_id,source_object_id:c.source_object_id,criteria_digest:c.criteria_digest,source_manifest_digest:c.source_manifest_digest,evidence_manifest_digest:c.evidence_manifest_digest});}
  const a=(await db.query('SELECT * FROM hyperfide.branch_authorities WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),p.a.id])).rows[0];
  if(!a||a.authority!=='ACTIVE'||String(a.branch_generation)!==String(p.a.branch_generation)||a.expected_old_head!==p.a.expected_old_head||a.authority_epoch!==run.authority_epoch)fail('INTEGRATION_BRANCH_STALE','Target authority changed during candidate build');
  const m:CandidateManifest={version:1,request_id:request,run_id:s.run_id,spec_revision_id:run.spec_revision_id,spec_generation:String(run.spec_generation),policy_digest:run.policy_digest,authority_epoch:run.authority_epoch,repository_id:p.t.repository_id,branch_authority_id:a.id,branch_generation:String(a.branch_generation),target_ref:p.r.target_ref,expected_old_head:a.expected_old_head,candidate_head:p.head,tree:p.tree,parents:p.parents,contributors,commit_set:commitSet,execution_session_id:p.t.session_id,execution_receipt_digest:p.remote_receipt_digest,environment_digest:String(v.environment_digest),contract_digest:String(v.contract_digest),required_gates:p.r.gates,review_policy_digest:p.r.review_policy_digest,review_rubrics:p.r.review_rubrics,required_graph:p.r.required_graph,review_sources:[...new Set([p.head,...contributors.map(c=>c.source_object_id)])].sort()};
  const md=hash(canonical(m));const first=contributors[0]!;
  await db.query("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,'commit') ON CONFLICT DO NOTHING",[s.organisation_id,p.t.repository_id,p.head]);
  await db.query('INSERT INTO hyperfide.integration_candidates(organisation_id,run_id,id,task_id,custody_id,custody_generation,repository_id,branch_authority_id,branch_generation,expected_old_head,candidate_head,input_manifest_digest,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[...values(s),p.id,first.task_id,first.custody_id,first.custody_generation,p.t.repository_id,a.id,String(a.branch_generation),a.expected_old_head,p.head,md,randomUUID()]);
  await db.query('INSERT INTO hyperfide.integration_candidate_manifests(organisation_id,run_id,candidate_id,manifest) VALUES($1,$2,$3,$4)',[...values(s),p.id,m]);
  for(const c of contributors)await db.query('INSERT INTO hyperfide.candidate_custodies(organisation_id,run_id,candidate_id,custody_id,custody_generation,task_id,repository_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[...values(s),p.id,c.custody_id,c.custody_generation,c.task_id,p.t.repository_id]);
 }
 const ids=prepared.map(p=>p.id);await db.query('INSERT INTO hyperfide.integration_requests(organisation_id,run_id,request_id,request_digest,candidate_ids) VALUES($1,$2,$3,$4,$5)',[...values(s),request,requestDigest,ids]);await db.query("UPDATE hyperfide.integration_preparations SET state='PREPARED' WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3",[...values(s),request]);return {candidate_ids:ids,commit_set:commitSet,replayed:false};
 });
}
async function runGates(pool:pg.Pool,_cfg:IntegrationConfig,_env:Readonly<NodeJS.ProcessEnv>,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','candidate_id','reservation_id','session_id']);const s=scope(v),id=uuid(v.candidate_id),reservation=uuid(v.reservation_id),session=uuid(v.session_id);
 const job=await tx(pool,async db=>{
  const run=await currentRun(db,s,true),candidate=await readCandidate(db,s,id,true);
  const held=await db.query("SELECT 1 FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='ALLOCATED' AND attempt_id IS NULL AND quantity>0 AND expires_at>clock_timestamp() FOR UPDATE",[...values(s),reservation]);if(!held.rowCount)fail('INTEGRATION_RESERVATION_REQUIRED','Separate integration reservation required');
  const active=await db.query("SELECT 1 FROM hyperfide.integration_jobs WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3 AND state IN ('RUNNING','OUTCOME_UNKNOWN') FOR UPDATE",[...values(s),id]);if(active.rowCount)fail('INTEGRATION_JOB_ACTIVE','Existing remote job must be reconciled');
  const jobId=randomUUID(),plans=[];
  for(const gate of candidate.manifest.required_gates)plans.push({gate,prepared:await prepareRemoteGate(db,s,{session_id:session,reservation_id:reservation,repository_id:candidate.manifest.repository_id,input_digest:candidate.row.input_manifest_digest,policy_digest:run.policy_digest,gate,mode:'CANDIDATE',candidate_head:candidate.manifest.candidate_head})});
  await db.query("INSERT INTO hyperfide.integration_jobs(organisation_id,run_id,id,candidate_id,executor_id,reservation_id,state) VALUES($1,$2,$3,$4,$5,$6,'RUNNING')",[...values(s),jobId,id,session,reservation]);return {id:jobId,...candidate,plans};
 });
 const results:Record<string,unknown>[]=[];
 for(const entry of job.plans){
  const capture=await executeRemote(entry.prepared),observed=obj(JSON.parse(capture.stdout));
  const stdout=String(observed.stdout??''),stderr=String(observed.stderr??''),assertions=Number(observed.assertions),proof=obj(observed.proof);
  const outcome=observed.exitCode===0&&Number.isSafeInteger(assertions)&&assertions>0&&proof.scope_digest===job.row.input_manifest_digest?'PASS':'FAIL';
  await tx(pool,async db=>{await currentRun(db,s,true);await readCandidate(db,s,id,true);await db.query('INSERT INTO hyperfide.integration_gate_receipts(organisation_id,run_id,candidate_id,job_id,gate_id,input_manifest_digest,outcome,exit_code,assertion_count,stdout_digest,stderr_digest,stdout,stderr,proof) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[...values(s),id,job.id,entry.gate.id,job.row.input_manifest_digest,outcome,observed.exitCode,assertions,hash(stdout),hash(stderr),stdout,stderr,{...proof,remote_spool_digest:capture.spool_digest,remote_cleanup_receipt_digest:capture.cleanup.receipt_digest}]);});
  results.push({gate_id:entry.gate.id,outcome,remote_process_ref:capture.process_ref,spool_digest:capture.spool_digest});
 }
 await tx(pool,async db=>{await currentRun(db,s,true);await db.query("UPDATE hyperfide.integration_jobs SET state=$4,finished_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='RUNNING'",[...values(s),job.id,results.every(r=>r.outcome==='PASS')?'SUCCEEDED':'FAILED']);});
 return {job_id:job.id,results,scope:'CANDIDATE_GATES_ONLY',candidate_qualified:false};
}
export function createComponent(ctx:ComponentContext):Component{
 let cfg:Promise<IntegrationConfig>|undefined;const settings=()=>cfg??=config(ctx.env);
 return bindScope(ctx,{apiVersion:1,actions:{
 'integration.candidate.create':async input=>createCandidate(getPool(ctx.env),await settings(),input),
 'integration.candidate.bind_reviews':async input=>bindReviews(getPool(ctx.env),input),
 'integration.candidate.inspect':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','candidate_id']);return readCandidate(getPool(ctx.env),scope(v),uuid(v.candidate_id));},
 'integration.candidate.verify':async input=>runGates(getPool(ctx.env),await settings(),ctx.env,input),
 'integration.candidate.admit':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','candidate_id']);const s=scope(v),id=uuid(v.candidate_id);return tx(getPool(ctx.env),async db=>{const c=await candidateReady(db,s,id);await db.query("UPDATE hyperfide.integration_candidates SET state='READY',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),id]);return {candidate_id:id,input_manifest_digest:c.row.input_manifest_digest,state:'READY',integrated:false,wave_closed:false,programme_qualified:false};});}
 }});
}
