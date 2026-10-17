import type {InvocationContext} from '../transport/protocol.js';
import {assertInvocation} from '../transport/protocol.js';
import {FoundationError} from '../policy/programme.js';
import {PROVIDER_METHODS} from './contract.js';
import {bindProviderInvocation,configuredScope,currentPool,fail,readDeployment,transaction} from './pools.js';
import type {DeploymentConfig,ProviderDatabase,ProviderPersistenceHooks} from './pools.js';

/** Persistent provisioner-role worker. It owns no state of its own: durable
 * provisioning intents are the only work queue, claims are short SKIP LOCKED
 * transactions, and every effect goes through the 8.3 execute/reconcile paths
 * under the authenticated provisioner credential that started it. */
export interface ProvisionerWorkerSettings {concurrency:number;poll_ms:number;retry_ms:number;lease_ms:number}
export interface ProvisionerWorkerDriver {
 execute(database:ProviderDatabase,config:DeploymentConfig,id:string,signal:AbortSignal):Promise<unknown>;
 reconcile(database:ProviderDatabase,config:DeploymentConfig,id:string,signal:AbortSignal):Promise<unknown>;
}
export interface PoolAdapterReadiness {
 pool_id:string;provider:string;configuration_current:boolean;adapter_registered:boolean;adapter_compatible:boolean;
 ownership_probe_registered:boolean;operational_ready:boolean;reason:string|null;
}
function bounded(env:Readonly<NodeJS.ProcessEnv>,name:string,fallback:number,min:number,max:number):number{
 const raw=env[name];if(raw===undefined||raw==='')return fallback;
 const value=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value<min||value>max)fail('WORKER_CONFIG_INVALID',name+' is outside its approved bound');
 return value;
}
export function workerSettings(env:Readonly<NodeJS.ProcessEnv>):ProvisionerWorkerSettings{
 const settings={concurrency:bounded(env,'HYPERFIDE_PROVISIONER_CONCURRENCY',4,1,64),poll_ms:bounded(env,'HYPERFIDE_PROVISIONER_POLL_MS',1000,50,60000),
  retry_ms:bounded(env,'HYPERFIDE_PROVISIONER_RETRY_MS',5000,100,3600000),lease_ms:bounded(env,'HYPERFIDE_PROVISIONER_LEASE_MS',60000,1000,3600000)};
 if(settings.lease_ms<settings.poll_ms)fail('WORKER_CONFIG_INVALID','Reconciliation lease must exceed the poll interval');
 return settings;
}
/** Adapter compatibility is measured by instantiating the registered factory
 * with hooks that refuse every persistence effect; no provider method is called. */
export async function poolAdapterReadiness(database:ProviderDatabase,config:DeploymentConfig,invocation:InvocationContext,running:boolean):Promise<PoolAdapterReadiness[]>{
 const refuse=async()=>fail('PROVIDER_READINESS_PROBE','Readiness probing cannot persist provider effects');
 const hooks:ProviderPersistenceHooks={invocation,persistOutputArchive:refuse,assertResourceBinding:refuse,resolveResourceBinding:refuse,resolvePreparation:refuse,
  claimProcess:refuse,resolveProcess:refuse,persistEarlyProcess:refuse,assignedBootGeneration:refuse,persistEarlyResource:refuse,recordObservation:refuse};
 const result:PoolAdapterReadiness[]=[];
 for(const pool of config.pools){
  const scope=configuredScope(config,pool),factory=database.runtime.adapters.get(pool.provider);
  let current=false,compatible=false,reason:string|null=null;
  try{await currentPool(database,config,pool.id);current=true;}catch(error){reason=error instanceof FoundationError?error.code:'POOL_CONFIG_UNAVAILABLE';}
  if(!factory)reason??='PROVIDER_ADAPTER_MISSING';
  else try{
   const adapter=factory(scope,hooks) as unknown as Record<string,unknown>;
   compatible=!!adapter&&typeof adapter==='object'&&adapter.provider===pool.provider&&PROVIDER_METHODS.every(m=>typeof adapter[m]==='function');
   if(!compatible)reason??='PROVIDER_ADAPTER_INCOMPATIBLE';
  }catch{reason??='PROVIDER_ADAPTER_INCOMPATIBLE';}
  if(!running)reason??='PROVISIONER_WORKER_STOPPED';
  result.push({pool_id:pool.id,provider:pool.provider,configuration_current:current,adapter_registered:!!factory,adapter_compatible:compatible,
   ownership_probe_registered:database.runtime.probes.has(pool.provider),operational_ready:running&&current&&compatible,reason});
 }
 return result;
}
// Claimable work, all scoped to the authenticated run:
//  RECORDED with a live deadline -> execute (its own FOR UPDATE transition is the submission claim);
//  SUBMITTING / ID_KNOWN without outcome only after the submitter's deadline (it can no longer be in flight);
//  ID_KNOWN with a create outcome, UNKNOWN and acknowledged DESTROY after the retry interval;
//  RECONCILING only once its lease lapsed (a crashed reconciler).
const CLAIM=`SELECT id,state FROM hyperfide.provisioning_intents
 WHERE organisation_id=$1 AND run_id=$2 AND NOT (id=ANY($3::uuid[])) AND operation->'scope'->>'provider'=ANY($4::text[]) AND (
  (state='RECORDED' AND (operation->>'deadline_at')::timestamptz>clock_timestamp())
  OR (state='SUBMITTING' AND (operation->>'deadline_at')::timestamptz<=clock_timestamp())
  OR (state='ID_KNOWN' AND (last_outcome IS NOT NULL OR (operation->>'deadline_at')::timestamptz<=clock_timestamp()) AND updated_at<=clock_timestamp()-make_interval(secs=>$5::double precision/1000))
  OR (state='UNKNOWN' AND updated_at<=clock_timestamp()-make_interval(secs=>$5::double precision/1000))
  OR (state='ACKNOWLEDGED' AND kind='DESTROY' AND updated_at<=clock_timestamp()-make_interval(secs=>$5::double precision/1000))
  OR (state='RECONCILING' AND updated_at<=clock_timestamp()-make_interval(secs=>$6::double precision/1000)))
 ORDER BY updated_at,id LIMIT $7 FOR UPDATE SKIP LOCKED`;
export class ProvisionerWorker {
 private invocation:InvocationContext|null=null;private controller:AbortController|null=null;private loop:Promise<void>|null=null;
 private readonly active=new Map<string,Promise<void>>();private readonly errors=new Map<string,string>();private readonly backoff=new Map<string,number>();
 private counters={claimed:0,executed:0,reconciled:0,failed:0};private stoppedReason:string|null=null;private lastTick:string|null=null;
 constructor(private readonly database:ProviderDatabase,private readonly env:Readonly<NodeJS.ProcessEnv>,private readonly signal:AbortSignal,private readonly driver:ProvisionerWorkerDriver){}
 get running():boolean{return !!this.loop&&!!this.controller&&!this.controller.signal.aborted;}
 async start(invocation:InvocationContext):Promise<unknown>{
  assertInvocation(invocation);if(invocation.principal.role!=='PROVISIONER')fail('AUTH_SCOPE_DENIED','Only the provisioner principal can own provider effects');
  if(this.signal.aborted)fail('PROVIDER_CLOSED','Provisioner is shutting down');
  const settings=workerSettings(this.env),config=await readDeployment(this.env);
  bindProviderInvocation(this.database,config,invocation,['PROVISIONER']);
  if(this.running){
   if(this.invocation!.principal.credential_id!==invocation.principal.credential_id||this.invocation!.principal.run_id!==invocation.principal.run_id)fail('WORKER_ALREADY_RUNNING','Another provisioner credential owns this worker');
   return{started:false,...await this.status(invocation)};
  }
  await this.stop();
  this.invocation=invocation;this.controller=new AbortController();this.stoppedReason=null;this.errors.clear();
  const signal=AbortSignal.any([this.signal,this.controller.signal]);
  this.loop=this.run(settings,signal);
  return{started:true,...await this.status(invocation)};
 }
 private async run(settings:ProvisionerWorkerSettings,signal:AbortSignal):Promise<void>{
  while(!signal.aborted){
   try{await this.tick(settings,signal);}
   catch(error){
    const code=error instanceof FoundationError?error.code:'WORKER_TICK_FAILED';this.errors.set('tick',code);
    // A revoked or expired credential ends provider authority; never continue under it.
    if(code.startsWith('AUTH_')){this.stoppedReason=code;this.controller?.abort();break;}
   }
   await new Promise<void>(resolve=>{const timer=setTimeout(done,settings.poll_ms);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});});
  }
 }
 private async tick(settings:ProvisionerWorkerSettings,signal:AbortSignal):Promise<void>{
  this.lastTick=new Date().toISOString();
  const free=settings.concurrency-this.active.size;if(free<=0)return;
  const providers=[...this.database.runtime.adapters.keys()];if(!providers.length)return;
  const config=await readDeployment(this.env),db=bindProviderInvocation(this.database,config,this.invocation!,['PROVISIONER']),run=this.invocation!.principal.run_id;
  const claimed=await transaction(db,async c=>{
   const now=Date.now();for(const [id,until] of this.backoff)if(until<=now)this.backoff.delete(id);
   const rows=(await c.query<{id:string;state:string}>(CLAIM,[config.organisation_id,run,[...this.active.keys(),...this.backoff.keys()],providers,settings.retry_ms,settings.lease_ms,free])).rows;
   const reconcile=rows.filter(r=>r.state!=='RECORDED').map(r=>r.id);
   // RECONCILING plus updated_at is the reconciliation lease; an acknowledged destroy keeps its state.
   if(reconcile.length)await c.query("UPDATE hyperfide.provisioning_intents SET state=CASE WHEN state='ACKNOWLEDGED' THEN state ELSE 'RECONCILING' END,updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[])",[config.organisation_id,run,reconcile]);
   return rows;
  });
  for(const row of claimed){
   if(signal.aborted||this.active.has(row.id))continue;
   this.counters.claimed++;
   const task=this.process(db,config,row,settings,signal).finally(()=>this.active.delete(row.id));
   this.active.set(row.id,task);
  }
 }
 private async process(db:ProviderDatabase,config:DeploymentConfig,row:{id:string;state:string},settings:ProvisionerWorkerSettings,signal:AbortSignal):Promise<void>{
  let heartbeat:ReturnType<typeof setInterval>|undefined;
  try{
   if(row.state==='RECORDED'){await this.driver.execute(db,config,row.id,signal);this.counters.executed++;}
   else{
    heartbeat=setInterval(()=>{void db.query("UPDATE hyperfide.provisioning_intents SET updated_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND id=$2 AND state='RECONCILING'",[config.organisation_id,row.id]).catch(()=>{});},Math.max(250,Math.floor(settings.lease_ms/3)));
    await this.driver.reconcile(db,config,row.id,signal);this.counters.reconciled++;
   }
   this.errors.delete(row.id);this.backoff.delete(row.id);
  }catch(error){
   // The intent keeps its durable uncertain state; the error is surfaced, never retried blindly.
   this.counters.failed++;this.errors.set(row.id,error instanceof FoundationError?error.code:'WORKER_INTENT_FAILED');
   if(this.errors.size>256)this.errors.delete(this.errors.keys().next().value!);
   // A refused submission stays RECORDED; back off instead of re-claiming it every poll.
   this.backoff.set(row.id,Date.now()+settings.retry_ms);if(this.backoff.size>4096)this.backoff.delete(this.backoff.keys().next().value!);
  }finally{if(heartbeat)clearInterval(heartbeat);}
 }
 async status(invocation:InvocationContext):Promise<Record<string,unknown>>{
  assertInvocation(invocation);
  const config=await readDeployment(this.env),db=bindProviderInvocation(this.database,config,invocation);
  const settings=workerSettings(this.env),running=this.running;
  const pools=await poolAdapterReadiness(db,config,invocation,running);
  const counts=(await db.query<{state:string;n:number}>('SELECT state,count(*)::int AS n FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND run_id=$2 GROUP BY state ORDER BY state',[config.organisation_id,invocation.principal.run_id])).rows;
  return{running,role:'provisioner',owner_credential_id:running?this.invocation!.principal.credential_id:null,settings,active:[...this.active.keys()].sort(),
   counters:{...this.counters},errors:Object.fromEntries(this.errors),stopped_reason:this.stoppedReason,last_tick_at:this.lastTick,
   intents:Object.fromEntries(counts.map(r=>[r.state,r.n])),pools,operational_ready:running&&pools.length>0&&pools.every(p=>p.operational_ready)};
 }
 async stop(timeoutMs=5000):Promise<void>{
  this.controller?.abort();
  const pending=[...(this.loop?[this.loop]:[]),...this.active.values()];
  if(pending.length){let timer:ReturnType<typeof setTimeout>|undefined;
   await Promise.race([Promise.allSettled(pending),new Promise<void>(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);if(timer)clearTimeout(timer);}
  this.loop=null;
 }
}
export function createProvisionerWorker(database:ProviderDatabase,env:Readonly<NodeJS.ProcessEnv>,signal:AbortSignal,driver:ProvisionerWorkerDriver):ProvisionerWorker{
 return new ProvisionerWorker(database,env,signal,driver);
}
