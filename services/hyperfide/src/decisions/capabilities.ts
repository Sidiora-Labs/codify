import { createHash } from 'node:crypto';
import type { ComponentContext } from '../components/registry.js';
import { canonical, exact, fail, integer, prepare, record, route, strictJson, text, type PreparedRequest, type QuestionType, type RouteId } from './adapters.js';

const MIB=1024*1024;
interface CapabilityProfile {
  qualification_ref:string; mode:'fixture'|'live'; extensions:QuestionType[];
  images:boolean; image_token_reserve:number; max_images:number; max_image_bytes:number; max_request_bytes:number; max_question_bytes:number;
  context_request_tokens:number; context_question_tokens:number; tokenizer_ref:string;
  billing:'unknown'|'repeated-state'|'shared-batch'; price_input_per_million:number|null; price_output_per_million:number|null;
}
export interface Media { id:string; data_uri:string }
export interface CapabilityRequest {
  route_id:RouteId; request:unknown; media?:Media[]; reasoning?:{mode:'off'|'on'|'auto';budget_ms?:number};
  timeout_ms:number; long_context?:boolean;
}
function profileFor(id:RouteId,env:Readonly<NodeJS.ProcessEnv>):CapabilityProfile {
  const configs=env.HYPERFIDE_DECISION_CAPABILITY_PROFILES?record(strictJson(env.HYPERFIDE_DECISION_CAPABILITY_PROFILES),'capability profiles'):{};
  const p=record(configs[id],'qualified bounded capability profile');
  exact(p,['qualification_ref','mode','extensions','images','image_token_reserve','max_images','max_image_bytes','max_request_bytes','max_question_bytes',
    'context_request_tokens','context_question_tokens','tokenizer_ref','billing','price_input_per_million','price_output_per_million'],
    ['qualification_ref','mode','extensions','images','image_token_reserve','max_images','max_image_bytes','max_request_bytes','max_question_bytes',
    'context_request_tokens','context_question_tokens','tokenizer_ref','billing','price_input_per_million','price_output_per_million']);
  text(p.qualification_ref,'qualification reference');text(p.tokenizer_ref,'tokenizer qualification reference');
  if(!['fixture','live'].includes(String(p.mode)) || !Array.isArray(p.extensions) ||
     p.extensions.some(v=>!['number','box'].includes(String(v))) || typeof p.images!=='boolean' ||
     !['unknown','repeated-state','shared-batch'].includes(String(p.billing)))fail('DECISION_SCHEMA','Invalid capability profile');
  integer(p.image_token_reserve,'qualified image token reserve',0,262144);if(p.images&&p.image_token_reserve===0)fail('DECISION_SCHEMA','Enabled media requires a qualified token reserve');
  integer(p.max_images,'image count',0,4);integer(p.max_image_bytes,'image bytes',1,16*MIB);
  integer(p.max_request_bytes,'request byte budget',1,8*MIB);integer(p.max_question_bytes,'question byte budget',1,8*MIB);
  integer(p.context_request_tokens,'qualified request context',1,262144);integer(p.context_question_tokens,'qualified question context',1,262144);
  for(const key of ['price_input_per_million','price_output_per_million'])
    if(p[key]!==null && (typeof p[key]!=='number'||!Number.isFinite(p[key])||(p[key] as number)<0))fail('DECISION_SCHEMA','Price must be known nonnegative or null');
  if(id==='ultra-native' && p.billing!=='repeated-state')fail('DECISION_SCHEMA','Ultra native billing repeats shared input per question');
  if(id==='span-selfhost' && p.billing!=='repeated-state')fail('DECISION_SCHEMA','Span engine billing repeats shared input per question');
  return p as unknown as CapabilityProfile;
}
function image(raw:unknown,maxBytes:number):{id:string;uri:string;bytes:number;width:number;height:number;format:'png'|'jpeg';digest:string} {
  const item=record(raw,'image');exact(item,['id','data_uri'],['id','data_uri']);
  const id=text(item.id,'image identity',128);
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))fail('DECISION_SCHEMA','Unsafe image identity');
  const uri=text(item.data_uri,'image data URI',24*MIB);
  const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/.exec(uri);
  if(!match || match[2]!.length%4!==0)fail('DECISION_UNSUPPORTED','Only canonical embedded PNG/JPEG data URIs are supported');
  const bytes=Buffer.from(match![2]!,'base64');
  if(!bytes.length||bytes.length>maxBytes||bytes.toString('base64')!==match![2])fail('DECISION_LIMIT','Image encoding or byte budget invalid');
  let width=0,height=0;
  if(match![1]==='png') {
    if(bytes.length<45||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail('DECISION_SCHEMA','Invalid PNG signature');
    let offset=8,header=false,data=false,ended=false;
    while(offset+12<=bytes.length) {
      const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);
      if(length>bytes.length-offset-12)fail('DECISION_SCHEMA','Truncated PNG chunk');
      if(!header){if(kind!=='IHDR'||length!==13)fail('DECISION_SCHEMA','Invalid PNG header');width=bytes.readUInt32BE(offset+8);height=bytes.readUInt32BE(offset+12);header=true;}
      else if(kind==='IHDR'||kind==='acTL')fail('DECISION_UNSUPPORTED','Duplicate header or animated PNG unsupported');
      if(kind==='IDAT')data=true;
      offset+=12+length;
      if(kind==='IEND'){if(length!==0||offset!==bytes.length)fail('DECISION_SCHEMA','Invalid PNG end');ended=true;break;}
    }
    if(!header||!data||!ended)fail('DECISION_SCHEMA','Incomplete PNG');
  } else {
    if(bytes.length<4||bytes.readUInt16BE(0)!==0xffd8||bytes.readUInt16BE(bytes.length-2)!==0xffd9)fail('DECISION_SCHEMA','Invalid JPEG framing');
    let offset=2;
    while(offset+4<=bytes.length) {
      if(bytes[offset++]!==0xff)fail('DECISION_SCHEMA','Invalid JPEG marker');
      while(bytes[offset]===0xff)offset++;
      const marker=bytes[offset++]!;
      if(marker===0xda||marker===0xd9)break;
      const length=bytes.readUInt16BE(offset);
      if(length<2||offset+length>bytes.length)fail('DECISION_SCHEMA','Invalid JPEG segment');
      if([0xc0,0xc1,0xc2].includes(marker)){if(length<8)fail('DECISION_SCHEMA','Invalid JPEG dimensions');height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);}
      offset+=length;
    }
  }
  if(width<1||height<1||width>16384||height>16384)fail('DECISION_LIMIT','Image dimensions unavailable or outside local bounds');
  return {id,uri,bytes:bytes.length,width,height,format:match![1] as 'png'|'jpeg',digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')};
}
function strings(value:unknown):string[] {
  if(typeof value==='string')return[value];
  if(Array.isArray(value))return value.flatMap(strings);
  if(value!==null&&typeof value==='object')return Object.values(value).flatMap(strings);
  return [];
}
/** Profiles are trusted startup configuration; wire callers cannot enable an extension. */
export function prepareCapabilities(raw:unknown,env:Readonly<NodeJS.ProcessEnv>):{prepared:PreparedRequest;metadata:Record<string,unknown>} {
  const input=record(raw,'capability request');exact(input,['route_id','request','media','reasoning','timeout_ms','long_context'],['route_id','request','timeout_ms']);
  const r=route(input.route_id),p=profileFor(r.id,env),timeout=integer(input.timeout_ms,'total deadline',1,30000);
  if(input.long_context!==undefined&&typeof input.long_context!=='boolean')fail('DECISION_SCHEMA','Long context opt-in must be boolean');
  const source=record(input.request,'request');exact(source,['state','questions'],['state','questions']);
  const questions=record(source.questions,'questions'),request=JSON.parse(canonical(source)) as Record<string,unknown>;
  if(input.media!==undefined&&!Array.isArray(input.media))fail('DECISION_SCHEMA','Media must be an array');
  const media=((input.media??[])as unknown[]).map(item=>image(item,p.max_image_bytes));
  if(media.length && (!p.images||media.length>p.max_images))fail('DECISION_UNSUPPORTED','Images are disabled or exceed qualified profile');
  if(new Set(media.map(m=>m.id)).size!==media.length)fail('DECISION_SCHEMA','Duplicate image identity');
  const body:Record<string,unknown>={},headers:Record<string,string>={};
  const semantics:Record<string,unknown>={provider_default:r.id==='span-native'?'auto/unbounded-zero':r.id==='span-selfhost'?'engine-specific-unqualified':null,
    hyperfide_default:'off',zero_budget_meaning:'no-deadline-not-disabled'};
  const reasoning=input.reasoning===undefined?{mode:'off'}:record(input.reasoning,'reasoning');
  exact(reasoning,['mode','budget_ms'],['mode']);
  if(!['off','on','auto'].includes(String(reasoning.mode)))fail('DECISION_SCHEMA','Invalid reasoning mode');
  if(reasoning.budget_ms===0)fail('DECISION_LIMIT','Zero reasoning budget means no deadline and is forbidden');
  if(reasoning.mode!=='off') {
    if(!r.reasoning||r.route_class==='gateway')fail('DECISION_UNSUPPORTED','Reasoning controls unsupported on this route');
    const budget=integer(reasoning.budget_ms,'reasoning budget',1,Math.min(500,timeout));
    body.reasoning={mode:reasoning.mode,budget_ms:budget};
  } else {
    if(reasoning.budget_ms!==undefined)fail('DECISION_SCHEMA','Off mode has no reasoning budget');
    if(r.reasoning)body.reasoning={mode:'off'};
  }
  if(Object.values(questions).some(q=>record(q,'question').type==='number')&&reasoning.mode!=='on')
    fail('DECISION_UNSUPPORTED','Number questions require explicitly bounded reasoning on');
  const boxes=Object.values(questions).some(q=>record(q,'question').type==='box');
  if(boxes&&(!media.length||!Object.values(questions).some(q=>record(q,'question').type==='noul')))fail('DECISION_UNSUPPORTED','Box requires media and an independent presence Noul');
  if(boxes&&r.id==='jev-native')headers['TypeSafe-Danger-Zone-Images']='true';
  let imageTokens=0,expandedBytes=0,imageOccurrences=media.length;
  if(media.length) {
    if(r.route_class==='gateway'&&r.id!=='jev-openrouter')fail('DECISION_UNSUPPORTED','Gateway image forwarding remains unqualified for this route');
    if(r.provider==='typesafe')for(const m of media)
      if(m.width<280||m.height<280||m.width>1568||m.height>1568||m.width*m.height<78400||m.width*m.height>2458624)
        fail('DECISION_LIMIT','Jev image dimensions violate the conservative native contract');
    if(r.image_format==='assets') {
      const assets:Record<string,unknown>={};const allStrings=strings(source);imageOccurrences=0;
      for(const m of media) {
        const count=allStrings.reduce((n,s)=>n+s.split(m.id).length-1,0);
        if(!count)fail('DECISION_SCHEMA','Every Jev asset must be referenced by a value');
        expandedBytes+=m.bytes*count;imageOccurrences+=count;
        assets[m.id]={type:'image',format:m.format,data_base64:m.uri.split(',')[1]};
      }
      if(expandedBytes>32*MIB)fail('DECISION_LIMIT','Expanded Jev assets exceed provider budget');
      body.assets=assets;headers['TypeSafe-Danger-Zone-Images']='true';
    } else if(r.image_format==='state_parts') {
      if(typeof source.state!=='string')fail('DECISION_UNSUPPORTED','Gateway media requires explicit text state');
      request.state=[source.state,...media.map(m=>({type:'image_url',image_url:{url:m.uri}}))];
    } else body.images=media.map(m=>m.uri);
    imageTokens=imageOccurrences*p.image_token_reserve;
  }
  if(input.long_context===true) {
    if(r.id!=='jev-native')fail('DECISION_UNSUPPORTED','Native long-context header cannot be forwarded to other routes');
    headers['TypeSafe-Danger-Zone-Long-Context']='true';
  }
  const nativeRequestLimit=r.id==='jev-native'?(input.long_context?262000:64000):r.context_request_tokens;
  const nativeQuestionLimit=r.id==='jev-native'?(input.long_context?262000:32000):r.context_question_tokens;
  const requestLimit=Math.min(p.context_request_tokens,nativeRequestLimit??p.context_request_tokens);
  const questionLimit=Math.min(p.context_question_tokens,nativeQuestionLimit??p.context_question_tokens);
  // The byte count deliberately overestimates text tokens; the qualification identifies the actual route tokenizer.
  const prepared=prepare(r.id,request,{...(media.length&&r.image_format==='state_parts'?{gateway_media:true as const}:{}),types:p.extensions,body,headers});
  const requestBytes=Buffer.byteLength(canonical(prepared.body));
  const questionBytes=Object.entries(questions).map(([id,q])=>Buffer.byteLength(canonical({...prepared.body,questions:{[id]:q}})));
  if(requestBytes>p.max_request_bytes||questionBytes.some(n=>n>p.max_question_bytes))fail('DECISION_LIMIT','Qualified byte budget exceeded');
  if(requestBytes+imageTokens>requestLimit||questionBytes.some(n=>n+imageTokens>questionLimit))
    fail('DECISION_LIMIT','Conservative full model-bound JSON context exceeds qualified route limit');
  return {prepared,metadata:{schema_version:1,route_id:r.id,qualification_ref:p.qualification_ref,qualification_class:p.mode,
    media:media.map(({id,bytes,width,height,format,digest})=>({id,bytes,width,height,format,digest})),
    media_validation:'container-header-only-not-decoder-or-model-qualification',expanded_image_bytes:expandedBytes,
    reasoning:body.reasoning??null,reasoning_semantics:semantics,
    context:{native_request_tokens:nativeRequestLimit,native_question_tokens:nativeQuestionLimit,qualified_request_tokens:requestLimit,
      qualified_question_tokens:questionLimit,tokenizer_ref:p.tokenizer_ref,text_accounting:'utf8-byte-upper-bound',exact_tokens_observed:false},
    non_authoritative:true}};
}
export function billing(raw:unknown,env:Readonly<NodeJS.ProcessEnv>):Record<string,unknown> {
  const input=record(raw,'billing');exact(input,['route_id','questions','state_tokens','question_tokens','image_tokens','output_tokens_bound','observed_usage','observed_cost'],['route_id','questions','state_tokens','question_tokens']);
  const r=route(input.route_id),p=profileFor(r.id,env),n=integer(input.questions,'questions',1,256);
  const state=integer(input.state_tokens,'state tokens',0,100000000),q=integer(input.question_tokens,'question tokens',0,100000000);
  const images=integer(input.image_tokens??0,'image tokens',0,100000000);
  const outputBound=input.output_tokens_bound===undefined?null:integer(input.output_tokens_bound,'output tokens bound',0,100000000);
  const estimatedInput=p.billing==='unknown'?null:(p.billing==='repeated-state'?(state+images)*n:state+images)+q;
  let observed:Record<string,unknown>|null=null,cost:Record<string,unknown>|null=null;
  if(input.observed_usage!==undefined) {
    const u=record(input.observed_usage,'observed usage');exact(u,['input_tokens','output_tokens','provenance'],['input_tokens','output_tokens','provenance']);
    integer(u.input_tokens,'observed input tokens',0,Number.MAX_SAFE_INTEGER);integer(u.output_tokens,'observed output tokens',0,Number.MAX_SAFE_INTEGER);
    text(u.provenance,'usage provenance');observed=u;
  }
  if(input.observed_cost!==undefined) {
    const c=record(input.observed_cost,'observed cost');exact(c,['usd','provenance','reconciled'],['usd','provenance','reconciled']);
    if(typeof c.usd!=='number'||!Number.isFinite(c.usd)||c.usd<0||typeof c.reconciled!=='boolean')fail('DECISION_SCHEMA','Invalid observed cost');
    text(c.provenance,'cost provenance');cost=c;
  }
  // Output is priced explicitly: an estimate exists only when output is qualified as free or bounded by the caller;
  // a nonzero or unknown output price without a bound leaves the whole estimate unknown rather than understated.
  const outputUsd=p.price_output_per_million===null?null:p.price_output_per_million===0?0:
    outputBound===null?null:outputBound*p.price_output_per_million/1000000;
  const estimatedUsd=estimatedInput!==null&&outputUsd!==null&&p.price_input_per_million!==null?
    estimatedInput*p.price_input_per_million/1000000+outputUsd:null;
  return {schema_version:1,route_id:r.id,accounting:p.billing,questions:n,estimated_input_tokens:estimatedInput,
    output_tokens_bound:outputBound,estimated_usd:estimatedUsd,estimate_provenance:p.qualification_ref,
    observed_usage:observed,observed_cost:cost,usage_class:observed?'actual':'unknown',
    cost_class:cost?'actual':estimatedUsd===null?'unknown':'estimated',unknown_is_zero:false,
    evidence_class:'untrusted-preview',non_authoritative:true};
}
export function createComponent(ctx:ComponentContext) {
  const facade=Object.freeze({schemaVersion:1,prepare:(input:unknown)=>prepareCapabilities(input,ctx.env),billing:(input:unknown)=>billing(input,ctx.env)});
  return {apiVersion:1,capabilities:{'decision.capabilities.v1':facade},actions:{
    'decision.capabilities.prepare':(input:unknown)=>prepareCapabilities(input,ctx.env),
    'decision.capabilities.billing':(input:unknown)=>billing(input,ctx.env)}};
}
