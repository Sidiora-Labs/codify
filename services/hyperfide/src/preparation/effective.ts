import {createHash} from 'node:crypto';
import {validateProfile,validateManifestMetadata} from './manifests.js';
import type {EnvironmentProfile,PreparationManifest} from './manifests.js';

type FilePin={path:string;digest:string};
type SubmodulePin={path:string;commit:string};
export interface EffectiveResultSource {
 custody_id:string;custody_generation:string;binding_digest:string;
 source_manifest_artifact_id:string;source_manifest_digest:string;
 repository_id:string;source_object_id:string;source_tree_id:string;
}
export interface RegisteredResultRepository {
 repository_id:string;repository_key:string;repository_url:string;
}
export interface MeasuredResultInputs {
 repository_id:string;source_object_id:string;source_tree_id:string;
 submodules:SubmodulePin[];file_pins:FilePin[];observation_artifact_digest:string;
}
export interface EffectiveProfileInput {
 parent:{profile_id:string;preparation_manifest:PreparationManifest};
 result:EffectiveResultSource;
 repository_binding:RegisteredResultRepository;
 measured:MeasuredResultInputs;
 derived_profile_id:string;
}
function refuse():never{throw new Error('EFFECTIVE_PROFILE_INPUT_INVALID');}
function canonical(value:unknown):string{
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null))
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
 return refuse();
}
function hash(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||
  (Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))return refuse();
 const row=value as Record<string,unknown>;
 if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))return refuse();
 return row;
}
function text(value:unknown,pattern:RegExp,max:number):string{
 if(typeof value!=='string'||!value||value.length>max||!pattern.test(value))return refuse();return value;
}
function uuid(value:unknown):string{return text(value,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,36);}
function digest(value:unknown):string{return text(value,/^sha256:[0-9a-f]{64}$/,71);}
function oid(value:unknown):string{return text(value,/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/,64);}
function relative(value:unknown):string{
 const path=text(value,/^[^\x00-\x1f\x7f\\]+$/,4096);
 if(path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..'))return refuse();return path;
}
function pins(profile:EnvironmentProfile):FilePin[]{
 return [profile.recipe,...profile.generated_inputs,...profile.build_config,
  ...profile.package_managers.flatMap(item=>item.locks),...profile.preparation_evidence];
}
/** Metadata transformation only. The caller must obtain the result through the
 * real custody inspector, re-read COMPLETE artifact bytes, and obtain measured
 * pins from actual preparation execution before persisting this derivation.
 * Neither an input digest nor this output grants execution or readiness. */
export function deriveEffectiveProfile(input:EffectiveProfileInput):{
 profile:EnvironmentProfile;profile_digest:string;lineage:Record<string,unknown>;lineage_digest:string;
 dependency_inputs_changed:boolean;requires_preparation:true;readiness_granted:false;
}{
 const top=record(input,['parent','result','repository_binding','measured','derived_profile_id']);
 const parent=record(top.parent,['profile_id','preparation_manifest']);
 const parentId=uuid(parent.profile_id),derivedId=uuid(top.derived_profile_id);
 if(parentId===derivedId)return refuse();
 const rawManifest=parent.preparation_manifest as Record<string,unknown>;
 const manifest=record(rawManifest,rawManifest?.schema_version===2?['schema_version','profile','files','directories','symlinks','hardlinks','scan','digest']:['schema_version','profile','files','directories','scan','digest']);
 if((manifest.schema_version!==1&&manifest.schema_version!==2)||!Array.isArray(manifest.files)||!Array.isArray(manifest.directories)||
  (manifest.schema_version===2&&(!Array.isArray(manifest.symlinks)||!Array.isArray(manifest.hardlinks))))return refuse();
 validateProfile(manifest.profile);
 const parentProfile=manifest.profile as EnvironmentProfile;
 if(derivedId===parentProfile.profile_id)return refuse();
 const {digest:parentDigest,...body}=manifest;
 if(hash(body)!==digest(parentDigest))return refuse();
 const result=record(top.result,['custody_id','custody_generation','binding_digest','source_manifest_artifact_id',
  'source_manifest_digest','repository_id','source_object_id','source_tree_id']);
 uuid(result.custody_id);text(result.custody_generation,/^[1-9][0-9]{0,18}$/,19);
 if(BigInt(result.custody_generation as string)>9223372036854775807n)return refuse();
 digest(result.binding_digest);uuid(result.source_manifest_artifact_id);digest(result.source_manifest_digest);
 const repositoryId=uuid(result.repository_id),commit=oid(result.source_object_id),tree=oid(result.source_tree_id);
 const binding=record(top.repository_binding,['repository_id','repository_key','repository_url']);
 if(uuid(binding.repository_id)!==repositoryId)return refuse();
 const key=text(binding.repository_key,/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,255);
 const matching=parentProfile.repositories.filter(repository=>repository.id===key);
 if(matching.length!==1||matching[0]!.url!==binding.repository_url)return refuse();
 const measured=record(top.measured,['repository_id','source_object_id','source_tree_id','submodules','file_pins','observation_artifact_digest']);
 if(uuid(measured.repository_id)!==repositoryId||oid(measured.source_object_id)!==commit||oid(measured.source_tree_id)!==tree)return refuse();
 digest(measured.observation_artifact_digest);
 if(!Array.isArray(measured.file_pins)||measured.file_pins.length>100000||
    !Array.isArray(measured.submodules)||measured.submodules.length>10000)return refuse();
 const parentFiles=new Map<string,string>();
 for(const value of manifest.files as unknown[]){
  const file=record(value,['path','mode','size','digest']),path=relative(file.path);
  if(parentFiles.has(path)||typeof file.mode!=='number'||!Number.isInteger(file.mode)||file.mode<0||file.mode>511||
   typeof file.size!=='string'||!/^(0|[1-9][0-9]*)$/.test(file.size))return refuse();
  parentFiles.set(path,digest(file.digest));
 }
 const parentPins=new Map(pins(parentProfile).map(pin=>[pin.path,pin.digest]));
 for(const [path,content] of parentPins)if(parentFiles.get(path)!==content)return refuse();
 const measuredPins=new Map<string,string>();
 for(const value of measured.file_pins){
  const pin=record(value,['path','digest']),path=relative(pin.path),content=digest(pin.digest);
  if(measuredPins.has(path)||!parentPins.has(path))return refuse();
  measuredPins.set(path,content);
 }
 if(parentPins.size!==measuredPins.size)return refuse();
 const modules:SubmodulePin[]=[];const modulePaths=new Set<string>();
 for(const value of measured.submodules){
  const module=record(value,['path','commit']),path=relative(module.path);
  if(modulePaths.has(path))return refuse();modulePaths.add(path);modules.push({path,commit:oid(module.commit)});
 }
 modules.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const profile=structuredClone(parentProfile);
 profile.profile_id=derivedId;
 const changes=[...parentPins].filter(([path,prior])=>measuredPins.get(path)!==prior)
  .map(([path,prior])=>({path,parent_digest:prior,result_digest:measuredPins.get(path)!}))
  .sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const resultBinding={custody_id:result.custody_id,custody_generation:result.custody_generation,
  binding_digest:result.binding_digest,source_manifest_artifact_id:result.source_manifest_artifact_id,
  source_manifest_digest:result.source_manifest_digest,repository_id:repositoryId,
  source_object_id:commit,source_tree_id:tree};
 const lineage={schema_version:1,parent_profile_id:parentId,parent_profile_key:parentProfile.profile_id,parent_profile_digest:hash(parentProfile),
  parent_preparation_digest:parentDigest,derived_profile_id:derivedId,result:resultBinding,
  repository_binding:{repository_id:repositoryId,repository_key:key,repository_url:binding.repository_url},
  observation_artifact_digest:measured.observation_artifact_digest,
  measured_file_pins:[...measuredPins].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,digest])=>({path,digest})),
  measured_submodules:modules,changed_inputs:changes};
 profile.profile_version='result-'+hash(lineage).slice(7);
 const target=profile.repositories.find(repository=>repository.id===key)!;
 target.commit=commit;target.submodules=modules;
 for(const pin of pins(profile))pin.digest=measuredPins.get(pin.path)!;
 // All OS, runtime, resource, network, credential references, expiry and policy
 // constraints remain inherited. New source never silently upgrades their scope.
 validateProfile(profile);
 return {profile,profile_digest:hash(profile),lineage,lineage_digest:hash(lineage),
  dependency_inputs_changed:changes.length>0,requires_preparation:true,readiness_granted:false};
}

export interface PreparationRecipePolicy {
 schema_version:1;kind:'hyperfide.preparation-policy';
 commands:{repository:string;argv:string[];timeout_seconds:number}[];
 cache_scope:string;cache_paths:{repository:string;path:string}[];
 minimum_free_bytes:string;minimum_free_inodes:string;network_timeout_milliseconds:number;
}
function policyError(code:string):never{throw new Error(code);}
function policyKeys(source:string):void{
 const frames:(Set<string>|null)[]=[];
 for(let i=0;i<source.length;i++){
  const character=source[i];
  if(character==='{')frames.push(new Set());else if(character==='[')frames.push(null);
  else if(character==='}'||character===']')frames.pop();
  else if(character==='"'){
   const begin=i;for(i++;i<source.length;i++){if(source[i]==='\\')i++;else if(source[i]==='"')break;}
   let next=i+1;while(/\s/.test(source[next]??'')&&next<source.length)next++;
   const frame=frames[frames.length-1];
   if(source[next]===':'&&frame){const key=JSON.parse(source.slice(begin,i+1));if(frame.has(key))policyError('PREPARATION_POLICY_UNSUPPORTED');frame.add(key);}
  }
 }
}
/** The approved manifest pins these policy bytes; this pure parser grants no execution authority. */
export function readPreparationRecipePolicy(parent:PreparationManifest,recipeBytes:Uint8Array):PreparationRecipePolicy {
 const manifest=validateManifestMetadata(parent),bytes=Buffer.from(recipeBytes);
 if(bytes.length<2||bytes.length>262144)policyError('PREPARATION_POLICY_UNSUPPORTED');
 if('sha256:'+createHash('sha256').update(bytes).digest('hex')!==manifest.profile.recipe.digest)policyError('PREPARATION_POLICY_DIGEST_MISMATCH');
 const source=bytes.toString('utf8');if(!Buffer.from(source,'utf8').equals(bytes))policyError('PREPARATION_POLICY_UNSUPPORTED');
 let parsed:unknown;try{parsed=JSON.parse(source);policyKeys(source);}catch{policyError('PREPARATION_POLICY_UNSUPPORTED');}
 let row:Record<string,unknown>;
 try{row=record(parsed,['schema_version','kind','commands','cache_scope','cache_paths','minimum_free_bytes','minimum_free_inodes','network_timeout_milliseconds']);}
 catch{policyError('PREPARATION_POLICY_UNSUPPORTED');}
 if(row.schema_version!==1||row.kind!=='hyperfide.preparation-policy'||!Array.isArray(row.commands)||row.commands.length>64||!Array.isArray(row.cache_paths)||row.cache_paths.length>128)policyError('PREPARATION_POLICY_UNSUPPORTED');
 const repositories=new Set(manifest.profile.repositories.map(repository=>repository.id));let lifetime=0;
 const commands=row.commands.map(value=>{
  let command:Record<string,unknown>;try{command=record(value,['repository','argv','timeout_seconds']);}catch{policyError('PREPARATION_POLICY_UNSUPPORTED');}
  if(typeof command.repository!=='string'||!repositories.has(command.repository)||!Array.isArray(command.argv)||!command.argv.length||command.argv.length>64||
   typeof command.timeout_seconds!=='number'||!Number.isSafeInteger(command.timeout_seconds)||command.timeout_seconds<1||command.timeout_seconds>3600)policyError('PREPARATION_POLICY_UNSUPPORTED');
  let total=0;const argv=command.argv.map((argument,index)=>{
   if(typeof argument!=='string'||argument.includes('\0')||Buffer.byteLength(argument)>4096||(index===0&&!argument.length))policyError('PREPARATION_POLICY_UNSUPPORTED');
   total+=Buffer.byteLength(argument);return argument;
  });
  if(total>65536)policyError('PREPARATION_POLICY_UNSUPPORTED');lifetime+=command.timeout_seconds;
  return {repository:command.repository,argv,timeout_seconds:command.timeout_seconds};
 });
 if(lifetime>manifest.profile.policy.max_process_lifetime_seconds)policyError('PREPARATION_POLICY_UNSUPPORTED');
 if(typeof row.cache_scope!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(row.cache_scope))policyError('PREPARATION_POLICY_UNSUPPORTED');
 const seen=new Set<string>();
 const cache_paths=row.cache_paths.map(value=>{
  let item:Record<string,unknown>;try{item=record(value,['repository','path']);}catch{policyError('PREPARATION_POLICY_UNSUPPORTED');}
  if(typeof item.repository!=='string'||!repositories.has(item.repository))policyError('PREPARATION_POLICY_UNSUPPORTED');
  let name:string;try{name=relative(item.path);}catch{policyError('PREPARATION_POLICY_UNSUPPORTED');}
  if(name.split('/').some(part=>['.env','.npmrc','.netrc','.ssh','.aws','.codex','.claude','.git'].some(unsafe=>part===unsafe||part.startsWith(unsafe+'.'))))policyError('PREPARATION_POLICY_UNSUPPORTED');
  const key=item.repository+'/'+name;if(seen.has(key))policyError('PREPARATION_POLICY_UNSUPPORTED');seen.add(key);
  return {repository:item.repository,path:name};
 });
 const storage=(value:unknown):string=>{
  if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(value)||BigInt(value)>9223372036854775807n)policyError('PREPARATION_POLICY_UNSUPPORTED');return value;
 };
 const network=row.network_timeout_milliseconds;if(typeof network!=='number'||!Number.isSafeInteger(network)||network<100||network>10000)policyError('PREPARATION_POLICY_UNSUPPORTED');
 return {schema_version:1,kind:'hyperfide.preparation-policy',commands,cache_scope:row.cache_scope,cache_paths,
 minimum_free_bytes:storage(row.minimum_free_bytes),minimum_free_inodes:storage(row.minimum_free_inodes),network_timeout_milliseconds:network};
}
