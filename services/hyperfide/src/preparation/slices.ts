import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {Component,ComponentContext} from '../components/registry.js';
import type {InvocationContext} from '../transport/protocol.js';
import type {PrimaryTransaction,QuerySession} from '../storage/transactions.js';
import {readSemanticDisposition} from '../storage/dispositions.js';
import {FoundationError,object} from '../policy/programme.js';
import {canonicalJSON} from './manifests.js';

/**
 * Packet-scoped workspace slices (task 11.5).
 * Control derives an immutable slice manifest from the exact packet and its pinned published graph; a slice that cannot
 * prove its closure is an explicit FULL_TREE manifest with a recorded reason. Only the remote provisioner clones,
 * materialises (partial clone + no-cone sparse checkout) and runs commands. Slice results never claim full-tree
 * qualification, and every detected out-of-slice access is persisted as REFUSED or as an explicit WIDENED manifest.
 */
export const SLICE_ACTIONS=Object.freeze(['preparation.slice.describe','preparation.slice.derive','preparation.slice.widen','preparation.slice.inspect',
 'preparation.slice.materialize','preparation.slice.run','preparation.slice.release'] as const);
const DERIVE_ROLES=['OPERATOR','COORDINATOR','LEADER','FEATURE_MANAGER'],READ_ROLES=[...DERIVE_ROLES,'VERIFIER','INTEGRATOR','PROVISIONER'],REMOTE_ROLES=['PROVISIONER','OPERATOR'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,DIGEST=/^sha256:[0-9a-f]{64}$/,OID=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/,CODE=/^[A-Z][A-Z0-9_]{2,63}$/;
const LFS_HEADER='version https://git-lfs.github.com/spec/v1\n';
// Sized for a >25,000-file, >10M LOC monorepo: the whole pinned graph is loaded once and closed to a fixpoint in memory.
export const DEFAULT_BUDGET=Object.freeze({files:100000,edges:4000000,graph_rows:8000000});
const BUILD_ROOT_NAMES=new Set(['package.json','package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','pnpm-workspace.yaml','yarn.lock','tsconfig.json',
 'go.mod','go.sum','go.work','go.work.sum','Cargo.toml','Cargo.lock','CMakeLists.txt','Makefile','GNUmakefile','makefile','meson.build','configure.ac',
 'pyproject.toml','setup.py','setup.cfg','requirements.txt','poetry.lock','uv.lock','Pipfile','Pipfile.lock','pom.xml','build.gradle','build.gradle.kts',
 'settings.gradle','settings.gradle.kts','gradle.properties','Gemfile','Gemfile.lock','BUILD','BUILD.bazel','WORKSPACE','WORKSPACE.bazel','MODULE.bazel','.bazelrc','.bazelversion']);
const FIXTURE_DIRECTORIES=['fixtures','testdata','__fixtures__','__snapshots__'];
const TEST_PATH=/(^|\/)(tests?|__tests__|spec)\/|(^|\/)test_[^/]*$|_test\.[^/]+$|\.(test|spec)\.[^/]+$|(^|\/)[^/]*Test\.(java|kt)$/;

function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function sha(value:Buffer|string):string{return 'sha256:'+createHash('sha256').update(value).digest('hex');}
function hash(value:unknown):string{return sha(canonicalJSON(value));}
function record(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 if(!object(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))
  fail('SLICE_INPUT_INVALID','Fields differ from the versioned slice contract');
 return value;
}
function uuid(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))fail('SLICE_INPUT_INVALID','Canonical UUID required');return value;}
function digest(value:unknown):string{if(typeof value!=='string'||!DIGEST.test(value))fail('SLICE_INPUT_INVALID','SHA-256 digest required');return value;}
function oid(value:unknown):string{if(typeof value!=='string'||!OID.test(value))fail('SLICE_INPUT_INVALID','Full Git object identity required');return value;}
function code(value:unknown):string{if(typeof value!=='string'||!CODE.test(value))fail('SLICE_INPUT_INVALID','Upper-case reason code required');return value;}
function decimal(value:unknown):string{if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/.test(value))fail('SLICE_INPUT_INVALID','Positive decimal required');return value;}
/** Normalised repository-relative path: no absolute, `..`, `.`, empty, backslash, control or glob segments. */
export function slicePath(value:unknown,allowDirectory=false):string{
 if(typeof value!=='string'||!value.length||value.length>4096||/[\x00-\x1f\x7f\\]/.test(value))fail('SLICE_PATH_INVALID','Bounded relative path required');
 const directory=value.endsWith('/'),body=directory?value.slice(0,-1):value;
 if(directory&&!allowDirectory)fail('SLICE_PATH_INVALID','A file path is required');
 if(!body.length||body.startsWith('/')||body.split('/').some(part=>!part||part==='.'||part==='..'))fail('SLICE_PATH_INVALID','Normalised relative path required');
 if(body==='.git'||body.startsWith('.git/')||body.includes('/.git/')||body.endsWith('/.git'))fail('SLICE_PATH_INVALID','Repository metadata is not a slice path');
 return directory?body+'/':body;
}
function paths(value:unknown,allowDirectory:boolean,maximum=4096):string[]{
 if(!Array.isArray(value)||value.length>maximum)fail('SLICE_INPUT_INVALID','Bounded path list required');
 return [...new Set(value.map(item=>slicePath(item,allowDirectory)))].sort(compare);
}
function compare(a:string,b:string):number{return a<b?-1:a>b?1:0;}
function ancestors(file:string):string[]{const parts=file.split('/'),result=[''];for(let i=1;i<parts.length;i++)result.push(parts.slice(0,i).join('/')+'/');return result;}

export interface SliceManifestBody {
 schema_version:1;kind:'hyperfide.workspace-slice';packet_digest:string;repository_id:string;commit:string;
 graph_manifest_id:string|null;graph_manifest_digest:string|null;mode:'SLICE'|'FULL_TREE';fallback_reason:string|null;
 included_paths:string[];excluded_roots:string[];build_roots:string[];metadata_roots:string[];
 submodules:{path:string;commit:string}[];lfs_paths:string[];
 closure:{complete:boolean;seeds:number;files:number;edges:number;unresolved:number;truncated:boolean;tests:number;fixtures:number};
 diagnostics:{code:string;path:string|null}[];input_roots:{contracts:string[];registries:string[]};budget:{files:number;edges:number};
 slot:{sandbox_id:string;slot_id:string;sandbox_boot_generation:string};parent_slice_digest:string|null;
 widening:{added_paths:string[];reason:string}|null;
}
export interface SliceManifest extends SliceManifestBody {digest:string}
export interface SliceReceipt {
 schema_version:1;kind:'hyperfide.workspace-slice-receipt';slice_digest:string;materialisation_id:string;commit:string;graph_manifest_digest:string|null;
 mode:'SLICE'|'FULL_TREE';fallback_reason:string|null;qualification_scope:'SLICE'|'FULL_TREE';full_tree_equivalent:boolean;
 qualification_outcome:'PASS'|'FAIL'|'REFUSED';[key:string]:unknown;
}
/** Exact membership: listed files, or anything below a listed `dir/`. FULL_TREE includes everything. */
export function sliceIncludes(manifest:Pick<SliceManifestBody,'mode'|'included_paths'>,file:string):boolean{
 if(manifest.mode==='FULL_TREE')return true;
 return manifest.included_paths.some(entry=>entry===file||(entry.endsWith('/')&&file.startsWith(entry)));
}
/** Inputs a later full-tree run observed that this slice did not contain. */
export function omittedInputs(manifest:Pick<SliceManifestBody,'mode'|'included_paths'>,fullTreePaths:readonly string[]):string[]{
 return [...new Set(fullTreePaths.map(value=>slicePath(value)))].filter(file=>!sliceIncludes(manifest,file)).sort(compare);
}
/** A slice receipt is never full-tree qualification; returns the slice identity a full-tree run must compare against. */
export function assertNotFullTreeQualification(receipt:unknown):{slice_digest:string;commit:string;graph_manifest_digest:string|null;mode:'SLICE'|'FULL_TREE';fallback_reason:string|null}{
 if(!object(receipt)||receipt.kind!=='hyperfide.workspace-slice-receipt'||typeof receipt.slice_digest!=='string'||!DIGEST.test(receipt.slice_digest)||
    typeof receipt.commit!=='string'||!OID.test(receipt.commit))fail('SLICE_RECEIPT_INVALID','Receipt lacks recorded slice identity');
 if(receipt.mode==='SLICE'&&(receipt.qualification_scope!=='SLICE'||receipt.full_tree_equivalent!==false))
  fail('SLICE_PRESENTED_AS_FULL_TREE','Slice qualification cannot be presented as full-tree qualification');
 if(receipt.mode==='FULL_TREE'&&(receipt.qualification_scope!=='FULL_TREE'||typeof receipt.fallback_reason!=='string'||!CODE.test(receipt.fallback_reason)))
  fail('SLICE_RECEIPT_INVALID','Full-tree fallback receipt must carry its recorded reason');
 if(receipt.mode!=='SLICE'&&receipt.mode!=='FULL_TREE')fail('SLICE_RECEIPT_INVALID','Unknown slice mode');
 return {slice_digest:receipt.slice_digest,commit:receipt.commit,graph_manifest_digest:typeof receipt.graph_manifest_digest==='string'?receipt.graph_manifest_digest:null,
  mode:receipt.mode,fallback_reason:typeof receipt.fallback_reason==='string'?receipt.fallback_reason:null};
}
/** Recompute the content identity of a stored or supplied manifest. */
export function verifySliceManifest(value:unknown):SliceManifest{
 if(!object(value)||typeof value.digest!=='string')fail('SLICE_CORRUPT','Slice manifest digest is missing');
 const {digest:identity,...body}=value;
 if(body.schema_version!==1||body.kind!=='hyperfide.workspace-slice'||hash(body)!==identity)fail('SLICE_CORRUPT','Slice manifest content differs from its digest');
 if((body.mode==='FULL_TREE')!==(typeof body.fallback_reason==='string'))fail('SLICE_CORRUPT','FULL_TREE requires, and SLICE forbids, a fallback reason');
 return value as unknown as SliceManifest;
}

interface Scope {organisation_id:string;run_id:string;authority_epoch:string;credential_id:string;invocation:InvocationContext}
type Context=ComponentContext&{invocation?:InvocationContext};
function authorise(input:Record<string,unknown>,ctx:Context,roles:string[]):Scope{
 const invocation=ctx.invocation;if(!invocation)return fail('AUTH_REQUIRED','Slice operations require an authenticated invocation');
 const p=invocation.principal;
 if(uuid(input.organisation_id)!==p.organisation_id||uuid(input.run_id)!==p.run_id||uuid(input.authority_epoch)!==p.deployment_epoch)
  fail('SLICE_SCOPE_DENIED','Slice request differs from the authenticated principal scope');
 if(!roles.includes(p.role)||!p.allowed_actions.includes(invocation.payload.action))fail('SLICE_ROLE_DENIED','Authenticated role cannot perform this slice action');
 return {organisation_id:p.organisation_id,run_id:p.run_id,authority_epoch:p.deployment_epoch,credential_id:p.credential_id,invocation};
}
// Cloning, checkout and command execution are remote job classes and never run in the supervisory control process.
function controlPlacement(ctx:Context):void{if(ctx.role!=='control')fail('SLICE_PLACEMENT_DENIED','Slice derivation and inspection run only in the control role');}
function remotePlacement(ctx:Context):string{
 if(ctx.role!=='provisioner'||ctx.env.HF_EXECUTION_HOST_CLASS!=='remote')fail('SLICE_PLACEMENT_DENIED','Materialisation requires the provisioner role on a remote execution host');
 const root=ctx.env.HF_PREPARATION_WORKSPACE_ROOT;
 if(!root||!path.posix.isAbsolute(root)||root==='/'||path.posix.normalize(root)!==root||root.endsWith('/')||/[\x00-\x1f\\]/.test(root))
  fail('SLICE_PLACEMENT_DENIED','An absolute trusted workspace root is required');
 return root;
}
const MIGRATION='0045-workspace-slices';
let migrationChecksum:string|undefined;
async function schema(tx:QuerySession):Promise<void>{
 migrationChecksum??=sha(readFileSync(new URL('../../migrations/'+MIGRATION+'.sql',import.meta.url)));
 const row=await tx.query('SELECT 1 FROM hyperfide.schema_migrations WHERE version=45 AND name=$1 AND checksum=$2',[MIGRATION,migrationChecksum]);
 if(!row.rowCount)fail('SLICE_SCHEMA_REQUIRED','Apply the trusted workspace-slice migration first');
}
async function transaction<T>(ctx:Context,s:Scope,fn:(tx:PrimaryTransaction)=>Promise<T>):Promise<T>{
 // Slice history is append-only and is not a semantic disposition, so it only takes the READ freshness fence.
 return ctx.resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:5,signal:s.invocation.signal,
  guard:async tx=>{await readSemanticDisposition(tx,s);await s.invocation.guard(tx);}},async tx=>{
  await schema(tx);const result=await fn(tx);await s.invocation.guard(tx);return result;});
}

/* ----------------------------------------------------------------------------------------------- derivation (control) */
interface GraphFile {id:string;path:string;language:string;repository:string}
interface Budget {files:number;edges:number}
function budgetOf(value:unknown):Budget{
 if(value===undefined)return {files:DEFAULT_BUDGET.files,edges:DEFAULT_BUDGET.edges};
 const b=record(value,['files','edges']);
 for(const key of ['files','edges'] as const){
  const n=b[key];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<1||n>DEFAULT_BUDGET[key])fail('SLICE_INPUT_INVALID','Closure budget must be positive and within the service maximum');
 }
 return {files:b.files as number,edges:b.edges as number};
}
function body(base:Omit<SliceManifestBody,'mode'|'fallback_reason'|'included_paths'|'excluded_roots'|'build_roots'|'metadata_roots'|'lfs_paths'|'closure'|'diagnostics'>,
 extra:Partial<SliceManifestBody>&{mode:'SLICE'|'FULL_TREE';fallback_reason:string|null}):SliceManifestBody{
 return {...base,included_paths:[],excluded_roots:[],build_roots:[],metadata_roots:[],lfs_paths:[],
  closure:{complete:false,seeds:0,files:0,edges:0,unresolved:0,truncated:false,tests:0,fixtures:0},diagnostics:[],...extra};
}
function excludedRoots(files:readonly string[],manifest:Pick<SliceManifestBody,'mode'|'included_paths'>):string[]{
 const touched=new Set<string>(['']);
 for(const entry of manifest.included_paths){for(const dir of ancestors(entry.endsWith('/')?entry+'x':entry))touched.add(dir);}
 const roots=new Set<string>();
 for(const file of files){
  if(sliceIncludes(manifest,file))continue;
  const chain=ancestors(file);let root:string|undefined;
  for(const dir of chain)if(!touched.has(dir)){root=dir;break;}
  roots.add(root??file);
 }
 return [...roots].sort(compare);
}
async function loadGraph(tx:PrimaryTransaction,s:Scope,graphId:string){
 const p=[s.organisation_id,s.run_id,graphId];
 const sizes=(await tx.query<{files:string;symbols:string;refs:string;edges:string}>('SELECT (SELECT count(*) FROM hyperfide.graph_files WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3)::text AS files,(SELECT count(*) FROM hyperfide.graph_symbols WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3)::text AS symbols,(SELECT count(*) FROM hyperfide.graph_references WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3)::text AS refs,(SELECT count(*) FROM hyperfide.graph_edges WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3)::text AS edges',p)).rows[0]!;
 if(Number(sizes.files)+Number(sizes.symbols)+Number(sizes.refs)+Number(sizes.edges)>DEFAULT_BUDGET.graph_rows)return null;
 const files=(await tx.query<GraphFile>('SELECT f.id::text AS id,f.path,b.language,f.repository_id::text AS repository FROM hyperfide.graph_files f JOIN hyperfide.parse_blobs b ON b.organisation_id=f.organisation_id AND b.run_id=f.run_id AND b.id=f.parse_blob_id WHERE f.organisation_id=$1 AND f.run_id=$2 AND f.graph_id=$3',p)).rows;
 // Symbol-level references and semantic edges are projected to distinct file-level edges inside PostgreSQL.
 const links=(await tx.query<{source:string;target:string}>('SELECT r.file_id::text AS source,t.file_id::text AS target FROM hyperfide.graph_references r JOIN hyperfide.graph_symbols t ON t.organisation_id=r.organisation_id AND t.run_id=r.run_id AND t.graph_id=r.graph_id AND t.id=r.target_symbol_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.graph_id=$3 AND r.resolution_state=$4 UNION SELECT a.file_id::text,b.file_id::text FROM hyperfide.graph_edges e JOIN hyperfide.graph_symbols a ON a.organisation_id=e.organisation_id AND a.run_id=e.run_id AND a.graph_id=e.graph_id AND a.id=e.source_symbol_id JOIN hyperfide.graph_symbols b ON b.organisation_id=e.organisation_id AND b.run_id=e.run_id AND b.graph_id=e.graph_id AND b.id=e.target_symbol_id WHERE e.organisation_id=$1 AND e.run_id=$2 AND e.graph_id=$3',[...p,'RESOLVED'])).rows;
 const unresolved=(await tx.query<{file_id:string;count:number}>('SELECT file_id::text AS file_id,count(*)::int AS count FROM hyperfide.graph_references WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND resolution_state<>$4 GROUP BY file_id',[...p,'RESOLVED'])).rows;
 return {files,links,unresolved};
}
type Graph=NonNullable<Awaited<ReturnType<typeof loadGraph>>>;
/** File-level closure over the pinned graph tables (imports/calls/types as resolved references and semantic edges). */
function close(graph:Graph,repository:string,owned:string[],roots:{contracts:string[];registries:string[]},budget:Budget){
 const diagnostics:{code:string;path:string|null}[]=[];
 const note=(c:string,p:string|null)=>{if(diagnostics.length<64)diagnostics.push({code:c,path:p});};
 const byId=new Map(graph.files.map(f=>[f.id,f])),local=graph.files.filter(f=>f.repository===repository),byPath=new Map(local.map(f=>[f.path,f]));
 const out=new Map<string,Set<string>>(),unresolved=new Map(graph.unresolved.map(u=>[u.file_id,u.count])),reverseTests=new Map<string,Set<string>>();
 for(const l of graph.links){let set=out.get(l.source);if(!set){set=new Set();out.set(l.source,set);}set.add(l.target);}
 for(const [from,targets] of out){const f=byId.get(from);if(!f||!TEST_PATH.test(f.path))continue;for(const t of targets){let set=reverseTests.get(t);if(!set){set=new Set();reverseTests.set(t,set);}set.add(from);}}
 let fallback:string|null=null;
 const expand=(entry:string,kind:'OWNED'|'INPUT'):{files:GraphFile[];directory:string|null}=>{
  if(/[*?[\]]/.test(entry)){fallback??='OWNED_SCOPE_PATTERN_UNSUPPORTED';note('OWNED_SCOPE_PATTERN_UNSUPPORTED',entry);return {files:[],directory:null};}
  const plain=entry.endsWith('/')?entry.slice(0,-1):entry,exact=entry.endsWith('/')?undefined:byPath.get(plain);
  if(exact)return {files:[exact],directory:null};
  const prefix=plain+'/',under=local.filter(f=>f.path.startsWith(prefix));
  if(under.length)return {files:under,directory:prefix};
  const reason=kind==='OWNED'?'OWNED_PATH_OUTSIDE_GRAPH_COVERAGE':'INPUT_ROOT_OUTSIDE_GRAPH_COVERAGE';
  fallback??=reason;note(reason,entry);return {files:[],directory:null};
 };
 const included=new Set<string>(),directories=new Set<string>(),closure=new Set<string>(),seeds=new Set<string>(),ownedFiles=new Set<string>();
 for(const entry of owned){const e=expand(entry,'OWNED');for(const f of e.files){seeds.add(f.id);ownedFiles.add(f.id);}if(e.directory)directories.add(e.directory);}
 for(const entry of [...roots.contracts,...roots.registries]){const e=expand(entry,'INPUT');for(const f of e.files)seeds.add(f.id);if(e.directory)directories.add(e.directory);}
 // Tests that exercise owned files belong to the slice so qualification can run them.
 let tests=0;
 for(const id of [...ownedFiles])for(const t of reverseTests.get(id)??[]){if(!seeds.has(t)){seeds.add(t);tests++;}}
 let edges=0,truncated=false;const queue=[...seeds];
 for(const id of queue)closure.add(id);
 if(closure.size>budget.files)truncated=true;
 for(let index=0;index<queue.length&&!truncated;index++){
  const id=queue[index]!;
  for(const target of out.get(id)??[]){
   if(++edges>budget.edges){truncated=true;break;}
   if(closure.has(target))continue;
   const f=byId.get(target);
   if(!f||f.repository!==repository){fallback??='CROSS_REPOSITORY_EDGE';note('CROSS_REPOSITORY_EDGE',f?.path??null);continue;}
   if(closure.size>=budget.files){truncated=true;break;}
   closure.add(target);queue.push(target);
  }
 }
 if(truncated){fallback??='CLOSURE_BUDGET_TRUNCATED';note('CLOSURE_BUDGET_TRUNCATED',null);}
 let unresolvedCount=0;
 for(const id of closure){const n=unresolved.get(id)??0;if(n){unresolvedCount+=n;note('UNRESOLVED_REFERENCE_REACHABLE',byId.get(id)?.path??null);}}
 if(unresolvedCount)fallback??='UNRESOLVED_REFERENCE_REACHABLE';
 for(const id of closure)included.add(byId.get(id)!.path);
 let fixtures=0;
 for(const id of closure){
  const file=byId.get(id)!;if(!TEST_PATH.test(file.path))continue;
  const dir=file.path.includes('/')?file.path.slice(0,file.path.lastIndexOf('/')+1):'';
  for(const name of FIXTURE_DIRECTORIES)for(const f of local)if(f.path.startsWith(dir+name+'/')&&!included.has(f.path)){included.add(f.path);fixtures++;}
 }
 const build=new Set<string>();
 const chains=new Set<string>();for(const p of [...included,...[...directories].map(d=>d+'x')])for(const a of ancestors(p))chains.add(a);
 for(const f of local){const slash=f.path.lastIndexOf('/'),dir=slash<0?'':f.path.slice(0,slash+1),name=f.path.slice(slash+1);if(chains.has(dir)&&BUILD_ROOT_NAMES.has(name))build.add(f.path);}
 // Attribute and module metadata decide checkout semantics (LFS filters, gitlinks) and are always part of a slice.
 const metadata=new Set<string>(['.gitmodules']);for(const dir of chains)metadata.add(dir+'.gitattributes');
 return {fallback,diagnostics,owned:[...ownedFiles].map(id=>byId.get(id)!),closureFiles:[...closure].map(id=>byId.get(id)!),
  included:[...included,...build,...metadata,...directories],build:[...build].sort(compare),metadata:[...metadata].sort(compare),local,
  stats:{complete:!fallback,seeds:seeds.size,files:closure.size,edges,unresolved:unresolvedCount,truncated,tests,fixtures}};
}
async function lfsPointers(tx:PrimaryTransaction,s:Scope,graphId:string,bundle:string,candidates:string[]):Promise<Set<string>>{
 if(!candidates.length)return new Set();
 const rows=await tx.query<{path:string}>('SELECT path FROM hyperfide.graph_source_bodies WHERE organisation_id=$1 AND run_id=$2 AND graph_id=$3 AND bundle_digest=$4 AND path=ANY($5::text[]) AND left(body,$6)=$7',
  [s.organisation_id,s.run_id,graphId,bundle,candidates,LFS_HEADER.length,LFS_HEADER]);
 return new Set(rows.rows.map(r=>r.path));
}
interface PacketModule {readExecutionPacket:(tx:QuerySession,input:{organisation_id:string;run_id:string;digest:string})=>Promise<{packet:Record<string,unknown>}>}
interface GraphModule {loadGraphSnapshot:(tx:PrimaryTransaction,scope:{organisation_id:string;run_id:string;authority_epoch:string},manifestId:string,expected:unknown)=>Promise<Record<string,unknown>>}
async function modules():Promise<{packets:PacketModule;graphs:GraphModule}>{
 const packets=await import(new URL('../hierarchy/packets.js',import.meta.url).href) as Partial<PacketModule>;
 const graphs=await import(new URL('../graph/publication.js',import.meta.url).href) as Partial<GraphModule>;
 if(typeof packets.readExecutionPacket!=='function'||typeof graphs.loadGraphSnapshot!=='function')fail('SLICE_DEPENDENCY_UNAVAILABLE','Packet or graph snapshot interface is unavailable');
 return {packets:packets as PacketModule,graphs:graphs as GraphModule};
}
async function store(tx:PrimaryTransaction,s:Scope,manifestBody:SliceManifestBody,key:string):Promise<{digest:string;manifest:SliceManifest;replayed:boolean}>{
 const text=canonicalJSON(manifestBody),identity=sha(text),manifest={...manifestBody,digest:identity};
 const prior=(await tx.query<{digest:string;manifest_text:string}>('SELECT digest,manifest_text FROM hyperfide.workspace_slice_manifests WHERE organisation_id=$1 AND run_id=$2 AND (derivation_key=$3 OR digest=$4)',[s.organisation_id,s.run_id,key,identity])).rows;
 for(const row of prior){
  if(row.digest!==identity||row.manifest_text!==text)fail('SLICE_IDENTITY_CONFLICT','An existing immutable slice identity differs from this derivation');
 }
 if(prior.length)return {digest:identity,manifest,replayed:true};
 await tx.query('INSERT INTO hyperfide.workspace_slice_manifests(organisation_id,run_id,digest,derivation_key,packet_digest,repository_id,commit,graph_manifest_id,graph_manifest_digest,mode,fallback_reason,parent_slice_digest,manifest,manifest_text,created_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
  [s.organisation_id,s.run_id,identity,key,manifestBody.packet_digest,manifestBody.repository_id,manifestBody.commit,manifestBody.graph_manifest_id,manifestBody.graph_manifest_digest,
   manifestBody.mode,manifestBody.fallback_reason,manifestBody.parent_slice_digest,JSON.stringify(manifest),text,s.credential_id]);
 return {digest:identity,manifest,replayed:false};
}
async function derive(input:unknown,ctx:Context):Promise<unknown>{
 controlPlacement(ctx);
 const r=record(input,['organisation_id','run_id','authority_epoch','packet_digest','repository_id'],['contract_roots','registry_roots','budget']),s=authorise(r,ctx,DERIVE_ROLES);
 const packetDigest=digest(r.packet_digest),repository=uuid(r.repository_id),budget=budgetOf(r.budget);
 const roots={contracts:paths(r.contract_roots??[],true,256),registries:paths(r.registry_roots??[],true,256)};
 const {packets,graphs}=await modules();
 return transaction(ctx,s,async tx=>{
  const packet=(await packets.readExecutionPacket(tx,{organisation_id:s.organisation_id,run_id:s.run_id,digest:packetDigest})).packet;
  const m=packet.mandatory;
  if(!object(m)||!object(m.identity)||!object(m.intent)||!object(m.inputs)||!object(m.runtime)||!Array.isArray(m.inputs.repositories)||!object(m.inputs.graph)||!Array.isArray(m.intent.owned_scope))
   return fail('SLICE_PACKET_INVALID','Packet lacks its immutable scope, source and graph inputs');
  const pins=m.inputs.repositories.map(value=>{const v=object(value)?value:fail('SLICE_PACKET_INVALID','Invalid repository pin');return {repository_id:uuid(v.repository_id),source_object_id:oid(v.source_object_id)};});
  const pin=pins.find(p=>p.repository_id===repository);if(!pin)return fail('SLICE_REPOSITORY_UNPINNED','Repository is not an input of this packet');
  const owned=paths(m.intent.owned_scope,true,4096);
  if(!owned.length)return fail('SLICE_PACKET_INVALID','Packet has no declared owned scope');
  const profile=object(m.runtime.declared_profile)?m.runtime.declared_profile:{};
  const declared=(Array.isArray(profile.repositories)?profile.repositories:[]).find(v=>object(v)&&v.id===repository);
  const submodules=(object(declared)&&Array.isArray(declared.submodules)?declared.submodules:[]).map(v=>{const x=record(v,['path','commit']);return {path:slicePath(x.path),commit:oid(x.commit)};}).sort((a,b)=>compare(a.path,b.path));
  const slot={sandbox_id:uuid(m.runtime.sandbox_id),slot_id:uuid(m.runtime.slot_id),sandbox_boot_generation:decimal(String(m.runtime.sandbox_boot_generation))};
  const graph=m.inputs.graph,key=hash({kind:'derive',packet_digest:packetDigest,repository_id:repository,input_roots:roots,budget});
  const base={schema_version:1 as const,kind:'hyperfide.workspace-slice' as const,packet_digest:packetDigest,repository_id:repository,commit:pin.source_object_id,
   graph_manifest_id:null as string|null,graph_manifest_digest:null as string|null,submodules,input_roots:roots,budget,slot,parent_slice_digest:null,widening:null};
  const fullTree=(reason:string,extra:Partial<SliceManifestBody>={})=>body(base,{...extra,mode:'FULL_TREE',fallback_reason:reason});
  if(graph.required!==true)return store(tx,s,fullTree('GRAPH_NOT_REQUIRED'),key);
  const manifestId=uuid(graph.manifest_id),manifestDigest=digest(graph.manifest_digest);
  let snapshot:Record<string,unknown>;
  try{snapshot=await graphs.loadGraphSnapshot(tx,{organisation_id:s.organisation_id,run_id:s.run_id,authority_epoch:String(m.identity.authority_epoch)},manifestId,pins.map(p=>({...p,overlay_digest:null})));}
  catch(error){
   // A graph generation older than the pinned commit is never used to derive a slice.
   if(error instanceof FoundationError&&error.code==='GRAPH_SOURCE_SET_MISMATCH')return store(tx,s,fullTree('GRAPH_GENERATION_STALE',{diagnostics:[{code:'GRAPH_GENERATION_STALE',path:null}]}),key);
   throw error;
  }
  if(snapshot.manifest_digest!==manifestDigest)return fail('SLICE_GRAPH_MISMATCH','Published graph manifest differs from the packet pin');
  base.graph_manifest_id=manifestId;base.graph_manifest_digest=manifestDigest;
  const coverage=(Array.isArray(snapshot.source_coverage)?snapshot.source_coverage:[]).find(v=>object(v)&&object(v.identity)&&v.identity.repository_id===repository);
  if(!object(coverage)||coverage.complete!==true)return store(tx,s,fullTree('GRAPH_SOURCE_COVERAGE_INCOMPLETE'),key);
  if(snapshot.semantic_projection_complete!==true)return store(tx,s,fullTree('SEMANTIC_PROJECTION_INCOMPLETE'),key);
  const graphId=uuid(snapshot.build_id),loaded=await loadGraph(tx,s,graphId);
  if(!loaded)return store(tx,s,fullTree('CLOSURE_BUDGET_TRUNCATED'),key);
  const c=close(loaded,repository,owned,roots,budget);
  const lfs=await lfsPointers(tx,s,graphId,digest(coverage.bundle_digest),c.included.filter(p=>!p.endsWith('/')));
  // An owned file the graph could not parse has unknown dependencies; an LFS pointer is content-addressed data, not source.
  const unparsed=c.owned.filter(f=>f.language==='text'&&!lfs.has(f.path));
  let fallback=c.fallback;for(const f of unparsed){fallback??='UNPARSED_LANGUAGE';if(c.diagnostics.length<64)c.diagnostics.push({code:'UNPARSED_LANGUAGE',path:f.path});}
  const stats={...c.stats,complete:!fallback};
  if(fallback)return store(tx,s,fullTree(fallback,{closure:stats,diagnostics:c.diagnostics}),key);
  const included=[...new Set(c.included)].sort(compare);
  const sliceBody=body(base,{mode:'SLICE',fallback_reason:null,included_paths:included,build_roots:c.build,metadata_roots:c.metadata,lfs_paths:[...lfs].sort(compare),closure:stats,diagnostics:c.diagnostics});
  sliceBody.excluded_roots=excludedRoots(c.local.map(f=>f.path),sliceBody);
  sliceBody.submodules=submodules.filter(sub=>sliceIncludes(sliceBody,sub.path));
  return store(tx,s,sliceBody,key);
 });
}
async function loadManifest(tx:QuerySession,s:Pick<Scope,'organisation_id'|'run_id'>,identity:string):Promise<SliceManifest>{
 const row=(await tx.query<{manifest:unknown;manifest_text:string;digest:string}>('SELECT manifest,manifest_text,digest FROM hyperfide.workspace_slice_manifests WHERE organisation_id=$1 AND run_id=$2 AND digest=$3',[s.organisation_id,s.run_id,identity])).rows[0];
 if(!row)return fail('SLICE_UNAVAILABLE','No immutable slice manifest matches the authenticated scope/digest');
 const manifest=verifySliceManifest(row.manifest);
 const {digest:_ignored,...stored}=manifest;void _ignored;
 if(sha(row.manifest_text)!==identity||manifest.digest!==identity||canonicalJSON(stored)!==row.manifest_text)fail('SLICE_CORRUPT','Stored slice bytes differ from their identity');
 return manifest;
}
const ACCESS_SOURCES=['LAZY_FETCH','WORKTREE_STATUS','SKIP_WORKTREE','ACCESS_MONITOR','DECLARED_REQUIREMENT','EXPLICIT_WIDENING'];
async function widen(input:unknown,ctx:Context):Promise<unknown>{
 controlPlacement(ctx);
 const r=record(input,['organisation_id','run_id','authority_epoch','slice_digest','paths','access','source','reason']),s=authorise(r,ctx,DERIVE_ROLES);
 const parentDigest=digest(r.slice_digest),added=paths(r.paths,true,256),reason=code(r.reason);
 if(!added.length)fail('SLICE_INPUT_INVALID','Widening must name at least one path');
 if(r.access!=='READ'&&r.access!=='WRITE')fail('SLICE_INPUT_INVALID','Widening access must be READ or WRITE');
 if(typeof r.source!=='string'||!ACCESS_SOURCES.includes(r.source))fail('SLICE_INPUT_INVALID','Unknown access detection source');
 return transaction(ctx,s,async tx=>{
  const parent=await loadManifest(tx,s,parentDigest);
  if(parent.mode!=='SLICE')fail('SLICE_WIDEN_UNNECESSARY','A full-tree manifest already contains every path');
  const covered=(entry:string)=>entry.endsWith('/')?parent.included_paths.some(e=>e.endsWith('/')&&entry.startsWith(e)):sliceIncludes(parent,entry);
  const fresh=added.filter(p=>!covered(p));
  if(!fresh.length)fail('SLICE_WIDEN_NOOP','Requested paths are already inside the slice');
  const {digest:_parent,...inherited}=parent;void _parent;
  const next:SliceManifestBody={...inherited,included_paths:[...new Set([...parent.included_paths,...fresh])].sort(compare),parent_slice_digest:parent.digest,widening:{added_paths:fresh,reason}};
  const files=(await tx.query<{path:string}>('SELECT f.path FROM hyperfide.graph_files f JOIN hyperfide.graph_manifests m ON m.organisation_id=f.organisation_id AND m.run_id=f.run_id AND m.build_id=f.graph_id WHERE f.organisation_id=$1 AND f.run_id=$2 AND m.id=$3 AND f.repository_id=$4',[s.organisation_id,s.run_id,parent.graph_manifest_id,parent.repository_id])).rows.map(v=>v.path);
  next.excluded_roots=excludedRoots(files,next);
  // The widening identity is (parent, added paths): the same widening with a different reason is a conflicting write.
  const stored=await store(tx,s,next,hash({kind:'widen',parent_slice_digest:parent.digest,added_paths:fresh}));
  if(!stored.replayed)for(const file of fresh)
   await tx.query('INSERT INTO hyperfide.workspace_slice_access_events(organisation_id,run_id,id,slice_digest,path,access,source,decision,reason,widened_slice_digest,created_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [s.organisation_id,s.run_id,randomUUID(),parent.digest,file,r.access,r.source,'WIDENED',reason,stored.digest,s.credential_id]);
  return {...stored,parent_slice_digest:parent.digest,added_paths:fresh};
 });
}
async function inspect(input:unknown,ctx:Context):Promise<unknown>{
 controlPlacement(ctx);
 const r=record(input,['organisation_id','run_id','authority_epoch','slice_digest'],['full_tree_paths']),s=authorise(r,ctx,READ_ROLES),identity=digest(r.slice_digest);
 const fullTree=r.full_tree_paths===undefined?undefined:paths(r.full_tree_paths,false,100000);
 return transaction(ctx,s,async tx=>{
  const manifest=await loadManifest(tx,s,identity),p=[s.organisation_id,s.run_id,identity];
  const materialisations=(await tx.query('SELECT id,sandbox_id,slot_id,sandbox_boot_generation::text,outcome,reason,released_materialisation_id,verified_head,evidence,evidence_digest,created_at FROM hyperfide.workspace_slice_materialisations WHERE organisation_id=$1 AND run_id=$2 AND slice_digest=$3 ORDER BY created_at,id',p)).rows;
  const receipts=(await tx.query('SELECT id,operation_id,qualification_scope,full_tree_equivalent,qualification_outcome,receipt,receipt_digest FROM hyperfide.workspace_slice_receipts WHERE organisation_id=$1 AND run_id=$2 AND slice_digest=$3 ORDER BY created_at,id',p)).rows;
  const access=(await tx.query('SELECT id,materialisation_id,receipt_id,path,access,source,decision,reason,widened_slice_digest FROM hyperfide.workspace_slice_access_events WHERE organisation_id=$1 AND run_id=$2 AND slice_digest=$3 ORDER BY created_at,id',p)).rows;
  const children=(await tx.query<{digest:string}>('SELECT digest FROM hyperfide.workspace_slice_manifests WHERE organisation_id=$1 AND run_id=$2 AND parent_slice_digest=$3 ORDER BY digest',p)).rows.map(v=>v.digest);
  for(const row of receipts)assertNotFullTreeQualification(row.receipt);
  return {digest:identity,manifest,materialisations,receipts,access_events:access,widened_children:children,
   qualification:manifest.mode==='SLICE'?'SLICE_ONLY_NOT_FULL_TREE':'FULL_TREE_FALLBACK',...(fullTree?{omitted_inputs:omittedInputs(manifest,fullTree)}:{})};
 });
}

/* ------------------------------------------------------------------------------------------- remote materialisation */
interface SourceConfig {url:string;submodules:Record<string,string>}
async function sourceConfig(ctx:Context,repository:string):Promise<SourceConfig>{
 const filename=ctx.env.HF_SLICE_SOURCE_CONFIG;
 if(!filename||!path.isAbsolute(filename))return fail('SLICE_SOURCE_UNAVAILABLE','Trusted remote source configuration is required');
 let raw:unknown;
 try{const st=await fs.lstat(filename);if(!st.isFile()||st.size>262144)throw new Error();raw=JSON.parse(await fs.readFile(filename,'utf8'));}
 catch{return fail('SLICE_SOURCE_UNAVAILABLE','Trusted remote source configuration is unreadable');}
 const v=record(raw,['schema_version','repositories']);
 if(v.schema_version!==1||!object(v.repositories))fail('SLICE_SOURCE_UNAVAILABLE','Unsupported source configuration');
 const entry=v.repositories[repository];if(!object(entry))return fail('SLICE_SOURCE_UNAVAILABLE','Repository has no trusted remote source');
 const e=record(entry,['url','submodules']);
 const subs:Record<string,string>={};if(!object(e.submodules))fail('SLICE_SOURCE_UNAVAILABLE','Submodule source map required');
 for(const [p,u] of Object.entries(e.submodules))subs[slicePath(p)]=sourceURL(u);
 return {url:sourceURL(e.url),submodules:subs};
}
// A plain local path silently ignores --filter, so only URL transports are accepted.
function sourceURL(value:unknown):string{
 if(typeof value!=='string'||value.length>2048||/[\x00-\x1f\s]/.test(value))return fail('SLICE_SOURCE_UNAVAILABLE','Invalid source URL');
 let url:URL;try{url=new URL(value);}catch{return fail('SLICE_SOURCE_UNAVAILABLE','Source must be a URL, not a local path');}
 if(!['https:','ssh:','file:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||(url.protocol==='file:'&&(url.hostname||!url.pathname.startsWith('/'))))
  fail('SLICE_SOURCE_UNAVAILABLE','Credential-free https, ssh or absolute file URL required');
 return value;
}
interface Run {code:number|null;signal:string|null;stdout:Buffer;stderr:string;stdoutDigest:string;stderrDigest:string;stdoutBytes:number;stderrBytes:number;durationNs:string}
function execute(argv:string[],options:{cwd:string;env:Record<string,string>;signal:AbortSignal;timeoutMs:number;input?:string;maxStdout?:number}):Promise<Run>{
 return new Promise((resolve,reject)=>{
  const started=process.hrtime.bigint();
  const child=spawn(argv[0]!,argv.slice(1),{cwd:options.cwd,env:options.env,signal:options.signal,stdio:[options.input===undefined?'ignore':'pipe','pipe','pipe']});
  const out:Buffer[]=[],err:Buffer[]=[],outHash=createHash('sha256'),errHash=createHash('sha256');let outBytes=0,errBytes=0,settled=false;
  const max=options.maxStdout??64*1024*1024;
  const timer=setTimeout(()=>child.kill('SIGKILL'),options.timeoutMs);
  child.stdout!.on('data',(d:Buffer)=>{outHash.update(d);outBytes+=d.length;if(outBytes<=max)out.push(d);});
  child.stderr!.on('data',(d:Buffer)=>{errHash.update(d);errBytes+=d.length;if(errBytes<=1048576)err.push(d);});
  if(options.input!==undefined){child.stdin!.on('error',()=>undefined);child.stdin!.end(options.input);}
  child.once('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
  child.once('close',(code,signal)=>{if(settled)return;settled=true;clearTimeout(timer);
   if(outBytes>max){reject(new FoundationError('SLICE_OUTPUT_LIMIT','Process output exceeded its bound'));return;}
   resolve({code,signal,stdout:Buffer.concat(out),stderr:Buffer.concat(err).toString('utf8'),stdoutDigest:'sha256:'+outHash.digest('hex'),stderrDigest:'sha256:'+errHash.digest('hex'),
    stdoutBytes:outBytes,stderrBytes:errBytes,durationNs:(process.hrtime.bigint()-started).toString()});});
 });
}
function gitEnv(home:string,extra:Record<string,string>={}):Record<string,string>{
 return {PATH:process.env.PATH??'/usr/bin:/bin',HOME:home,LC_ALL:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:'maintenance.auto',GIT_CONFIG_VALUE_0:'false',GIT_CONFIG_KEY_1:'gc.auto',GIT_CONFIG_VALUE_1:'0',
  GIT_CONFIG_KEY_2:'gc.autoDetach',GIT_CONFIG_VALUE_2:'false',GIT_CONFIG_KEY_3:'core.hooksPath',GIT_CONFIG_VALUE_3:'/dev/null',...extra};
}
async function git(args:string[],cwd:string,home:string,signal:AbortSignal,options:{input?:string;allowFailure?:boolean;env?:Record<string,string>}={}):Promise<Run>{
 const result=await execute(['git',...args],{cwd,env:gitEnv(home,options.env),signal,timeoutMs:120000,...(options.input===undefined?{}:{input:options.input})});
 if(result.code!==0&&!options.allowFailure)fail('SLICE_GIT_FAILED','git '+args[0]+' failed');
 return result;
}
const text=(run:Run)=>run.stdout.toString('utf8').trim();
function sparsePattern(entry:string):string{
 // No-cone patterns are gitignore syntax: anchor at the root and escape every metacharacter so a path matches only itself.
 const escaped=entry.replace(/[\\*?[\]!#]/g,c=>'\\'+c).replace(/ +$/,spaces=>spaces.replace(/ /g,'\\ '));
 return '/'+escaped;
}
interface TreeEntry {mode:string;type:string;oid:string;path:string}
async function treeEntries(workspace:string,home:string,commit:string,signal:AbortSignal):Promise<TreeEntry[]>{
 const run=await git(['ls-tree','-r','-z','--full-tree',commit],workspace,home,signal);
 return run.stdout.toString('utf8').split('\0').filter(Boolean).map(line=>{
  const tab=line.indexOf('\t'),[mode,type,id]=line.slice(0,tab).split(' ');return {mode:mode!,type:type!,oid:id!,path:line.slice(tab+1)};
 });
}
async function batched<T,R>(items:readonly T[],fn:(item:T)=>Promise<R>,width=64):Promise<R[]>{
 const results:R[]=new Array(items.length);
 for(let i=0;i<items.length;i+=width)await Promise.all(items.slice(i,i+width).map(async(item,offset)=>{results[i+offset]=await fn(item);}));
 return results;
}
async function walk(root:string,skip:Set<string>):Promise<{files:Map<string,{mode:number;size:number;link:string|null}>;bytes:number}>{
 const found:string[]=[],pending=[''];
 while(pending.length){
  const prefix=pending.pop()!;
  for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
   const rel=prefix+entry.name;if(rel==='.git'||skip.has(rel))continue;
   if(entry.isDirectory())pending.push(rel+'/');else found.push(rel);
  }
 }
 found.sort(compare);
 const stats=await batched(found,async rel=>{
  const full=path.join(root,rel),st=await fs.lstat(full);
  if(st.isSymbolicLink()){const link=await fs.readlink(full);return {mode:st.mode,size:Buffer.byteLength(link),link};}
  if(!st.isFile())fail('SLICE_FILE_TYPE','Workspace contains a non-regular file');
  return {mode:st.mode,size:st.size,link:null as string|null};
 });
 const files=new Map(found.map((rel,i)=>[rel,stats[i]!]));
 return {files,bytes:stats.reduce((n,x)=>n+x.size,0)};
}
async function directoryBytes(root:string):Promise<number>{
 let total=0;for(const entry of await fs.readdir(root,{withFileTypes:true,recursive:true})){if(entry.isFile())total+=(await fs.lstat(path.join(entry.parentPath,entry.name))).size;}return total;
}
function gitObjectId(format:string,content:Buffer,type='blob'):string{
 return createHash(format==='sha256'?'sha256':'sha1').update(type+' '+content.length+'\0').update(content).digest('hex');
}
/** Byte identity of every materialised path against the pinned commit tree, plus exact set equality (no extra, none missing). */
async function verifyWorkspace(workspace:string,home:string,commit:string,expected:TreeEntry[],lfs:Map<string,{oid:string;size:number}>,submodulePaths:Set<string>,signal:AbortSignal){
 const format=text(await git(['rev-parse','--show-object-format'],workspace,home,signal));
 const disk=await walk(workspace,submodulePaths);
 const want=new Map(expected.filter(e=>e.mode!=='160000').map(e=>[e.path,e]));
 const extra=[...disk.files.keys()].filter(p=>!want.has(p)),missing=[...want.keys()].filter(p=>!disk.files.has(p));
 if(extra.length||missing.length)fail('SLICE_FILE_SET_MISMATCH','Materialised file set differs from the slice: '+[...extra.slice(0,3).map(p=>'+'+p),...missing.slice(0,3).map(p=>'-'+p)].join(' '));
 const digests=await batched([...want].sort((x,y)=>compare(x[0],y[0])),async([file,entry]):Promise<[string,string,string,string]>=>{
  const actual=disk.files.get(file)!,full=path.join(workspace,file);
  let content:Buffer;
  if(entry.mode==='120000'){if(actual.link===null)fail('SLICE_MODE_MISMATCH','Symlink materialised as a file');content=Buffer.from(actual.link);}
  else{if(actual.link!==null||(entry.mode==='100755')!==((actual.mode&0o100)!==0))fail('SLICE_MODE_MISMATCH','File mode differs from the commit');content=await fs.readFile(full);}
  const pointer=lfs.get(file);
  if(pointer){
   // Pointer bytes never count as content: the materialised bytes must be the LFS object the pointer names.
   if(content.length!==pointer.size||'sha256:'+createHash('sha256').update(content).digest('hex')!==pointer.oid)fail('SLICE_LFS_MISMATCH','LFS content differs from its pointer');
  }else if(gitObjectId(format,content)!==entry.oid)fail('SLICE_BYTE_MISMATCH','Materialised bytes differ from the pinned commit');
  return [file,entry.mode,entry.oid,'sha256:'+createHash('sha256').update(content).digest('hex')];
 });
 return {format,files:digests.length,worktree_bytes:disk.bytes,files_digest:hash(digests)};
}
function slotDirectory(root:string,slot:{sandbox_id:string;slot_id:string;sandbox_boot_generation:string}):string{
 const dir=path.join(root,slot.sandbox_id,slot.slot_id,slot.sandbox_boot_generation);
 if(path.relative(root,dir).startsWith('..'))fail('SLICE_PLACEMENT_DENIED','Slot workspace escapes the trusted root');
 return dir;
}
async function exists(file:string):Promise<boolean>{try{await fs.lstat(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
async function gitLfsAvailable(home:string,signal:AbortSignal):Promise<boolean>{
 try{return (await execute(['git','lfs','version'],{cwd:home,env:gitEnv(home),signal,timeoutMs:10000})).code===0;}catch{return false;}
}
async function persistMaterialisation(ctx:Context,s:Scope,row:{id:string;slice:string;slot:SliceManifestBody['slot'];outcome:string;reason:string|null;released:string|null;head:string|null;evidence:unknown}):Promise<void>{
 await transaction(ctx,s,async tx=>{
  await tx.query('INSERT INTO hyperfide.workspace_slice_materialisations(organisation_id,run_id,id,slice_digest,sandbox_id,slot_id,sandbox_boot_generation,outcome,reason,released_materialisation_id,verified_head,evidence,evidence_digest,created_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
   [s.organisation_id,s.run_id,row.id,row.slice,row.slot.sandbox_id,row.slot.slot_id,row.slot.sandbox_boot_generation,row.outcome,row.reason,row.released,row.head,JSON.stringify(row.evidence),hash(row.evidence),s.credential_id]);
 });
}
async function currentMaterialisation(tx:QuerySession,s:Scope,slot:SliceManifestBody['slot']):Promise<{id:string;slice_digest:string}|undefined>{
 return (await tx.query<{id:string;slice_digest:string}>("SELECT m.id,m.slice_digest FROM hyperfide.workspace_slice_materialisations m WHERE m.organisation_id=$1 AND m.sandbox_id=$2 AND m.slot_id=$3 AND m.sandbox_boot_generation=$4 AND m.outcome='READY' AND NOT EXISTS(SELECT 1 FROM hyperfide.workspace_slice_materialisations r WHERE r.organisation_id=m.organisation_id AND r.run_id=m.run_id AND r.released_materialisation_id=m.id)",
  [s.organisation_id,slot.sandbox_id,slot.slot_id,slot.sandbox_boot_generation])).rows[0];
}
const REFUSALS=new Set(['SLICE_SUBMODULE_UNDECLARED','SLICE_SUBMODULE_SOURCE_UNAVAILABLE','SLICE_LFS_UNAVAILABLE','SLICE_LFS_PATH_UNSUPPORTED','SLICE_SOURCE_UNAVAILABLE']);
async function materialize(input:unknown,ctx:Context):Promise<unknown>{
 const root=remotePlacement(ctx);
 const r=record(input,['organisation_id','run_id','authority_epoch','slice_digest','sandbox_id','slot_id','sandbox_boot_generation']),s=authorise(r,ctx,REMOTE_ROLES);
 const identity=digest(r.slice_digest),requested={sandbox_id:uuid(r.sandbox_id),slot_id:uuid(r.slot_id),sandbox_boot_generation:decimal(r.sandbox_boot_generation)};
 const manifest=await transaction(ctx,s,async tx=>{
  const value=await loadManifest(tx,s,identity);
  // Materialisation binds the packet's own slot; the slot must be unoccupied by any unreleased workspace.
  if(canonicalJSON(value.slot)!==canonicalJSON(requested))fail('SLICE_SLOT_MISMATCH','Requested slot differs from the packet binding');
  const slot=(await tx.query("SELECT 1 FROM hyperfide.worker_slots w JOIN hyperfide.sandboxes x ON x.organisation_id=w.organisation_id AND x.id=w.sandbox_id AND x.boot_generation=w.boot_generation WHERE w.organisation_id=$1 AND w.sandbox_id=$2 AND w.id=$3 AND w.boot_generation=$4 AND x.observed_state='RUNNING'",[s.organisation_id,requested.sandbox_id,requested.slot_id,requested.sandbox_boot_generation])).rowCount;
  if(!slot)fail('SLICE_SLOT_UNAVAILABLE','Slot boot generation is not current');
  if(await currentMaterialisation(tx,s,requested))fail('SLICE_SLOT_OCCUPIED','The slot already holds an unreleased workspace');
  return value;
 });
 const id=randomUUID(),slotDir=slotDirectory(root,requested),workspace=path.join(slotDir,'workspace');
 await fs.mkdir(slotDir,{recursive:true,mode:0o700});
 if(await exists(workspace))fail('SLICE_SLOT_OCCUPIED','The slot workspace path already exists');
 const tmp=await fs.mkdtemp(path.join(slotDir,'.materialise-')),home=path.join(tmp,'home'),work=path.join(tmp,'workspace');await fs.mkdir(home);
 const signal=AbortSignal.any([ctx.signal,s.invocation.signal]),started=process.hrtime.bigint();
 const evidence:Record<string,unknown>={schema_version:1,mode:manifest.mode,commit:manifest.commit,slice_digest:identity,fallback_reason:manifest.fallback_reason};
 try{
  const source=await sourceConfig(ctx,manifest.repository_id);
  const slice=manifest.mode==='SLICE';
  await git(['clone','--no-checkout','--no-tags',...(slice?['--filter=blob:none','--sparse']:[]),'--',source.url,work],tmp,home,signal);
  if((await git(['cat-file','-e',manifest.commit+'^{commit}'],work,home,signal,{allowFailure:true})).code!==0)
   await git(['fetch','--no-tags',...(slice?['--filter=blob:none']:[]),'origin',manifest.commit],work,home,signal);
  const tree=await treeEntries(work,home,manifest.commit,signal);
  const expected=tree.filter(e=>sliceIncludes(manifest,e.path));
  if(slice){
   await git(['sparse-checkout','set','--no-cone','--stdin'],work,home,signal,{input:manifest.included_paths.map(sparsePattern).join('\n')+'\n'});
   evidence.sparse={mode:'no-cone',patterns:manifest.included_paths.length};
  }
  await git(['-c','advice.detachedHead=false','checkout','--detach',manifest.commit],work,home,signal);
  const head=text(await git(['rev-parse','HEAD'],work,home,signal));
  if(head!==manifest.commit)fail('SLICE_HEAD_MISMATCH','Checked-out HEAD differs from the pinned commit');
  // A silently ignored filter still marks the remote promisor; only actually missing blobs prove a partial clone.
  const missing=text(await git(['rev-list','--objects','--missing=print',manifest.commit],work,home,signal)).split('\n').filter(line=>line.startsWith('?')).length;
  evidence.partial_clone={requested:slice,filter:slice?'blob:none':null,missing_objects:missing};
  if(slice&&missing===0)fail('PARTIAL_CLONE_INEFFECTIVE','The source ignored the blob filter; slice cost cannot be claimed');
  // LFS: attributes plus pointer header; only slice paths are fetched, and pointer bytes are never accepted as content.
  const regular=expected.filter(e=>e.mode==='100644'||e.mode==='100755').map(e=>e.path);
  const attributes=regular.length?(await git(['check-attr','-z','--stdin','filter'],work,home,signal,{input:regular.join('\0')+'\0'})).stdout.toString('utf8').split('\0'):[];
  const lfs=new Map<string,{oid:string;size:number}>();
  for(let i=0;i+2<attributes.length;i+=3){
   if(attributes[i+2]!=='lfs')continue;
   const file=attributes[i]!,head=(await fs.readFile(path.join(work,file))).subarray(0,512).toString('utf8');
   const match=/^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize ([0-9]+)\n/.exec(head);
   if(match)lfs.set(file,{oid:'sha256:'+match[1],size:Number(match[2])});
  }
  if(lfs.size){
   if([...lfs.keys()].some(p=>/[,*?[\]\\]/.test(p)))fail('SLICE_LFS_PATH_UNSUPPORTED','LFS include list cannot express this path exactly');
   if(!await gitLfsAvailable(home,signal))fail('SLICE_LFS_UNAVAILABLE','git-lfs is not installed; LFS content would be pointer bytes');
   // Hooks stay disabled (core.hooksPath=/dev/null); only the local filter configuration is installed.
   await git(['lfs','install','--local','--skip-smudge','--skip-repo'],work,home,signal);
   await git(['lfs','pull','--include='+[...lfs.keys()].join(',')],work,home,signal);
  }
  evidence.lfs=[...lfs].map(([file,pointer])=>({path:file,...pointer})).sort((a,b)=>compare(a.path,b.path));
  // Gitlinks inside the slice are materialised at their declared pinned commit, never left as an empty directory.
  const links=expected.filter(e=>e.mode==='160000'),submodules:Record<string,unknown>[]=[];
  for(const link of links){
   const declared=manifest.submodules.find(sub=>sub.path===link.path);
   if(!declared||declared.commit!==link.oid)fail('SLICE_SUBMODULE_UNDECLARED','A gitlink inside the slice is not declared at its pinned commit');
   const url=source.submodules[link.path];if(!url)fail('SLICE_SUBMODULE_SOURCE_UNAVAILABLE','No trusted source for a gitlink inside the slice');
   const target=path.join(work,link.path);await fs.rm(target,{recursive:true,force:true});
   await git(['clone','--no-checkout','--no-tags','--',url,target],tmp,home,signal);
   await git(['-c','advice.detachedHead=false','checkout','--detach',link.oid],target,home,signal);
   const subHead=text(await git(['rev-parse','HEAD'],target,home,signal));
   if(subHead!==link.oid)fail('SLICE_SUBMODULE_HEAD_MISMATCH','Submodule HEAD differs from its gitlink');
   const subVerified=await verifyWorkspace(target,home,link.oid,(await treeEntries(target,home,link.oid,signal)),new Map(),new Set(),signal);
   submodules.push({path:link.path,commit:link.oid,verified_head:subHead,files:subVerified.files,files_digest:subVerified.files_digest});
  }
  for(const declared of manifest.submodules)if(!links.some(l=>l.path===declared.path))fail('SLICE_SUBMODULE_UNDECLARED','A declared submodule is absent from the pinned tree');
  evidence.submodules=submodules;
  const verified=await verifyWorkspace(work,home,manifest.commit,expected,lfs,new Set(links.map(l=>l.path)),signal);
  const skipped=(await git(['ls-files','-t','-z'],work,home,signal)).stdout.toString('utf8').split('\0').filter(line=>line.startsWith('S ')).length;
  const counts=Object.fromEntries(text(await git(['count-objects','-v'],work,home,signal)).split('\n').map(line=>line.split(': ') as [string,string]));
  evidence.verification={object_format:verified.format,tree_entries:tree.length,expected_paths:expected.length,materialised_files:verified.files,skip_worktree_entries:skipped,files_digest:verified.files_digest,byte_identity:'GIT_OBJECT_ID_AND_LFS_POINTER_SHA256'};
  const gitBytes=await directoryBytes(path.join(work,'.git'));
  evidence.metrics={wall_ns:(process.hrtime.bigint()-started).toString(),pack_bytes:(Number(counts['size-pack']??0)+Number(counts.size??0))*1024,
   pack_objects:Number(counts['in-pack']??0)+Number(counts.count??0),files_written:verified.files,worktree_bytes:verified.worktree_bytes,git_dir_bytes:gitBytes,disk_bytes:verified.worktree_bytes+gitBytes,
   cost_claim:slice?'PARTIAL_CLONE_SPARSE_SLICE':'FULL_TREE_BASELINE'};
  await fs.rename(work,workspace);
  try{await persistMaterialisation(ctx,s,{id,slice:identity,slot:requested,outcome:'READY',reason:null,released:null,head,evidence});}
  catch(error){await fs.rm(workspace,{recursive:true,force:true});throw error;}
  return {materialisation_id:id,slice_digest:identity,outcome:'READY',verified_head:head,mode:manifest.mode,fallback_reason:manifest.fallback_reason,evidence};
 }catch(error){
  const reason=error instanceof FoundationError&&CODE.test(error.code)?error.code:'SLICE_MATERIALISATION_FAILED';
  await fs.rm(tmp,{recursive:true,force:true}).catch(()=>undefined);
  // A failed materialisation never leaves a workspace and never becomes READY.
  const {metrics:_unclaimed,...partial}=evidence;void _unclaimed;
  try{await persistMaterialisation(ctx,s,{id,slice:identity,slot:requested,outcome:REFUSALS.has(reason)?'REFUSED':'FAILED',reason,released:null,head:null,evidence:{...partial,failure:reason}});}
  catch{throw new FoundationError('SLICE_HISTORY_UNAVAILABLE','Materialisation failed and its failure record could not be persisted; reconcile before retry');}
  throw error instanceof FoundationError?error:new FoundationError('SLICE_MATERIALISATION_FAILED','Materialisation failed; no workspace was published');
 }finally{await fs.rm(tmp,{recursive:true,force:true}).catch(()=>undefined);}
}
async function readyWorkspace(tx:QuerySession,s:Scope,materialisation:string,root:string){
 const row=(await tx.query<{slice_digest:string;sandbox_id:string;slot_id:string;sandbox_boot_generation:string;outcome:string;verified_head:string}>('SELECT slice_digest,sandbox_id,slot_id,sandbox_boot_generation::text,outcome,verified_head FROM hyperfide.workspace_slice_materialisations WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[s.organisation_id,s.run_id,materialisation])).rows[0];
 if(!row||row.outcome!=='READY')return fail('SLICE_NOT_READY','Materialisation is not a verified ready workspace');
 const released=(await tx.query('SELECT 1 FROM hyperfide.workspace_slice_materialisations WHERE organisation_id=$1 AND run_id=$2 AND released_materialisation_id=$3',[s.organisation_id,s.run_id,materialisation])).rowCount;
 if(released)fail('SLICE_RELEASED','Materialisation was released');
 const manifest=await loadManifest(tx,s,row.slice_digest),slot={sandbox_id:row.sandbox_id,slot_id:row.slot_id,sandbox_boot_generation:row.sandbox_boot_generation};
 return {manifest,slot,head:row.verified_head,workspace:path.join(slotDirectory(root,slot),'workspace')};
}
async function release(input:unknown,ctx:Context):Promise<unknown>{
 const root=remotePlacement(ctx);
 const r=record(input,['organisation_id','run_id','authority_epoch','materialisation_id']),s=authorise(r,ctx,REMOTE_ROLES),target=uuid(r.materialisation_id);
 const ready=await transaction(ctx,s,tx=>readyWorkspace(tx,s,target,root));
 await fs.rm(ready.workspace,{recursive:true,force:true});
 const id=randomUUID();
 await persistMaterialisation(ctx,s,{id,slice:ready.manifest.digest,slot:ready.slot,outcome:'RELEASED',reason:null,released:target,head:null,evidence:{schema_version:1,released:target,workspace_absent:!(await exists(ready.workspace))}});
 return {release_id:id,materialisation_id:target,workspace_absent:!(await exists(ready.workspace))};
}

/* ------------------------------------------------------------------------------------------------ slice qualification */
interface Command {id:string;argv:string[];cwd:string;env:Record<string,string>;timeout_ms:number}
function commands(value:unknown):Command[]{
 if(!Array.isArray(value)||value.length<1||value.length>16)fail('SLICE_INPUT_INVALID','One to sixteen structured commands are required');
 const ids=new Set<string>();
 return value.map(item=>{
  const c=record(item,['id','argv','cwd','env','timeout_ms']);
  if(typeof c.id!=='string'||!/^[a-z][a-z0-9._-]{0,63}$/.test(c.id)||ids.has(c.id))fail('SLICE_INPUT_INVALID','Unique command identity required');ids.add(c.id);
  if(!Array.isArray(c.argv)||c.argv.length<1||c.argv.length>64||c.argv.some(a=>typeof a!=='string'||a.length>8192||a.includes('\0')))fail('SLICE_INPUT_INVALID','Bounded argv required');
  const cwd=c.cwd==='.'?'.':slicePath(c.cwd);
  if(!object(c.env)||Object.keys(c.env).length>32)fail('SLICE_INPUT_INVALID','Bounded environment required');
  for(const [k,v] of Object.entries(c.env))
   if(!/^[A-Z_][A-Z0-9_]{0,63}$/.test(k)||/^(GIT_|HF_|HYPERFIDE_|LD_)/.test(k)||['PATH','HOME'].includes(k)||typeof v!=='string'||v.length>4096||v.includes('\0'))
    fail('SLICE_INPUT_INVALID','Command environment cannot override protected execution variables');
  if(typeof c.timeout_ms!=='number'||!Number.isSafeInteger(c.timeout_ms)||c.timeout_ms<1||c.timeout_ms>10000)fail('SLICE_INPUT_INVALID','Command timeout must be 1..10000 ms');
  return {id:c.id,argv:c.argv as string[],cwd,env:c.env as Record<string,string>,timeout_ms:c.timeout_ms};
 });
}
async function strace(env:Readonly<NodeJS.ProcessEnv>):Promise<string|null>{
 for(const dir of (env.PATH??'').split(':').filter(d=>path.isAbsolute(d))){const candidate=path.join(dir,'strace');try{await fs.access(candidate,fs.constants.X_OK);return candidate;}catch{/* next */}}
 return null;
}
interface Finding {access:'READ'|'WRITE';path:string|null;source:string;reason:string}
const OBJECT_ERRORS=[/could not fetch ([0-9a-f]{40,64}) from promisor remote/g,/Not a valid object name (\S+)/g,/bad object (\S+)/g,/unable to read ([0-9a-f]{40,64})/g,/missing (?:blob )?object:? '?([0-9a-f]{40,64})/g];
async function run(input:unknown,ctx:Context):Promise<unknown>{
 const root=remotePlacement(ctx);
 const r=record(input,['organisation_id','run_id','authority_epoch','operation_id','materialisation_id','commands','build_outputs','required_paths']),s=authorise(r,ctx,REMOTE_ROLES);
 const operation=uuid(r.operation_id),materialisation=uuid(r.materialisation_id),list=commands(r.commands);
 const outputs=paths(r.build_outputs,true,64),required=paths(r.required_paths,true,256);
 const requestDigest=hash({operation_id:operation,materialisation_id:materialisation,commands:list,build_outputs:outputs,required_paths:required});
 const ready=await transaction(ctx,s,async tx=>{
  const prior=(await tx.query<{request_digest:string;receipt:SliceReceipt;id:string}>('SELECT id,request_digest,receipt FROM hyperfide.workspace_slice_receipts WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[s.organisation_id,s.run_id,operation])).rows[0];
  if(prior){if(prior.request_digest!==requestDigest)fail('SLICE_OPERATION_CONFLICT','Operation identity reused with a different request');return {replay:{...prior.receipt,receipt_id:prior.id,replayed:true}};}
  return {state:await readyWorkspace(tx,s,materialisation,root)};
 });
 if('replay' in ready)return ready.replay;
 const {manifest,workspace}=ready.state!,signal=AbortSignal.any([ctx.signal,s.invocation.signal]);
 const privateDir=await fs.mkdtemp(path.join(path.dirname(workspace),'.run-')),home=path.join(privateDir,'home'),traces=path.join(privateDir,'trace2');
 await fs.mkdir(home);await fs.mkdir(traces);
 const findings:Finding[]=[],results:Record<string,unknown>[]=[],messages:string[]=[],monitored:string[]=[];
 const monitor=await strace(ctx.env),sealedEnv={GIT_NO_LAZY_FETCH:'1'};
 let executed=false;
 try{
  const head=text(await git(['rev-parse','HEAD'],workspace,home,signal));
  if(head!==manifest.commit)fail('SLICE_HEAD_MISMATCH','Workspace HEAD differs from the slice commit');
  // A build root or input the command declares but the slice excluded is detected before anything runs.
  for(const file of required)if(!sliceIncludes(manifest,file))findings.push({access:'READ',path:file,source:'DECLARED_REQUIREMENT',reason:'BUILD_ROOT_EXCLUDED'});
  if(!monitor&&manifest.mode==='SLICE')findings.push({access:'READ',path:null,source:'ACCESS_MONITOR_UNAVAILABLE',reason:'ACCESS_MONITOR_UNAVAILABLE'});
  if(!findings.some(f=>f.source==='DECLARED_REQUIREMENT')){
   // Seal the promisor remote in the workspace's own config so every lazy fetch fails, even from processes that drop our environment.
   const origin=text(await git(['config','--get','remote.origin.url'],workspace,home,signal));
   await git(['config','remote.origin.url','file:///nonexistent/hyperfide-slice-promisor-sealed'],workspace,home,signal);
   executed=true;
   try{
    for(const command of list){
     const cwd=path.join(workspace,command.cwd);
     if(path.relative(workspace,cwd).startsWith('..')||!(await exists(cwd)))fail('SLICE_CWD_INVALID','Command directory is outside the materialised slice');
     const log=path.join(privateDir,command.id+'.strace');
     const argv=monitor?[monitor,'-f','-qq','-e','trace=%file','-e','status=failed','-o',log,'--',...command.argv]:command.argv;
     let result:Run;
     try{result=await execute(argv,{cwd,signal,timeoutMs:command.timeout_ms,maxStdout:8*1024*1024,
      env:{...command.env,PATH:process.env.PATH??'/usr/bin:/bin',HOME:home,LC_ALL:'C.UTF-8',GIT_TRACE2_EVENT:traces,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',...sealedEnv}});}
     catch(error){if(error instanceof FoundationError)throw error;result={code:127,signal:null,stdout:Buffer.alloc(0),stderr:'',stdoutDigest:sha(''),stderrDigest:sha(''),stdoutBytes:0,stderrBytes:0,durationNs:'0'};}
     // Only digests and sizes of command output enter the receipt; output bytes are never persisted.
     results.push({id:command.id,argv:command.argv,cwd:command.cwd,env_keys:Object.keys(command.env).sort(compare),env_digest:hash(command.env),timeout_ms:command.timeout_ms,exit_code:result.code,signal:result.signal,duration_ns:result.durationNs,
      stdout_digest:result.stdoutDigest,stdout_bytes:result.stdoutBytes,stderr_digest:result.stderrDigest,stderr_bytes:result.stderrBytes});
     messages.push(result.stderr);
     if(monitor&&await exists(log))for(const line of (await fs.readFile(log,'utf8')).split('\n')){
      const quoted=/"((?:[^"\\]|\\.)*)"/.exec(line)?.[1];if(!quoted)continue;
      const rel=path.relative(workspace,path.resolve(cwd,quoted));
      if(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&!rel.split(path.sep).includes('.git'))monitored.push(rel);
     }
    }
    const tree=await treeEntries(workspace,home,manifest.commit,signal),byOid=new Map<string,string[]>(),byPath=new Map(tree.map(e=>[e.path,e]));
    for(const e of tree){const paths=byOid.get(e.oid);if(paths)paths.push(e.path);else byOid.set(e.oid,[e.path]);}
    for(const name of await fs.readdir(traces))for(const line of (await fs.readFile(path.join(traces,name),'utf8')).split('\n')){
     try{const event=JSON.parse(line) as Record<string,unknown>;if(event.event==='error'&&typeof event.msg==='string')messages.push(event.msg);}catch{/* partial trace line */}
    }
    const reads=new Set<string>();
    for(const message of messages)for(const pattern of OBJECT_ERRORS)for(const match of message.matchAll(pattern)){
     const value=match[1]!,lazy=pattern===OBJECT_ERRORS[0];
     const candidates=OID.test(value)?byOid.get(value)??[]:value.includes(':')?[value.slice(value.indexOf(':')+1).replace(/^\.\//,'')]:[];
     const outside=candidates.filter(p=>byPath.has(p)&&!sliceIncludes(manifest,p));
     for(const p of outside)reads.add(p);
     if(lazy&&!outside.length&&!candidates.some(p=>sliceIncludes(manifest,p)))reads.add('git-object:'+value);
    }
    for(const p of [...reads].sort(compare))findings.push({access:'READ',path:p,source:'LAZY_FETCH',reason:'OUT_OF_SLICE_READ'});
    for(const p of [...new Set(monitored)].sort(compare))
     if(byPath.has(p)&&!sliceIncludes(manifest,p)&&!reads.has(p))findings.push({access:'READ',path:p,source:'ACCESS_MONITOR',reason:'OUT_OF_SLICE_READ'});
    const allowedWrite=(p:string)=>sliceIncludes(manifest,p)||outputs.some(o=>o===p||(o.endsWith('/')&&p.startsWith(o)));
    // Skip-worktree entries that now exist on disk are writes to excluded tracked paths.
    for(const line of (await git(['-c','sparse.expectFilesOutsideOfPatterns=true','ls-files','-t','-z'],workspace,home,signal,{env:sealedEnv})).stdout.toString('utf8').split('\0')){
     if(!line.startsWith('S '))continue;const p=line.slice(2);
     if(!allowedWrite(p)&&await exists(path.join(workspace,p)))findings.push({access:'WRITE',path:p,source:'SKIP_WORKTREE',reason:'OUT_OF_SLICE_WRITE'});
    }
    const status=(await git(['status','--porcelain=v1','-z','--untracked-files=all','--ignored'],workspace,home,signal,{env:sealedEnv})).stdout.toString('utf8').split('\0');
    for(let i=0;i<status.length;i++){
     const entry=status[i]!;if(entry.length<4)continue;
     const flags=entry.slice(0,2),p=entry.slice(3);if(flags.includes('R')||flags.includes('C'))i++;
     if(!allowedWrite(p)&&!findings.some(f=>f.path===p&&f.access==='WRITE'))findings.push({access:'WRITE',path:p,source:'WORKTREE_STATUS',reason:'OUT_OF_SLICE_WRITE'});
    }
   }finally{await git(['config','remote.origin.url',origin],workspace,home,signal);}
  }
 }finally{await fs.rm(privateDir,{recursive:true,force:true}).catch(()=>undefined);}
 const accessFindings=findings.filter(f=>f.source!=='ACCESS_MONITOR_UNAVAILABLE');
 const outcome:'PASS'|'FAIL'|'REFUSED'=findings.length?'REFUSED':results.every(x=>x.exit_code===0)&&executed?'PASS':'FAIL';
 const receipt:SliceReceipt={schema_version:1,kind:'hyperfide.workspace-slice-receipt',slice_digest:manifest.digest,materialisation_id:materialisation,commit:manifest.commit,
  graph_manifest_digest:manifest.graph_manifest_digest,mode:manifest.mode,fallback_reason:manifest.fallback_reason,
  qualification_scope:manifest.mode==='SLICE'?'SLICE':'FULL_TREE',full_tree_equivalent:manifest.mode==='FULL_TREE',qualification_outcome:outcome,
  operation_id:operation,request_digest:requestDigest,commands:results,executed,build_outputs:outputs,required_paths:required,
  access:{monitor:monitor?'STRACE':'UNAVAILABLE',lazy_fetch:'PROMISOR_SEALED_AND_GIT_NO_LAZY_FETCH',access_clean:manifest.mode==='SLICE'?(!!monitor&&!accessFindings.length):!accessFindings.length,findings},
  claims:{full_tree_qualification:manifest.mode==='FULL_TREE'?'FULL_TREE_FALLBACK':'NOT_CLAIMED'}};
 assertNotFullTreeQualification(receipt);
 const receiptId=randomUUID();
 await transaction(ctx,s,async tx=>{
  await tx.query('INSERT INTO hyperfide.workspace_slice_receipts(organisation_id,run_id,id,operation_id,request_digest,slice_digest,materialisation_id,commit,graph_manifest_digest,qualification_scope,full_tree_equivalent,qualification_outcome,receipt,receipt_digest,created_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
   [s.organisation_id,s.run_id,receiptId,operation,requestDigest,manifest.digest,materialisation,manifest.commit,manifest.graph_manifest_digest,receipt.qualification_scope,receipt.full_tree_equivalent,outcome,JSON.stringify(receipt),hash(receipt),s.credential_id]);
  for(const f of findings)
   await tx.query('INSERT INTO hyperfide.workspace_slice_access_events(organisation_id,run_id,id,slice_digest,materialisation_id,receipt_id,path,access,source,decision,reason,created_by_credential_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [s.organisation_id,s.run_id,randomUUID(),manifest.digest,materialisation,receiptId,f.path,f.access,f.source,'REFUSED',f.reason,s.credential_id]);
 });
 return {...receipt,receipt_id:receiptId,receipt_digest:hash(receipt),replayed:false};
}

export function createComponent(_context:ComponentContext):Component{
 const guard=(fn:(input:unknown,ctx:Context)=>Promise<unknown>)=>async(input:unknown,ctx:ComponentContext)=>{
  try{return await fn(input,ctx as Context);}
  catch(error){if(error instanceof FoundationError)throw error;throw new FoundationError('SLICE_OPERATION_FAILED','Slice operation failed; reconcile durable slice history before retry');}
 };
 return {apiVersion:1,capabilities:{'preparation.slices.v1':Object.freeze({assertNotFullTreeQualification,omittedInputs,sliceIncludes,verifySliceManifest})},actions:{
  'preparation.slice.describe':async(input,ctx)=>{record(input,[]);return {schema_version:1,role:ctx.role,control_actions:['preparation.slice.derive','preparation.slice.widen','preparation.slice.inspect'],
   remote_actions:['preparation.slice.materialize','preparation.slice.run','preparation.slice.release'],materialisation:'PARTIAL_CLONE_BLOB_NONE_NO_CONE_SPARSE',
   fallback:'FULL_TREE_WITH_RECORDED_REASON',qualification_scope:'SLICE_NEVER_FULL_TREE',out_of_slice_access:'REFUSED_OR_EXPLICITLY_WIDENED',budget:DEFAULT_BUDGET};},
  'preparation.slice.derive':guard(derive),'preparation.slice.widen':guard(widen),'preparation.slice.inspect':guard(inspect),
  'preparation.slice.materialize':guard(materialize),'preparation.slice.run':guard(run),'preparation.slice.release':guard(release)
 }};
}
