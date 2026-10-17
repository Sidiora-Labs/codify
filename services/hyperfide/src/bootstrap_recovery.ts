import fs from 'node:fs/promises';
import type {ServiceResources} from './storage/runtime.js';
import {assertCurrentAuthority} from './storage/durability.js';
import {assertCurrentPrincipal} from './identity/enrollment.js';
import {assertAcceptedBootstrap} from './spec/bootstrap.js';
import {assertBootstrapExternalAuthority,assertFreshAttestation} from './bootstrap_identity.js';
import type {BootstrapPolicy} from './bootstrap_identity.js';
import {base64,exact,fail,frozen,hash,NAME,uuid} from './transport/protocol.js';
import type {Principal} from './transport/protocol.js';

/* Trusted local operator entry only (`hyperfide bootstrap --recover --input FILE`).
 * Replaces the current bootstrap operator of a run when its key is lost, compromised
 * or expired. The replaced credential is revoked in the same transaction and can
 * never be reactivated; the chain is append-only and rooted at the immutable
 * initial issuance (0026). No listener or registry action exposes this issuer. */
export const RECOVERY_REASONS=Object.freeze(['LOST','COMPROMISED','EXPIRED'] as const);
export interface RecoveryReceipt {
 recovery_id:string;generation:string;previous_credential_id:string;previous_state:string;
 credential_id:string;organisation_id:string;run_id:string;actor_id:string;role:'OPERATOR';credential_version:string;
 deployment_epoch:string;expires_at:string;accepted_revision_digest:string;reason:string;replayed:boolean;
}
const MIGRATIONS=[[14,'0014-enrollment'],[26,'0026-bootstrap'],[41,'0041-bootstrap-recovery']] as const;
export async function recoverBootstrapOperator(resources:ServiceResources,value:unknown,policy:BootstrapPolicy,signal?:AbortSignal):Promise<RecoveryReceipt>{
 exact(value,['organisation_id','run_id','authority_epoch','recovery_id','previous_credential_id','reason','credential_id','actor_id','public_key_b64','allowed_actions','expires_at']);
 for(const key of ['organisation_id','run_id','authority_epoch','recovery_id','previous_credential_id','credential_id','actor_id'])
  if(!uuid(value[key]))fail('INVALID_REQUEST','Exact recovery scope and identities are required');
 if(value.previous_credential_id===value.credential_id)fail('INVALID_REQUEST','A recovery must issue a new credential');
 if(typeof value.reason!=='string'||!(RECOVERY_REASONS as readonly string[]).includes(value.reason))fail('INVALID_REQUEST','Recovery reason must be LOST, COMPROMISED or EXPIRED');
 base64(value.public_key_b64,32);
 if(typeof value.expires_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expires_at)||
    !Number.isFinite(Date.parse(value.expires_at))||new Date(value.expires_at).toISOString()!==value.expires_at)
  fail('INVALID_REQUEST','Canonical expiry is required');
 if(!Array.isArray(value.allowed_actions)||value.allowed_actions.length<1||value.allowed_actions.length>256||
    value.allowed_actions.some(x=>typeof x!=='string'||!NAME.test(x))||new Set(value.allowed_actions).size!==value.allowed_actions.length)
  fail('INVALID_REQUEST','Unique finite action capabilities are required');
 if(!uuid(policy.deployment_id)||!Number.isSafeInteger(policy.max_ttl_ms)||policy.max_ttl_ms<1||policy.max_ttl_ms>2147483647)
  fail('BOOTSTRAP_POLICY_REQUIRED','Explicit trusted deployment and bounded expiry policy are required');
 const actions=(value.allowed_actions as string[]).slice().sort();
 const scope={deployment_id:policy.deployment_id,organisation_id:String(value.organisation_id),run_id:String(value.run_id),authority_epoch:String(value.authority_epoch)};
 const request={...scope,recovery_id:value.recovery_id,previous_credential_id:value.previous_credential_id,reason:value.reason,
  credential_id:value.credential_id,actor_id:value.actor_id,public_key_b64:value.public_key_b64,allowed_actions:actions,expires_at:value.expires_at};
 const requestDigest=hash(JSON.stringify(request));
 const expected=await Promise.all(MIGRATIONS.map(([,name])=>fs.readFile(new URL('../migrations/'+name+'.sql',import.meta.url))));
 const {attestation}=await assertBootstrapExternalAuthority(resources,policy,signal);
 return resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,...(signal?{signal}:{})},async tx=>{
  for(const [index,[version,name]] of MIGRATIONS.entries()){
   const migration=(await tx.query<{name:string;checksum:string}>('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=$1',[version])).rows[0];
   if(!migration||migration.name!==name||migration.checksum!==hash(expected[index]!))
    fail('BOOTSTRAP_SCHEMA_REQUIRED','Apply the exact trusted identity, bootstrap and recovery migrations first');
  }
  await assertCurrentAuthority(tx,scope);
  await assertFreshAttestation(tx,policy.deployment_id,scope.authority_epoch,attestation);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['bootstrap-operator:'+scope.organisation_id+':'+scope.run_id]);
  const issuance=(await tx.query<{credential_id:string;accepted_revision_digest:string}>('SELECT credential_id,accepted_revision_digest FROM hyperfide.identity_bootstrap_issuances WHERE organisation_id=$1 AND run_id=$2 FOR SHARE',[scope.organisation_id,scope.run_id])).rows[0];
  if(!issuance)fail('BOOTSTRAP_RECOVERY_UNAVAILABLE','Only a run with a durable initial bootstrap issuance can recover its operator');
  const accepted=await assertAcceptedBootstrap(tx,{organisation_id:scope.organisation_id,run_id:scope.run_id,authority_epoch:scope.authority_epoch,accepted_revision_digest:issuance.accepted_revision_digest});
  if(actions.some(action=>!accepted.allowed_actions.includes(action)))fail('AUTH_SCOPE_DENIED','Recovered operator grant cannot exceed accepted intent capabilities');
  const prior=(await tx.query('SELECT * FROM hyperfide.identity_bootstrap_recoveries WHERE recovery_id=$1',[value.recovery_id])).rows[0];
  let generation:string,previousState:string;
  if(prior){
   if(prior.organisation_id!==scope.organisation_id||prior.run_id!==scope.run_id||prior.request_digest!==requestDigest)
    fail('BOOTSTRAP_RECOVERY_CONFLICT','A recovery identity cannot be reused for a different request');
   generation=String(prior.generation);previousState='REVOKED';
  }else{
   const head=(await tx.query<{credential_id:string;generation:string}>('SELECT credential_id,generation::text FROM hyperfide.identity_bootstrap_recoveries WHERE organisation_id=$1 AND run_id=$2 ORDER BY generation DESC LIMIT 1 FOR UPDATE',[scope.organisation_id,scope.run_id])).rows[0];
   if((head?.credential_id??issuance.credential_id)!==value.previous_credential_id)
    fail('BOOTSTRAP_RECOVERY_CONFLICT','Only the current bootstrap operator of this run can be replaced');
   if((await tx.query('SELECT 1 FROM hyperfide.identity_principals WHERE credential_id=$1',[value.credential_id])).rows.length)
    fail('BOOTSTRAP_RECOVERY_CONFLICT','Existing credentials cannot be adopted by bootstrap recovery');
   const clock=(await tx.query<{db_now:Date}>('SELECT clock_timestamp() AS db_now')).rows[0]!.db_now;
   const ttl=Date.parse(String(value.expires_at))-new Date(clock).getTime();
   if(ttl<=0||ttl>policy.max_ttl_ms)fail('AUTH_EXPIRED','Requested operator expiry is outside trusted policy');
   const previous=(await tx.query<{state:string}>('SELECT state FROM hyperfide.identity_principals WHERE organisation_id=$1 AND run_id=$2 AND credential_id=$3 FOR UPDATE',[scope.organisation_id,scope.run_id,value.previous_credential_id])).rows[0];
   if(!previous)fail('BOOTSTRAP_RECOVERY_CONFLICT','The replaced bootstrap operator is not part of this run');
   previousState=previous.state;
   if(previous.state==='ACTIVE')
    await tx.query("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",[value.previous_credential_id]);
   generation=String(Number(head?.generation??'0')+1);
   await tx.query("INSERT INTO hyperfide.identity_principals(credential_id,organisation_id,run_id,actor_id,role,public_key_b64,deployment_epoch,allowed_actions,expires_at) VALUES($1,$2,$3,$4,'OPERATOR',$5,$6,$7,$8)",
    [value.credential_id,scope.organisation_id,scope.run_id,value.actor_id,value.public_key_b64,scope.authority_epoch,actions,value.expires_at]);
   await tx.query('INSERT INTO hyperfide.identity_bootstrap_recoveries(organisation_id,run_id,generation,recovery_id,previous_credential_id,credential_id,accepted_revision_digest,authority_epoch,reason,request_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [scope.organisation_id,scope.run_id,generation,value.recovery_id,value.previous_credential_id,value.credential_id,issuance.accepted_revision_digest,scope.authority_epoch,value.reason,requestDigest]);
  }
  const row=(await tx.query('SELECT * FROM hyperfide.identity_principals WHERE credential_id=$1 FOR SHARE',[value.credential_id])).rows[0];
  if(!row||row.state!=='ACTIVE'||row.organisation_id!==scope.organisation_id||row.run_id!==scope.run_id||row.actor_id!==value.actor_id||
     row.role!=='OPERATOR'||row.public_key_b64!==value.public_key_b64||row.deployment_epoch!==scope.authority_epoch||
     row.credential_version.toString()!=='1'||JSON.stringify(row.allowed_actions)!==JSON.stringify(actions)||new Date(row.expires_at).toISOString()!==value.expires_at)
   fail('BOOTSTRAP_RECOVERY_CONFLICT','Bootstrap recovery cannot overwrite, reactivate or widen an identity');
  const principal:Principal=frozen({credential_id:row.credential_id,organisation_id:row.organisation_id,run_id:row.run_id,
   actor_id:row.actor_id,role:'OPERATOR',credential_version:String(row.credential_version),deployment_epoch:row.deployment_epoch,
   sandbox_id:null,boot_id:null,boot_generation:null,attempt_id:null,attempt_generation:null,allowed_actions:actions,expires_at:String(value.expires_at)});
  await assertCurrentPrincipal(tx,principal,{assertCurrent:(currentTx,currentScope)=>assertCurrentAuthority(currentTx,{deployment_id:policy.deployment_id,...currentScope})});
  await assertCurrentAuthority(tx,scope);
  await assertFreshAttestation(tx,policy.deployment_id,scope.authority_epoch,attestation);
  return frozen({recovery_id:String(value.recovery_id),generation,previous_credential_id:String(value.previous_credential_id),previous_state:previousState,
   credential_id:principal.credential_id,organisation_id:principal.organisation_id,run_id:principal.run_id,actor_id:principal.actor_id,role:'OPERATOR' as const,
   credential_version:principal.credential_version,deployment_epoch:principal.deployment_epoch,expires_at:principal.expires_at,
   accepted_revision_digest:issuance.accepted_revision_digest,reason:String(value.reason),replayed:Boolean(prior)});
 });
}
