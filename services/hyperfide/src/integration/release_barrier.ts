import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {getPool} from '../storage/schema.js';
import {bindScope,obj,keys,scope,uuid,values,hash,canonical,fail,config,repository,git,tx,currentRun,readCandidate,type Scope,type IntegrationConfig} from './candidates.js';
import {githubAdapter} from './github.js';
import {evaluateClosure,closureSnapshot} from './closure.js';
async function readBarrier(pool:Pick<pg.PoolClient,'query'>,s:Scope,id:string):Promise<Record<string,any>>{
 const result=await pool.query('SELECT * FROM hyperfide.integration_release_barriers WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...values(s),id]);const row=result.rows[0];
 if(!row||hash(canonical(row.manifest))!==row.manifest_digest)fail('RELEASE_BARRIER_UNKNOWN','Missing or invalid immutable release manifest');return row;
}
async function createBarrier(pool:pg.Pool,cfg:IntegrationConfig,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','request_id','candidate_ids','recovery_policy']);const s=scope(v);if(s.organisation_id!==cfg.organisation_id)fail('RELEASE_SCOPE_DENIED','Wrong organisation');const request=uuid(v.request_id);
 if(!Array.isArray(v.candidate_ids)||!v.candidate_ids.length||v.candidate_ids.length>100||new Set(v.candidate_ids).size!==v.candidate_ids.length)fail('RELEASE_INVALID','Explicit unique complete candidate set required');const ids=v.candidate_ids.map(uuid);
 if(!['ADVANCE_COMPATIBLE_MANIFEST','EXPLICIT_COMPENSATING_REVISION'].includes(String(v.recovery_policy)))fail('RELEASE_INVALID','Explicit non-atomic recovery policy required');
 return tx(pool,async db=>{
 const run=await currentRun(db,s,true);const candidates=[];
 for(const id of ids){const c=await readCandidate(db,s,id,true);if(!['READY','PUBLISHED'].includes(c.row.state))fail('RELEASE_CANDIDATE_UNREADY','Candidate is not admitted');if(c.manifest.spec_revision_id!==run.spec_revision_id||c.manifest.authority_epoch!==run.authority_epoch||c.manifest.policy_digest!==run.policy_digest)fail('RELEASE_INPUT_STALE','Candidate does not match current run');candidates.push(c);}
 const actual=(await db.query('SELECT repository_id FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 ORDER BY repository_id',values(s))).rows.map(r=>r.repository_id);
 const repos=candidates.map(c=>c.manifest.repository_id).sort();if(canonical(actual)!==canonical(repos))fail('RELEASE_SET_INCOMPLETE','Release must pin every run repository exactly once');
 const commitSet=candidates.map(c=>({repository_id:c.manifest.repository_id,candidate_head:c.manifest.candidate_head,expected_old_head:c.manifest.expected_old_head})).sort((a,b)=>a.repository_id.localeCompare(b.repository_id));
 for(const c of candidates)if(canonical(c.manifest.commit_set)!==canonical(commitSet))fail('RELEASE_SET_MISMATCH','Candidates were not verified against the same repository set');
 const manifest={version:1,request_id:request,organisation_id:s.organisation_id,run_id:s.run_id,spec_revision_id:run.spec_revision_id,spec_generation:String(run.spec_generation),authority_epoch:run.authority_epoch,policy_digest:run.policy_digest,recovery_policy:v.recovery_policy,atomic_across_repositories:false,targets:candidates.map(c=>({candidate_id:c.row.id,repository_id:c.manifest.repository_id,candidate_head:c.manifest.candidate_head,input_manifest_digest:c.row.input_manifest_digest,target_ref:c.manifest.target_ref})).sort((a,b)=>a.repository_id.localeCompare(b.repository_id))};
 const md=hash(canonical(manifest));const prior=(await db.query('SELECT * FROM hyperfide.integration_release_barriers WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[...values(s),request])).rows[0];
 if(prior){if(prior.manifest_digest!==md)fail('RELEASE_IDEMPOTENCY_CONFLICT','Different release set under same request identity');return {barrier_id:prior.id,state:prior.state,replayed:true};}
 const id=randomUUID();await db.query('INSERT INTO hyperfide.integration_release_barriers(organisation_id,run_id,id,request_id,manifest_digest,manifest) VALUES($1,$2,$3,$4,$5,$6)',[...values(s),id,request,md,manifest]);
 for(const c of candidates)await db.query("INSERT INTO hyperfide.integration_release_outcomes(organisation_id,run_id,barrier_id,repository_id,candidate_id,outcome) VALUES($1,$2,$3,$4,$5,'PENDING')",[...values(s),id,c.manifest.repository_id,c.row.id]);
 return {barrier_id:id,state:'HELD',manifest_digest:md,atomic_across_repositories:false,downstream_release_allowed:false};
 });
}
async function refresh(pool:pg.Pool,cfg:IntegrationConfig,s:Scope,id:string):Promise<Record<string,any>>{
 const barrier=await readBarrier(pool,s,id);const observations:Record<string,any>[]=[];
 for(const target of barrier.manifest.targets){const r=repository(cfg,target.repository_id);let head:string|null=null;try{head=r.receive_path?await git(r.receive_path,['rev-parse','--verify',target.target_ref]):await (await githubAdapter(process.env,target.repository_id)).observeHead();}catch{}
  observations.push({...target,observed_head:head});
 }
 return tx(pool,async db=>{
 const row=await readBarrier(db,s,id);const run=await currentRun(db,s,true);
 if(row.manifest.spec_revision_id!==run.spec_revision_id||row.manifest.authority_epoch!==run.authority_epoch||row.manifest.policy_digest!==run.policy_digest)fail('RELEASE_INPUT_STALE','Run inputs changed');
 const outcomes=[];
 for(const observation of observations){
 const op=(await db.query('SELECT * FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3 ORDER BY created_at DESC LIMIT 1',[...values(s),observation.candidate_id])).rows[0];
 let outcome='PENDING';
 if(op?.state==='PUBLISHED'&&op.observed_head===observation.candidate_head&&observation.observed_head===observation.candidate_head)outcome='PUBLISHED';
 else if(op?.state==='FAILED'||op?.state==='CANCELLED')outcome='FAILED';
 else if(op||observation.observed_head!==null&&observation.observed_head!==row.manifest.targets.find((t:Record<string,any>)=>t.repository_id===observation.repository_id)?.candidate_head)outcome='UNKNOWN';
 await db.query('UPDATE hyperfide.integration_release_outcomes SET operation_id=$5,outcome=$6,observed_head=$7 WHERE organisation_id=$1 AND run_id=$2 AND barrier_id=$3 AND repository_id=$4',[...values(s),id,observation.repository_id,op?.id??null,outcome,observation.observed_head]);outcomes.push({repository_id:observation.repository_id,candidate_id:observation.candidate_id,operation_id:op?.id??null,outcome,observed_head:observation.observed_head});
 }
 let state=outcomes.every(o=>o.outcome==='PUBLISHED')?'HELD':outcomes.some(o=>o.outcome==='PUBLISHED')?'PARTIAL':outcomes.some(o=>o.outcome==='UNKNOWN')?'RECONCILING':outcomes.some(o=>o.outcome==='FAILED')?'FAILED':'HELD';
 if(row.state==='RELEASED'&&outcomes.every(o=>o.outcome==='PUBLISHED'))state='RELEASED';
 await db.query('UPDATE hyperfide.integration_release_barriers SET state=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state IS DISTINCT FROM $4',[...values(s),id,state]);
 return {barrier_id:id,state,outcomes,all_published:outcomes.every(o=>o.outcome==='PUBLISHED'),atomic_across_repositories:false,downstream_release_allowed:state==='RELEASED'};
 });
}
async function release(pool:pg.Pool,cfg:IntegrationConfig,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','barrier_id']);const s=scope(v),id=uuid(v.barrier_id);if(s.organisation_id!==cfg.organisation_id)fail('RELEASE_SCOPE_DENIED','Wrong organisation');
 const observed=await refresh(pool,cfg,s,id);if(!observed.all_published)return observed;
 const waves=(await pool.query('SELECT DISTINCT wave FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 ORDER BY wave',values(s))).rows;
 const evaluations:Record<string,unknown>[]=[];
 for(const row of waves){const result=obj(await evaluateClosure(pool,cfg,{...s,level:'WAVE',wave:row.wave}));evaluations.push(result);if(result.outcome!=='PASS')return {...observed,wave_closure_evaluations:evaluations,downstream_release_allowed:false};}
 return tx(pool,async db=>{
 await currentRun(db,s,true);for(const evaluation of evaluations){const snapshot=await closureSnapshot(db,s,'WAVE',Number(evaluation.wave));if(hash(canonical(snapshot))!==evaluation.input_manifest_digest)fail('RELEASE_WAVE_EVIDENCE_STALE','Wave evidence changed before release');}const row=await readBarrier(db,s,id);const outcomes=(await db.query('SELECT * FROM hyperfide.integration_release_outcomes WHERE organisation_id=$1 AND run_id=$2 AND barrier_id=$3 FOR UPDATE',[...values(s),id])).rows;
 if(outcomes.length!==row.manifest.targets.length||outcomes.some(o=>o.outcome!=='PUBLISHED'))fail('RELEASE_INCOMPLETE','Publication outcomes changed');
 await db.query("UPDATE hyperfide.integration_release_barriers SET state='RELEASED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state<>'RELEASED'",[...values(s),id]);
 return {barrier_id:id,state:'RELEASED',manifest_digest:row.manifest_digest,atomic_across_repositories:false,downstream_release_allowed:true,programme_qualified:false,external_activation_authorized:false,wave_closure_evaluations:evaluations};
 });
}
export function createComponent(ctx:ComponentContext):Component{
 let cfg:Promise<IntegrationConfig>|undefined;const settings=()=>cfg??=config(ctx.env);
 return bindScope(ctx,{apiVersion:1,actions:{
 'integration.release.create':async input=>createBarrier(getPool(ctx.env),await settings(),input),
 'integration.release.inspect':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','barrier_id']);return refresh(getPool(ctx.env),await settings(),scope(v),uuid(v.barrier_id));},
 'integration.release.evaluate':async input=>release(getPool(ctx.env),await settings(),input)
 }});
}
