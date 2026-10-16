import type {Component,ComponentContext} from '../components/registry.js';
import {gateway,trustedActor,requireAuthority,record,uuid,decimal,text,canonical,refuse,ready,hierarchyReadGuard} from './packages.js';

/** Each response observes one primary snapshot; continuation pages observe fresh snapshots. */
export function createComponent(context:ComponentContext):Component {
 const g=gateway(context);
 return {apiVersion:1,actions:{
  'hierarchy.views.describe':async input=>{record(input,[]);return {api_version:1,max_page_size:100,max_response_bytes:262144,authority:'NONE',freshness_source:'PRIMARY_TRANSACTION'};},
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
    const r=await tx.query('SELECT spec_revision_id,spec_generation::text,state_version::text,state,clock_timestamp() AS observed_at FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2',[actor.organisation_id,actor.run_id]);
    const run=r.rows[0]!;
    if(v.expected_spec_generation!==undefined&&decimal(v.expected_spec_generation)!==run.spec_generation||
       v.expected_run_version!==undefined&&decimal(v.expected_run_version)!==run.state_version)
     return refuse('VIEW_CURSOR_STALE','Run/spec generation changed; restart the scoped view');
    const params=[actor.organisation_id,actor.run_id,packageId??null];
    const counts=await tx.query("SELECT state,count(*)::text AS count FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR feature_package_id=$3) GROUP BY state ORDER BY state",params);
    const findings=await tx.query("SELECT state,severity,count(*)::text AS count FROM hyperfide.findings WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR owner_package_id=$3) GROUP BY state,severity ORDER BY state,severity",params);
    const findingTotals=await tx.query("SELECT count(*)::text AS total,count(*) FILTER(WHERE severity IN ('ERROR','CRITICAL'))::text AS blocking FROM hyperfide.findings WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR owner_package_id=$3) AND state IN ('OPEN','ACKNOWLEDGED')",params);
    const findingRows=await tx.query("SELECT f.id,f.owner_package_id,f.contract_id,f.repository_id,f.source_object_id,f.severity,f.summary,f.state,f.state_version::text,(SELECT count(DISTINCT o.evidence_id)::text FROM hyperfide.finding_observations o WHERE o.organisation_id=f.organisation_id AND o.run_id=f.run_id AND o.finding_id=f.id) AS evidence_count,ARRAY(SELECT DISTINCT o.evidence_id FROM hyperfide.finding_observations o WHERE o.organisation_id=f.organisation_id AND o.run_id=f.run_id AND o.finding_id=f.id ORDER BY o.evidence_id LIMIT 16) AS evidence_ids FROM hyperfide.findings f WHERE f.organisation_id=$1 AND f.run_id=$2 AND ($3::uuid IS NULL OR f.owner_package_id=$3) AND f.state IN ('OPEN','ACKNOWLEDGED') ORDER BY CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,f.id LIMIT 101",params);
    const totals=await tx.query("SELECT count(*)::text AS total,count(*) FILTER(WHERE state IN ('BLOCKED','FAILED','STALE'))::text AS blocking FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR feature_package_id=$3)",params);
    const rows=await tx.query("SELECT id,task_key,feature_package_id,spec_revision_id,spec_generation::text,criteria_digest,state,generation::text,state_version::text,current_attempt_id,current_custody_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR feature_package_id=$3) AND ($4::text IS NULL OR task_key>$4) ORDER BY task_key LIMIT $5",
      [...params,after,Number(v.page_size)+1]);
    const blockers=await tx.query("SELECT id,task_key,state,feature_package_id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND ($3::uuid IS NULL OR feature_package_id=$3) AND state IN ('BLOCKED','FAILED','STALE') ORDER BY task_key LIMIT 101",params);
    const deps=await tx.query("SELECT d.task_id,d.predecessor_run_id,d.predecessor_task_id,d.milestone,p.state AS observed_predecessor_state FROM hyperfide.task_dependencies d JOIN hyperfide.tasks t ON t.organisation_id=d.organisation_id AND t.run_id=d.run_id AND t.id=d.task_id JOIN hyperfide.tasks p ON p.organisation_id=d.organisation_id AND p.run_id=d.predecessor_run_id AND p.id=d.predecessor_task_id WHERE d.organisation_id=$1 AND d.run_id=$2 AND ($3::uuid IS NULL OR t.feature_package_id=$3) AND ((d.milestone='QUALIFIED' AND p.state NOT IN ('QUALIFIED','INTEGRATING','INTEGRATED')) OR (d.milestone='INTEGRATED' AND p.state<>'INTEGRATED') OR d.milestone='RELEASED') ORDER BY d.task_id,d.predecessor_task_id LIMIT 101",params);
    let tasks=rows.rows.slice(0,Number(v.page_size));
    let exceptions=blockers.rows.slice(0,100),dependencies=deps.rows.slice(0,100),currentFindings=findingRows.rows.slice(0,100).map(f=>({...f,omitted_evidence:(BigInt(f.evidence_count)-BigInt(f.evidence_ids.length)).toString()}));
    const base={schema_version:1,authority:'NONE',scope:{organisation_id:actor.organisation_id,run_id:actor.run_id,package_id:packageId??null},current_authority:authority,
     provenance:{source:'POSTGRESQL_PRIMARY',consistency:'SERIALIZABLE_SNAPSHOT',observed_at:new Date(run.observed_at).toISOString(),spec_revision_id:run.spec_revision_id,spec_generation:run.spec_generation,run_state_version:run.state_version},
     state:run.state,task_state_counts:counts.rows,finding_counts:findings.rows,total_tasks:totals.rows[0]!.total,
     blocking_task_count:totals.rows[0]!.blocking,active_finding_count:findingTotals.rows[0]!.total,blocking_finding_count:findingTotals.rows[0]!.blocking,has_blocking_exceptions:totals.rows[0]!.blocking!=='0'||findingTotals.rows[0]!.blocking!=='0',
     dependency_assessment:'OBSERVATIONAL; RELEASED milestones require the release-barrier service',
     mandatory_intent:{spec_revision_id:run.spec_revision_id,reference:'IMMUTABLE_ACCEPTED_SPEC; use the scoped execution packet before work'}};
    const result=()=>({...base,tasks,blocking_exceptions:exceptions,dependency_exceptions:dependencies,current_findings:currentFindings,
     omitted_context:{findings:(BigInt(findingTotals.rows[0]!.total)-BigInt(currentFindings.length)).toString(),tasks:(BigInt(base.total_tasks)-BigInt(tasks.length)).toString(),blocking_exceptions:(BigInt(base.blocking_task_count)-BigInt(exceptions.length)).toString(),dependency_exceptions_at_least:Math.max(0,deps.rows.length-dependencies.length)},
     page:{has_more:rows.rows.length>tasks.length,next_task_key:tasks.at(-1)?.task_key??null,spec_generation:run.spec_generation,run_state_version:run.state_version}});
    // Drop optional detail first. Mandatory scope, provenance, blocker totals and
    // explicit omission counts remain present even with a very small budget.
    while(Buffer.byteLength(canonical(result()))>Number(v.max_bytes)){
     if(currentFindings.length){currentFindings=currentFindings.slice(0,-1);continue;}
     if(dependencies.length){dependencies=dependencies.slice(0,-1);continue;}
     if(exceptions.length){exceptions=exceptions.slice(0,-1);continue;}
     if(tasks.length>1){tasks=tasks.slice(0,-1);continue;}
     return refuse('VIEW_BUDGET_TOO_SMALL','Required provenance and exception totals exceed the requested budget');
    }
    if(rows.rows.length&&tasks.length===0)return refuse('VIEW_BUDGET_TOO_SMALL','Budget cannot encode one complete task and its required provenance');
    return result();
   });
  }
 }};
}
