import type { Component, ComponentContext } from '../components/registry.js';
import { attestation, canonical, digest, EvaluationStore, fail, fields, finite, hash, id, integer, list, type Dataset, type DatasetRow, type EvidenceClass, type Obj } from './datasets.js';

export interface Profile { id:string; model:string; route:string; purpose:string; rubric:string }
export interface Prediction { case_id:string; profile_id:string; probabilities:Record<string,number>|null; decision:string|null; status:'ok'|'abstained'|'error'; latency_ms:number; attempts:number; input_tokens:number|null; cost_microusd:number|null; usage_class:'actual'|'estimated'|'unknown'; evidence_class:EvidenceClass; receipt_digest:string }
export interface Calibration { dataset_id:string; holdout_digest:string; profile:Profile; bins:{count:number;correct:number;calibrated:number|null}[]; fitted_split:'calibration'; evidence_class:string; evidence_digest:string }
export function profile(value:unknown):Profile {
  const p=fields(value,['id','model','route','purpose','rubric']);
  return {id:id(p.id),model:id(p.model),route:id(p.route),purpose:id(p.purpose),rubric:hash(p.rubric)};
}
export function wilson(successes:number,total:number):{lower:number;upper:number}|null {
  if(!total)return null;
  const z=1.959963984540054,p=successes/total,denom=1+z*z/total,center=(p+z*z/(2*total))/denom;
  const radius=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/denom;
  return {lower:Math.max(0,center-radius),upper:Math.min(1,center+radius)};
}
function safeSum(values:number[]):number { const total=values.reduce((a,b)=>a+b,0);return integer(total); }
function quantile(values:number[],q:number):number|null {
  if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(q*sorted.length)-1)]!;
}
export function parsePredictions(context:ComponentContext,values:unknown,rows:DatasetRow[],profiles:Profile[]):Prediction[] {
  const selected=new Map(rows.map(r=>[r.packet.case_id,r])), owners=new Map(profiles.map(p=>[p.id,p]));
  const seen=new Set<string>(),result:Prediction[]=[];
  for(const value of list(values,1,100000)){
    const receipt=attestation(context,value,'prediction_observation');
    const p=fields(receipt.payload,['case_id','packet_digest','profile','probabilities','decision','status','latency_ms','attempts','input_tokens','cost_microusd','usage_class']);
    const caseID=id(p.case_id),row=selected.get(caseID),actualProfile=profile(p.profile),expected=owners.get(actualProfile.id);
    if(!row||!expected||canonical(actualProfile)!==canonical(expected)||hash(p.packet_digest)!==row.packet_digest)fail('Prediction is outside the exact case/profile revision');
    const key=caseID+':'+actualProfile.id;if(seen.has(key))fail('Duplicate case/profile prediction');seen.add(key);
    if(!['ok','abstained','error'].includes(String(p.status)))fail('Invalid prediction status');
    let probabilities:Record<string,number>|null=null;
    if(p.probabilities!==null){
      const raw=fields(p.probabilities,row.packet.choices),entries=Object.entries(raw).map(([k,v])=>[k,finite(v,0,1)]as const);
      if(Math.abs(entries.reduce((n,[,v])=>n+v,0)-1)>1e-9)fail('Probability mass does not sum to one');
      probabilities=Object.fromEntries(entries);
    }
    const decision=p.decision===null?null:id(p.decision);
    if(decision!==null&&!row.packet.choices.includes(decision))fail('Decision outside choice set');
    if(p.status==='ok'&&(decision===null||probabilities===null)||p.status!=='ok'&&decision!==null)fail('Prediction status/value mismatch');
    if(!['actual','estimated','unknown'].includes(String(p.usage_class)))fail('Invalid usage provenance');
    const tokens=p.input_tokens===null?null:integer(p.input_tokens),cost=p.cost_microusd===null?null:integer(p.cost_microusd);
    if(p.usage_class==='actual'&&(tokens===null||cost===null))fail('Actual usage must be complete');
    if(receipt.key===row.label_key)fail('Prediction producer is not an independent label authority');
    result.push({case_id:caseID,profile_id:actualProfile.id,probabilities,decision,status:p.status as Prediction['status'],
      latency_ms:finite(p.latency_ms,0,86400000),attempts:integer(p.attempts,1,1000),input_tokens:tokens,cost_microusd:cost,
      usage_class:p.usage_class as Prediction['usage_class'],evidence_class:receipt.evidence_class,receipt_digest:receipt.receipt_digest});
  }
  if(seen.size!==rows.length*profiles.length)fail('Missing case/profile predictions; coverage cannot silently shrink');
  return result;
}
export async function calibrate(input:unknown,context:ComponentContext):Promise<Obj>{
  const r=fields(input,['dataset_id','profile','predictions']);
  const store=new EvaluationStore(context),dataset=await store.get<Dataset>(r.dataset_id,'dataset'),p=profile(r.profile);
  if(p.purpose!==dataset.purpose)fail('Calibration purpose mismatch');
  const rows=dataset.rows.filter(v=>v.split==='calibration'),predictions=parsePredictions(context,r.predictions,rows,[p]);
  const bins=Array.from({length:10},()=>({count:0,correct:0,calibrated:null as number|null}));
  for(const prediction of predictions){
    const row=rows.find(v=>v.packet.case_id===prediction.case_id)!;
    if(row.target===null||prediction.status!=='ok')continue;
    const confidence=prediction.probabilities![prediction.decision!]!,bin=bins[Math.min(9,Math.floor(confidence*10))]!;
    bin.count++;bin.correct+=Number(prediction.decision===row.target);
  }
  if(!bins.some(b=>b.count))fail('No independently labelled calibration decisions');
  for(const bin of bins)bin.calibrated=bin.count?bin.correct/bin.count:null;
  const result:Calibration={dataset_id:hash(r.dataset_id),holdout_digest:dataset.holdout_digest,profile:p,bins,
    fitted_split:'calibration',evidence_class:dataset.evidence_class==='live'&&predictions.every(v=>v.evidence_class==='live')?'live':'synthetic',
    evidence_digest:digest(predictions.map(v=>v.receipt_digest).sort())};
  const artifact_id=await store.put('calibration',result);
  return {artifact_id,...result,meaning:'empirical correctness of selected choice; not provider concentration or a full calibrated distribution',live_performance_claim:false};
}
export interface Scorecard {
  dataset_id:string; holdout_digest:string; split:string; purpose:string; baseline_profile:string; profiles:Profile[];
  metrics:Record<string,Obj>; strata:Record<string,Record<string,Obj>>; comparisons:Record<string,Obj>;
  evidence_class:string; comparison_complete:boolean; missing_candidates:string[]; evidence_digest:string; calibration_ids:Record<string,string>;
}
function metrics(rows:DatasetRow[],predictions:Prediction[],calibration:Calibration|null):Obj{
  const byCase=new Map(rows.map(r=>[r.packet.case_id,r])),labels=rows.filter(r=>r.target!==null);
  const answered=predictions.filter(p=>p.status==='ok'&&byCase.get(p.case_id)!.target!==null);
  let correct=0,brier=0,ece=0,calibratedEce=0,calibratedCount=0;
  const bins=Array.from({length:10},()=>({count:0,correct:0,confidence_sum:0,calibrated_sum:0,calibrated_count:0}));
  const confusion:Record<string,{tp:number;fp:number;fn:number;precision_interval:unknown;recall_interval:unknown}>={};
  for(const row of rows)for(const choice of row.packet.choices)confusion[choice]??={tp:0,fp:0,fn:0,precision_interval:null,recall_interval:null};
  for(const p of answered){
    const row=byCase.get(p.case_id)!,right=p.decision===row.target;correct+=Number(right);
    for(const choice of row.packet.choices){
      const error=p.probabilities![choice]!-Number(choice===row.target);brier+=error*error;
      const count=confusion[choice]!;
      if(p.decision===choice&&row.target===choice)count.tp++;
      else if(p.decision===choice)count.fp++;
      else if(row.target===choice)count.fn++;
    }
    const confidence=p.probabilities![p.decision!]!,index=Math.min(9,Math.floor(confidence*10)),bin=bins[index]!;
    bin.count++;bin.correct+=Number(right);bin.confidence_sum+=confidence;
    const fitted=calibration?.bins[index]?.calibrated;
    if(typeof fitted==='number'){bin.calibrated_sum+=fitted;bin.calibrated_count++;calibratedCount++;}
  }
  for(const bin of bins){
    if(bin.count)ece+=bin.count*Math.abs(bin.correct/bin.count-bin.confidence_sum/bin.count);
    if(bin.calibrated_count===bin.count&&bin.count)calibratedEce+=bin.count*Math.abs(bin.correct/bin.count-bin.calibrated_sum/bin.count);
  }
  for(const p of predictions){const row=byCase.get(p.case_id)!;if(row.target!==null&&p.status!=='ok')confusion[row.target]!.fn++;}
  const groupCounts=new Map<string,number>();
  for(const p of answered){const group=byCase.get(p.case_id)!.group_id;groupCounts.set(group,(groupCounts.get(group)??0)+1);}
  const groupRadius=answered.length?Math.sqrt(Math.log(2/.05)/2*[...groupCounts.values()].reduce((sum,n)=>sum+(n/answered.length)**2,0)):null;
  const groupAccuracy=groupRadius===null?null:{lower:Math.max(0,correct/answered.length-groupRadius),upper:Math.min(1,correct/answered.length+groupRadius)};
  for(const entry of Object.values(confusion)){entry.precision_interval=wilson(entry.tp,entry.tp+entry.fp);entry.recall_interval=wilson(entry.tp,entry.tp+entry.fn);}
  const actual=predictions.filter(p=>p.usage_class==='actual'),estimated=predictions.filter(p=>p.usage_class==='estimated');
  const completeActual=actual.length===predictions.length;
  return {count:rows.length,labelled:labels.length,unknown_labels:rows.length-labels.length,answered:answered.length,correct,
    coverage:labels.length?answered.length/labels.length:null,coverage_interval:wilson(answered.length,labels.length),
    accuracy:answered.length?correct/answered.length:null,accuracy_interval:wilson(correct,answered.length),
    independent_answered_groups:groupCounts.size,group_accuracy_interval:groupAccuracy,
    selective_risk:answered.length?1-correct/answered.length:null,
    brier_multiclass:answered.length?brier/answered.length:null,ece:answered.length?ece/answered.length:null,
    calibrated_ece:answered.length&&calibratedCount===answered.length?calibratedEce/answered.length:null,
    calibration_coverage:answered.length?calibratedCount/answered.length:null,calibration_bins:bins,confusion,
    latency_ms:{p50:quantile(predictions.map(p=>p.latency_ms),.5),p95:quantile(predictions.map(p=>p.latency_ms),.95),p99:quantile(predictions.map(p=>p.latency_ms),.99)},
    errors:predictions.filter(p=>p.status==='error').length,
    error_rate:predictions.length?predictions.filter(p=>p.status==='error').length/predictions.length:null,
    error_rate_interval:wilson(predictions.filter(p=>p.status==='error').length,predictions.length),abstained:predictions.filter(p=>p.status==='abstained').length,
    attempts:safeSum(predictions.map(p=>p.attempts)),actual_usage_complete:completeActual,
    actual_cost_microusd:completeActual?safeSum(actual.map(p=>p.cost_microusd!)):null,
    known_actual_cost_microusd:safeSum(actual.map(p=>p.cost_microusd!)),
    estimated_cost_microusd:estimated.some(p=>p.cost_microusd===null)?null:safeSum(estimated.map(p=>p.cost_microusd!)),
    known_estimated_cost_microusd:safeSum(estimated.filter(p=>p.cost_microusd!==null).map(p=>p.cost_microusd!)),
    actual_input_tokens:completeActual?safeSum(actual.map(p=>p.input_tokens!)):null,
    packet_build_cost_microusd:null,cost_scope:'Reported model transport attempts only; total outcome cost requires the trial cost breakdown',
    cost_per_qualified_outcome:null,cost_per_qualified_outcome_reason:'Requires controlled live trial outcomes; replay correctness is not integration qualification'};
}
export async function score(input:unknown,context:ComponentContext):Promise<Obj>{
  const r=fields(input,['dataset_id','split','profiles','baseline_profile','predictions','calibration_ids']);
  if(!['calibration','holdout'].includes(String(r.split)))fail('Only calibration/holdout scoring is registered');
  const store=new EvaluationStore(context),dataset=await store.get<Dataset>(r.dataset_id,'dataset');
  const profiles=list(r.profiles,2,32).map(profile),ids=profiles.map(p=>p.id);
  if(new Set(ids).size!==ids.length||profiles.some(p=>p.purpose!==dataset.purpose))fail('Duplicate or cross-purpose profiles');
  const baseline=id(r.baseline_profile);if(!ids.includes(baseline))fail('Declared current-policy baseline required');
  const calibrationIDs=fields(r.calibration_ids,[],ids);
  const calibrations=new Map<string,Calibration>();
  for(const [profileID,identity]of Object.entries(calibrationIDs)){
    const c=await store.get<Calibration>(identity,'calibration'),p=profiles.find(v=>v.id===profileID)!;
    if(c.dataset_id!==r.dataset_id||c.holdout_digest!==dataset.holdout_digest||canonical(c.profile)!==canonical(p)||c.fitted_split!=='calibration')fail('Stale/cross-profile calibration');
    calibrations.set(profileID,c);
  }
  const rows=dataset.rows.filter(v=>v.split===r.split),predictions=parsePredictions(context,r.predictions,rows,profiles);
  const resultMetrics:Record<string,Obj>={},strata:Record<string,Record<string,Obj>>={};
  for(const p of profiles){
    const selected=predictions.filter(v=>v.profile_id===p.id),c=calibrations.get(p.id)??null;
    resultMetrics[p.id]=metrics(rows,selected,c);strata[p.id]={};
    const subsets=new Map<string,DatasetRow[]>();
    for(const row of rows){
      const tags=['language:'+row.packet.language,'task_family:'+row.packet.task_family,'options:'+row.packet.choices.length,'context:'+(row.packet.context_tokens<=4096?'small':row.packet.context_tokens<=32768?'medium':'large')];
      for(const tag of tags)subsets.set(tag,[...(subsets.get(tag)??[]),row]);
    }
    for(const[tag,subset]of subsets){const names=new Set(subset.map(v=>v.packet.case_id));strata[p.id]![tag]=metrics(subset,selected.filter(v=>names.has(v.case_id)),c);}
  }
  const comparisons:Record<string,Obj>={},labelled=rows.filter(r=>r.target!==null);
  const predictionMap=new Map(predictions.map(p=>[p.case_id+':'+p.profile_id,p]));
  for(const p of profiles.filter(v=>v.id!==baseline)){
    const weights=new Map<string,number>();let delta=0;
    for(const row of labelled){
      const base=predictionMap.get(row.packet.case_id+':'+baseline)!,candidate=predictionMap.get(row.packet.case_id+':'+p.id)!;
      delta+=Number(candidate.status==='ok'&&candidate.decision===row.target)-Number(base.status==='ok'&&base.decision===row.target);
      weights.set(row.group_id,(weights.get(row.group_id)??0)+1);
    }
    const mean=labelled.length?delta/labelled.length:null;
    const radius=labelled.length?Math.sqrt(2*Math.log(2/.05)*[...weights.values()].reduce((sum,n)=>sum+(n/labelled.length)**2,0)):null;
    const base=resultMetrics[baseline]!,candidate=resultMetrics[p.id]!;
    comparisons[p.id]={baseline_profile:baseline,paired_labelled_cases:labelled.length,independent_groups:weights.size,
      labelled_correctness_delta:mean,delta_interval:mean===null||radius===null?null:{lower:Math.max(-1,mean-radius),upper:Math.min(1,mean+radius)},
      interval_method:'95% paired independent-group Hoeffding bound; nonanswers count as incorrect',
      actual_transport_cost_delta_microusd:typeof base.actual_cost_microusd==='number'&&typeof candidate.actual_cost_microusd==='number'?candidate.actual_cost_microusd-base.actual_cost_microusd:null,
      causal_or_qualified_outcome_claim:false};
  }
  const required=['respan/span-02','typesafe/jev-1.14','liquid/d1-ultra'],missing=required.filter(m=>!profiles.some(p=>p.model===m));
  const result:Scorecard={dataset_id:hash(r.dataset_id),holdout_digest:dataset.holdout_digest,split:String(r.split),purpose:dataset.purpose,
    baseline_profile:baseline,profiles,metrics:resultMetrics,strata,comparisons,evidence_class:dataset.evidence_class==='live'&&predictions.every(v=>v.evidence_class==='live')&&[...calibrations.values()].every(c=>c.evidence_class==='live')?'live':'synthetic',
    comparison_complete:missing.length===0,missing_candidates:missing,evidence_digest:digest(predictions.map(v=>v.receipt_digest).sort()),
    calibration_ids:Object.fromEntries(Object.entries(calibrationIDs).map(([k,v])=>[k,hash(v)]))};
  const artifact_id=await store.put('scorecard',result);
  return {artifact_id,...result,interval_method:'Wilson case-level diagnostics plus conservative weighted independent-group Hoeffding accuracy bounds',live_performance_claim:false};
}
export function createComponent(_context:ComponentContext):Component {
  return {apiVersion:1,actions:{'evaluation.calibrate':calibrate,'evaluation.scorecard':score}};
}
