import fs from 'node:fs/promises';
import {randomUUID,randomInt} from 'node:crypto';
import type pg from 'pg';
import type {Component,ComponentContext} from '../components/registry.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {operationPayloadDigest,validateProviderOutcome} from './contract.js';
import type {ProviderOperation,ProviderScope,ProviderOutcome} from './contract.js';
import {providerDatabase,obj,str,uuid,dec,dg,utc,fail,readDeployment,currentPool,configuredScope,transaction,digestDocument,providerAdapter,poolCapacity} from './pools.js';
import type {ProviderDatabase,DeploymentConfig} from './pools.js';

export interface FreshEnrollmentRequest {
  organisation_id:string;run_id:string;pool_id:string;sandbox_id:string;sandbox_boot_generation:string;nonce:string;
}
export interface FreshEnrollmentProof {
  enrolled:boolean;nonce:string;boot_id:string;credential_lineage:string;verified_at:string;evidence_digest:string;
}
export type EnrollmentVerifier=(request:FreshEnrollmentRequest,signal:AbortSignal)=>Promise<FreshEnrollmentProof>;
export interface EnvironmentCompatibilityProof {compatible:boolean;evidence_digest:string}
export type EnvironmentCompatibilityVerifier=(source:unknown,target:unknown)=>Promise<EnvironmentCompatibilityProof>;
let enrollmentVerifier:EnrollmentVerifier|undefined,environmentVerifier:EnvironmentCompatibilityVerifier|undefined;
export function registerProviderEnrollmentVerifier(verifier:EnrollmentVerifier):()=>void{
  if(enrollmentVerifier||typeof verifier!=='function')fail('PROVIDER_REGISTRATION_CONFLICT','Enrollment verifier must be installed once by trusted startup');
  enrollmentVerifier=verifier;return()=>{if(enrollmentVerifier===verifier)enrollmentVerifier=undefined;};
}
export function registerEnvironmentCompatibilityVerifier(verifier:EnvironmentCompatibilityVerifier):()=>void{
  if(environmentVerifier||typeof verifier!=='function')fail('PROVIDER_REGISTRATION_CONFLICT','Environment verifier must be installed once by trusted startup');
  environmentVerifier=verifier;return()=>{if(environmentVerifier===verifier)environmentVerifier=undefined;};
}
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
async function verifyEnrollment(config:DeploymentConfig,poolId:string,sandbox:Record<string,any>,runId:string,signal:AbortSignal,maxAge:number):Promise<FreshEnrollmentProof>{
  if(!enrollmentVerifier)fail('ENROLLMENT_VERIFIER_UNAVAILABLE','Fresh authenticated enrollment verification is required');
  const nonce=randomUUID(),request={organisation_id:config.organisation_id,run_id:runId,pool_id:poolId,sandbox_id:sandbox.id,sandbox_boot_generation:String(sandbox.boot_generation),nonce};
  const proof=await enrollmentVerifier(request,signal);
  if(!proof.enrolled||proof.nonce!==nonce||!proof.boot_id||!proof.credential_lineage)fail('ENROLLMENT_UNVERIFIED','Enrollment proof does not bind this fresh challenge');
  uuid(proof.boot_id);str(proof.credential_lineage);dg(proof.evidence_digest);utc(proof.verified_at);
  if(Date.parse(proof.verified_at)>Date.now()||Date.now()-Date.parse(proof.verified_at)>maxAge)fail('ENROLLMENT_STALE','Enrollment proof is stale');
  return proof;
}
export async function probePool(pool:ProviderDatabase,config:DeploymentConfig,policy:ConnectivityConfig,value:unknown,signal:AbortSignal):Promise<unknown>{
  const input=obj(value,['pool_id','sandbox_id','run_id']),poolId=uuid(input.pool_id),sandboxId=uuid(input.sandbox_id),runId=uuid(input.run_id);
  const {scope}=await currentPool(pool,config,poolId);
  const rows=await pool.query("SELECT * FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND pool_id=$3 AND observed_state='RUNNING'",[config.organisation_id,sandboxId,poolId]);
  const sandbox=rows.rows[0];if(!sandbox?.native_sandbox_id)fail('POOL_PROBE_UNAVAILABLE','An identified running sandbox is required');
  const proof=await verifyEnrollment(config,poolId,sandbox,runId,signal,policy.proof_max_age_ms),id=randomUUID(),nonce=randomUUID();
  const env:Record<string,string>={},targets=policy.targets.map((target,index)=>{
    const name='HYPERFIDE_PROBE_CREDENTIAL_'+index;env[name]=target.credential_ref;
    return {...target,env:name,credential_ref:undefined};
  });
  const duration=Math.min(config.maximum_operation_ms,policy.timeout_ms*8+1000);
  const base={schema_version:1 as const,kind:'execute' as const,scope,deadline_at:new Date(Date.now()+duration).toISOString(),
    resource:{native_sandbox_id:sandbox.native_sandbox_id,sandbox_boot_generation:String(sandbox.boot_generation)},preparation_digest:sandbox.preparation_digest,
    parameters:{argv:['node','--input-type=commonjs','-e',probeProgram,JSON.stringify({nonce,targets,timeout_ms:policy.timeout_ms})],
      cwd:'/',env_refs:env,stdin:false,durable:false,process_timeout_ms:duration,wait_timeout_ms:duration},
    identity:{operation_id:id,idempotency_key:id,payload_digest:'',correlation_id:id,causation_id:id}};
  base.identity.payload_digest=operationPayloadDigest(base);
  // Persist possible delivery before any SDK call. Only the final verified
  // receipt can promote this row to PASS; journal callbacks never grant it.
  const initialDigest=digestDocument({operation:base,enrollment:proof});
  await transaction(pool,async c=>{
   await currentPool(c,config,poolId);
   await c.query('INSERT INTO hyperfide.provider_connectivity_probes(organisation_id,id,pool_id,sandbox_id,boot_generation,configuration_digest,endpoints_digest,credential_lineage,enrollment_evidence_digest,evidence_digest,evidence_scope,status,observation,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'UNKNOWN\',$12,$13)',
    [config.organisation_id,id,poolId,sandboxId,sandbox.boot_generation,scope.configuration_digest,digestDocument(policy.targets),proof.credential_lineage,proof.evidence_digest,initialDigest,policy.evidence_scope,{operation:base,outcome:null},new Date(Date.now()+policy.proof_max_age_ms).toISOString()]);
  });
  const unavailable=async()=>fail('PROVIDER_HOOK_UNAVAILABLE','Connectivity execution cannot create provisioning resources');
  const journal=async(op:ProviderOperation,outcome:ProviderOutcome)=>{
   validateProviderOutcome({operation:op,outcome});
   if(digestDocument(op)!==digestDocument(base))fail('OBSERVATION_SCOPE_MISMATCH','Connectivity observation differs from persisted command');
   await pool.query("UPDATE hyperfide.provider_connectivity_probes SET observation=$3,evidence_digest=$4 WHERE organisation_id=$1 AND id=$2 AND status='UNKNOWN'",
    [config.organisation_id,id,{operation:base,outcome},digestDocument({operation:base,outcome,enrollment:proof})]);
  };
  const adapter=providerAdapter(scope,{assignedBootGeneration:unavailable,persistEarlyResource:unavailable,recordObservation:journal},pool.runtime) as ReturnType<typeof providerAdapter>&{
   readCapturedOutput?:(scope:ProviderScope,resource:NonNullable<ProviderOperation['resource']>,processRef:string,maxBytes:number)=>Promise<{stdout:Uint8Array;stderr:Uint8Array;exit_code:number;complete:true;spool_digest:string}>;
  };
  if(typeof adapter.readCapturedOutput!=='function')fail('REMOTE_CAPTURE_UNAVAILABLE','Actual bounded probe receipt bytes are required');
  const combined=AbortSignal.any([signal,AbortSignal.timeout(duration)]),limit=Date.parse(base.deadline_at);
  const outcome=await boundedEffect(adapter.execute(base,combined),combined,limit);await journal(base,outcome);
  validateProviderOutcome({operation:base,outcome});
  const result=outcome.status==='SUCCEEDED'?outcome.result:null;
  let pass=outcome.status==='SUCCEEDED'&&result?.phase==='EXITED'&&result.exit_code===0&&!result.timed_out&&result.output.complete&&!result.output.truncated&&result.output.sha256!==null;
  let receipt:unknown=null;
  if(pass&&result){
   const captured=await boundedEffect(adapter.readCapturedOutput(scope,base.resource,result.process_ref,65536),combined,limit);
   if(captured.complete!==true||captured.exit_code!==0||captured.stdout.byteLength>65536||captured.stderr.byteLength!==0)pass=false;
   else{
    try{
     receipt=JSON.parse(Buffer.from(captured.stdout).toString('utf8'));const r=obj(receipt,['nonce','results']);
     if(r.nonce!==nonce||!Array.isArray(r.results)||r.results.length!==policy.targets.length)pass=false;
     else for(let n=0;n<policy.targets.length;n++){
      const observed=obj(r.results[n],['name','denied_status','status','body_sha256']),target=policy.targets[n]!;
      if(observed.name!==target.name||observed.status!==target.expected_status||!target.denied_statuses.includes(observed.denied_status as number)||
       (target.expected_body_sha256&&observed.body_sha256!==target.expected_body_sha256))pass=false;
      dg(observed.body_sha256);
     }
    }catch{pass=false;}
   }
  }
  const digest=digestDocument({operation:base,outcome,enrollment:proof,receipt}),status=pass?'PASS':outcome.status==='UNKNOWN'?'UNKNOWN':'FAIL';
  await transaction(pool,async c=>{
    await currentPool(c,config,poolId);
    const current=await c.query('SELECT boot_generation,native_sandbox_id FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 FOR SHARE',[config.organisation_id,sandboxId]);
    if(String(current.rows[0]?.boot_generation)!==String(sandbox.boot_generation)||current.rows[0]?.native_sandbox_id!==sandbox.native_sandbox_id)
      fail('STALE_SANDBOX_GENERATION','Sandbox identity changed during connectivity probing');
    await c.query('UPDATE hyperfide.provider_connectivity_probes SET evidence_digest=$3,status=$4,observation=$5 WHERE organisation_id=$1 AND id=$2',
     [config.organisation_id,id,digest,status,{operation:base,outcome,receipt}]);
    if(pass)await c.query("INSERT INTO hyperfide.provider_pool_health(organisation_id,pool_id) VALUES($1,$2) ON CONFLICT(organisation_id,pool_id) DO UPDATE SET failure_count=0,state='CLOSED',retry_after=NULL,state_version=hyperfide.provider_pool_health.state_version+1",[config.organisation_id,poolId]);
  });
  return{id,status,evidence_digest:digest,evidence_scope:policy.evidence_scope,live_pool_qualified:pass&&policy.evidence_scope==='LIVE_POOL',admission_granted:false};
}
export async function recordPoolFailure(pool:ProviderDatabase,config:DeploymentConfig,policy:ConnectivityConfig,value:unknown):Promise<unknown>{
  const input=obj(value,['observation_id']),observationId=uuid(input.observation_id);
  return transaction(pool,async c=>{
    const rows=await c.query('SELECT o.*,i.pool_id FROM hyperfide.provider_observations o JOIN hyperfide.provisioning_intents i ON i.organisation_id=o.organisation_id AND i.id=o.intent_id WHERE o.organisation_id=$1 AND o.id=$2',[config.organisation_id,observationId]);
    const row=rows.rows[0],code=row?.observation?.outcome?.error?.code;
    if(!row||!['RATE_LIMIT','UNAVAILABLE','TIMEOUT'].includes(code))fail('PROVIDER_FAILURE_UNVERIFIED','A recorded provider rate-limit or partition observation is required');
    await currentPool(c,config,row.pool_id);
    await c.query("INSERT INTO hyperfide.provider_pool_health(organisation_id,pool_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[config.organisation_id,row.pool_id]);
    const health=(await c.query('SELECT * FROM hyperfide.provider_pool_health WHERE organisation_id=$1 AND pool_id=$2 FOR UPDATE',[config.organisation_id,row.pool_id])).rows[0];
    if(!health)fail('POOL_HEALTH_UNKNOWN','Pool health row disappeared');
    const count=health.failure_count+1,delay=Math.min(policy.max_backoff_ms,policy.base_backoff_ms*2**Math.min(16,count-1)+randomInt(policy.base_backoff_ms));
    const retry=new Date(Date.now()+delay).toISOString();
    await c.query("UPDATE hyperfide.provider_pool_health SET failure_count=$3,state='OPEN',retry_after=$4,last_outcome_digest=$5,state_version=state_version+1 WHERE organisation_id=$1 AND pool_id=$2",[config.organisation_id,row.pool_id,count,retry,row.evidence_digest]);
    return{pool_id:row.pool_id,retry_after:retry,maximum_attempts:policy.maximum_attempts,automatic_retry_allowed:count<policy.maximum_attempts,reconciliation_required:row.observation.outcome.status==='UNKNOWN'};
  });
}
export async function planRelocation(pool:ProviderDatabase,config:DeploymentConfig,policy:ConnectivityConfig,value:unknown):Promise<unknown>{
  const input=obj(value,['run_id','old_attempt_id','expected_generation','expected_authority_epoch','target_pool_id','checkpoint_id','reason_observation_id']);
  const run=uuid(input.run_id),attemptId=uuid(input.old_attempt_id),generation=dec(input.expected_generation),epoch=uuid(input.expected_authority_epoch),targetId=uuid(input.target_pool_id);
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
    if(old.preparation_digest!==target.preparation_digest){
      if(!environmentVerifier||!old.profile_id||!target.profile_id)fail('ENVIRONMENT_COMPATIBILITY_UNVERIFIED','Cross-preparation relocation needs a trusted environment compatibility proof');
      const manifests=await c.query('SELECT id,manifest FROM hyperfide.environment_profiles WHERE organisation_id=$1 AND id=ANY($2::uuid[])',[config.organisation_id,[old.profile_id,target.profile_id]]);
      const source=manifests.rows.find(r=>r.id===old.profile_id)?.manifest,destination=manifests.rows.find(r=>r.id===target.profile_id)?.manifest;
      const compatibility=await environmentVerifier(source,destination);dg(compatibility.evidence_digest);
      if(!compatibility.compatible)fail('ENVIRONMENT_INCOMPATIBLE','Required source environment cannot be preserved');
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
      old_compute_fenced:true,physical_termination_confirmed:false,old_capacity_released:false,fresh_enrollment_required:true,admission_granted:false};
  });
}
export function createComponent(context:ComponentContext):Component{
  const database=providerDatabase(context);
  const guarded=(fn:(i:unknown,c:DeploymentConfig,p:ConnectivityConfig)=>Promise<unknown>)=>async(input:unknown)=>{
    if(context.signal.aborted)fail('PROVIDER_CLOSED','Provider placement is shutting down');
    return fn(input,await readDeployment(context.env),await connectivity(context.env));
  };
  return{apiVersion:1,actions:{
    'provider.placement.probe':guarded((i,c,p)=>probePool(database,c,p,i,context.signal)),
    'provider.placement.record-failure':guarded((i,c,p)=>recordPoolFailure(database,c,p,i)),
    'provider.relocation.plan':guarded((i,c,p)=>planRelocation(database,c,p,i)),
    'provider.relocation.confirm-enrollment':guarded(async(input,c,p)=>{
      const i=obj(input,['run_id','plan_id','sandbox_id']),run=uuid(i.run_id),planId=uuid(i.plan_id),sandboxId=uuid(i.sandbox_id);
      const plan=(await database.query('SELECT * FROM hyperfide.provider_relocation_plans WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[c.organisation_id,run,planId])).rows[0];
      if(!plan||!['PENDING_ADMISSION','ENROLLED'].includes(plan.state))fail('RELOCATION_PLAN_INVALID','An unadmitted relocation plan is required');
      const {scope}=await currentPool(database,c,plan.target_pool_id);
      if(scope.configuration_digest!==plan.target_configuration_digest)fail('RELOCATION_CONFIG_CHANGED','Target configuration changed since planning');
      const sandbox=(await database.query("SELECT * FROM hyperfide.sandboxes WHERE organisation_id=$1 AND id=$2 AND pool_id=$3 AND observed_state='RUNNING' AND preparation_digest=$4",[c.organisation_id,sandboxId,plan.target_pool_id,plan.preparation_digest])).rows[0];
      if(!sandbox)fail('RELOCATION_RESOURCE_INVALID','Exact target environment and sandbox identity are required');
      const proof=await verifyEnrollment(c,plan.target_pool_id,sandbox,run,context.signal,p.proof_max_age_ms);
      await database.query("UPDATE hyperfide.provider_relocation_plans SET state='ENROLLED',enrolled_sandbox_id=$4,enrolled_boot_generation=$5,enrollment_evidence_digest=$6 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state IN ('PENDING_ADMISSION','ENROLLED')",[c.organisation_id,run,planId,sandboxId,sandbox.boot_generation,proof.evidence_digest]);
      return{id:planId,state:'ENROLLED',fresh_enrollment_required:true,admission_granted:false};
    }),
  }};
}
