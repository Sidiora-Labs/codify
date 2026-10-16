import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {getPool,databaseError} from '../storage/schema.js';

const execute=promisify(execFile);
export type ReviewDb=Pick<pg.PoolClient,'query'>;
export interface ReviewScope {organisation_id:string;run_id:string}
export interface ReviewCoverageQuery {
 repository_id:string;source_object_id:string;candidate_digest?:string;
 input_manifest_digest?:string;policy_digest?:string;
}
export function fail(code:string,message:string):never {throw new FoundationError(code,message);}
export function obj(value:unknown,fields:string[],optional:string[]=[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('REVIEW_INPUT_INVALID','Expected an object');
 const result=value as Record<string,unknown>;
 if(Object.keys(result).some(key=>!fields.includes(key))||fields.some(key=>!optional.includes(key)&&!Object.hasOwn(result,key)))
  fail('REVIEW_INPUT_INVALID','Unknown or missing review input field');
 return result;
}
export function uuid(value:unknown):string{
 if(typeof value!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).test(value))
  fail('REVIEW_INPUT_INVALID','Expected a canonical UUID');return value;
}
export function digest(value:unknown):string{
 if(typeof value!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value))fail('REVIEW_INPUT_INVALID','Expected a SHA256 identity');return value;
}
export function oid(value:unknown):string{
 if(typeof value!=='string'||!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(value))fail('REVIEW_INPUT_INVALID','Expected an exact Git object identity');return value;
}
export function text(value:unknown,max=2048):string{
 if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0'))fail('REVIEW_INPUT_INVALID','Expected bounded text');return value;
}
export function decimal(value:unknown):string{
 if(typeof value!=='string'||!(/^[1-9][0-9]{0,18}$/).test(value)||BigInt(value)>9223372036854775807n)
  fail('REVIEW_INPUT_INVALID','Expected a positive bigint decimal string');return value;
}
export function scope(value:Record<string,unknown>):ReviewScope{
 return {organisation_id:uuid(value.organisation_id),run_id:uuid(value.run_id)};
}
export function canonical(value:unknown,depth=0):string{
 if(depth>32)fail('REVIEW_INPUT_INVALID','Review value is too deeply nested');
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k],depth+1)).join(',')+'}';
 return fail('REVIEW_INPUT_INVALID','Unsupported canonical review value');
}
export function hash(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}
export function strings(value:unknown,max=128):string[]{
 if(!Array.isArray(value)||value.length>max)fail('REVIEW_INPUT_INVALID','Expected bounded string list');
 const items=value.map(v=>text(v));if(new Set(items).size!==items.length)fail('REVIEW_INPUT_INVALID','Duplicate list identity');return items;
}
export async function primary(db:ReviewDb):Promise<void>{
 const result=await db.query<{recovery:boolean}>('SELECT pg_is_in_recovery() AS recovery');
 if(result.rows[0]?.recovery)fail('REVIEW_PRIMARY_REQUIRED','Review authority requires PostgreSQL primary');
}
export async function transaction<T>(env:Readonly<NodeJS.ProcessEnv>,binding:ReviewScope,
 operation:(db:pg.PoolClient)=>Promise<T>):Promise<T>{
 const client=await getPool(env).connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');await primary(client);
  const run=await client.query<{state:string}>('SELECT state FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[binding.organisation_id,binding.run_id]);
  if(!run.rows.length)fail('REVIEW_SCOPE_INVALID','Run does not exist in this organisation');
  if(['STOPPING','STOPPED','SUCCEEDED','FAILED','CANCELLED'].includes(run.rows[0]!.state))
   fail('REVIEW_RUN_CLOSED','Closed run cannot grant new review authority');
  const result=await operation(client);await client.query('COMMIT');return result;
 }catch(error){try{await client.query('ROLLBACK');}catch{/* Unknown outcome must be reconciled by stable request identity. */}throw reviewError(error);}
 finally{client.release();}
}
export function reviewError(error:unknown):FoundationError{
 if(error instanceof FoundationError)return error;
 const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';
 if(code==='42P01')return new FoundationError('REVIEW_SCHEMA_MISSING','Review migration has not been applied');
 return databaseError(error);
}
interface Watcher {watcher_id:string;reviewer_session_id:string;rubric_digest:string;review_class:string;path_prefixes:string[]}
interface WatcherPolicy {revision:string;mode:'ALL_COMMITS'|'SPECIALIST';watchers:Watcher[]}
function policy(value:unknown):WatcherPolicy{
 const input=obj(value,['revision','mode','watchers']);
 const revision=decimal(input.revision);
 if(input.mode!=='ALL_COMMITS'&&input.mode!=='SPECIALIST')fail('REVIEW_POLICY_INVALID','Unknown watcher policy mode');
 if(!Array.isArray(input.watchers)||input.watchers.length<10||input.watchers.length>15)
  fail('REVIEW_POLICY_INVALID','An approved watcher policy needs ten to fifteen distinct watchers');
 const watchers=input.watchers.map(item=>{
  const v=obj(item,['watcher_id','reviewer_session_id','rubric_digest','review_class','path_prefixes']);
  const watcher_id=text(v.watcher_id,128);
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(watcher_id))fail('REVIEW_POLICY_INVALID','Invalid logical watcher identity');
  const prefixes=strings(v.path_prefixes,128);
  if(prefixes.some(prefix=>path.posix.isAbsolute(prefix)||prefix.split('/').includes('..')||prefix.includes('\\')))
   fail('REVIEW_POLICY_INVALID','Specialist prefixes must be repository-relative');
  if(input.mode==='ALL_COMMITS'&&prefixes.length)fail('REVIEW_POLICY_INVALID','Default policy cannot shard commit watchers');
  if(input.mode==='SPECIALIST'&&!prefixes.length)fail('REVIEW_POLICY_INVALID','Specialist watcher needs explicit path prefixes');
  return {watcher_id,reviewer_session_id:uuid(v.reviewer_session_id),rubric_digest:digest(v.rubric_digest),
          review_class:text(v.review_class,128),path_prefixes:prefixes};
 });
 if(new Set(watchers.map(w=>w.watcher_id)).size!==watchers.length||
    new Set(watchers.map(w=>w.reviewer_session_id)).size!==watchers.length)
  fail('REVIEW_POLICY_INVALID','Watchers require independent logical and session identities');
 return {revision,mode:input.mode,watchers};
}
export async function configureReviewPolicy(context:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','policy']);const binding=scope(v),definition=policy(v.policy);
 const policyDigest=hash({schema_version:1,...binding,policy:definition});
 if(definition.mode==='SPECIALIST'){
  let approved:unknown;try{approved=JSON.parse(context.env.HYPERFIDE_REVIEW_APPROVED_POLICY_DIGESTS??'[]');}catch{fail('REVIEW_CONFIG_INVALID','Invalid trusted review approvals');}
  if(!Array.isArray(approved)||!approved.includes(policyDigest))
   fail('REVIEW_SHARDING_APPROVAL_REQUIRED','Specialist sharding requires this exact trusted approved policy digest');
 }
 return transaction(context.env,binding,async db=>{
  const current=await db.query<{digest:string;revision:string}>('SELECT digest,revision FROM hyperfide.review_policies WHERE organisation_id=$1 AND run_id=$2 AND active',[binding.organisation_id,binding.run_id]);
  if(current.rows[0]?.digest===policyDigest)return {policy_digest:policyDigest,replayed:true,watchers:definition.watchers.length,mode:definition.mode};
  if(current.rows[0]&&BigInt(definition.revision)<=BigInt(current.rows[0].revision))
   fail('REVIEW_POLICY_CONFLICT','New watcher policy must advance its revision');
  const sessions=await db.query<{id:string;role:string;state:string}>('SELECT id,role,state FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[])',[binding.organisation_id,binding.run_id,definition.watchers.map(w=>w.reviewer_session_id)]);
  if(sessions.rows.length!==definition.watchers.length||sessions.rows.some(s=>s.role!=='COMMIT_WATCHER'||['STOPPED','FAILED'].includes(s.state)))
   fail('REVIEW_WATCHER_INVALID','Every watcher must name a live scoped commit-watcher session');
  await db.query('UPDATE hyperfide.review_policies SET active=false WHERE organisation_id=$1 AND run_id=$2 AND active',[binding.organisation_id,binding.run_id]);
  await db.query('INSERT INTO hyperfide.review_policies(organisation_id,run_id,digest,revision,definition) VALUES($1,$2,$3,$4,$5)',[binding.organisation_id,binding.run_id,policyDigest,definition.revision,definition]);
  await db.query(`INSERT INTO hyperfide.review_watchers(organisation_id,run_id,policy_digest,watcher_id,reviewer_session_id,rubric_digest,review_class,path_prefixes)
   SELECT $1,$2,$3,w.watcher_id,w.reviewer_session_id::uuid,w.rubric_digest,w.review_class,w.path_prefixes
   FROM jsonb_to_recordset($4::jsonb) AS w(watcher_id text,reviewer_session_id text,rubric_digest text,review_class text,path_prefixes jsonb)`,
   [binding.organisation_id,binding.run_id,policyDigest,JSON.stringify(definition.watchers)]);
  return {policy_digest:policyDigest,replayed:false,watchers:definition.watchers.length,mode:definition.mode};
 });
}
interface RepositoryConfig {path:string;refs:string[]}
async function repositoryConfig(env:Readonly<NodeJS.ProcessEnv>,repositoryId:string):Promise<RepositoryConfig>{
 let all:Record<string,unknown>;
 try{
  const parsed:unknown=JSON.parse(env.HYPERFIDE_REVIEW_REPOSITORIES??'{}');
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();
  all=parsed as Record<string,unknown>;
  for(const key of Object.keys(all))uuid(key);
 }catch{fail('REVIEW_CONFIG_INVALID','Trusted review repository configuration is missing or invalid');}
 const entry=all![repositoryId];if(!entry)fail('REVIEW_REPOSITORY_UNAVAILABLE','Repository has no trusted local Git checkout');
 const v=obj(entry,['path','refs']);const directory=await fs.realpath(text(v.path,4096));const refs=strings(v.refs,32);
 if(!refs.length||refs.some(ref=>!/^refs\/(heads|remotes)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(ref)||ref.includes('..')))
  fail('REVIEW_CONFIG_INVALID','Discovery needs explicit trusted branch refs');
 const allowed=env.HYPERFIDE_REVIEW_ALLOWED_ROOT;
 if(!allowed)fail('REVIEW_CONFIG_INVALID','Trusted review checkout root is required');
 const root=await fs.realpath(allowed);if(directory!==root&&!directory.startsWith(root+path.sep))
  fail('REVIEW_REPOSITORY_UNAVAILABLE','Review checkout escapes its trusted root');
 return {path:directory,refs};
}
async function git(repository:string,args:string[],acceptable:number[]=[0]):Promise<string>{
 try{
  const result=await execute('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.pager=cat',...args],
   {cwd:repository,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'},
    timeout:30000,maxBuffer:8*1024*1024,encoding:'utf8'});
  if(result.stdout.includes('\ufffd'))fail('REVIEW_GIT_ENCODING_UNSUPPORTED','Git metadata contains unsupported byte encoding');
  return result.stdout;
 }catch(error){
  if(error instanceof FoundationError)throw error;
  const code=error&&typeof error==='object'&&'code'in error?Number(error.code):NaN;
  if(acceptable.includes(code))return '';
  return fail('REVIEW_GIT_FAILED','Pinned local Git discovery failed; no completeness claim was made');
 }
}
async function heads(config:RepositoryConfig):Promise<Record<string,string>>{
 const result:Record<string,string>={};
 for(const ref of config.refs)result[ref]=oid((await git(config.path,['rev-parse','--verify',ref+'^{commit}'])).trim());
 return result;
}
interface Commit {source_object_id:string;tree_object_id:string;parent_objects:string[];changed_paths:string[];attribution:Record<string,unknown>}
export async function discoverReviewCommits(context:ComponentContext,value:unknown):Promise<unknown>{
 const v=obj(value,['organisation_id','run_id','repository_id','batch_size'],['batch_size']);
 const binding=scope(v),repositoryId=uuid(v.repository_id),batch=v.batch_size??64;
 if(typeof batch!=='number'||!Number.isSafeInteger(batch)||batch<1||batch>256)fail('REVIEW_INPUT_INVALID','Discovery batch must be one to 256 commits');
 const config=await repositoryConfig(context.env,repositoryId);
 const snapshot=await heads(config);
 const initial=await getPool(context.env).query<{source_object_id:string}>('SELECT source_object_id FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3',[binding.organisation_id,binding.run_id,repositoryId]);
 if(initial.rows.length!==1)fail('REVIEW_SCOPE_INVALID','Repository is not part of this run');
 const base=oid(initial.rows[0]!.source_object_id);
 await git(config.path,['cat-file','-e',base+'^{commit}']);
 const reachable=(await git(config.path,['rev-list','--reverse','--topo-order','--max-count=100001',...Object.values(snapshot),'--not',base])).trim().split('\n').filter(Boolean).map(oid);
 if(reachable.length>100000)fail('REVIEW_DISCOVERY_LIMIT','History exceeds the explicit discovery bound; narrow the approved branch/base range');
 const existing=await getPool(context.env).query<{source_object_id:string}>('SELECT source_object_id FROM hyperfide.review_commits WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 AND source_object_id=ANY($4::text[])',[binding.organisation_id,binding.run_id,repositoryId,reachable]);
 const known=new Set(existing.rows.map(row=>row.source_object_id));
 const selected=reachable.filter(commit=>!known.has(commit)).slice(0,Number(batch));
 const tasks=await getPool(context.env).query<{task_key:string}>('SELECT task_key FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2',[binding.organisation_id,binding.run_id]);
 const taskKeys=new Set(tasks.rows.map(task=>task.task_key));
 const commits:Commit[]=[];
 for(const commit of selected){
  const metadata=(await git(config.path,['show','-s','--format=%T%n%P%n%B',commit])).split('\n');
  const tree=oid(metadata.shift()!);const parents=metadata.shift()!.split(' ').filter(Boolean).map(oid);
  const paths=[...new Set((await git(config.path,['diff-tree','-m','--root','--no-commit-id','--name-only','--no-ext-diff','--no-textconv','-r','-z',commit])).split('\0').filter(Boolean))].sort();
  if(paths.length>20000||paths.some(p=>p.length>4096))fail('REVIEW_DISCOVERY_LIMIT','Commit change inventory exceeds its explicit bound');
  const tags=[...metadata.join('\n').matchAll(/\[spec:([^\]\s/]+)\/([^\]\s]+)\]/g)].map(match=>({feature:match[1]!,task:match[2]!}));
  const unknown=tags.filter(tag=>!taskKeys.has(tag.task));
  commits.push({source_object_id:commit,tree_object_id:tree,parent_objects:parents,changed_paths:paths,
    attribution:{state:!tags.length?'UNATTRIBUTED':unknown.length?'UNKNOWN_TASK':'ATTRIBUTED',spec_tags:tags}});
 }
 const latest=await getPool(context.env).query<{refs:Record<string,string>}>('SELECT refs FROM hyperfide.review_head_observations WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 ORDER BY observed_at DESC LIMIT 1',[binding.organisation_id,binding.run_id,repositoryId]);
 const rewrites:Array<{ref:string;previous:string;current:string}>=[];
 for(const [ref,prior]of Object.entries(latest.rows[0]?.refs??{})){
  if(snapshot[ref]&&snapshot[ref]!==prior){
   try{
    await execute('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','merge-base','--is-ancestor',prior,snapshot[ref]!],
     {cwd:config.path,timeout:10000,maxBuffer:1024*1024});
   }catch(error){
    const code=error&&typeof error==='object'&&'code'in error?Number(error.code):NaN;
    if(code!==1)fail('REVIEW_GIT_HISTORY_UNAVAILABLE','Prior observed history is unavailable; rewrite completeness is uncertain');
    rewrites.push({ref,previous:prior,current:snapshot[ref]});
   }
  }
 }
 const changed=canonical(await heads(config))!==canonical(snapshot);
 const observationDigest=hash({repository_id:repositoryId,base,refs:snapshot});
 return transaction(context.env,binding,async db=>{
  const active=await db.query<{digest:string;definition:WatcherPolicy}>('SELECT digest,definition FROM hyperfide.review_policies WHERE organisation_id=$1 AND run_id=$2 AND active',[binding.organisation_id,binding.run_id]);
  if(active.rows.length!==1)fail('REVIEW_POLICY_MISSING','Configure an approved watcher policy before discovery');
  const watcherPolicy=active.rows[0]!;
  if(watcherPolicy.definition.mode==='SPECIALIST'&&commits.some(commit=>!watcherPolicy.definition.watchers.some(w=>commit.changed_paths.some(p=>w.path_prefixes.some(prefix=>p.startsWith(prefix))))))
   fail('REVIEW_SHARDING_GAP','Specialist policy leaves at least one commit with no accountable watcher');
  for(const commit of commits){
   await db.query("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,'commit') ON CONFLICT DO NOTHING",[binding.organisation_id,repositoryId,commit.source_object_id]);
  }
  if(commits.length)await db.query(`INSERT INTO hyperfide.review_commits(organisation_id,run_id,repository_id,source_object_id,tree_object_id,parent_objects,changed_paths,attribution)
   SELECT $1,$2,$3,c.source_object_id,c.tree_object_id,c.parent_objects,c.changed_paths,c.attribution
   FROM jsonb_to_recordset($4::jsonb) AS c(source_object_id text,tree_object_id text,parent_objects jsonb,changed_paths jsonb,attribution jsonb) ON CONFLICT DO NOTHING`,
   [binding.organisation_id,binding.run_id,repositoryId,JSON.stringify(commits)]);
  const obligations=await db.query(`INSERT INTO hyperfide.review_obligations(organisation_id,run_id,repository_id,source_object_id,policy_digest,watcher_id)
   SELECT c.organisation_id,c.run_id,c.repository_id,c.source_object_id,w.policy_digest,w.watcher_id
   FROM hyperfide.review_commits c JOIN hyperfide.review_watchers w ON w.organisation_id=c.organisation_id AND w.run_id=c.run_id
   WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.repository_id=$3 AND w.policy_digest=$4
   AND ( $5='ALL_COMMITS' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.changed_paths)p, jsonb_array_elements_text(w.path_prefixes)x WHERE starts_with(p.value,x.value)))
   ON CONFLICT DO NOTHING RETURNING id`,[binding.organisation_id,binding.run_id,repositoryId,watcherPolicy.digest,watcherPolicy.definition.mode]);
  const undiscovered=reachable.filter(commit=>!known.has(commit)).length-commits.length;
  const complete=undiscovered===0&&!changed;
  await db.query(`INSERT INTO hyperfide.review_head_observations(organisation_id,run_id,repository_id,digest,refs,base_object_id,rewrites,complete)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organisation_id,run_id,repository_id,digest)
   DO UPDATE SET complete=excluded.complete,rewrites=excluded.rewrites`,[binding.organisation_id,binding.run_id,repositoryId,observationDigest,snapshot,base,JSON.stringify(rewrites),complete]);
  return {observation_digest:observationDigest,policy_digest:watcherPolicy.digest,discovered:commits.length,
    obligations_created:obligations.rowCount,remaining:undiscovered,complete,heads_changed:changed,rewrites,
    unattributed:commits.filter(c=>c.attribution.state!=='ATTRIBUTED').map(c=>c.source_object_id),
    coverage_status:'INCOMPLETE',qualification:'UNRUN'};
 });
}
export interface ReviewCoverageSummary {
 status:'COMPLETE'|'INCOMPLETE'|'STALE';policy_digest:string;repository_id:string;source_object_id:string;
 required:number;complete:number;missing:Array<Record<string,unknown>>;receipt_ids:string[];limitations:string[];
 authority:'POSTGRESQL_REVIEW_OBLIGATIONS';
}
export async function inspectReviewCoverage(db:ReviewDb,binding:ReviewScope,query:ReviewCoverageQuery):Promise<ReviewCoverageSummary>{
 await primary(db);
 const policyResult=await db.query<{digest:string;active:boolean}>('SELECT digest,active FROM hyperfide.review_policies WHERE organisation_id=$1 AND run_id=$2 AND '+(query.policy_digest?'digest=$3':'active'),query.policy_digest?[binding.organisation_id,binding.run_id,query.policy_digest]:[binding.organisation_id,binding.run_id]);
 if(policyResult.rows.length!==1)fail('REVIEW_POLICY_MISSING','Review policy is unavailable');
 const policyDigest=policyResult.rows[0]!.digest;
 const rows=await db.query<{id:string|null;watcher_id:string;reviewer_session_id:string;rubric_digest:string;generation:string|null;state:string|null;input_manifest_digest:string|null;candidate_digest:string|null;receipt_id:string|null;outcome:string|null;limitations:string[]|null;evidence_current:boolean;discovered:boolean;spec_current:boolean}>(`
 SELECT o.id,w.watcher_id,w.reviewer_session_id,w.rubric_digest,o.generation,o.state,o.input_manifest_digest,o.candidate_digest,
 receipt.id AS receipt_id,receipt.outcome,receipt.limitations,(commit.source_object_id IS NOT NULL) AS discovered,
 (inputs.snapshot->>'spec_revision_id'=current_run.spec_revision_id::text) AS spec_current,
 (EXISTS(SELECT 1 FROM hyperfide.review_receipt_evidence x WHERE x.organisation_id=receipt.organisation_id AND x.run_id=receipt.run_id AND x.receipt_id=receipt.id)
 AND NOT EXISTS(SELECT 1 FROM hyperfide.review_receipt_evidence x JOIN hyperfide.evidence e ON e.organisation_id=x.organisation_id AND e.run_id=x.run_id AND e.id=x.evidence_id
 WHERE x.organisation_id=receipt.organisation_id AND x.run_id=receipt.run_id AND x.receipt_id=receipt.id AND e.admission_state<>'ADMITTED')) AS evidence_current
 FROM hyperfide.review_watchers w
 JOIN hyperfide.review_policies policy ON policy.organisation_id=w.organisation_id AND policy.run_id=w.run_id AND policy.digest=w.policy_digest
 JOIN hyperfide.runs current_run ON current_run.organisation_id=w.organisation_id AND current_run.id=w.run_id
 LEFT JOIN hyperfide.review_commits commit ON commit.organisation_id=w.organisation_id AND commit.run_id=w.run_id AND commit.repository_id=$3 AND commit.source_object_id=$4
 LEFT JOIN hyperfide.review_obligations o ON o.organisation_id=w.organisation_id AND o.run_id=w.run_id AND o.policy_digest=w.policy_digest AND o.watcher_id=w.watcher_id AND o.repository_id=$3 AND o.source_object_id=$4
 LEFT JOIN hyperfide.review_obligation_inputs inputs ON inputs.organisation_id=o.organisation_id AND inputs.run_id=o.run_id AND inputs.obligation_id=o.id AND inputs.generation=o.generation
 LEFT JOIN hyperfide.review_receipts receipt ON receipt.organisation_id=o.organisation_id AND receipt.run_id=o.run_id AND receipt.id=o.current_receipt_id AND receipt.generation=o.generation AND receipt.obligation_id=o.id
 WHERE w.organisation_id=$1 AND w.run_id=$2 AND w.policy_digest=$5
 AND(policy.definition->>'mode'='ALL_COMMITS' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(commit.changed_paths)p,jsonb_array_elements_text(w.path_prefixes)x WHERE starts_with(p.value,x.value)))
 ORDER BY w.watcher_id`,
 [binding.organisation_id,binding.run_id,query.repository_id,query.source_object_id,policyDigest]);
 const missing=[],receipts:string[]=[],limitations:string[]=[];let stale=!policyResult.rows[0]!.active;
 for(const row of rows.rows){
  let reason='';
  if(!row.discovered)reason='COMMIT_NOT_DISCOVERED';
  else if(!row.id)reason='OBLIGATION_MISSING';
  else if(!query.candidate_digest||!query.input_manifest_digest)reason='EXACT_CANDIDATE_INPUTS_REQUIRED';
  else if(!row.input_manifest_digest)reason='REVIEW_INPUTS_UNBOUND';
  else if(!row.spec_current||row.candidate_digest!==query.candidate_digest||row.input_manifest_digest!==query.input_manifest_digest){reason='INPUTS_STALE';stale=true;}
  else if(row.state!=='COMPLETE'||!row.receipt_id)reason='RECEIPT_MISSING';
  else if(row.outcome==='INCONCLUSIVE'||!row.evidence_current)reason='EVIDENCE_INCOMPLETE';
  else if(row.limitations?.length)reason='REVIEW_LIMITED';
  if(reason)missing.push({watcher_id:row.watcher_id,reviewer_session_id:row.reviewer_session_id,rubric_digest:row.rubric_digest,obligation_id:row.id,generation:row.generation,reason});
  else receipts.push(row.receipt_id!);
  limitations.push(...(row.limitations??[]));
 }
 if(!rows.rows.length)missing.push({watcher_id:'*',reason:'COMMIT_NOT_DISCOVERED'});
 return {status:stale?'STALE':missing.length?'INCOMPLETE':'COMPLETE',policy_digest:policyDigest,
  repository_id:query.repository_id,source_object_id:query.source_object_id,required:rows.rows.length,complete:receipts.length,
  missing,receipt_ids:receipts,limitations:[...new Set(limitations)],authority:'POSTGRESQL_REVIEW_OBLIGATIONS'};
}
export function createComponent(context:ComponentContext):Component{
 const guarded=(fn:(input:unknown)=>Promise<unknown>)=>async(input:unknown)=>{try{return await fn(input);}catch(error){throw reviewError(error);}};
 return {apiVersion:1,actions:{
  'review.policy.configure':guarded(input=>configureReviewPolicy(context,input)),
  'review.commits.discover':guarded(input=>discoverReviewCommits(context,input)),
  'review.coverage.inspect':guarded(async input=>{
   const v=obj(input,['organisation_id','run_id','repository_id','source_object_id','candidate_digest','input_manifest_digest','policy_digest'],['candidate_digest','input_manifest_digest','policy_digest']);
   return inspectReviewCoverage(getPool(context.env),scope(v),{repository_id:uuid(v.repository_id),source_object_id:oid(v.source_object_id),
    ...(v.candidate_digest?{candidate_digest:digest(v.candidate_digest)}:{}),
    ...(v.input_manifest_digest?{input_manifest_digest:digest(v.input_manifest_digest)}:{}),
    ...(v.policy_digest?{policy_digest:digest(v.policy_digest)}:{})});
  })
 }};
}
