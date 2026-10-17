import type { Component, ComponentContext } from '../components/registry.js';
import { attestation, canonical, digest, EvaluationStore, fail, fields, finite, hash, id, integer, list, strings, time, type Obj } from './datasets.js';
import { profile, type Profile, type Scorecard } from './scorecard.js';
import type { TrialReport } from './trials.js';

interface Thresholds { minimum_coverage:number; minimum_accuracy_lower:number; maximum_ece:number; maximum_risk:number; maximum_p95_ms:number; maximum_actual_cost_microusd:number }
interface Policy { version:string; purpose:string; profile:Profile; dataset_id:string; holdout_digest:string; thresholds:Thresholds; expires_at:string; required_cases:{route:string[];invariants:string[]} }
interface Gate { policy:Policy; scorecard_id:string; trial_report_id:string; eligible:boolean; reasons:string[]; mode:string; evidence_digests:string[]; valid_until:string }
function thresholds(v:unknown):Thresholds{
  const t=fields(v,['minimum_coverage','minimum_accuracy_lower','maximum_ece','maximum_risk','maximum_p95_ms','maximum_actual_cost_microusd']);
  return {minimum_coverage:finite(t.minimum_coverage,0,1),minimum_accuracy_lower:finite(t.minimum_accuracy_lower,0,1),
    maximum_ece:finite(t.maximum_ece,0,1),maximum_risk:finite(t.maximum_risk,0,1),
    maximum_p95_ms:finite(t.maximum_p95_ms,0,86400000),maximum_actual_cost_microusd:integer(t.maximum_actual_cost_microusd)};
}
function quality(score:Scorecard,p:Policy):string[]{
  const reasons:string[]=[],metrics=score.metrics[p.profile.id];
  if(score.evidence_class!=='live')reasons.push('non_live_scorecard');
  if(score.dataset_id!==p.dataset_id||score.holdout_digest!==p.holdout_digest||score.purpose!==p.purpose||score.split!=='holdout')reasons.push('wrong_dataset_purpose_or_split');
  if(!score.comparison_complete)reasons.push('candidate_comparison_incomplete');
  if(!score.profiles.some(v=>canonical(v)===canonical(p.profile)))reasons.push('profile_version_changed');
  if(!metrics)return [...reasons,'missing_profile_metrics'];
  if(metrics.unknown_labels!==0)reasons.push('unresolved_holdout_labels');
  const bound=p.thresholds;
  if(typeof metrics.coverage!=='number'||metrics.coverage<bound.minimum_coverage)reasons.push('coverage_unproven');
  if(!metrics.group_accuracy_interval||typeof (metrics.group_accuracy_interval as Obj).lower!=='number'||((metrics.group_accuracy_interval as Obj).lower as number)<bound.minimum_accuracy_lower)reasons.push('accuracy_unproven');
  if(typeof metrics.calibrated_ece!=='number'||metrics.calibration_coverage!==1||metrics.calibrated_ece>bound.maximum_ece||!score.calibration_ids[p.profile.id])reasons.push('calibration_missing_or_drifted');
  if(typeof metrics.selective_risk!=='number'||metrics.selective_risk>bound.maximum_risk)reasons.push('risk_exceeds_policy');
  if(!metrics.latency_ms||typeof (metrics.latency_ms as Obj).p95!=='number'||((metrics.latency_ms as Obj).p95 as number)>bound.maximum_p95_ms)reasons.push('latency_exceeds_policy');
  if(metrics.actual_usage_complete!==true||typeof metrics.actual_cost_microusd!=='number'||metrics.actual_cost_microusd>bound.maximum_actual_cost_microusd)reasons.push('actual_cost_unproven');
  return reasons;
}
function validQualification(context:ComponentContext,input:unknown,kind:string,profileDigest:string,requiredCases:string[]):{reasons:string[];expires_at:string}{
  const receipt=attestation(context,input,kind);
  const payload=fields(receipt.payload,['profile_digest','passed','expires_at','evidence_refs','qualification_scope','case_ids']);
  strings(payload.evidence_refs,1,1000);
  const cases=strings(payload.case_ids,1,56);
  if(cases.some(c=>!/^V-\d{3}$/.test(c))||!['full-case','campaign'].includes(String(payload.qualification_scope)))fail('Full-case/campaign qualification receipt required');
  const reasons:string[]=[];
  if(receipt.evidence_class!=='live')reasons.push(kind+':non_live');
  if(hash(payload.profile_digest)!==profileDigest)reasons.push(kind+':stale_profile');
  if(payload.passed!==true)reasons.push(kind+':not_passed');
  if(requiredCases.some(c=>!cases.includes(c)))reasons.push(kind+':required_case_missing');
  if(Date.parse(time(payload.expires_at))<Date.now())reasons.push(kind+':expired');
  return {reasons,expires_at:time(payload.expires_at)};
}
export async function assessPromotion(input:unknown,context:ComponentContext):Promise<Obj>{
  const r=fields(input,['policy','scorecard_id','trial_report_id','route_qualification','invariant_qualification','mode','selfhost_qualification']);
  if(!['hosted','self_hosted'].includes(String(r.mode)))fail('Unknown deployment mode');
  const approved=attestation(context,r.policy,'promotion_policy');
  const p=fields(approved.payload,['version','purpose','profile','dataset_id','holdout_digest','thresholds','expires_at','required_cases']);
  const required=fields(p.required_cases,['route','invariants']);
  const requiredCases={route:strings(required.route,1,56),invariants:strings(required.invariants,1,56)};
  if([...requiredCases.route,...requiredCases.invariants].some(c=>!/^V-\d{3}$/.test(c)))fail('Invalid required qualification case');
  const policy:Policy={version:id(p.version),purpose:id(p.purpose),profile:profile(p.profile),dataset_id:hash(p.dataset_id),
    holdout_digest:hash(p.holdout_digest),thresholds:thresholds(p.thresholds),expires_at:time(p.expires_at),required_cases:requiredCases};
  if(policy.profile.purpose!==policy.purpose)fail('Policy profile purpose mismatch');
  const store=new EvaluationStore(context),score=await store.get<Scorecard>(r.scorecard_id,'scorecard'),trial=await store.get<TrialReport>(r.trial_report_id,'trial_report');
  const reasons=quality(score,policy);
  if(approved.evidence_class!=='live')reasons.push('policy_not_live_approved');
  if(Date.parse(policy.expires_at)<Date.now())reasons.push('policy_expired');
  if(trial.scorecard_id!==r.scorecard_id||trial.dataset_id!==policy.dataset_id||trial.purpose!==policy.purpose||canonical(trial.candidate)!==canonical(policy.profile))reasons.push('trial_revision_mismatch');
  if(trial.mode!=='controlled'||!trial.complete||!trial.production_eligible||trial.evidence_class!=='live')reasons.push('controlled_live_trial_unproven');
  if(!trial.benefit_demonstrated||!trial.noninferiority_demonstrated||trial.stop_required)reasons.push('trial_benefit_or_noninferiority_unproven');
  const profileDigest=digest(policy.profile);
  const route=validQualification(context,r.route_qualification,'route_qualification',profileDigest,policy.required_cases.route);
  const invariant=validQualification(context,r.invariant_qualification,'invariant_qualification',profileDigest,policy.required_cases.invariants);
  reasons.push(...route.reasons,...invariant.reasons);
  const validity=[policy.expires_at,route.expires_at,invariant.expires_at];
  if(r.mode==='self_hosted'){
    const receipt=attestation(context,r.selfhost_qualification,'selfhost_qualification');
    const q=fields(receipt.payload,['profile_digest','gpu','license_evidence','engine_version','correctness','overload','restart','expires_at','evidence_refs']);
    id(q.gpu);hash(q.license_evidence);id(q.engine_version);strings(q.evidence_refs,1,1000);
    validity.push(time(q.expires_at));
    if(receipt.evidence_class!=='live'||hash(q.profile_digest)!==profileDigest||q.correctness!==true||q.overload!==true||q.restart!==true||Date.parse(time(q.expires_at))<Date.now())reasons.push('selfhost_capability_unqualified');
  }else if(r.selfhost_qualification!==null)fail('Hosted baseline does not consume optional GPU qualification');
  const gate:Gate={policy,scorecard_id:hash(r.scorecard_id),trial_report_id:hash(r.trial_report_id),eligible:reasons.length===0,
    reasons:[...new Set(reasons)],mode:String(r.mode),valid_until:new Date(Math.min(...validity.map(Date.parse))).toISOString(),
    evidence_digests:[approved.receipt_digest,digest(r.route_qualification),digest(r.invariant_qualification)]};
  const artifact_id=await store.put('promotion_gate',gate);
  return {artifact_id,...gate,grants_fleet_authority:false,action:gate.eligible?'eligible_for_separately_authorised_policy_activation':'remain_shadow',
    retained_workers:true,retained_evidence:true,deterministic_fallback:true};
}
export async function checkDrift(input:unknown,context:ComponentContext):Promise<Obj>{
  const r=fields(input,['gate_id','scorecard_id','current_profile']);
  const store=new EvaluationStore(context),gate=await store.get<Gate>(r.gate_id,'promotion_gate'),score=await store.get<Scorecard>(r.scorecard_id,'scorecard');
  const reasons=quality(score,gate.policy);
  if(!gate.eligible)reasons.push('original_gate_not_eligible');
  if(hash(r.scorecard_id)!==gate.scorecard_id)reasons.push('unapproved_scorecard_revision');
  if(Date.parse(gate.valid_until)<Date.now())reasons.push('required_qualification_expired');
  const current=profile(r.current_profile);
  if(canonical(current)!==canonical(gate.policy.profile))reasons.push('model_route_or_rubric_changed');
  if(Date.parse(gate.policy.expires_at)<Date.now())reasons.push('policy_expired');
  const drifted=reasons.length>0;
  // Drift never self-heals: name the holdout replay and full-case requalification the changed profile must pass before any re-promotion.
  const requalification=drifted?{profile:current,profile_digest:digest(current),approved_profile_digest:digest(gate.policy.profile),
    approved_scorecard_id:gate.scorecard_id,observed_scorecard_id:hash(r.scorecard_id),policy_version:gate.policy.version,purpose:gate.policy.purpose,
    replay:{dataset_id:gate.policy.dataset_id,holdout_digest:gate.policy.holdout_digest,split:'holdout'},
    required_cases:gate.policy.required_cases,next_action:'evaluation.promotion.assess'}:null;
  const result={gate_id:hash(r.gate_id),scorecard_id:hash(r.scorecard_id),policy_version:gate.policy.version,
    model_action_policy_enabled:!drifted,action:drifted?'disable_model_action_policy':'retain_qualified_policy',
    replay_required:drifted,requalification_required:drifted,requalification,
    reasons:[...new Set(reasons)],retain_existing_workers:true,retain_artifacts:true,alter_accepted_evidence:false,deterministic_core_continue:true};
  const artifact_id=await store.put('drift_gate',result);return {artifact_id,...result};
}
export function createComponent(_context:ComponentContext):Component{
  return {apiVersion:1,actions:{
    'evaluation.promotion.assess':assessPromotion,'evaluation.drift.check':checkDrift,
    'evaluation.selfhost.optional':async(input)=>{
      const r=fields(input,['requested']);
      if(typeof r.requested!=='boolean')fail('Explicit optional capability choice required');
      return {requested:r.requested,enabled:false,requires_separate_qualification:r.requested,hosted_baseline_blocked:false,
        replay_required_before_capability_change:r.requested,
        qualification_dimensions:r.requested?['remote_gpu','licence','engine','correctness','overload','restart']:[]};
    }
  }};
}
