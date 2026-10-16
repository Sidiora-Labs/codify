import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {storageConfig,createStoragePool,bindStoragePool} from './schema.js';
import type {StorageConfig} from './schema.js';
import {TransactionGateway,StorageError,bounded,deadlineFrom,assertTransactionStatement} from './transactions.js';
import type {DatabaseLease,QuerySession} from './transactions.js';
import type {ServiceRole} from '../policy/programme.js';

interface Waiter {resolve:(release:()=>void)=>void;reject:(error:unknown)=>void;cleanup:()=>void}
class BoundedPool {
  private pool:pg.Pool|undefined;
  private active=0;
  private queue:Waiter[]=[];
  private closed=false;
  private leases=new Set<DatabaseLease>();
  constructor(private readonly config:StorageConfig,private readonly maxQueued:number,private readonly shutdown:AbortSignal){}
  raw():pg.Pool{return this.pool??=createStoragePool(this.config);}
  private async permit(deadline:number,signal?:AbortSignal):Promise<()=>void>{
    if(this.closed||this.shutdown.aborted)throw new StorageError('DB_UNAVAILABLE','Resource container is closed');
    const released=()=>{let done=false;return ()=>{if(done)return;done=true;this.active--;this.drain();};};
    if(this.active<this.config.max){this.active++;return released();}
    if(this.queue.length>=this.maxQueued)throw new StorageError('DB_OVERLOADED','Database admission queue is full');
    return new Promise((resolve,reject)=>{
      let waiter:Waiter;
      const remove=()=>{const index=this.queue.indexOf(waiter);if(index>=0)this.queue.splice(index,1);};
      const abort=()=>{remove();waiter.cleanup();reject(new StorageError('TX_TIMEOUT','Database queue wait cancelled'));};
      const timer=setTimeout(()=>{remove();waiter.cleanup();reject(new StorageError('TX_TIMEOUT','Database queue deadline expired'));},Math.max(1,Math.ceil(deadline-performance.now())));
      waiter={resolve,reject,cleanup:()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.shutdown.removeEventListener('abort',abort);}};
      signal?.addEventListener('abort',abort,{once:true});this.shutdown.addEventListener('abort',abort,{once:true});
      this.queue.push(waiter);
      if(signal?.aborted||this.shutdown.aborted)abort();
    });
  }
  private drain():void{
    while(!this.closed&&this.active<this.config.max&&this.queue.length){
      const waiter=this.queue.shift()!;waiter.cleanup();this.active++;
      let released=false;waiter.resolve(()=>{if(released)return;released=true;this.active--;this.drain();});
    }
  }
  async acquire(deadline:number,signal?:AbortSignal):Promise<DatabaseLease>{
    if(deadline<=performance.now()||signal?.aborted)throw new StorageError('TX_TIMEOUT','Database deadline expired');
    const permit=await this.permit(deadline,signal);
    const connection=this.raw().connect();
    let settled=false;
    try{
      const client=await bounded(connection,deadline,signal);
      settled=true;
      const controller=new AbortController();
      let done=false;
      const abort=()=>{controller.abort();release(true);};
      const timer=setTimeout(abort,Math.max(1,Math.ceil(deadline-performance.now())));
      const release=(destroy=false)=>{if(done)return;done=true;clearTimeout(timer);
        signal?.removeEventListener('abort',abort);this.shutdown.removeEventListener('abort',abort);
        this.leases.delete(lease);client.removeListener('error',abort);client.release(destroy);permit();};
      const lease:DatabaseLease={client,signal:controller.signal,release};
      this.leases.add(lease);client.on('error',abort);
      signal?.addEventListener('abort',abort,{once:true});this.shutdown.addEventListener('abort',abort,{once:true});
      if(signal?.aborted||this.shutdown.aborted)abort();
      return lease;
    }catch(error){
      if(!settled)void connection.then(client=>client.release(true),()=>{});
      permit();throw error;
    }
  }
  facade():pg.Pool{
    const pool=this.raw(),owner=this;
    return new Proxy(pool,{
      get(target,key){
        if(key==='connect')return (callback?:unknown)=>{
          const promise=owner.acquire(deadlineFrom()).then(lease=>{
            let released=false;
            return new Proxy(lease.client,{
              get(client,property){
                if(property==='release')return (destroy?:boolean)=>{if(released)return;released=true;lease.release(destroy);};
                if(property==='query')return (...args:unknown[])=>{
                  if(released||lease.signal.aborted)throw new StorageError('TX_CLOSED','Compatibility client was released');
                  return Reflect.apply(client.query,client,args);
                };
                const value=Reflect.get(client,property);return typeof value==='function'?value.bind(client):value;
              }
            });
          });
          if(typeof callback==='function'){void promise.then(client=>callback(null,client,client.release),error=>callback(error));return;}
          return promise;
        };
        if(key==='query')return (...arguments_:unknown[])=>{
          const callback=typeof arguments_.at(-1)==='function'?arguments_.pop() as (error:unknown,result?:unknown)=>void:undefined;
          const operation=owner.acquire(deadlineFrom()).then(async lease=>{
            try{return await (lease.client.query as (...args:unknown[])=>Promise<unknown>)(...arguments_);}
            finally{lease.release();}
          });
          if(callback){void operation.then(result=>callback(null,result),error=>callback(error));return;}
          return operation;
        };
        if(key==='end')return async()=>{};
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }
    });
  }
  metrics(){return {maxActive:this.config.max,maxQueued:this.maxQueued,active:this.active,queued:this.queue.length,
    totalCount:this.pool?.totalCount??0,idleCount:this.pool?.idleCount??0,waitingCount:this.pool?.waitingCount??0};}
  async close():Promise<void>{
    if(this.closed)return;this.closed=true;
    for(const waiter of this.queue.splice(0)){waiter.cleanup();waiter.reject(new StorageError('DB_UNAVAILABLE','Resource container is closed'));}
    for(const lease of [...this.leases])lease.release(true);
    if(this.pool)await this.pool.end();
  }
}
function setting(env:Readonly<NodeJS.ProcessEnv>,name:string,fallback:number,max:number):number{
  const text=env[name];if(text===undefined)return fallback;
  if(!/^(0|[1-9][0-9]*)$/.test(text)||!Number.isSafeInteger(Number(text))||Number(text)>max)
    throw new StorageError('DATABASE_CONFIG_INVALID','Invalid bounded setting '+name);
  return Number(text);
}
export interface ObservationOptions {timeoutMs?:number;signal?:AbortSignal;preferReplica?:boolean}
export interface ListenerSession extends QuerySession {onNotification(listener:(event:{channel:string;payload?:string|undefined;processId:number})=>void):()=>void}
export interface ServiceResources {
  readonly gateway:TransactionGateway;
  observe<T>(options:ObservationOptions,operation:(session:QuerySession)=>Promise<T>|T):Promise<{value:T;route:'primary'|'replica';observedAt:string}>;
  withReplicaConnection<T>(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=>Promise<T>|T):Promise<T>;
  withMigrationConnection<T>(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=>Promise<T>|T):Promise<T>;
  withListener<T>(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:ListenerSession)=>Promise<T>|T):Promise<T>;
  describe():unknown;
  close():Promise<void>;
}
export class ResourceContainer implements ServiceResources {
  readonly gateway:TransactionGateway;
  readonly resourceId=randomUUID();
  private controller=new AbortController();
  private pools=new Map<string,BoundedPool>();
  private unbind:(()=>void)|undefined;
  private revocations=new WeakMap<object,()=>void>();
  private closed=false;
  constructor(private readonly role:ServiceRole,private readonly env:Readonly<NodeJS.ProcessEnv>,signal:AbortSignal){
    this.gateway=new TransactionGateway(this);
    signal.addEventListener('abort',()=>this.controller.abort(),{once:true});
    if(signal.aborted)this.controller.abort();
    this.unbind=bindStoragePool(caller=>this.compatibilityPool(caller));
  }
  async validateCommit(client:pg.PoolClient):Promise<void>{
    const required=this.env.HYPERFIDE_REQUIRE_SYNC_REPLICA;
    if(required!==undefined&&!['0','1'].includes(required))throw new StorageError('DATABASE_CONFIG_INVALID','Synchronous replica policy must be 0 or 1');
    if(required!=='1')return;
    const row=(await client.query<{valid:boolean}>("SELECT (NOT pg_is_in_recovery() AND current_setting('fsync')='on' AND current_setting('full_page_writes')='on' AND length(btrim(current_setting('synchronous_standby_names')))>0) AS valid")).rows[0];
    if(row?.valid!==true)throw new StorageError('DURABILITY_UNAVAILABLE','Required synchronous durability configuration is unavailable');
  }
  private config(kind:'primary'|'replica'|'migration'|'listener'):StorageConfig{
    const prefix='HYPERFIDE_'+this.role.toUpperCase();
    const url=kind==='migration'?this.env.HYPERFIDE_MIGRATION_DATABASE_URL:
      kind==='replica'?this.env[prefix+'_REPLICA_DATABASE_URL']:
      this.env[prefix+'_PRIMARY_DATABASE_URL']??this.env.DATABASE_URL;
    if(!url)throw new StorageError('DATABASE_CONFIG_INVALID',kind==='migration'?'Explicit migration credential is required':'Database route is not configured');
    const config=storageConfig({...this.env,DATABASE_URL:url});
    return {...config,max:kind==='migration'?1:kind==='listener'?setting(this.env,'HYPERFIDE_PG_LISTENER_MAX',1,4):config.max};
  }
  private pool(kind:'primary'|'replica'|'migration'|'listener'):BoundedPool{
    if(this.closed)throw new StorageError('DB_UNAVAILABLE','Resource container is closed');
    let pool=this.pools.get(kind);
    if(!pool){
      if(kind==='listener'&&setting(this.env,'HYPERFIDE_PG_LISTENER_MAX',1,4)===0)
        throw new StorageError('DB_OVERLOADED','Listener capacity disabled');
      pool=new BoundedPool(this.config(kind),setting(this.env,'HYPERFIDE_PG_MAX_QUEUED',32,1024),this.controller.signal);
      this.pools.set(kind,pool);
    }
    return pool;
  }
  private compatibilityPool(caller:Readonly<NodeJS.ProcessEnv>):pg.Pool{
    const expected=this.config('primary');
    const prefix='HYPERFIDE_'+this.role.toUpperCase();
    const actual=storageConfig({...caller,DATABASE_URL:caller[prefix+'_PRIMARY_DATABASE_URL']??caller.DATABASE_URL});
    if(JSON.stringify(expected)!==JSON.stringify(actual))
      throw new StorageError('DATABASE_CONFIG_CONFLICT','This process owns a different PostgreSQL configuration');
    return this.pool('primary').facade();
  }
  commitMode():'on'|'remote_apply'{
    const mode=this.env.HYPERFIDE_PG_SYNCHRONOUS_COMMIT??'on';
    if(mode!=='on'&&mode!=='remote_apply')throw new StorageError('DATABASE_CONFIG_INVALID','Commit durability mode must be on or remote_apply');return mode;
  }
  acquirePrimary(deadline:number,signal?:AbortSignal):Promise<DatabaseLease>{return this.pool('primary').acquire(deadline,signal);}
  private session(lease:DatabaseLease,deadline:number,readonly=false):QuerySession{
    let valid=true;
    const session=Object.freeze({
      query:async<R extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values?:readonly unknown[])=>{
        if(!valid||lease.signal.aborted)throw new StorageError('TX_CLOSED','Connection capability expired');
        if(readonly)assertTransactionStatement(text);
        return bounded(lease.client.query<R>(text,values?[...values]:undefined),deadline,lease.signal);
      },remainingMs:()=>Math.max(0,Math.floor(deadline-performance.now())),signal:lease.signal
    });
    this.revocations.set(session,()=>{valid=false;});
    return session;
  }
  private async connection<T>(kind:'migration'|'listener',options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=>Promise<T>|T):Promise<T>{
    const deadline=deadlineFrom(options.timeoutMs),lease=await this.pool(kind).acquire(deadline,options.signal);
    const session=this.session(lease,deadline);
    try{return await bounded(Promise.resolve().then(()=>operation(session)),deadline,lease.signal);}
    finally{this.revocations.get(session)?.();this.revocations.delete(session);lease.release(true);}
  }
  async withReplicaConnection<T>(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=>Promise<T>|T):Promise<T>{
    const deadline=deadlineFrom(options.timeoutMs),lease=await this.pool('replica').acquire(deadline,options.signal);
    const session=this.session(lease,deadline);let healthy=true;
    try{
      if(!(await lease.client.query<{recovery:boolean}>('SELECT pg_is_in_recovery() AS recovery')).rows[0]?.recovery)
        throw new StorageError('REPLICA_REQUIRED','Configured observation route is not a physical replica');
      return await bounded(Promise.resolve().then(()=>operation(session)),deadline,lease.signal);
    }finally{
      this.revocations.get(session)?.();this.revocations.delete(session);
      try{await bounded(lease.client.query('ROLLBACK'),deadline,lease.signal);}catch{healthy=false;}
      lease.release(!healthy||lease.signal.aborted);
    }
  }
  withMigrationConnection<T>(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:QuerySession)=>Promise<T>|T):Promise<T>{return this.connection('migration',options,operation);}
  async withListener<T>(options:{timeoutMs?:number;signal?:AbortSignal},operation:(session:ListenerSession)=>Promise<T>|T):Promise<T>{
    const deadline=deadlineFrom(options.timeoutMs),lease=await this.pool('listener').acquire(deadline,options.signal);
    let active=true;
    const base=this.session(lease,deadline),subscriptions=new Set<(event:{channel:string;payload?:string|undefined;processId:number})=>void>();
    const session:ListenerSession=Object.freeze({...base,onNotification:(listener:(event:{channel:string;payload?:string|undefined;processId:number})=>void)=>{
      if(!active||lease.signal.aborted)throw new StorageError('TX_CLOSED','Listener capability expired');
      const guarded=(event:{channel:string;payload?:string|undefined;processId:number})=>{try{listener(event);}catch{lease.release(true);}};
      subscriptions.add(guarded);lease.client.on('notification',guarded);
      return ()=>{subscriptions.delete(guarded);lease.client.removeListener('notification',guarded);};
    }});
    try{return await bounded(Promise.resolve().then(()=>operation(session)),deadline,lease.signal);}
    finally{active=false;for(const listener of subscriptions)lease.client.removeListener('notification',listener);
      this.revocations.get(base)?.();this.revocations.delete(base);lease.release(true);}
  }
  async observe<T>(options:ObservationOptions,operation:(session:QuerySession)=>Promise<T>|T):Promise<{value:T;route:'primary'|'replica';observedAt:string}>{
    const prefix='HYPERFIDE_'+this.role.toUpperCase();
    const route=options.preferReplica!==false&&this.env[prefix+'_REPLICA_DATABASE_URL']?'replica':'primary';
    const deadline=deadlineFrom(options.timeoutMs),lease=await this.pool(route).acquire(deadline,options.signal);
    const session=this.session(lease,deadline,true);let healthy=true;
    try{
      await lease.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const value=await bounded(Promise.resolve().then(()=>operation(session)),deadline,lease.signal);
      await lease.client.query('COMMIT');return {value,route,observedAt:new Date().toISOString()};
    }catch(error){try{await lease.client.query('ROLLBACK');}catch{healthy=false;}throw error;}
    finally{this.revocations.get(session)?.();this.revocations.delete(session);lease.release(!healthy||lease.signal.aborted);}
  }
  describe():unknown{
    return {resourceId:this.resourceId,primary:this.pools.get('primary')?.metrics()??{maxActive:this.config('primary').max,maxQueued:setting(this.env,'HYPERFIDE_PG_MAX_QUEUED',32,1024),active:0,queued:0,totalCount:0,idleCount:0,waitingCount:0},
      replica:this.pools.get('replica')?.metrics()??null,migration:this.pools.get('migration')?.metrics()??null,
      listeners:{limit:setting(this.env,'HYPERFIDE_PG_LISTENER_MAX',1,4),active:this.pools.get('listener')?.metrics().active??0},closed:this.closed};
  }
  async close():Promise<void>{
    if(this.closed)return;this.closed=true;this.controller.abort();
    this.unbind?.();for(const pool of this.pools.values())await pool.close();
  }
}
export function createResourceContainer(context:{role:ServiceRole;env:Readonly<NodeJS.ProcessEnv>;signal:AbortSignal}):ResourceContainer{
  return new ResourceContainer(context.role,context.env,context.signal);
}
export function createComponent(context:{resources:ServiceResources}){
  return {apiVersion:1 as const,actions:{
    'storage.runtime.describe':async()=>context.resources.describe()
  },capabilities:Object.freeze({'storage.resources.v1':context.resources,'storage.transactions.v1':context.resources.gateway})};
}
