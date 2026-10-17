import {lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';

export interface Session {query<R extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values?:readonly unknown[]):Promise<pg.QueryResult<R>>}
export interface Principal {organisation_id:string;run_id:string;actor_id:string;credential_id:string;role:string;attempt_id?:string;attempt_generation?:string;sandbox_id?:string;boot_generation?:string}
interface Invocation {principal:Principal;payload:{action:string;run_id:string};signal:AbortSignal;guard(tx:unknown):Promise<void>}
interface Runtime {
 gateway:{withPrimaryTransaction<T>(options:{timeoutMs:number;maxRetries:number;signal:AbortSignal;guard:(tx:Session)=>Promise<void>},operation:(tx:Session)=>Promise<T>):Promise<T>};
}
interface RequestContext {invocation?:Invocation;resources?:Runtime}
export const MIGRATION='services/hyperfide/migrations/0023-observability.sql';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DIGEST=/^sha256:[0-9a-f]{64}$/;
export function fail(code:string,message:string):never {throw new FoundationError(code,message);}
export function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('OBSERVABILITY_INPUT_INVALID','Unknown or malformed observability fields');
 return value as Record<string,unknown>;
}
export function text(value:unknown,max=255):string{
 if(typeof value!=='string'||value.length<1||value.length>max||/[\x00-\x1f\x7f]/.test(value))fail('OBSERVABILITY_INPUT_INVALID','A bounded plain string is required');return value;
}
export function uuid(value:unknown):string {const s=text(value,36);if(!UUID.test(s))fail('OBSERVABILITY_INPUT_INVALID','Canonical UUID required');return s;}
export function digest(value:unknown):string {const s=text(value,71);if(!DIGEST.test(s))fail('OBSERVABILITY_INPUT_INVALID','SHA256 identity required');return s;}
export function integer(value:unknown,min=0,max=1000):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail('OBSERVABILITY_INPUT_INVALID','Bounded integer required');return value;}
export function generation(value:unknown,zero=false):string {const s=text(value,19);if(!/^(0|[1-9][0-9]*)$/.test(s)||BigInt(s)>(2n**63n-1n)||(!zero&&s==='0'))fail('OBSERVABILITY_INPUT_INVALID','Canonical bigint decimal string required');return s;}
export function timestamp(value:unknown):string {const s=text(value,32);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,19)!==s.slice(0,19))fail('OBSERVABILITY_INPUT_INVALID','Valid UTC timestamp required');return new Date(s).toISOString();}
export function hash(value:unknown):string {return 'sha256:'+createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function principal(context:ComponentContext,operation:string):Principal{
 const invocation=(context as unknown as RequestContext).invocation,p=invocation?.principal;
 if(!invocation||typeof invocation.guard!=='function'||invocation.payload?.action!==operation||invocation.payload?.run_id!==p?.run_id||!p||!UUID.test(p.organisation_id)||!UUID.test(p.run_id)||!UUID.test(p.actor_id))fail('AUTHENTICATION_REQUIRED','Authenticated run-scoped invocation required');
 return Object.freeze({...p});
}
export async function authority<T>(context:ComponentContext,operation:string,fn:(tx:Session,scope:Principal)=>Promise<T>):Promise<T>{
 const p=principal(context,operation),c=context as unknown as RequestContext,invocation=c.invocation!;
 if(!c.resources?.gateway?.withPrimaryTransaction)fail('OBSERVABILITY_DEPENDENCY_UNAVAILABLE','Shared primary transaction gateway is required');
 return c.resources.gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:invocation.signal??context.signal,guard:tx=>invocation.guard(tx)},tx=>fn(tx,p));
}
export async function requireArtifact(tx:Session,p:Principal,id:string):Promise<void>{
 const q=await tx.query('SELECT id FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND status=$4 FOR SHARE',[p.organisation_id,p.run_id,id,'COMPLETE']);
 if(q.rows.length!==1)fail('OBSERVABILITY_EVIDENCE_UNAVAILABLE','Complete artifact in the authenticated run required');
}
export async function lockRun(tx:Session,p:Principal,namespace='general'):Promise<void>{
 await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['observability:'+namespace+':'+p.organisation_id+':'+p.run_id]);
 const r=await tx.query('SELECT id FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[p.organisation_id,p.run_id]);
 if(!r.rows.length)fail('OBSERVABILITY_SCOPE_INVALID','Authenticated run is unavailable');
}
export function numbers(value:unknown):unknown{
 if(value instanceof Date)return value.toISOString();
 if(Array.isArray(value))return value.map(numbers);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,numbers(v)]));
 return value;
}
export interface IntegratedProof {current_task_ids:string[];status:'CURRENT'|'HELD';count:string|null;proof_level:'TASK_CURRENT_INTEGRATED';proof_digest:string|null;as_of:string;programme_outcome:'PASS'|'HELD';reasons:string[]}
export async function integratedProof(tx:Session,p:Principal):Promise<IntegratedProof>{
 const unavailable=(reason:string):IntegratedProof=>({status:'HELD',count:null,current_task_ids:[],proof_level:'TASK_CURRENT_INTEGRATED',proof_digest:null,as_of:new Date().toISOString(),programme_outcome:'HELD',reasons:[reason]});
 const location=new URL('../integration/closure.js',import.meta.url);
 try{await lstat(location);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return unavailable('INTEGRATION_PROOF_INSPECTOR_NOT_INSTALLED');throw e;}
 const module=await import(location.href) as {qualifiedIntegratedOutcomes?:unknown};
 if(typeof module.qualifiedIntegratedOutcomes!=='function')return unavailable('INTEGRATION_PROOF_INTERFACE_UNAVAILABLE');
 const value=await (module.qualifiedIntegratedOutcomes as (tx:Session,scope:{organisation_id:string;run_id:string})=>Promise<unknown>)(tx,{organisation_id:p.organisation_id,run_id:p.run_id});
 if(!value||typeof value!=='object')fail('OBSERVABILITY_DATA_INVALID','Invalid integrated proof inspector result');
 const r=value as IntegratedProof;
 if(!Array.isArray(r.current_task_ids)||r.current_task_ids.length>10000||r.current_task_ids.some(id=>typeof id!=='string'||!UUID.test(id))||new Set(r.current_task_ids).size!==r.current_task_ids.length||(r.status==='CURRENT'&&r.count!==String(r.current_task_ids.length))||(r.status==='HELD'&&r.current_task_ids.length!==0)||!['CURRENT','HELD'].includes(r.status)||r.proof_level!=='TASK_CURRENT_INTEGRATED'||!['PASS','HELD'].includes(r.programme_outcome)||!Array.isArray(r.reasons)||r.reasons.length>1000||r.reasons.some(x=>typeof x!=='string'||x.length>1024)||!Number.isFinite(Date.parse(r.as_of))||(r.status==='CURRENT'&&(!/^(0|[1-9][0-9]{0,18})$/.test(r.count??'')||!DIGEST.test(r.proof_digest??'')))||(r.status==='HELD'&&r.count!==null))fail('OBSERVABILITY_DATA_INVALID','Integrated proof inspector contract changed');
 return r;
}
interface TaskNode {id:string;task_key:string;state:string}
interface Dependency {task_id:string;predecessor_task_id:string;predecessor_run_id:string;milestone:string;predecessor_state:string|null}
export function criticalPath(tasks:TaskNode[],dependencies:Dependency[],runId:string,currentTaskIds:readonly string[]=[],proofStatus='HELD'):unknown {
 const terminal=new Set(currentTaskIds),nodes=new Map(tasks.filter(t=>!terminal.has(t.id)).map(t=>[t.id,t]));
 const incoming=new Map<string,number>(),children=new Map<string,string[]>(),distance=new Map<string,number>(),parent=new Map<string,string>();
 for(const id of nodes.keys()){incoming.set(id,0);children.set(id,[]);distance.set(id,1);}
 const external:Dependency[]=[];
 for(const d of dependencies){if(!nodes.has(d.task_id))continue;if(d.predecessor_run_id!==runId){external.push(d);continue;}if(!nodes.has(d.predecessor_task_id))continue;incoming.set(d.task_id,incoming.get(d.task_id)!+1);children.get(d.predecessor_task_id)!.push(d.task_id);}
 const ready=[...nodes.keys()].filter(id=>incoming.get(id)===0).sort();let processed=0;
 while(ready.length){const id=ready.shift()!;processed++;for(const child of children.get(id)!.sort()){const candidate=distance.get(id)!+1;if(candidate>distance.get(child)!){distance.set(child,candidate);parent.set(child,id);}incoming.set(child,incoming.get(child)!-1);if(incoming.get(child)===0)ready.push(child);}}
 if(processed!==nodes.size)return {complete:false,method:'UNWEIGHTED_UNFINISHED_DEPENDENCY_PATH',reason:'CYCLE_OR_INCOMPLETE_GRAPH',path:[],estimated_duration_ms:null,external_dependencies:external};
 const end=[...nodes.keys()].sort((a,b)=>distance.get(b)!-distance.get(a)!||a.localeCompare(b))[0];const path:TaskNode[]=[];for(let id=end;id;id=parent.get(id))path.unshift(nodes.get(id)!);
 return {complete:external.length===0,method:'UNWEIGHTED_UNFINISHED_DEPENDENCY_PATH',terminal_basis:'CURRENT_INTEGRATED_PROOF_ONLY',current_integrated_proof_status:proofStatus,milestone_applicability:'TOPOLOGY_ONLY_USE_SCHEDULER_FOR_CURRENT_DISPATCH_ELIGIBILITY',path,estimated_duration_ms:null,external_dependencies:external,authority:'OBSERVATION_ONLY'};
}
export async function snapshot(tx:Session,p:Principal,input:unknown):Promise<unknown>{
 const v=object(input,['limit','after_task_key','max_observation_age_ms']),limit=v.limit===undefined?100:integer(v.limit,1,500),after=v.after_task_key===undefined?'':text(v.after_task_key);
 const age=v.max_observation_age_ms===undefined?15000:integer(v.max_observation_age_ms,1000,300000);
 const scope=[p.organisation_id,p.run_id];
 const run=await tx.query("SELECT id,project_id,spec_revision_id,spec_generation,state,state_version,authority_epoch,clock_timestamp() AS sampled_at,pg_is_in_recovery() AS in_recovery FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",scope);
 if(run.rows.length!==1)fail('OBSERVABILITY_SCOPE_INVALID','Run is unavailable');
 const sampled=run.rows[0]!,now=new Date(sampled.sampled_at as string|Date).getTime();
 const page=await tx.query('SELECT id,task_key,state,state_version,generation,current_attempt_id,current_custody_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND task_key>$3 ORDER BY task_key LIMIT $4',[...scope,after,limit+1]);
 const taskRows=page.rows.slice(0,limit);
 const nodes=await tx.query<TaskNode>('SELECT id,task_key,state FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 ORDER BY id LIMIT 5001',scope);
 const deps=await tx.query<Dependency>('SELECT d.task_id,d.predecessor_task_id,d.predecessor_run_id,d.milestone,t.state AS predecessor_state FROM hyperfide.task_dependencies d LEFT JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.predecessor_run_id AND t.id=d.predecessor_task_id WHERE d.organisation_id=$1 AND d.run_id=$2 ORDER BY d.task_id,d.predecessor_task_id LIMIT 20001',scope);
 const observations=await tx.query('SELECT entity_type,entity_id,entity_generation,observer_actor_id,observer_priority,producer_sequence,observed_state,observed_at,received_at,source_digest,source_artifact_id,activity_bytes,state_version FROM hyperfide.observability_observations WHERE organisation_id=$1 AND run_id=$2 ORDER BY entity_type,entity_id LIMIT 1001',scope);
 const attempts=await tx.query('SELECT id,task_id,generation,execution_state AS desired_state,compute_authority,sandbox_id,sandbox_boot_generation,slot_id,lease_expires_at,state_version FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 ORDER BY created_at DESC,id LIMIT $3',[...scope,limit]);
 const sessions=await tx.query('SELECT id,role,attempt_id,sandbox_id,sandbox_boot_generation,state AS desired_state,state_version FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 ORDER BY id LIMIT $3',[...scope,limit]);
 const sandboxes=await tx.query('SELECT DISTINCT s.id,s.provider,s.pool_id,s.boot_generation,s.desired_state,s.observed_state,s.state_version FROM hyperfide.sandboxes s JOIN hyperfide.attempts a ON a.organisation_id=s.organisation_id AND a.sandbox_id=s.id WHERE a.organisation_id=$1 AND a.run_id=$2 ORDER BY s.id LIMIT $3',[...scope,limit]);
 const backlog=await tx.query("SELECT (SELECT count(*) FROM hyperfide.qualification_jobs WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','RUNNING')) AS qualification_jobs,(SELECT count(*) FROM hyperfide.review_coverage WHERE organisation_id=$1 AND run_id=$2 AND state<>'COMPLETE') AS reviews,(SELECT count(*) FROM hyperfide.integration_candidates WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','VERIFYING','READY')) AS integration_candidates,(SELECT count(*) FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND state='OUTCOME_UNKNOWN') AS unknown_publications,(SELECT count(*) FROM hyperfide.event_deliveries WHERE organisation_id=$1 AND run_id=$2 AND state<>'ACKNOWLEDGED') AS event_deliveries",scope);
 const extensions=await tx.query("SELECT to_regclass('hyperfide.assurance_applicability')::text AS assurance,to_regclass('hyperfide.resource_waiters')::text AS scheduler,to_regclass('hyperfide.recovery_resource_debts')::text AS recovery");
 let evidence:unknown={status:'UNKNOWN',reason:'ASSURANCE_AUTHORITY_NOT_INSTALLED'},queues:unknown={status:'UNKNOWN',reason:'SCHEDULER_NOT_INSTALLED'},recovery:unknown={status:'UNKNOWN',reason:'RECOVERY_NOT_INSTALLED'};
 if(extensions.rows[0]?.assurance){const q=await tx.query("SELECT c.id AS custody_id,c.task_id,c.authority,c.qualification_outcome,a.applicability,a.current_receipt_digest,a.reasons FROM hyperfide.submission_custodies c LEFT JOIN hyperfide.assurance_applicability a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.custody_id=c.id WHERE c.organisation_id=$1 AND c.run_id=$2 ORDER BY c.id LIMIT $3",[...scope,limit]);evidence={status:'AVAILABLE',rows:q.rows};}
 if(extensions.rows[0]?.scheduler){const q=await tx.query("SELECT wait_reason,state,count(*) AS count FROM hyperfide.resource_waiters WHERE organisation_id=$1 AND run_id=$2 GROUP BY wait_reason,state ORDER BY wait_reason,state",scope);queues={status:'AVAILABLE',rows:q.rows};}
 if(extensions.rows[0]?.recovery){const q=await tx.query("SELECT status,count(*) AS count FROM hyperfide.recovery_resource_debts WHERE organisation_id=$1 AND run_id=$2 GROUP BY status ORDER BY status",scope);recovery={status:'AVAILABLE',rows:q.rows};}
 const integrated=await integratedProof(tx,p);
 const graph=await tx.query("SELECT c.name,c.publication_generation,m.id AS manifest_id,m.manifest_digest,m.source_manifest_digest,m.published_at FROM hyperfide.graph_channels c JOIN hyperfide.graph_manifests m ON m.organisation_id=c.organisation_id AND m.run_id=c.run_id AND m.id=c.manifest_id WHERE c.organisation_id=$1 AND c.run_id=$2 ORDER BY c.name LIMIT 100",scope);
 return numbers({schema_version:1,scope:{organisation_id:p.organisation_id,run_id:p.run_id},run:sampled,freshness:{route:'PRIMARY',sampled_at:sampled.sampled_at,replica_lag_ms:null,replica_lag_status:'NOT_APPLICABLE',replica_routing:'UNSUPPORTED',snapshot:'ONE_SERIALIZABLE_PRIMARY_TRANSACTION'},tasks:taskRows,pagination:{limit,next:page.rows.length>limit?taskRows.at(-1)?.task_key:null},attempts:attempts.rows,sessions:sessions.rows,sandboxes:sandboxes.rows,observations:observations.rows.slice(0,1000).map(o=>({...o,age_ms:Math.max(0,now-new Date(o.observed_at as string|Date).getTime()),freshness:now-new Date(o.observed_at as string|Date).getTime()>age?'STALE':'CURRENT',activity_is_qualified_progress:false})),backlog:backlog.rows[0],evidence,queues,recovery,graphs:{rows:graph.rows.map(g=>({...g,publication_age_ms:Math.max(0,now-new Date(g.published_at as string|Date).getTime()),source_to_graph_latency_ms:null,source_freshness:'UNKNOWN_UNTIL_SOURCE_SET_COMPARISON'}))},critical_path:nodes.rows.length>5000||deps.rows.length>20000?{complete:false,reason:'GRAPH_BUDGET_EXCEEDED',path:[]}:criticalPath(nodes.rows,deps.rows,p.run_id,integrated.current_task_ids,integrated.status),progress:{basis:'DURABLE_MILESTONES_AND_CURRENT_EVIDENCE',live_pid_is_progress:false,log_volume_is_progress:false,live_activity:{running_sessions:sessions.rows.filter(r=>r.desired_state==='RUNNING').length,running_attempts:attempts.rows.filter(r=>r.desired_state==='RUNNING').length,counted_as_progress:false},integrated_outcome_count:integrated.count,integrated_outcome_proof:integrated},truncation:{observations:observations.rows.length>1000,task_page:page.rows.length>limit}});
}

export function requireCollector(p:Principal,subjectId?:string):void{
 if(['OPERATOR','COORDINATOR','LEADER','PROVISIONER','DISPATCH'].includes(p.role))return;
 if(p.role==='RUNNER'&&p.sandbox_id&&subjectId===p.sandbox_id)return;
 fail('OBSERVABILITY_PRODUCER_FORBIDDEN','A trusted collector role and its assigned resource scope are required');
}
async function observationPriority(tx:Session,p:Principal,type:string,id:string,row:Record<string,unknown>):Promise<number>{
 if(['OPERATOR','COORDINATOR','LEADER','PROVISIONER'].includes(p.role))return 4;
 if(p.role==='RUNNER'&&p.sandbox_id===row.sandbox_id&&p.boot_generation===String(row.boot_generation))return 3;
 if(p.role==='FEATURE_MANAGER'){
  if(type==='SESSION'&&(id===p.actor_id||row.parent_session_id===p.actor_id))return 2;
  const query=type==='ATTEMPT'?'SELECT t.id FROM hyperfide.tasks t JOIN hyperfide.feature_packages f ON f.organisation_id=t.organisation_id AND f.run_id=t.run_id AND f.id=t.feature_package_id WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.id=$3 AND f.manager_session_id=$4':'SELECT a.id FROM hyperfide.attempts a JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id JOIN hyperfide.feature_packages f ON f.organisation_id=t.organisation_id AND f.run_id=t.run_id AND f.id=t.feature_package_id WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.sandbox_id=$3 AND f.manager_session_id=$4 LIMIT 1';
  if(type==='ATTEMPT'||type==='SANDBOX'){const q=await tx.query(query,[p.organisation_id,p.run_id,type==='ATTEMPT'?row.task_id:id,p.actor_id]);if(q.rows.length)return 2;}
 }
 if(type==='SESSION'&&id===p.actor_id)return 1;
 if(type==='ATTEMPT'&&p.attempt_id===id&&p.attempt_generation===String(row.generation))return 1;
 fail('OBSERVABILITY_PRODUCER_FORBIDDEN','Observer cannot report another actor resource or boot');
}

export async function observe(tx:Session,p:Principal,input:unknown):Promise<unknown>{
 const v=object(input,['entity_type','entity_id','producer_sequence','observed_state','observed_at','source_digest','source_artifact_id','activity_bytes','expected_observation_version']);
 const type=text(v.entity_type),id=uuid(v.entity_id),sequence=generation(v.producer_sequence),state=text(v.observed_state),at=timestamp(v.observed_at),source=digest(v.source_digest),bytes=generation(v.activity_bytes??'0',true),artifact=v.source_artifact_id===undefined?null:uuid(v.source_artifact_id);
 if(!['ATTEMPT','SESSION','SANDBOX'].includes(type)||!['RUNNING','STOPPED','QUIESCENT','FAILED','UNREACHABLE','UNKNOWN'].includes(state))fail('OBSERVABILITY_INPUT_INVALID','Unknown observation type or state');
 const queries:Record<string,string>={ATTEMPT:'SELECT generation AS generation,sandbox_id,sandbox_boot_generation AS boot_generation,task_id FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',SESSION:'SELECT COALESCE(sandbox_boot_generation,1) AS generation,sandbox_id,sandbox_boot_generation AS boot_generation,parent_session_id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3',SANDBOX:'SELECT s.boot_generation AS generation,s.id AS sandbox_id,s.boot_generation FROM hyperfide.sandboxes s WHERE s.organisation_id=$1 AND s.id=$3 AND EXISTS(SELECT 1 FROM hyperfide.attempts a WHERE a.organisation_id=s.organisation_id AND a.run_id=$2 AND a.sandbox_id=s.id)'};
 const bound=await tx.query(queries[type]!,[p.organisation_id,p.run_id,id]);if(bound.rows.length!==1)fail('OBSERVABILITY_SCOPE_INVALID','Observation entity is not assigned to this run');
 const priority=await observationPriority(tx,p,type,id,bound.rows[0]!);
 const expected=v.expected_observation_version===undefined?null:generation(v.expected_observation_version);
 if(expected!==null){if(priority!==4)fail('OBSERVABILITY_PRODUCER_FORBIDDEN','Only a trusted coordinator may explicitly adopt an observer');const old=await tx.query('SELECT state_version FROM hyperfide.observability_observations WHERE organisation_id=$1 AND run_id=$2 AND entity_type=$3 AND entity_id=$4 FOR UPDATE',[p.organisation_id,p.run_id,type,id]);if(old.rows.length!==1||String(old.rows[0]!.state_version)!==expected)fail('OBSERVABILITY_CONFLICT','Observer adoption requires the current observation version');}
 const clock=await tx.query('SELECT clock_timestamp() AS now');if(Date.parse(at)>new Date(clock.rows[0]!.now as Date).getTime()+5000)fail('OBSERVABILITY_INPUT_INVALID','Future observation timestamp rejected');
 if(artifact)await requireArtifact(tx,p,artifact);
 const result=await tx.query("INSERT INTO hyperfide.observability_observations(organisation_id,run_id,entity_type,entity_id,observer_actor_id,entity_generation,producer_sequence,observed_state,observed_at,source_digest,source_artifact_id,activity_bytes,observer_priority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(organisation_id,run_id,entity_type,entity_id) DO UPDATE SET observer_actor_id=EXCLUDED.observer_actor_id,observer_priority=EXCLUDED.observer_priority,entity_generation=EXCLUDED.entity_generation,producer_sequence=EXCLUDED.producer_sequence,observed_state=EXCLUDED.observed_state,observed_at=EXCLUDED.observed_at,received_at=clock_timestamp(),source_digest=EXCLUDED.source_digest,source_artifact_id=EXCLUDED.source_artifact_id,activity_bytes=EXCLUDED.activity_bytes,state_version=hyperfide.observability_observations.state_version+1 WHERE hyperfide.observability_observations.entity_generation<EXCLUDED.entity_generation OR (hyperfide.observability_observations.entity_generation=EXCLUDED.entity_generation AND (hyperfide.observability_observations.observer_priority<EXCLUDED.observer_priority OR (hyperfide.observability_observations.observer_actor_id=EXCLUDED.observer_actor_id AND hyperfide.observability_observations.producer_sequence<EXCLUDED.producer_sequence) OR (EXCLUDED.observer_priority=4 AND hyperfide.observability_observations.state_version=$14::bigint))) RETURNING entity_id,entity_generation,producer_sequence,state_version",[p.organisation_id,p.run_id,type,id,p.actor_id,String(bound.rows[0]!.generation),sequence,state,at,source,artifact,bytes,priority,expected]);
 if(!result.rows.length){const prior=(await tx.query('SELECT * FROM hyperfide.observability_observations WHERE organisation_id=$1 AND run_id=$2 AND entity_type=$3 AND entity_id=$4',[p.organisation_id,p.run_id,type,id])).rows[0];if(prior&&prior.observer_actor_id===p.actor_id&&String(prior.entity_generation)===String(bound.rows[0]!.generation)&&String(prior.producer_sequence)===sequence){if(prior.observed_state===state&&new Date(prior.observed_at as Date).toISOString()===at&&prior.source_digest===source&&prior.source_artifact_id===artifact&&String(prior.activity_bytes)===bytes)return {recorded:false,replayed:true,observation:{entity_id:id,entity_generation:prior.entity_generation,producer_sequence:sequence,state_version:prior.state_version},activity_is_qualified_progress:false};fail('OBSERVABILITY_CONFLICT','Observation sequence reused with different content');}fail('OBSERVABILITY_STALE_OBSERVATION','Observation sequence or producer cannot replace the stored generation');}
 return {recorded:true,observation:result.rows[0],provenance:'AUTHENTICATED_REPORT',activity_is_qualified_progress:false};
}

export async function entityPage(tx:Session,p:Principal,input:unknown):Promise<unknown>{
 const v=object(input,['kind','limit','after_id']),kind=text(v.kind),limit=v.limit===undefined?100:integer(v.limit,1,500),cursor=v.after_id===undefined?null:text(v.after_id,60);
 const parts=kind==='OBSERVATION'&&cursor?cursor.split(':'):[cursor??'00000000-0000-0000-0000-000000000000'];
 const after=uuid(parts[0]),afterType=parts[1]??'';
 if(kind==='OBSERVATION'&&(parts.length>2||afterType!==''&&!['ATTEMPT','SESSION','SANDBOX'].includes(afterType)))fail('OBSERVABILITY_INPUT_INVALID','Invalid observation cursor');
 const queries:Record<string,string>={
 ATTEMPT:'SELECT id,task_id,generation,execution_state,compute_authority,sandbox_id,sandbox_boot_generation,slot_id,lease_expires_at,state_version FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id>$3 ORDER BY id LIMIT $4',
 SESSION:'SELECT id,role,parent_session_id,attempt_id,sandbox_id,sandbox_boot_generation,state,state_version FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id>$3 ORDER BY id LIMIT $4',
 SANDBOX:'SELECT s.id,s.provider,s.boot_generation,s.desired_state,s.observed_state,s.state_version FROM hyperfide.sandboxes s WHERE s.organisation_id=$1 AND s.id>$3 AND EXISTS(SELECT 1 FROM hyperfide.attempts a WHERE a.organisation_id=s.organisation_id AND a.run_id=$2 AND a.sandbox_id=s.id) ORDER BY s.id LIMIT $4',
 OBSERVATION:'SELECT entity_id AS id,entity_type,entity_generation,observer_actor_id,observer_priority,producer_sequence,observed_state,observed_at,received_at,source_digest,source_artifact_id,activity_bytes,state_version FROM hyperfide.observability_observations WHERE organisation_id=$1 AND run_id=$2 AND (entity_id,entity_type)>($3::uuid,$5::text) ORDER BY entity_id,entity_type LIMIT $4'
 };
 if(!Object.hasOwn(queries,kind))fail('OBSERVABILITY_INPUT_INVALID','Entity page kind is not supported');
 const result=await tx.query(queries[kind]!,kind==='OBSERVATION'?[p.organisation_id,p.run_id,after,limit+1,afterType]:[p.organisation_id,p.run_id,after,limit+1]);const rows=result.rows.slice(0,limit);
 return numbers({kind,rows,scope:{organisation_id:p.organisation_id,run_id:p.run_id},pagination:{limit,next:result.rows.length>limit?(kind==='OBSERVATION'?String(rows.at(-1)!.id)+':'+String(rows.at(-1)!.entity_type):rows.at(-1)!.id):null},authority:'PRIMARY_OBSERVATION',activity_is_qualified_progress:false});
}

export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,actions:{
 'fleet.views.describe':async input=>{object(input,[]);return {schema_version:1,scope:'AUTHENTICATED_RUN',migration:MIGRATION,activity_is_progress:false,read_route:'PRIMARY',replica_routing:'UNSUPPORTED',page_limit:500,graph_limits:{nodes:5000,edges:20000}};},
 'fleet.views.snapshot':(input,ctx)=>authority(ctx,'fleet.views.snapshot',(tx,p)=>snapshot(tx,p,input)),
 'fleet.views.entities':(input,ctx)=>authority(ctx,'fleet.views.entities',(tx,p)=>entityPage(tx,p,input)),
 'fleet.views.observe':(input,ctx)=>authority(ctx,'fleet.views.observe',(tx,p)=>observe(tx,p,input))
}};}
