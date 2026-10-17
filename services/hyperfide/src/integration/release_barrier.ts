import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {bindScope,primaryClient,obj,keys,scope,uuid,values,hash,canonical,fail,config,repository,git,tx,currentRun,readCandidate,type DB,type Scope,type IntegrationConfig} from './candidates.js';
import {githubAdapter} from './github.js';
import {evaluateClosure,closureSnapshot} from './closure.js';
const POLICIES=['ADVANCE_COMPATIBLE_MANIFEST','EXPLICIT_COMPENSATING_REVISION'];
async function readBarrier(pool:DB,s:Scope,id:string,lock=false):Promise<Record<string,any>>{
 const result=await pool.query('SELECT * FROM hyperfide.integration_release_barriers WHERE organisation_id=$1 AND run_id=$2 AND id=$3'+(lock?' FOR UPDATE':''),[...values(s),id]);const row=result.rows[0];
 if(!row||hash(canonical(row.manifest))!==row.manifest_digest)fail('RELEASE_BARRIER_UNKNOWN','Missing or invalid immutable release manifest');return row;
}
function candidateSet(v:unknown):string[]{
 if(!Array.isArray(v)||!v.length||v.length>100||new Set(v).size!==v.length)fail('RELEASE_INVALID','Explicit unique complete candidate set required');return v.map(uuid);
}
/** Pins one programme commit set. Ordinary per-repository Git updates remain
 * separate effects; the barrier, never Git, decides when the set is released. */
async function insertBarrier(db:DB,s:Scope,request:string,ids:string[],policy:string,supersedes?:{barrier_id:string;manifest_digest:string;recovery_id:string}):Promise<Record<string,any>>{
 const run=await currentRun(db,s,true);const candidates=[];
 for(const id of ids){const c=await readCandidate(db,s,id,true);if(!['READY','PUBLISHED'].includes(c.row.state))fail('RELEASE_CANDIDATE_UNREADY','Candidate is not admitted');if(c.manifest.spec_revision_id!==run.spec_revision_id||c.manifest.authority_epoch!==run.authority_epoch||c.manifest.policy_digest!==run.policy_digest)fail('RELEASE_INPUT_STALE','Candidate does not match current run');candidates.push(c);}
 const actual=(await db.query('SELECT repository_id FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 ORDER BY repository_id',values(s))).rows.map(r=>r.repository_id);
 const repos=candidates.map(c=>c.manifest.repository_id).sort();if(canonical(actual)!==canonical(repos))fail('RELEASE_SET_INCOMPLETE','Release must pin every run repository exactly once');
 const commitSet=candidates.map(c=>({repository_id:c.manifest.repository_id,candidate_head:c.manifest.candidate_head,expected_old_head:c.manifest.expected_old_head})).sort((a,b)=>a.repository_id.localeCompare(b.repository_id));
 for(const c of candidates){if(c.row.state==='PUBLISHED'){const latest=(await db.query("SELECT candidate_id FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND repository_id=$3 AND state='PUBLISHED' AND observed_head=candidate_head ORDER BY created_at DESC,id DESC LIMIT 1",[...values(s),c.manifest.repository_id])).rows[0];if(latest?.candidate_id!==c.row.id)fail('RELEASE_BASELINE_STALE','Reused published repository must be exact latest owned head');}else if(canonical(c.manifest.commit_set)!==canonical(commitSet))fail('RELEASE_SET_MISMATCH','New candidates must pin the same complete repository set');}
 const manifest={version:1,request_id:request,organisation_id:s.organisation_id,run_id:s.run_id,spec_revision_id:run.spec_revision_id,spec_generation:String(run.spec_generation),authority_epoch:run.authority_epoch,policy_digest:run.policy_digest,recovery_policy:policy,atomic_across_repositories:false,...(supersedes?{supersedes}:{}),targets:candidates.map(c=>({candidate_id:c.row.id,repository_id:c.manifest.repository_id,candidate_head:c.manifest.candidate_head,input_manifest_digest:c.row.input_manifest_digest,target_ref:c.manifest.target_ref,reused_published:c.row.state==='PUBLISHED'})).sort((a,b)=>a.repository_id.localeCompare(b.repository_id))};
 const md=hash(canonical(manifest));const prior=(await db.query('SELECT * FROM hyperfide.integration_release_barriers WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[...values(s),request])).rows[0];
 if(prior){if(prior.manifest_digest!==md)fail('RELEASE_IDEMPOTENCY_CONFLICT','Different release set under same request identity');return {barrier_id:prior.id,state:prior.state,manifest,replayed:true};}
 const id=randomUUID();await db.query('INSERT INTO hyperfide.integration_release_barriers(organisation_id,run_id,id,request_id,manifest_digest,manifest) VALUES($1,$2,$3,$4,$5,$6)',[...values(s),id,request,md,manifest]);
 for(const c of candidates)await db.query("INSERT INTO hyperfide.integration_release_outcomes(organisation_id,run_id,barrier_id,repository_id,candidate_id,outcome) VALUES($1,$2,$3,$4,$5,'PENDING')",[...values(s),id,c.manifest.repository_id,c.row.id]);
 return {barrier_id:id,state:'HELD',manifest_digest:md,manifest,replayed:false};
}
async function createBarrier(pool:DB,cfg:IntegrationConfig,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','request_id','candidate_ids','recovery_policy']);const s=scope(v);if(s.organisation_id!==cfg.organisation_id)fail('RELEASE_SCOPE_DENIED','Wrong organisation');const request=uuid(v.request_id);
 const ids=candidateSet(v.candidate_ids);
 if(!POLICIES.includes(String(v.recovery_policy)))fail('RELEASE_INVALID','Explicit non-atomic recovery policy required');
 return tx(pool,async db=>{
 const created=await insertBarrier(db,s,request,ids,String(v.recovery_policy));
 if(created.replayed)return {barrier_id:created.barrier_id,state:created.state,replayed:true};
 return {barrier_id:created.barrier_id,state:'HELD',manifest_digest:created.manifest_digest,atomic_across_repositories:false,downstream_release_allowed:false};
 });
}
async function latestObservations(db:DB,s:Scope,id:string):Promise<Record<string,any>[]>{
 return (await db.query('SELECT DISTINCT ON (repository_id) * FROM hyperfide.integration_release_observations WHERE organisation_id=$1 AND run_id=$2 AND barrier_id=$3 ORDER BY repository_id,sequence DESC',[...values(s),id])).rows;
}
async function readRecovery(db:DB,s:Scope,id:string):Promise<Record<string,any>|undefined>{
 const row=(await db.query('SELECT * FROM hyperfide.integration_release_recoveries WHERE organisation_id=$1 AND run_id=$2 AND barrier_id=$3',[...values(s),id])).rows[0];if(!row)return undefined;
 const compensations=(await db.query('SELECT c.repository_id,c.compensated_head,c.operation_id,p.state,p.candidate_head,p.observed_head,EXISTS(SELECT 1 FROM hyperfide.publication_gateway_admissions a WHERE a.organisation_id=p.organisation_id AND a.run_id=p.run_id AND a.operation_id=p.id) OR EXISTS(SELECT 1 FROM hyperfide.publication_hosted_receipts h WHERE h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.operation_id=p.id) AS gateway_admitted FROM hyperfide.integration_release_compensations c JOIN hyperfide.publication_operations p ON p.organisation_id=c.organisation_id AND p.run_id=c.run_id AND p.id=c.operation_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.recovery_id=$3 ORDER BY c.repository_id',[...values(s),row.id])).rows;
 return {...row,compensations};
}
/** A compensating revision counts only once the protected gateway published it
 * and the real target ref reads back as that revision. */
function recoveryStatus(recovery:Record<string,any>,heads:Map<string,string|null>):Record<string,unknown>{
 if(recovery.recovery_policy==='ADVANCE_COMPATIBLE_MANIFEST')return {recovery_id:recovery.id,recovery_policy:recovery.recovery_policy,status:'SUPERSEDED',successor_barrier_id:recovery.successor_barrier_id};
 const compensations=recovery.compensations.map((c:Record<string,any>)=>({repository_id:c.repository_id,operation_id:c.operation_id,compensated_head:c.compensated_head,compensating_head:c.candidate_head,operation_state:c.state,gateway_admitted:c.gateway_admitted,observed_head:heads.get(c.repository_id)??null,
  status:c.state==='PUBLISHED'&&!c.gateway_admitted?'UNGATED':c.state==='PUBLISHED'&&c.observed_head===c.candidate_head&&heads.get(c.repository_id)===c.candidate_head?'COMPENSATED':['FAILED','CANCELLED'].includes(c.state)?'FAILED':'COMPENSATING'}));
 const status=compensations.every((c:Record<string,any>)=>c.status==='COMPENSATED')?'COMPENSATED':compensations.some((c:Record<string,any>)=>['FAILED','UNGATED'].includes(c.status))?'COMPENSATION_FAILED':'COMPENSATING';
 return {recovery_id:recovery.id,recovery_policy:recovery.recovery_policy,status,compensations};
}
async function observeHeads(cfg:IntegrationConfig,targets:Record<string,any>[]):Promise<Map<string,string|null>>{
 const heads=new Map<string,string|null>();
 for(const target of targets){const r=repository(cfg,target.repository_id);let head:string|null=null;try{head=r.receive_path?await git(r.receive_path,['rev-parse','--verify',target.target_ref]):await (await githubAdapter(process.env,target.repository_id)).observeHead();}catch{}heads.set(target.repository_id,head);}
 return heads;
}
/** UNKNOWN means the real ref could not be tied to a terminal gateway receipt;
 * it outranks PARTIAL so no release or recovery decision precedes read-back. */
function classify(op:Record<string,any>|undefined,head:string,old:string|null,observed:string|null):string{
 if(op?.state==='PUBLISHED'&&op.observed_head===head&&observed===head)return 'PUBLISHED';
 if(observed===null)return 'UNKNOWN';
 if((op?.state==='FAILED'||op?.state==='CANCELLED')&&observed!==head)return 'FAILED';
 if((!op||op.state==='PENDING')&&observed===old)return 'PENDING';
 return 'UNKNOWN';
}
function derive(outcomes:Record<string,any>[]):string{
 return outcomes.some(o=>o.outcome==='UNKNOWN')?'RECONCILING':outcomes.every(o=>o.outcome==='PUBLISHED')?'HELD':outcomes.some(o=>o.outcome==='PUBLISHED')?'PARTIAL':outcomes.some(o=>o.outcome==='FAILED')?'FAILED':'HELD';
}
async function refresh(pool:DB,cfg:IntegrationConfig,s:Scope,id:string):Promise<Record<string,any>>{
 const barrier=await readBarrier(pool,s,id);const heads=await observeHeads(cfg,barrier.manifest.targets);
 return tx(pool,async db=>{
 const row=await readBarrier(db,s,id,true);const run=await currentRun(db,s,true);
 if(row.manifest.spec_revision_id!==run.spec_revision_id||row.manifest.authority_epoch!==run.authority_epoch||row.manifest.policy_digest!==run.policy_digest)fail('RELEASE_INPUT_STALE','Run inputs changed');
 const recovery=await readRecovery(db,s,id);const previous=new Map((await latestObservations(db,s,id)).map(o=>[o.repository_id,o]));
 const outcomes:Record<string,any>[]=[];
 for(const target of row.manifest.targets){
 const prior=previous.get(target.repository_id);
 // A recovered barrier is historical: its decisive observations are frozen.
 if(recovery){outcomes.push({repository_id:target.repository_id,candidate_id:target.candidate_id,operation_id:prior?.operation_id??null,outcome:prior?.outcome??'PENDING',observed_head:prior?.observed_head??null});continue;}
 const op=(await db.query('SELECT * FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[...values(s),target.candidate_id])).rows[0];
 const old=(await readCandidate(db,s,target.candidate_id)).manifest.expected_old_head??null;const observed=heads.get(target.repository_id)??null;
 const outcome=classify(op,target.candidate_head,old,observed);
 if(!prior||prior.outcome!==outcome||prior.observed_head!==observed||prior.operation_id!==(op?.id??null))await db.query('INSERT INTO hyperfide.integration_release_observations(organisation_id,run_id,barrier_id,repository_id,candidate_id,operation_id,outcome,observed_head) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[...values(s),id,target.repository_id,target.candidate_id,op?.id??null,outcome,observed]);
 outcomes.push({repository_id:target.repository_id,candidate_id:target.candidate_id,operation_id:op?.id??null,outcome,observed_head:observed});
 }
 let state=row.state;
 if(!recovery&&row.state!=='RELEASED'){state=derive(outcomes);await db.query('UPDATE hyperfide.integration_release_barriers SET state=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state IS DISTINCT FROM $4',[...values(s),id,state]);}
 const all=outcomes.every(o=>o.outcome==='PUBLISHED');
 return {barrier_id:id,state,manifest_digest:row.manifest_digest,recovery_policy:row.manifest.recovery_policy,outcomes,all_published:all,reconciliation_required:outcomes.some(o=>o.outcome==='UNKNOWN'),atomic_across_repositories:false,downstream_release_allowed:state==='RELEASED'&&all&&!recovery,...(recovery?{recovery:recoveryStatus(recovery,heads)}:{})};
 });
}
async function release(pool:DB,cfg:IntegrationConfig,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','barrier_id']);const s=scope(v),id=uuid(v.barrier_id);if(s.organisation_id!==cfg.organisation_id)fail('RELEASE_SCOPE_DENIED','Wrong organisation');
 const observed=await refresh(pool,cfg,s,id);if(!observed.all_published||observed.recovery)return observed;
 const waves=(await pool.query('SELECT DISTINCT wave FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 ORDER BY wave',values(s))).rows;
 const evaluations:Record<string,unknown>[]=[];
 for(const row of waves){const result=obj(await evaluateClosure(pool,cfg,{...s,level:'WAVE',wave:row.wave}));evaluations.push(result);if(result.outcome!=='PASS')return {...observed,wave_closure_evaluations:evaluations,downstream_release_allowed:false};}
 return tx(pool,async db=>{
 await currentRun(db,s,true);for(const evaluation of evaluations){const snapshot=await closureSnapshot(db,s,'WAVE',Number(evaluation.wave));if(hash(canonical(snapshot))!==evaluation.input_manifest_digest)fail('RELEASE_WAVE_EVIDENCE_STALE','Wave evidence changed before release');}const row=await readBarrier(db,s,id,true);
 if(await readRecovery(db,s,id))fail('RELEASE_RECOVERED','A recovered partial barrier remains historical');
 const latest=await latestObservations(db,s,id);
 if(latest.length!==row.manifest.targets.length||latest.some(o=>o.outcome!=='PUBLISHED'))fail('RELEASE_INCOMPLETE','Publication outcomes changed');
 await db.query("UPDATE hyperfide.integration_release_barriers SET state='RELEASED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state<>'RELEASED'",[...values(s),id]);
 return {barrier_id:id,state:'RELEASED',manifest_digest:row.manifest_digest,atomic_across_repositories:false,downstream_release_allowed:true,programme_qualified:false,external_activation_authorized:false,wave_closure_evaluations:evaluations};
 });
}
/** Recovery follows the policy pinned at creation. Advance pins a successor
 * manifest; compensation names gateway publications, never direct pushes. */
async function recover(pool:DB,cfg:IntegrationConfig,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','barrier_id','request_id'],['candidate_ids','compensations']);const s=scope(v),id=uuid(v.barrier_id),request=uuid(v.request_id);if(s.organisation_id!==cfg.organisation_id)fail('RELEASE_SCOPE_DENIED','Wrong organisation');
 const next=v.candidate_ids===undefined?undefined:candidateSet(v.candidate_ids);
 let compensations:{repository_id:string;operation_id:string}[]|undefined;
 if(v.compensations!==undefined){if(!Array.isArray(v.compensations)||v.compensations.length>100)fail('RELEASE_INVALID','Bounded compensation list required');compensations=v.compensations.map(raw=>{const c=obj(raw);keys(c,['repository_id','operation_id']);return {repository_id:uuid(c.repository_id),operation_id:uuid(c.operation_id)};}).sort((a,b)=>a.repository_id.localeCompare(b.repository_id));}
 const requestDigest=hash(canonical({barrier_id:id,candidate_ids:next??null,compensations:compensations??null}));
 await refresh(pool,cfg,s,id);
 return tx(pool,async db=>{
 await currentRun(db,s,true);const row=await readBarrier(db,s,id,true);const policy=row.manifest.recovery_policy;
 const prior=(await db.query('SELECT * FROM hyperfide.integration_release_recoveries WHERE organisation_id=$1 AND run_id=$2 AND (request_id=$3 OR barrier_id=$4)',[...values(s),request,id])).rows[0];
 if(prior){if(prior.request_id!==request||prior.barrier_id!==id||prior.request_digest!==requestDigest)fail('RELEASE_RECOVERY_CONFLICT','Barrier already has a different recorded recovery');return {recovery_id:prior.id,barrier_id:id,recovery_policy:prior.recovery_policy,successor_barrier_id:prior.successor_barrier_id,atomic_across_repositories:false,downstream_release_allowed:false,replayed:true};}
 const latest=await latestObservations(db,s,id);
 if(latest.length!==row.manifest.targets.length||latest.some(o=>o.outcome==='UNKNOWN'))fail('RELEASE_RECONCILIATION_REQUIRED','Read back every uncertain repository publication before recovery');
 if(row.state!=='PARTIAL')fail('RELEASE_RECOVERY_NOT_PARTIAL','Only an explicit partial commit set is recovered');
 const outcome=new Map(latest.map(o=>[o.repository_id,o]));const targets:Record<string,any>[]=row.manifest.targets;
 const published=targets.filter(t=>outcome.get(t.repository_id)?.outcome==='PUBLISHED'),remaining=targets.filter(t=>outcome.get(t.repository_id)?.outcome!=='PUBLISHED');
 const recoveryId=randomUUID();const observedOutcomes=latest.map(o=>({repository_id:o.repository_id,candidate_id:o.candidate_id,operation_id:o.operation_id,outcome:o.outcome,observed_head:o.observed_head,sequence:String(o.sequence)}));
 if(policy==='ADVANCE_COMPATIBLE_MANIFEST'){
  if(compensations!==undefined||!next)fail('RELEASE_RECOVERY_POLICY_MISMATCH','Barrier recorded advance-compatible-manifest recovery; successor candidates required');
  const repos:string[]=[];for(const c of next){const m=(await readCandidate(db,s,c)).manifest;if(targets.some(t=>t.candidate_id===c&&outcome.get(t.repository_id)?.outcome==='FAILED'))fail('RELEASE_RECOVERY_INVALID','Failed candidate cannot be re-pinned');repos.push(m.repository_id);}
  if(canonical(repos.sort())!==canonical(remaining.map(t=>t.repository_id).sort()))fail('RELEASE_SET_INCOMPLETE','Successor must pin compatible candidates for exactly the unpublished repositories');
  const successor=await insertBarrier(db,s,request,[...published.map(t=>t.candidate_id),...next],policy,{barrier_id:id,manifest_digest:row.manifest_digest,recovery_id:recoveryId});
  if(successor.replayed)fail('RELEASE_IDEMPOTENCY_CONFLICT','Recovery request identity already names a barrier');
  for(const t of published){const pinned=successor.manifest.targets.find((x:Record<string,any>)=>x.repository_id===t.repository_id);if(!pinned?.reused_published||pinned.candidate_head!==t.candidate_head)fail('RELEASE_BASELINE_STALE','Successor must reuse the exact published heads');}
  await db.query('INSERT INTO hyperfide.integration_release_recoveries(organisation_id,run_id,id,barrier_id,request_id,request_digest,recovery_policy,observed_outcomes,successor_barrier_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[...values(s),recoveryId,id,request,requestDigest,policy,JSON.stringify(observedOutcomes),successor.barrier_id]);
  return {recovery_id:recoveryId,barrier_id:id,state:row.state,recovery_policy:policy,successor_barrier_id:successor.barrier_id,successor_manifest_digest:successor.manifest_digest,successor_state:successor.state,atomic_across_repositories:false,downstream_release_allowed:false,replayed:false};
 }
 if(next!==undefined)fail('RELEASE_RECOVERY_POLICY_MISMATCH','Barrier recorded explicit compensating revision recovery');
 if(!compensations?.length||canonical(compensations.map(c=>c.repository_id))!==canonical(published.map(t=>t.repository_id).sort())||new Set(compensations.map(c=>c.repository_id)).size!==compensations.length)fail('RELEASE_COMPENSATION_REQUIRED','Every already-published repository requires an explicit compensating gateway publication');
 const recorded=[];
 for(const c of compensations){
  const target=published.find(t=>t.repository_id===c.repository_id)!;
  const op=(await db.query('SELECT p.*,EXISTS(SELECT 1 FROM hyperfide.publication_gateway_admissions a WHERE a.organisation_id=p.organisation_id AND a.run_id=p.run_id AND a.operation_id=p.id) OR EXISTS(SELECT 1 FROM hyperfide.publication_hosted_receipts h WHERE h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.operation_id=p.id) AS gateway_admitted FROM hyperfide.publication_operations p WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.id=$3 FOR UPDATE OF p',[...values(s),c.operation_id])).rows[0];
  if(!op)fail('RELEASE_COMPENSATION_UNKNOWN','Compensation must name a gateway publication operation');
  if(op.repository_id!==c.repository_id||op.expected_old_head!==target.candidate_head||op.candidate_head===target.candidate_head||targets.some(t=>t.candidate_id===op.candidate_id)||['FAILED','CANCELLED'].includes(op.state))fail('RELEASE_COMPENSATION_INVALID','Compensation must advance from the exact published head through a live gateway operation');
  if(op.state==='PUBLISHED'&&!op.gateway_admitted)fail('RELEASE_COMPENSATION_UNGATED','Compensating revision must be published by the protected gateway, never a direct push');
  recorded.push({repository_id:c.repository_id,operation_id:op.id,compensated_head:target.candidate_head,compensating_head:op.candidate_head,operation_state:op.state});
 }
 await db.query('INSERT INTO hyperfide.integration_release_recoveries(organisation_id,run_id,id,barrier_id,request_id,request_digest,recovery_policy,observed_outcomes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[...values(s),recoveryId,id,request,requestDigest,policy,JSON.stringify(observedOutcomes)]);
 for(const c of recorded)await db.query('INSERT INTO hyperfide.integration_release_compensations(organisation_id,run_id,recovery_id,repository_id,compensated_head,operation_id) VALUES($1,$2,$3,$4,$5,$6)',[...values(s),recoveryId,c.repository_id,c.compensated_head,c.operation_id]);
 return {recovery_id:recoveryId,barrier_id:id,state:row.state,recovery_policy:policy,compensations:recorded,atomic_across_repositories:false,downstream_release_allowed:false,replayed:false};
 });
}
export function createComponent(ctx:ComponentContext):Component{
 let cfg:Promise<IntegrationConfig>|undefined;const settings=()=>cfg??=config(ctx.env);
 return bindScope(ctx,{apiVersion:1,actions:{
 'integration.release.create':async input=>createBarrier(primaryClient(),await settings(),input),
 'integration.release.inspect':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','barrier_id']);return refresh(primaryClient(),await settings(),scope(v),uuid(v.barrier_id));},
 'integration.release.evaluate':async input=>release(primaryClient(),await settings(),input),
 'integration.release.recover':async input=>recover(primaryClient(),await settings(),input)
 }});
}
