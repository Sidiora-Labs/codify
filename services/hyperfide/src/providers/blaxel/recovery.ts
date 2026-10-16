import {assertInvocation} from '../../transport/protocol.js';
import type {AuthorityTransaction,InvocationContext} from '../../transport/protocol.js';
import {invocationOf} from '../../identity/enrollment.js';
import {providerDatabase,bindProviderInvocation,readDeployment,currentPool,transaction,digestDocument} from '../pools.js';
import type {Component,ComponentContext} from '../../components/registry.js';
import {FoundationError} from '../../policy/programme.js';
import type {ProviderScope,ResourceRef,ProviderOperation,ProviderOutcome} from '../contract.js';
import {validateProviderOperation} from '../contract.js';
import {BLAXEL_PINS} from './images.js';
import type {BlaxelAdapter} from './processes.js';

export type BlaxelPreviewFeature='environment_updates'|'shared_storage'|'memory_snapshot'|'memory_fork';
export interface BlaxelPreviewEvidence{
 schema_version:1;feature:BlaxelPreviewFeature;scope:ProviderScope;sdk_version:string;
 status:'QUALIFIED';observed_at:string;expires_at:string;evidence_digest:string;
}
export interface BlaxelRecoveryDependencies{
 /** Reads authoritative qualification rows under the actual invocation guard.
  * A model-supplied object or arbitrary JSON evidence cannot install this closure. */
 readQualification(scope:ProviderScope,feature:BlaxelPreviewFeature):Promise<BlaxelPreviewEvidence|null>;
 assertScope(scope:ProviderScope):Promise<void>;
 assertFreshEnrollment(scope:ProviderScope,resource:ResourceRef):Promise<{boot_credential_version:string;enrollment_digest:string}>;
}
const FEATURES:BlaxelPreviewFeature[]=['environment_updates','shared_storage','memory_snapshot','memory_fork'];
type Obj=Record<string,unknown>;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function shape(v:unknown,keys:string[]):Obj{
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('BLAXEL_RECOVERY_INVALID','Object required');
 const o=v as Obj;if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))fail('BLAXEL_RECOVERY_INVALID','Unknown or missing field');return o;
}
function sameScope(a:ProviderScope,b:ProviderScope):boolean{
 return ['organisation_id','pool_id','provider','provider_account_id','environment_id','region','configuration_digest'].every(k=>a[k as keyof ProviderScope]===b[k as keyof ProviderScope]);
}
export function validateBlaxelPreviewEvidence(input:unknown,scope:ProviderScope,feature:BlaxelPreviewFeature,now:number):BlaxelPreviewEvidence{
 const o=shape(input,['schema_version','feature','scope','sdk_version','status','observed_at','expires_at','evidence_digest']);
 if(o.schema_version!==1||o.feature!==feature||o.status!=='QUALIFIED'||o.sdk_version!==BLAXEL_PINS.sdk||
 !o.scope||typeof o.scope!=='object'||!sameScope(o.scope as ProviderScope,scope)||
 typeof o.observed_at!=='string'||typeof o.expires_at!=='string'||
 !Number.isFinite(Date.parse(o.observed_at))||!Number.isFinite(Date.parse(o.expires_at))||
 new Date(o.observed_at).toISOString()!==o.observed_at||new Date(o.expires_at).toISOString()!==o.expires_at||
 Date.parse(o.observed_at)>now||Date.parse(o.expires_at)<=now||
 typeof o.evidence_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(o.evidence_digest))
 fail('BLAXEL_PREVIEW_UNQUALIFIED','Preview evidence is stale or differs from exact account/pool/configuration/SDK');
 return o as unknown as BlaxelPreviewEvidence;
}
export function blaxelRecoveryPolicy():unknown{
 return{schema_version:1,baseline:'FRESH_IMAGE_BOOT',fresh_boot_generation_required:true,fresh_signed_enrollment_required:true,
 inherited_authenticated_memory_permitted:false,memory_snapshot:'DISABLED',memory_fork:'DISABLED',
 environment_updates:'DISABLED_UNTIL_QUALIFIED',shared_storage:'DISABLED_UNTIL_QUALIFIED',
 existing_process_environment:'UNCHANGED_UNTIL_EXPLICIT_PROCESS_RESTART',
 volume_lifetime:'SEPARATE_FROM_SANDBOX',volume_ownership:'EXPLICIT_RECONCILIATION_REQUIRED',
 old_credentials:'REVOKED_AND_NOT_RESTORED',outward_action_before_fresh_enrollment:false,authority:'NONE'};
}
export function planBlaxelRecovery(input:unknown):unknown{
 const o=shape(input,['source','authenticated_memory_present','environment_changed','retained_volumes','checkpoint_digest']);
 if(!['FRESH_IMAGE','DISK_CHECKPOINT','MEMORY_SNAPSHOT','MEMORY_FORK'].includes(String(o.source))||
 typeof o.authenticated_memory_present!=='boolean'||typeof o.environment_changed!=='boolean'||
 !Array.isArray(o.retained_volumes)||o.retained_volumes.length>100||o.retained_volumes.some(v=>typeof v!=='string'||!/^[a-z0-9][a-z0-9-]{0,48}$/.test(v))||
 new Set(o.retained_volumes).size!==o.retained_volumes.length||
 o.checkpoint_digest!==null&&(typeof o.checkpoint_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(o.checkpoint_digest)))
 fail('BLAXEL_RECOVERY_INVALID','Invalid recovery plan');
 if(o.source==='MEMORY_SNAPSHOT'||o.source==='MEMORY_FORK'||o.authenticated_memory_present)
 fail('BLAXEL_AUTHENTICATED_CLONE_DISABLED','Restoring or forking authenticated process memory is disabled before every outward action');
 if(o.source==='DISK_CHECKPOINT'&&o.checkpoint_digest===null)fail('BLAXEL_RECOVERY_INVALID','Disk recovery requires an independently verified checkpoint');
 if(o.source==='FRESH_IMAGE'&&o.checkpoint_digest!==null)fail('BLAXEL_RECOVERY_INVALID','Fresh image recovery cannot silently import a checkpoint');
 return{candidate_compatible:o.source==='FRESH_IMAGE'&&o.retained_volumes.length===0,baseline:'FRESH_IMAGE_BOOT',source:o.source,checkpoint_digest:o.checkpoint_digest,
 blocked_reason:o.source==='DISK_CHECKPOINT'?'VERIFIED_DISK_RESTORE_UNAVAILABLE':o.retained_volumes.length?'RETAINED_VOLUME_OWNERSHIP_UNVERIFIED':null,
 disk_restore_supported:false,
 sequence:['VERIFY_QUALIFIED_IMMUTABLE_IMAGE','ALLOCATE_NEW_BOOT_GENERATION','CREATE_FRESH_SANDBOX','PERSIST_PROVIDER_ID',
 'VERIFY_ACTUAL_CONFIGURATION','RECONCILE_RETAINED_VOLUMES',...(o.source==='DISK_CHECKPOINT'?['VERIFY_AND_RESTORE_DISK_CHECKPOINT']:[]),
 'FRESH_SIGNED_RUNNER_ENROLLMENT','VERIFY_OLD_CREDENTIALS_REVOKED','INDEPENDENT_READINESS','ALLOW_OUTWARD_ACTION'],
 environment_effect:o.environment_changed?'NEW_PROCESS_ENVIRONMENT_ONLY':'NO_ENVIRONMENT_CHANGE',
 retained_volumes:(o.retained_volumes as string[]).map(reference=>({reference,adopted:false,mounted:false,ownership:'UNVERIFIED',deleted_with_old_sandbox:false})),
 credentials_restored:false,outward_action_authorized:false,authority:'NONE',live_qualification:'NOT_EVALUATED'};
}
export function createBlaxelRecoveryController(scope:ProviderScope,deps:BlaxelRecoveryDependencies){
 if(scope.provider!=='blaxel')fail('BLAXEL_RECOVERY_INVALID','Blaxel scope required');
 const verifyFreshEnrollment=async(resource:ResourceRef)=>{
  await deps.assertScope(scope);const proof=await deps.assertFreshEnrollment(scope,resource);
  if(!/^[1-9][0-9]*$/.test(proof.boot_credential_version)||!/^sha256:[a-f0-9]{64}$/.test(proof.enrollment_digest))fail('BLAXEL_FRESH_ENROLLMENT_REQUIRED','Actual fresh runner enrollment was not proven');
  await deps.assertScope(scope);return proof;
 };
 return Object.freeze({verifyFreshEnrollment,
  async negotiate(feature:BlaxelPreviewFeature):Promise<{enabled:true;evidence_digest:string}>{
   if(!FEATURES.includes(feature))fail('BLAXEL_RECOVERY_INVALID','Unknown preview feature');
   await deps.assertScope(scope);
   // Snapshot and fork are hard disabled even if an obsolete row says qualified.
   // Re-enabling requires a separate implementation proving credential fencing
   // before the restored clone can communicate, not a deployment flag.
   if(feature==='memory_snapshot'||feature==='memory_fork')fail('BLAXEL_AUTHENTICATED_CLONE_DISABLED','Authenticated memory recovery remains disabled');
   const raw=await deps.readQualification(scope,feature);
   if(!raw)fail('BLAXEL_PREVIEW_UNQUALIFIED','Preview feature lacks current independent provider qualification');
   const row=validateBlaxelPreviewEvidence(raw,scope,feature,Date.now());await deps.assertScope(scope);
   return{enabled:true,evidence_digest:row.evidence_digest};
  },
  async createFresh(adapter:BlaxelAdapter,operation:ProviderOperation<'create'>):Promise<{outcome:ProviderOutcome<'create'>;enrollment:'PENDING'|'VERIFIED';enrollment_digest:string|null;outward_action_authorized:false}>{
   const op=validateProviderOperation(operation);
   if(op.kind!=='create'||!sameScope(op.scope,scope)||adapter.provider!=='blaxel')fail('BLAXEL_RECOVERY_INVALID','Recovery operation scope differs');
   await deps.assertScope(scope);const result=await adapter.create(op);
   if(result.status!=='SUCCEEDED')return{outcome:result,enrollment:'PENDING',enrollment_digest:null,outward_action_authorized:false};
   if(!result.resource)fail('BLAXEL_RECOVERY_INVALID','Fresh create omitted boot binding');
   // Acceptance precedes fresh enrollment/readiness. Preserve the early resource
   // even when the runner has not registered yet; never synthesize ready status.
   try{const proof=await verifyFreshEnrollment(result.resource);return{outcome:result,enrollment:'VERIFIED',enrollment_digest:proof.enrollment_digest,outward_action_authorized:false};}
   catch(error){if(error instanceof FoundationError&&error.code==='BLAXEL_FRESH_ENROLLMENT_REQUIRED')return{outcome:result,enrollment:'PENDING',enrollment_digest:null,outward_action_authorized:false};throw error;}
  }
 });
}

interface FreshRunnerAuthority{
 verifyFreshRunner(invocation:InvocationContext,tx:AuthorityTransaction,target:{sandbox_id:string;boot_id:string;boot_generation:string;provisioning_intent_id:string;credential_id:string;observed_after:string;grant_id?:string}):Promise<{credential_id:string;sandbox_id:string;boot_id:string;boot_generation:string;grant_id:string;provisioning_intent_id:string;heartbeat_at:string;observation_only:true;authority:'NONE'}>;
}
/** Construct controller capabilities from a real branded invocation. Public
 * plan/preview inputs never supply principals, DB clients or qualification rows. */
function authenticatedRecoveryController(ctx:ComponentContext,invocation:InvocationContext,scope:ProviderScope){
 assertInvocation(invocation);
 const base=providerDatabase(ctx);
 const authority=ctx.dependencies.require<FreshRunnerAuthority>('14.1','identity.authority',(v):v is FreshRunnerAuthority=>!!v&&typeof v==='object'&&typeof(v as FreshRunnerAuthority).verifyFreshRunner==='function');
 const access=async()=>{
  const config=await readDeployment(ctx.env),database=bindProviderInvocation(base,config,invocation,['PROVISIONER','COORDINATOR','OPERATOR']);
  return{database,config};
 };
 const assertScope=async()=>{
  const {database,config}=await access();
  await transaction(database,async tx=>{
   const current=await currentPool(tx,config,scope.pool_id);
   if(!sameScope(scope,current.scope)||scope.organisation_id!==invocation.principal.organisation_id)fail('BLAXEL_RECOVERY_INVALID','Recovery scope differs from current authenticated pool configuration');
  });
 };
 return createBlaxelRecoveryController(scope,{
  assertScope,
  // These optional preview paths remain disabled until a dedicated live
  // qualification store/consumer is installed. No JSON declaration enables it.
  readQualification:async()=>null,
  assertFreshEnrollment:async(selected,resource)=>{
   await assertScope();
   const {database}=await access();
   return transaction(database,async tx=>{
    const rows=await tx.query("SELECT p.credential_id,p.credential_version,p.boot_id,s.id AS sandbox_id,s.preparation_digest,st.preparation_digest AS runner_preparation,pi.id AS provisioning_intent_id,pi.created_at AS observed_after,g.id AS grant_id FROM hyperfide.sandboxes s JOIN hyperfide.sandbox_boots b ON b.organisation_id=s.organisation_id AND b.sandbox_id=s.id AND b.boot_generation=s.boot_generation JOIN hyperfide.provisioning_intents pi ON pi.organisation_id=s.organisation_id AND pi.run_id=$2 AND pi.pool_id=s.pool_id AND pi.sandbox_id=s.id AND pi.native_sandbox_id=s.native_sandbox_id AND pi.boot_generation=s.boot_generation AND pi.configuration_digest=$6 AND pi.kind='CREATE' JOIN hyperfide.identity_enrollment_grants g ON g.organisation_id=s.organisation_id AND g.run_id=pi.run_id AND g.provisioning_intent_id=pi.id AND g.sandbox_id=s.id AND g.boot_id=b.boot_id AND g.boot_generation=s.boot_generation AND g.state='CONSUMED' JOIN hyperfide.identity_principals p ON p.credential_id=g.credential_id JOIN hyperfide.identity_runner_status st ON st.credential_id=p.credential_id WHERE s.organisation_id=$1 AND s.pool_id=$3 AND s.native_sandbox_id=$4 AND s.boot_generation=$5 FOR SHARE OF s,b,pi,g,p,st",
     [selected.organisation_id,invocation.principal.run_id,selected.pool_id,resource.native_sandbox_id,resource.sandbox_boot_generation,selected.configuration_digest]);
    if(rows.rows.length!==1)fail('BLAXEL_FRESH_ENROLLMENT_REQUIRED','Exactly one actual provisioning intent and consumed fresh-runner grant is required');
    const p=rows.rows[0]!;
    if(p.preparation_digest!==p.runner_preparation)fail('BLAXEL_FRESH_ENROLLMENT_REQUIRED','Runner preparation differs from current sandbox');
    // Delegate credential, epoch, signed status, consumed grant, current boot and
    // durable-operation freshness to the actual 14.1 authority in this same TX.
    const fresh=await authority.verifyFreshRunner(invocation,tx,{
     sandbox_id:p.sandbox_id,boot_id:p.boot_id,boot_generation:resource.sandbox_boot_generation,
     provisioning_intent_id:p.provisioning_intent_id,credential_id:p.credential_id,grant_id:p.grant_id,
     observed_after:new Date(p.observed_after).toISOString()});
    return{boot_credential_version:String(p.credential_version),enrollment_digest:digestDocument({
     scope:selected,resource,preparation_digest:p.preparation_digest,fresh})};
   });
  }
 });
}

export function createComponent(ctx:ComponentContext):Component{
 return{apiVersion:1,capabilities:{'blaxel.recovery.v1':{controller:(invocation:InvocationContext,scope:ProviderScope)=>authenticatedRecoveryController(ctx,invocation,scope)}},actions:{
  'blaxel.recovery.describe':input=>{shape(input,[]);return blaxelRecoveryPolicy();},
  'blaxel.recovery.plan':planBlaxelRecovery,
  'blaxel.recovery.enrollment':async(input,requestContext)=>{
   const o=shape(input,['scope','resource']),resource=shape(o.resource,['native_sandbox_id','sandbox_boot_generation']);
   if(typeof resource.native_sandbox_id!=='string'||typeof resource.sandbox_boot_generation!=='string'||!/^[1-9][0-9]{0,18}$/.test(resource.sandbox_boot_generation))fail('BLAXEL_RECOVERY_INVALID','Exact current boot resource required');
   const controller=authenticatedRecoveryController(ctx,invocationOf(requestContext),o.scope as ProviderScope),proof=await controller.verifyFreshEnrollment(resource as unknown as ResourceRef);
   return{enrolled:true,...proof,outward_action_authorized:false,authority:'NONE'};
  },
  'blaxel.recovery.preview':input=>{
   const o=shape(input,['feature']);if(!FEATURES.includes(o.feature as BlaxelPreviewFeature))fail('BLAXEL_RECOVERY_INVALID','Unknown preview feature');
   if(o.feature==='memory_snapshot'||o.feature==='memory_fork')fail('BLAXEL_AUTHENTICATED_CLONE_DISABLED','Authenticated clone recovery is disabled');
   fail('BLAXEL_PREVIEW_UNQUALIFIED','Use the authenticated controller qualification capability; action input cannot enable previews');
  }
 }};
}
