import fs from 'node:fs/promises';
import {randomUUID,randomInt} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import * as identityCredentials from '../identity/credentials.js';
import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {invocationOf} from '../identity/enrollment.js';
import type {TransactionGateway,PrimaryTransaction} from '../storage/transactions.js';
import {operationPayloadDigest,validateProviderOperation,validateProviderOutcome} from './contract.js';
import type {ProviderOperation,ProviderScope,ProviderOutcome} from './contract.js';
import {providerDatabase,resolveSandboxBinding,assertInvocationRun,providerInvocation,bindProviderInvocation,obj,str,uuid,dec,dg,utc,fail,readDeployment,currentPool,configuredScope,transaction,digestDocument,providerAdapter,poolCapacity} from './pools.js';
import type {ProviderDatabase,DeploymentConfig,ProviderIsolationFactory} from './pools.js';
import {compareEnvironmentCompatibility} from '../preparation/manifests.js';


export interface FreshEnrollmentProof {
 enrolled:true;boot_id:string;session_id:string;credential_id:string;credential_lineage:string;verified_at:string;evidence_digest:string;
}
interface PlacementDependencies {
 authority:{verifyFreshRunner(invocation:InvocationContext,tx:PrimaryTransaction,input:Record<string,unknown>):Promise<Record<string,unknown>>};
 execution:import('./reconcile.js').ProviderExecutionCapability;
 native:{authenticatePlacementProbe(invocation:InvocationContext,input:{probe_id:string},signal:AbortSignal):Promise<{request:import('./reconcile.js').BoundProviderRequest;invocation:InvocationContext}>};
}
function identityPlacementDependencies(context:ComponentContext):Pick<PlacementDependencies,"authority">{
 return{authority:context.dependencies.require("14.1","identity.authority",(v):v is PlacementDependencies["authority"]=>!!v&&typeof v==="object"&&typeof (v as PlacementDependencies["authority"]).verifyFreshRunner==="function")};
}
function placementDependencies(context:ComponentContext):PlacementDependencies {
 return{
  authority:context.dependencies.require('14.1','identity.authority',(v):v is PlacementDependencies['authority']=>!!v&&typeof v==='object'&&typeof (v as PlacementDependencies['authority']).verifyFreshRunner==='function'),
  execution:context.dependencies.require('8.3','provider.execution.v1',(v):v is PlacementDependencies['execution']=>!!v&&typeof v==='object'&&typeof (v as PlacementDependencies['execution']).executeBound==='function'),
  native:context.dependencies.require('12.4-executor','runner.native.v1',(v):v is PlacementDependencies['native']=>!!v&&typeof v==='object'&&typeof (v as PlacementDependencies['native']).authenticatePlacementProbe==='function'),
 };
}
export interface EnvironmentCompatibilityProof {compatible:boolean;evidence_digest:string}
export type EnvironmentCompatibilityVerifier=(source:unknown,target:unknown)=>Promise<EnvironmentCompatibilityProof>;
/** Compares the published, self-digested preparation manifests (11.1 metadata
 * validation). It grants neither readiness nor ownership: fresh enrollment and
 * target-boot probes remain required before any admission. */
export const preparationCompatibilityVerifier:EnvironmentCompatibilityVerifier=async(source,target)=>{
 const proof=await compareEnvironmentCompatibility(source,target);
 return{compatible:proof.compatible,evidence_digest:proof.evidence_digest};
};

interface Target {name:'coordinator'|'git'|'artifact'|'model';url:string;header_name:string;header_prefix:string;credential_ref:string;expected_status:number;denied_statuses:number[];expected_body_sha256:string|null}
interface ConnectivityConfig {schema_version:1;evidence_scope:'LIVE_POOL'|'COMPONENT_FIXTURE';targets:Target[];timeout_ms:number;maximum_attempts:number;base_backoff_ms:number;max_backoff_ms:number;proof_max_age_ms:number}
async function connectivity(env:Readonly<NodeJS.ProcessEnv>):Promise<ConnectivityConfig>{
  const path=env.HYPERFIDE_CONNECTIVITY_CONFIG;if(!path?.startsWith('/'))fail('CONNECTIVITY_CONFIG_REQUIRED','Trusted connectivity configuration is required');
  const info=await fs.lstat(path);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)||info.size>65536||(process.getuid&&info.uid!==process.getuid()))
    fail('CONNECTIVITY_CONFIG_INVALID','Connectivity configuration must be owner-only');
  const c=obj(JSON.parse(await fs.readFile(path,'utf8')),['schema_version','evidence_scope','targets','timeout_ms','maximum_attempts','base_backoff_ms','max_backoff_ms','proof_max_age_ms']);
  if(c.schema_version!==1||!['LIVE_POOL','COMPONENT_FIXTURE'].includes(String(c.evidence_scope)))fail('CONNECTIVITY_CONFIG_INVALID','Unsupported connectivity policy');
  for(const [name,min,max] of [['timeout_ms',100,60000],['maximum_attempts',1,20],['base_backoff_ms',100,60000],['max_backoff_ms',100,3600000],['proof_max_age_ms',1000,300000]] as const)
    if(!Number.isSafeInteger(c[name])||(c[name] as number)<min||(c[name] as number)>max)fail('CONNECTIVITY_CONFIG_INVALID','Connectivity policy exceeds bounds');
  if((c.base_backoff_ms as number)>(c.max_backoff_ms as number)||!Array.isArray(c.targets)||c.targets.length!==4)fail('CONNECTIVITY_CONFIG_INVALID','Four distinct required endpoints are needed');
  const names=new Set<string>();
  for(const raw of c.targets){
    const t=obj(raw,['name','url','header_name','header_prefix','credential_ref','expected_status','denied_statuses','expected_body_sha256']);
    if(!['coordinator','git','artifact','model'].includes(String(t.name))||names.has(String(t.name)))fail('CONNECTIVITY_CONFIG_INVALID','Invalid endpoint identity');names.add(String(t.name));
    const url=new URL(str(t.url));if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.hostname.endsWith('.railway.internal'))
      fail('CONNECTIVITY_CONFIG_INVALID','Use explicit authenticated TLS endpoints without cross-environment private DNS assumptions');
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(local&&c.evidence_scope!=='COMPONENT_FIXTURE')fail('CONNECTIVITY_CONFIG_INVALID','Loopback evidence cannot qualify a live pool');
    if(typeof t.header_name!=='string'||!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(t.header_name)||
      typeof t.header_prefix!=='string'||t.header_prefix.length>64||/[\r\n\u0000]/.test(t.header_prefix)||
      typeof t.credential_ref!=='string'||!/^secret-ref:[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(t.credential_ref))
      fail('CONNECTIVITY_CONFIG_INVALID','Credential references and headers must be explicit');
    if(!Number.isInteger(t.expected_status)||(t.expected_status as number)<200||(t.expected_status as number)>299||
      !Array.isArray(t.denied_statuses)||!t.denied_statuses.length||t.denied_statuses.some(x=>![401,403,404].includes(x)))
      fail('CONNECTIVITY_CONFIG_INVALID','Authenticated and anonymous response expectations are required');
    if(t.expected_body_sha256!==null)dg(t.expected_body_sha256);
  }
  return c as unknown as ConnectivityConfig;
}
/** The remote process verifies both authentication refusal and authenticated
 * access. It prints only statuses and body hashes, never headers or bodies. */
const probeProgram=[
  "const https=require('node:https'),crypto=require('node:crypto');",
  "const input=JSON.parse(process.argv[1]);",
  "function request(t,auth){return new Promise((resolve,reject)=>{",
  "const headers={'X-Hyperfide-Probe-Nonce':input.nonce};",
  "if(auth){const secret=process.env[t.env];if(!secret)return reject(Error('credential unavailable'));headers[t.header_name]=t.header_prefix+secret;}",
  "const req=https.request(t.url,{method:'GET',headers,timeout:input.timeout_ms},res=>{let bytes=0;const chunks=[];",
  "res.on('data',b=>{bytes+=b.length;if(bytes>65536){req.destroy(Error('bounded response exceeded'));return;}chunks.push(b);});",
  "res.on('end',()=>resolve({status:res.statusCode,hash:'sha256:'+crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex')}));",
  "});req.on('timeout',()=>req.destroy(Error('deadline')));req.on('error',()=>reject(Error('TLS or network failure')));req.end();});}",
  "(async()=>{const results=[];for(const t of input.targets){const denied=await request(t,false);",
  "if(!t.denied_statuses.includes(denied.status))throw Error('anonymous access was not refused');",
  "const allowed=await request(t,true);if(allowed.status!==t.expected_status||(t.expected_body_sha256&&allowed.hash!==t.expected_body_sha256))throw Error('authenticated response mismatch');",
  "results.push({name:t.name,denied_status:denied.status,status:allowed.status,body_sha256:allowed.hash});}",
  "process.stdout.write(JSON.stringify({nonce:input.nonce,results})+'\\n');})().catch(()=>{process.stderr.write('authenticated pool connectivity probe failed\\n');process.exitCode=1;});",
].join('\n');
async function boundedEffect<T>(effect:Promise<T>,signal:AbortSignal,deadline:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;let abort:(()=>void)|undefined;
 try{return await Promise.race([effect,new Promise<never>((_resolve,reject)=>{
  const stop=()=>reject(new Error('Provider effect requires reconciliation'));
  timer=setTimeout(stop,Math.max(1,deadline-Date.now()));abort=stop;signal.addEventListener('abort',stop,{once:true});if(signal.aborted||Date.now()>=deadline)stop();
 })]);}finally{if(timer)clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);}
}

async function verifyEnrollmentInTx(tx:PrimaryTransaction,pool:ProviderDatabase,config:DeploymentConfig,poolId:string,sandbox:Record<string,any>,runId:string,maxAge:number,dependencies:Pick<PlacementDependencies,"authority">):Promise<FreshEnrollmentProof>{
 assertPrimaryTransaction(tx);assertInvocationRun(pool,runId);
 const runners=(await tx.query("SELECT r.session_id,r.credential_id,b.boot_id FROM hyperfide.runner_registry r JOIN hyperfide.sandbox_boots b ON b.organisation_id=r.organisation_id AND b.sandbox_id=r.sandbox_id AND b.boot_generation=r.boot_generation AND b.boot_id=r.boot_id WHERE r.organisation_id=$1 AND r.run_id=$2 AND r.sandbox_id=$3 AND r.boot_generation=$4 AND r.state='CURRENT' FOR SHARE OF r,b",[config.organisation_id,runId,sandbox.id,sandbox.boot_generation])).rows;
 const creates=(await tx.query("SELECT id,created_at FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND run_id=$2 AND pool_id=$3 AND sandbox_id=$4 AND boot_generation=$5 AND native_sandbox_id=$6 AND kind='CREATE' AND state IN ('ID_KNOWN','ACKNOWLEDGED') FOR SHARE",[config.organisation_id,runId,poolId,sandbox.id,sandbox.boot_generation,sandbox.native_sandbox_id])).rows;
 if(runners.length!==1||creates.length!==1)fail('ENROLLMENT_UNVERIFIED','Unique actual current runner and durable creation lineage required');
 const runner=runners[0]!,create=creates[0]!;
 const observed=await dependencies.authority.verifyFreshRunner(providerInvocation(pool),tx,{sandbox_id:sandbox.id,boot_id:runner.boot_id,boot_generation:String(sandbox.boot_generation),provisioning_intent_id:create.id,credential_id:runner.credential_id,observed_after:new Date(create.created_at).toISOString()});
 if(observed.credential_id!==runner.credential_id||observed.boot_id!==runner.boot_id||observed.sandbox_id!==sandbox.id||String(observed.boot_generation)!==String(sandbox.boot_generation)||observed.provisioning_intent_id!==create.id)fail('ENROLLMENT_UNVERIFIED','Actual signed enrollment lineage changed');
 const at=utc(observed.heartbeat_at);
 if(Date.parse(at)>Date.now()||Date.now()-Date.parse(at)>maxAge)fail('ENROLLMENT_STALE','Actual authenticated runner heartbeat is stale');
 return{enrolled:true,session_id:String(runner.session_id),credential_id:String(runner.credential_id),boot_id:String(runner.boot_id),credential_lineage:String(runner.credential_id),verified_at:at,evidence_digest:digestDocument({session_id:runner.session_id,verified:observed})};
}
async function verifyEnrollment(pool:ProviderDatabase,config:DeploymentConfig,poolId:string,sandbox:Record<string,any>,runId:string,maxAge:number,dependencies:Pick<PlacementDependencies,"authority">):Promise<FreshEnrollmentProof>{
 return transaction(pool,tx=>verifyEnrollmentInTx(tx,pool,config,poolId,sandbox,runId,maxAge,dependencies));
}
export async function probePool(pool:ProviderDatabase,config:DeploymentConfig,policy:ConnectivityConfig,value:unknown,signal:AbortSignal,resolveDependencies?:()=>PlacementDependencies):Promise<unknown>{
 const input=obj(value,['pool_id','sandbox_id','run_id']),poolId=uuid(input.pool_id),sandboxId=uuid(input.sandbox_id),runId=uuid(input.run_id);
 assertInvocationRun(pool,runId);
 const incoming=providerInvocation(pool);
 if(incoming.principal.role!=='PROVISIONER')fail('AUTH_SCOPE_DENIED','Actual provisioner executes configured pool probes');
 if(!resolveDependencies)fail('PROVIDER_HOOK_UNAVAILABLE','Actual identity/native/provider execution composition required');
 const dependencies=resolveDependencies(),{scope}=await currentPool(pool,config,poolId);
 const rows=await pool.query("SELECT * FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND pool_id=$3 AND desired_state='RUNNING' AND observed_state='RUNNING'",[config.organisation_id,sandboxId,poolId]);
 const sandbox=rows.rows[0];if(!sandbox?.native_sandbox_id)fail('POOL_PROBE_UNAVAILABLE','An identified current running sandbox is required');
 const proof=await verifyEnrollment(pool,config,poolId,sandbox,runId,policy.proof_max_age_ms,dependencies),id=incoming.operation.operation_id,nonce=randomUUID();
 const env:Record<string,string>={},targets=policy.targets.map((target,index)=>{const name='HYPERFIDE_PROBE_CREDENTIAL_'+index;env[name]=target.credential_ref;return{...target,env:name,credential_ref:undefined};});
 const duration=Math.min(config.maximum_operation_ms,policy.timeout_ms*8+1000);
 const request:import('./reconcile.js').BoundProviderRequest={binding:{organisation_id:config.organisation_id,run_id:runId,session_id:proof.session_id,pool_id:poolId,sandbox_id:sandboxId,external_sandbox_id:sandbox.native_sandbox_id,boot_generation:String(sandbox.boot_generation),preparation_digest:sandbox.preparation_digest},operation_id:id,
  argv:['node','--input-type=commonjs','-e',probeProgram,JSON.stringify({nonce,targets,timeout_ms:policy.timeout_ms})],cwd:'/',env_refs:env,timeout_ms:duration};
 const sourceInvocation={component:incoming.payload.component,action:incoming.payload.action,payload_digest:incoming.operation.payload_digest,operation_id:incoming.operation.operation_id,credential_id:incoming.principal.credential_id,run_id:incoming.principal.run_id};
 const endpointsDigest=digestDocument(policy.targets);
 const previous=await transaction(pool,async tx=>{
  await currentPool(tx,config,poolId);
  const old=(await tx.query('SELECT * FROM hyperfide.provider_connectivity_probes WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[config.organisation_id,id])).rows[0];
  if(old){
   if(old.pool_id!==poolId||old.sandbox_id!==sandboxId||String(old.boot_generation)!==String(sandbox.boot_generation)||old.configuration_digest!==scope.configuration_digest||old.endpoints_digest!==endpointsDigest||digestDocument(old.observation.source_invocation)!==digestDocument(sourceInvocation))fail('IDEMPOTENCY_CONFLICT','Probe identity or protected policy changed');
   return old;
  }
  await tx.query("INSERT INTO hyperfide.provider_connectivity_probes(organisation_id,id,pool_id,sandbox_id,boot_generation,configuration_digest,endpoints_digest,credential_lineage,enrollment_evidence_digest,evidence_digest,evidence_scope,status,observation,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'UNKNOWN',$12,$13)",
   [config.organisation_id,id,poolId,sandboxId,sandbox.boot_generation,scope.configuration_digest,endpointsDigest,proof.credential_lineage,proof.evidence_digest,digestDocument({request,enrollment:proof}),policy.evidence_scope,{nonce,bound_request:request,source_invocation:sourceInvocation},new Date(Date.now()+policy.proof_max_age_ms).toISOString()]);
  return null;
 });
 if(previous)return{id,status:previous.status==='PASS'&&new Date(previous.expires_at).getTime()>Date.now()?'PASS':'UNKNOWN',evidence_digest:previous.evidence_digest,evidence_scope:previous.evidence_scope,live_pool_qualified:previous.status==='PASS'&&new Date(previous.expires_at).getTime()>Date.now()&&previous.evidence_scope==='LIVE_POOL',replayed:true,reconciliation_required:previous.status==='UNKNOWN',admission_granted:false};
 const combined=AbortSignal.any([signal,incoming.signal,AbortSignal.timeout(duration)]),deadline=Date.now()+duration;
 let executed:Record<string,any>|null=null,receipt:unknown=null,pass=false,errorCode:string|null=null;
 try{
  const authenticated=await boundedEffect(dependencies.native.authenticatePlacementProbe(incoming,{probe_id:id},combined),combined,deadline);
  assertInvocation(authenticated.invocation);
  if(digestDocument(authenticated.request)!==digestDocument(request))fail('PROBE_EXECUTION_MISMATCH','Actual signer returned a different persisted probe');
  executed=await boundedEffect(dependencies.execution.executeBound(authenticated.request,combined,authenticated.invocation) as Promise<Record<string,any>>,combined,deadline);
  const captured=executed.captured;
  if(captured?.complete===true&&captured.exit_code===0&&captured.stdout instanceof Uint8Array&&captured.stderr instanceof Uint8Array&&captured.stdout.byteLength<=65536&&captured.stderr.byteLength===0){
   receipt=JSON.parse(Buffer.from(captured.stdout).toString('utf8'));const r=obj(receipt,['nonce','results']);pass=r.nonce===nonce&&Array.isArray(r.results)&&r.results.length===policy.targets.length;
   if(pass)for(let n=0;n<policy.targets.length;n++){const observed=obj((r.results as unknown[])[n],['name','denied_status','status','body_sha256']),target=policy.targets[n]!;
    if(observed.name!==target.name||observed.status!==target.expected_status||!target.denied_statuses.includes(observed.denied_status as number)||target.expected_body_sha256&&observed.body_sha256!==target.expected_body_sha256)pass=false;
    dg(observed.body_sha256);
   }
  }
 }catch(error){errorCode=error&&typeof error==='object'&&'code'in error?String(error.code):'PROBE_OUTCOME_UNKNOWN';}
 const status=pass?'PASS':executed?'FAIL':'UNKNOWN',evidence=digestDocument({request,execution_evidence_digest:executed?.evidence_digest??null,enrollment:proof,receipt,error_code:errorCode});
 await transaction(pool,async tx=>{
  await currentPool(tx,config,poolId);
  const current=(await tx.query("SELECT * FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND desired_state='RUNNING' AND observed_state='RUNNING' FOR SHARE",[config.organisation_id,sandboxId])).rows[0];
  if(!current||String(current.boot_generation)!==String(sandbox.boot_generation)||current.native_sandbox_id!==sandbox.native_sandbox_id)fail('STALE_SANDBOX_GENERATION','Resource identity changed during pool probing');
  await verifyEnrollmentInTx(tx,pool,config,poolId,current,runId,policy.proof_max_age_ms,dependencies);
  await tx.query('UPDATE hyperfide.provider_connectivity_probes SET evidence_digest=$3,status=$4,observation=$5 WHERE organisation_id=$1 AND id=$2',
   [config.organisation_id,id,evidence,status,{nonce,bound_request:request,source_invocation:sourceInvocation,execution_evidence_digest:executed?.evidence_digest??null,receipt,error_code:errorCode}]);
  if(pass)await tx.query("INSERT INTO hyperfide.provider_pool_health(organisation_id,pool_id) VALUES($1,$2) ON CONFLICT(organisation_id,pool_id) DO UPDATE SET failure_count=0,state='CLOSED',retry_after=NULL,state_version=hyperfide.provider_pool_health.state_version+1",[config.organisation_id,poolId]);
 });
 return{id,status,evidence_digest:evidence,evidence_scope:policy.evidence_scope,live_pool_qualified:pass&&policy.evidence_scope==='LIVE_POOL',reconciliation_required:status==='UNKNOWN',admission_granted:false};
}

export async function recordPoolFailure(pool:ProviderDatabase,config:DeploymentConfig,policy:ConnectivityConfig,value:unknown):Promise<unknown>{
  const input=obj(value,['observation_id']),observationId=uuid(input.observation_id);
  return transaction(pool,async c=>{
    const rows=await c.query('SELECT o.*,i.pool_id,i.run_id AS observation_run_id FROM hyperfide.provider_observations o JOIN hyperfide.provisioning_intents i ON i.organisation_id=o.organisation_id AND i.id=o.intent_id WHERE o.organisation_id=$1 AND o.id=$2 FOR UPDATE OF o',[config.organisation_id,observationId]);
    const row=rows.rows[0],code=row?.observation?.outcome?.error?.code;
    if(!row||!['RATE_LIMIT','UNAVAILABLE','TIMEOUT'].includes(code))fail('PROVIDER_FAILURE_UNVERIFIED','A recorded provider rate-limit or partition observation is required');
    assertInvocationRun(pool,row.observation_run_id);
    await currentPool(c,config,row.pool_id);
    if(row.failure_applied_at)return{recorded:false,pool_id:row.pool_id,replayed:true,reconciliation_required:row.observation.outcome.status==='UNKNOWN'};
    await c.query("INSERT INTO hyperfide.provider_pool_health(organisation_id,pool_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[config.organisation_id,row.pool_id]);
    const health=(await c.query('SELECT * FROM hyperfide.provider_pool_health WHERE organisation_id=$1 AND pool_id=$2 FOR UPDATE',[config.organisation_id,row.pool_id])).rows[0];
    if(!health)fail('POOL_HEALTH_UNKNOWN','Pool health row disappeared');
    const count=health.failure_count+1,delay=Math.min(policy.max_backoff_ms,policy.base_backoff_ms*2**Math.min(16,count-1)+randomInt(policy.base_backoff_ms));
    const retry=new Date(Date.now()+delay).toISOString();
    await c.query("UPDATE hyperfide.provider_pool_health SET failure_count=$3,state='OPEN',retry_after=$4,last_outcome_digest=$5,state_version=state_version+1 WHERE organisation_id=$1 AND pool_id=$2",[config.organisation_id,row.pool_id,count,retry,row.evidence_digest]);
    await c.query('UPDATE hyperfide.provider_observations SET failure_applied_at=clock_timestamp() WHERE organisation_id=$1 AND id=$2',[config.organisation_id,observationId]);
    return{recorded:true,pool_id:row.pool_id,retry_after:retry,maximum_attempts:policy.maximum_attempts,automatic_retry_allowed:count<policy.maximum_attempts,reconciliation_required:row.observation.outcome.status==='UNKNOWN'};
  });
}
export async function planRelocation(pool:ProviderDatabase,config:DeploymentConfig,policy:ConnectivityConfig,value:unknown,environmentVerifier?:EnvironmentCompatibilityVerifier):Promise<unknown>{
  const input=obj(value,['run_id','old_attempt_id','expected_generation','expected_authority_epoch','target_pool_id','checkpoint_id','reason_observation_id']);
  const run=uuid(input.run_id),attemptId=uuid(input.old_attempt_id),generation=dec(input.expected_generation),epoch=uuid(input.expected_authority_epoch),targetId=uuid(input.target_pool_id);
  assertInvocationRun(pool,run);
  if(generation==='0')fail('INVALID_REQUEST','Attempt generation must be positive');
  return transaction(pool,async c=>{
    const previous=await c.query('SELECT * FROM hyperfide.provider_relocation_plans WHERE organisation_id=$1 AND run_id=$2 AND old_attempt_id=$3 AND old_attempt_generation=$4',[config.organisation_id,run,attemptId,generation]);
    if(previous.rows.length){
      if(previous.rows[0]!.target_pool_id!==targetId||previous.rows[0]!.checkpoint_id!==input.checkpoint_id||previous.rows[0]!.reason_observation_id!==input.reason_observation_id)fail('IDEMPOTENCY_CONFLICT','Relocation identity was reused with different inputs');
      return{created:false,plan:previous.rows[0],admission_granted:false};
    }
    const rows=await c.query('SELECT a.*,s.pool_id,s.preparation_digest,p.profile_id FROM hyperfide.attempts a JOIN hyperfide.sandboxes s ON s.organisation_id=a.organisation_id AND s.id=a.sandbox_id JOIN hyperfide.provider_pools p ON p.organisation_id=s.organisation_id AND p.id=s.pool_id WHERE a.organisation_id=$1 AND a.run_id=$2 AND a.id=$3 FOR UPDATE OF a',[config.organisation_id,run,attemptId]);
    const old=rows.rows[0];
    if(!old||String(old.generation)!==generation||old.authority_epoch!==epoch||!['CURRENT','EXPIRED'].includes(old.compute_authority))fail('STALE_ATTEMPT','Relocation requires the exact current attempt identity');
    const activeRun=(await c.query('SELECT state,authority_epoch FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[config.organisation_id,run])).rows[0];
    if(activeRun?.state!=='RUNNING'||activeRun.authority_epoch!==epoch)fail('RUN_NOT_RUNNING','Current running authority epoch is required');
    if((await c.query("SELECT 1 FROM hyperfide.submission_custodies WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3 AND authority='ACTIVE'",[config.organisation_id,run,old.task_id])).rows.length)
      fail('ACTIVE_SUBMISSION_CUSTODY','Admitted submission custody prevents replacement compute');
    const reason=(await c.query('SELECT o.*,i.sandbox_id FROM hyperfide.provider_observations o JOIN hyperfide.provisioning_intents i ON i.organisation_id=o.organisation_id AND i.id=o.intent_id WHERE o.organisation_id=$1 AND o.id=$2',[config.organisation_id,uuid(input.reason_observation_id)])).rows[0];
    if(!reason||reason.sandbox_id!==old.sandbox_id||!['RATE_LIMIT','UNAVAILABLE','TIMEOUT'].includes(reason.observation?.outcome?.error?.code))
      fail('RELOCATION_REASON_UNVERIFIED','A recorded failure for the original sandbox is required');
    const {pool:target,scope}=await currentPool(c,config,targetId);
    if(targetId===old.pool_id)fail('RELOCATION_POOL_INVALID','Relocation requires a distinct compatible pool');
    const capacity=await poolCapacity(c,config,targetId) as {unknown_resource_capacity:boolean;dimensions:Array<{name:string;qualified:boolean}>};
    if(capacity.unknown_resource_capacity||!capacity.dimensions.find(d=>d.name==='SANDBOX')?.qualified)fail('TARGET_POOL_UNQUALIFIED','Target pool quota or resources are unqualified');
    const health=(await c.query('SELECT * FROM hyperfide.provider_pool_health WHERE organisation_id=$1 AND pool_id=$2',[config.organisation_id,targetId])).rows[0];
    if(health&&(health.failure_count>=policy.maximum_attempts||health.retry_after&&new Date(health.retry_after).getTime()>Date.now()))
      fail('PROVIDER_BACKOFF_ACTIVE','Target pool is partitioned, rate limited or exhausted its retry policy');
    const reachable=await c.query("SELECT id FROM hyperfide.provider_connectivity_probes WHERE organisation_id=$1 AND pool_id=$2 AND configuration_digest=$3 AND endpoints_digest=$4 AND status='PASS' AND expires_at>clock_timestamp() AND evidence_scope=$5 ORDER BY created_at DESC LIMIT 1",
      [config.organisation_id,targetId,scope.configuration_digest,digestDocument(policy.targets),policy.evidence_scope]);
    if(!reachable.rows.length)fail('TARGET_POOL_UNREACHABLE','Current authenticated endpoint qualification is required');
    let environmentEvidence:string|null=null;
    if(old.preparation_digest!==target.preparation_digest){
      if(!environmentVerifier||!old.profile_id||!target.profile_id)fail('ENVIRONMENT_COMPATIBILITY_UNVERIFIED','Cross-preparation relocation needs a trusted environment compatibility proof');
      const manifests=await c.query('SELECT id,content_digest,provider,runtime_platform,manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[config.organisation_id,[old.profile_id,target.profile_id]]);
      const source=manifests.rows.find(r=>r.id===old.profile_id),destination=manifests.rows.find(r=>r.id===target.profile_id);
      // Both published manifests must bind the exact running source and configured target preparations.
      if(!source||!destination||source.content_digest!==old.preparation_digest||destination.content_digest!==target.preparation_digest||
        source.manifest?.digest!==source.content_digest||destination.manifest?.digest!==destination.content_digest||
        destination.provider!==target.provider||source.runtime_platform!==destination.runtime_platform)
        fail('ENVIRONMENT_COMPATIBILITY_UNVERIFIED','Published preparation manifests do not bind the exact source and target environments');
      let compatibility:EnvironmentCompatibilityProof;
      try{compatibility=await environmentVerifier(source.manifest,destination.manifest);dg(compatibility.evidence_digest);}
      catch{fail('ENVIRONMENT_COMPATIBILITY_UNVERIFIED','Published preparation manifests failed validation');}
      if(compatibility.compatible!==true)fail('ENVIRONMENT_INCOMPATIBLE','Required source environment cannot be preserved');
      environmentEvidence=compatibility.evidence_digest;
    }
    const checkpoints=await c.query("SELECT p.*,a.digest AS artifact_digest FROM hyperfide.checkpoints p JOIN hyperfide.artifacts a ON a.organisation_id=p.organisation_id AND a.run_id=p.run_id AND a.id=p.artifact_id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.id=$3 AND p.attempt_id=$4 AND p.attempt_generation=$5 AND a.status='COMPLETE' AND p.support_level<>'UNSUPPORTED'",[config.organisation_id,run,uuid(input.checkpoint_id),attemptId,generation]);
    const checkpoint=checkpoints.rows[0];
    if(!checkpoint||checkpoint.input_packet_digest!==old.input_packet_digest)fail('CHECKPOINT_UNQUALIFIED','Complete checkpoint bound to the exact source packet is required');
    const count=(await c.query('SELECT count(*)::int AS n FROM hyperfide.provider_relocation_plans WHERE organisation_id=$1 AND run_id=$2 AND task_id=$3',[config.organisation_id,run,old.task_id])).rows[0]!.n;
    if(count>=policy.maximum_attempts)fail('RELOCATION_RETRIES_EXHAUSTED','Bounded relocation policy exhausted');
    const source={checkpoint_id:checkpoint.id,artifact_digest:checkpoint.artifact_digest,repository_id:checkpoint.repository_id,source_object_id:checkpoint.source_object_id,input_packet_digest:checkpoint.input_packet_digest,support_level:checkpoint.support_level};
    const id=randomUUID();
    await c.query('INSERT INTO hyperfide.provider_relocation_plans(organisation_id,run_id,id,task_id,old_attempt_id,old_attempt_generation,old_authority_epoch,source_manifest_digest,source_manifest,checkpoint_id,preparation_digest,target_pool_id,target_configuration_digest,reason_observation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [config.organisation_id,run,id,old.task_id,attemptId,generation,epoch,digestDocument(source),source,checkpoint.id,target.preparation_digest,targetId,scope.configuration_digest,input.reason_observation_id]);
    await c.query("UPDATE hyperfide.attempts SET compute_authority='REVOKED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[config.organisation_id,run,attemptId]);
    await c.query("UPDATE hyperfide.compute_leases SET state='REVOKED',state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND attempt_id=$3 AND state='ACTIVE'",[config.organisation_id,run,attemptId]);
    return{created:true,id,state:'PENDING_ADMISSION',source_manifest:source,source_manifest_digest:digestDocument(source),preparation_digest:target.preparation_digest,
      environment_compatibility_evidence_digest:environmentEvidence,
      old_compute_fenced:true,physical_termination_confirmed:false,old_capacity_released:false,fresh_enrollment_required:true,admission_granted:false};
  });
}
export interface ProviderIsolationReceipt {
 reference_key:string;operation_id:string;status:'ISOLATED'|'UNKNOWN';topology_digest:string;resource_identity_digest:string;
 observed_state:'DESTROYED'|'ABSENT'|'UNKNOWN';observed_at:string;expires_at:string;evidence_digest:string;
 evidence_scope:'LIVE_PROVIDER'|'COMPONENT_FIXTURE';
}
export interface ProviderIsolationBinding {
 schema_version:1;reference_key:string;operation_id:string;topology_digest:string;resource_identity_digest:string;
 destroy_operation:ProviderOperation<'destroy'>;authority_digest:string;custody_evidence_digest:string;custody_expires_at:string;
}
export interface ProviderIsolationState {binding:ProviderIsolationBinding;receipt:ProviderIsolationReceipt|null}
export interface ProviderIsolationJournal {
 read():Promise<ProviderIsolationState|null>;
 prepare(binding:ProviderIsolationBinding):Promise<{created:boolean;state:ProviderIsolationState}>;
 record(value:{binding:ProviderIsolationBinding;receipt:ProviderIsolationReceipt;observations:Array<{operation:ProviderOperation;outcome:ProviderOutcome}>}):Promise<void>;
}
export interface IsolationTarget {
 reference_key:string;scope:ProviderScope;resource:NonNullable<ProviderOperation['resource']>;boot_id:string;
 preparation_digest:string;resource_topology_digest:string;
}
interface IsolationConfiguration {
 schema_version:1;deployment_id:string;organisation_id:string;run_id:string;source_epoch:string|null;topology_digest:string;
 evidence_scope:'LIVE_PROVIDER'|'COMPONENT_FIXTURE';maximum_operation_ms:number;proof_max_age_ms:number;resources:IsolationTarget[];
}
async function isolationConfiguration(env:Readonly<NodeJS.ProcessEnv>):Promise<IsolationConfiguration>{
 const file=env.HYPERFIDE_WRITER_ISOLATION_CONFIG;if(!file?.startsWith('/'))fail('ISOLATION_CONFIG_REQUIRED','Protected writer topology configuration required');
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))fail('ISOLATION_CONFIG_INVALID','Writer topology must be bounded and owner-only');
 const c=obj(JSON.parse(await fs.readFile(file,'utf8')),['schema_version','deployment_id','organisation_id','run_id','source_epoch','topology_digest','evidence_scope','maximum_operation_ms','proof_max_age_ms','resources']);
 if(c.schema_version!==1||!['LIVE_PROVIDER','COMPONENT_FIXTURE'].includes(String(c.evidence_scope)))fail('ISOLATION_CONFIG_INVALID','Invalid isolation schema/evidence scope');
 uuid(c.deployment_id);uuid(c.organisation_id);uuid(c.run_id);if(c.source_epoch!==null)uuid(c.source_epoch);dg(c.topology_digest);
 for(const k of ['maximum_operation_ms','proof_max_age_ms'])if(!Number.isSafeInteger(c[k])||(c[k] as number)<100||(c[k] as number)>30000)fail('ISOLATION_CONFIG_INVALID','Isolation deadline/evidence lifetime must be bounded to30seconds');
 if(!Array.isArray(c.resources)||!c.resources.length||c.resources.length>10000)fail('ISOLATION_CONFIG_INVALID','Explicit writer resources required');
 const names=new Set<string>();
 for(const raw of c.resources){
  const r=obj(raw,['reference_key','scope','resource','boot_id','preparation_digest','resource_topology_digest']),key=str(r.reference_key,128);
  if(names.has(key))fail('ISOLATION_CONFIG_INVALID','Duplicate writer resource');names.add(key);uuid(r.boot_id);dg(r.preparation_digest);dg(r.resource_topology_digest);
  const scope=obj(r.scope);if(scope.organisation_id!==c.organisation_id)fail('ISOLATION_CONFIG_INVALID','Writer belongs to another deployment organisation');
 }
 return c as unknown as IsolationConfiguration;
}
function isolationOperation<K extends 'destroy'|'observe'>(kind:K,target:IsolationTarget,id:string,deadline:string,correlation:string):ProviderOperation<K>{
 const base={schema_version:1 as const,kind,scope:target.scope,deadline_at:deadline,resource:target.resource,preparation_digest:target.preparation_digest,
  parameters:kind==='destroy'?{reason:'Authenticated external writer isolation'}:{},
  identity:{operation_id:id,idempotency_key:id,payload_digest:'',correlation_id:correlation,causation_id:correlation}};
 base.identity.payload_digest=operationPayloadDigest(base as ProviderOperation);return validateProviderOperation(base) as ProviderOperation<K>;
}
function unknownIsolationOutcome(op:ProviderOperation):ProviderOutcome {
 return{schema_version:1,status:'UNKNOWN',acceptance:'UNKNOWN',operation_id:op.identity.operation_id,payload_digest:op.identity.payload_digest,
  scope:op.scope,observed_at:new Date().toISOString(),provider_request_id:null,resource:op.resource,result:null,
  error:{code:'UNAVAILABLE',provider_code:null,message:'Physical resource isolation is not confirmed',retry_after_ms:null},reconcile_required:true,retry:'AFTER_RECONCILIATION'};
}
export interface ProviderIsolationCustodyProof {
 operation_id:string;resource_identity_digest:string;evidence_digest:string;observed_at:string;expires_at:string;
}
export type ProviderIsolationCustodyPreflight=(target:Readonly<IsolationTarget>,operationId:string,authority:unknown,signal:AbortSignal)=>Promise<ProviderIsolationCustodyProof|null>;
export interface ProviderIsolationRuntime {
 destructionPreflight?:ProviderIsolationCustodyPreflight;
 env:Readonly<NodeJS.ProcessEnv>;signal:AbortSignal;registry:Map<string,ProviderIsolationFactory>;gateway?:Pick<TransactionGateway,'withPrimaryTransaction'>;
}
export function createProviderIsolation(runtime:ProviderIsolationRuntime){
 return async(referenceKey:string,operationId:string,authority:unknown,signal:AbortSignal,journal:ProviderIsolationJournal):Promise<ProviderIsolationReceipt>=>{
  str(referenceKey,128);uuid(operationId);
  const config=await isolationConfiguration(runtime.env),target=config.resources.find(r=>r.reference_key===referenceKey);
  if(!target)fail('ISOLATION_SCOPE_DENIED','Writer resource is not in protected deployment topology');
  const resourceDigest=digestDocument({scope:target.scope,resource:target.resource,boot_id:target.boot_id,preparation_digest:target.preparation_digest});
  let authorityDigest:string,authorityExpiry:string,revalidateAuthority:()=>Promise<void>;
  const permitModule=identityCredentials as unknown as Record<string,unknown>;
  if(typeof permitModule.isVerifiedIsolationPermit==='function'&&(permitModule.isVerifiedIsolationPermit as (v:unknown)=>boolean)(authority)){
   if(typeof permitModule.assertIsolationPermit!=='function')fail('ISOLATION_AUTHORITY_UNAVAILABLE','Actual isolation permit verifier unavailable');
   const expected={operation_id:operationId,organisation_id:config.organisation_id,run_id:config.run_id,deployment_id:config.deployment_id,source_epoch:config.source_epoch,topology_digest:config.topology_digest,resource_reference:referenceKey,resource_topology_digest:target.resource_topology_digest};
   (permitModule.assertIsolationPermit as (v:unknown,e:unknown)=>void)(authority,expected);
   revalidateAuthority=async()=>{(permitModule.assertIsolationPermit as (v:unknown,e:unknown)=>void)(authority,expected);};
   const verified=authority as {permit_digest:string;expires_at:string};authorityDigest=dg(verified.permit_digest);authorityExpiry=utc(verified.expires_at);
  }else{
   assertInvocation(authority);const invocation=authority as InvocationContext;
   if(invocation.principal.organisation_id!==config.organisation_id||invocation.principal.run_id!==config.run_id||!['OPERATOR','COORDINATOR','PROVISIONER'].includes(invocation.principal.role))
    fail('ISOLATION_SCOPE_DENIED','Actual principal cannot isolate configured writers');
   // Ordinary requests retain current-primary authority. The separate actual14
   // permit path is the only outage mechanism and never grants a new epoch.
   if(!runtime.gateway)fail('ISOLATION_AUTHORITY_UNAVAILABLE','Normal authority requires actual primary gateway');
   revalidateAuthority=async()=>{await runtime.gateway!.withPrimaryTransaction({timeoutMs:5000,signal,guard:tx=>invocation.guard(tx)},async()=>{});};
   await revalidateAuthority();
   authorityDigest=dg(invocation.operation.payload_digest);authorityExpiry=utc(invocation.principal.expires_at);
  }
  if(Date.parse(authorityExpiry)<=Date.now())fail('AUTH_EXPIRED','Isolation authority expired');
  if(!journal||typeof journal.read!=='function'||typeof journal.prepare!=='function'||typeof journal.record!=='function')fail('ISOLATION_JOURNAL_REQUIRED','Durable external custody is required');
  const deadline=Math.min(Date.now()+config.maximum_operation_ms,Date.parse(authorityExpiry));
  const prior=await journal.read();let state:ProviderIsolationState,first=false;
  if(prior)state=prior;
  else{
   // Destructive outage fencing still preserves required workspace/artifact custody.
   // The trusted caller must obtain an actual, resource-bound retained-custody proof;
   // topology metadata and an isolation permit alone never authorise data loss.
   if(!runtime.destructionPreflight)fail('DESTRUCTION_PREFLIGHT_UNAVAILABLE','Actual retained-custody proof required before destructive isolation');
   const proof=await boundedEffect(runtime.destructionPreflight(target,operationId,authority,signal),signal,deadline);
   if(!proof||proof.operation_id!==operationId||proof.resource_identity_digest!==resourceDigest||Date.parse(utc(proof.observed_at))>Date.now()||Date.now()-Date.parse(proof.observed_at)>config.proof_max_age_ms||Date.parse(utc(proof.expires_at))<=Date.now())fail('DESTRUCTION_CUSTODY_UNPROVEN','Fresh retained-custody proof must bind this exact resource and isolation operation');
   const custodyDigest=dg(proof.evidence_digest);
   const binding:ProviderIsolationBinding={schema_version:1,reference_key:referenceKey,operation_id:operationId,topology_digest:config.topology_digest,resource_identity_digest:resourceDigest,
    destroy_operation:isolationOperation('destroy',target,operationId,new Date(deadline).toISOString(),operationId),authority_digest:authorityDigest,custody_evidence_digest:custodyDigest,custody_expires_at:proof.expires_at};
   const claimed=await journal.prepare(binding);state=claimed.state;first=claimed.created;
  }
  const binding=state.binding;
  if(binding.schema_version!==1||binding.reference_key!==referenceKey||binding.operation_id!==operationId||binding.topology_digest!==config.topology_digest||binding.resource_identity_digest!==resourceDigest||binding.authority_digest!==authorityDigest)
   fail('ISOLATION_JOURNAL_CONFLICT','Durable operation/source authority differs from protected topology');
  dg(binding.custody_evidence_digest);utc(binding.custody_expires_at);
  const destroy=validateProviderOperation(binding.destroy_operation);
  if(destroy.kind!=='destroy'||destroy.identity.operation_id!==operationId||digestDocument(destroy.scope)!==digestDocument(target.scope)||digestDocument(destroy.resource)!==digestDocument(target.resource)||destroy.preparation_digest!==target.preparation_digest)
   fail('ISOLATION_JOURNAL_CONFLICT','Journal resource operation binding changed');
  const observations:Array<{operation:ProviderOperation;outcome:ProviderOutcome}>=[],seen=new Set<string>();
  const add=(op:ProviderOperation,outcome:ProviderOutcome)=>{
   validateProviderOutcome({operation:op,outcome});const digest=digestDocument({operation:op,outcome});if(seen.has(digest))return;
   if(observations.length>=8)fail('ISOLATION_EVIDENCE_LIMIT','Bounded provider observations exceeded');seen.add(digest);observations.push({operation:op,outcome});
  };
  const receipt=(observed:ProviderOutcome|null):ProviderIsolationReceipt=>{
   const now=Date.now(),at=observed?Date.parse(observed.observed_at):now;
   const fact=observed?.status==='SUCCEEDED'&&observed.acceptance==='CONFIRMED_ACCEPTED'&&'provider_state' in observed.result&&observed.result.provider_state==='DESTROYED'&&'health' in observed.result&&observed.result.health==='ABSENT'&&at<=now&&now-at<config.proof_max_age_ms;
   const end=Math.min((fact?at:now)+config.proof_max_age_ms,Date.parse(authorityExpiry));
   const result={reference_key:referenceKey,operation_id:operationId,status:fact&&end>now?'ISOLATED' as const:'UNKNOWN' as const,topology_digest:config.topology_digest,resource_identity_digest:resourceDigest,
    observed_state:fact?'ABSENT' as const:'UNKNOWN' as const,observed_at:new Date(fact?at:now).toISOString(),expires_at:new Date(end).toISOString(),evidence_scope:config.evidence_scope};
   return{...result,evidence_digest:digestDocument({binding,observations,result})};
  };
  const factory=runtime.registry.get(target.scope.provider);
  if(!factory){const result=receipt(null);await journal.record({binding,receipt:result,observations});return result;}
  const combined=AbortSignal.any([signal,runtime.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))]);
  let transport:Awaited<ReturnType<typeof factory>>;
  const withinDeadline=()=>{if(combined.aborted||Date.now()>=deadline)fail('PROVIDER_TIMEOUT','Isolation budget expired before provider call');};
  try{withinDeadline();transport=await boundedEffect(Promise.resolve(factory(target.scope)),combined,deadline);}
  catch{const result=receipt(null);await journal.record({binding,receipt:result,observations});return result;}
  if(typeof transport.destroy!=='function'||typeof transport.observe!=='function')fail('ISOLATION_TRANSPORT_INVALID','Actual typed admin transport required');
  if(first){
   let outcome:ProviderOutcome;
   try{withinDeadline();await revalidateAuthority();withinDeadline();if(Date.parse(binding.custody_expires_at)<=Date.now())fail('DESTRUCTION_CUSTODY_STALE','Custody proof expired before destructive effect');outcome=await boundedEffect(transport.destroy(destroy as ProviderOperation<'destroy'>,combined),combined,deadline);}
   catch{outcome=unknownIsolationOutcome(destroy);}
   add(destroy,outcome);await journal.record({binding,receipt:receipt(null),observations:[...observations]});
  }
  // Never infer absence from accepted deletion, list omission or a cached proof.
  const observe=isolationOperation('observe',target,randomUUID(),new Date(deadline).toISOString(),operationId);
  let observed:ProviderOutcome;
  try{withinDeadline();observed=await boundedEffect(transport.observe(observe,combined),combined,deadline);await revalidateAuthority();}
  catch{observed=unknownIsolationOutcome(observe);}
  add(observe,observed);const result=receipt(observed);await journal.record({binding,receipt:result,observations});return result;
 };
}
export interface ProviderWriterObservation {
 reference_key:string;operation_id:string;status:'OBSERVED'|'UNKNOWN';observed_state:'ABSENT'|'PRESENT'|'UNKNOWN';
 topology_digest:string;resource_identity_digest:string;observed_at:string;expires_at:string;evidence_digest:string;
 evidence_scope:'LIVE_PROVIDER'|'COMPONENT_FIXTURE';authority:'OBSERVATION_ONLY';
}
export interface ProviderIsolationObservationJournal {
 read():Promise<ProviderIsolationState|null>;
 recordObservation(value:{binding:ProviderIsolationBinding;observation:ProviderWriterObservation;
  provider_observation:{operation:ProviderOperation<'observe'>;outcome:ProviderOutcome<'observe'>};
  authorization_digest:string;authorization_expires_at:string}):Promise<void>;
}
export interface ProviderIsolationObserverRuntime {
 env:Readonly<NodeJS.ProcessEnv>;signal:AbortSignal;
 registry:Map<string,(scope:ProviderScope)=>Pick<Awaited<ReturnType<ProviderIsolationFactory>>,'observe'>|Promise<Pick<Awaited<ReturnType<ProviderIsolationFactory>>,'observe'>>>;
}
/** A distinct, non-mutating observation route. It cannot prepare an operation,
 * obtain destroy(), renew destructive authority, or return an activation receipt. */
export function createProviderIsolationObserver(runtime:ProviderIsolationObserverRuntime){
 return async(referenceKey:string,operationId:string,authority:unknown,signal:AbortSignal,journal:ProviderIsolationObservationJournal):Promise<ProviderWriterObservation>=>{
  str(referenceKey,128);uuid(operationId);
  const config=await isolationConfiguration(runtime.env),target=config.resources.find(r=>r.reference_key===referenceKey);
  if(!target)fail('ISOLATION_SCOPE_DENIED','Observed resource is not in protected deployment topology');
  const expected={operation_id:operationId,organisation_id:config.organisation_id,run_id:config.run_id,deployment_id:config.deployment_id,
   source_epoch:config.source_epoch,topology_digest:config.topology_digest,resource_reference:referenceKey,resource_topology_digest:target.resource_topology_digest};
  const module=identityCredentials as unknown as Record<string,unknown>,assert=module.assertWriterObservationPermit;
  if(typeof assert!=='function')fail('OBSERVATION_AUTHORITY_UNAVAILABLE','Actual observation-only permit primitive unavailable');
  const authorise=()=>{(assert as (v:unknown,e:unknown)=>void)(authority,expected);};
  authorise();
  const proof=authority as {permit_digest:string;expires_at:string},authorizationDigest=dg(proof.permit_digest),authorizationExpiry=utc(proof.expires_at);
  if(!journal||typeof journal.read!=='function'||typeof journal.recordObservation!=='function')fail('ISOLATION_JOURNAL_REQUIRED','Existing durable operation and observation journal required');
  const state=await journal.read();
  if(!state)fail('ISOLATION_OPERATION_UNKNOWN','Observation cannot prepare a new isolation operation');
  const binding=state.binding,resourceDigest=digestDocument({scope:target.scope,resource:target.resource,boot_id:target.boot_id,preparation_digest:target.preparation_digest});
  if(binding.schema_version!==1||binding.reference_key!==referenceKey||binding.operation_id!==operationId||binding.topology_digest!==config.topology_digest||binding.resource_identity_digest!==resourceDigest)
   fail('ISOLATION_JOURNAL_CONFLICT','Observation must retain the original immutable resource operation');
  dg(binding.authority_digest);dg(binding.custody_evidence_digest);utc(binding.custody_expires_at);
  const original=validateProviderOperation(binding.destroy_operation);
  if(original.kind!=='destroy'||original.identity.operation_id!==operationId||digestDocument(original.scope)!==digestDocument(target.scope)||digestDocument(original.resource)!==digestDocument(target.resource)||original.preparation_digest!==target.preparation_digest)
   fail('ISOLATION_JOURNAL_CONFLICT','Original resource identity changed');
  const deadline=Math.min(Date.now()+config.maximum_operation_ms,Date.parse(authorizationExpiry));
  if(deadline<=Date.now()||signal.aborted||runtime.signal.aborted)fail('AUTH_EXPIRED','Observation authority or request expired');
  const combined=AbortSignal.any([signal,runtime.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))]);
  const operation=isolationOperation('observe',target,randomUUID(),new Date(deadline).toISOString(),operationId);
  let outcome=unknownIsolationOutcome(operation) as ProviderOutcome<'observe'>;
  const factory=runtime.registry.get(target.scope.provider);
  if(factory){
   try{
    authorise();if(combined.aborted||Date.now()>=deadline)fail('PROVIDER_TIMEOUT','Observation deadline expired before provider call');
    const backend=await boundedEffect(Promise.resolve(factory(target.scope)),combined,deadline);
    // Capture only this read capability. Destruction and journal preparation
    // are absent from the observer's interface and implementation.
    const observe=backend.observe.bind(backend);
    authorise();if(combined.aborted||Date.now()>=deadline)fail('PROVIDER_TIMEOUT','Observation deadline expired before provider call');
    const measured=await boundedEffect(observe(operation,combined),combined,deadline);
    validateProviderOutcome({operation,outcome:measured});authorise();outcome=measured;
   }catch{outcome=unknownIsolationOutcome(operation) as ProviderOutcome<'observe'>;}
  }
  const now=Date.now(),at=Date.parse(outcome.observed_at);
  const fresh=outcome.status==='SUCCEEDED'&&outcome.acceptance==='CONFIRMED_ACCEPTED'&&at<=now&&now-at<config.proof_max_age_ms&&Date.parse(authorizationExpiry)>now;
  const absence=fresh&&outcome.status==='SUCCEEDED'&&outcome.result.provider_state==='DESTROYED'&&outcome.result.health==='ABSENT';
  const present=fresh&&outcome.status==='SUCCEEDED'&&outcome.result.provider_state!=='DESTROYED'&&outcome.result.provider_state!=='UNKNOWN'&&outcome.result.health!=='ABSENT';
  const observed={reference_key:referenceKey,operation_id:operationId,status:absence||present?'OBSERVED' as const:'UNKNOWN' as const,
   observed_state:absence?'ABSENT' as const:present?'PRESENT' as const:'UNKNOWN' as const,topology_digest:config.topology_digest,
   resource_identity_digest:resourceDigest,observed_at:new Date(fresh?at:now).toISOString(),
   expires_at:new Date(Math.min((fresh?at:now)+config.proof_max_age_ms,Date.parse(authorizationExpiry))).toISOString(),
   evidence_scope:config.evidence_scope,authority:'OBSERVATION_ONLY' as const};
  const observation={...observed,evidence_digest:digestDocument({binding,authorization_digest:authorizationDigest,operation,outcome,observation:observed})};
  await journal.recordObservation({binding,observation,provider_observation:{operation,outcome},authorization_digest:authorizationDigest,authorization_expires_at:authorizationExpiry});
  return observation;
 };
}

export function createComponent(context:ComponentContext):Component{
  const database=providerDatabase(context);
  const guarded=(fn:(i:unknown,c:DeploymentConfig,p:ConnectivityConfig,database:ProviderDatabase)=>Promise<unknown>)=>async(input:unknown,requestContext:ComponentContext)=>{
    if(context.signal.aborted)fail('PROVIDER_CLOSED','Provider placement is shutting down');
    const config=await readDeployment(context.env);return fn(input,config,await connectivity(context.env),bindProviderInvocation(database,config,invocationOf(requestContext),['PROVISIONER','COORDINATOR','OPERATOR']));
  };
  return{apiVersion:1,capabilities:{'provider.observation.v1':{observeConfiguredResource:createProviderIsolationObserver({env:context.env,signal:context.signal,registry:database.runtime.isolation})},'provider.isolation.v1':{isolateConfiguredResource:createProviderIsolation({env:context.env,signal:context.signal,registry:database.runtime.isolation,gateway:database.gateway})}},actions:{
    'provider.placement.record-failure':guarded((i,c,p,database)=>recordPoolFailure(database,c,p,i)),
    'provider.relocation.plan':guarded((i,c,p,database)=>planRelocation(database,c,p,i,preparationCompatibilityVerifier)),
    'provider.relocation.confirm-enrollment':guarded(async(input,c,p,database)=>{
      const i=obj(input,['run_id','plan_id','sandbox_id']),run=uuid(i.run_id),planId=uuid(i.plan_id),sandboxId=uuid(i.sandbox_id);assertInvocationRun(database,run);
      return transaction(database,async tx=>{
       const plan=(await tx.query('SELECT * FROM hyperfide.provider_relocation_plans WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[c.organisation_id,run,planId])).rows[0];
       if(!plan||!['PENDING_ADMISSION','ENROLLED'].includes(plan.state))fail('RELOCATION_PLAN_INVALID','An unadmitted relocation plan is required');
       if(plan.old_authority_epoch!==providerInvocation(database).principal.deployment_epoch)fail('RELOCATION_PLAN_STALE','Relocation belongs to a different admitted authority epoch');
       const {scope}=await currentPool(tx,c,plan.target_pool_id);
       if(scope.configuration_digest!==plan.target_configuration_digest)fail('RELOCATION_CONFIG_CHANGED','Target configuration changed since planning');
       const sandbox=(await tx.query("SELECT * FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND pool_id=$3 AND desired_state='RUNNING' AND observed_state='RUNNING' AND preparation_digest=$4 FOR SHARE",[c.organisation_id,sandboxId,plan.target_pool_id,plan.preparation_digest])).rows[0];
       if(!sandbox)fail('RELOCATION_RESOURCE_INVALID','Exact target environment and current sandbox identity are required');
       if(plan.state==='ENROLLED'&&(plan.enrolled_sandbox_id!==sandboxId||String(plan.enrolled_boot_generation)!==String(sandbox.boot_generation)))fail('RELOCATION_ENROLLMENT_CONFLICT','Existing enrollment cannot change resource or boot');
       const proof=await verifyEnrollmentInTx(tx,database,c,plan.target_pool_id,sandbox,run,p.proof_max_age_ms,identityPlacementDependencies(context));
       await tx.query("UPDATE hyperfide.provider_relocation_plans SET state='ENROLLED',enrolled_sandbox_id=$4,enrolled_boot_generation=$5,enrollment_evidence_digest=$6 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state IN ('PENDING_ADMISSION','ENROLLED')",[c.organisation_id,run,planId,sandboxId,sandbox.boot_generation,proof.evidence_digest]);
       return{id:planId,state:'ENROLLED',fresh_enrollment_required:true,admission_granted:false};
      });
    }),
  }};
}

/** This deployment entry requires actual native-worker signing/artifact
 * prerequisites. Metadata-only deployments never advertise physical probes. */
export function createProbeComponent(context:ComponentContext):Component{
 const database=providerDatabase(context),dependencies=placementDependencies(context);
 const availability=Object.freeze({component:'8.4-probe' as const,state:'CONFIGURED' as const});
 if(database.runtime.connectivityProbe)fail('PROVIDER_REGISTRATION_CONFLICT','Connectivity probe component already configured');
 database.runtime.connectivityProbe=availability;
 return{apiVersion:1,close:()=>{if(database.runtime.connectivityProbe===availability)delete database.runtime.connectivityProbe;},actions:{
  'provider.placement.probe':async(input,requestContext)=>{
   const config=await readDeployment(context.env),policy=await connectivity(context.env);
   return probePool(bindProviderInvocation(database,config,invocationOf(requestContext),['PROVISIONER']),config,policy,input,context.signal,()=>dependencies);
  }
 }};
}
