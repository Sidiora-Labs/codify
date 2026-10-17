import { createHash } from 'node:crypto';
import { FoundationError, object } from '../policy/programme.js';
import type { ComponentContext } from '../components/registry.js';

export class DecisionError extends FoundationError {
  constructor(code: string, message: string, readonly retryable = false, readonly retryAfterMs: number | null = null) {
    super(code, message);
  }
}
export const fail = (code: string, message: string): never => { throw new DecisionError(code, message); };
export function record(value: unknown, label: string): Record<string, unknown> {
  if (!object(value)) fail('DECISION_SCHEMA', label + ' must be an object');
  return value as Record<string, unknown>;
}
export function exact(value: Record<string, unknown>, allowed: string[], required: string[] = []): void {
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    fail('DECISION_SCHEMA', 'Unsupported or missing fields');
}
export function text(value: unknown, label: string, limit = 4096): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > limit)
    fail('DECISION_SCHEMA', label + ' must be bounded nonempty text');
  return value as string;
}
export function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail('DECISION_SCHEMA', label + ' is outside its bounds');
  return value as number;
}
/** Strict JSON keeps duplicate answer/option identities from being silently overwritten. */
export function strictJson(input: string, maxBytes = 8 * 1024 * 1024): unknown {
  if (Buffer.byteLength(input) > maxBytes || input.charCodeAt(0) === 0xfeff) fail('DECISION_SCHEMA', 'JSON size or encoding is invalid');
  let i = 0;
  const whitespace = (): void => { while (i < input.length && /[\t\n\r ]/.test(input[i]!)) i++; };
  const string = (): string => {
    const start = i++;
    while (i < input.length) {
      const ch = input[i++]!;
      if (ch === '"') {
        try { return JSON.parse(input.slice(start, i)) as string; }
        catch { return fail('DECISION_SCHEMA', 'Invalid JSON string'); }
      }
      if (ch === '\\') i++;
      else if (ch.charCodeAt(0) < 32) fail('DECISION_SCHEMA', 'Invalid JSON string');
    }
    return fail('DECISION_SCHEMA', 'Unterminated JSON string');
  };
  const value = (depth: number): unknown => {
    whitespace();
    if (depth > 64) fail('DECISION_SCHEMA', 'JSON nesting exceeds 64');
    const ch = input[i];
    if (ch === '"') return string();
    if (ch === '{') {
      i++; whitespace();
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (input[i] === '}') { i++; return out; }
      while (true) {
        whitespace(); if (input[i] !== '"') fail('DECISION_SCHEMA', 'Expected object key');
        const key = string();
        if (Object.hasOwn(out, key)) fail('DECISION_SCHEMA', 'Duplicate JSON key');
        whitespace(); if (input[i++] !== ':') fail('DECISION_SCHEMA', 'Expected colon');
        out[key] = value(depth + 1); whitespace();
        const sep = input[i++]; if (sep === '}') return out;
        if (sep !== ',') fail('DECISION_SCHEMA', 'Expected object separator');
      }
    }
    if (ch === '[') {
      i++; whitespace(); const out: unknown[] = [];
      if (input[i] === ']') { i++; return out; }
      while (true) {
        out.push(value(depth + 1)); whitespace();
        const sep = input[i++]; if (sep === ']') return out;
        if (sep !== ',') fail('DECISION_SCHEMA', 'Expected array separator');
      }
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (input.startsWith(token, i)) { i += token.length; return result; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(input.slice(i));
    if (!match) return fail('DECISION_SCHEMA', 'Invalid JSON value');
    i += match[0].length; const n = Number(match[0]);
    if (!Number.isFinite(n)) fail('DECISION_SCHEMA', 'Nonfinite JSON number');
    return n;
  };
  const parsed = value(0); whitespace();
  if (i !== input.length) fail('DECISION_SCHEMA', 'Trailing JSON data');
  return parsed;
}
export function canonical(value: unknown): string {
  const normalize = (item: unknown, depth: number): unknown => {
    if (depth > 64) fail('DECISION_SCHEMA', 'Nesting exceeds 64');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(v => normalize(v, depth + 1));
    if (object(item)) return Object.fromEntries(Object.keys(item).sort().map(k => [k, normalize(item[k], depth + 1)]));
    return fail('DECISION_SCHEMA', 'Only finite JSON values are accepted');
  };
  return JSON.stringify(normalize(value, 0));
}
function freezeDeep<T>(value:T):T {
  if(value!==null && typeof value==='object'){for(const child of Object.values(value))freezeDeep(child);Object.freeze(value);}
  return value;
}
export const hash = (value: unknown): string => 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex');
export type QuestionType = 'noul' | 'choice' | 'score' | 'number' | 'box';
export interface Question { type: QuestionType; instructions: unknown; criteria?: unknown }
export interface DecisionRequest { state: unknown; questions: Record<string, Question> }
export type RouteId = 'span-native' | 'jev-native' | 'ultra-native' | 'span-openrouter' | 'jev-openrouter' | 'ultra-openrouter' | 'span-selfhost';
export interface RouteProfile {
  id: RouteId; catalogue_model: string; model: string; endpoint: string | null; route_class: 'native' | 'gateway' | 'selfhost';
  provider: 'respan' | 'typesafe' | 'liquid'; choice_max: number | null; score_max: number;
  context_request_tokens: number | null; context_question_tokens: number | null;
  image_format: 'images' | 'assets' | 'state_parts'; native_number: boolean; native_box: boolean;
  reasoning: boolean; live_qualification: 'UNQUALIFIED'; source_urls: string[];
}
const SPAN = ['https://www.respan.ai/docs/documentation/span-02/concept','https://www.respan.ai/docs/documentation/span-02/question-types'];
const JEV = ['https://docs.typesafe.ai/models','https://docs.typesafe.ai/api'];
const LIQUID = ['https://www.liquid.ai/blog/d1-ultra'];
const GATEWAY = 'https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request';
const gatewayEndpoint = 'https://openrouter.ai/api/alpha/decisions';
export const ROUTES: Readonly<Record<RouteId, RouteProfile>> = Object.freeze(Object.fromEntries([
  {id:'span-native',catalogue_model:'respan/span-02',model:'span-02',endpoint:'https://api.respan.ai/api/v1/decisions',provider:'respan',choice_max:679,context_request_tokens:null,context_question_tokens:null,image_format:'images',native_number:true,native_box:false,reasoning:true,source_urls:SPAN,route_class:'native'},
  {id:'jev-native',catalogue_model:'typesafe/jev-1.14',model:'jev-1.14.0',endpoint:'https://api.typesafe.ai/v1/systemone',provider:'typesafe',choice_max:255,context_request_tokens:64000,context_question_tokens:32000,image_format:'assets',native_number:false,native_box:true,reasoning:false,source_urls:JEV,route_class:'native'},
  {id:'ultra-native',catalogue_model:'liquid/d1-ultra',model:'d1-ultra',endpoint:'https://api.liquid.ai/decisions/v1/systemone',provider:'liquid',choice_max:null,context_request_tokens:null,context_question_tokens:null,image_format:'images',native_number:false,native_box:false,reasoning:false,source_urls:LIQUID,route_class:'native'},
  ...(['span','jev','ultra'] as const).map((name) => ({id:name+'-openrouter',catalogue_model:name==='span'?'respan/span-02':name==='jev'?'typesafe/jev-1.14':'liquid/d1-ultra',model:name==='span'?'respan/span-02':name==='jev'?'typesafe/jev-1.14':'liquid/d1-ultra',endpoint:gatewayEndpoint,provider:name==='span'?'respan':name==='jev'?'typesafe':'liquid',choice_max:null,context_request_tokens:null,context_question_tokens:null,image_format:'state_parts',native_number:false,native_box:false,reasoning:false,source_urls:[GATEWAY],route_class:'gateway'})),
  {id:'span-selfhost',catalogue_model:'respan/span-02',model:'span-02',endpoint:null,provider:'respan',choice_max:679,context_request_tokens:null,context_question_tokens:131072,image_format:'images',native_number:true,native_box:false,reasoning:true,source_urls:['https://huggingface.co/respanai/span-02'],route_class:'selfhost'},
].map(p => [p.id, Object.freeze({...p, score_max:10, live_qualification:'UNQUALIFIED'})])) as Record<RouteId, RouteProfile>);
export function route(id: unknown): RouteProfile {
  const name = text(id, 'route');
  if (!Object.hasOwn(ROUTES, name)) fail('DECISION_UNSUPPORTED', 'Unknown decision route');
  return ROUTES[name as RouteId];
}
export function validateRequest(input: unknown, profile: RouteProfile, enabled: readonly QuestionType[] = [], gatewayMedia = false): DecisionRequest {
  const request = record(input, 'decision request'); exact(request,['state','questions'],['state','questions']);
  canonical(request.state);
  if (request.state === null || !['object','string'].includes(typeof request.state)) fail('DECISION_SCHEMA','State must be text or structured JSON');
  if(profile.route_class==='gateway'&&Array.isArray(request.state)&&!gatewayMedia)fail('DECISION_UNSUPPORTED','Gateway content parts require qualified media preparation');
  const questions = record(request.questions,'questions');
  if (!Object.keys(questions).length || Object.keys(questions).length > 256) fail('DECISION_SCHEMA','Local question count limit is 1..256');
  const checked: Record<string,Question> = Object.create(null) as Record<string,Question>;
  for (const [id,raw] of Object.entries(questions)) {
    text(id,'question ID',128); const q=record(raw,'question'); exact(q,['type','instructions','criteria'],['type','instructions']);
    if (!['noul','choice','score','number','box'].includes(String(q.type))) fail('DECISION_UNSUPPORTED','Unsupported question type');
    const type=q.type as QuestionType;
    if ((type==='number' || type==='box') && (!enabled.includes(type) || (type==='number'?!profile.native_number:!profile.native_box)))
      fail('DECISION_UNSUPPORTED','Question extension is disabled or unsupported on this route');
    if (q.instructions===null || !['string','object'].includes(typeof q.instructions)) fail('DECISION_SCHEMA','Instructions must be text or structured JSON');
    canonical(q.instructions);
    if (type==='choice') {
      const choices=record(q.criteria,'choice criteria'); const count=Object.keys(choices).length;
      if (!count || count>(profile.choice_max ?? 255)) fail('DECISION_UNSUPPORTED','Choice exceeds route or conservative local option cap');
      for (const [key,v] of Object.entries(choices)) { text(key,'option',1024); canonical(v); }
    } else if (type==='score') {
      if (!Array.isArray(q.criteria) || q.criteria.length<2 || q.criteria.length>10) fail('DECISION_SCHEMA','Score requires 2..10 ordered levels');
      for (const v of q.criteria as unknown[]) if (v===null || !['string','object'].includes(typeof v)) fail('DECISION_SCHEMA','Invalid score level');
    } else if (type==='noul' && q.criteria!==undefined) {
      const criteria=record(q.criteria,'Noul criteria'); exact(criteria,['true','false']);
      for (const v of Object.values(criteria)) canonical(v);
    } else if ((type==='number' || type==='box') && q.criteria!==undefined) fail('DECISION_SCHEMA','Number/Box do not accept criteria');
    checked[id]=JSON.parse(canonical(q)) as Question;
  }
  return {state:JSON.parse(canonical(request.state)),questions:checked};
}
export interface PreparedRequest { route: RouteProfile; body: Record<string,unknown>; headers: Record<string,string>; request_hash:string; source_request:DecisionRequest }
const prepared = new WeakSet<object>();
export function prepare(id: unknown, input: unknown, extensions: {gateway_media?:true;types?:readonly QuestionType[];body?:Record<string,unknown>;headers?:Record<string,string>} = {}): PreparedRequest {
  if(extensions.body)exact(extensions.body,['images','assets','reasoning']);
  if(extensions.headers)exact(extensions.headers,['TypeSafe-Danger-Zone-Images','TypeSafe-Danger-Zone-Long-Context']);
  const profile=route(id), source=validateRequest(input,profile,extensions.types,extensions.gateway_media===true);
  const body={model:profile.model,...source,...extensions.body};
  const serialized=canonical(body);
  if (Buffer.byteLength(serialized)>8*1024*1024) fail('DECISION_LIMIT','Local request body exceeds 8 MiB');
  const result={route:profile,body:JSON.parse(serialized) as Record<string,unknown>,
    headers:{'Content-Type':'application/json',...extensions.headers},request_hash:hash(body),source_request:source};
  freezeDeep(result); prepared.add(result); return result;
}
interface TransportProfile { enabled:boolean;mode:'live'|'fixture';qualification_ref:string;credential_env:string;endpoint:string;max_body_bytes:number;returned_models:string[] }
export function configuredTransport(profile:RouteProfile,env:Readonly<NodeJS.ProcessEnv>):TransportProfile {
  const configs=env.HYPERFIDE_DECISION_ROUTES ? record(strictJson(env.HYPERFIDE_DECISION_ROUTES),'route configuration') : {};
  const config=record(configs[profile.id],'route configuration'); exact(config,['enabled','mode','qualification_ref','credential_env','endpoint','max_body_bytes','returned_models'],['enabled','mode','qualification_ref','credential_env','max_body_bytes','returned_models']);
  if (config.enabled!==true || !['live','fixture'].includes(String(config.mode))) fail('DECISION_UNAVAILABLE','Route is not explicitly enabled');
  const qualification_ref=text(config.qualification_ref,'qualification reference');
  const credential_env=text(config.credential_env,'credential reference',128);
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(credential_env)) fail('DECISION_SCHEMA','Credential reference must name a configured environment binding');
  const endpoint=text(config.endpoint ?? profile.endpoint,'endpoint');
  let url:URL;try {url=new URL(endpoint);}catch {return fail('DECISION_SCHEMA','Invalid configured endpoint');}
  if (url.username || url.password || url.search || url.hash) fail('DECISION_SCHEMA','Endpoint credentials/query/fragment are forbidden');
  if (config.mode==='fixture') {
    if (!['127.0.0.1','[::1]','localhost'].includes(url.hostname) || url.protocol!=='http:') fail('DECISION_SCHEMA','Fixture transport must be explicit loopback HTTP');
  } else {
    if (url.protocol!=='https:' || (profile.route_class!=='selfhost' && endpoint!==profile.endpoint)) fail('DECISION_SCHEMA','Live route endpoint does not match its provider contract');
  }
  if (!Array.isArray(config.returned_models) || !config.returned_models.length || config.returned_models.some(v=>typeof v!=='string'||!v.trim())) fail('DECISION_SCHEMA','Qualified returned model inventory required');
  return {enabled:true,mode:config.mode as 'live'|'fixture',qualification_ref,credential_env,endpoint,
    max_body_bytes:integer(config.max_body_bytes,'body budget',1,8*1024*1024),returned_models:config.returned_models as string[]};
}
export interface TransportResult { route_id:RouteId;requested_model:string;returned_model:string;response:Record<string,unknown>;request_hash:string;response_hash:string;duration_ms:number;qualification:'fixture'|'live';qualification_ref:string;http_status:number }
export async function invokePrepared(request:PreparedRequest,env:Readonly<NodeJS.ProcessEnv>,options:{timeout_ms:number;signal?:AbortSignal}):Promise<TransportResult> {
  if (!prepared.has(request)) fail('DECISION_SCHEMA','Prepared requests must be created through the validated adapter');
  const timeout=integer(options.timeout_ms,'transport deadline',1,30000);
  const config=configuredTransport(request.route,env), token=env[config.credential_env];
  if (!token || /[\r\n]/.test(token)) fail('DECISION_CREDENTIAL','Configured credential binding unavailable');
  const body=canonical(request.body);
  if (Buffer.byteLength(body)>config.max_body_bytes) fail('DECISION_LIMIT','Request exceeds qualified route body budget');
  const start=performance.now(), controller=new AbortController();
  const abort=():void=>controller.abort();
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)controller.abort();
  const timer=setTimeout(abort,timeout);
  try {
    const response=await fetch(config.endpoint,{method:'POST',headers:{...request.headers,Authorization:'Bearer '+token},body,signal:controller.signal,redirect:'error'});
    if (!response.ok) {
      const header=response.headers.get('retry-after');let retryAfter:number|null=null;
      if(header!==null){const seconds=Number(header);retryAfter=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(header)-Date.now());if(!Number.isFinite(retryAfter))retryAfter=null;}
      const retryable=[429,500,502,503,504,524,529].includes(response.status);
      throw new DecisionError(response.status===401||response.status===403?'DECISION_CREDENTIAL':response.status===402?'DECISION_CREDIT':'DECISION_HTTP',
        'Decision provider returned HTTP '+response.status,retryable,retryAfter);
    }
    if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')) fail('DECISION_RESPONSE','Provider response is not JSON');
    const chunks:Uint8Array[]=[];let size=0;
    if(!response.body)fail('DECISION_RESPONSE','Provider returned no response body');
    const reader=response.body!.getReader();
    while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>8*1024*1024){await reader.cancel();fail('DECISION_RESPONSE','Response exceeds local byte budget');}chunks.push(item.value);}
    let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{return fail('DECISION_RESPONSE','Provider returned invalid UTF-8');}
    if(raw.includes(token!))fail('DECISION_RESPONSE','Provider response contains credential material');
    const parsed=record(strictJson(raw),'provider response');
    const containsCredential=(value:unknown):boolean=>{
      if(typeof value==='string')return value.includes(token!);
      if(Array.isArray(value))return value.some(containsCredential);
      return object(value)&&Object.entries(value).some(([key,item])=>key.includes(token!)||containsCredential(item));
    };
    if(containsCredential(parsed))fail('DECISION_RESPONSE','Decoded provider response contains credential material');
    if(typeof parsed.model!=='string'||!config.returned_models.includes(parsed.model))fail('DECISION_MODEL_CHANGED','Returned model is not independently qualified');
    record(parsed.answers,'provider answers');record(parsed.usage,'provider usage');
    const answers=parsed.answers as Record<string,unknown>;
    if(Object.keys(answers).length!==Object.keys(request.source_request.questions).length)fail('DECISION_RESPONSE','Answer inventory mismatch');
    for(const [id,q]of Object.entries(request.source_request.questions)){
      if(!Object.hasOwn(answers,id)||record(answers[id],'answer').type!==q.type)fail('DECISION_RESPONSE','Answer identity/type mismatch');
    }
    const usage=parsed.usage as Record<string,unknown>;
    integer(usage.input_tokens,'input token usage',0,Number.MAX_SAFE_INTEGER);
    integer(usage.output_tokens,'output token usage',0,Number.MAX_SAFE_INTEGER);
    return {route_id:request.route.id,requested_model:request.route.model,returned_model:parsed.model as string,response:parsed,
      request_hash:request.request_hash,response_hash:hash(parsed),duration_ms:performance.now()-start,
      qualification:config.mode,qualification_ref:config.qualification_ref,http_status:response.status};
  } catch(error) {
    if(error instanceof DecisionError)throw error;
    throw new DecisionError(controller.signal.aborted?'DECISION_TIMEOUT':'DECISION_TRANSPORT',
      controller.signal.aborted?'Decision transport cancelled or expired':'Decision transport failed',!controller.signal.aborted);
  } finally {controller.abort();clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
function legacyEndpoint(value:string|undefined):string|null {
  if(!value)return null;
  try{const endpoint=new URL(value);return endpoint.origin+endpoint.pathname;}catch{return '[invalid-configured-endpoint]';}
}
export function legacyConfiguration(env:Readonly<NodeJS.ProcessEnv>):unknown {
  return {schema_version:1,non_authoritative:true,legacy_jev:{model:env.CG_JEV_MODEL??null,endpoint:legacyEndpoint(env.CG_JEV_ENDPOINT),credential_ref:'CENTRA_API_KEY'},
    legacy_recap:{model:env.CG_RECAP_DECIDE_MODEL??null,endpoint:legacyEndpoint(env.CG_RECAP_DECIDE_ENDPOINT),credential_ref:'CENTRA_API_KEY',writer_model:env.CG_RECAP_MODEL??null},
    migration:'explicit-profile-required',model_upgrade_automatic:false,timeout_policy:'one-total-deadline-not-legacy-per-attempt'};
}
export function createComponent(ctx:ComponentContext):unknown {
  return {apiVersion:1,actions:{
    'decision.routes.describe':()=>({schema_version:1,routes:Object.values(ROUTES),non_authoritative:true}),
    'decision.adapter.prepare':(input:unknown)=>{const v=record(input,'input');exact(v,['route_id','request'],['route_id','request']);const p=prepare(v.route_id,v.request);return {route_id:p.route.id,body:p.body,headers:p.headers,request_hash:p.request_hash,non_authoritative:true};},
    'decision.adapter.invoke':async(input:unknown)=>{const v=record(input,'input');exact(v,['route_id','request','timeout_ms'],['route_id','request','timeout_ms']);return invokePrepared(prepare(v.route_id,v.request),ctx.env,{timeout_ms:integer(v.timeout_ms,'deadline',1,30000),signal:ctx.signal});},
    'decision.configuration.migrate':()=>legacyConfiguration(ctx.env),
  }};
}
