import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {constants} from 'node:fs';
import type {Component,ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {assertInvocation,base64,decimal,exact,fail,frozen,hash,NAME,strictJSON,uuid} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {gatewayOf,identityTransaction,invocationOf,recorded} from './enrollment.js';
import type {IdentityTransaction} from './enrollment.js';
export type CredentialPurpose='WORKER_BUILD'|'WORKER_RUNTIME'|'WORKER_PROCESS'|'PROVIDER_API';
export interface CredentialResolutionRequest {references:readonly {name:string;reference_id:string}[];purpose:CredentialPurpose;sandbox_id:string;boot_id:string;boot_generation:string}
const purposes=['WORKER_BUILD','WORKER_RUNTIME','WORKER_PROCESS','PROVIDER_API'];
// Distinct variable layers: reusable image metadata never carries secrets; build/runtime/process receive references only.
export type EnvironmentLayer='image'|'build'|'runtime'|'process';
export type SecretLayer=Exclude<EnvironmentLayer,'image'>;
export type LayeredEnvironment={readonly [L in EnvironmentLayer]:Readonly<Record<string,string>>};
const LAYERS:readonly EnvironmentLayer[]=['image','build','runtime','process'],SECRET_LAYERS:readonly SecretLayer[]=['build','runtime','process'];
const LOADER_VARIABLES=['LD_PRELOAD','LD_LIBRARY_PATH','NODE_OPTIONS','BASH_ENV','ENV','PYTHONPATH','PYTHONSTARTUP','GIT_CONFIG_COUNT','GIT_SSH_COMMAND'];
export type CredentialStatus='AVAILABLE'|'MISSING'|'EXPIRED'|'REVOKED'|'AUTH_BLOCKED';
export interface CredentialAvailability {schema_version:1;reference_id:string;credential_version:string|null;status:CredentialStatus;expires_at:string|null;assignment_scope:{run_id:string;actor_id:string;attempt_id:string|null};attachment_id:string|null}
export interface CredentialAuthority {inspectInTransaction(tx:IdentityTransaction,i:InvocationContext,reference:string):Promise<CredentialAvailability>;resolveCredentialReferences(i:InvocationContext,request:CredentialResolutionRequest,signal?:AbortSignal):Promise<Readonly<Record<string,string>>>;inspect(i:InvocationContext,reference:string):Promise<CredentialAvailability>;attach(i:InvocationContext,reference:string,layer:string):Promise<CredentialAvailability>;privateAttachment(i:InvocationContext,id:string):Promise<{path:string;uid:number;expires_at:string}>}
interface Source {name:string;relative_path:string;expires_at:string;purposes:CredentialPurpose[]}
interface Target {actor_id:string;uid:number;layers:string[]}
interface Configuration {secret_root:string;attachment_root:string;sources:Source[];targets:Target[]}
export function isCredentialAuthority(v:unknown):v is CredentialAuthority{return object(v)&&typeof v.inspectInTransaction==='function'&&typeof v.resolveCredentialReferences==='function'&&typeof v.inspect==='function'&&typeof v.attach==='function'&&typeof v.privateAttachment==='function';}
function reference(v:unknown):v is string{return typeof v==='string'&&v.length>0&&v.length<=255&&/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v)&&!v.split('/').some(p=>p==='..'||p==='.'||p==='');}
function strings(v:unknown,allowed?:string[]):string[]{if(!Array.isArray(v)||!v.length||v.length>128||v.some(x=>typeof x!=='string'||!x.length||allowed&&!allowed.includes(x))||new Set(v).size!==v.length)fail('INVALID_REQUEST','Explicit unique bounded values required');return v as string[];}
export function composeEnvironment(layers:LayeredEnvironment|unknown):Readonly<Record<string,string>>{
 exact(layers,[...LAYERS]);const result=Object.create(null) as Record<string,string>;
 for(const layer of LAYERS){const input=layers[layer];if(!object(input)||Object.keys(input).length>256)fail('INVALID_REQUEST','Bounded environment maps required');
 for(const [key,value] of Object.entries(input)){if(!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)||typeof value!=='string'||Buffer.byteLength(value)>65536||value.includes('\0')||LOADER_VARIABLES.includes(key))fail('ENVIRONMENT_DENIED','Unsafe environment entry');result[key]=value;}}
 if(Buffer.byteLength(JSON.stringify(result))>262144)fail('INVALID_REQUEST','Environment exceeds byte budget');return Object.freeze(result);
}
// Retain enough raw suffix to redact secrets split across arbitrary byte/chunk boundaries.
export class StreamingRedactor {
 private pending='';private readonly secrets:string[];private readonly reserve:number;
 constructor(secrets:readonly string[]){if(secrets.length>128||secrets.some(s=>!s||s.length>65536))fail('REDACTION_CONFIG','Bounded nonempty secret values required');this.secrets=[...new Set(secrets)].sort((a,b)=>b.length-a.length);this.reserve=Math.max(0,...this.secrets.map(s=>s.length-1));}
 push(chunk:string,final=false):string{this.pending+=chunk;let out='';const boundary=final?this.pending.length:Math.max(0,this.pending.length-this.reserve);let index=0;while(index<boundary){const found=this.secrets.find(s=>this.pending.startsWith(s,index));if(found){out+='[REDACTED]';index+=found.length;}else out+=this.pending[index++];}this.pending=this.pending.slice(index);if(final){if(this.pending)throw new Error('Redaction finalization invariant');}return out;}
}
async function privateRoot(filename:string):Promise<string>{if(!path.isAbsolute(filename))fail('CREDENTIAL_CONFIG','Absolute private root required');const real=await fs.realpath(filename),s=await fs.lstat(filename);if(real!==path.resolve(filename)||!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o022)!==0)fail('CREDENTIAL_CONFIG','Trusted root must not be writable by other users');return real;}
async function privateRead(root:string,relative:string):Promise<Buffer>{
 if(!reference(relative))fail('CREDENTIAL_CONFIG','Unsafe private secret locator');let current=root;
 for(const part of relative.split('/')){current=path.join(current,part);const s=await fs.lstat(current);if(s.isSymbolicLink())fail('CREDENTIAL_CONFIG','Secret symlinks forbidden');}
 const fd=await fs.open(current,'r');try{const s=await fd.stat(),n=await fs.lstat(current);if(!s.isFile()||s.ino!==n.ino||s.dev!==n.dev||s.uid!==process.getuid?.()||(s.mode&0o077)!==0||s.size<1||s.size>1048576)fail('CREDENTIAL_CONFIG','Secret files require bounded private ownership');return await fd.readFile();}finally{await fd.close();}
}
async function configuration(ctx:ComponentContext):Promise<Configuration>{
 const file=ctx.env.HF_CREDENTIAL_CONFIG_FILE;if(!file)fail('CREDENTIAL_CONFIG','Trusted credential-store configuration required');
 const info=await fs.lstat(file);if(!path.isAbsolute(file)||!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||info.size>1048576)fail('CREDENTIAL_CONFIG','Bounded configuration file required');
 const v=strictJSON(await fs.readFile(file));exact(v,['schema_version','secret_root','attachment_root','sources','targets']);
 if(v.schema_version!==1||typeof v.secret_root!=='string'||typeof v.attachment_root!=='string'||!Array.isArray(v.sources)||!Array.isArray(v.targets)||v.sources.length>256||v.targets.length>256)fail('CREDENTIAL_CONFIG','Invalid store configuration');
 const sources:Source[]=[],targets:Target[]=[];
 for(const s of v.sources){exact(s,['name','relative_path','expires_at','purposes']);if(!reference(s.name)||!reference(s.relative_path)||typeof s.expires_at!=='string'||!Number.isFinite(Date.parse(s.expires_at))||sources.some(x=>x.name===s.name))fail('CREDENTIAL_CONFIG','Invalid source reference');strings(s.purposes,purposes);sources.push(s as unknown as Source);}
 for(const t of v.targets){exact(t,['actor_id','uid','layers']);if(!uuid(t.actor_id)||!Number.isInteger(t.uid)||Number(t.uid)<1000||Number(t.uid)>2147483647||targets.some(x=>x.actor_id===t.actor_id||x.uid===t.uid))fail('CREDENTIAL_CONFIG','Each credential-sensitive actor requires a distinct non-root UID');targets.push({actor_id:t.actor_id,uid:Number(t.uid),layers:strings(t.layers,[...SECRET_LAYERS])});}
 return {secret_root:await privateRoot(v.secret_root),attachment_root:await privateRoot(v.attachment_root),sources,targets};
}
function availability(reference_id:string,row:Record<string,any>|undefined,i:InvocationContext,attachment_id:string|null=null):CredentialAvailability{
 let status:CredentialStatus='MISSING';if(row)status=row.state==='REVOKED'?'REVOKED':row.state==='AUTH_BLOCKED'?'AUTH_BLOCKED':new Date(row.expires_at).getTime()<=new Date(row.db_now).getTime()?'EXPIRED':'AVAILABLE';
 return frozen({schema_version:1,reference_id,credential_version:row?String(row.credential_version):null,status,expires_at:row?new Date(row.expires_at).toISOString():null,assignment_scope:{run_id:i.principal.run_id,actor_id:i.principal.actor_id,attempt_id:i.principal.attempt_id},attachment_id});
}
// After a committed revoke/rotate, remove superseded private copies so a revoked UID loses file access, not only metadata status.
async function discardRevoked(config:Configuration,attachments:readonly unknown[],locators:readonly unknown[]):Promise<void>{
 for(const id of attachments)if(uuid(id))await fs.rm(path.join(config.attachment_root,id),{recursive:true,force:true});
 for(const locator of locators)if(uuid(locator)&&!config.sources.some(s=>s.relative_path===locator))await fs.rm(path.join(config.secret_root,locator),{force:true});
}
export async function createComponent(ctx:ComponentContext):Promise<Component>{
 const config=await configuration(ctx),gateway=gatewayOf(ctx);
 const transact=<T>(i:InvocationContext,fn:(tx:IdentityTransaction)=>Promise<T>)=>{assertInvocation(i);return gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:i.signal,guard:i.guard},async tx=>{const result=await fn(tx);await i.guard(tx);return result;});};
 const inspectInTransaction:CredentialAuthority['inspectInTransaction']=async(tx,i,ref)=>{assertInvocation(i);await i.guard(tx);if(!reference(ref))fail('INVALID_REQUEST','Credential reference required');const row=(await tx.query('SELECT * FROM hyperfide.identity_credential_references WHERE organisation_id=$1 AND run_id=$2 AND reference_id=$3 FOR SHARE',[i.principal.organisation_id,i.principal.run_id,ref])).rows[0];if(row&&!row.allowed_roles.includes(i.principal.role))fail('AUTH_SCOPE_DENIED','Credential role scope denied');const now=(await tx.query('SELECT clock_timestamp() AS db_now')).rows[0]!.db_now;return availability(ref,row?{...row,db_now:now}:undefined,i);};
 const inspect:CredentialAuthority['inspect']=async(i,ref)=>transact(i,tx=>inspectInTransaction(tx,i,ref));
 const privateAttachment:CredentialAuthority['privateAttachment']=async(i,id)=>{if(!uuid(id))fail('INVALID_REQUEST','Attachment ID required');return transact(i,async tx=>{const a=(await tx.query('SELECT a.*,r.credential_version AS current_version,r.state AS reference_state,r.expires_at AS reference_expires_at FROM hyperfide.identity_credential_attachments a JOIN hyperfide.identity_credential_references r USING(organisation_id,run_id,reference_id) WHERE a.id=$1 AND a.organisation_id=$2 AND a.run_id=$3 AND a.actor_id=$4 FOR SHARE OF a,r',[id,i.principal.organisation_id,i.principal.run_id,i.principal.actor_id])).rows[0];const now=new Date((await tx.query('SELECT clock_timestamp() AS db_now')).rows[0]!.db_now).getTime();if(!a||a.attempt_id!==i.principal.attempt_id||a.state!=='AVAILABLE'||a.reference_state!=='AVAILABLE'||String(a.current_version)!==String(a.credential_version)||new Date(a.expires_at).getTime()<=now||new Date(a.reference_expires_at).getTime()<=now)fail('AUTH_REVOKED','Credential attachment not current');return {path:path.join(config.attachment_root,a.locator,'value'),uid:a.target_uid,expires_at:new Date(a.expires_at).toISOString()};});};
 const attach:CredentialAuthority['attach']=async(i,ref,layer)=>{
  if(!reference(ref)||!(SECRET_LAYERS as readonly string[]).includes(layer))fail('INVALID_REQUEST','Secret attachment requires runtime layer');
  const target=config.targets.find(t=>t.actor_id===i.principal.actor_id&&t.layers.includes(layer));if(!target)fail('ISOLATION_REQUIRED','Qualified actor UID/layer isolation profile required');
  const prepared=await transact(i,async tx=>{const r=(await tx.query('SELECT *,clock_timestamp() AS db_now FROM hyperfide.identity_credential_references WHERE organisation_id=$1 AND run_id=$2 AND reference_id=$3 FOR SHARE',[i.principal.organisation_id,i.principal.run_id,ref])).rows[0];if(availability(ref,r,i).status!=='AVAILABLE'||!r?.allowed_roles.includes(i.principal.role)||!r.allowed_layers.includes(layer))fail('AUTH_SCOPE_DENIED','Credential is unavailable for actor/layer');return r;});
  const bytes=await privateRead(config.secret_root,prepared.secret_locator),id=randomUUID(),directory=path.join(config.attachment_root,id);
  await fs.mkdir(directory,{mode:0o700});try{await fs.chown(directory,target.uid,target.uid);const file=await fs.open(path.join(directory,'value'),'wx',0o600);try{await file.writeFile(bytes);await file.sync();await file.chown(target.uid,target.uid);}finally{await file.close();}return await transact(i,async tx=>{const r=(await tx.query('SELECT *,clock_timestamp() AS db_now FROM hyperfide.identity_credential_references WHERE organisation_id=$1 AND run_id=$2 AND reference_id=$3 FOR SHARE',[i.principal.organisation_id,i.principal.run_id,ref])).rows[0];if(!r||String(r.credential_version)!==String(prepared.credential_version)||availability(ref,r,i).status!=='AVAILABLE')fail('VERSION_CONFLICT','Credential rotated during attachment');await tx.query("INSERT INTO hyperfide.identity_credential_attachments(id,organisation_id,run_id,reference_id,credential_version,actor_id,attempt_id,target_uid,layer,locator,expires_at,state) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$1::text,$10,'AVAILABLE')",[id,i.principal.organisation_id,i.principal.run_id,ref,r.credential_version,i.principal.actor_id,i.principal.attempt_id,target.uid,layer,r.expires_at]);return availability(ref,r,i,id);});}catch(error){if(!(error&&typeof error==='object'&&'code' in error&&String(error.code)==='COMMIT_AMBIGUOUS'))await fs.rm(directory,{recursive:true,force:true});throw error;}finally{bytes.fill(0);}
 };
 const resolveCredentialReferences:CredentialAuthority['resolveCredentialReferences']=async(i,request,signal)=>{
 assertInvocation(i);exact(request,['references','purpose','sandbox_id','boot_id','boot_generation']);
 if(!purposes.includes(request.purpose)||!uuid(request.sandbox_id)||!uuid(request.boot_id)||!decimal(request.boot_generation,true)||!Array.isArray(request.references)||request.references.length>128)fail('INVALID_REQUEST','Bounded scoped secret references required');
 const names=new Set<string>();for(const r of request.references){exact(r,['name','reference_id']);if(typeof r.name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(r.name)||LOADER_VARIABLES.includes(r.name)||!reference(r.reference_id)||names.has(r.name))fail('AUTH_SCOPE_DENIED','Invalid private environment reference');names.add(r.name);}
 if(request.purpose==='PROVIDER_API'&&i.principal.role!=='PROVISIONER')fail('AUTH_SCOPE_DENIED','Provider credentials remain provisioner-only');
 if(i.principal.sandbox_id!==null&&(i.principal.sandbox_id!==request.sandbox_id||i.principal.boot_id!==request.boot_id||i.principal.boot_generation!==request.boot_generation))fail('AUTH_SCOPE_DENIED','Worker secret scope differs from authenticated boot');
 const check=async(tx:IdentityTransaction)=>{
  await i.guard(tx);if(signal?.aborted)fail('OUTCOME_UNKNOWN','Credential resolution cancelled');
  const b=(await tx.query('SELECT s.boot_generation,s.observed_state,b.boot_id,p.run_id FROM hyperfide.sandboxes s JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation JOIN hyperfide.identity_provider_bindings p ON p.organisation_id=s.organisation_id AND p.sandbox_id=s.id AND p.boot_generation=s.boot_generation WHERE s.organisation_id=$1 AND s.id=$2 AND p.run_id=$3 FOR SHARE OF s,b,p',[i.principal.organisation_id,request.sandbox_id,i.principal.run_id])).rows;
  if(b.length!==1||b[0]!.boot_id!==request.boot_id||String(b[0]!.boot_generation)!==request.boot_generation||b[0]!.observed_state!=='RUNNING')fail('AUTH_STALE_BOOT','Secret injection requires one current trusted provider/run/boot binding');
  const rows:Record<string,any>[]=[];for(const r of request.references){const row=(await tx.query('SELECT * FROM hyperfide.identity_credential_references WHERE organisation_id=$1 AND run_id=$2 AND reference_id=$3 FOR SHARE',[i.principal.organisation_id,i.principal.run_id,r.reference_id])).rows[0];if(!row||row.state!=='AVAILABLE'||!row.allowed_roles.includes(i.principal.role)||!row.purposes.includes(request.purpose))fail('AUTH_SCOPE_DENIED','Secret reference is unavailable for this scoped purpose');rows.push(row);}
  const now=new Date((await tx.query('SELECT clock_timestamp() AS db_now')).rows[0]!.db_now).getTime();if(rows.some(r=>new Date(r.expires_at).getTime()<=now))fail('AUTH_EXPIRED','Secret reference has expired');return rows;
 };
 const rows=await transact(i,check),values=Object.create(null) as Record<string,string>;
 try{for(let n=0;n<rows.length;n++){const bytes=await privateRead(config.secret_root,rows[n]!.secret_locator);try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!text||text.includes('\0')||Buffer.byteLength(text)>65536)fail('CREDENTIAL_CONFIG','Private environment value is not bounded UTF8');values[request.references[n]!.name]=text;}finally{bytes.fill(0);}}
 await transact(i,async tx=>{const current=await check(tx);if(current.some((r,n)=>String(r.credential_version)!==String(rows[n]!.credential_version)))fail('VERSION_CONFLICT','Secret changed during private resolution');});return Object.freeze(values);
 }catch(error){for(const k of Object.keys(values))delete values[k];throw error;}
 };
 const authority:CredentialAuthority=Object.freeze({inspect,inspectInTransaction,attach,privateAttachment,resolveCredentialReferences});
 const act=(fn:(v:Record<string,unknown>,i:InvocationContext)=>Promise<unknown>)=>async(v:unknown,context:ComponentContext)=>{if(!object(v))fail('INVALID_REQUEST','Object input required');return fn(v,invocationOf(context));};
 return {apiVersion:1,capabilities:{'identity.credentials':authority},actions:{
 'credentials.inspect':act(async(v,i)=>{exact(v,['reference_id']);if(typeof v.reference_id!=='string')fail('INVALID_REQUEST','Reference required');return inspect(i,v.reference_id);}),
 'credentials.attach':act(async(v,i)=>{exact(v,['reference_id','layer']);if(typeof v.reference_id!=='string'||typeof v.layer!=='string')fail('INVALID_REQUEST','Reference/layer required');return attach(i,v.reference_id,v.layer);}),
 'credentials.environment.plan':act(async(v,i)=>{exact(v,['layers','secret_bindings']);const env=composeEnvironment(v.layers);
  await transact(i,async()=>{});
  // Inline image/build/runtime text is untrusted. Known configured canaries and secret bytes must remain reference-only.
  const texts=Object.values(v.layers as Record<string,Record<string,string>>).flatMap(layer=>Object.values(layer));for(const source of config.sources){const bytes=await privateRead(config.secret_root,source.relative_path);try{const secret=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(secret&&texts.some(text=>text.includes(secret)))fail('ENVIRONMENT_DENIED','Inline environment contains a protected secret; use an approved reference');}finally{bytes.fill(0);}}
  await transact(i,async()=>{});if(!Array.isArray(v.secret_bindings)||v.secret_bindings.length>128)fail('INVALID_REQUEST','Bounded secret bindings required');for(const b of v.secret_bindings){exact(b,['name','reference_id','layer']);if(typeof b.name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(b.name)||!reference(b.reference_id)||!(SECRET_LAYERS as readonly string[]).includes(String(b.layer)))fail('AUTH_SCOPE_DENIED','Secrets cannot enter reusable image layer');}return {schema_version:1,environment_keys:Object.keys(env).sort(),secret_bindings:v.secret_bindings,contains_secret_values:false};}),
 'credentials.reference.rotate':act(async(v,i)=>{
  exact(v,['reference_id','source_name','expected_version','expires_at','allowed_layers','allowed_roles','refresh_owner','purposes']);
  if(!['OPERATOR','COORDINATOR'].includes(i.principal.role)||!reference(v.reference_id)||typeof v.source_name!=='string'||!decimal(v.expected_version)||typeof v.expires_at!=='string'||!Number.isFinite(Date.parse(v.expires_at))||!uuid(v.refresh_owner))fail('AUTH_SCOPE_DENIED','Scoped credential administration required');
  const source=config.sources.find(s=>s.name===v.source_name);if(!source||Date.parse(v.expires_at)>Date.parse(source.expires_at)||Date.parse(v.expires_at)<=Date.now())fail('CREDENTIAL_CONFIG','Secret source/expiry not authorized');
  const purposeList=strings(v.purposes,purposes),layers=strings(v.allowed_layers,[...SECRET_LAYERS]),roles=strings(v.allowed_roles);if(purposeList.some(x=>!source.purposes.includes(x as CredentialPurpose))||purposeList.includes('PROVIDER_API')&&(purposeList.length!==1||(v.allowed_roles as unknown[]).some(x=>x!=='PROVISIONER')))fail('AUTH_SCOPE_DENIED','Purpose exceeds trusted source ceiling');const bytes=await privateRead(config.secret_root,source.relative_path),locator=randomUUID(),file=await fs.open(path.join(config.secret_root,locator),'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();bytes.fill(0);}
  let revokedAttachments:unknown[]=[],supersededLocators:unknown[]=[],applied=false,result:unknown;
  try{result=await transact(i,async tx=>recorded(tx,i.principal.credential_id,'credentials.reference.rotate',i.operation,async()=>{
   revokedAttachments=[];supersededLocators=[];applied=false;const prior=(await tx.query('SELECT * FROM hyperfide.identity_credential_references WHERE organisation_id=$1 AND run_id=$2 AND reference_id=$3 FOR UPDATE',[i.principal.organisation_id,i.principal.run_id,v.reference_id])).rows[0];
   if(prior?String(prior.credential_version)!==v.expected_version||prior.refresh_owner!==v.refresh_owner:v.expected_version!=='0')fail('VERSION_CONFLICT','Credential lineage/refresh owner is not current');
   const version=(BigInt(v.expected_version as string)+1n).toString();
   await tx.query("INSERT INTO hyperfide.identity_credential_references(organisation_id,run_id,reference_id,credential_version,secret_locator,refresh_owner,allowed_layers,allowed_roles,purposes,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$10,'AVAILABLE',$9) ON CONFLICT(organisation_id,run_id,reference_id) DO UPDATE SET credential_version=EXCLUDED.credential_version,secret_locator=EXCLUDED.secret_locator,refresh_owner=EXCLUDED.refresh_owner,allowed_layers=EXCLUDED.allowed_layers,allowed_roles=EXCLUDED.allowed_roles,purposes=EXCLUDED.purposes,state='AVAILABLE',expires_at=EXCLUDED.expires_at,updated_at=clock_timestamp()",[i.principal.organisation_id,i.principal.run_id,v.reference_id,version,locator,v.refresh_owner,layers,roles,v.expires_at,purposeList]);
   revokedAttachments=(await tx.query("UPDATE hyperfide.identity_credential_attachments SET state='REVOKED' WHERE organisation_id=$1 AND run_id=$2 AND reference_id=$3 RETURNING locator",[i.principal.organisation_id,i.principal.run_id,v.reference_id])).rows.map(r=>r.locator);
   if(prior&&prior.secret_locator!==locator)supersededLocators=[prior.secret_locator];applied=true;return {rotated:true,reference_id:v.reference_id,credential_version:version};
  }));}catch(error){if(!(error&&typeof error==='object'&&'code' in error&&String(error.code)==='COMMIT_AMBIGUOUS'))await fs.rm(path.join(config.secret_root,locator),{force:true});throw error;}
  // An idempotent replay never referenced this call's private copy; only a committed rotation supersedes prior copies.
  await discardRevoked(config,revokedAttachments,applied?supersededLocators:[locator]);return result;
 }),
 'credentials.reference.revoke':act(async(v,i)=>{exact(v,['reference_id','expected_version']);if(!['OPERATOR','COORDINATOR'].includes(i.principal.role)||!reference(v.reference_id)||!decimal(v.expected_version,true))fail('AUTH_SCOPE_DENIED','Credential administration required');let revokedAttachments:unknown[]=[],revokedLocators:unknown[]=[];const result=await transact(i,async tx=>recorded(tx,i.principal.credential_id,'credentials.reference.revoke',i.operation,async()=>{revokedAttachments=[];revokedLocators=[];const r=await tx.query("UPDATE hyperfide.identity_credential_references SET state='REVOKED',credential_version=credential_version+1,updated_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND reference_id=$3 AND credential_version=$4 RETURNING credential_version,secret_locator",[i.principal.organisation_id,i.principal.run_id,v.reference_id,v.expected_version]);if(r.rowCount!==1)fail('VERSION_CONFLICT','Credential version mismatch');revokedLocators=[r.rows[0]!.secret_locator];revokedAttachments=(await tx.query("UPDATE hyperfide.identity_credential_attachments SET state='REVOKED' WHERE organisation_id=$1 AND run_id=$2 AND reference_id=$3 RETURNING locator",[i.principal.organisation_id,i.principal.run_id,v.reference_id])).rows.map(a=>a.locator);return {revoked:true,reference_id:v.reference_id,credential_version:String(r.rows[0]!.credential_version)};}));await discardRevoked(config,revokedAttachments,revokedLocators);return result;})
 }} as Component;
}

export interface IsolationPermitClaims {
 readonly schema_version:1;readonly purpose:'EXTERNAL_WRITER_ISOLATION_ONLY';
 readonly deployment_id:string;readonly operation_id:string;readonly organisation_id:string;readonly run_id:string;
 readonly source_epoch:string|null;readonly topology_digest:string;
 readonly resources:readonly {readonly reference_key:string;readonly topology_digest:string}[];
 readonly issued_at:string;readonly expires_at:string;readonly nonce:string;
}
export interface IsolationPermitExpectation {
 readonly deployment_id:string;readonly operation_id:string;readonly organisation_id:string;readonly run_id:string;
 readonly source_epoch:string|null;readonly topology_digest:string;
 readonly resource_reference?:string;readonly resource_topology_digest?:string;
}
export interface VerifiedIsolationPermit extends IsolationPermitClaims {readonly permit_digest:string;readonly issuer_key_id:string}
export interface IsolationPermitVerifier {verifySigned(serialized:Buffer|string):VerifiedIsolationPermit;verify(serialized:Buffer|string,expected:IsolationPermitExpectation):VerifiedIsolationPermit}
const verifiedIsolationPermits=new WeakSet<object>();
function canonicalPermitJSON(value:unknown):string {
 const sorted=(v:unknown):unknown=>Array.isArray(v)?v.map(sorted):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
 return JSON.stringify(sorted(value));
}
function digestText(v:unknown):v is string{return typeof v==='string'&&/^sha256:[0-9a-f]{64}$/.test(v);}
function referenceKey(v:unknown):v is string{return typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(v);}
function validateIsolationClaims(v:unknown,nowMs:number):asserts v is IsolationPermitClaims {
 exact(v,['schema_version','purpose','deployment_id','operation_id','organisation_id','run_id','source_epoch','topology_digest','resources','issued_at','expires_at','nonce']);
 if(v.schema_version!==1||v.purpose!=='EXTERNAL_WRITER_ISOLATION_ONLY'||!uuid(v.deployment_id)||!uuid(v.operation_id)||!uuid(v.organisation_id)||!uuid(v.run_id)||v.source_epoch!==null&&!uuid(v.source_epoch)||!digestText(v.topology_digest)||!uuid(v.nonce)||!Array.isArray(v.resources)||v.resources.length<1||v.resources.length>256)fail('ISOLATION_PERMIT_INVALID','Isolation-only permit bindings are invalid');
 if(typeof v.issued_at!=='string'||typeof v.expires_at!=='string'||!Number.isFinite(Date.parse(v.issued_at))||!Number.isFinite(Date.parse(v.expires_at))||new Date(v.issued_at).toISOString()!==v.issued_at||new Date(v.expires_at).toISOString()!==v.expires_at)fail('ISOLATION_PERMIT_INVALID','Canonical UTC permit times required');
 const issued=Date.parse(v.issued_at),expires=Date.parse(v.expires_at);
 if(!Number.isFinite(nowMs)||issued>nowMs+30000||expires<=nowMs||expires<=issued||expires-issued>3600000)fail('ISOLATION_PERMIT_EXPIRED','Isolation permit time window is not current');
 let previous='';for(const r of v.resources){exact(r,['reference_key','topology_digest']);if(!referenceKey(r.reference_key)||!digestText(r.topology_digest)||r.reference_key<=previous)fail('ISOLATION_PERMIT_INVALID','Exact sorted unique resource allowlist required');previous=r.reference_key;}
}
export function isVerifiedIsolationPermit(value:unknown):value is VerifiedIsolationPermit{return object(value)&&verifiedIsolationPermits.has(value);}
export function assertVerifiedIsolationPermit(value:unknown):asserts value is VerifiedIsolationPermit {
 if(!isVerifiedIsolationPermit(value))fail('ISOLATION_PERMIT_REQUIRED','A genuinely verified isolation-only permit is required');
 const {permit_digest:_digest,issuer_key_id:_issuer,...claims}=value;validateIsolationClaims(claims,Date.now());
}
export function assertIsolationPermit(value:unknown,expected:IsolationPermitExpectation):asserts value is VerifiedIsolationPermit {
 assertVerifiedIsolationPermit(value);
 exact(expected,['deployment_id','operation_id','organisation_id','run_id','source_epoch','topology_digest',...(Object.hasOwn(expected,'resource_reference')?['resource_reference']:[]),...(Object.hasOwn(expected,'resource_topology_digest')?['resource_topology_digest']:[])]);
 for(const key of ['deployment_id','operation_id','organisation_id','run_id','source_epoch','topology_digest'] as const)if(value[key]!==expected[key])fail('ISOLATION_PERMIT_SCOPE','Isolation permit binding differs from the durable operation');
 if((expected.resource_reference===undefined)!==(expected.resource_topology_digest===undefined))fail('ISOLATION_PERMIT_SCOPE','Complete resource identity is required');
 if(expected.resource_reference!==undefined&&!value.resources.some(r=>r.reference_key===expected.resource_reference&&r.topology_digest===expected.resource_topology_digest))fail('ISOLATION_PERMIT_SCOPE','Resource is outside the exact isolation allowlist');
}
function isolationSigningBytes(keyId:string,payload:Buffer):Buffer{return Buffer.from('HYPERFIDE-ISOLATION-PERMIT-V1\n'+keyId+'\n'+hash(payload)+'\n','utf8');}
export async function issueIsolationPermit(claims:IsolationPermitClaims,issuer:{key_id:string;private_key_file:string}):Promise<string>{
 validateIsolationClaims(claims,Date.now());exact(issuer,['key_id','private_key_file']);if(typeof issuer.key_id!=='string'||!NAME.test(issuer.key_id)||typeof issuer.private_key_file!=='string'||!path.isAbsolute(issuer.private_key_file))fail('ISOLATION_PERMIT_CONFIG','Explicit trusted operator signing key required');
 const file=await fs.open(issuer.private_key_file,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
 try{const stat=await file.stat();if(!stat.isFile()||stat.size<1||stat.size>4096||(stat.mode&0o077)!==0)fail('ISOLATION_PERMIT_CONFIG','Operator signing key requires a bounded private regular file');bytes=await file.readFile();}finally{await file.close();}
 let key;try{key=createPrivateKey(bytes!);}finally{bytes!.fill(0);}if(key.asymmetricKeyType!=='ed25519')fail('ISOLATION_PERMIT_CONFIG','Isolation permit signer must use Ed25519');
 const payload=Buffer.from(canonicalPermitJSON(claims)),signature=sign(null,isolationSigningBytes(issuer.key_id,payload),key);
 return canonicalPermitJSON({schema_version:1,key_id:issuer.key_id,payload_b64:payload.toString('base64url'),signature_b64:signature.toString('base64url')});
}
export async function loadIsolationPermitVerifier(configFile:string):Promise<IsolationPermitVerifier>{
 if(!path.isAbsolute(configFile))fail('ISOLATION_PERMIT_CONFIG','Trusted verifier configuration must be absolute');
 const file=await fs.open(configFile,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
 try{const stat=await file.stat();if(!stat.isFile()||stat.size<1||stat.size>65536||(stat.mode&0o022)!==0)fail('ISOLATION_PERMIT_CONFIG','Bounded operator-owned verifier configuration required');bytes=await file.readFile();}finally{await file.close();}
 const config=strictJSON(bytes!);exact(config,['schema_version','issuers']);if(config.schema_version!==1||!Array.isArray(config.issuers)||!config.issuers.length||config.issuers.length>16)fail('ISOLATION_PERMIT_CONFIG','Explicit bounded trusted operator public keys required');
 const keys=new Map<string,ReturnType<typeof createPublicKey>>();
 for(const issuer of config.issuers){exact(issuer,['key_id','public_key_b64']);if(typeof issuer.key_id!=='string'||!NAME.test(issuer.key_id)||keys.has(issuer.key_id))fail('ISOLATION_PERMIT_CONFIG','Unique trusted isolation issuer required');const publicBytes=base64(issuer.public_key_b64,32);keys.set(issuer.key_id,createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicBytes]),format:'der',type:'spki'}));}
 const verifySigned=(serialized:Buffer|string):VerifiedIsolationPermit=>{
  const envelopeBytes=Buffer.isBuffer(serialized)?Buffer.from(serialized):Buffer.from(serialized,'utf8');if(envelopeBytes.length>131072)fail('ISOLATION_PERMIT_INVALID','Bounded isolation permit envelope required');
  const envelope=strictJSON(envelopeBytes);exact(envelope,['schema_version','key_id','payload_b64','signature_b64']);if(envelope.schema_version!==1||typeof envelope.key_id!=='string'||typeof envelope.payload_b64!=='string'||!keys.has(envelope.key_id))fail('ISOLATION_PERMIT_INVALID','Unknown isolation permit issuer');
  const payload=base64(envelope.payload_b64),signature=base64(envelope.signature_b64,64),claims=strictJSON(payload);validateIsolationClaims(claims,Date.now());
  if(canonicalPermitJSON(claims)!==payload.toString('utf8')||canonicalPermitJSON(envelope)!==envelopeBytes.toString('utf8')||!verify(null,isolationSigningBytes(envelope.key_id,payload),keys.get(envelope.key_id)!,signature))fail('ISOLATION_PERMIT_INVALID','Isolation permit bytes or signature are invalid');
  const result=frozen({...claims,permit_digest:hash(envelopeBytes),issuer_key_id:envelope.key_id}) as VerifiedIsolationPermit;verifiedIsolationPermits.add(result);return result;
 };return Object.freeze({verifySigned,verify:(serialized:Buffer|string,expected:IsolationPermitExpectation)=>{const result=verifySigned(serialized);assertIsolationPermit(result,expected);return result;}});
}


export type WriterObservationPermitClaims=Omit<IsolationPermitClaims,'purpose'>&{readonly purpose:'EXTERNAL_WRITER_OBSERVATION_ONLY'};
export interface VerifiedWriterObservationPermit extends WriterObservationPermitClaims {readonly permit_digest:string;readonly issuer_key_id:string}
export interface WriterObservationPermitVerifier {
 verifySigned(serialized:Buffer|string):VerifiedWriterObservationPermit;
 verify(serialized:Buffer|string,expected:IsolationPermitExpectation):VerifiedWriterObservationPermit;
}
const verifiedWriterObservationPermits=new WeakSet<object>();
function validateWriterObservationClaims(value:unknown,nowMs:number):asserts value is WriterObservationPermitClaims {
 if(!object(value)||value.purpose!=='EXTERNAL_WRITER_OBSERVATION_ONLY')fail('OBSERVATION_PERMIT_INVALID','A distinct observation-only permit is required');
 // Share only inert binding validation. This never registers an isolation brand or authorises an effect.
 validateIsolationClaims({...value,purpose:'EXTERNAL_WRITER_ISOLATION_ONLY'},nowMs);
}
export function isVerifiedWriterObservationPermit(value:unknown):value is VerifiedWriterObservationPermit{return object(value)&&verifiedWriterObservationPermits.has(value);}
export function assertVerifiedWriterObservationPermit(value:unknown):asserts value is VerifiedWriterObservationPermit {
 if(!isVerifiedWriterObservationPermit(value))fail('OBSERVATION_PERMIT_REQUIRED','A genuinely verified observation-only permit is required');
 const {permit_digest:_digest,issuer_key_id:_issuer,...claims}=value;validateWriterObservationClaims(claims,Date.now());
}
export function assertWriterObservationPermit(value:unknown,expected:IsolationPermitExpectation):asserts value is VerifiedWriterObservationPermit {
 assertVerifiedWriterObservationPermit(value);
 exact(expected,['deployment_id','operation_id','organisation_id','run_id','source_epoch','topology_digest',...(Object.hasOwn(expected,'resource_reference')?['resource_reference']:[]),...(Object.hasOwn(expected,'resource_topology_digest')?['resource_topology_digest']:[])]);
 for(const key of ['deployment_id','operation_id','organisation_id','run_id','source_epoch','topology_digest'] as const)if(value[key]!==expected[key])fail('OBSERVATION_PERMIT_SCOPE','Observation permit differs from the existing durable operation');
 if((expected.resource_reference===undefined)!==(expected.resource_topology_digest===undefined))fail('OBSERVATION_PERMIT_SCOPE','Complete resource identity is required');
 if(expected.resource_reference!==undefined&&!value.resources.some(r=>r.reference_key===expected.resource_reference&&r.topology_digest===expected.resource_topology_digest))fail('OBSERVATION_PERMIT_SCOPE','Resource is outside the observation allowlist');
}
function writerObservationSigningBytes(keyId:string,payload:Buffer):Buffer{return Buffer.from('HYPERFIDE-WRITER-OBSERVATION-PERMIT-V1\n'+keyId+'\n'+hash(payload)+'\n','utf8');}
export async function issueWriterObservationPermit(claims:WriterObservationPermitClaims,issuer:{key_id:string;private_key_file:string}):Promise<string>{
 validateWriterObservationClaims(claims,Date.now());exact(issuer,['key_id','private_key_file']);if(typeof issuer.key_id!=='string'||!NAME.test(issuer.key_id)||typeof issuer.private_key_file!=='string'||!path.isAbsolute(issuer.private_key_file))fail('OBSERVATION_PERMIT_CONFIG','Explicit trusted operator signing key required');
 const file=await fs.open(issuer.private_key_file,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
 try{const stat=await file.stat();if(!stat.isFile()||stat.uid!==process.getuid?.()||stat.size<1||stat.size>4096||(stat.mode&0o077)!==0)fail('OBSERVATION_PERMIT_CONFIG','Bounded private operator signing key required');bytes=await file.readFile();}finally{await file.close();}
 let key;try{key=createPrivateKey(bytes!);}finally{bytes!.fill(0);}if(key.asymmetricKeyType!=='ed25519')fail('OBSERVATION_PERMIT_CONFIG','Observation signer must use Ed25519');
 const payload=Buffer.from(canonicalPermitJSON(claims)),signature=sign(null,writerObservationSigningBytes(issuer.key_id,payload),key);
 return canonicalPermitJSON({schema_version:1,key_id:issuer.key_id,payload_b64:payload.toString('base64url'),signature_b64:signature.toString('base64url')});
}
export async function loadWriterObservationPermitVerifier(configFile:string):Promise<WriterObservationPermitVerifier>{
 if(!path.isAbsolute(configFile))fail('OBSERVATION_PERMIT_CONFIG','Trusted verifier configuration must be absolute');
 const file=await fs.open(configFile,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
 try{const stat=await file.stat();if(!stat.isFile()||stat.uid!==process.getuid?.()||stat.size<1||stat.size>65536||(stat.mode&0o022)!==0)fail('OBSERVATION_PERMIT_CONFIG','Bounded operator-owned verifier configuration required');bytes=await file.readFile();}finally{await file.close();}
 const config=strictJSON(bytes!);exact(config,['schema_version','issuers']);if(config.schema_version!==1||!Array.isArray(config.issuers)||!config.issuers.length||config.issuers.length>16)fail('OBSERVATION_PERMIT_CONFIG','Explicit bounded trusted operator public keys required');
 const keys=new Map<string,ReturnType<typeof createPublicKey>>();for(const issuer of config.issuers){exact(issuer,['key_id','public_key_b64']);if(typeof issuer.key_id!=='string'||!NAME.test(issuer.key_id)||keys.has(issuer.key_id))fail('OBSERVATION_PERMIT_CONFIG','Unique trusted observation issuer required');const publicBytes=base64(issuer.public_key_b64,32);keys.set(issuer.key_id,createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicBytes]),format:'der',type:'spki'}));}
 const verifySigned=(serialized:Buffer|string):VerifiedWriterObservationPermit=>{
  const envelopeBytes=Buffer.isBuffer(serialized)?Buffer.from(serialized):Buffer.from(serialized,'utf8');if(envelopeBytes.length>131072)fail('OBSERVATION_PERMIT_INVALID','Bounded observation permit envelope required');
  const envelope=strictJSON(envelopeBytes);exact(envelope,['schema_version','key_id','payload_b64','signature_b64']);if(envelope.schema_version!==1||typeof envelope.key_id!=='string'||typeof envelope.payload_b64!=='string'||!keys.has(envelope.key_id))fail('OBSERVATION_PERMIT_INVALID','Unknown observation permit issuer');
  const payload=base64(envelope.payload_b64),signature=base64(envelope.signature_b64,64),claims=strictJSON(payload);validateWriterObservationClaims(claims,Date.now());
  if(canonicalPermitJSON(claims)!==payload.toString('utf8')||canonicalPermitJSON(envelope)!==envelopeBytes.toString('utf8')||!verify(null,writerObservationSigningBytes(envelope.key_id,payload),keys.get(envelope.key_id)!,signature))fail('OBSERVATION_PERMIT_INVALID','Observation permit bytes or signature are invalid');
  const result=frozen({...claims,permit_digest:hash(envelopeBytes),issuer_key_id:envelope.key_id}) as VerifiedWriterObservationPermit;verifiedWriterObservationPermits.add(result);return result;
 };return Object.freeze({verifySigned,verify:(serialized:Buffer|string,expected:IsolationPermitExpectation)=>{const result=verifySigned(serialized);assertWriterObservationPermit(result,expected);return result;}});
}
