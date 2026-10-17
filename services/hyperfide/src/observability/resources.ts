import type {Component,ComponentContext} from '../components/registry.js';
import {authority,object,text,uuid,digest,integer,generation,timestamp,hash,fail,lockRun,requireArtifact,numbers,requireCollector} from './views.js';
import type {Session,Principal} from './views.js';
import {assertInvocation} from '../transport/protocol.js';
export const DIMENSIONS=['SANDBOX','AGENT_SESSION','CPU_MILLIS','MEMORY_BYTES','DISK_BYTES','BUILD','LINK','TEST','EXCLUSIVE_SERVICE','INDEX','MODEL_REQUEST','MODEL_TOKEN','PROVIDER_API'] as const;
const UNITS:Record<string,string>={SANDBOX:'instances',AGENT_SESSION:'sessions',CPU_MILLIS:'millicpu',MEMORY_BYTES:'bytes',DISK_BYTES:'bytes',BUILD:'jobs',LINK:'jobs',TEST:'jobs',EXCLUSIVE_SERVICE:'services',INDEX:'jobs',MODEL_REQUEST:'requests',MODEL_TOKEN:'tokens',PROVIDER_API:'requests'};
export function decimal(value:unknown):string{
 const s=text(value,32);if(!/^(0|[1-9][0-9]{0,23})(\.[0-9]{1,6})?$/.test(s))fail('OBSERVABILITY_INPUT_INVALID','Nonnegative decimal string with at most six fraction digits required');
 return s.includes('.')?s.replace(/0+$/,'').replace(/\.$/,''):s;
}
export function micros(value:string):bigint{const [whole,fraction='']=value.split('.');return BigInt(whole!)*1000000n+BigInt(fraction.padEnd(6,'0'));}
export async function putProfile(tx:Session,p:Principal,input:unknown):Promise<unknown>{
 requireCollector(p);
 const v=object(input,['id','profile_key','revision','declared_agents_per_sandbox','dimensions']),id=uuid(v.id),key=text(v.profile_key),revision=generation(v.revision),density=integer(v.declared_agents_per_sandbox,0,1000);
 if(!Array.isArray(v.dimensions)||v.dimensions.length<1||v.dimensions.length>DIMENSIONS.length)fail('OBSERVABILITY_INPUT_INVALID','One to thirteen resource dimensions required');
 const seen=new Set<string>(),dimensions=v.dimensions.map(raw=>{const d=object(raw,['dimension','configured_limit','declared_reservation','window_ms']),name=text(d.dimension);
  if(!(DIMENSIONS as readonly string[]).includes(name)||seen.has(name))fail('OBSERVABILITY_INPUT_INVALID','Unknown or duplicate resource dimension');seen.add(name);
  const limit=decimal(d.configured_limit),reservation=decimal(d.declared_reservation);if(micros(reservation)>micros(limit))fail('OBSERVABILITY_INPUT_INVALID','Reservation exceeds declared limit');
  const rate=['MODEL_REQUEST','MODEL_TOKEN','PROVIDER_API'].includes(name),window=rate?integer(d.window_ms,1,86400000):null;if(!rate&&d.window_ms!==undefined)fail('OBSERVABILITY_INPUT_INVALID','Only rate dimensions have a time window');
  return {dimension:name,configured_limit:limit,declared_reservation:reservation,unit:UNITS[name]!,window_ms:window};
 }).sort((a,b)=>a.dimension.localeCompare(b.dimension));
 const content={profile_key:key,revision,declared_agents_per_sandbox:density,dimensions},identity=hash(content);await lockRun(tx,p,'resources');
 const prior=await tx.query('SELECT profile_digest FROM hyperfide.observability_resource_profiles WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[p.organisation_id,p.run_id,id]);
 if(prior.rows.length){if(prior.rows[0]!.profile_digest!==identity)fail('OBSERVABILITY_CONFLICT','Profile identity already has different content');return {id,profile_digest:identity,replayed:true};}
 const count=await tx.query('SELECT count(*) AS n FROM hyperfide.observability_resource_profiles WHERE organisation_id=$1 AND run_id=$2',[p.organisation_id,p.run_id]);if(BigInt(count.rows[0]!.n as string)>=64n)fail('OBSERVABILITY_BACKPRESSURE','Profile count budget exhausted');
 await tx.query('INSERT INTO hyperfide.observability_resource_profiles(organisation_id,run_id,id,profile_key,revision,profile_digest,declared_agents_per_sandbox,publisher_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.organisation_id,p.run_id,id,key,revision,identity,density,p.actor_id]);
 await tx.query('INSERT INTO hyperfide.observability_resource_limits(organisation_id,run_id,profile_id,dimension,configured_limit,declared_reservation,unit,window_ms) SELECT $1,$2,$3,x.dimension,x.configured_limit::numeric,x.declared_reservation::numeric,x.unit,x.window_ms FROM jsonb_to_recordset($4::jsonb) AS x(dimension text,configured_limit text,declared_reservation text,unit text,window_ms integer)',[p.organisation_id,p.run_id,id,JSON.stringify(dimensions)]);
 return {id,profile_digest:identity,replayed:false,declared:content,measurements:'UNKNOWN_UNTIL_OBSERVED'};
}
interface Sample {profile_id:string;subject_id:string;dimension:string;value:string;observed_at:string;producer_sequence:string;origin:string;source_digest:string;source_artifact_id:string}
export async function recordSamples(tx:Session,p:Principal,input:unknown,allowReplay:boolean):Promise<unknown>{
 const v=object(input,['samples']);if(!Array.isArray(v.samples)||v.samples.length<1||v.samples.length>100)fail('OBSERVABILITY_INPUT_INVALID','A bounded batch of one to one hundred measurements is required');
 const keys=new Set<string>(),samples:Sample[]=v.samples.map(raw=>{const s=object(raw,['profile_id','subject_id','dimension','value','observed_at','producer_sequence','origin','source_digest','source_artifact_id']),dimension=text(s.dimension),origin=text(s.origin);
 if(!(DIMENSIONS as readonly string[]).includes(dimension)||!['HOST_COLLECTOR','PROVIDER_REPORT','REPLAY'].includes(origin)||(origin==='REPLAY'&&!allowReplay))fail('OBSERVABILITY_INPUT_INVALID','Unsupported dimension or measurement origin');
 const sample={profile_id:uuid(s.profile_id),subject_id:uuid(s.subject_id),dimension,value:decimal(s.value),observed_at:timestamp(s.observed_at),producer_sequence:generation(s.producer_sequence),origin,source_digest:digest(s.source_digest),source_artifact_id:uuid(s.source_artifact_id)};
 const key=sample.profile_id+':'+sample.subject_id+':'+dimension;if(keys.has(key))fail('OBSERVABILITY_INPUT_INVALID','Duplicate measurement key in batch');keys.add(key);return sample;});
 for(const sample of samples)requireCollector(p,sample.subject_id);
 await lockRun(tx,p,'resources');
 const clock=await tx.query('SELECT clock_timestamp() AS now');const now=new Date(clock.rows[0]!.now as Date).getTime();if(samples.some(s=>Date.parse(s.observed_at)>now+5000))fail('OBSERVABILITY_INPUT_INVALID','Future measurement timestamp rejected');
 const artifacts=[...new Set(samples.map(s=>s.source_artifact_id))];
 const available=await tx.query('SELECT id FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) AND status=$4 ORDER BY id FOR SHARE',[p.organisation_id,p.run_id,artifacts,'COMPLETE']);
 if(available.rows.length!==artifacts.length)fail('OBSERVABILITY_EVIDENCE_UNAVAILABLE','Every measurement requires a complete artifact in the same run');
 const scope=[p.organisation_id,p.run_id,JSON.stringify(samples)];
 const size=await tx.query("WITH input AS (SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(profile_id uuid,subject_id uuid,dimension text)) SELECT (SELECT count(*) FROM hyperfide.observability_resource_samples WHERE organisation_id=$1 AND run_id=$2)+(SELECT count(*) FROM input i WHERE NOT EXISTS(SELECT 1 FROM hyperfide.observability_resource_samples s WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.profile_id=i.profile_id AND s.subject_id=i.subject_id AND s.dimension=i.dimension)) AS n",scope);
 if(BigInt(size.rows[0]!.n as string)>10000n)fail('OBSERVABILITY_BACKPRESSURE','Latest measurement cardinality budget exhausted');
 const existing=await tx.query("SELECT s.* FROM hyperfide.observability_resource_samples s JOIN jsonb_to_recordset($3::jsonb) AS x(profile_id uuid,subject_id uuid,dimension text) ON s.profile_id=x.profile_id AND s.subject_id=x.subject_id AND s.dimension=x.dimension WHERE s.organisation_id=$1 AND s.run_id=$2",scope);
 const old=new Map(existing.rows.map(r=>[r.profile_id+':'+r.subject_id+':'+r.dimension,r]));
 let replayed=0;for(const s of samples){const prior=old.get(s.profile_id+':'+s.subject_id+':'+s.dimension);if(!prior)continue;
 if(prior.producer_actor_id!==p.actor_id||BigInt(prior.producer_sequence as string)>BigInt(s.producer_sequence))fail('OBSERVABILITY_STALE_OBSERVATION','Measurement producer or sequence is stale');
 if(prior.producer_sequence===s.producer_sequence){if(micros(prior.value as string)!==micros(s.value)||new Date(prior.observed_at as Date).toISOString()!==s.observed_at||prior.origin!==s.origin||prior.source_digest!==s.source_digest||prior.source_artifact_id!==s.source_artifact_id)fail('OBSERVABILITY_CONFLICT','Measurement sequence reused with different content');replayed++;}
 }
 const result=await tx.query("INSERT INTO hyperfide.observability_resource_samples(organisation_id,run_id,profile_id,subject_id,dimension,value,observed_at,producer_sequence,producer_actor_id,origin,source_digest,source_artifact_id) SELECT $1,$2,x.profile_id,x.subject_id,x.dimension,x.value::numeric,x.observed_at::timestamptz,x.producer_sequence::bigint,$4,x.origin,x.source_digest,x.source_artifact_id FROM jsonb_to_recordset($3::jsonb) AS x(profile_id uuid,subject_id uuid,dimension text,value text,observed_at text,producer_sequence text,origin text,source_digest text,source_artifact_id uuid) ON CONFLICT(organisation_id,run_id,profile_id,subject_id,dimension) DO UPDATE SET value=EXCLUDED.value,observed_at=EXCLUDED.observed_at,received_at=clock_timestamp(),producer_sequence=EXCLUDED.producer_sequence,producer_actor_id=EXCLUDED.producer_actor_id,origin=EXCLUDED.origin,source_digest=EXCLUDED.source_digest,source_artifact_id=EXCLUDED.source_artifact_id WHERE hyperfide.observability_resource_samples.producer_sequence<EXCLUDED.producer_sequence RETURNING profile_id,subject_id,dimension",[...scope,p.actor_id]);
 return {recorded:result.rows.length,replayed,provenance:'AUTHENTICATED_EXTERNAL_REPORT',independently_verified:false,physical_billing_claim:false};
}
export async function resourceSnapshot(tx:Session,p:Principal,input:unknown):Promise<unknown>{
 const v=object(input,['profile_id','limit','after']),profile=v.profile_id===undefined?null:uuid(v.profile_id),limit=v.limit===undefined?100:integer(v.limit,1,500),after=v.after===undefined?'':text(v.after,128),scope=[p.organisation_id,p.run_id];
 const profiles=await tx.query('SELECT id,profile_key,revision,profile_digest,declared_agents_per_sandbox FROM hyperfide.observability_resource_profiles WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR id=$3) ORDER BY profile_key,revision LIMIT 64',[...scope,profile]);
 const limits=await tx.query('SELECT profile_id,dimension,configured_limit,declared_reservation,unit,window_ms FROM hyperfide.observability_resource_limits WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR profile_id=$3) ORDER BY profile_id,dimension',[...scope,profile]);
 const q=await tx.query("SELECT s.*,l.configured_limit,l.declared_reservation,l.unit,l.window_ms,clock_timestamp() AS sampled_at FROM hyperfide.observability_resource_samples s JOIN hyperfide.observability_resource_limits l USING(organisation_id,run_id,profile_id,dimension) WHERE s.organisation_id=$1 AND s.run_id=$2 AND ($3::uuid IS NULL OR s.profile_id=$3) AND s.profile_id::text||':'||s.subject_id::text||':'||s.dimension>$4 ORDER BY s.profile_id,s.subject_id,s.dimension LIMIT $5",[...scope,profile,after,limit+1]);
 const measured=q.rows.slice(0,limit).map(r=>{const age=Math.max(0,new Date(r.sampled_at as Date).getTime()-new Date(r.observed_at as Date).getTime()),current=age<=15000;return {...r,age_ms:age,freshness:current?'CURRENT':'STALE',utilisation_status:!current?'STALE':micros(r.configured_limit as string)===0n?'DISABLED':micros(r.value as string)>=micros(r.configured_limit as string)?'SATURATED':'BELOW_DECLARED_LIMIT',provenance:'AUTHENTICATED_EXTERNAL_REPORT',independently_verified:false,simulation:r.origin==='REPLAY'};});
 const installed=await tx.query("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='hyperfide.capacity_accounts'::regclass AND attname='capacity_class' AND NOT attisdropped) AS capacity_class");
 const infrastructure=installed.rows[0]!.capacity_class?await tx.query("SELECT a.id,a.pool_id,a.capacity_class,a.dimension,a.resource_key,a.configured_limit,a.reserved,a.allocated,(a.configured_limit-a.reserved-a.allocated)::text AS free,a.provenance_digest,a.qualification_state,a.state_version,p.provider,p.region FROM hyperfide.capacity_accounts a JOIN hyperfide.provider_pools p ON p.organisation_id=a.organisation_id AND p.id=a.pool_id WHERE a.organisation_id=$1 AND EXISTS(SELECT 1 FROM hyperfide.reservations r WHERE r.organisation_id=a.organisation_id AND r.run_id=$2 AND r.capacity_account_id=a.id) ORDER BY a.capacity_class,a.dimension,a.resource_key,a.id LIMIT 500",scope):{rows:[]};
 const sessions=await tx.query("SELECT state,role,count(*) AS count FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 GROUP BY state,role ORDER BY state,role",scope);
 const accounting=await executionAccounting(tx,scope,profile);
 return numbers({schema_version:1,profiles:profiles.rows.map(r=>({...r,dimensions:DIMENSIONS.map(d=>{const declared=limits.rows.find(l=>l.profile_id===r.id&&l.dimension===d);return declared?{...declared,configured_limit:canonical(declared.configured_limit),declared_reservation:canonical(declared.declared_reservation),status:'DECLARED',observed:observedUtilisation(accounting.utilisation.find(u=>u.profile_id===r.id&&u.dimension===d)),queue_reasons:accounting.queue.filter(w=>w.dimension===d).map(w=>w.progress_state)}:{dimension:d,configured_limit:null,declared_reservation:null,unit:UNITS[d],status:'UNDECLARED',observed:observedUtilisation(undefined),queue_reasons:accounting.queue.filter(w=>w.dimension===d).map(w=>w.progress_state)};})})),measurements:measured,capacity_accounts:infrastructure.rows,capacity_accounts_status:installed.rows[0]!.capacity_class?'AVAILABLE':'UNAVAILABLE',capacity_accounts_reason:installed.rows[0]!.capacity_class?null:'SCHEDULER_CAPACITY_CLASS_NOT_INSTALLED',registered_sessions:sessions.rows,
  scheduler_reservations:accounting.reservations,scheduler_reservations_status:accounting.reservations_status,queue:accounting.queue,queue_status:accounting.queue_status,queue_reason:accounting.queue_reason,stalled_execution:accounting.stalled,progress_states:accounting.progress_states,
  provider_capacity:accounting.provider,provider_capacity_status:accounting.provider_status,provider_capacity_reason:accounting.provider_reason,
  agent_accounting:accounting.agents,agent_accounting_status:accounting.agents_status,agent_accounting_reason:accounting.agents_reason,prepared_spares_are_running_sessions:false,uniform_agent_capacity_assumed:false,pagination:{limit,next:q.rows.length>limit?(()=>{const r=q.rows[limit-1]!;return r.profile_id+':'+r.subject_id+':'+r.dimension;})():null},admission_authority:false});
}

// Scheduler wait reasons map onto distinct resource dimensions; build, model and stalled execution are never merged.
const WAIT_STATES:Record<string,string>={BUILD:'BUILD_WAITING',MODEL:'MODEL_WAITING',PROVIDER_RATE:'PROVIDER_RATE_WAITING',EXCLUSIVE_SERVICE:'EXCLUSIVE_SERVICE_WAITING',REVIEW:'REVIEW_WAITING',CAPACITY:'CAPACITY_WAITING'};
const WAIT_DIMENSIONS:Record<string,string>={BUILD:'BUILD',MODEL:'MODEL_REQUEST',PROVIDER_RATE:'PROVIDER_API',EXCLUSIVE_SERVICE:'EXCLUSIVE_SERVICE'};
const JOB_DIMENSIONS:Record<string,string>={AGENT:'AGENT_SESSION',BUILD:'BUILD',TEST:'TEST',INDEX:'INDEX',EXCLUSIVE_SERVICE:'EXCLUSIVE_SERVICE',REVIEW:'AGENT_SESSION',INTEGRATION:'BUILD',PREPARATION:'SANDBOX'};
const PROGRESS_STATES=[...Object.values(WAIT_STATES),'STALLED_EXECUTION'];
interface Utilisation {profile_id:string;dimension:string;subjects:string;current:string;stale:string;saturated:string;max_current_value:string|null;simulated:string}
function canonical(value:unknown):string|null{return value===null||value===undefined?null:decimal(String(value));}
function observedUtilisation(u:Utilisation|undefined):unknown{
 if(!u||u.subjects==='0')return {status:'UNOBSERVED',subjects:0,current:0,stale:0,saturated:0,max_current_value:null,basis:'UNOBSERVED',measured_capacity_claim:false};
 const status=u.saturated!=='0'?'SATURATED':u.current==='0'?'STALE':'BELOW_DECLARED_LIMIT';
 return {status,subjects:Number(u.subjects),current:Number(u.current),stale:Number(u.stale),saturated:Number(u.saturated),max_current_value:canonical(u.max_current_value),basis:u.simulated===u.subjects?'SIMULATION':u.simulated==='0'?'AUTHENTICATED_EXTERNAL_REPORT':'MIXED_SIMULATION_AND_REPORT',measured_capacity_claim:false};
}
export async function executionAccounting(tx:Session,scope:unknown[],profile:string|null){
 const schema=(await tx.query("SELECT to_regclass('hyperfide.resource_waiters')::text AS waiters,to_regclass('hyperfide.provider_quota_observations')::text AS quotas,to_regclass('hyperfide.hierarchy_child_registrations')::text AS children,to_regclass('hyperfide.sandbox_execution_charges')::text AS charges,to_regclass('hyperfide.hierarchy_worker_registrations')::text AS workers")).rows[0]!;
 const utilisation=(await tx.query("SELECT s.profile_id,s.dimension,count(*)::text AS subjects,count(*) FILTER(WHERE s.observed_at>=clock_timestamp()-interval '15 seconds')::text AS current,count(*) FILTER(WHERE s.observed_at<clock_timestamp()-interval '15 seconds')::text AS stale,count(*) FILTER(WHERE s.observed_at>=clock_timestamp()-interval '15 seconds' AND l.configured_limit>0 AND s.value>=l.configured_limit)::text AS saturated,(max(s.value) FILTER(WHERE s.observed_at>=clock_timestamp()-interval '15 seconds'))::text AS max_current_value,count(*) FILTER(WHERE s.origin='REPLAY')::text AS simulated FROM hyperfide.observability_resource_samples s JOIN hyperfide.observability_resource_limits l USING(organisation_id,run_id,profile_id,dimension) WHERE s.organisation_id=$1 AND s.run_id=$2 AND ($3::uuid IS NULL OR s.profile_id=$3) GROUP BY s.profile_id,s.dimension ORDER BY s.profile_id,s.dimension",[...scope,profile])).rows as unknown as Utilisation[];
 const reservations=(await tx.query("SELECT r.capacity_account_id,a.capacity_class,a.dimension,a.resource_key,r.state,count(*)::text AS reservations,sum(r.quantity)::text AS quantity FROM hyperfide.reservations r JOIN hyperfide.capacity_accounts a ON a.organisation_id=r.organisation_id AND a.id=r.capacity_account_id WHERE r.organisation_id=$1 AND r.run_id=$2 GROUP BY r.capacity_account_id,a.capacity_class,a.dimension,a.resource_key,r.state ORDER BY a.capacity_class,a.dimension,a.resource_key,r.capacity_account_id,r.state LIMIT 500",scope)).rows;
 const queue=schema.waiters?(await tx.query("SELECT job_kind,wait_reason,count(*)::text AS waiting,min(enqueued_at) AS oldest_enqueued_at,(floor(extract(epoch FROM clock_timestamp()-min(enqueued_at))*1000))::bigint::text AS oldest_wait_ms FROM hyperfide.resource_waiters WHERE organisation_id=$1 AND run_id=$2 AND state='WAITING' GROUP BY job_kind,wait_reason ORDER BY wait_reason,job_kind",scope)).rows.map((r:Record<string,unknown>)=>({...r,waiting:r.waiting as string,progress_state:WAIT_STATES[r.wait_reason as string]!,dimension:WAIT_DIMENSIONS[r.wait_reason as string]??JOB_DIMENSIONS[r.job_kind as string]!})):[];
 const stalled=(await tx.query("SELECT id AS attempt_id,task_id,execution_state,lease_expires_at,(floor(extract(epoch FROM clock_timestamp()-lease_expires_at)*1000))::bigint::text AS lease_overdue_ms FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND execution_state IN ('PREPARING','START_REQUESTED','RUNNING') AND lease_expires_at<clock_timestamp() ORDER BY lease_expires_at,id LIMIT 500",scope)).rows.map(r=>({...r,progress_state:'STALLED_EXECUTION'}));
 const progress_states=Object.fromEntries(PROGRESS_STATES.map(state=>[state,state==='STALLED_EXECUTION'?stalled.length:queue.filter(w=>w.progress_state===state).reduce((n,w)=>n+Number(w.waiting),0)]));
 const provider=schema.quotas?(await tx.query("SELECT DISTINCT ON (q.pool_id,q.scope_kind,q.scope_key,q.dimension) q.id,q.pool_id,q.provider,q.scope_kind,q.scope_key,q.dimension,q.quota_limit,q.basis,q.observed_at,q.expires_at,q.evidence_digest,CASE WHEN q.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE 'CURRENT' END AS freshness FROM hyperfide.provider_quota_observations q WHERE q.organisation_id=$1 AND q.pool_id IN (SELECT a.pool_id FROM hyperfide.capacity_accounts a JOIN hyperfide.reservations r ON r.organisation_id=a.organisation_id AND r.capacity_account_id=a.id WHERE a.organisation_id=$1 AND r.run_id=$2 UNION SELECT s.pool_id FROM hyperfide.sandboxes s JOIN hyperfide.attempts t ON t.organisation_id=s.organisation_id AND t.sandbox_id=s.id WHERE s.organisation_id=$1 AND t.run_id=$2) ORDER BY q.pool_id,q.scope_kind,q.scope_key,q.dimension,q.observed_at DESC,q.id LIMIT 500",scope)).rows.map(r=>({...r,declared_reservation_source:'PROVIDER_QUOTA_OBSERVATION',measured_capacity_claim:r.basis==='PROVIDER_API'})):[];
 // Every non-terminal session is listed. A child that reached the session table without its exact
 // charged registration is surfaced as an unaccounted spawn instead of disappearing from accounting.
 const accountable=Boolean(schema.children&&schema.charges);
 const agents=accountable?(await tx.query(`SELECT s.id AS session_id,s.role,s.state,s.parent_session_id,s.attempt_id,s.sandbox_id,s.slot_id,c.child_session_id IS NOT NULL AS child_registered,${schema.workers?'w.session_id IS NOT NULL':'false'} AS worker_registered,
  ch.id AS sandbox_charge_id,ch.state AS charge_state,ch.cpu_millis,ch.memory_bytes,ch.disk_bytes,(SELECT count(*) FROM hyperfide.hierarchy_child_reservations cr WHERE cr.organisation_id=s.organisation_id AND cr.run_id=s.run_id AND cr.child_session_id=s.id)::text AS reservation_count
  FROM hyperfide.agent_sessions s LEFT JOIN hyperfide.hierarchy_child_registrations c ON c.organisation_id=s.organisation_id AND c.run_id=s.run_id AND c.child_session_id=s.id
  ${schema.workers?'LEFT JOIN hyperfide.hierarchy_worker_registrations w ON w.organisation_id=s.organisation_id AND w.run_id=s.run_id AND w.session_id=s.id':''}
  LEFT JOIN hyperfide.sandbox_execution_charges ch ON ch.organisation_id=c.organisation_id AND ch.run_id=c.run_id AND ch.id=c.sandbox_charge_id
  WHERE s.organisation_id=$1 AND s.run_id=$2 AND s.state IN ('REGISTERED','RUNNING','DISCONNECTED') ORDER BY s.id LIMIT 500`,scope)).rows.map((r:Record<string,unknown>)=>({...r,parent_session_id:r.parent_session_id as string|null,cpu_millis:r.cpu_millis as string,memory_bytes:r.memory_bytes as string,disk_bytes:r.disk_bytes as string,accounting:r.parent_session_id===null?'ROOT_SESSION':r.child_registered&&r.charge_state&&r.charge_state!=='RELEASED'?'CHILD_CHARGED':r.child_registered?'CHILD_CHARGE_RELEASED':r.worker_registered?'WORKER_REGISTERED':'UNACCOUNTED_SPAWN'})):[];
 const parents=[...new Set(agents.filter(a=>a.parent_session_id!==null).map(a=>a.parent_session_id as string))].sort().map(parent=>{const children=agents.filter(a=>a.parent_session_id===parent),charged=children.filter(a=>a.accounting==='CHILD_CHARGED');
  return {parent_session_id:parent,children:children.length,charged_children:charged.length,unaccounted_children:children.filter(a=>a.accounting==='UNACCOUNTED_SPAWN').length,charged_cpu_millis:charged.reduce((n,a)=>n+BigInt(a.cpu_millis as string),0n).toString(),charged_memory_bytes:charged.reduce((n,a)=>n+BigInt(a.memory_bytes as string),0n).toString(),charged_disk_bytes:charged.reduce((n,a)=>n+BigInt(a.disk_bytes as string),0n).toString()};});
 const unaccounted=agents.filter(a=>a.accounting==='UNACCOUNTED_SPAWN').length;
 return {utilisation,reservations,reservations_status:'AVAILABLE',queue,queue_status:schema.waiters?'AVAILABLE':'UNAVAILABLE',queue_reason:schema.waiters?null:'SCHEDULER_WAITER_SCHEMA_NOT_INSTALLED',stalled,progress_states,
  provider,provider_status:schema.quotas?'AVAILABLE':'UNAVAILABLE',provider_reason:schema.quotas?null:'PROVIDER_QUOTA_SCHEMA_NOT_INSTALLED',
  agents:{sessions:agents,parents,unaccounted_spawns:unaccounted,hidden_spawn_status:unaccounted?'UNACCOUNTED_SPAWN_VISIBLE':'NONE_REGISTERED_WITHOUT_CHARGE',unregistered_processes:'NOT_OBSERVABLE_WITHOUT_SESSION_REGISTRATION'},agents_status:accountable?'AVAILABLE':'UNAVAILABLE',agents_reason:accountable?null:'CHILD_SESSION_ACCOUNTING_SCHEMA_NOT_INSTALLED'};
}

export async function sandboxBudgets(input:unknown,ctx:ComponentContext):Promise<unknown>{
 const v=object(input,['limit','after','prefer_replica']),limit=v.limit===undefined?100:integer(v.limit,1,500);
 if(v.prefer_replica!==undefined&&typeof v.prefer_replica!=='boolean')fail('OBSERVABILITY_INPUT_INVALID','Replica preference must be boolean');
 const cursor=v.after===undefined?null:object(v.after,['sandbox_id','boot_generation']);
 const afterId=cursor?uuid(cursor.sandbox_id):'00000000-0000-0000-0000-000000000000',afterBoot=cursor?generation(cursor.boot_generation):'0';
 const i=ctx.invocation;assertInvocation(i);
 if(i.payload.action!=='fleet.resources.sandbox-budgets'||i.payload.run_id!==i.principal.run_id)fail('AUTHENTICATION_REQUIRED','Exact authenticated observation action required');
 const scope=[i.principal.organisation_id,i.principal.run_id];
 // Admission is checked on the primary before and after the read-only snapshot.
 // The observation session never becomes a primary mutation capability.
 const guard=()=>ctx.resources.gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:i.signal,guard:tx=>i.guard(tx)},async()=>undefined);
 await guard();
 const observed=await ctx.resources.observe({preferReplica:v.prefer_replica===true,timeoutMs:5000,signal:i.signal},async tx=>{
  const source=(await tx.query("SELECT transaction_timestamp() AS snapshot_at,pg_is_in_recovery() AS in_recovery,CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn()::text ELSE pg_current_wal_lsn()::text END AS visible_wal_lsn,CASE WHEN pg_is_in_recovery() THEN pg_last_xact_replay_timestamp() ELSE NULL END AS last_replayed_transaction_at")).rows[0]!;
  const run=(await tx.query('SELECT authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',scope)).rows[0];
  if(!run||run.authority_epoch!==i.principal.deployment_epoch)fail('OBSERVABILITY_SCOPE_INVALID','Observation does not contain the authenticated authority epoch');
  const schema=(await tx.query("SELECT to_regclass('hyperfide.sandbox_execution_budgets')::text AS budgets,to_regclass('hyperfide.sandbox_execution_charges')::text AS charges")).rows[0]!;
  if(!schema.budgets||!schema.charges)return {status:'UNAVAILABLE',reason:'SCHEDULER_SANDBOX_BUDGET_SCHEMA_NOT_INSTALLED',rows:[],pagination:{limit,next:null},source};
  const q=await tx.query(`
   WITH visible AS (
    SELECT sandbox_id,sandbox_boot_generation AS boot_generation FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id IS NOT NULL
    UNION SELECT sandbox_id,sandbox_boot_generation FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND sandbox_id IS NOT NULL AND sandbox_boot_generation IS NOT NULL
    UNION SELECT sandbox_id,sandbox_boot_generation FROM hyperfide.sandbox_execution_charges WHERE organisation_id=$1 AND run_id=$2
   ), page AS (
    SELECT v.sandbox_id,v.boot_generation FROM visible v WHERE (v.sandbox_id,v.boot_generation)>($3::uuid,$4::bigint) ORDER BY v.sandbox_id,v.boot_generation LIMIT $5
   ), charges AS (
    SELECT c.sandbox_id,c.sandbox_boot_generation,
     count(*) FILTER(WHERE c.state='HELD')::text AS held_count,
     count(*) FILTER(WHERE c.state='RELEASE_PENDING')::text AS release_pending_count,
     count(*) FILTER(WHERE c.state='RELEASED')::text AS released_count,
     COALESCE(sum(c.cpu_millis) FILTER(WHERE c.state<>'RELEASED'),0)::text AS retained_cpu_millis,
     COALESCE(sum(c.memory_bytes) FILTER(WHERE c.state<>'RELEASED'),0)::text AS retained_memory_bytes,
     COALESCE(sum(c.disk_bytes) FILTER(WHERE c.state<>'RELEASED'),0)::text AS retained_disk_bytes
    FROM hyperfide.sandbox_execution_charges c JOIN page p ON p.sandbox_id=c.sandbox_id AND p.boot_generation=c.sandbox_boot_generation
    WHERE c.organisation_id=$1 AND c.run_id=$2 GROUP BY c.sandbox_id,c.sandbox_boot_generation
   )
   SELECT p.sandbox_id,p.boot_generation,s.boot_generation AS current_boot_generation,b.qualification_id,b.evidence_digest,b.qualification_source,b.created_at AS qualified_recorded_at,b.state_version,
    b.hard_cpu_millis,b.hard_memory_bytes,b.hard_disk_bytes,b.headroom_cpu_millis,b.headroom_memory_bytes,b.headroom_disk_bytes,
    b.held_cpu_millis,b.held_memory_bytes,b.held_disk_bytes,
    (b.hard_cpu_millis-b.headroom_cpu_millis-b.held_cpu_millis)::text AS free_cpu_millis,
    (b.hard_memory_bytes-b.headroom_memory_bytes-b.held_memory_bytes)::text AS free_memory_bytes,
    (b.hard_disk_bytes-b.headroom_disk_bytes-b.held_disk_bytes)::text AS free_disk_bytes,
    COALESCE(c.held_count,'0') AS run_held_count,COALESCE(c.release_pending_count,'0') AS run_release_pending_count,COALESCE(c.released_count,'0') AS run_released_count,
    COALESCE(c.retained_cpu_millis,'0') AS run_retained_cpu_millis,COALESCE(c.retained_memory_bytes,'0') AS run_retained_memory_bytes,COALESCE(c.retained_disk_bytes,'0') AS run_retained_disk_bytes
   FROM page p JOIN hyperfide.sandboxes s ON s.organisation_id=$1 AND s.id=p.sandbox_id
   LEFT JOIN hyperfide.sandbox_execution_budgets b ON b.organisation_id=$1 AND b.sandbox_id=p.sandbox_id AND b.sandbox_boot_generation=p.boot_generation
   LEFT JOIN charges c ON c.sandbox_id=p.sandbox_id AND c.sandbox_boot_generation=p.boot_generation ORDER BY p.sandbox_id,p.boot_generation
  `,[...scope,afterId,afterBoot,limit+1]);
  const rows=q.rows.slice(0,limit).map(r=>({...r,sandbox_id:r.sandbox_id,boot_generation:r.boot_generation,budget_status:r.qualification_id?'QUALIFIED_RECORDED':'UNQUALIFIED',current_boot:r.boot_generation===r.current_boot_generation,kernel_enforcement:'NOT_EVALUATED'}));
  const last=rows.at(-1);
  return {status:'AVAILABLE',reason:null,rows,pagination:{limit,next:q.rows.length>limit&&last?{sandbox_id:last.sandbox_id,boot_generation:last.boot_generation}:null},source};
 });
 await guard();
 return numbers({schema_version:1,scope:{organisation_id:scope[0],run_id:scope[1]},...observed.value,
  freshness:{route:observed.route.toUpperCase(),read_completed_at:observed.observedAt,snapshot:'REPEATABLE_READ_READ_ONLY',replica_lag_ms:null,replica_lag_status:observed.route==='replica'?'UNKNOWN':'NOT_APPLICABLE',source_fact_freshness:'UNKNOWN_UNTIL_REOBSERVED'},
  counter_scope:'SANDBOX_BOOT_SHARED_TOTAL_WITH_SEPARATE_AUTHENTICATED_RUN_CHARGES',release_pending_retains_charge:true,admission_authority:false,kernel_enforcement:'NOT_EVALUATED'});
}

export function createComponent(_startup:ComponentContext):Component{return {apiVersion:1,actions:{
 'fleet.resources.describe':async input=>{object(input,[]);return {schema_version:1,dimensions:DIMENSIONS,profile_limit:64,measurement_limit:10000,batch_limit:100,unknown_measurements:'NULL_OR_ABSENT',progress_states:PROGRESS_STATES,admission_authority:false};},
 'fleet.resources.profile.put':(input,ctx)=>authority(ctx,'fleet.resources.profile.put',(tx,p)=>putProfile(tx,p,input)),
 'fleet.resources.observe':(input,ctx)=>authority(ctx,'fleet.resources.observe',(tx,p)=>recordSamples(tx,p,input,ctx.env.HYPERFIDE_OBSERVABILITY_ALLOW_REPLAY==='1')),
 'fleet.resources.sandbox-budgets':(input,ctx)=>sandboxBudgets(input,ctx),
 'fleet.resources.snapshot':(input,ctx)=>authority(ctx,'fleet.resources.snapshot',(tx,p)=>resourceSnapshot(tx,p,input))
}};}
