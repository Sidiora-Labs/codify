import path from 'node:path';
import {realpath,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import type pg from 'pg';
import {FoundationError,object} from '../policy/programme.js';
import {importRunTransaction,parseKvx,canonical,digest} from './import.js';
import type {SpecScope} from './import.js';

export interface BootstrapMetadata {
 organisation:{id:string;name:string};project:{id:string;name:string};
 repositories:{id:string;name:string;url:string;object_format:'sha1'|'sha256';checkout_root:string;
 source_objects:{object_id:string;object_type:'commit'|'tree'}[]}[];
}
const execute=promisify(execFile);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function exact(value:unknown,keys:string[]):Record<string,unknown>{
 if(!object(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))
  fail('BOOTSTRAP_METADATA_INVALID','Offline metadata must match its explicit versioned shape');
 return value;
}
function name(value:unknown):value is string{return typeof value==='string'&&value.length>=1&&value.length<=255&&value.trim().length>0&&!/[\x00-\x1f]/.test(value);}
function remote(value:unknown):value is string{
 if(typeof value!=='string'||value.length<1||value.length>1024||value.includes('?')||value.includes('#')||/[\x00-\x20]/.test(value))return false;
 if(/^git@[^/:\s]+:[^\s]+$/.test(value))return true;
 try{const url=new URL(value);return ['https:','http:','ssh:','git:'].includes(url.protocol)&&!!url.hostname&&!url.password&&(!url.username||url.protocol==='ssh:'&&url.username==='git');}catch{return false;}
}
export function validateBootstrapMetadata(value:unknown,scope:SpecScope):BootstrapMetadata{
 const input=exact(value,['organisation','project','repositories']);
 const org=exact(input.organisation,['id','name']),project=exact(input.project,['id','name']);
 if(!UUID.test(scope.organisation_id)||!UUID.test(scope.project_id)||!UUID.test(scope.run_id)||!UUID.test(scope.authority_epoch)||
  !path.isAbsolute(scope.root)||org.id!==scope.organisation_id||project.id!==scope.project_id||!name(org.name)||!name(project.name)||
  !Array.isArray(input.repositories)||input.repositories.length<1||input.repositories.length>64)
  fail('BOOTSTRAP_METADATA_INVALID','Explicit organisation, project, run and bounded repositories are required');
 const repositories=new Set<string>();let objects=0;
 for(const candidate of input.repositories){
  const repo=exact(candidate,['id','name','url','object_format','checkout_root','source_objects']);
  if(typeof repo.id!=='string'||!UUID.test(repo.id)||repositories.has(repo.id)||!name(repo.name)||!remote(repo.url)||
   !['sha1','sha256'].includes(String(repo.object_format))||typeof repo.checkout_root!=='string'||!path.isAbsolute(repo.checkout_root)||
   repo.checkout_root.length>4096||repo.checkout_root.includes('\0')||!Array.isArray(repo.source_objects)||!repo.source_objects.length)
   fail('BOOTSTRAP_METADATA_INVALID','Repository identities require explicit public remotes and local verification roots');
  repositories.add(repo.id);const seen=new Set<string>();
  for(const item of repo.source_objects){
   if(++objects>128)fail('BOOTSTRAP_METADATA_INVALID','Source-object verification inventory is bounded');
   const source=exact(item,['object_id','object_type']);
   if(typeof source.object_id!=='string'||!(repo.object_format==='sha1'?/^[0-9a-f]{40}$/:/^[0-9a-f]{64}$/).test(source.object_id)||
    seen.has(source.object_id)||!['commit','tree'].includes(String(source.object_type)))
    fail('BOOTSTRAP_METADATA_INVALID','Source objects require unique full identities and explicit object types');
   seen.add(source.object_id);
  }
 }
 return input as unknown as BootstrapMetadata;
}
// This is a privileged offline operator seam, never a public transport handler.
// Git only reads the explicitly approved checkout; no fetch, replace objects,
// hooks or user-supplied command strings can establish source identity.
async function verifySources(metadata:BootstrapMetadata):Promise<void>{
 const env:NodeJS.ProcessEnv={};
 for(const [key,value] of Object.entries(process.env))if(!key.startsWith('GIT_'))env[key]=value;
 Object.assign(env,{GIT_NO_LAZY_FETCH:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
 let totalBytes=0;
 try{
  for(const repo of metadata.repositories){
   const root=await realpath(repo.checkout_root);
   if(!(await stat(root)).isDirectory())fail('BOOTSTRAP_SOURCE_INVALID','Approved source root is not a repository directory');
   const git=async(args:string[],maxBuffer=65536)=>execute('/usr/bin/git',['-C',root,...args],{env,timeout:15000,maxBuffer,encoding:'buffer'});
   const format=(await git(['rev-parse','--show-object-format'])).stdout.toString('utf8').trim();
   if(format!==repo.object_format)fail('BOOTSTRAP_SOURCE_INVALID','Actual repository format differs from approved metadata');
   for(const source of repo.source_objects){
    const type=(await git(['cat-file','-t',source.object_id])).stdout.toString('utf8').trim();
    if(type!==source.object_type)fail('BOOTSTRAP_SOURCE_INVALID','Actual source object type differs from approved metadata');
    const rawSize=(await git(['cat-file','-s',source.object_id])).stdout.toString('utf8').trim();
    if(!/^(0|[1-9][0-9]*)$/.test(rawSize)||BigInt(rawSize)>33554432n)fail('BOOTSTRAP_SOURCE_INVALID','Source verification exceeds bounded object size');
    const size=Number(rawSize);totalBytes+=size;
    if(totalBytes>67108864)fail('BOOTSTRAP_SOURCE_INVALID','Source verification exceeds the bounded total');
    const bytes=(await git(['cat-file',source.object_type,source.object_id],size+65536)).stdout;
    const hash=createHash(repo.object_format).update(Buffer.from(source.object_type+' '+bytes.length+'\0')).update(bytes).digest('hex');
    if(bytes.length!==size||hash!==source.object_id)fail('BOOTSTRAP_SOURCE_INVALID','Source bytes differ from their full Git object identity');
   }
  }
 }catch(error){if(error instanceof FoundationError)throw error;fail('BOOTSTRAP_SOURCE_INVALID','An approved local Git source could not be verified');}
}
async function metadataTransaction(client:pg.PoolClient,scope:SpecScope,metadata:BootstrapMetadata):Promise<void>{
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope.organisation_id+':bootstrap-metadata']);
 await client.query('INSERT INTO hyperfide.organisations(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',[metadata.organisation.id,metadata.organisation.name]);
 const org=await client.query('SELECT name FROM hyperfide.organisations WHERE id=$1 FOR SHARE',[scope.organisation_id]);
 if(org.rows.length!==1||org.rows[0].name!==metadata.organisation.name)fail('BOOTSTRAP_METADATA_CONFLICT','Existing organisation differs from approved metadata');
 await client.query('INSERT INTO hyperfide.projects(organisation_id,id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[scope.organisation_id,metadata.project.id,metadata.project.name]);
 const project=await client.query('SELECT name FROM hyperfide.projects WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,scope.project_id]);
 if(project.rows.length!==1||project.rows[0].name!==metadata.project.name)fail('BOOTSTRAP_METADATA_CONFLICT','Existing project differs from approved metadata');
 for(const repo of metadata.repositories){
  await client.query('INSERT INTO hyperfide.repositories(organisation_id,project_id,id,name,url,object_format) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
   [scope.organisation_id,scope.project_id,repo.id,repo.name,repo.url,repo.object_format]);
  const record=await client.query('SELECT project_id,name,url,object_format FROM hyperfide.repositories WHERE organisation_id=$1 AND id=$2 FOR SHARE',[scope.organisation_id,repo.id]);
  const row=record.rows[0];
  if(!row||row.project_id!==scope.project_id||row.name!==repo.name||row.url!==repo.url||row.object_format!==repo.object_format)
   fail('BOOTSTRAP_METADATA_CONFLICT','Existing repository differs from approved metadata');
  for(const source of repo.source_objects){
   await client.query('INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id,object_type) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [scope.organisation_id,repo.id,source.object_id,source.object_type]);
   const result=await client.query('SELECT object_type FROM hyperfide.source_objects WHERE organisation_id=$1 AND repository_id=$2 AND object_id=$3 FOR SHARE',
    [scope.organisation_id,repo.id,source.object_id]);
   if(result.rows.length!==1||result.rows[0].object_type!==source.object_type)fail('BOOTSTRAP_METADATA_CONFLICT','Existing source object differs from its verified type');
  }
 }
}
export async function bootstrapAcceptedIntent(pool:pg.Pool,scope:SpecScope,rawMetadata:unknown,input:unknown):Promise<unknown>{
 const metadata=validateBootstrapMetadata(rawMetadata,scope);
 await verifySources(metadata);
 for(let attempt=0;attempt<3;attempt++){
 const client=await pool.connect();let committing=false;let discard:Error|undefined;
 try{
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  if((await client.query('SELECT pg_is_in_recovery() AS replica')).rows[0]?.replica)fail('PRIMARY_REQUIRED','Offline bootstrap requires the primary');
  await metadataTransaction(client,scope,metadata);
  const result=await importRunTransaction(client,scope,input);
  const tasks=await client.query('SELECT count(*)::text AS count FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2',[scope.organisation_id,scope.run_id]);
  if(tasks.rows[0]?.count==='0')fail('BOOTSTRAP_EMPTY_INTENT','Initial accepted intent must contain real tasks');
  committing=true;await client.query('COMMIT');return result;
 }catch(error){
  const code=error!==null&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:'';
  if(committing&&!['40001','40P01','23505'].includes(code)){discard=new Error('Uncertain bootstrap commit');fail('COMMIT_AMBIGUOUS','Reconcile exact accepted-intent identity before any bootstrap retry');}
  try{await client.query('ROLLBACK');}catch{discard=new Error('Bootstrap rollback was not confirmed');}
  if(['40001','40P01','23505'].includes(code)&&attempt<2)continue;
  if(error instanceof FoundationError)throw error;
  fail('BOOTSTRAP_STORAGE_UNAVAILABLE','Primary metadata and accepted intent were not confirmed');
 }finally{client.release(discard);}
 }
 fail('BOOTSTRAP_STORAGE_UNAVAILABLE','Offline bootstrap retry budget was exhausted');
}

export interface BootstrapQuery {query(text:string,values?:unknown[]):Promise<{rows:Record<string,any>[];rowCount:number|null}>}
export interface AcceptedBootstrapPins {organisation_id:string;run_id:string;authority_epoch:string;accepted_revision_digest:string}
export async function assertAcceptedBootstrap(tx:BootstrapQuery,pins:AcceptedBootstrapPins):Promise<{
 organisation_id:string;run_id:string;project_id:string;authority_epoch:string;
 spec_revision_id:string;spec_generation:string;state_version:string;revision_digest:string;source_digest:string;task_count:number;
}>{
 if(![pins.organisation_id,pins.run_id,pins.authority_epoch].every(value=>UUID.test(value))||
  !/^sha256:[0-9a-f]{64}$/.test(pins.accepted_revision_digest))
  fail('BOOTSTRAP_ACCEPTANCE_MISMATCH','Exact accepted bootstrap scope is required');
 const result=await tx.query(
 'SELECT r.project_id,r.authority_epoch,r.spec_revision_id,r.spec_generation::text,r.state_version::text,r.state,r.policy_digest,'+
 's.source_content,s.source_digest,s.revision_digest,s.document,s.schema_version,pg_is_in_recovery() AS replica,'+
 "current_setting('transaction_isolation') AS isolation FROM hyperfide.runs r "+
 'JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.project_id=r.project_id AND s.id=r.spec_revision_id '+
 'JOIN hyperfide.run_spec_revisions h ON h.organisation_id=r.organisation_id AND h.run_id=r.id AND h.spec_generation=r.spec_generation AND h.spec_revision_id=r.spec_revision_id AND h.accepted '+
 'WHERE r.organisation_id=$1 AND r.id=$2 FOR SHARE OF r,s,h',[pins.organisation_id,pins.run_id]);
 const row=result.rows[0];
 if(!row||row.replica||!['read committed','serializable'].includes(row.isolation)||row.authority_epoch!==pins.authority_epoch||
  row.state==='PLANNED'||row.schema_version!==1||row.revision_digest!==pins.accepted_revision_digest||
  !object(row.document)||row.document.schema_version!==1||row.document.revision_digest!==row.revision_digest||
  row.document.source_digest!==row.source_digest||!object(row.document.parsed)||!Array.isArray(row.document.repositories)||
  !Array.isArray(row.document.allowed_actions)||!row.document.allowed_actions.length||!object(row.document.closure_policy))
  fail('BOOTSTRAP_ACCEPTANCE_MISMATCH','A genuine current accepted intake is required before credential issuance');
 const document=row.document;
 const parsed=parseKvx(row.source_content),tasks=parsed.sections.filter(section=>section.name.startsWith('task.'));
 const accepted={schema_version:1,source_digest:row.source_digest,repositories:document.repositories,
  allowed_actions:document.allowed_actions,closure_policy:document.closure_policy,provenance:document.provenance};
 if(!tasks.length||digest(row.source_content)!==row.source_digest||canonical(parsed)!==canonical(document.parsed)||
  digest(canonical(accepted))!==row.revision_digest||
  digest(canonical({allowed_actions:document.allowed_actions,closure_policy:document.closure_policy}))!==row.policy_digest)
  fail('BOOTSTRAP_ACCEPTANCE_MISMATCH','Stored intake differs from actual accepted source or policy');
 const current=await tx.query('SELECT task_key,spec_generation::text,spec_revision_id,definition FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 ORDER BY task_key FOR SHARE',
  [pins.organisation_id,pins.run_id]);
 const sections=new Map(tasks.map(section=>[section.name.slice(5),section]));
 if(current.rows.length!==tasks.length||current.rows.some(task=>task.spec_generation!==row.spec_generation||task.spec_revision_id!==row.spec_revision_id||
  !object(task.definition)||!object(task.definition.section)||!sections.has(task.task_key)||canonical(task.definition.section)!==canonical(sections.get(task.task_key))))
  fail('BOOTSTRAP_ACCEPTANCE_MISMATCH','Typed initial tasks do not match the accepted source revision');
 const repositories=await tx.query('SELECT repository_id,source_object_id,integration_ref FROM hyperfide.run_repositories WHERE organisation_id=$1 AND run_id=$2 ORDER BY repository_id',
  [pins.organisation_id,pins.run_id]);
 if(canonical(repositories.rows)!==canonical(document.repositories))
  fail('BOOTSTRAP_ACCEPTANCE_MISMATCH','Typed accepted repositories do not match the accepted envelope');
 return {organisation_id:pins.organisation_id,run_id:pins.run_id,project_id:row.project_id,authority_epoch:row.authority_epoch,
  spec_revision_id:row.spec_revision_id,spec_generation:row.spec_generation,state_version:row.state_version,
  revision_digest:row.revision_digest,source_digest:row.source_digest,task_count:tasks.length};
}
