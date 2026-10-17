import fs from 'node:fs/promises';
import type {ServiceResources} from './storage/runtime.js';
import {assertCurrentAuthority,lookupAuthorityActivation,assertExternalAuthorityCurrent} from './storage/durability.js';
import {FileExternalAuthorityJournal} from './storage/authority_journal.js';
import type {ExternalAuthorityAttestation} from './storage/authority_journal.js';
import {assertCurrentPrincipal} from './identity/enrollment.js';
import {assertAcceptedBootstrap} from './spec/bootstrap.js';
import {base64,exact,fail,frozen,hash,NAME,uuid} from './transport/protocol.js';
import type {AuthorityTransaction,Principal} from './transport/protocol.js';

export interface BootstrapPolicy {deployment_id:string;max_ttl_ms:number;journal_dir:string}
export interface OperatorBinding {
 credential_id:string;organisation_id:string;run_id:string;actor_id:string;role:'OPERATOR';
 credential_version:string;deployment_epoch:string;expires_at:string;accepted_revision_digest:string;replayed:boolean;
}
export async function assertBootstrapExternalAuthority(resources:ServiceResources,policy:BootstrapPolicy,signal?:AbortSignal){
 if(!policy.journal_dir||!policy.journal_dir.startsWith('/'))fail('BOOTSTRAP_POLICY_REQUIRED','Trusted external authority journal directory is required');
 const journal=new FileExternalAuthorityJournal(policy.journal_dir,input=>lookupAuthorityActivation(resources,input));
 const attestation=await assertExternalAuthorityCurrent(resources,journal,{deployment_id:policy.deployment_id,...(signal?{signal}:{})});
 return {journal,attestation};
}
// The external journal attestation must still name the current primary epoch inside this transaction.
export async function assertFreshAttestation(tx:AuthorityTransaction,deploymentId:string,epoch:string,attestation:ExternalAuthorityAttestation):Promise<void>{
 const row=(await tx.query("SELECT epoch::text,proof_digest,clock_timestamp() AS db_now FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND state='ACTIVE' FOR SHARE",[deploymentId])).rows[0];
 const now=row?new Date(row.db_now).getTime():NaN,observed=Date.parse(attestation.observed_at),expiry=Date.parse(attestation.expires_at);
 if(!row||attestation.deployment_id!==deploymentId||row.epoch!==epoch||attestation.epoch!==row.epoch||row.proof_digest!==attestation.evidence_digest||
    !/^[1-9][0-9]*$/.test(attestation.sequence)||!Number.isFinite(now)||!Number.isFinite(observed)||!Number.isFinite(expiry)||observed>now+1000||expiry<=now||expiry<=observed||expiry-observed>30000)
  fail('EXTERNAL_JOURNAL_STALE','External authority attestation expired or differs from current primary authority');
}
function binding(p:Principal,digest:string,replayed:boolean):OperatorBinding{
 return frozen({credential_id:p.credential_id,organisation_id:p.organisation_id,run_id:p.run_id,
  actor_id:p.actor_id,role:'OPERATOR' as const,credential_version:p.credential_version,
  deployment_epoch:p.deployment_epoch,expires_at:p.expires_at,accepted_revision_digest:digest,replayed});
}
// Trusted local operator entry only. No listener or registry action exposes this issuer.
export async function issueOfflineOperator(resources:ServiceResources,value:unknown,policy:BootstrapPolicy,signal?:AbortSignal):Promise<OperatorBinding>{
 exact(value,['credential_id','organisation_id','run_id','actor_id','public_key_b64','deployment_epoch','allowed_actions','expires_at','accepted_revision_digest']);
 for(const key of ['credential_id','organisation_id','run_id','actor_id','deployment_epoch'])if(!uuid(value[key]))fail('INVALID_REQUEST','Exact operator identity scope is required');
 base64(value.public_key_b64,32);
 if(typeof value.accepted_revision_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value.accepted_revision_digest)||
    typeof value.expires_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expires_at)||
    !Number.isFinite(Date.parse(value.expires_at))||new Date(value.expires_at).toISOString()!==value.expires_at)
  fail('INVALID_REQUEST','Exact accepted revision and canonical expiry are required');
 if(!Array.isArray(value.allowed_actions)||value.allowed_actions.length<1||value.allowed_actions.length>256||
    value.allowed_actions.some(x=>typeof x!=='string'||!NAME.test(x))||new Set(value.allowed_actions).size!==value.allowed_actions.length)
  fail('INVALID_REQUEST','Unique finite action capabilities are required');
 if(!uuid(policy.deployment_id)||!Number.isSafeInteger(policy.max_ttl_ms)||policy.max_ttl_ms<1||policy.max_ttl_ms>2147483647)
  fail('BOOTSTRAP_POLICY_REQUIRED','Explicit trusted deployment and bounded expiry policy are required');
 const actions=(value.allowed_actions as string[]).slice().sort();
 const request={credential_id:value.credential_id,organisation_id:value.organisation_id,run_id:value.run_id,
  actor_id:value.actor_id,public_key_b64:value.public_key_b64,deployment_epoch:value.deployment_epoch,
  allowed_actions:actions,expires_at:value.expires_at,accepted_revision_digest:value.accepted_revision_digest};
 const requestDigest=hash(JSON.stringify(request));
 const expected=await Promise.all([
  fs.readFile(new URL('../migrations/0014-enrollment.sql',import.meta.url)),
  fs.readFile(new URL('../migrations/0026-bootstrap.sql',import.meta.url))
 ]);
 const {attestation}=await assertBootstrapExternalAuthority(resources,policy,signal);
 return resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,...(signal?{signal}:{})},async tx=>{
  for(const [index,version,name] of [[0,14,'0014-enrollment'],[1,26,'0026-bootstrap']] as const){
   const migration=(await tx.query<{name:string;checksum:string}>('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=$1',[version])).rows[0];
   if(!migration||migration.name!==name||migration.checksum!==hash(expected[index]!))
    fail('BOOTSTRAP_SCHEMA_REQUIRED','Apply the exact trusted identity and bootstrap migrations first');
  }
  const scope={deployment_id:policy.deployment_id,organisation_id:String(value.organisation_id),run_id:String(value.run_id),authority_epoch:String(value.deployment_epoch)};
  await assertCurrentAuthority(tx,scope);
  const accepted=await assertAcceptedBootstrap(tx,{organisation_id:scope.organisation_id,run_id:scope.run_id,authority_epoch:scope.authority_epoch,accepted_revision_digest:String(value.accepted_revision_digest)});
  if(actions.some(action=>!accepted.allowed_actions.includes(action)))fail('AUTH_SCOPE_DENIED','Operator grant cannot exceed accepted intent capabilities');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['bootstrap-operator:'+scope.organisation_id+':'+scope.run_id]);
  const assertFreshExternal=(attestation:ExternalAuthorityAttestation)=>assertFreshAttestation(tx,policy.deployment_id,scope.authority_epoch,attestation);
  await assertFreshExternal(attestation);
  const previous=(await tx.query<{credential_id:string;request_digest:string}>('SELECT credential_id,request_digest FROM hyperfide.identity_bootstrap_issuances WHERE organisation_id=$1 AND run_id=$2 FOR UPDATE',[scope.organisation_id,scope.run_id])).rows[0];
  if(previous&&(previous.credential_id!==value.credential_id||previous.request_digest!==requestDigest))
   fail('IDENTITY_BOOTSTRAP_CONFLICT','A run cannot issue a different initial operator');
  const clock=(await tx.query<{db_now:Date}>('SELECT clock_timestamp() AS db_now')).rows[0]!.db_now;
  const ttl=Date.parse(String(value.expires_at))-new Date(clock).getTime();
  if(ttl<=0||ttl>policy.max_ttl_ms)fail('AUTH_EXPIRED','Requested operator expiry is outside trusted policy');
  if(!previous){
   if((await tx.query('SELECT credential_id FROM hyperfide.identity_principals WHERE organisation_id=$1 AND run_id=$2 LIMIT 1',[scope.organisation_id,scope.run_id])).rows.length)
    fail('IDENTITY_BOOTSTRAP_CONFLICT','Existing run credentials cannot be adopted by offline bootstrap');
   await tx.query("INSERT INTO hyperfide.identity_principals(credential_id,organisation_id,run_id,actor_id,role,public_key_b64,deployment_epoch,allowed_actions,expires_at) VALUES($1,$2,$3,$4,'OPERATOR',$5,$6,$7,$8)",
    [value.credential_id,scope.organisation_id,scope.run_id,value.actor_id,value.public_key_b64,scope.authority_epoch,actions,value.expires_at]);
   await tx.query('INSERT INTO hyperfide.identity_bootstrap_issuances(organisation_id,run_id,credential_id,accepted_revision_digest,authority_epoch,request_digest) VALUES($1,$2,$3,$4,$5,$6)',
    [scope.organisation_id,scope.run_id,value.credential_id,value.accepted_revision_digest,scope.authority_epoch,requestDigest]);
  }
  const row=(await tx.query('SELECT * FROM hyperfide.identity_principals WHERE credential_id=$1 FOR SHARE',[value.credential_id])).rows[0];
  if(!row||row.state!=='ACTIVE'||row.organisation_id!==scope.organisation_id||row.run_id!==scope.run_id||row.actor_id!==value.actor_id||
     row.role!=='OPERATOR'||row.public_key_b64!==value.public_key_b64||row.deployment_epoch!==scope.authority_epoch||
     row.credential_version.toString()!=='1'||JSON.stringify(row.allowed_actions)!==JSON.stringify(actions)||
     new Date(row.expires_at).toISOString()!==value.expires_at||row.sandbox_id!==null||row.boot_id!==null||
     row.boot_generation!==null||row.attempt_id!==null||row.attempt_generation!==null)
   fail('IDENTITY_BOOTSTRAP_CONFLICT','Offline bootstrap cannot overwrite, reactivate or widen an identity');
  const principal:Principal=frozen({credential_id:row.credential_id,organisation_id:row.organisation_id,run_id:row.run_id,
   actor_id:row.actor_id,role:'OPERATOR',credential_version:String(row.credential_version),deployment_epoch:row.deployment_epoch,
   sandbox_id:null,boot_id:null,boot_generation:null,attempt_id:null,attempt_generation:null,allowed_actions:actions,expires_at:String(value.expires_at)});
  await assertCurrentPrincipal(tx,principal,{assertCurrent:(currentTx,currentScope)=>assertCurrentAuthority(currentTx,{deployment_id:policy.deployment_id,...currentScope})});
  await assertCurrentAuthority(tx,scope);
  await assertFreshExternal(attestation);
  return binding(principal,String(value.accepted_revision_digest),Boolean(previous));
 });
}
