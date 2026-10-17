import type { CreateOptions, SandboxInfo } from 'railway';
import type { Component, ComponentContext } from '../../components/registry.js';
import type { ProviderScope, ProviderOperation } from '../contract.js';
import { absolute, digest, hash, integer, object, sameScope, scope, text, type JsonObject, type RailwayClient } from './preparation.js';

export interface RailwayRuntimeProfile {
  schema_version:1; scope:ProviderScope; preparation_digest:string;
  source:{kind:'FRESH';reference:null;environment_id:null;region:null}|{
    kind:'FORK'|'CHECKPOINT';reference:string;environment_id:string;region:string};
  resources:{cpu_millis:number;memory_bytes:string;disk_bytes:string;persistent_volume_bytes:string};
  idle_timeout_minutes:number; network:'ISOLATED'|'PRIVATE'; domains:Array<{port:number;prefix:string|null}>;
  runtime_variables:Record<string,{kind:'PUBLIC'|'SECRET_REFERENCE';value:string}>;
  build_variables:Record<string,string>; digest:string;
}
function bytes(value:unknown,positive=false):string {
  const out=text(value,19);
  if(!/^(0|[1-9][0-9]*)$/.test(out)||BigInt(out)>9223372036854775807n||(positive&&out==='0')) throw new Error('Railway bytes');
  return out;
}
export function validateRuntimeProfile(value:unknown):RailwayRuntimeProfile {
  const v=object(value,['schema_version','scope','preparation_digest','source','resources','idle_timeout_minutes','network',
    'domains','runtime_variables','build_variables','digest']);
  if(v.schema_version!==1) throw new Error('Railway runtime schema');
  const s=scope(v.scope);digest(v.preparation_digest);
  const source=object(v.source,['kind','reference','environment_id','region']);
  if(source.kind==='FRESH') {
    if(source.reference!==null||source.environment_id!==null||source.region!==null) throw new Error('Railway fresh source');
  } else {
    if(source.kind!=='FORK'&&source.kind!=='CHECKPOINT') throw new Error('Railway source kind');
    text(source.reference);
    if(source.environment_id!==s.environment_id||source.region!==s.region) throw new Error('Railway source placement affinity');
  }
  const resources=object(v.resources,['cpu_millis','memory_bytes','disk_bytes','persistent_volume_bytes']);
  integer(resources.cpu_millis,1);bytes(resources.memory_bytes,true);bytes(resources.disk_bytes);bytes(resources.persistent_volume_bytes);
  // SDK offers no persistent-volume sizing. Never pretend it applied such a request.
  if(resources.persistent_volume_bytes!=='0') throw new Error('Railway persistent volume capability unsupported');
  if(BigInt(resources.memory_bytes as string)>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Railway memory precision unsupported');
  integer(v.idle_timeout_minutes,0,10080);
  if(v.network!=='ISOLATED'&&v.network!=='PRIVATE') throw new Error('Railway network');
  if(!Array.isArray(v.domains)||v.domains.length>64) throw new Error('Railway domains');
  const ports=new Set<number>(),prefixes=new Set<string>();
  for(const item of v.domains) {
    const domain=object(item,['port','prefix']);const port=integer(domain.port,1,65535);
    if(ports.has(port)||v.network!=='PRIVATE') throw new Error('Railway domain isolation/duplicate');
    ports.add(port);
    if(domain.prefix!==null) {
      const prefix=text(domain.prefix,63);
      if(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(prefix)||prefixes.has(prefix)) throw new Error('Railway domain prefix');
      prefixes.add(prefix);
    }
  }
  const runtime=object(v.runtime_variables);
  if(Object.keys(runtime).length>256) throw new Error('Railway variables bound');
  for(const [name,raw] of Object.entries(runtime)) {
    if(!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)||/^RAILWAY_(API_TOKEN|TOKEN|PROJECT_TOKEN)$/.test(name))
      throw new Error('Railway runtime variable name');
    const variable=object(raw,['kind','value']);text(variable.value,32768);
    if(variable.kind==='SECRET_REFERENCE') {
      if(!/^secret-ref:[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(variable.value as string)) throw new Error('Railway secret reference');
    } else if(variable.kind!=='PUBLIC'||/TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|PRIVATE_KEY/i.test(name))
      throw new Error('Railway public secret-like variable');
  }
  for(const [name,raw] of Object.entries(object(v.build_variables))) {
    if(!/^[A-Z_][A-Z0-9_]*$/.test(name)||/TOKEN|SECRET|PASSWORD|CREDENTIAL|SESSION|LEASE|ATTEMPT/i.test(name))
      throw new Error('Railway build variable');
    text(raw,8192);
  }
  const body={...v};delete body.digest;
  if(digest(v.digest)!==hash(body)) throw new Error('Railway runtime profile digest');
  return v as unknown as RailwayRuntimeProfile;
}
export type CredentialResolver=(references:Readonly<Record<string,string>>,signal:AbortSignal,layer?:'runtime'|'process',operation?:ProviderOperation)=>Promise<Record<string,string>>;
export async function runtimeOptions(profile:RailwayRuntimeProfile,client:RailwayClient,resolve:CredentialResolver,
  signal:AbortSignal):Promise<CreateOptions> {
  client.assertScope(profile.scope);
  const refs:Record<string,string>={},env:Record<string,string>={};
  for(const [name,variable] of Object.entries(profile.runtime_variables)) {
    if(variable.kind==='PUBLIC') env[name]=variable.value; else refs[name]=variable.value;
  }
  const values=await resolve(Object.freeze(refs),signal,'runtime');
  if(Object.keys(values).length!==Object.keys(refs).length||Object.keys(values).some(key=>!Object.hasOwn(refs,key)))
    throw new Error('Railway credential resolution inventory mismatch');
  for(const name of Object.keys(refs)) {
    const value=values[name];
    if(typeof value!=='string'||!value||value.length>65536||value.includes('\0')) throw new Error('Railway credential unavailable');
    env[name]=value;
  }
  return {...client.sdkOptions(),environmentId:profile.scope.environment_id,
    // Region omitted for data-derived creation; same-region affinity was checked above.
    ...(profile.source.kind==='FRESH'?{region:profile.scope.region}:{}),
    resources:{cpu:profile.resources.cpu_millis/1000,memoryGB:Number(profile.resources.memory_bytes)/1_000_000_000},
    idleTimeoutMinutes:profile.idle_timeout_minutes,networkIsolation:profile.network,
    domains:profile.domains.map(item=>({port:item.port,...(item.prefix===null?{}:{prefix:item.prefix})})),env};
}
export function runtimeGraphQLInput(profile:RailwayRuntimeProfile,options:CreateOptions):JsonObject {
  const input:JsonObject={environmentId:profile.scope.environment_id,
    resources:options.resources,idleTimeoutMinutes:options.idleTimeoutMinutes,
    networkIsolation:options.networkIsolation,publicDomains:options.domains,variables:options.env};
  if(profile.source.kind==='FRESH') input.region=profile.scope.region;
  else if(profile.source.kind==='FORK') input.sourceSandboxId=profile.source.reference;
  else input.template={name:profile.source.reference};
  return input;
}
export function observeRuntimeProfile(profile:RailwayRuntimeProfile,observed:unknown):{
  provider_configuration_matches:boolean;runner_attestation_required:true;resources_verified:false;variables_verified:false;
  profile_digest:string;authority:'NONE';
} {
  const v=object(observed,['id','status','networkIsolation','environmentId','region','idleTimeoutMinutes','domains','createdAt']);
  text(v.id);text(v.status);text(v.createdAt);
  const expectedDomains=profile.domains;
  if(!Array.isArray(v.domains)) throw new Error('Railway observed domains');
  const actual=v.domains.map(item=>object(item,['prefix','port','domain']));
  const matches=v.environmentId===profile.scope.environment_id&&v.region===profile.scope.region&&
    v.networkIsolation===profile.network&&v.idleTimeoutMinutes===profile.idle_timeout_minutes&&
    actual.length===expectedDomains.length&&expectedDomains.every(domain=>actual.some(item=>
      item.port===domain.port&&(domain.prefix===null||item.prefix===domain.prefix)));
  // SandboxInfo omits actual resources/runtime env. RUNNING cannot prove them.
  return {provider_configuration_matches:matches,runner_attestation_required:true,resources_verified:false,
    variables_verified:false,profile_digest:profile.digest,authority:'NONE'};
}
export function createComponent(_context:ComponentContext):Component {
  return {apiVersion:1,actions:{
    'railway.profile.validate':input=>{
      const value=object(input,['profile']);const profile=validateRuntimeProfile(value.profile);
      return {valid:true,profile_digest:profile.digest,source:profile.source,
        applied_options:['resources','idleTimeoutMinutes','networkIsolation','domains','env'],
        runtime_variable_names:Object.keys(profile.runtime_variables).sort(),authority:'NONE'};
    },
    'railway.profile.observe':input=>{
      const value=object(input,['profile','observed']);return observeRuntimeProfile(validateRuntimeProfile(value.profile),value.observed);
    }
  }};
}
