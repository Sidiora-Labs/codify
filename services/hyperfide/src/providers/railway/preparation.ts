import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { Sandbox, type ConnectOptions, type SandboxTemplate } from 'railway';
import type { Component, ComponentContext } from '../../components/registry.js';
import { canonicalJSON, verifyManifest, type PreparationManifest } from '../../preparation/manifests.js';
import type { ProviderScope } from '../contract.js';

/** Public SDK/API revision pin. Credentials belong only to the provisioner. */
export const RAILWAY_PIN = Object.freeze({ sdk_name:'railway',sdk_version:'3.16.0',
  api_revision:'97fdb4f61d351319d5633c2c92a86ca2ff0062d8',node_version:'24.22.0' });
export type JsonObject = Record<string,unknown>;
export function object(value:unknown,keys?:readonly string[]):JsonObject {
  if(value===null||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))
    throw new Error('Railway object schema');
  const v=value as JsonObject;
  if(keys && (Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))) throw new Error('Railway fields');
  return v;
}
export function text(value:unknown,max=2048):string {
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))
    throw new Error('Railway bounded string');
  return value;
}
export function digest(value:unknown):string {
  if(typeof value!=='string'||!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('Railway digest');
  return value;
}
export function hash(value:unknown):string { return 'sha256:'+createHash('sha256').update(canonicalJSON(value)).digest('hex'); }
export function absolute(value:unknown):string {
  const v=text(value,4096);
  if(!path.posix.isAbsolute(v)||v.includes('\\')||v.split('/').includes('..')||path.posix.normalize(v)!==v)
    throw new Error('Railway path');
  return v;
}
export function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max) throw new Error('Railway integer');
  return value;
}
export function instant(value:unknown):string {
  const v=text(value,64);
  if(!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v) throw new Error('Railway timestamp');
  return v;
}
export function scope(value:unknown):ProviderScope {
  const v=object(value,['organisation_id','pool_id','provider','provider_account_id','environment_id','region','configuration_digest']);
  for(const k of ['organisation_id','pool_id','provider_account_id','environment_id','region']) text(v[k]);
  if(v.provider!=='railway') throw new Error('Railway provider scope');
  digest(v.configuration_digest);
  return v as unknown as ProviderScope;
}
export function sameScope(a:ProviderScope,b:ProviderScope):boolean { return canonicalJSON(a)===canonicalJSON(b); }
export interface RailwayConfiguration {
  schema_version:1; mode:'live'|'component-fixture'; endpoint:string; environment_id:string; region:string;
  account_id:string; token_env:string; auth_type:'bearer'|'project-token'; preparation_root:string; request_timeout_ms:number;
  exec_ws_endpoint:string|null;
}
export class RailwayRequestError extends Error {
  constructor(readonly code:'REJECTED'|'UNKNOWN'|'PROTOCOL',readonly providerCode:string|null=null) {
    super('Railway request '+code); // Never include token-bearing provider text.
  }
}
async function boundedBody(response:Response):Promise<Buffer> {
  const maximum=16*1024*1024,declared=response.headers.get('content-length');
  const reader=response.body?.getReader();if(!reader)throw new RailwayRequestError('UNKNOWN');
  let size=0,used=0,block=Buffer.allocUnsafe(65536);const chunks:Buffer[]=[];
  try{
    if(declared!==null&&/^[0-9]+$/.test(declared)&&BigInt(declared)>BigInt(maximum)){
      void reader.cancel().catch(()=>{});throw new RailwayRequestError('UNKNOWN');
    }
    while(true){
      const next=await reader.read();if(next.done)break;
      size+=next.value.byteLength;
      if(size>maximum){void reader.cancel().catch(()=>{});throw new RailwayRequestError('UNKNOWN');}
      let offset=0;
      while(offset<next.value.byteLength){
        const take=Math.min(block.length-used,next.value.byteLength-offset);
        block.set(next.value.subarray(offset,offset+take),used);used+=take;offset+=take;
        if(used===block.length){chunks.push(block);block=Buffer.allocUnsafe(65536);used=0;}
      }
    }
    if(used)chunks.push(block.subarray(0,used));
    return Buffer.concat(chunks,size);
  }finally{reader.releaseLock();}
}
export class RailwayClient {
  readonly config:RailwayConfiguration;
  private readonly token:string;
  constructor(value:unknown,env:Readonly<NodeJS.ProcessEnv>,private readonly transport:typeof fetch=fetch) {
    const v=object(value,['schema_version','mode','endpoint','environment_id','region','account_id','token_env','auth_type',
      'preparation_root','request_timeout_ms','exec_ws_endpoint']);
    if(v.schema_version!==1||!['live','component-fixture'].includes(String(v.mode))||
      !['bearer','project-token'].includes(String(v.auth_type))) throw new Error('Railway configuration');
    const endpoint=new URL(text(v.endpoint));
    if(v.mode==='live' && endpoint.href!=='https://backboard.railway.com/graphql/v2') throw new Error('Railway endpoint');
    if(v.mode==='component-fixture' && !(endpoint.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(endpoint.hostname)))
      throw new Error('Railway fixture endpoint');
    if(endpoint.username||endpoint.password||endpoint.hash||endpoint.search) throw new Error('Railway endpoint fields');
    for(const key of ['environment_id','region','account_id']) text(v[key]);
    const tokenEnv=text(v.token_env,128);
    if(!/^HF_RAILWAY_[A-Z0-9_]+$/.test(tokenEnv)||typeof env[tokenEnv]!=='string'||!env[tokenEnv])
      throw new Error('Railway credential reference unavailable');
    this.token=env[tokenEnv]!;
    if(v.exec_ws_endpoint!==null){const ws=new URL(text(v.exec_ws_endpoint));
      if(v.mode==='live'&&ws.href!=='wss://ssh.railway.com:2226/ws/exec')throw new Error('Railway exec endpoint');
      if(v.mode==='component-fixture'&&!(ws.protocol==='ws:'&&['127.0.0.1','localhost','[::1]'].includes(ws.hostname)))
        throw new Error('Railway fixture exec endpoint');
      if(ws.username||ws.password||ws.hash||ws.search)throw new Error('Railway exec endpoint fields');
    }
    absolute(v.preparation_root);
    integer(v.request_timeout_ms,1,300000);
    this.config=Object.freeze(v as unknown as RailwayConfiguration);
  }
  assertScope(s:ProviderScope):void {
    if(s.provider!=='railway'||s.environment_id!==this.config.environment_id||s.region!==this.config.region||
      s.provider_account_id!==this.config.account_id) throw new Error('Railway configured scope mismatch');
  }
  sdkOptions(capture?:(stream:'stdout'|'stderr',bytes:Uint8Array)=>void):ConnectOptions {
    class RailwayWebSocket extends WebSocket {
      constructor(url:string,protocols?:string|string[]){
        super(url,protocols,{origin:'https://railway.com'});
        // The pinned SDK decodes callbacks as UTF-8. Preserve raw binary frames before decoding.
        if(capture)this.on('message',(data,binary)=>{
          if(!binary)return;
          const bytes=Buffer.isBuffer(data)?data:Array.isArray(data)?Buffer.concat(data):Buffer.from(data);
          if(bytes.length>1&&(bytes[0]===1||bytes[0]===3))
            capture(bytes[0]===1?'stdout':'stderr',bytes.subarray(1));
        });
      }
    }
    return {token:this.token,authType:this.config.auth_type,endpoint:this.config.endpoint,
      environmentId:this.config.environment_id,fetch:async(input,init)=>{
        const response=await this.transport(input,{...init,redirect:'error',
          signal:AbortSignal.any([AbortSignal.timeout(this.config.request_timeout_ms),...(init?.signal?[init.signal]:[])])});
        return new Response(await boundedBody(response),{status:response.status,statusText:response.statusText,headers:response.headers});
      },verbose:false,webSocketImpl:RailwayWebSocket,
      ...(this.config.exec_ws_endpoint===null?{}:{tcpProxyWsEndpoint:this.config.exec_ws_endpoint})};
  }
  async request<T>(query:string,variables:JsonObject,signal?:AbortSignal):Promise<T> {
    const timeout=AbortSignal.timeout(this.config.request_timeout_ms);
    const combined=signal?AbortSignal.any([timeout,signal]):timeout;
    let response:Response;
    try {
      response=await this.transport(this.config.endpoint,{method:'POST',redirect:'error',signal:combined,
        headers:{'content-type':'application/json',...(this.config.auth_type==='bearer'?
          {Authorization:'Bearer '+this.token}:{'project-access-token':this.token})},
        body:JSON.stringify({query,variables})});
    } catch { throw new RailwayRequestError('UNKNOWN'); }
    // HTTP failure or a GraphQL error is not proof that a mutation had no effect.
    if(!response.ok) throw new RailwayRequestError('UNKNOWN','HTTP_'+response.status);
    let value:unknown;
    try { value=JSON.parse((await boundedBody(response)).toString('utf8')); }
    catch { throw new RailwayRequestError('UNKNOWN'); }
    const item=object(value);
    if(item.errors!==undefined||!item.data||typeof item.data!=='object') throw new RailwayRequestError('UNKNOWN');
    return item.data as T;
  }
  provenance():{mode:RailwayConfiguration['mode'];sdk:typeof RAILWAY_PIN;live_qualification:'NOT_EVALUATED'} {
    return {mode:this.config.mode,sdk:RAILWAY_PIN,live_qualification:'NOT_EVALUATED'};
  }
}
export function configuredClient(context:Pick<ComponentContext,'env'>):RailwayClient {
  const name=context.env.HF_RAILWAY_CONFIG;
  if(!name||!path.isAbsolute(name)) throw new Error('Railway trusted configuration missing');
  const fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size>65536||(stat.mode&0o022)!==0) throw new Error('Railway configuration permissions');
    return new RailwayClient(JSON.parse(fs.readFileSync(fd,'utf8')),context.env);
  } finally { fs.closeSync(fd); }
}
export interface PreparedRailwayBase {
  schema_version:1; provider:'railway'; scope:ProviderScope; preparation_digest:string;
  checkpoint:{id:string;key:string}; disk_only:true; source_native_sandbox_id:string; source_boot_id:string; captured_at:string;
}
export function validatePreparedBase(value:unknown,expected:ProviderScope,expectedDigest:string):PreparedRailwayBase {
  const v=object(value,['schema_version','provider','scope','preparation_digest','checkpoint','disk_only','source_native_sandbox_id','source_boot_id','captured_at']);
  if(v.schema_version!==1||v.provider!=='railway'||v.disk_only!==true||!sameScope(scope(v.scope),expected)||
    digest(v.preparation_digest)!==digest(expectedDigest)) throw new Error('Railway preparation affinity');
  const checkpoint=object(v.checkpoint,['id','key']);text(checkpoint.id);text(checkpoint.key);
  text(v.source_native_sandbox_id);text(v.source_boot_id,128);instant(v.captured_at);
  return v as unknown as PreparedRailwayBase;
}
export interface PreparationCaptureHooks {
  /** Authenticated runner must stop all preparation writers and revoke live credentials.
   * A caller-supplied boolean is never a quiescence receipt. */
  quiesceAndVerify(sandboxId:string,manifest:PreparationManifest,signal:AbortSignal):Promise<{
    boot_id:string;preparation_digest:string;assertHeld:()=>Promise<void>;release:()=>Promise<void>;
  }>;
  persistCheckpoint(base:PreparedRailwayBase):Promise<void>;
  /** Coordinator serializes this immutable key across provisioner instances. */
  withPreparationLock<T>(digest:string,action:()=>Promise<T>):Promise<T>;
}
export async function capturePreparedBase(client:RailwayClient,input:{
  sandbox_id:string;scope:ProviderScope;manifest:PreparationManifest;candidate_path:string;scan_policy:unknown;
},context:ComponentContext,hooks:PreparationCaptureHooks):Promise<PreparedRailwayBase> {
  client.assertScope(input.scope);
  await verifyManifest({candidate_path:input.candidate_path,manifest:input.manifest,scan_policy:input.scan_policy},context);
  if(Date.parse(input.manifest.profile.policy.expires_at)<=Date.now())throw new Error('Railway preparation expired');
  // The coordinator lease must fence this immutable key before runner quiescence.
  return hooks.withPreparationLock(input.manifest.digest,async()=>{
  const before=await hooks.quiesceAndVerify(text(input.sandbox_id),input.manifest,context.signal);
  try {
  if(digest(before.preparation_digest)!==input.manifest.digest) throw new Error('Railway remote preparation mismatch');
  const boot=text(before.boot_id,128);
  // Immutable content key: never replace an existing named checkpoint by accident.
  const key='hyperfide-'+input.manifest.digest.slice(7);
  const list=await client.request<{sandboxCheckpoints:Array<{id:string;key:string;environmentId:string}>}>(
    'query RailwayCheckpoints($environmentId:String!){sandboxCheckpoints(environmentId:$environmentId){id key environmentId}}',
    {environmentId:input.scope.environment_id},context.signal);
  if(!Array.isArray(list.sandboxCheckpoints)) throw new RailwayRequestError('PROTOCOL');
  if(list.sandboxCheckpoints.some(item=>item.key===key)) throw new Error('Railway checkpoint key already exists; reconcile');
  await before.assertHeld();
  const result=await client.request<{sandboxCheckpointCreate:{id:string;key:string;environmentId:string;createdAt:string}}>(
    'mutation RailwayCapture($environmentId:String!,$name:String!,$sandboxId:String!){sandboxCheckpointCreate(environmentId:$environmentId,name:$name,sandboxId:$sandboxId){id key environmentId createdAt}}',
    {environmentId:input.scope.environment_id,name:key,sandboxId:input.sandbox_id},context.signal);
  await before.assertHeld();
  const cp=result.sandboxCheckpointCreate;
  if(!cp||text(cp.key)!==key||cp.environmentId!==input.scope.environment_id) throw new RailwayRequestError('UNKNOWN');
  const base:PreparedRailwayBase={schema_version:1,provider:'railway',scope:input.scope,
    preparation_digest:input.manifest.digest,checkpoint:{id:text(cp.id),key},disk_only:true,
    source_native_sandbox_id:input.sandbox_id,source_boot_id:boot,captured_at:instant(new Date(cp.createdAt).toISOString())};
  await hooks.persistCheckpoint(base); return base;
  }finally{await before.release();}
  });
}
export async function buildRailwayTemplate(client:RailwayClient,input:{
  candidate_path:string;manifest:PreparationManifest;scan_policy:unknown;scope:ProviderScope;commands:string[];build_env:Record<string,string>;
},context:ComponentContext):Promise<SandboxTemplate> {
  client.assertScope(input.scope);
  await verifyManifest({candidate_path:input.candidate_path,manifest:input.manifest,scan_policy:input.scan_policy},context);
  if(Date.parse(input.manifest.profile.policy.expires_at)<=Date.now()) throw new Error('Railway preparation expired');
  if(!Array.isArray(input.commands)||!input.commands.length||input.commands.length>256) throw new Error('Railway build steps');
  // Build variables are explicitly nonsecret recipe content; native runtime identity is excluded by11.1.
  const declared=object(input.build_env);
  for(const [key,value] of Object.entries(declared)) {
    if(!/^[A-Z_][A-Z0-9_]*$/.test(key)||/TOKEN|SECRET|PASSWORD|CREDENTIAL|LEASE|ATTEMPT|SESSION/i.test(key))
      throw new Error('Railway build variable');
    text(value,8192);
  }
  const root=context.env.HF_PREPARATION_ALLOWED_ROOT;
  if(!root)throw new Error('Railway preparation root unavailable');
  const recipe=fs.readFileSync(path.join(root,input.candidate_path,input.manifest.profile.recipe.path));
  if('sha256:'+createHash('sha256').update(recipe).digest('hex')!==input.manifest.profile.recipe.digest)
    throw new Error('Railway preparation recipe changed');
  const declaredRecipe=object(JSON.parse(recipe.toString('utf8')),['commands','build_env']);
  if(canonicalJSON(declaredRecipe)!==canonicalJSON({commands:input.commands,build_env:input.build_env}))
    throw new Error('Railway template steps are not the pinned recipe');
  let template=Sandbox.template().withEnv(input.build_env);
  for(const command of input.commands) {
    if(typeof command!=='string'||!command.trim()||command.length>65536||command.includes('\0')) throw new Error('Railway build command');
    template=template.run(command);
  }
  return template.build({...client.sdkOptions(),region:input.scope.region});
}
export function freshRestoreObservation(base:PreparedRailwayBase,child:{
  native_sandbox_id:string;boot_id:string;environment_id:string;region:string;preparation_digest:string;
}):{enrollment_required:true;process_memory_restored:false;authority:'NONE';boot_id:string} {
  text(child.native_sandbox_id);text(child.boot_id,128);
  if(child.native_sandbox_id===base.source_native_sandbox_id||child.boot_id===base.source_boot_id||child.environment_id!==base.scope.environment_id||child.region!==base.scope.region||
    digest(child.preparation_digest)!==base.preparation_digest) throw new Error('Railway restored identity/affinity mismatch');
  return {enrollment_required:true,process_memory_restored:false,authority:'NONE',boot_id:child.boot_id};
}
export async function checkpointByKey(client:RailwayClient,key:string,signal?:AbortSignal):Promise<{id:string;key:string}> {
  const result=await client.request<{sandboxCheckpoints:Array<{id:string;key:string;environmentId:string}>}>(
    'query RailwayCheckpoints($environmentId:String!){sandboxCheckpoints(environmentId:$environmentId){id key environmentId}}',
    {environmentId:client.config.environment_id},signal);
  if(!Array.isArray(result.sandboxCheckpoints)) throw new RailwayRequestError('PROTOCOL');
  const matches=result.sandboxCheckpoints.filter(v=>v.key===text(key)&&v.environmentId===client.config.environment_id);
  if(matches.length!==1) throw new Error('Railway checkpoint key is missing or ambiguous');
  return {id:text(matches[0]!.id),key:text(matches[0]!.key)};
}
export function createComponent(_context:ComponentContext):Component {
  return {apiVersion:1,actions:{
    'railway.preparation.describe':input=>{object(input,[]);return {sdk:RAILWAY_PIN,clone:'DISK_ONLY',
      enrollment:'FRESH_REQUIRED',checkpoint_mutation_identity:'ID',checkpoint_restore_identity:'KEY',authority:'NONE'};},
    'railway.preparation.reference.verify':input=>{
      const v=object(input,['base','scope','preparation_digest']);
      return {valid:true,base:validatePreparedBase(v.base,scope(v.scope),digest(v.preparation_digest)),authority:'NONE'};
    },
    'railway.preparation.restore.observe':input=>{
      const v=object(input,['base','scope','preparation_digest','child']);
      return freshRestoreObservation(validatePreparedBase(v.base,scope(v.scope),digest(v.preparation_digest)),
        object(v.child,['native_sandbox_id','boot_id','environment_id','region','preparation_digest']) as unknown as Parameters<typeof freshRestoreObservation>[1]);
    },
    'railway.preparation.checkpoint.resolve':async(input,context)=>{
      const v=object(input,['key']);const client=configuredClient(context);
      if(client.config.mode!=='component-fixture')throw new Error('Railway live checkpoint lookup requires trusted pool binding');
      return {...await checkpointByKey(client,text(v.key),context.signal),...client.provenance(),authority:'NONE'};
    }
  }};
}
