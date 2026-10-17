import { createHash } from 'node:crypto';
import type { Component, ComponentContext } from '../components/registry.js';
import { attestation, canonical, digest, EvaluationStore, fail, fields, finite, hash, id, integer, list, strings, time, type Obj } from './datasets.js';
import { profile, wilson, type Profile, type Scorecard } from './scorecard.js';

export interface Trial {
  trial_id:string; mode:'shadow'|'controlled'; purpose:string; scorecard_id:string; dataset_id:string;
  baseline:Profile; candidate:Profile; seed:string; power_plan_digest:string;
  units:{unit_id:string;groups:string[];arm:'baseline'|'candidate'}[];
  primary:'qualified_per_hour'|'cost_per_qualified'; max_primary:number; minimum_benefit:number; defect_margin:number;
  minimum_units_per_arm:number; max_cost_microusd:number; max_attempts:number; max_duration_ms:number;
  starts_at:string; ends_at:string; approval_digest:string|null; evidence_class:'live'|'synthetic';
}
export interface TrialReport {
  trial_id:string; mode:string; purpose:string; scorecard_id:string; dataset_id:string; baseline:Profile; candidate:Profile;
  complete:boolean; count:number; per_arm:Record<string,Obj>; totals:{retries:number;qualified:number;qualified_per_hour:number|null;total_cost_microusd:number}; benefit_interval:{lower:number;upper:number}|null;
  defect_difference_upper:number|null; benefit_demonstrated:boolean; noninferiority_demonstrated:boolean;
  stop_required:boolean; stop_reasons:string[]; evidence_class:string; production_eligible:boolean; evidence_digest:string;
}
export async function createTrial(input:unknown,context:ComponentContext):Promise<Obj>{
  const r=fields(input,['plan','approval']);
  const p=fields(r.plan,['trial_id','mode','purpose','scorecard_id','baseline','candidate','seed','units','primary','max_primary','minimum_benefit','defect_margin','minimum_units_per_arm','max_cost_microusd','max_attempts','max_duration_ms','starts_at','ends_at','power_plan_digest']);
  if(!['shadow','controlled'].includes(String(p.mode))||!['qualified_per_hour','cost_per_qualified'].includes(String(p.primary)))fail('Unsupported trial mode/outcome');
  const store=new EvaluationStore(context),scorecard=await store.get<Scorecard>(p.scorecard_id,'scorecard');
  if(scorecard.split!=='holdout'||!scorecard.comparison_complete||scorecard.purpose!==p.purpose)fail('Frozen complete held-out comparison required');
  const baseline=profile(p.baseline),candidate=profile(p.candidate);
  if(baseline.id===candidate.id||baseline.id!==scorecard.baseline_profile||
     !scorecard.profiles.some(v=>canonical(v)===canonical(baseline))||!scorecard.profiles.some(v=>canonical(v)===canonical(candidate)))fail('Trial profiles differ from held-out comparison');
  const units=list(p.units,2,10000).map(v=>{const u=fields(v,['unit_id','groups']);return {unit_id:id(u.unit_id),groups:strings(u.groups,1,1000)};});
  if(new Set(units.map(u=>u.unit_id)).size!==units.length)fail('Duplicate trial unit');
  const groups=units.flatMap(u=>u.groups);if(new Set(groups).size!==groups.length)fail('Interfering groups cannot be split across units');
  const seed=id(p.seed);
  units.sort((a,b)=>createHash('sha256').update(canonical([seed,a.unit_id])).digest('hex').localeCompare(createHash('sha256').update(canonical([seed,b.unit_id])).digest('hex')));
  const start=time(p.starts_at),end=time(p.ends_at);
  if(Date.parse(end)<=Date.parse(start))fail('Invalid trial time window');
  const minimum=integer(p.minimum_units_per_arm,1,5000);
  if(Math.floor(units.length/2)<minimum)fail('Insufficient predeclared units');
  const limit=finite(p.max_primary,Number.MIN_VALUE,1e12),benefit=finite(p.minimum_benefit,0,limit);
  let approvalDigest:string|null=null,evidenceClass:'live'|'synthetic'='synthetic';
  if(p.mode==='controlled'){
    const approved=attestation(context,r.approval,'trial_approval');
    const a=fields(approved.payload,['plan_digest','expires_at','independence_evidence','approved_by']);
    if(hash(a.plan_digest)!==digest(p)||Date.parse(time(a.expires_at))<Date.now()||Date.parse(end)>Date.parse(time(a.expires_at)))fail('Missing/stale exact-plan trial approval');
    if(approved.evidence_class==='live'&&Date.parse(approved.observed_at)>Date.parse(start))fail('Live trial must be approved before its first assigned unit starts');
    hash(a.independence_evidence);id(a.approved_by);
    approvalDigest=approved.receipt_digest;
    evidenceClass=approved.evidence_class==='live'&&scorecard.evidence_class==='live'?'live':'synthetic';
  }else if(r.approval!==null)fail('Shadow trials do not consume action-changing approval');
  const trial:Trial={trial_id:id(p.trial_id),mode:p.mode as Trial['mode'],purpose:id(p.purpose),scorecard_id:hash(p.scorecard_id),dataset_id:scorecard.dataset_id,
    baseline,candidate,seed,power_plan_digest:hash(p.power_plan_digest),units:units.map((u,i)=>({...u,arm:p.mode==='shadow'?'baseline':i%2===0?'baseline':'candidate'})),
    primary:p.primary as Trial['primary'],max_primary:limit,minimum_benefit:benefit,defect_margin:finite(p.defect_margin,0,1),
    minimum_units_per_arm:minimum,max_cost_microusd:integer(p.max_cost_microusd,1),max_attempts:integer(p.max_attempts,1),
    max_duration_ms:integer(p.max_duration_ms,1,30*86400000),starts_at:start,ends_at:end,approval_digest:approvalDigest,evidence_class:evidenceClass};
  const artifact_id=await store.put('trial',trial);
  return {artifact_id,...trial,action_authority:'NONE; assignment is advice within separately enforced run policy',shadow_changes_actions:false};
}
export async function reportTrial(input:unknown,context:ComponentContext):Promise<Obj>{
  const r=fields(input,['trial_id','observations']),store=new EvaluationStore(context),trial=await store.get<Trial>(r.trial_id,'trial');
  const seen=new Set<string>(),arms:Record<string,{primary:number[];defect_rates:number[];qualified:number;defects:number;cost:number;attempts:number;retries:number;duration:number}>={
    baseline:{primary:[],defect_rates:[],qualified:0,defects:0,cost:0,attempts:0,retries:0,duration:0},candidate:{primary:[],defect_rates:[],qualified:0,defects:0,cost:0,attempts:0,retries:0,duration:0}};
  const stop:string[]=[],proofs:string[]=[];let live=trial.evidence_class==='live';
  for(const value of list(r.observations,1,10000)){
    const receipt=attestation(context,value,'trial_observation'),o=fields(receipt.payload,['trial_digest','unit_id','arm','qualified','escaped_defects','attempts','cost_microusd','duration_ms','invariant_violations','started_at','ended_at','outcome_evidence','cost_breakdown']);
    const unit=trial.units.find(u=>u.unit_id===id(o.unit_id));
    if(hash(o.trial_digest)!==r.trial_id||!unit||o.arm!==unit.arm||seen.has(unit.unit_id))fail('Unknown/duplicate/cross-arm trial observation');
    seen.add(unit.unit_id);proofs.push(receipt.receipt_digest);live&&=receipt.evidence_class==='live';
    const start=time(o.started_at),end=time(o.ended_at);
    if(Date.parse(start)<Date.parse(trial.starts_at)||Date.parse(end)>Date.parse(trial.ends_at)||Date.parse(end)<Date.parse(start)||Date.parse(end)>Date.parse(receipt.observed_at))fail('Observation outside approved time window');
    const duration=integer(o.duration_ms,1,trial.max_duration_ms),qualified=integer(o.qualified),defects=integer(o.escaped_defects,0,qualified);
    if(duration!==Date.parse(end)-Date.parse(start))fail('Observed duration differs from timestamps');
    const cost=integer(o.cost_microusd),attempts=integer(o.attempts,1),violations=integer(o.invariant_violations);
    const costs=fields(o.cost_breakdown,['sandbox','frontier','decisions','packet_build']);
    const total=Object.values(costs).reduce<number>((sum,value)=>sum+integer(value),0);
    if(!Number.isSafeInteger(total)||total!==cost)fail('Full outcome cost breakdown is incomplete/inconsistent');
    strings(o.outcome_evidence,1,1000);
    if(violations)stop.push('invariant_violation:'+unit.unit_id);
    const primary=trial.primary==='qualified_per_hour'?qualified*3600000/duration:qualified?cost/qualified:null;
    if(primary===null)stop.push('no_qualified_outcome:'+unit.unit_id);
    else if(primary>trial.max_primary)stop.push('outcome_outside_predeclared_bound:'+unit.unit_id);
    const arm=arms[unit.arm]!;if(primary!==null&&primary<=trial.max_primary)arm.primary.push(primary);
    if(qualified)arm.defect_rates.push(defects/qualified);
    arm.qualified+=qualified;arm.defects+=defects;arm.cost+=cost;arm.attempts+=attempts;arm.retries+=attempts-1;arm.duration+=duration;
    for(const number of [arm.qualified,arm.defects,arm.cost,arm.attempts,arm.retries,arm.duration])integer(number);
  }
  if(arms.baseline!.cost+arms.candidate!.cost>trial.max_cost_microusd)stop.push('cost_budget_exceeded');
  if(arms.baseline!.attempts+arms.candidate!.attempts>trial.max_attempts)stop.push('attempt_budget_exceeded');
  const baseline=arms.baseline!,candidate=arms.candidate!,complete=seen.size===trial.units.length;
  const enough=baseline.primary.length>=trial.minimum_units_per_arm&&candidate.primary.length>=trial.minimum_units_per_arm;
  let benefitInterval:TrialReport['benefit_interval']=null,defectUpper:number|null=null;
  const mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
  if(enough){
    const change=trial.primary==='qualified_per_hour'?mean(candidate.primary)-mean(baseline.primary):mean(baseline.primary)-mean(candidate.primary);
    // Distribution-free bounded-unit intervals; no false precision for tiny trials.
    const width=trial.max_primary*(Math.sqrt(Math.log(4/.05)/(2*baseline.primary.length))+Math.sqrt(Math.log(4/.05)/(2*candidate.primary.length)));
    benefitInterval={lower:change-width,upper:change+width};
    if(baseline.defect_rates.length===baseline.primary.length&&candidate.defect_rates.length===candidate.primary.length){
      const defectWidth=Math.sqrt(Math.log(4/.05)/(2*baseline.defect_rates.length))+Math.sqrt(Math.log(4/.05)/(2*candidate.defect_rates.length));
      defectUpper=Math.min(1,mean(candidate.defect_rates)-mean(baseline.defect_rates)+defectWidth);
    }
  }
  const eligible=complete&&enough&&stop.length===0&&trial.mode==='controlled'&&live;
  const report:TrialReport={trial_id:hash(r.trial_id),mode:trial.mode,purpose:trial.purpose,scorecard_id:trial.scorecard_id,dataset_id:trial.dataset_id,
    baseline:trial.baseline,candidate:trial.candidate,complete,count:seen.size,
    totals:{retries:baseline.retries+candidate.retries,qualified:baseline.qualified+candidate.qualified,
      qualified_per_hour:baseline.duration+candidate.duration?(baseline.qualified+candidate.qualified)*3600000/(baseline.duration+candidate.duration):null,
      total_cost_microusd:baseline.cost+candidate.cost},
    per_arm:Object.fromEntries(Object.entries(arms).map(([k,v])=>[k,{units:v.primary.length,qualified:v.qualified,escaped_defects:v.defects,
      actual_cost_microusd:v.cost,attempts:v.attempts,retries:v.retries,duration_ms:v.duration,
      qualified_per_hour:v.duration?v.qualified*3600000/v.duration:null,mean_primary:v.primary.length?mean(v.primary):null,
      cost_per_qualified:v.qualified?v.cost/v.qualified:null,defect_interval:wilson(v.defects,v.qualified)}])),
    benefit_interval:benefitInterval,defect_difference_upper:defectUpper,
    benefit_demonstrated:eligible&&benefitInterval!==null&&benefitInterval.lower>=trial.minimum_benefit,
    noninferiority_demonstrated:eligible&&defectUpper!==null&&defectUpper<=trial.defect_margin,
    stop_required:stop.length>0,stop_reasons:stop,evidence_class:live?'live':'synthetic',
    production_eligible:eligible&&benefitInterval!==null&&benefitInterval.lower>=trial.minimum_benefit&&defectUpper!==null&&defectUpper<=trial.defect_margin,evidence_digest:digest(proofs.sort())};
  const artifact_id=await store.put('trial_report',report);
  return {artifact_id,...report,interval_method:'95% bounded independent-unit Hoeffding differences for primary and defect outcomes; case-level Wilson intervals are diagnostic',
    counterfactual_claim:false,shadow_cannot_prove_live_benefit:trial.mode==='shadow',
    // Shadow agreement is collected without action; only a complete live controlled trial can speak to scheduling effects.
    effect_basis:trial.mode==='shadow'?'shadow_observation_only':eligible?'controlled_live_trial':'insufficient_for_effect_claim'};
}
export function createComponent(_context:ComponentContext):Component {
  return {apiVersion:1,actions:{'evaluation.trial.create':createTrial,'evaluation.trial.report':reportTrial}};
}
