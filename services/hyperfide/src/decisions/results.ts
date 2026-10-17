import { FoundationError, object } from '../policy/programme.js';
import type { ComponentContext } from '../components/registry.js';
import { canonical, exact, fail, hash, integer, invokePrepared, prepare, record, route, strictJson, text } from './adapters.js';
import type { DecisionRequest, PreparedRequest, Question, RouteProfile, TransportResult } from './adapters.js';

export const PROBABILITY_TOLERANCE=1e-3;
export interface RevisionVector {
  spec_revision:string; repository_commits:Record<string,string>; graph_revision:string|null;
  contract_revisions:Record<string,string>; event_watermark:string; ownership_generation:string|null;
}
export interface DecisionIdentity {
  decision_id:string;packet_hash:string;purpose:string;rubric_version:string;revision:RevisionVector;
}
export interface ValidatedAnswer {
  type:Question['type'];value:unknown;raw_probabilities:Record<string,number>|null;
  normalized_probabilities:Record<string,number>|null;provider_confidence:number|null;
  confidence_semantics:string;derived:{decision_probability?:number;legacy_margin?:number;maximum_probability?:number;probability_sum?:number};
  normalization:{applied:boolean;original_sum:number}|null;raw:Record<string,unknown>;
}
export interface ResponseValidation {
  schema_version:1;route_id:string;requested_model:string;returned_model:string;
  answers:Record<string,ValidatedAnswer>;usage:Record<string,unknown>;response_hash:string;non_authoritative:true;
}
export interface ValidatedDecision extends ResponseValidation {
  identity:DecisionIdentity;status:'accepted_advice'|'abstained';abstention_reason:string|null;
  calibration_version:string|null;transport:Omit<TransportResult,'response'>;raw_response:Record<string,unknown>;authority:'advisory-only';
}
const attested=new WeakSet<object>();
function probability(value:unknown,label:string):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)fail('DECISION_INVALID_RESPONSE',label+' must be a finite probability');
  return value as number;
}
function sameKeys(value:Record<string,unknown>,expected:string[]):void{
  const actual=Object.keys(value).sort();
  if(canonical(actual)!==canonical([...expected].sort()))fail('DECISION_INVALID_RESPONSE','Question/option/legend inventory differs from request');
}
function distribution(value:unknown,keys:string[]):{raw:Record<string,number>;normalized:Record<string,number>;sum:number}{
  const map=record(value,'distribution');sameKeys(map,keys);
  const raw:Record<string,number>=Object.create(null)as Record<string,number>;let sum=0;
  for(const key of keys){raw[key]=probability(map[key],'option probability');sum+=raw[key]!;}
  if(Math.abs(sum-1)>PROBABILITY_TOLERANCE||sum<=0)fail('DECISION_INVALID_RESPONSE','Probability mass differs from one beyond tolerance');
  return {raw,normalized:Object.fromEntries(keys.map(key=>[key,raw[key]!/sum])),sum};
}
export function parseIdentity(input:unknown):DecisionIdentity {
  const value=record(input,'decision identity');
  exact(value,['decision_id','packet_hash','purpose','rubric_version','revision'],['decision_id','packet_hash','purpose','rubric_version','revision']);
  const packet_hash=text(value.packet_hash,'packet hash');
  if(!/^sha256:[0-9a-f]{64}$/.test(packet_hash))fail('DECISION_SCHEMA','Packet hash must be a content identity');
  const revision=record(value.revision,'revision');
  exact(revision,['spec_revision','repository_commits','graph_revision','contract_revisions','event_watermark','ownership_generation'],['spec_revision','repository_commits','graph_revision','contract_revisions','event_watermark','ownership_generation']);
  const repositories=record(revision.repository_commits,'repository revisions'),contracts=record(revision.contract_revisions,'contract revisions');
  for(const [key,v]of Object.entries(repositories)){text(key,'repository identity');if(!/^[0-9a-f]{40,64}$/.test(text(v,'commit')))fail('DECISION_SCHEMA','Repository revision must be an exact Git object');}
  for(const [key,v]of Object.entries(contracts)){text(key,'contract identity');text(v,'contract revision');}
  if(revision.graph_revision!==null)text(revision.graph_revision,'graph revision');
  if(revision.ownership_generation!==null&&!/^(?:0|[1-9][0-9]*)$/.test(text(revision.ownership_generation,'ownership generation')))fail('DECISION_SCHEMA','Generation must be a canonical integer string');
  return {decision_id:text(value.decision_id,'decision ID'),packet_hash,purpose:text(value.purpose,'purpose'),rubric_version:text(value.rubric_version,'rubric version'),
    revision:{spec_revision:text(revision.spec_revision,'spec revision'),repository_commits:repositories as Record<string,string>,graph_revision:revision.graph_revision as string|null,contract_revisions:contracts as Record<string,string>,event_watermark:text(revision.event_watermark,'event watermark'),ownership_generation:revision.ownership_generation as string|null}};
}
export function validateResponse(profile:RouteProfile,request:DecisionRequest,input:unknown):ResponseValidation {
  const response=record(input,'response');
  text(response.model,'returned model');
  const answers=record(response.answers,'answers');sameKeys(answers,Object.keys(request.questions));
  const usage=record(response.usage,'usage');
  integer(usage.input_tokens,'input tokens',0,Number.MAX_SAFE_INTEGER);integer(usage.output_tokens,'output tokens',0,Number.MAX_SAFE_INTEGER);
  const checked:Record<string,ValidatedAnswer>=Object.create(null)as Record<string,ValidatedAnswer>;
  for(const [id,q]of Object.entries(request.questions)){
    const answer=record(answers[id],'answer');
    if(answer.type!==q.type)fail('DECISION_INVALID_RESPONSE','Answer type does not match question');
    const base:ValidatedAnswer={type:q.type,value:null,raw_probabilities:null,normalized_probabilities:null,
      provider_confidence:null,confidence_semantics:'not-a-calibrated-outcome-estimate',derived:{},normalization:null,raw:JSON.parse(canonical(answer))as Record<string,unknown>};
    if(q.type==='noul'){
      exact(answer,['type','noul'],['type','noul']);const p=probability(answer.noul,'yes probability');
      base.value=p;base.confidence_semantics='yes-probability;derived-decision-probability-is-distinct-from-legacy-margin';
      base.derived={decision_probability:Math.max(p,1-p),legacy_margin:Math.abs(2*p-1)};
    }else if(q.type==='choice'||q.type==='score'){
      exact(answer,q.type==='choice'?['type','choice','probabilities','confidence']:['type','score','legend','probabilities','confidence'],
        q.type==='choice'?['type','choice','probabilities','confidence']:['type','score','legend','probabilities','confidence']);
      const keys=q.type==='choice'?Object.keys(record(q.criteria,'criteria')):(q.criteria as unknown[]).map((_,i)=>String(i));
      const d=distribution(answer.probabilities,keys);
      base.raw_probabilities=d.raw;base.normalized_probabilities=d.normalized;
      base.provider_confidence=probability(answer.confidence,'provider confidence');
      base.confidence_semantics='provider-distribution-concentration;not-calibrated-correctness';
      base.derived={maximum_probability:Math.max(...Object.values(d.normalized)),probability_sum:d.sum};
      base.normalization={applied:d.sum!==1,original_sum:d.sum};
      if(q.type==='choice'){
        const choice=text(answer.choice,'selected choice');
        if(!Object.hasOwn(d.raw,choice)||d.normalized[choice]!+PROBABILITY_TOLERANCE<Math.max(...Object.values(d.normalized)))
          fail('DECISION_INVALID_RESPONSE','Selected choice is not a requested maximum-probability option');
        base.value=choice;
      }else{
        const legend=record(answer.legend,'score legend');sameKeys(legend,keys);
        for(const key of keys)if(canonical(legend[key])!==canonical((q.criteria as unknown[])[Number(key)]))fail('DECISION_INVALID_RESPONSE','Score legend differs from ordered rubric');
        const expected=keys.reduce((sum,key)=>sum+Number(key)*d.normalized[key]!,0),score=answer.score;
        if(typeof score!=='number'||!Number.isFinite(score)||score<0||score>keys.length-1||Math.abs(score-expected)>PROBABILITY_TOLERANCE)
          fail('DECISION_INVALID_RESPONSE','Score differs from probability-weighted ordinal rubric');
        base.value=score;
      }
    }else if(q.type==='number'){
      exact(answer,['type','number','text','confidence'],['type','number','text','confidence']);
      if(!profile.native_number||(answer.number!==null&&(typeof answer.number!=='number'||!Number.isFinite(answer.number))))fail('DECISION_INVALID_RESPONSE','Invalid or unsupported Number answer');
      if(typeof answer.text!=='string'||Buffer.byteLength(answer.text)>1024)fail('DECISION_INVALID_RESPONSE','Number text exceeds local byte bound');
      base.value=answer.number;base.provider_confidence=probability(answer.confidence,'Number confidence');
      base.confidence_semantics='geometric-mean-answer-token-probability;not-correctness';
    }else{
      exact(answer,['type','box','confidence'],['type','box','confidence']);
      if(!profile.native_box)fail('DECISION_INVALID_RESPONSE','Box unsupported on route');
      const box=record(answer.box,'box');exact(box,['left','right','top','bottom'],['left','right','top','bottom']);
      const left=probability(box.left,'left'),right=probability(box.right,'right'),top=probability(box.top,'top'),bottom=probability(box.bottom,'bottom');
      if(left>=right||top>=bottom)fail('DECISION_INVALID_RESPONSE','Box edges must be ordered');
      base.value={left,right,top,bottom};base.provider_confidence=probability(answer.confidence,'Box confidence');
      base.confidence_semantics='provider-box-confidence;presence-unverified-not-a-positive-finding';
    }
    checked[id]=base;
  }
  return {schema_version:1,route_id:profile.id,requested_model:profile.model,returned_model:response.model as string,answers:checked,
    usage:JSON.parse(canonical(usage))as Record<string,unknown>,response_hash:hash(response),non_authoritative:true};
}
interface Calibration { version:string;purpose:string;route_id:string;returned_model:string;rubric_version:string;minimum_concentration:number;qualification_ref:string }
function calibration(env:Readonly<NodeJS.ProcessEnv>,identity:DecisionIdentity,transport:TransportResult):Calibration|null{
  if(!env.HYPERFIDE_DECISION_CALIBRATIONS)return null;
  const rows=strictJson(env.HYPERFIDE_DECISION_CALIBRATIONS);
  if(!Array.isArray(rows))fail('DECISION_SCHEMA','Calibration configuration must be a list');
  const matches=(rows as unknown[]).map(v=>record(v,'calibration')).filter(v=>v.purpose===identity.purpose&&v.route_id===transport.route_id&&v.returned_model===transport.returned_model&&v.rubric_version===identity.rubric_version);
  if(matches.length>1)fail('DECISION_SCHEMA','Ambiguous calibration');
  if(!matches.length)return null;
  const row=matches[0]!;
  exact(row,['version','purpose','route_id','returned_model','rubric_version','minimum_concentration','qualification_ref'],
    ['version','purpose','route_id','returned_model','rubric_version','minimum_concentration','qualification_ref']);
  for(const key of ['version','purpose','route_id','returned_model','rubric_version','qualification_ref'])text(row[key],key);
  probability(row.minimum_concentration,'calibrated concentration threshold');
  return row as unknown as Calibration;
}
export function assertValidatedDecision(value:unknown,expected:{decision_id:string;packet_hash:string}):asserts value is ValidatedDecision{
  if(!object(value)||!attested.has(value)||!object(value.identity)||value.identity.decision_id!==expected.decision_id||value.identity.packet_hash!==expected.packet_hash)
    throw new FoundationError('DECISION_UNTRUSTED','Decision must originate from validated trusted transport and match identity');
}
export async function evaluateDecision(input:{route_id:unknown;request:unknown;identity:unknown;timeout_ms:number},env:Readonly<NodeJS.ProcessEnv>,signal?:AbortSignal):Promise<ValidatedDecision>{
  return evaluatePreparedDecision(prepare(input.route_id,input.request),input.identity,env,{timeout_ms:input.timeout_ms,...(signal?{signal}:{})});
}
/** Internal capability preserves qualified media/reasoning; invokePrepared enforces private request provenance. */
export async function evaluatePreparedDecision(request:PreparedRequest,identityInput:unknown,env:Readonly<NodeJS.ProcessEnv>,options:{timeout_ms:number;signal?:AbortSignal}):Promise<ValidatedDecision>{
  const identity=parseIdentity(identityInput);
  const transport=await invokePrepared(request,env,options);
  const result=validateResponse(request.route,request.source_request,transport.response);
  const cal=calibration(env,identity,transport);
  let reason:string|null=cal===null?'missing-purpose-route-model-rubric-calibration':null;
  if(transport.qualification!=='live')reason='fixture-result-cannot-activate-live-advice';
  for(const answer of Object.values(result.answers)){
    if(answer.type==='number'&&answer.value===null)reason='number-unparseable';
    if(answer.type==='box')reason='box-presence-not-independently-established';
    const concentration=answer.derived.decision_probability??answer.derived.maximum_probability;
    if(cal&&concentration!==undefined&&concentration<cal.minimum_concentration)reason='below-calibrated-threshold';
  }
  const {response,...metadata}=transport;void response;
  const decision:ValidatedDecision={...result,identity,status:reason?'abstained':'accepted_advice',abstention_reason:reason,
    calibration_version:cal?.version??null,transport:metadata,raw_response:transport.response,authority:'advisory-only'};
  // Only actual transport evaluation is attested. Public validation previews are never capabilities.
  const freeze=(v:unknown):void=>{if(v!==null&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}};
  freeze(decision);attested.add(decision);return decision;
}
export function createComponent(ctx:ComponentContext):unknown{
 return {apiVersion:1,capabilities:{'decision.results.v1':Object.freeze({schemaVersion:1,parseIdentity,validateResponse,assertValidatedDecision,evaluatePreparedDecision:(request:PreparedRequest,identity:unknown,options:{timeout_ms:number;signal?:AbortSignal})=>evaluatePreparedDecision(request,identity,ctx.env,options),evaluateDecision:(input:Parameters<typeof evaluateDecision>[0])=>evaluateDecision(input,ctx.env,ctx.signal)})},actions:{
  'decision.result.validate':(input:unknown)=>{const v=record(input,'input');exact(v,['route_id','request','response'],['route_id','request','response']);const prepared=prepare(v.route_id,v.request);return {...validateResponse(route(v.route_id),prepared.source_request,v.response),status:'abstained',abstention_reason:'untrusted-response-preview',authority:'advisory-only'};},
  'decision.result.evaluate':(input:unknown)=>{const v=record(input,'input');exact(v,['route_id','request','identity','timeout_ms'],['route_id','request','identity','timeout_ms']);return evaluateDecision({route_id:v.route_id,request:v.request,identity:v.identity,timeout_ms:integer(v.timeout_ms,'deadline',1,30000)},ctx.env,ctx.signal);},
 }};
}
