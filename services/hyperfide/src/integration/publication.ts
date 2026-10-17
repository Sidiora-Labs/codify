import fs from 'node:fs/promises';
import path from 'node:path';
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {FoundationError} from '../policy/programme.js';
import {bindScope,primaryClient,isolatedPush,semanticDisposition,currentInvocation,obj,keys,scope,uuid,values,hash,canonical,fail,config,repository,git,tx,candidateReady,readCandidate,currentRun,reviewCoverage, type Scope,type IntegrationConfig} from './candidates.js';
import {githubAdapter,type GitHubIntent,type HostedResult} from './github.js';
const exec=promisify(execFile);
function hostedIntent(op:Record<string,any>,m:Record<string,any>):GitHubIntent{return {organisation_id:op.organisation_id,run_id:op.run_id,operation_id:op.id,operation_generation:String(op.operation_generation),repository_id:op.repository_id,target_ref:m.target_ref,expected_old_head:op.expected_old_head,candidate_head:op.candidate_head,candidate_digest:hash(canonical(m))};}
async function hostedReceipt(db:import('./candidates.js').DB,s:Scope,id:string,result:HostedResult):Promise<void>{await db.query('INSERT INTO hyperfide.publication_hosted_receipts(organisation_id,run_id,id,operation_id,receipt_digest,receipt) VALUES($1,$2,$3,$4,$5,$6)',[...values(s),randomUUID(),id,hash(canonical(result)),result]);}
/** Hosted publication requires a separate server-enforced adapter. A local
 * receive hook establishes no GitHub ruleset or installation permissions. */
export interface ProtectedRemoteEvidence {
 provider:'GITHUB';repository_identity:string;protected_ref:string;observed_head:string;
 rules_digest:string;publisher_identity:string;direct_push_denial_receipt_digest:string;
 candidate_digest:string;authority_epoch:string;operation_id:string;operation_generation:string;
}
export interface ProtectedRemoteAdapter {
 inspectProtection(scope:Scope,repositoryId:string):Promise<{status:'ENFORCED'|'UNSUPPORTED'|'UNKNOWN';evidence?:ProtectedRemoteEvidence}>;
 publish(intent:Readonly<Permit>,evidence:ProtectedRemoteEvidence):Promise<{outcome:'PUBLISHED'|'REJECTED'|'UNKNOWN';observed_head?:string}>;
 reconcile(intent:Readonly<Permit>):Promise<{outcome:'PUBLISHED'|'REJECTED'|'UNKNOWN';observed_head?:string}>;
}
interface Permit {version:1;organisation_id:string;run_id:string;operation_id:string;generation:string;repository_id:string;ref:string;old:string;next:string;input_digest:string}
async function secret(env:Readonly<NodeJS.ProcessEnv>):Promise<Buffer>{
 const p=env.HYPERFIDE_GATEWAY_KEY_FILE;if(!p)fail('PUBLICATION_GATEWAY_UNCONFIGURED','Gateway-only key file required');
 const st=await fs.lstat(p);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size!==32)fail('PUBLICATION_GATEWAY_UNCONFIGURED','Private 32-byte gateway key required');return fs.readFile(p);
}
function sign(p:Permit,key:Buffer):string{const body=Buffer.from(canonical(p)).toString('base64url');return body+'.'+createHmac('sha256',key).update(body).digest('base64url');}
function verify(token:string,key:Buffer):Permit{
 const pieces=token.split('.');if(pieces.length!==2||!pieces.every(x=>/^[A-Za-z0-9_-]+$/.test(x)))fail('PUBLICATION_PERMIT_INVALID','Canonical signed permit required');
 const body=pieces[0]!,provided=Buffer.from(pieces[1]!,'base64url'),expected=createHmac('sha256',key).update(body).digest();
 if(provided.length!==expected.length||!timingSafeEqual(provided,expected))fail('PUBLICATION_PERMIT_INVALID','Invalid gateway signature');
 const bytes=Buffer.from(body,'base64url');if(bytes.toString('base64url')!==body)fail('PUBLICATION_PERMIT_INVALID','Noncanonical permit');
 const p=obj(JSON.parse(bytes.toString('utf8')));keys(p,['version','organisation_id','run_id','operation_id','generation','repository_id','ref','old','next','input_digest']);
 if(p.version!==1||canonical(p)!==bytes.toString('utf8'))fail('PUBLICATION_PERMIT_INVALID','Invalid permit encoding');return p as unknown as Permit;
}
export async function receivePermit(db:unknown,key:Buffer,token:string,lines:string,receivePath:string,cfg:IntegrationConfig,trustedGateway?:{withPrimaryTransaction:<T>(options:{timeoutMs:number;maxRetries:number},body:(db:import('./candidates.js').DB)=>Promise<T>)=>Promise<T>}):Promise<void>{
 const p=verify(token,key);const s=scope(p as unknown as Record<string,unknown>);if(s.organisation_id!==cfg.organisation_id)fail('PUBLICATION_SCOPE_DENIED','Wrong organisation');
 const r=repository(cfg,p.repository_id);if(r.receive_path!==receivePath)fail('PUBLICATION_TARGET_INVALID','Permit sent to another server');
 if(lines.trim()!==p.old+' '+p.next+' '+p.ref)fail('PUBLICATION_PERMIT_INVALID','Only the permitted exact ref update is allowed');
 if(!trustedGateway)fail('PUBLICATION_GATEWAY_UNCONFIGURED','Trusted process-owned primary gateway required');await trustedGateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2},async client=>{
  await semanticDisposition(client,s,'WRITE');await currentRun(client,s,true,p.operation_id);const operation=(await client.query("SELECT p.*,c.input_manifest_digest,b.authority,b.branch_generation AS current_generation FROM hyperfide.publication_operations p JOIN hyperfide.integration_candidates c ON c.organisation_id=p.organisation_id AND c.run_id=p.run_id AND c.id=p.candidate_id JOIN hyperfide.branch_authorities b ON b.organisation_id=p.organisation_id AND b.run_id=p.run_id AND b.id=p.branch_authority_id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.id=$3 FOR UPDATE OF p,b",[...values(s),uuid(p.operation_id)])).rows[0];
  if(!operation||operation.state!=='RUNNING'||operation.authority!=='ACTIVE'||String(operation.operation_generation)!==p.generation||String(operation.branch_generation)!==String(operation.current_generation)||operation.expected_old_head!==p.old||operation.candidate_head!==p.next||operation.repository_id!==p.repository_id||operation.input_manifest_digest!==p.input_digest||r.target_ref!==p.ref)fail('PUBLICATION_FENCED','Publication permit is no longer active');
  await candidateReady(client,s,operation.candidate_id,p.operation_id);
  // Repeated receive admission is refused. A lost Git acknowledgement is
  // reconciled by ref inspection; replay never blindly republishes.
  await client.query('INSERT INTO hyperfide.publication_gateway_admissions(organisation_id,run_id,operation_id,permit_digest) VALUES($1,$2,$3,$4)',[...values(s),p.operation_id,hash(token)]);
 });
}
async function operation(pool:import('./candidates.js').DB,s:Scope,id:string):Promise<Record<string,any>>{
 const r=await pool.query('SELECT * FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[...values(s),id]);return r.rows[0]??fail('PUBLICATION_UNKNOWN','Unknown publication operation');
}
async function authorizeGitRoute(repositoryId:string,targetRef:string):Promise<void>{
 const active=currentInvocation(),moduleName='../identity/authorization.js';let predicate:unknown;try{predicate=(await import(moduleName)).isAuthorizationAuthority;}catch{fail('INTEGRATION_GIT_POLICY_UNAVAILABLE','Actual identity14.4 resource policy required');}
 if(typeof predicate!=='function')fail('INTEGRATION_GIT_POLICY_UNAVAILABLE','Trusted Git policy capability unavailable');
 const dependencies=(active.context as unknown as {dependencies:{require:(id:string,name:string,predicate:any)=>{resource:(invocation:unknown,input:unknown)=>Promise<unknown>}}}).dependencies;
 const policy=dependencies.require('14.4','identity.authorization',predicate);await policy.resource(active.invocation,{kind:'git',repository_id:repositoryId,target:targetRef,profile_id:null});
}
async function authorize(pool:import('./candidates.js').DB,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','candidate_id','request_id']);const s=scope(v),id=uuid(v.candidate_id),request=uuid(v.request_id);
 const route=(await readCandidate(pool,s,id)).manifest;await authorizeGitRoute(route.repository_id,route.target_ref);
 return tx(pool,async db=>{
 const prior=(await db.query('SELECT * FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3',[...values(s),request])).rows[0];if(prior){if(prior.candidate_id!==id)fail('PUBLICATION_IDEMPOTENCY_CONFLICT','Request belongs to another candidate');return {operation_id:prior.id,state:prior.state,replayed:true};}
 // An uncertain prior intent is never superseded: its actual Git outcome must
 // be read back and settled before the target admits another publication.
 const held=(await db.query('SELECT l.operation_id,p.state FROM hyperfide.publication_target_locks l JOIN hyperfide.publication_operations p ON p.organisation_id=l.organisation_id AND p.run_id=l.run_id AND p.id=l.operation_id WHERE l.organisation_id=$1 AND l.repository_id=$2 AND l.target_ref=$3 FOR UPDATE OF l',[s.organisation_id,route.repository_id,route.target_ref])).rows[0];
 if(held)fail('PUBLICATION_RECONCILIATION_REQUIRED','Target publication '+held.operation_id+' is '+held.state+'; reconcile its actual Git outcome first');
 const {row,manifest:m}=await candidateReady(db,s,id);if(row.state!=='READY')fail('PUBLICATION_NOT_READY','Candidate must have been admitted');
 const intent=randomUUID(),op=randomUUID();await db.query("INSERT INTO hyperfide.publication_intents(organisation_id,run_id,id,candidate_id,intent_digest) VALUES($1,$2,$3,$4,$5)",[...values(s),intent,id,hash(canonical({candidate_id:id,input_digest:row.input_manifest_digest,request_id:request}))]);
 await db.query("INSERT INTO hyperfide.publication_operations(organisation_id,run_id,id,publication_intent_id,candidate_id,branch_authority_id,branch_generation,authority_epoch,repository_id,expected_old_head,candidate_head,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[...values(s),op,intent,id,m.branch_authority_id,m.branch_generation,m.authority_epoch,m.repository_id,m.expected_old_head,m.candidate_head,request]);
 await db.query('INSERT INTO hyperfide.publication_target_locks(organisation_id,repository_id,target_ref,run_id,operation_id) VALUES($1,$2,$3,$4,$5)',[s.organisation_id,m.repository_id,m.target_ref,s.run_id,op]);
 return {operation_id:op,state:'PENDING',replayed:false};
 });
}
export async function reconcilePublication(pool:import('./candidates.js').DB,cfg:IntegrationConfig,s:Scope,id:string,transportSettled=false,env:Readonly<NodeJS.ProcessEnv>=process.env,hostedResult?:HostedResult):Promise<unknown>{
 const op=await operation(pool,s,id);const {manifest:m}=await readCandidate(pool,s,op.candidate_id);const r=repository(cfg,m.repository_id);
 const hosted=!r.receive_path;if(hosted&&!hostedResult)hostedResult=await (await githubAdapter(env,m.repository_id)).reconcile(hostedIntent(op,m));
 const actual=hosted?hostedResult!.observed_head:await git(r.receive_path!,['rev-parse','--verify',m.target_ref]);
 if(hosted)transportSettled=hostedResult!.outcome==='REJECTED';
 return tx(pool,async db=>{
 if(hosted&&hostedResult)await hostedReceipt(db,s,id,hostedResult);
 const current=(await db.query('SELECT * FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),id])).rows[0];if(!current)fail('PUBLICATION_UNKNOWN','Unknown operation');
 if(current.state==='PUBLISHED'){if(actual!==current.candidate_head)fail('PUBLICATION_TARGET_DIVERGED','Published target has advanced; retained receipt is historical');return {operation_id:id,state:'PUBLISHED',observed_head:actual,replayed:true};}
 if(!['RUNNING','OUTCOME_UNKNOWN'].includes(current.state))return {operation_id:id,state:current.state,observed_head:actual,replayed:true};
 if(actual===current.candidate_head&&(!hosted||hostedResult?.outcome==='PUBLISHED'&&hostedResult.credential_revocation==='CONFIRMED')){
  const admitted=await db.query('SELECT 1 FROM hyperfide.publication_gateway_admissions WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[...values(s),id]);if(!hosted&&!admitted.rowCount)fail('PUBLICATION_PROVENANCE_UNKNOWN','Observed candidate has no gateway admission; operator reconciliation required');
  const stopped=await db.query('SELECT mode FROM hyperfide.integration_admission_halts WHERE organisation_id=$1 AND run_id=$2',values(s));let eligible=!stopped.rowCount;const heldReasons:string[]=[];
  if(eligible){try{await candidateReady(db,s,current.candidate_id,id);}catch(error){if(!(error instanceof FoundationError))throw error;eligible=false;heldReasons.push(error.code);}}
  // Admission proof establishes permission to publish, never qualification of
  // the resulting integrated source. Persist the external outcome first and
  // retain custody until acceptPublished proves fresh latest-source16/17/18.
  if(!stopped.rowCount)heldReasons.push('INTEGRATED_PUBLICATION_PROOF_REQUIRED');eligible=false;
  await db.query('INSERT INTO hyperfide.publication_acceptance_receipts(organisation_id,run_id,id,operation_id,outcome,reasons) VALUES($1,$2,$3,$4,$5,$6)',[...values(s),randomUUID(),id,eligible?'ACCEPTED':'HELD',stopped.rowCount?['CONTROL_STOPPED']:heldReasons]);
  await db.query("UPDATE hyperfide.publication_operations SET state='PUBLISHED',observed_head=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),id,actual]);
  await db.query("UPDATE hyperfide.publication_intents SET state='PUBLISHED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),current.publication_intent_id]);
  await db.query("UPDATE hyperfide.integration_candidates SET state='PUBLISHED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),current.candidate_id]);
  // A terminal external receipt alone never releases custody. Preserve
  // ACTIVE contributors for fresh integrated-source qualification; emergency
  // controls may revoke only after the issued effect is reconciled.
  const contributors=(await db.query('SELECT * FROM hyperfide.candidate_custodies WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3',[...values(s),current.candidate_id])).rows;
  for(const c of contributors){
   if(stopped.rowCount){await db.query("UPDATE hyperfide.tasks SET state='CANCELLED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND current_custody_id=$4",[...values(s),c.task_id,c.custody_id]);await db.query("UPDATE hyperfide.submission_custodies SET authority='REVOKED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND authority='ACTIVE'",[...values(s),c.custody_id]);await db.query("UPDATE hyperfide.integration_revocation_debt SET state='RECONCILED' WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3 AND custody_id=$4",[...values(s),id,c.custody_id]);continue;}
   // Custody remains ACTIVE; only acceptPublished may release it.
  }
  await db.query("UPDATE hyperfide.branch_authorities SET authority='RELEASED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),current.branch_authority_id]);
  await db.query('DELETE FROM hyperfide.publication_target_locks WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[...values(s),id]);
  return {operation_id:id,state:'PUBLISHED',observed_head:actual,integrated:!stopped.rowCount&&eligible,acceptance:eligible?'ACCEPTED':'HELD',acceptance_held_reasons:heldReasons,custody_release_held:!stopped.rowCount&&!eligible,wave_closed:false,programme_qualified:false};
 }
 if(transportSettled&&actual===current.expected_old_head){
  await db.query("UPDATE hyperfide.publication_operations SET state='FAILED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),id]);
  await db.query("UPDATE hyperfide.publication_intents SET state='FAILED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),current.publication_intent_id]);
  await db.query('DELETE FROM hyperfide.publication_target_locks WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[...values(s),id]);
  return {operation_id:id,state:'FAILED',observed_head:actual,requires_fresh_candidate:true};
 }
 // Reading the old ref cannot establish that an already accepted push has
 // stopped. Keep the target fenced until the transport/job is reconciled.
 await db.query("UPDATE hyperfide.publication_operations SET state='OUTCOME_UNKNOWN',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),id]);
 return {operation_id:id,state:'OUTCOME_UNKNOWN',observed_head:actual,expected_head_still_present:actual===current.expected_old_head,requires_reconciliation:true};
 });
}
async function headChanged(pool:import('./candidates.js').DB,s:Scope,id:string,intent:string):Promise<never>{
 // Nothing was sent, so the outcome is known: settle without touching the target.
 await tx(pool,async db=>{await db.query("UPDATE hyperfide.publication_operations SET state='FAILED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state IN ('PENDING','RUNNING')",[...values(s),id]);await db.query("UPDATE hyperfide.publication_intents SET state='FAILED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),intent]);await db.query('DELETE FROM hyperfide.publication_target_locks WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[...values(s),id]);});
 return fail('PUBLICATION_HEAD_CHANGED','Protected target changed; build a fresh candidate');
}
async function executePublication(pool:import('./candidates.js').DB,cfg:IntegrationConfig,env:Readonly<NodeJS.ProcessEnv>,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','operation_id']);const s=scope(v),id=uuid(v.operation_id);
 if(env.HYPERFIDE_INTEGRATION_ROLE!=='PUBLICATION_GATEWAY')fail('PUBLICATION_ROLE_DENIED','Only the isolated publication gateway may write protected refs');
 const initial=await operation(pool,s,id);const initialCandidate=await readCandidate(pool,s,initial.candidate_id);const target=repository(cfg,initialCandidate.manifest.repository_id);
 if(initial.state==='PENDING')await authorizeGitRoute(initialCandidate.manifest.repository_id,initialCandidate.manifest.target_ref);
 if(!target.receive_path){const adapter=await githubAdapter(env,target.repository_id);await adapter.inspectProtection();const prepared=await tx(pool,async db=>{const op=(await db.query('SELECT * FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),id])).rows[0];if(!op)fail('PUBLICATION_UNKNOWN','Unknown operation');if(op.state!=='PENDING')return {op,send:false,manifest:(await readCandidate(db,s,op.candidate_id)).manifest};const candidate=await candidateReady(db,s,op.candidate_id,id);await db.query("UPDATE hyperfide.publication_operations SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),id]);await db.query("UPDATE hyperfide.publication_intents SET state='EXECUTING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),op.publication_intent_id]);return {op,send:true,manifest:candidate.manifest};});if(!prepared.send)return reconcilePublication(pool,cfg,s,id,false,env);const result=await adapter.publish(hostedIntent(prepared.op,prepared.manifest),target.path);return reconcilePublication(pool,cfg,s,id,false,env,result);}
 const signingKey=await secret(env);
 if(!target.receive_path)fail('PUBLICATION_ENFORCEMENT_UNAVAILABLE','Managed receive target is required');
 const hook=path.join(target.receive_path,'hooks','pre-receive'),hookInfo=await fs.lstat(hook);
 if(!hookInfo.isFile()||hookInfo.isSymbolicLink()||(hookInfo.mode&0o022)!==0||hash(await fs.readFile(hook))!==env.HYPERFIDE_GATEWAY_HOOK_DIGEST)fail('PUBLICATION_ENFORCEMENT_UNAVAILABLE','Operator-pinned receive hook is absent or changed');
 const effectiveHooks=(await exec('git',['--git-dir='+target.receive_path,'config','--get','core.hooksPath'],{encoding:'utf8',env:{PATH:env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}})).stdout.trim();
 if(effectiveHooks!==path.join(target.receive_path,'hooks'))fail('PUBLICATION_ENFORCEMENT_UNAVAILABLE','Effective receive hook path differs from pinned gateway');
 // Compare-and-swap precheck: a target advanced since qualification refuses
 // the intent before admission. The receive hook and lease re-check at push.
 if(initial.state==='PENDING'&&await git(target.receive_path,['rev-parse','--verify',target.target_ref])!==initial.expected_old_head)await headChanged(pool,s,id,initial.publication_intent_id);
 const prepared=await tx(pool,async db=>{
 const op=(await db.query('SELECT * FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),id])).rows[0];if(!op)fail('PUBLICATION_UNKNOWN','Unknown operation');
 if(op.state!=='PENDING')return {op,send:false,manifest:(await readCandidate(db,s,op.candidate_id)).manifest,input:''};
 const c=await candidateReady(db,s,op.candidate_id);await db.query("UPDATE hyperfide.publication_operations SET state='RUNNING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),id]);await db.query("UPDATE hyperfide.publication_intents SET state='EXECUTING',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),op.publication_intent_id]);return {op,send:true,manifest:c.manifest,input:c.row.input_manifest_digest};
 });
 if(!prepared.send)return reconcilePublication(pool,cfg,s,id);
 const m=prepared.manifest,r=repository(cfg,m.repository_id);
 if(!r.receive_path)fail('PUBLICATION_ENFORCEMENT_UNAVAILABLE','Configured target has no qualified managed receive hook');
 const actual=await git(r.receive_path,['rev-parse','--verify',r.target_ref]);if(actual!==m.expected_old_head)await headChanged(pool,s,id,prepared.op.publication_intent_id);
 await git(r.path,['merge-base','--is-ancestor',m.expected_old_head,m.candidate_head]);
 const permit:Permit={version:1,organisation_id:s.organisation_id,run_id:s.run_id,operation_id:id,generation:String(prepared.op.operation_generation),repository_id:m.repository_id,ref:r.target_ref,old:m.expected_old_head,next:m.candidate_head,input_digest:prepared.input};
 let transportSettled=false;
 try{
 // Server hook enforces operation generation and exact old/new/ref. Explicit
 // lease CAS is additional protection; normal ancestry is checked separately.
 await pushManaged(r.path,r.receive_path,r.target_ref,m.candidate_head,m.expected_old_head,sign(permit,signingKey),env);
 transportSettled=true;
 }catch(error){const code=(error as {code?:unknown}).code;transportSettled=typeof code==='number'&&Number.isInteger(code);}
 return reconcilePublication(pool,cfg,s,id,transportSettled,env);
}
/** Shared product transport: suppress client hooks without disabling the server receive hook. */
export async function pushManaged(repositoryPath:string,receivePath:string,ref:string,next:string,old:string,permitToken:string,env:Readonly<NodeJS.ProcessEnv>):Promise<void>{
 await isolatedPush(repositoryPath,['--porcelain','--force-with-lease='+ref+':'+old,'-o','hf-permit='+permitToken,receivePath,next+':'+ref],env,'file');
}
export async function installGatewayHook(receivePath:string,serverConfigPath:string,node=process.execPath):Promise<void>{
 // Explicit operator setup, not an agent request. File permissions and OS
 // identities must prevent workers modifying this hook/config or server refs.
 const quote=(v:string)=>"'"+v.replaceAll("'","'\\''")+"'";
 const module=fileURLToPath(import.meta.url),hooks=path.join(receivePath,'hooks');await fs.mkdir(hooks,{recursive:true});
 const script='#!/bin/sh\nexec '+quote(node)+' '+quote(module)+' --receive-hook '+quote(serverConfigPath)+'\n';
 await fs.writeFile(path.join(hooks,'pre-receive'),script,{mode:0o755});
 await exec('git',['--git-dir='+receivePath,'config','core.hooksPath',hooks]);
 await exec('git',['--git-dir='+receivePath,'config','receive.advertisePushOptions','true']);
}
export async function inspectIntegratedPublication(db:import('./candidates.js').DB,s:Scope,pins:{task_id:string;custody_id:string;custody_generation:string}):Promise<Record<string,unknown>>{
 const txModule='../storage/transactions.js';(await import(txModule)).assertPrimaryTransaction(db);await semanticDisposition(db,s,'READ');
 const original=(await db.query("SELECT p.*,m.manifest,c.input_manifest_digest,c.state AS candidate_state FROM hyperfide.publication_operations p JOIN hyperfide.integration_candidates c ON c.organisation_id=p.organisation_id AND c.run_id=p.run_id AND c.id=p.candidate_id JOIN hyperfide.integration_candidate_manifests m ON m.organisation_id=c.organisation_id AND m.run_id=c.run_id AND m.candidate_id=c.id JOIN hyperfide.candidate_custodies custody ON custody.organisation_id=c.organisation_id AND custody.run_id=c.run_id AND custody.candidate_id=c.id WHERE p.organisation_id=$1 AND p.run_id=$2 AND custody.task_id=$3 AND custody.custody_id=$4 AND custody.custody_generation=$5 ORDER BY p.created_at DESC,p.id DESC LIMIT 1",[...values(s),uuid(pins.task_id),uuid(pins.custody_id),pins.custody_generation])).rows[0];
 if(!original)return {status:'MISSING',current_source:null,lineage_status:'ORIGINAL_PUBLICATION_MISSING'};
 const valid=(row:Record<string,any>):boolean=>row.state==='PUBLISHED'&&row.candidate_state==='PUBLISHED'&&row.observed_head===row.candidate_head&&hash(canonical(row.manifest))===row.input_manifest_digest&&row.manifest.candidate_head===row.candidate_head&&Array.isArray(row.manifest.parents)&&row.manifest.parents.length>0&&row.manifest.git_provenance_manifest&&hash(canonical(row.manifest.git_provenance_manifest))===row.manifest.git_provenance_manifest_digest;
 if(!valid(original))return {status:'STALE',current_source:null,lineage_status:'ORIGINAL_PUBLICATION_INVALID'};
 const contributor=original.manifest.contributors.find((c:Record<string,unknown>)=>c.task_id===pins.task_id&&c.custody_id===pins.custody_id&&c.custody_generation===pins.custody_generation);if(!contributor)return {status:'STALE',current_source:null,lineage_status:'CUSTODY_ATTRIBUTION_MISSING'};
 const operations=(await db.query("SELECT p.*,m.manifest,c.input_manifest_digest,c.state AS candidate_state FROM hyperfide.publication_operations p JOIN hyperfide.integration_candidates c ON c.organisation_id=p.organisation_id AND c.run_id=p.run_id AND c.id=p.candidate_id JOIN hyperfide.integration_candidate_manifests m ON m.organisation_id=c.organisation_id AND m.run_id=c.run_id AND m.candidate_id=c.id WHERE p.organisation_id=$1 AND p.repository_id=$2 AND m.manifest->>'target_ref'=$3 ORDER BY p.created_at,p.id",[s.organisation_id,original.repository_id,original.manifest.target_ref])).rows;
 const published=operations.filter(row=>row.state==='PUBLISHED'),latest=published.at(-1);
 const originalReceipt={operation_id:original.id,candidate_id:original.candidate_id,repository_id:original.repository_id,source_object_id:original.candidate_head,tree:original.manifest.tree,parents:original.manifest.parents,integration_input_manifest_digest:original.input_manifest_digest,git_provenance_manifest_digest:original.manifest.git_provenance_manifest_digest,observed_head:original.observed_head,contributor};
 if(!latest||!valid(latest)||latest.run_id!==s.run_id)return {status:'STALE',original_publication:originalReceipt,current_source:null,latest_repository_head:latest?.candidate_head??null,lineage_status:'LATEST_PUBLICATION_OWNERSHIP_UNPROVEN'};
 if(operations.some(row=>['RUNNING','OUTCOME_UNKNOWN'].includes(row.state)))return {status:'STALE',original_publication:originalReceipt,current_source:null,latest_repository_head:latest.candidate_head,lineage_status:'EXTERNAL_OUTCOME_UNKNOWN'};
 const index=published.findIndex(row=>row.id===original.id);let prior=original.candidate_head;
 for(const row of published.slice(index+1)){if(!valid(row)||row.run_id!==s.run_id||row.expected_old_head!==prior)return {status:'STALE',original_publication:originalReceipt,current_source:null,latest_repository_head:latest.candidate_head,lineage_status:'PUBLICATION_CHAIN_UNPROVEN'};prior=row.candidate_head;}
 const physical=(await db.query("SELECT source_manifest_digest FROM hyperfide.integration_jobs WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3 AND state='SUCCEEDED' AND source_object_id=$4 AND source_tree_id=$5 ORDER BY created_at DESC,id DESC LIMIT 1",[...values(s),latest.candidate_id,latest.candidate_head,latest.manifest.tree])).rows[0];
 const currentSource={repository_id:latest.repository_id,source_object_id:latest.candidate_head,tree:latest.manifest.tree,parents:latest.manifest.parents,source_manifest_digest:physical?.source_manifest_digest??null,git_provenance_manifest_digest:latest.manifest.git_provenance_manifest_digest,git_provenance_manifest:latest.manifest.git_provenance_manifest,integration_input_manifest_digest:latest.input_manifest_digest,operation_id:latest.id,candidate_id:latest.candidate_id,execution_receipt_digest:latest.manifest.execution_receipt_digest};
 return {status:'PUBLISHED',original_publication:originalReceipt,current_source:currentSource,latest_repository_head:latest.candidate_head,lineage_status:'VERIFIED_PUBLISHED_CHAIN',original_observation_is_current_head:original.candidate_head===latest.candidate_head,operation_id:latest.id,candidate_id:latest.candidate_id,repository_id:latest.repository_id,source_object_id:latest.candidate_head,tree:latest.manifest.tree,parents:latest.manifest.parents,source_manifest_digest:physical?.source_manifest_digest??null,git_provenance_manifest_digest:latest.manifest.git_provenance_manifest_digest,integration_input_manifest_digest:latest.input_manifest_digest,input_manifest_digest:latest.input_manifest_digest,authority_epoch:latest.manifest.authority_epoch,spec_revision_id:latest.manifest.spec_revision_id,spec_generation:latest.manifest.spec_generation,branch_generation:latest.manifest.branch_generation,contributor,observed_head:latest.observed_head,execution_receipt_digest:latest.manifest.execution_receipt_digest};
}
async function acceptPublished(pool:import('./candidates.js').DB,cfg:IntegrationConfig,env:Readonly<NodeJS.ProcessEnv>,input:unknown):Promise<unknown>{
 const v=obj(input);keys(v,['organisation_id','run_id','operation_id']);const s=scope(v),id=uuid(v.operation_id),op=await operation(pool,s,id);
 if(op.state!=='PUBLISHED')fail('PUBLICATION_NOT_OBSERVED','External publication must be terminal before acceptance');
 const original=await readCandidate(pool,s,op.candidate_id),target=repository(cfg,op.repository_id);
 // Observe Git before taking the primary/findings barrier. No network or Git
 // process runs while current assurance and custody release are decided.
 const observed=target.receive_path?await git(target.receive_path,['rev-parse','--verify',target.target_ref]):await(await githubAdapter(env,op.repository_id)).observeHead();
 return tx(pool,async db=>{
  await currentRun(db,s,true);const current=(await db.query('SELECT * FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[...values(s),id])).rows[0];if(current?.state!=='PUBLISHED')fail('PUBLICATION_NOT_OBSERVED','Terminal publication receipt changed');
  const contributors=(await db.query('SELECT cc.*,c.authority,c.custody_generation,t.current_custody_id,t.criteria_digest FROM hyperfide.candidate_custodies cc JOIN hyperfide.submission_custodies c ON c.organisation_id=cc.organisation_id AND c.run_id=cc.run_id AND c.id=cc.custody_id JOIN hyperfide.tasks t ON t.organisation_id=cc.organisation_id AND t.run_id=cc.run_id AND t.id=cc.task_id WHERE cc.organisation_id=$1 AND cc.run_id=$2 AND cc.candidate_id=$3 FOR UPDATE OF c,t',[...values(s),current.candidate_id])).rows;
  if(!contributors.length)fail('PUBLICATION_ATTRIBUTION_MISSING','Immutable contributor custody required');
  const proofs:Record<string,unknown>[]=[],coverageModule='../assurance/coverage.js';let source:Record<string,any>|undefined;
  for(const contributor of contributors){
   const publication=await inspectIntegratedPublication(db,s,{task_id:contributor.task_id,custody_id:contributor.custody_id,custody_generation:String(contributor.custody_generation)});
   if(publication.status!=='PUBLISHED'||!publication.current_source||publication.latest_repository_head!==observed)fail('PUBLICATION_CURRENT_SOURCE_HELD','Actual observed target and latest owned publication must agree');
   source=publication.current_source as Record<string,any>;
   if(contributor.authority==='RELEASED'){const validityModule='../assurance/validity.js';const validity=await(await import(validityModule)).inspectValidity(db,s,contributor.custody_id);if(validity.current_integrated_assurance!==true)fail('PUBLICATION_ASSURANCE_HELD','Released contributor has no current integrated proof');proofs.push({custody_id:contributor.custody_id,receipt_digest:validity.receipt_digest});continue;}
   const proof=await(await import(coverageModule)).inspectCoverage(db,s,contributor.custody_id);
   if(contributor.authority!=='ACTIVE'||contributor.current_custody_id!==contributor.custody_id||proof.qualified!==true||proof.applicability!=='CURRENT'||proof.proof_registry_current!==true||proof.proof_criteria_digest!==contributor.criteria_digest||proof.proof_source_object_id!==source.source_object_id||proof.proof_source_origin!=='INTEGRATED_PUBLICATION'||proof.proof_publication_operation_id!==source.operation_id)fail('PUBLICATION_ASSURANCE_HELD','Fresh qualified ACTIVE proof of the exact latest published source is required');
   proofs.push({custody_id:contributor.custody_id,receipt_digest:proof.receipt_digest,source_object_id:proof.proof_source_object_id,publication_operation_id:proof.proof_publication_operation_id});
  }
  if(!source)fail('PUBLICATION_CURRENT_SOURCE_HELD','Current published source unavailable');
  const latest=await readCandidate(db,s,String(source.candidate_id));const reviews=await reviewCoverage(db,s,latest.manifest,latest.row.input_manifest_digest,latest.row.id,'CURRENT_PUBLISHED');
  const findingModule='../findings/registry.js';const findings=await(await import(findingModule)).inspectBlockingFindings(db,{...s,repository_id:op.repository_id,source_object_id:source.source_object_id});if(findings.clear!==true)fail('PUBLICATION_FINDING_BLOCKS','Current canonical findings block custody acceptance');
  for(const contributor of contributors){if(contributor.authority==='ACTIVE'){await db.query("UPDATE hyperfide.submission_custodies SET authority='RELEASED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND authority='ACTIVE'",[...values(s),contributor.custody_id]);await db.query("UPDATE hyperfide.tasks SET state='INTEGRATED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND current_custody_id=$4 AND state<>'INTEGRATED'",[...values(s),contributor.task_id,contributor.custody_id]);}}
  await db.query("INSERT INTO hyperfide.publication_acceptance_receipts(organisation_id,run_id,id,operation_id,outcome,reasons,manifest) VALUES($1,$2,$3,$4,'ACCEPTED',ARRAY[]::text[],$5)",[...values(s),randomUUID(),id,{current_source:source,proofs,review_bindings_digest:reviews.digest}]);
  return {operation_id:id,external_state:'PUBLISHED',acceptance:'ACCEPTED',integrated:true,push_replayed:false,wave_closed:false,programme_qualified:false};
 });
}
export async function stopIntegration(db:import('./candidates.js').DB,s:Scope,control:{mode:'CANCEL'|'STOP';control_generation:string}):Promise<{cancelled_operation_ids:string[];unresolved_operation_ids:string[];deferred_custody_ids:string[];safe_to_revoke_custody_ids:string[]}>{
 await semanticDisposition(db,s,'WRITE');
 if(!['CANCEL','STOP'].includes(control.mode)||!/^[1-9][0-9]*$/.test(control.control_generation))fail('INTEGRATION_STOP_INVALID','Exact emergency control generation required');
 await db.query('SELECT 1 FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE',values(s));
 await db.query('INSERT INTO hyperfide.integration_admission_halts(organisation_id,run_id,mode,control_generation) VALUES($1,$2,$3,$4) ON CONFLICT(organisation_id,run_id) DO UPDATE SET mode=EXCLUDED.mode,control_generation=EXCLUDED.control_generation WHERE hyperfide.integration_admission_halts.control_generation<EXCLUDED.control_generation',[...values(s),control.mode,control.control_generation]);
 const accepted=(await db.query('SELECT mode,control_generation::text FROM hyperfide.integration_admission_halts WHERE organisation_id=$1 AND run_id=$2 FOR UPDATE',values(s))).rows[0];if(!accepted||accepted.control_generation!==control.control_generation||accepted.mode!==control.mode)fail('INTEGRATION_CONTROL_FENCED','Control generation is stale or reused with another mode');
 const operations=(await db.query("SELECT * FROM hyperfide.publication_operations WHERE organisation_id=$1 AND run_id=$2 AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN') FOR UPDATE",values(s))).rows;
 const cancelled:string[]=[],unresolved:string[]=[],deferred=new Set<string>();
 for(const op of operations){
  if(op.state==='PENDING'){
   await db.query("UPDATE hyperfide.publication_operations SET state='CANCELLED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),op.id]);
   await db.query("UPDATE hyperfide.publication_intents SET state='CANCELLED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[...values(s),op.publication_intent_id]);
   await db.query('DELETE FROM hyperfide.publication_target_locks WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[...values(s),op.id]);cancelled.push(op.id);
  }else{
   unresolved.push(op.id);const contributors=(await db.query('SELECT custody_id FROM hyperfide.candidate_custodies WHERE organisation_id=$1 AND run_id=$2 AND candidate_id=$3',[...values(s),op.candidate_id])).rows;
   for(const contributor of contributors){deferred.add(contributor.custody_id);await db.query("INSERT INTO hyperfide.integration_revocation_debt(organisation_id,run_id,operation_id,custody_id,mode,control_generation) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[...values(s),op.id,contributor.custody_id,control.mode,control.control_generation]);}
  }
 }
 const active=(await db.query("SELECT id FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND authority='ACTIVE'",values(s))).rows.map(r=>String(r.id));
 return {cancelled_operation_ids:cancelled,unresolved_operation_ids:unresolved,deferred_custody_ids:[...deferred].sort(),safe_to_revoke_custody_ids:active.filter(id=>!deferred.has(id)).sort()};
}
export function createComponent(ctx:ComponentContext):Component{
 let cfg:Promise<IntegrationConfig>|undefined;const settings=()=>cfg??=config(ctx.env);
 return bindScope(ctx,{apiVersion:1,actions:{
 'integration.publication.capabilities':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','repository_id']);const r=repository(await settings(),uuid(v.repository_id));return {repository_id:r.repository_id,managed_receive_configured:!!r.receive_path,managed_receive_live_qualified:false,github:{status:ctx.env.HYPERFIDE_GITHUB_PUBLICATION_CONFIG?'CONFIGURED_NOT_LIVE_QUALIFIED':'NOT_CONFIGURED',adapter_implemented:true,writes_require:'ACTUAL_SOLE_PUBLISHER_RULES_AND_CURRENT_SIGNED_WORKER_DENIAL',live_qualified:false},scope:'TRANSPORT_CAPABILITY_ONLY'};},
 'integration.publication.protection':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','repository_id']);return(await githubAdapter(ctx.env,uuid(v.repository_id))).inspectProtection();},
 'integration.publication.accept':async input=>acceptPublished(primaryClient(),await settings(),ctx.env,input),
 'integration.publication.authorize':async input=>authorize(primaryClient(),input),
 'integration.publication.execute':async input=>executePublication(primaryClient(),await settings(),ctx.env,input),
 'integration.publication.reconcile':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','operation_id']);return reconcilePublication(primaryClient(),await settings(),scope(v),uuid(v.operation_id),false,ctx.env);},
 'integration.publication.inspect':async input=>{const v=obj(input);keys(v,['organisation_id','run_id','operation_id']);return operation(primaryClient(),scope(v),uuid(v.operation_id));}
 }});
}
if(process.argv[2]==='--receive-hook'){
 try{
 const filename=process.argv[3];if(!filename)fail('PUBLICATION_GATEWAY_UNCONFIGURED','Server configuration required');const st=await fs.lstat(filename);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size>65536)fail('PUBLICATION_GATEWAY_UNCONFIGURED','Private server configuration required');
 const env=obj(JSON.parse(await fs.readFile(filename,'utf8'))) as NodeJS.ProcessEnv;const cfg=await config(env);const key=await secret(env);const count=Number(process.env.GIT_PUSH_OPTION_COUNT);if(count!==1||!process.env.GIT_PUSH_OPTION_0?.startsWith('hf-permit='))fail('PUBLICATION_PERMIT_REQUIRED','Protected pushes require a gateway permit');
 let lines='';for await(const chunk of process.stdin){lines+=chunk.toString();if(lines.length>1024)fail('PUBLICATION_PERMIT_INVALID','One protected update only');}
 const runtime='../storage/runtime.js';const ResourceContainer=(await import(runtime)).ResourceContainer;const resources=new ResourceContainer('control',env,new AbortController().signal);try{await receivePermit(null,key,process.env.GIT_PUSH_OPTION_0.slice(10),lines,await fs.realpath(process.cwd()),cfg,resources.gateway);}finally{await resources.close();}
 process.exit(0);
 }catch(error){const code=error instanceof FoundationError?error.code:'PUBLICATION_GATEWAY_ERROR';process.stderr.write('Hyperfide publication gateway rejected protected update: '+code+'\n');process.exit(1);}
}
