import {createHash} from 'node:crypto';
import {validateProfile} from './manifests.js';
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
