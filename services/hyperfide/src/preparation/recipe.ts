import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {FoundationError} from '../policy/programme.js';
import {canonicalJSON,validateManifestMetadata} from './manifests.js';
import type {PreparationManifest} from './manifests.js';
import {readPreparationRecipePolicy} from './effective.js';
import type {PreparationRecipePolicy} from './effective.js';

export type PreparationJobClass='PREPARATION'|'INDEX';
/** Deterministic remote job plan; the 11.1 manifest digest is the reusable preparation identity. */
export interface PreparationPlan {
 schema_version:1;kind:'hyperfide.preparation-plan';job_class:PreparationJobClass;
 placement:{job_class:'dependency_preparation'|'indexing';location:'REMOTE_EXECUTION'};
 profile_id:string;profile_version:string;preparation_digest:string;configuration_digest:string;recipe_digest:string;
 toolchain_digest:string;lock_digest:string;source_digest:string;
 repositories:{id:string;commit:string;submodules:{path:string;commit:string}[];lfs:boolean}[];
 policy:PreparationRecipePolicy;
}
export interface ResolvedPreparation {identity:string;plan:PreparationPlan;plan_digest:string;recipe_digest:string}

function fail(code:string,message:string):never{throw new FoundationError(code,message);}
const sha=(value:string|Uint8Array)=>'sha256:'+createHash('sha256').update(value).digest('hex');
export const planDigest=(plan:PreparationPlan)=>sha(canonicalJSON(plan));

/** Bytes come from the operator-owned recipe store and must match the digest pinned by the manifest. */
export async function readTrustedRecipe(env:Readonly<NodeJS.ProcessEnv>,digest:string):Promise<Uint8Array>{
 const root=env.HYPERFIDE_PREPARATION_RECIPE_DIR;
 if(!root||!path.isAbsolute(root))fail('PREPARATION_RECIPE_UNAVAILABLE','A trusted preparation recipe store is required');
 if(!/^sha256:[0-9a-f]{64}$/.test(digest))fail('PREPARATION_RECIPE_UNAVAILABLE','Pinned recipe digest is invalid');
 const filename=path.join(root,digest.slice(7)+'.json');
 let bytes:Buffer;
 try{
  const info=await fs.lstat(filename);
  if(!info.isFile()||info.isSymbolicLink()||info.size>262144)fail('PREPARATION_RECIPE_UNAVAILABLE','Recipe must be a bounded regular file');
  bytes=await fs.readFile(filename);
 }catch(error){if(error instanceof FoundationError)throw error;fail('PREPARATION_RECIPE_UNAVAILABLE','Pinned recipe is absent from the trusted store');}
 return bytes;
}

/**
 * Pure resolution: the same manifest, recipe bytes, pool configuration and job class always yield
 * the same plan digest. A changed recipe, toolchain, lock or source pin changes the manifest digest.
 */
export function resolvePreparationPlan(input:{manifest:unknown;recipe:Uint8Array;configuration_digest:string;job_class:PreparationJobClass}):ResolvedPreparation{
 let manifest:PreparationManifest;
 try{manifest=validateManifestMetadata(input.manifest);}
 catch{fail('PREPARATION_MANIFEST_INVALID','Accepted profile is not a complete verified preparation manifest');}
 if(!['PREPARATION','INDEX'].includes(input.job_class))fail('INVALID_REQUEST','Explicit preparation job class required');
 if(!/^sha256:[0-9a-f]{64}$/.test(input.configuration_digest))fail('INVALID_REQUEST','Pool configuration digest required');
 let policy:PreparationRecipePolicy;
 try{policy=readPreparationRecipePolicy(manifest,input.recipe);}
 catch(error){
  // The shared parser reports plain coded errors; surface them as typed refusals, never storage faults.
  const code=error instanceof Error&&/^PREPARATION_POLICY_[A-Z_]+$/.test(error.message)?error.message:'PREPARATION_POLICY_UNSUPPORTED';
  fail(code,'Pinned preparation recipe policy was refused');
 }
 const profile=manifest.profile;
 const plan:PreparationPlan={schema_version:1,kind:'hyperfide.preparation-plan',job_class:input.job_class,
  placement:{job_class:input.job_class==='INDEX'?'indexing':'dependency_preparation',location:'REMOTE_EXECUTION'},
  profile_id:profile.profile_id,profile_version:profile.profile_version,preparation_digest:manifest.digest,
  configuration_digest:input.configuration_digest,recipe_digest:profile.recipe.digest,
  toolchain_digest:sha(canonicalJSON({os:profile.os,image:profile.image,toolchains:profile.toolchains,system_packages:profile.system_packages,
   package_managers:profile.package_managers.map(item=>({name:item.name,version:item.version}))})),
  lock_digest:sha(canonicalJSON(profile.package_managers.map(item=>({name:item.name,locks:item.locks})))),
  source_digest:sha(canonicalJSON(profile.repositories)),
  repositories:profile.repositories.map(repository=>({id:repository.id,commit:repository.commit,submodules:repository.submodules,lfs:repository.lfs})),
  policy};
 return {identity:manifest.digest,plan,plan_digest:planDigest(plan),recipe_digest:profile.recipe.digest};
}
