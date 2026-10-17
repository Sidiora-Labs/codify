import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createManifest,canonicalJSON} from './manifests.js';
import {deriveEffectiveProfile,readPreparationRecipePolicy} from './effective.js';

const hash=(b:Uint8Array|string)=>'sha256:'+createHash('sha256').update(b).digest('hex');
type Data=Record<string,any>;
/** Release-pinned recipe. Only the privileged native stager supplies its context;
 * no coordinator credentials or arbitrary environment enter the slot process. */
async function prepare(filename:string):Promise<void>{
 const context=JSON.parse(await fs.readFile(filename,'utf8')) as Data;
 const refs=new Map<string,string>(context.staging.map((r:Data)=>[r.role,r.path]));
 const read=async(role:string)=>JSON.parse(await fs.readFile(refs.get(role)!,'utf8'));
 const control=await read('input-manifest'),parent=await read('parent-manifest'),trusted=await read('readiness-context');
 const target=context.target_binding,workspace=target.workspace_path;
 await fs.mkdir(workspace,{mode:0o700});
 const git=(cwd:string,...args:string[])=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','maintenance.auto=false','-c','gc.auto=0',...args],
  {cwd,encoding:'utf8',timeout:30000,env:{PATH:'/usr/bin:/bin',HOME:target.home_path,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
 for(const repository of parent.profile.repositories){
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository.id))throw new Error('Unsupported repository key');
  const root=path.join(workspace,repository.id);
  await fs.mkdir(root,{mode:0o700});git(root,'init','-q');
  git(root,'fetch',refs.get('source:'+repository.id)!,repository.id===control.repository_binding.repository_key?control.result.source_object_id:repository.commit);
  git(root,'checkout','-q','--detach','FETCH_HEAD');
  if(repository.submodules.length||repository.lfs)throw new Error('Result submodule/LFS materialisation is unavailable');
 }
 const repositoryRoot=path.join(workspace,control.repository_binding.repository_key);
 const pins=[...new Map<string,Data>([parent.profile.recipe,...parent.profile.generated_inputs,...parent.profile.build_config,
  ...parent.profile.package_managers.flatMap((p:Data)=>p.locks),...parent.profile.preparation_evidence].map((pin:Data)=>[pin.path,pin])).values()];
 const measured={repository_id:control.result.repository_id,source_object_id:git(repositoryRoot,'rev-parse','HEAD'),
  source_tree_id:git(repositoryRoot,'rev-parse','HEAD^{tree}'),submodules:[],file_pins:[] as Data[]};
 for(const pin of pins){
  const source=path.resolve(repositoryRoot,pin.path);
  if(!source.startsWith(repositoryRoot+'/')||!(await fs.realpath(source)).startsWith(repositoryRoot+'/')||
   (await fs.lstat(source)).isSymbolicLink())throw new Error('Unsafe preparation pin');
  const bytes=await fs.readFile(source);measured.file_pins.push({path:pin.path,digest:hash(bytes)});
  const destination=path.join(workspace,pin.path);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);
 }
 const measurement=Buffer.from(canonicalJSON(measured)+'\n');
 const derived=deriveEffectiveProfile({parent:{profile_id:control.parent_profile_id,preparation_manifest:parent},result:control.result,
  repository_binding:control.repository_binding,derived_profile_id:control.derived_profile_id,
  measured:{...measured,observation_artifact_digest:hash(measurement)} as any});
 const recipe=await fs.readFile(path.join(workspace,derived.profile.recipe.path));
 const policy=readPreparationRecipePolicy(parent,recipe);
 for(const command of policy.commands)execFileSync(command.argv[0]!,command.argv.slice(1),{cwd:path.join(workspace,command.repository),
  timeout:command.timeout_seconds*1000,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:target.home_path,TMPDIR:target.tmp_path}});
 const inventoryContext={env:{HF_PREPARATION_ALLOWED_ROOT:path.dirname(workspace)},signal:new AbortController().signal};
 const manifest=await createManifest({candidate_path:path.basename(workspace),profile:derived.profile,scan_policy:trusted.scan},inventoryContext);
 const base=path.join(context.out_root,'base'),manifests=path.join(context.out_root,'manifests');
 await fs.mkdir(base);await fs.mkdir(manifests);
 const candidate=path.join(base,'candidate');await fs.mkdir(candidate);
 for(const pin of pins){const destination=path.join(candidate,pin.path);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(workspace,pin.path),destination);}
 const baseManifest=await createManifest({candidate_path:'candidate',profile:derived.profile,scan_policy:trusted.scan},
  {env:{HF_PREPARATION_ALLOWED_ROOT:base},signal:new AbortController().signal});
 const write=async(name:string,value:unknown)=>{const filename=path.join(context.out_root,name);await fs.writeFile(filename,canonicalJSON(value)+'\n',{mode:0o600});return filename;};
 await fs.writeFile(path.join(manifests,'manifest.json'),canonicalJSON(baseManifest)+'\n');
 const workspaceFile=await write('workspace.json',manifest),scan=await write('scan.json',trusted.scan),tools=await write('tools.json',trusted.tools);
 const scope={run_id:target.run_id,actor_id:target.target_runner_session_id,attempt_id:null};
 const credentials=await write('credentials.json',trusted.credentials),scopeFile=await write('scope.json',scope);
 const request={schema_version:1,workspace:path.basename(workspace),base:'candidate',manifest:'manifest.json',boot_id:target.boot_id,
  profile_digest:derived.profile_digest,preparation_digest:baseManifest.digest,minimum_free_bytes:policy.minimum_free_bytes,
  minimum_free_inodes:policy.minimum_free_inodes,network_timeout_milliseconds:policy.network_timeout_milliseconds};
 const module=fileURLToPath(new URL('./manifests.js',import.meta.url));
 const env={PATH:'/usr/local/bin:/usr/bin:/bin',HF_EXECUTION_HOST_CLASS:'remote',HF_PREPARATION_WORKSPACE_ROOT:path.dirname(workspace),
  HF_PREPARATION_BASE_ROOT:base,HF_PREPARATION_MANIFEST_ROOT:manifests,HF_READINESS_DIAGNOSTICS_ROOT:context.diagnostics_root,
  HF_READINESS_MODULE_PATH:module,HF_READINESS_MODULE_DIGEST:hash(await fs.readFile(module)),
  HF_READINESS_NODE_EXECUTABLE:process.execPath,HF_READINESS_NODE_DIGEST:hash(await fs.readFile(process.execPath)),
  HF_READINESS_SCAN_POLICY_FILE:scan,HF_READINESS_TOOL_BINDINGS_FILE:tools,HF_CREDENTIAL_AVAILABILITY_FILE:credentials,
  HF_INVOCATION_SCOPE_FILE:scopeFile,HF_SANDBOX_BOOT_ID:target.boot_id,HF_RUNNER_PROFILE_DIGEST:derived.profile_digest,
  HF_RUNNER_PREPARATION_DIGEST:baseManifest.digest,HF_READINESS_WORKSPACE_MANIFEST_FILE:workspaceFile,HF_RUNNER_WORKSPACE_DIGEST:manifest.digest};
 const stdout=execFileSync(trusted.native_path,['--component','11.3','--action','environment.readiness'],
  {input:JSON.stringify(request),env,timeout:30000,encoding:'utf8'});
 const observed=JSON.parse(stdout);if(!observed.ok||observed.result.state!=='READY')throw new Error('Native result readiness refused: '+JSON.stringify(observed.error??{state:observed.result.state,reason:observed.result.reason}));
 process.stdout.write(canonicalJSON({schema_version:1,measurement_base64:measurement.toString('base64'),manifest:baseManifest,
  workspace_manifest:manifest,readiness_input:request,readiness:observed.result,readiness_environment:env})+'\n');
}
if(process.argv[2]==='--job-context')prepare(process.argv[3]!).catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
