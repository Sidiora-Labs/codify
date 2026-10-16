/**
 * GitHub hosted publication. Official REST contracts:
 * https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch
 * https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset
 * https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection
 * https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
 *
 * Ruleset bypass actors may be omitted without write access to the ruleset.
 * Omission is UNKNOWN, never proof that no bypass actor exists. Configuration
 * and keys are operator-only; this adapter never modifies repository protection.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createPrivateKey,sign,verify,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {obj,keys,hash,canonical,fail,oid,git,isolatedPush,type Scope} from './candidates.js';
const exec=promisify(execFile);
const API='https://api.github.com';
const API_VERSION='2026-03-10';
interface GitHubProfile {
 owner:string;repository:string;repository_numeric_id:number;app_id:number;installation_id:number;
 app_private_key_file:string;audit_token_file:string;denial_receipt_file:string;denial_signer_public_key_file:string;
 expected_rules_digest:string;credential_directory:string;target_ref:string;
}
export interface GitHubProtection {
 provider:'GITHUB';repository_identity:string;repository_numeric_id:number;protected_ref:string;
 observed_head:string;rules_digest:string;publisher_identity:string;direct_push_denial_receipt_digest:string;
 policy_observed_at:string;
}
export interface GitHubIntent {
 organisation_id:string;run_id:string;operation_id:string;operation_generation:string;
 repository_id:string;target_ref:string;expected_old_head:string;candidate_head:string;candidate_digest:string;
}
export interface HostedResult {outcome:'PUBLISHED'|'REJECTED'|'UNKNOWN';observed_head:string;credential_revocation:'CONFIRMED'|'UNKNOWN';rules_digest:string;push_issued?:boolean;credential_expires_at?:string|null;credential_custody?:'PERSISTED'|'ORPHANED';failure_stage?:string}
export type GitHubTransport=(route:string,token:string,method?:string,body?:unknown)=>Promise<{status:number;body:unknown}>;
async function privateBytes(filename:string,max=65536):Promise<Buffer>{
 if(!path.isAbsolute(filename))fail('GITHUB_CONFIG_INVALID','Absolute private credential path required');
 const st=await fs.lstat(filename);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size>max)fail('GITHUB_CONFIG_INVALID','Private bounded credential file required');return fs.readFile(filename);
}
export async function githubHTTP(route:string,token:string,method='GET',body?:unknown):Promise<{status:number;body:unknown}>{
 if(!route.startsWith('/')||route.startsWith('//')||route.includes('\0'))fail('GITHUB_ROUTE_INVALID','Fixed GitHub API route required');
 let response:Response;
 try{response=await fetch(API+route,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/vnd.github+json',authorization:'Bearer '+token,'x-github-api-version':API_VERSION,'user-agent':'Hyperfide-publication','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 catch{return {status:0,body:{}};}
 const reader=response.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
 if(reader)for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1048576){await reader.cancel();fail('GITHUB_RESPONSE_UNBOUNDED','GitHub response exceeded bound');}chunks.push(part.value);}
 const raw=Buffer.concat(chunks).toString('utf8');let value:unknown={};try{if(raw)value=JSON.parse(raw);}catch{fail('GITHUB_RESPONSE_INVALID','GitHub response was not JSON');}
 return {status:response.status,body:value};
}
function integer(v:unknown):number{if(!Number.isSafeInteger(v)||Number(v)<1)fail('GITHUB_CONFIG_INVALID','Positive provider integer required');return Number(v);}
export async function loadGitHubProfile(env:Readonly<NodeJS.ProcessEnv>,repositoryId:string):Promise<GitHubProfile>{
 const filename=env.HYPERFIDE_GITHUB_PUBLICATION_CONFIG;if(!filename)fail('GITHUB_PUBLICATION_NOT_CONFIGURED','Trusted GitHub App publication profile required');
 const document=obj(JSON.parse((await privateBytes(filename,262144)).toString('utf8')));keys(document,['version','repositories']);if(document.version!==1)fail('GITHUB_CONFIG_INVALID','Unknown GitHub profile version');const p=obj(obj(document.repositories)[repositoryId]);
 keys(p,['owner','repository','repository_numeric_id','app_id','installation_id','app_private_key_file','audit_token_file','denial_receipt_file','denial_signer_public_key_file','expected_rules_digest','credential_directory','target_ref']);
 if(typeof p.owner!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(p.owner)||typeof p.repository!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(p.repository)||p.repository==='.'||p.repository==='..'||typeof p.target_ref!=='string'||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(p.target_ref)||p.target_ref.includes('..'))fail('GITHUB_CONFIG_INVALID','Canonical GitHub repository/ref required');
 integer(p.repository_numeric_id);integer(p.app_id);integer(p.installation_id);
 for(const field of ['app_private_key_file','audit_token_file','denial_receipt_file','denial_signer_public_key_file','credential_directory'])if(typeof p[field]!=='string'||!path.isAbsolute(String(p[field])))fail('GITHUB_CONFIG_INVALID','Trusted absolute credential references required');
 if(typeof p.expected_rules_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(p.expected_rules_digest))fail('GITHUB_CONFIG_INVALID','Operator-accepted protection digest required');
 return p as unknown as GitHubProfile;
}
export function validateGitHubProtection(profile:GitHubProfile,repository:unknown,activeRules:unknown,rulesets:unknown[],classic:unknown):string{
 const repo=obj(repository);if(repo.id!==profile.repository_numeric_id||String(repo.full_name).toLowerCase()!==(profile.owner+'/'+profile.repository).toLowerCase())fail('GITHUB_REPOSITORY_IDENTITY_CHANGED','GitHub repository identity differs');
 if(!Array.isArray(activeRules)||activeRules.length>1000)fail('GITHUB_RULES_UNAVAILABLE','Complete active branch-rule inventory required');
 const applied=activeRules.map(obj);
 const sets=rulesets.map(obj);let solePublisher=false,nonFastForward=false;
 for(const ruleset of sets){
  if(ruleset.enforcement!=='active'||ruleset.target!=='branch'||!Array.isArray(ruleset.bypass_actors)||!Array.isArray(ruleset.rules))fail('GITHUB_BYPASS_INVENTORY_UNAVAILABLE','Active ruleset and complete bypass actor inventory required');
  const effective=applied.filter(r=>r.ruleset_id===ruleset.id);const rules=ruleset.rules.map(obj),actors=ruleset.bypass_actors.map(obj);
  if(effective.some(r=>r.type==='update')&&rules.some(r=>r.type==='update')&&actors.length===1&&actors[0]!.actor_type==='Integration'&&actors[0]!.actor_id===profile.app_id&&actors[0]!.bypass_mode==='always')solePublisher=true;
  if(effective.some(r=>r.type==='non_fast_forward')&&rules.some(r=>r.type==='non_fast_forward')&&actors.length===0)nonFastForward=true;
 }
 if(classic!==null){
  const b=obj(classic),restrictions=obj(b.restrictions),apps=restrictions.apps;
  if(obj(b.enforce_admins).enabled===true&&obj(b.allow_force_pushes).enabled===false&&Array.isArray(restrictions.users)&&!restrictions.users.length&&Array.isArray(restrictions.teams)&&!restrictions.teams.length&&Array.isArray(apps)&&apps.length===1&&obj(apps[0]).id===profile.app_id){solePublisher=true;nonFastForward=true;}
 }
 if(!solePublisher)fail('GITHUB_SOLE_PUBLISHER_NOT_ENFORCED','Protected ref lacks a complete sole-App update restriction with no worker/admin/team bypass');
 if(!nonFastForward)fail('GITHUB_ANCESTRY_NOT_ENFORCED','Protected ref lacks a non-bypassable non-fast-forward restriction');
 return hash(canonical({repository_id:repo.id,active_rules:applied,rulesets:sets,classic}));
}
export class GitHubPublicationAdapter {
 constructor(private readonly profile:GitHubProfile,private readonly env:Readonly<NodeJS.ProcessEnv>,private readonly request:GitHubTransport=githubHTTP){}
 private base():string{return '/repos/'+encodeURIComponent(this.profile.owner)+'/'+encodeURIComponent(this.profile.repository);}
 private async audit():Promise<string>{const value=(await privateBytes(this.profile.audit_token_file)).toString('utf8').trim();if(!value||/\s/.test(value))fail('GITHUB_CONFIG_INVALID','Audit credential is invalid');return value;}
 private async jwt():Promise<string>{
 const now=Math.floor(Date.now()/1000),header=Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url'),body=Buffer.from(JSON.stringify({iat:now-60,exp:now+540,iss:this.profile.app_id})).toString('base64url'),data=header+'.'+body;
 return data+'.'+sign('RSA-SHA256',Buffer.from(data),createPrivateKey(await privateBytes(this.profile.app_private_key_file))).toString('base64url');
 }
 async observeHead():Promise<string>{
 const response=await this.request(this.base()+'/git/ref/'+this.profile.target_ref.slice(5).split('/').map(encodeURIComponent).join('/'),await this.audit());
 if(response.status!==200)fail('GITHUB_REF_UNAVAILABLE','Cannot observe exact protected GitHub ref');return oid(obj(obj(response.body).object).sha);
 }
 private async denial(rulesDigest:string):Promise<string>{
 const bytes=await privateBytes(this.profile.denial_receipt_file,262144),envelope=obj(JSON.parse(bytes.toString('utf8')));keys(envelope,['receipt','signature']);const receipt=obj(envelope.receipt);
 if(typeof envelope.signature!=='string'||!verify(null,Buffer.from(canonical(receipt)),await privateBytes(this.profile.denial_signer_public_key_file),Buffer.from(envelope.signature,'base64url')))fail('GITHUB_WORKER_DENIAL_UNPROVEN','Worker-denial receipt signature invalid');
 const timestamp=typeof receipt.observed_at==='string'?Date.parse(receipt.observed_at):NaN,expiry=typeof receipt.expires_at==='string'?Date.parse(receipt.expires_at):NaN;
 if(receipt.provider!=='GITHUB'||receipt.repository_numeric_id!==this.profile.repository_numeric_id||receipt.target_ref!==this.profile.target_ref||receipt.rules_digest!==rulesDigest||receipt.worker_app_id===this.profile.app_id||(!Number.isSafeInteger(receipt.worker_app_id)||Number(receipt.worker_app_id)<1)||receipt.outcome!=='DENIED'||(!Number.isSafeInteger(receipt.exit_code)||Number(receipt.exit_code)===0)||typeof receipt.command_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(receipt.command_digest)||receipt.before_head!==receipt.after_head||!Number.isFinite(timestamp)||!Number.isFinite(expiry)||timestamp>Date.now()||expiry<=Date.now()||expiry-timestamp>3600000)fail('GITHUB_WORKER_DENIAL_UNPROVEN','Current exact-policy actual worker push-denial receipt required');
 oid(receipt.before_head);return hash(bytes);
 }
 async inspectProtection():Promise<GitHubProtection>{
 const audit=await this.audit(),jwt=await this.jwt();const app=await this.request('/app',jwt),installation=await this.request('/app/installations/'+this.profile.installation_id,jwt);
 if(app.status!==200||obj(app.body).id!==this.profile.app_id||installation.status!==200||obj(installation.body).app_id!==this.profile.app_id||obj(installation.body).suspended_at!==null)fail('GITHUB_PUBLISHER_IDENTITY_UNAVAILABLE','Configured active GitHub App installation could not be verified');
 const repo=await this.request(this.base(),audit),rules:unknown[]=[];
 for(let page=1;page<=10;page++){const result=await this.request(this.base()+'/rules/branches/'+encodeURIComponent(this.profile.target_ref.slice(11))+'?per_page=100&page='+page,audit);if(result.status!==200||!Array.isArray(result.body))fail('GITHUB_RULES_UNAVAILABLE','GitHub active branch rules unavailable');rules.push(...result.body);if(result.body.length<100)break;if(page===10)fail('GITHUB_RULES_UNAVAILABLE','Rule inventory exceeded explicit bound');}
 const ids=[...new Set(rules.map(r=>integer(obj(r).ruleset_id)))].sort((a,b)=>a-b),sets=[];
 for(const id of ids){const result=await this.request(this.base()+'/rulesets/'+id+'?includes_parents=true',audit);if(result.status!==200)fail('GITHUB_BYPASS_INVENTORY_UNAVAILABLE','Cannot inspect effective ruleset bypass actors');sets.push(result.body);}
 const classic=await this.request(this.base()+'/branches/'+encodeURIComponent(this.profile.target_ref.slice(11))+'/protection',audit);
 if(repo.status!==200||![200,404].includes(classic.status))fail('GITHUB_PROTECTION_UNAVAILABLE','GitHub protection state unavailable');
 const rulesDigest=validateGitHubProtection(this.profile,repo.body,rules,sets,classic.status===404?null:classic.body);
 if(rulesDigest!==this.profile.expected_rules_digest)fail('GITHUB_PROTECTION_CHANGED','Actual GitHub policy differs from operator-accepted protection digest');
 return {provider:'GITHUB',repository_identity:this.profile.owner+'/'+this.profile.repository,repository_numeric_id:this.profile.repository_numeric_id,protected_ref:this.profile.target_ref,observed_head:await this.observeHead(),rules_digest:rulesDigest,publisher_identity:'GitHubApp:'+this.profile.app_id+':installation:'+this.profile.installation_id,direct_push_denial_receipt_digest:await this.denial(rulesDigest),policy_observed_at:new Date().toISOString()};
 }
 private credentialPath(intent:GitHubIntent):string{return path.join(this.profile.credential_directory,intent.operation_id+'.json');}
 private async persistCredential(intent:GitHubIntent,token:Record<string,unknown>):Promise<void>{
 const directory=await fs.lstat(this.profile.credential_directory);if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o077)!==0)fail('GITHUB_CREDENTIAL_CUSTODY_UNAVAILABLE','Private durable gateway credential directory required');
 const filename=this.credentialPath(intent),fd=await fs.open(filename,'wx',0o600);try{await fd.writeFile(JSON.stringify({intent,token})+'\n');await fd.sync();}finally{await fd.close();}const dir=await fs.open(this.profile.credential_directory,'r');try{await dir.sync();}finally{await dir.close();}
 }
 async revokeCredential(intent:GitHubIntent):Promise<boolean>{
 let record:Record<string,unknown>;try{record=obj(JSON.parse((await privateBytes(this.credentialPath(intent))).toString('utf8')));}catch{return false;}
 if(canonical(record.intent)!==canonical(intent))fail('GITHUB_CREDENTIAL_BINDING_INVALID','Credential custody belongs to another immutable intent');
 const token=obj(record.token);if(token.revoked===true)return true;if(typeof token.token!=='string')return false;
 const result=await this.request('/installation/token',token.token,'DELETE');
 const confirmed=result.status===204||result.status===401;if(!confirmed)return false;
 // Keep a durable secret-free tombstone. Do not silently forget revocation.
 const filename=this.credentialPath(intent),temporary=filename+'.'+randomUUID();const fd=await fs.open(temporary,'wx',0o600);
 try{await fd.writeFile(JSON.stringify({intent,token:{revoked:true,expires_at:token.expires_at},revoked_at:new Date().toISOString()})+'\n');await fd.sync();}finally{await fd.close();}await fs.rename(temporary,filename);return true;
 }
 private async preflightCustody(intent:GitHubIntent):Promise<void>{
 const directory=await fs.lstat(this.profile.credential_directory);if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o077)!==0||await fs.realpath(this.profile.credential_directory)!==this.profile.credential_directory)fail('GITHUB_CREDENTIAL_CUSTODY_UNAVAILABLE','Canonical private gateway credential directory required');
 for(const filename of [this.credentialPath(intent),path.join(this.profile.credential_directory,intent.operation_id+'-askpass.cjs')]){
  try{await fs.lstat(filename);fail('GITHUB_CREDENTIAL_REPLAY_REQUIRES_RECONCILIATION','Prior credential custody must be reconciled before new token issuance');}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}
 }
 }
 async publish(intent:GitHubIntent,repositoryPath:string):Promise<HostedResult>{
 if(intent.target_ref!==this.profile.target_ref)fail('GITHUB_TARGET_INVALID','Intent ref differs from configured protected ref');const before=await this.inspectProtection();
 if(before.observed_head!==intent.expected_old_head)fail('GITHUB_EXPECTED_HEAD_CHANGED','Protected target head changed');
 await git(repositoryPath,['merge-base','--is-ancestor',intent.expected_old_head,intent.candidate_head]);await this.preflightCustody(intent);
 const minted=await this.request('/app/installations/'+this.profile.installation_id+'/access_tokens',await this.jwt(),'POST',{repository_ids:[this.profile.repository_numeric_id],permissions:{contents:'write',metadata:'read'}});
 const token=obj(minted.body);
 if(typeof token.token!=='string'||!token.token)fail('GITHUB_PUBLISHER_TOKEN_UNAVAILABLE','Scoped GitHub App installation token was not issued');
 const validToken=minted.status===201&&typeof token.expires_at==='string'&&Number.isFinite(Date.parse(token.expires_at))&&Date.parse(token.expires_at)>Date.now()&&token.permissions!==null&&typeof token.permissions==='object'&&!Array.isArray(token.permissions)&&(token.permissions as Record<string,unknown>).contents==='write';
 const secretToken=token.token,expiry=typeof token.expires_at==='string'?token.expires_at:null,askpass=path.join(this.profile.credential_directory,intent.operation_id+'-askpass.cjs');
 let persisted=false,pushIssued=false,revoked=false,stage='CREDENTIAL_PERSIST',failure='';
 try{
  await this.persistCredential(intent,token);persisted=true;if(!validToken){stage='TOKEN_VALIDATION';throw Error('Provider token response failed accepted scope/expiry policy');}stage='ASKPASS_CREATE';
  await fs.writeFile(askpass,"#!/usr/bin/env node\nprocess.stdout.write(process.argv[2]?.includes('Username')?'x-access-token':process.env.HYPERFIDE_GITHUB_INSTALLATION_TOKEN??'');\n",{mode:0o700,flag:'wx'});
  stage='PUSH';pushIssued=true;
  await isolatedPush(repositoryPath,['--porcelain','--force-with-lease='+intent.target_ref+':'+intent.expected_old_head,'https://github.com/'+this.profile.owner+'/'+this.profile.repository+'.git',intent.candidate_head+':'+intent.target_ref],{...this.env,GIT_ASKPASS:askpass,HYPERFIDE_GITHUB_INSTALLATION_TOKEN:secretToken},'https');
 }catch{failure=stage;}
 finally{
  // Revocation uses the just-minted value even when disk or askpass custody
  // failed. A missing spool must never prevent provider cleanup.
  try{const response=await this.request('/installation/token',secretToken,'DELETE');revoked=response.status===204||response.status===401;}catch{revoked=false;}
  if(persisted&&revoked){try{await this.revokeCredential(intent);}catch{failure=failure||'REVOCATION_TOMBSTONE';}}
  try{await fs.rm(askpass,{force:true});}catch{failure=failure||'ASKPASS_CLEANUP';}
 }
 let head=before.observed_head;try{head=await this.observeHead();}catch{failure=failure||'REMOTE_READBACK';}
 // A nonzero Git child and an unchanged ref cannot prove remote quiescence.
 // REJECTED is permitted only when no push was ever dispatched and its
 // privileged token was independently revoked.
 return {outcome:revoked&&pushIssued&&head===intent.candidate_head?'PUBLISHED':revoked&&!pushIssued?'REJECTED':'UNKNOWN',observed_head:head,credential_revocation:revoked?'CONFIRMED':'UNKNOWN',rules_digest:before.rules_digest,push_issued:pushIssued,credential_expires_at:expiry,credential_custody:persisted?'PERSISTED':'ORPHANED',failure_stage:failure||'NONE'};
 }
 async reconcile(intent:GitHubIntent):Promise<HostedResult>{
 const revoked=await this.revokeCredential(intent),protection=await this.inspectProtection(),head=await this.observeHead();
 return {outcome:revoked&&head===intent.candidate_head?'PUBLISHED':'UNKNOWN',observed_head:head,credential_revocation:revoked?'CONFIRMED':'UNKNOWN',rules_digest:protection.rules_digest};
 }
}
export async function githubAdapter(env:Readonly<NodeJS.ProcessEnv>,repositoryId:string):Promise<GitHubPublicationAdapter>{return new GitHubPublicationAdapter(await loadGitHubProfile(env,repositoryId),env);}
