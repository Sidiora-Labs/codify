import type {Component,ComponentContext} from '../components/registry.js';
import {gateway,trustedActor,requireAuthority,record,uuid,decimal,text,canonical,refuse,ready,hierarchyReadGuard} from './packages.js';

type Row=Record<string,any>;
const INTENT_LISTS=['reqs','requires','acceptance_ids','touches'] as const;
const INTENT_ITEMS=16,INTENT_ITEM_CHARS=255,INTENT_PURPOSE_CHARS=512;
// Accepted intent is read from both legacy flat and imported KVX-section definitions;
// the full definition is pinned by digest so bounded inline fields cannot drift silently.
const INTENT_SQL=["COALESCE(definition->'purpose',definition#>'{section,fields,purpose,value}',definition->'title',definition#>'{section,fields,title,value}') AS intent_purpose",
 ...INTENT_LISTS.map(k=>"COALESCE(definition->'"+k+"',definition#>'{section,fields,"+k+",value}') AS intent_"+k),
 "'sha256:'||encode(sha256(convert_to(definition::text,'UTF8')),'hex') AS definition_digest"].join(',');
const BLOCKING_TASK="state IN ('BLOCKED','FAILED','STALE')";
const BLOCKING_FINDING="('ERROR','CRITICAL')";
const iso=(value:unknown):string|null=>value===null||value===undefined?null:new Date(value as string).toISOString();
function intentList(value:unknown):unknown[]{
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{return [value];}}
 return Array.isArray(value)?value:value===null||value===undefined?[]:[value];
}
/** Bounded mandatory intent; any static bound is declared, never silently applied. */
function mandatoryIntent(row:Row){
 const purpose=typeof row.intent_purpose==='string'&&row.intent_purpose.length?row.intent_purpose:null;
 const constraints:Record<string,string[]>={},omitted:Record<string,number>={};let cut=purpose!==null&&purpose.length>INTENT_PURPOSE_CHARS;
 for(const key of INTENT_LISTS){
  const all=intentList(row['intent_'+key]),kept=all.filter((v):v is string=>typeof v==='string').slice(0,INTENT_ITEMS);
  if(kept.some(v=>v.length>INTENT_ITEM_CHARS))cut=true;
  constraints[key]=kept.map(v=>v.slice(0,INTENT_ITEM_CHARS));omitted[key]=all.length-kept.length;
 }
 return {source:'ACCEPTED_TASK_DEFINITION',criteria_digest:row.criteria_digest,definition_digest:row.definition_digest,
  purpose:purpose===null?null:purpose.slice(0,INTENT_PURPOSE_CHARS),constraints,omitted_constraints:omitted,
  inline_complete:purpose!==null&&!cut&&Object.values(omitted).every(n=>n===0)};
}
function freshness(e:Row):'CURRENT'|'PENDING'|'STALE'|'MISSING'{
 return e.total==='0'?'MISSING':e.current!=='0'?'CURRENT':e.pending!=='0'?'PENDING':'STALE';
}

/** Each response observes one primary snapshot; continuation pages observe fresh snapshots. */
export function createComponent(context:ComponentContext):Component {
 const g=gateway(context);
 return {apiVersion:1,actions:{
  'hierarchy.views.describe':async input=>{record(input,[]);return {api_version:1,max_page_size:100,max_response_bytes:262144,min_response_bytes:4096,authority:'NONE',freshness_source:'PRIMARY_TRANSACTION',
   evidence_freshness:['CURRENT','PENDING','STALE','MISSING'],untrusted_fields:['current_findings[].summary.untrusted_text']};},
  'hierarchy.view':async (input,invocation)=>{
   const v=record(input,['leader_generation','package_id','package_generation','after_task_key','page_size','max_bytes','expected_spec_generation','expected_run_version'],
    ['leader_generation','page_size','max_bytes']);
   const actor=trustedActor(invocation);
   if(!Number.isInteger(v.page_size)||Number(v.page_size)<1||Number(v.page_size)>100||
      !Number.isInteger(v.max_bytes)||Number(v.max_bytes)<4096||Number(v.max_bytes)>262144)return refuse('INVALID_REQUEST','Page and byte budgets are out of bounds');
   const after=v.after_task_key===undefined?null:text(v.after_task_key);
   if(after!==null&&(v.expected_spec_generation===undefined||v.expected_run_version===undefined))
    return refuse('VIEW_CURSOR_UNPINNED','Continuation requires exact spec and run versions');
   const packageId=v.package_id===undefined?undefined:uuid(v.package_id);
   return g.withPrimaryTransaction({timeoutMs:10000,guard:hierarchyReadGuard(actor),signal:actor.signal},async tx=>{
    await ready(tx);
    const authority=await requireAuthority(tx,{...actor,leader_generation:decimal(v.leader_generation),
     ...(packageId?{package_id:packageId,package_generation:decimal(v.package_generation)}:{}),roles:['LEADER','FEATURE_MANAGER']});
    const r=await tx.query('SELECT r.spec_revision_id,r.spec_generation::text,r.state_version::text,r.state,s.revision_digest,clock_timestamp() AS observed_at FROM hyperfide.runs r LEFT JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.id=r.spec_revision_id WHERE r.organisation_id=$1 AND r.id=$2',[actor.organisation_id,actor.run_id]);
    const run=r.rows[0]!;
    if(v.expected_spec_generation!==undefined&&decimal(v.expected_spec_generation)!==run.spec_generation||
       v.expected_run_version!==undefined&&decimal(v.expected_run_version)!==run.state_version)
     return refuse('VIEW_CURSOR_STALE','Run/spec generation changed; restart the scoped view');
    const params=[actor.organisation_id,actor.run_id,packageId??null];
    const counts=await tx.query("SELECT state,count(*)::text AS count FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR feature_package_id=$3) GROUP BY state ORDER BY state",params);
    const findings=await tx.query("SELECT state,severity,count(*)::text AS count FROM hyperfide.findings WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR owner_package_id=$3) GROUP BY state,severity ORDER BY state,severity",params);
    const findingTotals=await tx.query("SELECT count(*)::text AS total,count(*) FILTER(WHERE severity IN "+BLOCKING_FINDING+")::text AS blocking FROM hyperfide.findings WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR owner_package_id=$3) AND state IN ('OPEN','ACKNOWLEDGED')",params);
    // Evidence freshness: CURRENT is admitted evidence for the finding's exact source object.
    const observed="FROM hyperfide.finding_observations o JOIN hyperfide.evidence e ON e.organisation_id=o.organisation_id AND e.run_id=o.run_id AND e.id=o.evidence_id WHERE o.organisation_id=f.organisation_id AND o.run_id=f.run_id AND o.finding_id=f.id";
    const linkFreshness="CASE WHEN e.admission_state='ADMITTED' AND e.source_object_id=f.source_object_id THEN 'CURRENT' WHEN e.admission_state='PENDING' THEN 'PENDING' ELSE 'STALE' END";
    const findingRows=await tx.query("SELECT f.id,f.owner_package_id,f.contract_id,f.repository_id,f.source_object_id,f.severity,f.summary,f.state,f.state_version::text,f.created_at,"+
     "(SELECT json_build_object('total',count(DISTINCT o.evidence_id)::text,'current',count(DISTINCT o.evidence_id) FILTER(WHERE "+linkFreshness+"='CURRENT')::text,'pending',count(DISTINCT o.evidence_id) FILTER(WHERE "+linkFreshness+"='PENDING')::text,'last_observed_at',max(o.observed_at)) "+observed+") AS evidence_summary,"+
     "COALESCE((SELECT json_agg(x ORDER BY x.evidence_id) FROM (SELECT o.evidence_id,e.admission_state,e.source_object_id,max(o.observed_at) AS observed_at,"+linkFreshness+" AS freshness "+observed+" GROUP BY o.evidence_id,e.admission_state,e.source_object_id ORDER BY o.evidence_id LIMIT 16) x),'[]'::json) AS evidence "+
     "FROM hyperfide.findings f WHERE f.organisation_id=$1 AND f.run_id=$2 AND ($3::uuid IS NULL OR f.owner_package_id=$3) AND f.state IN ('OPEN','ACKNOWLEDGED') ORDER BY CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,f.id LIMIT 101",params);
    const totals=await tx.query("SELECT count(*)::text AS total,count(*) FILTER(WHERE "+BLOCKING_TASK+")::text AS blocking FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR feature_package_id=$3)",params);
    const rows=await tx.query("SELECT id,task_key,feature_package_id,spec_revision_id,spec_generation::text,criteria_digest,state,generation::text,state_version::text,current_attempt_id,current_custody_id,"+INTENT_SQL+" FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR feature_package_id=$3) AND ($4::text IS NULL OR task_key>$4) ORDER BY task_key LIMIT $5",
      [...params,after,Number(v.page_size)+1]);
    const blockers=await tx.query("SELECT id,task_key,state,state_version::text,feature_package_id,criteria_digest FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR feature_package_id=$3) AND "+BLOCKING_TASK+" ORDER BY task_key LIMIT 101",params);
    // Only edges of each task's current specification generation are dependency intent.
    const unresolved="FROM hyperfide.task_dependencies d JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.run_id AND t.id=d.task_id AND t.spec_generation=d.revision JOIN hyperfide.tasks p ON p.organisation_id=d.organisation_id AND p.run_id=d.predecessor_run_id AND p.id=d.predecessor_task_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND ($3::uuid IS NULL OR t.feature_package_id=$3) AND ((d.milestone='QUALIFIED' AND p.state NOT IN ('QUALIFIED','INTEGRATING','INTEGRATED')) OR (d.milestone='INTEGRATED' AND p.state<>'INTEGRATED') OR d.milestone='RELEASED')";
    const deps=await tx.query("SELECT d.task_id,t.task_key,d.predecessor_run_id,d.predecessor_task_id,p.task_key AS predecessor_task_key,d.milestone,d.revision::text,p.state AS observed_predecessor_state,p.state_version::text AS observed_predecessor_version "+unresolved+" ORDER BY t.task_key,d.predecessor_task_id,d.milestone LIMIT 100",params);
    const depTotals=await tx.query("SELECT count(*)::text AS total "+unresolved,params);
    const blockingDependencies=depTotals.rows[0]!.total as string;
    let tasks=rows.rows.slice(0,Number(v.page_size)).map(t=>({id:t.id,task_key:t.task_key,feature_package_id:t.feature_package_id,spec_revision_id:t.spec_revision_id,spec_generation:t.spec_generation,
     criteria_digest:t.criteria_digest,state:t.state,generation:t.generation,state_version:t.state_version,current_attempt_id:t.current_attempt_id,current_custody_id:t.current_custody_id,mandatory_intent:mandatoryIntent(t)}));
    let exceptions=blockers.rows.slice(0,100),dependencies=deps.rows;
    let currentFindings=findingRows.rows.slice(0,100).map(f=>{
     const summary=f.evidence_summary as Row,evidence=(f.evidence as Row[]).map(e=>({evidence_id:e.evidence_id,admission_state:e.admission_state,source_object_id:e.source_object_id,observed_at:iso(e.observed_at),freshness:e.freshness}));
     return {id:f.id,owner_package_id:f.owner_package_id,contract_id:f.contract_id,repository_id:f.repository_id,source_object_id:f.source_object_id,severity:f.severity,state:f.state,state_version:f.state_version,
      created_at:iso(f.created_at),summary:{untrusted_text:f.summary,content_class:'UNTRUSTED_FINDING_TEXT',authority:'NONE'},
      evidence_freshness:freshness(summary),last_observed_at:iso(summary.last_observed_at),evidence_count:summary.total,evidence,evidence_ids:evidence.map(e=>e.evidence_id),
      omitted_evidence:(BigInt(summary.total)-BigInt(evidence.length)).toString()};
    });
    const blockingFindings=findingTotals.rows[0]!.blocking as string;
    const base={schema_version:1,authority:'NONE',scope:{organisation_id:actor.organisation_id,run_id:actor.run_id,package_id:packageId??null},current_authority:authority,
     provenance:{source:'POSTGRESQL_PRIMARY',consistency:'SERIALIZABLE_SNAPSHOT',observed_at:iso(run.observed_at),spec_revision_id:run.spec_revision_id,spec_generation:run.spec_generation,run_state_version:run.state_version},
     state:run.state,task_state_counts:counts.rows,finding_counts:findings.rows,total_tasks:totals.rows[0]!.total,
     blocking_task_count:totals.rows[0]!.blocking,active_finding_count:findingTotals.rows[0]!.total,blocking_finding_count:blockingFindings,blocking_dependency_count:blockingDependencies,
     has_blocking_exceptions:totals.rows[0]!.blocking!=='0'||blockingFindings!=='0'||blockingDependencies!=='0',
     dependency_assessment:'OBSERVATIONAL; current-generation edges only; RELEASED milestones require the release-barrier service',
     mandatory_intent:{source:'IMMUTABLE_ACCEPTED_SPEC',spec_revision_id:run.spec_revision_id,spec_generation:run.spec_generation,revision_digest:run.revision_digest??null,
      task_intent:'INLINE_ON_EVERY_RETURNED_TASK',reference:'use the scoped execution packet before work'}};
    const result=()=>({...base,tasks,blocking_exceptions:exceptions,dependency_exceptions:dependencies,current_findings:currentFindings,
     omitted_context:{findings:(BigInt(base.active_finding_count)-BigInt(currentFindings.length)).toString(),tasks:(BigInt(base.total_tasks)-BigInt(tasks.length)).toString(),
      blocking_exceptions:(BigInt(base.blocking_task_count)-BigInt(exceptions.length)).toString(),dependency_exceptions:(BigInt(blockingDependencies)-BigInt(dependencies.length)).toString()},
     page:{has_more:rows.rows.length>tasks.length,next_task_key:tasks.at(-1)?.task_key??null,spec_generation:run.spec_generation,run_state_version:run.state_version}});
    // Truncation order: non-blocking findings, then ordinary task rows (down to one complete
    // task with its whole intent), then blocking rows down to one identity per kind, then the
    // remaining blocker identities. Scope, provenance, mandatory intent, exact blocker totals
    // and omission counts are never trimmed; a task row is dropped whole, never partially.
    const blocking=(f:Row)=>f.severity==='ERROR'||f.severity==='CRITICAL';
    const dropLast=<T,>(list:T[],keep:number,accept:(item:T)=>boolean=()=>true):T[]|null=>{
     for(let i=list.length-1;i>=0;i--)if(accept(list[i]!)&&list.filter(accept).length>keep)return [...list.slice(0,i),...list.slice(i+1)];
     return null;
    };
    while(Buffer.byteLength(canonical(result()))>Number(v.max_bytes)){
     let next;
     if((next=dropLast(currentFindings,0,f=>!blocking(f)))){currentFindings=next;continue;}
     if(tasks.length>1){tasks=tasks.slice(0,-1);continue;}
     if((next=dropLast(dependencies,1))){dependencies=next;continue;}
     if((next=dropLast(currentFindings,1))){currentFindings=next;continue;}
     if((next=dropLast(exceptions,1))){exceptions=next;continue;}
     if(dependencies.length){dependencies=[];continue;}
     if(currentFindings.length){currentFindings=[];continue;}
     if(exceptions.length){exceptions=[];continue;}
     return refuse('VIEW_BUDGET_TOO_SMALL','Required provenance, intent and exception totals exceed the requested budget');
    }
    if(rows.rows.length&&tasks.length===0)return refuse('VIEW_BUDGET_TOO_SMALL','Budget cannot encode one complete task and its required provenance');
    return result();
   });
  }
 }};
}
